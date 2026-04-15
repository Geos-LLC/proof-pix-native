import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logEvent } from '../utils/analytics';

const PENDING_JOBS_KEY = '@pending_job_reminders';
const PERMISSION_ASKED_KEY = '@notification_permission_asked';

// Configurable reminder timing (ms)
const REMINDER_1_DELAY = 2 * 60 * 60 * 1000; // 2 hours
const REMINDER_2_DELAY = 24 * 60 * 60 * 1000; // 24 hours

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Request notification permission with contextual explanation.
 * Only asks once — subsequent calls return cached status.
 */
export const ensureNotificationPermission = async () => {
  try {
    const alreadyAsked = await AsyncStorage.getItem(PERMISSION_ASKED_KEY);

    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    if (alreadyAsked) return false;

    logEvent('job_reminder_permission_prompt_shown');
    const { status } = await Notifications.requestPermissionsAsync();
    await AsyncStorage.setItem(PERMISSION_ASKED_KEY, 'true');
    logEvent('job_reminder_permission_result', { status });

    return status === 'granted';
  } catch (error) {
    console.warn('[JobReminder] Permission error:', error?.message);
    return false;
  }
};

/**
 * Get all pending (unfinished) jobs.
 */
export const getPendingJobs = async () => {
  try {
    const raw = await AsyncStorage.getItem(PENDING_JOBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const savePendingJobs = async (jobs) => {
  await AsyncStorage.setItem(PENDING_JOBS_KEY, JSON.stringify(jobs));
};

/**
 * Schedule reminders when a before photo is taken.
 * Call this after addPhoto() for a BEFORE photo.
 */
export const onBeforePhotoTaken = async (photo) => {
  try {
    const projectKey = photo.projectId || '__noproject__';
    const jobs = await getPendingJobs();

    // One reminder per project — if this project already has a pending job,
    // don't schedule another notification.
    const existing = jobs.find((j) => (j.projectId || '__noproject__') === projectKey);
    if (existing) {
      logEvent('job_reminder_skipped', { reason: 'project_already_pending' });
      return;
    }

    const hasPermission = await ensureNotificationPermission();

    const job = {
      jobId: `job_${photo.projectId || photo.id}`,
      photoId: photo.id,
      projectId: photo.projectId || null,
      room: photo.room || 'General',
      name: photo.name || '',
      startedAt: Date.now(),
      isCompleted: false,
      notification1Id: null,
      notification2Id: null,
    };

    if (hasPermission) {
      // Single 2-hour reminder per project
      const n1Id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Don't forget your AFTER photos",
          body: 'Finish your before/after proof in just a few taps.',
          data: { jobId: job.jobId, type: 'job_reminder' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: REMINDER_1_DELAY / 1000,
        },
      });
      job.notification1Id = n1Id;
      logEvent('job_reminder_scheduled', { reminder_type: '2h' });
    }

    jobs.push(job);
    await savePendingJobs(jobs);
  } catch (error) {
    console.warn('[JobReminder] Schedule error:', error?.message);
  }
};

/**
 * Cancel reminders when after photo is completed.
 * Call this after addPhoto() for an AFTER photo.
 */
export const onAfterPhotoCompleted = async (beforePhotoId) => {
  try {
    const jobs = await getPendingJobs();

    // Resolve this before-photo's project so we can cancel the project-level
    // reminder even if it was scheduled off a different before photo.
    let projectId = null;
    try {
      const { loadPhotosMetadata } = await import('./storage');
      const photos = (await loadPhotosMetadata()) || [];
      const before = photos.find((p) => p?.id === beforePhotoId);
      projectId = before?.projectId || null;
    } catch {}

    const matches = jobs.filter((j) =>
      j.photoId === beforePhotoId ||
      (projectId && j.projectId === projectId)
    );
    if (matches.length === 0) return;

    for (const job of matches) {
      if (job.notification1Id) {
        await Notifications.cancelScheduledNotificationAsync(job.notification1Id).catch(() => {});
      }
      if (job.notification2Id) {
        await Notifications.cancelScheduledNotificationAsync(job.notification2Id).catch(() => {});
      }
    }

    const cancelIds = new Set(matches.map((j) => j.jobId));
    const updated = jobs.filter((j) => !cancelIds.has(j.jobId));
    await savePendingJobs(updated);

    logEvent('job_reminder_cancelled', { reason: 'after_completed' });
  } catch (error) {
    console.warn('[JobReminder] Cancel error:', error?.message);
  }
};

/**
 * Cancel all reminders for a deleted project.
 */
export const onProjectDeleted = async (projectId) => {
  try {
    const jobs = await getPendingJobs();
    const toCancel = jobs.filter(j => j.projectId === projectId);

    for (const job of toCancel) {
      if (job.notification1Id) {
        await Notifications.cancelScheduledNotificationAsync(job.notification1Id).catch(() => {});
      }
      if (job.notification2Id) {
        await Notifications.cancelScheduledNotificationAsync(job.notification2Id).catch(() => {});
      }
    }

    const remaining = jobs.filter(j => j.projectId !== projectId);
    await savePendingJobs(remaining);

    if (toCancel.length > 0) {
      logEvent('job_reminder_cancelled', { reason: 'project_deleted' });
    }
  } catch (error) {
    console.warn('[JobReminder] Project delete cleanup error:', error?.message);
  }
};

/**
 * Get the most recent unfinished job for the home banner.
 * Returns null if no pending jobs.
 */
export const getMostRecentUnfinishedJob = async () => {
  try {
    const jobs = await getPendingJobs();
    if (jobs.length === 0) return null;

    // Clean up stale jobs (older than 7 days)
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let active = jobs.filter(j => j.startedAt > oneWeekAgo);

    // Cross-check against actual photos: drop jobs whose before photo was
    // deleted, or for which an after photo already exists.
    try {
      const { loadPhotosMetadata } = await import('./storage');
      const { PHOTO_MODES } = await import('../constants/rooms');
      const photos = (await loadPhotosMetadata()) || [];
      const completedBeforeIds = new Set(
        photos
          .filter((p) => p?.mode === PHOTO_MODES.AFTER && p?.beforePhotoId)
          .map((p) => p.beforePhotoId)
      );
      // A project has unfinished work if it has any BEFORE photo without a
      // matching AFTER. Jobs without a projectId fall back to photoId lookup.
      const unfinishedByProject = new Map();
      for (const p of photos) {
        if (p?.mode !== PHOTO_MODES.BEFORE) continue;
        if (completedBeforeIds.has(p.id)) continue;
        const key = p.projectId || '__noproject__';
        if (!unfinishedByProject.has(key)) unfinishedByProject.set(key, []);
        unfinishedByProject.get(key).push(p);
      }
      active = active.filter((j) => {
        const key = j.projectId || '__noproject__';
        return unfinishedByProject.has(key);
      });
    } catch (err) {
      console.warn('[JobReminder] Photo cross-check skipped:', err?.message);
    }

    if (active.length !== jobs.length) {
      await savePendingJobs(active);
    }

    if (active.length === 0) return null;

    // Return most recent
    const sorted = active.sort((a, b) => b.startedAt - a.startedAt);
    return {
      ...sorted[0],
      totalUnfinished: active.length,
    };
  } catch {
    return null;
  }
};

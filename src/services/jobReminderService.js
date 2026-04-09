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
    const hasPermission = await ensureNotificationPermission();

    const job = {
      jobId: `job_${photo.id}`,
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
      // Schedule 2-hour reminder
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

      // Schedule 24-hour reminder
      const n2Id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Still need your AFTER photo?',
          body: 'Come back and complete your proof for this job.',
          data: { jobId: job.jobId, type: 'job_reminder' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: REMINDER_2_DELAY / 1000,
        },
      });
      job.notification2Id = n2Id;
      logEvent('job_reminder_scheduled', { reminder_type: '24h' });
    }

    // Save to pending jobs
    const jobs = await getPendingJobs();
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
    const job = jobs.find(j => j.photoId === beforePhotoId);

    if (!job) return;

    // Cancel scheduled notifications
    if (job.notification1Id) {
      await Notifications.cancelScheduledNotificationAsync(job.notification1Id).catch(() => {});
    }
    if (job.notification2Id) {
      await Notifications.cancelScheduledNotificationAsync(job.notification2Id).catch(() => {});
    }

    // Remove from pending
    const updated = jobs.filter(j => j.photoId !== beforePhotoId);
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
    const active = jobs.filter(j => j.startedAt > oneWeekAgo);

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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTrialDaysRemaining, isTrialActive, getTrialPlan, getTrialInfo } from './trialService';

const TRIAL_NOTIFICATIONS_KEY = '@trial_notifications_shown';

/**
 * Trial Notification Service
 * Manages showing trial-related messages at specific days
 */

/**
 * Get which notifications have been shown
 * @returns {Promise<Object>} Object with notification flags
 */
export const getShownNotifications = async () => {
  try {
    const stored = await AsyncStorage.getItem(TRIAL_NOTIFICATIONS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return {
      day0: false,
      day7_10: false,
      day15: false,
      day22_24: false,
      day27_28: false,
      day30: false,
    };
  } catch (error) {
    console.error('[TrialNotification] Error getting shown notifications:', error);
    return {
      day0: false,
      day7_10: false,
      day15: false,
      day22_24: false,
      day27_28: false,
      day30: false,
    };
  }
};

/**
 * Mark a notification as shown
 * @param {string} notificationKey - Key of the notification (day0, day7_10, etc.)
 * @returns {Promise<void>}
 */
export const markNotificationShown = async (notificationKey) => {
  try {
    const shown = await getShownNotifications();
    shown[notificationKey] = true;
    await AsyncStorage.setItem(TRIAL_NOTIFICATIONS_KEY, JSON.stringify(shown));
  } catch (error) {
    console.error('[TrialNotification] Error marking notification shown:', error);
  }
};

/**
 * Check if a notification should be shown based on days remaining
 * @param {boolean} skipDay0 - Skip Day 0 welcome message (for app startup checks)
 * @returns {Promise<Object|null>} Notification object to show, or null
 */
export const getNotificationToShow = async (skipDay0 = false) => {
  const shown = await getShownNotifications();
  
  // Check Day 30 FIRST (before checking if trial is active, since expired trials are inactive)
  if (!shown.day30) {
    const { getTrialInfo } = await import('./trialService');
    const trialInfo = await getTrialInfo();
    
    if (trialInfo && trialInfo.plan) {
      // Check if trial has expired
      const now = new Date().getTime();
      const endDate = new Date(trialInfo.endDate).getTime();
      const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      
      if (daysRemaining <= 0 || !trialInfo.active) {
        console.log('[TrialNotification] Day 30 notification triggered, daysRemaining:', daysRemaining, 'active:', trialInfo.active);
        await markNotificationShown('day30');
        return {
          key: 'day30',
          type: 'expiration',
          title: 'Your Trial Ended – Upgrade to Unlock Everything',
          message: 'You\'re back! To continue using:',
          featuresList: '• Bulk before & after photo creation\n• Custom watermark & cloud storage\n• Team management & photo cleanup',
          referralIncentive: 'Refer a friend and get 1-3 months free',
          cta: '👉 Upgrade Now',
          showUpgrade: true,
          urgent: true,
        };
      }
    }
  }

  // If trial is not active and we've already shown day30, return null
  const trialActive = await isTrialActive();
  if (!trialActive) {
    return null;
  }

  const daysRemaining = await getTrialDaysRemaining();
  const trialPlan = await getTrialPlan();

  // Get trial info to determine actual trial duration.
  // Prefer `durationDays` when present (set by startTrial), but fall back
  // to computing from start/end dates so the welcome banner stays in sync
  // with Settings' daysRemaining for legacy/test-utility trials that
  // didn't persist `durationDays`. Without this fallback, a 30-day
  // referral-bonused trial shows "15-day" in the welcome banner while
  // Settings displays "29 days remaining" — confusing for the user.
  const trialInfo = await getTrialInfo();
  const computeDurationFromDates = () => {
    try {
      if (!trialInfo?.startDate || !trialInfo?.endDate) return null;
      const startMs = new Date(trialInfo.startDate).getTime();
      const endMs = new Date(trialInfo.endDate).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
    } catch {
      return null;
    }
  };
  // 7 = base trial duration (matches TRIAL_DURATION_DAYS in trialService).
  const trialDuration = trialInfo?.durationDays || computeDurationFromDates() || 7;

  // Day 0 (Welcome) - Show immediately when trial starts (only if not skipped)
  // For 30-day trial: show when >= 28 days remaining
  // For 45-day trial: show when >= 43 days remaining
  const welcomeThreshold = trialDuration - 2;
  if (!skipDay0 && daysRemaining >= welcomeThreshold && !shown.day0) {
    await markNotificationShown('day0');

    // Get trial end date (already have trialInfo from above)
    let endDateText = '';
    let formattedDate = '';
    try {
      if (trialInfo && trialInfo.endDate) {
        const endDate = new Date(trialInfo.endDate);
        formattedDate = endDate.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });
        endDateText = ` Your trial ends on ${formattedDate}.`;
      }
    } catch (error) {
      console.error('[TrialNotification] Error getting trial end date:', error);
    }

    const planDisplayName = trialPlan ? trialPlan.charAt(0).toUpperCase() + trialPlan.slice(1) : 'Premium';

    return {
      key: 'day0',
      type: 'welcome',
      title: 'Welcome to Your Free Trial! 🎉',
      message: `You're now on a ${trialDuration}-day free trial of ${planDisplayName} features. Get started with bulk photo capture, custom watermarks, and automation tools.`,
      endDate: formattedDate, // Store end date separately for styling
      showUpgrade: false,
      urgent: false,
      // Extra fields for translations
      days: trialDuration,
      planName: planDisplayName,
    };
  }

  // Notification cadence calibrated for a 7-day base trial. Keys are
  // preserved (day7_10, day15, day22_24, day27_28) so existing
  // shown-flag persistence keeps working; the windows are remapped.
  //
  // 7-day timeline:
  //   Day 0 (days=7)   → Welcome (handled above)
  //   Day 2 (days=5)   → Engagement nudge
  //   Day 3 (days=4)   → Mid-trial check-in
  //   Day 5 (days=2)   → Reminder + expiring-trial referral nudge
  //   Day 6 (days=1)   → Last chance — upgrade or refer
  //   Day 7 (days≤0)   → Expired (handled above)

  // Engagement Nudge — Day 2 (days remaining = 5)
  if (daysRemaining === 5 && !shown.day7_10) {
    await markNotificationShown('day7_10');
    return {
      key: 'day7_10',
      type: 'engagement',
      title: 'Customize Your Watermark',
      message: 'Make your before & after photos stand out with your own watermark.',
      cta: '👉 Go to Settings to update now.',
      showUpgrade: false,
      urgent: false,
    };
  }

  // Mid-Trial Check-in — Day 3 (days remaining = 4)
  if (daysRemaining === 4 && !shown.day15) {
    await markNotificationShown('day15');
    return {
      key: 'day15',
      type: 'checkin',
      title: 'Connect Cloud Storage',
      message: 'Keep your photos safe and organized. Connect Google Drive or Dropbox in Settings.',
      cta: '👉 Go to Settings to connect.',
      showUpgrade: false,
      urgent: false,
    };
  }

  // Reminder — Day 5 (days remaining = 2)
  if (daysRemaining === 2 && !shown.day22_24) {
    await markNotificationShown('day22_24');
    return {
      key: 'day22_24',
      type: 'reminder',
      title: 'Free up space Easily',
      message: 'Free up space on your device and in the app by deleting entire projects at once.',
      cta: '👉 Go to Settings to delete projects and free up storage.',
      ctaDescription: 'In the delete confirmation, look for the checkbox "Delete from phone storage" and check it to remove photos from your device as well: ☐ Delete from phone storage',
      showUpgrade: false,
      urgent: false,
    };
  }

  // Last Chance — Day 6 (days remaining = 1)
  if (daysRemaining === 1 && !shown.day27_28) {
    await markNotificationShown('day27_28');
    return {
      key: 'day27_28',
      type: 'urgent',
      title: 'Trial Ends Tomorrow!',
      message: `Only ${daysRemaining} day left to enjoy full features. Upgrade now to continue.`,
      referralIncentive: '🎁 Invite friends and earn extra trial days:\n\n1 friend → +15 days\n2 friends → +30 days\n3 friends → +45 days\n\nYour friend must set up the app to count.',
      cta: '👉 Upgrade / Refer Now',
      showUpgrade: true,
      urgent: true,
      // Extra field for translations
      days: daysRemaining,
    };
  }

  return null;
};

/**
 * Reset all notifications (useful for testing or new trial)
 * @returns {Promise<void>}
 */
export const resetNotifications = async () => {
  try {
    await AsyncStorage.removeItem(TRIAL_NOTIFICATIONS_KEY);
  } catch (error) {
    console.error('[TrialNotification] Error resetting notifications:', error);
  }
};


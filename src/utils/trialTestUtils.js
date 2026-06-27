import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetNotifications, getNotificationToShow } from '../services/trialNotificationService';

const TRIAL_STORAGE_KEY = '@user_trial_info';

/**
 * Trial Testing Utilities
 * Use these functions to test trial notifications at different days
 */

/**
 * Set trial to a specific number of days remaining
 * @param {number} daysRemaining - Number of days remaining in trial (0-30)
 * @param {string} plan - Plan tier (starter, pro, business, enterprise)
 * @returns {Promise<void>}
 */
export const setTrialDaysRemaining = async (daysRemaining, plan = 'business') => {
  try {
    // Base trial is 7 days per product spec. If the caller asks for more
    // days remaining than the base, expand TOTAL to accommodate (caller
    // is simulating a trial extended by referrals: 7 + 15*N).
    const BASE_TRIAL_DAYS = 7;
    const TOTAL_TRIAL_DAYS = Math.max(BASE_TRIAL_DAYS, daysRemaining);
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + daysRemaining);

    const trialInfo = {
      active: true,
      used: true,
      startDate: new Date(now.getTime() - (TOTAL_TRIAL_DAYS - daysRemaining) * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate.toISOString(),
      plan: plan,
      durationDays: TOTAL_TRIAL_DAYS,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));
    console.log(`[TrialTest] Set trial to ${daysRemaining} days remaining (duration ${TOTAL_TRIAL_DAYS})`);

    // Reset notifications so you can test them again
    await resetNotifications();
    console.log('[TrialTest] Reset notification flags');
  } catch (error) {
    console.error('[TrialTest] Error setting trial days:', error);
  }
};

/**
 * Day 0 / Welcome — fresh 7-day trial. Welcome notification queued
 * via @pending_trial_notification, shows on next app cold start.
 * @param {string} plan - Plan tier
 */
export const testDay0 = async (plan = 'business') => {
  try {
    // 7 days remaining → trial just started.
    await setTrialDaysRemaining(7, plan);

    // Prepare Day 0 notification so it shows on next app start like real flow
    const notification = await getNotificationToShow(false); // don't skip Day 0
    if (notification && notification.key === 'day0') {
      await AsyncStorage.setItem('@pending_trial_notification', JSON.stringify(notification));
      console.log('[TrialTest] Prepared pending Day 0 notification');
    } else {
      console.log('[TrialTest] No Day 0 notification available after setting trial');
    }

    console.log('[TrialTest] Set to Day 0 - Welcome message should show on next app start');
  } catch (error) {
    console.error('[TrialTest] Error preparing Day 0 test:', error);
  }
};

/**
 * Day 1 / Capture Workflow — 6 days remaining.
 * Triggers "Document Every Stage of the Job".
 * @param {string} plan - Plan tier
 */
export const testDay1 = async (plan = 'business') => {
  await setTrialDaysRemaining(6, plan);
  console.log('[TrialTest] Day 1 - Capture workflow message should show');
};

/**
 * Day 2 / First Report — 5 days remaining.
 * Triggers "Create Your First Client Report".
 * @param {string} plan - Plan tier
 */
export const testDay7_10 = async (plan = 'business') => {
  await setTrialDaysRemaining(5, plan);
  console.log('[TrialTest] Day 2 - First report message should show');
};

/**
 * Day 3 / Mid-trial check-in — 4 days remaining.
 * Triggers "Connect Cloud Storage".
 * @param {string} plan - Plan tier
 */
export const testDay15 = async (plan = 'business') => {
  await setTrialDaysRemaining(4, plan);
  console.log('[TrialTest] Day 3 - Mid-trial check-in should show');
};

/**
 * Day 5 / Reminder — 2 days remaining. Triggers "Free up space"
 * milestone AND the expiring-trial referral nudge (gated <=2 days).
 * @param {string} plan - Plan tier
 */
export const testDay22_24 = async (plan = 'business') => {
  await setTrialDaysRemaining(2, plan);
  console.log('[TrialTest] Day 5 - Reminder + expiring-trial referral should show');
};

/**
 * Day 6 / Last chance — 1 day remaining. Triggers "Trial Ends Tomorrow"
 * with referral incentive.
 * @param {string} plan - Plan tier
 */
export const testDay27_28 = async (plan = 'business') => {
  await setTrialDaysRemaining(1, plan);
  console.log('[TrialTest] Day 6 - Last chance reminder should show');
};

/**
 * Set trial to expired (was a 7-day trial that ended 1 day ago).
 * @param {string} plan - Plan tier
 */
export const testDay30 = async (plan = 'business') => {
  try {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1); // ended 1 day ago

    const trialInfo = {
      active: true, // Still marked active so expiration message shows
      used: true,
      startDate: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate.toISOString(),
      plan: plan,
      durationDays: 7,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));
    await resetNotifications();
    console.log('[TrialTest] Set to expired - Expiration message should show');
  } catch (error) {
    console.error('[TrialTest] Error setting expired trial:', error);
  }
};

/**
 * Clear trial (no active trial)
 */
export const clearTrial = async () => {
  try {
    await AsyncStorage.removeItem(TRIAL_STORAGE_KEY);
    await AsyncStorage.removeItem('@pending_trial_notification');
    await resetNotifications();
    console.log('[TrialTest] Cleared trial and pending notifications');
  } catch (error) {
    console.error('[TrialTest] Error clearing trial:', error);
  }
};

/**
 * Set trial as expired (for testing referral popup)
 * This simulates a user whose trial has ended and has no subscription
 */
export const expireTrialForReferralTest = async () => {
  try {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 5); // 5 days ago (expired)

    const trialInfo = {
      active: false, // Trial is no longer active
      used: true,    // Trial has been used
      startDate: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate.toISOString(),
      plan: 'business',
      durationDays: 7,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));
    // Also clear any existing referral acceptance so popup can show
    await AsyncStorage.removeItem('@referral_accepted');
    console.log('[TrialTest] Trial expired for referral popup test');
    return true;
  } catch (error) {
    console.error('[TrialTest] Error expiring trial:', error);
    return false;
  }
};

/**
 * Get current trial info for debugging
 * @returns {Promise<Object|null>}
 */
export const getCurrentTrialInfo = async () => {
  try {
    const stored = await AsyncStorage.getItem(TRIAL_STORAGE_KEY);
    if (stored) {
      const trialInfo = JSON.parse(stored);
      const now = new Date().getTime();
      const endDate = new Date(trialInfo.endDate).getTime();
      const daysRemaining = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      
      return {
        ...trialInfo,
        daysRemaining: daysRemaining,
        isExpired: now > endDate,
      };
    }
    return null;
  } catch (error) {
    console.error('[TrialTest] Error getting trial info:', error);
    return null;
  }
};



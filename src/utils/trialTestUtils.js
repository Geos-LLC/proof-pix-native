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
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + daysRemaining);

    const trialInfo = {
      active: true,
      used: true,
      startDate: new Date(now.getTime() - (30 - daysRemaining) * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate.toISOString(),
      plan: plan,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));
    console.log(`[TrialTest] Set trial to ${daysRemaining} days remaining`);
    
    // Reset notifications so you can test them again
    await resetNotifications();
    console.log('[TrialTest] Reset notification flags');
  } catch (error) {
    console.error('[TrialTest] Error setting trial days:', error);
  }
};

/**
 * Set trial to Day 0 (Welcome message)
 * @param {string} plan - Plan tier
 */
export const testDay0 = async (plan = 'business') => {
  try {
    await setTrialDaysRemaining(29, plan);

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
 * Set trial to Day 7-10 (Engagement nudge)
 * @param {string} plan - Plan tier
 */
export const testDay7_10 = async (plan = 'business') => {
  await setTrialDaysRemaining(22, plan);
  console.log('[TrialTest] Set to Day 7-10 - Engagement message should show');
};

/**
 * Set trial to Day 15 (Mid-trial check-in)
 * @param {string} plan - Plan tier
 */
export const testDay15 = async (plan = 'business') => {
  await setTrialDaysRemaining(15, plan);
  console.log('[TrialTest] Set to Day 15 - Mid-trial check-in should show');
};

/**
 * Set trial to Day 22-24 (Early reminder)
 * @param {string} plan - Plan tier
 */
export const testDay22_24 = async (plan = 'business') => {
  await setTrialDaysRemaining(7, plan);
  console.log('[TrialTest] Set to Day 22-24 - Early reminder should show');
};

/**
 * Set trial to Day 27-28 (Last chance)
 * @param {string} plan - Plan tier
 */
export const testDay27_28 = async (plan = 'business') => {
  await setTrialDaysRemaining(2, plan);
  console.log('[TrialTest] Set to Day 27-28 - Last chance reminder should show');
};

/**
 * Set trial to Day 30 (Expired)
 * @param {string} plan - Plan tier
 */
export const testDay30 = async (plan = 'business') => {
  try {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 1); // 1 day ago (expired)

    const trialInfo = {
      active: true, // Still marked active so expiration message shows
      used: true,
      startDate: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: endDate.toISOString(),
      plan: plan,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));
    await resetNotifications();
    console.log('[TrialTest] Set to Day 30 - Expiration message should show');
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



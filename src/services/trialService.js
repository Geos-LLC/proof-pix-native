import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { logTrialEvent, logTrialStarted } from '../utils/analytics';

const TRIAL_STORAGE_KEY = '@user_trial_info';
const TRIAL_DURATION_DAYS = 15;
const REFERRAL_BONUS_DAYS = 15;

/**
 * Trial Service
 * Manages free trial for any tier (for new users)
 * 15-day trial on all platforms
 */

/**
 * Get trial information from storage
 * @returns {Promise<Object|null>} Trial info object or null
 */
export const getTrialInfo = async () => {
  try {
    const stored = await AsyncStorage.getItem(TRIAL_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  } catch (error) {
    console.error('[TrialService] Error getting trial info:', error);
    return null;
  }
};

/**
 * Check if user has already used the trial
 * @returns {Promise<boolean>} True if trial has been used
 */
export const hasUsedTrial = async () => {
  const trialInfo = await getTrialInfo();
  return trialInfo?.used === true;
};

/**
 * Check if trial is currently active
 * @returns {Promise<boolean>} True if trial is active
 */
export const isTrialActive = async () => {
  const trialInfo = await getTrialInfo();
  if (!trialInfo || !trialInfo.active) {
    return false;
  }

  // Check if trial has expired
  const now = new Date().getTime();
  const endDate = new Date(trialInfo.endDate).getTime();
  
  if (now > endDate) {
    // Trial expired, mark as inactive
    await setTrialInactive();
    return false;
  }

  return true;
};

/**
 * Check if user has an accepted referral code
 * @returns {Promise<boolean>} True if user has accepted referral
 */
const hasAcceptedReferral = async () => {
  try {
    const referralData = await AsyncStorage.getItem('@referral_accepted');
    return referralData !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Start a new trial for a specific plan tier
 * @param {string} plan - Plan tier (starter, pro, business, enterprise)
 * @param {number} durationDays - Optional duration in days (default: 30 or 45 with referral)
 * @returns {Promise<Object>} Trial info object
 */
export const startTrial = async (plan, durationDays = null) => {
  try {
    const now = new Date();
    const endDate = new Date(now);

    // Determine trial duration
    let trialDays = durationDays;
    let hasReferral = false;

    if (trialDays === null) {
      // Check if user has a referral code
      hasReferral = await hasAcceptedReferral();
      trialDays = hasReferral ? TRIAL_DURATION_DAYS + REFERRAL_BONUS_DAYS : TRIAL_DURATION_DAYS;
    }

    endDate.setDate(endDate.getDate() + trialDays);

    const trialInfo = {
      active: true,
      used: true,
      startDate: now.toISOString(),
      endDate: endDate.toISOString(),
      plan: plan, // Store which plan tier the trial is for
      durationDays: trialDays,
      hasReferral: hasReferral,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(trialInfo));

    console.log(`[TrialService] Started ${trialDays}-day trial for plan: ${plan}${hasReferral ? ' (with referral bonus)' : ''}`);

    // Analytics: trial started
    try {
      logTrialEvent('start', {
        plan,
        days_used: 0,
        days_remaining: trialDays,
      });
      // Canonical trial_started event per analytics spec
      logTrialStarted(plan, { days_remaining: trialDays });
    } catch (e) {
      // non‑critical
    }

    // Reset notification flags for new trial
    try {
      const { resetNotifications } = await import('./trialNotificationService');
      await resetNotifications();
    } catch (error) {
      console.error('[TrialService] Error resetting notifications:', error);
    }

    return trialInfo;
  } catch (error) {
    console.error('[TrialService] Error starting trial:', error);
    throw error;
  }
};

/**
 * Mark trial as inactive (expired or cancelled)
 * @returns {Promise<void>}
 */
export const setTrialInactive = async () => {
  try {
    const trialInfo = await getTrialInfo();
    if (trialInfo) {
      // Analytics: trial ended/expired
      try {
        const now = new Date().getTime();
        const start = new Date(trialInfo.startDate).getTime();
        const daysUsed = Math.max(0, Math.ceil((now - start) / (1000 * 60 * 60 * 24)));
        logTrialEvent('end', {
          plan: trialInfo.plan || 'unknown',
          days_used: daysUsed,
          days_remaining: 0,
        });
      } catch (e) {
        // non‑critical
      }
      const updated = {
        ...trialInfo,
        active: false,
      };
      await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(updated));
    }
  } catch (error) {
    console.error('[TrialService] Error setting trial inactive:', error);
  }
};

/**
 * Get days remaining in trial
 * @returns {Promise<number>} Days remaining (0 if expired or no trial)
 */
export const getTrialDaysRemaining = async () => {
  const trialInfo = await getTrialInfo();
  if (!trialInfo || !trialInfo.active) {
    return 0;
  }

  const now = new Date().getTime();
  const endDate = new Date(trialInfo.endDate).getTime();
  
  if (now > endDate) {
    await setTrialInactive();
    return 0;
  }

  const diffTime = endDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

/**
 * Check if user can start a trial
 * @returns {Promise<boolean>} True if trial can be started
 */
export const canStartTrial = async () => {
  const used = await hasUsedTrial();
  const active = await isTrialActive();
  return !used && !active;
};

// Plan tier hierarchy (higher index = higher tier)
const PLAN_TIERS = ['starter', 'pro', 'business', 'enterprise'];

const getPlanRank = (plan) => {
  const idx = PLAN_TIERS.indexOf(plan);
  return idx >= 0 ? idx : 0; // default to starter if unknown
};

/**
 * Get effective plan (higher of trial plan or actual plan)
 * @param {string} currentPlan - Current user plan
 * @returns {Promise<string>} Effective plan name
 */
export const getEffectivePlan = async (currentPlan) => {
  const trialActive = await isTrialActive();
  console.log('[getEffectivePlan] Called with currentPlan:', currentPlan, 'trialActive:', trialActive);
  if (trialActive) {
    const trialInfo = await getTrialInfo();
    console.log('[getEffectivePlan] Trial is active, trialInfo:', trialInfo);
    if (trialInfo?.plan) {
      // Return whichever plan is higher tier — never downgrade the user
      const currentRank = getPlanRank(currentPlan);
      const trialRank = getPlanRank(trialInfo.plan);
      const effective = currentRank >= trialRank ? currentPlan : trialInfo.plan;
      console.log('[getEffectivePlan] Comparing plans — current:', currentPlan, '(rank', currentRank + ') vs trial:', trialInfo.plan, '(rank', trialRank + ') → returning:', effective);
      return effective;
    }
  }
  console.log('[getEffectivePlan] No active trial, returning currentPlan:', currentPlan);
  return currentPlan;
};

/**
 * Get the plan tier that the trial is for
 * @returns {Promise<string|null>} Plan tier or null
 */
export const getTrialPlan = async () => {
  const trialInfo = await getTrialInfo();
  return trialInfo?.plan || null;
};

/**
 * Check if trial has expired and needs action
 * @returns {Promise<boolean>} True if trial expired and user needs to subscribe
 */
export const isTrialExpired = async () => {
  const trialInfo = await getTrialInfo();
  if (!trialInfo || !trialInfo.used) {
    return false;
  }

  const now = new Date().getTime();
  const endDate = new Date(trialInfo.endDate).getTime();

  return now > endDate;
};

/**
 * Extend trial by additional days (reward for referrals)
 * @param {number} additionalDays - Number of days to add
 * @returns {Promise<Object|null>} Updated trial info or null
 */
export const extendTrial = async (additionalDays) => {
  try {
    const trialInfo = await getTrialInfo();
    if (!trialInfo) {
      console.log('[TrialService] No trial to extend');
      return null;
    }

    const currentEndDate = new Date(trialInfo.endDate);
    const newEndDate = new Date(currentEndDate);
    newEndDate.setDate(newEndDate.getDate() + additionalDays);

    const updatedTrialInfo = {
      ...trialInfo,
      endDate: newEndDate.toISOString(),
      durationDays: (trialInfo.durationDays || 15) + additionalDays,
    };

    await AsyncStorage.setItem(TRIAL_STORAGE_KEY, JSON.stringify(updatedTrialInfo));

    console.log(`[TrialService] Trial extended by ${additionalDays} days. New end date: ${newEndDate.toISOString()}`);

    return updatedTrialInfo;
  } catch (error) {
    console.error('[TrialService] Error extending trial:', error);
    return null;
  }
};


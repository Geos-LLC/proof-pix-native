import AsyncStorage from '@react-native-async-storage/async-storage';
import { logReferralEvent } from '../utils/analytics';
import {
  getTrialDaysRemaining,
  isTrialActive,
} from './trialService';
import {
  getReferralStatsFromServer,
  getUserId,
} from './referralService';

// Gates the value-moment + expiring-trial referral nudges. Keeps every
// dismissal/shown flag in one file so eligibility logic stays cohesive.
const KEY_FIRST_REPORT_SHOWN = '@referral_prompt_first_report_shown';
const KEY_FIRST_REPORT_DISMISSED = '@referral_prompt_first_report_dismissed';
const KEY_REFERRAL_SCREEN_OPENED = '@referral_screen_opened_at_least_once';
const KEY_EXPIRING_TRIAL_LAST_SHOWN = '@referral_expiring_trial_last_shown';

const MAX_REFERRAL_REWARDS = 3;
const EXPIRING_TRIAL_THRESHOLD_DAYS = 2;

// Mounted by App.js. Screens call helpers in this file which in turn
// invoke this trigger; keeps the modal lifecycle owned by App.js while
// letting any screen request it without prop-drilling.
let promptTrigger = null;

export const registerReferralPromptTrigger = (fn) => {
  promptTrigger = fn;
};

export const unregisterReferralPromptTrigger = () => {
  promptTrigger = null;
};

const tryShow = (variant, context = {}) => {
  if (typeof promptTrigger === 'function') {
    promptTrigger({ variant, ...context });
    return true;
  }
  return false;
};

// Tracks whether the user ever reached the Referral screen so we
// don't keep nagging users who already discovered referrals.
export const markReferralScreenOpened = async () => {
  try {
    await AsyncStorage.setItem(KEY_REFERRAL_SCREEN_OPENED, '1');
  } catch (e) {
    // non-critical
  }
};

const hasOpenedReferralScreen = async () => {
  try {
    return (await AsyncStorage.getItem(KEY_REFERRAL_SCREEN_OPENED)) === '1';
  } catch (e) {
    return false;
  }
};

// ============================================================================
// Value-moment prompt — first successful report share/export
// ============================================================================

const isFirstReportPromptEligible = async () => {
  try {
    const [shown, dismissed, opened] = await Promise.all([
      AsyncStorage.getItem(KEY_FIRST_REPORT_SHOWN),
      AsyncStorage.getItem(KEY_FIRST_REPORT_DISMISSED),
      hasOpenedReferralScreen(),
    ]);
    return !shown && !dismissed && !opened;
  } catch (e) {
    return false;
  }
};

export const maybeShowFirstReportReferralPrompt = async () => {
  try {
    const eligible = await isFirstReportPromptEligible();
    if (!eligible) return false;

    const shown = tryShow('first_report');
    if (!shown) return false;

    await AsyncStorage.setItem(KEY_FIRST_REPORT_SHOWN, new Date().toISOString());
    logReferralEvent('prompt_shown', { context: 'first_report' });
    return true;
  } catch (e) {
    return false;
  }
};

export const markFirstReportPromptDismissed = async () => {
  try {
    await AsyncStorage.setItem(KEY_FIRST_REPORT_DISMISSED, new Date().toISOString());
    logReferralEvent('prompt_dismissed', { context: 'first_report' });
  } catch (e) {
    // non-critical
  }
};

export const markFirstReportPromptOpened = async () => {
  try {
    await AsyncStorage.setItem(KEY_FIRST_REPORT_DISMISSED, new Date().toISOString());
    logReferralEvent('prompt_opened', { context: 'first_report' });
  } catch (e) {
    // non-critical
  }
};

// ============================================================================
// Trial-ending prompt — <=2 days left, not subscribed, rewards remaining
// ============================================================================

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isExpiringTrialPromptEligible = async ({ userPlan } = {}) => {
  try {
    // Paying user → no need to push referral rewards
    if (userPlan && userPlan !== 'starter') return { eligible: false };

    const active = await isTrialActive();
    if (!active) return { eligible: false };

    const daysRemaining = await getTrialDaysRemaining();
    if (daysRemaining > EXPIRING_TRIAL_THRESHOLD_DAYS || daysRemaining <= 0) {
      return { eligible: false };
    }

    // Daily cap — once per UTC-ish day
    const lastShown = await AsyncStorage.getItem(KEY_EXPIRING_TRIAL_LAST_SHOWN);
    if (lastShown === todayKey()) return { eligible: false };

    // Available reward slots — completedInvites < 3 means the user can
    // still earn more trial days. Fall back to "show it" on network
    // error rather than punish the user for offline state.
    let availableRewards = MAX_REFERRAL_REWARDS;
    try {
      const userId = await getUserId();
      const stats = await getReferralStatsFromServer(userId);
      const completed = stats?.completedInvites || 0;
      availableRewards = Math.max(0, MAX_REFERRAL_REWARDS - completed);
    } catch (_) {
      // fall through with default
    }
    if (availableRewards <= 0) return { eligible: false };

    return { eligible: true, daysRemaining, availableRewards };
  } catch (e) {
    return { eligible: false };
  }
};

export const maybeShowExpiringTrialReferralPrompt = async ({ userPlan } = {}) => {
  try {
    const { eligible, daysRemaining, availableRewards } = await isExpiringTrialPromptEligible({ userPlan });
    if (!eligible) return false;

    const shown = tryShow('expiring_trial', { daysRemaining, availableRewards });
    if (!shown) return false;

    await AsyncStorage.setItem(KEY_EXPIRING_TRIAL_LAST_SHOWN, todayKey());
    logReferralEvent('expiring_trial_prompt_shown', {
      days_remaining: daysRemaining,
      available_rewards: availableRewards,
    });
    return true;
  } catch (e) {
    return false;
  }
};

export const markExpiringTrialInviteClicked = (daysRemaining) => {
  try {
    logReferralEvent('expiring_trial_invite_clicked', { days_remaining: daysRemaining });
  } catch (e) {
    // non-critical
  }
};

export const markExpiringTrialUpgradeClicked = (daysRemaining) => {
  try {
    logReferralEvent('expiring_trial_upgrade_clicked', { days_remaining: daysRemaining });
  } catch (e) {
    // non-critical
  }
};

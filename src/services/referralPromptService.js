import AsyncStorage from '@react-native-async-storage/async-storage';
import { logReferralEvent } from '../utils/analytics';

// Gates the value-moment referral nudge (first-report share). The
// expiring-trial variant was removed when the app-managed trial system was
// replaced by store-managed intro offers — we no longer track a client-side
// trial expiry we could gate a nudge on. If a store-trial-ending nudge is
// needed later, source the trigger from subscriptionInfoIOS.expirationDate.
const KEY_FIRST_REPORT_SHOWN = '@referral_prompt_first_report_shown';
const KEY_FIRST_REPORT_DISMISSED = '@referral_prompt_first_report_dismissed';
const KEY_REFERRAL_SCREEN_OPENED = '@referral_screen_opened_at_least_once';

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

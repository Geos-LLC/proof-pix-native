import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';
import { hasFeature, FEATURES } from '../constants/featurePermissions';

const LAST_SHARE_KEY = '@proofpix_last_share_at';
const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Decide if the current user is allowed to share now.
 *
 * Pro/Business/Enterprise/Team plans have FEATURES.UNLIMITED_SHARING and bypass
 * the limit. Starter plan is rate-limited to one share per 24h, tracked in
 * AsyncStorage under @proofpix_last_share_at.
 *
 * @param {string} effectivePlan - the user's effective plan (trial-aware)
 * @returns {Promise<{allowed: boolean, hoursRemaining: number}>}
 */
export const canShareNow = async (effectivePlan) => {
  if (hasFeature(FEATURES.UNLIMITED_SHARING, effectivePlan)) {
    return { allowed: true, hoursRemaining: 0 };
  }

  try {
    const raw = await AsyncStorage.getItem(LAST_SHARE_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (!last || Number.isNaN(last)) {
      return { allowed: true, hoursRemaining: 0 };
    }
    const elapsed = Date.now() - last;
    if (elapsed >= RATE_LIMIT_MS) {
      return { allowed: true, hoursRemaining: 0 };
    }
    const hoursRemaining = Math.ceil((RATE_LIMIT_MS - elapsed) / (60 * 60 * 1000));
    return { allowed: false, hoursRemaining };
  } catch {
    // On read failure, fail open — better to allow a share than to block legitimately.
    return { allowed: true, hoursRemaining: 0 };
  }
};

/**
 * Persist the timestamp of a successful share. Called by share handlers
 * after `Sharing.shareAsync` resolves successfully.
 */
export const recordShare = async () => {
  try {
    await AsyncStorage.setItem(LAST_SHARE_KEY, String(Date.now()));
  } catch {
    // non-critical
  }
};

/**
 * Show the rate-limit upgrade prompt and offer the user a path to upgrade.
 * Caller passes a `navigation` so we can route to PlanSelection on tap.
 */
export const showRateLimitAlert = ({ navigation, hoursRemaining, t }) => {
  const tr = t || ((_, opts) => opts?.defaultValue || _);
  const title = tr('share.rateLimitTitle', { defaultValue: 'Daily share limit reached' });
  const body = tr('share.rateLimitBody', {
    defaultValue: `Free plan allows one share every 24 hours. Try again in about ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}, or upgrade to Pro for unlimited sharing.`,
    hoursRemaining,
  });
  const upgradeBtn = tr('share.upgradeCTA', { defaultValue: 'Upgrade to Pro' });
  const okBtn = tr('common.ok', { defaultValue: 'OK' });

  Alert.alert(title, body, [
    {
      text: upgradeBtn,
      onPress: () => {
        try {
          if (navigation?.navigate) navigation.navigate('PlanSelection');
        } catch {}
      },
    },
    { text: okBtn, style: 'cancel' },
  ]);
};

/**
 * Convenience gate. Returns true if the share may proceed. If not, shows the
 * rate-limit alert and returns false. Caller is responsible for calling
 * `recordShare()` after a successful share.
 */
export const ensureShareAllowed = async ({ effectivePlan, navigation, t }) => {
  const { allowed, hoursRemaining } = await canShareNow(effectivePlan);
  if (allowed) return true;
  showRateLimitAlert({ navigation, hoursRemaining, t });
  return false;
};

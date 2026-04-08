import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@attribution_context';

/**
 * Save attribution context after a successful referral/admin code redemption.
 * Persists across app restarts. Only overwrite on a new valid redemption.
 *
 * @param {object} data
 *  - referral_code
 *  - link_type: 'admin' | 'user'
 *  - channel: e.g. 'instagram', 'facebook', 'flyer'
 *  - source: e.g. 'bio', 'story', 'dm'
 *  - campaign: e.g. 'launch_april', 'cleaners_test_1'
 *  - placement: optional
 */
export const saveAttributionContext = async (data) => {
  try {
    const context = {
      referral_code: data.referral_code || data.code || null,
      link_type: data.link_type || null,
      channel: data.channel || null,
      source: data.source || null,
      campaign: data.campaign || null,
      placement: data.placement || null,
      saved_at: new Date().toISOString(),
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    if (__DEV__) console.log('[Attribution] Saved:', context);
  } catch (error) {
    // Non-critical — don't break the app
    if (__DEV__) console.warn('[Attribution] Failed to save:', error?.message);
  }
};

/**
 * Read stored attribution context. Returns null if none saved or on error.
 */
export const getStoredAttributionContext = async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Merge stored attribution into an event params object.
 * Returns a new object with attribution fields added (if available).
 * Never throws — returns original params unchanged on any error.
 *
 * @param {object} params - existing event params
 * @returns {object} params enriched with attribution fields
 */
export const mergeAttributionContext = async (params = {}) => {
  try {
    const ctx = await getStoredAttributionContext();
    if (!ctx) return params;
    return {
      ...params,
      referral_code: ctx.referral_code || null,
      link_type: ctx.link_type || null,
      channel: ctx.channel || null,
      source: ctx.source || null,
      campaign: ctx.campaign || null,
      placement: ctx.placement || null,
    };
  } catch {
    return params;
  }
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PROXY_SERVER_URL } from '../config/proxy';

/**
 * Bonus Entitlement Service
 *
 * Client wrapper for the server-owned ProofPix bonus premium entitlement.
 * The bonus is a proxy-side, plan='pro' access window granted for referrals
 * (sender + receiver) and admin-referral redemptions. It is INDEPENDENT of
 * the Apple/Google introductory trial — the effective plan is:
 *
 *   effectivePlan = maxTier(store entitlement, bonus entitlement)
 *
 * Callers should not modify the store entitlement flow when consuming this;
 * simply OR the bonus into feature/plan checks.
 *
 * Bonus days are NEVER reported to Firebase/GA4 as a store trial and never
 * touch StoreKit/Play Billing. They exist only in proxy KV storage.
 */

const CACHE_STORAGE_KEY = '@bonus_entitlement_cache_v1';
const REFRESH_TIMEOUT_MS = 6000;

// In-flight de-dup + a tiny in-memory cache so repeated calls in the same
// render pass hit the network at most once.
let _inflight = null;
let _memory = null; // { bonusExpiresAt, bonusDaysGrantedTotal, isActive, cachedAt }

const _readCache = async () => {
  if (_memory) return _memory;
  try {
    const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _memory = parsed;
      return parsed;
    }
  } catch {}
  return null;
};

const _writeCache = async (state) => {
  _memory = state;
  try {
    await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(state));
  } catch {}
};

/**
 * Compute a fresh isActive flag from bonusExpiresAt without a network call.
 * Handles the case where the cache is warm but the bonus period has since
 * elapsed — callers reading `isActive` from cache should always run this.
 */
const _computeIsActive = (bonusExpiresAt) => {
  if (!bonusExpiresAt) return false;
  const t = new Date(bonusExpiresAt).getTime();
  return Number.isFinite(t) && t > Date.now();
};

const _getUserId = async () => {
  try {
    return await AsyncStorage.getItem('@user_id');
  } catch {
    return null;
  }
};

/**
 * Read the current bonus entitlement from cache without hitting the network.
 * Safe to call from render paths that must not await. Returns null before
 * refresh() has ever populated the cache.
 */
export const getCachedBonusEntitlement = () => {
  if (!_memory) return null;
  return {
    ..._memory,
    isActive: _computeIsActive(_memory.bonusExpiresAt),
  };
};

/**
 * Force-refresh from proxy. Idempotent under concurrent callers via _inflight.
 * On network error returns the previous cache (still with a fresh isActive)
 * so plan resolution degrades gracefully in offline / cold-launch conditions.
 *
 * @returns { bonusExpiresAt, bonusDaysGrantedTotal, isActive, cachedAt, stale? }
 */
export const refreshBonusEntitlement = async () => {
  if (_inflight) return _inflight;

  _inflight = (async () => {
    const userId = await _getUserId();
    if (!userId) {
      // Fresh install w/o userId: nothing to refresh; return whatever cache says.
      const cache = await _readCache();
      return cache
        ? { ...cache, isActive: _computeIsActive(cache.bonusExpiresAt) }
        : { bonusExpiresAt: null, bonusDaysGrantedTotal: 0, isActive: false, cachedAt: null };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      const url = `${PROXY_SERVER_URL}/api/entitlements/bonus?userId=${encodeURIComponent(userId)}`;
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const fresh = {
        bonusExpiresAt: data.bonusExpiresAt || null,
        bonusDaysGrantedTotal: data.bonusDaysGrantedTotal || 0,
        lastGrantAt: data.lastGrantAt || null,
        lastGrantReason: data.lastGrantReason || null,
        isActive: !!data.isActive,
        cachedAt: new Date().toISOString(),
      };
      await _writeCache(fresh);
      return fresh;
    } catch (error) {
      const cache = await _readCache();
      if (cache) {
        return {
          ...cache,
          isActive: _computeIsActive(cache.bonusExpiresAt),
          stale: true,
        };
      }
      return {
        bonusExpiresAt: null,
        bonusDaysGrantedTotal: 0,
        isActive: false,
        cachedAt: null,
        stale: true,
      };
    } finally {
      // Clear inflight in the next microtask so callers within the same
      // await stack still see the shared promise.
      Promise.resolve().then(() => { _inflight = null; });
    }
  })();

  return _inflight;
};

/**
 * True iff the bonus entitlement is currently active. Combines the cache
 * (for offline correctness) with a lazy network refresh on first call per
 * cold start. Reads never block on the network beyond REFRESH_TIMEOUT_MS.
 */
export const isBonusEntitlementActive = async () => {
  const cache = _memory || (await _readCache());
  if (cache && _computeIsActive(cache.bonusExpiresAt)) return true;
  const fresh = await refreshBonusEntitlement();
  return fresh.isActive;
};

/**
 * Days remaining in the current bonus window (0 when inactive). Rounds up
 * so a 4h remaining bonus still shows "1 day left" instead of "0 days".
 */
export const getBonusDaysRemaining = async () => {
  const cache = _memory || (await refreshBonusEntitlement());
  if (!cache?.bonusExpiresAt) return 0;
  const expiryMs = new Date(cache.bonusExpiresAt).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) return 0;
  return Math.max(1, Math.ceil((expiryMs - Date.now()) / (1000 * 60 * 60 * 24)));
};

/**
 * Read current bonus expiry (ISO string or null). Used by Settings UI to
 * render "Bonus premium until <date>" text.
 */
export const getBonusExpiresAt = async () => {
  const cache = _memory || (await refreshBonusEntitlement());
  return cache?.bonusExpiresAt || null;
};

/**
 * Legacy-trial migration hook. Called ONCE on the first cold start of the
 * new build to convert any remaining pre-migration in-app trial time into an
 * equivalent bonus entitlement — so users mid-trial when the app updates
 * don't lose the days they had left.
 *
 * Idempotent: server dedups on `legacy-trial-migration:${userId}` sourceId.
 * Safe to call more than once; second call is a no-op server-side.
 *
 * @param {number} daysRemaining — from legacy `@user_trial_info.endDate`
 * @returns granted amount (0 if userId missing or server rejected)
 */
export const grantLegacyTrialMigrationBonus = async (daysRemaining) => {
  try {
    const days = Number.parseInt(daysRemaining, 10);
    if (!Number.isFinite(days) || days <= 0) return 0;

    const userId = await _getUserId();
    if (!userId) return 0;

    const resp = await fetch(`${PROXY_SERVER_URL}/api/entitlements/bonus/grant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        days,
        reason: 'legacy_trial_migration',
        sourceId: `legacy-trial-migration:${userId}`,
      }),
    });
    if (!resp.ok) return 0;
    const data = await resp.json();
    // Refresh cache so downstream plan resolution sees the new bonus.
    await refreshBonusEntitlement();
    return data.granted || 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Clear the in-memory + AsyncStorage cache. Used from sign-out flows and
 * from dev-tools "reset entitlement" utilities so a stale cache from another
 * account doesn't leak into a fresh session.
 */
export const clearBonusEntitlementCache = async () => {
  _memory = null;
  _inflight = null;
  try {
    await AsyncStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {}
};

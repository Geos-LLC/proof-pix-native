import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  readSecureJSON,
  writeSecureJSON,
  readSecure,
  writeSecure,
} from './secureStorageService';
import {
  SOFT_TRIAL_EXPORT_LIMIT,
  SOFT_TRIAL_SECURE_KEY,
  SOFT_TRIAL_DEVICE_ID_KEY,
  SOFT_TRIAL_BLOCK_REASONS,
} from '../constants/softTrial';
import {
  logSoftTrialStarted,
  logSoftTrialCompleted,
  logSoftTrialBlocked,
  logFreeExportUsed,
} from '../utils/analytics';

/**
 * Starter Export Service (formerly "soft trial")
 *
 * Enforces the Starter (free) tier's export policy: watermark + low-res
 * export gating. Named "soft trial" originally but that was a misnomer —
 * this has NEVER been a time-based trial. Renamed for clarity as part of
 * the store-managed-trial migration.
 *
 * Watermark/low-res gating is now purely a function of the current
 * effectivePlan. Callers pass `effectivePlan` to shouldForceWatermark /
 * shouldUseLowResExport. The old design flipped a permanent
 * `soft_trial_used` flag when a store trial started, which permanently
 * removed watermark enforcement on Starter for users whose Apple trial
 * later expired — that bug is fixed here by ignoring the flag entirely.
 *
 * Storage: still uses `pp.soft_trial.v1` (SOFT_TRIAL_SECURE_KEY) as the
 * secure-storage key to preserve state across upgrades. The `soft_trial_used`
 * field remains in the on-disk shape as a vestigial marker (never read).
 *
 * Analytics event names (`soft_trial_started`, `soft_trial_completed`,
 * `soft_trial_blocked`, `free_export_used`) are preserved so existing
 * Firebase dashboards continue to work.
 */

const DEFAULT_STATE = {
  first_install_date: null,
  soft_trial_used: false, // vestigial — never read for gating post-migration
  exports_used: 0,
  started_at: null,
  completed_at: null,
};

let _stateCache = null;

const _readState = async () => {
  if (_stateCache) return _stateCache;
  const stored = await readSecureJSON(SOFT_TRIAL_SECURE_KEY);
  _stateCache = stored ? { ...DEFAULT_STATE, ...stored } : null;
  return _stateCache;
};

const _writeState = async (state) => {
  _stateCache = state;
  await writeSecureJSON(SOFT_TRIAL_SECURE_KEY, state);
};

/**
 * Initialize on app launch. Idempotent.
 *   First time  → writes initial state, fires `soft_trial_started`.
 *   Subsequent  → no-op.
 * Also migrates the legacy AsyncStorage @device_id into secure storage.
 */
export const initStarterExports = async () => {
  try {
    await ensureDeviceId();

    const existing = await _readState();
    if (existing) return existing;

    const now = new Date().toISOString();
    const fresh = {
      ...DEFAULT_STATE,
      first_install_date: now,
      started_at: now,
    };
    await _writeState(fresh);

    try {
      const deviceId = await ensureDeviceId();
      logSoftTrialStarted({ device_id: deviceId });
    } catch {}

    console.log('[StarterExports] initialized for new install');
    return fresh;
  } catch (e) {
    console.error('[StarterExports] init error:', e?.message);
    return null;
  }
};

export const getStarterExportsState = async () => {
  const s = await _readState();
  return s || DEFAULT_STATE;
};

export const getRemainingExports = async () => {
  const s = await _readState();
  if (!s) return SOFT_TRIAL_EXPORT_LIMIT;
  return Math.max(0, SOFT_TRIAL_EXPORT_LIMIT - s.exports_used);
};

/**
 * Should this export be watermarked?
 *
 * @param {string} effectivePlan — 'starter' | 'pro' | 'business' | 'enterprise'
 * @returns {boolean}
 */
export const shouldForceWatermark = (effectivePlan) =>
  effectivePlan === 'starter';

/**
 * Should this export be downscaled/compressed to the low-res preset?
 *
 * @param {string} effectivePlan — 'starter' | 'pro' | 'business' | 'enterprise'
 * @returns {boolean}
 */
export const shouldUseLowResExport = (effectivePlan) =>
  effectivePlan === 'starter';

/**
 * Convenience: single boolean for "should Starter restrictions apply".
 * Kept as a synchronous plan-derivation so context/consumers can compute
 * without an async read.
 *
 * @param {string} effectivePlan
 * @returns {boolean}
 */
export const isStarterExportGated = (effectivePlan) =>
  effectivePlan === 'starter';

/**
 * Returns { allowed, reason?, remaining }. The current SOFT_TRIAL_EXPORT_LIMIT
 * is a sentinel (1_000_000) so `allowed` is effectively always true today —
 * the plumbing is preserved so a real per-Starter export cap can be re-enabled
 * later without another migration.
 */
export const canExportNow = async () => {
  const s = await getStarterExportsState();
  if (s.exports_used >= SOFT_TRIAL_EXPORT_LIMIT) {
    return {
      allowed: false,
      reason: SOFT_TRIAL_BLOCK_REASONS.LIMIT_REACHED,
      remaining: 0,
    };
  }
  return {
    allowed: true,
    remaining: SOFT_TRIAL_EXPORT_LIMIT - s.exports_used,
  };
};

/**
 * Increment the export counter. Call only AFTER a successful share.
 * Fires `free_export_used` for analytics; hitting the sentinel limit fires
 * `soft_trial_completed`.
 */
export const recordExport = async () => {
  const s = await getStarterExportsState();
  const next = {
    ...s,
    exports_used: s.exports_used + 1,
  };
  const hitLimit = next.exports_used >= SOFT_TRIAL_EXPORT_LIMIT;
  if (hitLimit) {
    next.completed_at = new Date().toISOString();
  }
  await _writeState(next);

  try {
    logFreeExportUsed({
      exports_used: next.exports_used,
      remaining: Math.max(0, SOFT_TRIAL_EXPORT_LIMIT - next.exports_used),
    });
    if (hitLimit) {
      const deviceId = await ensureDeviceId();
      logSoftTrialCompleted({
        exports_used: next.exports_used,
        device_id: deviceId,
      });
    }
  } catch {}

  return next;
};

export const logBlocked = async (reason) => {
  try {
    const s = await getStarterExportsState();
    const deviceId = await ensureDeviceId();
    logSoftTrialBlocked({
      reason,
      exports_used: s.exports_used,
      device_id: deviceId,
    });
  } catch {}
};

/**
 * Resolve a stable device id. Migrates the legacy AsyncStorage @device_id
 * (used by referralService) into secure storage if present, otherwise
 * generates a fresh UUID. Mirrors the value back to AsyncStorage so existing
 * callers keep working.
 */
export const ensureDeviceId = async () => {
  let id = await readSecure(SOFT_TRIAL_DEVICE_ID_KEY);
  if (id) {
    try {
      const legacy = await AsyncStorage.getItem('@device_id');
      if (!legacy) await AsyncStorage.setItem('@device_id', id);
    } catch {}
    return id;
  }

  try {
    const legacy = await AsyncStorage.getItem('@device_id');
    if (legacy) {
      await writeSecure(SOFT_TRIAL_DEVICE_ID_KEY, legacy);
      return legacy;
    }
  } catch {}

  let uuid;
  try {
    uuid = Crypto.randomUUID ? Crypto.randomUUID() : null;
  } catch {}
  if (!uuid) {
    uuid = `dev_${Platform.OS}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
  await writeSecure(SOFT_TRIAL_DEVICE_ID_KEY, uuid);
  try {
    await AsyncStorage.setItem('@device_id', uuid);
  } catch {}
  return uuid;
};

/**
 * Dev-tools helper. Wipes state so QA can re-test the funnel.
 */
export const __resetStarterExportsForDev = async () => {
  if (!__DEV__) return;
  _stateCache = null;
  try {
    const { deleteSecure } = await import('./secureStorageService');
    await deleteSecure(SOFT_TRIAL_SECURE_KEY);
  } catch {}
  console.log('[StarterExports] state reset (dev only)');
};

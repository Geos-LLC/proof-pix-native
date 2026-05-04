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
 * Soft Trial state shape (stored in secure storage):
 * {
 *   first_install_date: ISO string,
 *   soft_trial_used: boolean,        // true once limit hit OR Apple trial started
 *   exports_used: number,
 *   started_at: ISO string,
 *   completed_at: ISO string | null
 * }
 */

const DEFAULT_STATE = {
  first_install_date: null,
  soft_trial_used: false,
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
 * Initialize soft trial on app launch. Idempotent.
 * - First time: writes initial state, fires soft_trial_started.
 * - Subsequent launches: no-op.
 *
 * Also ensures a stable device_id exists in secure storage, migrating from
 * AsyncStorage @device_id if present (from referralService).
 */
export const initSoftTrial = async () => {
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

    console.log('[SoftTrial] initialized for new install');
    return fresh;
  } catch (e) {
    console.error('[SoftTrial] init error:', e?.message);
    return null;
  }
};

export const getSoftTrialState = async () => {
  const s = await _readState();
  return s || DEFAULT_STATE;
};

export const isSoftTrialActive = async () => {
  const s = await _readState();
  if (!s) return false;
  return !s.soft_trial_used && s.exports_used < SOFT_TRIAL_EXPORT_LIMIT;
};

export const getRemainingExports = async () => {
  const s = await _readState();
  if (!s) return SOFT_TRIAL_EXPORT_LIMIT;
  if (s.soft_trial_used) return 0;
  return Math.max(0, SOFT_TRIAL_EXPORT_LIMIT - s.exports_used);
};

/**
 * Returns { allowed: boolean, reason?: string, remaining: number }.
 * Caller is responsible for blocking the action and routing to paywall on
 * `allowed: false`.
 */
export const canExportNow = async () => {
  const s = await getSoftTrialState();
  if (s.soft_trial_used) {
    return { allowed: false, reason: SOFT_TRIAL_BLOCK_REASONS.TRIAL_USED, remaining: 0 };
  }
  if (s.exports_used >= SOFT_TRIAL_EXPORT_LIMIT) {
    return { allowed: false, reason: SOFT_TRIAL_BLOCK_REASONS.LIMIT_REACHED, remaining: 0 };
  }
  return {
    allowed: true,
    remaining: SOFT_TRIAL_EXPORT_LIMIT - s.exports_used,
  };
};

/**
 * Increment the export counter. Call only AFTER a successful share. If this
 * was the final allowed export, marks soft_trial_used and fires
 * soft_trial_completed.
 */
export const recordExport = async () => {
  const s = await getSoftTrialState();
  const next = {
    ...s,
    exports_used: s.exports_used + 1,
  };
  const hitLimit = next.exports_used >= SOFT_TRIAL_EXPORT_LIMIT;
  if (hitLimit) {
    next.soft_trial_used = true;
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

/**
 * Mark the soft trial as used without incrementing the counter. Used when the
 * user starts the real Apple/Google trial — we never want to grant them
 * another soft trial after they've engaged the store.
 */
export const markSoftTrialUsed = async () => {
  const s = await getSoftTrialState();
  if (s.soft_trial_used) return s;
  const next = {
    ...s,
    soft_trial_used: true,
    completed_at: s.completed_at || new Date().toISOString(),
  };
  await _writeState(next);
  return next;
};

export const logBlocked = async (reason) => {
  try {
    const s = await getSoftTrialState();
    const deviceId = await ensureDeviceId();
    logSoftTrialBlocked({
      reason,
      exports_used: s.exports_used,
      device_id: deviceId,
    });
  } catch {}
};

export const shouldForceWatermark = async () => {
  return isSoftTrialActive();
};

export const shouldUseLowResExport = async () => {
  return isSoftTrialActive();
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
 * Dev-tools helper. Wipes soft trial state so QA can re-test the funnel.
 */
export const __resetSoftTrialForDev = async () => {
  if (!__DEV__) return;
  _stateCache = null;
  try {
    const { deleteSecure } = await import('./secureStorageService');
    await deleteSecure(SOFT_TRIAL_SECURE_KEY);
  } catch {}
  console.log('[SoftTrial] state reset (dev only)');
};

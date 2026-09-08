/**
 * Meta (Facebook) App Events — thin wrapper around react-native-fbsdk-next.
 *
 * Safe in Expo Go / missing-native builds: every export no-ops when the
 * native module isn't linked. Real events only fire in a production /
 * TestFlight / EAS-dev-client binary that includes the SDK.
 *
 * Naming matches Firebase events in analytics.js so Meta Ads can optimize
 * on the same funnel steps (see INTEGRATE_META.md).
 */

import { Platform } from 'react-native';

let AppEventsLogger = null;
let Settings = null;
let AEMReporterIOS = null;

try {
  const fb = require('react-native-fbsdk-next');
  AppEventsLogger = fb.AppEventsLogger;
  Settings = fb.Settings;
  AEMReporterIOS = fb.AEMReporterIOS;
} catch {
  // Native module missing (Expo Go / pre-rebuild). Stay silent.
}

const enabled = () => !!(AppEventsLogger && Settings) && !__DEV__;

/**
 * Call once after app launch (and again after ATT resolves on iOS).
 */
export async function initMetaSdk() {
  if (!Settings) return;
  try {
    Settings.initializeSDK();
    // Auto install / in-app events for Meta Ads optimization.
    Settings.setAutoLogAppEventsEnabled(true);
    Settings.setAdvertiserIDCollectionEnabled(true);
    if (Platform.OS === 'ios' && AEMReporterIOS?.enable) {
      AEMReporterIOS.enable();
    }
    if (__DEV__) console.log('[Meta] SDK initialized');
  } catch (err) {
    console.warn('[Meta] init failed:', err?.message || err);
  }
}

/**
 * Reflect ATT authorization into Meta advertiser tracking flag (iOS 14+).
 * @param {boolean} allowed
 */
export function setMetaAdvertiserTracking(allowed) {
  if (!Settings?.setAdvertiserTrackingEnabled) return;
  try {
    Settings.setAdvertiserTrackingEnabled(!!allowed);
  } catch {
    // non-critical
  }
}

function logMetaEvent(name, params = {}) {
  if (!enabled() || !AppEventsLogger?.logEvent) return;
  try {
    // Flatten to string/number values Meta accepts.
    const clean = {};
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      if (typeof v === 'boolean') clean[k] = v ? 1 : 0;
      else if (typeof v === 'number' || typeof v === 'string') clean[k] = v;
      else clean[k] = String(v);
    });
    AppEventsLogger.logEvent(name, clean);
  } catch (err) {
    if (__DEV__) console.warn('[Meta] logEvent failed:', name, err?.message || err);
  }
}

export const metaLogFirstOpen = () => logMetaEvent('first_open');

export const metaLogAccountCreated = (params = {}) =>
  logMetaEvent('account_created', {
    method: params.method,
    plan: params.plan,
  });

export const metaLogPhotoSave = (params = {}) =>
  logMetaEvent('photo_save', {
    has_labels: params.has_labels,
  });

export const metaLogPhotoExport = (params = {}) =>
  logMetaEvent('photo_export', {
    export_type: params.export_type,
  });

export const metaLogTrialStart = (params = {}) =>
  logMetaEvent('trial_start', {
    plan: params.plan || params.plan_id,
  });

export const metaLogTeamInvite = (params = {}) =>
  logMetaEvent('team_invite', {
    count: params.count,
  });

/** Standard Meta Subscribe event (not Purchase — revenue stays server-side). */
export const metaLogSubscribe = (params = {}) => {
  if (!enabled() || !AppEventsLogger?.logEvent) return;
  try {
    AppEventsLogger.logEvent('Subscribe', {
      fb_order_id: params.transaction_id || undefined,
      fb_currency: params.currency || 'USD',
    });
  } catch {
    // non-critical
  }
};

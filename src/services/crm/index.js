/**
 * CRM service — facade + adapter registry. Every UI surface that
 * talks to a CRM goes through this module so we never reference
 * a specific adapter by name outside this folder.
 *
 *   import crmService from '../services/crm';
 *   const jobs = await crmService.listJobs({ status: 'active' });
 *
 * `getActiveAdapter()` reads the persisted "active CRM" id from
 * settings/storage; null means no CRM connected, in which case all
 * higher-level helpers no-op gracefully.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import serviceFlowAdapter from './serviceFlowAdapter';

// Storage key for the user's currently-selected CRM. Single-active
// model for now: a user connects one CRM at a time. Multi-CRM would
// require a per-project override in the future.
const ACTIVE_CRM_KEY = '@active_crm_provider';

// Sentinel that survives only within a single install. iOS Keychain
// (where adapters persist refresh tokens) survives reinstall, but
// AsyncStorage doesn't — when this key is missing on boot, the app
// is freshly installed and any CRM credentials still in Keychain are
// orphans from a previous install. We wipe them so the user sees a
// clean "Not connected" state instead of a phantom connected one.
const FRESH_INSTALL_SENTINEL_KEY = '@crm_install_marker';

// Registry — append here when adding a new adapter. Order matters
// only for the Settings UI render order.
export const ADAPTERS = [
  serviceFlowAdapter,
];

const byId = new Map(ADAPTERS.map(a => [a.constructor.id, a]));

// One-shot guard so the fresh-install check only runs once per
// process. Held in module scope; reset on app cold start.
let _freshInstallChecked = false;
const _ensureFreshInstallCheck = async () => {
  if (_freshInstallChecked) return;
  _freshInstallChecked = true;
  let marker = null;
  try { marker = await AsyncStorage.getItem(FRESH_INSTALL_SENTINEL_KEY); } catch {}
  if (marker) return;
  // Fresh install — wipe every adapter's credentials. Each adapter's
  // disconnect() is best-effort and idempotent, so calling on an
  // adapter that has no Keychain entries is safe.
  for (const adapter of ADAPTERS) {
    try { await adapter.disconnect(); } catch {}
  }
  try { await AsyncStorage.setItem(FRESH_INSTALL_SENTINEL_KEY, String(Date.now())); } catch {}
};

const getActiveProviderId = async () => {
  await _ensureFreshInstallCheck();
  try { return await AsyncStorage.getItem(ACTIVE_CRM_KEY); }
  catch { return null; }
};

const setActiveProviderId = async (id) => {
  if (id) await AsyncStorage.setItem(ACTIVE_CRM_KEY, id);
  else await AsyncStorage.removeItem(ACTIVE_CRM_KEY);
};

const getActiveAdapter = async () => {
  const id = await getActiveProviderId();
  if (!id) return null;
  return byId.get(id) || null;
};

const listAdapters = () => ADAPTERS.map(a => ({
  id: a.constructor.id,
  displayName: a.constructor.displayName,
  icon: a.constructor.icon,
}));

// ──────────────── facade methods ─────────────────────────────────
// Higher-level helpers that resolve the active adapter and forward
// the call. Return null / [] when no CRM is connected so callers
// don't have to guard.

const connect = async (providerId, options) => {
  const adapter = byId.get(providerId);
  if (!adapter) throw new Error(`Unknown CRM provider: ${providerId}`);
  const result = await adapter.connect(options);
  if (result?.success) await setActiveProviderId(providerId);
  return result;
};

const disconnect = async () => {
  // Walk every adapter, not just the "active" one. AsyncStorage
  // tracks the active provider, but Keychain may hold tokens for
  // adapters that the AsyncStorage pointer has lost track of (e.g.
  // after a reinstall, or if a previous disconnect cleared the
  // pointer but failed mid-way through Keychain cleanup). Looping
  // guarantees every adapter's secure storage is wiped.
  for (const adapter of ADAPTERS) {
    try { await adapter.disconnect(); } catch {}
  }
  await setActiveProviderId(null);
};

const validateConnection = async () => {
  const adapter = await getActiveAdapter();
  if (!adapter) return false;
  try { return await adapter.validateConnection(); } catch { return false; }
};

const listJobs = async (filter) => {
  const adapter = await getActiveAdapter();
  if (!adapter) return [];
  try { return await adapter.listJobs(filter); } catch { return []; }
};

const attachPhoto = async (jobId, photo) => {
  const adapter = await getActiveAdapter();
  if (!adapter) return { success: false, error: 'NO_CRM_CONNECTED' };
  return adapter.attachPhoto(jobId, photo);
};

const attachPhotoBatch = async (jobId, photos) => {
  const adapter = await getActiveAdapter();
  if (!adapter) return photos.map(() => ({ success: false, error: 'NO_CRM_CONNECTED' }));
  return adapter.attachPhotoBatch(jobId, photos);
};

export default {
  ADAPTERS,
  listAdapters,
  getActiveProviderId,
  getActiveAdapter,
  connect,
  disconnect,
  validateConnection,
  listJobs,
  attachPhoto,
  attachPhotoBatch,
};

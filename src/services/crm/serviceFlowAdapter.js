/**
 * Service Flow CRM adapter — first concrete implementation of
 * BaseCRMAdapter. Targets the Service Flow backend's
 * `/api/integrations/proofpix/*` namespace (PR 1 is live on staging
 * — see docs/SERVICE_FLOW_INTEGRATION.md for the full contract).
 *
 * Phase 1 (now): admin-only. Admin generates a connect code in the
 * Service Flow web UI, pastes it into ProofPix, the adapter calls
 * /connect/code/redeem and persists the refresh token in Keychain.
 * All subsequent calls happen straight from the device.
 *
 * Phase 2 (later): team members. The Railway proxy stores the
 * admin's refresh token and team members upload through the proxy.
 * The adapter base URL gets swapped from SF-direct to the proxy and
 * the access-token refresh logic moves into the proxy.
 */

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BaseCRMAdapter } from './crmAdapter';
import {
  readSecure,
  writeSecure,
  deleteSecure,
  readSecureJSON,
  writeSecureJSON,
} from '../secureStorageService';

// SF backend base URL. Staging today; swap to prod once PR 1 is live
// in prod. Env-overridable so QA / future builds can point at any
// SF environment without a code change.
// SF backend base URL. Flipped from staging (303f) to prod (4568) on
// 2026-07-23 — SF unified backend deploys on `main` branch and the
// staging URL fell behind (missing new endpoints, e.g. /connect/token
// /status). Env-overridable so QA can point at staging or a preview
// deployment when needed.
const SF_BASE = process.env.EXPO_PUBLIC_SERVICEFLOW_URL
  || 'https://service-flow-backend-production-4568.up.railway.app';

const SECURE_KEYS = {
  refreshToken: 'serviceflow.refresh_token',
  workspace: 'serviceflow.workspace',
};

// In-memory access-token cache. Expires_in is honoured with a 60s
// safety margin so we always refresh before the server rejects.
let _accessTokenCache = { token: null, expiresAt: 0 };

const apiUrl = (path) => `${SF_BASE}/api/integrations/proofpix${path}`;

// Dedupe comma-separated address segments case-insensitively, in
// order. Workaround for SF tenants with denormalised job rows
// (service_address_street already contains the full address while
// state/zip are also populated, producing "…, MI 48301, USA, MI 48301").
// Safe no-op when address is null/empty.
const dedupAddress = (raw) => {
  if (!raw || typeof raw !== 'string') return raw || null;
  const parts = raw.split(/,\s*/).map(p => p.trim()).filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  return unique.join(', ');
};

const parseErrorEnvelope = async (response) => {
  let rawText = '';
  try {
    rawText = await response.text();
    const body = rawText ? JSON.parse(rawText) : null;
    if (body?.error) {
      const err = new Error(body.error.message || 'Service Flow error');
      err.code = body.error.code;
      err.retryable = !!body.error.retryable;
      err.retryAfterSeconds = body.error.retry_after_seconds || null;
      // Surface the full server message + any structured details to the
      // tagged log so we can see WHY SF rejected when the code alone
      // (e.g. INVALID_PAYLOAD) doesn't say which field was wrong.
      console.warn('[CRM-Adapter] error envelope', {
        status: response.status,
        code: err.code || null,
        message: body.error.message || null,
        details: body.error.details || null,
        retryable: err.retryable,
      });
      return err;
    }
    console.warn('[CRM-Adapter] error w/o envelope', { status: response.status, body_sample: rawText.slice(0, 300) });
  } catch (e) {
    console.warn('[CRM-Adapter] error body parse failed', { status: response.status, msg: e?.message, raw: rawText.slice(0, 300) });
  }
  return new Error(`Service Flow ${response.status}`);
};

class ServiceFlowAdapter extends BaseCRMAdapter {
  static id = 'serviceflow';
  static displayName = 'Service Flow';
  static icon = 'briefcase-outline';

  /**
   * Redeem a credential and persist the resulting refresh token +
   * workspace metadata. Accepts either:
   *   - `code`: the 16-char human-readable QR/paste code (legacy
   *     surface — admin generated in SF web at a laptop, scanned/
   *     typed on the phone)
   *   - `token`: the URL-safe base64url token from the SF web/PWA
   *     /authorize redirect (new same-device surface)
   *
   * Same redemption endpoint either way — SF backend discriminates
   * by shape (hyphenated uppercase = code; base64url-clean = token).
   *
   * @param {{ code?: string, token?: string, deviceLabel?: string }} options
   * @returns {Promise<ConnectResult>}
   */
  async connect({ code, token, deviceLabel = 'ProofPix mobile' } = {}) {
    const credential = code || token;
    if (!credential) return { success: false, error: 'INVALID_PAYLOAD' };

    // Enrich the redemption payload with device + role metadata so the
    // SF dashboard can surface "who paired what, from where" without
    // relying on the free-text device_label. SF backend picks these up
    // additively — legacy pairs stay label-only until they re-pair.
    // Every lookup is best-effort; a missing field just omits it from
    // the body rather than blocking the connect.
    let device_model = null;
    let os_name = null;
    let os_version = null;
    let role = null;
    let paired_by_proofpix_user_id = null;
    let paired_by_name = null;
    let paired_by_email = null;
    try { device_model = Device.modelName || null; } catch {}
    try { os_name = Device.osName || (Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS); } catch {}
    try {
      os_version = Device.osVersion || (Platform.Version != null ? String(Platform.Version) : null);
    } catch {}
    try {
      const mode = await AsyncStorage.getItem('@admin_user_mode');
      // Normalise for SF: 'admin' | 'team_member' | 'individual' | null
      role = mode || null;
    } catch {}

    // Identity of the ProofPix user completing the pair. SF renders this
    // as the owner label next to each paired device row. Admin/individual
    // paths carry a Google/Apple sign-in blob at @admin_user_info; team
    // members joined via invite code and only have a session id + local
    // display name from app-settings. Every field is optional — SF stores
    // null when absent, so a partial lookup never blocks the connect.
    try {
      const raw = await AsyncStorage.getItem('@admin_user_info');
      if (raw) {
        const info = JSON.parse(raw);
        if (info?.id != null) paired_by_proofpix_user_id = String(info.id);
        if (info?.name) paired_by_name = String(info.name);
        if (info?.email) paired_by_email = String(info.email);
      }
    } catch {}
    if (role === 'team_member') {
      // Team members: no Google identity on device. Fall back to the
      // proxy session id (stable per join) and the name the member
      // typed during setup.
      if (!paired_by_proofpix_user_id) {
        try {
          const teamInfo = await readSecureJSON('@team_member_info');
          if (teamInfo?.sessionId) paired_by_proofpix_user_id = String(teamInfo.sessionId);
        } catch {}
      }
      if (!paired_by_name) {
        try {
          const stored = await AsyncStorage.getItem('app-settings');
          const settings = stored ? JSON.parse(stored) : null;
          if (settings?.userName) paired_by_name = String(settings.userName);
        } catch {}
      }
    }
    // Enforce spec max lengths (64 / 200 / 200) defensively so a stray
    // long value never trips SF's payload validation.
    if (paired_by_proofpix_user_id) paired_by_proofpix_user_id = paired_by_proofpix_user_id.slice(0, 64);
    if (paired_by_name) paired_by_name = paired_by_name.slice(0, 200);
    if (paired_by_email) paired_by_email = paired_by_email.slice(0, 200);

    const payload = {
      code: credential,
      device_label: deviceLabel,
    };
    if (device_model) payload.device_model = device_model;
    if (os_name) payload.os_name = os_name;
    if (os_version) payload.os_version = os_version;
    if (role) payload.role = role;
    if (paired_by_proofpix_user_id) payload.paired_by_proofpix_user_id = paired_by_proofpix_user_id;
    if (paired_by_name) payload.paired_by_name = paired_by_name;
    if (paired_by_email) payload.paired_by_email = paired_by_email;

    const response = await fetch(apiUrl('/connect/redeem'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const err = await parseErrorEnvelope(response);
      return { success: false, error: err.code || err.message };
    }
    const body = await response.json();
    // Persist refresh token in Keychain — survives iOS reinstall,
    // not exposed to JS bridges outside this module.
    await writeSecure(SECURE_KEYS.refreshToken, body.refresh_token);
    const workspace = {
      provider: ServiceFlowAdapter.id,
      workspaceId: body.workspace_id,
      workspaceName: body.workspace_name,
      adminUserId: body.admin_user_id,
      connectedAt: Date.now(),
    };
    await writeSecureJSON(SECURE_KEYS.workspace, workspace);
    _accessTokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    };

    // Push the SF refresh token to the proxy so team members can
    // list SF jobs + have uploads fanned out to SF without ever
    // holding SF credentials on their device. Best-effort — a failed
    // push leaves the local connection working; team-member sync
    // just stays "not connected" until admin reconnects.
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const proxySessionId = await AsyncStorage.getItem('@proxy_session_id');
      if (proxySessionId && body.refresh_token) {
        const proxyService = require('../proxyService').default;
        await proxyService.setServiceFlowCredentials(
          proxySessionId,
          body.refresh_token,
          body.workspace_id,
          body.workspace_name,
        );
        console.warn('[SF-Adapter] pushed refresh token to proxy', {
          proxySessionId,
          workspaceId: body.workspace_id,
        });
      }
    } catch (proxyErr) {
      console.warn('[SF-Adapter] proxy credential push failed (continuing):', proxyErr?.message);
    }

    return { success: true, connection: workspace };
  }

  /**
   * Get a valid access token. Returns the cached one when still
   * fresh; otherwise calls /connect/refresh against the stored
   * refresh token. Returns null when no connection exists or the
   * refresh fails (caller should mark disconnected and prompt
   * reconnect).
   */
  async _getAccessToken() {
    if (_accessTokenCache.token && _accessTokenCache.expiresAt > Date.now()) {
      return _accessTokenCache.token;
    }
    const refreshToken = await readSecure(SECURE_KEYS.refreshToken);
    if (!refreshToken) return null;
    const response = await fetch(apiUrl('/connect/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!response.ok) {
      // Refresh failed — token revoked or torn. Caller treats this
      // the same as "not connected" — surface a reconnect prompt.
      return null;
    }
    const body = await response.json();
    _accessTokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in - 60) * 1000,
    };
    return body.access_token;
  }

  async validateConnection() {
    const token = await this._getAccessToken();
    if (!token) return false;
    try {
      const response = await fetch(apiUrl('/connection/status'), {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return false;
      const body = await response.json();
      return !!body.valid;
    } catch {
      return false;
    }
  }

  async disconnect() {
    const token = await this._getAccessToken();
    // Best-effort server revoke; idempotent on the SF side.
    if (token) {
      try {
        await fetch(apiUrl('/connection'), {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
      } catch {}
    }
    _accessTokenCache = { token: null, expiresAt: 0 };
    try { await deleteSecure(SECURE_KEYS.refreshToken); } catch {}
    try { await deleteSecure(SECURE_KEYS.workspace); } catch {}

    // Mirror the connect flow: also clear SF credentials on the
    // proxy so team members stop seeing SF jobs after admin
    // disconnects. Best-effort — proxy-only cleanup failure doesn't
    // block the local disconnect.
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const proxySessionId = await AsyncStorage.getItem('@proxy_session_id');
      if (proxySessionId) {
        const proxyService = require('../proxyService').default;
        await proxyService.clearServiceFlowCredentials(proxySessionId);
      }
    } catch (proxyErr) {
      console.warn('[SF-Adapter] proxy credential clear failed (continuing):', proxyErr?.message);
    }
  }

  /**
   * Helper used by Settings / project-link UI to render the current
   * connection without hitting the network.
   */
  async getStoredWorkspace() {
    return readSecureJSON(SECURE_KEYS.workspace);
  }

  /**
   * Return the raw refresh token so the proxy can be handed SF creds
   * when the admin sets up an SF-primary team session (no Google
   * required). Only used by AdminContext.initializeProxySession; UI
   * code should keep going through crmService.
   */
  async getRefreshTokenForProxy() {
    return readSecure(SECURE_KEYS.refreshToken);
  }

  /**
   * List jobs the admin can attach photos to. Used by the
   * project-create job picker.
   *
   * @param {{ status?: 'active'|'all'|'completed'|'cancelled'|'scheduled',
   *           search?: string,
   *           limit?: number,
   *           cursor?: string }} [filter]
   * @returns {Promise<{ jobs: Job[], nextCursor: string|null }>}
   *
   * Returns an empty list (not an error) when not connected or when
   * the server returns no rows, so the picker can render an empty
   * state without special-casing.
   */
  async listJobs(filter = {}) {
    const token = await this._getAccessToken();
    if (!token) return { jobs: [], nextCursor: null };

    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.search) params.set('search', filter.search);
    if (filter.limit) params.set('limit', String(filter.limit));
    if (filter.cursor) params.set('cursor', filter.cursor);
    const query = params.toString();
    const url = apiUrl(`/jobs${query ? `?${query}` : ''}`);

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      const err = await parseErrorEnvelope(response);
      // Surface as a thrown error for the caller to catch — the
      // facade in crm/index.js will swallow into an empty list for
      // most callers, but UI surfaces that want to show "couldn't
      // load jobs, retry" can adapter-call directly.
      throw err;
    }
    const body = await response.json();
    const jobs = (body.jobs || []).map((row) => ({
      id: row.id,
      title: row.title || '',
      customerName: row.customer_name || null,
      // Light defensive cleanup for the addresses SF returns —
      // some tenants have denormalised rows that produce duplicate
      // segments ("…, MI 48301, USA, MI 48301"). Drop consecutive
      // and far-apart duplicates while preserving order. Cheap, and
      // means the picker doesn't look weird until SF normalises
      // server-side.
      address: dedupAddress(row.address),
      status: row.status || null,
      scheduledAt: typeof row.scheduled_at === 'number' ? row.scheduled_at : null,
      photoCount: typeof row.photo_count === 'number' ? row.photo_count : 0,
    }));
    return { jobs, nextCursor: body.next_cursor || null };
  }

  /**
   * Attach a single photo to a Service Flow job. Called from
   * backgroundUploadService after the local save completes.
   *
   * Service Flow dedupes by `proofpix_photo_id` for ≥24h, so this
   * is safe to retry indefinitely. The adapter normalises the
   * 409 "already attached" response into a `success: true` result
   * with `alreadyExisted: true` — the photo IS on the job either
   * way, the caller just gets a flag to skip any follow-up
   * "uploaded for the first time" work.
   *
   * @param {string} jobId
   * @param {PhotoPayload} photo
   * @returns {Promise<AttachResult>}
   */
  async attachPhoto(jobId, photo) {
    if (!jobId) return { success: false, error: 'INVALID_PAYLOAD' };
    if (!photo?.id) return { success: false, error: 'INVALID_PAYLOAD' };
    if (!photo?.localUri) return { success: false, error: 'INVALID_PAYLOAD' };

    const mimeType = photo.mimeType || 'image/jpeg';
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
      // Service Flow only accepts jpeg/png. HEIC has to be
      // transcoded by the caller before reaching this layer —
      // failing here gives a clear signal instead of letting the
      // server return a generic 400.
      return {
        success: false,
        error: 'UNSUPPORTED_MIME',
        retryable: false,
      };
    }

    const token = await this._getAccessToken();
    if (!token) return { success: false, error: 'NOT_CONNECTED' };

    const formData = new FormData();
    // React Native multipart file shape — { uri, name, type }. The
    // RN fetch polyfill streams the file from disk so we never
    // materialise it in JS heap.
    formData.append('file', {
      uri: photo.localUri,
      name: photo.filename || `${photo.id}.jpg`,
      type: mimeType,
    });
    // Build the metadata sidecar. SF requires non-null values for
    // most fields — `undefined` values are dropped by JSON.stringify
    // and SF then rejects with INVALID_PAYLOAD. Coerce to safe
    // defaults so the field is always present in the serialised JSON.
    //
    // mode normalisation: ProofPix uses 'mix' internally for combined
    // before/after composites; SF's contract names that mode
    // 'combined' (see docs/SERVICE_FLOW_INTEGRATION.md §5 — the
    // accepted set is 'before' | 'after' | 'progress' | 'combined').
    // Translate at the boundary; everything else passes through.
    const normaliseMode = (m) => {
      if (m === 'mix' || m === 'combined') return 'combined';
      if (m === 'before' || m === 'after' || m === 'progress') return m;
      return 'before'; // safe default — SF rejects unknown values
    };
    const metadata = {
      filename: photo.filename || `${photo.id}.jpg`,
      mode: normaliseMode(photo.mode),
      room: photo.room || 'unsorted',
      timestamp: typeof photo.timestamp === 'number' ? photo.timestamp : Date.now(),
      gps: photo.gps || null,
      captured_by: photo.capturedBy || null,
      notes: typeof photo.notes === 'string' ? photo.notes : '',
      proofpix_photo_id: String(photo.id),
      proofpix_project_id: photo.projectId ? String(photo.projectId) : null,
    };
    console.warn('[CRM-Adapter] attach payload', {
      jobId,
      meta_keys: Object.keys(metadata),
      mode: metadata.mode,
      room: metadata.room,
      has_timestamp: typeof metadata.timestamp === 'number',
      proofpix_photo_id: metadata.proofpix_photo_id,
      file_uri_kind: typeof photo.localUri === 'string' && photo.localUri.startsWith('file://') ? 'file' : 'other',
    });
    formData.append('metadata', JSON.stringify(metadata));

    let response;
    try {
      response = await fetch(apiUrl(`/jobs/${encodeURIComponent(jobId)}/photos`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
    } catch (e) {
      // Network failure — treat as retryable so the upload queue
      // re-tries on the next cycle.
      return {
        success: false,
        error: e?.message || 'NETWORK_ERROR',
        retryable: true,
      };
    }

    // Both 200 and 409 carry the same { success, crm_photo_id,
    // photo_url } shape; 409 means dedup hit and the photo is
    // already on the job — same end state, just no new write.
    if (response.ok || response.status === 409) {
      const body = await response.json();
      console.warn('[CRM-Adapter] attach OK', {
        status: response.status,
        dedup: response.status === 409,
        crm_photo_id: body?.crm_photo_id || null,
        photo_url: body?.photo_url || null,
        proofpix_photo_id: metadata.proofpix_photo_id,
      });
      return {
        success: true,
        crmPhotoId: body.crm_photo_id,
        photoUrl: body.photo_url,
        alreadyExisted: response.status === 409,
      };
    }

    // 413 (oversize), 400 (bad mime / missing metadata), 401
    // (revoked), 404 (job deleted), 429 (rate limited) — surface
    // with the SF error envelope so the caller can decide.
    const err = await parseErrorEnvelope(response);
    return {
      success: false,
      error: err.code || err.message,
      retryable: err.retryable || response.status === 429 || response.status >= 500,
    };
  }
}

export default new ServiceFlowAdapter();

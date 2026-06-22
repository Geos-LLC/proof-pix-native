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
const SF_BASE = process.env.EXPO_PUBLIC_SERVICEFLOW_URL
  || 'https://service-flow-backend-staging-303f.up.railway.app';

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
  try {
    const body = await response.json();
    if (body?.error) {
      const err = new Error(body.error.message || 'Service Flow error');
      err.code = body.error.code;
      err.retryable = !!body.error.retryable;
      err.retryAfterSeconds = body.error.retry_after_seconds || null;
      return err;
    }
  } catch {}
  return new Error(`Service Flow ${response.status}`);
};

class ServiceFlowAdapter extends BaseCRMAdapter {
  static id = 'serviceflow';
  static displayName = 'Service Flow';
  static icon = 'briefcase-outline';

  /**
   * Redeem a connect code the admin generated in the Service Flow
   * web UI. Persists the refresh token in Keychain + workspace
   * metadata.
   * @param {{ code: string, deviceLabel?: string }} options
   * @returns {Promise<ConnectResult>}
   */
  async connect({ code, deviceLabel = 'ProofPix mobile' } = {}) {
    if (!code) return { success: false, error: 'INVALID_PAYLOAD' };
    const response = await fetch(apiUrl('/connect/code/redeem'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_label: deviceLabel }),
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
  }

  /**
   * Helper used by Settings / project-link UI to render the current
   * connection without hitting the network.
   */
  async getStoredWorkspace() {
    return readSecureJSON(SECURE_KEYS.workspace);
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

  async attachPhoto(jobId, photo) {
    // Pending PR 3 (POST /jobs/:jobId/photos) on the SF backend.
    throw new Error('ServiceFlowAdapter.attachPhoto — pending PR 3');
  }
}

export default new ServiceFlowAdapter();

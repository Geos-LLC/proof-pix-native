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

  async listJobs(filter) {
    // Pending PR 2 (GET /jobs) on the SF backend.
    throw new Error('ServiceFlowAdapter.listJobs — pending PR 2');
  }

  async attachPhoto(jobId, photo) {
    // Pending PR 3 (POST /jobs/:jobId/photos) on the SF backend.
    throw new Error('ServiceFlowAdapter.attachPhoto — pending PR 3');
  }
}

export default new ServiceFlowAdapter();

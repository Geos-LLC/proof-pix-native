/**
 * Proxy Service
 * Handles communication with the ProofPix proxy server
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PROXY_SERVER_URL } from '../config/proxy';
import googleAuthService from './googleAuthService';
import dropboxAuthService from './dropboxAuthService';
import appleAuthService from './appleAuthService';
import {
  readSecure as readSecureStorage,
  writeSecure as writeSecureStorage,
  deleteSecure as deleteSecureStorage,
} from './secureStorageService';

// Keychain-backed key for the session binding secret (finding #1). The
// proxy issues this at /api/admin/init and we must present it on every
// /validate call so an attacker who guesses a userId still can't rehydrate
// a session on our OAuth credentials.
const BINDING_SECRET_KEY = '@proxy_session_binding';

async function getBindingSecret() {
  try {
    return await readSecureStorage(BINDING_SECRET_KEY);
  } catch {
    return null;
  }
}

// fetch wrapper that auto-injects X-Session-Binding on every proxy request
// (finding #7). Team endpoints ignore the header server-side, so it's safe
// to send universally. Keeps admin sessionId in URL path but demotes it to
// a lookup key â€” the actual bearer is the header value, which never lands
// in URL logs / Referer / Vercel edge cache.
async function authFetch(url, options = {}) {
  const bindingSecret = await getBindingSecret();
  const headers = {
    ...(options.headers || {}),
    ...(bindingSecret ? { 'X-Session-Binding': bindingSecret } : {}),
  };
  return fetch(url, { ...options, headers });
}

// DEBUG: Log the proxy URL being used
console.log('[PROXY] ðŸŒ PROXY_SERVER_URL:', PROXY_SERVER_URL);

class ProxyService {
  /**
   * Initialize an admin session on the proxy server
   * @param {string} folderId - Google Drive folder ID, Dropbox folder path, or iCloud container ID (ignored for 'serviceflow')
   * @param {string} accountType - Account type: 'google' | 'dropbox' | 'apple' | 'serviceflow' (default: 'google')
   * @param {string} userId - User ID for global team tracking across accounts
   * @param {object} [extra] - Extra fields for provider-specific init (e.g. { sfRefreshToken, sfWorkspaceId, sfWorkspaceName })
   * @returns {Promise<{sessionId: string}>}
   */
  async initializeAdminSession(folderId, accountType = 'google', userId = null, extra = {}) {
    try {
      let authData = {
        userId, // Include userId for global team tracking
      };

      if (accountType === 'serviceflow') {
        const { sfRefreshToken, sfWorkspaceId, sfWorkspaceName, adminIndustry, adminCustomRooms } = extra || {};
        if (!sfRefreshToken) {
          throw new Error('Service Flow refresh token missing â€” reconnect Service Flow in Settings.');
        }
        authData = {
          ...authData,
          accountType: 'serviceflow',
          refresh_token: sfRefreshToken,
          workspace_id: sfWorkspaceId || null,
          workspace_name: sfWorkspaceName || null,
          admin_industry: adminIndustry || null,
          admin_custom_rooms: Array.isArray(adminCustomRooms) ? adminCustomRooms : null,
        };
      } else if (accountType === 'apple') {
        // For Apple/iCloud, get authorization code and identity token
        const authorizationCode = await appleAuthService.getAuthorizationCode();
        const identityToken = await appleAuthService.getIdentityToken();
        const appleUserId = await appleAuthService.getUserId();
        const rawNonce = await appleAuthService.getRawNonce();

        if (!authorizationCode || !identityToken) {
          throw new Error('Failed to get Apple credentials. Please sign in with Apple.');
        }

        authData = {
          ...authData,
          accountType: 'apple',
          authorizationCode,
          identityToken,
          appleUserId,
          // Finding #4 â€” server checks SHA256(rawNonce) === identityToken.nonce.
          // If sign-in ran without a nonce (pre-fix path), rawNonce is null
          // and server logs a warning but accepts the token during rollout.
          rawNonce,
          folderId, // For iCloud, this is the container ID
        };
      } else if (accountType === 'dropbox') {
        // For Dropbox, get access token
        await dropboxAuthService.loadStoredTokens();
        const accessToken = dropboxAuthService.getAccessToken();
        if (!accessToken) {
          throw new Error('Failed to get Dropbox access token. Please sign in to Dropbox.');
        }
        authData = {
          ...authData,
          accountType: 'dropbox',
          accessToken,
          folderPath: folderId, // For Dropbox, folderId is actually a folder path
        };
      } else {
        // For Google, get serverAuthCode
        const serverAuthCode = await googleAuthService.getServerAuthCode();
        if (!serverAuthCode) {
          // This is expected if user hasn't signed in to Google yet
          console.log('[PROXY] No serverAuthCode available - user needs to sign in to Google first');
          throw new Error('GOOGLE_NOT_CONNECTED');
        }

        // IMPORTANT: Always use Web Client ID for server-side token exchange
        // The serverAuthCode is generated using Web Client ID, which has a client secret
        // Android Client ID doesn't have a secret and can't be used for server-side exchange
        
        // Try multiple sources for environment variables (same as googleAuthService):
        // 1. Constants.expoConfig.extra (runtime access - from app.config.js)
        // 2. process.env (build-time)
        const getEnvVar = (key) => {
          // First try Constants.expoConfig.extra (runtime access)
          if (Constants.expoConfig?.extra?.[key]) {
            return Constants.expoConfig.extra[key];
          }
          // Fallback to process.env (build-time)
          return process.env[key] || null;
        };

        const webClientId = getEnvVar('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
        const clientId = webClientId;

        if (!clientId) {
          console.error('[PROXY] Missing Client ID. Checked:');
          console.error('[PROXY] - Constants.expoConfig.extra.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:', Constants.expoConfig?.extra?.['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']);
          console.error('[PROXY] - process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
          throw new Error('Missing Client ID. Please check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in app.config.js or environment variables.');
        }

        console.log('[PROXY] Using client ID for token exchange:', clientId);

        authData = {
          ...authData,
          accountType: 'google',
          serverAuthCode,
          clientId,
          folderId,
        };
      }

      // Add cache-busting parameter to ensure we hit the latest deployment
      const url = `${PROXY_SERVER_URL}/api/admin/init?v=${Date.now()}`;
      
      const response = await authFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        body: JSON.stringify(authData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[PROXY] Init response:', response.status, errorText);

        // If it's an auth code error, clear the stored code so it won't be reused (Google only)
        if (accountType === 'google' && (errorText.includes('authorization code has expired') || errorText.includes('already been used'))) {
          try {
            await googleAuthService.clearServerAuthCode();
          } catch (clearError) {
            console.warn('[PROXY] Failed to clear serverAuthCode:', clearError.message);
          }
        }

        throw new Error(`Failed to initialize proxy session: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Clear the authorization code after successful use (it's a one-time code)
      // This prevents it from being reused if initializeAdminSession is called again
      if (accountType === 'google') {
        try {
          await googleAuthService.clearServerAuthCode();
        } catch (clearError) {
          console.warn('[PROXY] Failed to clear serverAuthCode (non-critical):', clearError.message);
        }
      } else if (accountType === 'apple') {
        try {
          await appleAuthService.clearAuthorizationCode();
          await appleAuthService.clearRawNonce();
        } catch (clearError) {
          console.warn('[PROXY] Failed to clear Apple authorizationCode / rawNonce (non-critical):', clearError.message);
        }
      }

      // Persist the binding secret in keychain-backed storage so it survives
      // reinstall on iOS. Required on every /validate call from this point
      // forward. If the proxy didn't return one (old server, unusual path),
      // clear any stale value so validate falls through to a re-init.
      if (data.bindingSecret) {
        await writeSecureStorage(BINDING_SECRET_KEY, data.bindingSecret);
      } else {
        console.warn('[PROXY] init response missing bindingSecret â€” old server or unusual account type');
        await deleteSecureStorage(BINDING_SECRET_KEY);
      }

      return {
        sessionId: data.sessionId,
        bindingSecret: data.bindingSecret || null,
      };
    } catch (error) {
      // Handle expected "not connected" errors gracefully
      if (error.message === 'GOOGLE_NOT_CONNECTED') {
        console.log('[PROXY] Google not connected - user needs to sign in first');
        throw error;
      }
      
      console.warn('[PROXY] Could not initialize session:', error?.message);
      throw error;
    }
  }

  /**
   * Add an invite token to the admin session
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   * @param {object} [opts]
   * @param {string|number} [opts.sfTeamMemberId] â€” SF team_member id
   *   the admin picked for this invite. When present, the proxy binds
   *   this token to that SF cleaner so their /jobs pull is filtered
   *   to that person's assignments only. Optional â€” invites without
   *   it fall back to workspace-wide (legacy behaviour).
   */
  async addInviteToken(sessionId, token, opts = {}) {
    try {
      console.log('[PROXY] Adding invite token to session:', sessionId);

      const body = { token };
      if (opts?.sfTeamMemberId != null && String(opts.sfTeamMemberId).trim() !== '') {
        body.sf_team_member_id = String(opts.sfTeamMemberId);
      }
      if (opts?.displayName != null && String(opts.displayName).trim() !== '') {
        body.display_name = String(opts.displayName).trim().slice(0, 200);
      }
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Add token error:', errorText);
        throw new Error(`Failed to add invite token: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Token added successfully');

      return data;
    } catch (error) {
      console.error('[PROXY] Error adding token:', error);
      throw error;
    }
  }

  /**
   * Rename a team member (or pending invite) by its invite token.
   * Server updates the token→name map, the joined-member record, and
   * every team project's ownerName in one shot so the new name shows
   * up on the admin's members list AND the ProjectsScreen cleaner
   * chips after a single refresh.
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token identifying the member
   * @param {string} displayName - New display name (server trims + caps at 200 chars)
   */
  async updateInviteTokenDisplayName(sessionId, token, displayName) {
    try {
      const trimmed = String(displayName || '').trim();
      if (!trimmed) throw new Error('display_name is required');

      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens/${encodeURIComponent(token)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: trimmed.slice(0, 200) }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Update token name error:', errorText);
        throw new Error(`Failed to update team member name: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[PROXY] Error updating team member name:', error);
      throw error;
    }
  }

  /**
   * Remove an invite token from the admin session
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   */
  async removeInviteToken(sessionId, token) {
    try {
      console.log('[PROXY] Removing invite token from session:', sessionId);

      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Remove token error:', errorText);
        throw new Error(`Failed to remove invite token: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Token removed successfully');

      return data;
    } catch (error) {
      console.error('[PROXY] Error removing token:', error);
      throw error;
    }
  }

  /**
   * Upload a photo as a team member (with token) with full upload structure
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   * @param {string} filename - Filename
   * @param {string} contentBase64 - Base64 encoded image
   * @param {string} fileUri - (Optional) File URI for multipart upload
   * @param {Object} uploadParams - Upload parameters (same as admin uploads)
   * @param {string} uploadParams.albumName - Album folder name
   * @param {string} uploadParams.room - Room name
   * @param {string} uploadParams.type - Photo type (before/after/combined)
   * @param {string} uploadParams.format - Format type (default/portrait/square)
   * @param {string} uploadParams.location - Location/city
   * @param {string} uploadParams.cleanerName - Cleaner's name
   * @param {boolean} uploadParams.flat - Flat mode (no subfolders)
   */
  async uploadPhoto(sessionId, token, filename, contentBase64, fileUri, uploadParams = {}) {
    try {
      const {
        albumName,
        room,
        type,
        format = 'default',
        location,
        cleanerName,
        flat = false,
        // Optional Service Flow fanout â€” when the linked project has
        // a crmJobId, pass it here and the proxy will additionally
        // attach the same photo to the SF job after the Drive write.
        // photoId is the ProofPix-side stable id used as SF's dedup
        // key. Both fields are optional; upload works exactly as
        // before when they're absent.
        crmJobId,
        photoId,
        overrides,
        projectId,
        preLabeled,
      } = uploadParams;

      console.log('[PROXY] Uploading photo as team member:', { 
        sessionId, 
        filename, 
        token: token.substring(0, 10) + '...',
        albumName,
        room,
        type,
        format,
        flat,
        mode: fileUri ? 'multipart' : 'base64'
      });

      let response;

      if (fileUri) {
        // Multipart upload for Team Members
        const formData = new FormData();
        formData.append('photo', {
          uri: fileUri,
          name: filename,
          type: 'image/jpeg'
        });
        formData.append('token', token);
        if (albumName) formData.append('albumName', albumName);
        if (room) formData.append('room', room);
        if (type) formData.append('type', type);
        if (format) formData.append('format', format);
        if (location) formData.append('location', location);
        if (cleanerName) formData.append('cleanerName', cleanerName);
        formData.append('flat', String(flat));
        formData.append('accountType', 'google');
        formData.append('filename', filename);
        if (crmJobId) formData.append('crmJobId', String(crmJobId));
        if (photoId) formData.append('photoId', String(photoId));
        if (overrides && typeof overrides === 'object') {
          try { formData.append('overrides', JSON.stringify(overrides)); } catch {}
        }
        if (projectId) formData.append('projectId', String(projectId));
        if (typeof preLabeled === 'boolean') formData.append('preLabeled', String(preLabeled));

        response = await authFetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            // 'Content-Type': 'multipart/form-data', // DO NOT SET THIS MANUALLY! It breaks the boundary.
          },
          body: formData,
        });
      } else {
        // Legacy Base64 upload
        response = await authFetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            filename,
            contentBase64,
            albumName,
            room,
            type,
            format,
            location,
            cleanerName,
            flat,
            accountType: 'google',
            ...(crmJobId ? { crmJobId: String(crmJobId) } : {}),
            ...(photoId ? { photoId: String(photoId) } : {}),
            ...(overrides && typeof overrides === 'object' ? { overrides } : {}),
            ...(projectId ? { projectId: String(projectId) } : {}),
            ...(typeof preLabeled === 'boolean' ? { preLabeled } : {}),
          }),
        });
      }

      console.log('[PROXY] Upload response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Upload error:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        throw new Error(errorData.message || errorData.error || `Upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Photo uploaded successfully:', data.fileId);

      return data;
    } catch (error) {
      console.error('[PROXY] Error uploading photo:', error);
      throw error;
    }
  }

  /**
   * Prepare album folder structure before parallel uploads
   * @param {string} sessionId - Proxy session ID
   * @param {string} albumName - Album folder name
   * @returns {Promise<Object>} Prepare result
   */
  async prepareAlbumFolder(sessionId, albumName, subfolders = []) {
    try {
      console.log('[PROXY] Preparing album folder:', { sessionId, albumName, subfolders });

      const body = { albumName };
      if (subfolders.length > 0) {
        body.subfolders = subfolders;
      }

      const response = await authFetch(`${PROXY_SERVER_URL}/api/prepare/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      console.log('[PROXY] Prepare response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Prepare error:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        throw new Error(errorData.message || errorData.error || `Prepare failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Album folder prepared successfully:', data.albumFolderId);

      return data;
    } catch (error) {
      console.error('[PROXY] Error preparing album folder:', error);
      throw error;
    }
  }

  /**
   * Register team member join
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   * @param {string} memberName - Team member's name
   * @returns {Promise<{success: boolean}>}
   */
  async registerTeamMemberJoin(sessionId, token, memberName) {
    try {
      console.log('[PROXY] Registering team member join:', { sessionId, token: token.substring(0, 10) + '...', memberName });

      const response = await authFetch(`${PROXY_SERVER_URL}/api/team/${sessionId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, memberName }),
      });

      console.log('[PROXY] Register join response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Register join error:', errorText);
        const err = new Error(`Failed to register team member: ${response.status}`);
        err.status = response.status;
        throw err;
      }

      const data = await response.json();
      console.log('[PROXY] Team member registered successfully');

      return data;
    } catch (error) {
      console.error('[PROXY] Error registering team member:', error);
      throw error;
    }
  }

  /**
   * Get team members list
   * @param {string} sessionId - Proxy session ID
   * @returns {Promise<{teamMembers: Array}>}
   */
  async getTeamMembers(sessionId) {
    try {
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/team-members`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Get team members error:', errorText);
        throw new Error(`Failed to get team members: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[PROXY] Error getting team members:', error);
      throw error;
    }
  }

  /**
   * Get global team member count across all accounts sharing the same team
   * @param {string} sessionId - Proxy session ID
   * @returns {Promise<{success: boolean, globalCount: number, folderId: string}>}
   */
  async getGlobalTeamMemberCount(sessionId) {
    try {
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/global-team-count`, {
        method: 'GET',
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Get global team count error:', errorText);
        throw new Error(`Failed to get global team count: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('[PROXY] Error getting global team count:', error);
      throw error;
    }
  }

  /**
   * Reset global team member count for the current user (by userId).
   * This clears the server-side global registry used for Enterprise limits.
   * @param {string} sessionId - Proxy session ID
   * @returns {Promise<{success: boolean, previousCount: number, remainingCount: number}>}
   */
  async resetGlobalTeamMemberCount(sessionId) {
    try {
      console.log('[PROXY] Resetting global team member count for session:', sessionId);

      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/global-team-count`, {
        method: 'DELETE',
      });

      console.log('[PROXY] Global team count reset response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Reset global team count error:', errorText);
        throw new Error(`Failed to reset global team count: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Global team member count reset:', data);

      return data;
    } catch (error) {
      console.error('[PROXY] Error resetting global team count:', error);
      throw error;
    }
  }

  /**
   * Remove a team member by their token
   * This uses the same endpoint as removeInviteToken since removing a token also removes the team member
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - The invite token used by the team member
   * @returns {Promise<{success: boolean}>}
   */
  async removeTeamMember(sessionId, token) {
    try {
      console.log('[PROXY] Removing team member with token:', token);

      // Use the tokens endpoint - it removes both the token and the associated team member
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens/${encodeURIComponent(token)}`, {
        method: 'DELETE',
      });

      console.log('[PROXY] Remove team member response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Remove team member error:', errorText);
        throw new Error(`Failed to remove team member: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Team member removed successfully');

      return data;
    } catch (error) {
      console.error('[PROXY] Error removing team member:', error);
      throw error;
    }
  }

  /**
   * Sync a team-member-owned project's metadata to the proxy so the
   * admin can see it in Team Projects. Fire-and-forget: callers pass
   * `{ silent: true }` in most cases because a failed sync will be
   * healed by the next upload (upload endpoint upserts by album name).
   *
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - The team member's invite token
   * @param {Object} project - { id, name, industry?, createdAt?, memberName?, crmJobId? }
   * @returns {Promise<{success: boolean, project?: Object}>}
   */
  async syncTeamProject(sessionId, token, project) {
    try {
      if (!sessionId || !token || !project?.id || !project?.name) {
        return { success: false, error: 'MISSING_ARGS' };
      }
      const response = await authFetch(`${PROXY_SERVER_URL}/api/team/${sessionId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          id: project.id,
          name: project.name,
          industry: project.industry ?? null,
          createdAt: project.createdAt ?? null,
          memberName: project.memberName ?? null,
          crmJobId: project.crmJobId != null ? String(project.crmJobId) : null,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[PROXY] syncTeamProject error:', response.status, errorText);
        const err = new Error(`Failed to sync team project: ${response.status}`);
        err.status = response.status;
        throw err;
      }

      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error syncing team project:', error?.message);
      throw error;
    }
  }

  /**
   * Delete a team member's project from the shared KV list on the
   * proxy. Mirror of syncTeamProject â€” called by team_member
   * accounts from PhotoContext.deleteProject as fire-and-forget so
   * the admin's Team Projects tab doesn't accumulate ghost entries
   * from projects the member deleted locally. The proxy authorizes
   * via ownerToken match, so this is a no-op for anyone but the
   * project's owner.
   *
   * @param {string} sessionId
   * @param {string} token â€” team member's invite token
   * @param {string} projectId
   * @returns {Promise<{success: boolean, removed?: number}>}
   */
  async deleteTeamProject(sessionId, token, projectId) {
    try {
      if (!sessionId || !token || !projectId) {
        return { success: false, error: 'MISSING_ARGS' };
      }
      const response = await authFetch(
        `${PROXY_SERVER_URL}/api/team/${sessionId}/projects/${encodeURIComponent(projectId)}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[PROXY] deleteTeamProject error:', response.status, errorText);
        return { success: false, error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error deleting team project:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  /**
   * Admin-side force-purge of a team project (no ownerToken check).
   * Used by the Team tab's "Clear team projects" cleanup button so
   * the admin can wipe ghost entries left behind by members on old
   * builds / offline deletes / pre-fix state.
   */
  async adminDeleteTeamProject(sessionId, projectId) {
    try {
      if (!sessionId || !projectId) {
        return { success: false, error: 'MISSING_ARGS' };
      }
      const response = await authFetch(
        `${PROXY_SERVER_URL}/api/admin/${sessionId}/projects/${encodeURIComponent(projectId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[PROXY] adminDeleteTeamProject error:', response.status, errorText);
        return { success: false, error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error admin-deleting team project:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  /**
   * List team-member projects for an admin (sorted by updatedAt desc).
   * @param {string} sessionId - Proxy session ID
   * @returns {Promise<{success: boolean, projects: Array}>}
   */
  /**
   * List every photo in a specific team project's Drive folder.
   * Used by the admin's Team Projects tab to open a project into a
   * thumbnail grid and lazy-load full-res on tap. Complements the
   * single-latest-thumbnail Slice C already returns from
   * getTeamProjects.
   *
   * @param sessionId â€” admin proxy session
   * @param projectId â€” project id from getTeamProjects
   * @param opts â€” { limit, cursor } (both optional)
   * @returns { success, photos: [...], nextCursor }
   */
  async getTeamProjectPhotos(sessionId, projectId, { limit, cursor } = {}) {
    try {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const q = params.toString();
      const url = `${PROXY_SERVER_URL}/api/admin/${sessionId}/projects/${encodeURIComponent(projectId)}/photos${q ? `?${q}` : ''}`;
      const response = await authFetch(url, { method: 'GET' });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[PROXY] getTeamProjectPhotos error:', response.status, text.slice(0, 200));
        throw new Error(`Failed to load project photos: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error loading team project photos:', error?.message);
      throw error;
    }
  }

  /**
   * Slice D.4: admin pushes their label/watermark/logo/metadata
   * settings so team members' devices adopt them as effective
   * defaults. Called from SettingsContext (debounced) whenever an
   * OVERRIDE_KEY value changes on the admin device.
   *
   * @param {string} sessionId - Admin session ID
   * @param {Object} settings - Sparse map of OVERRIDE_KEYS values to enforce
   * @returns {Promise<{success: boolean}>}
   */
  async putTeamLabelSettings(sessionId, settings) {
    try {
      if (!sessionId || !settings || typeof settings !== 'object') {
        return { success: false, error: 'MISSING_ARGS' };
      }
      const response = await authFetch(
        `${PROXY_SERVER_URL}/api/admin/${sessionId}/team-label-settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        },
      );
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn('[PROXY] putTeamLabelSettings error:', response.status, errorText.slice(0, 200));
        return { success: false, error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error putting team label settings:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  /**
   * Team-member-side fetch of the admin's team-label-settings.
   * Called on cold-start / foreground refresh so the local Settings
   * cascade can pick up admin's authoritative values.
   *
   * @param {string} sessionId - Admin session ID
   * @param {string} token - Team member's invite token
   * @returns {Promise<{success: boolean, settings: Object|null, updatedAt: string|null}>}
   */
  async getTeamLabelSettings(sessionId, token) {
    try {
      if (!sessionId || !token) return { success: false, error: 'MISSING_ARGS' };
      const url = `${PROXY_SERVER_URL}/api/team/${sessionId}/team-label-settings?token=${encodeURIComponent(token)}`;
      const response = await authFetch(url, { method: 'GET' });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn('[PROXY] getTeamLabelSettings error:', response.status, errorText.slice(0, 200));
        return { success: false, error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error getting team label settings:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  async getTeamProjects(sessionId) {
    try {
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/projects`, {
        method: 'GET',
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[PROXY] getTeamProjects error:', response.status, errorText);
        throw new Error(`Failed to get team projects: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error getting team projects:', error?.message);
      throw error;
    }
  }

  /**
   * Push admin's Service Flow refresh token to the proxy session so
   * team members can list SF jobs + have uploads fanned out to SF
   * without ever holding SF credentials on their device. Same trust
   * model as Google Drive: proxy is the sole party holding the
   * OAuth credentials.
   *
   * Called by the admin's client after a successful
   * `crmService.connect('serviceflow', ...)`.
   */
  async setServiceFlowCredentials(sessionId, refreshToken, workspaceId, workspaceName) {
    try {
      if (!sessionId || !refreshToken) return { success: false, error: 'MISSING_ARGS' };
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/serviceflow-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: refreshToken,
          workspace_id: workspaceId || null,
          workspace_name: workspaceName || null,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[PROXY] setServiceFlowCredentials failed:', response.status, text.slice(0, 200));
        throw new Error(`SF credentials push failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error pushing SF credentials:', error?.message);
      throw error;
    }
  }

  /**
   * Clear admin's Service Flow refresh token from the proxy session.
   * Called from the admin's client on SF disconnect.
   */
  async clearServiceFlowCredentials(sessionId) {
    try {
      if (!sessionId) return { success: false };
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/serviceflow-credentials`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        console.warn('[PROXY] clearServiceFlowCredentials failed:', response.status);
        return { success: false };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error clearing SF credentials:', error?.message);
      return { success: false };
    }
  }

  /**
   * List Service Flow jobs on behalf of a team member. Proxy uses
   * the admin's stored SF refresh token to fetch jobs from SF and
   * returns them straight; team member device never sees SF creds.
   *
   * Returns { jobs: [...], nextCursor }. On 424 (admin hasn't linked
   * SF), returns { jobs: [], notConnected: true } so callers can
   * render a clean "not connected" state instead of an error.
   */
  /**
   * List SF cleaners (SF's `team_members`) for the admin's workspace.
   * Used by the admin invite modal to pick who a new invite is for
   * so the resulting invite is scoped to that specific cleaner's
   * SF assignments.
   *
   * Returns `{ cleaners: [{ id, first_name, last_name, role, status }] }`
   * on success. When SF hasn't shipped the underlying endpoint yet,
   * the proxy returns `{ cleaners: [], not_deployed: true }` â€” same
   * shape, empty list, so the caller can render an empty picker
   * gracefully.
   *
   * 424 (SF not connected on admin session) â†’ returns
   * `{ cleaners: [], notConnected: true }` for a graceful empty
   * state instead of a thrown error.
   */
  async listServiceFlowCleaners(sessionId) {
    try {
      if (!sessionId) return { cleaners: [] };
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/serviceflow-cleaners`);
      if (response.status === 424) {
        return { cleaners: [], notConnected: true };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[PROXY] listServiceFlowCleaners failed:', response.status, text.slice(0, 200));
        throw new Error(`SF cleaners list failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error listing SF cleaners:', error?.message);
      throw error;
    }
  }

  async listServiceFlowJobs(sessionId, token, { status = 'active', search, limit = 100, cursor } = {}) {
    try {
      if (!sessionId || !token) return { jobs: [], nextCursor: null };
      const params = new URLSearchParams({ token });
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      if (limit) params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const response = await authFetch(`${PROXY_SERVER_URL}/api/team/${sessionId}/serviceflow-jobs?${params.toString()}`);
      if (response.status === 424) {
        return { jobs: [], nextCursor: null, notConnected: true };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[PROXY] listServiceFlowJobs failed:', response.status, text.slice(0, 200));
        throw new Error(`SF jobs list failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] Error listing SF jobs:', error?.message);
      throw error;
    }
  }

  /**
   * Long-poll waiting for the admin to revoke this team-member's
   * token. Server holds the connection open until a revoke event
   * fires or the server-side timeout (25s) hits, whichever comes
   * first. Client is expected to re-open immediately on a
   * `{ revoked: false }` response.
   *
   * Uses an AbortController-aware fetch so unmounting the effect
   * cancels the in-flight request cleanly.
   *
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Team-member invite token
   * @param {object} opts
   * @param {AbortSignal} [opts.signal] - Optional abort signal
   * @returns {Promise<{ revoked: boolean }>} â€” always resolves
   *   { revoked: true } or { revoked: false }. Errors propagate.
   */
  async waitForRevoke(sessionId, token, { signal } = {}) {
    if (!sessionId || !token) return { revoked: false };
    const params = new URLSearchParams({ token });
    const response = await authFetch(
      `${PROXY_SERVER_URL}/api/team/${sessionId}/wait-for-revoke?${params.toString()}`,
      { method: 'GET', signal },
    );
    if (response.status === 403 || response.status === 404) {
      // Server already considers this token revoked / session gone â€”
      // treat both as revoked so the client tears down.
      return { revoked: true };
    }
    if (!response.ok) {
      throw new Error(`wait-for-revoke failed: ${response.status}`);
    }
    return await response.json();
  }

  /**
   * Patch admin team-info on an existing proxy session. Used to
   * backfill industry / customRooms for admins whose SF-primary
   * session was created before the proxy learned those fields â€”
   * without this they'd have to re-run team setup (which invalidates
   * existing team-member tokens).
   */
  async patchTeamInfo(sessionId, { adminIndustry, adminCustomRooms } = {}) {
    try {
      const body = {};
      if (adminIndustry) body.admin_industry = adminIndustry;
      if (Array.isArray(adminCustomRooms) && adminCustomRooms.length > 0) body.admin_custom_rooms = adminCustomRooms;
      if (Object.keys(body).length === 0) return { success: false, skipped: true };

      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/team-info`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('[PROXY] patchTeamInfo failed:', response.status, text.slice(0, 200));
        return { success: false, error: `${response.status}` };
      }
      return await response.json();
    } catch (error) {
      console.warn('[PROXY] patchTeamInfo threw:', error?.message);
      return { success: false, error: error?.message };
    }
  }

  /**
   * Get session info including admin user info
   * @param {string} sessionId - Proxy session ID
   * @returns {Promise<{adminUserInfo: {name, email, picture}, folderId: string}>}
   */
  async getSessionInfo(sessionId) {
    try {
      console.log('[PROXY] Getting session info:', sessionId);

      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/info`, {
        method: 'GET',
      });

      console.log('[PROXY] Session info response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Get session info error:', errorText);
        throw new Error(`Failed to get session info: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Session info result:', data);

      return data;
    } catch (error) {
      console.error('[PROXY] Error getting session info:', error);
      throw error;
    }
  }

  /**
   * Validate if a proxy session is still active and valid
   * @param {string} sessionId - Proxy session ID
   * @param {string} [userId] - Optional stable user id (@user_id in
   *   AsyncStorage). When passed, the proxy will attempt to rehydrate
   *   an expired/missing session from `credentials:${userId}` and
   *   return a fresh sessionId in the response â€” the client should
   *   then persist the returned sessionId in place of the old one.
   * @returns {Promise<{valid: boolean, sessionId?: string, rehydrated?: boolean, message?: string, error?: string}>}
   */
  async validateSession(sessionId, userId = null) {
    try {
      console.log('[PROXY] Validating session:', sessionId, 'userId:', userId || 'none');

      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      // authFetch injects X-Session-Binding automatically.
      const response = await authFetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/validate${qs}`, {
        method: 'GET',
      });

      console.log('[PROXY] Validation response status:', response.status);

      const data = await response.json();
      console.log('[PROXY] Validation result:', data);

      return data;
    } catch (error) {
      console.error('[PROXY] Error validating session:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Upload a photo as admin (without token) with full upload structure
   * @param {string} sessionId - Proxy session ID
   * @param {string} filename - Filename
   * @param {string} contentBase64 - Base64 encoded image
   * @param {Object} uploadParams - Upload parameters
   * @param {string} uploadParams.albumName - Album folder name
   * @param {string} uploadParams.room - Room name
   * @param {string} uploadParams.type - Photo type (before/after/combined)
   * @param {string} uploadParams.format - Format type (default/portrait/square)
   * @param {string} uploadParams.location - Location/city
   * @param {string} uploadParams.cleanerName - Cleaner's name
   * @param {boolean} uploadParams.flat - Flat mode (no subfolders)
   * @param {string} uploadParams.accountType - Account type: 'google' or 'dropbox' (optional, backend should know from session)
   * @returns {Promise<Object>} Upload result
   */
  async uploadPhotoAsAdmin({
    sessionId,
    filename,
    contentBase64,
    fileUri, // Optional: Use fileUri for FormData upload instead of contentBase64
    albumName,
    room,
    type,
    format = 'default',
    location,
    cleanerName,
    flat = false,
    accountType = 'google'
  }) {
    try {
      console.log('[PROXY] Uploading photo as admin:', { sessionId, filename, albumName, room, type, format, flat, mode: fileUri ? 'multipart' : 'base64' });

      let response;

      if (fileUri) {
        // Use FormData for multipart upload (efficient, no base64 overhead)
        const formData = new FormData();
        
        // Append file (must be first or early in form data for some parsers)
        formData.append('photo', {
          uri: fileUri,
          name: filename,
          type: 'image/jpeg'
        });

        // Append metadata
        if (albumName) formData.append('albumName', albumName);
        if (room) formData.append('room', room);
        if (type) formData.append('type', type);
        if (format) formData.append('format', format);
        if (location) formData.append('location', location);
        if (cleanerName) formData.append('cleanerName', cleanerName);
        formData.append('flat', String(flat));
        if (accountType) formData.append('accountType', accountType);
        formData.append('filename', filename); // explicit filename field

        // 60s timeout to prevent hanging on bad network
        const multipartController = new AbortController();
        const multipartTimeout = setTimeout(() => multipartController.abort(), 60000);
        try {
          response = await authFetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              // 'Content-Type': 'multipart/form-data', // DO NOT SET THIS MANUALLY! It breaks the boundary.
            },
            body: formData,
            signal: multipartController.signal,
          });
        } finally {
          clearTimeout(multipartTimeout);
        }
      } else {
        // Legacy Base64 upload - 60s timeout
        const base64Controller = new AbortController();
        const base64Timeout = setTimeout(() => base64Controller.abort(), 60000);
        try {
          response = await authFetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filename,
              contentBase64,
              albumName,
              room,
              type,
              format,
              location,
              cleanerName,
              flat,
              accountType
            }),
            signal: base64Controller.signal,
          });
        } finally {
          clearTimeout(base64Timeout);
        }
      }

      console.log('[PROXY] Upload response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Upload error:', errorText);
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText };
        }
        throw new Error(errorData.message || errorData.error || `Upload failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Photo uploaded successfully:', data.fileId);

      return data;
    } catch (error) {
      console.error('[PROXY] Error uploading photo:', error);
      throw error;
    }
  }

  /**
   * Verify an IAP receipt with the proxy (finding #8). Called after
   * RNIap.purchaseUpdatedListener fires and BEFORE granting entitlement.
   *
   * Never blocks the purchase flow — on any network / server error we
   * return an unverified-valid response so the user isn't punished for
   * proxy downtime after they've already paid Apple/Google. The proxy's
   * strict-mode enforcement is what closes the "modded StoreKit" bypass;
   * the mobile caller just has to actually call this.
   *
   * @param {Object} params
   * @param {'ios'|'android'} params.platform
   * @param {string} params.productId
   * @param {string} [params.transactionId] iOS
   * @param {string} [params.originalTransactionId] iOS
   * @param {string} [params.purchaseToken] Android
   * @param {string} [params.userId] for entitlement persistence
   * @returns {Promise<{valid: boolean, verified: boolean, productId?: string, reason?: string}>}
   */
  async verifyIAPPurchase({ platform, productId, transactionId, originalTransactionId, purchaseToken, userId }) {
    try {
      const response = await authFetch(`${PROXY_SERVER_URL}/api/iap/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          productId,
          transactionId,
          originalTransactionId,
          purchaseToken,
          userId,
        }),
      });

      if (!response.ok) {
        console.warn('[PROXY] IAP verify HTTP error:', response.status);
        return { valid: true, verified: false, reason: `http_${response.status}` };
      }

      const data = await response.json();
      console.log('[PROXY] IAP verify result:', {
        valid: data.valid,
        verified: data.verified,
        reason: data.reason,
        environment: data.environment,
      });
      return data;
    } catch (error) {
      console.warn('[PROXY] IAP verify network error (soft-pass):', error?.message);
      return { valid: true, verified: false, reason: 'network_error' };
    }
  }
}

export default new ProxyService();

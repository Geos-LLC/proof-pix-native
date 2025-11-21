/**
 * Proxy Service
 * Handles communication with the ProofPix proxy server
 */

import { Platform } from 'react-native';
import { PROXY_SERVER_URL } from '../config/proxy';
import googleAuthService from './googleAuthService';
import dropboxAuthService from './dropboxAuthService';

class ProxyService {
  /**
   * Initialize an admin session on the proxy server
   * @param {string} folderId - Google Drive folder ID or Dropbox folder path
   * @param {string} accountType - Account type: 'google' or 'dropbox' (default: 'google')
   * @returns {Promise<{sessionId: string}>}
   */
  async initializeAdminSession(folderId, accountType = 'google') {
    try {
      console.log('[PROXY] Initializing admin session with folder ID:', folderId);
      console.log('[PROXY] Using proxy server URL:', PROXY_SERVER_URL);

      let authData = {};
      
      if (accountType === 'dropbox') {
        // For Dropbox, get access token
        await dropboxAuthService.loadStoredTokens();
        const accessToken = dropboxAuthService.getAccessToken();
        if (!accessToken) {
          throw new Error('Failed to get Dropbox access token. Please sign in to Dropbox.');
        }
        console.log('[PROXY] Got Dropbox access token, length:', accessToken.length);
        authData = {
          accountType: 'dropbox',
          accessToken,
          folderPath: folderId, // For Dropbox, folderId is actually a folder path
        };
      } else {
        // For Google, get serverAuthCode
        const serverAuthCode = await googleAuthService.getServerAuthCode();
        if (!serverAuthCode) {
          throw new Error('Failed to get serverAuthCode from Google Sign-In.');
        }
        console.log('[PROXY] Got serverAuthCode, length:', serverAuthCode.length);

        // IMPORTANT: Always use Web Client ID for server-side token exchange
        const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
        
        if (!clientId) {
          throw new Error('Missing Web Client ID. Please check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in environment variables.');
        }
        
        console.log(`[PROXY] Platform: ${Platform.OS}, Using Web Client ID for server-side token exchange: ${clientId.substring(0, 20)}...`);
        authData = {
          accountType: 'google',
          serverAuthCode,
          clientId,
          folderId,
        };
      }

      // Add cache-busting parameter to ensure we hit the latest deployment
      const url = `${PROXY_SERVER_URL}/api/admin/init?v=${Date.now()}`;
      console.log('[PROXY] Making request to:', url);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        body: JSON.stringify(authData),
      });

      console.log('[PROXY] Init response status:', response.status);
      console.log('[PROXY] Init response ok:', response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Init error response:', errorText);

        // If it's an auth code error, clear the stored code so it won't be reused (Google only)
        if (accountType === 'google' && (errorText.includes('authorization code has expired') || errorText.includes('already been used'))) {
          console.log('[PROXY] Clearing expired/used serverAuthCode');
          try {
            await googleAuthService.clearServerAuthCode();
          } catch (clearError) {
            console.warn('[PROXY] Failed to clear serverAuthCode:', clearError.message);
          }
        }

        throw new Error(`Failed to initialize proxy session: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('[PROXY] Session initialized successfully:', data.sessionId);

      // Clear the serverAuthCode after successful use (it's a one-time code) - Google only
      // This prevents it from being reused if initializeAdminSession is called again
      if (accountType === 'google') {
        try {
          await googleAuthService.clearServerAuthCode();
          console.log('[PROXY] Cleared serverAuthCode after successful session initialization');
        } catch (clearError) {
          console.warn('[PROXY] Failed to clear serverAuthCode (non-critical):', clearError.message);
        }
      }

      return {
        sessionId: data.sessionId
      };
    } catch (error) {
      console.error('[PROXY] Error initializing session:', error);
      console.error('[PROXY] Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Add an invite token to the admin session
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   */
  async addInviteToken(sessionId, token) {
    try {
      console.log('[PROXY] Adding invite token to session:', sessionId);

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
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
   * Remove an invite token from the admin session
   * @param {string} sessionId - Proxy session ID
   * @param {string} token - Invite token
   */
  async removeInviteToken(sessionId, token) {
    try {
      console.log('[PROXY] Removing invite token from session:', sessionId);

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens/${encodeURIComponent(token)}`, {
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
   * @param {Object} uploadParams - Upload parameters (same as admin uploads)
   * @param {string} uploadParams.albumName - Album folder name
   * @param {string} uploadParams.room - Room name
   * @param {string} uploadParams.type - Photo type (before/after/combined)
   * @param {string} uploadParams.format - Format type (default/portrait/square)
   * @param {string} uploadParams.location - Location/city
   * @param {string} uploadParams.cleanerName - Cleaner's name
   * @param {boolean} uploadParams.flat - Flat mode (no subfolders)
   */
  async uploadPhoto(sessionId, token, filename, contentBase64, uploadParams = {}) {
    try {
      const {
        albumName,
        room,
        type,
        format = 'default',
        location,
        cleanerName,
        flat = false
      } = uploadParams;

      console.log('[PROXY] Uploading photo as team member:', { 
        sessionId, 
        filename, 
        token: token.substring(0, 10) + '...',
        albumName,
        room,
        type,
        format,
        flat
      });

      const response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
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
          accountType: 'google' // Team member uploads default to Google (can be extended)
        }),
      });

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
  async prepareAlbumFolder(sessionId, albumName) {
    try {
      console.log('[PROXY] Preparing album folder:', { sessionId, albumName });

      const response = await fetch(`${PROXY_SERVER_URL}/api/prepare/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ albumName }),
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

      const response = await fetch(`${PROXY_SERVER_URL}/api/team/${sessionId}/join`, {
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
        throw new Error(`Failed to register team member: ${response.status}`);
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
      console.log('[PROXY] Getting team members:', sessionId);

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/team-members`, {
        method: 'GET',
      });

      console.log('[PROXY] Team members response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[PROXY] Get team members error:', errorText);
        throw new Error(`Failed to get team members: ${response.status}`);
      }

      const data = await response.json();
      console.log('[PROXY] Team members retrieved:', data.teamMembers?.length || 0);

      return data;
    } catch (error) {
      console.error('[PROXY] Error getting team members:', error);
      throw error;
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

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/info`, {
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
   * @returns {Promise<{valid: boolean, message?: string, error?: string}>}
   */
  async validateSession(sessionId) {
    try {
      console.log('[PROXY] Validating session:', sessionId);

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/validate`, {
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
      console.log('[PROXY] Uploading photo as admin:', { sessionId, filename, albumName, room, type, format, flat });

      const response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // No token for admin uploads
          filename,
          contentBase64,
          albumName,
          room,
          type,
          format,
          location,
          cleanerName,
          flat,
          accountType // Pass account type for backend routing
        }),
      });

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
}

export default new ProxyService();

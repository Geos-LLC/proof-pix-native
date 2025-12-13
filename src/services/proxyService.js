/**
 * Proxy Service
 * Handles communication with the ProofPix proxy server
 */

import { Platform } from 'react-native';
import { PROXY_SERVER_URL } from '../config/proxy';
import googleAuthService from './googleAuthService';
import dropboxAuthService from './dropboxAuthService';
import appleAuthService from './appleAuthService';

class ProxyService {
  /**
   * Initialize an admin session on the proxy server
   * @param {string} folderId - Google Drive folder ID, Dropbox folder path, or iCloud container ID
   * @param {string} accountType - Account type: 'google', 'dropbox', or 'apple' (default: 'google')
   * @param {string} userId - User ID for global team tracking across accounts
   * @returns {Promise<{sessionId: string}>}
   */
  async initializeAdminSession(folderId, accountType = 'google', userId = null) {
    try {
      let authData = {
        userId, // Include userId for global team tracking
      };

      if (accountType === 'apple') {
        // For Apple/iCloud, get authorization code and identity token
        const authorizationCode = await appleAuthService.getAuthorizationCode();
        const identityToken = await appleAuthService.getIdentityToken();
        const appleUserId = await appleAuthService.getUserId();

        if (!authorizationCode || !identityToken) {
          throw new Error('Failed to get Apple credentials. Please sign in with Apple.');
        }

        authData = {
          ...authData,
          accountType: 'apple',
          authorizationCode,
          identityToken,
          appleUserId,
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
        const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
        const clientId = webClientId;

        if (!clientId) {
          throw new Error('Missing Client ID. Please check EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID or EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in environment variables.');
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
      
      const response = await fetch(url, {
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
        console.error('[PROXY] Init error response:', errorText);

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
        } catch (clearError) {
          console.warn('[PROXY] Failed to clear Apple authorizationCode (non-critical):', clearError.message);
        }
      }

      return {
        sessionId: data.sessionId
      };
    } catch (error) {
      // Handle expected "not connected" errors gracefully
      if (error.message === 'GOOGLE_NOT_CONNECTED') {
        console.log('[PROXY] Google not connected - user needs to sign in first');
        throw error;
      }
      
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

        response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            // 'Content-Type': 'multipart/form-data', // DO NOT SET THIS MANUALLY! It breaks the boundary.
          },
          body: formData,
        });
      } else {
        // Legacy Base64 upload
        response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
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
            accountType: 'google'
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
      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/team-members`, {
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
      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/global-team-count`, {
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

      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/global-team-count`, {
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
      const response = await fetch(`${PROXY_SERVER_URL}/api/admin/${sessionId}/tokens/${encodeURIComponent(token)}`, {
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

        response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            // 'Content-Type': 'multipart/form-data', // DO NOT SET THIS MANUALLY! It breaks the boundary.
          },
          body: formData,
        });
      } else {
        // Legacy Base64 upload
        response = await fetch(`${PROXY_SERVER_URL}/api/upload/${sessionId}`, {
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
}

export default new ProxyService();

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Complete the auth session properly
WebBrowser.maybeCompleteAuthSession();

const STORAGE_KEYS = {
  DROPBOX_ACCESS_TOKEN: '@dropbox_access_token',
  DROPBOX_REFRESH_TOKEN: '@dropbox_refresh_token',
  DROPBOX_USER_INFO: '@dropbox_user_info',
  DROPBOX_TOKEN_EXPIRY: '@dropbox_token_expiry',
};

// Dropbox OAuth configuration
// These should be set in your .env file or app.config.js
const DROPBOX_APP_KEY = process.env.EXPO_PUBLIC_DROPBOX_APP_KEY || '78ht1k015widero';
const DROPBOX_REDIRECT_URI = AuthSession.makeRedirectUri({
  scheme: 'proofpix',
  path: 'dropbox-auth',
});

/**
 * Dropbox Authentication Service
 * Handles OAuth flow for Dropbox API access
 */
class DropboxAuthService {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.userInfo = null;
    this.tokenExpiry = null;
  }

  /**
   * Check if Dropbox app key is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!DROPBOX_APP_KEY;
  }

  /**
   * Get the redirect URI for Dropbox OAuth
   * @returns {string}
   */
  getRedirectUri() {
    return DROPBOX_REDIRECT_URI;
  }

  /**
   * Load stored tokens from AsyncStorage
   */
  async loadStoredTokens() {
    try {
      const [accessToken, refreshToken, userInfoStr, expiryStr] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.DROPBOX_ACCESS_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.DROPBOX_REFRESH_TOKEN),
        AsyncStorage.getItem(STORAGE_KEYS.DROPBOX_USER_INFO),
        AsyncStorage.getItem(STORAGE_KEYS.DROPBOX_TOKEN_EXPIRY),
      ]);

      if (accessToken) {
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.userInfo = userInfoStr ? JSON.parse(userInfoStr) : null;
        this.tokenExpiry = expiryStr ? parseInt(expiryStr, 10) : null;

        // Check if token is expired
        if (this.tokenExpiry && Date.now() >= this.tokenExpiry) {
          // Token expired, try to refresh
          if (this.refreshToken) {
            try {
              await this.refreshAccessToken();
            } catch (error) {
              console.error('[DROPBOX] Failed to refresh token:', error);
              await this.clearTokens();
            }
          } else {
            await this.clearTokens();
          }
        }
      }
    } catch (error) {
      console.error('[DROPBOX] Error loading stored tokens:', error);
    }
  }

  /**
   * Store tokens in AsyncStorage
   */
  async storeTokens(accessToken, refreshToken, userInfo, expiresIn) {
    try {
      const expiryTime = expiresIn ? Date.now() + (expiresIn * 1000) - 60000 : null; // Subtract 1 minute for safety
      
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.DROPBOX_ACCESS_TOKEN, accessToken),
        refreshToken && AsyncStorage.setItem(STORAGE_KEYS.DROPBOX_REFRESH_TOKEN, refreshToken),
        userInfo && AsyncStorage.setItem(STORAGE_KEYS.DROPBOX_USER_INFO, JSON.stringify(userInfo)),
        expiryTime && AsyncStorage.setItem(STORAGE_KEYS.DROPBOX_TOKEN_EXPIRY, String(expiryTime)),
      ]);

      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.userInfo = userInfo;
      this.tokenExpiry = expiryTime;
    } catch (error) {
      console.error('[DROPBOX] Error storing tokens:', error);
      throw error;
    }
  }

  /**
   * Clear all stored tokens
   */
  async clearTokens() {
    try {
      await Promise.all([
        AsyncStorage.removeItem(STORAGE_KEYS.DROPBOX_ACCESS_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.DROPBOX_REFRESH_TOKEN),
        AsyncStorage.removeItem(STORAGE_KEYS.DROPBOX_USER_INFO),
        AsyncStorage.removeItem(STORAGE_KEYS.DROPBOX_TOKEN_EXPIRY),
      ]);

      this.accessToken = null;
      this.refreshToken = null;
      this.userInfo = null;
      this.tokenExpiry = null;
    } catch (error) {
      console.error('[DROPBOX] Error clearing tokens:', error);
    }
  }

  /**
   * Check if user is authenticated
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!this.accessToken && (!this.tokenExpiry || Date.now() < this.tokenExpiry);
  }

  /**
   * Get current access token
   * @returns {string|null}
   */
  getAccessToken() {
    return this.accessToken;
  }

  /**
   * Get current user info
   * @returns {object|null}
   */
  getUserInfo() {
    return this.userInfo;
  }

  /**
   * Sign in to Dropbox using OAuth
   * @returns {Promise<object>} User info and tokens
   */
  async signIn() {
    if (!this.isConfigured()) {
      throw new Error('Dropbox app key is not configured. Please set EXPO_PUBLIC_DROPBOX_APP_KEY in your environment variables.');
    }

    console.log('[DROPBOX] Starting sign-in flow...');
    console.log('[DROPBOX] App Key:', DROPBOX_APP_KEY);
    console.log('[DROPBOX] Redirect URI:', DROPBOX_REDIRECT_URI);

    try {
      // Dropbox uses OAuth 2.0 with PKCE
      const discovery = {
        authorizationEndpoint: 'https://www.dropbox.com/oauth2/authorize',
        tokenEndpoint: 'https://api.dropbox.com/oauth2/token',
      };

      const request = new AuthSession.AuthRequest({
        clientId: DROPBOX_APP_KEY,
        scopes: [
          'files.content.write',      // Upload/edit files
          'files.content.read',       // Download/view files
          'files.metadata.read',      // List folders and view file info
          'files.metadata.write',     // Create folders and edit file metadata
          'account_info.read'         // View account information
        ],
        redirectUri: DROPBOX_REDIRECT_URI,
        responseType: AuthSession.ResponseType.Code,
        usePKCE: true,
        extraParams: {
          token_access_type: 'offline', // Request refresh token
        },
      });

      console.log('[DROPBOX] Opening OAuth browser...');
      const result = await request.promptAsync(discovery, {
        useProxy: false,
        showInRecents: true,
      });

      console.log('[DROPBOX] OAuth result type:', result.type);
      if (result.type === 'error') {
        console.log('[DROPBOX] OAuth error:', result.error);
      }
      if (result.type === 'cancel') {
        console.log('[DROPBOX] OAuth was cancelled by user');
      }

      if (result.type === 'success') {
        const { code } = result.params;

        // Exchange authorization code for access token
        const tokenResponse = await fetch(discovery.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            client_id: DROPBOX_APP_KEY,
            redirect_uri: DROPBOX_REDIRECT_URI,
            code_verifier: request.codeVerifier || '',
          }).toString(),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          let errorMessage = `Failed to exchange code for token: ${errorText}`;
          
          // Check for user limit error
          if (errorText.includes('user limit') || errorText.includes('reached its user limit')) {
            errorMessage = 'This app has reached its user limit. Please contact the app developer to increase the user limit in the Dropbox App Console, or publish the app to remove the limit.';
          }
          
          throw new Error(errorMessage);
        }

        const tokenData = await tokenResponse.json();
        const { access_token, refresh_token, expires_in } = tokenData;

        console.log('[DROPBOX] Token exchange successful');
        console.log('[DROPBOX] Has access token:', !!access_token);
        console.log('[DROPBOX] Has refresh token:', !!refresh_token);

        // Get user info
        console.log('[DROPBOX] Fetching user info...');
        // Use api.dropboxapi.com for API v2 RPC endpoints
        // For RPC endpoints, send an empty JSON object {} or null as the body
        const userInfoResponse = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(null), // Send null for endpoints with no parameters
        });

        console.log('[DROPBOX] User info response status:', userInfoResponse.status);
        console.log('[DROPBOX] User info response ok:', userInfoResponse.ok);

        if (!userInfoResponse.ok) {
          const errorText = await userInfoResponse.text();
          console.error('[DROPBOX] User info error response:', errorText);
          
          let errorMessage = 'Failed to get user info';
          
          // Check for user limit error
          if (errorText.includes('user limit') || errorText.includes('reached its user limit')) {
            errorMessage = 'This app has reached its user limit. Please contact the app developer to increase the user limit in the Dropbox App Console, or publish the app to remove the limit.';
          } else if (errorText.includes('invalid_access_token') || errorText.includes('expired')) {
            errorMessage = 'Access token is invalid or expired. Please try signing in again.';
          } else if (errorText.includes('insufficient_scope')) {
            errorMessage = 'The app does not have permission to access user info. Please check the app permissions in Dropbox App Console.';
          } else {
            errorMessage = `Failed to get user info: ${errorText}`;
          }
          
          throw new Error(errorMessage);
        }

        const userInfo = await userInfoResponse.json();
        console.log('[DROPBOX] User info received:', userInfo);

        // Store tokens
        await this.storeTokens(
          access_token,
          refresh_token,
          {
            account_id: userInfo.account_id,
            email: userInfo.email,
            name: userInfo.name.display_name,
            profile_photo_url: userInfo.profile_photo_url,
          },
          expires_in
        );

        return {
          userInfo: this.userInfo,
          accessToken: access_token,
        };
      } else if (result.type === 'error') {
        console.error('[DROPBOX] OAuth error details:', result.error);
        throw new Error(result.error?.message || result.error?.errorDescription || 'Authentication failed');
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        throw new Error('Authentication was cancelled by user');
      } else {
        console.log('[DROPBOX] Unexpected OAuth result type:', result.type);
        throw new Error(`Authentication failed: ${result.type}`);
      }
    } catch (error) {
      console.error('[DROPBOX] Sign-in error:', error);
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch('https://api.dropbox.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: DROPBOX_APP_KEY,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${errorText}`);
      }

      const tokenData = await response.json();
      const { access_token, refresh_token, expires_in } = tokenData;

      // Store new tokens
      await this.storeTokens(
        access_token,
        refresh_token || this.refreshToken, // Use new refresh token if provided, otherwise keep old one
        this.userInfo,
        expires_in
      );

      return access_token;
    } catch (error) {
      console.error('[DROPBOX] Token refresh error:', error);
      await this.clearTokens();
      throw error;
    }
  }

  /**
   * Sign out from Dropbox
   */
  async signOut() {
    try {
      // Revoke token if available
      if (this.accessToken) {
        try {
          await fetch('https://api.dropbox.com/2/auth/token/revoke', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
            },
          });
        } catch (error) {
          console.warn('[DROPBOX] Error revoking token:', error);
        }
      }

      await this.clearTokens();
    } catch (error) {
      console.error('[DROPBOX] Sign-out error:', error);
      throw error;
    }
  }

  /**
   * Make an authenticated request to Dropbox API
   * @param {string} url - API endpoint
   * @param {object} options - Fetch options
   * @returns {Promise<Response>}
   */
  async makeAuthenticatedRequest(url, options = {}) {
    await this.loadStoredTokens();

    if (!this.isAuthenticated()) {
      throw new Error('Not authenticated with Dropbox');
    }

    // Ensure we have a valid token
    let token = this.accessToken;
    if (this.tokenExpiry && Date.now() >= this.tokenExpiry) {
      token = await this.refreshAccessToken();
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };

    // Don't override Content-Type if it's already set (e.g., for file uploads)
    if (!options.headers || !options.headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(url, {
      ...options,
      headers,
    });
  }
}

// Export singleton instance
const dropboxAuthService = new DropboxAuthService();
export default dropboxAuthService;


import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Try to import GoogleSignin, but handle gracefully if not available (Expo Go)
let GoogleSignin = null;
let statusCodes = null;

try {
  const googleSigninModule = require('@react-native-google-signin/google-signin');
  GoogleSignin = googleSigninModule.GoogleSignin;
  statusCodes = googleSigninModule.statusCodes;
} catch (error) {
  // Log the actual error to help diagnose build/linking issues
  console.error('Failed to load @react-native-google-signin/google-signin module:', error);
}

const STORAGE_KEYS = {
  ADMIN_USER_INFO: '@admin_user_info',
  SERVER_AUTH_CODE: '@server_auth_code',
};

/**
 * Google Authentication Service for Admin Setup
 * Handles OAuth flow with necessary scopes for Drive API and Apps Script API
 * Gracefully handles Expo Go environment where native modules are not available
 */
class GoogleAuthService {
  /**
   * Check if Google Sign-in is available (native module loaded)
   * @returns {boolean}
   */
  isAvailable() {
    return GoogleSignin !== null;
  }

  /**
   * Throws an error if Google Sign-in is not available
   * @private
   */
  checkAvailability() {
    if (!this.isAvailable()) {
      throw new Error('Google Sign-in is not available. Please ensure you are running a development build and the module is correctly linked.');
    }
  }
  constructor() {
    if (this.isAvailable()) {
      // Configure with default scopes - these will be requested on sign-in
      // For iOS, scopes in configure() ensure the consent screen shows all permissions
      const defaultScopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/drive', // Include Drive scope here for iOS
      ];

      const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
      const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
      const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

      console.log('[AUTH] 🔍 --- Google Sign-In Configuration Debug ---');
      console.log(`[AUTH] Platform: ${Platform.OS}`);
      console.log(`[AUTH] Web Client ID (Env): ${webClientId}`);
      console.log(`[AUTH] Android Client ID (Env): ${androidClientId}`);
      console.log(`[AUTH] iOS Client ID (Env): ${iosClientId}`);
      console.log(`[AUTH] Default Scopes: ${JSON.stringify(defaultScopes)}`);
      console.log('[AUTH] -----------------------------------');

      // IMPORTANT: Always use Web Client ID for webClientId parameter
      // This is required for server-side token exchange (serverAuthCode)
      // Android Client ID is only for app authentication, not for server token exchange
      // The Web Client ID has a client secret that the server can use
      const effectiveWebClientId = webClientId;

      console.log(`[AUTH] Using webClientId: ${effectiveWebClientId}`);

      if (!effectiveWebClientId) {
        console.warn('[AUTH] ⚠️ No web client ID configured. Google Sign-In may fail.');
      }

      const configOptions = {
        webClientId: effectiveWebClientId, // Platform-specific client ID
        iosClientId: iosClientId, // Required for iOS SDK to work
        scopes: defaultScopes, // Set scopes in configure() for iOS to show in consent screen
        offlineAccess: true, // Required to get serverAuthCode
        forceCodeForRefreshToken: true, // Force showing consent screen to get refresh token
      };

      console.log('[AUTH] 📋 GoogleSignin.configure() called with:', JSON.stringify(configOptions, null, 2));
      GoogleSignin.configure(configOptions);
    }
  }

  /**
   * Configures and signs in the user for the admin flow.
   * This requests all necessary permissions for team features.
   */
  async signInAsAdmin() {
    this.checkAvailability();
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/script.projects',
      'https://www.googleapis.com/auth/script.deployments',
      'https://www.googleapis.com/auth/script.external_request',
    ];
    return this.signIn(scopes);
  }

  /**
   * Configures and signs in the user for the individual flow.
   * This requests only the basic permissions for uploading to their own drive.
   */
  async signInAsIndividual() {
    this.checkAvailability();
    // Use full 'drive' scope instead of 'drive.file' to ensure we can search and create folders
    // 'drive.file' only works for files created by the app, which might not work for folder operations
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/drive', // Full Drive scope for folder operations
    ];
    const result = await this.signIn(scopes);
    
    return result;
  }

  /**
   * Generic sign-in process, called after configuration.
   * @private
   */
  async signIn(scopes = []) {
    try {
      console.log('[AUTH] 🔐 --- Starting Google Sign-In Process ---');
      console.log('[AUTH] Requested scopes:', JSON.stringify(scopes));

      console.log('[AUTH] Checking Google Play Services...');
      await GoogleSignin.hasPlayServices();
      console.log('[AUTH] ✅ Google Play Services available');

      // Sign out locally to ensure clean state
      // NOTE: We do NOT revoke access here because:
      // 1. It would invalidate the refresh token used by team members
      // 2. Google will still show consent screen if new scopes are requested
      try {
        console.log('[AUTH] Signing out to ensure clean state...');
        await GoogleSignin.signOut();
        // Wait a moment to ensure sign out completes
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('[AUTH] ✅ Signed out successfully');
      } catch (signOutError) {
        // Ignore if sign out fails - user might not be signed in
        console.log('[AUTH] Sign out failed (user may not be signed in):', signOutError.message);
      }

      // Sign in with all required scopes
      // After revokeAccess and signOut, this should show the consent screen with all requested permissions including Drive

      console.log('[AUTH] 📞 Calling GoogleSignin.signIn() with scopes:', JSON.stringify({ scopes }));
      const response = await GoogleSignin.signIn({ scopes });
      console.log('[AUTH] ✅ GoogleSignin.signIn() returned response');
      console.log('[AUTH] Response keys:', Object.keys(response));
      console.log('[AUTH] Response type:', response?.type);
      console.log('[AUTH] Has user:', !!response?.user);
      console.log('[AUTH] Has data.user:', !!response?.data?.user);
      console.log('[AUTH] Has serverAuthCode:', !!response?.serverAuthCode);
      console.log('[AUTH] Has data.serverAuthCode:', !!response?.data?.serverAuthCode);

      // If the user cancelled, Google Sign-In SDK returns an object with type "cancelled"
      if (response?.type === 'cancelled') {
        return { error: 'Sign in was cancelled.' };
      }

      // The user object can be in `response.user` (native) or `response.data.user` (web/Expo Go)
      const user = response?.user || response?.data?.user;

      if (user) {
        await this.storeUserInfo(user);
        // Persist serverAuthCode if provided by SDK
        try {
          const serverAuthCode = response?.serverAuthCode || response?.data?.serverAuthCode;
          if (serverAuthCode) {
            await AsyncStorage.setItem(STORAGE_KEYS.SERVER_AUTH_CODE, serverAuthCode);
          } else {
            console.error('[AUTH] ⚠️ CRITICAL: No serverAuthCode found in sign-in response!');
            console.error('[AUTH] Response structure:', Object.keys(response));
            console.error('[AUTH] This means offlineAccess is not working properly');
            console.error('[AUTH] Check: 1) offlineAccess: true in configure(), 2) Web Client ID is set, 3) User granted offline access');
          }
        } catch (e) {
          console.error('[AUTH] Error storing serverAuthCode:', e);
        }
        
        // Verify we got the tokens and check scopes
        try {
          const tokens = await GoogleSignin.getTokens();
          
          // Try to decode token to check scopes (JWT format)
          if (tokens.accessToken) {
            try {
              // JWT tokens have 3 parts separated by dots
              const parts = tokens.accessToken.split('.');
              if (parts.length === 3) {
                // Decode the payload (second part)
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (!payload.scope || !payload.scope.includes('drive')) {
                  console.error('⚠️ WARNING: Drive scope NOT found in token!');
                  console.error('Token scopes:', payload.scope);
                  console.error('You need to add Drive scope to Google Cloud Console OAuth consent screen');
                }
              }
            } catch (decodeError) {
              console.log('Could not decode token (may not be JWT format):', decodeError.message);
            }
          }
        } catch (tokenError) {
          console.warn('Could not get tokens after sign-in:', tokenError);
        }
        
        return { userInfo: user };
      }
      
      // Handle cases where the structure might be different or sign-in was partial
      console.error("User object not found in the expected location in Google Sign-In response.");
      return { error: "Could not retrieve user information from Google." };

    } catch (error) {
      console.error('[AUTH] ❌ --- Google Sign-In Error Occurred ---');
      console.error('[AUTH] Error message:', error.message);
      console.error('[AUTH] Error code:', error.code);
      console.error('[AUTH] Error name:', error.name);

      try {
        console.error('[AUTH] Error Object Keys:', Object.keys(error));
        console.error('[AUTH] Full Error JSON:', JSON.stringify(error, null, 2));
      } catch (e) {
        console.error('[AUTH] Could not stringify error:', e);
      }

      // Log status codes for comparison
      console.error('[AUTH] statusCodes.SIGN_IN_CANCELLED:', statusCodes?.SIGN_IN_CANCELLED);
      console.error('[AUTH] statusCodes.IN_PROGRESS:', statusCodes?.IN_PROGRESS);
      console.error('[AUTH] statusCodes.PLAY_SERVICES_NOT_AVAILABLE:', statusCodes?.PLAY_SERVICES_NOT_AVAILABLE);
      console.error('[AUTH] Error code matches DEVELOPER_ERROR (10)?:', error.code === '10' || error.code === 10);

      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { error: 'Sign in was cancelled.' };
      } else if (error.code === statusCodes.IN_PROGRESS) {
        return { error: 'Sign in is already in progress.' };
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { error: 'Play services not available or outdated.' };
      } else {
        console.error('Google Sign-In Error:', error);
        // Return detailed error for UI
        const errorMsg = error.message || 'Unknown error';
        const errorCode = error.code ? ` (Code: ${error.code})` : '';
        return { error: `Sign-in failed: ${errorMsg}${errorCode}` };
      }
    }
  }

  /**
   * Check if user is already signed in
   * @returns {Promise<boolean>}
   */
  async isSignedIn() {
    if (!this.isAvailable()) {
      return false;
    }
    return await GoogleSignin.isSignedIn();
  }

  /**
   * Silently restore Google Sign-In session
   * This should be called on app startup to restore the SDK session
   * @returns {Promise<void>}
   */
  async signInSilently() {
    this.checkAvailability();
    try {
      const userInfo = await GoogleSignin.signInSilently();
      return userInfo;
    } catch (error) {
      console.error('[AUTH] signInSilently() failed:', error.message);
      throw error;
    }
  }

  /**
   * Get user info from Google
   * @private
   */
  async getUserInfo() {
    this.checkAvailability();
    try {
      const currentUser = await GoogleSignin.getCurrentUser();
      return currentUser ? currentUser.user : null;
    } catch (error) {
      throw new Error('Failed to get user info: ' + error.message);
    }
  }

  /**
   * Signs out the user from the app.
   * IMPORTANT: Does NOT revoke OAuth permissions to preserve team member access.
   * Team members rely on the admin's refresh token stored on the proxy server.
   * Revoking access would invalidate that token and break team member uploads.
   */
  async signOut() {
    this.checkAvailability();
    try {
      // Only sign out locally - do NOT revoke access
      // Revoking would invalidate the refresh token used by team members
      await GoogleSignin.signOut();
      await this.clearUserInfo();
      console.log('[AUTH] Signed out successfully (permissions preserved for team members)');
    } catch (error) {
      console.error('Error during sign out:', error);
      try {
        await this.clearUserInfo();
      } catch (clearError) {
        console.error('Failed to clear user info:', clearError);
      }
      throw new Error('Failed to sign out completely.');
    }
  }

  /**
   * Signs out the user AND revokes all OAuth permissions.
   * This invalidates all refresh tokens, including the one used by team members.
   * ONLY use this when you need to force re-consent (e.g., scope changes).
   */
  async signOutAndRevoke() {
    this.checkAvailability();
    
    // Check if user is signed in before attempting revoke
    let isSignedIn = false;
    try {
      const currentUser = await GoogleSignin.getCurrentUser();
      isSignedIn = currentUser !== null;
    } catch (error) {
      console.log('[AUTH] Could not check sign-in status:', error.message);
    }
    
    // Try to revoke access if user is signed in
    if (isSignedIn) {
      try {
        await GoogleSignin.revokeAccess();
        console.log('[AUTH] Successfully revoked access');
      } catch (revokeError) {
        // Handle 400 errors gracefully - they often mean token is already invalid/expired
        // Error format on iOS: Error Domain=com.google.HTTPStatus Code=400
        const errorCode = revokeError?.code;
        const errorDomain = revokeError?.domain;
        const errorMessage = revokeError?.message || '';
        const errorString = String(revokeError);
        
        // Check for 400 error in various formats
        const is400Error = errorCode === 400 || 
                          errorDomain === 'com.google.HTTPStatus' ||
                          errorMessage.includes('Code=400') ||
                          errorMessage.includes('HTTPStatus Code=400') ||
                          errorString.includes('Code=400') ||
                          errorString.includes('HTTPStatus Code=400');
        
        if (is400Error) {
          console.warn('[AUTH] Revoke access returned 400 (token may already be invalid/expired). Continuing with sign out...');
        } else {
          console.warn('[AUTH] Failed to revoke access (non-critical):', errorMessage || errorString);
        }
        // Continue with sign out even if revoke fails - revoke is not critical for sign out
      }
    } else {
      // User not signed in, nothing to revoke
    }
    
    // Always attempt to sign out and clear user info
    try {
      await GoogleSignin.signOut();
      await this.clearUserInfo();
      console.log('[AUTH] Signed out successfully');
    } catch (signOutError) {
      console.error('[AUTH] Sign out failed:', signOutError);
      // Still try to clear user info
      try {
        await this.clearUserInfo();
      } catch (clearError) {
        console.error('[AUTH] Failed to clear user info:', clearError);
      }
      throw new Error('Failed to sign out completely.');
    }
  }

  /**
   * Clears the stored user info from AsyncStorage.
   * @private
   */
  async clearUserInfo() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.ADMIN_USER_INFO);
      await AsyncStorage.removeItem(STORAGE_KEYS.SERVER_AUTH_CODE);
    } catch (error) {
      console.error('Failed to clear user info:', error);
    }
  }

  /**
   * Get current user info
   * @returns {Promise<object|null>}
   */
  async getCurrentUser() {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      const userInfo = await GoogleSignin.getCurrentUser();
      return userInfo ? userInfo.user : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get fresh access tokens (refresh if needed)
   * @returns {Promise<{accessToken, idToken}>}
   */
  async getTokens() {
    this.checkAvailability();
    try {
      const tokens = await GoogleSignin.getTokens();
      return {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken,
      };
    } catch (error) {
      throw new Error('Failed to get access tokens. Please sign in again.');
    }
  }

  /**
   * Makes an authenticated API request to a Google API.
   * @param {string} url The URL to request.
   * @param {object} options The options for the fetch request.
   * @returns {Promise<Response>} The response from the request.
   */
  async makeAuthenticatedRequest(url, options = {}) {
    this.checkAvailability();
    try {
      // Try to get tokens - this will throw an error if user is not signed in
      let accessToken;
      try {
        const tokens = await GoogleSignin.getTokens();
        accessToken = tokens.accessToken;
      } catch (tokenError) {
        console.log('[AUTH] Failed to get tokens:', tokenError.message);
        const storedUser = await this.getStoredUserInfo();
        if (storedUser) {
          console.log('[AUTH] Found stored user info, but SDK session is not active. User needs to sign in again.');
          throw new Error('Your Google session has expired. Please sign in again.');
        } else {
          throw new Error('Please sign in to continue.');
        }
      }
      
      if (!accessToken) {
        throw new Error('No access token available. Please sign in again.');
      }

      const headers = new Headers(options.headers || {});
      headers.append('Authorization', `Bearer ${accessToken}`);
      if (!headers.has('Content-Type')) {
        headers.append('Content-Type', 'application/json');
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });

      return response;
    } catch (error) {
      console.error('Error making authenticated request:', error);
      if (error.message.includes('access token') || error.message.includes('sign in')) {
        throw error;
      }
      throw new Error('Failed to make authenticated request: ' + error.message);
    }
  }

  /**
   * Store authentication data securely
   * @private
   */
  async storeUserInfo(userInfo) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.ADMIN_USER_INFO, JSON.stringify(userInfo));
    } catch (error) {
      // Error saving data
    }
  }

  /**
   * Clear stored authentication data
   * @private
   */
  async clearAuthData() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.ADMIN_USER_INFO);
    } catch (error) {
      // Error removing data
    }
  }

  /**
   * Get stored user info
   * @returns {Promise<object|null>}
   */
  async getStoredUserInfo() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.ADMIN_USER_INFO);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get serverAuthCode if available
   * @returns {Promise<string|null>}
   */
  async getServerAuthCode() {
    if (!this.isAvailable()) {
      // Still allow reading any stored code even if SDK is not currently available
    }
    try {
      // First try to get from current user (most recent)
      const currentUser = await GoogleSignin.getCurrentUser();
      const code = currentUser?.serverAuthCode || currentUser?.data?.serverAuthCode;
      if (code) {
        return code;
      }
    } catch (e) {
      // Non‑critical: fall back to stored value
    }
    try {
      // Fallback to stored value
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_AUTH_CODE);
      if (stored) {
        return stored;
      } else {
        console.log('[AUTH] No serverAuthCode found - user needs to sign in to Google');
      }
    } catch (e) {
      console.error('[AUTH] Error reading serverAuthCode from storage:', e);
    }
    return null;
  }

  /**
   * Clear the stored serverAuthCode
   * This should be called after successfully using the code, as it's a one-time code
   */
  async clearServerAuthCode() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SERVER_AUTH_CODE);
    } catch (e) {
      console.error('[AUTH] Error clearing serverAuthCode:', e);
      throw e;
    }
  }
}

// Export singleton instance
export default new GoogleAuthService();

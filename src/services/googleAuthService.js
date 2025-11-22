import AsyncStorage from '@react-native-async-storage/async-storage';

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

      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, // MUST be Web Client ID for serverAuthCode
        iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID, // Required for iOS SDK to work
        scopes: defaultScopes, // Set scopes in configure() for iOS to show in consent screen
        offlineAccess: true, // Required to get serverAuthCode
        forceCodeForRefreshToken: true, // Force showing consent screen to get refresh token
      });

      console.log('[AUTH] GoogleSignin configured with:');
      console.log('- webClientId:', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.substring(0, 20) + '...');
      console.log('- iosClientId:', process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.substring(0, 20) + '...');
      console.log('- offlineAccess: true');
      console.log('- forceCodeForRefreshToken: true');
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
    console.log('Requesting scopes for individual sign-in:', scopes);
    const result = await this.signIn(scopes);
    
    // After sign-in, verify we have access token
    if (result && result.userInfo) {
      try {
        const tokens = await GoogleSignin.getTokens();
        console.log('Access token obtained after sign-in');
        console.log('Token scopes should include Drive - verify in Google Cloud Console OAuth consent screen');
      } catch (tokenError) {
        console.error('Failed to get tokens after sign-in:', tokenError);
      }
    }
    
    return result;
  }

  /**
   * Generic sign-in process, called after configuration.
   * @private
   */
  async signIn(scopes = []) {
    try {
      await GoogleSignin.hasPlayServices();
      
      // Sign out locally to ensure clean state
      // NOTE: We do NOT revoke access here because:
      // 1. It would invalidate the refresh token used by team members
      // 2. Google will still show consent screen if new scopes are requested
      try {
        await GoogleSignin.signOut();
        console.log('Signed out to prepare for fresh sign-in');
        // Wait a moment to ensure sign out completes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (signOutError) {
        // Ignore if sign out fails - user might not be signed in
        console.log('Sign out not needed or failed:', signOutError.message);
      }
      
      // Sign in with all required scopes
      // After revokeAccess and signOut, this should show the consent screen with all requested permissions including Drive
      console.log('=== SIGNING IN WITH SCOPES ===');
      console.log('Scopes requested:', JSON.stringify(scopes, null, 2));
      console.log('Make sure these scopes are configured in Google Cloud Console OAuth consent screen!');
      
      const response = await GoogleSignin.signIn({ scopes });
      console.log('Raw userInfo from Google Sign-In:', JSON.stringify(response, null, 2));

      // If the user cancelled, Google Sign-In SDK returns an object with type "cancelled"
      if (response?.type === 'cancelled') {
        console.log('Google Sign-In was cancelled by the user.');
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
            console.log('[AUTH] ✅ serverAuthCode obtained from Google Sign-In');
            console.log('[AUTH] serverAuthCode length:', serverAuthCode.length);
            console.log('[AUTH] Storing serverAuthCode for proxy session');
            await AsyncStorage.setItem(STORAGE_KEYS.SERVER_AUTH_CODE, serverAuthCode);
            console.log('[AUTH] serverAuthCode stored successfully');
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
          console.log('=== TOKEN VERIFICATION ===');
          console.log('Access token obtained:', tokens.accessToken ? 'YES' : 'NO');
          console.log('Token length:', tokens.accessToken?.length || 0);
          
          // Try to decode token to check scopes (JWT format)
          if (tokens.accessToken) {
            try {
              // JWT tokens have 3 parts separated by dots
              const parts = tokens.accessToken.split('.');
              if (parts.length === 3) {
                // Decode the payload (second part)
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                console.log('Token scopes from JWT:', payload.scope || 'Not found in token');
                if (!payload.scope || !payload.scope.includes('drive')) {
                  console.error('⚠️ WARNING: Drive scope NOT found in token!');
                  console.error('Token scopes:', payload.scope);
                  console.error('You need to add Drive scope to Google Cloud Console OAuth consent screen');
                } else {
                  console.log('✅ Drive scope found in token!');
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
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { error: 'Sign in was cancelled.' };
      } else if (error.code === statusCodes.IN_PROGRESS) {
        return { error: 'Sign in is already in progress.' };
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { error: 'Play services not available or outdated.' };
      } else {
        console.error('Google Sign-In Error:', error);
        return { error: 'Something went wrong during sign in.' };
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
      console.log('[AUTH] User not signed in, skipping revoke');
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
    console.log('[AUTH] getServerAuthCode() called');
    if (!this.isAvailable()) {
      console.log('[AUTH] Google Sign-in not available, checking stored serverAuthCode');
    }
    try {
      // First try to get from current user (most recent)
      const currentUser = await GoogleSignin.getCurrentUser();
      console.log('[AUTH] getCurrentUser() result:', currentUser ? 'User found' : 'No user');
      const code = currentUser?.serverAuthCode || currentUser?.data?.serverAuthCode;
      if (code) {
        console.log('[AUTH] ✅ Found serverAuthCode from current user, length:', code.length);
        return code;
      } else {
        console.log('[AUTH] No serverAuthCode in current user, checking storage...');
      }
    } catch (e) {
      console.log('[AUTH] Could not get serverAuthCode from current user:', e.message);
    }
    try {
      // Fallback to stored value
      console.log('[AUTH] Checking AsyncStorage for serverAuthCode...');
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_AUTH_CODE);
      if (stored) {
        console.log('[AUTH] ✅ Found serverAuthCode from storage, length:', stored.length);
        return stored;
      } else {
        console.warn('[AUTH] ❌ No serverAuthCode found in storage');
        console.warn('[AUTH] This means you need to reconnect to get a new serverAuthCode');
      }
    } catch (e) {
      console.error('[AUTH] Error reading serverAuthCode from storage:', e);
    }
    console.log('[AUTH] ❌ No serverAuthCode available - reconnection required');
    return null;
  }

  /**
   * Clear the stored serverAuthCode
   * This should be called after successfully using the code, as it's a one-time code
   */
  async clearServerAuthCode() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SERVER_AUTH_CODE);
      console.log('[AUTH] Cleared serverAuthCode from storage');
    } catch (e) {
      console.error('[AUTH] Error clearing serverAuthCode:', e);
      throw e;
    }
  }
}

// Export singleton instance
export default new GoogleAuthService();

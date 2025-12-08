import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Try to import AppleAuthentication, but handle gracefully if not available
let AppleAuthentication = null;

try {
  AppleAuthentication = require('expo-apple-authentication');
} catch (error) {
  console.error('Failed to load expo-apple-authentication module:', error);
}

const STORAGE_KEYS = {
  APPLE_USER_INFO: '@apple_user_info',
  APPLE_ID_TOKEN: '@apple_id_token',
  APPLE_AUTH_CODE: '@apple_auth_code',
  APPLE_USER_ID: '@apple_user_id',
};

/**
 * Apple Authentication Service
 * Handles Sign in with Apple OAuth flow
 * Provides privacy-focused authentication that meets Apple's requirements
 */
class AppleAuthService {
  /**
   * Check if Apple Authentication is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (Platform.OS !== 'ios') {
      return false;
    }
    if (!AppleAuthentication) {
      return false;
    }
    try {
      return await AppleAuthentication.AppleAuthentication.isAvailableAsync();
    } catch (error) {
      console.error('[APPLE_AUTH] Error checking availability:', error);
      return false;
    }
  }

  /**
   * Throws an error if Apple Sign-in is not available
   * @private
   */
  async checkAvailability() {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('Sign in with Apple is not available on this device.');
    }
  }

  /**
   * Sign in with Apple
   * Requests user's name and email (with option to hide email)
   * @returns {Promise<{userInfo: object, identityToken: string, authorizationCode: string}>}
   */
  async signIn() {
    await this.checkAvailability();

    try {
      const credential = await AppleAuthentication.AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      // Extract user information
      const { user, fullName, email, identityToken, authorizationCode } = credential;

      // Build user info object
      const userInfo = {
        id: user,
        email: email || null,
        name: fullName ? `${fullName.givenName || ''} ${fullName.familyName || ''}`.trim() : null,
        givenName: fullName?.givenName || null,
        familyName: fullName?.familyName || null,
      };

      // Store credentials
      await this.storeUserInfo(userInfo);
      await AsyncStorage.setItem(STORAGE_KEYS.APPLE_ID_TOKEN, identityToken);
      await AsyncStorage.setItem(STORAGE_KEYS.APPLE_AUTH_CODE, authorizationCode);
      await AsyncStorage.setItem(STORAGE_KEYS.APPLE_USER_ID, user);

      console.log('[APPLE_AUTH] ✅ Sign in successful');

      return {
        userInfo,
        identityToken,
        authorizationCode,
      };
    } catch (error) {
      if (error.code === 'ERR_CANCELED' || error.code === 'ERR_REQUEST_CANCELED') {
        console.log('[APPLE_AUTH] User cancelled sign in');
        return { error: 'Sign in was cancelled.' };
      }

      console.error('[APPLE_AUTH] Error during sign in:', error);
      return { error: 'Something went wrong during sign in.' };
    }
  }

  /**
   * Sign out - clears local stored data
   */
  async signOut() {
    try {
      await this.clearUserInfo();
      console.log('[APPLE_AUTH] Signed out successfully');
    } catch (error) {
      console.error('[APPLE_AUTH] Error during sign out:', error);
      throw new Error('Failed to sign out completely.');
    }
  }

  /**
   * Get stored user info
   * @returns {Promise<object|null>}
   */
  async getStoredUserInfo() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.APPLE_USER_INFO);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get stored identity token (for server verification)
   * @returns {Promise<string|null>}
   */
  async getIdentityToken() {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.APPLE_ID_TOKEN);
    } catch (error) {
      console.error('[APPLE_AUTH] Error getting identity token:', error);
      return null;
    }
  }

  /**
   * Get stored authorization code (for server-side token exchange)
   * @returns {Promise<string|null>}
   */
  async getAuthorizationCode() {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.APPLE_AUTH_CODE);
    } catch (error) {
      console.error('[APPLE_AUTH] Error getting authorization code:', error);
      return null;
    }
  }

  /**
   * Get stored user ID
   * @returns {Promise<string|null>}
   */
  async getUserId() {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.APPLE_USER_ID);
    } catch (error) {
      return null;
    }
  }

  /**
   * Clear authorization code after use (it's a one-time code)
   */
  async clearAuthorizationCode() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.APPLE_AUTH_CODE);
    } catch (error) {
      console.error('[APPLE_AUTH] Error clearing authorization code:', error);
    }
  }

  /**
   * Check credential state for a user
   * @param {string} userId - Apple user ID
   * @returns {Promise<string>} - Credential state
   */
  async getCredentialStateForUser(userId) {
    await this.checkAvailability();

    try {
      const credentialState = await AppleAuthentication.AppleAuthentication.getCredentialStateAsync(userId);
      return credentialState;
    } catch (error) {
      console.error('[APPLE_AUTH] Error checking credential state:', error);
      return null;
    }
  }

  /**
   * Store user info
   * @private
   */
  async storeUserInfo(userInfo) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.APPLE_USER_INFO, JSON.stringify(userInfo));
    } catch (error) {
      console.error('[APPLE_AUTH] Error storing user info:', error);
    }
  }

  /**
   * Clear all stored authentication data
   * @private
   */
  async clearUserInfo() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.APPLE_USER_INFO);
      await AsyncStorage.removeItem(STORAGE_KEYS.APPLE_ID_TOKEN);
      await AsyncStorage.removeItem(STORAGE_KEYS.APPLE_AUTH_CODE);
      await AsyncStorage.removeItem(STORAGE_KEYS.APPLE_USER_ID);
    } catch (error) {
      console.error('[APPLE_AUTH] Failed to clear user info:', error);
    }
  }

  /**
   * Check if user is signed in
   * @returns {Promise<boolean>}
   */
  async isSignedIn() {
    const userInfo = await this.getStoredUserInfo();
    return userInfo !== null;
  }
}

// Export singleton instance
export default new AppleAuthService();

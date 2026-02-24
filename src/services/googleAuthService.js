import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const STORAGE_KEY = '@google_user_info';
const SERVER_AUTH_CODE_KEY = '@google_server_auth_code';

// Get client IDs from app config
const getClientIds = () => {
  const extra = Constants.expoConfig?.extra || {};
  return {
    webClientId: extra.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '366423185-r9t2c8bcroqaiii2e6jvokmnovjbog0v.apps.googleusercontent.com',
    iosClientId: extra.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don.apps.googleusercontent.com',
    androidClientId: extra.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '366423185-iru8jpgqfgmtp8j61095fqp3fm0kpai0.apps.googleusercontent.com',
  };
};

class GoogleAuthService {
  constructor() {
    this.isConfigured = false;
    this.currentUser = null;
    this._tokenPromise = null;
    this._cachedTokens = null;
    this._tokenCacheTime = 0;
  }

  configure() {
    if (this.isConfigured) return;

    try {
      const clientIds = getClientIds();

      GoogleSignin.configure({
        webClientId: clientIds.webClientId,
        iosClientId: Platform.OS === 'ios' ? clientIds.iosClientId : undefined,
        offlineAccess: true,
        forceCodeForRefreshToken: true,
        scopes: [
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
      });

      this.isConfigured = true;
      console.log('[GoogleAuthService] Configured successfully');
    } catch (error) {
      console.error('[GoogleAuthService] Configuration error:', error);
    }
  }

  isAvailable() {
    // Google Sign-In is available when running in a native build (not Expo Go)
    try {
      // Check if the native module is available
      return typeof GoogleSignin !== 'undefined' && GoogleSignin.hasPlayServices !== undefined;
    } catch {
      return false;
    }
  }

  async signInAsAdmin() {
    return this._signIn('admin');
  }

  async signInAsIndividual() {
    return this._signIn('individual');
  }

  async _signIn(mode = 'admin') {
    try {
      this.configure();

      // Check if Play Services are available (Android)
      if (Platform.OS === 'android') {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      // Sign in
      const response = await GoogleSignin.signIn();

      if (response.type === 'cancelled') {
        return { error: 'Sign in cancelled' };
      }

      const responseData = response.data;

      // Log the response to understand the structure
      console.log('[GoogleAuthService] Raw response data:', JSON.stringify(responseData, null, 2));

      // Handle both old format (with nested user) and new format (flat structure)
      // v16+ of @react-native-google-signin returns flat structure in data
      const user = responseData.user || responseData;
      const idToken = responseData.idToken || null;
      const serverAuthCode = responseData.serverAuthCode || null;

      // Store the full response for later retrieval
      this.currentUser = responseData;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(responseData));

      // Store server auth code if available
      if (serverAuthCode) {
        await AsyncStorage.setItem(SERVER_AUTH_CODE_KEY, serverAuthCode);
      }

      console.log('[GoogleAuthService] Sign in successful:', user.email);

      // Return userInfo in the format expected by AdminContext
      return {
        success: true,
        userInfo: {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        },
        idToken,
        serverAuthCode,
        mode,
      };
    } catch (error) {
      console.error('[GoogleAuthService] Sign in error:', error);

      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { error: 'Sign in cancelled' };
      } else if (error.code === statusCodes.IN_PROGRESS) {
        return { error: 'Sign in already in progress' };
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { error: 'Play Services not available' };
      }

      return { error: error.message || 'Sign in failed' };
    }
  }

  async isSignedIn() {
    try {
      this.configure();
      // v16+: isSignedIn() is removed, use getCurrentUser() instead
      const currentUser = GoogleSignin.getCurrentUser();
      return currentUser !== null;
    } catch (error) {
      console.error('[GoogleAuthService] isSignedIn error:', error);
      return false;
    }
  }

  async signInSilently() {
    try {
      this.configure();
      const response = await GoogleSignin.signInSilently();

      // v16+: signInSilently returns same format as signIn
      if (response && response.type === 'success' && response.data) {
        this.currentUser = response.data;
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(response.data));
        // Return user info in the expected format
        const user = response.data.user || response.data;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        };
      }

      return null;
    } catch (error) {
      console.log('[GoogleAuthService] Silent sign in failed:', error.message);
      return null;
    }
  }

  async getUserInfo() {
    try {
      if (this.currentUser) {
        const user = this.currentUser.user || this.currentUser;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        };
      }

      const storedInfo = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedInfo) {
        const parsed = JSON.parse(storedInfo);
        this.currentUser = parsed;
        const user = parsed.user || parsed;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        };
      }

      return null;
    } catch (error) {
      console.error('[GoogleAuthService] getUserInfo error:', error);
      return null;
    }
  }

  async signOut() {
    try {
      this.configure();
      await GoogleSignin.signOut();
      this.currentUser = null;
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(SERVER_AUTH_CODE_KEY);
      console.log('[GoogleAuthService] Signed out successfully');
    } catch (error) {
      console.error('[GoogleAuthService] Sign out error:', error);
    }
  }

  async signOutAndRevoke() {
    try {
      this.configure();
      await GoogleSignin.revokeAccess();
      await this.signOut();
      console.log('[GoogleAuthService] Signed out and revoked access');
    } catch (error) {
      console.error('[GoogleAuthService] Sign out and revoke error:', error);
      // Still try to sign out even if revoke fails
      await this.signOut();
    }
  }

  async getCurrentUser() {
    try {
      this.configure();
      // v16+: getCurrentUser() is synchronous
      const currentUser = GoogleSignin.getCurrentUser();
      if (currentUser) {
        this.currentUser = currentUser;
        // Return in expected format
        const user = currentUser.user || currentUser;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        };
      }
      return null;
    } catch (error) {
      console.error('[GoogleAuthService] getCurrentUser error:', error);
      return null;
    }
  }

  async getTokens() {
    // Return cached tokens if still fresh (30 seconds)
    const now = Date.now();
    if (this._cachedTokens && (now - this._tokenCacheTime) < 30000) {
      return this._cachedTokens;
    }

    // If a token request is already in flight, wait for it instead of making a parallel call
    if (this._tokenPromise) {
      return this._tokenPromise;
    }

    this._tokenPromise = (async () => {
      try {
        this.configure();
        const tokens = await GoogleSignin.getTokens();
        this._cachedTokens = tokens;
        this._tokenCacheTime = Date.now();
        return tokens;
      } catch (error) {
        console.error('[GoogleAuthService] getTokens error:', error);
        throw error;
      } finally {
        this._tokenPromise = null;
      }
    })();

    return this._tokenPromise;
  }

  async makeAuthenticatedRequest(url, options = {}) {
    try {
      const tokens = await this.getTokens();

      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });

      return response;
    } catch (error) {
      console.error('[GoogleAuthService] Authenticated request error:', error);
      throw error;
    }
  }

  async getStoredUserInfo() {
    try {
      const storedInfo = await AsyncStorage.getItem(STORAGE_KEY);
      if (storedInfo) {
        const parsed = JSON.parse(storedInfo);
        // Handle both old format (with nested user) and new format (flat structure)
        const user = parsed.user || parsed;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          givenName: user.givenName,
          familyName: user.familyName,
          photo: user.photo,
        };
      }
      return null;
    } catch (error) {
      console.error('[GoogleAuthService] getStoredUserInfo error:', error);
      return null;
    }
  }

  async clearUserInfo() {
    try {
      this.currentUser = null;
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('[GoogleAuthService] clearUserInfo error:', error);
    }
  }

  async getServerAuthCode() {
    try {
      const code = await AsyncStorage.getItem(SERVER_AUTH_CODE_KEY);
      return code;
    } catch (error) {
      console.error('[GoogleAuthService] getServerAuthCode error:', error);
      return null;
    }
  }

  /**
   * Get a fresh serverAuthCode by re-signing in with Google.
   * Tries signInSilently first; falls back to interactive signIn.
   */
  async refreshServerAuthCode() {
    try {
      this.configure();

      // Try silent sign-in first (no UI)
      const silent = await GoogleSignin.signInSilently();
      if (silent?.data?.serverAuthCode) {
        console.log('[GoogleAuthService] Got fresh serverAuthCode via silent sign-in');
        await AsyncStorage.setItem(SERVER_AUTH_CODE_KEY, silent.data.serverAuthCode);
        return silent.data.serverAuthCode;
      }

      // Silent didn't provide auth code - do interactive sign-in
      console.log('[GoogleAuthService] Silent sign-in did not provide serverAuthCode, trying interactive...');
      const response = await GoogleSignin.signIn();
      if (response?.data?.serverAuthCode) {
        console.log('[GoogleAuthService] Got fresh serverAuthCode via interactive sign-in');
        await AsyncStorage.setItem(SERVER_AUTH_CODE_KEY, response.data.serverAuthCode);
        return response.data.serverAuthCode;
      }

      console.warn('[GoogleAuthService] Could not obtain fresh serverAuthCode');
      return null;
    } catch (error) {
      console.warn('[GoogleAuthService] refreshServerAuthCode error:', error?.message);
      return null;
    }
  }

  async clearServerAuthCode() {
    try {
      await AsyncStorage.removeItem(SERVER_AUTH_CODE_KEY);
    } catch (error) {
      console.error('[GoogleAuthService] clearServerAuthCode error:', error);
    }
  }
}

export default new GoogleAuthService();

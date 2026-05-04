import AsyncStorage from '@react-native-async-storage/async-storage';
import { SOFT_TRIAL_KEYCHAIN_SERVICE } from '../constants/softTrial';

let _SecureStore = null;
const _loadSecureStore = async () => {
  if (_SecureStore !== null) return _SecureStore;
  try {
    const mod = await import('expo-secure-store');
    _SecureStore = mod;
  } catch (e) {
    console.warn('[secureStorage] expo-secure-store unavailable, falling back to AsyncStorage:', e?.message);
    _SecureStore = false;
  }
  return _SecureStore;
};

const _options = {
  keychainService: SOFT_TRIAL_KEYCHAIN_SERVICE,
  requireAuthentication: false,
};

/**
 * Read a value, preferring secure storage and falling back to AsyncStorage.
 * Survives reinstall on iOS (Keychain). Best-effort on Android — Android may
 * wipe EncryptedSharedPreferences on uninstall depending on backup settings.
 */
export const readSecure = async (key) => {
  const SecureStore = await _loadSecureStore();
  if (SecureStore && SecureStore.getItemAsync) {
    try {
      const v = await SecureStore.getItemAsync(key, _options);
      if (v != null) return v;
    } catch (e) {
      console.warn('[secureStorage] read failed for', key, e?.message);
    }
  }
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Write a value to BOTH secure storage and AsyncStorage. AsyncStorage acts as
 * a same-install cache; secure storage is the authoritative cross-install
 * source on iOS.
 */
export const writeSecure = async (key, value) => {
  const SecureStore = await _loadSecureStore();
  if (SecureStore && SecureStore.setItemAsync) {
    try {
      await SecureStore.setItemAsync(key, value, _options);
    } catch (e) {
      console.warn('[secureStorage] secure write failed for', key, e?.message);
    }
  }
  try {
    await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.warn('[secureStorage] async write failed for', key, e?.message);
  }
};

export const deleteSecure = async (key) => {
  const SecureStore = await _loadSecureStore();
  if (SecureStore && SecureStore.deleteItemAsync) {
    try {
      await SecureStore.deleteItemAsync(key, _options);
    } catch {}
  }
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
};

export const readSecureJSON = async (key) => {
  const raw = await readSecure(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const writeSecureJSON = async (key, obj) => {
  await writeSecure(key, JSON.stringify(obj));
};

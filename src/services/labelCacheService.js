import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { PHOTO_MODES } from '../constants/rooms';

const LABEL_CACHE_METADATA_KEY = 'label-cache-metadata';
const LABEL_CACHE_DIR = '_labeled_cache';

// Cache version - increment this to invalidate all cached photos
// v2: Native image labeling implementation (replaces ViewShot)
// v3: Added automatic cache validation on app startup
const CACHE_VERSION = 3;

/**
 * Calculate a hash of label settings to determine if cached version is still valid
 */
export const calculateSettingsHash = (settings) => {
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelFontFamily,
    labelMarginVertical,
    labelMarginHorizontal,
  } = settings;

  // Create a string representation of all settings including cache version
  const settingsObj = {
    version: CACHE_VERSION, // Include version to invalidate old cache
    showLabels: showLabels || false,
    beforeLabelPosition: beforeLabelPosition || 'top-left',
    afterLabelPosition: afterLabelPosition || 'top-right',
    labelBackgroundColor: labelBackgroundColor || '#FFD700',
    labelTextColor: labelTextColor || '#000000',
    labelSize: labelSize || 'medium',
    labelFontFamily: labelFontFamily || 'system',
    labelMarginVertical: labelMarginVertical || 10,
    labelMarginHorizontal: labelMarginHorizontal || 10,
  };

  const settingsString = JSON.stringify(settingsObj);

  console.log(`[LabelCache] 🔢 calculateSettingsHash called`, {
    settingsObj,
    settingsString: settingsString.substring(0, 100) + '...',
  });

  // Simple hash function (djb2 algorithm)
  let hash = 5381;
  for (let i = 0; i < settingsString.length; i++) {
    hash = ((hash << 5) + hash) + settingsString.charCodeAt(i);
  }
  const hashResult = Math.abs(hash).toString(36).substring(0, 8); // 8 character hash
  console.log(`[LabelCache] ✅ Hash result: ${hashResult}`);
  return hashResult;
};

/**
 * Get the cache directory path
 */
export const getCacheDir = () => {
  return `${FileSystem.documentDirectory}${LABEL_CACHE_DIR}/`;
};

/**
 * Ensure cache directory exists
 */
export const ensureCacheDir = async () => {
  const cacheDir = getCacheDir();
  const dirInfo = await FileSystem.getInfoAsync(cacheDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  }
  return cacheDir;
};

/**
 * Get cached labeled photo URI if it exists and is valid
 */
export const getCachedLabeledPhoto = async (photo, settingsHash) => {
  const checkId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  try {
    console.log(`[LabelCache:${checkId}] 🔍 Checking cache for photo`, {
      photoId: photo?.id,
      mode: photo?.mode,
      settingsHash,
    });

    if (!photo || !photo.uri || !photo.id) {
      console.log(`[LabelCache:${checkId}] ❌ Invalid photo object`);
      return null;
    }

    // Load metadata
    const metadata = await loadCacheMetadata();
    const cacheKey = `${photo.id}_${photo.mode || 'unknown'}`;
    const cached = metadata[cacheKey];

    if (!cached) {
      console.log(`[LabelCache:${checkId}] ❌ No cache entry found for key: ${cacheKey}`);
      return null;
    }

    console.log(`[LabelCache:${checkId}] 📋 Found cache entry`, {
      cachedHash: cached.settingsHash,
      requestedHash: settingsHash,
      cachedUri: cached.uri?.substring(0, 50) + '...',
    });

    // Check if settings hash matches
    if (cached.settingsHash !== settingsHash) {
      console.log(`[LabelCache:${checkId}] ❌ Settings hash mismatch - cache invalid`);
      return null;
    }

    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(cached.uri);
    if (!fileInfo.exists) {
      console.log(`[LabelCache:${checkId}] ❌ Cached file doesn't exist, removing from metadata`);
      // File was deleted, remove from metadata
      delete metadata[cacheKey];
      await saveCacheMetadata(metadata);
      return null;
    }

    // Check if original photo still exists (if original was deleted, cache is invalid)
    const originalInfo = await FileSystem.getInfoAsync(photo.uri);
    if (!originalInfo.exists) {
      console.log(`[LabelCache:${checkId}] ❌ Original photo doesn't exist, removing cache`);
      // Original deleted, remove cache
      await deleteCachedPhoto(photo);
      return null;
    }

    console.log(`[LabelCache:${checkId}] ✅ Cache HIT! Returning cached URI`);
    return cached.uri;
  } catch (error) {
    console.error(`[LabelCache:${checkId}] ❌ Error checking cache:`, error);
    return null;
  }
};

/**
 * Save labeled photo to cache
 */
export const saveCachedLabeledPhoto = async (photo, labeledUri, settingsHash) => {
  try {
    if (!photo || !photo.id || !labeledUri) {
      return null;
    }

    await ensureCacheDir();

    // Generate cache filename
    const originalFilename = photo.uri.split('/').pop() || `photo_${photo.id}.jpg`;
    const nameWithoutExt = originalFilename.replace(/\.(jpg|jpeg|png)$/i, '');
    const cacheFilename = `${nameWithoutExt}_labeled_${settingsHash}.jpg`;
    const cacheUri = `${getCacheDir()}${cacheFilename}`;

    // Copy labeled photo to cache
    await FileSystem.copyAsync({ from: labeledUri, to: cacheUri });

    // Verify the file was copied
    const cacheInfo = await FileSystem.getInfoAsync(cacheUri);
    if (!cacheInfo.exists) {
      return null;
    }

    // Update metadata
    const metadata = await loadCacheMetadata();
    const cacheKey = `${photo.id}_${photo.mode || 'unknown'}`;
    metadata[cacheKey] = {
      uri: cacheUri,
      settingsHash,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      photoId: photo.id,
      photoMode: photo.mode,
    };

    await saveCacheMetadata(metadata);

    return cacheUri;
  } catch (error) {
    return null;
  }
};

/**
 * Update last used timestamp for cached photo
 */
export const updateCacheLastUsed = async (photo) => {
  try {
    const metadata = await loadCacheMetadata();
    const cacheKey = `${photo.id}_${photo.mode || 'unknown'}`;
    if (metadata[cacheKey]) {
      metadata[cacheKey].lastUsed = Date.now();
      await saveCacheMetadata(metadata);
    }
  } catch (error) {
  }
};

/**
 * Delete cached photo
 */
export const deleteCachedPhoto = async (photo) => {
  try {
    const metadata = await loadCacheMetadata();
    const cacheKey = `${photo.id}_${photo.mode || 'unknown'}`;
    const cached = metadata[cacheKey];

    if (cached) {
      // Delete file
      try {
        await FileSystem.deleteAsync(cached.uri, { idempotent: true });
      } catch (fileError) {
        // File might already be deleted
      }

      // Remove from metadata
      delete metadata[cacheKey];
      await saveCacheMetadata(metadata);
    }
  } catch (error) {
  }
};

/**
 * Clean up old cached photos (older than 30 days or invalid)
 */
export const cleanupOldCache = async (maxAgeDays = 30) => {
  try {
    const metadata = await loadCacheMetadata();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000; // Convert to milliseconds
    const now = Date.now();
    const toDelete = [];

    for (const [key, cached] of Object.entries(metadata)) {
      const age = now - cached.createdAt;
      
      // Delete if too old
      if (age > maxAge) {
        toDelete.push({ key, uri: cached.uri });
        continue;
      }

      // Check if file still exists
      try {
        const fileInfo = await FileSystem.getInfoAsync(cached.uri);
        if (!fileInfo.exists) {
          toDelete.push({ key });
        }
      } catch (error) {
        // File doesn't exist or error accessing
        toDelete.push({ key });
      }
    }

    // Delete files and remove from metadata
    for (const item of toDelete) {
      if (item.uri) {
        try {
          await FileSystem.deleteAsync(item.uri, { idempotent: true });
        } catch (error) {
          // Ignore deletion errors
        }
      }
      delete metadata[item.key];
    }

    if (toDelete.length > 0) {
      await saveCacheMetadata(metadata);
    }

    return toDelete.length;
  } catch (error) {
    return 0;
  }
};

/**
 * Invalidate all cache when settings change
 */
export const invalidateCache = async (newSettingsHash) => {
  try {
    const metadata = await loadCacheMetadata();
    const toDelete = [];

    for (const [key, cached] of Object.entries(metadata)) {
      if (cached.settingsHash !== newSettingsHash) {
        toDelete.push({ key, uri: cached.uri });
      }
    }

    // Delete files
    for (const item of toDelete) {
      try {
        await FileSystem.deleteAsync(item.uri, { idempotent: true });
      } catch (error) {
        // Ignore deletion errors
      }
      delete metadata[item.key];
    }

    if (toDelete.length > 0) {
      await saveCacheMetadata(metadata);
    }

    return toDelete.length;
  } catch (error) {
    return 0;
  }
};

/**
 * Load cache metadata from AsyncStorage
 */
const loadCacheMetadata = async () => {
  try {
    const stored = await AsyncStorage.getItem(LABEL_CACHE_METADATA_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    return {};
  }
};

/**
 * Save cache metadata to AsyncStorage
 */
const saveCacheMetadata = async (metadata) => {
  try {
    await AsyncStorage.setItem(LABEL_CACHE_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
  }
};

/**
 * Clear all cached labeled photos and metadata
 */
export const clearAllCache = async () => {
  try {
    const cacheDir = getCacheDir();
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);

    if (dirInfo.exists) {
      // Delete entire cache directory
      await FileSystem.deleteAsync(cacheDir, { idempotent: true });
      console.log('[LabelCache] Cleared all cached labeled photos');
    }

    // Clear metadata
    await AsyncStorage.removeItem(LABEL_CACHE_METADATA_KEY);
    console.log('[LabelCache] Cleared cache metadata');

    return true;
  } catch (error) {
    console.error('[LabelCache] Error clearing cache:', error);
    return false;
  }
};

/**
 * Check cache version and clear if outdated
 * Call this on app startup to ensure cache is compatible
 */
export const validateCacheVersion = async () => {
  try {
    const CACHE_VERSION_KEY = 'label-cache-version';
    const storedVersion = await AsyncStorage.getItem(CACHE_VERSION_KEY);
    const currentVersion = CACHE_VERSION.toString();

    if (storedVersion !== currentVersion) {
      console.log(`[LabelCache] Cache version mismatch (stored: ${storedVersion}, current: ${currentVersion}). Clearing old cache...`);
      await clearAllCache();
      await AsyncStorage.setItem(CACHE_VERSION_KEY, currentVersion);
      console.log('[LabelCache] Cache cleared and version updated');
      return true;
    }

    console.log('[LabelCache] Cache version is up to date');
    return false;
  } catch (error) {
    console.error('[LabelCache] Error validating cache version:', error);
    return false;
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
  try {
    const metadata = await loadCacheMetadata();
    const cacheDir = getCacheDir();
    const dirInfo = await FileSystem.getInfoAsync(cacheDir);

    let totalSize = 0;
    let fileCount = 0;

    if (dirInfo.exists) {
      const files = await FileSystem.readDirectoryAsync(cacheDir);
      fileCount = files.length;

      for (const file of files) {
        try {
          const fileInfo = await FileSystem.getInfoAsync(`${cacheDir}${file}`);
          if (fileInfo.exists && fileInfo.size) {
            totalSize += fileInfo.size;
          }
        } catch (error) {
          // Ignore errors
        }
      }
    }

    return {
      fileCount,
      totalSize,
      metadataEntries: Object.keys(metadata).length,
    };
  } catch (error) {
    return { fileCount: 0, totalSize: 0, metadataEntries: 0 };
  }
};


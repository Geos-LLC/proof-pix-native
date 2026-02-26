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
// v4: Fixed combined photo double-labeling (Before + After), invalidate potentially incomplete cached photos
// v5: Fixed After label margin double-scaling issue on combined photos
// v6: Added support for all 9 label positions and proper offset handling for combined photos
// v7: Fixed After label position calculation for combined photos (absoluteMargins + correct offset)
// v8: CRITICAL FIX - Image.getSize on Android returns dp (density-independent pixels), not actual pixels.
//     The native module works with actual pixels, so we now multiply by PixelRatio.get() on Android.
//     This was causing After labels to appear at ~half the correct position on combined photos.
// v9: Switched to offset-based approach for After label positioning. No more absoluteMargins or pre-scaled margins.
//     Native code handles all margin scaling, we only provide pixel offsets to shift label to After half.
//     This keeps label sizes consistent across different devices and screen densities.
// v10: Fixed native code (Android & iOS) to apply offsetX/offsetY for ALL position types (left/right/top/bottom).
//      Previously offsets were only applied for center/middle positions, causing After labels to appear
//      at the same position as Before labels on combined photos.
// v11: CRITICAL FIX - Android native code was using getInt() instead of getDouble().toInt() for reading
//      offsetX/offsetY/fontSize/margins from JS config. This caused values to be read incorrectly or as 0.
// v12: Fixed PATH 1 in GlobalBackgroundLabelPreparation to use offsetX/offsetY instead of absoluteMargins.
//      All paths now consistently use the offset-based approach for After label positioning.
// v13: Consolidated After label offset calculation into single shared function (calculateAfterLabelOffsets).
//      All code paths now use one source of truth for offset logic.
// v14: (REVERTED) Incorrectly added PixelRatio conversion.
// v15: CRITICAL FIX - REMOVED PixelRatio conversion from all Image.getSize calls.
//      Image.getSize for file:// URIs (local photos) on Android ALREADY returns actual pixel dimensions.
//      Applying PixelRatio was DOUBLING the dimensions, causing offsetX/offsetY to be 1.4x too large.
//      The native module works with actual file pixels, and Image.getSize returns actual file pixels
//      for local files. No conversion is needed.
// v16: RE-ADDED PixelRatio conversion for Android only. Native logs confirmed Image.getSize returns
//      dp (density-independent pixels) on Android, not actual file pixels. Example: native module sees
//      3840x2576, but Image.getSize returns 1920x1288 (exactly 2x smaller = PixelRatio of 2.0).
//      Without this conversion, After label offsets are half of what they should be.
// v17: Extended PixelRatio fix to CameraScreen.js for combined photos. The prepareCombinedPhotoInBackground
//      and prepareLabeledPhotoInBackground functions were not applying PixelRatio conversion, causing
//      After label offsets to be calculated from dp dimensions instead of actual pixels.
// v18: REMOVED all PixelRatio conversion. Native logcat shows Image.getSize actually returns the SAME
//      dimensions the native module sees when loading the file. The previous PixelRatio conversion was
//      causing offsets to be ~2.8x too large (e.g., offsetX=2025 when native image was 2880 wide,
//      so halfWidth should be 1440, not 2025). Offset values must match actual file dimensions.
// v19: ROOT CAUSE FIX - The issue was that combined photos were being CREATED at dp dimensions (small),
//      then labeling would read the actual file dimensions (small) and calculate correct offsets for
//      the small file, but users expected full-resolution combined photos. The fix:
//      - Apply PixelRatio when CREATING combined photos (CameraScreen.js getSize helper) so they're
//        created at full resolution
//      - Do NOT apply PixelRatio when reading existing files for labeling, since Image.getSize
//        returns actual file dimensions (which are now full resolution)
// v20: CONFIRMED: Image.getSize on Android ALWAYS returns dp, not actual pixels. The native module
//      (BitmapFactory) loads images at actual pixel dimensions. This mismatch was causing After labels
//      to be placed at ~1/PixelRatio of the correct offset. Fixed by applying PixelRatio conversion
//      in labelService.js when passing dimensions to the background preparation service.
//      Combined photos are now created at full resolution (v19 fix), and labeling offsets are now
//      calculated at full resolution to match what the native module sees.
// v21: CRITICAL FIX - Native module downscales images larger than 4096px before labeling. The offset
//      calculation now accounts for this downscaling. When image dimensions exceed 4096, the offsets
//      are scaled down proportionally to match what the native module will actually see.
//      Example: 5760x3864 image → native scales to 4096x2746 (factor 0.711) → offsets scaled too.
// v22: Added watermark support to uploaded photos. Watermark settings (showWatermark, customWatermarkEnabled,
//      watermarkText, watermarkColor, watermarkOpacity) are now included in the settings hash so cached
//      photos are properly invalidated when watermark settings change.
// v23: Added watermarkPosition and watermarkFontFamily to settings hash so cached photos are invalidated
//      when the user changes watermark position or font.
// v24: Added labelCornerStyle, combinedLabelPosition, and labelLanguage to settings hash.
//      labelLanguage is critical — changing the label language changes BEFORE/AFTER text.
const CACHE_VERSION = 24;

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
    labelCornerStyle,
    combinedLabelPosition,
    labelLanguage,
    showWatermark,
    customWatermarkEnabled,
    watermarkText,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkFontFamily,
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
    labelCornerStyle: labelCornerStyle || 'rounded',
    labelMarginVertical: labelMarginVertical || 10,
    labelMarginHorizontal: labelMarginHorizontal || 10,
    combinedLabelPosition: combinedLabelPosition || 'top-left',
    labelLanguage: labelLanguage || 'en',
    // Watermark settings
    showWatermark: showWatermark ?? true,
    customWatermarkEnabled: customWatermarkEnabled || false,
    watermarkText: customWatermarkEnabled ? (watermarkText || 'Created with ProofPix.app') : 'Created with ProofPix.app',
    watermarkColor: watermarkColor || '#FFD700',
    watermarkOpacity: typeof watermarkOpacity === 'number' ? watermarkOpacity : 0.5,
    watermarkPosition: watermarkPosition || 'right-bottom',
    watermarkFontFamily: watermarkFontFamily || 'Alexandria_400Regular',
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


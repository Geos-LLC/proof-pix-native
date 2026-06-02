/**
 * Label Service
 * Handles label preparation for photos before upload
 * Extracted to separate file to avoid circular dependencies
 */

import { Image, PixelRatio, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import backgroundLabelPreparationService from './backgroundLabelPreparationService';
import { getCachedLabeledPhoto, calculateSettingsHash } from './labelCacheService';
import { readSecureJSON } from './secureStorageService';

/**
 * Ensure a photo has its label applied (either from cache or prepare it)
 * @param {Object} photo - Photo object with id, uri, type/mode
 * @param {Object} [opts] - Optional pre-computed values to skip redundant reads
 * @param {string} [opts.settingsHash] - Pre-computed settings hash (skips AsyncStorage read)
 * @param {boolean} [opts.skipCacheCheck] - Skip cache check (already done by caller)
 * @returns {Promise<string>} - URI of labeled photo (or original if labeling disabled/failed)
 */
export async function ensureLabelForPhoto(photo, opts = {}) {
  // Only apply to before/after photos (combined/mix usually handled elsewhere or don't need standard labels)
  // Check both type and mode to be safe
  const effectiveType = photo.type || photo.mode;
  if (effectiveType !== 'before' && effectiveType !== 'after' && effectiveType !== 'combined' && effectiveType !== 'mix') {
    return photo.uri;
  }

  let settingsHash = opts.settingsHash || null;

  if (!opts.skipCacheCheck) {
    try {
      // First, check if labels are already cached from background preparation.
      // Reads from Keychain on iOS so settings survive reinstall.
      const settings = (await readSecureJSON('app-settings')) || {};

      // If labels are disabled, return original (default to true if not set)
      if (settings.showLabels === false) {
        console.log(`[LABEL] Labels disabled in settings, using original URI for ${photo.id}`);
        return photo.uri;
      }

      if (!settingsHash) {
        settingsHash = calculateSettingsHash(settings);
      }
      const photoWithMode = { ...photo, mode: effectiveType };

      // Check cache first - this is where background-prepared labels are stored
      const cachedUri = await getCachedLabeledPhoto(photoWithMode, settingsHash);
      if (cachedUri) {
        console.log(`[LABEL] ✅ Using cached labeled photo for ${photo.id}: ${cachedUri.substring(0, 50)}...`);
        return cachedUri;
      }

      console.log(`[LABEL] ⚠️ No cached label found for ${photo.id}, queueing preparation...`);
    } catch (error) {
      console.warn('[LABEL] Error checking label cache:', error);
    }
  }

  // If not cached, queue for preparation (fallback)
  return new Promise((resolve) => {
    // Timeout safety: if labeling takes too long (e.g. service not running), proceed with original
    const timeoutId = setTimeout(() => {
      console.warn(`[LABEL] ⚠️ Label preparation timed out for ${photo.id}, using original URI`);
      resolve(photo.uri);
    }, 30000); // 30 seconds - combined photos need composite + 2 label operations

    // Get image dimensions required for labeling service
    Image.getSize(
      photo.uri,
      async (width, height) => {
        // CRITICAL: On Android, Image.getSize returns dp (density-independent pixels), NOT actual file pixels.
        // The native labeling module (BitmapFactory) loads the image at actual pixel dimensions.
        // We must multiply by PixelRatio to match what the native module sees.
        const pixelRatio = Platform.OS === 'android' ? PixelRatio.get() : 1;
        const actualWidth = Math.round(width * pixelRatio);
        const actualHeight = Math.round(height * pixelRatio);

        console.log(`[LABEL] 📐 Image dimensions for ${photo.id || photo.filename}:`, {
          actualWidth,
          actualHeight,
          type: effectiveType,
        });

        // Use pre-computed hash or compute once
        let prepSettingsHash = settingsHash;
        if (!prepSettingsHash) {
          try {
            const prepSettings = (await readSecureJSON('app-settings')) || {};
            prepSettingsHash = calculateSettingsHash(prepSettings);
          } catch (e) {
            console.warn('[LABEL] Failed to get settings hash for preparation:', e);
          }
        }

        console.log(`[LABEL] 📋 Queueing preparation for ${effectiveType} photo ${photo.id}`);

        // Queue the preparation with ACTUAL PIXEL dimensions (converted from dp on Android)
        backgroundLabelPreparationService.queuePreparation({
          photo: {
            ...photo,
            id: photo.id || `temp_${Date.now()}`,
            uri: photo.uri,
            mode: effectiveType
          },
          width: actualWidth,
          height: actualHeight,
          settingsHash: prepSettingsHash,
          resolve: (labeledUri) => {
            clearTimeout(timeoutId);
            resolve(labeledUri);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            console.warn('[LABEL] Label preparation failed in service, using original:', error);
            resolve(photo.uri);
          }
        });
      },
      (error) => {
        clearTimeout(timeoutId);
        console.warn('[LABEL] Failed to get image dimensions for labeling:', error);
        resolve(photo.uri);
      }
    );
  });
}

/**
 * Batch-optimized label check for multiple photos.
 * Reads settings and cache metadata ONCE, then checks all photos against shared data.
 * Falls back to ensureLabelForPhoto() for any photo not found in cache.
 * @param {Array} photos - Array of photo objects with id, uri, type/mode
 * @param {Object} [opts] - Options
 * @param {Function} [opts.onProgress] - Progress callback (completed, total)
 * @returns {Promise<Array>} - Array of { photo, labeledUri } objects
 */
export async function ensureLabelsForPhotoBatch(photos, opts = {}) {
  // Read settings ONCE
  let settings = {};
  let settingsHash = null;
  let labelsEnabled = true;

  try {
    settings = (await readSecureJSON('app-settings')) || {};
    labelsEnabled = settings.showLabels !== false;
    if (labelsEnabled) {
      settingsHash = calculateSettingsHash(settings);
    }
  } catch (e) {
    console.warn('[LABEL_BATCH] Error reading settings:', e);
  }

  // If labels disabled, return all originals immediately
  if (!labelsEnabled) {
    console.log('[LABEL_BATCH] Labels disabled, returning all originals');
    return photos.map(p => ({ photo: p, labeledUri: p.uri }));
  }

  // Read cache metadata ONCE
  let cacheMetadata = {};
  try {
    const stored = await AsyncStorage.getItem('label-cache-metadata');
    cacheMetadata = stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.warn('[LABEL_BATCH] Error reading cache metadata:', e);
  }

  // Check all photos against cache in parallel (only file existence checks, no AsyncStorage)
  const { onProgress } = opts;
  let completed = 0;
  const total = photos.length;

  const results = await Promise.all(photos.map(async (photo) => {
    const effectiveType = photo.type || photo.mode;
    if (effectiveType !== 'before' && effectiveType !== 'after' && effectiveType !== 'combined' && effectiveType !== 'mix') {
      completed++;
      if (onProgress) onProgress(completed, total);
      return { photo, labeledUri: photo.uri };
    }

    const cacheKey = `${photo.id}_${effectiveType}`;
    const cached = cacheMetadata[cacheKey];

    if (cached && cached.settingsHash === settingsHash) {
      // Quick file existence check (no AsyncStorage needed)
      try {
        const fileInfo = await FileSystem.getInfoAsync(cached.uri);
        if (fileInfo.exists) {
          completed++;
          if (onProgress) onProgress(completed, total);
          return { photo, labeledUri: cached.uri };
        }
      } catch (e) {
        // File check failed, fall through
      }
    }

    // Not in cache or file missing — prepare label with timeout.
    // UI shows "Preparing labels X/Y" progress, so user knows it's working.
    // 30s per photo allows time for combined photos (composite + 2 labels).
    // Pass pre-computed settingsHash and skip cache check (already done above).
    try {
      const photoWithType = { ...photo, type: effectiveType };
      const labeledUri = await Promise.race([
        ensureLabelForPhoto(photoWithType, { settingsHash, skipCacheCheck: true }),
        new Promise((resolve) => setTimeout(() => {
          console.warn(`[LABEL_BATCH] ⚠️ Timeout for ${photo.id} (mode: ${effectiveType}), using original URI`);
          resolve(photo.uri);
        }, 30000))
      ]);
      completed++;
      if (onProgress) onProgress(completed, total);
      return { photo, labeledUri };
    } catch (e) {
      console.warn(`[LABEL_BATCH] Failed for ${photo.id}:`, e.message);
      completed++;
      if (onProgress) onProgress(completed, total);
      return { photo, labeledUri: photo.uri };
    }
  }));

  return results;
}

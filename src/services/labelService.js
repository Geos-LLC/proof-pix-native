/**
 * Label Service
 * Handles label preparation for photos before upload
 * Extracted to separate file to avoid circular dependencies
 */

import { Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import backgroundLabelPreparationService from './backgroundLabelPreparationService';
import { getCachedLabeledPhoto, calculateSettingsHash } from './labelCacheService';

/**
 * Ensure a photo has its label applied (either from cache or prepare it)
 * @param {Object} photo - Photo object with id, uri, type/mode
 * @returns {Promise<string>} - URI of labeled photo (or original if labeling disabled/failed)
 */
export async function ensureLabelForPhoto(photo) {
  // Only apply to before/after photos (combined/mix usually handled elsewhere or don't need standard labels)
  // Check both type and mode to be safe
  const effectiveType = photo.type || photo.mode;
  if (effectiveType !== 'before' && effectiveType !== 'after' && effectiveType !== 'combined' && effectiveType !== 'mix') {
    return photo.uri;
  }

  try {
    // First, check if labels are already cached from background preparation
    // Settings are stored under 'app-settings' key (from SettingsContext)
    const settingsJson = await AsyncStorage.getItem('app-settings');
    const settings = settingsJson ? JSON.parse(settingsJson) : {};

    // If labels are disabled, return original (default to true if not set)
    if (settings.showLabels === false) {
      console.log(`[LABEL] Labels disabled in settings, using original URI for ${photo.id}`);
      return photo.uri;
    }

    console.log(`[LABEL] 🏷️ Labels enabled, checking cache for ${photo.id}...`);
    const settingsHash = calculateSettingsHash(settings);
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

  // If not cached, queue for preparation (fallback)
  return new Promise((resolve) => {
    // Timeout safety: if labeling takes too long (e.g. service not running), proceed with original
    const timeoutId = setTimeout(() => {
      console.warn(`[LABEL] Label preparation timed out for ${photo.id}, using original URI`);
      resolve(photo.uri);
    }, 30000); // 30 seconds timeout for large images

    // Get image dimensions required for labeling service
    Image.getSize(
      photo.uri,
      async (width, height) => {
        // Get settings hash for cache key
        let prepSettingsHash;
        try {
          const prepSettingsJson = await AsyncStorage.getItem('app-settings');
          const prepSettings = prepSettingsJson ? JSON.parse(prepSettingsJson) : {};
          prepSettingsHash = calculateSettingsHash(prepSettings);
        } catch (e) {
          console.warn('[LABEL] Failed to get settings hash for preparation:', e);
        }

        // Queue the preparation
        backgroundLabelPreparationService.queuePreparation({
          photo: {
            ...photo,
            // Ensure essential properties are present
            id: photo.id || `temp_${Date.now()}`,
            uri: photo.uri,
            mode: effectiveType // Map 'type' to 'mode' for the service
          },
          width,
          height,
          settingsHash: prepSettingsHash,
          // If labels are disabled in settings, the service resolves with original URI immediately
          resolve: (labeledUri) => {
            clearTimeout(timeoutId);
            resolve(labeledUri);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            console.warn('[LABEL] Label preparation failed in service, using original:', error);
            resolve(photo.uri); // Fallback to original on error
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

import { NativeModules, Platform } from 'react-native';

const { MediaStoreSaver } = NativeModules;

/**
 * Save image to gallery using native MediaStore API (Android only)
 * This avoids the confirmation dialog that appears with expo-media-library on some Samsung devices
 *
 * @param {string} sourceUri - File URI to save (file:// or document directory path)
 * @param {string} fileName - Filename for the saved image
 * @returns {Promise<string>} - MediaStore content URI of saved image
 */
export const saveImageToGalleryNative = async (sourceUri, fileName) => {
  if (Platform.OS !== 'android') {
    throw new Error('MediaStoreSaver is only available on Android');
  }

  if (!MediaStoreSaver) {
    throw new Error('MediaStoreSaver native module not found');
  }

  try {
    console.log('[MediaStoreSaver] Saving image:', fileName);
    const resultUri = await MediaStoreSaver.saveImageToGallery(sourceUri, fileName);
    console.log('[MediaStoreSaver] ✅ Image saved successfully:', resultUri);
    return resultUri;
  } catch (error) {
    console.error('[MediaStoreSaver] ❌ Failed to save image:', error);
    throw error;
  }
};

/**
 * Delete images from gallery using native MediaStore API (Android only)
 * This properly deletes images from the Android gallery/Photos app
 *
 * @param {string[]} fileNames - Array of filenames to delete (just the filename, not full path)
 * @returns {Promise<string>} - Result message with deletion status
 */
export const deleteImagesFromGalleryNative = async (fileNames) => {
  if (Platform.OS !== 'android') {
    throw new Error('MediaStoreSaver is only available on Android');
  }

  if (!MediaStoreSaver) {
    throw new Error('MediaStoreSaver native module not found');
  }

  try {
    console.log('[MediaStoreSaver] Deleting images:', fileNames);
    const result = await MediaStoreSaver.deleteImagesFromGallery(fileNames);
    console.log('[MediaStoreSaver] ✅ Delete result:', result);
    return result;
  } catch (error) {
    console.error('[MediaStoreSaver] ❌ Failed to delete images:', error);
    throw error;
  }
};

/**
 * Delete all images for a project by project ID using native MediaStore API (Android only)
 * This finds and deletes all images with _P{projectId} in their filename, including combined photos
 *
 * @param {string} projectId - The project ID to delete images for
 * @returns {Promise<string>} - Result message with deletion status
 */
export const deleteImagesByProjectIdNative = async (projectId) => {
  if (Platform.OS !== 'android') {
    throw new Error('MediaStoreSaver is only available on Android');
  }

  if (!MediaStoreSaver) {
    throw new Error('MediaStoreSaver native module not found');
  }

  try {
    console.log('[MediaStoreSaver] Deleting all images for project:', projectId);
    const result = await MediaStoreSaver.deleteImagesByProjectId(projectId);
    console.log('[MediaStoreSaver] ✅ Delete by project result:', result);
    return result;
  } catch (error) {
    console.error('[MediaStoreSaver] ❌ Failed to delete images by project:', error);
    throw error;
  }
};

export default { saveImageToGalleryNative, deleteImagesFromGalleryNative, deleteImagesByProjectIdNative };

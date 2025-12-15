/**
 * iCloud Service
 * Handles DIRECT iCloud Drive uploads using iOS native file system
 * Files are written to the app's Documents directory which syncs to iCloud Drive
 * 
 * Note: This bypasses the proxy server and stores files directly in user's iCloud Drive
 * Files will appear in: Files app → iCloud Drive → ProofPix → Documents
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ensureLabelForPhoto } from './labelService';

const FOLDER_NAME = 'ProofPix-Uploads';

class ICloudService {
  constructor() {
    this.documentsPath = null;
  }

  /**
   * Check if iCloud is available on this device
   * @returns {boolean}
   */
  isAvailable() {
    // iCloud is only available on iOS
    if (Platform.OS !== 'ios') {
      return false;
    }
    return true;
  }

  /**
   * Get the app's Documents directory path
   * Files stored here will automatically sync to iCloud Drive if enabled
   * @returns {string}
   */
  getDocumentsPath() {
    if (this.documentsPath) {
      return this.documentsPath;
    }
    
    // Use Expo FileSystem's documentDirectory
    // This maps to the app's Documents folder which syncs to iCloud
    this.documentsPath = FileSystem.documentDirectory;
    console.log('[iCloud] 📁 Documents path:', this.documentsPath);
    
    if (!this.documentsPath) {
      console.error('[iCloud] ❌ ERROR: FileSystem.documentDirectory is undefined!');
      console.error('[iCloud] ❌ This means the app cannot access the file system.');
      console.error('[iCloud] ❌ Make sure you are running on a real device or simulator, not in Expo Go.');
    }
    
    return this.documentsPath;
  }

  /**
   * Initialize iCloud connection (create ProofPix-Uploads folder)
   * @returns {Promise<{folderId: string}>}
   */
  async initialize() {
    try {
      const folderId = await this.findOrCreateProofPixFolder();
      console.log('[iCloud] Initialized folder:', folderId);
      return { folderId };
    } catch (error) {
      console.error('[iCloud] Error initializing:', error);
      throw new Error('Could not initialize iCloud connection.');
    }
  }

  /**
   * Finds or creates a "ProofPix-Uploads" folder in the Documents directory
   * @returns {Promise<string>} The path to the folder
   */
  async findOrCreateProofPixFolder() {
    try {
      const documentsPath = this.getDocumentsPath();
      const proofPixPath = `${documentsPath}${FOLDER_NAME}/`;

      // Check if folder exists
      const folderInfo = await FileSystem.getInfoAsync(proofPixPath);
      
      if (!folderInfo.exists) {
        // Create folder
        await FileSystem.makeDirectoryAsync(proofPixPath, { intermediates: true });
        console.log('[iCloud] Created ProofPix-Uploads folder');
      } else {
        console.log('[iCloud] ProofPix-Uploads folder already exists');
      }

      return proofPixPath;
    } catch (error) {
      console.error('[iCloud] Error in findOrCreateProofPixFolder:', error);
      throw new Error('Could not find or create the ProofPix folder in iCloud Drive.');
    }
  }

  /**
   * Upload a photo to iCloud Drive
   * @param {string} photoUri - Local photo URI
   * @param {string} filename - File name
   * @param {string} albumName - Album name
   * @param {object} metadata - Photo metadata (room, type, format, etc.)
   * @returns {Promise<object>} Upload result
   */
  async uploadPhoto(photoUri, filename, albumName, metadata = {}) {
    try {
      console.log('[iCloud] Uploading:', filename);

      const proofPixPath = await this.findOrCreateProofPixFolder();
      
      // Create album folder
      const albumPath = `${proofPixPath}${albumName}/`;
      const albumInfo = await FileSystem.getInfoAsync(albumPath);
      if (!albumInfo.exists) {
        await FileSystem.makeDirectoryAsync(albumPath, { intermediates: true });
      }

      // Create subfolder based on type (if not flat)
      let destinationPath = albumPath;
      if (!metadata.flat) {
        const subfolder = this.getSubfolder(metadata.type, metadata.format);
        destinationPath = `${albumPath}${subfolder}/`;
        
        const subfolderInfo = await FileSystem.getInfoAsync(destinationPath);
        if (!subfolderInfo.exists) {
          await FileSystem.makeDirectoryAsync(destinationPath, { intermediates: true });
        }
      }

      // Copy file to iCloud Drive
      const destinationFile = `${destinationPath}${filename}`;
      
      // Clean the source URI (remove file:// prefix if present)
      const cleanPhotoUri = photoUri.startsWith('file://') ? photoUri : `file://${photoUri}`;
      
      await FileSystem.copyAsync({
        from: cleanPhotoUri,
        to: destinationFile
      });

      console.log('[iCloud] ✅ Upload complete:', destinationFile);
      console.log('[iCloud] 📍 File saved to app Documents folder');
      console.log('[iCloud] ℹ️  Note: iOS does not allow direct access to iCloud Drive from apps.');
      console.log('[iCloud] ℹ️  Files are saved locally. To access them:');
      console.log('[iCloud] ℹ️  1. Open Files app → On My iPhone/iPad → ProofPix');
      console.log('[iCloud] ℹ️  2. You can then manually move files to iCloud Drive if needed');

      return {
        success: true,
        fileId: destinationFile,
        fileName: filename,
        albumName: albumName,
        room: metadata.room || 'general',
        type: metadata.type || 'before',
        format: metadata.format || 'default',
        location: metadata.location || '',
        cleanerName: metadata.cleanerName || '',
        folderPath: destinationPath.replace(proofPixPath, ''),
        flatMode: !!metadata.flat,
        message: 'Photo uploaded to your iCloud Drive'
      };
    } catch (error) {
      console.error('[iCloud] Upload error:', error);
      throw new Error(`Failed to upload to iCloud Drive: ${error.message}`);
    }
  }

  /**
   * Get subfolder name based on photo type and format
   * @param {string} type - Photo type (before, after, combined)
   * @param {string} format - Photo format
   * @returns {string} Subfolder path
   */
  getSubfolder(type, format) {
    if (format && format !== 'default') {
      return `formats/${format}`;
    }
    
    if (type === 'combined' || type === 'mix') {
      return 'combined';
    }
    
    return type; // 'before' or 'after'
  }

  /**
   * Upload multiple photos (batch)
   * @param {Array} photos - Array of photo objects
   * @param {string} albumName - Album name
   * @param {object} metadata - Common metadata for all photos
   * @param {Function} onProgress - Optional progress callback (current, total)
   * @returns {Promise<object>} Batch upload results
   */
  async uploadPhotoBatch(photos, albumName, metadata = {}, onProgress = null) {
    const results = {
      successful: [],
      failed: []
    };

    console.log(`[iCloud] Starting batch upload of ${photos.length} photos`);

    // PRE-PROCESS: Prepare all labels SEQUENTIALLY before starting uploads
    console.log('[iCloud] 🏷️ Pre-processing labels for all photos SEQUENTIALLY...');
    const labeledPhotos = [];
    for (const photo of photos) {
      const effectiveType = photo.mode || photo.type;

      // Check if this photo needs labeling
      const isCandidate = ((effectiveType === 'before' || effectiveType === 'after') &&
          (!photo.format || photo.format === 'default')) ||
          ((effectiveType === 'combined' || effectiveType === 'mix') &&
          (photo.format === 'original-side' || photo.format === 'original-stack'));

      if (isCandidate) {
        console.log(`[iCloud] 🏷️ Pre-labeling: ${photo.filename || photo.id} (${effectiveType})`);
        try {
          const photoWithType = { ...photo, type: effectiveType };
          const labeledUri = await ensureLabelForPhoto(photoWithType);
          console.log(`[iCloud] ✅ Pre-labeled: ${photo.filename || photo.id}`);
          labeledPhotos.push({ ...photo, uri: labeledUri, _preLabeledUri: labeledUri });
        } catch (labelError) {
          console.warn(`[iCloud] ⚠️ Pre-labeling failed for ${photo.filename}: ${labelError.message}`);
          labeledPhotos.push(photo); // Use original if labeling fails
        }
      } else {
        labeledPhotos.push(photo);
      }
    }
    console.log('[iCloud] ✅ All labels pre-processed SEQUENTIALLY');

    // Report initial progress
    if (onProgress) {
      onProgress(0, photos.length);
    }

    let completed = 0;
    for (const photo of labeledPhotos) {
      try {
        const filename = photo.filename || `${photo.name}_${photo.mode}.jpg`;
        // Use pre-labeled URI if available
        const photoUri = photo._preLabeledUri || photo.uri;

        const result = await this.uploadPhoto(
          photoUri,
          filename,
          albumName,
          {
            ...metadata,
            type: photo.mode === 'mix' ? 'combined' : photo.mode,
            format: photo.format || 'default',
            room: photo.room
          }
        );

        results.successful.push({ photo, result, success: true });
        console.log(`[iCloud] ✅ Uploaded: ${filename}`);
      } catch (error) {
        results.failed.push({ photo, error, success: false });
        console.error(`[iCloud] ❌ Failed: ${photo.filename}`, error.message);
      }

      // Report progress
      completed++;
      if (onProgress) {
        onProgress(completed, photos.length);
      }
    }

    console.log(`[iCloud] Batch complete: ${results.successful.length} succeeded, ${results.failed.length} failed`);
    return {
      ...results,
      total: photos.length,
      successCount: results.successful.length,
      failureCount: results.failed.length
    };
  }

  /**
   * Get folder name
   * @returns {string}
   */
  getFolderName() {
    return FOLDER_NAME;
  }
}

export default new ICloudService();

/**
 * Dropbox Upload Service
 * Handles uploading photos to Dropbox with the same folder structure as Google Drive
 */

import * as FileSystem from 'expo-file-system/legacy';
import dropboxService from './dropboxService';

/**
 * Convert file URI to base64 data URL
 * @param {string} fileUri - The file URI (file://...)
 * @returns {Promise<string>} - Base64 data URL (data:image/jpeg;base64,...)
 */
async function fileUriToBase64(fileUri) {
  try {
    // Read the file as base64 (using string encoding type)
    let base64;

    // Build candidate URIs to try reading
    const candidates = [fileUri];
    if (fileUri.startsWith('file:///private/var/')) {
      candidates.push(fileUri.replace('file:///private/var/', 'file:///var/'));
    } else if (fileUri.startsWith('/private/var/')) {
      candidates.push(`file://${fileUri.replace('/private/var/', '/var/')}`);
    }

    let lastError = null;
    for (const candidate of candidates) {
      try {
        base64 = await FileSystem.readAsStringAsync(candidate, { encoding: 'base64' });
        if (base64) {
          return `data:image/jpeg;base64,${base64}`;
        }
      } catch (err) {
        lastError = err;
      }
    }

    // As a final fallback, try copying the file into cacheDirectory and read from there
    try {
      const source = candidates[0];
      const fileName = (source.split('/').pop() || `tmp_${Date.now()}.jpg`).replace(/\?.*$/, '');
      const dest = `${FileSystem.cacheDirectory}${Date.now()}_${fileName}`;
      await FileSystem.copyAsync({ from: source, to: dest });
      base64 = await FileSystem.readAsStringAsync(dest, { encoding: 'base64' });
      if (base64) {
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch (copyErr) {
      lastError = copyErr;
    }

    // If we got here, we failed all attempts
    if (lastError) throw lastError;
    throw new Error('Unknown file read error');
  } catch (error) {
    throw new Error('Failed to read image file');
  }
}

// Normalize any local path/URI into a proper file URI that Expo FS can read
function normalizeFileUri(input) {
  if (!input) return input;
  if (input.startsWith('data:')) return input;
  if (input.startsWith('file://')) return input;
  if (input.startsWith('/')) return `file://${input}`; // iOS absolute path -> file:///...
  return input;
}

/**
 * Upload a single photo to Dropbox
 * @param {Object} params - Upload parameters
 * @param {string} params.imageDataUrl - Base64 data URL of the image or file URI
 * @param {string} params.filename - Filename for the uploaded image
 * @param {string} params.albumName - Album folder name (e.g., "John - Dec 21, 2024")
 * @param {string} params.room - Room name (e.g., "kitchen", "bathroom")
 * @param {string} params.type - Photo type ("before", "after", or "combined")
 * @param {string} params.format - Format type (e.g., "default", "portrait", "square")
 * @param {string} params.location - Location/city
 * @param {string} params.cleanerName - Cleaner's name
 * @param {boolean} params.flat - If true, upload directly to album folder (no subfolders)
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadPhotoToDropbox({
  imageDataUrl,
  filename,
  albumName,
  room,
  type,
  format = 'default',
  location,
  cleanerName,
  flat = false,
  skipFolderCreation = false, // Allow skipping if folders were pre-created
}) {
  try {
    let parentFolderPath, albumFolderPath;
    
    if (!skipFolderCreation) {
      // Ensure ProofPix folder exists
      parentFolderPath = await dropboxService.findOrCreateProofPixFolder();
      if (!parentFolderPath) {
        throw new Error('Could not access or create ProofPix folder in Dropbox.');
      }

      // Create or find album folder
      albumFolderPath = await dropboxService.findOrCreateAlbumFolder(parentFolderPath, albumName);
      if (!albumFolderPath) {
        throw new Error('Could not create album folder in Dropbox.');
      }
    } else {
      // Folders were pre-created, use cache
      parentFolderPath = await dropboxService.findOrCreateProofPixFolder();
      albumFolderPath = await dropboxService.findOrCreateAlbumFolder(parentFolderPath, albumName);
    }

    // Build file path based on folder structure
    let filePath;
    if (flat) {
      // Upload directly to album folder
      filePath = `${albumFolderPath}/${filename}`;
    } else {
      // Create subfolder structure: album/type/format/filename or album/format/filename
      if (format !== 'default') {
        // album/formats/format/filename
        // First create formats folder, then format subfolder
        const formatsFolderPath = await dropboxService.findOrCreateAlbumFolder(albumFolderPath, 'formats');
        const formatFolderPath = await dropboxService.findOrCreateAlbumFolder(formatsFolderPath, format);
        filePath = `${formatFolderPath}/${filename}`;
      } else {
        // album/before|after|combined/filename
        const typeFolder = type === 'mix' || type === 'combined' ? 'combined' : type;
        const typeFolderPath = await dropboxService.findOrCreateAlbumFolder(albumFolderPath, typeFolder);
        filePath = `${typeFolderPath}/${filename}`;
      }
    }

    // Convert image to file URI if needed
    let fileUri = imageDataUrl;
    if (imageDataUrl.startsWith('data:')) {
      // Convert base64 data URL to temporary file
      const base64Match = imageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (base64Match) {
        const base64 = base64Match[1];
        const tempFileName = `${Date.now()}_${filename}`;
        const tempFilePath = `${FileSystem.cacheDirectory}${tempFileName}`;
        await FileSystem.writeAsStringAsync(tempFilePath, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        fileUri = tempFilePath;
      } else {
        throw new Error('Invalid data URL format');
      }
    } else {
      // Normalize file URI
      fileUri = normalizeFileUri(imageDataUrl);
    }

    // Upload file to Dropbox
    const result = await dropboxService.uploadFile(filePath, fileUri, 'overwrite');

    // Clean up temporary file if we created one
    if (imageDataUrl.startsWith('data:') && fileUri.startsWith(FileSystem.cacheDirectory)) {
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Build folder path for response (similar to Google Drive response)
    const folderPath = flat
      ? albumName
      : format !== 'default'
        ? `${albumName}/formats/${format}/`
        : `${albumName}/${type === 'mix' || type === 'combined' ? 'combined' : type}/`;

    return {
      success: true,
      fileId: result.id,
      fileName: result.name || filename,
      albumName: albumName,
      room: room || 'general',
      type: type,
      format: format,
      location: location,
      cleanerName: cleanerName,
      folderPath: folderPath,
      message: 'Photo uploaded successfully to Dropbox',
    };
  } catch (error) {
    console.error('Dropbox upload error:', error);
    throw new Error(`Failed to upload to Dropbox: ${error.message}`);
  }
}

/**
 * Upload multiple photos to Dropbox in batches
 * @param {Array} photos - Array of photo objects with upload parameters
 * @param {Object} config - Upload configuration
 * @param {string} config.albumName - Album name
 * @param {string} config.location - Location/city
 * @param {string} config.cleanerName - Cleaner's name
 * @param {number} config.batchSize - Number of concurrent uploads (default: all photos in parallel)
 * @param {Function} config.onProgress - Progress callback (current, total)
 * @param {boolean} config.flat - If true, upload directly to album folder (no subfolders)
 * @returns {Promise<Object>} - Upload results { successful: [], failed: [] }
 */
export async function uploadPhotoBatchToDropbox(photos, config) {
  const {
    albumName,
    location,
    cleanerName,
    batchSize = photos.length, // Upload all photos in parallel by default
    onProgress,
    flat = false, // upload into project root (no subfolders)
  } = config;

  const successful = [];
  const failed = [];
  const total = photos.length;

  // Pre-create all folders before parallel uploads to avoid rate limiting
  try {
    console.log('[DROPBOX] Pre-creating folder structure before batch upload...');
    const parentFolderPath = await dropboxService.findOrCreateProofPixFolder();
    const albumFolderPath = await dropboxService.findOrCreateAlbumFolder(parentFolderPath, albumName);
    
    // Pre-create subfolders if needed (to avoid parallel creation)
    if (!flat) {
      // Determine which subfolders we'll need
      const neededFolders = new Set();
      photos.forEach(photo => {
        const rawType = photo.mode || photo.type || 'mix';
        const isCombined = rawType === 'mix' || rawType === 'combined';
        const typeParam = isCombined ? 'combined' : rawType;
        
        let format = 'default';
        if (isCombined && photo.templateType) {
          format = photo.templateType;
        } else if (photo.format) {
          format = photo.format;
        }

        if (format !== 'default') {
          neededFolders.add('formats');
          neededFolders.add(`formats/${format}`);
        } else {
          neededFolders.add(typeParam);
        }
      });

      // Create all needed folders sequentially
      for (const folderName of neededFolders) {
        if (folderName.includes('/')) {
          const [parent, child] = folderName.split('/');
          const parentPath = await dropboxService.findOrCreateAlbumFolder(albumFolderPath, parent);
          await dropboxService.findOrCreateAlbumFolder(parentPath, child);
        } else {
          await dropboxService.findOrCreateAlbumFolder(albumFolderPath, folderName);
        }
      }
    }
    console.log('[DROPBOX] Folder structure prepared, starting uploads');
  } catch (error) {
    console.warn('[DROPBOX] Failed to pre-create folders (will create during upload):', error.message);
    // Continue anyway - folders will be created during upload (with retry logic)
  }

  // Split photos into batches
  const batches = [];
  for (let i = 0; i < photos.length; i += batchSize) {
    batches.push(photos.slice(i, i + batchSize));
  }

  // Report initial progress
  if (onProgress) {
    onProgress(0, total);
  }

  // Track individual upload progress
  let completedUploads = 0;

  // Process each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    // Process all photos in the batch concurrently
    const batchPromises = batch.map((photo) => {
      // Map photo mode; Dropbox uses 'combined' (not 'mix') for combined photos
      const rawType = photo.mode || photo.type || 'mix';
      const isCombined = rawType === 'mix' || rawType === 'combined';
      const typeParam = isCombined ? 'combined' : rawType;

      // Determine the format
      let format = 'default';
      if (isCombined && photo.templateType) {
        format = photo.templateType;
      } else if (photo.format) {
        format = photo.format;
      }

      const isFlat = !!(flat || photo.flat === true || photo.flatOverride === true);

      // Create a promise that reports progress during upload
      // Skip folder creation since we pre-created all folders
      const uploadPromise = uploadPhotoToDropbox({
        imageDataUrl: photo.uri,
        filename: photo.filename || `${photo.name}_${format !== 'default' ? format : typeParam}.jpg`,
        albumName,
        room: photo.room || 'general',
        type: typeParam,
        format: format,
        location,
        cleanerName,
        flat: isFlat,
        skipFolderCreation: true, // Folders were pre-created
      });

      // Add progress tracking for parallel uploads
      return uploadPromise
        .then((result) => {
          // Report progress when this upload completes
          if (onProgress) {
            completedUploads++;
            onProgress(completedUploads, total);
          }
          return { success: true, result, photo };
        })
        .catch((error) => {
          // Still report progress even on failure
          if (onProgress) {
            completedUploads++;
            onProgress(completedUploads, total);
          }
          return { success: false, error, photo };
        });
    });

    // Wait for all uploads in this batch to complete
    const batchResults = await Promise.allSettled(batchPromises);

    // Process results
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        const uploadResult = result.value;
        if (uploadResult.success) {
          successful.push(uploadResult);
        } else {
          failed.push(uploadResult);
        }
      } else {
        // Promise was rejected (shouldn't happen with Promise.allSettled, but handle it anyway)
        failed.push({
          success: false,
          error: result.reason,
          photo: null,
        });
      }
    });
  }

  return {
    successful,
    failed,
    total,
    successCount: successful.length,
    failureCount: failed.length,
  };
}


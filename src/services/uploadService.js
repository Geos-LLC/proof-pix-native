/**
 * Upload Service
 * Handles uploading photos to Google Drive or Dropbox based on account type
 */

import * as FileSystem from 'expo-file-system/legacy';
import googleDriveService from './googleDriveService';
import proxyService from './proxyService';
import { uploadPhotoToDropbox } from './dropboxUploadService';

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
        if (candidate !== fileUri) {
        }
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
 * Upload a single photo to Google Drive or Dropbox based on account type
 * @param {Object} params - Upload parameters
 * @param {string} params.imageDataUrl - Base64 data URL of the image
 * @param {string} params.filename - Filename for the uploaded image
 * @param {string} params.albumName - Album name (e.g., "John - Dec 21, 2024")
 * @param {string} params.room - Room name (e.g., "kitchen", "bathroom")
 * @param {string} params.type - Photo type ("before", "after", or "mix")
 * @param {string} params.format - Format type (e.g., "default", "portrait", "square")
 * @param {string} params.location - Location/city
 * @param {string} params.cleanerName - Cleaner's name
 * @param {string} params.folderId - Google Drive folder ID (for Google accounts)
 * @param {string} params.sessionId - Proxy server session ID (required for Google)
 * @param {string} params.accountType - Account type: 'google' or 'dropbox' (default: 'google')
 * @param {Function} params.onProgress - Progress callback (optional)
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadPhoto({
  imageDataUrl,
  filename,
  albumName,
  room,
  type,
  format = 'default',
  location,
  cleanerName,
  folderId,
  onProgress,
  abortSignal,
  flat = false,
  useDirectDrive = true, // Always use proxy server (legacy Apps Script removed)
  sessionId = null, // Proxy server session ID (required for Google)
  accountType = 'google' // Account type: 'google' or 'dropbox'
}) {
try {
    console.log('[UPLOAD_PHOTO] 📤 uploadPhoto called for:', filename);
    console.log('[UPLOAD_PHOTO] 🎯 Account type:', accountType);
    console.log('[UPLOAD_PHOTO] 🔑 Session ID:', sessionId);
    console.log('[UPLOAD_PHOTO] 📁 Folder ID:', folderId);
    
    // Route based on account type and session availability
    // If sessionId is provided, use proxy server (for both Google and Dropbox team uploads)
    // If no sessionId and Dropbox, use direct Dropbox upload
    if (accountType === 'apple') {
      console.log('[UPLOAD_PHOTO] 🍎 Taking Apple/iCloud route');
      // iCloud upload via proxy server
      if (!sessionId) {
        throw new Error('Missing proxy session ID for iCloud upload. Please connect your Apple account in Settings.');
      }
      
      // Use proxy server upload for iCloud
      return await uploadPhotoToDriveDirect({
        imageDataUrl,
        filename,
        albumName,
        room,
        type,
        format,
        location,
        cleanerName,
        folderId: folderId || 'icloud_root', // iCloud uses container ID, default to root
        flat,
        sessionId,
        accountType: 'apple'
      });
    }
    
    if (accountType === 'dropbox') {
      if (sessionId) {
        // Use proxy server for Dropbox team uploads
        return await uploadPhotoToDriveDirect({
          imageDataUrl,
          filename,
          albumName,
          room,
          type,
          format,
          location,
          cleanerName,
          folderId, // For Dropbox, this is actually a folder path
          flat,
          sessionId,
          accountType: 'dropbox'
        });
      } else {
        // Direct Dropbox upload for admin (no team setup)
        return await uploadPhotoToDropbox({
          imageDataUrl,
          filename,
          albumName,
          room,
          type,
          format,
          location,
          cleanerName,
          flat
        });
      }
    }
    
    // Google Drive upload via proxy server
    if (!folderId) {
      throw new Error('Missing Google Drive folder ID for upload.');
    }
    if (!sessionId) {
      throw new Error('Missing proxy session ID for upload. Please connect your Google account in Settings.');
    }
    
    // Use proxy server upload for Google
    return await uploadPhotoToDriveDirect({
      imageDataUrl,
      filename,
      albumName,
      room,
      type,
      format,
      location,
      cleanerName,
      folderId,
      flat,
      sessionId,
      accountType: 'google'
    });
  } catch (error) {
    const name = (error && error.name) || '';
    const message = (error && error.message) || '';
    const isAbort = `${name} ${message}`.toLowerCase().includes('abort');
    if (isAbort) {
    } else {
    }
    throw error;
  }
}

/**
 * Upload a photo via proxy server (for Pro/Business/Enterprise users)
 * @param {Object} params - Upload parameters
 * @param {string} params.imageDataUrl - Base64 data URL of the image
 * @param {string} params.filename - Filename for the uploaded image
 * @param {string} params.albumName - Album folder name
 * @param {string} params.room - Room name
 * @param {string} params.type - Photo type ("before", "after", or "combined")
 * @param {string} params.format - Format type (e.g., "default", "portrait", "square")
 * @param {string} params.location - Location/city
 * @param {string} params.cleanerName - Cleaner's name
 * @param {string} params.folderId - Root folder ID (ProofPix-Uploads)
 * @param {boolean} params.flat - If true, upload directly to album folder (no subfolders)
 * @param {string} params.sessionId - Proxy server session ID
 * @returns {Promise<Object>} - Upload result
 */
async function uploadPhotoToDriveDirect({
  imageDataUrl,
  filename,
  albumName,
  room,
  type,
  format = 'default',
  location,
  cleanerName,
  folderId,
  flat = false,
  sessionId,
  accountType = 'google'
}) {
  console.log('[UPLOAD_DIRECT] 🚀 uploadPhotoToDriveDirect called');
  console.log('[UPLOAD_DIRECT] 📄 Filename:', filename);
  console.log('[UPLOAD_DIRECT] 🎯 Account type:', accountType);
  console.log('[UPLOAD_DIRECT] 🔑 Session ID:', sessionId);
  console.log('[UPLOAD_DIRECT] 📁 Folder ID:', folderId);
  console.log('[UPLOAD_DIRECT] 📦 Album:', albumName);
  
  try {
    if (!sessionId) {
      throw new Error('Proxy session ID is required for upload');
    }

    console.log('[UPLOAD_DIRECT] 🔄 Converting image to base64...');
    
    // Get base64 data
    let base64String = imageDataUrl;
    if (imageDataUrl.startsWith('data:')) {
      base64String = imageDataUrl.split('base64,')[1];
    } else {
      // If it's a file URI, convert to base64
      const normalized = normalizeFileUri(imageDataUrl);
      const base64DataUrl = await fileUriToBase64(normalized);
      base64String = base64DataUrl.includes('base64,') 
        ? base64DataUrl.split('base64,')[1] 
        : base64DataUrl;
    }

    console.log('[UPLOAD_DIRECT] ✅ Base64 conversion complete');
    console.log('[UPLOAD_DIRECT] 📡 Calling proxyService.uploadPhotoAsAdmin...');
    
    // Upload via proxy server (works for both Google and Dropbox)
    const result = await proxyService.uploadPhotoAsAdmin({
      sessionId,
      filename,
      contentBase64: base64String,
      albumName,
      room,
      type,
      format,
      location,
      cleanerName,
      flat,
      accountType // Pass account type so backend knows which service to use
    });
    
    console.log('[UPLOAD_DIRECT] ✅ Proxy upload successful:', result);
    
    return {
      success: true,
      fileId: result.fileId,
      fileName: result.fileName || filename,
      albumName: result.albumName || albumName,
      room: result.room || room || 'general',
      type: result.type || type,
      format: result.format || format,
      location: result.location || location,
      cleanerName: result.cleanerName || cleanerName,
      folderPath: result.folderPath || `${albumName}/${flat ? '' : (format !== 'default' ? `formats/${format}/` : `${type === 'mix' || type === 'combined' ? 'combined' : type}/`)}`,
      message: result.message || 'Photo uploaded successfully via proxy server'
    };
  } catch (error) {
    console.error('[UPLOAD_DIRECT] ❌ Error:', error);
    console.error('[UPLOAD_DIRECT] ❌ Error message:', error.message);
    console.error('[UPLOAD_DIRECT] ❌ Error stack:', error.stack);
    throw new Error(`Failed to upload via proxy server: ${error.message}`);
  }
}

/**
 * Upload a single photo as a team member using an invite token (proxy server only)
 * Supports the same upload structure as Pro/Business/Enterprise tiers
 * @param {Object} params - Upload parameters
 * @param {string} params.imageDataUrl - Base64 data URL of the image
 * @param {string} params.filename - Filename for the uploaded image
 * @param {string} params.sessionId - Proxy server session ID
 * @param {string} params.token - The invite token for authorization
 * @param {string} params.albumName - Album folder name
 * @param {string} params.room - Room name
 * @param {string} params.type - Photo type ("before", "after", or "combined")
 * @param {string} params.format - Format type (e.g., "default", "portrait", "square")
 * @param {string} params.location - Location/city
 * @param {string} params.cleanerName - Cleaner's name
 * @param {boolean} params.flat - If true, upload directly to album folder (no subfolders)
 * @returns {Promise<Object>} - Upload result
 */
export async function uploadPhotoAsTeamMember({
  imageDataUrl,
  filename,
  sessionId,
  token,
  albumName,
  room,
  type,
  format = 'default',
  location,
  cleanerName,
  flat = false,
}) {
  try {
    if (!sessionId || !token) {
      throw new Error('Missing session ID or invite token.');
    }

    let base64String = imageDataUrl;
    if (imageDataUrl.startsWith('data:')) {
      base64String = imageDataUrl.split('base64,')[1];
    } else {
      // If it's a file URI, convert to base64
      const normalized = normalizeFileUri(imageDataUrl);
      const base64DataUrl = await fileUriToBase64(normalized);
      base64String = base64DataUrl.includes('base64,') 
        ? base64DataUrl.split('base64,')[1] 
        : base64DataUrl;
    }

    // Upload via proxy server with full upload structure (same as Pro/Business/Enterprise)
    return await proxyService.uploadPhoto(sessionId, token, filename, base64String, {
      albumName,
      room,
      type,
      format,
      location,
      cleanerName,
      flat
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Upload multiple photos in batches
 * Supports both admin uploads (Pro/Business/Enterprise) and team member uploads
 * Supports both Google Drive and Dropbox accounts
 * @param {Array} photos - Array of photo objects with upload parameters
 * @param {Object} config - Upload configuration
 * @param {string} config.folderId - Google Drive folder ID (for Google accounts)
 * @param {string} config.sessionId - Proxy server session ID (required for Google)
 * @param {string} config.token - Invite token (required for team member uploads)
 * @param {string} config.accountType - Account type: 'google' or 'dropbox' (default: 'google')
 * @param {string} config.albumName - Album name
 * @param {string} config.location - Location/city
 * @param {string} config.cleanerName - Cleaner's name
 * @param {number} config.batchSize - Number of concurrent uploads (default: all photos in parallel)
 * @param {Function} config.onProgress - Progress callback (current, total)
 * @param {Function} config.onBatchComplete - Callback after each batch
 * @returns {Promise<Object>} - Upload results { successful: [], failed: [] }
 */
export async function uploadPhotoBatch(photos, config) {
  console.log('[UPLOAD_BATCH] 🚀 uploadPhotoBatch called');
  console.log('[UPLOAD_BATCH] 📸 Photos count:', photos.length);
  console.log('[UPLOAD_BATCH] ⚙️ Config:', JSON.stringify(config, null, 2));
  
  const {
    folderId,
    albumName,
    location,
    cleanerName,
    batchSize = photos.length, // Upload all photos in parallel by default
    onProgress,
    onBatchComplete,
    getAbortController, // optional callback to retrieve/create AbortController per request
    abortSignal, // optional AbortSignal to stop scheduling further uploads
    flat = false, // upload into project root (no subfolders)
    useDirectDrive = true, // Always use proxy server (legacy Apps Script removed)
    sessionId = null, // Proxy server session ID (required for Google)
    token = null, // Invite token (required for team member uploads)
    accountType = 'google' // Account type: 'google' or 'dropbox'
  } = config;

  console.log('[UPLOAD_BATCH] 🎯 Account type:', accountType);
  console.log('[UPLOAD_BATCH] 🔑 Session ID:', sessionId);
  console.log('[UPLOAD_BATCH] 📁 Folder ID:', folderId);

  // Route based on account type and session availability
  // If sessionId is provided, use proxy server (for both Google and Dropbox team uploads)
  // If no sessionId and Dropbox, use direct Dropbox upload
  if (accountType === 'dropbox' && !sessionId) {
    // Direct Dropbox batch upload (no team setup)
    const { uploadPhotoBatchToDropbox } = await import('./dropboxUploadService');
    return await uploadPhotoBatchToDropbox(photos, {
      albumName,
      location,
      cleanerName,
      batchSize,
      onProgress,
      flat
    });
  }

  // Determine if this is a team member upload (Google only)
  const isTeamMemberUpload = !!(token && sessionId);

  // If using proxy server and albumName is provided, prepare the album folder first
  // This ensures all parallel uploads use the same album folder
  // Note: Team members can also use album folders (same as Pro/Business/Enterprise)
  if (useDirectDrive && albumName && sessionId && !flat) {
    try {
      console.log('[UPLOAD] Preparing album folder before parallel uploads:', albumName);
      await proxyService.prepareAlbumFolder(sessionId, albumName);
      console.log('[UPLOAD] Album folder prepared, starting parallel uploads');
    } catch (error) {
      console.warn('[UPLOAD] Failed to prepare album folder (will create during upload):', error.message);
      // Continue anyway - the upload endpoint will create the folder if needed
    }
  }

  const successful = [];
  const failed = [];
  let completed = 0;
  const total = photos.length;

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
    if (abortSignal?.aborted) {
      break;
    }
    const batch = batches[batchIndex];

    // Process all photos in the batch concurrently
    const batchPromises = batch.map((photo, index) => {
      if (abortSignal?.aborted) {
        return Promise.reject(new Error('Aborted'));
      }
      // Map photo mode; server expects 'combined' (not 'mix') for combined photos
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

      // Provide an AbortController per upload if supported
      const controller = typeof getAbortController === 'function' ? getAbortController() : null;
      const isFlat = !!(flat || photo.flat === true || photo.flatOverride === true);
      
      // Create a promise that reports progress during upload
      // Use team member upload if token is provided, otherwise use admin upload
      const uploadPromise = isTeamMemberUpload
        ? uploadPhotoAsTeamMember({
            imageDataUrl: photo.uri,
            filename: photo.filename || `${photo.name}_${format !== 'default' ? format : typeParam}.jpg`,
            sessionId,
            token,
            albumName,
            room: photo.room || 'general',
            type: typeParam,
            format: format,
            location,
            cleanerName,
            flat: isFlat,
          })
        : uploadPhoto({
            imageDataUrl: photo.uri,
            filename: photo.filename || `${photo.name}_${format !== 'default' ? format : typeParam}.jpg`,
            albumName,
            room: photo.room || 'general',
            type: typeParam,
            format: format,
            location,
            cleanerName,
            folderId,
            abortSignal: controller ? controller.signal : (abortSignal || undefined),
            flat: isFlat,
            useDirectDrive, // Always use proxy server
            sessionId, // Pass the proxy session ID
            accountType, // Pass account type
            // Remove intermediate progress reporting for cleaner parallel upload tracking
          });

      // Add progress tracking for parallel uploads
      return uploadPromise
        .then(result => {
          // Report progress when this upload completes
          if (onProgress) {
            completedUploads++;
            onProgress(completedUploads, total);
          }
          return { success: true, result, photo };
        })
        .catch(error => {
          // Still report progress even on failure
          if (onProgress) {
            completedUploads++;
            onProgress(completedUploads, total);
          }
          return { success: false, error, photo };
        });
    });

    // Wait for batch to complete
    const results = await Promise.allSettled(batchPromises);

    // Process results
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value);
      } else {
        const isRejected = result.status === 'rejected';
        const errorInfo = isRejected ? { error: result.reason, photo: null } : (result.value || { error: 'Unknown error', photo: null });
        const rawMsg = typeof errorInfo.error === 'string' ? errorInfo.error : (errorInfo.error?.message || '');
        const isAbort = (rawMsg || '').toLowerCase().includes('abort');
        if (isAbort) {
          // Do not treat aborted uploads as failures in the results list
        } else {
          failed.push(errorInfo);
        }
      }
    });

    // Call batch complete callback
    if (onBatchComplete) {
      onBatchComplete(batchIndex + 1, batches.length);
    }

    // If cancelled, stop scheduling further batches
    if (abortSignal?.aborted) {
      break;
    }

    // No delay between batches for faster uploads
    // Removed delay to upload all photos in parallel
  }

  return { successful, failed };
}

/**
 * Create an album name from user info and date
 * @param {string} userName - User/cleaner name
 * @param {Date} date - Date object (defaults to now)
 * @returns {string} - Album name (e.g., "John - Dec 21, 2024")
 */
/**
 * Generate a unique project identifier (timestamp-based)
 * Format: HHMM (e.g., "1430" for 2:30 PM)
 */
function generateProjectId(date = new Date()) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

export function createAlbumName(userName, date = new Date(), projectUploadId = null) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  // If projectUploadId is provided, use it (for re-uploads to same project)
  // Otherwise generate one based on current time (for new projects or no project)
  const uniqueId = projectUploadId || generateProjectId(date);
  
  return `${userName} - ${month} ${day}, ${year} - ${uniqueId}`;
}

/**
 * Ensure a unique project/album name by suffixing an incrementing number if needed.
 * existingNames: array of strings (project names already present)
 */
export function ensureUniqueProjectName(baseName, existingNames) {
  if (!Array.isArray(existingNames) || existingNames.length === 0) return baseName;
  const set = new Set(existingNames);
  if (!set.has(baseName)) return baseName;
  let i = 2;
  while (set.has(`${baseName} ${i}`)) i++;
  return `${baseName} ${i}`;
}
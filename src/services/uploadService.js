/**
 * Upload Service
 * Handles uploading photos to Google Drive or Dropbox based on account type
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import googleDriveService from './googleDriveService';
import googleAuthService from './googleAuthService';
import proxyService from './proxyService';
import { uploadPhotoToDropbox } from './dropboxUploadService';
import { ensureLabelForPhoto, ensureLabelsForPhotoBatch } from './labelService';
import iCloudService from './iCloudService';

/**
 * Compress image if needed - NO LONGER NEEDED with Railway (no body size limits)
 * Keeping function signature for compatibility but returning URI unchanged
 * @param {string} uri - Image URI
 * @returns {Promise<string>} - Original image URI (no compression)
 */
async function compressImageIfNeeded(uri) {
  // Railway has no body size limits, so compression is no longer needed
  // Images are already compressed at 85% quality by native labeling modules
  console.log(`[UPLOAD] ✅ Using Railway proxy - no compression needed`);
  return uri;
}

/**
 * Convert file URI to base64 data URL
 * @param {string} fileUri - The file URI (file://...)
 * @returns {Promise<string>} - Base64 data URL (data:image/jpeg;base64,...)
 */
async function fileUriToBase64(fileUri) {
  try {
    console.log('[fileUriToBase64] Reading file:', fileUri?.substring(0, 100));
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
      console.log('[UPLOAD_PHOTO] 🍎 Taking Apple/iCloud route (direct upload)');
      // Use direct iCloud upload via native file system
      // This bypasses the proxy server and stores files directly in app's Documents folder

      // Resolve the image URI to a file path
      let resolvedUri = imageDataUrl;
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
          resolvedUri = tempFilePath;
        }
      }

      // Upload directly to iCloud via native file system
      return await iCloudService.uploadPhoto(
        resolvedUri,
        filename,
        albumName,
        {
          room,
          type,
          format,
          location,
          cleanerName,
          flat,
        }
      );
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

    // ATTEMPT DIRECT UPLOAD FIRST (Bypass Proxy Limit for Admins)
    // This uploads directly from file URI - no base64 conversion needed
    if (accountType === 'google') {
      try {
        let isSignedIn = false;
        try {
           isSignedIn = await googleAuthService.isSignedIn();
        } catch (e) {
           console.warn('[UPLOAD] Failed to check sign-in status:', e);
        }

        if (isSignedIn) {
          console.log('[UPLOAD] 🎯 User is signed in (Admin), using DIRECT upload to Google Drive (bypasses Vercel)...');

          // 1. Get/Create Album Folder
          const albumFolderId = await googleDriveService.findOrCreateAlbumFolder(folderId, albumName);

          // 2. Determine target folder
          let targetFolderId = albumFolderId;
          let subfolderPath = '';

          if (!flat) {
             let subfolderName;
             if (format !== 'default') {
               const formatsFolderId = await googleDriveService.findOrCreateSubfolder(albumFolderId, 'formats');
               subfolderName = format;
               targetFolderId = await googleDriveService.findOrCreateSubfolder(formatsFolderId, subfolderName);
               subfolderPath = `formats/${format}/`;
             } else {
               subfolderName = (type === 'mix' || type === 'combined') ? 'combined' : type;
               targetFolderId = await googleDriveService.findOrCreateSubfolder(albumFolderId, subfolderName);
               subfolderPath = `${subfolderName}/`;
             }
          }

          // 3. Upload File Directly from URI (NO SIZE LIMIT - bypasses Vercel 4.5MB restriction)
          let sourceUri = imageDataUrl;
          if (imageDataUrl.startsWith('data:')) {
            const tempFilename = `temp_upload_${Date.now()}.jpg`;
            const tempUri = `${FileSystem.cacheDirectory}${tempFilename}`;
            const base64Part = imageDataUrl.split('base64,')[1] || imageDataUrl;
            await FileSystem.writeAsStringAsync(tempUri, base64Part, { encoding: 'base64' });
            sourceUri = tempUri;
            console.log('[UPLOAD] Converted data URL to temp file:', tempUri);
          } else {
            sourceUri = normalizeFileUri(imageDataUrl);
          }

          console.log('[UPLOAD] 📤 Uploading directly from file URI (no compression, no Vercel limit)...');
          console.log('[UPLOAD] Source URI:', sourceUri?.substring(0, 80));
          const result = await googleDriveService.uploadFileFromUri(sourceUri, filename, targetFolderId);

          console.log('[UPLOAD] ✅ Direct upload successful:', result.fileId);

          return {
            success: true,
            fileId: result.fileId,
            fileName: filename,
            albumName: albumName,
            room: room || 'general',
            type: type,
            format: format,
            location: location,
            cleanerName: cleanerName,
            folderPath: `${albumName}/${flat ? '' : subfolderPath}`,
            message: 'Photo uploaded successfully via direct Drive API (no size limit)'
          };
        }
      } catch (directError) {
        console.warn('[UPLOAD] Direct upload attempt failed, falling back to proxy:', directError.message);
      }
    }

    // FALLBACK: Convert to base64 for proxy upload (only if direct upload didn't succeed)
    console.log('[UPLOAD_DIRECT] 🔄 Converting image to base64 for proxy upload...');
    let base64String = imageDataUrl;
    if (imageDataUrl.startsWith('data:')) {
      base64String = imageDataUrl.split('base64,')[1];
    } else {
      let normalized = normalizeFileUri(imageDataUrl);
      if (Platform.OS === 'android') {
         normalized = await compressImageIfNeeded(normalized);
      }
      const base64DataUrl = await fileUriToBase64(normalized);
      base64String = base64DataUrl.includes('base64,')
        ? base64DataUrl.split('base64,')[1]
        : base64DataUrl;
    }
    console.log('[UPLOAD_DIRECT] ✅ Base64 conversion complete');
    console.log('[UPLOAD_DIRECT] 📡 Calling proxyService.uploadPhotoAsAdmin...');

    // Upload via proxy server (works for both Google and Dropbox, or fallback for Admin)
    // Use multipart upload (fileUri) for Android or if file is large to avoid Base64 overhead
    // iOS and small files can continue using Base64 if preferred
    const useMultipart = Platform.OS === 'android' && !imageDataUrl.startsWith('data:');

    // Normalize URI for multipart upload if needed
    let uploadUri = null;
    if (useMultipart) {
       uploadUri = normalizeFileUri(imageDataUrl);
    }

    // Check and compress if needed (Android only or huge files) to prevent proxy rejection
    // Vercel has a 4.5MB body limit. Even with multipart, we must respect this.
    // So we compress if the file is likely to exceed this limit.
    if (Platform.OS === 'android') {
       // Always check compression on Android where photos are huge
       const originalUri = imageDataUrl.startsWith('data:') ? null : normalizeFileUri(imageDataUrl);
       if (originalUri) {
          // Use the compressed URI for upload
          uploadUri = await compressImageIfNeeded(originalUri);
       }
    }

    const result = await proxyService.uploadPhotoAsAdmin({
      sessionId,
      filename,
      contentBase64: useMultipart ? null : base64String,
      fileUri: useMultipart ? (uploadUri || normalizeFileUri(imageDataUrl)) : null,
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

    // Determine upload method: Multipart (Android/Efficient) vs Base64 (Legacy/iOS)
    // Use multipart for Android to avoid 4.5MB serverless limit issues
    const useMultipart = Platform.OS === 'android' && !imageDataUrl.startsWith('data:');
    
    let base64String = null;
    let uploadUri = null;

    if (useMultipart) {
       uploadUri = normalizeFileUri(imageDataUrl);
       // Ensure it fits in Vercel 4.5MB limit
       if (Platform.OS === 'android') {
          uploadUri = await compressImageIfNeeded(uploadUri);
       }
    } else {
       // Legacy Base64 Path
       if (imageDataUrl.startsWith('data:')) {
         base64String = imageDataUrl.split('base64,')[1];
       } else {
         let normalized = normalizeFileUri(imageDataUrl);
         // No compression needed here if using multipart, but if falling back to Base64 on Android we might need it
         // However, we are prioritizing multipart for Android now.
         const base64DataUrl = await fileUriToBase64(normalized);
         base64String = base64DataUrl.includes('base64,') 
           ? base64DataUrl.split('base64,')[1] 
           : base64DataUrl;
       }
    }

    // Upload via proxy server with full upload structure (same as Pro/Business/Enterprise)
    return await proxyService.uploadPhoto(sessionId, token, filename, base64String, uploadUri, {
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

// Re-export ensureLabelForPhoto for backward compatibility
export { ensureLabelForPhoto };

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
    batchSize = 2, // Reduced from all-parallel to 2 to prevent Vercel rate limiting (403)
    onProgress,
    onLabelProgress, // optional callback for label preparation progress (current, total)
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
  // Apple/iCloud uses direct uploads via native file system (no proxy needed)
  if (accountType === 'apple') {
    console.log('[UPLOAD_BATCH] 🍎 Taking Apple/iCloud route (direct upload)');
    return await iCloudService.uploadPhotoBatch(photos, albumName, {
      location,
      cleanerName,
      flat
    }, onProgress);
  }

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

  // Resolve a unique album name so each upload batch gets its own folder.
  // e.g. "John - Feb 13, 2026 - NYC" → "John - Feb 13, 2026 - NYC (2)" if the first already exists.
  let resolvedAlbumName = albumName;
  if (albumName && folderId && accountType === 'google') {
    try {
      const isSignedIn = await googleAuthService.isSignedIn();
      if (isSignedIn) {
        resolvedAlbumName = await googleDriveService.findUniqueAlbumName(folderId, albumName);
      }
    } catch (e) {
      console.warn('[UPLOAD] Could not resolve unique album name:', e.message);
    }
  }

  // If using proxy server and albumName is provided, prepare the album folder first
  // This ensures all parallel uploads use the same album folder
  // Note: Team members can also use album folders (same as Pro/Business/Enterprise)
  if (useDirectDrive && resolvedAlbumName && sessionId && !flat) {
    try {
      // Determine unique subfolder types needed so they can be pre-created
      const subfolderTypes = new Set();
      for (const photo of photos) {
        const rawType = photo.mode || photo.type || 'mix';
        const isCombined = rawType === 'mix' || rawType === 'combined';
        const subfolderName = isCombined ? 'combined' : rawType;
        subfolderTypes.add(subfolderName);
      }
      const subfolders = Array.from(subfolderTypes);
      console.log('[UPLOAD] Preparing album folder before parallel uploads:', resolvedAlbumName, 'subfolders:', subfolders);
      await proxyService.prepareAlbumFolder(sessionId, resolvedAlbumName, subfolders);
      console.log('[UPLOAD] Album folder prepared, starting parallel uploads');
    } catch (error) {
      console.warn('[UPLOAD] Failed to prepare album folder (will create during upload):', error.message);
      // Continue anyway - the upload endpoint will create the folder if needed
    }
  }

  const successful = [];
  const failed = [];

  // PRE-CHECK: Deduplicate photos by ID to prevent duplicate uploads
  const deduped = new Map();
  photos.forEach(p => { if (!deduped.has(p.id)) deduped.set(p.id, p); });
  const uniquePhotos = Array.from(deduped.values());
  if (uniquePhotos.length < photos.length) {
    console.warn(`[UPLOAD] ⚠️ Removed ${photos.length - uniquePhotos.length} duplicate photo(s) from upload batch`);
  }

  // PRE-CHECK: Verify all photo files exist before starting upload
  // Skip photos whose files are missing (stale metadata)
  const validPhotos = [];
  for (const photo of uniquePhotos) {
    const uri = normalizeFileUri(photo.uri);
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists) {
        validPhotos.push(photo);
      } else {
        console.warn(`[UPLOAD] ⚠️ Skipping photo ${photo.id} (${photo.name}) - file does not exist: ${uri?.substring(0, 80)}`);
        failed.push({ photo, error: 'File does not exist on device' });
      }
    } catch (e) {
      console.warn(`[UPLOAD] ⚠️ Skipping photo ${photo.id} - cannot verify file: ${e.message}`);
      failed.push({ photo, error: 'Cannot verify file exists' });
    }
  }

  if (validPhotos.length === 0) {
    console.error('[UPLOAD] ❌ No valid photo files found - all files are missing from device');
    return { successful: [], failed };
  }

  if (validPhotos.length < photos.length) {
    console.warn(`[UPLOAD] ⚠️ ${photos.length - validPhotos.length} photo(s) skipped (files missing). Uploading ${validPhotos.length} valid photos.`);
  }

  let completed = 0;
  const total = validPhotos.length;

  // PRE-PROCESS: Batch-optimized label check (reads settings + cache metadata ONCE)
  // Labels should already be cached from background preparation (done right after photo capture).
  // Wait for all labels to be prepared - UI shows "Preparing labels X/Y" progress.
  console.log('[UPLOAD] Pre-processing labels (batch-optimized)...');
  let labeledPhotos;
  try {
    const batchResults = await ensureLabelsForPhotoBatch(validPhotos, { onProgress: onLabelProgress });
    let labeledCount = 0;
    let originalCount = 0;
    labeledPhotos = batchResults.map(({ photo, labeledUri }) => {
      if (labeledUri && labeledUri !== photo.uri) {
        labeledCount++;
        return { ...photo, uri: labeledUri, _preLabeledUri: labeledUri };
      }
      originalCount++;
      return photo;
    });
    if (originalCount > 0) {
      console.warn(`[UPLOAD] ${originalCount}/${validPhotos.length} photos using original (unlabeled) URI`);
    }
    console.log(`[UPLOAD] ${labeledCount}/${validPhotos.length} photos labeled successfully`);
  } catch (e) {
    console.warn('[UPLOAD] Label batch prep failed, using originals:', e.message);
    labeledPhotos = validPhotos;
  }
  console.log('[UPLOAD] All labels pre-processed');

  // Split photos into batches (using pre-labeled photos)
  const batches = [];
  for (let i = 0; i < labeledPhotos.length; i += batchSize) {
    batches.push(labeledPhotos.slice(i, i + batchSize));
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
    const batchPromises = batch.map(async (photo, index) => {
      const uploadId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
      console.log(`[UPLOAD:${uploadId}] 🚀 Starting upload for: ${photo.filename || photo.id}`);

      if (abortSignal?.aborted) {
        return Promise.reject(new Error('Aborted'));
      }

      // Use the pre-labeled URI (set during sequential pre-processing above)
      // If _preLabeledUri exists, it means labeling was successful
      const photoUri = photo._preLabeledUri || photo.uri;
      console.log(`[UPLOAD:${uploadId}] 📤 Using ${photo._preLabeledUri ? 'PRE-LABELED' : 'ORIGINAL'} URI: ${photoUri?.substring(0, 50)}...`);

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
            imageDataUrl: photoUri, // Use the potentially labeled URI
            filename: photo.filename || `${photo.name}_${format !== 'default' ? format : typeParam}.jpg`,
            sessionId,
            token,
            albumName: resolvedAlbumName,
            room: photo.room || 'general',
            type: typeParam,
            format: format,
            location,
            cleanerName,
            flat: isFlat,
          })
        : uploadPhoto({
            imageDataUrl: photoUri, // Use the potentially labeled URI
            filename: photo.filename || `${photo.name}_${format !== 'default' ? format : typeParam}.jpg`,
            albumName: resolvedAlbumName,
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
 * Create an album name from user info, location, and date
 * @param {string} userName - User/cleaner name
 * @param {Date} date - Date object (defaults to now)
 * @param {string|number|null} projectUploadId - Project upload ID for re-uploads (optional)
 * @param {string} location - Location name (optional, e.g., "Tampa")
 * @returns {string} - Album name (e.g., "John - Tampa - Dec 21, 2024 - 1430")
 */
/**
 * Generate a unique project identifier (timestamp-based)
 * Format: HHMMSS (e.g., "143025" for 2:30:25 PM)
 */
function generateProjectId(date = new Date()) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
}

export function createAlbumName(userName, date = new Date(), projectUploadId = null, location = null) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();

  // Build album name: name - date - location
  const parts = [userName];
  parts.push(`${month} ${day}, ${year}`);
  if (location) {
    parts.push(location);
  }
  
  // Note: projectUploadId is kept for backward compatibility but not included in folder name
  // The folder name is now: "Name - Date - Location" (project name format)
  
  return parts.join(' - ');
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
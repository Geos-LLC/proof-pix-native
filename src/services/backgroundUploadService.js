import { uploadPhotoBatch, uploadPhotoAsTeamMember } from './uploadService';
import { markPhotosAsUploaded } from './uploadTracker';
import { loadProjects } from './storage';
import crmService from './crm';

/**
 * Forward each successfully-uploaded photo to the connected CRM
 * (Service Flow today) when its project is linked to a CRM job.
 * Runs after the cloud upload completes so the CRM step never
 * gates the primary Drive/Dropbox/iCloud sync.
 *
 * Strictly additive: CRM failures log but don't surface as batch
 * failures. Idempotency is handled CRM-side (Service Flow dedupes
 * by `proofpix_photo_id` for 24h), so retries on the next upload
 * cycle are safe.
 */
async function attachSuccessfulPhotosToCrm(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return;

  // Build a projectId → crmJobId index once per batch. Photos
  // store `projectId` but the CRM linkage lives on the project
  // record. Loading projects once is cheaper than per-photo lookup.
  let projectJobMap = null;
  try {
    const projects = await loadProjects();
    projectJobMap = new Map();
    for (const proj of (projects || [])) {
      if (proj?.id && proj?.crmJobId) {
        projectJobMap.set(proj.id, String(proj.crmJobId));
      }
    }
  } catch (e) {
    console.warn('[BG_UPLOAD] CRM attach skipped — could not load projects:', e?.message);
    return;
  }
  if (!projectJobMap || projectJobMap.size === 0) return;

  const photosWithJob = photos
    .map(p => {
      if (!p?.projectId) return null;
      const crmJobId = projectJobMap.get(p.projectId);
      return crmJobId ? { ...p, crmJobId } : null;
    })
    .filter(Boolean);
  if (photosWithJob.length === 0) return;

  for (const photo of photosWithJob) {
    try {
      await crmService.attachPhoto(String(photo.crmJobId), {
        id: photo.id,
        projectId: photo.projectId,
        localUri: photo.uri,
        filename: photo.filename || (photo.uri ? photo.uri.split('/').pop() : `${photo.id}.jpg`),
        mimeType: photo.mimeType || 'image/jpeg',
        mode: photo.mode,
        room: photo.room,
        timestamp: photo.timestamp || (photo.createdAt ? new Date(photo.createdAt).getTime() : Date.now()),
        gps: (typeof photo.lat === 'number' && typeof photo.lng === 'number')
          ? { lat: photo.lat, lng: photo.lng }
          : null,
        capturedBy: photo.capturedBy || null,
        notes: photo.notes || '',
      });
    } catch (e) {
      // Per-photo failure — log and continue. Idempotency means the
      // retry on the next batch will pick it up correctly.
      console.warn('[BG_UPLOAD] CRM attach failed for photo', photo.id, e?.message);
    }
  }
}

// Check if the device has network connectivity
async function checkNetworkConnectivity() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('https://clients3.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.status === 204 || response.ok;
  } catch {
    return false;
  }
}

class BackgroundUploadService {
  constructor() {
    this.activeUploads = new Map();
    this.listeners = new Set();
    this.uploadQueue = [];
    this.isProcessing = false;
    this.completedUploads = new Map();
    this.abortControllers = new Map(); // uploadId -> AbortController
  }

  // Subscribe to upload progress updates
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Notify all listeners of upload progress
  notifyListeners() {
    this.listeners.forEach(listener => {
      listener({
        activeUploads: Array.from(this.activeUploads.values()),
        queueLength: this.uploadQueue.length,
        isProcessing: this.isProcessing,
        completedUploads: this.getCompletedUploads()
      });
    });
  }

  // Add upload to queue
  queueUpload(uploadData) {
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const upload = {
      id: uploadId,
      ...uploadData,
      status: 'queued',
      progress: { current: 0, total: 0 },
      startTime: null,
      endTime: null,
      error: null
    };

    this.uploadQueue.push(upload);
    this.notifyListeners();
    
    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    return uploadId;
  }

  // Process upload queue
  async processQueue() {
    console.log('[BG_UPLOAD] 🔄 processQueue called');
    console.log('[BG_UPLOAD] 📊 Queue length:', this.uploadQueue.length);
    console.log('[BG_UPLOAD] ⚙️ isProcessing:', this.isProcessing);
    
    if (this.isProcessing || this.uploadQueue.length === 0) {
      console.log('[BG_UPLOAD] ⏹️ Skipping queue processing');
      return;
    }

    this.isProcessing = true;
    console.log('[BG_UPLOAD] ✅ Starting queue processing');
    this.notifyListeners();

    while (this.uploadQueue.length > 0) {
      const upload = this.uploadQueue.shift();
      if (upload.uploadType === 'team') {
        await this.processTeamUpload(upload);
      } else {
        await this.processUpload(upload);
      }
    }

    this.isProcessing = false;
    this.notifyListeners();
  }

  // Process individual upload
  async processUpload(upload) {
    console.log('[BG_UPLOAD] 📤 processUpload called for upload:', upload.id);
    console.log('[BG_UPLOAD] 📸 Items count:', upload.items.length);
    console.log('[BG_UPLOAD] 🔍 upload object:', JSON.stringify(upload, null, 2));
    console.log('[BG_UPLOAD] 🔍 upload.config:', upload.config);
    console.log('[BG_UPLOAD] 🔍 upload.sessionId:', upload.sessionId);
    console.log('[BG_UPLOAD] 🔍 upload.accountType:', upload.accountType);

    // Check network connectivity before starting
    const isOnline = await checkNetworkConnectivity();
    if (!isOnline) {
      upload.status = 'failed';
      upload.endTime = Date.now();
      upload.error = 'No internet connection. Please check your network and try again.';
      this.activeUploads.delete(upload.id);
      this.notifyListeners();
      return;
    }

    try {
      // Move to active uploads
      upload.status = 'uploading';
      upload.startTime = Date.now();
      // Initialize progress with correct total count
      upload.progress = { current: 0, total: upload.items.length };
      this.activeUploads.set(upload.id, upload);

      // Create AbortController so cancel can stop in-flight requests
      const abortController = new AbortController();
      this.abortControllers.set(upload.id, abortController);

      this.notifyListeners();

      // Prepare upload options
      const uploadOptions = {
        scriptUrl: upload.config?.scriptUrl,
        folderId: upload.config?.folderId,
        albumName: upload.albumName,
        location: upload.location,
        cleanerName: upload.userName,
        batchSize: upload.items.length, // Upload all photos in parallel
        flat: upload.flat,
        useDirectDrive: upload.config?.useDirectDrive || upload.useDirectDrive || false, // Pass flag for proxy server upload
        sessionId: upload.config?.sessionId || upload.sessionId || null, // Pass proxy session ID
        accountType: upload.config?.accountType || upload.accountType || 'google', // Pass account type
        abortSignal: abortController.signal,
        onProgress: (current, total) => {
          upload.progress = { current, total };
          this.notifyListeners();
        },
        onLabelProgress: (current, total) => {
          upload.labelProgress = { current, total };
          this.notifyListeners();
        }
      };

      console.log('[BG_UPLOAD] 🎯 Upload options:', JSON.stringify(uploadOptions, null, 2));
      console.log('[BG_UPLOAD] 🚀 Calling uploadPhotoBatch...');

      // Perform upload
      const result = await uploadPhotoBatch(upload.items, uploadOptions);
      
      console.log('[BG_UPLOAD] ✅ uploadPhotoBatch completed');
      console.log('[BG_UPLOAD] 📊 Result:', result);
      
      // Mark photos as uploaded in tracker (only successful ones)
      if (result.successful && result.successful.length > 0) {
        const successfulPhotos = result.successful.map(item => item.photo);
        await markPhotosAsUploaded(successfulPhotos, upload.albumName);

        // CRM attach — best-effort, after the cloud upload succeeds.
        // Photo carries `crmJobId` when its project is linked to an
        // external job (Service Flow today; other CRMs later). Failure
        // here doesn't fail the batch — CRM is an additive sync layer,
        // not the primary upload path.
        try {
          await attachSuccessfulPhotosToCrm(successfulPhotos);
        } catch (e) {
          console.warn('[BG_UPLOAD] CRM attach step threw:', e?.message);
        }
      }

      // Mark as completed
      upload.status = 'completed';
      upload.endTime = Date.now();
      upload.result = result;

      // Store in completed uploads for notification
      this.completedUploads.set(upload.id, upload);

      // Remove from active uploads
      this.activeUploads.delete(upload.id);
      this.abortControllers.delete(upload.id);
      this.notifyListeners();

    } catch (error) {
      console.error('[BG_UPLOAD] ❌ Upload failed with error:', error);
      console.error('[BG_UPLOAD] ❌ Error message:', error.message);
      console.error('[BG_UPLOAD] ❌ Error stack:', error.stack);

      // Mark as failed
      upload.status = 'failed';
      upload.endTime = Date.now();
      upload.error = error.message || 'Upload failed';

      // Store in completed uploads so the user sees the failure notification
      this.completedUploads.set(upload.id, upload);

      // Remove from active uploads
      this.activeUploads.delete(upload.id);
      this.abortControllers.delete(upload.id);
      this.notifyListeners();
    }
  }

  async processTeamUpload(upload) {
    // Defensive guard: processTeamUpload requires teamInfo at the top
    // level of the queued object. Missing teamInfo means a caller
    // mis-shaped the enqueue and would crash on the destructure below.
    // Fail explicitly instead — makes the wiring bug visible during
    // Slice A canary rather than a silent NPE.
    if (!upload?.teamInfo?.sessionId || !upload?.teamInfo?.token) {
      upload.status = 'failed';
      upload.endTime = Date.now();
      upload.error = 'Team upload missing session/token — check enqueue call.';
      this.completedUploads.set(upload.id, upload);
      this.activeUploads.delete(upload.id);
      this.notifyListeners();
      console.warn('[TEAM_UPLOAD] enqueue misshaped', {
        has_teamInfo: !!upload?.teamInfo,
        has_session: !!upload?.teamInfo?.sessionId,
        has_token: !!upload?.teamInfo?.token,
      });
      return;
    }

    // Check network connectivity before starting
    const isOnline = await checkNetworkConnectivity();
    if (!isOnline) {
      upload.status = 'failed';
      upload.endTime = Date.now();
      upload.error = 'No internet connection. Please check your network and try again.';
      this.activeUploads.delete(upload.id);
      this.notifyListeners();
      return;
    }

    const batchT0 = Date.now();
    try {
      upload.status = 'uploading';
      upload.startTime = Date.now();
      upload.progress = { current: 0, total: upload.items.length };
      this.activeUploads.set(upload.id, upload);

      // Create AbortController so cancel can stop in-flight requests
      const abortController = new AbortController();
      this.abortControllers.set(upload.id, abortController);

      this.notifyListeners();

      const { items, teamInfo } = upload;

      // Prepare upload options for team member batch upload (same as Pro/Business/Enterprise)
      const uploadOptions = {
        folderId: upload.config?.folderId, // May not be needed for team uploads but kept for consistency
        albumName: upload.albumName,
        location: upload.location,
        cleanerName: upload.userName,
        batchSize: upload.items.length, // Upload all photos in parallel
        flat: upload.flat,
        useDirectDrive: true, // Always use proxy server (for Google)
        sessionId: teamInfo.sessionId,
        token: teamInfo.token, // Required for team member uploads
        accountType: upload.config?.accountType || teamInfo.accountType || 'google', // Pass account type
        abortSignal: abortController.signal,
        onProgress: (current, total) => {
          upload.progress = { current, total };
          this.notifyListeners();
        },
        onLabelProgress: (current, total) => {
          upload.labelProgress = { current, total };
          this.notifyListeners();
        }
      };

      // Use batch upload (same as Pro/Business/Enterprise tiers)
      const result = await uploadPhotoBatch(items, uploadOptions);

      // Mark photos as uploaded in tracker (only successful ones)
      // Team members now support albums, so we can track uploads
      if (result.successful && result.successful.length > 0) {
        const successfulPhotos = result.successful.map(item => item.photo);
        await markPhotosAsUploaded(successfulPhotos, upload.albumName);
      }

      upload.status = 'completed';
      upload.endTime = Date.now();
      upload.result = result;
      this.completedUploads.set(upload.id, upload);
      this.activeUploads.delete(upload.id);
      this.abortControllers.delete(upload.id);
      this.notifyListeners();

      console.warn('[TEAM_UPLOAD] batch ok', {
        upload_id: upload.id,
        photos: items.length,
        successful: result?.successful?.length || 0,
        failed: result?.failed?.length || 0,
        total_ms: Date.now() - batchT0,
      });

    } catch (error) {
      upload.status = 'failed';
      upload.endTime = Date.now();
      upload.error = error.message || 'Team upload failed';
      this.completedUploads.set(upload.id, upload);
      this.activeUploads.delete(upload.id);
      this.abortControllers.delete(upload.id);
      this.notifyListeners();

      console.warn('[TEAM_UPLOAD] batch fail', {
        upload_id: upload.id,
        photos: upload.items?.length || 0,
        total_ms: Date.now() - batchT0,
        msg: error?.message,
      });
    }
  }

  // Cancel specific upload
  cancelUpload(uploadId) {
    // Remove from queue
    this.uploadQueue = this.uploadQueue.filter(upload => upload.id !== uploadId);

    // Abort in-flight requests
    if (this.abortControllers.has(uploadId)) {
      this.abortControllers.get(uploadId).abort();
      this.abortControllers.delete(uploadId);
    }

    // Remove from active uploads and mark as cancelled
    if (this.activeUploads.has(uploadId)) {
      const upload = this.activeUploads.get(uploadId);
      upload.status = 'cancelled';
      upload.endTime = Date.now();
      upload.error = 'Upload cancelled';
      this.completedUploads.set(upload.id, upload);
      this.activeUploads.delete(uploadId);
    }

    this.notifyListeners();
  }

  // Cancel all uploads
  cancelAllUploads() {
    // Abort all in-flight requests
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();

    // Mark active uploads as cancelled
    for (const upload of this.activeUploads.values()) {
      upload.status = 'cancelled';
      upload.endTime = Date.now();
      upload.error = 'Upload cancelled';
      this.completedUploads.set(upload.id, upload);
    }

    this.uploadQueue = [];
    this.activeUploads.clear();
    this.isProcessing = false;
    this.notifyListeners();
  }

  // Get upload status
  getStatus() {
    return {
      activeUploads: Array.from(this.activeUploads.values()),
      queueLength: this.uploadQueue.length,
      isProcessing: this.isProcessing
    };
  }

  // Get completed uploads
  getCompletedUploads() {
    return Array.from(this.completedUploads.values());
  }

  // Clear completed uploads
  clearCompletedUploads() {
    this.completedUploads.clear();
    this.notifyListeners();
  }
}

// Create singleton instance
const backgroundUploadService = new BackgroundUploadService();

export default backgroundUploadService;

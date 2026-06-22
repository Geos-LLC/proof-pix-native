/**
 * CRM Adapter — interface contract every concrete CRM integration
 * must implement. Used by `src/services/crm/index.js` (the facade)
 * to talk to whichever CRM the admin has connected without the rest
 * of the app caring which one it is.
 *
 * Add a new CRM:
 *   1. Create `<name>Adapter.js` in this folder that extends
 *      BaseCRMAdapter and overrides every method below.
 *   2. Register it in `src/services/crm/index.js` (add to ADAPTERS).
 *   3. Add a tile in the Settings → Cloud Sync UI that calls
 *      `crmService.connect(adapterId)`.
 *
 * Data shapes (used across adapters):
 *
 *   Job = {
 *     id: string,              // CRM-side stable id
 *     title: string,           // shown in the picker
 *     customerName?: string,   // optional secondary line
 *     address?: string,        // optional, for project naming
 *     status?: string,         // 'active' / 'completed' / etc.
 *     scheduledAt?: number,    // ms epoch; used to sort
 *     photoCount?: number,     // existing photo count on the job;
 *                              // picker can show "0 photos" badge
 *   }
 *
 *   PhotoPayload = {
 *     localUri: string,        // file:// path the proofpix app holds
 *     filename: string,
 *     mimeType: string,        // 'image/jpeg' typically
 *     mode: 'before'|'after'|'progress'|'combined',
 *     room: string,            // ProofPix folder id
 *     timestamp: number,       // capture ms epoch
 *     gps?: { lat: number, lng: number } | null,
 *     capturedBy?: { name?: string, email?: string } | null,
 *     notes?: string,
 *   }
 *
 *   ConnectResult = {
 *     success: boolean,
 *     connection?: {           // persisted on the Railway proxy
 *       provider: string,        // adapter id, e.g. 'serviceflow'
 *       workspaceId?: string,    // CRM-side workspace/tenant id
 *       workspaceName?: string,  // shown in Settings row
 *       connectedAt: number,     // ms epoch
 *     },
 *     error?: string,
 *   }
 *
 *   AttachResult = {
 *     success: boolean,
 *     crmPhotoId?: string,     // CRM-side id we can store on the photo record
 *     error?: string,
 *   }
 */

/** Stable id used in storage + registry lookups. Override per adapter. */
export class BaseCRMAdapter {
  /** @type {string} — must be globally unique among adapters. */
  static id = 'base';
  /** @type {string} — shown in Settings → Cloud Sync. */
  static displayName = 'CRM';
  /** @type {string} — Ionicons name for the tile. */
  static icon = 'briefcase-outline';

  /**
   * Start the connection flow for this CRM. Shape of `options` is
   * adapter-specific (e.g. Service Flow takes `{ code, deviceLabel }`
   * because we use a paste-in connect code; an OAuth adapter might
   * take none and open a browser; an API-key adapter would take
   * `{ apiKey }`). The facade just forwards whatever the UI passes.
   * @param {object} [options]
   * @returns {Promise<ConnectResult>}
   */
  async connect(options) { throw new Error('CRMAdapter.connect not implemented'); }

  /**
   * Validate the current connection (called on app open). Should
   * return false if the stored token is dead so the UI can mark
   * the connection as needing reconnect.
   * @returns {Promise<boolean>}
   */
  async validateConnection() { throw new Error('CRMAdapter.validateConnection not implemented'); }

  /**
   * Tear down the connection — revoke server-side if possible,
   * clear local cache.
   * @returns {Promise<void>}
   */
  async disconnect() { throw new Error('CRMAdapter.disconnect not implemented'); }

  /**
   * List jobs the admin can attach photos to. Used by the project
   * create modal to render the "Link to job" picker.
   * @param {{status?: string, search?: string, limit?: number}} [filter]
   * @returns {Promise<Job[]>}
   */
  async listJobs(filter) { throw new Error('CRMAdapter.listJobs not implemented'); }

  /**
   * Attach a single photo to a job. Called from
   * backgroundUploadService after the local save completes.
   * @param {string} jobId
   * @param {PhotoPayload} photo
   * @returns {Promise<AttachResult>}
   */
  async attachPhoto(jobId, photo) { throw new Error('CRMAdapter.attachPhoto not implemented'); }

  /**
   * Attach many photos in one call. Used to drain the upload queue
   * efficiently. Default impl can fall back to attachPhoto in a loop
   * if the underlying CRM has no batch endpoint.
   * @param {string} jobId
   * @param {PhotoPayload[]} photos
   * @returns {Promise<AttachResult[]>}
   */
  async attachPhotoBatch(jobId, photos) {
    const results = [];
    for (const p of photos) results.push(await this.attachPhoto(jobId, p));
    return results;
  }
}

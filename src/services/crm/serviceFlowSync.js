/**
 * Service Flow → ProofPix project sync.
 *
 * Pulls the admin's active SF jobs and creates a local ProofPix
 * project for any that don't already have one. Each project carries
 * `crmJobId` + `crmProvider` so the upload service can route photos
 * back to the right SF job at upload time.
 *
 * Phase 1 (this module): admin-only pull on app open / foreground.
 * No webhook, no real-time push. Acceptable because admins rarely
 * create new jobs while ProofPix is foregrounded.
 *
 * Phase 2 (later): same shape, but the proxy calls the SF backend
 * on behalf of the team member. crmService.listJobs() already
 * abstracts that — the adapter will route through the proxy when
 * the proxy support lands. This sync code doesn't change.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import crmService from './index';
import proxyService from '../proxyService';
import { readSecureJSON } from '../secureStorageService';
import { loadProjects } from '../storage';

// SF's /jobs endpoint pages at 100 rows. Loop through the cursor so
// large accounts (>100 total jobs) don't get truncated. Capped so a
// runaway sync can't stall the app.
const PAGE_LIMIT = 100;
const MAX_PAGES = 5;

// SF may send scheduled_at as either a unix-ms number or an ISO
// string depending on how the row was persisted. Older sync builds
// only accepted number, so any string-form scheduled_at was silently
// dropped to null → those projects then fell through the local
// date-chip filter via createdAt (= original sync time), which is
// usually not "today". Accept both formats.
const coerceScheduledAt = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v) {
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatProjectName = (job) => {
  // Prefer customer-name + first segment of the street address.
  // Fall back to job.title (which is the service name in SF) when
  // no customer is set.
  const street = job?.address ? String(job.address).split(',')[0].trim() : '';
  if (job?.customerName && street) return `${job.customerName} · ${street}`;
  if (job?.customerName) return job.customerName;
  if (street) return street;
  return job?.title || `Job ${job?.id || ''}`.trim();
};

/**
 * Sync SF jobs into the ProofPix project list.
 *
 * @param {object} ctx — destructured PhotoContext methods we need
 * @param {Array} [ctx.projects] — IGNORED. Kept in the signature for
 *   back-compat with existing callers, but the dedup map is now built
 *   from a fresh storage read instead because the React-state
 *   `projects` is racy on cold start: PhotoProvider's setLoading(false)
 *   fires inside loadPhotos BEFORE setProjects(projectsList) fires
 *   later in the cold-start effect, so ServiceFlowSyncTrigger saw an
 *   empty array even when the user had 12 SF-linked projects in
 *   Keychain. Every cold start then created 12 duplicates because
 *   dedup matched nothing.
 * @param {Function} ctx.createProject — async (name) => project
 * @param {Function} ctx.patchProject — async (id, patch) => void
 * @returns {Promise<{ created: number, matched: number, error?: string }>}
 */
export async function syncServiceFlowJobs({ createProject, patchProject }) {
  // Two entry points converge here:
  //   admin / individual  → adapter's crmService.listJobs (SF-direct
  //                          with locally-stored SF creds)
  //   team_member         → proxyService.listServiceFlowJobs (proxy
  //                          uses admin's SF refresh token; team
  //                          member device never holds SF creds)
  // Same trust model as the Google Drive upload path.
  const mode = await AsyncStorage.getItem('@admin_user_mode');
  let jobs = [];
  if (mode === 'team_member') {
    const teamInfo = await readSecureJSON('@team_member_info');
    if (!teamInfo?.sessionId || !teamInfo?.token) {
      return { created: 0, matched: 0 };
    }
    try {
      let cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await proxyService.listServiceFlowJobs(teamInfo.sessionId, teamInfo.token, {
          status: 'all',
          limit: PAGE_LIMIT,
          cursor,
        });
        if (result?.notConnected) {
          // Admin hasn't linked SF yet — silent no-op, same as when
          // an admin device has no SF connection.
          return { created: 0, matched: 0 };
        }
        // Proxy passes through SF's response as-is. SF returns snake_case
        // fields; normalise to the adapter's camelCase shape so the
        // downstream merge / dedup logic stays identical.
        const raw = Array.isArray(result?.jobs) ? result.jobs : [];
        for (const row of raw) {
          jobs.push({
            id: row.id,
            title: row.title || '',
            customerName: row.customer_name || null,
            address: row.address || null,
            status: row.status || null,
            scheduledAt: coerceScheduledAt(row.scheduled_at),
            photoCount: typeof row.photo_count === 'number' ? row.photo_count : 0,
          });
        }
        cursor = result?.nextCursor || null;
        if (!cursor || raw.length < PAGE_LIMIT) break;
      }
    } catch (e) {
      return { created: 0, matched: 0, error: e?.message || 'proxy listJobs failed' };
    }
  } else {
    // Admin / individual path — adapter with locally-stored SF creds.
    const provider = await crmService.getActiveProviderId();
    if (provider !== 'serviceflow') {
      return { created: 0, matched: 0 };
    }
    try {
      let cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await crmService.listJobs({ status: 'all', limit: PAGE_LIMIT, cursor });
        const raw = Array.isArray(result?.jobs) ? result.jobs : Array.isArray(result) ? result : [];
        for (const row of raw) {
          // adapter.listJobs already returns camelCase Job shape with
          // its own scheduled_at coercion, but re-run through the
          // helper here so a mixed shape (older cached responses,
          // future adapter changes) still normalises consistently.
          jobs.push({
            ...row,
            scheduledAt: coerceScheduledAt(row.scheduledAt ?? row.scheduled_at),
          });
        }
        cursor = result?.nextCursor || null;
        if (!cursor || raw.length < PAGE_LIMIT) break;
      }
    } catch (e) {
      return { created: 0, matched: 0, error: e?.message || 'listJobs failed' };
    }
  }

  if (jobs.length === 0) return { created: 0, matched: 0 };

  // Bound the sync window on both sides so the Projects list stays
  // scoped to "recent + near-future" instead of pulling every job SF
  // has ever seen. Local UI now has a date-range chip filter, so we
  // pull a wider slice than we display: -30d to +30d. The chip filter
  // (Today / Week / Month / Last 30d / All) narrows what the user
  // actually sees. Jobs without scheduledAt fall through — we can't
  // date-filter them, so we err on the side of including.
  const SYNC_LOOKBACK_DAYS = 30;
  const SYNC_LOOKAHEAD_DAYS = 30;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const windowStart = todayStart - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const windowEnd = todayStart + SYNC_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
  const before = jobs.length;
  jobs = jobs.filter((j) => {
    if (typeof j?.scheduledAt !== 'number') return true;
    return j.scheduledAt >= windowStart && j.scheduledAt < windowEnd;
  });
  if (jobs.length !== before) {
    console.warn('[ServiceFlow] sync window filter', {
      before,
      after: jobs.length,
      lookbackDays: SYNC_LOOKBACK_DAYS,
      lookaheadDays: SYNC_LOOKAHEAD_DAYS,
    });
  }

  if (jobs.length === 0) return { created: 0, matched: 0 };

  // Read the latest persisted project list directly from Keychain
  // for the dedup map. See JSDoc above for the race we're avoiding.
  let currentProjects = [];
  try { currentProjects = await loadProjects() || []; } catch (_) {}

  // Index existing projects by crmJobId for O(1) dedup lookup.
  // Multiple projects could in theory carry the same crmJobId (data
  // corruption, mid-migration, etc.) — using `has`/`get` keeps us
  // tolerant: we treat any existing match as "already synced".
  const existingByJobId = new Map();
  for (const p of currentProjects) {
    if (p?.crmJobId) existingByJobId.set(String(p.crmJobId), p);
  }

  let created = 0;
  let matched = 0;

  for (const job of jobs) {
    const jobId = job?.id != null ? String(job.id) : null;
    if (!jobId) continue;
    if (existingByJobId.has(jobId)) {
      // Refresh crmJobMeta so the date-chip filter reflects SF's
      // current scheduledAt/status even for projects that were
      // synced under earlier (buggy) builds where scheduled_at
      // was stored as null. Only patch when something actually
      // changed to avoid a write on every sync.
      const existing = existingByJobId.get(jobId);
      const prev = existing?.crmJobMeta || {};
      const nextMeta = {
        customerName: job.customerName || null,
        address: job.address || null,
        status: job.status || null,
        scheduledAt: job.scheduledAt || null,
        syncedAt: Date.now(),
      };
      const changed =
        prev.scheduledAt !== nextMeta.scheduledAt ||
        prev.status !== nextMeta.status ||
        prev.customerName !== nextMeta.customerName ||
        prev.address !== nextMeta.address;
      if (changed) {
        try { await patchProject(existing.id, { crmJobMeta: nextMeta }); } catch (_) {}
      }
      matched += 1;
      continue;
    }
    // Create new local project + patch on the CRM linkage. Done
    // as two steps because createProject doesn't accept extra
    // fields today; patching after keeps the createProject API
    // unchanged.
    try {
      const newProject = await createProject(formatProjectName(job));
      if (newProject?.id) {
        await patchProject(newProject.id, {
          crmJobId: jobId,
          crmProvider: 'serviceflow',
          crmJobMeta: {
            customerName: job.customerName || null,
            address: job.address || null,
            status: job.status || null,
            scheduledAt: job.scheduledAt || null,
            syncedAt: Date.now(),
          },
        });
        created += 1;
      }
    } catch (e) {
      console.warn('[serviceFlowSync] Failed to create project for job', jobId, e?.message);
    }
  }

  return { created, matched };
}

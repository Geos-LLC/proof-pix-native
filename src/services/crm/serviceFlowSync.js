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
import { getDeletedJobIds } from './deletedJobsTombstone';

// SF's /jobs endpoint pages at 100 rows. Loop through the cursor so
// large accounts (>100 total jobs) don't get truncated. Capped so a
// runaway sync can't stall the app. Two pages (200 rows) is plenty
// for the ±1-day sync window below — anything beyond that got
// filtered out anyway and just wasted network + created project
// clutter (bit us on 2026-07-28 with 256 auto-created projects).
const PAGE_LIMIT = 100;
const MAX_PAGES = 2;

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
 * @param {Function} [ctx.deleteProject] — async (id, opts) => void.
 *   When provided, enables the authoritative cleanup pass — any
 *   SF-linked local project whose scheduledAt is inside the pull
 *   window but whose crmJobId is NOT in SF's response gets deleted
 *   locally (unless it has photos). Skips tombstoning so a future
 *   SF reappearance can re-create it.
 * @param {Function} [ctx.getProjectPhotoCount] — (projectId) => number.
 *   Required alongside deleteProject to protect projects with user
 *   work (photos) from being auto-deleted.
 * @returns {Promise<{ created: number, matched: number, deleted?: number, error?: string }>}
 */
export async function syncServiceFlowJobs({
  createProject,
  patchProject,
  deleteProject,
  getProjectPhotoCount,
}) {
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
          status: 'active',
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
        const result = await crmService.listJobs({ status: 'active', limit: PAGE_LIMIT, cursor });
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

  // Two windows on purpose:
  //  - PULL window (wide, ±14d): jobs SF still shows in here can
  //    refresh their local crmJobMeta. Without this, a job that gets
  //    rescheduled from Tue → Sat leaves a stale Tuesday entry in
  //    the local list forever, because sync-refresh only fires on
  //    match and the tight create window would exclude Saturday.
  //  - CREATE window (tight, ±1..+2d): matches the Projects chip UI
  //    (Yesterday / Today / Tomorrow). Only auto-create local
  //    projects for jobs in this range. Anything wider re-creates
  //    the "256 auto-projects" mess from 2026-07-28.
  //
  // Jobs without scheduledAt fall through both filters — we can't
  // date-classify them, so we err on the side of processing.
  const PULL_LOOKBACK_DAYS = 14;
  const PULL_LOOKAHEAD_DAYS = 14;
  const CREATE_LOOKBACK_DAYS = 1;
  const CREATE_LOOKAHEAD_DAYS = 2;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const pullStart = todayStart - PULL_LOOKBACK_DAYS * dayMs;
  const pullEnd = todayStart + PULL_LOOKAHEAD_DAYS * dayMs;
  const createStart = todayStart - CREATE_LOOKBACK_DAYS * dayMs;
  const createEnd = todayStart + CREATE_LOOKAHEAD_DAYS * dayMs;
  const before = jobs.length;
  jobs = jobs.filter((j) => {
    if (typeof j?.scheduledAt !== 'number') return true;
    return j.scheduledAt >= pullStart && j.scheduledAt < pullEnd;
  });
  if (jobs.length !== before) {
    console.warn('[ServiceFlow] sync window filter', {
      before,
      after: jobs.length,
      pullLookbackDays: PULL_LOOKBACK_DAYS,
      pullLookaheadDays: PULL_LOOKAHEAD_DAYS,
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

  // Tombstones for jobs the user explicitly deleted locally. Skip
  // recreation on the next sync so manual cleanup sticks.
  const deletedJobIds = await getDeletedJobIds();

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
    // Skip jobs the user has explicitly deleted locally. Without
    // this, sync happily recreates them on the next foreground and
    // the user's cleanup evaporates.
    if (deletedJobIds.has(jobId)) continue;
    // Gate NEW-project creation on the tighter create window. A job
    // scheduled 10 days out shows up in the pull (so we can refresh
    // existing matches) but shouldn't spawn a fresh local project —
    // that's what caused the 256-orphan mess on 2026-07-28.
    if (typeof job.scheduledAt === 'number') {
      if (job.scheduledAt < createStart || job.scheduledAt >= createEnd) continue;
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

  // Authoritative cleanup pass. Any SF-linked local project whose
  // scheduledAt is inside the pull window but whose crmJobId is NOT
  // in SF's response is either stale (job was rescheduled/completed/
  // deleted on SF) or genuinely gone. Delete it locally so the list
  // mirrors SF exactly.
  //
  // Safety rails:
  //   - Only touches crmProvider === 'serviceflow' projects (leaves
  //     manually-created ones alone).
  //   - Requires scheduledAt inside pullStart..pullEnd — projects
  //     outside the window are ignored because SF wouldn't have
  //     returned them anyway.
  //   - Skips projects with photos (user's work stays put even if
  //     the SF row disappeared or the photo count drifted from
  //     upload-race issues).
  //   - Calls deleteProject with skipTombstone so a future SF
  //     reappearance (job un-completed, rescheduled back into the
  //     window) can re-create the project cleanly.
  let deleted = 0;
  if (typeof deleteProject === 'function' && typeof getProjectPhotoCount === 'function') {
    const seenJobIds = new Set(jobs.map((j) => (j?.id != null ? String(j.id) : null)).filter(Boolean));
    for (const p of currentProjects) {
      if (p?.crmProvider !== 'serviceflow') continue;
      if (!p?.crmJobId) continue;
      if (seenJobIds.has(String(p.crmJobId))) continue;
      const ts = p?.crmJobMeta?.scheduledAt;
      if (typeof ts !== 'number') continue;
      if (ts < pullStart || ts >= pullEnd) continue;
      let photoCount = 0;
      try { photoCount = getProjectPhotoCount(p.id) || 0; } catch (_) {}
      if (photoCount > 0) continue;
      try {
        await deleteProject(p.id, { skipTombstone: true });
        deleted += 1;
      } catch (e) {
        console.warn('[serviceFlowSync] cleanup delete failed', p.id, e?.message);
      }
    }
    if (deleted > 0) {
      console.warn('[ServiceFlow] cleanup pass', { deleted, kept: currentProjects.length - deleted });
    }
  }

  return { created, matched, deleted };
}

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
import { readSecureJSON, writeSecureJSON } from '../secureStorageService';
import { loadProjects } from '../storage';
import { getDeletedJobIds } from './deletedJobsTombstone';
import {
  getCreationPolicy,
  isJobEligibleForCreation,
  CREATION_POLICIES,
} from './creationPolicy';

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
  // Diagnostic scope logging — pin down the "SF returned 200 rows one
  // session, 30 the next" mystery on 2026-07-28. If the workspace_id
  // or admin_user_id drift across syncs (because the browser had a
  // stale SF cookie on the last reconnect), we'll see it here.
  // Forward-compat: if SF adds workspace_id / linked_sf_team_member_id
  // to /jobs response body, capture from the first page too.
  let sfResponseScope = null;
  // True when this sync's paginated fetch exhausted (SF said "no more"
  // OR returned a short page). Orphan cleanup below only runs when
  // this is true — otherwise a project missing from what we fetched
  // might just be past the page horizon (MAX_PAGES=2, PAGE_LIMIT=100
  // → 200 max) rather than actually missing from SF.
  let paginationComplete = false;
  if (mode === 'team_member') {
    const teamInfo = await readSecureJSON('@team_member_info');
    if (!teamInfo?.sessionId || !teamInfo?.token) {
      return { created: 0, matched: 0 };
    }
    console.warn('[ServiceFlow] sync scope', {
      mode: 'team_member',
      sessionId: teamInfo.sessionId,
    });
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
        if (page === 0 && (result?.workspace_id || result?.linked_sf_team_member_id != null)) {
          sfResponseScope = {
            workspace_id: result.workspace_id ?? null,
            linked_sf_team_member_id: result.linked_sf_team_member_id ?? null,
          };
        }
        for (const row of raw) {
          jobs.push({
            id: row.id,
            title: row.title || '',
            customerName: row.customer_name || null,
            address: row.address || null,
            status: row.status || null,
            scheduledAt: coerceScheduledAt(row.scheduled_at ?? row.scheduled_date),
            photoCount: typeof row.photo_count === 'number' ? row.photo_count : 0,
            teamMemberId: (typeof row.team_member_id === 'number' && Number.isFinite(row.team_member_id))
              ? row.team_member_id
              : null,
            teamMemberIds: Array.isArray(row.team_member_ids)
              ? row.team_member_ids.filter((v) => typeof v === 'number' && Number.isFinite(v))
              : [],
            // Passed through from SF via the proxy — SF backend
            // migration 077 adds these to /jobs. Null when the
            // connected SF backend predates 077 (mobile client's
            // "New customers only" policy fails safely on null).
            customerId: (typeof row.customer_id === 'number' && Number.isFinite(row.customer_id))
              ? row.customer_id
              : null,
            isFirstJobForCustomer: (typeof row.is_first_job_for_customer === 'boolean')
              ? row.is_first_job_for_customer
              : null,
          });
        }
        cursor = result?.nextCursor || null;
        if (!cursor || raw.length < PAGE_LIMIT) {
          paginationComplete = true;
          break;
        }
      }
    } catch (e) {
      return { created: 0, matched: 0, error: e?.message || 'proxy listJobs failed' };
    }

    // Privacy: a team member must ONLY see jobs assigned to them.
    // If the invite is linked to an SF cleaner id, filter to that
    // cleaner. If it is NOT linked (or the proxy never returned the
    // id), do NOT materialize the full workspace — that was the
    // "team member sees other members' projects" leak. Unscoped
    // invites keep an empty SF list; members still create local
    // projects and capture into those.
    const linkedRaw =
      sfResponseScope?.linked_sf_team_member_id ??
      teamInfo?.linkedSfTeamMemberId ??
      teamInfo?.sfTeamMemberId ??
      null;
    if (linkedRaw != null && linkedRaw !== '') {
      const linkedId = Number(linkedRaw);
      if (Number.isFinite(linkedId)) {
        const before = jobs.length;
        jobs = jobs.filter((j) => {
          if (j.teamMemberId === linkedId) return true;
          if (Array.isArray(j.teamMemberIds) && j.teamMemberIds.includes(linkedId)) return true;
          return false;
        });
        console.warn('[ServiceFlow] team_member assignee filter', {
          linkedId,
          before,
          after: jobs.length,
        });
        try {
          if (teamInfo.linkedSfTeamMemberId !== linkedId) {
            const updated = { ...teamInfo, linkedSfTeamMemberId: linkedId };
            await writeSecureJSON('@team_member_info', updated);
          }
          await AsyncStorage.setItem('@sf_linked_team_member_id', String(linkedId));
        } catch (_) {}
      } else {
        console.warn('[ServiceFlow] team_member: linked id not numeric — skipping SF project create');
        jobs = [];
        try { await AsyncStorage.removeItem('@sf_linked_team_member_id'); } catch (_) {}
      }
    } else {
      console.warn('[ServiceFlow] team_member: no linked SF cleaner — skipping workspace job sync (privacy)');
      jobs = [];
      try { await AsyncStorage.removeItem('@sf_linked_team_member_id'); } catch (_) {}
    }
  } else {
    // Admin / individual path — adapter with locally-stored SF creds.
    const provider = await crmService.getActiveProviderId();
    if (provider !== 'serviceflow') {
      return { created: 0, matched: 0 };
    }
    try {
      const adapter = await crmService.getActiveAdapter();
      const ws = await adapter?.getStoredWorkspace?.();
      console.warn('[ServiceFlow] sync scope', {
        mode: 'admin',
        workspaceId: ws?.workspaceId || null,
        workspaceName: ws?.workspaceName || null,
        adminUserId: ws?.adminUserId || null,
        connectedAt: ws?.connectedAt || null,
      });
    } catch (_) {}
    // 30-day cutoff for sync. Anything scheduled further back that is
    // STILL open is import cruft (SF cleaned up 34 zombies for workspace
    // 2 on 2026-08-21 — some scheduled_date values from March 2025)
    // or forgotten paperwork. Forwarded via SF's `since=YYYY-MM-DD`
    // param (introduced 2026-08-21, ignored by older backends so this
    // remains safe to ship on any binary). Cleaners who need to attach
    // photos to a legit completed job from >30d ago use the picker's
    // `status=completed` path (which SF should be called with a wider
    // `since` from the caller — this only bounds the sync loop).
    const sinceDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();
    try {
      let cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await crmService.listJobs({
          status: 'all',
          limit: PAGE_LIMIT,
          cursor,
          since: sinceDate,
        });
        const raw = Array.isArray(result?.jobs) ? result.jobs : Array.isArray(result) ? result : [];
        if (page === 0 && (result?.workspace_id || result?.linked_sf_team_member_id != null)) {
          sfResponseScope = {
            workspace_id: result.workspace_id ?? null,
            linked_sf_team_member_id: result.linked_sf_team_member_id ?? null,
          };
        }
        for (const row of raw) {
          // adapter.listJobs already returns camelCase Job shape with
          // its own scheduled_at coercion, but re-run through the
          // helper here so a mixed shape (older cached responses,
          // future adapter changes) still normalises consistently.
          // customerId and isFirstJobForCustomer pass through as-is
          // (adapter already coerces to number|null / boolean|null).
          jobs.push({
            ...row,
            scheduledAt: coerceScheduledAt(row.scheduledAt ?? row.scheduled_at),
          });
        }
        // One-shot diagnostic (v43): dump first-job shape from SF /jobs
        // so we can verify customer_id + is_first_job_for_customer
        // arrived correctly post-migration-077 deploy. Also dumps a
        // small counted breakdown to see how many jobs are flagged
        // first vs recurring vs null (older SF backend). Remove after
        // sanity-check passes.
        if (page === 0 && jobs.length > 0) {
          const sample = jobs.slice(0, 3).map((j) => ({
            id: j.id,
            customerId: j.customerId,
            customerName: j.customerName,
            isFirstJobForCustomer: j.isFirstJobForCustomer,
            scheduledDate: j.scheduledDate,
            status: j.status,
          }));
          const counts = jobs.reduce((acc, j) => {
            if (j.isFirstJobForCustomer === true) acc.first += 1;
            else if (j.isFirstJobForCustomer === false) acc.recurring += 1;
            else acc.null += 1;
            if (j.customerId != null) acc.withCustomerId += 1;
            return acc;
          }, { first: 0, recurring: 0, null: 0, withCustomerId: 0, total: jobs.length });
          console.warn('[ServiceFlow] FIRSTJOB DIAG', { sample, counts });
        }
        cursor = result?.nextCursor || null;
        if (!cursor || raw.length < PAGE_LIMIT) {
          paginationComplete = true;
          break;
        }
      }
    } catch (e) {
      return { created: 0, matched: 0, error: e?.message || 'listJobs failed' };
    }
  }
  if (sfResponseScope) {
    console.warn('[ServiceFlow] sync response scope', sfResponseScope);
  }

  // Drop cancelled jobs client-side. SF web's day view shows
  // active + scheduled + completed but hides cancelled. `status=all`
  // is the only bucket that returns completed (needed for finished
  // work on the Yesterday chip), so we take everything and filter
  // out cancelled here to match SF web exactly.
  const beforeCancelFilter = jobs.length;
  jobs = jobs.filter((j) => {
    const s = typeof j?.status === 'string' ? j.status.toLowerCase() : null;
    return s !== 'cancelled' && s !== 'canceled';
  });
  if (jobs.length !== beforeCancelFilter) {
    console.warn('[ServiceFlow] cancelled filter', {
      before: beforeCancelFilter,
      after: jobs.length,
      dropped: beforeCancelFilter - jobs.length,
    });
  }

  if (jobs.length === 0) return { created: 0, matched: 0 };

  // Two windows on purpose:
  //  - PULL window (±14d): jobs SF still shows in here can refresh
  //    their local crmJobMeta.
  //  - CREATE window: same as PULL window (2026-08-21). Prior design
  //    had a tight ±1..+2d create window to avoid the 256-orphan mess
  //    from 2026-07-28 (memory `project_pay_period_todo.md`). That
  //    guard is no longer needed because the orphan cleanup pass below
  //    (v54+) removes local projects that don't match the current SF
  //    response, AND the server-side workspace filters (recurring +
  //    new_customers_only, migrations 079/080) bound what SF returns
  //    in the first place. Keeping windows aligned means sync fully
  //    re-populates local state after a policy flip or a wipe, instead
  //    of leaving the user with 5-7 today/tomorrow projects and no way
  //    to recover the older visible-window entries.
  //
  // Jobs without scheduledAt fall through both filters — we can't
  // date-classify them, so we err on the side of processing.
  const PULL_LOOKBACK_DAYS = 7;
  const PULL_LOOKAHEAD_DAYS = 7;
  const CREATE_LOOKBACK_DAYS = PULL_LOOKBACK_DAYS;
  const CREATE_LOOKAHEAD_DAYS = PULL_LOOKAHEAD_DAYS;
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

  // Local creation policy retired 2026-08-21 — server-side workspace
  // flags (proofpix_show_recurring_jobs, proofpix_new_customers_only)
  // are now the single source of truth for job visibility. Reset any
  // stale 'manual' / 'new_customers' AsyncStorage value to 'all' so
  // isJobEligibleForCreation always returns true and legacy devices
  // don't silently under-filter or wipe local state.
  try {
    const stale = await AsyncStorage.getItem('@sf_creation_policy_v1');
    if (stale && stale !== 'all') {
      await AsyncStorage.setItem('@sf_creation_policy_v1', 'all');
      console.warn('[ServiceFlow] retired stale creation policy', { was: stale });
    }
  } catch {}
  const creationPolicy = 'all';

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

  // Track jobIds we've created in THIS sync run. `existingByJobId` is
  // built from a pre-loop storage snapshot, so if SF returns the same
  // jobId twice in one response (cursor page overlap, join-dedup miss),
  // the second iteration would miss the map and create a duplicate.
  // Bit us on 2026-07-28: "Katrina Holt shows twice on ProofPix but
  // only once on SF." — that's SF returning the row twice.
  const createdInThisRunJobIds = new Set();

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
      const nextTeamMemberIds = Array.isArray(job.teamMemberIds) ? job.teamMemberIds : [];
      const nextMeta = {
        customerName: job.customerName || null,
        address: job.address || null,
        status: job.status || null,
        scheduledAt: job.scheduledAt || null,
        scheduledDate: job.scheduledDate || null,
        teamMemberId: job.teamMemberId ?? null,
        teamMemberIds: nextTeamMemberIds,
        syncedAt: Date.now(),
      };
      const prevIds = Array.isArray(prev.teamMemberIds) ? prev.teamMemberIds : [];
      const idsChanged =
        prevIds.length !== nextTeamMemberIds.length ||
        prevIds.some((v, i) => v !== nextTeamMemberIds[i]);
      const changed =
        prev.scheduledAt !== nextMeta.scheduledAt ||
        prev.scheduledDate !== nextMeta.scheduledDate ||
        prev.status !== nextMeta.status ||
        prev.customerName !== nextMeta.customerName ||
        prev.address !== nextMeta.address ||
        prev.teamMemberId !== nextMeta.teamMemberId ||
        idsChanged;
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
    // Skip if we already created it in this same sync run (SF sent
    // the row twice — see createdInThisRunJobIds JSDoc above).
    if (createdInThisRunJobIds.has(jobId)) continue;
    // Gate NEW-project creation on the tighter create window. A job
    // scheduled 10 days out shows up in the pull (so we can refresh
    // existing matches) but shouldn't spawn a fresh local project —
    // that's what caused the 256-orphan mess on 2026-07-28.
    if (typeof job.scheduledAt === 'number') {
      if (job.scheduledAt < createStart || job.scheduledAt >= createEnd) continue;
    }
    // Creation-policy gate. Applied AFTER the date-window filter, so
    // "New customers only" still respects [-1..+2d]. Note the strict
    // semantics for null: when SF didn't return
    // is_first_job_for_customer (older SF backend, RPC failure), the
    // "new_customers" policy skips creation — no customer_name /
    // local-history fallback because that misclassifies existing
    // recurring customers as new on first sync of a live workspace.
    if (!isJobEligibleForCreation(creationPolicy, job)) continue;
    // Create new local project + patch on the CRM linkage. Done
    // as two steps because createProject doesn't accept extra
    // fields today; patching after keeps the createProject API
    // unchanged.
    try {
      // assignUnassigned: false — never sweep orphan photos into an SF
      // job that just appeared in sync (that caused "new pics in old/wrong
      // project"). skipProxySync: avoid publishing empty SF shells to the
      // admin Team Projects KV before the member has captured anything.
      const newProject = await createProject(formatProjectName(job), {
        assignUnassigned: false,
        skipProxySync: true,
      });
      if (newProject?.id) {
        await patchProject(newProject.id, {
          crmJobId: jobId,
          crmProvider: 'serviceflow',
          crmJobMeta: {
            customerName: job.customerName || null,
            address: job.address || null,
            status: job.status || null,
            scheduledAt: job.scheduledAt || null,
            teamMemberId: job.teamMemberId ?? null,
            teamMemberIds: Array.isArray(job.teamMemberIds) ? job.teamMemberIds : [],
            syncedAt: Date.now(),
          },
        });
        createdInThisRunJobIds.add(jobId);
        created += 1;
      }
    } catch (e) {
      console.warn('[serviceFlowSync] Failed to create project for job', jobId, e?.message);
    }
  }

  // Lifecycle cleanup pass — archive OR delete SF-linked projects
  // once they're older than the ARCHIVE_AGE_DAYS threshold past
  // scheduledAt. Manual/non-SF projects are never auto-touched.
  //
  //   > 7d past scheduledAt + zero photos  → delete locally + remove
  //                                          proxy KV row
  //   > 7d past scheduledAt + has photos   → archive (archived=true,
  //                                          archivedAt=now). Photos
  //                                          are preserved. Project
  //                                          disappears from the
  //                                          active Team tab but is
  //                                          reachable via History.
  //
  // Recreation protection is invariant-based, not tombstone-based
  // (see spec §7):
  //   1. Archived projects still carry crmJobId, so `existingByJobId`
  //      matches them during the next sync — falls into the "update
  //      metadata" branch, never re-created.
  //   2. Deleted zero-photo projects are already >7d past scheduledAt
  //      → outside the [-1, +2] creation window → never re-created.
  //   3. syncedInThisRunJobIds already prevents same-run duplicates.
  //
  // Because of (1) we do NOT tombstone archived projects — a restore
  // must not need to touch the tombstone set. Because of (2) we do
  // NOT tombstone deleted zero-photo projects either.
  const ARCHIVE_AGE_DAYS = 7;
  const ARCHIVE_AGE_MS = ARCHIVE_AGE_DAYS * dayMs;
  let deleted = 0;
  let archived = 0;
  const canRunPhotoCount = typeof getProjectPhotoCount === 'function';
  const canDelete = typeof deleteProject === 'function';
  const canPatch = typeof patchProject === 'function';

  // Orphan-cleanup pass. Local SF-linked projects whose scheduledAt is
  // INSIDE the pull window but whose crmJobId did NOT appear in this
  // sync's response are dead — SF filtered them (workspace recurring
  // toggle now Off) or they no longer exist. Recurring-toggle flip is
  // the primary driver: without this pass, flipping the toggle Off
  // leaves 85 recurring projects on the admin's device forever (they
  // stop matching the sync's SELECT but nothing tells the mobile store
  // "these are gone").
  //
  // Safety:
  //   • Only runs when paginationComplete — otherwise a project past
  //     the page horizon looks orphaned but isn't.
  //   • Only touches projects in [pullStart, pullEnd] — outside that
  //     window the sync doesn't try to be authoritative (age-based
  //     cleanup below handles very old projects; nothing handles very
  //     future ones on a normal cadence, and that's intentional).
  //   • Same delete/archive split as the age-based cleanup — zero
  //     photos → delete, has photos → archive.
  const seenSfJobsInWindow = new Map();
  if (paginationComplete) {
    for (const j of jobs) {
      if (j?.id == null) continue;
      // `jobs` was already trimmed to the pull window earlier — every
      // entry is authoritative by definition.
      seenSfJobsInWindow.set(String(j.id), j);
    }
  }
  let orphanDeleted = 0;
  let orphanArchived = 0;
  let policyPruned = 0;
  if (paginationComplete) {
    for (const p of currentProjects) {
      if (p?.crmProvider !== 'serviceflow') continue;
      if (!p?.crmJobId) continue;
      if (p?.archived === true) continue;
      const ts = p?.crmJobMeta?.scheduledAt;
      if (typeof ts !== 'number') continue;
      if (ts < pullStart || ts >= pullEnd) continue;
      const seenJob = seenSfJobsInWindow.get(String(p.crmJobId));
      // Prune only vanished-from-SF projects. The workspace-flag path is
      // now the ONLY source of truth for "is this job visible" — server
      // filters `is_recurring` and `is_first_job_for_customer` before
      // returning /jobs, so a project failing to appear here IS the
      // policy signal.
      //
      // The v55 client-side failsPolicy check (based on AsyncStorage
      // `@sf_creation_policy_v1`) was retired 2026-08-21 because it
      // could double-filter: if a device had a stale local 'manual'
      // policy, `isJobEligibleForCreation('manual', ...)` returned false
      // for every seenJob and orphan cleanup wiped 100% of local
      // projects — presenting the user with an empty Team tab even
      // though the server was returning 54 valid rows.
      const isVanished = !seenJob;
      if (!isVanished) continue;
      // Orphan.
      let photoCount = 0;
      if (canRunPhotoCount) {
        try { photoCount = getProjectPhotoCount(p.id) || 0; } catch (_) {}
      }
      if (photoCount === 0) {
        if (!canDelete) continue;
        try {
          await deleteProject(p.id, { skipTombstone: true });
          orphanDeleted += 1;
          if (failsPolicy) policyPruned += 1;
          try {
            const sessionId = await AsyncStorage.getItem('@proxy_session_id');
            if (sessionId && proxyService?.adminDeleteTeamProject) {
              await proxyService.adminDeleteTeamProject(sessionId, String(p.id)).catch(() => {});
              if (p.crmJobId && String(p.crmJobId) !== String(p.id)) {
                await proxyService.adminDeleteTeamProject(sessionId, String(p.crmJobId)).catch(() => {});
              }
            }
          } catch (_) {}
        } catch (e) {
          console.warn('[serviceFlowSync] orphan delete failed', p.id, e?.message);
        }
      } else {
        if (!canPatch) continue;
        try {
          await patchProject(p.id, {
            archived: true,
            archivedAt: new Date().toISOString(),
          });
          orphanArchived += 1;
          if (failsPolicy) policyPruned += 1;
        } catch (e) {
          console.warn('[serviceFlowSync] orphan archive failed', p.id, e?.message);
        }
      }
    }
    if (orphanDeleted > 0 || orphanArchived > 0) {
      console.warn('[serviceFlowSync] orphan cleanup', {
        deleted: orphanDeleted,
        archived: orphanArchived,
        policyPruned,          // subset of the above that failed the creation policy
        creationPolicy,
        pullStart: new Date(pullStart).toISOString(),
        pullEnd: new Date(pullEnd).toISOString(),
      });
    }
  }

  for (const p of currentProjects) {
    if (p?.crmProvider !== 'serviceflow') continue;
    if (!p?.crmJobId) continue;
    // Already archived — skip (patchProject would be a no-op but
    // avoids the churn of writing the same fields every sync).
    if (p?.archived === true) continue;
    const ts = p?.crmJobMeta?.scheduledAt;
    if (typeof ts !== 'number') continue;
    const ageMs = Date.now() - ts;
    if (ageMs <= ARCHIVE_AGE_MS) continue;
    let photoCount = 0;
    if (canRunPhotoCount) {
      try { photoCount = getProjectPhotoCount(p.id) || 0; } catch (_) {}
    }
    if (photoCount === 0) {
      // Delete locally + let PhotoContext.deleteProject cascade
      // the proxy row via its existing team-member-flow hook
      // (deleteProjectFromProxyIfTeamMember) when applicable.
      // Admin devices also need the proxy row gone — fire
      // adminDeleteTeamProject directly. Best-effort: proxy failure
      // does not block local delete.
      if (!canDelete) continue;
      try {
        await deleteProject(p.id, { skipTombstone: true });
        deleted += 1;
        try {
          const sessionId = await AsyncStorage.getItem('@proxy_session_id');
          if (sessionId && proxyService?.adminDeleteTeamProject) {
            // Some rows might use crmJobId as their proxy id (post
            // 2026-08-03 team-member sync); others use the original
            // proj_TS. Fire both — deletes are idempotent.
            await proxyService.adminDeleteTeamProject(sessionId, String(p.id)).catch(() => {});
            if (p.crmJobId && String(p.crmJobId) !== String(p.id)) {
              await proxyService.adminDeleteTeamProject(sessionId, String(p.crmJobId)).catch(() => {});
            }
          }
        } catch (_) {}
      } catch (e) {
        console.warn('[serviceFlowSync] cleanup delete failed', p.id, e?.message);
      }
    } else {
      // Photo-carrying → archive (preserves the record + photos).
      if (!canPatch) continue;
      try {
        await patchProject(p.id, {
          archived: true,
          archivedAt: new Date().toISOString(),
        });
        archived += 1;
      } catch (e) {
        console.warn('[serviceFlowSync] cleanup archive failed', p.id, e?.message);
      }
    }
  }
  if (deleted > 0 || archived > 0) {
    console.warn('[ServiceFlow] lifecycle pass', {
      deleted,
      archived,
      threshold_days: ARCHIVE_AGE_DAYS,
      kept: currentProjects.length - deleted - archived,
    });
  }

  // One-shot backfill for team_member accounts: pre-fix SF projects
  // were synced to the proxy KV without crmJobId, so the admin's SF
  // Team-tab card can't query team photos by crmJobId. Republish
  // every SF-linked local project to the proxy so the KV row gains
  // the field. Gated by an AsyncStorage flag so we don't hammer the
  // proxy on every foreground sync.
  //
  // Cheap: one POST per SF-linked project on the member's device
  // (typically <30). Failures are swallowed — a re-run on next
  // foreground retries because we don't set the flag until every
  // publish resolves without throwing.
  if (mode === 'team_member') {
    try {
      const BACKFILL_FLAG = '@proxy_sf_crmJobId_backfill_v1';
      const done = await AsyncStorage.getItem(BACKFILL_FLAG);
      if (done !== 'true') {
        const teamInfo = await readSecureJSON('@team_member_info');
        if (teamInfo?.sessionId && teamInfo.token) {
          const sfProjects = (currentProjects || []).filter(
            (p) => p?.crmProvider === 'serviceflow' && p?.crmJobId && p?.id && p?.name,
          );
          let ok = true;
          for (const p of sfProjects) {
            try {
              await proxyService.syncTeamProject(teamInfo.sessionId, teamInfo.token, {
                id: p.id,
                name: p.name,
                industry: p.industry ?? null,
                createdAt: p.createdAt ?? null,
                memberName: null,
                crmJobId: String(p.crmJobId),
              });
            } catch (e) {
              ok = false;
              console.warn('[ServiceFlow] backfill publish failed', p.id, e?.message);
            }
          }
          if (ok) {
            try { await AsyncStorage.setItem(BACKFILL_FLAG, 'true'); } catch {}
            console.warn('[ServiceFlow] crmJobId backfill complete', { count: sfProjects.length });
          }
        }
      }
    } catch (e) {
      console.warn('[ServiceFlow] crmJobId backfill skipped', e?.message);
    }
  }

  return { created, matched, deleted };
}

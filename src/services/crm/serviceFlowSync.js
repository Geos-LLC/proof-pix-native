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

import crmService from './index';

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
 * @param {Array} ctx.projects — current local project list
 * @param {Function} ctx.createProject — async (name) => project
 * @param {Function} ctx.patchProject — async (id, patch) => void
 * @returns {Promise<{ created: number, matched: number, error?: string }>}
 */
export async function syncServiceFlowJobs({ projects, createProject, patchProject }) {
  // Cheap exit if no CRM connected — adapter returns [] from listJobs
  // and we'd loop over nothing, but skip the call entirely to avoid
  // a needless network round-trip when SF isn't wired up.
  const provider = await crmService.getActiveProviderId();
  if (provider !== 'serviceflow') {
    return { created: 0, matched: 0 };
  }

  let jobs = [];
  try {
    // 'active' is the right default — completed/cancelled jobs
    // shouldn't keep cluttering the ProofPix project list. The
    // adapter handles the bucket mapping (12 SF statuses → 4 buckets).
    const result = await crmService.listJobs({ status: 'active', limit: 100 });
    jobs = Array.isArray(result?.jobs) ? result.jobs : Array.isArray(result) ? result : [];
  } catch (e) {
    return { created: 0, matched: 0, error: e?.message || 'listJobs failed' };
  }

  if (jobs.length === 0) return { created: 0, matched: 0 };

  // Index existing projects by crmJobId for O(1) dedup lookup.
  // Multiple projects could in theory carry the same crmJobId (data
  // corruption, mid-migration, etc.) — using `has`/`get` keeps us
  // tolerant: we treat any existing match as "already synced".
  const existingByJobId = new Map();
  for (const p of (projects || [])) {
    if (p?.crmJobId) existingByJobId.set(String(p.crmJobId), p);
  }

  let created = 0;
  let matched = 0;

  for (const job of jobs) {
    const jobId = job?.id != null ? String(job.id) : null;
    if (!jobId) continue;
    if (existingByJobId.has(jobId)) {
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

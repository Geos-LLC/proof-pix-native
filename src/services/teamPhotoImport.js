/**
 * Team Photo Import
 *
 * One-way import of team-uploaded photos into the admin's local
 * ProofPix data. From the moment import completes, the resulting
 * project + photos are indistinguishable from anything the admin
 * captured directly — same PhotoContext, same Studio, same reports,
 * same share flow — apart from a `capturedBy` attribution stamp and
 * a `source: 'team'` marker on each photo.
 *
 * There is NO synchronization after import. This is an import, not a
 * mirror. If the team member uploads more photos to the original
 * team project later, the admin has to import again (or, more likely,
 * add those photos separately) — that's a feature, not a bug: the
 * imported project is fully owned by the admin from that point.
 *
 * The download step is delegated to the caller via `downloadPhoto`.
 * That keeps the service ignorant of resolution choices, auth
 * headers, and endpoint URLs — callers can point at Drive's =s2000
 * thumbnail CDN (fast, ~4 MP) or at a proxy passthrough streaming
 * original bytes with admin OAuth, without the service needing to
 * know which.
 */

import * as FileSystem from 'expo-file-system/legacy';

const IMPORT_DIR = `${FileSystem.cacheDirectory}team_imports/`;

const resolveType = (tp) => {
  if (!tp) return null;
  if (tp.type) {
    const t = String(tp.type).toLowerCase();
    if (t === 'before' || t === 'after' || t === 'combined') return t;
  }
  const name = tp?.name ? String(tp.name).toLowerCase() : '';
  if (/_before(\.[a-z0-9]+)?$/.test(name)) return 'before';
  if (/_after(\.[a-z0-9]+)?$/.test(name)) return 'after';
  if (/_(combined|mix)(\.[a-z0-9]+)?$/.test(name)) return 'combined';
  return null;
};

async function ensureImportDir() {
  try {
    const info = await FileSystem.getInfoAsync(IMPORT_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(IMPORT_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('[TEAM_IMPORT] Failed to prepare import dir:', e?.message);
  }
}

/**
 * Compute the on-disk path for a downloaded team photo. Exposed so
 * the caller's downloadPhoto callback can honor per-resolution
 * caching (different bytes for reduced vs original) without leaking
 * the directory convention.
 *
 * @param {string} driveFileId
 * @param {'reduced' | 'original'} [resolution='reduced']
 * @returns {string}
 */
export function localPathForTeamPhoto(driveFileId, resolution = 'reduced') {
  const suffix = resolution === 'original' ? '_orig' : '';
  return `${IMPORT_DIR}${driveFileId}${suffix}.jpg`;
}

/**
 * Import team photos into the admin's local ProofPix.
 *
 * If `targetProjectId` is omitted, a new project is created named
 * after the team project. Otherwise photos are added into an
 * existing local project.
 *
 * @param {Object} params
 * @param {Object} params.teamProject                — team project record from proxy
 * @param {Array}  params.teamPhotos                 — photos to import (subset OK for per-photo)
 * @param {Function} params.downloadPhoto            — async (tp) => localPath. Caller decides resolution + auth.
 * @param {Function} params.createProject            — PhotoContext.createProject (async)
 * @param {Function} params.addPhoto                 — PhotoContext.addPhoto (async)
 * @param {Function} [params.onProgress]             — (done, total) => void
 * @param {string}   [params.targetProjectId]        — when set, skip createProject and use this existing project
 * @param {Object}   [params.targetProject]          — when set alongside targetProjectId, used for logging only
 * @returns {Promise<{ project: Object, imported: number, failed: number }>}
 */
export async function importTeamProject({
  teamProject,
  teamPhotos,
  downloadPhoto,
  createProject,
  addPhoto,
  onProgress,
  targetProjectId,
  targetProject,
}) {
  if (!teamProject) throw new Error('MISSING_TEAM_PROJECT');
  if (!Array.isArray(teamPhotos)) throw new Error('MISSING_TEAM_PHOTOS');
  if (typeof downloadPhoto !== 'function') throw new Error('MISSING_DOWNLOAD_PHOTO');
  if (typeof addPhoto !== 'function') throw new Error('MISSING_ADD_PHOTO');

  await ensureImportDir();

  let project;
  if (targetProjectId) {
    project = targetProject || { id: targetProjectId, name: teamProject.name || 'Project' };
  } else {
    if (typeof createProject !== 'function') throw new Error('MISSING_CREATE_PROJECT');
    project = await createProject(teamProject.name || 'Imported project', {
      industry: teamProject.industry || null,
      assignUnassigned: false,
    });
  }
  if (!project?.id) {
    throw new Error('NO_TARGET_PROJECT_ID');
  }

  console.warn('[TEAM_IMPORT] start', {
    teamProjectId: teamProject.id,
    localProjectId: project.id,
    photoCount: teamPhotos.length,
    created: !targetProjectId,
  });

  let imported = 0;
  let failed = 0;

  for (let i = 0; i < teamPhotos.length; i++) {
    const tp = teamPhotos[i];
    try {
      const driveFileId = tp?.id;
      if (!driveFileId) {
        failed += 1;
        continue;
      }

      // Caller-supplied download: returns the local file path. It's
      // free to consult FileSystem.getInfoAsync itself before
      // downloading — that keeps per-resolution cache decisions
      // (thumbnail vs original) close to the caller that made the
      // resolution choice.
      const localPath = await downloadPhoto(tp);
      if (!localPath) {
        failed += 1;
        continue;
      }

      const resolvedType = resolveType(tp);
      const timestampMs = (() => {
        if (tp.createdTime) {
          const parsed = Date.parse(tp.createdTime);
          if (Number.isFinite(parsed)) return parsed;
        }
        return Date.now();
      })();

      await addPhoto({
        id: `team_${driveFileId}_${Date.now()}`,
        uri: localPath,
        projectId: project.id,
        mode: resolvedType || 'single',
        type: resolvedType || null,
        room: tp.room || null,
        capturedBy: tp.capturedBy
          ? { name: tp.capturedBy, capturedAt: tp.createdTime || new Date().toISOString() }
          : null,
        source: 'team',
        driveFileId,
        timestamp: timestampMs,
      });

      imported += 1;
    } catch (err) {
      console.warn('[TEAM_IMPORT] photo failed', { id: tp?.id, msg: err?.message });
      failed += 1;
    }
    onProgress?.(i + 1, teamPhotos.length);
  }

  console.warn('[TEAM_IMPORT] done', {
    localProjectId: project.id,
    imported,
    failed,
  });

  return { project, imported, failed };
}

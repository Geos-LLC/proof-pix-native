/**
 * Team Photo Import
 *
 * One-way import of a team-uploaded project into the admin's local
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
 * Downloads use Google Drive's thumbnail CDN at =s2000, which is
 * large enough for Studio editing + report rendering without hitting
 * the OAuth-guarded original-file endpoint. If the admin flow ever
 * needs byte-exact originals, add a proxy passthrough endpoint that
 * uses the admin's stored refresh token — this module can then swap
 * the download URL without changing the import contract.
 */

import * as FileSystem from 'expo-file-system/legacy';

const IMPORT_DIR = `${FileSystem.cacheDirectory}team_imports/`;

// Drive thumbnailLinks look like ".../s220"; swap the suffix for a
// larger version. Same helper ProjectsScreen uses in the viewer.
const swapDriveThumbSize = (url, size) => {
  if (!url) return url;
  return url
    .replace(/=s\d+(-[^&?]*)?$/, `=s${size}`)
    .replace(/\/s\d+(\/[^?]*)?$/, `/s${size}$1`);
};

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
 * Import a team project into the admin's local ProofPix.
 *
 * @param {Object} params
 * @param {Object} params.teamProject      — team project record from proxy (id, name, industry, ownerName, folderId)
 * @param {Array}  params.teamPhotos       — array of photo records from proxy /projects/:id/photos
 * @param {Function} params.createProject  — PhotoContext.createProject (async)
 * @param {Function} params.addPhoto       — PhotoContext.addPhoto (async)
 * @param {Function} [params.onProgress]   — (done, total) => void
 * @returns {Promise<{ project: Object, imported: number, failed: number }>}
 */
export async function importTeamProject({
  teamProject,
  teamPhotos,
  createProject,
  addPhoto,
  onProgress,
}) {
  if (!teamProject) throw new Error('MISSING_TEAM_PROJECT');
  if (!Array.isArray(teamPhotos)) throw new Error('MISSING_TEAM_PHOTOS');
  if (typeof createProject !== 'function') throw new Error('MISSING_CREATE_PROJECT');
  if (typeof addPhoto !== 'function') throw new Error('MISSING_ADD_PHOTO');

  await ensureImportDir();

  const project = await createProject(teamProject.name || 'Imported project', {
    industry: teamProject.industry || null,
  });
  if (!project?.id) {
    throw new Error('CREATE_PROJECT_RETURNED_NO_ID');
  }

  console.warn('[TEAM_IMPORT] start', {
    teamProjectId: teamProject.id,
    localProjectId: project.id,
    photoCount: teamPhotos.length,
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
      const localPath = `${IMPORT_DIR}${driveFileId}.jpg`;

      // Reuse cached download when the same file has been imported
      // before — dedupes across multiple imports of the same project
      // during testing.
      const existing = await FileSystem.getInfoAsync(localPath);
      if (!existing.exists) {
        const sourceUrl = swapDriveThumbSize(tp.thumbnailLink, 2000);
        if (!sourceUrl) {
          failed += 1;
          continue;
        }
        const result = await FileSystem.downloadAsync(sourceUrl, localPath);
        if (result.status !== 200) {
          console.warn('[TEAM_IMPORT] download non-200', { driveFileId, status: result.status });
          failed += 1;
          continue;
        }
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
        // Fresh local photo id. addPhoto stamps projectId and
        // capturedBy defaults, but we override capturedBy below with
        // the team-member attribution so the imported photo remains
        // credited to whoever shot it.
        id: `team_${driveFileId}_${Date.now()}`,
        uri: localPath,
        projectId: project.id,
        // mode + type both included: different code paths read
        // different fields. resolveType normalizes 'before' / 'after'
        // / 'combined' from proxy meta or filename suffix. Fall back
        // to 'single' when we can't classify — same shape as an
        // untagged capture.
        mode: resolvedType || 'single',
        type: resolvedType || null,
        room: tp.room || null,
        capturedBy: tp.capturedBy
          ? { name: tp.capturedBy, capturedAt: tp.createdTime || new Date().toISOString() }
          : null,
        // Import provenance so downstream flows (delete, share,
        // report) can recognize team-sourced photos if they ever
        // want to display an "Imported" badge.
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

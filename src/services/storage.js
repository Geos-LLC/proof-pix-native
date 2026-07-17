import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as FS from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { saveImageToGalleryNative, deleteImagesFromGalleryNative } from '../utils/mediaStoreSaver';
import { testMediaStoreSaverModule } from '../utils/testMediaStoreSaver';
import {
  readSecure,
  writeSecure,
  readSecureJSON,
  writeSecureJSON,
  deleteSecure,
} from './secureStorageService';

// Test if MediaStoreSaver module is available on startup
if (Platform.OS === 'android') {
  const isAvailable = testMediaStoreSaverModule();
  if (!isAvailable) {
    console.warn('⚠️ MediaStoreSaver native module NOT found! Rebuild the app with EAS.');
  }
}

const PHOTOS_METADATA_KEY = 'cleaning-photos-metadata';
// Backup snapshot of the last non-empty photos metadata. Restored on load
// when the primary key returns []/null but backup has photos. Prevents
// data loss when any code path accidentally persists an empty write
// (stale-closure caller, cold-start race, resetUserData miswired, etc.).
const PHOTOS_METADATA_BACKUP_KEY = 'cleaning-photos-metadata-backup';
const USER_PREFS_KEY = 'user-preferences';
const SETTINGS_KEY = 'app-settings';
const PROJECTS_KEY = 'tracked-projects';
// Backup snapshot of the last non-empty projects list. Same rationale as
// the photos backup — resilience against accidental wipes.
const PROJECTS_BACKUP_KEY = 'tracked-projects-backup';
const ACTIVE_PROJECT_ID_KEY = 'active-project-id';
const ASSET_ID_MAP_KEY = 'asset-id-map';
const UPLOAD_COUNTERS_KEY = 'upload-counters';

/**
 * Loads photo metadata. Backed by secure storage (Keychain on iOS) so the list
 * survives app reinstall on iOS. AsyncStorage acts as a same-install cache.
 */
export const loadPhotosMetadata = async () => {
  try {
    const saved = await readSecureJSON(PHOTOS_METADATA_KEY);
    let list = saved || [];
    // Safety net: if primary key is empty but backup has photos, restore
    // from backup. Covers accidental wipes from stale-closure callers,
    // cold-start races, or miswired reset flows.
    if (list.length === 0) {
      const backup = await readSecureJSON(PHOTOS_METADATA_BACKUP_KEY);
      if (Array.isArray(backup) && backup.length > 0) {
        console.warn('[Storage] loadPhotosMetadata: primary empty, restoring from backup', { backup_count: backup.length });
        list = backup;
        // Re-hydrate primary so future reads are cheap.
        try { await writeSecureJSON(PHOTOS_METADATA_KEY, backup); } catch {}
      }
    }
    const withOvr = list.filter(p => p && p.overrides && typeof p.overrides === 'object' && Object.keys(p.overrides).length);
    console.warn('[OVR] loadPhotosMetadata total=', list.length, 'withOverrides=', withOvr.length, 'sample=', withOvr.slice(0, 3).map(p => ({ id: p.id, keys: Object.keys(p.overrides) })));
    return list;
  } catch (error) {
    return [];
  }
};

/**
 * Saves photo metadata. Writes to both Keychain (iOS reinstall-safe) and
 * AsyncStorage (fast in-session reads). On Android, Keychain equivalent
 * (EncryptedSharedPreferences) is not auto-backed-up — Android persistence
 * across reinstall depends on Google Auto Backup config.
 */
export const savePhotosMetadata = async (photos) => {
  try {
    // Only save metadata, not full images
    const metadata = photos.map(p => ({
      id: p.id,
      room: p.room,
      mode: p.mode,
      name: p.name,
      timestamp: p.timestamp,
      beforePhotoId: p.beforePhotoId,
      aspectRatio: p.aspectRatio,
      // Persist orientation, camera view mode, and zoom so the next
      // shot in a set (After / Progress) can default to the same
      // framing the user chose when capturing the previous photo.
      orientation: p.orientation,
      cameraViewMode: p.cameraViewMode,
      zoom: p.zoom,
      templateType: p.templateType,
      originalWidth: p.originalWidth,
      originalHeight: p.originalHeight,
      uri: p.uri, // File URI in device storage
      // PhotoKit `localUri` cache (iOS reinstall recovery). When set,
      // PhotoContext.loadPhotos uses this instead of calling
      // MediaLibrary.getAssetInfoAsync on cold start — turns a
      // sequential N-call PhotoKit walk into a single existence
      // probe per photo. See `runConcurrent` block in PhotoContext.
      cachedLocalUri: p.cachedLocalUri || null,
      // GPS pair captured at shutter time by CameraScreen
      // (captureGpsForPhoto). Drives the ProjectDetail Location-tab
      // MapView pins. Whitelisted explicitly because savePhotos used
      // to drop these fields, leaving the map silently empty.
      lat: typeof p.lat === 'number' ? p.lat : (typeof p.latitude === 'number' ? p.latitude : null),
      lng: typeof p.lng === 'number' ? p.lng : (typeof p.longitude === 'number' ? p.longitude : null),
      // Text note + voice memo per photo. The whitelist used to drop
      // every one of these silently — the user could type a note in
      // the camera flow's modal and it would vanish on every save.
      // Normalize note/notes (singular was an older field name) into
      // the canonical `notes` going forward.
      notes: (typeof p.notes === 'string' && p.notes) || (typeof p.note === 'string' && p.note) || '',
      noteType: p.noteType || null,
      audioUri: p.audioUri || null,
      audioDurationMs: typeof p.audioDurationMs === 'number' ? p.audioDurationMs : null,
      audioTranscription: p.audioTranscription || null,
      projectId: p.projectId || null,
      // Studio per-photo customizations. The whitelist dropped these
      // silently — a user could drag the label, change a color, or
      // bake markup onto a single photo and watch it revert to global
      // settings on the next app launch. Persist them so per-photo
      // edits survive reloads (and propagate into the report engine,
      // which now merges photo.overrides over the global bundle).
      overrides: (p.overrides && typeof p.overrides === 'object') ? p.overrides : null,
      // Drawings / arrows / text annotations on a photo. Two on-disk
      // shapes are valid: a raw array of shape descriptors (legacy
      // StudioScreen path) or `{ bounds, shapes }` (MarkupEditorScreen
      // — wraps the shapes with the canvas size so other screens can
      // re-render at any frame size). Accept both, drop everything else.
      markup: Array.isArray(p.markup)
        ? p.markup
        : (p.markup && typeof p.markup === 'object' && Array.isArray(p.markup.shapes))
          ? p.markup
          : null,
      // Combined-photo layout + Studio source-swap overrides. STACK /
      // SIDE for stacked vs side-by-side, and the explicit picks the
      // user made in the Layout panel if they swapped Before/After.
      combinedLayout: p.combinedLayout || null,
      beforeOverrideId: p.beforeOverrideId || null,
      afterOverrideId: p.afterOverrideId || null,
      // Free-text location label per photo (typed by the user — not
      // the same as the captured GPS pair above). Drives the meta
      // overlay's address line in reports.
      location: (typeof p.location === 'string' && p.location) || null,
      // GPS pair (alternate names some flows use). Pixel dimensions
      // some templates set in addition to originalWidth/Height.
      width: typeof p.width === 'number' ? p.width : null,
      height: typeof p.height === 'number' ? p.height : null,
      // Pair format chip the user picked in Studio (square / portrait /
      // landscape etc.). Was being dropped silently — "format doesn't
      // persist" was this whitelist not knowing about it.
      pairTemplate: p.pairTemplate || null,
      // Whether this photo is included in generated reports. Toggled
      // from PhotoSetPreviewScreen; was being dropped silently too.
      includeInReport: typeof p.includeInReport === 'boolean' ? p.includeInReport : null,
    }));

    const withOvrIn = photos.filter(p => p && p.overrides && typeof p.overrides === 'object' && Object.keys(p.overrides).length);
    const withOvrOut = metadata.filter(p => p && p.overrides && typeof p.overrides === 'object' && Object.keys(p.overrides).length);
    console.warn('[OVR] savePhotosMetadata in=', photos.length, 'inWithOvr=', withOvrIn.length, 'outWithOvr=', withOvrOut.length, 'sampleIn=', withOvrIn.slice(0, 3).map(p => ({ id: p.id, keys: Object.keys(p.overrides) })));

    // Log empty writes prominently — these are the wipe risk. Include a
    // stack trace so we can identify the caller in Loki.
    if (metadata.length === 0) {
      const stack = new Error('empty savePhotosMetadata trace').stack || '(no stack)';
      console.warn('[Storage] savePhotosMetadata EMPTY WRITE — potential wipe', {
        stack: stack.split('\n').slice(0, 6).join(' | '),
      });
    }

    await writeSecureJSON(PHOTOS_METADATA_KEY, metadata);

    // Snapshot to backup key ONLY when we have real photos. On empty
    // writes, leave the backup untouched so loadPhotosMetadata can
    // restore from it. Explicit wipes via clearPhotos() clear both.
    if (metadata.length > 0) {
      try { await writeSecureJSON(PHOTOS_METADATA_BACKUP_KEY, metadata); } catch {}
    }

    return true;
  } catch (error) {
    throw error; // Re-throw to let caller know save failed
  }
};

/**
 * Clears all photos from storage (both Keychain and AsyncStorage)
 */
export const clearPhotos = async () => {
  try {
    await deleteSecure(PHOTOS_METADATA_KEY);
    // Explicit wipe path must also clear the backup — otherwise
    // loadPhotosMetadata would immediately restore from backup.
    await deleteSecure(PHOTOS_METADATA_BACKUP_KEY);
  } catch (error) {
  }
};

/**
 * Saves a photo to device storage
 */
export const savePhotoToDevice = async (uri, filename, projectId = null) => {
  console.warn(`[PHOTODEL] savePhotoToDevice called filename=${filename} projectId=${projectId || 'NULL'}`);
  try {
    // First, copy to app's document directory (for reliable access)
    const fileUri = `${FileSystem.documentDirectory}${filename}`;
    let finalFileUri = fileUri;

    // If the URI is already in our directory, use it directly
    if (uri.startsWith(FileSystem.documentDirectory)) {
      finalFileUri = uri; // keep the original file path
    } else {
      // Copy to document directory
      await FileSystem.copyAsync({
        from: uri,
        to: fileUri
      });
      finalFileUri = fileUri;
    }

    // Save to media library (device Photos / Gallery) – same flow for iOS and Android.
    // This mirrors the original iOS behavior: create an asset and ensure it's in a "ProofPix" album.
    let status = 'undetermined';
    let accessPrivileges = 'none';
    try {
      // Check current permission status first (no options to avoid Kotlin conversion error)
      const currentStatus = await MediaLibrary.getPermissionsAsync();
      status = currentStatus.status;
      accessPrivileges = currentStatus.accessPrivileges || 'none';

      console.log('[Storage] Current permission status:', status, ', accessPrivileges:', accessPrivileges);

      // On Android 14+, if status is "limited", user selected partial access which causes confirmation dialogs
      // We need full access to avoid the dialog on each photo save
      if (status === 'limited' || (status === 'granted' && accessPrivileges === 'limited')) {
        console.log('[Storage] ⚠️ Limited access detected - app will show confirmation on each save');
        console.log('[Storage] Requesting full access...');
        const requestResult = await MediaLibrary.requestPermissionsAsync();
        status = requestResult.status;
        accessPrivileges = requestResult.accessPrivileges || 'none';
        console.log('[Storage] New permission:', status, ', accessPrivileges:', accessPrivileges);
      } else if (status !== 'granted') {
        console.log('[Storage] Requesting media library permission...');
        const requestResult = await MediaLibrary.requestPermissionsAsync();
        status = requestResult.status;
        accessPrivileges = requestResult.accessPrivileges || 'none';
        console.log('[Storage] Permission result:', status, ', accessPrivileges:', accessPrivileges);
      } else {
        console.log('[Storage] ✅ Full media library access granted');
      }
    } catch (permError) {
      console.warn('[Storage] Permission error:', permError);
    }

    if (status === 'granted' || status === 'limited') {
      try {
        let asset = null;

        // On Android, use native MediaStore API to avoid confirmation dialogs on Samsung devices
        if (Platform.OS === 'android') {
          try {
            console.log('[Storage] Using native MediaStore saver for Android');
            const justName = (finalFileUri.split('/').pop() || '').split('?')[0];
            await saveImageToGalleryNative(finalFileUri, justName);
            console.log('[Storage] ✅ Saved via native MediaStore (no confirmation dialog)');

            // Note: We don't get an asset ID from native saver, so we skip asset ID mapping
            // Photos can still be found by filename for deletion
          } catch (nativeError) {
            console.warn('[Storage] Native saver failed, falling back to expo-media-library:', nativeError);
            // Fallback to expo-media-library
            asset = await MediaLibrary.createAssetAsync(finalFileUri);
          }
        } else {
          // iOS: use expo-media-library as usual
          asset = await MediaLibrary.createAssetAsync(finalFileUri);
          console.warn(`[PHOTODEL] createAssetAsync returned id=${asset?.id || 'NONE'} for ${filename}`);
        }

        // Only handle album and asset ID mapping if we used expo-media-library
        if (asset) {
          // Create/add to ProofPix album (works on both iOS and Android)
          const album = await MediaLibrary.getAlbumAsync('ProofPix');
          if (album == null) {
            await MediaLibrary.createAlbumAsync('ProofPix', asset, false);
          } else {
            await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
          }

          // Store a mapping from filename -> assetId for reliable deletion later.
          // Use the shared helpers so the write hits BOTH Keychain and
          // AsyncStorage — the read path (getAssetIdMap) checks both, so
          // writing to only one of them silently breaks project deletion.
          if (asset?.id) {
            try {
              const map = await getAssetIdMap();
              const justName = (finalFileUri.split('/').pop() || '').split('?')[0];
              if (justName) {
                const prev = map[justName];
                map[justName] = typeof prev === 'string'
                  ? { id: asset.id, projectId }
                  : { id: asset.id, projectId: prev?.projectId ?? projectId };
                await setAssetIdMap(map);
                console.warn(`[PHOTODEL] map WRITE name=${justName} id=${asset.id} projectId=${map[justName].projectId || 'NULL'}`);
              }
            } catch (mapErr) {
              console.warn('[Storage] Could not update asset id map:', mapErr);
            }
          }
        }
      } catch (mlError) {
        // Media library save failed, but photo is already in app storage so it's OK
        console.warn('[Storage] Could not save to media library:', mlError);
      }
    }
    // Return the file URI (not the ph:// URL from media library)
    return finalFileUri;
  } catch (error) {
    throw error;
  }
};

/**
 * Delete a saved photo from the app's storage and the device media library
 * Accepts a full photo object (expects at least { uri })
 */
export const deletePhotoFromDevice = async (photo, options = {}) => {
  try {
    if (!photo) return;
    const uri = photo.uri;
    if (!uri || typeof uri !== 'string') return;

    const shouldDeleteFromStorage = options.deleteFromStorage !== false;
    console.log('[Storage] deletePhotoFromDevice called with deleteFromStorage:', shouldDeleteFromStorage);

    // Derive a filename for media library lookup
    const filename = (uri.split('/').pop() || '').split('?')[0];

    // 1) Delete from app documents directory (idempotent)
    try {
      if (uri.startsWith(FileSystem.documentDirectory)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        console.log('[Storage] Deleted from app directory:', filename);
      } else if (uri.startsWith('file://')) {
        // Try deleting other file:// targets as best-effort
        await FileSystem.deleteAsync(uri, { idempotent: true });
        console.log('[Storage] Deleted file:', filename);
      }
    } catch (fsErr) {
      console.warn('[Storage] Failed to delete local file:', fsErr);
    }

    // 2) Delete from media library only if deleteFromStorage is not false
    if (!shouldDeleteFromStorage) {
      console.log('[Storage] Skipping media library deletion as requested');
      return;
    }

    console.log('[Storage] Proceeding with media library deletion');
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[Storage] Media library permission not granted');
        return;
      }

      // On Android, try native MediaStore deletion first (more reliable)
      if (Platform.OS === 'android') {
        try {
          const result = await deleteImagesFromGalleryNative([filename]);
          console.log('[Storage] ✅ Native delete result:', result);
          return; // Successfully deleted via native method
        } catch (nativeDelErr) {
          console.warn('[Storage] Native delete failed, falling back to expo-media-library:', nativeDelErr);
          // Continue to expo-media-library fallback below
        }
      }

      // Try direct assetId from stored mapping
      try {
        const map = await getAssetIdMap();
        const entry = map[filename];
        const assetId = typeof entry === 'string' ? entry : entry?.id;
        if (assetId) {
          try {
            await MediaLibrary.deleteAssetsAsync([assetId]);
            delete map[filename];
            await setAssetIdMap(map);
            console.log('[Storage] ✅ Deleted from media library by assetId:', filename);
            return; // deletion done
          } catch (byIdErr) {
            console.warn('[Storage] Failed to delete by assetId:', byIdErr);
          }
        }
      } catch (mapDelErr) {
        console.warn('[Storage] Failed to access asset map:', mapDelErr);
      }

      const findMatch = (assetsArr) => assetsArr.find((a) => {
        if (!a) return false;
        if (a.filename && a.filename === filename) return true;
        if (a.uri && typeof a.uri === 'string' && filename && a.uri.endsWith(filename)) return true;
        return false;
      });

      let match = null;
      const album = await MediaLibrary.getAlbumAsync('ProofPix');
      if (album) {
        const assets = await MediaLibrary.getAssetsAsync({
          album,
          first: 2000,
          mediaType: [MediaLibrary.MediaType.photo]
        });
        match = findMatch(assets.assets);
      }

      // Fallback: global scan if not found in album or album missing
      if (!match) {
        const global = await MediaLibrary.getAssetsAsync({ first: 2000, mediaType: [MediaLibrary.MediaType.photo] });
        match = findMatch(global.assets);
      }

      if (match) {
        try {
          await MediaLibrary.deleteAssetsAsync([match]);
          console.log('[Storage] ✅ Deleted from media library by filename search:', filename);
        } catch (delErr) {
          console.warn('[Storage] Failed to delete asset:', delErr);
          if (album) {
            try {
              await MediaLibrary.removeAssetsFromAlbumAsync([match], album, false);
              console.log('[Storage] ✅ Removed from ProofPix album:', filename);
            } catch (remErr) {
              console.warn('[Storage] Failed to remove from album:', remErr);
            }
          }
        }
      } else {
        console.warn('[Storage] ⚠️ Photo not found in media library:', filename);
      }
    } catch (mlErr) {
      console.error('[Storage] Media library deletion error:', mlErr);
    }
  } catch (error) {
    console.error('[Storage] deletePhotoFromDevice error:', error);
  }
};

// Helper: get/set asset ID map in secure storage (Keychain on iOS,
// EncryptedSharedPreferences on Android). Keychain survives app reinstall on
// iOS so the filename -> MediaLibrary assetId mapping persists alongside the
// photos in the system "ProofPix" album. Android reinstall persistence
// depends on Auto Backup config and isn't a requirement.
export const getAssetIdMap = async () => {
  try {
    const stored = await readSecureJSON(ASSET_ID_MAP_KEY);
    return stored || {};
  } catch {
    return {};
  }
};

const setAssetIdMap = async (map) => {
  try { await writeSecureJSON(ASSET_ID_MAP_KEY, map); } catch {}
};

/**
 * One-shot recovery for Before/After/Progress photos whose `uri` field
 * was overwritten by the pre-fix Studio "Source Photos" picker with a
 * side-by-side composite (`*_COMBINED_BASE_*.jpg` / `*_COMBINED_EDIT_*.jpg`
 * in app docs). Walks the photos metadata, finds the contaminated
 * records, and re-links each one to its original AFTER/BEFORE/PROGRESS
 * bitmap via the Keychain `asset-id-map` (or a MediaLibrary album scan
 * as fallback).
 *
 * Returns { repaired, unrecoverable, scanned, total } counters so the
 * caller can show a result alert. Does NOT delete the contaminated
 * composite files on disk — leaving them lets us roll back if a
 * mistake is found. Caller should ask the user to restart the app (or
 * call PhotoContext.loadPhotos) afterward so the in-memory array
 * refreshes.
 */
export const repairCorruptedPhotoUris = async () => {
  const photos = await loadPhotosMetadata();
  const map = await getAssetIdMap();
  let scanned = 0;
  let repaired = 0;
  let unrecoverable = 0;

  // Resolve a MediaLibrary assetId to a usable local URI. The
  // `localUri` from getAssetInfoAsync is what the rest of the app
  // already consumes (see PhotoContext.loadPhotos).
  const resolveAssetIdToUri = async (assetId) => {
    if (!assetId) return null;
    try {
      const info = await MediaLibrary.getAssetInfoAsync(assetId);
      return info?.localUri || info?.uri || null;
    } catch {
      return null;
    }
  };

  // Pull out the per-photo prefix (`<room>_<safeName>`) from a
  // contaminated composite filename like
  //   `seed_front_roof_seed_front_roof_17_COMBINED_BASE_SIDE_<ts>_Pproj_xxx.jpg`
  //   `seed_front_roof_seed_front_roof_17_COMBINED_EDIT_STACK_<ts>.jpg`
  // Returns null when the filename doesn't match the composite shape.
  const parsePrefix = (uri) => {
    const u = String(uri || '');
    const slash = u.lastIndexOf('/');
    const file = slash >= 0 ? u.slice(slash + 1) : u;
    const m = file.match(/^(.+)_COMBINED_(?:BASE|EDIT)_(?:SIDE|STACK)_\d+(?:_P[^/]+)?\.jpg$/i);
    return m ? m[1] : null;
  };

  // Map photo.mode → the role token used in the original
  // savePhotoToDevice filename.
  const roleOf = (mode) => {
    if (mode === 'before') return 'BEFORE';
    if (mode === 'after') return 'AFTER';
    if (mode === 'progress') return 'PROGRESS';
    return null;
  };

  // Search the asset-id-map for the most recent original-role entry
  // sharing the same `<room>_<safeName>` prefix. Falls back to a
  // MediaLibrary album scan when the Keychain map has no hit (e.g.,
  // post-reinstall before the map was rebuilt).
  let mediaLibraryAssetsCache = null;
  const loadMediaLibraryAssets = async () => {
    if (mediaLibraryAssetsCache) return mediaLibraryAssetsCache;
    try {
      const album = await MediaLibrary.getAlbumAsync('ProofPix');
      if (!album) { mediaLibraryAssetsCache = []; return mediaLibraryAssetsCache; }
      const out = [];
      let endCursor;
      let hasNext = true;
      while (hasNext) {
        const page = await MediaLibrary.getAssetsAsync({
          album: album.id,
          mediaType: 'photo',
          first: 200,
          ...(endCursor ? { after: endCursor } : null),
        });
        for (const a of (page.assets || [])) out.push(a);
        endCursor = page.endCursor;
        hasNext = page.hasNextPage;
      }
      mediaLibraryAssetsCache = out;
      return out;
    } catch {
      mediaLibraryAssetsCache = [];
      return mediaLibraryAssetsCache;
    }
  };

  const findOriginalUri = async (prefix, role) => {
    const reAssetMap = new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}_${role}_(\\d+)\\.jpg$`, 'i');
    let best = null;
    for (const [filename, entry] of Object.entries(map || {})) {
      const mm = reAssetMap.exec(filename);
      if (!mm) continue;
      const ts = parseInt(mm[1], 10);
      if (!Number.isFinite(ts)) continue;
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (!id) continue;
      if (!best || ts > best.ts) best = { ts, id, filename };
    }
    if (best) {
      const uri = await resolveAssetIdToUri(best.id);
      if (uri) return { uri, source: 'asset-id-map', via: best.filename };
    }
    // Fallback A — scan the documentDirectory for files matching the
    // pattern. This is the MOST reliable lookup: savePhotoToDevice
    // always copies into documentDirectory with the canonical filename
    // before doing the MediaLibrary write, so a clean original is
    // almost always sitting on disk here even if the Keychain map or
    // the Photos album lost the entry.
    try {
      const docDir = FileSystem.documentDirectory;
      const dirEntries = await FileSystem.readDirectoryAsync(docDir);
      let docBest = null;
      for (const name of dirEntries) {
        const mm = reAssetMap.exec(name);
        if (!mm) continue;
        const ts = parseInt(mm[1], 10);
        if (!Number.isFinite(ts)) continue;
        if (!docBest || ts > docBest.ts) docBest = { ts, name };
      }
      if (docBest) {
        return { uri: `${docDir}${docBest.name}`, source: 'document-directory-scan', via: docBest.name };
      }
    } catch (err) {
      console.warn('[repairCorruptedPhotoUris] documentDirectory scan failed', err);
    }
    // Fallback B — scan the ProofPix MediaLibrary album by filename.
    // Useful after a reinstall when documentDirectory was wiped but
    // the iOS Photos album survived.
    const assets = await loadMediaLibraryAssets();
    let mlFallback = null;
    for (const a of assets) {
      const name = a.filename || '';
      const mm = reAssetMap.exec(name);
      if (!mm) continue;
      const ts = parseInt(mm[1], 10);
      if (!Number.isFinite(ts)) continue;
      if (!mlFallback || ts > mlFallback.ts) mlFallback = { ts, asset: a };
    }
    if (mlFallback) {
      const uri = await resolveAssetIdToUri(mlFallback.asset.id);
      if (uri) return { uri, source: 'media-library-scan', via: mlFallback.asset.filename };
    }
    return null;
  };

  const next = [];
  for (const p of photos) {
    next.push(p);
    if (!p) continue;
    if (p.mode === 'mix') continue;        // combined — composite is correct
    const prefix = parsePrefix(p.uri);
    if (!prefix) continue;                 // uri isn't a composite filename
    scanned += 1;
    const role = roleOf(p.mode);
    if (!role) { unrecoverable += 1; continue; }
    const found = await findOriginalUri(prefix, role);
    if (!found) {
      unrecoverable += 1;
      continue;
    }
    // Replace the URI in place; keep `localUri` cleared so PhotoContext
    // re-derives it on next load (avoids stale cache reads).
    next[next.length - 1] = { ...p, uri: found.uri, localUri: null };
    repaired += 1;
    console.warn(`[repairCorruptedPhotoUris] repaired photo id=${p.id} mode=${p.mode} via=${found.source} (${found.via})`);
  }

  if (repaired > 0) {
    await savePhotosMetadata(next);
  }

  return { repaired, unrecoverable, scanned, total: photos.length };
};

// Sanitize filename for loose matching (remove spaces and non-alphanumerics, lowercase)
const normalizeName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Batch delete media library assets by filenames. Reduces confirmation prompts on iOS.
 */
export const deleteAssetsByFilenames = async (filenames, projectIdFilter = null) => {
  try {
    if (!Array.isArray(filenames) || filenames.length === 0) return;
    const uniqueNames = Array.from(new Set(filenames.filter(Boolean)));
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    const map = await getAssetIdMap();
    const wantedIds = new Set();
    const remaining = [];
    for (const name of uniqueNames) {
      const entry = map[name];
      const id = typeof entry === 'string' ? entry : entry?.id;
      const pid = typeof entry === 'object' ? entry?.projectId : null;
      if (id && (!projectIdFilter || (pid && pid === projectIdFilter))) {
        wantedIds.add(id);
      } else {
        remaining.push(name);
      }
    }

    const tryFindMatches = async (scope) => {
      const res = await MediaLibrary.getAssetsAsync(scope);
      const byNorm = new Map();
      for (const a of res.assets) {
        const norm = normalizeName(a.filename);
        if (norm) byNorm.set(norm, a.id);
      }
      for (const name of [...remaining]) {
        const found = byNorm.get(normalizeName(name));
        if (found) {
          wantedIds.add(found);
        }
      }
    };

    if (!projectIdFilter) {
      const album = await MediaLibrary.getAlbumAsync('ProofPix');
      if (album) {
        await tryFindMatches({ album, first: 2000, mediaType: [MediaLibrary.MediaType.photo] });
      }
      await tryFindMatches({ first: 2000, mediaType: [MediaLibrary.MediaType.photo] });
    }

    const ids = Array.from(wantedIds);
    if (ids.length > 0) {
      try {
        await MediaLibrary.deleteAssetsAsync(ids);
        // Clean mapping
        for (const name of uniqueNames) delete map[name];
        await setAssetIdMap(map);
      } catch (err) {
      }
    } else {
    }
  } catch (e) {
  }
};

/**
 * Batch delete media assets by filename prefixes using the assetId map.
 * This reliably catches combined/base assets whose system filenames may not match.
 */
export const deleteAssetsByPrefixes = async (prefixes, projectIdFilter = null) => {
  try {
    if (!Array.isArray(prefixes) || prefixes.length === 0) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }
    const map = await getAssetIdMap();
    const ids = [];
    const normPrefixes = prefixes.map(p => normalizeName(p));
    const keyMatches = (key) => {
      const nk = normalizeName(key);
      return normPrefixes.some(np => nk.startsWith(np));
    };
    Object.keys(map).forEach((key) => {
      if (!keyMatches(key)) return;
      const entry = map[key];
      const id = typeof entry === 'string' ? entry : entry?.id;
      const pid = typeof entry === 'object' ? entry?.projectId : null;
      if (id && (!projectIdFilter || (pid && pid === projectIdFilter))) ids.push(id);
    });
    if (ids.length === 0) {
      return;
    }
    try {
      await MediaLibrary.deleteAssetsAsync(ids);
      // Clean mapping entries
      for (const key of Object.keys(map)) {
        if (!keyMatches(key)) continue;
        const entry = map[key];
        const pid = typeof entry === 'object' ? entry?.projectId : null;
        if (!projectIdFilter || (pid && pid === projectIdFilter)) delete map[key];
      }
      await setAssetIdMap(map);
    } catch (e) {
    }
  } catch (e) {
  }
};

/**
 * Delete all assets for a projectId using the assetId map only (no filename scanning).
 * This prevents cross-project deletions when filenames collide.
 */
export const deleteProjectAssets = async (projectId) => {
  try {
    if (!projectId) {
      console.warn('[PHOTODEL] deleteProjectAssets called with no projectId');
      return;
    }

    console.warn(`[PHOTODEL] start projectId=${projectId} platform=${Platform.OS}`);
    const map = await getAssetIdMap();
    const totalMapEntries = Object.keys(map || {}).length;
    const filenames = [];
    const assetIds = [];
    // Audit how the map looks: how many entries are strings (legacy), how
    // many have projectId, how many match this project.
    let stringEntries = 0;
    let withProject = 0;
    let matchedProject = 0;
    for (const [name, entry] of Object.entries(map)) {
      const pid = typeof entry === 'string' ? null : entry?.projectId;
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (typeof entry === 'string') stringEntries++;
      if (pid) withProject++;
      if (pid && pid === projectId) {
        matchedProject++;
        filenames.push(name);
        if (id) assetIds.push(id);
      }
    }

    console.warn(
      `[PHOTODEL] map totalEntries=${totalMapEntries} strings=${stringEntries} ` +
      `withProjectId=${withProject} matchedThisProject=${matchedProject}`,
    );
    console.warn(`[PHOTODEL] assetIds count=${assetIds.length} firstId=${assetIds[0] || 'none'}`);
    console.warn(`[PHOTODEL] filenames count=${filenames.length} first=${filenames[0] || 'none'}`);

    // Delete media assets in a single batch
    if (assetIds.length > 0 || filenames.length > 0) {
      try {
        console.warn('[PHOTODEL] requesting MediaLibrary permission...');
        const { status, accessPrivileges } = await MediaLibrary.requestPermissionsAsync();
        console.warn(`[PHOTODEL] permission status=${status} accessPrivileges=${accessPrivileges || 'n/a'}`);

        if (status === 'granted') {
          // On Android, try native MediaStore deletion first (more reliable)
          if (Platform.OS === 'android' && filenames.length > 0) {
            try {
              console.log(`[Storage] Attempting native delete for ${filenames.length} files...`);
              const result = await deleteImagesFromGalleryNative(filenames);
              console.log('[Storage] ✅ Native delete result:', result);
              console.log('[Storage] ✅ Delete operation completed via native method');
              return; // Successfully deleted via native method
            } catch (nativeDelErr) {
              console.warn('[Storage] Native delete failed, falling back to expo-media-library:', nativeDelErr);
              // Continue to expo-media-library fallback below
            }
          }

          console.warn(`[PHOTODEL] calling MediaLibrary.deleteAssetsAsync with ${assetIds.length} ids`);
          const deleteResult = await MediaLibrary.deleteAssetsAsync(assetIds);
          console.warn(`[PHOTODEL] deleteAssetsAsync returned=${deleteResult}`);

          // Verify deletion by trying to fetch the assets
          for (const assetId of assetIds) {
            try {
              const asset = await MediaLibrary.getAssetInfoAsync(assetId);
              if (asset) {
                console.warn('[Storage] ⚠️ Asset still exists after deletion:', assetId, asset.filename);
              } else {
                console.log('[Storage] ✅ Asset successfully deleted:', assetId);
              }
            } catch (verifyError) {
              console.log('[Storage] ✅ Asset deleted (not found):', assetId);
            }
          }

          console.log('[Storage] ✅ Delete operation completed');
        } else {
          console.warn('[Storage] ⚠️ Permission not granted, cannot delete from media library');
        }
      } catch (e) {
        console.error('[Storage] ❌ Error deleting assets:', e);
        console.error('[Storage] Error details:', e.message, e.stack);
      }
    } else {
      console.warn('[Storage] ⚠️ No assets found to delete for project', projectId);
    }

    // Delete local doc files by filename
    try {
      const dir = FileSystem.documentDirectory;
      if (dir) {
        for (const name of filenames) {
          const full = `${dir}${name}`;
          try {
            await FileSystem.deleteAsync(full, { idempotent: true });
          } catch (e) {
          }
        }
      } else {
      }
    } catch (e) {
    }

    // Clean the map
    const newMap = { ...map };
    for (const name of filenames) delete newMap[name];
    await setAssetIdMap(newMap);
  } catch (e) {
  }
};

// (removed duplicate deleteProjectAssets)

/**
 * Delete multiple photos from device/storage.
 */
export const deletePhotosFromDevice = async (photos) => {
  if (!Array.isArray(photos) || photos.length === 0) return;
  for (const p of photos) {
    await deletePhotoFromDevice(p, { noConfirmation: true });
  }
};

/**
 * Purge all images saved by the app from device storage and media library.
 * - Deletes all .jpg/.jpeg/.png files in the app's document directory
 * - Deletes all assets inside the 'ProofPix' album in the media library
 */
export const purgeAllDevicePhotos = async () => {
  // 1) Delete all image files in app documents directory
  try {
    const dir = FileSystem.documentDirectory;
    if (dir) {
      const entries = await FileSystem.readDirectoryAsync(dir);
      for (const name of entries) {
        const lower = name.toLowerCase();
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) {
          const full = `${dir}${name}`;
          try {
            await FileSystem.deleteAsync(full, { idempotent: true });
          } catch (delErr) {
          }
        }
      }
    }
  } catch (fsListErr) {
  }

  // 2) Delete all assets inside the ProofPix album
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    const album = await MediaLibrary.getAlbumAsync('ProofPix');
    if (!album) return;

    // Paginate through all assets
    let endCursor = undefined;
    const pageSize = 1000;
    const toDelete = [];
    while (true) {
      const page = await MediaLibrary.getAssetsAsync({
        album,
        first: pageSize,
        after: endCursor,
        mediaType: [MediaLibrary.MediaType.photo]
      });
      toDelete.push(...page.assets);
      if (!page.hasNextPage) break;
      endCursor = page.endCursor;
    }

    if (toDelete.length > 0) {
      try {
        await MediaLibrary.deleteAssetsAsync(toDelete);
      } catch (mlChangeErr) {
        try {
          await MediaLibrary.removeAssetsFromAlbumAsync(toDelete, album, false);
        } catch (remErr) {
        }
      }
    }
  } catch (mlErr) {
  }
};

/**
 * Batch delete media library assets by a combination of filenames and prefixes.
 * Consolidates deletion into a single OS prompt.
 */
export const deleteAssetsBatch = async ({ filenames = [], prefixes = [], deleteFromStorage = true }) => {
  try {
    console.log('[Storage] deleteAssetsBatch called with deleteFromStorage:', deleteFromStorage);

    // If deleteFromStorage is false, skip all media library deletion
    if (deleteFromStorage === false) {
      console.log('[Storage] Skipping batch media library deletion as requested');
      return;
    }

    const uniqueNames = Array.from(new Set(filenames.filter(Boolean)));
    if (uniqueNames.length === 0 && prefixes.length === 0) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[Storage] Media library permission not granted for batch delete');
      return;
    }

    const map = await getAssetIdMap();
    const allIdsToDelete = new Set();
    const keysToDeleteFromMap = new Set();

    // 1. Get IDs from map using filenames
    const remainingNames = [];
    for (const name of uniqueNames) {
      const entry = map[name];
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (id) {
        allIdsToDelete.add(id);
        keysToDeleteFromMap.add(name);
      } else {
        remainingNames.push(name);
      }
    }

    // 2. Get IDs from map using prefixes
    if (prefixes.length > 0) {
      const normPrefixes = prefixes.map(p => normalizeName(p));
      const keyMatches = (key) => {
        const nk = normalizeName(key);
        return normPrefixes.some(np => nk.startsWith(np));
      };
      for (const key in map) {
        if (!keyMatches(key)) continue;
        const entry = map[key];
        const id = typeof entry === 'string' ? entry : entry?.id;
        if (id) {
          allIdsToDelete.add(id);
          keysToDeleteFromMap.add(key);
        }
      }
    }
    
    // 3. Fallback: scan media library for remaining filenames
    if (remainingNames.length > 0) {
        const tryFindMatches = async (scope) => {
            const res = await MediaLibrary.getAssetsAsync(scope);
            const byNorm = new Map();
            for (const a of res.assets) {
                const norm = normalizeName(a.filename);
                if (norm) byNorm.set(norm, { id: a.id, filename: a.filename });
            }
            for (const name of remainingNames) {
                const found = byNorm.get(normalizeName(name));
                if (found) {
                    allIdsToDelete.add(found.id);
                    // Also try to add the actual filename to the map keys to be deleted
                    keysToDeleteFromMap.add(found.filename);
                    keysToDeleteFromMap.add(name); // And the name we searched for
                }
            }
        };

        const album = await MediaLibrary.getAlbumAsync('ProofPix');
        if (album) {
            await tryFindMatches({ album, first: 2000, mediaType: [MediaLibrary.MediaType.photo] });
        }
        await tryFindMatches({ first: 2000, mediaType: [MediaLibrary.MediaType.photo] });
    }

    const ids = Array.from(allIdsToDelete);
    if (ids.length > 0) {
      try {
        console.log(`[Storage] Deleting ${ids.length} assets from media library...`);
        await MediaLibrary.deleteAssetsAsync(ids);
        console.log('[Storage] ✅ Assets deleted from media library');
        // Clean mapping
        const newMap = { ...map };
        for (const key of keysToDeleteFromMap) {
          delete newMap[key];
        }
        await setAssetIdMap(newMap);
        console.log('[Storage] ✅ Asset map updated');

      } catch (err) {
        console.error('[Storage] ❌ Failed to delete assets batch:', err);
      }
    } else {
      console.warn('[Storage] ⚠️ No assets found to delete in batch');
    }
  } catch (e) {
    console.error('[Storage] deleteAssetsBatch error:', e);
  }
};

// ===== Projects store =====

/**
 * Load tracked projects. Backed by secure storage (Keychain on iOS) so the
 * project list survives reinstall on iOS. Shape: [{ id, name, createdAt }]
 */
export const loadProjects = async () => {
  try {
    const saved = await readSecureJSON(PROJECTS_KEY);
    // Distinguish "never written" (null) from "intentionally cleared" ([]).
    // Only restore from backup in the never-written case — otherwise a user
    // deleting their last project sees it resurrected from the backup on
    // the very next read.
    if (saved == null) {
      const backup = await readSecureJSON(PROJECTS_BACKUP_KEY);
      if (Array.isArray(backup) && backup.length > 0) {
        console.warn('[Storage] loadProjects: primary unset, restoring from backup', { backup_count: backup.length });
        try { await writeSecureJSON(PROJECTS_KEY, backup); } catch {}
        return backup;
      }
      return [];
    }
    return Array.isArray(saved) ? saved : [];
  } catch (e) {
    return [];
  }
};

/**
 * Save tracked projects. Writes to both Keychain and AsyncStorage.
 */
export const saveProjects = async (projects) => {
  try {
    const list = projects || [];
    if (list.length === 0) {
      const stack = new Error('empty saveProjects trace').stack || '(no stack)';
      console.warn('[Storage] saveProjects EMPTY WRITE — potential wipe', {
        stack: stack.split('\n').slice(0, 6).join(' | '),
      });
    } else {
      console.warn('[Storage] saveProjects', { count: list.length, ids: list.map(p => p?.id).slice(0, 10) });
    }
    await writeSecureJSON(PROJECTS_KEY, list);
    // Only snapshot backup on non-empty writes. deleteProjectEntry's
    // legitimate "remove one" flow still updates backup because the
    // list is still non-empty. Full "clear all projects" would need
    // an explicit clearProjects() helper (not yet implemented).
    if (list.length > 0) {
      try { await writeSecureJSON(PROJECTS_BACKUP_KEY, list); } catch {}
    }
  } catch (e) {
    throw e;
  }
};

/**
 * Create a new project entry and return it
 */
export const createProject = async (name) => {
  const list = await loadProjects();
  const id = Date.now().toString();
  // Generate a unique upload identifier for this project (HHMMSS format)
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const uploadId = `${hours}${minutes}${seconds}`;
  const project = { id, name, createdAt: Date.now(), uploadId };
  await saveProjects([project, ...list]);
  return project;
};

/**
 * Delete a project entry (does not delete photos here)
 */
export const deleteProjectEntry = async (projectId) => {
  const list = await loadProjects();
  const filtered = list.filter(p => p.id !== projectId);
  await saveProjects(filtered);
  // saveProjects skips backup writes when the list is empty (guard against
  // accidental wipes). Deleting the last project is a legitimate empty
  // write, so sync the backup here — otherwise loadProjects sees primary
  // empty on next read and restores the just-deleted project from backup.
  if (filtered.length === 0) {
    try { await writeSecureJSON(PROJECTS_BACKUP_KEY, []); } catch {}
  }
};

// Active project persistence (Keychain-mirrored so it survives iOS reinstall)
export const loadActiveProjectId = async () => {
  try {
    return await readSecure(ACTIVE_PROJECT_ID_KEY);
  } catch (e) {
    return null;
  }
};

export const saveActiveProjectId = async (projectId) => {
  try {
    if (projectId == null) {
      await deleteSecure(ACTIVE_PROJECT_ID_KEY);
    } else {
      await writeSecure(ACTIVE_PROJECT_ID_KEY, projectId);
    }
  } catch (e) {
    // noop
  }
};

/**
 * Gets stored user data (cleaner name, location). Keychain-mirrored.
 */
export const getStoredUserData = async () => {
  try {
    const stored = await readSecureJSON(USER_PREFS_KEY);
    return stored || {};
  } catch (error) {
    return {};
  }
};

/**
 * Saves user data
 */
export const saveUserData = async (cleaner, location) => {
  try {
    const userData = {
      cleaner,
      location,
      savedAt: Date.now()
    };
    await writeSecureJSON(USER_PREFS_KEY, userData);
  } catch (error) {
  }
};

/**
 * Loads app settings. Keychain-mirrored so labels/watermarks/language survive
 * iOS reinstall.
 */
export const loadSettings = async () => {
  try {
    const saved = await readSecureJSON(SETTINGS_KEY);
    return saved || {};
  } catch (error) {
    return {};
  }
};

/**
 * Saves app settings (shallow-merged with existing)
 */
export const saveSettings = async (settings) => {
  try {
    const existing = await loadSettings();
    const updated = { ...existing, ...settings };
    await writeSecureJSON(SETTINGS_KEY, updated);
  } catch (error) {
  }
};

// ===== Upload album name uniqueness =====
export const getUniqueUploadAlbumName = async (baseName) => {
  try {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;

    const stored = await AsyncStorage.getItem(UPLOAD_COUNTERS_KEY);
    const counters = stored ? JSON.parse(stored) : {};
    const byDate = counters[dateKey] || {};
    const current = byDate[baseName] || 0;

    let albumName = baseName;
    const next = current + 1;
    if (current > 0) {
      albumName = `${next} ${baseName}`; // left-prefixed number
    }

    byDate[baseName] = next;
    counters[dateKey] = byDate;
    await AsyncStorage.setItem(UPLOAD_COUNTERS_KEY, JSON.stringify(counters));

    return albumName;
  } catch (e) {
    return baseName;
  }
};


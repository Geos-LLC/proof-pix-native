import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPhotosMetadata, savePhotosMetadata, deletePhotoFromDevice, loadProjects, saveProjects, createProject as storageCreateProject, deleteProjectEntry, loadActiveProjectId, saveActiveProjectId, deleteAssetsByFilenames, deleteAssetsByPrefixes, deleteProjectAssets, getAssetIdMap, deleteAssetsBatch, repairCorruptedPhotoUris } from '../services/storage';
import { readSecureJSON, writeSecureJSON } from '../services/secureStorageService';
import { INDUSTRIES } from '../constants/industries';
import crmService from '../services/crm';

// One-shot marker for the project-recovery pass. Lives in AsyncStorage
// (NOT Keychain) so it resets on reinstall — if a future reinstall
// leaves Keychain projects empty again, recovery re-fires.
const PROJECT_RECOVERY_MARKER_KEY = '@project_recovery_done_v1';
const ROOMS_RECOVERY_MARKER_KEY = '@rooms_recovery_done_v1';
const CUSTOM_ROOMS_KEY = 'custom-rooms';

// Turn a room id slug (e.g. "master-bathroom") into a readable name
// ("Master bathroom"). Used by the rooms-recovery pass when we don't
// have any other name source — the user can rename via Industry &
// Folders settings afterwards.
const humanizeRoomId = (id) => {
  const cleaned = String(id || '').replace(/[-_]+/g, ' ').trim();
  if (!cleaned) return 'Recovered room';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};
import { deleteImagesFromGalleryNative, deleteImagesByProjectIdNative } from '../utils/mediaStoreSaver';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { PHOTO_MODES, ROOMS } from '../constants/rooms';

const PhotoContext = createContext();

export const usePhotos = () => {
  const context = useContext(PhotoContext);
  if (!context) {
    throw new Error('usePhotos must be used within PhotoProvider');
  }
  return context;
};

export const PhotoProvider = ({ children }) => {
  const [photos, setPhotos] = useState([]);
  const photosRef = useRef(photos);
  // Set to true once loadPhotos has finished hydrating from AsyncStorage.
  // Until then, mutating helpers (updatePhoto / deletePhoto) must NOT call
  // savePhotos because photosRef.current is still the empty initial array
  // — saving would persist [] over the user's real data on AsyncStorage.
  const photosLoadedRef = useRef(false);
  // Keep ref in sync so addPhoto always reads the latest photos
  useEffect(() => { photosRef.current = photos; }, [photos]);
  const [currentRoom, setCurrentRoom] = useState('kitchen');
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  // Synchronous mirror of the latest projects array. Mutators
  // (createProject/patchProject/renameProject) update this BEFORE
  // calling setProjects so a follow-up mutator within the same
  // microtask (e.g. ServiceFlowSync's create-then-patch loop) reads
  // the latest list instead of a stale closure that wipes everything
  // back to [].
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  const [activeProjectId, setActiveProjectId] = useState(null);

  // Load photos on mount
  // Load data on app start.
  //
  // Order matters here: HomeScreen has an auto-default useEffect that
  // fires when `projects` is non-empty and `activeProjectId` is null,
  // and overwrites the persisted active id with `projects[0]` (which
  // is the most recently CREATED project since createProject prepends
  // to the list). If we setProjects before the saved active id is
  // applied, that auto-default fires once with a stale null and the
  // user's real "last open" project gets clobbered on every relaunch.
  //
  // So: load + validate the active id first, set it, THEN set the
  // projects list. By the time HomeScreen sees a populated list,
  // activeProjectId is already correct and the auto-default no-ops.
  useEffect(() => {
    (async () => {
      await loadPhotos();
      let projectsList = await loadProjects();
      console.warn('[PhotoContext] cold-start loadProjects', { count: projectsList?.length || 0, ids: (projectsList || []).map(p => p?.id).slice(0, 10) });

      // Recovery — rooms. Photo `room` IDs reference custom-rooms
      // entries; if custom-rooms got wiped alongside tracked-projects,
      // the photos' room IDs no longer match anything in the room list,
      // and screens that filter by current-room (Capture, Sections)
      // render empty. Timeline still works because it groups
      // `photo.room || 'Unsorted'` so orphan rooms just become an
      // 'Unsorted' bucket.
      // Walk photos, collect every room ID not present in default
      // ROOMS / current customRooms / any INDUSTRIES folder ID, and
      // synthesize entries appended to customRooms. One-shot, gated.
      try {
        const roomsRecoveryDone = await AsyncStorage.getItem(ROOMS_RECOVERY_MARKER_KEY);
        if (!roomsRecoveryDone) {
          const photoMeta = await loadPhotosMetadata();
          const photoRoomIds = new Set();
          for (const p of photoMeta || []) {
            if (p?.room) photoRoomIds.add(String(p.room));
          }
          if (photoRoomIds.size > 0) {
            const currentCustom = (await readSecureJSON(CUSTOM_ROOMS_KEY)) || [];
            const knownIds = new Set();
            for (const r of ROOMS) if (r?.id) knownIds.add(String(r.id));
            for (const r of currentCustom) if (r?.id) knownIds.add(String(r.id));
            for (const ind of (INDUSTRIES || [])) {
              for (const f of (ind?.folders || [])) {
                if (f?.id) knownIds.add(String(f.id));
              }
            }
            const missing = Array.from(photoRoomIds).filter(id => !knownIds.has(id));
            if (missing.length > 0) {
              const synthesizedRooms = missing.map(id => ({
                id,
                name: humanizeRoomId(id),
                recoveredAt: Date.now(),
              }));
              const combined = [...currentCustom, ...synthesizedRooms];
              console.warn('[PhotoContext] room recovery: synthesized', { count: synthesizedRooms.length, photo_count: (photoMeta || []).length, ids: missing.slice(0, 20) });
              await writeSecureJSON(CUSTOM_ROOMS_KEY, combined);
            } else {
              console.warn('[PhotoContext] room recovery: skipped — all photo room IDs already known', { photo_room_count: photoRoomIds.size });
            }
          }
          await AsyncStorage.setItem(ROOMS_RECOVERY_MARKER_KEY, String(Date.now()));
        }
      } catch (e) {
        console.warn('[PhotoContext] room recovery failed:', e?.message);
      }

      // Recovery — projects. If Keychain tracked-projects came back
      // empty but photos.metadata carries projectId references, the
      // projects list was wiped while the photo metadata + asset map
      // survived (e.g. mid-session crash, OTA race, manual user data
      // clear). Synthesize one project entry per unique referenced id
      // so the Projects screen re-populates and photos automatically
      // re-link. One-shot, gated by an AsyncStorage marker so it
      // doesn't repeat — if the user deletes all projects intentionally
      // later, we honour the empty state.
      if ((projectsList?.length || 0) === 0) {
        try {
          const recoveryDone = await AsyncStorage.getItem(PROJECT_RECOVERY_MARKER_KEY);
          if (!recoveryDone) {
            const photoMeta = await loadPhotosMetadata();
            const byProjectId = new Map();
            for (const photo of photoMeta || []) {
              if (!photo?.projectId) continue;
              const list = byProjectId.get(photo.projectId) || [];
              list.push(photo);
              byProjectId.set(photo.projectId, list);
            }
            if (byProjectId.size > 0) {
              const orderedIds = Array.from(byProjectId.keys()).sort((a, b) => {
                const aOldest = Math.min(...byProjectId.get(a).map(p => Number(p.timestamp) || Number.POSITIVE_INFINITY));
                const bOldest = Math.min(...byProjectId.get(b).map(p => Number(p.timestamp) || Number.POSITIVE_INFINITY));
                return aOldest - bOldest;
              });
              const synthesized = orderedIds.map((pid, idx) => {
                const oldestTs = Math.min(...byProjectId.get(pid).map(p => Number(p.timestamp) || Date.now()));
                return {
                  id: pid,
                  name: `Recovered project ${idx + 1}`,
                  createdAt: new Date(oldestTs).toISOString(),
                  recoveredAt: Date.now(),
                };
              });
              console.warn('[PhotoContext] project recovery: synthesized', { count: synthesized.length, photo_count: (photoMeta || []).length, ids: synthesized.map(p => p.id) });
              await saveProjects(synthesized);
              projectsList = synthesized;
            } else {
              console.warn('[PhotoContext] project recovery: skipped — no photos carry projectId', { photo_count: (photoMeta || []).length });
            }
            await AsyncStorage.setItem(PROJECT_RECOVERY_MARKER_KEY, String(Date.now()));
          } else {
            console.warn('[PhotoContext] project recovery: marker present, skipping');
          }
        } catch (e) {
          console.warn('[PhotoContext] project recovery failed:', e?.message);
        }
      }

      const savedActive = await loadActiveProjectId();
      if (savedActive) {
        const projectExists = projectsList.some(p => p.id === savedActive);
        if (projectExists) {
          setActiveProjectId(savedActive);
        } else {
          setActiveProjectId(null);
          await saveActiveProjectId(null);
        }
      }
      projectsRef.current = projectsList;
      setProjects(projectsList);
    })();
  }, []);

  // Reload data when app becomes active (returns from background)
  useEffect(() => {
    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        (async () => {
          await loadPhotos();
          await loadProjectsList();
        })();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  // Reassign photo names sequentially per project and room
  const reassignPhotoNames = (photoList, getRoomDisplayName = (roomId) => {
    const room = ROOMS.find(r => r.id === roomId);
    return room ? room.name : (roomId || 'Room');
  }) => {
    const groups = {};

    // Group ONLY before photos by projectId + room and sort by timestamp
    photoList.forEach(photo => {
      if (photo.mode === PHOTO_MODES.BEFORE) {
        const key = `${photo.projectId || 'none'}::${photo.room}`;
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(photo);
      }
    });

    // Sort each group's before photos by timestamp
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => a.timestamp - b.timestamp);
    });

    // Create a map of before photo ID to new name
    const nameMap = {};
    Object.keys(groups).forEach(key => {
      groups[key].forEach((photo, index) => {
        const roomDisplayName = getRoomDisplayName(photo.room);
        const sequentialName = `${roomDisplayName} ${index + 1}`;
        nameMap[photo.id] = sequentialName;
      });
    });

    // Build a reverse map from old name to before photo ID (for combined)
    const nameToBeforeId = {};
    Object.values(groups).forEach(arr => {
      arr.forEach((photo) => {
        nameToBeforeId[photo.name] = photo.id;
      });
    });

    // 
    // 

    // Reassign names: before photos get sequential names, after/combined photos use their before photo's name
    const updatedPhotos = photoList.map(photo => {
      if (photo.mode === PHOTO_MODES.BEFORE) {
        return {
          ...photo,
          name: nameMap[photo.id]
        };
      } else if (photo.mode === PHOTO_MODES.AFTER && photo.beforePhotoId) {
        // After photo uses the name of its paired before photo
        const newName = nameMap[photo.beforePhotoId] || photo.name;
        // 
        return {
          ...photo,
          name: newName
        };
      } else if (photo.mode === PHOTO_MODES.COMBINED) {
        // Combined photo should match the before photo's new name
        // Find the before photo ID by the combined photo's current name
        const beforeId = nameToBeforeId[photo.name];
        const newName = nameMap[beforeId] || photo.name;
        // 
        return {
          ...photo,
          name: newName
        };
      }
      return photo;
    });

    return updatedPhotos;
  };

  const loadPhotos = async () => {
    try {
      setLoading(true);
      const metadata = await loadPhotosMetadata();

      // Filter out any photos with ph:// URIs (old data)
      const validPhotos = metadata.filter(photo => {
        if (photo.uri && photo.uri.startsWith('ph://')) {
          return false;
        }
        return true;
      });

      // If we filtered out any photos, save the cleaned data
      if (validPhotos.length !== metadata.length) {
        await savePhotosMetadata(validPhotos);
      }

      // Migrate URIs after app update (iOS changes container UUID on reinstall)
      // Extract filename from stored URI and rebuild with current documentDirectory.
      //
      // IMPORTANT: only migrate URIs that came from a prior install's
      // Documents directory — i.e. the path contains "/Documents/". Do NOT
      // migrate arbitrary file:// paths. PhotoKit's `localUri` returns
      // things like `file:///private/var/mobile/Media/DCIM/IMG_0042.HEIC`
      // which would otherwise get rewritten to `${docDir}IMG_0042.HEIC`,
      // a path that does not exist on disk. (That's the bug behind
      // "photos showed on launch 1, gone on launch 2 after reinstall".)
      const docDir = FileSystem.documentDirectory;
      let urisMigrated = false;
      const migratedPhotos = validPhotos.map(photo => {
        if (
          photo.uri &&
          photo.uri.startsWith('file://') &&
          docDir &&
          !photo.uri.startsWith(docDir) &&
          photo.uri.includes('/Documents/')
        ) {
          const filename = photo.uri.split('/').pop();
          if (filename) {
            urisMigrated = true;
            return { ...photo, uri: `${docDir}${filename}` };
          }
        }
        return photo;
      });
      if (urisMigrated) {
        console.log('[PhotoContext] Migrated photo URIs to current document directory');
        await savePhotosMetadata(migratedPhotos);
      }

      // After reinstall on iOS the Documents directory is wiped, so the
      // rewritten file:// URIs above point to files that no longer
      // exist — the rendered Images show as black squares. The actual
      // photos still live in the iOS Photos library (the ProofPix
      // album) because their PhotoKit asset IDs were mirrored to
      // Keychain. Walk the photo list, re-resolve any missing file via
      // its asset ID, and rewrite the URI to the PhotoKit-provided
      // localUri so Image can load it again.
      const baseForResolve = urisMigrated ? migratedPhotos : validPhotos;

      // ─── FAST PATH: render synchronously ───────────────────────
      // Apply any stored `cachedLocalUri` directly into `uri` and
      // hand the result to React WITHOUT awaiting PhotoKit. In
      // steady state (cache populated, files present) the user
      // sees photos within a few ms of cold start — no waiting on
      // N PhotoKit roundtrips. Verification + actual re-resolve
      // run in the background below and patch any stale entries
      // afterwards (silent unless the cache hit miss-rate is high).
      const fastPathPhotos = baseForResolve.map(p =>
        (p?.cachedLocalUri && p.cachedLocalUri !== p.uri) ? { ...p, uri: p.cachedLocalUri } : p
      );
      const fastRenamed = reassignPhotoNames(fastPathPhotos);
      photosRef.current = fastRenamed;
      setPhotos(fastRenamed);
      photosLoadedRef.current = true;

      // ─── BACKGROUND: heal Before/After/Progress URIs overwritten by
      // the pre-fix Studio Source Photos picker. Quick guard first —
      // only enter the heal path if any photo's uri filename matches
      // the contaminated COMBINED_BASE / COMBINED_EDIT pattern. For
      // clean libraries this is one O(n) string scan and we're done.
      // Idempotent — re-runs no-op once data is clean.
      const isContaminated = fastRenamed.some(p => {
        if (!p || p.mode === 'mix') return false;
        const u = String(p.uri || '');
        return /_COMBINED_(BASE|EDIT)_(SIDE|STACK)_\d+/i.test(u);
      });
      if (isContaminated) {
        (async () => {
          try {
            const result = await repairCorruptedPhotoUris();
            console.warn('[PhotoContext] auto-repair photo URIs:', result);
            if (result?.repaired > 0) {
              // Re-load metadata + push the healed photos into React
              // state by id, same merge pattern as the PhotoKit
              // recovery block below so concurrent edits aren't lost.
              const fresh = await loadPhotosMetadata();
              const freshById = new Map(fresh.map(p => [p.id, p]));
              setPhotos(prev => {
                let changed = false;
                const merged = prev.map(p => {
                  const r = freshById.get(p.id);
                  if (!r) return p;
                  if (r.uri === p.uri) return p;
                  changed = true;
                  return { ...p, uri: r.uri, cachedLocalUri: null };
                });
                if (changed) {
                  photosRef.current = merged;
                  return merged;
                }
                return prev;
              });
            }
          } catch (err) {
            console.warn('[PhotoContext] auto-repair failed:', err?.message);
          }
        })();
      }

      // ─── BACKGROUND: PhotoKit recovery + re-resolve ─────────────
      // Fire-and-forget. When done, patch state by photo.id so we
      // don't blow away anything the user added in the interim.
      if (Platform.OS === 'ios') {
        (async () => {
          try {
            const assetMap = await getAssetIdMap();
            if (!assetMap || Object.keys(assetMap).length === 0) return;
            let perm = await MediaLibrary.getPermissionsAsync();
            if (perm.status !== 'granted' && perm.status !== 'limited') {
              perm = await MediaLibrary.requestPermissionsAsync();
            }
            if (perm.status !== 'granted' && perm.status !== 'limited') return;

            // Bounded-concurrency runner so we don't stampede PhotoKit.
            const runConcurrent = async (items, concurrency, worker) => {
              const results = new Array(items.length);
              let cursor = 0;
              const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
                while (true) {
                  const i = cursor++;
                  if (i >= items.length) return;
                  results[i] = await worker(items[i], i);
                }
              });
              await Promise.all(runners);
              return results;
            };

            // Recovery for storage corrupted by an older version that
            // wrote PhotoKit `localUri` (with filenames like
            // IMG_0042.HEIC) over our canonical Documents URIs. Walk
            // assetMap once, build PhotoKit-filename → app-filename
            // map, rewrite each corrupted photo back to canonical.
            const reverseMap = {};
            const needsRecovery = baseForResolve.some(p => {
              if (!p.uri || !p.uri.startsWith('file://')) return false;
              const fn = p.uri.split('/').pop();
              return fn && !assetMap[fn];
            });
            if (needsRecovery) {
              await runConcurrent(Object.entries(assetMap), 50, async ([appFilename, entry]) => {
                const assetId = typeof entry === 'string' ? entry : entry?.id;
                if (!assetId) return;
                try {
                  const a = await MediaLibrary.getAssetInfoAsync(assetId);
                  const pk = a?.localUri;
                  if (pk) {
                    const pkFn = pk.split('/').pop();
                    if (pkFn && pkFn !== appFilename) reverseMap[pkFn] = appFilename;
                  }
                } catch {}
              });
            }
            let recoveredAny = false;
            const recoveredBase = baseForResolve.map(photo => {
              if (!photo.uri || !photo.uri.startsWith('file://')) return photo;
              const filename = photo.uri.split('/').pop();
              if (!filename || assetMap[filename]) return photo;
              const appFilename = reverseMap[filename];
              if (!appFilename) return photo;
              recoveredAny = true;
              return { ...photo, uri: `${docDir}${appFilename}` };
            });
            if (recoveredAny) {
              await savePhotosMetadata(recoveredBase);
            }

            // Per-photo resolve. We try the cached URI first (no
            // PhotoKit call), fall back to the canonical URI, then
            // only as a last resort hit PhotoKit. Parallelized.
            let urisResolvedFromAssets = false;
            const resolvedBase = await runConcurrent(recoveredBase, 50, async (photo) => {
              if (!photo.uri || !photo.uri.startsWith('file://')) return photo;
              const filename = photo.uri.split('/').pop();
              if (!filename) return photo;
              if (photo.cachedLocalUri && photo.cachedLocalUri !== photo.uri) {
                try {
                  const ci = await FileSystem.getInfoAsync(photo.cachedLocalUri);
                  if (ci && ci.exists) {
                    return (photo.uri === photo.cachedLocalUri) ? photo : { ...photo, uri: photo.cachedLocalUri };
                  }
                } catch {}
              }
              try {
                const info = await FileSystem.getInfoAsync(photo.uri);
                if (info && info.exists) return photo;
              } catch {}
              const entry = assetMap[filename];
              const assetId = typeof entry === 'string' ? entry : entry?.id;
              if (!assetId) return photo;
              try {
                const asset = await MediaLibrary.getAssetInfoAsync(assetId);
                const newUri = asset?.localUri || asset?.uri;
                if (newUri && newUri !== photo.uri) {
                  urisResolvedFromAssets = true;
                  return { ...photo, uri: newUri, cachedLocalUri: newUri };
                }
              } catch {}
              return photo;
            });

            // Merge corrections into current React state by id so
            // we don't clobber anything the user has done since the
            // fast path mounted. Only touch URI + cache fields.
            const idMap = new Map(resolvedBase.map(p => [p.id, p]));
            let anyChanged = recoveredAny || urisResolvedFromAssets;
            setPhotos(prev => {
              let changed = false;
              const merged = prev.map(p => {
                const c = idMap.get(p.id);
                if (!c) return p;
                if (c.uri === p.uri && (c.cachedLocalUri || null) === (p.cachedLocalUri || null)) return p;
                changed = true;
                return { ...p, uri: c.uri, cachedLocalUri: c.cachedLocalUri || p.cachedLocalUri };
              });
              if (changed) {
                photosRef.current = merged;
                return merged;
              }
              return prev;
            });

            // Persist cachedLocalUri (and any recovered canonical URIs)
            // back to storage. Use the canonical URI from baseForResolve
            // so we never write a transient PhotoKit path to `uri`.
            if (anyChanged) {
              const persistable = resolvedBase.map(p => ({
                ...p,
                uri: baseForResolve.find(b => b.id === p.id)?.uri || p.uri,
              }));
              await savePhotosMetadata(persistable);
            }
          } catch (e) {
            console.warn('[PhotoContext] background resolve failed:', e?.message);
          }
        })();
      }
    } catch (error) {
      console.warn('[PhotoContext] loadPhotos failed — keeping in-memory photos to avoid wiping AsyncStorage:', error?.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectsList = async () => {
    try {
      const list = await loadProjects();
      projectsRef.current = list;
      setProjects(list);
    } catch (e) {
    }
  };

  // Polls photosLoadedRef every 50ms up to `timeoutMs`. Resolves true when
  // the ref flips, false on timeout. Used by mutating helpers (addPhoto,
  // assignPhotosToProject, etc.) so they don't run on the empty initial
  // array if a user action fires during the cold-start window.
  const waitForPhotosLoaded = async (timeoutMs = 2000) => {
    if (photosLoadedRef.current) return true;
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (photosLoadedRef.current) return resolve(true);
        if (Date.now() - start >= timeoutMs) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  };

  const savePhotos = async (newPhotos) => {
    try {
      // Reassign names sequentially before saving
      const renamedPhotos = reassignPhotoNames(newPhotos);
      // Sanity guard: refuse to persist a wipe (saving []) when we know the
      // app has previously loaded photos. This catches any remaining stale-
      // closure caller that would otherwise nuke AsyncStorage. Surface to
      // the caller so the underlying bug is visible in logs.
      if (renamedPhotos.length === 0 && photosLoadedRef.current && photosRef.current.length > 0) {
        console.warn(
          '[PhotoContext] savePhotos blocked — refusing to write [] over',
          photosRef.current.length, 'existing photos. Caller likely passed stale state.'
        );
        return;
      }
      photosRef.current = renamedPhotos; // Sync ref immediately so addPhoto always reads latest
      setPhotos(renamedPhotos);
      await savePhotosMetadata(renamedPhotos);
    } catch (error) {
    }
  };

  const addPhoto = async (photo) => {
    try {
      // If load hasn't finished, the ref is still the empty initial array.
      // Saving here would persist [newPhoto] alone over the user's library.
      // Defer until load completes (poll briefly, then save). If load never
      // completes, the call is dropped — better than wiping.
      if (!photosLoadedRef.current) {
        const waited = await waitForPhotosLoaded(2000);
        if (!waited) {
          console.warn('[PhotoContext] addPhoto skipped — loadPhotos did not complete in time');
          return;
        }
      }
      const currentPhotos = photosRef.current;
      const stamped = { ...photo, projectId: photo.projectId ?? activeProjectId ?? null };
      const newPhotos = [...currentPhotos, stamped];
      await savePhotos(newPhotos);

      // CRM auto-attach. When a photo is captured in a project that's
      // linked to a CRM job (e.g. SF), forward it straight to the CRM
      // without waiting on any cloud-destination upload. SF connection
      // IS the upload destination for these projects — gating attach on
      // Drive/Dropbox/iCloud would mean users without those configured
      // never see their photos on the CRM side.
      //
      // Fire-and-forget. SF backend dedups on proofpix_photo_id within
      // 24h, so if backgroundUploadService later also fires attach
      // (when a cloud destination IS configured), the second call is a
      // no-op {alreadyExisted: true}.
      try {
        if (stamped.projectId) {
          const project = (projectsRef.current || []).find(p => p?.id === stamped.projectId);
          if (project?.crmJobId && project?.crmProvider) {
            console.warn('[CRM] auto-attach on capture', { provider: project.crmProvider, jobId: project.crmJobId, photoId: stamped.id });
            crmService
              .attachPhoto(String(project.crmJobId), {
                id: stamped.id,
                localUri: stamped.uri,
                filename: stamped.name || `${stamped.id}.jpg`,
                mimeType: 'image/jpeg',
                mode: stamped.mode,
                room: stamped.room,
                timestamp: stamped.timestamp,
                gps: stamped.gps,
                capturedBy: stamped.capturedBy,
                notes: stamped.notes,
                projectId: stamped.projectId,
              })
              .then((result) => {
                console.warn('[CRM] auto-attach result', { photoId: stamped.id, ok: !!result?.success, code: result?.error || null, dedup: !!result?.alreadyExisted });
              })
              .catch((e) => {
                console.warn('[CRM] auto-attach threw', { photoId: stamped.id, msg: e?.message });
              });
          }
        }
      } catch (crmErr) {
        console.warn('[CRM] auto-attach setup failed:', crmErr?.message);
      }
    } catch (error) {
      throw error; // Re-throw so caller knows it failed
    }
  };

  // IMPORTANT: read from photosRef.current, not the closure `photos`. When
  // callers await several of these in sequence (e.g. CameraScreen demoting an
  // after to progress and then deleting the combined), React state hasn't
  // re-rendered yet, so closure `photos` would be the pre-update value and
  // the second call would silently overwrite the first. photosRef is sync.
  //
  // Guard: if photosLoadedRef is false, the ref still holds the empty initial
  // array. Running savePhotos here would persist [] over the user's real
  // AsyncStorage data. Skip — the caller's edit is dropped, which is the
  // lesser evil vs. wiping the library.
  const updatePhoto = async (photoId, updates) => {
    if (!photosLoadedRef.current) {
      console.warn('[PhotoContext] updatePhoto called before loadPhotos completed — skipping to avoid wiping storage', photoId);
      return;
    }
    const current = photosRef.current;
    // No-op if the photo isn't in the current array — saves the unchanged
    // array regardless, but at least we don't strip it.
    const newPhotos = current.map(p =>
      p.id === photoId ? { ...p, ...updates } : p
    );
    await savePhotos(newPhotos);
  };

  // Set or remove a single override field on a photo. The overrides
  // object is sparse — only fields the user has explicitly customized
  // for *this* photo land here. Reads cascade `photo.overrides[key] ??
  // global[key]`, so unset fields keep following global Settings.
  //
  // Passing null/undefined as the value removes that key from the
  // overrides object. When the object becomes empty, we collapse it
  // to null so the photo cleanly follows global again.
  const setPhotoOverride = async (photoId, key, value) => {
    if (!photoId || !key) return;
    const target = photosRef.current.find(p => p.id === photoId);
    if (!target) return;
    const next = { ...(target.overrides || {}) };
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    const nextOverrides = Object.keys(next).length ? next : null;
    console.warn('[OVR] setPhotoOverride photoId=', photoId, 'key=', key, 'valueType=', typeof value, 'resultKeys=', nextOverrides ? Object.keys(nextOverrides).join(',') : 'null');
    await updatePhoto(photoId, { overrides: nextOverrides });
  };

  // Drop the entire overrides object for a photo. The photo goes
  // back to following global Settings live.
  const clearPhotoOverrides = async (photoId) => {
    if (!photoId) return;
    await updatePhoto(photoId, { overrides: null });
  };

  const deletePhoto = async (photoId, options = {}) => {
    if (!photosLoadedRef.current) {
      console.warn('[PhotoContext] deletePhoto called before loadPhotos completed — skipping to avoid wiping storage', photoId);
      return;
    }
    try {
      console.log('[PhotoContext] deletePhoto called with options:', options);
      const target = photosRef.current.find(p => p.id === photoId);
      if (target) {
        const shouldDeleteFromStorage = options.deleteFromStorage !== false;
        console.log('[PhotoContext] Photo found, deleteFromStorage:', shouldDeleteFromStorage);
        if (shouldDeleteFromStorage) {
          await deletePhotoFromDevice(target, options);
        } else {
          console.log('[PhotoContext] Skipping device deletion for photo:', photoId);
        }
      }
    } finally {
      const newPhotos = photosRef.current.filter(p => p.id !== photoId);
      await savePhotos(newPhotos);
    }
  };

  const deletePhotoSet = async (beforePhotoId, options = {}) => {
    try {
        const beforePhoto = photos.find(p => p.id === beforePhotoId && p.mode === PHOTO_MODES.BEFORE);
        if (!beforePhoto) {
            return;
        }

        const photosToDelete = [beforePhoto];

        const afterPhoto = photos.find(p => p.beforePhotoId === beforePhotoId);
        if (afterPhoto) {
            photosToDelete.push(afterPhoto);
        }

        const combinedPhotos = photos.filter(p => p.name === beforePhoto.name && p.room === beforePhoto.room && p.mode === PHOTO_MODES.COMBINED);
        photosToDelete.push(...combinedPhotos);

        // --- Deletion Logic ---

        const shouldDeleteFromStorage = options.deleteFromStorage !== false;
        console.log('[PhotoContext] deletePhotoSet with deleteFromStorage:', shouldDeleteFromStorage);

        // 1. Always delete local file URIs (app's document directory)
        const localFileUris = photosToDelete
            .map(p => p.uri)
            .filter(uri => uri && uri.startsWith(FileSystem.documentDirectory));

        for (const uri of localFileUris) {
            try {
                const fileInfo = await FileSystem.getInfoAsync(uri);
                if (fileInfo.exists) {
                    await FileSystem.deleteAsync(uri);
                    console.log('[PhotoContext] ✅ Deleted local file:', uri);
                }
            } catch (e) {
                console.warn('[PhotoContext] ⚠️ Failed to delete local file:', e);
            }
        }

        // 2. Collect filenames for media library and prefixes for derived images
        const mediaLibraryFilenames = photosToDelete
            .map(p => (p.uri || '').split('/').pop())
            .filter(Boolean);

        const safeName = (beforePhoto.name || '').replace(/\s+/g, '_');
        const prefixes = [
            `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`,
            `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`
        ];

        // 3. Perform a single, unified deletion for all media assets (respecting deleteFromStorage option)
        await deleteAssetsBatch({
            filenames: mediaLibraryFilenames,
            prefixes,
            deleteFromStorage: shouldDeleteFromStorage
        });

        // 4. Remove from metadata. Read from photosRef.current (not the
        // closure `photos`) so concurrent saves don't see stale state and
        // overwrite each other.
        const photoIdsToDelete = new Set(photosToDelete.map(p => p.id));
        const newPhotos = photosRef.current.filter(p => !photoIdsToDelete.has(p.id));
        await savePhotos(newPhotos);

    } catch (error) {
    }
  };

  const deleteAllPhotos = async () => {
    await savePhotos([]);
  };

  // ===== Project operations =====
  const createProject = async (name, opts = {}) => {
    try {
      const newProject = {
        id: `proj_${Date.now()}`,
        name: name,
        createdAt: new Date().toISOString(),
        industry: opts.industry || null,
      };
      // Read the latest committed list via ref — protects against
      // a follow-up mutator in the same microtask seeing stale state.
      const baseList = projectsRef.current || [];
      const updatedProjects = [newProject, ...baseList];
      projectsRef.current = updatedProjects;
      console.warn('[PhotoContext] createProject', { new_id: newProject.id, prior_count: baseList.length, after_count: updatedProjects.length });
      setProjects(updatedProjects);

      // Save projects to persistent storage
      await saveProjects(updatedProjects);
      
      // Reset custom rooms to default when new project is created
      // Auto-assign only unassigned photos to the new project — read from
      // photosRef.current so we don't operate on stale state and accidentally
      // drop newer photos that haven't propagated to the React state yet.
      const current = photosRef.current;
      const unassigned = current.filter(p => !p.projectId);
      if (unassigned.length > 0) {
        const updated = current.map(p => (!p.projectId ? { ...p, projectId: newProject.id } : p));
        await savePhotos(updated);
      }
      return newProject;
    } catch (error) {
      throw error;
    }
  };

  const assignPhotosToProject = async (projectId) => {
    if (!photosLoadedRef.current) {
      console.warn('[PhotoContext] assignPhotosToProject skipped — loadPhotos not complete');
      return;
    }
    // Assign only unassigned photos to avoid moving between projects implicitly
    const updated = photosRef.current.map(p => (!p.projectId ? { ...p, projectId } : p));
    await savePhotos(updated);
  };

  const renameProject = async (projectId, newName) => {
    try {
      const trimmed = (newName || '').trim();
      if (!trimmed) return;

      const baseList = projectsRef.current || [];
      const updated = baseList.map(p =>
        p.id === projectId ? { ...p, name: trimmed } : p
      );
      projectsRef.current = updated;
      setProjects(updated);
      await saveProjects(updated);
    } catch (error) {
      throw error;
    }
  };

  // Generic shallow-merge patch for a project record. Used by the
  // Report editor to remember the user's last-picked layout + options
  // per project without bloating PhotoContext with one setter per field.
  const patchProject = async (projectId, patch) => {
    if (!projectId || !patch || typeof patch !== 'object') return;
    // projectsRef, not closure `projects` — the latter is captured per
    // render and stays stale across multiple mutators in the same
    // microtask. Concrete repro: ServiceFlowSync calls createProject +
    // patchProject in a loop without yielding; closure-based patch
    // wipes each create back to [] before the next iteration.
    const baseList = projectsRef.current || [];
    const updated = baseList.map(p =>
      p.id === projectId ? { ...p, ...patch } : p
    );
    projectsRef.current = updated;
    setProjects(updated);
    try {
      await saveProjects(updated);
    } catch (_) { /* persistence best-effort; state still reflects patch */ }
  };

  const getPhotosByProject = (projectId) => {
    return photos.filter(p => p.projectId === projectId);
  };

  const deleteProject = async (projectId, options = {}) => {
    const { deleteFromStorage = true } = options;
    const related = photos.filter(p => p.projectId === projectId);

    // Delete all photos for this project from device and metadata
    if (deleteFromStorage) {
      // 1) Delete local files directly (no media calls here to avoid per-asset prompts)
      const filenamesSet = new Set();
      const filePaths = [];
      for (const p of related) {
        const uriStr = p?.uri;
        if (typeof uriStr === 'string' && uriStr.startsWith('file')) {
          filePaths.push(uriStr);
        }
        const fname = (uriStr || '').split('/').pop();
        if (fname) filenamesSet.add(fname);
      }

      try {
        for (const path of filePaths) {
          try {
            // Remove file:// prefix if present
            const cleanPath = path.replace('file://', '');
            const fileInfo = await FileSystem.getInfoAsync(cleanPath);
            if (fileInfo.exists) {
              await FileSystem.deleteAsync(cleanPath);
              console.log('[PhotoContext] ✅ Deleted local file:', path);
            }
          } catch (e) {
            console.error(`[PhotoContext] ⚠️ Failed to delete file ${path}:`, e);
          }
        }
      } catch (err) {
        console.error(`[PhotoContext] ❌ Error deleting local files:`, err);
      }

      // 2) Delete from MediaStore/gallery using native deleter (on Android) or deleteProjectAssets (fallback)
      if (Platform.OS === 'android') {
        try {
          // First delete tracked photos by filename
          if (filenamesSet.size > 0) {
            console.log(`[PhotoContext] 🗑️ Deleting ${filenamesSet.size} tracked files from gallery`);
            const filenames = Array.from(filenamesSet);
            await deleteImagesFromGalleryNative(filenames);
          }

          // Then delete ALL photos for this project (including combined photos) by project ID
          console.log(`[PhotoContext] 🗑️ Deleting all photos for project ${projectId} (including combined)`);
          await deleteImagesByProjectIdNative(projectId);
          console.log(`[PhotoContext] ✅ Successfully deleted all project photos from gallery`);
        } catch (nativeDelErr) {
          console.error(`[PhotoContext] ❌ Native gallery delete failed:`, nativeDelErr);
          // Fallback to asset map method
          try {
            await deleteProjectAssets(projectId);
          } catch (projErr) {
            console.error(`[PhotoContext] ❌ Error deleting project assets via fallback:`, projErr);
          }
        }
      } else {
        // iOS: try the asset map first (fast path when projectId is
        // present in the map), then fall back to a filename scan of
        // the media library. The scan handles legacy entries written
        // before projectId tracking existed — without it, those photos
        // stay in the gallery and we log "No assets found to delete".
        try {
          await deleteProjectAssets(projectId);
        } catch (projErr) {
          console.error(`[PhotoContext] ❌ Error deleting project assets:`, projErr);
        }
        if (filenamesSet.size > 0) {
          try {
            const filenames = Array.from(filenamesSet);
            console.log(`[PhotoContext] 🗑️ iOS filename-scan fallback for ${filenames.length} files`);
            await deleteAssetsBatch({ filenames, deleteFromStorage: true });
          } catch (batchErr) {
            console.error(`[PhotoContext] ❌ deleteAssetsBatch fallback failed:`, batchErr);
          }
        }
      }

      // Remove photo metadata only when deleting from storage. Read from
      // the ref to avoid stale-closure overwrites.
      const remaining = photosRef.current.filter(p => p.projectId !== projectId);
      await savePhotos(remaining);
    } else {
      // When keeping photos, clear their projectId so they become "unassigned"
      // This way they'll still be visible in the app and can be reassigned to another project
      const updatedPhotos = photosRef.current.map(p =>
        p.projectId === projectId ? { ...p, projectId: null } : p
      );
      photosRef.current = updatedPhotos;
      setPhotos(updatedPhotos);
      await savePhotosMetadata(updatedPhotos);
      console.log(`[PhotoContext] ✅ Cleared projectId for ${related.length} photos (project deleted, photos kept)`);
    }

    // Delete the project entry itself
    await deleteProjectEntry(projectId);
    await loadProjectsList();
  };

  const getPhotosByRoom = (room) => {
    return photos.filter(p => p.room === room && (activeProjectId ? p.projectId === activeProjectId : true));
  };

  const getBeforePhotos = (room) => {
    return photos.filter(p => p.room === room && p.mode === PHOTO_MODES.BEFORE && (activeProjectId ? p.projectId === activeProjectId : true));
  };

  const getAfterPhotos = (room) => {
    return photos.filter(p => p.room === room && p.mode === PHOTO_MODES.AFTER && (activeProjectId ? p.projectId === activeProjectId : true));
  };

  const getCombinedPhotos = (room) => {
    return photos.filter(p => p.room === room && p.mode === PHOTO_MODES.COMBINED && (activeProjectId ? p.projectId === activeProjectId : true));
  };

  // Progress photos for a section/folder, newest first. Filtered to the
  // active project the same way before/after/combined are. Used by the
  // SectionDetail Progress tab and by the Gallery 'Progress' filter.
  const getProgressPhotos = (room) => {
    return photos
      .filter(p => p.room === room && p.mode === PHOTO_MODES.PROGRESS && (activeProjectId ? p.projectId === activeProjectId : true))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  };

  const getUnpairedBeforePhotos = (room) => {
    const beforePhotos = getBeforePhotos(room);
    const afterPhotos = getAfterPhotos(room);

    return beforePhotos.filter(beforePhoto => {
      return !afterPhotos.some(afterPhoto => afterPhoto.beforePhotoId === beforePhoto.id);
    });
  };

  const value = {
    photos,
    projects,
    activeProjectId,
    currentRoom,
    setCurrentRoom,
    loading,
    addPhoto,
    updatePhoto,
    setPhotoOverride,
    clearPhotoOverrides,
    deletePhoto,
    deletePhotoSet,
    deleteAllPhotos,
    setActiveProject: async (projectId) => {
      setActiveProjectId(projectId);
      await saveActiveProjectId(projectId);
    },
    createProject,
    assignPhotosToProject,
    renameProject,
    patchProject,
    getPhotosByProject,
    deleteProject,
    getPhotosByRoom,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    getProgressPhotos,
    getUnpairedBeforePhotos,
    refreshPhotos: loadPhotos,
    refreshAllData: useCallback(async () => {
      await loadPhotos();
      await loadProjectsList();
    }, [])
  };

  return <PhotoContext.Provider value={value}>{children}</PhotoContext.Provider>;
};

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as FS from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

const PHOTOS_METADATA_KEY = 'cleaning-photos-metadata';
const USER_PREFS_KEY = 'user-preferences';
const SETTINGS_KEY = 'app-settings';
const PROJECTS_KEY = 'tracked-projects';
const ACTIVE_PROJECT_ID_KEY = 'active-project-id';
const ASSET_ID_MAP_KEY = 'asset-id-map';
const UPLOAD_COUNTERS_KEY = 'upload-counters';

/**
 * Loads photo metadata from AsyncStorage
 */
export const loadPhotosMetadata = async () => {
  try {
    const saved = await AsyncStorage.getItem(PHOTOS_METADATA_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
    return [];
  } catch (error) {
    return [];
  }
};

/**
 * Saves photo metadata to AsyncStorage
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
      // Persist orientation and camera view mode to preserve layout after reloads
      orientation: p.orientation,
      cameraViewMode: p.cameraViewMode,
      templateType: p.templateType,
      originalWidth: p.originalWidth,
      originalHeight: p.originalHeight,
      uri: p.uri, // File URI in device storage
      projectId: p.projectId || null
    }));

    const jsonString = JSON.stringify(metadata);
    
    await AsyncStorage.setItem(PHOTOS_METADATA_KEY, jsonString);
    
    return true;
  } catch (error) {
    throw error; // Re-throw to let caller know save failed
  }
};

/**
 * Clears all photos from storage
 */
export const clearPhotos = async () => {
  try {
    await AsyncStorage.removeItem(PHOTOS_METADATA_KEY);
  } catch (error) {
  }
};

/**
 * Saves a photo to device storage
 */
export const savePhotoToDevice = async (uri, filename, projectId = null) => {
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
    try {
      const currentStatus = await MediaLibrary.getPermissionsAsync();
      status = currentStatus.status;
      if (status !== 'granted') {
        const requestResult = await MediaLibrary.requestPermissionsAsync();
        status = requestResult.status;
      }
    } catch (permError) {
      try {
        const requestResult = await MediaLibrary.requestPermissionsAsync();
        status = requestResult.status;
      } catch (requestError) {
        console.warn('[Storage] Could not request media library permissions:', requestError);
      }
    }

    if (status === 'granted') {
      try {
        // Create an asset in the system media library
        const asset = await MediaLibrary.createAssetAsync(finalFileUri);

        // Create/add to ProofPix album (works on both iOS and Android)
        const album = await MediaLibrary.getAlbumAsync('ProofPix');
        if (album == null && asset) {
          await MediaLibrary.createAlbumAsync('ProofPix', asset, false);
        } else if (album && asset) {
          await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        }

        // Store a mapping from filename -> assetId for reliable deletion later
        if (asset?.id) {
          try {
            const stored = await AsyncStorage.getItem(ASSET_ID_MAP_KEY);
            const map = stored ? JSON.parse(stored) : {};
            const justName = (finalFileUri.split('/').pop() || '').split('?')[0];
            if (justName) {
              const prev = map[justName];
              map[justName] = typeof prev === 'string'
                ? { id: asset.id, projectId }
                : { id: asset.id, projectId: prev?.projectId ?? projectId };
              await AsyncStorage.setItem(ASSET_ID_MAP_KEY, JSON.stringify(map));
            }
          } catch (mapErr) {
            console.warn('[Storage] Could not update asset id map:', mapErr);
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

    // Derive a filename for media library lookup
    const filename = (uri.split('/').pop() || '').split('?')[0];
    // 1) Delete from app documents directory (idempotent)
    try {
      if (uri.startsWith(FileSystem.documentDirectory)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } else if (uri.startsWith('file://')) {
        // Try deleting other file:// targets as best-effort
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch (fsErr) {
    }

    // 2) Delete from media library (first by stored assetId, then fallbacks)
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      // Try direct assetId from stored mapping
      try {
        const stored = await AsyncStorage.getItem(ASSET_ID_MAP_KEY);
        const map = stored ? JSON.parse(stored) : {};
        const entry = map[filename];
        const assetId = typeof entry === 'string' ? entry : entry?.id;
        if (assetId) {
          try {
            await MediaLibrary.deleteAssetsAsync([assetId]);
            delete map[filename];
            await AsyncStorage.setItem(ASSET_ID_MAP_KEY, JSON.stringify(map));
            return; // deletion done
          } catch (byIdErr) {
          }
        }
      } catch (mapDelErr) {
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
        } catch (delErr) {
          if (album) {
            try {
              await MediaLibrary.removeAssetsFromAlbumAsync([match], album, false);
            } catch (remErr) {
            }
          }
        }
      } else {
      }
    } catch (mlErr) {
    }
  } catch (error) {
  }
};

// Helper: get/set asset ID map
export const getAssetIdMap = async () => {
  try {
    const stored = await AsyncStorage.getItem(ASSET_ID_MAP_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const setAssetIdMap = async (map) => {
  try {
    await AsyncStorage.setItem(ASSET_ID_MAP_KEY, JSON.stringify(map));
  } catch {}
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
      return;
    }
    
    const map = await getAssetIdMap();
    const filenames = [];
    const assetIds = [];
    for (const [name, entry] of Object.entries(map)) {
      const pid = typeof entry === 'string' ? null : entry?.projectId;
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (pid && pid === projectId) {
        filenames.push(name);
        if (id) assetIds.push(id);
      }
    }
    // Delete media assets in a single batch
    if (assetIds.length > 0) {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status === 'granted') {
          await MediaLibrary.deleteAssetsAsync(assetIds);
        } else {
        }
      } catch (e) {
      }
    } else {
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
export const deleteAssetsBatch = async ({ filenames = [], prefixes = [] }) => {
  try {
    const uniqueNames = Array.from(new Set(filenames.filter(Boolean)));
    if (uniqueNames.length === 0 && prefixes.length === 0) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
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
        await MediaLibrary.deleteAssetsAsync(ids);
        // Clean mapping
        const newMap = { ...map };
        for (const key of keysToDeleteFromMap) {
          delete newMap[key];
        }
        await setAssetIdMap(newMap);

      } catch (err) {
      }
    } else {
    }
  } catch (e) {
  }
};

// ===== Projects store =====

/**
 * Load tracked projects
 * Shape: [{ id, name, createdAt }]
 */
export const loadProjects = async () => {
  try {
    const saved = await AsyncStorage.getItem(PROJECTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (e) {
    return [];
  }
};

/**
 * Save tracked projects
 */
export const saveProjects = async (projects) => {
  try {
    const jsonString = JSON.stringify(projects);
    await AsyncStorage.setItem(PROJECTS_KEY, jsonString);
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
};

// Active project persistence
export const loadActiveProjectId = async () => {
  try {
    return await AsyncStorage.getItem(ACTIVE_PROJECT_ID_KEY);
  } catch (e) {
    return null;
  }
};

export const saveActiveProjectId = async (projectId) => {
  try {
    if (projectId == null) {
      await AsyncStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
    } else {
      await AsyncStorage.setItem(ACTIVE_PROJECT_ID_KEY, projectId);
    }
  } catch (e) {
    // noop
  }
};

/**
 * Gets stored user data (cleaner name, location)
 */
export const getStoredUserData = async () => {
  try {
    const stored = await AsyncStorage.getItem(USER_PREFS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return {};
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
    await AsyncStorage.setItem(USER_PREFS_KEY, JSON.stringify(userData));
  } catch (error) {
  }
};

/**
 * Loads app settings
 */
export const loadSettings = async () => {
  try {
    const saved = await AsyncStorage.getItem(SETTINGS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
    return {};
  } catch (error) {
    return {};
  }
};

/**
 * Saves app settings
 */
export const saveSettings = async (settings) => {
  try {
    const existing = await loadSettings();
    const updated = { ...existing, ...settings };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
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


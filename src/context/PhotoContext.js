import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import { loadPhotosMetadata, savePhotosMetadata, deletePhotoFromDevice, loadProjects, saveProjects, createProject as storageCreateProject, deleteProjectEntry, loadActiveProjectId, saveActiveProjectId, deleteAssetsByFilenames, deleteAssetsByPrefixes, deleteProjectAssets, getAssetIdMap, deleteAssetsBatch } from '../services/storage';
import { deleteImagesFromGalleryNative, deleteImagesByProjectIdNative } from '../utils/mediaStoreSaver';
import * as FileSystem from 'expo-file-system/legacy';
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
  const [currentRoom, setCurrentRoom] = useState('kitchen');
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);

  // Load photos on mount
  // Load data on app start
  useEffect(() => {
    (async () => {
      await loadPhotos();
      await loadProjectsList();
      const savedActive = await loadActiveProjectId();
      
      // Validate that savedActive project actually exists
      if (savedActive) {
        const projectsList = await loadProjects();
        const projectExists = projectsList.some(p => p.id === savedActive);
        if (projectExists) {
          setActiveProjectId(savedActive);
        } else {
          setActiveProjectId(null);
          await saveActiveProjectId(null);
        }
      }
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

      // Reassign photo names sequentially
      const renamedPhotos = reassignPhotoNames(validPhotos);

      // Save if names changed
      const namesChanged = renamedPhotos.some((photo, idx) => photo.name !== validPhotos[idx]?.name);
      if (namesChanged) {
        await savePhotosMetadata(renamedPhotos);
      }

      setPhotos(renamedPhotos);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const loadProjectsList = async () => {
    try {
      const list = await loadProjects();
      setProjects(list);
    } catch (e) {
    }
  };

  const savePhotos = async (newPhotos) => {
    try {
      // Reassign names sequentially before saving
      const renamedPhotos = reassignPhotoNames(newPhotos);
      setPhotos(renamedPhotos);
      await savePhotosMetadata(renamedPhotos);
    } catch (error) {
    }
  };

  const addPhoto = async (photo) => {
    try {
      const newPhotos = [...photos, { ...photo, projectId: photo.projectId ?? activeProjectId ?? null }];
      await savePhotos(newPhotos);
    } catch (error) {
      throw error; // Re-throw so caller knows it failed
    }
  };

  const updatePhoto = async (photoId, updates) => {
    const newPhotos = photos.map(p =>
      p.id === photoId ? { ...p, ...updates } : p
    );
    await savePhotos(newPhotos);
  };

  const deletePhoto = async (photoId, options = {}) => {
    try {
      console.log('[PhotoContext] deletePhoto called with options:', options);
      const target = photos.find(p => p.id === photoId);
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
      const newPhotos = photos.filter(p => p.id !== photoId);
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
                await FileSystem.deleteAsync(uri, { idempotent: true });
                console.log('[PhotoContext] Deleted local file:', uri);
            } catch (e) {
                console.warn('[PhotoContext] Failed to delete local file:', e);
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

        // 4. Remove from metadata
        const photoIdsToDelete = new Set(photosToDelete.map(p => p.id));
        const newPhotos = photos.filter(p => !photoIdsToDelete.has(p.id));
        await savePhotos(newPhotos);

    } catch (error) {
    }
  };

  const deleteAllPhotos = async () => {
    await savePhotos([]);
  };

  // ===== Project operations =====
  const createProject = async (name) => {
    try {
      const newProject = {
        id: `proj_${Date.now()}`,
        name: name,
        createdAt: new Date().toISOString(),
      };
      const updatedProjects = [newProject, ...projects];
      setProjects(updatedProjects);
      
      // Save projects to persistent storage
      await saveProjects(updatedProjects);
      
      // Reset custom rooms to default when new project is created
      // Auto-assign only unassigned photos to the new project
      const unassigned = photos.filter(p => !p.projectId);
      if (unassigned.length > 0) {
        const updated = photos.map(p => (!p.projectId ? { ...p, projectId: newProject.id } : p));
        await savePhotos(updated);
      }
      return newProject;
    } catch (error) {
      throw error;
    }
  };

  const assignPhotosToProject = async (projectId) => {
    // Assign only unassigned photos to avoid moving between projects implicitly
    const updated = photos.map(p => (!p.projectId ? { ...p, projectId } : p));
    await savePhotos(updated);
  };

  const renameProject = async (projectId, newName) => {
    try {
      const trimmed = (newName || '').trim();
      if (!trimmed) return;

      const updated = projects.map(p =>
        p.id === projectId ? { ...p, name: trimmed } : p
      );
      setProjects(updated);
      await saveProjects(updated);
    } catch (error) {
      throw error;
    }
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
            await FileSystem.deleteAsync(path, { idempotent: true });
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
        // iOS or no filenames: use asset map method
        try {
          await deleteProjectAssets(projectId);
        } catch (projErr) {
          console.error(`[PhotoContext] ❌ Error deleting project assets:`, projErr);
        }
      }
    }
    
    // Remove only metadata for this project's photos
    const remaining = photos.filter(p => p.projectId !== projectId);
    await savePhotos(remaining);
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
    getPhotosByProject,
    deleteProject,
    getPhotosByRoom,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    getUnpairedBeforePhotos,
    refreshPhotos: loadPhotos,
    refreshAllData: useCallback(async () => {
      await loadPhotos();
      await loadProjectsList();
    }, [])
  };

  return <PhotoContext.Provider value={value}>{children}</PhotoContext.Provider>;
};

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Dimensions,
  PanResponder,
  Modal,
  Alert,
  TextInput,
  Share,
  ActivityIndicator,
  Switch,
  InteractionManager
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { usePhotos } from '../context/PhotoContext';
import { ROOMS, COLORS, PHOTO_MODES } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { CroppedThumbnail } from '../components/CroppedThumbnail';
import PhotoLabel from '../components/PhotoLabel';
import * as FileSystem from 'expo-file-system/legacy';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { createAlbumName } from '../services/uploadService';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import UploadIndicatorLine from '../components/UploadIndicatorLine';
import RoomEditor from '../components/RoomEditor';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const { width } = Dimensions.get('window');
const PHOTO_SIZE = (width - 60) / 2;

export default function HomeScreen({ navigation }) {
  const { t } = useTranslation();
  const {
    currentRoom,
    setCurrentRoom,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    deletePhotoSet,
  } = usePhotos();

  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [fullScreenPhotos, setFullScreenPhotos] = useState([]);
  const [openProjectVisible, setOpenProjectVisible] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const { projects, getPhotosByProject, deleteProject, setActiveProject, activeProjectId, createProject, renameProject, photos } = usePhotos();
  const { userName, location, getRooms, userPlan, cleaningServiceEnabled, sectionLanguage, updateUserPlan, showLabels, toggleLabels, beforeLabelPosition, afterLabelPosition } = useSettings();
  const { userMode } = useAdmin();
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';
  const { exceedsLimit } = useFeaturePermissions();
  const { uploadStatus, cancelUpload, cancelAllUploads } = useBackgroundUpload();
  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [contextMenuRoom, setContextMenuRoom] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [roomEditorMode, setRoomEditorMode] = useState('customize');
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingCameraAfterCreate, setPendingCameraAfterCreate] = useState(false);
  const [combinedBaseUris, setCombinedBaseUris] = useState({});
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [showDeleteProjectsConfirm, setShowDeleteProjectsConfirm] = useState(false);
  const deletedProjectIdsRef = useRef([]);
  const selectedProjectsForDeleteRef = useRef(new Set());
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [sharing, setSharing] = useState(false);

  const { customRooms, saveCustomRooms, resetCustomRooms } = useSettings();
  const [rooms, setRooms] = useState(() => getRooms());
  
  useEffect(() => {
    const newRooms = getRooms();
    setRooms(newRooms);
  }, [customRooms]);

  const handleRoomLongPress = (room, event) => {
    setContextMenuRoom(room);
    const { pageX, pageY } = event.nativeEvent;
    setContextMenuPosition({ x: pageX, y: pageY });
    setShowContextMenu(true);
  };

  const handleAddFolder = () => {
    setRoomEditorMode('add');
    setShowRoomEditor(true);
  };

  const handleDuplicateFolder = async (room) => {
    const generateDuplicateName = (baseName, existingRooms) => {
      const baseNameWithoutNumber = baseName.replace(/\s+\d+$/, '');
      let maxNumber = 1;
      existingRooms.forEach(room => {
        const match = room.name.match(new RegExp(`^${baseNameWithoutNumber}\\s+(\\d+)$`));
        if (match) {
          const number = parseInt(match[1], 10);
          if (number > maxNumber) {
            maxNumber = number;
          }
        }
      });
      return `${baseNameWithoutNumber} ${maxNumber + 1}`;
    };

    const duplicateName = generateDuplicateName(room.name, rooms);
    const newRoom = {
      id: `room_${Date.now()}`,
      name: duplicateName,
      icon: room.icon
    };
    
    const baseNameWithoutNumber = room.name.replace(/\s+\d+$/, '');
    let insertIndex = rooms.length;
    for (let i = rooms.length - 1; i >= 0; i--) {
      const roomName = rooms[i].name;
      if (roomName.startsWith(baseNameWithoutNumber)) {
        insertIndex = i + 1;
        break;
      }
    }
    
    const updatedRooms = [...rooms];
    updatedRooms.splice(insertIndex, 0, newRoom);
    await saveCustomRooms(updatedRooms);
    setCurrentRoom(newRoom.id);
    setContextMenuRoom(newRoom);
    setRoomEditorMode('edit');
    setShowRoomEditor(true);
  };

  const handleDeleteFolder = (room) => {
    const isDefaultRoom = ROOMS.some(defaultRoom => defaultRoom.id === room.id);
    
    if (isDefaultRoom) {
      Alert.alert(
        t('home.protectedFolder'),
        t('home.protectedFolderMessage'),
        [{ text: t('common.confirm') }]
      );
      return;
    }

    Alert.alert(
      t('home.deleteFolder'),
      t('home.deleteFolderConfirm', { name: room.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { 
          text: t('common.delete'), 
          style: 'destructive',
          onPress: () => {
            if (customRooms) {
              const updatedRooms = customRooms.filter(r => r.id !== room.id);
              const currentIndex = rooms.findIndex(r => r.id === room.id);
              const isDeletingCurrentRoom = currentRoom.id === room.id;
              let newCurrentRoom;
              if (updatedRooms.length > 0) {
                if (isDeletingCurrentRoom) {
                  if (currentIndex > 0) {
                    newCurrentRoom = updatedRooms[currentIndex - 1];
                  } else {
                    newCurrentRoom = updatedRooms[updatedRooms.length - 1];
                  }
                } else {
                  newCurrentRoom = rooms.find(r => r.id === currentRoom.id);
                }
                saveCustomRooms(updatedRooms);
                if (newCurrentRoom) {
                  setCurrentRoom(newCurrentRoom.id);
                }
              } else {
                resetCustomRooms();
                setCurrentRoom(ROOMS[0].id);
              }
            }
          }
        }
      ]
    );
  };

  useEffect(() => {}, [rooms]);
  useEffect(() => {}, [customRooms]);

  useEffect(() => {
    if (rooms && rooms.length > 0) {
      const currentRoomExists = rooms.some(room => room.id === currentRoom);
      if (!currentRoomExists) {
        setCurrentRoom(rooms[0].id);
      }
    }
  }, [rooms, currentRoom]);

  useEffect(() => {}, [photos]);

  useEffect(() => {
    if (activeProjectId && projects.length > 0) {
      const activeProjectExists = projects.some(p => p.id === activeProjectId);
      if (!activeProjectExists) {
        setActiveProject(projects[0].id);
      }
    } else if (projects.length > 0 && !activeProjectId) {
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      setActiveProject(null);
    }
  }, [projects, activeProjectId]);

  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);
  const touchStartPos = useRef(null);
  const isSwiping = useRef(false);
  const lastTap = useRef(null);
  const swipeStartX = useRef(null);
  const tapCount = useRef(0);
  
  const beforePhotos = getBeforePhotos(currentRoom);
  const afterPhotos = getAfterPhotos(currentRoom);
  const currentRoomRef = useRef(currentRoom);

  useEffect(() => {}, [photos]);

  useEffect(() => {
    let cancelled = false;

    setTimeout(() => {
      (async () => {
        try {
          const dir = FileSystem.documentDirectory;
          if (!dir || cancelled) return;

          const beforePhotos = getBeforePhotos(currentRoom);
          const afterPhotos = getAfterPhotos(currentRoom);
          const uriMap = {};

          const entries = await FileSystem.readDirectoryAsync(dir);
          if (cancelled) return;
        
        for (const beforePhoto of beforePhotos) {
          const afterPhoto = afterPhotos.find(p => p.beforePhotoId === beforePhoto.id);
          if (!afterPhoto) continue;

          const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
          const projectId = beforePhoto.projectId;
          const projectIdSuffix = projectId ? `_P${projectId}` : '';
          
          const extractTimestamp = (filename) => {
            const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
            return match ? parseInt(match[1], 10) : 0;
          };

          const phoneOrientation = beforePhoto.orientation || 'portrait';
          const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
          const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

          const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
          const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

          let newestUri = null;
          let newestTs = -1;

          const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
          const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

          const primaryMatches = entries.filter(name => {
            if (!name.startsWith(primaryPrefix)) return false;
            if (projectId && !name.includes(projectIdSuffix)) return false;
            return true;
          });

          for (const filename of primaryMatches) {
            const ts = extractTimestamp(filename);
            if (ts > newestTs) {
              newestTs = ts;
              newestUri = `${dir}${filename}`;
            }
          }

          if (!newestUri) {
            const fallbackMatches = entries.filter(name => {
              if (!name.startsWith(fallbackPrefix)) return false;
              if (projectId && !name.includes(projectIdSuffix)) return false;
              return true;
            });

            for (const filename of fallbackMatches) {
              const ts = extractTimestamp(filename);
              if (ts > newestTs) {
                newestTs = ts;
                newestUri = `${dir}${filename}`;
              }
            }
          }
          
          if (newestUri) {
            uriMap[beforePhoto.name] = newestUri;
          }
        }
        
        if (!cancelled) {
          setCombinedBaseUris(uriMap);
        }
      } catch (e) {
      }
      })();
    }, 50);

    return () => { cancelled = true; };
  }, [photos.length, currentRoom]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const timeoutId = setTimeout(() => {
        (async () => {
          try {
            const dir = FileSystem.documentDirectory;
            if (!dir || cancelled) return;

            const beforePhotos = getBeforePhotos(currentRoom);
            const afterPhotos = getAfterPhotos(currentRoom);
            const uriMap = {};

            const entries = await FileSystem.readDirectoryAsync(dir);
            
            for (const beforePhoto of beforePhotos) {
              const afterPhoto = afterPhotos.find(p => p.beforePhotoId === beforePhoto.id);
              if (!afterPhoto || cancelled) continue;

              const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
              const projectId = beforePhoto.projectId;
              const projectIdSuffix = projectId ? `_P${projectId}` : '';
              
              const extractTimestamp = (filename) => {
                const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                return match ? parseInt(match[1], 10) : 0;
              };

              const phoneOrientation = beforePhoto.orientation || 'portrait';
              const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
              const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

              const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
              const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

              let newestUri = null;
              let newestTs = -1;

              const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
              const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

              const primaryMatches = entries.filter(name => {
                if (!name.startsWith(primaryPrefix)) return false;
                if (projectId && !name.includes(projectIdSuffix)) return false;
                return true;
              });

              for (const filename of primaryMatches) {
                const ts = extractTimestamp(filename);
                if (ts > newestTs) {
                  newestTs = ts;
                  newestUri = `${dir}${filename}`;
                }
              }

              if (!newestUri) {
                const fallbackMatches = entries.filter(name => {
                  if (!name.startsWith(fallbackPrefix)) return false;
                  if (projectId && !name.includes(projectIdSuffix)) return false;
                  return true;
                });

                for (const filename of fallbackMatches) {
                  const ts = extractTimestamp(filename);
                  if (ts > newestTs) {
                    newestTs = ts;
                    newestUri = `${dir}${filename}`;
                  }
                }
              }
              
              if (newestUri) {
                uriMap[beforePhoto.name] = newestUri;
              }
            }
            
            if (!cancelled) {
              setCombinedBaseUris(uriMap);
            }
          } catch (e) {
          }
        })();
      }, 600);
      
      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }, [currentRoom, getBeforePhotos, getAfterPhotos])
  );

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  const handleLongPressStart = (photo, beforePhoto = null, afterPhoto = null) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      const photoSet = beforePhoto || photo;
      if (!photoSet) return;
      
      Alert.alert(
        t('home.deletePhotoSet'),
        t('home.deletePhotoSetConfirm', { name: photoSet.name }),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => longPressTriggered.current = false },
          { 
            text: t('common.delete'), 
            style: 'destructive', 
            onPress: () => {
              deletePhotoSet(photoSet.id);
              longPressTriggered.current = false;
            }
          }
        ],
        { cancelable: true, onDismiss: () => longPressTriggered.current = false }
      );
    }, 500);
  };

  const handleLongPressEnd = () => {
    const wasLongPress = longPressTriggered.current;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    setFullScreenPhoto(null);
    setFullScreenPhotoSet(null);
    
    if (wasLongPress) {
      setTimeout(() => {
        longPressTriggered.current = false;
      }, 100); 
    } else {
      longPressTriggered.current = false;
    }
  };

  const handleDoubleTap = (photo, beforePhoto = null, afterPhoto = null) => {
    const allPhotos = [];
    const beforePhotos = getBeforePhotos(currentRoom);
    const afterPhotos = getAfterPhotos(currentRoom);
    const combinedPhotos = getCombinedPhotos(currentRoom);

    const beforeToAfterMap = new Map();
    afterPhotos.forEach(afterPhoto => {
      if (afterPhoto.beforePhotoId) {
        beforeToAfterMap.set(afterPhoto.beforePhotoId, afterPhoto);
      }
    });
    
    beforePhotos.forEach(beforePhoto => {
      const afterPhoto = beforeToAfterMap.get(beforePhoto.id);
      if (afterPhoto) {
        const combinedPhoto = combinedPhotos.find(p => p.name === beforePhoto.name);
        if (combinedPhoto) {
          allPhotos.push({ ...combinedPhoto, type: 'combined', beforePhoto, afterPhoto });
        } else {
          allPhotos.push({ ...beforePhoto, type: 'split', beforePhoto, afterPhoto });
        }
      } else {
        allPhotos.push({ ...beforePhoto, type: 'before' });
      }
    });
    
    let photoIndex = 0;
    if (photo) {
      photoIndex = allPhotos.findIndex(p => p.id === photo.id);
    } else if (beforePhoto) {
      photoIndex = allPhotos.findIndex(p => p.id === beforePhoto.id);
    }
    if (photoIndex >= 0) {
      setFullScreenPhotos(allPhotos);
      setFullScreenIndex(photoIndex);
      if (beforePhoto && afterPhoto) {
        setFullScreenPhotoSet({ before: beforePhoto, after: afterPhoto });
      } else {
        setFullScreenPhoto(allPhotos[photoIndex]);
      }
    }
  };

  const handleSwipeNavigation = (direction) => {
    if (fullScreenPhotos.length === 0) {
      return;
    }
    
    let newIndex = fullScreenIndex;
    if (direction === 'left') {
      newIndex = (fullScreenIndex + 1) % fullScreenPhotos.length;
    } else if (direction === 'right') {
      newIndex = fullScreenIndex === 0 ? fullScreenPhotos.length - 1 : fullScreenIndex - 1;
    }
    setFullScreenIndex(newIndex);
    const newPhoto = fullScreenPhotos[newIndex];
    if (newPhoto.type === 'combined' || newPhoto.type === 'split') {
      setFullScreenPhotoSet({ before: newPhoto.beforePhoto, after: newPhoto.afterPhoto });
      setFullScreenPhoto(null);
    } else {
      setFullScreenPhoto(newPhoto);
      setFullScreenPhotoSet(null);
    }
  };

  const shareCombinedPhoto = async (thumbnailUri, photoName, roomId) => {
    try {
      setSharing(true);
      const tempFileName = `${roomId}_${photoName}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: thumbnailUri, to: tempUri });

      const shareOptions = {
        title: `${t('common.before')}/${t('common.after')} - ${photoName}`,
        url: tempUri,
        type: 'image/jpeg'
      };

      await Share.share(shareOptions);

      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.error('[HomeScreen] Cleanup error:', cleanupError);
      }
    } catch (error) {
      console.error('[HomeScreen] Share error:', error);
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  const panResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
        if (isHorizontalSwipe) {
          isSwiping.current = true;
          return true;
        }
        return false;
      },
      onPanResponderGrant: () => {},
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
        if (currentIndex === -1) {
          return;
        }
        
        if (gestureState.dx > swipeThreshold) {
          const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
          setCurrentRoom(rooms[newIndex].id);
        } else if (gestureState.dx < -swipeThreshold) {
          const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
          setCurrentRoom(rooms[newIndex].id);
        }
        
        setTimeout(() => {
          isSwiping.current = false;
        }, 100);
      }
    });
  }, [rooms]);

  const fullScreenPanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipeStartX.current = null;
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (fullScreenPhoto || fullScreenPhotoSet) {
          const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
          const isVerticalSwipe = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 30;
          if (isHorizontalSwipe && fullScreenPhotos.length > 1 && !swipeStartX.current) {
            swipeStartX.current = gestureState.dx;
          }
          const shouldActivate = isHorizontalSwipe || isVerticalSwipe;
          return shouldActivate;
        }
        return false;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        if (gestureState.dx > swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('right');
        } else if (gestureState.dx < -swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('left');
        }
        
        if (Math.abs(gestureState.dy) > swipeThreshold) {
          handleLongPressEnd();
        }
        
        swipeStartX.current = null;
      }
    });
  }, [fullScreenPhoto, fullScreenPhotoSet, fullScreenPhotos.length, handleSwipeNavigation, handleLongPressEnd]);

  useEffect(() => {}, [openProjectVisible]);

  const openNewProjectModal = (navigateToCamera = false) => {
    if (!userName || userName.trim() === '') {
      Alert.alert(
        t('projects.userNameRequiredTitle'),
        t('projects.userNameRequiredMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('projects.goToSettings'), onPress: () => navigation.navigate('Settings') }
        ]
      );
      return;
    }
    
    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setShowPlanModal(true);
      return;
    }
    
    const base = createAlbumName(userName, new Date(), null, location) || `Project`;
    const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9_\- ]/gi, '_');
    const existing = projects.map(p => p.name);
    const existingNorm = new Set(existing.map(normalize));
    let defaultName = base;
    let candidate = defaultName;
    if (existingNorm.has(normalize(defaultName))) {
      let i = 2;
      while (existingNorm.has(normalize(`${i} ${base}`))) i++;
      candidate = `${i} ${base}`;
    }
    defaultName = candidate;
    setNewProjectName(defaultName);
    setPendingCameraAfterCreate(navigateToCamera);
    setNewProjectVisible(true);
  };

  const handleCreateProject = async () => {
    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setNewProjectVisible(false);
      setShowPlanModal(true);
      return;
    }
    
    try {
      const safeName = (newProjectName || 'Project').replace(/[^\p{L}\p{N}_\- ]/gu, '_');
      const proj = await createProject(safeName);
      await setActiveProject(proj.id);
      setNewProjectVisible(false);
      if (pendingCameraAfterCreate) {
        setPendingCameraAfterCreate(false);
        navigation.navigate('Camera', {
          mode: 'before',
          room: currentRoom
        });
      }
    } catch (e) {
      Alert.alert(t('common.error'), e?.message || t('projects.createError'));
    }
  };

  const handleProjectLongPress = (projectId) => {
    setIsMultiSelectMode(true);
    setSelectedProjects(new Set([projectId]));
  };

  const handleProjectPress = (projectId) => {
    if (isMultiSelectMode) {
      setSelectedProjects(prev => {
        const newSet = new Set(prev);
        if (newSet.has(projectId)) {
          newSet.delete(projectId);
        } else {
          newSet.add(projectId);
        }
        return newSet;
      });
    } else {
      setActiveProject(projectId);
      setOpenProjectVisible(false);
    }
  };

  const handleDeleteSelectedProjects = () => {
    if (selectedProjects.size === 0) {
      return;
    }
    selectedProjectsForDeleteRef.current = new Set(selectedProjects);
    setOpenProjectVisible(false);
    setTimeout(() => {
      setShowDeleteProjectsConfirm(true);
    }, 300);
  };

  const handleDeleteSelectedProjectsConfirmed = async (deleteFromStorageParam) => {
    try {
      const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : true;
      
      const projectsToDelete = Array.from(selectedProjectsForDeleteRef.current);
      const wasActiveProjectSelected = projectsToDelete.includes(activeProjectId);
      const projectIdsToDelete = projectsToDelete;
      deletedProjectIdsRef.current = projectIdsToDelete;
      
      setShowDeleteProjectsConfirm(false);
      setSelectedProjects(new Set());
      setIsMultiSelectMode(false);
      selectedProjectsForDeleteRef.current = new Set();
      
      for (let i = 0; i < projectIdsToDelete.length; i++) {
        const projectId = projectIdsToDelete[i];
        try {
          await deleteProject(projectId, { deleteFromStorage: shouldDeleteFromStorage });
        } catch (error) {
          console.error(`[HomeScreen] Failed to delete project ${projectId}:`, error);
        }
      }
    } catch (error) {
      console.error('[HomeScreen] Error deleting selected projects:', error);
      Alert.alert(t('common.error'), 'Failed to delete some projects. Please try again.');
      deletedProjectIdsRef.current = [];
    }
  };

  useEffect(() => {
    if (deletedProjectIdsRef.current.length > 0) {
      const deletedIds = [...deletedProjectIdsRef.current];
      deletedProjectIdsRef.current = [];
      
      if (activeProjectId && deletedIds.includes(activeProjectId)) {
        const remainingProjects = projects.filter(p => !deletedIds.includes(p.id));
        if (remainingProjects.length > 0) {
          setActiveProject(remainingProjects[0].id);
        } else {
          setActiveProject(null);
        }
      } else if (!activeProjectId && projects.length > 0) {
        setActiveProject(projects[0].id);
      }
    }
  }, [projects, activeProjectId, setActiveProject]);

  const exitMultiSelectMode = () => {
    setIsMultiSelectMode(false);
    setSelectedProjects(new Set());
  };

  const handlePlanModalClose = () => {
    setShowPlanModal(false);
  };

  const handleDisabledDeleteClick = () => {
    Alert.alert(
      t('projects.selectToDelete'),
      t('projects.selectToDeleteHint'),
      [
        { text: t('common.confirm'), style: 'default' }
      ]
    );
  };

  const renderRoomTabs = () => {
    return (
      <View style={styles.roomTabsContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomTabsScrollContent}
          style={styles.roomTabsScrollView}
          nestedScrollEnabled={true}
          directionalLockEnabled={true}
          scrollEnabled={true}
          bounces={false}
        >
          {rooms.map((room) => {
            const isActive = room.id === currentRoom;
            return (
              <TouchableOpacity
                key={room.id}
                style={[
                  styles.roomTab,
                  isActive && styles.roomTabActive
                ]}
                onPress={() => setCurrentRoom(room.id)}
                onLongPress={(event) => handleRoomLongPress(room, event)}
              >
                <RoomIcon 
                  roomId={room.id} 
                  size={32} 
                  color={isActive ? '#000' : '#666'} 
                />
                <Text style={[
                  styles.roomTabText,
                  isActive && styles.roomTabTextActive
                ]}>
                  {cleaningServiceEnabled
                    ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                    : room.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderPhotoGrid = () => {
    const gridItems = [];
    const combinedPhotos = getCombinedPhotos(currentRoom);
    const hasPhotos = beforePhotos.length > 0;

    if (!hasPhotos || !activeProjectId) {
      return (
        <View style={styles.emptyStateContainer}>
          <TouchableOpacity
            style={styles.addPhotoItemCenter}
            delayPressIn={50}
            onPress={() => {
              if (isSwiping.current) return;
              if (!activeProjectId) {
                openNewProjectModal(true);
                return;
              }
              navigation.navigate('Camera', {
                mode: 'before',
                room: currentRoom
              });
            }}
          >
            <RoomIcon 
              roomId={currentRoom} 
              size={64} 
              color={COLORS.PRIMARY} 
            />
            <Text style={styles.addPhotoTextCenter}>
              {!activeProjectId ? t('home.selectProject') : t('camera.takePhoto')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    beforePhotos.forEach((beforePhoto, index) => {
      const afterPhoto = afterPhotos.find(
        (p) => p.beforePhotoId === beforePhoto.id
      );

      if (afterPhoto) {
        const combinedPhoto = combinedPhotos.find(
          (p) => p.name === beforePhoto.name
        );
        const thumbnailUri = combinedBaseUris[beforePhoto.name] || combinedPhoto?.uri;

        if (thumbnailUri) {
          gridItems.push(
            <View
              key={beforePhoto.id}
              style={styles.photoItem}
            >
              <CroppedThumbnail
                imageUri={thumbnailUri}
                aspectRatio={beforePhoto.aspectRatio || '4:3'}
                orientation={beforePhoto.orientation || 'portrait'}
                size={PHOTO_SIZE}
              />
              <View style={styles.photoOverlayBadge}>
                <View style={styles.checkmarkBadge}>
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                </View>
              </View>
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={() => {
                    if (!isSwiping.current) {
                      navigation.navigate('Camera', {
                        mode: 'after',
                        beforePhoto,
                        afterPhoto,
                        combinedPhoto,
                        room: currentRoom
                      });
                    }
                  }}
                >
                  <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>{t('home.retake')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        } else {
          // Determine layout based on aspect ratio
          const beforeAspectRatio = beforePhoto.aspectRatio || '4:3';
          const parseAspectRatio = (ratio) => {
            if (typeof ratio === 'string') {
              const parts = ratio.split(':');
              if (parts.length === 2) {
                const w = parseFloat(parts[0]);
                const h = parseFloat(parts[1]);
                if (w && h) return w / h;
              }
              return 1.0; // Default to square if parsing fails
            }
            return ratio || 1.0;
          };
          
          const beforeRatio = parseAspectRatio(beforeAspectRatio);
          // Square images: ratio close to 1:1 (between 0.85 and 1.15)
          // Portrait/long images: ratio < 0.85 (taller than wide, like 3:4 = 0.75, 9:16 = 0.5625)
          const isSquare = beforeRatio >= 0.85 && beforeRatio <= 1.15;
          // For square images, stack vertically (one up, one down); for portrait/long images, show side-by-side
          const useStackedLayout = isSquare;

          gridItems.push(
            <TouchableOpacity
              key={beforePhoto.id}
              style={styles.photoItem}
              delayPressIn={50}
              onPress={() => {
                if (!longPressTriggered.current && !isSwiping.current) {
                  tapCount.current += 1;
                  const now = Date.now();
                  if (tapCount.current === 1) {
                    lastTap.current = now;
                    setTimeout(() => {
                      if (tapCount.current === 1 && lastTap.current) {
                        navigation.navigate('Camera', {
                          mode: 'after',
                          beforePhoto,
                          afterPhoto,
                          room: currentRoom
                        });
                      }
                      tapCount.current = 0;
                      lastTap.current = null;
                    }, 300);
                  } else if (tapCount.current === 2) {
                    handleDoubleTap(null, beforePhoto, afterPhoto);
                    tapCount.current = 0;
                    lastTap.current = null;
                  }
                }
              }}
              onPressIn={() => handleLongPressStart(null, beforePhoto, afterPhoto)}
              onPressOut={handleLongPressEnd}
            >
              <View style={[styles.splitPreview, useStackedLayout ? styles.stackedPreview : styles.sideBySidePreview]}>
                <Image source={{ uri: beforePhoto.uri }} style={styles.halfPreviewImage} resizeMode="cover" />
                <Image source={{ uri: afterPhoto.uri }} style={styles.halfPreviewImage} resizeMode="cover" />
              </View>
              <View style={styles.photoOverlayBadge}>
                <View style={styles.checkmarkBadge}>
                  <Ionicons name="checkmark" size={14} color="#FFF" />
                </View>
              </View>
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={() => {
                    if (!isSwiping.current) {
                      navigation.navigate('Camera', {
                        mode: 'after',
                        beforePhoto,
                        afterPhoto,
                        room: currentRoom
                      });
                    }
                  }}
                >
                  <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>{t('home.retake')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }
      } else {
        gridItems.push(
          <View
            key={beforePhoto.id}
            style={[styles.photoItem]}
          >
            <CroppedThumbnail
              imageUri={beforePhoto.uri}
              aspectRatio={beforePhoto.aspectRatio || '4:3'}
              orientation={beforePhoto.orientation || 'portrait'}
              size={PHOTO_SIZE}
            />
            <View style={styles.thumbnailButtonsOverlay}>
              <TouchableOpacity
                style={styles.takeAfterButton}
                onPress={() => {
                  if (!isSwiping.current) {
                    navigation.navigate('Camera', {
                      mode: 'after',
                      beforePhoto,
                      room: currentRoom
                    });
                  }
                }}
              >
                <Ionicons name="camera" size={18} color="#000" />
                <Text style={styles.takeAfterButtonText}>{t('home.takeAfter')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.photoOverlayBadge}>
              <View style={styles.clockBadge}>
                <Ionicons name="time-outline" size={16} color="#666" />
              </View>
            </View>
          </View>
        );
      }
    });

    return <View style={styles.photoGrid}>{gridItems}</View>;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/PP_logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.appName}>ProofPix</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.planButtonsContainer}>
            <TouchableOpacity 
              style={[
                styles.starterButton,
                userPlan === 'starter' && styles.planButtonSelected,
                userPlan === 'starter' && styles.planButtonSelectedBackground
              ]} 
              onPress={() => setShowPlanModal(true)}
            >
              <Text style={[
                styles.starterButtonText,
                userPlan === 'starter' && styles.planButtonSelectedText
              ]}>Starter</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[
                styles.upgradeButton,
                userPlan !== 'starter' && styles.planButtonSelected,
                userPlan !== 'starter' && styles.planButtonSelectedBackground
              ]} 
              onPress={() => setShowPlanModal(true)}
            >
              <Ionicons 
                name="star" 
                size={16} 
                color={userPlan !== 'starter' ? '#FFFFFF' : '#666'} 
                style={styles.upgradeButtonIcon} 
              />
              <Text style={[
                styles.upgradeButtonText,
                userPlan !== 'starter' && styles.planButtonSelectedText
              ]}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.projectNameContainer}>
        <View style={styles.projectInfoRow}>
          <View style={styles.projectInfoLeft}>
            <Text style={styles.projectLabel}>Project</Text>
            {(() => {
              const activeProject = projects.find(p => p.id === activeProjectId);
              const displayName = activeProject?.name || t('projects.noProjects');

              if (!activeProject) {
                return (
                  <Text style={styles.projectNameText} numberOfLines={1}>
                    {displayName}
                  </Text>
                );
              }

              if (isEditingProjectName) {
                return (
                  <TextInput
                    style={styles.projectNameInput}
                    value={editedProjectName}
                    onChangeText={setEditedProjectName}
                    placeholder={t('projects.projectNamePlaceholder', { defaultValue: 'Project name' })}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={async () => {
                      const trimmed = editedProjectName.trim();
                      if (!trimmed || trimmed === activeProject.name) {
                        setIsEditingProjectName(false);
                        setEditedProjectName('');
                        return;
                      }
                      try {
                        await renameProject(activeProject.id, trimmed);
                      } catch (e) {
                      } finally {
                        setIsEditingProjectName(false);
                        setEditedProjectName('');
                      }
                    }}
                  />
                );
              }

              return (
                <TouchableOpacity
                  onPress={() => {
                    setEditedProjectName(displayName);
                    setIsEditingProjectName(true);
                  }}
                  style={styles.projectNameTouchable}
                >
                  <Text style={styles.projectNameText} numberOfLines={1}>
                    {displayName}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
          <TouchableOpacity
            style={styles.projectMenuButton}
            onPress={() => setOpenProjectVisible(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#333" />
          </TouchableOpacity>
        </View>
        <UploadIndicatorLine 
          uploadStatus={uploadStatus}
          onPress={() => {
            navigation.navigate('Gallery', { showUploadDetails: true });
          }}
        />
      </View>

      {renderRoomTabs()}

      <View style={styles.content} {...panResponder.panHandlers}>
        <ScrollView 
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {renderPhotoGrid()}
        </ScrollView>
      </View>

      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          if (!activeProjectId) {
            openNewProjectModal(true);
            return;
          }
          navigation.navigate('Camera', {
            mode: 'before',
            room: currentRoom
          });
        }}
      >
        <Ionicons name="camera" size={32} color="#000" />
      </TouchableOpacity>

      <View style={styles.bottomNavPill}>
        <TouchableOpacity 
          style={[styles.navItem, styles.navItemActive]}
        >
          <Ionicons name="home-outline" size={24} color="#000000" />
          <Text style={[styles.navItemText, styles.navItemTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Projects')}
        >
          <Ionicons name="folder-outline" size={24} color="#666666" />
          <Text style={styles.navItemText}>Projects</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Gallery')}
        >
          <Ionicons name="images-outline" size={24} color="#666666" />
          <Text style={styles.navItemText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="settings-outline" size={24} color="#666666" />
          <Text style={styles.navItemText}>Settings</Text>
        </TouchableOpacity>
      </View>

      {fullScreenPhoto && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          <TouchableWithoutFeedback onPress={handleLongPressEnd}>
            <Image
              source={{ uri: fullScreenPhoto.uri }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
          </TouchableWithoutFeedback>
          <TouchableOpacity
            style={styles.fullScreenDeleteButton}
            onPress={() => {
              Alert.alert(
                t('home.deletePhotoSet'),
                t('home.deletePhotoSetConfirm', { name: fullScreenPhoto.name }),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                      deletePhotoSet(fullScreenPhoto.id);
                      handleLongPressEnd();
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={28} color="#EF4444" />
          </TouchableOpacity>
          {fullScreenPhotos.length > 1 && (
            <View style={styles.fullScreenNavigation}>
              <Text style={styles.fullScreenCounter}>
                {fullScreenIndex + 1} / {fullScreenPhotos.length}
              </Text>
            </View>
          )}
          <View style={styles.fullScreenBottomButtons}>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
              onPress={handleLongPressEnd}
            >
              <Text style={styles.fullScreenActionButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenRetakeButton}
              onPress={() => {
                handleLongPressEnd();
                navigation.navigate('Camera', {
                  mode: fullScreenPhoto.mode === 'before' ? 'after' : 'before',
                  beforePhoto: fullScreenPhoto.mode === 'before' ? fullScreenPhoto : null,
                  room: currentRoom
                });
              }}
            >
              <Text style={styles.fullScreenRetakeButtonText}>{t('home.retake')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {fullScreenPhotoSet && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          <TouchableWithoutFeedback onPress={handleLongPressEnd}>
            <View style={[
              styles.fullScreenCombinedPreview,
              (fullScreenPhotoSet.before.orientation === 'landscape' || fullScreenPhotoSet.before.cameraViewMode === 'landscape')
                ? styles.fullScreenStacked
                : styles.fullScreenSideBySide
            ]}>
              <View style={styles.fullScreenHalf}>
                <Image
                  source={{ uri: fullScreenPhotoSet.before.uri }}
                  style={styles.fullScreenHalfImage}
                  resizeMode="cover"
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.before"
                    position={beforeLabelPosition || 'top-left'}
                  />
                )}
              </View>
              <View style={styles.fullScreenHalf}>
                <Image
                  source={{ uri: fullScreenPhotoSet.after.uri }}
                  style={styles.fullScreenHalfImage}
                  resizeMode="cover"
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.after"
                    position={afterLabelPosition || 'top-right'}
                  />
                )}
              </View>
            </View>
          </TouchableWithoutFeedback>
          <View style={styles.fullScreenLabelsToggleContainer}>
            <View style={styles.fullScreenLabelsToggle}>
              <Text style={styles.fullScreenLabelsText}>{t('settings.showLabels')}</Text>
              <Switch
                value={showLabels}
                onValueChange={toggleLabels}
                trackColor={{ false: '#767577', true: COLORS.PRIMARY }}
                thumbColor={showLabels ? '#fff' : '#f4f3f4'}
              />
            </View>
            {showLabels && (
              <TouchableOpacity
                style={styles.fullScreenCustomizeButton}
                onPress={() => {
                  handleLongPressEnd();
                  navigation.navigate('LabelCustomization');
                }}
              >
                <Text style={styles.fullScreenCustomizeText}>{t('settings.customize')}</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={styles.fullScreenDeleteButton}
            onPress={() => {
              Alert.alert(
                t('home.deletePhotoSet'),
                t('home.deletePhotoSetConfirm', { name: fullScreenPhotoSet.before.name }),
                [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('common.delete'),
                    style: 'destructive',
                    onPress: () => {
                      deletePhotoSet(fullScreenPhotoSet.before.id);
                      handleLongPressEnd();
                    }
                  }
                ]
              );
            }}
          >
            <Ionicons name="trash-outline" size={28} color="#EF4444" />
          </TouchableOpacity>
          {fullScreenPhotos.length > 1 && (
            <View style={styles.fullScreenNavigation}>
              <Text style={styles.fullScreenCounter}>
                {fullScreenIndex + 1} / {fullScreenPhotos.length}
              </Text>
            </View>
          )}
          <View style={styles.fullScreenBottomButtons}>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
              onPress={handleLongPressEnd}
            >
              <Text style={styles.fullScreenActionButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenShareButton}
              disabled={sharing}
              onPress={() => {
                const combinedPhoto = getCombinedPhotos(fullScreenPhotoSet.before.room).find(
                  (p) => p.name === fullScreenPhotoSet.before.name
                );
                const thumbnailUri = combinedBaseUris[fullScreenPhotoSet.before.name] || combinedPhoto?.uri;
                if (thumbnailUri) {
                  shareCombinedPhoto(thumbnailUri, fullScreenPhotoSet.before.name, fullScreenPhotoSet.before.room);
                }
              }}
            >
              {sharing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.fullScreenShareButtonText}>{t('gallery.share')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Modal
        visible={openProjectVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setOpenProjectVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('home.manageProjects')}</Text>

            <ScrollView style={styles.projectList} showsVerticalScrollIndicator={true}>
              {projects.length === 0 ? (
                <Text style={styles.projectItemText}>{t('projects.noProjects')}</Text>
              ) : (
                projects.map((proj) => {
                  const isSelected = selectedProjects.has(proj.id);
                  const isCurrent = activeProjectId === proj.id;
                  
                  return (
                    <TouchableOpacity
                      key={proj.id}
                      style={[
                        styles.projectItem,
                        isCurrent && !isMultiSelectMode && { borderWidth: 2, borderColor: '#F2C31B' },
                        isSelected && { borderWidth: 2, borderColor: '#FF0000' }
                      ]}
                      onPress={() => handleProjectPress(proj.id)}
                      onLongPress={() => handleProjectLongPress(proj.id)}
                      delayLongPress={500}
                    >
                      <View style={styles.projectItemContent}>
                        {isMultiSelectMode && (
                          <View style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected
                          ]}>
                            {isSelected && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                        )}
                        <Text style={styles.projectItemText}>
                          📁 {proj.name} {isCurrent && !isMultiSelectMode ? (
                            <Text style={{ color: '#FFC107' }}> {t('projects.current')}</Text>
                          ) : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {isMultiSelectMode ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#22A45D', marginTop: 20 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    setTimeout(() => openNewProjectModal(false), 50);
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: 'white' }]}>＋ {t('home.newProject')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: selectedProjects.size > 0 ? '#FFE6E6' : '#F2F2F2',
                      marginTop: 8
                    }
                  ]}
                  onPress={handleDeleteSelectedProjects}
                  disabled={selectedProjects.size === 0}
                >
                  <Ionicons 
                    name="trash-outline" 
                    size={18} 
                    color={selectedProjects.size > 0 ? '#CC0000' : '#999'} 
                    style={{ marginRight: 6 }} 
                  />
                  <Text style={[
                    styles.actionBtnText,
                    { color: selectedProjects.size > 0 ? '#CC0000' : '#999' }
                  ]}>
                    {t('home.deleteSelected')} ({selectedProjects.size})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F2C31B', marginTop: 16 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    exitMultiSelectMode();
                    navigation.navigate('Gallery');
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#000' }]}>🖼️ {t('home.gallery')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#D6ECFF', marginTop: 8 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    exitMultiSelectMode();
                    navigation.navigate('Gallery', { openManage: true });
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#0077CC' }]}>📤 {t('home.shareProject')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F2F2F2', marginTop: 8 }]}
                  onPress={exitMultiSelectMode}
                >
                  <Text style={styles.actionBtnText}>{t('home.cancelSelection')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#22A45D', marginTop: 20 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    setTimeout(() => openNewProjectModal(false), 50);
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: 'white' }]}>＋ {t('home.newProject')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: '#F2F2F2',
                      marginTop: 8
                    }
                  ]}
                  onPress={handleDisabledDeleteClick}
                >
                  <Ionicons name="trash-outline" size={18} color="#999" style={{ marginRight: 6 }} />
                  <Text style={[styles.actionBtnText, { color: '#999' }]}>
                    {t('home.deleteSelected')} (0)
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F2C31B', marginTop: 16 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    navigation.navigate('Gallery');
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#000' }]}>🖼️ {t('home.gallery')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#D6ECFF', marginTop: 8 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    navigation.navigate('Gallery', { openManage: true });
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#0077CC' }]}>📤 {t('home.shareProject')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#F2F2F2', marginTop: 8 }]}
                  onPress={() => setOpenProjectVisible(false)}
                >
                  <Text style={styles.actionBtnText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={newProjectVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setNewProjectVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('projects.newProjectTitle')}</Text>
            <View style={{ width: '92%', marginTop: 8 }}>
              <TextInput
                style={{
                  borderWidth: 1,
                  borderColor: COLORS.BORDER,
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: 'white'
                }}
                value={newProjectName}
                onChangeText={setNewProjectName}
                placeholder={t('projects.projectName')}
                placeholderTextColor={COLORS.GRAY}
              />
            </View>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#F2F2F2', flex: 1, marginRight: 6 }]} onPress={() => setNewProjectVisible(false)}>
                <Text style={styles.actionBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary, { flex: 1, marginLeft: 6 }]} onPress={handleCreateProject}>
                <Text style={[styles.actionBtnText, { color: 'white' }]}>{t('projects.create')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showContextMenu} transparent={true} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowContextMenu(false)}>
          <View style={styles.contextMenuOverlay}>
            <View style={[styles.contextMenu, { 
              left: Math.min(contextMenuPosition.x, width - 200),
              top: Math.max(contextMenuPosition.y - 100, 50)
            }]}>
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  setShowContextMenu(false);
                  handleAddFolder();
                }}
              >
                <Text style={styles.contextMenuIcon}>➕</Text>
                <Text style={styles.contextMenuText}>{t('home.addFolder')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  setShowContextMenu(false);
                  handleDuplicateFolder(contextMenuRoom);
                }}
              >
                <Text style={styles.contextMenuIcon}>📋</Text>
                <Text style={styles.contextMenuText}>{t('home.duplicateFolder')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.contextMenuItem, styles.contextMenuItemDanger]}
                onPress={() => {
                  setShowContextMenu(false);
                  handleDeleteFolder(contextMenuRoom);
                }}
              >
                <Text style={styles.contextMenuIcon}>🗑️</Text>
                <Text style={[styles.contextMenuText, styles.contextMenuTextDanger]}>{t('home.deleteFolder')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <RoomEditor
        visible={showRoomEditor}
        mode={roomEditorMode}
        onClose={() => {
          setShowRoomEditor(false);
          setContextMenuRoom(null);
          setRoomEditorMode('customize');
        }}
        onSave={(rooms) => {
          saveCustomRooms(rooms);
          if (contextMenuRoom) {
            setCurrentRoom(contextMenuRoom.id);
          }
          setShowRoomEditor(false);
          setContextMenuRoom(null);
          setRoomEditorMode('customize');
        }}
        initialRooms={customRooms}
        editRoom={contextMenuRoom}
      />

      <Modal
        visible={showPlanModal}
        transparent={true}
        animationType="slide"
        onRequestClose={handlePlanModalClose}
      >
        <View style={styles.planModalOverlay}>
          <View style={styles.planModalContent}>
            <View style={styles.planModalHeader}>
              <Text style={styles.planModalTitle}>{t('planModal.title')}</Text>
              <TouchableOpacity
                onPress={handlePlanModalClose}
                style={styles.planModalCloseButton}
              >
                <Text style={styles.planModalCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.planModalScrollView}>
              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                  onPress={async () => {
                    try {
                      await updateUserPlan('starter');
                      InteractionManager.runAfterInteractions(() => {
                        handlePlanModalClose();
                      });
                    } catch (error) {
                      handlePlanModalClose();
                    }
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>{t('planModal.starter')}</Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('planModal.starterDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                  onPress={async () => {
                    try {
                      await updateUserPlan('pro');
                      InteractionManager.runAfterInteractions(() => {
                        handlePlanModalClose();
                      });
                    } catch (error) {
                      handlePlanModalClose();
                    }
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>{t('planModal.pro')}</Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('planModal.proDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                  onPress={async () => {
                    try {
                      await updateUserPlan('business');
                      InteractionManager.runAfterInteractions(() => {
                        handlePlanModalClose();
                      });
                    } catch (error) {
                      handlePlanModalClose();
                    }
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('planModal.business')}</Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('planModal.businessDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                  onPress={() => {
                    setShowPlanModal(false);
                    setShowEnterpriseModal(true);
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('planModal.enterprise')}</Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('planModal.enterpriseDescription')}</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

      <DeleteConfirmationModal
        visible={showDeleteProjectsConfirm}
        title={t('projects.deleteProjects')}
        message={showDeleteProjectsConfirm ? (() => {
          const selectedIds = Array.from(selectedProjectsForDeleteRef.current);
          const projectNames = selectedIds.map(id => 
            projects.find(p => p.id === id)?.name
          ).filter(Boolean);
          return t('projects.deleteProjectsConfirm', { count: selectedIds.length, names: projectNames.join(', ') });
        })() : ''}
        onConfirm={handleDeleteSelectedProjectsConfirmed}
        onCancel={() => {
          setShowDeleteProjectsConfirm(false);
          selectedProjectsForDeleteRef.current = new Set();
          setTimeout(() => {
            setOpenProjectVisible(true);
          }, 100);
        }}
        deleteFromStorageDefault={true}
        userPlan={userPlan}
        onShowPlanModal={() => {
          setShowPlanModal(true);
        }}
        planModalVisible={showPlanModal}
        onPlanModalClose={handlePlanModalClose}
        updateUserPlan={updateUserPlan}
        t={t}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoImage: {
    width: 40,
    height: 40,
    marginRight: 12,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  planButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
    borderRadius: 20,
    overflow: 'hidden',
  },
  starterButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRightWidth: 0,
    borderRightColor: COLORS.PRIMARY,
  },
  starterButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '600',
  },
  upgradeButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  upgradeButtonIcon: {
    marginRight: 6,
  },
  upgradeButtonText: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '700',
  },
  planButtonSelected: {
    borderRadius: 20,
    borderColor: COLORS.PRIMARY,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  planButtonSelectedBackground: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 20,
  },
  planButtonSelectedText: {
    color: '#FFFFFF',
  },
  projectNameContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  projectInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  projectInfoLeft: {
    flex: 1,
    marginRight: 12,
  },
  projectLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '400',
    marginBottom: 6,
    letterSpacing: 0.1,
  },
  projectNameText: {
    fontSize: 20,
    color: '#000',
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  projectNameTouchable: {
    flex: 1,
  },
  projectMenuButton: {
    padding: 8,
    marginTop: 20,
  },
  projectNameInput: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  bottomNavPill: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'white',
    borderRadius: 32,
    paddingVertical: 10,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 90,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 20,
  },
  navItemActive: {
    backgroundColor: '#F0F0F0',
  },
  navItemText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666666',
    marginTop: 4,
  },
  navItemTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
  roomTabsContainer: {
    backgroundColor: 'white',
    paddingVertical: 16,
  },
  roomTabsScrollView: {
    flex: 0,
  },
  roomTabsScrollContent: {
    paddingHorizontal: 16,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  roomTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginRight: 12,
    width: 100,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  roomTabActive: {
    backgroundColor: '#FDF5D0',
    borderColor: '#FDF5D0',
    shadowColor: COLORS.PRIMARY,
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  roomTabText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
  },
  roomTabTextActive: {
    color: '#000',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  photoItem: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4
  },
  photoOverlayBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  checkmarkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  clockBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  thumbnailButtonsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    alignItems: 'flex-start',
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  retakeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  takeAfterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 20,
    gap: 8,
    alignSelf: 'center',
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  takeAfterButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  addPhotoItemCenter: {
    width: 200,
    height: 200,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  addPhotoTextCenter: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
  splitPreview: {
    width: '100%',
    height: '100%',
  },
  stackedPreview: {
    flexDirection: 'column',
  },
  sideBySidePreview: {
    flexDirection: 'row',
  },
  halfPreviewImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  fullScreenPhotoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  fullScreenPhoto: {
    width: '100%',
    height: '100%'
  },
  fullScreenCombinedPreview: {
    aspectRatio: 1,
    width: '90%',
    maxWidth: 500,
    maxHeight: 500,
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: COLORS.PRIMARY
  },
  fullScreenStacked: {
    flexDirection: 'column'
  },
  fullScreenSideBySide: {
    flexDirection: 'row'
  },
  fullScreenHalf: {
    flex: 1
  },
  fullScreenHalfImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenNavigation: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 1001
  },
  fullScreenCounter: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  fullScreenLabelsToggleContainer: {
    position: 'absolute',
    top: '15%',
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 1002
  },
  fullScreenLabelsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  fullScreenLabelsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8
  },
  fullScreenCustomizeButton: {
    marginTop: 8,
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20
  },
  fullScreenCustomizeText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600'
  },
  fullScreenDeleteButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    padding: 10,
    zIndex: 1002
  },
  fullScreenBottomButtons: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
    zIndex: 1002
  },
  fullScreenActionButton: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenActionButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700'
  },
  fullScreenShareButton: {
    flex: 1,
    backgroundColor: '#0077CC',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenShareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  fullScreenRetakeButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenRetakeButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 16,
    fontWeight: '700'
  },
  optionsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  optionsModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    width: '86%',
    maxWidth: 380
  },
  optionsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginBottom: 16,
    textAlign: 'center'
  },
  projectList: {
    maxHeight: 280
  },
  projectItem: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F7F7F7',
    marginBottom: 10
  },
  projectItemContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#DDD',
    backgroundColor: 'white',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  checkboxSelected: {
    borderColor: '#FF0000',
    backgroundColor: '#FFE6E6'
  },
  checkmark: {
    color: '#FF0000',
    fontSize: 14,
    fontWeight: 'bold'
  },
  projectItemText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '500'
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600'
  },
  actionPrimary: {
    backgroundColor: COLORS.PRIMARY
  },
  contextMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  contextMenu: {
    position: 'absolute',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  contextMenuItemDanger: {
    backgroundColor: 'rgba(255, 0, 0, 0.05)',
  },
  contextMenuIcon: {
    fontSize: 18,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  contextMenuText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  contextMenuTextDanger: {
    color: '#FF4444',
  },
  planModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
    zIndex: 10001,
  },
  planModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  planModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8'
  },
  planModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000'
  },
  planModalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  planModalCloseText: {
    fontSize: 24,
    color: '#999'
  },
  planModalScrollView: {
    paddingHorizontal: 20,
    paddingTop: 20
  },
  planContainer: {
    marginBottom: 20
  },
  planButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    alignItems: 'center'
  },
  planButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.PRIMARY
  },
  planButtonTextSelected: {
    color: '#000000'
  },
  planSubtext: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10
  },
});
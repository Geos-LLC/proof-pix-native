import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  InteractionManager,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { usePhotos } from '../context/PhotoContext';
import { ROOMS, COLORS, PHOTO_MODES, TEMPLATE_CONFIGS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { CroppedThumbnail } from '../components/CroppedThumbnail';
import PhotoLabel from '../components/PhotoLabel';
import CompareViewer from '../components/CompareViewer';
import CompareModeSwitcher from '../components/CompareModeSwitcher';
import { pickBeforeLabelPosition, pickAfterLabelPosition } from '../utils/labelPosition';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { createAlbumName } from '../services/uploadService';
import { LOCATIONS, getLocationName } from '../config/locations';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import RoomEditor from '../components/RoomEditor';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import ShareCooldownBanner from '../components/ShareCooldownBanner';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import * as ExpoLocation from 'expo-location';
import { IAP_PRODUCTS, purchaseOrUpgrade, clearPendingTransactions } from '../services/iapService';
import { isTrialActive } from '../services/trialService';

const { width } = Dimensions.get('window');
const PHOTO_SIZE = (width - 80) / 2;

// Helper to check if aspect ratio is portrait (height > width)
const isPortraitAspectRatio = (aspectRatio) => {
  if (!aspectRatio) return true; // Default to portrait if unknown
  const [w, h] = aspectRatio.split(':').map(Number);
  return h > w; // 3:4, 9:16 etc are portrait
};

// Helper to check if layout should be stacked based on template or aspect ratio
const isStackedLayout = (templateType, aspectRatio) => {
  // First check templateType if available
  if (templateType) {
    const config = TEMPLATE_CONFIGS[templateType];
    if (config?.layout) return config.layout === 'stack';
  }
  // Fallback to aspect ratio - landscape photos should be stacked, portrait should be side-by-side
  // Portrait (3:4, 9:16): side-by-side (vertical divider)
  // Landscape (4:3, 16:9): stacked (horizontal divider)
  return !isPortraitAspectRatio(aspectRatio);
};

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
  const [fullScreenLoading, setFullScreenLoading] = useState(false);
  const [fullScreenError, setFullScreenError] = useState(null);
  const [openProjectVisible, setOpenProjectVisible] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const { projects, getPhotosByProject, deleteProject, setActiveProject, activeProjectId, createProject, renameProject, photos } = usePhotos();
  const insets = useSafeAreaInsets();
  const {
    userName,
    location,
    getRooms,
    userPlan,
    cleaningServiceEnabled,
    sectionLanguage,
    updateUserPlan,
    showLabels,
    toggleLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    updateUserInfo,
  } = useSettings();
  // Build a settings snapshot for the orientation-aware position helper so we
  // don't rebuild it inline at every render of the full-screen overlay.
  const labelPosSettings = {
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
  };
  const { userMode, updatePlanLimit } = useAdmin();
  const fullScreenTopInset = Math.max(insets.top, 25);
  const fullScreenBottomInset = Math.max(insets.bottom, 20);
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';
  const { exceedsLimit, effectivePlan } = useFeaturePermissions();
  const { uploadStatus, cancelUpload, cancelAllUploads } = useBackgroundUpload();
  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [contextMenuRoom, setContextMenuRoom] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [roomEditorMode, setRoomEditorMode] = useState('customize');
  const [newProjectNamePart, setNewProjectNamePart] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState(location);
  const [locationLoadingInModal, setLocationLoadingInModal] = useState(false);
  const [pendingCameraAfterCreate, setPendingCameraAfterCreate] = useState(false);
  const [combinedBaseUris, setCombinedBaseUris] = useState({});
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [showDeleteProjectsConfirm, setShowDeleteProjectsConfirm] = useState(false);
  const [showDeletePhotoConfirm, setShowDeletePhotoConfirm] = useState(false);
  const pendingDeletePhotoIdRef = useRef(null);
  const deletedProjectIdsRef = useRef([]);
  const selectedProjectsForDeleteRef = useRef(new Set());
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [sharing, setSharing] = useState(false);
  // Compare mode for the full-screen before/after viewer (persists per session).
  const [compareMode, setCompareMode] = useState('split');
  const [initialProjectCreated, setInitialProjectCreated] = useState(false);

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

  useEffect(() => {
    if (rooms && rooms.length > 0) {
      const currentRoomExists = rooms.some(room => room.id === currentRoom);
      if (!currentRoomExists) {
        setCurrentRoom(rooms[0].id);
      }
    }
  }, [rooms, currentRoom]);

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

  // Auto-create the very first project after sign-in using user's name, location and current date/time.
  useEffect(() => {
    let cancelled = false;

    const maybeCreateInitialProject = async () => {
      // Only if we haven't done it yet, user has a name, and there are no projects.
      if (initialProjectCreated) return;
      if (!userName || userName.trim() === '') return;
      if (projects.length > 0) return;

      try {
        setInitialProjectCreated(true);
        const locationDisplay = getLocationName(location);
        const baseName = createAlbumName(userName.trim(), new Date(), null, locationDisplay);

        const normalize = (s) =>
          (s || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[^a-z0-9_\- ]/gi, '_');

        const existing = projects.map((p) => p.name);
        const existingNorm = new Set(existing.map(normalize));

        let finalName = baseName;
        if (existingNorm.has(normalize(baseName))) {
          let i = 2;
          while (existingNorm.has(normalize(`${i} ${baseName}`))) i++;
          finalName = `${i} ${baseName}`;
        }

        const safeName = finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
        const proj = await createProject(safeName);
        if (!cancelled && proj?.id) {
          await setActiveProject(proj.id);
        }
      } catch (e) {
        console.error('[HomeScreen] Failed to auto-create initial project:', e);
        // Allow retry on next run if creation failed
        if (!cancelled) {
          setInitialProjectCreated(false);
        }
      }
    };

    maybeCreateInitialProject();

    return () => {
      cancelled = true;
    };
  }, [initialProjectCreated, projects, userName, location, createProject, setActiveProject]);

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
  const roomTabsScrollRef = useRef(null);

  // Create circular room arrangement with active room in center
  const getCircularRooms = useCallback(() => {
    if (!rooms.length) return [];

    const activeIndex = rooms.findIndex(r => r.id === currentRoom);
    if (activeIndex < 0) return rooms;

    const totalRooms = rooms.length;
    const middleIndex = Math.floor(totalRooms / 2);

    // Calculate how much to rotate the array to put active item in middle
    const rotateBy = activeIndex - middleIndex;

    // Create new array with circular rotation
    const circularRooms = [];
    for (let i = 0; i < totalRooms; i++) {
      const sourceIndex = (i + rotateBy + totalRooms) % totalRooms;
      circularRooms.push(rooms[sourceIndex]);
    }

    return circularRooms;
  }, [rooms, currentRoom]);

  // Scroll to center after room change
  useEffect(() => {
    if (!roomTabsScrollRef.current || !rooms.length) return;

    const TAB_WIDTH = 79; // minWidth(69) + gap(10)
    const PADDING = 16;
    const screenWidth = Dimensions.get('window').width;
    const middleIndex = Math.floor(rooms.length / 2);

    // Calculate scroll position to center the middle tab (which is now the active one)
    const tabCenterX = PADDING + (middleIndex * TAB_WIDTH) + (TAB_WIDTH / 2);
    const scrollX = Math.max(0, tabCenterX - (screenWidth / 2));

    setTimeout(() => {
      roomTabsScrollRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 50);
  }, [currentRoom, rooms]);

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
      isSwiping.current = false;
      longPressTriggered.current = false;
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
      
      pendingDeletePhotoIdRef.current = photoSet.id;
      setShowDeletePhotoConfirm(true);
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
    setFullScreenLoading(false);
    setFullScreenError(null);

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
      setFullScreenLoading(false);
      setFullScreenError(null);
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
    setFullScreenLoading(false);
    setFullScreenError(null);
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

      if (Platform.OS === 'android') {
        await Sharing.shareAsync(tempUri, { mimeType: 'image/jpeg', dialogTitle: `${t('common.before')}/${t('common.after')} - ${photoName}` });
      } else {
        await Share.share({ title: `${t('common.before')}/${t('common.after')} - ${photoName}`, url: tempUri });
      }

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

  const openNewProjectModal = (navigateToCamera = false) => {
    if (!userName || userName.trim() === '') {
      Alert.alert(
        t('projects.userNameRequiredTitle'),
        t('projects.userNameRequiredMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('projects.goToSettings'), onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Settings' }] }) }
        ]
      );
      return;
    }
    
    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setShowPlanModal(true);
      return;
    }
    
    const locationDisplay = getLocationName(location);
    // Default the new-project name to a sequential "Project N" so users
    // don't see their account name prefilled. N is current project count + 1.
    setNewProjectNamePart(`Project ${(projects?.length || 0) + 1}`);
    setNewProjectLocation(locationDisplay);
    setPendingCameraAfterCreate(navigateToCamera);
    setNewProjectVisible(true);
  };

  const handleUseCurrentLocationInModal = async () => {
    setLocationLoadingInModal(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('settings.locationPermissionTitle', { defaultValue: 'Location access' }),
          t('settings.locationPermissionMessage', { defaultValue: 'Permission to use location is required to set folder location from GPS.' }),
          [{ text: 'OK', style: 'cancel' }]
        );
        return;
      }
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const [address] = await ExpoLocation.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const locationDisplay = address?.city || address?.region || address?.subregion || address?.country || t('projects.unknownLocation', { defaultValue: 'Unknown' });
      setNewProjectLocation(locationDisplay);
    } catch (error) {
      console.error('[HomeScreen] Use current location in modal:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.locationError', { defaultValue: 'Could not get current location. Please try again or select a location manually.' }),
        [{ text: 'OK', style: 'cancel' }]
      );
    } finally {
      setLocationLoadingInModal(false);
    }
  };

  const handleCreateProject = async () => {
    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setNewProjectVisible(false);
      setShowPlanModal(true);
      return;
    }
    const namePart = (newProjectNamePart || userName || 'Project').trim();
    if (!namePart) {
      Alert.alert(t('common.error'), t('projects.enterProjectName'));
      return;
    }
    const fullName = createAlbumName(namePart, new Date(), null, newProjectLocation || getLocationName(location));
    const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9_\- ]/gi, '_');
    const existing = projects.map(p => p.name);
    const existingNorm = new Set(existing.map(normalize));
    let finalName = fullName;
    if (existingNorm.has(normalize(fullName))) {
      let i = 2;
      while (existingNorm.has(normalize(`${i} ${fullName}`))) i++;
      finalName = `${i} ${fullName}`;
    }
    const safeName = finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
    try {
      const proj = await createProject(safeName);
      await setActiveProject(proj.id);
      setNewProjectVisible(false);
      setNewProjectNamePart('');
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
    const circularRooms = getCircularRooms();

    return (
      <View style={styles.roomTabsContainer}>
        <ScrollView
          ref={roomTabsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomTabsScrollContent}
          style={styles.roomTabsScrollView}
          nestedScrollEnabled={true}
          directionalLockEnabled={true}
          scrollEnabled={true}
          bounces={false}
        >
          {circularRooms.map((room, index) => {
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
                {room.image ? (
                  <Image
                    key={`room-icon-${room.id}`}
                    source={room.image}
                    style={styles.roomTabImage}
                    resizeMode="contain"
                    fadeDuration={0}
                  />
                ) : (
                  <RoomIcon
                    roomId={room.id}
                    size={30}
                    color="#000"
                  />
                )}
                <Text
                  style={[
                    styles.roomTabText,
                    isActive && styles.roomTabTextActive
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
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
            <Image
              source={ROOMS.image}
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
            <TouchableOpacity
              key={beforePhoto.id}
              style={styles.photoItem}
              activeOpacity={1}
              onPress={() => {
                if (!isSwiping.current) {
                  handleDoubleTap(null, beforePhoto, afterPhoto);
                }
              }}
            >
              <CroppedThumbnail
                imageUri={thumbnailUri}
                aspectRatio={beforePhoto.aspectRatio || '4:3'}
                orientation={beforePhoto.orientation || 'portrait'}
                size={PHOTO_SIZE}
              />
              <View
                style={styles.photoCenterDivider}
                pointerEvents="none"
              />
              <View style={styles.photoOverlayBadge}>
                <View style={styles.checkmarkBadge}>
                  <Ionicons name="checkmark-circle-sharp" size={25} color='#22C55E' />
                </View>
              </View>
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={(e) => {
                    e.stopPropagation();
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
            </TouchableOpacity>
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
                  <Ionicons name="camera-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>{t('home.retake')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }
      } else {
        gridItems.push(
          <TouchableOpacity
            key={beforePhoto.id}
            style={[styles.photoItem]}
            activeOpacity={1}
            onPress={() => {
              if (!isSwiping.current) {
                handleDoubleTap(null, beforePhoto, null);
              }
            }}
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
                onPress={(e) => {
                  e.stopPropagation();
                  if (!isSwiping.current) {
                    navigation.navigate('Camera', {
                      mode: 'after',
                      beforePhoto,
                      room: currentRoom
                    });
                  }
                }}
              >
                <Ionicons name="camera" size={14} color="#000" />
                <Text style={styles.takeAfterButtonText}>{t('home.takeAfter')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.photoOverlayBadge}>
              <View style={styles.clockBadge}>
                <Ionicons name="timer-outline" size={20} color="#FFFFFF" fill="#FFFFFF" />
              </View>
            </View>
          </TouchableOpacity>
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
            source={require('../../assets/logo.png')}
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
              
              <Image source={require('../../assets/Magic_Stick.png')} style={styles.upgradeButtonImage} resizeMode="contain" />
              <Text style={[
                styles.upgradeButtonText,
                userPlan !== 'starter' && styles.planButtonSelectedText
              ]}>Upgrade</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Free-plan share cooldown countdown. Renders only for Starter users
          who are inside the rolling 24h window since their last share.
          Pro+ have FEATURES.UNLIMITED_SHARING and the component returns null. */}
      <ShareCooldownBanner
        effectivePlan={effectivePlan}
        t={t}
        onPress={() => navigation.navigate('PlanSelection', { mode: 'upgrade' })}
      />

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
        style={[styles.fab, { bottom: 90 + insets.bottom }]}
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
        <Ionicons name="camera" size={38} color="#000" />
      </TouchableOpacity>

      <View style={[styles.bottomNavPill, { bottom: 20 + insets.bottom }]}>
        <TouchableOpacity 
          style={[styles.navItem, styles.navItemActive]}
        >
          <Image source={require('../../assets/icons/home.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={[styles.navItemText, styles.navItemTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Projects' }] })}
        >
          <Image source={require('../../assets/icons/projects.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Projects</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] })}
        >
          <Image source={require('../../assets/icons/gallery.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Settings' }] })}
        >
          <Image source={require('../../assets/icons/settings.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Settings</Text>
        </TouchableOpacity>
      </View>

      {fullScreenPhoto && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          {/* Header: Labels toggle | Customize Labels > | Red X close */}
          <View style={[styles.fullScreenHeaderRow, { paddingTop: fullScreenTopInset }]}>
            <View style={styles.fullScreenLabelsToggle}>
              <Text style={styles.fullScreenLabelsText}>{t('Labels')}</Text>
              <Switch
                value={showLabels}
                onValueChange={toggleLabels}
                trackColor={{ false: '#767577', true: '#34C759' }}
                thumbColor={showLabels ? '#fff' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity
              style={styles.fullScreenCustomizeButton}
              onPress={() => {
                handleLongPressEnd();
                navigation.navigate('LabelCustomization');
              }}
            >
              <Text style={styles.fullScreenCustomizeText}>{t('settings.customizeLabels', { defaultValue: 'Customize Labels' })}</Text>
              <Ionicons name="chevron-forward" size={14} color="white" style={{ marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={handleLongPressEnd}>
              <Ionicons name="close" size={20} color="rgba(255, 0, 0, 0.82)" />
            </TouchableOpacity>
          </View>

          {/* Photo area: yellow border, single image */}
          <View style={styles.fullScreenPhotoArea}>
            <View style={styles.fullScreenSinglePreview}>
              {fullScreenLoading && (
                <View style={styles.fullScreenLoadingOverlay}>
                  <ActivityIndicator size="large" color="#F2C31B" />
                </View>
              )}
              {fullScreenError && (
                <View style={styles.fullScreenErrorOverlay}>
                  <Ionicons name="image-outline" size={48} color="#666" />
                  <Text style={styles.fullScreenErrorText}>{t('gallery.imageLoadError', { defaultValue: 'Failed to load image' })}</Text>
                </View>
              )}
              <Image
                key={fullScreenPhoto.uri || fullScreenPhoto.id}
                source={{ uri: fullScreenPhoto.uri }}
                style={styles.fullScreenPhoto}
                resizeMode="contain"
                onError={(e) => {
                  console.log('[HomeScreen] Image load error:', e.nativeEvent?.error, 'URI:', fullScreenPhoto.uri);
                  setFullScreenLoading(false);
                  setFullScreenError(e.nativeEvent?.error || 'Unknown error');
                }}
                onLoadStart={() => {
                  console.log('[HomeScreen] Image load start:', fullScreenPhoto.uri?.substring(0, 80));
                  setFullScreenLoading(true);
                  setFullScreenError(null);
                }}
                onLoad={() => {
                  console.log('[HomeScreen] Image loaded successfully');
                  setFullScreenLoading(false);
                  setFullScreenError(null);
                }}
              />
              {showLabels && fullScreenPhoto.mode && !fullScreenError && (
                <PhotoLabel
                  label={fullScreenPhoto.mode === 'before' ? 'common.before' : 'common.after'}
                  position={
                    fullScreenPhoto.mode === 'before'
                      ? pickBeforeLabelPosition(labelPosSettings, fullScreenPhoto)
                      : pickAfterLabelPosition(labelPosSettings, fullScreenPhoto)
                  }
                />
              )}
            </View>
          </View>

          {/* Room name + pagination dots */}
          <View style={styles.fullScreenRoomNameRow}>
            <Text style={styles.fullScreenRoomName}>
              {rooms.find(r => r.id === fullScreenPhoto.room)?.name || fullScreenPhoto.room || ''}
            </Text>
            {fullScreenPhotos.length > 1 && (
              <View style={styles.fullScreenPaginationDots}>
                {fullScreenPhotos.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.fullScreenDot, i === fullScreenIndex && styles.fullScreenDotActive]}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Bottom bar: black delete circle, yellow share circle */}
          <View style={[styles.fullScreenBottomBar, { paddingBottom: fullScreenBottomInset }]}>
            <TouchableOpacity
              style={styles.fullScreenDeleteCircle}
              onPress={() => {
                pendingDeletePhotoIdRef.current = fullScreenPhoto.id;
                setShowDeletePhotoConfirm(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenShareCircle}
              disabled={sharing}
              onPress={async () => {
                try {
                  setSharing(true);
                  if (Platform.OS === 'android') {
                    await Sharing.shareAsync(fullScreenPhoto.uri, { mimeType: 'image/jpeg', dialogTitle: fullScreenPhoto.name || t('gallery.share') });
                  } else {
                    await Share.share({ url: fullScreenPhoto.uri, title: fullScreenPhoto.name || t('gallery.share') });
                  }
                } catch (e) {
                  if (e?.message !== 'User did not share') {
                    Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
                  }
                } finally {
                  setSharing(false);
                }
              }}
            >
              {sharing ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="paper-plane-outline" size={20} color="#000" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {fullScreenPhotoSet && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          {/* Header: Labels toggle | Customize Labels > | Red X close */}
          <View style={[styles.fullScreenHeaderRow, { paddingTop: fullScreenTopInset }]}>
            <View style={styles.fullScreenLabelsToggle}>
              <Text style={styles.fullScreenLabelsText}>{t('settings.labels', { defaultValue: 'Labels' })}</Text>
              <Switch
                value={showLabels}
                onValueChange={toggleLabels}
                trackColor={{ false: '#767577', true: '#34C759' }}
                thumbColor={showLabels ? '#fff' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity
              style={styles.fullScreenCustomizeButton}
              onPress={() => {
                handleLongPressEnd();
                navigation.navigate('LabelCustomization');
              }}
            >
              <Text style={styles.fullScreenCustomizeText}>{t('settings.customizeLabels', { defaultValue: 'Customize Labels' })}</Text>
              <Ionicons name="chevron-forward" size={14} color="white" style={{ marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={handleLongPressEnd}>
              <Ionicons name="close" size={20} color="red" />
            </TouchableOpacity>
          </View>

          {/* Photo area: CompareViewer with mode switcher. Orientation-aware
              container preserves aspect for portrait, landscape, and mixed
              pairs without cropping or stretching. */}
          <View style={styles.fullScreenPhotoArea}>
            <CompareViewer
              beforePhoto={fullScreenPhotoSet.before}
              afterPhoto={fullScreenPhotoSet.after}
              mode={compareMode}
              renderBeforeOverlay={() => (showLabels ? (
                <PhotoLabel
                  label="common.before"
                  position={pickBeforeLabelPosition(labelPosSettings, fullScreenPhotoSet.before)}
                />
              ) : null)}
              renderAfterOverlay={() => (showLabels ? (
                <PhotoLabel
                  label="common.after"
                  position={pickAfterLabelPosition(labelPosSettings, fullScreenPhotoSet.after)}
                />
              ) : null)}
            />
            <CompareModeSwitcher
              mode={compareMode}
              onChange={setCompareMode}
              style={{ marginTop: 12 }}
            />
          </View>

          {/* Room name + pagination dots */}
          <View style={styles.fullScreenRoomNameRow}>
            <Text style={styles.fullScreenRoomName}>
              {rooms.find(r => r.id === fullScreenPhotoSet.before.room)?.name || fullScreenPhotoSet.before.room}
            </Text>
            {fullScreenPhotos.length > 1 && (
              <View style={styles.fullScreenPaginationDots}>
                {fullScreenPhotos.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.fullScreenDot, i === fullScreenIndex && styles.fullScreenDotActive]}
                  />
                ))}
              </View>
            )}
          </View>

          {/* Bottom bar: black delete circle, yellow share circle */}
          <View style={[styles.fullScreenBottomBar, { paddingBottom: fullScreenBottomInset }]}>
            <TouchableOpacity
              style={styles.fullScreenDeleteCircle}
              onPress={() => {
                pendingDeletePhotoIdRef.current = fullScreenPhotoSet.before.id;
                setShowDeletePhotoConfirm(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenShareCircle}
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
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="paper-plane-outline" size={20} color="#000" />
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
                    navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] });
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#000' }]}>🖼️ {t('home.gallery')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#D6ECFF', marginTop: 8 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    exitMultiSelectMode();
                    navigation.reset({ index: 0, routes: [{ name: 'Gallery', params: { openManage: true } }] });
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
                    navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] });
                  }}
                >
                  <Text style={[styles.actionBtnText, { color: '#000' }]}>🖼️ {t('home.gallery')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#D6ECFF', marginTop: 8 }]}
                  onPress={() => {
                    setOpenProjectVisible(false);
                    navigation.reset({ index: 0, routes: [{ name: 'Gallery', params: { openManage: true } }] });
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.optionsModalOverlay}
        >
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
                value={newProjectNamePart}
                onChangeText={setNewProjectNamePart}
                placeholder={t('projects.projectNamePart', { defaultValue: 'Name (date & location added when created)' })}
                placeholderTextColor={COLORS.GRAY}
              />
              {/* Folder location: user can type any location, with optional quick suggestions */}
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, marginBottom: 6 }}>
                  {t('settings.folderLocation', { defaultValue: 'Folder location' })}
                </Text>
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: COLORS.BORDER,
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    backgroundColor: 'white',
                  }}
                  value={newProjectLocation}
                  onChangeText={setNewProjectLocation}
                  placeholder={t('settings.folderLocationPlaceholder', { defaultValue: 'Type city or location name' })}
                  placeholderTextColor={COLORS.GRAY}
                />
                <TouchableOpacity
                  onPress={handleUseCurrentLocationInModal}
                  disabled={locationLoadingInModal}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 8,
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    alignSelf: 'flex-start',
                    borderRadius: 8,
                    backgroundColor: locationLoadingInModal ? '#E8E8E8' : '#F0F0F0',
                  }}
                >
                  {locationLoadingInModal ? (
                    <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                  ) : (
                    <Ionicons name="locate" size={18} color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                  )}
                  <Text style={{ fontSize: 13, color: '#333' }}>
                    {locationLoadingInModal ? t('projects.gettingLocation', { defaultValue: 'Getting location…' }) : t('projects.useCurrentLocation', { defaultValue: 'Use current location' })}
                  </Text>
                </TouchableOpacity>
              </View>
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
        </KeyboardAvoidingView>
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

      {/* Plan Selection Modal */}
      <Modal
        visible={showPlanModal}
        animationType="slide"
        onRequestClose={() => setShowPlanModal(false)}
      >
        <SafeAreaView style={styles.planModalContainer}>
          <View style={styles.planModalHeader}>
            <TouchableOpacity
              onPress={() => setShowPlanModal(false)}
              style={styles.planModalBackButton}
            >
              <Ionicons name="arrow-back" size={24} color={COLORS.TEXT} />
            </TouchableOpacity>
            <Text style={styles.planModalTitle}>Upgrade a plan</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.planModalBody}>
            <ScrollView style={styles.planModalScrollView} contentContainerStyle={styles.planModalContent}>
              {/* Starter Plan Card */}
              <View style={styles.planCard}>
                <View style={styles.planCardHeader}>
                  <Text style={styles.planCardTitle}>Starter</Text>
                  <View style={styles.planBadgeFree}>
                    <Text style={styles.planBadgeText}>FREE</Text>
                  </View>
                </View>
                <Text style={styles.planCardDescription}>
                  Free forever. Easily manage your first project and create stunning before/after photos ready for social sharing.
                </Text>
                {userPlan === 'starter' && (
                  <View style={styles.currentPlanButton}>
                    <Text style={styles.currentPlanButtonText}>Current Plan</Text>
                  </View>
                )}
              </View>

              {/* Pro Plan Card */}
              <TouchableOpacity
                style={[styles.planCard, styles.planCardRecommended]}
                onPress={async () => {
                  try {
                    const onTrial = await isTrialActive();
                    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !onTrial) {
                      if (userPlan === 'pro') {
                        Alert.alert('Already Subscribed', 'You already have the Pro plan.', [{ text: 'OK' }]);
                        return;
                      }
                      try {
                        setShowPlanModal(false);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await purchaseOrUpgrade(IAP_PRODUCTS.PRO_MONTHLY);
                        await updateUserPlan('pro');
                        Alert.alert(t('common.success', { defaultValue: 'Success' }), t('settings.proPlanActivated', { defaultValue: 'Pro plan activated! Enjoy unlimited photos with advanced features.' }));
                      } catch (err) {
                        if (err?.message === 'USER_CANCELLED' || err?.message === 'user-cancelled') return;
                        console.error('[IAP] Purchase error:', err?.message);
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('settings.purchaseFailedDetail', { defaultValue: 'Purchase failed. This can happen if there are pending transactions. Try clearing them and retry.' }),
                          [
                            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                            {
                              text: t('settings.clearAndRetry', { defaultValue: 'Clear & Retry' }),
                              onPress: async () => {
                                try {
                                  await clearPendingTransactions();
                                } catch (e) {
                                  console.warn('[IAP] Clear failed:', e?.message);
                                }
                                Alert.alert(t('common.info', { defaultValue: 'Info' }), t('settings.transactionsCleared', { defaultValue: 'Pending transactions cleared. Please try the purchase again.' }));
                              }
                            },
                          ]
                        );
                        return;
                      }
                    } else {
                      await updateUserPlan('pro');
                      setShowPlanModal(false);
                    }
                  } catch (error) {
                    console.error('[HomeScreen] Error changing to Pro plan:', error);
                    Alert.alert(t('common.error'), t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' }));
                  }
                }}
              >
                <View style={styles.planCardHeader}>
                  <Text style={styles.planCardTitle}>Pro</Text>
                  <View style={styles.planBadgePrice}>
                    <Text style={styles.planBadgeText}>$8.99/month</Text>
                  </View>
                </View>
                <Text style={styles.planCardDescription}>
                  Everything in Starter & For professionals. Cloud sync + bulk upload.
                </Text>
                <View style={styles.recommendedBadge}>
                  <Text style={styles.recommendedBadgeText}>👍 Recommended</Text>
                </View>
              </TouchableOpacity>

              {/* Business Plan Card */}
              <TouchableOpacity
                style={styles.planCard}
                onPress={async () => {
                  try {
                    const onTrial = await isTrialActive();
                    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !onTrial) {
                      if (userPlan === 'business') {
                        Alert.alert('Already Subscribed', 'You already have the Business plan.', [{ text: 'OK' }]);
                        return;
                      }
                      try {
                        setShowPlanModal(false);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await purchaseOrUpgrade(IAP_PRODUCTS.BUSINESS_MONTHLY);
                        await updatePlanLimit(5);
                        await updateUserPlan('business');
                        Alert.alert(t('common.success', { defaultValue: 'Success' }), t('settings.businessPlanActivated', { defaultValue: 'Business plan activated! You can now add up to 5 team members.' }));
                      } catch (err) {
                        if (err?.message === 'USER_CANCELLED' || err?.message === 'user-cancelled') return;
                        console.error('[IAP] Purchase error:', err?.message);
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('settings.purchaseFailedDetail', { defaultValue: 'Purchase failed. This can happen if there are pending transactions. Try clearing them and retry.' }),
                          [
                            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                            {
                              text: t('settings.clearAndRetry', { defaultValue: 'Clear & Retry' }),
                              onPress: async () => {
                                try {
                                  await clearPendingTransactions();
                                } catch (e) {
                                  console.warn('[IAP] Clear failed:', e?.message);
                                }
                                Alert.alert(t('common.info', { defaultValue: 'Info' }), t('settings.transactionsCleared', { defaultValue: 'Pending transactions cleared. Please try the purchase again.' }));
                              }
                            },
                          ]
                        );
                        return;
                      }
                    } else {
                      await updatePlanLimit(5);
                      await updateUserPlan('business');
                      setShowPlanModal(false);
                    }
                  } catch (error) {
                    console.error('[HomeScreen] Error setting up business plan:', error);
                    Alert.alert(t('common.error'), t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' }));
                  }
                }}
              >
                <View style={styles.planCardHeader}>
                  <Text style={styles.planCardTitle}>Business</Text>
                  <View style={styles.planBadgePrice}>
                    <Text style={styles.planBadgeText}>$24.99/month</Text>
                  </View>
                </View>
                <Text style={styles.planCardDescription}>
                  Everything in Pro & For small teams up to 5 members. $5.99 per additional team member.
                </Text>
              </TouchableOpacity>

              {/* Enterprise Plan Card */}
              <TouchableOpacity
                style={styles.planCard}
                onPress={async () => {
                  try {
                    const onTrial = await isTrialActive();
                    if ((Platform.OS === 'ios' || Platform.OS === 'android') && !onTrial) {
                      if (userPlan === 'enterprise') {
                        Alert.alert('Already Subscribed', 'You already have the Enterprise plan.', [{ text: 'OK' }]);
                        return;
                      }
                      try {
                        setShowPlanModal(false);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await purchaseOrUpgrade(IAP_PRODUCTS.ENTERPRISE_MONTHLY);
                        await updatePlanLimit(15);
                        await updateUserPlan('enterprise');
                        Alert.alert(t('common.success', { defaultValue: 'Success' }), t('settings.enterprisePlanActivated', { defaultValue: 'Enterprise plan activated with 15 team member limit.' }));
                      } catch (err) {
                        if (err?.message === 'USER_CANCELLED' || err?.message === 'user-cancelled') return;
                        console.error('[IAP] Purchase error:', err?.message);
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('settings.purchaseFailedDetail', { defaultValue: 'Purchase failed. This can happen if there are pending transactions. Try clearing them and retry.' }),
                          [
                            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                            {
                              text: t('settings.clearAndRetry', { defaultValue: 'Clear & Retry' }),
                              onPress: async () => {
                                try {
                                  await clearPendingTransactions();
                                } catch (e) {
                                  console.warn('[IAP] Clear failed:', e?.message);
                                }
                                Alert.alert(t('common.info', { defaultValue: 'Info' }), t('settings.transactionsCleared', { defaultValue: 'Pending transactions cleared. Please try the purchase again.' }));
                              }
                            },
                          ]
                        );
                        return;
                      }
                    } else {
                      await updatePlanLimit(15);
                      await updateUserPlan('enterprise');
                      setShowPlanModal(false);
                      Alert.alert(t('common.success', { defaultValue: 'Success' }), t('settings.enterprisePlanActivated', { defaultValue: 'Enterprise plan activated with 15 team member limit.' }));
                    }
                  } catch (error) {
                    console.error('[HomeScreen] Error setting up enterprise plan:', error);
                    Alert.alert(t('common.error'), t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' }));
                  }
                }}
              >
                <View style={styles.planCardHeader}>
                  <Text style={styles.planCardTitle}>Enterprise</Text>
                  <View style={styles.planBadgePrice}>
                    <Text style={styles.planBadgeText}>Starts at $69.99/month</Text>
                  </View>
                </View>
                <Text style={styles.planCardDescription}>
                  Everything in Business & For growing organizations with 15 team members and more
                </Text>
              </TouchableOpacity>

              {/* Get More Button */}
              <TouchableOpacity
                style={styles.getMoreButton}
                onPress={() => setShowPlanModal(false)}
              >
                <Text style={styles.getMoreButtonText}>Get More</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </SafeAreaView>
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
      />

      <DeleteConfirmationModal
        visible={showDeletePhotoConfirm}
        title={t('home.deletePhotoSet')}
        message={t('home.deletePhotoSetConfirm', {
          name: (() => {
            if (!pendingDeletePhotoIdRef.current) return '';
            const p = photos.find(ph => ph.id === pendingDeletePhotoIdRef.current);
            return p?.name || '';
          })()
        })}
        onConfirm={(deleteFromStorage) => {
          const photoId = pendingDeletePhotoIdRef.current;
          setShowDeletePhotoConfirm(false);
          pendingDeletePhotoIdRef.current = null;
          handleLongPressEnd();
          if (photoId) {
            deletePhotoSet(photoId, { deleteFromStorage });
          }
        }}
        onCancel={() => {
          setShowDeletePhotoConfirm(false);
          pendingDeletePhotoIdRef.current = null;
          longPressTriggered.current = false;
        }}
        deleteFromStorageDefault={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8FA'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F6F8FA',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    
  },
  logoImage: {
    width: 41,
    height: 28,
    marginRight: 0,
  },
  appName: {
    fontSize: 27,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    letterSpacing: -0.1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  planButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F2C31B',
    borderRadius: 30,
    overflow: 'hidden',
    height: 32,
  },
  starterButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starterButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.11,
  },
  navItemImage:{
    width: 22,
    height: 22,
  },
  upgradeButton: {
    paddingHorizontal: 12,
    height: 32,
    fontWeight: '700',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
  },
  upgradeButtonIcon: {
    marginRight: 4,
  },
  upgradeButtonText: {
    color: '#000000',
    fontSize: 13.7,
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
    color: '#000000',
    fontWeight: '700',
  },
  projectNameContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 17,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ECECEC',
    shadowColor: 'grey',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 9,
  },
  upgradeButtonImage:{
    width: 14,
    height: 14,
    marginRight: 4,
  },
  roomTabImage:{
    width: 35,
    height: 35,
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
    color: 'grey',
    fontWeight: '500',
    marginBottom: 4,
    letterSpacing: -0.1,
  },
  projectNameText: {
    fontSize: 17,
    color: '#000000',
    fontWeight: '700',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  projectNameTouchable: {
    flex: 1,
  },
  projectMenuButton: {
    padding: 8,
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
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
    zIndex: 100,
  },
  bottomNavPill: {
    position: 'absolute',
    bottom: 20,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f4',
    borderRadius: 296,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 90,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
    height: 50,
  },
  navItemActive: {
    backgroundColor: '#E0E0E0',
    borderRadius: 100,
    marginHorizontal: -7,
  },
  navItemText: {
    fontSize: 10,
    fontWeight: '510',
    color: '#1E1E1E',
    marginTop: 1,
    textAlign: 'center',
  },
  navItemTextActive: {
    color: '#1E1E1E',
    fontWeight: '590',
    letterSpacing: -0.1,
  },
  roomTabsContainer: {
    backgroundColor: '#F6F8FA',
    paddingVertical: 12,
  },
  roomTabsScrollView: {
    flex: 0,
  },
  roomTabsScrollContent: {
    paddingHorizontal: 16,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    minWidth: 69,
    height: 63,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  roomTabActive: {
    backgroundColor: '#FFEAA0',
    borderColor: '#FFEAA0',
    borderWidth: 0,
  },
  roomTabText: {
    fontSize: 10,
    color: '#000000',
    fontWeight: '400',
    marginTop: 5,
    textAlign: 'center',
    letterSpacing: -0.1,
    flexShrink: 0,
  },
  roomTabTextActive: {
    color: '#000000',
    fontWeight: '590',
  },
  content: {
    flex: 1,
    paddingHorizontal: 17,
    paddingTop: 8,
    backgroundColor: '#F6F8FA',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  photoItem: {
    width: PHOTO_SIZE + 12,
    height: 250,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECECEC',
    padding: 5,
  },
  photoCenterDivider: {
    position: 'absolute',
    left: (PHOTO_SIZE + 12)/2,
    marginLeft: -1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
    zIndex: 5,
  },
  photoCenterDividerHorizontal: {
    position: 'absolute',
    top: (PHOTO_SIZE + 12)/2,
    marginTop: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFFFFF',
    zIndex: 5,
  },
  photoOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    zIndex: 10,
  },
  checkmarkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clockBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    color: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
    gap: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
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
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
    gap: 4,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  takeAfterButtonText: {
    color: '#000',
    fontSize: 13,
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
    backgroundColor: '#000',
    zIndex: 1000
  },
  fullScreenPhoto: {
    width: '100%',
    height: '100%'
  },
  fullScreenSinglePreview: {
    aspectRatio: 1,
    width: '100%',
    maxWidth: 400,
    maxHeight: 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    position: 'relative'
  },
  fullScreenLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10
  },
  fullScreenErrorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    zIndex: 10,
    padding: 20
  },
  fullScreenErrorText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center'
  },
  fullScreenHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 12,
    zIndex: 1002
  },
  fullScreenLabelsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  fullScreenLabelsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  fullScreenCustomizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'grey',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 15
  },
  fullScreenCustomizeText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600'
  },
  fullScreenCloseButton: {
    width: 27,
    height: 27,
    borderRadius: 15,
    backgroundColor: 'rgba(99, 3, 3, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'grey',
    zIndex: 1002
  },
  fullScreenPhotoArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20
  },
  fullScreenCombinedPreview: {
    aspectRatio: 1,
    width: '100%',
    maxWidth: 400,
    maxHeight: 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
    position: 'relative',
    flexDirection: 'column' // Default to stacked, will be overridden by fullScreenStacked/SideBySide
  },
  fullScreenStacked: {
    flexDirection: 'column'
  },
  fullScreenSideBySide: {
    flexDirection: 'row'
  },
  fullScreenHalf: {
    flex: 1,
    position: 'relative'
  },
  fullScreenHalfImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenCenterDivider: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -1,
    backgroundColor: COLORS.PRIMARY,
    zIndex: 5
  },
  fullScreenCenterDividerHorizontal: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    marginTop: -1,
    backgroundColor: COLORS.PRIMARY,
    zIndex: 5
  },
  fullScreenRoomNameRow: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 1001
  },
  fullScreenRoomName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8
  },
  fullScreenPaginationDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  fullScreenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.35)'
  },
  fullScreenDotActive: {
    backgroundColor: '#FFFFFF'
  },
  fullScreenBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingBottom:20,
    paddingTop: 16,
    zIndex: 1002
  },
  fullScreenDeleteCircle: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fullScreenShareCircle: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center'
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
  planModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  planModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  planModalScrollView: {
    flex: 1,
  },
  planModalContent: {
    padding: 16,
    paddingBottom: 20,
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
  // New card-style plan modal styles
  planModalContainer: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  planModalBody: {
    flex: 1,
    position: 'relative',
  },
  planModalBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  planCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  planCardRecommended: {
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  planCardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.5,
  },
  planBadgeFree: {
    backgroundColor: '#81C784',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#81C784',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  planBadgePrice: {
    backgroundColor: '#81C784',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#81C784',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  planBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  planCardDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 22,
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  currentPlanButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
    marginTop: 4,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  currentPlanButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  recommendedBadge: {
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  recommendedBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  getMoreButton: {
    backgroundColor: '#000000',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  getMoreButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});


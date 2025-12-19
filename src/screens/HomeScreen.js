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
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { usePhotos } from '../context/PhotoContext';
import { ROOMS, COLORS, PHOTO_MODES } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { CroppedThumbnail } from '../components/CroppedThumbnail';
import PhotoLabel from '../components/PhotoLabel';
import * as FileSystem from 'expo-file-system/legacy';
import { useSettings } from '../context/SettingsContext';
import { createAlbumName } from '../services/uploadService';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import UploadIndicatorLine from '../components/UploadIndicatorLine';
import RoomEditor from '../components/RoomEditor';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const { width } = Dimensions.get('window');
const PHOTO_SIZE = (width - 60) / 2; // 2 columns with padding

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
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null); // For combined preview
  const [fullScreenIndex, setFullScreenIndex] = useState(0); // Index for swipe navigation
  const [fullScreenPhotos, setFullScreenPhotos] = useState([]); // All photos for swipe navigation
  const [openProjectVisible, setOpenProjectVisible] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const { projects, getPhotosByProject, deleteProject, setActiveProject, activeProjectId, createProject, renameProject, photos } = usePhotos();
  const { userName, location, getRooms, userPlan, cleaningServiceEnabled, sectionLanguage, updateUserPlan, showLabels, toggleLabels, beforeLabelPosition, afterLabelPosition } = useSettings();
  const { exceedsLimit } = useFeaturePermissions();
  const { uploadStatus, cancelUpload, cancelAllUploads } = useBackgroundUpload();
  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [contextMenuRoom, setContextMenuRoom] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [roomEditorMode, setRoomEditorMode] = useState('customize'); // 'customize' or 'add'
  const [newProjectName, setNewProjectName] = useState('');
  const [pendingCameraAfterCreate, setPendingCameraAfterCreate] = useState(false);
  const [combinedBaseUris, setCombinedBaseUris] = useState({}); // Cache for combined base image URIs
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [showDeleteProjectsConfirm, setShowDeleteProjectsConfirm] = useState(false);
  const deletedProjectIdsRef = useRef([]);
  const selectedProjectsForDeleteRef = useRef(new Set());
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [sharing, setSharing] = useState(false);

  // Get rooms from settings (custom or default)
  const { customRooms, saveCustomRooms, resetCustomRooms } = useSettings();
  
  // Make rooms reactive to customRooms changes using useState and useEffect
  const [rooms, setRooms] = useState(() => getRooms());
  
  useEffect(() => {
    // 
    const newRooms = getRooms();
    //  || 'null', 'newRooms:', newRooms.map(r => r.name));
    setRooms(newRooms);
  }, [customRooms]);

  // Debug logging
  // useEffect(() => {
  //   );
  // }, [rooms]);

  // useEffect(() => {
  //    || 'null');
  // }, [customRooms]);

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
    // Generate duplicate name
    const generateDuplicateName = (baseName, existingRooms) => {
      // Extract base name without numbers (e.g., "Kitchen 2" -> "Kitchen")
      const baseNameWithoutNumber = baseName.replace(/\s+\d+$/, '');
      
      // Find the highest number for this base name
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

    // Create the duplicate immediately
    const duplicateName = generateDuplicateName(room.name, rooms);
    const newRoom = {
      id: `room_${Date.now()}`,
      name: duplicateName,
      icon: room.icon
    };
    
    // Find the base name to determine where to insert the duplicate
    const baseNameWithoutNumber = room.name.replace(/\s+\d+$/, '');
    
    // Find the last room with the same base name to insert after it
    let insertIndex = rooms.length; // Default to end
    for (let i = rooms.length - 1; i >= 0; i--) {
      const roomName = rooms[i].name;
      if (roomName.startsWith(baseNameWithoutNumber)) {
        insertIndex = i + 1;
        break;
      }
    }
    
    const updatedRooms = [...rooms];
    updatedRooms.splice(insertIndex, 0, newRoom);
    // Save the duplicate to custom rooms immediately
    await saveCustomRooms(updatedRooms);
    // Switch to the new duplicated room immediately
    setCurrentRoom(newRoom.id);
    
    // Open the room editor in edit mode for the new duplicate
    setContextMenuRoom(newRoom);
    setRoomEditorMode('edit');
    setShowRoomEditor(true);
  };

  const handleDeleteFolder = (room) => {
    // Check if it's a default room
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
              
              // Determine which room to switch to after deletion
              const currentIndex = rooms.findIndex(r => r.id === room.id);
              const isDeletingCurrentRoom = currentRoom.id === room.id;
              let newCurrentRoom;
              if (updatedRooms.length > 0) {
                if (isDeletingCurrentRoom) {
                  // If deleting the current room, go to the room to the left (or last if deleting first)
                  if (currentIndex > 0) {
                    newCurrentRoom = updatedRooms[currentIndex - 1];
                  } else {
                    newCurrentRoom = updatedRooms[updatedRooms.length - 1];
                  }
                } else {
                  // If not deleting current room, keep the current room
                  newCurrentRoom = rooms.find(r => r.id === currentRoom.id);
                }
                saveCustomRooms(updatedRooms);
                if (newCurrentRoom) {
                  setCurrentRoom(newCurrentRoom.id);
                }
              } else {
                resetCustomRooms();
                // Reset to first default room
                setCurrentRoom(ROOMS[0].id);
              }
            }
          }
        }
      ]
    );
  };

  // Force re-render when rooms change
  useEffect(() => {
    // This will trigger a re-render when rooms change
  }, [rooms]);

  // Force re-render when customRooms change
  useEffect(() => {
    // This will trigger a re-render when customRooms change
  }, [customRooms]);

  // Validate currentRoom when rooms change
  useEffect(() => {
    if (rooms && rooms.length > 0) {
      const currentRoomExists = rooms.some(room => room.id === currentRoom);
      if (!currentRoomExists) {
        setCurrentRoom(rooms[0].id);
      }
    }
  }, [rooms, currentRoom]);

  // Note: Data reloading is handled by AppState listener in PhotoContext
  // No need for useFocusEffect here to prevent infinite loops

  // Force re-render when photos change (e.g., after project deletion)
  useEffect(() => {
    // This will trigger a re-render when photos change
  }, [photos]);

  // Ensure active project is valid after projects change
  useEffect(() => {
    if (activeProjectId && projects.length > 0) {
      const activeProjectExists = projects.some(p => p.id === activeProjectId);
      if (!activeProjectExists) {
        // Active project no longer exists, select the first available project
        setActiveProject(projects[0].id);
      }
    } else if (projects.length > 0 && !activeProjectId) {
      // No active project but projects exist, select the first one
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      // No projects exist but activeProjectId is set, clear it
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

  // Force re-render when photos change
  useEffect(() => {
    // This will trigger a re-render when photos change
  }, [photos]);

  // Load combined base images for thumbnails (efficiently)
  useEffect(() => {
    let cancelled = false;

    // Defer execution to prevent blocking UI when navigating to this screen
    setTimeout(() => {
      (async () => {
        try {
          const dir = FileSystem.documentDirectory;
          if (!dir || cancelled) return;

          const beforePhotos = getBeforePhotos(currentRoom);
          const afterPhotos = getAfterPhotos(currentRoom);
          const uriMap = {};

          // Read directory once
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

          // Determine primary layout based on orientation
          // Letterbox portrait (portrait phone + landscape camera): SIDE is primary
          // Letterbox landscape & true landscape: STACK is primary
          const phoneOrientation = beforePhoto.orientation || 'portrait';
          const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
          const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

          const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
          const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

          let newestUri = null;
          let newestTs = -1;

          // For letterbox portrait: prioritize SIDE, otherwise prioritize STACK
          const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
          const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

          // First, try to find primary variant
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

          // Only use fallback if no primary found
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
    }, 50); // 50ms delay to allow screen to render before processing files

    return () => { cancelled = true; };
  }, [photos.length, currentRoom]);

  // Also reload when screen comes into focus (debounced to prevent freezes)
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

              // Determine primary layout based on orientation
              // Letterbox portrait (portrait phone + landscape camera): SIDE is primary
              // Letterbox landscape & true landscape: STACK is primary
              const phoneOrientation = beforePhoto.orientation || 'portrait';
              const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
              const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

              const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
              const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

              let newestUri = null;
              let newestTs = -1;

              // For letterbox portrait: prioritize SIDE, otherwise prioritize STACK
              const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
              const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

              // First, try to find primary variant
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

              // Only use fallback if no primary found
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
      }, 600); // Long debounce to avoid interfering with other screens
      
      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }, [currentRoom, getBeforePhotos, getAfterPhotos])
  );

  // Get circular room order with current room in center
  const getCircularRooms = () => {
    const currentIndex = rooms.findIndex(r => r.id === currentRoom);
    const result = [];
    
    // Show 3 items before, current, and 3 items after (total 7 visible)
    for (let i = -3; i <= 3; i++) {
      let index = (currentIndex + i + rooms.length) % rooms.length;
      result.push({ ...rooms[index], offset: i });
    }
    
    return result;
  };

  const circularRooms = getCircularRooms();

  // Debug logging for circular rooms
  // useEffect(() => {
  //   );
  // }, [circularRooms]);

  // Update ref when currentRoom changes
  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Long press handlers for full-screen photo
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
              // analyticsService.logEvent('PhotoSet_Delete', { photoName: photoSet.name, from: 'HomeScreen' });
              longPressTriggered.current = false;
            }
          }
        ],
        { cancelable: true, onDismiss: () => longPressTriggered.current = false }
      );
    }, 500); // 500ms for long press
  };

  const handleLongPressEnd = () => {
    const wasLongPress = longPressTriggered.current;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // Close any open full-screen previews
    setFullScreenPhoto(null);
    setFullScreenPhotoSet(null);
    
    // Only delay reset if it was actually a long press to prevent single-tap from firing
    if (wasLongPress) {
      setTimeout(() => {
        longPressTriggered.current = false;
      }, 100); 
    } else {
      // On a quick tap, reset immediately so that onPress can fire
      longPressTriggered.current = false;
    }
  };

  // Handle double tap - show full screen with swipe navigation
  const handleDoubleTap = (photo, beforePhoto = null, afterPhoto = null) => {
    // Double tap detected - show full screen with swipe navigation
    const allPhotos = [];
    
    // Get all photos for the current room
    const beforePhotos = getBeforePhotos(currentRoom);
    const afterPhotos = getAfterPhotos(currentRoom);
    const combinedPhotos = getCombinedPhotos(currentRoom);
    // Create a map of before photos to their corresponding after photos
    const beforeToAfterMap = new Map();
    afterPhotos.forEach(afterPhoto => {
      if (afterPhoto.beforePhotoId) {
        beforeToAfterMap.set(afterPhoto.beforePhotoId, afterPhoto);
      }
    });
    
    // Add photos in the order they appear on the main screen
    beforePhotos.forEach(beforePhoto => {
      const afterPhoto = beforeToAfterMap.get(beforePhoto.id);
      
      if (afterPhoto) {
        // Check if there's a combined photo for this pair
        const combinedPhoto = combinedPhotos.find(p => p.name === beforePhoto.name);
        
        if (combinedPhoto) {
          // Show combined photo
          allPhotos.push({ ...combinedPhoto, type: 'combined', beforePhoto, afterPhoto });
        } else {
          // Show split preview (before + after)
          allPhotos.push({ ...beforePhoto, type: 'split', beforePhoto, afterPhoto });
        }
      } else {
        // Show before-only photo
        allPhotos.push({ ...beforePhoto, type: 'before' });
      }
    });
    
    // Find the index of the tapped photo
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

  // Handle swipe navigation in full screen
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
    // Set the appropriate view based on photo type
    if (newPhoto.type === 'combined' || newPhoto.type === 'split') {
      setFullScreenPhotoSet({ before: newPhoto.beforePhoto, after: newPhoto.afterPhoto });
      setFullScreenPhoto(null);
    } else {
      setFullScreenPhoto(newPhoto);
      setFullScreenPhotoSet(null);
    }
  };

  // Share combined photo
  const shareCombinedPhoto = async (thumbnailUri, photoName, roomId) => {
    try {
      setSharing(true);

      // Copy the combined image to cache directory for sharing
      const tempFileName = `${roomId}_${photoName}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: thumbnailUri, to: tempUri });

      // Share the image
      const shareOptions = {
        title: `${t('common.before')}/${t('common.after')} - ${photoName}`,
        url: tempUri,
        type: 'image/jpeg'
      };

      await Share.share(shareOptions);

      // Clean up temporary file after sharing
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

  // PanResponder for room switching - recreate when rooms change
  const panResponder = useMemo(() => {
    // );
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Activate for horizontal swipes
        const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
        if (isHorizontalSwipe) {
          isSwiping.current = true;
          return true; // Capture the gesture
        }
        return false;
      },
      onPanResponderGrant: () => {
        // Gesture started
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
        if (currentIndex === -1) {
          return;
        }
        
        if (gestureState.dx > swipeThreshold) {
          // Swipe right - go to previous room (circular)
          const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
          setCurrentRoom(rooms[newIndex].id);
        } else if (gestureState.dx < -swipeThreshold) {
          // Swipe left - go to next room (circular)
          const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
          setCurrentRoom(rooms[newIndex].id);
        }
        
        // Reset swipe flag after a short delay
        setTimeout(() => {
          isSwiping.current = false;
        }, 100);
      }
    });
  }, [rooms]);

  // PanResponder for full screen swipe navigation
  const fullScreenPanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipeStartX.current = null;
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate if we're in full screen mode
        if (fullScreenPhoto || fullScreenPhotoSet) {
          const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
          const isVerticalSwipe = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 30;
          if (isHorizontalSwipe && fullScreenPhotos.length > 1 && !swipeStartX.current) {
            swipeStartX.current = gestureState.dx;
          }
          
          // Activate for both horizontal (carousel) and vertical (close) swipes
          const shouldActivate = isHorizontalSwipe || isVerticalSwipe;
          return shouldActivate;
        }
        return false;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        // Check for horizontal swipes (carousel navigation)
        if (gestureState.dx > swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('right');
        } else if (gestureState.dx < -swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('left');
        }
        
        // Check for vertical swipes (close preview)
        if (Math.abs(gestureState.dy) > swipeThreshold) {
          handleLongPressEnd();
        }
        
        swipeStartX.current = null;
      }
    });
  }, [fullScreenPhoto, fullScreenPhotoSet, fullScreenPhotos.length, handleSwipeNavigation, handleLongPressEnd]);

  // Debug: Log when PanResponder is created
  // 

  useEffect(() => {
    // No-op: projects come from context
  }, [openProjectVisible]);

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
    
    // Check if starter tier user already has a project
    // Starter users can only have 1 project
    if (exceedsLimit('maxProjects', projects.length)) {
      setShowPlanModal(true);
      return;
    }
    
    const base = createAlbumName(userName) || `Project`;
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
    // Double-check: if limit exceeded, show plan modal
    if (exceedsLimit('maxProjects', projects.length)) {
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

  // Multi-selection handlers
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
      // Allow switching between projects
      setActiveProject(projectId);
      setOpenProjectVisible(false);
    }
  };

  const handleDeleteSelectedProjects = () => {
    if (selectedProjects.size === 0) {
      return;
    }
    
    // Store selected projects in ref before opening modal
    selectedProjectsForDeleteRef.current = new Set(selectedProjects);
    
    // Close manage projects modal first to avoid modal overlap issues
    setOpenProjectVisible(false);
    
    // Open delete confirmation modal after a short delay to ensure manage modal is closed
    setTimeout(() => {
      setShowDeleteProjectsConfirm(true);
    }, 300);
  };

  const handleDeleteSelectedProjectsConfirmed = async (deleteFromStorageParam) => {
    console.log('[HomeScreen] ✅ Delete confirmation clicked');
    console.log('[HomeScreen] deleteFromStorageParam:', deleteFromStorageParam);
    
    try {
      const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : true;
      console.log('[HomeScreen] Should delete from storage:', shouldDeleteFromStorage);
      
      // Use stored selected projects from ref (set when modal opened)
      const projectsToDelete = Array.from(selectedProjectsForDeleteRef.current);
      const wasActiveProjectSelected = projectsToDelete.includes(activeProjectId);
      
      // Store project IDs to delete before starting deletion
      const projectIdsToDelete = projectsToDelete;
      
      // Store deleted IDs in ref for useEffect to handle
      deletedProjectIdsRef.current = projectIdsToDelete;
      
      // Close modal immediately to prevent UI freeze
      setShowDeleteProjectsConfirm(false);
      setSelectedProjects(new Set());
      setIsMultiSelectMode(false);
      selectedProjectsForDeleteRef.current = new Set(); // Clear the ref
      
      // Delete projects sequentially
      for (let i = 0; i < projectIdsToDelete.length; i++) {
        const projectId = projectIdsToDelete[i];
        try {
          await deleteProject(projectId, { deleteFromStorage: shouldDeleteFromStorage });
        } catch (error) {
          console.error(`[HomeScreen] ❌ Failed to delete project ${projectId}:`, error);
          // Continue with other deletions even if one fails
        }
      }
      
      // Handle active project selection if active project was deleted
      if (wasActiveProjectSelected && deletedProjectIdsRef.current.length > 0) {
        // The useEffect below will handle setting the new active project
        // after projects state updates
      }
    } catch (error) {
      console.error('[HomeScreen] ❌ Error deleting selected projects:', error);
      Alert.alert(t('common.error'), 'Failed to delete some projects. Please try again.');
      deletedProjectIdsRef.current = [];
    }
  };

  // Handle active project selection after projects are deleted
  useEffect(() => {
    if (deletedProjectIdsRef.current.length > 0) {
      const deletedIds = [...deletedProjectIdsRef.current];
      // Clear the ref first to prevent re-running
      deletedProjectIdsRef.current = [];
      
      // Check if current active project was deleted
      if (activeProjectId && deletedIds.includes(activeProjectId)) {
        // Find first remaining project
        const remainingProjects = projects.filter(p => !deletedIds.includes(p.id));
        if (remainingProjects.length > 0) {
          setActiveProject(remainingProjects[0].id);
        } else {
          setActiveProject(null);
        }
      } else if (!activeProjectId && projects.length > 0) {
        // If no active project but projects exist, set the first one
        setActiveProject(projects[0].id);
      }
    }
  }, [projects, activeProjectId, setActiveProject]);

  const exitMultiSelectMode = () => {
    setIsMultiSelectMode(false);
    setSelectedProjects(new Set());
  };

  // Handle plan modal close - delete confirmation stays open (no need to reopen)
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

  const renderRoomTabs = () => (
    <View style={styles.roomTabsContainer}>
      {circularRooms.map((room, index) => {
        const isActive = room.offset === 0; // Center item is active
        const distance = Math.abs(room.offset);
        const scale = isActive ? 1 : Math.max(0.65, 1 - (distance * 0.15));
        const opacity = isActive ? 1 : Math.max(0.4, 1 - (distance * 0.2));
        
        return (
          <TouchableOpacity
            key={`${room.id}-${index}`}
            style={[
              styles.roomTab,
              isActive && styles.roomTabActive,
              {
                transform: [{ scale }],
                opacity
              }
            ]}
            onPress={() => setCurrentRoom(room.id)}
            onLongPress={(event) => handleRoomLongPress(room, event)}
          >
            <Text style={[styles.roomIcon, { fontSize: isActive ? 28 : 22 }]}>{room.icon}</Text>
            {isActive && (
              <Text
                style={[
                  styles.roomTabText,
                  styles.roomTabTextActive
                ]}
              >
                {cleaningServiceEnabled
                  ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                  : `${t('settings.section', { lng: sectionLanguage })} ${index + 1}`}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderPhotoGrid = () => {
    const gridItems = [];
    const combinedPhotos = getCombinedPhotos(currentRoom);
    const hasPhotos = beforePhotos.length > 0;

    // If no photos OR no active project, show centered take photo button
    if (!hasPhotos || !activeProjectId) {
      return (
        <View style={styles.emptyStateContainer}>
          <TouchableOpacity
            style={styles.addPhotoItem}
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
            <Text style={styles.addPhotoIcon}>
              {rooms.find((r) => r.id === currentRoom)?.icon || '📷'}
            </Text>
            <Text style={styles.addPhotoText}>
              {!activeProjectId ? t('home.selectProject') : t('camera.takePhoto')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Add before photos
    beforePhotos.forEach((beforePhoto, index) => {
      const afterPhoto = afterPhotos.find(
        (p) => p.beforePhotoId === beforePhoto.id
      );

      if (afterPhoto) {
        // Check if combined photo exists
        const combinedPhoto = combinedPhotos.find(
          (p) => p.name === beforePhoto.name
        );

        // Use dynamic base image URI if available, fallback to combined photo URI
        const thumbnailUri = combinedBaseUris[beforePhoto.name] || combinedPhoto?.uri;

        if (thumbnailUri) {
          // Show the combined image - with Retake and Preview buttons
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
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.thumbnailButton}
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
                  <Text style={styles.thumbnailButtonText}>{t('home.retake')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.thumbnailButton}
                  onPress={() => {
                    if (!isSwiping.current) {
                      handleDoubleTap(combinedPhoto, beforePhoto, afterPhoto);
                    }
                  }}
                >
                  <Text style={styles.thumbnailButtonText}>{t('home.preview')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        } else {
          // Has after photo but no combined yet - show split preview, tap to retake after
          const phoneOrientation = beforePhoto.orientation || 'portrait';
          const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
          
          // A photo is "letterbox" if the phone is portrait but the camera view was landscape.
          const isLetterbox = beforePhoto.templateType === 'letterbox' || (phoneOrientation === 'portrait' && cameraViewMode === 'landscape');
          // A photo is "true landscape" if the phone itself was held horizontally.
          const isTrueLandscape = phoneOrientation === 'landscape';
          const isLetterboxLandscape = isLetterbox && isTrueLandscape;

          // For thumbnails: landscape letterbox uses stack, portrait letterbox uses side-by-side
          const useStackedLayout = isTrueLandscape && !isLetterbox ? true : isLetterboxLandscape;

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
                    // First tap - wait for potential second tap
                    lastTap.current = now;
                    setTimeout(() => {
                      if (tapCount.current === 1 && lastTap.current) {
                        // Single tap confirmed
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
                    // Double tap confirmed
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
              <View style={styles.photoOverlay}>
                <Text style={styles.photoName}>
                  {cleaningServiceEnabled
                    ? `${t(`rooms.${currentRoom}`, { lng: sectionLanguage, defaultValue: currentRoom })} ${index + 1}`
                    : `${t('settings.section', { lng: sectionLanguage })} ${index + 1}`}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }
      } else {
        // Show before photo only - waiting for after
        gridItems.push(
          <View
            key={beforePhoto.id}
            style={[styles.photoItem, styles.photoItemPending]}
          >
            <CroppedThumbnail
              imageUri={beforePhoto.uri}
              aspectRatio={beforePhoto.aspectRatio || '4:3'}
              orientation={beforePhoto.orientation || 'portrait'}
              size={PHOTO_SIZE}
            />
            <View style={styles.thumbnailButtonsOverlay}>
              <TouchableOpacity
                style={styles.thumbnailButton}
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
                <Text style={styles.thumbnailButtonText}>{t('home.takeAfter')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.thumbnailButton}
                onPress={() => {
                  if (!isSwiping.current) {
                    handleDoubleTap(beforePhoto);
                  }
                }}
              >
                <Text style={styles.thumbnailButtonText}>{t('home.preview')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
    });

    // Add "Take Photo" card
    gridItems.push(
      <TouchableOpacity
        key="add-photo"
        style={styles.addPhotoItem}
        delayPressIn={100}
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
        <Text style={styles.addPhotoIcon}>
          {rooms.find((r) => r.id === currentRoom)?.icon || '📷'}
        </Text>
        <Text style={styles.addPhotoText}>{t('camera.takePhoto')}</Text>
      </TouchableOpacity>
    );

    return <View style={styles.photoGrid}>{gridItems}</View>;
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Upload Status - Removed old indicator */}

      <View style={styles.header}>
        <View style={styles.headerLeft}>
            <Text style={styles.appName}>ProofPix</Text>
            <Text style={styles.tierName}>({userPlan === 'Team Member' || userPlan === 'team' ? 'team' : userPlan.charAt(0).toUpperCase() + userPlan.slice(1)})</Text>
        </View>
        <View style={styles.headerRight}>
            <TouchableOpacity style={styles.iconButton} onPress={() => setOpenProjectVisible(true)}>
                <Text style={styles.iconText}>📤</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Gallery', { openManage: true })}>
                <Text style={styles.iconText}>🗂️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
                <Text style={styles.iconText}>⚙️</Text>
            </TouchableOpacity>
        </View>
      </View>

      {/* Active project name (tiny line under header) with inline edit */}
      <View style={styles.projectNameContainer}>
        {(() => {
          const activeProject = projects.find(p => p.id === activeProjectId);
          const displayName = activeProject?.name || t('projects.noProjects');

          if (!activeProject) {
            return (
              <Text style={styles.projectNameText}>
                {displayName}
              </Text>
            );
          }

          if (isEditingProjectName) {
            return (
              <View style={styles.projectEditRow}>
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
                <TouchableOpacity
                  style={styles.projectEditIconButton}
                  onPress={async () => {
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
                >
                  <Text style={styles.projectEditIconText}>✓</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.projectEditIconButton}
                  onPress={() => {
                    setIsEditingProjectName(false);
                    setEditedProjectName('');
                  }}
                >
                  <Text style={styles.projectEditIconText}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          }

          return (
            <View style={styles.projectNameRow}>
              <Text style={styles.projectNameText} numberOfLines={1}>
                {displayName}
              </Text>
              <TouchableOpacity
                style={styles.projectEditIconButton}
                onPress={() => {
                  setEditedProjectName(displayName);
                  setIsEditingProjectName(true);
                }}
              >
                <Text style={styles.projectEditIconText}>✏️</Text>
              </TouchableOpacity>
            </View>
          );
        })()}
        <UploadIndicatorLine 
          uploadStatus={uploadStatus}
          onPress={() => {
            // Navigate to GalleryScreen to show upload details
            navigation.navigate('Gallery', { showUploadDetails: true });
          }}
        />
      </View>

      {renderRoomTabs()}

      <View style={styles.content} {...panResponder.panHandlers}>
        <ScrollView>
          {renderPhotoGrid()}
        </ScrollView>
      </View>

      {/* Manage Projects button - always visible */}
      <TouchableOpacity
        style={[styles.allPhotosButtonBottom, { backgroundColor: '#F2C31B' }]}
        onPress={() => setOpenProjectVisible(true)}
      >
        <Text style={[styles.allPhotosButtonText, { color: '#000' }]}>{t('home.manageProjects')}</Text>
      </TouchableOpacity>

      {/* Full-screen photo view - single photo */}
      {fullScreenPhoto && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          <TouchableWithoutFeedback onPress={handleLongPressEnd}>
            <Image
              source={{ uri: fullScreenPhoto.uri }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
          </TouchableWithoutFeedback>
          {/* Delete button - top right */}
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
            <Text style={styles.fullScreenDeleteIcon}>🗑️</Text>
          </TouchableOpacity>
          {fullScreenPhotos.length > 1 && (
            <View style={styles.fullScreenNavigation}>
              <Text style={styles.fullScreenCounter}>
                {fullScreenIndex + 1} / {fullScreenPhotos.length}
              </Text>
            </View>
          )}
          {/* Bottom action buttons */}
          <View style={styles.fullScreenBottomButtons}>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
              onPress={handleLongPressEnd}
            >
              <Text style={styles.fullScreenActionButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
              onPress={() => {
                handleLongPressEnd();
                navigation.navigate('Camera', {
                  mode: fullScreenPhoto.mode === 'before' ? 'after' : 'before',
                  beforePhoto: fullScreenPhoto.mode === 'before' ? fullScreenPhoto : null,
                  room: currentRoom
                });
              }}
            >
              <Text style={styles.fullScreenActionButtonText}>{t('home.retake')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Full-screen combined photo view - 1:1 square with before/after */}
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
          {/* Labels toggle - centered above photo */}
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
          {/* Delete button - top right */}
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
            <Text style={styles.fullScreenDeleteIcon}>🗑️</Text>
          </TouchableOpacity>
          {fullScreenPhotos.length > 1 && (
            <View style={styles.fullScreenNavigation}>
              <Text style={styles.fullScreenCounter}>
                {fullScreenIndex + 1} / {fullScreenPhotos.length}
              </Text>
            </View>
          )}
          {/* Bottom action buttons */}
          <View style={styles.fullScreenBottomButtons}>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
              onPress={handleLongPressEnd}
            >
              <Text style={styles.fullScreenActionButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenActionButton}
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
                <ActivityIndicator size="small" color={COLORS.TEXT} />
              ) : (
                <Text style={styles.fullScreenActionButtonText}>{t('gallery.share')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Manage Projects Modal */}
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
                  <Text style={[
                    styles.actionBtnText,
                    { color: selectedProjects.size > 0 ? '#CC0000' : '#999' }
                  ]}>
                    🗑️ {t('home.deleteSelected')} ({selectedProjects.size})
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
                  <Text style={[styles.actionBtnText, { color: '#999' }]}>
                    🗑️ {t('home.deleteSelected')} (0)
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
      {/* New Project Naming Modal */}
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

      {/* Custom Context Menu */}
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
          // 
          saveCustomRooms(rooms);
          
          // If we were editing a specific room, stay on that room after saving
          if (contextMenuRoom) {
            // 
            setCurrentRoom(contextMenuRoom.id);
          }
          
          setShowRoomEditor(false);
          setContextMenuRoom(null);
          setRoomEditorMode('customize');
        }}
        initialRooms={customRooms}
        editRoom={contextMenuRoom}
        mode={roomEditorMode}
      />

      {/* Plan Selection Modal */}
      <Modal
        visible={showPlanModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          handlePlanModalClose();
        }}
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
                    await updateUserPlan('starter');
                    handlePlanModalClose();
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
                    await updateUserPlan('pro');
                    handlePlanModalClose();
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
                    await updateUserPlan('business');
                    handlePlanModalClose();
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
                    // If reopening delete confirm, don't do it here since we're going to enterprise modal
                    if (reopenDeleteConfirmRef.current) {
                      reopenDeleteConfirmRef.current = false;
                    }
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

      {/* Enterprise Contact Form Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

      {/* Delete Selected Projects Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showDeleteProjectsConfirm}
        title={t('projects.deleteProjects')}
        message={showDeleteProjectsConfirm ? (() => {
          // Use ref to get selected projects (stored when modal opened)
          const selectedIds = Array.from(selectedProjectsForDeleteRef.current);
          const projectNames = selectedIds.map(id => 
            projects.find(p => p.id === id)?.name
          ).filter(Boolean);
          return t('projects.deleteProjectsConfirm', { count: selectedIds.length, names: projectNames.join(', ') });
        })() : ''}
        onConfirm={handleDeleteSelectedProjectsConfirmed}
        onCancel={() => {
          setShowDeleteProjectsConfirm(false);
          selectedProjectsForDeleteRef.current = new Set(); // Clear ref on cancel
          // Reopen manage projects modal if it was open before
          setTimeout(() => {
            setOpenProjectVisible(true);
          }, 100);
        }}
        deleteFromStorageDefault={true}
        userPlan={userPlan}
        onShowPlanModal={() => {
          // Show plan modal on top of delete confirmation (don't close delete confirmation)
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
    backgroundColor: COLORS.BACKGROUND
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
    width: width
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  tierName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.GRAY,
    marginLeft: 8,
    alignSelf: 'flex-end',
    paddingBottom: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  iconText: {
    fontSize: 20
  },
  title: {
    fontSize: FONTS.XXLARGE,
    fontWeight: FONTS.BOLD,
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT
  },
  projectNameContainer: {
    paddingHorizontal: 20,
    marginTop: -6,
    marginBottom: 6
  },
  projectNameText: {
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '500',
    flexShrink: 1,
  },
  projectNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  projectEditIconButton: {
    marginLeft: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  projectEditIconText: {
    fontSize: 14,
    color: COLORS.GRAY,
  },
  projectEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  projectNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  allPhotosButtonBottom: {
    backgroundColor: COLORS.PRIMARY,
    marginHorizontal: 20,
    marginBottom: 20,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  allPhotosButtonText: {
    color: COLORS.TEXT,
    fontWeight: 'bold',
    fontSize: 16
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center'
  },
  settingsButtonText: {
    fontSize: 20
  },
  roomTabsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    maxHeight: 80
  },
  roomTab: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    borderRadius: 12,
    backgroundColor: 'white',
    minWidth: 60,
    minHeight: 60
  },
  roomTabActive: {
    backgroundColor: COLORS.PRIMARY
  },
  roomIcon: {
    fontSize: 24,
    marginBottom: 4
  },
  roomTabText: {
    fontSize: 12,
    color: COLORS.GRAY
  },
  roomTabTextActive: {
    color: COLORS.TEXT,
    fontWeight: '600'
  },
  content: {
    flex: 1,
    padding: 20
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
    borderWidth: 1,
    borderColor: COLORS.BORDER
  },
  photoItemPending: {
    borderWidth: 3,
    borderColor: COLORS.PRIMARY
  },
  photoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover'
  },
  photoOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8
  },
  thumbnailButtonsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  thumbnailButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 80,
    alignItems: 'center',
  },
  thumbnailButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: '600',
  },
  photoName: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  pendingText: {
    color: COLORS.PRIMARY,
    fontSize: 10,
    marginTop: 4
  },
  retakeButton: {
    marginTop: 6,
    backgroundColor: COLORS.PRIMARY,
    padding: 4,
    borderRadius: 6,
    alignItems: 'center'
  },
  retakeButtonText: {
    color: COLORS.TEXT,
    fontSize: 10,
    fontWeight: 'bold'
  },
  addPhotoItem: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    marginBottom: 16,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
    borderWidth: 2,
    borderColor: '#ccc',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center'
  },
  addPhotoIcon: {
    fontSize: 48,
    marginBottom: 8
  },
  addPhotoText: {
    color: COLORS.GRAY,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center'
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: '33%'
  },
  splitPreview: {
    width: '100%',
    height: '100%',
    position: 'relative'
  },
  stackedPreview: {
    flexDirection: 'column',
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.PRIMARY
  },
  sideBySidePreview: {
    flexDirection: 'row',
    borderLeftWidth: 2,
    borderLeftColor: COLORS.PRIMARY,
    borderRightWidth: 2,
    borderRightColor: COLORS.PRIMARY
  },
  halfPreviewImage: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.PRIMARY
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
    left: 0,
    right: 0,
    alignItems: 'center',
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
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
  },
  fullScreenHint: {
    color: 'white',
    fontSize: 12,
    marginTop: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4
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
    color: COLORS.TEXT,
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
  fullScreenDeleteIcon: {
    fontSize: 24
  },
  fullScreenBottomButtons: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    color: COLORS.TEXT,
    fontSize: 18,
    fontWeight: 'bold'
  },
  // Open Project modal styles
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
    color: COLORS.TEXT,
    marginBottom: 12,
    textAlign: 'center'
  },
  projectList: {
    maxHeight: 280
  },
  projectItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F7F7F7',
    marginBottom: 8
  },
  projectItemContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  checkbox: {
    width: 20,
    height: 20,
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
    color: COLORS.TEXT,
    fontSize: 16,
    fontWeight: '500'
  },
  actionBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  actionBtnText: {
    color: COLORS.TEXT,
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
    shadowOffset: {
      width: 0,
      height: 2,
    },
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
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  contextMenuTextDanger: {
    color: '#FF4444',
  },
  // Plan Modal Styles
  planModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
    zIndex: 10001,
    elevation: 10001
  },
  planModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
    zIndex: 10002,
    elevation: 10002
  },
  planModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER
  },
  planModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT
  },
  planModalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  planModalCloseText: {
    fontSize: 24,
    color: COLORS.GRAY
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
    borderColor: COLORS.PRIMARY
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.PRIMARY
  },
  planButtonTextSelected: {
    color: '#000000'
  },
  planSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10
  },
});

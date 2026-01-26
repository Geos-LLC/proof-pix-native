import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Dimensions,
  Alert,
  PanResponder,
  Modal,
  ActivityIndicator,
  Switch,
  TextInput,
  Share as RNShare,
  Platform,
  PixelRatio,
  InteractionManager
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { PHOTO_MODES, ROOMS, TEMPLATE_CONFIGS, TEMPLATE_TYPES } from '../constants/rooms';
import { RoomIcon } from '../utils/roomIcons';
import { CroppedThumbnail } from '../components/CroppedThumbnail';
import PhotoLabel from '../components/PhotoLabel';
import { uploadPhotoBatch, createAlbumName } from '../services/uploadService';
import { getLocationConfig } from '../config/locations';
import googleDriveService from '../services/googleDriveService';
import googleAuthService from '../services/googleAuthService';
import dropboxAuthService from '../services/dropboxAuthService';
import dropboxService from '../services/dropboxService';
import { uploadPhotoBatchToDropbox } from '../services/dropboxUploadService';
import { captureRef } from 'react-native-view-shot';
import { addLabelToImage, compositeImages, calculateAfterLabelOffsets } from '../utils/imageCompositor';
import * as FileSystem from 'expo-file-system/legacy';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import { UploadDetailsModal } from '../components/BackgroundUploadStatus';
import UploadIndicatorLine from '../components/UploadIndicatorLine';
import UploadCompletionModal from '../components/UploadCompletionModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { filterNewPhotos, markPhotosAsUploaded } from '../services/uploadTracker';
import Share from 'react-native-share';
import JSZip from 'jszip';
import { useTranslation } from 'react-i18next';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import {
  calculateSettingsHash,
  getCachedLabeledPhoto,
  saveCachedLabeledPhoto,
  updateCacheLastUsed,
  getCacheDir,
  cleanupOldCache,
  invalidateCache,
} from '../services/labelCacheService';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';

const COLORS = {
  BACKGROUND: '#F8F8F8',
  PRIMARY: '#F2C31B',
  TEXT: '#000000',
  GRAY: '#666666',
  BORDER: '#E0E0E0'
};

const { width } = Dimensions.get('window');
const CONTAINER_PADDING = 32;
const PHOTO_SPACING = 16;
const AVAILABLE_WIDTH = width - CONTAINER_PADDING - PHOTO_SPACING;
const COLUMN_WIDTH = AVAILABLE_WIDTH / 3;

export default function GalleryScreen({ navigation, route }) {
  const { t } = useTranslation();
  const {
    photos,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    deleteAllPhotos,
    deletePhoto,
    createProject,
    assignPhotosToProject,
    activeProjectId,
    deleteProject,
    setActiveProject,
    projects,
  } = usePhotos();
  
  const {
    userName,
    location,
    useFolderStructure,
    enabledFolders,
    showLabels,
    shouldShowWatermark,
    beforeLabelPosition,
    afterLabelPosition,
    combinedLabelPosition,
    labelMarginVertical,
    labelMarginHorizontal,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelFontFamily,
    userPlan,
    labelLanguage,
    sectionLanguage,
    cleaningServiceEnabled,
    getRooms,
    updateUserPlan,
  } = useSettings();
  
  const { canUse } = useFeaturePermissions();
  const { userMode, teamInfo, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType } = useAdmin();
  const { uploadStatus, startBackgroundUpload, cancelUpload, cancelAllUploads, clearCompletedUploads } = useBackgroundUpload();
  
  // State management
  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(null);
  const labelCaptureRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [photoFilter, setPhotoFilter] = useState('all');
  
  const tapCountRef = useRef({});
  const lastTapRef = useRef({});
  const originalSelectionStateRef = useRef({});
  const toggleTimeoutRef = useRef({});
  const pendingTogglesRef = useRef(new Set());
  const isSelectionModeRef = useRef(false);
  
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const uploadControllersRef = useRef([]);
  const masterAbortRef = useRef(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [manageVisible, setManageVisible] = useState(false);
  const [shareOptionsVisible, setShareOptionsVisible] = useState(false);
  const [uploadSelectedPhotos, setUploadSelectedPhotos] = useState(null);
  const [shareSelectedPhotos, setShareSelectedPhotos] = useState(null);
  const [deleteFromStorage, setDeleteFromStorage] = useState(true);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState({ before: true, after: true, combined: true });
  const [selectedShareTypes, setSelectedShareTypes] = useState({ before: true, after: true, combined: true });
  const [shareAsArchive, setShareAsArchive] = useState(false);
  const [uploadDestinations, setUploadDestinations] = useState({ google: true, dropbox: false });
  const [showAdvancedShareFormats, setShowAdvancedShareFormats] = useState(true);
  const [showSharePlanModal, setShowSharePlanModal] = useState(false);
  const [isDropboxConnected, setIsDropboxConnected] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState(() => {
    const initial = {};
    Object.keys(TEMPLATE_CONFIGS).forEach((key) => {
      initial[key] = false;
    });
    return initial;
  });
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [showAdvancedFormats, setShowAdvancedFormats] = useState(false);
  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);
  const [renderingCombined, setRenderingCombined] = useState(false);
  const [renderingProgress, setRenderingProgress] = useState({ current: 0, total: 0 });
  const [currentRenderPair, setCurrentRenderPair] = useState(null);
  const [currentRenderTemplate, setCurrentRenderTemplate] = useState(null);
  const renderViewRef = useRef(null);
  const combinedCaptureRef = useRef(null);
  const [showUploadDetails, setShowUploadDetails] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showUploadAlertModal, setShowUploadAlertModal] = useState(false);
  const [uploadAlertConfig, setUploadAlertConfig] = useState(null);

  // Effects
  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode;
  }, [isSelectionMode]);

  useEffect(() => {
    if (route?.params?.showUploadDetails) {
      setShowUploadDetails(true);
      navigation.setParams({ showUploadDetails: undefined });
    }
  }, [route?.params?.showUploadDetails, navigation]);

  useEffect(() => {
    if (uploadStatus.completedUploads && uploadStatus.completedUploads.length > 0) {
      setShowCompletionModal(true);
    }
  }, [uploadStatus.completedUploads]);

  useEffect(() => {
    if (optionsVisible) {
      dropboxAuthService.loadStoredTokens().then(() => {
        const isDropboxAuth = dropboxAuthService.isAuthenticated();
        setIsDropboxConnected(isDropboxAuth);
        
        setUploadDestinations({
          google: isAuthenticated,
          dropbox: isDropboxAuth
        });
      }).catch(err => {
        console.error('[GALLERY] Error loading Dropbox tokens:', err);
        setIsDropboxConnected(false);
        setUploadDestinations({
          google: isAuthenticated,
          dropbox: false
        });
      });
    }
  }, [optionsVisible, isAuthenticated]);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        try {
          await cleanupOldCache(30);
        } catch (error) {
          console.error('[GALLERY] Error cleaning up cache:', error);
        }
      })();
    }, [])
  );

  useEffect(() => {
    const settingsHash = calculateSettingsHash({
      showLabels,
      beforeLabelPosition,
      afterLabelPosition,
      labelBackgroundColor,
      labelTextColor,
      labelSize,
      labelFontFamily,
      labelMarginVertical,
      labelMarginHorizontal,
    });

    (async () => {
      try {
        await invalidateCache(settingsHash);
      } catch (error) {
        console.error('[GALLERY] Error invalidating cache:', error);
      }
    })();
  }, [showLabels, beforeLabelPosition, afterLabelPosition, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily, labelMarginVertical, labelMarginHorizontal]);

  useFocusEffect(
    React.useCallback(() => {
      if (route?.params?.openManage) {
        const timer = setTimeout(() => {
          setManageVisible(true);
          navigation.setParams({ openManage: undefined });
        }, 120);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [route?.params?.openManage])
  );

  // Handler functions
  const handleFormatToggle = (key) => {
    if (!canUse(FEATURES.ADVANCED_TEMPLATES)) {
      setShowSharePlanModal(true);
      return;
    }
    setSelectedFormats(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLongPressStart = (photo, photoSet = null) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      
      const currentMode = isSelectionMode;
      if (currentMode) {
        if (photo) {
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (newSet.has(photo.id)) {
              newSet.delete(photo.id);
            } else {
              newSet.add(photo.id);
            }
            return newSet;
          });
        } else if (photoSet && photoSet.before) {
          const combinedId = `combined_${photoSet.before.id}`;
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (newSet.has(combinedId)) {
              newSet.delete(combinedId);
            } else {
              newSet.add(combinedId);
            }
            return newSet;
          });
        }
      } else {
        isSelectionModeRef.current = true;
        setIsSelectionMode(true);
        if (photo) {
          setSelectedPhotos(new Set([photo.id]));
        } else if (photoSet && photoSet.before) {
          const combinedId = `combined_${photoSet.before.id}`;
          setSelectedPhotos(new Set([combinedId]));
        }
      }
    }, 300);
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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dy } = gestureState;
        return dy > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dy } = gestureState;
        const threshold = 100;
        
        if (dy > threshold) {
          navigation.goBack();
        }
      }
    })
  ).current;

  const shareIndividualPhoto = async (photo) => {
    try {
      setSharing(true);
      
      const tempFileName = `${photo.room}_${photo.name}_${photo.mode}_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: photo.uri, to: tempUri });

      const shareOptions = {
        title: `${photo.mode === 'before' ? 'Before' : 'After'} Photo - ${photo.name}`,
        message: `Check out this ${photo.mode} photo from ${photo.room}!`,
        url: tempUri,
        type: 'image/jpeg'
      };

      const result = await RNShare.share(shareOptions);
      
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.log('[GALLERY] Cleanup error:', cleanupError);
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  const shareCombinedPhoto = async (photoSet) => {
    try {
      setSharing(true);
      
      const capturedUri = await captureRef(combinedCaptureRef, {
        format: 'jpg',
        quality: 0.95
      });
      
      const tempFileName = `${photoSet.room}_${photoSet.name}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: capturedUri, to: tempUri });

      const shareOptions = {
        title: `Before/After - ${photoSet.name}`,
        message: `Check out this before/after comparison from ${photoSet.room}!`,
        url: tempUri,
        type: 'image/jpeg'
      };

      const result = await RNShare.share(shareOptions);
      
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.log('[GALLERY] Cleanup error:', cleanupError);
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  const startSharingWithOptions = async () => {
    try {
      setSharing(true);
      setShareOptionsVisible(false);
      
      let sourcePhotos;
      if (shareSelectedPhotos) {
        sourcePhotos = shareSelectedPhotos.individual;
      } else {
        sourcePhotos = activeProjectId 
          ? photos.filter(p => p.projectId === activeProjectId) 
          : photos;
      }

      const photosToShare = [];
      
      if (selectedShareTypes.before) {
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before');
        photosToShare.push(...beforePhotos);
      }
      
      if (selectedShareTypes.after) {
        const afterPhotos = sourcePhotos.filter(p => p.mode === 'after');
        photosToShare.push(...afterPhotos);
      }
      
      if (selectedShareTypes.combined) {
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before');
        for (const beforePhoto of beforePhotos) {
          const afterPhoto = sourcePhotos.find(
            p => p.mode === 'after' && p.beforePhotoId === beforePhoto.id
          );
          if (afterPhoto) {
            photosToShare.push({ type: 'combined', before: beforePhoto, after: afterPhoto });
          }
        }
      }

      if (photosToShare.length === 0) {
        Alert.alert('No Photos', 'Please select at least one photo type to share.');
        setSharing(false);
        return;
      }

      if (shareAsArchive) {
        const zip = new JSZip();
        
        for (let i = 0; i < photosToShare.length; i++) {
          const photo = photosToShare[i];
          let fileName, fileUri;
          
          if (photo.type === 'combined') {
            fileName = `${photo.before.room}_${photo.before.name}_combined.jpg`;
            continue;
          } else {
            fileName = `${photo.room}_${photo.name}_${photo.mode}.jpg`;
            fileUri = photo.uri;
          }
          
          const fileData = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          zip.file(fileName, fileData, { base64: true });
        }
        
        const zipContent = await zip.generateAsync({ type: 'base64' });
        const zipFileName = `photos_${Date.now()}.zip`;
        const zipUri = `${FileSystem.cacheDirectory}${zipFileName}`;
        
        await FileSystem.writeAsStringAsync(zipUri, zipContent, {
          encoding: FileSystem.EncodingType.Base64,
        });

        await Share.open({
          url: `file://${zipUri}`,
          type: 'application/zip',
          filename: zipFileName,
        });

        await FileSystem.deleteAsync(zipUri, { idempotent: true });
      } else {
        const urls = [];
        for (const photo of photosToShare) {
          if (photo.type !== 'combined') {
            urls.push(photo.uri);
          }
        }
        
        if (urls.length > 0) {
          await Share.open({
            urls: urls,
            type: 'image/jpeg',
          });
        }
      }
    } catch (error) {
      console.error('[GALLERY] Share error:', error);
      if (error.message !== 'User did not share') {
        Alert.alert('Share Error', 'Failed to share photos. Please try again.');
      }
    } finally {
      setSharing(false);
      setShareSelectedPhotos(null);
    }
  };

  const handleShareProject = async () => {
    let sourcePhotos;
    if (shareSelectedPhotos) {
      sourcePhotos = shareSelectedPhotos.individual;
      setShareSelectedPhotos(null);
    } else {
      sourcePhotos = activeProjectId ? photos.filter(p => p.projectId === activeProjectId) : photos;
    }
    
    if (sourcePhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosInProject'));
      return;
    }
    setShareOptionsVisible(true);
  };

  const handleSharePlanModalClose = () => {
    setShowSharePlanModal(false);
  };

  const handleDeleteAllConfirmed = async (deleteFromStorageParam) => {
    try {
      const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : deleteFromStorage;
      if (activeProjectId) {
        await deleteProject(activeProjectId, { deleteFromStorage: shouldDeleteFromStorage });
        setActiveProject(null);
      } else {
        await deleteAllPhotos();
      }
    } finally {
      setConfirmDeleteVisible(false);
      setShowDeleteAllConfirm(false);
    }
  };

  const getSelectedPhotos = () => {
    const selected = [];
    if (!getRooms || typeof getRooms !== 'function') {
      return selected;
    }
    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      return selected;
    }
    
    rooms.forEach(room => {
      const sets = getPhotoSets(room.id);
      sets.forEach(set => {
        if (set.before && selectedPhotos.has(set.before.id)) {
          selected.push(set.before);
        }
        if (set.after && selectedPhotos.has(set.after.id)) {
          selected.push(set.after);
        }
      });
    });
    
    return selected;
  };

  const getSelectedPhotoSets = () => {
    const selected = [];
    if (!getRooms || typeof getRooms !== 'function') {
      return selected;
    }
    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      return selected;
    }
    
    rooms.forEach(room => {
      const sets = getPhotoSets(room.id);
      sets.forEach(set => {
        const combinedId = `combined_${set.before?.id}`;
        if (selectedPhotos.has(combinedId)) {
          selected.push(set);
        }
      });
    });
    
    return selected;
  };

  const handleUploadSelected = async () => {
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    
    if (selected.length === 0 && selectedSets.length === 0) {
      Alert.alert('No Selection', 'Please select photos to upload.');
      return;
    }

    setUploadSelectedPhotos({ individual: selected, sets: selectedSets });
    setOptionsVisible(true);
  };

  const handleShareSelected = async () => {
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    
    if (selected.length === 0 && selectedSets.length === 0) {
      Alert.alert('No Selection', 'Please select photos to share.');
      return;
    }

    setShareSelectedPhotos({ individual: selected, sets: selectedSets });
    handleShareProject();
  };

  const handleDeleteSelected = () => {
    if (selectedPhotos.size === 0) {
      Alert.alert('No Selection', 'Please select photos to delete.');
      return;
    }
    setShowDeleteSelectedConfirm(true);
  };

  const handleDeleteSelectedConfirmed = async (deleteFromStorageParam) => {
    try {
      const photosToDelete = getSelectedPhotos();
      
      for (const photo of photosToDelete) {
        await deletePhoto(photo.id);
      }
      
      setSelectedPhotos(new Set());
      isSelectionModeRef.current = false;
      setIsSelectionMode(false);
    } catch (error) {
      console.error('[GALLERY] Delete error:', error);
      Alert.alert('Error', 'Failed to delete photos. Please try again.');
    } finally {
      setShowDeleteSelectedConfirm(false);
    }
  };

  const getPhotoSets = (roomId) => {
    const beforePhotos = getBeforePhotos(roomId);
    const afterPhotos = getAfterPhotos(roomId);

    const sets = {};

    beforePhotos.forEach(photo => {
      sets[photo.id] = {
        name: photo.name,
        room: photo.room,
        before: photo,
        after: null,
        combined: null
      };
    });

    afterPhotos.forEach(photo => {
      if (photo.beforePhotoId && sets[photo.beforePhotoId]) {
        sets[photo.beforePhotoId].after = photo;
      }
    });

    return Object.values(sets);
  };

  const renderDummyCard = (label) => (
    <View style={styles.dummyCard}>
      <Text style={styles.dummyCardText}>{label}</Text>
    </View>
  );

  const renderPhotoCard = (photo, borderColor, photoType, photoSet, isLast, currentSelectionMode, currentSelectedPhotos) => {
    if (photoType === 'combined' && !photo && photoSet.before && photoSet.after) {
      const phoneOrientation = photoSet.before.orientation || 'portrait';
      const cameraViewMode = photoSet.before.cameraViewMode || 'portrait';
      
      const isLetterbox = photoSet.before.templateType === 'letterbox' || (phoneOrientation === 'portrait' && cameraViewMode === 'landscape');
      const isTrueLandscape = phoneOrientation === 'landscape';
      const isLetterboxLandscape = isLetterbox && isTrueLandscape;

      const useStackedLayout = isTrueLandscape && !isLetterbox ? true : isLetterboxLandscape;

      const combinedId = `combined_${photoSet.before.id}`;
      const isSelected = currentSelectionMode && currentSelectedPhotos.has(combinedId);

      const handleCombinedPress = () => {
        const inSelectionMode = isSelectionModeRef.current || isSelectionMode || currentSelectionMode;
        
        if (!inSelectionMode && longPressTriggered.current) return;
        
        if (inSelectionMode) {
          const photoKey = combinedId;
          const now = Date.now();
          const DOUBLE_TAP_DELAY = 300;
          
          if (tapCountRef.current[photoKey] && (now - lastTapRef.current[photoKey]) < DOUBLE_TAP_DELAY) {
            if (toggleTimeoutRef.current[photoKey]) {
              clearTimeout(toggleTimeoutRef.current[photoKey]);
              delete toggleTimeoutRef.current[photoKey];
            }
            
            const wasOriginallySelected = originalSelectionStateRef.current[photoKey];
            setSelectedPhotos(prev => {
              const newSet = new Set(prev);
              if (wasOriginallySelected) {
                newSet.add(combinedId);
              } else {
                newSet.delete(combinedId);
              }
              return newSet;
            });
            
            const restoredSelected = new Set(currentSelectedPhotos);
            if (wasOriginallySelected) {
              restoredSelected.add(combinedId);
            } else {
              restoredSelected.delete(combinedId);
            }
            
            tapCountRef.current[photoKey] = 0;
            lastTapRef.current[photoKey] = 0;
            delete originalSelectionStateRef.current[photoKey];
            
            const selectedSets = getSelectedPhotoSets();
            
            navigation.navigate('PhotoEditor', {
              beforePhoto: photoSet.before,
              afterPhoto: photoSet.after,
              isSelectionMode: isSelectionModeRef.current || isSelectionMode,
              selectedPhotos: Array.from(restoredSelected),
              allPhotoSets: selectedSets,
              onSelectionChange: (newSelectedPhotos) => {
                setSelectedPhotos(new Set(newSelectedPhotos));
              }
            });
            return;
          }
          
          const wasOriginallySelected = currentSelectedPhotos.has(combinedId);
          originalSelectionStateRef.current[photoKey] = wasOriginallySelected;
          
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (newSet.has(combinedId)) {
              newSet.delete(combinedId);
            } else {
              newSet.add(combinedId);
            }
            return newSet;
          });
          
          tapCountRef.current[photoKey] = 1;
          lastTapRef.current[photoKey] = now;
          
          toggleTimeoutRef.current[photoKey] = setTimeout(() => {
            tapCountRef.current[photoKey] = 0;
            lastTapRef.current[photoKey] = 0;
            delete originalSelectionStateRef.current[photoKey];
            delete toggleTimeoutRef.current[photoKey];
          }, DOUBLE_TAP_DELAY);
          return;
        }
        
        navigation.navigate('PhotoEditor', {
          beforePhoto: photoSet.before,
          afterPhoto: photoSet.after
        });
      };

      return (
        <TouchableOpacity
          style={[
            styles.photoCard, 
            styles.photoCardCombined,
            isLast && styles.photoCardLast, 
            isSelected && styles.photoCardSelected
          ]}
          onPress={handleCombinedPress}
          onLongPress={() => handleLongPressStart(null, photoSet)}
        >
          <View style={[styles.combinedThumbnail, useStackedLayout ? styles.stackedThumbnail : styles.sideBySideThumbnail]}>
            <Image source={{ uri: photoSet.before.uri }} style={styles.halfImage} resizeMode="cover" />
            <View style={{
              position: 'absolute',
              [useStackedLayout ? 'top' : 'left']: '50%',
              [useStackedLayout ? 'left' : 'top']: 0,
              [useStackedLayout ? 'right' : 'bottom']: 0,
              [useStackedLayout ? 'height' : 'width']: 2,
              backgroundColor: COLORS.PRIMARY,
              zIndex: 1
            }} />
            <Image source={{ uri: photoSet.after.uri }} style={styles.halfImage} resizeMode="cover" />
          </View>
          
          {currentSelectionMode && (
            <View style={[styles.photoCheckboxContainer, styles.photoCheckboxGrid, isSelected && styles.photoCheckboxSelected]}>
              {isSelected && (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              )}
            </View>
          )}
          
          <View style={[styles.modeLabel, styles.modeLabelCombined]}>
            <Text style={styles.modeLabelText}>COMBINED</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (!photo) return <View style={[styles.photoCard, isLast && styles.photoCardLast]}>{renderDummyCard('—')}</View>;

    const isSelected = currentSelectionMode && currentSelectedPhotos.has(photo.id);

    const handlePress = () => {
      const inSelectionMode = isSelectionModeRef.current || isSelectionMode || currentSelectionMode;
      
      if (!inSelectionMode && longPressTriggered.current) return;
      
      if (inSelectionMode) {
        const photoKey = photo.id;
        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300;
        
        if (tapCountRef.current[photoKey] && (now - lastTapRef.current[photoKey]) < DOUBLE_TAP_DELAY) {
          if (toggleTimeoutRef.current[photoKey]) {
            clearTimeout(toggleTimeoutRef.current[photoKey]);
            delete toggleTimeoutRef.current[photoKey];
          }
          
          const wasOriginallySelected = originalSelectionStateRef.current[photoKey];
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (wasOriginallySelected) {
              newSet.add(photo.id);
            } else {
              newSet.delete(photo.id);
            }
            return newSet;
          });
          
          const restoredSelected = new Set(currentSelectedPhotos);
          if (wasOriginallySelected) {
            restoredSelected.add(photo.id);
          } else {
            restoredSelected.delete(photo.id);
          }
          
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          
          if (photoType === 'combined') {
            const selectedSets = getSelectedPhotoSets();
            navigation.navigate('PhotoEditor', {
              beforePhoto: photoSet.before,
              afterPhoto: photoSet.after,
              isSelectionMode: isSelectionModeRef.current || isSelectionMode,
              selectedPhotos: Array.from(restoredSelected),
              allPhotoSets: selectedSets,
              onSelectionChange: (newSelectedPhotos) => {
                setSelectedPhotos(new Set(newSelectedPhotos));
              }
            });
          } else {
            const selected = getSelectedPhotos();
            navigation.navigate('PhotoDetail', { 
              photo,
              isSelectionMode: isSelectionModeRef.current || isSelectionMode,
              selectedPhotos: Array.from(restoredSelected),
              allPhotos: selected,
              onSelectionChange: (newSelectedPhotos) => {
                setSelectedPhotos(new Set(newSelectedPhotos));
              }
            });
          }
          return;
        }
        
        const wasOriginallySelected = currentSelectedPhotos.has(photo.id);
        originalSelectionStateRef.current[photoKey] = wasOriginallySelected;
        
        setSelectedPhotos(prev => {
          const newSet = new Set(prev);
          if (newSet.has(photo.id)) {
            newSet.delete(photo.id);
          } else {
            newSet.add(photo.id);
          }
          return newSet;
        });
        
        tapCountRef.current[photoKey] = 1;
        lastTapRef.current[photoKey] = now;
        
        toggleTimeoutRef.current[photoKey] = setTimeout(() => {
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          delete toggleTimeoutRef.current[photoKey];
        }, DOUBLE_TAP_DELAY);
        return;
      }
      
      if (photoType === 'combined') {
        navigation.navigate('PhotoEditor', {
          beforePhoto: photoSet.before,
          afterPhoto: photoSet.after,
          isSelectionMode: false,
          selectedPhotos: [],
          onSelectionChange: () => {}
        });
      } else {
        navigation.navigate('PhotoDetail', { 
          photo,
          isSelectionMode: false,
          selectedPhotos: [],
          onSelectionChange: () => {}
        });
      }
    };

    return (
      <TouchableOpacity
        style={[styles.photoCard, isLast && styles.photoCardLast, isSelected && styles.photoCardSelected]}
        onPress={handlePress}
        onLongPress={() => handleLongPressStart(photo, photoType === 'combined' ? photoSet : null)}
      >
        <CroppedThumbnail
          imageUri={photo.uri}
          aspectRatio={photo.aspectRatio || photoSet.before?.aspectRatio || '4:3'}
          orientation={photo.orientation || photoSet.before?.orientation || 'portrait'}
          size={COLUMN_WIDTH}
        />
        
        {currentSelectionMode && (
          <View style={[styles.photoCheckboxContainer, styles.photoCheckboxGrid, isSelected && styles.photoCheckboxSelected]}>
            {isSelected && (
              <Ionicons name="checkmark" size={16} color="#FFFFFF" />
            )}
          </View>
        )}
        
        <View style={styles.modeLabel}>
          <Text style={styles.modeLabelText}>
            {photoType === 'before' ? 'BEFORE' : photoType === 'after' ? 'AFTER' : 'COMBINED'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPhotoSet = (set, index, roomId) => {
    const showBefore = photoFilter === 'all' || photoFilter === 'before';
    const showAfter = photoFilter === 'all' || photoFilter === 'after';
    const showCombined = photoFilter === 'all' || photoFilter === 'combined';
    
    return (
      <View key={index} style={styles.photoSetRow}>
        <View style={styles.threeColumnRow}>
          {showBefore && renderPhotoCard(set.before, '#4CAF50', 'before', set, false, isSelectionMode, selectedPhotos)}
          {showAfter && renderPhotoCard(set.after, '#2196F3', 'after', set, false, isSelectionMode, selectedPhotos)}
          {showCombined && renderPhotoCard(set.combined, COLORS.PRIMARY, 'combined', set, true, isSelectionMode, selectedPhotos)}
        </View>
      </View>
    );
  };

  const renderFilteredPhotos = (photos, photoType, borderColor) => {
    const photosPerRow = 3;
    const rows = [];
    
    for (let i = 0; i < photos.length; i += photosPerRow) {
      const rowPhotos = photos.slice(i, i + photosPerRow);
      rows.push(
        <View key={i} style={styles.photoSetRow}>
          <View style={styles.threeColumnRow}>
            {rowPhotos.map((photo, idx) => {
              const photoSet = photo.photoSet || { before: photo, after: null, combined: null };
              const isLast = idx === rowPhotos.length - 1;
              const photoToRender = photoType === 'combined' ? null : photo;
              const uniqueKey = photoType === 'combined' ? `combined_${photoSet.before?.id || idx}` : (photo.id || `photo_${idx}`);
              return (
                <View key={uniqueKey}>
                  {renderPhotoCard(photoToRender, borderColor, photoType, photoSet, isLast, isSelectionMode, selectedPhotos)}
                </View>
              );
            })}
            {rowPhotos.length < photosPerRow && Array.from({ length: photosPerRow - rowPhotos.length }).map((_, idx) => (
              <View key={`empty-${idx}`} style={{ width: COLUMN_WIDTH, marginRight: 8 }} />
            ))}
          </View>
        </View>
      );
    }
    
    return rows;
  };

  const renderRoomSection = (room) => {
    let sets = getPhotoSets(room.id);
    
    if (showOnlySelected) {
      const selectedThumbnails = [];
      
      sets.forEach(set => {
        const combinedId = `combined_${set.before?.id}`;
        
        if (set.before && selectedPhotos.has(set.before.id)) {
          selectedThumbnails.push({
            ...set.before,
            photoSet: set,
            photoType: 'before',
            borderColor: '#4CAF50'
          });
        }
        
        if (set.after && selectedPhotos.has(set.after.id)) {
          selectedThumbnails.push({
            ...set.after,
            photoSet: set,
            photoType: 'after',
            borderColor: '#2196F3'
          });
        }
        
        if (set.before && set.after && selectedPhotos.has(combinedId)) {
          selectedThumbnails.push({
            id: combinedId,
            uri: null,
            photoSet: set,
            photoType: 'combined',
            borderColor: COLORS.PRIMARY
          });
        }
      });
      
      if (selectedThumbnails.length === 0) return null;
      
      const photosPerRow = 3;
      const rows = [];
      
      for (let i = 0; i < selectedThumbnails.length; i += photosPerRow) {
        const rowPhotos = selectedThumbnails.slice(i, i + photosPerRow);
        rows.push(
          <View key={i} style={styles.photoSetRow}>
            <View style={styles.threeColumnRow}>
              {rowPhotos.map((item, idx) => {
                const isLast = idx === rowPhotos.length - 1;
                const photoToRender = item.photoType === 'combined' ? null : item;
                const uniqueKey = item.photoType === 'combined' 
                  ? `combined_${item.photoSet.before?.id || idx}` 
                  : (item.id || `photo_${i}_${idx}`);
                return (
                  <View key={uniqueKey}>
                    {renderPhotoCard(photoToRender, item.borderColor, item.photoType, item.photoSet, isLast, isSelectionMode, selectedPhotos)}
                  </View>
                );
              })}
              {rowPhotos.length < photosPerRow && Array.from({ length: photosPerRow - rowPhotos.length }).map((_, idx) => (
                <View key={`empty-${idx}`} style={{ width: COLUMN_WIDTH, marginRight: 8 }} />
              ))}
            </View>
          </View>
        );
      }
      
      return (
        <View key={room.id} style={styles.roomSection}>
          <View style={styles.roomHeader}>
            <RoomIcon roomId={room.id} size={24} color={COLORS.TEXT} style={{ marginRight: 8 }} />
            <Text style={styles.roomName}>
              {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
            </Text>
          </View>
          {rows}
        </View>
      );
    }
    
    if (sets.length === 0) return null;

    if (photoFilter === 'before' || photoFilter === 'after' || photoFilter === 'combined') {
      let filteredPhotos = [];
      let borderColor = '#4CAF50';
      let photoType = 'before';
      
      if (photoFilter === 'before') {
        filteredPhotos = sets.filter(set => set.before).map(set => ({ ...set.before, photoSet: set }));
        borderColor = '#4CAF50';
        photoType = 'before';
      } else if (photoFilter === 'after') {
        filteredPhotos = sets.filter(set => set.after).map(set => ({ ...set.after, photoSet: set }));
        borderColor = '#2196F3';
        photoType = 'after';
      } else if (photoFilter === 'combined') {
        filteredPhotos = sets.filter(set => set.before && set.after).map(set => ({ 
          id: `combined_${set.before.id}`,
          uri: null,
          photoSet: set 
        }));
        borderColor = COLORS.PRIMARY;
        photoType = 'combined';
      }
      
      if (filteredPhotos.length === 0) return null;
      
      return (
        <View key={room.id} style={styles.roomSection}>
          <View style={styles.roomHeader}>
            <RoomIcon roomId={room.id} size={24} color={COLORS.TEXT} style={{ marginRight: 8 }} />
            <Text style={styles.roomName}>
              {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
            </Text>
          </View>
          {renderFilteredPhotos(filteredPhotos, photoType, borderColor)}
        </View>
      );
    }

    return (
      <View key={room.id} style={styles.roomSection}>
        <View style={styles.roomHeader}>
          <RoomIcon roomId={room.id} size={24} color={COLORS.TEXT} style={{ marginRight: 8 }} />
          <Text style={styles.roomName}>
            {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
          </Text>
        </View>
        {sets.map((set, index) => renderPhotoSet(set, index, room.id))}
      </View>
    );
  };

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <View style={styles.header}>
        {isSelectionMode ? (
          <>
            <Text style={styles.selectionCountText}>
              {selectedPhotos.size} {t('gallery.selected', { defaultValue: 'Selected' })}
            </Text>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                isSelectionModeRef.current = false;
                setIsSelectionMode(false);
                setSelectedPhotos(new Set());
                setShowOnlySelected(false);
                if (longPressTimer.current) {
                  clearTimeout(longPressTimer.current);
                  longPressTimer.current = null;
                }
                longPressTriggered.current = false;
              }}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>{t('gallery.title')}</Text>
            <TouchableOpacity
              style={styles.selectButton}
              activeOpacity={0.7}
              onPress={() => {
                isSelectionModeRef.current = true;
                setIsSelectionMode(true);
              }}
            >
              <Text style={styles.selectButtonText}>{t('gallery.selectPhotos')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'all' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('all')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'all' && styles.filterButtonTextActive]}>
            {t('common.all', { lng: labelLanguage, defaultValue: 'All' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'before' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('before')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'before' && styles.filterButtonTextActive]}>
            {t('camera.before', { lng: labelLanguage })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'after' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('after')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'after' && styles.filterButtonTextActive]}>
            {t('camera.after', { lng: labelLanguage })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'combined' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('combined')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'combined' && styles.filterButtonTextActive]}>
            {t('camera.combined', { lng: labelLanguage })}
          </Text>
        </TouchableOpacity>
      </View>

      {activeProjectId && (() => {
        const activeProject = projects?.find?.(p => p.id === activeProjectId);
        const rooms = getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS;
        const firstRoomWithPhotos = rooms.find(room => {
          const sets = getPhotoSets(room.id);
          return sets.length > 0;
        });
        
        return (
          <View style={styles.projectRoomContainer}>
            <View style={styles.projectRoomInfo}>
              <Text style={styles.projectNameDisplay}>
                {activeProject?.name || t('gallery.noProjectSelected')}
              </Text>
              {firstRoomWithPhotos && (
                <Text style={styles.roomNameDisplay}>
                  {t(`rooms.${firstRoomWithPhotos.id}`, { lng: sectionLanguage, defaultValue: firstRoomWithPhotos.name })}
                </Text>
              )}
            </View>
            {isSelectionMode && selectedPhotos.size > 0 && (
              <View style={styles.actionIconsContainer}>
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={handleDeleteSelected}
                >
                  <Ionicons name="trash-outline" size={22} color="#333" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={handleShareSelected}
                >
                  <Ionicons name="paper-plane-outline" size={22} color="#333" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={handleUploadSelected}
                >
                  <Ionicons name="cloud-upload-outline" size={22} color="#333" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })()}

      {photos.length === 0 || !activeProjectId ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            {!activeProjectId ? t('gallery.noProjectSelected') : t('gallery.noPhotosYet')}
          </Text>
          <Text style={styles.emptyStateSubtext}>
            {!activeProjectId 
              ? t('gallery.selectProjectToView')
              : t('gallery.takePhotosToStart')
            }
          </Text>
        </View>
      ) : (
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={[styles.content, { paddingBottom: 120 }]}
        >
          {(getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS).map(room => renderRoomSection(room))}
        </ScrollView>
      )}

      {!isSelectionMode && (
        <>
          <View style={styles.bottomNavPill}>
            <TouchableOpacity 
              style={styles.navItem}
              onPress={() => navigation.navigate('Home')}
            >
              <Ionicons name="home-outline" size={24} color="#666666" />
              <Text style={styles.navItemText}>Home</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.navItem}
              onPress={() => navigation.navigate('Projects')}
            >
              <Ionicons name="folder-outline" size={24} color="#666666" />
              <Text style={styles.navItemText}>Projects</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.navItem, styles.navItemActive]}
            >
              <Ionicons name="images" size={24} color="#000000" />
              <Text style={[styles.navItemText, styles.navItemTextActive]}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.navItem}
              onPress={() => navigation.navigate('Settings')}
            >
              <Ionicons name="settings-outline" size={24} color="#666666" />
              <Text style={styles.navItemText}>Settings</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.floatingAddButton}
            onPress={() => {
              if (!activeProjectId) return;
              navigation.navigate('Camera', {
                mode: 'before',
                room: (getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS)[0]?.id
              });
            }}
          >
            <Ionicons name="add" size={36} color="#000000" />
          </TouchableOpacity>
        </>
      )}

      {isSelectionMode && selectedPhotos.size > 0 && (
        <View style={styles.floatingActionButtons}>
          <TouchableOpacity
            style={[styles.floatingActionButton, styles.floatingActionButtonTrash]}
            onPress={handleDeleteSelected}
          >
            <Ionicons name="trash-outline" size={22} color="#666666" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingActionButton, styles.floatingActionButtonShare]}
            onPress={handleShareSelected}
          >
            <Ionicons name="paper-plane" size={20} color="#000" />
            <Text style={styles.floatingActionButtonText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingActionButton, styles.floatingActionButtonUpload]}
            onPress={handleUploadSelected}
          >
            <Ionicons name="cloud-upload" size={20} color="#FFFFFF" />
            <Text style={[styles.floatingActionButtonText, styles.floatingActionButtonTextWhite]}>Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatingActionButton, styles.floatingActionButtonClose]}
            onPress={() => {
              isSelectionModeRef.current = false;
              setIsSelectionMode(false);
              setSelectedPhotos(new Set());
              setShowOnlySelected(false);
            }}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* MODALS START HERE */}
      <Modal
        visible={shareOptionsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShareOptionsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShareOptionsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.shareModalContent}>
                <View style={styles.modalHeader}>
                  <TouchableOpacity 
                    onPress={() => setShareOptionsVisible(false)}
                    style={styles.closeButton}
                  >
                    <Ionicons name="close" size={32} color="#333" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Choose Shared Formats</Text>
                </View>
                <View style={styles.modalHandle} />

                <ScrollView 
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.sectionTitle}>Photo types</Text>
                <View style={styles.photoTypeButtons}>
                  <TouchableOpacity
                    style={[styles.typeButton, selectedShareTypes.before && styles.typeButtonActive]}
                    onPress={() => setSelectedShareTypes(prev => ({ ...prev, before: !prev.before }))}
                  >
                    <Text style={[styles.typeButtonText, selectedShareTypes.before && styles.typeButtonTextActive]}>
                      Before
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, selectedShareTypes.after && styles.typeButtonActive]}
                    onPress={() => setSelectedShareTypes(prev => ({ ...prev, after: !prev.after }))}
                  >
                    <Text style={[styles.typeButtonText, selectedShareTypes.after && styles.typeButtonTextActive]}>
                      After
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, selectedShareTypes.combined && styles.typeButtonActive]}
                    onPress={() => setSelectedShareTypes(prev => ({ ...prev, combined: !prev.combined }))}
                  >
                    <Text style={[styles.typeButtonText, selectedShareTypes.combined && styles.typeButtonTextActive]}>
                      Combined
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.advancedOptionsHeader}
                  onPress={() => setShowAdvancedShareFormats(!showAdvancedShareFormats)}
                >
                  <Text style={styles.sectionTitle}>Advance Options</Text>
                  <Ionicons 
                    name={showAdvancedShareFormats ? "chevron-up" : "chevron-down"} 
                    size={20} 
                    color="#666" 
                  />
                </TouchableOpacity>

                {showAdvancedShareFormats && (
                  <>
                    <Text style={styles.subsectionTitle}>Stacked formats</Text>
                    <View style={styles.formatButtons}>
                      {[TEMPLATE_TYPES.STACK_PORTRAIT, TEMPLATE_TYPES.STACK_LANDSCAPE, TEMPLATE_TYPES.SQUARE_STACK].map((key) => {
                        const config = TEMPLATE_CONFIGS[key];
                        if (!config) return null;
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.formatButton, selectedFormats[key] && styles.formatButtonActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.formatButtonText, selectedFormats[key] && styles.formatButtonTextActive]}>
                              {config.name || key}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.subsectionTitle}>Side-by-side formats</Text>
                    <View style={styles.formatButtons}>
                      {[TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE, TEMPLATE_TYPES.SIDE_BY_SIDE_WIDE, TEMPLATE_TYPES.BLOG_FORMAT, TEMPLATE_TYPES.SQUARE_SIDE].map((key) => {
                        const config = TEMPLATE_CONFIGS[key];
                        if (!config) return null;
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.formatButton, selectedFormats[key] && styles.formatButtonActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.formatButtonText, selectedFormats[key] && styles.formatButtonTextActive]}>
                              {config.name || key}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                <View style={styles.archiveToggleContainer}>
                  <Switch
                    value={shareAsArchive}
                    onValueChange={setShareAsArchive}
                    trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
                    thumbColor={shareAsArchive ? '#FFFFFF' : '#FFFFFF'}
                    ios_backgroundColor="#E0E0E0"
                  />
                  <Text style={styles.archiveToggleText}>Share as archive (zip)</Text>
                </View>
                </ScrollView>

                <TouchableOpacity
                  style={styles.shareNowButton}
                  onPress={startSharingWithOptions}
                >
                  <Text style={styles.shareNowButtonText}>Share Now</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {showUploadDetails && (
        <UploadDetailsModal
          visible={showUploadDetails}
          onClose={() => setShowUploadDetails(false)}
          uploadStatus={uploadStatus}
          onCancelUpload={cancelUpload}
          onCancelAll={cancelAllUploads}
        />
      )}

      {showCompletionModal && (
        <UploadCompletionModal
          visible={showCompletionModal}
          completedUploads={uploadStatus.completedUploads || []}
          onClose={() => {
            setShowCompletionModal(false);
            clearCompletedUploads();
          }}
        />
      )}

      {showDeleteSelectedConfirm && (
        <DeleteConfirmationModal
          visible={showDeleteSelectedConfirm}
          onClose={() => setShowDeleteSelectedConfirm(false)}
          onConfirm={handleDeleteSelectedConfirmed}
          photoCount={selectedPhotos.size}
          deleteFromStorage={deleteFromStorage}
          setDeleteFromStorage={setDeleteFromStorage}
        />
      )}

      <Modal
        visible={showSharePlanModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleSharePlanModalClose}
      >
        <TouchableWithoutFeedback onPress={handleSharePlanModalClose}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.upgradeModalContent}>
                <Ionicons name="lock-closed" size={48} color={COLORS.PRIMARY} style={{ marginBottom: 16 }} />
                <Text style={styles.upgradeTitle}>Premium Feature</Text>
                <Text style={styles.upgradeMessage}>
                  Advanced templates are available in the Pro plan. Upgrade to unlock all formats and features!
                </Text>
                <TouchableOpacity
                  style={styles.upgradeButton}
                  onPress={() => {
                    handleSharePlanModalClose();
                    navigation.navigate('Settings');
                  }}
                >
                  <Text style={styles.upgradeButtonText}>View Plans</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.upgradeCancelButton}
                  onPress={handleSharePlanModalClose}
                >
                  <Text style={styles.upgradeCancelButtonText}>Maybe Later</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {(sharing || uploading) && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.PRIMARY} />
        <Text style={styles.loadingText}>
          {sharing ? 'Preparing to share...' : 'Uploading...'}
        </Text>
      </View>
    </View>
  )}
</View>
);
}
const styles = StyleSheet.create({
container: {
flex: 1,
backgroundColor: COLORS.BACKGROUND,
paddingTop: 50
},
header: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
paddingHorizontal: 20,
paddingTop: 16,
paddingBottom: 16,
backgroundColor: 'white'
},
title: {
fontSize: 34,
fontWeight: '700',
color: COLORS.TEXT,
letterSpacing: -0.5
},
selectionCountText: {
fontSize: 34,
fontWeight: '700',
color: COLORS.TEXT,
letterSpacing: -0.5
},
cancelButton: {
paddingHorizontal: 12,
paddingVertical: 6
},
cancelButtonText: {
color: COLORS.PRIMARY,
fontSize: 16,
fontWeight: '600'
},
selectButton: {
paddingHorizontal: 20,
paddingVertical: 10,
borderRadius: 22,
backgroundColor: '#F0F0F0',
alignItems: 'center',
borderWidth: 0
},
selectButtonText: {
color: COLORS.TEXT,
fontSize: 16,
fontWeight: '600'
},
filterContainer: {
flexDirection: 'row',
alignItems: 'center',
backgroundColor: 'white',
paddingVertical: 16,
paddingHorizontal: 20,
gap: 10
},
filterButton: {
paddingVertical: 10,
paddingHorizontal: 20,
borderRadius: 24,
backgroundColor: '#F0F0F0',
alignItems: 'center',
justifyContent: 'center',
borderWidth: 0,
minWidth: 80
},
filterButtonActive: {
backgroundColor: COLORS.PRIMARY,
borderColor: 'transparent'
},
filterButtonText: {
fontSize: 16,
fontWeight: '600',
color: '#000000'
},
filterButtonTextActive: {
color: '#000000',
fontWeight: '700'
},
projectRoomContainer: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
paddingHorizontal: 20,
paddingVertical: 16,
backgroundColor: 'white',
borderBottomWidth: 1,
borderBottomColor: '#F0F0F0'
},
projectRoomInfo: {
flex: 1
},
projectNameDisplay: {
fontSize: 22,
fontWeight: '700',
color: COLORS.TEXT,
marginBottom: 4
},
roomNameDisplay: {
fontSize: 16,
fontWeight: '600',
color: COLORS.TEXT,
opacity: 0.6
},
actionIconsContainer: {
flexDirection: 'row',
alignItems: 'center',
gap: 16
},
actionIconButton: {
padding: 8
},
floatingActionButtons: {
position: 'absolute',
bottom: 20,
left: 20,
right: 20,
flexDirection: 'row',
alignItems: 'center',
justifyContent: 'center',
gap: 12,
zIndex: 1000,
elevation: 1000
},
floatingActionButton: {
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: '#333333',
  justifyContent: 'center',
  alignItems: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  elevation: 5
},
floatingActionButtonTrash: {
  backgroundColor: '#FFFFFF',
  borderWidth: 0,
},
floatingActionButtonClose: {
  backgroundColor: '#FF4444',
  width: 48,
  height: 48,
},
floatingActionButtonShare: {
flexDirection: 'row',
width: 'auto',
minWidth: 100,
paddingHorizontal: 20,
borderRadius: 24,
backgroundColor: COLORS.PRIMARY,
gap: 8
},
floatingActionButtonUpload: {
flexDirection: 'row',
width: 'auto',
minWidth: 100,
paddingHorizontal: 20,
borderRadius: 24,
backgroundColor: '#000000',
gap: 8
},
floatingActionButtonText: {
color: '#000',
fontSize: 14,
fontWeight: '700'
},
floatingActionButtonTextWhite: {
color: '#FFFFFF'
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
zIndex: 90
},
navItem: {
flex: 1,
alignItems: 'center',
justifyContent: 'center',
paddingVertical: 10,
borderRadius: 20
},
navItemActive: {
backgroundColor: '#F0F0F0'
},
navItemText: {
fontSize: 11,
fontWeight: '500',
color: '#666666',
marginTop: 4
},
navItemTextActive: {
color: '#000000',
fontWeight: '600'
},
floatingAddButton: {
position: 'absolute',
bottom: 100,
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
shadowRadius: 12,
elevation: 10,
zIndex: 95
},
scrollView: {
flex: 1
},
content: {
padding: 16
},
roomSection: {
marginBottom: 24
},
roomHeader: {
flexDirection: 'row',
alignItems: 'center',
marginBottom: 12,
paddingBottom: 8,
borderBottomWidth: 2,
borderBottomColor: COLORS.PRIMARY
},
roomName: {
fontSize: 18,
fontWeight: 'bold',
color: COLORS.TEXT
},
photoSetRow: {
flexDirection: 'row',
alignItems: 'center',
marginBottom: 12
},
threeColumnRow: {
flex: 1,
flexDirection: 'row',
flexWrap: 'nowrap'
},
photoCard: {
width: COLUMN_WIDTH,
height: COLUMN_WIDTH,
borderRadius: 16,
borderWidth: 0,
overflow: 'hidden',
shadowColor: '#000',
shadowOffset: { width: 0, height: 2 },
shadowOpacity: 0.08,
shadowRadius: 8,
elevation: 3,
backgroundColor: 'white',
marginRight: 8,
position: 'relative'
},
photoCardCombined: {
borderWidth: 0,
borderColor: 'transparent'
},
photoCardLast: {
marginRight: 0
},
photoCardSelected: {
opacity: 1,
borderWidth: 3,
borderColor: COLORS.PRIMARY
},
cardImage: {
width: '100%',
height: '100%',
resizeMode: 'cover'
},
combinedThumbnail: {
width: '100%',
height: '100%',
position: 'relative'
},
stackedThumbnail: {
flexDirection: 'column'
},
sideBySideThumbnail: {
flexDirection: 'row'
},
halfImage: {
flex: 1
},
modeLabel: {
position: 'absolute',
bottom: 8,
left: 8,
right: 8,
paddingVertical: 8,
paddingHorizontal: 10,
alignItems: 'center',
justifyContent: 'center',
backgroundColor: 'rgba(0, 0, 0, 0.75)',
borderRadius: 8
},
modeLabelCombined: {
backgroundColor: COLORS.PRIMARY
},
modeLabelText: {
color: '#FFFFFF',
fontSize: 12,
fontWeight: '700',
letterSpacing: 0.5,
textTransform: 'uppercase'
},
photoCheckboxContainer: {
width: 30,
height: 30,
borderRadius: 15,
backgroundColor: 'rgba(255, 255, 255, 0.9)',
borderWidth: 2,
borderColor: '#000000',
justifyContent: 'center',
alignItems: 'center',
overflow: 'hidden'
},
photoCheckboxGrid: {
position: 'absolute',
top: 8,
right: 8,
zIndex: 10
},
photoCheckboxSelected: {
backgroundColor: COLORS.PRIMARY,
borderColor: COLORS.PRIMARY
},
dummyCard: {
width: '100%',
height: '100%',
borderRadius: 8,
borderWidth: 2,
borderColor: COLORS.BORDER,
borderStyle: 'dashed',
backgroundColor: '#f5f5f5',
justifyContent: 'center',
alignItems: 'center'
},
dummyCardText: {
fontSize: 20,
color: COLORS.GRAY,
fontWeight: '300'
},
emptyState: {
flex: 1,
justifyContent: 'center',
alignItems: 'center',
padding: 40
},
emptyStateText: {
fontSize: 18,
fontWeight: '600',
color: COLORS.TEXT,
marginBottom: 8,
textAlign: 'center'
},
emptyStateSubtext: {
fontSize: 14,
color: COLORS.GRAY,
textAlign: 'center'
},
modalOverlay: {
flex: 1,
backgroundColor: 'rgba(0, 0, 0, 0.5)',
justifyContent: 'flex-end',
},
shareModalContent: {
  backgroundColor: 'white',
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  paddingHorizontal: 20,
  paddingBottom: 20,
  paddingTop: 8,
  maxHeight: '80%',
},
shareModalScroll: {
  maxHeight: 400,
},
shareModalScrollContent: {
  paddingBottom: 8,
},
modalHandle: {
  width: 40,
  height: 4,
  backgroundColor: '#E0E0E0',
  borderRadius: 2,
  alignSelf: 'center',
  marginTop: 8,
  marginBottom: 20,
},
modalHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: 8,
  position: 'relative',
},
closeButton: {
  position: 'absolute',
  left: 0,
  padding: 8,
  zIndex: 1,
},
modalTitle: {
  fontSize: 22,
  fontWeight: '700',
  color: COLORS.TEXT,
  flex: 1,
  textAlign: 'center',
},
sectionTitle: {
  fontSize: 18,
  fontWeight: '700',
  color: COLORS.TEXT,
  marginBottom: 12,
  marginTop: 0,
},
subsectionTitle: {
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.TEXT,
  marginBottom: 12,
  marginTop: 12,
},
photoTypeButtons: {
flexDirection: 'row',
gap: 10,
marginBottom: 16,
},
typeButton: {
  flex: 1,
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderRadius: 24,
  backgroundColor: '#F0F0F0',
  alignItems: 'center',
  borderWidth: 0,
  borderColor: 'transparent',
},
typeButtonActive: {
backgroundColor: COLORS.PRIMARY,
borderColor: COLORS.PRIMARY,
},
typeButtonText: {
fontSize: 15,
fontWeight: '600',
color: '#000',
},
typeButtonTextActive: {
color: '#000',
fontWeight: '700',
},
advancedOptionsHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 12,
  marginTop: 16,
  marginBottom: 4,
},
formatButtons: {
flexDirection: 'row',
flexWrap: 'wrap',
gap: 10,
marginBottom: 16,
},
formatButton: {
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 24,
  backgroundColor: '#F0F0F0',
  borderWidth: 0,
  borderColor: 'transparent',
},
formatButtonActive: {
backgroundColor: COLORS.PRIMARY,
borderColor: COLORS.PRIMARY,
},
formatButtonText: {
fontSize: 14,
fontWeight: '600',
color: '#000',
},
formatButtonTextActive: {
color: '#000',
fontWeight: '700',
},
archiveToggleContainer: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 16,
  borderTopWidth: 1,
  borderTopColor: '#F0F0F0',
  marginTop: 16,
  gap: 12,
},
archiveToggleText: {
  fontSize: 16,
  fontWeight: '600',
  color: COLORS.TEXT,
  flex: 1,
},
shareNowButton: {
  backgroundColor: '#000',
  paddingVertical: 18,
  borderRadius: 28,
  alignItems: 'center',
  marginTop: 24,
  width: '100%',
},
shareNowButtonText: {
  color: '#FFF',
  fontSize: 16,
  fontWeight: '700',
},
upgradeModalContent: {
backgroundColor: 'white',
borderRadius: 24,
padding: 32,
marginHorizontal: 20,
alignItems: 'center',
},
upgradeTitle: {
fontSize: 24,
fontWeight: '700',
color: COLORS.TEXT,
marginBottom: 12,
textAlign: 'center',
},
upgradeMessage: {
fontSize: 16,
color: COLORS.GRAY,
textAlign: 'center',
marginBottom: 24,
lineHeight: 22,
},
upgradeButton: {
backgroundColor: COLORS.PRIMARY,
paddingVertical: 16,
paddingHorizontal: 32,
borderRadius: 12,
width: '100%',
alignItems: 'center',
marginBottom: 12,
},
upgradeButtonText: {
color: '#000',
fontSize: 16,
fontWeight: '700',
},
upgradeCancelButton: {
paddingVertical: 12,
paddingHorizontal: 24,
},
upgradeCancelButtonText: {
color: COLORS.GRAY,
fontSize: 16,
fontWeight: '600',
},
loadingOverlay: {
position: 'absolute',
top: 0,
left: 0,
right: 0,
bottom: 0,
backgroundColor: 'rgba(0, 0, 0, 0.7)',
justifyContent: 'center',
alignItems: 'center',
zIndex: 9999,
},
loadingContainer: {
backgroundColor: 'white',
borderRadius: 16,
padding: 32,
alignItems: 'center',
minWidth: 200,
},
loadingText: {
marginTop: 16,
fontSize: 16,
fontWeight: '600',
color: COLORS.TEXT,
},
});
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
  Platform,
  InteractionManager
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import * as FileSystem from 'expo-file-system/legacy';
import { compositeImages, addLabelToImage, calculateAfterLabelOffsets } from '../utils/imageCompositor';
import { ensureLabelForPhoto } from '../services/labelService';
import { pickBeforeLabelPosition, pickAfterLabelPosition } from '../utils/labelPosition';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import { UploadDetailsModal } from '../components/BackgroundUploadStatus';
import UploadCompletionModal from '../components/UploadCompletionModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { filterNewPhotos, markPhotosAsUploaded } from '../services/uploadTracker';
import Constants from 'expo-constants';
import JSZip from 'jszip';
import { useTranslation } from 'react-i18next';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { logPhotoExport, logJobCompleted } from '../utils/analytics';

// Ensure a URI has the file:// prefix (expo FileSystem URIs already include it on Android)
const ensureFileUri = (uri) => uri.startsWith('file://') ? uri : `file://${uri}`;

import * as Sharing from 'expo-sharing';

// react-native-share for multi-file sharing (not available in Expo Go)
let RNShare = { open: async () => {} };
const isExpoGo = Constants?.appOwnership === 'expo';
if (!isExpoGo) {
  try {
    const shareModule = require('react-native-share');
    RNShare = shareModule.default || shareModule;
  } catch (e) {
    console.warn('[Gallery] Failed to load react-native-share:', e?.message);
  }
}

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
import { ensureShareAllowed, recordShare } from '../utils/shareRateLimit';
import { FEATURES } from '../constants/featurePermissions';
import { canExportNow, recordExport, logBlocked } from '../services/softTrialService';
import { PAYWALL_TRIGGERS, SOFT_TRIAL_LOW_RES_MAX_DIM, SOFT_TRIAL_QUALITY } from '../constants/softTrial';

const COLORS = {
  BACKGROUND: '#F6F8FA',
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

export default function GalleryScreen({ navigation, route }) {
  const { t } = useTranslation();
  const {
    photos,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    deleteAllPhotos,
    deletePhoto,
    deletePhotoSet,
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
    toggleLabels,
    shouldShowWatermark,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
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
    softTrialActive,
    refreshSoftTrial,
  } = useSettings();
  
  const insets = useSafeAreaInsets();
  const { canUse, effectivePlan } = useFeaturePermissions();
  const { userMode, teamInfo, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType } = useAdmin();
  const { uploadStatus, startBackgroundUpload, cancelUpload, cancelAllUploads, clearCompletedUploads } = useBackgroundUpload();
  
  // State management
  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null);
  const [fullScreenPhotos, setFullScreenPhotos] = useState([]);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [fullScreenLoading, setFullScreenLoading] = useState(false);
  const [fullScreenError, setFullScreenError] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const swipeStartX = useRef(null);
  const fullScreenCombinedRef = useRef(null);
  const fullScreenVisibleRef = useRef(false);
  const fullScreenPhotosRef = useRef([]);
  const fullScreenIndexRef = useRef(0);
  const handleSwipeRef = useRef(null);
  const handleCloseRef = useRef(null);
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
  const [showDeletePhotoConfirm, setShowDeletePhotoConfirm] = useState(false);
  const pendingDeletePhotoRef = useRef(null);
  const [selectedTypes, setSelectedTypes] = useState({ before: true, after: true, combined: true });
  const [selectedShareTypes, setSelectedShareTypes] = useState({ before: true, after: true, combined: true });
  const [shareAsArchive, setShareAsArchive] = useState(false);
  const [uploadDestinations, setUploadDestinations] = useState({ google: true, dropbox: false });
  const [showAdvancedShareFormats, setShowAdvancedShareFormats] = useState(false);
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
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);
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
    // Only show completion modal when upload details modal is NOT showing
    // This prevents the completion modal from popping up on top of the progress modal
    if (!showUploadDetails && uploadStatus.completedUploads && uploadStatus.completedUploads.length > 0) {
      setShowCompletionModal(true);
    }
  }, [uploadStatus.completedUploads, showUploadDetails]);

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

  // Keep refs in sync with state for PanResponder
  useEffect(() => {
    fullScreenPhotosRef.current = fullScreenPhotos;
  }, [fullScreenPhotos]);

  useEffect(() => {
    fullScreenIndexRef.current = fullScreenIndex;
  }, [fullScreenIndex]);

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
      beforeLabelPositionLandscape,
      afterLabelPositionLandscape,
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
  }, [showLabels, beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily, labelMarginVertical, labelMarginHorizontal]);

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
      Alert.alert(
        t('share.advancedFormatsTitle', { defaultValue: 'Paid feature' }),
        t('share.advancedFormatsMessage', { defaultValue: 'Advanced templates are available on the Pro plan. Upgrade to unlock all formats and side-by-side layouts.' }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          { text: t('share.upgradeCTA', { defaultValue: 'Upgrade to Pro' }), onPress: () => navigation.navigate('PlanSelection') },
        ]
      );
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
    setFullScreenPhotos([]);
    setFullScreenIndex(0);
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
        if (dy > threshold && !fullScreenVisibleRef.current) {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          }
        }
      }
    })
  ).current;

  const shareIndividualPhoto = async (photo) => {
    // Soft trial first: while active, free users get N exports without the
    // 24h cooldown. After the soft trial is consumed, the existing 24h
    // rate-limit applies again.
    if (effectivePlan === 'starter' && softTrialActive) {
      const gate = await canExportNow();
      if (!gate.allowed) {
        await logBlocked(gate.reason);
        navigation.navigate('PlanSelection', { trigger: PAYWALL_TRIGGERS.EXPORT_LIMIT });
        return;
      }
    } else {
      const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
      if (!allowed) return;
    }
    try {
      setSharing(true);

      // Apply label if labels are enabled
      let sourceUri = photo.uri;
      if (showLabels && (photo.mode === 'before' || photo.mode === 'after')) {
        try {
          const labeledUri = await ensureLabelForPhoto({
            ...photo,
            type: photo.mode,
          });
          if (labeledUri) sourceUri = labeledUri;
        } catch (labelErr) {
          console.warn('[GalleryScreen] Label application failed, using original:', labelErr);
        }
      }

      const tempFileName = `${photo.room}_${photo.name}_${photo.mode}_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: sourceUri, to: tempUri });

      await Sharing.shareAsync(ensureFileUri(tempUri), {
        mimeType: 'image/jpeg',
        dialogTitle: `${photo.mode === 'before' ? 'Before' : 'After'} Photo - ${photo.name}`,
      });
      if (effectivePlan === 'starter' && softTrialActive) {
        try { await recordExport(); await refreshSoftTrial(); } catch {}
      } else {
        await recordShare();
      }

      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.log('[GALLERY] Cleanup error:', cleanupError);
      }
    } catch (error) {
      if (error?.message !== 'User did not share') {
        Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
      }
    } finally {
      setSharing(false);
    }
  };

  const shareCombinedPhoto = async (photoSet) => {
    if (effectivePlan === 'starter' && softTrialActive) {
      const gate = await canExportNow();
      if (!gate.allowed) {
        await logBlocked(gate.reason);
        navigation.navigate('PlanSelection', { trigger: PAYWALL_TRIGGERS.EXPORT_LIMIT });
        return;
      }
    } else {
      const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
      if (!allowed) return;
    }
    try {
      setSharing(true);

      const capturedUri = await captureRef(combinedCaptureRef, softTrialActive
        ? { format: 'jpg', quality: SOFT_TRIAL_QUALITY, width: SOFT_TRIAL_LOW_RES_MAX_DIM, height: SOFT_TRIAL_LOW_RES_MAX_DIM }
        : { format: 'jpg', quality: 0.95 });
      
      const tempFileName = `${photoSet.room}_${photoSet.name}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: capturedUri, to: tempUri });

      await Sharing.shareAsync(ensureFileUri(tempUri), {
        mimeType: 'image/jpeg',
        dialogTitle: `Before/After - ${photoSet.name}`,
      });
      if (effectivePlan === 'starter' && softTrialActive) {
        try { await recordExport(); await refreshSoftTrial(); } catch {}
      } else {
        await recordShare();
      }

      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.log('[GALLERY] Cleanup error:', cleanupError);
      }
    } catch (error) {
      if (error?.message !== 'User did not share') {
        Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
      }
    } finally {
      setSharing(false);
    }
  };

  const shareFullScreenCombined = async () => {
    if (!fullScreenPhotoSet) return;
    if (effectivePlan === 'starter' && softTrialActive) {
      const gate = await canExportNow();
      if (!gate.allowed) {
        await logBlocked(gate.reason);
        navigation.navigate('PlanSelection', { trigger: PAYWALL_TRIGGERS.EXPORT_LIMIT });
        return;
      }
    } else {
      const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
      if (!allowed) return;
    }
    try {
      setSharing(true);
      let shareUri = null;

      const beforePhoto = fullScreenPhotoSet.before;
      const afterPhoto = fullScreenPhotoSet.after;

      if (beforePhoto?.uri && afterPhoto?.uri) {
        try {
          // Determine layout from stored metadata or aspect ratio
          const currentFullScreenPhoto = fullScreenPhotos[fullScreenIndex];
          const storedLayout = currentFullScreenPhoto?.combinedLayout;
          const isStack = storedLayout ? storedLayout === 'STACK' : isStackedLayout(currentFullScreenPhoto?.templateType, beforePhoto.aspectRatio);
          const layout = isStack ? 'STACK' : 'SIDE';

          // Get before image dimensions for 1:1 square calculation
          const getImageSize = (uri) => new Promise((resolve, reject) => {
            Image.getSize(uri, (w, h) => resolve({ w, h }), reject);
          });
          const bSize = await getImageSize(beforePhoto.uri);
          const squareSize = softTrialActive
            ? SOFT_TRIAL_LOW_RES_MAX_DIM
            : Math.min(Math.max(bSize.w, 2048), 4096);

          const dims = isStack
            ? { width: squareSize, height: squareSize, topH: Math.round(squareSize / 2), bottomH: squareSize - Math.round(squareSize / 2) }
            : { width: squareSize, height: squareSize, leftW: Math.round(squareSize / 2), rightW: squareSize - Math.round(squareSize / 2) };

          // Re-composite fresh 1:1 square
          const freshUri = await compositeImages(beforePhoto.uri, afterPhoto.uri, layout, dims);

          if (showLabels) {
            // Apply native labels
            const labelSizeMap = { small: 48, medium: 56, large: 64 };
            const fontSize = labelSizeMap[labelSize] || 56;
            const convertPos = (pos) => {
              const map = { 'top-left': 'left-top', 'top-right': 'right-top', 'bottom-left': 'left-bottom', 'bottom-right': 'right-bottom' };
              return map[pos] || pos || 'left-top';
            };
            const beforePos = convertPos(beforeLabelPosition || 'top-left');
            const afterPos = convertPos(afterLabelPosition || 'top-right');
            const baseLabelConfig = {
              backgroundColor: labelBackgroundColor || '#FFD700',
              textColor: labelTextColor || '#000000',
              fontSize,
              marginHorizontal: labelMarginHorizontal || 10,
              marginVertical: labelMarginVertical || 10,
              padding: 8,
            };

            // Apply Before label
            const withBeforeLabel = await addLabelToImage(freshUri, t('common.before') || 'BEFORE', {
              ...baseLabelConfig,
              position: beforePos,
            });

            // Calculate After label offsets for correct half positioning
            const halfW = Math.round(squareSize / 2);
            const halfH = Math.round(squareSize / 2);
            const { offsetX, offsetY } = calculateAfterLabelOffsets(afterPos, isStack, halfW, halfH, squareSize, squareSize);

            // Apply After label
            shareUri = await addLabelToImage(withBeforeLabel, t('common.after') || 'AFTER', {
              ...baseLabelConfig,
              position: afterPos,
              offsetX,
              offsetY,
            });
          } else {
            shareUri = freshUri;
          }
        } catch (compositeErr) {
          console.warn('[GalleryScreen] Re-composite failed, falling back to captureRef:', compositeErr);
          // Fallback to captureRef if native composite fails
          if (fullScreenCombinedRef.current) {
            shareUri = await captureRef(fullScreenCombinedRef, softTrialActive
              ? { format: 'jpg', quality: SOFT_TRIAL_QUALITY, width: SOFT_TRIAL_LOW_RES_MAX_DIM, height: SOFT_TRIAL_LOW_RES_MAX_DIM }
              : { format: 'jpg', quality: 0.95 });
          }
        }
      }

      if (!shareUri) {
        // Last resort fallback
        if (fullScreenCombinedRef.current) {
          shareUri = await captureRef(fullScreenCombinedRef, { format: 'jpg', quality: 0.95 });
        } else {
          throw new Error('No share URI available');
        }
      }

      const tempFileName = `${fullScreenPhotoSet.before.room}_${fullScreenPhotoSet.before.name}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: shareUri, to: tempUri });
      await Sharing.shareAsync(ensureFileUri(tempUri), {
        mimeType: 'image/jpeg',
        dialogTitle: `Before/After - ${fullScreenPhotoSet.before.name}`,
      });
      if (effectivePlan === 'starter' && softTrialActive) {
        try { await recordExport(); await refreshSoftTrial(); } catch {}
      } else {
        await recordShare();
      }
      const sourceType = fullScreenPhotoSet.before.sourceType || 'camera';
      const projectId = fullScreenPhotoSet.before.projectId || null;
      const timeTotal = fullScreenPhotoSet.before.timestamp ? Math.round((Date.now() - fullScreenPhotoSet.before.timestamp) / 1000) : null;
      logPhotoExport('share', sourceType, projectId);
      logJobCompleted(projectId, timeTotal, sourceType);
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) await FileSystem.deleteAsync(tempUri, { idempotent: true });
      } catch (_) {}
    } catch (error) {
      if (error?.message !== 'User did not share') {
        Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
      }
    } finally {
      setSharing(false);
    }
  };

  const startSharingWithOptions = async () => {
    const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
    if (!allowed) return;
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
        // Add combined photos directly from PhotoContext (already generated at capture time)
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before');
        for (const beforePhoto of beforePhotos) {
          const combinedPhoto = photos.find(p => p.mode === PHOTO_MODES.COMBINED && p.beforePhotoId === beforePhoto.id);
          if (combinedPhoto) {
            photosToShare.push(combinedPhoto);
          }
        }
      }

      if (photosToShare.length === 0) {
        Alert.alert('No Photos', 'Please select at least one photo type to share.');
        setSharing(false);
        return;
      }

      setShareStatus(t('gallery.preparingPhotos', { defaultValue: 'Preparing photos...' }));

      // Apply labels to photos before sharing (uses cached versions from background service)
      if (showLabels) {
        for (let i = 0; i < photosToShare.length; i++) {
          try {
            const photo = photosToShare[i];
            const photoWithType = { ...photo, type: photo.mode || photo.type };
            const labeledUri = await ensureLabelForPhoto(photoWithType);
            if (labeledUri && labeledUri !== photo.uri) {
              photosToShare[i] = { ...photo, uri: labeledUri };
            }
          } catch (e) {
            console.warn('[GALLERY] Label failed for share photo, using original:', e?.message);
          }
        }
      }

      if (shareAsArchive) {
        setShareStatus(t('gallery.zippingPhotos', { defaultValue: `Zipping ${photosToShare.length} photos...`, count: photosToShare.length }));
        const zip = new JSZip();
        
        for (let i = 0; i < photosToShare.length; i++) {
          const photo = photosToShare[i];
          let fileName, fileUri;
          
          fileName = `${photo.room}_${photo.name}_${photo.mode}.jpg`;
          fileUri = photo.uri;
          
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

        await Sharing.shareAsync(ensureFileUri(zipUri), {
          mimeType: 'application/zip',
          dialogTitle: zipFileName,
        });
        await recordShare();

        await FileSystem.deleteAsync(zipUri, { idempotent: true });
      } else {
        const urls = photosToShare.map(photo => photo.uri).filter(Boolean);

        if (urls.length === 1) {
          await Sharing.shareAsync(ensureFileUri(urls[0]), {
            mimeType: 'image/jpeg',
            dialogTitle: 'Share Photo',
          });
          await recordShare();
        } else if (urls.length > 1) {
          // Share multiple photos via react-native-share using temp file copies
          setShareStatus(t('gallery.preparingPhotos', { defaultValue: `Preparing ${urls.length} photos...`, count: urls.length }));
          const tempDir = `${FileSystem.cacheDirectory}share_temp_${Date.now()}/`;
          await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
          const tempUris = [];
          for (let i = 0; i < urls.length; i++) {
            const fileName = urls[i].split('/').pop() || `photo_${i}.jpg`;
            const tempPath = `${tempDir}${fileName}`;
            await FileSystem.copyAsync({ from: urls[i], to: tempPath });
            tempUris.push(ensureFileUri(tempPath));
          }
          await RNShare.open({
            urls: tempUris,
            type: 'image/jpeg',
            failOnCancel: false,
          });
          await recordShare();
          // Clean up temp files
          await FileSystem.deleteAsync(tempDir, { idempotent: true });
        }
      }
    } catch (error) {
      console.error('[GALLERY] Share error:', error);
      if (error.message !== 'User did not share') {
        Alert.alert('Share Error', 'Failed to share photos. Please try again.');
      }
    } finally {
      setSharing(false);
      setShareStatus('');
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
        // Navigate back after deleting the project
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        }
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

    // Check if any cloud service is connected before showing options
    let dropboxConnected = false;
    try {
      await dropboxAuthService.loadStoredTokens();
      dropboxConnected = dropboxAuthService.isAuthenticated();
    } catch (e) {
      // ignore
    }

    if (!isAuthenticated && !dropboxConnected) {
      Alert.alert(
        t('gallery.noConnectionTitle', { defaultValue: 'No Cloud Connected' }),
        t('gallery.noConnectionMessage', { defaultValue: 'Please connect Google Drive or Dropbox in Settings before uploading.' }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          { text: t('settings.goToSettings', { defaultValue: 'Go to Settings' }), onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
        ]
      );
      return;
    }

    setUploadSelectedPhotos({ individual: selected, sets: selectedSets });
    setOptionsVisible(true);
  };

  const handleConfirmUpload = async () => {
    try {
      // Gather photos to upload based on selected types
      let photosToUpload = [];
      const sourcePhotos = uploadSelectedPhotos?.individual || [];

      sourcePhotos.forEach(photo => {
        if (selectedTypes.before && photo.mode === 'before') {
          photosToUpload.push(
            useFolderStructure && !enabledFolders.before ? { ...photo, flatOverride: true } : photo
          );
        }
        if (selectedTypes.after && photo.mode === 'after') {
          photosToUpload.push(
            useFolderStructure && !enabledFolders.after ? { ...photo, flatOverride: true } : photo
          );
        }
      });

      // Also add photos from sets
      const sourceSets = uploadSelectedPhotos?.sets || [];
      sourceSets.forEach(set => {
        if (selectedTypes.before && set.before) {
          photosToUpload.push(
            useFolderStructure && !enabledFolders.before ? { ...set.before, flatOverride: true } : set.before
          );
        }
        if (selectedTypes.after && set.after) {
          photosToUpload.push(
            useFolderStructure && !enabledFolders.after ? { ...set.after, flatOverride: true } : set.after
          );
        }
      });

      // Add combined photos directly from PhotoContext (already generated at capture time)
      if (selectedTypes.combined) {
        // Collect all before photo IDs from selection
        const beforeIds = new Set();
        sourcePhotos.filter(p => p.mode === 'before').forEach(p => beforeIds.add(p.id));
        sourceSets.forEach(set => { if (set.before) beforeIds.add(set.before.id); });

        // Find combined photos by beforePhotoId — instant lookup, no filesystem scanning
        for (const beforeId of beforeIds) {
          const combinedPhoto = photos.find(p => p.mode === PHOTO_MODES.COMBINED && p.beforePhotoId === beforeId);
          if (combinedPhoto) {
            photosToUpload.push(
              useFolderStructure && !enabledFolders.combined ? { ...combinedPhoto, flatOverride: true } : combinedPhoto
            );
          }
        }
      }

      // Deduplicate by photo ID to prevent uploading the same photo twice
      const uniqueMap = new Map();
      photosToUpload.forEach(p => { if (!uniqueMap.has(p.id)) uniqueMap.set(p.id, p); });
      photosToUpload = Array.from(uniqueMap.values());

      if (photosToUpload.length === 0) {
        Alert.alert('No Photos', 'No photos match the selected types.');
        return;
      }

      // Close modal and show upload progress immediately
      setOptionsVisible(false);
      setUploadSelectedPhotos(null);
      setShowCompletionModal(false);
      clearCompletedUploads();
      setIsPreparingUpload(true);
      setShowUploadDetails(true);

      // Exit selection mode
      isSelectionModeRef.current = false;
      setIsSelectionMode(false);
      setSelectedPhotos(new Set());

      // Create album name
      const albumName = createAlbumName(userName || 'User', new Date(), null, location);

      // Upload to selected destinations
      const googleConnected = uploadDestinations.google && isAuthenticated;
      const dropboxConnected = uploadDestinations.dropbox && isDropboxConnected;

      if (!googleConnected && !dropboxConnected) {
        setIsPreparingUpload(false);
        setShowUploadDetails(false);
        Alert.alert(
          t('gallery.noConnectionTitle', { defaultValue: 'No Cloud Connected' }),
          t('gallery.noConnectionMessage', { defaultValue: 'Please connect Google Drive or Dropbox in Settings before uploading.' }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            { text: t('settings.goToSettings', { defaultValue: 'Go to Settings' }), onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
          ]
        );
        return;
      }

      if (googleConnected) {
        // Always validate session (even if proxySessionId exists, it may be stale)
        let sessionId = null;
        let effectiveFolderId = folderId;
        try {
          const result = await initializeProxySession(folderId, accountType || 'google');
          if (result?.success && result?.sessionId) {
            sessionId = result.sessionId;
            effectiveFolderId = result.folderId || folderId;
          }
        } catch (e) {
          console.error('[GALLERY] Failed to init proxy session:', e);
        }

        if (!sessionId) {
          setIsPreparingUpload(false);
          Alert.alert('Session Error', 'Your upload session has expired. Please reconnect your Google account in Settings.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
          ]);
          return;
        }

        setIsPreparingUpload(false);
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: !useFolderStructure,
          config: {
            folderId: effectiveFolderId,
            sessionId,
            accountType: accountType || 'google',
            useDirectDrive: true,
          },
        });
      }

      if (dropboxConnected) {
        setIsPreparingUpload(false);
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: !useFolderStructure,
          config: {
            accountType: 'dropbox',
          },
        });
      }

    } catch (error) {
      console.error('[GALLERY] Upload error:', error);
      setIsPreparingUpload(false);
      setShowUploadDetails(false);
      Alert.alert('Upload Error', 'Failed to start upload. Please try again.');
    }
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
        await deletePhoto(photo.id, { deleteFromStorage: deleteFromStorageParam });
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

  const getGalleryAllPhotos = () => {
    // Build allPhotos to match EXACTLY how the gallery grid displays photos:
    // For each set: before, after (if exists), combined (if both exist)
    const allPhotos = [];
    if (!getRooms || typeof getRooms !== 'function') return allPhotos;
    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) return allPhotos;
    rooms.forEach(room => {
      const sets = getPhotoSets(room.id);
      const combinedPhotos = getCombinedPhotos(room.id);
      sets.forEach(set => {
        // Always add the before photo
        if (set.before) {
          allPhotos.push({ ...set.before, type: 'before' });
        }
        // Add the after photo if it exists
        if (set.after) {
          allPhotos.push({ ...set.after, type: 'after' });
        }
        // Add the combined photo if both before and after exist
        if (set.before && set.after) {
          const combinedPhoto = combinedPhotos.find(p => p.name === set.before.name && p.room === set.before.room);
          allPhotos.push({
            type: 'combined',
            beforePhoto: set.before,
            afterPhoto: set.after,
            id: `combined-${set.before.id}`, // Unique ID for combined
            name: set.before.name,
            room: set.before.room,
            uri: combinedPhoto?.uri || set.before.uri,
            templateType: combinedPhoto?.templateType,
            combinedLayout: combinedPhoto?.combinedLayout,
          });
        }
      });
    });
    return allPhotos;
  };

  const openFullScreenFromGallery = (photo, photoSet, photoType) => {
    fullScreenVisibleRef.current = true;
    const allPhotos = getGalleryAllPhotos();
    let index = 0;

    console.log('[GalleryScreen] openFullScreen called - photoType:', photoType, 'photo.id:', photo?.id, 'photoSet.before.id:', photoSet?.before?.id);

    if (photoType === 'combined' && photoSet?.before) {
      // For combined, find by matching beforePhoto.id
      index = allPhotos.findIndex(p => p.type === 'combined' && p.beforePhoto?.id === photoSet.before.id);
    } else if (photo?.id) {
      // For before/after, find by matching id AND type
      index = allPhotos.findIndex(p => p.id === photo.id && p.type === photoType);
      // Fallback to just id if not found with type
      if (index < 0) {
        index = allPhotos.findIndex(p => p.id === photo.id);
      }
    }

    console.log('[GalleryScreen] Found index:', index, 'of', allPhotos.length, 'photos');

    if (index < 0) index = 0;
    setFullScreenPhotos(allPhotos);
    setFullScreenIndex(index);
    setFullScreenLoading(false);
    setFullScreenError(null);

    // Use the actual type from allPhotos[index]
    const actualPhoto = allPhotos[index];
    const actualType = actualPhoto?.type;
    console.log('[GalleryScreen] Displaying - type:', actualType, 'id:', actualPhoto?.id, 'uri:', actualPhoto?.uri?.substring(0, 50));

    if (actualType === 'combined' || actualType === 'split') {
      // Combined/split photos use fullScreenPhotoSet
      setFullScreenPhotoSet({ before: actualPhoto.beforePhoto, after: actualPhoto.afterPhoto });
      setFullScreenPhoto(null);
    } else {
      // Single before/after photos use fullScreenPhoto
      setFullScreenPhoto(actualPhoto || null);
      setFullScreenPhotoSet(null);
    }
  };

  const handleGalleryFullScreenClose = () => {
    fullScreenVisibleRef.current = false;
    setFullScreenPhoto(null);
    setFullScreenPhotoSet(null);
    setFullScreenPhotos([]);
    setFullScreenIndex(0);
    setFullScreenLoading(false);
    setFullScreenError(null);
    handleLongPressEnd();
  };

  const handleSwipeNavigation = (direction) => {
    // Use refs to get current values (avoids stale closure in PanResponder)
    const photos = fullScreenPhotosRef.current;
    const currentIndex = fullScreenIndexRef.current;

    if (photos.length === 0) return;

    let newIndex = currentIndex;
    if (direction === 'left') {
      // Next photo
      newIndex = (currentIndex + 1) % photos.length;
    } else if (direction === 'right') {
      // Previous photo
      newIndex = currentIndex === 0 ? photos.length - 1 : currentIndex - 1;
    }

    // Validate newIndex
    if (newIndex < 0 || newIndex >= photos.length) {
      console.log('[GalleryScreen] Invalid index:', newIndex, 'length:', photos.length);
      return;
    }

    const newPhoto = photos[newIndex];
    console.log('[GalleryScreen] swipe', direction, '- index:', newIndex, 'type:', newPhoto?.type, 'id:', newPhoto?.id);

    if (!newPhoto) {
      console.log('[GalleryScreen] No photo at index:', newIndex);
      return;
    }

    setFullScreenIndex(newIndex);
    setFullScreenLoading(false);
    setFullScreenError(null);

    if (newPhoto.type === 'combined' || newPhoto.type === 'split') {
      if (newPhoto.beforePhoto && newPhoto.afterPhoto) {
        setFullScreenPhotoSet({ before: newPhoto.beforePhoto, after: newPhoto.afterPhoto });
        setFullScreenPhoto(null);
      } else {
        // Fallback if combined photo is missing before/after data
        console.log('[GalleryScreen] Combined photo missing data, showing as single');
        setFullScreenPhoto(newPhoto);
        setFullScreenPhotoSet(null);
      }
    } else {
      setFullScreenPhoto(newPhoto);
      setFullScreenPhotoSet(null);
    }
  };

  // Keep function refs updated for PanResponder
  handleSwipeRef.current = handleSwipeNavigation;
  handleCloseRef.current = handleGalleryFullScreenClose;

  const fullScreenPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (!fullScreenVisibleRef.current) return false;
        const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 20;
        const isVerticalSwipe = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 20;
        return isHorizontalSwipe || isVerticalSwipe;
      },
      onPanResponderGrant: () => {
        swipeStartX.current = null;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const photosLength = fullScreenPhotosRef.current.length;

        // Horizontal swipe for navigation
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
          if (gestureState.dx > swipeThreshold && photosLength > 1) {
            console.log('[GalleryScreen] Swipe right - previous photo');
            handleSwipeRef.current?.('right');
          } else if (gestureState.dx < -swipeThreshold && photosLength > 1) {
            console.log('[GalleryScreen] Swipe left - next photo');
            handleSwipeRef.current?.('left');
          }
        }
        // Vertical swipe to close
        else if (Math.abs(gestureState.dy) > swipeThreshold) {
          handleCloseRef.current?.();
        }

        swipeStartX.current = null;
      },
      onPanResponderTerminationRequest: () => false,
    })
  ).current

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
        
        openFullScreenFromGallery(null, photoSet, 'combined');
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
            <Image key={`combined-before-${photoSet.before.id}`} source={{ uri: photoSet.before.uri }} style={styles.halfImage} resizeMode="cover" />
            <View style={{
              position: 'absolute',
              [useStackedLayout ? 'top' : 'left']: '50%',
              [useStackedLayout ? 'left' : 'top']: 0,
              [useStackedLayout ? 'right' : 'bottom']: 0,
              [useStackedLayout ? 'height' : 'width']: 2,
              backgroundColor: COLORS.PRIMARY,
              zIndex: 1
            }} />
            <Image key={`combined-after-${photoSet.after.id}`} source={{ uri: photoSet.after.uri }} style={styles.halfImage} resizeMode="cover" />
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
        openFullScreenFromGallery(null, photoSet, 'combined');
      } else {
        openFullScreenFromGallery(photo, photoSet, photoType);
      }
    };

    return (
      <TouchableOpacity
        style={[styles.photoCard, isLast && styles.photoCardLast, isSelected && styles.photoCardSelected]}
        onPress={handlePress}
        onLongPress={() => handleLongPressStart(photo, photoType === 'combined' ? photoSet : null)}
      >
        <CroppedThumbnail
          key={`thumb-${photoType}-${photo.id}`}
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
    const setKey = set.before?.id ?? `set-${roomId}-${index}`;
    return (
      <View key={`${roomId}-${setKey}`} style={styles.photoSetRow}>
        <View style={styles.threeColumnRow}>
          {showBefore && (
            <View key={`${setKey}-before`}>
              {renderPhotoCard(set.before, '#4CAF50', 'before', set, false, isSelectionMode, selectedPhotos)}
            </View>
          )}
          {showAfter && (
            <View key={`${setKey}-after`}>
              {renderPhotoCard(set.after, '#2196F3', 'after', set, false, isSelectionMode, selectedPhotos)}
            </View>
          )}
          {showCombined && (
            <View key={`${setKey}-combined`}>
              {renderPhotoCard(set.combined, COLORS.PRIMARY, 'combined', set, true, isSelectionMode, selectedPhotos)}
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderFilteredPhotos = (photos, photoType, borderColor, roomId = '') => {
    const photosPerRow = 3;
    const rows = [];
    
    for (let i = 0; i < photos.length; i += photosPerRow) {
      const rowPhotos = photos.slice(i, i + photosPerRow);
      rows.push(
        <View key={`${roomId}-row-${i}`} style={styles.photoSetRow}>
          <View style={styles.threeColumnRow}>
            {rowPhotos.map((photo, idx) => {
              const photoSet = photo.photoSet || { before: photo, after: null, combined: null };
              const isLast = idx === rowPhotos.length - 1;
              const photoToRender = photoType === 'combined' ? null : photo;
              const uniqueKey = photoType === 'combined' ? `combined_${photoSet.before?.id || i}_${idx}` : (photo.id || `photo_${i}_${idx}`);
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
            <Text style={styles.roomName} numberOfLines={1} ellipsizeMode="tail">
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
            <Text style={styles.roomName} numberOfLines={1} ellipsizeMode="tail">
              {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
            </Text>
          </View>
          {renderFilteredPhotos(filteredPhotos, photoType, borderColor, room.id)}
        </View>
      );
    }

    return (
      <View key={room.id} style={styles.roomSection}>
        <View style={styles.roomHeader}>
          <Text style={styles.roomName}>
            {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
          </Text>
        </View>
        {sets.map((set, index) => renderPhotoSet(set, index, room.id))}
      </View>
    );
  };

  const topInset = Math.max(insets.top, 25);
  const bottomInset = Math.max(insets.bottom, 20);

  return (
    <SafeAreaView style={[styles.container, { paddingTop: 0 }]} edges={['top']} {...panResponder.panHandlers}>
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
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity
                onPress={() => {
                  if (navigation.canGoBack()) {
                    navigation.goBack();
                  } else {
                    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                  }
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={{ marginRight: 8 }}
              >
                <Ionicons name="chevron-back" size={24} color={COLORS.TEXT} />
              </TouchableOpacity>
              <Text style={styles.title}>{t('gallery.title')}</Text>
            </View>
            <TouchableOpacity
              style={styles.selectButton}
              activeOpacity={0.7}
              onPress={() => {
                isSelectionModeRef.current = true;
                setIsSelectionMode(true);
                // Auto-select all photos
                const allIds = new Set();
                const rooms = getRooms ? getRooms() : [];
                if (Array.isArray(rooms)) {
                  rooms.forEach(room => {
                    const sets = getPhotoSets(room.id);
                    sets.forEach(set => {
                      if (set.before) allIds.add(set.before.id);
                      if (set.after) allIds.add(set.after.id);
                      if (set.before) allIds.add(`combined_${set.before.id}`);
                    });
                  });
                }
                setSelectedPhotos(allIds);
              }}
            >
              <Text style={styles.selectButtonText}>{t('Select')}</Text>
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
            Before
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'after' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('after')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'after' && styles.filterButtonTextActive]}>
            After
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, photoFilter === 'combined' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('combined')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'combined' && styles.filterButtonTextActive]}>
            Combined
          </Text>
        </TouchableOpacity>
      </View>

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
          contentContainerStyle={[styles.content, { paddingBottom: 20 + insets.bottom + 50 + 80 }]}
        >
          {/* Project Name Section */}
          {(() => {
            const activeProject = projects?.find?.(p => p.id === activeProjectId);
            return (
              <View style={styles.projectNameSection}>
                <View style={styles.projectNameRow}>
                  <Text style={styles.projectNameDisplay} numberOfLines={1} ellipsizeMode="tail">
                    {activeProject?.name || t('gallery.noProjectSelected')}
                  </Text>
                  <View style={styles.projectNameLine} />
                  <TouchableOpacity
                    onPress={() => setShowDeleteAllConfirm(true)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={{ marginLeft: 12 }}
                  >
                    <Ionicons name="trash-outline" size={20} color="#999" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}
          
          {/* Room Sections */}
          {(getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS).map(room => renderRoomSection(room))}
        </ScrollView>
      )}

      {!isSelectionMode && (
        <>
          <View style={[styles.bottomNavPill, { bottom: 20 + insets.bottom }]}>
        <TouchableOpacity 
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
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
         style={[styles.navItem, styles.navItemActive]}

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


          <TouchableOpacity
            style={[styles.floatingAddButton, { bottom: 20 + insets.bottom + 50 + 16 }]}
            onPress={() => {
              if (!activeProjectId) return;
              isSelectionModeRef.current = true;
              setIsSelectionMode(true);
              // Auto-select all photos
              const allIds = new Set();
              const rooms = getRooms ? getRooms() : [];
              if (Array.isArray(rooms)) {
                rooms.forEach(room => {
                  const sets = getPhotoSets(room.id);
                  sets.forEach(set => {
                    if (set.before) allIds.add(set.before.id);
                    if (set.after) allIds.add(set.after.id);
                    if (set.before) allIds.add(`combined_${set.before.id}`);
                  });
                });
              }
              setSelectedPhotos(allIds);
            }}
          >
            <Ionicons name="share-outline" size={28} color="#000000" />
          </TouchableOpacity>
        </>
      )}

      {isSelectionMode && (
        <View style={[styles.floatingActionButtons, { bottom: 20 + insets.bottom + 50 + 16 }]}>
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

      {/* Full-screen photo overlay (same interface as HomeScreen) */}
      {fullScreenPhoto && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          <View style={[styles.fullScreenHeaderRow, { paddingTop: topInset }]}>
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
                handleGalleryFullScreenClose();
                navigation.navigate('LabelCustomization');
              }}
            >
              <Text style={styles.fullScreenCustomizeText}>{t('settings.customizeLabels', { defaultValue: 'Customize Labels' })}</Text>
              <Ionicons name="chevron-forward" size={14} color="white" style={{ marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={handleGalleryFullScreenClose}>
              <Ionicons name="close" size={20} color="rgba(255, 0, 0, 0.82)" />
            </TouchableOpacity>
          </View>
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
                  <Text style={styles.fullScreenErrorUri}>{fullScreenPhoto.uri?.substring(0, 60)}...</Text>
                </View>
              )}
              <Image
                key={fullScreenPhoto.uri || fullScreenPhoto.id}
                source={{ uri: fullScreenPhoto.uri }}
                style={styles.fullScreenPhoto}
                resizeMode="contain"
                onError={(e) => {
                  console.log('[GalleryScreen] Image load error:', e.nativeEvent?.error, 'URI:', fullScreenPhoto.uri);
                  setFullScreenLoading(false);
                  setFullScreenError(e.nativeEvent?.error || 'Unknown error');
                }}
                onLoadStart={() => {
                  console.log('[GalleryScreen] Image load start:', fullScreenPhoto.uri?.substring(0, 80));
                  setFullScreenLoading(true);
                  setFullScreenError(null);
                }}
                onLoad={() => {
                  console.log('[GalleryScreen] Image loaded successfully');
                  setFullScreenLoading(false);
                  setFullScreenError(null);
                }}
              />
              {showLabels && fullScreenPhoto.mode && !fullScreenError && (
                <PhotoLabel
                  label={fullScreenPhoto.mode === 'before' ? 'common.before' : 'common.after'}
                  position={
                    fullScreenPhoto.mode === 'before'
                      ? pickBeforeLabelPosition(
                          { beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape },
                          fullScreenPhoto.width,
                          fullScreenPhoto.height
                        )
                      : pickAfterLabelPosition(
                          { beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape },
                          fullScreenPhoto.width,
                          fullScreenPhoto.height
                        )
                  }
                />
              )}
            </View>
          </View>
          <View style={styles.fullScreenRoomNameRow}>
            <Text style={styles.fullScreenRoomName} numberOfLines={1} ellipsizeMode="tail">
              {((getRooms && typeof getRooms === 'function' ? getRooms() : [])).find(r => r.id === fullScreenPhoto.room)?.name || fullScreenPhoto.room || ''}
            </Text>
            {fullScreenPhotos.length > 1 && (
              <View style={styles.fullScreenPaginationDots}>
                {fullScreenPhotos.map((_, i) => (
                  <View key={i} style={[styles.fullScreenDot, i === fullScreenIndex && styles.fullScreenDotActive]} />
                ))}
              </View>
            )}
          </View>
          <View style={[styles.fullScreenBottomBar, { paddingBottom: bottomInset }]}>
            <TouchableOpacity
              style={styles.fullScreenDeleteCircle}
              onPress={() => {
                pendingDeletePhotoRef.current = { id: fullScreenPhoto.id, name: fullScreenPhoto.name, type: 'photo' };
                setShowDeletePhotoConfirm(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenShareCircle}
              disabled={sharing}
              onPress={() => shareIndividualPhoto(fullScreenPhoto)}
            >
              {sharing ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="paper-plane-outline" size={20} color="#000" />}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {fullScreenPhotoSet && (
        <View style={styles.fullScreenPhotoContainer} {...fullScreenPanResponder.panHandlers}>
          <View style={[styles.fullScreenHeaderRow, { paddingTop: topInset }]}>
            <View style={styles.fullScreenLabelsToggle}>
              <Text style={styles.fullScreenLabelsText}>{t('settings.labels', { defaultValue: 'Labels' })}</Text>
              <Switch value={showLabels} onValueChange={toggleLabels} trackColor={{ false: '#767577', true: '#34C759' }} thumbColor={showLabels ? '#fff' : '#f4f3f4'} />
            </View>
            <TouchableOpacity style={styles.fullScreenCustomizeButton} onPress={() => { handleGalleryFullScreenClose(); navigation.navigate('LabelCustomization'); }}>
              <Text style={styles.fullScreenCustomizeText}>{t('settings.customizeLabels', { defaultValue: 'Customize Labels' })}</Text>
              <Ionicons name="chevron-forward" size={14} color="white" style={{ marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.fullScreenCloseButton} onPress={handleGalleryFullScreenClose}>
              <Ionicons name="close" size={20} color="red" />
            </TouchableOpacity>
          </View>
          <View style={styles.fullScreenPhotoArea}>
            <View
              ref={fullScreenCombinedRef}
              collapsable={false}
              style={[
                styles.fullScreenCombinedPreview,
                isStackedLayout(fullScreenPhotos[fullScreenIndex]?.templateType, fullScreenPhotoSet.before.aspectRatio) ? styles.fullScreenStacked : styles.fullScreenSideBySide
              ]}
            >
              <View style={styles.fullScreenHalf}>
                <Image
                  key={`before-${fullScreenPhotoSet.before.uri}`}
                  source={{ uri: fullScreenPhotoSet.before.uri }}
                  style={styles.fullScreenHalfImage}
                  resizeMode="cover"
                  onLoadStart={() => console.log('[GalleryScreen] Combined BEFORE load start:', fullScreenPhotoSet.before.uri?.substring(0, 60))}
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.before"
                    position={pickBeforeLabelPosition(
                      { beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape },
                      fullScreenPhotoSet.before.width,
                      fullScreenPhotoSet.before.height
                    )}
                  />
                )}
              </View>
              <View style={isStackedLayout(fullScreenPhotos[fullScreenIndex]?.templateType, fullScreenPhotoSet.before.aspectRatio) ? styles.fullScreenCenterDividerHorizontal : styles.fullScreenCenterDivider} pointerEvents="none" />
              <View style={styles.fullScreenHalf}>
                <Image
                  key={`after-${fullScreenPhotoSet.after.uri}`}
                  source={{ uri: fullScreenPhotoSet.after.uri }}
                  style={styles.fullScreenHalfImage}
                  resizeMode="cover"
                  onLoadStart={() => console.log('[GalleryScreen] Combined AFTER load start:', fullScreenPhotoSet.after.uri?.substring(0, 60))}
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.after"
                    position={pickAfterLabelPosition(
                      { beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape },
                      fullScreenPhotoSet.after.width,
                      fullScreenPhotoSet.after.height
                    )}
                  />
                )}
              </View>
            </View>
          </View>
          <View style={styles.fullScreenRoomNameRow}>
            <Text style={styles.fullScreenRoomName} numberOfLines={1} ellipsizeMode="tail">
              {((getRooms && typeof getRooms === 'function' ? getRooms() : [])).find(r => r.id === fullScreenPhotoSet.before.room)?.name || fullScreenPhotoSet.before.room}
            </Text>
            {fullScreenPhotos.length > 1 && (
              <View style={styles.fullScreenPaginationDots}>
                {fullScreenPhotos.map((_, i) => (
                  <View key={i} style={[styles.fullScreenDot, i === fullScreenIndex && styles.fullScreenDotActive]} />
                ))}
              </View>
            )}
          </View>
          <View style={[styles.fullScreenBottomBar, { paddingBottom: bottomInset }]}>
            <TouchableOpacity
              style={styles.fullScreenDeleteCircle}
              onPress={() => {
                pendingDeletePhotoRef.current = { id: fullScreenPhotoSet.before.id, name: fullScreenPhotoSet.before.name, type: 'set' };
                setShowDeletePhotoConfirm(true);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fullScreenShareCircle}
              disabled={sharing}
              onPress={shareFullScreenCombined}
            >
              {sharing ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="paper-plane-outline" size={20} color="#000" />}
            </TouchableOpacity>
          </View>
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
                {/* Grabber */}
                <View style={styles.grabberContainer}>
                  <View style={styles.modalGrabber} />
                </View>

                {/* Header */}
                <View style={styles.shareModalHeader}>
                  <TouchableOpacity 
                    onPress={() => setShareOptionsVisible(false)}
                    style={styles.shareCloseButton}
                  >
                    <Ionicons name="close" size={20} color="#999999" />
                  </TouchableOpacity>
                  <Text style={styles.shareModalTitle}>Choose Shared Formats</Text>
                </View>

                <ScrollView 
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Photo Types Section */}
                  <Text style={styles.shareSectionLabel}>Photo types</Text>
                  <View style={styles.shareTypeButtons}>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.before && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, before: !prev.before }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.before && styles.shareTypeButtonTextActive]}>
                        Before
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.after && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, after: !prev.after }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.after && styles.shareTypeButtonTextActive]}>
                        After
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.combined && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, combined: !prev.combined }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.combined && styles.shareTypeButtonTextActive]}>
                        Combined
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Advance Options Header */}
                  <TouchableOpacity
                    style={styles.advanceOptionsHeader}
                    onPress={() => setShowAdvancedShareFormats(!showAdvancedShareFormats)}
                  >
                    <Text style={styles.advanceOptionsTitle}>Advance Options</Text>
                    <Ionicons 
                      name={showAdvancedShareFormats ? "chevron-up" : "chevron-down"} 
                      size={24} 
                      color="#1C274C" 
                    />
                  </TouchableOpacity>

                  {showAdvancedShareFormats && (
                    <>
                      {/* Stacked Formats */}
                      <Text style={styles.shareFormatLabel}>Stacked formats</Text>
                      <View style={styles.shareFormatButtons}>
                        {[TEMPLATE_TYPES.STACK_PORTRAIT, TEMPLATE_TYPES.STACK_LANDSCAPE, TEMPLATE_TYPES.SQUARE_STACK].map((key) => {
                          const config = TEMPLATE_CONFIGS[key];
                          if (!config) return null;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.shareFormatButton, selectedFormats[key] && styles.shareFormatButtonActive]}
                              onPress={() => handleFormatToggle(key)}
                            >
                              <Text style={[styles.shareFormatButtonText, selectedFormats[key] && styles.shareFormatButtonTextActive]}>
                                {config.name || key}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Divider */}
                      <View style={styles.shareDivider} />

                      {/* Side-by-side Formats */}
                      <Text style={styles.shareFormatLabel}>Side-by-side formats</Text>
                      <View style={styles.shareFormatButtons}>
                        {[TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE, TEMPLATE_TYPES.SIDE_BY_SIDE_WIDE, TEMPLATE_TYPES.BLOG_FORMAT, TEMPLATE_TYPES.SQUARE_SIDE].map((key) => {
                          const config = TEMPLATE_CONFIGS[key];
                          if (!config) return null;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.shareFormatButton, selectedFormats[key] && styles.shareFormatButtonActive]}
                              onPress={() => handleFormatToggle(key)}
                            >
                              <Text style={[styles.shareFormatButtonText, selectedFormats[key] && styles.shareFormatButtonTextActive]}>
                                {config.name || key}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Share as Archive Toggle */}
                  <View style={styles.archiveToggleRow}>
                    <Switch
                      value={shareAsArchive}
                      onValueChange={setShareAsArchive}
                      trackColor={{ false: '#E0E0E0', true: '#34C759' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#E0E0E0"
                    />
                    <Text style={styles.archiveToggleLabel}>Share as archive (zip)</Text>
                  </View>
                </ScrollView>

                {/* Share Now Button */}
                <View style={[styles.shareButtonContainer, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <TouchableOpacity
                    style={styles.shareNowButton}
                    onPress={startSharingWithOptions}
                  >
                    <Text style={styles.shareNowButtonText}>Share Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Upload Options Modal */}
      <Modal
        visible={optionsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setOptionsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.shareModalContent}>
                {/* Grabber */}
                <View style={styles.grabberContainer}>
                  <View style={styles.modalGrabber} />
                </View>

                {/* Header */}
                <View style={styles.shareModalHeader}>
                  <TouchableOpacity
                    onPress={() => setOptionsVisible(false)}
                    style={styles.shareCloseButton}
                  >
                    <Ionicons name="close" size={20} color="#999999" />
                  </TouchableOpacity>
                  <Text style={styles.shareModalTitle}>Upload Photos</Text>
                </View>

                <ScrollView
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Photo Types Section */}
                  <Text style={styles.shareSectionLabel}>Photo types to upload</Text>
                  <View style={styles.shareTypeButtons}>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedTypes.before && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedTypes(prev => ({ ...prev, before: !prev.before }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedTypes.before && styles.shareTypeButtonTextActive]}>
                        Before
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedTypes.after && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedTypes(prev => ({ ...prev, after: !prev.after }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedTypes.after && styles.shareTypeButtonTextActive]}>
                        After
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedTypes.combined && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedTypes(prev => ({ ...prev, combined: !prev.combined }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedTypes.combined && styles.shareTypeButtonTextActive]}>
                        Combined
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Upload Destinations */}
                  <Text style={styles.shareSectionLabel}>Upload to</Text>

                  <TouchableOpacity
                    style={[styles.uploadDestRow, uploadDestinations.google && styles.uploadDestRowActive]}
                    onPress={() => setUploadDestinations(prev => ({ ...prev, google: !prev.google }))}
                  >
                    <Ionicons name="logo-google" size={20} color={uploadDestinations.google ? '#000' : '#999'} />
                    <Text style={[styles.uploadDestText, uploadDestinations.google && styles.uploadDestTextActive]}>
                      Google Drive
                    </Text>
                    {!isAuthenticated && (
                      <Text style={styles.uploadDestHint}>Not connected</Text>
                    )}
                    {uploadDestinations.google && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.uploadDestRow, uploadDestinations.dropbox && styles.uploadDestRowActive]}
                    onPress={() => setUploadDestinations(prev => ({ ...prev, dropbox: !prev.dropbox }))}
                  >
                    <Ionicons name="cloud-outline" size={20} color={uploadDestinations.dropbox ? '#000' : '#999'} />
                    <Text style={[styles.uploadDestText, uploadDestinations.dropbox && styles.uploadDestTextActive]}>
                      Dropbox
                    </Text>
                    {!isDropboxConnected && (
                      <Text style={styles.uploadDestHint}>Not connected</Text>
                    )}
                    {uploadDestinations.dropbox && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </ScrollView>

                {/* Upload Now Button */}
                <View style={[styles.shareButtonContainer, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <TouchableOpacity
                    style={[styles.shareNowButton, (!uploadDestinations.google && !uploadDestinations.dropbox) && { opacity: 0.5 }]}
                    onPress={handleConfirmUpload}
                    disabled={!uploadDestinations.google && !uploadDestinations.dropbox}
                  >
                    <Ionicons name="cloud-upload" size={20} color="#000" style={{ marginRight: 8 }} />
                    <Text style={styles.shareNowButtonText}>Upload Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {showUploadDetails && (
        <UploadDetailsModal
          visible={showUploadDetails}
          onClose={() => { setShowUploadDetails(false); setIsPreparingUpload(false); }}
          uploadStatus={uploadStatus}
          onCancelUpload={cancelUpload}
          onMinimize={() => setShowUploadDetails(false)}
          isPreparing={isPreparingUpload}
        />
      )}

      {showCompletionModal && (
        <UploadCompletionModal
          visible={showCompletionModal}
          completedUploads={uploadStatus.completedUploads || []}
          onClearCompleted={clearCompletedUploads}
          onClose={() => setShowCompletionModal(false)}
          onDeleteProject={handleDeleteAllConfirmed}
        />
      )}

      {showDeleteSelectedConfirm && (
        <DeleteConfirmationModal
          visible={showDeleteSelectedConfirm}
          title={t('home.deletePhotoSet')}
          message={t('gallery.deleteSelectedConfirm', { defaultValue: `Are you sure you want to delete ${selectedPhotos.size} selected photo(s)?` })}
          onConfirm={handleDeleteSelectedConfirmed}
          onCancel={() => setShowDeleteSelectedConfirm(false)}
          deleteFromStorageDefault={true}
        />
      )}

      {showDeletePhotoConfirm && pendingDeletePhotoRef.current && (
        <DeleteConfirmationModal
          visible={showDeletePhotoConfirm}
          title={t('home.deletePhotoSet')}
          message={t('home.deletePhotoSetConfirm', { name: pendingDeletePhotoRef.current?.name || '' })}
          onConfirm={async (deleteFromStorageVal) => {
            const pending = pendingDeletePhotoRef.current;
            setShowDeletePhotoConfirm(false);
            pendingDeletePhotoRef.current = null;
            if (pending) {
              if (pending.type === 'set') {
                await deletePhotoSet(pending.id, { deleteFromStorage: deleteFromStorageVal });
              } else {
                await deletePhoto(pending.id, { deleteFromStorage: deleteFromStorageVal });
              }
              handleGalleryFullScreenClose();
            }
          }}
          onCancel={() => {
            setShowDeletePhotoConfirm(false);
            pendingDeletePhotoRef.current = null;
          }}
          deleteFromStorageDefault={true}
        />
      )}

      {showDeleteAllConfirm && (
        <DeleteConfirmationModal
          visible={showDeleteAllConfirm}
          title={t('projects.deleteProject', { defaultValue: 'Delete Project' })}
          message={t('projects.deleteProjectMessage', {
            defaultValue: `Are you sure you want to delete "${projects?.find?.(p => p.id === activeProjectId)?.name || ''}"? This will remove the project. Uncheck the box below to keep the photos.`,
            name: projects?.find?.(p => p.id === activeProjectId)?.name || '',
          })}
          onConfirm={handleDeleteAllConfirmed}
          onCancel={() => setShowDeleteAllConfirm(false)}
          deleteFromStorageDefault={true}
        />
      )}

      <Modal
        visible={showSharePlanModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleSharePlanModalClose}
        statusBarTranslucent={true}
      >
        <TouchableWithoutFeedback onPress={handleSharePlanModalClose}>
          <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]}>
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
                    navigation.reset({ index: 0, routes: [{ name: 'Settings' }] });
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

  {/* Processing overlay */}
  {sharing && (
    <View style={styles.processingOverlay}>
      <View style={styles.processingBox}>
        <ActivityIndicator size="large" color="#F2C31B" />
        <Text style={styles.processingText}>{shareStatus || t('gallery.sharing', { defaultValue: 'Sharing...' })}</Text>
      </View>
    </View>
  )}
</SafeAreaView>
);
}
const styles = StyleSheet.create({
container: {
flex: 1,
backgroundColor: COLORS.BACKGROUND,
paddingTop: 25
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
fullScreenErrorUri: {
color: '#888',
fontSize: 10,
marginTop: 8,
textAlign: 'center'
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
position: 'relative'
},
fullScreenStacked: { flexDirection: 'column' },
fullScreenSideBySide: { flexDirection: 'row' },
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
paddingBottom: 20,
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
header: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
paddingHorizontal: 20,
paddingTop: 16,
paddingBottom: 16,
},
title: {
fontSize: 28,
fontWeight: '700',
color: COLORS.TEXT,
letterSpacing: -0.3,
},
selectionCountText: {
fontSize: 28,
fontWeight: '700',
color: COLORS.TEXT,
letterSpacing: -0.3,
},
cancelButton: {
paddingHorizontal: 16,
paddingVertical: 8,
borderRadius: 20,
backgroundColor: 'rgba(255, 180, 180, 0.4)',
},
cancelButtonText: {
color: '#E53935',
fontSize: 16,
fontWeight: '500',
},
selectButton: {
paddingHorizontal: 14,
paddingVertical: 8,
borderRadius: 20,
backgroundColor: 'rgba(118, 118, 128, 0.12)',
alignItems: 'center',
justifyContent: 'center',
},
selectButtonText: {
color: COLORS.TEXT,
fontSize: 15,
fontWeight: '500',
},
filterContainer: {
flexDirection: 'row',
alignItems: 'center',
backgroundColor: '#F6F8FA',
paddingVertical: 12,
paddingHorizontal: 19,
gap: 10,
},
filterButton: {
paddingVertical: 3,
paddingHorizontal: 14,
borderRadius: 30,
backgroundColor: 'transparent',
alignItems: 'center',
justifyContent: 'center',
borderWidth: 1,
borderColor: 'rgba(0, 0, 0, 0.18)',
},
filterButtonActive: {
backgroundColor: COLORS.PRIMARY,
borderColor: 'rgba(0, 0, 0, 0.18)',
borderopacity: 0.5,
},
filterButtonText: {
fontSize: 14,
fontWeight: '500',
color: '#000000',
textTransform: 'capitalize',
},
filterButtonTextActive: {
color: '#000000',
fontWeight: '500',
},
projectNameSection: {
marginBottom: 8,
},
projectNameRow: {
flexDirection: 'row',
alignItems: 'center',
},
projectNameDisplay: {
fontSize: 17,
fontWeight: '700',
color: COLORS.TEXT,
lineHeight: 21,
flexShrink: 1,
},
projectNameLine: {
flex: 1,
height: 1,
backgroundColor: '#000000',
opacity: 0.2,
marginLeft: 12,
},
roomNameDisplay: {
fontSize: 14,
fontWeight: '400',
color: COLORS.TEXT,
lineHeight: 17,
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
left: 16,
right: 16,
flexDirection: 'row',
alignItems: 'center',
justifyContent: 'flex-start',
gap: 8,
zIndex: 1000,
elevation: 1000
},
floatingActionButton: {
  width: 46,
  height: 46,
  borderRadius: 23,
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
  borderWidth: 1,
  borderColor: 'rgba(0, 0, 0, 0.3)',
  opacity: 0.9,
},
floatingActionButtonClose: {
  backgroundColor: '#DB4446',
  width: 60,
  height: 60,
  borderRadius: 30,
  position: 'absolute',
  right: 0,
  shadowColor: '#DB4446',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.45,
  shadowRadius: 24,
},
floatingActionButtonShare: {
flexDirection: 'row',
width: 'auto',
height: 46,
paddingHorizontal: 18,
borderRadius: 60,
backgroundColor: COLORS.PRIMARY,
gap: 8
},
floatingActionButtonUpload: {
flexDirection: 'row',
width: 'auto',
height: 46,
paddingHorizontal: 18,
borderRadius: 60,
backgroundColor: '#000000',
gap: 8
},
floatingActionButtonText: {
color: '#000',
fontSize: 15,
fontWeight: '600',
fontFamily: 'Alexandria_400Regular',
},
floatingActionButtonTextWhite: {
color: '#FFFFFF'
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
  height: 60,
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
paddingVertical: 10,
borderRadius: 20
},
navItemImage:{
  width: 22,
  height: 22,
},
navItemActive: {
  backgroundColor: '#E0E0E0',
  borderRadius: 100,
  marginHorizontal: -7,
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
right: 20,
width: 60,
height: 60,
borderRadius: 30,
backgroundColor: COLORS.PRIMARY,
justifyContent: 'center',
alignItems: 'center',
shadowColor: '#F2C31B',
shadowOffset: { width: 0, height: 4 },
shadowOpacity: 0.45,
shadowRadius: 24,
elevation: 10,
zIndex: 95
},
scrollView: {
flex: 1,
backgroundColor: '#F6F8FA',
},
content: {
padding: 19,
paddingTop: 10,
backgroundColor: '#F6F8FA',
},
roomSection: {
marginBottom: 24,
},
roomHeader: {
marginBottom: 12,
},
roomName: {
fontSize: 14,
fontWeight: '500',
color: COLORS.TEXT,
},
photoSetRow: {
flexDirection: 'row',
alignItems: 'flex-start',
marginBottom: 16,
},
threeColumnRow: {
flex: 1,
flexDirection: 'row',
flexWrap: 'nowrap',
},
photoCard: {
width: (width - 38 - 30) / 3,
height: ((width - 38 - 30) / 3) * 1.26,
borderRadius: 5,
borderWidth: 0,
overflow: 'hidden',
marginRight: 15,
position: 'relative'
},
photoCardCombined: {
borderWidth: 0.62,
borderColor: '#FCD116',
borderRadius: 5,
},
photoCardLast: {
marginRight: 0
},
photoCardSelected: {
opacity: 1,
borderWidth: 2,
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
  bottom: 0,
  left: 0,
  right: 0,
  paddingVertical: 4,
  paddingHorizontal: 6,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  borderBottomLeftRadius: 5,
  borderBottomRightRadius: 5,
  borderLeftWidth: 1,
  borderLeftColor: 'rgba(0, 0, 0, 0.2)',
  borderRightWidth: 1,
  borderRightColor: 'rgba(0, 0, 0, 0.2)',
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(0, 0, 0, 0.2)',
},
modeLabelCombined: {
backgroundColor: '#F2C31B',
borderLeftWidth: 1,
  borderLeftColor: '#F2C31B',
  borderRightWidth: 1,
  borderRightColor: '#F2C31B',
  borderBottomWidth: 1,
  borderBottomColor: '#F2C31B',
},
modeLabelText: {
color: '#000000',
fontSize: 11,
fontWeight: '700',
letterSpacing: 0.3,
textTransform: 'uppercase',
zIndex: 1000,
},
photoCheckboxContainer: {
width: 26,
height: 26,
borderRadius: 13,
backgroundColor: 'rgba(255, 255, 255, 0.95)',
borderWidth: 1.5,
borderColor: 'rgba(0, 0, 0, 0.3)',
justifyContent: 'center',
alignItems: 'center',
overflow: 'hidden'
},
photoCheckboxGrid: {
position: 'absolute',
top: 6,
right: 6,
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
backgroundColor: 'rgba(0, 0, 0, 0.34)',
justifyContent: 'flex-end',
},
shareModalContent: {
  backgroundColor: '#FFFFFF',
  borderTopLeftRadius: 38,
  borderTopRightRadius: 38,
  maxHeight: '85%',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -15 },
  shadowOpacity: 0.18,
  shadowRadius: 75,
  elevation: 20,
},
grabberContainer: {
  alignItems: 'center',
  paddingTop: 5,
},
modalGrabber: {
  width: 36,
  height: 5,
  backgroundColor: '#CCCCCC',
  borderRadius: 100,
},
shareModalHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingVertical: 10,
},
shareCloseButton: {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: 'rgba(120, 120, 128, 0.16)',
  justifyContent: 'center',
  alignItems: 'center',
},
shareModalTitle: {
  flex: 1,
  fontSize: 18,
  fontWeight: '600',
  color: '#333333',
  textAlign: 'center',
  marginRight: 44,
  letterSpacing: -0.43,
},
shareModalScroll: {
  maxHeight: 500,
},
shareModalScrollContent: {
  paddingHorizontal: 19,
  paddingBottom: 20,
},
shareSectionLabel: {
  fontSize: 14,
  fontWeight: '300',
  color: COLORS.TEXT,
  marginBottom: 11,
  marginTop: 17,
  lineHeight: 17,
},
shareTypeButtons: {
  flexDirection: 'row',
  gap: 10,
},
shareTypeButton: {
  paddingVertical: 10,
  paddingHorizontal: 15,
  borderRadius: 30,
  borderWidth: 1,
  borderColor: 'rgba(0, 0, 0, 0.25)',
  backgroundColor: 'transparent',
},
shareTypeButtonActive: {
  backgroundColor: COLORS.PRIMARY,
  borderColor: 'rgba(0, 0, 0, 0.25)',
},
shareTypeButtonText: {
  fontSize: 14,
  fontWeight: '400',
  color: COLORS.TEXT,
  lineHeight: 17,
},
shareTypeButtonTextActive: {
  color: COLORS.TEXT,
},
shareDivider: {
  height: 1,
  backgroundColor: '#000000',
  opacity: 0.15,
  marginTop: 17,
},
advanceOptionsHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 12,
  marginTop: 5,
},
advanceOptionsTitle: {
  fontSize: 14,
  fontWeight: '600',
  color: COLORS.TEXT,
  lineHeight: 17,
},
shareFormatLabel: {
  fontSize: 14,
  fontWeight: '300',
  color: COLORS.TEXT,
  marginBottom: 11,
  marginTop: 17,
  lineHeight: 17,
},
shareFormatButtons: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 10,
},
shareFormatButton: {
  paddingVertical: 10,
  paddingHorizontal: 15,
  borderRadius: 30,
  borderWidth: 1,
  borderColor: 'rgba(0, 0, 0, 0.25)',
  backgroundColor: 'transparent',
},
shareFormatButtonActive: {
  backgroundColor: COLORS.PRIMARY,
  borderColor: 'rgba(0, 0, 0, 0.25)',
},
shareFormatButtonText: {
  fontSize: 14,
  fontWeight: '400',
  color: COLORS.TEXT,
  lineHeight: 17,
},
shareFormatButtonTextActive: {
  color: COLORS.TEXT,
},
archiveToggleRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 12,
  gap: 6,
  marginTop: 5,
},
archiveToggleLabel: {
  fontSize: 14,
  fontWeight: '400',
  color: COLORS.TEXT,
  lineHeight: 17,
},
shareButtonContainer: {
  paddingHorizontal: 19.5,
  paddingBottom: 34,
  paddingTop: 10,
},
shareNowButton: {
  backgroundColor: '#000000',
  borderRadius: 100,
  height: 54,
  justifyContent: 'center',
  alignItems: 'center',
  flexDirection: 'row',
},
shareNowButtonText: {
  fontSize: 18,
  fontWeight: '700',
  color: '#FFFFFF',
  textAlign: 'center',
},
uploadDestRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 14,
  paddingHorizontal: 16,
  borderRadius: 12,
  backgroundColor: '#F5F5F5',
  marginBottom: 8,
  gap: 12,
},
uploadDestRowActive: {
  backgroundColor: '#FFF9E0',
  borderWidth: 1,
  borderColor: COLORS.PRIMARY,
},
uploadDestText: {
  fontSize: 16,
  fontWeight: '500',
  color: '#999',
},
uploadDestTextActive: {
  color: '#000',
  fontWeight: '600',
},
uploadDestHint: {
  fontSize: 12,
  color: '#CC0000',
  marginLeft: 4,
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
processingOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 999,
},
processingBox: {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: 30,
  alignItems: 'center',
  gap: 16,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.25,
  shadowRadius: 4,
  elevation: 5,
},
processingText: {
  fontFamily: 'Alexandria_400Regular',
  fontSize: 15,
  color: '#333',
},
});
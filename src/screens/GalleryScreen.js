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
  InteractionManager
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext'; // Import useAdmin
import { COLORS, PHOTO_MODES, ROOMS, TEMPLATE_CONFIGS, TEMPLATE_TYPES } from '../constants/rooms';
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

const { width } = Dimensions.get('window');
const CONTAINER_PADDING = 32; // 16px on each side
const PHOTO_SPACING = 16; // 8px between each of the 2 gaps
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
  const { userMode, teamInfo, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType } = useAdmin(); // Get userMode, teamInfo, auth info, and account type
  const { uploadStatus, startBackgroundUpload, cancelUpload, cancelAllUploads, clearCompletedUploads } = useBackgroundUpload();
  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null); // For combined preview
  const [sharing, setSharing] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(null); // Photo being captured with label
  const labelCaptureRef = useRef(null); // Ref for label capture view
  const [uploading, setUploading] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [showOnlySelected, setShowOnlySelected] = useState(false); // Filter to show only selected photos
  const [photoFilter, setPhotoFilter] = useState('all'); // Filter: 'all', 'before', 'after', 'combined'
  
  // Refs for double tap detection
  const tapCountRef = useRef({});
  const lastTapRef = useRef({});
  const originalSelectionStateRef = useRef({}); // Store original selection state before first tap
  const toggleTimeoutRef = useRef({}); // Store timeout IDs for delayed toggles
  const pendingTogglesRef = useRef(new Set()); // Track photos with pending toggles to prevent visual update
  
  // Ref to track selection mode for immediate access in handlers
  const isSelectionModeRef = useRef(false);
  
  // Keep ref in sync with state
  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode;
  }, [isSelectionMode]);
  
  // Effect to handle label capture when capturingPhoto state changes
  useEffect(() => {
    if (!capturingPhoto) return;
    
    const { photo, index, width, height, labelPosition, resolve, reject } = capturingPhoto;
    let timeoutId;
    
    // Wait longer for the view to render and ensure ref is attached
    // Use requestAnimationFrame to ensure we're on the next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timeoutId = setTimeout(async () => {
          try {
            // Check if ref is attached
            if (!labelCaptureRef.current) {
              console.log(`[GALLERY] Ref not ready for photo ${index + 1}, waiting longer...`);
              // Wait a bit more
              setTimeout(async () => {
                if (!labelCaptureRef.current) {
                  console.error(`[GALLERY] Ref still not ready for photo ${index + 1}, using original`);
                  const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
                  const tempUri = FileSystem.cacheDirectory + tempFileName;
                  await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
                  resolve(tempUri);
                  setCapturingPhoto(null);
                  return;
                }
                
                try {
                  const capturedUri = await captureRef(labelCaptureRef, {
                    format: 'jpg',
                    quality: 1.0
                  });
                  
                  const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
                  const tempUri = FileSystem.cacheDirectory + tempFileName;
                  await FileSystem.copyAsync({ from: capturedUri, to: tempUri });
                  
                  console.log(`[GALLERY] Captured photo ${index + 1} with label: ${tempUri}`);
                  resolve(tempUri);
                  setCapturingPhoto(null);
                } catch (error) {
                  console.error(`[GALLERY] Error capturing photo ${index + 1} with label:`, error);
                  // Fall back to original
                  const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
                  const tempUri = FileSystem.cacheDirectory + tempFileName;
                  await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
                  resolve(tempUri);
                  setCapturingPhoto(null);
                }
              }, 500);
              return;
            }
            
            const capturedUri = await captureRef(labelCaptureRef, {
              format: 'jpg',
              quality: 1.0
            });
            
            const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
            const tempUri = FileSystem.cacheDirectory + tempFileName;
            await FileSystem.copyAsync({ from: capturedUri, to: tempUri });
            
            console.log(`[GALLERY] Captured photo ${index + 1} with label: ${tempUri}`);
            resolve(tempUri);
            setCapturingPhoto(null);
          } catch (error) {
            console.error(`[GALLERY] Error capturing photo ${index + 1} with label:`, error);
            // Fall back to original
            const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
            const tempUri = FileSystem.cacheDirectory + tempFileName;
            try {
              await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
              resolve(tempUri);
            } catch (copyError) {
              reject(copyError);
            }
            setCapturingPhoto(null);
          }
        }, 800); // Longer delay to ensure view is fully rendered
      });
    });
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [capturingPhoto]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const uploadControllersRef = useRef([]); // AbortControllers for in-flight requests
  const masterAbortRef = useRef(null); // single signal to stop scheduling
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [manageVisible, setManageVisible] = useState(false);
  const [shareOptionsVisible, setShareOptionsVisible] = useState(false);
  const [uploadSelectedPhotos, setUploadSelectedPhotos] = useState(null); // Store selected photos for upload
  const [shareSelectedPhotos, setShareSelectedPhotos] = useState(null); // Store selected photos for share

  // Cleanup old cache on screen focus (runs periodically)
  useFocusEffect(
    React.useCallback(() => {
      // Run cleanup in background (non-blocking)
      (async () => {
        try {
          await cleanupOldCache(30); // Clean up files older than 30 days
        } catch (error) {
          console.error('[GALLERY] Error cleaning up cache:', error);
        }
      })();
    }, [])
  );

  // Invalidate cache when label settings change
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

    // Check if cache needs invalidation (runs once on mount and when settings change)
    (async () => {
      try {
        await invalidateCache(settingsHash);
      } catch (error) {
        console.error('[GALLERY] Error invalidating cache:', error);
      }
    })();
  }, [showLabels, beforeLabelPosition, afterLabelPosition, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily, labelMarginVertical, labelMarginHorizontal]);
  const [deleteFromStorage, setDeleteFromStorage] = useState(true);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false); // retained but unused to avoid modal
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState({ before: true, after: true, combined: true });
  const [selectedShareTypes, setSelectedShareTypes] = useState({ before: true, after: true, combined: true });
  
  // Default: unchecked for all tiers. Users can check/uncheck freely.
  // For starter users, unchecking (when checked) will show tier popup (handled in checkbox onPress)
  const [shareAsArchive, setShareAsArchive] = useState(false);
  
  const [uploadDestinations, setUploadDestinations] = useState({ google: true, dropbox: false }); // Default: Google only
  const [showAdvancedShareFormats, setShowAdvancedShareFormats] = useState(false);
  const [showSharePlanModal, setShowSharePlanModal] = useState(false);
  const [isDropboxConnected, setIsDropboxConnected] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState(() => {
    // Default: only square formats enabled by default
    const initial = {};
    Object.keys(TEMPLATE_CONFIGS).forEach((key) => {
      // All formats disabled by default; selection requires upgrade in advanced section
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

  // Handle navigation parameter to show upload details
  useEffect(() => {
    if (route?.params?.showUploadDetails) {
      setShowUploadDetails(true);
      // Clear the parameter to prevent showing again on subsequent navigations
      navigation.setParams({ showUploadDetails: undefined });
    }
  }, [route?.params?.showUploadDetails, navigation]);

  // Force re-render when photos change (e.g., after project deletion)
  useEffect(() => {
    // This will trigger a re-render when photos change
  }, [photos]);

  // Show completion modal when uploads are completed
  useEffect(() => {
    if (uploadStatus.completedUploads && uploadStatus.completedUploads.length > 0) {
      setShowCompletionModal(true);
    }
  }, [uploadStatus.completedUploads]);

  // Load Dropbox tokens when options modal opens and set default destinations based on connected accounts
  useEffect(() => {
    if (optionsVisible) {
      dropboxAuthService.loadStoredTokens().then(() => {
        const isDropboxAuth = dropboxAuthService.isAuthenticated();
        setIsDropboxConnected(isDropboxAuth);
        
        // Set default destinations: check all connected accounts
        setUploadDestinations({
          google: isAuthenticated, // Check Google if connected
          dropbox: isDropboxAuth   // Check Dropbox if connected
        });
      }).catch(err => {
        console.error('[GALLERY] Error loading Dropbox tokens:', err);
        setIsDropboxConnected(false);
        // Set defaults based on what we know
        setUploadDestinations({
          google: isAuthenticated,
          dropbox: false
        });
      });
    }
  }, [optionsVisible, isAuthenticated]);

  const FREE_FORMATS = new Set([]);
  const handleFormatToggle = (key) => {
    console.log('[GALLERY] handleFormatToggle called with key:', key);
    console.log('[GALLERY] userPlan:', userPlan);
    console.log('[GALLERY] canUse(ADVANCED_TEMPLATES):', canUse(FEATURES.ADVANCED_TEMPLATES));
    console.log('[GALLERY] FEATURES.ADVANCED_TEMPLATES:', FEATURES.ADVANCED_TEMPLATES);
    
    // Check if user has access to advanced templates
    if (!canUse(FEATURES.ADVANCED_TEMPLATES)) {
      console.log('[GALLERY] User does not have access to advanced templates, showing plan modal');
      // Show plan modal on top of share modal
      setShowSharePlanModal(true);
      return;
    }
    try {
      setSelectedFormats(prev => ({ ...prev, [key]: !prev[key] }));
    } catch (e) {
      console.error('[GALLERY] Error toggling format:', e);
    }
  };

  // Long press handlers for full-screen photo
  const handleLongPressStart = (photo, photoSet = null) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      
      // If in selection mode, just toggle selection and don't show preview
      // Use a ref or check state directly to avoid closure issues
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
        // Not in selection mode - enter selection mode (don't show preview)
        // Update ref immediately so handlers can access it right away
        isSelectionModeRef.current = true;
        setIsSelectionMode(true);
        // If a photo was long-pressed, select it
        if (photo) {
          setSelectedPhotos(new Set([photo.id]));
        } else if (photoSet && photoSet.before) {
          const combinedId = `combined_${photoSet.before.id}`;
          setSelectedPhotos(new Set([combinedId]));
        }
        // Don't show preview when entering selection mode via long press
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
    
    // Only delay reset if it was actually a long press
    if (wasLongPress) {
      setTimeout(() => {
        longPressTriggered.current = false;
      }, 100);
    } else {
      // Quick tap - reset immediately so onPress can fire
      longPressTriggered.current = false;
    }
  };

  // PanResponder for swipe down to close
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dy } = gestureState;
        // Detect swipe down
        return dy > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dy } = gestureState;
        const threshold = 100; // Swipe down at least 100px
        
        if (dy > threshold) {
          navigation.goBack();
        }
      }
    })
  ).current;

  // Share individual photo (before or after)
  const shareIndividualPhoto = async (photo) => {
    try {
      setSharing(true);
      
      // Create a temporary file in cache directory for sharing (not permanent storage)
      const tempFileName = `${photo.room}_${photo.name}_${photo.mode}_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: photo.uri, to: tempUri });

      // Share the image
      const shareOptions = {
        title: `${photo.mode === 'before' ? 'Before' : 'After'} Photo - ${photo.name}`,
        message: `Check out this ${photo.mode} photo from ${photo.room}!`,
        url: tempUri,
        type: 'image/jpeg'
      };

      const result = await RNShare.share(shareOptions);
      
      if (result.action === RNShare.sharedAction) {
      } else if (result.action === RNShare.dismissedAction) {
      }
      
      // Clean up temporary file after sharing
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  // Share combined photo (before + after with labels)
  const shareCombinedPhoto = async (photoSet) => {
    try {
      setSharing(true);
      
      // Capture the combined view with labels
      const capturedUri = await captureRef(combinedCaptureRef, {
        format: 'jpg',
        quality: 0.95
      });
      
      // Copy captured image to cache directory to ensure it's temporary
      const tempFileName = `${photoSet.room}_${photoSet.name}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: capturedUri, to: tempUri });

      // Share the image
      const shareOptions = {
        title: `Before/After - ${photoSet.name}`,
        message: `Check out this before/after comparison from ${photoSet.room}!`,
        url: tempUri,
        type: 'image/jpeg'
      };

      const result = await RNShare.share(shareOptions);
      
      if (result.action === RNShare.sharedAction) {
      } else if (result.action === RNShare.dismissedAction) {
      }
      
      // Clean up temporary file after sharing
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
      }
    } catch (error) {
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  const startSharingWithOptions = async () => {
    console.log(`[GALLERY] ========== startSharingWithOptions CALLED ==========`);
    console.log(`[GALLERY] shareAsArchive state: ${shareAsArchive}`);
    console.log(`[GALLERY] showLabels state: ${showLabels}`);
    
    setShareOptionsVisible(false); // Close the modal immediately
    // Don't set sharing to true yet - we'll show it when we start preparing
    
    // Check if we're sharing selected photos
    let sourcePhotos;
    let selectedSets = [];
    if (shareSelectedPhotos) {
      // Use selected photos
      sourcePhotos = shareSelectedPhotos.individual;
      selectedSets = shareSelectedPhotos.sets || [];
      // Reset the selected photos flag after using it
      setShareSelectedPhotos(null);
    } else {
      // Use all photos from project
      sourcePhotos = activeProjectId ? photos.filter(p => p.projectId === activeProjectId) : photos;
    }
    
    if (sourcePhotos.length === 0 && selectedSets.length === 0) {
        Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosInProject'));
        setSharing(false);
        return;
    }

    // Filter before and after photos
    const itemsToShare = sourcePhotos.filter(p =>
        (selectedShareTypes.before && p.mode === PHOTO_MODES.BEFORE) ||
        (selectedShareTypes.after && p.mode === PHOTO_MODES.AFTER)
    );
    
    // If combined photos are selected, find them from file system
    let combinedPhotosToShare = [];
    if (selectedShareTypes.combined) {
        try {
            // First, check if there are selected sets (combined photos directly selected)
            // These don't require both before and after to be in sourcePhotos
            const dir = FileSystem.documentDirectory;
            const entries = await FileSystem.readDirectoryAsync(dir);
            
            for (const photoSet of selectedSets) {
                if (photoSet.before && photoSet.after) {
                    const beforePhoto = photoSet.before;
                    const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
                    const projectId = beforePhoto.projectId;
                    const projectIdSuffix = projectId ? `_P${projectId}` : '';
                    
                    const extractTimestamp = (filename) => {
                        const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                        return match ? parseInt(match[1], 10) : 0;
                    };
                    
                    // Prioritize STACK over SIDE variant
                    const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
                    const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;
                    
                    let newestUri = null;
                    let newestTs = -1;
                    
                    // First, try to find STACK variant
                    const stackMatches = entries.filter(name => {
                        if (!name.startsWith(stackPrefix)) return false;
                        if (projectId && !name.includes(projectIdSuffix)) return false;
                        return true;
                    });
                    
                    for (const filename of stackMatches) {
                        const ts = extractTimestamp(filename);
                        if (ts > newestTs) {
                            newestTs = ts;
                            newestUri = `${dir}${filename}`;
                        }
                    }
                    
                    // Only use SIDE if no STACK found
                    if (!newestUri) {
                        const sideMatches = entries.filter(name => {
                            if (!name.startsWith(sidePrefix)) return false;
                            if (projectId && !name.includes(projectIdSuffix)) return false;
                            return true;
                        });
                        
                        for (const filename of sideMatches) {
                            const ts = extractTimestamp(filename);
                            if (ts > newestTs) {
                                newestTs = ts;
                                newestUri = `${dir}${filename}`;
                            }
                        }
                    }
                    
                    if (newestUri) {
                        // Create a photo object for the combined photo
                        combinedPhotosToShare.push({
                            uri: newestUri,
                            mode: PHOTO_MODES.COMBINED,
                            name: beforePhoto.name,
                            room: beforePhoto.room,
                            projectId: beforePhoto.projectId,
                            beforePhotoId: beforePhoto.id, // Store before photo ID for correct matching
                            id: `combined_${beforePhoto.id}`, // Unique ID for combined photo
                        });
                        console.log(`[GALLERY] Found combined photo from selected set: ${beforePhoto.name} (beforePhotoId: ${beforePhoto.id})`);
                    }
                }
            }
            
            // Also find combined photos based on before/after pairs in sourcePhotos
            const beforePhotos = sourcePhotos.filter(p => p.mode === PHOTO_MODES.BEFORE);
            const afterPhotos = sourcePhotos.filter(p => p.mode === PHOTO_MODES.AFTER);
            
            for (const beforePhoto of beforePhotos) {
                const afterPhoto = afterPhotos.find(p => p.beforePhotoId === beforePhoto.id);
                if (!afterPhoto) continue;
                
                // Skip if already added from selectedSets
                const alreadyAdded = combinedPhotosToShare.some(cp => cp.id === `combined_${beforePhoto.id}`);
                if (alreadyAdded) continue;
                
                const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
                const projectId = beforePhoto.projectId;
                const projectIdSuffix = projectId ? `_P${projectId}` : '';
                
                const extractTimestamp = (filename) => {
                    const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                    return match ? parseInt(match[1], 10) : 0;
                };
                
                // Prioritize STACK over SIDE variant
                const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
                const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;
                
                let newestUri = null;
                let newestTs = -1;
                
                // First, try to find STACK variant
                const stackMatches = entries.filter(name => {
                    if (!name.startsWith(stackPrefix)) return false;
                    if (projectId && !name.includes(projectIdSuffix)) return false;
                    return true;
                });
                
                for (const filename of stackMatches) {
                    const ts = extractTimestamp(filename);
                    if (ts > newestTs) {
                        newestTs = ts;
                        newestUri = `${dir}${filename}`;
                    }
                }
                
                // Only use SIDE if no STACK found
                if (!newestUri) {
                    const sideMatches = entries.filter(name => {
                        if (!name.startsWith(sidePrefix)) return false;
                        if (projectId && !name.includes(projectIdSuffix)) return false;
                        return true;
                    });
                    
                    for (const filename of sideMatches) {
                        const ts = extractTimestamp(filename);
                        if (ts > newestTs) {
                            newestTs = ts;
                            newestUri = `${dir}${filename}`;
                        }
                    }
                }
                
                if (newestUri) {
                    // Create a photo object for the combined photo
                    combinedPhotosToShare.push({
                        uri: newestUri,
                        mode: PHOTO_MODES.COMBINED,
                        name: beforePhoto.name,
                        room: beforePhoto.room,
                        projectId: beforePhoto.projectId,
                        beforePhotoId: beforePhoto.id, // Store before photo ID for correct matching
                        id: `combined_${beforePhoto.id}`, // Unique ID for combined photo
                    });
                }
            }
            
            console.log('[GALLERY] Found combined photos from file system:', combinedPhotosToShare.length);
        } catch (error) {
            console.error('[GALLERY] Error finding combined photos:', error);
        }
    }
    
    // Combine all photos to share
    const allItemsToShare = [...itemsToShare, ...combinedPhotosToShare];
    
    console.log('[GALLERY] Items to share count:', allItemsToShare.length);
    console.log('[GALLERY] Items to share breakdown - Before:', itemsToShare.filter(p => p.mode === PHOTO_MODES.BEFORE).length, 
                'After:', itemsToShare.filter(p => p.mode === PHOTO_MODES.AFTER).length,
                'Combined:', combinedPhotosToShare.length);
    
    if (allItemsToShare.length === 0) {
        Alert.alert(t('gallery.noPhotosSelected'), t('gallery.selectAtLeastOne'));
        setSharing(false);
        return;
    }
    
    const projectName = projects.find(p => p.id === activeProjectId)?.name || 'Shared-Photos';
    const tempFiles = []; // Track temporary files for cleanup
    
    // Calculate settings hash once for all photos (needed for both ZIP and non-ZIP paths)
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
    
    console.log(`[GALLERY] Settings hash calculated: ${settingsHash}, showLabels: ${showLabels}`);
    
    // Check cache for all photos first to determine if we need to show loading
    // Also store cache results to avoid duplicate checks (used for both ZIP and non-ZIP)
    let needsPreparation = false;
    const cachedPhotoUris = new Map(); // Map photo ID to cached URI
    
    if (showLabels) {
        console.log('[GALLERY] Checking cache for all photos before showing loading indicator...');
        for (const item of allItemsToShare) {
            if (item.mode) {
                try {
                    const cachedUri = await getCachedLabeledPhoto(item, settingsHash);
                    if (cachedUri) {
                        // Double-check that the cached file actually exists
                        const fileInfo = await FileSystem.getInfoAsync(cachedUri);
                        if (fileInfo.exists) {
                            // Store the cached URI for reuse
                            cachedPhotoUris.set(item.id, cachedUri);
                            console.log(`[GALLERY] Photo ${item.id} (${item.mode}) found in cache`);
                        } else {
                            console.warn(`[GALLERY] Cache metadata exists but file missing for ${item.id}: ${cachedUri}`);
                            needsPreparation = true;
                            console.log(`[GALLERY] Photo ${item.id} (${item.mode}) needs preparation (cache file missing)`);
                        }
                    } else {
                        needsPreparation = true;
                        console.log(`[GALLERY] Photo ${item.id} (${item.mode}) needs preparation`);
                        // Don't break - continue checking all photos to populate cache map
                    }
                } catch (error) {
                    // If cache check fails, assume preparation is needed
                    needsPreparation = true;
                    console.log(`[GALLERY] Cache check failed for photo ${item.id}, will prepare`);
                }
            }
        }
        console.log(`[GALLERY] Cache check complete. Needs preparation: ${needsPreparation}, Cached: ${cachedPhotoUris.size}/${allItemsToShare.length}`);
    } else {
        // If labels are disabled, no preparation needed - photos can be shared directly
        console.log('[GALLERY] Labels disabled - no preparation needed');
    }
    
    // Helper function to get label text for a photo mode
    const getLabelTextForMode = (mode) => {
        if (mode === PHOTO_MODES.BEFORE) {
            return t('common.before') || 'BEFORE';
        } else if (mode === PHOTO_MODES.AFTER) {
            return t('common.after') || 'AFTER';
        }
        return '';
    };

    // Helper function to convert label position from PhotoLabel format to native format
    const convertLabelPosition = (position) => {
        // PhotoLabel uses positions like "left-top", "right-top", etc.
        // Native module uses "top-left", "top-right", "bottom-left", "bottom-right"
        const positionMap = {
            'left-top': 'top-left',
            'right-top': 'top-right',
            'left-bottom': 'bottom-left',
            'right-bottom': 'bottom-right',
            'top-left': 'top-left',
            'top-right': 'top-right',
            'bottom-left': 'bottom-left',
            'bottom-right': 'bottom-right',
        };
        return positionMap[position] || 'top-left';
    };

    // Helper function to capture a photo with label if showLabels is enabled
    // This is used by both ZIP and non-ZIP sharing paths
    const capturePhotoWithLabel = async (photo, index) => {
        console.log(`[GALLERY] capturePhotoWithLabel called for photo ${index + 1}, mode: ${photo.mode}, id: ${photo.id}`);

        // Check if we already have this photo in cache from the initial check
        if (showLabels && photo.mode && cachedPhotoUris.has(photo.id)) {
            const cachedUri = cachedPhotoUris.get(photo.id);
            console.log(`[GALLERY] ✅ Using cached labeled photo ${index + 1} (${photo.mode}) from initial check: ${cachedUri}`);
            await updateCacheLastUsed(photo);
            return cachedUri;
        }

        // If not in initial cache check, check cache now (for photos that weren't checked initially)
        if (showLabels && photo.mode) {
            try {
                console.log(`[GALLERY] Checking cache for photo ${index + 1} (${photo.mode}), photoId: ${photo.id}, settingsHash: ${settingsHash}`);
                const cachedUri = await getCachedLabeledPhoto(photo, settingsHash);
                if (cachedUri) {
                    console.log(`[GALLERY] ✅ Using cached labeled photo ${index + 1} (${photo.mode}): ${cachedUri}`);
                    await updateCacheLastUsed(photo);
                    return cachedUri;
                } else {
                    console.log(`[GALLERY] ❌ No cache found for photo ${index + 1} (${photo.mode}), will prepare now`);
                }
            } catch (cacheError) {
                console.error(`[GALLERY] Error checking cache for photo ${index + 1}:`, cacheError);
                // Continue with preparation if cache check fails
            }
        }

        // Handle combined photos specially - need to find before and after photos
        if (photo.mode === PHOTO_MODES.COMBINED || photo.mode === 'mix' || photo.mode === 'combined') {
            // Find the corresponding before and after photos using beforePhotoId if available
            const beforePhoto = photo.beforePhotoId
                ? photos.find(p => p.id === photo.beforePhotoId)
                : photos.find(p =>
                    p.mode === PHOTO_MODES.BEFORE &&
                    p.name === photo.name &&
                    p.room === photo.room &&
                    p.projectId === photo.projectId
                );
            const afterPhoto = photos.find(p =>
                p.mode === PHOTO_MODES.AFTER &&
                p.beforePhotoId === beforePhoto?.id &&
                p.projectId === photo.projectId
            );

            console.log(`[GALLERY] Reconstructing combined photo: ${photo.name} (beforePhotoId: ${photo.beforePhotoId}) - Found before: ${!!beforePhoto}, after: ${!!afterPhoto}`);

            if (beforePhoto && afterPhoto && showLabels) {
                // Use native compositor to recreate combined photo with labels at full resolution
                try {
                    // Get dimensions of before photo to determine layout
                    // NOTE: For file:// URIs, Image.getSize returns actual pixel dimensions directly (no PixelRatio needed)
                    const beforeDimensions = await new Promise((resolve, reject) => {
                        Image.getSize(beforePhoto.uri,
                            (width, height) => resolve({ width, height }),
                            (error) => reject(error)
                        );
                    });

                    const combinedDimensions = await new Promise((resolve, reject) => {
                        Image.getSize(photo.uri,
                            (width, height) => {
                                console.log(`[GALLERY] Combined photo dimensions: ${width}x${height}`);
                                resolve({ width, height });
                            },
                            (error) => reject(error)
                        );
                    });

                    // Determine layout (STACK or SIDE)
                    const isStack = combinedDimensions.height > combinedDimensions.width;
                    const layout = isStack ? 'STACK' : 'SIDE';

                    // Prepare dimensions for native compositor
                    const dimensions = {
                        width: combinedDimensions.width,
                        height: combinedDimensions.height,
                        topH: isStack ? Math.round(combinedDimensions.height / 2) : null,
                        bottomH: isStack ? Math.round(combinedDimensions.height / 2) : null,
                        leftW: !isStack ? Math.round(combinedDimensions.width / 2) : null,
                        rightW: !isStack ? Math.round(combinedDimensions.width / 2) : null,
                    };

                    console.log(`[GALLERY] Recreating combined photo with native compositor: layout=${layout}, dimensions=`, dimensions);

                    // First, composite the unlabeled photos
                    console.log(`[GALLERY] Step 1: Compositing unlabeled before/after photos for combined photo ${index + 1}`);
                    const unlabeledCombinedUri = await compositeImages(
                        beforePhoto.uri,
                        afterPhoto.uri,
                        layout,
                        dimensions
                    );

                    // Now add labels to the combined photo (same approach as GlobalBackgroundLabelPreparation)
                    const labelSizeMap = {
                        small: 48,
                        medium: 56,
                        large: 64,
                    };
                    const fontSize = labelSizeMap[labelSize] || 56;

                    // Calculate half dimensions for label position offsets
                    const halfWidth = Math.round(combinedDimensions.width / 2);
                    const halfHeight = Math.round(combinedDimensions.height / 2);

                    // Before label config - no adjustments needed (positioned in top-left half)
                    const beforeLabelConfig = {
                        position: convertLabelPosition(beforeLabelPosition || 'left-top'),
                        backgroundColor: labelBackgroundColor || '#FFD700',
                        textColor: labelTextColor || '#000000',
                        fontSize: fontSize,
                        marginHorizontal: labelMarginHorizontal || 20,
                        marginVertical: labelMarginVertical || 20,
                        padding: 16,
                    };

                    // After label config - needs position adjustments based on layout
                    // We use offsetX/offsetY to shift the After label to the correct half.
                    // The native code handles all margin scaling, keeping labels proportional.
                    const afterPosition = convertLabelPosition(afterLabelPosition || 'right-top');

                    // Use shared function for offset calculation (single source of truth)
                    const { offsetX, offsetY } = calculateAfterLabelOffsets(afterPosition, isStack, halfWidth, halfHeight);

                    const afterLabelConfig = {
                        position: afterPosition,
                        backgroundColor: labelBackgroundColor || '#FFD700',
                        textColor: labelTextColor || '#000000',
                        fontSize: fontSize,
                        marginHorizontal: labelMarginHorizontal || 20,
                        marginVertical: labelMarginVertical || 20,
                        padding: 16,
                        offsetX,
                        offsetY,
                    };

                    console.log(`[GALLERY] Step 2: Adding BEFORE label to combined photo ${index + 1}`);
                    const withBeforeLabelUri = await addLabelToImage(
                        unlabeledCombinedUri,
                        getLabelTextForMode(PHOTO_MODES.BEFORE),
                        beforeLabelConfig
                    );

                    console.log(`[GALLERY] Step 3: Adding AFTER label to combined photo ${index + 1}, config:`, {
                        position: afterLabelConfig.position,
                        marginH: afterLabelConfig.marginHorizontal,
                        marginV: afterLabelConfig.marginVertical,
                        offsetX: afterLabelConfig.offsetX || 0,
                        offsetY: afterLabelConfig.offsetY || 0,
                        absoluteMargins: afterLabelConfig.absoluteMargins || false,
                    });
                    const combinedUri = await addLabelToImage(
                        withBeforeLabelUri,
                        getLabelTextForMode(PHOTO_MODES.AFTER),
                        afterLabelConfig
                    );

                    console.log(`[GALLERY] ✅ Combined photo ${index + 1} created with native compositor: ${combinedUri}`);

                    // Cache the combined photo
                    try {
                        const savedCacheUri = await saveCachedLabeledPhoto(photo, combinedUri, settingsHash);
                        if (savedCacheUri) {
                            console.log(`[GALLERY] ✅ Combined photo ${index + 1} saved to cache: ${savedCacheUri}`);
                            return savedCacheUri;
                        }
                    } catch (cacheError) {
                        console.warn(`[GALLERY] Failed to cache combined photo ${index + 1}:`, cacheError);
                    }

                    return combinedUri;
                } catch (error) {
                    console.error(`[GALLERY] Error creating combined photo ${index + 1} with native compositor:`, error);
                    // Fall back to original combined photo
                    const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
                    const tempUri = FileSystem.cacheDirectory + tempFileName;
                    await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
                    return tempUri;
                }
            } else {
                // No labels or couldn't find before/after photos, just copy original
                const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
                const tempUri = FileSystem.cacheDirectory + tempFileName;
                await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
                return tempUri;
            }
        }
        
        if (!showLabels || !photo.mode) {
            // No labels needed, just copy the original
            const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
            const tempUri = FileSystem.cacheDirectory + tempFileName;
            await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
            return tempUri;
        }

        // Add label using native module at full resolution
        try {
            // Determine label position based on photo mode
            let labelPosition;
            if (photo.mode === PHOTO_MODES.BEFORE) {
                labelPosition = convertLabelPosition(beforeLabelPosition || 'left-top');
            } else if (photo.mode === PHOTO_MODES.AFTER) {
                labelPosition = convertLabelPosition(afterLabelPosition || 'right-top');
            } else {
                labelPosition = 'top-left'; // Default
            }

            // Get label text
            const labelText = getLabelTextForMode(photo.mode);

            // Map label size to font size
            const labelSizeMap = {
                small: 48,
                medium: 56,
                large: 64,
            };
            const fontSize = labelSizeMap[labelSize] || 56;

            // Build label configuration
            const labelConfig = {
                position: labelPosition,
                backgroundColor: labelBackgroundColor || '#FFD700',
                textColor: labelTextColor || '#000000',
                fontSize: fontSize,
                marginHorizontal: labelMarginHorizontal || 20,
                marginVertical: labelMarginVertical || 20,
                padding: 16,
            };

            console.log(`[GALLERY] Adding native label to photo ${index + 1}: "${labelText}" at position ${labelPosition}`);

            // Add label using native module
            const labeledUri = await addLabelToImage(photo.uri, labelText, labelConfig);

            console.log(`[GALLERY] ✅ Native label added to photo ${index + 1}: ${labeledUri}`);

            // Cache the labeled photo
            try {
                const savedCacheUri = await saveCachedLabeledPhoto(photo, labeledUri, settingsHash);
                if (savedCacheUri) {
                    console.log(`[GALLERY] ✅ Labeled photo ${index + 1} saved to cache: ${savedCacheUri}`);
                    return savedCacheUri;
                }
            } catch (cacheError) {
                console.warn(`[GALLERY] Failed to cache labeled photo ${index + 1}:`, cacheError);
            }

            // Return labeled photo URI
            return labeledUri;
        } catch (error) {
            console.error(`[GALLERY] Error adding native label to photo ${index + 1}:`, error);
            // Fall back to original photo
            const tempFileName = `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}.jpg`;
            const tempUri = FileSystem.cacheDirectory + tempFileName;
            await FileSystem.copyAsync({ from: photo.uri, to: tempUri });
            return tempUri;
        }
    };
    
    try {
        if (shareAsArchive) {
            // For ZIP, only show loading if preparation is actually needed
            // (Copying cached files to ZIP is fast and doesn't need a spinner)
            if (needsPreparation) {
                console.log('[GALLERY] Showing loading spinner for ZIP - some photos need preparation');
                setSharing(true);
            } else {
                console.log('[GALLERY] All photos cached for ZIP - skipping loading spinner');
            }
            
            // Share as ZIP archive
            const zipFileName = `${projectName.replace(/\s+/g, '_')}_${Date.now()}.zip`;
            const zipPath = FileSystem.cacheDirectory + zipFileName;
            const zip = new JSZip();
            
            for (const item of allItemsToShare) {
                // Use cached labeled photo if available, otherwise use original
                let photoUri = item.uri;
                if (showLabels && cachedPhotoUris.has(item.id)) {
                    const cachedUri = cachedPhotoUris.get(item.id);
                    console.log(`[GALLERY] Using cached labeled photo ${item.id} for ZIP: ${cachedUri.substring(0, 80)}...`);
                    photoUri = cachedUri;
                    await updateCacheLastUsed(item);
                } else if (showLabels && item.mode && needsPreparation) {
                    // Need to prepare this photo with labels
                    console.log(`[GALLERY] Preparing photo ${item.id} (${item.mode}) for ZIP...`);
                    const preparedUri = await capturePhotoWithLabel(item, allItemsToShare.indexOf(item));
                    if (preparedUri) {
                        photoUri = preparedUri;
                        // Save to cache for future use
                        try {
                            const cachedUri = await saveCachedLabeledPhoto(item, preparedUri, settingsHash);
                            if (cachedUri) {
                                console.log(`[GALLERY] ✅ Saved photo ${item.id} to cache: ${cachedUri}`);
                                cachedPhotoUris.set(item.id, cachedUri);
                            }
                        } catch (cacheError) {
                            console.error(`[GALLERY] Error saving to cache:`, cacheError);
                        }
                    }
                }
                
                // Copy photo to temp location first to ensure it's accessible
                const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                const tempUri = FileSystem.cacheDirectory + tempFileName;
                await FileSystem.copyAsync({ from: photoUri, to: tempUri });
                tempFiles.push(tempUri);
                
                const filename = photoUri.split('/').pop();
                const content = await FileSystem.readAsStringAsync(tempUri, {
                    encoding: FileSystem.EncodingType.Base64,
                });
                zip.file(filename, content, { base64: true });
            }
            
            const zipBase64 = await zip.generateAsync({ type: 'base64' });
            await FileSystem.writeAsStringAsync(zipPath, zipBase64, {
                encoding: FileSystem.EncodingType.Base64,
            });
            tempFiles.push(zipPath);
            
            // Use react-native-share for ZIP file as well for better compatibility
            console.log('[GALLERY] Starting to share ZIP file:', zipPath);
            try {
                const sharePromise = Share.open({
                    url: zipPath,
                    title: `Share ${projectName} Photos`,
                    message: `Here are the photos from the project: ${projectName}`,
                    type: 'application/zip',
                });
                
                // Add a timeout to detect if Share.open hangs
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error('Share operation timed out after 30 seconds'));
                    }, 30000); // 30 second timeout
                });
                
                const result = await Promise.race([sharePromise, timeoutPromise]);
                console.log('[GALLERY] ZIP share completed successfully:', result);
            } catch (shareError) {
                // Check if user cancelled first - don't log cancellation as error
                const isUserCancellation = shareError?.message?.includes('User did not share') || 
                    shareError?.message?.includes('cancelled') ||
                    shareError?.message?.includes('User Cancel') ||
                    shareError?.code === 'E_USER_CANCELLED';
                
                if (isUserCancellation) {
                    // User cancelled - this is normal, not an error
                    console.log('[GALLERY] User cancelled sharing ZIP');
                    return; // Exit gracefully
                } else if (shareError?.message?.includes('timed out')) {
                    // Timeout - show error but don't rethrow
                    console.error('[GALLERY] ZIP share operation timed out');
                    Alert.alert(t('common.error'), 'Share operation took too long. Please try again.');
                } else {
                    // Real error - log and rethrow
                    console.error('[GALLERY] ZIP share error caught:', shareError);
                    console.error('[GALLERY] Error message:', shareError?.message);
                    throw shareError;
                }
            }
        } else {
            // Share multiple photos as individual files using react-native-share
            console.log(`[GALLERY] ========== STARTING SHARING (NOT ARCHIVE) ==========`);
            console.log(`[GALLERY] shareAsArchive: ${shareAsArchive}, allItemsToShare.length: ${allItemsToShare.length}`);
            console.log(`[GALLERY] showLabels: ${showLabels}`);
            // Note: settingsHash, needsPreparation, and cachedPhotoUris are already calculated above
            
            // Only show loading indicator if preparation is actually needed
            // Don't show spinner if all photos are cached (fast path)
            if (needsPreparation) {
                console.log('[GALLERY] Showing loading spinner - some photos need preparation');
                setSharing(true);
            } else {
                console.log('[GALLERY] All photos cached or no labels - skipping loading spinner');
            }
            
            // Process all photos to add labels if needed
            const urls = [];

            // Fast path: If all photos are already cached, use them directly without processing
            let allCached = showLabels && cachedPhotoUris.size === allItemsToShare.length && !needsPreparation;
            if (allCached) {
                console.log(`[GALLERY] All ${allItemsToShare.length} photos are cached, using cached URIs directly (fast path)`);
                for (const item of allItemsToShare) {
                    const cachedUri = cachedPhotoUris.get(item.id);
                    if (cachedUri) {
                        // Verify cached file exists
                        const fileInfo = await FileSystem.getInfoAsync(cachedUri);
                        if (fileInfo.exists) {
                            urls.push(cachedUri);
                            await updateCacheLastUsed(item);
                            console.log(`[GALLERY] ✅ Using cached photo ${item.id} (${item.mode}): ${cachedUri.substring(0, 80)}...`);
                        } else {
                            console.error(`[GALLERY] Cached file does not exist: ${cachedUri}`);
                            // Fall through to normal processing for this photo
                            allCached = false;
                            urls.length = 0; // Clear the array
                            break;
                        }
                    } else {
                        console.error(`[GALLERY] No cached URI found for photo ${item.id}`);
                        // Fall through to normal processing for this photo
                        allCached = false;
                        urls.length = 0; // Clear the array
                        break;
                    }
                }
                
                if (allCached && urls.length === allItemsToShare.length) {
                    console.log(`[GALLERY] Successfully prepared ${urls.length} cached photos for sharing (fast path)`);
                    // Skip the processing loop and go directly to sharing
                } else if (!allCached) {
                    // Some photos failed validation, need to process normally
                    console.log(`[GALLERY] Fast path failed, falling back to normal processing`);
                }
            }

            // Process all photos sequentially (important for label capture)
                // Skip this loop if we already have all cached photos (fast path)
                if (!allCached || urls.length === 0) {
                    console.log(`[GALLERY] Starting to process ${allItemsToShare.length} photos for sharing...`);
                    for (let i = 0; i < allItemsToShare.length; i++) {
                        const item = allItemsToShare[i];
                        console.log(`[GALLERY] Processing photo ${i + 1}/${allItemsToShare.length}: mode=${item.mode}, id=${item.id}`);
                        try {
                            // Verify source file exists before processing
                            const sourceInfo = await FileSystem.getInfoAsync(item.uri);
                            if (!sourceInfo.exists) {
                                console.error(`[GALLERY] Source file does not exist: ${item.uri}`);
                                continue;
                            }
                            
                            // Process photo (with or without labels)
                            // This will wait for label capture to complete if labels are enabled
                            console.log(`[GALLERY] Calling capturePhotoWithLabel for photo ${i + 1}...`);
                            const tempUri = await capturePhotoWithLabel(item, i);
                            console.log(`[GALLERY] capturePhotoWithLabel returned for photo ${i + 1}: ${tempUri?.substring(0, 100)}...`);
                            
                            // Verify processed file exists
                            const tempInfo = await FileSystem.getInfoAsync(tempUri);
                            if (!tempInfo.exists) {
                                console.error(`[GALLERY] Failed to process file: ${item.uri} to ${tempUri}`);
                                continue;
                            }
                            
                            // Save to cache if it was just prepared (not from cache)
                            // Check if this URI is already in cache by checking if it contains the cache directory
                            const cacheDir = getCacheDir();
                            const isFromCache = tempUri.includes('_labeled_cache/') || tempUri.includes(cacheDir);
                            console.log(`[GALLERY] Photo ${i + 1} - isFromCache: ${isFromCache}, tempUri: ${tempUri.substring(0, 100)}...`);
                            if (showLabels && item.mode && !isFromCache) {
                                // This is a newly prepared photo, save it to cache for future use
                                try {
                                    console.log(`[GALLERY] Saving photo ${i + 1} (${item.mode}, id: ${item.id}) to cache...`);
                                    const cachedUri = await saveCachedLabeledPhoto(item, tempUri, settingsHash);
                                    if (cachedUri) {
                                        console.log(`[GALLERY] ✅ Successfully saved photo ${i + 1} to cache: ${cachedUri}`);
                                    } else {
                                        console.log(`[GALLERY] ⚠️ Failed to save photo ${i + 1} to cache`);
                                    }
                                } catch (cacheError) {
                                    console.error(`[GALLERY] Error saving to cache:`, cacheError);
                                    // Continue even if cache save fails
                                }
                            } else if (isFromCache) {
                                console.log(`[GALLERY] Photo ${i + 1} is already from cache, skipping save`);
                            } else {
                                console.log(`[GALLERY] Photo ${i + 1} - not saving to cache (showLabels: ${showLabels}, mode: ${item.mode})`);
                            }
                            
                            tempFiles.push(tempUri);
                            // Keep full file:// URI for react-native-share
                            urls.push(tempUri);
                            console.log(`[GALLERY] Processed photo ${i + 1} (${item.mode || 'unknown'}): ${tempUri}`);
                            
                            // Longer delay between processing to ensure label capture completes
                            // This is especially important when labels are enabled
                            if (i < allItemsToShare.length - 1) {
                                if (showLabels && item.mode) {
                                    // If labels were applied, wait longer for capture to complete
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                } else {
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                }
                            }
                        } catch (copyError) {
                            console.error(`[GALLERY] Error processing photo ${i + 1}:`, copyError);
                            console.error(`[GALLERY] Source URI: ${item.uri}`);
                            // Continue with next photo
                        }
                    }
                }
                
                if (urls.length === 0) {
                    Alert.alert(t('common.error'), 'No photos could be prepared for sharing');
                    return;
                }
                
                console.log(`[GALLERY] Successfully prepared ${urls.length} photos for sharing`);
                
                // Close loading popup before opening share sheet (if it was shown)
                // This ensures it closes even if Share.open() blocks
                if (needsPreparation) {
                    setSharing(false);
                }
                
                // Share multiple photos using react-native-share
                // Use urls parameter to share all photos at once (same approach that worked for 8 photos)
                console.log('[GALLERY] Starting to share', urls.length, 'photos together');
                
                // Add a small delay before sharing to ensure UI is ready
                await new Promise(resolve => InteractionManager.runAfterInteractions(resolve));
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Share all photos at once using urls parameter
                // Wrap in requestAnimationFrame to ensure it runs on main thread
                try {
                    console.log('[GALLERY] About to call Share.open() with', urls.length, 'photos');
                    console.log('[GALLERY] First photo URI:', urls[0]);
                    console.log('[GALLERY] Last photo URI:', urls[urls.length - 1]);

                    // On Android, copy files to shareable cache directory with clean filenames
                    let shareUrls = urls;
                    if (Platform.OS === 'android') {
                        console.log('[GALLERY] Copying files to shareable cache for Android...');
                        const tempUrls = [];
                        for (let i = 0; i < urls.length; i++) {
                            const uri = urls[i];
                            try {
                                // Create simple, clean filename without spaces or special chars
                                const timestamp = Date.now();
                                const randomId = Math.random().toString(36).substring(7);
                                const cleanFilename = `photo_${i + 1}_${timestamp}_${randomId}.jpg`;
                                const tempUri = `${FileSystem.cacheDirectory}${cleanFilename}`;
                                await FileSystem.copyAsync({ from: uri, to: tempUri });
                                tempUrls.push(tempUri);
                                console.log(`[GALLERY] Copied photo ${i + 1} to: ${cleanFilename}`);
                            } catch (copyErr) {
                                console.error('[GALLERY] Failed to copy file:', uri, copyErr);
                                tempUrls.push(uri); // Fallback to original
                            }
                        }
                        shareUrls = tempUrls;
                        tempFiles.push(...shareUrls); // Track for cleanup
                        console.log('[GALLERY] Copied', shareUrls.length, 'files to shareable cache with clean names');
                    }

                    const shareResult = await new Promise((resolve, reject) => {
                        requestAnimationFrame(async () => {
                            try {
                                const result = await Share.open({
                                    urls: shareUrls,
                                    title: `Share ${projectName} Photos`,
                                    message: `Sharing ${shareUrls.length} photos from ${projectName}`,
                                    type: 'image/*',
                                    failOnCancel: false,
                                    forceDialog: true, // Android: Forces the system share sheet, helping with back navigation
                                });
                                resolve(result);
                            } catch (error) {
                                reject(error);
                            }
                        });
                    });
                    
                    console.log('[GALLERY] Share result:', shareResult);
                    console.log('[GALLERY] All photos shared successfully');
                } catch (shareError) {
                    // Check if user cancelled before logging as error
                    const isUserCancellation = shareError?.message?.includes('User did not share') || 
                        shareError?.message?.includes('cancelled') ||
                        shareError?.message?.includes('User Cancel') ||
                        shareError?.code === 'E_USER_CANCELLED';
                    
                    if (isUserCancellation) {
                        // User cancelled - this is normal, not an error
                        console.log('[GALLERY] User cancelled sharing - this is normal if share sheet was dismissed');
                        return; // Exit gracefully, no error handling needed
                    }
                    
                    // Real error occurred
                    console.error('[GALLERY] Error sharing photos:', shareError);
                    console.error('[GALLERY] Error message:', shareError?.message);
                    console.error('[GALLERY] Error code:', shareError?.code);
                    console.log('[GALLERY] Batch share failed with error, falling back to one by one...');
                    // Fallback to one by one sharing
                        for (let i = 0; i < urls.length; i++) {
                            try {
                                console.log(`[GALLERY] Sharing photo ${i + 1}/${urls.length}...`);

                                await Share.open({
                                    url: urls[i],
                                    title: `${projectName} Photo ${i + 1}/${urls.length}`,
                                    message: `Photo ${i + 1} of ${urls.length} from ${projectName}`,
                                    type: 'image/jpeg',
                                    failOnCancel: false,
                                });
                                
                                console.log(`[GALLERY] Photo ${i + 1} shared successfully`);
                                
                                // Small delay between shares
                                if (i < urls.length - 1) {
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                }
                            } catch (singleShareError) {
                                // Check if user cancelled
                                const isUserCancellation = singleShareError?.message?.includes('User did not share') || 
                                    singleShareError?.message?.includes('cancelled') ||
                                    singleShareError?.message?.includes('User Cancel') ||
                                    singleShareError?.code === 'E_USER_CANCELLED';
                                
                                if (isUserCancellation) {
                                    console.log(`[GALLERY] User cancelled sharing photo ${i + 1} - stopping one-by-one sharing`);
                                    return; // Exit gracefully if user cancels
                                }
                                
                                // Real error - log it but continue with next photo
                                console.error(`[GALLERY] Error sharing photo ${i + 1}:`, singleShareError);
                            }
                        }
                    }
                
            console.log('[GALLERY] Finished sharing all photos');
        }
        
        // analyticsService.logEvent('Project_Shared', { 
        //   projectName, 
        //   photoCount: itemsToShare.length,
        //   sharedTypes: Object.keys(selectedShareTypes).filter(k => selectedShareTypes[k]),
        // });
    } catch (error) {
        console.error('[GALLERY] Share error:', error);
        Alert.alert(t('common.error'), t('gallery.prepareShareError'));
    } finally {
        // Always close the loading popup
        setSharing(false);
        
        // Clean up temporary files after a delay (to allow sharing to complete)
        setTimeout(async () => {
            for (const tempFile of tempFiles) {
                try {
                    const fileInfo = await FileSystem.getInfoAsync(tempFile);
                    if (fileInfo.exists) {
                        await FileSystem.deleteAsync(tempFile, { idempotent: true });
                    }
                } catch (cleanupError) {
                    // Ignore cleanup errors
                }
            }
        }, 5000); // 5 second delay to allow sharing to complete
    }
  };

  const handleShareProject = async () => {
    // Check if we're sharing selected photos
    let sourcePhotos;
    if (shareSelectedPhotos) {
      // Use selected photos
      sourcePhotos = shareSelectedPhotos.individual;
      // Reset the selected photos flag after using it
      setShareSelectedPhotos(null);
    } else {
      // Use all photos from project
      sourcePhotos = activeProjectId ? photos.filter(p => p.projectId === activeProjectId) : photos;
    }
    
    if (sourcePhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosInProject'));
      return;
    }
    setShareOptionsVisible(true);
  };

  const handleUploadPhotos = async () => {
    console.log('[UPLOAD] handleUploadPhotos called');
    console.log('[UPLOAD] Photos count:', photos.length);
    console.log('[UPLOAD] User mode:', userMode);
    console.log('[UPLOAD] User plan:', userPlan);
    console.log('[UPLOAD] User name:', userName);
    console.log('[UPLOAD] Team info:', teamInfo);
    
    // Check if there are photos to upload (always check this first)
    if (photos.length === 0) {
      console.log('[UPLOAD] No photos to upload, showing alert');
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosToUpload'));
      return;
    }

    // Load Dropbox tokens before checking authentication
    await dropboxAuthService.loadStoredTokens();

    // Check if at least one upload service is available (Google Drive or Dropbox)
    const hasGoogle = isAuthenticated;
    const hasDropbox = dropboxAuthService.isAuthenticated();
    console.log('[UPLOAD] Has Google:', hasGoogle);
    console.log('[UPLOAD] Has Dropbox:', hasDropbox);
    
    if (!hasGoogle && !hasDropbox) {
      console.log('[UPLOAD] No upload service available, showing custom modal');
      setUploadAlertConfig({
        title: t('gallery.noUploadServiceTitle'),
        message: t('gallery.noUploadServiceMessage'),
        onGoToSettings: () => {
          console.log('[UPLOAD] onGoToSettings callback called');
          console.log('[UPLOAD] Closing modal first');
          setShowUploadAlertModal(false);
          // Close modal first, then navigate after a delay to ensure modal is fully closed
          setTimeout(() => {
            console.log('[UPLOAD] Executing navigation to Settings');
            try {
              // Since Gallery is a fullScreenModal, we need to go back first, then navigate
              navigation.goBack();
              setTimeout(() => {
                console.log('[UPLOAD] Navigating to Settings from parent screen');
                navigation.navigate('Settings', { scrollToCloudSync: true });
                console.log('[UPLOAD] Navigation call completed');
              }, 100);
            } catch (error) {
              console.error('[UPLOAD] Navigation error:', error);
            }
          }, 300);
        }
      });
      setShowUploadAlertModal(true);
      return;
    }

    // Check if user info is configured (required for uploads)
    if (!userName) {
      console.log('[UPLOAD] User name not configured, showing alert');
      Alert.alert(
        t('gallery.setupRequiredTitle'),
        t('gallery.setupNameMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('gallery.goToSettings'), onPress: () => navigation.navigate('Settings') }
        ]
      );
      return;
    }

    // Handle team member upload
    if (userMode === 'team_member') {
      console.log('[UPLOAD] Team member mode detected');
      if (teamInfo && teamInfo.sessionId && teamInfo.token) {
        console.log('[UPLOAD] Team info available, setting destinations and opening options');
        // Set default destinations based on available services
        setUploadDestinations({
          google: hasGoogle,
          dropbox: hasDropbox && !hasGoogle // Default to Dropbox if Google not available
        });
        console.log('[UPLOAD] Upload destinations set:', { google: hasGoogle, dropbox: hasDropbox && !hasGoogle });
        setOptionsVisible(true);
        return;
      } else {
        console.log('[UPLOAD] Team info missing, showing alert');
        Alert.alert(t('common.error'), t('gallery.teamInfoMissing'));
      }
      return;
    }

    // For Pro/Business/Enterprise users (individual mode or authenticated without team)
    const shouldUseDirectDrive = userMode === 'individual' || 
      (isAuthenticated && (userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') && !teamInfo);
    console.log('[UPLOAD] Should use direct drive:', shouldUseDirectDrive);
    
    if (shouldUseDirectDrive) {
      console.log('[UPLOAD] Direct drive path');
      // If Google is authenticated, try to ensure Google Drive folder exists
      if (hasGoogle) {
        console.log('[UPLOAD] Google authenticated, finding/creating folder');
        try {
          const userFolderId = await googleDriveService.findOrCreateProofPixFolder();
          console.log('[UPLOAD] Google folder ID:', userFolderId);
          if (!userFolderId) {
            // If Google folder creation fails, but Dropbox is available, allow Dropbox only
            if (hasDropbox) {
              console.log('[UPLOAD] Google folder creation failed, falling back to Dropbox');
              setUploadDestinations({
                google: false,
                dropbox: true
              });
              setOptionsVisible(true);
              return;
            }
            console.log('[UPLOAD] Google folder creation failed and no Dropbox, showing error');
            Alert.alert(t('common.error'), t('gallery.driveFolderError'));
            return;
          }
        } catch (error) {
          console.log('[UPLOAD] Google Drive access error:', error);
          // If Google Drive access fails, but Dropbox is available, allow Dropbox only
          if (hasDropbox) {
            setUploadDestinations({
              google: false,
              dropbox: true
            });
            setOptionsVisible(true);
            return;
          }
          Alert.alert(t('common.error'), t('gallery.driveAccessError'));
          return;
        }
      }

      // Set default destinations based on available services
      console.log('[UPLOAD] Setting default destinations and opening options');
      setUploadDestinations({
        google: hasGoogle,
        dropbox: hasDropbox && !hasGoogle // Default to Dropbox if Google not available
      });
      console.log('[UPLOAD] Upload destinations set:', { google: hasGoogle, dropbox: hasDropbox && !hasGoogle });

      // Open options modal
      console.log('[UPLOAD] Opening options modal');
      setOptionsVisible(true);
      return;
    }

    // For admin mode - use configured folder and proxy session
    let config = null;
    if (userMode === 'admin' && folderId && proxySessionId) {
      // Use admin's configured folder and proxy session
      config = { folderId, useDirectDrive: true, sessionId: proxySessionId };
    } else {
      // Fallback to location-based config (folderId only, no scriptUrl)
      const locationConfig = getLocationConfig(location);
      config = { folderId: locationConfig?.folderId, useDirectDrive: false };
    }

    // Check if Google Drive is configured
    // For proxy server uploads, we need folderId and sessionId
    // For location-based uploads, we need folderId (legacy support)
    const hasGoogleConfig = config && config.folderId && (!config.useDirectDrive || config.sessionId);

    // If Google is not configured but Dropbox is available, allow Dropbox only
    if (!hasGoogleConfig && hasDropbox) {
      setUploadDestinations({
        google: false,
        dropbox: true
      });
      setOptionsVisible(true);
      return;
    }

    // If neither Google nor Dropbox is available, show error
    if (!hasGoogleConfig && !hasDropbox) {
      Alert.alert(
        t('gallery.setupRequiredTitle'),
        t('gallery.driveConfigMissing'),
        [
          { text: t('common.ok'), style: 'cancel' }
        ]
      );
      return;
    }

    // Set default destinations based on available services
    setUploadDestinations({
      google: hasGoogleConfig,
      dropbox: hasDropbox && !hasGoogleConfig // Default to Dropbox if Google not configured
    });

    // Open options modal
    setOptionsVisible(true);
  };

  const startUploadWithOptions = async () => {
    console.log('[UPLOAD] startUploadWithOptions called');
    console.log('[UPLOAD] Upload destinations:', uploadDestinations);
    try {
      // Check if at least one destination is selected
      if (!uploadDestinations.google && !uploadDestinations.dropbox) {
        console.log('[UPLOAD] No destination selected, showing alert');
        Alert.alert(
          t('gallery.noDestinationSelected'),
          t('gallery.selectAtLeastOneDestination')
        );
        return;
      }

      // Check authentication for selected destinations
      console.log('[UPLOAD] Checking Google authentication:', { selected: uploadDestinations.google, authenticated: isAuthenticated });
      if (uploadDestinations.google && !isAuthenticated) {
        console.log('[UPLOAD] Google not authenticated, showing custom modal');
        setUploadAlertConfig({
          title: t('gallery.googleNotConnected'),
          message: t('gallery.googleNotConnectedMessage'),
          onGoToSettings: () => {
            console.log('[UPLOAD] onGoToSettings callback called (from Google check)');
            console.log('[UPLOAD] Closing modal first');
            setShowUploadAlertModal(false);
            setTimeout(() => {
              console.log('[UPLOAD] Executing navigation to Settings');
              try {
                // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                navigation.goBack();
                setTimeout(() => {
                  console.log('[UPLOAD] Navigating to Settings from parent screen');
                  navigation.navigate('Settings', { scrollToCloudSync: true });
                  console.log('[UPLOAD] Navigation call completed');
                }, 100);
              } catch (error) {
                console.error('[UPLOAD] Navigation error:', error);
              }
            }, 300);
          }
        });
        setShowUploadAlertModal(true);
        return;
      }

      // Load Dropbox tokens before checking authentication
      await dropboxAuthService.loadStoredTokens();
      const isDropboxAuth = dropboxAuthService.isAuthenticated();
      console.log('[UPLOAD] Checking Dropbox authentication:', { selected: uploadDestinations.dropbox, authenticated: isDropboxAuth });
      if (uploadDestinations.dropbox && !isDropboxAuth) {
        console.log('[UPLOAD] Dropbox not authenticated, showing custom modal');
        setUploadAlertConfig({
          title: t('gallery.dropboxNotConnected'),
          message: t('gallery.dropboxNotConnectedMessage'),
          onGoToSettings: () => {
            console.log('[UPLOAD] onGoToSettings callback called (from Dropbox check)');
            console.log('[UPLOAD] Closing modal first');
            setShowUploadAlertModal(false);
            setTimeout(() => {
              console.log('[UPLOAD] Executing navigation to Settings');
              try {
                // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                navigation.goBack();
                setTimeout(() => {
                  console.log('[UPLOAD] Navigating to Settings from parent screen');
                  navigation.navigate('Settings', { scrollToCloudSync: true });
                  console.log('[UPLOAD] Navigation call completed');
                }, 100);
              } catch (error) {
                console.error('[UPLOAD] Navigation error:', error);
              }
            }, 300);
          }
        });
        setShowUploadAlertModal(true);
        return;
      }

      console.log('[UPLOAD] Authentication checks passed, proceeding with upload');
      if (userMode === 'team_member') {
        console.log('[UPLOAD] Team member upload path');
        // Team Member Upload Logic (same as Pro/Business/Enterprise)
        // Check if we're uploading selected photos
        let sourcePhotos;
        let selectedSets = [];
        if (uploadSelectedPhotos) {
          // Use selected photos
          sourcePhotos = uploadSelectedPhotos.individual;
          selectedSets = uploadSelectedPhotos.sets || [];
          // Reset the selected photos flag after using it
          setUploadSelectedPhotos(null);
        } else {
          // Use all photos from project
          sourcePhotos = activeProjectId ? photos.filter(p => p.projectId === activeProjectId) : photos;
        }

        // Build the list based on selected types (before/after)
        const items = sourcePhotos.filter(p =>
          (selectedTypes.before && p.mode === PHOTO_MODES.BEFORE) ||
          (selectedTypes.after && p.mode === PHOTO_MODES.AFTER)
        );

        // If combined is selected, generate them dynamically (same logic as admin/individual)
        const combinedItems = [];
        if (selectedTypes.combined) {
          const anyFormat = Object.keys(selectedFormats).some((k) => selectedFormats[k]);

          // First, process selected sets (combined photos directly selected)
          // These don't require both before and after to be in sourcePhotos
          if (!anyFormat) {
            // Upload existing ORIGINAL combined images from device storage
            try {
              const dir = FileSystem.documentDirectory;
              const entries = dir ? await FileSystem.readDirectoryAsync(dir) : [];

              let foundCount = 0;
              for (const photoSet of selectedSets) {
                if (photoSet.before && photoSet.after) {
                  const pair = {
                    before: photoSet.before,
                    after: photoSet.after,
                    room: photoSet.before.room
                  };
                  const safeName = (pair.before.name || 'Photo').replace(/\s+/g, '_');
                  const projectId = pair.before.projectId;
                  const projectIdSuffix = projectId ? `_P${projectId}` : '';
                  const stackPrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_STACK_`;
                  const sidePrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_SIDE_`;

                  const pickLatestByPrefix = (prefix) => {
                    let matches = entries.filter(name => name.startsWith(prefix));
                    
                    // Filter by project ID if available
                    if (projectId) {
                      matches = matches.filter(name => name.includes(projectIdSuffix));
                    }
                    
                    if (matches.length === 0) return null;
                    // Filenames end with _<timestamp>[_PprojectId].jpg; pick max timestamp
                    let best = null;
                    let bestTs = -1;
                    for (const name of matches) {
                      // Match timestamp before project ID suffix if present
                      const m = name.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                      const ts = m ? parseInt(m[1], 10) : 0;
                      if (ts > bestTs) { bestTs = ts; best = name; }
                    }
                    return best || matches[matches.length - 1];
                  };

                  const stackName = pickLatestByPrefix(stackPrefix);
                  const sideName = pickLatestByPrefix(sidePrefix);

                  const beforeOrientation = pair.before.orientation || 'portrait';
                  const cameraVM = pair.before.cameraViewMode || 'portrait';
                  const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
                  const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

                  const pushItem = (name, tag) => {
                    if (!dir || !name) return;
                    combinedItems.push({
                      uri: `${dir}${name}`,
                      filename: `${pair.before.name}_original-${tag}.jpg`,
                      name: pair.before.name,
                      room: pair.room,
                      mode: PHOTO_MODES.COMBINED,
                      format: `original-${tag}`
                    });
                    foundCount++;
                  };

                  if (isLetterbox) {
                    // Upload both if both exist
                    if (stackName) pushItem(stackName, 'stack');
                    if (sideName) pushItem(sideName, 'side');
                  } else if (isLandscape) {
                    if (stackName) pushItem(stackName, 'stack');
                    else if (sideName) pushItem(sideName, 'side');
                  } else {
                    if (sideName) pushItem(sideName, 'side');
                    else if (stackName) pushItem(stackName, 'stack');
                  }
                }
              }
            } catch (e) {
              console.error('[UPLOAD] Error processing selected sets:', e);
            }
          }

          // Group photos by room to find pairs from sourcePhotos
          const byRoom = {};
          sourcePhotos.forEach(p => {
            if (!byRoom[p.room]) byRoom[p.room] = { before: [], after: [] };
            if (p.mode === PHOTO_MODES.BEFORE) byRoom[p.room].before.push(p);
            if (p.mode === PHOTO_MODES.AFTER) byRoom[p.room].after.push(p);
          });

          // Create pairs from sourcePhotos (skip if already added from selectedSets)
          const pairs = [];
          Object.keys(byRoom).forEach(roomId => {
            const beforeList = byRoom[roomId].before;
            const afterList = byRoom[roomId].after;
            afterList.forEach(after => {
              const match = beforeList.find(b => b.id === after.beforePhotoId);
              if (match) {
                // Check if this pair is already in selectedSets
                const alreadyInSelectedSets = selectedSets.some(set => 
                  set.before && set.after && 
                  set.before.id === match.id && set.after.id === after.id
                );
                if (!alreadyInSelectedSets) {
                  pairs.push({ before: match, after, room: roomId });
                }
              }
            });
          });

          if (!anyFormat) {
            // Upload existing ORIGINAL combined images from device storage
            try {
              const dir = FileSystem.documentDirectory;
              const entries = dir ? await FileSystem.readDirectoryAsync(dir) : [];

              let foundCount = 0;
              for (const pair of pairs) {
                const safeName = (pair.before.name || 'Photo').replace(/\s+/g, '_');
                const projectId = pair.before.projectId;
                const projectIdSuffix = projectId ? `_P${projectId}` : '';
                const stackPrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_STACK_`;
                const sidePrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_SIDE_`;

                const pickLatestByPrefix = (prefix) => {
                  let matches = entries.filter(name => name.startsWith(prefix));
                  
                  // Filter by project ID if available
                  if (projectId) {
                    matches = matches.filter(name => name.includes(projectIdSuffix));
                  }
                  
                  if (matches.length === 0) return null;
                  // Filenames end with _<timestamp>[_PprojectId].jpg; pick max timestamp
                  let best = null;
                  let bestTs = -1;
                  for (const name of matches) {
                    // Match timestamp before project ID suffix if present
                    const m = name.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                    const ts = m ? parseInt(m[1], 10) : 0;
                    if (ts > bestTs) { bestTs = ts; best = name; }
                  }
                  return best || matches[matches.length - 1];
                };

                const stackName = pickLatestByPrefix(stackPrefix);
                const sideName = pickLatestByPrefix(sidePrefix);

                const beforeOrientation = pair.before.orientation || 'portrait';
                const cameraVM = pair.before.cameraViewMode || 'portrait';
                const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
                const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

                const pushItem = (name, tag) => {
                  if (!dir || !name) return;
                  combinedItems.push({
                    uri: `${dir}${name}`,
                    filename: `${pair.before.name}_original-${tag}.jpg`,
                    name: pair.before.name,
                    room: pair.room,
                    mode: PHOTO_MODES.COMBINED,
                    format: `original-${tag}`
                  });
                  foundCount++;
                };

                if (isLetterbox) {
                  // Upload both if both exist
                  if (stackName) pushItem(stackName, 'stack');
                  if (sideName) pushItem(sideName, 'side');
                } else if (isLandscape) {
                  if (stackName) pushItem(stackName, 'stack');
                  else if (sideName) pushItem(sideName, 'side');
                } else {
                  if (sideName) pushItem(sideName, 'side');
                  else if (stackName) pushItem(stackName, 'stack');
                }
              }

            if (foundCount === 0 && pairs.length > 0) {
                Alert.alert(t('gallery.nothingToUploadTitle'), t('gallery.noOriginalCombinedFound'));
                return;
              }
            } catch (e) {
              Alert.alert(t('common.error'), t('gallery.originalCombinedSearchError'));
              return;
            }
          } else {
            // Advanced formats selected: render dynamic combined images
            const selectedTemplateKeys = Object.keys(TEMPLATE_CONFIGS).filter(k => selectedFormats[k]);

            const getAllowedTemplatesForPair = (pair) => {
              const before = pair.before;
              const beforeOrientation = before.orientation || 'portrait';
              const cameraVM = before.cameraViewMode || 'portrait';
              const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
              const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

              return selectedTemplateKeys.filter((key) => {
                const layout = TEMPLATE_CONFIGS[key]?.layout;
                if (isLetterbox) return true; // both stack and side-by-side
                if (isLandscape) return layout === 'stack';
                return layout === 'sidebyside';
              });
            };

            // Include selectedSets in pairs for rendering
            const allPairsForRendering = [...pairs];
            for (const photoSet of selectedSets) {
              if (photoSet.before && photoSet.after) {
                allPairsForRendering.push({
                  before: photoSet.before,
                  after: photoSet.after,
                  room: photoSet.before.room
                });
              }
            }

            const totalRenders = allPairsForRendering.reduce((sum, pair) => sum + getAllowedTemplatesForPair(pair).length, 0);

            if (totalRenders === 0) {
              Alert.alert(t('gallery.nothingToUploadTitle'), t('gallery.noPairsForCombined'));
              return;
            }

            setOptionsVisible(false);
            setRenderingCombined(true);
            setRenderingProgress({ current: 0, total: totalRenders });

            // Render each combination
            let renderCount = 0;
            for (const pair of allPairsForRendering) {
              const allowedKeys = getAllowedTemplatesForPair(pair);
              for (const templateKey of allowedKeys) {
                const cfg = TEMPLATE_CONFIGS[templateKey];

                // Set the current render
                setCurrentRenderPair(pair);
                setCurrentRenderTemplate({ key: templateKey, config: cfg });

                // Wait for render
                await new Promise(resolve => setTimeout(resolve, 800));

                // Capture the view
                try {
                  const uri = await captureRef(renderViewRef, {
                    format: 'jpg',
                    quality: 0.9
                  });
                  if (uri) {
                    combinedItems.push({
                      uri: uri,
                      filename: `${pair.before.name}_${templateKey}.jpg`,
                      name: pair.before.name,
                      room: pair.room,
                      mode: PHOTO_MODES.COMBINED,
                      format: templateKey
                    });
                  }
                } catch (error) {
                  console.error('Error capturing combined image:', error);
                }

                renderCount++;
                setRenderingProgress({ current: renderCount, total: totalRenders });
              }
            }

            setRenderingCombined(false);
            setCurrentRenderPair(null);
            setCurrentRenderTemplate(null);
          }
        }

        // Combine all items (before, after, combined)
        const itemsToUpload = [...items, ...combinedItems];

        if (itemsToUpload.length === 0) {
          Alert.alert(t('gallery.noPhotosSelected'), t('gallery.selectAtLeastOneUpload'));
          return;
        }

        setOptionsVisible(false);
        // Create album name using the same format as Pro/Business/Enterprise tiers
        // This includes a numeric identifier (HHMMSS) to distinguish folders created on the same day
        const teamUserName = userName || 'Team Member';
        const albumName = createAlbumName(teamUserName, new Date());
        
        startBackgroundUpload({
          items: itemsToUpload,
          teamInfo: teamInfo,
          uploadType: 'team',
          albumName: albumName,
          location: location || 'tampa', // Use location from settings
          userName: teamUserName, // Use userName as cleanerName
          flat: !useFolderStructure, // Use flat mode if folder structure is disabled
          config: {
            accountType: accountType || 'google' // Pass account type
          }
        });
        setShowUploadDetails(true);
        return;
      }

      // Admin/Individual Upload Logic
      let config = null;
      let uploadConfig = null; // Store config for use in proceedWithUpload
      
      // Determine account type based on upload destinations selection
      // If user selected Dropbox in upload options, use Dropbox even if Google is available
      const selectedAccountType = uploadDestinations.dropbox && !uploadDestinations.google 
        ? 'dropbox' 
        : (accountType || 'google');
      
      // Check if user should use direct Drive API upload
      // Pro, Business, and Enterprise users with individual mode or authenticated admin mode (without team) use direct Drive API
      const shouldUseDirectDrive = userMode === 'individual' || 
        (isAuthenticated && (userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') && !teamInfo);
      
      // For Dropbox accounts - use Dropbox upload service (no proxy server needed)
      if (selectedAccountType === 'dropbox') {
        config = { 
          accountType: 'dropbox'
        };
        uploadConfig = config; // Store for later use
      } else if (shouldUseDirectDrive) {
        // For individual/Pro/Business/Enterprise users - use their authenticated Google Drive via proxy
        try {
          const userFolderId = await googleDriveService.findOrCreateProofPixFolder();
          if (!userFolderId) {
            Alert.alert('Error', 'Could not access Google Drive folder. Please sign in again.');
            return;
          }
          // Initialize proxy session for uploads
          const sessionResult = await initializeProxySession(userFolderId);
          if (!sessionResult || !sessionResult.success || !sessionResult.sessionId) {
            Alert.alert('Error', 'Failed to initialize proxy session. Please try again.');
            return;
          }
          // Use proxy server upload for Pro, Business, and Enterprise users
          config = { 
            folderId: userFolderId, 
            useDirectDrive: true, // Flag to indicate proxy server upload
            sessionId: sessionResult.sessionId, // Extract sessionId string from result object
            accountType: 'google'
          };
          uploadConfig = config; // Store for later use
        } catch (error) {
          console.error('Error setting up proxy upload:', error);
          Alert.alert('Error', `Failed to setup proxy upload: ${error.message}`);
          return;
        }
      } else {
        // For admin mode (team management) - use configured folder and proxy session
        // Only set config if NOT individual mode (to avoid overwriting Pro/Business/Enterprise user config)
        if (userMode === 'admin' && folderId && proxySessionId) {
          config = { folderId, useDirectDrive: true, sessionId: proxySessionId, accountType: 'google' };
        } else {
          // Fallback to location-based config (folderId only)
          const locationConfig = getLocationConfig(location);
          config = { folderId: locationConfig?.folderId, useDirectDrive: false, accountType: 'google' };
        }
        uploadConfig = config; // Store for later use
      }

        // Check if configured (only for Google accounts)
        // For Dropbox, no folderId or sessionId is needed - skip this check for Dropbox
        if (selectedAccountType === 'dropbox' || config?.accountType === 'dropbox') {
          // Dropbox doesn't need folderId or sessionId, skip validation
          console.log('[UPLOAD] Dropbox account selected, skipping Google Drive validation');
        } else if (!config || !config.folderId || (config.useDirectDrive && !config.sessionId)) {
          // Only check Google Drive config if not using Dropbox
          Alert.alert(
            t('gallery.setupRequiredTitle'),
            t('gallery.driveConfigMissing'),
            [{ text: t('common.ok'), style: 'cancel' }]
          );
          return;
        }

      // Generate album name - use project's uploadId if available, otherwise generate new one
      const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
      const projectUploadId = activeProject?.uploadId || null;
      const albumName = createAlbumName(userName, new Date(), projectUploadId);
      
      // Scope uploads to the active project if one is selected, or use selected photos
      let sourcePhotos;
      let selectedSets = [];
      if (uploadSelectedPhotos) {
        // Use selected photos
        sourcePhotos = uploadSelectedPhotos.individual;
        selectedSets = uploadSelectedPhotos.sets || [];
        // Reset the selected photos flag after using it
        setUploadSelectedPhotos(null);
      } else {
        // Use all photos from project
        sourcePhotos = activeProjectId ? photos.filter(p => p.projectId === activeProjectId) : photos;
      }

      // Build the list based on selected types (before/after)
      const items = sourcePhotos.filter(p =>
        (selectedTypes.before && p.mode === PHOTO_MODES.BEFORE) ||
        (selectedTypes.after && p.mode === PHOTO_MODES.AFTER)
      );

      // If combined is selected, generate them dynamically
      const combinedItems = [];
      if (selectedTypes.combined) {
        const anyFormat = Object.keys(selectedFormats).some((k) => selectedFormats[k]);

        // First, process selected sets (combined photos directly selected)
        // These don't require both before and after to be in sourcePhotos
        if (!anyFormat) {
          // Upload existing ORIGINAL combined images from device storage
          try {
            const dir = FileSystem.documentDirectory;
            const entries = dir ? await FileSystem.readDirectoryAsync(dir) : [];

            let foundCount = 0;
            for (const photoSet of selectedSets) {
              if (photoSet.before && photoSet.after) {
                const pair = {
                  before: photoSet.before,
                  after: photoSet.after,
                  room: photoSet.before.room
                };
                const safeName = (pair.before.name || 'Photo').replace(/\s+/g, '_');
                const projectId = pair.before.projectId;
                const projectIdSuffix = projectId ? `_P${projectId}` : '';
                const stackPrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_STACK_`;
                const sidePrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_SIDE_`;

                const pickLatestByPrefix = (prefix) => {
                  let matches = entries.filter(name => name.startsWith(prefix));
                  
                  // Filter by project ID if available
                  if (projectId) {
                    matches = matches.filter(name => name.includes(projectIdSuffix));
                  }
                  
                  if (matches.length === 0) return null;
                  // Filenames end with _<timestamp>[_PprojectId].jpg; pick max timestamp
                  let best = null;
                  let bestTs = -1;
                  for (const name of matches) {
                    // Match timestamp before project ID suffix if present
                    const m = name.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                    const ts = m ? parseInt(m[1], 10) : 0;
                    if (ts > bestTs) { bestTs = ts; best = name; }
                  }
                  return best || matches[matches.length - 1];
                };

                const stackName = pickLatestByPrefix(stackPrefix);
                const sideName = pickLatestByPrefix(sidePrefix);

                const beforeOrientation = pair.before.orientation || 'portrait';
                const cameraVM = pair.before.cameraViewMode || 'portrait';
                const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
                const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

                const pushItem = (name, tag) => {
                  if (!dir || !name) return;
                  combinedItems.push({
                    uri: `${dir}${name}`,
                    filename: `${pair.before.name}_original-${tag}.jpg`,
                    name: pair.before.name,
                    room: pair.room,
                    mode: PHOTO_MODES.COMBINED,
                    format: `original-${tag}`
                  });
                  foundCount++;
                };

                if (isLetterbox) {
                  // Upload both if both exist
                  if (stackName) pushItem(stackName, 'stack');
                  if (sideName) pushItem(sideName, 'side');
                } else if (isLandscape) {
                  if (stackName) pushItem(stackName, 'stack');
                  else if (sideName) pushItem(sideName, 'side');
                } else {
                  if (sideName) pushItem(sideName, 'side');
                  else if (stackName) pushItem(stackName, 'stack');
                }
              }
            }
          } catch (e) {
            console.error('[UPLOAD] Error processing selected sets:', e);
          }
        }

        // Group photos by room to find pairs from sourcePhotos
        const byRoom = {};
        sourcePhotos.forEach(p => {
          if (!byRoom[p.room]) byRoom[p.room] = { before: [], after: [] };
          if (p.mode === PHOTO_MODES.BEFORE) byRoom[p.room].before.push(p);
          if (p.mode === PHOTO_MODES.AFTER) byRoom[p.room].after.push(p);
        });

        // Create pairs from sourcePhotos (skip if already added from selectedSets)
        const pairs = [];
        Object.keys(byRoom).forEach(roomId => {
          const beforeList = byRoom[roomId].before;
          const afterList = byRoom[roomId].after;
          afterList.forEach(after => {
            const match = beforeList.find(b => b.id === after.beforePhotoId);
            if (match) {
              // Check if this pair is already in selectedSets
              const alreadyInSelectedSets = selectedSets.some(set => 
                set.before && set.after && 
                set.before.id === match.id && set.after.id === after.id
              );
              if (!alreadyInSelectedSets) {
                pairs.push({ before: match, after, room: roomId });
              }
            }
          });
        });

        if (!anyFormat) {
          // Upload existing ORIGINAL combined images from device storage
          try {
            const dir = FileSystem.documentDirectory;
            const entries = dir ? await FileSystem.readDirectoryAsync(dir) : [];

            let foundCount = 0;
            for (const pair of pairs) {
              const safeName = (pair.before.name || 'Photo').replace(/\s+/g, '_');
              const projectId = pair.before.projectId;
              const projectIdSuffix = projectId ? `_P${projectId}` : '';
              const stackPrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_STACK_`;
              const sidePrefix = `${pair.before.room}_${safeName}_COMBINED_BASE_SIDE_`;

              const pickLatestByPrefix = (prefix) => {
                let matches = entries.filter(name => name.startsWith(prefix));
                
                // Filter by project ID if available
                if (projectId) {
                  matches = matches.filter(name => name.includes(projectIdSuffix));
                }
                
                if (matches.length === 0) return null;
                // Filenames end with _<timestamp>[_PprojectId].jpg; pick max timestamp
                let best = null;
                let bestTs = -1;
                for (const name of matches) {
                  // Match timestamp before project ID suffix if present
                  const m = name.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                  const ts = m ? parseInt(m[1], 10) : 0;
                  if (ts > bestTs) { bestTs = ts; best = name; }
                }
                return best || matches[matches.length - 1];
              };

              const stackName = pickLatestByPrefix(stackPrefix);
              const sideName = pickLatestByPrefix(sidePrefix);

              const beforeOrientation = pair.before.orientation || 'portrait';
              const cameraVM = pair.before.cameraViewMode || 'portrait';
              const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
              const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

              const pushItem = (name, tag) => {
                if (!dir || !name) return;
                combinedItems.push({
                  uri: `${dir}${name}`,
                  filename: `${pair.before.name}_original-${tag}.jpg`,
                  name: pair.before.name,
                  room: pair.room,
                  mode: PHOTO_MODES.COMBINED,
                  format: `original-${tag}`
                });
                foundCount++;
              };

              if (isLetterbox) {
                // Upload both if both exist
                if (stackName) pushItem(stackName, 'stack');
                if (sideName) pushItem(sideName, 'side');
              } else if (isLandscape) {
                if (stackName) pushItem(stackName, 'stack');
                else if (sideName) pushItem(sideName, 'side');
              } else {
                if (sideName) pushItem(sideName, 'side');
                else if (stackName) pushItem(stackName, 'stack');
              }
            }

            if (foundCount === 0) {
              Alert.alert(t('gallery.nothingToUploadTitle'), t('gallery.noOriginalCombinedFound'));
              return;
            }
          } catch (e) {
            Alert.alert(t('common.error'), t('gallery.originalCombinedSearchError'));
            return;
          }
        } else {
          // Advanced formats selected: render dynamic combined images
          const selectedTemplateKeys = Object.keys(TEMPLATE_CONFIGS).filter(k => selectedFormats[k]);

          const getAllowedTemplatesForPair = (pair) => {
            const before = pair.before;
            const beforeOrientation = before.orientation || 'portrait';
            const cameraVM = before.cameraViewMode || 'portrait';
            const isLetterbox = (cameraVM === 'landscape' && beforeOrientation === 'portrait');
            const isLandscape = beforeOrientation === 'landscape' || cameraVM === 'landscape';

            return selectedTemplateKeys.filter((key) => {
              const layout = TEMPLATE_CONFIGS[key]?.layout;
              if (isLetterbox) return true; // both stack and side-by-side
              if (isLandscape) return layout === 'stack';
              return layout === 'sidebyside';
            });
          };

          // Include selectedSets in pairs for rendering
          const allPairsForRendering = [...pairs];
          for (const photoSet of selectedSets) {
            if (photoSet.before && photoSet.after) {
              allPairsForRendering.push({
                before: photoSet.before,
                after: photoSet.after,
                room: photoSet.before.room
              });
            }
          }

          const totalRenders = allPairsForRendering.reduce((sum, pair) => sum + getAllowedTemplatesForPair(pair).length, 0);

          if (totalRenders === 0) {
            Alert.alert(t('gallery.nothingToUploadTitle'), t('gallery.noPairsForCombined'));
            return;
          }

          setOptionsVisible(false);
          setRenderingCombined(true);
          setRenderingProgress({ current: 0, total: totalRenders });

          // Render each combination
          let renderCount = 0;
          for (const pair of allPairsForRendering) {
            const allowedKeys = getAllowedTemplatesForPair(pair);
            for (const templateKey of allowedKeys) {
              const cfg = TEMPLATE_CONFIGS[templateKey];

              // Set the current render
              setCurrentRenderPair(pair);
              setCurrentRenderTemplate({ key: templateKey, config: cfg });

              // Wait for render
              await new Promise(resolve => setTimeout(resolve, 800));

              // Capture the view
              try {
                const uri = await captureRef(renderViewRef, {
                  format: 'jpg',
                  quality: 0.9
                });
                if (uri) {
                  combinedItems.push({
                    uri: uri,
                    filename: `${pair.before.name}_${templateKey}.jpg`,
                    name: pair.before.name,
                    room: pair.room,
                    mode: PHOTO_MODES.COMBINED,
                    format: templateKey
                  });
                }
              } catch (error) {
              }

              renderCount++;
              setRenderingProgress({ current: renderCount, total: totalRenders });
            }
          }

          setRenderingCombined(false);
          setCurrentRenderPair(null);
          setCurrentRenderTemplate(null);
        }
      }

      // Apply folder switches: when folder structure ON, allow per-type filtering
      // When folder structure OFF, we still upload all types but the server will place them in the project root
      // If folder structure is on but a folder is disabled, upload those into the main folder by marking flat
      const promoteToFlat = (arr) => arr.map(p => ({ ...p, flat: true }));

      const filteredBefore = useFolderStructure
        ? (enabledFolders.before ? items.filter(i => i.mode === PHOTO_MODES.BEFORE) : promoteToFlat(items.filter(i => i.mode === PHOTO_MODES.BEFORE)))
        : items.filter(i => i.mode === PHOTO_MODES.BEFORE);

      const filteredAfter = useFolderStructure
        ? (enabledFolders.after ? items.filter(i => i.mode === PHOTO_MODES.AFTER) : promoteToFlat(items.filter(i => i.mode === PHOTO_MODES.AFTER)))
        : items.filter(i => i.mode === PHOTO_MODES.AFTER);

      const filteredCombined = useFolderStructure
        ? (enabledFolders.combined ? combinedItems : promoteToFlat(combinedItems))
        : combinedItems;
      const allItems = [...filteredBefore, ...filteredAfter, ...filteredCombined];

      if (allItems.length === 0) {
        Alert.alert(t('gallery.nothingToUploadTitle'), t('gallery.noTypesWithPhotos'));
        return;
      }

      // Filter out photos that have already been uploaded
      const newItems = await filterNewPhotos(allItems, albumName);
      
      if (newItems.length === 0) {
        Alert.alert(
          t('gallery.noNewPhotosTitle'), 
          t('gallery.noNewPhotosMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { 
              text: t('gallery.uploadAgain'), 
              style: 'default',
              onPress: () => {
                // Force re-upload of all photos by using allItems instead of filtered newItems
                proceedWithUpload(allItems, albumName, uploadConfig);
              }
            }
          ]
        );
        return;
      }

      if (newItems.length < allItems.length) {
        const skippedCount = allItems.length - newItems.length;
        Alert.alert(
          t('gallery.somePhotosUploadedTitle'),
          t('gallery.somePhotosUploadedMessage', { skippedCount, newCount: newItems.length }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { 
              text: t('common.confirm'), 
              style: 'default',
              onPress: () => proceedWithUpload(newItems, albumName, uploadConfig) 
            },
            { 
              text: t('gallery.uploadAll'), 
              style: 'default',
              onPress: () => {
                // Force re-upload of all photos including already uploaded ones
                proceedWithUpload(allItems, albumName, uploadConfig);
              }
            }
          ]
        );
        return;
      }

      // All photos are new, proceed with upload
      await proceedWithUpload(newItems, albumName, uploadConfig);
    } catch (error) {
      Alert.alert('Upload Failed', error.message || 'An error occurred while preparing upload');
    }
  };

  const proceedWithUpload = async (items, albumName, configOverride = null) => {
    console.log('[UPLOAD] proceedWithUpload called');
    console.log('[UPLOAD] Items count:', items.length);
    console.log('[UPLOAD] Album name:', albumName);
    console.log('[UPLOAD] Config override:', configOverride);
    console.log('[UPLOAD] Upload destinations:', uploadDestinations);
    try {
      // Close upload options and any upgrade overlay before starting background upload
      setOptionsVisible(false);
      setUpgradeVisible(false);

      const uploadPromises = [];

      // Upload to Google Drive if selected
      if (uploadDestinations.google) {
        console.log('[UPLOAD] Starting Google Drive upload');
        // Use provided config or fallback to location config (for backward compatibility)
        const config = configOverride || getLocationConfig(location);
        console.log('[UPLOAD] Google config:', { folderId: config?.folderId, useDirectDrive: config?.useDirectDrive, sessionId: config?.sessionId });

        // Check if Google Drive is configured (only if Google is selected, not Dropbox)
        const isGoogleConfig = config?.accountType !== 'dropbox' && accountType !== 'dropbox';
        if (isGoogleConfig && (!config || !config.folderId || (config.useDirectDrive && !config.sessionId))) {
          console.log('[UPLOAD] Google Drive not configured, showing alert');
          Alert.alert(
            t('gallery.setupRequiredTitle'),
            t('gallery.driveConfigMissing')
          );
          return;
        }

        // Start background upload to Google Drive
        console.log('[UPLOAD] Starting background upload to Google Drive');
        const googleUploadId = startBackgroundUpload({
          items,
          config: {
            ...config,
            accountType: config?.accountType || accountType || 'google' // Pass account type
          },
          albumName,
          location,
          userName,
          flat: !useFolderStructure,
          uploadType: 'standard',
          useDirectDrive: config?.useDirectDrive || false, // Pass the flag for proxy server upload
          sessionId: config?.sessionId || null, // Pass the proxy session ID
          accountType: config?.accountType || accountType || 'google' // Pass account type
        });
        console.log('[UPLOAD] Google Drive upload started, ID:', googleUploadId);
        uploadPromises.push({ type: 'google', uploadId: googleUploadId });
      }

      // Upload to Dropbox if selected
      if (uploadDestinations.dropbox) {
        console.log('[UPLOAD] Starting Dropbox upload');
        // Load Dropbox tokens before checking authentication
        await dropboxAuthService.loadStoredTokens();
        
        // Check if Dropbox is authenticated
        const dropboxAuth = dropboxAuthService.isAuthenticated();
        console.log('[UPLOAD] Dropbox authenticated:', dropboxAuth);
        if (!dropboxAuth) {
          console.log('[UPLOAD] Dropbox not authenticated in proceedWithUpload, showing custom modal');
          setUploadAlertConfig({
            title: t('gallery.dropboxNotConnected'),
            message: t('gallery.dropboxNotConnectedMessage'),
            onGoToSettings: () => {
              console.log('[UPLOAD] onGoToSettings callback called (from proceedWithUpload)');
              console.log('[UPLOAD] Closing modal first');
              setShowUploadAlertModal(false);
              setTimeout(() => {
                console.log('[UPLOAD] Executing navigation to Settings');
                try {
                  // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                  navigation.goBack();
                  setTimeout(() => {
                    console.log('[UPLOAD] Navigating to Settings from parent screen');
                    navigation.navigate('Settings', { scrollToCloudSync: true });
                    console.log('[UPLOAD] Navigation call completed');
                  }, 100);
                } catch (error) {
                  console.error('[UPLOAD] Navigation error:', error);
                }
              }, 300);
            }
          });
          setShowUploadAlertModal(true);
          return;
        }

        // Use background upload service for Dropbox (same as Google Drive) to show progress
        console.log('[UPLOAD] Starting Dropbox background upload with progress tracking');
        const dropboxUploadId = startBackgroundUpload({
          items,
          config: {
            accountType: 'dropbox' // Pass account type for Dropbox routing
          },
          albumName,
          location,
          userName,
          flat: !useFolderStructure,
          uploadType: 'standard',
          accountType: 'dropbox' // Pass account type at top level too
        });
        console.log('[UPLOAD] Dropbox background upload started with ID:', dropboxUploadId);
        uploadPromises.push({ type: 'dropbox', uploadId: dropboxUploadId });
      }

      // Show upload modal immediately (if any upload is in progress)
      if (uploadDestinations.google || uploadDestinations.dropbox) {
        console.log('[UPLOAD] Showing upload details modal');
        setShowUploadDetails(true);
      }
    } catch (error) {
      Alert.alert('Upload Failed', error.message || 'An error occurred while preparing upload');
    }
  };

  // Handle plan modal close - delete confirmation stays open (no need to reopen)
  const handleSharePlanModalClose = () => {
    setShowSharePlanModal(false);
  };

  const handleDeleteAllConfirmed = async (deleteFromStorageParam) => {
    try {
      const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : deleteFromStorage;
      if (activeProjectId) {
        // Delete only the active project and its photos
        await deleteProject(activeProjectId, { deleteFromStorage: shouldDeleteFromStorage });
        setActiveProject(null);
      } else {
        // No active project: fall back to deleting everything
        if (shouldDeleteFromStorage) {
          // Delete known photos and also purge any base/combined images saved by editor/capture
          await deletePhotosFromDevice(photos);
          await purgeAllDevicePhotos();
        }
        await deleteAllPhotos();
      }
    } finally {
      setConfirmDeleteVisible(false);
      setShowDeleteAllConfirm(false);
    }
  };

  // Get selected photos (individual and combined)
  const getSelectedPhotos = () => {
    const selected = [];
    if (!getRooms || typeof getRooms !== 'function') {
      console.warn('[GalleryScreen] getRooms is not available');
      return selected;
    }
    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      console.warn('[GalleryScreen] getRooms returned invalid data');
      return selected;
    }
    
    rooms.forEach(room => {
      const sets = getPhotoSets(room.id);
      sets.forEach(set => {
        // Check individual photos
        if (set.before && selectedPhotos.has(set.before.id)) {
          selected.push(set.before);
        }
        if (set.after && selectedPhotos.has(set.after.id)) {
          selected.push(set.after);
        }
        // Check combined photo
        const combinedId = `combined_${set.before.id}`;
        if (selectedPhotos.has(combinedId)) {
          // For combined, we'll handle it separately
        }
      });
    });
    
    return selected;
  };

  // Get selected photo sets (for combined photos)
  const getSelectedPhotoSets = () => {
    const selected = [];
    if (!getRooms || typeof getRooms !== 'function') {
      console.warn('[GalleryScreen] getRooms is not available');
      return selected;
    }
    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      console.warn('[GalleryScreen] getRooms returned invalid data');
      return selected;
    }
    
    rooms.forEach(room => {
      const sets = getPhotoSets(room.id);
      sets.forEach(set => {
        const combinedId = `combined_${set.before.id}`;
        if (selectedPhotos.has(combinedId)) {
          selected.push(set);
        }
      });
    });
    
    return selected;
  };

  // Handle upload selected photos
  const handleUploadSelected = async () => {
    console.log('[UPLOAD] handleUploadSelected called');
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    console.log('[UPLOAD] Selected photos:', selected.length);
    console.log('[UPLOAD] Selected sets:', selectedSets.length);
    
    if (selected.length === 0 && selectedSets.length === 0) {
      console.log('[UPLOAD] No photos selected, showing alert');
      Alert.alert(t('gallery.noPhotosTitle'), 'No photos selected');
      return;
    }

    // Store selected photos for upload logic to use
    setUploadSelectedPhotos({ individual: selected, sets: selectedSets });
    setManageVisible(false);
    
    // Use the same upload flow but with selected photos
    // The upload logic will check uploadSelectedPhotos and use it instead of all photos
    await handleUploadPhotos();
  };

  // Handle share selected photos
  const handleShareSelected = async () => {
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    
    if (selected.length === 0 && selectedSets.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), 'No photos selected');
      return;
    }

    // Store selected photos for share logic to use
    setShareSelectedPhotos({ individual: selected, sets: selectedSets });
    setManageVisible(false);
    
    // Use the same share flow but with selected photos
    // The share logic will check shareSelectedPhotos and use it instead of all photos
    await handleShareProject();
  };

  // Handle delete selected photos
  const handleDeleteSelected = () => {
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    
    if (selected.length === 0 && selectedSets.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), 'No photos selected');
      return;
    }

    setShowDeleteSelectedConfirm(true);
  };

  const handleDeleteSelectedConfirmed = async (deleteFromStorageParam) => {
    const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : true;
    console.log('[GalleryScreen] handleDeleteSelectedConfirmed called with deleteFromStorageParam:', deleteFromStorageParam);
    console.log('[GalleryScreen] shouldDeleteFromStorage:', shouldDeleteFromStorage);

    try {
      // Get selected photos/sets before starting deletion
      const selected = getSelectedPhotos();
      const selectedSets = getSelectedPhotoSets();

      // Collect all photo IDs to delete
      const photoIdsToDelete = new Set();
      selected.forEach(photo => photoIdsToDelete.add(photo.id));
      selectedSets.forEach(set => {
        if (set.before) photoIdsToDelete.add(set.before.id);
        if (set.after) photoIdsToDelete.add(set.after.id);
      });

      // Close modal immediately to prevent UI freeze
      setShowDeleteSelectedConfirm(false);
      setSelectedPhotos(new Set());
      isSelectionModeRef.current = false;
      setIsSelectionMode(false);
      setShowOnlySelected(false); // Clear filter when deleting selected

      // Delete photos sequentially with storage deletion option
      const deleteOptions = { deleteFromStorage: shouldDeleteFromStorage };

      // Delete individual photos
      for (const photo of selected) {
        try {
          await deletePhoto(photo.id, deleteOptions);
        } catch (error) {
          console.error(`[GalleryScreen] Failed to delete photo ${photo.id}:`, error);
          // Continue with other deletions even if one fails
        }
      }
      // Delete combined photo sets
      for (const set of selectedSets) {
        try {
          if (set.before) await deletePhoto(set.before.id, deleteOptions);
          if (set.after) await deletePhoto(set.after.id, deleteOptions);
        } catch (error) {
          console.error(`[GalleryScreen] Failed to delete photo set:`, error);
          // Continue with other deletions even if one fails
        }
      }
    } catch (error) {
      console.error('[GalleryScreen] Error deleting selected photos:', error);
      Alert.alert(t('common.error'), 'Failed to delete some photos. Please try again.');
    }
  };

  // Handle preview selected photos - filter gallery to show only selected photos
  const handlePreviewSelected = () => {
    const selected = getSelectedPhotos();
    const selectedSets = getSelectedPhotoSets();
    
    if (selected.length === 0 && selectedSets.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), 'No photos selected');
      return;
    }

    setManageVisible(false);
    // Filter gallery to show only selected photos (same gallery view, just filtered)
    setShowOnlySelected(true);
  };

  // Group photos by room and create photo sets
  // Combined photos are created dynamically, not saved
  const getPhotoSets = (roomId) => {
    const beforePhotos = getBeforePhotos(roomId);
    const afterPhotos = getAfterPhotos(roomId);

    // Create sets based on before photos first
    const sets = {};

    beforePhotos.forEach(photo => {
      sets[photo.id] = {
        name: photo.name,
        before: photo,
        after: null,
        combined: null // Will be rendered dynamically if both before and after exist
      };
    });

    // Match after photos to before photos using beforePhotoId
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
    // For combined thumbnail, show split preview based on phone orientation OR camera view mode - tap to retake after
    if (photoType === 'combined' && !photo && photoSet.before && photoSet.after) {
      const phoneOrientation = photoSet.before.orientation || 'portrait';
      const cameraViewMode = photoSet.before.cameraViewMode || 'portrait';
      
      const isLetterbox = photoSet.before.templateType === 'letterbox' || (phoneOrientation === 'portrait' && cameraViewMode === 'landscape');
      const isTrueLandscape = phoneOrientation === 'landscape';
      const isLetterboxLandscape = isLetterbox && isTrueLandscape;

      // For thumbnails: landscape letterbox uses stack, portrait letterbox uses side-by-side
      const useStackedLayout = isTrueLandscape && !isLetterbox ? true : isLetterboxLandscape;

      const combinedId = `combined_${photoSet.before.id}`;
      const isSelected = currentSelectionMode && currentSelectedPhotos.has(combinedId);

      const handleCombinedPress = () => {
        // Always check selection mode state directly using ref to prevent race conditions
        // This ensures we get the latest value even if component hasn't re-rendered yet
        const inSelectionMode = isSelectionModeRef.current || isSelectionMode || currentSelectionMode;
        
        // Only block taps if we're NOT in selection mode and a long press was triggered
        // In selection mode, we want taps to work for selection/double-tap preview
        if (!inSelectionMode && longPressTriggered.current) return;
        
        if (inSelectionMode) {
          // In selection mode: detect double tap
          const photoKey = combinedId;
          const now = Date.now();
          const DOUBLE_TAP_DELAY = 300; // 300ms window for double tap
          
        // Check if this is a double tap (second tap within 300ms)
        if (tapCountRef.current[photoKey] && (now - lastTapRef.current[photoKey]) < DOUBLE_TAP_DELAY) {
          console.log('[GalleryScreen] Double tap detected for combined photo:', combinedId);
          // Double tap detected - revert the toggle from first tap and open preview
          // Cancel any pending toggle timeout
          if (toggleTimeoutRef.current[photoKey]) {
            clearTimeout(toggleTimeoutRef.current[photoKey]);
            delete toggleTimeoutRef.current[photoKey];
          }
          
          // Revert the toggle that happened on first tap
          const wasOriginallySelected = originalSelectionStateRef.current[photoKey];
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (wasOriginallySelected) {
              newSet.add(combinedId); // Restore to selected
            } else {
              newSet.delete(combinedId); // Restore to unselected
            }
            return newSet;
          });
          
          // Get the original state for navigation
          const restoredSelected = new Set(currentSelectedPhotos);
          if (wasOriginallySelected) {
            restoredSelected.add(combinedId);
          } else {
            restoredSelected.delete(combinedId);
          }
          
          // Clean up
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          pendingTogglesRef.current.delete(combinedId);
          
          // Get all selected combined photo sets for swiping
          const selectedSets = getSelectedPhotoSets();
          console.log('[GalleryScreen] Navigating to PhotoEditor with', selectedSets.length, 'selected sets');
          
          // Navigate immediately
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
        
        // First tap - immediately toggle selection (no delay)
        const wasOriginallySelected = currentSelectedPhotos.has(combinedId);
        originalSelectionStateRef.current[photoKey] = wasOriginallySelected;
        
        // Toggle immediately for instant visual feedback
        setSelectedPhotos(prev => {
          const newSet = new Set(prev);
          if (newSet.has(combinedId)) {
            newSet.delete(combinedId);
          } else {
            newSet.add(combinedId);
          }
          return newSet;
        });
        
        // Record tap for double tap detection
        tapCountRef.current[photoKey] = 1;
        lastTapRef.current[photoKey] = now;
        
        // Schedule cleanup after delay (only if no second tap comes)
        toggleTimeoutRef.current[photoKey] = setTimeout(() => {
          // Clear tap count after delay
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          delete toggleTimeoutRef.current[photoKey];
          pendingTogglesRef.current.delete(combinedId);
        }, DOUBLE_TAP_DELAY);
        return;
      }
      
      // Not in selection mode: single tap opens preview
        navigation.navigate('PhotoEditor', {
          beforePhoto: photoSet.before,
          afterPhoto: photoSet.after
        });
      };

      return (
        <TouchableOpacity
          style={[styles.photoCard, { borderColor }, isLast && styles.photoCardLast, isSelected && styles.photoCardSelected]}
          onPress={handleCombinedPress}
          onLongPress={() => handleLongPressStart(null, photoSet)}
        >
          <View style={[styles.combinedThumbnail, useStackedLayout ? styles.stackedThumbnail : styles.sideBySideThumbnail]}>
            <Image source={{ uri: photoSet.before.uri }} style={styles.halfImage} resizeMode="cover" />
            <Image source={{ uri: photoSet.after.uri }} style={styles.halfImage} resizeMode="cover" />
          </View>
          
          {/* Checkbox overlay - only show in selection mode */}
          {currentSelectionMode && (
            <View style={[styles.photoCheckboxContainer, styles.photoCheckboxGrid, isSelected && styles.photoCheckboxSelected]}>
              {isSelected && (
                <Text style={styles.photoCheckmark}>✓</Text>
              )}
            </View>
          )}
          
          {/* Mode label */}
          <View style={[styles.modeLabel, { backgroundColor: borderColor }]}>
            <Text style={styles.modeLabelText}>
              {t('camera.combined', { lng: labelLanguage })}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (!photo) return <View style={[styles.photoCard, isLast && styles.photoCardLast]}>{renderDummyCard('—')}</View>;

    const isSelected = currentSelectionMode && currentSelectedPhotos.has(photo.id);

    const handlePress = () => {
      // Always check selection mode state directly using ref to prevent race conditions
      // This ensures we get the latest value even if component hasn't re-rendered yet
      const inSelectionMode = isSelectionModeRef.current || isSelectionMode || currentSelectionMode;
      
      // Only block taps if we're NOT in selection mode and a long press was triggered
      // In selection mode, we want taps to work for selection/double-tap preview
      if (!inSelectionMode && longPressTriggered.current) return;
      
      if (inSelectionMode) {
        // In selection mode: detect double tap
        const photoKey = photo.id;
        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300; // 300ms window for double tap
        
        // Check if this is a double tap (second tap within 300ms)
        if (tapCountRef.current[photoKey] && (now - lastTapRef.current[photoKey]) < DOUBLE_TAP_DELAY) {
          console.log('[GalleryScreen] Double tap detected for photo:', photo.id);
          // Double tap detected - revert the toggle from first tap and open preview
          // Cancel any pending toggle timeout
          if (toggleTimeoutRef.current[photoKey]) {
            clearTimeout(toggleTimeoutRef.current[photoKey]);
            delete toggleTimeoutRef.current[photoKey];
          }
          
          // Revert the toggle that happened on first tap
          const wasOriginallySelected = originalSelectionStateRef.current[photoKey];
          setSelectedPhotos(prev => {
            const newSet = new Set(prev);
            if (wasOriginallySelected) {
              newSet.add(photo.id); // Restore to selected
            } else {
              newSet.delete(photo.id); // Restore to unselected
            }
            return newSet;
          });
          
          // Get the original state for navigation
          const restoredSelected = new Set(currentSelectedPhotos);
          if (wasOriginallySelected) {
            restoredSelected.add(photo.id);
          } else {
            restoredSelected.delete(photo.id);
          }
          
          // Clean up
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          pendingTogglesRef.current.delete(photo.id);
          
          // Navigate immediately
          if (photoType === 'combined') {
            // Get all selected combined photo sets for swiping
            const selectedSets = getSelectedPhotoSets();
            console.log('[GalleryScreen] Navigating to PhotoEditor with', selectedSets.length, 'selected sets');
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
            // Get all selected individual photos for swiping
            const selected = getSelectedPhotos();
            console.log('[GalleryScreen] Navigating to PhotoDetail with', selected.length, 'selected photos');
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
        
        // First tap - immediately toggle selection (no delay)
        const wasOriginallySelected = currentSelectedPhotos.has(photo.id);
        originalSelectionStateRef.current[photoKey] = wasOriginallySelected;
        
        // Toggle immediately for instant visual feedback
        setSelectedPhotos(prev => {
          const newSet = new Set(prev);
          if (newSet.has(photo.id)) {
            newSet.delete(photo.id);
          } else {
            newSet.add(photo.id);
          }
          return newSet;
        });
        
        // Record tap for double tap detection
        tapCountRef.current[photoKey] = 1;
        lastTapRef.current[photoKey] = now;
        
        // Schedule cleanup after delay (only if no second tap comes)
        toggleTimeoutRef.current[photoKey] = setTimeout(() => {
          // Clear tap count after delay
          tapCountRef.current[photoKey] = 0;
          lastTapRef.current[photoKey] = 0;
          delete originalSelectionStateRef.current[photoKey];
          delete toggleTimeoutRef.current[photoKey];
          pendingTogglesRef.current.delete(photo.id);
        }, DOUBLE_TAP_DELAY);
        return;
      }
      
        // Not in selection mode: single tap opens preview
        if (photoType === 'combined') {
          // Combined column - navigate to PhotoEditor to choose format
          navigation.navigate('PhotoEditor', {
            beforePhoto: photoSet.before,
            afterPhoto: photoSet.after,
            isSelectionMode: false,
            selectedPhotos: [],
            onSelectionChange: () => {}
          });
        } else {
          // Before or After column - navigate to PhotoDetailScreen with share button
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
        style={[styles.photoCard, { borderColor }, isLast && styles.photoCardLast, isSelected && styles.photoCardSelected]}
        onPress={handlePress}
        onLongPress={() => handleLongPressStart(photo, photoType === 'combined' ? photoSet : null)}
      >
        <CroppedThumbnail
          imageUri={photo.uri}
          aspectRatio={photo.aspectRatio || photoSet.before?.aspectRatio || '4:3'}
          orientation={photo.orientation || photoSet.before?.orientation || 'portrait'}
          size={COLUMN_WIDTH}
        />
        
        {/* Checkbox overlay - only show in selection mode */}
        {currentSelectionMode && (
          <View style={[styles.photoCheckboxContainer, styles.photoCheckboxGrid, isSelected && styles.photoCheckboxSelected]}>
            {isSelected && (
              <Text style={styles.photoCheckmark}>✓</Text>
            )}
          </View>
        )}
        
        {/* Mode label */}
        <View style={[styles.modeLabel, { backgroundColor: borderColor }]}>
          <Text style={styles.modeLabelText}>
            {photoType === 'before'
              ? t('camera.before', { lng: labelLanguage })
              : photoType === 'after'
              ? t('camera.after', { lng: labelLanguage })
              : t('camera.combined', { lng: labelLanguage })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPhotoSet = (set, index, roomId) => {
    // Pass current state values to renderPhotoCard to avoid closure issues
    // Apply filter based on photoFilter state
    const showBefore = photoFilter === 'all' || photoFilter === 'before';
    const showAfter = photoFilter === 'all' || photoFilter === 'after';
    const showCombined = photoFilter === 'all' || photoFilter === 'combined';
    
    return (
      <View key={index} style={styles.photoSetRow}>
        <View style={styles.threeColumnRow}>
          {showBefore && renderPhotoCard(set.before, '#4CAF50', 'before', set, false, isSelectionMode, selectedPhotos)}
          {showAfter && renderPhotoCard(set.after, '#2196F3', 'after', set, false, isSelectionMode, selectedPhotos)}
          {showCombined && renderPhotoCard(set.combined, '#FFC107', 'combined', set, true, isSelectionMode, selectedPhotos)}
        </View>
      </View>
    );
  };

  // Render photos in rows when filtering by single type
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
              // For combined photos, pass null as photo since they're rendered from the set
              const photoToRender = photoType === 'combined' ? null : photo;
              // Use unique key: photo ID for individual photos, combined ID for combined photos
              const uniqueKey = photoType === 'combined' ? `combined_${photoSet.before?.id || idx}` : (photo.id || `photo_${idx}`);
              return (
                <View key={uniqueKey}>
                  {renderPhotoCard(photoToRender, borderColor, photoType, photoSet, isLast, isSelectionMode, selectedPhotos)}
                </View>
              );
            })}
            {/* Fill remaining slots if row is not full */}
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
    
    // When in preview selected mode, show only selected thumbnails in rows
    if (showOnlySelected) {
      const selectedThumbnails = [];
      
      sets.forEach(set => {
        const combinedId = `combined_${set.before?.id}`;
        
        // Add before photo if selected
        if (set.before && selectedPhotos.has(set.before.id)) {
          selectedThumbnails.push({
            ...set.before,
            photoSet: set,
            photoType: 'before',
            borderColor: '#4CAF50'
          });
        }
        
        // Add after photo if selected
        if (set.after && selectedPhotos.has(set.after.id)) {
          selectedThumbnails.push({
            ...set.after,
            photoSet: set,
            photoType: 'after',
            borderColor: '#2196F3'
          });
        }
        
        // Add combined photo if selected
        if (set.before && set.after && selectedPhotos.has(combinedId)) {
          selectedThumbnails.push({
            id: combinedId,
            uri: null,
            photoSet: set,
            photoType: 'combined',
            borderColor: '#FFC107'
          });
        }
      });
      
      if (selectedThumbnails.length === 0) return null;
      
      // Render selected thumbnails in rows
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
              {/* Fill remaining slots if row is not full */}
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
            <Text style={styles.roomIcon}>{room.icon}</Text>
            <Text style={styles.roomName}>
              {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
            </Text>
          </View>
          {rows}
        </View>
      );
    }
    
    if (sets.length === 0) return null;

    // When filtering by a single type, show photos in rows
    if (photoFilter === 'before' || photoFilter === 'after' || photoFilter === 'combined') {
      let filteredPhotos = [];
      let borderColor = '#4CAF50';
      let photoType = 'before';
      
      if (photoFilter === 'before') {
        filteredPhotos = sets
          .filter(set => set.before)
          .map(set => ({ ...set.before, photoSet: set }));
        borderColor = '#4CAF50';
        photoType = 'before';
      } else if (photoFilter === 'after') {
        filteredPhotos = sets
          .filter(set => set.after)
          .map(set => ({ ...set.after, photoSet: set }));
        borderColor = '#2196F3';
        photoType = 'after';
      } else if (photoFilter === 'combined') {
        filteredPhotos = sets
          .filter(set => set.before && set.after)
          .map(set => ({ 
            id: `combined_${set.before.id}`,
            uri: null, // Combined photos don't have URIs, they're rendered dynamically
            photoSet: set 
          }));
        borderColor = '#FFC107';
        photoType = 'combined';
      }
      
      if (filteredPhotos.length === 0) return null;
      
      return (
        <View key={room.id} style={styles.roomSection}>
          <View style={styles.roomHeader}>
            <Text style={styles.roomIcon}>{room.icon}</Text>
            <Text style={styles.roomName}>
              {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
            </Text>
          </View>
          {renderFilteredPhotos(filteredPhotos, photoType, borderColor)}
        </View>
      );
    }

    // Default: show all columns (before, after, combined)
    return (
      <View key={room.id} style={styles.roomSection}>
        <View style={styles.roomHeader}>
          <Text style={styles.roomIcon}>{room.icon}</Text>
          <Text style={styles.roomName}>
            {t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })}
          </Text>
        </View>
        {sets.map((set, index) => renderPhotoSet(set, index, room.id))}
      </View>
    );
  };

  // Open Share Project modal only when this screen is focused
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

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* Background Upload Status - Removed old indicator */}

      {/* Swipe down indicator */}
      <View style={styles.swipeIndicator}>
        <View style={styles.swipeHandle} />
      </View>

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('gallery.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Active project name under the title */}
      <View style={[styles.projectNameContainer, isSelectionMode && styles.projectNameContainerSelectionMode]}>
        <Text style={styles.projectNameText}>
          {(projects?.find?.(p => p.id === activeProjectId)?.name) || t('gallery.noProjectSelected')}
        </Text>
        {showOnlySelected && (
          <TouchableOpacity
            style={[styles.selectButton, { backgroundColor: '#9E9E9E', marginRight: 10 }]}
            activeOpacity={0.7}
            onPress={() => {
              setShowOnlySelected(false);
            }}
          >
            <Text style={[styles.selectButtonText, { color: 'white' }]}>
              ✕ Show All
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.selectButton, isSelectionMode && styles.selectButtonActive]}
          activeOpacity={0.7}
          onPress={() => {
            if (isSelectionMode) {
              // Deselect all and exit selection mode
              // Update ref immediately so handlers can access it right away
              isSelectionModeRef.current = false;
              setIsSelectionMode(false);
              setSelectedPhotos(new Set());
              setShowOnlySelected(false); // Clear filter when exiting selection mode
              // Clear long press state
              if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
              }
              longPressTriggered.current = false;
            } else {
              // Enter selection mode
              // Update ref immediately so handlers can access it right away
              isSelectionModeRef.current = true;
              setIsSelectionMode(true);
            }
          }}
        >
          <Text style={styles.selectButtonText}>
            {isSelectionMode ? t('common.deselectAll') : t('gallery.selectPhotos')}
          </Text>
        </TouchableOpacity>
        <UploadIndicatorLine 
          uploadStatus={uploadStatus}
          onPress={() => setShowUploadDetails(true)}
        />
      </View>

      <View style={[styles.columnHeaders, { justifyContent: 'space-between' }]}>
        <TouchableOpacity
          style={[styles.filterButton, { flex: 1, marginRight: 4 }, photoFilter === 'all' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('all')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, photoFilter === 'all' && styles.filterButtonTextActive]}>
            {t('common.all', { lng: labelLanguage, defaultValue: 'All' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { flex: 1, marginHorizontal: 4 }, photoFilter === 'before' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('before')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, { color: '#4CAF50' }, photoFilter === 'before' && styles.filterButtonTextActive]}>
            {t('camera.before', { lng: labelLanguage })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { flex: 1, marginHorizontal: 4 }, photoFilter === 'after' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('after')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, { color: '#2196F3' }, photoFilter === 'after' && styles.filterButtonTextActive]}>
            {t('camera.after', { lng: labelLanguage })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, { flex: 1, marginLeft: 4 }, photoFilter === 'combined' && styles.filterButtonActive]}
          onPress={() => setPhotoFilter('combined')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterButtonText, { color: '#FFC107' }, photoFilter === 'combined' && styles.filterButtonTextActive]}>
            {t('camera.combined', { lng: labelLanguage })}
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
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          {(getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS).map(room => renderRoomSection(room))}
        </ScrollView>
      )}

      {/* Hidden modal for capturing photos with labels */}
      {capturingPhoto && (
        <Modal
          visible={true}
          transparent={true}
          animationType="none"
          onRequestClose={() => {}}
        >
          <View style={{ 
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent'
          }}>
            <View
              ref={labelCaptureRef}
              collapsable={false}
              style={{
                width: Math.min(capturingPhoto.width, width),
                height: Math.min(capturingPhoto.height, width * (capturingPhoto.height / capturingPhoto.width)),
                backgroundColor: 'white',
                overflow: 'hidden',
                position: 'absolute',
                left: width + 1000, // Off-screen but still rendered
                top: 0,
                flexDirection: capturingPhoto.photo.isCombined && capturingPhoto.photo.isLetterbox ? 'column' : 
                              capturingPhoto.photo.isCombined ? 'row' : undefined
              }}
            >
              {capturingPhoto.photo.isCombined && capturingPhoto.photo.beforePhoto && capturingPhoto.photo.afterPhoto ? (
                // Combined photo - render both before and after with labels
                <>
                  <View style={{ flex: 1 }}>
                    <Image
                      source={{ uri: capturingPhoto.photo.beforePhoto.uri }}
                      style={{
                        width: '100%',
                        height: '100%'
                      }}
                      resizeMode="cover"
                    />
                    {showLabels && (
                      <PhotoLabel
                        label="common.before"
                        position={beforeLabelPosition || 'top-left'}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Image
                      source={{ uri: capturingPhoto.photo.afterPhoto.uri }}
                      style={{
                        width: '100%',
                        height: '100%'
                      }}
                      resizeMode="cover"
                    />
                    {showLabels && (
                      <PhotoLabel
                        label="common.after"
                        position={afterLabelPosition || 'top-right'}
                      />
                    )}
                  </View>
                </>
              ) : (
                // Single photo
                <>
                  <Image
                    source={{ uri: capturingPhoto.photo.uri }}
                    style={{
                      width: '100%',
                      height: '100%'
                    }}
                    resizeMode="cover"
                  />
                  {showLabels && capturingPhoto.photo.mode && (
                    <PhotoLabel
                      label={capturingPhoto.photo.mode === PHOTO_MODES.BEFORE ? 'common.before' : 'common.after'}
                      position={capturingPhoto.labelPosition}
                    />
                  )}
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Share Project button at bottom - only show if photos exist and project is selected */}
      {photos.length > 0 && activeProjectId && (
        <TouchableOpacity
          style={[styles.deleteAllButtonBottom, { backgroundColor: '#F2C31B', marginTop: 20, marginBottom: 30 }]}
          onPress={() => setManageVisible(true)}
        >
          <Text style={[styles.deleteAllButtonBottomText, { color: '#000' }]}>
            📤 {t('gallery.shareProject')}
          </Text>
        </TouchableOpacity>
      )}

      {/* Full-screen photo view - single photo */}
      {fullScreenPhoto && (
        <TouchableWithoutFeedback onPress={handleLongPressEnd}>
          <View style={styles.fullScreenPhotoContainer}>
            <Image
              source={{ uri: fullScreenPhoto.uri }}
              style={styles.fullScreenPhoto}
              resizeMode="contain"
            />
            {/* Show label for individual before/after photos if showLabels is true */}
            {showLabels && fullScreenPhoto.mode && (
              <PhotoLabel
                label={
                  fullScreenPhoto.mode === 'before'
                    ? 'common.before'
                    : fullScreenPhoto.mode === 'after'
                    ? 'common.after'
                    : fullScreenPhoto.mode.toUpperCase()
                }
              />
            )}
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => shareIndividualPhoto(fullScreenPhoto)}
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.shareButtonText}>{t('gallery.share')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      )}

      {/* Full-screen combined photo view - 1:1 square with before/after */}
      {fullScreenPhotoSet && (
        <TouchableWithoutFeedback onPress={handleLongPressEnd}>
          <View style={styles.fullScreenPhotoContainer}>
            <View
              ref={combinedCaptureRef}
              collapsable={false}
              style={[
              styles.fullScreenCombinedPreview,
              (() => {
                const phoneOrientation = fullScreenPhotoSet.before.orientation || 'portrait';
                const cameraViewMode = fullScreenPhotoSet.before.cameraViewMode || 'portrait';
                const isLetterbox = fullScreenPhotoSet.before.templateType === 'letterbox' || (phoneOrientation === 'portrait' && cameraViewMode === 'landscape');
                const isLandscapeFull = phoneOrientation === 'landscape' && cameraViewMode === 'landscape';

                // Use STACKED for letterbox and landscape full (both create vertical combined photos)
                const shouldStack = isLetterbox || isLandscapeFull;
                const layoutStyle = shouldStack ? styles.fullScreenStacked : styles.fullScreenSideBySide;

                // Log dimensions for debugging
                console.log('[GalleryScreen] 📸 Combined Preview Opened:', {
                  photoName: fullScreenPhotoSet.before.name,
                  beforePhotoSize: {
                    width: fullScreenPhotoSet.before.width,
                    height: fullScreenPhotoSet.before.height
                  },
                  afterPhotoSize: {
                    width: fullScreenPhotoSet.after.width,
                    height: fullScreenPhotoSet.after.height
                  },
                  phoneOrientation,
                  cameraViewMode,
                  isLetterbox,
                  isLandscapeFull,
                  layout: shouldStack ? 'STACKED' : 'SIDE-BY-SIDE',
                  styleAspectRatio: layoutStyle.aspectRatio,
                  styleMaxHeight: layoutStyle.maxHeight
                });

                // In the enlarged view, letterbox and landscape full photos are stacked vertically.
                // Portrait photos are better side-by-side.
                return layoutStyle;
              })()
            ]}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                const photoWidth = fullScreenPhotoSet.before.width;
                const photoHeight = fullScreenPhotoSet.before.height;
                const photoAspectRatio = photoWidth / photoHeight;
                const containerAspectRatio = width / height;

                console.log('[GalleryScreen] 📐 Viewport vs Photo Dimensions:', {
                  photoName: fullScreenPhotoSet.before.name,
                  photoSize: { width: photoWidth, height: photoHeight, aspectRatio: photoAspectRatio.toFixed(2) },
                  viewportSize: { width: width.toFixed(0), height: height.toFixed(0), aspectRatio: containerAspectRatio.toFixed(2) },
                  fitPercentage: {
                    width: ((width / photoWidth) * 100).toFixed(1) + '%',
                    height: ((height / photoHeight) * 100).toFixed(1) + '%'
                  }
                });
              }}
            >
              <View style={styles.fullScreenHalf}>
                <Image
                  source={{ uri: fullScreenPhotoSet.before.uri }}
                  style={styles.fullScreenHalfImage}
                  resizeMode="cover"
                  onError={(error) => {
                  }}
                  onLoad={() => {
                  }}
                />
                {/* Show BEFORE label only if showLabels is true */}
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
                  onError={(error) => {
                  }}
                  onLoad={() => {
                  }}
                />
                {/* Show AFTER label only if showLabels is true */}
                {showLabels && (
                  <PhotoLabel 
                    label="common.after" 
                    position={afterLabelPosition || 'top-right'}
                  />
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => shareCombinedPhoto(fullScreenPhotoSet)}
              disabled={sharing}
            >
              {sharing ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.shareButtonText}>{t('gallery.share')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      )}

      {/* Rendering Combined Photos Modal */}
      <Modal
        visible={renderingCombined}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.uploadModalContainer}>
          <View style={styles.uploadModalContent}>
            <Text style={styles.uploadModalTitle}>{t('gallery.generatingCombined')}</Text>
            <Text style={styles.uploadModalProgress}>
              {renderingProgress.current} / {renderingProgress.total}
            </Text>
            <View style={styles.uploadProgressBar}>
              <View
                style={[
                  styles.uploadProgressFill,
                  { width: `${(renderingProgress.current / renderingProgress.total) * 100}%` }
                ]}
              />
            </View>
            {currentRenderPair && currentRenderTemplate && (
              <View
                ref={renderViewRef}
                style={[
                  styles.renderView,
                  {
                    width: currentRenderTemplate.config.width / 2,
                    height: currentRenderTemplate.config.height / 2
                  }
                ]}
              >
                <View style={currentRenderTemplate.config.layout === 'stack' ? styles.renderCol : styles.renderRow}>
                  <View style={styles.renderHalf}>
                    <Image
                      source={{ uri: currentRenderPair.before.uri }}
                      style={styles.renderImage}
                      resizeMode="cover"
                    />
                    {showLabels && (
                      <PhotoLabel label="common.before" />
                    )}
                  </View>
                  <View style={styles.renderHalf}>
                    <Image
                      source={{ uri: currentRenderPair.after.uri }}
                      style={styles.renderImage}
                      resizeMode="cover"
                    />
                    {showLabels && (
                      <PhotoLabel label="common.after" />
                    )}
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Upgrade overlay is rendered inside the Upload Options modal for correct stacking */}

      {/* Confirm Save Modal removed - Save button was removed from Share Project modal */}

      {/* Upgrade Modal */}
      <Modal
        visible={upgradeVisible && !optionsVisible}
        transparent={true}
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent={true}
        onRequestClose={() => setUpgradeVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('gallery.upgradeRequired')}</Text>
            <Text style={[styles.optionsSectionLabel, { marginBottom: 16 }]}>{t('gallery.unlockFormats')}</Text>
            <View style={[styles.optionsActionsRow, { marginTop: 0 }]}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionPrimary, styles.actionHalf]}
                onPress={() => setUpgradeVisible(false)}
              >
                <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>{t('gallery.upgrade')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionCancel, styles.actionHalf]}
                onPress={() => setUpgradeVisible(false)}
              >
                <Text style={styles.actionBtnText}>{t('gallery.notNow')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Upload Alert Modal */}
      {showUploadAlertModal && uploadAlertConfig && (
        <Modal
          visible={showUploadAlertModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowUploadAlertModal(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowUploadAlertModal(false)}>
            <View style={styles.optionsModalOverlay}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={styles.optionsModalContent}>
                  <Text style={styles.optionsTitle}>{uploadAlertConfig.title}</Text>
                  <Text style={[styles.optionsSectionLabel, { marginTop: 8, marginBottom: 24, textAlign: 'center' }]}>
                    {uploadAlertConfig.message}
                  </Text>
                  <View style={styles.optionsActionsRow}>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.actionCancel, styles.actionFlex]} 
                      onPress={() => setShowUploadAlertModal(false)}
                    >
                      <Text style={styles.actionBtnText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.actionPrimary, styles.actionFlex]} 
                      onPress={() => {
                        console.log('[UPLOAD] Go to Settings button pressed in custom modal');
                        console.log('[UPLOAD] uploadAlertConfig:', uploadAlertConfig);
                        if (uploadAlertConfig && uploadAlertConfig.onGoToSettings) {
                          uploadAlertConfig.onGoToSettings();
                        } else {
                          console.log('[UPLOAD] onGoToSettings not found, navigating directly');
                          setShowUploadAlertModal(false);
                          setTimeout(() => {
                            try {
                              // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                              navigation.goBack();
                              setTimeout(() => {
                                console.log('[UPLOAD] Direct navigation to Settings from parent screen');
                                navigation.navigate('Settings', { scrollToCloudSync: true });
                                console.log('[UPLOAD] Direct navigation call completed');
                              }, 100);
                            } catch (error) {
                              console.error('[UPLOAD] Direct navigation error:', error);
                            }
                          }, 300);
                        }
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>
                        {t('gallery.goToSettings')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}

      {/* Upload Progress Modal */}
      <Modal
        visible={uploading}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.uploadModalContainer}>
          <View style={styles.uploadModalContent}>
            <ActivityIndicator size="large" />
            <Text style={styles.uploadModalTitle}>{t('gallery.uploadingPhotos')}</Text>
            <Text style={styles.uploadModalProgress}>
              {uploadProgress.current} / {uploadProgress.total}
            </Text>
            <View style={styles.uploadProgressBar}>
              <View
                style={[
                  styles.uploadProgressFill,
                  { width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }
                ]}
              />
            </View>
            <View style={[styles.optionsActionsRow, { marginTop: 16, width: '100%' }]}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionCancel, { paddingVertical: 16, width: '100%' }]}
                onPress={() => {
                  try {
                    // Abort in-flight requests
                    for (const c of uploadControllersRef.current) {
                      try { c.abort(); } catch {}
                    }
                    // Abort scheduling of further batches
                    try { masterAbortRef.current?.abort(); } catch {}
                  } finally {
                    uploadControllersRef.current = [];
                    masterAbortRef.current = null;
                    setUploading(false);
                  }
                }}
              >
                <Text style={[styles.actionBtnText, { textTransform: 'none' }]}>{t('gallery.cancelUpload')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Upload Options Modal */}
      <Modal
        visible={optionsVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setOptionsVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('gallery.whatToUpload')}</Text>

            {/* Upload Destination Selection */}
            <Text style={styles.optionsSectionLabel}>{t('gallery.uploadDestination')}</Text>
            
            {/* Google Drive Checkbox */}
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => {
                  if (isAuthenticated) {
                    setUploadDestinations(prev => ({ ...prev, google: !prev.google }));
                  } else {
                    console.log('[UPLOAD] Google checkbox clicked but not authenticated, showing custom modal');
                    setUploadAlertConfig({
                      title: t('gallery.googleNotConnected'),
                      message: t('gallery.googleNotConnectedMessage'),
                      onGoToSettings: () => {
                        console.log('[UPLOAD] onGoToSettings callback called (from Google checkbox)');
                        console.log('[UPLOAD] Closing modal first');
                        setShowUploadAlertModal(false);
                        setTimeout(() => {
                          console.log('[UPLOAD] Executing navigation to Settings');
                          try {
                            // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                            navigation.goBack();
                            setTimeout(() => {
                              console.log('[UPLOAD] Navigating to Settings from parent screen');
                              navigation.navigate('Settings', { scrollToCloudSync: true });
                              console.log('[UPLOAD] Navigation call completed');
                            }, 100);
                          } catch (error) {
                            console.error('[UPLOAD] Navigation error:', error);
                          }
                        }, 300);
                      }
                    });
                    setShowUploadAlertModal(true);
                  }
                }}
                disabled={!isAuthenticated}
              >
                <View style={[
                  styles.checkbox,
                  uploadDestinations.google && styles.checkboxChecked,
                  !isAuthenticated && styles.checkboxDisabled
                ]}>
                  {uploadDestinations.google && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <View style={styles.checkboxLabelContainer}>
                  <Text style={[
                    styles.checkboxLabelText,
                    !isAuthenticated && styles.checkboxLabelDisabled
                  ]}>
                    {t('gallery.googleDrive')}
                  </Text>
                  {isAuthenticated && (
                    <View style={styles.connectedIndicatorInline}>
                      <Text style={styles.connectedCheckmarkInline}>✓</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>

            {/* Dropbox Checkbox */}
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={async () => {
                  await dropboxAuthService.loadStoredTokens();
                  const connected = dropboxAuthService.isAuthenticated();
                  setIsDropboxConnected(connected);
                  if (connected) {
                    setUploadDestinations(prev => ({ ...prev, dropbox: !prev.dropbox }));
                  } else {
                    console.log('[UPLOAD] Dropbox checkbox clicked but not authenticated, showing custom modal');
                    setUploadAlertConfig({
                      title: t('gallery.dropboxNotConnected'),
                      message: t('gallery.dropboxNotConnectedMessage'),
                      onGoToSettings: () => {
                        console.log('[UPLOAD] onGoToSettings callback called (from Dropbox checkbox)');
                        console.log('[UPLOAD] Closing modal first');
                        setShowUploadAlertModal(false);
                        setTimeout(() => {
                          console.log('[UPLOAD] Executing navigation to Settings');
                          try {
                            // Since Gallery is a fullScreenModal, we need to go back first, then navigate
                            navigation.goBack();
                            setTimeout(() => {
                              console.log('[UPLOAD] Navigating to Settings from parent screen');
                              navigation.navigate('Settings', { scrollToCloudSync: true });
                              console.log('[UPLOAD] Navigation call completed');
                            }, 100);
                          } catch (error) {
                            console.error('[UPLOAD] Navigation error:', error);
                          }
                        }, 300);
                      }
                    });
                    setShowUploadAlertModal(true);
                  }
                }}
                disabled={!isDropboxConnected}
              >
                <View style={[
                  styles.checkbox,
                  uploadDestinations.dropbox && styles.checkboxCheckedDropbox,
                  !isDropboxConnected && styles.checkboxDisabled
                ]}>
                  {uploadDestinations.dropbox && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <View style={styles.checkboxLabelContainer}>
                  <Text style={[
                    styles.checkboxLabelText,
                    !isDropboxConnected && styles.checkboxLabelDisabled
                  ]}>
                    {t('gallery.dropbox')}
                  </Text>
                  {isDropboxConnected && (
                    <View style={styles.connectedIndicatorInlineDropbox}>
                      <Text style={styles.connectedCheckmarkInline}>✓</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            </View>

            {/* Warning if no destination selected */}
            {!uploadDestinations.google && !uploadDestinations.dropbox && (
              <Text style={styles.warningText}>{t('gallery.selectAtLeastOneDestination')}</Text>
            )}

            <Text style={[styles.optionsSectionLabel, { marginTop: 16 }]}>{t('gallery.photoTypes')}</Text>
            <View style={[styles.optionsChipsRow, { justifyContent: 'space-between', alignItems: 'stretch', flexWrap: 'nowrap', gap: 0 }]}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  { flex: 1, marginRight: 4 },
                  selectedTypes.before && styles.chipActive
                ]}
                onPress={() => setSelectedTypes(prev => ({ ...prev, before: !prev.before }))}
              >
                <Text style={[styles.chipText, selectedTypes.before && styles.chipTextActive]}>{t('camera.before')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chip,
                  { flex: 1, marginHorizontal: 4 },
                  selectedTypes.after && styles.chipActive
                ]}
                onPress={() => setSelectedTypes(prev => ({ ...prev, after: !prev.after }))}
              >
                <Text style={[styles.chipText, selectedTypes.after && styles.chipTextActive]}>{t('camera.after')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.chip,
                  { flex: 1, marginLeft: 4, marginRight: 0 },
                  selectedTypes.combined && styles.chipActive
                ]}
                onPress={() => setSelectedTypes(prev => ({ ...prev, combined: !prev.combined }))}
              >
                <Text style={[styles.chipText, selectedTypes.combined && styles.chipTextActive]}>{t('camera.combined')}</Text>
              </TouchableOpacity>
            </View>

            {selectedTypes.combined && (
              <>
                {/* Advanced toggle */}
                {!showAdvancedFormats && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionCancel, { marginTop: 12 }]}
                    onPress={() => setShowAdvancedFormats(true)}
                  >
                    <Text style={styles.actionBtnText}>{t('gallery.showAdvancedFormats')}</Text>
                  </TouchableOpacity>
                )}

                {showAdvancedFormats && (
                  <>
                    <Text style={[styles.optionsSectionLabel, { marginTop: 16 }]}>{t('gallery.stackedFormats')}</Text>
                    <View style={styles.optionsChipsRow}>
                      {Object.entries(TEMPLATE_CONFIGS)
                        .filter(([k, cfg]) => cfg.layout === 'stack')
                        .map(([key, cfg]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.chip, selectedFormats[key] && styles.chipActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.chipText, selectedFormats[key] && styles.chipTextActive]}>{cfg.name}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={[styles.optionsSectionLabel, { marginTop: 12 }]}>{t('gallery.sideBySideFormats')}</Text>
                    <View style={styles.optionsChipsRow}>
                      {Object.entries(TEMPLATE_CONFIGS)
                        .filter(([k, cfg]) => cfg.layout === 'sidebyside')
                        .map(([key, cfg]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.chip, selectedFormats[key] && styles.chipActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.chipText, selectedFormats[key] && styles.chipTextActive]}>{cfg.name}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionCancel, { marginTop: 12 }]}
                      onPress={() => setShowAdvancedFormats(false)}
                    >
                      <Text style={styles.actionBtnText}>{t('gallery.hideAdvancedFormats')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}

            <View style={styles.optionsActionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionCancel, styles.actionFlex]} onPress={() => setOptionsVisible(false)}>
                <Text style={styles.actionBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary, styles.actionFlex]} onPress={() => {
                console.log('[UPLOAD] Start Upload button pressed');
                startUploadWithOptions();
              }}>
                <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>{t('gallery.startUpload')}</Text>
              </TouchableOpacity>
            </View>
            {/* Inline upgrade overlay (absolute) to ensure it's above any content */}
            {upgradeVisible && (
              <View style={styles.inlineOverlay} pointerEvents="auto">
                <View style={styles.inlineOverlayCard}>
                  <Text style={styles.optionsTitle}>Upgrade required</Text>
                  <Text style={[styles.optionsSectionLabel, { marginBottom: 16 }]}>Unlock more formats with Business</Text>
                  <View style={[styles.optionsActionsRow, { marginTop: 0 }]}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionPrimary, styles.actionHalf]}
                      onPress={() => {
                        setUpgradeVisible(false);
                        setOptionsVisible(false);
                        navigation.navigate('Settings');
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>{t('gallery.upgrade')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionCancel, styles.actionHalf]}
                      onPress={() => setUpgradeVisible(false)}
                    >
                      <Text style={styles.actionBtnText}>{t('gallery.notNow')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Share Project Modal */}
      <Modal
        visible={manageVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setManageVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('gallery.shareProject')}</Text>

            <View>
              <View style={{ marginTop: 4 }} />

              <View style={styles.actionsList}>
                {selectedPhotos.size > 0 ? (
                  // Show selected photos actions
                  <>
                    {/* Upload Selected (primary) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionPrimaryFlat]}
                      onPress={() => {
                        setManageVisible(false);
                        handleUploadSelected();
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>
                        📤 Upload Selected ({selectedPhotos.size})
                      </Text>
                    </TouchableOpacity>

                    {/* Share Selected (light blue) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionInfo]}
                      onPress={() => {
                        setManageVisible(false);
                        handleShareSelected();
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionInfoText]}>
                        🔗 Share Selected ({selectedPhotos.size})
                      </Text>
                    </TouchableOpacity>

                    {/* Delete Selected (red) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionDestructive]}
                      onPress={() => {
                        setManageVisible(false);
                        handleDeleteSelected();
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionDestructiveText]}>
                        🗑️ Delete Selected ({selectedPhotos.size})
                      </Text>
                    </TouchableOpacity>

                    {/* Preview Selected */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, { backgroundColor: '#2196F3' }]}
                      onPress={() => {
                        setManageVisible(false);
                        handlePreviewSelected();
                      }}
                    >
                      <Text style={[styles.actionBtnText, { color: 'white' }]}>
                        👁️ Preview Selected ({selectedPhotos.size})
                      </Text>
                    </TouchableOpacity>

                    {/* Deselect */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, { backgroundColor: '#9E9E9E' }]}
                      onPress={() => {
                        setManageVisible(false);
                        // Clear selection and exit selection mode
                        setSelectedPhotos(new Set());
                        isSelectionModeRef.current = false;
                        setIsSelectionMode(false);
                        setShowOnlySelected(false); // Clear filter when deselecting
                      }}
                    >
                      <Text style={[styles.actionBtnText, { color: 'white' }]}>
                        ✕ Deselect
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  // Show normal actions when no photos selected
                  <>
                    {/* Upload All (primary) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionPrimaryFlat]}
                      onPress={() => {
                        console.log('[UPLOAD] Upload All button pressed from manage menu');
                        setManageVisible(false);
                        handleUploadPhotos();
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionPrimaryText]}>
                        📤 {t('gallery.uploadAll')}
                      </Text>
                    </TouchableOpacity>

                    {/* Share All (light blue) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionInfo]}
                      onPress={() => {
                        setManageVisible(false);
                        handleShareProject();
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionInfoText]}>
                        🔗 {t('gallery.shareAll')}
                      </Text>
                    </TouchableOpacity>

                    {/* Delete All (red) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, styles.actionDestructive]}
                      onPress={() => {
                        setManageVisible(false);
                        setShowDeleteAllConfirm(true);
                      }}
                    >
                      <Text style={[styles.actionBtnText, styles.actionDestructiveText]}>
                        🗑️ {t('gallery.deleteAll')}
                      </Text>
                    </TouchableOpacity>

                    {/* Select Photos (green) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionWide, { backgroundColor: '#4CAF50' }]}
                      onPress={() => {
                        setManageVisible(false);
                        // Activate selection mode
                        isSelectionModeRef.current = true;
                        setIsSelectionMode(true);
                      }}
                    >
                      <Text style={[styles.actionBtnText, { color: 'white' }]}>
                        ✓ {t('gallery.selectPhotos')}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              <View style={styles.optionsActionsRowCenter}>
                <TouchableOpacity style={[styles.actionBtn, styles.actionWide, styles.actionCancel]} onPress={() => setManageVisible(false)}>
                  <Text style={styles.actionBtnText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share Loading Modal */}
      <Modal
        visible={sharing}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}} // Prevent closing during sharing
      >
        <View style={styles.modalOverlay}>
          <View style={styles.loadingModal}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>
              {showLabels ? t('gallery.preparingPhotosWithLabels') : t('gallery.preparingPhotosCopying')}
            </Text>
            <Text style={styles.loadingSubtext}>{t('gallery.mayTakeFewSeconds')}</Text>
          </View>
        </View>
      </Modal>

      {/* Share Project Modal */}
      <Modal
        visible={shareOptionsVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          console.log('[GALLERY] Share options modal close requested');
          setShareOptionsVisible(false);
          setShowAdvancedShareFormats(false);
        }}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>{t('gallery.whatToShare')}</Text>

            <Text style={styles.optionsSectionLabel}>{t('gallery.photoTypes')}</Text>
            <View style={[styles.optionsChipsRow, { justifyContent: 'space-between', alignItems: 'stretch', flexWrap: 'nowrap', gap: 0 }]}>
              <TouchableOpacity
                style={[
                  {
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 4,
                  },
                  selectedShareTypes.before
                    ? { backgroundColor: '#4CAF50', borderColor: '#4CAF50' }
                    : { backgroundColor: '#FFFFFF', borderColor: '#4CAF50' }
                ]}
                onPress={() => setSelectedShareTypes(prev => ({ ...prev, before: !prev.before }))}
              >
                <Text style={[
                  { fontSize: 12, fontWeight: '500' },
                  selectedShareTypes.before
                    ? { color: '#000000' }
                    : { color: '#4CAF50' }
                ]}>{t('camera.before')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  {
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginHorizontal: 4,
                  },
                  selectedShareTypes.after
                    ? { backgroundColor: '#2196F3', borderColor: '#2196F3' }
                    : { backgroundColor: '#FFFFFF', borderColor: '#2196F3' }
                ]}
                onPress={() => setSelectedShareTypes(prev => ({ ...prev, after: !prev.after }))}
              >
                <Text style={[
                  { fontSize: 12, fontWeight: '500' },
                  selectedShareTypes.after
                    ? { color: '#000000' }
                    : { color: '#2196F3' }
                ]}>{t('camera.after')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  {
                    flex: 1,
                    paddingVertical: 6,
                    borderRadius: 20,
                    borderWidth: 2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: 4,
                  },
                  selectedShareTypes.combined
                    ? { backgroundColor: '#FFC107', borderColor: '#FFC107' }
                    : { backgroundColor: '#FFFFFF', borderColor: '#FFC107' }
                ]}
                onPress={() => setSelectedShareTypes(prev => ({ ...prev, combined: !prev.combined }))}
              >
                <Text style={[
                  { fontSize: 12, fontWeight: '500' },
                  selectedShareTypes.combined
                    ? { color: '#000000' }
                    : { color: '#FFC107' }
                ]}>{t('camera.combined')}</Text>
              </TouchableOpacity>
            </View>

            {/* Advanced formats section - only show if combined is selected */}
            {selectedShareTypes.combined && (
              <>
                {/* Advanced toggle */}
                {!showAdvancedShareFormats && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionPrimary, { marginTop: 12, marginLeft: 0, marginRight: 0, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
                    onPress={() => setShowAdvancedShareFormats(true)}
                  >
                    <Text style={[styles.actionBtnText, { color: '#000000' }]}>{t('gallery.showAdvancedFormats')}</Text>
                    <Text style={{ color: '#000000', fontSize: 16, marginLeft: 8 }}>▼</Text>
                  </TouchableOpacity>
                )}

                {showAdvancedShareFormats && (
                  <>
                    <Text style={[styles.optionsSectionLabel, { marginTop: 16 }]}>{t('gallery.stackedFormats')}</Text>
                    <View style={styles.optionsChipsRow}>
                      {Object.entries(TEMPLATE_CONFIGS)
                        .filter(([k, cfg]) => cfg.layout === 'stack')
                        .map(([key, cfg]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.chip, selectedFormats[key] && styles.chipActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.chipText, selectedFormats[key] && styles.chipTextActive]}>{cfg.name}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={[styles.optionsSectionLabel, { marginTop: 12 }]}>{t('gallery.sideBySideFormats')}</Text>
                    <View style={styles.optionsChipsRow}>
                      {Object.entries(TEMPLATE_CONFIGS)
                        .filter(([k, cfg]) => cfg.layout === 'sidebyside')
                        .map(([key, cfg]) => (
                          <TouchableOpacity
                            key={key}
                            style={[styles.chip, selectedFormats[key] && styles.chipActive]}
                            onPress={() => handleFormatToggle(key)}
                          >
                            <Text style={[styles.chipText, selectedFormats[key] && styles.chipTextActive]}>{cfg.name}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionPrimary, { marginTop: 12, marginLeft: 0, marginRight: 0, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }]}
                      onPress={() => setShowAdvancedShareFormats(false)}
                    >
                      <Text style={[styles.actionBtnText, { color: '#000000' }]}>{t('gallery.hideAdvancedFormats')}</Text>
                      <Text style={{ color: '#000000', fontSize: 16, marginLeft: 8 }}>▲</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}

            {/* Share as Archive Checkbox */}
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                style={styles.checkboxContainer}
                onPress={() => {
                  // For starter users, archive should always be checked
                  // If trying to uncheck, show plan modal
                  if (shareAsArchive && !canUse(FEATURES.ADVANCED_TEMPLATES)) {
                    console.log('[GALLERY] Starter user trying to uncheck archive, showing plan modal');
                    setShowSharePlanModal(true);
                    return;
                  }
                  setShareAsArchive(!shareAsArchive);
                }}
              >
                <View style={[
                  styles.checkbox,
                  shareAsArchive && styles.checkboxChecked
                ]}>
                  {shareAsArchive && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <View style={styles.checkboxLabelContainer}>
                  <Text style={styles.checkboxLabelText}>
                    {t('gallery.shareAsArchive')}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.optionsActionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionCancel, styles.actionFlex]} onPress={() => {
                console.log('[GALLERY] Share options modal canceled');
                setShareOptionsVisible(false);
                // Reset advanced formats state when closing
                setShowAdvancedShareFormats(false);
                setShowSharePlanModal(false);
              }}>
                <Text style={styles.actionBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionPrimary, styles.actionFlex]} onPress={() => {
                  setShareOptionsVisible(false);
                  startSharingWithOptions();
              }}>
                <Text style={[styles.actionBtnText, { color: '#000000' }]}>{t('gallery.startToShare')}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Plan Selection Modal Overlay - Rendered as sibling of share modal content (only when share modal is visible) */}
          {showSharePlanModal && shareOptionsVisible && (
            <View style={styles.planModalOverlayAbsolute}>
              <View style={styles.planModalContent}>
                <View style={styles.planModalHeader}>
                  <Text style={styles.planModalTitle}>{t('planModal.title')}</Text>
                  <TouchableOpacity
                    onPress={handleSharePlanModalClose}
                    style={styles.planModalCloseButton}
                  >
                    <Text style={styles.planModalCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView 
                  style={styles.planModalScrollView}
                  contentContainerStyle={styles.planModalScrollViewContent}
                  showsVerticalScrollIndicator={true}
                >
                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                      onPress={async () => {
                        console.log('[GALLERY] Plan selected: starter');
                        await updateUserPlan('starter');
                        handleSharePlanModalClose();
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
                        console.log('[GALLERY] Plan selected: pro');
                        await updateUserPlan('pro');
                        handleSharePlanModalClose();
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
                        console.log('[GALLERY] Plan selected: business');
                        await updateUserPlan('business');
                        handleSharePlanModalClose();
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('planModal.business')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('planModal.businessDescription')}</Text>
                  </View>

                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                      onPress={async () => {
                        console.log('[GALLERY] Plan selected: enterprise');
                        await updateUserPlan('enterprise');
                        handleSharePlanModalClose();
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('planModal.enterprise')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('planModal.enterpriseDescription')}</Text>
                  </View>
                </ScrollView>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Standalone Plan Selection Modal - Shown independently (e.g., from delete confirmation) */}
      <Modal
        visible={showSharePlanModal && !shareOptionsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleSharePlanModalClose}
        statusBarTranslucent={true}
        hardwareAccelerated={true}
        presentationStyle="overFullScreen"
      >
        <View style={styles.planModalOverlay} pointerEvents="box-none">
          <View style={styles.planModalContent} pointerEvents="auto">
            <View style={styles.planModalHeader}>
              <Text style={styles.planModalTitle}>{t('planModal.title')}</Text>
              <TouchableOpacity
                onPress={handleSharePlanModalClose}
                style={styles.planModalCloseButton}
              >
                <Text style={styles.planModalCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.planModalScrollView}
              contentContainerStyle={styles.planModalScrollViewContent}
              showsVerticalScrollIndicator={true}
            >
              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                  onPress={async () => {
                    console.log('[GALLERY] Plan selected: starter');
                    await updateUserPlan('starter');
                    handleSharePlanModalClose();
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
                    console.log('[GALLERY] Plan selected: pro');
                    await updateUserPlan('pro');
                    handleSharePlanModalClose();
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
                    console.log('[GALLERY] Plan selected: business');
                    await updateUserPlan('business');
                    handleSharePlanModalClose();
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('planModal.business')}</Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('planModal.businessDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                  onPress={async () => {
                    console.log('[GALLERY] Plan selected: enterprise');
                    await updateUserPlan('enterprise');
                    handleSharePlanModalClose();
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

      {/* Upload Completion Modal */}
      <UploadCompletionModal
        visible={showCompletionModal}
        completedUploads={uploadStatus.completedUploads}
        onClose={() => setShowCompletionModal(false)}
        onClearCompleted={clearCompletedUploads}
        onDeleteProject={handleDeleteAllConfirmed}
        userPlan={userPlan}
        onShowPlanModal={() => {
          setTimeout(() => {
            setShowSharePlanModal(true);
          }, 300);
        }}
        planModalVisible={showSharePlanModal}
      />

      {/* Upload Details Modal */}
      <UploadDetailsModal
        visible={showUploadDetails}
        uploadStatus={uploadStatus}
        onClose={() => setShowUploadDetails(false)}
        onCancelUpload={cancelUpload}
        onMinimize={() => setShowUploadDetails(false)}
      />

      {/* Delete All Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showDeleteAllConfirm}
        title={activeProjectId ? t('gallery.deleteProjectTitle') : t('gallery.deleteAll')}
        message={activeProjectId ? t('gallery.deleteProjectMessage') : t('gallery.deleteAllMessage', { default: 'Are you sure you want to delete all photos? This action cannot be undone.' })}
        onConfirm={handleDeleteAllConfirmed}
        onCancel={() => setShowDeleteAllConfirm(false)}
        deleteFromStorageDefault={true}
        userPlan={userPlan}
        onShowPlanModal={() => {
          // Show plan modal on top of delete confirmation (don't close delete confirmation)
          setShowSharePlanModal(true);
        }}
        planModalVisible={showSharePlanModal && !shareOptionsVisible}
        onPlanModalClose={handleSharePlanModalClose}
        updateUserPlan={updateUserPlan}
        t={t}
      />

      {/* Delete Selected Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showDeleteSelectedConfirm}
        title={t('gallery.deleteSelected')}
        message={showDeleteSelectedConfirm ? (() => {
          const selected = getSelectedPhotos();
          const selectedSets = getSelectedPhotoSets();
          const count = selected.length + selectedSets.length;
          return t('gallery.deleteSelectedMessage', { count, default: `Delete ${count} selected photo(s)? This action cannot be undone.` });
        })() : ''}
        onConfirm={handleDeleteSelectedConfirmed}
        onCancel={() => setShowDeleteSelectedConfirm(false)}
        deleteFromStorageDefault={true}
        userPlan={userPlan}
        onShowPlanModal={() => {
          // Show plan modal on top of delete confirmation (don't close delete confirmation)
          setShowSharePlanModal(true);
        }}
        planModalVisible={showSharePlanModal && !shareOptionsVisible}
        onPlanModalClose={handleSharePlanModalClose}
        updateUserPlan={updateUserPlan}
        t={t}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND,
    paddingTop: 50 // Add padding to avoid status bar overlap
  },
  swipeIndicator: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4
  },
  swipeHandle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.GRAY,
    borderRadius: 2
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER
  },
  backButton: {
    width: 60
  },
  backButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT
  },
  projectNameContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: -6,
    marginBottom: 6,
    backgroundColor: 'white'
  },
  projectNameText: {
    fontSize: 12,
    color: COLORS.TEXT,
    opacity: 0.7,
    fontWeight: '500',
    flex: 1
  },
  selectButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: COLORS.PRIMARY,
    marginLeft: 12,
    minWidth: 80,
    alignItems: 'center'
  },
  selectButtonActive: {
    backgroundColor: '#FF6B6B'
  },
  selectButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600'
  },
  projectNameContainerSelectionMode: {
    backgroundColor: '#E8F5E9'
  },
  selectionModeIndicator: {
    fontSize: 10,
    color: COLORS.PRIMARY,
    fontWeight: 'bold',
    marginRight: 8
  },
  uploadButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center'
  },
  uploadButtonText: {
    fontSize: 20
  },
  deleteAllButtonBottom: {
    backgroundColor: '#FF4444',
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
  deleteAllButtonBottomText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16
  },
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.BORDER
  },
  columnHeader: {
    flex: 1,
    marginRight: 8,
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.GRAY,
    textAlign: 'center',
    flexShrink: 1,
    numberOfLines: 1
  },
  filterButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0'
  },
  filterButtonActive: {
    backgroundColor: '#E3F2FD',
    borderColor: '#2196F3',
    borderWidth: 2
  },
  filterButtonText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: COLORS.GRAY,
    textAlign: 'center',
    flexShrink: 1,
    numberOfLines: 1
  },
  filterButtonTextActive: {
    color: '#2196F3',
    fontWeight: 'bold'
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
  roomIcon: {
    fontSize: 24,
    marginRight: 8
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
    borderRadius: 8,
    borderWidth: 3,
    overflow: 'hidden',
    backgroundColor: 'white',
    marginRight: 8,
    position: 'relative'
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
    flexDirection: 'column',
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.PRIMARY
  },
  sideBySideThumbnail: {
    flexDirection: 'row',
    borderLeftWidth: 2,
    borderLeftColor: COLORS.PRIMARY,
    borderRightWidth: 2,
    borderRightColor: COLORS.PRIMARY
  },
  halfImage: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.PRIMARY
  },
  modeLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 4,
    paddingHorizontal: 8,
    alignItems: 'center'
  },
  modeLabelText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold'
  },
  photoCheckboxContainer: {
    width: 28,
    height: 28,
    borderRadius: 14, // Fully round
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden' // Ensure it stays round
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
  photoCheckmark: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold'
  },
  photoCardSelected: {
    borderWidth: 4,
    opacity: 0.8
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
    textAlign: 'center',
    flexShrink: 1
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: COLORS.GRAY,
    textAlign: 'center',
    flexShrink: 1,
    flexWrap: 'wrap'
  },
  fullScreenPhotoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  fullScreenPhoto: {
    width: '100%',
    height: '100%'
  },
  fullScreenCombinedPreview: {
    width: '90%',
    maxWidth: 500,
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: COLORS.PRIMARY
  },
  fullScreenStacked: {
    flexDirection: 'column',
    aspectRatio: 18 / 9, // 2.0 - height is twice width for vertical stacked photos
    maxHeight: '90%' // Allow taller for vertical photos
  },
  fullScreenSideBySide: {
    flexDirection: 'row',
    aspectRatio: 16 / 9, // Horizontal aspect ratio for side-by-side photos
    maxHeight: 500
  },
  fullScreenHalf: {
    flex: 1
  },
  fullScreenHalfImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenLabel: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  fullScreenLabelText: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: 'bold'
  },
  fullScreenIndividualLabel: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6
  },
  fullScreenIndividualLabelText: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: 'bold'
  },
  uploadModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  uploadModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 280
  },
  uploadModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginTop: 16,
    marginBottom: 8
  },
  uploadModalProgress: {
    fontSize: 16,
    color: COLORS.GRAY,
    marginBottom: 16
  },
  uploadProgressBar: {
    width: '100%',
    height: 8,
    backgroundColor: COLORS.BORDER,
    borderRadius: 4,
    overflow: 'hidden'
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 4
  },
  renderView: {
    backgroundColor: 'white',
    marginTop: 20,
    borderRadius: 8,
    overflow: 'hidden'
  },
  renderRow: {
    flexDirection: 'row',
    flex: 1
  },
  renderCol: {
    flexDirection: 'column',
    flex: 1
  },
  renderHalf: {
    flex: 1,
    position: 'relative'
  },
  renderImage: {
    width: '100%',
    height: '100%'
  },
  // Options modal styles
  optionsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000
  },
  optionsModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    width: '86%',
    maxWidth: 380,
    zIndex: 1001,
    elevation: 1001
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingModal: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    width: '80%',
    maxWidth: 300
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginTop: 16,
    textAlign: 'center'
  },
  loadingSubtext: {
    fontSize: 14,
    color: COLORS.GRAY,
    marginTop: 8,
    textAlign: 'center'
  },
  inlineOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  inlineOverlayCard: {
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
  optionsSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.GRAY,
    marginBottom: 8
  },
  optionsChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#F2F2F2',
    marginRight: 8,
    marginBottom: 8
  },
  chipActive: {
    backgroundColor: '#E8F3FF',
    borderWidth: 1,
    borderColor: COLORS.PRIMARY
  },
  chipActiveDropbox: {
    backgroundColor: '#E6F0FF',
    borderWidth: 1,
    borderColor: '#0061FF'
  },
  chipText: {
    color: COLORS.TEXT,
    fontSize: 14,
    fontWeight: '500'
  },
  chipTextActive: {
    color: COLORS.PRIMARY
  },
  chipTextActiveDropbox: {
    color: '#0061FF',
    fontWeight: '600'
  },
  chipContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  connectedIndicator: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0061FF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  connectedIndicatorGoogle: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center'
  },
  connectedCheckmark: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold'
  },
  connectedAccountText: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
    textAlign: 'center'
  },
  chipDisabled: {
    backgroundColor: COLORS.BORDER,
    borderColor: COLORS.BORDER,
    opacity: 0.5
  },
  chipTextDisabled: {
    color: COLORS.GRAY
  },
  warningText: {
    fontSize: 12,
    color: '#FF6B6B',
    marginTop: 4,
    textAlign: 'center'
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  checkboxChecked: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  checkboxCheckedDropbox: {
    backgroundColor: '#0061FF',
    borderColor: '#0061FF'
  },
  checkboxDisabled: {
    opacity: 0.5,
    backgroundColor: COLORS.BORDER
  },
  checkmark: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  },
  checkboxLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  checkboxLabelText: {
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '500',
    flex: 1
  },
  checkboxLabelDisabled: {
    color: COLORS.GRAY,
    opacity: 0.5
  },
  connectedIndicatorInline: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8
  },
  connectedIndicatorInlineDropbox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0061FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8
  },
  connectedCheckmarkInline: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold'
  },
  optionsActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16
  },
  actionFlex: {
    flex: 1
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12
  },
  actionsList: {
    alignItems: 'center'
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  checkboxRow: {
    marginTop: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  checkboxLabel: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginRight: 12
  },
  actionBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 6
  },
  actionHalf: {
    width: '48%'
  },
  actionWide: {
    width: '92%'
  },
  optionsActionsRowCenter: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8
  },
  actionCancel: {
    backgroundColor: '#F2F2F2',
    marginRight: 8
  },
  actionPrimary: {
    backgroundColor: COLORS.PRIMARY,
    marginLeft: 8
  },
  actionPrimaryFlat: {
    backgroundColor: COLORS.PRIMARY
  },
  actionFull: {
    alignSelf: 'stretch'
  },
  actionGreen: {
    backgroundColor: '#22A45D'
  },
  actionSave: {
    backgroundColor: '#FFE6B3'
  },
  actionSaveText: {
    color: '#8A5A00'
  },
  actionInfo: {
    backgroundColor: '#D6ECFF'
  },
  actionBtnText: {
    color: COLORS.TEXT,
    fontWeight: '600'
  },
  actionPrimaryText: {
    color: 'white'
  },
  actionInfoText: {
    color: '#0077CC'
  },
  actionDestructive: {
    backgroundColor: '#FFE6E6',
    marginTop: 8
  },
  actionDestructiveText: {
    color: '#CC0000',
    fontWeight: '700'
  },
  shareButton: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
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
  shareButtonText: {
    color: COLORS.TEXT,
    fontSize: 18,
    fontWeight: 'bold'
  },
  // Plan Selection Modal styles
  planModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
    zIndex: 10001,
    elevation: 10001,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  planModalOverlayAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    zIndex: 10000,
    elevation: 10000,
    paddingBottom: 0
  },
  planModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    zIndex: 10002,
    elevation: 10002,
    overflow: 'hidden',
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
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
    maxHeight: Dimensions.get('window').height * 0.6
  },
  planModalScrollViewContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 80,
    flexGrow: 1
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
    fontWeight: '600',
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
  }
});

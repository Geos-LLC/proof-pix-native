import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  PanResponder,
  Share,
  Dimensions,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { savePhotoToDevice } from '../services/storage';
import { COLORS, TEMPLATE_TYPES, TEMPLATE_CONFIGS, LABEL_POSITIONS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import PhotoLabel from '../components/PhotoLabel';
import { logBeforeAfterCreated, logCollageCompleted, logJobCompleted, logPhotoExport } from '../utils/analytics';
import PhotoWatermark from '../components/PhotoWatermark';
import SoftTrialBadge from '../components/SoftTrialBadge';
import { canExportNow, recordExport, logBlocked } from '../services/softTrialService';
import {
  SOFT_TRIAL_LOW_RES_MAX_DIM,
  SOFT_TRIAL_QUALITY,
  PAYWALL_TRIGGERS,
} from '../constants/softTrial';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import { useTranslation } from 'react-i18next';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { ensureShareAllowed, recordShare } from '../utils/shareRateLimit';

export default function PhotoEditorScreen({ route, navigation }) {
  const { beforePhoto, afterPhoto, isSelectionMode = false, selectedPhotos = [], onSelectionChange, allPhotoSets: providedPhotoSets } = route.params;

  // Set default template based on PHONE ORIENTATION or CAMERA VIEW MODE
  // Landscape phone position OR landscape camera view → stacked (horizontal split)
  // Portrait phone position AND portrait camera view → side-by-side (vertical split)
  const getDefaultTemplate = () => {
    const phoneOrientation = beforePhoto.orientation || 'portrait';
    const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
    // Prefer original layout first
    if (phoneOrientation === 'landscape' || cameraViewMode === 'landscape') {
      return 'original-stack';
    }
    return 'original-side';
  };

  const [templateType, setTemplateType] = useState(getDefaultTemplate());
  const [saving, setSaving] = useState(false);
  const [currentPhotoSet, setCurrentPhotoSet] = useState({ before: beforePhoto, after: afterPhoto });
  const [allPhotoSets, setAllPhotoSets] = useState([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  
  // Get selection state for current photo set
  const getCombinedId = (photoSet) => {
    return `combined_${photoSet.before.id}`;
  };
  
  // Track selected photos locally
  const [localSelectedPhotos, setLocalSelectedPhotos] = useState(new Set(selectedPhotos));
  const selectedPhotosRef = useRef(selectedPhotos);
  
  // Sync with route params when they change
  useEffect(() => {
    // Only update if the array contents actually changed
    const prevArray = selectedPhotosRef.current;
    const hasChanged = prevArray.length !== selectedPhotos.length || 
                       prevArray.some((id, idx) => id !== selectedPhotos[idx]);
    
    if (hasChanged) {
      selectedPhotosRef.current = selectedPhotos;
      const newSet = new Set(selectedPhotos);
      setLocalSelectedPhotos(newSet);
      const combinedId = getCombinedId(currentPhotoSet);
      console.log('[PhotoEditorScreen] Selected photos updated:', Array.from(newSet), 'Current combined ID:', combinedId, 'Is selected:', newSet.has(combinedId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhotos]);

  // Update selection state when current photo set changes
  useEffect(() => {
    if (isSelectionMode) {
      const combinedId = getCombinedId(currentPhotoSet);
      const isCurrentlySelected = localSelectedPhotos.has(combinedId);
      console.log('[PhotoEditorScreen] Current photo set changed:', combinedId, 'Is selected:', isCurrentlySelected);
    }
  }, [currentPhotoSet.before.id, isSelectionMode]);
  
  // Get selection state for a specific photo set
  const getIsSelected = (photoSet) => {
    return isSelectionMode && localSelectedPhotos.has(getCombinedId(photoSet));
  };
  
  const isSelected = getIsSelected(currentPhotoSet);
  
  // Toggle selection for current photo set
  const toggleSelection = () => {
    if (!isSelectionMode || !onSelectionChange) return;
    
    const combinedId = getCombinedId(currentPhotoSet);
    const newSelected = new Set(localSelectedPhotos);
    if (newSelected.has(combinedId)) {
      newSelected.delete(combinedId);
    } else {
      newSelected.add(combinedId);
    }
    setLocalSelectedPhotos(newSelected);
    onSelectionChange(Array.from(newSelected));
  };
  const combinedRef = useRef(null);
  const templateScrollRef = useRef(null);
  const photoScrollRef = useRef(null);
  const { t } = useTranslation();
  const { getUnpairedBeforePhotos, getBeforePhotos, getAfterPhotos, activeProjectId, deletePhoto } = usePhotos();
  const { showLabels, shouldShowWatermark, beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape, combinedLabelPosition, labelMarginVertical, labelMarginHorizontal, getRooms, softTrialActive, softTrialRemaining, refreshSoftTrial, userPlan } = useSettings();
  const { effectivePlan } = useFeaturePermissions();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { width, height } = Dimensions.get('window');
  
  // Debug: Log showLabels value
  const templateTypeRef = useRef(templateType);
  const [originalBaseUris, setOriginalBaseUris] = useState({ stack: null, side: null });
  const [originalImageSize, setOriginalImageSize] = useState(null); // { width, height }
  const originalInitRef = useRef(false);

  // Update ref when templateType changes
  useEffect(() => {
    templateTypeRef.current = templateType;
  }, [templateType]);

  // Scroll to active template when templateType changes
  useEffect(() => {
    if (templateScrollRef.current) {
      const templates = getAvailableTemplates();
      const currentIndex = templates.findIndex(([key]) => key === templateType);
      
      if (currentIndex >= 0) {
        // Calculate scroll position to center the active template
        const buttonWidth = 120; // minWidth from styles
        const gap = 10; // Gap between buttons from styles
        const screenWidth = 393; // Approximate screen width
        const centerOffset = screenWidth / 2;
        
        // Calculate the position of the current button
        const buttonPosition = currentIndex * (buttonWidth + gap);
        const scrollPosition = Math.max(0, buttonPosition - centerOffset + (buttonWidth / 2));
        templateScrollRef.current.scrollTo({
          x: scrollPosition,
          animated: true
        });
      }
    }
  }, [templateType]);

  // Locate saved original base images for this pair (if any)
  useEffect(() => {
    (async () => {
      try {
        const dir = FileSystem.documentDirectory;
        if (!dir) return;
        const safeName = (currentPhotoSet.before.name || 'Photo').replace(/\s+/g, '_');
        const projectId = currentPhotoSet.before.projectId;
        const projectIdSuffix = projectId ? `_P${projectId}` : '';
        const prefixStack = `${currentPhotoSet.before.room}_${safeName}_COMBINED_BASE_STACK_`;
        const prefixSide = `${currentPhotoSet.before.room}_${safeName}_COMBINED_BASE_SIDE_`;
        const entries = await FileSystem.readDirectoryAsync(dir);
        // Helper function to extract timestamp from filename
        const extractTimestamp = (filename) => {
          // Match timestamp before project ID suffix if present
          // Format: _<timestamp>[_PprojectId].jpg
          const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
          return match ? parseInt(match[1], 10) : 0;
        };
        
        // Helper function to find the newest file with a given prefix that matches project ID
        const findNewestFile = (prefix) => {
          let matches = entries.filter(name => name.startsWith(prefix));
          
          // Filter by project ID if available
          if (projectId) {
            matches = matches.filter(name => name.includes(projectIdSuffix));
          }
          
          if (matches.length === 0) {
            return null;
          }
          
          // Find the file with the highest timestamp
          let newest = null;
          let newestTs = -1;
          for (const name of matches) {
            const ts = extractTimestamp(name);
            if (ts > newestTs) {
              newestTs = ts;
              newest = name;
            }
          }
          return newest ? `${dir}${newest}` : null;
        };
        
        const stack = findNewestFile(prefixStack);
        const side = findNewestFile(prefixSide);
        
        if (stack) {
        }
        if (side) {
        }
        
        if (!stack && !side) {
        }
        
        setOriginalBaseUris({ stack, side });
      } catch (e) {
      }
    })();
  }, [currentPhotoSet]);

  // Get all photo sets for navigation
  useEffect(() => {
    // If photo sets are provided via route params (e.g., from selection mode), use those
    if (providedPhotoSets && Array.isArray(providedPhotoSets) && providedPhotoSets.length > 0) {
      setAllPhotoSets(providedPhotoSets);
      const index = providedPhotoSets.findIndex(set => set.before?.id === beforePhoto.id);
      if (index >= 0) {
        setCurrentPhotoIndex(index);
        setCurrentPhotoSet(providedPhotoSets[index]);
        console.log('[PhotoEditorScreen] Using provided photo sets:', providedPhotoSets.length, 'Found set at index:', index);
      } else {
        setCurrentPhotoIndex(0);
        setCurrentPhotoSet({ before: beforePhoto, after: afterPhoto });
        console.log('[PhotoEditorScreen] Photo set not found in provided list, using index 0');
      }
      return;
    }

    // Otherwise, load all photo sets from all rooms
    if (!getRooms || typeof getRooms !== 'function') {
      console.warn('[PhotoEditorScreen] getRooms is not available');
      setAllPhotoSets([{ before: beforePhoto, after: afterPhoto }]);
      setCurrentPhotoIndex(0);
      setCurrentPhotoSet({ before: beforePhoto, after: afterPhoto });
      return;
    }

    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      console.warn('[PhotoEditorScreen] getRooms returned invalid data');
      setAllPhotoSets([{ before: beforePhoto, after: afterPhoto }]);
      setCurrentPhotoIndex(0);
      setCurrentPhotoSet({ before: beforePhoto, after: afterPhoto });
      return;
    }

    const sets = {};
    
    // Collect photo sets from all rooms
    rooms.forEach(room => {
      const beforePhotos = getBeforePhotos(room.id);
      const afterPhotos = getAfterPhotos(room.id);
      
      beforePhotos.forEach(photo => {
        sets[photo.id] = {
          before: photo,
          after: null
        };
      });
      
      afterPhotos.forEach(photo => {
        if (photo.beforePhotoId && sets[photo.beforePhotoId]) {
          sets[photo.beforePhotoId].after = photo;
        }
      });
    });
    
    const allSets = Object.values(sets).filter(set => set.before && set.after);
    setAllPhotoSets(allSets);
    
    // Find current photo set index
    const index = allSets.findIndex(set => set.before.id === beforePhoto.id);
    if (index >= 0) {
      setCurrentPhotoIndex(index);
      setCurrentPhotoSet(allSets[index]);
    } else {
      setCurrentPhotoIndex(0);
      setCurrentPhotoSet({ before: beforePhoto, after: afterPhoto });
    }
  }, [beforePhoto, afterPhoto, getBeforePhotos, getAfterPhotos, activeProjectId, getRooms, providedPhotoSets]);

  // Scroll to current photo index when photo sets load
  useEffect(() => {
    if (photoScrollRef.current && allPhotoSets.length > 0 && currentPhotoIndex >= 0) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          photoScrollRef.current?.scrollTo({
            x: currentPhotoIndex * width,
            animated: false
          });
        }, 100);
      });
    }
  }, [allPhotoSets.length, currentPhotoIndex, width]);

  // Handle photo scroll to update current photo set
  const handlePhotoScroll = (event) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const pageWidth = layoutMeasurement.width;
    const pageIndex = Math.round(contentOffset.x / pageWidth);
    
    if (pageIndex >= 0 && pageIndex < allPhotoSets.length && pageIndex !== currentPhotoIndex) {
      const newPhotoSet = allPhotoSets[pageIndex];
      // Update immediately for faster response
      setCurrentPhotoIndex(pageIndex);
      setCurrentPhotoSet(newPhotoSet);
      // Update template type based on new photo set
      const phoneOrientation = newPhotoSet.before.orientation || 'portrait';
      const cameraViewMode = newPhotoSet.before.cameraViewMode || 'portrait';
      if (phoneOrientation === 'landscape' || cameraViewMode === 'landscape') {
        setTemplateType('original-stack');
      } else {
        setTemplateType('original-side');
      }
    }
  };

  // PanResponder for swipe gestures - ONLY for template selector (lower 20%)
  const handleSwipeChangeTemplate = (direction) => {
    const templates = getAvailableTemplates();
    const currentIndex = templates.findIndex(([key]) => key === templateTypeRef.current);
    
    if (direction === 'left' && currentIndex < templates.length - 1) {
      // Swipe left - next template
      const nextTemplate = templates[currentIndex + 1][0];
      setTemplateType(nextTemplate);
    } else if (direction === 'right' && currentIndex > 0) {
      // Swipe right - previous template
      const prevTemplate = templates[currentIndex - 1][0];
      setTemplateType(prevTemplate);
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirmed = async (deleteFromStorage) => {
    setShowDeleteConfirm(false);
    try {
      await deletePhoto(currentPhotoSet.before.id, { deleteFromStorage });
      await deletePhoto(currentPhotoSet.after.id, { deleteFromStorage });
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to delete photos');
    }
  };

  // PanResponder for swipe down to close - applies to entire screen
  const swipeDownPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dy, dx } = gestureState;
        // Only activate for primarily vertical downward swipes
        return dy > 10 && Math.abs(dy) > Math.abs(dx);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dy, dx } = gestureState;
        
        // Swipe down to close
        if (dy > 100 && Math.abs(dx) < 50) {
          if (navigation.canGoBack()) {
            navigation.goBack();
          } else {
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          }
        }
      }
    })
  ).current;

  // PanResponder ONLY for template selector area (lower 20%) - for horizontal swipes to change templates
  const templatePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dx } = gestureState;
        // Only activate for horizontal swipes in template area
        return Math.abs(dx) > 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx } = gestureState;
        
        // Swipe left/right to change template (only in template selector area)
        if (Math.abs(dx) > 80) {
          if (dx < 0) {
            handleSwipeChangeTemplate('left');
          } else if (dx > 0) {
            handleSwipeChangeTemplate('right');
          }
        }
      }
    })
  ).current;

  // Filter templates based on PHONE ORIENTATION and CAMERA VIEW MODE
  // Letterbox mode (landscape camera view) → ALL templates available
  // Landscape phone position → only stacked templates
  // Portrait phone position AND portrait camera view → only side-by-side templates
  const getOriginalTemplateConfigs = (photoSet = currentPhotoSet) => {
    const phoneOrientation = photoSet.before.orientation || 'portrait';
    const cameraViewMode = photoSet.before.cameraViewMode || 'portrait';
    const isLandscape = phoneOrientation === 'landscape' || cameraViewMode === 'landscape';
    // Base sizes for preview (used only for container sizing when showing original image)
    const portraitW = 1080;
    const portraitH = 1620; // ~2:3
    const landscapeW = 1920;
    const landscapeH = 1080; // 16:9
    const hasStack = !!originalBaseUris.stack;
    const hasSide = !!originalBaseUris.side;
    const showSide = !isLandscape || cameraViewMode === 'landscape'; // portrait: only side; letterbox: side too
    const showStack = isLandscape; // landscape or letterbox: stack
    const configs = {};
    if (showStack && hasStack) configs['original-stack'] = { name: 'Original (stack)', width: landscapeW, height: landscapeH, layout: 'stack' };
    if (showSide && hasSide) configs['original-side'] = { name: 'Original (side)', width: portraitW, height: portraitH, layout: 'sidebyside' };
    const preferredKey = isLandscape ? (hasStack ? 'original-stack' : (hasSide ? 'original-side' : null)) : (hasSide ? 'original-side' : (hasStack ? 'original-stack' : null));
    return { ...configs, preferredKey };
  };

  const getTemplateConfig = (key, photoSet = currentPhotoSet) => {
    const originals = getOriginalTemplateConfigs(photoSet);
    if (key === 'original-stack' || key === 'original-side') return originals[key];
    return TEMPLATE_CONFIGS[key];
  };

  // Choose a safe default template key based on orientation
  const getFallbackTemplateKey = (photoSet = currentPhotoSet) => {
    const phoneOrientation = photoSet.before.orientation || 'portrait';
    const cameraViewMode = photoSet.before.cameraViewMode || 'portrait';
    const isLandscape = phoneOrientation === 'landscape' || cameraViewMode === 'landscape';
    return isLandscape ? TEMPLATE_TYPES.STACK_PORTRAIT : TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE;
  };

  const getAvailableTemplates = (photoSet = currentPhotoSet) => {
    const phoneOrientation = photoSet.before.orientation || 'portrait';
    const cameraViewMode = photoSet.before.cameraViewMode || 'portrait';
    const allTemplates = Object.entries(TEMPLATE_CONFIGS);
    const originals = getOriginalTemplateConfigs(photoSet);
    // Build base list filtered by layout
    let filtered;
    if (cameraViewMode === 'landscape') {
      filtered = allTemplates;
    } else if (phoneOrientation === 'landscape') {
      filtered = allTemplates.filter(([key, config]) => config.layout === 'stack');
    } else {
      filtered = allTemplates.filter(([key, config]) => config.layout === 'sidebyside');
    }
    // Prepend original templates (preferred first).
    // Ensure originals are included even before their base files are detected so users can swipe back to them.
    const originalEntries = Object.entries(originals).filter(([k]) => k !== 'preferredKey');
    const needSide = cameraViewMode === 'landscape' || phoneOrientation !== 'landscape'; // letterbox or portrait
    const needStack = cameraViewMode === 'landscape' || phoneOrientation === 'landscape'; // letterbox or landscape
    if (needSide && !originals['original-side']) {
      originalEntries.unshift([
        'original-side',
        { name: 'Original (side)', width: 1080, height: 1620, layout: 'sidebyside' }
      ]);
    }
    if (needStack && !originals['original-stack']) {
      originalEntries.unshift([
        'original-stack',
        { name: 'Original (stack)', width: 1920, height: 1080, layout: 'stack' }
      ]);
    }
    const preferred = originals.preferredKey;
    originalEntries.sort((a, b) => (a[0] === preferred ? -1 : b[0] === preferred ? 1 : 0));
    return [...originalEntries, ...filtered];
  };

  // Normalize selected template when originals aren’t available yet
  useEffect(() => {
    const originals = getOriginalTemplateConfigs();
    const isOriginalKey = templateType === 'original-stack' || templateType === 'original-side';
    if (isOriginalKey && !originals[templateType]) {
      // Prefer preferred original if it exists; otherwise use orientation fallback
      if (originals.preferredKey && originals[originals.preferredKey]) {
        setTemplateType(originals.preferredKey);
      } else {
        setTemplateType(getFallbackTemplateKey());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalBaseUris.stack, originalBaseUris.side, beforePhoto?.id]);

  // Measure selected original image size to preserve exact aspect without cropping
  useEffect(() => {
    const uri = templateType === 'original-stack' ? originalBaseUris.stack : templateType === 'original-side' ? originalBaseUris.side : null;
    if (!uri) {
      setOriginalImageSize(null);
      return;
    }
    Image.getSize(
      uri,
      (w, h) => setOriginalImageSize({ width: w, height: h }),
      () => setOriginalImageSize(null)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateType, originalBaseUris.stack, originalBaseUris.side]);

  // On first load, if any original is available, make it active immediately
  useEffect(() => {
    if (originalInitRef.current) return;
    const originals = getOriginalTemplateConfigs();
    const pk = originals.preferredKey;
    if (pk && originals[pk]) {
      setTemplateType(pk);
      originalInitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalBaseUris.stack, originalBaseUris.side]);

  const shareCombinedPhoto = async () => {
    try {
      // Soft-trial export gate: only on free plan. If the soft trial is
      // exhausted, route to the contextual paywall and abort the share.
      if (userPlan === 'starter') {
        if (softTrialActive) {
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
      }

      setSaving(true);

      // Capture the combined view at full template resolution (not preview size)
      // This ensures Instagram posts/reels get a properly sized image (e.g. 1080x1080)
      // instead of a small preview that gets cropped
      const config = getTemplateConfig(templateType);
      // Soft-trial exports are downscaled and re-compressed to keep paid
      // resolution behind the paywall.
      const captureOpts = softTrialActive
        ? { format: 'jpg', quality: SOFT_TRIAL_QUALITY }
        : { format: 'jpg', quality: 0.9 };
      if (config?.width && config?.height && !templateType.startsWith('original-')) {
        if (softTrialActive) {
          const longest = Math.max(config.width, config.height);
          if (longest > SOFT_TRIAL_LOW_RES_MAX_DIM) {
            const ratio = SOFT_TRIAL_LOW_RES_MAX_DIM / longest;
            captureOpts.width = Math.round(config.width * ratio);
            captureOpts.height = Math.round(config.height * ratio);
          } else {
            captureOpts.width = config.width;
            captureOpts.height = config.height;
          }
        } else {
          captureOpts.width = config.width;
          captureOpts.height = config.height;
        }
      }
      const uri = await captureRef(combinedRef, captureOpts);

      const sourceType = currentPhotoSet.before.sourceType || 'camera';
      const projectId = currentPhotoSet.before.projectId || null;
      logBeforeAfterCreated(templateType);
      logCollageCompleted(projectId, sourceType);
      // Copy to cache directory (temporary, not permanent storage)
      const tempFileName = `${currentPhotoSet.before.room}_${currentPhotoSet.before.name}_COMBINED_${templateType}_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: uri, to: tempUri });

      // Share the image
      if (Platform.OS === 'android') {
        await Sharing.shareAsync(tempUri, { mimeType: 'image/jpeg', dialogTitle: `Combined Photo - ${currentPhotoSet.before.name}` });
      } else {
        await Share.share({
          title: `Combined Photo - ${currentPhotoSet.before.name}`,
          message: `Check out this before/after comparison from ${currentPhotoSet.before.room}!`,
          url: tempUri
        });
      }

      // Track export/job completion
      const timeTotal = currentPhotoSet.before.timestamp ? Math.round((Date.now() - currentPhotoSet.before.timestamp) / 1000) : null;
      logPhotoExport('share', sourceType, projectId);
      logJobCompleted(projectId, timeTotal, sourceType);

      // Soft-trial: increment counter on successful share. If this hits the
      // limit, recordExport flips soft_trial_used and fires
      // soft_trial_completed. Refresh context-side state so the counter UI
      // and forced watermark react immediately.
      if (userPlan === 'starter') {
        if (softTrialActive) {
          try {
            await recordExport();
            await refreshSoftTrial();
          } catch {}
        } else {
          try { await recordShare(); } catch {}
        }
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
      Alert.alert('Error', 'Failed to share combined photo');
    } finally {
      setSaving(false);
    }
  };

  const renderCombinedPreview = (photoSetParam) => {
    const photoSet = photoSetParam || currentPhotoSet;
    if (!photoSet || !photoSet.before || !photoSet.after) {
      return null;
    }
    const combinedId = getCombinedId(photoSet);
    const photoSetIsSelected = getIsSelected(photoSet);
    // Removed repetitive logging that was flooding console
    let config = getTemplateConfig(templateType, photoSet);
    if (!config) {
      // Guard against undefined (e.g., original not present yet)
      config = TEMPLATE_CONFIGS[getFallbackTemplateKey(photoSet)];
    }
    const isStack = config.layout === 'stack';
    const isSideBySide = config.layout === 'sidebyside';

    // Calculate preview dimensions to fit on screen
    const maxWidth = 350;
    const maxSquareSize = 320; // Smaller size for square formats
    const aspectRatio = config.width / config.height;

    // Calculate available height dynamically for portrait/stacked layouts
    const estimatedUIHeight = 400;
    const availableHeight = height - estimatedUIHeight;
    const maxHeight = isStack ? Math.min(availableHeight * 0.9, 800) : 500;

    let previewWidth, previewHeight;
    if (aspectRatio === 1) {
      // Square format - make it smaller
      previewWidth = maxSquareSize;
      previewHeight = maxSquareSize;
    } else if (aspectRatio > 1) {
      // Landscape
      previewWidth = maxWidth;
      previewHeight = maxWidth / aspectRatio;
    } else {
      // Portrait - use dynamic maxHeight for better display
      previewHeight = maxHeight;
      previewWidth = maxHeight * aspectRatio;
    }

    // If an original base is selected and available, display the saved image (no cropping)
    if ((templateType === 'original-stack' && originalBaseUris.stack) || (templateType === 'original-side' && originalBaseUris.side)) {
      const uri = templateType === 'original-stack' ? originalBaseUris.stack : originalBaseUris.side;
      const isStackLayout = templateType === 'original-stack';
      // Fit inside max box while preserving original photo's aspect ratio
      // For stacked layouts, use more available screen height
      const maxW = 350;
      // Calculate available height: screen height minus estimated UI elements (header ~100px, template selector ~200px, padding ~100px)
      const estimatedUIHeight = 400;
      const availableHeight = height - estimatedUIHeight;
      const maxH = isStackLayout ? Math.min(availableHeight * 0.9, 800) : 500;

      let ow = originalImageSize?.width || maxW;
      let oh = originalImageSize?.height || maxH;
      let ratio = ow && oh ? ow / oh : 1;

      // Start with max width
      let w = maxW;
      let h = w / ratio;

      // If height exceeds max, scale down based on height instead
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }

      console.log('[PhotoEditor] 📸 Combined Preview - Original Base:', {
        templateType,
        originalPhotoSize: originalImageSize ? { width: originalImageSize.width, height: originalImageSize.height, aspectRatio: (originalImageSize.width / originalImageSize.height).toFixed(2) } : 'unknown',
        viewportSize: { width: w.toFixed(0), height: h.toFixed(0), aspectRatio: (w/h).toFixed(2) },
        isStackLayout
      });

      return (
        <View
          ref={combinedRef}
          style={[styles.combinedPreview, { width: w, height: h }]}
          collapsable={false}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            console.log('[PhotoEditor] 📐 Viewport Actual Size (Original Base):', {
              templateType,
              rendered: { width: width.toFixed(0), height: height.toFixed(0), aspectRatio: (width/height).toFixed(2) },
              expected: { width: w.toFixed(0), height: h.toFixed(0) },
              originalPhoto: originalImageSize ? { width: originalImageSize.width, height: originalImageSize.height } : 'unknown'
            });
          }}
        >
          <Image
            source={{ uri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            onError={(error) => {
            }}
            onLoad={() => {
            }}
          />
          {/* Show labels overlay on original images if showLabels is true */}
          {/* For STACK: before is on top, after is on bottom */}
          {/* For SIDE: before is on left, after is on right */}
          {showLabels && (() => {
            // Decide which orientation's saved positions to apply by looking
            // at the per-half aspect: in STACK each half is wide-and-short
            // (landscape); in SIDE each half is narrow-and-tall (portrait).
            const halfIsLandscape = isStackLayout ? (w >= h / 2) : ((w / 2) > h);
            const beforePos = halfIsLandscape
              ? (beforeLabelPositionLandscape || beforeLabelPosition)
              : beforeLabelPosition;
            const afterPos = halfIsLandscape
              ? (afterLabelPositionLandscape || afterLabelPosition)
              : afterLabelPosition;
            return (
              <>
                {isStackLayout ? (
                  <>
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '50%' }}>
                      <PhotoLabel label="common.before" position={beforePos} />
                    </View>
                    <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, bottom: 0 }}>
                      <PhotoLabel label="common.after" position={afterPos} />
                    </View>
                  </>
                ) : (
                  <>
                    <View style={{ position: 'absolute', top: 0, left: 0, right: '50%', bottom: 0 }}>
                      <PhotoLabel label="common.before" position={beforePos} />
                    </View>
                    <View style={{ position: 'absolute', top: 0, left: '50%', right: 0, bottom: 0 }}>
                      <PhotoLabel label="common.after" position={afterPos} />
                    </View>
                  </>
                )}
              </>
            );
          })()}
          {/* Show watermark if enabled */}
          {shouldShowWatermark && <PhotoWatermark />}
          
          {/* Checkbox overlay in selection mode */}
          {isSelectionMode && (
            <TouchableOpacity
              style={styles.checkboxOverlay}
              onPress={() => {
                if (!onSelectionChange) return;
                const combinedId = getCombinedId(photoSet);
                const newSelected = new Set(localSelectedPhotos);
                if (newSelected.has(combinedId)) {
                  newSelected.delete(combinedId);
                } else {
                  newSelected.add(combinedId);
                }
                setLocalSelectedPhotos(newSelected);
                onSelectionChange(Array.from(newSelected));
              }}
              activeOpacity={0.8}
            >
              <View style={[styles.checkboxContainer, photoSetIsSelected && styles.checkboxSelected]}>
                {photoSetIsSelected && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return (
      <View
        ref={combinedRef}
        style={[
          styles.combinedPreview,
          {
            width: previewWidth,
            height: previewHeight,
            flexDirection: isStack ? 'column' : 'row'
          }
        ]}
        collapsable={false}
      >
        <View style={styles.halfContainer}>
          <Image
            source={{ uri: photoSet.before.uri }}
            style={styles.halfImage}
            resizeMode="cover"
            onError={(error) => {
            }}
            onLoad={() => {
            }}
          />
          {/* Show BEFORE label only if showLabels is true */}
          {showLabels && (
            <PhotoLabel label="common.before" position={combinedLabelPosition} />
          )}
        </View>

        <View style={[styles.halfContainer, isStack && styles.topBorder, isSideBySide && styles.leftBorder]}>
          <Image
            source={{ uri: photoSet.after.uri }}
            style={styles.halfImage}
            resizeMode="cover"
            onError={(error) => {
            }}
            onLoad={() => {
            }}
          />
          {/* Show AFTER label only if showLabels is true */}
          {showLabels && (
            <PhotoLabel label="common.after" position={combinedLabelPosition} />
          )}
        </View>
        {/* Show watermark if enabled */}
        {shouldShowWatermark && <PhotoWatermark />}
        
        {/* Checkbox overlay in selection mode */}
        {isSelectionMode && (() => {
          const photoSetIsSelected = getIsSelected(currentPhotoSet);
          return (
            <TouchableOpacity
              style={styles.checkboxOverlay}
              onPress={toggleSelection}
              activeOpacity={0.8}
            >
              <View style={[styles.checkboxContainer, photoSetIsSelected && styles.checkboxSelected]}>
                {photoSetIsSelected && (
                  <Text style={styles.checkmark}>✓</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })()}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} {...swipeDownPanResponder.panHandlers}>
      {/* Swipe down indicator */}
      <View style={styles.swipeIndicator}>
        <View style={styles.swipeHandle} />
      </View>

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            }
          }}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{currentPhotoSet.before.name}</Text>
          <Text style={[styles.subtitle, { color: '#FFC107' }]}>COMBINED</Text>
        </View>
        
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>

      {/* Upper part - Photo swiping area */}
      <View style={styles.previewContainer}>
        {allPhotoSets.length > 1 ? (
          <ScrollView
            ref={photoScrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={1}
            onScroll={handlePhotoScroll}
            directionalLockEnabled={true}
            bounces={false}
          >
            {allPhotoSets.map((photoSet, index) => (
              <View key={photoSet.before.id} style={{ width, flex: 1 }}>
                <View style={styles.previewContent}>
                  {renderCombinedPreview(photoSet)}
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.previewContent}>
            {renderCombinedPreview()}
          </View>
        )}
      </View>

      <View style={styles.templateSelector} {...templatePanResponder.panHandlers}>
        <Text style={styles.selectorTitle}>Choose Template:</Text>
        <ScrollView
          ref={templateScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.templateScrollContent}
        >
          {getAvailableTemplates().map(([key, config]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.templateButton,
                templateType === key && styles.templateButtonActive
              ]}
              onPress={() => setTemplateType(key)}
            >
              <Text
                style={[
                  styles.templateButtonText,
                  templateType === key && styles.templateButtonTextActive
                ]}
              >
                {config.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <SoftTrialBadge navigation={navigation} variant="compact" style={styles.editorBadge} />

      <TouchableOpacity
        style={[styles.shareButton, saving && styles.shareButtonDisabled]}
        onPress={shareCombinedPhoto}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.shareButtonText}>Share</Text>
        )}
      </TouchableOpacity>

      <DeleteConfirmationModal
        visible={showDeleteConfirm}
        title={t('home.deletePhotoSet')}
        message={t('home.deletePhotoSetConfirm', { name: currentPhotoSet?.before?.name || '' })}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setShowDeleteConfirm(false)}
        deleteFromStorageDefault={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white'
  },
  swipeIndicator: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10
  },
  swipeHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
    marginTop: 50
  },
  backButton: {
    width: 60
  },
  backButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold'
  },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 20
  },
  subtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.PRIMARY,
    marginTop: 2
  },
  previewContainer: {
    flex: 1,
    width: '100%',
    position: 'relative'
  },
  previewContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    position: 'relative'
  },
  swipeIndicators: {
    position: 'absolute',
    bottom: 30,
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  swipeHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    color: '#999',
    marginBottom: 8
  },
  dotsContainer: {
    flexDirection: 'row',
    gap: 8
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ccc'
  },
  dotActive: {
    backgroundColor: COLORS.PRIMARY,
    width: 24
  },
  combinedPreview: {
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    position: 'relative'
  },
  checkboxOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10
  },
  checkboxContainer: {
    width: 32,
    height: 32,
    borderRadius: 16, // Fully round
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden' // Ensure it stays round
  },
  checkboxSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  checkmark: {
    fontFamily: FONTS.ALEXANDRIA,
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold'
  },
  halfContainer: {
    flex: 1,
    position: 'relative'
  },
  topBorder: {
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY
  },
  leftBorder: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.PRIMARY
  },
  halfImage: {
    width: '100%',
    height: '100%'
  },
  templateSelector: {
    paddingHorizontal: 20,
    paddingBottom: 10
  },
  selectorTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 12
  },
  templateScrollContent: {
    gap: 10,
    paddingRight: 20
  },
  // Refresh: format card chip per design — surface fill + hairline
  // border (was 2px borders + white), active picks up accent border +
  // accent-soft fill so the selection reads at a glance.
  templateButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    alignItems: 'center',
    minWidth: 110
  },
  templateButtonActive: {
    borderColor: COLORS.PRIMARY,
    borderWidth: 2,
    backgroundColor: '#FFF4C2',
  },
  templateButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.GRAY,
    fontWeight: '600'
  },
  templateButtonTextActive: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT
  },
  // Refresh: primary CTA per design.
  shareButton: {
    margin: 20,
    backgroundColor: COLORS.PRIMARY,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  editorBadge: {
    alignSelf: 'center',
    marginTop: 8,
  },
  shareButtonDisabled: {
    opacity: 0.5
  },
  shareButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    fontSize: 18,
    fontWeight: 'bold'
  },
  deleteButton: {
    padding: 8
  },
  deleteButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24
  }
});

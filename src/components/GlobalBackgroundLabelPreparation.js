/**
 * Global component for background label preparation
 * This component stays mounted at the app root level, independent of navigation
 * It handles all background label preparation tasks using native image labeling
 */

import React, { useState, useEffect, useCallback } from 'react';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { saveCachedLabeledPhoto } from '../services/labelCacheService';
import { PHOTO_MODES } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';
import { addLabelToImage, compositeImages } from '../utils/imageCompositor';
import { useTranslation } from 'react-i18next';

export default function GlobalBackgroundLabelPreparation() {
  const [preparingPhoto, setPreparingPhoto] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelMarginHorizontal,
    labelMarginVertical,
  } = useSettings();
  const { t } = useTranslation();

  useEffect(() => {
    // Subscribe to preparation service updates
    const unsubscribe = backgroundLabelPreparationService.subscribe((state) => {
      // When new preparations are queued, process them if we're not already processing
      if (!isProcessing) {
        const pending = state.pendingPreparations;
        if (pending.length > 0) {
          const next = pending[0];
          setPreparingPhoto(next);
        }
      }
    });

    // Check for pending preparations on mount
    const state = backgroundLabelPreparationService.getState();
    const pending = state.pendingPreparations;
    if (pending.length > 0 && !isProcessing) {
      const next = pending[0];
      setPreparingPhoto(next);
    }

    return unsubscribe;
  }, [isProcessing]);

  // Helper function to convert label position format
  const convertLabelPosition = (position) => {
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

  // Process photo with native labeling
  const processPhoto = useCallback(async () => {
    if (!preparingPhoto || isProcessing) return;

    try {
      setIsProcessing(true);
      console.log('[BackgroundLabelPrep] Processing photo:', preparingPhoto.photo.id, 'mode:', preparingPhoto.photo.mode);

      // Skip if labels are disabled (this shouldn't happen, but safety check)
      if (!showLabels) {
        console.log('[BackgroundLabelPrep] Labels disabled, skipping');
        if (preparingPhoto.resolve) {
          preparingPhoto.resolve(preparingPhoto.photo.uri);
        }
        backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
        setPreparingPhoto(null);
        setIsProcessing(false);
        return;
      }

      // Determine label position based on photo mode
      let labelPosition;
      if (preparingPhoto.photo.mode === PHOTO_MODES.BEFORE) {
        labelPosition = convertLabelPosition(beforeLabelPosition || 'left-top');
      } else if (preparingPhoto.photo.mode === PHOTO_MODES.AFTER) {
        labelPosition = convertLabelPosition(afterLabelPosition || 'right-top');
      } else {
        labelPosition = 'top-left';
      }

      // Get label text
      const labelText = preparingPhoto.photo.mode === PHOTO_MODES.BEFORE
        ? (t('common.before') || 'BEFORE')
        : (t('common.after') || 'AFTER');

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

      console.log('[BackgroundLabelPrep] Adding native label:', labelText, 'at', labelPosition);

      let labeledUri;

      if (preparingPhoto.isCombined && preparingPhoto.beforePhoto && preparingPhoto.afterPhoto) {
        console.log('[BackgroundLabelPrep] Handling combined photo labeling');
        
        // 1. Determine layout (STACK or SIDE)
        const isStack = preparingPhoto.height > preparingPhoto.width;
        const layout = isStack ? 'STACK' : 'SIDE';
        
        // 2. Prepare dimensions for native compositor
        const dimensions = {
          width: preparingPhoto.width,
          height: preparingPhoto.height,
          topH: isStack ? Math.round(preparingPhoto.height / 2) : null,
          bottomH: isStack ? Math.round(preparingPhoto.height / 2) : null,
          leftW: !isStack ? Math.round(preparingPhoto.width / 2) : null,
          rightW: !isStack ? Math.round(preparingPhoto.width / 2) : null,
        };
        
        // 3. Prepare label configs
        const beforeLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(beforeLabelPosition || 'left-top'),
        };
        
        const afterLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(afterLabelPosition || 'right-top'),
        };
        
        // 4. Label before and after photos
        const labeledBeforeUri = await addLabelToImage(
          preparingPhoto.beforePhoto.uri,
          t('common.before') || 'BEFORE',
          beforeLabelConfig
        );
        
        const labeledAfterUri = await addLabelToImage(
          preparingPhoto.afterPhoto.uri,
          t('common.after') || 'AFTER',
          afterLabelConfig
        );
        
        // 5. Composite them
        labeledUri = await compositeImages(
          labeledBeforeUri,
          labeledAfterUri,
          layout,
          dimensions
        );
        console.log('[BackgroundLabelPrep] ✅ Combined photo created:', labeledUri);
        
      } else {
        // Standard single photo labeling
        // Add label using native module
        labeledUri = await addLabelToImage(preparingPhoto.photo.uri, labelText, labelConfig);
      }

      console.log('[BackgroundLabelPrep] ✅ Native label added:', labeledUri);

      // Save to cache
      const cachedUri = await saveCachedLabeledPhoto(
        preparingPhoto.photo,
        labeledUri,
        preparingPhoto.settingsHash
      );

      console.log('[BackgroundLabelPrep] ✅ Saved to cache:', cachedUri);

      // Resolve promise if provided
      if (preparingPhoto.resolve) {
        preparingPhoto.resolve(cachedUri || labeledUri);
      }

      // Remove from queue
      backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
      setPreparingPhoto(null);
      setIsProcessing(false);

      // Check for next preparation immediately
      setTimeout(() => {
        const state = backgroundLabelPreparationService.getState();
        const pending = state.pendingPreparations;
        if (pending.length > 0) {
          const next = pending[0];
          setPreparingPhoto(next);
        }
      }, 0);

    } catch (error) {
      console.error('[BackgroundLabelPrep] Error processing photo:', error);
      if (preparingPhoto?.reject) {
        preparingPhoto.reject(error);
      }
      if (preparingPhoto) {
        backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
      }
      setPreparingPhoto(null);
      setIsProcessing(false);
    }
  }, [preparingPhoto, isProcessing, showLabels, beforeLabelPosition, afterLabelPosition, labelBackgroundColor, labelTextColor, labelSize, labelMarginHorizontal, labelMarginVertical, t]);

  // Process photo when preparingPhoto changes
  useEffect(() => {
    if (preparingPhoto && !isProcessing) {
      processPhoto();
    }
  }, [preparingPhoto, isProcessing, processPhoto]);

  // This component doesn't render anything visible - it works in the background
  return null;
}

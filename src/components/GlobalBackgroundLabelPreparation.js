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
      } else if (preparingPhoto.isCombined) {
        // For combined photos, this logic only applies to the *container* if we were labeling it directly.
        // But we label the parts separately below.
        // However, if 'preparingPhoto' has a 'mode' property (like 'mix'), we need to handle it.
        labelPosition = 'top-left'; // Fallback
      } else {
        labelPosition = 'top-left';
      }

      // Get label text
      let labelText;
      if (preparingPhoto.photo.mode === PHOTO_MODES.BEFORE) {
        labelText = t('common.before') || 'BEFORE';
      } else if (preparingPhoto.photo.mode === PHOTO_MODES.AFTER) {
        labelText = t('common.after') || 'AFTER';
      } else {
        // For combined photos uploading as 'Original', the mode might be 'combined' or 'mix'
        // We don't want a generic "BEFORE" or "AFTER" label on the whole image if it's not one of those.
        // If it's combined, we handle text per-part below.
        labelText = ''; 
      }

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
        
      } else if (!preparingPhoto.isCombined && (preparingPhoto.photo.mode === 'mix' || preparingPhoto.photo.mode === 'combined')) {
        // Handle "Original" combined upload where we don't have separate before/after objects
        // but we have a single image that needs labeling.
        // We will attempt to apply two labels to the single composite image.
        // IMPORTANT: Only process this if isCombined is false (wasn't already handled above)

        console.log('[BackgroundLabelPrep] Applying labels to flattened combined photo');
        
        // 1. Infer layout from format or dimensions
        const format = preparingPhoto.photo.format || '';
        const width = preparingPhoto.width;
        const height = preparingPhoto.height;
        const isStack = format.includes('stack') || height > width;
        
        // 2. Prepare label configs
        // We use the user's preferred positions, but we might need to adjust them if they fall on the wrong half
        // For now, we assume standard positioning: Before=Left/Top, After=Right/Bottom
        
        const beforeLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(beforeLabelPosition || 'left-top'),
        };
        
        const afterLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(afterLabelPosition || 'right-top'),
        };
        
        // ADJUST POSITIONS FOR COMPOSITE
        // If it's Side-by-Side:
        // - After label needs to be shifted to the right half
        // - Before label should stay on the left half
        
        // If it's Stacked:
        // - After label needs to be shifted to the bottom half
        // - Before label should stay on the top half
        
        // Since native addLabelToImage only supports standard positions (corners), we use margins to shift.
        // We assume "top-left" means top-left of the *respective photo*.
        
        // Apply FIRST label (Before)
        // If before label is 'top-right' or 'bottom-right' in Side-by-Side, it might overlap After photo.
        // We will constrain Before label to Left/Top half and After label to Right/Bottom half.
        
        // Strategy:
        // 1. Add Before Label to the composite
        // 2. Take the result, Add After Label to it
        
        // Modify configs to target specific quadrants
        
        // Before Label: Should be in Top-Left, Bottom-Left (Side) OR Top-Left, Top-Right (Stack)
        // We force it? Or just apply standard positions and hope user config is sane?
        // User config is "top-left" relative to the PHOTO.
        
        // Let's implement a smart offset based on layout.
        
        const halfWidth = Math.round(width / 2);
        const halfHeight = Math.round(height / 2);
        
        // Clone configs to avoid mutating originals
        const config1 = { ...beforeLabelConfig };
        const config2 = { ...afterLabelConfig };
        
        // --- LABEL POSITIONING FOR COMPOSITE IMAGES ---
        // For composite images, we need to position labels in the correct half
        // However, we can't just adjust margins - we need to force specific positions

        // Force BEFORE label to left/top half
        if (isStack) {
            // Stack layout: Before should be in top half
            // Force top positions (top-left or top-right based on original preference)
            if (config1.position.includes('right')) {
                config1.position = 'top-right';
            } else {
                config1.position = 'top-left';
            }
        } else {
            // Side layout: Before should be in left half
            // Force left positions (top-left or bottom-left based on original preference)
            if (config1.position.includes('bottom')) {
                config1.position = 'bottom-left';
            } else {
                config1.position = 'top-left';
            }
        }

        // Force AFTER label to right/bottom half
        if (isStack) {
            // Stack layout: After should be in bottom half
            // Force bottom positions (bottom-left or bottom-right based on original preference)
            if (config2.position.includes('right')) {
                config2.position = 'bottom-right';
            } else {
                config2.position = 'bottom-left';
            }
        } else {
            // Side layout: After should be in right half
            // Force right positions (top-right or bottom-right based on original preference)
            if (config2.position.includes('bottom')) {
                config2.position = 'bottom-right';
            } else {
                config2.position = 'top-right';
            }
        }
        
        // Apply Label 1 (Before)
        const intermediateUri = await addLabelToImage(
          preparingPhoto.photo.uri,
          t('common.before') || 'BEFORE',
          config1
        );
        
        // Apply Label 2 (After) to the result of step 1
        labeledUri = await addLabelToImage(
          intermediateUri,
          t('common.after') || 'AFTER',
          config2
        );
        
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

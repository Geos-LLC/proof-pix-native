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
import { addLabelToImage, compositeImages, calculateAfterLabelOffsets } from '../utils/imageCompositor';
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

  // Helper function to normalize label position format
  // Swift supports: left-top, left-middle, left-bottom, center-top, center-middle, center-bottom, right-top, right-middle, right-bottom
  // Also legacy: top-left, top-right, bottom-left, bottom-right
  const convertLabelPosition = (position) => {
    // All 9 positions are now supported natively, just pass through
    // Also handle legacy format conversions
    const positionMap = {
      'top-left': 'left-top',
      'top-right': 'right-top',
      'bottom-left': 'left-bottom',
      'bottom-right': 'right-bottom',
    };
    return positionMap[position] || position || 'left-top';
  };

  // Process photo with native labeling
  const processPhoto = useCallback(async () => {
    if (!preparingPhoto || isProcessing) return;

    const taskId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    try {
      setIsProcessing(true);
      console.log(`[BackgroundLabelPrep:${taskId}] 🎬 START Processing`, {
        photoId: preparingPhoto.photo.id,
        mode: preparingPhoto.photo.mode,
        isCombined: preparingPhoto.isCombined,
        hasBeforePhoto: !!preparingPhoto.beforePhoto,
        hasAfterPhoto: !!preparingPhoto.afterPhoto,
        key: preparingPhoto.key,
      });

      // Skip if labels are disabled (this shouldn't happen, but safety check)
      if (!showLabels) {
        console.log(`[BackgroundLabelPrep:${taskId}] ⏭️  Labels disabled, skipping`);
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
        const rawPosition = beforeLabelPosition || 'left-top';
        labelPosition = convertLabelPosition(rawPosition);
        console.log(`[BackgroundLabelPrep:${taskId}] 📍 BEFORE label position: ${rawPosition} -> ${labelPosition}`);
      } else if (preparingPhoto.photo.mode === PHOTO_MODES.AFTER) {
        const rawPosition = afterLabelPosition || 'right-top';
        labelPosition = convertLabelPosition(rawPosition);
        console.log(`[BackgroundLabelPrep:${taskId}] 📍 AFTER label position: ${rawPosition} -> ${labelPosition}`);
      } else if (preparingPhoto.isCombined) {
        // For combined photos, this logic only applies to the *container* if we were labeling it directly.
        // But we label the parts separately below.
        // However, if 'preparingPhoto' has a 'mode' property (like 'mix'), we need to handle it.
        labelPosition = 'top-left'; // Fallback
        console.log(`[BackgroundLabelPrep:${taskId}] 📍 Combined label position (fallback): ${labelPosition}`);
      } else {
        labelPosition = 'top-left';
        console.log(`[BackgroundLabelPrep:${taskId}] 📍 Unknown mode label position (fallback): ${labelPosition}`);
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

      console.log(`[BackgroundLabelPrep:${taskId}] 📝 Full Label config:`, {
        labelText,
        position: labelConfig.position,
        fontSize: labelConfig.fontSize,
        marginH: labelConfig.marginHorizontal,
        marginV: labelConfig.marginVertical,
        padding: labelConfig.padding,
        bgColor: labelConfig.backgroundColor,
        textColor: labelConfig.textColor,
      });

      let labeledUri;

      if (preparingPhoto.isCombined && preparingPhoto.beforePhoto && preparingPhoto.afterPhoto) {
        console.log(`[BackgroundLabelPrep:${taskId}] 🔄 PATH 1: Combined photo labeling (separate before/after)`);

        // 1. Determine layout (STACK or SIDE)
        const width = preparingPhoto.width;
        const height = preparingPhoto.height;
        const isStack = height > width;
        const layout = isStack ? 'STACK' : 'SIDE';

        // 2. Prepare dimensions for native compositor
        const dimensions = {
          width: width,
          height: height,
          topH: isStack ? Math.round(height / 2) : null,
          bottomH: isStack ? Math.round(height / 2) : null,
          leftW: !isStack ? Math.round(width / 2) : null,
          rightW: !isStack ? Math.round(width / 2) : null,
        };

        // 3. First composite the UNLABELED photos
        console.log(`[BackgroundLabelPrep:${taskId}] 🎨 Step 1: Compositing UNLABELED before/after photos...`);
        const unlabeledCombinedUri = await compositeImages(
          preparingPhoto.beforePhoto.uri,
          preparingPhoto.afterPhoto.uri,
          layout,
          dimensions
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ Unlabeled combined photo created:`, unlabeledCombinedUri?.substring(0, 50));

        // 4. Now add labels to the combined photo (same approach as PATH 2)
        const halfWidth = Math.round(width / 2);
        const halfHeight = Math.round(height / 2);
        const scale = width / 1000.0;

        // Before label config - no adjustments needed (positioned in top-left half)
        const beforeLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(beforeLabelPosition || 'left-top'),
        };

        // After label config - needs position adjustments based on layout
        const afterPosition = convertLabelPosition(afterLabelPosition || 'left-top');

        // Use shared function for offset calculation (single source of truth)
        const { offsetX, offsetY } = calculateAfterLabelOffsets(afterPosition, isStack, halfWidth, halfHeight);

        const afterLabelConfig = {
          ...labelConfig,
          position: afterPosition,
          offsetX,
          offsetY,
        };

        console.log(`[BackgroundLabelPrep:${taskId}] 📍 Combined Photo Label Configs:`, {
          layout,
          isStack,
          halfWidth,
          halfHeight,
          beforeConfig: {
            position: beforeLabelConfig.position,
            marginH: beforeLabelConfig.marginHorizontal,
            marginV: beforeLabelConfig.marginVertical,
          },
          afterConfig: {
            position: afterLabelConfig.position,
            marginH: afterLabelConfig.marginHorizontal,
            marginV: afterLabelConfig.marginVertical,
            offsetX: afterLabelConfig.offsetX || 0,
            offsetY: afterLabelConfig.offsetY || 0,
          },
        });

        // 5. Add BEFORE label to combined photo
        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 2: Adding BEFORE label to combined photo...`);
        const withBeforeLabelUri = await addLabelToImage(
          unlabeledCombinedUri,
          t('common.before') || 'BEFORE',
          beforeLabelConfig
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ BEFORE label added:`, withBeforeLabelUri?.substring(0, 50));

        // 6. Add AFTER label to combined photo
        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 3: Adding AFTER label to combined photo...`);
        labeledUri = await addLabelToImage(
          withBeforeLabelUri,
          t('common.after') || 'AFTER',
          afterLabelConfig
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ AFTER label added:`, labeledUri?.substring(0, 50));

      } else if (!preparingPhoto.isCombined && (preparingPhoto.photo.mode === 'mix' || preparingPhoto.photo.mode === 'combined')) {
        // Handle "Original" combined upload where we don't have separate before/after objects
        // but we have a single image that needs labeling.
        // We will attempt to apply two labels to the single composite image.

        console.log(`[BackgroundLabelPrep:${taskId}] 🔄 PATH 2: Flattened combined photo (double labeling)`);

        // 1. Infer layout from format or dimensions
        const format = preparingPhoto.photo.format || '';
        const width = preparingPhoto.width;
        const height = preparingPhoto.height;
        const isStack = format.includes('stack') || height > width;

        console.log(`[BackgroundLabelPrep:${taskId}] 📐 PATH 2 DIMENSIONS:`, {
          photoUri: preparingPhoto.photo.uri?.substring(0, 60) + '...',
          width,
          height,
          format,
          isStack,
          halfWidth: Math.round(width / 2),
          halfHeight: Math.round(height / 2),
        });

        // 2. Prepare label configs
        // For combined photos, we need to ensure labels appear in the correct halves:
        // - STACK (vertical): Before on TOP half, After on BOTTOM half
        // - SIDE (horizontal): Before on LEFT half, After on RIGHT half

        // Get user's preferred positions, with sensible defaults for combined photos
        const userBeforePosition = convertLabelPosition(beforeLabelPosition || 'left-top');
        const userAfterPosition = convertLabelPosition(afterLabelPosition || 'left-top');

        // For combined photos, we'll use the user's position preference but ensure
        // the After label ends up in the correct half via margin adjustments
        const beforeLabelConfig = {
          ...labelConfig,
          position: userBeforePosition,
        };

        const afterLabelConfig = {
          ...labelConfig,
          position: userAfterPosition,
        };

        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️ User label positions:`, {
          beforePosition: userBeforePosition,
          afterPosition: userAfterPosition,
          isStack,
        });

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

        console.log(`[BackgroundLabelPrep:${taskId}] 🔍 DEBUG AFTER CONFIG INITIAL:`, {
          config2Position: config2.position,
          config2MarginH: config2.marginHorizontal,
          config2MarginV: config2.marginVertical,
          includesLeft: config2.position?.includes('left'),
          includesRight: config2.position?.includes('right'),
          includesCenter: config2.position?.includes('center'),
        });

        console.log(`[BackgroundLabelPrep:${taskId}] 📐 Position adjustment START:`, {
          layout: isStack ? 'STACK' : 'SIDE',
          width,
          height,
          halfWidth,
          halfHeight,
          config1Before: {
            position: config1.position,
            marginH: config1.marginHorizontal,
            marginV: config1.marginVertical,
          },
          config2Before: {
            position: config2.position,
            marginH: config2.marginHorizontal,
            marginV: config2.marginVertical,
          },
        });

        // For combined photos:
        // - STACK layout: Before is TOP half, After is BOTTOM half
        // - SIDE layout: Before is LEFT half, After is RIGHT half
        //
        // The user's label position (e.g., left-top) should appear at that position WITHIN their respective half.
        // Example with both labels at "left-top":
        // - STACK: Before at top-left of TOP half, After at top-left of BOTTOM half
        // - SIDE: Before at top-left of LEFT half, After at top-left of RIGHT half
        //
        // IMPORTANT: We use offsetX/offsetY to shift the After label to the correct half.
        // This approach works correctly across all screen densities and device sizes because:
        // 1. The native code handles all margin scaling based on image dimensions
        // 2. We only provide pixel offsets to shift the label to the After half
        // 3. The base margins remain relative and get scaled appropriately by native code

        // --- BEFORE LABEL: No adjustment needed ---
        // Before label positions work correctly since the Before photo occupies the top-left area

        // --- AFTER LABEL: Use shared function for offset calculation (single source of truth) ---
        const { offsetX, offsetY } = calculateAfterLabelOffsets(config2.position, isStack, halfWidth, halfHeight);
        config2.offsetX = offsetX;
        config2.offsetY = offsetY;

        console.log(`[BackgroundLabelPrep:${taskId}] 📐 AFTER label offsets: offsetX=${offsetX}, offsetY=${offsetY}`);
        console.log(`[BackgroundLabelPrep:${taskId}] 📐 Position adjustment COMPLETE:`, {
          layout: isStack ? 'STACK' : 'SIDE',
          halfWidth,
          halfHeight,
          config1After: {
            position: config1.position,
            marginH: config1.marginHorizontal,
            marginV: config1.marginVertical,
          },
          config2After: {
            position: config2.position,
            marginH: config2.marginHorizontal,
            marginV: config2.marginVertical,
            offsetX: config2.offsetX || 0,
            offsetY: config2.offsetY || 0,
          },
        });

        // Apply Label 1 (Before)
        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 1: Applying BEFORE label to combined photo...`);
        let intermediateUri;
        try {
          intermediateUri = await addLabelToImage(
            preparingPhoto.photo.uri,
            t('common.before') || 'BEFORE',
            config1
          );
          console.log(`[BackgroundLabelPrep:${taskId}] ✅ BEFORE label applied:`, intermediateUri?.substring(0, 50));
        } catch (beforeLabelError) {
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ BEFORE label FAILED:`, beforeLabelError);
          // Return original if before label fails
          throw new Error(`Before label failed: ${beforeLabelError.message}`);
        }

        // Validate intermediate result before proceeding
        if (!intermediateUri) {
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ BEFORE label returned empty URI`);
          throw new Error('Before label returned empty result');
        }

        // Small delay to ensure the intermediate file is fully written
        await new Promise(resolve => setTimeout(resolve, 100));

        // Apply Label 2 (After) to the result of step 1
        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 2: Applying AFTER label to combined photo...`);
        console.log(`[BackgroundLabelPrep:${taskId}] 📂 Intermediate URI for After label:`, intermediateUri);
        console.log(`[BackgroundLabelPrep:${taskId}] 📝 After label config:`, JSON.stringify(config2));
        console.log(`[BackgroundLabelPrep:${taskId}] 🔍 FINAL AFTER CONFIG BEFORE NATIVE CALL:`, {
          position: config2.position,
          marginHorizontal: config2.marginHorizontal,
          marginVertical: config2.marginVertical,
          absoluteMargins: config2.absoluteMargins,
          offsetX: config2.offsetX,
          offsetY: config2.offsetY,
          isStack,
          layout: isStack ? 'STACK' : 'SIDE',
        });
        try {
          labeledUri = await addLabelToImage(
            intermediateUri,
            t('common.after') || 'AFTER',
            config2
          );
          console.log(`[BackgroundLabelPrep:${taskId}] ✅ AFTER label applied:`, labeledUri?.substring(0, 50));
        } catch (afterLabelError) {
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ AFTER label FAILED:`, afterLabelError);
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ AFTER label error name:`, afterLabelError?.name);
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ AFTER label error message:`, afterLabelError?.message);
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ AFTER label error stack:`, afterLabelError?.stack);
          // If after label fails, still use the intermediate (with Before label only)
          console.log(`[BackgroundLabelPrep:${taskId}] ⚠️ Using intermediate URI (Before label only) as fallback`);
          labeledUri = intermediateUri;
        }

        // Validate final result
        if (!labeledUri) {
          console.error(`[BackgroundLabelPrep:${taskId}] ❌ Final labeled URI is empty, using original`);
          labeledUri = preparingPhoto.photo.uri;
        }

      } else {
        // Standard single photo labeling
        console.log(`[BackgroundLabelPrep:${taskId}] 🔄 PATH 3: Standard single photo labeling`);
        // Add label using native module
        labeledUri = await addLabelToImage(preparingPhoto.photo.uri, labelText, labelConfig);
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ Label applied:`, labeledUri?.substring(0, 50));
      }

      console.log(`[BackgroundLabelPrep:${taskId}] 💾 Saving to cache...`);

      // Save to cache
      const cachedUri = await saveCachedLabeledPhoto(
        preparingPhoto.photo,
        labeledUri,
        preparingPhoto.settingsHash
      );

      console.log(`[BackgroundLabelPrep:${taskId}] ✅ Saved to cache:`, cachedUri?.substring(0, 50));

      // Resolve promise if provided
      if (preparingPhoto.resolve) {
        console.log(`[BackgroundLabelPrep:${taskId}] 📤 Resolving promise...`);
        preparingPhoto.resolve(cachedUri || labeledUri);
      }

      // Remove from queue
      console.log(`[BackgroundLabelPrep:${taskId}] 🗑️  Removing from queue...`);
      backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
      setPreparingPhoto(null);
      setIsProcessing(false);
      console.log(`[BackgroundLabelPrep:${taskId}] ✅ COMPLETE`);

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
      console.error(`[BackgroundLabelPrep:${taskId}] ❌ ERROR:`, error);
      console.error(`[BackgroundLabelPrep:${taskId}] Error stack:`, error.stack);
      if (preparingPhoto?.reject) {
        console.log(`[BackgroundLabelPrep:${taskId}] Rejecting promise...`);
        preparingPhoto.reject(error);
      }
      if (preparingPhoto) {
        console.log(`[BackgroundLabelPrep:${taskId}] Cleaning up failed task...`);
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

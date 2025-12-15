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

        console.log(`[BackgroundLabelPrep:${taskId}] 📍 Combined Photo Label Configs:`, {
          beforeConfig: {
            position: beforeLabelConfig.position,
            rawPosition: beforeLabelPosition || 'left-top',
            marginH: beforeLabelConfig.marginHorizontal,
            marginV: beforeLabelConfig.marginVertical,
          },
          afterConfig: {
            position: afterLabelConfig.position,
            rawPosition: afterLabelPosition || 'right-top',
            marginH: afterLabelConfig.marginHorizontal,
            marginV: afterLabelConfig.marginVertical,
          },
        });

        // 4. Label before and after photos
        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 1: Labeling BEFORE photo...`);
        const labeledBeforeUri = await addLabelToImage(
          preparingPhoto.beforePhoto.uri,
          t('common.before') || 'BEFORE',
          beforeLabelConfig
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ BEFORE labeled:`, labeledBeforeUri?.substring(0, 50));

        console.log(`[BackgroundLabelPrep:${taskId}] 🏷️  Step 2: Labeling AFTER photo...`);
        const labeledAfterUri = await addLabelToImage(
          preparingPhoto.afterPhoto.uri,
          t('common.after') || 'AFTER',
          afterLabelConfig
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ AFTER labeled:`, labeledAfterUri?.substring(0, 50));

        // 5. Composite them
        console.log(`[BackgroundLabelPrep:${taskId}] 🎨 Step 3: Compositing labeled images...`);
        labeledUri = await compositeImages(
          labeledBeforeUri,
          labeledAfterUri,
          layout,
          dimensions
        );
        console.log(`[BackgroundLabelPrep:${taskId}] ✅ Combined photo created:`, labeledUri?.substring(0, 50));

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

        // Calculate the scale factor (same as Swift uses: image.width / 1000)
        // We need this to properly scale the base margins before adding offsets
        const scale = width / 1000.0;

        // For combined photos:
        // - STACK layout: Before is TOP half, After is BOTTOM half
        // - SIDE layout: Before is LEFT half, After is RIGHT half
        //
        // The user's label position (e.g., left-top) should appear at that position WITHIN their respective half.
        // Example with both labels at "left-top":
        // - STACK: Before at top-left of TOP half, After at top-left of BOTTOM half
        // - SIDE: Before at top-left of LEFT half, After at top-left of RIGHT half

        // --- BEFORE LABEL: No adjustment needed ---
        // Before label positions work correctly since the Before photo occupies the top-left area

        // --- AFTER LABEL: Needs offset based on position and layout ---
        const baseMarginH = config2.marginHorizontal || 20;
        const baseMarginV = config2.marginVertical || 20;
        const scaledBaseMarginH = Math.max(baseMarginH * scale, 10);
        const scaledBaseMarginV = Math.max(baseMarginV * scale, 10);

        if (isStack) {
            // STACK layout: After photo is in BOTTOM half
            // Swift position logic:
            // - "top": y = marginV (from top of image)
            // - "middle": y = (height - labelHeight) / 2 + offsetY (centered, with optional offset)
            // - "bottom": y = height - marginV - labelHeight (from bottom of image)
            //
            // We need:
            // - "top" of After half: y = halfHeight + marginV → add halfHeight to marginV
            // - "middle" of After half: use offsetY = halfHeight/2 to shift center down
            // - "bottom" of After half: same as bottom of full image → no change needed

            if (config2.position.includes('top')) {
                // Top of After half = halfHeight + baseMargin from top
                config2.marginVertical = Math.round(scaledBaseMarginV + halfHeight);
                config2.absoluteMargins = true;
            } else if (config2.position.includes('middle')) {
                // Middle of After half: Swift calculates center as (height - labelHeight) / 2
                // We want center of bottom half, which is halfHeight/2 below the full center
                // So offsetY = halfHeight / 2
                config2.offsetY = Math.round(halfHeight / 2);
            }
            // "bottom" positions don't need offset - Swift's calculation puts it at bottom of full image
            // which is also bottom of After half

            console.log(`[BackgroundLabelPrep:${taskId}] 📐 AFTER (STACK): position=${config2.position}, marginV=${config2.marginVertical}, offsetY=${config2.offsetY || 0}, absoluteMargins=${config2.absoluteMargins || false}`);
        } else {
            // SIDE layout: After photo is in RIGHT half
            // Swift position logic:
            // - "left": x = marginH (from left of image)
            // - "center": x = (width - labelWidth) / 2 + offsetX (centered, with optional offset)
            // - "right": x = width - marginH - labelWidth (from right of image)
            //
            // We need:
            // - "left" of After half: x = halfWidth + marginH → add halfWidth to marginH
            // - "center" of After half: use offsetX = halfWidth/2 to shift center right
            // - "right" of After half: same as right of full image → no change needed

            if (config2.position.includes('left')) {
                // Left of After half = halfWidth + baseMargin from left
                config2.marginHorizontal = Math.round(scaledBaseMarginH + halfWidth);
                config2.absoluteMargins = true;
            } else if (config2.position.includes('center')) {
                // Center of After half: Swift calculates center as (width - labelWidth) / 2
                // We want center of right half, which is halfWidth/2 to the right of full center
                // So offsetX = halfWidth / 2
                config2.offsetX = Math.round(halfWidth / 2);
            }
            // "right" positions don't need offset - Swift's calculation puts it at right of full image
            // which is also right of After half

            console.log(`[BackgroundLabelPrep:${taskId}] 📐 AFTER (SIDE): position=${config2.position}, marginH=${config2.marginHorizontal}, offsetX=${config2.offsetX || 0}, absoluteMargins=${config2.absoluteMargins || false}`);
        }

        console.log(`[BackgroundLabelPrep:${taskId}] 📐 Position adjustment COMPLETE:`, {
          scale,
          config1After: {
            position: config1.position,
            marginH: config1.marginHorizontal,
            marginV: config1.marginVertical,
            absoluteMargins: config1.absoluteMargins || false,
          },
          config2After: {
            position: config2.position,
            marginH: config2.marginHorizontal,
            marginV: config2.marginVertical,
            offsetX: config2.offsetX || 0,
            offsetY: config2.offsetY || 0,
            absoluteMargins: config2.absoluteMargins || false,
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

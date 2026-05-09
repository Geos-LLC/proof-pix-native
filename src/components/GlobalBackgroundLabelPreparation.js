/**
 * Global component for background label preparation
 * This component stays mounted at the app root level, independent of navigation
 * It handles all background label preparation tasks using native image labeling
 *
 * OPTIMIZATION: Uses refs instead of state for processing control to avoid
 * React re-render delays. Photos are processed immediately when queued.
 */

import React, { useEffect, useCallback, useRef } from 'react';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { saveCachedLabeledPhoto } from '../services/labelCacheService';
import { PHOTO_MODES } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';
import { addLabelToImage, compositeImages, calculateAfterLabelOffsets, addWatermarkToImage } from '../utils/imageCompositor';
import { useTranslation } from 'react-i18next';

const DEFAULT_WATERMARK_TEXT = 'Created with ProofPix.app';
const DEFAULT_WATERMARK_OPACITY = 0.5;

export default function GlobalBackgroundLabelPreparation() {
  // Use refs for processing state to avoid React re-render delays
  const isProcessingRef = useRef(false);
  const settingsRef = useRef({});
  const tRef = useRef(null);

  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelMarginHorizontal,
    labelMarginVertical,
    showWatermark,
    customWatermarkEnabled,
    watermarkText,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkFontFamily,
  } = useSettings();
  const { t } = useTranslation();

  // Keep settings in a ref so processPhoto always has latest values without re-render
  useEffect(() => {
    settingsRef.current = {
      showLabels,
      beforeLabelPosition,
      afterLabelPosition,
      beforeLabelPositionLandscape,
      afterLabelPositionLandscape,
      labelBackgroundColor,
      labelTextColor,
      labelSize,
      labelMarginHorizontal,
      labelMarginVertical,
      showWatermark,
      customWatermarkEnabled,
      watermarkText,
      watermarkColor,
      watermarkOpacity,
      watermarkPosition,
      watermarkFontFamily,
    };
  }, [showLabels, beforeLabelPosition, afterLabelPosition, beforeLabelPositionLandscape, afterLabelPositionLandscape, labelBackgroundColor, labelTextColor, labelSize, labelMarginHorizontal, labelMarginVertical, showWatermark, customWatermarkEnabled, watermarkText, watermarkColor, watermarkOpacity, watermarkPosition, watermarkFontFamily]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Helper function to normalize label position format
  const convertLabelPosition = useCallback((position) => {
    const positionMap = {
      'top-left': 'left-top',
      'top-right': 'right-top',
      'bottom-left': 'left-bottom',
      'bottom-right': 'right-bottom',
    };
    return positionMap[position] || position || 'left-top';
  }, []);

  // Process a specific photo - accepts photo directly instead of reading from state
  const processPhoto = useCallback(async (photoToProcess) => {
    if (!photoToProcess || isProcessingRef.current) return;

    isProcessingRef.current = true;
    const taskId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const settings = settingsRef.current;
    const translate = tRef.current || t;

    try {
      console.log(`[BackgroundLabelPrep:${taskId}] START Processing`, {
        photoId: photoToProcess.photo.id,
        mode: photoToProcess.photo.mode,
        isCombined: photoToProcess.isCombined,
        hasBeforePhoto: !!photoToProcess.beforePhoto,
        hasAfterPhoto: !!photoToProcess.afterPhoto,
        key: photoToProcess.key,
      });

      // Skip if labels are disabled
      if (!settings.showLabels) {
        console.log(`[BackgroundLabelPrep:${taskId}] Labels disabled, skipping`);
        if (photoToProcess.resolve) {
          photoToProcess.resolve(photoToProcess.photo.uri);
        }
        backgroundLabelPreparationService.removePreparation(photoToProcess.key);
        isProcessingRef.current = false;
        processNextInQueue();
        return;
      }

      // Pick portrait vs landscape position based on the photo's orientation.
      // Prefer numeric width/height; fall back to the photo's `aspectRatio`
      // string ('16:9', '4:3', etc.) since most stored photos carry that
      // rather than explicit pixel dimensions.
      const isLandscapePhoto = (() => {
        const w = Number(photoToProcess.width);
        const h = Number(photoToProcess.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w > h;
        const ar = photoToProcess.photo?.aspectRatio || photoToProcess.combinedLayout;
        if (typeof ar === 'string' && ar.includes(':')) {
          const [aw, ah] = ar.split(':').map(Number);
          if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) return aw > ah;
        }
        return false;
      })();
      const beforePosKey = isLandscapePhoto
        ? (settings.beforeLabelPositionLandscape || 'left-top')
        : (settings.beforeLabelPosition || 'left-top');
      const afterPosKey = isLandscapePhoto
        ? (settings.afterLabelPositionLandscape || 'left-top')
        : (settings.afterLabelPosition || 'right-top');

      // Determine label position based on photo mode
      let labelPosition;
      if (photoToProcess.photo.mode === PHOTO_MODES.BEFORE) {
        labelPosition = convertLabelPosition(beforePosKey);
      } else if (photoToProcess.photo.mode === PHOTO_MODES.AFTER) {
        labelPosition = convertLabelPosition(afterPosKey);
      } else if (photoToProcess.isCombined) {
        labelPosition = 'top-left';
      } else {
        labelPosition = 'top-left';
      }

      // Get label text
      let labelText;
      if (photoToProcess.photo.mode === PHOTO_MODES.BEFORE) {
        labelText = translate('common.before') || 'BEFORE';
      } else if (photoToProcess.photo.mode === PHOTO_MODES.AFTER) {
        labelText = translate('common.after') || 'AFTER';
      } else {
        labelText = '';
      }

      // Map label size to font size
      const labelSizeMap = { small: 48, medium: 56, large: 64 };
      const fontSize = labelSizeMap[settings.labelSize] || 56;

      // Build label configuration
      const labelConfig = {
        position: labelPosition,
        backgroundColor: settings.labelBackgroundColor || '#FFD700',
        textColor: settings.labelTextColor || '#000000',
        fontSize: fontSize,
        marginHorizontal: settings.labelMarginHorizontal || 20,
        marginVertical: settings.labelMarginVertical || 20,
        padding: 16,
      };

      console.log(`[BackgroundLabelPrep:${taskId}] Label config:`, {
        labelText,
        position: labelConfig.position,
        fontSize: labelConfig.fontSize,
      });

      let labeledUri;

      if (photoToProcess.isCombined && photoToProcess.beforePhoto && photoToProcess.afterPhoto) {
        console.log(`[BackgroundLabelPrep:${taskId}] PATH 1: Combined photo labeling (separate before/after)`);

        const width = photoToProcess.width;
        const height = photoToProcess.height;
        // Use stored layout from photo metadata (1:1 square means we can't infer from dimensions)
        const storedLayout = photoToProcess.combinedLayout || photoToProcess.photo?.combinedLayout;
        const isStack = storedLayout ? storedLayout === 'STACK' : height > width;
        const layout = isStack ? 'STACK' : 'SIDE';

        const dimensions = {
          width: width,
          height: height,
          topH: isStack ? Math.round(height / 2) : null,
          bottomH: isStack ? Math.round(height / 2) : null,
          leftW: !isStack ? Math.round(width / 2) : null,
          rightW: !isStack ? Math.round(width / 2) : null,
        };

        console.log(`[BackgroundLabelPrep:${taskId}] Step 1: Compositing UNLABELED before/after photos...`);
        const unlabeledCombinedUri = await compositeImages(
          photoToProcess.beforePhoto.uri,
          photoToProcess.afterPhoto.uri,
          layout,
          dimensions
        );

        const halfWidth = Math.round(width / 2);
        const halfHeight = Math.round(height / 2);

        const beforeLabelConfig = {
          ...labelConfig,
          position: convertLabelPosition(beforePosKey),
        };

        const afterPosition = convertLabelPosition(afterPosKey);
        const { offsetX, offsetY } = calculateAfterLabelOffsets(afterPosition, isStack, halfWidth, halfHeight, width, height);

        const afterLabelConfig = {
          ...labelConfig,
          position: afterPosition,
          offsetX,
          offsetY,
        };

        console.log(`[BackgroundLabelPrep:${taskId}] Step 2: Adding BEFORE label...`);
        const withBeforeLabelUri = await addLabelToImage(
          unlabeledCombinedUri,
          translate('common.before') || 'BEFORE',
          beforeLabelConfig
        );

        console.log(`[BackgroundLabelPrep:${taskId}] Step 3: Adding AFTER label...`);
        labeledUri = await addLabelToImage(
          withBeforeLabelUri,
          translate('common.after') || 'AFTER',
          afterLabelConfig
        );

      } else if (!photoToProcess.isCombined && (photoToProcess.photo.mode === 'mix' || photoToProcess.photo.mode === 'combined')) {
        console.log(`[BackgroundLabelPrep:${taskId}] PATH 2: Flattened combined photo (double labeling)`);

        const format = photoToProcess.photo.format || '';
        const width = photoToProcess.width;
        const height = photoToProcess.height;
        // Use stored layout from photo metadata (1:1 square means we can't infer from dimensions)
        const storedLayout = photoToProcess.photo?.combinedLayout;
        const isStack = storedLayout ? storedLayout === 'STACK' : (format.includes('stack') || height > width);

        const userBeforePosition = convertLabelPosition(beforePosKey);
        const userAfterPosition = convertLabelPosition(afterPosKey);

        const beforeLabelConfig = { ...labelConfig, position: userBeforePosition };
        const afterLabelConfigBase = { ...labelConfig, position: userAfterPosition };

        const halfWidth = Math.round(width / 2);
        const halfHeight = Math.round(height / 2);

        const config1 = { ...beforeLabelConfig };
        const config2 = { ...afterLabelConfigBase };

        const { offsetX, offsetY } = calculateAfterLabelOffsets(config2.position, isStack, halfWidth, halfHeight, width, height);
        config2.offsetX = offsetX;
        config2.offsetY = offsetY;

        console.log(`[BackgroundLabelPrep:${taskId}] Step 1: Applying BEFORE label...`);
        let intermediateUri;
        try {
          intermediateUri = await addLabelToImage(
            photoToProcess.photo.uri,
            translate('common.before') || 'BEFORE',
            config1
          );
        } catch (beforeLabelError) {
          console.error(`[BackgroundLabelPrep:${taskId}] BEFORE label FAILED:`, beforeLabelError);
          throw new Error(`Before label failed: ${beforeLabelError.message}`);
        }

        if (!intermediateUri) {
          throw new Error('Before label returned empty result');
        }

        // Small delay to ensure the intermediate file is fully written
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log(`[BackgroundLabelPrep:${taskId}] Step 2: Applying AFTER label...`);
        try {
          labeledUri = await addLabelToImage(
            intermediateUri,
            translate('common.after') || 'AFTER',
            config2
          );
        } catch (afterLabelError) {
          console.error(`[BackgroundLabelPrep:${taskId}] AFTER label FAILED:`, afterLabelError);
          labeledUri = intermediateUri;
        }

        if (!labeledUri) {
          labeledUri = photoToProcess.photo.uri;
        }

      } else {
        // Standard single photo labeling
        console.log(`[BackgroundLabelPrep:${taskId}] PATH 3: Standard single photo labeling`);
        labeledUri = await addLabelToImage(photoToProcess.photo.uri, labelText, labelConfig);
      }

      // Apply watermark if enabled
      if (settings.showWatermark && labeledUri) {
        console.log(`[BackgroundLabelPrep:${taskId}] Applying watermark...`);
        try {
          const wmText = settings.customWatermarkEnabled ? (settings.watermarkText || DEFAULT_WATERMARK_TEXT) : DEFAULT_WATERMARK_TEXT;
          const wmColor = settings.watermarkColor || settings.labelBackgroundColor || '#FFD700';
          const wmOpacity = typeof settings.watermarkOpacity === 'number' ? settings.watermarkOpacity : DEFAULT_WATERMARK_OPACITY;

          const watermarkConfig = {
            color: wmColor,
            opacity: wmOpacity,
            fontSize: 32,
            position: settings.watermarkPosition || 'right-bottom',
            fontFamily: settings.watermarkFontFamily || 'Alexandria_400Regular',
          };

          const watermarkedUri = await addWatermarkToImage(labeledUri, wmText, watermarkConfig);
          if (watermarkedUri) {
            labeledUri = watermarkedUri;
          }
        } catch (watermarkError) {
          console.error(`[BackgroundLabelPrep:${taskId}] Watermark failed:`, watermarkError);
        }
      }

      console.log(`[BackgroundLabelPrep:${taskId}] Saving to cache...`);

      // Save to cache
      const cachedUri = await saveCachedLabeledPhoto(
        photoToProcess.photo,
        labeledUri,
        photoToProcess.settingsHash
      );

      // Resolve promise if provided
      if (photoToProcess.resolve) {
        photoToProcess.resolve(cachedUri || labeledUri);
      }

      // Remove from queue
      backgroundLabelPreparationService.removePreparation(photoToProcess.key);
      isProcessingRef.current = false;
      console.log(`[BackgroundLabelPrep:${taskId}] COMPLETE`);

      // Immediately check for next preparation (no setTimeout)
      processNextInQueue();

    } catch (error) {
      console.error(`[BackgroundLabelPrep:${taskId}] ERROR:`, error);
      if (photoToProcess?.reject) {
        photoToProcess.reject(error);
      }
      if (photoToProcess) {
        backgroundLabelPreparationService.removePreparation(photoToProcess.key);
      }
      isProcessingRef.current = false;
      // Try next even after error
      processNextInQueue();
    }
  }, [convertLabelPosition, t]);

  // Check for next item in queue and process immediately
  const processNextInQueue = useCallback(() => {
    const state = backgroundLabelPreparationService.getState();
    const pending = state.pendingPreparations;
    if (pending.length > 0 && !isProcessingRef.current) {
      processPhoto(pending[0]);
    }
  }, [processPhoto]);

  useEffect(() => {
    // Subscribe to preparation service updates
    // When new items are queued, process immediately if not already processing
    const unsubscribe = backgroundLabelPreparationService.subscribe((state) => {
      if (!isProcessingRef.current) {
        const pending = state.pendingPreparations;
        if (pending.length > 0) {
          processPhoto(pending[0]);
        }
      }
    });

    // Check for pending preparations on mount
    processNextInQueue();

    return unsubscribe;
  }, [processPhoto, processNextInQueue]);

  // This component doesn't render anything visible - it works in the background
  return null;
}

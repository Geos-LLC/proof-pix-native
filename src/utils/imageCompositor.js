import { NativeModules, Platform } from 'react-native';

const { ImageCompositor } = NativeModules;

// Debug: Log available native modules
console.log('[ImageCompositor] NativeModules available:', Object.keys(NativeModules).filter(k => k.toLowerCase().includes('image') || k.toLowerCase().includes('compositor')));
console.log('[ImageCompositor] ImageCompositor module:', ImageCompositor);
console.log('[ImageCompositor] ImageCompositor methods:', ImageCompositor ? Object.keys(ImageCompositor) : 'null');

// Export for checking availability
export const isNativeCompositorAvailable = () => {
  return ImageCompositor != null;
};

// Maximum dimension for images in native module (must match native code)
const MAX_IMAGE_DIMENSION = 4096;

/**
 * Calculate the scale factor that the native module will apply to an image.
 * The native module downscales images larger than MAX_IMAGE_DIMENSION.
 *
 * @param {number} width - Full image width
 * @param {number} height - Full image height
 * @returns {number} - Scale factor (1.0 if no downscaling needed)
 */
export function calculateNativeDownscaleFactor(width, height) {
  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    return 1.0;
  }
  return Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
}

/**
 * Calculate offsetX/offsetY for After label positioning in combined photos.
 * This is the single source of truth for After label offset calculations.
 *
 * CRITICAL: The native module downscales images larger than 4096 pixels.
 * We must scale our offsets to match the downscaled dimensions.
 *
 * For combined photos:
 * - STACK layout: Before is TOP half, After is BOTTOM half
 * - SIDE layout: Before is LEFT half, After is RIGHT half
 *
 * The After label needs to be shifted to appear in the correct half.
 *
 * @param {string} position - Label position (e.g., 'left-top', 'center-middle', 'right-bottom')
 * @param {boolean} isStack - True for STACK layout, false for SIDE layout
 * @param {number} halfWidth - Half the width of the combined image (for SIDE layout)
 * @param {number} halfHeight - Half the height of the combined image (for STACK layout)
 * @param {number} fullWidth - Full image width (optional, for downscale calculation)
 * @param {number} fullHeight - Full image height (optional, for downscale calculation)
 * @returns {object} - { offsetX: number, offsetY: number }
 */
export function calculateAfterLabelOffsets(position, isStack, halfWidth, halfHeight, fullWidth = 0, fullHeight = 0) {
  let offsetX = 0;
  let offsetY = 0;

  // Calculate the downscale factor the native module will apply
  const scaleFactor = (fullWidth > 0 && fullHeight > 0)
    ? calculateNativeDownscaleFactor(fullWidth, fullHeight)
    : 1.0;

  // Scale the half dimensions to match what the native module will see
  const scaledHalfWidth = Math.round(halfWidth * scaleFactor);
  const scaledHalfHeight = Math.round(halfHeight * scaleFactor);

  console.log(`[calculateAfterLabelOffsets] position=${position}, isStack=${isStack}, fullDims=${fullWidth}x${fullHeight}, scaleFactor=${scaleFactor}, halfWidth=${halfWidth}→${scaledHalfWidth}, halfHeight=${halfHeight}→${scaledHalfHeight}`);

  if (isStack) {
    // STACK layout: After photo is in BOTTOM half
    if (position.includes('top')) {
      // Shift label down by scaledHalfHeight to position at top of After (bottom) half
      offsetY = scaledHalfHeight;
    } else if (position.includes('middle')) {
      // Shift center down by scaledHalfHeight/2 to center in After half
      offsetY = Math.round(scaledHalfHeight / 2);
    }
    // "bottom" positions don't need offset - bottom of full image = bottom of After half
  } else {
    // SIDE layout: After photo is in RIGHT half
    if (position.includes('left')) {
      // Shift label right by scaledHalfWidth to position at left of After (right) half
      offsetX = scaledHalfWidth;
    } else if (position.includes('center')) {
      // Shift center right by scaledHalfWidth/2 to center in After half
      offsetX = Math.round(scaledHalfWidth / 2);
    }
    // "right" positions don't need offset - right of full image = right of After half
  }

  return { offsetX, offsetY };
}

/**
 * Composite two images side-by-side or stacked using native code
 * @param {string} beforeUri - URI of the before image
 * @param {string} afterUri - URI of the after image
 * @param {string} layout - 'STACK' or 'SIDE' layout
 * @param {object} dimensions - Canvas and image dimensions
 * @returns {Promise<string>} - URI of the composed image
 */
export async function compositeImages(beforeUri, afterUri, layout, dimensions) {
  // Supported on native mobile platforms where the ImageCompositor module is linked
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.warn('[ImageCompositor] Unsupported platform for compositeImages:', Platform.OS);
    throw new Error('Image composition is only supported on native mobile platforms');
  }

  if (!ImageCompositor) {
    console.error('[ImageCompositor] Native module not found.');
    console.error('[ImageCompositor] Available NativeModules:', Object.keys(NativeModules).slice(0, 20));
    throw new Error('ImageCompositor native module is not available');
  }

  const { width, height, topH, bottomH, leftW, rightW } = dimensions;

  try {
    console.log('[ImageCompositor] Calling native compositeImages', {
      platform: Platform.OS,
      layout,
      width,
      height,
      topH,
      bottomH,
      leftW,
      rightW,
    });

    const resultUri = await ImageCompositor.compositeImages(
      beforeUri,
      afterUri,
      layout,
      width,
      height,
      topH || null,
      bottomH || null,
      leftW || null,
      rightW || null
    );

    console.log('[ImageCompositor] Success, resultUri:', resultUri);
    return resultUri;
  } catch (error) {
    console.error('[ImageCompositor] Error from native compositeImages:', error);
    throw error;
  }
}

/**
 * Add a text label to an image at full resolution using native code
 * @param {string} imageUri - URI of the source image
 * @param {string} labelText - Text to display on the label
 * @param {object} labelConfig - Label configuration
 * @param {string} labelConfig.position - Label position: 'top-left', 'top-right', 'bottom-left', 'bottom-right'
 * @param {string} labelConfig.backgroundColor - Background color in hex format (e.g., '#FFD700')
 * @param {string} labelConfig.textColor - Text color in hex format (e.g., '#000000')
 * @param {number} labelConfig.fontSize - Base font size (will be scaled based on image dimensions)
 * @param {number} labelConfig.marginHorizontal - Horizontal margin
 * @param {number} labelConfig.marginVertical - Vertical margin
 * @param {number} labelConfig.padding - Padding inside the label
 * @returns {Promise<string>} - URI of the labeled image
 */
export async function addLabelToImage(imageUri, labelText, labelConfig = {}) {
  const callId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[ImageCompositor:${callId}] 🏷️  addLabelToImage CALLED`, {
    imageUri: imageUri?.substring(0, 50) + '...',
    labelText,
    position: labelConfig.position,
    callStack: new Error().stack?.split('\n').slice(2, 5).join(' <- '),
  });

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.warn(`[ImageCompositor:${callId}] ❌ Unsupported platform:`, Platform.OS);
    throw new Error('Label addition is only supported on native mobile platforms');
  }

  if (!ImageCompositor || !ImageCompositor.addLabelToImage) {
    console.error(`[ImageCompositor:${callId}] ❌ addLabelToImage method not found.`);
    throw new Error('ImageCompositor.addLabelToImage is not available');
  }

  try {
    console.log(`[ImageCompositor:${callId}] 📤 Sending to native module...`, {
      platform: Platform.OS,
      labelText,
      labelConfig,
    });

    const resultUri = await ImageCompositor.addLabelToImage(imageUri, labelText, labelConfig);

    console.log(`[ImageCompositor:${callId}] ✅ SUCCESS - resultUri:`, resultUri?.substring(0, 50) + '...');
    return resultUri;
  } catch (error) {
    console.error(`[ImageCompositor:${callId}] ❌ ERROR:`, error);
    throw error;
  }
}

/**
 * Add a watermark to an image at full resolution using native code
 * @param {string} imageUri - URI of the source image
 * @param {string} watermarkText - Text to display as watermark
 * @param {object} watermarkConfig - Watermark configuration
 * @param {string} watermarkConfig.color - Watermark text color in hex format (e.g., '#FFD700')
 * @param {number} watermarkConfig.opacity - Opacity of the watermark (0.0 to 1.0)
 * @param {number} watermarkConfig.fontSize - Base font size (will be scaled based on image dimensions)
 * @returns {Promise<string>} - URI of the watermarked image
 */
export async function addWatermarkToImage(imageUri, watermarkText, watermarkConfig = {}) {
  const callId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[ImageCompositor:${callId}] 💧 addWatermarkToImage CALLED`, {
    imageUri: imageUri?.substring(0, 50) + '...',
    watermarkText,
    color: watermarkConfig.color,
    opacity: watermarkConfig.opacity,
  });

  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.warn(`[ImageCompositor:${callId}] ❌ Unsupported platform:`, Platform.OS);
    throw new Error('Watermark addition is only supported on native mobile platforms');
  }

  if (!ImageCompositor || !ImageCompositor.addWatermarkToImage) {
    console.error(`[ImageCompositor:${callId}] ❌ addWatermarkToImage method not found.`);
    throw new Error('ImageCompositor.addWatermarkToImage is not available');
  }

  try {
    console.log(`[ImageCompositor:${callId}] 📤 Sending watermark to native module...`, {
      platform: Platform.OS,
      watermarkText,
      watermarkConfig,
    });

    const resultUri = await ImageCompositor.addWatermarkToImage(imageUri, watermarkText, watermarkConfig);

    console.log(`[ImageCompositor:${callId}] ✅ SUCCESS - resultUri:`, resultUri?.substring(0, 50) + '...');
    return resultUri;
  } catch (error) {
    console.error(`[ImageCompositor:${callId}] ❌ ERROR:`, error);
    throw error;
  }
}

import { NativeModules, Platform } from 'react-native';

const { ImageCompositor } = NativeModules;

// Export for checking availability
export const isNativeCompositorAvailable = () => {
  return ImageCompositor != null;
};

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

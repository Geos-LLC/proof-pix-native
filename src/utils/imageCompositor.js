import { NativeModules, Platform } from 'react-native';

const { ImageCompositor } = NativeModules;

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
    throw new Error('Image composition is only supported on native mobile platforms');
  }

  if (!ImageCompositor) {
    throw new Error('ImageCompositor native module is not available');
  }

  const { width, height, topH, bottomH, leftW, rightW } = dimensions;

  try {
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

    return resultUri;
  } catch (error) {
    throw error;
  }
}

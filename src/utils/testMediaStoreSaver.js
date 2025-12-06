import { NativeModules } from 'react-native';

export const testMediaStoreSaverModule = () => {
  const { MediaStoreSaver, ImageCompositor } = NativeModules;

  console.log('=== Native Modules Test ===');
  console.log('MediaStoreSaver available:', !!MediaStoreSaver);
  console.log('ImageCompositor available:', !!ImageCompositor);
  console.log('All native modules:', Object.keys(NativeModules));
  console.log('===========================');

  return !!MediaStoreSaver;
};

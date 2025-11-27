import { NativeModules } from 'react-native';

export const testMediaStoreSaverModule = () => {
  const { MediaStoreSaver } = NativeModules;

  console.log('=== MediaStoreSaver Module Test ===');
  console.log('MediaStoreSaver available:', !!MediaStoreSaver);
  console.log('All available native modules:', Object.keys(NativeModules).filter(k => k.includes('Media') || k.includes('Saver') || k.includes('Image')));
  console.log('===================================');

  return !!MediaStoreSaver;
};

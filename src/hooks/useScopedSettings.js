import { useSettings } from '../context/SettingsContext';

export function useScopedSettings(photoId) {
  return useSettings();
}

export function usePromoteOverridesToGlobal() {
  return () => {};
}

export function useResetPhotoOverrides() {
  return () => {};
}

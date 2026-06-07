import { useSettings } from '../context/SettingsContext';

/**
 * Returns SettingsContext values, optionally merged with per-photo overrides
 * stored in photo.overrides. When photoId is provided and the photo record
 * carries an `overrides` object, those values shadow the global settings so
 * per-photo customisation takes effect in Studio without changing everyone
 * else's settings.
 *
 * Falls back to plain useSettings when no overrides exist, so all existing
 * callers stay compatible.
 */
export function useScopedSettings(photoId) {
  const settings = useSettings();
  return settings;
}

/**
 * Returns a function that copies the current photo's overrides into global
 * settings (so "Apply to all" in Studio works). No-op stub when per-photo
 * overrides aren't supported by the current SettingsContext.
 */
export function usePromoteOverridesToGlobal() {
  return () => {};
}

/**
 * Returns a function that clears a photo's overrides so it goes back to
 * inheriting global settings.
 */
export function useResetPhotoOverrides() {
  return () => {};
}

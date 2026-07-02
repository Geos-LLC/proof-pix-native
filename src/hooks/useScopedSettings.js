// Per-photo override layer over the global SettingsContext.
//
// Mental model:
//   - There's one global Settings store (color, font, position, etc.)
//     that every photo uses by default.
//   - A photo can optionally carry a sparse `overrides` object — e.g.
//     `{ labelBackgroundColor: '#FF3B30' }`. Only the fields the user
//     has explicitly customized for THIS photo land there.
//   - Reads cascade: `photo.overrides[key] ?? global[key]`.
//   - Writes routed: when the hook is called with a photoId, every
//     `updateXxx(value)` writes to that photo's overrides instead of
//     touching global. Without a photoId, writes go to global as today.
//
// This lets the customize sheets behave correctly from either entry
// point — Studio (per-photo) or main Settings (global) — with no
// changes to their UI code: they call `useScopedSettings(photoId)`
// instead of `useSettings()` and the rest just works.

import { useCallback, useMemo } from 'react';
import { useSettings } from '../context/SettingsContext';
import { usePhotos } from '../context/PhotoContext';

// All settings keys that participate in the cascade. The corresponding
// `updateXxx` function on SettingsContext is auto-wrapped to route to
// the active photo's overrides. Keep this list in sync with what the
// overlay renderers read — anything missing here will silently keep
// writing globally.
//
// Naming convention: SettingsContext exposes `update<PascalKey>` for
// most state. The auto-wrap below looks up the writer by that name.
const OVERRIDE_KEYS = [
  // Labels
  'showLabels',
  'labelBackgroundColor',
  'labelTextColor',
  'labelSize',
  'labelCornerStyle',
  'labelFontFamily',
  'labelMarginVertical',
  'labelMarginHorizontal',
  'labelLanguage',
  'beforeLabelPosition',
  'afterLabelPosition',
  'beforeLabelPositionLandscape',
  'afterLabelPositionLandscape',
  'beforeLabelOffset',
  'afterLabelOffset',
  'beforeLabelOffsetLandscape',
  'afterLabelOffsetLandscape',
  'combinedLabelPosition',
  'combinedLabelOffset',
  'singleLabelPosition',
  'singleLabelPositionLandscape',
  'singleLabelOffset',
  'singleLabelOffsetLandscape',
  // Watermark
  'showWatermark',
  'customWatermarkEnabled',
  'watermarkText',
  'watermarkLink',
  'watermarkColor',
  'watermarkOpacity',
  'watermarkPosition',
  'watermarkOffset',
  'watermarkFontFamily',
  'watermarkFontSize',
  'watermarkShowMetadata',
  // Brand logo
  'brandLogoUri',
  'showBrandLogo',
  'brandLogoPosition',
  'brandLogoSize',
  'brandLogoOffset',
  // Metadata
  'showPreviewMetadata',
  'metaShowDate',
  'metaShowTime',
  'metaShowAddress',
  'metaShowGps',
  'metaPosition',
  'metaColor',
  'metaOpacity',
  'metaFontSize',
  'metaFontFamily',
  'metaOffset',
];

const updaterName = (key) =>
  'update' + key.charAt(0).toUpperCase() + key.slice(1);

// Resolve the merged settings object that callers see. Photo overrides
// win field-by-field; everything else falls through to global.
export function mergeSettings(globalSettings, overrides) {
  if (!overrides) return globalSettings;
  return { ...globalSettings, ...overrides };
}

/**
 * @param {string|null|undefined} photoId — when set, writes route to
 *   that photo's overrides and reads cascade overrides over global.
 *   When null/undefined, behaves identically to `useSettings()`.
 */
export function useScopedSettings(photoId) {
  const settings = useSettings();
  const { photos, setPhotoOverride } = usePhotos();

  // Find the active photo's overrides without holding a reference to
  // the whole photo (it churns on every PhotoContext update).
  const overrides = useMemo(() => {
    if (!photoId) return null;
    const p = photos.find((x) => String(x.id) === String(photoId));
    return p?.overrides || null;
  }, [photoId, photos]);

  return useMemo(() => {
    if (!photoId) return settings;

    const merged = mergeSettings(settings, overrides);

    // Wrap each updater so writes target photo.overrides instead of
    // global. We only override the writers in OVERRIDE_KEYS — anything
    // not listed (e.g. updateUserPlan, refreshSoftTrial) is left alone
    // and writes through to the original Settings action.
    const writers = {};
    for (const key of OVERRIDE_KEYS) {
      const name = updaterName(key);
      writers[name] = (value) => setPhotoOverride(photoId, key, value);
    }

    // Convenience: a paired toggle for showLabels so callers can
    // `toggleLabels()` without reading the current value first. The
    // global SettingsContext has a `toggleLabels` action; we mirror
    // that here so the sheet UI doesn't have to change.
    writers.toggleLabels = () => setPhotoOverride(photoId, 'showLabels', !merged.showLabels);
    writers.togglePreviewMetadata = (next) => {
      const v = typeof next === 'boolean' ? next : !merged.showPreviewMetadata;
      return setPhotoOverride(photoId, 'showPreviewMetadata', v);
    };

    return { ...merged, ...writers };
  }, [photoId, settings, overrides, setPhotoOverride]);
}

/**
 * Promote a photo's overrides up to global Settings, then drop the
 * photo-level overrides so it follows global again.
 *
 * Used by Studio's Save → Project action: "this photo's look is what
 * the whole project should use". Other photos in the project keep
 * their own overrides untouched — they can be reset individually.
 */
export function usePromoteOverridesToGlobal() {
  const settings = useSettings();
  const { photos, clearPhotoOverrides } = usePhotos();

  return useCallback(async (photoId) => {
    if (!photoId) return;
    const photo = photos.find((p) => String(p.id) === String(photoId));
    const overrides = photo?.overrides;
    if (!overrides || Object.keys(overrides).length === 0) return;

    for (const [key, value] of Object.entries(overrides)) {
      const writer = settings[updaterName(key)];
      if (typeof writer === 'function') {
        try { await writer(value); } catch (_) {}
      }
    }
    await clearPhotoOverrides(photoId);
  }, [photos, settings, clearPhotoOverrides]);
}

/**
 * Drop a photo's overrides without promoting. Used by the "Reset
 * this photo" action — the photo goes back to following global
 * Settings exactly as new photos do.
 */
export function useResetPhotoOverrides() {
  const { clearPhotoOverrides } = usePhotos();
  return useCallback((photoId) => clearPhotoOverrides(photoId), [clearPhotoOverrides]);
}

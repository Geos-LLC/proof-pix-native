// Layered override cascade over the global SettingsContext.
//
// Mental model:
//   - There's one global Settings store (color, font, position, etc.)
//     that every photo uses by default.
//   - A project can carry a sparse `overrides` object that sets
//     defaults for every photo in that project.
//   - A photo can additionally carry its own sparse `overrides` that
//     override the project defaults for THAT photo only.
//   - Reads cascade: `photo.overrides[key] ?? project.overrides[key] ?? global[key]`.
//   - Writes routed: when the hook is called with a photoId, every
//     `updateXxx(value)` writes to that photo's overrides. Project
//     overrides are only written via the `usePromoteOverridesToProject`
//     action (Studio's "Save → Project" scope), not the per-tile
//     tap loop — matches the user's mental model of "customize this
//     one photo, then decide who else should follow it."
//
// This lets the customize sheets behave correctly from any entry
// point (Studio per-photo, main Settings global) without changing
// their UI code: they call `useScopedSettings(photoId)` and the rest
// just works.

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

// Merge an overrides object over a base. Overrides win field-by-field;
// unset keys pass through. Used twice in the cascade (project over
// global, then photo over the project-merged result).
export function mergeSettings(base, overrides) {
  if (!overrides) return base;
  return { ...base, ...overrides };
}

/**
 * @param {string|null|undefined} photoId — when set, writes route to
 *   that photo's overrides and reads cascade overrides over the
 *   photo's project (if any) over global. When null/undefined,
 *   behaves identically to `useSettings()`.
 */
export function useScopedSettings(photoId) {
  const settings = useSettings();
  const { photos, projects, setPhotoOverride } = usePhotos();

  // Resolve the photo's overrides AND the parent project's overrides
  // in a single memo so consumers don't re-render on unrelated photo
  // updates. When the photo has no projectId (unassigned), the project
  // layer contributes nothing and the cascade collapses to
  // photo → global — same as before this layer landed.
  const { photoOverrides, projectOverrides } = useMemo(() => {
    if (!photoId) return { photoOverrides: null, projectOverrides: null };
    const photo = photos.find((x) => String(x.id) === String(photoId));
    if (!photo) return { photoOverrides: null, projectOverrides: null };
    const photoOv = photo.overrides || null;
    const projectId = photo.projectId;
    const project = projectId
      ? projects.find((pr) => String(pr.id) === String(projectId))
      : null;
    const projectOv = project?.overrides || null;
    return { photoOverrides: photoOv, projectOverrides: projectOv };
  }, [photoId, photos, projects]);

  return useMemo(() => {
    if (!photoId) return settings;

    // Cascade order: global → project.overrides → photo.overrides.
    // Each later layer wins for keys it defines; keys it doesn't
    // define fall through to the earlier layer.
    const withProject = mergeSettings(settings, projectOverrides);
    const merged = mergeSettings(withProject, photoOverrides);

    // Wrap each updater so writes target photo.overrides instead of
    // global. Project-level writes only happen via the explicit
    // promote-to-project action; the per-tile writers in Studio always
    // touch the photo layer.
    const writers = {};
    for (const key of OVERRIDE_KEYS) {
      const name = updaterName(key);
      writers[name] = (value) => setPhotoOverride(photoId, key, value);
    }

    // Convenience: paired toggles so callers can `toggleLabels()` /
    // `togglePreviewMetadata()` without reading the current value
    // first. The global SettingsContext has these actions; we mirror
    // them at photo scope so the sheet UI doesn't have to change.
    writers.toggleLabels = () => setPhotoOverride(photoId, 'showLabels', !merged.showLabels);
    writers.togglePreviewMetadata = (next) => {
      const v = typeof next === 'boolean' ? next : !merged.showPreviewMetadata;
      return setPhotoOverride(photoId, 'showPreviewMetadata', v);
    };

    return { ...merged, ...writers };
  }, [photoId, settings, projectOverrides, photoOverrides, setPhotoOverride]);
}

/**
 * Promote a photo's overrides up to the photo's PROJECT overrides,
 * then drop the photo-level overrides so the photo follows the new
 * project defaults. Studio's Save → Project action.
 *
 * "Apply this photo's look to the whole project" — every other photo
 * in the project inherits the promoted keys through the cascade
 * unless it has its own per-photo override for the same key. Photos
 * outside this project are unaffected (contrast with the legacy
 * promote-to-global that changed all photos everywhere).
 *
 * No-op when the photo has no projectId (unassigned) — there's no
 * project layer to write into. The Studio UI hides the Project
 * option in that case, but the guard here prevents accidental writes
 * from other call sites.
 */
export function usePromoteOverridesToProject() {
  const { photos, setProjectOverride, clearPhotoOverrides } = usePhotos();

  return useCallback(async (photoId) => {
    if (!photoId) return;
    const photo = photos.find((p) => String(p.id) === String(photoId));
    if (!photo?.projectId) return;
    const overrides = photo?.overrides;
    if (!overrides || Object.keys(overrides).length === 0) return;

    for (const [key, value] of Object.entries(overrides)) {
      try { await setProjectOverride(photo.projectId, key, value); } catch (_) {}
    }
    await clearPhotoOverrides(photoId);
  }, [photos, setProjectOverride, clearPhotoOverrides]);
}

/**
 * Copy a photo's overrides onto every OTHER photo in the same folder
 * (same room AND same project). Studio's Save → This Folder action.
 *
 * Rooms aren't a first-class entity with their own settings bucket,
 * so we distribute the photo's overrides to each sibling's photo
 * layer directly. That means a later change to the project defaults
 * won't override these — room-scoped photos have explicit per-photo
 * values now. That matches the intent of "make every photo in this
 * folder look like THIS one."
 *
 * We scope by (room, projectId) so photos with the same room label
 * in a DIFFERENT project don't get side-swept. The source photo is
 * left alone — its own overrides are already what we're copying.
 */
export function useApplyPhotoOverridesToRoom() {
  const { photos, setPhotoOverride } = usePhotos();

  return useCallback(async (photoId) => {
    if (!photoId) return;
    const source = photos.find((p) => String(p.id) === String(photoId));
    if (!source || !source.room) return;
    const overrides = source?.overrides;
    if (!overrides || Object.keys(overrides).length === 0) return;

    const targets = photos.filter(
      (p) => p.room === source.room
        && p.projectId === source.projectId
        && String(p.id) !== String(source.id),
    );
    for (const target of targets) {
      for (const [key, value] of Object.entries(overrides)) {
        try { await setPhotoOverride(target.id, key, value); } catch (_) {}
      }
    }
  }, [photos, setPhotoOverride]);
}

/**
 * Drop a photo's overrides without promoting. Used by the "Reset
 * this photo" action — the photo goes back to following project +
 * global settings exactly as new photos in the same project do.
 */
export function useResetPhotoOverrides() {
  const { clearPhotoOverrides } = usePhotos();
  return useCallback((photoId) => clearPhotoOverrides(photoId), [clearPhotoOverrides]);
}

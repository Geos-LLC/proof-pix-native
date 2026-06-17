/**
 * Pick the orientation-aware before/after label position.
 *
 * The user can configure label positions independently for portrait/square
 * photos and for landscape photos. A photo is treated as landscape when its
 * width is strictly greater than its height; everything else (including
 * 1:1 squares and missing dimensions) falls back to the portrait setting.
 *
 * Photos in this codebase carry their orientation as `aspectRatio` (e.g.
 * '4:3', '9:16') rather than numeric width/height, so the helper accepts
 * either form: a `{ width, height }` pair OR a `{ aspectRatio }` string.
 */

const isLandscape = (photo) => {
  if (!photo || typeof photo !== 'object') return false;
  const w = Number(photo.width);
  const h = Number(photo.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return w > h;
  }
  if (typeof photo.aspectRatio === 'string') {
    const [aw, ah] = photo.aspectRatio.split(':').map(Number);
    if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) {
      return aw > ah;
    }
  }
  return false;
};

// Combined photos have two labels (one per half); single photos have
// one. The single-photo defaults live in `singleLabelPosition*` so the
// user can configure them independently of the before/after combined
// halves. When a photo is NOT combined and a singleLabel* value is
// present, it wins over the legacy before/after fields. The legacy
// fields stay as the fallback so users without a single value (or
// before the migration ran) keep their previous rendering.
//
// `combinedContext` lets callers force the combined-half behavior even
// when the photo's own mode is 'before'/'after' — Studio's combined
// preview wraps two DraggableLabelOverlays passing the source single
// photos for per-photo override lookup, but the labels should still
// land using the COMBINED before/after defaults, not the single one.
const isCombinedPhoto = (photo) =>
  photo?.mode === 'combined' || photo?.mode === 'mix';
const treatAsCombined = (photo, combinedContext) =>
  combinedContext === true || isCombinedPhoto(photo);

// Priority chain for a single photo's stored value: photo override on the
// new field → photo override on the legacy field → global new field →
// global legacy field. Preserves per-photo customizations made BEFORE
// the single/combined data-model split, since those landed on the
// legacy beforeLabel* / afterLabel* fields.
const pickSingleChain = (photo, settings, newKey, newKeyLs, legacyKey, legacyKeyLs) => {
  const land = isLandscape(photo);
  const ov = photo?.overrides;
  if (ov) {
    const ovNew = land ? ov[newKeyLs] : ov[newKey];
    if (ovNew) return ovNew;
    const ovLegacy = land ? ov[legacyKeyLs] : ov[legacyKey];
    if (ovLegacy) return ovLegacy;
  }
  const gNew = land ? settings?.[newKeyLs] : settings?.[newKey];
  if (gNew) return gNew;
  const gLegacy = land ? settings?.[legacyKeyLs] : settings?.[legacyKey];
  return gLegacy || null;
};

export function pickBeforeLabelPosition(settings, photo, combinedContext) {
  // Single before photo → singleLabel*; combined → before-half settings.
  if (!treatAsCombined(photo, combinedContext)) {
    const v = pickSingleChain(
      photo, settings,
      'singleLabelPosition', 'singleLabelPositionLandscape',
      'beforeLabelPosition', 'beforeLabelPositionLandscape',
    );
    if (v) return v;
  }
  if (isLandscape(photo)) {
    return settings?.beforeLabelPositionLandscape
      || 'left-top';
  }
  return settings?.beforeLabelPosition || 'left-top';
}

export function pickAfterLabelPosition(settings, photo, combinedContext) {
  // Single after photo → singleLabel*; combined → after-half settings.
  if (!treatAsCombined(photo, combinedContext)) {
    const v = pickSingleChain(
      photo, settings,
      'singleLabelPosition', 'singleLabelPositionLandscape',
      'afterLabelPosition', 'afterLabelPositionLandscape',
    );
    if (v) return v;
  }
  if (isLandscape(photo)) {
    // Landscape photos combine stacked (top/bottom). `left-top` for the After
    // label sits at the top-left of the bottom half (just below the divider
    // line on the left edge) once the bake-time after-half offset is applied.
    // Aligns with `DEFAULT_LANDSCAPE_AFTER_LABEL_POSITION` in SettingsContext.
    return settings?.afterLabelPositionLandscape
      || 'left-top';
  }
  return settings?.afterLabelPosition || 'right-top';
}

export function pickLabelPosition(settings, mode, photo) {
  return mode === 'before'
    ? pickBeforeLabelPosition(settings, photo)
    : pickAfterLabelPosition(settings, photo);
}

// Orientation-aware freeform offset pickers. Mirror the position pickers
// above: when a photo is landscape, use the *Landscape variant. Returns
// null when no freeform offset is set, in which case the renderer falls
// back to the position key.
export function pickBeforeLabelOffset(settings, photo, combinedContext) {
  if (!settings) return null;
  if (!treatAsCombined(photo, combinedContext)) {
    const v = pickSingleChain(
      photo, settings,
      'singleLabelOffset', 'singleLabelOffsetLandscape',
      'beforeLabelOffset', 'beforeLabelOffsetLandscape',
    );
    if (v) return v;
  }
  if (isLandscape(photo)) {
    return settings.beforeLabelOffsetLandscape || null;
  }
  return settings.beforeLabelOffset || null;
}

export function pickAfterLabelOffset(settings, photo, combinedContext) {
  if (!settings) return null;
  if (!treatAsCombined(photo, combinedContext)) {
    const v = pickSingleChain(
      photo, settings,
      'singleLabelOffset', 'singleLabelOffsetLandscape',
      'afterLabelOffset', 'afterLabelOffsetLandscape',
    );
    if (v) return v;
  }
  if (isLandscape(photo)) {
    return settings.afterLabelOffsetLandscape || null;
  }
  return settings.afterLabelOffset || null;
}

export function pickLabelOffset(settings, mode, photo) {
  return mode === 'before'
    ? pickBeforeLabelOffset(settings, photo)
    : pickAfterLabelOffset(settings, photo);
}

export function isLandscapePhoto(photo) {
  return isLandscape(photo);
}

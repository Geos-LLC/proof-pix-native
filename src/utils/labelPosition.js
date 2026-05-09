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

export function pickBeforeLabelPosition(settings, photo) {
  if (isLandscape(photo)) {
    return settings?.beforeLabelPositionLandscape
      || 'left-top';
  }
  return settings?.beforeLabelPosition || 'left-top';
}

export function pickAfterLabelPosition(settings, photo) {
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

export function isLandscapePhoto(photo) {
  return isLandscape(photo);
}

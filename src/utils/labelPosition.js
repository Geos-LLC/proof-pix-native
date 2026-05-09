/**
 * Pick the orientation-aware before/after label position.
 *
 * The user can configure label positions independently for portrait/square
 * photos and for landscape photos. A photo is treated as landscape when its
 * width is strictly greater than its height; everything else (including
 * 1:1 squares and missing dimensions) falls back to the portrait setting.
 */

const isLandscape = (width, height) => {
  const w = Number(width);
  const h = Number(height);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w > h;
};

export function pickBeforeLabelPosition(settings, width, height) {
  if (isLandscape(width, height)) {
    return settings?.beforeLabelPositionLandscape
      || settings?.beforeLabelPosition
      || 'left-top';
  }
  return settings?.beforeLabelPosition || 'left-top';
}

export function pickAfterLabelPosition(settings, width, height) {
  if (isLandscape(width, height)) {
    return settings?.afterLabelPositionLandscape
      || settings?.afterLabelPosition
      || 'right-top';
  }
  return settings?.afterLabelPosition || 'right-top';
}

export function pickLabelPosition(settings, mode, width, height) {
  return mode === 'before'
    ? pickBeforeLabelPosition(settings, width, height)
    : pickAfterLabelPosition(settings, width, height);
}

export function isLandscapePhoto(width, height) {
  return isLandscape(width, height);
}

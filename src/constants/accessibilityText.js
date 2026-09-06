/**
 * Shared props for iOS Dynamic Type / Android font scaling.
 * Caps growth so fixed layouts (nav pill, room tabs, plan badge) stay usable.
 */
export const NAV_LABEL_PROPS = {
  maxFontSizeMultiplier: 1.1,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.7,
};

export const TITLE_PROPS = {
  maxFontSizeMultiplier: 1.25,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.75,
};

export const BODY_PROPS = {
  maxFontSizeMultiplier: 1.2,
};

export const CAPTION_PROPS = {
  maxFontSizeMultiplier: 1.15,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.8,
};

export const SINGLE_LINE_PROPS = {
  maxFontSizeMultiplier: 1.2,
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.75,
};

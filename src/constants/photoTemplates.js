// Photo templates for Studio.
//
// A template is a named bundle of per-photo customization the user can
// re-apply from the Templates tool. Two flavors:
//   - **Presets**: read-only, shipped in the app binary. `isPreset: true`,
//     stable ids prefixed with `preset-` so keys survive updates.
//   - **User templates**: persisted per device via photoTemplateService
//     (AsyncStorage). Users can rename, delete, and overwrite.
//
// Position convention: `<horizontal>-<vertical>` (`right-bottom`, not
// `bottom-right`) — matches DEFAULT_WATERMARK_POSITION in rooms.js.
//
// Apply semantics: applyTemplateToPhoto REPLACES photo.overrides with
// the template's overrides (not merge) so residue from a previous
// preset can't bleed through.
//
// Two critical gotchas each preset must handle:
//
// 1. **Landscape variants**: pickBeforeLabelPosition branches on the
//    source photo's raw dimensions (isLandscape) — landscape-shot
//    photos read `beforeLabelPositionLandscape` etc. So each preset
//    MUST set both the portrait and Landscape variants of every label
//    position key, otherwise landscape sources fall through to global.
//
// 2. **Freeform offsets override position keys**: if the photo has any
//    prior `beforeLabelOffset` / `watermarkOffset` / `metaOffset` /
//    `brandLogoOffset` from a drag, the overlay renders at that offset
//    and the position key is ignored. Presets must therefore null out
//    every offset explicitly so the position keys win.
//
// Rules every preset must follow:
//   A. **No overlay overlaps** — labels + watermark + timestamp + logo
//      must each land on a distinct corner or edge slot.
//   B. **Labels scale to photo size** — set `labelSize: 'medium'` and
//      let PhotoLabels' `sizeScale` (tied to the measured frame width)
//      do the proportional resizing at render. Presets should not pin
//      'large' or 'small' — the runtime scaler handles it.
//   C. **Logo on combined = center** — combined photos render the
//      brand logo at `center-middle` so it sits on the divider line
//      between the Before and After halves (works for both side-by-
//      side and stacked layouts).

const SHARED_NULL_OFFSETS = {
  beforeLabelOffset: null,
  afterLabelOffset: null,
  beforeLabelOffsetLandscape: null,
  afterLabelOffsetLandscape: null,
  singleLabelOffset: null,
  singleLabelOffsetLandscape: null,
  combinedLabelOffset: null,
  watermarkOffset: null,
  metaOffset: null,
  brandLogoOffset: null,
};

export const PHOTO_TEMPLATE_PRESETS = [
  {
    id: 'preset-portrait-yellow',
    name: 'Portrait · Yellow Report',
    isPreset: true,
    photoFields: { pairTemplate: 'tall-9-16' },
    overrides: {
      ...SHARED_NULL_OFFSETS,
      showLabels: true,
      labelBackgroundColor: '#F2C31B',
      labelTextColor: '#1A1A1A',
      labelSize: 'medium',
      labelCornerStyle: 'rounded',
      beforeLabelPosition: 'left-top',
      afterLabelPosition: 'right-top',
      beforeLabelPositionLandscape: 'left-top',
      afterLabelPositionLandscape: 'right-top',
      singleLabelPosition: 'left-top',
      singleLabelPositionLandscape: 'left-top',
      combinedLabelPosition: 'center-top',
      showWatermark: true,
      watermarkPosition: 'center-bottom',
      showPreviewMetadata: false,
      showBrandLogo: false,
    },
  },
  {
    id: 'preset-landscape-minimal',
    name: 'Landscape · Minimal',
    isPreset: true,
    photoFields: { pairTemplate: 'wide-16-9' },
    overrides: {
      ...SHARED_NULL_OFFSETS,
      showLabels: true,
      labelBackgroundColor: '#FFFFFF',
      labelTextColor: '#1A1A1A',
      labelSize: 'medium',
      labelCornerStyle: 'square',
      beforeLabelPosition: 'left-bottom',
      afterLabelPosition: 'right-bottom',
      beforeLabelPositionLandscape: 'left-bottom',
      afterLabelPositionLandscape: 'right-bottom',
      singleLabelPosition: 'left-bottom',
      singleLabelPositionLandscape: 'left-bottom',
      combinedLabelPosition: 'center-bottom',
      showWatermark: false,
      showPreviewMetadata: false,
      showBrandLogo: false,
    },
  },
  {
    id: 'preset-square-social',
    name: 'Square · Social Post',
    isPreset: true,
    photoFields: { pairTemplate: 'square' },
    overrides: {
      ...SHARED_NULL_OFFSETS,
      showLabels: true,
      labelBackgroundColor: '#1A1A1A',
      labelTextColor: '#FFFFFF',
      labelSize: 'medium',
      labelCornerStyle: 'rounded',
      beforeLabelPosition: 'center-top',
      afterLabelPosition: 'center-bottom',
      beforeLabelPositionLandscape: 'center-top',
      afterLabelPositionLandscape: 'center-bottom',
      singleLabelPosition: 'center-top',
      singleLabelPositionLandscape: 'center-top',
      combinedLabelPosition: 'center-top',
      showWatermark: false,
      showPreviewMetadata: false,
      showBrandLogo: true,
      // Rule C — logo on the divider line of combined photos. For
      // side-by-side that's the vertical center line; for stack it's
      // the horizontal center line. `center-middle` covers both.
      brandLogoPosition: 'center-middle',
      brandLogoSize: 60,
    },
  },
  {
    // 4-corner layout: BEFORE top-left, AFTER top-right, watermark
    // right-bottom, timestamp left-bottom. Nothing shares a corner.
    id: 'preset-wide-timeline',
    name: 'Wide · Timeline w/ Timestamp',
    isPreset: true,
    photoFields: { pairTemplate: 'wide-2-1' },
    overrides: {
      ...SHARED_NULL_OFFSETS,
      showLabels: true,
      labelBackgroundColor: '#1A1A1A',
      labelTextColor: '#F2C31B',
      labelSize: 'medium',
      labelCornerStyle: 'rounded',
      beforeLabelPosition: 'left-top',
      afterLabelPosition: 'right-top',
      beforeLabelPositionLandscape: 'left-top',
      afterLabelPositionLandscape: 'right-top',
      singleLabelPosition: 'left-top',
      singleLabelPositionLandscape: 'left-top',
      combinedLabelPosition: 'center-top',
      showWatermark: true,
      watermarkPosition: 'right-bottom',
      showPreviewMetadata: true,
      metaShowDate: true,
      metaShowTime: true,
      metaShowAddress: false,
      metaShowGps: false,
      metaPosition: 'left-bottom',
      showBrandLogo: false,
    },
  },
];

export const isPresetTemplateId = (id) => typeof id === 'string' && id.startsWith('preset-');

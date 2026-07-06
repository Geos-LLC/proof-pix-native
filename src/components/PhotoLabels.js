// Single source-of-truth label overlay for a photo. Reads ALL label
// state (showLabels gate, per-side positions, landscape variants,
// freeform offsets) from SettingsContext so every screen renders labels
// the same way and the Customize Labels screen's freeform drag offset
// is honored everywhere — not just the screens that remember to pass it.
//
// Usage:
//   <PhotoLabels photo={p} />                  — full label set for photo.mode
//   <PhotoLabels photo={p} role="before" />    — single side (CompareViewer)
//   <PhotoLabels photo={p} combinedLayout="stack" />  — landscape combined
//
// Position overrides are only for the LabelCustomization preview where
// the user is dragging a label that hasn't been saved yet. Show/hide is
// always driven by SettingsContext.showLabels so the toggle switches in
// Settings, Gallery, and Studio panels are the one and only authority.

import React, { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useScopedSettings } from '../hooks/useScopedSettings';
import { usePhotos } from '../context/PhotoContext';
import { PHOTO_MODES } from '../constants/rooms';
import PhotoLabel from './PhotoLabel';

// Reference width used to derive a label size scale factor. Labels are
// designed for a ~350px-wide preview (typical Studio frame on a phone).
// Anything smaller scales the label down proportionally so a 150px
// thumbnail doesn't get the same-size chip as a 350px hero. Clamped to
// avoid absurdly tiny or gigantic labels on edge-case containers.
const LABEL_REFERENCE_WIDTH = 350;
const MIN_LABEL_SCALE = 0.5;
const MAX_LABEL_SCALE = 1;

const computeLabelSizeScale = (width) => {
  if (!width || width <= 0) return 1;
  const raw = width / LABEL_REFERENCE_WIDTH;
  return Math.max(MIN_LABEL_SCALE, Math.min(MAX_LABEL_SCALE, raw));
};
import {
  pickBeforeLabelPosition,
  pickAfterLabelPosition,
  pickBeforeLabelOffset,
  pickAfterLabelOffset,
} from '../utils/labelPosition';

// Mirror of StudioScreen's `pairResolved` and LabelCustomizationScreen's
// `combinedSourceIds`: for a combined photo, look up the source single
// before/after photos so overrides read here land on the same records
// the Customize Labels picker + DraggableLabelOverlay drag persist to.
const resolveCombinedSources = (photo, photos) => {
  if (!photo) return { before: null, after: null };
  const idStr = String(photo.id || '');
  let beforePhoto = null;
  if (idStr.startsWith('combined_')) {
    const beforeIdStr = idStr.slice('combined_'.length);
    beforePhoto = photos.find((p) => String(p.id) === beforeIdStr) || null;
  }
  if (!beforePhoto && photo.name && photo.room) {
    beforePhoto = photos.find(
      (p) => p.name === photo.name
        && p.room === photo.room
        && p.mode === PHOTO_MODES.BEFORE
    ) || null;
  }
  let afterPhoto = beforePhoto
    ? photos.find(
        (p) => p.beforePhotoId === beforePhoto.id && p.mode === PHOTO_MODES.AFTER
      ) || null
    : null;
  if (photo.beforeOverrideId) {
    const ov = photos.find((p) => String(p.id) === String(photo.beforeOverrideId));
    if (ov) beforePhoto = ov;
  }
  if (photo.afterOverrideId) {
    const ov = photos.find((p) => String(p.id) === String(photo.afterOverrideId));
    if (ov) afterPhoto = ov;
  }
  return { before: beforePhoto, after: afterPhoto };
};

const halves = StyleSheet.create({
  left: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%' },
  right: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, height: '50%' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
});

const LABEL_TEXT = {
  before: 'common.before',
  after: 'common.after',
  progress: 'common.progress',
};

const collectPositionSettings = (settings) => ({
  beforeLabelPosition: settings.beforeLabelPosition,
  afterLabelPosition: settings.afterLabelPosition,
  beforeLabelPositionLandscape: settings.beforeLabelPositionLandscape,
  afterLabelPositionLandscape: settings.afterLabelPositionLandscape,
  beforeLabelOffset: settings.beforeLabelOffset,
  afterLabelOffset: settings.afterLabelOffset,
  beforeLabelOffsetLandscape: settings.beforeLabelOffsetLandscape,
  afterLabelOffsetLandscape: settings.afterLabelOffsetLandscape,
});

// Render a single PhotoLabel honoring the user's margin setting. When
// `freeformOffset` is set, the label is wrapped in an inset container
// that pads the photoFrame by `(marginH, marginV)` on every edge.
// PhotoLabel inside positions itself in % within THAT inset, so
// offset (0,0) lands the label `marginH` pixels from the left edge
// (instead of flush against it) and (1,1) lands it `marginH` from
// the right — the same inset rectangle the Studio drag clamps to.
//
// Position-key path (no freeform offset) bypasses the inset wrapper
// because PhotoLabel already pulls the margin from
// `getLabelPositions(marginV, marginH)` directly.
function LabelWithMargins({ photo, label, position, freeformOffset, marginH, marginV, sizeScale }) {
  const useFreeform = freeformOffset
    && typeof freeformOffset.x === 'number'
    && typeof freeformOffset.y === 'number';
  if (!useFreeform) {
    return <PhotoLabel photo={photo} label={label} position={position} sizeScale={sizeScale} />;
  }
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: marginV, bottom: marginV, left: marginH, right: marginH }}
    >
      <PhotoLabel photo={photo} label={label} position="left-top" freeformOffset={freeformOffset} sizeScale={sizeScale} />
    </View>
  );
}

export default function PhotoLabels({
  photo,
  role,
  combinedLayout = 'side',
  showLabelsOverride,
  positionOverrides,
  // Signals that this photo is being rendered as one half of a combined
  // pair, even if its own `mode` is 'before' / 'after'. Forwarded to the
  // position pickers so they use the combined before/after cascade
  // (beforeLabelPosition / afterLabelPosition) instead of the single
  // singleLabelPosition cascade — mirrors DraggableLabelOverlay so
  // Studio's drag preview and every non-drag render pick the same key.
  combinedContext,
  // When the caller already knows the container width (or an explicit
  // scale) it can pass one down and skip the onLayout measurement.
  // Used by the combined branch below so half-container renders derive
  // their scale from the parent measurement without their own layout
  // pass.
  sizeScale: sizeScaleProp,
}) {
  // Scoped — when `photo.overrides` is present, those win over global
  // Settings for this photo only.
  const settings = useScopedSettings(photo?.id);
  const { photos } = usePhotos();
  // Measure the container so labels can scale down on small thumbnails
  // (report pair cards, timeline grids) instead of stamping the same
  // pixel-sized chip on every photo regardless of frame size.
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const handleLayout = useCallback((e) => {
    const w = e?.nativeEvent?.layout?.width;
    if (typeof w === 'number' && Math.abs(w - measuredWidth) > 1) {
      setMeasuredWidth(w);
    }
  }, [measuredWidth]);
  const sizeScale = typeof sizeScaleProp === 'number'
    ? sizeScaleProp
    : computeLabelSizeScale(measuredWidth);
  const enabled = typeof showLabelsOverride === 'boolean'
    ? showLabelsOverride
    : settings.showLabels;
  if (!enabled || !photo) {
    // Still mount the layout wrapper so onLayout has a chance to fire
    // when the toggle flips back on — otherwise the measurement stays
    // 0 and the first render post-toggle scales too aggressively.
    return typeof sizeScaleProp === 'number'
      ? null
      : <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={handleLayout} />;
  }

  const lps = positionOverrides || collectPositionSettings(settings);
  const marginH = settings.labelMarginHorizontal ?? 10;
  const marginV = settings.labelMarginVertical ?? 10;

  // Wrap output in an absoluteFill container so onLayout can report the
  // container size. When a scale was passed from a parent (combined
  // branch recursion), skip the wrapper — the parent already measured.
  const wrap = (children) => (
    typeof sizeScaleProp === 'number'
      ? children
      : (
        <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={handleLayout}>
          {children}
        </View>
      )
  );

  if (role === 'before' || role === 'after' || role === 'progress') {
    const pos = role === 'before'
      ? pickBeforeLabelPosition(lps, photo, combinedContext)
      : pickAfterLabelPosition(lps, photo, combinedContext);
    const off = role === 'before'
      ? pickBeforeLabelOffset(lps, photo, combinedContext)
      : pickAfterLabelOffset(lps, photo, combinedContext);
    return wrap(
      <LabelWithMargins
        photo={photo}
        label={LABEL_TEXT[role]}
        position={pos}
        freeformOffset={off}
        marginH={marginH}
        marginV={marginV}
        sizeScale={sizeScale}
      />
    );
  }

  const mode = photo.mode;

  if (mode === 'combined' || mode === 'mix') {
    const isStack = combinedLayout === 'stack';
    // Resolve source before/after photos so per-half rendering reads
    // from the same records the Customize Labels picker /
    // DraggableLabelOverlay drag write to. Without this, the combined
    // preview would read from combined_photo.overrides (empty — writes
    // go to the source singles) and never reflect position changes.
    // Falls back to the combined photo itself when a source can't be
    // resolved (missing after, orphaned combined, etc.) — same
    // rendering as before, so nothing regresses.
    // When positionOverrides is passed (Customize Labels drag preview),
    // still honor it: forward through to the role branch so the drag
    // preview renders even before the value has been committed.
    // Safety net: if the source-resolve lookup throws for any reason
    // (unexpected photo shape, photos array not iterable), fall through
    // to the legacy inline render below so a single bad photo can't
    // brick every combined preview in the app. Ref: 2026-07-01 crash
    // (feedback_phase1_ota_crash_2026_07_01.md).
    let srcBefore = null;
    let srcAfter = null;
    try {
      const resolved = resolveCombinedSources(photo, photos);
      srcBefore = resolved.before;
      srcAfter = resolved.after;
    } catch (e) {
      srcBefore = null;
      srcAfter = null;
    }
    // For combined photos we pass the OUTER container's sizeScale down
    // to each half so the labels match what Studio renders — Studio's
    // DraggableLabelOverlay uses PhotoLabel with sizeScale=1, so if the
    // Preview / Enlarged halves independently measured 50% of the outer
    // width they'd render at scale ~0.5 and look half-size next to
    // Studio. Inheriting the outer scale keeps every screen visually
    // consistent regardless of stack vs side layout.
    if (srcBefore || srcAfter) {
      const beforeSide = srcBefore || photo;
      const afterSide = srcAfter || photo;
      return wrap(
        <>
          <View pointerEvents="none" style={isStack ? halves.top : halves.left}>
            <PhotoLabels
              photo={beforeSide}
              role="before"
              showLabelsOverride={enabled}
              positionOverrides={positionOverrides}
              combinedContext
              sizeScale={sizeScale}
            />
          </View>
          <View pointerEvents="none" style={isStack ? halves.bottom : halves.right}>
            <PhotoLabels
              photo={afterSide}
              role="after"
              showLabelsOverride={enabled}
              positionOverrides={positionOverrides}
              combinedContext
              sizeScale={sizeScale}
            />
          </View>
        </>
      );
    }
    // Fallback: legacy inline render using the combined photo's own
    // scoped settings — the pre-fix behavior. Preserves rendering when
    // source lookup fails or returns nothing.
    return wrap(
      <>
        <View pointerEvents="none" style={isStack ? halves.top : halves.left}>
          <LabelWithMargins
            photo={photo}
            label="common.before"
            position={pickBeforeLabelPosition(lps, photo)}
            freeformOffset={pickBeforeLabelOffset(lps, photo)}
            marginH={marginH}
            marginV={marginV}
            sizeScale={sizeScale}
          />
        </View>
        <View pointerEvents="none" style={isStack ? halves.bottom : halves.right}>
          <LabelWithMargins
            photo={photo}
            label="common.after"
            position={pickAfterLabelPosition(lps, photo)}
            freeformOffset={pickAfterLabelOffset(lps, photo)}
            marginH={marginH}
            marginV={marginV}
            sizeScale={sizeScale}
          />
        </View>
      </>
    );
  }

  if (mode === 'before' || mode === 'after' || mode === 'progress') {
    const pos = mode === 'before'
      ? pickBeforeLabelPosition(lps, photo)
      : pickAfterLabelPosition(lps, photo);
    const off = mode === 'before'
      ? pickBeforeLabelOffset(lps, photo)
      : pickAfterLabelOffset(lps, photo);
    return wrap(
      <LabelWithMargins
        photo={photo}
        label={LABEL_TEXT[mode]}
        position={pos}
        freeformOffset={off}
        marginH={marginH}
        marginV={marginV}
        sizeScale={sizeScale}
      />
    );
  }

  return wrap(null);
}

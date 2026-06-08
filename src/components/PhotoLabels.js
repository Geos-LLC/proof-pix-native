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

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useScopedSettings } from '../hooks/useScopedSettings';
import PhotoLabel from './PhotoLabel';
import {
  pickBeforeLabelPosition,
  pickAfterLabelPosition,
  pickBeforeLabelOffset,
  pickAfterLabelOffset,
} from '../utils/labelPosition';

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
function LabelWithMargins({ photo, label, position, freeformOffset, marginH, marginV }) {
  const useFreeform = freeformOffset
    && typeof freeformOffset.x === 'number'
    && typeof freeformOffset.y === 'number';
  if (!useFreeform) {
    return <PhotoLabel photo={photo} label={label} position={position} />;
  }
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: marginV, bottom: marginV, left: marginH, right: marginH }}
    >
      <PhotoLabel photo={photo} label={label} position="left-top" freeformOffset={freeformOffset} />
    </View>
  );
}

export default function PhotoLabels({
  photo,
  role,
  combinedLayout = 'side',
  showLabelsOverride,
  positionOverrides,
}) {
  // Scoped — when `photo.overrides` is present, those win over global
  // Settings for this photo only.
  const settings = useScopedSettings(photo?.id);
  const enabled = typeof showLabelsOverride === 'boolean'
    ? showLabelsOverride
    : settings.showLabels;
  if (!enabled || !photo) return null;

  const lps = positionOverrides || collectPositionSettings(settings);
  const marginH = settings.labelMarginHorizontal ?? 10;
  const marginV = settings.labelMarginVertical ?? 10;

  if (role === 'before' || role === 'after' || role === 'progress') {
    const pos = role === 'before'
      ? pickBeforeLabelPosition(lps, photo)
      : pickAfterLabelPosition(lps, photo);
    const off = role === 'before'
      ? pickBeforeLabelOffset(lps, photo)
      : pickAfterLabelOffset(lps, photo);
    return (
      <LabelWithMargins
        photo={photo}
        label={LABEL_TEXT[role]}
        position={pos}
        freeformOffset={off}
        marginH={marginH}
        marginV={marginV}
      />
    );
  }

  const mode = photo.mode;

  if (mode === 'combined' || mode === 'mix') {
    const isStack = combinedLayout === 'stack';
    return (
      <>
        <View pointerEvents="none" style={isStack ? halves.top : halves.left}>
          <LabelWithMargins
            photo={photo}
            label="common.before"
            position={pickBeforeLabelPosition(lps, photo)}
            freeformOffset={pickBeforeLabelOffset(lps, photo)}
            marginH={marginH}
            marginV={marginV}
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
    return (
      <LabelWithMargins
        photo={photo}
        label={LABEL_TEXT[mode]}
        position={pos}
        freeformOffset={off}
        marginH={marginH}
        marginV={marginV}
      />
    );
  }

  return null;
}

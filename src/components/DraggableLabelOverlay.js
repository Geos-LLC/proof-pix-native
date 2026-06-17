// Draggable label overlay for the Studio (edit) screen. Sits over the
// photoFrame and lets the user drag the BEFORE / AFTER / PROGRESS
// label freely. On release, the fractional offset is persisted to
// SettingsContext so PhotoLabels everywhere else (Home, Gallery,
// Section, the bake pipeline) picks up the new position.
//
// The non-draggable read paths still use <PhotoLabels>. This
// component is *only* for the edit context where direct manipulation
// is the primary interaction (the Customize Labels bottom sheet
// holds the tools; the photo is the canvas).

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, Animated, PanResponder, StyleSheet } from 'react-native';
import { useScopedSettings } from '../hooks/useScopedSettings';
import PhotoLabel from './PhotoLabel';
import { getLabelPositions } from '../constants/rooms';
import {
  pickBeforeLabelPosition,
  pickAfterLabelPosition,
  pickBeforeLabelOffset,
  pickAfterLabelOffset,
} from '../utils/labelPosition';

const halves = StyleSheet.create({
  left:   { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%' },
  right:  { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%' },
  top:    { position: 'absolute', left: 0, right: 0, top: 0, height: '50%' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
});

const LABEL_TEXT = {
  before: 'common.before',
  after: 'common.after',
  progress: 'common.progress',
};

// Convert a position key + margins into a top-left pixel coordinate
// inside a region of (regionW, regionH) for a label of (labelW, labelH).
const positionToTopLeft = (key, regionW, regionH, labelW, labelH, marginH, marginV) => {
  const positions = getLabelPositions(marginV, marginH);
  const ps = positions[key] || positions['left-top'];
  // ps has some of { top, bottom, left, right } set. Resolve to (x, y).
  const x =
    typeof ps.left === 'number'  ? ps.left
  : typeof ps.right === 'number' ? regionW - labelW - ps.right
  : (regionW - labelW) / 2;
  const y =
    typeof ps.top === 'number'    ? ps.top
  : typeof ps.bottom === 'number' ? regionH - labelH - ps.bottom
  : (regionH - labelH) / 2;
  return { x, y };
};

function DraggableSide({ role, photo, parentSize, combinedContext }) {
  // Scoped — drag updates go to photo.overrides when the photo has any
  // (or starts having any) so per-photo dragging persists at the
  // photo level instead of mutating global Settings.
  const settings = useScopedSettings(photo?.id);
  const {
    labelMarginVertical,
    labelMarginHorizontal,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    beforeLabelOffset,
    afterLabelOffset,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    singleLabelPosition,
    singleLabelPositionLandscape,
    singleLabelOffset,
    singleLabelOffsetLandscape,
    updateBeforeLabelOffset,
    updateAfterLabelOffset,
    updateBeforeLabelOffsetLandscape,
    updateAfterLabelOffsetLandscape,
    updateSingleLabelOffset,
    updateSingleLabelOffsetLandscape,
  } = settings;

  // Pick the right stored position / offset / updater for this side
  // and the photo's orientation (portrait vs landscape).
  const lps = {
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    beforeLabelOffset,
    afterLabelOffset,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    singleLabelPosition,
    singleLabelPositionLandscape,
    singleLabelOffset,
    singleLabelOffsetLandscape,
  };

  const positionKey = role === 'before'
    ? pickBeforeLabelPosition(lps, photo, combinedContext)
    : pickAfterLabelPosition(lps, photo, combinedContext);
  const savedOffset = role === 'before'
    ? pickBeforeLabelOffset(lps, photo, combinedContext)
    : pickAfterLabelOffset(lps, photo, combinedContext);

  // labelPosition's picker swaps to *Landscape variants when the photo
  // is landscape — the persist updater must match.
  const isLandscape = (() => {
    if (!photo) return false;
    const w = Number(photo.width);
    const h = Number(photo.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w > h;
    if (typeof photo.aspectRatio === 'string') {
      const [aw, ah] = photo.aspectRatio.split(':').map(Number);
      if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) return aw > ah;
    }
    return false;
  })();
  // Dragging a label on a single photo writes to singleLabel* (the
  // combined-only before/after fields don't apply). Dragging on a
  // combined-half writes to the combined before/after field, matching
  // where the renderer reads from.
  const isCombined = combinedContext === true
    || photo?.mode === 'combined' || photo?.mode === 'mix';
  let persistOffset;
  if (!isCombined) {
    persistOffset = isLandscape ? updateSingleLabelOffsetLandscape : updateSingleLabelOffset;
  } else if (role === 'before') {
    persistOffset = isLandscape ? updateBeforeLabelOffsetLandscape : updateBeforeLabelOffset;
  } else {
    persistOffset = isLandscape ? updateAfterLabelOffsetLandscape : updateAfterLabelOffset;
  }

  const [labelSize, setLabelSize] = useState({ w: 0, h: 0 });
  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const idX = pos.x.addListener(({ value }) => { posRef.current.x = value; });
    const idY = pos.y.addListener(({ value }) => { posRef.current.y = value; });
    return () => { pos.x.removeListener(idX); pos.y.removeListener(idY); };
  }, [pos]);

  // The freeform offset (0..1) is mapped into the inset rectangle
  // [margin, parent - margin - label]. So offset.x = 0 lands the label
  // marginH from the left edge (not flush against it), offset.x = 1
  // lands it marginH from the right edge. Drag clamps to the same
  // inset range so the label can never overlap the photo's frame —
  // the user's margin setting is honored both for grid picks and for
  // free-drag placements.
  const insetSpanX = Math.max(0, parentSize.w - labelSize.w - 2 * labelMarginHorizontal);
  const insetSpanY = Math.max(0, parentSize.h - labelSize.h - 2 * labelMarginVertical);
  const minX = labelMarginHorizontal;
  const minY = labelMarginVertical;
  const maxX = labelMarginHorizontal + insetSpanX;
  const maxY = labelMarginVertical + insetSpanY;

  // Sync external → animated value. Fires whenever the saved offset,
  // position key, bounds, or label size changes (and we aren't actively
  // dragging — the user's gesture wins until release).
  useEffect(() => {
    if (draggingRef.current) return;
    if (labelSize.w === 0 || labelSize.h === 0) return;
    if (parentSize.w === 0 || parentSize.h === 0) return;

    const target = savedOffset && typeof savedOffset.x === 'number' && typeof savedOffset.y === 'number'
      ? {
          x: minX + savedOffset.x * insetSpanX,
          y: minY + savedOffset.y * insetSpanY,
        }
      : positionToTopLeft(
          positionKey,
          parentSize.w, parentSize.h,
          labelSize.w, labelSize.h,
          labelMarginHorizontal, labelMarginVertical,
        );
    pos.setValue(target);
    posRef.current = target;
    // Diagnostic — once per offset/photo change so the user can share
    // the captured values when a label appears at the wrong spot.
    console.warn(
      '[LabelPos]', role,
      'photoId=', photo?.id,
      'mode=', photo?.mode,
      'overrides=', photo?.overrides ? Object.keys(photo.overrides).join(',') : 'none',
      'savedOffset=', JSON.stringify(savedOffset),
      'positionKey=', positionKey,
      'parent=', `${Math.round(parentSize.w)}x${Math.round(parentSize.h)}`,
      'label=', `${Math.round(labelSize.w)}x${Math.round(labelSize.h)}`,
      'target=', `${Math.round(target.x)},${Math.round(target.y)}`,
    );
  }, [
    savedOffset?.x, savedOffset?.y, positionKey,
    parentSize.w, parentSize.h, labelSize.w, labelSize.h,
    labelMarginHorizontal, labelMarginVertical,
  ]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      draggingRef.current = true;
      dragStartRef.current = { x: posRef.current.x, y: posRef.current.y };
    },
    onPanResponderMove: (_, g) => {
      // Clamp during drag too so the user can't push the label outside
      // the margin inset — the visual feedback matches what gets
      // persisted on release.
      const nx = Math.max(minX, Math.min(maxX, dragStartRef.current.x + g.dx));
      const ny = Math.max(minY, Math.min(maxY, dragStartRef.current.y + g.dy));
      pos.setValue({ x: nx, y: ny });
    },
    onPanResponderRelease: async () => {
      if (parentSize.w === 0 || labelSize.w === 0) {
        draggingRef.current = false;
        return;
      }
      const finalX = Math.max(minX, Math.min(maxX, posRef.current.x));
      const finalY = Math.max(minY, Math.min(maxY, posRef.current.y));
      pos.setValue({ x: finalX, y: finalY });
      posRef.current = { x: finalX, y: finalY };
      const spanX = Math.max(1, insetSpanX);
      const spanY = Math.max(1, insetSpanY);
      const nextOffset = {
        x: Math.max(0, Math.min(1, (finalX - minX) / spanX)),
        y: Math.max(0, Math.min(1, (finalY - minY) / spanY)),
      };
      draggingRef.current = false;
      if (persistOffset) {
        try { await persistOffset(nextOffset); } catch (_) {}
      }
    },
    onPanResponderTerminate: () => { draggingRef.current = false; },
  }), [parentSize.w, parentSize.h, labelSize.w, labelSize.h, minX, minY, maxX, maxY, insetSpanX, insetSpanY, persistOffset]);

  const ready = labelSize.w > 0 && labelSize.h > 0 && parentSize.w > 0;

  // The outer Animated.View sits at the parent's top-left with a
  // transform = pos. PhotoLabel inside is rendered with
  // freeformOffset {0,0}, which makes it lay out at (0,0) of the
  // wrapper. Net effect: the label appears at (pos.x, pos.y) in the
  // parent's coordinate space.
  return (
    <Animated.View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setLabelSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
      }}
      {...responder.panHandlers}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        opacity: ready ? 1 : 0,
        transform: [{ translateX: pos.x }, { translateY: pos.y }],
      }}
    >
      <PhotoLabel
        // `photo` forwards through to PhotoLabel's useScopedSettings so
        // per-photo overrides (color, font, size, etc.) actually apply
        // to the rendered label in Studio. Without this prop PhotoLabel
        // falls back to global settings only.
        photo={photo}
        label={LABEL_TEXT[role]}
        position="left-top"
        freeformOffset={{ x: 0, y: 0 }}
        // Override PhotoLabel's internal `position: 'absolute'` so the
        // wrapping Animated.View can measure its intrinsic size via
        // onLayout. Without this, labelSize stays 0×0 and the opacity
        // gate keeps the label invisible. Translation is driven by
        // the wrapper's transform, not by PhotoLabel's freeform style.
        style={{ position: 'relative' }}
      />
    </Animated.View>
  );
}

export default function DraggableLabelOverlay({ photo, role, combinedLayout = 'side', combinedContext }) {
  const settings = useScopedSettings(photo?.id);
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 });

  if (!settings.showLabels || !photo) return null;

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setParentSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  // Single-role render — used by the COMBINED case where each half is
  // measured separately by the caller (the half-View defines the
  // parent bounds for offset calculation).
  if (role === 'before' || role === 'after' || role === 'progress') {
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {parentSize.w > 0 && (
          <DraggableSide role={role} photo={photo} parentSize={parentSize} combinedContext={combinedContext} />
        )}
      </View>
    );
  }

  const mode = photo.mode;

  if (mode === 'combined' || mode === 'mix') {
    const isStack = combinedLayout === 'stack';
    return (
      <>
        <View pointerEvents="box-none" style={isStack ? halves.top : halves.left} onLayout={onLayout}>
          {parentSize.w > 0 && (
            <DraggableSide role="before" photo={photo} parentSize={parentSize} combinedContext />
          )}
        </View>
        <View pointerEvents="box-none" style={isStack ? halves.bottom : halves.right}>
          {/* Right/bottom half measures itself via its own DraggableSide */}
          <DraggableHalf role="after" photo={photo} combinedContext />
        </View>
      </>
    );
  }

  if (mode === 'before' || mode === 'after' || mode === 'progress') {
    return (
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
        {parentSize.w > 0 && (
          <DraggableSide role={mode} photo={photo} parentSize={parentSize} />
        )}
      </View>
    );
  }

  return null;
}

// Small helper for the combined case so each half measures itself.
function DraggableHalf({ role, photo, combinedContext }) {
  const [parentSize, setParentSize] = useState({ w: 0, h: 0 });
  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setParentSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
      }}
    >
      {parentSize.w > 0 && (
        <DraggableSide role={role} photo={photo} parentSize={parentSize} combinedContext={combinedContext} />
      )}
    </View>
  );
}

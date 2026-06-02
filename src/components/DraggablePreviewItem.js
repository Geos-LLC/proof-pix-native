import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';

const POSITION_GRID = [
  ['left-top', 'center-top', 'right-top'],
  ['left-middle', 'center-middle', 'right-middle'],
  ['left-bottom', 'center-bottom', 'right-bottom'],
];

const positionToCoords = (key) => {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (POSITION_GRID[r][c] === key) return { col: c, row: r };
    }
  }
  return { col: 0, row: 0 };
};

// Map a grid key to a top-left pixel anchor inside a region of
// width/height (with the item's own width/height factored in). Mirrors
// LabelCustomizationScreen's positionToTopLeft so the fallback render
// matches what users see on the labels page.
export const positionToTopLeft = (key, regionW, regionH, itemW, itemH, marginH = 10, marginV = 10) => {
  const { col, row } = positionToCoords(key);
  let x = marginH;
  if (col === 1) x = (regionW - itemW) / 2;
  else if (col === 2) x = regionW - itemW - marginH;
  let y = marginV;
  if (row === 1) y = (regionH - itemH) / 2;
  else if (row === 2) y = regionH - itemH - marginV;
  return { x, y };
};

/**
 * Generic draggable overlay item used by the Logo / Watermark / Metadata
 * customization screens (and modeled after the freeform DraggableLabel
 * inside LabelCustomizationScreen). Position lives in a single
 * Animated.ValueXY in pixels — drag updates it directly, release clamps
 * synchronously and writes back a fractional offset. No anchor + pan
 * two-layer math, so there's no one-frame blink on release.
 *
 * Props:
 *  - bounds: { x, y, w, h } — the region the item is allowed to live in
 *  - offset: { x, y } | null — fractional placement (0..1 each), or null
 *    to fall back to `fallbackPositionKey`'s 9-cell grid anchor
 *  - fallbackPositionKey: string like 'left-top' used when offset is null
 *  - marginV / marginH: pixel padding from the bounds edges when using the
 *    fallback grid (ignored once a freeform offset is saved)
 *  - onOffsetChange(nextOffset): called on release with the new fraction
 *  - onDragStart / onDragEnd: optional, for parent ScrollView toggling
 *  - children: rendered inside the draggable container
 *  - containerStyle: extra style merged onto the Animated.View
 */
export default function DraggablePreviewItem({
  bounds,
  offset,
  fallbackPositionKey = 'left-top',
  marginV = 10,
  marginH = 10,
  onOffsetChange,
  onDragStart,
  onDragEnd,
  children,
  containerStyle,
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const idX = pos.x.addListener(({ value }) => { posRef.current.x = value; });
    const idY = pos.y.addListener(({ value }) => { posRef.current.y = value; });
    return () => { pos.x.removeListener(idX); pos.y.removeListener(idY); };
  }, [pos]);

  useEffect(() => {
    if (draggingRef.current) return;
    if (size.w === 0 || size.h === 0) return;
    const target = offset && typeof offset.x === 'number' && typeof offset.y === 'number'
      ? {
          x: offset.x * Math.max(0, bounds.w - size.w),
          y: offset.y * Math.max(0, bounds.h - size.h),
        }
      : positionToTopLeft(fallbackPositionKey, bounds.w, bounds.h, size.w, size.h, marginH, marginV);
    pos.setValue(target);
    posRef.current = target;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset?.x, offset?.y, fallbackPositionKey, bounds.w, bounds.h, bounds.x, bounds.y, size.w, size.h, marginH, marginV]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        dragStartRef.current = { x: posRef.current.x, y: posRef.current.y };
        onDragStart && onDragStart();
      },
      onPanResponderMove: (_, g) => {
        pos.setValue({
          x: dragStartRef.current.x + g.dx,
          y: dragStartRef.current.y + g.dy,
        });
      },
      onPanResponderRelease: () => {
        const finalX = Math.max(0, Math.min(bounds.w - size.w, posRef.current.x));
        const finalY = Math.max(0, Math.min(bounds.h - size.h, posRef.current.y));
        pos.setValue({ x: finalX, y: finalY });
        posRef.current = { x: finalX, y: finalY };
        const spanX = Math.max(1, bounds.w - size.w);
        const spanY = Math.max(1, bounds.h - size.h);
        const nextOffset = {
          x: Math.max(0, Math.min(1, finalX / spanX)),
          y: Math.max(0, Math.min(1, finalY / spanY)),
        };
        draggingRef.current = false;
        onOffsetChange && onOffsetChange(nextOffset);
        onDragEnd && onDragEnd();
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        onDragEnd && onDragEnd();
      },
    })
  ).current;

  const ready = size.w > 0 && size.h > 0;

  return (
    <Animated.View
      onLayout={onLayout}
      {...responder.panHandlers}
      style={[
        {
          position: 'absolute',
          left: bounds.x,
          top: bounds.y,
          opacity: ready ? 1 : 0,
          transform: [{ translateX: pos.x }, { translateY: pos.y }],
        },
        containerStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

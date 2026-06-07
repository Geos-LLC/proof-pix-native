import React, { useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { useSettings } from '../context/SettingsContext';
import PhotoLabel from './PhotoLabel';

const MODE_TO_LABEL = {
  before: 'BEFORE',
  after: 'AFTER',
  progress: 'PROGRESS',
};

/**
 * PhotoLabels + finger-drag. Renders the BEFORE/AFTER label for a photo and
 * lets the user drag it to a freeform position. The drag updates
 * beforeLabelOffset / afterLabelOffset in SettingsContext so the new position
 * propagates everywhere (Gallery, bake pipeline, etc.).
 *
 * Props:
 *   photo  – photo record ({ mode, ... })
 *   role   – optional override ('before'|'after')
 */
export default function DraggableLabelOverlay({ photo, role }) {
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelOffset,
    afterLabelOffset,
    updateBeforeLabelOffset,
    updateAfterLabelOffset,
  } = useSettings();

  const containerRef = useRef(null);
  const containerSize = useRef({ w: 0, h: 0 });

  if (!showLabels || !photo) return null;

  const mode = role || photo?.mode || 'before';
  if (mode === 'combined') return null;

  const label = MODE_TO_LABEL[mode];
  if (!label) return null;

  const position = mode === 'after' ? afterLabelPosition : beforeLabelPosition;
  const freeformOffset = mode === 'after' ? afterLabelOffset : beforeLabelOffset;
  const updateOffset = mode === 'after' ? updateAfterLabelOffset : updateBeforeLabelOffset;

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {},
    onPanResponderMove: (_, gestureState) => {
      const { w, h } = containerSize.current;
      if (!w || !h) return;
      const current = freeformOffset || { x: 0.05, y: 0.05 };
      const nx = Math.max(0, Math.min(1, current.x + gestureState.dx / w));
      const ny = Math.max(0, Math.min(1, current.y + gestureState.dy / h));
      updateOffset({ x: nx, y: ny });
    },
    onPanResponderRelease: () => {},
  });

  return (
    <View
      ref={containerRef}
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        containerSize.current = { w: width, h: height };
      }}
      {...panResponder.panHandlers}
    >
      <PhotoLabel
        label={label}
        position={position || 'left-top'}
        freeformOffset={freeformOffset}
      />
    </View>
  );
}

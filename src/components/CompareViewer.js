import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Image,
  StyleSheet,
  PanResponder,
  Animated,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';

/**
 * Three-mode before/after compare viewer.
 *
 * Modes:
 *   - 'overlay'      : both images stacked at the same position; an opacity
 *                      slider (0..1) cross-fades from BEFORE to AFTER. This
 *                      matches the camera's "ghost" UI for taking an after
 *                      photo — useful for spotting subtle changes.
 *   - 'split'        : draggable vertical divider over a single frame; before
 *                      is the base layer, after is an overlay clipped by the
 *                      divider position. Spec-recommended pattern.
 *   - 'side-by-side' : two photos in halves with a fixed centre divider,
 *                      contain-fit so neither image distorts.
 *
 * Container aspect ratio is derived from the BEFORE photo so the three modes
 * occupy the same on-screen footprint. Both images render with
 * resizeMode="contain" so mixed-orientation pairs letterbox gracefully
 * instead of cropping.
 */

const parseAspect = (input) => {
  if (!input) return null;
  const w = Number(input.width);
  const h = Number(input.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
  const ar = typeof input === 'string' ? input : input.aspectRatio;
  if (typeof ar === 'string' && ar.includes(':')) {
    const [aw, ah] = ar.split(':').map(Number);
    if (Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0) return aw / ah;
  }
  return null;
};

export default function CompareViewer({
  beforePhoto,
  afterPhoto,
  mode = 'split',
  style,
  initialSplit = 0.5,
  initialOverlay = 0.5,
  renderBeforeOverlay,
  renderAfterOverlay,
}) {
  const beforeUri = beforePhoto?.uri;
  const afterUri = afterPhoto?.uri;

  // Force a consistent 1:1 square frame for all three modes — matches the
  // pre-refactor fullScreenCombinedPreview footprint (max 400×400). Both
  // images render with resizeMode="contain", so portrait/landscape/mixed
  // pairs letterbox within the square instead of cropping. Caller can still
  // override via the `style` prop if a non-square container is wanted.
  const aspectRatio = 1;

  // ----- Split mode state -----------------------------------------------------
  // containerWidth is read inside the PanResponder closure — use a ref so the
  // closure always sees the live measured width after onLayout fires.
  const [containerWidth, setContainerWidth] = useState(0);
  const containerWidthRef = useRef(0);

  const splitAnim = useRef(new Animated.Value(initialSplit)).current;
  const splitRef = useRef(initialSplit);
  useEffect(() => {
    const id = splitAnim.addListener(({ value }) => { splitRef.current = value; });
    return () => splitAnim.removeListener(id);
  }, [splitAnim]);

  // mode is a prop and changes between renders, but PanResponder.create() is
  // captured once via useRef. Use a ref so the gesture handler reads the
  // *current* mode instead of the stale one captured at first render —
  // otherwise the divider stops responding the moment you switch modes
  // and back.
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const dragStartRef = useRef(initialSplit);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => modeRef.current === 'split',
      onStartShouldSetPanResponderCapture: () => modeRef.current === 'split',
      onMoveShouldSetPanResponder: () => modeRef.current === 'split',
      onMoveShouldSetPanResponderCapture: () => modeRef.current === 'split',
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { dragStartRef.current = splitRef.current; },
      onPanResponderMove: (_, gs) => {
        const w = containerWidthRef.current;
        if (w <= 0) return;
        const dx = gs.dx / w;
        const next = Math.max(0, Math.min(1, dragStartRef.current + dx));
        splitAnim.setValue(next);
      },
    })
  ).current;

  // ----- Overlay mode state ---------------------------------------------------
  // 0 = pure BEFORE, 1 = pure AFTER. The slider cross-fades by adjusting the
  // after image's opacity over the before base. Default 0.5 = ghost view.
  const [overlayOpacity, setOverlayOpacity] = useState(initialOverlay);
  useEffect(() => { setOverlayOpacity(initialOverlay); }, [beforeUri, afterUri, initialOverlay]);

  if (!beforeUri || !afterUri) return null;

  const handleLayout = (e) => {
    const w = e.nativeEvent.layout.width;
    setContainerWidth(w);
    containerWidthRef.current = w;
  };

  // ----- Render: Side by Side -------------------------------------------------
  if (mode === 'side-by-side') {
    return (
      <View style={[styles.container, { aspectRatio }, style]} onLayout={handleLayout}>
        <View style={styles.sideHalf}>
          <Image source={{ uri: beforeUri }} style={styles.fullImage} resizeMode="contain" />
          {renderBeforeOverlay ? renderBeforeOverlay() : null}
        </View>
        <View style={styles.sideDivider} pointerEvents="none" />
        <View style={styles.sideHalf}>
          <Image source={{ uri: afterUri }} style={styles.fullImage} resizeMode="contain" />
          {renderAfterOverlay ? renderAfterOverlay() : null}
        </View>
      </View>
    );
  }

  // ----- Render: Overlay (ghost with opacity slider) -------------------------
  if (mode === 'overlay') {
    // Slider at the bottom of the frame overlays absolutely so the image
    // footprint stays identical to the other two modes. Sits inside the
    // aspect-ratio'd container.
    return (
      <View style={[styles.container, styles.containerColumn, { aspectRatio }, style]} onLayout={handleLayout}>
        {/* Base layer: BEFORE at full opacity */}
        <Image source={{ uri: beforeUri }} style={styles.absoluteImage} resizeMode="contain" />

        {/* Overlay layer: AFTER image only — opacity controlled by slider.
            At 0 → fully BEFORE visible; at 1 → fully AFTER visible. The
            labels are rendered OUTSIDE this opacity wrapper so they stay
            fully visible regardless of slider position. */}
        <View style={[styles.absoluteImage, { opacity: overlayOpacity }]} pointerEvents="none">
          <Image source={{ uri: afterUri }} style={styles.fullImage} resizeMode="contain" />
        </View>

        {/* Both labels render at full opacity, layered above all images. */}
        {renderBeforeOverlay ? renderBeforeOverlay() : null}
        {renderAfterOverlay ? renderAfterOverlay() : null}

        {/* Opacity slider pinned to the bottom of the frame */}
        <View style={styles.overlaySliderRow}>
          <Text style={styles.overlaySliderLabelLeft}>Before</Text>
          <Slider
            style={styles.overlaySlider}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            value={overlayOpacity}
            onValueChange={setOverlayOpacity}
            minimumTrackTintColor="#F2C31B"
            maximumTrackTintColor="rgba(255,255,255,0.45)"
            thumbTintColor="#F2C31B"
          />
          <Text style={styles.overlaySliderLabelRight}>After</Text>
        </View>
      </View>
    );
  }

  // ----- Render: Split (draggable divider) -----------------------------------
  const overlayWidthPct = splitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const dividerLeftPct = splitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={[styles.container, styles.containerColumn, { aspectRatio }, style]} onLayout={handleLayout}>
      <Image source={{ uri: beforeUri }} style={styles.absoluteImage} resizeMode="contain" />
      {renderBeforeOverlay ? renderBeforeOverlay() : null}

      <Animated.View style={[styles.splitOverlay, { width: overlayWidthPct }]} pointerEvents="none">
        <View style={[styles.splitOverlayInner, { width: containerWidth || '100%' }]}>
          <Image source={{ uri: afterUri }} style={styles.fullImage} resizeMode="contain" />
          {renderAfterOverlay ? renderAfterOverlay() : null}
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.splitDividerHitArea, { left: dividerLeftPct }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.splitDividerLine} pointerEvents="none" />
        <View style={styles.splitDividerKnob} pointerEvents="none">
          <Ionicons name="chevron-back" size={14} color="#000" />
          <Ionicons name="chevron-forward" size={14} color="#000" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 400,
    maxHeight: 400,
    alignSelf: 'center',
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F2C31B',
    flexDirection: 'row',
  },
  containerColumn: {
    flexDirection: 'column',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  absoluteImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },

  // Side-by-side ------------------------------------------------------------
  sideHalf: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  sideDivider: {
    width: 1,
    backgroundColor: '#FFFFFF',
  },

  // Overlay -----------------------------------------------------------------
  overlaySliderRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  overlaySlider: {
    flex: 1,
    marginHorizontal: 6,
  },
  overlaySliderLabelLeft: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  overlaySliderLabelRight: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Split -------------------------------------------------------------------
  splitOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  splitOverlayInner: {
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  splitDividerHitArea: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 56,
    marginLeft: -28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitDividerLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
  },
  splitDividerKnob: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
});

import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Animated,
  Text,
  TouchableOpacity,
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

  // Viewport mode — 'fit' (default 1:1, photos letterboxed) or 'wide' (16:9
  // frame, photos use cover so they fill the wider frame and crop top/bottom).
  // In wide mode users can drag vertically on the viewer to reframe (panY
  // shifts both photos in lockstep).
  const [wideMode, setWideMode] = useState(false);
  const panY = useRef(new Animated.Value(0)).current;
  const panYRef = useRef(0);
  useEffect(() => {
    const id = panY.addListener(({ value }) => { panYRef.current = value; });
    return () => panY.removeListener(id);
  }, [panY]);
  const panYStart = useRef(0);

  const aspectRatio = wideMode ? 16 / 9 : 1;
  const imageResize = wideMode ? 'cover' : 'contain';

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
  const wideModeRef = useRef(false);
  useEffect(() => { wideModeRef.current = wideMode; }, [wideMode]);

  const panResponder = useRef(
    PanResponder.create({
      // Split mode owns horizontal drags for the divider. Wide mode (in any
      // other mode) owns vertical drags to reframe both photos. We pick
      // direction by which delta is larger so both can coexist.
      onStartShouldSetPanResponder: () => modeRef.current === 'split',
      onMoveShouldSetPanResponder: (_, gs) => {
        if (modeRef.current === 'split' && Math.abs(gs.dx) >= Math.abs(gs.dy)) return true;
        if (wideModeRef.current && modeRef.current !== 'split' && Math.abs(gs.dy) > Math.abs(gs.dx)) return true;
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        dragStartRef.current = splitRef.current;
        panYStart.current = panYRef.current;
      },
      onPanResponderMove: (_, gs) => {
        // Split divider — horizontal drag
        if (modeRef.current === 'split' && Math.abs(gs.dx) >= Math.abs(gs.dy)) {
          const w = containerWidthRef.current;
          if (w <= 0) return;
          const dx = gs.dx / w;
          const next = Math.max(0, Math.min(1, dragStartRef.current + dx));
          splitAnim.setValue(next);
          return;
        }
        // Wide-mode reframe — vertical drag, clamped so users don't run the
        // photo entirely out of frame.
        if (wideModeRef.current) {
          const maxTravel = 200; // px from center; covers most portrait crops
          const next = Math.max(-maxTravel, Math.min(maxTravel, panYStart.current + gs.dy));
          panY.setValue(next);
        }
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

  // Toggle button — rendered in the top-right corner of every mode. Tap to
  // switch between fit (1:1 letterboxed) and wide (16:9 cover with vertical
  // pan to reframe both photos in lockstep). Reset panY back to 0 every time
  // the user turns wide mode off so the next entry starts centered.
  const toggleWide = () => {
    setWideMode((prev) => {
      const next = !prev;
      if (!next) panY.setValue(0);
      return next;
    });
  };
  const renderWideToggle = () => (
    <TouchableOpacity
      onPress={toggleWide}
      style={styles.wideToggle}
      activeOpacity={0.8}
    >
      <Ionicons
        name={wideMode ? 'contract-outline' : 'expand-outline'}
        size={16}
        color="#000"
      />
    </TouchableOpacity>
  );

  // Animated transform applied to both photos in wide mode so a vertical
  // drag pans the framing in lockstep — same offset before/after means
  // the comparison stays aligned.
  const panTransform = wideMode ? [{ translateY: panY }] : [];

  // ----- Render: Side by Side -------------------------------------------------
  if (mode === 'side-by-side') {
    return (
      <View
        style={[styles.container, { aspectRatio }, style]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.sideHalf}>
          <Animated.Image source={{ uri: beforeUri }} style={[styles.fullImage, { transform: panTransform }]} resizeMode={imageResize} />
          {renderBeforeOverlay ? renderBeforeOverlay() : null}
        </View>
        <View style={styles.sideDivider} pointerEvents="none" />
        <View style={styles.sideHalf}>
          <Animated.Image source={{ uri: afterUri }} style={[styles.fullImage, { transform: panTransform }]} resizeMode={imageResize} />
          {renderAfterOverlay ? renderAfterOverlay() : null}
        </View>
        {renderWideToggle()}
      </View>
    );
  }

  // ----- Render: Overlay (ghost with opacity slider) -------------------------
  if (mode === 'overlay') {
    // Slider at the bottom of the frame overlays absolutely so the image
    // footprint stays identical to the other two modes. Sits inside the
    // aspect-ratio'd container.
    return (
      <View
        style={[styles.container, styles.containerColumn, { aspectRatio }, style]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        {/* Base layer: BEFORE at full opacity */}
        <Animated.Image source={{ uri: beforeUri }} style={[styles.absoluteImage, { transform: panTransform }]} resizeMode={imageResize} />

        {/* Overlay layer: AFTER image only — opacity controlled by slider.
            At 0 → fully BEFORE visible; at 1 → fully AFTER visible. The
            labels are rendered OUTSIDE this opacity wrapper so they stay
            fully visible regardless of slider position. */}
        <View style={[styles.absoluteImage, { opacity: overlayOpacity }]} pointerEvents="none">
          <Animated.Image source={{ uri: afterUri }} style={[styles.fullImage, { transform: panTransform }]} resizeMode={imageResize} />
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

        {renderWideToggle()}
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
    <View
      style={[styles.container, styles.containerColumn, { aspectRatio }, style]}
      onLayout={handleLayout}
      {...panResponder.panHandlers}
    >
      <Animated.Image source={{ uri: beforeUri }} style={[styles.absoluteImage, { transform: panTransform }]} resizeMode={imageResize} />

      {/* AFTER image inside a divider-clipped overlay. Labels render OUTSIDE
          this clip (below) so the divider position never hides them. */}
      <Animated.View style={[styles.splitOverlay, { width: overlayWidthPct }]} pointerEvents="none">
        <View style={[styles.splitOverlayInner, { width: containerWidth || '100%' }]}>
          <Animated.Image source={{ uri: afterUri }} style={[styles.fullImage, { transform: panTransform }]} resizeMode={imageResize} />
        </View>
      </Animated.View>

      {/* Both labels render at the frame level above the clip, so the After
          label stays put regardless of where the divider sits. */}
      {renderBeforeOverlay ? renderBeforeOverlay() : null}
      {renderAfterOverlay ? renderAfterOverlay() : null}

      <Animated.View
        style={[styles.splitDividerHitArea, { left: dividerLeftPct }]}
        pointerEvents="none"
      >
        <View style={styles.splitDividerLine} pointerEvents="none" />
        <View style={styles.splitDividerKnob} pointerEvents="none">
          <Ionicons name="chevron-back" size={14} color="#000" />
          <Ionicons name="chevron-forward" size={14} color="#000" />
        </View>
      </Animated.View>

      {renderWideToggle()}
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

  // Viewport-shape toggle pinned to the top-right corner of every mode.
  wideToggle: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
});

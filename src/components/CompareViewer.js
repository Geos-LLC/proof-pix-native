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
  // Template-driven frame aspect ratio. Default 1 keeps the existing
  // square frame; pair preview passes 16/9, 2/1, etc. based on the
  // user's "Choose Template" selection so the live preview matches the
  // share output.
  frameAspectRatio: frameAspectRatioProp,
  // Stack vs side-by-side layout hint for stack templates (landscape
  // photos). Default 'sidebyside' keeps existing behavior. 'stack' renders
  // before above after in the same frame (only relevant for split / pair
  // modes — overlay/side-by-side use their own layouts).
  templateLayout = 'sidebyside',
}) {
  const beforeUri = beforePhoto?.uri;
  const afterUri = afterPhoto?.uri;

  // Pan + zoom values shared between both photos so the comparison stays
  // aligned. Single-finger drag updates panX/panY (always available).
  // Two-finger pinch updates scale, clamped 0.5×–3×.
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  useEffect(() => {
    const idX = panX.addListener(({ value }) => { panXRef.current = value; });
    const idY = panY.addListener(({ value }) => { panYRef.current = value; });
    return () => { panX.removeListener(idX); panY.removeListener(idY); };
  }, [panX, panY]);
  const panXStart = useRef(0);
  const panYStart = useRef(0);

  const scale = useRef(new Animated.Value(1)).current;
  const scaleRef = useRef(1);
  useEffect(() => {
    const id = scale.addListener(({ value }) => { scaleRef.current = value; });
    return () => scale.removeListener(id);
  }, [scale]);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);

  // Frame aspect ratio is driven by the parent (template picker). Default
  // 1:1 keeps the previous behavior. Photos letterbox inside the frame so
  // pinch-zoom and pan still give the user full control over what's shown.
  const aspectRatio = typeof frameAspectRatioProp === 'number' && frameAspectRatioProp > 0
    ? frameAspectRatioProp
    : 1;
  const imageResize = 'contain';

  const distanceBetween = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

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

  // Long-press arm for 1-finger drag. Matches PannableImage so the gesture
  // model is consistent across single-photo and compare previews.
  const LONG_PRESS_MS = 350;
  const dragArmedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const [dragArmed, setDragArmed] = useState(false);

  const armDrag = () => { dragArmedRef.current = true; setDragArmed(true); };
  const cancelArm = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    dragArmedRef.current = false;
    setDragArmed(false);
  };

  // Outer-frame PanResponder — pinch (2-finger) always; 1-finger drag only
  // after the long-press timer has armed it. Split's divider drag lives on
  // the circular knob (knobPanResponder below).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (evt, gs) => {
        if (evt.nativeEvent.touches.length === 2) return true;
        if (dragArmedRef.current) return true;
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        panXStart.current = panXRef.current;
        panYStart.current = panYRef.current;
        if (evt.nativeEvent.touches.length === 2) {
          pinchStartDistRef.current = distanceBetween(evt.nativeEvent.touches);
          pinchStartScaleRef.current = scaleRef.current;
          cancelArm();
        }
      },
      onPanResponderMove: (evt, gs) => {
        if (evt.nativeEvent.touches.length === 2) {
          const dist = distanceBetween(evt.nativeEvent.touches);
          if (pinchStartDistRef.current > 0 && dist > 0) {
            const ratio = dist / pinchStartDistRef.current;
            const next = Math.max(0.5, Math.min(3, pinchStartScaleRef.current * ratio));
            scale.setValue(next);
          }
          return;
        }
        const maxTravel = 300;
        panX.setValue(Math.max(-maxTravel, Math.min(maxTravel, panXStart.current + gs.dx)));
        panY.setValue(Math.max(-maxTravel, Math.min(maxTravel, panYStart.current + gs.dy)));
      },
      onPanResponderRelease: () => {
        pinchStartDistRef.current = 0;
        cancelArm();
      },
      onPanResponderTerminate: () => {
        pinchStartDistRef.current = 0;
        cancelArm();
      },
    })
  ).current;

  const handleTouchStart = () => {
    cancelArm();
    longPressTimerRef.current = setTimeout(armDrag, LONG_PRESS_MS);
  };
  const handleTouchMove = () => { if (!dragArmedRef.current) cancelArm(); };
  const handleTouchEnd = () => { cancelArm(); };

  // Dedicated PanResponder for the split divider knob. Only attaches to the
  // knob's hit area, so dragging anywhere else in the frame goes to the pan/
  // pinch responder above. Horizontal motion translates to splitAnim 0..1.
  const dragStartRef = useRef(initialSplit);
  const knobPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => modeRef.current === 'split',
      onMoveShouldSetPanResponder: () => modeRef.current === 'split',
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

  // Reset button — top-right corner of every mode. Tap to return both photos
  // to their default framing: scale=1, panX=panY=0. Replaces the previous
  // "wide" aspect toggle since pinch already gives the user zoom control.
  const resetPanZoom = () => {
    panX.setValue(0);
    panY.setValue(0);
    scale.setValue(1);
  };
  const renderResetButton = () => (
    <TouchableOpacity
      onPress={resetPanZoom}
      style={styles.wideToggle}
      activeOpacity={0.8}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="refresh-outline" size={16} color="#000" />
    </TouchableOpacity>
  );

  // Animated transform applied to both photos in lockstep — same translate
  // and scale on before/after keeps the comparison aligned.
  const panTransform = [
    { translateX: panX },
    { translateY: panY },
    { scale },
  ];

  // ----- Render: Side by Side -------------------------------------------------
  if (mode === 'side-by-side') {
    return (
      <View
        style={[styles.container, { aspectRatio }, style]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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
        {renderResetButton()}
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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

        {renderResetButton()}
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
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
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

      {/* Divider stays visible across the whole frame, but only the circular
          knob captures touch — knobPanResponder attaches just to the knob.
          Drags anywhere else in the frame fall through to the outer
          pan/pinch responder, so photos can be panned/zoomed without
          accidentally moving the divider. */}
      <Animated.View
        style={[styles.splitDividerHitArea, { left: dividerLeftPct }]}
        pointerEvents="box-none"
      >
        <View style={styles.splitDividerLine} pointerEvents="none" />
        <View style={styles.splitDividerKnob} {...knobPanResponder.panHandlers}>
          <Ionicons name="chevron-back" size={14} color="#000" />
          <Ionicons name="chevron-forward" size={14} color="#000" />
        </View>
      </Animated.View>

      {renderResetButton()}
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

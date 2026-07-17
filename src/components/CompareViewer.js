import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Image,
  StyleSheet,
  PanResponder,
  Animated,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useTheme } from '../hooks/useTheme';

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
  // Which axis the split/overlay divider runs on. 'vertical' (default) =
  // vertical line, BEFORE on the left / AFTER on the right — matches
  // portrait combined photos. 'horizontal' = horizontal line, BEFORE on
  // top / AFTER on the bottom — used for landscape combined photos so
  // the two halves each see a wide-format image instead of a squished
  // vertical strip.
  dividerOrientation = 'vertical',
}) {
  const isHorizontal = dividerOrientation === 'horizontal';
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
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
  // Side-by-side renders each photo into its own half so 'contain' there
  // keeps each picture undistorted. Split + Overlay share one viewport,
  // and we want the "original photo, framed to format" UX — same as
  // PannableImage. We measure the BEFORE bitmap, size the rendered
  // element so it covers the frame in one dimension and overflows the
  // other, then let pan/zoom move that overflow into view. Both before
  // and after share the BEFORE photo's natural aspect so the comparison
  // stays aligned. resizeMode is unused for the sized split/overlay
  // elements (we render at the bitmap's aspect with stretch).
  const isFramed = mode === 'split' || mode === 'overlay';
  const imageResize = isFramed ? 'cover' : 'contain';

  const distanceBetween = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Container measurements and bitmap size of the BEFORE photo. We use
  // these to compute a "cover-fit with overflow" element size for split
  // and overlay modes — same trick PannableImage uses to give the user a
  // natural pan-around-the-photo feel.
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [bitmapSize, setBitmapSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!beforeUri) return;
    let cancelled = false;
    Image.getSize(
      beforeUri,
      (w, h) => { if (!cancelled) setBitmapSize({ w, h }); },
      () => { /* fall back to wrapper-sized element until size resolves */ },
    );
    return () => { cancelled = true; };
  }, [beforeUri]);

  // Element size that the BEFORE photo (and the AFTER overlay, aligned
  // to it) renders at. Picks the dimension that needs to overflow so the
  // bitmap's natural aspect is preserved AND the frame is fully covered
  // at scale=1. Falls back to 100%-of-container until both measurements
  // are known so the photo doesn't pop on mount.
  const elementSize = useMemo(() => {
    const wW = containerSize.w;
    const wH = containerSize.h;
    const bW = bitmapSize.w;
    const bH = bitmapSize.h;
    if (!wW || !wH || !bW || !bH) return { w: 0, h: 0 };
    const bA = bW / bH;
    const wA = wW / wH;
    if (bA > wA) return { w: wH * bA, h: wH };
    return { w: wW, h: wW / bA };
  }, [containerSize, bitmapSize]);
  const elementSizeRef = useRef({ w: 0, h: 0 });
  useEffect(() => { elementSizeRef.current = elementSize; }, [elementSize]);

  // Pan clamping that keeps at least one edge of the rendered element
  // touching the viewport. Same scheme PannableImage uses. Falls back to
  // the legacy ±300px clamp when we haven't measured yet.
  const clampPanX = (raw, s) => {
    const es = elementSizeRef.current;
    if (!es.w || !containerSize.w) return Math.max(-300, Math.min(300, raw));
    const max = Math.max(0, (es.w * s - containerSize.w) / 2);
    return Math.max(-max, Math.min(max, raw));
  };
  const clampPanY = (raw, s) => {
    const es = elementSizeRef.current;
    if (!es.h || !containerSize.h) return Math.max(-300, Math.min(300, raw));
    const max = Math.max(0, (es.h * s - containerSize.h) / 2);
    return Math.max(-max, Math.min(max, raw));
  };

  // Reset transforms whenever the viewport or bitmap changes, so a new
  // photo / new format starts at the natural framing.
  useEffect(() => {
    panX.setValue(0);
    panY.setValue(0);
    scale.setValue(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize.w, containerSize.h, bitmapSize.w, bitmapSize.h]);

  // Legacy alias kept for the split-knob math below — same value as
  // containerSize.w, just exposed under the old name and ref.
  const containerWidth = containerSize.w;
  const containerWidthRef = useRef(0);
  // Mirror for the horizontal-divider math (dy / containerHeight).
  const containerHeightRef = useRef(0);

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
            // Re-clamp pan against the new scale so zooming out doesn't
            // leave the photo offset beyond its new natural overflow.
            if (isFramed) {
              panX.setValue(clampPanX(panXRef.current, next));
              panY.setValue(clampPanY(panYRef.current, next));
            }
          }
          return;
        }
        // Scale-aware clamping in split/overlay so the user can pan up to
        // the natural overflow of the photo and no further (cleaner UX
        // than the legacy ±300px slab). Side-by-side falls back to the
        // legacy clamp because it has no shared element.
        if (isFramed) {
          panX.setValue(clampPanX(panXStart.current + gs.dx, scaleRef.current));
          panY.setValue(clampPanY(panYStart.current + gs.dy, scaleRef.current));
        } else {
          const maxTravel = 300;
          panX.setValue(Math.max(-maxTravel, Math.min(maxTravel, panXStart.current + gs.dx)));
          panY.setValue(Math.max(-maxTravel, Math.min(maxTravel, panYStart.current + gs.dy)));
        }
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
  // pinch responder above. Motion on the divider's own axis (dx for
  // vertical divider, dy for horizontal) translates to splitAnim 0..1.
  // Single-finger only — two-finger touches fall through to the outer
  // pinch responder so zoom still works even when the enlarged hit area
  // overlaps the pinch target.
  const dragStartRef = useRef(initialSplit);
  const isHorizontalRef = useRef(isHorizontal);
  useEffect(() => { isHorizontalRef.current = isHorizontal; }, [isHorizontal]);
  const knobPanResponder = useRef(
    PanResponder.create({
      // CAPTURE-phase claim keeps the knob's drag from ever being handed
      // to an ancestor (Studio's swipe-navigate responder used to steal
      // it the moment the finger moved horizontally, which the user saw
      // as "the whole screen slides instead of the divider").
      onStartShouldSetPanResponderCapture: (evt) =>
        modeRef.current === 'split' && evt.nativeEvent.touches.length <= 1,
      onMoveShouldSetPanResponderCapture: (evt) =>
        modeRef.current === 'split' && evt.nativeEvent.touches.length <= 1,
      onStartShouldSetPanResponder: (evt) =>
        modeRef.current === 'split' && evt.nativeEvent.touches.length <= 1,
      onMoveShouldSetPanResponder: (evt) =>
        modeRef.current === 'split' && evt.nativeEvent.touches.length <= 1,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => { dragStartRef.current = splitRef.current; },
      onPanResponderMove: (_, gs) => {
        if (isHorizontalRef.current) {
          const h = containerHeightRef.current;
          if (h <= 0) return;
          const dy = gs.dy / h;
          const next = Math.max(0, Math.min(1, dragStartRef.current + dy));
          splitAnim.setValue(next);
        } else {
          const w = containerWidthRef.current;
          if (w <= 0) return;
          const dx = gs.dx / w;
          const next = Math.max(0, Math.min(1, dragStartRef.current + dx));
          splitAnim.setValue(next);
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
    const { width, height } = e.nativeEvent.layout;
    setContainerSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    containerWidthRef.current = width;
    containerHeightRef.current = height;
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

  // Style for the sized split/overlay element. Once we have both wrapper
  // and bitmap measurements, the element gets its real pixel size and is
  // centered absolutely so pan/scale animate it within the overflow.
  // Until then, fall back to absoluteFill + the resizeMode prop so the
  // photo doesn't pop in at a wrong scale on first paint.
  const framedSizedStyle = elementSize.w && elementSize.h
    ? {
        position: 'absolute',
        width: elementSize.w,
        height: elementSize.h,
        left: (containerSize.w - elementSize.w) / 2,
        top: (containerSize.h - elementSize.h) / 2,
      }
    : null;
  const framedResizeMode = framedSizedStyle ? 'stretch' : imageResize;

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
        {/* Base layer: BEFORE at full opacity. Sized to the bitmap's
            natural aspect so pan/zoom reveals the overflow instead of
            stretching the picture. */}
        <Animated.Image
          source={{ uri: beforeUri }}
          style={[framedSizedStyle || styles.absoluteImage, { transform: panTransform }]}
          resizeMode={framedResizeMode}
        />

        {/* Overlay layer: AFTER image only — opacity controlled by slider.
            At 0 → fully BEFORE visible; at 1 → fully AFTER visible. The
            labels are rendered OUTSIDE this opacity wrapper so they stay
            fully visible regardless of slider position. After uses the
            same sized style as the base so the two stay aligned. */}
        <View style={[styles.absoluteImage, { opacity: overlayOpacity }]} pointerEvents="none">
          <Animated.Image
            source={{ uri: afterUri }}
            style={[framedSizedStyle || styles.fullImage, { transform: panTransform }]}
            resizeMode={framedResizeMode}
          />
        </View>

        {/* Both labels render at full opacity, layered above all images. */}
        {renderBeforeOverlay ? renderBeforeOverlay() : null}
        {renderAfterOverlay ? renderAfterOverlay() : null}

        {/* Opacity slider pinned to the bottom of the frame. The row is
            deliberately tall (44pt) so the slider's tap band is the full
            iOS finger-friendly target; tapToSeek lets the user tap
            anywhere along the track and jump the thumb there instead of
            having to grab the tiny circle. */}
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
            tapToSeek
          />
          <Text style={styles.overlaySliderLabelRight}>After</Text>
        </View>

        {renderResetButton()}
      </View>
    );
  }

  // ----- Render: Split (draggable divider) -----------------------------------
  // Interpolations shared for both orientations — the axis they apply to
  // is different (width vs height / left vs top) but the 0..1 range is
  // the same.
  const overlaySizePct = splitAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const dividerPosPct = splitAnim.interpolate({
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
      {/* Base = AFTER fills the whole frame. The BEFORE overlay clips it
          from the leading edge up to the divider, so LEFT/TOP of divider
          = BEFORE and RIGHT/BOTTOM of divider = AFTER (the conventional
          reading order — left→right for portrait pairs, top→bottom for
          landscape pairs). Both images render at the BEFORE bitmap's
          natural aspect (via framedSizedStyle) so pan/zoom reveals the
          photo's real overflow instead of just sliding a flat crop. */}
      <Animated.Image
        source={{ uri: afterUri }}
        style={[framedSizedStyle || styles.absoluteImage, { transform: panTransform }]}
        resizeMode={framedResizeMode}
      />

      <Animated.View
        style={[
          isHorizontal ? styles.splitOverlayH : styles.splitOverlay,
          isHorizontal ? { height: overlaySizePct } : { width: overlaySizePct },
        ]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.splitOverlayInner,
            { width: containerWidth || '100%', height: containerSize.h || '100%' },
          ]}
        >
          <Animated.Image
            source={{ uri: beforeUri }}
            style={[framedSizedStyle || styles.fullImage, { transform: panTransform }]}
            resizeMode={framedResizeMode}
          />
        </View>
      </Animated.View>

      {/* Both labels render at the frame level above the clip, so the After
          label stays put regardless of where the divider sits. */}
      {renderBeforeOverlay ? renderBeforeOverlay() : null}
      {renderAfterOverlay ? renderAfterOverlay() : null}

      {/* Divider stays visible across the whole frame. The hit area is a
          fat band centered on the divider (80px thick) so the user can
          drag anywhere near the knob — not just on the tiny circle
          itself. knobPanResponder lives on the hit area, so single-
          finger drags there move the divider while two-finger pinches
          fall through to the outer pan/pinch responder for zoom. */}
      <Animated.View
        style={[
          isHorizontal ? styles.splitDividerHitAreaH : styles.splitDividerHitArea,
          isHorizontal ? { top: dividerPosPct } : { left: dividerPosPct },
        ]}
        {...knobPanResponder.panHandlers}
      >
        <View
          style={isHorizontal ? styles.splitDividerLineH : styles.splitDividerLine}
          pointerEvents="none"
        />
        <View
          style={[styles.splitDividerKnob, isHorizontal && styles.splitDividerKnobColumn]}
          pointerEvents="none"
        >
          <Ionicons name={isHorizontal ? 'chevron-up' : 'chevron-back'} size={14} color="#000" />
          <Ionicons name={isHorizontal ? 'chevron-down' : 'chevron-forward'} size={14} color="#000" />
        </View>
      </Animated.View>

      {renderResetButton()}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
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
    minHeight: 44,
  },
  overlaySlider: {
    flex: 1,
    marginHorizontal: 6,
    height: 40,
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

  // Split (vertical divider — portrait combined photos) --------------------
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
    width: 80,
    marginLeft: -40,
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

  // Split (horizontal divider — landscape combined photos) ----------------
  splitOverlayH: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  splitDividerHitAreaH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 80,
    marginTop: -40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitDividerLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFFFFF',
  },

  splitDividerKnob: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  splitDividerKnobColumn: {
    flexDirection: 'column',
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

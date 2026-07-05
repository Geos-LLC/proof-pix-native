import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, Image, Animated, PanResponder, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Image wrapper that gives the user pinch-to-zoom, single-finger pan, and a
 * reset button — same gesture model as CompareViewer's photo manipulation
 * but for screens that show a SINGLE photo (HomeScreen + GalleryScreen
 * full-screen previews).
 *
 *   - Two-finger pinch  → scale clamped 0.5×–3×
 *   - Single-finger drag → translate X+Y bounded to ±300px
 *   - Reset button (top-right) → back to scale=1, pan=0,0
 *
 * Accepts a subset of <Image> props. children are rendered on top of the
 * image (used for label overlays).
 */
export default function PannableImage({
  source,
  style,
  imageStyle,
  resizeMode = 'contain',
  onError,
  onLoad,
  onLoadStart,
  imageKey,
  children,
  onDoubleTap, // Tap twice within 250ms without significant movement
  showResetButton = true,
  // Default = require a long-press before single-finger pan claims the
  // responder. HomeScreen/Gallery need this because they're inside a
  // horizontal carousel — without the gate, every drag would steal from
  // ScrollView. Studio has no carousel, so it passes false for immediate
  // drag-to-pan.
  panOnLongPress = true,
  // When true, ALL gestures are off — used by Studio while the Markup
  // tool is active so drawing on the photo isn't competing with pan or
  // pinch. Transforms are also reset to neutral so the picture is
  // stationary while the user annotates.
  disabled = false,
  // Optional style override for the reset button. Callers that render
  // this component below a translucent status bar (e.g. fullscreen
  // viewer) pass `{ top: insets.top + 8 }` so the reset icon aligns
  // with the sibling X close button that also lives at insets.top + 8.
  resetBtnStyle,
}) {
  // Mirror props that the (one-shot) PanResponder needs to consult at
  // runtime. PanResponder.create() is wrapped in useRef and so captures
  // only the FIRST render's closure — without these refs, the `disabled`
  // and `panOnLongPress` props can never actually change behaviour after
  // mount. That was the reason Studio's Markup tool got starved of
  // touches: PannableImage was still claiming them because its
  // `disabled` closure was forever stuck at the mount-time value.
  const disabledRef = useRef(disabled);
  const panOnLongPressRef = useRef(panOnLongPress);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { panOnLongPressRef.current = panOnLongPress; }, [panOnLongPress]);

  // Two-tap detection for the "preview → bare fullscreen" toggle. Records
  // the timestamp of each touch end; a second touch end within DOUBLE_TAP_MS
  // (and without exceeding the 8px drag threshold during either touch)
  // triggers onDoubleTap.
  const DOUBLE_TAP_MS = 280;
  const lastTapAtRef = useRef(0);
  const tapMovedRef = useRef(false);
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const panXRef = useRef(0);
  const panYRef = useRef(0);
  const scaleRef = useRef(1);

  // Wrapper (viewport) and bitmap dimensions, both measured async — wrapper
  // via onLayout, bitmap via Image.getSize. We need both to size the image
  // element so that the actual picture is larger than the viewport in one
  // dimension. That way panning reveals more of the bitmap instead of
  // sliding a fixed crop over empty space.
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });
  const [bitmapSize, setBitmapSize] = useState({ w: 0, h: 0 });
  const elementSizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const uri = source?.uri;
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => { if (!cancelled) setBitmapSize({ w, h }); },
      () => { /* swallow — onError on the rendered <Image> will surface it */ },
    );
    return () => { cancelled = true; };
  }, [source?.uri]);

  // Element size: large enough that the bitmap, drawn at its natural aspect
  // ratio, completely covers the viewport in one dimension and overflows the
  // other. The overflow is what gets panned across.
  const elementSize = useMemo(() => {
    const wW = wrapperSize.w;
    const wH = wrapperSize.h;
    const bW = bitmapSize.w;
    const bH = bitmapSize.h;
    if (!wW || !wH || !bW || !bH) return { w: wW || 0, h: wH || 0 };
    const bitmapAspect = bW / bH;
    const wrapperAspect = wW / wH;
    if (bitmapAspect > wrapperAspect) {
      // Picture is wider than the viewport → fit by height, overflow width.
      return { w: wH * bitmapAspect, h: wH };
    }
    // Picture is taller (or same) → fit by width, overflow height.
    return { w: wW, h: wW / bitmapAspect };
  }, [wrapperSize, bitmapSize]);

  useEffect(() => {
    elementSizeRef.current = elementSize;
  }, [elementSize]);

  // When the viewport changes (e.g. user picks a different format chip) or
  // the bitmap changes (new photo), reset transforms so the picture comes
  // back to centered + cover-fit instead of staying at a stale crop.
  useEffect(() => {
    panX.setValue(0);
    panY.setValue(0);
    scale.setValue(1);
  }, [wrapperSize.w, wrapperSize.h, bitmapSize.w, bitmapSize.h, panX, panY, scale]);

  // Whenever the host disables gestures (e.g. Studio enters Markup mode),
  // snap the picture back to neutral so the markup the user draws is
  // aligned against the picture's natural frame.
  useEffect(() => {
    if (disabled) {
      panX.setValue(0);
      panY.setValue(0);
      scale.setValue(1);
    }
  }, [disabled, panX, panY, scale]);

  // Clamp pan to keep at least one image edge touching the viewport.
  // At scale s, rendered size = elementSize * s. Max pan in each axis is
  // (rendered - viewport) / 2, or 0 if rendered fits within viewport
  // (letterboxed — user has scaled down).
  const clampPanX = (raw, s) => {
    const max = Math.max(0, (elementSizeRef.current.w * s - wrapperSize.w) / 2);
    return Math.max(-max, Math.min(max, raw));
  };
  const clampPanY = (raw, s) => {
    const max = Math.max(0, (elementSizeRef.current.h * s - wrapperSize.h) / 2);
    return Math.max(-max, Math.min(max, raw));
  };

  const onWrapperLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setWrapperSize((prev) => {
      if (prev.w === width && prev.h === height) return prev;
      return { w: width, h: height };
    });
  };

  useEffect(() => {
    const idX = panX.addListener(({ value }) => { panXRef.current = value; });
    const idY = panY.addListener(({ value }) => { panYRef.current = value; });
    const idS = scale.addListener(({ value }) => { scaleRef.current = value; });
    return () => {
      panX.removeListener(idX);
      panY.removeListener(idY);
      scale.removeListener(idS);
    };
  }, [panX, panY, scale]);

  const panXStart = useRef(0);
  const panYStart = useRef(0);
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  // Tracks whether the in-flight gesture is currently a 2-finger pinch.
  // We need this because the user can start with 1 finger (claiming the
  // responder for pan) and then add a 2nd finger — we have to detect that
  // transition and initialize the pinch baseline at that moment, not just
  // at onPanResponderGrant.
  const pinchingRef = useRef(false);

  const distanceBetween = (touches) => {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Long-press timing for "arm drag" — the user must hold a finger on the
  // image for LONG_PRESS_MS before single-finger drag pans the photo.
  // Anything shorter passes through to the parent ScrollView so left/right
  // swipes still navigate between photos in the carousel.
  const LONG_PRESS_MS = 350;
  const dragArmedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const [dragArmed, setDragArmed] = useState(false);

  const armDrag = () => {
    dragArmedRef.current = true;
    setDragArmed(true);
    // Short tactile pulse so the user feels exactly when drag becomes
    // available. Android honours the duration; iOS plays its default
    // short vibration. Built into RN so no native dependency to ship.
    try { Vibration.vibrate(20); } catch (_) {}
  };
  const cancelArm = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    dragArmedRef.current = false;
    setDragArmed(false);
  };

  const panResponder = useRef(
    PanResponder.create({
      // Pinch (2-finger) always wins from the start. Single-finger gestures
      // do NOT claim the responder by default — they fall through to the
      // parent ScrollView so a horizontal flick still navigates photos.
      // The responder only claims a 1-finger drag once the long-press timer
      // has armed it.
      onStartShouldSetPanResponder: (evt) => {
        if (disabledRef.current) return false;
        // 2-finger pinch always claims. When pan is immediate (Studio
        // mode), 1-finger touches also claim from the start so drag works
        // without waiting for a long-press.
        if (evt.nativeEvent.touches.length === 2) return true;
        if (!panOnLongPressRef.current) return true;
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gs) => {
        if (disabledRef.current) return false;
        if (evt.nativeEvent.touches.length === 2) return true;
        if (!panOnLongPressRef.current) return true;
        if (dragArmedRef.current) return true;
        return false;
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        panXStart.current = panXRef.current;
        panYStart.current = panYRef.current;
        if (evt.nativeEvent.touches.length === 2) {
          pinchStartDist.current = distanceBetween(evt.nativeEvent.touches);
          pinchStartScale.current = scaleRef.current;
          cancelArm();
        }
      },
      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches.length;
        if (touches === 2) {
          // Entering pinch (just placed 2nd finger, or starting fresh).
          // Capture the baseline distance + scale so the first frame
          // doesn't apply a wild ratio.
          if (!pinchingRef.current) {
            pinchingRef.current = true;
            pinchStartDist.current = distanceBetween(evt.nativeEvent.touches);
            pinchStartScale.current = scaleRef.current;
            return;
          }
          const dist = distanceBetween(evt.nativeEvent.touches);
          if (pinchStartDist.current > 0 && dist > 0) {
            const ratio = dist / pinchStartDist.current;
            const nextScale = Math.max(0.5, Math.min(3, pinchStartScale.current * ratio));
            scale.setValue(nextScale);
            // Re-clamp pan as scale shrinks the rendered image below the
            // current pan extent (otherwise the user can pan further than
            // the new rendered image allows).
            panX.setValue(clampPanX(panXRef.current, nextScale));
            panY.setValue(clampPanY(panYRef.current, nextScale));
          }
          return;
        }
        // Single-finger pan. If we were just pinching and one finger
        // lifted, rebase the pan-start to the current pan so the picture
        // doesn't jump.
        if (pinchingRef.current) {
          pinchingRef.current = false;
          panXStart.current = panXRef.current;
          panYStart.current = panYRef.current;
          return;
        }
        panX.setValue(clampPanX(panXStart.current + gs.dx, scaleRef.current));
        panY.setValue(clampPanY(panYStart.current + gs.dy, scaleRef.current));
      },
      onPanResponderRelease: () => {
        pinchStartDist.current = 0;
        pinchingRef.current = false;
        cancelArm();
      },
      onPanResponderTerminate: () => {
        pinchStartDist.current = 0;
        pinchingRef.current = false;
        cancelArm();
      },
    })
  ).current;

  // Touch handlers on the wrapper View arm the long-press. We use
  // onTouchStart to schedule a 350ms timer, and onTouchEnd / onTouchMove
  // to cancel it once the finger has moved more than a small jitter
  // threshold. This runs in parallel with the PanResponder gate above.
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const TOUCH_JITTER_PX = 10;
  const handleTouchStart = (e) => {
    cancelArm();
    tapMovedRef.current = false;
    const t = e.nativeEvent?.touches?.[0];
    touchStartXRef.current = t?.pageX || 0;
    touchStartYRef.current = t?.pageY || 0;
    // No long-press timer when disabled — otherwise the user would feel
    // the drag-armed vibration even in Markup / other locked modes.
    if (disabledRef.current) return;
    longPressTimerRef.current = setTimeout(armDrag, LONG_PRESS_MS);
  };
  const handleTouchMove = (e) => {
    // Finger jitter under TOUCH_JITTER_PX doesn't count as movement —
    // otherwise the long-press never arms because every touch has a few
    // pixels of natural shake before the user actually intends to drag.
    const t = e.nativeEvent?.touches?.[0];
    if (!t) return;
    const dx = (t.pageX || 0) - touchStartXRef.current;
    const dy = (t.pageY || 0) - touchStartYRef.current;
    if (Math.sqrt(dx * dx + dy * dy) < TOUCH_JITTER_PX) return;
    tapMovedRef.current = true;
    if (!dragArmedRef.current) cancelArm();
  };
  const handleTouchEnd = () => {
    cancelArm();
    // Double-tap detection: only fires when the user genuinely tapped
    // (no significant movement) and a previous tap was recent.
    if (!tapMovedRef.current && onDoubleTap) {
      const now = Date.now();
      if (now - lastTapAtRef.current <= DOUBLE_TAP_MS) {
        lastTapAtRef.current = 0;
        onDoubleTap();
      } else {
        lastTapAtRef.current = now;
      }
    }
  };

  const reset = () => {
    panX.setValue(0);
    panY.setValue(0);
    scale.setValue(1);
  };

  const transform = [
    { translateX: panX },
    { translateY: panY },
    { scale },
  ];

  // The image element is sized to the bitmap's natural aspect so the
  // wrapper acts as a true viewport: at scale 1 the picture exactly covers
  // the viewport in one dimension and overflows the other; panning shifts
  // the overflow into view. Until we know bitmap size we render with the
  // fallback (wrapper-sized) so the photo doesn't pop.
  const sizedStyle = elementSize.w && elementSize.h
    ? { width: elementSize.w, height: elementSize.h }
    : { width: '100%', height: '100%' };

  return (
    <View
      // `pointerEvents="none"` when disabled lets touches fall right
      // through PannableImage to the parent. That's what makes the
      // Studio Markup tool work — the photoFrame's markup responder
      // gets the gesture without competing with PannableImage at all.
      pointerEvents={disabled ? 'none' : 'auto'}
      style={[styles.wrapper, style, dragArmed && styles.wrapperArmed]}
      onLayout={onWrapperLayout}
      {...panResponder.panHandlers}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Image + children share a single transformed Animated.View so
          on-photo overlays (labels, watermark, metadata caption,
          markup) scale and translate WITH the picture during pinch /
          pan instead of staying anchored to the wrapper. The reset
          button stays outside this transform so it remains fixed in
          the corner regardless of the zoom level. */}
      <Animated.View style={[sizedStyle, { transform }]}>
        <Animated.Image
          key={imageKey}
          source={source}
          style={[{ width: '100%', height: '100%' }, imageStyle]}
          // Element matches the bitmap's aspect, so the picture fills it
          // without internal letterbox or crop regardless of resizeMode.
          // 'stretch' is the safest choice in that case.
          resizeMode={elementSize.w && elementSize.h ? 'stretch' : resizeMode}
          onError={onError}
          onLoad={onLoad}
          onLoadStart={onLoadStart}
        />
        {children}
      </Animated.View>
      {showResetButton && (
        <TouchableOpacity
          style={[styles.resetBtn, resetBtnStyle]}
          onPress={reset}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="refresh-outline" size={16} color="#000" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrapperArmed: {
    // Subtle visual cue that long-press has armed drag mode. The yellow
    // border tells the user "you can now drag this photo around".
    borderWidth: 2,
    borderColor: '#F2C31B',
    borderRadius: 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  resetBtn: {
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

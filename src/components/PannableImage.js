import React, { useRef, useEffect, useState } from 'react';
import { View, Animated, PanResponder, StyleSheet, TouchableOpacity } from 'react-native';
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
}) {
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
          pinchStartDist.current = distanceBetween(evt.nativeEvent.touches);
          pinchStartScale.current = scaleRef.current;
          cancelArm();
        }
      },
      onPanResponderMove: (evt, gs) => {
        if (evt.nativeEvent.touches.length === 2) {
          const dist = distanceBetween(evt.nativeEvent.touches);
          if (pinchStartDist.current > 0 && dist > 0) {
            const ratio = dist / pinchStartDist.current;
            scale.setValue(Math.max(0.5, Math.min(3, pinchStartScale.current * ratio)));
          }
          return;
        }
        // Single-finger move only reaches here after dragArmedRef became
        // true (long-press completed). Pan the image.
        const max = 300;
        panX.setValue(Math.max(-max, Math.min(max, panXStart.current + gs.dx)));
        panY.setValue(Math.max(-max, Math.min(max, panYStart.current + gs.dy)));
      },
      onPanResponderRelease: () => {
        pinchStartDist.current = 0;
        cancelArm();
      },
      onPanResponderTerminate: () => {
        pinchStartDist.current = 0;
        cancelArm();
      },
    })
  ).current;

  // Touch handlers on the wrapper View arm the long-press. We use onTouchStart
  // to schedule a 350ms timer, and onTouchEnd / onTouchMove (if motion > 8px)
  // to cancel it. This runs in parallel with the PanResponder gate above.
  const handleTouchStart = () => {
    cancelArm();
    tapMovedRef.current = false;
    longPressTimerRef.current = setTimeout(armDrag, LONG_PRESS_MS);
  };
  const handleTouchMove = (e) => {
    // If finger moves significantly before the timer fires, the user is
    // swiping (probably navigating), not preparing to drag. Cancel.
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

  return (
    <View
      style={[styles.wrapper, style, dragArmed && styles.wrapperArmed]}
      {...panResponder.panHandlers}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <Animated.Image
        key={imageKey}
        source={source}
        style={[styles.image, imageStyle, { transform }]}
        resizeMode={resizeMode}
        onError={onError}
        onLoad={onLoad}
        onLoadStart={onLoadStart}
      />
      {children}
      {showResetButton && (
        <TouchableOpacity
          style={styles.resetBtn}
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

import React, { useRef, useEffect } from 'react';
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
}) {
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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt) => evt.nativeEvent.touches.length === 2,
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.touches.length === 2 || Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        panXStart.current = panXRef.current;
        panYStart.current = panYRef.current;
        if (evt.nativeEvent.touches.length === 2) {
          pinchStartDist.current = distanceBetween(evt.nativeEvent.touches);
          pinchStartScale.current = scaleRef.current;
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
        const max = 300;
        panX.setValue(Math.max(-max, Math.min(max, panXStart.current + gs.dx)));
        panY.setValue(Math.max(-max, Math.min(max, panYStart.current + gs.dy)));
      },
      onPanResponderRelease: () => { pinchStartDist.current = 0; },
    })
  ).current;

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
    <View style={[styles.wrapper, style]} {...panResponder.panHandlers}>
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
      <TouchableOpacity
        style={styles.resetBtn}
        onPress={reset}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="refresh-outline" size={16} color="#000" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    overflow: 'hidden',
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

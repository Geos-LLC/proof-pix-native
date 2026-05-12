import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Image,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableWithoutFeedback,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Three-mode before/after compare viewer.
 *
 * Modes:
 *   - 'split'        : draggable vertical divider over a single frame; before
 *                      is the base layer, after is an overlay clipped by the
 *                      divider position. Spec-recommended pattern.
 *   - 'overlay'      : both images share the same frame; tap to toggle.
 *   - 'side-by-side' : two photos in halves with a fixed centre divider,
 *                      contain-fit so neither image distorts.
 *
 * Orientation handling:
 *   The container aspect ratio is derived from the BEFORE photo (preferring
 *   numeric width/height, then `aspectRatio` string '4:3' / '9:16'). Both
 *   images render with resizeMode="contain" so different orientations fit
 *   inside the frame without stretching. Mixed-orientation pairs letterbox
 *   gracefully against the dark background instead of cropping.
 */

const parseAspect = (input) => {
  if (!input) return null;
  // Numeric width/height (photo objects have `width` and `height` sometimes)
  const w = Number(input.width);
  const h = Number(input.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
  // 'aspectRatio' string like '4:3' or '9:16'
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
  // initialSplit is the 0..1 fraction for the Split divider. 0.5 = centre.
  initialSplit = 0.5,
  // Render-prop slots for label/badge overlays inside each layer.
  // Receives no args; place absolutely-positioned PhotoLabel etc.
  renderBeforeOverlay,
  renderAfterOverlay,
}) {
  const beforeUri = beforePhoto?.uri;
  const afterUri = afterPhoto?.uri;

  // Container aspect: prefer BEFORE photo's aspect, fall back to AFTER, then 1.
  // Spec calls for "contain before crop" — a mismatched after letterboxes
  // within the same frame instead of stretching to fit.
  const aspectRatio = useMemo(() => {
    return parseAspect(beforePhoto) || parseAspect(afterPhoto) || 1;
  }, [beforePhoto, afterPhoto]);

  // ----- Split mode state -----------------------------------------------------
  const [containerWidth, setContainerWidth] = useState(0);
  const splitAnim = useRef(new Animated.Value(initialSplit)).current;
  const splitRef = useRef(initialSplit);

  // Keep splitRef in sync so deltas during drag reference the last committed
  // position rather than the live animated value (avoids drift).
  useEffect(() => {
    const id = splitAnim.addListener(({ value }) => { splitRef.current = value; });
    return () => splitAnim.removeListener(id);
  }, [splitAnim]);

  // PanResponder must be stable. We snapshot the starting split ratio on grant
  // so each drag is relative to that, not accumulating across drags.
  const dragStartRef = useRef(initialSplit);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => mode === 'split',
      onMoveShouldSetPanResponder: () => mode === 'split',
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { dragStartRef.current = splitRef.current; },
      onPanResponderMove: (_, gs) => {
        if (containerWidth <= 0) return;
        const dx = gs.dx / containerWidth;
        const next = Math.max(0, Math.min(1, dragStartRef.current + dx));
        splitAnim.setValue(next);
      },
    })
  ).current;

  // ----- Overlay mode state ---------------------------------------------------
  const [overlayShowingAfter, setOverlayShowingAfter] = useState(false);
  // Reset overlay to "before" when the photo pair changes so each new pair
  // starts on a known state.
  useEffect(() => { setOverlayShowingAfter(false); }, [beforeUri, afterUri]);

  if (!beforeUri || !afterUri) return null;

  const handleLayout = (e) => setContainerWidth(e.nativeEvent.layout.width);

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

  // ----- Render: Overlay (tap to toggle) -------------------------------------
  if (mode === 'overlay') {
    return (
      <TouchableWithoutFeedback onPress={() => setOverlayShowingAfter((v) => !v)}>
        <View style={[styles.container, styles.containerColumn, { aspectRatio }, style]} onLayout={handleLayout}>
          <Image source={{ uri: beforeUri }} style={styles.absoluteImage} resizeMode="contain" />
          {renderBeforeOverlay ? renderBeforeOverlay() : null}
          {overlayShowingAfter && (
            <>
              <Image source={{ uri: afterUri }} style={styles.absoluteImage} resizeMode="contain" />
              {renderAfterOverlay ? renderAfterOverlay() : null}
            </>
          )}
          {/* Small visual hint showing which photo is currently displayed */}
          <View style={styles.overlayBadge}>
            <Text style={styles.overlayBadgeText}>
              {overlayShowingAfter ? 'AFTER' : 'BEFORE'}  ·  tap to toggle
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  // ----- Render: Split (draggable divider) -----------------------------------
  // Animate overlay width as a percentage so it scales when the container
  // resizes (orientation change, layout reflow). Same for divider position.
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
      {/* Base layer: BEFORE image (full frame) */}
      <Image source={{ uri: beforeUri }} style={styles.absoluteImage} resizeMode="contain" />
      {renderBeforeOverlay ? renderBeforeOverlay() : null}

      {/* Overlay layer: AFTER image, clipped by overlay width (left portion).
          The inner image is sized to the *full* container so the visible left
          slice matches the BEFORE image's geometry pixel-for-pixel — i.e. it
          doesn't squish to fit the clipped width. */}
      <Animated.View style={[styles.splitOverlay, { width: overlayWidthPct }]}>
        <View style={[styles.splitOverlayInner, { width: containerWidth || '100%' }]}>
          <Image source={{ uri: afterUri }} style={styles.fullImage} resizeMode="contain" />
          {renderAfterOverlay ? renderAfterOverlay() : null}
        </View>
      </Animated.View>

      {/* Divider line + drag handle. PanResponder lives on a wider hit area
          centered on the divider line so users don't have to hit the 2px line. */}
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
    position: 'relative',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F2C31B',
    flexDirection: 'row',
  },
  // For Split + Overlay modes the layers stack absolutely; flex direction
  // doesn't matter, but use column so any non-absolute children flow
  // naturally and don't interact with the row layout used by side-by-side.
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
  overlayBadge: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  overlayBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
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
    width: 44,
    marginLeft: -22,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
});

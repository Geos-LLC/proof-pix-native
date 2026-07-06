import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Modal,
  Pressable,
  Animated,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Line, Circle as SvgCircle, Polygon, Text as SvgText, G } from 'react-native-svg';
import { FONTS } from '../constants/fonts';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';
import ColorGridPicker from '../components/ColorGridPicker';

// Dedicated full-screen markup editor.
//
// One PanResponder owns every gesture on the canvas:
//   • 1 finger → draw / extend shape (coords stored in IMAGE space)
//   • 2 fingers → pinch-zoom (1×–5×) + two-finger drag pans the picture
//
// Shapes are stored in image-space coordinates (untransformed). The
// Image + SVG live inside a single Animated.View that applies the
// scale+translate transform, so a mark drawn while zoomed-in renders at
// its natural size again when the user zooms back out — that's the
// "stays the same size as it would be on the smaller page" behaviour.
// `vectorEffect="non-scaling-stroke"` keeps line thickness constant on
// screen regardless of zoom level so strokes don't get visually fatter
// while you're zoomed in.

const MARKUP_TOOLS = [
  { key: 'draw', label: 'Draw', icon: 'pencil-outline', defaultStroke: 3 },
  { key: 'brush', label: 'Brush', icon: 'brush-outline', defaultStroke: 8 },
  { key: 'highlight', label: 'Highlight', icon: 'color-fill-outline', defaultStroke: 16 },
  { key: 'arrow', label: 'Arrow', icon: 'arrow-forward-outline', defaultStroke: 3 },
  { key: 'circle', label: 'Circle', icon: 'ellipse-outline', defaultStroke: 3 },
  { key: 'measure', label: 'Measure', icon: 'resize-outline', defaultStroke: 2 },
];
const MARKUP_COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#007AFF', '#FFFFFF', '#000000'];
const STROKE_PRESETS = [
  { key: 'S', value: 2 },
  { key: 'M', value: 4 },
  { key: 'L', value: 8 },
];

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function MarkupShape({ shape }) {
  const opacity = shape.tool === 'highlight' ? 0.35 : 1;
  const commonStroke = {
    stroke: shape.color,
    strokeWidth: shape.stroke,
    vectorEffect: 'non-scaling-stroke',
  };
  if (shape.tool === 'draw' || shape.tool === 'brush' || shape.tool === 'highlight') {
    const pts = shape.points || [];
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      const r = Math.max(shape.stroke / 2, 2);
      return <SvgCircle cx={pts[0].x} cy={pts[0].y} r={r} fill={shape.color} opacity={opacity} />;
    }
    const d = pts.reduce(
      (acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`),
      ''
    );
    return (
      <Path
        d={d}
        {...commonStroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={opacity}
      />
    );
  }
  if (shape.tool === 'arrow') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const headLen = Math.max(stroke * 4, 12);
    const headWidth = Math.max(stroke * 2.5, 8);
    const bx = x2 - ux * headLen;
    const by = y2 - uy * headLen;
    const ax = bx + px * headWidth;
    const ay = by + py * headWidth;
    const cx = bx - px * headWidth;
    const cy = by - py * headWidth;
    return (
      <G>
        <Line x1={x1} y1={y1} x2={bx} y2={by} {...commonStroke} strokeLinecap="round" />
        <Polygon points={`${x2},${y2} ${ax},${ay} ${cx},${cy}`} fill={color} />
      </G>
    );
  }
  if (shape.tool === 'circle') {
    const { x1, y1, x2, y2 } = shape;
    const r = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    return <SvgCircle cx={x1} cy={y1} r={r} {...commonStroke} fill="none" />;
  }
  if (shape.tool === 'measure') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return (
      <G>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} {...commonStroke} strokeLinecap="round" />
        <SvgText x={midX} y={midY - 6} fill={color} fontSize="12" fontWeight="700" textAnchor="middle">
          {Math.round(len)} px
        </SvgText>
      </G>
    );
  }
  return null;
}

const distance = (touches) => {
  if (!touches || touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
};
const centerOf = (touches) => ({
  x: (touches[0].pageX + touches[1].pageX) / 2,
  y: (touches[0].pageY + touches[1].pageY) / 2,
});

export default function MarkupEditorScreen({ route, navigation }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { photos, updatePhoto } = usePhotos();
  const photoId = route?.params?.photoId;
  const photo = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  // Seed from any params the sheet handed off, so the user's tool /
  // color / stroke picks carry into the full-screen editor.
  const [markupTool, setMarkupTool] = useState(route?.params?.initialTool || 'draw');
  const [markupColor, setMarkupColor] = useState(route?.params?.initialColor || '#FF3B30');
  const [markupStroke, setMarkupStroke] = useState(route?.params?.initialStroke || 4);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  // Markup can be either the legacy raw-array format or the new
  // { bounds, shapes } object. Normalise on load so we always work with
  // an array internally.
  const initialShapes = useMemo(() => {
    const m = photo?.markup;
    if (Array.isArray(m)) return m;
    if (m && Array.isArray(m.shapes)) return m.shapes;
    return [];
  }, [photo?.markup]);
  const [shapes, setShapes] = useState(initialShapes);
  const [inProgress, setInProgress] = useState(null);

  // Live refs for tool / color / stroke so the one-shot PanResponder
  // closures always see the current pick.
  const toolRef = useRef(markupTool);
  const colorRef = useRef(markupColor);
  const strokeRef = useRef(markupStroke);
  toolRef.current = markupTool;
  colorRef.current = markupColor;
  strokeRef.current = markupStroke;

  // Transform state — image-space ↔ screen-space. translateX/Y move the
  // picture, scale zooms it. SVG is inside the same Animated.View so it
  // moves with the picture. Live refs mirror the Animated.Values so the
  // PanResponder closure can read them without re-creating itself.
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const tXAnim = useRef(new Animated.Value(0)).current;
  const tYAnim = useRef(new Animated.Value(0)).current;
  const scaleRef = useRef(1);
  const tXRef = useRef(0);
  const tYRef = useRef(0);
  useEffect(() => {
    const idS = scaleAnim.addListener(({ value }) => { scaleRef.current = value; });
    const idX = tXAnim.addListener(({ value }) => { tXRef.current = value; });
    const idY = tYAnim.addListener(({ value }) => { tYRef.current = value; });
    return () => {
      scaleAnim.removeListener(idS);
      tXAnim.removeListener(idX);
      tYAnim.removeListener(idY);
    };
  }, [scaleAnim, tXAnim, tYAnim]);

  // Per-gesture pinch baselines.
  const pinchingRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const pinchStartCenterRef = useRef({ x: 0, y: 0 });
  const pinchStartTranslateRef = useRef({ x: 0, y: 0 });

  // Canvas layout for converting screen ↔ image-space.
  const canvasLayoutRef = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const onCanvasLayout = (e) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    canvasLayoutRef.current = { x, y, w: width, h: height };
  };

  // Screen → image space. The Animated.View applies translate then
  // scale, so the inverse is: image = (screenLocal - translate) / scale.
  // We use locationX/Y from the responder event (already relative to
  // the canvas), so no extra origin subtraction is needed.
  const screenToImage = (locationX, locationY) => ({
    x: (locationX - tXRef.current) / scaleRef.current,
    y: (locationY - tYRef.current) / scaleRef.current,
  });

  const startShape = (x, y) => {
    const tool = toolRef.current;
    const base = { tool, color: colorRef.current, stroke: strokeRef.current };
    if (tool === 'draw' || tool === 'brush' || tool === 'highlight') {
      return { ...base, points: [{ x, y }] };
    }
    return { ...base, x1: x, y1: y, x2: x, y2: y };
  };
  const extendShape = (shape, x, y) => {
    if (!shape) return null;
    if (shape.tool === 'draw' || shape.tool === 'brush' || shape.tool === 'highlight') {
      return { ...shape, points: [...shape.points, { x, y }] };
    }
    return { ...shape, x2: x, y2: y };
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          pinchingRef.current = true;
          pinchStartDistRef.current = distance(touches);
          pinchStartScaleRef.current = scaleRef.current;
          pinchStartCenterRef.current = centerOf(touches);
          pinchStartTranslateRef.current = { x: tXRef.current, y: tYRef.current };
          return;
        }
        const img = screenToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        setInProgress(startShape(img.x, img.y));
      },
      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          if (!pinchingRef.current) {
            // Just entered pinch mid-gesture: drop any in-progress draw
            // and reset baselines from this frame.
            setInProgress(null);
            pinchingRef.current = true;
            pinchStartDistRef.current = distance(touches);
            pinchStartScaleRef.current = scaleRef.current;
            pinchStartCenterRef.current = centerOf(touches);
            pinchStartTranslateRef.current = { x: tXRef.current, y: tYRef.current };
            return;
          }
          const dist = distance(touches);
          const ratio = dist / (pinchStartDistRef.current || 1);
          const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScaleRef.current * ratio));
          scaleAnim.setValue(nextScale);
          const c = centerOf(touches);
          tXAnim.setValue(pinchStartTranslateRef.current.x + (c.x - pinchStartCenterRef.current.x));
          tYAnim.setValue(pinchStartTranslateRef.current.y + (c.y - pinchStartCenterRef.current.y));
          return;
        }
        // 1-finger
        if (pinchingRef.current) {
          // Skipping this frame — second finger just lifted. Wait for
          // the next clean 1-finger event before drawing again.
          pinchingRef.current = false;
          return;
        }
        const img = screenToImage(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        setInProgress((prev) => (prev ? extendShape(prev, img.x, img.y) : startShape(img.x, img.y)));
      },
      onPanResponderRelease: () => {
        pinchingRef.current = false;
        setInProgress((prev) => {
          if (prev) setShapes((s) => [...s, prev]);
          return null;
        });
      },
      onPanResponderTerminate: () => {
        pinchingRef.current = false;
        setInProgress(null);
      },
    })
  ).current;

  const resetZoom = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(tXAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(tYAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const handleSave = async () => {
    if (photo?.id) {
      // Persist canvas bounds alongside shapes so other screens
      // (Studio's photo overlay) can render the same shapes at the
      // right proportions in a frame of any size.
      const layout = canvasLayoutRef.current;
      const payload = {
        bounds: { w: layout.w || 0, h: layout.h || 0 },
        shapes,
      };
      await updatePhoto(photo.id, { markup: payload });
    }
    navigation.goBack();
  };
  const handleUndo = () => setShapes((s) => s.slice(0, -1));
  const handleClear = () => setShapes([]);

  if (!photo) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={[styles.header, { backgroundColor: theme.background }]}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Markup</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Photo not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const transformStyle = {
    transform: [
      { translateX: tXAnim },
      { translateY: tYAnim },
      { scale: scaleAnim },
    ],
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { backgroundColor: theme.background, borderBottomColor: theme.divider }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Markup</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={resetZoom}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.zoomResetBtn}
          >
            <Ionicons name="refresh-outline" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: theme.accent }]}
            onPress={handleSave}
          >
            <Text style={[styles.saveBtnText, { color: theme.accentText }]}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Single PanResponder owns the canvas. Image + SVG live inside
          one Animated.View so they zoom + pan together. */}
      <View
        style={[styles.canvas, { backgroundColor: theme.surface }]}
        onLayout={onCanvasLayout}
        {...responder.panHandlers}
      >
        <Animated.View style={[StyleSheet.absoluteFill, transformStyle]}>
          <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="contain" />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width="100%" height="100%">
              {shapes.map((shape, i) => (
                <MarkupShape key={`s-${i}`} shape={shape} />
              ))}
              {inProgress && <MarkupShape key="in-progress" shape={inProgress} />}
            </Svg>
          </View>
        </Animated.View>
      </View>

      {/* Docked palette sheet — rounded top corners, grabber, section
          eyebrows ("Tool" / "Adjust"), and Undo/Clear pill row at the
          bottom. Mirrors the ProofPix Markup Editor design spec. */}
      <View
        style={[
          styles.palette,
          {
            paddingBottom: 10 + insets.bottom,
            backgroundColor: theme.surfaceElevated,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={[styles.paletteGrabber, { backgroundColor: theme.borderStrong }]} />

        {/* TOOL section — 4-column tile grid (icon square + label under).
            Matches the ProofPix Markup design spec. With 6 tools the
            second row has 2 tiles + 2 empty slots (auto-filled by grid). */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Tool</Text>
        <View style={styles.tileGrid}>
          {MARKUP_TOOLS.map((t) => {
            const isActive = markupTool === t.key;
            return (
              <View key={t.key} style={styles.tileCell}>
                <TouchableOpacity
                  style={[
                    styles.tile,
                    {
                      backgroundColor: isActive ? theme.accent : theme.surface,
                      borderColor: isActive ? theme.accent : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setMarkupTool(t.key);
                    if (typeof t.defaultStroke === 'number') setMarkupStroke(t.defaultStroke);
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name={t.icon} size={22} color={isActive ? theme.accentText : theme.textPrimary} />
                </TouchableOpacity>
                <Text
                  style={[
                    styles.tileLabel,
                    { color: isActive ? theme.textPrimary : theme.textSecondary, fontWeight: isActive ? '700' : '500' },
                  ]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ADJUST section — 4-column grid holding Color + Size tiles.
            Both open dedicated bottom sheets so the palette stays clean;
            same pattern the Watermark / Metadata customization screens
            use for their Color modal. */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: 12 }]}>Adjust</Text>
        <View style={styles.tileGrid}>
          <View style={styles.tileCell}>
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => setColorModalVisible(true)}
              activeOpacity={0.85}
            >
              <View style={[styles.tileSwatch, { backgroundColor: markupColor, borderColor: theme.border }]} />
            </TouchableOpacity>
            <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>Color</Text>
          </View>
          <View style={styles.tileCell}>
            <TouchableOpacity
              style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => setSizeModalVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="resize-outline" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>Size</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: shapes.length === 0 ? 0.4 : 1 },
            ]}
            onPress={handleUndo}
            disabled={shapes.length === 0}
          >
            <Ionicons name="arrow-undo-outline" size={16} color={theme.textPrimary} />
            <Text style={[styles.actionBtnText, { color: theme.textPrimary }]}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: theme.surface, borderColor: theme.border, opacity: shapes.length === 0 ? 0.4 : 1 },
            ]}
            onPress={handleClear}
            disabled={shapes.length === 0}
          >
            <Ionicons name="trash-outline" size={16} color={theme.danger} />
            <Text style={[styles.actionBtnText, { color: theme.danger }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Color modal — reuses the shared ColorGridPicker (same picker
          Labels / Watermark / Metadata use). Header hidden so more of
          the canvas stays visible. Tap-outside or Done closes. */}
      <MarkupBottomSheet visible={colorModalVisible} onClose={() => setColorModalVisible(false)} theme={theme}>
        <ColorGridPicker
          theme={theme}
          value={markupColor}
          onChange={(hex) => setMarkupColor(hex)}
          onDone={() => setColorModalVisible(false)}
        />
      </MarkupBottomSheet>

      {/* Size modal — slider from 1 to 24 px. Live-updates the stroke
          for future strokes. Existing shapes keep the width they were
          drawn with. */}
      <MarkupBottomSheet visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} theme={theme}>
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600', color: theme.textPrimary }}>Stroke width</Text>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>{markupStroke} px</Text>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={1}
            maximumValue={24}
            step={1}
            value={markupStroke}
            onValueChange={(v) => setMarkupStroke(Math.round(v))}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
          <TouchableOpacity
            style={{
              marginTop: 14,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: 'center',
              backgroundColor: theme.accent,
            }}
            onPress={() => setSizeModalVisible(false)}
            activeOpacity={0.85}
          >
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 16, fontWeight: '700', color: theme.accentText }}>Done</Text>
          </TouchableOpacity>
        </View>
      </MarkupBottomSheet>
    </SafeAreaView>
  );
}

// Bottom sheet for the Color + Size sub-menus. Local to MarkupEditor —
// the customization screens each define their own BottomModal + we
// don't want to leak canvas gestures underneath so this stays isolated.
function MarkupBottomSheet({ visible, onClose, children, theme }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.sheetOverlay, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <View
          style={[styles.sheetContent, { backgroundColor: theme.surfaceElevated }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  zoomResetBtn: { padding: 4 },
  title: { fontFamily: FONTS.ALEXANDRIA, fontSize: 16, fontWeight: '700' },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100 },
  saveBtnText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 13, fontWeight: '700' },
  canvas: { flex: 1, position: 'relative', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  palette: {
    paddingHorizontal: 16,
    paddingTop: 4,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    marginTop: -18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  paletteGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginTop: 6,
    marginBottom: 8,
  },
  // 4-column tile grid — mirrors the customization ControlButton layout
  // in the ProofPix Markup design spec. Tiles wrap onto extra rows if
  // there are more than 4 (Tool section has 6 tools = 2 rows).
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    rowGap: 12,
  },
  tileCell: {
    width: '25%',
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tile: {
    width: 54,
    height: 54,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  tileSwatch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
  },
  tileLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    textAlign: 'center',
  },
  // Bottom-sheet chrome for the Color + Size sub-menus. Same look as the
  // customization screens: dim scrim, rounded top, grabber, tap-outside
  // to close.
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
  actionRow: { flexDirection: 'row', gap: 10, paddingTop: 14 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionBtnText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 13, fontWeight: '700' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 14 },
});

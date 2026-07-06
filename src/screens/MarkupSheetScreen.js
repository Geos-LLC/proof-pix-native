import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';
import ColorGridPicker from '../components/ColorGridPicker';

// Bottom-sheet "quick config" markup screen. Comes up as a formSheet
// (see App.js Stack.Screen options), so the Studio photo behind stays
// visible while the user picks a tool + color + stroke width. Tapping
// "Enlarge to mark" hands off to the full-screen MarkupEditor, which
// carries the picked tool/color/stroke as initial state.
//
// The tile grid matches the Customize Labels design — 52×52 rounded
// squares with a 11px label below. Same ControlButton pattern the
// customization screens use so everything reads as one family.

const MARKUP_TOOLS = [
  { key: 'draw', label: 'Draw', icon: 'pencil-outline', defaultStroke: 3 },
  { key: 'brush', label: 'Brush', icon: 'brush-outline', defaultStroke: 8 },
  { key: 'highlight', label: 'Highlight', icon: 'color-fill-outline', defaultStroke: 16 },
  { key: 'arrow', label: 'Arrow', icon: 'arrow-forward-outline', defaultStroke: 3 },
  { key: 'circle', label: 'Circle', icon: 'ellipse-outline', defaultStroke: 3 },
  { key: 'measure', label: 'Measure', icon: 'resize-outline', defaultStroke: 2 },
];

function ControlTile({ theme, icon, label, active, onPress, swatch }) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <TouchableOpacity style={styles.tileCell} onPress={onPress} activeOpacity={0.7}>
      <View
        style={[
          styles.tile,
          {
            backgroundColor: active ? theme.accent : theme.surface,
            borderColor: active ? theme.accent : theme.border,
          },
        ]}
      >
        {swatch ? (
          <View style={[styles.tileSwatch, { backgroundColor: swatch, borderColor: theme.border }]} />
        ) : (
          <Ionicons name={icon} size={22} color={active ? theme.accentText : theme.textPrimary} />
        )}
      </View>
      <Text
        style={[
          styles.tileLabel,
          { color: active ? theme.textPrimary : theme.textSecondary, fontWeight: active ? '700' : '500' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SheetPopup({ visible, onClose, children, theme }) {
  if (!visible) return null;
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.popupOverlay, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <View
          style={[styles.popupContent, { backgroundColor: theme.surfaceElevated }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.popupHandle, { backgroundColor: theme.borderStrong }]} />
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

export default function MarkupSheetScreen({ navigation, route }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const photoId = route?.params?.photoId;
  // Seed from any tool/color/stroke the caller passed in (useful when the
  // user Enlarges → back-arrows out of MarkupEditor: their picks come
  // back to the sheet). Otherwise defaults match MarkupEditor.
  const [tool, setTool] = useState(route?.params?.initialTool || 'draw');
  const [color, setColor] = useState(route?.params?.initialColor || '#FF3B30');
  const [stroke, setStroke] = useState(route?.params?.initialStroke || 4);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);

  // Two explicit affordances in the header:
  //   • X (top-left)      → return to Studio, abort markup
  //   • ⤢ enlarge (right) → open the full-screen MarkupEditor with
  //     the picked tool / color / stroke pre-filled
  // No hidden gestures — drag-down or tap outside dismisses normally
  // (returns to Studio, same as X).
  const openEditor = () => {
    navigation.replace('MarkupEditor', {
      photoId,
      initialTool: tool,
      initialColor: color,
      initialStroke: stroke,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerClose}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Markup</Text>
        <TouchableOpacity
          style={styles.headerEnlarge}
          onPress={openEditor}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="scan-outline" size={18} color={theme.accentText} />
        </TouchableOpacity>
      </View>

      {/* Single 4-column grid — 6 tools + Color + Size = 8 tiles total,
          exactly 2 rows of 4. Same layout Customize Labels uses so the
          two sheets read as one family. No section split. */}
      <View style={styles.body}>
        <View style={styles.tileGrid}>
          {MARKUP_TOOLS.map((t) => (
            <ControlTile
              key={t.key}
              theme={theme}
              icon={t.icon}
              label={t.label}
              active={tool === t.key}
              onPress={() => {
                setTool(t.key);
                if (typeof t.defaultStroke === 'number') setStroke(t.defaultStroke);
              }}
            />
          ))}
          <ControlTile
            theme={theme}
            label="Color"
            swatch={color}
            onPress={() => setColorModalVisible(true)}
          />
          <ControlTile
            theme={theme}
            icon="resize-outline"
            label="Size"
            onPress={() => setSizeModalVisible(true)}
          />
        </View>
      </View>

      <SheetPopup visible={colorModalVisible} onClose={() => setColorModalVisible(false)} theme={theme}>
        <ColorGridPicker
          theme={theme}
          value={color}
          onChange={(hex) => setColor(hex)}
          onDone={() => setColorModalVisible(false)}
        />
      </SheetPopup>

      <SheetPopup visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} theme={theme}>
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600', color: theme.textPrimary }}>Stroke width</Text>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '700', color: theme.textPrimary }}>{stroke} px</Text>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={1}
            maximumValue={24}
            step={1}
            value={stroke}
            onValueChange={(v) => setStroke(Math.round(v))}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: theme.accent, marginTop: 14 }]}
            onPress={() => setSizeModalVisible(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { color: theme.accentText }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </SheetPopup>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Filled accent tile on the right — mirrors the customization sheets'
  // "primary action lives on the right" convention (Save pill on the
  // Studio header). Contrast against the neutral X on the left makes the
  // "go draw" step visually obvious.
  headerEnlarge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: { width: 36 },
  headerTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 20,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 4,
  },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: theme.textSecondary,
    marginTop: 6,
    marginBottom: 8,
  },
  // 4-column grid — 8 tiles total (6 tools + Color + Size) laid out as
  // 2 balanced rows of 4. Matches Customize Labels tile sizing (52×52).
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    rowGap: 14,
  },
  tileCell: {
    width: '25%',
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  tileSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  tileLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    textAlign: 'center',
  },
  primaryBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
  },
  primaryBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
  },
  popupOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  popupContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  popupHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
});

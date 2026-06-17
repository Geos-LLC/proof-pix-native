import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Modal,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useScopedSettings } from '../hooks/useScopedSettings';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';
import { useFeaturePermissions, FEATURES } from '../hooks/useFeaturePermissions';
import DraggablePreviewItem from '../components/DraggablePreviewItem';
import PositionGrid, { resolvePositionKey } from '../components/PositionGrid';
import { PHOTO_MODES } from '../constants/rooms';

const POSITIONS = [
  ['left-top', 'center-top', 'right-top'],
  ['left-middle', 'center-middle', 'right-middle'],
  ['left-bottom', 'center-bottom', 'right-bottom'],
];

// Combined photos render side-by-side when the source pair is portrait
// and stacked when landscape — mirrors isStackedLayout in HomeScreen.
const combinedGridLayout = (photo) => {
  if (!photo || photo.mode !== PHOTO_MODES.COMBINED) return 'single';
  const ar = photo.aspectRatio;
  if (typeof ar === 'string') {
    const [w, h] = ar.split(':').map(Number);
    if (w && h) return h > w ? 'side' : 'stack';
  }
  return 'side';
};

const FONT_OPTIONS = [
  { key: 'system', label: 'Arial Blank' },
  { key: 'shadow', label: 'Shadow Into Light' },
  { key: 'shanatel', label: 'Shanatel Light' },
  { key: 'sf', label: 'SF Compact' },
  { key: 'share', label: 'Share Tech' },
];
const PREVIEW_FONT_MAP = {
  system: 'Alexandria_400Regular',
  alexandria: 'Alexandria_400Regular',
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
};
const getPreviewFontFamily = (key) => PREVIEW_FONT_MAP[key] || PREVIEW_FONT_MAP.system;

const COLOR_SWATCHES = [
  '#FFFFFF', '#000000', '#FFD700', '#EAB308', '#A855F7', '#3B82F6',
  '#22C55E', '#EF4444', '#06B6D4', '#F43F5E',
];

const DEFAULT_WATERMARK_TEXT = 'Created with ProofPix.app';

export default function WatermarkCustomizationScreen({ navigation, route }) {
  const theme = useTheme();
  const { canUse } = useFeaturePermissions();
  useEffect(() => {
    if (!canUse(FEATURES.CUSTOM_WATERMARKS)) navigation.goBack();
  }, [canUse, navigation]);

  const {
    customWatermarkEnabled,
    toggleWatermark,
    watermarkText,
    updateWatermarkText,
    watermarkLink,
    updateWatermarkLink,
    watermarkColor,
    updateWatermarkColor,
    watermarkOpacity,
    updateWatermarkOpacity,
    watermarkPosition,
    updateWatermarkPosition,
    watermarkFontFamily,
    updateWatermarkFontFamily,
    watermarkOffset,
    updateWatermarkOffset,
    watermarkFontSize,
    updateWatermarkFontSize,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    location,
  } = useScopedSettings(route?.params?.photoId);

  const photoId = route?.params?.photoId;
  const { photos } = usePhotos();
  const previewPhoto = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  const numericSize = typeof watermarkFontSize === 'number' ? watermarkFontSize : 14;
  const [previewLayout, setPreviewLayout] = useState({ w: 0, h: 0 });
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [marginModalVisible, setMarginModalVisible] = useState(false);
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [opacityModalVisible, setOpacityModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);

  const onPreviewLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewLayout((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const bounds = { x: 0, y: 0, w: previewLayout.w, h: previewLayout.h };

  // What the watermark actually says. Metadata-on-watermark is no longer
  // a toggle here — that capability lives on the Metadata customization
  // screen now, so this screen only handles the text/link watermark.
  const displayText = useMemo(() => {
    const raw = customWatermarkEnabled ? watermarkText : DEFAULT_WATERMARK_TEXT;
    return (raw || '').trim() || DEFAULT_WATERMARK_TEXT;
  }, [customWatermarkEnabled, watermarkText]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Watermark</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={scrollEnabled}
        >
          {/* Preview removed — the screen opens as a bottom sheet over
              Studio, so the photo behind the sheet IS the preview. */}

          {/* Custom text toggle */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>CUSTOM TEXT</Text>
          <View style={[styles.toggleRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>Use custom watermark</Text>
            <Switch
              value={!!customWatermarkEnabled}
              onValueChange={toggleWatermark}
              trackColor={{ false: '#E0E0E0', true: theme.accent }}
              thumbColor="#FFFFFF"
            />
          </View>

          {customWatermarkEnabled && (
            <>
              <TextInput
                style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
                value={watermarkText}
                onChangeText={updateWatermarkText}
                placeholder="Watermark text"
                placeholderTextColor={theme.textMuted}
              />
              <TextInput
                style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
                value={watermarkLink}
                onChangeText={updateWatermarkLink}
                placeholder="Optional link (https://…)"
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </>
          )}

          {/* Controls */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>CONTROLS</Text>
          <View style={styles.controlsRow}>
            <ControlButton theme={theme} icon="text" label="Font" onPress={() => setFontModalVisible(true)} />
            <ControlButton theme={theme} icon="resize" label="Size" onPress={() => setSizeModalVisible(true)} />
            <ControlButton theme={theme} icon="move" label="Position" onPress={() => setPositionModalVisible(true)} />
          </View>
          <View style={[styles.controlsRow, { marginTop: 12 }]}>
            <ControlButton theme={theme} icon="swap-horizontal-outline" label="Margin" onPress={() => setMarginModalVisible(true)} />
            <ControlButton theme={theme} icon="contrast-outline" label="Opacity" onPress={() => setOpacityModalVisible(true)} />
            <ColorButton theme={theme} color={watermarkColor || '#FFD700'} onPress={() => setColorModalVisible(true)} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Font Modal */}
      <BottomModal visible={fontModalVisible} onClose={() => setFontModalVisible(false)} title="Watermark Font" theme={theme}>
        <View style={{ paddingVertical: 4 }}>
          {FONT_OPTIONS.map((font) => {
            const isSelected = watermarkFontFamily === font.key;
            return (
              <TouchableOpacity
                key={font.key}
                style={[
                  styles.fontListItem,
                  { backgroundColor: isSelected ? theme.accent : theme.surfaceElevated },
                ]}
                onPress={async () => {
                  await updateWatermarkFontFamily(font.key);
                  setFontModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.fontListItemText,
                    { color: isSelected ? theme.accentText : theme.textPrimary, fontFamily: getPreviewFontFamily(font.key) },
                  ]}
                >
                  {font.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomModal>

      {/* Size Modal */}
      <BottomModal visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} title="Watermark Size" theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={[styles.modalLabel, { color: theme.textPrimary }]}>Font size</Text>
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{numericSize}px</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={8}
            maximumValue={32}
            step={1}
            value={numericSize}
            onValueChange={(v) => updateWatermarkFontSize(Math.round(v))}
            onSlidingComplete={(v) => updateWatermarkFontSize(Math.round(v))}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
      </BottomModal>

      {/* Position Modal */}
      <BottomModal visible={positionModalVisible} onClose={() => setPositionModalVisible(false)} title="Position" theme={theme}>
        <View style={{ padding: 16 }}>
          <PositionGrid
            layout={combinedGridLayout(previewPhoto)}
            mode="single"
            value={resolvePositionKey(watermarkOffset, watermarkPosition)}
            onChange={async (pos) => {
              await updateWatermarkOffset(null);
              await updateWatermarkPosition(pos);
            }}
            theme={theme}
          />
        </View>
      </BottomModal>

      {/* Margin Modal */}
      <BottomModal visible={marginModalVisible} onClose={() => setMarginModalVisible(false)} title="Margin" theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={[styles.modalLabel, { color: theme.textPrimary }]}>Vertical (Top/Bottom)</Text>
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{labelMarginVertical}px</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={50}
            step={1}
            value={labelMarginVertical}
            onValueChange={updateLabelMarginVertical}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={[styles.modalLabel, { color: theme.textPrimary }]}>Horizontal (Left/Right)</Text>
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{labelMarginHorizontal}px</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={50}
            step={1}
            value={labelMarginHorizontal}
            onValueChange={updateLabelMarginHorizontal}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
      </BottomModal>

      {/* Opacity Modal */}
      <BottomModal visible={opacityModalVisible} onClose={() => setOpacityModalVisible(false)} title="Opacity" theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={[styles.modalLabel, { color: theme.textPrimary }]}>Opacity</Text>
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{Math.round((watermarkOpacity ?? 0.5) * 100)}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            value={watermarkOpacity ?? 0.5}
            onValueChange={updateWatermarkOpacity}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
      </BottomModal>

      {/* Color Modal */}
      <BottomModal visible={colorModalVisible} onClose={() => setColorModalVisible(false)} title="Watermark Color" theme={theme}>
        <View style={styles.colorPalette}>
          {COLOR_SWATCHES.map((c) => {
            const isActive = (watermarkColor || '').toUpperCase() === c.toUpperCase();
            return (
              <TouchableOpacity
                key={c}
                onPress={async () => {
                  await updateWatermarkColor(c);
                  setColorModalVisible(false);
                }}
                style={[
                  styles.swatch,
                  { backgroundColor: c, borderColor: isActive ? theme.accent : theme.border, borderWidth: isActive ? 3 : StyleSheet.hairlineWidth },
                ]}
              />
            );
          })}
        </View>
      </BottomModal>
    </SafeAreaView>
  );
}

function ControlButton({ theme, icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.controlSquare, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name={icon} size={22} color={theme.textPrimary} />
      </View>
      <Text style={[styles.controlLabel, { color: theme.textSecondary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ColorButton({ theme, color, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.controlSquare, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={[styles.colorSwatchInline, { backgroundColor: color, borderColor: theme.border }]} />
      </View>
      <Text style={[styles.controlLabel, { color: theme.textSecondary }]}>Color</Text>
    </TouchableOpacity>
  );
}

function BottomModal({ visible, onClose, title, theme, children }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[styles.modalOverlay, { backgroundColor: theme.scrim || 'rgba(0,0,0,0.5)' }]}
        onPress={onClose}
      >
        <View
          style={[styles.modalContent, { backgroundColor: theme.surface }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={[styles.modalHandle, { backgroundColor: theme.border }]} />
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{title}</Text>
            <View style={{ width: 22 }} />
          </View>
          <View style={styles.modalBody}>{children}</View>
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
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: FONTS.ALEXANDRIA, fontSize: 17, fontWeight: '700' },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  previewSquare: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 8,
  },
  previewPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { flex: 1, fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginTop: 8,
  },
  controlsRow: { flexDirection: 'row', gap: 16 },
  controlButton: { alignItems: 'center', minWidth: 70 },
  controlSquare: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  controlLabel: { fontFamily: FONTS.ALEXANDRIA, fontSize: 11, textAlign: 'center' },
  colorSwatchInline: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  positionGrid: {
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  positionRow: { flexDirection: 'row', gap: 8 },
  positionCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  modalClose: { padding: 4 },
  modalTitle: { fontFamily: FONTS.ALEXANDRIA, fontSize: 17, fontWeight: '700' },
  modalBody: { paddingHorizontal: 20 },
  modalSection: { marginBottom: 16 },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalLabel: { fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600' },
  modalLabelValue: { fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '700' },
  slider: { width: '100%', height: 40 },
  fontListItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
    borderRadius: 25,
    alignItems: 'center',
  },
  fontListItemText: { fontSize: 16, fontWeight: '600' },
  colorPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20 },
});

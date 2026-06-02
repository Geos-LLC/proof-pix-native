import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';
import DraggablePreviewItem from '../components/DraggablePreviewItem';

const POSITIONS = [
  ['left-top', 'center-top', 'right-top'],
  ['left-middle', 'center-middle', 'right-middle'],
  ['left-bottom', 'center-bottom', 'right-bottom'],
];

// Same FONT_OPTIONS list the label customization screen uses, so users
// see a consistent typography set across all overlays.
const FONT_OPTIONS = [
  { key: 'system', label: 'Arial Blank' },
  { key: 'shadow', label: 'Shadow Into Light' },
  { key: 'shanatel', label: 'Shanatel Light' },
  { key: 'sf', label: 'SF Compact' },
  { key: 'share', label: 'Share Tech' },
];
// Mirrors PhotoLabel's FONT_FAMILY_MAP so preview matches saved render.
const PREVIEW_FONT_MAP = {
  system: 'Alexandria_400Regular',
  alexandria: 'Alexandria_400Regular',
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
};
const getPreviewFontFamily = (key) => PREVIEW_FONT_MAP[key] || PREVIEW_FONT_MAP.system;

const COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#FFCC00', '#34C759', '#007AFF'];

const FIELD_DEFS = [
  { key: 'date', label: 'Date', icon: 'calendar-outline' },
  { key: 'time', label: 'Time', icon: 'time-outline' },
  { key: 'address', label: 'Address', icon: 'location-outline' },
  { key: 'gps', label: 'GPS coordinates', icon: 'navigate-outline' },
];

// Map any saved size value (numeric or legacy string) to a numeric font
// size in pixels. The slider always writes numbers, but old saves may
// still be 'small'/'medium'/'large'.
const LEGACY_FONT_SIZE = { small: 11, medium: 14, large: 18 };
const toNumericFontSize = (v) => (typeof v === 'number' ? v : (LEGACY_FONT_SIZE[v] || 14));

export default function MetadataCustomizationScreen({ navigation, route }) {
  const theme = useTheme();
  const {
    metaShowDate,
    metaShowTime,
    metaShowAddress,
    metaShowGps,
    setMetaField,
    metaPosition,
    updateMetaPosition,
    metaColor,
    updateMetaColor,
    metaOpacity,
    updateMetaOpacity,
    metaFontSize,
    updateMetaFontSize,
    metaFontFamily,
    updateMetaFontFamily,
    metaOffset,
    updateMetaOffset,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    location,
  } = useSettings();

  const photoId = route?.params?.photoId;
  const { photos } = usePhotos();
  const previewPhoto = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  const numericSize = toNumericFontSize(metaFontSize);
  const [previewLayout, setPreviewLayout] = useState({ w: 0, h: 0 });
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [marginModalVisible, setMarginModalVisible] = useState(false);
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [opacityModalVisible, setOpacityModalVisible] = useState(false);

  const onPreviewLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewLayout((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const bounds = { x: 0, y: 0, w: previewLayout.w, h: previewLayout.h };

  // Build the same caption the export pipeline produces, so the preview
  // mirrors what'll actually land on the photo.
  const ts = previewPhoto?.timestamp
    ? new Date(previewPhoto.timestamp)
    : (previewPhoto?.createdAt ? new Date(previewPhoto.createdAt) : new Date());
  const parts = [];
  if (metaShowDate) parts.push(ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  if (metaShowTime) parts.push(ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  if (metaShowAddress) {
    const where = (previewPhoto?.location || location || '').toString().trim();
    if (where) parts.push(where);
  }
  if (metaShowGps && previewPhoto?.gps) parts.push(String(previewPhoto.gps));
  const captionText = parts.length ? parts.join(' · ') : 'Metadata preview';

  const fieldValue = (key) => {
    if (key === 'date') return metaShowDate;
    if (key === 'time') return metaShowTime;
    if (key === 'address') return metaShowAddress;
    if (key === 'gps') return metaShowGps;
    return false;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Metadata</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        <View
          style={[styles.previewSquare, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
          onLayout={onPreviewLayout}
        >
          {previewPhoto?.uri ? (
            <Image source={{ uri: previewPhoto.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={styles.previewPlaceholder}>
              <Ionicons name="image-outline" size={48} color={theme.textMuted} />
            </View>
          )}
          {previewLayout.w > 0 && previewLayout.h > 0 && (
            <DraggablePreviewItem
              bounds={bounds}
              offset={metaOffset}
              fallbackPositionKey={metaPosition || 'left-bottom'}
              marginV={labelMarginVertical}
              marginH={labelMarginHorizontal}
              onOffsetChange={updateMetaOffset}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
              containerStyle={{ opacity: typeof metaOpacity === 'number' ? metaOpacity : 0.85 }}
            >
              <Text
                style={{
                  color: metaColor || '#FFFFFF',
                  fontSize: numericSize,
                  fontFamily: getPreviewFontFamily(metaFontFamily),
                  fontWeight: '700',
                  textShadowColor: 'rgba(0,0,0,0.5)',
                  textShadowRadius: 4,
                }}
                numberOfLines={2}
              >
                {captionText}
              </Text>
            </DraggablePreviewItem>
          )}
        </View>

        {/* ─── Fields ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>FIELDS</Text>
        <View style={styles.fieldPillRow}>
          {FIELD_DEFS.map((f) => {
            const active = !!fieldValue(f.key);
            return (
              <TouchableOpacity
                key={f.key}
                onPress={() => setMetaField(f.key, !active)}
                activeOpacity={0.8}
                style={[
                  styles.fieldPill,
                  {
                    backgroundColor: active ? theme.accent : theme.surface,
                    borderColor: active ? theme.accent : theme.border,
                  },
                ]}
              >
                <Ionicons
                  name={f.icon}
                  size={18}
                  color={active ? theme.accentText : theme.textPrimary}
                />
                <Text
                  style={[
                    styles.fieldPillLabel,
                    { color: active ? theme.accentText : theme.textPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {f.label === 'GPS coordinates' ? 'GPS' : f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ─── Controls ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>CONTROLS</Text>
        <View style={styles.controlsRow}>
          <ControlButton theme={theme} icon="text" label="Style" onPress={() => setFontModalVisible(true)} />
          <ControlButton theme={theme} icon="resize" label="Size" onPress={() => setSizeModalVisible(true)} />
          <ControlButton theme={theme} icon="move" label="Position" onPress={() => setPositionModalVisible(true)} />
        </View>
        <View style={[styles.controlsRow, { marginTop: 12 }]}>
          <ControlButton theme={theme} icon="swap-horizontal-outline" label="Margin" onPress={() => setMarginModalVisible(true)} />
          <ControlButton theme={theme} icon="contrast-outline" label="Opacity" onPress={() => setOpacityModalVisible(true)} />
        </View>

        {/* ─── Color ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>COLOR</Text>
        <View style={styles.swatchRow}>
          {COLORS.map((c) => {
            const isActive = metaColor === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => updateMetaColor(c)}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: c,
                    borderColor: isActive ? theme.accent : theme.border,
                    borderWidth: isActive ? 3 : StyleSheet.hairlineWidth,
                  },
                ]}
              />
            );
          })}
        </View>
      </ScrollView>

      {/* Font Modal */}
      <BottomModal visible={fontModalVisible} onClose={() => setFontModalVisible(false)} title="Text Style" theme={theme}>
        <View style={{ paddingVertical: 4 }}>
          {FONT_OPTIONS.map((font) => {
            const isSelected = metaFontFamily === font.key;
            return (
              <TouchableOpacity
                key={font.key}
                style={[
                  styles.fontListItem,
                  {
                    backgroundColor: isSelected ? theme.accent : theme.surfaceElevated,
                  },
                ]}
                onPress={async () => {
                  await updateMetaFontFamily(font.key);
                  setFontModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.fontListItemText,
                    {
                      color: isSelected ? theme.accentText : theme.textPrimary,
                      fontFamily: getPreviewFontFamily(font.key),
                    },
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
      <BottomModal visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} title="Text Size" theme={theme}>
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
            onValueChange={(v) => updateMetaFontSize(Math.round(v))}
            onSlidingComplete={(v) => updateMetaFontSize(Math.round(v))}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
      </BottomModal>

      {/* Position Modal */}
      <BottomModal visible={positionModalVisible} onClose={() => setPositionModalVisible(false)} title="Position" theme={theme}>
        <View style={[styles.positionGrid, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {POSITIONS.map((row, ri) => (
            <View key={ri} style={styles.positionRow}>
              {row.map((pos) => {
                const isActive = metaPosition === pos && !metaOffset;
                return (
                  <TouchableOpacity
                    key={pos}
                    onPress={async () => {
                      await updateMetaOffset(null);
                      await updateMetaPosition(pos);
                    }}
                    style={[
                      styles.positionCell,
                      {
                        backgroundColor: isActive ? theme.accent : theme.surfaceElevated,
                        borderColor: isActive ? theme.accent : theme.border,
                      },
                    ]}
                  >
                    {isActive && <Ionicons name="checkmark" size={16} color={theme.accentText} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
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
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{Math.round((metaOpacity ?? 0.85) * 100)}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={1}
            step={0.01}
            value={metaOpacity ?? 0.85}
            onValueChange={updateMetaOpacity}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
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
  fieldPillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldPillLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
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
  swatchRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  swatch: { width: 32, height: 32, borderRadius: 16 },
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
});

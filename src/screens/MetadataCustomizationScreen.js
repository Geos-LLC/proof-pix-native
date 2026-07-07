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
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useScopedSettings } from '../hooks/useScopedSettings';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';
import DraggablePreviewItem from '../components/DraggablePreviewItem';
import PositionGrid, { resolvePositionKey, POSITION_KEY_TO_OFFSET } from '../components/PositionGrid';
import ColorGridPicker from '../components/ColorGridPicker';
import { PHOTO_MODES } from '../constants/rooms';

const POSITIONS = [
  ['left-top', 'center-top', 'right-top'],
  ['left-middle', 'center-middle', 'right-middle'],
  ['left-bottom', 'center-bottom', 'right-bottom'],
];

const combinedGridLayout = (photo) => {
  if (!photo || photo.mode !== PHOTO_MODES.COMBINED) return 'single';
  const ar = photo.aspectRatio;
  if (typeof ar === 'string') {
    const [w, h] = ar.split(':').map(Number);
    if (w && h) return h > w ? 'side' : 'stack';
  }
  return 'side';
};

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

const FIELD_DEFS = [
  { key: 'date', tKey: 'metadata.fields.date', label: 'Date', icon: 'calendar-outline' },
  { key: 'time', tKey: 'metadata.fields.time', label: 'Time', icon: 'time-outline' },
  { key: 'address', tKey: 'metadata.fields.address', label: 'Address', icon: 'location-outline' },
  { key: 'gps', tKey: 'metadata.fields.gpsCoordinates', shortTKey: 'metadata.fields.gpsShort', label: 'GPS coordinates', shortLabel: 'GPS', icon: 'navigate-outline' },
];

// Map any saved size value (numeric or legacy string) to a numeric font
// size in pixels. The slider always writes numbers, but old saves may
// still be 'small'/'medium'/'large'.
const LEGACY_FONT_SIZE = { small: 11, medium: 14, large: 18 };
const toNumericFontSize = (v) => (typeof v === 'number' ? v : (LEGACY_FONT_SIZE[v] || 14));

export default function MetadataCustomizationScreen({ navigation, route }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { t } = useTranslation();
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
  } = useScopedSettings(route?.params?.photoId);

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
  const [colorModalVisible, setColorModalVisible] = useState(false);

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
  const captionText = parts.length ? parts.join(' · ') : t('metadata.previewFallback');

  const fieldValue = (key) => {
    if (key === 'date') return metaShowDate;
    if (key === 'time') return metaShowTime;
    if (key === 'address') return metaShowAddress;
    if (key === 'gps') return metaShowGps;
    return false;
  };

  return (
    // No `flex: 1` on the SafeAreaView — the parent sheet is presented
    // with sheetAllowedDetents='fitToContents' (see App.js), so we want
    // the sheet to hug the actual content height instead of stretching
    // to a full-screen detent and leaving a wide empty bar at the bottom.
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Unified sheet header — circular X on the left, centered title,
          balanced 36px spacer on the right. Same pattern used on
          Watermark + Labels so all three customization sheets read as
          one family. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerClose}>
          <Ionicons name="close" size={18} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('metadata.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* Preview removed — sheet opens over Studio so the photo
            behind it IS the preview. */}

        {/* ─── Fields ─── */}
        <Text style={styles.sectionLabel}>{t('metadata.fieldsEyebrow')}</Text>
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
                  {f.key === 'gps'
                    ? t(f.shortTKey, { defaultValue: f.shortLabel })
                    : t(f.tKey, { defaultValue: f.label })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ─── Controls ─── Color moved into the row as a dedicated tile
            that opens the shared ColorGridPicker modal — matches how
            Watermark exposes its color, so both surfaces feel the same. */}
        <Text style={styles.sectionLabel}>{t('metadata.controlsEyebrow')}</Text>
        <View style={styles.controlsRow}>
          <ControlButton styles={styles} theme={theme} icon="text" label={t('metadata.style')} onPress={() => setFontModalVisible(true)} />
          <ControlButton styles={styles} theme={theme} icon="resize" label={t('metadata.size')} onPress={() => setSizeModalVisible(true)} />
          <ControlButton styles={styles} theme={theme} icon="move" label={t('metadata.position')} onPress={() => setPositionModalVisible(true)} />
        </View>
        <View style={[styles.controlsRow, { marginTop: 12 }]}>
          <ControlButton styles={styles} theme={theme} icon="swap-horizontal-outline" label={t('metadata.margin')} onPress={() => setMarginModalVisible(true)} />
          <ControlButton styles={styles} theme={theme} icon="contrast-outline" label={t('metadata.opacity')} onPress={() => setOpacityModalVisible(true)} />
          <ColorButton styles={styles} theme={theme} color={metaColor || '#FFFFFF'} label={t('metadata.color')} onPress={() => setColorModalVisible(true)} />
        </View>
      </ScrollView>

      {/* Font Modal */}
      <BottomModal styles={styles} visible={fontModalVisible} onClose={() => setFontModalVisible(false)} title={t('metadata.textStyle')} theme={theme}>
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
      <BottomModal styles={styles} visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} title={t('metadata.textSize')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('metadata.fontSize')}</Text>
            <Text style={styles.modalLabelValue}>{numericSize}px</Text>
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
      <BottomModal styles={styles} visible={positionModalVisible} onClose={() => setPositionModalVisible(false)} title={t('metadata.position')} theme={theme}>
        <View style={{ padding: 16 }}>
          <PositionGrid
            layout={combinedGridLayout(previewPhoto)}
            mode="single"
            value={resolvePositionKey(metaOffset, metaPosition)}
            onChange={async (pos) => {
              // Write the explicit fractional offset for the picked
              // cell (not null) so the render's offset-first cascade
              // lands on the chosen corner. Previously we cleared the
              // offset and only wrote the position key — in per-photo
              // scope the cleared override let the global offset leak
              // through and dominate the position key, so the grid
              // pick had no visible effect. Legacy position key still
              // written for readers that fall back to it.
              await updateMetaOffset(POSITION_KEY_TO_OFFSET[pos]);
              await updateMetaPosition(pos);
            }}
            theme={theme}
          />
        </View>
      </BottomModal>

      {/* Margin Modal */}
      <BottomModal styles={styles} visible={marginModalVisible} onClose={() => setMarginModalVisible(false)} title={t('metadata.margin')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('metadata.marginVertical')}</Text>
            <Text style={styles.modalLabelValue}>{labelMarginVertical}px</Text>
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
            <Text style={styles.modalLabel}>{t('metadata.marginHorizontal')}</Text>
            <Text style={styles.modalLabelValue}>{labelMarginHorizontal}px</Text>
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
      <BottomModal styles={styles} visible={opacityModalVisible} onClose={() => setOpacityModalVisible(false)} title={t('metadata.opacity')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('metadata.opacity')}</Text>
            <Text style={styles.modalLabelValue}>{Math.round((metaOpacity ?? 0.85) * 100)}%</Text>
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

      {/* Color Modal — shared picker used by Labels + Watermark. Header
          hidden so the photo behind stays visible; grabber + tap-outside
          still close the sheet. */}
      <BottomModal styles={styles} visible={colorModalVisible} onClose={() => setColorModalVisible(false)} theme={theme} hideHeader>
        <ColorGridPicker
          theme={theme}
          value={metaColor || '#FFFFFF'}
          onChange={(hex) => updateMetaColor(hex)}
          onDone={() => setColorModalVisible(false)}
        />
      </BottomModal>
    </SafeAreaView>
  );
}

function ControlButton({ styles, theme, icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.controlSquare}>
        <Ionicons name={icon} size={22} color={theme.textPrimary} />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// Same shape as ControlButton, but the square shows a swatch of the
// current color instead of a monochrome icon — matches Watermark's
// ColorButton so the Metadata sheet reads consistently.
function ColorButton({ styles, theme, color, label, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.controlSquare}>
        <View style={[styles.colorSwatchInline, { backgroundColor: color, borderColor: theme.border }]} />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function BottomModal({ styles, visible, onClose, title, theme, children, hideHeader = false }) {
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.modalOverlay}
        onPress={onClose}
      >
        <View
          style={styles.modalContent}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.modalHandle} />
          {/* `hideHeader` skips the title bar entirely — used by the
              color modal so the photo behind stays visible while the
              user scans the grid. Grabber + tap-outside still close. */}
          {!hideHeader && (
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={onClose} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={theme.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{title}</Text>
              <View style={{ width: 22 }} />
            </View>
          )}
          <View style={styles.modalBody}>{children}</View>
        </View>
      </Pressable>
    </Modal>
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
  headerSpacer: { width: 36 },
  headerTitle: { fontFamily: FONTS.ALEXANDRIA, fontSize: 20, fontWeight: '700', color: theme.textPrimary },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    color: theme.textSecondary,
  },
  previewSquare: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
    marginTop: 8,
    borderColor: theme.border,
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
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  controlLabel: { fontFamily: FONTS.ALEXANDRIA, fontSize: 11, textAlign: 'center', color: theme.textSecondary },
  // Swatch inside the Color control tile — matches Watermark's version.
  colorSwatchInline: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  positionGrid: {
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    borderColor: theme.border,
  },
  positionRow: { flexDirection: 'row', gap: 8 },
  positionCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: theme.border,
  },
  // Legacy swatch row + swatch styles removed — Color now lives in the
  // controls row and opens the shared ColorGridPicker modal.
  modalOverlay: {
    flex: 1,
    // Transparent — user tweaks metadata overlay live on the Studio
    // photo behind, so no dim curtain.
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    backgroundColor: theme.surface,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: theme.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  modalClose: { padding: 4 },
  modalTitle: { fontFamily: FONTS.ALEXANDRIA, fontSize: 17, fontWeight: '700', color: theme.textPrimary },
  modalBody: { paddingHorizontal: 20 },
  modalSection: { marginBottom: 16 },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalLabel: { fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  modalLabelValue: { fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '700', color: theme.textPrimary },
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

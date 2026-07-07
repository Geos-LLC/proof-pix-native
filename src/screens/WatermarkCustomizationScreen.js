import React, { useMemo, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useScopedSettings } from '../hooks/useScopedSettings';
import { usePhotos } from '../context/PhotoContext';
import { useTheme } from '../hooks/useTheme';
import { useFeaturePermissions, FEATURES } from '../hooks/useFeaturePermissions';
import { PAYWALL_TRIGGERS } from '../constants/softTrial';
import DraggablePreviewItem from '../components/DraggablePreviewItem';
import PositionGrid, { resolvePositionKey, POSITION_KEY_TO_OFFSET } from '../components/PositionGrid';
import ColorGridPicker from '../components/ColorGridPicker';
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
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { t } = useTranslation();
  const { canUse } = useFeaturePermissions();
  // Starter tier can still land on this screen — they get a stripped-down
  // version with ONLY the Position control unlocked. Everything else
  // (custom text toggle, text/link inputs, font, size, margin, opacity,
  // color) is hidden and swapped for a single "Upgrade to Pro" hint,
  // per product spec: "user can change the location of the mark, but not
  // change it or turn it off." The previous auto-redirect to
  // PlanSelection was too aggressive — users often just want to move the
  // default watermark to a different corner and shouldn't be forced
  // through the paywall to do so.
  const canCustomize = canUse(FEATURES.CUSTOM_WATERMARKS);
  const openPaywall = () => {
    navigation.navigate('PlanSelection', {
      mode: 'upgrade',
      trigger: PAYWALL_TRIGGERS.WATERMARK,
    });
  };

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
    // No `flex: 1` on the SafeAreaView — the parent sheet is presented
    // with sheetAllowedDetents='fitToContents' (see App.js), so we want
    // the sheet to hug the actual content height instead of stretching
    // to a full-screen detent and leaving a wide empty bar at the bottom.
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Unified sheet header — circular X on the left, centered title,
          balanced 36px spacer on the right. No border divider below;
          the same pattern is used on Metadata + Labels so all three
          customization sheets read as one family. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.headerClose}>
          <Ionicons name="close" size={18} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('watermark.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
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

          {/* Menu is identical for every tier — the paywall fires only on
              the actions that require CUSTOM_WATERMARKS. Position is the
              one free customization for starter. */}
          <Text style={styles.sectionLabel}>{t('watermark.customTextLabel')}</Text>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{t('watermark.useCustomToggle')}</Text>
            <Switch
              value={!!customWatermarkEnabled}
              onValueChange={(v) => {
                // Flipping to ON = enabling customization. Starter can't,
                // paywall. Flipping OFF is fine — that just restores the
                // default text.
                if (v && !canCustomize) { openPaywall(); return; }
                toggleWatermark(v);
              }}
              trackColor={{ false: theme.border, true: theme.accent }}
              thumbColor="#FFFFFF"
            />
          </View>

          {customWatermarkEnabled && (
            <>
              <TextInput
                style={styles.input}
                value={watermarkText}
                onChangeText={(txt) => { if (!canCustomize) { openPaywall(); return; } updateWatermarkText(txt); }}
                placeholder={t('watermark.textPlaceholder')}
                placeholderTextColor={theme.textMuted}
                editable={canCustomize}
              />
              <TextInput
                style={styles.input}
                value={watermarkLink}
                onChangeText={(txt) => { if (!canCustomize) { openPaywall(); return; } updateWatermarkLink(txt); }}
                placeholder={t('watermark.linkPlaceholder')}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                editable={canCustomize}
              />
            </>
          )}

          {/* Controls — same 6 buttons for every tier. Position is free.
              Font / Size / Margin / Opacity / Color kick starter to the
              paywall on tap. */}
          <Text style={styles.sectionLabel}>{t('watermark.controlsLabel')}</Text>
          <View style={styles.controlsRow}>
            <ControlButton styles={styles} theme={theme} icon="text" label={t('watermark.controls.font')} onPress={() => { if (!canCustomize) { openPaywall(); return; } setFontModalVisible(true); }} />
            <ControlButton styles={styles} theme={theme} icon="resize" label={t('watermark.controls.size')} onPress={() => { if (!canCustomize) { openPaywall(); return; } setSizeModalVisible(true); }} />
            <ControlButton styles={styles} theme={theme} icon="move" label={t('watermark.controls.position')} onPress={() => setPositionModalVisible(true)} />
          </View>
          <View style={[styles.controlsRow, { marginTop: 12 }]}>
            <ControlButton styles={styles} theme={theme} icon="swap-horizontal-outline" label={t('watermark.controls.margin')} onPress={() => { if (!canCustomize) { openPaywall(); return; } setMarginModalVisible(true); }} />
            <ControlButton styles={styles} theme={theme} icon="contrast-outline" label={t('watermark.controls.opacity')} onPress={() => { if (!canCustomize) { openPaywall(); return; } setOpacityModalVisible(true); }} />
            <ColorButton styles={styles} theme={theme} color={watermarkColor || '#FFD700'} label={t('watermark.controls.color')} onPress={() => { if (!canCustomize) { openPaywall(); return; } setColorModalVisible(true); }} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Font Modal */}
      <BottomModal styles={styles} visible={fontModalVisible} onClose={() => setFontModalVisible(false)} title={t('watermark.fontModalTitle')} theme={theme}>
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
      <BottomModal styles={styles} visible={sizeModalVisible} onClose={() => setSizeModalVisible(false)} title={t('watermark.sizeModalTitle')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('watermark.fontSizeLabel')}</Text>
            <Text style={styles.modalLabelValue}>{numericSize}px</Text>
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
      <BottomModal styles={styles} visible={positionModalVisible} onClose={() => setPositionModalVisible(false)} title={t('watermark.positionTitle')} theme={theme}>
        <View style={{ padding: 16 }}>
          <PositionGrid
            layout={combinedGridLayout(previewPhoto)}
            mode="single"
            value={resolvePositionKey(watermarkOffset, watermarkPosition)}
            onChange={async (pos) => {
              // See MetadataCustomizationScreen note — write the
              // explicit fractional offset so per-photo overrides land
              // on the chosen corner instead of falling through to a
              // leaked global offset.
              await updateWatermarkOffset(POSITION_KEY_TO_OFFSET[pos]);
              await updateWatermarkPosition(pos);
            }}
            theme={theme}
          />
        </View>
      </BottomModal>

      {/* Margin Modal */}
      <BottomModal styles={styles} visible={marginModalVisible} onClose={() => setMarginModalVisible(false)} title={t('watermark.marginTitle')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('watermark.marginVertical')}</Text>
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
            <Text style={styles.modalLabel}>{t('watermark.marginHorizontal')}</Text>
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
      <BottomModal styles={styles} visible={opacityModalVisible} onClose={() => setOpacityModalVisible(false)} title={t('watermark.opacityTitle')} theme={theme}>
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('watermark.opacityLabel')}</Text>
            <Text style={styles.modalLabelValue}>{Math.round((watermarkOpacity ?? 0.5) * 100)}%</Text>
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

      {/* Color Modal — same picker Labels uses. Header hidden so the
          photo behind stays visible; grabber + tap-outside close still
          available. */}
      <BottomModal styles={styles} visible={colorModalVisible} onClose={() => setColorModalVisible(false)} theme={theme} hideHeader>
        <ColorGridPicker
          theme={theme}
          value={watermarkColor || '#FFD700'}
          onChange={(hex) => updateWatermarkColor(hex)}
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

function ColorButton({ styles, theme, color, label, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.controlSquare}>
        <View style={[styles.colorSwatchInline, { backgroundColor: color }]} />
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
              color modal so the photo behind stays visible as the user
              scans the grid live. Grabber stays for the drag-to-close
              affordance; tap-outside also closes via the Pressable. */}
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  toggleLabel: { flex: 1, fontFamily: FONTS.ALEXANDRIA, fontSize: 14, fontWeight: '600', color: theme.textPrimary },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    marginTop: 8,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    color: theme.textPrimary,
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
  colorSwatchInline: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
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
  modalOverlay: {
    flex: 1,
    // Transparent — keep the Studio picture visible while the user
    // tweaks watermark controls in the modal submenus.
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
  colorPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20 },
});

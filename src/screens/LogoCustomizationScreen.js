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
  Alert,
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

// Legacy string sizes mapped to pixels — only used when the user hasn't
// touched the new slider yet.
const LEGACY_SIZE_PX = { small: 40, medium: 60, large: 84 };

export default function LogoCustomizationScreen({ navigation, route }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { t } = useTranslation();
  const {
    brandLogoUri,
    updateBrandLogoUri,
    brandLogoPosition,
    updateBrandLogoPosition,
    brandLogoSize,
    updateBrandLogoSize,
    brandLogoOffset,
    updateBrandLogoOffset,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
  } = useScopedSettings(route?.params?.photoId);

  const photoId = route?.params?.photoId;
  const { photos } = usePhotos();
  const previewPhoto = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  const numericSize = typeof brandLogoSize === 'number'
    ? brandLogoSize
    : (LEGACY_SIZE_PX[brandLogoSize] || 60);

  const [previewLayout, setPreviewLayout] = useState({ w: 0, h: 0 });
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [marginModalVisible, setMarginModalVisible] = useState(false);

  const onPreviewLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setPreviewLayout((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const bounds = { x: 0, y: 0, w: previewLayout.w, h: previewLayout.h };

  const pickLogo = async () => {
    try {
      const ImagePicker = require('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('logoCustomization.permissionNeededTitle'), t('logoCustomization.permissionNeededMessage'));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
      });
      const uri = result?.assets?.[0]?.uri;
      if (uri && !result.canceled) await updateBrandLogoUri(uri);
    } catch (e) {
      Alert.alert(t('logoCustomization.couldNotOpenLibrary'), e?.message || t('common.unknownError'));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('logoCustomization.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* Preview removed — sheet opens over Studio so the photo
            behind it IS the preview. */}

        {/* ─── Upload ─── */}
        <Text style={styles.sectionLabel}>{t('logoCustomization.uploadEyebrow')}</Text>
        <View style={styles.uploadCard}>
          <View style={styles.logoPreview}>
            {brandLogoUri ? (
              <Image source={{ uri: brandLogoUri }} style={styles.logoPreviewImg} resizeMode="contain" />
            ) : (
              <Ionicons name="image-outline" size={36} color={theme.textMuted} />
            )}
          </View>
          <View style={styles.uploadActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.accent }]}
              onPress={pickLogo}
            >
              <Ionicons name="cloud-upload-outline" size={14} color={theme.accentText} />
              <Text style={[styles.actionBtnText, { color: theme.accentText }]}>
                {brandLogoUri ? t('logoCustomization.replace') : t('logoCustomization.upload')}
              </Text>
            </TouchableOpacity>
            {brandLogoUri && (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                ]}
                onPress={() => updateBrandLogoUri(null)}
              >
                <Ionicons name="trash-outline" size={14} color={theme.danger} />
                <Text style={[styles.actionBtnText, { color: theme.danger }]}>{t('logoCustomization.remove')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ─── Controls ─── */}
        <Text style={styles.sectionLabel}>{t('logoCustomization.controlsEyebrow')}</Text>
        <View style={styles.controlsRow}>
          <ControlButton
            styles={styles}
            theme={theme}
            icon="resize"
            label={t('logoCustomization.size')}
            onPress={() => setSizeModalVisible(true)}
          />
          <ControlButton
            styles={styles}
            theme={theme}
            icon="move"
            label={t('logoCustomization.position')}
            onPress={() => setPositionModalVisible(true)}
          />
          <ControlButton
            styles={styles}
            theme={theme}
            icon="swap-horizontal-outline"
            label={t('logoCustomization.margin')}
            onPress={() => setMarginModalVisible(true)}
          />
        </View>
      </ScrollView>

      {/* Size Modal — continuous slider, 20–200px. */}
      <BottomModal
        styles={styles}
        visible={sizeModalVisible}
        onClose={() => setSizeModalVisible(false)}
        title={t('logoCustomization.logoSize')}
        theme={theme}
      >
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('logoCustomization.logoSizeLabel')}</Text>
            <Text style={styles.modalLabelValue}>{numericSize}px</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={20}
            maximumValue={200}
            step={1}
            value={numericSize}
            onValueChange={(v) => updateBrandLogoSize(Math.round(v))}
            onSlidingComplete={(v) => updateBrandLogoSize(Math.round(v))}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
        </View>
      </BottomModal>

      {/* Position Modal — same 9-cell grid as Labels. */}
      <BottomModal
        styles={styles}
        visible={positionModalVisible}
        onClose={() => setPositionModalVisible(false)}
        title={t('logoCustomization.logoPosition')}
        theme={theme}
      >
        <View style={{ padding: 16 }}>
          <PositionGrid
            layout={combinedGridLayout(previewPhoto)}
            mode="single"
            value={resolvePositionKey(brandLogoOffset, brandLogoPosition)}
            onChange={async (pos) => {
              // See MetadataCustomizationScreen note — write the
              // explicit fractional offset so per-photo overrides land
              // on the chosen corner instead of falling through to a
              // leaked global offset.
              await updateBrandLogoOffset(POSITION_KEY_TO_OFFSET[pos]);
              await updateBrandLogoPosition(pos);
            }}
            theme={theme}
          />
        </View>
      </BottomModal>

      {/* Margin Modal — shared labelMargin values, so all overlays use the
          same offset from the chosen grid corner. */}
      <BottomModal
        styles={styles}
        visible={marginModalVisible}
        onClose={() => setMarginModalVisible(false)}
        title={t('logoCustomization.marginTitle')}
        theme={theme}
      >
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={styles.modalLabel}>{t('logoCustomization.marginVertical')}</Text>
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
            <Text style={styles.modalLabel}>{t('logoCustomization.marginHorizontal')}</Text>
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

function BottomModal({ styles, visible, onClose, title, theme, children }) {
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
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={theme.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{title}</Text>
            <View style={{ width: 22 }} />
          </View>
          <View style={styles.modalBody}>{children}</View>
        </View>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontFamily: FONTS.ALEXANDRIA, fontSize: 17, fontWeight: '700', color: theme.textPrimary },
  body: { paddingHorizontal: 16, paddingBottom: 32 },
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
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  logoPreview: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: theme.surfaceElevated,
    borderColor: theme.border,
  },
  logoPreviewImg: { width: '100%', height: '100%' },
  uploadActions: { flex: 1, gap: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100,
  },
  actionBtnText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 12, fontWeight: '700' },
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
    // Transparent — user tweaks logo overlay live on the Studio photo.
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
});

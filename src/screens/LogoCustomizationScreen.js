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

// Legacy string sizes mapped to pixels — only used when the user hasn't
// touched the new slider yet.
const LEGACY_SIZE_PX = { small: 40, medium: 60, large: 84 };

export default function LogoCustomizationScreen({ navigation, route }) {
  const theme = useTheme();
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
  } = useSettings();

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
        Alert.alert('Permission needed', 'Photo library access is required to upload a logo.');
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
      Alert.alert("Couldn't open library", e?.message || 'Unknown error');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Logo</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        scrollEnabled={scrollEnabled}
      >
        {/* Real photo preview with draggable logo overlay. */}
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
          {brandLogoUri && previewLayout.w > 0 && previewLayout.h > 0 && (
            <DraggablePreviewItem
              bounds={bounds}
              offset={brandLogoOffset}
              fallbackPositionKey={brandLogoPosition || 'right-bottom'}
              marginV={labelMarginVertical}
              marginH={labelMarginHorizontal}
              onOffsetChange={updateBrandLogoOffset}
              onDragStart={() => setScrollEnabled(false)}
              onDragEnd={() => setScrollEnabled(true)}
            >
              <Image
                source={{ uri: brandLogoUri }}
                style={{ width: numericSize, height: numericSize }}
                resizeMode="contain"
              />
            </DraggablePreviewItem>
          )}
        </View>

        {/* ─── Upload ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>UPLOAD</Text>
        <View style={[styles.uploadCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.logoPreview, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
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
                {brandLogoUri ? 'Replace' : 'Upload'}
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
                <Text style={[styles.actionBtnText, { color: theme.danger }]}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ─── Controls ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>CONTROLS</Text>
        <View style={styles.controlsRow}>
          <ControlButton
            theme={theme}
            icon="resize"
            label="Size"
            onPress={() => setSizeModalVisible(true)}
          />
          <ControlButton
            theme={theme}
            icon="move"
            label="Position"
            onPress={() => setPositionModalVisible(true)}
          />
          <ControlButton
            theme={theme}
            icon="swap-horizontal-outline"
            label="Margin"
            onPress={() => setMarginModalVisible(true)}
          />
        </View>
      </ScrollView>

      {/* Size Modal — continuous slider, 20–200px. */}
      <BottomModal
        visible={sizeModalVisible}
        onClose={() => setSizeModalVisible(false)}
        title="Logo Size"
        theme={theme}
      >
        <View style={styles.modalSection}>
          <View style={styles.sliderHeader}>
            <Text style={[styles.modalLabel, { color: theme.textPrimary }]}>Logo size</Text>
            <Text style={[styles.modalLabelValue, { color: theme.textPrimary }]}>{numericSize}px</Text>
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
        visible={positionModalVisible}
        onClose={() => setPositionModalVisible(false)}
        title="Logo Position"
        theme={theme}
      >
        <View style={[styles.positionGrid, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {POSITIONS.map((row, ri) => (
            <View key={ri} style={styles.positionRow}>
              {row.map((pos) => {
                const isActive = brandLogoPosition === pos && !brandLogoOffset;
                return (
                  <TouchableOpacity
                    key={pos}
                    onPress={async () => {
                      await updateBrandLogoOffset(null);
                      await updateBrandLogoPosition(pos);
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

      {/* Margin Modal — shared labelMargin values, so all overlays use the
          same offset from the chosen grid corner. */}
      <BottomModal
        visible={marginModalVisible}
        onClose={() => setMarginModalVisible(false)}
        title="Margin"
        theme={theme}
      >
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
      <Pressable style={styles.modalOverlay} onPress={onClose}>
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
  uploadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoPreview: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
});

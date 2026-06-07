import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';

const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export default function BrandingSettingsScreen({ navigation }) {
  const theme = useTheme();
  const {
    brandLogoUri,
    reportBrandLogoUri,
    reportCompanyName,
    reportBrandColor,
    updateReportBrandLogoUri,
    updateReportCompanyName,
    updateReportBrandColor,
  } = useSettings();

  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [draftColor, setDraftColor] = useState(reportBrandColor || '#1A1A1A');
  const [colorError, setColorError] = useState(null);

  const effectiveLogo = reportBrandLogoUri || brandLogoUri;

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
        aspect: [4, 3],
        quality: 0.9,
      });
      const uri = result?.assets?.[0]?.uri;
      if (uri && !result.canceled) await updateReportBrandLogoUri(uri);
    } catch (e) {
      Alert.alert("Couldn't open library", e?.message || 'Unknown error');
    }
  };

  const handleColorInput = (text) => {
    const val = text.trim().toUpperCase();
    setDraftColor(val.startsWith('#') ? val : `#${val}`);
    setColorError(null);
  };

  const applyColor = () => {
    const normalized = draftColor.startsWith('#') ? draftColor : `#${draftColor}`;
    if (!HEX_REGEX.test(normalized)) {
      setColorError('Enter a valid hex color e.g. #1A2B3C');
      return;
    }
    updateReportBrandColor(normalized);
    setColorModalVisible(false);
    setColorError(null);
  };

  const PRESET_COLORS = [
    '#1A1A1A', '#2C3E50', '#1E3A5F', '#2D6A4F',
    '#6B2D8B', '#C0392B', '#E67E22', '#27AE60',
    '#2980B9', '#8E44AD', '#F2C31B', '#FFFFFF',
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Report Branding</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={[styles.infoText, { color: theme.textSecondary }]}>
          Report branding appears on the title sheet and header of generated reports. If no report logo is set, the logo from the photo editor (Logo settings) will be used instead.
        </Text>

        {/* ─── Logo ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>LOGO</Text>
        <View style={[styles.uploadCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.logoPreview, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            {effectiveLogo ? (
              <Image source={{ uri: effectiveLogo }} style={styles.logoPreviewImg} resizeMode="contain" />
            ) : (
              <Ionicons name="business-outline" size={36} color={theme.textMuted} />
            )}
          </View>
          <View style={styles.uploadActions}>
            {!reportBrandLogoUri && brandLogoUri && (
              <Text style={[styles.fallbackNote, { color: theme.textMuted }]}>
                Using logo from editor settings
              </Text>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: theme.accent }]}
              onPress={pickLogo}
            >
              <Ionicons name="cloud-upload-outline" size={14} color={theme.accentText} />
              <Text style={[styles.actionBtnText, { color: theme.accentText }]}>
                {reportBrandLogoUri ? 'Replace' : 'Upload'}
              </Text>
            </TouchableOpacity>
            {reportBrandLogoUri && (
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth },
                ]}
                onPress={() => updateReportBrandLogoUri(null)}
              >
                <Ionicons name="trash-outline" size={14} color={theme.danger} />
                <Text style={[styles.actionBtnText, { color: theme.danger }]}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ─── Company Name ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>COMPANY NAME</Text>
        <View style={[styles.inputCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TextInput
            value={reportCompanyName}
            onChangeText={updateReportCompanyName}
            placeholder="Enter company or team name"
            placeholderTextColor={theme.textMuted}
            style={[styles.textInput, { color: theme.textPrimary }]}
            maxLength={80}
            returnKeyType="done"
          />
        </View>
        <Text style={[styles.fieldHint, { color: theme.textMuted }]}>
          Appears under the logo in the report header.
        </Text>

        {/* ─── Brand Color ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>BRAND COLOR</Text>
        <TouchableOpacity
          style={[styles.colorRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => {
            setDraftColor(reportBrandColor || '#1A1A1A');
            setColorError(null);
            setColorModalVisible(true);
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.colorSwatch, { backgroundColor: reportBrandColor || '#1A1A1A', borderColor: theme.border }]} />
          <Text style={[styles.colorValue, { color: theme.textPrimary }]}>
            {(reportBrandColor || '#1A1A1A').toUpperCase()}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
        <Text style={[styles.fieldHint, { color: theme.textMuted }]}>
          Used for report header border and accent elements.
        </Text>

        {/* ─── Preview ─── */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>PREVIEW</Text>
        <View style={[styles.previewCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.previewHeader, { borderBottomColor: reportBrandColor || '#1A1A1A' }]}>
            {effectiveLogo && (
              <Image source={{ uri: effectiveLogo }} style={styles.previewLogo} resizeMode="contain" />
            )}
            <View style={styles.previewText}>
              {reportCompanyName ? (
                <Text style={[styles.previewCompany, { color: theme.textPrimary }]} numberOfLines={1}>
                  {reportCompanyName}
                </Text>
              ) : null}
              <Text style={[styles.previewTitle, { color: theme.textSecondary }]} numberOfLines={1}>
                Sample Report Title
              </Text>
            </View>
          </View>
          <Text style={[styles.previewNote, { color: theme.textMuted }]}>
            Report header preview
          </Text>
        </View>
      </ScrollView>

      {/* Color Picker Modal */}
      <Modal
        visible={colorModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setColorModalVisible(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: theme.scrim || 'rgba(0,0,0,0.5)' }]}
          onPress={() => setColorModalVisible(false)}
        >
          <View
            style={[styles.modalContent, { backgroundColor: theme.surface }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.modalHandle, { backgroundColor: theme.border }]} />
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setColorModalVisible(false)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color={theme.textPrimary} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>Brand Color</Text>
              <View style={{ width: 22 }} />
            </View>

            <View style={styles.modalBody}>
              <Text style={[styles.colorPickerLabel, { color: theme.textSecondary }]}>PRESETS</Text>
              <View style={styles.presetsGrid}>
                {PRESET_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => {
                      setDraftColor(c);
                      setColorError(null);
                    }}
                    style={[
                      styles.presetSwatch,
                      {
                        backgroundColor: c,
                        borderColor: draftColor === c ? theme.accent : theme.border,
                        borderWidth: draftColor === c ? 2 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  />
                ))}
              </View>

              <Text style={[styles.colorPickerLabel, { color: theme.textSecondary }]}>HEX</Text>
              <View style={[styles.hexInputRow, { borderColor: colorError ? theme.danger : theme.border }]}>
                <View style={[styles.hexSwatch, { backgroundColor: HEX_REGEX.test(draftColor) ? draftColor : '#E0E0E0' }]} />
                <TextInput
                  value={draftColor}
                  onChangeText={handleColorInput}
                  placeholder="#1A1A1A"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.hexInput, { color: theme.textPrimary }]}
                  autoCapitalize="characters"
                  maxLength={7}
                />
              </View>
              {colorError && (
                <Text style={[styles.colorError, { color: theme.danger }]}>{colorError}</Text>
              )}

              <TouchableOpacity
                style={[styles.applyBtn, { backgroundColor: theme.accent }]}
                onPress={applyColor}
              >
                <Text style={[styles.applyBtnText, { color: theme.accentText }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
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
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  infoText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 4,
  },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
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
    width: 72,
    height: 54,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoPreviewImg: { width: '100%', height: '100%' },
  uploadActions: { flex: 1, gap: 8 },
  fallbackNote: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 2,
  },
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
  inputCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  textInput: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    paddingVertical: 12,
  },
  fieldHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 2,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  colorValue: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderBottomWidth: 2,
  },
  previewLogo: {
    width: 48,
    height: 36,
    borderRadius: 4,
  },
  previewText: { flex: 1 },
  previewCompany: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  previewTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
  },
  previewNote: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    textAlign: 'center',
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
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
  colorPickerLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  presetSwatch: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  hexInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 10,
    marginBottom: 4,
  },
  hexSwatch: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  hexInput: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    paddingVertical: 8,
  },
  colorError: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    marginBottom: 8,
  },
  applyBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  applyBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
});

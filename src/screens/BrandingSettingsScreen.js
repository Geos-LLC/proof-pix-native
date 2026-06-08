import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';

const PRESET_COLORS = [
  '#F2C31B',
  '#1A73E8',
  '#E53935',
  '#43A047',
  '#FB8C00',
  '#8E24AA',
  '#00ACC1',
  '#1A1A1A',
];

export default function BrandingSettingsScreen({ navigation }) {
  const theme = useTheme();
  const {
    reportBrandLogoUri,
    updateReportBrandLogoUri,
    reportCompanyName,
    updateReportCompanyName,
    reportBrandColor,
    updateReportBrandColor,
  } = useSettings();

  const [customColorInput, setCustomColorInput] = useState('');
  const [editingCustomColor, setEditingCustomColor] = useState(false);

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
        quality: 0.9,
      });
      const uri = result?.assets?.[0]?.uri;
      if (uri && !result.canceled) await updateReportBrandLogoUri(uri);
    } catch (e) {
      Alert.alert("Couldn't open library", e?.message || 'Unknown error');
    }
  };

  const removeLogo = () => {
    Alert.alert('Remove logo', 'Remove the report branding logo?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => updateReportBrandLogoUri(null) },
    ]);
  };

  const applyCustomColor = () => {
    const raw = customColorInput.trim();
    const hex = raw.startsWith('#') ? raw : `#${raw}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      updateReportBrandColor(hex);
      setEditingCustomColor(false);
      setCustomColorInput('');
    } else {
      Alert.alert('Invalid color', 'Enter a 6-digit hex color, e.g. #1A73E8');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Report Branding</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.sectionNote, { color: theme.textSecondary }]}>
          Report branding appears in the header of generated reports (logo, company name, accent color). This is separate from the photo-editor logo overlay.
        </Text>

        {/* Logo */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>REPORT LOGO</Text>
        {reportBrandLogoUri ? (
          <View style={[styles.logoRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Image source={{ uri: reportBrandLogoUri }} style={styles.logoThumb} resizeMode="contain" />
            <View style={styles.logoActions}>
              <TouchableOpacity onPress={pickLogo} style={[styles.logoBtn, { borderColor: theme.accent }]}>
                <Text style={[styles.logoBtnText, { color: theme.accent }]}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={removeLogo} style={[styles.logoBtn, { borderColor: '#E53935' }]}>
                <Text style={[styles.logoBtnText, { color: '#E53935' }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.uploadBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={pickLogo}
            activeOpacity={0.7}
          >
            <Ionicons name="image-outline" size={24} color={theme.textSecondary} />
            <Text style={[styles.uploadBtnText, { color: theme.textSecondary }]}>Upload Report Logo</Text>
          </TouchableOpacity>
        )}

        {/* Company name */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>COMPANY / TEAM NAME</Text>
        <TextInput
          value={reportCompanyName}
          onChangeText={updateReportCompanyName}
          placeholder="e.g. Acme Inspections"
          placeholderTextColor={theme.textMuted}
          style={[styles.textInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
        />

        {/* Brand color */}
        <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>ACCENT COLOR</Text>
        <View style={styles.colorGrid}>
          {PRESET_COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => updateReportBrandColor(c)}
              style={[
                styles.colorSwatch,
                { backgroundColor: c },
                reportBrandColor === c && styles.colorSwatchSelected,
              ]}
              activeOpacity={0.8}
            >
              {reportBrandColor === c && (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.currentColorRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.currentColorSwatch, { backgroundColor: reportBrandColor }]} />
          <Text style={[styles.currentColorHex, { color: theme.textPrimary }]}>{reportBrandColor}</Text>
          <TouchableOpacity onPress={() => setEditingCustomColor(!editingCustomColor)} style={styles.customColorBtn}>
            <Text style={[styles.customColorBtnText, { color: theme.accent }]}>Custom</Text>
          </TouchableOpacity>
        </View>

        {editingCustomColor && (
          <View style={[styles.customColorInput, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TextInput
              value={customColorInput}
              onChangeText={setCustomColorInput}
              placeholder="#1A73E8"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="characters"
              maxLength={7}
              style={[styles.hexInput, { color: theme.textPrimary }]}
            />
            <TouchableOpacity onPress={applyCustomColor} style={[styles.applyBtn, { backgroundColor: theme.accent }]}>
              <Text style={[styles.applyBtnText, { color: theme.accentText || '#FFFFFF' }]}>Apply</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.previewBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.previewLabel, { color: theme.textSecondary }]}>PREVIEW</Text>
          <View style={[styles.reportHeaderPreview, { borderLeftColor: reportBrandColor }]}>
            {reportBrandLogoUri ? (
              <Image source={{ uri: reportBrandLogoUri }} style={styles.previewLogo} resizeMode="contain" />
            ) : (
              <View style={[styles.previewLogoPlaceholder, { backgroundColor: theme.border }]}>
                <Ionicons name="image-outline" size={18} color={theme.textMuted} />
              </View>
            )}
            <View style={styles.previewText}>
              {reportCompanyName ? (
                <Text style={[styles.previewCompany, { color: theme.textSecondary }]}>{reportCompanyName.toUpperCase()}</Text>
              ) : null}
              <Text style={[styles.previewTitle, { color: theme.textPrimary }]}>Report Title</Text>
              <Text style={[styles.previewSub, { color: theme.textSecondary }]}>Generated today</Text>
            </View>
          </View>
        </View>
      </ScrollView>
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionNote: { fontSize: 13, lineHeight: 18, marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8, marginTop: 20 },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  logoThumb: { width: 72, height: 48, borderRadius: 4 },
  logoActions: { flexDirection: 'row', gap: 10, marginLeft: 12 },
  logoBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  logoBtnText: { fontSize: 13, fontWeight: '600' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    marginBottom: 4,
  },
  uploadBtnText: { fontSize: 14 },
  textInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 4,
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  currentColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  currentColorSwatch: { width: 24, height: 24, borderRadius: 12, marginRight: 10 },
  currentColorHex: { flex: 1, fontSize: 14, fontFamily: 'monospace' },
  customColorBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  customColorBtnText: { fontSize: 13, fontWeight: '600' },
  customColorInput: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    gap: 10,
  },
  hexInput: { flex: 1, fontSize: 15, fontFamily: 'monospace' },
  applyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  applyBtnText: { fontSize: 13, fontWeight: '600' },
  previewBox: {
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
  },
  previewLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  reportHeaderPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    borderLeftWidth: 4,
    paddingLeft: 12,
    gap: 12,
  },
  previewLogo: { width: 56, height: 40, borderRadius: 4 },
  previewLogoPlaceholder: { width: 56, height: 40, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  previewText: { flex: 1 },
  previewCompany: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  previewTitle: { fontSize: 16, fontWeight: '700' },
  previewSub: { fontSize: 11, marginTop: 2 },
});

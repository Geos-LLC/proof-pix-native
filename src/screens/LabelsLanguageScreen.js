import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { COLORS } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';

// LabelsLanguageScreen — dedicated route.
//
// Layout: header + grouped rows. Each row drills into an existing
// detail screen so we don't duplicate the editing UI. Watermark / Logo
// / Metadata customization screens already exist with their own
// preview canvases + bottom-sheet controls, so they're surfaced here
// as row entries.
//
// Rows:
//   • Labels             → LabelCustomization
//   • Watermark          → WatermarkCustomization
//   • Logo               → LogoCustomization
//   • Metadata           → MetadataCustomization
//   • Label language     → LabelLanguageSetup
//   • Upload structure   → navigates back to Settings with
//                          { scrollToUploadStructure: true } since
//                          that block lives inline in Settings only.

export default function LabelsLanguageScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    showLabels,
    toggleLabels,
    showWatermark,
    updateShowWatermark,
    showPreviewMetadata,
    togglePreviewMetadata,
    showBrandLogo,
    updateShowBrandLogo,
    brandLogoUri,
    splitPhotosByDate,
    updateSplitPhotosByDate,
    customWatermarkEnabled,
  } = useSettings();
  const { canUse } = useFeaturePermissions();

  const labelLanguageSubtitle = useLabelLanguageSubtitle();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#1E1E1E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('labelsLanguage.title', { defaultValue: 'Labels & language' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* Defaults note — these settings apply to NEW photos by
            default; the user can override on any individual picture,
            folder, or project from the editor's Save scope sheet. */}
        <View style={styles.defaultsNote}>
          <Ionicons name="information-circle-outline" size={16} color="#7A5B00" />
          <Text style={styles.defaultsNoteText}>
            {t('labelsLanguage.defaultsNote', {
              defaultValue:
                'These are your defaults. You can change them in the editor for an individual picture, a folder, or a project.',
            })}
          </Text>
        </View>

        <Text style={styles.eyebrow}>
          {t('labelsLanguage.brandingEyebrow', { defaultValue: 'Branding' })}
        </Text>

        <View style={styles.rowGroup}>
          <BrandTile
            icon="pricetag-outline"
            title={t('labelsLanguage.labels', { defaultValue: 'Labels' })}
            subtitle={t('labelsLanguage.labelsSub', { defaultValue: 'Before / After captions on every photo' })}
            switchValue={!!showLabels}
            onSwitch={toggleLabels}
            onPress={() => navigation.navigate('LabelCustomization')}
          />
          <BrandTile
            icon="copy-outline"
            title={t('labelsLanguage.watermark', { defaultValue: 'Watermark' })}
            subtitle={t('labelsLanguage.watermarkSub', { defaultValue: 'Brand mark on shared photos' })}
            switchValue={!!showWatermark}
            onSwitch={updateShowWatermark}
            onPress={() => navigation.navigate('WatermarkCustomization')}
          />
          <BrandTile
            icon="image-outline"
            title={t('labelsLanguage.logo', { defaultValue: 'Logo' })}
            subtitle={brandLogoUri
              ? t('labelsLanguage.logoUploaded', { defaultValue: 'Uploaded · placement & size' })
              : t('labelsLanguage.logoNotUploaded', { defaultValue: 'Upload your company logo' })}
            switchValue={!!showBrandLogo && !!brandLogoUri}
            switchDisabled={!brandLogoUri}
            onSwitch={updateShowBrandLogo}
            onPress={() => navigation.navigate('LogoCustomization')}
          />
          <BrandTile
            icon="information-circle-outline"
            title={t('labelsLanguage.metadata', { defaultValue: 'Metadata' })}
            subtitle={t('labelsLanguage.metadataSub', { defaultValue: 'Date · time · address overlays' })}
            switchValue={!!showPreviewMetadata}
            onSwitch={togglePreviewMetadata}
            onPress={() => navigation.navigate('MetadataCustomization')}
          />
        </View>

        <Text style={styles.eyebrow}>
          {t('labelsLanguage.languageEyebrow', { defaultValue: 'Language' })}
        </Text>

        <View style={styles.rowGroup}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('LabelLanguageSetup')}
            activeOpacity={0.85}
          >
            <View style={styles.rowIc}>
              <Ionicons name="language-outline" size={19} color="#1E1E1E" />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>
                {t('labelsLanguage.labelLanguage', { defaultValue: 'Label language' })}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>{labelLanguageSubtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
          </TouchableOpacity>

        </View>

        <Text style={styles.eyebrow}>
          {t('labelsLanguage.uploadStructureEyebrow', { defaultValue: 'Upload structure' })}
        </Text>
        <View style={styles.rowGroup}>
          {/* Split photos by date — same SettingsContext flag the legacy
              inline section toggles. Wired directly here so the user
              never has to leave this screen for it. */}
          <View style={styles.row}>
            <View style={styles.rowIc}>
              <Ionicons name="calendar-outline" size={19} color="#1E1E1E" />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>
                {t('labelsLanguage.splitByDate', { defaultValue: 'Split photos by date' })}
              </Text>
              <Text style={styles.rowSub} numberOfLines={2}>
                {t('labelsLanguage.splitByDateSub', {
                  defaultValue: 'Group uploaded photos into per-day subfolders in your cloud.',
                })}
              </Text>
            </View>
            <Switch
              value={!!splitPhotosByDate}
              onValueChange={updateSplitPhotosByDate}
              trackColor={{ false: '#E0E0E0', true: '#F2C31B' }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* ───── EXACT inline "Labels" card from SettingsScreen ──────
            Hoisted here so this screen has 1:1 parity with the section
            that used to live in Settings. Same handlers, same nav
            targets (WatermarkCustomization / LogoCustomization /
            MetadataCustomization / BrandingSettings) and the same
            PRO-gate behaviour via canUse(FEATURES.CUSTOM_WATERMARKS). */}
        <View style={inlineStyles.section}>
          <Text style={inlineStyles.sectionTitle}>
            {t('settings.labels', { defaultValue: 'Labels' })}
          </Text>
          <Text style={inlineStyles.sectionDescription}>
            {t('settings.labelCustomizationDescription', { defaultValue: 'Customize the appearance of before/after labels on your photos.' })}
          </Text>

          {/* Labels Toggle */}
          <View style={[inlineStyles.settingRow, { borderBottomWidth: 1, borderBottomColor: 'rgba(0, 0, 0, 0.1)' }]}>
            <View style={inlineStyles.settingInfo}>
              <Text style={inlineStyles.settingLabel}>
                {t('settings.showLabels', { defaultValue: 'Labels' })}
              </Text>
              <Text style={inlineStyles.settingDescription}>
                {t('settings.showLabelsDescription', { defaultValue: 'Show BEFORE/AFTER labels on photos' })}
              </Text>
            </View>
            <Switch
              value={showLabels}
              onValueChange={toggleLabels}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="white"
            />
          </View>

          {/* Customize Watermark Option */}
          <TouchableOpacity
            style={inlineStyles.settingRow}
            onPress={() => {
              if (canUse(FEATURES.CUSTOM_WATERMARKS)) {
                navigation.navigate('WatermarkCustomization');
              } else {
                navigation.navigate('PlanSelection');
              }
            }}
          >
            <View style={inlineStyles.settingInfo}>
              <Text style={inlineStyles.settingLabel}>
                {t('settings.customizeWatermark', { defaultValue: 'Customize Watermark' })}
              </Text>
              <Text style={inlineStyles.settingDescription}>
                {customWatermarkEnabled
                  ? t('settings.watermarkCustomDescription', { defaultValue: 'Using custom watermark' })
                  : t('settings.watermarkDefaultDescription', { defaultValue: 'Using default watermark (Powered by ProofPix)' })}
              </Text>
            </View>
            {!canUse(FEATURES.CUSTOM_WATERMARKS) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#EAB308' }}>PRO</Text>
                <Ionicons name="lock-closed" size={16} color="#EAB308" />
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#666666" />
            )}
          </TouchableOpacity>

          {/* Customize Logo */}
          <TouchableOpacity
            style={[inlineStyles.settingRow, { borderBottomWidth: 1, borderBottomColor: 'rgba(0, 0, 0, 0.1)' }]}
            onPress={() => {
              if (canUse(FEATURES.CUSTOM_WATERMARKS)) {
                navigation.navigate('LogoCustomization');
              } else {
                navigation.navigate('PlanSelection');
              }
            }}
          >
            <View style={inlineStyles.settingInfo}>
              <Text style={inlineStyles.settingLabel}>
                {t('settings.customizeLogo', { defaultValue: 'Customize Logo' })}
              </Text>
              <Text style={inlineStyles.settingDescription}>
                {t('settings.customizeLogoDescription', { defaultValue: 'Upload and position a brand logo on photos.' })}
              </Text>
            </View>
            {!canUse(FEATURES.CUSTOM_WATERMARKS) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#EAB308' }}>PRO</Text>
                <Ionicons name="lock-closed" size={16} color="#EAB308" />
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#666666" />
            )}
          </TouchableOpacity>

          {/* Customize Timestamp (Metadata overlay) */}
          <TouchableOpacity
            style={inlineStyles.settingRow}
            onPress={() => {
              if (canUse(FEATURES.CUSTOM_WATERMARKS)) {
                navigation.navigate('MetadataCustomization');
              } else {
                navigation.navigate('PlanSelection');
              }
            }}
          >
            <View style={inlineStyles.settingInfo}>
              <Text style={inlineStyles.settingLabel}>
                {t('settings.customizeTimestamp', { defaultValue: 'Customize Timestamp' })}
              </Text>
              <Text style={inlineStyles.settingDescription}>
                {t('settings.customizeTimestampDescription', { defaultValue: 'Pick which date / time / location fields appear on photos.' })}
              </Text>
            </View>
            {!canUse(FEATURES.CUSTOM_WATERMARKS) ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#EAB308' }}>PRO</Text>
                <Ionicons name="lock-closed" size={16} color="#EAB308" />
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#666666" />
            )}
          </TouchableOpacity>

          {/* Report Branding */}
          <TouchableOpacity
            style={[inlineStyles.settingRow, { borderBottomWidth: 0 }]}
            onPress={() => navigation.navigate('BrandingSettings')}
          >
            <View style={inlineStyles.settingInfo}>
              <Text style={inlineStyles.settingLabel}>
                {t('settings.reportBranding', { defaultValue: 'Report Branding' })}
              </Text>
              <Text style={inlineStyles.settingDescription}>
                {t('settings.reportBrandingDescription', { defaultValue: 'Logo, company name, and accent color for generated reports.' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666666" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function useLabelLanguageSubtitle() {
  const { labelLanguage } = useSettings();
  // Best-effort: settings stores an ISO code; show it uppercased when
  // we don't have a friendly name to hand. Localized strings live in
  // i18n bundles but resolving them here would couple this screen to
  // the label-customization screen's helpers — keep it lean for now.
  if (!labelLanguage) return 'English';
  if (typeof labelLanguage === 'string') return labelLanguage.toUpperCase();
  return labelLanguage?.name || 'English';
}

// BrandTile — same shape as Labels/Watermark/Logo/Metadata tiles in
// StudioScreen's BrandingPanel: leading icon, title + subtitle, Switch
// on the right, tap navigates to the customize screen.
function BrandTile({ icon, title, subtitle, switchValue, switchDisabled, onSwitch, onPress }) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.rowTappable}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <View style={styles.rowIc}>
          <Ionicons name={icon} size={19} color="#1E1E1E" />
        </View>
        <View style={styles.rowMeta}>
          <View style={styles.rowTitleRow}>
            <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.customizeChip}>Customize ›</Text>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
        </View>
      </TouchableOpacity>
      <Switch
        value={!!switchValue}
        onValueChange={onSwitch}
        disabled={!!switchDisabled}
        trackColor={{ false: '#E0E0E0', true: '#F2C31B' }}
        thumbColor="#FFFFFF"
        style={styles.brandTileSwitch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.2,
  },

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9A9A',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 22,
  },

  // Soft-accent info pill at the top of the screen. Sets expectations
  // before the user starts flipping defaults — they're defaults, not
  // hard rules; the editor's save-scope sheet can apply per-photo,
  // per-folder, or per-project overrides.
  defaultsNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#FFF4C2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F2C31B',
  },
  defaultsNoteText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    fontWeight: '600',
    color: '#7A5B00',
    lineHeight: 17,
    letterSpacing: -0.1,
  },

  rowGroup: { marginHorizontal: 18, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  rowTappable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  customizeChip: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: '#9A9A9A',
    letterSpacing: -0.1,
    marginTop: 1,
  },
  brandTileSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
});

// ───── Mirror of SettingsScreen.styles for the appended inline Labels
// card so it renders identically to what used to live in Settings.
// Kept in a separate stylesheet to avoid colliding with this screen's
// row-style tokens (`row`, `rowTitle`, etc.). If SettingsScreen's
// design tokens change, mirror them here too.
const inlineStyles = StyleSheet.create({
  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    marginHorizontal: 18,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
    color: '#1E1E1E',
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  sectionDescription: {
    fontSize: 12,
    color: 'grey',
    marginBottom: 2,
    lineHeight: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    paddingRight: 16,
  },
  settingLabel: {
    color: COLORS.TEXT,
    fontWeight: '600',
    fontSize: 15,
    flexShrink: 1,
  },
  settingDescription: {
    color: COLORS.GRAY,
    fontSize: 12,
    flexShrink: 1,
  },
});

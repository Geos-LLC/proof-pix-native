import React, { useMemo } from 'react';
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
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';

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
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
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
  } = useSettings();

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
        contentContainerStyle={{ paddingBottom: 24 + insets.bottom + 50 + 24 }}
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
            styles={styles}
            icon="pricetag-outline"
            title={t('labelsLanguage.labels', { defaultValue: 'Labels' })}
            subtitle={t('labelsLanguage.labelsSub', { defaultValue: 'Before / After captions on every photo' })}
            switchValue={!!showLabels}
            onSwitch={toggleLabels}
            onPress={() => navigation.navigate('LabelCustomization')}
          />
          <BrandTile
            styles={styles}
            icon="copy-outline"
            title={t('labelsLanguage.watermark', { defaultValue: 'Watermark' })}
            subtitle={t('labelsLanguage.watermarkSub', { defaultValue: 'Brand mark on shared photos' })}
            switchValue={!!showWatermark}
            onSwitch={updateShowWatermark}
            onPress={() => navigation.navigate('WatermarkCustomization')}
          />
          <BrandTile
            styles={styles}
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
            styles={styles}
            icon="information-circle-outline"
            title={t('labelsLanguage.metadata', { defaultValue: 'Metadata' })}
            subtitle={t('labelsLanguage.metadataSub', { defaultValue: 'Date · time · address overlays' })}
            switchValue={!!showPreviewMetadata}
            onSwitch={togglePreviewMetadata}
            onPress={() => navigation.navigate('MetadataCustomization')}
          />
          {/* Report Branding — navigation only (no on/off switch).
              Lands on BrandingSettings which lets the user pick the
              report logo / company name / accent color. */}
          <BrandTile
            styles={styles}
            icon="document-text-outline"
            title={t('labelsLanguage.reportBranding', { defaultValue: 'Report Branding' })}
            subtitle={t('labelsLanguage.reportBrandingSub', { defaultValue: 'Logo · company name · accent color' })}
            onPress={() => navigation.navigate('BrandingSettings')}
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
// `styles` is passed as a prop because it lives in LabelsLanguageScreen's
// closure (useMemo(makeStyles)), not at module scope.
function BrandTile({ styles, icon, title, subtitle, switchValue, switchDisabled, onSwitch, onPress }) {
  // When no `onSwitch` is supplied the tile renders as a plain
  // navigation row with a chevron on the right (Report Branding uses
  // this — it doesn't have an on/off concept, only a destination).
  const showSwitch = typeof onSwitch === 'function';
  // Tapping Customize turns the feature ON before navigating — if the
  // user is opening the customize sheet they clearly want the overlay
  // enabled, and it's confusing to tune position/color for a chip that
  // isn't rendering. Skip when the switch is disabled (e.g. Logo tile
  // when no brand logo file has been uploaded — the switch can't turn
  // on without a URI, so silently enabling it would flip the state to
  // an invalid combination).
  const handleCustomize = () => {
    if (showSwitch && !switchDisabled && !switchValue) {
      try { onSwitch(true); } catch (_) {}
    }
    if (typeof onPress === 'function') onPress();
  };
  return (
    <View style={styles.row}>
      <View style={styles.rowIc}>
        <Ionicons name={icon} size={19} color="#1E1E1E" />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
        {/* Explicit Customize link — its own tap target so the
            customize destination is obvious. Whole-row tap also still
            works for switch-less tiles via the chevron path below. */}
        <TouchableOpacity
          style={styles.customizeLink}
          onPress={handleCustomize}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
          activeOpacity={0.6}
        >
          <Text style={styles.customizeLinkText}>Customize</Text>
          <Ionicons name="chevron-forward" size={13} color="#7A5B00" />
        </TouchableOpacity>
      </View>
      {showSwitch ? (
        <Switch
          value={!!switchValue}
          onValueChange={onSwitch}
          disabled={!!switchDisabled}
          trackColor={{ false: '#E0E0E0', true: '#F2C31B' }}
          thumbColor="#FFFFFF"
          style={styles.brandTileSwitch}
        />
      ) : (
        <TouchableOpacity onPress={handleCustomize} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surfaceElevated },
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
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.2,
  },

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
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
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
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
    backgroundColor: theme.surface,
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
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  // Visible "Customize ›" link below the subtitle on each BrandTile.
  // Its own tap target so users don't have to guess that the row body
  // itself is tappable. Accent-tinted to read as a link, not as body
  // copy.
  customizeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 2,
    marginTop: 4,
    paddingVertical: 2,
    paddingRight: 4,
  },
  customizeLinkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    color: '#7A5B00',
    letterSpacing: -0.1,
    textDecorationLine: 'underline',
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 1,
  },
  brandTileSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
});

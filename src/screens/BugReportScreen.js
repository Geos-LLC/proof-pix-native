import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import feedbackService, { collectAutoMetadata } from '../services/feedbackService';

const SEVERITY_OPTIONS = [
  { key: 'critical',   labelKey: 'feedback.severityCritical',   defaultLabel: 'Critical' },
  { key: 'major',      labelKey: 'feedback.severityMajor',      defaultLabel: 'Major' },
  { key: 'minor',      labelKey: 'feedback.severityMinor',      defaultLabel: 'Minor' },
  { key: 'suggestion', labelKey: 'feedback.severitySuggestion', defaultLabel: 'Suggestion' },
];

export default function BugReportScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { userPlan } = useSettings();

  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('major');
  const [screenshotUri, setScreenshotUri] = useState(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [metadata, setMetadata] = useState(null);

  // Pre-fill the email input from the shared support-form storage so
  // users who've already contacted us via Help & Support don't re-type
  // their address. Empty on first submit — the field itself stays
  // optional either way.
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('@proofpix_owner_email');
        if (stored && stored.trim()) setEmail(stored.trim());
      } catch {}
    })();
  }, []);

  // Read auto metadata once on mount so we can render the summary chips.
  // The submit path re-collects at send-time, so this render-only snapshot
  // is fine even if trial state changes mid-form.
  useEffect(() => {
    (async () => {
      try {
        const m = await collectAutoMetadata({ userPlan });
        setMetadata(m);
      } catch {}
    })();
  }, [userPlan]);

  const pickScreenshot = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('feedback.photosPermTitle', { defaultValue: 'Photo access needed' }),
          t('feedback.photosPermBody', {
            defaultValue: 'Grant Photos permission to attach a screenshot.',
          }),
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      setScreenshotUri(result.assets[0].uri);
    } catch (error) {
      console.warn('[BugReport] picker error:', error?.message);
    }
  };

  const removeScreenshot = () => setScreenshotUri(null);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await feedbackService.submitBugReport({
        description,
        severity,
        screenshotUri,
        email,
        userPlan,
      });
      Alert.alert(
        t('feedback.bugThanksTitle', { defaultValue: 'Thank you!' }),
        t('feedback.bugThanksBody', {
          defaultValue:
            'Your feedback has been received and will be reviewed.\n\nIf your feedback leads to an improvement in ProofPix, we may extend your trial by 7 days as a thank-you. Trial extensions are awarded at our discretion.',
        }),
        [{ text: t('common.ok', { defaultValue: 'OK' }), onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      const code = error?.message || 'SUBMIT_FAILED';
      let msg = t('feedback.submitFailedGeneric', {
        defaultValue: 'Could not send your report. Please try again.',
      });
      if (code === 'SCREENSHOT_TOO_LARGE') {
        msg = t('feedback.screenshotTooLarge', {
          defaultValue: 'Your screenshot is too large. Please pick a smaller image or send without one.',
        });
      } else if (code === 'RATE_LIMITED') {
        msg = t('feedback.rateLimited', {
          defaultValue: "You've submitted a lot of feedback recently. Please try again in a moment.",
        });
      }
      Alert.alert(t('common.error', { defaultValue: 'Error' }), msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderMetaChip = (label, value) => {
    if (!value) return null;
    return (
      <View style={styles.chip} key={label}>
        <Text style={styles.chipLabel}>{label}</Text>
        <Text style={styles.chipValue} numberOfLines={1}>{String(value)}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('feedback.bugTitle', { defaultValue: 'Report a bug' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>
            {t('feedback.severityLabel', { defaultValue: 'How severe is this?' })}
          </Text>
          <View style={styles.severityRow}>
            {SEVERITY_OPTIONS.map((opt) => {
              const active = severity === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.severityChip, active && styles.severityChipActive]}
                  onPress={() => setSeverity(opt.key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>
                    {t(opt.labelKey, { defaultValue: opt.defaultLabel })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>
            {t('feedback.descriptionLabel', { defaultValue: 'What happened?' })}
          </Text>
          <View style={styles.textAreaCard}>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder={t('feedback.bugPlaceholder', {
                defaultValue: 'Describe the issue, what you were doing, and what you expected to happen…',
              })}
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
            />
          </View>

          <Text style={styles.label}>
            {t('feedback.screenshotLabel', { defaultValue: 'Screenshot (optional)' })}
          </Text>
          {screenshotUri ? (
            <View style={styles.screenshotWrap}>
              <Image source={{ uri: screenshotUri }} style={styles.screenshotPreview} resizeMode="cover" />
              <TouchableOpacity style={styles.screenshotRemove} onPress={removeScreenshot} activeOpacity={0.85}>
                <Ionicons name="close" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.screenshotButton} onPress={pickScreenshot} activeOpacity={0.85}>
              <Ionicons name="image-outline" size={20} color={theme.textPrimary} />
              <Text style={styles.screenshotButtonText}>
                {t('feedback.attachScreenshot', { defaultValue: 'Attach a screenshot' })}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={styles.label}>
            {t('feedback.autoInfoLabel', { defaultValue: "We'll also include" })}
          </Text>
          <View style={styles.chipRow}>
            {renderMetaChip(
              t('feedback.chipVersion', { defaultValue: 'App' }),
              metadata?.appVersion ? `v${metadata.appVersion}${metadata.buildNumber ? ` · ${metadata.buildNumber}` : ''}` : null,
            )}
            {renderMetaChip(
              t('feedback.chipPlatform', { defaultValue: 'OS' }),
              metadata?.platform ? `${metadata.platform === 'ios' ? 'iOS' : 'Android'}${metadata.osVersion ? ` ${metadata.osVersion}` : ''}` : null,
            )}
            {renderMetaChip(t('feedback.chipDevice', { defaultValue: 'Device' }), metadata?.deviceModel)}
            {renderMetaChip(t('feedback.chipScreen', { defaultValue: 'Screen' }), metadata?.currentScreen)}
          </View>

          <Text style={styles.label}>
            {t('feedback.emailLabel', { defaultValue: 'Email (optional)' })}
          </Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              placeholderTextColor={theme.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={styles.emailHint}>
            {t('feedback.emailHint', {
              defaultValue:
                "Leave your email if you'd like us to follow up or notify you when the issue is resolved.",
            })}
          </Text>

          {/* Disclosure notice — required copy per spec. Wording must
              clearly communicate that approval is discretionary. Do NOT
              soften. */}
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>
              {t('feedback.noticeTitle', { defaultValue: 'Help us improve ProofPix' })}
            </Text>
            <Text style={styles.noticeBody}>
              {t('feedback.noticeBody', {
                defaultValue:
                  'If your feedback leads to an improvement in ProofPix, we may extend your trial by 7 days as a thank-you. Trial extensions are awarded at our discretion.\n\nDuplicate, incomplete, abusive, or non-actionable reports are not eligible.',
              })}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {submitting
                ? t('feedback.sending', { defaultValue: 'Sending…' })
                : t('feedback.sendReport', { defaultValue: 'Send report' })}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
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
  label: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 22,
  },
  textAreaCard: {
    marginHorizontal: 18,
    minHeight: 140,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  textArea: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textPrimary,
    letterSpacing: -0.1,
    minHeight: 110,
    paddingVertical: 0,
  },

  severityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 18,
  },
  severityChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  severityChipActive: {
    backgroundColor: '#F2C31B',
    borderColor: '#F2C31B',
  },
  severityChipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    letterSpacing: -0.1,
  },
  severityChipTextActive: {
    color: '#1E1E1E',
    fontWeight: '700',
  },

  inputCard: {
    marginHorizontal: 18,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  input: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textPrimary,
    letterSpacing: -0.1,
    paddingVertical: 4,
  },
  emailHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginHorizontal: 22,
    marginTop: 6,
    lineHeight: 16,
  },

  screenshotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderStyle: 'dashed',
    backgroundColor: theme.surface,
  },
  screenshotButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  screenshotWrap: {
    marginHorizontal: 18,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  screenshotPreview: {
    width: '100%',
    height: 220,
  },
  screenshotRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 18,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: theme.textMuted,
    textTransform: 'uppercase',
  },
  chipValue: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    flexShrink: 1,
  },

  notice: {
    marginHorizontal: 18,
    marginTop: 22,
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  noticeTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    marginBottom: 6,
  },
  noticeBody: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
    lineHeight: 18,
  },

  primaryButton: {
    marginHorizontal: 18,
    marginTop: 16,
    backgroundColor: '#F2C31B',
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});

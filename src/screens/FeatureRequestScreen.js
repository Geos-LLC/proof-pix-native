import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import feedbackService from '../services/feedbackService';

export default function FeatureRequestScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { userPlan } = useSettings();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill email from the shared support-form storage; users who
  // already contacted us via Help & Support don't have to re-type.
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('@proofpix_owner_email');
        if (stored && stored.trim()) setEmail(stored.trim());
      } catch {}
    })();
  }, []);

  const canSubmit =
    title.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await feedbackService.submitFeatureRequest({ title, description, email, userPlan });
      Alert.alert(
        t('feedback.featureThanksTitle', { defaultValue: 'Thank you!' }),
        t('feedback.featureThanksBody', {
          defaultValue:
            "Your suggestion has been received and will be reviewed. We read every idea and use them to shape what we build next.",
        }),
        [{ text: t('common.ok', { defaultValue: 'OK' }), onPress: () => navigation.goBack() }],
      );
    } catch (error) {
      const code = error?.message || 'SUBMIT_FAILED';
      let msg = t('feedback.submitFailedGeneric', {
        defaultValue: 'Could not send your suggestion. Please try again.',
      });
      if (code === 'RATE_LIMITED') {
        msg = t('feedback.rateLimited', {
          defaultValue: "You've submitted a lot of feedback recently. Please try again in a moment.",
        });
      }
      Alert.alert(t('common.error', { defaultValue: 'Error' }), msg);
    } finally {
      setSubmitting(false);
    }
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
          {t('feedback.featureTitle', { defaultValue: 'Suggest a feature' })}
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
          <Text style={styles.intro}>
            {t('feedback.featureIntro', {
              defaultValue: "Have an idea that would make ProofPix better? We'd love to hear it.",
            })}
          </Text>

          <Text style={styles.label}>
            {t('feedback.featureTitleLabel', { defaultValue: 'Title' })}
          </Text>
          <View style={styles.inputCard}>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={t('feedback.featureTitlePlaceholder', {
                defaultValue: 'Short summary of your idea',
              })}
              placeholderTextColor={theme.textMuted}
              maxLength={200}
            />
          </View>

          <Text style={styles.label}>
            {t('feedback.featureDescLabel', { defaultValue: 'Description' })}
          </Text>
          <View style={styles.textAreaCard}>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder={t('feedback.featureDescPlaceholder', {
                defaultValue: 'Tell us what problem this solves for you and how you imagine it working…',
              })}
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
            />
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

          <TouchableOpacity
            style={[styles.primaryButton, !canSubmit && styles.primaryButtonDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {submitting
                ? t('feedback.sending', { defaultValue: 'Sending…' })
                : t('feedback.sendSuggestion', { defaultValue: 'Send suggestion' })}
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
  intro: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 6,
    lineHeight: 20,
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
  textAreaCard: {
    marginHorizontal: 18,
    minHeight: 160,
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
    minHeight: 130,
    paddingVertical: 0,
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

  primaryButton: {
    marginHorizontal: 18,
    marginTop: 22,
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

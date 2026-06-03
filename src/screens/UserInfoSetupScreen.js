import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { logOnboardingStepCompleted } from '../utils/analytics';

// Refresh pass 7 — rebuilt to match design screenshot 04-name-company:
//
//   STEP 1 OF 2                         ← eyebrow
//   What should we call you?            ← bold headline
//   We'll use this on your reports…     ← subhead
//
//   YOUR NAME                           ← uppercase mini-label
//   [ 👤  Marcus Reed               ]   ← input with leading icon
//
//   COMPANY
//   [ 📁  Reed & Co. Cleaning       ]
//
//   EMAIL · optional
//   [ ✉️  you@company.com           ]
//
//   …
//
//   [        Continue              ]    ← yellow primary CTA at bottom
//
// Company + email are collected here for visual parity with the design
// and persisted to AsyncStorage as standalone keys. They aren't wired
// into the typed Settings context yet (that's a follow-up that touches
// shared state). For now they live alongside @proofpix_username so the
// fields aren't dropped between sessions.

export default function UserInfoSetupScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { updateUserInfo, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');

  const handleContinue = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    // Persist name through the settings context (the canonical path).
    await updateUserInfo(trimmedName);

    // Persist company + email to standalone AsyncStorage keys for now —
    // see header comment. Keeps the data without expanding the typed
    // settings surface.
    try {
      const trimmedCompany = company.trim();
      const trimmedEmail = email.trim();
      if (trimmedCompany) {
        await AsyncStorage.setItem('@proofpix_company', trimmedCompany);
      }
      if (trimmedEmail) {
        await AsyncStorage.setItem('@proofpix_owner_email', trimmedEmail);
      }
    } catch {}

    // Keep existing language behaviour from the old screen.
    const currentLang = i18n.language || 'en';
    updateLabelLanguage(currentLang);
    updateSectionLanguage(currentLang);

    logOnboardingStepCompleted('user_info');
    navigation.navigate('PermissionsSetup');
  };

  const canContinue = name.trim().length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 110 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backTouch}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color="#1E1E1E" />
          </TouchableOpacity>

          <Text style={styles.eyebrow}>{t('userInfo.step', { defaultValue: 'STEP 1 OF 2' })}</Text>
          <Text style={styles.headline}>
            {t('userInfo.headline', { defaultValue: 'What should we call you?' })}
          </Text>
          <Text style={styles.subhead}>
            {t('userInfo.subhead', {
              defaultValue: "We'll use this on your reports and shared proof.",
            })}
          </Text>

          <View style={styles.fields}>
            <Field
              label={t('userInfo.nameLabel', { defaultValue: 'YOUR NAME' })}
              icon="person-outline"
              value={name}
              onChangeText={setName}
              placeholder="Marcus Reed"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Field
              label={t('userInfo.companyLabel', { defaultValue: 'COMPANY' })}
              icon="folder-outline"
              value={company}
              onChangeText={setCompany}
              placeholder="Reed & Co. Cleaning"
              autoCapitalize="words"
              returnKeyType="next"
            />
            <Field
              label={`${t('userInfo.emailLabel', { defaultValue: 'EMAIL' })} · ${t('userInfo.optional', { defaultValue: 'optional' })}`}
              icon="mail-outline"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={canContinue ? handleContinue : undefined}
            />
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          <TouchableOpacity
            style={[styles.primaryButton, !canContinue && styles.primaryButtonDisabled]}
            disabled={!canContinue}
            onPress={handleContinue}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {t('userInfo.continue', { defaultValue: 'Continue' })}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Field — uppercase mini-label above a surface input with a leading
// icon. The whole row sits in a hairline-bordered capsule so the icon
// + text feel like one tap target.
function Field({ label, icon, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name={icon} size={18} color="#9A9A9A" style={styles.fieldIcon} />
        <TextInput
          style={styles.input}
          placeholderTextColor="#9A9A9A"
          autoCorrect={false}
          {...inputProps}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  backTouch: {
    width: 32,
    height: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: 12,
  },

  // Eyebrow + headline + subhead.
  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: '#9A9A9A',
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  headline: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.5,
    lineHeight: 30,
    marginBottom: 8,
  },
  subhead: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    letterSpacing: -0.1,
    marginBottom: 24,
  },

  // Field stack.
  fields: {
    gap: 6,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9A9A',
    textTransform: 'uppercase',
    marginBottom: 6,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  fieldIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    color: '#1E1E1E',
    letterSpacing: -0.1,
    paddingVertical: 0,
  },

  // Sticky footer with Continue button.
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F4F4F4',
  },
  primaryButton: {
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
    opacity: 0.35,
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

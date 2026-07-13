import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  NativeModules,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import enterpriseContactService from '../services/enterpriseContactService';
import Constants from 'expo-constants';
import { isTrialActive, getTrialDaysRemaining } from '../services/trialService';

// Extract the ISO country code from the device locale without a new
// dependency. iOS exposes `AppleLocale` / `AppleLanguages` via
// SettingsManager; Android exposes `localeIdentifier` via I18nManager.
// Both look like `en_US` or `en-US`; we return the region half.
const getDeviceCountry = () => {
  try {
    const locale = Platform.OS === 'ios'
      ? (NativeModules.SettingsManager?.settings?.AppleLocale
        || NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        || '')
      : (NativeModules.I18nManager?.localeIdentifier || '');
    const m = String(locale).match(/[_-]([A-Za-z]{2})\b/);
    return m ? m[1].toUpperCase() : '';
  } catch { return ''; }
};

// Render the user's plan as a short label for the contact email
// metadata row. Free tier is called out explicitly; paid plans get a
// trial badge with days remaining when applicable.
const formatPlanLabel = (userPlan, trialActive, daysLeft) => {
  const tier = userPlan || 'starter';
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  if (tier === 'starter') return `${label} (Free)`;
  if (trialActive) {
    const d = Number.isFinite(daysLeft) ? daysLeft : 0;
    return `${label} (Trial · ${d} day${d === 1 ? '' : 's'} left)`;
  }
  return `${label} (Paid)`;
};

// HelpSupportScreen — design 37.
//
// Visual: light page, "Help & support" header with back chevron. Three
// row tiles (Live chat / Email us / Help center) sitting in a column.
// Then SEND A MESSAGE eyebrow + Question/Bug/Feature pill segmented
// control + a free-text card (textarea) + yellow Send message CTA.
// Footer reads "ProofPix v{X} · build {Y}".
//
// Routing:
// - Email us → opens mailto:support@proofpix.app.
// - Help center → opens https://www.proofpix.app/help in the browser.
// - Send message → tries EmailJS first, falls back to mailto: with the
//   message pre-filled so the user always lands at a composed email.
const HELP_CENTER_URL = 'https://www.proofpix.app/help';
const SUPPORT_EMAIL = 'support@proofpix.app';

const TABS = [
  { key: 'question', labelKey: 'helpSupport.question', defaultLabel: 'Question' },
  { key: 'bug', labelKey: 'helpSupport.bug', defaultLabel: 'Bug' },
  { key: 'feature', labelKey: 'helpSupport.feature', defaultLabel: 'Feature' },
];

export default function HelpSupportScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { userName, userPlan } = useSettings();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [activeTab, setActiveTab] = useState('question');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Refs let the "Email us" row jump the user into the in-app composer
  // instead of launching the system mail client — keeps the send path
  // routed through enterpriseContactService (EmailJS) and matches the
  // engine-only contract we restored after deleting the legacy
  // ContactUs screen.
  const scrollRef = useRef(null);
  const bodyRef = useRef(null);
  const composerY = useRef(0);

  // Owner email was captured during UserInfoSetup and persisted to
  // a standalone AsyncStorage key (since the typed settings context
  // doesn't carry it yet). Read it on mount so the EmailJS service
  // has a real reply-to address — without it the service throws
  // EMAIL_REQUIRED before the message is sent.
  // Email field is always visible. If a stored owner email exists, we
  // pre-fill the input from it so the user sees what reply-to address
  // will be used — and can override it for this one message.
  const [emailInput, setEmailInput] = useState('');

  // Optional phone — carried over from the legacy ContactUs form so
  // support/sales can follow up by call when the message warrants it
  // (e.g. iCloud-doesn't-support-teams "Send Feedback" path). Persisted
  // alongside the owner email so the next send is one-tap.
  const [phone, setPhone] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('@proofpix_owner_email');
        if (stored && stored.trim()) setEmailInput(stored.trim());
        const storedPhone = await AsyncStorage.getItem('@proofpix_owner_phone');
        if (storedPhone && storedPhone.trim()) setPhone(storedPhone.trim());
      } catch {}
    })();
  }, []);

  const handleEmailUs = () => {
    // Open the system mail composer with subject pre-filled. This is the
    // explicit "email me directly, outside the app" path — distinct from
    // the in-app Send Message button below which routes through the
    // EmailJS engine. Some users prefer their own mail client (attaches,
    // signatures, etc.); we honor that here without forcing them into
    // the in-app composer.
    const appVersion = Constants?.expoConfig?.version || '—';
    const subject = `ProofPix support — v${appVersion}`;
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('helpSupport.noMailClient', {
          defaultValue: `No email app is set up on this device. Email us at ${SUPPORT_EMAIL} when you can.`,
        }),
      );
    });
  };

  const handleHelpCenter = () => {
    Linking.openURL(HELP_CENTER_URL).catch(() => {});
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const effectiveEmail = emailInput.trim();
  const hasValidEmail = emailRegex.test(effectiveEmail);

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;

    if (!hasValidEmail) {
      // Service requires a real reply-to address. The email field is
      // always visible now, so just surface the alert and let the user
      // fix the value in place.
      Alert.alert(
        t('helpSupport.needEmailTitle', { defaultValue: 'Add your email' }),
        t('helpSupport.needEmailBody', {
          defaultValue: 'We need a reply-to address so we can get back to you.',
        }),
      );
      return;
    }

    setSending(true);
    const topic = TABS.find((x) => x.key === activeTab)?.defaultLabel || 'Question';
    const platform = Platform.OS;
    const appVersion = Constants?.expoConfig?.version
      || Constants?.manifest?.version
      || '—';
    const buildNumberForSend = Constants?.expoConfig?.ios?.buildNumber
      || Constants?.expoConfig?.android?.versionCode
      || '—';
    const subject = `[${topic}] ProofPix in-app feedback`;
    // EmailJS template expects `description` (mapped to `message` inside
    // the service) — passing `message` was the silent failure in the
    // previous build. Adding topic + platform + version metadata to the
    // body so support has triage info.
    const description =
      `${trimmed}\n\n` +
      `— Sent from ProofPix v${appVersion} on ${platform}.`;

    // Gather client-context vars for the EmailJS metadata table. Trial
    // state is resolved async but the calls are fast (local storage
    // reads); a failure on either falls through to the default plan
    // label. Country is a synchronous NativeModules read.
    let trialActive = false;
    let trialDaysLeft = 0;
    try { trialActive = await isTrialActive(); } catch {}
    if (trialActive) {
      try { trialDaysLeft = await getTrialDaysRemaining(); } catch {}
    }
    const planLabel = formatPlanLabel(userPlan, trialActive, trialDaysLeft);
    const countryCode = getDeviceCountry();
    const platformLabel = platform === 'ios' ? 'iOS'
      : platform === 'android' ? 'Android'
      : platform;

    // Single-path send through the internal EmailJS engine. The legacy
    // ContactUs screen used the same enterpriseContactService and treated
    // a failure as a hard error — no silent mailto detour. Preserve that
    // contract: if the engine throws, surface the failure code with the
    // same messaging the user would have seen on the legacy form so the
    // root cause (missing env vars, network, etc.) is visible instead of
    // masked by the mail client opening.
    try {
      await enterpriseContactService.sendRequest({
        name: (userName && userName.trim()) || 'ProofPix user',
        email: effectiveEmail,
        phone: phone.trim(),
        description: `${subject}\n\n${description}`,
        // Metadata for the EmailJS template's client-context table.
        topic,
        plan: planLabel,
        country: countryCode,
        version: appVersion,
        build: String(buildNumberForSend),
        platform: platformLabel,
        // deviceId omitted — service resolves it from SecureStore
        // /AsyncStorage internally so the FixPrompt SDK's UUID always
        // wins over anything we could pass from here.
      });

      // Persist email + phone unconditionally so the next send is
      // one-tap. setItem is idempotent — writing the same stored value
      // back is a no-op cost-wise. Phone only persists if non-empty so
      // we don't overwrite a previously stored number with blank.
      try { await AsyncStorage.setItem('@proofpix_owner_email', effectiveEmail); } catch {}
      if (phone.trim()) {
        try { await AsyncStorage.setItem('@proofpix_owner_phone', phone.trim()); } catch {}
      }
      setBody('');
      Alert.alert(
        t('helpSupport.sentTitle', { defaultValue: 'Thanks!' }),
        t('helpSupport.sentBody', {
          defaultValue: "We got your message and we'll get back to you shortly.",
        }),
      );
    } catch (error) {
      // Error code → user-facing message, mirroring the legacy ContactUs
      // mapping in screens/ContactUsScreen.js (now deleted). Anything
      // unrecognized falls back to the generic "try again" message.
      let errorMessage = t('helpSupport.sendGenericError', {
        defaultValue: 'Failed to send your message. Please try again.',
      });
      if (error?.message === 'NAME_REQUIRED') {
        errorMessage = t('helpSupport.nameRequired', { defaultValue: 'Please enter your name' });
      } else if (error?.message === 'EMAIL_REQUIRED') {
        errorMessage = t('helpSupport.emailRequired', { defaultValue: 'Please enter your email address' });
      } else if (error?.message === 'INVALID_EMAIL') {
        errorMessage = t('helpSupport.invalidEmail', { defaultValue: 'Please enter a valid email address' });
      } else if (error?.message === 'EMAIL_NOT_CONFIGURED') {
        errorMessage = t('helpSupport.emailNotConfigured', {
          defaultValue: `Email service is not configured. Please contact support directly at ${SUPPORT_EMAIL}`,
        });
      }
      Alert.alert(t('common.error', { defaultValue: 'Error' }), errorMessage);
    } finally {
      setSending(false);
    }
  };

  const appVersion = Constants?.expoConfig?.version
    || Constants?.manifest?.version
    || '—';
  const buildNumber = Constants?.expoConfig?.ios?.buildNumber
    || Constants?.expoConfig?.android?.versionCode
    || '—';

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
          {t('helpSupport.title', { defaultValue: 'Help & support' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.rowGroup}>
            <TouchableOpacity style={styles.row} onPress={handleEmailUs} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="mail-outline" size={19} color={theme.textPrimary} />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('helpSupport.emailUs', { defaultValue: 'Email us' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>{SUPPORT_EMAIL}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.row} onPress={handleHelpCenter} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="document-text-outline" size={19} color={theme.textPrimary} />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('helpSupport.helpCenter', { defaultValue: 'Help center' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {t('helpSupport.helpCenterSub', { defaultValue: 'Guides & FAQs' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </TouchableOpacity>
          </View>

          <Text
            style={styles.eyebrow}
            onLayout={(e) => { composerY.current = e.nativeEvent.layout.y; }}
          >
            {t('helpSupport.sendAMessage', { defaultValue: 'Send a message' })}
          </Text>

          {/* Segmented Question / Bug / Feature */}
          <View style={styles.segmentedContainer}>
            <View style={styles.segmented}>
              {TABS.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.segment, active && styles.segmentActive]}
                    onPress={() => setActiveTab(tab.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Reply-to email + optional phone — always visible. Email
              pre-fills from @proofpix_owner_email on mount and is
              persisted back on every successful send so the next visit
              is one-tap. Phone is optional and only persists when
              non-empty so we don't overwrite a stored number with blank. */}
          <View style={styles.emailCard}>
            <Text style={styles.emailLabel}>
              {t('helpSupport.yourEmail', { defaultValue: 'Your email' })}
            </Text>
            <TextInput
              style={styles.emailInput}
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="you@company.com"
              placeholderTextColor={theme.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.cardDivider} />
            <Text style={styles.emailLabel}>
              {t('helpSupport.yourPhoneOptional', { defaultValue: 'Phone (optional)' })}
            </Text>
            <TextInput
              style={styles.emailInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 (555) 123-4567"
              placeholderTextColor={theme.textMuted}
              keyboardType="phone-pad"
              autoCorrect={false}
            />
          </View>

          {/* Textarea card */}
          <View style={styles.textAreaCard}>
            <TextInput
              ref={bodyRef}
              style={styles.textArea}
              value={body}
              onChangeText={setBody}
              multiline
              placeholder={t('helpSupport.placeholder', { defaultValue: "Tell us what's on your mind…" })}
              placeholderTextColor={theme.textMuted}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, (!body.trim() || sending) && styles.primaryButtonDisabled]}
            disabled={!body.trim() || sending}
            onPress={handleSend}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {sending
                ? t('helpSupport.sending', { defaultValue: 'Sending…' })
                : t('helpSupport.sendMessage', { defaultValue: 'Send message' })}
            </Text>
          </TouchableOpacity>

          <Text style={styles.versionFooter}>
            ProofPix v{appVersion} · build {buildNumber}
          </Text>
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
  rowGroup: {
    marginHorizontal: 18,
    marginTop: 6,
    gap: 8,
  },
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
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 1,
  },

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginTop: 22,
    marginBottom: 8,
    marginHorizontal: 22,
  },

  // Segmented Question / Bug / Feature.
  segmentedContainer: {
    marginHorizontal: 18,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 11,
    padding: 4,
  },
  segment: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: theme.surfaceElevated,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  segmentText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    letterSpacing: -0.1,
  },
  segmentTextActive: {
    color: theme.textPrimary,
    fontWeight: '700',
  },

  emailCard: {
    marginHorizontal: 18,
    marginTop: 10,
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
  emailLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  emailInput: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textPrimary,
    letterSpacing: -0.1,
    paddingVertical: 4,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginVertical: 10,
  },
  textAreaCard: {
    marginHorizontal: 18,
    marginTop: 10,
    minHeight: 120,
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
    minHeight: 90,
    paddingVertical: 0,
  },

  // Yellow CTA — stays yellow in both modes (accent tone matches the
  // brand). Text is intentionally #1E1E1E so it reads on the yellow fill
  // regardless of theme.
  primaryButton: {
    marginHorizontal: 18,
    marginTop: 12,
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

  versionFooter: {
    textAlign: 'center',
    marginTop: 18,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11.5,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
  },
});

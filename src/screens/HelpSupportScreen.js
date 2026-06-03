import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import enterpriseContactService from '../services/enterpriseContactService';
import Constants from 'expo-constants';

// HelpSupportScreen — design 37.
//
// Visual: light page, "Help & support" header with back chevron. Three
// row tiles (Live chat / Email us / Help center) sitting in a column.
// Then SEND A MESSAGE eyebrow + Question/Bug/Feature pill segmented
// control + a free-text card (textarea) + yellow Send message CTA.
// Footer reads "ProofPix v{X} · build {Y}".
//
// Routing:
// - Live chat → external help link via Linking (no in-app chat yet).
// - Email us → opens mailto:.
// - Help center → opens web help.
// - Send message → wraps the existing EmailJS path used by the legacy
//   Contact Us screen (sendEnterpriseContactRequest service).
const HELP_CENTER_URL = 'https://proofpix.app/help';
const SUPPORT_EMAIL = 'support@proofpix.app';

const TABS = [
  { key: 'question', labelKey: 'helpSupport.question', defaultLabel: 'Question' },
  { key: 'bug', labelKey: 'helpSupport.bug', defaultLabel: 'Bug' },
  { key: 'feature', labelKey: 'helpSupport.feature', defaultLabel: 'Feature' },
];

export default function HelpSupportScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('question');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleLiveChat = () => {
    Linking.openURL(HELP_CENTER_URL).catch(() => {});
  };

  const handleEmailUs = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
  };

  const handleHelpCenter = () => {
    Linking.openURL(HELP_CENTER_URL).catch(() => {});
  };

  const handleSend = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const topic = TABS.find((x) => x.key === activeTab)?.defaultLabel || 'Question';
      const subject = `[${topic}] ProofPix in-app feedback`;
      await enterpriseContactService.sendRequest({
        name: 'ProofPix user',
        email: SUPPORT_EMAIL,
        phone: '',
        message: trimmed,
        subject,
      });
      Alert.alert(
        t('helpSupport.sentTitle', { defaultValue: 'Thanks!' }),
        t('helpSupport.sentBody', {
          defaultValue: "We got your message and we'll get back to you shortly.",
        }),
      );
      setBody('');
    } catch (e) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('helpSupport.sendFailed', {
          defaultValue: "We couldn't send the message. Email us at support@proofpix.app and we'll handle it.",
        }),
      );
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
          <Ionicons name="chevron-back" size={20} color="#1E1E1E" />
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
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.rowGroup}>
            <TouchableOpacity style={styles.row} onPress={handleLiveChat} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="chatbubble-ellipses-outline" size={19} color="#1E1E1E" />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('helpSupport.liveChat', { defaultValue: 'Live chat' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {t('helpSupport.liveChatSub', { defaultValue: 'Typically replies in minutes' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.row} onPress={handleEmailUs} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="mail-outline" size={19} color="#1E1E1E" />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('helpSupport.emailUs', { defaultValue: 'Email us' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>{SUPPORT_EMAIL}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.row} onPress={handleHelpCenter} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="document-text-outline" size={19} color="#1E1E1E" />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('helpSupport.helpCenter', { defaultValue: 'Help center' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {t('helpSupport.helpCenterSub', { defaultValue: 'Guides & FAQs' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
            </TouchableOpacity>
          </View>

          <Text style={styles.eyebrow}>
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

          {/* Textarea card */}
          <View style={styles.textAreaCard}>
            <TextInput
              style={styles.textArea}
              value={body}
              onChangeText={setBody}
              multiline
              placeholder={t('helpSupport.placeholder', { defaultValue: "Tell us what's on your mind…" })}
              placeholderTextColor="#9A9A9A"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
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
    color: '#1E1E1E',
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

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9A9A',
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
    backgroundColor: '#F4F4F4',
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
    backgroundColor: '#FFFFFF',
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
    color: '#666666',
    letterSpacing: -0.1,
  },
  segmentTextActive: {
    color: '#1E1E1E',
    fontWeight: '700',
  },

  textAreaCard: {
    marginHorizontal: 18,
    marginTop: 10,
    minHeight: 120,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
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
    color: '#1E1E1E',
    letterSpacing: -0.1,
    minHeight: 90,
    paddingVertical: 0,
  },

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
    color: '#9A9A9A',
    letterSpacing: -0.1,
  },
});

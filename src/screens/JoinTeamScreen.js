import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Image, Modal, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';

const { width, height } = Dimensions.get('window');

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];

export default function JoinTeamScreen({ navigation, route }) {
  const { t, i18n } = useTranslation();
  const { updateUserInfo, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const insets = useSafeAreaInsets();
  // Check if invite code came from deep link or route params
  const inviteFromParams = route?.params?.invite || '';
  const [inviteCode, setInviteCode] = useState(inviteFromParams);
  const [userName, setUserName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const inviteCodeRef = useRef(null);
  const { isAuthenticated } = useAdmin();

  // Auto-fill invite code from params or check clipboard
  useEffect(() => {
    const initInviteCode = async () => {
      if (inviteFromParams) {
        console.log('[JoinTeam] Invite from params:', inviteFromParams);
        setInviteCode(inviteFromParams);
      } else {
        // Check clipboard for invite code
        try {
          const clipboardContent = await Clipboard.getString();
          if (clipboardContent && clipboardContent.includes('|')) {
            const parts = clipboardContent.trim().split('|');
            if (parts.length === 2 && parts[0].length > 10 && parts[1].length > 20) {
              console.log('[JoinTeam] Invite code found in clipboard');
              setInviteCode(clipboardContent.trim());
            }
          }
        } catch (error) {
          console.log('[JoinTeam] Could not check clipboard:', error?.message);
        }
      }
    };
    initInviteCode();
  }, [inviteFromParams]);

  const getCurrentLanguage = () => {
    return LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];
  };

  const changeLanguage = (languageCode) => {
    i18n.changeLanguage(languageCode);
    updateLabelLanguage(languageCode);
    updateSectionLanguage(languageCode);
    setLanguageModalVisible(false);
  };

  const handleJoinTeam = async () => {
    if (!userName.trim()) {
      Alert.alert(
        t('joinTeam.nameRequired', { defaultValue: 'Name Required' }),
        t('joinTeam.pleaseEnterName', { defaultValue: 'Please enter your name to continue.' })
      );
      return;
    }

    if (!inviteCode.trim()) {
      Alert.alert(
        t('joinTeam.error', { defaultValue: 'Error' }),
        t('joinTeam.pleaseEnterCode', { defaultValue: 'Please enter an invite code' })
      );
      return;
    }

    // Parse invite code - format is "TOKEN|SESSIONID" (proxy server format)
    // Legacy format "TOKEN|SCRIPTURL" is also supported for backward compatibility
    const parts = inviteCode.trim().split('|');
    if (parts.length !== 2) {
      Alert.alert(
        t('joinTeam.invalidCode', { defaultValue: 'Invalid Code' }),
        t('joinTeam.invalidCodeFormat', { defaultValue: 'This invite code is not in the correct format. Please check with your admin.' })
      );
      return;
    }

    const [token, sessionIdOrUrl] = parts;

    if (!token || !sessionIdOrUrl) {
      Alert.alert(
        t('joinTeam.invalidCode', { defaultValue: 'Invalid Code' }),
        t('joinTeam.incompleteCode', { defaultValue: 'This invite code is incomplete. Please check with your admin.' })
      );
      return;
    }

    // Save user name before navigating
    await updateUserInfo(userName.trim());

    // Proxy server format: token|sessionId
    navigation.navigate('Invite', {
      token: token,
      sessionId: sessionIdOrUrl
    });
  };

  const handleUseOnMyOwn = () => {
    // Pass flag to skip clipboard check - user explicitly chose individual mode
    navigation.replace('FirstLoad', { skipClipboardCheck: true });
  };

  const handleEditInviteCode = () => {
    // Focus the input and select all text
    if (inviteCodeRef.current) {
      inviteCodeRef.current.focus();
      // Select all text after a short delay to ensure focus is complete
      setTimeout(() => {
        if (inviteCodeRef.current) {
          inviteCodeRef.current.setSelection(0, inviteCode.length);
        }
      }, 100);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Image
                source={require('../../assets/PP_logo.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.headerTitle}>ProofPix</Text>
            <TouchableOpacity
              style={styles.languageSelector}
              onPress={() => setLanguageModalVisible(true)}
            >
              <Text style={styles.languageFlag}>{getCurrentLanguage().flag}</Text>
              <Ionicons name="chevron-down" size={16} color={COLORS.TEXT} />
            </TouchableOpacity>
          </View>

          {/* Team Icon */}
          <View style={styles.avatarContainer}>
            <View style={styles.avatarIcon}>
              <Ionicons name="people" size={48} color="#666" />
            </View>
          </View>

          {/* Title */}
          <Text style={styles.mainTitle}>
            {t('joinTeam.title', { defaultValue: 'Join a Team' })}
          </Text>
          <Text style={styles.subtitle}>
            {t('joinTeam.subtitle', { defaultValue: 'Enter the invite code your team admin shared with you.' })}
          </Text>

          {/* Form */}
          <View style={styles.formContainer}>
            <Text style={styles.inputLabel}>{t('joinTeam.invitationCode', { defaultValue: 'Invitation Code' })}</Text>
            <TextInput
              ref={inviteCodeRef}
              style={styles.input}
              placeholder={t('joinTeam.enterInviteCode', { defaultValue: 'Enter invite code' })}
              placeholderTextColor="#999"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => {
                // Focus name input if available
              }}
            />

            <Text style={[styles.inputLabel, { marginTop: 16 }]}>
              {t('firstLoad.yourName', { defaultValue: 'Your Name' })}
            </Text>
            <TextInput
              style={styles.input}
              placeholder={t('firstLoad.enterYourName', { defaultValue: 'Enter your name' })}
              placeholderTextColor="#999"
              value={userName}
              onChangeText={setUserName}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
            />

            <TouchableOpacity
              style={[styles.joinButton, (!userName.trim() || !inviteCode.trim()) && styles.joinButtonDisabled]}
              onPress={handleJoinTeam}
              disabled={isLoading || !userName.trim() || !inviteCode.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.joinButtonText}>
                {isLoading ? t('joinTeam.joining', { defaultValue: 'Joining...' }) : t('joinTeam.join', { defaultValue: 'Join' })}
              </Text>
            </TouchableOpacity>

            {/* OR Separator */}
            <View style={styles.orContainer}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View>

            <TouchableOpacity
              style={styles.joinIndividualButton}
              onPress={handleUseOnMyOwn}
            >
              <Text style={styles.joinIndividualText}>
                {t('joinTeam.joinIndividual', { defaultValue: 'Join as Individual' })}
              </Text>
            </TouchableOpacity>

            <View style={styles.languageSection}>
              <TouchableOpacity
                style={styles.languageRow}
                onPress={() => setLanguageModalVisible(true)}
              >
                <Text style={styles.languageRowLabel}>
                  {t('firstLoad.language', { defaultValue: 'Language' })}
                </Text>
                <View style={styles.languageValueContainer}>
                  <Text style={styles.languageRowFlag}>{getCurrentLanguage().flag}</Text>
                  <Text style={styles.languageRowValue}>
                    {getCurrentLanguage().name}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Language Selection Modal - Bottom Sheet Style */}
      <Modal
        visible={languageModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setLanguageModalVisible(false)}
        >
          <View style={styles.modalContentBottomSheet}>
            {/* Handle Bar */}
            <View style={styles.modalHandle} />
            
            {/* Header */}
            <View style={styles.modalHeaderBottomSheet}>
              <TouchableOpacity
                style={styles.modalCloseButtonTop}
                onPress={() => setLanguageModalVisible(false)}
              >
                <Ionicons name="close" size={24} color={COLORS.TEXT} />
              </TouchableOpacity>
              <Text style={styles.modalTitleBottomSheet}>
                {t('firstLoad.changeLanguage', { defaultValue: 'Change Language' })}
              </Text>
              <View style={styles.modalCloseButtonTop} />
            </View>

            {/* Language List */}
            <ScrollView style={styles.languageScrollView} showsVerticalScrollIndicator={true}>
              {LANGUAGES.map((language) => (
                <TouchableOpacity
                  key={language.code}
                  style={styles.languageOptionBottomSheet}
                  onPress={() => changeLanguage(language.code)}
                >
                  <View style={styles.flagCircle}>
                    <Text style={styles.languageFlagBottomSheet}>{language.flag}</Text>
                  </View>
                  <Text style={styles.languageOptionTextBottomSheet}>
                    {language.name}
                  </Text>
                  {i18n.language === language.code && (
                    <View style={styles.checkmarkCircle}>
                      <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
  },
  headerLeft: {
    width: 80,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    flex: 1,
    textAlign: 'center',
    position: 'absolute',
    left: 0,
    right: 0,
  },
  languageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 80,
    justifyContent: 'flex-end',
  },
  languageFlag: {
    fontSize: 20,
    marginRight: 4,
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 24,
  },
  avatarIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#E8DFD0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: FONTS.QUICKSAND_REGULAR,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  formContainer: {
    width: '100%',
    paddingHorizontal: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_REGULAR,
    marginBottom: 16,
  },
  joinButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 8,
  },
  joinButtonDisabled: {
    backgroundColor: '#E0E0E0',
    opacity: 0.6,
  },
  joinButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  orContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.BORDER,
  },
  orText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_MEDIUM,
    color: COLORS.TEXT,
    marginHorizontal: 16,
  },
  joinIndividualButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  joinIndividualText: {
    fontSize: 16,
    color: COLORS.TEXT,
    textDecorationLine: 'underline',
    fontFamily: FONTS.QUICKSAND_MEDIUM,
  },
  languageSection: {
    marginTop: 16,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    minHeight: 52,
  },
  languageRowLabel: {
    fontSize: 18,
    color: '#000',
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  languageValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  languageRowFlag: {
    fontSize: 20,
    marginRight: 6,
  },
  languageRowValue: {
    fontSize: 18,
    color: '#000',
    fontFamily: FONTS.QUICKSAND_REGULAR,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 0,
    marginRight: 5,
  },
  appTitle: {
    fontSize: FONTS.XXXLARGE,
    fontWeight: FONTS.BOLD,
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000000',
    marginBottom: 0,
  },
  appSubtitle: {
    fontSize: 16,
    color: '#333333',
    textAlign: 'center',
    marginTop: 8,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContentBottomSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: height * 0.8,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D1D1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeaderBottomSheet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
  },
  modalCloseButtonTop: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitleBottomSheet: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    flex: 1,
    textAlign: 'center',
  },
  languageScrollView: {
    maxHeight: height * 0.6,
  },
  languageOptionBottomSheet: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  flagCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    overflow: 'hidden',
  },
  languageFlagBottomSheet: {
    fontSize: 28,
  },
  checkmarkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageOptionTextBottomSheet: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    fontFamily: FONTS.QUICKSAND_REGULAR,
    color: COLORS.TEXT,
  },
});

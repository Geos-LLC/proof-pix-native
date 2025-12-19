import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Image, Modal, Dimensions, Clipboard } from 'react-native';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { SafeAreaView } from 'react-native-safe-area-context';
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
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/PP_logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.appTitle}>ProofPix</Text>
            <Text style={styles.appSubtitle}>{t('joinTeam.subtitle', { defaultValue: 'Enter the invite code your team admin shared with you' })}</Text>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.inputLabel}>{t('firstLoad.yourName', { defaultValue: 'Your Name' })}</Text>
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
              style={styles.joinButton}
              onPress={handleJoinTeam}
              disabled={isLoading}
            >
              <Text style={styles.joinButtonText}>
                {isLoading ? t('joinTeam.joining', { defaultValue: 'Joining...' }) : t('joinTeam.joinTeam', { defaultValue: 'Join Team' })}
              </Text>
            </TouchableOpacity>

            <View style={styles.inviteCodeSection}>
              <TouchableOpacity onPress={handleEditInviteCode} style={styles.inviteCodeIconButton}>
                <Text style={styles.inviteCodeIcon}>✏️</Text>
              </TouchableOpacity>
              <TextInput
                ref={inviteCodeRef}
                style={styles.inviteCodeInput}
                placeholder={t('joinTeam.enterInviteCode', { defaultValue: 'Enter invite code' })}
                placeholderTextColor="#666"
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleJoinTeam}
                multiline={false}
                selectTextOnFocus={true}
              />
            </View>

            <TouchableOpacity
              style={styles.useOnMyOwnButton}
              onPress={handleUseOnMyOwn}
            >
              <Text style={styles.useOnMyOwnText}>
                {t('joinTeam.useOnMyOwn', { defaultValue: 'Use the app on my own' })}
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

      {/* Language Selection Modal */}
      <Modal
        visible={languageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('firstLoad.selectLanguage', { defaultValue: 'Select Language' })}</Text>

            <ScrollView style={styles.languageScrollView} showsVerticalScrollIndicator={true}>
              {LANGUAGES.map((language) => (
                <TouchableOpacity
                  key={language.code}
                  style={[
                    styles.languageOption,
                    i18n.language === language.code && styles.languageOptionActive
                  ]}
                  onPress={() => changeLanguage(language.code)}
                >
                  <Text style={styles.languageFlag}>{language.flag}</Text>
                  <Text style={[
                    styles.languageOptionText,
                    i18n.language === language.code && styles.languageOptionTextActive
                  ]}>
                    {language.name}
                  </Text>
                  {i18n.language === language.code && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setLanguageModalVisible(false)}
            >
              <Text style={styles.closeModalButtonText}>{t('common.close', { defaultValue: 'Close' })}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2C31B',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 30,
    paddingVertical: 30,
  },
  formContainer: {
    width: '100%',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
    marginTop: 20,
  },
  subtitle: {
    fontSize: 16,
    color: '#333',
    marginBottom: 24,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  input: {
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: 'white',
    color: COLORS.TEXT,
    marginBottom: 16,
  },
  joinButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inviteCodeSection: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCodeIconButton: {
    padding: 4,
  },
  inviteCodeIcon: {
    fontSize: 16,
  },
  inviteCodeInput: {
    fontSize: 14,
    color: '#000',
    textAlign: 'left',
    padding: 8,
    flex: 1,
    maxWidth: 280,
    backgroundColor: 'transparent',
  },
  useOnMyOwnButton: {
    marginTop: 24,
    padding: 12,
    alignItems: 'center',
  },
  useOnMyOwnText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
    textDecorationLine: 'underline',
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: width * 0.85,
    maxWidth: 400,
    maxHeight: height * 0.7,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 20,
  },
  languageScrollView: {
    maxHeight: height * 0.45,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: '#F5F5F5',
  },
  languageOptionActive: {
    backgroundColor: '#F2C31B',
  },
  languageFlag: {
    fontSize: 24,
    marginRight: 12,
  },
  languageOptionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  languageOptionTextActive: {
    color: '#000',
  },
  checkmark: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  closeModalButton: {
    marginTop: 16,
    backgroundColor: '#F2F2F2',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});

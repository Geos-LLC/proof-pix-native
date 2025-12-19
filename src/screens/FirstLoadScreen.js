import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  Dimensions,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Clipboard
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { logLanguageChange } from '../utils/analytics';
import { FONTS } from '../constants/fonts';
import { canStartTrial } from '../services/trialService';

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

export default function FirstLoadScreen({ navigation, route }) {
  const { t, i18n } = useTranslation();
  const { individualSignIn } = useAdmin();
  const { updateUserInfo, updateUserPlan, userPlan, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const [userName, setUserName] = useState('');
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [referralModalVisible, setReferralModalVisible] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [languageInfoModalVisible, setLanguageInfoModalVisible] = useState(false);
  const [selectedLanguageName, setSelectedLanguageName] = useState('');
  const [pendingNavigation, setPendingNavigation] = useState(null); // 'planSelection' or 'referral'
  const scrollViewRef = useRef(null);
  const nameInputRef = useRef(null);
  const inputContainerRef = useRef(null);
  const formContainerRef = useRef(null);
  const [inputYPosition, setInputYPosition] = useState(0);
  const [formYPosition, setFormYPosition] = useState(0);

  // Check for invite code in clipboard (for users who copied code from landing page)
  // If found, automatically navigate to JoinTeam screen
  // Skip this check if user explicitly chose to use app individually
  useEffect(() => {
    const skipClipboardCheck = route?.params?.skipClipboardCheck;

    if (skipClipboardCheck) {
      console.log('[FirstLoad] Skipping clipboard check - user chose individual mode');
      return;
    }

    const checkClipboardForInvite = async () => {
      console.log('[FirstLoad] Checking clipboard for invite code...');
      try {
        const clipboardContent = await Clipboard.getString();
        console.log('[FirstLoad] Clipboard content:', clipboardContent ? clipboardContent.substring(0, 50) + '...' : 'empty');
        // Check if clipboard contains an invite code pattern: TOKEN|SESSIONID
        // Token is typically 22 chars base64, sessionId is 32 chars hex
        if (clipboardContent && clipboardContent.includes('|')) {
          const parts = clipboardContent.trim().split('|');
          console.log('[FirstLoad] Found | separator, parts:', parts.length, 'part1 length:', parts[0]?.length, 'part2 length:', parts[1]?.length);
          if (parts.length === 2 && parts[0].length > 10 && parts[1].length > 20) {
            console.log('[FirstLoad] Invite code detected in clipboard, navigating to JoinTeam');
            // Automatically navigate to JoinTeam with the invite code
            navigation.replace('JoinTeam', { invite: clipboardContent.trim() });
          }
        }
      } catch (error) {
        console.log('[FirstLoad] Could not check clipboard:', error.message);
      }
    };

    // Small delay to ensure screen is ready
    const timer = setTimeout(checkClipboardForInvite, 500);
    return () => clearTimeout(timer);
  }, [route?.params?.skipClipboardCheck]);

  // Check for referral code from route params or deep link
  useEffect(() => {
    const checkReferralCode = async () => {
      const { trackReferralInstallation } = await import('../services/referralService');
      const referralCode = route?.params?.code;
      if (referralCode) {
        // Track installation on server (also stores locally)
        const result = await trackReferralInstallation(referralCode);
        if (result && result.success) {
          console.log('[FirstLoad] Referral tracked on server:', result.data.referralId);
          Alert.alert(
            t('referral.codeAppliedTitle', { defaultValue: '🎉 Referral Code Applied!' }),
            t('referral.codeAppliedMessage', {
              defaultValue: 'Great! You get 45 days free trial and your friend gets 1 month free!'
            }),
            [{ text: t('common.ok') }]
          );
        } else if (result && result.error) {
          if (result.error.includes('already used a referral code')) {
            Alert.alert(
              t('referral.alreadyUsedTitle', { defaultValue: 'Already Used' }),
              t('referral.alreadyUsedMessage', {
                defaultValue: 'This device has already used a referral code. Each device can only use one referral code.'
              })
            );
          }
        }
      }
    };
    checkReferralCode();
  }, [route?.params?.code]);

  const changeLanguage = (languageCode) => {
    i18n.changeLanguage(languageCode);
    // Also apply the same language to labels and sections
    updateLabelLanguage(languageCode);
    updateSectionLanguage(languageCode);
    // Analytics: track app language change on first load
    try {
      logLanguageChange(languageCode);
    } catch (e) {
      // non‑critical
    }
    setLanguageModalVisible(false);
  };

  const getCurrentLanguage = () => {
    return LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];
  };

  const validateName = () => {
    if (!userName.trim()) {
      Alert.alert('Name Required', 'Please enter your name to continue.');
      return false;
    }
    return true;
  };

  const handleSelectTeam = async () => {
    // No name validation required - user will enter name on JoinTeam screen
    await updateUserPlan('team');
    navigation.navigate('JoinTeam');
  };

  const handleSelectIndividual = async () => {
    if (!validateName()) return;
    await updateUserInfo(userName.trim());

    // Apply current language to labels and sections
    const currentLang = i18n.language || 'en';
    updateLabelLanguage(currentLang);
    updateSectionLanguage(currentLang);

    // Set the language name for the popup
    const selectedLang = LANGUAGES.find(lang => lang.code === currentLang) || LANGUAGES[0];
    setSelectedLanguageName(selectedLang.name);

    // Check if user has a paid subscription (anything other than 'starter')
    const hasPaidSubscription = userPlan && userPlan !== 'starter';

    // Determine where to navigate after language info popup
    const canTrial = await canStartTrial();
    if (!canTrial && !hasPaidSubscription) {
      // No trial available and no subscription - will show referral code modal after
      setPendingNavigation('referral');
    } else {
      // Trial available OR has subscription - will go to plan selection after
      setPendingNavigation('planSelection');
    }

    // Show language info popup first
    setLanguageInfoModalVisible(true);
  };

  const handleLanguageInfoClose = () => {
    setLanguageInfoModalVisible(false);

    // Navigate based on pending action
    if (pendingNavigation === 'referral') {
      setReferralModalVisible(true);
    } else {
      navigation.navigate('PlanSelection');
    }
    setPendingNavigation(null);
  };

  const handleContinueWithoutReferral = () => {
    setReferralModalVisible(false);
    navigation.navigate('PlanSelection');
  };

  const handleReferralSubmitAndContinue = async () => {
    if (referralCodeInput.trim()) {
      const { trackReferralInstallation } = await import('../services/referralService');
      const result = await trackReferralInstallation(referralCodeInput.trim().toUpperCase());

      if (result && result.success) {
        console.log('[FirstLoad] Referral tracked on server:', result.data.referralId);

        // Show success modal
        setReferralModalVisible(false);
        setReferralCodeInput('');
        setSuccessModalVisible(true);
        return;
      } else {
        // Handle specific error messages
        let errorMessage = t('referral.invalidCodeMessage', {
          defaultValue: 'Invalid referral code. Please check and try again.'
        });

        if (result && result.error) {
          if (result.error.includes('already used a referral code')) {
            errorMessage = t('referral.alreadyUsedMessage', {
              defaultValue: 'This device has already used a referral code. Each device can only use one referral code.'
            });
          } else if (result.error.includes('Invalid referral code')) {
            errorMessage = t('referral.codeDoesNotExistMessage', {
              defaultValue: 'This referral code does not exist. Please check with your friend and try again.'
            });
          } else {
            errorMessage = result.error;
          }
        }

        Alert.alert(
          t('referral.unableToApplyTitle', { defaultValue: 'Unable to Apply Code' }),
          errorMessage
        );
        return;
      }
    }

    setReferralModalVisible(false);
    setReferralCodeInput('');
    navigation.navigate('PlanSelection');
  };

  const handleFormContainerLayout = (event) => {
    const { y } = event.nativeEvent.layout;
    setFormYPosition(y);
  };

  const handleInputContainerLayout = (event) => {
    const { y } = event.nativeEvent.layout;
    setInputYPosition(y);
  };

  const handleNameInputFocus = () => {
    // Scroll to show the input field and buttons when keyboard appears
    // Calculate total Y position: formContainer Y + inputContainer Y
    const totalY = formYPosition + inputYPosition;
    setTimeout(() => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: Math.max(0, totalY - 150), // Offset to ensure buttons are visible above keyboard
          animated: true
        });
      }
    }, 300);
  };


  const renderInitialSelection = () => (
    <View 
      ref={formContainerRef}
      style={styles.formContainer}
      onLayout={handleFormContainerLayout}
    >
      <View 
        ref={inputContainerRef} 
        style={styles.inputContainer}
        onLayout={handleInputContainerLayout}
      >
        <Text style={styles.inputLabel}>{t('firstLoad.yourName')}</Text>
        <TextInput
          ref={nameInputRef}
          style={styles.textInput}
          value={userName}
          onChangeText={setUserName}
          placeholder={t('firstLoad.enterYourName')}
          placeholderTextColor="#999"
          autoCapitalize="words"
          autoCorrect={false}
          onFocus={handleNameInputFocus}
        />
      </View>

      <View>
        <TouchableOpacity
          style={[styles.selectionButton, styles.individualButton]}
          onPress={handleSelectIndividual}
        >
          <Text style={[styles.selectionButtonText, styles.individualButtonText]}>
            {t('firstLoad.startUsingApp', { defaultValue: 'Start using the app' })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.teamLinkButton}
          onPress={handleSelectTeam}
        >
          <Text style={styles.teamLinkText}>
            {t('firstLoad.invitedToTeam', { defaultValue: 'I was invited to a team' })}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{marginTop: 20}}>
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
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollViewRef}
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
          <Text style={styles.appSubtitle}>{t('firstLoad.subtitle')}</Text>
        </View>

        {renderInitialSelection()}

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
            <Text style={styles.modalTitle}>{t('firstLoad.selectLanguage')}</Text>

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
              <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Referral Code Modal */}
      <Modal
        visible={referralModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleContinueWithoutReferral}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.referralModalContent}>
            <Text style={styles.modalTitle}>
              {t('referral.haveCodeTitle', { defaultValue: 'Have a Referral Code?' })}
            </Text>
            <Text style={styles.modalSubtitle}>
              {t('referral.haveCodeSubtitle', {
                defaultValue: "Enter your friend's referral code to get 45 days free trial! Your friend also gets 1 month free."
              })}
            </Text>

            <View style={styles.referralInputContainer}>
              <TextInput
                style={styles.referralInput}
                value={referralCodeInput}
                onChangeText={setReferralCodeInput}
                placeholder={t('referral.codePlaceholder', { defaultValue: 'Enter code (e.g., ABC123)' })}
                placeholderTextColor="#999"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={10}
              />
            </View>

            <TouchableOpacity
              style={[styles.closeModalButton, styles.referralSubmitButton]}
              onPress={handleReferralSubmitAndContinue}
            >
              <Text style={styles.closeModalButtonText}>
                {referralCodeInput.trim()
                  ? t('referral.applyAndContinue', { defaultValue: 'Apply & Continue' })
                  : t('referral.continue', { defaultValue: 'Continue' })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleContinueWithoutReferral}
            >
              <Text style={styles.skipButtonText}>
                {t('referral.skip', { defaultValue: 'Skip' })}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={successModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setSuccessModalVisible(false);
          navigation.navigate('PlanSelection');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.successModalContent}>
            <Text style={styles.successIcon}>🎉</Text>
            <Text style={styles.successTitle}>
              {t('trial.extendedTitle', { defaultValue: 'Congratulations!' })}
            </Text>
            <Text style={styles.successMessage}>
              {t('trial.extendedLine1', {
                days: 45,
                defaultValue: 'You get 45 days free trial'
              })}
            </Text>
            <Text style={styles.successMessage}>
              {t('trial.extendedLine2', {
                friendDays: 30,
                defaultValue: 'Your friend gets additional 30 days free!'
              })}
            </Text>
            <Text style={styles.successSubtext}>
              {t('trial.extendedSubtext', { defaultValue: 'Welcome to your extended free trial' })}
            </Text>

            <TouchableOpacity
              style={styles.successButton}
              onPress={() => {
                setSuccessModalVisible(false);
                navigation.navigate('PlanSelection');
              }}
            >
              <Text style={styles.successButtonText}>
                {t('trial.extendedButton', { defaultValue: 'Got it' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Language Info Modal - Custom styled */}
      <Modal
        visible={languageInfoModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleLanguageInfoClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.languageInfoModalContent}>
            <Text style={styles.languageInfoIcon}>{getCurrentLanguage().flag}</Text>
            <Text style={styles.languageInfoTitle}>
              {t('firstLoad.languageAppliedTitle', { defaultValue: 'Language Applied' })}
            </Text>
            <Text style={styles.languageInfoMessage}>
              {t('firstLoad.languageAppliedIntro', {
                language: selectedLanguageName,
                defaultValue: `${selectedLanguageName} has been set for:`
              })}
            </Text>
            <View style={styles.languageInfoBullets}>
              <Text style={styles.languageInfoBulletItem}>
                • {t('firstLoad.languageBulletApp', { defaultValue: 'App' })}
              </Text>
              <Text style={styles.languageInfoBulletItem}>
                • {t('firstLoad.languageBulletLabels', { defaultValue: 'Photo labels' })}
              </Text>
              <Text style={styles.languageInfoBulletItem}>
                • {t('firstLoad.languageBulletSections', { defaultValue: 'Section names' })}
              </Text>
            </View>
            <Text style={styles.languageInfoSubtext}>
              {t('firstLoad.languageChangeHint', {
                defaultValue: 'You can change these separately in '
              })}
              <Text style={styles.languageInfoSettingsHighlight}>
                {t('settings.title', { defaultValue: 'Settings' })}
              </Text>
              {t('firstLoad.languageChangeHintEnd', { defaultValue: ' later.' })}
            </Text>
            <TouchableOpacity
              style={styles.languageInfoButton}
              onPress={handleLanguageInfoClose}
            >
              <Text style={styles.languageInfoButtonText}>
                {t('common.gotIt', { defaultValue: 'Got it' })}
              </Text>
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
    backgroundColor: '#F2C31B'
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 30,
    paddingVertical: 30
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 0,
    marginRight: 5
  },
  appTitle: {
    fontSize: FONTS.XXXLARGE,
    fontWeight: FONTS.BOLD,
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000000',
    marginBottom: 0
  },
  appSubtitle: {
    fontSize: 16,
    color: '#333333',
    textAlign: 'center',
    marginTop: 0
  },
  formContainer: {
    width: '100%',
  },
  welcomeText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 30
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: 'white',
    color: COLORS.TEXT,
  },
  selectionButton: {
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
  },
  teamButton: {
    backgroundColor: '#007bff',
    borderColor: '#0056b3',
  },
  individualButton: {
    backgroundColor: '#333',
    borderColor: '#000',
  },
  selectionButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  teamButtonText: {
    color: '#fff',
  },
  individualButtonText: {
    color: '#fff',
  },
  selectionSubtext: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    marginTop: 8,
  },
  teamLinkButton: {
    marginTop: 60,
    paddingVertical: 12,
    alignItems: 'center',
  },
  teamLinkText: {
    fontSize: 15,
    color: '#333',
    textDecorationLine: 'underline',
    fontFamily: FONTS.QUICKSAND_MEDIUM,
  },
  backLink: {
    marginBottom: 20,
    alignSelf: 'flex-start',
  },
  backLinkText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '600',
  },
  planContainer: {
    marginBottom: 20,
  },
  planButton: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  planButtonText: {
    color: '#333',
  },
  planSubtext: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
  },
  planCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  planDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
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
  languageRowArrow: {
    fontSize: 12,
    color: '#fff',
    marginHorizontal: 8,
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
  referralModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: width * 0.85,
    maxWidth: 400,
    marginBottom: 30, // Move modal up slightly (30px) to avoid keyboard covering skip button
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
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  referralInputContainer: {
    marginBottom: 16,
  },
  referralInput: {
    backgroundColor: '#F5F5F5',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 2,
    color: '#333',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  referralSubmitButton: {
    backgroundColor: COLORS.PRIMARY,
  },
  skipButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 14,
    color: '#666',
    textDecorationLine: 'underline',
  },
  successModalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 32,
    width: width * 0.85,
    maxWidth: 400,
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 20,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: 18,
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
    lineHeight: 26,
  },
  highlightText: {
    fontWeight: 'bold',
    color: '#000',
  },
  successSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
    marginBottom: 24,
    textAlign: 'center',
  },
  successButton: {
    backgroundColor: '#F2C31B',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  successButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
  },
  // Language Info Modal Styles
  languageInfoModalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 28,
    width: width * 0.85,
    maxWidth: 380,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  languageInfoIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  languageInfoIconContainer: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  languageInfoIcon: {
    fontSize: 36,
  },
  languageInfoTitle: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000',
    marginBottom: 16,
    textAlign: 'center',
  },
  languageInfoMessage: {
    fontSize: 16,
    fontFamily: FONTS.QUICKSAND_MEDIUM,
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  languageInfoBullets: {
    alignSelf: 'flex-start',
    marginLeft: 40,
    marginBottom: 12,
  },
  languageInfoBulletItem: {
    fontSize: 16,
    fontFamily: FONTS.QUICKSAND_MEDIUM,
    color: '#333',
    lineHeight: 26,
  },
  languageInfoSubtext: {
    fontSize: 14,
    fontFamily: FONTS.QUICKSAND_REGULAR,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  languageInfoSettingsHighlight: {
    color: '#F2C31B',
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  languageInfoButton: {
    backgroundColor: '#F2C31B',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  languageInfoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000',
  },
});

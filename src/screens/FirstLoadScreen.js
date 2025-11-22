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
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { logLanguageChange } from '../utils/analytics';
import { FONTS } from '../constants/fonts';

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
  const { updateUserInfo, updateUserPlan } = useSettings();
  const [userName, setUserName] = useState('');
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [referralModalVisible, setReferralModalVisible] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const scrollViewRef = useRef(null);
  const nameInputRef = useRef(null);
  const inputContainerRef = useRef(null);
  const formContainerRef = useRef(null);
  const [inputYPosition, setInputYPosition] = useState(0);
  const [formYPosition, setFormYPosition] = useState(0);

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
            '🎉 Referral Code Applied!',
            'Great! You get 45 days free trial and your friend gets 1 month free!',
            [{ text: 'OK' }]
          );
        } else if (result && result.error) {
          if (result.error.includes('already used a referral code')) {
            Alert.alert(
              'Already Used',
              'This device has already used a referral code. Each device can only use one referral code.'
            );
          }
        }
      }
    };
    checkReferralCode();
  }, [route?.params?.code]);

  const changeLanguage = (languageCode) => {
    i18n.changeLanguage(languageCode);
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
    if (!validateName()) return;
    await updateUserInfo(userName.trim());
    await updateUserPlan('team');
    navigation.navigate('JoinTeam');
  };

  const handleSelectIndividual = async () => {
    if (!validateName()) return;
    await updateUserInfo(userName.trim());
    // Show referral code modal before navigating to plan selection
    setReferralModalVisible(true);
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
        let errorMessage = 'Invalid referral code. Please check and try again.';

        if (result && result.error) {
          if (result.error.includes('already used a referral code')) {
            errorMessage = 'This device has already used a referral code. Each device can only use one referral code.';
          } else if (result.error.includes('Invalid referral code')) {
            errorMessage = 'This referral code does not exist. Please check with your friend and try again.';
          } else {
            errorMessage = result.error;
          }
        }

        Alert.alert('Unable to Apply Code', errorMessage);
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
          style={[styles.selectionButton, styles.teamButton]}
          onPress={handleSelectTeam}
        >
          <Text style={[styles.selectionButtonText, styles.teamButtonText]}>{t('firstLoad.joinTeam')}</Text>
        </TouchableOpacity>
      </View>

      <View style={{marginTop: 16}}>
        <TouchableOpacity
          style={[styles.selectionButton, styles.individualButton]}
          onPress={handleSelectIndividual}
        >
          <Text style={[styles.selectionButtonText, styles.individualButtonText]}>{t('firstLoad.useIndividual')}</Text>
        </TouchableOpacity>
        <Text style={styles.selectionSubtext}>{t('firstLoad.individualSubtext')}</Text>
      </View>

      <View style={{marginTop: 16}}>
        <TouchableOpacity
          style={[styles.selectionButton, styles.languageButton]}
          onPress={() => setLanguageModalVisible(true)}
        >
          <Text style={[styles.selectionButtonText, styles.languageButtonText]}>
            {t('firstLoad.chooseAppLanguage')}
          </Text>
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
            <Text style={styles.modalTitle}>Have a Referral Code?</Text>
            <Text style={styles.modalSubtitle}>Enter your friend's referral code to get 45 days free trial! Your friend also gets 1 month free.</Text>

            <View style={styles.referralInputContainer}>
              <TextInput
                style={styles.referralInput}
                value={referralCodeInput}
                onChangeText={setReferralCodeInput}
                placeholder="Enter code (e.g., ABC123)"
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
                {referralCodeInput.trim() ? 'Apply & Continue' : 'Continue'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleContinueWithoutReferral}
            >
              <Text style={styles.skipButtonText}>Skip</Text>
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
            <Text style={styles.successTitle}>Congratulations!</Text>
            <Text style={styles.successMessage}>
              You get <Text style={styles.highlightText}>45 days free trial</Text>
            </Text>
            <Text style={styles.successMessage}>
              Your friend gets <Text style={styles.highlightText}>additional 30 days</Text> free!
            </Text>
            <Text style={styles.successSubtext}>Welcome to your extended free trial</Text>

            <TouchableOpacity
              style={styles.successButton}
              onPress={() => {
                setSuccessModalVisible(false);
                navigation.navigate('PlanSelection');
              }}
            >
              <Text style={styles.successButtonText}>Got it</Text>
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
  languageButton: {
    backgroundColor: '#28a745',
    borderColor: '#1e7e34',
  },
  languageButtonText: {
    color: '#fff',
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
});

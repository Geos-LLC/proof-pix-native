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
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { logLanguageChange, logOnboardingCompleted, logOnboardingStepCompleted } from '../utils/analytics';
import { FONTS } from '../constants/fonts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { isRTLLanguage } from '../hooks/useRTL';

const { width, height } = Dimensions.get('window');

// Static map so Metro can bundle all flag assets at build time (dynamic require() is not supported).
const FLAG_IMAGES = {
  en: require('../../assets/flags/usa.png'),
  es: require('../../assets/flags/spain.png'),
  fr: require('../../assets/flags/france.png'),
  de: require('../../assets/flags/germany.png'),
  ru: require('../../assets/flags/russia.png'),
  be: require('../../assets/flags/belarus.png'),
  zh: require('../../assets/flags/china.png'),
  tl: require('../../assets/flags/philipines.png'),
  ar: require('../../assets/flags/saudi.png'),
  ko: require('../../assets/flags/korea.png'),
  pt: require('../../assets/flags/portugal.png'),
  uk: require('../../assets/flags/ukraine.png'),
  vi: require('../../assets/flags/vietnam.png'),
};

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];

export default function FirstLoadScreen({ navigation, route }) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { individualSignIn } = useAdmin();
  const { updateUserInfo, updateUserPlan, userPlan, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const [userName, setUserName] = useState('');
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [referralCodeModalVisible, setReferralCodeModalVisible] = useState(false);
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [applyingReferralCode, setApplyingReferralCode] = useState(false);
  const scrollViewRef = useRef(null);
  const nameInputRef = useRef(null);
  const inputContainerRef = useRef(null);
  const formContainerRef = useRef(null);
  const [inputYPosition, setInputYPosition] = useState(0);
  const [formYPosition, setFormYPosition] = useState(0);

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
        if (clipboardContent && clipboardContent.includes('|')) {
          const parts = clipboardContent.trim().split('|');
          console.log('[FirstLoad] Found | separator, parts:', parts.length, 'part1 length:', parts[0]?.length, 'part2 length:', parts[1]?.length);
          if (parts.length === 2 && parts[0].length > 10 && parts[1].length > 20) {
            console.log('[FirstLoad] Invite code detected in clipboard, navigating to JoinTeam');
            navigation.replace('JoinTeam', { invite: clipboardContent.trim() });
          }
        }
      } catch (error) {
        console.log('[FirstLoad] Could not check clipboard:', error.message);
      }
    };

    const timer = setTimeout(checkClipboardForInvite, 500);
    return () => clearTimeout(timer);
  }, [route?.params?.skipClipboardCheck]);

  useEffect(() => {
    const checkReferralCode = async () => {
      const { trackReferralInstallation } = await import('../services/referralService');
      const referralCode = route?.params?.code;
      if (referralCode) {
        const result = await trackReferralInstallation(referralCode);
        if (result && result.success) {
          console.log('[FirstLoad] Referral tracked on server:', result.data.referralId);
          Alert.alert(
            t('referral.codeAppliedTitle', { defaultValue: '14-Day Trial Activated' }),
            t('referral.codeAppliedMessage', {
              defaultValue: 'You joined ProofPix through a referral and received 7 additional free trial days.'
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
    const wasRTL = isRTLLanguage(i18n.language);
    const willBeRTL = isRTLLanguage(languageCode);

    i18n.changeLanguage(languageCode);
    // Explicitly persist language choice (safety net for async detector)
    AsyncStorage.setItem('@proofpix_language', languageCode).catch(() => {});
    updateLabelLanguage(languageCode);
    updateSectionLanguage(languageCode);
    try {
      logLanguageChange(languageCode);
    } catch (e) {
      // non‑critical
    }
    setLanguageModalVisible(false);

    // RTL direction change requires app restart to take full effect
    if (wasRTL !== willBeRTL) {
      Alert.alert(
        willBeRTL ? 'إعادة تشغيل مطلوبة' : 'Restart Required',
        willBeRTL
          ? 'يرجى إعادة تشغيل التطبيق لتطبيق اتجاه اللغة العربية بشكل صحيح.'
          : 'Please restart the app to apply the language direction correctly.',
        [
          { text: willBeRTL ? 'لاحقاً' : 'Later', style: 'cancel' },
          {
            text: willBeRTL ? 'إعادة تشغيل' : 'Restart Now',
            onPress: () => Updates.reloadAsync(),
          },
        ]
      );
    }
  };

  const getCurrentLanguage = () => {
    return LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];
  };

  const validateName = () => {
    if (!userName.trim()) {
      Alert.alert(t('firstLoad.nameRequired'), t('firstLoad.nameRequiredMessage'));
      return false;
    }
    return true;
  };

  const handleSelectTeam = async () => {
    await updateUserPlan('team');
    navigation.navigate('JoinTeam');
  };

  const handleSelectIndividual = async () => {
    if (!validateName()) return;
    await updateUserInfo(userName.trim());

    const currentLang = i18n.language || 'en';
    updateLabelLanguage(currentLang);
    updateSectionLanguage(currentLang);

    // Growth mechanics intentionally absent from onboarding — referral
    // attribution from a deep link still flows via `route.params.code`
    // handled above; the share/invite UX surfaces post value-moment.
    logOnboardingCompleted();
    navigation.replace('Home');
  };

  // Receiving-side referral entry — quiet, opt-in. A new user who
  // arrived with a code in hand (texted by a colleague, not via a
  // deep link) needs somewhere to type it. Auto-promotion still
  // intentionally absent.
  const handleApplyReferralCodeFromOnboarding = async () => {
    const code = referralCodeInput.trim().toUpperCase();
    if (!code) return;
    setApplyingReferralCode(true);
    try {
      const { trackReferralInstallation, getUserId } = await import('../services/referralService');
      const result = await trackReferralInstallation(code);
      if (result?.success) {
        setReferralCodeModalVisible(false);
        setReferralCodeInput('');
        Alert.alert(
          t('referral.appliedTitle', { defaultValue: '14-Day Trial Activated' }),
          t('referral.appliedMessage', {
            defaultValue: 'You joined ProofPix through a referral and received 7 additional free trial days.',
          }),
        );
        return;
      }

      // Fall back to admin-marketing referrals so flyer/QR codes resolve too
      const { redeemAdminReferralCode, hasRedeemedAdminReferral, markAdminReferralRedeemed } =
        await import('../services/adminReferralService');
      const alreadyAdmin = await hasRedeemedAdminReferral();
      if (!alreadyAdmin) {
        const userId = await getUserId();
        const adminResult = await redeemAdminReferralCode(code, userId);
        if (adminResult?.success && adminResult?.grantedDays > 0) {
          const { extendTrial } = await import('../services/trialService');
          await extendTrial(adminResult.grantedDays);
          await markAdminReferralRedeemed();
          setReferralCodeModalVisible(false);
          setReferralCodeInput('');
          Alert.alert(
            t('referral.appliedTitle', { defaultValue: 'Referral Applied!' }),
            t('referral.appliedMessage', {
              defaultValue: `You've received ${adminResult.grantedDays} extra days free!`,
            }),
          );
          return;
        }
      }

      let errorMessage = t('referral.invalidCodeMessage', {
        defaultValue: 'Invalid referral code. Please check and try again.',
      });
      if (result?.error?.includes('already used a referral code')) {
        errorMessage = t('referral.alreadyUsedMessage', {
          defaultValue: 'A referral code has already been applied to this device.',
        });
      } else if (result?.error?.includes('Invalid referral code')) {
        errorMessage = t('referral.codeDoesNotExistMessage', {
          defaultValue: "This referral code doesn't exist. Double-check with your friend.",
        });
      } else if (result?.error) {
        errorMessage = result.error;
      }
      Alert.alert(
        t('referral.unableToApplyTitle', { defaultValue: 'Unable to Apply Code' }),
        errorMessage,
      );
    } catch (error) {
      console.error('[FirstLoad] Error applying referral code:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('referral.applyErrorMessage', {
          defaultValue: 'Could not apply the code. Check your connection and try again.',
        }),
      );
    } finally {
      setApplyingReferralCode(false);
    }
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
    const totalY = formYPosition + inputYPosition;
    setTimeout(() => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: Math.max(0, totalY - 150),
          animated: true
        });
      }
    }, 300);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeftContent}>
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.headerTitle}>ProofPix</Text>
        </View>
        
        <TouchableOpacity
          style={styles.languageSelector}
          onPress={() => setLanguageModalVisible(true)}
        >
          <Image
            source={FLAG_IMAGES[getCurrentLanguage().code] || FLAG_IMAGES.en}
            style={styles.languageFlagImage}
            resizeMode="cover"
          />
          <Ionicons name="chevron-down" style={{padding:2}} size={18} color="#200E32" />
        </TouchableOpacity>
      </View>

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
          {/* User Avatar Icon */}
          <View style={styles.avatarContainer}>
          <Image
              source={require('../../assets/joinuser.png')}
              resizeMode="contain"
              style={{width: 97, height: 97}}
            />
          </View>

          {/* Title */}
          <Text style={styles.mainTitle}>
            {t('firstLoad.letsStart', { defaultValue: "Let's start with your name" })}
          </Text>

          {/* Name Input */}
          <View style={styles.inputContainer}>
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>
                {t('firstLoad.yourName', { defaultValue: 'Your Name' })}
              </Text>
              <TextInput
                ref={nameInputRef}
                style={styles.textInput}
                value={userName}
                onChangeText={setUserName}
                placeholder={t('firstLoad.namePlaceholder')}
                placeholderTextColor="#999"
                autoCapitalize="words"
                autoCorrect={false}
                onFocus={handleNameInputFocus}
              />
            </View>
          </View>

          {/* Save & Continue Button */}
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSelectIndividual}
            activeOpacity={0.8}
          >
            <Text style={styles.saveButtonText}>
              {t('firstLoad.saveContinue', { defaultValue: 'Save & Continue' })}
            </Text>
          </TouchableOpacity>

          {/* OR Separator */}
          <View style={styles.orContainer}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>{t('common.or')}</Text>
            <View style={styles.orLine} />
          </View>

          {/* Team Invitation Link */}
          <TouchableOpacity
            style={styles.teamLinkButton}
            onPress={handleSelectTeam}
          >
            <Text style={styles.teamLinkText}>
              {t('firstLoad.invitedToTeam', { defaultValue: 'I was invited to a team' })}
            </Text>
          </TouchableOpacity>

          {/* Receiving-side referral entry — quiet ghost link, no growth
              copy. Lets a new user who arrived with a code from a
              colleague apply it before reaching Home. */}
          <TouchableOpacity
            style={styles.haveReferralLink}
            onPress={() => setReferralCodeModalVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="ticket-outline" size={14} color="#7A5B00" />
            <Text style={styles.haveReferralLinkText}>
              {t('firstLoad.haveReferralCode', { defaultValue: 'I have a referral code' })}
            </Text>
          </TouchableOpacity>

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
                  <Image
            source={FLAG_IMAGES[language.code] || FLAG_IMAGES.en}
            style={styles.languageFlagImages}
            resizeMode="cover"
          />
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

      {/* Referral Code Entry Modal — receiving-side only. Opens on
          explicit user tap of the "I have a referral code" ghost link.
          No auto-trigger, no growth copy. */}
      <Modal
        visible={referralCodeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReferralCodeModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setReferralCodeModalVisible(false)}
          >
            <View
              style={styles.referralOnboardingSheet}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalHandle} />
              <View style={styles.modalHeaderBottomSheet}>
                <TouchableOpacity
                  style={styles.modalCloseButtonTop}
                  onPress={() => setReferralCodeModalVisible(false)}
                >
                  <Ionicons name="close" size={24} color={COLORS.TEXT} />
                </TouchableOpacity>
                <Text style={styles.modalTitleBottomSheet}>
                  {t('referral.enterCodeTitle', { defaultValue: 'Enter Referral Code' })}
                </Text>
                <View style={styles.modalCloseButtonTop} />
              </View>

              <View style={styles.referralOnboardingBody}>
                <Text style={styles.referralOnboardingSubtitle}>
                  {t('referral.enterCodeSubtitle', {
                    defaultValue: 'Got an 8-character code from a colleague? Enter it here to claim a 14-day free trial.',
                  })}
                </Text>

                <TextInput
                  style={styles.referralOnboardingInput}
                  value={referralCodeInput}
                  onChangeText={(text) => setReferralCodeInput(text.toUpperCase().replace(/\s/g, ''))}
                  placeholder={t('referral.codePlaceholder', { defaultValue: 'ENTER CODE' })}
                  placeholderTextColor="#999"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                  editable={!applyingReferralCode}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.referralOnboardingApplyButton,
                  (!referralCodeInput.trim() || applyingReferralCode) && styles.referralOnboardingApplyButtonDisabled,
                ]}
                onPress={handleApplyReferralCodeFromOnboarding}
                disabled={!referralCodeInput.trim() || applyingReferralCode}
                activeOpacity={0.85}
              >
                <Text style={styles.referralOnboardingApplyButtonText}>
                  {applyingReferralCode
                    ? t('referral.applying', { defaultValue: 'Applying…' })
                    : t('referral.applyCode', { defaultValue: 'Apply Code' })}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
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
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerLeftContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoContainer: {
    width: 50,
    height: 50,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 50,
    height: 50,
  },
  headerTitle: {
    fontSize: 25,
    fontWeight: 'bold',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    letterSpacing: -0.11,
  },
  languageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 62,
    paddingHorizontal: 1,
    paddingVertical: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 15,
    elevation: 3,
  },
  languageFlag: {
    fontSize: 24,
    marginRight: 4,
  },
  languageFlagImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 4,
  },
  languageFlagImages: {
    width: 40,
    height: 40,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  avatarContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  avatarIcon: {
    width: 97,
    height: 97,
    borderRadius: 48.5,
    backgroundColor: 'rgba(255, 199, 0, 0.13)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarHead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000000',
    marginBottom: 4,
  },
  avatarBody: {
    width: 36,
    height: 20,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#000000',
    opacity: 0.5,
  },
  mainTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontWeight: '800',
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: 18,
  },
  inputContainer: {
    marginBottom: 18,
  },
  inputBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5D5D5',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingTop: 5,
    paddingBottom: 7,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    opacity: 0.65,
    marginBottom: 4,
  },
  textInput: {
    fontSize: 15,
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    padding: 0,
    margin: 0,
  },
  saveButton: {
    backgroundColor: '#000000',
    borderRadius: 100,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#FFFFFF',
  },
  orContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 27,
    marginBottom: 10,
    paddingHorizontal: 40,
    marginHorizontal: 70,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#000000',
    opacity: 0.2,
  },
  orText: {
    fontSize: 13,
    fontWeight: '300',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    marginHorizontal: 8,
    textTransform: 'uppercase',
  },
  teamLinkButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  teamLinkText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textDecorationLine: 'underline',
    letterSpacing: 0.3,
  },
  haveReferralLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
    gap: 6,
  },
  haveReferralLinkText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#7A5B00',
    letterSpacing: -0.1,
  },
  referralOnboardingSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    width: '100%',
  },
  referralOnboardingBody: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 20,
  },
  referralOnboardingSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  referralOnboardingInput: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 20,
    fontWeight: '800',
    color: '#1E1E1E',
    textAlign: 'center',
    letterSpacing: 3,
  },
  referralOnboardingApplyButton: {
    marginHorizontal: 24,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  referralOnboardingApplyButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  referralOnboardingApplyButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContentBottomSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    minHeight: '80%',
    maxHeight: '90%',
    paddingBottom: 20,
    width: '100%',
  },
  referralModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '55%',
    paddingBottom: 20,
    width: '100%',
  },
  languageInfoModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '50%',
    paddingBottom: 20,
    width: '100%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5E5',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  modalHeaderBottomSheet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    position: 'relative',
  },
  modalCloseButtonTop: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    left: 20,
    top: 0,
    zIndex: 1,
  },
  headerSpacer: {
    width: 32,
  },
  modalTitleBottomSheet: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    flex: 1,
    textAlign: 'center',
  },
  referralScrollView: {
    flexGrow: 1,
    flexShrink: 1,
  },
  referralContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  languageScrollView: {
    maxHeight: height * 0.8,
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
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
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
    marginBottom: 8,
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
  referralButtonsContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  referralSubmitButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  referralSubmitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
  skipButton: {
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
    alignSelf: 'center',
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
  closeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  languageInfoScrollView: {
    flexGrow: 1,
    flexShrink: 1,
  },
  languageInfoContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    alignItems: 'center',
  },
  languageInfoIconContainer: {
    marginTop: 8,
    marginBottom: 24,
  },
  languageInfoIcon: {
    fontSize: 48,
  },
  languageInfoMessage: {
    fontSize: 16,
    fontWeight: '500',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  languageInfoBullets: {
    width: '100%',
    marginBottom: 20,
    paddingLeft: 20,
  },
  languageInfoBulletItem: {
    fontSize: 16,
    fontWeight: '500',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    lineHeight: 26,
  },
  languageInfoSubtext: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
    width: '100%',
  },
  languageInfoSettingsHighlight: {
    color: COLORS.PRIMARY,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
  languageInfoButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageInfoButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
});
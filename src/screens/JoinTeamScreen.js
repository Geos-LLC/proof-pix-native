import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';

const { width, height } = Dimensions.get('window');

// Static map so Metro can bundle all flag assets at build time (same as FirstLoadScreen).
const FLAG_IMAGES = {
  en: require('../../assets/flags/usa.png'),
  es: require('../../assets/flags/spain.png'),
  fr: require('../../assets/flags/france.png'),
  de: require('../../assets/flags/germany.png'),
  ru: require('../../assets/flags/usa.png'),
  be: require('../../assets/flags/belarus.png'),
  zh: require('../../assets/flags/china.png'),
  tl: require('../../assets/flags/philipines.png'),
  ar: require('../../assets/flags/saudi.png'),
  ko: require('../../assets/flags/korea.png'),
};

// Same list as FirstLoadScreen (matches FLAG_IMAGES).
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
];

const YELLOW = '#F2C31B';

export default function JoinTeamScreen({ navigation, route }) {
  const { t, i18n } = useTranslation();
  const { updateUserInfo, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const { isAuthenticated } = useAdmin();

  const inviteFromParams = route?.params?.invite || '';
  const [inviteCode, setInviteCode] = useState(inviteFromParams);
  const [userName, setUserName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const inviteCodeRef = useRef(null);

  // Auto-fill invite code from route params or clipboard
  useEffect(() => {
    const initInviteCode = async () => {
      if (inviteFromParams) {
        setInviteCode(inviteFromParams);
      } else {
        try {
          const clipboardContent = await Clipboard.getStringAsync();
          if (clipboardContent && clipboardContent.includes('|')) {
            const parts = clipboardContent.trim().split('|');
            if (parts.length === 2 && parts[0].length > 10 && parts[1].length > 20) {
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
    return LANGUAGES.find((lang) => lang.code === i18n.language) || LANGUAGES[0];
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

    const parts = inviteCode.trim().split('|');
    if (parts.length !== 2) {
      Alert.alert(
        t('joinTeam.invalidCode', { defaultValue: 'Invalid Code' }),
        t('joinTeam.invalidCodeFormat', {
          defaultValue: 'This invite code is not in the correct format. Please check with your admin.',
        })
      );
      return;
    }

    const [token, sessionIdOrUrl] = parts;
    if (!token || !sessionIdOrUrl) {
      Alert.alert(
        t('joinTeam.invalidCode', { defaultValue: 'Invalid Code' }),
        t('joinTeam.incompleteCode', {
          defaultValue: 'This invite code is incomplete. Please check with your admin.',
        })
      );
      return;
    }

    setIsLoading(true);
    try {
      await updateUserInfo(userName.trim());
      navigation.navigate('Invite', {
        token: token,
        sessionId: sessionIdOrUrl,
      });
    } catch (e) {
      console.log('[JoinTeam] join error', e?.message);
      Alert.alert(
        t('joinTeam.error', { defaultValue: 'Error' }),
        t('joinTeam.joinFailed', { defaultValue: 'Unable to join the team. Please try again.' })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseOnMyOwn = () => {
    navigation.replace('FirstLoad', { skipClipboardCheck: true });
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
            resizeMode="contain"
          />
          <Ionicons name="chevron-down" style={{ padding: 2 }} size={18} color="#200E32" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Team Avatar Icon */}
          <View style={styles.avatarContainer}>
          <Image
              source={require('../../assets/jointeam.png')}
              resizeMode="contain"
              style={{width: 97, height: 97}}
            />
          </View>

          {/* Title and Subtitle */}
          <Text style={styles.mainTitle}>
            {t('joinTeam.title', { defaultValue: 'Join a Team' })}
          </Text>
          <Text style={styles.subtitle}>
            {t('joinTeam.subtitle', {
              defaultValue: 'Enter the invite code your team admin shared with you.',
            })}
          </Text>

          {/* Invitation Code Input */}
          <View style={styles.inputContainer}>
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>
                {t('joinTeam.invitationCode', { defaultValue: 'Invitation Code' })}
              </Text>
              <TextInput
                ref={inviteCodeRef}
                style={styles.textInput}
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder={t('joinTeam.enterInviteCode', { defaultValue: 'Proofpix007' })}
                placeholderTextColor="#000"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Your Name Input */}
          <View style={styles.inputContainer}>
            <View style={styles.inputBox}>
              <Text style={styles.inputLabel}>
                {t('firstLoad.yourName', { defaultValue: 'Your Name' })}
              </Text>
              <TextInput
                style={styles.textInput}
                value={userName}
                onChangeText={setUserName}
                placeholder={'Alex Bond'}
                placeholderTextColor="#000"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Join Button */}
          <TouchableOpacity
            style={styles.joinButton}
            onPress={handleJoinTeam}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Text style={styles.joinButtonText}>
              {isLoading
                ? t('joinTeam.joining', { defaultValue: 'Joining...' })
                : t('joinTeam.join', { defaultValue: 'Join' })}
            </Text>
          </TouchableOpacity>

          {/* OR Separator */}
          <View style={styles.orContainer}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR</Text>
            <View style={styles.orLine} />
          </View>

          {/* Join as Individual Link */}
          <TouchableOpacity
            style={styles.individualLinkButton}
            onPress={handleUseOnMyOwn}
          >
            <Text style={styles.individualLinkText}>
              {t('joinTeam.joinIndividual', { defaultValue: 'Join as Individual' })}
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
                      resizeMode="contain"
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F6F8FA',
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
  logoCircle: {
    width: 39,
    height: 39,
    borderRadius: 19.5,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
  },
  logoArrow: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoArrowText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: -2,
  },
  logoCircleOutline: {
    width: 33,
    height: 33,
    borderRadius: 16.5,
    borderWidth: 1.6,
    borderColor: '#F2C31B',
    position: 'absolute',
    left: 25,
    top: 3,
    zIndex: 1,
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
    marginRight: 4,
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
    marginTop: 50,
    marginBottom: 24,
  },
  avatarIcon: {
    width: 97,
    height: 97,
    borderRadius: 48.5,
    backgroundColor: 'rgba(255, 199, 0, 0.13)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  // Center person (main)
  personCenter: {
    alignItems: 'center',
    position: 'absolute',
    zIndex: 3,
  },
  personCenterHead: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#000000',
    marginBottom: 2,
  },
  personCenterBody: {
    width: 32,
    height: 18,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#000000',
  },
  // Side people
  personLeft: {
    alignItems: 'center',
    position: 'absolute',
    left: 14,
    top: 26,
    zIndex: 2,
  },
  personRight: {
    alignItems: 'center',
    position: 'absolute',
    right: 14,
    top: 26,
    zIndex: 2,
  },
  personSideHead: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#000000',
    opacity: 0.4,
    marginBottom: 1,
  },
  personSideBody: {
    width: 20,
    height: 12,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: '#000000',
    opacity: 0.4,
  },
  mainTitle: {
    fontSize: 23,
    fontWeight: '700',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    textAlign: 'center',
    marginBottom: 7,
    letterSpacing: -0.2,
    lineHeight: 29,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 18,
    letterSpacing: -0.2,
    lineHeight: 24,
    paddingHorizontal: 40,
  },
  inputContainer: {
    marginBottom: 11,
  },
  inputBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D5D5D5',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    opacity: 0.4,
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
  joinButton: {
    backgroundColor: '#000000',
    borderRadius: 100,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  joinButtonText: {
    fontSize: 22,
    fontWeight: 'bold',
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
    opacity: 0.1,
  },
  orText: {
    fontSize: 13,
    fontWeight: '300',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    marginHorizontal: 8,
    textTransform: 'uppercase',
  },
  individualLinkButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  individualLinkText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textDecorationLine: 'underline',
    letterSpacing: 0.3,
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
  modalTitleBottomSheet: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    flex: 1,
    textAlign: 'center',
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
  languageFlagImages: {
    width: 40,
    height: 40,
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
});
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  ScrollView,
  Modal as RNModal,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';

const { width } = Dimensions.get('window');

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

export default function LabelLanguageSetupScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { labelLanguage, updateLabelLanguage, showLabels, toggleLabels, shouldShowWatermark } = useSettings();
  const [selectedLanguage, setSelectedLanguage] = useState(labelLanguage);
  const [labelLanguageModalVisible, setLabelLanguageModalVisible] = useState(false);
  const labelLanguageScrollViewRef = useRef(null);
  const labelLanguageLayouts = useRef({});
  const insets = useSafeAreaInsets();

  // Update local state when labelLanguage changes
  useEffect(() => {
    setSelectedLanguage(labelLanguage);
  }, [labelLanguage]);

  // Scroll to selected language when modal opens
  useEffect(() => {
    if (labelLanguageModalVisible && labelLanguageScrollViewRef.current) {
      const currentLanguageCode = selectedLanguage;
      const yOffset = labelLanguageLayouts.current[currentLanguageCode];
      if (yOffset !== undefined) {
        setTimeout(() => {
          labelLanguageScrollViewRef.current?.scrollTo({ y: yOffset, animated: false });
        }, 100);
      }
    }
  }, [labelLanguageModalVisible, selectedLanguage]);

  const getLabelLanguage = () => {
    return LANGUAGES.find((lang) => lang.code === labelLanguage) || LANGUAGES[0];
  };

  const handleLanguageSelect = (languageCode) => {
    setSelectedLanguage(languageCode);
    updateLabelLanguage(languageCode);
    setLabelLanguageModalVisible(false);
  };

  const handleContinue = () => {
    navigation.navigate('SectionLanguageSetup');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  // Dummy photo URI - using a placeholder color as background
  const screenHeight = Dimensions.get('window').height;
  const availableHeight = screenHeight - insets.top - insets.bottom - 100; // Reserve space for header and buttons
  const dummyPhotoWidth = width - 40;
  const dummyPhotoHeight = Math.min((dummyPhotoWidth * 3) / 4, availableHeight * 0.35); // Limit photo height

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 10, left: insets.left + 10 }]}
        onPress={handleGoBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>{t('labelLanguageSetup.title')}</Text>

        {/* Dummy Photo Preview */}
        <View style={styles.photoContainer}>
          <View
            style={[
              styles.dummyPhoto,
              {
                width: dummyPhotoWidth,
                height: dummyPhotoHeight,
              },
            ]}
          >
            {/* Dummy photo background - gradient-like effect */}
            <View style={styles.dummyPhotoBackground}>
              <View style={styles.dummyPhotoTopHalf} />
              <View style={styles.dummyPhotoBottomHalf} />
            </View>

            {/* Before Label */}
            {showLabels && (
              <View style={styles.beforeLabelContainer}>
                <PhotoLabel
                  label="common.before"
                  position="left-top"
                  size="medium"
                />
              </View>
            )}

            {/* After Label */}
            {showLabels && (
              <View style={styles.afterLabelContainer}>
                <PhotoLabel
                  label="common.after"
                  position="left-bottom"
                  size="medium"
                />
              </View>
            )}

            {/* Watermark */}
            {shouldShowWatermark && <PhotoWatermark />}
          </View>
          <Text style={styles.photoDescription}>{t('labelLanguageSetup.previewDescription')}</Text>
          
          {/* Label Removal Switch */}
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>{t('settings.showLabels')}</Text>
              <Text style={styles.settingDescription}>
                {t('settings.showLabelsDescription')}
              </Text>
            </View>
            <Switch
              value={showLabels}
              onValueChange={toggleLabels}
              trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
              thumbColor="white"
            />
          </View>
        </View>

        {/* Language Selection Dropdown */}
        <View style={styles.languageSection}>
          <Text style={styles.sectionTitle}>{t('settings.labelLanguage')}</Text>
          <TouchableOpacity
            style={styles.languageSelectorButton}
            onPress={() => setLabelLanguageModalVisible(true)}
          >
            <View style={styles.languageSelector}>
              <Text style={styles.languageFlag}>{getLabelLanguage().flag}</Text>
              <Text style={styles.languageName}>{getLabelLanguage().name}</Text>
              <Text style={styles.languageChangeText}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Customize Button */}
        <TouchableOpacity
          style={styles.customizeButton}
          onPress={() => {
            navigation.navigate('LabelCustomization');
          }}
        >
          <Text style={styles.customizeButtonText}>{t('settings.customize')}</Text>
        </TouchableOpacity>

        {/* Continue Button */}
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
        >
          <Text style={styles.continueButtonText}>{t('common.continue')}</Text>
        </TouchableOpacity>
      </View>

      {/* Label Language Modal */}
      <RNModal
        visible={labelLanguageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLabelLanguageModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('settings.labelLanguage')}</Text>
            <ScrollView
              ref={labelLanguageScrollViewRef}
              style={styles.languageScrollView}
              showsVerticalScrollIndicator={true}
            >
              {LANGUAGES.map((language) => (
                <TouchableOpacity
                  key={language.code}
                  onLayout={(event) => {
                    const layout = event.nativeEvent.layout;
                    labelLanguageLayouts.current[language.code] = layout.y;
                  }}
                  style={[
                    styles.languageOption,
                    selectedLanguage === language.code && styles.languageOptionActive,
                  ]}
                  onPress={() => handleLanguageSelect(language.code)}
                >
                  <Text style={styles.languageFlag}>{language.flag}</Text>
                  <Text
                    style={[
                      styles.languageOptionText,
                      selectedLanguage === language.code && styles.languageOptionTextActive,
                    ]}
                  >
                    {language.name}
                  </Text>
                  {selectedLanguage === language.code && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setLabelLanguageModalVisible(false)}
            >
              <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    zIndex: 10,
    padding: 10,
  },
  backButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    paddingBottom: 20,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: FONTS.ALEXANDRIA,
  },
  photoContainer: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  dummyPhoto: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  dummyPhotoBackground: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  dummyPhotoTopHalf: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#E8E8E8',
  },
  dummyPhotoBottomHalf: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#D0D0D0',
  },
  beforeLabelContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  afterLabelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  photoDescription: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    marginTop: 16,
  },
  settingInfo: {
    flex: 1,
    paddingRight: 16,
  },
  settingLabel: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  settingDescription: {
    color: COLORS.GRAY,
    fontSize: 12,
  },
  languageSection: {
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 12,
    fontFamily: FONTS.ALEXANDRIA,
  },
  languageSelectorButton: {
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    padding: 16,
  },
  languageSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  languageFlag: {
    fontSize: 20,
  },
  languageName: {
    flex: 1,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  languageChangeText: {
    fontSize: 20,
    color: COLORS.TEXT,
  },
  languageScrollView: {
    maxHeight: 300,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 8,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: '#FFFFFF',
  },
  languageOptionActive: {
    backgroundColor: COLORS.PRIMARY,
  },
  languageOptionText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  languageOptionTextActive: {
    color: '#000000',
    fontWeight: 'bold',
  },
  checkmark: {
    fontSize: 20,
    color: '#000000',
    fontWeight: 'bold',
  },
  // Refresh: secondary "Customize" = dark per design `.pp-btn--dark`,
  // height 52, radius 16, no shadow (secondaries stay flatter).
  customizeButton: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  customizeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    letterSpacing: -0.1,
  },
  // Primary Continue = yellow per `.pp-btn--primary` with warm pop-shadow.
  continueButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E1E1E',
    fontFamily: FONTS.ALEXANDRIA,
    letterSpacing: -0.1,
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
    width: '85%',
    maxWidth: 400,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 20,
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
  },
  closeModalButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  closeModalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
});


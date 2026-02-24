import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  Modal as RNModal,
  Switch,
  PanResponder,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import RoomEditor from '../components/RoomEditor';

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

export default function SectionLanguageSetupScreen({ navigation, route }) {
  const { t } = useTranslation();
  const {
    sectionLanguage,
    updateSectionLanguage,
    cleaningServiceEnabled,
    toggleCleaningServiceEnabled,
    getRooms,
    customRooms,
  } = useSettings();
  const [selectedLanguage, setSelectedLanguage] = useState(sectionLanguage);
  const [sectionLanguageModalVisible, setSectionLanguageModalVisible] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const sectionLanguageScrollViewRef = useRef(null);
  const sectionLanguageLayouts = useRef({});
  const insets = useSafeAreaInsets();

  // Get rooms and manage current room for carousel
  const [rooms, setRooms] = useState(() => getRooms());
  const [currentRoom, setCurrentRoom] = useState(rooms.length > 0 ? rooms[0].id : null);

  useEffect(() => {
    const newRooms = getRooms();
    setRooms(newRooms);
    if (!currentRoom || !newRooms.some(r => r.id === currentRoom)) {
      setCurrentRoom(newRooms.length > 0 ? newRooms[0].id : null);
    }
  }, [customRooms, cleaningServiceEnabled]);

  // Get circular room order with current room in center
  const getCircularRooms = () => {
    if (!currentRoom) return [];
    const currentIndex = rooms.findIndex(r => r.id === currentRoom);
    if (currentIndex === -1) return [];

    const result = [];
    
    // Show 3 items before, current, and 3 items after (total 7 visible)
    for (let i = -3; i <= 3; i++) {
      let index = (currentIndex + i + rooms.length) % rooms.length;
      result.push({ ...rooms[index], offset: i });
    }
    
    return result;
  };

  const circularRooms = getCircularRooms();

  // Keep a ref of the current room so the pan responder always has fresh state
  const currentRoomRef = useRef(currentRoom);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Horizontal swipe between rooms
  const roomPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderRelease: (evt, gestureState) => {
          const swipeThreshold = 20;

          if (!rooms || rooms.length === 0) return;

          const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
          if (currentIndex === -1) return;

          if (gestureState.dx > swipeThreshold) {
            // Swipe right -> previous room
            const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
            setCurrentRoom(rooms[newIndex].id);
          } else if (gestureState.dx < -swipeThreshold) {
            // Swipe left -> next room
            const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
            setCurrentRoom(rooms[newIndex].id);
          }
        },
      }),
    [rooms]
  );

  // Update local state when sectionLanguage changes
  useEffect(() => {
    setSelectedLanguage(sectionLanguage);
  }, [sectionLanguage]);

  // Scroll to selected language when modal opens
  useEffect(() => {
    if (sectionLanguageModalVisible && sectionLanguageScrollViewRef.current) {
      const currentLanguageCode = selectedLanguage;
      const yOffset = sectionLanguageLayouts.current[currentLanguageCode];
      if (yOffset !== undefined) {
        setTimeout(() => {
          sectionLanguageScrollViewRef.current?.scrollTo({ y: yOffset, animated: false });
        }, 100);
      }
    }
  }, [sectionLanguageModalVisible, selectedLanguage]);

  const getSectionLanguage = () => {
    return LANGUAGES.find((lang) => lang.code === sectionLanguage) || LANGUAGES[0];
  };

  const handleLanguageSelect = (languageCode) => {
    setSelectedLanguage(languageCode);
    updateSectionLanguage(languageCode);
    setSectionLanguageModalVisible(false);
  };

  const handleContinue = async () => {
    // Process referral reward if user signed up via referral
    try {
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      const { getAcceptedReferral, completeReferralSetup } = await import('../services/referralService');

      const acceptedReferral = await getAcceptedReferral();
      if (acceptedReferral && acceptedReferral.code) {
        // Get user ID (device-based for now)
        let userId = await AsyncStorage.getItem('@user_id');
        if (!userId) {
          // Generate a user ID if not exists
          const deviceId = await AsyncStorage.getItem('@device_id');
          userId = deviceId ? `user_${deviceId}` : `user_${Date.now()}`;
          await AsyncStorage.setItem('@user_id', userId);
        }

        // Complete referral setup on server
        const result = await completeReferralSetup(acceptedReferral.code, userId);
        if (result && result.success) {
          console.log('[SectionLanguageSetup] Referral completed on server!');
          console.log('[SectionLanguageSetup] Referrer earned:', result.monthsEarned, 'month(s)');
        } else {
          console.log('[SectionLanguageSetup] Referral completion failed or already processed');
        }
      }
    } catch (error) {
      console.error('[SectionLanguageSetup] Error processing referral:', error);
    }
    navigation.replace('Home');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 10, left: insets.left + 10 }]}
        onPress={handleGoBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Text style={styles.title}>{t('sectionLanguageSetup.title')}</Text>

        {/* Industry Template Section */}
        <View style={styles.switchSection}>
          <Text style={styles.industryTemplateLabel}>{t('sectionLanguageSetup.industryTemplate')}</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>{t('settings.cleaningService')}</Text>
            </View>
            <Switch
              value={cleaningServiceEnabled}
              onValueChange={toggleCleaningServiceEnabled}
              trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
              thumbColor="white"
            />
          </View>
        </View>

        {/* Section Carousel Preview */}
        <View style={styles.carouselContainer}>
          <Text style={styles.carouselTitle}>{t('sectionLanguageSetup.previewDescription')}</Text>
          <View style={styles.roomTabsContainer} {...roomPanResponder.panHandlers}>
            {circularRooms.map((room, index) => {
              const isActive = room.offset === 0; // Center item is active
              const distance = Math.abs(room.offset);
              const scale = isActive ? 1 : Math.max(0.65, 1 - (distance * 0.15));
              const opacity = isActive ? 1 : Math.max(0.4, 1 - (distance * 0.2));
              
              return (
                <TouchableOpacity
                  key={`${room.id}-${index}`}
                  style={[
                    styles.roomTab,
                    isActive && styles.roomTabActive,
                    {
                      transform: [{ scale }],
                      opacity
                    }
                  ]}
                  onPress={() => setCurrentRoom(room.id)}
                >
                  <Text style={[styles.roomIcon, { fontSize: isActive ? 24 : 20 }]}>
                    {room.icon}
                  </Text>
                  {isActive && (
                    <Text
                      style={[
                        styles.roomTabText,
                        styles.roomTabTextActive
                      ]}
                    >
                      {cleaningServiceEnabled
                        ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                        : `${t('settings.section', { lng: sectionLanguage })} ${rooms.findIndex(r => r.id === room.id) + 1}`}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section Language Selection Dropdown */}
        <View style={styles.languageSection}>
          <Text style={styles.sectionTitle}>{t('settings.sectionLanguage')}</Text>
          <TouchableOpacity
            style={styles.languageSelectorButton}
            onPress={() => setSectionLanguageModalVisible(true)}
          >
            <View style={styles.languageSelector}>
              <Text style={styles.languageFlag}>{getSectionLanguage().flag}</Text>
              <Text style={styles.languageName}>{getSectionLanguage().name}</Text>
              <Text style={styles.languageChangeText}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Section Line (Divider) */}
        <View style={styles.sectionLine} />

        {/* Customize Button */}
        <TouchableOpacity
          style={styles.customizeButton}
          onPress={() => {
            setShowRoomEditor(true);
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

      {/* Section Language Modal */}
      <RNModal
        visible={sectionLanguageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSectionLanguageModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('settings.sectionLanguage')}</Text>
            <ScrollView
              ref={sectionLanguageScrollViewRef}
              style={styles.languageScrollView}
              showsVerticalScrollIndicator={true}
            >
              {LANGUAGES.map((language) => (
                <TouchableOpacity
                  key={language.code}
                  onLayout={(event) => {
                    const layout = event.nativeEvent.layout;
                    sectionLanguageLayouts.current[language.code] = layout.y;
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
              onPress={() => setSectionLanguageModalVisible(false)}
            >
              <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>

      {/* Room Editor Modal */}
      <RoomEditor
        visible={showRoomEditor}
        onClose={() => setShowRoomEditor(false)}
      />
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
  carouselContainer: {
    marginTop: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  carouselTitle: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  roomTabsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    maxHeight: 80,
    width: '100%',
  },
  roomTab: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginHorizontal: 3,
    borderRadius: 12,
    backgroundColor: 'white',
    minWidth: 55,
    minHeight: 55,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  roomTabActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  roomIcon: {
    fontSize: 20,
    marginBottom: 2,
  },
  roomTabText: {
    fontSize: 12,
    color: COLORS.GRAY,
  },
  roomTabTextActive: {
    color: COLORS.TEXT,
    fontWeight: '600',
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
  sectionLine: {
    height: 1,
    backgroundColor: COLORS.BORDER,
    marginVertical: 4,
  },
  switchSection: {
    marginBottom: 8,
  },
  industryTemplateLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 12,
    fontFamily: FONTS.ALEXANDRIA,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  switchInfo: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.TEXT,
    fontFamily: FONTS.ALEXANDRIA,
  },
  customizeButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  customizeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
  },
  continueButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  continueButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: FONTS.ALEXANDRIA,
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


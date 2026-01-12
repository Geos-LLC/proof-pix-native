import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';

export default function UserInfoSetupScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { updateUserInfo, updateLabelLanguage, updateSectionLanguage } = useSettings();
  const insets = useSafeAreaInsets();
  
  const [userName, setUserName] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [locationFocused, setLocationFocused] = useState(false);
  const scrollViewRef = useRef(null);
  const locationInputRef = useRef(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const validateForm = () => {
    if (!userName.trim()) {
      Alert.alert(
        t('userInfo.nameRequired', { defaultValue: 'Name Required' }),
        t('userInfo.nameRequiredMessage', { defaultValue: 'Please enter your name to continue.' })
      );
      return false;
    }
    return true;
  };

  const handleContinue = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // Save user info (name)
      await updateUserInfo(userName.trim());
      
      // Save location if provided (location is stored in settings)
      if (location.trim()) {
        const settings = await AsyncStorage.getItem('app-settings');
        const parsedSettings = settings ? JSON.parse(settings) : {};
        await AsyncStorage.setItem('app-settings', JSON.stringify({
          ...parsedSettings,
          location: location.trim(),
          userName: userName.trim() // Ensure name is also saved
        }));
      }

      // Apply current language to labels and sections
      const currentLang = i18n.language || 'en';
      updateLabelLanguage(currentLang);
      updateSectionLanguage(currentLang);

      // Navigate to permissions screen
      navigation.navigate('PermissionsSetup');
    } catch (error) {
      console.error('[UserInfoSetup] Error saving user info:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('userInfo.saveError', { defaultValue: 'Failed to save information. Please try again.' })
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

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
          {/* Back Button */}
          <TouchableOpacity
            style={[styles.backButton, { top: insets.top + 10 }]}
            onPress={handleBack}
            activeOpacity={0.7}
          >
            <View style={styles.backButtonContainer}>
              <Ionicons name="arrow-back" size={24} color={COLORS.PRIMARY} />
            </View>
          </TouchableOpacity>

          {/* Header */}
          <Animated.View 
            style={[
              styles.header,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={styles.headerIconContainer}>
              <Ionicons name="person-circle-outline" size={48} color={COLORS.PRIMARY} />
            </View>
            <Text style={styles.title}>
              {t('userInfo.title', { defaultValue: 'Tell Us About Yourself' })}
            </Text>
            <Text style={styles.subtitle}>
              {t('userInfo.subtitle', { defaultValue: 'This information helps us personalize your experience' })}
            </Text>
          </Animated.View>

          {/* Form */}
          <Animated.View 
            style={[
              styles.formContainer,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            {/* Name Input */}
            <View style={styles.inputGroup}>
              <View style={styles.inputLabelContainer}>
                <Ionicons name="person-outline" size={18} color={COLORS.TEXT} style={styles.labelIcon} />
                <Text style={styles.inputLabel}>
                  {t('userInfo.nameLabel', { defaultValue: 'Your Name' })}
                  <Text style={styles.required}> *</Text>
                </Text>
              </View>
              <View style={[
                styles.inputWrapper,
                nameFocused && styles.inputWrapperFocused,
                userName.trim() && styles.inputWrapperFilled,
              ]}>
                <TextInput
                  style={styles.textInput}
                  value={userName}
                  onChangeText={setUserName}
                  placeholder={t('userInfo.namePlaceholder', { defaultValue: 'Enter your name' })}
                  placeholderTextColor="#999"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  onSubmitEditing={() => locationInputRef.current?.focus()}
                />
                {userName.trim() && (
                  <Ionicons name="checkmark-circle" size={20} color="#34C759" style={styles.inputCheckIcon} />
                )}
              </View>
            </View>

            {/* Location Input */}
            <View style={styles.inputGroup}>
              <View style={styles.inputLabelContainer}>
                <Ionicons name="location-outline" size={18} color={COLORS.TEXT} style={styles.labelIcon} />
                <Text style={styles.inputLabel}>
                  {t('userInfo.locationLabel', { defaultValue: 'Location (Optional)' })}
                </Text>
              </View>
              <View style={[
                styles.inputWrapper,
                locationFocused && styles.inputWrapperFocused,
                location.trim() && styles.inputWrapperFilled,
              ]}>
                <TextInput
                  ref={locationInputRef}
                  style={styles.textInput}
                  value={location}
                  onChangeText={setLocation}
                  placeholder={t('userInfo.locationPlaceholder', { defaultValue: 'City, State (e.g., Tampa, FL)' })}
                  placeholderTextColor="#999"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  onFocus={() => setLocationFocused(true)}
                  onBlur={() => setLocationFocused(false)}
                  onSubmitEditing={handleContinue}
                />
                {location.trim() && (
                  <Ionicons name="checkmark-circle" size={20} color="#34C759" style={styles.inputCheckIcon} />
                )}
              </View>
              <Text style={styles.inputHint}>
                {t('userInfo.locationHint', { defaultValue: 'This will be included in folder names for better organization' })}
              </Text>
            </View>
          </Animated.View>

          {/* Continue Button */}
          <Animated.View
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            }}
          >
            <TouchableOpacity
              style={[
                styles.continueButton,
                (isSubmitting || !userName.trim()) && styles.continueButtonDisabled
              ]}
              onPress={handleContinue}
              disabled={isSubmitting || !userName.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.continueButtonText}>
                {t('common.continue', { defaultValue: 'Continue' })}
              </Text>
              <Ionicons name="arrow-forward" size={20} color="#000" style={styles.buttonIcon} />
            </TouchableOpacity>
          </Animated.View>
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
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 30,
    paddingTop: 20,
    paddingBottom: 30,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
  },
  backButtonContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '20',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    marginTop: 60,
    marginBottom: 40,
    alignItems: 'center',
  },
  headerIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: COLORS.PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '30',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    fontFamily: FONTS.QUICKSAND_REGULAR,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  formContainer: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  labelIcon: {
    marginRight: 8,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
  },
  required: {
    color: '#FF3B30',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  inputWrapperFocused: {
    borderColor: COLORS.PRIMARY,
    shadowColor: COLORS.PRIMARY,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  inputWrapperFilled: {
    borderColor: COLORS.PRIMARY + '60',
  },
  textInput: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_REGULAR,
  },
  inputCheckIcon: {
    marginLeft: 8,
  },
  inputHint: {
    fontSize: 13,
    color: '#999999',
    marginTop: 8,
    fontFamily: FONTS.QUICKSAND_REGULAR,
    lineHeight: 18,
    paddingLeft: 26,
  },
  continueButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    elevation: 6,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    borderWidth: 2,
    borderColor: '#00000010',
  },
  continueButtonDisabled: {
    backgroundColor: '#E0E0E0',
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000000',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 10,
  },
});


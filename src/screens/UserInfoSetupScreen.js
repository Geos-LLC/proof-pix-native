import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';

export default function UserInfoSetupScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const { updateUserInfo, updateLabelLanguage, updateSectionLanguage } = useSettings();

  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Save name to settings
    await updateUserInfo(trimmed);

    // Keep existing language behaviour from the old screen
    const currentLang = i18n.language || 'en';
    updateLabelLanguage(currentLang);
    updateSectionLanguage(currentLang);

    navigation.navigate('PermissionsSetup');
  };

  const handleInvitedToTeam = () => {
    navigation.navigate('JoinTeam');
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Status / header row */}
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.backTouch} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color="#000" />
            </TouchableOpacity>

            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>9:41</Text>
            </View>
          </View>

          {/* Brand row */}
          <View style={styles.brandRow}>
            <View style={styles.logoRow}>
              <View style={styles.logoCircleOuter}>
                <View style={styles.logoArrow} />
              </View>
              <Text style={styles.logoText}>ProofPix</Text>
            </View>

            <View style={styles.languageChip}>
              <Text style={styles.languageText}>EN</Text>
            </View>
          </View>

          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <View style={styles.avatarBackground} />
            <View style={styles.avatarIcon} />
          </View>

          {/* Main content */}
          <View style={styles.content}>
            <Text style={styles.title}>
              {t('userInfo.letsStartWithName', { defaultValue: 'Let’s start with your name' })}
            </Text>

            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <Text style={styles.inputLabel}>
                  {t('userInfo.nameLabel', { defaultValue: 'Your Name' })}
                </Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  placeholder={nameFocused ? '' : t('userInfo.namePlaceholder', { defaultValue: 'Alex Bond' })}
                  placeholderTextColor="rgba(0,0,0,0.35)"
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleContinue}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, !name.trim() && styles.primaryButtonDisabled]}
                disabled={!name.trim()}
                onPress={handleContinue}
              >
                <Text style={styles.primaryButtonText}>
                  {t('userInfo.saveAndContinue', { defaultValue: 'Save & Continue' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* OR separator */}
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View>

            {/* Invited to team */}
            <TouchableOpacity onPress={handleInvitedToTeam}>
              <Text style={styles.invitedText}>
                {t('userInfo.invitedToTeam', { defaultValue: 'I was invited to a team' })}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const YELLOW = '#F2C31B';

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: '#F6F8FA',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },

  /* Top row (back + time) */
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  backTouch: {
    padding: 4,
  },
  timeContainer: {
    flex: 1,
    alignItems: 'center',
  },
  timeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: '#1E1E1E',
  },

  /* Brand row */
  brandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoCircleOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.6,
    borderColor: YELLOW,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  logoArrow: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: YELLOW,
  },
  logoText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.1,
    color: '#000',
  },

  languageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 62,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECECEC',
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  languageText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },

  /* Avatar */
  avatarContainer: {
    alignItems: 'center',
    marginTop: 32,
  },
  avatarBackground: {
    width: 97,
    height: 97,
    borderRadius: 48.5,
    backgroundColor: 'rgba(255,199,0,0.13)',
  },
  avatarIcon: {
    position: 'absolute',
    width: 63,
    height: 63,
    borderRadius: 31.5,
    backgroundColor: '#000',
    opacity: 0.8,
    top: 17,
  },

  /* Main content */
  content: {
    marginTop: 40,
    alignItems: 'center',
  },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    width: 260,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 29,
    letterSpacing: -0.2,
    color: '#000',
    marginBottom: 24,
  },

  inputGroup: {
    width: '100%',
    alignItems: 'center',
  },
  inputWrapper: {
    width: 335,
    maxWidth: '100%',
    height: 54,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#D5D5D5',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginBottom: 16,
  },
  inputLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    color: 'rgba(0,0,0,0.65)',
    marginBottom: 2,
  },
  input: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    color: '#000',
  },

  primaryButton: {
    width: 335,
    maxWidth: '100%',
    height: 54,
    borderRadius: 100,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 8,
  },
  orLine: {
    width: 60,
    height: 0,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.2)',
  },
  orText: {
    fontFamily: FONTS.ALEXANDRIA,
    marginHorizontal: 8,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#000',
  },

  invitedText: {
    fontFamily: FONTS.ALEXANDRIA,
    marginTop: 4,
    fontSize: 18,
    fontWeight: '500',
    textDecorationLine: 'underline',
    color: '#000',
    textAlign: 'center',
  },
});


import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { logEvent, setUserProperties } from '../utils/analytics';

const QUALIFICATION_KEY = '@user_qualification';

const USER_TYPES = [
  { id: 'cleaning', icon: 'sparkles-outline', labelKey: 'qualification.cleaning', defaultLabel: 'Cleaning' },
  { id: 'contracting', icon: 'construct-outline', labelKey: 'qualification.contracting', defaultLabel: 'Contracting' },
  { id: 'restoration', icon: 'hammer-outline', labelKey: 'qualification.restoration', defaultLabel: 'Restoration' },
  { id: 'editing', icon: 'color-palette-outline', labelKey: 'qualification.editing', defaultLabel: 'Editing / Content' },
  { id: 'personal', icon: 'person-outline', labelKey: 'qualification.personal', defaultLabel: 'Personal Use' },
  { id: 'other', icon: 'ellipsis-horizontal-outline', labelKey: 'qualification.other', defaultLabel: 'Other' },
];

export const hasCompletedQualification = async () => {
  try {
    const val = await AsyncStorage.getItem(QUALIFICATION_KEY);
    return val !== null;
  } catch {
    return false;
  }
};

export const getStoredUserType = async () => {
  try {
    return await AsyncStorage.getItem(QUALIFICATION_KEY);
  } catch {
    return null;
  }
};

export default function QualificationPromptModal({ visible, onClose }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null);

  const handleSelect = async (userType) => {
    setSelected(userType);
    logEvent('qualification_option_selected', { user_type: userType });

    // Brief visual feedback before closing
    setTimeout(async () => {
      await AsyncStorage.setItem(QUALIFICATION_KEY, userType);
      setUserProperties({ user_type: userType });
      logEvent('qualification_completed', { user_type: userType });
      onClose();
    }, 300);
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(QUALIFICATION_KEY, 'skipped');
    logEvent('qualification_skipped');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleSkip}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {t('qualification.title', { defaultValue: 'What do you use ProofPix for?' })}
          </Text>

          <View style={styles.options}>
            {USER_TYPES.map((type) => (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.option,
                  selected === type.id && styles.optionSelected,
                ]}
                onPress={() => handleSelect(type.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={type.icon}
                  size={22}
                  color={selected === type.id ? '#000' : '#ccc'}
                />
                <Text style={[
                  styles.optionText,
                  selected === type.id && styles.optionTextSelected,
                ]}>
                  {t(type.labelKey, { defaultValue: type.defaultLabel })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipText}>
              {t('common.skip', { defaultValue: 'Skip' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: FONTS.BOLD,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#333',
    backgroundColor: '#111',
    minWidth: '45%',
  },
  optionSelected: {
    borderColor: COLORS.PRIMARY,
    backgroundColor: COLORS.PRIMARY,
  },
  optionText: {
    fontSize: 14,
    color: '#ccc',
    fontWeight: '600',
    fontFamily: FONTS.SEMIBOLD,
  },
  optionTextSelected: {
    color: '#000',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 14,
    color: '#666',
    fontFamily: FONTS.MEDIUM,
  },
});

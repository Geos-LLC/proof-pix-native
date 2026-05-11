import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import { useSettings } from '../context/SettingsContext';
import { logEvent, setUserProperties } from '../utils/analytics';

const QUALIFICATION_KEY = '@user_qualification';

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

export default function QualificationPromptModal({ visible, onClose, mandatory = false }) {
  const { t } = useTranslation();
  const { saveCustomRooms } = useSettings();
  const [selected, setSelected] = useState(null);

  const handleSelect = async (userType) => {
    setSelected(userType);
    logEvent('qualification_option_selected', { user_type: userType });

    // Apply the industry's folder seed list. The user can still edit them
    // via Settings → Folders afterward. We persist user_type AND folders
    // before closing so they survive an app restart mid-onboarding.
    const industry = getIndustryById(userType);
    try {
      if (industry?.folders?.length) {
        await saveCustomRooms(industry.folders);
      }
    } catch (e) {
      // Saving folders failing is non-fatal — user can still pick rooms manually.
    }

    setTimeout(async () => {
      await AsyncStorage.setItem(QUALIFICATION_KEY, userType);
      setUserProperties({ user_type: userType });
      logEvent('qualification_answered', { user_type: userType });
      onClose();
    }, 250);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // In mandatory (onboarding) mode the hardware-back must NOT dismiss —
      // the user has to pick an industry. In non-mandatory (Settings re-pick)
      // mode it closes cleanly.
      onRequestClose={() => { if (!mandatory) onClose(); }}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {!mandatory && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <Text style={styles.title}>
            {t('qualification.title', { defaultValue: 'What do you use ProofPix for?' })}
          </Text>
          <Text style={styles.subtitle}>
            {t('qualification.subtitle', {
              defaultValue: 'Pick the closest match — we\'ll set up your folders. You can edit them anytime in Settings.',
            })}
          </Text>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.options}
            showsVerticalScrollIndicator={false}
          >
            {INDUSTRIES.map((industry) => {
              const isSelected = selected === industry.id;
              return (
                <TouchableOpacity
                  key={industry.id}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => handleSelect(industry.id)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={industry.icon}
                    size={20}
                    color={isSelected ? '#000' : COLORS.PRIMARY}
                  />
                  <Text style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                  ]}>
                    {t(industry.labelKey, { defaultValue: industry.defaultLabel })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  // Yellow + black, paywall-style — bright yellow header backing on black
  // sheet so the sheet looks branded rather than the previous flat-dark slab.
  sheet: {
    backgroundColor: '#000',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 4,
    borderTopColor: COLORS.PRIMARY,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.PRIMARY,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: FONTS.BOLD,
  },
  subtitle: {
    fontSize: 13,
    color: '#bbb',
    textAlign: 'center',
    marginBottom: 18,
    paddingHorizontal: 8,
    lineHeight: 18,
    fontFamily: FONTS.REGULAR,
  },
  scrollArea: {
    maxHeight: 480,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    paddingBottom: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
    minWidth: '47%',
    flexShrink: 1,
  },
  optionSelected: {
    borderColor: COLORS.PRIMARY,
    backgroundColor: COLORS.PRIMARY,
  },
  optionText: {
    fontSize: 13,
    color: '#eee',
    fontWeight: '600',
    fontFamily: FONTS.SEMIBOLD,
    flexShrink: 1,
  },
  optionTextSelected: {
    color: '#000',
  },
});

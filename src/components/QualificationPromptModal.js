import React, { useState, useMemo } from 'react';
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
import { FONTS } from '../constants/fonts';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import { useSettings } from '../context/SettingsContext';
import { logEvent, setUserProperties } from '../utils/analytics';
import { useTheme } from '../hooks/useTheme';

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

// Refresh pass 8 — re-skinned to match design screenshot 05-industry:
//
//   STEP 2 OF 2                                ← eyebrow
//   What do you do?                            ← bold left-aligned headline
//   We'll set up the right rooms & labels…     ← subhead
//
//   ┌────────────┐  ┌────────────┐
//   │ [💧] (sel) │  │ [✏️]      │
//   │  Cleaning  │  │ Contractors│   ← 2-column grid of cards
//   └────────────┘  └────────────┘     selected = yellow border + soft
//   ┌────────────┐  ┌────────────┐     yellow fill, others = white +
//   │ [📍]       │  │ [✨]      │      hairline border. Each card has a
//   │ Real Estate│  │ Landscaping│     small icon tile (radius 12) +
//   └────────────┘  └────────────┘     label below.
//
//   [        Continue        ]         ← yellow primary CTA at bottom
//
// Kept as a bottom-anchored Modal so the existing onboarding flow
// (mandatory: tap-out disabled) keeps working as a slide-up sheet.
// Selection is now a 2-step interaction: tap a card to highlight, then
// Continue persists + dismisses. Matches the design's flow and lets
// the user change their mind before committing.

export default function QualificationPromptModal({ visible, onClose, mandatory = false }) {
  const { t } = useTranslation();
  const { saveCustomRooms } = useSettings();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  // The original handleSelect was a "pick + save + close" combo. With
  // the design's Continue button it splits cleanly: tapping a card just
  // updates local state, and Continue runs the persistence + analytics
  // payload below.
  const handleContinue = async () => {
    if (!selected || saving) return;
    setSaving(true);

    const userType = selected;

    // Build a richer payload now that there are 18 industries. Keeping
    // `user_type` for continuity with v1.5.21–v1.5.24 events, then layering:
    //   industry_id       — same value, modern name
    //   industry_label    — human-readable for cleaner reports
    //   folder_count      — how many folders the preset seeded
    //   context           — 'onboarding' (mandatory) vs 'settings_repick'
    const industry = getIndustryById(userType);
    const industryLabel = industry?.defaultLabel || userType;
    const folderCount = industry?.folders?.length || 0;
    const context = mandatory ? 'onboarding' : 'settings_repick';

    let previousType = null;
    try { previousType = await AsyncStorage.getItem(QUALIFICATION_KEY); } catch {}

    const payload = {
      user_type: userType,
      industry_id: userType,
      industry_label: industryLabel,
      folder_count: folderCount,
      context,
      previous_industry: previousType && previousType !== userType ? previousType : null,
    };

    logEvent('qualification_option_selected', payload);

    try {
      if (industry?.folders?.length) {
        await saveCustomRooms(industry.folders);
      }
    } catch (e) {
      // Non-fatal — user can pick rooms manually.
    }

    try {
      await AsyncStorage.setItem(QUALIFICATION_KEY, userType);
      setUserProperties({
        user_type: userType,
        industry_id: userType,
        industry_label: industryLabel,
      });
      logEvent('qualification_answered', payload);
      if (context === 'settings_repick' && previousType && previousType !== userType) {
        logEvent('industry_changed', {
          from_industry: previousType,
          to_industry: userType,
          to_industry_label: industryLabel,
        });
      }
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => { if (!mandatory) onClose(); }}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          {!mandatory && (
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color="#1E1E1E" />
            </TouchableOpacity>
          )}

          <Text style={styles.eyebrow}>
            {t('qualification.step', { defaultValue: 'STEP 2 OF 2' })}
          </Text>
          <Text style={styles.headline}>
            {t('qualification.headline', { defaultValue: 'What do you do?' })}
          </Text>
          <Text style={styles.subhead}>
            {t('qualification.subhead', {
              defaultValue: "We'll set up the right rooms & labels for your trade. Change it anytime.",
            })}
          </Text>

          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {INDUSTRIES.map((industry) => {
              const isSelected = selected === industry.id;
              return (
                <TouchableOpacity
                  key={industry.id}
                  style={[styles.card, isSelected && styles.cardSelected]}
                  onPress={() => setSelected(industry.id)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.cardIcon, isSelected && styles.cardIconSelected]}>
                    <Ionicons
                      name={industry.icon}
                      size={18}
                      color={isSelected ? '#1E1E1E' : '#666666'}
                    />
                  </View>
                  <Text
                    style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}
                    numberOfLines={2}
                  >
                    {t(industry.labelKey, { defaultValue: industry.defaultLabel })}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.continueButton, (!selected || saving) && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={!selected || saving}
            activeOpacity={0.85}
          >
            <Text style={styles.continueButtonText}>
              {saving
                ? t('common.saving', { defaultValue: 'Saving…' })
                : t('qualification.continue', { defaultValue: 'Continue' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const CARD_GAP = 12;

const makeStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.scrim,
    justifyContent: 'flex-end',
  },
  // Refresh — design's industry sheet sits on white with a soft grabber +
  // close X, light typography, and the yellow Continue button at the bottom.
  sheet: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.borderStrong,
    marginTop: 8,
    marginBottom: 14,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  headline: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subhead: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textSecondary,
    lineHeight: 20,
    letterSpacing: -0.1,
    marginBottom: 18,
  },
  scrollArea: {
    flexGrow: 0,
    maxHeight: 420,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GAP,
    paddingBottom: 12,
  },
  card: {
    width: `${(100 - 4) / 2}%`,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 14,
    minHeight: 92,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  cardSelected: {
    borderColor: '#F2C31B',
    borderWidth: 2,
    backgroundColor: '#FFF4C2',
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardIconSelected: {
    backgroundColor: '#F2C31B',
  },
  cardLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  cardLabelSelected: {
    color: theme.textPrimary,
  },
  continueButton: {
    backgroundColor: '#F2C31B',
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  continueButtonDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
  },
  continueButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
});

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { SOFT_TRIAL_EXPORT_LIMIT, SOFT_TRIAL_LOW_RES_MAX_DIM, PAYWALL_TRIGGERS } from '../constants/softTrial';

/**
 * Compact "X of N free exports remaining" badge. Visible only while the soft
 * trial is active and the user is on starter. Tapping opens the paywall with
 * the export-limit trigger so the user can pre-empt the gate.
 *
 * Variants:
 *  - "compact" (default): horizontal pill, suitable for headers or above CTAs
 *  - "banner": full-width strip, suitable above primary actions
 */
export default function SoftTrialBadge({ navigation, variant = 'compact', style }) {
  const { softTrialActive, softTrialRemaining, userPlan } = useSettings();
  const { t } = useTranslation();

  if (userPlan !== 'starter') return null;
  if (!softTrialActive) return null;

  const used = Math.max(0, SOFT_TRIAL_EXPORT_LIMIT - (softTrialRemaining ?? 0));
  const remaining = softTrialRemaining ?? 0;

  const handlePress = () => {
    if (navigation?.navigate) {
      navigation.navigate('PlanSelection', { trigger: PAYWALL_TRIGGERS.EXPORT_LIMIT });
    }
  };

  if (variant === 'banner') {
    return (
      <Pressable onPress={handlePress} style={[styles.banner, style]}>
        <Ionicons name="gift-outline" size={16} color="#000" style={{ marginRight: 8 }} />
        <View style={styles.bannerTextWrap}>
          <Text style={styles.bannerText}>
            {t('softTrial.bannerText', { remaining, limit: SOFT_TRIAL_EXPORT_LIMIT })}
          </Text>
          <Text style={styles.bannerSubtext}>
            {t('softTrial.bannerSubtext', { maxDim: SOFT_TRIAL_LOW_RES_MAX_DIM })}
          </Text>
        </View>
        <Text style={styles.bannerCta}>{t('settings.upgrade')}</Text>
      </Pressable>
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={[styles.pill, style]}>
      <Ionicons name="sparkles-outline" size={12} color="#000" style={{ marginRight: 4 }} />
      <Text style={styles.pillText}>
        {t('softTrial.pillText', { used, limit: SOFT_TRIAL_EXPORT_LIMIT })}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#FFF1B8',
    borderWidth: 1,
    borderColor: '#F2C31B',
    alignSelf: 'flex-start',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#000',
    fontFamily: 'Alexandria_400Regular',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#F2C31B',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  bannerTextWrap: {
    flex: 1,
    marginRight: 8,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
    fontFamily: 'Alexandria_400Regular',
  },
  bannerSubtext: {
    fontSize: 11,
    fontWeight: '500',
    color: '#5A4500',
    marginTop: 2,
    fontFamily: 'Alexandria_400Regular',
  },
  bannerCta: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B8321',
    fontFamily: 'Alexandria_400Regular',
  },
});

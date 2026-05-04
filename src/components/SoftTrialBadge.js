import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { SOFT_TRIAL_EXPORT_LIMIT, PAYWALL_TRIGGERS } from '../constants/softTrial';

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
        <Text style={styles.bannerText}>
          {remaining} of {SOFT_TRIAL_EXPORT_LIMIT} free exports left
        </Text>
        <Text style={styles.bannerCta}>Upgrade</Text>
      </Pressable>
    );
  }

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} style={[styles.pill, style]}>
      <Ionicons name="sparkles-outline" size={12} color="#000" style={{ marginRight: 4 }} />
      <Text style={styles.pillText}>
        {used}/{SOFT_TRIAL_EXPORT_LIMIT} free
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
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
    fontFamily: 'Alexandria_400Regular',
  },
  bannerCta: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B8321',
    fontFamily: 'Alexandria_400Regular',
  },
});

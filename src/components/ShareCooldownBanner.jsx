import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasFeature, FEATURES } from '../constants/featurePermissions';

const RATE_LIMIT_MS = 24 * 60 * 60 * 1000;
const LAST_SHARE_KEY = '@proofpix_last_share_at';

/**
 * Banner shown to Starter (Free-plan) users while they are inside the rolling
 * 24-hour share cooldown. Renders nothing for plans that have
 * FEATURES.UNLIMITED_SHARING or for users who have not yet performed a share.
 *
 * Updates once per minute. The countdown uses HH:MM format (e.g. "23:59").
 *
 * Props:
 *   effectivePlan - the user's effective plan name from useFeaturePermissions.
 *   t             - i18n function (optional). Falls back to English.
 *   onPress       - optional handler when the banner is tapped (e.g. open paywall).
 */
export default function ShareCooldownBanner({ effectivePlan, t, onPress }) {
  const [remainingMs, setRemainingMs] = useState(null);

  useEffect(() => {
    // Pro/Business/Enterprise/Team — unlimited sharing, no banner.
    if (hasFeature(FEATURES.UNLIMITED_SHARING, effectivePlan)) {
      setRemainingMs(null);
      return undefined;
    }

    let mounted = true;
    let interval;

    const refresh = async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_SHARE_KEY);
        if (!raw) {
          if (mounted) setRemainingMs(null);
          return;
        }
        const last = parseInt(raw, 10);
        if (!last || Number.isNaN(last)) {
          if (mounted) setRemainingMs(null);
          return;
        }
        const elapsed = Date.now() - last;
        const r = RATE_LIMIT_MS - elapsed;
        if (mounted) setRemainingMs(r > 0 ? r : null);
      } catch {
        if (mounted) setRemainingMs(null);
      }
    };

    refresh();
    interval = setInterval(refresh, 60_000);
    return () => {
      mounted = false;
      if (interval) clearInterval(interval);
    };
  }, [effectivePlan]);

  if (!remainingMs || remainingMs <= 0) return null;

  const totalMin = Math.max(0, Math.floor(remainingMs / 60_000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const formatted = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  const tr = typeof t === 'function' ? t : (_, opts) => opts?.defaultValue || _;
  const label = tr('share.nextFreeExportIn', {
    defaultValue: `Next free export in ${formatted}`,
    time: formatted,
  });

  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.banner} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.text}>{label}</Text>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginHorizontal: 16,
    marginVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// Non-blocking top-of-screen pill that shows how many photos the
// chrome-bake pipeline is preparing. Subscribes to
// chromeBakeService.subscribe so it stays in sync with every bake
// path (single-photo share on Home / PhotoSetPreview, multi-share on
// ProjectDetail, report generation).
//
// pointerEvents="none" on the outer container — the user can freely
// navigate and interact with any UI beneath the banner while a batch
// is in flight. The OS share sheet still pops when the last bake
// completes; nothing here is modal.
//
// Peak-tracking:
//   Queue depth grows as bakes are enqueued (typically all-at-once
//   from a batch share via Promise.all), then drains as the baker
//   processes them one at a time. Peak = the high-water mark seen
//   since the queue was last empty; completed = peak - currentPending.
//   When the queue empties we reset peak → hidden state.
//
// Cached bakes short-circuit before hitting the queue, so an all-hit
// batch never shows the banner. That's fine — cached hits are
// instant; the banner exists for the multi-second wait users flagged
// on 2026-07-21.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import chromeBakeService from '../services/chromeBakeService';

// Hardcoded colors — this banner intentionally sits outside
// SettingsProvider (mounted next to the other global background
// components in App.js), so useTheme would fall back to lightTheme
// regardless of the user's dark-mode preference. A neutral dark pill
// with light text reads clearly on both themes.
const COLORS = {
  bg: 'rgba(30, 30, 30, 0.94)',
  text: '#FFFFFF',
  accent: '#FFD700',
  trackBg: 'rgba(255, 255, 255, 0.18)',
};

export default function GlobalBakeProgressBanner() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  // Current pending job count from the service. peak is the max
  // pending seen since the queue was last idle.
  const [pending, setPending] = useState(0);
  const peakRef = useRef(0);
  const [peak, setPeak] = useState(0);

  useEffect(() => {
    // First tick — if the app starts up mid-bake (unlikely but
    // possible on OTA reload during a queued job) we still want to
    // reflect that.
    const initial = chromeBakeService.getJobs().length;
    if (initial > 0) {
      peakRef.current = initial;
      setPeak(initial);
      setPending(initial);
    }

    const unsub = chromeBakeService.subscribe((jobs) => {
      const n = jobs.length;
      if (n === 0) {
        // Queue empty — reset peak so the next batch starts fresh
        // instead of accumulating across sessions.
        peakRef.current = 0;
        setPeak(0);
        setPending(0);
        return;
      }
      if (n > peakRef.current) {
        peakRef.current = n;
        setPeak(n);
      }
      setPending(n);
    });
    return unsub;
  }, []);

  if (pending === 0 || peak === 0) return null;

  const completed = Math.max(0, peak - pending);
  // Show "1 of N" the moment work starts (nothing has finished yet
  // but the user needs to see the batch total right away). Cap at
  // `peak` so we never display N+1 of N due to a stale render.
  const currentIndex = Math.min(peak, completed + 1);
  const progress = peak > 0 ? completed / peak : 0;

  // Single-photo bakes: show "Preparing photo…" instead of "1 / 1"
  // — the ratio adds no information and reads like an error state.
  const label = peak === 1
    ? t('share.preparingPhoto', { defaultValue: 'Preparing photo…' })
    : t('share.preparingPhotos', {
        current: currentIndex,
        total: peak,
        defaultValue: `Preparing ${currentIndex} of ${peak} photos…`,
      });

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        { top: insets.top + 8 },
      ]}
    >
      <View style={styles.pill}>
        <ActivityIndicator size="small" color={COLORS.accent} style={styles.spinner} />
        <View style={styles.textCol}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          {peak > 1 && (
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${Math.min(100, Math.max(4, progress * 100))}%` }]} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: COLORS.bg,
    minWidth: 220,
    maxWidth: '92%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  spinner: {
    marginRight: 10,
  },
  textCol: {
    flex: 1,
  },
  label: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  track: {
    marginTop: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.trackBg,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },
});

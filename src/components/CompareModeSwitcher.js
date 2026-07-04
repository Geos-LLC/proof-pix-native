import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/useTheme';

/**
 * Pill-style mode picker for CompareViewer. Three modes:
 *   - 'overlay'      — tap-to-toggle single-frame compare
 *   - 'split'        — draggable divider
 *   - 'side-by-side' — both photos visible at once
 *
 * Keep the order consistent (Overlay / Split / Side by Side) so muscle memory
 * carries across screens.
 */
const MODES = [
  { key: 'overlay', labelKey: 'compare.modeOverlay' },
  { key: 'split', labelKey: 'compare.modeSplit' },
  { key: 'side-by-side', labelKey: 'compare.modeSideBySide' },
];

export default function CompareModeSwitcher({ mode, onChange, style }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={[styles.row, style]}>
      {MODES.map(({ key, labelKey }) => {
        const active = mode === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onChange?.(key)}
            activeOpacity={0.85}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
              {t(labelKey)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 999,
    padding: 4,
    alignSelf: 'center',
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  pillActive: {
    backgroundColor: '#F2C31B',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
  },
  pillTextActive: {
    color: '#000',
  },
});

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';

// AppearanceScreen — dedicated route.
//
// Two radio rows (Light / Dark). Each row is a hairline card with a
// leading icon tile + label + a check on the active row. Light is the
// default; there is no System option.

export default function AppearanceScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { themeMode, setThemeMode } = useSettings();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const choose = (mode) => setThemeMode(mode);

  const options = [
    {
      key: 'light',
      icon: 'sunny-outline',
      label: t('appearance.light', { defaultValue: 'Light' }),
      sub: t('appearance.lightSub', { defaultValue: 'Bright background, dark text' }),
      active: themeMode === 'light',
    },
    {
      key: 'dark',
      icon: 'moon-outline',
      label: t('appearance.dark', { defaultValue: 'Dark' }),
      sub: t('appearance.darkSub', { defaultValue: 'Easier on the eyes in low light' }),
      active: themeMode === 'dark',
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('appearance.title', { defaultValue: 'Appearance' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>
          {t('appearance.theme', { defaultValue: 'Theme' })}
        </Text>

        <View style={styles.rowGroup}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.row, opt.active && styles.rowActive]}
              onPress={() => choose(opt.key)}
              activeOpacity={0.85}
            >
              <View style={[styles.rowIc, opt.active && styles.rowIcActive]}>
                <Ionicons
                  name={opt.icon}
                  size={19}
                  color={opt.active ? theme.accentInk : theme.textPrimary}
                />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>{opt.label}</Text>
                <Text style={styles.rowSub} numberOfLines={2}>{opt.sub}</Text>
              </View>
              {opt.active ? (
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={14} color={theme.accentText} />
                </View>
              ) : (
                <View style={styles.checkRing} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.2,
  },

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: theme.textMuted,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 22,
  },

  rowGroup: { marginHorizontal: 18, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    ...theme.shadowCard,
  },
  rowActive: {
    borderColor: theme.accent,
    borderWidth: 2,
    backgroundColor: theme.surfaceAccent,
  },
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcActive: {
    backgroundColor: theme.accentSoft,
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 1,
  },

  checkCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
  },
});

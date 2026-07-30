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
import { useTheme } from '../hooks/useTheme';

// FeedbackScreen — chooser between "Report a bug" and "Suggest a feature".
// Two tall tiles matched to the design language of HelpSupportScreen.
export default function FeedbackScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
          {t('feedback.title', { defaultValue: 'Send feedback' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          {t('feedback.intro', {
            defaultValue: 'Help us improve ProofPix. Tell us what went wrong, or share an idea.',
          })}
        </Text>

        <TouchableOpacity
          style={styles.tile}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('BugReport')}
        >
          <View style={[styles.tileIcon, { backgroundColor: '#FFF3D6' }]}>
            <Ionicons name="bug-outline" size={22} color="#8A6A00" />
          </View>
          <View style={styles.tileMeta}>
            <Text style={styles.tileTitle}>
              {t('feedback.bugTileTitle', { defaultValue: 'Report a bug or UX issue' })}
            </Text>
            <Text style={styles.tileSub}>
              {t('feedback.bugTileSub', {
                defaultValue: 'Something broken, confusing, or slower than it should be',
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tile}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('FeatureRequest')}
        >
          <View style={[styles.tileIcon, { backgroundColor: '#E3F0FF' }]}>
            <Ionicons name="bulb-outline" size={22} color="#0B5FBF" />
          </View>
          <View style={styles.tileMeta}>
            <Text style={styles.tileTitle}>
              {t('feedback.featureTileTitle', { defaultValue: 'Suggest a feature' })}
            </Text>
            <Text style={styles.tileSub}>
              {t('feedback.featureTileSub', {
                defaultValue: "Have an idea that would make ProofPix better? We'd love to hear it.",
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
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
  intro: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 18,
    lineHeight: 20,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginHorizontal: 18,
    marginBottom: 10,
    paddingVertical: 16,
    paddingHorizontal: 14,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileMeta: {
    flex: 1,
    minWidth: 0,
  },
  tileTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  tileSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 3,
    lineHeight: 16,
  },
});

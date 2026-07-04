import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import { logOnboardingStarted, logOnboardingStepCompleted } from '../utils/analytics';
import { useTheme } from '../hooks/useTheme';

const { width } = Dimensions.get('window');

// Refresh pass 7 — rebuilt to match design screenshot 02-welcome:
//   ┌─────────────────────────┐
//   │   Big before/after      │  ← portrait hero card (~52% screen height)
//   │   preview with BEFORE   │     showing beige "before" + cyan "after"
//   │   (yellow) | AFTER      │     with a vertical yellow divider down
//   │   (purple) chip         │     the middle. Chips top-left + top-right.
//   ├─────────────────────────┤
//   │  [logo] ProofPix        │  ← small yellow logo tile + wordmark
//   │                         │
//   │  Show the work.         │  ← Alexandria 700 two-line headline
//   │  Win the job.           │
//   │                         │
//   │  Document every job…    │  ← supporting subhead
//   │                         │
//   │  [    Get started    ]  │  ← yellow primary CTA
//   │  I already have an…     │  ← ghost link
//   └─────────────────────────┘

export default function WelcomeSetupScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleGetStarted = () => {
    logOnboardingStarted();
    logOnboardingStepCompleted('welcome');
    navigation.navigate('UserInfoSetup');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.content, { paddingBottom: 12 + insets.bottom }]}>
        {/* Hero before/after preview — the marquee that sells the app's
            value in a single visual. Beige "before" half + cyan-tinted
            "after" half with a vertical accent divider down the middle. */}
        <Animated.View
          style={[
            styles.hero,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.heroHalf}>
            <View style={[styles.heroFill, styles.heroBefore]} />
            <View style={styles.chipBefore}>
              <Text style={styles.chipBeforeText}>BEFORE</Text>
            </View>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroHalf}>
            <View style={[styles.heroFill, styles.heroAfter]} />
            <View style={styles.chipAfter}>
              <Text style={styles.chipAfterText}>AFTER</Text>
            </View>
          </View>
        </Animated.View>

        {/* Brand + headline block sits in the lower half. */}
        <Animated.View
          style={[
            styles.copyBlock,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.brandRow}>
            <View style={styles.logoTile}>
              <Ionicons name="camera" size={18} color="#1E1E1E" />
            </View>
            <Text style={styles.wordmark}>ProofPix</Text>
          </View>

          <Text style={styles.headline}>
            {t('welcome.headline', { defaultValue: 'Show the work.\nWin the job.' })}
          </Text>
          <Text style={styles.subhead}>
            {t('welcome.subhead', {
              defaultValue: 'Document every job with paired before & after photos your clients can trust.',
            })}
          </Text>
        </Animated.View>

        {/* Primary + ghost actions at the bottom. */}
        <Animated.View
          style={[
            styles.actions,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleGetStarted}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryButtonText}>
              {t('welcome.getStarted', { defaultValue: 'Get started' })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghostLink}
            onPress={handleGetStarted}
            activeOpacity={0.7}
          >
            <Text style={styles.ghostLinkText}>
              {t('welcome.haveAccount', { defaultValue: 'I already have an account' })}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const HERO_HEIGHT = Math.round(Dimensions.get('window').height * 0.48);

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surfaceElevated,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Hero before/after preview card.
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    borderRadius: 24,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: theme.surface,
  },
  heroHalf: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  heroFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroBefore: {
    backgroundColor: '#D6CFC3',
  },
  heroAfter: {
    backgroundColor: '#CCDFE1',
  },
  heroDivider: {
    width: 4,
    backgroundColor: '#F2C31B',
  },
  chipBefore: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: '#F2C31B',
  },
  chipBeforeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: 0.6,
  },
  chipAfter: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: '#A855F7',
  },
  chipAfterText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },

  // Brand + headline copy.
  copyBlock: {
    marginTop: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  logoTile: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordmark: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 19,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.3,
  },
  headline: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 28,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 10,
  },
  subhead: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    color: theme.textSecondary,
    lineHeight: 21,
    letterSpacing: -0.1,
  },

  // Actions at the bottom.
  actions: {
    marginTop: 'auto',
    paddingTop: 16,
  },
  primaryButton: {
    backgroundColor: '#F2C31B',
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  ghostLink: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8,
  },
  ghostLinkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
});

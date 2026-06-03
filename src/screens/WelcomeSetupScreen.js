import React, { useEffect, useRef } from 'react';
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
import { FONTS, scaleFontSize } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import { logOnboardingStarted, logOnboardingStepCompleted } from '../utils/analytics';

const { width } = Dimensions.get('window');
const scaled = (size) => scaleFontSize(size, width);

export default function WelcomeSetupScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleGetStarted = () => {
    logOnboardingStarted();
    logOnboardingStepCompleted('welcome');
    navigation.navigate('UserInfoSetup');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo and App Name */}
        <Animated.View 
          style={[
            styles.logoContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            },
          ]}
        >
          <View style={styles.logoWrapper}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.appTitle}>ProofPix</Text>
          <Text style={styles.appSubtitle}>
            {t('welcome.subtitle', { defaultValue: 'Professional Before & After Photo Documentation' })}
          </Text>
        </Animated.View>

        {/* Features List */}
        <Animated.View 
          style={[
            styles.featuresContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.featureItem}>
            <View style={styles.featureIconContainer}>
              <View style={styles.featureIconBackground}>
                <Ionicons name="camera" size={32} color={COLORS.PRIMARY} />
              </View>
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={styles.featureTitle}>
                {t('welcome.feature1Title', { defaultValue: 'Capture Before & After' })}
              </Text>
              <Text style={styles.featureDescription}>
                {t('welcome.feature1Desc', { defaultValue: 'Take professional photos with automatic labeling' })}
              </Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <View style={styles.featureIconContainer}>
              <View style={styles.featureIconBackground}>
                <Ionicons name="images" size={32} color={COLORS.PRIMARY} />
              </View>
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={styles.featureTitle}>
                {t('welcome.feature2Title', { defaultValue: 'Create Combined Images' })}
              </Text>
              <Text style={styles.featureDescription}>
                {t('welcome.feature2Desc', { defaultValue: 'Automatically merge before and after photos' })}
              </Text>
            </View>
          </View>

          <View style={styles.featureItem}>
            <View style={styles.featureIconContainer}>
              <View style={styles.featureIconBackground}>
                <Ionicons name="cloud-upload" size={32} color={COLORS.PRIMARY} />
              </View>
            </View>
            <View style={styles.featureTextContainer}>
              <Text style={styles.featureTitle}>
                {t('welcome.feature3Title', { defaultValue: 'Cloud Sync' })}
              </Text>
              <Text style={styles.featureDescription}>
                {t('welcome.feature3Desc', { defaultValue: 'Sync photos to Google Drive, Dropbox, or iCloud' })}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Get Started Button */}
        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          }}
        >
          <TouchableOpacity
            style={styles.getStartedButton}
            onPress={handleGetStarted}
            activeOpacity={0.85}
          >
            <Text style={styles.getStartedButtonText}>
              {t('welcome.getStarted', { defaultValue: 'Get Started' })}
            </Text>
            <Ionicons name="arrow-forward" size={22} color="#000" style={styles.buttonIcon} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    justifyContent: 'space-between',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  // Refresh: yellow accent tile with the logo centered, matching the
  // design's brand mark — drops the heavy yellow border + tinted shadow
  // for a cleaner card with a warm pop-shadow.
  logoWrapper: {
    width: 120,
    height: 120,
    borderRadius: 24,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 10,
  },
  logo: {
    width: 100,
    height: 100,
  },
  appTitle: {
    fontSize: scaled(44),
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: scaled(17),
    color: '#666666',
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
    lineHeight: scaled(24),
    paddingHorizontal: 24,
  },
  featuresContainer: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  featureIconContainer: {
    marginRight: 16,
  },
  // Refresh: lighter feature icon — soft yellow tint, no thick border.
  // Matches the design's `accent-soft` pattern for inline icon tiles.
  featureIconBackground: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#FFF4C2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureTextContainer: {
    flex: 1,
    paddingTop: 4,
  },
  featureTitle: {
    fontSize: scaled(20),
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  featureDescription: {
    fontSize: scaled(15),
    color: '#666666',
    fontFamily: FONTS.ALEXANDRIA,
    lineHeight: scaled(22),
  },
  // Refresh: primary button per design spec — 52px height, radius 16,
  // 700 weight, warm pop-shadow, no double border.
  getStartedButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 16,
    height: 52,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  getStartedButtonText: {
    fontSize: scaled(18),
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 10,
  },
});


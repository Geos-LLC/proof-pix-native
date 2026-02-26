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
  logoWrapper: {
    width: 140,
    height: 140,
    borderRadius: 28,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '20',
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
  featureIconBackground: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: COLORS.PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '30',
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
  getStartedButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    borderWidth: 2,
    borderColor: '#00000010',
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


import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  PermissionsAndroid,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';

export default function PermissionsSetupScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  
  const [cameraPermission, setCameraPermission] = useState(null);
  const [photoPermission, setPhotoPermission] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const cameraCheckAnim = useRef(new Animated.Value(0)).current;
  const photoCheckAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (cameraPermission) {
      Animated.spring(cameraCheckAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
  }, [cameraPermission]);

  useEffect(() => {
    if (photoPermission) {
      Animated.spring(photoCheckAnim, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
  }, [photoPermission]);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      // Check camera permission
      const cameraStatus = await Camera.getCameraPermissionsAsync();
      setCameraPermission(cameraStatus.granted || cameraStatus.status === 'granted');

      // Check photo library permission
      const photoStatus = await MediaLibrary.getPermissionsAsync();
      setPhotoPermission(photoStatus.status === 'granted' || photoStatus.status === 'limited');
    } catch (error) {
      console.error('[PermissionsSetup] Error checking permissions:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const requestCameraPermission = async () => {
    try {
      const result = await Camera.requestCameraPermissionsAsync();
      const granted = result.granted || result.status === 'granted';
      setCameraPermission(granted);
      
      if (!granted) {
        Alert.alert(
          t('permissions.cameraDeniedTitle', { defaultValue: 'Camera Permission Required' }),
          t('permissions.cameraDeniedMessage', {
            defaultValue: 'ProofPix needs camera access to take photos. Please enable it in Settings.'
          }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            {
              text: t('permissions.openSettings', { defaultValue: 'Open Settings' }),
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }
    } catch (error) {
      console.error('[PermissionsSetup] Error requesting camera permission:', error);
    }
  };

  const requestPhotoPermission = async () => {
    try {
      const result = await MediaLibrary.requestPermissionsAsync();
      const granted = result.status === 'granted' || result.status === 'limited';
      setPhotoPermission(granted);
      
      if (!granted) {
        Alert.alert(
          t('permissions.photosDeniedTitle', { defaultValue: 'Photo Library Permission Required' }),
          t('permissions.photosDeniedMessage', {
            defaultValue: 'ProofPix needs photo library access to save your photos. Please enable it in Settings.'
          }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            {
              text: t('permissions.openSettings', { defaultValue: 'Open Settings' }),
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      }
    } catch (error) {
      console.error('[PermissionsSetup] Error requesting photo permission:', error);
    }
  };

  const handleContinue = () => {
    if (!cameraPermission || !photoPermission) {
      Alert.alert(
        t('permissions.requiredTitle', { defaultValue: 'Permissions Required' }),
        t('permissions.requiredMessage', {
          defaultValue: 'Please grant camera and photo library permissions to use ProofPix.'
        })
      );
      return;
    }

    // Navigate to plan selection or label language setup
    navigation.navigate('LabelLanguageSetup');
  };

  const handleSkip = () => {
    Alert.alert(
      t('permissions.skipTitle', { defaultValue: 'Skip Permissions?' }),
      t('permissions.skipMessage', {
        defaultValue: 'You can grant permissions later in Settings, but some features may not work until then.'
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.continue', { defaultValue: 'Continue' }),
          onPress: () => navigation.navigate('LabelLanguageSetup'),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <Animated.View 
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.headerIconContainer}>
            <Ionicons name="shield-checkmark-outline" size={48} color={COLORS.PRIMARY} />
          </View>
          <Text style={styles.title}>
            {t('permissions.title', { defaultValue: 'Enable Permissions' })}
          </Text>
          <Text style={styles.subtitle}>
            {t('permissions.subtitle', {
              defaultValue: 'ProofPix needs these permissions to function properly'
            })}
          </Text>
        </Animated.View>

        {/* Permissions List */}
        <Animated.View 
          style={[
            styles.permissionsContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Camera Permission */}
          <View style={[
            styles.permissionCard,
            cameraPermission && styles.permissionCardGranted,
          ]}>
            <View style={[
              styles.permissionIconContainer,
              cameraPermission && styles.permissionIconContainerGranted,
            ]}>
              <Ionicons 
                name="camera" 
                size={32} 
                color={cameraPermission ? '#FFFFFF' : COLORS.PRIMARY} 
              />
            </View>
            <View style={styles.permissionContent}>
              <Text style={styles.permissionTitle}>
                {t('permissions.cameraTitle', { defaultValue: 'Camera Access' })}
              </Text>
              <Text style={styles.permissionDescription}>
                {t('permissions.cameraDescription', {
                  defaultValue: 'Required to take before and after photos'
                })}
              </Text>
            </View>
            <View style={styles.permissionStatus}>
              {cameraPermission === null ? (
                <View style={styles.statusPending}>
                  <Animated.View 
                    style={[
                      styles.statusPendingInner,
                      {
                        transform: [{ scale: cameraCheckAnim }],
                      },
                    ]}
                  />
                </View>
              ) : cameraPermission ? (
                <Animated.View
                  style={{
                    transform: [{ scale: cameraCheckAnim }],
                  }}
                >
                  <View style={styles.statusGrantedContainer}>
                    <Ionicons name="checkmark-circle" size={28} color="#34C759" />
                  </View>
                </Animated.View>
              ) : (
                <TouchableOpacity
                  style={styles.enableButton}
                  onPress={requestCameraPermission}
                  activeOpacity={0.8}
                >
                  <Text style={styles.enableButtonText}>
                    {t('permissions.enable', { defaultValue: 'Enable' })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Photo Library Permission */}
          <View style={[
            styles.permissionCard,
            photoPermission && styles.permissionCardGranted,
          ]}>
            <View style={[
              styles.permissionIconContainer,
              photoPermission && styles.permissionIconContainerGranted,
            ]}>
              <Ionicons 
                name="images" 
                size={32} 
                color={photoPermission ? '#FFFFFF' : COLORS.PRIMARY} 
              />
            </View>
            <View style={styles.permissionContent}>
              <Text style={styles.permissionTitle}>
                {t('permissions.photosTitle', { defaultValue: 'Photo Library Access' })}
              </Text>
              <Text style={styles.permissionDescription}>
                {t('permissions.photosDescription', {
                  defaultValue: 'Required to save and organize your photos'
                })}
              </Text>
            </View>
            <View style={styles.permissionStatus}>
              {photoPermission === null ? (
                <View style={styles.statusPending}>
                  <Animated.View 
                    style={[
                      styles.statusPendingInner,
                      {
                        transform: [{ scale: photoCheckAnim }],
                      },
                    ]}
                  />
                </View>
              ) : photoPermission ? (
                <Animated.View
                  style={{
                    transform: [{ scale: photoCheckAnim }],
                  }}
                >
                  <View style={styles.statusGrantedContainer}>
                    <Ionicons name="checkmark-circle" size={28} color="#34C759" />
                  </View>
                </Animated.View>
              ) : (
                <TouchableOpacity
                  style={styles.enableButton}
                  onPress={requestPhotoPermission}
                  activeOpacity={0.8}
                >
                  <Text style={styles.enableButtonText}>
                    {t('permissions.enable', { defaultValue: 'Enable' })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Animated.View>

        {/* Action Buttons */}
        <Animated.View 
          style={[
            styles.actionsContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.continueButton,
              (!cameraPermission || !photoPermission) && styles.continueButtonDisabled
            ]}
            onPress={handleContinue}
            disabled={!cameraPermission || !photoPermission}
            activeOpacity={0.85}
          >
            <Text style={styles.continueButtonText}>
              {t('common.continue', { defaultValue: 'Continue' })}
            </Text>
            <Ionicons name="arrow-forward" size={20} color="#000" style={styles.buttonIcon} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>
              {t('common.skip', { defaultValue: 'Skip for Now' })}
            </Text>
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
    paddingHorizontal: 30,
    paddingTop: 40,
    paddingBottom: 30,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  headerIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: COLORS.PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '30',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    fontFamily: FONTS.QUICKSAND_REGULAR,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  permissionsContainer: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 32,
  },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  permissionCardGranted: {
    borderColor: '#34C759' + '60',
    backgroundColor: '#F0FDF4',
  },
  permissionIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: COLORS.PRIMARY + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY + '30',
  },
  permissionIconContainerGranted: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  permissionContent: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: COLORS.TEXT,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  permissionDescription: {
    fontSize: 14,
    color: '#666666',
    fontFamily: FONTS.QUICKSAND_REGULAR,
    lineHeight: 20,
  },
  permissionStatus: {
    marginLeft: 12,
    minWidth: 90,
    alignItems: 'flex-end',
  },
  statusPending: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusPendingInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#999999',
  },
  statusGrantedContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enableButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  enableButtonText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000000',
  },
  actionsContainer: {
    marginTop: 20,
  },
  continueButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    elevation: 6,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    borderWidth: 2,
    borderColor: '#00000010',
  },
  continueButtonDisabled: {
    backgroundColor: '#E0E0E0',
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  continueButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
    color: '#000000',
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 10,
  },
  skipButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 16,
    color: '#666666',
    fontFamily: FONTS.QUICKSAND_MEDIUM,
  },
});


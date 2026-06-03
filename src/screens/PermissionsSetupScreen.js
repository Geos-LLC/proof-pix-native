import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Linking,
  Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import { logOnboardingStepCompleted } from '../utils/analytics';

// Refresh pass 7 — rebuilt to match design screenshot 03-permissions:
//
//   [shield] ← small soft-accent tile, top-left
//   A few permissions                     ← bold left-aligned headline
//   ProofPix only uses these to capture…  ← supporting subhead
//
//   ┌──────────────────────────────┐
//   │ [📷] Camera          ✓       │   ← granted state = green check
//   │     Capture before & after… │
//   └──────────────────────────────┘
//   ┌──────────────────────────────┐
//   │ [🖼️] Photos          ✓       │
//   │     Import existing shots…  │
//   └──────────────────────────────┘
//   ┌──────────────────────────────┐
//   │ [📍] Location     [Allow]    │   ← not-yet state = outline button
//   │     Stamp GPS & address…    │
//   └──────────────────────────────┘
//   ┌──────────────────────────────┐
//   │ [🎤] Microphone   [Allow]    │
//   │     Record voice notes…     │
//   └──────────────────────────────┘
//
//   [        Allow access         ]    ← yellow primary CTA — requests
//                                        anything still missing.
//        Not now                       ← ghost skip
//
// All four are real requests:
//   Camera     → expo-camera        (existing)
//   Photos     → expo-media-library (existing)
//   Location   → expo-location      (new — was already a dep, used by upload)
//   Microphone → expo-av Audio      (new — was already a dep, used by voice notes)
//
// Location + Microphone are optional — the user can proceed without them
// (we don't block Continue on those). Camera + Photos remain required.

export default function PermissionsSetupScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [cameraGranted, setCameraGranted] = useState(false);
  const [photoGranted, setPhotoGranted] = useState(false);
  const [locationGranted, setLocationGranted] = useState(false);
  const [micGranted, setMicGranted] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const camera = await Camera.getCameraPermissionsAsync();
        setCameraGranted(!!(camera.granted || camera.status === 'granted'));

        const photo = await MediaLibrary.getPermissionsAsync();
        setPhotoGranted(photo.status === 'granted' || photo.status === 'limited');

        const location = await Location.getForegroundPermissionsAsync();
        setLocationGranted(location.status === 'granted');

        const mic = await Audio.getPermissionsAsync();
        setMicGranted(mic.status === 'granted');
      } catch (e) {
        // Non-fatal — leave defaults (denied) and let the user re-grant.
      }
    })();
  }, []);

  const requestCamera = async () => {
    try {
      const result = await Camera.requestCameraPermissionsAsync();
      const granted = !!(result.granted || result.status === 'granted');
      setCameraGranted(granted);
      if (!granted) showDeniedAlert('Camera');
      return granted;
    } catch {
      return false;
    }
  };

  const requestPhoto = async () => {
    try {
      const result = await MediaLibrary.requestPermissionsAsync();
      const granted = result.status === 'granted' || result.status === 'limited';
      setPhotoGranted(granted);
      if (!granted) showDeniedAlert('Photos');
      return granted;
    } catch {
      return false;
    }
  };

  const requestLocation = async () => {
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      const granted = result.status === 'granted';
      setLocationGranted(granted);
      return granted;
    } catch {
      return false;
    }
  };

  const requestMic = async () => {
    try {
      const result = await Audio.requestPermissionsAsync();
      const granted = result.status === 'granted';
      setMicGranted(granted);
      return granted;
    } catch {
      return false;
    }
  };

  const showDeniedAlert = (which) => {
    Alert.alert(
      t('permissions.deniedTitle', { defaultValue: `${which} permission needed` }),
      t('permissions.deniedMessage', {
        defaultValue: `Enable ${which} in Settings to use this feature.`,
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('permissions.openSettings', { defaultValue: 'Open Settings' }),
          onPress: () => Linking.openSettings(),
        },
      ],
    );
  };

  // "Allow access" — requests anything still missing, then advances if
  // the two required ones (Camera + Photos) are granted.
  const handleAllowAccess = async () => {
    if (!cameraGranted) await requestCamera();
    if (!photoGranted) await requestPhoto();
    if (!locationGranted) await requestLocation();
    if (!micGranted) await requestMic();
    // Re-read state guard — useState updates are async so use returned
    // values from this round to decide whether to advance.
    const cam = cameraGranted || (await Camera.getCameraPermissionsAsync()).granted;
    const ph = photoGranted || ['granted', 'limited'].includes((await MediaLibrary.getPermissionsAsync()).status);
    if (cam && ph) {
      logOnboardingStepCompleted('permissions');
      navigation.navigate('LabelLanguageSetup');
    } else {
      Alert.alert(
        t('permissions.requiredTitle', { defaultValue: 'Permissions Required' }),
        t('permissions.requiredMessage', {
          defaultValue: 'ProofPix needs Camera and Photos access to capture and store your work.',
        }),
      );
    }
  };

  const handleNotNow = () => {
    Alert.alert(
      t('permissions.skipTitle', { defaultValue: 'Skip for now?' }),
      t('permissions.skipMessage', {
        defaultValue: "You can enable these later in Settings. Some features won't work until you do.",
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.continue', { defaultValue: 'Continue' }),
          onPress: () => navigation.navigate('LabelLanguageSetup'),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.View
        style={[
          styles.content,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.headerIcon}>
          <Ionicons name="shield-checkmark" size={24} color="#7A5B00" />
        </View>

        <Text style={styles.headline}>
          {t('permissions.headline', { defaultValue: 'A few permissions' })}
        </Text>
        <Text style={styles.subhead}>
          {t('permissions.subhead', {
            defaultValue: 'ProofPix only uses these to capture and document your work. Nothing is shared.',
          })}
        </Text>

        <View style={styles.rows}>
          <PermissionRow
            icon="camera-outline"
            title={t('permissions.cameraTitle', { defaultValue: 'Camera' })}
            description={t('permissions.cameraDescription', {
              defaultValue: 'Capture before & after photos on the job',
            })}
            granted={cameraGranted}
            onAllow={requestCamera}
          />
          <PermissionRow
            icon="image-outline"
            title={t('permissions.photosTitle', { defaultValue: 'Photos' })}
            description={t('permissions.photosDescription', {
              defaultValue: 'Import existing shots into a set',
            })}
            granted={photoGranted}
            onAllow={requestPhoto}
          />
          <PermissionRow
            icon="location-outline"
            title={t('permissions.locationTitle', { defaultValue: 'Location' })}
            description={t('permissions.locationDescription', {
              defaultValue: 'Stamp GPS & address on proof',
            })}
            granted={locationGranted}
            onAllow={requestLocation}
          />
          <PermissionRow
            icon="mic-outline"
            title={t('permissions.microphoneTitle', { defaultValue: 'Microphone' })}
            description={t('permissions.microphoneDescription', {
              defaultValue: 'Record voice notes hands-free',
            })}
            granted={micGranted}
            onAllow={requestMic}
          />
        </View>
      </Animated.View>

      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleAllowAccess}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryButtonText}>
            {t('permissions.allowAccess', { defaultValue: 'Allow access' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostLink} onPress={handleNotNow} activeOpacity={0.7}>
          <Text style={styles.ghostLinkText}>
            {t('permissions.notNow', { defaultValue: 'Not now' })}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function PermissionRow({ icon, title, description, granted, onAllow }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color="#666666" />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDesc} numberOfLines={2}>{description}</Text>
      </View>
      <View style={styles.rowStatus}>
        {granted ? (
          <Ionicons name="checkmark-circle" size={26} color="#34C759" />
        ) : (
          <TouchableOpacity style={styles.allowButton} onPress={onAllow} activeOpacity={0.7}>
            <Text style={styles.allowButtonText}>Allow</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF4C2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  headline: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subhead: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    letterSpacing: -0.1,
    marginBottom: 22,
  },

  rows: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    paddingHorizontal: 12,
    paddingVertical: 14,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  rowDesc: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    color: '#666666',
    lineHeight: 17,
  },
  rowStatus: {
    minWidth: 70,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  allowButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#D0D0D0',
  },
  allowButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
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
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  ghostLink: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  ghostLinkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});

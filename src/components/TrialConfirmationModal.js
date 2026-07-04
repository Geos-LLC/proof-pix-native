import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTheme } from '../hooks/useTheme';

const BASE_TRIAL_DAYS = 15;
const REFERRAL_BONUS_DAYS = 15;

export default function TrialConfirmationModal({ visible, planName, onUseTrial, onCancel, price, platformCancelText }) {
  const [trialDays, setTrialDays] = useState(BASE_TRIAL_DAYS);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    const checkReferral = async () => {
      try {
        const referralData = await AsyncStorage.getItem('@referral_accepted');
        setTrialDays(referralData !== null ? BASE_TRIAL_DAYS + REFERRAL_BONUS_DAYS : BASE_TRIAL_DAYS);
      } catch (error) {
        setTrialDays(BASE_TRIAL_DAYS);
      }
    };

    if (visible) {
      checkReferral();
    }
  }, [visible]);
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Close Button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onCancel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color="#666666" />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>START FREE TRIAL</Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.message}>
              Start your {trialDays}-day free trial of {planName.toLowerCase()} features.
            </Text>
            <Text style={styles.disclosure}>
              {price ? `After your trial ends, you'll be charged ${price}/month. ` : ''}
              Auto-renews unless canceled. {platformCancelText || (Platform.OS === 'android' ? 'Cancel anytime in Google Play > Subscriptions' : 'Cancel anytime in Settings > Subscriptions')}.
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.skipButton]}
              onPress={onCancel}
            >
              <Text style={[styles.buttonText, styles.skipButtonText]}>
                No Thanks
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.startButton]}
              onPress={onUseTrial}
            >
              <Text style={[styles.buttonText, styles.startButtonText]}>
                Start Free Trial
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: theme.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: 20,
    width: '100%',
    maxWidth: 340,
    overflow: 'hidden',
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    zIndex: 1,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingTop: 48,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  message: {
    fontSize: 15,
    color: theme.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
  },
  disclosure: {
    fontSize: 11,
    color: theme.textMuted,
    lineHeight: 16,
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1.5,
    borderColor: theme.border,
  },
  startButton: {
    backgroundColor: '#000000',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
  skipButtonText: {
    color: COLORS.TEXT,
  },
  startButtonText: {
    color: '#FFFFFF',
  },
});


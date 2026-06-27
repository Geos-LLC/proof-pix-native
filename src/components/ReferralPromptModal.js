import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS } from '../constants/fonts';

// Single-purpose modal used by the value-moment ("first report") nudge
// and the expiring-trial nudge. Parent supplies the variant + handlers
// via `prompt`; the modal stays presentation-only so the eligibility/
// analytics logic can live in referralPromptService.
//
// `prompt` shape: { variant: 'first_report' | 'expiring_trial',
//                   daysRemaining?, availableRewards? }
export default function ReferralPromptModal({
  visible,
  prompt,
  onClose,
  onPrimary,
  onSecondary,
}) {
  if (!prompt) return null;

  const variant = prompt.variant;
  const isExpiring = variant === 'expiring_trial';
  const isFirstReport = variant === 'first_report';

  const iconName = isExpiring ? 'time-outline' : 'sparkles-outline';
  const title = isExpiring ? 'Need More Time?' : 'Great Work!';
  const body = isExpiring
    ? 'Your ProofPix trial ends soon.'
    : "You've created your first professional report.";
  const secondary = isExpiring
    ? 'Invite a colleague and both of you will receive 7 extra free trial days.'
    : 'Share ProofPix with another professional and both of you will receive 7 extra free trial days.';
  const primaryLabel = 'Invite Friends';
  const secondaryLabel = isExpiring ? 'Upgrade Now' : 'Maybe Later';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.dragHandle} />

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color="#666666" />
          </TouchableOpacity>

          <View style={styles.iconCircle}>
            <Ionicons name={iconName} size={32} color="#7A5B00" />
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <Text style={styles.secondary}>{secondary}</Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={onPrimary}
          >
            <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            activeOpacity={0.7}
            onPress={onSecondary}
          >
            <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingBottom: 28,
    paddingTop: 8,
    alignItems: 'center',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5E5',
    borderRadius: 2,
    marginBottom: 12,
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF4C2',
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 14,
  },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 22,
    fontWeight: '800',
    color: '#1E1E1E',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '600',
    color: '#1E1E1E',
    textAlign: 'center',
    marginTop: 8,
  },
  secondary: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  primaryBtn: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 5,
  },
  primaryBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});

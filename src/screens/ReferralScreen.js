import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  SafeAreaView,
  Modal,
  Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { logReferralEvent } from '../utils/analytics';
import {
  getOrCreateReferralCode,
  getReferralInfo,
  getReferralLink,
  getShareMessage,
  addReferralInvite,
  initializeReferralCode,
  getReferralStatsFromServer,
  getUserId,
} from '../services/referralService';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

export default function ReferralScreen({ navigation }) {
  const { t } = useTranslation();
  const [referralCode, setReferralCode] = useState('');
  const [referralInfo, setReferralInfo] = useState({
    invitesSent: [],
    rewardsEarned: 0,
    totalMonthsEarned: 0,
  });
  const [serverStats, setServerStats] = useState({
    totalInvites: 0,
    completedInvites: 0,
    pendingInvites: 0,
    monthsEarned: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showInfoModal, setShowInfoModal] = useState(false);

  useEffect(() => {
    loadReferralData();
  }, []);

  const loadReferralData = async () => {
    try {
      // Initialize referral code and register on server
      const code = await initializeReferralCode();
      setReferralCode(code);

      // Get user ID for server stats (this will generate and persist if not exists)
      const userId = await getUserId();

      // Fetch stats from server
      const stats = await getReferralStatsFromServer(userId);
      if (stats) {
        setServerStats({
          totalInvites: stats.totalInvites || 0,
          completedInvites: stats.completedInvites || 0,
          pendingInvites: stats.pendingInvites || 0,
          monthsEarned: stats.monthsEarned || 0,
        });
      }

      // Still load local info for backward compatibility
      const info = await getReferralInfo();
      setReferralInfo(info);
    } catch (error) {
      console.error('[ReferralScreen] Error loading referral data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (method) => {
    try {
      const iosAppStoreLink = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/us/app/proofpix-before-after/id6754261444';
      const androidPlayStoreLink = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix.app';

      await addReferralInvite(method);

      // Analytics: referral invite sent
      try {
        logReferralEvent('sent', {
          code: referralCode,
        });
      } catch (e) {
        // non‑critical
      }

      // Share the instructions message first
      await Share.share({
        message: t('referral.shareIntroMessage', {
          iosLink: iosAppStoreLink,
          androidLink: androidPlayStoreLink,
          defaultValue: `Join ProofPix and get organized!\n\n📱 Download ProofPix:\niOS: ${iosAppStoreLink}\nAndroid: ${androidPlayStoreLink}\n\nAfter installing, use my referral code to get started!`
        }),
        title: t('referral.shareIntroTitle', { defaultValue: 'ProofPix Referral' })
      });

      // After first share completes, ask user if they want to share the code
      Alert.alert(
        t('referral.shareCodePromptTitle', { defaultValue: 'Share Referral Code?' }),
        t('referral.shareCodePromptMessage', {
          defaultValue: 'Now share your referral code as a separate message so they can easily copy it.'
        }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('referral.shareCodeButton', { defaultValue: 'Share Code' }),
            onPress: async () => {
              await Share.share({
                message: referralCode,
                title: t('referral.shareIntroTitle', { defaultValue: 'ProofPix Referral' })
              });
            }
          }
        ]
      );
    } catch (error) {
      console.error('[ReferralScreen] Error sharing:', error);
      Alert.alert(
        t('common.error'),
        t('referral.shareErrorMessage', {
          defaultValue: 'Failed to share referral link. Please try again.'
        })
      );
    }
  };

  const handleCopyLink = async () => {
    try {
      // Copy just the referral code, not the full link
      await Clipboard.setString(referralCode);
      Alert.alert(
        t('referral.copiedTitle', { defaultValue: 'Copied!' }),
        t('referral.copiedMessage', {
          defaultValue: 'Referral code copied to clipboard.'
        })
      );
    } catch (error) {
      console.error('[ReferralScreen] Error copying code:', error);
      Alert.alert(
        t('common.error'),
        t('referral.copyErrorMessage', { defaultValue: 'Failed to copy code.' })
      );
    }
  };

  const getCompletedCount = () => {
    // Use server stats if available, fallback to local
    return serverStats.completedInvites || referralInfo.invitesSent.filter(inv => inv.status === 'completed').length;
  };

  const getMonthsEarned = () => {
    // Use server stats directly (server calculates this for us)
    return serverStats.monthsEarned || 0;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.TEXT} />
          </TouchableOpacity>
          <Text style={styles.title}>
            {t('referral.screenTitle', { defaultValue: 'Invite Friends' })}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>
            {t('referral.loading', { defaultValue: 'Loading...' })}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const completedCount = getCompletedCount();
  const monthsEarned = getMonthsEarned();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={COLORS.TEXT} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {t('referral.screenTitle', { defaultValue: 'Invite Friends' })}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Earn Free Months Section */}
        <View style={styles.earnFreeSection}>
          <View style={styles.earnFreeContent}>
            <Text style={styles.earnFreeTitle}>
              {t('referral.earnFreeMonthsTitle', { defaultValue: 'Earn Free Months!' })}
            </Text>
            <View style={styles.rewardsList}>
              <Text style={styles.rewardText}>
                1 Friend = 1 Month Free!
              </Text>
              <Text style={styles.rewardText}>
                2 Friend = 2 Months Free
              </Text>
              <Text style={styles.rewardText}>
                3+ Friends = 3 Months Free
              </Text>
            </View>
          </View>
          {/* Illustration placeholder - can be replaced with actual image */}
          <View style={styles.illustrationContainer}>
            <Ionicons name="megaphone" size={60} color={COLORS.TEXT} />
          </View>
        </View>

        {/* Referral Code Section */}
        <View style={styles.codeSection}>
          <Text style={styles.codeLabel}>
            {t('referral.codeLabel', { defaultValue: 'Referral Code' })}
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{referralCode}</Text>
            <TouchableOpacity
              style={styles.copyIconButton}
              onPress={async () => {
                await Clipboard.setString(referralCode);
                Alert.alert('Copied!', 'Referral code copied to clipboard.');
              }}
            >
              <Ionicons name="copy-outline" size={20} color={COLORS.TEXT} />
            </TouchableOpacity>
          </View>
          
          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.copyLinkButton}
              onPress={handleCopyLink}
            >
              <Text style={styles.copyLinkButtonText}>
                {t('referral.copyLinkButton', { defaultValue: 'Copy Link' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shareCodeButton}
              onPress={() => handleShare('general')}
            >
              <Text style={styles.shareCodeButtonText}>
                {t('referral.shareCodeButton', { defaultValue: 'Share Code' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Progress Cards */}
        <View style={styles.progressCards}>
          <View style={styles.progressCard}>
            <Ionicons name="people" size={24} color={COLORS.TEXT} />
            <Text style={styles.progressCardValue}>
              {completedCount} out of {Math.max(completedCount, 1)}
            </Text>
            <Text style={styles.progressCardLabel}>
              {t('referral.statFriendsJoined', { defaultValue: 'Friends Joined' })}
            </Text>
          </View>
          <View style={styles.progressCard}>
            <Ionicons name="trophy" size={24} color={COLORS.TEXT} />
            <Text style={styles.progressCardValue}>
              {monthsEarned} {monthsEarned === 1 ? 'Month' : 'Months'}
            </Text>
            <Text style={styles.progressCardLabel}>
              {t('referral.statMonthsEarned', { defaultValue: 'Months earned' })}
            </Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBarSection}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min((completedCount / 3) * 100, 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {completedCount} of 3 friends invited
          </Text>
        </View>

      </ScrollView>

      {/* Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowInfoModal(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {/* Drag Handle */}
            <View style={styles.dragHandle} />
            
            {/* Header */}
            <View style={styles.modalHeader}>
              {/* Close Button - Top Left */}
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowInfoModal(false)}
              >
                <View style={styles.closeButtonCircle}>
                  <Ionicons name="close" size={20} color="#666666" />
                </View>
              </TouchableOpacity>
              
              {/* Title - Centered */}
              <Text style={styles.modalTitle}>How It Works</Text>
              
              {/* Spacer to balance the close button */}
              <View style={styles.headerSpacer} />
            </View>
            
            {/* Content */}
            <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScrollContent}>
              <Text style={styles.modalText}>
                Share the app with friends and get rewarded! When your friend installs and sets up the app, you'll earn 1–3 months of free access. The more friends you invite, the more free months you get.
              </Text>
              
              <View style={styles.modalNote}>
                <Text style={styles.modalNoteText}>
                  ⚠️ Important: Your friend must complete the app setup (name, plan selection, and account connection) for the referral to count and for you to earn rewards.
                </Text>
              </View>
              
              <Text style={styles.modalSubtitle}>Benefits</Text>
              <View style={styles.modalBenefitItem}>
                <Text style={styles.modalBenefitIcon}>✓</Text>
                <Text style={styles.modalBenefitText}>Easy to Share: Send a unique referral link via WhatsApp, email, SMS, or social media.</Text>
              </View>
              <View style={styles.modalBenefitItem}>
                <Text style={styles.modalBenefitIcon}>✓</Text>
                <Text style={styles.modalBenefitText}>Automatic Tracking: Your invite is tracked automatically, so rewards are applied instantly.</Text>
              </View>
              <View style={styles.modalBenefitItem}>
                <Text style={styles.modalBenefitIcon}>✓</Text>
                <Text style={styles.modalBenefitText}>No Extra Cost: Rewards are free and only require your friends to set up the app.</Text>
              </View>
            </ScrollView>
            
            {/* Action Button */}
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowInfoModal(false)}
            >
              <Text style={styles.modalButtonText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.PRIMARY,
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.TEXT,
    fontSize: 16,
  },
  earnFreeSection: {
    marginBottom: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  earnFreeContent: {
    flex: 1,
    marginRight: 16,
  },
  earnFreeTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 16,
    letterSpacing: -0.5,
  },
  rewardsList: {
    gap: 8,
  },
  rewardText: {
    fontSize: 16,
    color: '#000000',
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  illustrationContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeSection: {
    marginBottom: 32,
  },
  codeLabel: {
    fontSize: 16,
    color: '#000000',
    marginBottom: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  codeText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: 2,
    fontFamily: FONTS.ALEXANDRIA,
  },
  copyIconButton: {
    padding: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  copyLinkButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyLinkButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '600',
  },
  shareCodeButton: {
    flex: 1,
    backgroundColor: '#000000',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCodeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  progressCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  progressCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  progressCardValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  progressCardLabel: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },
  progressBarSection: {
    marginBottom: 24,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  ctaButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  ctaButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5E5',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    position: 'relative',
  },
  modalCloseButton: {
    position: 'absolute',
    left: 20,
    top: 0,
    zIndex: 1,
  },
  closeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
  },
  headerSpacer: {
    width: 32,
  },
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  modalText: {
    fontSize: 16,
    color: COLORS.TEXT,
    lineHeight: 24,
    marginBottom: 16,
  },
  modalNote: {
    backgroundColor: '#FFF3CD',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.PRIMARY,
  },
  modalNoteText: {
    fontSize: 14,
    color: COLORS.TEXT,
    lineHeight: 20,
  },
  modalSubtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 12,
    marginTop: 8,
    fontFamily: FONTS.ALEXANDRIA,
  },
  modalBenefitItem: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  modalBenefitIcon: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    marginRight: 12,
    marginTop: 2,
  },
  modalBenefitText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.TEXT,
    lineHeight: 20,
  },
  modalButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
});


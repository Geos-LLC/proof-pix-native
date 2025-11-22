import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Clipboard,
  Alert,
  SafeAreaView,
  Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
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
      const iosAppStoreLink = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/app/proofpix';
      const androidPlayStoreLink = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix';

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
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {t('referral.screenTitle', { defaultValue: 'Invite Friends' })}
          </Text>
          <View style={{ width: 60 }} />
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
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {t('referral.screenTitle', { defaultValue: 'Invite Friends' })}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Rewards Info */}
        <View style={styles.rewardsSection}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, styles.earnFreeMonthsTitle]}>
              {t('referral.earnFreeMonthsTitle', { defaultValue: 'Earn Free Months!' })}
            </Text>
            <TouchableOpacity
              style={styles.infoButton}
              onPress={() => setShowInfoModal(true)}
            >
              <Text style={styles.infoIcon}>ℹ️</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.rewardItem}>
            <Text style={styles.rewardText}>
              {t('referral.rewardLine1', { defaultValue: '1 friend → +1 month free' })}
            </Text>
          </View>
          <View style={styles.rewardItem}>
            <Text style={styles.rewardText}>
              {t('referral.rewardLine2', { defaultValue: '2 friends → +2 months free' })}
            </Text>
          </View>
          <View style={styles.rewardItem}>
            <Text style={styles.rewardText}>
              {t('referral.rewardLine3', { defaultValue: '3+ friends → +3 months free' })}
            </Text>
          </View>
        </View>

        {/* Referral Code */}
        <View style={styles.codeSection}>
          <Text style={styles.codeLabel}>
            {t('referral.codeLabel', { defaultValue: 'Your Referral Code' })}
          </Text>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText}>{referralCode}</Text>
            <TouchableOpacity
              style={styles.copyButton}
              onPress={handleCopyLink}
            >
              <Text style={styles.copyButtonText}>
                {t('referral.copyLinkButton', { defaultValue: 'Copy Link' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Share Code Button */}
        <View style={styles.shareSection}>
          <TouchableOpacity
            style={styles.shareCodeButton}
            onPress={() => handleShare('general')}
          >
            <Text style={styles.shareCodeButtonText}>
              {t('referral.shareCodeButton', { defaultValue: 'Share Code' })}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress Tracker */}
        <View style={styles.progressSection}>
          <Text style={styles.sectionTitle}>
            {t('referral.progressTitle', { defaultValue: 'Your Progress' })}
          </Text>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min((completedCount / 3) * 100, 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {t('referral.progressText', {
                completed: completedCount,
                defaultValue: `${completedCount} of 3 friends invited`
              })}
            </Text>
          </View>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{completedCount}</Text>
              <Text style={styles.statLabel}>
                {t('referral.statFriendsJoined', { defaultValue: 'Friends Joined' })}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{monthsEarned}</Text>
              <Text style={styles.statLabel}>
                {t('referral.statMonthsEarned', { defaultValue: 'Months Earned' })}
              </Text>
            </View>
          </View>
        </View>

      </ScrollView>

      {/* Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>How It Works</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowInfoModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
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
            
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowInfoModal(false)}
            >
              <Text style={styles.modalButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    width: 60,
    alignItems: 'flex-start',
  },
  backButtonText: {
    fontSize: 24,
    color: COLORS.PRIMARY,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
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
    fontFamily: FONTS.QUICKSAND_BOLD,
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
  headlineSection: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 12,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  description: {
    fontSize: 16,
    color: COLORS.TEXT,
    lineHeight: 24,
  },
  benefitsSection: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
    flex: 1,
  },
  earnFreeMonthsTitle: {
    color: '#4CAF50',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  infoButton: {
    padding: 4,
    marginLeft: 8,
  },
  infoIcon: {
    fontSize: 20,
    color: COLORS.PRIMARY,
  },
  benefitItem: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  benefitIcon: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    marginRight: 12,
    marginTop: 2,
  },
  benefitText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.TEXT,
    lineHeight: 20,
  },
  rewardsSection: {
    marginBottom: 24,
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  rewardItem: {
    marginBottom: 8,
  },
  rewardText: {
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '500',
    backgroundColor: 'transparent',
  },
  codeSection: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  codeLabel: {
    fontSize: 16,
    color: COLORS.TEXT,
    marginBottom: 8,
    fontWeight: '500',
  },
  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  codeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.PRIMARY,
    fontFamily: FONTS.QUICKSAND_BOLD,
    letterSpacing: 2,
  },
  copyButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  copyButtonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  shareSection: {
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  shareCodeButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCodeButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  progressSection: {
    marginTop: 8,
    marginBottom: 24,
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  progressBarContainer: {
    marginBottom: 16,
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
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: COLORS.TEXT,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.PRIMARY,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginTop: 4,
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
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalCloseText: {
    fontSize: 24,
    color: COLORS.TEXT,
    fontWeight: 'bold',
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
    fontFamily: FONTS.QUICKSAND_BOLD,
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
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
});


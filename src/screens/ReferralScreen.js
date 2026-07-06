import React, { useState, useEffect, useMemo } from 'react';
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
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { logReferralEvent, logAdminReferralConversion } from '../utils/analytics';
import {
  getOrCreateReferralCode,
  getReferralInfo,
  getReferralLink,
  getShareMessage,
  addReferralInvite,
  initializeReferralCode,
  getReferralStatsFromServer,
  getUserId,
  trackReferralInstallation,
} from '../services/referralService';
import { markReferralScreenOpened } from '../services/referralPromptService';
import { useTheme } from '../hooks/useTheme';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';

export default function ReferralScreen({ navigation, route }) {
  const { t } = useTranslation();
  const [referralCode, setReferralCode] = useState('');
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
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
  const [showEnterCodeModal, setShowEnterCodeModal] = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [hasAcceptedReferral, setHasAcceptedReferral] = useState(false);

  useEffect(() => {
    loadReferralData();
    // Mark + log that the user reached the permanent referral entry;
    // suppresses the value-moment nudge from re-firing later.
    markReferralScreenOpened().catch(() => {});
  }, []);

  // Fire `screen_opened` once stats are loaded so we can attach the
  // new spec-required properties (bonus_days_awarded, remaining_rewards,
  // trial_length_days).
  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        const { TRIAL_DURATION_DAYS, REFERRAL_BONUS_DAYS, MAX_REFERRALS } = await import('../services/trialService');
        const completed = serverStats?.completedInvites || 0;
        const remaining = Math.max(0, (MAX_REFERRALS || 3) - completed);
        const bonusDays = completed * (REFERRAL_BONUS_DAYS || 7);
        const referralData = await AsyncStorage.getItem('@referral_accepted');
        const referredSignup = referralData !== null;
        const trialLength = referredSignup
          ? (TRIAL_DURATION_DAYS || 7) + (REFERRAL_BONUS_DAYS || 7)
          : (TRIAL_DURATION_DAYS || 7);
        logReferralEvent('screen_opened', {
          code: referralCode || null,
          bonus_days_awarded: bonusDays,
          remaining_referral_rewards: remaining,
          trial_length_days: trialLength,
          referred_signup: referredSignup,
        });
      } catch (e) {
        // non-critical
      }
    })();
  }, [loading]);

  // Handle referral code from deep link (proofpix://referral/CODE)
  useEffect(() => {
    const incomingCode = route?.params?.code;
    if (incomingCode && incomingCode !== referralCode) {
      console.log('[ReferralScreen] Referral code received via deep link:', incomingCode);
      const applyReferral = async () => {
        try {
          const result = await trackReferralInstallation(incomingCode);
          if (result?.success) {
            Alert.alert(
              t('referral.appliedTitle', { defaultValue: '14-Day Trial Activated' }),
              t('referral.appliedMessage', { defaultValue: 'You joined ProofPix through a referral and received 7 additional free trial days.' })
            );
          } else if (result?.error?.includes('already used')) {
            Alert.alert(
              t('referral.alreadyUsedTitle', { defaultValue: 'Already Applied' }),
              t('referral.alreadyUsedMessage', { defaultValue: 'A referral code has already been applied to your account.' })
            );
          } else {
            // User referral not found — try admin referral code
            const { redeemAdminReferralCode, hasRedeemedAdminReferral, markAdminReferralRedeemed } = await import('../services/adminReferralService');
            const alreadyRedeemed = await hasRedeemedAdminReferral();
            if (alreadyRedeemed) {
              Alert.alert(
                t('referral.alreadyUsedTitle', { defaultValue: 'Already Applied' }),
                t('referral.alreadyUsedMessage', { defaultValue: 'A referral code has already been applied to your account.' })
              );
              return;
            }
            const userId = await getUserId();
            const adminResult = await redeemAdminReferralCode(incomingCode, userId);
            if (adminResult?.success && adminResult?.grantedDays > 0) {
              const { extendTrial } = await import('../services/trialService');
              await extendTrial(adminResult.grantedDays);
              await markAdminReferralRedeemed();
              logReferralEvent('admin_link_redeemed', { code: incomingCode, link_type: 'admin', channel: adminResult.channel, source: adminResult.source, campaign: adminResult.campaign, days_added: adminResult.grantedDays });
              logAdminReferralConversion({ code: incomingCode, link_type: 'admin', channel: adminResult.channel, source: adminResult.source, campaign: adminResult.campaign, placement: adminResult.placement, label: adminResult.label, days_added: adminResult.grantedDays });
              Alert.alert(
                t('referral.appliedTitle', { defaultValue: '14-Day Trial Activated' }),
                t('referral.appliedMessage', { defaultValue: `You've received ${adminResult.grantedDays} extra days free!` })
              );
            }
          }
        } catch (error) {
          console.error('[ReferralScreen] Error applying referral code:', error);
        }
      };
      applyReferral();
    }
  }, [route?.params?.code]);

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

      // Hide the "Have a referral code?" entry once a code is on file —
      // device can only redeem one referral code per the proxy rules.
      const accepted = await AsyncStorage.getItem('@referral_accepted');
      setHasAcceptedReferral(accepted !== null);
    } catch (error) {
      console.error('[ReferralScreen] Error loading referral data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyEnteredCode = async () => {
    const code = enteredCode.trim().toUpperCase();
    if (!code) return;
    if (code === referralCode) {
      Alert.alert(
        t('referral.ownCodeTitle', { defaultValue: 'That\'s your own code' }),
        t('referral.ownCodeMessage', {
          defaultValue: 'You can\'t apply your own referral code. Share it with a colleague instead.',
        }),
      );
      return;
    }
    setApplyingCode(true);
    try {
      const result = await trackReferralInstallation(code);
      if (result?.success) {
        setShowEnterCodeModal(false);
        setEnteredCode('');
        setHasAcceptedReferral(true);
        Alert.alert(
          t('referral.appliedTitle', { defaultValue: '14-Day Trial Activated' }),
          t('referral.appliedMessage', {
            defaultValue: 'You joined ProofPix through a referral and received 7 additional free trial days.',
          }),
        );
        return;
      }

      // Fall back to admin-marketing referrals so flyer/QR codes resolve too
      const { redeemAdminReferralCode, hasRedeemedAdminReferral, markAdminReferralRedeemed } =
        await import('../services/adminReferralService');
      const alreadyAdmin = await hasRedeemedAdminReferral();
      if (!alreadyAdmin) {
        const userId = await getUserId();
        const adminResult = await redeemAdminReferralCode(code, userId);
        if (adminResult?.success && adminResult?.grantedDays > 0) {
          const { extendTrial } = await import('../services/trialService');
          await extendTrial(adminResult.grantedDays);
          await markAdminReferralRedeemed();
          logReferralEvent('admin_link_redeemed', {
            code,
            link_type: 'admin',
            channel: adminResult.channel,
            source: adminResult.source,
            campaign: adminResult.campaign,
            days_added: adminResult.grantedDays,
          });
          logAdminReferralConversion({
            code,
            link_type: 'admin',
            channel: adminResult.channel,
            source: adminResult.source,
            campaign: adminResult.campaign,
            placement: adminResult.placement,
            label: adminResult.label,
            days_added: adminResult.grantedDays,
          });
          setShowEnterCodeModal(false);
          setEnteredCode('');
          setHasAcceptedReferral(true);
          Alert.alert(
            t('referral.appliedTitle', { defaultValue: '14-Day Trial Activated' }),
            t('referral.appliedMessage', {
              defaultValue: `You've received ${adminResult.grantedDays} extra days free!`,
            }),
          );
          return;
        }
      }

      // Both lookups failed — surface the most useful error message
      let errorMessage = t('referral.invalidCodeMessage', {
        defaultValue: 'Invalid referral code. Please check and try again.',
      });
      if (result?.error?.includes('already used a referral code')) {
        errorMessage = t('referral.alreadyUsedMessage', {
          defaultValue: 'A referral code has already been applied to this device.',
        });
      } else if (result?.error?.includes('Invalid referral code')) {
        errorMessage = t('referral.codeDoesNotExistMessage', {
          defaultValue: "This referral code doesn't exist. Double-check with your friend.",
        });
      } else if (result?.error) {
        errorMessage = result.error;
      }
      Alert.alert(
        t('referral.unableToApplyTitle', { defaultValue: 'Unable to Apply Code' }),
        errorMessage,
      );
    } catch (error) {
      console.error('[ReferralScreen] Error applying entered code:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('referral.applyErrorMessage', {
          defaultValue: 'Could not apply the code. Check your connection and try again.',
        }),
      );
    } finally {
      setApplyingCode(false);
    }
  };

  const handleShare = async (method) => {
    try {
      const iosAppStoreLink = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/us/app/proofpix-before-after/id6754261444';
      const androidPlayStoreLink = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix.app';

      await addReferralInvite(method);

      // Analytics: referral invite sent
      try {
        logReferralEvent('share_clicked', { code: referralCode, method });
        logReferralEvent('sent', {
          code: referralCode,
        });
      } catch (e) {
        // non‑critical
      }

      const deepLink = `https://steadfast-blessing-production.up.railway.app/referral/${referralCode}`;

      await Share.share({
        message: t('referral.shareMessage', {
          code: referralCode,
          iosLink: iosAppStoreLink,
          androidLink: androidPlayStoreLink,
          deepLink: deepLink,
          defaultValue: `Join ProofPix and get organized!\n\nAlready have the app? Tap here:\n${deepLink}\n\n📱 Download ProofPix:\niOS: ${iosAppStoreLink}\nAndroid: ${androidPlayStoreLink}\n\n🎁 Use my referral code: ${referralCode}\nYou'll get a 14-day free trial!`
        }),
        title: t('referral.shareIntroTitle', { defaultValue: 'ProofPix Referral' })
      });
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
      try {
        logReferralEvent('link_copied', { code: referralCode, method: 'copy_link_button' });
      } catch (e) {
        // non-critical
      }
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
            <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
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
          <Ionicons name="arrow-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {t('referral.screenTitle', { defaultValue: 'Invite Friends' })}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Hero — spec-aligned wording: position the screen as a way
            to earn extra trial time rather than as a generic "free days"
            growth tile. */}
        <View style={styles.earnFreeSection}>
          <View style={styles.earnFreeContent}>
            <Text style={styles.earnFreeTitle}>
              {t('referral.earnFreeTitle', { defaultValue: 'Invite Professionals.\nEarn More Time.' })}
            </Text>
            <Text style={styles.earnFreeSubtitle}>
              {t('referral.earnFreeSubtitle', {
                defaultValue: 'Invite a colleague and both of you will receive 7 extra free trial days. Earn up to 21 bonus days.',
              })}
            </Text>
            <View style={styles.rewardsList}>
              <Text style={styles.rewardText}>
                {t('referral.tier1', { defaultValue: '1 Friend = 7 Days Free' })}
              </Text>
              <Text style={styles.rewardText}>
                {t('referral.tier2', { defaultValue: '2 Friends = 14 Days Free' })}
              </Text>
              <Text style={styles.rewardText}>
                {t('referral.tier3', { defaultValue: '3 Friends = 21 Days Free' })}
              </Text>
            </View>
          </View>
          {/* Illustration placeholder - can be replaced with actual image */}
          <View style={styles.illustrationContainer}>
            <Ionicons name="megaphone" size={60} color={theme.textPrimary} />
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
                try {
                  logReferralEvent('link_copied', { code: referralCode, method: 'inline_copy_chip' });
                } catch (e) {
                  // non-critical
                }
                Alert.alert('Copied!', 'Referral code copied to clipboard.');
              }}
            >
              <Ionicons name="copy-outline" size={14} color="#1E1E1E" />
              <Text style={styles.copyIconButtonText}>Copy</Text>
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

          {/* Receiving-side entry — a colleague gave you a code. Hidden
              once a code is on file (one redemption per device, server-
              enforced). Deep-link redemption still auto-applies without
              this entry. */}
          {!hasAcceptedReferral && (
            <TouchableOpacity
              style={styles.haveCodeRow}
              onPress={() => setShowEnterCodeModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="ticket-outline" size={16} color="#7A5B00" />
              <Text style={styles.haveCodeText}>
                {t('referral.haveCodeCTA', { defaultValue: 'Have a referral code from a colleague?' })}
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#9A9A9A" />
            </TouchableOpacity>
          )}
        </View>

        {/* Progress Cards */}
        <View style={styles.progressCards}>
          <View style={styles.progressCard}>
            <Ionicons name="people" size={24} color={theme.textPrimary} />
            <Text style={styles.progressCardValue}>
              {completedCount} out of 3
            </Text>
            <Text style={styles.progressCardLabel}>
              {t('referral.statFriendsJoined', { defaultValue: 'Friends Joined' })}
            </Text>
          </View>
          <View style={styles.progressCard}>
            <Ionicons name="trophy" size={24} color={theme.textPrimary} />
            <Text style={styles.progressCardValue}>
              {monthsEarned * 7} {monthsEarned * 7 === 1 ? 'Day' : 'Days'}
            </Text>
            <Text style={styles.progressCardLabel}>
              {t('referral.statDaysEarned', { defaultValue: 'Days earned' })}
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
          {completedCount < 3 && (
            <Text style={styles.remainingRewardsText}>
              {`${(3 - completedCount) * 7} bonus days still available — invite ${3 - completedCount} more ${3 - completedCount === 1 ? 'professional' : 'professionals'}.`}
            </Text>
          )}
        </View>

      </ScrollView>

      {/* Enter-referral-code Modal — receiving-side entry */}
      <Modal
        visible={showEnterCodeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEnterCodeModal(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalOverlay} onPress={() => setShowEnterCodeModal(false)}>
            <Pressable style={styles.enterCodeSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.dragHandle} />
              <View style={styles.modalHeader}>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => setShowEnterCodeModal(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <View style={styles.closeButtonCircle}>
                    <Ionicons name="close" size={20} color={theme.textSecondary} />
                  </View>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>
                  {t('referral.enterCodeTitle', { defaultValue: 'Enter Referral Code' })}
                </Text>
                <View style={styles.headerSpacer} />
              </View>

              <View style={styles.enterCodeBody}>
                <Text style={styles.enterCodeSubtitle}>
                  {t('referral.enterCodeSubtitle', {
                    defaultValue: 'Got an 8-character code from a colleague? Enter it here to claim a 14-day free trial.',
                  })}
                </Text>

                <TextInput
                  style={styles.enterCodeInput}
                  value={enteredCode}
                  onChangeText={(text) => setEnteredCode(text.toUpperCase().replace(/\s/g, ''))}
                  placeholder={t('referral.codePlaceholder', { defaultValue: 'ENTER CODE' })}
                  placeholderTextColor="#999"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                  editable={!applyingCode}
                />
              </View>

              <TouchableOpacity
                style={[styles.applyCodeButton, (!enteredCode.trim() || applyingCode) && styles.applyCodeButtonDisabled]}
                onPress={handleApplyEnteredCode}
                disabled={!enteredCode.trim() || applyingCode}
                activeOpacity={0.85}
              >
                <Text style={styles.applyCodeButtonText}>
                  {applyingCode
                    ? t('referral.applying', { defaultValue: 'Applying…' })
                    : t('referral.applyCode', { defaultValue: 'Apply Code' })}
                </Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

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
                Share the app with friends and get rewarded! When your friend installs and sets up the app, both of you earn 7 extra trial days. Invite up to 3 friends to earn up to 21 bonus days.
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

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surfaceElevated,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.surfaceElevated,
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
    color: theme.textPrimary,
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
    backgroundColor: theme.surfaceElevated,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: theme.surfaceElevated,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: theme.textPrimary,
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
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    marginBottom: 8,
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  earnFreeSubtitle: {
    fontSize: 13,
    color: theme.textSecondary,
    marginBottom: 14,
    lineHeight: 18,
  },
  rewardsList: {
    gap: 8,
  },
  rewardText: {
    fontSize: 16,
    color: theme.textPrimary,
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
    color: theme.textPrimary,
    marginBottom: 12,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  // Refresh pass 8 — design screenshot 36 shows the code box with a soft
  // yellow fill (#FFF4C2 accent-soft) + dashed accent border. Tighter
  // padding and the code text colored in accent-ink (#7A5B00) so it
  // reads as branded type rather than plain black.
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF4C2',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    borderStyle: 'dashed',
  },
  codeText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#7A5B00',
    letterSpacing: 2,
    fontFamily: FONTS.ALEXANDRIA,
  },
  // Refresh pass 8 — design screenshot 36 shows the copy button inside
  // the code box as a small yellow pill ("📋 Copy") rather than a bare
  // icon. Same tap target, more discoverable.
  copyIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F2C31B',
  },
  copyIconButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  // Refresh: Copy = ghost (1.5px borderStrong), Share = dark primary.
  // Both shorter (42px) per the design's `.pp-btn.sm` spec.
  copyLinkButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    borderRadius: 13,
    height: 42,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyLinkButtonText: {
    color: theme.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  shareCodeButton: {
    flex: 1,
    backgroundColor: theme.mode === 'dark' ? theme.accent : '#1E1E1E',
    borderRadius: 13,
    height: 42,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCodeButtonText: {
    color: theme.mode === 'dark' ? theme.accentText : '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  haveCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#F2C31B',
  },
  haveCodeText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  enterCodeSheet: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    width: '100%',
  },
  enterCodeBody: {
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 20,
  },
  enterCodeSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 18,
  },
  enterCodeInput: {
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 20,
    fontWeight: '800',
    color: theme.textPrimary,
    textAlign: 'center',
    letterSpacing: 3,
  },
  applyCodeButton: {
    marginHorizontal: 24,
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.mode === 'dark' ? theme.accent : '#1E1E1E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyCodeButtonDisabled: {
    backgroundColor: theme.borderStrong,
  },
  applyCodeButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
    color: theme.mode === 'dark' ? theme.accentText : '#FFFFFF',
    letterSpacing: -0.1,
  },
  progressCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  // Refresh: progress card uses the design's shadow-card recipe — soft
  // shadow + hairline border + radius 18.
  progressCard: {
    flex: 1,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  progressCardValue: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.textPrimary,
    textAlign: 'center',
  },
  progressCardLabel: {
    fontSize: 12,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  progressBarSection: {
    marginBottom: 24,
  },
  progressBar: {
    height: 8,
    backgroundColor: theme.surface,
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
    color: theme.textSecondary,
    textAlign: 'center',
  },
  remainingRewardsText: {
    fontSize: 12,
    color: '#7A5B00',
    textAlign: 'center',
    marginTop: 6,
    fontWeight: '600',
  },
  // Refresh: primary CTA per design — 52px height, radius 16, warm pop-shadow.
  ctaButton: {
    backgroundColor: COLORS.PRIMARY,
    height: 52,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  ctaButtonText: {
    color: theme.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONTS.ALEXANDRIA,
    letterSpacing: -0.1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.borderStrong,
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
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
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
    color: theme.textPrimary,
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
    color: '#7A5B00',
    lineHeight: 20,
  },
  modalSubtitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.textPrimary,
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
    color: theme.textPrimary,
    lineHeight: 20,
  },
  modalButton: {
    backgroundColor: theme.mode === 'dark' ? theme.accent : '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    color: theme.mode === 'dark' ? theme.accentText : '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.ALEXANDRIA,
  },
});


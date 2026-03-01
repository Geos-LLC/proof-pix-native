import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
  Linking,
  InteractionManager,
  Dimensions,
  Modal,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Fallback component for LinearGradient if native module isn't available
const GradientView = ({ colors, start, end, style, children, fallbackColor }) => {
  if (LinearGradient && typeof LinearGradient === 'function') {
    return (
      <LinearGradient colors={colors} start={start} end={end} style={style}>
        {children}
      </LinearGradient>
    );
  }
  
  return (
    <View style={[style, { backgroundColor: fallbackColor || colors[colors.length - 1] }]}>
      {children}
    </View>
  );
};

import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import TrialNotificationModal from '../components/TrialNotificationModal';
import { canStartTrial, startTrial } from '../services/trialService';
import { getNotificationToShow } from '../services/trialNotificationService';
import { IAP_PRODUCTS, purchaseProduct, purchaseOrUpgrade, restorePurchases, getAvailablePurchases, diagnoseIAPState, productIdToPlan } from '../services/iapService';

const { width } = Dimensions.get('window');

export default function PlanSelectionScreen({ navigation }) {
  const { t } = useTranslation();
  const { userPlan, updateUserPlan } = useSettings();
  const { updatePlanLimit } = useAdmin();
  const insets = useSafeAreaInsets();

  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [trialAvailable, setTrialAvailable] = useState(true);
  const baseTrial = Platform.OS === 'android' ? 14 : 30;
  const referralBonus = 15;
  const [trialDays, setTrialDays] = useState(baseTrial);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [trialNotification, setTrialNotification] = useState(null);
  const [showTrialConfirmation, setShowTrialConfirmation] = useState(false);
  const [selectedPlanForTrial, setSelectedPlanForTrial] = useState(null);
  const hasShownTrialNotification = useRef(false);
  const isMounted = useRef(true);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  const isPurchasing = useRef(false);

  useEffect(() => {
    console.log('[PlanSelection] 🔵 Component mounted, isMounted set to true');
    isMounted.current = true;

    const checkTrialAvailability = async () => {
      try {
        // Always show trial modal for now - comment out the service check
        // const available = await canStartTrial();
        // if (isMounted.current) {
        //   setTrialAvailable(available);
        // }
        
        // Keep trial available as true (set in initial state)
        if (isMounted.current) {
          setTrialAvailable(true);
        }

        try {
          const AsyncStorage = await import('@react-native-async-storage/async-storage');
          const referralData = await AsyncStorage.default.getItem('@referral_accepted');
          if (isMounted.current) {
            setTrialDays(referralData !== null ? baseTrial + referralBonus : baseTrial);
          }
        } catch (error) {
          if (isMounted.current) {
            setTrialDays(baseTrial);
          }
        }
      } catch (error) {
        console.error('[PlanSelection] Error checking trial availability:', error);
        if (isMounted.current) {
          setTrialAvailable(true);
          setTrialDays(baseTrial);
        }
      }
    };
    checkTrialAvailability();

    if (isMounted.current) {
      setShowTrialModal(false);
    }

    return () => {
      console.log('[PlanSelection] 🔴 Component unmounting, isMounted set to false');
      isMounted.current = false;
    };
  }, []);

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleSelectPlan = async (plan) => {
    if (plan === 'starter') {
      await proceedWithPlanSelection(plan, false);
      return;
    }

    if (trialAvailable && plan !== 'enterprise') {
      setSelectedPlanForTrial(plan);
      setShowTrialConfirmation(true);
      return;
    }

    await proceedWithPlanSelection(plan, false);
  };

  const proceedWithPlanSelection = async (plan, useTrial = false) => {
    if (isPurchasing.current) {
      console.log('[PlanSelection] ⚠️ Purchase already in progress, ignoring duplicate request');
      return;
    }
    
    isPurchasing.current = true;
    console.log('[PlanSelection] 🟢 proceedWithPlanSelection START - plan:', plan, 'useTrial:', useTrial);
    
    try {
      let trialJustStarted = false;

      setShowTrialModal(false);
      setShowTrialConfirmation(false);
      setTrialNotification(null);

      if (useTrial) {
        console.log('[PlanSelection] 🟡 Using trial flow');
        try {
          console.log('[PlanSelection] 🟡 Calling startTrial...');
          await startTrial(plan);
          console.log('[PlanSelection] 🟡 startTrial completed, calling updateUserPlan...');
          await updateUserPlan(plan);
          console.log('[PlanSelection] 🟡 updateUserPlan completed');
          trialJustStarted = true;
        } catch (error) {
          console.error('[PlanSelection] ❌ Error starting trial:', error);
          await updateUserPlan(plan);
        }
      } else {
        console.log('[PlanSelection] Regular plan flow (no trial)');
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
          let productId = null;
          if (plan === 'pro') productId = IAP_PRODUCTS.PRO_MONTHLY;
          else if (plan === 'business') productId = IAP_PRODUCTS.BUSINESS_MONTHLY;
          else if (plan === 'enterprise') productId = IAP_PRODUCTS.ENTERPRISE_MONTHLY;

          console.log('[PlanSelection] Selected plan:', plan, 'Product ID:', productId);

          if (productId) {
            try {
              console.log('[PlanSelection] Starting purchase for:', productId);
              const purchaseResult = await purchaseOrUpgrade(productId);
              console.log('[PlanSelection] Purchase successful');
              await updateUserPlan(plan);

              return new Promise((resolve) => {
                InteractionManager.runAfterInteractions(() => {
                  console.log('[PlanSelection] Navigating after successful purchase');
                  isMounted.current = false;
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                  resolve();
                });
              });
            } catch (err) {
              console.log('[PlanSelection] Purchase error caught:', err?.message);

              const errorMsg = err?.message || '';
              if (errorMsg === 'USER_CANCELLED' || errorMsg === 'user-cancelled' || errorMsg.includes('cancelled') || errorMsg.includes('canceled')) {
                console.log('[PlanSelection] User cancelled purchase');
                isPurchasing.current = false;
                return;
              }

              if (errorMsg === 'already-owned') {
                await updateUserPlan(plan);

                Alert.alert(
                  t('common.success', { defaultValue: 'Already Subscribed' }),
                  t('settings.alreadySubscribed', { defaultValue: 'You already have an active subscription to this plan!' })
                );

                return new Promise((resolve) => {
                  InteractionManager.runAfterInteractions(() => {
                    isMounted.current = false;
                    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                    resolve();
                  });
                });
              }

              Alert.alert(
                t('common.error', { defaultValue: 'Error' }),
                `Purchase failed: ${errorMsg || 'Unknown error'}. Please try again.`
              );
              isPurchasing.current = false;
              return;
            }
          }
        }

        await updateUserPlan(plan);
      }

      console.log('[PlanSelection] Plan selection complete, navigating...');
      return new Promise((resolve) => {
        InteractionManager.runAfterInteractions(() => {
          isMounted.current = false;
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          resolve();
        });
      });
    } catch (error) {
      console.error('[PlanSelection] ❌ Error in proceedWithPlanSelection:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('common.genericError', { defaultValue: 'Something went wrong. Please try again.' })
      );
    } finally {
      isPurchasing.current = false;
    }
  };

  const handleUseTrial = async () => {
    if (selectedPlanForTrial) {
      await proceedWithPlanSelection(selectedPlanForTrial, true);
    }
  };

  const handleCancelTrial = async () => {
    setShowTrialConfirmation(false);
    if (selectedPlanForTrial) {
      await proceedWithPlanSelection(selectedPlanForTrial, false);
    }
  };

  const handleTrialModalClose = () => {
    setShowTrialModal(false);
  };

  const handleTrialUpgrade = () => {
    setShowTrialModal(false);
  };

  const handleTrialRefer = () => {
    setShowTrialModal(false);
    navigation.reset({ index: 0, routes: [{ name: 'Settings', params: { openReferral: true } }] });
  };

  const handleRestorePurchases = async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

    setIsRestoringPurchases(true);
    try {
      console.log('[PlanSelection] Restoring purchases...');

      const purchases = await restorePurchases();

      if (!purchases || purchases.length === 0) {
        Alert.alert(
          t('common.info', { defaultValue: 'No Purchases Found' }),
          t('settings.noPurchasesFound', { defaultValue: 'No active subscriptions found. If you recently purchased, please wait a moment and try again.' })
        );
        setIsRestoringPurchases(false);
        return;
      }

      // Find an active purchase - v14: if returned by getAvailablePurchases, it's active
      const activePurchase = purchases.find(p => !!p.productId);

      if (activePurchase) {
        const restoredPlan = productIdToPlan(activePurchase.productId);

        console.log('[PlanSelection] Restored active plan:', restoredPlan);
        await updateUserPlan(restoredPlan);

        setIsRestoringPurchases(false);

        return new Promise((resolve) => {
          InteractionManager.runAfterInteractions(() => {
            isMounted.current = false;
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            resolve();
          });
        });
      } else {
        Alert.alert(
          t('common.info', { defaultValue: 'Expired Subscription' }),
          t('settings.expiredSubscription', { defaultValue: 'Your subscription has expired. Please select a new plan.' })
        );
        setIsRestoringPurchases(false);
      }
    } catch (error) {
      console.error('[PlanSelection] Error restoring purchases:', error);

      const errorMessage = error?.message || '';
      if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED') || errorMessage.includes('canceled')) {
        console.log('[PlanSelection] User cancelled restore purchases');
        setIsRestoringPurchases(false);
        return;
      }

      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.restoreFailed', { defaultValue: 'Failed to restore purchases. Please try again.' })
      );
      setIsRestoringPurchases(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#F2C31B" />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <View style={styles.backButtonInner}>
            <Ionicons name="arrow-back-outline" size={22} color="#000000" />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('firstLoad.choosePlan', { defaultValue: 'Choose a plan' })}</Text>
       {showTrialModal &&
        <TouchableOpacity
          style={styles.selectButton}
          onPress={() => {}}
          activeOpacity={0.7}
        >
          <Text style={styles.selectButtonText}>Select</Text>
        </TouchableOpacity>}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Trial Banner */}
        {trialAvailable && (
          <View style={styles.trialBannerWrapper}>
            <GradientView
              colors={['rgb(226, 208, 95)', '#FFFFFF']}
              start={{ x: 0, y: 1.3 }}
              end={{ x: 0.2, y: 0 }}
              style={styles.trialBanner}
              fallbackColor="#FFFFFF"
            >
              <Text style={styles.trialBannerText}>
                {trialDays}-Day <Text style={styles.trialBannerBold}>FREE</Text> Trial Available!
              </Text>
            </GradientView>
          </View>
        )}

        {/* Starter Plan Card */}
        <TouchableOpacity
          style={[styles.planCardWrapper, userPlan === 'starter' && styles.planCardWrapperSelected]}
          onPress={() => handleSelectPlan('starter')}
          activeOpacity={0.8}
        >
          <GradientView
            colors={['rgb(226, 208, 95)', '#FFFFFF']}
            start={{ x: 0, y: 1.9 }}
            end={{ x: 0.2, y: 0.2 }}
            style={styles.planCard}
            fallbackColor="#FFFFFF"
          >
            <View style={styles.planCardHeader}>
              <Text style={styles.planCardTitle}>{t('firstLoad.starter', { defaultValue: 'Starter' })}</Text>
              <View style={styles.priceContainer}>
                <GradientView
                  colors={['rgba(11, 131, 33, 0)', '#0B8321']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.priceBadgeGradient}
                  fallbackColor="rgba(11, 131, 33, 0.14)"
                />
                <Text style={styles.priceText}>FREE</Text>
              </View>
            </View>
            <Text style={styles.planCardDescription}>
             Free forever. Easily manage your first project and {'\n'}create stunning before/after photos ready for {'\n'}social sharing.
            </Text>
          </GradientView>
        </TouchableOpacity>

        {/* Pro Plan Card */}
        <TouchableOpacity
          style={[styles.planCardWrapper, userPlan === 'pro' && styles.planCardWrapperSelected]}
          onPress={() => handleSelectPlan('pro')}
          activeOpacity={0.8}
        >
          <GradientView
            colors={['rgb(226, 208, 95)', '#FFFFFF']}
            start={{ x: 0, y: 1.9 }}
            end={{ x: 0.2, y: 0.2 }}
            style={styles.planCard}
            fallbackColor="#FFFFFF"
          >
            <View style={styles.planCardHeader}>
              <Text style={styles.planCardTitle}>{t('firstLoad.pro', { defaultValue: 'Pro' })}</Text>
              <View style={styles.priceContainer}>
                <GradientView
                  colors={['rgba(11, 131, 33, 0)', '#0B8321']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.priceBadgeGradient}
                  fallbackColor="rgba(11, 131, 33, 0.14)"
                />
                <Text style={styles.priceText}>$8.99/month</Text>
              </View>
            </View>
            <Text style={styles.planCardDescription}>
            Everything in Starter &{'\n'}
            For professionals. Cloud sync + bulk upload.
            </Text>
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedIcon}>👍</Text>
              <Text style={styles.recommendedText}>Recommended</Text>
            </View>
          </GradientView>
        </TouchableOpacity>

        {/* Business Plan Card */}
        <TouchableOpacity
          style={[styles.planCardWrapper, userPlan === 'business' && styles.planCardWrapperSelected]}
          onPress={() => handleSelectPlan('business')}
          activeOpacity={0.8}
        >
          <GradientView
             colors={['rgb(226, 208, 95)', '#FFFFFF']}
             start={{ x: 0, y: 1.9 }}
             end={{ x: 0.2, y: 0.2 }}
            style={styles.planCard}
            fallbackColor="#FFFFFF"
          >
            <View style={styles.planCardHeader}>
              <Text style={styles.planCardTitle}>{t('firstLoad.business', { defaultValue: 'Business' })}</Text>
              <View style={styles.priceContainer}>
                <GradientView
                  colors={['rgba(11, 131, 33, 0)', '#0B8321']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.priceBadgeGradient}
                  fallbackColor="rgba(11, 131, 33, 0.14)"
                />
                <Text style={styles.priceText}>$24.99/month</Text>
              </View>
            </View>
            <Text style={styles.planCardDescription}>
              Everything in Pro &{'\n'}For small teams up to 5 members. $5.99 per {'\n'}additional team member.
            </Text>
          </GradientView>
        </TouchableOpacity>

        {/* Enterprise Plan Card */}
        <TouchableOpacity
          style={[styles.planCardWrapper, userPlan === 'enterprise' && styles.planCardWrapperSelected]}
          onPress={() => handleSelectPlan('enterprise')}
          activeOpacity={0.8}
        >
          <GradientView
            colors={['rgb(226, 208, 95)', '#FFFFFF']}
            start={{ x: 0, y: 1.9 }}
            end={{ x: 0.2, y: 0.2 }}
            style={styles.planCard}
            fallbackColor="#FFFFFF"
          >
            <View style={styles.planCardHeader}>
              <Text style={styles.planCardTitle}>{t('firstLoad.enterprise', { defaultValue: 'Enterprise' })}</Text>
              <View style={[styles.priceContainer, styles.priceContainerWide]}>
                <GradientView
                  colors={['rgba(11, 131, 33, 0)', '#0B8321']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.priceBadgeGradientWide}
                  fallbackColor="rgba(11, 131, 33, 0.14)"
                />
                <Text style={styles.priceText}>Starts at $69.99/month</Text>
              </View>
            </View>
            <Text style={styles.planCardDescription}>
              Everything in Business &{'\n'}For growing organizations with 15 team members and more
            </Text>
          </GradientView>
        </TouchableOpacity>

        {/* Restore Purchases */}
        <TouchableOpacity
          style={styles.restorePurchasesButton}
          onPress={handleRestorePurchases}
          disabled={isRestoringPurchases}
        >
          <Ionicons name="refresh-outline" size={24} color="#000000" style={styles.restoreIcon} />
          <Text style={styles.restorePurchasesText}>
            {isRestoringPurchases ? t('settings.restoring', { defaultValue: 'Restoring...' }) : t('settings.restorePurchases', { defaultValue: 'Restore Purchase' })}
          </Text>
        </TouchableOpacity>

        {/* Terms and Privacy Policy Links */}
        <View style={styles.legalLinksContainer}>
          <TouchableOpacity
            onPress={() => Linking.openURL(
              Platform.OS === 'android'
                ? 'https://play.google.com/intl/en_us/about/play-terms/'
                : 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
            )}
            style={styles.legalLinkButton}
          >
            <Text style={styles.legalLinkText}>
              {t('settings.termsOfUse', { defaultValue: 'Terms of Use (EULA)' })}
            </Text>
          </TouchableOpacity>

          <View style={styles.legalLinkDot} />

          <TouchableOpacity
            onPress={() => Linking.openURL('https://sayapingeorge.wixsite.com/geos/privacy-policy')}
            style={styles.legalLinkButton}
          >
            <Text style={styles.legalLinkText}>
              {t('settings.privacyPolicy', { defaultValue: 'Privacy Policy' })}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Enterprise Contact Form Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

      {/* Trial Confirmation Modal - Inline */}
      <Modal
        visible={showTrialConfirmation}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancelTrial}
      >
        <View style={styles.trialModalOverlay}>
          <TouchableOpacity 
            style={styles.trialModalOverlayTouchable} 
            activeOpacity={1} 
            onPress={handleCancelTrial}
          />
          
          <View style={styles.trialModalContainer}>
            {/* Grabber Handle */}
            <View style={styles.trialModalGrabberContainer}>
              <View style={styles.trialModalGrabber} />
            </View>

            {/* Header with Close Button and Title */}
            <View style={styles.trialModalHeader}>
              <TouchableOpacity
                style={styles.trialModalCloseButton}
                onPress={handleCancelTrial}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color="#999999" />
              </TouchableOpacity>
              <Text style={styles.trialModalTitle}>START FREE TRIAL</Text>
              <View style={styles.trialModalHeaderSpacer} />
            </View>

            {/* Body Content */}
            <View style={styles.trialModalBody}>
              <Text style={styles.trialModalBodyText}>
                You're eligible for a {trialDays}-days free trial of {selectedPlanForTrial ? selectedPlanForTrial.toLowerCase() : 'business'} features. Would you like to start your free trial now?
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.trialModalButtonsContainer}>
              <TouchableOpacity
                style={styles.trialModalSkipButton}
                onPress={handleCancelTrial}
                activeOpacity={0.8}
              >
                <Text style={styles.trialModalSkipButtonText}>Skip</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.trialModalStartButton}
                onPress={handleUseTrial}
                activeOpacity={0.8}
              >
                <Text style={styles.trialModalStartButtonText}>Start</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Trial Notification Modal */}
      <TrialNotificationModal
        visible={showTrialModal}
        notification={trialNotification}
        onClose={handleTrialModalClose}
        onUpgrade={handleTrialUpgrade}
        onRefer={handleTrialRefer}
        onCTA={(notification) => {
          handleTrialModalClose();
          let scrollParam = {};
          if (notification?.key === 'day7_10') {
            scrollParam = { scrollToWatermark: true };
          } else if (notification?.key === 'day15') {
            scrollParam = { scrollToCloudSync: true };
          } else if (notification?.key === 'day22_24') {
            scrollParam = { scrollToAccountData: true };
          }
          navigation.reset({ index: 0, routes: [{ name: 'Settings', params: scrollParam }] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2C31B',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
  },
  backButtonInner: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 23,
    fontWeight: 'bold',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    letterSpacing: -0.2,
    flex: 1,
    textAlign: 'center',
    textTransform: 'sentence-case',
  },
  headerSpacer: {
    width: 36,
  },
  selectButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(118, 118, 128, 0.12)',
    borderRadius: 1000,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectButtonText: {
    fontSize: 15,
    fontWeight: 'normal',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    letterSpacing: -0.23,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  trialBannerWrapper: {
    marginBottom: 14,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: '#000000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 8.2,
    elevation: 4,
    overflow: 'hidden',
  },
  trialBanner: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  trialBannerText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
    fontFamily: 'Alexandria_400Regular',
  },
  trialBannerBold: {
    fontWeight: '900',
  },
  planCardWrapper: {
    marginBottom: 14,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 8.2,
    elevation: 4,
    overflow: 'hidden',
  },
  planCardWrapperSelected: {
    borderWidth: 2.5,
    borderColor: '#F2C31B',
  },
  planCard: {
    borderRadius: 25,
    paddingHorizontal: 22,
    paddingTop: 15,
    paddingBottom: 20,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontStyle: 'semibold',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    lineHeight: 20,
  },
  priceContainer: {
    position: 'relative',
    height: 24,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  priceContainerWide: {
    width: 173,
  },
  priceBadgeGradient: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 112,
    height: 24,
    borderRadius: 100,
    opacity: 0.14,
  },
  priceBadgeGradientWide: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 173,
    height: 24,
    borderRadius: 100,
    opacity: 0.14,
  },
  priceText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#0B8321',
    lineHeight: 17,
    textAlign: 'right',
  },
  planCardDescription: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    lineHeight: 18,
  },
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.3)',
  },
  recommendedIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  recommendedText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    lineHeight: 15,
  },
  restorePurchasesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 12,
  },
  restoreIcon: {
    marginRight: 6,
  },
  restorePurchasesText: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    lineHeight: 17,
  },
  legalLinksContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 7,
    bottom: 3,
    display: 'absolute',
  },
  legalLinkButton: {
    paddingVertical: 4,
  },
  legalLinkText: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textDecorationLine: 'underline',
    lineHeight: 12,
  },
  legalLinkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#000000',
  },
  // Trial Confirmation Modal Styles
  trialModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    justifyContent: 'flex-end',
  },
  trialModalOverlayTouchable: {
    flex: 1,
  },
  trialModalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -15 },
    shadowOpacity: 0.18,
    shadowRadius: 75,
    elevation: 20,
  },
  trialModalGrabberContainer: {
    alignItems: 'center',
    paddingTop: 5,
  },
  trialModalGrabber: {
    width: 36,
    height: 5,
    backgroundColor: '#CCCCCC',
    borderRadius: 100,
  },
  trialModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 44,
    marginTop: 5,
  },
  trialModalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 296,
    backgroundColor: 'rgba(120, 120, 128, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trialModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Alexandria_400Regular',
    color: '#333333',
    textAlign: 'center',
    letterSpacing: -0.43,
    flex: 1,
  },
  trialModalHeaderSpacer: {
    width: 44,
  },
  trialModalBody: {
    paddingHorizontal: 36,
    paddingTop: 20,
    paddingBottom: 30,
  },
  trialModalBodyText: {
    fontSize: 15,
    fontWeight: 'normal',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: -0.43,
  },
  trialModalButtonsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 23,
    gap: 9,
  },
  trialModalSkipButton: {
    flex: 1,
    height: 54,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#000000',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trialModalSkipButtonText: {
    fontSize: 18,
    fontWeight: 'normal',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
  },
  trialModalStartButton: {
    flex: 1,
    height: 54,
    borderRadius: 100,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  trialModalStartButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Alexandria_400Regular',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
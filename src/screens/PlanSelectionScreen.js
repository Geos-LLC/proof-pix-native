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
  ActivityIndicator,
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
import { canStartTrial, isTrialExpired } from '../services/trialService';
import { IAP_PRODUCTS, purchaseProduct, purchaseOrUpgrade, restorePurchases, getAvailablePurchases, diagnoseIAPState, productIdToPlan, hasActiveIAPSubscription, openManageSubscriptions } from '../services/iapService';
import { logPaywallView, logPlanSelected, logTrialSkipped, logSubscriptionStarted, logSubscriptionRestored } from '../utils/analytics';
import useSubscriptionPrices from '../hooks/useSubscriptionPrices';

const { width } = Dimensions.get('window');

export default function PlanSelectionScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { userPlan, updateUserPlan } = useSettings();
  const { updatePlanLimit } = useAdmin();
  const insets = useSafeAreaInsets();

  const forceUpgradeMode = route?.params?.mode === 'upgrade';

  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  // Default to false so returning/expired/active-trial users never see a flash
  // of "Free Trial" UI before canStartTrial() resolves. Eligible new users will
  // briefly see "Subscribe" before the trial UI appears — acceptable.
  const [trialAvailable, setTrialAvailable] = useState(false);
  // Fallback when store metadata hasn't loaded yet. Actual duration is read
  // from the store's intro offer below (iOS: 14 days / 2 weeks, Android: 15)
  // so paywall copy always matches what the store's sheet will show.
  const FALLBACK_TRIAL_DAYS = Platform.OS === 'android' ? 15 : 14;
  const referralBonus = 15;
  const [trialDays, setTrialDays] = useState(FALLBACK_TRIAL_DAYS);
  const isMounted = useRef(true);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  const isPurchasing = useRef(false);

  // Live store prices + trial info (ADDITION 2: must show before billing)
  const { loading: pricesLoading, error: pricesError, prices, trialInfo, platformCancelText } = useSubscriptionPrices();

  // ADDITION 1: Prevent hidden re-entry into paywall after dismiss
  const [paywallDismissed, setPaywallDismissed] = useState(false);

  // Show/hide Business & Enterprise cards (collapsed by default for conversion focus)
  const [showTeamPlans, setShowTeamPlans] = useState(false);

  useEffect(() => {
    console.log('[PlanSelection] 🔵 Component mounted, isMounted set to true');
    isMounted.current = true;
    logPaywallView();

    const checkTrialAvailability = async () => {
      try {
        if (forceUpgradeMode) {
          if (isMounted.current) setTrialAvailable(false);
        } else {
          const available = await canStartTrial();
          if (isMounted.current) setTrialAvailable(available);
        }

        try {
          const AsyncStorage = await import('@react-native-async-storage/async-storage');
          const referralData = await AsyncStorage.default.getItem('@referral_accepted');
          if (isMounted.current) {
            const base = trialInfo?.pro?.trialDays || FALLBACK_TRIAL_DAYS;
            setTrialDays(referralData !== null ? base + referralBonus : base);
          }
        } catch (error) {
          if (isMounted.current) {
            setTrialDays(trialInfo?.pro?.trialDays || FALLBACK_TRIAL_DAYS);
          }
        }
      } catch (error) {
        console.error('[PlanSelection] Error checking trial availability:', error);
        if (isMounted.current) {
          setTrialAvailable(!forceUpgradeMode);
          setTrialDays(trialInfo?.pro?.trialDays || FALLBACK_TRIAL_DAYS);
        }
      }
    };
    checkTrialAvailability();

    return () => {
      console.log('[PlanSelection] 🔴 Component unmounting, isMounted set to false');
      isMounted.current = false;
    };
  }, []);

  // Re-sync trialDays once store metadata arrives (useSubscriptionPrices is
  // async — may not be loaded when the mount effect runs).
  useEffect(() => {
    const storeDays = trialInfo?.pro?.trialDays;
    if (!storeDays || !isMounted.current) return;
    (async () => {
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage');
        const referralData = await AsyncStorage.default.getItem('@referral_accepted');
        if (isMounted.current) {
          setTrialDays(referralData !== null ? storeDays + referralBonus : storeDays);
        }
      } catch {
        if (isMounted.current) setTrialDays(storeDays);
      }
    })();
  }, [trialInfo?.pro?.trialDays]);

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleSelectPlan = async (plan) => {
    console.log('[analytics-debug] plan_selected fired', { selectedPlan: plan });
    logPlanSelected(plan, false);

    if (plan === 'starter') {
      // If the user already has an active Apple/Google subscription, tapping
      // Starter cannot actually downgrade them — only the store can cancel a
      // subscription. Surface that explicitly so we don't silently lie about
      // their plan state and let Apple keep charging them.
      try {
        const hasActive = await hasActiveIAPSubscription();
        if (hasActive) {
          Alert.alert(
            t('paywall.cancelFirstTitle', { defaultValue: 'Cancel your subscription first' }),
            t('paywall.cancelFirstBody', {
              defaultValue:
                'You currently have an active subscription. To switch to the Free plan, cancel your subscription in Settings. You\'ll keep your paid features until your current period ends, then move to Free automatically.',
            }),
            [
              {
                text: t('paywall.cancelSubscriptionCTA', { defaultValue: 'Cancel Subscription' }),
                onPress: () => {
                  try { openManageSubscriptions(); } catch {}
                },
              },
              {
                text: t('paywall.keepSubscriptionCTA', { defaultValue: 'Keep Subscription' }),
                style: 'cancel',
              },
            ]
          );
          return;
        }
      } catch {}

      logTrialSkipped();
      // Canonical free-tier subscription event (no store purchase involved)
      try {
        logSubscriptionStarted({
          subscription_type: 'free',
          plan_id: 'starter',
          platform: Platform.OS,
          entry_point: 'paywall',
        });
      } catch {}
      await proceedWithPlanSelection(plan);
      return;
    }

    await proceedWithPlanSelection(plan);
  };

  const proceedWithPlanSelection = async (plan) => {
    if (isPurchasing.current) {
      console.log('[PlanSelection] ⚠️ Purchase already in progress, ignoring duplicate request');
      return;
    }

    isPurchasing.current = true;
    console.log('[PlanSelection] 🟢 proceedWithPlanSelection START - plan:', plan);

    try {
      // All paid plans — including free-trial signups — go through the store's
      // IAP flow. The store enforces per-Apple-ID / per-Google-account
      // eligibility for the intro free trial. Reinstall users who already used
      // their trial will see the full subscription price in the native sheet.
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        let productId = null;
        if (plan === 'pro') productId = IAP_PRODUCTS.PRO_MONTHLY;
        else if (plan === 'business') productId = IAP_PRODUCTS.BUSINESS_MONTHLY;
        else if (plan === 'enterprise') productId = IAP_PRODUCTS.ENTERPRISE_MONTHLY;

        console.log('[PlanSelection] Selected plan:', plan, 'Product ID:', productId);

        if (productId) {
          try {
            let entryPoint = 'paywall';
            try {
              if (await isTrialExpired()) entryPoint = 'trial_expired';
            } catch {}

            console.log('[PlanSelection] Starting purchase for:', productId, 'entryPoint:', entryPoint);
            console.log('[iap-debug] starting purchase flow', {
              productId,
              selectedPlan: plan,
              entryPoint,
              platform: Platform.OS,
            });
            await purchaseOrUpgrade(productId, entryPoint);
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

        // Restore — distinct from a fresh subscription_started. We can't tell
        // client-side whether the restored sub is in trial or paid period
        // without receipt validation, so subscription_type is 'unknown'.
        try {
          logSubscriptionRestored({
            plan_id: restoredPlan,
            product_id: activePurchase.productId || null,
            platform: Platform.OS,
            provider: Platform.OS === 'ios' ? 'apple' : 'google',
            entry_point: 'restore',
            subscription_type: 'unknown',
            transaction_id: activePurchase.transactionId || activePurchase.purchaseToken || null,
            original_transaction_id:
              activePurchase.originalTransactionIdentifierIOS ||
              activePurchase.originalTransactionId ||
              null,
          });
        } catch {}

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
        <Text style={styles.headerTitle}>Turn every job into before & after proof</Text>
      </View>

      <Text style={styles.subheaderText}>Avoid disputes. Save time. Impress your clients.</Text>

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
                {trialDays}-day free trial {'\u2022'} No charges today
              </Text>
            </GradientView>
          </View>
        )}

        {/* ===== Pro Plan Card (PRIMARY) ===== */}
        <View style={[styles.planCardWrapper, styles.planCardWrapperPrimary]}>
          <GradientView
            colors={['rgb(226, 208, 95)', '#FFFFFF']}
            start={{ x: 0, y: 1.9 }}
            end={{ x: 0.2, y: 0.2 }}
            style={styles.planCard}
            fallbackColor="#FFFFFF"
          >
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>MOST POPULAR</Text>
            </View>
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
                {pricesLoading ? (
                  <ActivityIndicator size="small" color="#0B8321" />
                ) : trialAvailable ? (
                  <View style={styles.trialPriceRow}>
                    <Text style={styles.priceText}>Free Trial</Text>
                  </View>
                ) : (
                  <Text style={styles.priceText}>{prices.pro || 'Price unavailable'}</Text>
                )}
              </View>
            </View>
            {trialAvailable && prices.pro ? (
              <Text style={styles.trialSubtext}>then {prices.pro}/month</Text>
            ) : null}
            <Text style={styles.planCardDescription}>
              Best for solo cleaners & professionals
            </Text>
            <View style={styles.valueBullets}>
              <Text style={styles.valueBulletText}>Prevent "you didn't clean this" complaints</Text>
              <Text style={styles.valueBulletText}>Create before & after photos in seconds</Text>
              <Text style={styles.valueBulletText}>Send proof to clients instantly</Text>
            </View>
            {Platform.OS === 'android' && (
              <>
                <TouchableOpacity
                  style={styles.androidCardCTA}
                  onPress={() => handleSelectPlan('pro')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.androidCardCTAText}>
                    {trialAvailable ? `Start ${trialDays}-day free trial` : 'Subscribe'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.androidCardDisclosure}>
                  {trialAvailable && prices.pro
                    ? `${trialDays}-day free trial, then ${prices.pro}/month.\nAuto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                    : prices.pro
                      ? `${prices.pro}/month. Auto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                      : ''}
                </Text>
              </>
            )}
          </GradientView>
        </View>

        {/* ===== Primary CTA Button (iOS only — Android uses per-card CTAs for Play policy compliance) ===== */}
        {Platform.OS !== 'android' && (
        <TouchableOpacity
          style={styles.primaryCTAButton}
          onPress={() => handleSelectPlan('pro')}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryCTAText}>
            {trialAvailable ? `Start My ${trialDays}-Day Free Trial` : 'Subscribe'}
          </Text>
        </TouchableOpacity>
        )}

        {/* Risk reversal, trust, urgency, legal disclosure — iOS only. Android surfaces these per-card. */}
        {Platform.OS !== 'android' && (
          <>
        {/* Risk reversal text */}
        <Text style={styles.riskReversalText}>
          No charges today {'\u2022'} Cancel anytime
        </Text>

        {/* Trust element */}
        <Text style={styles.trustText}>
          Used by cleaning professionals every day
        </Text>

        {/* Subtle urgency */}
        {trialAvailable && (
          <Text style={styles.urgencyText}>Start your free trial today</Text>
        )}

        {/* Legal disclosure */}
        {trialAvailable && prices.pro ? (
          <Text style={styles.legalDisclosureText}>
            {trialDays}-day free trial, then {prices.pro}/month.{'\n'}Auto-renews unless canceled.{'\n'}{platformCancelText}.
          </Text>
        ) : null}
          </>
        )}

        {/* ===== Starter Plan (DE-EMPHASIZED) ===== */}
        <TouchableOpacity
          style={[styles.planCardWrapperSecondary, userPlan === 'starter' && styles.planCardWrapperSelected]}
          onPress={() => handleSelectPlan('starter')}
          activeOpacity={0.8}
        >
          <View style={styles.planCardSecondary}>
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
              Basic before & after photos
            </Text>
          </View>
        </TouchableOpacity>

        {/* ===== Business & Enterprise link / expanded cards ===== */}
        {/* Toggle hidden on Android — Play policy requires all plan terms visible adjacent to tap targets. */}
        {Platform.OS !== 'android' && (
          <TouchableOpacity
            style={styles.businessLinkButton}
            onPress={() => setShowTeamPlans(!showTeamPlans)}
            activeOpacity={0.7}
          >
            <Text style={styles.businessLinkText}>
              {showTeamPlans ? 'Hide Business plans' : 'Have a team? See Business plans'}
            </Text>
            <Ionicons name={showTeamPlans ? 'chevron-up' : 'arrow-forward'} size={16} color="#000000" />
          </TouchableOpacity>
        )}

        {(showTeamPlans || Platform.OS === 'android') && (
          <>
            {/* Business Plan Card */}
            <TouchableOpacity
              style={[styles.planCardWrapper, userPlan === 'business' && styles.planCardWrapperSelected]}
              onPress={Platform.OS === 'android' ? undefined : () => handleSelectPlan('business')}
              activeOpacity={Platform.OS === 'android' ? 1 : 0.8}
              disabled={Platform.OS === 'android'}
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
                    {pricesLoading ? (
                      <ActivityIndicator size="small" color="#0B8321" />
                    ) : trialAvailable ? (
                      <View style={styles.trialPriceRow}>
                        <Text style={styles.priceText}>Free Trial</Text>
                      </View>
                    ) : (
                      <Text style={styles.priceText}>{prices.business || 'Price unavailable'}</Text>
                    )}
                  </View>
                </View>
                {trialAvailable && prices.business ? (
                  <Text style={styles.trialSubtext}>then {prices.business}/month</Text>
                ) : null}
                <Text style={styles.planCardDescription}>
                  Everything in Pro &{'\n'}For small teams up to 5 members.{prices.businessSeat ? ` ${prices.businessSeat} per` : ''} {'\n'}additional team member.
                </Text>
                {Platform.OS === 'android' && (
                  <>
                    <TouchableOpacity
                      style={styles.androidCardCTA}
                      onPress={() => handleSelectPlan('business')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.androidCardCTAText}>
                        {trialAvailable ? `Start ${trialDays}-day free trial` : 'Subscribe'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.androidCardDisclosure}>
                      {trialAvailable && prices.business
                        ? `${trialDays}-day free trial, then ${prices.business}/month.\nAuto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                        : prices.business
                          ? `${prices.business}/month. Auto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                          : ''}
                    </Text>
                  </>
                )}
              </GradientView>
            </TouchableOpacity>

            {/* Enterprise Plan Card */}
            <TouchableOpacity
              style={[styles.planCardWrapper, userPlan === 'enterprise' && styles.planCardWrapperSelected]}
              onPress={Platform.OS === 'android' ? undefined : () => handleSelectPlan('enterprise')}
              activeOpacity={Platform.OS === 'android' ? 1 : 0.8}
              disabled={Platform.OS === 'android'}
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
                    {pricesLoading ? (
                      <ActivityIndicator size="small" color="#0B8321" />
                    ) : trialAvailable ? (
                      <View style={styles.trialPriceRow}>
                        <Text style={styles.priceText}>Free Trial</Text>
                      </View>
                    ) : (
                      <Text style={styles.priceText}>{prices.enterprise ? `Starts at ${prices.enterprise}` : 'Price unavailable'}</Text>
                    )}
                  </View>
                </View>
                {trialAvailable && prices.enterprise ? (
                  <Text style={styles.trialSubtext}>then {prices.enterprise}/month</Text>
                ) : null}
                <Text style={styles.planCardDescription}>
                  Everything in Business &{'\n'}For growing organizations with 15 team members and more
                </Text>
                {Platform.OS === 'android' && (
                  <>
                    <TouchableOpacity
                      style={styles.androidCardCTA}
                      onPress={() => handleSelectPlan('enterprise')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.androidCardCTAText}>
                        {trialAvailable ? `Start ${trialDays}-day free trial` : 'Subscribe'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={styles.androidCardDisclosure}>
                      {trialAvailable && prices.enterprise
                        ? `${trialDays}-day free trial, then ${prices.enterprise}/month.\nAuto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                        : prices.enterprise
                          ? `${prices.enterprise}/month. Auto-renews until canceled.\nCancel anytime in Google Play > Subscriptions.`
                          : ''}
                    </Text>
                  </>
                )}
              </GradientView>
            </TouchableOpacity>
          </>
        )}

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
  subheaderText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    opacity: 0.7,
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
  planCardWrapperPrimary: {
    borderWidth: 2,
    borderColor: '#000000',
    transform: [{ scale: 1.02 }],
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
  priceTextStrikethrough: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#999999',
    lineHeight: 17,
    textDecorationLine: 'line-through',
    marginRight: 6,
  },
  trialPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  planCardDescription: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    lineHeight: 18,
  },
  trialSubtext: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: '#666666',
    marginTop: 2,
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
  valueBullets: {
    marginTop: 10,
  },
  valueBulletText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: '#333333',
    lineHeight: 22,
    paddingLeft: 4,
  },
  primaryCTAButton: {
    backgroundColor: '#000000',
    borderRadius: 100,
    paddingVertical: 18,
    marginTop: 4,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryCTAText: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  riskReversalText: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 6,
    opacity: 0.6,
  },
  trustText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.5,
  },
  urgencyText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 12,
    opacity: 0.55,
  },
  legalDisclosureText: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#666666',
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: 20,
  },
  planCardWrapperSecondary: {
    marginBottom: 10,
    marginTop: 6,
    borderRadius: 20,
    overflow: 'hidden',
    opacity: 0.65,
  },
  planCardSecondary: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  businessLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 16,
    marginHorizontal: 4,
    gap: 8,
    backgroundColor: '#FFF4CC',
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    borderRadius: 14,
  },
  businessLinkText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#1A1A1A',
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
  trialDisclosureText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#666666',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 10,
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
  androidCardCTA: {
    backgroundColor: '#000000',
    borderRadius: 100,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidCardCTAText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  androidCardDisclosure: {
    fontSize: 10,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#666666',
    textAlign: 'center',
    lineHeight: 14,
    paddingHorizontal: 4,
  },
});
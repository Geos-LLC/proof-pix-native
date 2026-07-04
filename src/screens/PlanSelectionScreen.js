import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import { getSoftTrialState, ensureDeviceId } from '../services/softTrialService';
import { PAYWALL_TRIGGERS } from '../constants/softTrial';
import { useTheme } from '../hooks/useTheme';

const { width } = Dimensions.get('window');

export default function PlanSelectionScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { userPlan, updateUserPlan } = useSettings();
  const { updatePlanLimit } = useAdmin();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const forceUpgradeMode = route?.params?.mode === 'upgrade';
  const trigger = route?.params?.trigger || null;

  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  // Default to false so returning/expired/active-trial users never see a flash
  // of "Free Trial" UI before canStartTrial() resolves. Eligible new users will
  // briefly see "Subscribe" before the trial UI appears — acceptable.
  const [trialAvailable, setTrialAvailable] = useState(false);
  // Billing toggle is shown per the design (Annual / Monthly). Annual
  // products aren't configured in App Store Connect / Play yet, so tapping
  // Annual surfaces a friendly "coming soon" alert and the state stays
  // on monthly. When annual is wired upstream, flip the alert to a real
  // setBillingCycle('annual') call and price selection downstream.
  const [billingCycle, setBillingCycle] = useState('monthly');
  // Fallback when store metadata hasn't loaded yet. Actual duration is read
  // from the store's intro offer below (iOS: 14 days / 2 weeks, Android: 15)
  // so paywall copy always matches what the store's sheet will show.
  // Matches TRIAL_DURATION_DAYS in trialService — base trial is 7 days.
  // The live `trialInfo?.pro?.trialDays` from the store (App Store / Play)
  // takes precedence below; this only shows during the brief window
  // before store metadata loads.
  const FALLBACK_TRIAL_DAYS = 7;
  // When the user has applied a referral code, both they and the
  // referrer get +7 days, so the receiver's trial is base + 7 = 14
  // days when base is 7.
  const REFERRAL_BONUS_DAYS = 7;
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
    (async () => {
      try {
        const [s, deviceId] = await Promise.all([
          getSoftTrialState(),
          ensureDeviceId(),
        ]);
        logPaywallView({
          trigger,
          trial_type: 'apple',
          exports_used: s?.exports_used ?? null,
          device_id: deviceId || null,
        });
      } catch {
        logPaywallView({ trigger });
      }
    })();

    const checkTrialAvailability = async () => {
      try {
        if (forceUpgradeMode) {
          if (isMounted.current) setTrialAvailable(false);
        } else {
          // Three-layer gate: the legacy in-app trial flag alone misses users
          // who started a trial via StoreKit (Apple writes that to the Apple
          // ID, not AsyncStorage), and users restored from a prior install on
          // a paid plan. Without all three signals, the paywall lit up
          // "Start Free Trial" for users Apple won't actually grant a trial.
          const [legacyAvailable, hasActive] = await Promise.all([
            canStartTrial(),
            hasActiveIAPSubscription().catch(() => false),
          ]);
          const trialOK = legacyAvailable && !hasActive && userPlan === 'starter';
          if (isMounted.current) setTrialAvailable(trialOK);
        }

        try {
          const AsyncStorage = await import('@react-native-async-storage/async-storage');
          const referralData = await AsyncStorage.default.getItem('@referral_accepted');
          if (isMounted.current) {
            const base = trialInfo?.pro?.trialDays || FALLBACK_TRIAL_DAYS;
            // Friend (referral on file) gets base + 7 = 14 days (additive).
            setTrialDays(referralData !== null ? base + REFERRAL_BONUS_DAYS : base);
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
          // Friend (referral on file) gets storeDays + 7 (additive).
          setTrialDays(referralData !== null ? storeDays + REFERRAL_BONUS_DAYS : storeDays);
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
    // Real trial eligibility from store metadata. Starter (free tier) is
    // never a trial; for paid plans the store-side intro offer flag is the
    // source of truth. Hardcoding `false` here was hiding most trial starts
    // from the GA4 funnel (`plan_selected → trial_started`).
    const productHasTrialFromCache =
      plan !== 'starter' && !!trialInfo?.[plan]?.hasTrial;
    const isTrial = productHasTrialFromCache;
    console.log('[analytics-debug] plan_selected source data', {
      plan,
      productHasTrialFromCache,
      trialInfoForPlan: trialInfo?.[plan] || null,
      isTrial,
    });
    logPlanSelected(plan, isTrial);

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
          analytics_source: 'free_plan',
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
            analytics_source: 'restore',
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

  // Design 38 layout — "Choose your plan" + X close, Annual/Monthly
  // toggle, then Starter / Pro (highlighted) / Business / Enterprise
  // stacked vertically. Cards carry concise design bullets; Pro hosts
  // the primary CTA inline. All existing IAP / restore / legal logic
  // is preserved; only the JSX structure is reshaped.
  const handlePickAnnual = () => {
    Alert.alert(
      'Annual coming soon',
      'Annual billing will be available shortly. Monthly is active for now.',
    );
  };

  // Compute per-tier CTA labels based on the user's current tier so
  // every card tells them exactly what tapping it does. Pricing tiers
  // are ranked starter(0) < pro(1) < business(2) < enterprise(3); a
  // tap on a higher tier is an upgrade, a tap on a lower tier is a
  // downgrade, and the tier they're already on says "Current plan".
  const tierRank = { starter: 0, pro: 1, business: 2, enterprise: 3 };
  const currentTier = (userPlan || 'starter').toLowerCase();
  const currentRank = tierRank[currentTier] ?? 0;
  const labelForTier = (tier) => {
    const rank = tierRank[tier] ?? 0;
    if (tier === currentTier) return 'Current plan';
    if (rank > currentRank) {
      return trialAvailable && currentRank === 0
        ? `Start ${trialDays}-day free trial`
        : `Upgrade to ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
    }
    return `Switch to ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
  };
  const proCTAText = labelForTier('pro');
  const businessCTAText = labelForTier('business');
  const enterpriseCTAText =
    currentTier === 'enterprise' ? 'Current plan' : 'Contact sales';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header — design 38: "Choose your plan" left + X close right. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Choose your plan</Text>
        <TouchableOpacity
          style={styles.headerClose}
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={20} color="#1E1E1E" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Annual / Monthly segmented control */}
        <View style={styles.billingToggle}>
          <TouchableOpacity
            style={[styles.billingChip, billingCycle === 'annual' && styles.billingChipActive]}
            onPress={handlePickAnnual}
            activeOpacity={0.85}
          >
            <Text style={[styles.billingChipText, billingCycle === 'annual' && styles.billingChipTextActive]}>
              Annual · save 20%
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.billingChip, billingCycle === 'monthly' && styles.billingChipActive]}
            onPress={() => setBillingCycle('monthly')}
            activeOpacity={0.85}
          >
            <Text style={[styles.billingChipText, billingCycle === 'monthly' && styles.billingChipTextActive]}>
              Monthly
            </Text>
          </TouchableOpacity>
        </View>

        {/* Contextual trigger banner — shown when paywall is opened from a
            specific feature or limit. Tells the user exactly what they
            unlock by upgrading. */}
        {trigger ? (
          <View style={styles.triggerBanner}>
            <Text style={styles.triggerBannerTitle}>
              {trigger === PAYWALL_TRIGGERS.EXPORT_LIMIT
                ? "You've used your free exports"
                : trigger === PAYWALL_TRIGGERS.WATERMARK
                  ? 'Remove the watermark'
                  : trigger === PAYWALL_TRIGGERS.HD_EXPORT
                    ? 'Export in HD'
                    : trigger === PAYWALL_TRIGGERS.UNLIMITED
                      ? 'Unlimited projects & exports'
                      : 'Upgrade to keep going'}
            </Text>
            <Text style={styles.triggerBannerSubtitle}>
              Remove watermark {'•'} Unlimited projects {'•'} Reports
            </Text>
          </View>
        ) : null}

        {/* ===== Starter ===== */}
        <TouchableOpacity
          style={[
            styles.designCard,
            currentTier === 'starter' && styles.designCardCurrent,
          ]}
          onPress={currentTier === 'starter' ? undefined : () => handleSelectPlan('starter')}
          disabled={currentTier === 'starter'}
          activeOpacity={0.85}
        >
          {currentTier === 'starter' ? (
            <View style={styles.currentPlanPill}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              <Text style={styles.currentPlanPillText}>Current plan</Text>
            </View>
          ) : null}
          <View style={styles.designCardHeader}>
            <Text style={styles.designCardTitle}>Starter</Text>
            <Text style={styles.designCardPriceFree}>Free</Text>
          </View>
          <View style={styles.designBullets}>
            <Bullet text="Single project · 100 photos" />
            <Bullet text="All capture modes" />
            <Bullet text="Text notes · single-photo share" />
          </View>
        </TouchableOpacity>

        {/* ===== Pro (highlighted) ===== */}
        <View
          style={[
            styles.designCard,
            styles.designCardPro,
            currentTier === 'pro' && styles.designCardCurrent,
          ]}
        >
          {/* Most-popular pill stays for any non-Pro user; Pro users
              see the Current-plan pill instead (in the same slot). */}
          {currentTier === 'pro' ? (
            <View style={[styles.currentPlanPill, styles.currentPlanPillOnAccent]}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              <Text style={styles.currentPlanPillText}>Current plan</Text>
            </View>
          ) : (
            <View style={styles.mostPopularPill}>
              <Ionicons name="star" size={11} color="#1E1E1E" />
              <Text style={styles.mostPopularPillText}>Most popular</Text>
            </View>
          )}

          <View style={styles.designCardHeader}>
            <Text style={styles.designCardTitle}>Pro</Text>
            <View style={styles.designPriceCluster}>
              {pricesLoading ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
              ) : (
                <>
                  <Text style={styles.designCardPrice}>{prices.pro || '—'}</Text>
                  <Text style={styles.designCardPriceUnit}>/mo</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.designBullets}>
            <Bullet text="Unlimited projects & photos" tint="#7A5B00" />
            <Bullet text="Combined formats & view modes" tint="#7A5B00" />
            <Bullet text="Watermark, voice notes, markup" tint="#7A5B00" />
            <Bullet text="Reports & cloud sync" tint="#7A5B00" />
          </View>

          <TouchableOpacity
            style={[styles.proInCardCTA, currentTier === 'pro' && styles.proInCardCTADisabled]}
            onPress={currentTier === 'pro' ? undefined : () => handleSelectPlan('pro')}
            disabled={currentTier === 'pro'}
            activeOpacity={0.85}
          >
            <Text style={styles.proInCardCTAText}>{proCTAText}</Text>
          </TouchableOpacity>

          {Platform.OS === 'android' && (
            <Text style={styles.androidCardDisclosure}>
              {trialAvailable && prices.pro
                ? `${trialDays}-day free trial, then ${prices.pro}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                : prices.pro
                  ? `${prices.pro}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                  : ''}
            </Text>
          )}
        </View>

        {/* ===== Business ===== */}
        <TouchableOpacity
          style={[
            styles.designCard,
            currentTier === 'business' && styles.designCardCurrent,
          ]}
          onPress={
            currentTier === 'business' || Platform.OS === 'android'
              ? undefined
              : () => handleSelectPlan('business')
          }
          disabled={currentTier === 'business' || Platform.OS === 'android'}
          activeOpacity={(currentTier === 'business' || Platform.OS === 'android') ? 1 : 0.85}
        >
          {currentTier === 'business' ? (
            <View style={styles.currentPlanPill}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              <Text style={styles.currentPlanPillText}>Current plan</Text>
            </View>
          ) : null}
          <View style={styles.designCardHeader}>
            <Text style={styles.designCardTitle}>Business</Text>
            <View style={styles.designPriceCluster}>
              {pricesLoading ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
              ) : (
                <>
                  <Text style={styles.designCardPrice}>{prices.business || '—'}</Text>
                  <Text style={styles.designCardPriceUnit}>/mo</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.designBullets}>
            <Bullet text="Everything in Pro" />
            <Bullet text="Logo & timestamp overlays" />
            <Bullet text="Team invites & shared projects" />
            <Bullet text="Map-embedded reports" />
          </View>

          {Platform.OS === 'android' && (
            <>
              <TouchableOpacity
                style={[
                  styles.designSecondaryCTA,
                  currentTier === 'business' && styles.designSecondaryCTADisabled,
                ]}
                onPress={currentTier === 'business' ? undefined : () => handleSelectPlan('business')}
                disabled={currentTier === 'business'}
                activeOpacity={0.85}
              >
                <Text style={styles.designSecondaryCTAText}>{businessCTAText}</Text>
              </TouchableOpacity>
              <Text style={styles.androidCardDisclosure}>
                {trialAvailable && prices.business
                  ? `${trialDays}-day free trial, then ${prices.business}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                  : prices.business
                    ? `${prices.business}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                    : ''}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* ===== Enterprise ===== */}
        <TouchableOpacity
          style={[
            styles.designCard,
            currentTier === 'enterprise' && styles.designCardCurrent,
          ]}
          onPress={currentTier === 'enterprise' ? undefined : () => setShowEnterpriseModal(true)}
          disabled={currentTier === 'enterprise'}
          activeOpacity={currentTier === 'enterprise' ? 1 : 0.85}
        >
          {currentTier === 'enterprise' ? (
            <View style={styles.currentPlanPill}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              <Text style={styles.currentPlanPillText}>Current plan</Text>
            </View>
          ) : null}
          <View style={styles.designCardHeader}>
            <Text style={styles.designCardTitle}>Enterprise</Text>
            <Text style={styles.designCardPriceContact}>Contact sales</Text>
          </View>

          <View style={styles.designBullets}>
            <Bullet text="Everything in Business" />
            <Bullet text="Unlimited team members" />
            <Bullet text="Multiple cloud accounts & teams" />
            <Bullet text="API access, webhooks, priority support" />
          </View>

          <TouchableOpacity
            style={[
              styles.designSecondaryCTA,
              currentTier === 'enterprise' && styles.designSecondaryCTADisabled,
            ]}
            onPress={currentTier === 'enterprise' ? undefined : () => setShowEnterpriseModal(true)}
            disabled={currentTier === 'enterprise'}
            activeOpacity={0.85}
          >
            <Text style={styles.designSecondaryCTAText}>{enterpriseCTAText}</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* Risk reversal + trust + urgency (iOS only — Android shows
            per-card disclosures inline above to satisfy Play policy). */}
        {Platform.OS !== 'android' && (
          <>
            <Text style={styles.riskReversalText}>
              {trialAvailable
                ? 'No charge today. Apple will remind you before billing.'
                : `No charges today ${'•'} Cancel anytime`}
            </Text>
            {trialAvailable && prices.pro ? (
              <Text style={styles.legalDisclosureText}>
                {trialDays}-day free trial, then {prices.pro}/month.{'\n'}
                Auto-renews unless canceled.{'\n'}{platformCancelText}.
              </Text>
            ) : null}
          </>
        )}
        {/* Need more trial time? — lightweight informational block. Routes
            to the Referral screen where the actual share flow lives.
            Hidden once the user has converted (paying tier), since the
            referral mechanic only rewards extra trial days. */}
        {currentTier === 'starter' && (
          <TouchableOpacity
            style={styles.referralInfoBlock}
            onPress={() => navigation.navigate('Referral')}
            activeOpacity={0.85}
          >
            <View style={styles.referralInfoIcon}>
              <Ionicons name="gift-outline" size={18} color="#7A5B00" />
            </View>
            <View style={styles.referralInfoCopy}>
              <Text style={styles.referralInfoTitle}>Need More Trial Time?</Text>
              <Text style={styles.referralInfoBody}>
                Invite other professionals and earn 7 extra trial days for each successful referral.
              </Text>
              <Text style={styles.referralInfoFootnote}>
                Invite up to 3 colleagues and unlock up to 21 additional free days.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9A9A9A" />
          </TouchableOpacity>
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

// One feature bullet line — round check + text. `tint` lets the Pro
// card's bullets render in accent-ink for the soft-yellow surface,
// while everyone else stays neutral grey.
function Bullet({ text, tint }) {
  return (
    <View style={styles.designBulletRow}>
      <View style={[styles.designBulletCheck, tint ? { backgroundColor: '#F2C31B' } : null]}>
        <Ionicons name="checkmark" size={11} color={tint ? '#1E1E1E' : '#34C759'} />
      </View>
      <Text style={[styles.designBulletText, tint ? { color: tint } : null]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  // Refresh pass 10 (cosmetic) — design screenshot 38 puts the paywall
  // on a white canvas instead of the brand-yellow flood. The yellow
  // moves to the Pro card's soft-accent fill (#FFF4C2) where it does
  // its job as the highlight — the surrounding screen reads cleaner
  // and Pro pops more. Header order + CTA placement + card ordering
  // are all left as the user has them; only surfaces and borders change.
  container: {
    flex: 1,
    backgroundColor: theme.surfaceElevated,
  },
  // Design 38: title left, X close right. No back arrow, no subhead.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 14,
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    width: 36,
    height: 36,
  },
  backButtonInner: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    letterSpacing: -0.4,
    flex: 1,
    textAlign: 'left',
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
  // Refresh pass 10 (cosmetic) — softer card chrome per the design's
  // shadow-card spec: hairline border + warm soft shadow, radius 20.
  // Primary (Pro) keeps the +2px accent border per design; selected
  // cards still get the 2.5px accent ring so the picked state reads.
  planCardWrapper: {
    marginBottom: 12,
    borderRadius: 20,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  planCardWrapperPrimary: {
    borderWidth: 2,
    borderColor: '#F2C31B',
  },
  planCardWrapperSelected: {
    borderWidth: 2.5,
    borderColor: '#F2C31B',
  },
  planCard: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
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
    color: theme.textSecondary,
    marginTop: 2,
  },
  // Refresh pass 10 (cosmetic) — design 38: "Most popular" reads as a
  // filled yellow pill with a star glyph and dark text (was a black
  // outlined chip with no glyph). Smaller, leaning, more positive.
  recommendedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 6,
    backgroundColor: '#F2C31B',
  },
  recommendedIcon: {
    fontSize: 11,
    marginRight: 4,
  },
  recommendedText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    lineHeight: 14,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
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
  // Refresh pass 10 (cosmetic) — design 38: primary CTA is yellow per
  // the pp-btn--primary spec (was solid black with white text). 54px
  // height per the system, warm pop-shadow, dark text on accent.
  primaryCTAButton: {
    backgroundColor: '#F2C31B',
    borderRadius: 16,
    height: 54,
    paddingHorizontal: 24,
    marginTop: 4,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryCTAText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  primaryCTASubtext: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    textAlign: 'center',
    opacity: 0.7,
    marginTop: 2,
    letterSpacing: -0.1,
  },
  triggerBanner: {
    backgroundColor: '#FFF8E1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#F2C31B',
  },
  triggerBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    marginBottom: 2,
  },
  triggerBannerSubtitle: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: '#000000',
    textAlign: 'center',
    opacity: 0.7,
  },
  androidCardCTASubtext: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: '#FFFFFF',
    textAlign: 'center',
    opacity: 0.85,
    marginTop: 2,
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
    color: theme.textSecondary,
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
    backgroundColor: theme.surfaceElevated,
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
  // Refresh pass 10 (cosmetic) — design 38 footer reads as muted small
  // text ("Restore purchases · Terms · Privacy") rather than the prior
  // black-pill restore + underlined dark links + black dot. Same taps,
  // softer hierarchy.
  restorePurchasesText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textSecondary,
    lineHeight: 16,
    letterSpacing: -0.1,
  },
  legalLinksContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  legalLinkButton: {
    paddingVertical: 4,
  },
  legalLinkText: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textMuted,
    lineHeight: 14,
  },
  legalLinkDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#9A9A9A',
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
    backgroundColor: theme.surfaceElevated,
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
    color: theme.textSecondary,
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
    backgroundColor: theme.surfaceElevated,
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
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
    paddingHorizontal: 4,
  },

  // ============================================================
  // Design 38 paywall styles — billing toggle + concise card stack.
  // ============================================================

  billingToggle: {
    flexDirection: 'row',
    marginHorizontal: 18,
    marginTop: 4,
    marginBottom: 14,
    padding: 4,
    borderRadius: 999,
    backgroundColor: theme.surface,
  },
  billingChip: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billingChipActive: {
    backgroundColor: theme.surfaceElevated,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  billingChipText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '600',
    color: theme.textSecondary,
    letterSpacing: -0.1,
  },
  billingChipTextActive: {
    color: theme.textPrimary,
    fontWeight: '700',
  },

  // Card
  designCard: {
    marginHorizontal: 18,
    marginBottom: 12,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 2,
  },
  designCardPro: {
    backgroundColor: '#FFF4C2',
    borderColor: '#F2C31B',
    borderWidth: 2,
  },
  designCardSelected: {
    borderColor: '#F2C31B',
    borderWidth: 2,
  },
  // Current plan card — distinct green accent so the user immediately
  // recognises the tier they're already on, separate from the "Most
  // popular" yellow which still highlights Pro for non-Pro users.
  designCardCurrent: {
    borderColor: '#34C759',
    borderWidth: 2,
  },
  // "Current plan" badge — green pill mirroring the Most-popular slot
  // (top edge, right side) so the visual rhythm of the card stack is
  // preserved.
  currentPlanPill: {
    position: 'absolute',
    top: -10,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#34C759',
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  // Pro's card has a yellow fill so the current-plan green pill sits
  // on top of it; nothing changes structurally, just kept for clarity.
  currentPlanPillOnAccent: {},
  currentPlanPillText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  // "Most popular" pill — sits at the top-right of the Pro card.
  mostPopularPill: {
    position: 'absolute',
    top: -10,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F2C31B',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  mostPopularPillText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: 0.2,
    textTransform: 'lowercase',
  },

  // Card header — title left, price cluster right.
  designCardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  designCardTitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.4,
  },
  designPriceCluster: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  designCardPrice: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.4,
  },
  designCardPriceUnit: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '600',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginLeft: 2,
  },
  designCardPriceFree: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 22,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.4,
  },
  designCardPriceContact: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 14,
    fontWeight: '700',
    color: theme.textSecondary,
    letterSpacing: -0.1,
  },

  // Bullets
  designBullets: {
    gap: 9,
  },
  designBulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  designBulletCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(52,199,89,0.12)',
  },
  designBulletText: {
    flex: 1,
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13.5,
    fontWeight: '600',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    lineHeight: 19,
  },

  // In-card primary CTA on Pro (yellow → dark text).
  proInCardCTA: {
    marginTop: 16,
    backgroundColor: '#F2C31B',
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  proInCardCTAText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 15,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  proInCardCTADisabled: {
    backgroundColor: '#E7E7E7',
    shadowOpacity: 0,
  },

  // Secondary in-card CTA (Business on Android, Enterprise everywhere).
  designSecondaryCTA: {
    marginTop: 14,
    backgroundColor: '#1E1E1E',
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  designSecondaryCTAText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  designSecondaryCTADisabled: {
    backgroundColor: '#E7E7E7',
  },

  // Lightweight referral nudge near the bottom of the paywall. Soft
  // accent fill so it reads as secondary to the subscription CTAs but
  // is still discoverable; mirrors the code-box accent on ReferralScreen.
  referralInfoBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFF8E1',
    borderWidth: 1,
    borderColor: '#F2C31B',
    gap: 12,
  },
  referralInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF4C2',
    borderWidth: 1,
    borderColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  referralInfoCopy: {
    flex: 1,
  },
  referralInfoTitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 14,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  referralInfoBody: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 12.5,
    fontWeight: '500',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    lineHeight: 17,
  },
  referralInfoFootnote: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11,
    fontWeight: '500',
    color: '#7A5B00',
    letterSpacing: -0.1,
    lineHeight: 15,
    marginTop: 4,
  },
});

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
import { useTheme } from '../hooks/useTheme';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import { canStartTrial, isTrialExpired } from '../services/trialService';
import { IAP_PRODUCTS, purchaseProduct, purchaseOrUpgrade, restorePurchases, getAvailablePurchases, diagnoseIAPState, productIdToPlan, productIdToBillingPeriod, hasActiveIAPSubscription, openManageSubscriptions } from '../services/iapService';
import { logPaywallView, logPlanSelected, logTrialSkipped, logSubscriptionStarted, logSubscriptionRestored } from '../utils/analytics';
import useSubscriptionPrices from '../hooks/useSubscriptionPrices';
import { getSoftTrialState, ensureDeviceId } from '../services/softTrialService';
import { PAYWALL_TRIGGERS } from '../constants/softTrial';

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
  // Billing toggle — Annual is preselected by design since it's the primary
  // recommendation (25% cheaper vs 12× monthly). Product IDs `pro.annual` /
  // `business.annual` must be configured in App Store Connect + Google Play
  // Console with matching intro trial; if the store doesn't return an annual
  // price the UI transparently falls back to hiding the annual badge and per-
  // month equivalent so we never show broken math.
  const [billingCycle, setBillingCycle] = useState('annual');
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
  const { loading: pricesLoading, error: pricesError, prices, trialInfo, annualSummary, platformCancelText } = useSubscriptionPrices();

  // Annual availability gate. The `.annual` SKUs must be configured in App
  // Store Connect + Google Play Console before the annual toggle is safe to
  // expose — without them a purchase attempt for `PRO_ANNUAL` returns
  // "product not found", so we auto-fold the toggle back to monthly until
  // the store returns real annual pricing. Cleared once ASC/Play + a
  // resolvable annual SKU are live for either Pro or Business.
  const annualAvailable = !!(prices.proAnnual || prices.businessAnnual);

  // When the store finishes loading and annual isn't available, snap the
  // toggle back to monthly. Runs once per pricesLoading resolution so the
  // user can still manually flip if they want, but doesn't leave them on a
  // broken selection.
  useEffect(() => {
    if (!pricesLoading && !annualAvailable && billingCycle === 'annual') {
      setBillingCycle('monthly');
    }
  }, [pricesLoading, annualAvailable]);

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
          billing_period: 'annual',
        });
      } catch {
        logPaywallView({ trigger, billing_period: 'annual' });
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
            // Prefer the cadence-specific trial length from the store (annual
            // and monthly can carry different intro-offer durations in ASC /
            // Play Console). If annual metadata hasn't landed yet, fall through
            // to the monthly value. Final fallback is the 7-day base per
            // ProofPix's actual product config (NOT 15 — see session memory).
            const storeDays =
              (billingCycle === 'annual' && trialInfo?.proAnnual?.trialDays) ||
              trialInfo?.pro?.trialDays ||
              FALLBACK_TRIAL_DAYS;
            // Friend (referral on file) gets base + 7 = 14 days (additive).
            setTrialDays(referralData !== null ? storeDays + REFERRAL_BONUS_DAYS : storeDays);
          }
        } catch (error) {
          if (isMounted.current) {
            const storeDays =
              (billingCycle === 'annual' && trialInfo?.proAnnual?.trialDays) ||
              trialInfo?.pro?.trialDays ||
              FALLBACK_TRIAL_DAYS;
            setTrialDays(storeDays);
          }
        }
      } catch (error) {
        console.error('[PlanSelection] Error checking trial availability:', error);
        if (isMounted.current) {
          setTrialAvailable(!forceUpgradeMode);
          const storeDays =
            (billingCycle === 'annual' && trialInfo?.proAnnual?.trialDays) ||
            trialInfo?.pro?.trialDays ||
            FALLBACK_TRIAL_DAYS;
          setTrialDays(storeDays);
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
  // async — may not be loaded when the mount effect runs). Also re-runs when
  // the user flips the billing toggle so the paywall's "N-day free trial"
  // copy matches whichever SKU (monthly vs annual) they're about to buy.
  useEffect(() => {
    const storeDays =
      (billingCycle === 'annual' && trialInfo?.proAnnual?.trialDays) ||
      trialInfo?.pro?.trialDays;
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
  }, [trialInfo?.pro?.trialDays, trialInfo?.proAnnual?.trialDays, billingCycle]);

  const handleGoBack = () => {
    navigation.goBack();
  };

  const handleSelectPlan = async (plan) => {
    // Real trial eligibility from store metadata. Starter (free tier) is
    // never a trial; for paid plans the store-side intro offer flag is the
    // source of truth. Hardcoding `false` here was hiding most trial starts
    // from the GA4 funnel (`plan_selected → trial_started`).
    // For paid tiers respect the current billingCycle toggle so we look up
    // the correct annual vs monthly trial flag.
    const trialInfoKey =
      billingCycle === 'annual' && (plan === 'pro' || plan === 'business')
        ? `${plan}Annual`
        : plan;
    const productHasTrialFromCache =
      plan !== 'starter' && !!trialInfo?.[trialInfoKey]?.hasTrial;
    const isTrial = productHasTrialFromCache;
    const billingPeriod = plan === 'starter' ? null : billingCycle;
    console.log('[analytics-debug] plan_selected source data', {
      plan,
      billingPeriod,
      trialInfoKey,
      productHasTrialFromCache,
      trialInfoForPlan: trialInfo?.[trialInfoKey] || null,
      isTrial,
    });
    logPlanSelected(plan, isTrial, billingPeriod);

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
        // Pick the annual or monthly product ID off the current billing toggle.
        // Enterprise has no annual SKU (contact-sales only); it always maps to
        // the monthly product for the app-internal purchase path.
        //
        // Safety fallback: if the store hasn't returned annual pricing for
        // this tier (ASC/Play annual SKU not yet configured), force the
        // monthly SKU rather than attempting to buy a non-existent product.
        // Belt-and-suspenders — the annualAvailable gate already prevents
        // 'annual' from being selected in that state, but a stale cache or
        // partial-price payload could still get us here.
        let productId = null;
        const wantAnnual = billingCycle === 'annual';
        if (plan === 'pro') {
          const proAnnualLive = !!prices.proAnnual;
          productId = wantAnnual && proAnnualLive
            ? IAP_PRODUCTS.PRO_ANNUAL
            : IAP_PRODUCTS.PRO_MONTHLY;
          if (wantAnnual && !proAnnualLive) {
            console.warn('[PlanSelection] Pro annual not yet available in store — falling back to monthly SKU');
          }
        } else if (plan === 'business') {
          const businessAnnualLive = !!prices.businessAnnual;
          productId = wantAnnual && businessAnnualLive
            ? IAP_PRODUCTS.BUSINESS_ANNUAL
            : IAP_PRODUCTS.BUSINESS_MONTHLY;
          if (wantAnnual && !businessAnnualLive) {
            console.warn('[PlanSelection] Business annual not yet available in store — falling back to monthly SKU');
          }
        } else if (plan === 'enterprise') {
          productId = IAP_PRODUCTS.ENTERPRISE_MONTHLY;
        }

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

  // Annual is now the default recommendation. Both toggle chips are live
  // and drive card price/CTA rendering + downstream productId resolution.
  const handlePickAnnual = () => setBillingCycle('annual');
  const handlePickMonthly = () => setBillingCycle('monthly');

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

  // One feature bullet line — round check + text. `tint` lets the Pro
  // card's bullets render in accent-ink for the soft-yellow surface,
  // while everyone else stays neutral grey. Defined inside the component
  // so it closes over the theme-aware `styles` from `useMemo` above.
  const Bullet = ({ text, tint }) => (
    <View style={styles.designBulletRow}>
      <View style={[styles.designBulletCheck, tint ? { backgroundColor: '#F2C31B' } : null]}>
        <Ionicons name="checkmark" size={11} color={tint ? '#1E1E1E' : '#34C759'} />
      </View>
      <Text style={[styles.designBulletText, tint ? { color: tint } : null]} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );

  // Per-tier price display strategy.
  //
  // Annual toggle: show total annual price + per-month equivalent + "Save X%"
  //   pill (if we can parse the numbers from the store's formatted strings).
  // Monthly toggle: show monthly price + "Flexible monthly billing" caption.
  //
  // Every value is derived from what the store actually returned via
  // useSubscriptionPrices — no hardcoded USD amounts. Missing annual SKUs
  // (Play/ASC not yet configured) collapse to null and the UI hides the
  // annual-only chrome instead of rendering broken math.
  const proMonthlyPrice = prices.pro || null;
  const proAnnualPrice = prices.proAnnual || null;
  const proAnnualPerMonth = annualSummary?.pro?.perMonthDisplay || null;
  const proAnnualSavings = annualSummary?.pro?.savingsPct || null;
  const businessMonthlyPrice = prices.business || null;
  const businessAnnualPrice = prices.businessAnnual || null;
  const businessAnnualPerMonth = annualSummary?.business?.perMonthDisplay || null;
  const businessAnnualSavings = annualSummary?.business?.savingsPct || null;

  const showAnnualForPro = billingCycle === 'annual' && !!proAnnualPrice;
  const showAnnualForBusiness = billingCycle === 'annual' && !!businessAnnualPrice;

  // Trust bullets shown under the plan cards (both cadences). Static content —
  // reads the same regardless of trial availability, since even "paid up front"
  // subscriptions can be cancelled anytime through the store.
  const TRUST_BULLETS = [
    'Cancel anytime',
    Platform.OS === 'android'
      ? 'Secure billing through Google Play'
      : 'Secure billing through Apple',
    'Keep all your projects',
    'Professional support included',
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.background} />

      {/* Top bar — X close only; the value-prop hero lives inside the
          scroll view so it scrolls away with content. */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <TouchableOpacity
          style={styles.headerClose}
          onPress={handleGoBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand row — small ProofPix logo + wordmark above the hero, per
            design source. Doubles as visual anchor for the paywall's
            positioning. */}
        <View style={styles.brandRow}>
          <View style={styles.brandTile}>
            <Ionicons name="camera" size={18} color="#1E1E1E" />
          </View>
          <Text style={styles.brandName}>ProofPix</Text>
        </View>

        {/* Hero — pro-positioning header + subtitle (sentence case per
            design source). When a specific feature triggered the paywall,
            the trigger banner below carries the per-trigger headline; this
            hero stays as the platform positioning. */}
        <Text style={styles.heroTitle}>Turn job photos into professional deliverables</Text>
        <Text style={styles.heroSubtitle}>
          Capture, organize, document & share every job with branded reports, cloud sync, and workflows built for service professionals.
        </Text>

        {/* Monthly / Annual segmented control — Monthly on left, Annual on
            right per design source. Annual is preselected. "SAVE 25%" is
            an inline accent inside the Annual chip (yellow), not a separate
            label. If the store isn't returning annual pricing yet (ASC/Play
            SKU not live), the annual chip disables itself and the useEffect
            above folds billingCycle back to 'monthly'. */}
        <View style={styles.billingToggle}>
          <TouchableOpacity
            style={[styles.billingChip, billingCycle === 'monthly' && styles.billingChipActive]}
            onPress={handlePickMonthly}
            activeOpacity={0.85}
          >
            <Text style={[styles.billingChipText, billingCycle === 'monthly' && styles.billingChipTextActive]}>
              Monthly
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.billingChip,
              billingCycle === 'annual' && styles.billingChipActive,
              !annualAvailable && styles.billingChipDisabled,
            ]}
            onPress={annualAvailable ? handlePickAnnual : undefined}
            disabled={!annualAvailable}
            activeOpacity={0.85}
          >
            <View style={styles.billingChipInner}>
              <Text style={[
                styles.billingChipText,
                billingCycle === 'annual' && styles.billingChipTextActive,
                !annualAvailable && styles.billingChipTextDisabled,
              ]}>
                Annual
              </Text>
              <Text style={[
                styles.billingChipAccent,
                !annualAvailable && styles.billingChipTextDisabled,
              ]}>
                {annualAvailable ? 'SAVE 25%' : 'COMING SOON'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Contextual trigger banner — shown when paywall is opened from a
            specific feature or limit. Preserved from prior spec. */}
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
                      : trigger === PAYWALL_TRIGGERS.SETS_LIMIT
                        ? "You've used all 10 free before/after sets"
                        : trigger === PAYWALL_TRIGGERS.PROGRESS_PHOTOS
                          ? 'Progress photos are a Pro feature'
                          : trigger === PAYWALL_TRIGGERS.MULTI_PHOTO_SHARE
                            ? 'Share multiple photos at once'
                            : 'Upgrade to keep going'}
            </Text>
            <Text style={styles.triggerBannerSubtitle}>
              Remove watermark {'•'} Unlimited projects {'•'} Reports
            </Text>
          </View>
        ) : null}

        {/* ===== Pro — emphasized expanded card. This is the recommended
            plan on both cadences; the bottom-anchored CTA below drives its
            purchase. Radio dot on the left indicates it's the selected
            plan by default (Pro is always the emphasized row per design). */}
        <View
          style={[
            styles.proCard,
            currentTier === 'pro' && styles.proCardCurrent,
          ]}
        >
          {/* MOST POPULAR pill — shown on annual cadence only, per spec.
              Sits at the top-right corner of the Pro card. */}
          {currentTier === 'pro' ? (
            <View style={[styles.currentPlanPill, styles.currentPlanPillOnAccent]}>
              <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              <Text style={styles.currentPlanPillText}>Current plan</Text>
            </View>
          ) : billingCycle === 'annual' ? (
            <View style={styles.mostPopularPillDark}>
              <Ionicons name="star" size={11} color="#F2C31B" />
              <Text style={styles.mostPopularPillDarkText}>MOST POPULAR</Text>
            </View>
          ) : null}

          <View style={styles.proCardHeader}>
            {/* Selected radio dot (Pro is always selected in this layout). */}
            <View style={styles.radioDotSelected}>
              <Ionicons name="checkmark" size={12} color="#1E1E1E" />
            </View>

            <View style={styles.proCardTitleBlock}>
              <Text style={styles.proCardTitle}>Pro</Text>
              <Text style={styles.proCardCadence}>
                {billingCycle === 'annual' ? 'ANNUAL' : 'MONTHLY'}
              </Text>
            </View>

            <View style={styles.proCardPriceBlock}>
              {pricesLoading ? (
                <ActivityIndicator size="small" color="#1E1E1E" />
              ) : showAnnualForPro ? (
                <>
                  {/* Lead with the per-month equivalent so the sticker price
                      reads at monthly scale — the raw yearly number scared
                      users off before they saw the value. The actual annual
                      total moves into the caption below with "billed
                      annually" context. Falls back to the yearly number as
                      the big line if the store hasn't returned a per-month
                      breakdown yet. */}
                  <View style={styles.designPriceCluster}>
                    <Text style={styles.proCardPrice}>{proAnnualPerMonth || proAnnualPrice}</Text>
                    <Text style={styles.proCardPriceUnit}>{proAnnualPerMonth ? '/month' : '/year'}</Text>
                  </View>
                  <Text style={styles.proCardPriceCaption}>
                    {proAnnualPerMonth
                      ? `${proAnnualPrice}/year · billed annually`
                      : 'Billed annually'}
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.designPriceCluster}>
                    <Text style={styles.proCardPrice}>{proMonthlyPrice || '—'}</Text>
                    <Text style={styles.proCardPriceUnit}>/month</Text>
                  </View>
                  <Text style={styles.proCardPriceCaption}>Flexible monthly billing</Text>
                </>
              )}
            </View>
          </View>

          {/* Full 6-bullet stack per design source — value + features.
              Bullets explicitly mention the features gated for Starter
              (unlimited sets, progress photos, multi-photo share) so
              the upgrade value is clear. */}
          {showAnnualForPro ? (
            <View style={styles.proBullets}>
              <Bullet text={proAnnualSavings ? `Save ${proAnnualSavings}% vs monthly` : 'Save 25% vs monthly'} tint="#7A5B00" />
              <Bullet text="Get 3 months free" tint="#7A5B00" />
              <Bullet text="Lowest price — locked for 12 months" tint="#7A5B00" />
              <Bullet text="Unlimited sets, projects & photos" tint="#7A5B00" />
              <Bullet text="Progress photos & multi-photo share" tint="#7A5B00" />
              <Bullet text="Branded PDF reports, cloud sync, markup & watermark" tint="#7A5B00" />
            </View>
          ) : (
            <View style={styles.proBullets}>
              <Bullet text="Flexible monthly billing · cancel anytime" tint="#7A5B00" />
              <Bullet text="Unlimited sets, projects & photos" tint="#7A5B00" />
              <Bullet text="Progress photos & multi-photo share" tint="#7A5B00" />
              <Bullet text="Branded PDF reports & cloud sync" tint="#7A5B00" />
              <Bullet text="Watermark, logo, voice notes & markup" tint="#7A5B00" />
            </View>
          )}
        </View>

        {/* ===== Business — compact single-row selectable per design.
            Empty radio circle + title/subtitle on the left, price on
            the right. Tapping the row runs handleSelectPlan('business')
            which enters the store purchase flow (Android inline; iOS via
            the native purchase modal). */}
        <TouchableOpacity
          style={[
            styles.compactRow,
            currentTier === 'business' && styles.compactRowCurrent,
          ]}
          onPress={
            currentTier === 'business'
              ? undefined
              : () => handleSelectPlan('business')
          }
          disabled={currentTier === 'business'}
          activeOpacity={currentTier === 'business' ? 1 : 0.85}
        >
          <View style={styles.radioDotEmpty} />
          <View style={styles.compactRowBody}>
            <Text style={styles.compactRowTitle}>Business</Text>
            <Text style={styles.compactRowSubtitle}>
              {showAnnualForBusiness
                ? (businessAnnualPrice
                    ? `Everything in Pro + teams · ${businessAnnualPrice}/yr billed annually`
                    : 'Everything in Pro + teams')
                : 'Everything in Pro + teams & logo overlays'}
            </Text>
          </View>
          <View style={styles.compactRowPrice}>
            {pricesLoading ? (
              <ActivityIndicator size="small" color={theme.textPrimary} />
            ) : showAnnualForBusiness ? (
              <>
                {/* Right column now shows the per-month equivalent on the
                    annual cadence so the sticker price matches Pro's card.
                    Yearly total moved into the subtitle above. Falls back to
                    the yearly number if the store hasn't returned a per-month
                    breakdown yet. */}
                <Text style={styles.compactRowPriceMain}>{businessAnnualPerMonth || businessAnnualPrice}</Text>
                <Text style={styles.compactRowPriceUnit}>{businessAnnualPerMonth ? '/month' : '/year'}</Text>
              </>
            ) : (
              <>
                <Text style={styles.compactRowPriceMain}>{businessMonthlyPrice || '—'}</Text>
                <Text style={styles.compactRowPriceUnit}>/month</Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        {/* ===== Enterprise — compact row → Contact Sales modal. Never
            enters a purchase flow (no in-app product). */}
        <TouchableOpacity
          style={[
            styles.compactRow,
            currentTier === 'enterprise' && styles.compactRowCurrent,
          ]}
          onPress={currentTier === 'enterprise' ? undefined : () => setShowEnterpriseModal(true)}
          disabled={currentTier === 'enterprise'}
          activeOpacity={currentTier === 'enterprise' ? 1 : 0.85}
        >
          <View style={styles.radioDotEmpty} />
          <View style={styles.compactRowBody}>
            <Text style={styles.compactRowTitle}>Enterprise</Text>
            <Text style={styles.compactRowSubtitle}>
              Teams, API access & priority support
            </Text>
          </View>
          <View style={styles.compactRowPrice}>
            <Text style={styles.compactRowContactSales}>Contact Sales</Text>
          </View>
        </TouchableOpacity>

        {/* ===== Starter — compact row at the bottom of the plan list.
            The free tier stays discoverable so users can opt in (or stay
            on free) after seeing the paid options. Also serves as the
            downgrade target for existing paid subscribers via the
            "Cancel your subscription first" alert in handleSelectPlan. */}
        <TouchableOpacity
          style={[
            styles.compactRow,
            currentTier === 'starter' && styles.compactRowCurrent,
          ]}
          onPress={currentTier === 'starter' ? undefined : () => handleSelectPlan('starter')}
          disabled={currentTier === 'starter'}
          activeOpacity={currentTier === 'starter' ? 1 : 0.85}
        >
          <View style={styles.radioDotEmpty} />
          <View style={styles.compactRowBody}>
            <Text style={styles.compactRowTitle}>Starter</Text>
            <Text style={styles.compactRowSubtitle}>
              10 before/after sets · single-photo share
            </Text>
          </View>
          <View style={styles.compactRowPrice}>
            <Text style={styles.compactRowContactSales}>Free</Text>
          </View>
        </TouchableOpacity>

        {/* Trust section — 2×2 grid per design. Same on both cadences and
            both platforms. */}
        <View style={styles.trustGrid}>
          {TRUST_BULLETS.map((t) => (
            <View key={t} style={styles.trustGridCell}>
              <Ionicons name="checkmark" size={14} color="#34C759" style={styles.trustCheck} />
              <Text style={styles.trustBulletText}>{t}</Text>
            </View>
          ))}
        </View>

        {/* Android-only legal disclosure. iOS shows fine print below the
            bottom CTA instead (satisfies each store's policy). */}
        {Platform.OS === 'android' && (
          <Text style={styles.androidCardDisclosure}>
            {showAnnualForPro
              ? (trialAvailable
                  ? `${trialDays}-day free trial, then ${proAnnualPrice}/year. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                  : `${proAnnualPrice}/year. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`)
              : (trialAvailable && proMonthlyPrice
                  ? `${trialDays}-day free trial, then ${proMonthlyPrice}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                  : proMonthlyPrice
                    ? `${proMonthlyPrice}/month. Auto-renews until canceled. Cancel anytime in Google Play > Subscriptions.`
                    : '')}
          </Text>
        )}
        {/* Terms and Privacy Policy Links — kept in scroll content so
            they don't compete with the bottom CTA for taps. */}
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

      {/* Bottom-anchored CTA + fine print with inline Restore per design
          source. Sticks to the bottom of the screen respecting safe-area
          bottom inset. CTA copy is plan-specific (annual vs monthly trial
          length) and mirrors the store's intro-offer metadata. */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          style={[styles.ctaButton, currentTier === 'pro' && styles.ctaButtonDisabled]}
          onPress={currentTier === 'pro' ? undefined : () => handleSelectPlan('pro')}
          disabled={currentTier === 'pro'}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaButtonText}>{proCTAText}</Text>
        </TouchableOpacity>

        <View style={styles.finePrintRow}>
          <Text style={styles.finePrintText}>No charge today</Text>
          <Text style={styles.finePrintDot}>·</Text>
          <Text style={styles.finePrintText}>Cancel anytime</Text>
          <Text style={styles.finePrintDot}>·</Text>
          <TouchableOpacity
            onPress={handleRestorePurchases}
            disabled={isRestoringPurchases}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.finePrintRestore}>
              {isRestoringPurchases
                ? t('settings.restoring', { defaultValue: 'Restoring…' })
                : t('settings.restorePurchases', { defaultValue: 'Restore' })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Enterprise Contact Form Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

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
    backgroundColor: theme.background,
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
    color: theme.textPrimary,
    letterSpacing: -0.23,
  },
  subheaderText: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    opacity: 0.7,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    // Padding sides only — child content sets its own horizontal margins.
    // Bottom padding accommodates the fixed bottomBar (CTA + fine print).
    paddingHorizontal: 0,
    paddingBottom: 24,
  },
  trialBannerWrapper: {
    marginBottom: 14,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: theme.textPrimary,
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
    color: theme.textPrimary,
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
    color: theme.textPrimary,
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
    color: theme.textMuted,
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
    color: theme.textPrimary,
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
    color: '#1E1E1E',
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
    color: theme.textPrimary,
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
    color: '#1E1E1E',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  primaryCTASubtext: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: '#1E1E1E',
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
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
    opacity: 0.6,
  },
  trustText: {
    fontSize: 12,
    fontWeight: '400',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.5,
  },
  urgencyText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
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
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 18,
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
    backgroundColor: theme.textMuted,
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
    backgroundColor: theme.textMuted,
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
    color: theme.textPrimary,
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
    color: theme.textPrimary,
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
    borderColor: theme.textPrimary,
    backgroundColor: theme.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trialModalSkipButtonText: {
    fontSize: 18,
    fontWeight: 'normal',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
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
  billingChipDisabled: {
    opacity: 0.55,
  },
  billingChipTextDisabled: {
    color: theme.textMuted,
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
    color: '#1E1E1E',
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
  // Pro card sits on a yellow (`#FFF4C2`) surface that stays light in
  // dark mode — text must stay dark for contrast, don't use theme.textPrimary.
  designCardTitleOnAccent: {
    color: '#1E1E1E',
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
  // Same reasoning as designCardTitleOnAccent — keep dark on yellow Pro card.
  designCardPriceOnAccent: {
    color: '#1E1E1E',
  },
  designCardPriceUnit: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '600',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginLeft: 2,
  },
  designCardPriceUnitOnAccent: {
    color: '#7A5B00',
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
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  proInCardCTADisabled: {
    backgroundColor: theme.borderStrong,
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
    backgroundColor: theme.borderStrong,
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
    color: '#1E1E1E',
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  referralInfoBody: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 12.5,
    fontWeight: '500',
    color: '#1E1E1E',
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

  // ============================================================
  // Design-source paywall — brand row + hero + toggle + Pro card +
  // compact rows + trust grid + bottom CTA. Matches the artboards in
  // design-screens/ (Plan picker · Annual (default) + · Monthly).
  // ============================================================

  // Brand row above hero — small tile + wordmark.
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 14,
    gap: 8,
  },
  brandTile: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 15,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.2,
  },

  // Monthly / Annual toggle inner layout — Annual chip contains both
  // "Annual" label and a small "SAVE 25%" accent inline.
  billingChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  billingChipAccent: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11,
    fontWeight: '900',
    color: '#B98600',
    letterSpacing: 0.4,
  },

  // Pro card — big yellow-tinted emphasized card. Wraps everything the
  // user needs to decide on the Pro plan.
  proCard: {
    marginHorizontal: 18,
    marginBottom: 10,
    backgroundColor: '#FFF4C2',
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#F2C31B',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
  proCardCurrent: {
    borderColor: '#34C759',
  },
  proCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  proCardTitleBlock: {
    flex: 1,
  },
  proCardTitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 22,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  proCardCadence: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 10.5,
    fontWeight: '800',
    color: '#7A5B00',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  proCardPriceBlock: {
    alignItems: 'flex-end',
  },
  proCardPrice: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 26,
    fontWeight: '900',
    color: '#1E1E1E',
    letterSpacing: -0.6,
  },
  proCardPriceUnit: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '600',
    color: '#7A5B00',
    letterSpacing: -0.1,
    marginLeft: 2,
  },
  proCardPriceCaption: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '600',
    color: '#7A5B00',
    letterSpacing: -0.1,
    marginTop: 2,
    textAlign: 'right',
  },
  proBullets: {
    gap: 9,
  },

  // Radio dot — filled yellow for the selected/emphasized plan.
  radioDotSelected: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  // Empty circle for the compact rows (Business / Enterprise).
  radioDotEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    marginRight: 12,
  },

  // Dark MOST POPULAR pill — sits on top-right of the Pro card. Matches
  // the design source's darker treatment (was previously a yellow pill).
  mostPopularPillDark: {
    position: 'absolute',
    top: -12,
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#1E1E1E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  mostPopularPillDarkText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 10.5,
    fontWeight: '900',
    color: '#F2C31B',
    letterSpacing: 0.6,
  },

  // Compact selectable rows — Business + Enterprise. Radio dot + body
  // (title + subtitle) + price cluster on the right.
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: theme.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
  },
  compactRowCurrent: {
    borderColor: '#34C759',
    borderWidth: 2,
  },
  compactRowBody: {
    flex: 1,
    marginRight: 12,
  },
  compactRowTitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 15,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  compactRowSubtitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
    lineHeight: 15,
  },
  compactRowPrice: {
    alignItems: 'flex-end',
  },
  compactRowPriceMain: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 16,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.2,
  },
  compactRowPriceUnit: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11,
    fontWeight: '600',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 1,
  },
  compactRowContactSales: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },

  // 2×2 trust grid.
  trustGrid: {
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
  },
  trustGridCell: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '50%',
    paddingRight: 8,
  },

  // Bottom-anchored CTA + fine print. Absolute-positioned below the
  // scroll view, sits above the safe-area bottom inset.
  bottomBar: {
    paddingHorizontal: 18,
    paddingTop: 12,
    backgroundColor: theme.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  ctaButton: {
    backgroundColor: '#F2C31B',
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  ctaButtonDisabled: {
    backgroundColor: theme.borderStrong,
    shadowOpacity: 0,
  },
  ctaButtonText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 16,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.2,
  },
  finePrintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  finePrintText: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
  },
  finePrintDot: {
    fontSize: 11.5,
    color: theme.textMuted,
  },
  finePrintRestore: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.textPrimary,
    letterSpacing: -0.1,
    textDecorationLine: 'underline',
  },

  heroTitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.5,
    lineHeight: 30,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13.5,
    fontWeight: '500',
    color: theme.textSecondary,
    letterSpacing: -0.1,
    lineHeight: 19,
    paddingHorizontal: 20,
    marginBottom: 18,
  },

  // Annual emphasis: thicker border + stronger shadow when the user is
  // looking at the Pro annual card. Sits on top of designCardPro base.
  designCardProAnnual: {
    borderWidth: 3,
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },

  // Column price layout so the "Only $X/month" caption sits directly
  // under the main price cluster without wrapping.
  designPriceClusterCol: {
    alignItems: 'flex-end',
  },
  // Per-month equivalent (Pro card, on yellow surface — dark ink).
  designPricePerMonth: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '700',
    color: '#7A5B00',
    letterSpacing: -0.1,
    marginTop: 2,
  },
  // Per-month equivalent (Business card, on neutral surface — muted).
  designPricePerMonthMuted: {
    fontFamily: 'Alexandria_400Regular',
    fontSize: 11.5,
    fontWeight: '700',
    color: theme.textMuted,
    letterSpacing: -0.1,
    marginTop: 2,
  },

  // Trophy emoji sits inside the Most Popular pill on annual cadence.
  mostPopularPillEmoji: {
    fontSize: 11,
    marginRight: 1,
  },

  // Trust bullets block between cards and legal footer.
  trustBlock: {
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    gap: 8,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trustCheck: {
    marginRight: 8,
  },
  trustBulletText: {
    flex: 1,
    fontFamily: 'Alexandria_400Regular',
    fontSize: 13,
    fontWeight: '600',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
});

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, StyleSheet, Platform, Text, Image, Dimensions, StatusBar, Linking, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as NavigationBarModule from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { useTheme } from '../hooks/useTheme';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { logAdminReferralConversion, extractAndSaveUTMParams, logSubscriptionActive } from '../utils/analytics';
import { initStarterExports } from '../services/starterExportService';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function AuthLoadingScreen({ navigation }) {
  const { userName, userPlan, updateUserPlan, loading: settingsLoading } = useSettings();
  const { isLoading: adminLoading } = useAdmin();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [iapChecked, setIapChecked] = useState(false);

  // Hide Android navigation bar during splash
  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBarModule.setVisibilityAsync('hidden');
      NavigationBarModule.setBehaviorAsync('overlay-swipe');
    }
    return () => {
      if (Platform.OS === 'android') {
        NavigationBarModule.setVisibilityAsync('visible');
      }
    };
  }, []);

  // Auto-restore IAP subscriptions on app launch (iOS only)
  // IMPORTANT: Disabled in development mode to prevent constant password prompts
  // Users can manually restore via "Restore Purchases" button when needed
  useEffect(() => {
    const autoRestoreSubscriptions = async () => {
      if (Platform.OS !== 'ios') {
        setIapChecked(true);
        return;
      }

      // SKIP auto-restore in development mode (hot reload causes constant prompts)
      // In production, this will still work for automatic subscription restoration
      if (__DEV__) {
        console.log('[AuthLoading] Development mode - skipping auto-restore (use "Restore Purchases" button to test)');
        setIapChecked(true);
        return;
      }

      // Skip auto-restore if user already has a plan (to reduce password prompts)
      // Users can manually restore via "Restore Purchases" button if needed
      if (userPlan && userPlan !== 'starter') {
        console.log('[AuthLoading] User already has plan:', userPlan, '- skipping auto-restore');
        setIapChecked(true);
        return;
      }

      // Only auto-restore for completely new users or those with no plan
      // This helps during first app launch after reinstall
      try {
        const { restorePurchases } = await import('../services/iapService');
        console.log('[AuthLoading] Checking for existing subscriptions (one-time check)...');
        const purchases = await restorePurchases();
        
        if (purchases && purchases.length > 0) {
          // Find active subscription - v14: if returned by getAvailablePurchases, it's active
          const activeSubscription = purchases.find(purchase => !!purchase.productId);

          if (activeSubscription) {
            const productId = activeSubscription.productId;
            console.log('[AuthLoading] Active subscription found:', productId);

            // Map product ID to plan name (works for both iOS and Android product IDs)
            let planName = 'starter';
            if (productId.includes('enterprise') && !productId.includes('seat')) planName = 'enterprise';
            else if (productId.includes('business') && !productId.includes('seat')) planName = 'business';
            else if (productId.includes('pro')) planName = 'pro';

            // Update user plan
            console.log('[AuthLoading] Updating plan from subscription:', planName);
            await updateUserPlan(planName);

            // Tell analytics the user currently holds an entitlement.
            // No revenue / no purchase event — this is a launch-time observation,
            // not a fresh subscription_started.
            try {
              logSubscriptionActive({
                plan_id: planName,
                product_id: productId,
                platform: Platform.OS,
                provider: Platform.OS === 'ios' ? 'apple' : 'google',
                entry_point: 'app_launch',
                subscription_type: 'unknown',
                transaction_id:
                  activeSubscription.transactionId ||
                  activeSubscription.purchaseToken ||
                  null,
                original_transaction_id:
                  activeSubscription.originalTransactionIdentifierIOS ||
                  activeSubscription.originalTransactionId ||
                  null,
                analytics_source: 'app_launch',
              });
            } catch {}
          } else {
            console.log('[AuthLoading] No active subscriptions found');
          }
        } else {
          console.log('[AuthLoading] No purchases to restore');
        }
      } catch (error) {
        console.warn('[AuthLoading] Failed to auto-restore subscriptions:', error?.message);
        // Don't block app startup if restore fails - user can restore manually
      } finally {
        setIapChecked(true);
      }
    };

    if (!settingsLoading) {
      autoRestoreSubscriptions();
    }
  }, [settingsLoading, userPlan]);

  // Initialize starter-export counter on every launch. Idempotent — first
  // run writes initial state and fires `soft_trial_started` (analytics event
  // name preserved for dashboard continuity); subsequent runs are a no-op.
  // Runs in parallel with referral init.
  useEffect(() => {
    initStarterExports().catch((e) =>
      console.warn('[AuthLoading] starter exports init failed:', e?.message)
    );
  }, []);

  // Legacy trial migration — one-shot on first cold start of the store-managed
  // trial build. Any user upgrading from a build with an active app-managed
  // trial (secure-storage key `@user_trial_info`) gets an equivalent bonus
  // premium entitlement so they don't lose the days they had left. Server
  // dedups on `legacy-trial-migration:${userId}` (returns the original grant
  // record with `granted > 0` on replay), so this is safe to run every launch.
  //
  // Delete-order matters: we ONLY remove @user_trial_info after the server
  // confirms it recorded the grant (granted > 0). If the first attempt races
  // ahead of referralService setting @user_id — bonusEntitlementService can't
  // hit the server without a userId and returns 0 — we keep the legacy
  // record and retry on the next cold start.
  useEffect(() => {
    (async () => {
      try {
        const { readSecureJSON, deleteSecure } = await import('../services/secureStorageService');
        const legacy = await readSecureJSON('@user_trial_info');
        if (!legacy) return;

        const endMs = legacy.endDate ? new Date(legacy.endDate).getTime() : 0;
        const daysRemaining = Number.isFinite(endMs) && endMs > Date.now()
          ? Math.max(1, Math.ceil((endMs - Date.now()) / 86400000))
          : 0;

        // Nothing to migrate — either expired or malformed. Safe to clean up.
        if (daysRemaining <= 0 || !legacy.active) {
          try { await deleteSecure('@user_trial_info'); } catch {}
          return;
        }

        // Force-generate @user_id before hitting the server so a fresh install
        // upgrading from the old build doesn't lose their days to a race
        // between the referral-code initializer and this migration effect.
        try {
          const { getUserId } = await import('../services/referralService');
          await getUserId();
        } catch {}

        const { grantLegacyTrialMigrationBonus } = await import('../services/bonusEntitlementService');
        const granted = await grantLegacyTrialMigrationBonus(daysRemaining);

        if (granted > 0) {
          console.log(`[AuthLoading] Migrated legacy trial (${daysRemaining}d) → bonus entitlement (granted: ${granted}d)`);
          try { await deleteSecure('@user_trial_info'); } catch {}
        } else {
          // Server refused OR client couldn't resolve userId. Keep the legacy
          // record and retry next cold start — better than silently dropping
          // the user's remaining trial days.
          console.warn(`[AuthLoading] Legacy trial migration returned 0 for ${daysRemaining}d — keeping @user_trial_info for retry`);
        }
      } catch (e) {
        console.warn('[AuthLoading] Legacy trial migration failed (non-critical):', e?.message);
      }
    })();
  }, []);

  // Auto-register referral code on server & check for pending rewards
  useEffect(() => {
    const initReferralSystem = async () => {
      try {
        const { initializeReferralCode, checkAndApplyReferralRewards, getUserId } = await import('../services/referralService');
        // Register code on server (idempotent - safe to call every launch)
        await initializeReferralCode();
        // Reconcile referrer-side reward count with the server. The proxy
        // grants the bonus premium entitlement server-side; this call fires
        // the `reward_applied` / `bonus_awarded` analytics for newly-completed
        // referrals and refreshes the local bonus cache so the UI updates.
        const rewardsApplied = await checkAndApplyReferralRewards();
        if (rewardsApplied > 0) {
          console.log(`[AuthLoading] Reported ${rewardsApplied} referral reward(s) to analytics`);
          // Wording changed from "extra trial days" → "extra premium days"
          // since bonus days no longer extend the Apple/Google trial.
          const daysAdded = rewardsApplied * 7;
          setTimeout(() => {
            try {
              const { Alert } = require('react-native');
              Alert.alert(
                'Referral Reward Earned',
                `You earned ${daysAdded} extra premium day${daysAdded === 1 ? '' : 's'}.`,
              );
            } catch {}
          }, 2500);
        }

        // Check for pending admin referral code redemption
        try {
          const { getAndClearPendingAdminReferralCode, redeemAdminReferralCode, hasRedeemedAdminReferral, markAdminReferralRedeemed } = await import('../services/adminReferralService');
          const alreadyRedeemed = await hasRedeemedAdminReferral();
          if (!alreadyRedeemed) {
            const pendingCode = await getAndClearPendingAdminReferralCode();
            if (pendingCode) {
              const userId = await getUserId();
              const result = await redeemAdminReferralCode(pendingCode, userId);
              if (result?.success && result?.grantedDays > 0) {
                // Proxy /api/referrals/redeem already granted the bonus
                // entitlement server-side. Refresh the local cache so
                // downstream plan resolution sees the new bonus days.
                await markAdminReferralRedeemed();
                try {
                  const { refreshBonusEntitlement } = await import('../services/bonusEntitlementService');
                  await refreshBonusEntitlement();
                } catch {}
                logAdminReferralConversion({ code: pendingCode, link_type: 'admin', channel: result.channel, source: result.source, campaign: result.campaign, placement: result.placement, label: result.label, days_added: result.grantedDays });
                console.log(`[AuthLoading] Admin referral redeemed: +${result.grantedDays} bonus premium days`);
              }
            }
          }
        } catch (adminError) {
          console.log('[AuthLoading] Admin referral check (non-critical):', adminError?.message);
        }
      } catch (error) {
        console.log('[AuthLoading] Referral init error (non-critical):', error?.message);
      }
    };
    if (!settingsLoading && !adminLoading) {
      initReferralSystem();
    }
  }, [settingsLoading, adminLoading]);

  useEffect(() => {
    const navigate = async () => {
      // Post-revoke exit path — MUST run before the deep-link branch
      // below. `Linking.getInitialURL()` returns the URL that
      // originally launched the app (e.g. proofpix://join?invite=...
      // from the admin's Share), and that URL persists across
      // Updates.reloadAsync(). Without this early check, an
      // ex-team-member who tapped "Start 7-day trial" would hit
      // the deep-link fallback and get routed back to JoinTeam by
      // React Navigation's linking config — the exact regression
      // the marker was supposed to prevent.
      try {
        const postRevokeMarker = await AsyncStorage.getItem('@revoke_post_ack');
        if (postRevokeMarker) {
          await AsyncStorage.removeItem('@revoke_post_ack');
          console.warn('[AuthLoading] Post-revoke marker present — skipping deep-link + clipboard, routing to Home');
          await SplashScreen.hideAsync().catch(() => {});
          navigation.replace('Home');
          return;
        }
      } catch (e) {
        console.warn('[AuthLoading] Post-revoke marker check failed:', e?.message);
      }

      // Check if the app was opened via a deep link (invite or join)
      // If so, let React Navigation handle routing — don't override with replace
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          // Extract and persist UTM params from the deep link URL
          extractAndSaveUTMParams(initialUrl);
          // Save referral code locally for deferred redemption (before routing)
          if (initialUrl.includes('referral/')) {
            try {
              const codeMatch = initialUrl.match(/referral\/([A-Za-z0-9]+)/);
              if (codeMatch && codeMatch[1]) {
                const { saveAdminReferralCodeLocally } = await import('../services/adminReferralService');
                await saveAdminReferralCodeLocally(codeMatch[1]);
                console.log('[AuthLoading] Saved referral code for later redemption:', codeMatch[1]);
              }
            } catch (e) {
              console.log('[AuthLoading] Could not save referral code:', e?.message);
            }
          }

          const isDeepLink = initialUrl.includes('/join') || initialUrl.includes('join?invite') || initialUrl.includes('invite/') || initialUrl.includes('referral/');
          if (isDeepLink) {
            console.log('[AuthLoading] Deep link detected, letting React Navigation handle:', initialUrl);
            await SplashScreen.hideAsync().catch(() => {});
            return; // Don't navigate — React Navigation will handle routing
          }
        }
      } catch (error) {
        console.log('[AuthLoading] Could not check initial URL:', error?.message);
      }

      // Hide the native splash screen right before navigating so the user
      // sees one continuous splash instead of native-splash → AuthLoading → destination.
      await SplashScreen.hideAsync().catch(() => {});

      // If userName is set, user has completed initial setup
      if (userName && userName.trim() !== '') {
        navigation.replace('Home');
      } else {
        // Check clipboard for invite code BEFORE deciding where to navigate
        try {
          const clipboardContent = await Clipboard.getString();
          console.log('[AuthLoading] Checking clipboard for invite code...');

          if (clipboardContent && clipboardContent.includes('|')) {
            const parts = clipboardContent.trim().split('|');
            // Check if it matches invite code pattern: TOKEN|SESSIONID
            if (parts.length === 2 && parts[0].length > 10 && parts[1].length > 20) {
              console.log('[AuthLoading] Invite code detected in clipboard, navigating to JoinTeam');
              navigation.replace('JoinTeam', { invite: clipboardContent.trim() });
              return;
            }
          }
        } catch (error) {
          console.log('[AuthLoading] Could not check clipboard:', error?.message);
        }

        // No invite code found - continue with normal flow.
        // userName is empty here, so the user has not entered their name yet —
        // always show FirstLoad regardless of restored subscription state.
        // FirstLoadScreen.handleSelectIndividual already routes paid-subscription
        // users straight to Home after they enter a name (no referral prompt).
        navigation.replace('FirstLoad');
      }
    };

    // Wait for settings, admin, and IAP check to complete, then navigate immediately
    if (!settingsLoading && !adminLoading && iapChecked) {
      navigate();
    }
  }, [settingsLoading, adminLoading, iapChecked, userName, userPlan, navigation]);

  // Refresh pass 8 — rebuilt to match design screenshot 01-auth:
  //   • white background (was a flat yellow flood)
  //   • centered yellow rounded square (~88×88) with a warm yellow glow
  //     and a dark camera glyph
  //   • bold "ProofPix" wordmark below
  //   • "Before & after, proven." subhead
  //   • 3 small dots cycling yellow/grey as a loading indicator
  return (
    <View style={styles.container}>
      <StatusBar
        barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.background}
      />

      <View style={styles.logoTile}>
        <Ionicons name="camera" size={36} color={theme.accentText} />
      </View>
      <Text style={styles.appTitle}>ProofPix</Text>
      <Text style={styles.tagline}>Before &amp; after, proven.</Text>

      <LoadingDots styles={styles} theme={theme} />
    </View>
  );
}

// 3 dots that cycle the active color. `styles` is passed in as a prop
// because it lives in AuthLoadingScreen's closure (useMemo(makeStyles)),
// not at module scope — the stash version had a ReferenceError at render
// that hung the app on splash.
function LoadingDots({ styles, theme }) {
  const progress = useRef(new Animated.Value(0)).current;
  const active = theme?.accent || '#F2C31B';
  const inactive = theme?.borderStrong || '#E0E0E0';

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 3,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const dotColor = (index) =>
    progress.interpolate({
      inputRange: [0, 1, 2, 3],
      outputRange: [
        index === 0 ? active : inactive,
        index === 1 ? active : inactive,
        index === 2 ? active : inactive,
        index === 0 ? active : inactive,
      ],
    });

  return (
    <View style={styles.dotsRow}>
      <Animated.View style={[styles.dot, { backgroundColor: dotColor(0) }]} />
      <Animated.View style={[styles.dot, { backgroundColor: dotColor(1) }]} />
      <Animated.View style={[styles.dot, { backgroundColor: dotColor(2) }]} />
    </View>
  );
}

const CIRCLE_SIZE = SCREEN_W * 0.65;

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  logoTile: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 10,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: FONTS.ALEXANDRIA,
    color: theme.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  tagline: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: theme.textSecondary,
    letterSpacing: -0.1,
    marginBottom: 28,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
});

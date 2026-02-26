import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Platform, Text, Image, Dimensions, StatusBar } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function AuthLoadingScreen({ navigation }) {
  const { userName, userPlan, updateUserPlan, loading: settingsLoading } = useSettings();
  const { isLoading: adminLoading } = useAdmin();
  const [iapChecked, setIapChecked] = useState(false);

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
          // Find the most recent active subscription
          const now = Date.now();
          const activeSubscription = purchases.find(purchase => {
            const expirationDate = purchase.expirationDateIOS;
            return expirationDate && expirationDate > now;
          });

          if (activeSubscription) {
            const productId = activeSubscription.productId;
            console.log('[AuthLoading] Active subscription found:', productId);
            
            // Map product ID to plan name
            let planName = 'starter';
            if (productId.includes('pro.monthly')) planName = 'pro';
            else if (productId.includes('business.monthly')) planName = 'business';
            else if (productId.includes('enterprise.monthly')) planName = 'enterprise';
            
            // Update user plan
            console.log('[AuthLoading] Updating plan from subscription:', planName);
            await updateUserPlan(planName);
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

  useEffect(() => {
    const navigate = async () => {
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

        // No invite code found - continue with normal flow
        // User needs to set up - check if they have an active subscription
        const hasPaidPlan = userPlan && userPlan !== 'starter';

        if (hasPaidPlan) {
          // User has an active subscription (from auto-restore) but needs to set up account
          // Skip plan selection and go directly to Home
          console.log('[AuthLoading] Active subscription detected, skipping to Home');
          navigation.replace('Home');
        } else {
          // New user or free plan - show FirstLoad screen (Let's start with your name)
          navigation.replace('FirstLoad');
        }
      }
    };

    // Wait for settings, admin, and IAP check to complete
    if (!settingsLoading && !adminLoading && iapChecked) {
      // Show splash screen for a visible duration before navigating
      setTimeout(navigate, 5000);
    }
  }, [settingsLoading, adminLoading, iapChecked, userName, userPlan, navigation]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.PRIMARY} />

      {/* Top-left decorative image */}
      <Image
        source={require('../../assets/right.png')}
        style={styles.decorativeImage}
        resizeMode="contain"
      />

      {/* Bottom-right decorative circle (outline only) */}
      <View style={styles.decorativeCircle2} />

      {/* Logo */}
      <View style={styles.logoContainer}>
        <Image
          source={require('../../assets/PP_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* App Name */}
      <Text style={styles.appTitle}>ProofPix</Text>
    </View>
  );
}

const CIRCLE_SIZE = SCREEN_W * 0.65;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.PRIMARY,
  },
  decorativeImage: {
    position: 'absolute',
    top: '50',
    left: -CIRCLE_SIZE * 0.2,
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
  },
  decorativeCircle2: {
    position: 'absolute',
    bottom: -CIRCLE_SIZE * 0.3,
    right: -CIRCLE_SIZE * 0.3,
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(180, 150, 10, 0.35)',
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 140,
    height: 140,
  },
  appTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    textAlign: 'center',
  },
});

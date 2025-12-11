import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';

export default function AuthLoadingScreen({ navigation }) {
  const { userName, userPlan, updateUserPlan, loading: settingsLoading } = useSettings();
  const { isLoading: adminLoading } = useAdmin();
  const [iapChecked, setIapChecked] = useState(false);

  // Auto-restore IAP subscriptions on app launch (iOS only)
  useEffect(() => {
    const autoRestoreSubscriptions = async () => {
      if (Platform.OS !== 'ios') {
        setIapChecked(true);
        return;
      }

      try {
        const { restorePurchases } = await import('../services/iapService');
        console.log('[AuthLoading] Auto-restoring IAP subscriptions...');
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
            
            // Update user plan if different
            if (planName !== userPlan && planName !== 'starter') {
              console.log('[AuthLoading] Updating plan from subscription:', planName);
              await updateUserPlan(planName);
            }
          } else {
            console.log('[AuthLoading] No active subscriptions found');
          }
        } else {
          console.log('[AuthLoading] No purchases to restore');
        }
      } catch (error) {
        console.warn('[AuthLoading] Failed to auto-restore subscriptions:', error?.message);
      } finally {
        setIapChecked(true);
      }
    };

    if (!settingsLoading) {
      autoRestoreSubscriptions();
    }
  }, [settingsLoading]);

  useEffect(() => {
    const navigate = () => {
      // If userName is set, user has completed initial setup
      if (userName && userName.trim() !== '') {
        navigation.replace('Home');
      } else {
        // User needs to set up - check if they have an active subscription
        const hasPaidPlan = userPlan && userPlan !== 'starter';
        
        if (hasPaidPlan) {
          // User has an active subscription (from auto-restore) but needs to set up account
          // Skip plan selection and go directly to account setup
          console.log('[AuthLoading] Active subscription detected, skipping to account setup');
          navigation.replace('GoogleSignUp', { plan: userPlan });
        } else {
          // New user or free plan - show onboarding flow
          navigation.replace('FirstLoad');
        }
      }
    };

    // Wait for settings, admin, and IAP check to complete
    if (!settingsLoading && !adminLoading && iapChecked) {
      // Introduce a short delay to ensure the loading screen is visible
      setTimeout(navigate, 500);
    }
  }, [settingsLoading, adminLoading, iapChecked, userName, userPlan, navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});

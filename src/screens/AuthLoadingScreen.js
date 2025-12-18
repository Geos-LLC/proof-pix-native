import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet, Platform, Text } from 'react-native';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';

export default function AuthLoadingScreen({ navigation }) {
  const { userName, userPlan, updateUserPlan, loading: settingsLoading } = useSettings();
  const { isLoading: adminLoading } = useAdmin();
  const [iapChecked, setIapChecked] = useState(false);
  const [debugStatus, setDebugStatus] = useState('Initializing...');

  // Debug logging on mount
  useEffect(() => {
    console.log('[AuthLoading] Component mounted');
    console.log('[AuthLoading] Initial state - settingsLoading:', settingsLoading, 'adminLoading:', adminLoading);
  }, []);

  // Log state changes
  useEffect(() => {
    console.log('[AuthLoading] State update - settingsLoading:', settingsLoading, 'adminLoading:', adminLoading, 'iapChecked:', iapChecked);
    setDebugStatus(`Settings: ${settingsLoading ? 'loading' : 'ready'}, Admin: ${adminLoading ? 'loading' : 'ready'}, IAP: ${iapChecked ? 'checked' : 'pending'}`);
  }, [settingsLoading, adminLoading, iapChecked]);

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
    const navigate = () => {
      // If userName is set, user has completed initial setup
      if (userName && userName.trim() !== '') {
        navigation.replace('Home');
      } else {
        // User needs to set up - check if they have an active subscription
        const hasPaidPlan = userPlan && userPlan !== 'starter';
        
        if (hasPaidPlan) {
          // User has an active subscription (from auto-restore) but needs to set up account
          // Skip plan selection and go directly to Home
          console.log('[AuthLoading] Active subscription detected, skipping to Home');
          navigation.replace('Home');
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
      {__DEV__ && (
        <Text style={styles.debugText}>{debugStatus}</Text>
      )}
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
  debugText: {
    marginTop: 20,
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});

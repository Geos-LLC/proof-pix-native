import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  Alert,
  Linking,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import TrialNotificationModal from '../components/TrialNotificationModal';
import TrialConfirmationModal from '../components/TrialConfirmationModal';
import { canStartTrial, startTrial } from '../services/trialService';
import { getNotificationToShow } from '../services/trialNotificationService';
import { IAP_PRODUCTS, purchaseProduct, restorePurchases, getAvailablePurchases, diagnoseIAPState } from '../services/iapService';

export default function PlanSelectionScreen({ navigation }) {
  const { t } = useTranslation();
  const { updateUserPlan } = useSettings();
  const { updatePlanLimit } = useAdmin();
  const insets = useSafeAreaInsets();

  // Enterprise modal state
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [trialAvailable, setTrialAvailable] = useState(false);
  const [trialDays, setTrialDays] = useState(30);
  // Trial notification modal state
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [trialNotification, setTrialNotification] = useState(null);
  // Trial confirmation modal state
  const [showTrialConfirmation, setShowTrialConfirmation] = useState(false);
  const [selectedPlanForTrial, setSelectedPlanForTrial] = useState(null);
  // Track if we've shown the notification in this session
  const hasShownTrialNotification = useRef(false);
  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);
  // Track restore purchases loading state
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  // Track if purchase is in progress to prevent double-clicks
  const isPurchasing = useRef(false);

  useEffect(() => {
    console.log('[PlanSelection] 🔵 Component mounted, isMounted set to true');
    isMounted.current = true;

    // Check if trial is available for new users
    const checkTrialAvailability = async () => {
      try {
        const available = await canStartTrial();
        if (isMounted.current) {
          setTrialAvailable(available);
        }

        // Check if user has a referral code to determine trial days
        try {
          const AsyncStorage = await import('@react-native-async-storage/async-storage');
          const referralData = await AsyncStorage.default.getItem('@referral_accepted');
          if (isMounted.current) {
            setTrialDays(referralData !== null ? 45 : 30);
          }
        } catch (error) {
          if (isMounted.current) {
            setTrialDays(30);
          }
        }
      } catch (error) {
        console.error('[PlanSelection] Error checking trial availability:', error);
        // Default to showing trial UI if check fails (for new users)
        if (isMounted.current) {
          setTrialAvailable(true);
          setTrialDays(30);
        }
      }
    };
    checkTrialAvailability();

    // Clear modal state when screen is focused (e.g., when navigating back)
    if (isMounted.current) {
      setShowTrialModal(false);
    }

    return () => {
      console.log('[PlanSelection] 🔴 Component unmounting, isMounted set to false');
      isMounted.current = false;
    };
    setTrialNotification(null);
    hasShownTrialNotification.current = false;
  }, []);

  const handleSelectPlan = async (plan) => {
    // If trial is available, show confirmation modal first (except for enterprise which currently has no trial)
    if (trialAvailable && plan !== 'enterprise') {
      setSelectedPlanForTrial(plan);
      setShowTrialConfirmation(true);
      return;
    }

    // No trial flow or enterprise (no trial) → proceed directly
    await proceedWithPlanSelection(plan, false);
  };

  // Proceed with plan selection (with or without trial)
  const proceedWithPlanSelection = async (plan, useTrial = false) => {
    // Prevent double-clicks/multiple simultaneous purchases
    if (isPurchasing.current) {
      console.log('[PlanSelection] ⚠️ Purchase already in progress, ignoring duplicate request');
      return;
    }
    
    isPurchasing.current = true;
    console.log('[PlanSelection] 🟢 proceedWithPlanSelection START - plan:', plan, 'useTrial:', useTrial);
    
    try {
      let trialJustStarted = false;

      // Close all modals before proceeding to prevent state updates during navigation
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
        // Fallback to regular plan selection
        await updateUserPlan(plan);
      }
    } else {
      console.log('[PlanSelection] 🔵 Regular plan flow (no trial)');
      // Regular plan selection without trial
      // On iOS, require in-app purchase for paid plans before changing plan.
      if (Platform.OS === 'ios') {
        console.log('[PlanSelection] iOS platform detected, checking for IAP');
        let productId = null;
        if (plan === 'pro') productId = IAP_PRODUCTS.PRO_MONTHLY;
        else if (plan === 'business') productId = IAP_PRODUCTS.BUSINESS_MONTHLY;
        else if (plan === 'enterprise') productId = IAP_PRODUCTS.ENTERPRISE_MONTHLY;

        console.log('[PlanSelection] Selected plan:', plan, 'Product ID:', productId);

        if (productId) {
          try {
            console.log('[PlanSelection] Starting purchase for:', productId);
            console.log('[PlanSelection] Plan:', plan);
            const purchaseResult = await purchaseProduct(productId);
            console.log('[PlanSelection] ✅ Purchase successful:', JSON.stringify(purchaseResult, null, 2));
            console.log('[PlanSelection] ✅ Purchase completed, updating plan to:', plan);
            // Purchase successful, update plan and proceed
            await updateUserPlan(plan);
            console.log('[PlanSelection] ✅ Plan updated, navigating to account setup');
            
            return new Promise((resolve) => {
              InteractionManager.runAfterInteractions(() => {
                console.log('[PlanSelection] ✅ Navigating after successful purchase');
                isMounted.current = false;
                navigation.navigate('GoogleSignUp', { plan });
                resolve();
              });
            });
          } catch (err) {
            console.log('[PlanSelection] ❌ Purchase error caught');
            console.log('[PlanSelection] Error message:', err?.message);
            console.log('[PlanSelection] Error code:', err?.code);
            
            // Check if user cancelled - handle silently
            const errorMsg = err?.message || '';
            if (errorMsg === 'USER_CANCELLED' || errorMsg === 'user-cancelled' || errorMsg.includes('cancelled')) {
              console.log('[PlanSelection] User cancelled purchase');
              return; // user cancelled, do not change plan
            }

            // Check if item already owned or purchase timed out
            if (errorMsg === 'already-owned' || errorMsg === 'PURCHASE_TIMEOUT') {
              console.log('[PlanSelection] Purchase blocked - iOS says:', errorMsg);
              
              // If "already-owned", iOS explicitly confirms subscription exists
              // Only need verification for timeout (which could be false positive)
              if (errorMsg === 'already-owned') {
                console.log('[PlanSelection] ✅ iOS explicitly confirmed: Subscription already exists');
                console.log('[PlanSelection] Proceeding with plan:', plan);
                await updateUserPlan(plan);
                
                Alert.alert(
                  t('common.success', { defaultValue: 'Already Subscribed' }),
                  t('settings.alreadySubscribed', { defaultValue: 'You already have an active subscription to this plan!' })
                );
                
                // Navigate to account setup
                console.log('[PlanSelection] Navigating to account setup');
                return new Promise((resolve) => {
                  InteractionManager.runAfterInteractions(() => {
                    console.log('[PlanSelection] All interactions complete, navigating...');
                    isMounted.current = false;
                    navigation.navigate('GoogleSignUp', { plan });
                    resolve();
                  });
                });
              }
              
              // For PURCHASE_TIMEOUT, verify subscription actually exists
              // (timeout can be triggered by expired renewals - false positive)
              console.log('[PlanSelection] Timeout detected - verifying if subscription actually exists...');
              try {
                const purchases = await restorePurchases();
                const now = Date.now();
                const activePurchase = purchases?.find(p => 
                  p.expirationDateIOS && p.expirationDateIOS > now
                );
                
                if (activePurchase) {
                  console.log('[PlanSelection] ✅ Confirmed: Active subscription exists');
                  console.log('[PlanSelection] Product:', activePurchase.productId);
                  console.log('[PlanSelection] Expires:', new Date(activePurchase.expirationDateIOS).toISOString());
                  console.log('[PlanSelection] Updating plan to:', plan);
                  await updateUserPlan(plan);
                  
                  // Navigate to account setup
                  console.log('[PlanSelection] Navigating to account setup');
                  return new Promise((resolve) => {
                    InteractionManager.runAfterInteractions(() => {
                      console.log('[PlanSelection] All interactions complete, navigating...');
                      isMounted.current = false;
                      navigation.navigate('GoogleSignUp', { plan });
                      resolve();
                    });
                  });
                } else {
                  console.log('[PlanSelection] ❌ No active subscription found');
                  console.log('[PlanSelection] This suggests the purchase did not complete');
                  
                  Alert.alert(
                    t('common.info', { defaultValue: 'Purchase Not Completed' }),
                    'The purchase did not complete. This can happen if:\n\n• You already have a different active subscription\n• The sandbox account needs to be refreshed\n• The purchase was cancelled\n\nIf you were charged, the purchase will appear in your account within a few minutes.'
                  );
                  return;
                }
              } catch (verifyError) {
                console.error('[PlanSelection] Failed to verify subscription:', verifyError);
                
                // Check if user cancelled the verification prompt
                const errorMessage = verifyError?.message || '';
                if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED')) {
                  console.log('[PlanSelection] User cancelled verification prompt');
                  return; // Silently exit, user cancelled intentionally
                }
                
                Alert.alert(
                  t('common.error', { defaultValue: 'Error' }),
                  t('settings.purchaseFailed', { defaultValue: 'Could not verify subscription status. Please try again.' })
                );
                return;
              }
            }

            console.error('[PlanSelection] ❌ Purchase failed:', err);
            console.error('[PlanSelection] Error message:', err?.message);
            console.error('[PlanSelection] Error stack:', err?.stack);
            
            Alert.alert(
              t('common.error', { defaultValue: 'Error' }),
              t('settings.purchaseFailed', { defaultValue: 'Purchase failed. Please try again.' })
            );
            return;
          }
        } else {
          console.log('[PlanSelection] No product ID for plan:', plan, '(free plan?)');
        }
      } else {
        console.log('[PlanSelection] Platform is not iOS:', Platform.OS);
      }

      console.log('[PlanSelection] 🔵 Calling updateUserPlan...');
      await updateUserPlan(plan);
      console.log('[PlanSelection] 🔵 updateUserPlan completed');
    }

      console.log('[PlanSelection] 🟢 About to navigate to GoogleSignUp, trialJustStarted:', trialJustStarted);
      
      // Use InteractionManager to wait for all animations/interactions to complete
      // This prevents React errors during navigation
      // Wrap in a Promise to ensure we wait for navigation to complete
      return new Promise((resolve) => {
        InteractionManager.runAfterInteractions(() => {
          console.log('[PlanSelection] 🔵 All interactions complete, setting isMounted to false');
          isMounted.current = false;
          
          console.log('[PlanSelection] 🟢 Navigating to GoogleSignUp...');
          navigation.navigate('GoogleSignUp', { plan, trialJustStarted: trialJustStarted });
          console.log('[PlanSelection] 🟢 Navigation called, proceedWithPlanSelection END');
          resolve();
        });
      });
    } finally {
      // Always reset purchase lock, even if function exits early
      isPurchasing.current = false;
      console.log('[PlanSelection] 🔓 Purchase lock released');
    }
  };

  // Handle trial confirmation - use trial
  const handleUseTrial = async () => {
    console.log('[PlanSelection] 🔴 handleUseTrial START');
    console.log('[PlanSelection] 🔴 Closing trial confirmation modal');
    setShowTrialConfirmation(false);
    const plan = selectedPlanForTrial;
    console.log('[PlanSelection] 🔴 Selected plan for trial:', plan);
    setSelectedPlanForTrial(null);
    console.log('[PlanSelection] 🔴 Calling proceedWithPlanSelection with useTrial=true');
    await proceedWithPlanSelection(plan, true);
    console.log('[PlanSelection] 🔴 handleUseTrial END');
  };

  // Handle trial confirmation - cancel (continue without trial)
  const handleCancelTrial = async () => {
    console.log('[PlanSelection] 🟣 handleCancelTrial START');
    console.log('[PlanSelection] 🟣 Closing trial confirmation modal');
    setShowTrialConfirmation(false);
    const plan = selectedPlanForTrial;
    console.log('[PlanSelection] 🟣 Selected plan:', plan);
    setSelectedPlanForTrial(null);
    console.log('[PlanSelection] 🟣 Calling proceedWithPlanSelection with useTrial=false');
    await proceedWithPlanSelection(plan, false);
    console.log('[PlanSelection] 🟣 handleCancelTrial END');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  // Handle free trial button click - show confirmation modal first
  const handleFreeTrialClick = () => {
    if (!trialAvailable || hasShownTrialNotification.current) {
      return;
    }

    // Show confirmation modal for business plan
    setSelectedPlanForTrial('business');
    setShowTrialConfirmation(true);
  };

  // Handle trial modal close
  const handleTrialModalClose = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
  };

  // Handle trial upgrade - show plan modal
  const handleTrialUpgrade = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
    // Navigate to Settings where plan modal can be shown
    navigation.navigate('Settings', { showPlanModal: true });
  };

  // Handle refer a friend
  const handleTrialRefer = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
    // Navigate to Referral screen
    navigation.navigate('Referral');
  };

  // Handle diagnostic check (for debugging)
  const handleDiagnose = async () => {
    if (Platform.OS !== 'ios') {
      return;
    }

    try {
      console.log('[PlanSelection] Running IAP diagnostics...');
      const results = await diagnoseIAPState();
      
      // Show results in alert
      const summary = `
Platform: ${results.supported ? 'Supported' : 'Not Supported'}
Connection: ${results.connectionInitialized ? 'Initialized' : 'Not Initialized'}
Available Purchases: ${results.availablePurchasesCount || 0}
Restored Purchases: ${results.restoredPurchasesCount || 0}
Active Subscriptions: ${results.activeSubscriptionsCount || 0}

${results.error ? `Error: ${results.error}` : ''}
      `.trim();
      
      Alert.alert('IAP Diagnostics', summary);
    } catch (error) {
      Alert.alert('Diagnostic Error', error.message);
    }
  };

  // Handle restore purchases
  const handleRestorePurchases = async () => {
    if (Platform.OS !== 'ios') {
      return; // Only show on iOS
    }

    setIsRestoringPurchases(true);
    try {
      console.log('[PlanSelection] Restoring purchases...');
      
      // First, check for available purchases (completed but not finalized)
      const availablePurchases = await getAvailablePurchases();
      console.log('[PlanSelection] Available purchases:', availablePurchases?.length || 0);
      
      const purchases = await restorePurchases();
      
      if (!purchases || purchases.length === 0) {
        // Provide more helpful error message based on available purchases
        const message = availablePurchases && availablePurchases.length > 0
          ? 'Completed purchases found but not yet finalized. This may be a sandbox testing issue. Try signing out and back into your sandbox test account in Settings > App Store, then try again.'
          : 'No active subscriptions found. If you recently purchased, please wait a moment and try again. For sandbox testing, ensure you\'re signed in with a sandbox test account.';
        
        Alert.alert(
          t('common.info', { defaultValue: 'No Purchases Found' }),
          t('settings.noPurchasesFound', { defaultValue: message })
        );
        setIsRestoringPurchases(false);
        return;
      }
      
      // Find active subscription
      const now = Date.now();
      const activePurchase = purchases.find(p => p.expirationDateIOS && p.expirationDateIOS > now);
      
      if (activePurchase) {
        const productId = activePurchase.productId;
        let restoredPlan = 'starter';
        if (productId.includes('pro.monthly')) restoredPlan = 'pro';
        else if (productId.includes('business.monthly')) restoredPlan = 'business';
        else if (productId.includes('enterprise.monthly')) restoredPlan = 'enterprise';
        
        console.log('[PlanSelection] Restored active plan:', restoredPlan);
        await updateUserPlan(restoredPlan);
        
        setIsRestoringPurchases(false);
        
        // Navigate to account setup with the restored plan
        console.log('[PlanSelection] Navigating to account setup with restored plan');
        return new Promise((resolve) => {
          InteractionManager.runAfterInteractions(() => {
            isMounted.current = false;
            navigation.navigate('GoogleSignUp', { plan: restoredPlan });
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

      // Check if user cancelled the restore
      const errorMessage = error?.message || '';
      if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED')) {
        // User cancelled - don't show error alert
        console.log('[PlanSelection] User cancelled restore purchases');
        setIsRestoringPurchases(false);
        return;
      }

      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.restoreFailed', { defaultValue: 'Failed to restore purchases. Please try again or contact support if the problem persists.' })
      );
      setIsRestoringPurchases(false);
    }
  };


  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + 10, left: insets.left + 10 }]}
        onPress={handleGoBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.formContainer}>
          <Text style={styles.welcomeText}>{t('firstLoad.choosePlan')}</Text>

          {/* Restore Purchases & Diagnostics - HIDDEN in production, only for dev/testing */}
          {Platform.OS === 'ios' && __DEV__ && (
            <>
              <TouchableOpacity
                style={styles.restorePurchasesButton}
                onPress={handleRestorePurchases}
                disabled={isRestoringPurchases}
              >
                <Text style={styles.restorePurchasesText}>
                  {isRestoringPurchases ? t('settings.restoring', { defaultValue: 'Restoring...' }) : '🔧 Restore Purchases (Dev Only)'}
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.restorePurchasesButton, { marginTop: 5 }]}
                onPress={handleDiagnose}
              >
                <Text style={[styles.restorePurchasesText, { color: '#999' }]}>
                  🔍 Run IAP Diagnostics
                </Text>
              </TouchableOpacity>
            </>
          )}

          {trialAvailable && (
            <TouchableOpacity
              style={styles.trialBanner}
              onPress={handleFreeTrialClick}
            >
              <Text style={styles.trialBannerText}>
                🎉 {trialDays}-Day Free Trial Available!
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.planContainer}>
            <TouchableOpacity
              style={[styles.selectionButton, styles.planButton]}
              onPress={() => handleSelectPlan('starter')}
            >
              <Text style={[styles.selectionButtonText, styles.planButtonText]}>
                {t('firstLoad.starter')}
              </Text>
              <Text style={styles.planPrice}>Free</Text>
            </TouchableOpacity>
            <Text style={styles.planSubtext}>{t('firstLoad.starterDesc')}</Text>
          </View>

          <View style={styles.planContainer}>
            <TouchableOpacity
              style={[styles.selectionButton, styles.planButton]}
              onPress={() => handleSelectPlan('pro')}
            >
              <Text style={[styles.selectionButtonText, styles.planButtonText]}>
                {t('firstLoad.pro')}
              </Text>
              <Text style={styles.planPrice}>$8.99/month</Text>
            </TouchableOpacity>
            <Text style={styles.planSubtext}>{t('firstLoad.proDesc')}</Text>
          </View>

          <View style={styles.planContainer}>
            <TouchableOpacity
              style={[styles.selectionButton, styles.planButton]}
              onPress={() => handleSelectPlan('business')}
            >
              <Text style={[styles.selectionButtonText, styles.planButtonText]}>
                {t('firstLoad.business')}
              </Text>
              <Text style={styles.planPrice}>$24.99/month</Text>
            </TouchableOpacity>
            <Text style={styles.planSubtext}>
              For small teams up to 5 members. $5.99 per additional team member
            </Text>
          </View>

          <View style={styles.planContainer}>
            <TouchableOpacity
              style={[styles.selectionButton, styles.planButton]}
              onPress={() => handleSelectPlan('enterprise')}
            >
              <Text style={[styles.selectionButtonText, styles.planButtonText]}>
                {t('firstLoad.enterprise')}
              </Text>
              <Text style={styles.planPrice}>Starts at $69.99/month</Text>
            </TouchableOpacity>
            <Text style={styles.planSubtext}>
              For growing organisations with 15 team members and more
            </Text>
          </View>

          {/* Terms and Privacy Policy Links */}
          <View style={styles.legalLinksContainer}>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
              style={styles.legalLinkButton}
            >
              <Text style={styles.legalLinkText}>
                {t('settings.termsOfUse', { defaultValue: 'Terms of Use (EULA)' })}
              </Text>
            </TouchableOpacity>

            <Text style={styles.legalLinkSeparator}>•</Text>

            <TouchableOpacity
              onPress={() => Linking.openURL('https://sayapingeorge.wixsite.com/geos/privacy-policy')}
              style={styles.legalLinkButton}
            >
              <Text style={styles.legalLinkText}>
                {t('settings.privacyPolicy', { defaultValue: 'Privacy Policy' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Enterprise Contact Form Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

      {/* Trial Confirmation Modal */}
      <TrialConfirmationModal
        visible={showTrialConfirmation}
        planName={selectedPlanForTrial ? selectedPlanForTrial.charAt(0).toUpperCase() + selectedPlanForTrial.slice(1) : ''}
        onUseTrial={handleUseTrial}
        onCancel={handleCancelTrial}
      />

      {/* Trial Notification Modal */}
      <TrialNotificationModal
        visible={showTrialModal}
        notification={trialNotification}
        onClose={handleTrialModalClose}
        onUpgrade={handleTrialUpgrade}
        onRefer={handleTrialRefer}
        onCTA={(notification) => {
          handleTrialModalClose();
          // Determine which section to scroll to based on notification key
          let scrollParam = {};
          if (notification?.key === 'day7_10') {
            scrollParam = { scrollToWatermark: true };
          } else if (notification?.key === 'day15') {
            scrollParam = { scrollToCloudSync: true };
          } else if (notification?.key === 'day22_24') {
            scrollParam = { scrollToAccountData: true };
          }
          navigation.navigate('Settings', scrollParam);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
  },
  backButton: {
    position: 'absolute',
    zIndex: 10,
    padding: 10,
  },
  backButtonText: {
    color: COLORS.TEXT,
    fontSize: 24,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  formContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  planContainer: {
    marginBottom: 20,
    width: '100%',
  },
  selectionButton: {
    backgroundColor: COLORS.PRIMARY,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  selectionButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000000',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  planButton: {
    backgroundColor: '#fff',
    borderColor: '#ddd',
  },
  planButtonText: {
    color: '#333',
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
    marginTop: 4,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  planSubtext: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10,
  },
  trialBanner: {
    backgroundColor: '#4CAF50',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  trialBannerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  trialBadge: {
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  restorePurchasesButton: {
    marginTop: 2,
    marginBottom: 15,
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restorePurchasesText: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    textDecorationLine: 'underline',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  legalLinksContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 20,
    paddingHorizontal: 20,
    flexWrap: 'wrap',
  },
  legalLinkButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  legalLinkText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    textDecorationLine: 'underline',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
  legalLinkSeparator: {
    fontSize: 12,
    color: '#666',
    marginHorizontal: 8,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
});

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
import { IAP_PRODUCTS, purchaseProduct, restorePurchases, clearPendingTransactions } from '../services/iapService';

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
    console.log('[PlanSelection] 🟢 proceedWithPlanSelection START - plan:', plan, 'useTrial:', useTrial);
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
            const purchaseResult = await purchaseProduct(productId);
            console.log('[PlanSelection] ✅ Purchase successful:', JSON.stringify(purchaseResult, null, 2));
          } catch (err) {
            console.error('[PlanSelection] ❌ Purchase failed:', err);
            console.error('[PlanSelection] Error message:', err?.message);
            console.error('[PlanSelection] Error stack:', err?.stack);

            if (err?.message === 'USER_CANCELLED') {
              console.log('[PlanSelection] User cancelled purchase');
              return; // user cancelled, do not change plan
            }
            
            if (err?.message === 'PURCHASE_TIMEOUT') {
              Alert.alert(
                'Existing Subscription Detected',
                'You already have an active subscription. To change your plan, please cancel your current subscription in Settings → Account Data → Manage Subscription, then purchase the new plan.',
                [{ text: 'OK' }]
              );
              return;
            }
            
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
    InteractionManager.runAfterInteractions(() => {
      console.log('[PlanSelection] 🔵 All interactions complete, setting isMounted to false');
      isMounted.current = false;
      
      console.log('[PlanSelection] 🟢 Navigating to GoogleSignUp...');
      navigation.navigate('GoogleSignUp', { plan, trialJustStarted: trialJustStarted });
      console.log('[PlanSelection] 🟢 Navigation called, proceedWithPlanSelection END');
    });
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

  // Handle restore purchases
  const handleRestorePurchases = async () => {
    if (Platform.OS !== 'ios') {
      return; // Only show on iOS
    }

    setIsRestoringPurchases(true);
    try {
      await restorePurchases();
      Alert.alert(
        t('common.success', { defaultValue: 'Success' }),
        t('settings.purchasesRestored', { defaultValue: 'Your purchases have been restored successfully.' })
      );
    } catch (error) {
      console.error('[PlanSelection] Error restoring purchases:', error);

      // Check if user cancelled the restore
      const errorMessage = error?.message || '';
      if (errorMessage.includes('Request Canceled') || errorMessage.includes('USER_CANCELLED')) {
        // User cancelled - don't show error alert
        console.log('[PlanSelection] User cancelled restore purchases');
        return;
      }

      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.restoreFailed', { defaultValue: 'Failed to restore purchases. Please try again or contact support if the problem persists.' })
      );
    } finally {
      setIsRestoringPurchases(false);
    }
  };

  // Handle clear pending transactions (for stuck sandbox transactions)
  const handleClearTransactions = async () => {
    if (Platform.OS !== 'ios') {
      return;
    }

    Alert.alert(
      'Clear Transaction Cache',
      'This will clear stuck sandbox transactions. Only use this if purchases are timing out. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            setIsRestoringPurchases(true);
            try {
              await clearPendingTransactions();
              Alert.alert(
                'Success',
                'Transaction cache cleared! Try purchasing again.'
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to clear cache. Try reinstalling the app.');
            } finally {
              setIsRestoringPurchases(false);
            }
          }
        }
      ]
    );
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

          {/* Restore Purchases Button - iOS only */}
          {Platform.OS === 'ios' && (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 15, marginBottom: 15 }}>
              <TouchableOpacity
                style={styles.restorePurchasesButton}
                onPress={handleRestorePurchases}
                disabled={isRestoringPurchases}
              >
                <Text style={styles.restorePurchasesText}>
                  {isRestoringPurchases ? t('settings.restoring', { defaultValue: 'Restoring...' }) : t('settings.restorePurchases', { defaultValue: 'Restore Purchases' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.restorePurchasesButton, { backgroundColor: '#ffe6e6' }]}
                onPress={handleClearTransactions}
                disabled={isRestoringPurchases}
              >
                <Text style={[styles.restorePurchasesText, { color: '#d32f2f' }]}>
                  Clear Cache
                </Text>
              </TouchableOpacity>
            </View>
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

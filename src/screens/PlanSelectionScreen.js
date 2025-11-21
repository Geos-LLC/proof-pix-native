import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
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
import { clearTrial } from '../utils/trialTestUtils';

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

  useEffect(() => {
    // Check if trial is available for new users
    const checkTrialAvailability = async () => {
      try {
        const available = await canStartTrial();
        console.log('[PlanSelection] Trial available:', available);

        // Debug: Check why trial might not be available
        if (!available) {
          const { hasUsedTrial, isTrialActive } = await import('../services/trialService');
          const used = await hasUsedTrial();
          const active = await isTrialActive();
          console.log('[PlanSelection] Trial debug - used:', used, 'active:', active);
        }

        setTrialAvailable(available);

        // Check if user has a referral code to determine trial days
        try {
          const AsyncStorage = await import('@react-native-async-storage/async-storage');
          const referralData = await AsyncStorage.default.getItem('@referral_accepted');
          setTrialDays(referralData !== null ? 45 : 30);
        } catch (error) {
          setTrialDays(30);
        }
      } catch (error) {
        console.error('[PlanSelection] Error checking trial availability:', error);
        // Default to showing trial UI if check fails (for new users)
        setTrialAvailable(true);
        setTrialDays(30);
      }
    };
    checkTrialAvailability();
    
    // Clear modal state when screen is focused (e.g., when navigating back)
    setShowTrialModal(false);
    setTrialNotification(null);
    hasShownTrialNotification.current = false;
  }, []);

  const handleSelectPlan = async (plan) => {
    if (plan === 'enterprise') {
      // Set up enterprise tier with 15 team member limit
      try {
        // Set the plan limit to 15 for team members
        await updatePlanLimit(15);
        // Update user plan to enterprise
        await updateUserPlan('enterprise');
        // Navigate to next screen (GoogleSignUp) - multiple accounts functionality is already enabled for enterprise tier
        navigation.navigate('GoogleSignUp', { plan: 'enterprise', trialJustStarted: false });
      } catch (error) {
        console.error('[PlanSelection] Error setting up enterprise plan:', error);
        // Fallback to regular plan selection if there's an error
        await proceedWithPlanSelection(plan, false);
      }
      return;
    }

    // If trial is available, show confirmation modal
    if (trialAvailable) {
      setSelectedPlanForTrial(plan);
      setShowTrialConfirmation(true);
      return;
    }

    // Regular plan selection (trial already used or not available)
    await proceedWithPlanSelection(plan, false);
  };

  // Proceed with plan selection (with or without trial)
  const proceedWithPlanSelection = async (plan, useTrial = false) => {
    let trialJustStarted = false;

    if (useTrial) {
      try {
        // Start 30-day free trial for the selected plan
        await startTrial(plan);
        await updateUserPlan(plan);
        trialJustStarted = true;
      } catch (error) {
        console.error('[PlanSelection] Error starting trial:', error);
        // Fallback to regular plan selection
        await updateUserPlan(plan);
      }
    } else {
      // Regular plan selection without trial
      await updateUserPlan(plan);
    }

    // Navigate to next screen (all plans go to GoogleSignUp)
    navigation.navigate('GoogleSignUp', { plan, trialJustStarted: trialJustStarted });

    // If trial just started, show welcome notification
    if (trialJustStarted && !hasShownTrialNotification.current) {
      hasShownTrialNotification.current = true;
      setTimeout(async () => {
        try {
          const notification = await getNotificationToShow(false); // Don't skip Day 0
          if (notification && notification.key === 'day0') {
            setTrialNotification(notification);
            setShowTrialModal(true);
          }
        } catch (error) {
          console.error('[PlanSelection] Error checking welcome notification:', error);
        }
      }, 500);
    }
  };

  // Handle trial confirmation - use trial
  const handleUseTrial = async () => {
    setShowTrialConfirmation(false);
    const plan = selectedPlanForTrial;
    setSelectedPlanForTrial(null);
    await proceedWithPlanSelection(plan, true);
  };

  // Handle trial confirmation - cancel (continue without trial)
  const handleCancelTrial = async () => {
    setShowTrialConfirmation(false);
    const plan = selectedPlanForTrial;
    setSelectedPlanForTrial(null);
    await proceedWithPlanSelection(plan, false);
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

  // Dev-only: Reset trial for testing
  const handleResetTrial = async () => {
    try {
      await clearTrial();
      // Recheck trial availability
      const available = await canStartTrial();
      setTrialAvailable(available);
      console.log('[PlanSelection] Trial reset, available:', available);
    } catch (error) {
      console.error('[PlanSelection] Error resetting trial:', error);
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

          {__DEV__ && (
            <TouchableOpacity
              style={styles.devResetButton}
              onPress={handleResetTrial}
            >
              <Text style={styles.devResetButtonText}>
                🧪 Dev: Reset Trial (for testing)
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
    marginBottom: 30,
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
  devResetButton: {
    backgroundColor: '#FF6B6B',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginTop: 10,
    marginBottom: 10,
    alignSelf: 'center',
  },
  devResetButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
});

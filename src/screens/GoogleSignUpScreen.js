import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAdmin } from '../context/AdminContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { useTranslation } from 'react-i18next';
import dropboxAuthService from '../services/dropboxAuthService';
import dropboxService from '../services/dropboxService';
import EnterpriseContactModal from '../components/EnterpriseContactModal';

export default function GoogleSignUpScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { individualSignIn, adminSignIn } = useAdmin();
  const { userPlan, updateUserPlan } = useSettings();
  const { plan } = route.params || {};
  const insets = useSafeAreaInsets();
  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [isSigningInDropbox, setIsSigningInDropbox] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);

  const handleGoogleSignIn = async () => {
    console.log('[GoogleSignUp] 🟢 Connect to Google Account button PRESSED');
    // Check if user is on starter plan - show upgrade modal instead
    if (userPlan === 'starter') {
      setShowPlanModal(true);
      return;
    }

    setIsSigningInGoogle(true);
    try {
      let result;
      if (plan === 'business' || plan === 'enterprise') {
        result = await adminSignIn();
      } else {
        result = await individualSignIn();
      }
      
      if (result.success) {
        navigation.replace('LabelLanguageSetup');
      } else {
        Alert.alert(t('googleSignUp.signInError'), result.error || t('googleSignUp.unexpectedError'));
      }
    } finally {
      setIsSigningInGoogle(false);
    }
  };

  const handleDropboxSignIn = async () => {
    // Check if user is on starter plan - show upgrade modal instead
    if (userPlan === 'starter') {
      setShowPlanModal(true);
      return;
    }

    if (!dropboxAuthService.isConfigured()) {
      Alert.alert(
        t('settings.featureUnavailable'),
        t('settings.dropboxNotConfigured')
      );
      return;
    }

    setIsSigningInDropbox(true);
    try {
      const result = await dropboxAuthService.signIn();
      
      // Find or create ProofPix folder
      try {
        const folderPath = await dropboxService.findOrCreateProofPixFolder();
        console.log('[DROPBOX] Folder ready:', folderPath);
      } catch (folderError) {
        console.error('[DROPBOX] Folder creation error:', folderError);
        // Don't fail the sign-in if folder creation fails
      }

      // Update state - reload tokens to ensure state is accurate
      await dropboxAuthService.loadStoredTokens();
      const isAuth = dropboxAuthService.isAuthenticated();
      const userInfo = dropboxAuthService.getUserInfo();
      
      if (isAuth && userInfo) {
        Alert.alert(
          t('settings.dropboxConnected'),
          t('settings.dropboxConnectedMessage', { email: userInfo?.email || '' }),
          [{ text: t('common.ok'), onPress: () => navigation.replace('LabelLanguageSetup') }]
        );
      } else {
        Alert.alert(t('common.error'), t('settings.dropboxSignInError'));
      }
    } catch (error) {
      console.error('[DROPBOX] Sign-in error:', error);
      Alert.alert(
        t('common.error'),
        error.message || t('settings.dropboxSignInError')
      );
    } finally {
      setIsSigningInDropbox(false);
    }
  };

  const handleSkip = () => {
    navigation.replace('LabelLanguageSetup');
  };

  const handleGoBack = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top, left: insets.left + 10 }]}
        onPress={handleGoBack}
      >
        <Text style={styles.backButtonText}>←</Text>
      </TouchableOpacity>
      <View style={styles.content}>
        <Text style={styles.title}>{t('googleSignUp.title')}</Text>
        <Text style={styles.subtitle}>
          {t('googleSignUp.subtitle')}
        </Text>

        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={handleGoogleSignIn}
          disabled={isSigningInGoogle || isSigningInDropbox}
        >
          {isSigningInGoogle ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.buttonText, styles.googleButtonText]}>{t('settings.connectToGoogleAccount')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.dropboxButton]}
          onPress={handleDropboxSignIn}
          disabled={isSigningInGoogle || isSigningInDropbox}
        >
          {isSigningInDropbox ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.buttonText, styles.dropboxButtonText]}>{t('settings.connectToDropbox')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.skipButton]}
          onPress={handleSkip}
          disabled={isSigningInGoogle || isSigningInDropbox}
        >
          <Text style={styles.buttonText}>{t('googleSignUp.skipForNow')}</Text>
        </TouchableOpacity>
      </View>

      {/* Plan Selection Modal */}
      <Modal
        visible={showPlanModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPlanModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('planModal.title')}</Text>
              <TouchableOpacity
                onPress={() => setShowPlanModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollView}>
              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                  onPress={async () => {
                    await updateUserPlan('starter');
                    setShowPlanModal(false);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>{t('firstLoad.starter')}</Text>
                    <Text style={styles.planPrice}>Free</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('firstLoad.starterDesc')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                  onPress={async () => {
                    await updateUserPlan('pro');
                    setShowPlanModal(false);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>{t('firstLoad.pro')}</Text>
                    <Text style={styles.planPrice}>$8.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('firstLoad.proDesc')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                  onPress={async () => {
                    await updateUserPlan('business');
                    setShowPlanModal(false);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('firstLoad.business')}</Text>
                    <Text style={styles.planPrice}>$24.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>
                  For small teams up to 5 members. $5.99 per additional team member
                </Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                  onPress={() => {
                    setShowPlanModal(false);
                    setShowEnterpriseModal(true);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('firstLoad.enterprise')}</Text>
                    <Text style={styles.planPrice}>Starts at $69.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>
                  For growing organisations with 15 team members and more
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Enterprise Contact Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY, // Yellow background
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 30,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: FONTS.QUICKSAND_BOLD,
    marginTop: 40, // Avoid overlap with back button
  },
  subtitle: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 24,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 50,
  },
  googleButton: {
    backgroundColor: '#000000', // Black background
    borderWidth: 1,
    borderColor: '#000000',
  },
  dropboxButton: {
    backgroundColor: '#0061FF', // Dropbox blue
  },
  skipButton: {
    backgroundColor: '#f0f0f0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
    flexShrink: 1,
  },
  googleButtonText: {
    color: '#fff',
  },
  dropboxButtonText: {
    color: '#FFFFFF',
  },
  backButton: {
    position: 'absolute',
    padding: 10,
    zIndex: 10,
  },
  backButtonText: {
    color: '#000000', // Black arrow
    fontSize: 24,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  modalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 24,
    color: COLORS.GRAY,
  },
  modalScrollView: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  planContainer: {
    marginBottom: 20,
  },
  planButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    marginBottom: 8,
  },
  planButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
    textAlign: 'center',
  },
  planButtonTextSelected: {
    color: '#000000',
  },
  planSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  planButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    fontFamily: FONTS.QUICKSAND_BOLD,
  },
});

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Dimensions,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS } from '../constants/rooms';
import { useTranslation } from 'react-i18next';

const DELETE_FROM_STORAGE_KEY = '@delete_from_storage_preference';
const DELETE_WARNING_SHOWN_KEY = '@delete_warning_shown';

const DeleteConfirmationModal = ({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  deleteFromStorageDefault = true,
  userPlan = 'starter',
  onShowPlanModal,
  planModalVisible = false,
  onPlanModalClose,
  updateUserPlan,
  t: translate,
}) => {
  const { t } = useTranslation();
  const [deleteFromStorage, setDeleteFromStorage] = useState(deleteFromStorageDefault);

  // Load saved checkbox state on mount and when visible changes
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        const saved = await AsyncStorage.getItem(DELETE_FROM_STORAGE_KEY);
        if (saved !== null) {
          const savedValue = JSON.parse(saved);
          // Use saved value if available
          setDeleteFromStorage(savedValue);
        } else {
          // No saved state - use tier-based default
          const defaultForTier = userPlan !== 'starter';
          setDeleteFromStorage(defaultForTier);
        }
      } catch (error) {
        console.error('[DeleteConfirmationModal] Error loading saved state:', error);
        // Fallback to tier-based default
        const defaultForTier = userPlan !== 'starter';
        setDeleteFromStorage(defaultForTier);
      }
    };

    if (visible) {
      loadSavedState();
    }
  }, [visible, userPlan]);

  const isShowingPlanModalRef = useRef(false); // Prevent multiple calls

  // Save checkbox state when it changes
  const handleCheckboxToggle = async () => {
    // Prevent multiple rapid calls
    if (isShowingPlanModalRef.current) {
      return;
    }

    const newValue = !deleteFromStorage;
    
    // If starter tries to check, show plan modal
    if (newValue && userPlan === 'starter') {
      isShowingPlanModalRef.current = true;
      if (onShowPlanModal) {
        onShowPlanModal();
      }
      // Reset after a delay to allow modal to show
      setTimeout(() => {
        isShowingPlanModalRef.current = false;
      }, 500);
      return; // Don't toggle
    }

    // Update state
    setDeleteFromStorage(newValue);
    
    // Save to AsyncStorage
    try {
      await AsyncStorage.setItem(DELETE_FROM_STORAGE_KEY, JSON.stringify(newValue));
    } catch (error) {
      console.error('[DeleteConfirmationModal] Error saving state:', error);
    }
  };


  const [showDeleteWarning, setShowDeleteWarning] = useState(false);
  const pendingDeleteRef = useRef(false); // Track if we're waiting to show warning

  const handleConfirm = async () => {
    // For non-starter users, show warning on first use if checkbox is checked
    if (deleteFromStorage && userPlan !== 'starter') {
      try {
        const warningShown = await AsyncStorage.getItem(DELETE_WARNING_SHOWN_KEY);
        if (!warningShown) {
          setShowDeleteWarning(true);
          pendingDeleteRef.current = true; // Mark that we're waiting to confirm
          return; // Don't proceed yet, wait for warning confirmation
        }
      } catch (error) {
        console.error('[DeleteConfirmationModal] Error checking warning status:', error);
      }
    }
    
    // Proceed with deletion
    onConfirm(deleteFromStorage);
  };

  const handleWarningConfirm = async () => {
    try {
      // Mark warning as shown
      await AsyncStorage.setItem(DELETE_WARNING_SHOWN_KEY, 'true');
      setShowDeleteWarning(false);
      pendingDeleteRef.current = false;
      
      // Now proceed with deletion
      onConfirm(deleteFromStorage);
    } catch (error) {
      console.error('[DeleteConfirmationModal] Error saving warning status:', error);
      // Still proceed with deletion even if save fails
      setShowDeleteWarning(false);
      pendingDeleteRef.current = false;
      onConfirm(deleteFromStorage);
    }
  };

  const handleWarningCancel = () => {
    setShowDeleteWarning(false);
    pendingDeleteRef.current = false;
  };

  const handleCancel = async () => {
    // Reset to saved state or tier-based default on cancel
    try {
      const saved = await AsyncStorage.getItem(DELETE_FROM_STORAGE_KEY);
      if (saved !== null) {
        const savedValue = JSON.parse(saved);
        setDeleteFromStorage(savedValue);
      } else {
        const defaultForTier = userPlan !== 'starter';
        setDeleteFromStorage(defaultForTier);
      }
    } catch (error) {
      const defaultForTier = userPlan !== 'starter';
      setDeleteFromStorage(defaultForTier);
    }
    onCancel();
  };

  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
    >
      <Pressable style={styles.modalOverlay} onPress={handleCancel}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Drag Handle */}
          <View style={styles.dragHandle} />
          
          {/* Header */}
          <View style={styles.modalHeader}>
            {/* Close Button - Top Left */}
            <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
              <View style={styles.closeButtonCircle}>
                <Ionicons name="close" size={20} color="#666666" />
              </View>
            </TouchableOpacity>
            
            {/* Title - Centered */}
            <Text style={styles.modalTitle}>{title}</Text>
            
            {/* Spacer to balance the close button */}
            <View style={styles.headerSpacer} />
          </View>
          
          {/* Body */}
          <View style={styles.body}>
            <Text style={styles.message}>{message}</Text>
            
            <View style={styles.checkboxContainer}>
              <TouchableOpacity
                style={styles.checkbox}
                onPress={handleCheckboxToggle}
                disabled={false}
              >
                <View style={[
                  styles.checkboxBox, 
                  deleteFromStorage && styles.checkboxBoxChecked,
                  userPlan === 'starter' && !deleteFromStorage && styles.checkboxBoxDisabled
                ]}>
                  {deleteFromStorage && <Text style={styles.checkboxCheck}>✓</Text>}
                </View>
                <Text style={[
                  styles.checkboxLabel,
                  userPlan === 'starter' && !deleteFromStorage && styles.checkboxLabelDisabled
                ]}>
                  {t('common.deleteFromPhoneStorage')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Footer Buttons */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.deleteButton]}
              onPress={handleConfirm}
            >
              <Text style={styles.deleteButtonText}>
                {t('common.delete')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>

      {/* Delete Warning Modal - Shown for non-starter users on first use */}
      {showDeleteWarning && (
        <View style={styles.warningModalOverlay}>
          <View style={styles.warningModalContent}>
            <View style={styles.warningHeader}>
              <Text style={styles.warningIcon}>⚠️</Text>
              <Text style={styles.warningTitle}>{t('common.warning')}</Text>
            </View>
            <Text style={styles.warningMessage}>
              {t('common.deleteFromStorageWarning', { default: 'Checking the "Delete from phone storage" box will permanently delete photos from your device. This action cannot be undone.' })}
            </Text>
            <View style={styles.warningFooter}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleWarningCancel}
              >
                <Text style={styles.cancelButtonText}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.deleteButton]}
                onPress={handleWarningConfirm}
              >
                <Text style={styles.deleteButtonText}>
                  {t('common.continue')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Plan Modal Overlay - Rendered inside delete confirmation modal */}
      {planModalVisible && (
        <View style={styles.planModalOverlay}>
          <View style={styles.planModalContent}>
            <View style={styles.planModalHeader}>
              <Text style={styles.planModalTitle}>{translate('planModal.title')}</Text>
              <TouchableOpacity
                onPress={onPlanModalClose}
                style={styles.planModalCloseButton}
              >
                <Text style={styles.planModalCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.planModalScrollView}
              contentContainerStyle={styles.planModalScrollViewContent}
              showsVerticalScrollIndicator={true}
            >
              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                  onPress={async () => {
                    if (updateUserPlan) {
                      await updateUserPlan('starter');
                    }
                    onPlanModalClose && onPlanModalClose();
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>
                    {translate('planModal.starter')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{translate('planModal.starterDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                  onPress={async () => {
                    if (updateUserPlan) {
                      await updateUserPlan('pro');
                    }
                    onPlanModalClose && onPlanModalClose();
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>
                    {translate('planModal.pro')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{translate('planModal.proDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                  onPress={async () => {
                    if (updateUserPlan) {
                      await updateUserPlan('business');
                    }
                    onPlanModalClose && onPlanModalClose();
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>
                    {translate('planModal.business')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{translate('planModal.businessDescription')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                  onPress={async () => {
                    if (updateUserPlan) {
                      await updateUserPlan('enterprise');
                    }
                    onPlanModalClose && onPlanModalClose();
                  }}
                >
                  <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>
                    {translate('planModal.enterprise')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{translate('planModal.enterpriseDescription')}</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    zIndex: 9999,
    elevation: 9999,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
    width: '100%',
    zIndex: 10000,
    elevation: 10000,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#E5E5E5',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    left: 20,
    top: 0,
    zIndex: 1,
  },
  closeButtonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    textAlign: 'center',
    flex: 1,
  },
  headerSpacer: {
    width: 32,
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  message: {
    fontSize: 16,
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  checkboxContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: COLORS.PRIMARY,
  },
  checkboxCheck: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    fontSize: 14,
    color: COLORS.TEXT,
    fontWeight: '500',
    flex: 1,
  },
  checkboxLabelDisabled: {
    color: '#999',
  },
  checkboxBoxDisabled: {
    borderColor: '#CCC',
    opacity: 0.6,
  },
  planModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
    zIndex: 10001,
    elevation: 10001,
  },
  planModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    width: '100%',
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  planModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  planModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  planModalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  planModalCloseText: {
    fontSize: 24,
    color: COLORS.GRAY,
  },
  planModalScrollView: {
    maxHeight: Dimensions.get('window').height * 0.6,
  },
  planModalScrollViewContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  planContainer: {
    marginBottom: 20,
  },
  planButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    alignItems: 'center',
  },
  planButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.PRIMARY,
  },
  planButtonTextSelected: {
    color: '#000000',
  },
  planSubtext: {
    fontSize: 14,
    color: COLORS.GRAY,
    marginTop: 8,
    textAlign: 'center',
  },
  warningModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10003,
    elevation: 10003,
    padding: 20,
  },
  warningModalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  warningHeader: {
    alignItems: 'center',
    padding: 24,
    paddingBottom: 16,
  },
  warningIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  warningMessage: {
    fontSize: 16,
    color: COLORS.TEXT,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    lineHeight: 22,
  },
  warningFooter: {
    flexDirection: 'row',
    padding: 24,
    paddingTop: 16,
    gap: 12,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
  },
  cancelButtonText: {
    color: COLORS.TEXT,
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#000000',
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default DeleteConfirmationModal;

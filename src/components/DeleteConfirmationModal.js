import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/rooms';
import { useTranslation } from 'react-i18next';

const DELETE_FROM_STORAGE_KEY = '@delete_from_storage_preference';

const DeleteConfirmationModal = ({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  deleteFromStorageDefault = false,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [deleteFromStorage, setDeleteFromStorage] = useState(deleteFromStorageDefault);

  // Load saved checkbox state when modal becomes visible
  useEffect(() => {
    const loadSavedState = async () => {
      try {
        const saved = await AsyncStorage.getItem(DELETE_FROM_STORAGE_KEY);
        if (saved !== null) {
          setDeleteFromStorage(JSON.parse(saved));
        } else {
          setDeleteFromStorage(deleteFromStorageDefault);
        }
      } catch (error) {
        console.error('[DeleteConfirmationModal] Error loading saved state:', error);
        setDeleteFromStorage(deleteFromStorageDefault);
      }
    };

    if (visible) {
      loadSavedState();
    }
  }, [visible, deleteFromStorageDefault]);

  const handleCheckboxToggle = async () => {
    const newValue = !deleteFromStorage;
    setDeleteFromStorage(newValue);

    try {
      await AsyncStorage.setItem(DELETE_FROM_STORAGE_KEY, JSON.stringify(newValue));
    } catch (error) {
      console.error('[DeleteConfirmationModal] Error saving state:', error);
    }
  };

  const handleConfirm = () => {
    // If checkbox is checked, the OS will show its own system confirmation
    // when we try to delete from the media library.
    // If unchecked, photos are only removed from the app.
    onConfirm(deleteFromStorage);
  };

  const handleCancel = async () => {
    // Reset to saved state on cancel
    try {
      const saved = await AsyncStorage.getItem(DELETE_FROM_STORAGE_KEY);
      if (saved !== null) {
        setDeleteFromStorage(JSON.parse(saved));
      } else {
        setDeleteFromStorage(deleteFromStorageDefault);
      }
    } catch (error) {
      setDeleteFromStorage(deleteFromStorageDefault);
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
        <Pressable style={[styles.modalContent, { paddingBottom: Math.max(20, insets.bottom + 10) }]} onPress={(e) => e.stopPropagation()}>
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
              >
                <View style={[
                  styles.checkboxBox,
                  deleteFromStorage && styles.checkboxBoxChecked,
                ]}>
                  {deleteFromStorage && <Text style={styles.checkboxCheck}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>
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

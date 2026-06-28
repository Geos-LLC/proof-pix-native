import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/rooms';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from 'react-i18next';
import DeleteConfirmationModal from './DeleteConfirmationModal';

const UploadCompletionModal = ({ visible, completedUploads, onClose, onClearCompleted, onDeleteProject }) => {
  const { t } = useTranslation();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  
  if (!completedUploads || completedUploads.length === 0) return null;

  const latestUpload = completedUploads[completedUploads.length - 1];
  const isUploadError = latestUpload.status === 'failed';
  const { result, albumName } = latestUpload;
  const { successful, failed } = result || { successful: [], failed: [] };

  const handleClose = () => {
    onClearCompleted();
    onClose();
  };

  const handleDeleteConfirm = (deleteFromStorage) => {
    if (onDeleteProject) {
      // If onDeleteProject accepts a parameter, pass it; otherwise call without parameter
      if (typeof onDeleteProject === 'function' && onDeleteProject.length > 0) {
        onDeleteProject(deleteFromStorage);
      } else {
        onDeleteProject();
      }
    }
    setShowDeleteConfirm(false);
    handleClose();
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  // Detect if failures are likely due to poor network
  const isNetworkIssue = (() => {
    const toStr = (e) => (typeof e === 'string' ? e : e?.message || '').toLowerCase();
    const errorStr = toStr(latestUpload.error);
    const failedErrors = (failed || []).map(f => toStr(f.error)).join(' ');
    const allErrors = `${errorStr} ${failedErrors}`;
    return /network|timeout|timed out|fetch|econnreset|enotfound|socket|aborted|internet|offline|dns/i.test(allErrors)
      || (failed.length > 0 && successful.length === 0);
  })();

  // Treat as full failure if all photos failed (even if batch itself "completed")
  const isAllFailed = !isUploadError && failed.length > 0 && successful.length === 0;
  const isEffectiveError = isUploadError || isAllFailed;

  const getCompletionMessage = () => {
    if (isEffectiveError) {
      if (isNetworkIssue) {
        return t('gallery.uploadNetworkErrorMessage');
      }
      const err = latestUpload.error;
      const errMsg = (typeof err === 'string' ? err : err?.message);
      if (errMsg) return errMsg;
      if (failed.length > 0) {
        const firstErr = failed[0].error;
        const firstMsg = typeof firstErr === 'string' ? firstErr : firstErr?.message;
        if (firstMsg) return firstMsg;
      }
      return t('gallery.uploadFailedMessage', { defaultValue: 'Upload failed. Please try again.' });
    }
    if (failed.length === 0) {
      return t('gallery.uploadCompleteMessage', { count: successful.length, albumName });
    } else {
      if (isNetworkIssue) {
        return t('gallery.uploadNetworkPartialMessage', { successCount: successful.length, totalCount: successful.length + failed.length });
      }
      return t('gallery.uploadPartialMessage', { successCount: successful.length, failedCount: failed.length });
    }
  };

  const getStatusColor = () => {
    return isEffectiveError ? '#CC0000' : COLORS.PRIMARY;
  };

  const getStatusIcon = () => {
    if (isEffectiveError) return '❌';
    return failed.length === 0 ? '🟡' : '⚠️';
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Drag Handle */}
          <View style={styles.dragHandle} />
          
          {/* Header */}
          <View style={styles.modalHeader}>
            {/* Close Button - Top Left */}
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <View style={styles.closeButtonCircle}>
                <Ionicons name="close" size={20} color="#666666" />
              </View>
            </TouchableOpacity>
            
            {/* Title - Centered */}
            <Text style={styles.modalTitle}>
              {isEffectiveError ? t('gallery.uploadFailedTitle', { defaultValue: 'Upload Failed' }) : failed.length === 0 ? t('gallery.uploadCompleteTitle') : t('gallery.uploadPartialTitle')}
            </Text>
            
            {/* Spacer to balance the close button */}
            <View style={styles.headerSpacer} />
          </View>
          
          {/* Body */}
          <View style={styles.bodyContainer}>
            <Text style={styles.message}>{getCompletionMessage()}</Text>

            {/* Network warning */}
            {(isEffectiveError || failed.length > 0) && isNetworkIssue && (
              <View style={styles.networkWarning}>
                <Ionicons name="wifi-outline" size={20} color="#B45309" style={{ marginRight: 8 }} />
                <Text style={styles.networkWarningText}>
                  {t('gallery.networkWarning', { defaultValue: 'Your internet connection may be unstable. Please check your Wi-Fi or mobile data and try again.' })}
                </Text>
              </View>
            )}

            {!isEffectiveError && successful.length > 0 && (
              <View style={styles.successSection}>
                <Text style={styles.sectionTitle}>
                  🟡 {t('gallery.successfulCount', { count: successful.length })}
                </Text>
                <Text style={styles.sectionText}>
                  {successful.map(item => item.filename || item.photo?.filename || item.photo?.name || 'photo').join(', ')}
                </Text>
              </View>
            )}

            {!isEffectiveError && failed.length > 0 && (
              <View style={styles.failedSection}>
                <Text style={styles.sectionTitle}>
                  ❌ {t('gallery.failedCount', { count: failed.length })}
                </Text>
                <Text style={styles.sectionText}>
                  {failed.map(item => item.filename || item.photo?.filename || item.photo?.name || 'photo').join(', ')}
                </Text>
              </View>
            )}
          </View>
          
          {/* Footer Buttons */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { backgroundColor: getStatusColor() }]}
              onPress={handleClose}
            >
              <Text style={[styles.buttonText, isEffectiveError && { color: '#FFFFFF' }]}>
                {isEffectiveError ? t('common.ok') : failed.length === 0 ? t('gallery.great') : t('common.ok')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.button, styles.deleteButton]}
              onPress={() => setShowDeleteConfirm(true)}
            >
              <Text style={styles.deleteButtonText}>
                🗑️ {t('gallery.deleteProjectButton')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>

      <DeleteConfirmationModal
        visible={showDeleteConfirm}
        title={t('gallery.deleteProjectTitle')}
        message={t('gallery.deleteProjectMessage')}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        deleteFromStorageDefault={true}
      />
    </Modal>
  );
};

const makeStyles = (theme) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.scrim,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
    width: '100%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.borderStrong,
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
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
    textAlign: 'center',
    flex: 1,
  },
  headerSpacer: {
    width: 32,
  },
  bodyContainer: {
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
  networkWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  networkWarningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  successSection: {
    marginBottom: 16,
  },
  failedSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 12,
    color: COLORS.GRAY,
    lineHeight: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.PRIMARY,
  },
  buttonText: {
    color: theme.textPrimary, // Black text for yellow background
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FFE6E6', // Light red background
  },
  deleteButtonText: {
    color: '#CC0000', // Red text
    fontSize: 16,
    fontWeight: '600',
  },
});

export default UploadCompletionModal;

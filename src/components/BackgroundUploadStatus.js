import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Animated
} from 'react-native';
import { COLORS } from '../constants/rooms';

const BackgroundUploadStatus = ({ uploadStatus, onCancelUpload, onCancelAll, onShowDetails }) => {
  const { activeUploads, queueLength, isProcessing } = uploadStatus;
  const hasActiveUploads = activeUploads.length > 0;
  const hasQueuedUploads = queueLength > 0;
  const showStatus = hasActiveUploads || hasQueuedUploads;

  if (!showStatus) return null;

  const getStatusText = () => {
    if (hasActiveUploads) {
      const upload = activeUploads[0];
      const { current, total } = upload.progress;
      return `Uploading ${current}/${total} photos...`;
    } else if (hasQueuedUploads) {
      return `${queueLength} upload(s) queued`;
    }
    return '';
  };

  const getStatusColor = () => {
    if (hasActiveUploads) {
      return '#4CAF50'; // Green for active
    } else if (hasQueuedUploads) {
      return '#FFC107'; // Yellow for queued
    }
    return COLORS.PRIMARY;
  };

  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={onShowDetails}
      activeOpacity={0.7}
    >
      <View style={[styles.statusBar, { backgroundColor: getStatusColor() }]}>
        <View style={styles.statusContent}>
          <ActivityIndicator 
            size="small" 
            color="white" 
            style={styles.spinner}
          />
          <Text style={styles.statusText}>{getStatusText()}</Text>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={(e) => {
              e.stopPropagation();
              if (hasActiveUploads) {
                onCancelUpload(activeUploads[0].id);
              } else {
                onCancelAll();
              }
            }}
          >
            <Text style={styles.cancelText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const UploadDetailsModal = ({ visible, uploadStatus, onClose, onCancelUpload, onMinimize, isPreparing }) => {
  const { activeUploads, queueLength } = uploadStatus;
  const hasSeenUploads = useRef(false);

  // Auto-close only after uploads were active and then finished (not on initial open)
  useEffect(() => {
    if (!visible) {
      hasSeenUploads.current = false;
      return;
    }
    if (activeUploads.length > 0 || queueLength > 0) {
      hasSeenUploads.current = true;
    }
    // Don't auto-close while still preparing
    if (hasSeenUploads.current && activeUploads.length === 0 && queueLength === 0 && !isPreparing) {
      onClose();
    }
  }, [visible, activeUploads.length, queueLength, onClose, isPreparing]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Upload Status</Text>
          </View>

          <ScrollView style={styles.modalBody}>
            {/* Show preparing state when upload is being set up */}
            {isPreparing && activeUploads.length === 0 && (
              <View style={styles.uploadItem}>
                <View style={styles.preparingContainer}>
                  <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginRight: 10 }} />
                  <Text style={styles.preparingText}>Preparing upload...</Text>
                </View>
              </View>
            )}

            {activeUploads.map((upload) => {
              const isLabeling = upload.labelProgress && upload.labelProgress.total > 0 && upload.labelProgress.current < upload.labelProgress.total;
              const isUploading = upload.progress.total > 0;
              const labelPct = upload.labelProgress?.total > 0
                ? Math.round((upload.labelProgress.current / upload.labelProgress.total) * 100) : 0;
              const uploadPct = upload.progress.total > 0
                ? Math.round((upload.progress.current / upload.progress.total) * 100) : 0;

              return (
              <View key={upload.id} style={styles.uploadItem}>
                <View style={styles.uploadHeader}>
                  <Text style={styles.uploadTitle}>{upload.albumName}</Text>
                </View>

                {/* Label preparation progress */}
                {isLabeling && !isUploading && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${labelPct}%`, backgroundColor: '#FF9800' }]} />
                    </View>
                    <Text style={styles.progressText}>
                      Applying labels... {upload.labelProgress.current} / {upload.labelProgress.total}
                    </Text>
                  </View>
                )}

                {/* Upload progress */}
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${uploadPct}%`
                        }
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {isUploading ? `${upload.progress.current} / ${upload.progress.total}` : (isLabeling ? 'Waiting for labels...' : 'Processing labels...')}
                  </Text>
                </View>

                {/* Action buttons underneath the progress bar */}
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity
                    onPress={() => onCancelUpload(upload.id)}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onMinimize}
                    style={styles.minimizeButtonBottom}
                  >
                    <Text style={styles.minimizeButtonText}>Minimize</Text>
                  </TouchableOpacity>
                </View>
              </View>
              );
            })}

            {queueLength > 0 && (
              <View style={styles.queueItem}>
                <Text style={styles.queueText}>
                  {queueLength} upload(s) waiting in queue
                </Text>
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity
                    onPress={() => {
                      // Cancel all queued uploads
                      for (let i = 0; i < queueLength; i++) {
                        onCancelUpload('all');
                      }
                    }}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelButtonText}>Cancel All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onMinimize}
                    style={styles.minimizeButtonBottom}
                  >
                    <Text style={styles.minimizeButtonText}>Minimize</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
  },
  statusBar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spinner: {
    marginRight: 8,
  },
  statusText: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  cancelButton: {
    padding: 4,
  },
  cancelText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '90%',
    maxHeight: '80%',
  },
  modalHeader: {
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.TEXT,
  },
  modalHeaderButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  minimizeButton: {
    padding: 4,
    marginRight: 8,
  },
  minimizeText: {
    fontSize: 18,
    color: COLORS.GRAY,
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 18,
    color: COLORS.GRAY,
  },
  modalBody: {
    padding: 16,
  },
  uploadItem: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
  },
  uploadHeader: {
    marginBottom: 8,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#FFE6E6',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#CC0000',
    fontSize: 14,
    fontWeight: '600',
  },
  minimizeButtonBottom: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY, // Default yellow color
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  minimizeButtonText: {
    color: '#000000', // Black text for yellow background
    fontSize: 14,
    fontWeight: '600',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginRight: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.PRIMARY, // Default yellow color
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: COLORS.GRAY,
    minWidth: 60,
    textAlign: 'right',
  },
  preparingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  preparingText: {
    fontSize: 15,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  queueItem: {
    padding: 12,
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  queueText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
  },
});

export { BackgroundUploadStatus, UploadDetailsModal };

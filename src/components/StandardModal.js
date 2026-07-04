import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Standard Modal Component
 * Matches the design specification:
 * - White modal with rounded corners
 * - Drag handle at the top
 * - Close button (X) in light gray circle at top-left
 * - Centered title
 * - Content area
 * - Optional action button at bottom
 */
export default function StandardModal({
  visible,
  onClose,
  title,
  children,
  buttonText,
  onButtonPress,
  showButton = false,
  scrollable = true,
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const content = scrollable ? (
    <ScrollView style={styles.modalScrollView} contentContainerStyle={styles.modalScrollContent}>
      {children}
    </ScrollView>
  ) : (
    <View style={styles.modalContentArea}>{children}</View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalContainer} onPress={(e) => e.stopPropagation()}>
          {/* Drag Handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.modalHeader}>
            {/* Close Button - Top Left */}
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <View style={styles.closeButtonCircle}>
                <Ionicons name="close" size={20} color="#666666" />
              </View>
            </TouchableOpacity>

            {/* Title - Centered */}
            <Text style={styles.modalTitle}>{title}</Text>

            {/* Spacer to balance the close button */}
            <View style={styles.headerSpacer} />
          </View>

          {/* Content */}
          {content}

          {/* Action Button */}
          {showButton && buttonText && (
            <TouchableOpacity style={styles.actionButton} onPress={onButtonPress || onClose}>
              <Text style={styles.actionButtonText}>{buttonText}</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: theme.scrim,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
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
  modalScrollView: {
    flex: 1,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  modalContentArea: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  actionButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});






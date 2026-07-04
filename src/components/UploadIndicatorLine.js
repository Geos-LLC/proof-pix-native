import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS } from '../constants/rooms';
import { useTheme } from '../hooks/useTheme';

const UploadIndicatorLine = ({ uploadStatus, onPress }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { activeUploads, queueLength } = uploadStatus;
  const hasActiveUploads = activeUploads.length > 0;
  const hasQueuedUploads = queueLength > 0;
  const showIndicator = hasActiveUploads || hasQueuedUploads;

  const pulseAnim = useRef(new Animated.Value(0)).current;

  const getPhase = () => {
    if (!hasActiveUploads) return null;
    const upload = activeUploads[0];
    const lp = upload.labelProgress;
    const isLabeling = lp && lp.total > 0 && lp.current < lp.total;
    const isUploading = upload.progress && upload.progress.total > 0;
    if (isLabeling && !isUploading) return 'labeling';
    return 'uploading';
  };

  const getProgressPercent = () => {
    if (!hasActiveUploads) return 0;
    const upload = activeUploads[0];
    const phase = getPhase();
    if (phase === 'labeling') {
      const { current, total } = upload.labelProgress;
      return total > 0 ? (current / total) * 100 : 0;
    }
    const { current, total } = upload.progress;
    return total > 0 ? (current / total) * 100 : 0;
  };

  useEffect(() => {
    if (showIndicator) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(0);
    }
  }, [showIndicator, pulseAnim]);

  if (!showIndicator) return null;

  const phase = getPhase();
  const isLabeling = phase === 'labeling';
  const accentColor = isLabeling ? '#FF9500' : COLORS.PRIMARY;
  const progressPercent = getProgressPercent();

  const getStatusText = () => {
    if (hasActiveUploads) {
      const upload = activeUploads[0];
      if (isLabeling) {
        const { current, total } = upload.labelProgress;
        return t('upload.preparingProgress', { current, total });
      }
      const { current, total } = upload.progress;
      return t('upload.uploadingProgress', { current, total });
    }
    if (hasQueuedUploads) return t('upload.queuedShort', { count: queueLength });
    return '';
  };

  const iconOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress && onPress()}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        {/* Pulsing icon */}
        <Animated.View style={{ opacity: iconOpacity }}>
          <Ionicons
            name={isLabeling ? 'brush-outline' : 'cloud-upload-outline'}
            size={14}
            color={accentColor}
          />
        </Animated.View>

        {/* Status text */}
        <Text style={[styles.statusText, { color: theme.textSecondary }]}>
          {getStatusText()}
        </Text>

        {/* Tap hint */}
        <Ionicons name="chevron-forward" size={12} color={theme.textMuted} />
      </View>

      {/* Progress bar track */}
      <View style={styles.trackContainer}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.max(progressPercent, 1)}%`,
                backgroundColor: accentColor,
              },
            ]}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const makeStyles = (theme) => StyleSheet.create({
  container: {
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    paddingTop: 6,
    paddingBottom: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 5,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    letterSpacing: 0.2,
  },
  trackContainer: {
    paddingHorizontal: 16,
  },
  track: {
    height: 3,
    backgroundColor: theme.border,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 1.5,
  },
});

export default UploadIndicatorLine;

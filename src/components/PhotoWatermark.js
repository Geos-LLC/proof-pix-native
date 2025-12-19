import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useSettings } from '../context/SettingsContext';

const DEFAULT_WATERMARK_TEXT = 'Created with ProofPix.app';
const DEFAULT_LABEL_BACKGROUND = '#FFD700';
const DEFAULT_WATERMARK_OPACITY = 0.5;

/**
 * Watermark component that displays "Created with ProofPix.app" with a clickable link
 * Positioned at the bottom-right corner of photos
 * Uses same styling as PhotoLabel with 80% opacity
 */
export default function PhotoWatermark({ style = {}, textStyle = {}, onPress }) {
  const {
    customWatermarkEnabled,
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkOpacity,
    labelBackgroundColor,
  } = useSettings();

  const fallbackUrl = process.env.EXPO_PUBLIC_WATERMARK_URL || 'https://geos-ai.com/';

  const { displayText, targetUrl } = useMemo(() => {
    const rawText = customWatermarkEnabled ? watermarkText : DEFAULT_WATERMARK_TEXT;
    const resolvedText = rawText?.trim() || '';
    const rawUrl = customWatermarkEnabled ? watermarkLink : fallbackUrl;
    const trimmedUrl = rawUrl?.trim() || '';
    const normalizedUrl =
      trimmedUrl && /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : trimmedUrl ? `https://${trimmedUrl}` : null;

    return {
      displayText: resolvedText,
      targetUrl: normalizedUrl,
    };
  }, [customWatermarkEnabled, watermarkLink, watermarkText, fallbackUrl]);

  if (!displayText) {
    return null;
  }

  const activeColor = customWatermarkEnabled
    ? watermarkColor || labelBackgroundColor || DEFAULT_LABEL_BACKGROUND
    : labelBackgroundColor || DEFAULT_LABEL_BACKGROUND;

  const activeOpacity =
    customWatermarkEnabled && typeof watermarkOpacity === 'number'
      ? watermarkOpacity
      : DEFAULT_WATERMARK_OPACITY;

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (targetUrl) {
      Linking.openURL(targetUrl).catch((err) => console.error('Failed to open URL:', err));
    }
  };

  return (
    <View style={[styles.watermark, style, { opacity: activeOpacity }]}>
      {targetUrl ? (
        <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
          <Text style={[styles.watermarkText, textStyle, { color: activeColor }]}>{displayText}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.watermarkText, textStyle, { color: activeColor }]}>{displayText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  watermarkText: {
    fontSize: 14,
    fontWeight: 'bold'
  },
});

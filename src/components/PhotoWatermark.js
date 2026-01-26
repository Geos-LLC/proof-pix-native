import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useSettings } from '../context/SettingsContext';
import { getLabelPositions } from '../constants/rooms';

const DEFAULT_WATERMARK_TEXT = 'Created with ProofPix.app';
const DEFAULT_LABEL_BACKGROUND = '#FFD700';
const DEFAULT_WATERMARK_OPACITY = 0.5;

const FONT_FAMILY_MAP = {
  system: null,
  montserratBold: 'Montserrat_700Bold',
  playfairBold: 'PlayfairDisplay_700Bold',
  robotoMonoBold: 'RobotoMono_700Bold',
  latoBold: 'Lato_700Bold',
  poppinsSemiBold: 'Poppins_600SemiBold',
  oswaldSemiBold: 'Oswald_600SemiBold',
  serif: 'PlayfairDisplay_700Bold',
  monospace: 'RobotoMono_700Bold',
};

/**
 * Watermark component that displays "Created with ProofPix.app" with a clickable link
 * Positioned at the bottom-right corner of photos by default, or as configured
 * Uses same styling as PhotoLabel with configurable opacity
 */
export default function PhotoWatermark({ style = {}, textStyle = {}, onPress }) {
  const {
    customWatermarkEnabled,
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkFontFamily,
    labelBackgroundColor,
    labelMarginVertical,
    labelMarginHorizontal,
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

  console.log('[PhotoWatermark] Rendering watermark:', { 
    displayText, 
    customWatermarkEnabled, 
    watermarkText, 
    watermarkColor,
    watermarkOpacity,
    watermarkPosition 
  });

  if (!displayText) {
    console.log('[PhotoWatermark] No displayText, returning null');
    return null;
  }

  // Always use watermarkColor if it exists, otherwise fall back to labelBackgroundColor
  // The customWatermarkEnabled flag only controls text/link, not color
  const activeColor = watermarkColor || labelBackgroundColor || DEFAULT_LABEL_BACKGROUND;

  // Always use watermarkOpacity if it's set, otherwise use default
  // The customWatermarkEnabled flag only controls text/link, not opacity
  const activeOpacity = typeof watermarkOpacity === 'number' 
    ? watermarkOpacity 
    : DEFAULT_WATERMARK_OPACITY;

  // Get position styles - use label margins for consistency (or default to 10 if not set)
  const marginV = labelMarginVertical ?? 10;
  const marginH = labelMarginHorizontal ?? 10;
  const positions = getLabelPositions(marginV, marginH);
  const positionKey = watermarkPosition || 'right-bottom';
  const positionStyle = positions[positionKey] || positions['right-bottom'];
  const { name, horizontalAlign, verticalAlign, ...positionCoordinates } = positionStyle;

  // Get font family
  const canonicalKey = watermarkFontFamily || 'system';
  const normalizedKey = canonicalKey.toLowerCase();
  const selectedFontFamily =
    FONT_FAMILY_MAP[canonicalKey] ||
    FONT_FAMILY_MAP[normalizedKey] ||
    null;

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (targetUrl) {
      Linking.openURL(targetUrl).catch((err) => console.error('Failed to open URL:', err));
    }
  };

  return (
    <View style={[styles.watermark, positionCoordinates, style, { opacity: activeOpacity }]}>
      {targetUrl ? (
        <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
          <Text style={[
            styles.watermarkText,
            textStyle,
            { color: activeColor },
            selectedFontFamily ? { fontFamily: selectedFontFamily } : null,
          ]}>
            {displayText}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={[
          styles.watermarkText,
          textStyle,
          { color: activeColor },
          selectedFontFamily ? { fontFamily: selectedFontFamily } : null,
        ]}>
          {displayText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: {
    position: 'absolute',
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    zIndex: 100, // Ensure watermark appears above other elements
  },
  watermarkText: {
    fontSize: 14,
    fontWeight: 'bold'
  },
});

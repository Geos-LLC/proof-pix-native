import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { LABEL_POSITIONS, getLabelPositions } from '../constants/rooms';

const FONT_FAMILY_MAP = {
  alexandria: 'Alexandria_400Regular',
  system: 'Alexandria_400Regular',
  montserratBold: 'Alexandria_400Regular',
  playfairBold: 'Alexandria_400Regular',
  robotoMonoBold: 'Alexandria_400Regular',
  latoBold: 'Alexandria_400Regular',
  poppinsSemiBold: 'Alexandria_400Regular',
  oswaldSemiBold: 'Alexandria_400Regular',
  serif: 'Alexandria_400Regular',
  monospace: 'Alexandria_400Regular',
  seriflegacy: 'Alexandria_400Regular',
  monospacelegacy: 'Alexandria_400Regular',
};

const LABEL_SIZE_MAP = {
  small: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 70,
  },
  medium: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 88,
  },
  large: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 104,
  },
};

/**
 * Centralized photo label component for consistent styling across all screens
 * Supports custom background color, text color, font family, and position from settings
 * @param {string} label - The text to display (e.g., "BEFORE", "AFTER")
 * @param {string} position - Position key from LABEL_POSITIONS (e.g., "left-top", "center-middle")
 * @param {object} style - Additional custom styles to override
 * @param {object} textStyle - Additional custom text styles
 */
export default function PhotoLabel({ label, position = 'left-top', style = {}, textStyle = {}, backgroundColor, textColor, size }) {
  const {
    labelBackgroundColor,
    labelTextColor,
    labelFontFamily,
    labelSize,
    labelCornerStyle,
    labelMarginVertical,
    labelMarginHorizontal,
    labelLanguage,
  } = useSettings();
  const { t, i18n } = useTranslation();

  const getLabelText = () => {
    const targetLng = labelLanguage;
    // Check if a translation key exists for the label, otherwise use the label as is.
    if (i18n.exists(label, { lng: targetLng })) {
      return t(label, { lng: targetLng });
    }
    // Fallback for hardcoded labels like "BEFORE", "AFTER", "LABEL"
    return label;
  };

  const renderedLabel = getLabelText();

  const canonicalKey = labelFontFamily || 'system';
  const normalizedKey = canonicalKey.toLowerCase();
  const selectedFontFamily =
    FONT_FAMILY_MAP[canonicalKey] ||
    FONT_FAMILY_MAP[normalizedKey] ||
    FONT_FAMILY_MAP[`${normalizedKey}legacy`] ||
    null;

  const sizeKey = (size && LABEL_SIZE_MAP[size]) ? size : (labelSize && LABEL_SIZE_MAP[labelSize] ? labelSize : 'medium');
  const sizeStyle = LABEL_SIZE_MAP[sizeKey];
  const cornerRadius = labelCornerStyle === 'square' ? 0 : sizeStyle.borderRadius;

  // Get position styles with custom margins
  const positions = getLabelPositions(labelMarginVertical, labelMarginHorizontal);
  const positionStyle = positions[position] || positions['left-top'];
  const { name, horizontalAlign, verticalAlign, ...positionCoordinates } = positionStyle;

  return (
    <View
      style={[
        styles.label,
        positionCoordinates,
        {
          backgroundColor: backgroundColor || labelBackgroundColor,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          paddingVertical: sizeStyle.paddingVertical,
          borderRadius: cornerRadius,
          minWidth: sizeStyle.minWidth,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.labelText,
          { color: textColor || labelTextColor, fontSize: sizeStyle.fontSize },
          selectedFontFamily ? { fontFamily: selectedFontFamily } : null,
          textStyle,
        ]}
      >
        {renderedLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
});

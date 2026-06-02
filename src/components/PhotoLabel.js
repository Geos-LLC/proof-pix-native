import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import { LABEL_POSITIONS, getLabelPositions } from '../constants/rooms';

// Map font keys to the actual font families loaded in App.js. Previously
// everything was aliased to Alexandria, which is why the font-picker
// "did nothing" — every option rendered the same. Each key here matches
// a real font name registered with `useFonts({...})`.
const FONT_FAMILY_MAP = {
  alexandria: 'Alexandria_400Regular',
  system: 'Alexandria_400Regular',
  montserratBold: 'Montserrat_700Bold',
  playfairBold: 'PlayfairDisplay_700Bold',
  robotoMonoBold: 'RobotoMono_700Bold',
  latoBold: 'Lato_700Bold',
  poppinsSemiBold: 'Poppins_600SemiBold',
  oswaldSemiBold: 'Oswald_600SemiBold',
  // Friendlier aliases used by the WatermarkCustomization screen.
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
  // Legacy keys → reasonable substitutes (still using loaded fonts).
  serif: 'PlayfairDisplay_700Bold',
  monospace: 'RobotoMono_700Bold',
  seriflegacy: 'PlayfairDisplay_700Bold',
  monospacelegacy: 'RobotoMono_700Bold',
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
export default function PhotoLabel({ label, position = 'left-top', style = {}, textStyle = {}, backgroundColor, textColor, size, freeformOffset = null }) {
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

  // Derive the size config. Backwards compatible: accepts the old
  // 'small' | 'medium' | 'large' string keys OR a numeric font size
  // (the new slider sets a number directly). Numeric → padding +
  // border radius + minWidth all derived from the font size so a
  // single slider drives the whole proportion.
  const explicitNumeric = typeof size === 'number' ? size : (typeof labelSize === 'number' ? labelSize : null);
  const sizeKey = (size && LABEL_SIZE_MAP[size]) ? size : (labelSize && LABEL_SIZE_MAP[labelSize] ? labelSize : 'medium');
  const sizeConfigFromNumber = explicitNumeric != null
    ? {
        fontSize: explicitNumeric,
        paddingHorizontal: Math.max(6, Math.round(explicitNumeric * 0.7)),
        paddingVertical: Math.max(2, Math.round(explicitNumeric * 0.35)),
        borderRadius: Math.max(3, Math.round(explicitNumeric * 0.35)),
        minWidth: Math.max(40, Math.round(explicitNumeric * 5)),
      }
    : null;
  const sizeStyle = sizeConfigFromNumber || LABEL_SIZE_MAP[sizeKey];
  const cornerRadius = labelCornerStyle === 'square' ? 0 : sizeStyle.borderRadius;

  // Get position styles with custom margins
  const positions = getLabelPositions(labelMarginVertical, labelMarginHorizontal);
  const positionStyle = positions[position] || positions['left-top'];
  const { name, horizontalAlign, verticalAlign, ...positionCoordinates } = positionStyle;

  // Freeform offset overrides the grid position when present. x/y are
  // fractions (0 = flush left/top, 1 = flush right/bottom). The
  // translate(-x*100%, -y*100%) pulls the label back by its own width
  // and height in proportion to the offset, so x=1 lands the label's
  // right edge at the right edge of the parent.
  const useFreeform = freeformOffset
    && typeof freeformOffset.x === 'number'
    && typeof freeformOffset.y === 'number';
  const freeformStyle = useFreeform
    ? {
        left: `${freeformOffset.x * 100}%`,
        top: `${freeformOffset.y * 100}%`,
        transform: [
          { translateX: `${-freeformOffset.x * 100}%` },
          { translateY: `${-freeformOffset.y * 100}%` },
        ],
      }
    : null;

  return (
    <View
      style={[
        styles.label,
        useFreeform ? null : positionCoordinates,
        freeformStyle,
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

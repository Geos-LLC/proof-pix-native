import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal as RNModal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TouchableWithoutFeedback,
  Switch,
  Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { COLORS, getLabelPositions } from '../constants/rooms';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import { IAP_PRODUCTS, purchaseProduct } from '../services/iapService';
import { isTrialActive } from '../services/trialService';
import ColorPicker, { Panel1, HueSlider } from 'reanimated-color-picker';
import { runOnJS } from 'react-native-reanimated';
// HSL conversion utilities
const hslToHex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
};

const hexToHsl = (hex) => {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
};
import { useTranslation } from 'react-i18next';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';

const getLabelSizeOptions = (t) => [
  { key: 'small', label: t('labelCustomization.small') },
  { key: 'medium', label: t('labelCustomization.medium') },
  { key: 'large', label: t('labelCustomization.large') },
];

const LABEL_SIZE_STYLE_MAP = {
  small: {
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 72,
  },
  medium: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 96,
  },
  large: {
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 104,
  },
};

const getLabelCornerOptions = (t) => [
  { key: 'rounded', label: t('labelCustomization.cornerOptions.rounded') },
  { key: 'square', label: t('labelCustomization.cornerOptions.straight') },
];

const getFontOptions = (t) => [
  { key: 'system', label: t('labelCustomization.fontModal.systemDefault'), fontFamily: null },
  { key: 'montserratBold', label: t('labelCustomization.fontModal.montserratBold'), fontFamily: 'Montserrat_700Bold' },
  { key: 'robotoBold', label: t('labelCustomization.fontModal.robotoBold'), fontFamily: 'Roboto_700Bold' },
  { key: 'openSansBold', label: t('labelCustomization.fontModal.openSansBold'), fontFamily: 'OpenSans_700Bold' },
  { key: 'latoBlack', label: t('labelCustomization.fontModal.latoBlack'), fontFamily: 'Lato_900Black' },
  { key: 'poppinsBold', label: t('labelCustomization.fontModal.poppinsBold'), fontFamily: 'Poppins_700Bold' },
  { key: 'ralewayBold', label: t('labelCustomization.fontModal.ralewayBold'), fontFamily: 'Raleway_700Bold' },
  { key: 'oswaldBold', label: t('labelCustomization.fontModal.oswaldBold'), fontFamily: 'Oswald_700Bold' },
  { key: 'archivoBlack', label: t('labelCustomization.fontModal.archivoBlack'), fontFamily: 'ArchivoBlack_400Regular' },
];

export default function LabelCustomizationScreen({ navigation }) {
  const { t } = useTranslation();
  const {
    labelBackgroundColor,
    labelTextColor,
    labelFontFamily,
    labelSize,
    labelCornerStyle,
    beforeLabelPosition,
    afterLabelPosition,
    combinedLabelPosition,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelFontFamily,
    updateLabelSize,
    updateLabelCornerStyle,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateCombinedLabelPosition,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    shouldShowWatermark,
    showWatermark,
    userPlan,
    updateUserPlan,
    customWatermarkEnabled,
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkOpacity,
    toggleWatermark,
    updateShowWatermark,
    updateWatermarkText,
    updateWatermarkLink,
    updateWatermarkColor,
    updateWatermarkOpacity,
  } = useSettings();

  const { canUse } = useFeaturePermissions();

  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState(null);
  const [draftColor, setDraftColor] = useState('#FFD700');
  const [colorInput, setColorInput] = useState('');
  const [hexModalVisible, setHexModalVisible] = useState(false);
  const [hexModalValue, setHexModalValue] = useState('');
  const [hexModalError, setHexModalError] = useState(null);
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [sliderResetKey, setSliderResetKey] = useState(0);
  const [colorPickerKey, setColorPickerKey] = useState(0);
  const [watermarkOpacityPreview, setWatermarkOpacityPreview] = useState(watermarkOpacity || 0.5);
  const watermarkTextInputRef = useRef(null);
  const watermarkLinkInputRef = useRef(null);

  // HSL state for color picker
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);

  // Watermark swatch color (using existing normalizeHex function defined later)
  const watermarkSwatchColor = useMemo(() => {
    const baseColor = customWatermarkEnabled
      ? watermarkColor || labelBackgroundColor
      : labelBackgroundColor;
    // Use a simple fallback if normalizeHex isn't available yet
    if (typeof normalizeHex === 'function') {
      return normalizeHex(baseColor) || '#FFD700';
    }
    // Fallback: simple hex validation
    if (baseColor && /^#[0-9A-F]{6}$/i.test(baseColor)) {
      return baseColor.toUpperCase();
    }
    return baseColor || '#FFD700';
  }, [customWatermarkEnabled, watermarkColor, labelBackgroundColor]);

  // Update watermark opacity preview when watermarkOpacity changes
  useEffect(() => {
    if (typeof watermarkOpacity === 'number') {
      setWatermarkOpacityPreview(watermarkOpacity);
    }
  }, [watermarkOpacity]);

  const LABEL_SIZE_OPTIONS = useMemo(() => getLabelSizeOptions(t), [t]);
  const LABEL_CORNER_OPTIONS = useMemo(() => getLabelCornerOptions(t), [t]);
  const FONT_OPTIONS = useMemo(() => getFontOptions(t), [t]);

  const currentFontOption = useMemo(() => {
    const normalized = labelFontFamily?.toLowerCase();
    return FONT_OPTIONS.find(
      (opt) => opt.key.toLowerCase() === normalized
    ) || FONT_OPTIONS[0];
  }, [labelFontFamily, FONT_OPTIONS]);

  const hsvToHex = ({ h, s, v }) => {
    const hNorm = h / 360;
    const sNorm = s / 100;
    const vNorm = v / 100;
    const c = vNorm * sNorm;
    const x = c * (1 - Math.abs(((hNorm * 6) % 2) - 1));
    const m = vNorm - c;
    let r = 0,
      g = 0,
      b = 0;
    if (hNorm < 1 / 6) {
      [r, g, b] = [c, x, 0];
    } else if (hNorm < 2 / 6) {
      [r, g, b] = [x, c, 0];
    } else if (hNorm < 3 / 6) {
      [r, g, b] = [0, c, x];
    } else if (hNorm < 4 / 6) {
      [r, g, b] = [0, x, c];
    } else if (hNorm < 5 / 6) {
      [r, g, b] = [x, 0, c];
    } else {
      [r, g, b] = [c, 0, x];
    }
    const rInt = Math.round((r + m) * 255);
    const gInt = Math.round((g + m) * 255);
    const bInt = Math.round((b + m) * 255);
    const hex = ((rInt << 16) | (gInt << 8) | bInt).toString(16).padStart(6, '0');
    return `#${hex.toUpperCase()}`;
  };

  const openColorModal = (type) => {
    console.log('[ColorPicker] openColorModal called with type:', type);
    // Check if user has access
    if (type === 'watermark') {
      if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
        setShowPlanModal(true);
        return;
      }
    } else {
      if (!canUse(FEATURES.CUSTOM_LABELS)) {
        setShowPlanModal(true);
        return;
      }
    }
    
    let currentColor;
    if (type === 'background') {
      currentColor = labelBackgroundColor;
    } else if (type === 'text') {
      currentColor = labelTextColor;
    } else if (type === 'watermark') {
      currentColor = watermarkColor || labelBackgroundColor;
    }
    console.log('[ColorPicker] Setting draftColor to:', currentColor);

    // Initialize HSL values from current color
    const hsl = hexToHsl(currentColor);
    setHue(hsl.h);
    setSaturation(hsl.s);
    setLightness(hsl.l);

    setColorModalType(type);
    setDraftColor(currentColor);
    setColorInput(currentColor);
    setColorModalVisible(true);
  };

  const handleColorModalCancel = () => {
    setColorModalVisible(false);
    setColorModalType(null);
  };

  const handleColorModalApply = async () => {
    if (colorModalType === 'background') {
      await updateLabelBackgroundColor(draftColor);
    } else if (colorModalType === 'text') {
      await updateLabelTextColor(draftColor);
    } else if (colorModalType === 'watermark') {
      await updateWatermarkColor(draftColor);
    }
    setColorModalVisible(false);
    setColorModalType(null);
  };

  const openHexModal = () => {
    const normalized = normalizeHex(colorInput);
    setDraftColor(normalized);
    setColorInput(normalized);
    setHexModalValue(normalized);
    setHexModalError(null);
    setHexModalVisible(true);
  };

  const handleHexModalChange = (text) => {
    const input = text.toUpperCase();
    setHexModalValue(input);
    if (!input) {
      setHexModalError(null);
      return;
    }
    const normalized = normalizeHex(input);
    if (normalized) {
      setHexModalError(null);
    } else if (input.length >= 4) {
      setHexModalError('Enter #RRGGBB, #RGB, or rgb(r, g, b)');
    } else {
      setHexModalError(null);
    }
  };

  const handleHexModalCancel = () => {
    setHexModalVisible(false);
    setHexModalError(null);
  };

  const handleHexModalApply = () => {
    const normalized = normalizeHex(hexModalValue);
    if (!normalized) {
      setHexModalError('Enter #RRGGBB, #RGB, or rgb(r, g, b)');
      return;
    }
    handleDraftColorChange(normalized, { source: 'complete' });
    setHexModalVisible(false);
  };

  const handleDraftColorChange = (color, arg1 = {}, arg2 = null) => {
    let options = {};
    let hsvMeta = null;

    if (arg1 && typeof arg1 === 'object' && 'source' in arg1) {
      options = arg1;
      hsvMeta = arg2;
    } else {
      hsvMeta = arg1;
      options = arg2 && typeof arg2 === 'object' ? arg2 : {};
    }

    const { source } = options;

    let candidateHex = normalizeHex(color);
    if (hsvMeta && typeof hsvMeta === 'object') {
      const { h = 0, s = 0, v = 0 } = hsvMeta;
      if (colorModalType === 'text' && v <= 1) {
        candidateHex = hsvToHex({ h, s, v: 100 });
      } else {
        candidateHex = hsvToHex({ h, s, v });
      }
    }
    const normalized = normalizeHex(candidateHex);
    if (!normalized) {
      return;
    }
    setDraftColor(normalized);
    setColorInput(normalized);
    setHexModalValue(normalized);
    setHexModalError(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('labelCustomization.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionDescription}>
          {t('labelCustomization.description')}
        </Text>

        {/* Corner Style */}
        <View style={styles.settingRowStacked}>
          <View style={styles.cornerControlsRow}>
            <Text style={styles.settingLabel}>{t('labelCustomization.cornerStyle')}</Text>
            <View style={styles.cornerOptions}>
              {LABEL_CORNER_OPTIONS.map((option) => {
                const isSelected = labelCornerStyle === option.key;
                const buttonBorderRadius = option.key === 'square' ? 0 : 8;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.cornerOption,
                      { borderRadius: buttonBorderRadius },
                      isSelected && styles.cornerOptionSelected,
                    ]}
                    onPress={() => updateLabelCornerStyle(option.key)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.cornerOptionText,
                        isSelected && styles.cornerOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Label Size */}
        <Text style={styles.settingLabel}>{t('labelCustomization.labelSize')}</Text>
        <View style={styles.labelPreviewContainer}>
          <View style={styles.labelPreview}>
            {LABEL_SIZE_OPTIONS.map((option) => {
              const sizeStyle =
                LABEL_SIZE_STYLE_MAP[option.key] || LABEL_SIZE_STYLE_MAP.medium;
              const cornerRadius =
                labelCornerStyle === 'square' ? 0 : sizeStyle.borderRadius;
              const isSelected = labelSize === option.key;
              const swatchBackground = isSelected ? labelBackgroundColor : '#E0E0E0';
              const swatchTextColor = isSelected ? labelTextColor : '#666666';
              return (
                <TouchableOpacity
                  key={option.key}
                  style={styles.previewLabelOption}
                  onPress={() => updateLabelSize(option.key)}
                  activeOpacity={0.85}
                >
                  <PhotoLabel
                    label="common.before"
                    position="left-top"
                    style={{
                      position: 'relative',
                      top: 0,
                      left: 0,
                      paddingHorizontal: sizeStyle.paddingHorizontal,
                      paddingVertical: sizeStyle.paddingVertical,
                      minWidth: sizeStyle.minWidth,
                      borderRadius: cornerRadius,
                      borderWidth: 1,
                      borderColor: isSelected ? 'transparent' : '#D0D0D0',
                    }}
                    textStyle={{
                      fontSize: sizeStyle.fontSize,
                    }}
                    backgroundColor={swatchBackground}
                    textColor={swatchTextColor}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Background Color */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{t('labelCustomization.backgroundColor')}</Text>
            <Text style={styles.settingDescription}>
              {labelBackgroundColor?.toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.customSelectorButton}
            onPress={() => openColorModal('background')}
          >
            <View
              style={[
                styles.colorPreviewSwatch,
                { backgroundColor: labelBackgroundColor },
              ]}
            />
            <Text style={styles.customSelectorButtonText}>{t('labelCustomization.pickColor')}</Text>
          </TouchableOpacity>
        </View>

        {/* Text Color */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{t('labelCustomization.textColor')}</Text>
            <Text style={styles.settingDescription}>
              {labelTextColor?.toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.customSelectorButton}
            onPress={() => openColorModal('text')}
          >
            <View
              style={[
                styles.colorPreviewSwatch,
                { backgroundColor: labelTextColor },
              ]}
            />
            <Text style={styles.customSelectorButtonText}>{t('labelCustomization.pickColor')}</Text>
          </TouchableOpacity>
        </View>

        {/* Font Style */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{t('labelCustomization.fontStyle')}</Text>
            <Text style={styles.settingDescription}>
              {currentFontOption?.label}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.fontSelectorButton}
            onPress={() => {
              // Check if user has access to custom labels
              if (!canUse(FEATURES.CUSTOM_LABELS)) {
                setShowPlanModal(true);
                return;
              }
              setFontModalVisible(true);
            }}
          >
            <Text style={styles.fontSelectorButtonText}>{t('labelCustomization.chooseFont')}</Text>
          </TouchableOpacity>
        </View>

        {/* Watermark Customization */}
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{t('settings.customizeWatermark')}</Text>
            <Text style={styles.settingDescription}>
              {customWatermarkEnabled
                ? t('settings.watermarkCustomDescription')
                : t('settings.watermarkDefaultDescription')}
            </Text>
          </View>
          <Switch
            value={customWatermarkEnabled}
            onValueChange={(value) => {
              toggleWatermark(value);
            }}
            trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
            thumbColor="white"
          />
        </View>
        {customWatermarkEnabled && (
          <View style={styles.watermarkCustomization}>
            {/* Add Watermark Checkbox */}
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{t('settings.addWatermark', { defaultValue: 'Add watermark' })}</Text>
                <Text style={styles.settingDescription}>
                  {t('settings.addWatermarkDescription', { defaultValue: 'Show watermark on photos' })}
                </Text>
              </View>
              <Switch
                value={showWatermark}
                onValueChange={(value) => {
                  // Check if user has access to customize watermark
                  if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                    // Starter users cannot turn off watermark - show tier popup
                    if (value === false) {
                      setShowPlanModal(true);
                      return;
                    }
                  }
                  updateShowWatermark(value);
                }}
                trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                thumbColor="white"
              />
            </View>

            <View style={styles.watermarkField}>
              <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkText')}</Text>
              <Pressable
                onPress={() => {
                  if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                    setShowPlanModal(true);
                  } else {
                    // Focus the input if user has access
                    if (watermarkTextInputRef.current) {
                      watermarkTextInputRef.current.focus();
                    }
                  }
                }}
              >
                <TextInput
                  ref={watermarkTextInputRef}
                  style={styles.watermarkInput}
                  value={watermarkText}
                  onChangeText={updateWatermarkText}
                  onFocus={() => {
                    // Check if user has access to customize watermark
                    if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                      setShowPlanModal(true);
                      // Blur the input to prevent typing
                      if (watermarkTextInputRef.current) {
                        watermarkTextInputRef.current.blur();
                      }
                    }
                  }}
                  placeholder={t('settings.watermarkTextPlaceholder')}
                  placeholderTextColor={COLORS.GRAY}
                  editable={canUse(FEATURES.CUSTOM_WATERMARKS)}
                  pointerEvents={canUse(FEATURES.CUSTOM_WATERMARKS) ? 'auto' : 'none'}
                />
              </Pressable>
            </View>
            <View style={styles.watermarkField}>
              <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkLink')}</Text>
              <Pressable
                onPress={() => {
                  if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                    setShowPlanModal(true);
                  } else {
                    // Focus the input if user has access
                    if (watermarkLinkInputRef.current) {
                      watermarkLinkInputRef.current.focus();
                    }
                  }
                }}
              >
                <TextInput
                  ref={watermarkLinkInputRef}
                  style={styles.watermarkInput}
                  value={watermarkLink}
                  onChangeText={updateWatermarkLink}
                  onFocus={() => {
                    // Check if user has access to customize watermark
                    if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                      setShowPlanModal(true);
                      // Blur the input to prevent typing
                      if (watermarkLinkInputRef.current) {
                        watermarkLinkInputRef.current.blur();
                      }
                    }
                  }}
                  placeholder={t('settings.watermarkLinkPlaceholder')}
                  placeholderTextColor={COLORS.GRAY}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={canUse(FEATURES.CUSTOM_WATERMARKS)}
                  pointerEvents={canUse(FEATURES.CUSTOM_WATERMARKS) ? 'auto' : 'none'}
                />
              </Pressable>
            </View>
            <View style={styles.watermarkColorRow}>
              <View style={styles.watermarkColorInfo}>
                <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkColor')}</Text>
                <Text style={styles.watermarkColorValue}>{watermarkSwatchColor}</Text>
              </View>
              <TouchableOpacity
                style={styles.watermarkColorButton}
                onPress={() => {
                  // Check if user has access to customize watermark
                  if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                    setShowPlanModal(true);
                    return;
                  }
                  openColorModal('watermark');
                }}
              >
                <View
                  style={[
                    styles.colorPreviewSwatch,
                    styles.watermarkColorSwatch,
                    { backgroundColor: watermarkSwatchColor },
                  ]}
                />
                <Text style={styles.customSelectorButtonText}>{t('settings.pickColor')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.watermarkOpacityRow}>
              <Text style={styles.watermarkFieldLabel}>{t('settings.opacity')}</Text>
              <View style={styles.watermarkOpacityControls}>
                <Slider
                  style={styles.slider}
                  minimumValue={0}
                  maximumValue={1}
                  step={0.01}
                  value={watermarkOpacityPreview}
                  onValueChange={(value) => {
                    // Update preview during dragging (don't check permissions here to avoid jumping)
                    setWatermarkOpacityPreview(value);
                  }}
                  onSlidingComplete={(value) => {
                    // Check if user has access to customize watermark when dragging ends
                    if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                      setShowPlanModal(true);
                      // Reset to original value
                      setWatermarkOpacityPreview(watermarkOpacity);
                      return;
                    }
                    updateWatermarkOpacity(value);
                  }}
                  minimumTrackTintColor={watermarkSwatchColor}
                  maximumTrackTintColor="#d3d3d3"
                  thumbTintColor={watermarkSwatchColor}
                  disabled={!canUse(FEATURES.CUSTOM_WATERMARKS)}
                />
                <Text style={styles.watermarkOpacityValue}>
                  {Math.round(watermarkOpacityPreview * 100)}%
                </Text>
              </View>
            </View>
            <Text style={styles.watermarkHelperText}>
              {t('settings.watermarkHelperText')}
            </Text>
          </View>
        )}

        {/* Label Position */}
        <View style={styles.settingRowStacked}>
          <Text style={styles.settingLabel}>{t('labelCustomization.labelPosition')}</Text>
          <Text style={styles.settingDescription}>
            {t('labelCustomization.positionDescription')}
          </Text>

          {/* Dummy Photo Preview */}
          <View style={styles.positionPreviewContainer}>
            <View style={styles.positionPreviewBox}>
              {/* Left half - BEFORE */}
              <View style={styles.previewHalfBefore}>
                <View
                  style={[
                    styles.previewLabelPosition,
                    getLabelPositions(labelMarginVertical, labelMarginHorizontal)[beforeLabelPosition]
                  ]}
                >
                  <PhotoLabel
                    label="common.before"
                    position="left-top"
                    style={{ position: 'relative', top: 0, left: 0 }}
                  />
                </View>
              </View>

              {/* Right half - AFTER */}
              <View style={styles.previewHalfAfter}>
                <View
                  style={[
                    styles.previewLabelPosition,
                    getLabelPositions(labelMarginVertical, labelMarginHorizontal)[afterLabelPosition]
                  ]}
                >
                  <PhotoLabel
                    label="common.after"
                    position="left-top"
                    style={{ position: 'relative', top: 0, left: 0 }}
                  />
                </View>
              </View>
              {/* Watermark Preview */}
              {shouldShowWatermark && (
                <PhotoWatermark />
              )}
            </View>
          </View>

          {/* Grid-Based Position Selector */}
          <View style={styles.positionGridContainer}>
            {/* Grid for BEFORE (left side) */}
            <View style={styles.gridHalf}>
              <View style={styles.gridRow}>
                {['left-top', 'center-top', 'right-top'].map((key) => (
                  <TouchableOpacity
                    key={`before-${key}`}
                    style={[
                      styles.gridCell,
                      beforeLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateBeforeLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
              <View style={styles.gridRow}>
                {['left-middle', 'center-middle', 'right-middle'].map((key) => (
                  <TouchableOpacity
                    key={`before-${key}`}
                    style={[
                      styles.gridCell,
                      beforeLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateBeforeLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
              <View style={styles.gridRow}>
                {['left-bottom', 'center-bottom', 'right-bottom'].map((key) => (
                  <TouchableOpacity
                    key={`before-${key}`}
                    style={[
                      styles.gridCell,
                      beforeLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateBeforeLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
            </View>

            {/* Grid for AFTER (right side) */}
            <View style={styles.gridHalf}>
              <View style={styles.gridRow}>
                {['left-top', 'center-top', 'right-top'].map((key) => (
                  <TouchableOpacity
                    key={`after-${key}`}
                    style={[
                      styles.gridCell,
                      afterLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateAfterLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
              <View style={styles.gridRow}>
                {['left-middle', 'center-middle', 'right-middle'].map((key) => (
                  <TouchableOpacity
                    key={`after-${key}`}
                    style={[
                      styles.gridCell,
                      afterLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateAfterLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
              <View style={styles.gridRow}>
                {['left-bottom', 'center-bottom', 'right-bottom'].map((key) => (
                  <TouchableOpacity
                    key={`after-${key}`}
                    style={[
                      styles.gridCell,
                      afterLabelPosition === key && styles.gridCellSelected
                    ]}
                    onPress={() => {
                      // Check if user has access to custom labels
                      if (!canUse(FEATURES.CUSTOM_LABELS)) {
                        setShowPlanModal(true);
                        return;
                      }
                      updateAfterLabelPosition(key);
                      updateCombinedLabelPosition(key);
                    }}
                    activeOpacity={0.7}
                  />
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Label Margins */}
        <View style={styles.settingRowStacked}>
          <Text style={styles.settingLabel}>{t('labelCustomization.labelMargins')}</Text>
          <Text style={styles.settingDescription}>
            {t('labelCustomization.marginsDescription')}
          </Text>

          {/* Vertical Margin Slider */}
          <View style={styles.marginSliderContainer}>
            <Text style={styles.marginSliderLabel}>
              {t('labelCustomization.verticalMargin', { value: labelMarginVertical })}
            </Text>
            <View style={styles.sliderWrapper}>
              <Slider
                key={`vertical-${sliderResetKey}`}
                style={styles.slider}
                minimumValue={0}
                maximumValue={50}
                step={1}
                value={labelMarginVertical}
                onValueChange={(value) => {
                  // Check if user has access to custom labels
                  if (!canUse(FEATURES.CUSTOM_LABELS)) {
                    setShowPlanModal(true);
                    // Force slider to reset by updating key
                    setSliderResetKey(prev => prev + 1);
                    return;
                  }
                  updateLabelMarginVertical(value);
                }}
                minimumTrackTintColor={COLORS.PRIMARY}
                maximumTrackTintColor="#d3d3d3"
                thumbTintColor={COLORS.PRIMARY}
              />
              <View style={styles.sliderDefaultMark} />
            </View>
          </View>

          {/* Horizontal Margin Slider */}
          <View style={styles.marginSliderContainer}>
            <Text style={styles.marginSliderLabel}>
              {t('labelCustomization.horizontalMargin', { value: labelMarginHorizontal })}
            </Text>
            <View style={styles.sliderWrapper}>
              <Slider
                key={`horizontal-${sliderResetKey}`}
                style={styles.slider}
                minimumValue={0}
                maximumValue={50}
                step={1}
                value={labelMarginHorizontal}
                onValueChange={(value) => {
                  // Check if user has access to custom labels
                  if (!canUse(FEATURES.CUSTOM_LABELS)) {
                    setShowPlanModal(true);
                    // Force slider to reset by updating key
                    setSliderResetKey(prev => prev + 1);
                    return;
                  }
                  updateLabelMarginHorizontal(value);
                }}
                minimumTrackTintColor={COLORS.PRIMARY}
                maximumTrackTintColor="#d3d3d3"
                thumbTintColor={COLORS.PRIMARY}
              />
              <View style={styles.sliderDefaultMark} />
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Color Picker Modal */}
      <RNModal visible={colorModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback onPress={handleColorModalCancel}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <View style={styles.colorModalContainer}>
            <View style={styles.colorModalHeader}>
              <Text style={styles.colorModalTitle}>
                {colorModalType === 'background'
                  ? t('labelCustomization.colorPicker.backgroundTitle')
                  : t('labelCustomization.colorPicker.textTitle')}
              </Text>
              <TouchableOpacity onPress={openHexModal}>
                <Text style={styles.hexInputLink}>{t('labelCustomization.colorPicker.enterHex')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.colorPickerWrapper}>
              <ColorPicker
                value={draftColor}
                onComplete={(colors) => {
                  'worklet';
                  runOnJS(setDraftColor)(colors.hex);
                  runOnJS(setColorInput)(colors.hex);
                }}
              >
                <Panel1 style={styles.colorPanel} />
                <HueSlider style={styles.hueSlider} />
              </ColorPicker>
            </View>
            <View style={styles.colorPreview}>
              <View style={[styles.colorPreviewBox, { backgroundColor: draftColor }]} />
              <Text style={styles.colorPreviewText}>{draftColor}</Text>
            </View>
            <View style={styles.colorModalActions}>
              <TouchableOpacity
                style={[styles.colorModalButton, styles.cancelButton]}
                onPress={handleColorModalCancel}
              >
                <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.colorModalButton, styles.applyButton]}
                onPress={handleColorModalApply}
              >
                <Text style={styles.applyButtonText}>{t('common.apply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </RNModal>

      {/* Hex Input Modal */}
      <RNModal visible={hexModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback onPress={handleHexModalCancel}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <View style={styles.hexModalContainer}>
            <Text style={styles.hexModalTitle}>{t('labelCustomization.colorPicker.enterColor')}</Text>
            <TextInput
              style={styles.hexInput}
              value={hexModalValue}
              onChangeText={handleHexModalChange}
              placeholder={t('labelCustomization.colorPicker.hexPlaceholder')}
              placeholderTextColor="#999"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {hexModalError ? (
              <Text style={styles.hexModalError}>{hexModalError}</Text>
            ) : null}
            <View style={styles.hexModalActions}>
              <TouchableOpacity
                style={[styles.hexModalButton, styles.cancelButton]}
                onPress={handleHexModalCancel}
              >
                <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.hexModalButton, styles.applyButton]}
                onPress={handleHexModalApply}
              >
                <Text style={styles.applyButtonText}>{t('common.apply')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </RNModal>

      {/* Font Modal */}
      <RNModal visible={fontModalVisible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={() => setFontModalVisible(false)}>
          <View style={styles.modalBackdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.fontModalContainer}>
          <View style={styles.fontModalHeader}>
            <Text style={styles.fontModalTitle}>{t('labelCustomization.fontModal.title')}</Text>
            <TouchableOpacity onPress={() => setFontModalVisible(false)}>
              <Text style={styles.fontModalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.fontList}>
            {FONT_OPTIONS.map((option) => {
              const isSelected = currentFontOption?.key === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.fontOption,
                    isSelected && styles.fontOptionSelected,
                  ]}
                  onPress={() => {
                    updateLabelFontFamily(option.key);
                    setFontModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.fontOptionLabel,
                      option.fontFamily && { fontFamily: option.fontFamily },
                    ]}
                  >
                    {option.label}
                  </Text>
                  {isSelected && (
                    <Text style={styles.fontOptionCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </RNModal>

      {/* Plan Selection Modal */}
      <RNModal
        visible={showPlanModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowPlanModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('planModal.title')}</Text>
              <TouchableOpacity
                onPress={() => setShowPlanModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScrollView}>
              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                  onPress={async () => {
                    await updateUserPlan('starter');
                    setShowPlanModal(false);
                    // Reset color picker key to ensure proper remounting
                    setColorPickerKey((prev) => prev + 1);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>{t('firstLoad.starter')}</Text>
                    <Text style={styles.planPrice}>Free</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('firstLoad.starterDesc')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                  onPress={async () => {
                    // Check if user is on active trial - if so, skip IAP
                    const onTrial = await isTrialActive();

                    // On iOS, require in-app purchase for Pro plan (unless on trial)
                    if (Platform.OS === 'ios' && !onTrial) {
                      try {
                        await purchaseProduct(IAP_PRODUCTS.PRO_MONTHLY);
                      } catch (err) {
                        if (err?.message === 'USER_CANCELLED') {
                          return;
                        }
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('settings.purchaseFailed', { defaultValue: 'Purchase failed. Please try again.' })
                        );
                        return;
                      }
                    }
                    await updateUserPlan('pro');
                    setShowPlanModal(false);
                    // Reset color picker key to ensure proper remounting
                    setColorPickerKey((prev) => prev + 1);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>{t('firstLoad.pro')}</Text>
                    <Text style={styles.planPrice}>$8.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>{t('firstLoad.proDesc')}</Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                  onPress={async () => {
                    // Check if user is on active trial - if so, skip IAP
                    const onTrial = await isTrialActive();

                    // On iOS, require in-app purchase for Business plan (unless on trial)
                    if (Platform.OS === 'ios' && !onTrial) {
                      try {
                        await purchaseProduct(IAP_PRODUCTS.BUSINESS_MONTHLY);
                      } catch (err) {
                        if (err?.message === 'USER_CANCELLED') {
                          return;
                        }
                        Alert.alert(
                          t('common.error', { defaultValue: 'Error' }),
                          t('settings.purchaseFailed', { defaultValue: 'Purchase failed. Please try again.' })
                        );
                        return;
                      }
                    }
                    await updateUserPlan('business');
                    setShowPlanModal(false);
                    // Reset color picker key to ensure proper remounting
                    setColorPickerKey((prev) => prev + 1);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('firstLoad.business')}</Text>
                    <Text style={styles.planPrice}>$24.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>
                  For small teams up to 5 members. $5.99 per additional team member
                </Text>
              </View>

              <View style={styles.planContainer}>
                <TouchableOpacity
                  style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                  onPress={() => {
                    setShowPlanModal(false);
                    setShowEnterpriseModal(true);
                  }}
                >
                  <View style={styles.planButtonRow}>
                    <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('firstLoad.enterprise')}</Text>
                    <Text style={styles.planPrice}>Starts at $69.99/month</Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.planSubtext}>
                  For growing organisations with 15 team members and more
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </RNModal>

      {/* Enterprise Contact Form Modal */}
      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 24,
    color: COLORS.PRIMARY,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.TEXT,
  },
  headerSpacer: {
    width: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  sectionDescription: {
    fontSize: 14,
    color: COLORS.GRAY,
    marginBottom: 24,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  settingRowStacked: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: COLORS.GRAY,
  },
  customSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  colorPreviewSwatch: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#DDD',
  },
  customSelectorButtonText: {
    fontSize: 14,
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  fontSelectorButton: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  fontSelectorButtonText: {
    fontSize: 14,
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  cornerControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cornerOptions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  cornerOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: '#F5F5F5',
    minWidth: 100,
    alignItems: 'center',
  },
  cornerOptionSelected: {
    borderColor: COLORS.PRIMARY,
    backgroundColor: COLORS.PRIMARY,
  },
  cornerOptionText: {
    fontSize: 14,
    color: COLORS.GRAY,
    fontWeight: '600',
  },
  cornerOptionTextSelected: {
    color: '#000000',
  },
  labelPreviewContainer: {
    marginTop: 16,
  },
  labelPreview: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: '#F9F9F9',
    borderRadius: 8,
  },
  previewLabelOption: {
    alignItems: 'center',
  },
  previewLabel: {
    alignItems: 'center',
    minWidth: 0,
  },
  previewLabelText: {
    fontWeight: 'bold',
  },
  marginSliderContainer: {
    marginTop: 16,
    marginBottom: 8,
  },
  marginSliderLabel: {
    fontSize: 14,
    color: COLORS.TEXT,
    marginBottom: 8,
  },
  sliderWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderDefaultMark: {
    position: 'absolute',
    left: '22.5%', // Corresponds to 10px, visually adjusted for track padding
    top: '50%',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    transform: [{ translateX: -12 }, { translateY: -12 }],
    zIndex: -1,
  },
  positionGridContainer: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 16,
  },
  gridHalf: {
    flex: 1,
    gap: 4,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 4,
  },
  gridCell: {
    flex: 1,
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E5E5E5',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#CCC',
  },
  gridCellSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  positionPreviewContainer: {
    marginVertical: 8,
    width: '100%',
  },
  positionPreviewBox: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: '#F5F5F5',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  previewHalfBefore: {
    flex: 1,
    backgroundColor: '#D0D0D0',
    position: 'relative',
  },
  previewHalfAfter: {
    flex: 1,
    backgroundColor: '#A0A0A0',
    position: 'relative',
  },
  previewLabelPosition: {
    position: 'absolute',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  colorModalContainer: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
  },
  colorModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  colorModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
  },
  hexInputLink: {
    fontSize: 14,
    color: COLORS.PRIMARY,
    fontWeight: '600',
  },
  colorPickerWrapper: {
    marginBottom: 16,
  },
  colorPanel: {
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  hueSlider: {
    height: 32,
    borderRadius: 8,
  },
  colorPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  colorPreviewBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
  },
  colorPreviewText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  colorModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  colorModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F5F5F5',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    textAlign: 'center',
  },
  applyButton: {
    backgroundColor: COLORS.PRIMARY,
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
    textAlign: 'center',
  },
  hexModalContainer: {
    width: '80%',
    maxWidth: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
  },
  hexModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 16,
  },
  hexInput: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.TEXT,
    marginBottom: 8,
  },
  hexModalError: {
    fontSize: 12,
    color: '#FF3B30',
    marginBottom: 16,
  },
  hexModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  hexModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  fontModalContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
  },
  fontModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  fontModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
  },
  fontModalClose: {
    fontSize: 24,
    color: COLORS.GRAY,
  },
  fontList: {
    flex: 1,
  },
  fontOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  fontOptionSelected: {
    backgroundColor: '#F9F9F9',
  },
  fontOptionLabel: {
    fontSize: 16,
    color: COLORS.TEXT,
  },
  fontOptionCheck: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    fontWeight: '700',
  },
  // Plan Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end'
  },
  modalContent: {
    width: '100%',
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 20
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.TEXT
  },
  modalCloseButton: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  modalCloseText: {
    fontSize: 24,
    color: COLORS.GRAY
  },
  modalScrollView: {
    paddingHorizontal: 20,
    paddingTop: 20
  },
  planContainer: {
    marginBottom: 20
  },
  planButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    alignItems: 'center'
  },
  planButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.PRIMARY
  },
  planButtonTextSelected: {
    color: '#000000'
  },
  planButtonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%'
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT
  },
  planSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10
  },
  watermarkCustomization: {
    marginTop: 8,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
  },
  watermarkField: {
    marginBottom: 12,
  },
  watermarkFieldLabel: {
    color: COLORS.TEXT,
    fontWeight: '600',
    marginBottom: 6,
  },
  watermarkInput: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.TEXT,
  },
  watermarkHelperText: {
    color: COLORS.GRAY,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  watermarkColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  watermarkColorInfo: {
    flex: 1,
  },
  watermarkColorValue: {
    color: COLORS.GRAY,
    fontSize: 12,
  },
  watermarkColorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    backgroundColor: 'white',
    gap: 8,
  },
  watermarkColorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  watermarkOpacityRow: {
    marginBottom: 16,
  },
  watermarkOpacityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  watermarkOpacityValue: {
    minWidth: 48,
    textAlign: 'right',
    color: COLORS.TEXT,
    fontWeight: '600',
  },
});

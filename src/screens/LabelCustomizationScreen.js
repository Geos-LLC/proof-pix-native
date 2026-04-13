import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Platform,
  Pressable,
  Dimensions,
  KeyboardAvoidingView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { useFeaturePermissions, FEATURES } from '../hooks/useFeaturePermissions';
import { getLabelPositions } from '../constants/rooms';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Color Palette
const COLORS = {
  PRIMARY: '#EAB308',
  TEXT: '#000000',
  GRAY: '#666666',
  BORDER: '#E5E5E5',
  BACKGROUND: '#F5F5F5',
};

// Font Options
const FONT_OPTIONS = [
  { key: 'system', label: 'Arial Blank' },
  { key: 'shadow', label: 'Shadow Into Light' },
  { key: 'shanatel', label: 'Shanatel Light' },
  { key: 'sf', label: 'SF Compact' },
  { key: 'share', label: 'Share Tech' },
];

// Size Options
const SIZE_OPTIONS = [
  { key: 'small', label: 'Before', fontSize: 10, padding: 6 },
  { key: 'medium', label: 'Before', fontSize: 14, padding: 10 },
  { key: 'large', label: 'Before', fontSize: 18, padding: 14 },
];

// Helper to convert HSL to Hex
const hslToHex = (hue, sat, light) => {
  const h = hue / 360;
  const s = sat / 100;
  const l = light / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 0.1667) {
    r = c; g = x; b = 0;
  } else if (h < 0.3333) {
    r = x; g = c; b = 0;
  } else if (h < 0.5) {
    r = 0; g = c; b = x;
  } else if (h < 0.6667) {
    r = 0; g = x; b = c;
  } else if (h < 0.8333) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');

  return '#' + rHex.toUpperCase() + gHex.toUpperCase() + bHex.toUpperCase();
};

// Generate color grid for color picker (now generates hex directly)
const generateColorGrid = () => {
  const colors = [];
  const hues = 12;
  const shades = 10;

  for (let s = 0; s < shades; s++) {
    const row = [];
    for (let h = 0; h < hues; h++) {
      const hue = (h * 30);
      const saturation = s === 0 ? 0 : 100;
      const lightness = s === 0 ? 100 - (h * 8) : 100 - (s * 10);
      row.push(hslToHex(hue, saturation, lightness));
    }
    colors.push(row);
  }
  return colors;
};

const COLOR_GRID = generateColorGrid();

// Saved colors for color picker
const SAVED_COLORS = [
  '#A855F7', '#000000', '#3B82F6', '#22C55E', '#EAB308', '#EF4444',
  '#06B6D4', '#A855F7', '#6366F1', '#F43F5E'
];

// Language options for label localization (independent from app language)
const LABEL_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];

export default function CustomizeLabelsScreen({ navigation }) {
  const { canUse } = useFeaturePermissions();
  const canCustomizeWatermark = canUse(FEATURES.CUSTOM_WATERMARKS);

  // Get settings from context (these are persisted to AsyncStorage)
  const {
    labelBackgroundColor,
    labelTextColor,
    labelCornerStyle,
    labelSize,
    labelFontFamily,
    beforeLabelPosition,
    afterLabelPosition,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelCornerStyle,
    updateLabelSize,
    updateLabelFontFamily,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    // Watermark settings
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkFontFamily,
    updateWatermarkText,
    updateWatermarkLink,
    updateWatermarkColor,
    updateWatermarkOpacity,
    updateWatermarkPosition,
    updateWatermarkFontFamily,
    // Label language (independent of app language)
    labelLanguage,
    updateLabelLanguage,
  } = useSettings();

  // Local state for UI only (modals, temp values)

  // Modal states
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState(null); // 'bg', 'text', 'watermark'
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  const [marginModalVisible, setMarginModalVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  // Watermark modal states
  const [watermarkOpacityModalVisible, setWatermarkOpacityModalVisible] = useState(false);
  const [watermarkFontModalVisible, setWatermarkFontModalVisible] = useState(false);
  const [watermarkPositionModalVisible, setWatermarkPositionModalVisible] = useState(false);
  const [watermarkOpacityPreview, setWatermarkOpacityPreview] = useState(watermarkOpacity || 0.5);

  // Color picker state
  const [tempColor, setTempColor] = useState('#EAB308');
  const [colorTab, setColorTab] = useState('Grid');
  const [colorOpacity, setColorOpacity] = useState(100);

  // Update preview when watermarkOpacity changes from outside
  useEffect(() => {
    if (typeof watermarkOpacity === 'number') {
      setWatermarkOpacityPreview(watermarkOpacity);
    }
  }, [watermarkOpacity]);

  const openColorModal = (type) => {
    setColorModalType(type);
    if (type === 'bg') {
      setTempColor(labelBackgroundColor);
    } else if (type === 'watermark') {
      setTempColor(watermarkColor || '#666666');
    } else {
      setTempColor(labelTextColor);
    }
    setColorModalVisible(true);
  };

  // Convert HSL/RGB to hex color (kept for backward compatibility)
  const convertToHex = (color) => {
    if (!color) return '#666666';

    // If already hex, return as is
    if (color.startsWith('#')) {
      return color;
    }

    // Handle HSL colors
    if (color.startsWith('hsl')) {
      const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const h = parseInt(match[1]) / 360;
        const s = parseInt(match[2]) / 100;
        const l = parseInt(match[3]) / 100;

        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;

        let r, g, b;

        if (h < 0.1667) {
          r = c; g = x; b = 0;
        } else if (h < 0.3333) {
          r = x; g = c; b = 0;
        } else if (h < 0.5) {
          r = 0; g = c; b = x;
        } else if (h < 0.6667) {
          r = 0; g = x; b = c;
        } else if (h < 0.8333) {
          r = x; g = 0; b = c;
        } else {
          r = c; g = 0; b = x;
        }

        r = Math.round((r + m) * 255);
        g = Math.round((g + m) * 255);
        b = Math.round((b + m) * 255);

        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      }
    }

    // Handle RGB colors
    if (color.startsWith('rgb')) {
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        const r = parseInt(match[1]);
        const g = parseInt(match[2]);
        const b = parseInt(match[3]);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      }
    }

    // Default fallback
    return color;
  };

  const applyColor = async () => {
    const hexColor = convertToHex(tempColor);
    if (colorModalType === 'bg') {
      await updateLabelBackgroundColor(hexColor);
    } else if (colorModalType === 'text') {
      await updateLabelTextColor(hexColor);
    } else if (colorModalType === 'watermark') {
      await updateWatermarkColor(hexColor);
    }
    setColorModalVisible(false);
  };

  const currentFont = FONT_OPTIONS.find(f => f.key === labelFontFamily)?.label || 'Arial Blank';
  const currentSize = SIZE_OPTIONS.find(s => s.key === labelSize);

  // Helper function to get position styles for preview with margin
  const getPositionStyle = (position, marginV, marginH) => {
    // Preview box is roughly square, so we'll use fixed positions
    const boxSize = SCREEN_WIDTH / 2 - 20; // Approximate box size
    const centerX = (boxSize - 60) / 2; // Approximate label width is 60
    const centerY = (boxSize - 30) / 2; // Approximate label height is 30
    
    const positions = {
      'left-top': { top: marginV || 8, left: marginH || 8 },
      'center-top': { top: marginV || 8, left: centerX },
      'right-top': { top: marginV || 8, right: marginH || 8 },
      'left-middle': { top: centerY, left: marginH || 8 },
      'center-middle': { top: centerY, left: centerX },
      'right-middle': { top: centerY, right: marginH || 8 },
      'left-bottom': { bottom: marginV || 8, left: marginH || 8 },
      'center-bottom': { bottom: marginV || 8, left: centerX },
      'right-bottom': { bottom: marginV || 8, right: marginH || 8 },
    };
    return positions[position] || positions['left-top'];
  };

  const beforePosStyle = getPositionStyle(beforeLabelPosition, labelMarginVertical, labelMarginHorizontal);
  const afterPosStyle = getPositionStyle(afterLabelPosition, labelMarginVertical, labelMarginHorizontal);

  // Get watermark position style using the same function as PhotoWatermark
  const watermarkPositions = getLabelPositions(labelMarginVertical ?? 10, labelMarginHorizontal ?? 10);
  const watermarkPosKey = watermarkPosition || 'right-bottom';
  const watermarkPosStyle = watermarkPositions[watermarkPosKey] || watermarkPositions['right-bottom'];
  const { name: watermarkPosName, horizontalAlign, verticalAlign, ...watermarkPositionCoords } = watermarkPosStyle;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backButton}>
          <View style={styles.backButtonCircle}>
            <Ionicons name="arrow-back" size={20} color={COLORS.TEXT} />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customize Labels</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        {/* Preview Section - Combined Before/After with Labels and Watermark */}
        <View style={styles.previewSection}>
          <View style={styles.previewCombinedContainer}>
            {/* Before section */}
            <View style={styles.previewCombinedHalf}>
              <Ionicons name="image-outline" size={48} color="#999" />
              {/* Before Label */}
              <View style={[
                styles.previewLabel,
                {
                  backgroundColor: labelBackgroundColor,
                  borderRadius: labelCornerStyle === 'rounded' ? 20 : 4,
                  padding: currentSize?.padding || 10,
                  position: 'absolute',
                  ...beforePosStyle,
                }
              ]}>
                <Text style={[
                  styles.previewLabelText,
                  { color: labelTextColor, fontSize: currentSize?.fontSize || 14 }
                ]}>Before</Text>
              </View>
            </View>
            {/* After section */}
            <View style={[styles.previewCombinedHalf, styles.previewCombinedHalfAfter]}>
              <Ionicons name="image-outline" size={48} color="#999" />
              {/* After Label */}
              <View style={[
                styles.previewLabel,
                {
                  backgroundColor: labelBackgroundColor,
                  borderRadius: labelCornerStyle === 'rounded' ? 20 : 4,
                  padding: currentSize?.padding || 10,
                  position: 'absolute',
                  ...afterPosStyle,
                }
              ]}>
                <Text style={[
                  styles.previewLabelText,
                  { color: labelTextColor, fontSize: currentSize?.fontSize || 14 }
                ]}>After</Text>
              </View>
            </View>
            {/* Single Watermark - appears once on the entire combined image */}
            <Text style={[
              styles.previewWatermark,
              {
                color: watermarkColor || '#666666',
                opacity: watermarkOpacity || 0.5,
                ...watermarkPositionCoords,
              }
            ]}>
              {watermarkText || 'Created with Proofpix.app'}
            </Text>
          </View>
        </View>

        {/* Label Section */}
        <Text style={styles.sectionTitle}>Label</Text>
        
        {/* Control Buttons Row 1 */}
        <View style={styles.controlsRow}>
          <ControlButton
            icon="ellipse-outline"
            label="Style"
            selected={labelCornerStyle === 'rounded'}
            onPress={async () => {
              const newStyle = labelCornerStyle === 'rounded' ? 'square' : 'rounded';
              await updateLabelCornerStyle(newStyle);
            }}
          />
          <ControlButton
            icon="text"
            label="Font"
            onPress={() => setFontModalVisible(true)}
          />
          <ControlButton
            icon="resize"
            label="Size"
            onPress={() => setSizeModalVisible(true)}
          />
          <ColorControlButton
            color={labelBackgroundColor}
            label="BG Color"
            selected={true}
            onPress={() => openColorModal('bg')}
          />
          <ColorControlButton
            color={labelTextColor}
            label="Text Color"
            onPress={() => openColorModal('text')}
          />
        </View>

        {/* Control Buttons Row 2 */}
        <View style={styles.controlsRow}>
          <ControlButton
            icon="move"
            label="Position"
            onPress={() => setPositionModalVisible(true)}
          />
          <ControlButton
            icon="resize-outline"
            label="Margin"
            onPress={() => setMarginModalVisible(true)}
          />
          <ControlButton
            icon="language"
            label="Language"
            onPress={() => setLanguageModalVisible(true)}
          />
        </View>

        {/* Watermark Section */}
        <Text style={styles.sectionTitle}>Watermark</Text>

        {!canCustomizeWatermark ? (
          <TouchableOpacity
            style={styles.lockedSection}
            onPress={() => navigation.navigate('Settings')}
            activeOpacity={0.7}
          >
            <Ionicons name="lock-closed" size={24} color={COLORS.PRIMARY} />
            <Text style={styles.lockedTitle}>Pro Feature</Text>
            <Text style={styles.lockedMessage}>
              Upgrade to Pro to customize your watermark text, color, font, and position.
            </Text>
            <View style={styles.lockedButton}>
              <Text style={styles.lockedButtonText}>View Plans</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={watermarkText}
              onChangeText={updateWatermarkText}
              placeholder="Watermark Text"
              placeholderTextColor={COLORS.GRAY}
            />

            <TextInput
              style={styles.input}
              value={watermarkLink}
              onChangeText={updateWatermarkLink}
              placeholder="Watermark Link"
              placeholderTextColor={COLORS.GRAY}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            {/* Watermark Controls */}
            <View style={styles.controlsRow}>
              <ControlButton
                icon="contrast-outline"
                label="Opacity"
                onPress={() => setWatermarkOpacityModalVisible(true)}
              />
              <ControlButton
                icon="text"
                label="Font"
                onPress={() => setWatermarkFontModalVisible(true)}
              />
              <ColorControlButton
                color={watermarkColor || '#666666'}
                label="Color"
                onPress={() => {
                  setColorModalType('watermark');
                  setTempColor(watermarkColor || '#666666');
                  setColorModalVisible(true);
                }}
              />
              <ControlButton
                icon="move"
                label="Position"
                onPress={() => setWatermarkPositionModalVisible(true)}
              />
            </View>
          </>
        )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Font Modal */}
      <BottomModal
        visible={fontModalVisible}
        onClose={() => setFontModalVisible(false)}
        title="Label Font"
      >
        <View style={styles.fontListContainer}>
          {FONT_OPTIONS.map((font) => {
            const isSelected = labelFontFamily === font.key;
            return (
              <TouchableOpacity
                key={font.key}
                style={[
                  styles.fontListItem,
                  isSelected && styles.fontListItemSelected
                ]}
                onPress={async () => {
                  await updateLabelFontFamily(font.key);
                  setFontModalVisible(false);
                }}
              >
                <Text style={[
                  styles.fontListItemText,
                  isSelected && styles.fontListItemTextSelected
                ]}>{font.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomModal>

      {/* Label Language Modal */}
      <BottomModal
        visible={languageModalVisible}
        onClose={() => setLanguageModalVisible(false)}
        title="Label Language"
      >
        <View style={styles.fontListContainer}>
          {LABEL_LANGUAGES.map((lang) => {
            const isSelected = labelLanguage === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.fontListItem,
                  isSelected && styles.fontListItemSelected
                ]}
                onPress={async () => {
                  await updateLabelLanguage(lang.code);
                  setLanguageModalVisible(false);
                }}
              >
                <Text style={[
                  styles.fontListItemText,
                  isSelected && styles.fontListItemTextSelected
                ]}>{lang.flag}  {lang.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomModal>

      {/* Color Picker Modal */}
      <BottomModal
        visible={colorModalVisible}
        onClose={() => setColorModalVisible(false)}
        title={
          colorModalType === 'bg'
            ? 'Background Color'
            : colorModalType === 'watermark'
            ? 'Watermark Color'
            : 'Text Color'
        }
        headerExtra={
          <TouchableOpacity style={styles.eyedropperButton}>
            <Ionicons name="eyedrop-outline" size={20} color={COLORS.GRAY} />
          </TouchableOpacity>
        }
      >
        <View style={styles.colorPickerContainer}>
          {/* Tabs */}
          <View style={styles.colorTabs}>
            {['Grid', 'Spectrum', 'Sliders'].map(tab => (
                      <TouchableOpacity
                key={tab}
                        style={[
                  styles.colorTab,
                  colorTab === tab && styles.colorTabActive
                ]}
                onPress={() => setColorTab(tab)}
              >
                <Text style={[
                  styles.colorTabText,
                  colorTab === tab && styles.colorTabTextActive
                ]}>{tab}</Text>
                      </TouchableOpacity>
            ))}
            </View>

          {/* Color Grid */}
          {colorTab === 'Grid' && (
            <View style={styles.colorGrid}>
              {COLOR_GRID.map((row, rowIdx) => (
                <View key={rowIdx} style={styles.colorGridRow}>
                  {row.map((color, colIdx) => (
              <TouchableOpacity
                      key={`${rowIdx}-${colIdx}`}
                  style={[
                        styles.colorCell,
                        { backgroundColor: color },
                        tempColor === color && styles.colorCellSelected
                      ]}
                      onPress={() => setTempColor(color)}
                    />
                  ))}
                </View>
              ))}
              </View>
          )}

          {/* Opacity Slider */}
          <View style={styles.opacitySection}>
            <Text style={styles.opacityLabel}>Opacity</Text>
            <View style={styles.opacitySliderContainer}>
              <View style={[
                styles.opacitySliderTrack,
                { background: `linear-gradient(to right, transparent, ${tempColor})` }
              ]}>
                <View style={styles.opacityCheckered} />
                </View>
              <Text style={styles.opacityValue}>{colorOpacity}%</Text>
            </View>
          </View>

          {/* Color Preview & Saved Colors */}
          <View style={styles.colorPreviewSection}>
            <View style={[
              styles.colorPreviewLarge,
              { backgroundColor: tempColor }
            ]} />
            {SAVED_COLORS.map((color, idx) => (
                  <TouchableOpacity
                key={idx}
                    style={[
                  styles.colorPreviewSmall,
                  { backgroundColor: color },
                  tempColor === color && styles.colorPreviewSelected
                ]}
                onPress={() => setTempColor(color)}
                  />
                ))}
            <TouchableOpacity style={styles.addColorButton}>
              <Text style={styles.addColorText}>+</Text>
            </TouchableOpacity>
              </View>

          {/* Apply Button */}
          <TouchableOpacity style={styles.applyButton} onPress={applyColor}>
            <Text style={styles.applyButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </BottomModal>

      {/* Position Modal */}
      <BottomModal
        visible={positionModalVisible}
        onClose={() => setPositionModalVisible(false)}
        title="Label Position"
      >
        <View style={styles.positionContainer}>
          {/* Label Position - Before/After Grids */}
          <View style={styles.positionGrid}>
            {/* Before Grid */}
            <View style={styles.positionHalf}>
              {[
                ['left-top', 'center-top', 'right-top'],
                ['left-middle', 'center-middle', 'right-middle'],
                ['left-bottom', 'center-bottom', 'right-bottom']
              ].map((row, rowIdx) => (
                <View key={rowIdx} style={styles.positionRow}>
                  {row.map(pos => (
                    <TouchableOpacity
                      key={pos}
                      style={[
                        styles.positionCell,
                        beforeLabelPosition === pos && styles.positionCellSelected
                      ]}
                      onPress={async () => await updateBeforeLabelPosition(pos)}
                    />
                  ))}
                </View>
              ))}
            </View>

            {/* Divider */}
            <View style={styles.positionDivider} />

            {/* After Grid */}
              <View style={styles.positionHalf}>
                {[
                  ['left-top', 'center-top', 'right-top'],
                  ['left-middle', 'center-middle', 'right-middle'],
                  ['left-bottom', 'center-bottom', 'right-bottom']
                ].map((row, rowIdx) => (
                  <View key={rowIdx} style={styles.positionRow}>
                    {row.map(pos => (
                      <TouchableOpacity
                        key={pos}
                        style={[
                          styles.positionCell,
                          afterLabelPosition === pos && styles.positionCellSelected
                        ]}
                        onPress={async () => await updateAfterLabelPosition(pos)}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </View>
        </View>
      </BottomModal>

      {/* Size Modal */}
      <BottomModal
        visible={sizeModalVisible}
        onClose={() => setSizeModalVisible(false)}
        title="Label Size"
      >
        <View style={styles.sizeContainer}>
          {SIZE_OPTIONS.map((size) => (
                  <TouchableOpacity
              key={size.key}
                    style={[
                styles.sizeButton,
                {
                  padding: size.padding,
                  borderRadius: labelCornerStyle === 'rounded' ? 20 : 4,
                },
                labelSize === size.key && styles.sizeButtonSelected
              ]}
              onPress={async () => {
                await updateLabelSize(size.key);
                setSizeModalVisible(false);
              }}
            >
              <Text style={[
                styles.sizeButtonText,
                { fontSize: size.fontSize },
                labelSize === size.key && styles.sizeButtonTextSelected
              ]}>{size.label}</Text>
            </TouchableOpacity>
                ))}
              </View>
      </BottomModal>

      {/* Margin Modal */}
      <BottomModal
        visible={marginModalVisible}
        onClose={() => setMarginModalVisible(false)}
        title="Label Margin"
      >
        <View style={styles.marginContainer}>
          <View style={styles.marginSection}>
            <Text style={styles.marginLabel}>
              Vertical (Top/Bottom) : {labelMarginVertical}px
            </Text>
            <SliderInput
              value={labelMarginVertical}
              onValueChange={updateLabelMarginVertical}
              min={0}
              max={50}
              step={1}
              showValue={false}
              trackColor="#22C55E"
            />
          </View>

          <View style={styles.marginSection}>
            <Text style={styles.marginLabel}>
              Horizontal (Left/Right) : {labelMarginHorizontal}px
            </Text>
            <SliderInput
              value={labelMarginHorizontal}
              onValueChange={updateLabelMarginHorizontal}
              min={0}
              max={50}
              step={1}
              showValue={false}
              trackColor="#22C55E"
            />
          </View>
        </View>
      </BottomModal>

      {/* Watermark Opacity Modal */}
      <BottomModal
        visible={watermarkOpacityModalVisible}
        onClose={() => {
          // Reset preview to saved value when closing
          setWatermarkOpacityPreview(watermarkOpacity || 0.5);
          setWatermarkOpacityModalVisible(false);
        }}
        title="Opacity"
      >
        <View style={styles.marginContainer}>
          <View style={styles.marginSection}>
            <View style={styles.opacityLabelContainer}>
              <Text style={styles.marginLabel}>
                Watermark Opacity :
              </Text>
              <Text style={styles.opacityValueText}>
                {Math.round(watermarkOpacityPreview * 100)}%
              </Text>
            </View>
            <SliderInput
              value={watermarkOpacityPreview}
              onValueChange={setWatermarkOpacityPreview}
              onSlidingComplete={async (value) => {
                await updateWatermarkOpacity(value);
              }}
              min={0}
              max={1}
              step={0.01}
              showValue={false}
              trackColor="#22C55E"
            />
          </View>
        </View>
      </BottomModal>

      {/* Watermark Font Modal */}
      <BottomModal
        visible={watermarkFontModalVisible}
        onClose={() => setWatermarkFontModalVisible(false)}
        title="Watermark Font"
      >
        <View style={styles.fontListContainer}>
          {FONT_OPTIONS.map((font) => {
            const isSelected = watermarkFontFamily === font.key;
            return (
              <TouchableOpacity
                key={font.key}
                style={[
                  styles.fontListItem,
                  isSelected && styles.fontListItemSelected
                ]}
                onPress={async () => {
                  await updateWatermarkFontFamily(font.key);
                  setWatermarkFontModalVisible(false);
                }}
              >
                <Text style={[
                  styles.fontListItemText,
                  isSelected && styles.fontListItemTextSelected
                ]}>{font.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomModal>

      {/* Watermark Position Modal */}
      <BottomModal
        visible={watermarkPositionModalVisible}
        onClose={() => setWatermarkPositionModalVisible(false)}
        title="Watermark Position"
      >
        <View style={styles.positionContainer}>
          <View style={styles.positionFull}>
            {[
              ['left-top', 'center-top', 'right-top'],
              ['left-middle', 'center-middle', 'right-middle'],
              ['left-bottom', 'center-bottom', 'right-bottom']
            ].map((row, rowIdx) => (
              <View key={rowIdx} style={styles.positionRow}>
                {row.map(pos => (
                  <TouchableOpacity
                    key={pos}
                    style={[
                      styles.positionCell,
                      watermarkPosition === pos && styles.positionCellSelected
                    ]}
                    onPress={async () => {
                      await updateWatermarkPosition(pos);
                      setWatermarkPositionModalVisible(false);
                    }}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </BottomModal>

    </SafeAreaView>
  );
}

// Control Button Component - Updated to use rounded squares like Figma
function ControlButton({ icon, label, selected, onPress }) {
  return (
    <TouchableOpacity 
      style={styles.controlButton} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[
        styles.controlSquare,
        selected && styles.controlSquareSelected
      ]}>
        <Ionicons name={icon} size={22} color={selected ? '#000' : '#666'} />
      </View>
      <Text style={[
        styles.controlLabel,
        selected && styles.controlLabelSelected
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Color Control Button Component - Updated to use rounded squares
function ColorControlButton({ color, label, selected, onPress }) {
  return (
    <TouchableOpacity style={styles.controlButton} onPress={onPress}>
      <View style={[
        styles.controlSquare,
        selected && styles.controlSquareSelected
      ]}>
        <View style={[
          styles.colorCircle,
          { backgroundColor: color }
        ]} />
      </View>
      <Text style={[
        styles.controlLabel,
        selected && styles.controlLabelSelected
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Bottom Modal Component - Updated to match standard design
function BottomModal({ visible, onClose, title, headerExtra, children, buttonText, onButtonPress, showButton = false }) {
  if (!visible) return null;
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          {/* Drag Handle */}
          <View style={styles.modalHandle} />

          {/* Header */}
          <View style={styles.modalHeader}>
            {/* Close Button - Top Left */}
            <TouchableOpacity onPress={onClose} style={styles.modalClose}>
              <View style={styles.closeButtonCircle}>
                <Ionicons name="close" size={20} color="#666666" />
              </View>
            </TouchableOpacity>

            {/* Title - Centered */}
            <Text style={styles.modalTitle}>{title}</Text>

            {/* Header Extra (if provided) or Spacer */}
            {headerExtra ? (
              <View style={styles.modalHeaderExtra}>{headerExtra}</View>
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </View>

          {/* Content - Render children directly without ScrollView wrapper */}
          <View style={styles.modalBody} onStartShouldSetResponder={() => true}>
            {children}
          </View>

          {/* Action Button */}
          {showButton && buttonText && (
            <TouchableOpacity
              style={styles.modalActionButton}
              onPress={onButtonPress || onClose}
            >
              <Text style={styles.modalActionButtonText}>{buttonText}</Text>
            </TouchableOpacity>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

// Slider Input Component
function SliderInput({ value, onValueChange, onSlidingComplete, min = 0, max = 100, step = 1, showValue = true, trackColor = COLORS.PRIMARY }) {
  const displayValue = step < 1
    ? Math.round(value * 100) / 100
    : Math.round(value);

  return (
    <View style={styles.sliderContainer}>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        minimumTrackTintColor={trackColor}
        maximumTrackTintColor={COLORS.BORDER}
        thumbTintColor={trackColor}
      />
      {showValue && (
        <Text style={styles.sliderValue}>
          {step < 1 ? `${Math.round(value * 100)}%` : `${displayValue}px`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
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
  backButtonCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.TEXT,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: COLORS.BACKGROUND,
  },
  previewSection: {
    marginBottom: 24,
  },
  previewLabel: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  previewLabelText: {
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 16,
    marginTop: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  controlButton: {
    alignItems: 'center',
    minWidth: 70,
  },
  controlSquare: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: 'white',
    borderWidth: 1.5,
    borderColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  controlSquareSelected: {
    borderColor: '#000',
    borderWidth: 2,
  },
  controlCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  controlCircleSelected: {
    borderColor: '#000',
  },
  colorCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  controlLabel: {
    fontSize: 11,
    color: COLORS.GRAY,
    textAlign: 'center',
  },
  controlLabelSelected: {
    color: '#000',
    fontWeight: '600',
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    color: COLORS.GRAY,
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.TEXT,
  },
  previewCombinedContainer: {
    width: '100%',
    aspectRatio: 1.2, // Taller combined preview (was 2, now 1.2 for more height)
    position: 'relative',
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  previewCombinedHalf: {
    flex: 1,
    backgroundColor: '#D1D1D1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCombinedHalfAfter: {
    backgroundColor: '#A0A0A0',
  },
  previewWatermark: {
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    position: 'absolute',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: 20,
  },
  modalHandle: {
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
  modalClose: {
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
  modalHeaderExtra: {
    position: 'absolute',
    right: 20,
    top: 0,
    zIndex: 1,
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
  modalBody: {
    paddingBottom: 10,
  },
  modalList: {
    flex: 1,
    maxHeight: 500,
  },
  modalListContent: {
    paddingHorizontal: 20,
  },
  fontListContainer: {
    paddingHorizontal: 20,
  },
  modalActionButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  listItemSelected: {
    backgroundColor: '#F9F9F9',
  },
  listItemText: {
    fontSize: 16,
    color: COLORS.TEXT,
  },
  checkmark: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    fontWeight: '700',
  },
  fontListItem: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
    borderRadius: 25,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
  },
  fontListItemSelected: {
    backgroundColor: COLORS.PRIMARY,
  },
  fontListItemText: {
    fontSize: 16,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  fontListItemTextSelected: {
    color: '#000',
    fontWeight: '600',
  },
  colorPickerContainer: {
    padding: 16,
  },
  eyedropperButton: {
    padding: 8,
  },
  colorTabs: {
    flexDirection: 'row',
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  colorTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  colorTabActive: {
    backgroundColor: 'white',
  },
  colorTabText: {
    fontSize: 14,
    color: COLORS.GRAY,
  },
  colorTabTextActive: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  colorGrid: {
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  colorGridRow: {
    flexDirection: 'row',
  },
  colorCell: {
    flex: 1,
    aspectRatio: 1,
  },
  colorCellSelected: {
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 5,
  },
  opacitySection: {
    marginBottom: 16,
  },
  opacityLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  opacitySliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  opacitySliderTrack: {
    flex: 1,
    height: 32,
    borderRadius: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  opacityCheckered: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundImage: `repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%)`,
    backgroundSize: '16px 16px',
  },
  opacityValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
  },
  colorPreviewSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  colorPreviewLarge: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  colorPreviewSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
  },
  colorPreviewSelected: {
    borderWidth: 2,
    borderColor: '#A855F7',
  },
  addColorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.BACKGROUND,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addColorText: {
    fontSize: 20,
    color: COLORS.GRAY,
  },
  applyButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  positionContainer: {
    padding: 24,
    minHeight: 200,
  },
  positionGrid: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  positionHalf: {
    flex: 1,
    minWidth: 0,
  },
  positionFull: {
    width: '100%',
  },
  positionRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  positionCell: {
    flex: 1,
    maxWidth: 60,
    aspectRatio: 1,
    minHeight: 50,
    backgroundColor: COLORS.BORDER,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    marginHorizontal: 2,
  },
  positionCellSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: '#000',
    borderWidth: 2,
  },
  positionDivider: {
    width: 2,
    backgroundColor: COLORS.BORDER,
  },
  sizeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  sizeButton: {
    backgroundColor: COLORS.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
  },
  sizeButtonText: {
    fontWeight: '600',
    color: '#666',
  },
  sizeButtonTextSelected: {
    color: '#000',
  },
  marginContainer: {
    padding: 24,
  },
  marginSection: {
    marginBottom: 24,
  },
  marginLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  opacityLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  opacityValueText: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderValue: {
    minWidth: 60,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  opacityContainer: {
    padding: 24,
  },
  opacityModalLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  lockedSection: {
    backgroundColor: '#F9F9F9',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderStyle: 'dashed',
  },
  lockedTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginTop: 12,
    marginBottom: 8,
  },
  lockedMessage: {
    fontSize: 14,
    color: COLORS.GRAY,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  lockedButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  lockedButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
  },
});
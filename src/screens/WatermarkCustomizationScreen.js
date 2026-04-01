import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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

export default function WatermarkCustomizationScreen({ navigation }) {
  const { canUse } = useFeaturePermissions();

  // Guard: bounce Starter users back
  useEffect(() => {
    if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
      navigation.goBack();
    }
  }, [canUse, navigation]);

  // Get settings from context
  const {
    watermarkOpacity,
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkPosition,
    watermarkFontFamily,
    labelMarginVertical,
    labelMarginHorizontal,
    labelBackgroundColor,
    labelTextColor,
    labelCornerStyle,
    labelSize,
    labelFontFamily,
    beforeLabelPosition,
    afterLabelPosition,
    updateWatermarkOpacity,
    updateWatermarkText,
    updateWatermarkLink,
    updateWatermarkColor,
    updateWatermarkPosition,
    updateWatermarkFontFamily,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelCornerStyle,
    updateLabelSize,
    updateLabelFontFamily,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
  } = useSettings();

  // Modal states - Watermark
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState('watermark'); // 'watermark', 'labelBg', 'labelText'
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [opacityModalVisible, setOpacityModalVisible] = useState(false);
  const [watermarkOpacityPreview, setWatermarkOpacityPreview] = useState(watermarkOpacity || 0.5);

  // Modal states - Label
  const [labelFontModalVisible, setLabelFontModalVisible] = useState(false);
  const [labelPositionModalVisible, setLabelPositionModalVisible] = useState(false);
  const [labelSizeModalVisible, setLabelSizeModalVisible] = useState(false);
  const [labelMarginModalVisible, setLabelMarginModalVisible] = useState(false);

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

  const watermarkTextRef = useRef(null);
  const watermarkLinkRef = useRef(null);

  const openColorModal = useCallback((type = 'watermark') => {
    setColorModalType(type);
    if (type === 'labelBg') {
      setTempColor(labelBackgroundColor || '#EAB308');
    } else if (type === 'labelText') {
      setTempColor(labelTextColor || '#000000');
    } else {
      setTempColor(watermarkColor || '#666666');
    }
    setColorModalVisible(true);
  }, [watermarkColor, labelBackgroundColor, labelTextColor]);

  // Convert HSL/RGB to hex color
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

  const applyColor = useCallback(async () => {
    const hexColor = convertToHex(tempColor);
    if (colorModalType === 'labelBg') {
      await updateLabelBackgroundColor(hexColor);
    } else if (colorModalType === 'labelText') {
      await updateLabelTextColor(hexColor);
    } else {
      await updateWatermarkColor(hexColor);
    }
    setColorModalVisible(false);
  }, [tempColor, colorModalType, updateWatermarkColor, updateLabelBackgroundColor, updateLabelTextColor]);

  // Helper function to get position styles for preview with margin
  const getPositionStyle = (position, marginV, marginH) => {
    const boxSize = SCREEN_WIDTH / 2 - 20;
    const centerX = (boxSize - 60) / 2;
    const centerY = (boxSize - 30) / 2;
    
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
  const marginV = labelMarginVertical ?? 10;
  const marginH = labelMarginHorizontal ?? 10;
  const watermarkPositions = getLabelPositions(marginV, marginH);
  const watermarkPosKey = watermarkPosition || 'right-bottom';
  const watermarkPosStyle = watermarkPositions[watermarkPosKey] || watermarkPositions['right-bottom'];
  const { name: watermarkPosName, horizontalAlign, verticalAlign, ...watermarkPositionCoords } = watermarkPosStyle;

  const currentSize = SIZE_OPTIONS.find(s => s.key === labelSize);

  // Control Button Component
  const ControlButton = ({ icon, label, selected, onPress }) => (
    <TouchableOpacity style={styles.controlButton} onPress={onPress}>
      <View style={[styles.controlCircle, selected && styles.controlCircleSelected]}>
        <Ionicons name={icon} size={24} color={selected ? '#000' : COLORS.GRAY} />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );

  // Color Control Button Component
  const ColorControlButton = ({ color, label, selected, onPress }) => (
    <TouchableOpacity style={styles.controlButton} onPress={onPress}>
      <View style={[styles.controlCircle, selected && styles.controlCircleSelected]}>
        <View style={[styles.colorSwatch, { backgroundColor: color }]} />
      </View>
      <Text style={styles.controlLabel}>{label}</Text>
    </TouchableOpacity>
  );

  // Bottom Modal Component
  function BottomModal({ visible, onClose, title, headerExtra, children, buttonText, onButtonPress, showButton = false }) {
    if (!visible) return null;
    
    return (
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
      >
        <Pressable style={styles.modalOverlay} onPress={onClose}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHandle} />
            
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={onClose} style={styles.modalClose}>
                <View style={styles.closeButtonCircle}>
                  <Ionicons name="close" size={20} color="#666666" />
                </View>
              </TouchableOpacity>
              
              <Text style={styles.modalTitle}>{title}</Text>
              
              {headerExtra ? (
                <View style={styles.modalHeaderExtra}>{headerExtra}</View>
              ) : (
                <View style={styles.headerSpacer} />
              )}
            </View>
            
            <ScrollView 
              style={styles.modalList} 
              contentContainerStyle={styles.modalListContent}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            
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
  function SliderInput({ value, onValueChange, onSlidingComplete, min = 0, max = 100, step = 1, showValue = true }) {
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
          minimumTrackTintColor={COLORS.PRIMARY}
          maximumTrackTintColor={COLORS.BORDER}
          thumbTintColor={COLORS.PRIMARY}
        />
        {showValue && (
          <Text style={styles.sliderValue}>
            {Math.round(value * 100)}%
          </Text>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Customize Watermark</Text>
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
                styles.watermark,
                { 
                  opacity: watermarkOpacity || 0.5,
                  color: watermarkColor || '#666666',
                  ...watermarkPositionCoords,
                }
              ]}>{watermarkText || 'Created with Proofpix.app'}</Text>
            </View>
          </View>

          {/* Watermark Section */}
          <Text style={styles.sectionTitle}>Watermark</Text>
          
          <TextInput
            ref={watermarkTextRef}
            style={styles.input}
            value={watermarkText}
            onChangeText={updateWatermarkText}
            placeholder="Watermark Text"
            placeholderTextColor={COLORS.GRAY}
          />

          <TextInput
            ref={watermarkLinkRef}
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
              onPress={() => setOpacityModalVisible(true)}
            />
            <ControlButton
              icon="text"
              label="Font"
              onPress={() => setFontModalVisible(true)}
            />
            <ColorControlButton
              color={watermarkColor}
              label="Text Color"
              selected={true}
              onPress={() => openColorModal('watermark')}
            />
            <ControlButton
              icon="move"
              label="Position"
              onPress={() => {
                console.log('Watermark Position button pressed');
                setPositionModalVisible(true);
              }}
            />
          </View>

          {/* Label Section */}
          <Text style={styles.sectionTitle}>Label</Text>

          {/* Label Controls Row 1 */}
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
              onPress={() => setLabelFontModalVisible(true)}
            />
            <ControlButton
              icon="resize"
              label="Size"
              onPress={() => setLabelSizeModalVisible(true)}
            />
            <ColorControlButton
              color={labelBackgroundColor}
              label="BG Color"
              onPress={() => openColorModal('labelBg')}
            />
            <ColorControlButton
              color={labelTextColor}
              label="Text Color"
              onPress={() => openColorModal('labelText')}
            />
          </View>

          {/* Label Controls Row 2 */}
          <View style={styles.controlsRow}>
            <ControlButton
              icon="move"
              label="Position"
              onPress={() => setLabelPositionModalVisible(true)}
            />
            <ControlButton
              icon="resize-outline"
              label="Margin"
              onPress={() => setLabelMarginModalVisible(true)}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Font Modal */}
      <BottomModal
        visible={fontModalVisible}
        onClose={() => setFontModalVisible(false)}
        title="Watermark Font"
      >
        {FONT_OPTIONS.map((font) => {
          const isSelected = watermarkFontFamily === font.key;
          return (
            <TouchableOpacity
              key={font.key}
              style={[
                styles.listItem,
                isSelected && styles.listItemSelected
              ]}
              onPress={async () => {
                await updateWatermarkFontFamily(font.key);
                setFontModalVisible(false);
              }}
            >
              <Text style={styles.listItemText}>{font.label}</Text>
              {isSelected && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </BottomModal>

      {/* Color Picker Modal */}
      <BottomModal
        visible={colorModalVisible}
        onClose={() => setColorModalVisible(false)}
        title="Watermark Text Color"
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

          {/* Saved Colors */}
          <View style={styles.savedColorsContainer}>
            <Text style={styles.savedColorsLabel}>Saved</Text>
            <View style={styles.savedColorsRow}>
              {SAVED_COLORS.map((color, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.savedColorCell,
                    { backgroundColor: color },
                    tempColor === color && styles.savedColorCellSelected
                  ]}
                  onPress={() => setTempColor(color)}
                />
              ))}
            </View>
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
        title="Watermark Position"
      >
        <View style={styles.positionContainer}>
          <View style={styles.positionGrid}>
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
                        setPositionModalVisible(false);
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </View>
      </BottomModal>

      {/* Opacity Modal */}
      <BottomModal
        visible={opacityModalVisible}
        onClose={() => {
          // Reset preview to saved value when closing
          setWatermarkOpacityPreview(watermarkOpacity || 0.5);
          setOpacityModalVisible(false);
        }}
        title="Watermark Opacity"
      >
        <View style={styles.opacityContainer}>
          <View style={styles.opacityLabelContainer}>
            <Text style={styles.opacityModalLabel}>
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
          />
        </View>
      </BottomModal>

      {/* Label Font Modal */}
      <BottomModal
        visible={labelFontModalVisible}
        onClose={() => setLabelFontModalVisible(false)}
        title="Label Font"
      >
        {FONT_OPTIONS.map((font) => {
          const isSelected = labelFontFamily === font.key;
          return (
            <TouchableOpacity
              key={font.key}
              style={[
                styles.listItem,
                isSelected && styles.listItemSelected
              ]}
              onPress={async () => {
                await updateLabelFontFamily(font.key);
                setLabelFontModalVisible(false);
              }}
            >
              <Text style={styles.listItemText}>{font.label}</Text>
              {isSelected && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </BottomModal>

      {/* Label Size Modal */}
      <BottomModal
        visible={labelSizeModalVisible}
        onClose={() => setLabelSizeModalVisible(false)}
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
                setLabelSizeModalVisible(false);
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

      {/* Label Position Modal */}
      <BottomModal
        visible={labelPositionModalVisible}
        onClose={() => setLabelPositionModalVisible(false)}
        title="Label Position"
      >
        <View style={styles.positionContainer}>
          <View style={styles.positionGrid}>
            {/* Before Grid */}
            <View style={styles.positionHalf}>
              <Text style={styles.positionLabel}>Before</Text>
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
                        styles.positionCellSmall,
                        beforeLabelPosition === pos && styles.positionCellSelected
                      ]}
                      onPress={async () => await updateBeforeLabelPosition(pos)}
                    />
                  ))}
                </View>
              ))}
            </View>

            {/* After Grid */}
            <View style={styles.positionHalf}>
              <Text style={styles.positionLabel}>After</Text>
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
                        styles.positionCellSmall,
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

      {/* Label Margin Modal */}
      <BottomModal
        visible={labelMarginModalVisible}
        onClose={() => setLabelMarginModalVisible(false)}
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
            />
          </View>
        </View>
      </BottomModal>
    </SafeAreaView>
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
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
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
  watermark: {
    position: 'absolute',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#666',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.TEXT,
    marginBottom: 16,
    marginTop: 8,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.TEXT,
    marginBottom: 16,
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
  controlLabel: {
    fontSize: 12,
    color: COLORS.TEXT,
    fontWeight: '500',
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '95%',
    width: '100%',
    flexDirection: 'column',
    minHeight: 650,
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
  modalHeaderExtra: {
    width: 32,
    alignItems: 'flex-end',
  },
  modalList: {
    flex: 1,
    minHeight: 550,
    maxHeight: 750,
  },
  modalListContent: {
    paddingBottom: 30,
    paddingTop: 10,
    flexGrow: 1,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  listItemSelected: {
    backgroundColor: '#F5F5F5',
  },
  listItemText: {
    fontSize: 16,
    color: COLORS.TEXT,
  },
  checkmark: {
    fontSize: 18,
    color: COLORS.PRIMARY,
    fontWeight: 'bold',
  },
  // Color Picker Styles
  colorPickerContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
    width: '100%',
    minHeight: 650,
  },
  colorTabs: {
    flexDirection: 'row',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER,
  },
  colorTab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  colorTabActive: {
    borderBottomColor: COLORS.PRIMARY,
  },
  colorTabText: {
    fontSize: 14,
    color: COLORS.GRAY,
    fontWeight: '500',
  },
  colorTabTextActive: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  colorGrid: {
    marginBottom: 20,
  },
  colorGridRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  colorCell: {
    flex: 1,
    aspectRatio: 1,
    margin: 1,
    borderRadius: 4,
  },
  colorCellSelected: {
    borderWidth: 3,
    borderColor: '#000',
  },
  savedColorsContainer: {
    marginBottom: 20,
  },
  savedColorsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    marginBottom: 12,
  },
  savedColorsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  savedColorCell: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
  },
  savedColorCellSelected: {
    borderColor: '#000',
    borderWidth: 3,
  },
  applyButton: {
    backgroundColor: '#000000',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  eyedropperButton: {
    padding: 8,
  },
  // Position Modal Styles
  positionContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    minHeight: 200,
  },
  positionGrid: {
    alignItems: 'center',
  },
  positionFull: {
    width: '100%',
  },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 8,
  },
  positionCell: {
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    backgroundColor: COLORS.BORDER,
  },
  positionCellSelected: {
    borderColor: '#000',
    backgroundColor: COLORS.PRIMARY,
    borderWidth: 2,
  },
  positionHalf: {
    flex: 1,
    minWidth: 0,
  },
  positionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    textAlign: 'center',
    marginBottom: 12,
  },
  positionCellSmall: {
    width: 40,
    height: 40,
    borderWidth: 2,
    borderColor: COLORS.BORDER,
    borderRadius: 6,
    backgroundColor: COLORS.BORDER,
  },
  // Size Modal Styles
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
  // Margin Modal Styles
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
  // Opacity Modal Styles
  opacityContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  opacityModalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
  },
  opacityLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  opacityValueText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    minWidth: 50,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.TEXT,
    minWidth: 50,
    textAlign: 'right',
  },
});


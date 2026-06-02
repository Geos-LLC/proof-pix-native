import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Image,
  PanResponder,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { usePhotos } from '../context/PhotoContext';
// useFeaturePermissions / FEATURES removed — used to gate the watermark
// section, which now lives on the dedicated Watermark Customization
// screen.
import { getLabelPositions, PHOTO_MODES } from '../constants/rooms';
import { Animated } from 'react-native';

// 9-cell position grid keys, organised by (column, row) so a drag can
// snap to the nearest cell by checking centres.
const POSITION_GRID = [
  ['left-top',     'center-top',     'right-top'],
  ['left-middle',  'center-middle',  'right-middle'],
  ['left-bottom',  'center-bottom',  'right-bottom'],
];
const positionToCoords = (key) => {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (POSITION_GRID[r][c] === key) return { col: c, row: r };
    }
  }
  return { col: 0, row: 0 };
};
// Find the grid key whose centre is closest to (x, y) inside a region
// of width w / height h (origin at top-left of the region).
const nearestPositionKey = (x, y, w, h) => {
  if (!w || !h) return 'left-top';
  let best = 'left-top';
  let bestDist = Infinity;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = (c + 0.5) * (w / 3);
      const cy = (r + 0.5) * (h / 3);
      const d = Math.hypot(cx - x, cy - y);
      if (d < bestDist) { bestDist = d; best = POSITION_GRID[r][c]; }
    }
  }
  return best;
};

// Compute the top-left corner pixel position of a label for a given
// position key inside a region of width/height. The label's own
// width/height is needed so the bottom/right anchors land correctly.
const positionToTopLeft = (key, regionW, regionH, labelW, labelH, marginH = 10, marginV = 10) => {
  const { col, row } = positionToCoords(key);
  let x = marginH;
  if (col === 1) x = (regionW - labelW) / 2;
  else if (col === 2) x = regionW - labelW - marginH;
  let y = marginV;
  if (row === 1) y = (regionH - labelH) / 2;
  else if (row === 2) y = regionH - labelH - marginV;
  return { x, y };
};

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

// Maps the abstract font-family setting keys to the real font names
// registered in App.js (mirrors PhotoLabel's FONT_FAMILY_MAP so the
// preview renders with the same typeface the saved labels will use).
const PREVIEW_FONT_MAP = {
  system: 'Alexandria_400Regular',
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
};
const getPreviewFontFamily = (key) => PREVIEW_FONT_MAP[key] || PREVIEW_FONT_MAP.system;

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

export default function CustomizeLabelsScreen({ route, navigation }) {
  // Which orientation tab the position controls are editing.
  // 'portrait' edits beforeLabelPosition / afterLabelPosition (the legacy
  // settings, used for portrait + square photos). 'landscape' edits the new
  // *Landscape variants, which are applied to photos wider than they are tall.
  const [orientationTab, setOrientationTab] = useState('portrait');

  // Get settings from context (these are persisted to AsyncStorage)
  const {
    labelBackgroundColor,
    labelTextColor,
    labelCornerStyle,
    labelSize,
    labelFontFamily,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    beforeLabelOffset,
    afterLabelOffset,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelCornerStyle,
    updateLabelSize,
    updateLabelFontFamily,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateBeforeLabelPositionLandscape,
    updateAfterLabelPositionLandscape,
    updateBeforeLabelOffset,
    updateAfterLabelOffset,
    updateBeforeLabelOffsetLandscape,
    updateAfterLabelOffsetLandscape,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    // Label language (independent of app language)
    labelLanguage,
    updateLabelLanguage,
  } = useSettings();

  // While a label is being dragged, disable the outer ScrollView so the
  // page doesn't pan along with the label. Re-enabled on release.
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Local state for UI only (modals, temp values)

  // Modal states
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState(null); // 'bg' or 'text'
  const [positionModalVisible, setPositionModalVisible] = useState(false);
  const [sizeModalVisible, setSizeModalVisible] = useState(false);
  const [marginModalVisible, setMarginModalVisible] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  // Color picker state
  const [tempColor, setTempColor] = useState('#EAB308');
  const [colorTab, setColorTab] = useState('Grid');
  const [colorOpacity, setColorOpacity] = useState(100);

  const openColorModal = (type) => {
    setColorModalType(type);
    if (type === 'bg') {
      setTempColor(labelBackgroundColor);
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
    }
    setColorModalVisible(false);
  };

  const currentFont = FONT_OPTIONS.find(f => f.key === labelFontFamily)?.label || 'Arial Blank';
  // currentSize supports both the legacy small/medium/large strings and
  // numeric font sizes (from the new slider). Numeric → derive padding
  // proportionally; string → look up in SIZE_OPTIONS.
  const currentSize = useMemo(() => {
    if (typeof labelSize === 'number') {
      return { fontSize: labelSize, padding: Math.max(4, Math.round(labelSize * 0.6)) };
    }
    return SIZE_OPTIONS.find((s) => s.key === labelSize) || SIZE_OPTIONS[1];
  }, [labelSize]);

  // Pull the actual photo through if Studio passed a photoId — that way
  // the preview reflects what the labels will look like on the user's
  // own picture, not a placeholder icon.
  const photoId = route?.params?.photoId;
  const { photos } = usePhotos();
  const previewPhoto = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  // Position helper: returns absolute-positioning styles relative to the
  // preview half. Uses percentage + transform for middle/center anchors so
  // they snap to the true geometric center regardless of preview height
  // (the previous fixed-pixel math assumed a square preview, which is why
  // "middle" appeared near the top).
  const getPositionStyle = (position, marginV, marginH) => {
    const mv = marginV ?? 8;
    const mh = marginH ?? 8;
    const positions = {
      'left-top':      { top: mv, left: mh },
      'center-top':    { top: mv, left: '50%', transform: [{ translateX: '-50%' }] },
      'right-top':     { top: mv, right: mh },
      'left-middle':   { top: '50%', left: mh, transform: [{ translateY: '-50%' }] },
      'center-middle': { top: '50%', left: '50%', transform: [{ translateX: '-50%' }, { translateY: '-50%' }] },
      'right-middle':  { top: '50%', right: mh, transform: [{ translateY: '-50%' }] },
      'left-bottom':   { bottom: mv, left: mh },
      'center-bottom': { bottom: mv, left: '50%', transform: [{ translateX: '-50%' }] },
      'right-bottom':  { bottom: mv, right: mh },
    };
    return positions[position] || positions['left-top'];
  };

  // Active before/after positions for the currently-edited orientation tab.
  const activeBeforePos = orientationTab === 'landscape'
    ? (beforeLabelPositionLandscape || beforeLabelPosition)
    : beforeLabelPosition;
  const activeAfterPos = orientationTab === 'landscape'
    ? (afterLabelPositionLandscape || afterLabelPosition)
    : afterLabelPosition;
  const activeBeforeOffset = orientationTab === 'landscape'
    ? beforeLabelOffsetLandscape
    : beforeLabelOffset;
  const activeAfterOffset = orientationTab === 'landscape'
    ? afterLabelOffsetLandscape
    : afterLabelOffset;
  const updateActiveBeforePos = orientationTab === 'landscape'
    ? updateBeforeLabelPositionLandscape
    : updateBeforeLabelPosition;
  const updateActiveAfterPos = orientationTab === 'landscape'
    ? updateAfterLabelPositionLandscape
    : updateAfterLabelPosition;
  const updateActiveBeforeOffset = orientationTab === 'landscape'
    ? updateBeforeLabelOffsetLandscape
    : updateBeforeLabelOffset;
  const updateActiveAfterOffset = orientationTab === 'landscape'
    ? updateAfterLabelOffsetLandscape
    : updateAfterLabelOffset;

  const activeBeforeStyle = getPositionStyle(activeBeforePos, labelMarginVertical, labelMarginHorizontal);
  const activeAfterStyle = getPositionStyle(activeAfterPos, labelMarginVertical, labelMarginHorizontal);
  // Match the rest of the app's convention from isStackedLayout: portrait
  // photos render side-by-side (row flex, vertical divider), landscape photos
  // render stacked (column flex, horizontal divider).
  const isHorizontal = orientationTab === 'landscape';


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
          scrollEnabled={scrollEnabled}
        >
        {/* Preview — single square box that switches between portrait
            (side-by-side, vertical divider) and landscape (stacked, horizontal
            divider) per the codebase's isStackedLayout convention: portrait
            photos combine side-by-side, landscape photos combine stacked. */}
        <View style={styles.previewSection}>
          <View style={styles.orientationTabsRow}>
            {[
              { key: 'portrait', label: 'Vertical' },
              { key: 'landscape', label: 'Horizontal' },
            ].map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.orientationTab,
                  orientationTab === key && styles.orientationTabActive,
                ]}
                onPress={() => setOrientationTab(key)}
              >
                <Text style={[
                  styles.orientationTabText,
                  orientationTab === key && styles.orientationTabTextActive,
                ]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* SINGLE photo background (no duplicated halves). For
              combined photos we show the merged image once and overlay
              BOTH labels at their respective half-positions. For single
              photos (Before / After / Progress) we show the photo and a
              single label. Labels are drag-and-droppable — release
              snaps to the nearest of 9 grid cells in their half. */}
          <PreviewArea
            photo={previewPhoto}
            isCombined={previewPhoto?.mode === PHOTO_MODES.COMBINED}
            isHorizontal={isHorizontal}
            beforePos={activeBeforePos}
            afterPos={activeAfterPos}
            beforeOffset={activeBeforeOffset}
            afterOffset={activeAfterOffset}
            onBeforeOffsetChange={updateActiveBeforeOffset}
            onAfterOffsetChange={updateActiveAfterOffset}
            onDragStart={() => setScrollEnabled(false)}
            onDragEnd={() => setScrollEnabled(true)}
            labelBackgroundColor={labelBackgroundColor}
            labelTextColor={labelTextColor}
            labelCornerStyle={labelCornerStyle}
            labelFontFamily={labelFontFamily}
            currentSize={currentSize}
            marginV={labelMarginVertical}
            marginH={labelMarginHorizontal}
          />
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
        </View>

        {/* Control Buttons Row 2 — keeps an even 4+4 split with row 1 */}
        <View style={styles.controlsRow}>
          <ColorControlButton
            color={labelTextColor}
            label="Text Color"
            onPress={() => openColorModal('text')}
          />
          <ControlButton
            icon="move"
            label="Position"
            onPress={() => setPositionModalVisible(true)}
          />
          <ControlButton
            icon="swap-horizontal-outline"
            label="Margin"
            onPress={() => setMarginModalVisible(true)}
          />
          <ControlButton
            icon="language"
            label="Language"
            onPress={() => setLanguageModalVisible(true)}
          />
        </View>

        {/* Watermark customization lives on the dedicated Watermark
            Customization screen now — the Labels screen is for label
            styling only. */}
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
          colorModalType === 'bg' ? 'Background Color' : 'Text Color'
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

      {/* Position Modal — dual Before/After grid for combined photos,
          single grid for everything else. For single photos the
          "before" position drives the lone label that's rendered. */}
      <BottomModal
        visible={positionModalVisible}
        onClose={() => setPositionModalVisible(false)}
        title="Label Position"
      >
        <View style={styles.positionContainer}>
          <Text style={styles.orientationHint}>
            Editing {orientationTab === 'portrait' ? 'vertical (portrait + square)' : 'horizontal (landscape)'} photo positions. Switch in the preview above.
          </Text>

          {previewPhoto?.mode === PHOTO_MODES.COMBINED ? (
            <View style={styles.positionGrid}>
              <View style={styles.positionHalf}>
                <Text style={styles.positionHalfLabel}>Before</Text>
                {POSITION_GRID.map((row, rowIdx) => (
                  <View key={rowIdx} style={styles.positionRow}>
                    {row.map((pos) => (
                      <TouchableOpacity
                        key={pos}
                        style={[
                          styles.positionCell,
                          activeBeforePos === pos && !activeBeforeOffset && styles.positionCellSelected,
                        ]}
                        onPress={async () => {
                          await updateActiveBeforeOffset(null);
                          await updateActiveBeforePos(pos);
                        }}
                      />
                    ))}
                  </View>
                ))}
              </View>
              <View style={styles.positionDivider} />
              <View style={styles.positionHalf}>
                <Text style={styles.positionHalfLabel}>After</Text>
                {POSITION_GRID.map((row, rowIdx) => (
                  <View key={rowIdx} style={styles.positionRow}>
                    {row.map((pos) => (
                      <TouchableOpacity
                        key={pos}
                        style={[
                          styles.positionCell,
                          activeAfterPos === pos && !activeAfterOffset && styles.positionCellSelected,
                        ]}
                        onPress={async () => {
                          await updateActiveAfterOffset(null);
                          await updateActiveAfterPos(pos);
                        }}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.positionFullGrid}>
              {POSITION_GRID.map((row, rowIdx) => (
                <View key={rowIdx} style={styles.positionRow}>
                  {row.map((pos) => (
                    <TouchableOpacity
                      key={pos}
                      style={[
                        styles.positionCell,
                        activeBeforePos === pos && !activeBeforeOffset && styles.positionCellSelected,
                      ]}
                      onPress={async () => {
                        await updateActiveBeforeOffset(null);
                        await updateActiveBeforePos(pos);
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}
        </View>
      </BottomModal>

      {/* Size — continuous slider (was Small / Medium / Large pills). */}
      <BottomModal
        visible={sizeModalVisible}
        onClose={() => setSizeModalVisible(false)}
        title="Label Size"
      >
        <View style={styles.marginContainer}>
          <View style={styles.marginSection}>
            <View style={styles.opacityLabelContainer}>
              <Text style={styles.marginLabel}>Label size :</Text>
              <Text style={styles.opacityValueText}>
                {typeof labelSize === 'number' ? `${labelSize}px` : (
                  SIZE_OPTIONS.find((s) => s.key === labelSize)?.fontSize
                    ? `${SIZE_OPTIONS.find((s) => s.key === labelSize).fontSize}px`
                    : '14px'
                )}
              </Text>
            </View>
            <SliderInput
              value={typeof labelSize === 'number'
                ? labelSize
                : (SIZE_OPTIONS.find((s) => s.key === labelSize)?.fontSize || 14)}
              onValueChange={(v) => updateLabelSize(Math.round(v))}
              onSlidingComplete={(v) => updateLabelSize(Math.round(v))}
              min={10}
              max={32}
              step={1}
              showValue={false}
              trackColor="#22C55E"
            />
          </View>
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

      {/* Watermark modals removed — watermark customization lives on its
          own screen. The color modal here still handles BG + text only. */}

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

// ───────── Preview ─────────
// Single background photo with one or two draggable labels overlaid.
// For combined photos, both BEFORE + AFTER labels sit in their
// respective halves (split direction follows the orientation tab).
// For single photos, only BEFORE shows (representative single label).
function PreviewArea({
  photo,
  isCombined,
  isHorizontal,
  beforePos,
  afterPos,
  beforeOffset,
  afterOffset,
  onBeforeOffsetChange,
  onAfterOffsetChange,
  onDragStart,
  onDragEnd,
  labelBackgroundColor,
  labelTextColor,
  labelCornerStyle,
  labelFontFamily,
  currentSize,
  marginV,
  marginH,
}) {
  const [layout, setLayout] = useState({ w: 0, h: 0 });
  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  // Bounds for each label's drag region. Combined photos split the
  // preview into halves; non-combined uses the whole preview.
  const beforeBounds = isCombined
    ? (isHorizontal
        ? { x: 0, y: 0, w: layout.w, h: layout.h / 2 }
        : { x: 0, y: 0, w: layout.w / 2, h: layout.h })
    : { x: 0, y: 0, w: layout.w, h: layout.h };
  const afterBounds = isCombined
    ? (isHorizontal
        ? { x: 0, y: layout.h / 2, w: layout.w, h: layout.h / 2 }
        : { x: layout.w / 2, y: 0, w: layout.w / 2, h: layout.h })
    : null;

  return (
    <View style={styles.previewSquare} onLayout={onLayout}>
      {photo?.uri ? (
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={styles.previewPlaceholder}>
          <Ionicons name="image-outline" size={48} color="#999" />
        </View>
      )}
      {/* Faint divider only for combined photos — visual hint that
          BEFORE goes on one half and AFTER on the other. */}
      {isCombined && (
        <View
          pointerEvents="none"
          style={
            isHorizontal
              ? { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(255,255,255,0.5)' }
              : { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,0.5)' }
          }
        />
      )}
      {layout.w > 0 && layout.h > 0 && (
        <DraggableLabel
          text="Before"
          bounds={beforeBounds}
          positionKey={beforePos}
          offset={beforeOffset}
          onOffsetChange={onBeforeOffsetChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          backgroundColor={labelBackgroundColor}
          textColor={labelTextColor}
          cornerStyle={labelCornerStyle}
          fontFamily={labelFontFamily}
          fontSize={currentSize?.fontSize || 14}
          padding={currentSize?.padding || 10}
          marginV={marginV}
          marginH={marginH}
        />
      )}
      {isCombined && afterBounds && layout.w > 0 && layout.h > 0 && (
        <DraggableLabel
          text="After"
          bounds={afterBounds}
          positionKey={afterPos}
          offset={afterOffset}
          onOffsetChange={onAfterOffsetChange}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          backgroundColor={labelBackgroundColor}
          textColor={labelTextColor}
          cornerStyle={labelCornerStyle}
          fontFamily={labelFontFamily}
          fontSize={currentSize?.fontSize || 14}
          padding={currentSize?.padding || 10}
          marginV={marginV}
          marginH={marginH}
        />
      )}
    </View>
  );
}

// Freeform draggable label. The label's top-left, in pixels inside
// `bounds`, lives in a single Animated.ValueXY (`pos`). React's `offset`
// prop is just the persistence sink — we sync FROM offset → pos when
// the prop changes externally (and we're not dragging), and write TO
// offset on release. Because pos is animated, the visual position
// never depends on a re-render landing — eliminating the one-frame
// blink the previous "anchor + pan" math caused on release.
function DraggableLabel({
  text,
  bounds,
  positionKey,
  offset,
  onOffsetChange,
  onDragStart,
  onDragEnd,
  backgroundColor,
  textColor,
  cornerStyle,
  fontFamily,
  fontSize,
  padding,
  marginV,
  marginH,
}) {
  const [labelSize, setLabelSize] = useState({ w: 0, h: 0 });
  const onLabelLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setLabelSize((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
  };

  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const posRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  // Keep posRef in sync with pos so the gesture handlers can read the
  // current pixel value synchronously without going through React.
  useEffect(() => {
    const idX = pos.x.addListener(({ value }) => { posRef.current.x = value; });
    const idY = pos.y.addListener(({ value }) => { posRef.current.y = value; });
    return () => { pos.x.removeListener(idX); pos.y.removeListener(idY); };
  }, [pos]);

  // Sync FROM external offset/positionKey (or bounds/labelSize) → pos.
  // Skipped while dragging so the gesture isn't yanked back by a stale
  // settings round-trip. Once labelSize is known, compute the target in
  // pixels and write it directly to the animated value.
  useEffect(() => {
    if (draggingRef.current) return;
    if (labelSize.w === 0 || labelSize.h === 0) return;
    const target = offset && typeof offset.x === 'number' && typeof offset.y === 'number'
      ? {
          x: offset.x * Math.max(0, bounds.w - labelSize.w),
          y: offset.y * Math.max(0, bounds.h - labelSize.h),
        }
      : positionToTopLeft(positionKey, bounds.w, bounds.h, labelSize.w, labelSize.h, marginH, marginV);
    pos.setValue(target);
    posRef.current = target;
  // bounds is a plain object — depend on its scalar fields so we don't
  // trip on identity churn from the parent rendering a new object each
  // frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset?.x, offset?.y, positionKey, bounds.w, bounds.h, bounds.x, bounds.y, labelSize.w, labelSize.h, marginH, marginV]);

  // Capture the touch in the capture phase so the parent ScrollView
  // doesn't claim the gesture first. Termination requests from ancestors
  // are refused so a scroll-attempt mid-drag can't yank the responder.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        dragStartRef.current = { x: posRef.current.x, y: posRef.current.y };
        onDragStart && onDragStart();
      },
      onPanResponderMove: (_, g) => {
        // Move pos directly in pixels — no separate "pan delta" layer
        // means the visual position is always exactly where pos points.
        pos.setValue({
          x: dragStartRef.current.x + g.dx,
          y: dragStartRef.current.y + g.dy,
        });
      },
      onPanResponderRelease: () => {
        // Clamp to bounds so the label can't escape its half.
        const finalX = Math.max(0, Math.min(bounds.w - labelSize.w, posRef.current.x));
        const finalY = Math.max(0, Math.min(bounds.h - labelSize.h, posRef.current.y));
        // Snap pos to the clamped pixel position FIRST, synchronously,
        // so the next frame renders at exactly the drop point. Then
        // persist as a fraction.
        pos.setValue({ x: finalX, y: finalY });
        posRef.current = { x: finalX, y: finalY };
        const spanX = Math.max(1, bounds.w - labelSize.w);
        const spanY = Math.max(1, bounds.h - labelSize.h);
        const nextOffset = {
          x: Math.max(0, Math.min(1, finalX / spanX)),
          y: Math.max(0, Math.min(1, finalY / spanY)),
        };
        draggingRef.current = false;
        onOffsetChange && onOffsetChange(nextOffset);
        onDragEnd && onDragEnd();
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        onDragEnd && onDragEnd();
      },
    })
  ).current;

  // Hide the label for the first frame after mount while we wait for
  // onLayout to report its real size — otherwise it would briefly flash
  // at (bounds.x, bounds.y) before the sync-effect can place it.
  const ready = labelSize.w > 0 && labelSize.h > 0;

  return (
    <Animated.View
      onLayout={onLabelLayout}
      {...responder.panHandlers}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        opacity: ready ? 1 : 0,
        backgroundColor,
        borderRadius: cornerStyle === 'rounded' ? 20 : 4,
        paddingHorizontal: Math.max(6, padding || 10),
        paddingVertical: Math.max(2, Math.round((padding || 10) * 0.5)),
        transform: [{ translateX: pos.x }, { translateY: pos.y }],
      }}
    >
      <Text
        style={{
          color: textColor,
          fontSize: fontSize,
          fontFamily: getPreviewFontFamily(fontFamily),
          fontWeight: '700',
        }}
      >
        {text}
      </Text>
    </Animated.View>
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
  orientationTabsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 8,
    padding: 4,
    marginBottom: 12,
  },
  previewPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewSquare: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    overflow: 'hidden',
  },
  previewHalfBefore: {
    flex: 1,
    backgroundColor: '#D1D1D1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewHalfAfter: {
    flex: 1,
    backgroundColor: '#A0A0A0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewDividerVertical: {
    width: 1,
    backgroundColor: '#FFFFFF',
  },
  previewDividerHorizontal: {
    height: 1,
    backgroundColor: '#FFFFFF',
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
  orientationTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  orientationTabActive: {
    backgroundColor: 'white',
  },
  orientationTabText: {
    fontSize: 14,
    color: COLORS.GRAY,
  },
  orientationTabTextActive: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  orientationHint: {
    fontSize: 12,
    color: COLORS.GRAY,
    textAlign: 'center',
    marginBottom: 16,
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
  positionHalfLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.GRAY,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.4,
  },
  positionFullGrid: {
    width: '70%',
    alignSelf: 'center',
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
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 12-hue × 10-shade HSL grid — same generator as LabelCustomizationScreen
// so the three color pickers (Labels, Watermark, Metadata) render an
// identical palette. Kept as a module-scope constant so it isn't
// recomputed on every render.
const hslToHex = (h, s, l) => {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  if (h < 1 / 6)      { r = c; g = x; b = 0; }
  else if (h < 2 / 6) { r = x; g = c; b = 0; }
  else if (h < 3 / 6) { r = 0; g = c; b = x; }
  else if (h < 4 / 6) { r = 0; g = x; b = c; }
  else if (h < 5 / 6) { r = x; g = 0; b = c; }
  else                { r = c; g = 0; b = x; }
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return ('#' + hex(r) + hex(g) + hex(b)).toUpperCase();
};

const buildColorGrid = () => {
  const rows = [];
  for (let s = 0; s < 10; s++) {
    const row = [];
    for (let h = 0; h < 12; h++) {
      const hue = h * 30;
      const saturation = s === 0 ? 0 : 100;
      const lightness = s === 0 ? 100 - h * 8 : 100 - s * 10;
      row.push(hslToHex(hue, saturation, lightness));
    }
    rows.push(row);
  }
  return rows;
};

const COLOR_GRID = buildColorGrid();

// Preset row across the bottom of the picker — same palette the Labels
// picker uses so switching between features feels consistent.
const SAVED_COLORS = [
  '#A855F7', '#000000', '#3B82F6', '#22C55E', '#EAB308', '#EF4444',
  '#06B6D4', '#A855F7', '#6366F1', '#F43F5E',
];

// Shared color picker used by Labels, Watermark, and Metadata bottom
// sheets. Live-preview on every cell tap (via `onChange`), plus a
// primary "Done" button that closes the sheet. Consumers pass the
// current color and an onDone handler; opacity control is intentionally
// omitted here — none of the three call sites persist opacity via this
// picker (opacity gets its own dedicated slider modal).
export default function ColorGridPicker({ theme, value, onChange, onDone, doneLabel = 'Done' }) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const normalized = (value || '').toUpperCase();
  return (
    <View style={styles.container}>
      {/* Tabs bar — only Grid is wired today. Left in place so the UI
          matches the Labels reference and to leave room for Spectrum /
          Sliders variants down the line. */}
      <View style={styles.tabs}>
        {['Grid', 'Spectrum', 'Sliders'].map((tab) => {
          const isActive = tab === 'Grid';
          return (
            <View
              key={tab}
              style={[
                styles.tab,
                isActive && styles.tabActive,
              ]}
            >
              <Text style={[
                styles.tabText,
                isActive && styles.tabTextActive,
              ]}>{tab}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.grid}>
        {COLOR_GRID.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.gridRow}>
            {row.map((color, colIdx) => {
              const isSelected = color === normalized;
              return (
                <TouchableOpacity
                  key={`${rowIdx}-${colIdx}`}
                  style={[
                    styles.cell,
                    { backgroundColor: color },
                    isSelected && styles.cellSelected,
                  ]}
                  onPress={() => onChange(color)}
                />
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.previewRow}>
        <View style={[styles.previewLarge, { backgroundColor: normalized || '#FFFFFF', borderColor: theme.border }]} />
        {SAVED_COLORS.map((color, idx) => {
          const isSelected = color.toUpperCase() === normalized;
          return (
            <TouchableOpacity
              key={idx}
              style={[
                styles.previewSmall,
                { backgroundColor: color, borderColor: theme.border },
                isSelected && { borderWidth: 2, borderColor: theme.accent },
              ]}
              onPress={() => onChange(color)}
            />
          );
        })}
        <View style={[styles.addBtn, { backgroundColor: theme.surface }]}>
          <Ionicons name="add" size={18} color={theme.textSecondary} />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.doneBtn, { backgroundColor: theme.accent }]}
        onPress={onDone}
        activeOpacity={0.85}
      >
        <Text style={[styles.doneBtnText, { color: theme.accentText }]}>{doneLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { padding: 16 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabActive: {
    backgroundColor: theme.surfaceElevated,
  },
  tabText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  tabTextActive: {
    color: theme.textPrimary,
    fontWeight: '600',
  },
  grid: {
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridRow: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    aspectRatio: 1.6,
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  previewLarge: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
  },
  previewSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});

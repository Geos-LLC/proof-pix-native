import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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

// Single-row preset strip below the grid. Trimmed to 7 distinct colors +
// preview swatch = 8 items so the row never wraps on a 390-wide screen,
// even after modal padding. If we need more presets later, add a
// horizontal ScrollView here instead of wrapping.
const SAVED_COLORS = [
  '#A855F7', '#000000', '#3B82F6', '#22C55E',
  '#EAB308', '#EF4444', '#06B6D4',
];

// Shared color picker used by Labels, Watermark, and Metadata bottom
// sheets. Live-preview on every cell tap (via `onChange`), plus a
// primary "Done" button that closes the sheet. Consumers pass the
// current color and an onDone handler. No tabs, no title — the parent
// modal handles chrome; this keeps the sheet short so the photo behind
// remains visible.
export default function ColorGridPicker({ theme, value, onChange, onDone, doneLabel = 'Done' }) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const normalized = (value || '').toUpperCase();
  return (
    <View style={styles.container}>
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

      {/* Single-row preview + presets. flexWrap:'nowrap' + fixed sizes
          guarantee a single line — see SAVED_COLORS comment above. */}
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
  container: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  grid: {
    marginBottom: 14,
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
    marginBottom: 14,
    flexWrap: 'nowrap',
  },
  previewLarge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
  },
  previewSmall: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
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

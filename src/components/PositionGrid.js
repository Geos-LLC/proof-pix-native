// Unified 9-cell position picker shared across Labels / Watermark /
// Timestamp / Logo customization screens.
//
// Three visual layouts:
//   single  → one 3x3 grid (single photo)
//   side    → two halves arranged left/right (combined side-by-side)
//   stack   → two halves arranged top/bottom (combined stacked)
//
// Two interaction modes:
//   single value (mode='single'): one position key, one onChange handler.
//                  For combined layouts the grid spans BOTH halves with
//                  a divider hint so the user sees the layout but the
//                  picked position is global to the whole combined
//                  canvas (matches how watermark / timestamp / logo
//                  render — one item over the whole image).
//   dual values  (mode='dual'):   two position keys (before + after).
//                  Each half has its own 3x3 grid. Used by Labels on
//                  combined photos where the before and after labels
//                  land independently inside their respective photo
//                  halves.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const POSITION_GRID_KEYS = [
  ['left-top',    'center-top',    'right-top'],
  ['left-middle', 'center-middle', 'right-middle'],
  ['left-bottom', 'center-bottom', 'right-bottom'],
];

// Fractional anchor for each of the 9 cells. Exposed so callers can
// translate between a clicked cell and the offset shape Studio stores.
export const POSITION_KEY_TO_OFFSET = {
  'left-top':      { x: 0,   y: 0   },
  'center-top':    { x: 0.5, y: 0   },
  'right-top':     { x: 1,   y: 0   },
  'left-middle':   { x: 0,   y: 0.5 },
  'center-middle': { x: 0.5, y: 0.5 },
  'right-middle':  { x: 1,   y: 0.5 },
  'left-bottom':   { x: 0,   y: 1   },
  'center-bottom': { x: 0.5, y: 1   },
  'right-bottom':  { x: 1,   y: 1   },
};

// Given an offset {x,y}, return the position key whose fractional
// anchor matches (within 0.01). Returns null if the offset doesn't
// land cleanly on a cell — i.e. it was manually dragged. Callers use
// the null to surface a "manually placed" UI state.
export const offsetToPositionKey = (off) => {
  if (!off || typeof off.x !== 'number' || typeof off.y !== 'number') return null;
  for (const [k, o] of Object.entries(POSITION_KEY_TO_OFFSET)) {
    if (Math.abs(o.x - off.x) < 0.01 && Math.abs(o.y - off.y) < 0.01) return k;
  }
  return null;
};

// Convenience: resolve the currently-selected cell key for a picker.
// Prefers an offset that matches a cell; falls back to the legacy
// position string; returns null when nothing matches a cell.
export const resolvePositionKey = (offset, positionString) => {
  const fromOffset = offsetToPositionKey(offset);
  if (fromOffset) return fromOffset;
  // If an offset is set but doesn't match a cell, treat as
  // "manually placed" — DON'T fall back to the position string.
  if (offset && typeof offset.x === 'number') return null;
  return positionString || null;
};

const DEFAULT_THEME = {
  accent: '#EAB308',
  accentText: '#000000',
  surface: '#FFFFFF',
  surfaceElevated: '#F5F5F5',
  border: '#E5E5E5',
  textSecondary: '#666666',
};

function Cell({ active, onPress, theme }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.cell,
        {
          backgroundColor: active ? theme.accent : theme.surfaceElevated,
          borderColor: active ? theme.accent : theme.border,
        },
      ]}
    >
      {active ? <Ionicons name="checkmark" size={14} color={theme.accentText} /> : null}
    </TouchableOpacity>
  );
}

function Grid({ value, onChange, theme }) {
  return (
    <View style={styles.grid}>
      {POSITION_GRID_KEYS.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((pos) => (
            <Cell
              key={pos}
              active={value === pos}
              onPress={() => onChange?.(pos)}
              theme={theme}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// Native single-photo label bake only supports the 4 corners (the
// underlying iOS / Android `addLabelToImage` API is corner-only). When
// the user picks any of the 5 non-corner cells in the Single grid, the
// bake snaps to the nearest corner. Expose the mapping + a snap-aware
// renderer in PositionGrid so the host screen can surface a "this will
// land at <corner>" hint right next to the picker.
export const SINGLE_CORNER_SNAP = {
  'center-top': 'right-top',
  'left-middle': 'left-bottom',
  'center-middle': 'right-bottom',
  'right-middle': 'right-bottom',
  'center-bottom': 'right-bottom',
};

export const isCornerPosition = (key) =>
  key === 'left-top' || key === 'right-top'
  || key === 'left-bottom' || key === 'right-bottom';

const CORNER_LABEL = {
  'left-top': 'top-left',
  'right-top': 'top-right',
  'left-bottom': 'bottom-left',
  'right-bottom': 'bottom-right',
};

export default function PositionGrid({
  layout = 'single',
  mode = 'single',
  value,
  onChange,
  beforeValue,
  afterValue,
  onBeforeChange,
  onAfterChange,
  theme: themeProp,
  beforeLabel = 'Before',
  afterLabel = 'After',
  manualHint = 'Manually positioned · drag the label to a cell to snap',
  // When true, render a warning under the grid for non-corner picks
  // explaining that single-photo bakes snap to the nearest corner.
  showCornerSnapWarning = false,
}) {
  const theme = themeProp ? { ...DEFAULT_THEME, ...themeProp } : DEFAULT_THEME;
  const isManualSingle = mode !== 'dual' && value == null;
  const isManualDual = mode === 'dual' && beforeValue == null && afterValue == null;
  const showManualHint = (isManualSingle || isManualDual);

  // ── Dual mode: two grids arranged according to layout. ────────────────
  if (mode === 'dual' && layout !== 'single') {
    const isSide = layout === 'side';
    return (
      <View style={isSide ? styles.dualSide : styles.dualStack}>
        <View style={[
          isSide ? styles.halfSideLeft : styles.halfStackTop,
        ]}>
          <Text style={[styles.halfLabel, { color: theme.textSecondary }]}>{beforeLabel}</Text>
          <Grid value={beforeValue} onChange={onBeforeChange} theme={theme} />
        </View>
        <View style={isSide ? styles.halfSideRight : styles.halfStackBottom}>
          <Text style={[styles.halfLabel, { color: theme.textSecondary }]}>{afterLabel}</Text>
          <Grid value={afterValue} onChange={onAfterChange} theme={theme} />
        </View>
      </View>
    );
  }

  // ── Single-value mode (covers `single` layout AND single-value
  //    items rendered over a combined photo). For combined layouts we
  //    draw a soft split-line over the grid so the user understands
  //    the picked position applies to the WHOLE combined canvas. ──────
  // Corner-snap warning fires only on the true Single grid (no
  // combined split lines) for non-corner picks, since combined photos
  // go through captureRef and honor the exact offset.
  const snapsToCorner = showCornerSnapWarning
    && layout === 'single'
    && value
    && !isCornerPosition(value)
    && SINGLE_CORNER_SNAP[value];
  return (
    <View>
      <View style={styles.singleWrap}>
        <Grid value={value} onChange={onChange} theme={theme} />
        {layout === 'side' && (
          <View pointerEvents="none" style={[styles.hintVertical, { borderColor: theme.accent }]} />
        )}
        {layout === 'stack' && (
          <View pointerEvents="none" style={[styles.hintHorizontal, { borderColor: theme.accent }]} />
        )}
      </View>
      {showManualHint ? (
        <Text style={[styles.manualHint, { color: theme.textSecondary }]}>{manualHint}</Text>
      ) : null}
      {snapsToCorner ? (
        <View style={styles.snapWarning}>
          <Ionicons name="warning-outline" size={14} color="#B45309" style={styles.snapWarningIcon} />
          <Text style={styles.snapWarningText}>
            Single before / after / progress photos only support the 4 corners.
            This label will appear at the <Text style={styles.snapWarningCorner}>{CORNER_LABEL[snapsToCorner]}</Text> corner.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  singleWrap: {
    // Single matches the width of one half of the dual grid (49.5%
    // each, with a 1% visual gutter between halves) so toggling
    // Single ⇄ Combined keeps the cell size identical and the single
    // grid visually centered.
    width: '49.5%',
    alignSelf: 'center',
    position: 'relative',
  },
  manualHint: {
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
  },
  snapWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 14,
    marginHorizontal: 16,
  },
  snapWarningIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  snapWarningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: '#92400E',
  },
  snapWarningCorner: {
    fontWeight: '700',
    color: '#78350F',
  },
  dualSide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dualStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  // Explicit 50%-width halves instead of flex:1 — flex distribution
  // was producing an uneven split when combined with the row's gap +
  // nested cells with aspectRatio + minHeight constraints. Fixed 50%
  // each guarantees identical widths regardless of inner content.
  halfSideLeft: {
    width: '49.5%',
    borderRightWidth: 1,
    borderRightColor: '#E5E5E5',
    paddingRight: 6,
  },
  halfSideRight: {
    width: '49.5%',
    paddingLeft: 6,
  },
  halfStackTop: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingBottom: 12,
    marginBottom: 12,
  },
  halfStackBottom: {
    width: '100%',
  },
  halfLabel: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.4,
  },
  grid: {},
  row: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
    alignItems: 'center',
  },
  cell: {
    flex: 1,
    maxWidth: 60,
    aspectRatio: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Hint lines run UNDER the cells (zIndex -1) so taps still register.
  hintVertical: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.6,
    zIndex: -1,
  },
  hintHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    borderTopWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.6,
    zIndex: -1,
  },
});

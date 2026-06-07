import React from 'react';
import { useSettings } from '../context/SettingsContext';
import PhotoLabel from './PhotoLabel';

const MODE_TO_LABEL = {
  before: 'BEFORE',
  after: 'AFTER',
  progress: 'PROGRESS',
  combined: null,
};

/**
 * Renders the appropriate BEFORE / AFTER / PROGRESS label overlay for a
 * photo.  Reads showLabels, positions, offsets and styling from
 * SettingsContext so every screen that shows photos gets identical label
 * rendering without any prop-drilling.
 *
 * Props:
 *   photo           – photo record ({ mode, ... })
 *   role            – optional override for the label text ('before'|'after')
 *   combinedLayout  – 'side' | 'stacked' (used by combined-photo mode)
 */
export default function PhotoLabels({ photo, role, combinedLayout = 'side' }) {
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelOffset,
    afterLabelOffset,
  } = useSettings();

  if (!showLabels || !photo) return null;

  const mode = role || photo?.mode || 'before';
  if (mode === 'combined') return null;

  const label = MODE_TO_LABEL[mode] || MODE_TO_LABEL['before'];
  if (!label) return null;

  const position = mode === 'after' ? afterLabelPosition : beforeLabelPosition;
  const freeformOffset = mode === 'after' ? afterLabelOffset : beforeLabelOffset;

  return (
    <PhotoLabel
      label={label}
      position={position || 'left-top'}
      freeformOffset={freeformOffset}
    />
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import PhotoLabel from './PhotoLabel';

export default function PhotoLabels({ photo, role, combinedLayout }) {
  const { t } = useTranslation();
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
  } = useSettings();

  if (!showLabels) return null;

  const mode = role || (photo && photo.mode);
  if (mode !== 'before' && mode !== 'after') return null;

  const isLandscape = photo && photo.width && photo.height
    ? photo.width > photo.height
    : false;

  let position;
  if (mode === 'before') {
    position = isLandscape
      ? (beforeLabelPositionLandscape || beforeLabelPosition || 'left-top')
      : (beforeLabelPosition || 'left-top');
  } else {
    position = isLandscape
      ? (afterLabelPositionLandscape || afterLabelPosition || 'right-top')
      : (afterLabelPosition || 'right-top');
  }

  const label = mode === 'before'
    ? (t('common.before') || 'BEFORE')
    : (t('common.after') || 'AFTER');

  return (
    <PhotoLabel
      label={label}
      position={position}
      freeformOffset={photo && photo.freeformOffset ? photo.freeformOffset : null}
    />
  );
}

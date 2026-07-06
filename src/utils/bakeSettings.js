// Shared hook for the settings object passed to
// chromeBakeService.bakeChrome. The baker itself pulls the actual
// overlay values from useScopedSettings(photo.id) inside its off-screen
// BakeJob, so the object we return here only exists to feed the cache
// key (see chromeBakeService.labelSettingsHash) — a settings change the
// user makes in Studio has to bust the cache so the next share re-bakes
// with the new configuration.
//
// Keep the field list in lockstep with ChromeBakeService.labelSettingsHash.

import { useMemo } from 'react';
import { useSettings } from '../context/SettingsContext';

export function useBakeLabelSettings() {
  const {
    showLabels,
    labelBackgroundColor,
    labelTextColor,
    labelMarginHorizontal,
    labelMarginVertical,
    beforeLabelPosition,
    afterLabelPosition,
    singleLabelPosition,
    beforeLabelOffset,
    afterLabelOffset,
    singleLabelOffset,
  } = useSettings();
  return useMemo(
    () => ({
      showLabels,
      labelBackgroundColor,
      labelTextColor,
      labelMarginHorizontal,
      labelMarginVertical,
      beforeLabelPosition,
      afterLabelPosition,
      singleLabelPosition,
      beforeLabelOffset,
      afterLabelOffset,
      singleLabelOffset,
    }),
    [
      showLabels,
      labelBackgroundColor,
      labelTextColor,
      labelMarginHorizontal,
      labelMarginVertical,
      beforeLabelPosition,
      afterLabelPosition,
      singleLabelPosition,
      beforeLabelOffset,
      afterLabelOffset,
      singleLabelOffset,
    ],
  );
}

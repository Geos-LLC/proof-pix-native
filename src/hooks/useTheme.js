import { useContext } from 'react';
import { useColorScheme } from 'react-native';
import { SettingsContext } from '../context/SettingsContext';
import { getTheme, lightTheme } from '../constants/theme';

// Reads the current theme palette from SettingsContext. Falls back to the
// light palette when called outside a SettingsProvider (e.g. TrialNotificationModal
// and ReferralPromptModal render at App.js root, ABOVE SettingsProvider). Bypass
// `useSettings()` because it throws when context is null — that throw would
// propagate up and hang the app on splash. See memory
// `feedback_usetheme_outside_provider.md`.
export const useTheme = () => {
  const context = useContext(SettingsContext);
  const system = useColorScheme();
  if (!context) return lightTheme;
  const mode =
    context.themeMode === 'system'
      ? (system === 'dark' ? 'dark' : 'light')
      : context.themeMode;
  return getTheme(mode);
};

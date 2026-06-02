import { useSettings } from '../context/SettingsContext';
import { getTheme } from '../constants/theme';

export const useTheme = () => {
  const { themeMode } = useSettings();
  return getTheme(themeMode);
};

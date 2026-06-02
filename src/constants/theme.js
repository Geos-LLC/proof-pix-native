// App-wide color palettes for light/dark mode. New screens consume colors from
// `useTheme()` so flipping `themeMode` in SettingsContext switches them at
// runtime. Existing legacy screens still hardcode their colors and are not
// theme-aware yet — they'll be migrated screen-by-screen as the redesign lands.

export const lightTheme = {
  mode: 'light',

  background: '#FFFFFF',
  surface: '#F4F4F4',
  surfaceElevated: '#FFFFFF',
  surfaceAccent: '#FFEAA0',

  textPrimary: '#1E1E1E',
  textSecondary: '#666666',
  textMuted: '#9A9A9A',
  textInverse: '#FFFFFF',

  border: '#ECECEC',
  borderStrong: '#D0D0D0',
  divider: '#EEEEEE',

  accent: '#F2C31B',
  accentSoft: '#FFF4C2',
  accentText: '#1E1E1E',

  danger: '#DB4446',
  success: '#34C759',

  modeBefore: '#F2C31B',
  modeProgress: '#3B82F6',
  modeAfter: '#A855F7',

  navBar: '#F4F4F4',
  navActive: '#E0E0E0',

  cardSelectedBorder: '#F2C31B',
};

export const darkTheme = {
  mode: 'dark',

  background: '#0A0A0A',
  surface: '#1A1A1A',
  surfaceElevated: '#242424',
  surfaceAccent: '#3A2E0A',

  textPrimary: '#FFFFFF',
  textSecondary: '#B3B3B3',
  textMuted: '#7A7A7A',
  textInverse: '#0A0A0A',

  border: '#2A2A2A',
  borderStrong: '#3A3A3A',
  divider: '#1F1F1F',

  accent: '#F2C31B',
  accentSoft: '#3A2E0A',
  accentText: '#0A0A0A',

  danger: '#FF6B6D',
  success: '#34C759',

  modeBefore: '#F2C31B',
  modeProgress: '#5BAEFF',
  modeAfter: '#C36BFF',

  navBar: '#1A1A1A',
  navActive: '#2F2F2F',

  cardSelectedBorder: '#F2C31B',
};

export const THEME_MODES = { LIGHT: 'light', DARK: 'dark' };

export const getTheme = (mode) => (mode === 'dark' ? darkTheme : lightTheme);

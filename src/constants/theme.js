// App-wide color palettes for light/dark mode. New screens consume colors from
// `useTheme()` so flipping `themeMode` in SettingsContext switches them at
// runtime. Existing legacy screens still hardcode their colors and are not
// theme-aware yet — they'll be migrated screen-by-screen as the redesign lands.

// Shadow recipes used by the refreshed component system (bottom nav, FAB,
// cards, etc.). Native RN platforms read `shadowColor/shadowOffset/...` plus
// `elevation` for Android — keep them as plain objects so screens can spread
// them into styles.
const shadowCard = {
  shadowColor: '#141420',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.06,
  shadowRadius: 18,
  elevation: 3,
};

const shadowPop = {
  shadowColor: '#141420',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.16,
  shadowRadius: 30,
  elevation: 10,
};

const shadowFab = {
  shadowColor: '#F2C31B',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.5,
  shadowRadius: 24,
  elevation: 10,
};

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
  // Yellow-tinted ink used on accent backgrounds in light mode (and as the
  // accent itself in dark mode). Mirrors `--accent-ink` in proofpix.css.
  accentInk: '#7A5B00',

  danger: '#DB4446',
  success: '#34C759',

  modeBefore: '#F2C31B',
  modeProgress: '#3B82F6',
  modeAfter: '#A855F7',

  navBar: '#FFFFFF',
  navActive: '#F4F4F4',

  scrim: 'rgba(20,20,22,0.55)',

  cardSelectedBorder: '#F2C31B',

  shadowCard,
  shadowPop,
  shadowFab,
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
  accentInk: '#F2C31B',

  danger: '#FF6B6D',
  success: '#34C759',

  modeBefore: '#F2C31B',
  modeProgress: '#5BAEFF',
  modeAfter: '#C36BFF',

  navBar: '#161616',
  navActive: '#242424',

  scrim: 'rgba(0,0,0,0.66)',

  cardSelectedBorder: '#F2C31B',

  shadowCard: {
    ...shadowCard,
    shadowColor: '#000000',
    shadowOpacity: 0.4,
    shadowRadius: 22,
  },
  shadowPop: {
    ...shadowPop,
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 34,
  },
  shadowFab,
};

export const THEME_MODES = { LIGHT: 'light', DARK: 'dark' };

export const getTheme = (mode) => (mode === 'dark' ? darkTheme : lightTheme);

/**
 * Font constants for consistent typography.
 *
 * ## How we load fonts
 * - Fonts are loaded at runtime in App.js using the useFonts() hook from expo-font.
 * - We use @expo-google-fonts/* packages (no local font files in assets/fonts).
 * - The app does not render until fonts are loaded (!fontsLoaded → show "Loading assets…").
 * - Optional: use expo-splash-screen (SplashScreen.preventAutoHideAsync() then hideAsync() when loaded) so the native splash stays until fonts are ready.
 *
 * ## Loaded families (in App.js useFonts)
 * - Alexandria (primary) – weights 100–900 via @expo-google-fonts/alexandria
 * - Quicksand – 300, 400, 500, 600, 700 via @expo-google-fonts/quicksand
 * - Montserrat_700Bold, PlayfairDisplay_700Bold, RobotoMono_700Bold
 * - Lato_700Bold, Poppins_600SemiBold, Oswald_600SemiBold
 *
 * ## iOS and weight 900 (Black)
 * On iOS, Alexandria_900Black can render with larger metrics than 700 (Bold), so the same
 * fontSize can look bigger. Prefer ALEXANDRIA_BOLD (700) for headings/buttons for consistent
 * size across iOS and Android. Use ALEXANDRIA_BLACK (900) only when you explicitly want
 * the heaviest weight and are okay with possible iOS size difference.
 *
 * ## Responsive font sizes
 * Use scaleFontSize(size, width?) so typography scales with screen width (reference 375px).
 *
 * ## Adding a new font
 * 1. Install: npx expo install @expo-google-fonts/<name> expo-font
 * 2. In App.js: import the weight(s) and add them to the useFonts({ ... }) map.
 * 3. Use in styles: fontFamily: 'Inter_600SemiBold' (use the exported name from the package).
 *
 * ## Local font files (optional)
 * - Put .ttf or .otf in assets/fonts/, then either:
 *   - Load with useFonts: useFonts({ 'MyFont': require('../assets/fonts/MyFont.otf') }), or
 *   - Embed with expo-font plugin in app.config.js: plugins: [ ["expo-font", { fonts: ["./assets/fonts/MyFont.otf"] }] ] (requires dev build).
 */

import { Dimensions } from 'react-native';

const REFERENCE_WIDTH = 375;

/**
 * Scale a font size by screen width so typography is responsive and consistent across devices.
 * Clamped (0.85–1.2x) so small phones don't get tiny text and large screens don't get huge text.
 * @param {number} size - Base font size (for a 375pt-wide screen).
 * @param {number} [width] - Current window width; if omitted, uses Dimensions.get('window').width.
 * @returns {number} Scaled font size (rounded).
 */
export function scaleFontSize(size, width) {
  const w = width ?? Dimensions.get('window').width;
  const scale = Math.min(1.2, Math.max(0.85, w / REFERENCE_WIDTH));
  return Math.round(size * scale);
}

// Primary font: Alexandria. @expo-google-fonts registers each weight as a separate family
// (e.g. Alexandria_400Regular, Alexandria_700Bold). Use these exact names so the font loads.
// Prefer ALEXANDRIA_BOLD over ALEXANDRIA_BLACK for consistent size on iOS (900 can render bigger).
// Quicksand bold is used on GoogleSignUpScreen; loaded in App.js as Quicksand_700Bold.
export const FONTS = {
  ALEXANDRIA: 'Alexandria_400Regular',
  ALEXANDRIA_THIN: 'Alexandria_100Thin',
  ALEXANDRIA_EXTRALIGHT: 'Alexandria_200ExtraLight',
  ALEXANDRIA_LIGHT: 'Alexandria_300Light',
  ALEXANDRIA_REGULAR: 'Alexandria_400Regular',
  ALEXANDRIA_MEDIUM: 'Alexandria_500Medium',
  ALEXANDRIA_SEMIBOLD: 'Alexandria_600SemiBold',
  ALEXANDRIA_BOLD: 'Alexandria_700Bold',
  ALEXANDRIA_EXTRABOLD: 'Alexandria_800ExtraBold',
  ALEXANDRIA_BLACK: 'Alexandria_900Black',
  QUICKSAND_BOLD: 'Quicksand_700Bold',

  // Font weights (for reference; use weight-specific ALEXANDRIA_* family instead)
  LIGHT: '300',
  REGULAR: '400',
  MEDIUM: '500',
  SEMIBOLD: '600',
  BOLD: '700',

  // Font sizes (base values; use scaleFontSize() for responsive typography)
  SMALL: 12,
  MEDIUM: 16,
  LARGE: 20,
  XLARGE: 24,
  XXLARGE: 28,
  XXXLARGE: 32,
};

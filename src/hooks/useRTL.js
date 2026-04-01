import { I18nManager } from 'react-native';
import { useTranslation } from 'react-i18next';

const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

/**
 * Hook that provides RTL-aware style helpers based on current language.
 * Returns isRTL flag and common RTL style overrides.
 */
export function useRTL() {
  const { i18n } = useTranslation();
  const isRTL = RTL_LANGUAGES.includes(i18n.language);

  return {
    isRTL,
    // Flip row direction
    rowStyle: { flexDirection: isRTL ? 'row-reverse' : 'row' },
    // Text alignment
    textStyle: { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' },
    // For inputs
    inputStyle: { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' },
    // Writing direction only (for Text components that shouldn't change alignment)
    writingDirection: isRTL ? 'rtl' : 'ltr',
  };
}

/**
 * Check if a language code is RTL
 */
export function isRTLLanguage(languageCode) {
  return RTL_LANGUAGES.includes(languageCode);
}

/**
 * Apply RTL layout direction via I18nManager.
 * Call this when language changes. Requires app restart to fully take effect on Android.
 */
export function applyRTLLayout(languageCode) {
  const shouldBeRTL = RTL_LANGUAGES.includes(languageCode);
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
  }
}

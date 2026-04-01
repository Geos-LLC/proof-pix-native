import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyRTLLayout } from '../hooks/useRTL';

// Translation files
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import be from './locales/be.json';
import uk from './locales/uk.json';
import zh from './locales/zh.json';
import tl from './locales/tl.json';
import ar from './locales/ar.json';
import ko from './locales/ko.json';
import pt from './locales/pt.json';
import vi from './locales/vi.json';

const LANGUAGE_KEY = '@proofpix_language';

// Language detector for AsyncStorage
const languageDetector = {
  type: 'languageDetector',
  async: true,
  detect: async (callback) => {
    try {
      const savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);
      if (savedLanguage) {
        callback(savedLanguage);
      } else {
        callback('en'); // Default to English
      }
    } catch (error) {
      callback('en');
    }
  },
  init: () => {},
  cacheUserLanguage: async (language) => {
    try {
      await AsyncStorage.setItem(LANGUAGE_KEY, language);
    } catch (error) {
      console.error('Error saving language:', error);
    }
  },
};

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    compatibilityJSON: 'v3',
    resources: {
      en: { translation: en },
      es: { translation: es },
      fr: { translation: fr },
      de: { translation: de },
      ru: { translation: ru },
      be: { translation: be },
      uk: { translation: uk },
      zh: { translation: zh },
      tl: { translation: tl },
      ar: { translation: ar },
      ko: { translation: ko },
      pt: { translation: pt },
      vi: { translation: vi },
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
      transSupportBasicHtmlNodes: false,
      transKeepBasicHtmlNodesFor: [],
    },
    // Disable ICU features
    skipI18nInitialize: false,
  });

// Apply RTL layout when language is detected on init
i18n.on('initialized', () => {
  applyRTLLayout(i18n.language);
});

// Apply RTL layout when language changes
i18n.on('languageChanged', (lng) => {
  applyRTLLayout(lng);
});

export default i18n;

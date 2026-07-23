import React, { useRef, useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, AppState, LogBox, Platform, Image, StatusBar } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';

// Keep the native splash screen visible until we explicitly hide it
SplashScreen.preventAutoHideAsync().catch(() => {});

// Log app startup
console.log('[App] ====== APP STARTING ======');
console.log('[App] Platform detected, beginning imports...');
import { NavigationContainer, DefaultTheme as NavDefaultTheme, DarkTheme as NavDarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from './src/hooks/useTheme';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { PhotoProvider } from './src/context/PhotoContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AdminProvider } from './src/context/AdminContext';
import TrialNotificationModal from './src/components/TrialNotificationModal';
import ReferralPromptModal from './src/components/ReferralPromptModal';
import {
  registerReferralPromptTrigger,
  unregisterReferralPromptTrigger,
  maybeShowExpiringTrialReferralPrompt,
  markFirstReportPromptDismissed,
  markFirstReportPromptOpened,
  markExpiringTrialInviteClicked,
  markExpiringTrialUpgradeClicked,
} from './src/services/referralPromptService';
import { useFonts } from 'expo-font';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono';
import { Lato_700Bold } from '@expo-google-fonts/lato';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins';
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald';
import {
  Alexandria_100Thin,
  Alexandria_200ExtraLight,
  Alexandria_300Light,
  Alexandria_400Regular,
  Alexandria_500Medium,
  Alexandria_600SemiBold,
  Alexandria_700Bold,
  Alexandria_800ExtraBold,
  Alexandria_900Black,
} from '@expo-google-fonts/alexandria';
import {
  Quicksand_300Light,
  Quicksand_400Regular,
  Quicksand_500Medium,
  Quicksand_600SemiBold,
  Quicksand_700Bold,
} from '@expo-google-fonts/quicksand';
console.log('[App] Importing Firebase...');
let getApp, getApps, getAnalytics, logEvent, setAnalyticsCollectionEnabled;
try {
  // Do not attempt to load native Firebase modules in Expo Go; they aren't present there.
  if (Constants?.appOwnership !== 'expo') {
    const appModule = require('@react-native-firebase/app');
    const analyticsModule = require('@react-native-firebase/analytics');
    // Use modular API instead of default export
    getApp = appModule.getApp;
    getApps = appModule.getApps;
    getAnalytics = analyticsModule.getAnalytics;
    logEvent = analyticsModule.logEvent;
    setAnalyticsCollectionEnabled = analyticsModule.setAnalyticsCollectionEnabled;
    console.log('[App] Firebase imported successfully');
  } else {
    console.log('[App] Skipping Firebase import in Expo Go (analytics disabled).');
  }
} catch (error) {
  console.warn('[App] Firebase native modules not available:', error.message);
  console.warn('[App] This usually means the app needs to be rebuilt with: npx expo run:android');
}

// Meta (Facebook) SDK
let FBSettings = null;
try {
  if (Constants?.appOwnership !== 'expo') {
    const fbsdk = require('react-native-fbsdk-next');
    FBSettings = fbsdk.Settings;
    console.log('[App] Meta SDK imported successfully');
  }
} catch (error) {
  console.warn('[App] Meta SDK not available:', error.message);
}

console.log('[App] Initializing i18n...');
import './src/i18n/i18n'; // Initialize i18n
console.log('[App] i18n initialized');

// Screens
import HomeScreen from './src/screens/HomeScreen';
// Camera-related screens are loaded lazily below to avoid importing react-native-vision-camera in Expo Go
import PhotoEditorScreen from './src/screens/PhotoEditorScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import PhotoDetailScreen from './src/screens/PhotoDetailScreen';
import SectionDetailScreen from './src/screens/SectionDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import CloudTeamScreen from './src/screens/CloudTeamScreen';
import CloudSyncScreen from './src/screens/CloudSyncScreen';
import TeamMembersScreen from './src/screens/TeamMembersScreen';
import HelpSupportScreen from './src/screens/HelpSupportScreen';
import IndustrySectionsScreen from './src/screens/IndustrySectionsScreen';
import LabelsLanguageScreen from './src/screens/LabelsLanguageScreen';
import AppearanceScreen from './src/screens/AppearanceScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import StudioScreen from './src/screens/StudioScreen';
import LogoCustomizationScreen from './src/screens/LogoCustomizationScreen';
import BrandingSettingsScreen from './src/screens/BrandingSettingsScreen';
import MetadataCustomizationScreen from './src/screens/MetadataCustomizationScreen';
import MarkupEditorScreen from './src/screens/MarkupEditorScreen';
import MarkupSheetScreen from './src/screens/MarkupSheetScreen';
import SharePreviewScreen from './src/screens/SharePreviewScreen';
import {
  StudioLayoutScreen,
  StudioLabelsScreen,
  StudioNotesScreen,
  StudioBrandingScreen,
  StudioExportScreen,
} from './src/screens/StudioToolScreens';
import PersistentBottomNav from './src/components/PersistentBottomNav';
import { UiOverlayProvider } from './src/components/uiOverlayState';
import ProjectDetailScreen from './src/screens/ProjectDetailScreen';
import PhotoSetPreviewScreen from './src/screens/PhotoSetPreviewScreen';
import ReportStyleScreen from './src/screens/ReportStyleScreen';
import LabelCustomizationScreen from './src/screens/LabelCustomizationScreen';
import WatermarkCustomizationScreen from './src/screens/WatermarkCustomizationScreen';
import FirstLoadScreen from './src/screens/FirstLoadScreen';
import PlanSelectionScreen from './src/screens/PlanSelectionScreen';
import InviteScreen from './src/screens/InviteScreen';
import JoinTeamScreen from './src/screens/JoinTeamScreen';
import ReferralScreen from './src/screens/ReferralScreen';
import AdminReferralScreen from './src/screens/AdminReferralScreen';
import CRMRedeemScreen from './src/screens/CRMRedeemScreen';
import ServiceFlowSyncTrigger from './src/components/ServiceFlowSyncTrigger';
import GoogleSignUpScreen from './src/screens/GoogleSignUpScreen';
import LabelLanguageSetupScreen from './src/screens/LabelLanguageSetupScreen';
import SectionLanguageSetupScreen from './src/screens/SectionLanguageSetupScreen';
import UploadPhotosScreen from './src/screens/UploadPhotosScreen';
import AuthLoadingScreen from './src/screens/AuthLoadingScreen';
import WelcomeSetupScreen from './src/screens/WelcomeSetupScreen';
import UserInfoSetupScreen from './src/screens/UserInfoSetupScreen';
import PermissionsSetupScreen from './src/screens/PermissionsSetupScreen';
import GlobalBackgroundLabelPreparation from './src/components/GlobalBackgroundLabelPreparation';
import GlobalBackgroundCombinedPhotoCreator from './src/components/GlobalBackgroundCombinedPhotoCreator';
import GlobalBackgroundChromeBaker from './src/components/GlobalBackgroundChromeBaker';
import GlobalBakeProgressBanner from './src/components/GlobalBakeProgressBanner';
import UploadIndicatorLine from './src/components/UploadIndicatorLine';
import { useBackgroundUpload } from './src/hooks/useBackgroundUpload';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

console.log('[App] All imports completed successfully');

// Startup marker — proves which JS bundle is loaded on device. The string
// changes per OTA push so Loki logs immediately tell us if a device is
// running the embedded bundle vs a downloaded OTA. Bump the version+date
// every OTA push that needs to be diagnosable.
console.warn('[BUNDLE] v62-theme-sync-fxp App.js marker — Built ' + new Date().toISOString());

const Stack = createNativeStackNavigator();
const isExpoGo = Constants?.appOwnership === 'expo';

// Simple placeholder screen to disable camera when running in Expo Go
function CameraDisabledScreen() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: '#000' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 }}>
          Camera disabled in Expo Go
        </Text>
        <Text style={{ color: '#ccc', fontSize: 14, textAlign: 'center' }}>
          The full camera experience uses react-native-vision-camera, which is not supported in Expo Go.
          Build a development client (expo run:ios / expo run:android) to use the camera, or continue testing other features here.
        </Text>
      </View>
    </SafeAreaProvider>
  );
}

// In Expo Go, use placeholder (vision-camera not supported). In dev/client builds, use real CameraScreen.
let CameraScreenModule = null;
const CameraScreenComponent = (props) => {
  if (isExpoGo) return <CameraDisabledScreen />;
  if (!CameraScreenModule) CameraScreenModule = require('./src/screens/CameraScreen').default;
  return <CameraScreenModule {...props} />;
};
const VisionCameraTestComponent = CameraDisabledScreen;

// Error Boundary for debugging - shows errors on screen in both dev and prod
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 20 }}>
          <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#f00', marginBottom: 10 }}>
            App Error
          </Text>
          <Text style={{ fontSize: 14, color: '#333', textAlign: 'center', marginBottom: 10 }}>
            {this.state.error?.toString()}
          </Text>
          <Text style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>
            {this.state.errorInfo?.componentStack?.slice(0, 500)}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// Wrap entire app with ErrorBoundary at the top level
const AppWithErrorBoundary = ({ children }) => (
  <ErrorBoundary>{children}</ErrorBoundary>
);

// Wraps React Navigation's NavigationContainer with theme + StatusBar that
// react to `themeMode` from SettingsContext. Must render inside
// SettingsProvider. Takes `navigationRef` as a prop instead of via
// React.forwardRef so the call site stays a plain functional element.
function ThemedNavigationContainer({ navigationRef, children, ...rest }) {
  const theme = useTheme();
  const isDark = theme.mode === 'dark';
  // navTheme MUST be memoized — NavigationContainer compares it by reference
  // and remounts its entire screen tree when the prop changes. A fresh
  // object on every render would tear down/rebuild Stack on each parent
  // re-render, which is what produced the "splash flickers, projects vanish"
  // symptom reported on device.
  const navTheme = useMemo(() => {
    const base = isDark ? NavDarkTheme : NavDefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        background: theme.background,
        card: theme.surface,
        text: theme.textPrimary,
        border: theme.border,
        primary: theme.accent,
        notification: theme.accent,
      },
    };
  }, [isDark, theme.background, theme.surface, theme.textPrimary, theme.border, theme.accent]);
  return (
    <>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.background}
        translucent={Platform.OS === 'android'}
      />
      <NavigationContainer ref={navigationRef} theme={navTheme} {...rest}>
        {children}
      </NavigationContainer>
    </>
  );
}

// Navigator component that uses settings
function AppNavigator() {
  const theme = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.background }
      }}
      initialRouteName="AuthLoading"
    >
      <Stack.Screen 
        name="AuthLoading" 
        component={AuthLoadingScreen} 
      />
      <Stack.Screen 
        name="FirstLoad" 
        component={FirstLoadScreen}
        options={{
          animation: 'none'
        }}
      />
      <Stack.Screen
        name="WelcomeSetup"
        component={WelcomeSetupScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="UserInfoSetup"
        component={UserInfoSetupScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="PermissionsSetup"
        component={PermissionsSetupScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen 
        name="PlanSelection"
        component={PlanSelectionScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          animation: 'none'
        }}
      />
      <Stack.Screen
        name="Camera"
        component={CameraScreenComponent}
        options={{
          presentation: 'card',
          // No animation — both entering and leaving Camera should be
          // instant. The previous slide_from_bottom added a perceptible
          // ~300ms delay on Done/swipe-down and forced the bottom nav
          // to mask itself for an animation that no longer plays.
          animation: 'none',
          animationDuration: 0,
          contentStyle: { backgroundColor: '#000' },
          orientation: 'all',
          autoHideHomeIndicator: false
        }}
      />
      <Stack.Screen 
        name="PhotoEditor" 
        component={PhotoEditorScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="Projects"
        component={ProjectsScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="PhotoDetail"
        component={PhotoDetailScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="SectionDetail"
        component={SectionDetailScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="Studio"
        component={StudioScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      {/* Photo-edit view of Studio. Same component, different route name so
          PersistentBottomNav can hide the tab bar here (route names are the
          only handle the nav has — params aren't visible to it). */}
      <Stack.Screen
        name="StudioDetail"
        component={StudioScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="StudioLayout"
        component={StudioLayoutScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="StudioLabels"
        component={StudioLabelsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="StudioNotes"
        component={StudioNotesScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="StudioBranding"
        component={StudioBrandingScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="StudioExport"
        component={StudioExportScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ProjectDetail"
        component={ProjectDetailScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="PhotoSetPreview"
        component={PhotoSetPreviewScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="ReportStyle"
        component={ReportStyleScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="CloudTeam"
        component={CloudTeamScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CloudSync"
        component={CloudSyncScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="TeamMembers"
        component={TeamMembersScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="HelpSupport"
        component={HelpSupportScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="IndustrySections"
        component={IndustrySectionsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="LabelsLanguage"
        component={LabelsLanguageScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Appearance"
        component={AppearanceScreen}
        options={{ animation: 'slide_from_right' }}
      />
      {/* Studio customize screens present as a half-height bottom
          sheet (iOS formSheet) instead of pushing a full screen, so the
          user stays in Studio context. Swipe-down dismisses. iOS-only
          sheet behavior; on Android these fall back to a slide-up
          modal animation. */}
      <Stack.Screen
        name="LabelCustomization"
        component={LabelCustomizationScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 22,
          // Keep the Studio photo behind the sheet fully lit so the
          // user can watch label / watermark / logo / metadata changes
          // apply live as they tweak controls. 'last' disables dimming
          // at every allowed detent.
          sheetLargestUndimmedDetentIndex: 'last',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="WatermarkCustomization"
        component={WatermarkCustomizationScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 22,
          // Keep the Studio photo behind the sheet fully lit so the
          // user can watch label / watermark / logo / metadata changes
          // apply live as they tweak controls. 'last' disables dimming
          // at every allowed detent.
          sheetLargestUndimmedDetentIndex: 'last',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="LogoCustomization"
        component={LogoCustomizationScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 22,
          // Keep the Studio photo behind the sheet fully lit so the
          // user can watch label / watermark / logo / metadata changes
          // apply live as they tweak controls. 'last' disables dimming
          // at every allowed detent.
          sheetLargestUndimmedDetentIndex: 'last',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="MetadataCustomization"
        component={MetadataCustomizationScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 22,
          // Keep the Studio photo behind the sheet fully lit so the
          // user can watch label / watermark / logo / metadata changes
          // apply live as they tweak controls. 'last' disables dimming
          // at every allowed detent.
          sheetLargestUndimmedDetentIndex: 'last',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="BrandingSettings"
        component={BrandingSettingsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      {/* Quick "pop-up" markup config sheet. formSheet presentation
          keeps the Studio photo visible behind, matching the Watermark /
          Metadata / Labels UX. From here the user taps "Enlarge to mark"
          to hand off to the full-screen MarkupEditor for actual drawing
          (with pinch-zoom). */}
      <Stack.Screen
        name="MarkupSheet"
        component={MarkupSheetScreen}
        options={{
          presentation: 'formSheet',
          animation: 'slide_from_bottom',
          sheetAllowedDetents: 'fitToContents',
          sheetGrabberVisible: true,
          sheetCornerRadius: 22,
          sheetLargestUndimmedDetentIndex: 'last',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="MarkupEditor"
        component={MarkupEditorScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="SharePreview"
        component={SharePreviewScreen}
        options={{ animation: 'slide_from_bottom', headerShown: false }}
      />
      <Stack.Screen
        name="Invite"
        component={InviteScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="Referral"
        component={ReferralScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="JoinTeam"
        component={JoinTeamScreen}
        options={{
          title: 'Join Team',
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="GoogleSignUp"
        component={GoogleSignUpScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="LabelLanguageSetup"
        component={LabelLanguageSetupScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="SectionLanguageSetup"
        component={SectionLanguageSetupScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="VisionCameraTest"
        component={VisionCameraTestComponent}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="AdminReferralLinks"
        component={AdminReferralScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="CRMRedeem"
        component={CRMRedeemScreen}
        options={{
          animation: 'slide_from_bottom',
          presentation: 'modal',
        }}
      />
      <Stack.Screen
        name="UploadPhotos"
        component={UploadPhotosScreen}
        options={{
          animation: 'slide_from_bottom'
        }}
      />
    </Stack.Navigator>
  );
}

// Linking configuration for deep links (OAuth redirect and invite links)
const linking = {
  prefixes: [
    'proofpix://',
    'https://proofpix.app',
    'https://www.proofpix.app',
    'https://steadfast-blessing-production.up.railway.app',
  ],
  config: {
    screens: {
      Invite: 'invite/:token',
      JoinTeam: {
        path: 'join',
        parse: {
          invite: (invite) => decodeURIComponent(invite),
        },
      },
      Referral: {
        path: 'referral/:code',
        parse: {
          code: (code) => code,
        },
      },
      // proofpix://connect?token=...&workspace=...
      // Hit when SF web/PWA's /integrations/proofpix/authorize
      // route mints a token and redirects. The CRMRedeem screen
      // pulls the token from the URL and calls the adapter; on
      // success it closes back to Settings. Same screen also
      // handles the SF-mobile-native handoff (if it ever ships)
      // with the same query-string shape.
      CRMRedeem: 'connect',
    },
  },
};

// Global upload indicator - shows on ALL screens when upload/labeling is active
function GlobalUploadIndicator({ navigationRef }) {
  const { uploadStatus } = useBackgroundUpload();
  const insets = useSafeAreaInsets();

  const hasActivity = uploadStatus.activeUploads.length > 0 || uploadStatus.queueLength > 0;
  if (!hasActivity) return null;

  return (
    <View style={{
      position: 'absolute',
      top: insets.top,
      left: 0,
      right: 0,
      zIndex: 9999,
    }}>
      <UploadIndicatorLine
        uploadStatus={uploadStatus}
        onPress={() => {
          navigationRef.current?.navigate('Gallery', { showUploadDetails: true });
        }}
      />
    </View>
  );
}

// Global function to trigger trial notification check (for use after plan selection)
let globalCheckTrialNotifications = null;

// Stream errors / rejections / tagged console.error to FixPrompt → Loki.
// Skipped if no key — no-op in dev / on profiles without the secret set.
//
// NOTE: must run synchronously at module load. FixPrompt patches console.warn
// at require()-time so the breadcrumb buffer catches startup logs (the
// `[BUNDLE] vNN` markers fire before this block runs but they get queued
// once the patch is active and flushed on the next batch). Wrapping in
// setTimeout was tried and lost the markers — they fired before the patch
// got installed.
try {
  const fixpromptKey = process.env.EXPO_PUBLIC_FIXPROMPT_KEY;
  if (fixpromptKey) {
    const { initFixPrompt } = require('@fixprompt/react-native');
    initFixPrompt({
      projectKey: fixpromptKey,
      source: process.env.EXPO_PUBLIC_FIXPROMPT_SOURCE || 'proofpix-native-prod',
      service: 'proofpix-native',
      app: 'proofpix-native',
      env: __DEV__ ? 'dev' : 'prod',
      release: Constants?.expoConfig?.version,
      // Capture tagged console.warn too. Default is error-only — that
      // missed all the [CRM]/[CRM-Adapter]/[ServiceFlow] diagnostics
      // (verified: 0 CRM lines in Loki across a full bulk-upload run).
      // captureTags below already gates which warns flow, so this just
      // adds warn-level events that already match a captured prefix.
      patchConsoleWarn: true,
      captureTags: [
        /^\[IAP\b/, /^\[Analytics\b/i, /^\[Firebase\b/i, /^\[ADMIN\b/,
        /^\[PROXY\b/, /^\[SETTINGS\b/, /^\[PhotoContext\b/, /^\[BackgroundUpload\b/i,
        /^\[errorLogger\b/, /^\[CAMDIAG\b/, /^\[Storage\b/, /^\[PHOTODEL\b/,
        /^\[BUNDLE\b/, /^\[Report\b/, /^\[ChromeBake\b/, /^\[ChromeBaker\b/,
        /^\[LabelPos\b/, /^\[CRM\b/, /^\[ServiceFlow\b/,
        /^\[EnterpriseContact\b/, /^\[HelpSupport\b/,
      ],
    });
  } else if (!__DEV__) {
    console.warn('[App] EXPO_PUBLIC_FIXPROMPT_KEY not set — Loki streaming disabled');
  }
} catch (e) {
  console.warn('[App] Failed to init FixPrompt:', e?.message);
}

// Local AsyncStorage capture for in-app log export. Chains under the SDK's
// global handlers so both Loki streaming and offline export keep working.
try {
  const { setupGlobalErrorHandler } = require('./src/services/errorLogger');
  setupGlobalErrorHandler();
} catch (e) {
  console.warn('[App] Failed to install error handler:', e?.message);
}

export default function App() {
  console.log('[App] App component rendering...');
  const navigationRef = useRef();
  const routeNameRef = useRef();
  const [currentRouteName, setCurrentRouteName] = useState(null);
  const [firebaseInitialized, setFirebaseInitialized] = useState(false);
  const [trialNotification, setTrialNotification] = useState(null);
  const [showTrialModal, setShowTrialModal] = useState(false);
  const [referralPrompt, setReferralPrompt] = useState(null);
  const [showReferralPrompt, setShowReferralPrompt] = useState(false);

  console.log('[App] Loading fonts...');
  const [fontsLoaded] = useFonts({
    Montserrat_700Bold,
    PlayfairDisplay_700Bold,
    RobotoMono_700Bold,
    Lato_700Bold,
    Poppins_600SemiBold,
    Oswald_600SemiBold,
    Alexandria_100Thin,
    Alexandria_200ExtraLight,
    Alexandria_300Light,
    Alexandria_400Regular,
    Alexandria_500Medium,
    Alexandria_600SemiBold,
    Alexandria_700Bold,
    Alexandria_800ExtraBold,
    Alexandria_900Black,
    Quicksand_300Light,
    Quicksand_400Regular,
    Quicksand_500Medium,
    Quicksand_600SemiBold,
    Quicksand_700Bold,
  });

  // Lock the app to portrait globally. CameraScreen re-enables free
  // rotation via useFocusEffect + unlockAsync() so users can capture
  // landscape photos, then re-locks portrait on blur.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    // Initialize Firebase and Analytics
    const initializeFirebase = async () => {
      try {
        if (!getApp || !getAnalytics || !setAnalyticsCollectionEnabled) {
          console.warn('[Firebase] Firebase modules not available - app needs to be rebuilt');
          setFirebaseInitialized(true);
          return;
        }

        // Check if Firebase is already initialized using modular API
        const apps = getApps();
        if (apps.length === 0) {
          console.log('[Firebase] No apps initialized, waiting for auto-init...');
        } else {
          const app = getApp();
          console.log('[Firebase] App already initialized:', app.name);
        }

        // Enable analytics collection ONLY for non-debug builds
        // (__DEV__ is true in React Native debug/dev builds)
        const enableAnalytics = !__DEV__;
        const analytics = getAnalytics();
        await setAnalyticsCollectionEnabled(analytics, enableAnalytics);
        setFirebaseInitialized(true);

        // Log app open event
        try {
          const { logAppOpen } = require('./src/utils/analytics');
          logAppOpen();
        } catch (e) { /* non-critical */ }

        // Build marker — confirms the installed binary contains the v2
        // subscription analytics chain (logTrialStarted, _classifyTransaction,
        // _logPurchaseAnalytics, persistent dedup). If this line is absent
        // from the device console, the binary on the device is older than
        // v1.5.11 and the rest of the debug logs will not appear either.
        console.log('[analytics-debug] build includes subscription analytics v2 (v1.5.12)');
      } catch (error) {
        console.error('[Firebase] Initialization error:', error);
        // Set as initialized anyway to not block the app
        setFirebaseInitialized(true);
      }

      // Initialize Meta SDK
      try {
        if (FBSettings) {
          FBSettings.setAutoLogAppEventsEnabled(true);
          FBSettings.setAdvertiserTrackingEnabled(true);
          console.log('[Meta] SDK initialized');
        }
      } catch (metaError) {
        console.warn('[Meta] Init error (non-critical):', metaError.message);
      }

      // Request App Tracking Transparency (iOS 14+)
      try {
        if (Platform.OS === 'ios') {
          const { requestTrackingPermissionsAsync } = require('expo-tracking-transparency');
          const { status } = await requestTrackingPermissionsAsync();
          console.log('[ATT] Tracking permission status:', status);
          if (FBSettings) {
            FBSettings.setAdvertiserTrackingEnabled(status === 'granted');
          }
        }
      } catch (attError) {
        console.log('[ATT] Permission request error (non-critical):', attError.message);
      }
    };

    // Listen for notification interactions (job reminders)
    let notificationResponseSub = null;
    let notificationReceivedSub = null;
    try {
      const Notifications = require('expo-notifications');
      const { logJobReminderOpened, logJobReminderTriggered } = require('./src/utils/analytics');

      notificationReceivedSub = Notifications.addNotificationReceivedListener((notification) => {
        const data = notification?.request?.content?.data;
        if (data?.type === 'job_reminder') {
          logJobReminderTriggered(data.reminderType || 'unknown');
        }
      });

      notificationResponseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response?.notification?.request?.content?.data;
        if (data?.type === 'job_reminder') {
          logJobReminderOpened();
        }
      });
    } catch (e) {
      // expo-notifications not available
    }

    // Validate and clear old label cache if version changed
    const initializeLabelCache = async () => {
      try {
        const { validateCacheVersion } = await import('./src/services/labelCacheService');
        await validateCacheVersion();
      } catch (error) {
        console.error('[App] Error validating label cache:', error);
      }
    };

    initializeFirebase();
    initializeLabelCache();

    // Check trial expiration on app startup
    checkTrialExpiration();

    // Check trial expiration when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        checkTrialExpiration();
        // Skip Day 0 on foreground check too (only show after plan selection)
        checkTrialNotifications(true);
        // Quietly probe whether the user should see the expiring-trial
        // referral nudge today. Service handles all gating (daily cap,
        // not subscribed, rewards available, days_remaining <= 2).
        maybeShowExpiringTrialReferralPrompt().catch(() => {});
      }
    });

    // Check for trial notifications on startup (only if trial is already active, not for new trials)
    // New trial welcome messages will be triggered after plan selection
    // Skip Day 0 welcome on startup - it should only show after user selects a plan
    setTimeout(async () => {
      try {
        // Check for pending notification first (set after plan selection)
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const pendingNotification = await AsyncStorage.getItem('@pending_trial_notification');
        if (pendingNotification) {
          await AsyncStorage.removeItem('@pending_trial_notification');
          const notification = JSON.parse(pendingNotification);
          setTrialNotification(notification);
          setShowTrialModal(true);
          return;
        }

        const { isTrialActive } = await import('./src/services/trialService');
        const active = await isTrialActive();
        // Only check notifications if trial is already active (not a brand new trial)
        // Skip Day 0 welcome message on startup
        if (active) {
          checkTrialNotifications(true); // Skip Day 0 on startup
          // Trial-ending referral nudge (gated by service; once/day max)
          maybeShowExpiringTrialReferralPrompt().catch(() => {});
        }
      } catch (error) {
        // Silent fail - trial status check is not critical for app functionality
        // Common error: LoadBundleFromServerRequestError (Firebase bundle not available)
        console.warn('[App] Could not check trial status:', error?.message || error);
      }
    }, 2000);

    return () => {
      subscription?.remove();
      notificationResponseSub?.remove();
      notificationReceivedSub?.remove();
    };
  }, []);

  // Check if trial has expired
  const checkTrialExpiration = async () => {
    try {
      const { isTrialActive, getTrialInfo } = await import('./src/services/trialService');
      const trialInfo = await getTrialInfo();
      const wasActive = trialInfo?.active === true;
      
      // This will automatically mark trial as inactive if expired
      const isActive = await isTrialActive();
      
      // If trial just expired (was active but now inactive), check for Day 30 notification
      if (wasActive && !isActive && trialInfo && trialInfo.plan) {
        // Trial just expired, check for Day 30 notification
        console.log('[App] Trial expired, checking for Day 30 notification');
        setTimeout(() => {
          checkTrialNotifications(true);
        }, 500);
      } else if (!isActive && trialInfo && trialInfo.plan) {
        // Trial is already expired, check if Day 30 notification should show
        console.log('[App] Trial already expired, checking for Day 30 notification');
        checkTrialNotifications(true);
      }
    } catch (error) {
      console.error('[App] Error checking trial expiration:', error);
    }
  };

  // Check for trial notifications to show
  const checkTrialNotifications = async (skipDay0 = false) => {
    try {
      const { getNotificationToShow } = await import('./src/services/trialNotificationService');
      const notification = await getNotificationToShow(skipDay0);
      if (notification) {
        setTrialNotification(notification);
        setShowTrialModal(true);
      }
    } catch (error) {
      console.error('[App] Error checking trial notifications:', error);
    }
  };

  // Expose function globally so other screens can trigger notification check
  useEffect(() => {
    globalCheckTrialNotifications = checkTrialNotifications;
    return () => {
      globalCheckTrialNotifications = null;
    };
  }, []);

  // Mount the referral prompt trigger so referralPromptService can fire
  // the modal from anywhere (report-share success path, foreground check,
  // etc.) without prop-drilling.
  useEffect(() => {
    registerReferralPromptTrigger((payload) => {
      setReferralPrompt(payload);
      setShowReferralPrompt(true);
    });
    return () => {
      unregisterReferralPromptTrigger();
    };
  }, []);

  const handleReferralPromptClose = async () => {
    setShowReferralPrompt(false);
    const variant = referralPrompt?.variant;
    if (variant === 'first_report') {
      await markFirstReportPromptDismissed();
    }
    setReferralPrompt(null);
  };

  const handleReferralPromptPrimary = async () => {
    const current = referralPrompt;
    setShowReferralPrompt(false);
    setReferralPrompt(null);
    if (current?.variant === 'first_report') {
      await markFirstReportPromptOpened();
    } else if (current?.variant === 'expiring_trial') {
      markExpiringTrialInviteClicked(current?.daysRemaining);
    }
    if (navigationRef.current) {
      navigationRef.current.navigate('Referral');
    }
  };

  const handleReferralPromptSecondary = async () => {
    const current = referralPrompt;
    setShowReferralPrompt(false);
    setReferralPrompt(null);
    if (current?.variant === 'expiring_trial') {
      markExpiringTrialUpgradeClicked(current?.daysRemaining);
      if (navigationRef.current) {
        navigationRef.current.navigate('PlanSelection', { mode: 'upgrade', trigger: 'expiring_trial' });
      }
    } else {
      // first_report — "Maybe Later" just dismisses
      await markFirstReportPromptDismissed();
    }
  };

  const handleTrialModalClose = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
  };

  const handleTrialUpgrade = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
    // Navigate to Settings screen for upgrade with plan modal
    if (navigationRef.current) {
      navigationRef.current.navigate('Settings', { showPlanModal: true });
    }
  };

  const handleTrialRefer = () => {
    setShowTrialModal(false);
    setTrialNotification(null);
    // Navigate to Referral screen
    if (navigationRef.current) {
      navigationRef.current.navigate('Referral');
    }
  };

  const handleTrialCTA = async (notification) => {
    setShowTrialModal(false);
    setTrialNotification(null);
    const nav = navigationRef.current;
    if (!nav) return;

    // New schema — notification carries a specific action key. Route to the
    // matching destination. Fall back to legacy key-based scroll for any
    // pre-migration entries that don't carry an `action`.
    const action = notification?.action;

    switch (action) {
      case 'create_project':
        // Day 0 — Welcome → land on Projects so user can tap "+ New Project".
        nav.navigate('Projects', { openCreate: true });
        return;
      case 'camera':
        // Day 1 — Capture
        nav.navigate('Camera');
        return;
      case 'create_report':
        // Day 2 — First Report → Projects (user picks a project to add a report to)
        nav.navigate('Projects', { openCreateReport: true });
        return;
      case 'branding':
        // Day 3 — Branding → Settings, scroll to watermark/brand section
        nav.navigate('Settings', { scrollToWatermark: true });
        return;
      case 'cloud':
        // Day 4 — Cloud Storage → Settings, scroll to cloud sync section
        nav.navigate('Settings', { scrollToCloudSync: true });
        return;
      case 'referral':
        // Day 5 / Day 6 — referral
        nav.navigate('Referral');
        return;
      case 'paywall':
        // Day 5 / Day 6 / Day 7+ — upgrade
        nav.navigate('PlanSelection', { mode: 'upgrade', trigger: 'trial_notification' });
        return;
      case 'restore':
        // Day 7+ — Restore Purchase. Routes to PlanSelection so the user
        // can tap the existing Restore Purchases button there.
        nav.navigate('PlanSelection', { mode: 'upgrade', trigger: 'restore_purchase' });
        return;
      default:
        // Legacy fallback for any unmigrated notifications.
        // eslint-disable-next-line no-case-declarations
        const scrollParam = {};
        if (notification?.key === 'day7_10') {
          scrollParam.scrollToWatermark = true;
        } else if (notification?.key === 'day15') {
          scrollParam.scrollToCloudSync = true;
        } else if (notification?.key === 'day22_24') {
          scrollParam.scrollToAccountData = true;
        }
        nav.navigate('Settings', scrollParam);
        return;
    }
  };

  // Keep the native splash screen visible until AuthLoadingScreen signals it's
  // ready to navigate (so users see one continuous splash, not two).
  // AuthLoadingScreen calls SplashScreen.hideAsync() right before navigating.
  useEffect(() => {
    if (Platform.OS === 'android') {
      if (!fontsLoaded) {
        NavigationBar.setVisibilityAsync('hidden');
        NavigationBar.setBehaviorAsync('overlay-swipe');
      } else {
        NavigationBar.setVisibilityAsync('visible');
      }
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    // Native splash screen is still visible, render nothing
    return null;
  }

  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <SafeAreaProvider>
          <SettingsProvider>
            <AdminProvider>
              <PhotoProvider>
              {/* Pulls SF jobs into the local project list on app
                  open + foreground. No-op when no CRM is connected. */}
              <ServiceFlowSyncTrigger />
              <ThemedNavigationContainer
                navigationRef={navigationRef}
                linking={linking}
                fallback={null}
                onReady={() => {
                  const initial = navigationRef.current.getCurrentRoute().name;
                  routeNameRef.current = initial;
                  setCurrentRouteName(initial);

                  // Universal Links launched directly into JoinTeam /
                  // Invite / Referral / CRMRedeem bypass AuthLoadingScreen's
                  // splash-hide code, leaving the yellow native splash
                  // visible forever. Hide unconditionally here — this
                  // fires once when navigation is ready regardless of
                  // which route resolved. AuthLoadingScreen's own
                  // hideAsync calls become no-ops (idempotent).
                  if (initial !== 'AuthLoading') {
                    SplashScreen.hideAsync().catch(() => {});
                  }
                }}
                onStateChange={async () => {
                  const previousRouteName = routeNameRef.current;
                  const currentRouteName = navigationRef.current.getCurrentRoute().name;
                  setCurrentRouteName(currentRouteName);

                  if (previousRouteName !== currentRouteName && firebaseInitialized) {
                    // Manual screen tracking with clean snake_case names
                    // Replaces default RNSScreen / UIViewController names
                    const SCREEN_NAME_MAP = {
                      AuthLoading: 'auth_loading',
                      FirstLoad: 'first_load',
                      WelcomeSetup: 'onboarding_welcome',
                      UserInfoSetup: 'onboarding_user_info',
                      PermissionsSetup: 'onboarding_permissions',
                      PlanSelection: 'paywall',
                      Home: 'home',
                      Camera: 'camera',
                      PhotoEditor: 'editor',
                      Gallery: 'gallery',
                      Projects: 'projects',
                      PhotoDetail: 'photo_detail',
                      Settings: 'settings',
                      LabelCustomization: 'label_customization',
                      WatermarkCustomization: 'watermark_customization',
                      Invite: 'invite',
                      Referral: 'referral',
                      JoinTeam: 'join_team',
                      GoogleSignUp: 'google_sign_up',
                      LabelLanguageSetup: 'label_language_setup',
                      SectionLanguageSetup: 'section_language_setup',
                      AdminReferralLinks: 'admin_referral_links',
                      UploadPhotos: 'upload_photos',
                    };
                    const cleanName = SCREEN_NAME_MAP[currentRouteName] || currentRouteName.toLowerCase();
                    try {
                      const { logScreenView } = require('./src/utils/analytics');
                      logScreenView(cleanName);
                    } catch (error) {
                      console.error('[Analytics] Error logging screen view:', error);
                    }

                    // Check for trial welcome notification when navigating to screens after plan selection
                    if (currentRouteName === 'LabelLanguageSetup' || currentRouteName === 'GoogleSignUp') {
                      // Check for pending notification first
                      setTimeout(async () => {
                        try {
                          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
                          const pendingNotification = await AsyncStorage.getItem('@pending_trial_notification');
                          if (pendingNotification) {
                            await AsyncStorage.removeItem('@pending_trial_notification');
                            const notification = JSON.parse(pendingNotification);
                            setTrialNotification(notification);
                            setShowTrialModal(true);
                            return;
                          }

                          // Fallback: Check if trial was just started (within last 5 minutes)
                          const { getTrialInfo, isTrialActive } = await import('./src/services/trialService');
                          const trialActive = await isTrialActive();
                          if (trialActive) {
                            const trialInfo = await getTrialInfo();
                            if (trialInfo) {
                              const startDate = new Date(trialInfo.startDate).getTime();
                              const now = new Date().getTime();
                              const minutesSinceStart = (now - startDate) / (1000 * 60);
                              
                              // If trial started within last 5 minutes, show welcome notification
                              if (minutesSinceStart < 5) {
                                checkTrialNotifications(false); // Don't skip Day 0
                              }
                            }
                          }
                        } catch (error) {
                          console.error('[App] Error checking trial welcome:', error);
                        }
                      }, 1500);
                    }
                  }

                  // Save the current route name for next comparison
                  routeNameRef.current = currentRouteName;
                }}
              >
                <UiOverlayProvider>
                  <AppNavigator />
                  <PersistentBottomNav
                    currentRoute={currentRouteName}
                    navigationRef={navigationRef}
                  />
                </UiOverlayProvider>
              </ThemedNavigationContainer>
              {/* Global background components - stay mounted regardless of navigation */}
              <GlobalBackgroundLabelPreparation />
              <GlobalBackgroundCombinedPhotoCreator />
              <GlobalBackgroundChromeBaker />
              {/* Global upload progress indicator - shows on ALL screens */}
              <GlobalUploadIndicator navigationRef={navigationRef} />
              {/* Global bake progress banner — shows a non-blocking
                  "Preparing X / N photos…" pill while chrome bakes
                  are in flight (share flows). pointerEvents="none"
                  so the user can keep using the app. */}
              <GlobalBakeProgressBanner />
              {/* Trial Notification Modal — must render INSIDE
                  SettingsProvider so useTheme() sees the real theme
                  (falls back to lightTheme when outside → always
                  white regardless of dark mode). */}
              <TrialNotificationModal
                visible={showTrialModal}
                notification={trialNotification}
                onClose={handleTrialModalClose}
                onUpgrade={handleTrialUpgrade}
                onRefer={handleTrialRefer}
                onCTA={handleTrialCTA}
              />

              {/* Referral Prompt Modal — same reason, inside provider. */}
              <ReferralPromptModal
                visible={showReferralPrompt}
                prompt={referralPrompt}
                onClose={handleReferralPromptClose}
                onPrimary={handleReferralPromptPrimary}
                onSecondary={handleReferralPromptSecondary}
              />
            </PhotoProvider>
          </AdminProvider>
        </SettingsProvider>
        </SafeAreaProvider>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({});
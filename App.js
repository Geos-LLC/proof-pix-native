import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, AppState, LogBox, Platform, Image } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';

// Keep the native splash screen visible until we explicitly hide it
SplashScreen.preventAutoHideAsync().catch(() => {});

// Log app startup
console.log('[App] ====== APP STARTING ======');
console.log('[App] Platform detected, beginning imports...');
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { PhotoProvider } from './src/context/PhotoContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AdminProvider } from './src/context/AdminContext';
import TrialNotificationModal from './src/components/TrialNotificationModal';
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
import ContactUsScreen from './src/screens/ContactUsScreen';
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
import MetadataCustomizationScreen from './src/screens/MetadataCustomizationScreen';
import MarkupEditorScreen from './src/screens/MarkupEditorScreen';
import {
  StudioLayoutScreen,
  StudioLabelsScreen,
  StudioNotesScreen,
  StudioBrandingScreen,
  StudioExportScreen,
} from './src/screens/StudioToolScreens';
import PersistentBottomNav from './src/components/PersistentBottomNav';
import ProjectDetailScreen from './src/screens/ProjectDetailScreen';
import PhotoSetPreviewScreen from './src/screens/PhotoSetPreviewScreen';
import LabelCustomizationScreen from './src/screens/LabelCustomizationScreen';
import WatermarkCustomizationScreen from './src/screens/WatermarkCustomizationScreen';
import FirstLoadScreen from './src/screens/FirstLoadScreen';
import PlanSelectionScreen from './src/screens/PlanSelectionScreen';
import InviteScreen from './src/screens/InviteScreen';
import JoinTeamScreen from './src/screens/JoinTeamScreen';
import ReferralScreen from './src/screens/ReferralScreen';
import AdminReferralScreen from './src/screens/AdminReferralScreen';
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
import UploadIndicatorLine from './src/components/UploadIndicatorLine';
import { useBackgroundUpload } from './src/hooks/useBackgroundUpload';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

console.log('[App] All imports completed successfully');

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

// Navigator component that uses settings
function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F2C31B' }
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
        name="ContactUs"
        component={ContactUsScreen}
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
      <Stack.Screen
        name="LabelCustomization"
        component={LabelCustomizationScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="WatermarkCustomization"
        component={WatermarkCustomizationScreen}
        options={{
          animation: 'slide_from_right'
        }}
      />
      <Stack.Screen
        name="LogoCustomization"
        component={LogoCustomizationScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="MetadataCustomization"
        component={MetadataCustomizationScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="MarkupEditor"
        component={MarkupEditorScreen}
        options={{ animation: 'slide_from_bottom' }}
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

// Install the global JS error + unhandled-rejection handler as early as
// possible — before any app code runs. Captures everything to AsyncStorage
// for in-app export and streams to LogHub/Grafana.
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

  const handleTrialCTA = (notification) => {
    setShowTrialModal(false);
    // Determine which section to scroll to based on notification key
    let scrollParam = {};
    if (notification?.key === 'day7_10') {
      scrollParam = { scrollToWatermark: true };
    } else if (notification?.key === 'day15') {
      scrollParam = { scrollToCloudSync: true };
    } else if (notification?.key === 'day22_24') {
      scrollParam = { scrollToAccountData: true };
    }
    // Navigate to Settings screen with scroll target
    if (navigationRef.current) {
      navigationRef.current.navigate('Settings', scrollParam);
    }
    setTrialNotification(null);
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
              <NavigationContainer
                ref={navigationRef}
                linking={linking}
                fallback={null}
                onReady={() => {
                  const initial = navigationRef.current.getCurrentRoute().name;
                  routeNameRef.current = initial;
                  setCurrentRouteName(initial);
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
                      ContactUs: 'contact_us',
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
                <AppNavigator />
                <PersistentBottomNav
                  currentRoute={currentRouteName}
                  navigationRef={navigationRef}
                />
              </NavigationContainer>
              {/* Global background components - stay mounted regardless of navigation */}
              <GlobalBackgroundLabelPreparation />
              <GlobalBackgroundCombinedPhotoCreator />
              {/* Global upload progress indicator - shows on ALL screens */}
              <GlobalUploadIndicator navigationRef={navigationRef} />
            </PhotoProvider>
          </AdminProvider>
        </SettingsProvider>
        
          {/* Trial Notification Modal */}
          <TrialNotificationModal
            visible={showTrialModal}
            notification={trialNotification}
            onClose={handleTrialModalClose}
            onUpgrade={handleTrialUpgrade}
            onRefer={handleTrialRefer}
            onCTA={handleTrialCTA}
          />
        </SafeAreaProvider>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({});
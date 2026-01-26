import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, AppState, LogBox } from 'react-native';

// Log app startup
console.log('[App] ====== APP STARTING ======');
console.log('[App] Platform detected, beginning imports...');
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
console.log('[App] Importing Firebase...');
let getApp, getApps, getAnalytics, logEvent, setAnalyticsCollectionEnabled;
try {
  const appModule = require('@react-native-firebase/app');
  const analyticsModule = require('@react-native-firebase/analytics');
  // Use modular API instead of default export
  getApp = appModule.getApp;
  getApps = appModule.getApps;
  getAnalytics = analyticsModule.getAnalytics;
  logEvent = analyticsModule.logEvent;
  setAnalyticsCollectionEnabled = analyticsModule.setAnalyticsCollectionEnabled;
  console.log('[App] Firebase imported successfully');
} catch (error) {
  console.warn('[App] Firebase native modules not available:', error.message);
  console.warn('[App] This usually means the app needs to be rebuilt with: npx expo run:android');
}

console.log('[App] Initializing i18n...');
import './src/i18n/i18n'; // Initialize i18n
console.log('[App] i18n initialized');

// Screens
import HomeScreen from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import PhotoEditorScreen from './src/screens/PhotoEditorScreen';
import GalleryScreen from './src/screens/GalleryScreen';
import PhotoDetailScreen from './src/screens/PhotoDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ContactUsScreen from './src/screens/ContactUsScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import LabelCustomizationScreen from './src/screens/LabelCustomizationScreen';
import WatermarkCustomizationScreen from './src/screens/WatermarkCustomizationScreen';
import FirstLoadScreen from './src/screens/FirstLoadScreen';
import PlanSelectionScreen from './src/screens/PlanSelectionScreen';
import InviteScreen from './src/screens/InviteScreen';
import JoinTeamScreen from './src/screens/JoinTeamScreen';
import ReferralScreen from './src/screens/ReferralScreen';
import GoogleSignUpScreen from './src/screens/GoogleSignUpScreen';
import LabelLanguageSetupScreen from './src/screens/LabelLanguageSetupScreen';
import SectionLanguageSetupScreen from './src/screens/SectionLanguageSetupScreen';
import AuthLoadingScreen from './src/screens/AuthLoadingScreen';
import VisionCameraTest from './src/screens/VisionCameraTest';
import WelcomeSetupScreen from './src/screens/WelcomeSetupScreen';
import UserInfoSetupScreen from './src/screens/UserInfoSetupScreen';
import PermissionsSetupScreen from './src/screens/PermissionsSetupScreen';
import GlobalBackgroundLabelPreparation from './src/components/GlobalBackgroundLabelPreparation';
import GlobalBackgroundCombinedPhotoCreator from './src/components/GlobalBackgroundCombinedPhotoCreator';

console.log('[App] All imports completed successfully');

const Stack = createNativeStackNavigator();

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
        contentStyle: { backgroundColor: '#000' }
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
        component={CameraScreen}
        options={{
          presentation: 'card',
          animation: 'slide_from_bottom',
          animationDuration: 300,
          contentStyle: { backgroundColor: '#000' },
          orientation: 'all',
          autoHideHomeIndicator: false
        }}
      />
      <Stack.Screen 
        name="PhotoEditor" 
        component={PhotoEditorScreen}
        options={{
          presentation: 'modal',
          animation: 'fade'
        }}
      />
      <Stack.Screen
        name="Gallery"
        component={GalleryScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          animationDuration: 300
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
          presentation: 'modal',
          animation: 'fade'
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
        name="ContactUs"
        component={ContactUsScreen}
        options={{
          animation: 'slide_from_right'
        }}
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
        name="Invite"
        component={InviteScreen}
        options={{
          presentation: 'modal',
          animation: 'fade'
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
        component={VisionCameraTest}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          contentStyle: { backgroundColor: '#000' }
        }}
      />
    </Stack.Navigator>
  );
}

// Linking configuration for deep links (OAuth redirect and invite links)
const linking = {
  prefixes: ['proofpix://'],
  config: {
    screens: {
      Invite: 'invite/:token',
      JoinTeam: {
        path: 'join',
        parse: {
          invite: (invite) => decodeURIComponent(invite),
        },
      },
      Referral: 'referral',
      ReferralWithCode: {
        path: 'referral/:code',
        parse: {
          code: (code) => code,
        },
      },
    },
  },
};

// Global function to trigger trial notification check (for use after plan selection)
let globalCheckTrialNotifications = null;

export default function App() {
  console.log('[App] App component rendering...');
  const navigationRef = useRef();
  const routeNameRef = useRef();
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
      } catch (error) {
        console.error('[Firebase] Initialization error:', error);
        // Set as initialized anyway to not block the app
        setFirebaseInitialized(true);
      }
    };

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

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.loadingText}>Loading assets…</Text>
      </View>
    );
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
                fallback={<Text>Loading...</Text>}
                onReady={() => {
                  routeNameRef.current = navigationRef.current.getCurrentRoute().name;
                }}
                onStateChange={async () => {
                  const previousRouteName = routeNameRef.current;
                  const currentRouteName = navigationRef.current.getCurrentRoute().name;

                  if (previousRouteName !== currentRouteName && firebaseInitialized && getAnalytics && logEvent) {
                    // Log screen view to Firebase Analytics
                    try {
                      const analytics = getAnalytics();
                      await logEvent(analytics, 'screen_view', {
                        screen_name: currentRouteName,
                        screen_class: currentRouteName,
                      });
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
              </NavigationContainer>
              {/* Global background components - stay mounted regardless of navigation */}
              <GlobalBackgroundLabelPreparation />
              <GlobalBackgroundCombinedPhotoCreator />
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

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
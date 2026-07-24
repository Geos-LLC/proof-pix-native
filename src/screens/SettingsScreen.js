import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal as RNModal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TouchableWithoutFeedback,
  Dimensions,
  PanResponder,
  Animated,
  FlatList,
  Share,
  InteractionManager,
  Linking,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { useTheme } from '../hooks/useTheme';
import { COLORS, getLabelPositions } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { RoomIcon } from '../utils/roomIcons';
import RoomEditor from '../components/RoomEditor';
import QualificationPromptModal from '../components/QualificationPromptModal';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import googleDriveService from '../services/googleDriveService';
import dropboxAuthService from '../services/dropboxAuthService';
import dropboxService from '../services/dropboxService';
import iCloudService from '../services/iCloudService';
import InviteManager from '../components/InviteManager';
import {
  getOrCreateReferralCode,
  getReferralInfo,
  acceptReferral,
  getReferralStatsFromServer,
  getUserId,
} from '../services/referralService';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import proxyService from '../services/proxyService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSecure } from '../services/secureStorageService';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import { generateInviteLink, generateShareContent, generateInviteCode } from '../utils/inviteLinkGenerator';
import Modal from 'react-native-modal';
import ColorPicker from 'react-native-wheel-color-picker';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import { isTrialActive, getTrialDaysRemaining, getTrialPlan, getTrialInfo } from '../services/trialService';
import * as TrialTestUtils from '../utils/trialTestUtils';
import { generateInviteToken } from '../utils/tokens';
import {
  logLanguageChange,
  logTeamInvitesCreated,
  logCloudAccountConnection,
  logFeatureGateShown,
  logFeatureGateAction,
  logAdminReferralConversion,
  logSubscriptionRestored,
  logEvent,
} from '../utils/analytics';
import { IAP_PRODUCTS, purchaseProduct, purchaseOrUpgrade, restorePurchases, clearPendingTransactions, productIdToPlan, hasActiveIAPSubscription, openManageSubscriptions, getAvailablePurchases, computeEntitlements, diagnoseIAPState, presentRedeemCode } from '../services/iapService';
import useSubscriptionPrices from '../hooks/useSubscriptionPrices';
import * as Application from 'expo-application';
import * as ExpoLocation from 'expo-location';
import * as Updates from 'expo-updates';
import * as Sharing from 'expo-sharing';
import { exportErrorLogs, getErrorStats, clearErrorLogs } from '../services/errorLogger';
import { isRTLLanguage } from '../hooks/useRTL';
import { LOCATIONS, getLocationName } from '../config/locations';

const getFontOptions = (t) => [
  {
    key: 'alexandria',
    label: 'Alexandria',
    description: t('labelCustomization.fontModal.systemDefaultDescription'),
    fontFamily: 'Alexandria_400Regular',
  },
];

const getLabelSizeOptions = (t) => [
  { key: 'small', label: t('labelCustomization.small') },
  { key: 'medium', label: t('labelCustomization.default') },
  { key: 'large', label: t('labelCustomization.large') },
];

// Static map so Metro can bundle all flag assets (same as FirstLoadScreen).
const FLAG_IMAGES = {
  en: require('../../assets/flags/usa.png'),
  es: require('../../assets/flags/spain.png'),
  fr: require('../../assets/flags/france.png'),
  de: require('../../assets/flags/germany.png'),
  ru: require('../../assets/flags/russia.png'),
  be: require('../../assets/flags/belarus.png'),
  zh: require('../../assets/flags/china.png'),
  tl: require('../../assets/flags/philipines.png'),
  ar: require('../../assets/flags/saudi.png'),
  ko: require('../../assets/flags/korea.png'),
  pt: require('../../assets/flags/portugal.png'),
  uk: require('../../assets/flags/ukraine.png'),
  vi: require('../../assets/flags/vietnam.png'),
};

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];

const LABEL_SIZE_STYLE_MAP = {
  small: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 70,
  },
  medium: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 88,
  },
  large: {
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 104,
  },
};
const GradientView = ({ colors, start, end, style, children, fallbackColor }) => {
  if (LinearGradient && typeof LinearGradient === 'function') {
    return (
      <LinearGradient colors={colors} start={start} end={end} style={style}>
        {children}
      </LinearGradient>
    );
  }
  
  return (
    <View style={[style, { backgroundColor: fallbackColor || colors[colors.length - 1] }]}>
      {children}
    </View>
  );
};
const getLabelCornerOptions = (t) => [
  { key: 'rounded', label: t('labelCustomization.cornerOptions.rounded') },
  { key: 'square', label: t('labelCustomization.cornerOptions.straight') },
];

const DEFAULT_LABEL_BACKGROUND = '#FFD700';
const DEFAULT_LABEL_TEXT = '#000000';
const RGB_COLOR_REGEX = /^RGB\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;

function normalizeHex(value) {
  if (!value) return null;
  let trimmed = String(value).trim().toUpperCase();

  if (/^[0-9A-F]{6}$/.test(trimmed)) {
    trimmed = `#${trimmed}`;
  } else if (/^[0-9A-F]{3}$/.test(trimmed)) {
    trimmed = `#${trimmed}`;
  }

  if (/^#[0-9A-F]{4}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1, 4).split('');
    trimmed = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9A-F]{4}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(0, 3).split('');
    trimmed = `#${r}${r}${g}${g}${b}${b}`;
  }

  if (/^#[0-9A-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^#[0-9A-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  const rgbMatch = trimmed.match(RGB_COLOR_REGEX);
  if (rgbMatch) {
    const [r, g, b] = rgbMatch.slice(1).map((segment) => {
      const numeric = parseInt(segment, 10);
      return Math.min(255, Math.max(0, numeric));
    });
    return `#${[r, g, b]
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
  }

  return null;
}

function hsvToHex({ h = 0, s = 0, v = 0 }) {
  const normalizedH = ((h % 360) + 360) % 360;
  const normalizedS = Math.min(Math.max(s, 0), 100) / 100;
  const normalizedV = Math.min(Math.max(v, 0), 100) / 100;

  const c = normalizedV * normalizedS;
  const x = c * (1 - Math.abs(((normalizedH / 60) % 2) - 1));
  const m = normalizedV - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (normalizedH < 60) {
    rPrime = c;
    gPrime = x;
  } else if (normalizedH < 120) {
    rPrime = x;
    gPrime = c;
  } else if (normalizedH < 180) {
    gPrime = c;
    bPrime = x;
  } else if (normalizedH < 240) {
    gPrime = x;
    bPrime = c;
  } else if (normalizedH < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  const r = Math.round((rPrime + m) * 255);
  const g = Math.round((gPrime + m) * 255);
  const b = Math.round((bPrime + m) * 255);

  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export default function SettingsScreen({ navigation, route }) {
  const {
    showLabels,
    toggleLabels,
    showWatermark,
    customWatermarkEnabled,
    watermarkText,
    watermarkLink,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkFontFamily,
    toggleWatermark,
    updateShowWatermark,
    updateWatermarkText,
    updateWatermarkLink,
    updateWatermarkColor,
    updateWatermarkOpacity,
    updateWatermarkPosition,
    updateWatermarkFontFamily,
    shouldShowWatermark,
    labelBackgroundColor,
    labelTextColor,
    labelFontFamily,
    labelSize,
    labelCornerStyle,
    beforeLabelPosition,
    afterLabelPosition,
    combinedLabelPosition,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelSize,
    updateLabelCornerStyle,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelFontFamily,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateCombinedLabelPosition,
    updateLabelMarginVertical,
    updateLabelMarginHorizontal,
    userName,
    location,
    updateUserInfo,
    useFolderStructure,
    toggleUseFolderStructure,
    enabledFolders,
    updateEnabledFolders,
    splitPhotosByDate,
    updateSplitPhotosByDate,
    resetUserData,
    customRooms,
    saveCustomRooms,
    getRooms,
    resetCustomRooms,
    userPlan,
    updateUserPlan,
    labelLanguage,
    updateLabelLanguage,
    sectionLanguage,
    updateSectionLanguage,
    cleaningServiceEnabled,
    toggleCleaningServiceEnabled,
    themeMode,
    setThemeMode,
  } = useSettings();

  const { canUse, exceedsLimit, getLimit, effectivePlan } = useFeaturePermissions();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Rebuilt on theme change. The definition lives at module scope
  // (`makeStyles`) so mounting overhead is a single call. See the
  // module-scope comment above the factory for the historical bug.
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Memoize translated options
  const FONT_OPTIONS = useMemo(() => getFontOptions(t), [t]);
  const LABEL_SIZE_OPTIONS = useMemo(() => getLabelSizeOptions(t), [t]);
  const LABEL_CORNER_OPTIONS = useMemo(() => getLabelCornerOptions(t), [t]);

  const [showPlanSelection, setShowPlanSelection] = useState(false);
  const [showMultipleAccountsModal, setShowMultipleAccountsModal] = useState(false);
  const [showTestToolsModal, setShowTestToolsModal] = useState(false);
  const [showManageTeamModal, setShowManageTeamModal] = useState(false);
  const [showSwitchAccountModal, setShowSwitchAccountModal] = useState(false);
  const [pendingAccountType, setPendingAccountType] = useState(null);
  const [teamMembersList, setTeamMembersList] = useState([]);
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState('');
  const [isTestingInvite, setIsTestingInvite] = useState(false);
  const [showTestNameInput, setShowTestNameInput] = useState(false);
  const [testMemberName, setTestMemberName] = useState('');
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [additionalMembersCount, setAdditionalMembersCount] = useState(1);
  const [globalTeamMemberCount, setGlobalTeamMemberCount] = useState(0);
  
  // Removed verbose test modal logging used during debugging
  const [currentTestToken, setCurrentTestToken] = useState(null);
  const [trialActive, setTrialActive] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState(0);
  const [trialPlan, setTrialPlan] = useState(null);
  const [trialDuration, setTrialDuration] = useState(15);
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState(null);
  const [draftColor, setDraftColor] = useState(labelBackgroundColor);
  const [colorInput, setColorInput] = useState(labelBackgroundColor?.toUpperCase() || '');
  const [hexModalVisible, setHexModalVisible] = useState(false);
  const [hexModalValue, setHexModalValue] = useState(labelBackgroundColor?.toUpperCase() || '');
  const [hexModalError, setHexModalError] = useState(null);
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [watermarkFontModalVisible, setWatermarkFontModalVisible] = useState(false);
  const [colorPickerKey, setColorPickerKey] = useState(0);
  const [watermarkOpacityPreview, setWatermarkOpacityPreview] = useState(
    typeof watermarkOpacity === 'number' ? watermarkOpacity : 0.5
  );
  const [devToolsUnlocked, setDevToolsUnlocked] = useState(false);

  const [rooms, setRooms] = useState(() => getRooms());
  const [currentRoom, setCurrentRoom] = useState(rooms.length > 0 ? rooms[0].id : null);

  // Removed Add Member modal visibility debug logging

  useEffect(() => {
    const newRooms = getRooms();
    setRooms(newRooms);
    if (!currentRoom || !newRooms.some(r => r.id === currentRoom)) {
      setCurrentRoom(newRooms.length > 0 ? newRooms[0].id : null);
    }
  }, [customRooms]);

  // Get circular room order with current room in center
  const getCircularRooms = () => {
    if (!currentRoom) return [];
    const currentIndex = rooms.findIndex(r => r.id === currentRoom);
    if (currentIndex === -1) return [];

    const result = [];
    
    // Show 3 items before, current, and 3 items after (total 7 visible)
    for (let i = -3; i <= 3; i++) {
      let index = (currentIndex + i + rooms.length) % rooms.length;
      result.push({ ...rooms[index], offset: i });
    }
    
    return result;
  };

  const circularRooms = getCircularRooms();

  // Keep a ref of the current room so the pan responder always has fresh state
  const currentRoomRef = useRef(currentRoom);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  const devTapCountRef = useRef(0);
  const devTapTimeoutRef = useRef(null);

  const handleTitleTap = useCallback(() => {
    // Enable secret tap gesture (works in both dev and production for flexibility)
    
    // If already unlocked, no need to count further taps
    if (devToolsUnlocked) {
      return;
    }

    // Clear any existing timeout
    if (devTapTimeoutRef.current) {
      clearTimeout(devTapTimeoutRef.current);
    }

    // Increment tap count
    devTapCountRef.current += 1;
    console.log(`[DEV] Tap count: ${devTapCountRef.current}/8`);

    // If we've reached 8 taps, unlock developer tools
    if (devTapCountRef.current >= 8) {
      devTapCountRef.current = 0;
      setDevToolsUnlocked(true);
      
      // Store in AsyncStorage so it persists across app restarts
      AsyncStorage.setItem('@dev_tools_unlocked', 'true').catch(() => {});
      
      if (devTapTimeoutRef.current) {
        clearTimeout(devTapTimeoutRef.current);
        devTapTimeoutRef.current = null;
      }
      
      try {
        Alert.alert('Developer Tools', 'Test tools have been unlocked.');
      } catch (e) {
        // Alert may fail in some edge cases; not critical
      }
    } else {
      // Reset counter after 2 seconds of no taps
      devTapTimeoutRef.current = setTimeout(() => {
        console.log('[DEV] Tap timeout - resetting counter');
        devTapCountRef.current = 0;
        devTapTimeoutRef.current = null;
      }, 2000);
    }
  }, [devToolsUnlocked]);

  // Load persisted developer mode state on mount
  useEffect(() => {
    AsyncStorage.getItem('@dev_tools_unlocked')
      .then((value) => {
        if (value === 'true') {
          setDevToolsUnlocked(true);
        }
      })
      .catch(() => {});
    
    // Cleanup timeout on unmount
    return () => {
      if (devTapTimeoutRef.current) {
        clearTimeout(devTapTimeoutRef.current);
      }
    };
  }, []);

  // Horizontal swipe between rooms, similar to HomeScreen
  const roomPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Always capture touches that start on the tabs; we decide later if swipe is big enough
        onStartShouldSetPanResponder: () => {
          console.log('[SettingsScroller] onStartShouldSetPanResponder: true');
          return true;
        },
        onMoveShouldSetPanResponder: () => true,
        onPanResponderRelease: (evt, gestureState) => {
          const swipeThreshold = 20;
          console.log('[SettingsScroller] onPanResponderRelease', {
            dx: gestureState.dx,
            dy: gestureState.dy,
            swipeThreshold,
          });

          if (!rooms || rooms.length === 0) return;

          const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
          if (currentIndex === -1) return;

          if (gestureState.dx > swipeThreshold) {
            // Swipe right -> previous room
            const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
            console.log('[SettingsScroller] swipe right -> previous room', {
              currentIndex,
              newIndex,
              currentRoomId: currentRoomRef.current,
              newRoomId: rooms[newIndex]?.id,
            });
            setCurrentRoom(rooms[newIndex].id);
          } else if (gestureState.dx < -swipeThreshold) {
            // Swipe left -> next room
            const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
            console.log('[SettingsScroller] swipe left -> next room', {
              currentIndex,
              newIndex,
              currentRoomId: currentRoomRef.current,
              newRoomId: rooms[newIndex]?.id,
            });
            setCurrentRoom(rooms[newIndex].id);
          } else {
            console.log('[SettingsScroller] swipe too small, no room change', {
              currentIndex,
              currentRoomId: currentRoomRef.current,
            });
          }
        },
      }),
    [rooms]
  );

  const renderRoomTabs = () => {
    // Get first 5 rooms for display
    const displayRooms = rooms.slice(0, 5);
    
    return (
      <View style={styles.roomListContainer}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomListScrollContent}
        >
          {displayRooms.map((room, index) => {
            const isActive = currentRoom === room.id;
            // Built-in rooms ship with a bundled PNG (`image`). Industry-
            // seeded and user-added rooms only have an emoji `icon`. Render
            // whichever the room actually carries; fall back to a generic
            // folder emoji if neither is set.
            const hasImage = !!room.image;
            return (
              <TouchableOpacity
                key={`${room.id}-${index}`}
                style={[
                  styles.roomListItem,
                  isActive && styles.roomListItemActive
                ]}
                onPress={() => setCurrentRoom(room.id)}
              >
                {hasImage ? (
                  <Image source={room.image} style={{ width: 24, height: 24 }} />
                ) : (
                  <Text style={{ fontSize: 20, lineHeight: 24 }}>{room.icon || '📁'}</Text>
                )}
                <Text style={[
                  styles.roomListItemText,
                  isActive && styles.roomListItemTextActive
                ]}>
                  {cleaningServiceEnabled
                    ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                    : `${t('settings.section', { lng: sectionLanguage })} ${index + 1}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const watermarkSwatchColor = useMemo(() => {
    const baseColor = customWatermarkEnabled
      ? watermarkColor || labelBackgroundColor
      : labelBackgroundColor;
    return normalizeHex(baseColor) || '#FFFFFF';
  }, [customWatermarkEnabled, watermarkColor, labelBackgroundColor]);

  // Load trial information
  useEffect(() => {
    const loadTrialInfo = async () => {
      const active = await isTrialActive();
      const daysRemaining = await getTrialDaysRemaining();
      const plan = await getTrialPlan();
      const trialInfo = await getTrialInfo();
      setTrialActive(active);
      setTrialDaysRemaining(daysRemaining);
      setTrialPlan(plan);
      setTrialDuration(trialInfo?.durationDays || 15);
    };
    loadTrialInfo();
  }, []);

  useEffect(() => {
    if (typeof watermarkOpacity === 'number') {
      setWatermarkOpacityPreview(watermarkOpacity);
    }
  }, [watermarkOpacity]);

  // Reset watermark opacity preview when custom watermark is turned on
  useEffect(() => {
    if (customWatermarkEnabled && typeof watermarkOpacity === 'number') {
      setWatermarkOpacityPreview(watermarkOpacity);
    }
  }, [customWatermarkEnabled]);

  // Load Dropbox tokens on mount and when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      const loadDropboxTokens = async () => {
        try {
          await dropboxAuthService.loadStoredTokens();
          const isAuth = dropboxAuthService.isAuthenticated();
          const userInfo = dropboxAuthService.getUserInfo();
          
          // Note: We no longer automatically disconnect accounts on screen load
          // Users must explicitly disconnect via the modal when trying to connect another account
          
          setIsDropboxAuthenticated(isAuth);
          setDropboxUserInfo(userInfo);
          if (isAuth && userInfo) {
            console.log('[SETTINGS] Dropbox is authenticated:', userInfo.email);
            
            // Add Dropbox account to connected accounts for enterprise users if not already added
            if (userPlan === 'enterprise' && upsertConnectedAccount) {
              try {
                const dropboxAccount = {
                  id: userInfo.account_id || userInfo.email || `dropbox_${Date.now()}`,
                  email: userInfo.email,
                  name: userInfo.name?.display_name || userInfo.name?.given_name || userInfo.email,
                  givenName: userInfo.name?.given_name || userInfo.name?.display_name,
                  photo: null,
                };
                
                // Check if account already exists
                const existingAccount = connectedAccounts?.find(
                  (account) => account.id === dropboxAccount.id && account.accountType === 'dropbox'
                );
                
                if (!existingAccount) {
                  await upsertConnectedAccount(dropboxAccount, {
                    accountType: 'dropbox',
                    userMode: userMode || 'admin',
                    isActive: false, // Don't auto-activate on load
                  });
                  console.log('[SETTINGS] Dropbox account added to connected accounts on load');
                }
              } catch (accountError) {
                console.error('[SETTINGS] Error adding Dropbox account to connected accounts:', accountError);
              }
            }
          }
        } catch (error) {
          console.error('[SETTINGS] Error loading Dropbox tokens:', error);
        }
      };
      
      const loadTrialInfo = async () => {
        try {
          const active = await isTrialActive();
          const daysRemaining = await getTrialDaysRemaining();
          const plan = await getTrialPlan();
          const trialInfo = await getTrialInfo();
          setTrialActive(active);
          setTrialDaysRemaining(daysRemaining);
          setTrialPlan(plan);
          setTrialDuration(trialInfo?.durationDays || 15);
        } catch (error) {
          console.error('[SETTINGS] Error loading trial info:', error);
        }
      };
      
      loadDropboxTokens();
      loadTrialInfo();
    }, [userPlan, connectedAccounts, userMode, upsertConnectedAccount, isAuthenticated, adminUserInfo])
  );

  const {
    isAuthenticated,
    userInfo: adminUserInfo,
    signIn,
    signOut,
    signOutFromTeam,
    isSetupComplete,
    folderId: adminFolderId,
    proxySessionId,
    userMode,
    teamInfo,
    saveFolderId,
    inviteTokens,
    addInviteToken,
    removeInviteToken,
    adminSignIn,
    individualSignIn,
    appleAdminSignIn,
    appleIndividualSignIn,
    isGoogleSignInAvailable,
    initializeProxySession,
    teamName,
    updateTeamName,
    updatePlanLimit,
    switchToIndividualMode,
    disconnectAllAccounts,
    connectedAccounts,
    activeAccount,
    accountType,
    getActiveAccount,
    removeConnectedAccount,
    upsertConnectedAccount,
    updateActiveAccount,
    activateConnectedAccount,
    canAddMoreInvites,
    getRemainingInvites,
    joinTeam,
    planLimit,
  } = useAdmin();
  const { loading: pricesLoading, prices } = useSubscriptionPrices();
  const isEnterprisePlan = userPlan === 'enterprise';
  // For enterprise, always use the active account from connectedAccounts
  // For non-enterprise, use adminUserInfo (the currently authenticated account)
  const activeEnterpriseAccount = isEnterprisePlan
    ? connectedAccounts?.find((account) => account.isActive)
    : null;
  const otherEnterpriseAccounts = isEnterprisePlan
    ? (connectedAccounts || []).filter((account) => !account.isActive)
    : [];
  
  // Check if Dropbox is authenticated (for non-enterprise, this is stored in local state)
  // Also check directly from service in case state hasn't updated yet
  const isDropboxAuthChecked = isDropboxAuthenticated || dropboxAuthService.isAuthenticated();
  const dropboxUserInfoChecked = dropboxUserInfo || dropboxAuthService.getUserInfo();
  const isDropboxAuthenticatedForDisplay = isDropboxAuthChecked && !!dropboxUserInfoChecked;
  
  // Note: We no longer automatically disconnect accounts
  // Users must explicitly disconnect via the modal when trying to connect another account
  
  // For non-enterprise: create a virtual Dropbox account if authenticated but not in connectedAccounts
  // For enterprise: use the active account from connectedAccounts
  const displayedActiveAccount = useMemo(() => {
    console.log('[SETTINGS] 🔍 displayedActiveAccount calculating...');
    console.log('[SETTINGS] 🔍 isEnterprisePlan:', isEnterprisePlan);
    console.log('[SETTINGS] 🔍 adminUserInfo:', JSON.stringify(adminUserInfo, null, 2));
    console.log('[SETTINGS] 🔍 accountType from AdminContext:', accountType);
    console.log('[SETTINGS] 🔍 connectedAccounts:', JSON.stringify(connectedAccounts, null, 2));
    
    if (isEnterprisePlan) {
      return activeEnterpriseAccount || null;
    }
    
    // Non-enterprise: For Pro/Business, check if both are connected - if so, prioritize Dropbox (since user just connected it)
    // Otherwise, check Google first, then Dropbox
    // For business/pro, show whichever account is actually connected
    
    // For Pro/Business: If Dropbox is connected, check if Google is also connected
    // If both are connected, show Dropbox (the newly connected one)
    if ((userPlan === 'pro' || userPlan === 'business') && isDropboxAuthenticatedForDisplay && dropboxUserInfoChecked) {
      // Check if Google is still connected - if so, Dropbox should be shown (it's the active one)
      if (isAuthenticated && adminUserInfo) {
        // Both are connected - this shouldn't happen but show Dropbox as it's the newly connected one
        console.log('[SETTINGS] Both accounts connected - showing Dropbox as active');
        const dropboxAccount = {
          id: dropboxUserInfoChecked.account_id || dropboxUserInfoChecked.email || 'dropbox',
          email: dropboxUserInfoChecked.email,
          name: dropboxUserInfoChecked.name?.display_name || dropboxUserInfoChecked.name?.given_name || dropboxUserInfoChecked.email,
          accountType: 'dropbox',
          isActive: true
        };
        return dropboxAccount;
      } else {
        // Only Dropbox is connected
        const dropboxAccount = {
          id: dropboxUserInfoChecked.account_id || dropboxUserInfoChecked.email || 'dropbox',
          email: dropboxUserInfoChecked.email,
          name: dropboxUserInfoChecked.name?.display_name || dropboxUserInfoChecked.name?.given_name || dropboxUserInfoChecked.email,
          accountType: 'dropbox',
          isActive: true
        };
        console.log('[SETTINGS] Created virtual Dropbox account for display:', dropboxAccount);
        return dropboxAccount;
      }
    }
    
    // Check Google/Apple first for other cases
    if (adminUserInfo) {
      console.log('[SETTINGS] 🔍 adminUserInfo exists, determining accountType...');
      // Determine accountType: prefer from userInfo, fallback to AdminContext accountType, then check connectedAccounts
      let determinedAccountType = adminUserInfo.accountType || accountType;
      console.log('[SETTINGS] 🔍 Initial determinedAccountType:', determinedAccountType);
      
      // If still no accountType, check if there's an active Apple account in connectedAccounts
      if (!determinedAccountType || determinedAccountType === 'google') {
        const appleAccount = connectedAccounts?.find(acc => acc.accountType === 'apple' && acc.isActive);
        console.log('[SETTINGS] 🔍 Found Apple account in connectedAccounts?', !!appleAccount);
        if (appleAccount) {
          determinedAccountType = 'apple';
          console.log('[SETTINGS] 🍎 Using Apple accountType from connectedAccounts');
        }
      }
      
      const finalAccount = {
        ...adminUserInfo,
        accountType: determinedAccountType || 'google'
      };
      console.log('[SETTINGS] ✅ Final displayed account:', JSON.stringify(finalAccount, null, 2));
      return finalAccount;
    }
    
    // If Dropbox is authenticated, create virtual account object for non-enterprise plans
    // This should work for all plans (pro, business) except starter
    if (isDropboxAuthenticatedForDisplay && dropboxUserInfoChecked) {
      const dropboxAccount = {
        id: dropboxUserInfoChecked.account_id || dropboxUserInfoChecked.email || 'dropbox',
        email: dropboxUserInfoChecked.email,
        name: dropboxUserInfoChecked.name?.display_name || dropboxUserInfoChecked.name?.given_name || dropboxUserInfoChecked.email,
        accountType: 'dropbox',
        isActive: true
      };
      console.log('[SETTINGS] Created virtual Dropbox account for display:', dropboxAccount);
      return dropboxAccount;
    }
    
    return null;
  }, [isEnterprisePlan, activeEnterpriseAccount, adminUserInfo, isDropboxAuthenticatedForDisplay, dropboxUserInfoChecked, userPlan, isAuthenticated]);

  const [name, setName] = useState(userName);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [useCurrentLocationLoading, setUseCurrentLocationLoading] = useState(false);

  // Update name when userName changes (e.g., when switching back from team mode)
  useEffect(() => {
    setName(userName);
  }, [userName]);
  useEffect(() => {
    let isMounted = true;
    const checkStoredIndividual = async () => {
      // Only allow switch back for authenticated admins previewing team view
      // Regular team members who joined via invite code should not see this option
      if (!isTeamMember || !isAuthenticated) {
        if (isMounted) {
          setCanSwitchBack(false);
        }
        return;
      }
      try {
        const [storedPlan, storedMode] = await Promise.all([
          AsyncStorage.getItem('@stored_individual_plan'),
          AsyncStorage.getItem('@stored_individual_mode'),
        ]);
        if (isMounted) {
          setCanSwitchBack(Boolean(storedPlan || storedMode));
        }
      } catch (error) {
        if (isMounted) {
          setCanSwitchBack(false);
        }
      }
    };
    checkStoredIndividual();
    return () => {
      isMounted = false;
    };
  }, [isTeamMember, isAuthenticated]);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [showIndustryPicker, setShowIndustryPicker] = useState(false);
  // Inline industry dropdown in the Sections row — distinct from the
  // full-screen industry picker modal (`showIndustryPicker` above).
  // Currently-selected industry id is loaded from the persisted
  // qualification key on mount and refreshed when the user picks a
  // different one from this dropdown.
  const [industryDropdownOpen, setIndustryDropdownOpen] = useState(false);
  const [currentIndustryId, setCurrentIndustryId] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const stored = await readSecure('@user_qualification');
        if (stored) setCurrentIndustryId(stored);
      } catch (_) {}
    })();
  }, []);
  const [editingName, setEditingName] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [referralInfo, setReferralInfo] = useState({
    code: '',
    invitesSent: [],
    rewardsEarned: 0,
    totalMonthsEarned: 0,
    completedInvites: 0,
  });
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [isApplyingReferral, setIsApplyingReferral] = useState(false);
  const [isSigningInDropbox, setIsSigningInDropbox] = useState(false);
  const [isDropboxAuthenticated, setIsDropboxAuthenticated] = useState(false);
  const [dropboxUserInfo, setDropboxUserInfo] = useState(null);
  const [adminInfo, setAdminInfo] = useState(null);
  const [loadingAdminInfo, setLoadingAdminInfo] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // showPlanModal removed — upgrade flow now navigates to PlanSelectionScreen
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [isRestoringPurchases, setIsRestoringPurchases] = useState(false);
  // Tracks whether the user has an active iOS/Android subscription so we can
  // surface a "Manage Subscription" button. Only renders when true — Free users
  // never see it. Refreshed on mount.
  const [hasActiveSub, setHasActiveSub] = useState(false);
  // Diagnostic snapshot exposed in the dev-tools build-tag area so we can
  // see what the store actually returns vs what userPlan is cached at.
  // Helps debug tier-mismatch cases (e.g. user has a Business sub but the
  // app's userPlan was stuck on 'pro').
  const [iapDiag, setIapDiag] = useState('');
  // OTA diagnostic state — populated by the two buttons in the dev-tools
  // section below. `otaCheckResult` holds the response from
  // Updates.checkForUpdateAsync(); `otaFetchResult` holds the response
  // from Updates.fetchUpdateAsync(). Purpose: expose the exact reason
  // expo-updates rejects an OTA on this binary, since server-side is
  // verified correct and no visible error surface exists in Loki.
  const [otaCheckResult, setOtaCheckResult] = useState('');
  const [otaFetchResult, setOtaFetchResult] = useState('');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const purchases = await getAvailablePurchases();
        const active = Array.isArray(purchases) && purchases.length > 0;
        if (!mounted) return;
        setHasActiveSub(active);
        const productIds = (purchases || [])
          .map((p) => p?.productId)
          .filter(Boolean);
        let strict = 'free';
        let fuzzy = 'free';
        let detected = 'free';
        if (active) {
          // Strict detection via exact-id match in computeEntitlements.
          const ent = computeEntitlements(purchases);
          strict = ent?.plan || 'free';

          // Fuzzy detection via productIdToPlan substring match — covers
          // grandfathered SKUs, annual variants, or any id that includes
          // "business" / "pro" / "enterprise" without being identical to
          // the constants in IOS_PRODUCTS / ANDROID_PRODUCTS.
          const tierRank = { free: 0, starter: 0, pro: 1, business: 2, enterprise: 3 };
          for (const id of productIds) {
            const mapped = productIdToPlan(id);
            if ((tierRank[mapped] || 0) > (tierRank[fuzzy] || 0)) fuzzy = mapped;
          }
          detected = (tierRank[strict] || 0) >= (tierRank[fuzzy] || 0) ? strict : fuzzy;

          const detectableTiers = ['pro', 'business', 'enterprise'];
          if (
            detected
            && detectableTiers.includes(detected)
            && (userPlan || 'starter').toLowerCase() !== detected
          ) {
            try { await updateUserPlan(detected); } catch {}
          }
        }
        setIapDiag(
          `n=${productIds.length} strict=${strict} fuzzy=${fuzzy} → ${detected} cached=${userPlan || 'starter'} ids=[${productIds.join(', ')}]`,
        );
      } catch (e) {
        setIapDiag(`err: ${e?.message || String(e)}`);
      }
    })();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);

  const appLanguageScrollViewRef = useRef(null);
  const appLanguageLayouts = useRef({});
  const watermarkTextInputRef = useRef(null);
  const watermarkLinkInputRef = useRef(null);
  const mainScrollViewRef = useRef(null);
  const cloudSyncSectionRef = useRef(null);
  const watermarkSectionRef = useRef(null);
  const accountDataSectionRef = useRef(null);
  // Section refs added for the design's WORKSPACE / CLOUD & TEAM rows
  // so a row tap can scroll to the existing inline section where the
  // user does the actual editing.
  // sectionsSectionRef / labelsSectionRef removed alongside their
  // inline sections — they now live in IndustrySections / LabelsLanguage.
  const teamSectionRef = useRef(null);
  const watermarkSectionY = useRef(null);
  const watermarkSectionAbsoluteY = useRef(null);
  const [highlightWatermarkSection, setHighlightWatermarkSection] = useState(false);
  const [highlightCloudSection, setHighlightCloudSection] = useState(false);
  const [showDeleteFromStorageHint, setShowDeleteFromStorageHint] = useState(false);
  const windowHeight = Dimensions.get('window').height;
  const [scrollContainerHeight, setScrollContainerHeight] = useState(0);

  const isTeamMember = userMode === 'team_member';
  const [canSwitchBack, setCanSwitchBack] = useState(false);

  // Fetch referral stats from server when screen is focused
  useFocusEffect(
    useCallback(() => {
      const fetchReferralStats = async () => {
        try {
          const userId = await getUserId();
          if (!userId) return;
          const stats = await getReferralStatsFromServer(userId);
          if (stats) {
            setReferralInfo({
              code: stats.code || '',
              invitesSent: [],
              rewardsEarned: stats.completedInvites || 0,
              totalMonthsEarned: stats.monthsEarned || 0,
              completedInvites: stats.completedInvites || 0,
            });
          }
        } catch (error) {
          console.log('[Settings] Failed to fetch referral stats:', error?.message);
        }
      };
      fetchReferralStats();
    }, [])
  );

  const currentFontOption = useMemo(() => {
    return (
      FONT_OPTIONS.find((option) => option.key === labelFontFamily) ||
      FONT_OPTIONS[0]
    );
  }, [labelFontFamily, FONT_OPTIONS]);

  useEffect(() => {
    if (colorModalVisible) {
      let baseColor = labelBackgroundColor;
      if (colorModalType === 'text') {
        baseColor = labelTextColor;
      } else if (colorModalType === 'watermark') {
        baseColor = customWatermarkEnabled
          ? watermarkColor || labelBackgroundColor
          : labelBackgroundColor;
      }
      const normalized = normalizeHex(baseColor) || '#FFFFFF';
      setDraftColor(normalized);
      setColorInput(normalized);
      setHexModalValue(normalized);
      setHexModalError(null);
    }
  }, [
    colorModalVisible,
    colorModalType,
    labelBackgroundColor,
    labelTextColor,
    customWatermarkEnabled,
    watermarkColor,
  ]);

  const handleOpenHexModal = () => {
    // reset preview to persisted value when opening modal
    let persisted = labelBackgroundColor;
    if (colorModalType === 'text') {
      persisted = labelTextColor;
    } else if (colorModalType === 'watermark') {
      persisted = customWatermarkEnabled
        ? watermarkColor || labelBackgroundColor
        : labelBackgroundColor;
    }
    const normalized = normalizeHex(persisted) || '#FFFFFF';
    setDraftColor(normalized);
    setColorInput(normalized);
    setHexModalValue(normalized);
    setHexModalError(null);
    setHexModalVisible(true);
  };

  const handleHexModalChange = (text) => {
    const input = text.toUpperCase();
    setHexModalValue(input);
    if (!input) {
      setHexModalError(null);
      return;
    }
    const normalized = normalizeHex(input);
    if (normalized) {
      setHexModalError(null);
    } else if (input.length >= 4) {
      setHexModalError('Enter #RRGGBB, #RGB, or rgb(r, g, b)');
    } else {
      setHexModalError(null);
    }
  };

  const handleHexModalCancel = () => {
    setHexModalVisible(false);
    setHexModalError(null);
  };

  const handleHexModalApply = () => {
    const normalized = normalizeHex(hexModalValue);
    if (!normalized) {
      setHexModalError('Enter #RRGGBB, #RGB, or rgb(r, g, b)');
      return;
    }
    handleDraftColorChange(normalized, { source: 'complete' });
    setHexModalVisible(false);
  };

  const handleDraftColorChange = (color, arg1 = {}, arg2 = null) => {
    let options = {};
    let hsvMeta = null;

    if (arg1 && typeof arg1 === 'object' && 'source' in arg1) {
      options = arg1;
      hsvMeta = arg2;
    } else {
      hsvMeta = arg1;
      options = arg2 && typeof arg2 === 'object' ? arg2 : {};
    }

    const { source } = options;

    let candidateHex = normalizeHex(color);
    if (hsvMeta && typeof hsvMeta === 'object') {
      const { h = 0, s = 0, v = 0 } = hsvMeta;
      if (colorModalType === 'text' && v <= 1) {
        candidateHex = hsvToHex({ h, s, v: 100 });
      } else {
        candidateHex = hsvToHex({ h, s, v });
      }
    }
    const normalized = normalizeHex(candidateHex);
    if (!normalized) {
      return;
    }
    setDraftColor(normalized);
    setColorInput(normalized);
    setHexModalValue(normalized);
    setHexModalError(null);
  };

  // Fetch team members for Manage Team modal
  const fetchTeamMembersForModal = async () => {
    if (proxySessionId) {
      setLoadingTeamMembers(true);
      try {
        const result = await proxyService.getTeamMembers(proxySessionId);
        if (result.success && result.teamMembers) {
          setTeamMembersList(result.teamMembers);

          // Try to get team name from various sources
          if (result.teamName) {
            setTeamNameInput(result.teamName);
          } else {
            // Try to load from AsyncStorage directly
            try {
              const storedTeamName = await AsyncStorage.getItem('@team_name');
              if (storedTeamName) {
                setTeamNameInput(storedTeamName);
              } else if (teamName) {
                setTeamNameInput(teamName);
              }
            } catch (err) {
              console.error('[SETTINGS] Failed to load team name from storage:', err);
              if (teamName) {
                setTeamNameInput(teamName);
              }
            }
          }
        } else {
          setTeamMembersList([]);
        }

        // Fetch global team member count (for Enterprise plan limit enforcement)
        try {
          const globalCountResult = await proxyService.getGlobalTeamMemberCount(proxySessionId);
          if (globalCountResult.success) {
            const localCount = result.teamMembers?.length || 0;
            const globalCount = globalCountResult.globalCount || 0;
            
            // Detect mismatch: if local count is 0 but global count is > 0, 
            // this means there are members from other sessions that shouldn't count for this session
            // For Enterprise plan, we use global count across all accounts, but if this is a new session
            // with 0 local members, we should reset the global count or use local count
            if (localCount === 0 && globalCount > 0) {
              console.warn('[SETTINGS] Mismatch detected: Local count is 0 but global count is', globalCount);
              console.warn('[SETTINGS] This may indicate stale data from previous sessions. Using local count (0).');
              // For Enterprise plan, if local team is empty, treat global count as 0
              // This handles the case where a new team is set up but global count includes old members
              setGlobalTeamMemberCount(0);
            } else {
              // Normal case: use global count
              setGlobalTeamMemberCount(globalCount);
            }
          }
        } catch (globalCountError) {
          console.error('[SETTINGS] Failed to fetch global team member count:', globalCountError);
          // Fall back to local count if global count fails
          setGlobalTeamMemberCount(result.teamMembers?.length || 0);
        }
      } catch (error) {
        console.error('[SETTINGS] Failed to fetch team members:', error);
        setTeamMembersList([]);
      } finally {
        setLoadingTeamMembers(false);
      }
    } else {
      setTeamMembersList([]);
      setGlobalTeamMemberCount(0);
    }
  };

  // Fetch team members when modal opens
  useEffect(() => {
    if (showManageTeamModal) {
      fetchTeamMembersForModal();
    }
  }, [showManageTeamModal]);

  // Handler functions for Manage Team modal
  const handleGenerateInvite = async () => {
    if (!canAddMoreInvitesLocal()) {
      Alert.alert('Cannot add more invites', 'You have reached your plan limit.');
      return;
    }

    if (!proxySessionId) {
      Alert.alert('Error', 'Proxy session not initialized. Please connect your team first.');
      return;
    }

    const newToken = generateInviteToken();

    try {
      console.log('[SETTINGS] Generating invite token...', { proxySessionId, newToken });

      // Add token to proxy server
      await proxyService.addInviteToken(proxySessionId, newToken);
      console.log('[SETTINGS] Token added to proxy server');

      // Analytics: track invite creation (per-invite)
      try {
        logTeamInvitesCreated(1, {
          plan: userPlan,
          team_size_before: teamMembersList?.length || 0,
          team_size_after: teamMembersList?.length || 0, // size doesn't change until member joins
        });
      } catch (e) {
        // non‑critical
      }

      // Save token locally
      await addInviteToken(newToken);
      console.log('[SETTINGS] Invite token generated and saved successfully');

      // Refresh team members list
      await fetchTeamMembersForModal();

      Alert.alert(
        'Invite Generated',
        `A new invite has been created. You can now share it with your team member.`
      );
    } catch (error) {
      console.error('[SETTINGS] Failed to generate invite token:', error);
      Alert.alert('Error', `Failed to generate invite token: ${error.message}`);
    }
  };

  const handleTestInvite = async (token) => {
    console.log('[TEST_INVITE] handleTestInvite called with token:', token);

    // Prevent double-click - check if modal is already showing
    if (showTestNameInput) {
      console.log('[TEST_INVITE] Modal already showing, ignoring');
      return;
    }

    if (!proxySessionId) {
      Alert.alert('Error', 'Proxy session not initialized.');
      return;
    }

    // Store the token and keep manage team modal open but show name input view
    setCurrentTestToken(token);
    setShowTestNameInput(true);
  };

  const handleTestJoinWithName = async () => {
    console.log('[TEST_JOIN] ====== handleTestJoinWithName CALLED ======');
    console.log('[TEST_JOIN] Initial state:', {
      isTestingInvite,
      testMemberName: testMemberName?.substring(0, 20),
      currentTestToken: currentTestToken?.substring(0, 10),
      proxySessionId: proxySessionId?.substring(0, 10),
      showTestNameInput,
      showManageTeamModal,
    });
    
    // Prevent double-click
    if (isTestingInvite) {
      console.log('[TEST_JOIN] Already processing test join, ignoring');
      return;
    }
    
    if (!testMemberName.trim()) {
      console.log('[TEST_JOIN] No name provided, showing alert');
      Alert.alert('Name Required', 'Please enter a name to test the team member setup.');
      return;
    }

    if (!currentTestToken || !proxySessionId) {
      console.log('[TEST_JOIN] Missing token or session ID:', { currentTestToken: !!currentTestToken, proxySessionId: !!proxySessionId });
      Alert.alert('Error', 'Missing invite token or session ID.');
      setShowTestNameInput(false);
      setIsTestingInvite(false);
      return;
    }

    console.log('[TEST_JOIN] Setting loading state and storing values');
    // Set loading state
    setIsTestingInvite(true);
    
    // Store values before closing modals
    const tokenToUse = currentTestToken;
    const memberName = testMemberName.trim();
    
    console.log('[TEST_JOIN] Stored values:', {
      tokenToUse: tokenToUse?.substring(0, 10),
      memberName,
      proxySessionId: proxySessionId?.substring(0, 10),
    });
    
    // Close both modals first
    console.log('[TEST_JOIN] Closing modals');
    setShowTestNameInput(false);
    setShowManageTeamModal(false);
    setTestMemberName('');
    setCurrentTestToken(null);
    console.log('[TEST_JOIN] Modals closed, waiting for interactions...');
    
    // Wait for all interactions and animations to complete before processing
    InteractionManager.runAfterInteractions(async () => {
      console.log('[TEST_JOIN] ====== InteractionManager callback STARTED ======');
      try {
        console.log('[TEST_JOIN] Starting team join process after interactions complete');
        
        // Update settings with the test member name
        console.log('[TEST_JOIN] Step 1: Reading settings from AsyncStorage');
        const settingsKey = 'app-settings';
        const storedSettings = await AsyncStorage.getItem(settingsKey);
        console.log('[TEST_JOIN] Step 1 complete: Settings read');
        
        const settings = storedSettings ? JSON.parse(storedSettings) : {};
        const originalName = settings.userName || '';
        console.log('[TEST_JOIN] Step 2: Parsed settings, originalName:', originalName);
        
        // Set the test member name
        console.log('[TEST_JOIN] Step 3: Writing member name to AsyncStorage');
        await AsyncStorage.setItem(settingsKey, JSON.stringify({
          ...settings,
          userName: memberName
        }));
        console.log('[TEST_JOIN] Step 3 complete: Member name written to AsyncStorage');

        console.log('[TEST_JOIN] Step 4: Calling updateUserInfo');
        // Update SettingsContext with the team member name before joining
        await updateUserInfo(memberName);
        console.log('[TEST_JOIN] Step 4 complete: SettingsContext updated with team member name:', memberName);

        console.log('[TEST_JOIN] Step 5: Calling joinTeam');
        console.log('[TEST_JOIN] Join team params:', { 
          token: tokenToUse?.substring(0, 10), 
          proxySessionId: proxySessionId?.substring(0, 10),
          memberName: memberName
        });
        const result = await joinTeam(tokenToUse, proxySessionId);
        console.log('[TEST_JOIN] Step 5 complete: Join team result:', result);
        
        if (result.success) {
          console.log('[TEST_JOIN] Step 6: Join successful, waiting for state update...');
          
          // Wait a bit for state to fully update
          await new Promise(resolve => setTimeout(resolve, 300));
          console.log('[TEST_JOIN] Step 6 complete: State update wait finished');
          
          console.log('[TEST_JOIN] Step 7: Resetting loading state');
          // Reset loading state before navigation
          setIsTestingInvite(false);
          console.log('[TEST_JOIN] Step 7 complete: Loading state reset');
          
          console.log('[TEST_JOIN] Step 8: Starting navigation');
          // Navigate to Home screen to show team member mode
          if (navigation) {
            console.log('[TEST_JOIN] Navigation object exists, resetting to Home');
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
            console.log('[TEST_JOIN] navigation.reset called');
          } else {
            console.log('[TEST_JOIN] ERROR: Navigation object is null!');
          }
        } else {
          console.log('[TEST_JOIN] Join failed, restoring original name');
          // Restore original name if join failed
          await AsyncStorage.setItem(settingsKey, JSON.stringify({
            ...settings,
            userName: originalName
          }));
          if (originalName) {
            await updateUserInfo(originalName);
          }
          setIsTestingInvite(false);
          Alert.alert('Error', result.error || 'Failed to join team.');
        }
      } catch (error) {
        console.error('[TEST_JOIN] ====== ERROR IN INTERACTION MANAGER CALLBACK ======');
        console.error('[TEST_JOIN] Error details:', error);
        console.error('[TEST_JOIN] Error message:', error.message);
        console.error('[TEST_JOIN] Error stack:', error.stack);
        setIsTestingInvite(false);
        Alert.alert('Error', 'Failed to join team. Please try again.');
      }
      console.log('[TEST_JOIN] ====== InteractionManager callback COMPLETED ======');
    });
    console.log('[TEST_JOIN] ====== handleTestJoinWithName EXITING (InteractionManager scheduled) ======');
  };

  const handleCopyToken = (token) => {
    // Copy the smart invite link
    const inviteLink = generateInviteLink(token, proxySessionId);
    Clipboard.setString(inviteLink);
    Alert.alert(
      t('settings.inviteCopiedTitle', { defaultValue: 'Link Copied!' }),
      t('settings.inviteCopiedMessage', {
        defaultValue: 'Invite link copied to clipboard. Share this link with your team member - it will guide them to download and join automatically.',
      })
    );
  };

  const handleShareInvite = async (token) => {
    try {
      // Generate the smart share content with invite link
      const shareContent = generateShareContent(token, proxySessionId, teamName);

      // Share the message with the invite link
      await Share.share({
        message: shareContent.message,
        title: shareContent.title,
      });
    } catch (error) {
      if (error.message !== 'User did not share') {
        Alert.alert(
          t('common.error', { defaultValue: 'Error' }),
          t('settings.shareInviteError', { defaultValue: 'Could not share the invite.' })
        );
      }
    }
  };

  const handleDeleteInvite = (token) => {
    Alert.alert(
      t('settings.deleteInviteTitle', { defaultValue: 'Delete Invite' }),
      t('settings.deleteInviteMessage', {
        defaultValue: 'This will permanently delete this unused invite code. Are you sure?',
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('settings.deleteInviteButton', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            try {
              if (proxySessionId) {
                await proxyService.removeInviteToken(proxySessionId, token);
              }
              await removeInviteToken(token);
              await fetchTeamMembersForModal();
              Alert.alert(
                t('settings.deleteInviteSuccessTitle', { defaultValue: 'Deleted' }),
                t('settings.deleteInviteSuccessMessage', {
                  defaultValue: 'The invite code has been deleted successfully.',
                })
              );
            } catch (error) {
              console.error('[SETTINGS] Failed to delete invite token:', error);
              Alert.alert(
                t('common.error', { defaultValue: 'Error' }),
                t('settings.deleteInviteErrorMessage', {
                  defaultValue: 'Failed to delete invite code. Please try again.',
                })
              );
            }
          },
        },
      ]
    );
  };

  // Helper function to check if all team slots are filled with actual team members
  const areAllSlotsFilledWithMembers = () => {
    // For Enterprise plan, use global count across all accounts
    // For Business plan, use local count per account
    let actualMembersCount;
    if (userPlan === 'enterprise') {
      // Prefer global count when available; fall back to local if global has not been fetched yet
      const localCount = teamMembersList?.length || 0;
      const globalCount = globalTeamMemberCount || 0;
      actualMembersCount = globalCount > 0 ? globalCount : localCount;
    } else {
      actualMembersCount = teamMembersList?.length || 0;
    }
    return actualMembersCount >= planLimit && actualMembersCount > 0;
  };

  // Helper function to check if we can add more invites (considering global count for Enterprise)
  const canAddMoreInvitesLocal = () => {
    if (userPlan === 'enterprise') {
      // For Enterprise, check global count across all accounts (with local fallback)
      const localCount = teamMembersList?.length || 0;
      const globalCount = globalTeamMemberCount || 0;
      const used = globalCount > 0 ? globalCount : localCount;
      return used < planLimit;
    } else {
      // For Business and other plans, use the AdminContext function
      return canAddMoreInvites();
    }
  };

  // Helper function to get price per member based on plan
  const getPricePerMember = () => {
    if (userPlan === 'business') {
      return 5.99;
    } else if (userPlan === 'enterprise') {
      return 4.99;
    }
    return 0;
  };

  // Handler for opening add member modal
  const handleOpenAddMemberModal = () => {
    console.log('[ADD_MEMBER_MODAL] handleOpenAddMemberModal called');
    // Optional debug notification to confirm button press
    // Alert.alert('Add Team Member', 'Add Team Member button pressed');
    // Do NOT close the Manage Team modal - we want to overlay on top of it
    setAdditionalMembersCount(1);
    setShowAddMemberModal(true);
  };

  // Handler for purchasing additional members
  const handlePurchaseAdditionalMembers = async () => {
    const pricePerMember = getPricePerMember();
    const totalPrice = (pricePerMember * additionalMembersCount).toFixed(2);

    Alert.alert(
      'Purchase Additional Members',
      `You are about to purchase ${additionalMembersCount} additional team member slot${additionalMembersCount > 1 ? 's' : ''} for $${totalPrice}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Purchase',
          onPress: async () => {
            try {
              setShowAddMemberModal(false);

              // Require in-app purchase for each additional seat (iOS & Android)
              let seatsToAdd = additionalMembersCount || 1;
              if (Platform.OS === 'ios' || Platform.OS === 'android') {
                // Determine which IAP product to use based on current plan
                let seatProductId = null;
                if (userPlan === 'business') {
                  seatProductId = IAP_PRODUCTS.BUSINESS_SEAT;
                } else if (userPlan === 'enterprise') {
                  seatProductId = IAP_PRODUCTS.ENTERPRISE_SEAT;
                }

                if (!seatProductId) {
                  Alert.alert('Error', 'Additional members are only available for Business and Enterprise plans.');
                  return;
                }

                // Inform user if multiple seats will require multiple purchases
                if (seatsToAdd > 1) {
                  const proceed = await new Promise((resolve) => {
                    Alert.alert(
                      'Multiple Purchases Required',
                      'Adding multiple team members requires confirming a purchase for each additional member. Continue?',
                      [
                        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                        { text: 'Continue', onPress: () => resolve(true) },
                      ]
                    );
                  });
                  if (!proceed) {
                    return;
                  }
                }

                for (let i = 0; i < seatsToAdd; i++) {
                  try {
                    await purchaseProduct(seatProductId);
                  } catch (err) {
                    if (err?.message === 'USER_CANCELLED' || err?.message === 'user-cancelled') {
                      if (i === 0) {
                        return;
                      } else {
                        seatsToAdd = i;
                        break;
                      }
                    } else {
                      console.error('[PURCHASE] Error during seat purchase:', err);
                      Alert.alert('Error', 'Failed to complete purchase. Some seats may not have been added.');
                      seatsToAdd = i;
                      break;
                    }
                  }
                }

                if (seatsToAdd <= 0) {
                  return;
                }
              }

              // Show loading (for consistency across platforms)
              Alert.alert('Processing', 'Updating your team size...', [], { cancelable: false });

              // Increase the plan limit by the number of seats actually added
              const currentPlanLimit = planLimit || 5;
              const newPlanLimit = currentPlanLimit + seatsToAdd;

              console.log('[PURCHASE] Increasing planLimit from', currentPlanLimit, 'to', newPlanLimit, 'for plan:', userPlan);

              // Update plan limit via AdminContext helper so state, storage, and activeAccount stay in sync
              await updatePlanLimit(newPlanLimit);

              // Dismiss loading alert / show success
              Alert.alert(
                'Purchase Successful',
                `Successfully added ${seatsToAdd} team member slot${seatsToAdd > 1 ? 's' : ''}. You now have ${newPlanLimit} total slots.`,
                [{ text: 'OK' }]
              );

              // Reset counter
              setAdditionalMembersCount(1);

            } catch (error) {
              console.error('[PURCHASE] Error purchasing additional members:', error);
              Alert.alert('Error', 'Failed to process purchase. Please try again.');
            }
          }
        }
      ]
    );
  };

  // Test function to fill team members to max
  const handleFillTeamMembersToMax = async () => {
    if (!proxySessionId) {
      Alert.alert('Error', 'Proxy session not initialized. Please set up team first.');
      return;
    }

    try {
      // Use current planLimit from AdminContext, with sensible fallbacks
      let effectiveLimit = planLimit || 0;
      if (!effectiveLimit) {
        if (userPlan === 'enterprise') {
          effectiveLimit = 15;
        } else if (userPlan === 'business') {
          effectiveLimit = 5;
        }
      }

      // First, fetch current team members from server to get all tokens
      let allServerTokens = new Set();
      try {
        const result = await proxyService.getTeamMembers(proxySessionId);
        if (result?.teamMembers) {
          result.teamMembers.forEach(member => {
            if (member.token) {
              allServerTokens.add(member.token);
            }
          });
        }
      } catch (error) {
        console.warn('[TEST] Failed to fetch team members from server:', error);
      }

      // Also get local tokens
      const inviteTokensSet = new Set([...(inviteTokens || [])]);
      const memberTokensSet = new Set(teamMembersList.map(member => member.token).filter(Boolean));
      
      // Combine all tokens (local + server)
      const allTokens = Array.from(new Set([...inviteTokensSet, ...memberTokensSet, ...allServerTokens]));

      if (allTokens.length > 0) {
        console.log(`[TEST] Clearing ${allTokens.length} existing tokens first...`);
        for (const token of allTokens) {
          try {
            await proxyService.removeInviteToken(proxySessionId, token);
            await removeInviteToken(token);
          } catch (error) {
            console.warn(`[TEST] Failed to remove token ${token}:`, error);
          }
        }
        console.log(`[TEST] All existing tokens cleared`);
        
        // Wait a bit for server to process deletions
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get current global count after clearing
      let currentGlobalCount = 0;
      try {
        const globalCountResult = await proxyService.getGlobalTeamMemberCount(proxySessionId);
        if (globalCountResult.success) {
          currentGlobalCount = globalCountResult.globalCount || 0;
        }
      } catch (error) {
        console.warn('[TEST] Failed to get global count after clearing:', error);
      }

      // Calculate how many members to add (should be exactly effectiveLimit)
      const membersToAdd = Math.max(0, effectiveLimit - currentGlobalCount);
      
      if (membersToAdd <= 0) {
        Alert.alert('Info', `Team is already at max capacity (${currentGlobalCount}/${effectiveLimit}).`);
        await fetchTeamMembersForModal();
        return;
      }

      console.log(`[TEST] Adding ${membersToAdd} members to reach limit of ${effectiveLimit} (current: ${currentGlobalCount})`);

      // Now fill all slots up to effectiveLimit
      for (let i = 0; i < membersToAdd; i++) {
        const token = generateInviteToken();
        const testMemberName = `Test Member ${currentGlobalCount + i + 1}`;

        console.log(`[TEST] Creating member ${currentGlobalCount + i + 1}/${effectiveLimit}: ${testMemberName}`);

        // Add to proxy server first
        await proxyService.addInviteToken(proxySessionId, token);
        console.log(`[TEST] Token added to proxy server: ${token}`);

        // Add to local state
        await addInviteToken(token);
        console.log(`[TEST] Token added to local state: ${token}`);

        // Simulate team member joining with this token
        await proxyService.registerTeamMemberJoin(proxySessionId, token, testMemberName);
        console.log(`[TEST] Team member registered: ${testMemberName} with token ${token}`);
      }

      console.log(`[TEST] All ${membersToAdd} members created successfully`);

      // Refresh the modal to show updated state
      await fetchTeamMembersForModal();

      // Show simple alert without blocking
      Alert.alert(
        'Test Complete',
        `Successfully filled team to ${effectiveLimit} members. Added ${membersToAdd} new member(s).`
      );
    } catch (error) {
      console.error('[TEST] Failed to fill team members:', error);
      Alert.alert('Error', 'Failed to fill team members. Check console for details.');
    }
  };

  // Test function to clear all team members and tokens
  const handleClearAllTeamMembers = async () => {
    Alert.alert(
      'Clear All Team Members',
      'This will remove all team members and invite tokens from both local and server. This action cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!proxySessionId) {
                Alert.alert('Error', 'Proxy session not initialized.');
                return;
              }

              // First, fetch all team members from server to get all tokens
              let allServerTokens = new Set();
              try {
                const result = await proxyService.getTeamMembers(proxySessionId);
                if (result?.teamMembers) {
                  result.teamMembers.forEach(member => {
                    if (member.token) {
                      allServerTokens.add(member.token);
                    }
                  });
                  console.log(`[TEST] Found ${result.teamMembers.length} team members on server`);
                }
              } catch (error) {
                console.warn('[TEST] Failed to fetch team members from server:', error);
              }

              // Get all unique tokens from both local inviteTokens and teamMembersList
              const inviteTokensSet = new Set([...(inviteTokens || [])]);
              const memberTokensSet = new Set(teamMembersList.map(member => member.token).filter(Boolean));
              
              // Combine all tokens (local + server) to ensure we clear everything
              const allTokens = Array.from(new Set([...inviteTokensSet, ...memberTokensSet, ...allServerTokens]));

              console.log(`[TEST] Clearing ${allTokens.length} team members and tokens (inviteTokens: ${inviteTokensSet.size}, memberTokens: ${memberTokensSet.size}, serverTokens: ${allServerTokens.size})`);

              // Remove all tokens from server (which should also remove team members)
              let removedCount = 0;
              for (const token of allTokens) {
                try {
                  await proxyService.removeInviteToken(proxySessionId, token);
                  // Also remove from local state
                  try {
                    await removeInviteToken(token);
                  } catch (localError) {
                    // Token might not exist locally, that's ok
                  }
                  removedCount++;
                  console.log(`[TEST] Removed token: ${token.substring(0, 10)}...`);
                } catch (error) {
                  console.error(`[TEST] Failed to remove token ${token.substring(0, 10)}...:`, error);
                }
              }

              console.log(`[TEST] Removed ${removedCount} tokens`);

              // Wait a bit for server to process deletions
              await new Promise(resolve => setTimeout(resolve, 500));

              // Verify global count is cleared
              try {
                const globalCountResult = await proxyService.getGlobalTeamMemberCount(proxySessionId);
                if (globalCountResult.success) {
                  const remainingCount = globalCountResult.globalCount || 0;
                  console.log(`[TEST] Global team member count after clearing: ${remainingCount}`);
                  if (remainingCount > 0) {
                    console.warn(`[TEST] Warning: ${remainingCount} team members still exist on server. Forcing global reset.`);
                    // Force a reset of the server-side global registry so local and server stay in sync
                    try {
                      const resetResult = await proxyService.resetGlobalTeamMemberCount(proxySessionId);
                      console.log('[TEST] Global team member registry reset result:', resetResult);
                    } catch (resetError) {
                      console.warn('[TEST] Failed to reset global team member registry:', resetError);
                    }
                  }
                }
              } catch (error) {
                console.warn('[TEST] Failed to verify global count after clearing:', error);
              }

              // Refresh the modal to show updated state
              await fetchTeamMembersForModal();

              // Locally ensure global count is reset to 0 after a full clear
              setGlobalTeamMemberCount(0);

              // Show simple alert without blocking
              Alert.alert(
                'Success',
                `All team members and tokens have been cleared. Removed ${removedCount} token(s).`
              );
            } catch (error) {
              console.error('[TEST] Failed to clear team members:', error);
              Alert.alert('Error', 'Failed to clear all team members. Check console for details.');
            }
          }
        }
      ]
    );
  };

  // Handle restore purchases (iOS & Android)
  const handleRestorePurchases = async () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

    setIsRestoringPurchases(true);
    try {
      const purchases = await restorePurchases();
      const active = (purchases || []).find(p => !!p.productId && !p.productId.includes('seat'));
      if (active) {
        try {
          logSubscriptionRestored({
            plan_id: productIdToPlan(active.productId),
            product_id: active.productId,
            platform: Platform.OS,
            provider: Platform.OS === 'ios' ? 'apple' : 'google',
            entry_point: 'settings',
            subscription_type: 'unknown',
            transaction_id: active.transactionId || active.purchaseToken || null,
            original_transaction_id:
              active.originalTransactionIdentifierIOS ||
              active.originalTransactionId ||
              null,
            analytics_source: 'restore',
          });
        } catch {}
      }
      Alert.alert(
        t('common.success', { defaultValue: 'Success' }),
        t('settings.purchasesRestored', { defaultValue: 'Your purchases have been restored successfully.' })
      );
    } catch (error) {
      console.error('[Settings] Error restoring purchases:', error);

      const errorMessage = error?.message || '';
      // Only a genuine password-sheet cancel should bail silently.
      // OpenIAP's "Request Canceled" serviceError is NOT that — it means
      // StoreKit sync failed for another reason (throttling, sandbox/prod
      // mismatch, network). Fall through to the actionable alert below.
      if (errorMessage.includes('USER_CANCELLED') || error?.code === 'E_USER_CANCELLED' || error?.code === 'user-cancelled') {
        console.log('[Settings] User cancelled restore purchases');
        return;
      }

      // Sync failed AND no cached entitlements — surface actionable
      // guidance instead of the generic "failed to restore" alert.
      if (errorMessage === 'SYNC_FAILED_NO_CACHED_ENTITLEMENTS') {
        Alert.alert(
          t('paywall.restoreSyncTitle', { defaultValue: 'Couldn\'t reach the App Store' }),
          t('paywall.restoreSyncBody', {
            defaultValue:
              'Your subscription is safe, but we couldn\'t sync with the App Store just now. Wait a minute and try again. If the issue persists, sign out and back into your Apple ID in Settings → [your name] → Media & Purchases.',
          })
        );
        return;
      }

      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.restoreFailed', { defaultValue: 'Failed to restore purchases. Please try again or contact support if the problem persists.' })
      );
    } finally {
      setIsRestoringPurchases(false);
    }
  };

  const handleSetupTeam = async () => {
    // Get active account and account type
    const activeAccount = getActiveAccount();
    const currentAccountType = activeAccount?.accountType || accountType || 'google';

    if ((!isAuthenticated && !isDropboxAuthenticatedForDisplay) || isSigningIn) {
      return;
    }

    const hasTeamFeature = !!proxySessionId
      || canUse(FEATURES.TEAM_MANAGEMENT)
      || canUse(FEATURES.TEAM_COLLABORATION);
    if (!hasTeamFeature) {
      Alert.alert(
        t('teamMembers.upgradeTitle', { defaultValue: 'Team requires Business' }),
        t('teamMembers.upgradeMessage', {
          defaultValue: 'Upgrade to Business or Enterprise to set up a team and invite members.',
        }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          {
            text: t('teamMembers.upgradeCTA', { defaultValue: 'Upgrade' }),
            onPress: () => navigation.navigate('PlanSelection', { mode: 'upgrade' }),
          },
        ],
      );
      return;
    }

    // Check if user is trying to set up team with iCloud
    if (currentAccountType === 'apple') {
      Alert.alert(
        'iCloud Does Not Support Teams',
        'Team uploads are only available with Google Drive or Dropbox. iCloud can only be used for individual uploads.\n\nTo enable team features, please connect Google Drive or Dropbox in Settings.',
        [
          {
            text: 'Send Feedback',
            onPress: () => {
              // Contact form moved into Help & Support — the legacy
              // ContactUs screen was retired in favor of the unified
              // Help & Support flow (Email us / Help center / Send a
              // message), which routes through the same EmailJS service.
              navigation.navigate('HelpSupport');
            }
          },
          { text: 'OK', style: 'cancel' }
        ]
      );
      return;
    }

    // Check if already set up
    if (isSetupComplete()) {
      Alert.alert(t('settings.alreadyConnected'), t('settings.alreadyConnectedMessage'));
      return;
    }

    try {
      setIsSigningIn(true); // Show a loading indicator

      let folderIdOrPath = null;
      let userName = null;

      if (currentAccountType === 'dropbox') {
        // For Dropbox: find or create folder and get folder path
        await dropboxAuthService.loadStoredTokens();
        if (!dropboxAuthService.isAuthenticated()) {
          setIsSigningIn(false);
          Alert.alert(
            'Reconnect Required',
            'To set up team features, you need to reconnect with Dropbox to refresh your authorization.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reconnect Now',
                onPress: async () => {
                  try {
                    await signOut();
                    setTimeout(() => {
                      Alert.alert(
                        'Ready to Reconnect',
                        'Please tap "Connect to Dropbox Account" below to sign in again and complete team setup.'
                      );
                    }, 500);
                  } catch (signOutError) {
                    console.error('[SETUP] Error signing out for reconnect:', signOutError);
                    Alert.alert('Error', 'Failed to disconnect. Please try manually disconnecting from Settings.');
                  }
                }
              }
            ]
          );
          return;
        }

        // Step 1: Find or create the Dropbox folder
        folderIdOrPath = await dropboxService.findOrCreateProofPixFolder();
        await saveFolderId(folderIdOrPath); // Store folder path (for Dropbox, this is a path like "/proofpix-uploads")
        
        const dropboxUserInfo = dropboxAuthService.getUserInfo();
        userName = dropboxUserInfo?.name || adminUserInfo?.name;
      } else {
        // For Google: check if we already have a proxy session first
        // If we have a session, we don't need serverAuthCode (it's already been used and cleared)
        const hasExistingSession = proxySessionId || await AsyncStorage.getItem('@proxy_session_id');
        
        if (!hasExistingSession) {
          // Only require serverAuthCode if we're setting up for the first time (no existing session)
          const googleAuthService = await import('../services/googleAuthService');
          
          // First check if user is signed in to Google
          const isSignedIn = await googleAuthService.default.isSignedIn();
          if (!isSignedIn) {
            setIsSigningIn(false);
            Alert.alert(
              'Google Sign-In Required',
              'Please connect your Google account first before setting up team features.',
              [{ text: 'OK', style: 'cancel' }]
            );
            return;
          }

          // Check for serverAuthCode only if we don't have a session yet
          // serverAuthCode is a one-time code that gets cleared after successful setup
          let serverAuthCode = await googleAuthService.default.getServerAuthCode();
          
          // If user is signed in but doesn't have serverAuthCode, we need to get a new one
          // This happens because serverAuthCode is only returned on fresh sign-ins with offlineAccess
          if (!serverAuthCode && isSignedIn) {
            console.log('[SETUP] User is signed in but no serverAuthCode. Need to refresh authorization to get a new code.');
            setIsSigningIn(false);
            
            Alert.alert(
              'Authorization Refresh Needed',
              'To set up team features, we need to refresh your Google authorization. This will sign you in again with the same account to generate a new authorization code.\n\nThis is safe and won\'t disconnect your account - it just refreshes the permissions.',
              [
                { 
                  text: 'Cancel', 
                  style: 'cancel'
                },
                {
                  text: 'Refresh Authorization',
                  onPress: async () => {
                    try {
                      setIsSigningIn(true);
                      // Sign in again to get a new serverAuthCode
                      console.log('[SETUP] Attempting to refresh authorization...');
                      const signInResult = await googleAuthService.default.signInAsAdmin();
                      if (signInResult && signInResult.userInfo) {
                        // Check for serverAuthCode again after sign-in
                        const newServerAuthCode = await googleAuthService.default.getServerAuthCode();
                        if (newServerAuthCode) {
                          console.log('[SETUP] ✅ Successfully obtained new serverAuthCode, continuing setup...');
                          // Continue with setup by calling handleSetupTeam again
                          // This time it will have serverAuthCode and skip the check
                          setTimeout(() => {
                            handleSetupTeam();
                          }, 100);
                        } else {
                          console.error('[SETUP] ⚠️ Still no serverAuthCode after sign-in');
                          setIsSigningIn(false);
                          Alert.alert(
                            'Authorization Failed',
                            'We were unable to get a new authorization code. This usually means:\n\n1. Offline access was not granted during sign-in\n2. Web Client ID is not configured properly\n\nPlease try disconnecting and reconnecting your Google account, ensuring you grant all requested permissions.',
                            [{ text: 'OK' }]
                          );
                        }
                      } else {
                        setIsSigningIn(false);
                        Alert.alert(
                          'Sign-In Failed',
                          signInResult?.error || 'Failed to refresh authorization. Please try again.',
                          [{ text: 'OK' }]
                        );
                      }
                    } catch (refreshError) {
                      console.error('[SETUP] Error refreshing authorization:', refreshError);
                      setIsSigningIn(false);
                      Alert.alert(
                        'Error',
                        'Failed to refresh authorization: ' + (refreshError.message || 'Unknown error'),
                        [{ text: 'OK' }]
                      );
                    }
                  }
                }
              ]
            );
            return; // Exit early, will continue via recursive call if refresh succeeds
          } else if (!serverAuthCode) {
            // User is not signed in
            setIsSigningIn(false);
            Alert.alert(
              'Google Sign-In Required',
              'Please connect your Google account first before setting up team features.',
              [{ text: 'OK', style: 'cancel' }]
            );
            return;
          }
        }

        // Step 1: Find or create the Google Drive folder
        console.log('[SETUP] Finding or creating Google Drive folder...');
        try {
          folderIdOrPath = await googleDriveService.findOrCreateProofPixFolder();
        } catch (folderErr) {
          console.error('[SETUP] Drive folder create failed:', folderErr?.message || String(folderErr));
          throw folderErr;
        }
        if (!folderIdOrPath) {
          console.error('[SETUP] Drive folder create returned null folderId');
          throw new Error('Failed to create Google Drive folder');
        }
        await saveFolderId(folderIdOrPath);
        console.log('[SETUP] ✅ Folder ready:', folderIdOrPath);
        userName = adminUserInfo?.name;
      }

      // Step 2: Initialize proxy session (this creates the session and stores refresh token/access token)
      // This will use existing session if available, or create new one if needed
      const sessionResult = await initializeProxySession(folderIdOrPath, currentAccountType);
      if (!sessionResult || !sessionResult.sessionId) {
        // If we got a skippable error (like GOOGLE_NOT_CONNECTED), handle it gracefully
        if (sessionResult?.skippable) {
          setIsSigningIn(false);
          Alert.alert(
            'Setup Incomplete',
            'Team setup requires a valid Google connection. Please ensure you are signed in to Google Drive.',
            [{ text: 'OK', style: 'cancel' }]
          );
          return;
        }
        throw new Error(sessionResult?.error || 'Failed to initialize proxy session');
      }

      // Step 3: Set default team name if not already set
      if (!teamName && userName) {
        await updateTeamName(userName);
        // Also save to AsyncStorage for persistence
        await AsyncStorage.setItem('@team_name', userName);
      }

      Alert.alert(
        t('settings.teamConnectedTitle'),
        t('settings.teamConnectedMessage')
      );

    } catch (error) {
      console.error('[SETUP] Setup failed:', error.message);

      // Check if it's an auth code expiration error
      const isAuthExpired = error.message?.includes('authorization code has expired') ||
                           error.message?.includes('already been used');

      if (isAuthExpired) {
        Alert.alert(
          'Setup Failed',
          'Your Google authorization has expired. Please disconnect and sign in again to continue.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Sign In Again',
              onPress: async () => {
                try {
                  await signOut();
                  // Wait a moment for sign out to complete
                  setTimeout(() => {
                    Alert.alert(
                      'Ready to Sign In',
                      'Please tap "Connect with Google Drive" below to sign in again.'
                    );
                  }, 500);
                } catch (signOutError) {
                  console.error('[SETUP] Error signing out:', signOutError);
                  Alert.alert('Error', 'Failed to disconnect. Please try manually disconnecting from Settings.');
                }
              }
            }
          ]
        );
      } else {
        Alert.alert(
          'Setup Failed',
          error.message || 'An error occurred while setting up team features. Please try again.',
          [{ text: 'OK', style: 'cancel' }]
        );
      }
    } finally {
      setIsSigningIn(false);
    }
  };


  const handleSaveUserInfo = async () => {
    await updateUserInfo(name, location);
  };

  const handleUseCurrentLocation = useCallback(async () => {
    setUseCurrentLocationLoading(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('settings.locationPermissionTitle', { defaultValue: 'Location access' }),
          t('settings.locationPermissionMessage', { defaultValue: 'Permission to use location is required to set folder location from GPS.' }),
          [{ text: 'OK', style: 'cancel' }]
        );
        return;
      }
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const [address] = await ExpoLocation.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const cityName = address?.city || address?.region || address?.subregion || address?.country || 'Unknown';
      const matchedLocation = LOCATIONS.find(
        (loc) => loc.name.toLowerCase() === cityName.toLowerCase()
      );
      const locationToSave = matchedLocation ? matchedLocation.id : cityName;
      await updateUserInfo(undefined, locationToSave);
      setShowLocationDropdown(false);
      Alert.alert(
        t('settings.locationUpdated', { defaultValue: 'Location updated' }),
        t('settings.locationUpdatedMessage', { defaultValue: 'Folder location set to: ' }) + getLocationName(locationToSave),
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('[Settings] Use current location error:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.locationError', { defaultValue: 'Could not get current location. Please try again or select a location manually.' }),
        [{ text: 'OK', style: 'cancel' }]
      );
    } finally {
      setUseCurrentLocationLoading(false);
    }
  }, [t, updateUserInfo]);

  const handleApplyReferralCode = async () => {
    const code = referralCodeInput.trim().toUpperCase();
    if (!code) {
      Alert.alert(
        t('referral.errorTitle', { defaultValue: 'Error' }),
        t('referral.emptyCodeError', { defaultValue: 'Please enter a referral code' })
      );
      return;
    }

    setIsApplyingReferral(true);
    try {
      // Track installation on server (also stores locally via acceptReferral)
      const { trackReferralInstallation, completeReferralSetup, getUserId } = await import('../services/referralService');
      const result = await trackReferralInstallation(code);

      if (result && result.success) {
        // Complete the referral setup so the referrer gets credit
        const userId = await getUserId();
        await completeReferralSetup(code, userId);

        // Extend existing trial by referral bonus days
        const { extendTrial, isTrialActive: checkTrialActive } = await import('../services/trialService');
        const trialActive = await checkTrialActive();
        if (trialActive) {
          const bonusDays = Platform.OS === 'android' ? 15 : 15;
          await extendTrial(bonusDays);
          console.log(`[Settings] Extended trial by ${bonusDays} days for referral code`);
        }

        Alert.alert(
          t('referral.successTitle', { defaultValue: 'Success' }),
          t('referral.codeAppliedSuccess', { defaultValue: 'Referral code applied successfully! Your trial has been extended.' })
        );
        setReferralCodeInput('');
      } else {
        // User referral failed — try admin referral code as fallback
        const { redeemAdminReferralCode, hasRedeemedAdminReferral, markAdminReferralRedeemed } = await import('../services/adminReferralService');
        const alreadyRedeemed = await hasRedeemedAdminReferral();

        if (!alreadyRedeemed) {
          const userId = await getUserId();
          const adminResult = await redeemAdminReferralCode(code, userId);
          if (adminResult?.success && adminResult?.grantedDays > 0) {
            const { extendTrial } = await import('../services/trialService');
            await extendTrial(adminResult.grantedDays);
            await markAdminReferralRedeemed();
            logAdminReferralConversion({ code, link_type: 'admin', channel: adminResult.channel, source: adminResult.source, campaign: adminResult.campaign, placement: adminResult.placement, label: adminResult.label, days_added: adminResult.grantedDays });
            Alert.alert(
              t('referral.successTitle', { defaultValue: 'Success' }),
              t('referral.codeAppliedSuccess', { defaultValue: `Referral code applied! You've received ${adminResult.grantedDays} extra days free.` })
            );
            setReferralCodeInput('');
            return;
          }
        }

        // Neither user nor admin referral worked
        let errorMessage = t('referral.codeAppliedError', { defaultValue: 'Failed to apply referral code. Please try again.' });
        if (alreadyRedeemed) {
          errorMessage = t('referral.alreadyUsedMessage', {
            defaultValue: 'A referral code has already been applied to your account.'
          });
        } else if (result && result.error) {
          if (result.error.includes('already used a referral code')) {
            errorMessage = t('referral.alreadyUsedMessage', {
              defaultValue: 'This device has already used a referral code. Each device can only use one referral code.'
            });
          } else if (result.error.includes('Invalid referral code')) {
            errorMessage = t('referral.codeDoesNotExistMessage', {
              defaultValue: 'This referral code does not exist. Please check and try again.'
            });
          } else {
            errorMessage = result.error;
          }
        }
        Alert.alert(
          t('referral.errorTitle', { defaultValue: 'Error' }),
          errorMessage
        );
      }
    } catch (error) {
      console.error('[Settings] Error applying referral code:', error);
      Alert.alert(
        t('referral.errorTitle', { defaultValue: 'Error' }),
        t('referral.codeAppliedError', { defaultValue: 'Failed to apply referral code. Please try again.' })
      );
    } finally {
      setIsApplyingReferral(false);
    }
  };

  const handleLeaveTeam = () => {
    Alert.alert(
      t('settings.leaveTeam'),
      t('settings.leaveTeamMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.leaveTeam'),
          style: 'destructive',
          onPress: async () => {
            try {
              const signOutResult = await signOutFromTeam();
              if (!signOutResult?.success) {
                Alert.alert(t('common.error'), signOutResult?.error || t('settings.leaveTeamError'));
                return;
              }

              const switchResult = await switchToIndividualMode();
              if (switchResult?.success) {
                Alert.alert(
                  t('settings.teamLeft'),
                  t('settings.teamLeftMessage')
                );
              } else if (switchResult?.error) {
                Alert.alert(t('settings.notice'), t('settings.teamLeftNotice'));
              }
            } catch (error) {
              console.error('[SETTINGS] Error leaving team:', error);
              Alert.alert(t('common.error'), t('settings.leaveTeamUnexpectedError'));
            }
          },
        },
      ],
    );
  };

  const showCloudSyncUpgradeAlert = () => {
    Alert.alert(
      t('settings.cloudSyncPaidTitle', { defaultValue: 'Paid feature' }),
      t('settings.cloudSyncPaidMessage', { defaultValue: 'Cloud sync is available on the Pro plan and above. Upgrade to connect Google Drive, Dropbox, or iCloud and back up your photos automatically.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        { text: t('share.upgradeCTA', { defaultValue: 'Upgrade to Pro' }), onPress: () => navigation.navigate('PlanSelection') },
      ]
    );
  };

  const handleExportErrorLogs = async () => {
    try {
      const stats = await getErrorStats();
      const result = await exportErrorLogs();
      if (!result?.success) {
        Alert.alert('No logs', result?.message || 'No error logs have been recorded yet.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Export complete', `Saved to ${result.fileName}`);
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Share ProofPix error logs',
        UTI: 'public.json',
      });
      // After successful share, offer to clear
      Alert.alert(
        'Logs shared',
        `Exported ${result.logsCount} error${result.logsCount === 1 ? '' : 's'}. Clear them from the device?`,
        [
          { text: 'Keep', style: 'cancel' },
          { text: 'Clear', style: 'destructive', onPress: () => clearErrorLogs() },
        ]
      );
    } catch (e) {
      Alert.alert('Export failed', e?.message || 'Unknown error');
    }
  };

  const handleResetUserData = () => {
    const resetMessage = isTeamMember
      ? t('settings.resetTeamMemberConfirm')
      : t('settings.resetIndividualConfirm');

    Alert.alert(
      t('settings.resetUserData'),
      resetMessage,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.reset'),
          style: 'destructive',
          onPress: async () => {
            if (isTeamMember) {
              try {
                const signOutResult = await signOutFromTeam();
                if (!signOutResult?.success) {
                  Alert.alert(t('common.error'), signOutResult?.error || t('settings.disconnectTeamError'));
                  return;
                }
                await switchToIndividualMode();
              } catch (error) {
                console.warn('[SETTINGS] Failed to disconnect team during reset:', error?.message || error);
              }
            } else {
              try {
                await disconnectAllAccounts();
              } catch (error) {
                console.warn('[SETTINGS] Failed to disconnect accounts during reset:', error?.message || error);
              }
            }

            try {
              await resetUserData();
              // Reset developer tools unlock state
              setDevToolsUnlocked(false);
              devTapCountRef.current = 0;
              if (devTapTimeoutRef.current) {
                clearTimeout(devTapTimeoutRef.current);
                devTapTimeoutRef.current = null;
              }
            } finally {
              navigation.reset({
                index: 0,
                routes: [{ name: 'FirstLoad' }],
              });
            }
          }
        }
      ]
    );
  };

  const handleIndividualSignIn = async () => {
    setIsSigningIn(true);
    try {
      await individualSignIn();
    } catch (error) {
      console.error("Error during individual sign in:", error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleActivateConnectedAccount = async (account) => {
    if (!account || account.isActive) {
      return;
    }

    try {
      setIsSigningIn(true);
      // Check if account already exists in connectedAccounts
      const existingAccount = connectedAccounts.find(acc => acc.id === account.id);
      if (existingAccount) {
        // Account exists, just activate it by signing in with that account
        // The upsertConnectedAccount in adminSignIn will handle setting it as active
        await adminSignIn();
      } else {
        // Account doesn't exist yet, need to sign in to add it
        await adminSignIn();
      }
    } catch (error) {
      console.error('[SETTINGS] Error activating account:', error);
      Alert.alert(t('common.error'), t('settings.switchAccountError'));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleDisconnectActiveAccount = async (account) => {
    if (!account || !account.isActive) {
      return;
    }

    Alert.alert(
      t('settings.disconnectAccount', { defaultValue: 'Disconnect Account' }),
      t('settings.disconnectAccountMessage', { 
        defaultValue: 'Are you sure you want to disconnect this account?',
        email: account.email 
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.disconnect', { defaultValue: 'Disconnect' }),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsSigningIn(true);
              // Remove the account from connected accounts
              await removeConnectedAccount(account.id);
              // Sign out if this was the only account, or switch to another account
              const remainingAccounts = connectedAccounts.filter(acc => acc.id !== account.id);
              if (remainingAccounts.length === 0) {
                await signOut();
              } else {
                // Switch to the first remaining account
                const nextAccount = remainingAccounts[0];
                await handleActivateConnectedAccount(nextAccount);
              }
            } catch (error) {
              console.error('[SETTINGS] Failed to disconnect account:', error);
              Alert.alert(t('common.error'), t('settings.disconnectAccountError', { defaultValue: 'Failed to disconnect account. Please try again.' }));
            } finally {
              setIsSigningIn(false);
            }
          },
        },
      ]
    );
  };

  const handleRemoveConnectedAccount = (account) => {
    if (!account) {
      return;
    }

    Alert.alert(
      t('settings.removeGoogleAccount'),
      t('settings.removeGoogleAccountMessage', { email: account.email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeConnectedAccount(account.id);
            } catch (error) {
              console.error('[SETTINGS] Failed to remove connected account:', error);
              Alert.alert(t('common.error'), t('settings.removeAccountError'));
            }
          },
        },
      ]
    );
  };

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await adminSignIn();
    } catch (error) {
      console.error("Error during admin sign in:", error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignOut = () => {
    Alert.alert(
      t('settings.signOut'),
      t('settings.signOutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: async () => {
            const result = await signOut();
            if (result.success) {
              Alert.alert(t('common.success'), t('settings.signOutSuccess'));
            } else {
              Alert.alert(t('common.error'), result.error || t('settings.signOutError'));
            }
          }
        }
      ]
    );
  };

  const openColorModal = (type) => {
    let initialColor = labelBackgroundColor;
    if (type === 'text') {
      initialColor = labelTextColor;
    } else if (type === 'watermark') {
      initialColor = customWatermarkEnabled
        ? watermarkColor || labelBackgroundColor
        : labelBackgroundColor;
    }
    const normalized = normalizeHex(initialColor) || '#FFFFFF';
    setDraftColor(normalized);
    setColorInput(normalized);
    setHexModalValue(normalized);
    setHexModalError(null);
    setColorModalType(type);
    setColorPickerKey((prev) => prev + 1);
    setColorModalVisible(true);
  };

  const handleApplyColor = async () => {
    const normalized = normalizeHex(draftColor);
    if (!normalized) {
      setHexModalError('Please enter a valid color code before applying.');
      return;
    }
    if (colorModalType === 'background') {
      await updateLabelBackgroundColor(normalized);
    } else if (colorModalType === 'text') {
      await updateLabelTextColor(normalized);
    } else if (colorModalType === 'watermark') {
      await updateWatermarkColor(normalized);
    }
    setColorModalVisible(false);
  };

  const handleDefaultColor = async () => {
    let defaultColor =
      colorModalType === 'text'
        ? DEFAULT_LABEL_TEXT
        : DEFAULT_LABEL_BACKGROUND;
    if (colorModalType === 'watermark') {
      defaultColor = normalizeHex(labelBackgroundColor) || DEFAULT_LABEL_BACKGROUND;
      await updateWatermarkColor(defaultColor);
    } else if (colorModalType === 'background') {
      await updateLabelBackgroundColor(defaultColor);
    } else if (colorModalType === 'text') {
      await updateLabelTextColor(defaultColor);
    }
    handleDraftColorChange(defaultColor, { source: 'complete' });
    setColorPickerKey((prev) => prev + 1);
    setColorModalVisible(false);
  };

  const handleCancelColor = () => {
    setColorModalVisible(false);
    setHexModalVisible(false);
    setHexModalError(null);
  };

  const handleSelectFont = async (fontKey) => {
    await updateLabelFontFamily(fontKey);
    setFontModalVisible(false);
  };

  const changeLanguage = (languageCode) => {
    const wasRTL = isRTLLanguage(i18n.language);
    const willBeRTL = isRTLLanguage(languageCode);

    i18n.changeLanguage(languageCode);
    // Explicitly persist language choice (safety net for async detector)
    AsyncStorage.setItem('@proofpix_language', languageCode).catch(() => {});
    // Analytics: track app language change
    try {
      logLanguageChange(languageCode);
    } catch (e) {
      // non‑critical
    }
    setLanguageModalVisible(false);

    // RTL direction change requires app restart to take full effect
    if (wasRTL !== willBeRTL) {
      Alert.alert(
        willBeRTL ? 'إعادة تشغيل مطلوبة' : 'Restart Required',
        willBeRTL
          ? 'يرجى إعادة تشغيل التطبيق لتطبيق اتجاه اللغة العربية بشكل صحيح.'
          : 'Please restart the app to apply the language direction correctly.',
        [
          { text: willBeRTL ? 'لاحقاً' : 'Later', style: 'cancel' },
          {
            text: willBeRTL ? 'إعادة تشغيل' : 'Restart Now',
            onPress: () => Updates.reloadAsync(),
          },
        ]
      );
    }
  };

  const getCurrentLanguage = () => {
    return LANGUAGES.find(lang => lang.code === i18n.language) || LANGUAGES[0];
  };

  const handleSignOut = async () => {
    // For Business/Enterprise users in admin mode with team setup, sign out from team only
    // This keeps Google authentication but clears team setup, showing "Set Up Team" button again
    if (userMode === 'admin' && isSetupComplete() && (userPlan === 'business' || userPlan === 'enterprise')) {
      Alert.alert(
        t('settings.disconnectTeam'),
        t('settings.disconnectTeamMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('settings.disconnect'),
            style: 'destructive',
            onPress: async () => {
              const result = await signOutFromTeam();
              if (result.success) {
                Alert.alert(t('common.success'), t('settings.teamDisconnectedSuccess'));
              } else {
                Alert.alert(t('common.error'), result.error || t('settings.teamDisconnectedError'));
              }
            }
          }
        ]
      );
    } else {
      // For all other cases, do full sign out
      await signOut();
    }
  };

  // Check if Google account needs reconnection (missing serverAuthCode)
  useEffect(() => {
    const checkReconnectionNeeded = async () => {
      // Only check for Google accounts (Apple doesn't use serverAuthCode)
      if (isAuthenticated && userMode === 'admin' && accountType === 'google') {
        try {
          const googleAuthService = await import('../services/googleAuthService');
          const serverAuthCode = await googleAuthService.default.getServerAuthCode();
          setNeedsReconnect(!serverAuthCode);
        } catch (error) {
          console.error('[SETTINGS] Error checking serverAuthCode:', error);
          setNeedsReconnect(false);
        }
      } else {
        setNeedsReconnect(false);
      }
    };
    checkReconnectionNeeded();
  }, [isAuthenticated, userMode, accountType]);

  // Fetch admin info for team members
  useEffect(() => {
    const fetchAdminInfo = async () => {
      if (userMode === 'team_member' && teamInfo?.sessionId) {
        setLoadingAdminInfo(true);
        try {
          console.log('[SETTINGS] Fetching admin info for session:', teamInfo.sessionId);
          const sessionInfo = await proxyService.getSessionInfo(teamInfo.sessionId);
          console.log('[SETTINGS] Session info received:', sessionInfo);
          if (sessionInfo.success && sessionInfo.adminUserInfo) {
            setAdminInfo(sessionInfo.adminUserInfo);
            console.log('[SETTINGS] Admin info set:', sessionInfo.adminUserInfo);
          } else {
            console.warn('[SETTINGS] No admin info in session response:', sessionInfo);
          }
        } catch (error) {
          console.error('[SETTINGS] Failed to fetch admin info:', error);
          // Set a fallback so user knows they're connected even if we can't get the name
          setAdminInfo({ name: null, email: null });
        } finally {
          setLoadingAdminInfo(false);
        }
      }
    };

    fetchAdminInfo();
  }, [userMode, teamInfo?.sessionId]);

  // Update team name input when teamName changes from context
  useEffect(() => {
    if (!editingTeamName) {
      setTeamNameInput(teamName || '');
    }
  }, [teamName]);

  const getLabelLanguage = () => {
    const current = LANGUAGES.find((lang) => lang.code === labelLanguage);
    if (current) return current;
    const english = LANGUAGES.find(lang => lang.code === 'en');
    if (english) return english;
    return LANGUAGES[0];
  };

  const getSectionLanguage = () => {
    const current = LANGUAGES.find((lang) => lang.code === sectionLanguage);
    if (current) return current;
    const english = LANGUAGES.find(lang => lang.code === 'en');
    if (english) return english;
    return LANGUAGES[0];
  };

  useEffect(() => {
    if (languageModalVisible) {
      const currentLanguageCode = i18n.language;
      const yOffset = appLanguageLayouts.current[currentLanguageCode];
      if (yOffset !== undefined && appLanguageScrollViewRef.current) {
        setTimeout(() => {
          appLanguageScrollViewRef.current.scrollTo({ y: yOffset, animated: false });
        }, 100);
      }
    }
  }, [languageModalVisible]);

  // Scroll the main settings ScrollView to the top of a section ref —
  // used by the design's WORKSPACE + CLOUD & TEAM design rows so a tap
  // jumps to the legacy section that holds the full editing UI.
  const scrollToRef = (ref) => {
    if (!ref?.current || !mainScrollViewRef.current) return;
    try {
      ref.current.measureLayout(
        mainScrollViewRef.current,
        (x, y) => mainScrollViewRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true }),
        () => {},
      );
    } catch {}
  };

  // Handle navigation to specific sections - using useEffect to watch route params
  useEffect(() => {
    const params = route?.params;

    const scrollToSection = (sectionRef, paramKey) => {
      if (params?.[paramKey] === true) {
        console.log(`[SETTINGS] Attempting to scroll to ${paramKey} section`);
        console.log(`[SETTINGS] sectionRef.current:`, !!sectionRef.current);
        console.log(`[SETTINGS] mainScrollViewRef.current:`, !!mainScrollViewRef.current);
        
        // For watermark, use stored absolute Y position if available
        if (paramKey === 'scrollToWatermark' && watermarkSectionAbsoluteY.current !== null) {
          console.log(
            `[SETTINGS] Using stored absolute Y position for watermark:`,
            watermarkSectionAbsoluteY.current
          );
          const viewportHeight = scrollContainerHeight || windowHeight;
          // Scroll so the row sits a bit below center (~60–70% of height visually)
          const targetOffset = Math.max(
            0,
            watermarkSectionAbsoluteY.current - viewportHeight * 0.4
          );
          setTimeout(() => {
            mainScrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
            // Highlight the watermark row for a short period
            setHighlightWatermarkSection(true);
            setTimeout(() => {
              setHighlightWatermarkSection(false);
            }, 2000);
            setTimeout(() => {
              navigation.setParams({ [paramKey]: undefined });
            }, 500);
          }, 400);
          return;
        }
        
        // Retry function with increasing delays
        const attemptScroll = (attempt = 0) => {
          const maxAttempts = 5;
          const delay = 400 + (attempt * 200); // 400ms, 600ms, 800ms, 1000ms, 1200ms
          
          setTimeout(() => {
            if (!sectionRef.current || !mainScrollViewRef.current) {
              console.log(`[SETTINGS] Refs not ready for ${paramKey}, attempt ${attempt + 1}/${maxAttempts}`);
              if (attempt < maxAttempts - 1) {
                attemptScroll(attempt + 1);
              } else {
                console.log(`[SETTINGS] Failed to scroll to ${paramKey} after ${maxAttempts} attempts`);
                // For watermark, try using stored absolute Y as fallback
                if (paramKey === 'scrollToWatermark' && watermarkSectionAbsoluteY.current !== null) {
                  console.log(`[SETTINGS] Fallback: Using stored absolute Y position for watermark:`, watermarkSectionAbsoluteY.current);
                  const targetOffset = Math.max(0, watermarkSectionAbsoluteY.current - windowHeight * 0.3);
                  mainScrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
                  navigation.setParams({ [paramKey]: undefined });
                }
              }
              return;
            }
            
            sectionRef.current.measureLayout(
              mainScrollViewRef.current,
              (x, y) => {
                console.log(`[SETTINGS] ${paramKey} section position:`, { x, y, attempt: attempt + 1 });
                if (y >= 0) {
                  setTimeout(() => {
                    const viewportHeight = scrollContainerHeight || windowHeight;
                    const targetOffset = Math.max(0, y - viewportHeight * 0.4);
                    console.log(`[SETTINGS] Scrolling to y:`, targetOffset);
                    mainScrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
                    if (paramKey === 'scrollToWatermark') {
                      setHighlightWatermarkSection(true);
                      setTimeout(() => {
                        setHighlightWatermarkSection(false);
                      }, 2000);
                    } else if (paramKey === 'scrollToCloudSync') {
                      setHighlightCloudSection(true);
                      setTimeout(() => {
                        setHighlightCloudSection(false);
                      }, 2000);
                    } else if (paramKey === 'scrollToAccountData') {
                      setShowDeleteFromStorageHint(true);
                    }
                    setTimeout(() => {
                      navigation.setParams({ [paramKey]: undefined });
                      console.log(`[SETTINGS] ${paramKey} param cleared`);
                    }, 500);
                  }, 150);
                } else {
                  console.log(`[SETTINGS] Invalid y position for ${paramKey}, retrying...`);
                  if (attempt < maxAttempts - 1) {
                    attemptScroll(attempt + 1);
                  }
                }
              },
              (error) => {
                console.log(`[SETTINGS] measureLayout error for ${paramKey} (attempt ${attempt + 1}):`, error);
                if (attempt < maxAttempts - 1) {
                  attemptScroll(attempt + 1);
                } else if (paramKey === 'scrollToWatermark' && watermarkSectionAbsoluteY.current !== null) {
                  // Fallback for watermark
                  console.log(
                    `[SETTINGS] Fallback: Using stored absolute Y position for watermark:`,
                    watermarkSectionAbsoluteY.current
                  );
                  const viewportHeight = scrollContainerHeight || windowHeight;
                  const targetOffset = Math.max(
                    0,
                    watermarkSectionAbsoluteY.current - viewportHeight * 0.4
                  );
                  mainScrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
                  setHighlightWatermarkSection(true);
                  setTimeout(() => {
                    setHighlightWatermarkSection(false);
                  }, 2000);
                  navigation.setParams({ [paramKey]: undefined });
                } else if (paramKey === 'scrollToCloudSync' && cloudSyncSectionRef.current) {
                  // Fallback for cloud sync: simple scroll to top of cloud section
                  cloudSyncSectionRef.current.measureLayout(
                    mainScrollViewRef.current,
                    (cx, cy) => {
                      const viewportHeight = scrollContainerHeight || windowHeight;
                      const targetOffset = Math.max(0, cy - viewportHeight * 0.4);
                      mainScrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
                      setHighlightCloudSection(true);
                      setTimeout(() => {
                        setHighlightCloudSection(false);
                      }, 2000);
                      navigation.setParams({ [paramKey]: undefined });
                    },
                    () => {}
                  );
                }
              }
            );
          }, delay);
        };
        
        attemptScroll();
      }
    };

    // Check for each scroll target
    scrollToSection(cloudSyncSectionRef, 'scrollToCloudSync');
    scrollToSection(watermarkSectionRef, 'scrollToWatermark');
    scrollToSection(accountDataSectionRef, 'scrollToAccountData');

    // Check if plan modal should be shown
    if (params?.showPlanModal === true) {
      navigation.navigate('PlanSelection');
      // Clear the param
      navigation.setParams({ showPlanModal: undefined });
    }
  }, [route?.params, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleTitleTap} activeOpacity={1} style={styles.titleTouchable} hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}>
          <Text style={styles.title}>{t('settings.title')}</Text>
        </TouchableOpacity>
        <View style={styles.headerRightCluster}>
          <TouchableOpacity
            style={styles.headerThemeToggle}
            onPress={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('appearance.title', { defaultValue: 'Appearance' })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={themeMode === 'dark' ? 'moon' : 'sunny'}
              size={20}
              color={theme.textPrimary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerLanguageSelector}
            onPress={() => setLanguageModalVisible(true)}
          >
            <Image
              source={FLAG_IMAGES[getCurrentLanguage().code] || FLAG_IMAGES.en}
              style={styles.headerLanguageFlagImage}
              resizeMode="cover"
            />
            <Ionicons name="chevron-down" size={18} color={theme.textPrimary} style={{ padding: 2 }} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        ref={mainScrollViewRef}
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 20 + insets.bottom + 50 + 80 }}
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          setScrollContainerHeight(height);
        }}
      >
        {/* User Account Card — design 34: flat single-row layout —
            yellow disc with initials | name + subtitle | tier pill.
            That's it — nothing else in the card. Plan + trial info
            moves to a thin contextual banner under the upgrade card.
            Tapping the card opens the name editor (was a separate
            pen button — design has no pen). */}
        <TouchableOpacity
          activeOpacity={0.9}
          style={styles.userAccountCard}
          onPress={() => { setName(userName); setEditingName(true); }}
        >
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarInitials} numberOfLines={1}>
              {((userName || 'U').trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('') || 'U').toUpperCase()}
            </Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>{userName || 'User'}</Text>
            <Text style={styles.accountType} numberOfLines={1}>
              {userMode === 'team_member'
                ? t('settings.teamAccount', { defaultValue: 'Team account' })
                : t('settings.individualAccount', { defaultValue: 'Individual account' })}
            </Text>
          </View>
          {(() => {
            const plan = (userPlan || 'starter');
            // Team members are covered by the admin's plan — hide the
            // upgrade-tappable tier pill, show a static "TEAM" chip
            // instead so they still see their plan level without
            // being routed to a paywall they can't complete.
            if (isTeamMember) {
              return (
                <View style={[styles.userTierPill, styles.userTierPillBusiness]}>
                  <Text style={[styles.userTierPillText, styles.userTierPillTextBusiness]}>
                    TEAM
                  </Text>
                </View>
              );
            }
            const tierStyle =
              plan === 'pro' ? styles.userTierPillPro
              : plan === 'business' ? styles.userTierPillBusiness
              : plan === 'enterprise' ? styles.userTierPillBusiness
              : styles.userTierPillFree;
            const tierTextStyle =
              plan === 'pro' ? styles.userTierPillTextPro
              : plan === 'business' ? styles.userTierPillTextBusiness
              : plan === 'enterprise' ? styles.userTierPillTextBusiness
              : styles.userTierPillTextFree;
            return (
              <TouchableOpacity
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => navigation.navigate('PlanSelection', { mode: 'upgrade' })}
                style={[styles.userTierPill, tierStyle]}
              >
                <Text style={[styles.userTierPillText, tierTextStyle]}>
                  {plan.toUpperCase()}
                </Text>
              </TouchableOpacity>
            );
          })()}
        </TouchableOpacity>

        {/* Upgrade banner — tier-aware:
            - Starter (or no plan)        → "Upgrade to Pro" + Pro pitch
            - Pro                         → "Upgrade to Business" + team/branding pitch
            - Business / Enterprise       → hidden (already at top tier)
            - Team member                 → hidden (admin owns billing)
            Same destination (PlanSelection upgrade mode). */}
        {(() => {
          if (isTeamMember) return null;
          const plan = (userPlan || 'starter').toLowerCase();
          if (plan === 'business' || plan === 'enterprise') return null;
          const isPro = plan === 'pro';
          const title = isPro
            ? t('settings.upgradeToBusiness', { defaultValue: 'Upgrade to Business' })
            : t('settings.upgradeToPro', { defaultValue: 'Upgrade to Pro' });
          const subtitle = isPro
            ? t('settings.upgradeToBusinessSubtitle', {
                defaultValue: 'Team members, shared projects, logo & metadata',
              })
            : t('settings.upgradeToProSubtitle', {
                defaultValue: 'Unlimited projects, reports & cloud sync',
              });
          return (
            <TouchableOpacity
              style={styles.upgradeButton}
              onPress={() => navigation.navigate('PlanSelection', { mode: 'upgrade' })}
              activeOpacity={0.85}
            >
              <View style={styles.upgradeButtonIconTile}>
                <Ionicons name="star" size={20} color="#1E1E1E" />
              </View>
              <View style={styles.upgradeButtonCopy}>
                <Text style={styles.upgradeButtonTitle}>{title}</Text>
                <Text style={styles.upgradeButtonSubtitle} numberOfLines={1}>{subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#1E1E1E" />
            </TouchableOpacity>
          );
        })()}

        {/* Trial progress bar — full-width strip directly under the user
            card when a trial is active. Hidden once a paid sub kicks in.
            Also hidden for team_member accounts — trial concept doesn't
            apply since admin owns the plan. */}
        {!isTeamMember && trialActive && trialDaysRemaining > 0 ? (
          <View style={styles.trialBar}>
            <View style={styles.trialProgressBar}>
              <View
                style={[
                  styles.trialProgressFill,
                  { width: `${(trialDaysRemaining / trialDuration) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.trialDaysText}>
              {t('settings.trialDaysRemaining', { days: trialDaysRemaining, defaultValue: `${trialDaysRemaining} days remaining` })}
            </Text>
          </View>
        ) : null}

        {/* Subscription & billing block — Change plan row + manage-in-
            store link + redeem code link. All three hidden for
            team_member accounts: admin owns billing, team member can't
            change plan, can't cancel, can't redeem codes on the shared
            subscription. Showing these rows just leads to dead-end
            paywalls or actions that would confuse the admin's billing.
            Non-team_member users see the full billing surface as before. */}
        {!isTeamMember && (
          <>
            <TouchableOpacity
              style={styles.manageSubscriptionRow}
              onPress={() => navigation.navigate('PlanSelection', { mode: 'upgrade' })}
              activeOpacity={0.85}
            >
              <View style={styles.manageSubscriptionIc}>
                <Ionicons name="card-outline" size={19} color={theme.textPrimary} />
              </View>
              <View style={styles.manageSubscriptionMeta}>
                <Text style={styles.manageSubscriptionTitle}>
                  {hasActiveSub
                    ? t('settings.manageSubscription', { defaultValue: 'Change plan' })
                    : t('settings.subscriptionAndBilling', { defaultValue: 'Subscription & billing' })}
                </Text>
                <Text style={styles.manageSubscriptionSub} numberOfLines={1}>
                  {t('settings.changePlanSub', {
                    defaultValue: 'See all tiers and upgrade or downgrade',
                  })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.manageInAppStoreLink}
              onPress={() => { try { openManageSubscriptions(); } catch {} }}
              activeOpacity={0.7}
            >
              <Text style={styles.manageInAppStoreLinkText}>
                {Platform.OS === 'ios'
                  ? t('settings.manageInAppStore', {
                      defaultValue: 'Cancel, update billing & view receipts in the App Store',
                    })
                  : t('settings.manageInPlayStore', {
                      defaultValue: 'Cancel, update billing & view receipts in Play Store',
                    })}
              </Text>
            </TouchableOpacity>
            {/* Redeem code — pops the platform's native code-redemption UI.
                iOS 14+ shows an in-app StoreKit sheet; older iOS + Android
                open the store's Redeem page. Handled in iapService so all
                store-side UX stays in one place. Kept as a secondary link
                (same look as the manage-store link above) instead of a full
                row so free / non-subscribed users don't over-index on it. */}
            <TouchableOpacity
              style={styles.manageInAppStoreLink}
              onPress={() => { try { presentRedeemCode(); } catch {} }}
              activeOpacity={0.7}
            >
              <Text style={styles.manageInAppStoreLinkText}>
                {t('settings.redeemCode', {
                  defaultValue: 'Redeem a code',
                })}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ====================================================== */}
        {/* Design 34 / pp-settings.jsx — WORKSPACE + CLOUD & TEAM */}
        {/* row groups. Each row taps the existing functionality (modal,
            navigate, or scroll-to). Heavy section cards below are
            kept for full editing access. */}
        {/* ====================================================== */}

        <Text style={styles.sectionEyebrow}>
          {t('settings.workspaceGroup', { defaultValue: 'Workspace' })}
        </Text>
        <View style={styles.rowGroup}>
          {/* Labels & language — opens the standalone LabelsLanguage
              screen (Branding tiles + Language). Moved to top of
              the Workspace group per the user's spec. */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('LabelsLanguage')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="text" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <Text style={styles.ppRowTitle}>
                {t('settings.labelsLanguage', { defaultValue: 'Labels & language' })}
              </Text>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {getCurrentLanguage()?.name || 'English'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Industry & sections — opens the standalone IndustrySections
              screen (industry picker + sections list + folder-name
              location picker + Upload structure switch). */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('IndustrySections')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="folder-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <Text style={styles.ppRowTitle}>
                {t('settings.industryFolders', { defaultValue: 'Industry & folders' })}
              </Text>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {t('settings.industryFoldersSub', {
                  count: (Array.isArray(customRooms) ? customRooms.length : 0) || 5,
                  defaultValue: `${(Array.isArray(customRooms) ? customRooms.length : 0) || 5} folders`,
                })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>

        </View>

        <Text style={styles.sectionEyebrow}>
          {t('settings.cloudTeamGroup', { defaultValue: 'Cloud & Team' })}
        </Text>
        {/* External callers (Gallery, Projects, ProjectDetail, CloudTeam)
            navigate with `scrollToCloudSync: true` to nudge the user
            toward connecting cloud. The legacy Cloud & Team Sync section
            below is gone for everyone except team_member; redirect the
            scroll/highlight target to this shortcut row group so those
            callers still land in a meaningful place — the Cloud sync /
            Team members entry points. */}
        <View
          ref={cloudSyncSectionRef}
          style={[styles.rowGroup, highlightCloudSection && styles.highlightedSection]}
        >
          {/* Cloud sync — opens the standalone Cloud sync screen
              (Google Drive + Dropbox + iCloud + Background upload).
              PRO gate badge per design. */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('CloudSync')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="cloud-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <View style={styles.ppRowTitleRow}>
                <Text style={styles.ppRowTitle}>
                  {t('settings.cloudSync', { defaultValue: 'Cloud sync' })}
                </Text>
                <View style={styles.proBadge}>
                  <Text style={styles.proBadgeText}>PRO</Text>
                </View>
              </View>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {t('settings.cloudSyncSub', { defaultValue: 'Google Drive · Dropbox' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Team members — opens the standalone Team members screen
              (set up flow + invite generation + member list). BUSINESS gate. */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('TeamMembers')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="layers-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <View style={styles.ppRowTitleRow}>
                <Text style={styles.ppRowTitle}>
                  {t('settings.teamMembers', { defaultValue: 'Team members' })}
                </Text>
                <View style={styles.businessBadge}>
                  <Text style={styles.businessBadgeText}>BUSINESS</Text>
                </View>
              </View>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {t('settings.teamMembersSub', { defaultValue: 'Invite your crew' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Refer & earn — navigates to ReferralScreen (design 36). */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('Referral')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="gift-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <Text style={styles.ppRowTitle}>
                {t('settings.referEarn', { defaultValue: 'Refer Friends' })}
              </Text>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {t('settings.referEarnSub', { defaultValue: 'Earn 7 extra trial days per friend' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>

          {/* Help & support — navigates to the new HelpSupportScreen
              (design 37): live chat / email / help center + send-a-
              message form. */}
          <TouchableOpacity
            style={styles.ppRow}
            onPress={() => navigation.navigate('HelpSupport')}
            activeOpacity={0.85}
          >
            <View style={styles.ppRowIc}>
              <Ionicons name="chatbubble-ellipses-outline" size={19} color={theme.textPrimary} />
            </View>
            <View style={styles.ppRowMeta}>
              <Text style={styles.ppRowTitle}>
                {t('settings.helpSupport', { defaultValue: 'Help & support' })}
              </Text>
              <Text style={styles.ppRowSub} numberOfLines={1}>
                {t('settings.helpSupportSub', { defaultValue: 'Chat, email, or browse the help center' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>
        </View>

        {/* End design rows. Existing legacy sections continue below for
            full editing access — they handle the actual data binding
            (folder list, watermark customization, cloud provider state,
            etc.) and the rows above are quick-entry points to them. */}

    

        {/* Cloud & Team Sync — legacy admin/individual UI (Connect to
            Google/iCloud/Dropbox, signed-in card, Set Up Team, Manage
            Profiles, Connect to Dropbox button, InviteManager embed) was
            removed in favor of the standalone CloudSync and TeamMembers
            screens reached via the shortcut rows above. The team-member
            POV remains here because joined members still need somewhere
            to see who their admin is, copy the invite token, switch back
            to individual mode, and leave the team — and those flows have
            no home in CloudSyncScreen/TeamMembersScreen yet (both are
            admin-only). When that gap is filled, this whole block can go. */}
        {userMode === 'team_member' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('settings.cloudTeamSync', { defaultValue: 'Cloud & Team Sync' })}</Text>
            <Text style={styles.sectionDescription}>{t('settings.teamPlanFeature', { defaultValue: 'Team Plan Feature' })}</Text>

            {/* Team Member View — admin info (read-only) */}
            <View style={styles.adminInfoBox}>
              <Text style={styles.adminInfoLabel}>{t('settings.connectedToTeam')}</Text>
              {loadingAdminInfo ? (
                <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginVertical: 8 }} />
              ) : adminInfo && (adminInfo.name || adminInfo.email) ? (
                <>
                  <Text style={styles.adminInfoValue}>
                    {adminInfo.name || adminInfo.email || t('settings.admin')}
                  </Text>
                  {adminInfo.email && adminInfo.name && (
                    <Text style={styles.adminInfoEmail}>
                      {adminInfo.email}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.adminInfoValue}>
                  Γ£ô {t('settings.connectedToTeamStatus')}
                </Text>
              )}
            </View>

            {teamInfo?.token && (
              <View style={styles.tokenBox}>
                <View style={styles.tokenHeader}>
                  <Text style={styles.tokenLabel}>{t('settings.inviteToken')}</Text>
                  <TouchableOpacity
                    style={styles.tokenCopyButton}
                    onPress={() => {
                      Clipboard.setString(teamInfo.token);
                      Alert.alert(t('settings.copied'), t('settings.tokenCopied'));
                    }}
                  >
                    <Text style={styles.tokenCopyText}>{t('settings.copy')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.tokenValue} selectable>{teamInfo.token}</Text>
              </View>
            )}

            <Text style={styles.teamWarningText}>
              {t('settings.tokenWarning')}
            </Text>

            {canSwitchBack && (
              <TouchableOpacity
                style={styles.switchModeButton}
                onPress={async () => {
                  Alert.alert(
                    t('settings.switchBack'),
                    t('settings.switchBackMessage'),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('settings.switch'),
                        onPress: async () => {
                          try {
                            const result = await switchToIndividualMode();
                            if (result?.success) {
                              setTimeout(() => {
                                Alert.alert(
                                  t('settings.switchedBack'),
                                  t('settings.switchedBackMessage', { mode: result.mode ? result.mode.charAt(0).toUpperCase() + result.mode.slice(1) : 'individual' }),
                                  [{ text: t('common.ok') }]
                                );
                              }, 100);
                            } else if (result?.error) {
                              Alert.alert(t('common.error'), result.error);
                            }
                          } catch (error) {
                            console.error('[SETTINGS] Error switching modes:', error);
                            Alert.alert(t('common.error'), t('settings.switchModeError'));
                          }
                        },
                      },
                    ],
                  );
                }}
              >
                <Text style={styles.switchModeButtonText}>{t('settings.switchBack')}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.leaveTeamButton}
              onPress={handleLeaveTeam}
            >
              <Text style={styles.leaveTeamButtonText}>{t('settings.leaveTeam')}</Text>
            </TouchableOpacity>
          </View>
        )}


        

        {/* Contact Us section was removed — its functionality (name/email/
            phone/message form, sent via EmailJS through
            enterpriseContactService) was folded into HelpSupportScreen,
            reached via the "Help & support" shortcut row above. The
            ContactUs route + screen file have been deleted; any legacy
            "Send Feedback" Alert actions in this file now navigate
            directly to HelpSupport. */}

        {/* Debug / Error Logs Section — gated behind developer mode (8 taps on Settings title) */}
        {devToolsUnlocked && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.contactUsRow}
              onPress={handleExportErrorLogs}
            >
              <View style={styles.contactUsContent}>
                <Text style={styles.sectionTitle}>{t('settings.exportLogs', { defaultValue: 'Export error logs' })}</Text>
                <Text style={styles.sectionDescription}>
                  {t('settings.exportLogsDescription', { defaultValue: 'Share a log file with support to help debug issues.' })}
                </Text>
              </View>
              <Ionicons name="share-outline" size={20} color={COLORS.GRAY} />
            </TouchableOpacity>
            <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 8, paddingHorizontal: 4 }}>
              OTA: {Updates.updateId ? `${String(Updates.updateId).slice(0, 8)} (embedded=${String(Updates.isEmbeddedLaunch)})` : 'embedded / none'} · ch={Updates.channel || '—'} · rv={Updates.runtimeVersion || '—'}
            </Text>
            <Text style={{ fontSize: 11, color: '#E91E63', marginTop: 2, paddingHorizontal: 4, fontWeight: '600' }}>
              Build tag: OTA-2026-06-03-AK · PhotoLabel now uses freeform offset (preview matches Customize Labels position)
            </Text>
            {/* OTA diagnostic — build 88 addition. Tap "Check for OTA"
                to run Updates.checkForUpdateAsync() and see whether the
                server reports an available update + its ID. Tap
                "Fetch OTA" to run Updates.fetchUpdateAsync() and see
                whether the client can actually download + stage it.
                Errors show below in red so we can see the exact reason
                expo-updates rejects the update (silent rejection is
                what has been blocking us). */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, marginHorizontal: 4 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: '#1976D2', alignItems: 'center' }}
                onPress={async () => {
                  setOtaCheckResult('checking...');
                  try {
                    const r = await Updates.checkForUpdateAsync();
                    setOtaCheckResult(`isAvailable=${r.isAvailable} manifest.id=${r.manifest?.id?.slice(0,8) || '—'} reason=${r.reason || '—'}`);
                  } catch (e) {
                    setOtaCheckResult(`ERR: ${e?.message || String(e)}`);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Check for OTA</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 9, borderRadius: 8, backgroundColor: '#388E3C', alignItems: 'center' }}
                onPress={async () => {
                  setOtaFetchResult('fetching...');
                  try {
                    const r = await Updates.fetchUpdateAsync();
                    setOtaFetchResult(`isNew=${r.isNew} manifest.id=${r.manifest?.id?.slice(0,8) || '—'}`);
                  } catch (e) {
                    setOtaFetchResult(`ERR: ${e?.message || String(e)}`);
                  }
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Fetch OTA</Text>
              </TouchableOpacity>
            </View>
            {otaCheckResult ? (
              <Text style={{ fontSize: 10, color: otaCheckResult.startsWith('ERR') ? '#D32F2F' : theme.textMuted, marginTop: 6, paddingHorizontal: 4 }} selectable>
                check: {otaCheckResult}
              </Text>
            ) : null}
            {otaFetchResult ? (
              <Text style={{ fontSize: 10, color: otaFetchResult.startsWith('ERR') ? '#D32F2F' : theme.textMuted, marginTop: 2, paddingHorizontal: 4 }} selectable>
                fetch: {otaFetchResult}
              </Text>
            ) : null}
            {/* IAP diagnostic — shows what getAvailablePurchases returned
                + the highest-tier plan computeEntitlements detected +
                what userPlan is currently cached at. If this says
                `detected=business` but the user card still shows PRO,
                state hasn't re-rendered yet; tap the row below. */}
            <Text style={{ fontSize: 11, color: theme.textMuted, marginTop: 6, paddingHorizontal: 4 }} selectable>
              IAP: {iapDiag || '(no diag yet)'}
            </Text>
            <TouchableOpacity
              style={{
                marginTop: 8,
                marginHorizontal: 4,
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: '#1E1E1E',
                alignItems: 'center',
              }}
              onPress={async () => {
                try {
                  const restored = await restorePurchases();
                  const purchases = Array.isArray(restored) && restored.length
                    ? restored
                    : await getAvailablePurchases();
                  const productIds = (purchases || [])
                    .map((p) => p?.productId)
                    .filter(Boolean);

                  // Strict (exact-id) detection via computeEntitlements.
                  const ent = computeEntitlements(purchases);
                  const strict = ent?.plan || 'free';

                  // Fuzzy detection — picks the highest tier any
                  // returned id maps to via productIdToPlan. Catches
                  // cases where the store returned a product whose id
                  // doesn't exactly equal IOS_PRODUCTS.BUSINESS_MONTHLY
                  // but still includes "business" (e.g. a renamed SKU,
                  // an annual variant, an older grandfathered id).
                  const tierRank = { free: 0, starter: 0, pro: 1, business: 2, enterprise: 3 };
                  let fuzzy = 'free';
                  for (const id of productIds) {
                    const mapped = productIdToPlan(id);
                    if ((tierRank[mapped] || 0) > (tierRank[fuzzy] || 0)) fuzzy = mapped;
                  }

                  // Final detected = whichever is higher.
                  const detected = (tierRank[strict] || 0) >= (tierRank[fuzzy] || 0) ? strict : fuzzy;
                  if (['pro', 'business', 'enterprise'].includes(detected)) {
                    try { await updateUserPlan(detected); } catch {}
                  }
                  setIapDiag(
                    `n=${productIds.length} strict=${strict} fuzzy=${fuzzy} → ${detected} | ids=[${productIds.join(', ')}]`,
                  );
                  Alert.alert(
                    'Tier refresh',
                    `Active products: ${productIds.length}\n\n` +
                    `Detected (strict): ${strict}\n` +
                    `Detected (fuzzy): ${fuzzy}\n` +
                    `Synced userPlan: ${detected}\n\n` +
                    `Product IDs returned:\n${productIds.length ? productIds.join('\n') : '(none)'}`,
                  );
                } catch (e) {
                  Alert.alert('Tier refresh error', e?.message || String(e));
                }
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                Force refresh tier from store
              </Text>
            </TouchableOpacity>

            {/* Verbose IAP diagnostic — exposes every field of every
                purchase RNIap returns, including transactionId and
                originalTransactionId. Distinguishes the case where the
                user genuinely has the wrong sub from the case where
                stale/unfinished transactions are masking the right
                one. */}
            <TouchableOpacity
              style={{
                marginTop: 8,
                marginHorizontal: 4,
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: '#F2C31B',
                alignItems: 'center',
              }}
              onPress={async () => {
                try {
                  const purchases = await getAvailablePurchases();
                  const lines = (purchases || []).map((p, i) => {
                    const fields = {
                      productId: p?.productId,
                      transactionId: p?.transactionId,
                      originalTransactionId: p?.originalTransactionId
                        || p?.originalTransactionIdentifierIOS
                        || p?.originalTransactionDate,
                      transactionDate: p?.transactionDate,
                      purchaseStateAndroid: p?.purchaseStateAndroid,
                      isAcknowledged: p?.isAcknowledgedAndroid,
                      autoRenewing: p?.autoRenewingAndroid,
                      mapped: productIdToPlan(p?.productId),
                    };
                    const parts = Object.entries(fields)
                      .filter(([, v]) => v !== undefined && v !== null)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join('\n  ');
                    return `[${i + 1}]\n  ${parts}`;
                  });
                  const message = lines.length
                    ? lines.join('\n\n')
                    : 'getAvailablePurchases returned 0 items.';
                  Alert.alert('IAP purchases (verbose)', message);
                } catch (e) {
                  Alert.alert('Verbose IAP error', e?.message || String(e));
                }
              }}
            >
              <Text style={{ color: theme.textPrimary, fontSize: 12, fontWeight: '800' }}>
                Show all IAP fields
              </Text>
            </TouchableOpacity>

            {/* Clear iOS transaction queue + restore + re-detect.
                Useful when stale Pro purchases are masking the real
                Business subscription. Doesn't refund — only clears
                local pending/finished records. */}
            <TouchableOpacity
              style={{
                marginTop: 8,
                marginHorizontal: 4,
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: '#DB4446',
                alignItems: 'center',
              }}
              onPress={async () => {
                Alert.alert(
                  'Clear iOS transaction queue?',
                  'This finishes every pending/cached purchase locally, then restores from the App Store. It does NOT cancel your subscription — it just forces a fresh read.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear + restore',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await clearPendingTransactions();
                          const restored = await restorePurchases();
                          const purchases = Array.isArray(restored) && restored.length
                            ? restored
                            : await getAvailablePurchases();
                          const productIds = (purchases || [])
                            .map((p) => p?.productId)
                            .filter(Boolean);
                          const ent = computeEntitlements(purchases);
                          const strict = ent?.plan || 'free';
                          const tierRank = { free: 0, starter: 0, pro: 1, business: 2, enterprise: 3 };
                          let fuzzy = 'free';
                          for (const id of productIds) {
                            const mapped = productIdToPlan(id);
                            if ((tierRank[mapped] || 0) > (tierRank[fuzzy] || 0)) fuzzy = mapped;
                          }
                          const detected = (tierRank[strict] || 0) >= (tierRank[fuzzy] || 0) ? strict : fuzzy;
                          if (['pro', 'business', 'enterprise'].includes(detected)) {
                            try { await updateUserPlan(detected); } catch {}
                          }
                          Alert.alert(
                            'After clear + restore',
                            `Active products: ${productIds.length}\n` +
                            `Detected (strict): ${strict}\n` +
                            `Detected (fuzzy): ${fuzzy}\n` +
                            `Synced userPlan: ${detected}\n\n` +
                            `Product IDs:\n${productIds.length ? productIds.join('\n') : '(none)'}`,
                          );
                        } catch (e) {
                          Alert.alert('Clear error', e?.message || String(e));
                        }
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>
                Clear iOS queue + restore
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Data Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.data', { defaultValue: 'Data' })}</Text>
          <Text style={styles.sectionDescription}>
            {t('settings.dataDescription', { defaultValue: 'This will clear all projects, photos and settings' })}
          </Text>
          <TouchableOpacity
            style={styles.resetDataButton}
            onPress={handleResetUserData}
          >
            <Text style={styles.resetDataButtonText}>{t('settings.resetUserData', { defaultValue: 'Reset User Data' })}</Text>
          </TouchableOpacity>

          {showDeleteFromStorageHint && (
            <View style={styles.deleteFromStorageHint}>
              <Text style={styles.deleteFromStorageHintTitle}>
                {t('common.deleteFromPhoneStorage')}
              </Text>
              <View style={styles.deleteFromStorageHintRow}>
                <View style={styles.deleteFromStorageHintCheckboxBox}>
                  <Text style={styles.deleteFromStorageHintCheckboxCheck}>✓</Text>
                </View>
                <Text style={styles.deleteFromStorageHintLabel}>
                  {t('common.deleteFromPhoneStorage')}
                </Text>
              </View>
              <Text style={styles.deleteFromStorageHintCaption}>
                {t('common.deleteFromStorageWarning')}
              </Text>
            </View>
          )}

          {/* Developer Tools - After secret tap unlock (8 taps on title) */}
          {devToolsUnlocked && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.testToolsButton}
                onPress={() => setShowTestToolsModal(true)}
              >
                <Text style={styles.testToolsButtonText}>🧪 Test Tools</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.testToolsButton, { marginTop: 8 }]}
                onPress={() => navigation.navigate('AdminReferralLinks')}
              >
                <Text style={styles.testToolsButtonText}>🔗 Referral Links</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* App Version Info */}
        <View style={styles.versionContainer}>
          <View style={styles.proofPixBranding}>
             <Image source={require('../../assets/logo.png')} style={{ width: 50, height: 50
             }} resizeMode="contain"/>
            <Text style={styles.proofPixText}>ProofPix</Text>
          </View>
          <Text style={styles.versionText}>
            Version {Application.nativeApplicationVersion} ({Application.nativeBuildVersion})
          </Text>
          {/* OTA load indicator. Embedded = running the JS bundle that
              shipped inside the TestFlight/App Store binary. Otherwise we
              show the short update ID + creation date so you can confirm
              the latest `eas update` actually loaded. */}
          <Text style={styles.versionText}>
            {Updates.isEmbeddedLaunch
              ? 'Embedded (no OTA loaded)'
              : `Update ${Updates.updateId ? String(Updates.updateId).slice(0, 8) : '—'}${
                  Updates.createdAt
                    ? ' · ' + new Date(Updates.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : ''
                }`}
          </Text>
        </View>

        </ScrollView>

        {/* Bottom nav moved to PersistentBottomNav (App.js root). Dev-tools
            8-tap unlock is still handled via the screen title (see handleTitleTap). */}

        <RoomEditor
          visible={showRoomEditor}
          onClose={() => setShowRoomEditor(false)}
          onSave={(rooms) => {
            saveCustomRooms(rooms);
            // Force a small delay to ensure state updates propagate
            setTimeout(() => {
            }, 100);
          }}
          initialRooms={customRooms}
        />

        <QualificationPromptModal
          visible={showIndustryPicker}
          onClose={() => setShowIndustryPicker(false)}
        />

      {/* Edit Name Modal */}
      <RNModal visible={editingName} animationType="slide" transparent={true}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 24, width: '85%' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.TEXT, marginBottom: 16 }}>
              {t('settings.editName', { defaultValue: 'Edit Name' })}
            </Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: COLORS.BORDER, borderRadius: 10, padding: 12, fontSize: 16, color: COLORS.TEXT }}
              value={name}
              onChangeText={setName}
              placeholder=""
              autoFocus={true}
              maxLength={40}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16, gap: 12 }}>
              <TouchableOpacity onPress={() => setEditingName(false)} style={{ paddingVertical: 10, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 16, color: COLORS.GRAY }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (name.trim()) {
                    await updateUserInfo(name.trim());
                    setEditingName(false);
                  } else {
                    Alert.alert(t('common.error'), t('settings.nameRequired', { defaultValue: 'Please enter your name' }));
                  }
                }}
                style={{ backgroundColor: '#000', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 }}
              >
                <Text style={{ fontSize: 16, color: '#fff', fontWeight: '600' }}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </RNModal>

      <Modal
        isVisible={colorModalVisible}
        onBackdropPress={handleCancelColor}
        onBackButtonPress={handleCancelColor}
        style={styles.bottomModal}
        useNativeDriver
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoiding}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 110 : 0}
        >
          <View style={styles.bottomSheetContainer}>
            <View style={styles.customModalSheet}>
              <View style={styles.customModalHeader}>
                <Text style={styles.customModalTitle}>
                  {colorModalType === 'text'
                    ? t('colorPickerModal.textColor')
                    : colorModalType === 'watermark'
                    ? t('colorPickerModal.watermarkColor')
                    : t('colorPickerModal.backgroundColor')}
                </Text>
                <TouchableOpacity
                  onPress={handleCancelColor}
                  style={styles.customModalCloseButton}
                >
                  <Text style={styles.customModalCloseText}>Γ£ò</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.customModalScroll}
              >
                <View style={styles.customModalContent}>
                  <View style={styles.colorPreviewRow}>
                    <View
                      style={[
                        styles.colorPreviewSwatchLarge,
                        { backgroundColor: draftColor },
                      ]}
                    />
                    <View style={styles.inlineHexContainer}>
                      <Pressable
                        onPress={handleOpenHexModal}
                        style={({ pressed }) => [
                          styles.inlineHexButton,
                          pressed && styles.inlineHexButtonPressed,
                        ]}
                        hitSlop={8}
                      >
                        <Text style={styles.inlineHexText}>
                          {colorInput || '#FFFFFF'}
                        </Text>
                      </Pressable>
                      <TouchableOpacity
                        style={styles.inlineDefaultButton}
                        onPress={handleDefaultColor}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.inlineDefaultButtonText}>{t('colorPickerModal.default')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.colorPicker}>
                    <ColorPicker
                      key={`${colorModalType}-${colorPickerKey}`}
                      color={draftColor}
                      onColorChange={(value, hsv) => handleDraftColorChange(value, hsv)}
                      onColorChangeComplete={(value, hsv) => handleDraftColorChange(value, { source: 'complete' }, hsv)}
                      thumbSize={26}
                      sliderSize={28}
                      sliderHidden={false}
                      swatches={false}
                      shadeWheelThumb
                      shadeSliderThumb
                      gapSize={20}
                      noSnap
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.customApplyButton}
                    onPress={handleApplyColor}
                  >
                    <Text style={styles.customApplyButtonText}>{t('common.apply')}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
              {hexModalVisible && (
                <View style={styles.inlineOverlay}>
                  <TouchableWithoutFeedback onPress={handleHexModalCancel}>
                    <View style={styles.inlineOverlayBackdrop} />
                  </TouchableWithoutFeedback>
                  <View style={styles.inlineModal}>
                    <Text style={styles.inlineModalTitle}>{t('labelCustomization.colorPicker.enterColorCode')}</Text>
                    <TextInput
                      style={[
                        styles.inlineModalInput,
                        hexModalError && styles.inlineModalInputError,
                      ]}
                      value={hexModalValue}
                      onChangeText={handleHexModalChange}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      placeholder={t('labelCustomization.colorPicker.hexPlaceholderLong')}
                      placeholderTextColor="#888"
                      returnKeyType="done"
                      autoFocus
                    />
                    {!!hexModalError && (
                      <Text style={styles.inlineModalErrorText}>{hexModalError}</Text>
                    )}
                    <View style={styles.inlineModalActions}>
                      <TouchableOpacity
                        style={[styles.inlineModalButton, styles.inlineModalCancel]}
                        onPress={handleHexModalCancel}
                      >
                        <Text style={styles.inlineModalCancelText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.inlineModalButton, styles.inlineModalApply]}
                        onPress={handleHexModalApply}
                      >
                        <Text style={styles.inlineModalApplyText}>{t('common.apply')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          isVisible={fontModalVisible}
          onBackdropPress={() => setFontModalVisible(false)}
          onBackButtonPress={() => setFontModalVisible(false)}
          style={styles.bottomModal}
          useNativeDriver
        >
          <View style={styles.customModalSheet}>
            <View style={styles.customModalHeader}>
              <Text style={styles.customModalTitle}>{t('labelCustomization.fontModal.title')}</Text>
              <TouchableOpacity
                onPress={() => setFontModalVisible(false)}
                style={styles.customModalCloseButton}
              >
                <Text style={styles.customModalCloseText}>Γ£ò</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.fontList}>
              {FONT_OPTIONS.map((option) => {
                const isSelected = option.key === labelFontFamily;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.fontOptionRow,
                      isSelected && styles.fontOptionRowSelected,
                    ]}
                    onPress={() => handleSelectFont(option.key)}
                  >
                    <Text
                      style={[
                        styles.fontOptionTitle,
                        option.fontFamily ? { fontFamily: option.fontFamily } : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.fontOptionSubtitle}>{option.description}</Text>
                    <Text
                      style={[
                        styles.fontOptionPreview,
                        option.fontFamily ? { fontFamily: option.fontFamily } : null,
                      ]}
                    >
                      BEFORE / AFTER
                    </Text>
                    {isSelected && <Text style={styles.fontSelectedBadge}>{t('common.selected')}</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Modal>

        {/* Watermark Font Modal */}
        <Modal
          isVisible={watermarkFontModalVisible}
          onBackdropPress={() => setWatermarkFontModalVisible(false)}
          onBackButtonPress={() => setWatermarkFontModalVisible(false)}
          style={styles.bottomModal}
          useNativeDriver
        >
          <View style={styles.customModalSheet}>
            <View style={styles.customModalHeader}>
              <Text style={styles.customModalTitle}>{t('settings.watermarkFont', { defaultValue: 'Watermark Font' })}</Text>
              <TouchableOpacity
                onPress={() => setWatermarkFontModalVisible(false)}
                style={styles.customModalCloseButton}
              >
                <Text style={styles.customModalCloseText}>Γ£ò</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.fontList}>
              {FONT_OPTIONS.map((option) => {
                const isSelected = option.key === watermarkFontFamily;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.fontOptionRow,
                      isSelected && styles.fontOptionRowSelected,
                    ]}
                    onPress={() => {
                      if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                        setWatermarkFontModalVisible(false);
                        navigation.navigate('PlanSelection');
                        return;
                      }
                      updateWatermarkFontFamily(option.key);
                      setWatermarkFontModalVisible(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.fontOptionTitle,
                        option.fontFamily ? { fontFamily: option.fontFamily } : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.fontOptionSubtitle}>{option.description}</Text>
                    <Text
                      style={[
                        styles.fontOptionPreview,
                        option.fontFamily ? { fontFamily: option.fontFamily } : null,
                      ]}
                    >
                      Created with ProofPix.app
                    </Text>
                    {isSelected && <Text style={styles.fontSelectedBadge}>{t('common.selected')}</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Modal>

        {/* hex modal rendered inside color modal */}

        {/* Plan Selection Modal removed — now navigates to PlanSelectionScreen */}


        {/* Language Selection Modal - Bottom Sheet Style */}
        <RNModal
          visible={languageModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setLanguageModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.languageModalOverlay}
            activeOpacity={1}
            onPress={() => setLanguageModalVisible(false)}
          >
            <View style={styles.languageModalContentBottomSheet}>
              {/* Handle Bar */}
              <View style={styles.modalHandle} />
              
              {/* Header */}
              <View style={styles.modalHeaderBottomSheet}>
                <TouchableOpacity
                  style={styles.modalCloseButtonTop}
                  onPress={() => setLanguageModalVisible(false)}
                >
                  <Ionicons name="close" size={24} color={theme.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.modalTitleBottomSheet}>
                  {t('settings.language', { defaultValue: 'Change Language' })}
                </Text>
                <View style={styles.modalCloseButtonTop} />
              </View>

              {/* Language List */}
              <ScrollView style={styles.languageScrollViewBottomSheet} showsVerticalScrollIndicator={true}>
                {LANGUAGES.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    style={styles.languageOptionBottomSheet}
                    onPress={() => {
                      changeLanguage(language.code);
                      updateLabelLanguage(language.code);
                      updateSectionLanguage(language.code);
                    }}
                  >
                    <View style={styles.flagCircle}>
                      <Image
                        source={FLAG_IMAGES[language.code] || FLAG_IMAGES.en}
                        style={styles.languageFlagImages}
                        resizeMode="cover"
                      />
                    </View>
                    <Text style={styles.languageOptionTextBottomSheet}>
                      {language.name}
                    </Text>
                    {i18n.language === language.code && (
                      <View style={styles.checkmarkCircle}>
                        <Ionicons name="checkmark" size={16} color={theme.accentText} />
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </RNModal>

        {/* Enterprise Contact Form Modal */}
        <EnterpriseContactModal
          visible={showEnterpriseModal}
          onClose={() => setShowEnterpriseModal(false)}
        />


        {/* Multiple Accounts Management Modal */}
        <Modal
          isVisible={showMultipleAccountsModal}
          onBackdropPress={() => setShowMultipleAccountsModal(false)}
          onBackButtonPress={() => setShowMultipleAccountsModal(false)}
          style={styles.bottomModal}
          useNativeDriver
        >
          <View style={styles.bottomSheetContainer}>
            <View style={styles.customModalSheet}>
              <View style={styles.customModalHeader}>
                <Text style={styles.customModalTitle}>{t('settings.manageProfiles', { defaultValue: 'Manage Profiles' })}</Text>
                <TouchableOpacity
                  onPress={() => setShowMultipleAccountsModal(false)}
                  style={styles.customModalCloseButton}
                >
                  <Text style={styles.customModalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.customModalScroll}
              >
                <View style={styles.customModalContent}>
                  <Text style={styles.sectionDescription}>
                    {t('settings.multipleAccountsDescription', { defaultValue: 'Connect multiple Google or Dropbox accounts. Each account can have its own team setup.' })}
                  </Text>

                  {/* Connected Accounts List */}
                  {connectedAccounts && connectedAccounts.length > 0 && (
                    <View style={styles.accountsList}>
                      <Text style={styles.accountsListTitle}>
                        {t('settings.connectedAccounts', { defaultValue: 'Connected Accounts' })}
                      </Text>
                      {connectedAccounts.map((account) => {
                        // Use unique key combining id and accountType to avoid duplicate key errors
                        const accountKey = `${account.id}_${account.accountType || 'google'}`;
                        
                        // Scrolling Account Name Component
                        const ScrollingAccountName = ({ text, isActive, onToggle, accountType = 'google' }) => {
                          const scrollX = useRef(new Animated.Value(0)).current;
                          const [needsScrolling, setNeedsScrolling] = useState(false);
                          const textRef = useRef(null);
                          const containerWidth = useRef(null);

                          useEffect(() => {
                            if (textRef.current && containerWidth.current !== null) {
                              const timeout = setTimeout(() => {
                                // Check if ref is still valid before measuring
                                if (!textRef.current) return;
                                textRef.current.measure((x, y, width, height, pageX, pageY) => {
                                  if (width > containerWidth.current - 40) {
                                    setNeedsScrolling(true);
                                    // Start scrolling animation
                                    const animation = Animated.loop(
                                      Animated.sequence([
                                        Animated.delay(1000),
                                        Animated.timing(scrollX, {
                                          toValue: -(width - containerWidth.current + 40),
                                          duration: 3000,
                                          useNativeDriver: true,
                                        }),
                                        Animated.delay(500),
                                        Animated.timing(scrollX, {
                                          toValue: 0,
                                          duration: 3000,
                                          useNativeDriver: true,
                                        }),
                                      ])
                                    );
                                    animation.start();
                                    return () => {
                                      animation.stop();
                                    };
                                  }
                                });
                              }, 100);
                              return () => {
                                clearTimeout(timeout);
                                scrollX.stopAnimation();
                              };
                            }
                          }, [text, scrollX]);

                          // Icon component for account type
                          const AccountIcon = () => {
                            if (accountType === 'dropbox') {
                              return (
                                <View style={styles.accountIconContainer}>
                                  <View style={[styles.accountIcon, styles.dropboxIcon]}>
                                    <Text style={styles.accountIconText}>D</Text>
                                  </View>
                                </View>
                              );
                            } else if (accountType === 'apple') {
                              return (
                                <View style={styles.accountIconContainer}>
                                  <View style={[styles.accountIcon, styles.appleIcon]}>
                                    <Image source={require('../../assets/icons/apple.png')} style={{ width: 20, height: 20 }} />
                                  </View>
                                </View>
                              );
                            } else {
                              // Google (default)
                              return (
                                <View style={styles.accountIconContainer}>
                                  <View style={[styles.accountIcon, styles.googleIcon]}>
                                    <Text style={styles.accountIconText}>G</Text>
                                  </View>
                                </View>
                              );
                            }
                          };

                          return (
                            <View 
                              style={styles.accountNameContainer}
                              onLayout={(e) => {
                                if (e.nativeEvent.layout.width > 0) {
                                  // Account for checkbox width and icon width in container width calculation
                                  const checkboxWidth = 32; // 24px checkbox + 8px padding
                                  const iconWidth = 40; // 32px icon + 8px padding
                                  containerWidth.current = e.nativeEvent.layout.width - checkboxWidth - iconWidth;
                                }
                              }}
                            >
                              <TouchableOpacity
                                style={styles.accountCheckbox}
                                onPress={onToggle}
                              >
                                <View style={[styles.checkbox, isActive ? styles.checkboxActive : styles.checkboxInactive]}>
                                  {isActive && <Text style={styles.accountCheckmark}>✓</Text>}
                                </View>
                              </TouchableOpacity>
                              <View style={styles.accountNameWrapperOuter}>
                                <Animated.View
                                  style={[
                                    styles.accountNameWrapper,
                                    needsScrolling && {
                                      transform: [{ translateX: scrollX }],
                                    },
                                  ]}
                                >
                                  <Text 
                                    ref={textRef}
                                    style={styles.accountEmail}
                                    numberOfLines={1}
                                  >
                                    {text}
                                  </Text>
                                </Animated.View>
                              </View>
                              <AccountIcon />
                            </View>
                          );
                        };

                        return (
                          <View 
                            key={accountKey} 
                            style={[
                              styles.accountItem,
                              account.accountType === 'dropbox' && styles.accountItemDropbox
                            ]}
                          >
                            {/* First line: Account name with scrolling + checkbox + icon */}
                            <ScrollingAccountName
                              text={account.email || account.name}
                              isActive={account.isActive}
                              accountType={account.accountType || 'google'}
                              onToggle={async () => {
                                // Toggle account activation
                                if (!account.isActive) {
                                  // Activate this account - will automatically deactivate the previous one
                                  await handleActivateConnectedAccount(account);
                                }
                              }}
                            />
                            {/* Second line: Buttons - Only show for active account */}
                            {account.isActive && (
                              <View style={styles.accountActionsRow}>
                                {/* Yellow button (left) - Set Up Team */}
                                <TouchableOpacity
                                  style={[
                                    styles.accountActionButton, 
                                    styles.accountActionButtonYellow,
                                    ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || isSigningIn) && styles.buttonDisabled
                                  ]}
                                  onPress={async () => {
                                    setShowMultipleAccountsModal(false);
                                    
                                    const isPro = userPlan === 'pro';
                                    const isBusiness = userPlan === 'business';
                                    const isEnterprise = userPlan === 'enterprise';

                                    // Pro - show popup saying not available
                                    if (isPro) {
                                      Alert.alert(
                                        t('settings.featureUnavailable'),
                                        t('settings.teamSetupFeature')
                                      );
                                      return;
                                    }

                                    // Business - check team member limit
                                    if (isBusiness) {
                                      try {
                                        const maxTeamMembers = getLimit('maxTeamMembers', userPlan);
                                        const currentTeamMembers = inviteTokens?.length || 0;

                                        if (exceedsLimit('maxTeamMembers', userPlan, currentTeamMembers)) {
                                          Alert.alert(
                                            t('settings.teamLimitReached'),
                                            t('settings.teamLimitMessage', { limit: maxTeamMembers })
                                          );
                                          return;
                                        }

                                        if (!isAuthenticated && !isDropboxAuthenticatedForDisplay) {
                                          Alert.alert(t('settings.signInRequired'), t('settings.connectCloudFirst', { defaultValue: 'Please connect a Google or Dropbox account first before setting up team features.' }));
                                          return;
                                        }

                                        await handleSetupTeam();
                                        return;
                                      } catch (error) {
                                        console.error('[SETTINGS] Error in Business handler:', error);
                                        Alert.alert('Error', error.message || 'Failed to setup team');
                                        return;
                                      }
                                    }

                                    // Enterprise - allow unlimited team members
                                    if (isEnterprise) {
                                      if (!isAuthenticated && !isDropboxAuthenticatedForDisplay) {
                                        Alert.alert(t('settings.signInRequired'), t('settings.connectCloudFirst', { defaultValue: 'Please connect a Google or Dropbox account first before setting up team features.' }));
                                        return;
                                      }
                                      await handleSetupTeam();
                                      return;
                                    }
                                  }}
                                  disabled={isSigningIn || ((!userPlan || userPlan === 'starter') || userPlan === 'pro')}
                                >
                                  <Text style={[
                                    styles.accountActionButtonText, 
                                    styles.accountActionButtonTextYellow,
                                    ((!userPlan || userPlan === 'starter') || userPlan === 'pro') && styles.buttonTextDisabled
                                  ]}>
                                    {t('settings.setUpTeam', { defaultValue: 'Set Up Team' })}
                                  </Text>
                                </TouchableOpacity>
                                {/* Light red button (right) - Disconnect */}
                                <TouchableOpacity
                                  style={[styles.accountActionButton, styles.accountActionButtonDisconnect]}
                                  onPress={() => handleDisconnectActiveAccount(account)}
                                  disabled={isSigningIn}
                                >
                                  <Text style={[styles.accountActionButtonText, styles.accountActionButtonTextDisconnect]}>
                                    {t('settings.disconnect', { defaultValue: 'Disconnect' })}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Add Account Buttons - For Enterprise: Always show both buttons. For others: Hide if account type is already connected */}
                  <View style={styles.addAccountButtons}>
                    {/* Check if Google account is already connected in connectedAccounts */}
                    {/* For Enterprise: Always show (can have multiple accounts). For others: Only show if not connected */}
                    {isGoogleSignInAvailable && (userPlan === 'enterprise' || !connectedAccounts?.some(acc => acc.accountType === 'google' || (!acc.accountType && acc.id))) && (
                      <TouchableOpacity
                        style={[styles.featureButton, styles.connectGoogleButton]}
                        onPress={async () => {
                          try {
                            setIsSigningIn(true);
                            await adminSignIn();
                            // The account will be automatically added via AdminContext
                          } catch (error) {
                            console.error('[SETTINGS] Error adding Google account:', error);
                            Alert.alert(
                              t('common.error'),
                              t('settings.addAccountError', { defaultValue: 'Failed to add account. Please try again.' })
                            );
                          } finally {
                            setIsSigningIn(false);
                          }
                        }}
                        disabled={isSigningIn}
                      >
                        {isSigningIn ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={[styles.featureButtonText, styles.connectGoogleButtonText]}>
                            {t('settings.connectGoogle', { defaultValue: 'Connect Google Account' })}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}

                    {/* Check if Dropbox account is already connected in connectedAccounts */}
                    {/* For Enterprise: Always show (can have multiple accounts). For others: Only show if not connected */}
                    {dropboxAuthService.isConfigured() && (userPlan === 'enterprise' || !connectedAccounts?.some(acc => acc.accountType === 'dropbox')) && (
                      <TouchableOpacity
                        style={[styles.featureButton, styles.connectDropboxButton]}
                        onPress={async () => {
                          try {
                            setIsSigningInDropbox(true);
                            const result = await dropboxAuthService.signIn();
                            
                            // Find or create ProofPix folder
                            try {
                              const folderPath = await dropboxService.findOrCreateProofPixFolder();
                              console.log('[DROPBOX] Folder ready:', folderPath);
                            } catch (folderError) {
                              console.error('[DROPBOX] Folder creation error:', folderError);
                              // Don't fail the sign-in if folder creation fails
                            }

                            // Update state - reload tokens to ensure state is accurate
                            await dropboxAuthService.loadStoredTokens();
                            const isAuth = dropboxAuthService.isAuthenticated();
                            const userInfo = dropboxAuthService.getUserInfo();
                            
                            setIsDropboxAuthenticated(isAuth);
                            setDropboxUserInfo(userInfo);
                            
                            if (isAuth && userInfo) {
                              // Add Dropbox account to connectedAccounts for enterprise
                              if (upsertConnectedAccount) {
                                try {
                                  const dropboxAccount = {
                                    id: userInfo.account_id || userInfo.email || `dropbox_${Date.now()}`,
                                    email: userInfo.email,
                                    name: userInfo.name?.display_name || userInfo.name?.given_name || userInfo.email,
                                    givenName: userInfo.name?.given_name || userInfo.name?.display_name,
                                    photo: null,
                                  };
                                  
                                  // Check if this should be the active account (if no active account exists)
                                  const hasActiveAccount = connectedAccounts?.some(acc => acc.isActive);
                                  
                                  await upsertConnectedAccount(dropboxAccount, {
                                    accountType: 'dropbox',
                                    userMode: userMode || 'admin',
                                    isActive: !hasActiveAccount, // Activate if no other active account
                                  });
                                  console.log('[DROPBOX] Account added to connected accounts');
                                } catch (accountError) {
                                  console.error('[DROPBOX] Error adding account to connected accounts:', accountError);
                                }
                              }
                              
                              Alert.alert(
                                t('common.success'),
                                t('settings.dropboxConnected', { defaultValue: 'Dropbox account connected successfully!' })
                              );
                            }
                          } catch (error) {
                            console.error('[SETTINGS] Error connecting Dropbox:', error);
                            Alert.alert(
                              t('common.error'),
                              t('settings.dropboxConnectionError', { defaultValue: 'Failed to connect Dropbox account. Please try again.' })
                            );
                          } finally {
                            setIsSigningInDropbox(false);
                          }
                        }}
                        disabled={isSigningInDropbox}
                      >
                        {isSigningInDropbox ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={[styles.featureButtonText, styles.connectDropboxButtonText]}>
                            {t('settings.connectDropbox', { defaultValue: 'Connect Dropbox Account' })}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Test Tools Modal - Available after 8-tap unlock */}
        {devToolsUnlocked && (
          <Modal
            isVisible={showTestToolsModal}
            onBackdropPress={() => setShowTestToolsModal(false)}
            onBackButtonPress={() => setShowTestToolsModal(false)}
            style={styles.bottomModal}
            useNativeDriver
          >
            <View style={styles.bottomSheetContainer}>
              <View style={styles.customModalSheet}>
                <View style={styles.customModalHeader}>
                  <Text style={styles.customModalTitle}>🧪 Trial Test Tools</Text>
                  <TouchableOpacity
                    onPress={() => setShowTestToolsModal(false)}
                    style={styles.customModalCloseButton}
                  >
                    <Text style={styles.customModalCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.customModalScroll}
                >
                    <View style={styles.customModalContent}>
                    <View style={styles.testButtons}>
                      {/* Plan override — flip local userPlan without an IAP.
                          Every feature gate reads userPlan, so tapping one of
                          these instantly unlocks Pro / Business / Enterprise
                          UI + capabilities for the current session. No sub
                          required; no receipt validation. Use for feature QA
                          on TestFlight where production subs can't be
                          restored. Current plan is shown in the button label. */}
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#666', marginBottom: 6, marginTop: 2 }}>
                        Plan override (current: {userPlan || 'starter'})
                      </Text>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#607D8B' }]}
                        onPress={async () => {
                          await updateUserPlan('starter');
                          Alert.alert('Plan set', 'userPlan → starter. Free-tier gates active.');
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Set → Starter (Free)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#F2C31B' }]}
                        onPress={async () => {
                          await updateUserPlan('pro');
                          Alert.alert('Plan set', 'userPlan → pro. All Pro features unlocked.');
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#1E1E1E' }]}>Set → Pro</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#4CAF50' }]}
                        onPress={async () => {
                          await updateUserPlan('business');
                          Alert.alert('Plan set', 'userPlan → business. Team + Pro features unlocked.');
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Set → Business</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#3F51B5' }]}
                        onPress={async () => {
                          await updateUserPlan('enterprise');
                          Alert.alert('Plan set', 'userPlan → enterprise. All features unlocked.');
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Set → Enterprise</Text>
                      </TouchableOpacity>
                      <View style={{ height: 12 }} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#666', marginBottom: 6 }}>
                        Trial simulation
                      </Text>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay0();
                          Alert.alert('Test Set', 'Day 0 set. Restart app to see "Document Your First Job".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 0 — First Job</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay1();
                          Alert.alert('Test Set', 'Day 1 set. Restart app to see "Complete Your First Before & After".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 1 — Before & After</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay7_10();
                          Alert.alert('Test Set', 'Day 2 set. Restart app to see "Create Your First Professional Report".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 2 — Report</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay15();
                          Alert.alert('Test Set', 'Day 3 set. Restart app to see "Promote Your Brand".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 3 — Branding</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay22_24();
                          Alert.alert('Test Set', 'Day 4 set. Restart app to see "Never Lose Job Photos Again".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 4 — Cloud</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay27_28();
                          Alert.alert('Test Set', 'Day 5 set. Restart app to see "Need More Trial Time?".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 5 — Referral</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          const TrialTestUtils2 = await import('../utils/trialTestUtils');
                          await TrialTestUtils2.setTrialDaysRemaining(1, 'business');
                          Alert.alert('Test Set', 'Day 6 set. Restart app to see "Your Trial Ends Tomorrow".');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 6 — Last Chance</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay30();
                          Alert.alert(
                            'Test Set',
                            'Trial set to expired. Restart app to see the expiration message.'
                          );
                        }}
                      >
                        <Text style={styles.testButtonText}>Expired</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#FF0000' }]}
                        onPress={async () => {
                          await TrialTestUtils.testDay30();
                          Alert.alert(
                            'Test Set',
                            'Trial set to expired. Restart app to see the full expiration flow.'
                          );
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Test Expired Flow</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#FF9800' }]}
                        onPress={async () => {
                          const { clearReferralDataForTesting } = await import('../services/referralService');
                          const success = await clearReferralDataForTesting();
                          if (success) {
                            Alert.alert('Reset Complete', 'Referral data cleared. You can now test referral codes again.');
                          } else {
                            Alert.alert('Error', 'Failed to reset referral data.');
                          }
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Reset Referral Data</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#795548' }]}
                        onPress={async () => {
                          await TrialTestUtils.clearTrial();
                          Alert.alert(
                            'Trial Reset',
                            'Trial data cleared. The next time you go through onboarding and reach the plan selection screen, the free trial banner and confirmation dialog will appear again (30 or 45 days depending on referral).'
                          );
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Reset Trial</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#D32F2F' }]}
                        onPress={async () => {
                          const success = await TrialTestUtils.expireTrialForReferralTest();
                          if (success) {
                            Alert.alert(
                              'Trial Expired',
                              'Trial set to expired state. Go to FirstLoad screen (reset app data or use Reset Trial first, then restart) to test the referral popup.\n\nNote: The referral popup only shows if:\n1. Trial is expired\n2. No paid subscription\n3. No referral code already applied'
                            );
                          } else {
                            Alert.alert('Error', 'Failed to expire trial.');
                          }
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Expire Trial (Test Referral)</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#4CAF50' }]}
                        onPress={async () => {
                          const { simulateFriendSignup } = await import('../services/referralService');
                          const success = await simulateFriendSignup();
                          if (success) {
                            Alert.alert('Success', 'Friend signup simulated! Check Settings > Referral to see your reward stats.');
                          } else {
                            Alert.alert('Error', 'Failed to simulate friend signup. Check console for details.');
                          }
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Simulate Friend Signup</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#2196F3' }]}
                        onPress={async () => {
                          const { checkAndApplyReferralRewards } = await import('../services/referralService');
                          const rewardsApplied = await checkAndApplyReferralRewards();
                          if (rewardsApplied > 0) {
                            const { getTrialDaysRemaining } = await import('../services/trialService');
                            const daysRemaining = await getTrialDaysRemaining();
                            Alert.alert(
                              'Rewards Applied!',
                              `Applied ${rewardsApplied} reward(s) (+${rewardsApplied * 30} days).\n\nYour trial now has ${daysRemaining} days remaining.`
                            );
                          } else {
                            Alert.alert('No Rewards', 'No pending rewards to apply.');
                          }
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Apply Referral Rewards</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#9C27B0' }]}
                        onPress={handleFillTeamMembersToMax}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Fill Team to Max</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#E91E63' }]}
                        onPress={handleClearAllTeamMembers}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Clear All Team Members</Text>
                      </TouchableOpacity>

                      {/* Heals Before/After/Progress photos whose `uri`
                          was overwritten with a side-by-side composite
                          by the pre-fix Source Photos picker. Looks up
                          the original AFTER/BEFORE/PROGRESS bitmap by
                          filename pattern in the Keychain asset-id-map
                          (with a MediaLibrary album scan fallback) and
                          re-links the photo record to it. Safe to run
                          multiple times — only touches photos whose uri
                          filename currently has COMBINED_BASE/EDIT. */}
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#3F51B5' }]}
                        onPress={async () => {
                          Alert.alert(
                            'Repair Photo URIs',
                            'Scan all photos and re-link any Before/After/Progress whose stored uri was overwritten with a side-by-side composite. Restart the app after to refresh the in-memory list.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Repair',
                                onPress: async () => {
                                  setShowTestToolsModal(false);
                                  try {
                                    const { repairCorruptedPhotoUris } = await import('../services/storage');
                                    const r = await repairCorruptedPhotoUris();
                                    Alert.alert(
                                      'Repair done',
                                      `Scanned ${r.total} photo(s).\nContaminated: ${r.scanned}.\nRepaired: ${r.repaired}.\nUnrecoverable: ${r.unrecoverable}.\n\nRestart the app to see the restored thumbnails in Timeline.`
                                    );
                                  } catch (err) {
                                    console.error('[Repair Photo URIs] failed', err);
                                    Alert.alert('Repair failed', String(err?.message || err));
                                  }
                                },
                              },
                            ]
                          );
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>🛠 Repair Photo URIs</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
        </Modal>
        )}

        {/* Manage Team Modal */}
        <Modal
          isVisible={showManageTeamModal}
          onBackdropPress={() => {
            // Don't reset teamNameInput - preserve it for next time
            setShowManageTeamModal(false);
          }}
          onBackButtonPress={() => {
            // Don't reset teamNameInput - preserve it for next time
            setShowManageTeamModal(false);
          }}
          style={styles.bottomModal}
          useNativeDriver
          avoidKeyboard={true}
          onModalWillShow={() => {
            // Initialize team name when modal is about to show (before animation)
            // This ensures it's set even if teamName changed
            setTeamNameInput(teamName || '');
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
          <View style={styles.bottomSheetContainer}>
            <View style={styles.customModalSheet}>
              <View style={styles.customModalHeader}>
                <Text style={styles.customModalTitle}>
                  {showTestNameInput
                    ? t('settings.testTeamMember', { defaultValue: 'Test Team Member' })
                    : t('settings.manageTeam', { defaultValue: 'Manage Team' })
                  }
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (showTestNameInput) {
                      setShowTestNameInput(false);
                      setTestMemberName('');
                      setCurrentTestToken(null);
                    } else {
                      setShowManageTeamModal(false);
                    }
                  }}
                  style={styles.customModalCloseButton}
                >
                  <Text style={styles.customModalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Test Name Input View */}
              {showTestNameInput ? (
                <View style={styles.customModalContent}>
                  <Text style={styles.testModalSubtitle}>
                    {t('settings.testTeamMemberDescription', {
                      defaultValue: 'Enter a name to simulate the complete team member setup process.',
                    })}
                  </Text>
                  <TextInput
                    style={styles.testNameInput}
                    placeholder={t('settings.testTeamMemberPlaceholder', {
                      defaultValue: 'Enter team member name',
                    })}
                    placeholderTextColor={COLORS.GRAY}
                    value={testMemberName}
                    onChangeText={setTestMemberName}
                    autoFocus={true}
                    onSubmitEditing={handleTestJoinWithName}
                  />
                  <View style={styles.testModalButtons}>
                    <TouchableOpacity
                      style={[styles.testModalButton, styles.testModalButtonCancel]}
                      onPress={() => {
                        setShowTestNameInput(false);
                        setTestMemberName('');
                        setCurrentTestToken(null);
                      }}
                      disabled={isTestingInvite}
                    >
                      <Text style={styles.testModalButtonTextCancel}>
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.testModalButton, styles.testModalButtonJoin]}
                      onPress={handleTestJoinWithName}
                      disabled={!testMemberName.trim() || isTestingInvite}
                    >
                      {isTestingInvite ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text
                          style={[
                            styles.testModalButtonTextJoin,
                            (!testMemberName.trim() || isTestingInvite) &&
                              styles.testModalButtonTextDisabled,
                          ]}
                        >
                          {t('settings.testTeamMemberJoin', { defaultValue: 'Join' })}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.customModalScroll}
              >
                <View style={styles.customModalContent}>
                  {/* Team Name */}
                  <View style={styles.teamManagementSection}>
                    <Text style={styles.teamManagementLabel}>{t('settings.teamName', { defaultValue: 'Team Name' })}</Text>
                    <TextInput
                      style={styles.teamNameInput}
                      value={teamNameInput}
                      onChangeText={(text) => {
                        setTeamNameInput(text);
                      }}
                      placeholder={t('settings.enterTeamName', { defaultValue: 'Enter team name' })}
                      placeholderTextColor="#999"
                    />
                  </View>

              {/* Team Invites */}
                  <View style={styles.teamManagementSection}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={styles.teamManagementLabel}>{t('settings.teamInvites', { defaultValue: 'Team Invites' })}</Text>
                      {(() => {
                        // Remaining slots = plan limit - existing members (global for Enterprise, local for others)
                        let usedCount = 0;
                        let limit = planLimit || 0;

                        if (userPlan === 'enterprise') {
                          const localCount = teamMembersList?.length || 0;
                          const globalCount = globalTeamMemberCount || 0;
                          usedCount = globalCount > 0 ? globalCount : localCount;
                        } else {
                          usedCount = teamMembersList?.length || 0;
                          // Fallback limits if planLimit is not set
                          if (!limit) {
                            if (userPlan === 'business') {
                              limit = 5;
                            } else {
                              limit = 0;
                            }
                          }
                        }

                        const remainingSlots = Math.max(0, limit - usedCount);

                        return (
                          <Text style={styles.inviteCountText}>
                            {t('settings.invitesRemaining', {
                              count: remainingSlots,
                              defaultValue: '{{count}} remaining',
                            })}
                          </Text>
                        );
                      })()}
                    </View>
                    {loadingTeamMembers ? (
                      <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginVertical: 10 }} />
                    ) : (
                      <>
                        {(() => {
                          const unusedInvites = (inviteTokens || []).filter(token => {
                            const isUsedByMember = teamMembersList.some(member => member.token === token);
                            return !isUsedByMember;
                          });
                          return unusedInvites.length > 0 ? (
                            <ScrollView style={styles.invitesScrollContainer} nestedScrollEnabled={true}>
                              {unusedInvites.map((item) => (
                                <View key={item} style={styles.inviteItemFull}>
                                  <View style={styles.tokenContainer}>
                                    <Text style={styles.tokenLabel}>
                                      {t('settings.inviteCodeShort', { defaultValue: 'Code:' })}
                                    </Text>
                                    <Text style={styles.inviteToken} selectable>{item}</Text>
                                  </View>
                                  <View style={styles.buttonGroup}>
                                    <TouchableOpacity onPress={() => handleCopyToken(item)} style={styles.actionButton}>
                                      <Text style={styles.copyButton}>
                                        {t('settings.copy', { defaultValue: 'Copy' })}
                                      </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleShareInvite(item)} style={styles.actionButton}>
                                      <Text style={styles.shareButton}>
                                        {t('settings.share', { defaultValue: 'Share' })}
                                      </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => handleTestInvite(item)}
                                      style={[styles.actionButton, (isTestingInvite || showTestNameInput) && styles.buttonDisabled]}
                                      disabled={isTestingInvite || showTestNameInput}
                                    >
                                      <Text
                                        style={[
                                          styles.testButton,
                                          (isTestingInvite || showTestNameInput) && styles.buttonTextDisabled,
                                        ]}
                                      >
                                        {t('settings.testInvite', { defaultValue: 'Test' })}
                                      </Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => handleDeleteInvite(item)}
                                      style={[styles.actionButton, styles.deleteButtonContainer]}
                                    >
                                      <Text style={styles.deleteButton}>✕</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              ))}
                            </ScrollView>
                          ) : (
                            <Text style={styles.emptyText}>{t('settings.noInvites', { defaultValue: 'No invites yet.' })}</Text>
                          );
                        })()}
                      </>
                    )}
                    {(() => {
                      const slotsFilledResult = areAllSlotsFilledWithMembers();
                      const canAddMoreResult = canAddMoreInvitesLocal();
                      const isPaidPlan = userPlan === 'business' || userPlan === 'enterprise';

                      if (slotsFilledResult && isPaidPlan) {
                        return (
                          <TouchableOpacity style={styles.addMemberButton} onPress={handleOpenAddMemberModal}>
                            <Text style={styles.addMemberButtonText}>
                              {t('settings.addTeamMemberButton', { defaultValue: 'Add Team Member' })}
                            </Text>
                            <Text style={styles.addMemberButtonPrice}>
                              ${getPricePerMember()}/member
                            </Text>
                          </TouchableOpacity>
                        );
                      } else if (canAddMoreResult) {
                        return (
                          <TouchableOpacity style={styles.generateButton} onPress={handleGenerateInvite}>
                            <Text style={styles.generateButtonText}>
                              {t('settings.generateNewInvite', { defaultValue: 'Generate New Invite' })}
                            </Text>
                          </TouchableOpacity>
                        );
                      }
                      return null;
                    })()}
                  </View>

                  {/* Team Members */}
                  <View style={styles.teamManagementSection}>
                    <Text style={styles.teamManagementLabel}>{t('settings.teamMembers', { defaultValue: 'Team Members' })}</Text>
                    {loadingTeamMembers ? (
                      <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginVertical: 10 }} />
                    ) : (
                      <>
                        {teamMembersList && teamMembersList.length > 0 ? (
                          <ScrollView style={styles.teamMembersScrollContainer} nestedScrollEnabled={true}>
                            {teamMembersList.map((item, index) => {
                              const memberToken = item.token;
                              // If the team member has a token, they should have a revoke button
                              // Don't rely on inviteTokens which can be stale due to React state batching
                              const showRevokeButton = memberToken && memberToken.length > 0;
                              return (
                                <View key={`member-${index}-${memberToken || index}`} style={styles.memberCard}>
                                  {/* First row: Name and Revoke button */}
                                  <View style={styles.memberCardRow}>
                                    <Text style={styles.memberName}>
                                      {item.name ||
                                        t('settings.unknownMemberName', { defaultValue: 'Unknown' })}
                                    </Text>
                                    {showRevokeButton && (
                                      <TouchableOpacity
                                        onPress={async () => {
                                          Alert.alert(
                                            t('settings.revokeAccessTitle', {
                                              defaultValue: 'Revoke Access',
                                            }),
                                            t('settings.revokeAccessMessage', {
                                              defaultValue:
                                                'This will remove this team member and revoke their access. They will no longer be able to upload using this code.',
                                            }),
                                            [
                                              { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                                              {
                                                text: t('settings.revokeAccessButton', {
                                                  defaultValue: 'Revoke',
                                                }),
                                                style: 'destructive',
                                                onPress: async () => {
                                                  try {
                                                    if (proxySessionId) {
                                                      // Try to remove the team member from proxy server (if endpoint exists)
                                                      try {
                                                        await proxyService.removeTeamMember(proxySessionId, memberToken);
                                                      } catch (memberError) {
                                                        console.log('[SETTINGS] Team member removal not supported by server, will remove via token only');
                                                      }
                                                      // Remove the invite token from proxy server (this should also remove the member)
                                                      await proxyService.removeInviteToken(proxySessionId, memberToken);
                                                    }
                                                    // Remove from local state
                                                    await removeInviteToken(memberToken);
                                                    // Refresh the team members list
                                                    await fetchTeamMembersForModal();
                                                    Alert.alert(
                                                      t('settings.revokeAccessSuccessTitle', {
                                                        defaultValue: 'Access Revoked',
                                                      }),
                                                      t('settings.revokeAccessSuccessMessage', {
                                                        defaultValue:
                                                          'The team member has been removed successfully.',
                                                      })
                                                    );
                                                  } catch (error) {
                                                    console.error('[SETTINGS] Failed to revoke access:', error);
                                                    Alert.alert(
                                                      t('common.error', { defaultValue: 'Error' }),
                                                      t('settings.revokeAccessErrorMessage', {
                                                        defaultValue:
                                                          'Failed to revoke access. Please try again.',
                                                      })
                                                    );
                                                  }
                                                }
                                              }
                                            ]
                                          );
                                        }}
                                        style={styles.revokeButtonSmall}
                                      >
                                        <Text style={styles.revokeButtonText}>Revoke</Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                  {/* Second row: Invite Code */}
                                  {memberToken && (
                                    <View style={styles.memberCardTokenRow}>
                                      <Text style={styles.tokenLabelSmall}>
                                        {t('settings.inviteCodeLabel', {
                                          defaultValue: 'Invite Code: ',
                                        })}
                                      </Text>
                                      <Text style={styles.tokenValueSmall} selectable>{memberToken}</Text>
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </ScrollView>
                        ) : (
                          <Text style={styles.emptyText}>{t('settings.noTeamMembers', { defaultValue: 'No team members yet.' })}</Text>
                        )}
                      </>
                    )}
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.teamManagementButtons}>
                    <TouchableOpacity
                      style={[styles.teamManagementButton, styles.teamManagementButtonCancel]}
                      onPress={() => {
                        setTeamNameInput(''); // Reset input
                        setShowManageTeamModal(false);
                      }}
                    >
                      <Text style={styles.teamManagementButtonTextCancel}>
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.teamManagementButton, styles.teamManagementButtonConfirm]}
                      onPress={async () => {
                        try {
                          // Update team name if changed
                          const trimmedInput = teamNameInput.trim();
                          console.log('[SETTINGS] Confirm pressed - teamNameInput:', trimmedInput, 'current teamName:', teamName);

                          if (trimmedInput && trimmedInput !== (teamName || '')) {
                            console.log('[SETTINGS] Saving team name:', trimmedInput);
                            await updateTeamName(trimmedInput);
                            // Also save to AsyncStorage directly for persistence
                            await AsyncStorage.setItem('@team_name', trimmedInput);
                            console.log('[SETTINGS] Team name saved to AsyncStorage');
                          } else {
                            console.log('[SETTINGS] No team name change detected, skipping save');
                          }
                          setShowManageTeamModal(false);
                          setTeamNameInput('');
                        } catch (error) {
                          console.error('[SETTINGS] Error updating team name:', error);
                          Alert.alert(t('common.error'), t('settings.teamUpdateError', { defaultValue: 'Failed to update team. Please try again.' }));
                        }
                      }}
                    >
                      <Text style={styles.teamManagementButtonTextConfirm}>
                        {t('common.confirm', { defaultValue: 'Confirm' })}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Simple Add Team Member overlay positioned relative to Manage Team modal */}
                  {showAddMemberModal && (
                    <View style={styles.addMemberOverlay}>
                      <TouchableWithoutFeedback onPress={() => setShowAddMemberModal(false)}>
                        <View style={styles.addMemberBackdrop} />
                      </TouchableWithoutFeedback>
                      <View style={styles.addMemberModalContent}>
                        <View style={styles.modalHandle} />
                        <Text style={styles.addMemberModalTitle}>
                          {t('settings.addTeamMembersTitle', { defaultValue: 'Add Team Members' })}
                        </Text>
                        <Text style={styles.addMemberModalSubtitle}>
                          {t('settings.addTeamMembersSubtitle', {
                            plan:
                              userPlan === 'business'
                                ? t('planModal.business', { defaultValue: 'Business' })
                                : t('planModal.enterprise', { defaultValue: 'Enterprise' }),
                            defaultValue:
                              'Purchase additional team member slots for your {{plan}} plan',
                          })}
                        </Text>

                        <View style={styles.memberCountSelector}>
                          <Text style={styles.memberCountLabel}>
                            {t('settings.addTeamMembersCountLabel', {
                              defaultValue: 'Number of Members:',
                            })}
                          </Text>
                          <View style={styles.counterContainer}>
                            <TouchableOpacity
                              style={[styles.counterButton, additionalMembersCount <= 1 && styles.counterButtonDisabled]}
                              onPress={() => setAdditionalMembersCount(Math.max(1, additionalMembersCount - 1))}
                              disabled={additionalMembersCount <= 1}
                            >
                              <Text style={[styles.counterButtonText, additionalMembersCount <= 1 && styles.counterButtonTextDisabled]}>−</Text>
                            </TouchableOpacity>
                            <Text style={styles.memberCountValue}>{additionalMembersCount}</Text>
                            <TouchableOpacity
                              style={styles.counterButton}
                              onPress={() => setAdditionalMembersCount(additionalMembersCount + 1)}
                            >
                              <Text style={styles.counterButtonText}>+</Text>
                            </TouchableOpacity>
                          </View>
                        </View>

                        <View style={styles.priceBreakdown}>
                          <View style={styles.priceRow}>
                            <Text style={styles.priceLabel}>
                              {t('settings.addTeamMembersPricePerMember', {
                                defaultValue: 'Price per member:',
                              })}
                            </Text>
                            <Text style={styles.priceValue}>${getPricePerMember().toFixed(2)}</Text>
                          </View>
                          <View style={styles.priceRow}>
                            <Text style={styles.priceLabel}>
                              {t('settings.addTeamMembersNumberOfMembers', {
                                defaultValue: 'Number of members:',
                              })}
                            </Text>
                            <Text style={styles.priceValue}>×{additionalMembersCount}</Text>
                          </View>
                          <View style={[styles.priceRow, styles.totalPriceRow]}>
                            <Text style={styles.totalPriceLabel}>
                              {t('settings.addTeamMembersTotal', { defaultValue: 'Total:' })}
                            </Text>
                            <Text style={styles.totalPriceValue}>${(getPricePerMember() * additionalMembersCount).toFixed(2)}</Text>
                          </View>
                        </View>

                        <View style={styles.addMemberModalButtons}>
                          <TouchableOpacity
                            style={[styles.modalButton, styles.cancelButton]}
                            onPress={() => setShowAddMemberModal(false)}
                          >
                            <Text style={styles.cancelButtonText}>
                              {t('common.cancel', { defaultValue: 'Cancel' })}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modalButton, styles.purchaseButton]}
                            onPress={handlePurchaseAdditionalMembers}
                          >
                            <Text style={styles.purchaseButtonText}>
                              {t('settings.addTeamMembersConfirm', { defaultValue: 'Add' })}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}

                </View>
              </ScrollView>
              )}
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Switch Account Modal */}
        <Modal
          isVisible={showSwitchAccountModal}
          onBackdropPress={() => setShowSwitchAccountModal(false)}
          onBackButtonPress={() => setShowSwitchAccountModal(false)}
          style={styles.bottomModal}
          useNativeDriver
        >
          <View style={styles.bottomSheetContainer}>
            <View style={styles.customModalSheet}>
              <View style={styles.customModalHeader}>
                <Text style={styles.customModalTitle}>
                  {t('settings.switchCloudAccount', { defaultValue: 'Switch Cloud Account' })}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowSwitchAccountModal(false)}
                  style={styles.customModalCloseButton}
                >
                  <Text style={styles.customModalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.switchAccountModalBody}>
                <Text style={styles.switchAccountMessage}>
                  {pendingAccountType === 'google'
                    ? t('settings.switchToGoogleMessage', { defaultValue: 'You need to disconnect your current Dropbox account before connecting a Google account.' })
                    : t('settings.switchToDropboxMessage', { defaultValue: 'You need to disconnect your current Google account before connecting a Dropbox account.' })
                  }
                </Text>

                {/* Current Account Info */}
                <View style={styles.switchAccountCurrent}>
                  <Image
                    source={pendingAccountType === 'google'
                      ? require('../../assets/dropbox.png')
                      : require('../../assets/Google.png')
                    }
                    style={{ width: 24, height: 24 }}
                    resizeMode="contain"
                  />
                  <View>
                    <Text style={styles.switchAccountCurrentText}>
                      {pendingAccountType === 'google'
                        ? (dropboxUserInfo?.email || 'Dropbox Account')
                        : (adminUserInfo?.email || 'Google Account')
                      }
                    </Text>
                    <Text style={styles.switchAccountCurrentType}>
                      {pendingAccountType === 'google' ? 'Dropbox' : 'Google Drive'}
                    </Text>
                  </View>
                </View>

                <View style={styles.switchAccountButtons}>
                  {/* Disconnect & Connect New */}
                  <TouchableOpacity
                    style={styles.switchAccountDisconnectBtn}
                    onPress={async () => {
                      setShowSwitchAccountModal(false);
                      if (pendingAccountType === 'google') {
                        // Disconnect Dropbox, then connect Google
                        try {
                          await dropboxAuthService.signOut();
                          setIsDropboxAuthenticated(false);
                          setDropboxUserInfo(null);
                        } catch (error) {
                          console.error('[SETTINGS] Error disconnecting Dropbox:', error);
                        }
                        setIsSigningIn(true);
                        try {
                          if (userPlan === 'pro') {
                            await individualSignIn();
                          } else {
                            await adminSignIn();
                          }
                        } catch (error) {
                          console.error('Error during sign in:', error);
                        } finally {
                          setIsSigningIn(false);
                        }
                      } else {
                        // Disconnect Google, then connect Dropbox
                        try {
                          await signOut();
                        } catch (error) {
                          console.error('[SETTINGS] Error disconnecting Google:', error);
                        }
                        setIsSigningInDropbox(true);
                        try {
                          await dropboxAuthService.signIn();
                          try {
                            const folderPath = await dropboxService.findOrCreateProofPixFolder();
                            console.log('[DROPBOX] Folder ready:', folderPath);
                          } catch (folderError) {
                            console.error('[DROPBOX] Folder creation error:', folderError);
                          }
                          await dropboxAuthService.loadStoredTokens();
                          const isAuth = dropboxAuthService.isAuthenticated();
                          const uInfo = dropboxAuthService.getUserInfo();
                          setIsDropboxAuthenticated(isAuth);
                          setDropboxUserInfo(uInfo);
                          Alert.alert(
                            t('settings.dropboxConnected'),
                            t('settings.dropboxConnectedMessage', { email: uInfo?.email || '' }),
                            [{ text: t('common.ok') }]
                          );
                        } catch (error) {
                          console.error('[DROPBOX] Sign-in error:', error);
                          Alert.alert(t('common.error'), error.message || t('settings.dropboxSignInError'));
                        } finally {
                          setIsSigningInDropbox(false);
                        }
                      }
                    }}
                  >
                    <Text style={styles.switchAccountDisconnectText}>
                      {t('settings.disconnectAndConnect', { defaultValue: 'Disconnect & Connect New' })}
                    </Text>
                  </TouchableOpacity>

                  {/* Upgrade to Enterprise */}
                  <TouchableOpacity
                    style={styles.switchAccountUpgradeBtn}
                    onPress={() => {
                      setShowSwitchAccountModal(false);
                      navigation.navigate('PlanSelection');
                    }}
                  >
                    <Text style={styles.switchAccountUpgradeText}>
                      {t('settings.upgradeForMultiple', { defaultValue: 'Upgrade for Multiple Accounts' })}
                    </Text>
                  </TouchableOpacity>

                  {/* Cancel */}
                  <TouchableOpacity
                    style={styles.switchAccountCancelBtn}
                    onPress={() => setShowSwitchAccountModal(false)}
                  >
                    <Text style={styles.switchAccountCancelText}>
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    );
  }

function WatermarkOpacitySlider({ value = 0, onChange, onChangeEnd, onStartShouldSetResponder, fillColor = '#FFD700' }) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingValue, setDraggingValue] = useState(value);
  const trackRef = useRef(null);

  const clamp = (val) => Math.max(0, Math.min(1, val));

  // Use dragging value during drag, otherwise use prop value
  const displayValue = isDragging ? draggingValue : value;

  // Sync draggingValue when value prop changes (but not during drag)
  useEffect(() => {
    if (!isDragging) {
      setDraggingValue(value);
    }
  }, [value, isDragging]);

  const isDraggingRef = useRef(false);
  
  // Sync ref with state
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  const handleGesture = (event, commit = false) => {
    if (!trackWidth || !event || !event.nativeEvent) {
      if (commit && onChangeEnd) {
        onChangeEnd(clamp(displayValue));
        setIsDragging(false);
        isDraggingRef.current = false;
      }
      return;
    }
    
    // Use locationX which is relative to the responder view (the track itself)
    const { locationX } = event.nativeEvent;
    const ratio = clamp(locationX / trackWidth);
    
    // Update local state immediately for smooth dragging - this prevents jumps
    setDraggingValue(ratio);
    
    // Only call onChange if not committing (during drag)
    if (onChange && !commit && isDraggingRef.current) {
      onChange(ratio);
    }
    
    // Call onChangeEnd when commit is true (drag ended)
    if (commit && onChangeEnd) {
      onChangeEnd(ratio);
      setIsDragging(false);
      isDraggingRef.current = false;
    }
  };

  const handleStartShouldSetResponder = () => {
    if (onStartShouldSetResponder) {
      const allow = onStartShouldSetResponder();
      if (allow) {
        setIsDragging(true);
        isDraggingRef.current = true;
        setDraggingValue(value);
      }
      return allow;
    }
    setIsDragging(true);
    isDraggingRef.current = true;
    setDraggingValue(value);
    return true;
  };

  const thumbSize = 20;
  const fillWidth = trackWidth ? clamp(displayValue) * trackWidth : 0;
  const thumbLeft = trackWidth ? clamp(displayValue) * trackWidth - thumbSize / 2 : 0;

  return (
    <View style={sliderStyles.container}>
      <View
        ref={trackRef}
        style={sliderStyles.track}
        onLayout={(event) => {
          const { width } = event.nativeEvent.layout;
          // Only update trackWidth if not dragging to avoid jumps
          if (!isDragging) {
            setTrackWidth(width);
          }
        }}
        onStartShouldSetResponder={handleStartShouldSetResponder}
        onMoveShouldSetResponder={() => isDragging}
        onResponderGrant={(event) => {
          handleGesture(event, false);
        }}
        onResponderMove={(event) => {
          if (isDragging) {
            handleGesture(event, false);
          }
        }}
        onResponderRelease={(event) => {
          if (isDragging) {
            handleGesture(event, true);
          }
        }}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={(event) => {
          if (isDragging) {
            handleGesture(event, true);
            setIsDragging(false);
          }
        }}
      >
        <View
          style={[
            sliderStyles.fill,
            {
              width: fillWidth,
              backgroundColor: fillColor,
            },
          ]}
        />
        <View
          style={[
            sliderStyles.thumb,
            {
              left: Math.max(0, Math.min(trackWidth - thumbSize, thumbLeft)),
              borderColor: fillColor,
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbSize / 2,
            },
          ]}
        />
      </View>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 4,
    paddingRight: 12,
  },
  track: {
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E0E0E0',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    height: '100%',
  },
  thumb: {
    position: 'absolute',
    top: -2,
    borderWidth: 2,
    // sliderStyles lives at module level so `theme` isn't in scope here.
    // The slider thumb stays a plain white knob in both modes — matches
    // the iOS/Android-native slider thumb convention.
    backgroundColor: '#FFFFFF',
    elevation: 2,
  },
});

// Module-scope `theme` was undefined here — the 2-space indent was
// misleading; SettingsScreen closes at ~line 5591 and this const sits
// at file scope. `theme.X` refs added in 40e28f8 threw ReferenceError
// at module load → RCTFatal → expo-updates ErrorRecovery → crash. Wrap
// in a factory called from a useMemo inside SettingsScreen so theme is
// in scope.
const makeStyles = (theme) => StyleSheet.create({
    // Refresh: page bg flipped from tinted #F8F8F8 to plain white per the
    // design's --bg token, so the section cards below sit on a clean
    // canvas instead of competing for contrast with a grey backplate.
    container: {
      flex: 1,
      backgroundColor: theme.background
    },
    header: {
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 12,
      backgroundColor: theme.surfaceElevated,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    // Refresh per design 34: large bold "Settings" headline, weight 800,
    // tighter letter-spacing — reads as the page anchor before the user
    // card. (Same family + color stays; only weight + tracking change.)
    title: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 32,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.6,
    },
    titleTouchable: {
      alignSelf: 'flex-start',
    },
    headerRightCluster: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    headerThemeToggle: {
      width: 36,
      height: 36,
      borderRadius: 999,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerLanguageSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 62,
      paddingHorizontal: 1,
      paddingVertical: 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.09,
      shadowRadius: 15,
      elevation: 3,
    },
    headerLanguageFlag: {
      fontSize: 20,
    },
    headerLanguageFlagImage: {
      width: 28,
      height: 28,
      borderRadius: 14,
      marginRight: 4,
    },
    content: {
      flex: 1
    },
    // Refresh per design 34: section cards are hairline-bordered, with
    // the softer shadow-card recipe (was 8% black drop shadow). Tighter
    // top spacing so the eyebrow above + card below read as one group.
    section: {
      backgroundColor: theme.surfaceElevated,
      marginTop: 10,
      marginHorizontal: 18,
      borderRadius: 16,
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      shadowColor: '#141420',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.04,
      shadowRadius: 14,
      elevation: 2,
    },
    // Section title — used in the body of cards (Folder name, Cleaning
    // service, etc.). Kept large per the existing structure since
    // these are NOT the design's eyebrow ("WORKSPACE" / "CLOUD & TEAM")
    // — the eyebrow style is `sectionEyebrow` below.
    sectionTitle: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 18,
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 2,
      letterSpacing: -0.3,
    },
    // Eyebrow style for the small uppercase group labels above section
    // cards ("WORKSPACE", "CLOUD & TEAM"). Wire any existing top-of-
    // section label that should look like the design to this style.
    sectionEyebrow: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.1,
      color: theme.textMuted,
      textTransform: 'uppercase',
      marginTop: 18,
      marginBottom: 4,
      marginHorizontal: 22,
    },
    inputGroup: {
      marginBottom: 16
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 8
    },
    input: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      padding: 12,
      borderRadius: 8,
      color: COLORS.TEXT
    },
    inputDisabled: {
      opacity: 0.7,
    },
    divider: {
      height: 1,
      backgroundColor: COLORS.BORDER,
      marginVertical: 16,
    },
    locationPicker: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      padding: 12,
      borderRadius: 8
    },
    locationPickerText: {
      color: COLORS.TEXT,
      fontWeight: '600'
    },
    locationPickerArrow: {
      color: COLORS.GRAY
    },
    locationDropdown: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      overflow: 'hidden'
    },
    locationOption: {
      padding: 12,
      paddingRight: 40,
      backgroundColor: 'white',
      position: 'relative'
    },
    locationOptionUseCurrent: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: COLORS.BORDER,
    },
    locationOptionSelected: {
      backgroundColor: theme.surface
    },
    locationOptionText: {
      color: COLORS.TEXT
    },
    locationOptionTextSelected: {
      fontWeight: '700'
    },
    locationOptionCheck: {
      position: 'absolute',
      right: 12,
      top: 12,
      color: COLORS.PRIMARY
    },
    sectionDescription: {
      fontSize: 12,
      color: 'grey',
      marginBottom: 2,
      lineHeight: 20,
    },
    // Account card — design 34 / pp-settings.jsx: flat single-row card,
    // padding 14, flex row + gap 13, centered. avatar | name+sub | tier.
    // Hairline border + softer shadow-card recipe; tappable to open
    // the existing rename modal.
    userAccountCard: {
      backgroundColor: theme.surfaceElevated,
      borderRadius: 16,
      padding: 14,
      marginTop: 14,
      marginHorizontal: 18,
      marginBottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      shadowColor: '#141420',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.06,
      shadowRadius: 18,
      elevation: 3,
    },
    // Yellow disc 52×52 holding 20/800 initials in dark text — copies
    // the "MR" treatment from pp-settings.jsx.
    userAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: '#F2C31B',
      justifyContent: 'center',
      alignItems: 'center',
    },
    userAvatarInitials: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 20,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: 0.3,
    },
    userInfo: {
      flex: 1,
      minWidth: 0,
    },
    userName: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 16,
      fontWeight: '700',
      color: theme.textPrimary,
      marginBottom: 2,
      letterSpacing: -0.2,
    },
    accountType: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 12.5,
      fontWeight: '500',
      color: theme.textMuted,
      letterSpacing: -0.1,
    },
    // Tier pill — proofpix.css: height 30, padding 0 11, radius 999,
    // font 11/700 uppercase. Three variants (free / pro / business)
    // applied on top via plan-specific styles below.
    userTierPill: {
      height: 30,
      paddingHorizontal: 11,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    userTierPillText: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    // .pp-tier--free: surface bg + secondary text.
    userTierPillFree: {
      backgroundColor: theme.surface,
    },
    userTierPillTextFree: {
      color: theme.textSecondary,
    },
    // .pp-tier--pro: accent bg + dark text.
    userTierPillPro: {
      backgroundColor: '#F2C31B',
    },
    userTierPillTextPro: {
      color: theme.textPrimary,
    },
    // .pp-tier--business: dark bg + accent text.
    userTierPillBusiness: {
      backgroundColor: '#1E1E1E',
    },
    userTierPillTextBusiness: {
      color: '#F2C31B',
    },
    // Edit pen no longer rendered (design has none). Kept the style key
    // for backward compatibility with any nested team_member render.
    editButton: {
      padding: 4,
    },
    planInfo: {
      marginBottom: 16,
    },
    planNameRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    planName: {
      fontSize: 20,
      fontWeight: '700',
      color: COLORS.TEXT,
      flex: 1,
    },
    trialProgressContainer: {
      marginBottom: 0,
    },
    trialProgressBar: {
      height: 8,
      borderRadius: 4,
      backgroundColor: '#E5E5E5',
      overflow: 'hidden',
      marginBottom: 8,
    },
    trialProgressFill: {
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      backgroundColor: '#4CAF50',
      borderRadius: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 0 }, // 👈 key part
      shadowOpacity: 0.25,
      shadowRadius: 6,
      elevation: 6,
    },
    trialDaysText: {
      fontSize: 14,
      fontWeight: '500',
      color: 'grey',
    },
    freeBadge: {
      backgroundColor: '#90EE90',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
    },
    freeBadgeText: {
      color: '#228B22',
      fontSize: 12,
      fontWeight: '700',
    },
    // Upgrade banner — pp-settings.jsx: yellow card padding 14, flex row
    // gap 12, centered. Icon tile is rgba(0,0,0,.12) (translucent dark
    // patch on the yellow card) holding a dark star. Title 14.5/800,
    // subtitle 12/600 dark @ 75% opacity, chevron 20.
    upgradeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#F2C31B',
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 14,
      gap: 12,
      marginTop: 12,
      marginHorizontal: 18,
      shadowColor: '#F2C31B',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 5,
    },
    upgradeButtonIconTile: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    upgradeButtonCopy: {
      flex: 1,
      minWidth: 0,
    },
    upgradeButtonTitle: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 14.5,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: -0.2,
      marginBottom: 2,
    },
    upgradeButtonSubtitle: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 12,
      fontWeight: '600',
      color: 'rgba(30,30,30,0.75)',
      letterSpacing: -0.1,
    },
    // Old style kept around in case any other site still references it.
    upgradeButtonText: {
      color: theme.textPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    // Thin contextual banner under the upgrade card — only renders when
    // a trial is active or there's an active sub to manage. Hidden for
    // default Starter so the card stack stays clean per the design.
    planStatusBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 12,
      marginHorizontal: 18,
      paddingVertical: 8,
    },
    // Trial progress strip — sits flush under the user card.
    trialBar: {
      marginHorizontal: 18,
      marginTop: 12,
    },
    // Manage Subscription as a proper row card (icon tile + title + chevron)
    // so it visually belongs with the design's row stack instead of
    // floating as a ghost pill.
    manageSubscriptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 13,
      paddingHorizontal: 14,
      backgroundColor: theme.surfaceElevated,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      marginHorizontal: 18,
      marginTop: 12,
      shadowColor: '#141420',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.04,
      shadowRadius: 12,
      elevation: 1,
    },
    manageSubscriptionIc: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    manageSubscriptionMeta: {
      flex: 1,
      minWidth: 0,
    },
    manageSubscriptionTitle: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 14.5,
      fontWeight: '700',
      color: theme.textPrimary,
      letterSpacing: -0.1,
    },
    manageSubscriptionSub: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 12,
      fontWeight: '500',
      color: theme.textMuted,
      letterSpacing: -0.1,
      marginTop: 1,
    },
    // Small inline link under the Change-plan row — sends the user to
    // Apple's iOS Subscriptions sheet for cancel / billing updates that
    // can't happen inside the app.
    manageInAppStoreLink: {
      alignItems: 'center',
      paddingVertical: 8,
      marginTop: 4,
    },
    manageInAppStoreLinkText: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 12.5,
      fontWeight: '600',
      color: theme.textMuted,
      letterSpacing: -0.1,
      textDecorationLine: 'underline',
    },
    userCardEndAnchor: {
      height: 0,
    },
    // Row group container — design 34: 3 rows per group sit in a single
    // column with 8-px gap, on the page background (no card around
    // them). 18-px horizontal margin matches the cards above.
    rowGroup: {
      marginHorizontal: 18,
      marginBottom: 6,
      gap: 8,
    },
    // SettingRow — pp-settings.jsx `.pp-row` ported to RN: hairline
    // bordered row card with a 42×42 icon tile + title/subtitle stack +
    // chevron (or right-side text/badge). Padding 13 14.
    ppRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingVertical: 13,
      paddingHorizontal: 14,
      backgroundColor: theme.surfaceElevated,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      shadowColor: '#141420',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.04,
      shadowRadius: 12,
      elevation: 1,
    },
    ppRowIc: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ppRowMeta: {
      flex: 1,
      minWidth: 0,
    },
    ppRowTitle: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 14.5,
      fontWeight: '700',
      color: theme.textPrimary,
      letterSpacing: -0.1,
    },
    ppRowTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginBottom: 2,
    },
    ppRowSub: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 12,
      fontWeight: '500',
      color: theme.textMuted,
      letterSpacing: -0.1,
      marginTop: 1,
    },
    ppRowRightText: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 13,
      fontWeight: '600',
      color: theme.textMuted,
      letterSpacing: -0.1,
    },
    // Gate badge — small uppercase pill (.pp-pro-badge) tagged on rows
    // that require a higher tier.
    proBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: '#FFF4C2',
    },
    proBadgeText: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 9.5,
      fontWeight: '800',
      color: '#7A5B00',
      letterSpacing: 0.5,
    },
    businessBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: 'rgba(30,30,30,0.1)',
    },
    businessBadgeText: {
      fontFamily: FONTS.ALEXANDRIA,
      fontSize: 9.5,
      fontWeight: '800',
      color: theme.textPrimary,
      letterSpacing: 0.5,
    },
    // Refresh: ghost outline ('.pp-btn--ghost') — 1.5px borderStrong,
    // radius 16 to match the upgrade banner, 16/700 dark text.
    manageSubscriptionButton: {
      backgroundColor: 'transparent',
      borderRadius: 16,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 8,
      borderWidth: 1.5,
      borderColor: theme.borderStrong,
    },
    manageSubscriptionText: {
      color: theme.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: -0.1,
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12
    },
    highlightedSettingRow: {
      backgroundColor: '#FFF8C4', // soft yellow highlight
      borderRadius: 10,
      paddingHorizontal: 12,
      marginHorizontal: -12,
    },
    settingRowStacked: {
      paddingVertical: 12,
      gap: 8,
    },
    settingInfo: {
      flex: 1,
      paddingRight: 16
    },
    settingLabel: {
      color: COLORS.TEXT,
      fontWeight: '600',
      fontSize: 15,
      flexShrink: 1,
    },
    settingDescription: {
      color: COLORS.GRAY,
      fontSize: 12,
      flexShrink: 1,
    },
    optionGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    optionPill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      backgroundColor: 'white',
    },
    optionPillSelected: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    optionPillText: {
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    optionPillTextSelected: {
      color: COLORS.TEXT,
    },
    watermarkCustomization: {
      marginTop: 8,
      marginBottom: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 12,
      backgroundColor: theme.surface,
    },
    watermarkField: {
      marginBottom: 12,
    },
    watermarkFieldLabel: {
      color: COLORS.TEXT,
      fontWeight: '600',
      marginBottom: 6,
    },
    watermarkInput: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: COLORS.TEXT,
    },
    watermarkHelperText: {
      color: COLORS.GRAY,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 4,
    },
    watermarkColorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
      gap: 12,
    },
    watermarkColorInfo: {
      flex: 1,
    },
    watermarkColorValue: {
      color: COLORS.GRAY,
      fontSize: 12,
    },
    watermarkColorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      backgroundColor: 'white',
      gap: 8,
    },
    watermarkColorSwatch: {
      width: 28,
      height: 28,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    watermarkOpacityRow: {
      marginBottom: 16,
    },
    watermarkOpacityControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    watermarkOpacityValue: {
      minWidth: 48,
      textAlign: 'right',
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    contactUsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    contactUsContent: {
      flex: 1,
    },
    contactButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 12,
      marginBottom: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    contactButtonText: {
      color: '#000000',
      fontSize: 16,
      fontWeight: '600'
    },
    highlightedSettingRow: {
      backgroundColor: '#FFF8C4', // soft yellow highlight
      borderRadius: 10,
      paddingHorizontal: 12,
      marginHorizontal: -12,
    },
    highlightedSection: {
      backgroundColor: '#FFF8C4',
      borderColor: '#FFEB3B',
    },
    resetButton: {
      backgroundColor: '#FFE6E6',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 8
    },
    resetButtonText: {
      color: '#CC0000',
      fontSize: 16,
      fontWeight: '600'
    },
    resetDataButton: {
      backgroundColor: 'white',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#FF0000',
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    resetDataButtonText: {
      color: '#FF0000',
      fontSize: 16,
      fontWeight: '600',
    },
    deleteFromStorageHint: {
      marginTop: 16,
      padding: 12,
      borderRadius: 12,
      backgroundColor: '#F9F9F9',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    deleteFromStorageHintTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: COLORS.TEXT,
      marginBottom: 8,
    },
    deleteFromStorageHintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    deleteFromStorageHintCheckboxBox: {
      width: 22,
      height: 22,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: COLORS.PRIMARY,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
      backgroundColor: '#FFFBE6',
    },
    deleteFromStorageHintCheckboxCheck: {
      color: COLORS.PRIMARY,
      fontSize: 14,
      fontWeight: '700',
    },
    deleteFromStorageHintLabel: {
      fontSize: 14,
      color: COLORS.TEXT,
      fontWeight: '500',
    },
    deleteFromStorageHintCaption: {
      fontSize: 12,
      color: COLORS.GRAY,
    },
    googleSignInButton: {
      backgroundColor: '#DB4437', // Google red
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginBottom: 8
    },
    googleSignInButtonText: {
      color: '#FFFFFF', // White text
      fontSize: 16,
      fontWeight: '600'
    },
    buttonDisabled: {
      // Inactive buttons: white background with yellow border (default for Set Up Team)
      backgroundColor: theme.surfaceElevated,
      borderWidth: 2,
      borderColor: COLORS.PRIMARY, // Yellow border
      opacity: 1
    },
    buttonTextDisabled: {
      // Inactive button text: yellow (default for Set Up Team)
      color: COLORS.PRIMARY
    },
    googleButtonDisabled: {
      // Inactive Google button: white background with black border
      backgroundColor: theme.surfaceElevated,
      borderWidth: 2,
      borderColor: '#000000', // Black border
      opacity: 1
    },
    googleButtonTextDisabled: {
      // Inactive Google button text: black
      color: '#000000'
    },
    dropboxButtonDisabled: {
      // Inactive Dropbox button: white background with blue border
      backgroundColor: theme.surfaceElevated,
      borderWidth: 2,
      borderColor: '#0061FF', // Blue border (Dropbox blue)
      opacity: 1
    },
    dropboxButtonTextDisabled: {
      // Inactive Dropbox button text: blue
      color: '#0061FF'
    },
    multipleProfilesButtonDisabled: {
      // Inactive Multiple Profiles button: white background with green border
      backgroundColor: theme.surfaceElevated,
      borderWidth: 2,
      borderColor: '#28a745', // Green border
      opacity: 1
    },
    multipleProfilesButtonTextDisabled: {
      // Inactive Multiple Profiles button text: green
      color: '#28a745'
    },
    currentPlanBox: {
      backgroundColor: theme.surface,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 20,
      marginBottom: 16,
    },
    currentPlanInfo: {
      width: '100%',
    },
    currentPlanLabel: {
      fontSize: 14,
      color: COLORS.GRAY,
      fontWeight: '600',
      marginBottom: 4,
    },
    currentPlanValueContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    currentPlanValue: {
      fontSize: 16,
      color: COLORS.TEXT,
      fontWeight: 'bold'
    },
    trialBadge: {
      fontSize: 14,
      color: '#4CAF50',
      fontWeight: '600',
    },
    trialDaysText: {
      fontSize: 12,
      color: '#4CAF50',
      fontWeight: '500',
      marginTop: 4,
    },
    changePlanText: {
      fontSize: 14,
      color: COLORS.PRIMARY,
      fontWeight: '600'
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end'
    },
    modalContent: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '80%',
      paddingBottom: 20,
      width: '100%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.BORDER
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: COLORS.TEXT
    },
    modalCloseButton: {
      width: 30,
      height: 30,
      justifyContent: 'center',
      alignItems: 'center'
    },
    modalCloseText: {
      fontSize: 24,
      color: COLORS.GRAY
    },
    modalScrollView: {
      paddingHorizontal: 20,
      paddingTop: 20
    },
    planModalContainer: {
      flex: 1,
      backgroundColor: '#F2C31B',
    },
    planModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: '#F2C31B',
      borderBottomWidth: 0,
      borderBottomColor: 'transparent',
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    planModalBackButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 20,
    },
    planModalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: '#000000',
      letterSpacing: -0.3,
    },
    planModalBody: {
      flex: 1,
      position: 'relative',
    },
    planModalScrollView: {
      flex: 1,
    },
    planModalContent: {
      padding: 16,
      paddingBottom: 20,
    },
    planCard: {
      backgroundColor: 'white',
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 2,
      overflow: 'hidden',
    },
    planCardRecommended: {
      borderWidth: 2,
      borderColor: COLORS.PRIMARY,
      shadowColor: COLORS.PRIMARY,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 4,
    },
    planCardSelected: {
      borderWidth: 2.5,
      borderColor: COLORS.PRIMARY,
    },
    planCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    planCardTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: '#000000',
      letterSpacing: -0.5,
    },
    planBadgeFree: {
      backgroundColor: '#81C784',
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 7,
      shadowColor: '#81C784',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 1,
    },
    planBadgePrice: {
      backgroundColor: '#81C784',
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 7,
      shadowColor: '#81C784',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 1,
    },
    planBadgeText: {
      color: 'white',
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    planBadgeTrialRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    planBadgeStrikethrough: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textMuted,
      textDecorationLine: 'line-through',
    },
    planCardDescription: {
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 22,
      marginBottom: 16,
      letterSpacing: -0.2,
    },
    trialSubtext: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.textSecondary,
      marginBottom: 4,
    },
    currentPlanButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 20,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignSelf: 'flex-start',
      marginTop: 4,
      shadowColor: COLORS.PRIMARY,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 3,
      elevation: 2,
    },
    currentPlanButtonText: {
      color: '#000000',
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    recommendedBadge: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    recommendedBadgeText: {
      color: '#000000',
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
    getMoreButton: {
      backgroundColor: '#000000',
      borderRadius: 20,
      paddingVertical: 18,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 5,
    },
    getMoreButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    backLink: {
      marginBottom: 12,
      alignSelf: 'flex-start'
    },
    backLinkText: {
      fontSize: 16,
      color: COLORS.PRIMARY,
      fontWeight: '600'
    },
    planContainer: {
      marginBottom: 20
    },
    planButton: {
      backgroundColor: theme.surfaceElevated, // White background for inactive buttons
      borderRadius: 12,
      padding: 20,
      borderWidth: 2,
      borderColor: COLORS.PRIMARY, // Yellow border for inactive buttons
      alignItems: 'center'
    },
    planButtonSelected: {
      backgroundColor: COLORS.PRIMARY, // Yellow background for active buttons
      borderColor: COLORS.PRIMARY
    },
    planButtonRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    },
    planButtonText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: COLORS.PRIMARY // Yellow text for inactive buttons
    },
    planButtonTextSelected: {
      color: '#000000' // Black text for active buttons
    },
    planSubtext: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      paddingHorizontal: 10
    },
    planPrice: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    expoGoWarning: {
      backgroundColor: '#fff3cd',
      borderWidth: 1,
      borderColor: '#ffc107',
      borderRadius: 8,
      padding: 12,
      marginBottom: 16
    },
    expoGoWarningText: {
      color: '#856404',
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8
    },
    expoGoWarningSubtext: {
      color: '#856404',
      fontSize: 12,
      fontFamily: FONTS.ALEXANDRIA
    },
    adminNote: {
      color: COLORS.GRAY,
      fontSize: 12,
      textAlign: 'center',
      marginTop: 8
    },
    adminInfoBox: {
      backgroundColor: '#F0F8FF',
      borderRadius: 8,
      padding: 12,
      marginBottom: 12
    },
    adminInfoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    activeAccountContainer: {
      flex: 1,
      paddingRight: 8,
      backgroundColor: '#E6F0FF',
      borderRadius: 8,
      padding: 14,
    },
    activeAccountLabel: {
      color: '#3366CC',
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 6,
      textTransform: 'uppercase',
    },
    activeAccountName: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '700',
    },
    activeAccountEmail: {
      color: COLORS.GRAY,
      fontSize: 12,
      marginTop: 4,
    },
    tokenBox: {
      marginTop: 12,
      marginBottom: 12,
      padding: 12,
      borderRadius: 8,
      backgroundColor: '#F8F9FF',
      borderWidth: 1,
      borderColor: '#E0E6F5',
    },
    tokenHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    tokenLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: COLORS.GRAY,
      textTransform: 'uppercase',
    },
    tokenCopyButton: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: '#E0E7FF',
    },
    tokenCopyText: {
      fontSize: 12,
      fontWeight: '600',
      color: '#3843D0',
    },
    tokenValue: {
      fontSize: 13,
      color: COLORS.TEXT,
      fontFamily: FONTS.ALEXANDRIA,
    },
    teamWarningText: {
      color: COLORS.GRAY,
      fontSize: 12,
      marginBottom: 12,
    },
    leaveTeamButton: {
      backgroundColor: '#FFE6E6',
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      marginBottom: 12,
    },
    leaveTeamButtonText: {
      color: '#CC0000',
      fontSize: 14,
      fontWeight: '600',
    },
    connectedAccountsList: {
      marginTop: 16,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: '#D8E1F6',
    },
    connectedAccountsTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 8,
    },
    connectedAccountRow: {
      backgroundColor: theme.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#E0E6F5',
      padding: 12,
      marginBottom: 8,
    },
    connectedAccountRowLast: {
      marginBottom: 0,
    },
    connectedAccountHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    connectedAccountInfo: {
      flex: 1,
      paddingRight: 12,
    },
    connectedAccountName: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 2,
    },
    connectedAccountEmail: {
      fontSize: 12,
      color: COLORS.GRAY,
    },
    accountStatusBadge: {
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    accountStatusActive: {
      backgroundColor: '#E8F5E9',
    },
    accountStatusInactive: {
      backgroundColor: '#FFF4E5',
    },
    accountStatusText: {
      fontSize: 12,
      fontWeight: '600',
    },
    accountStatusTextActive: {
      color: '#2E7D32',
    },
    accountStatusTextInactive: {
      color: '#C77800',
    },
    connectedAccountActions: {
      flexDirection: 'row',
      gap: 8,
    },
    accountActionButton: {
      flex: 1,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: COLORS.PRIMARY,
    },
    accountActionButtonDisabled: {
      opacity: 0.6,
    },
    accountActionButtonText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },
    accountRemoveButton: {
      backgroundColor: '#FFE6E6',
    },
    accountRemoveButtonText: {
      color: '#CC0000',
    },
    disconnectButton: {
      backgroundColor: '#FFE6E6',
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 14,
    },
    disconnectButtonText: {
      color: '#CC0000',
      fontSize: 14,
      fontWeight: '600',
    },
    setupStatusBox: {
      backgroundColor: '#E8F5E9',
      borderRadius: 8,
      padding: 12,
      marginBottom: 12
    },
    setupStatusText: {
      color: '#2E7D32',
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8
    },
    setupDetailsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4
    },
    setupDetailLabel: {
      color: COLORS.GRAY,
      fontSize: 12
    },
    setupDetailValue: {
      color: COLORS.TEXT,
      fontSize: 12,
      maxWidth: '60%'
    },
    signInButton: {
      backgroundColor: '#34A853',
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginBottom: 12,
    },
    signInButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: COLORS.BACKGROUND,
    },
    loadingText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      marginTop: 10,
    },
    loadingSubText: {
      fontSize: 14,
      color: COLORS.GRAY,
      marginTop: 5,
      textAlign: 'center',
    },
    infoText: {
      fontSize: 16,
      color: COLORS.GRAY,
      textAlign: 'center',
      marginBottom: 20,
    },
    setupIncompleteText: {
      color: COLORS.GRAY,
      fontSize: 12,
      textAlign: 'center',
      marginTop: 8,
    },
    featureButton: {
      backgroundColor: COLORS.PRIMARY, // Yellow background for active buttons
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 12,
      marginBottom: 8,
      borderWidth: 0
    },
    dropboxButton: {
      backgroundColor: '#0061FF',
    },
    appleSignInButton: {
      backgroundColor: '#000000', // Apple black
    },
    appleButtonDisabled: {
      backgroundColor: '#999999',
      opacity: 0.6,
    },
    multipleProfilesButton: {
      backgroundColor: '#28a745', // Green background
    },
    featureButtonText: {
      color: '#000000', // Black text for active buttons
      fontSize: 16,
      fontWeight: '600'
    },
    multipleProfilesButtonText: {
      color: '#FFFFFF', // White text for green button
    },
    dropboxButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600'
    },
    appleButtonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600'
    },
    appleButtonTextDisabled: {
      color: '#CCCCCC',
    },
    accountLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4
    },
    connectedIndicatorDropbox: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#0061FF',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8
    },
    connectedCheckmarkDropbox: {
      color: 'white',
      fontSize: 12,
      fontWeight: 'bold'
    },
    connectedIndicatorGoogle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: COLORS.PRIMARY,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8
    },
    connectedCheckmarkGoogle: {
      color: 'white',
      fontSize: 12,
      fontWeight: 'bold'
    },
    dropboxInfoBox: {
      backgroundColor: '#E6F0FF',
      borderWidth: 1,
      borderColor: '#0061FF',
      borderStyle: 'solid'
    },
    dropboxAccountContainer: {
      backgroundColor: '#F0F7FF'
    },
    setupTeamButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 8
    },
    setupTeamButtonText: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600'
    },
    cloudServicesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 12,
    },
    cloudServiceButton: {
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: '40%',
      backgroundColor: 'white',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      minHeight: 56,
    },
    cloudServiceButtonDisabled: {
      opacity: 0.5,
      backgroundColor: theme.surface,
    },
    cloudButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    googleLogo: {
      fontSize: 20,
      fontWeight: '700',
      color: '#4285F4',
      width: 24,
      height: 24,
      textAlign: 'center',
      lineHeight: 24,
    },
    googleCloudButtonIcon: {
      width: 20,
      height: 20,
    },
    dropboxLogo: {
      width: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dropboxLogoInner: {
      width: 20,
      height: 20,
      backgroundColor: '#0061FF',
      borderRadius: 4,
    },
    cloudButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    cloudButtonTextDisabled: {
      color: theme.textMuted,
    },
    teamManagementRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 8,
    },
    teamButton: {
      flex: 1,
      backgroundColor: 'white',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: 'row',
      gap: 8,
      minHeight: 56,
    },
    teamButtonDisabled: {
      opacity: 0.5,
      backgroundColor: theme.surface,
    },
    teamButtonConnected: {
      backgroundColor: '#4CAF50',
      borderColor: '#4CAF50',
    },
    teamButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    teamButtonTextConnected: {
      color: '#FFFFFF',
    },
    teamButtonTextDisabled: {
      color: theme.textMuted,
    },
    switchAccountModalBody: {
      padding: 20,
    },
    switchAccountMessage: {
      fontSize: 15,
      color: theme.textSecondary,
      marginBottom: 16,
      lineHeight: 22,
    },
    switchAccountCurrent: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      flexDirection: 'row',
      alignItems: 'center',
    },
    switchAccountCurrentText: {
      fontSize: 15,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginLeft: 12,
    },
    switchAccountCurrentType: {
      fontSize: 13,
      color: theme.textMuted,
      marginLeft: 12,
    },
    switchAccountButtons: {
      gap: 10,
    },
    switchAccountDisconnectBtn: {
      backgroundColor: '#FFE6E6',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    switchAccountDisconnectText: {
      color: '#CC0000',
      fontSize: 16,
      fontWeight: '600',
    },
    switchAccountUpgradeBtn: {
      backgroundColor: COLORS.PRIMARY || '#F2C31B',
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    switchAccountUpgradeText: {
      color: '#000',
      fontSize: 16,
      fontWeight: '600',
    },
    switchAccountCancelBtn: {
      paddingVertical: 14,
      alignItems: 'center',
    },
    switchAccountCancelText: {
      color: theme.textMuted,
      fontSize: 16,
    },
    connectedStatus: {
      backgroundColor: '#d4edda',
      padding: 12,
      borderRadius: 8,
      marginBottom: 15,
      alignItems: 'center',
    },
    connectedText: {
      color: '#155724',
      fontSize: 14,
      fontWeight: '600',
    },
    teamNameContainer: {
      marginBottom: 15,
    },
    teamNameLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 8,
    },
    teamNameDisplay: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      padding: 12,
    },
    teamNameText: {
      fontSize: 16,
      color: COLORS.TEXT,
      flex: 1,
    },
    teamNameTextPlaceholder: {
      color: COLORS.GRAY,
      fontStyle: 'italic',
    },
    teamNameEditIcon: {
      fontSize: 18,
      marginLeft: 8,
    },
    teamNameEditContainer: {
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      padding: 12,
    },
    teamNameInput: {
      fontSize: 16,
      color: COLORS.TEXT,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 6,
      padding: 10,
      marginBottom: 8,
    },
    teamNameButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
    teamNameButton: {
      backgroundColor: COLORS.PRIMARY,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
    },
    teamNameButtonCancel: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    teamNameButtonText: {
      color: COLORS.TEXT,
      fontSize: 14,
      fontWeight: '600',
    },
    teamNameButtonTextCancel: {
      color: COLORS.GRAY,
    },
    switchModeButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginTop: 12,
      marginBottom: 8,
    },
    switchModeButtonText: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600',
    },
    customSelectorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderRadius: 24,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    customSelectorButtonText: {
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    colorPreviewSwatch: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    colorPreviewSwatchLarge: {
      width: 48,
      height: 48,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      marginRight: 12,
    },
    fontSelectorButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 24,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    fontSelectorButtonText: {
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    fontOptions: {
      flexDirection: 'row',
      gap: 8,
    },
    fontOption: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      backgroundColor: 'white',
    },
    fontOptionSelected: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    fontOptionText: {
      fontSize: 12,
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    fontOptionTextSelected: {
      color: COLORS.TEXT,
    },
    labelPreviewContainer: {
      marginTop: 12,
      alignSelf: 'stretch',
    },
    labelPreview: {
      backgroundColor: theme.surface,
      paddingHorizontal: 6,
      paddingVertical: 9,
      borderRadius: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
    },
    previewLabel: {
      alignItems: 'center',
      minWidth: 0,
    },
    previewLabelText: {
      fontWeight: 'bold',
    },
    previewLabelOption: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 2,
      paddingHorizontal: 2,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: 'transparent',
      flex: 0,
      flexShrink: 0,
      marginHorizontal: 4,
    },
    cornerControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    cornerOptions: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'center',
    },
    cornerOption: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      backgroundColor: theme.surface,
      minWidth: 100,
      alignItems: 'center',
    },
    cornerOptionSelected: {
      borderColor: COLORS.PRIMARY,
      backgroundColor: COLORS.PRIMARY,
    },
    cornerOptionText: {
      fontSize: 14,
      color: COLORS.GRAY,
      fontWeight: '600',
    },
    cornerOptionTextSelected: {
      color: '#000000',
    },
    bottomModal: {
      justifyContent: 'flex-end',
      margin: 0,
    },
    modalHandle: {
      width: 40,
      height: 5,
      backgroundColor: '#ddd',
      borderRadius: 3,
      alignSelf: 'center',
      marginBottom: 16,
    },
    customModalSheet: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 24,
      paddingTop: 4,
      maxHeight: '90%',
    },
    customModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.BORDER,
      paddingTop: Platform.OS === 'ios' ? 28 : 16,
    },
    customModalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: COLORS.TEXT,
    },
    customModalCloseButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    customModalCloseText: {
      fontSize: 16,
      color: COLORS.GRAY,
    },
    customModalContent: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 24,
      gap: 16,
    },
    keyboardAvoiding: {
      flex: 1,
    },
    bottomSheetContainer: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    customModalScroll: {
      paddingBottom: 12,
    },
    colorPicker: {
      width: '100%',
      minHeight: 260,
      justifyContent: 'center',
    },
    colorPreviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    inlineHexContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    inlineHexButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 10,
      paddingHorizontal: 18,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'white',
    },
    inlineHexButtonPressed: {
      backgroundColor: '#EFEFEF',
    },
    inlineHexText: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    inlineDefaultButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      paddingHorizontal: 16,
      paddingVertical: 12,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#f2f2f2',
    },
    inlineDefaultButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    inlineOverlay: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
    },
    inlineOverlayBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    inlineModal: {
      width: '100%',
      backgroundColor: 'white',
      borderRadius: 16,
      paddingHorizontal: 20,
      paddingVertical: 24,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    inlineModalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: COLORS.TEXT,
      marginBottom: 12,
      textAlign: 'center',
    },
    inlineModalInput: {
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      color: COLORS.TEXT,
    },
    inlineModalInputError: {
      borderColor: '#E53935',
    },
    inlineModalErrorText: {
      marginTop: 8,
      color: '#E53935',
      fontSize: 12,
      textAlign: 'center',
    },
    inlineModalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 16,
    },
    inlineModalButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    inlineModalCancel: {
      backgroundColor: 'white',
    },
    inlineModalApply: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    inlineModalCancelText: {
      color: COLORS.TEXT,
      fontSize: 15,
      fontWeight: '600',
    },
    inlineModalApplyText: {
      color: COLORS.TEXT,
      fontSize: 15,
      fontWeight: '600',
    },
    colorCodeInput: {
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 14,
      color: COLORS.TEXT,
    },
    colorCodeInputError: {
      borderColor: '#E53935',
    },
    colorInputErrorText: {
      marginTop: 8,
      color: '#E53935',
      fontSize: 12,
    },
    customApplyButton: {
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 16,
    },
    customApplyButtonText: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600',
    },
    hexModalSheet: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingBottom: 24,
      paddingTop: Platform.OS === 'ios' ? 28 : 16,
    },
    hexModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    hexModalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: COLORS.TEXT,
    },
    hexModalBody: {
      gap: 12,
    },
    hexModalLabel: {
      fontSize: 14,
      color: COLORS.GRAY,
    },
    hexModalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 8,
    },
    hexModalButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    hexModalCancel: {
      backgroundColor: 'white',
    },
    hexModalApply: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    hexModalCancelText: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600',
    },
    hexModalApplyText: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600',
    },
    fontList: {
      maxHeight: 320,
    },
    fontOptionRow: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.BORDER,
      backgroundColor: 'white',
    },
    fontOptionRowSelected: {
      backgroundColor: '#f0f7ff',
      borderLeftWidth: 4,
      borderLeftColor: COLORS.PRIMARY,
      paddingLeft: 16,
    },
    fontOptionTitle: {
      fontSize: 16,
      color: COLORS.TEXT,
      fontWeight: '700',
    },
    fontOptionSubtitle: {
      fontSize: 12,
      color: COLORS.GRAY,
      marginTop: 4,
    },
    fontOptionPreview: {
      fontSize: 14,
      color: COLORS.TEXT,
      marginTop: 8,
    },
    fontSelectedBadge: {
      marginTop: 8,
      alignSelf: 'flex-start',
      backgroundColor: COLORS.PRIMARY,
      color: COLORS.TEXT,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
      fontSize: 12,
      fontWeight: '600',
    },
    // Grid selector styles
    positionGridContainer: {
      flexDirection: 'row',
      gap: 8,
      marginVertical: 16,
    },
    gridHalf: {
      flex: 1,
      gap: 4,
    },
    gridRow: {
      flexDirection: 'row',
      gap: 4,
    },
    gridCell: {
      flex: 1,
      aspectRatio: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#E5E5E5',
      borderRadius: 4,
      borderWidth: 2,
      borderColor: '#CCC',
    },
    gridCellSelected: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    positionGrid: {
      marginTop: 12,
      gap: 4,
    },
    positionGridCell: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 8,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    positionGridCellSelected: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    positionGridText: {
      fontSize: 12,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    // Dummy photo preview styles
    positionPreviewContainer: {
      marginVertical: 8,
      width: '100%',
    },
    positionPreviewBox: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: theme.surface,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    previewHalfBefore: {
      flex: 1,
      backgroundColor: '#D0D0D0',
      position: 'relative',
    },
    previewHalfAfter: {
      flex: 1,
      backgroundColor: '#A0A0A0',
      position: 'relative',
    },
    previewLabel: {
      position: 'absolute',
    },
    // Label customization preview section
    labelPreviewSection: {
      marginVertical: 16,
    },
    customizeButton: {
      backgroundColor: COLORS.PRIMARY,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 16,
    },
    customizeButtonDisabled: {
      backgroundColor: COLORS.BORDER,
      opacity: 0.5,
    },
    customizeButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#000000',
    },
    customizeButtonTextDisabled: {
      color: COLORS.GRAY,
      opacity: 0.6,
    },
    // Margin slider styles
    marginSliderContainer: {
      marginTop: 16,
      marginBottom: 8,
    },
    marginSliderLabel: {
      fontSize: 14,
      color: COLORS.TEXT,
      marginBottom: 8,
    },
    // Language selector styles
    languageSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    languageFlag: {
      fontSize: 20,
    },
    languageFlagImage: {
      width: 28,
      height: 28,
      marginRight: 8,
    },
    languageName: {
      fontSize: 16,
      color: COLORS.TEXT_MUTED,
    },
    languageChangeText: {
      fontSize: 20,
      color: COLORS.TEXT_MUTED,
    },
    // Language modal styles - Bottom Sheet Style
    languageModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    languageModalContentBottomSheet: {
      backgroundColor: theme.surfaceElevated,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      minHeight: '80%',
      maxHeight: '90%',
      paddingBottom: 20,
      width: '100%',
    },
    modalHandle: {
      width: 40,
      height: 4,
      backgroundColor: theme.border,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 8,
      marginBottom: 16,
    },
    modalHeaderBottomSheet: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 16,
      position: 'relative',
    },
    modalCloseButtonTop: {
      width: 32,
      height: 32,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalTitleBottomSheet: {
      fontSize: 18,
      fontWeight: '700',
      fontFamily: FONTS.ALEXANDRIA,
      color: theme.textPrimary,
      flex: 1,
      textAlign: 'center',
    },
    languageScrollViewBottomSheet: {
      maxHeight: Dimensions.get('window').height * 0.8,
    },
    languageOptionBottomSheet: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.divider,
    },
    flagCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 16,
      overflow: 'hidden',
    },
    languageFlagBottomSheet: {
      fontSize: 28,
    },
    languageFlagImages: {
      width: 40,
      height: 40,
    },
    checkmarkCircle: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    languageOptionTextBottomSheet: {
      flex: 1,
      fontSize: 16,
      fontWeight: '400',
      fontFamily: FONTS.ALEXANDRIA,
      color: theme.textPrimary,
    },
    settingButton: {
      backgroundColor: theme.surfaceElevated,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#E5E5E5',
      marginBottom: 6,
    },
    settingText: {
      fontSize: 16,
      color: COLORS.TEXT,
    },
    roomTabsContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      maxHeight: 80,
      marginBottom: 10,
    },
    roomTab: {
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginHorizontal: 4,
      borderRadius: 12,
      backgroundColor: 'white',
      minWidth: 60,
      minHeight: 60,
    },
    roomTabActive: {
      backgroundColor: COLORS.PRIMARY,
    },
    roomIcon: {
      fontSize: 24,
      marginBottom: 4,
    },
    roomTabText: {
      fontSize: 12,
      color: COLORS.GRAY,
    },
    roomTabTextActive: {
      color: COLORS.TEXT,
      fontWeight: '600',
    },
    roomListContainer: {
      marginVertical: 12,
     
    },
    roomListScrollContent: {
      paddingRight: 20,
      gap: 8,
    },
    roomListItem: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 3,
      borderRadius: 10,
      backgroundColor: 'white',
      borderWidth: 1,
      borderColor: 'rgba(0, 0, 0, 0.1)',
      minWidth: 65,
      gap: 6,
    },
    roomListItemActive: {
      backgroundColor: COLORS.PRIMARY,
      borderColor: COLORS.PRIMARY,
    },
    roomListItemText: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.textSecondary,
      textAlign: 'center',
    },
    roomListItemTextActive: {
      color: '#000000',
      fontWeight: '600',
    },
    indentedRow: {
      paddingLeft: 24,
    },
    testToolsButton: {
      backgroundColor: '#FFF3CD',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#FFC107',
      marginTop: 8,
    },
    testToolsButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#856404',
      fontFamily: FONTS.ALEXANDRIA,
    },
    testSection: {
      marginTop: 20,
      marginBottom: 20,
      padding: 16,
      backgroundColor: '#FFF3CD',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#FFC107',
    },
    testSectionTitle: {
      fontSize: 16,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      marginBottom: 12,
      fontFamily: FONTS.ALEXANDRIA,
    },
    testButtons: {
      flexDirection: 'column',
      gap: 8,
    },
    testButton: {
      backgroundColor: COLORS.PRIMARY,
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 8,
      marginBottom: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearButton: {
      backgroundColor: '#DC3545',
    },
    testButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#000000',
      fontFamily: FONTS.ALEXANDRIA,
    },
    referralStatsContainer: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 12,
      marginBottom: 16,
    },
    referralStatCard: {
      flex: 1,
      backgroundColor: 'white',
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: 'row',
      borderColor: theme.border,
      padding: 3,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 10,
    },
    referralStatLabel: {
      fontSize: 12,
      color: COLORS.GRAY,
      textAlign: 'center',
      marginTop: 4,
    },
    referralStatValue: {
      fontSize: 17,
      color: COLORS.TEXT,
      fontWeight: '600',
      textAlign: 'center',
    },
    inviteFriendsButton: {
      backgroundColor: '#000000',
      borderRadius: 32,
      paddingVertical: 16,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    inviteFriendsButtonText: {
      color: '#FFFFFF',
      fontSize: 18,
      fontWeight: '700',
      fontFamily: FONTS.ALEXANDRIA,
    },
    referralCodeContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 28,
      padding: 2,
    },
    referralCodeInput: {
      flex: 1,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 17,
      fontFamily: FONTS.ALEXANDRIA,
      color: COLORS.TEXT,
      backgroundColor: 'white',
    },
    referralApplyButton: {
      backgroundColor: '#000000',
      paddingHorizontal: 28,
      paddingVertical: 14,
      borderRadius: 28,
      minWidth: 70,
    },
    referralApplyButtonDisabled: {
      backgroundColor: '#666666',
      opacity: 0.6,
    },
    referralApplyButtonText: {
      color: '#FFFFFF',
      fontSize: 18,
      fontWeight: '700',
      fontFamily: FONTS.ALEXANDRIA,
    },
    // Account Management Styles
    accountsList: {
      marginTop: 16,
    },
    accountsListTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 12,
    },
    accountItem: {
      backgroundColor: theme.surfaceElevated,
      borderRadius: 12,
      padding: 20,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
      elevation: 2,
    },
    accountItemActive: {
      backgroundColor: '#f0f8ff',
      borderColor: COLORS.PRIMARY,
      borderWidth: 2,
    },
    accountItemDropbox: {
      backgroundColor: '#E6F3FF', // Light blue background for Dropbox accounts
      borderColor: '#0061FF', // Dropbox blue border
    },
    accountNameContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      justifyContent: 'flex-start',
    },
    accountNameWrapperOuter: {
      flex: 1,
      overflow: 'hidden',
      marginLeft: 12,
    },
    accountNameWrapper: {
      flexDirection: 'row',
    },
    accountEmail: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    accountCheckbox: {
      padding: 4,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: {
      backgroundColor: '#4CAF50',
      borderColor: '#4CAF50',
    },
    checkboxInactive: {
      backgroundColor: theme.surfaceElevated,
      borderColor: '#F44336',
    },
    accountCheckmark: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    accountIconContainer: {
      marginLeft: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    googleIcon: {
      backgroundColor: '#4285F4',
      borderColor: '#4285F4',
    },
    dropboxIcon: {
      backgroundColor: '#0061FF',
      borderColor: '#0061FF',
    },
    appleIcon: {
      backgroundColor: '#000000',
      borderColor: '#000000',
    },
    accountIconText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    accountInfo: {
      marginBottom: 12,
    },
    accountTeamName: {
      fontSize: 14,
      color: COLORS.GRAY,
      marginTop: 4,
    },
    accountTeamLimit: {
      fontSize: 14,
      color: COLORS.GRAY,
      marginTop: 4,
    },
    priceContainer: {
      position: 'relative',
      height: 24,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingRight: 8,
    },
    priceContainerWide: {
      width: 173,
    },
    priceBadgeGradient: {
      position: 'absolute',
      right: 0,
      top: 0,
      width: 112,
      height: 24,
      borderRadius: 100,
      opacity: 0.14,
    },
    priceBadgeGradientWide: {
      position: 'absolute',
      right: 0,
      top: 0,
      width: 173,
      height: 24,
      borderRadius: 100,
      opacity: 0.14,
    },
    priceText: {
      fontSize: 14,
      fontWeight: '700',
      fontFamily: 'Alexandria_400Regular',
      color: '#0B8321',
      lineHeight: 20,
      textAlign: 'right',
    },
    accountActiveLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: COLORS.PRIMARY,
      marginTop: 8,
      textTransform: 'uppercase',
    },
    accountActions: {
      flexDirection: 'row',
      gap: 8,
    },
    accountActionsRow: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    // New Google Account Connection Styles
    googleAccountConnection: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
    },
    googleAccountIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      overflow: 'hidden',
    },
    googleAccountIconImage: {
      width: 32,
      height: 32,
    },
    dropboxAccountIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
      overflow: 'hidden',
    },
    dropboxAccountIconImage: {
      width: 32,
      height: 32,
    },
    dropboxIntegrationIcon: {
      width: 20,
      height: 20,
      marginRight: 0,
    },
    dropboxCloudButtonIcon: {
      width: 20,
      height: 20,
    },
    appleAccountIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    googleAccountInfo: {
      flex: 1,
    },
    googleAccountEmail: {
      fontSize: 16,
      fontWeight: '600',
      color: '#000000',
      marginBottom: 4,
    },
    googleAccountStatus: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    dropboxIntegrationButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 16,
    },
    dropboxIntegrationText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#000000',
      marginLeft: 12,
    },
    setupTeamButtonNew: {
      flex: 1,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    setupTeamButtonConnected: {
      backgroundColor: '#4CAF50',
      borderColor: '#4CAF50',
    },
    setupTeamButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    setupTeamButtonTextNew: {
      fontSize: 16,
      fontWeight: '600',
      color: '#000000',
    },
    setupTeamButtonTextConnected: {
      color: '#FFFFFF',
    },
    disconnectButtonNew: {
      flex: 1,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: '#CC0000',
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disconnectButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    disconnectButtonTextNew: {
      fontSize: 16,
      fontWeight: '600',
      color: '#CC0000',
    },
    accountActionButton: {
      flex: 1,
      backgroundColor: COLORS.PRIMARY,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountActionButtonRemove: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: '#e0e0e0',
    },
    accountActionButtonYellow: {
      backgroundColor: '#FFC107',
    },
    accountActionButtonGreen: {
      backgroundColor: '#4CAF50',
    },
    accountActionButtonRed: {
      backgroundColor: '#F44336',
    },
    accountActionButtonDisconnect: {
      backgroundColor: '#FFE6E6',
    },
    accountActionButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: '#FFFFFF',
    },
    accountActionButtonTextRemove: {
      color: theme.textSecondary,
    },
    accountActionButtonTextYellow: {
      color: '#000',
    },
    accountActionButtonTextGreen: {
      color: '#FFFFFF',
    },
    accountActionButtonTextRed: {
      color: '#FFFFFF',
    },
    accountActionButtonTextDisconnect: {
      color: '#CC0000',
    },
    connectGoogleButton: {
      backgroundColor: '#000000',
    },
    connectGoogleButtonText: {
      color: '#FFFFFF',
    },
    connectDropboxButton: {
      backgroundColor: '#0061FF',
    },
    connectDropboxButtonText: {
      color: '#FFFFFF',
    },
    addAccountButtons: {
      marginTop: 16,
      gap: 12,
    },
    addAccountButton: {
      backgroundColor: '#28a745',
      marginTop: 8,
    },
    addAccountButtonText: {
      color: '#FFFFFF',
    },
    teamConnectedBanner: {
      backgroundColor: '#E8F5E9',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#4CAF50',
    },
    teamConnectedBannerText: {
      color: '#2E7D32',
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },
    teamManagementSection: {
      marginBottom: 24,
    },
    teamMembersScrollContainer: {
      maxHeight: 250,
    },
    invitesScrollContainer: {
      maxHeight: 250,
    },
    teamManagementLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 8,
    },
    teamNameInput: {
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: COLORS.TEXT,
      backgroundColor: theme.surfaceElevated,
    },
    inviteItemSimple: {
      backgroundColor: theme.surface,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    inviteTokenText: {
      fontSize: 14,
      color: COLORS.TEXT,
      fontFamily: FONTS.ALEXANDRIA,
    },
    teamMemberItemSimple: {
      backgroundColor: theme.surface,
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    teamMemberNameText: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 4,
    },
    teamMemberTokenText: {
      fontSize: 12,
      color: COLORS.GRAY,
      fontFamily: FONTS.ALEXANDRIA,
    },
    emptyText: {
      fontSize: 14,
      color: COLORS.GRAY,
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 16,
    },
    teamManagementButtons: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 24,
    },
    teamManagementButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 8,
      alignItems: 'center',
    },
    teamManagementButtonCancel: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: COLORS.BORDER,
    },
    teamManagementButtonConfirm: {
      backgroundColor: COLORS.PRIMARY,
    },
    teamManagementButtonTextCancel: {
      color: COLORS.TEXT,
      fontSize: 16,
      fontWeight: '600',
    },
    teamManagementButtonTextConfirm: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    inviteItemFull: {
      flexDirection: 'column',
      paddingVertical: 12,
      paddingHorizontal: 10,
      marginBottom: 10,
      backgroundColor: theme.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
    },
    memberItemFull: {
      flexDirection: 'row',
      paddingVertical: 12,
      paddingHorizontal: 10,
      marginBottom: 10,
      backgroundColor: theme.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    memberCard: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      marginBottom: 10,
      backgroundColor: theme.surfaceElevated,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
    },
    memberCardRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    memberCardTokenRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    tokenLabelSmall: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    tokenValueSmall: {
      fontSize: 12,
      color: '#333',
      fontFamily: FONTS.ALEXANDRIA,
    },
    revokeButtonSmall: {
      backgroundColor: '#ff4444',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    revokeButtonText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
    tokenContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    tokenLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
      marginRight: 8,
    },
    inviteToken: {
      fontSize: 13,
      fontFamily: FONTS.ALEXANDRIA,
      color: '#007bff',
      fontWeight: '600',
      flex: 1,
    },
    buttonGroup: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      gap: 8,
    },
    actionButton: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      backgroundColor: theme.surface,
      alignItems: 'center',
    },
    copyButton: {
      color: '#28a745',
      fontSize: 13,
      fontWeight: '600',
    },
    shareButton: {
      color: '#007bff',
      fontSize: 13,
      fontWeight: '600',
    },
    testButton: {
      color: '#28a745',
      fontSize: 13,
      fontWeight: '600',
    },
    revokeButton: {
      color: '#dc3545',
      fontSize: 13,
      fontWeight: '600',
    },
    revokeButtonContainer: {
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: '#dc3545',
    },
    deleteButton: {
      color: '#dc3545',
      fontSize: 18,
      fontWeight: 'bold',
    },
    deleteButtonContainer: {
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: '#dc3545',
      paddingHorizontal: 8,
      maxWidth: 40,
    },
    generateButton: {
      backgroundColor: '#007bff',
      padding: 15,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 15,
    },
    generateButtonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: 'bold',
    },
    addMemberButton: {
      backgroundColor: theme.surfaceElevated,
      borderWidth: 2,
      borderColor: theme.border,
      borderRadius: 12,
      paddingVertical: 16,
      paddingHorizontal: 32,
      alignItems: 'center',
      marginTop: 15,
      elevation: 2,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    addMemberButtonText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#333',
      fontFamily: FONTS.ALEXANDRIA,
    },
    addMemberButtonPrice: {
      fontSize: 16,
      fontWeight: '600',
      color: '#4CAF50',
      marginTop: 4,
      fontFamily: FONTS.ALEXANDRIA,
    },
    addMemberOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-start',
      alignItems: 'center',
      paddingTop: 80, // position just below the Manage Team modal header
      zIndex: 1000,
      elevation: 10,
    },
    addMemberBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    addMemberModalContent: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      maxHeight: '70%',
      width: '100%',
      marginBottom: 0,
    },
    addMemberModalTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      marginBottom: 8,
      textAlign: 'center',
    },
    addMemberModalSubtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 24,
      textAlign: 'center',
      lineHeight: 20,
    },
    memberCountSelector: {
      marginBottom: 24,
    },
    memberCountLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: COLORS.TEXT,
      marginBottom: 12,
    },
    counterContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
    },
    counterButton: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: '#F2C31B', // yellow to match primary accent
      alignItems: 'center',
      justifyContent: 'center',
    },
    counterButtonDisabled: {
      backgroundColor: '#ccc',
    },
    counterButtonText: {
      color: 'white',
      fontSize: 28,
      fontWeight: 'bold',
    },
    counterButtonTextDisabled: {
      color: theme.textMuted,
    },
    memberCountValue: {
      fontSize: 32,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      minWidth: 60,
      textAlign: 'center',
    },
    priceBreakdown: {
      backgroundColor: theme.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    priceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    priceLabel: {
      fontSize: 15,
      color: theme.textSecondary,
    },
    priceValue: {
      fontSize: 15,
      fontWeight: '600',
      color: COLORS.TEXT,
    },
    totalPriceRow: {
      borderTopWidth: 1,
      borderTopColor: '#ddd',
      paddingTop: 12,
      marginTop: 8,
      marginBottom: 0,
    },
    totalPriceLabel: {
      fontSize: 18,
      fontWeight: 'bold',
      color: COLORS.TEXT,
    },
    totalPriceValue: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#28a745',
    },
    addMemberModalButtons: {
      flexDirection: 'row',
      gap: 12,
    },
    modalButton: {
      flex: 1,
      padding: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cancelButtonText: {
      color: theme.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    purchaseButton: {
      backgroundColor: '#F2C31B', // yellow primary for Add button
    },
    purchaseButtonText: {
      color: '#000',
      fontSize: 16,
      fontWeight: 'bold',
    },
    memberInfo: {
      flex: 1,
    },
    memberName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
      marginBottom: 8,
    },
    inviteCountText: {
      fontSize: 14,
      color: theme.textSecondary,
      fontWeight: '600',
    },
    testModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    testModalContent: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 20,
      width: '100%',
    },
    centeredModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999,
      elevation: 9999,
    },
    centeredModalContent: {
      backgroundColor: 'white',
      borderRadius: 12,
      padding: 24,
      width: '85%',
      maxWidth: 400,
      zIndex: 10000,
      elevation: 10000,
    },
    testModalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 8,
      color: '#333',
    },
    testModalSubtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      marginBottom: 16,
    },
    testNameInput: {
      borderWidth: 1,
      borderColor: COLORS.BORDER,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      marginBottom: 20,
      backgroundColor: theme.surface,
    },
    testModalButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 12,
    },
    testModalButton: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 8,
      minWidth: 80,
      alignItems: 'center',
    },
    testModalButtonCancel: {
      backgroundColor: theme.surface,
    },
    testModalButtonJoin: {
      backgroundColor: COLORS.PRIMARY,
    },
    testModalButtonTextCancel: {
      color: theme.textSecondary,
      fontSize: 16,
      fontWeight: '600',
    },
    testModalButtonTextJoin: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    testModalButtonTextDisabled: {
      color: theme.textMuted,
    },
    restorePurchasesButton: {
      marginTop: 20,
      marginBottom: 10,
      paddingVertical: 12,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    restorePurchasesText: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      textDecorationLine: 'underline',
      fontFamily: FONTS.ALEXANDRIA,
    },
    legalLinksContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 20,
      marginBottom: 20,
      paddingHorizontal: 20,
      flexWrap: 'wrap',
    },
    legalLinkButton: {
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    legalLinkText: {
      fontSize: 12,
      color: theme.textSecondary,
      textAlign: 'center',
      textDecorationLine: 'underline',
      fontFamily: FONTS.ALEXANDRIA,
    },
    legalLinkSeparator: {
      fontSize: 12,
      color: theme.textSecondary,
      marginHorizontal: 8,
      fontFamily: FONTS.ALEXANDRIA,
    },
    versionContainer: {
      alignItems: 'center',
      paddingVertical: 20,
      marginTop: 10,
      gap: 8,
    },
    proofPixBranding: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      justifyContent:'center'
    },
    proofPixLogo: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: COLORS.PRIMARY,
      alignItems: 'center',
      justifyContent: 'center',
    },
    proofPixText: {
      fontSize: 24,
      fontWeight: '700',
      color: theme.textPrimary,
      fontFamily: FONTS.ALEXANDRIA,
    },
    versionText: {
      fontSize: 12,
      color: theme.textMuted,
      fontFamily: FONTS.ALEXANDRIA,
    },
    bottomNavPill: {
      position: 'absolute',
      bottom: 20,
      left: 12,
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f4f4f4',
      borderRadius: 296,
      height: 60,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 8,
      zIndex: 90,
    },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: 20
      },
      navItemImage:{
        width: 22,
        height: 22,
      },
      navItemActive: {
        backgroundColor: '#E0E0E0',
        borderRadius: 100,
        marginHorizontal: -7,
      },
      navItemText: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.textSecondary,
      marginTop: 4
      },
    navItemTextActive: {
      color: '#000000',
      fontWeight: '600',
    },
  });

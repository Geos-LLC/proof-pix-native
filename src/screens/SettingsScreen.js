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
  Clipboard,
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
} from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS, getLabelPositions } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import RoomEditor from '../components/RoomEditor';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import googleDriveService from '../services/googleDriveService';
import dropboxAuthService from '../services/dropboxAuthService';
import dropboxService from '../services/dropboxService';
import InviteManager from '../components/InviteManager';
import {
  getOrCreateReferralCode,
  getReferralInfo,
} from '../services/referralService';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import proxyService from '../services/proxyService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Modal from 'react-native-modal';
import ColorPicker from 'react-native-wheel-color-picker';
import { useTranslation } from 'react-i18next';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import { isTrialActive, getTrialDaysRemaining, getTrialPlan } from '../services/trialService';
import * as TrialTestUtils from '../utils/trialTestUtils';
import { generateInviteToken } from '../utils/tokens';
import {
  logLanguageChange,
  logTeamInvitesCreated,
  logCloudAccountConnection,
  logFeatureGateShown,
  logFeatureGateAction,
} from '../utils/analytics';

const getFontOptions = (t) => [
  {
    key: 'system',
    label: t('labelCustomization.fontModal.systemDefault'),
    description: t('labelCustomization.fontModal.systemDefaultDescription'),
    fontFamily: null,
  },
  {
    key: 'montserratBold',
    label: t('labelCustomization.fontModal.montserratBold'),
    description: t('labelCustomization.fontModal.montserratBoldDescription'),
    fontFamily: 'Montserrat_700Bold',
  },
  {
    key: 'latoBold',
    label: t('labelCustomization.fontModal.latoBold'),
    description: t('labelCustomization.fontModal.latoBoldDescription'),
    fontFamily: 'Lato_700Bold',
  },
  {
    key: 'playfairBold',
    label: t('labelCustomization.fontModal.playfairDisplay'),
    description: t('labelCustomization.fontModal.playfairDisplayDescription'),
    fontFamily: 'PlayfairDisplay_700Bold',
  },
  {
    key: 'poppinsSemiBold',
    label: t('labelCustomization.fontModal.poppinsSemiBold'),
    description: t('labelCustomization.fontModal.poppinsSemiBoldDescription'),
    fontFamily: 'Poppins_600SemiBold',
  },
  {
    key: 'robotoMonoBold',
    label: t('labelCustomization.fontModal.robotoMono'),
    description: t('labelCustomization.fontModal.robotoMonoDescription'),
    fontFamily: 'RobotoMono_700Bold',
  },
  {
    key: 'oswaldSemiBold',
    label: t('labelCustomization.fontModal.oswaldSemiBold'),
    description: t('labelCustomization.fontModal.oswaldSemiBoldDescription'),
    fontFamily: 'Oswald_600SemiBold',
  },
];

const getLabelSizeOptions = (t) => [
  { key: 'small', label: t('labelCustomization.small') },
  { key: 'medium', label: t('labelCustomization.default') },
  { key: 'large', label: t('labelCustomization.large') },
];

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'be', name: 'Беларуская', flag: '🇧🇾' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'tl', name: 'Tagalog', flag: '🇵🇭' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
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
    toggleWatermark,
    updateShowWatermark,
    updateWatermarkText,
    updateWatermarkLink,
    updateWatermarkColor,
    updateWatermarkOpacity,
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
  } = useSettings();

  const { canUse, exceedsLimit, getLimit } = useFeaturePermissions();
  const { t, i18n } = useTranslation();

  // Memoize translated options
  const FONT_OPTIONS = useMemo(() => getFontOptions(t), [t]);
  const LABEL_SIZE_OPTIONS = useMemo(() => getLabelSizeOptions(t), [t]);
  const LABEL_CORNER_OPTIONS = useMemo(() => getLabelCornerOptions(t), [t]);

  const [showPlanSelection, setShowPlanSelection] = useState(false);
  const [showMultipleAccountsModal, setShowMultipleAccountsModal] = useState(false);
  const [showTestToolsModal, setShowTestToolsModal] = useState(false);
  const [showManageTeamModal, setShowManageTeamModal] = useState(false);
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
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [colorModalType, setColorModalType] = useState(null);
  const [draftColor, setDraftColor] = useState(labelBackgroundColor);
  const [colorInput, setColorInput] = useState(labelBackgroundColor?.toUpperCase() || '');
  const [hexModalVisible, setHexModalVisible] = useState(false);
  const [hexModalValue, setHexModalValue] = useState(labelBackgroundColor?.toUpperCase() || '');
  const [hexModalError, setHexModalError] = useState(null);
  const [fontModalVisible, setFontModalVisible] = useState(false);
  const [colorPickerKey, setColorPickerKey] = useState(0);
  const [watermarkOpacityPreview, setWatermarkOpacityPreview] = useState(
    typeof watermarkOpacity === 'number' ? watermarkOpacity : 0.5
  );

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

  const renderRoomTabs = () => (
    <View style={styles.roomTabsContainer} {...roomPanResponder.panHandlers}>
      {circularRooms.map((room, index) => {
        const isActive = room.offset === 0; // Center item is active
        const distance = Math.abs(room.offset);
        const scale = isActive ? 1 : Math.max(0.65, 1 - (distance * 0.15));
        const opacity = isActive ? 1 : Math.max(0.4, 1 - (distance * 0.2));
        
        return (
          <TouchableOpacity
            key={`${room.id}-${index}`}
            style={[
              styles.roomTab,
              isActive && styles.roomTabActive,
              {
                transform: [{ scale }],
                opacity
              }
            ]}
            hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
            onPress={() => setCurrentRoom(room.id)}
          >
            <Text style={[styles.roomIcon, { fontSize: isActive ? 28 : 22 }]}>{room.icon}</Text>
            {isActive && (
              <Text
                style={[
                  styles.roomTabText,
                  styles.roomTabTextActive
                ]}
              >
                {cleaningServiceEnabled
                  ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                  : `${t('settings.section', { lng: sectionLanguage })} ${index + 1}`}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );

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
      setTrialActive(active);
      setTrialDaysRemaining(daysRemaining);
      setTrialPlan(plan);
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
      loadDropboxTokens();
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
    
    // Check Google first for other cases
    if (adminUserInfo) {
      return adminUserInfo;
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
  
  // Update name when userName changes (e.g., when switching back from team mode)
  useEffect(() => {
    setName(userName);
  }, [userName]);
  useEffect(() => {
    let isMounted = true;
    const checkStoredIndividual = async () => {
      if (!isTeamMember) {
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
  }, [isTeamMember]);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [referralInfo, setReferralInfo] = useState({
    code: '',
    invitesSent: [],
    rewardsEarned: 0,
    totalMonthsEarned: 0,
  });
  const [isSigningInDropbox, setIsSigningInDropbox] = useState(false);
  const [isDropboxAuthenticated, setIsDropboxAuthenticated] = useState(false);
  const [dropboxUserInfo, setDropboxUserInfo] = useState(null);
  const [adminInfo, setAdminInfo] = useState(null);
  const [loadingAdminInfo, setLoadingAdminInfo] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingTeamName, setEditingTeamName] = useState(false);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [labelLanguageModalVisible, setLabelLanguageModalVisible] = useState(false);
  const [sectionLanguageModalVisible, setSectionLanguageModalVisible] = useState(false);

  const appLanguageScrollViewRef = useRef(null);
  const appLanguageLayouts = useRef({});
  const labelLanguageScrollViewRef = useRef(null);
  const labelLanguageLayouts = useRef({});
  const sectionLanguageScrollViewRef = useRef(null);
  const sectionLanguageLayouts = useRef({});
  const watermarkTextInputRef = useRef(null);
  const watermarkLinkInputRef = useRef(null);
  const mainScrollViewRef = useRef(null);
  const cloudSyncSectionRef = useRef(null);
  const watermarkSectionRef = useRef(null);
  const accountDataSectionRef = useRef(null);
  const watermarkSectionY = useRef(null);
  const watermarkSectionAbsoluteY = useRef(null);

  const isTeamMember = userMode === 'team_member';
  const [canSwitchBack, setCanSwitchBack] = useState(false);

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
        console.log('[SETTINGS] Team members result:', result);
        if (result.success && result.teamMembers) {
          setTeamMembersList(result.teamMembers);

          // Try to get team name from various sources
          if (result.teamName) {
            console.log('[SETTINGS] Setting team name from proxy response:', result.teamName);
            setTeamNameInput(result.teamName);
          } else {
            // Try to load from AsyncStorage directly
            try {
              const storedTeamName = await AsyncStorage.getItem('@team_name');
              console.log('[SETTINGS] Team name from AsyncStorage:', storedTeamName);
              if (storedTeamName) {
                setTeamNameInput(storedTeamName);
              } else if (teamName) {
                console.log('[SETTINGS] Using teamName from AdminContext:', teamName);
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
            
            console.log('[SETTINGS] Global team member count:', globalCount, 'for userId:', globalCountResult.userId || 'NOT SET');
            console.log('[SETTINGS] Local team member count:', localCount);
            console.log('[SETTINGS] Session ID:', proxySessionId);
            console.log('[SETTINGS] Using fallback?', globalCountResult.fallback || false);
            
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
      console.log('[MANAGE_TEAM] Modal opened, fetching team members');
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
            console.log('[TEST_JOIN] Navigation object exists, calling goBack()');
            // Use goBack first to close Settings, then navigate to Home
            // This ensures we're not navigating from a modal context
            navigation.goBack();
            console.log('[TEST_JOIN] goBack() called, waiting 200ms before navigate');
            setTimeout(() => {
              console.log('[TEST_JOIN] Step 9: Calling navigate("Home")');
              navigation.navigate('Home');
              console.log('[TEST_JOIN] Step 9 complete: navigate("Home") called');
            }, 200);
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
    // Copy token with sessionId for proxy server
    const inviteData = `${token}|${proxySessionId}`;
    Clipboard.setString(inviteData);
    Alert.alert('Copied!', 'Invite code copied to clipboard. Share this code with your team member.');
  };

  const handleShareInvite = async (token) => {
    try {
      // Create invite code with token and sessionId for proxy server
      const inviteData = `${token}|${proxySessionId}`;

      // Get App Store links from environment variables
      const iosAppStoreLink = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/app/proofpix';
      const androidPlayStoreLink = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix';

      // Share the instructions message first
      await Share.share({
        message: `Join my ProofPix team!\n\n📱 Download ProofPix:\niOS: ${iosAppStoreLink}\nAndroid: ${androidPlayStoreLink}\n\nAfter installing, open the app, go to "Join Team" and paste the invite code I'll send you next.`,
        title: 'ProofPix Team Invite'
      });

      // After first share completes, ask user if they want to share the code
      Alert.alert(
        'Share Invite Code?',
        'Now share the invite code as a separate message so your team member can easily copy it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Share Code',
            onPress: async () => {
              await Share.share({
                message: inviteData,
                title: 'ProofPix Invite Code'
              });
            }
          }
        ]
      );
    } catch (error) {
      Alert.alert('Error', 'Could not share the invite.');
    }
  };

  const handleDeleteInvite = (token) => {
    Alert.alert(
      'Delete Invite',
      'This will permanently delete this unused invite code. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (proxySessionId) {
                await proxyService.removeInviteToken(proxySessionId, token);
                console.log('[SETTINGS] Token removed from proxy server');
              }
              await removeInviteToken(token);
              await fetchTeamMembersForModal();
              Alert.alert('Deleted', 'The invite code has been deleted successfully.');
            } catch (error) {
              console.error('[SETTINGS] Failed to delete invite token:', error);
              Alert.alert('Error', 'Failed to delete invite code. Please try again.');
            }
          }
        }
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

              // Show loading
              Alert.alert('Processing', 'Processing your purchase...', [], { cancelable: false });

              // TODO: Implement actual payment processing here
              // For now, simulate payment success after a short delay
              await new Promise(resolve => setTimeout(resolve, 1500));

              // Increase the plan limit
              const currentPlanLimit = planLimit || 5;
              const newPlanLimit = currentPlanLimit + additionalMembersCount;

              console.log('[PURCHASE] Increasing planLimit from', currentPlanLimit, 'to', newPlanLimit, 'for plan:', userPlan);

              // Update plan limit via AdminContext helper so state, storage, and activeAccount stay in sync
              await updatePlanLimit(newPlanLimit);

              // Dismiss loading alert
              Alert.alert(
                'Purchase Successful',
                `Successfully added ${additionalMembersCount} team member slot${additionalMembersCount > 1 ? 's' : ''}. You now have ${newPlanLimit} total slots.`,
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

      console.log(`[TEST] Filling team to max capacity: ${effectiveLimit} members (plan: ${userPlan})`);

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

  const handleSetupTeam = async () => {
    // Get active account and account type
    const activeAccount = getActiveAccount();
    const currentAccountType = activeAccount?.accountType || accountType || 'google';

    if (!isAuthenticated || userMode !== 'admin' || isSigningIn) {
      return;
    }

    // Check if already set up
    if (isSetupComplete()) {
      Alert.alert(t('settings.alreadyConnected'), t('settings.alreadyConnectedMessage'));
      return;
    }

    try {
      console.log('[SETUP] Running team setup with proxy server for account type:', currentAccountType);
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
        console.log('[SETUP] Admin folder path saved:', folderIdOrPath);
        
        const dropboxUserInfo = dropboxAuthService.getUserInfo();
        userName = dropboxUserInfo?.name || adminUserInfo?.name;
      } else {
        // For Google: check serverAuthCode and find/create folder
        const googleAuthService = await import('../services/googleAuthService');
        const serverAuthCode = await googleAuthService.default.getServerAuthCode();
        if (!serverAuthCode) {
          console.log('[SETUP] No serverAuthCode available - prompting user to reconnect');
          setIsSigningIn(false);
          Alert.alert(
            'Reconnect Required',
            'To set up team features, you need to reconnect with Google Drive to refresh your authorization.',
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
                        'Please tap "Connect with Google Drive" below to sign in again and complete team setup.'
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

        // Step 1: Find or create the Google Drive folder
        folderIdOrPath = await googleDriveService.findOrCreateProofPixFolder();
        await saveFolderId(folderIdOrPath);
        console.log('[SETUP] Admin folder ID saved:', folderIdOrPath);
        userName = adminUserInfo?.name;
      }

      // Step 2: Initialize proxy session (this creates the session and stores refresh token/access token)
      const sessionResult = await initializeProxySession(folderIdOrPath, currentAccountType);
      if (!sessionResult || !sessionResult.sessionId) {
        throw new Error('Failed to initialize proxy session');
      }
      console.log('[SETUP] Proxy session initialized:', sessionResult.sessionId);

      // Step 3: Set default team name if not already set
      if (!teamName && userName) {
        await updateTeamName(userName);
        // Also save to AsyncStorage for persistence
        await AsyncStorage.setItem('@team_name', userName);
        console.log('[SETUP] Default team name set to:', userName);
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
    i18n.changeLanguage(languageCode);
    // Analytics: track app language change
    try {
      logLanguageChange(languageCode);
    } catch (e) {
      // non‑critical
    }
    setLanguageModalVisible(false);
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
      if (isAuthenticated && userMode === 'admin') {
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
  }, [isAuthenticated, userMode]);

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

  useEffect(() => {
    if (labelLanguageModalVisible) {
      const currentLanguageCode = labelLanguage;
      const yOffset = labelLanguageLayouts.current[currentLanguageCode];
      if (yOffset !== undefined && labelLanguageScrollViewRef.current) {
        setTimeout(() => {
          labelLanguageScrollViewRef.current.scrollTo({ y: yOffset, animated: false });
        }, 100);
      }
    }
  }, [labelLanguageModalVisible, labelLanguage]);

  useEffect(() => {
    if (sectionLanguageModalVisible) {
      const currentLanguageCode = sectionLanguage;
      const yOffset = sectionLanguageLayouts.current[currentLanguageCode];
      if (yOffset !== undefined && sectionLanguageScrollViewRef.current) {
        setTimeout(() => {
          sectionLanguageScrollViewRef.current.scrollTo({ y: yOffset, animated: false });
        }, 100);
      }
    }
  }, [sectionLanguageModalVisible, sectionLanguage]);

  // Handle navigation to specific sections - using useEffect to watch route params
  useEffect(() => {
    const params = route?.params;
    console.log('[SETTINGS] Route params changed:', params);
    
    const scrollToSection = (sectionRef, paramKey) => {
      if (params?.[paramKey] === true) {
        console.log(`[SETTINGS] Attempting to scroll to ${paramKey} section`);
        console.log(`[SETTINGS] sectionRef.current:`, !!sectionRef.current);
        console.log(`[SETTINGS] mainScrollViewRef.current:`, !!mainScrollViewRef.current);
        
        // For watermark, use stored absolute Y position if available
        if (paramKey === 'scrollToWatermark' && watermarkSectionAbsoluteY.current !== null) {
          console.log(`[SETTINGS] Using stored absolute Y position for watermark:`, watermarkSectionAbsoluteY.current);
          setTimeout(() => {
            mainScrollViewRef.current?.scrollTo({ y: Math.max(0, watermarkSectionAbsoluteY.current - 20), animated: true });
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
                  mainScrollViewRef.current?.scrollTo({ y: Math.max(0, watermarkSectionAbsoluteY.current - 20), animated: true });
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
                    console.log(`[SETTINGS] Scrolling to y:`, y - 20);
                    mainScrollViewRef.current?.scrollTo({ y: Math.max(0, y - 20), animated: true });
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
                  console.log(`[SETTINGS] Fallback: Using stored absolute Y position for watermark:`, watermarkSectionAbsoluteY.current);
                  mainScrollViewRef.current?.scrollTo({ y: Math.max(0, watermarkSectionAbsoluteY.current - 20), animated: true });
                  navigation.setParams({ [paramKey]: undefined });
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
      setShowPlanModal(true);
      // Clear the param
      navigation.setParams({ showPlanModal: undefined });
    }
  }, [route?.params, navigation]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('settings.title')}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView 
        ref={mainScrollViewRef}
        style={styles.content}
      >
        {/* Current Plan - Moved to top */}
        {userPlan && (
          <TouchableOpacity
            style={styles.currentPlanBox}
            onPress={() => setShowPlanModal(true)}
          >
            <View style={styles.currentPlanInfo}>
              <Text style={styles.currentPlanLabel}>{t('settings.currentPlan')}</Text>
              <View style={styles.currentPlanValueContainer}>
                <Text style={styles.currentPlanValue}>
                  {userPlan.charAt(0).toUpperCase() + userPlan.slice(1)}
                  {trialActive && trialPlan && (
                    <Text style={styles.trialBadge}>
                      {' '}({t('settings.trial', { defaultValue: 'Trial' })})
                    </Text>
                  )}
                </Text>
                <TouchableOpacity onPress={() => setShowPlanModal(true)}>
                  <Text style={styles.changePlanText}>{t('settings.change')}</Text>
                </TouchableOpacity>
              </View>
              {trialActive && trialDaysRemaining > 0 && (
                <Text style={styles.trialDaysText}>
                  {t('settings.trialDaysRemaining', { 
                    days: trialDaysRemaining,
                    defaultValue: `${trialDaysRemaining} days remaining` 
                  })}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )}

        {/* Language Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>

          {/* App Language */}
          <TouchableOpacity
            style={[styles.settingButton, { marginBottom: 8 }]}
            onPress={() => setLanguageModalVisible(true)}
          >
            <Text style={styles.settingText}>{t('settings.appLanguage')}</Text>
            <View style={styles.languageSelector}>
              <Text style={styles.languageFlag}>{getCurrentLanguage().flag}</Text>
              <Text style={styles.languageName}>{getCurrentLanguage().name}</Text>
              <Text style={styles.languageChangeText}>›</Text>
            </View>
          </TouchableOpacity>

          {/* Label Language */}
          <TouchableOpacity
            style={styles.settingButton}
            onPress={() => setLabelLanguageModalVisible(true)}
          >
            <Text style={styles.settingText}>{t('settings.labelLanguage')}</Text>
            <View style={styles.languageSelector}>
              <Text style={styles.languageFlag}>{getLabelLanguage().flag}</Text>
              <Text style={styles.languageName}>{getLabelLanguage().name}</Text>
              <Text style={styles.languageChangeText}>›</Text>
            </View>
          </TouchableOpacity>

          {/* Section Language */}
          <TouchableOpacity
            style={styles.settingButton}
            onPress={() => setSectionLanguageModalVisible(true)}
          >
            <Text style={styles.settingText}>{t('settings.sectionLanguage')}</Text>
            <View style={styles.languageSelector}>
              <Text style={styles.languageFlag}>{getSectionLanguage().flag}</Text>
              <Text style={styles.languageName}>{getSectionLanguage().name}</Text>
              <Text style={styles.languageChangeText}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {userMode !== 'team_member' && (
          <>
            {/* Label Customization */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('settings.labelCustomization_short')}</Text>
              <Text style={styles.sectionDescription}>
                {t('settings.labelCustomizationDescription')}
              </Text>

                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingLabel}>{t('settings.showLabels')}</Text>
                    <Text style={styles.settingDescription}>
                      {t('settings.showLabelsDescription')}
                    </Text>
                  </View>
                  <Switch
                    value={showLabels}
                    onValueChange={toggleLabels}
                    trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                    thumbColor="white"
                  />
                </View>

              {/* Dummy Photo Preview */}
              <View style={styles.labelPreviewSection}>
                <View style={styles.positionPreviewBox}>
                  {/* Left half - BEFORE */}
                  <View style={styles.previewHalfBefore}>
                    {showLabels && (
                      <View
                        style={[
                          styles.previewLabel,
                          getLabelPositions(labelMarginVertical, labelMarginHorizontal)[beforeLabelPosition]
                        ]}
                      >
                        <PhotoLabel
                          label="common.before"
                          position="left-top"
                          style={{ position: 'relative', top: 0, left: 0 }}
                        />
                      </View>
                    )}
                  </View>

                  {/* Right half - AFTER */}
                  <View style={styles.previewHalfAfter}>
                    {showLabels && (
                      <View
                        style={[
                          styles.previewLabel,
                          getLabelPositions(labelMarginVertical, labelMarginHorizontal)[afterLabelPosition]
                        ]}
                      >
                        <PhotoLabel
                          label="common.after"
                          position="left-top"
                          style={{ position: 'relative', top: 0, left: 0 }}
                        />
                      </View>
                    )}
                  </View>
                  {/* Watermark Preview */}
                  {shouldShowWatermark && (
                    <PhotoWatermark />
                  )}
                </View>
              </View>

              <View 
                ref={watermarkSectionRef}
                style={styles.settingRow}
                onLayout={(event) => {
                  const { y } = event.nativeEvent.layout;
                  watermarkSectionY.current = y;
                  // Also measure absolute position
                  if (watermarkSectionRef.current && mainScrollViewRef.current) {
                    watermarkSectionRef.current.measureLayout(
                      mainScrollViewRef.current,
                      (x, absoluteY) => {
                        watermarkSectionAbsoluteY.current = absoluteY;
                        console.log('[SETTINGS] Watermark section absolute position:', absoluteY);
                        // If scroll param is set, scroll immediately
                        const params = route?.params;
                        if (params?.scrollToWatermark === true) {
                          setTimeout(() => {
                            console.log('[SETTINGS] Auto-scrolling to watermark from onLayout, y:', absoluteY);
                            mainScrollViewRef.current?.scrollTo({ y: Math.max(0, absoluteY - 20), animated: true });
                            setTimeout(() => {
                              navigation.setParams({ scrollToWatermark: undefined });
                            }, 500);
                          }, 300);
                        }
                      },
                      () => {}
                    );
                  }
                  console.log('[SETTINGS] Watermark section layout:', y);
                }}
              >
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{t('settings.customizeWatermark')}</Text>
                  <Text style={styles.settingDescription}>
                    {customWatermarkEnabled
                      ? t('settings.watermarkCustomDescription')
                      : t('settings.watermarkDefaultDescription')}
                  </Text>
                </View>
                <Switch
                  value={customWatermarkEnabled}
                  onValueChange={(value) => {
                    // Allow starter users to turn on/off watermark switch
                    toggleWatermark(value);
                  }}
                  trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                  thumbColor="white"
                />
              </View>
              {customWatermarkEnabled && (
                <View style={styles.watermarkCustomization}>
                  {/* Add Watermark Checkbox */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>{t('settings.addWatermark', { defaultValue: 'Add watermark' })}</Text>
                      <Text style={styles.settingDescription}>
                        {t('settings.addWatermarkDescription', { defaultValue: 'Show watermark on photos' })}
                      </Text>
                    </View>
                    <Switch
                      value={showWatermark}
                      onValueChange={(value) => {
                        // Check if user has access to customize watermark
                        if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                          // Starter users cannot turn off watermark - show tier popup
                          if (value === false) {
                            try {
                              logFeatureGateShown('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark');
                              logFeatureGateAction('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark', 'toggle_blocked');
                            } catch (e) {
                              // non‑critical
                            }
                            setShowPlanModal(true);
                            return;
                          }
                        }
                        updateShowWatermark(value);
                      }}
                      trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                      thumbColor="white"
                    />
                  </View>

                  <View style={styles.watermarkField}>
                    <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkText')}</Text>
                    <Pressable
                      onPress={() => {
                        if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                          try {
                            logFeatureGateShown('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark');
                            logFeatureGateAction('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark', 'edit_text_blocked');
                          } catch (e) {
                            // non‑critical
                          }
                          setShowPlanModal(true);
                        } else {
                          // Focus the input if user has access
                          if (watermarkTextInputRef.current) {
                            watermarkTextInputRef.current.focus();
                          }
                        }
                      }}
                    >
                      <TextInput
                        ref={watermarkTextInputRef}
                        style={styles.watermarkInput}
                        value={watermarkText}
                        onChangeText={updateWatermarkText}
                        onFocus={() => {
                          // Check if user has access to customize watermark
                          if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                            try {
                              logFeatureGateShown('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark');
                              logFeatureGateAction('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark', 'focus_text_blocked');
                            } catch (e) {
                              // non‑critical
                            }
                            setShowPlanModal(true);
                            // Blur the input to prevent typing
                            if (watermarkTextInputRef.current) {
                              watermarkTextInputRef.current.blur();
                            }
                          }
                        }}
                        placeholder={t('settings.watermarkTextPlaceholder')}
                        placeholderTextColor={COLORS.GRAY}
                        editable={canUse(FEATURES.CUSTOM_WATERMARKS)}
                        pointerEvents={canUse(FEATURES.CUSTOM_WATERMARKS) ? 'auto' : 'none'}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.watermarkField}>
                    <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkLink')}</Text>
                    <Pressable
                      onPress={() => {
                        if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                          try {
                            logFeatureGateShown('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark');
                            logFeatureGateAction('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark', 'edit_link_blocked');
                          } catch (e) {
                            // non‑critical
                          }
                          setShowPlanModal(true);
                        } else {
                          // Focus the input if user has access
                          if (watermarkLinkInputRef.current) {
                            watermarkLinkInputRef.current.focus();
                          }
                        }
                      }}
                    >
                      <TextInput
                        ref={watermarkLinkInputRef}
                        style={styles.watermarkInput}
                        value={watermarkLink}
                        onChangeText={updateWatermarkLink}
                        onFocus={() => {
                          // Check if user has access to customize watermark
                          if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                            try {
                              logFeatureGateShown('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark');
                              logFeatureGateAction('CUSTOM_WATERMARKS', userPlan, 'Settings_Watermark', 'focus_link_blocked');
                            } catch (e) {
                              // non‑critical
                            }
                            setShowPlanModal(true);
                            // Blur the input to prevent typing
                            if (watermarkLinkInputRef.current) {
                              watermarkLinkInputRef.current.blur();
                            }
                          }
                        }}
                        placeholder={t('settings.watermarkLinkPlaceholder')}
                        placeholderTextColor={COLORS.GRAY}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        editable={canUse(FEATURES.CUSTOM_WATERMARKS)}
                        pointerEvents={canUse(FEATURES.CUSTOM_WATERMARKS) ? 'auto' : 'none'}
                      />
                    </Pressable>
                  </View>
                  <View style={styles.watermarkColorRow}>
                    <View style={styles.watermarkColorInfo}>
                      <Text style={styles.watermarkFieldLabel}>{t('settings.watermarkColor')}</Text>
                      <Text style={styles.watermarkColorValue}>{watermarkSwatchColor}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.watermarkColorButton}
                      onPress={() => {
                        // Check if user has access to customize watermark
                        if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                          setShowPlanModal(true);
                          return;
                        }
                        openColorModal('watermark');
                      }}
                    >
                      <View
                        style={[
                          styles.colorPreviewSwatch,
                          styles.watermarkColorSwatch,
                          { backgroundColor: watermarkSwatchColor },
                        ]}
                      />
                      <Text style={styles.customSelectorButtonText}>{t('settings.pickColor')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.watermarkOpacityRow}>
                    <Text style={styles.watermarkFieldLabel}>{t('settings.opacity')}</Text>
                    <View style={styles.watermarkOpacityControls}>
                      <WatermarkOpacitySlider
                        value={watermarkOpacityPreview}
                        onChange={(value) => {
                          // Update preview during dragging (don't check permissions here to avoid jumping)
                          setWatermarkOpacityPreview(value);
                        }}
                        onChangeEnd={(value) => {
                          // Check if user has access to customize watermark when dragging ends
                          if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                            setShowPlanModal(true);
                            // Reset to original value
                            setWatermarkOpacityPreview(watermarkOpacity);
                            return;
                          }
                          updateWatermarkOpacity(value);
                        }}
                        onStartShouldSetResponder={() => {
                          // Check permissions at the start of interaction
                          if (!canUse(FEATURES.CUSTOM_WATERMARKS)) {
                            setShowPlanModal(true);
                            return false; // Don't allow interaction
                          }
                          return true; // Allow interaction
                        }}
                        fillColor={watermarkSwatchColor}
                      />
                      <Text style={styles.watermarkOpacityValue}>
                        {Math.round(watermarkOpacityPreview * 100)}%
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.watermarkHelperText}>
                    {t('settings.watermarkHelperText')}
                  </Text>
                </View>
              )}

              {/* Customize Button - Always active */}
              <TouchableOpacity
                style={[
                  styles.customizeButton,
                  !showLabels && styles.customizeButtonDisabled
                ]}
                onPress={() => {
                  navigation.navigate('LabelCustomization');
                }}
                disabled={!showLabels}
              >
                <Text style={[
                  styles.customizeButtonText,
                  !showLabels && styles.customizeButtonTextDisabled
                ]}>{t('settings.customize')}</Text>
              </TouchableOpacity>
            </View>

            {/* Room Customization */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('settings.folderCustomization_short')}</Text>
              <Text style={styles.sectionDescription}>
                {t('settings.folderCustomizationDescription')}
              </Text>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{t('settings.cleaningService')}</Text>
                  <Text style={styles.settingDescription}>
                    {t('settings.cleaningServiceDescription')}
                  </Text>
                </View>
                <Switch
                  value={cleaningServiceEnabled}
                  onValueChange={toggleCleaningServiceEnabled}
                  trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                  thumbColor="white"
                />
              </View>

              {renderRoomTabs()}

              {/* Customize Button */}
              <TouchableOpacity
                style={styles.customizeButton}
                onPress={() => {
                  setShowRoomEditor(true);
                }}
              >
                <Text style={styles.customizeButtonText}>{t('settings.customize')}</Text>
              </TouchableOpacity>
            </View>

            {/* Upload Structure */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('settings.uploadStructure')}</Text>

              <View style={styles.settingRow}>
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{t('settings.useFolderStructure')}</Text>
                  <Text style={styles.settingDescription}>
                    {t('settings.useFolderStructureDescription')}
                  </Text>
                </View>
                <Switch
                  value={useFolderStructure}
                  onValueChange={toggleUseFolderStructure}
                  trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                  thumbColor="white"
                />
              </View>

              {useFolderStructure && (
                <>
                  <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>{t('settings.beforeFolder')}</Text>
                      <Text style={styles.settingDescription}>{t('settings.beforeFolderDescription')}</Text>
                    </View>
                    <Switch
                      value={enabledFolders.before}
                      onValueChange={(v) => updateEnabledFolders({ before: v })}
                      trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                      thumbColor="white"
                    />
                  </View>
                  <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>{t('settings.afterFolder')}</Text>
                      <Text style={styles.settingDescription}>{t('settings.afterFolderDescription')}</Text>
                    </View>
                    <Switch
                      value={enabledFolders.after}
                      onValueChange={(v) => updateEnabledFolders({ after: v })}
                      trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                      thumbColor="white"
                    />
                  </View>
                  <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                      <Text style={styles.settingLabel}>{t('settings.combinedFolder')}</Text>
                      <Text style={styles.settingDescription}>{t('settings.combinedFolderDescription')}</Text>
                    </View>
                    <Switch
                      value={enabledFolders.combined}
                      onValueChange={(v) => updateEnabledFolders({ combined: v })}
                      trackColor={{ false: COLORS.BORDER, true: COLORS.PRIMARY }}
                      thumbColor="white"
                    />
                  </View>
                </>
              )}
            </View>
          </>
        )}

        {/* Admin Setup Section */}
        <View 
          ref={cloudSyncSectionRef}
          style={styles.section}
          onLayout={() => {}}
        >
          <Text style={styles.sectionTitle}>{t('settings.cloudTeamSync')}</Text>
          
          {userMode === 'team_member' ? (
            <>
              {/* Team Member View - Show team connection info (read-only) */}
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
              
            </>
          ) : isSigningIn ? (
             <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0000ff" />
                <Text style={styles.loadingText}>{t('settings.connectingToGoogle')}</Text>
             </View>
          ) : isSigningInDropbox ? (
             <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0061FF" />
                <Text style={styles.loadingText}>{t('settings.connectingToDropbox')}</Text>
             </View>
          ) : (!isAuthenticated && !isDropboxAuthenticatedForDisplay) ? (
            <>
              {showPlanSelection ? (
                <>
                  <TouchableOpacity onPress={() => setShowPlanSelection(false)} style={styles.backLink}>
                    <Text style={styles.backLinkText}>&larr; {t('common.back')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.sectionDescription}>
                    {t('firstLoad.choosePlan')}
                  </Text>
                  
                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                      onPress={async () => {
                        // When switching to Starter, clear team data if coming from Business/Enterprise
                        if (userPlan === 'business' || userPlan === 'enterprise') {
                          try {
                            // Clear team setup by updating plan limit to 0
                            await updatePlanLimit(0);
                            // Clear proxy session
                            await initializeProxySession(null);
                          } catch (error) {
                            console.error('[SETTINGS] Error clearing team data:', error);
                          }
                        }
                        await updateUserPlan('starter');
                        setShowPlanSelection(false);
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>{t('settings.plans.starter')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('settings.plans.starterDescription')}</Text>
                  </View>

                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                      onPress={async () => {
                        // When switching to Pro, clear team data if coming from Business/Enterprise
                        if (userPlan === 'business' || userPlan === 'enterprise') {
                          try {
                            // Clear team setup by updating plan limit to 0
                            await updatePlanLimit(0);
                            // Clear proxy session
                            await initializeProxySession(null);
                          } catch (error) {
                            console.error('[SETTINGS] Error clearing team data:', error);
                          }
                        }
                        await updateUserPlan('pro');
                        setShowPlanSelection(false);
                        navigation.navigate('GoogleSignUp', { plan: 'pro' });
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>{t('settings.plans.pro')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('settings.plans.proDescription')}</Text>
                  </View>

                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                      onPress={async () => {
                        await updateUserPlan('business');
                        setShowPlanSelection(false);
                        navigation.navigate('GoogleSignUp', { plan: 'business' });
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('settings.plans.business')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('settings.plans.businessDescription')}</Text>
                  </View>

                  <View style={styles.planContainer}>
                    <TouchableOpacity
                      style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                      onPress={async () => {
                        try {
                          // Set up enterprise tier with 15 team member limit
                          await updatePlanLimit(15);
                          // Update user plan to enterprise
                          await updateUserPlan('enterprise');
                          setShowPlanSelection(false);
                          Alert.alert(
                            t('common.success', { defaultValue: 'Success' }),
                            t('settings.enterprisePlanActivated', { defaultValue: 'Enterprise plan activated with 15 team member limit. You can now manage multiple accounts and teams.' })
                          );
                        } catch (error) {
                          console.error('[SETTINGS] Error setting up enterprise plan:', error);
                          Alert.alert(
                            t('common.error'),
                            t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' })
                          );
                        }
                      }}
                    >
                      <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('settings.plans.enterprise')}</Text>
                    </TouchableOpacity>
                    <Text style={styles.planSubtext}>{t('settings.plans.enterpriseDescription')}</Text>
                  </View>
                </>
              ) : (
                <>
                  {/* Show feature buttons with enable/disable based on plan */}
                  <Text style={styles.sectionDescription}>
                    {userPlan ?
                      t('settings.planFeatures', { plan: userPlan.charAt(0).toUpperCase() + userPlan.slice(1) }) :
                      t('settings.signInPrompt')
                    }
                  </Text>
                  
                  {/* Buttons - Show opposite account's connect button to allow switching (for Pro/Business) */}
                  <>
                    {/* Connect to Google Account Button - Hide if Google is connected (for Pro/Business), show if Dropbox is connected or neither */}
                        {(() => {
                          const shouldShow = (userPlan === 'pro' || userPlan === 'business') ? (!isAuthenticated || isDropboxAuthenticatedForDisplay) : true;
                          const isDisabled = (userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') ? (!isGoogleSignInAvailable || isSigningIn) : (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable || isSigningIn);
                          const canUseFeature = canUse(FEATURES.GOOGLE_DRIVE_SYNC);
                          return shouldShow;
                        })() && (
                      <TouchableOpacity
                        style={[
                          styles.featureButton,
                          styles.googleSignInButton,
                            (() => {
                              const styleDisabled = ((userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') ? (!isGoogleSignInAvailable || isSigningIn) : (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable || isSigningIn));
                              return styleDisabled && styles.googleButtonDisabled;
                            })()
                        ]}
                        onPress={async () => {
                          // For Pro/Business/Enterprise: Check if Dropbox is connected first
                          if (isDropboxAuthenticatedForDisplay) {
                            Alert.alert(
                              t('settings.disconnectActiveAccount', { defaultValue: 'Disconnect Active Account' }),
                              t('settings.disconnectActiveAccountMessage', { 
                                defaultValue: 'You need to disconnect your current Dropbox account before connecting a Google account.' 
                              }),
                              [
                                { text: t('common.cancel'), style: 'cancel' },
                                {
                                  text: t('settings.disconnect', { defaultValue: 'Disconnect' }),
                                  style: 'destructive',
                                  onPress: async () => {
                                    // Disconnect Dropbox first
                                    try {
                                      await dropboxAuthService.signOut();
                                      setIsDropboxAuthenticated(false);
                                      setDropboxUserInfo(null);
                                    } catch (error) {
                                      console.error('[SETTINGS] Error disconnecting Dropbox:', error);
                                    }
                                    // Continue with Google sign-in
                                    setIsSigningIn(true);
                                    try {
                                      if (userPlan === 'pro') {
                                        await individualSignIn();
                                      } else {
                                        await adminSignIn();
                                      }
                                    } catch (error) {
                                      console.error("Error during sign in:", error);
                                    } finally {
                                      setIsSigningIn(false);
                                    }
                                  }
                                }
                              ]
                            );
                            return;
                          }
                          
                          // Starter tier - show plan popup (only for non-Pro/Business/Enterprise)
                          // Skip this check if user is on Pro/Business (they already have access)
                          const shouldCheckTier = userPlan !== 'pro' && userPlan !== 'business' && userPlan !== 'enterprise';
                          const canUseGoogle = canUse(FEATURES.GOOGLE_DRIVE_SYNC);
                          
                          if (shouldCheckTier && !canUseGoogle) {
                            setShowPlanModal(true);
                            return;
                          }
                          
                          setIsSigningIn(true);
                          try {
                            // For Pro, use individual sign-in; for Business/Enterprise, use admin sign-in
                            if (userPlan === 'pro') {
                              await individualSignIn();
                            } else {
                              await adminSignIn();
                            }
                          } catch (error) {
                            console.error("Error during sign in:", error);
                          } finally {
                            setIsSigningIn(false);
                          }
                        }}
                        disabled={(() => {
                          const isDisabled = (userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') ? (!isGoogleSignInAvailable || isSigningIn) : (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable || isSigningIn);
                          return isDisabled;
                        })()}
                      >
                        {isSigningIn ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={[
                            styles.googleSignInButtonText,
                            ((userPlan === 'pro' || userPlan === 'business' || userPlan === 'enterprise') ? !isGoogleSignInAvailable : (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable)) && styles.googleButtonTextDisabled
                          ]}>
                            {t('settings.connectToGoogleAccount')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                    
                    {/* Connect to Dropbox Button - Hide if Dropbox is connected (for Pro/Business), show if Google is connected or neither */}
                    {(() => {
                      const shouldShow = (userPlan === 'pro' || userPlan === 'business') ? (!isDropboxAuthenticatedForDisplay || isAuthenticated) : true;
                      const isDisabled = (userPlan === 'pro' || userPlan === 'business') ? isSigningInDropbox : (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox);
                      const canUseFeature = canUse(FEATURES.DROPBOX_SYNC);
                      
                      console.log('[DROPBOX_BUTTON] Render check:', {
                        userPlan,
                        shouldShow,
                        isDisabled,
                        isAuthenticated,
                        isDropboxAuthenticatedForDisplay,
                        isSigningInDropbox,
                        canUseFeature,
                        isEnterprisePlan: userPlan === 'enterprise'
                      });
                      
                      return shouldShow;
                    })() && (
                      <TouchableOpacity
                        style={[
                          styles.featureButton,
                          styles.dropboxButton,
                          ((userPlan === 'pro' || userPlan === 'business') ? isSigningInDropbox : (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox)) && styles.dropboxButtonDisabled
                        ]}
                        onPress={async () => {
                          console.log('[DROPBOX_BUTTON] onPress triggered:', {
                            userPlan,
                            isAuthenticated,
                            isDropboxAuthenticatedForDisplay,
                            canUseFeature: canUse(FEATURES.DROPBOX_SYNC),
                            isSigningInDropbox
                          });
                          
                          // For Pro/Business: Check if another account is connected first
                          if ((userPlan === 'pro' || userPlan === 'business') && isAuthenticated) {
                            console.log('[DROPBOX_BUTTON] Google connected - showing disconnect modal');
                            Alert.alert(
                              t('settings.disconnectActiveAccount', { defaultValue: 'Disconnect Active Account' }),
                              t('settings.disconnectActiveAccountMessage', { 
                                defaultValue: 'You need to disconnect your current Google account before connecting a Dropbox account.' 
                              }),
                              [
                                { text: t('common.cancel'), style: 'cancel' },
                                {
                                  text: t('settings.disconnect', { defaultValue: 'Disconnect' }),
                                  style: 'destructive',
                                  onPress: async () => {
                                    // Disconnect Google first
                                    try {
                                      await signOut();
                                    } catch (error) {
                                      console.error('[SETTINGS] Error disconnecting Google:', error);
                                    }
                                    // Continue with Dropbox sign-in
                                    setIsSigningInDropbox(true);
                                    try {
                                      const result = await dropboxAuthService.signIn();
                                      
                                      // Find or create ProofPix folder
                                      try {
                                        const folderPath = await dropboxService.findOrCreateProofPixFolder();
                                        console.log('[DROPBOX] Folder ready:', folderPath);
                                      } catch (folderError) {
                                        console.error('[DROPBOX] Folder creation error:', folderError);
                                      }

                                      await dropboxAuthService.loadStoredTokens();
                                      const isAuth = dropboxAuthService.isAuthenticated();
                                      const userInfo = dropboxAuthService.getUserInfo();
                                      
                                      setIsDropboxAuthenticated(isAuth);
                                      setDropboxUserInfo(userInfo);
                                      
                                      console.log('[DROPBOX] Sign-in successful!');
                                      
                                      Alert.alert(
                                        t('settings.dropboxConnected'),
                                        t('settings.dropboxConnectedMessage', { email: userInfo?.email || '' }),
                                        [{ text: t('common.ok') }]
                                      );
                                    } catch (error) {
                                      console.error('[DROPBOX] Sign-in error:', error);
                                      Alert.alert(
                                        t('common.error'),
                                        error.message || t('settings.dropboxSignInError')
                                      );
                                    } finally {
                                      setIsSigningInDropbox(false);
                                    }
                                  }
                                }
                              ]
                            );
                            return;
                          }
                          
                          // Starter tier - show plan popup (only for non-Pro/Business/Enterprise)
                          const shouldCheckTier = userPlan !== 'pro' && userPlan !== 'business' && userPlan !== 'enterprise';
                          const canUseDropbox = canUse(FEATURES.DROPBOX_SYNC);
                          
                          console.log('[DROPBOX_BUTTON] Tier check:', {
                            shouldCheckTier,
                            canUseDropbox,
                            userPlan,
                            willShowTierModal: shouldCheckTier && !canUseDropbox
                          });
                          
                          if (shouldCheckTier && !canUseDropbox) {
                            console.log('[DROPBOX_BUTTON] Showing tiers popup');
                            setShowPlanModal(true);
                            return;
                          }
                          
                          const isConfigured = dropboxAuthService.isConfigured();
                          console.log('[DROPBOX_BUTTON] Dropbox configured:', isConfigured);
                          
                          if (!isConfigured) {
                            Alert.alert(
                              t('settings.featureUnavailable'),
                              t('settings.dropboxNotConfigured')
                            );
                            return;
                          }

                          console.log('[DROPBOX_BUTTON] Starting Dropbox sign-in');
                          setIsSigningInDropbox(true);
                          try {
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
                            
                            console.log('[DROPBOX] Sign-in successful!');
                            console.log('[DROPBOX] User info:', userInfo);
                            console.log('[DROPBOX] Is authenticated:', isAuth);
                            
                            // For enterprise users, add Dropbox account to connectedAccounts and activate it
                            if (userPlan === 'enterprise' && upsertConnectedAccount) {
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
                            
                            // Show success alert
                            Alert.alert(
                              t('settings.dropboxConnected'),
                              t('settings.dropboxConnectedMessage', { email: userInfo?.email || '' }),
                              [{ text: t('common.ok') }]
                            );
                          } catch (error) {
                            console.error('[DROPBOX] Sign-in error:', error);
                            Alert.alert(
                              t('common.error'),
                              error.message || t('settings.dropboxSignInError')
                            );
                          } finally {
                            setIsSigningInDropbox(false);
                          }
                        }}
                        disabled={(() => {
                          const isDisabled = (userPlan === 'pro' || userPlan === 'business') ? isSigningInDropbox : (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox);
                          console.log('[DROPBOX_BUTTON] Disabled state:', {
                            userPlan,
                            isSigningInDropbox,
                            canUseFeature: canUse(FEATURES.DROPBOX_SYNC),
                            isDisabled
                          });
                          return isDisabled;
                        })()}
                      >
                        {isSigningInDropbox ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={[
                            styles.featureButtonText,
                            styles.dropboxButtonText,
                            ((userPlan === 'pro' || userPlan === 'business') ? false : !canUse(FEATURES.DROPBOX_SYNC)) && styles.dropboxButtonTextDisabled
                          ]}>
                            {t('settings.connectToDropbox')}
                          </Text>
                        )}
                      </TouchableOpacity>
                    )}
                    
                    {/* Connect Team Button - Always visible */}
                    {(() => {
                      const buttonDisabled = isSigningIn;
                      const isStyleDisabled = (!userPlan || userPlan === 'starter') || userPlan === 'pro' || isSigningIn;
                      console.log('[TEAM_BUTTON_RENDER] Rendering button - userPlan:', userPlan, 'disabled:', buttonDisabled, 'styledAsDisabled:', isStyleDisabled);
                      return null;
                    })()}
                    <TouchableOpacity
                      style={[
                        styles.featureButton,
                        ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || isSigningIn) && styles.buttonDisabled
                      ]}
                      onPress={async () => {
                        console.log('[TEAM_BUTTON] Button pressed');
                        console.log('[TEAM_BUTTON] userPlan:', userPlan);
                        console.log('[TEAM_BUTTON] isAuthenticated:', isAuthenticated);
                        console.log('[TEAM_BUTTON] userMode:', userMode);
                        console.log('[TEAM_BUTTON] isSigningIn:', isSigningIn);

                        const isStarter = !userPlan || userPlan === 'starter';
                        const isPro = userPlan === 'pro';
                        const isBusiness = userPlan === 'business';
                        const isEnterprise = userPlan === 'enterprise';

                        console.log('[TEAM_BUTTON] isStarter:', isStarter);
                        console.log('[TEAM_BUTTON] isPro:', isPro);
                        console.log('[TEAM_BUTTON] isBusiness:', isBusiness);
                        console.log('[TEAM_BUTTON] isEnterprise:', isEnterprise);

                        // Starter - show plan popup
                        if (isStarter) {
                          console.log('[TEAM_BUTTON] Showing plan modal for starter');
                          setShowPlanModal(true);
                          return;
                        }

                        // Pro - show popup saying not available
                        if (isPro) {
                          console.log('[TEAM_BUTTON] Showing unavailable alert for pro');
                          Alert.alert(
                            t('settings.featureUnavailable'),
                            t('settings.teamSetupFeature')
                          );
                          return;
                        }

                        // Business - check team member limit
                        if (isBusiness) {
                          console.log('[TEAM_BUTTON] Business plan detected');
                          const maxTeamMembers = getLimit('maxTeamMembers', userPlan);
                          const currentTeamMembers = inviteTokens?.length || 0;
                          console.log('[TEAM_BUTTON] maxTeamMembers:', maxTeamMembers, 'currentTeamMembers:', currentTeamMembers);

                          if (exceedsLimit('maxTeamMembers', userPlan, currentTeamMembers)) {
                            console.log('[TEAM_BUTTON] Team limit exceeded');
                            Alert.alert(
                              t('settings.teamLimitReached'),
                              t('settings.teamLimitMessage', { limit: maxTeamMembers })
                            );
                            return;
                          }

                          if (!isAuthenticated) {
                            console.log('[TEAM_BUTTON] Not authenticated, showing alert');
                            Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
                            return;
                          }
                          console.log('[TEAM_BUTTON] Calling handleSetupTeam for business');
                          await handleSetupTeam();
                          return;
                        }

                        // Enterprise - allow unlimited team members
                        if (isEnterprise) {
                          console.log('[TEAM_BUTTON] Enterprise plan detected');
                          if (!isAuthenticated) {
                            console.log('[TEAM_BUTTON] Not authenticated, showing alert');
                            Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
                            return;
                          }
                          console.log('[TEAM_BUTTON] Calling handleSetupTeam for enterprise');
                          await handleSetupTeam();
                          return;
                        }

                        console.log('[TEAM_BUTTON] No matching plan condition - this should not happen!');
                      }}
                      disabled={(() => {
                        const isDisabled = isSigningIn;
                        console.log('[SETUP_TEAM_STANDALONE_BUTTON] Disabled state:', {
                          isDisabled,
                          isSigningIn,
                          timestamp: Date.now()
                        });
                        if (isDisabled) {
                          console.log('[SETUP_TEAM_STANDALONE_BUTTON] ====== BUTTON IS DISABLED - onPress WILL NOT FIRE ======');
                        }
                        return isDisabled;
                      })()}
                    >
                      <Text style={[
                        styles.featureButtonText,
                        ((!userPlan || userPlan === 'starter') || userPlan === 'pro') && styles.buttonTextDisabled
                      ]}>
                        {t('settings.setUpTeam')}
                      </Text>
                    </TouchableOpacity>
                    
                    {/* Multiple Profiles Button - Always visible */}
                    <TouchableOpacity
                      style={[
                        styles.featureButton,
                        styles.multipleProfilesButton,
                        ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || userPlan === 'business' || isSigningIn) && styles.multipleProfilesButtonDisabled
                      ]}
                      onPress={() => {
                        // For enterprise, show accounts management modal; for others, show plan modal
                        if (userPlan === 'enterprise') {
                          setShowMultipleAccountsModal(true);
                        } else {
                          setShowPlanModal(true);
                        }
                      }}
                      disabled={isSigningIn}
                    >
                      <Text style={[
                        styles.featureButtonText,
                        styles.multipleProfilesButtonText,
                        ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || userPlan === 'business') && styles.multipleProfilesButtonTextDisabled
                      ]}>
                        {t('settings.manageProfiles', { defaultValue: 'Manage Profiles' })}
                      </Text>
                    </TouchableOpacity>
                    
                    {!isGoogleSignInAvailable && (canUse(FEATURES.GOOGLE_DRIVE_SYNC) || canUse(FEATURES.TEAM_INVITES)) && (
                      <View style={styles.expoGoWarning}>
                        <Text style={styles.expoGoWarningText}>
                          {t('settings.expoGoWarning')}
                        </Text>
                        <Text style={styles.expoGoWarningSubtext}>
                          {t('settings.expoGoWarningCommand')}
                        </Text>
                      </View>
                    )}
                  </>
                </>
              )}
            </>
          ) : displayedActiveAccount ? (
            <>
              {(() => {
                  const ScrollingAccountName = ({ text, isActive, onToggle, accountType = 'google' }) => {
                    const scrollX = useRef(new Animated.Value(0)).current;
                    const [needsScrolling, setNeedsScrolling] = useState(false);
                    const textRef = useRef(null);
                    const containerWidth = useRef(null);

                    useEffect(() => {
                      if (textRef.current && containerWidth.current !== null) {
                        const timeout = setTimeout(() => {
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
                      } else {
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

                  const activeAccountEmail = displayedActiveAccount?.email || displayedActiveAccount?.name || t('settings.unknownEmail');

                  const accountType = displayedActiveAccount?.accountType || 'google';
                  const isDropboxAccount = accountType === 'dropbox';

                  // Check if team is connected (proxySessionId exists, userMode === 'admin', AND plan supports teams)
                  const isTeamConnected = proxySessionId && userMode === 'admin' && (userPlan === 'business' || userPlan === 'enterprise');
                  
                  return (
                    <>
              {/* Team Connected Banner - Show above account card when team is connected */}
              {isTeamConnected && (
                <View style={styles.teamConnectedBanner}>
                  <Text style={styles.teamConnectedBannerText}>
                    {t('settings.teamConnected', { defaultValue: 'Team Connected' })}
                    {(() => {
                      // Show used/total members: Enterprise uses global count (with local fallback), others use local
                      let used = 0;
                      let total = planLimit || 0;

                      if (userPlan === 'enterprise') {
                        const localCount = teamMembersList?.length || 0;
                        const globalCount = globalTeamMemberCount || 0;
                        used = globalCount > 0 ? globalCount : localCount;
                      } else {
                        used = teamMembersList?.length || 0;
                        if (!total) {
                          if (userPlan === 'business') {
                            total = 5;
                          } else {
                            total = 0;
                          }
                        }
                      }

                      if (!total) return null;

                      return (
                        <Text style={styles.teamConnectedBannerText}>
                          {' '}
                          • {used} / {total}{' '}
                          {t('settings.teamMembersShort', { defaultValue: 'members' })}
                        </Text>
                      );
                    })()}
                  </Text>
                </View>
              )}
                      <View style={[styles.accountItem, isDropboxAccount && styles.accountItemDropbox]}>
                        {/* First line: Account name with scrolling + checkbox + icon */}
                        <ScrollingAccountName
                          text={activeAccountEmail}
                          isActive={true}
                          accountType={accountType}
                          onToggle={() => {
                            // Active account checkbox - no action needed, just show as active
                          }}
                        />
                        {/* Second line: Buttons */}
                        <View style={styles.accountActionsRow}>
                          {/* Yellow button (left) - Set Up Team or Manage Team */}
                        {(() => {
                          const setupTeamDisabled = isSigningIn;
                          const setupTeamStyleDisabled = isSigningIn;
                          return null;
                        })()}
                        <TouchableOpacity
                          style={[
                            styles.accountActionButton,
                            styles.accountActionButtonYellow,
                            isSigningIn && styles.buttonDisabled
                          ]}
                          onPress={async () => {
                            // Show tier selection modal for Starter/Pro users
                            if (userPlan === 'starter' || userPlan === 'pro') {
                              setShowPlanModal(true);
                              return;
                            }

                            // If team is connected, open Manage Team modal
                            if (isTeamConnected) {
                              // Fetch team members before opening modal
                              setTeamNameInput(teamName || ''); // Initialize with current team name
                              setLoadingTeamMembers(true);
                              try {
                                const result = await proxyService.getTeamMembers(proxySessionId);
                                if (result.success && result.teamMembers) {
                                  setTeamMembersList(result.teamMembers);
                                } else {
                                  setTeamMembersList([]);
                                }
                              } catch (error) {
                                console.error('[SETTINGS] Failed to fetch team members:', error);
                                setTeamMembersList([]);
                              } finally {
                                setLoadingTeamMembers(false);
                                setShowManageTeamModal(true);
                              }
                              return;
                            }
                            
                            // If team is not connected, proceed with setup
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

                                if (!isAuthenticated) {
                                  Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
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
                              if (!isAuthenticated) {
                                Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
                                return;
                              }
                              await handleSetupTeam();
                              return;
                            }
                          }}
                          disabled={(() => {
                            const isDisabled = isSigningIn;
                            return isDisabled;
                          })()}
                        >
                          <Text style={[
                            styles.accountActionButtonText,
                            styles.accountActionButtonTextYellow
                          ]}>
                            {isTeamConnected 
                              ? t('settings.manageTeam', { defaultValue: 'Manage Team' })
                              : t('settings.setUpTeam', { defaultValue: 'Set Up Team' })
                            }
                          </Text>
                        </TouchableOpacity>
                        {/* Light red button (right) - Disconnect or Reconnect */}
                        <TouchableOpacity
                          style={[styles.accountActionButton, styles.accountActionButtonDisconnect]}
                          onPress={async () => {
                            // Handle disconnect for both Google and Dropbox accounts
                            if (isDropboxAccount) {
                              // Disconnect Dropbox account
                              try {
                                await dropboxAuthService.signOut();
                                setIsDropboxAuthenticated(false);
                                setDropboxUserInfo(null);
                                
                                // For enterprise, also remove from connectedAccounts
                                if (isEnterprisePlan && displayedActiveAccount?.id && removeConnectedAccount) {
                                  await removeConnectedAccount(displayedActiveAccount.id, 'dropbox');
                                }
                                
                                Alert.alert(t('common.success'), t('settings.dropboxDisconnected'));
                              } catch (error) {
                                console.error('[SETTINGS] Error disconnecting Dropbox:', error);
                                Alert.alert(t('common.error'), t('settings.dropboxDisconnectError'));
                              }
                            } else {
                              // Disconnect Google account
                              if (needsReconnect) {
                                // Reconnect: sign out then prompt to sign in again
                                try {
                                  await signOut();
                                  setTimeout(() => {
                                    Alert.alert(
                                      t('settings.reconnectRequired', { defaultValue: 'Reconnect Required' }),
                                      t('settings.reconnectMessage', { defaultValue: 'Please tap "Connect with Google Drive" below to sign in again and refresh your authorization.' })
                                    );
                                  }, 500);
                                } catch (error) {
                                  console.error('[SETTINGS] Error signing out for reconnect:', error);
                                  Alert.alert(t('common.error'), t('settings.reconnectError', { defaultValue: 'Failed to disconnect. Please try manually disconnecting from Settings.' }));
                                }
                              } else {
                                // Normal disconnect
                                await handleSignOut();
                              }
                            }
                          }}
                          disabled={(() => {
                            const isDisabled = isSigningIn;
                            return isDisabled;
                          })()}
                        >
                          <Text style={[styles.accountActionButtonText, styles.accountActionButtonTextDisconnect]}>
                            {needsReconnect
                              ? t('settings.reconnect', { defaultValue: 'Reconnect' })
                              : t('settings.disconnect', { defaultValue: 'Disconnect' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    </>
                  );
                })()}

              {/* Dropbox Account Info */}
              {/* Old Dropbox Account Info - Removed - now using displayedActiveAccount card above */}

              {/* Show all buttons when authenticated, with enable/disable based on plan */}
              <>
                {/* Connect to Google button - Only show if not connected or enterprise can add multiple */}
                {(() => {
                  const shouldShow = !isAuthenticated || (isAuthenticated && canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS));
                  return shouldShow;
                })() && (
                  <TouchableOpacity
                    style={[
                      styles.featureButton,
                      styles.googleSignInButton,
                      (() => {
                        // For Pro/Business: If Dropbox is connected, button should be active (for switching accounts)
                        // For Enterprise: Button is active if multiple accounts feature is available
                        // For others: Button is disabled if feature is not available
                        let styleDisabled = false;
                        if (userPlan === 'pro' || userPlan === 'business') {
                          // For Pro/Business, button is only disabled if Google sign-in is not available or signing in
                          styleDisabled = (!isGoogleSignInAvailable || isSigningIn);
                        } else if (userPlan === 'enterprise') {
                          // For Enterprise, button is disabled if multiple accounts feature is not available
                          styleDisabled = (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) || !isGoogleSignInAvailable || isSigningIn);
                        } else {
                          // For other plans, disable if feature is not available
                          styleDisabled = (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) || !isGoogleSignInAvailable || isSigningIn);
                        }
                        return styleDisabled && styles.googleButtonDisabled;
                      })()
                    ]}
                    onPress={async () => {
                      // For Pro/Business: Check if Dropbox is connected first
                      if ((userPlan === 'pro' || userPlan === 'business') && isDropboxAuthenticatedForDisplay) {
                        Alert.alert(
                          t('settings.disconnectActiveAccount', { defaultValue: 'Disconnect Active Account' }),
                          t('settings.disconnectActiveAccountMessage', { 
                            defaultValue: 'You need to disconnect your current Dropbox account before connecting a Google account.' 
                          }),
                          [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                              text: t('settings.disconnect', { defaultValue: 'Disconnect' }),
                              style: 'destructive',
                              onPress: async () => {
                                // Disconnect Dropbox first
                                try {
                                  await dropboxAuthService.signOut();
                                  setIsDropboxAuthenticated(false);
                                  setDropboxUserInfo(null);
                                } catch (error) {
                                  console.error('[SETTINGS] Error disconnecting Dropbox:', error);
                                }
                                // Continue with Google sign-in
                                setIsSigningIn(true);
                                try {
                                  if (userPlan === 'pro') {
                                    await individualSignIn();
                                  } else {
                                    await adminSignIn();
                                  }
                                } catch (error) {
                                  console.error('[SETTINGS] Error during sign in:', error);
                                } finally {
                                  setIsSigningIn(false);
                                }
                              }
                            }
                          ]
                        );
                        return;
                      }
                      
                      // Only Enterprise can connect multiple accounts
                      if (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS)) {
                        if (userPlan === 'enterprise') {
                          // For enterprise, show Manage Profiles modal
                          setShowMultipleAccountsModal(true);
                        } else {
                          // For Pro/Business without Dropbox connected, show plan modal
                          setShowPlanModal(true);
                        }
                        return;
                      }
                      
                      setIsSigningIn(true);
                      try {
                        if (userMode === 'admin') {
                          await adminSignIn();
                        } else {
                          await individualSignIn();
                        }
                      } catch (error) {
                        console.error('Error reconnecting Google account:', error);
                      } finally {
                        setIsSigningIn(false);
                      }
                    }}
                    disabled={(() => {
                      const isDisabled = !isGoogleSignInAvailable || isSigningIn;
                      return isDisabled;
                    })()}
                  >
                    {isSigningIn && canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[
                        styles.googleSignInButtonText,
                        (() => {
                          // For Pro/Business: Text is only disabled if Google sign-in is not available
                          // For Enterprise: Text is disabled if multiple accounts feature is not available
                          let textDisabled = false;
                          if (userPlan === 'pro' || userPlan === 'business') {
                            textDisabled = !isGoogleSignInAvailable;
                          } else {
                            textDisabled = (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) || !isGoogleSignInAvailable);
                          }
                          return textDisabled && styles.googleButtonTextDisabled;
                        })()
                      ]}>
                        {t('settings.connectToGoogleAccount')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                
                {/* Connect to Dropbox Button - Hide if Dropbox is already connected (for Pro/Business), show if Google is connected or neither */}
                {((userPlan === 'pro' || userPlan === 'business') ? (!isDropboxAuthenticatedForDisplay || isAuthenticated) : true) && (
                  <TouchableOpacity
                    style={[
                      styles.featureButton,
                      styles.dropboxButton,
                      (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox) && styles.dropboxButtonDisabled
                    ]}
                    onPress={async () => {
                      // Check if Dropbox is already connected
                      if (isDropboxAuthenticatedForDisplay) {
                        // Already connected - shouldn't reach here due to button visibility
                        return;
                      }

                    // Check feature access
                    if (!canUse(FEATURES.DROPBOX_SYNC)) {
                      setShowPlanModal(true);
                      return;
                    }
                      
                    if (!dropboxAuthService.isConfigured()) {
                      Alert.alert(
                        t('settings.featureUnavailable'),
                        t('settings.dropboxNotConfigured')
                      );
                      return;
                    }

                    // For Pro/Business: Check if another account is connected
                    if ((userPlan === 'pro' || userPlan === 'business') && isAuthenticated) {
                      Alert.alert(
                        t('settings.disconnectActiveAccount', { defaultValue: 'Disconnect Active Account' }),
                        t('settings.disconnectActiveAccountMessage', { 
                          defaultValue: 'You need to disconnect your current Google account before connecting a Dropbox account.' 
                        }),
                        [
                          { text: t('common.cancel'), style: 'cancel' },
                          {
                            text: t('settings.disconnect', { defaultValue: 'Disconnect' }),
                            style: 'destructive',
                            onPress: async () => {
                              // Disconnect Google first
                              try {
                                await signOut();
                              } catch (error) {
                                console.error('[SETTINGS] Error disconnecting Google:', error);
                              }
                              // Continue with Dropbox sign-in
                              setIsSigningInDropbox(true);
                              try {
                                const result = await dropboxAuthService.signIn();
                                
                                // Find or create ProofPix folder
                                try {
                                  const folderPath = await dropboxService.findOrCreateProofPixFolder();
                                  console.log('[DROPBOX] Folder ready:', folderPath);
                                } catch (folderError) {
                                  console.error('[DROPBOX] Folder creation error:', folderError);
                                }

                                await dropboxAuthService.loadStoredTokens();
                                const isAuth = dropboxAuthService.isAuthenticated();
                                const userInfo = dropboxAuthService.getUserInfo();
                                
                                setIsDropboxAuthenticated(isAuth);
                                setDropboxUserInfo(userInfo);
                                
                                console.log('[DROPBOX] Sign-in successful!');
                                
                                Alert.alert(
                                  t('settings.dropboxConnected'),
                                  t('settings.dropboxConnectedMessage', { email: userInfo?.email || '' }),
                                  [{ text: t('common.ok') }]
                                );
                              } catch (error) {
                                console.error('[DROPBOX] Sign-in error:', error);
                                Alert.alert(
                                  t('common.error'),
                                  error.message || t('settings.dropboxSignInError')
                                );
                              } finally {
                                setIsSigningInDropbox(false);
                              }
                            }
                          }
                        ]
                      );
                      return;
                    }
                      
                    // Starter tier - show plan popup (only for non-Pro/Business)
                    if ((userPlan !== 'pro' && userPlan !== 'business' && userPlan !== 'enterprise') && !canUse(FEATURES.DROPBOX_SYNC)) {
                      setShowPlanModal(true);
                      return;
                    }
                      
                    if (!dropboxAuthService.isConfigured()) {
                      Alert.alert(
                        t('settings.featureUnavailable'),
                        t('settings.dropboxNotConfigured')
                      );
                      return;
                    }

                    setIsSigningInDropbox(true);
                    try {
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
                      
                      console.log('[DROPBOX] Sign-in successful!');
                      console.log('[DROPBOX] User info:', userInfo);
                      console.log('[DROPBOX] Is authenticated:', isAuth);
                      
                      // Add Dropbox account to connected accounts for enterprise users
                      if (isAuth && userInfo && userPlan === 'enterprise') {
                        try {
                          // Format Dropbox user info to match Google account format
                          const dropboxAccount = {
                            id: userInfo.account_id || userInfo.email || `dropbox_${Date.now()}`,
                            email: userInfo.email,
                            name: userInfo.name?.display_name || userInfo.name?.given_name || userInfo.email,
                            givenName: userInfo.name?.given_name || userInfo.name?.display_name,
                            photo: null, // Dropbox doesn't provide photo in userInfo
                          };
                          
                          await upsertConnectedAccount(dropboxAccount, {
                            accountType: 'dropbox',
                            userMode: userMode || 'admin',
                          });
                          console.log('[DROPBOX] Account added to connected accounts');
                        } catch (accountError) {
                          console.error('[DROPBOX] Error adding account to connected accounts:', accountError);
                          // Don't fail the sign-in if adding to connected accounts fails
                        }
                      }
                      
                      // Show success alert
                      Alert.alert(
                        t('settings.dropboxConnected'),
                        t('settings.dropboxConnectedMessage', { email: userInfo?.email || '' }),
                        [{ text: t('common.ok') }]
                      );
                    } catch (error) {
                      console.error('[DROPBOX] Sign-in error:', error);
                      Alert.alert(
                        t('common.error'),
                        error.message || t('settings.dropboxSignInError')
                      );
                    } finally {
                      setIsSigningInDropbox(false);
                    }
                  }}
                  disabled={(userPlan === 'pro' || userPlan === 'business') ? isSigningInDropbox : (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox)}
                >
                  {isSigningInDropbox ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[
                      styles.featureButtonText,
                      styles.dropboxButtonText,
                      ((userPlan === 'pro' || userPlan === 'business') ? false : !canUse(FEATURES.DROPBOX_SYNC)) && styles.dropboxButtonTextDisabled
                    ]}>
                      {t('settings.connectToDropbox')}
                    </Text>
                  )}
                </TouchableOpacity>
                )}
                
                {/* Manage Profiles Button - Always visible for enterprise, shows plan modal for others */}
                {(userPlan === 'enterprise' || !isAuthenticated) && (
                  <TouchableOpacity
                    style={[
                      styles.featureButton,
                      styles.multipleProfilesButton,
                      ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || userPlan === 'business' || isSigningIn) && styles.multipleProfilesButtonDisabled
                    ]}
                    onPress={() => {
                      // For enterprise, show accounts management modal; for others, show plan modal
                      if (userPlan === 'enterprise') {
                        setShowMultipleAccountsModal(true);
                      } else {
                        setShowPlanModal(true);
                      }
                    }}
                    disabled={isSigningIn}
                  >
                    <Text style={[
                      styles.featureButtonText,
                      styles.multipleProfilesButtonText,
                      ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || userPlan === 'business') && styles.multipleProfilesButtonTextDisabled
                    ]}>
                      {t('settings.manageProfiles', { defaultValue: 'Manage Profiles' })}
                    </Text>
                  </TouchableOpacity>
                )}
              </>

              {userMode === 'admin' && isSetupComplete() && false && (
                <>
                  <View style={styles.connectedStatus}>
                    <Text style={styles.connectedText}>✓ {t('settings.teamConnected')}</Text>
                  </View>

                  {/* Editable Team Name */}
                  <View style={styles.teamNameContainer}>
                    <Text style={styles.teamNameLabel}>{t('settings.teamName')}</Text>
                    {editingTeamName ? (
                      <View style={styles.teamNameEditContainer}>
                        <TextInput
                          style={styles.teamNameInput}
                          value={teamNameInput}
                          onChangeText={setTeamNameInput}
                          placeholder={t('settings.enterTeamName')}
                          placeholderTextColor={COLORS.GRAY}
                          autoFocus={true}
                        />
                        <View style={styles.teamNameButtons}>
                          <TouchableOpacity
                            style={styles.teamNameButton}
                            onPress={async () => {
                              await updateTeamName(teamNameInput);
                              setEditingTeamName(false);
                            }}
                          >
                            <Text style={styles.teamNameButtonText}>{t('common.save')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.teamNameButton, styles.teamNameButtonCancel]}
                            onPress={() => {
                              setTeamNameInput(teamName || '');
                              setEditingTeamName(false);
                            }}
                          >
                            <Text style={[styles.teamNameButtonText, styles.teamNameButtonTextCancel]}>{t('common.cancel')}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.teamNameDisplay}
                        onPress={() => {
                          setTeamNameInput(teamName || '');
                          setEditingTeamName(true);
                        }}
                      >
                        <Text style={[
                          styles.teamNameText,
                          !teamName && styles.teamNameTextPlaceholder
                        ]}>
                          {teamName || t('settings.tapToAddTeamName')}
                        </Text>
                        <Text style={styles.teamNameEditIcon}>✎</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  
                  <InviteManager navigation={navigation} />
                </>
              )}
            </>
          ) : null}
        </View>

        {/* Referral Program */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('referral.settingsSectionTitle', { defaultValue: 'Invite Friends' })}</Text>
          <View style={styles.referralStatsContainer}>
            <View style={styles.referralStatItem}>
              <Text style={styles.referralStatLabel}>
                {t('referral.settingsFriendsJoinedLabel', { defaultValue: 'Friends Joined' })}
              </Text>
              <Text style={styles.referralStatValue}>
                {t('referral.settingsFriendsJoinedSummary', {
                  completed: referralInfo.invitesSent?.filter(inv => inv.status === 'completed').length || 0,
                  defaultValue: `${referralInfo.invitesSent?.filter(inv => inv.status === 'completed').length || 0} of 3`
                })}
              </Text>
            </View>
            <View style={[styles.referralStatItem, styles.referralStatItemRight]}>
              <Text style={[styles.referralStatLabel, styles.referralStatLabelRight]}>
                {t('referral.settingsMonthsEarnedLabel', { defaultValue: 'Months Earned' })}
              </Text>
              <Text style={[styles.referralStatValue, styles.referralStatValueRight]}>
                {t('referral.settingsMonthsEarnedSummary', {
                  months: referralInfo.totalMonthsEarned || 0,
                  defaultValue: `${referralInfo.totalMonthsEarned || 0} months`
                })}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.featureButton, styles.referralButton]}
            onPress={() => navigation.navigate('Referral')}
          >
            <Text style={[styles.featureButtonText, styles.referralButtonText]}>
              {t('referral.settingsInviteButton', { defaultValue: 'Invite Friends' })}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Account & Data */}
        <View 
          ref={accountDataSectionRef}
          style={styles.section}
        >
          <Text style={styles.sectionTitle}>{t('settings.accountData')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('settings.userName')}</Text>
            <TextInput
              style={[styles.input, isTeamMember && styles.inputDisabled]}
              value={name}
              onChangeText={setName}
              placeholder={t('settings.enterYourName')}
              placeholderTextColor={COLORS.GRAY}
              onBlur={handleSaveUserInfo}
              editable={!isTeamMember}
            />
          </View>

          <View style={styles.divider} />

          {/* Contact Us Section */}
          <Text style={styles.sectionTitle}>{t('settings.contactUs')}</Text>
          <Text style={styles.sectionDescription}>
            {t('settings.contactUsDescription')}
          </Text>
          <TouchableOpacity
            style={styles.contactButton}
            onPress={() => setShowContactModal(true)}
          >
            <Text style={styles.contactButtonText}>{t('settings.contactUs')}</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.sectionDescription}>
            {isTeamMember
              ? t('settings.resetTeamMemberDescription')
              : t('settings.resetIndividualDescription')}
          </Text>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleResetUserData}
          >
            <Text style={styles.resetButtonText}>{t('settings.resetUserData')}</Text>
          </TouchableOpacity>

          {/* Test Tools Button - Only in Development */}
          {__DEV__ && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.testToolsButton}
                onPress={() => setShowTestToolsModal(true)}
              >
                <Text style={styles.testToolsButtonText}>🧪 Test Tools</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        </ScrollView>

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

        {/* hex modal rendered inside color modal */}

        {/* Plan Selection Modal */}
        <RNModal
          visible={showPlanModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowPlanModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('planModal.title')}</Text>
                <TouchableOpacity
                  onPress={() => setShowPlanModal(false)}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>×</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalScrollView}>
                <View style={styles.planContainer}>
                  <TouchableOpacity
                    style={[styles.planButton, userPlan === 'starter' && styles.planButtonSelected]}
                    onPress={async () => {
                      // Clear team data when switching to Starter
                      if (userPlan === 'business' || userPlan === 'enterprise') {
                        try {
                          await updatePlanLimit(0);
                          await initializeProxySession(null);
                        } catch (error) {
                          console.error('[SETTINGS] Error clearing team data:', error);
                        }
                      }
                      await updateUserPlan('starter');
                      setShowPlanModal(false);
                    }}
                  >
                    <View style={styles.planButtonRow}>
                      <Text style={[styles.planButtonText, userPlan === 'starter' && styles.planButtonTextSelected]}>{t('firstLoad.starter')}</Text>
                      <Text style={styles.planPrice}>Free</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.planSubtext}>{t('firstLoad.starterDesc')}</Text>
                </View>

                <View style={styles.planContainer}>
                  <TouchableOpacity
                    style={[styles.planButton, userPlan === 'pro' && styles.planButtonSelected]}
                    onPress={async () => {
                      // Clear team data when switching to Pro
                      if (userPlan === 'business' || userPlan === 'enterprise') {
                        try {
                          await updatePlanLimit(0);
                          await initializeProxySession(null);
                        } catch (error) {
                          console.error('[SETTINGS] Error clearing team data:', error);
                        }
                      }
                      await updateUserPlan('pro');
                      setShowPlanModal(false);
                    }}
                  >
                    <View style={styles.planButtonRow}>
                      <Text style={[styles.planButtonText, userPlan === 'pro' && styles.planButtonTextSelected]}>{t('firstLoad.pro')}</Text>
                      <Text style={styles.planPrice}>$8.99/month</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.planSubtext}>{t('firstLoad.proDesc')}</Text>
                </View>

                <View style={styles.planContainer}>
                  <TouchableOpacity
                    style={[styles.planButton, userPlan === 'business' && styles.planButtonSelected]}
                    onPress={async () => {
                      try {
                        // Set up business tier with 5 team member limit
                        await updatePlanLimit(5);
                        await updateUserPlan('business');
                        setShowPlanModal(false);
                      } catch (error) {
                        console.error('[SETTINGS] Error setting up business plan:', error);
                        Alert.alert(
                          t('common.error'),
                          t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' })
                        );
                      }
                    }}
                  >
                    <View style={styles.planButtonRow}>
                      <Text style={[styles.planButtonText, userPlan === 'business' && styles.planButtonTextSelected]}>{t('firstLoad.business')}</Text>
                      <Text style={styles.planPrice}>$24.99/month</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.planSubtext}>
                    For small teams up to 5 members. $5.99 per additional team member
                  </Text>
                </View>

                <View style={styles.planContainer}>
                  <TouchableOpacity
                    style={[styles.planButton, userPlan === 'enterprise' && styles.planButtonSelected]}
                    onPress={async () => {
                      try {
                        // Set up enterprise tier with 15 team member limit
                        await updatePlanLimit(15);
                        // Update user plan to enterprise
                        await updateUserPlan('enterprise');
                        setShowPlanModal(false);
                        Alert.alert(
                          t('common.success', { defaultValue: 'Success' }),
                          t('settings.enterprisePlanActivated', { defaultValue: 'Enterprise plan activated with 15 team member limit. You can now manage multiple accounts and teams.' })
                        );
                      } catch (error) {
                        console.error('[SETTINGS] Error setting up enterprise plan:', error);
                        Alert.alert(
                          t('common.error'),
                          t('settings.planChangeError', { defaultValue: 'Failed to change plan. Please try again.' })
                        );
                      }
                    }}
                  >
                    <View style={styles.planButtonRow}>
                      <Text style={[styles.planButtonText, userPlan === 'enterprise' && styles.planButtonTextSelected]}>{t('firstLoad.enterprise')}</Text>
                      <Text style={styles.planPrice}>Starts at $69.99/month</Text>
                    </View>
                  </TouchableOpacity>
                  <Text style={styles.planSubtext}>
                    For growing organisations with 15 team members and more
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>
        </RNModal>

        {/* Language Selection Modal */}
        <RNModal
          visible={languageModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setLanguageModalVisible(false)}
        >
          <View style={styles.languageModalOverlay}>
            <View style={styles.languageModalContent}>
              <Text style={styles.modalTitle}>{t('settings.language')}</Text>

              <ScrollView 
                ref={appLanguageScrollViewRef}
                style={styles.languageScrollView} 
                showsVerticalScrollIndicator={true}
              >
                {LANGUAGES.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    onLayout={(event) => {
                      const layout = event.nativeEvent.layout;
                      appLanguageLayouts.current[language.code] = layout.y;
                    }}
                    style={[
                      styles.languageOption,
                      i18n.language === language.code && styles.languageOptionActive
                    ]}
                    onPress={() => {
                      i18n.changeLanguage(language.code);
                      setLanguageModalVisible(false);
                    }}
                  >
                    <Text style={styles.languageFlag}>{language.flag}</Text>
                    <Text style={[
                      styles.languageOptionText,
                      i18n.language === language.code && styles.languageOptionTextActive
                    ]}>
                      {language.name}
                    </Text>
                    {i18n.language === language.code && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setLanguageModalVisible(false)}
              >
                <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </RNModal>

        {/* Label Language Modal */}
          <RNModal
          visible={labelLanguageModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setLabelLanguageModalVisible(false)}
        >
          <View style={styles.languageModalOverlay}>
            <View style={styles.languageModalContent}>
              <Text style={styles.modalTitle}>{t('settings.labelLanguage')}</Text>
              <ScrollView 
                ref={labelLanguageScrollViewRef}
                style={styles.languageScrollView} 
                showsVerticalScrollIndicator={true}
              >
                {LANGUAGES.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    onLayout={(event) => {
                      const layout = event.nativeEvent.layout;
                      labelLanguageLayouts.current[language.code] = layout.y;
                    }}
                    style={[
                      styles.languageOption,
                      labelLanguage === language.code && styles.languageOptionActive
                    ]}
                    onPress={() => {
                      updateLabelLanguage(language.code);
                      setLabelLanguageModalVisible(false);
                    }}
                  >
                    <Text style={styles.languageFlag}>{language.flag}</Text>
                    <Text style={[
                      styles.languageOptionText,
                      labelLanguage === language.code && styles.languageOptionTextActive
                    ]}>
                      {language.name}
                    </Text>
                    {labelLanguage === language.code && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setLabelLanguageModalVisible(false)}
              >
                <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </RNModal>

        {/* Section Language Modal */}
          <RNModal
          visible={sectionLanguageModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSectionLanguageModalVisible(false)}
        >
          <View style={styles.languageModalOverlay}>
            <View style={styles.languageModalContent}>
              <Text style={styles.modalTitle}>{t('settings.sectionLanguage')}</Text>
              <ScrollView
                ref={sectionLanguageScrollViewRef}
                style={styles.languageScrollView}
                showsVerticalScrollIndicator={true}
              >
                {LANGUAGES.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    onLayout={(event) => {
                      const layout = event.nativeEvent.layout;
                      sectionLanguageLayouts.current[language.code] = layout.y;
                    }}
                    style={[
                      styles.languageOption,
                      sectionLanguage === language.code && styles.languageOptionActive
                    ]}
                    onPress={() => {
                      updateSectionLanguage(language.code);
                      setSectionLanguageModalVisible(false);
                    }}
                  >
                    <Text style={styles.languageFlag}>{language.flag}</Text>
                    <Text
                      style={[
                        styles.languageOptionText,
                        sectionLanguage === language.code && styles.languageOptionTextActive
                      ]}
                    >
                      {language.name}
                    </Text>
                    {sectionLanguage === language.code && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={() => setSectionLanguageModalVisible(false)}
              >
                <Text style={styles.closeModalButtonText}>{t('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </RNModal>

        {/* Enterprise Contact Form Modal */}
        <EnterpriseContactModal
          visible={showEnterpriseModal}
          onClose={() => setShowEnterpriseModal(false)}
        />

        {/* Contact Us Modal */}
        <EnterpriseContactModal
          visible={showContactModal}
          onClose={() => setShowContactModal(false)}
          title={t('settings.contactUsTitle')}
          subtitle={t('settings.contactUsSubtitle')}
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
                            } else {
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

                                        if (!isAuthenticated) {
                                          Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
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
                                      if (!isAuthenticated) {
                                        Alert.alert(t('settings.signInRequired'), t('settings.connectGoogleFirst'));
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

        {/* Test Tools Modal - Only in Development */}
        {__DEV__ && (
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
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay0();
                          Alert.alert('Test Set', 'Trial set to Day 0. Restart app or go to foreground to see welcome message.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 0 (Welcome)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay7_10();
                          Alert.alert('Test Set', 'Trial set to Day 7-10. Restart app to see engagement message.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 7-10</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay15();
                          Alert.alert('Test Set', 'Trial set to Day 15. Restart app to see check-in message.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 15</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay22_24();
                          Alert.alert('Test Set', 'Trial set to Day 22-24. Restart app to see early reminder.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 22-24</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay27_28();
                          Alert.alert('Test Set', 'Trial set to Day 27-28. Restart app to see last chance message.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 27-28</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.testButton}
                        onPress={async () => {
                          await TrialTestUtils.testDay30();
                          Alert.alert('Test Set', 'Trial set to expired. Restart app to see expiration message.');
                        }}
                      >
                        <Text style={styles.testButtonText}>Day 30 (Expired)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.testButton, { backgroundColor: '#FF0000' }]}
                        onPress={async () => {
                          await TrialTestUtils.testDay30();
                          Alert.alert('Test Set', 'Trial set to expired. Restart app to see Day 30 expiration message with discount and referral.');
                        }}
                      >
                        <Text style={[styles.testButtonText, { color: '#FFFFFF' }]}>Test Day 30</Text>
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
            console.log('[MANAGE_TEAM_MODAL] onModalWillShow - teamName:', teamName);
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
                    Enter a name to simulate the complete team member setup process.
                  </Text>
                  <TextInput
                    style={styles.testNameInput}
                    placeholder="Enter team member name"
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
                      <Text style={styles.testModalButtonTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.testModalButton, styles.testModalButtonJoin]}
                      onPress={handleTestJoinWithName}
                      disabled={!testMemberName.trim() || isTestingInvite}
                    >
                      {isTestingInvite ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={[styles.testModalButtonTextJoin, (!testMemberName.trim() || isTestingInvite) && styles.testModalButtonTextDisabled]}>
                          Join
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
                            {remainingSlots} remaining
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
                                    <Text style={styles.tokenLabel}>Code:</Text>
                                    <Text style={styles.inviteToken} selectable>{item}</Text>
                                  </View>
                                  <View style={styles.buttonGroup}>
                                    <TouchableOpacity onPress={() => handleCopyToken(item)} style={styles.actionButton}>
                                      <Text style={styles.copyButton}>Copy</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => handleShareInvite(item)} style={styles.actionButton}>
                                      <Text style={styles.shareButton}>Share</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                      onPress={() => handleTestInvite(item)}
                                      style={[styles.actionButton, (isTestingInvite || showTestNameInput) && styles.buttonDisabled]}
                                      disabled={isTestingInvite || showTestNameInput}
                                    >
                                      <Text style={[styles.testButton, (isTestingInvite || showTestNameInput) && styles.buttonTextDisabled]}>
                                        Test
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
                              Add Team Member
                            </Text>
                            <Text style={styles.addMemberButtonPrice}>
                              ${getPricePerMember()}/member
                            </Text>
                          </TouchableOpacity>
                        );
                      } else if (canAddMoreResult) {
                        return (
                          <TouchableOpacity style={styles.generateButton} onPress={handleGenerateInvite}>
                            <Text style={styles.generateButtonText}>Generate New Invite</Text>
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
                                    <Text style={styles.memberName}>{item.name || 'Unknown'}</Text>
                                    {showRevokeButton && (
                                      <TouchableOpacity
                                        onPress={async () => {
                                          Alert.alert(
                                            'Revoke Access',
                                            'This will remove this team member and revoke their access. They will no longer be able to upload using this code.',
                                            [
                                              { text: 'Cancel', style: 'cancel' },
                                              {
                                                text: 'Revoke',
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
                                                    Alert.alert('Access Revoked', 'The team member has been removed successfully.');
                                                  } catch (error) {
                                                    console.error('[SETTINGS] Failed to revoke access:', error);
                                                    Alert.alert('Error', 'Failed to revoke access. Please try again.');
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
                                      <Text style={styles.tokenLabelSmall}>Invite Code: </Text>
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
                        <Text style={styles.addMemberModalTitle}>Add Team Members</Text>
                        <Text style={styles.addMemberModalSubtitle}>
                          Purchase additional team member slots for your {userPlan === 'business' ? 'Business' : 'Enterprise'} plan
                        </Text>

                        <View style={styles.memberCountSelector}>
                          <Text style={styles.memberCountLabel}>Number of Members:</Text>
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
                            <Text style={styles.priceLabel}>Price per member:</Text>
                            <Text style={styles.priceValue}>${getPricePerMember().toFixed(2)}</Text>
                          </View>
                          <View style={styles.priceRow}>
                            <Text style={styles.priceLabel}>Number of members:</Text>
                            <Text style={styles.priceValue}>×{additionalMembersCount}</Text>
                          </View>
                          <View style={[styles.priceRow, styles.totalPriceRow]}>
                            <Text style={styles.totalPriceLabel}>Total:</Text>
                            <Text style={styles.totalPriceValue}>${(getPricePerMember() * additionalMembersCount).toFixed(2)}</Text>
                          </View>
                        </View>

                        <View style={styles.addMemberModalButtons}>
                          <TouchableOpacity
                            style={[styles.modalButton, styles.cancelButton]}
                            onPress={() => setShowAddMemberModal(false)}
                          >
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.modalButton, styles.purchaseButton]}
                            onPress={handlePurchaseAdditionalMembers}
                          >
                            <Text style={styles.purchaseButtonText}>Add</Text>
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
    backgroundColor: '#FFFFFF',
    elevation: 2,
  },
});

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: COLORS.BACKGROUND
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      paddingTop: 10,
      backgroundColor: 'white',
      borderBottomWidth: 1,
      borderBottomColor: COLORS.BORDER
    },
    backButton: {
      width: 60
    },
    backButtonText: {
      color: COLORS.PRIMARY,
      fontSize: 24,
      fontWeight: 'bold'
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: COLORS.TEXT
    },
    content: {
      flex: 1
    },
    section: {
      backgroundColor: 'white',
      marginTop: 20,
      paddingVertical: 20,
      paddingHorizontal: 20,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: COLORS.BORDER
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      marginBottom: 16
    },
    inputGroup: {
      marginBottom: 16
    },
    label: {
      fontSize: 14,
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
      backgroundColor: 'white'
    },
    locationOptionSelected: {
      backgroundColor: '#f7f7f7'
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
      color: COLORS.GRAY,
      marginBottom: 12
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12
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
      fontWeight: '600'
    },
    settingDescription: {
      color: COLORS.GRAY,
      fontSize: 12
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
      backgroundColor: '#f9f9f9',
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
    googleSignInButton: {
      backgroundColor: '#000000', // Black background
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
      backgroundColor: '#FFFFFF',
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
      backgroundColor: '#FFFFFF',
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
      backgroundColor: '#FFFFFF',
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
      backgroundColor: '#FFFFFF',
      borderWidth: 2,
      borderColor: '#28a745', // Green border
      opacity: 1
    },
    multipleProfilesButtonTextDisabled: {
      // Inactive Multiple Profiles button text: green
      color: '#28a745'
    },
    currentPlanBox: {
      backgroundColor: '#f0f0f0',
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
      backgroundColor: '#FFFFFF', // White background for inactive buttons
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
      color: '#666',
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
      fontFamily: 'monospace'
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
      fontFamily: 'monospace',
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
      backgroundColor: '#FFFFFF',
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
      backgroundColor: '#f7f7f7',
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
      backgroundColor: '#f0f0f0',
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
      backgroundColor: '#F5F5F5',
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
      backgroundColor: '#f0f0f0',
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
    // Dummy photo preview styles
    positionPreviewContainer: {
      marginVertical: 8,
      width: '100%',
    },
    positionPreviewBox: {
      width: '100%',
      aspectRatio: 1,
      backgroundColor: '#F5F5F5',
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
    languageName: {
      fontSize: 16,
      color: COLORS.TEXT_MUTED,
    },
    languageChangeText: {
      fontSize: 20,
      color: COLORS.TEXT_MUTED,
    },
    // Language modal styles
    languageModalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    languageModalContent: {
      backgroundColor: 'white',
      borderRadius: 16,
      padding: 24,
      width: '85%',
      maxWidth: 400,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: '#000',
      textAlign: 'center',
      marginBottom: 20,
    },
    languageScrollView: {
      maxHeight: Dimensions.get('window').height * 0.45,
    },
    languageOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
      marginBottom: 8,
      backgroundColor: '#F5F5F5',
    },
    languageOptionActive: {
      backgroundColor: '#F2C31B',
    },
    languageOptionText: {
      flex: 1,
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
    },
    languageOptionTextActive: {
      color: '#000',
    },
    checkmark: {
      fontSize: 20,
      fontWeight: 'bold',
      color: '#000',
    },
    closeModalButton: {
      marginTop: 16,
      backgroundColor: '#F2F2F2',
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    closeModalButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#333',
    },
    settingButton: {
      backgroundColor: '#FFFFFF',
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
      fontFamily: FONTS.QUICKSAND_BOLD,
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
      fontFamily: FONTS.QUICKSAND_BOLD,
    },
    testButtons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    testButton: {
      backgroundColor: COLORS.PRIMARY,
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 8,
      marginBottom: 12,
    },
    clearButton: {
      backgroundColor: '#DC3545',
    },
    testButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#000000',
      fontFamily: FONTS.QUICKSAND_BOLD,
    },
    referralStatsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 16,
      paddingVertical: 12,
    },
    referralStatItem: {
      flex: 1,
      alignItems: 'flex-start',
    },
    referralStatLabel: {
      fontSize: 12,
      color: COLORS.GRAY,
      marginBottom: 4,
      textAlign: 'left',
    },
    referralStatValue: {
      fontSize: 14,
      color: COLORS.TEXT,
      fontWeight: '600',
      textAlign: 'left',
    },
    referralStatItemRight: {
      alignItems: 'flex-end',
    },
    referralStatLabelRight: {
      textAlign: 'right',
    },
    referralStatValueRight: {
      textAlign: 'right',
    },
    referralButton: {
      backgroundColor: '#28a745',
    },
    referralButtonText: {
      color: '#FFFFFF',
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
      backgroundColor: '#f9f9f9',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#e0e0e0',
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
      backgroundColor: '#fff',
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
      gap: 8,
      marginTop: 8,
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
      backgroundColor: '#f5f5f5',
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
      color: '#666',
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
      backgroundColor: '#fff',
    },
    inviteItemSimple: {
      backgroundColor: '#f5f5f5',
      padding: 12,
      borderRadius: 8,
      marginBottom: 8,
    },
    inviteTokenText: {
      fontSize: 14,
      color: COLORS.TEXT,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    teamMemberItemSimple: {
      backgroundColor: '#f5f5f5',
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
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
      backgroundColor: '#f5f5f5',
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
      backgroundColor: '#fff',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#ddd',
    },
    memberItemFull: {
      flexDirection: 'row',
      paddingVertical: 12,
      paddingHorizontal: 10,
      marginBottom: 10,
      backgroundColor: '#fff',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#ddd',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    memberCard: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      marginBottom: 10,
      backgroundColor: '#fff',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#ddd',
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
      color: '#666',
    },
    tokenValueSmall: {
      fontSize: 12,
      color: '#333',
      fontFamily: 'monospace',
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
      color: '#666',
      marginRight: 8,
    },
    inviteToken: {
      fontSize: 13,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
      backgroundColor: '#f0f0f0',
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
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: '#dc3545',
    },
    deleteButton: {
      color: '#dc3545',
      fontSize: 18,
      fontWeight: 'bold',
    },
    deleteButtonContainer: {
      backgroundColor: '#fff',
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
      backgroundColor: '#fff',
      borderWidth: 2,
      borderColor: '#ddd',
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
      fontFamily: FONTS.QUICKSAND_BOLD,
    },
    addMemberButtonPrice: {
      fontSize: 16,
      fontWeight: '600',
      color: '#4CAF50',
      marginTop: 4,
      fontFamily: FONTS.QUICKSAND_BOLD,
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
      color: '#666',
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
      color: '#888',
    },
    memberCountValue: {
      fontSize: 32,
      fontWeight: 'bold',
      color: COLORS.TEXT,
      minWidth: 60,
      textAlign: 'center',
    },
    priceBreakdown: {
      backgroundColor: '#f8f9fa',
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
      color: '#666',
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
      backgroundColor: '#f8f9fa',
      borderWidth: 1,
      borderColor: '#ddd',
    },
    cancelButtonText: {
      color: '#666',
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
      color: '#666',
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
      color: '#666',
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
      backgroundColor: '#f9f9f9',
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
      backgroundColor: '#f0f0f0',
    },
    testModalButtonJoin: {
      backgroundColor: COLORS.PRIMARY,
    },
    testModalButtonTextCancel: {
      color: '#666',
      fontSize: 16,
      fontWeight: '600',
    },
    testModalButtonTextJoin: {
      color: 'white',
      fontSize: 16,
      fontWeight: '600',
    },
    testModalButtonTextDisabled: {
      color: '#999',
    },
  });

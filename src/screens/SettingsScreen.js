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
    }, [userPlan, connectedAccounts, userMode, upsertConnectedAccount])
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
    removeConnectedAccount,
    upsertConnectedAccount,
    activateConnectedAccount,
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
  // Only show the active account - for enterprise use activeEnterpriseAccount, for others use adminUserInfo
  const displayedActiveAccount = isEnterprisePlan 
    ? (activeEnterpriseAccount || null) 
    : adminUserInfo;

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
  const [teamNameInput, setTeamNameInput] = useState('');
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

  const handleSetupTeam = async () => {
    if (!isAuthenticated || userMode !== 'admin' || isSigningIn) {
      return;
    }

    // Check if already set up - only consider it connected if folderId is also saved (admin setup)
    if (isSetupComplete()) {
      Alert.alert(t('settings.alreadyConnected'), t('settings.alreadyConnectedMessage'));
      return;
    }

    try {
      console.log('[SETUP] Running team setup with proxy server...');
      setIsSigningIn(true); // Show a loading indicator

      // Step 0: Check if we have a serverAuthCode - if not, user needs to sign in again
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
      // Note: makeAuthenticatedRequest will handle checking if user is signed in
      const folderId = await googleDriveService.findOrCreateProofPixFolder();
      await saveFolderId(folderId);
      console.log('[SETUP] Admin folder ID saved:', folderId);

      // Step 2: Initialize proxy session (this creates the session and stores refresh token)
      const sessionResult = await initializeProxySession(folderId);
      if (!sessionResult || !sessionResult.sessionId) {
        throw new Error('Failed to initialize proxy session');
      }
      console.log('[SETUP] Proxy session initialized:', sessionResult.sessionId);

      // Step 3: Set default team name to Google profile name if not already set
      if (!teamName && adminUserInfo?.name) {
        await updateTeamName(adminUserInfo.name);
        console.log('[SETUP] Default team name set to:', adminUserInfo.name);
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
          ) : !isAuthenticated ? (
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
                  
                  {/* Buttons - Always visible, but functionality depends on tier */}
                  <>
                    {/* Connect to Google Account Button - Always visible */}
                    <TouchableOpacity
                      style={[
                        styles.featureButton,
                        styles.googleSignInButton,
                        (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable || isSigningIn) && styles.googleButtonDisabled
                      ]}
                      onPress={async () => {
                        // Starter tier - show plan popup
                        if (!canUse(FEATURES.GOOGLE_DRIVE_SYNC)) {
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
                      disabled={!isGoogleSignInAvailable || isSigningIn}
                    >
                      {isSigningIn && canUse(FEATURES.GOOGLE_DRIVE_SYNC) ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={[
                          styles.googleSignInButtonText,
                          (!canUse(FEATURES.GOOGLE_DRIVE_SYNC) || !isGoogleSignInAvailable) && styles.googleButtonTextDisabled
                        ]}>
                          {t('settings.connectToGoogleAccount')}
                        </Text>
                      )}
                    </TouchableOpacity>
                    
                    {/* Connect to Dropbox Button - Always visible */}
                    <TouchableOpacity
                      style={[
                        styles.featureButton,
                        styles.dropboxButton,
                        (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox) && styles.dropboxButtonDisabled
                      ]}
                      onPress={async () => {
                        // Starter tier - show plan popup
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
                      disabled={isSigningInDropbox}
                    >
                      {isSigningInDropbox ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={[
                          styles.featureButtonText,
                          styles.dropboxButtonText,
                          !canUse(FEATURES.DROPBOX_SYNC) && styles.dropboxButtonTextDisabled
                        ]}>
                          {t('settings.connectToDropbox')}
                        </Text>
                      )}
                    </TouchableOpacity>
                    
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
                      disabled={isSigningIn}
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
          ) : (isAuthenticated || (isEnterprisePlan && activeEnterpriseAccount)) ? (
            <>
              {(() => {
                  const ScrollingAccountName = ({ text, isActive, onToggle }) => {
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

                    return (
                      <View 
                        style={styles.accountNameContainer}
                        onLayout={(e) => {
                          if (e.nativeEvent.layout.width > 0) {
                            // Account for checkbox width in container width calculation
                            const checkboxWidth = 32; // 24px checkbox + 8px padding
                            containerWidth.current = e.nativeEvent.layout.width - checkboxWidth;
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
                      </View>
                    );
                  };

                  const activeAccountEmail = displayedActiveAccount?.email || displayedActiveAccount?.name || t('settings.unknownEmail');

                  return (
                    <View style={styles.accountItem}>
                      {/* First line: Account name with scrolling + checkbox */}
                      <ScrollingAccountName
                        text={activeAccountEmail}
                        isActive={true}
                        onToggle={() => {
                          // Active account checkbox - no action needed, just show as active
                        }}
                      />
                      {/* Second line: Buttons */}
                      <View style={styles.accountActionsRow}>
                        {/* Yellow button (left) - Set Up Team */}
                        <TouchableOpacity
                          style={[
                            styles.accountActionButton, 
                            styles.accountActionButtonYellow,
                            ((!userPlan || userPlan === 'starter') || userPlan === 'pro' || isSigningIn) && styles.buttonDisabled
                          ]}
                          onPress={async () => {
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
                        {/* Light red button (right) - Disconnect or Reconnect */}
                        <TouchableOpacity
                          style={[styles.accountActionButton, styles.accountActionButtonDisconnect]}
                          onPress={async () => {
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
                          }}
                          disabled={isSigningIn}
                        >
                          <Text style={[styles.accountActionButtonText, styles.accountActionButtonTextDisconnect]}>
                            {needsReconnect 
                              ? t('settings.reconnect', { defaultValue: 'Reconnect' })
                              : t('settings.disconnect', { defaultValue: 'Disconnect' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })()}

              {/* Dropbox Account Info */}
              {isDropboxAuthenticated && dropboxUserInfo && (
                <View style={[styles.adminInfoBox, styles.dropboxInfoBox]}>
                  <View style={styles.adminInfoHeader}>
                    <View style={[styles.activeAccountContainer, styles.dropboxAccountContainer]}>
                      <View style={styles.accountLabelRow}>
                        <Text style={styles.activeAccountLabel}>{t('settings.activeDropboxAccount')}</Text>
                        <View style={styles.connectedIndicatorDropbox}>
                          <Text style={styles.connectedCheckmarkDropbox}>✓</Text>
                        </View>
                      </View>
                      <Text style={styles.activeAccountName}>
                        {dropboxUserInfo.name || t('settings.unknownName')}
                      </Text>
                      <Text style={styles.activeAccountEmail}>
                        {dropboxUserInfo.email || t('settings.unknownEmail')}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.disconnectButton}
                      onPress={async () => {
                        Alert.alert(
                          t('settings.disconnectDropbox'),
                          t('settings.disconnectDropboxMessage'),
                          [
                            { text: t('common.cancel'), style: 'cancel' },
                            {
                              text: t('settings.disconnect'),
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  await dropboxAuthService.signOut();
                                  setIsDropboxAuthenticated(false);
                                  setDropboxUserInfo(null);
                                  Alert.alert(t('common.success'), t('settings.dropboxDisconnected'));
                                } catch (error) {
                                  Alert.alert(t('common.error'), t('settings.dropboxDisconnectError'));
                                }
                              }
                            }
                          ]
                        );
                      }}
                    >
                      <Text style={styles.disconnectButtonText}>{t('settings.disconnect')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Show all buttons when authenticated, with enable/disable based on plan */}
              <>
                {/* Connect to Google button - Only show if not connected or enterprise can add multiple */}
                {(!isAuthenticated || (isAuthenticated && canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS))) && (
                  <TouchableOpacity
                    style={[
                      styles.featureButton,
                      styles.googleSignInButton,
                      (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) || !isGoogleSignInAvailable || isSigningIn) && styles.googleButtonDisabled
                    ]}
                    onPress={async () => {
                      // Only Enterprise can connect multiple accounts
                      if (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS)) {
                        if (userPlan === 'enterprise') {
                          // For enterprise, show Manage Profiles modal
                          setShowMultipleAccountsModal(true);
                        } else {
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
                    disabled={!isGoogleSignInAvailable || isSigningIn}
                  >
                    {isSigningIn && canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={[
                        styles.googleSignInButtonText,
                        (!canUse(FEATURES.MULTIPLE_CLOUD_ACCOUNTS) || !isGoogleSignInAvailable) && styles.googleButtonTextDisabled
                      ]}>
                        {t('settings.connectToGoogleAccount')}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                
                {/* Connect to Dropbox Button - show as disabled if already connected */}
                <TouchableOpacity
                  style={[
                    styles.featureButton,
                    styles.dropboxButton,
                    (!canUse(FEATURES.DROPBOX_SYNC) || isSigningInDropbox || isDropboxAuthenticated) && styles.dropboxButtonDisabled
                  ]}
                  onPress={async () => {
                    // Check if Dropbox is already connected
                    if (isDropboxAuthenticated) {
                      // Already connected - button disabled
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
                  disabled={isSigningInDropbox || isDropboxAuthenticated}
                >
                  {isSigningInDropbox ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[
                      styles.featureButtonText,
                      styles.dropboxButtonText,
                      (!canUse(FEATURES.DROPBOX_SYNC) || isDropboxAuthenticated) && styles.dropboxButtonTextDisabled
                    ]}>
                      {isDropboxAuthenticated 
                        ? t('settings.connected', { defaultValue: 'Connected' })
                        : t('settings.connectToDropbox')}
                    </Text>
                  )}
                </TouchableOpacity>
                
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

              {userMode === 'admin' && isSetupComplete() && (
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
          <Text style={styles.sectionTitle}>Invite Friends</Text>
          <View style={styles.referralStatsContainer}>
            <View style={styles.referralStatItem}>
              <Text style={styles.referralStatLabel}>Friends Joined</Text>
              <Text style={styles.referralStatValue}>
                {referralInfo.invitesSent?.filter(inv => inv.status === 'completed').length || 0} of 3
              </Text>
            </View>
            <View style={[styles.referralStatItem, styles.referralStatItemRight]}>
              <Text style={[styles.referralStatLabel, styles.referralStatLabelRight]}>Months Earned</Text>
              <Text style={[styles.referralStatValue, styles.referralStatValueRight]}>
                {referralInfo.totalMonthsEarned || 0} months
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.featureButton, styles.referralButton]}
            onPress={() => navigation.navigate('Referral')}
          >
            <Text style={[styles.featureButtonText, styles.referralButtonText]}>Invite Friends</Text>
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
                      await updateUserPlan('business');
                      setShowPlanModal(false);
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
                        const ScrollingAccountName = ({ text, isActive, onToggle }) => {
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

                          return (
                            <View 
                              style={styles.accountNameContainer}
                              onLayout={(e) => {
                                if (e.nativeEvent.layout.width > 0) {
                                  // Account for checkbox width in container width calculation
                                  const checkboxWidth = 32; // 24px checkbox + 8px padding
                                  containerWidth.current = e.nativeEvent.layout.width - checkboxWidth;
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
                            {/* First line: Account name with scrolling + checkbox */}
                            <ScrollingAccountName
                              text={account.email || account.name}
                              isActive={account.isActive}
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

                  {/* Add Account Buttons */}
                  <View style={styles.addAccountButtons}>
                    {isGoogleSignInAvailable && (
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

                    {/* Dropbox connection button */}
                    {dropboxAuthService.isConfigured() && (
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
                              // For enterprise tier, we might want to add Dropbox account to connected accounts
                              // For now, we'll just update the state
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
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          </Modal>
        )}
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
    customModalSheet: {
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 24,
      paddingTop: 4,
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
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 6,
      marginBottom: 8,
    },
    clearButton: {
      backgroundColor: '#DC3545',
    },
    testButtonText: {
      fontSize: 12,
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
  });

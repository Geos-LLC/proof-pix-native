import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ROOMS, DEFAULT_LABEL_POSITION, DEFAULT_BEFORE_LABEL_POSITION, DEFAULT_AFTER_LABEL_POSITION, DEFAULT_WATERMARK_POSITION } from '../constants/rooms';
import { isSoftTrialActive, getRemainingExports } from '../services/softTrialService';
import { SOFT_TRIAL_EXPORT_LIMIT } from '../constants/softTrial';

const SETTINGS_KEY = 'app-settings';
const CUSTOM_ROOMS_KEY = 'custom-rooms';
const DEFAULT_LABEL_BACKGROUND = '#FFD700';
const DEFAULT_LABEL_TEXT = '#000000';
const DEFAULT_WATERMARK_TEXT = 'Created with ProofPix.app';
const DEFAULT_WATERMARK_LINK = 'https://proofpix.app/';
const DEFAULT_WATERMARK_OPACITY = 0.5;
const DEFAULT_LABEL_SIZE = 'medium';
const DEFAULT_LABEL_CORNER_STYLE = 'rounded';

// Helper function to get project-specific custom rooms key
const getProjectRoomsKey = (projectId) => `custom-rooms-${projectId}`;

const normalizeFontKey = (value) => {
  // All fonts are Alexandria; map any legacy key to alexandria
  if (!value) return 'alexandria';
  const mapped = String(value).toLowerCase();
  if (mapped === 'alexandria') return 'alexandria';
  return 'alexandria';
};

const normalizeColorHex = (value, fallback = null) => {
  if (!value) return fallback;
  const input = String(value).trim();
  if (!input) return fallback;
  if (/^rgb/i.test(input)) {
    return input;
  }
  let normalized = input.startsWith('#') ? input : `#${input}`;
  normalized = normalized.toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return fallback ?? normalized;
};

const SettingsContext = createContext();

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {

    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }) => {
  const [showLabels, setShowLabels] = useState(true);
  const [showWatermark, setShowWatermark] = useState(true);
  const [customWatermarkEnabled, setCustomWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState(DEFAULT_WATERMARK_TEXT);
  const [watermarkLink, setWatermarkLink] = useState(DEFAULT_WATERMARK_LINK);
  const [watermarkColor, setWatermarkColor] = useState(DEFAULT_LABEL_BACKGROUND);
  const [watermarkOpacity, setWatermarkOpacity] = useState(DEFAULT_WATERMARK_OPACITY);
  const [watermarkPosition, setWatermarkPosition] = useState(DEFAULT_WATERMARK_POSITION);
  const [watermarkFontFamily, setWatermarkFontFamily] = useState('alexandria');
  const [labelBackgroundColor, setLabelBackgroundColor] = useState(DEFAULT_LABEL_BACKGROUND);
  const [labelTextColor, setLabelTextColor] = useState(DEFAULT_LABEL_TEXT);
  const [labelSize, setLabelSize] = useState(DEFAULT_LABEL_SIZE);
  const [labelCornerStyle, setLabelCornerStyle] = useState(DEFAULT_LABEL_CORNER_STYLE);
  const [labelFontFamily, setLabelFontFamily] = useState('alexandria');
  const [beforeLabelPosition, setBeforeLabelPosition] = useState(DEFAULT_BEFORE_LABEL_POSITION);
  const [afterLabelPosition, setAfterLabelPosition] = useState(DEFAULT_AFTER_LABEL_POSITION);
  // Landscape-orientation overrides: when a photo is wider than tall, these
  // positions are used instead of the portrait ones. They default to the
  // portrait values so existing users see no behavior change until they tweak.
  const [beforeLabelPositionLandscape, setBeforeLabelPositionLandscape] = useState(DEFAULT_BEFORE_LABEL_POSITION);
  const [afterLabelPositionLandscape, setAfterLabelPositionLandscape] = useState(DEFAULT_AFTER_LABEL_POSITION);
  const [combinedLabelPosition, setCombinedLabelPosition] = useState(DEFAULT_LABEL_POSITION);
  const [labelMarginVertical, setLabelMarginVertical] = useState(10); // Top/bottom margin
  const [labelMarginHorizontal, setLabelMarginHorizontal] = useState(10); // Left/right margin
  const [userName, setUserName] = useState('');
  const [location, setLocation] = useState('tampa'); // Default to Tampa
  const [useFolderStructure, setUseFolderStructure] = useState(false); // Default OFF - flat structure
  const [enabledFolders, setEnabledFolders] = useState({ before: true, after: true, combined: true });
  const [labelLanguage, setLabelLanguage] = useState('en');
  const [sectionLanguage, setSectionLanguage] = useState('en');
  const [customRooms, setCustomRooms] = useState(null); // null means use default rooms
  const [userPlan, setUserPlan] = useState('starter'); // Add userPlan state
  const [cleaningServiceEnabled, setCleaningServiceEnabled] = useState(true);
  const [shutterSoundEnabled, setShutterSoundEnabled] = useState(Platform.OS !== 'android');
  const [loading, setLoading] = useState(true);

  // Soft trial state mirrored into context for synchronous reads in renderers.
  // Refreshed on mount and via `refreshSoftTrial()` after each export.
  const [softTrialActive, setSoftTrialActive] = useState(false);
  const [softTrialRemaining, setSoftTrialRemaining] = useState(SOFT_TRIAL_EXPORT_LIMIT);

  const refreshSoftTrial = useCallback(async () => {
    try {
      const [active, remaining] = await Promise.all([
        isSoftTrialActive(),
        getRemainingExports(),
      ]);
      setSoftTrialActive(active);
      setSoftTrialRemaining(remaining);
    } catch (e) {
      // non-critical
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    // Check trial expiration on app startup
    checkTrialExpiration();
    // Pull initial soft trial state (initSoftTrial() runs in AuthLoadingScreen)
    refreshSoftTrial();
  }, [refreshSoftTrial]);

  // Detect trial expiry by comparing previous-session state against current
  // entitlement. We fire `trial_expired` only when:
  //   1. A previous session persisted `@last_trial_state` (i.e. the device
  //      observed a real `trial_started` event), AND
  //   2. The current session has no active store entitlement.
  //
  // This replaces the old logic that fired `trial_expired` on every cold
  // start where the legacy in-app trial flag was missing — which was every
  // device, producing meaningless data.
  const checkTrialExpiration = async () => {
    try {
      const lastTrialRaw = await AsyncStorage.getItem('@last_trial_state');
      if (!lastTrialRaw) return; // never had a store-side trial — nothing to expire

      let lastTrial = null;
      try { lastTrial = JSON.parse(lastTrialRaw); } catch { return; }
      if (!lastTrial?.plan_id) return;

      // Ask iapService whether Apple/Google still report an active entitlement.
      // If they do, the trial hasn't expired (it's either still in trial or
      // has already converted to paid — either way, not expired).
      const { hasActiveIAPSubscription } = await import('../services/iapService');
      const stillActive = await hasActiveIAPSubscription();
      if (stillActive) return;

      // Real transition: had a trial, no longer entitled. Fire the event with
      // plan context and persist the snapshot so a subsequent `subscription_started`
      // (the conversion) can annotate itself with `was_trial: true`.
      const { logEvent } = await import('../utils/analytics');
      await logEvent('trial_expired', {
        plan_id: lastTrial.plan_id,
        product_id: lastTrial.product_id,
        original_transaction_id: lastTrial.original_transaction_id,
        days_in_trial: lastTrial.started_at
          ? Math.max(0, Math.floor((Date.now() - lastTrial.started_at) / 86400000))
          : null,
      });
      await AsyncStorage.setItem('@last_trial_expired_state', JSON.stringify(lastTrial));
      await AsyncStorage.removeItem('@last_trial_state');
    } catch (error) {
      console.error('[SettingsContext] Error checking trial expiration:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      
      if (stored) {
        const settings = JSON.parse(stored);
        setShowLabels(settings.showLabels ?? true);
        setShowWatermark(settings.showWatermark ?? true);
        setCustomWatermarkEnabled(settings.customWatermarkEnabled ?? false);
        setWatermarkText(settings.watermarkText ?? DEFAULT_WATERMARK_TEXT);
        setWatermarkLink(settings.watermarkLink ?? DEFAULT_WATERMARK_LINK);
        setWatermarkColor(
          normalizeColorHex(settings.watermarkColor, DEFAULT_LABEL_BACKGROUND)
        );
        setWatermarkOpacity(
          typeof settings.watermarkOpacity === 'number'
            ? settings.watermarkOpacity
            : DEFAULT_WATERMARK_OPACITY
        );
        setWatermarkPosition(settings.watermarkPosition ?? DEFAULT_WATERMARK_POSITION);
        setWatermarkFontFamily(normalizeFontKey(settings.watermarkFontFamily));
        setLabelBackgroundColor(
          normalizeColorHex(settings.labelBackgroundColor, DEFAULT_LABEL_BACKGROUND)
        );
        setLabelTextColor(
          normalizeColorHex(settings.labelTextColor, DEFAULT_LABEL_TEXT)
        );
        setLabelSize(settings.labelSize ?? DEFAULT_LABEL_SIZE);
        setLabelCornerStyle(settings.labelCornerStyle ?? DEFAULT_LABEL_CORNER_STYLE);
        setLabelFontFamily(normalizeFontKey(settings.labelFontFamily));
        setBeforeLabelPosition(settings.beforeLabelPosition ?? DEFAULT_BEFORE_LABEL_POSITION);
        setAfterLabelPosition(settings.afterLabelPosition ?? DEFAULT_AFTER_LABEL_POSITION);
        setBeforeLabelPositionLandscape(
          settings.beforeLabelPositionLandscape
            ?? settings.beforeLabelPosition
            ?? DEFAULT_BEFORE_LABEL_POSITION
        );
        setAfterLabelPositionLandscape(
          settings.afterLabelPositionLandscape
            ?? settings.afterLabelPosition
            ?? DEFAULT_AFTER_LABEL_POSITION
        );
        setCombinedLabelPosition(settings.combinedLabelPosition ?? DEFAULT_LABEL_POSITION);
        setLabelMarginVertical(settings.labelMarginVertical ?? 10);
        setLabelMarginHorizontal(settings.labelMarginHorizontal ?? 10);
        setUserName(settings.userName ?? '');
        setLocation(settings.location ?? 'tampa');
        setUseFolderStructure(settings.useFolderStructure ?? false); // Default OFF - flat structure
        if (settings.enabledFolders) {
          const categories = settings.enabledFolders;
          if (typeof categories.before === 'boolean' && typeof categories.after === 'boolean' && typeof categories.combined === 'boolean') {
            setEnabledFolders(categories);
          }
        }
        setLabelLanguage(settings.labelLanguage ?? 'en');
        setSectionLanguage(settings.sectionLanguage ?? (settings.labelLanguage ?? 'en'));
        setUserPlan(settings.userPlan ?? 'starter'); // Load userPlan
        setCleaningServiceEnabled(
          typeof settings.cleaningServiceEnabled === 'boolean'
            ? settings.cleaningServiceEnabled
            : true
        );
        setShutterSoundEnabled(
          typeof settings.shutterSoundEnabled === 'boolean'
            ? settings.shutterSoundEnabled
            : Platform.OS !== 'android'
        );
      }
      
      // EMERGENCY: Clear all corrupted custom rooms data
      // 
      await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
      setCustomRooms(null);
      
    } catch (error) {

    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (newSettings) => {
    try {
      // Read current stored settings first so we never overwrite fields with
      // stale React defaults (e.g., userPlan='starter' before loadSettings
      // finishes).  Stored values are the base, then current state, then the
      // explicit newSettings — but if settings haven't loaded yet, stored
      // values win for any field not in newSettings.
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      const existingSettings = stored ? JSON.parse(stored) : {};

      const stateSnapshot = {
        showLabels,
        showWatermark,
        customWatermarkEnabled,
        watermarkText,
        watermarkLink,
        watermarkColor,
        watermarkOpacity,
        watermarkPosition,
        watermarkFontFamily,
        labelBackgroundColor,
        labelTextColor,
        labelFontFamily,
        labelSize,
        labelCornerStyle,
        beforeLabelPosition,
        afterLabelPosition,
        beforeLabelPositionLandscape,
        afterLabelPositionLandscape,
        combinedLabelPosition,
        labelMarginVertical,
        labelMarginHorizontal,
        userName,
        location,
        useFolderStructure,
        enabledFolders,
        labelLanguage,
        sectionLanguage,
        userPlan,
        cleaningServiceEnabled,
        shutterSoundEnabled,
      };

      // If still loading, only write the explicit newSettings on top of stored
      // values — don't let default state clobber persisted data.
      const settings = loading
        ? { ...existingSettings, ...newSettings }
        : { ...existingSettings, ...stateSnapshot, ...newSettings };

      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {

    }
  };

  const toggleLabels = async () => {
    const newValue = !showLabels;
    setShowLabels(newValue);
    await saveSettings({ showLabels: newValue });
  };

  const toggleWatermark = async (value) => {
    const wasEnabled = customWatermarkEnabled;
    const newValue = value !== undefined ? value : !wasEnabled;
    setCustomWatermarkEnabled(newValue);
    let nextShowWatermark = showWatermark;
    const normalizedLabelColor = normalizeColorHex(labelBackgroundColor, DEFAULT_LABEL_BACKGROUND);
    const existingColor = normalizeColorHex(watermarkColor, DEFAULT_LABEL_BACKGROUND);
    let nextWatermarkColor = existingColor;
    let nextWatermarkOpacity = typeof watermarkOpacity === 'number'
      ? watermarkOpacity
      : DEFAULT_WATERMARK_OPACITY;
    
    if (!newValue) {
      // Turning OFF - just ensure watermark shows
      nextShowWatermark = true;
      setShowWatermark(true);
    } else {
      // Turning ON - reset all parameters to defaults
      setWatermarkText(DEFAULT_WATERMARK_TEXT);
      setWatermarkLink(DEFAULT_WATERMARK_LINK);
      nextWatermarkColor = DEFAULT_LABEL_BACKGROUND;
      nextWatermarkOpacity = DEFAULT_WATERMARK_OPACITY;
      setWatermarkColor(nextWatermarkColor);
      setWatermarkOpacity(nextWatermarkOpacity);
      
      // Check if default text is empty (shouldn't be, but just in case)
      if (!DEFAULT_WATERMARK_TEXT?.trim()) {
        nextShowWatermark = false;
        setShowWatermark(false);
      } else {
        nextShowWatermark = true;
        setShowWatermark(true);
      }
    }
    
    await saveSettings({
      customWatermarkEnabled: newValue,
      showWatermark: nextShowWatermark,
      watermarkText: newValue ? DEFAULT_WATERMARK_TEXT : watermarkText,
      watermarkLink: newValue ? DEFAULT_WATERMARK_LINK : watermarkLink,
      watermarkColor: newValue ? nextWatermarkColor : existingColor,
      watermarkOpacity: newValue ? nextWatermarkOpacity : watermarkOpacity,
    });
  };

  const updateWatermarkText = async (text) => {
    setWatermarkText(text);
    if (customWatermarkEnabled) {
      const trimmed = text.trim();
      const shouldShow = trimmed.length > 0;
      setShowWatermark(shouldShow);
      await saveSettings({
        watermarkText: text,
        showWatermark: shouldShow,
      });
    } else {
      await saveSettings({ watermarkText: text });
    }
  };

  const updateWatermarkLink = async (link) => {
    setWatermarkLink(link);
    await saveSettings({ watermarkLink: link });
  };

  const updateShowWatermark = async (value) => {
    setShowWatermark(value);
    await saveSettings({ showWatermark: value });
  };

  const updateWatermarkColor = async (color) => {
    const nextColor = normalizeColorHex(color, DEFAULT_LABEL_BACKGROUND);
    setWatermarkColor(nextColor);
    await saveSettings({ watermarkColor: nextColor });
  };

  const updateWatermarkOpacity = async (value) => {
    const clamped = Math.max(0, Math.min(1, typeof value === 'number' ? value : DEFAULT_WATERMARK_OPACITY));
    setWatermarkOpacity(clamped);
    await saveSettings({ watermarkOpacity: clamped });
  };

  const updateWatermarkPosition = async (position) => {
    setWatermarkPosition(position);
    await saveSettings({ watermarkPosition: position });
  };

  const updateWatermarkFontFamily = async (font) => {
    const normalized = normalizeFontKey(font);
    setWatermarkFontFamily(normalized);
    await saveSettings({ watermarkFontFamily: normalized });
  };

  const updateLabelBackgroundColor = async (color) => {
    const normalized = normalizeColorHex(color, DEFAULT_LABEL_BACKGROUND);
    setLabelBackgroundColor(normalized);
    await saveSettings({ labelBackgroundColor: normalized });
  };

  const updateLabelTextColor = async (color) => {
    const normalized = normalizeColorHex(color, DEFAULT_LABEL_TEXT);
    setLabelTextColor(normalized);
    await saveSettings({ labelTextColor: normalized });
  };

  const updateLabelSize = async (size) => {
    const allowed = ['small', 'medium', 'large'];
    const normalized = allowed.includes(size) ? size : DEFAULT_LABEL_SIZE;
    setLabelSize(normalized);
    await saveSettings({ labelSize: normalized });
  };

  const updateLabelCornerStyle = async (style) => {
    const allowed = ['rounded', 'square'];
    const normalized = allowed.includes(style) ? style : DEFAULT_LABEL_CORNER_STYLE;
    setLabelCornerStyle(normalized);
    await saveSettings({ labelCornerStyle: normalized });
  };

  const updateLabelFontFamily = async (font) => {
    const normalized = normalizeFontKey(font);
    setLabelFontFamily(normalized);
    await saveSettings({ labelFontFamily: normalized });
  };

  const updateBeforeLabelPosition = async (position) => {
    setBeforeLabelPosition(position);
    await saveSettings({ beforeLabelPosition: position });
  };

  const updateAfterLabelPosition = async (position) => {
    setAfterLabelPosition(position);
    await saveSettings({ afterLabelPosition: position });
  };

  const updateBeforeLabelPositionLandscape = async (position) => {
    setBeforeLabelPositionLandscape(position);
    await saveSettings({ beforeLabelPositionLandscape: position });
  };

  const updateAfterLabelPositionLandscape = async (position) => {
    setAfterLabelPositionLandscape(position);
    await saveSettings({ afterLabelPositionLandscape: position });
  };

  const updateCombinedLabelPosition = async (position) => {
    setCombinedLabelPosition(position);
    await saveSettings({ combinedLabelPosition: position });
  };

  const updateLabelMarginVertical = async (margin) => {
    setLabelMarginVertical(margin);
    await saveSettings({ labelMarginVertical: margin });
  };

  const updateLabelMarginHorizontal = async (margin) => {
    setLabelMarginHorizontal(margin);
    await saveSettings({ labelMarginHorizontal: margin });
  };

  const updateUserInfo = async (name, newLocation) => {
    if (name !== undefined) setUserName(name);
    if (newLocation !== undefined) setLocation(newLocation);
    const updates = {};
    if (name !== undefined) updates.userName = name;
    if (newLocation !== undefined) updates.location = newLocation;
    if (Object.keys(updates).length) await saveSettings(updates);
  };

  // Reload settings from AsyncStorage (useful when external changes are made)
  const reloadSettings = async () => {
    await loadSettings();
  };

  const updateUserPlan = async (plan) => {
    setUserPlan(plan);
    await saveSettings({ userPlan: plan });
  };

  const toggleCleaningServiceEnabled = async () => {
    const newValue = !cleaningServiceEnabled;
    setCleaningServiceEnabled(newValue);
    await saveSettings({ cleaningServiceEnabled: newValue });
  };

  const toggleShutterSoundEnabled = async () => {
    const newValue = !shutterSoundEnabled;
    setShutterSoundEnabled(newValue);
    await saveSettings({ shutterSoundEnabled: newValue });
  };

  const toggleUseFolderStructure = async () => {
    const newValue = !useFolderStructure;
    setUseFolderStructure(newValue);
    await saveSettings({ useFolderStructure: newValue });
  };
  
  const updateEnabledFolders = async (updates) => {
    const newCategories = { ...enabledFolders, ...updates };
    setEnabledFolders(newCategories);
    await saveSettings({ enabledFolders: newCategories });
  };

  const updateLabelLanguage = async (language) => {
    setLabelLanguage(language);
    await saveSettings({ labelLanguage: language });
  };

  const updateSectionLanguage = async (language) => {
    setSectionLanguage(language);
    await saveSettings({ sectionLanguage: language });
  };

  // Custom rooms management (temporarily global for stability)
  const saveCustomRooms = async (rooms) => {
    try {
      // );
      // );
      if (rooms && rooms.length > 0) {
        await AsyncStorage.setItem(CUSTOM_ROOMS_KEY, JSON.stringify(rooms));
        setCustomRooms(rooms);
        // 
      } else {
        await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
        setCustomRooms(null);
        // 
      }
    } catch (error) {

    }
  };

  const getRooms = () => {
    const result = customRooms || ROOMS;
    //  || 'null', 'result:', result.map(r => r.name));
    return result;
  };

  const resetCustomRooms = async () => {
    await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
    setCustomRooms(null);
  };

  const resetUserData = async () => {
    try {
      await AsyncStorage.removeItem(SETTINGS_KEY);
      await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
      // Clear developer tools unlock state when resetting data
      await AsyncStorage.removeItem('@dev_tools_unlocked');
      // Clear photos, projects, trial, and referral data
      await AsyncStorage.removeItem('cleaning-photos-metadata');
      await AsyncStorage.removeItem('tracked-projects');
      await AsyncStorage.removeItem('@user_trial_info');
      await AsyncStorage.removeItem('@user_referral_code');
      await AsyncStorage.removeItem('@referral_accepted');
      await AsyncStorage.removeItem('@referral_rewards_applied');
      await AsyncStorage.removeItem('@trial_notifications_shown');
      // NOTE: intentionally NOT removing @proofpix_language — language preference should persist across resets
      await AsyncStorage.removeItem('active-project-id');
      await AsyncStorage.removeItem('label-cache-metadata');
      await AsyncStorage.removeItem('@team_name');
      await AsyncStorage.removeItem('@stored_individual_name');
      await AsyncStorage.removeItem('@stored_individual_plan');
      await AsyncStorage.removeItem('@stored_individual_mode');
      await AsyncStorage.removeItem('@pending_trial_notification');
      setUserName('');
      setLocation('tampa');
      setShowLabels(true);
      setShowWatermark(true);
      setCustomWatermarkEnabled(false);
      setWatermarkText(DEFAULT_WATERMARK_TEXT);
      setWatermarkLink(DEFAULT_WATERMARK_LINK);
      setWatermarkColor(DEFAULT_LABEL_BACKGROUND);
      setWatermarkOpacity(DEFAULT_WATERMARK_OPACITY);
      setWatermarkPosition(DEFAULT_WATERMARK_POSITION);
      setWatermarkFontFamily('system');
      setLabelBackgroundColor(DEFAULT_LABEL_BACKGROUND);
      setLabelTextColor(DEFAULT_LABEL_TEXT);
      setLabelSize(DEFAULT_LABEL_SIZE);
      setLabelCornerStyle(DEFAULT_LABEL_CORNER_STYLE);
      setLabelFontFamily('system');
      setBeforeLabelPosition(DEFAULT_BEFORE_LABEL_POSITION);
      setAfterLabelPosition(DEFAULT_AFTER_LABEL_POSITION);
      setBeforeLabelPositionLandscape(DEFAULT_BEFORE_LABEL_POSITION);
      setAfterLabelPositionLandscape(DEFAULT_AFTER_LABEL_POSITION);
      setCombinedLabelPosition(DEFAULT_LABEL_POSITION);
      setLabelMarginVertical(10);
      setLabelMarginHorizontal(10);
      setUseFolderStructure(true);
      setEnabledFolders({ before: true, after: true, combined: true });
      setLabelLanguage('en'); // Reset labelLanguage on user data reset
      setCustomRooms(null);
      setUserPlan('starter'); // Reset plan on user data reset
      setCleaningServiceEnabled(true);
      setShutterSoundEnabled(true);
      await saveSettings({ 
        showLabels: true,
        showWatermark: true,
        customWatermarkEnabled: false,
        watermarkText: DEFAULT_WATERMARK_TEXT,
        watermarkLink: DEFAULT_WATERMARK_LINK,
        watermarkColor: DEFAULT_LABEL_BACKGROUND,
        watermarkOpacity: DEFAULT_WATERMARK_OPACITY,
        watermarkPosition: DEFAULT_WATERMARK_POSITION,
        watermarkFontFamily: 'alexandria',
        labelBackgroundColor: DEFAULT_LABEL_BACKGROUND,
        labelTextColor: DEFAULT_LABEL_TEXT,
        labelFontFamily: 'alexandria',
        labelSize: DEFAULT_LABEL_SIZE,
        labelCornerStyle: DEFAULT_LABEL_CORNER_STYLE,
        beforeLabelPosition: DEFAULT_BEFORE_LABEL_POSITION,
        afterLabelPosition: DEFAULT_AFTER_LABEL_POSITION,
        beforeLabelPositionLandscape: DEFAULT_BEFORE_LABEL_POSITION,
        afterLabelPositionLandscape: DEFAULT_AFTER_LABEL_POSITION,
        combinedLabelPosition: DEFAULT_LABEL_POSITION,
        labelMarginVertical: 10,
        labelMarginHorizontal: 10,
        userName: '',
        location: 'tampa',
        useFolderStructure: true,
        enabledFolders: { before: true, after: true, combined: true },
        labelLanguage: 'en',
        userPlan: 'starter',
        cleaningServiceEnabled: true,
        shutterSoundEnabled: true,
      });
    } catch (error) {

    }
  };

  // Watermark is forced on for the whole soft trial: even if the user toggles
  // it off, free exports must carry branding. Once the trial is consumed
  // (limit reached or Apple/Google trial started), this falls back to the
  // user's setting.
  const shouldShowWatermark =
    softTrialActive ||
    (showWatermark && (customWatermarkEnabled ? Boolean(watermarkText?.trim()) : true));

  const value = {
    showLabels,
    toggleLabels,
    showWatermark,
    shouldShowWatermark,
    softTrialActive,
    softTrialRemaining,
    refreshSoftTrial,
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
    watermarkPosition,
    watermarkFontFamily,
    updateWatermarkPosition,
    updateWatermarkFontFamily,
    labelBackgroundColor,
    labelTextColor,
    labelFontFamily,
    labelSize,
    labelCornerStyle,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    combinedLabelPosition,
    labelMarginVertical,
    labelMarginHorizontal,
    updateLabelBackgroundColor,
    updateLabelTextColor,
    updateLabelFontFamily,
    updateLabelSize,
    updateLabelCornerStyle,
    updateBeforeLabelPosition,
    updateAfterLabelPosition,
    updateBeforeLabelPositionLandscape,
    updateAfterLabelPositionLandscape,
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
    labelLanguage,
    updateLabelLanguage,
    sectionLanguage,
    updateSectionLanguage,
    resetUserData,
    loading,
    customRooms,
    saveCustomRooms,
    getRooms,
    resetCustomRooms,
    userPlan, // Expose userPlan
    updateUserPlan, // Expose updateUserPlan
    cleaningServiceEnabled,
    toggleCleaningServiceEnabled,
    shutterSoundEnabled,
    toggleShutterSoundEnabled,
    reloadSettings, // Expose reloadSettings
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

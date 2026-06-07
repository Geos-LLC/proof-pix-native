import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ROOMS, DEFAULT_LABEL_POSITION, DEFAULT_BEFORE_LABEL_POSITION, DEFAULT_AFTER_LABEL_POSITION, DEFAULT_WATERMARK_POSITION } from '../constants/rooms';
import { INDUSTRIES } from '../constants/industries';
import { isSoftTrialActive, getRemainingExports } from '../services/softTrialService';
import { SOFT_TRIAL_EXPORT_LIMIT } from '../constants/softTrial';
import { readSecureJSON, writeSecureJSON, deleteSecure } from '../services/secureStorageService';

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

// Font keys accepted by PhotoLabel / PhotoWatermark's FONT_FAMILY_MAP.
// Anything else is collapsed to 'alexandria' so a stale legacy value
// doesn't crash the renderer.
const FONT_KEYS = new Set([
  'alexandria', 'system',
  'shadow', 'shanatel', 'sf', 'share',
  'montserratBold', 'playfairBold', 'robotoMonoBold',
  'latoBold', 'poppinsSemiBold', 'oswaldSemiBold',
  'serif', 'monospace', 'seriflegacy', 'monospacelegacy',
]);
const normalizeFontKey = (value) => {
  if (!value) return 'alexandria';
  const raw = String(value);
  if (FONT_KEYS.has(raw)) return raw;
  const lc = raw.toLowerCase();
  if (FONT_KEYS.has(lc)) return lc;
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
  // Per-user toggle for showing the "date · location" caption under photos in
  // the full-screen preview. Separate from `watermarkShowMetadata` (which
  // controls the SHARED watermark output, not the on-screen caption).
  const [showPreviewMetadata, setShowPreviewMetadata] = useState(false);
  // Per-field toggles for what the metadata badge in Studio shows. The
  // user can turn date / time / address / gps on individually. All four
  // default on so existing exports keep their current metadata footprint.
  const [metaShowDate, setMetaShowDate] = useState(true);
  const [metaShowTime, setMetaShowTime] = useState(true);
  const [metaShowAddress, setMetaShowAddress] = useState(true);
  const [metaShowGps, setMetaShowGps] = useState(false);
  // Brand logo overlay — separate from the watermark text. URI is the
  // file:// path to the user-uploaded image; null means no custom logo
  // has been uploaded yet, so the toggle does nothing.
  const [brandLogoUri, setBrandLogoUri] = useState(null);
  const [showBrandLogo, setShowBrandLogo] = useState(false);
  const [brandLogoPosition, setBrandLogoPosition] = useState('right-bottom');
  // Accepts the legacy small|medium|large strings OR a numeric pixel side
  // from the new slider (60 by default).
  const [brandLogoSize, setBrandLogoSize] = useState(60);
  const [brandLogoOffset, setBrandLogoOffset] = useState(null);
  // Report branding — used in report title sheet and header color.
  // Distinct from brandLogoUri which is for photo overlays in the editor.
  // Falls back to brandLogoUri when not set so reports get a logo even
  // before the user configures dedicated report branding.
  const [reportBrandLogoUri, setReportBrandLogoUri] = useState(null);
  const [reportCompanyName, setReportCompanyName] = useState('');
  const [reportBrandColor, setReportBrandColor] = useState('#1A1A1A');
  // Metadata overlay styling — independent from the watermark's. Driven
  // by the dedicated Metadata Customization screen.
  const [metaPosition, setMetaPosition] = useState('left-bottom');
  const [metaColor, setMetaColor] = useState('#FFFFFF');
  const [metaOpacity, setMetaOpacity] = useState(0.85);
  // Accepts the legacy small|medium|large strings OR a numeric font size.
  const [metaFontSize, setMetaFontSize] = useState(14);
  const [metaFontFamily, setMetaFontFamily] = useState('alexandria');
  const [metaOffset, setMetaOffset] = useState(null);
  // Watermark freeform offset + numeric font size. The legacy `watermarkPosition`
  // grid key stays around as a fallback when no freeform drop has been saved.
  const [watermarkOffset, setWatermarkOffset] = useState(null);
  const [watermarkFontSize, setWatermarkFontSize] = useState(14);
  const [showWatermark, setShowWatermark] = useState(true);
  const [customWatermarkEnabled, setCustomWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState(DEFAULT_WATERMARK_TEXT);
  const [watermarkLink, setWatermarkLink] = useState(DEFAULT_WATERMARK_LINK);
  const [watermarkColor, setWatermarkColor] = useState(DEFAULT_LABEL_BACKGROUND);
  const [watermarkOpacity, setWatermarkOpacity] = useState(DEFAULT_WATERMARK_OPACITY);
  const [watermarkPosition, setWatermarkPosition] = useState(DEFAULT_WATERMARK_POSITION);
  const [watermarkFontFamily, setWatermarkFontFamily] = useState('alexandria');
  const [watermarkShowMetadata, setWatermarkShowMetadata] = useState(false);
  const [labelBackgroundColor, setLabelBackgroundColor] = useState(DEFAULT_LABEL_BACKGROUND);
  const [labelTextColor, setLabelTextColor] = useState(DEFAULT_LABEL_TEXT);
  const [labelSize, setLabelSize] = useState(DEFAULT_LABEL_SIZE);
  const [labelCornerStyle, setLabelCornerStyle] = useState(DEFAULT_LABEL_CORNER_STYLE);
  const [labelFontFamily, setLabelFontFamily] = useState('alexandria');
  const [beforeLabelPosition, setBeforeLabelPosition] = useState(DEFAULT_BEFORE_LABEL_POSITION);
  const [afterLabelPosition, setAfterLabelPosition] = useState(DEFAULT_AFTER_LABEL_POSITION);
  // Landscape-orientation overrides: when a photo is wider than tall, these
  // positions are used instead of the portrait ones. Landscape photos
  // combine *stacked* (top/bottom halves) rather than side-by-side, so the
  // convention is BEFORE in the upper-left of the top half and AFTER in
  // the upper-left of the bottom half — i.e. both `left-top`. The bake-time
  // after-half offset shifts the AFTER label down by half-height so it
  // lands just below the divider line on the left edge, instead of clashing
  // with the BEFORE label at the top.
  const DEFAULT_LANDSCAPE_BEFORE_LABEL_POSITION = 'left-top';
  const DEFAULT_LANDSCAPE_AFTER_LABEL_POSITION = 'left-top';
  const [beforeLabelPositionLandscape, setBeforeLabelPositionLandscape] = useState(DEFAULT_LANDSCAPE_BEFORE_LABEL_POSITION);
  const [afterLabelPositionLandscape, setAfterLabelPositionLandscape] = useState(DEFAULT_LANDSCAPE_AFTER_LABEL_POSITION);
  const [combinedLabelPosition, setCombinedLabelPosition] = useState(DEFAULT_LABEL_POSITION);
  // Freeform fractional offsets ({x: 0..1, y: 0..1}) — when set, override
  // the corresponding position key so labels can be dropped anywhere
  // instead of snapping to one of 9 grid cells. null = use position key.
  const [beforeLabelOffset, setBeforeLabelOffset] = useState(null);
  const [afterLabelOffset, setAfterLabelOffset] = useState(null);
  const [beforeLabelOffsetLandscape, setBeforeLabelOffsetLandscape] = useState(null);
  const [afterLabelOffsetLandscape, setAfterLabelOffsetLandscape] = useState(null);
  const [combinedLabelOffset, setCombinedLabelOffset] = useState(null);
  const [labelMarginVertical, setLabelMarginVertical] = useState(10); // Top/bottom margin
  const [labelMarginHorizontal, setLabelMarginHorizontal] = useState(10); // Left/right margin
  const [userName, setUserName] = useState('');
  const [location, setLocation] = useState('Location 1'); // Default for fresh installs; project creation auto-fills "Location N" matching project count
  const [useFolderStructure, setUseFolderStructure] = useState(false); // Default OFF - flat structure
  const [enabledFolders, setEnabledFolders] = useState({ before: true, after: true, combined: true });
  // New simplified upload-structure toggle: when true, uploaded
  // photos are grouped into per-date subfolders. Replaces the old
  // before/after/combined sub-toggle UI from Settings — those still
  // exist in storage for backward compat but the user-facing
  // control now is just this one switch.
  const [splitPhotosByDate, setSplitPhotosByDate] = useState(false);
  const [labelLanguage, setLabelLanguage] = useState('en');
  const [sectionLanguage, setSectionLanguage] = useState('en');
  const [customRooms, setCustomRooms] = useState(null); // null means use default rooms
  const [userPlan, setUserPlan] = useState('starter'); // Add userPlan state
  const [cleaningServiceEnabled, setCleaningServiceEnabled] = useState(true);
  const [shutterSoundEnabled, setShutterSoundEnabled] = useState(Platform.OS !== 'android');
  // Persistent "use current location for new projects" toggle. When
  // true, the New Project modal auto-fills the name with the current
  // address as soon as it opens. The checkbox in the modal flips
  // this value; tapping the one-shot Use-current-location BUTTON in
  // the modal does NOT flip it (one-time fill only).
  const [autoUseCurrentLocationForProjects, setAutoUseCurrentLocationForProjects] = useState(false);
  const [themeMode, setThemeModeState] = useState('light');
  const [loading, setLoading] = useState(true);
  // Ref-backed mirror of the loaded flag so saveSettings called from stale
  // closures (e.g. a useEffect scheduled before loadSettings finished) still
  // sees the up-to-date value. Without this, the React state `loading` is
  // captured per-render — stale closures would treat the empty initial
  // state as truth and overwrite the user's real userName / location in
  // AsyncStorage with '' on the first save after launch.
  const loadedRef = useRef(false);

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
      // Keychain-backed on iOS so settings (labels/watermarks/language/plan)
      // survive app reinstall.
      const settings = await readSecureJSON(SETTINGS_KEY);

      if (settings) {
        setShowLabels(settings.showLabels ?? true);
        setShowPreviewMetadata(settings.showPreviewMetadata ?? false);
        setMetaShowDate(settings.metaShowDate ?? true);
        setMetaShowTime(settings.metaShowTime ?? true);
        setMetaShowAddress(settings.metaShowAddress ?? true);
        setMetaShowGps(settings.metaShowGps ?? false);
        setBrandLogoUri(settings.brandLogoUri ?? null);
        setShowBrandLogo(settings.showBrandLogo ?? false);
        setBrandLogoPosition(settings.brandLogoPosition ?? 'right-bottom');
        setBrandLogoSize(settings.brandLogoSize ?? 60);
        setMetaPosition(settings.metaPosition ?? 'left-bottom');
        setMetaColor(settings.metaColor ?? '#FFFFFF');
        setMetaOpacity(typeof settings.metaOpacity === 'number' ? settings.metaOpacity : 0.85);
        setMetaFontSize(settings.metaFontSize ?? 14);
        setMetaFontFamily(settings.metaFontFamily ?? 'alexandria');
        setWatermarkFontSize(typeof settings.watermarkFontSize === 'number' ? settings.watermarkFontSize : 14);
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
        setWatermarkShowMetadata(settings.watermarkShowMetadata ?? false);
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
        const sanitizeOffset = (o) =>
          o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number'
            ? { x: Math.max(0, Math.min(1, o.x)), y: Math.max(0, Math.min(1, o.y)) }
            : null;
        setBeforeLabelOffset(sanitizeOffset(settings.beforeLabelOffset));
        setAfterLabelOffset(sanitizeOffset(settings.afterLabelOffset));
        setBeforeLabelOffsetLandscape(sanitizeOffset(settings.beforeLabelOffsetLandscape));
        setAfterLabelOffsetLandscape(sanitizeOffset(settings.afterLabelOffsetLandscape));
        setCombinedLabelOffset(sanitizeOffset(settings.combinedLabelOffset));
        setBrandLogoOffset(sanitizeOffset(settings.brandLogoOffset));
        setReportBrandLogoUri(settings.reportBrandLogoUri ?? null);
        setReportCompanyName(settings.reportCompanyName ?? '');
        setReportBrandColor(settings.reportBrandColor ?? '#1A1A1A');
        setMetaOffset(sanitizeOffset(settings.metaOffset));
        setWatermarkOffset(sanitizeOffset(settings.watermarkOffset));
        setLabelMarginVertical(settings.labelMarginVertical ?? 10);
        setLabelMarginHorizontal(settings.labelMarginHorizontal ?? 10);
        setUserName(settings.userName ?? '');
        // If the main settings blob lost userName for any reason, fall
        // back to the dedicated backup key so the user isn't sent back
        // through onboarding. updateUserInfo writes both, so the
        // backup is always the latest known value.
        if (!settings.userName || !String(settings.userName).trim()) {
          try {
            const backupName = await AsyncStorage.getItem('@proofpix_username');
            if (backupName && backupName.trim()) {
              setUserName(backupName.trim());
            }
          } catch {}
        }
        setLocation(settings.location ?? 'Location 1');
        setUseFolderStructure(settings.useFolderStructure ?? false); // Default OFF - flat structure
        setSplitPhotosByDate(settings.splitPhotosByDate ?? false);
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
        setAutoUseCurrentLocationForProjects(
          typeof settings.autoUseCurrentLocationForProjects === 'boolean'
            ? settings.autoUseCurrentLocationForProjects
            : false
        );
        setThemeModeState(settings.themeMode === 'dark' ? 'dark' : 'light');
      }
      
      // Even when the main settings blob is entirely missing (first
      // launch after a partial wipe / Keychain reset), recover the
      // user's name from the dedicated backup key. Without this the
      // user would land back on the FirstLoad screen every launch.
      if (!settings) {
        try {
          const backupName = await AsyncStorage.getItem('@proofpix_username');
          if (backupName && backupName.trim()) {
            setUserName(backupName.trim());
          }
        } catch {}
      }

      // Hydrate custom folder names from AsyncStorage. This used to be an
      // "EMERGENCY: Clear all corrupted custom rooms data" block that
      // unconditionally deleted CUSTOM_ROOMS_KEY on every app start — which
      // is why folder names disappeared on close+reopen. Now we read the
      // stored array (if present and well-formed) and rehydrate it.
      try {
        const storedRooms = await AsyncStorage.getItem(CUSTOM_ROOMS_KEY);
        if (storedRooms) {
          const parsed = JSON.parse(storedRooms);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCustomRooms(parsed);
          } else {
            setCustomRooms(null);
          }
        } else {
          setCustomRooms(null);
        }
      } catch (e) {
        console.warn('[SettingsContext] custom rooms hydrate failed — leaving null:', e?.message);
        setCustomRooms(null);
      }

    } catch (error) {

    } finally {
      loadedRef.current = true;
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
      const existingSettings = (await readSecureJSON(SETTINGS_KEY)) || {};

      const stateSnapshot = {
        showLabels,
        showPreviewMetadata,
        showWatermark,
        customWatermarkEnabled,
        watermarkText,
        watermarkLink,
        watermarkColor,
        watermarkOpacity,
        watermarkPosition,
        watermarkFontFamily,
        watermarkShowMetadata,
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
        beforeLabelOffset,
        afterLabelOffset,
        beforeLabelOffsetLandscape,
        afterLabelOffsetLandscape,
        combinedLabelOffset,
        brandLogoOffset,
        brandLogoSize,
        metaOffset,
        metaFontFamily,
        metaFontSize,
        watermarkOffset,
        watermarkFontSize,
        labelMarginVertical,
        labelMarginHorizontal,
        userName,
        location,
        useFolderStructure,
        enabledFolders,
        splitPhotosByDate,
        labelLanguage,
        sectionLanguage,
        userPlan,
        cleaningServiceEnabled,
        shutterSoundEnabled,
        themeMode,
        autoUseCurrentLocationForProjects,
      };

      // Use the synchronous loadedRef instead of the React state `loading`.
      // A stale closure could still hold `loading=true` AFTER loadSettings
      // actually finished, which is fine. The dangerous direction is the
      // opposite — `loading=false` in a closure that captured empty initial
      // state. loadedRef.current is set inside loadSettings's finally, so
      // any save after that point is guaranteed to see the latest value.
      const settings = !loadedRef.current
        ? { ...existingSettings, ...newSettings }
        : { ...existingSettings, ...stateSnapshot, ...newSettings };

      await writeSecureJSON(SETTINGS_KEY, settings);
    } catch (error) {

    }
  };

  const toggleLabels = async () => {
    const newValue = !showLabels;
    setShowLabels(newValue);
    await saveSettings({ showLabels: newValue });
  };

  const setThemeMode = async (mode) => {
    const next = mode === 'dark' ? 'dark' : 'light';
    setThemeModeState(next);
    await saveSettings({ themeMode: next });
  };

  const togglePreviewMetadata = async (value) => {
    const next = typeof value === 'boolean' ? value : !showPreviewMetadata;
    setShowPreviewMetadata(next);
    await saveSettings({ showPreviewMetadata: next });
  };

  // Per-field metadata toggles + brand-logo updaters. All of these are
  // simple boolean / string round-trips through saveSettings — kept
  // grouped so the BrandingPanel can pull them via useSettings().
  const setMetaField = async (key, value) => {
    if (key === 'date') { setMetaShowDate(value); await saveSettings({ metaShowDate: value }); }
    else if (key === 'time') { setMetaShowTime(value); await saveSettings({ metaShowTime: value }); }
    else if (key === 'address') { setMetaShowAddress(value); await saveSettings({ metaShowAddress: value }); }
    else if (key === 'gps') { setMetaShowGps(value); await saveSettings({ metaShowGps: value }); }
  };
  const updateBrandLogoUri = async (uri) => {
    const next = typeof uri === 'string' && uri ? uri : null;
    setBrandLogoUri(next);
    await saveSettings({ brandLogoUri: next });
    // Auto-enable the toggle the first time a logo is uploaded so the
    // user immediately sees the result, without having to flip the
    // switch separately.
    if (next && !showBrandLogo) {
      setShowBrandLogo(true);
      await saveSettings({ showBrandLogo: true });
    }
  };
  const updateShowBrandLogo = async (value) => {
    const next = !!value;
    setShowBrandLogo(next);
    await saveSettings({ showBrandLogo: next });
  };
  const updateBrandLogoPosition = async (pos) => {
    setBrandLogoPosition(pos);
    await saveSettings({ brandLogoPosition: pos });
  };
  const updateBrandLogoSize = async (size) => {
    // Accept numeric pixel sizes from the slider AND legacy strings.
    let normalized;
    if (typeof size === 'number' && isFinite(size)) {
      normalized = Math.max(20, Math.min(200, Math.round(size)));
    } else if (typeof size === 'string' && ['small', 'medium', 'large'].includes(size)) {
      normalized = size;
    } else {
      normalized = 60;
    }
    setBrandLogoSize(normalized);
    await saveSettings({ brandLogoSize: normalized });
  };
  const updateBrandLogoOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setBrandLogoOffset(next);
    await saveSettings({ brandLogoOffset: next });
  };
  const updateReportBrandLogoUri = async (uri) => {
    const next = typeof uri === 'string' && uri ? uri : null;
    setReportBrandLogoUri(next);
    await saveSettings({ reportBrandLogoUri: next });
  };
  const updateReportCompanyName = async (name) => {
    const next = typeof name === 'string' ? name : '';
    setReportCompanyName(next);
    await saveSettings({ reportCompanyName: next });
  };
  const updateReportBrandColor = async (color) => {
    const next = normalizeColorHex(color, '#1A1A1A');
    setReportBrandColor(next);
    await saveSettings({ reportBrandColor: next });
  };
  const updateMetaPosition = async (pos) => {
    setMetaPosition(pos);
    await saveSettings({ metaPosition: pos });
  };
  const updateMetaColor = async (color) => {
    setMetaColor(color);
    await saveSettings({ metaColor: color });
  };
  const updateMetaOpacity = async (value) => {
    const clamped = Math.max(0, Math.min(1, typeof value === 'number' ? value : 0.85));
    setMetaOpacity(clamped);
    await saveSettings({ metaOpacity: clamped });
  };
  const updateMetaFontSize = async (size) => {
    let normalized;
    if (typeof size === 'number' && isFinite(size)) {
      normalized = Math.max(8, Math.min(48, Math.round(size)));
    } else if (typeof size === 'string' && ['small', 'medium', 'large'].includes(size)) {
      normalized = size;
    } else {
      normalized = 14;
    }
    setMetaFontSize(normalized);
    await saveSettings({ metaFontSize: normalized });
  };
  const updateMetaFontFamily = async (font) => {
    const normalized = normalizeFontKey(font);
    setMetaFontFamily(normalized);
    await saveSettings({ metaFontFamily: normalized });
  };
  const updateMetaOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setMetaOffset(next);
    await saveSettings({ metaOffset: next });
  };
  const updateWatermarkFontSize = async (size) => {
    let normalized;
    if (typeof size === 'number' && isFinite(size)) {
      normalized = Math.max(8, Math.min(48, Math.round(size)));
    } else {
      normalized = 14;
    }
    setWatermarkFontSize(normalized);
    await saveSettings({ watermarkFontSize: normalized });
  };
  const updateWatermarkOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setWatermarkOffset(next);
    await saveSettings({ watermarkOffset: next });
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

  const updateWatermarkShowMetadata = async (value) => {
    const next = Boolean(value);
    setWatermarkShowMetadata(next);
    await saveSettings({ watermarkShowMetadata: next });
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
    // Accept either the legacy small/medium/large pills OR a numeric font
    // size from the slider. Anything else falls back to the default.
    let normalized;
    if (typeof size === 'number' && isFinite(size)) {
      normalized = Math.max(8, Math.min(64, Math.round(size)));
    } else if (typeof size === 'string' && ['small', 'medium', 'large'].includes(size)) {
      normalized = size;
    } else {
      normalized = DEFAULT_LABEL_SIZE;
    }
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

  // Freeform offset updaters. Pass null to clear and fall back to the
  // position key; pass {x, y} (each 0..1) to pin the label to that point.
  const sanitizeOffsetIn = (o) =>
    o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number'
      ? { x: Math.max(0, Math.min(1, o.x)), y: Math.max(0, Math.min(1, o.y)) }
      : null;
  const updateBeforeLabelOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setBeforeLabelOffset(next);
    await saveSettings({ beforeLabelOffset: next });
  };
  const updateAfterLabelOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setAfterLabelOffset(next);
    await saveSettings({ afterLabelOffset: next });
  };
  const updateBeforeLabelOffsetLandscape = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setBeforeLabelOffsetLandscape(next);
    await saveSettings({ beforeLabelOffsetLandscape: next });
  };
  const updateAfterLabelOffsetLandscape = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setAfterLabelOffsetLandscape(next);
    await saveSettings({ afterLabelOffsetLandscape: next });
  };
  const updateCombinedLabelOffset = async (offset) => {
    const next = sanitizeOffsetIn(offset);
    setCombinedLabelOffset(next);
    await saveSettings({ combinedLabelOffset: next });
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
    // Backup name to a dedicated AsyncStorage key. The main settings
    // blob lives in Keychain on iOS and has grown large; if anything
    // ever truncates / corrupts it, the user would land back on the
    // name-entry screen every launch. This redundant write lets
    // loadSettings recover the name even when the primary blob loses
    // the field.
    try {
      if (name !== undefined) {
        const trimmed = (name || '').trim();
        if (trimmed) {
          await AsyncStorage.setItem('@proofpix_username', trimmed);
        } else {
          await AsyncStorage.removeItem('@proofpix_username');
        }
      }
    } catch {}
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

  const updateAutoUseCurrentLocationForProjects = async (value) => {
    const next = !!value;
    setAutoUseCurrentLocationForProjects(next);
    await saveSettings({ autoUseCurrentLocationForProjects: next });
  };

  const toggleUseFolderStructure = async () => {
    const newValue = !useFolderStructure;
    setUseFolderStructure(newValue);
    await saveSettings({ useFolderStructure: newValue });
  };

  const updateSplitPhotosByDate = async (value) => {
    const next = !!value;
    setSplitPhotosByDate(next);
    await saveSettings({ splitPhotosByDate: next });
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
    if (customRooms) return customRooms;
    // Default when no industry has been picked yet: the generic Section 1–5
    // set from the 'Other' industry, so the home screen visible behind the
    // qualification modal looks industry-neutral rather than cleaning-themed.
    const other = INDUSTRIES.find((i) => i.id === 'other');
    return other?.folders || ROOMS;
  };

  const resetCustomRooms = async () => {
    await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
    setCustomRooms(null);
  };

  const resetUserData = async () => {
    try {
      // Wipe from BOTH AsyncStorage and Keychain — the latter is required
      // because settings/projects/photos/trial now persist in Keychain on iOS
      // so a "reset" left only on AsyncStorage would resurrect on next launch.
      await deleteSecure(SETTINGS_KEY);
      await AsyncStorage.removeItem(CUSTOM_ROOMS_KEY);
      // Clear developer tools unlock state when resetting data
      await AsyncStorage.removeItem('@dev_tools_unlocked');
      // Clear photos, projects, trial, and referral data
      await deleteSecure('cleaning-photos-metadata');
      await deleteSecure('tracked-projects');
      await deleteSecure('@user_trial_info');
      await AsyncStorage.removeItem('@user_referral_code');
      await AsyncStorage.removeItem('@referral_accepted');
      await AsyncStorage.removeItem('@referral_rewards_applied');
      await AsyncStorage.removeItem('@trial_notifications_shown');
      // Clear the qualification flag so the industry picker modal
      // re-prompts on the next Home render. Without this the user
      // would land back on the default rooms with no way to re-seed
      // them from an industry preset short of a fresh install.
      await AsyncStorage.removeItem('@user_qualification');
      // Drop the username backup too — keeping it would re-hydrate
      // the user name on next launch and skip FirstLoad, defeating
      // the whole reset.
      await AsyncStorage.removeItem('@proofpix_username');
      // NOTE: intentionally NOT removing @proofpix_language — language preference should persist across resets
      await deleteSecure('active-project-id');
      await deleteSecure('asset-id-map');
      await deleteSecure('user-preferences');
      await AsyncStorage.removeItem('label-cache-metadata');
      await AsyncStorage.removeItem('@team_name');
      await AsyncStorage.removeItem('@stored_individual_name');
      await AsyncStorage.removeItem('@stored_individual_plan');
      await AsyncStorage.removeItem('@stored_individual_mode');
      await AsyncStorage.removeItem('@pending_trial_notification');
      setUserName('');
      setLocation('Location 1');
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
        watermarkShowMetadata: false,
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
        location: 'Location 1',
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
    showPreviewMetadata,
    togglePreviewMetadata,
    metaShowDate,
    metaShowTime,
    metaShowAddress,
    metaShowGps,
    setMetaField,
    brandLogoUri,
    showBrandLogo,
    updateBrandLogoUri,
    updateShowBrandLogo,
    brandLogoPosition,
    brandLogoSize,
    brandLogoOffset,
    updateBrandLogoPosition,
    updateBrandLogoSize,
    updateBrandLogoOffset,
    reportBrandLogoUri,
    reportCompanyName,
    reportBrandColor,
    updateReportBrandLogoUri,
    updateReportCompanyName,
    updateReportBrandColor,
    metaPosition,
    metaColor,
    metaOpacity,
    metaFontSize,
    metaFontFamily,
    metaOffset,
    updateMetaPosition,
    updateMetaColor,
    updateMetaOpacity,
    updateMetaFontSize,
    updateMetaFontFamily,
    updateMetaOffset,
    watermarkOffset,
    watermarkFontSize,
    updateWatermarkOffset,
    updateWatermarkFontSize,
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
    watermarkShowMetadata,
    updateWatermarkShowMetadata,
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
    beforeLabelOffset,
    afterLabelOffset,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    combinedLabelOffset,
    updateBeforeLabelOffset,
    updateAfterLabelOffset,
    updateBeforeLabelOffsetLandscape,
    updateAfterLabelOffsetLandscape,
    updateCombinedLabelOffset,
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
    autoUseCurrentLocationForProjects,
    updateAutoUseCurrentLocationForProjects,
    themeMode,
    setThemeMode,
    reloadSettings, // Expose reloadSettings
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

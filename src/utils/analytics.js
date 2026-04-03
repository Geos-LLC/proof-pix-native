// Firebase imports - wrapped to handle missing native modules
let getApp, getApps, getAnalytics, firebaseLogEvent, firebaseSetUserId, setUserProperty, setAnalyticsCollectionEnabled;
try {
  const appModule = require('@react-native-firebase/app');
  const analyticsModule = require('@react-native-firebase/analytics');
  getApp = appModule.getApp;
  getApps = appModule.getApps;
  getAnalytics = analyticsModule.getAnalytics;
  firebaseLogEvent = analyticsModule.logEvent;
  firebaseSetUserId = analyticsModule.setUserId;
  setUserProperty = analyticsModule.setUserProperty;
  setAnalyticsCollectionEnabled = analyticsModule.setAnalyticsCollectionEnabled;
} catch (error) {
  console.warn('[Analytics] Firebase native modules not available:', error.message);
  console.warn('[Analytics] Analytics functions will be no-ops. Rebuild app to enable Firebase.');
}

// Meta (Facebook) SDK imports
import {
  metaLogPhotoCapture, metaLogPhotoSave, metaLogPhotoExport, metaLogSignIn,
  metaLogAccountCreated, metaLogTrialEvent, metaLogPlanChanged, metaLogPurchase,
  metaLogTeamInvitesCreated, metaLogTeamMemberJoined, metaLogReferralEvent,
  metaLogCloudAccountConnection, metaLogPhotoUpload, metaLogFeatureGateShown,
  metaLogInitiateCheckout, metaLogAddPaymentInfo,
} from './metaAnalytics';

/**
 * Analytics utility for Firebase Analytics
 * Provides helper functions to track user events and screen views
 */

// Get analytics instance
let analyticsInstance = null;
const getAnalyticsInstance = () => {
  if (!getAnalytics) {
    return null;
  }
  if (!analyticsInstance) {
    try {
      analyticsInstance = getAnalytics();
    } catch (error) {
      return null;
    }
  }
  return analyticsInstance;
};

/**
 * Check if Firebase is initialized
 */
const isFirebaseReady = () => {
  if (!getApps) {
    return false;
  }
  try {
    return getApps().length > 0;
  } catch (error) {
    return false;
  }
};

/**
 * Log a custom event to Firebase Analytics
 * @param {string} eventName - Name of the event
 * @param {object} params - Parameters associated with the event
 */
export const logEvent = async (eventName, params = {}) => {
  if (!isFirebaseReady()) {
    return;
  }

  try {
    const analytics = getAnalyticsInstance();
    if (analytics && firebaseLogEvent) {
      // Use modular API: logEvent(analytics, eventName, params)
      await firebaseLogEvent(analytics, eventName, params);
    }
  } catch (error) {
    // Silently fail - analytics errors shouldn't break the app
  }
};

/**
 * Log screen view to Firebase Analytics
 * Uses logEvent with screen_view event name (migrated from deprecated logScreenView)
 * @param {string} screenName - Name of the screen
 * @param {string} screenClass - Class of the screen (optional)
 */
export const logScreenView = async (screenName, screenClass = screenName) => {
  if (!isFirebaseReady()) {
    return;
  }

  try {
    const analytics = getAnalyticsInstance();
    if (analytics) {
      await firebaseLogEvent(analytics, 'screen_view', {
        screen_name: screenName,
        screen_class: screenClass,
      });
    }
  } catch (error) {
  }
};

/**
 * Set user properties
 * @param {object} properties - User properties to set
 */
export const setUserProperties = async (properties) => {
  try {
    const analytics = getAnalyticsInstance();
    if (analytics) {
      for (const [key, value] of Object.entries(properties)) {
        await setUserProperty(analytics, key, value);
      }
    }
  } catch (error) {
  }
};

/**
 * Set user ID for analytics
 * @param {string} userId - User ID to set
 */
export const setUserId = async (userId) => {
  try {
    const analytics = getAnalyticsInstance();
    if (analytics) {
      await firebaseSetUserId(analytics, userId);
    }
  } catch (error) {
  }
};

/**
 * Enable/disable analytics collection
 * @param {boolean} enabled - Whether to enable analytics
 */
export const setAnalyticsEnabled = async (enabled) => {
  try {
    const analytics = getAnalyticsInstance();
    if (analytics) {
      await setAnalyticsCollectionEnabled(analytics, enabled);
    }
  } catch (error) {
  }
};

// ProofPix specific analytics events

/**
 * Log when a photo is captured
 * @param {string} photoType - 'before' or 'after'
 */
export const logPhotoCapture = (photoType) => {
  logEvent('photo_capture', {
    photo_type: photoType,
    timestamp: Date.now(),
  });
  metaLogPhotoCapture(photoType);
};

/**
 * Log when a photo pair is saved
 * @param {boolean} hasLabels - Whether labels were added
 * @param {string} labelPosition - Position of labels if applicable
 */
export const logPhotoSave = (hasLabels = false, labelPosition = null) => {
  logEvent('photo_save', {
    has_labels: hasLabels,
    label_position: labelPosition,
    timestamp: Date.now(),
  });
  metaLogPhotoSave(hasLabels);
};

/**
 * Log when a photo is exported
 * @param {string} exportType - Type of export (share, save, etc.)
 */
export const logPhotoExport = (exportType) => {
  logEvent('photo_export', {
    export_type: exportType,
    timestamp: Date.now(),
  });
  metaLogPhotoExport(exportType);
};

/**
 * Log when settings are changed
 * @param {string} settingName - Name of the setting changed
 * @param {any} settingValue - New value of the setting
 */
export const logSettingsChange = (settingName, settingValue) => {
  logEvent('settings_change', {
    setting_name: settingName,
    setting_value: String(settingValue),
    timestamp: Date.now(),
  });
};

/**
 * Log when user signs in
 * @param {string} method - Sign in method (google, etc.)
 */
export const logSignIn = (method) => {
  logEvent('login', {
    method: method,
    timestamp: Date.now(),
  });
  metaLogSignIn(method);
};

/**
 * Log when user signs out
 */
export const logSignOut = () => {
  logEvent('logout', {
    timestamp: Date.now(),
  });
};

/**
 * Log when team is created or joined
 * @param {string} action - 'create' or 'join'
 */
export const logTeamAction = (action) => {
  logEvent('team_action', {
    action: action,
    timestamp: Date.now(),
  });
};

/**
 * Log when label customization is used
 * @param {object} customization - Customization details (font, color, position, etc.)
 */
export const logLabelCustomization = (customization) => {
  logEvent('label_customization', {
    ...customization,
    timestamp: Date.now(),
  });
};

/**
 * Log when language is changed
 * @param {string} language - New language code
 */
export const logLanguageChange = (language) => {
  logEvent('language_change', {
    language: language,
    timestamp: Date.now(),
  });
};

/**
 * ===== Business / product analytics helpers =====
 * These are thin wrappers around logEvent so you can easily
 * answer high‑level questions in Firebase / BigQuery.
 */

// Accounts & plans ---------------------------------------------------------

/**
 * Log when a user account is created.
 * @param {object} payload
 *  - method: 'email', 'google', etc.
 *  - is_team: boolean
 *  - plan: 'starter' | 'pro' | 'business' | 'enterprise' | 'team_member'
 *  - is_trial: boolean
 */
export const logAccountCreated = (payload = {}) => {
  logEvent('account_created', {
    method: payload.method || 'unknown',
    is_team: !!payload.is_team,
    plan: payload.plan || 'unknown',
    is_trial: !!payload.is_trial,
    timestamp: Date.now(),
  });
  metaLogAccountCreated(payload);
};

/**
 * Log when a user changes plan / tier.
 * @param {string} fromPlan
 * @param {string} toPlan
 * @param {string} sourceScreen - where the change was initiated (e.g. 'Settings')
 */
export const logPlanChanged = (fromPlan, toPlan, sourceScreen = 'unknown') => {
  logEvent('plan_changed', {
    from_plan: fromPlan || 'unknown',
    to_plan: toPlan || 'unknown',
    source: sourceScreen,
    timestamp: Date.now(),
  });
  metaLogPlanChanged(fromPlan, toPlan);
};

// Trials -------------------------------------------------------------------

/**
 * Log trial lifecycle events.
 * @param {string} action - 'start' | 'check' | 'end'
 * @param {object} payload
 *  - plan
 *  - days_used
 *  - days_remaining
 */
export const logTrialEvent = (action, payload = {}) => {
  logEvent('trial_event', {
    action,
    plan: payload.plan || 'unknown',
    days_used: payload.days_used ?? null,
    days_remaining: payload.days_remaining ?? null,
    timestamp: Date.now(),
  });
  metaLogTrialEvent(action, payload);
};

// Teams & invites ---------------------------------------------------------

/**
 * Log when team invites are created.
 * @param {number} count - how many invites created in this action
 * @param {object} payload
 *  - plan
 *  - team_size_before
 *  - team_size_after
 */
export const logTeamInvitesCreated = (count, payload = {}) => {
  logEvent('team_invites_created', {
    count: count || 0,
    plan: payload.plan || 'unknown',
    team_size_before: payload.team_size_before ?? null,
    team_size_after: payload.team_size_after ?? null,
    timestamp: Date.now(),
  });
  metaLogTeamInvitesCreated(count);
};

/**
 * Log when a team member actually joins (uses an invite).
 * @param {object} payload
 *  - plan
 *  - team_size_after
 */
export const logTeamMemberJoined = (payload = {}) => {
  logEvent('team_member_joined', {
    plan: payload.plan || 'unknown',
    team_size_after: payload.team_size_after ?? null,
    timestamp: Date.now(),
  });
  metaLogTeamMemberJoined(payload);
};

// Referrals ----------------------------------------------------------------

/**
 * Log referral events with full tracking data.
 * @param {string} action - lifecycle stage of the referral
 * @param {object} payload - all fields are passed through to Firebase
 */
export const logReferralEvent = (action, payload = {}) => {
  logEvent('referral_event', {
    action,
    code: payload.code || null,
    method: payload.method || null,
    from_plan: payload.from_plan || null,
    to_plan: payload.to_plan || null,
    rewards: payload.rewards ?? null,
    days_added: payload.days_added ?? null,
    timestamp: Date.now(),
  });
  metaLogReferralEvent(action, payload);
};

// Connected accounts -------------------------------------------------------

/**
 * Log when a cloud account (Google / Dropbox) is connected or disconnected.
 * @param {string} provider - 'google' | 'dropbox'
 * @param {string} action - 'connect' | 'disconnect'
 * @param {number} totalConnected - total connected accounts of this provider after the action
 */
export const logCloudAccountConnection = (provider, action, totalConnected) => {
  logEvent('cloud_account_connection', {
    provider,
    action,
    total_connected: totalConnected ?? null,
    timestamp: Date.now(),
  });
  metaLogCloudAccountConnection(provider, action);
};

// Photos, uploads & sharing -----------------------------------------------

/**
 * Log per-photo upload with rich context.
 * @param {object} payload
 *  - drive: 'google' | 'dropbox'
 *  - type: 'before' | 'after' | 'combined'
 *  - format: 'default' | 'portrait' | 'square' | etc.
 *  - room
 *  - location
 *  - shared: boolean
 */
export const logPhotoUpload = (payload = {}) => {
  logEvent('photo_upload', {
    drive: payload.drive || 'google',
    type: payload.type || 'unknown',
    format: payload.format || 'default',
    room: payload.room || null,
    location: payload.location || null,
    shared: !!payload.shared,
    timestamp: Date.now(),
  });
  metaLogPhotoUpload(payload);
};

// Feature gates / paywalled features --------------------------------------

/**
 * Log when a locked feature popup (tier popup) is shown.
 * @param {string} featureKey - key from FEATURES (e.g. 'TEAM_INVITES')
 * @param {string} userPlan
 * @param {string} screen
 */
export const logFeatureGateShown = (featureKey, userPlan, screen) => {
  logEvent('feature_gate_shown', {
    feature: featureKey,
    plan: userPlan || 'unknown',
    screen: screen || 'unknown',
    timestamp: Date.now(),
  });
  metaLogFeatureGateShown(featureKey, userPlan);
};

/**
 * Log user actions on a locked feature popup (e.g. upgrade, close).
 * @param {string} featureKey
 * @param {string} userPlan
 * @param {string} screen
 * @param {string} action - 'upgrade_click' | 'close' | 'learn_more'
 */
export const logFeatureGateAction = (featureKey, userPlan, screen, action) => {
  logEvent('feature_gate_action', {
    feature: featureKey,
    plan: userPlan || 'unknown',
    screen: screen || 'unknown',
    action,
    timestamp: Date.now(),
  });
};

export default {
  logEvent,
  logScreenView,
  setUserProperties,
  setUserId,
  setAnalyticsEnabled,
  logPhotoCapture,
  logPhotoSave,
  logPhotoExport,
  logSettingsChange,
  logSignIn,
  logSignOut,
  logTeamAction,
  logLabelCustomization,
  logLanguageChange,
   // Business helpers
  logAccountCreated,
  logPlanChanged,
  logTrialEvent,
  logTeamInvitesCreated,
  logTeamMemberJoined,
  logReferralEvent,
  logCloudAccountConnection,
  logPhotoUpload,
  logFeatureGateShown,
  logFeatureGateAction,
};

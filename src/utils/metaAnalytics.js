/**
 * Meta (Facebook) SDK Analytics
 * Uses Meta's STANDARD event names via react-native-fbsdk-next constants.
 * Also fires custom events that mirror Firebase for unified tracking.
 */

let AppEventsLogger = null;
let Settings = null;
let AppEvents = null;
let AppEventParams = null;

try {
  const fbsdk = require('react-native-fbsdk-next');
  AppEventsLogger = fbsdk.AppEventsLogger;
  Settings = fbsdk.Settings;
  // Standard event name and param constants from native module
  const constants = fbsdk.AppEventsLogger?.AppEvents;
  const paramConstants = fbsdk.AppEventsLogger?.AppEventParams;
  if (constants) AppEvents = constants;
  if (paramConstants) AppEventParams = paramConstants;
} catch (error) {
  console.warn('[MetaAnalytics] Facebook SDK not available:', error.message);
}

/**
 * Initialize Meta SDK settings
 */
export const initMetaSDK = () => {
  if (!Settings) return;
  try {
    Settings.setAutoLogAppEventsEnabled(true);
    Settings.setAdvertiserTrackingEnabled(true);
    console.log('[MetaAnalytics] Meta SDK initialized');
  } catch (error) {
    console.warn('[MetaAnalytics] Init error:', error.message);
  }
};

/**
 * Log event to Meta
 */
const logMetaEvent = (eventName, valueToSum, params) => {
  if (!AppEventsLogger) return;
  try {
    if (valueToSum !== undefined && valueToSum !== null) {
      AppEventsLogger.logEvent(eventName, valueToSum, params || {});
    } else {
      AppEventsLogger.logEvent(eventName, params || {});
    }
  } catch (error) {
    // Silently fail
  }
};

/**
 * Log purchase event with value
 */
const logMetaPurchase = (amount, currency, params = {}) => {
  if (!AppEventsLogger) return;
  try {
    AppEventsLogger.logPurchase(amount, currency, params);
  } catch (error) {
    // Silently fail
  }
};

// ═══════════════════════════════════════════════
// META STANDARD EVENTS
// ═══════════════════════════════════════════════

/**
 * CompleteRegistration — user finishes onboarding
 */
export const metaLogAccountCreated = (payload = {}) => {
  logMetaEvent(
    AppEvents?.CompletedRegistration || 'fb_mobile_complete_registration',
    null,
    { [AppEventParams?.RegistrationMethod || 'fb_registration_method']: payload.method || 'unknown' }
  );
};

/**
 * StartTrial — trial begins
 */
export const metaLogTrialEvent = (action, payload = {}) => {
  if (action === 'start') {
    logMetaEvent(
      AppEvents?.StartTrial || 'StartTrial',
      null,
      { [AppEventParams?.ContentType || 'fb_content_type']: payload.plan || 'unknown' }
    );
  }
};

/**
 * Subscribe — user upgrades to paid plan
 */
export const metaLogPlanChanged = (fromPlan, toPlan) => {
  const paidPlans = ['pro', 'business', 'enterprise'];
  if (paidPlans.includes(toPlan)) {
    logMetaEvent(
      AppEvents?.Subscribe || 'Subscribe',
      null,
      { [AppEventParams?.ContentType || 'fb_content_type']: toPlan }
    );
  }
};

/**
 * Purchase — IAP purchase completes
 */
export const metaLogPurchase = (price = 0, currency = 'USD', plan = '') => {
  logMetaPurchase(price, currency, {
    [AppEventParams?.ContentType || 'fb_content_type']: plan,
    [AppEventParams?.NumItems || 'fb_num_items']: 1,
  });
};

/**
 * ViewContent — user views/exports a photo
 */
export const metaLogPhotoExport = (exportType) => {
  logMetaEvent(
    AppEvents?.ViewedContent || 'fb_mobile_content_view',
    null,
    { [AppEventParams?.ContentType || 'fb_content_type']: exportType || 'photo' }
  );
};

/**
 * Search — user searches/browses projects
 */
export const metaLogSearch = (query, contentType) => {
  logMetaEvent(
    AppEvents?.Searched || 'fb_mobile_search',
    null,
    {
      [AppEventParams?.SearchString || 'fb_search_string']: query || '',
      [AppEventParams?.ContentType || 'fb_content_type']: contentType || 'project',
      [AppEventParams?.Success || 'fb_success']: '1',
    }
  );
};

/**
 * InitiateCheckout — user taps upgrade/purchase button
 */
export const metaLogInitiateCheckout = (plan, source) => {
  logMetaEvent(
    AppEvents?.InitiatedCheckout || 'fb_mobile_initiated_checkout',
    null,
    {
      [AppEventParams?.ContentType || 'fb_content_type']: plan || 'unknown',
      [AppEventParams?.NumItems || 'fb_num_items']: 1,
    }
  );
};

/**
 * AddPaymentInfo — payment info confirmed
 */
export const metaLogAddPaymentInfo = (success = true) => {
  logMetaEvent(
    AppEvents?.AddedPaymentInfo || 'fb_mobile_add_payment_info',
    null,
    { [AppEventParams?.Success || 'fb_success']: success ? '1' : '0' }
  );
};

/**
 * Rate — user rates content
 */
export const metaLogRate = (rating, maxRating = 5, contentType = 'app') => {
  logMetaEvent(
    AppEvents?.Rated || 'fb_mobile_rate',
    rating,
    {
      [AppEventParams?.MaxRatingValue || 'fb_max_rating_value']: String(maxRating),
      [AppEventParams?.ContentType || 'fb_content_type']: contentType,
    }
  );
};

// ═══════════════════════════════════════════════
// CUSTOM EVENTS (mirror Firebase)
// ═══════════════════════════════════════════════

export const metaLogPhotoCapture = (photoType) => {
  logMetaEvent('photo_capture', null, { photo_type: photoType });
};

export const metaLogPhotoSave = (hasLabels = false) => {
  logMetaEvent('photo_save', null, { has_labels: hasLabels ? '1' : '0' });
};

export const metaLogSignIn = (method) => {
  logMetaEvent('login', null, { method });
};

export const metaLogTeamInvitesCreated = (count) => {
  logMetaEvent('team_invite', null, { count: String(count || 0) });
};

export const metaLogTeamMemberJoined = (payload = {}) => {
  logMetaEvent('team_member_joined', null, { plan: payload.plan || 'unknown' });
};

export const metaLogReferralEvent = (action, payload = {}) => {
  logMetaEvent('referral_event', null, { action, code: payload.code || '' });
};

export const metaLogCloudAccountConnection = (provider, action) => {
  logMetaEvent('cloud_account_connection', null, { provider, action });
};

export const metaLogPhotoUpload = (payload = {}) => {
  logMetaEvent('photo_upload', null, {
    drive: payload.drive || 'google',
    type: payload.type || 'unknown',
  });
};

export const metaLogFeatureGateShown = (featureKey, userPlan) => {
  logMetaEvent('feature_gate_shown', null, { feature: featureKey, plan: userPlan || 'unknown' });
  // Also fire InitiateCheckout for Meta ad optimization
  metaLogInitiateCheckout(userPlan, featureKey);
};

export default {
  initMetaSDK,
  metaLogPhotoCapture,
  metaLogPhotoSave,
  metaLogPhotoExport,
  metaLogSignIn,
  metaLogAccountCreated,
  metaLogTrialEvent,
  metaLogPlanChanged,
  metaLogPurchase,
  metaLogSearch,
  metaLogInitiateCheckout,
  metaLogAddPaymentInfo,
  metaLogRate,
  metaLogTeamInvitesCreated,
  metaLogTeamMemberJoined,
  metaLogReferralEvent,
  metaLogCloudAccountConnection,
  metaLogPhotoUpload,
  metaLogFeatureGateShown,
};

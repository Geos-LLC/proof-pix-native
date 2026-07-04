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

// Meta (Facebook) SDK imports — note: metaLogPurchase is intentionally NOT
// imported. Real-money `purchase` events are emitted server-side by the Apple
// webhook (proof-pix-proxy) via GA4 Measurement Protocol; the client must not
// fire `purchase` (Firebase) or Meta `Purchase` to avoid double-counting and
// trial-as-paid inflation. Renewals never reach the client at all.
import {
  metaLogPhotoCapture, metaLogPhotoSave, metaLogPhotoExport, metaLogSignIn,
  metaLogAccountCreated, metaLogTrialEvent, metaLogPlanChanged,
  metaLogSubscriptionStart,
  metaLogTeamInvitesCreated, metaLogTeamMemberJoined, metaLogReferralEvent,
  metaLogCloudAccountConnection, metaLogPhotoUpload, metaLogFeatureGateShown,
  metaLogInitiateCheckout, metaLogAddPaymentInfo,
} from './metaAnalytics';

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { mergeAttributionContext, saveAttributionContext } from './attributionContext';

/**
 * Analytics utility for Firebase Analytics
 * Provides helper functions to track user events and screen views
 */

// Global context attached to every event
let _globalContext = {
  platform: Platform.OS,
  app_version: Constants.expoConfig?.version || Constants.manifest?.version || 'unknown',
};

// Session ID: unique per app cold start
const _sessionId = `${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

/**
 * Set the current user ID for global context (call after auth)
 */
export const setGlobalUserId = (userId) => {
  _globalContext.user_id = userId || null;
};

/**
 * Extract and persist UTM params from a deep link URL.
 * Call once on first open when initial URL is available.
 */
export const extractAndSaveUTMParams = async (url) => {
  if (!url) return;
  try {
    const parsed = new URL(url);
    const utmSource = parsed.searchParams.get('utm_source');
    const utmCampaign = parsed.searchParams.get('utm_campaign');
    const utmMedium = parsed.searchParams.get('utm_medium');
    if (utmSource || utmCampaign || utmMedium) {
      const utmData = {
        utm_source: utmSource || null,
        utm_campaign: utmCampaign || null,
        utm_medium: utmMedium || null,
      };
      await AsyncStorage.setItem('@utm_params', JSON.stringify(utmData));
      if (__DEV__) console.log('[Analytics] UTM params saved:', utmData);
    }
  } catch {
    // Non-critical — URL may not be parseable
  }
};

/** Read stored UTM params (cached after first read) */
let _cachedUTM = undefined;
const _getUTMParams = async () => {
  if (_cachedUTM !== undefined) return _cachedUTM;
  try {
    const raw = await AsyncStorage.getItem('@utm_params');
    _cachedUTM = raw ? JSON.parse(raw) : null;
  } catch {
    _cachedUTM = null;
  }
  return _cachedUTM;
};

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
    console.warn(`[Analytics] ${eventName} SKIPPED (firebase not ready)`);
    return;
  }

  try {
    const analytics = getAnalyticsInstance();
    if (analytics && firebaseLogEvent) {
      // Auto-attach global context + UTM params
      const utm = await _getUTMParams();
      const enriched = {
        ..._globalContext,
        session_id: _sessionId,
        ...(utm || {}),
        ...params,
      };
      if (__DEV__) console.log(`[Analytics] ${eventName}:`, enriched);
      // Mirror to errorLogger so TestFlight users can export+inspect fired events
      try {
        const paramSummary = Object.keys(enriched).length
          ? ` ${JSON.stringify(enriched).slice(0, 400)}`
          : '';
        console.warn(`[Analytics] ${eventName}${paramSummary}`);
      } catch {}
      await firebaseLogEvent(analytics, eventName, enriched);
    }
  } catch (error) {
    console.warn(`[Analytics] ${eventName} FAILED: ${error?.message || 'unknown'}`);
  }
};

/**
 * Log screen view to Firebase Analytics
 * Uses logEvent with screen_view event name (migrated from deprecated logScreenView)
 * @param {string} screenName - Name of the screen
 * @param {string} screenClass - Class of the screen (optional)
 */
export const logScreenView = async (screenName, screenClass = screenName) => {
  await logEvent('screen_view', {
    screen_name: screenName,
    screen_class: screenClass,
  });
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
export const logPhotoCapture = (photoType, sourceType = 'camera', projectId = null) => {
  logEvent('photo_capture', {
    photo_type: photoType,
    source_type: sourceType,
    project_id: projectId,
    timestamp: Date.now(),
  });
  metaLogPhotoCapture(photoType);
};

/**
 * Log when a photo pair is saved
 * @param {boolean} hasLabels - Whether labels were added
 * @param {string} labelPosition - Position of labels if applicable
 */
export const logPhotoSave = (hasLabels = false, labelPosition = null, sourceType = 'camera') => {
  logEvent('photo_save', {
    has_labels: hasLabels,
    label_position: labelPosition,
    source_type: sourceType,
    timestamp: Date.now(),
  });
  metaLogPhotoSave(hasLabels);
};

/**
 * Log when a photo is exported
 * @param {string} exportType - Type of export (share, save, etc.)
 */
export const logPhotoExport = (exportType, sourceType = 'camera', projectId = null) => {
  logEvent('photo_export', {
    export_type: exportType,
    source_type: sourceType,
    project_id: projectId,
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
export const logAccountCreated = async (payload = {}) => {
  const params = await mergeAttributionContext({
    method: payload.method || 'unknown',
    is_team: !!payload.is_team,
    plan: payload.plan || 'unknown',
    is_trial: !!payload.is_trial,
    timestamp: Date.now(),
  });
  logEvent('account_created', params);
  metaLogAccountCreated(payload);
};

/**
 * Log when a user changes plan / tier.
 * @param {string} fromPlan
 * @param {string} toPlan
 * @param {string} sourceScreen - where the change was initiated (e.g. 'Settings')
 */
export const logPlanChanged = async (fromPlan, toPlan, sourceScreen = 'unknown') => {
  const params = await mergeAttributionContext({
    from_plan: fromPlan || 'unknown',
    to_plan: toPlan || 'unknown',
    source: sourceScreen,
    timestamp: Date.now(),
  });
  logEvent('plan_changed', params);
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
export const logTrialEvent = async (action, payload = {}) => {
  const params = await mergeAttributionContext({
    action,
    plan: payload.plan || 'unknown',
    days_used: payload.days_used ?? null,
    days_remaining: payload.days_remaining ?? null,
    timestamp: Date.now(),
  });
  logEvent('trial_event', params);
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
    link_type: payload.link_type || null,
    channel: payload.channel || null,
    source: payload.source || null,
    campaign: payload.campaign || null,
    placement: payload.placement || null,
    method: payload.method || null,
    from_plan: payload.from_plan || null,
    to_plan: payload.to_plan || null,
    rewards: payload.rewards ?? null,
    days_added: payload.days_added ?? null,
    timestamp: Date.now(),
  });
  metaLogReferralEvent(action, payload);
};

/**
 * Log when an admin marketing referral is redeemed.
 * Dedicated conversion event with channel/source for Google Ads optimization.
 * Import this into Google Ads as a conversion action to optimize ad spend by channel.
 *
 * @param {object} payload
 *  - code: the referral code
 *  - channel: marketing channel (e.g. 'instagram', 'facebook', 'flyer', 'google_ads')
 *  - source: traffic source (e.g. 'bio_link', 'story', 'ad_campaign_spring')
 *  - label: human-readable label for the link
 *  - days_added: bonus trial days granted
 */
export const logAdminReferralConversion = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] admin_referral_conversion:', payload);

  // Persist attribution so downstream events (trial, purchase) carry the same context
  await saveAttributionContext({
    referral_code: payload.code,
    link_type: payload.link_type || 'admin',
    channel: payload.channel,
    source: payload.source,
    campaign: payload.campaign,
    placement: payload.placement,
  });

  logEvent('admin_referral_conversion', {
    code: payload.code || null,
    link_type: payload.link_type || 'admin',
    channel: payload.channel || null,
    source: payload.source || null,
    campaign: payload.campaign || null,
    placement: payload.placement || null,
    label: payload.label || null,
    days_added: payload.days_added ?? null,
    timestamp: Date.now(),
  });
  metaLogReferralEvent('admin_referral_conversion', payload);
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

// Subscriptions & purchases ------------------------------------------------
//
// The client NEVER emits a GA4 `purchase` or Meta `Purchase` event. The only
// revenue source of truth is the Apple App Store Server Notifications V2
// webhook in proof-pix-proxy, which classifies paid vs trial server-side and
// forwards confirmed paid events to GA4 via the Measurement Protocol.
// Android Real-Time Developer Notifications (RTDN) is not yet wired — when it
// lands it will follow the same model. Do not reintroduce a client-side
// `logPurchaseCompleted` helper: free-trial starts and paid renewals are
// indistinguishable from a StoreKit/Play Billing client perspective, and
// renewals never fire `purchaseUpdatedListener` once the original transaction
// is finished.

// Trial-expired flag key — read by logSubscriptionStarted to emit trial_converted
const TRIAL_EXPIRED_SUBSCRIBE_FLAG = '@trial_expired_logged';

/**
 * Build the standard subscription-event param block. Every subscription event
 * carries the same shape so GA4 / Firebase dashboards can pivot consistently.
 */
const _buildSubscriptionParams = async (payload = {}) => {
  const planId = payload.plan_id || payload.plan || 'unknown';
  const platform = payload.platform || Platform.OS;
  const provider =
    payload.provider ||
    (platform === 'ios' ? 'apple' : platform === 'android' ? 'google' : 'unknown');

  // billing_period: prefer the caller's explicit value, otherwise derive from
  // the productId suffix (.annual / .seat). Powers the "annual selection rate"
  // and "trial→annual conversion" metrics without a Play/ASC pricing refresh.
  const productId = payload.product_id || null;
  let billingPeriod = payload.billing_period || null;
  if (!billingPeriod && productId) {
    if (productId.includes('.seat')) billingPeriod = 'seat';
    else if (productId.includes('.annual')) billingPeriod = 'annual';
    else billingPeriod = 'monthly';
  }

  return mergeAttributionContext({
    plan_id: planId,
    product_id: productId,
    platform,
    provider,
    entry_point: payload.entry_point || 'paywall',
    subscription_type: payload.subscription_type || 'unknown',
    transaction_id: payload.transaction_id || null,
    original_transaction_id: payload.original_transaction_id || null,
    is_seat: !!payload.is_seat,
    price: payload.price ?? null,
    currency: payload.currency || null,
    billing_period: billingPeriod,
    // Provenance tag so GA4 can prove which path a subscription event came
    // from (purchase_success | free_plan | app_launch | restore | upgrade |
    // trial_expiration). Helps audit funnel inflation without grepping code.
    analytics_source: payload.analytics_source || null,
    // Funnel attribution: if this subscription started after a trial expired,
    // these tag the conversion so GA4 can build "trial → paid" funnels and
    // detect cross-tier switches (e.g. trialed Pro, converted to Business).
    was_trial: !!payload.was_trial,
    from_plan: payload.from_plan || null,
    switched: !!payload.switched,
    timestamp: Date.now(),
  });
};

/**
 * Subscription entitlement became active for the user.
 * Fires for new subscriptions (trial OR paid) AND when the app confirms
 * an existing entitlement (restore, app relaunch with active sub).
 *
 * Does NOT fire the GA4 `purchase` event. Real revenue is reported by
 * App Store Connect / Play Console (or, in the future, by server-side
 * receipt validation).
 *
 * @param {object} payload — see _buildSubscriptionParams
 */
export const logSubscriptionStarted = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] subscription_started:', payload);
  const params = await _buildSubscriptionParams(payload);
  logEvent('subscription_started', params);

  // Meta (Facebook) SDK: fire standard Subscribe event for ads optimization.
  // We do NOT fire Meta `Purchase` from the client at all — see top-of-section
  // comment. Real revenue events come from the server webhook only.
  metaLogSubscriptionStart(params.plan_id, params.platform);

  // Derived event: if trial_expired previously fired, emit trial_converted
  // when the user comes back and starts a paid subscription.
  try {
    const expiredFlag = await AsyncStorage.getItem(TRIAL_EXPIRED_SUBSCRIBE_FLAG);
    if (expiredFlag && params.subscription_type === 'paid') {
      await logTrialConverted({
        plan_id: params.plan_id,
        platform: params.platform,
        entry_point: params.entry_point,
        subscription_type: params.subscription_type,
        transaction_id: params.transaction_id,
      });
    }
  } catch {
    // non-critical
  }
};

/**
 * User restored an existing subscription (manual Restore Purchases tap or
 * launch-time auto-restore that ended with an entitlement). Does NOT fire
 * `purchase` — no money changed hands.
 */
export const logSubscriptionRestored = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] subscription_restored:', payload);
  const params = await _buildSubscriptionParams({
    ...payload,
    entry_point: payload.entry_point || 'restore',
  });
  logEvent('subscription_restored', params);
};

/**
 * The app currently sees an active entitlement (e.g. on cold start or when
 * the user navigates to a gated feature). Useful for cohorts of "DAU with
 * active sub". Does NOT fire `purchase`.
 */
export const logSubscriptionActive = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] subscription_active:', payload);
  const params = await _buildSubscriptionParams(payload);
  logEvent('subscription_active', params);
};

/**
 * User changed plans (cross-tier upgrade or downgrade) on a still-active
 * subscription. Does NOT fire `purchase` — proration is handled by the store.
 */
export const logSubscriptionUpgraded = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] subscription_upgraded:', payload);
  const params = await _buildSubscriptionParams({
    ...payload,
    entry_point: payload.entry_point || 'upgrade',
  });
  logEvent('subscription_upgraded', {
    ...params,
    from_plan: payload.from_plan || null,
    to_plan: payload.to_plan || params.plan_id,
  });
};

/**
 * Server / receipt validation later observed that a previously active
 * subscription is no longer active (cancelled, expired, billing failure).
 * Wired up for a future server pipeline; safe no-op until then.
 */
export const logSubscriptionCancelledDetected = async (payload = {}) => {
  if (__DEV__) console.log('[Analytics] subscription_cancelled_detected:', payload);
  const params = await _buildSubscriptionParams(payload);
  logEvent('subscription_cancelled_detected', {
    ...params,
    reason: payload.reason || 'unknown',
  });
};

// App lifecycle ---------------------------------------------------------------

export const logAppOpen = () => {
  logEvent('app_open', { timestamp: Date.now() });
};

// Onboarding ------------------------------------------------------------------

export const logOnboardingStarted = () => {
  logEvent('onboarding_started', { timestamp: Date.now() });
};

export const logOnboardingStepCompleted = (stepName) => {
  logEvent('onboarding_step_completed', { step_name: stepName, timestamp: Date.now() });
};

export const logOnboardingCompleted = () => {
  logEvent('onboarding_completed', { timestamp: Date.now() });
};

// Paywall ---------------------------------------------------------------------

export const logPaywallView = (extra = {}) => {
  logEvent('paywall_view', {
    trigger: extra.trigger || null,
    trial_type: extra.trial_type || 'apple',
    exports_used: extra.exports_used ?? null,
    device_id: extra.device_id || null,
    // Default billing cadence the paywall is showing on open. Null when the
    // caller doesn't have a preselected cadence to report (kept for callers
    // that never set it — GA4 keeps the param but it just reads as `(none)`).
    billing_period: extra.billing_period || null,
    timestamp: Date.now(),
  });
};

// Soft Trial events --------------------------------------------------------

export const logSoftTrialStarted = (payload = {}) => {
  logEvent('soft_trial_started', {
    trial_type: 'soft',
    device_id: payload.device_id || null,
    timestamp: Date.now(),
  });
};

export const logSoftTrialCompleted = (payload = {}) => {
  logEvent('soft_trial_completed', {
    trial_type: 'soft',
    exports_used: payload.exports_used ?? null,
    device_id: payload.device_id || null,
    timestamp: Date.now(),
  });
};

export const logSoftTrialBlocked = (payload = {}) => {
  logEvent('soft_trial_blocked', {
    trial_type: 'soft',
    reason: payload.reason || 'unknown',
    exports_used: payload.exports_used ?? null,
    device_id: payload.device_id || null,
    timestamp: Date.now(),
  });
};

export const logFreeExportUsed = (payload = {}) => {
  logEvent('free_export_used', {
    trial_type: 'soft',
    exports_used: payload.exports_used ?? null,
    remaining: payload.remaining ?? null,
    timestamp: Date.now(),
  });
};

export const logPlanSelected = (plan, useTrial = false, billingPeriod = null) => {
  logEvent('plan_selected', {
    plan,
    plan_id: plan,
    is_trial: useTrial,
    // 'monthly' | 'annual' | null. Powers the annual selection-rate metric.
    billing_period: billingPeriod || null,
    timestamp: Date.now(),
  });
};

export const logTrialSkipped = () => {
  logEvent('trial_skipped', { timestamp: Date.now() });
};

/**
 * Canonical trial-start event. Fires when the user begins a free trial,
 * either via the store's introductory offer (Apple/Google) or — historically —
 * via the legacy app-side trial. Does NOT fire `purchase` (no money charged).
 *
 * Two call shapes are supported:
 *   logTrialStarted('pro', { days_remaining: 15 })            // legacy
 *   logTrialStarted({                                          // canonical
 *     plan_id, platform, provider, transaction_id,
 *     original_transaction_id, entry_point, subscription_type,
 *   })
 */
export const logTrialStarted = async (planOrPayload, extra = {}) => {
  const payload =
    typeof planOrPayload === 'string'
      ? { plan_id: planOrPayload, ...extra }
      : (planOrPayload || {});

  const planId = payload.plan_id || payload.plan || 'unknown';
  const platform = payload.platform || Platform.OS;
  const provider =
    payload.provider ||
    (platform === 'ios' ? 'apple' : platform === 'android' ? 'google' : 'unknown');

  // Same derivation as _buildSubscriptionParams — trial starts need the
  // billing_period tag so GA4 can build "monthly trial → paid" vs
  // "annual trial → paid" funnels.
  const productId = payload.product_id || null;
  let billingPeriod = payload.billing_period || null;
  if (!billingPeriod && productId) {
    if (productId.includes('.seat')) billingPeriod = 'seat';
    else if (productId.includes('.annual')) billingPeriod = 'annual';
    else billingPeriod = 'monthly';
  }

  const params = await mergeAttributionContext({
    plan: planId,
    plan_id: planId,
    product_id: productId,
    platform,
    provider,
    entry_point: payload.entry_point || 'paywall',
    subscription_type: payload.subscription_type || 'trial',
    transaction_id: payload.transaction_id || null,
    original_transaction_id: payload.original_transaction_id || null,
    days_remaining: payload.days_remaining ?? null,
    price: payload.price ?? null,
    currency: payload.currency || null,
    billing_period: billingPeriod,
    analytics_source: payload.analytics_source || null,
    timestamp: Date.now(),
  });
  console.log('[firebase-debug] logEvent trial_started called', {
    firebaseReady: typeof getApps === 'function' ? getApps().length > 0 : 'unknown',
    params,
  });
  logEvent('trial_started', params);
};

/**
 * Derived event: fires when a user who had `trial_expired` subsequently
 * triggers `subscription_started`. Attribution auto-merged.
 */
export const logTrialConverted = async (payload = {}) => {
  const params = await mergeAttributionContext({
    plan_id: payload.plan_id || 'unknown',
    platform: payload.platform || Platform.OS,
    entry_point: payload.entry_point || 'trial_expired',
    subscription_type: payload.subscription_type || 'paid',
    transaction_id: payload.transaction_id || null,
    timestamp: Date.now(),
  });
  logEvent('trial_converted', params);
};

// Trial expired (dedup via AsyncStorage flag) ---------------------------------

const TRIAL_EXPIRED_FLAG = '@trial_expired_logged';

export const logTrialExpiredOnce = async () => {
  try {
    const already = await AsyncStorage.getItem(TRIAL_EXPIRED_FLAG);
    if (already) return;
    await AsyncStorage.setItem(TRIAL_EXPIRED_FLAG, 'true');
    const params = await mergeAttributionContext({ timestamp: Date.now() });
    logEvent('trial_expired', params);
  } catch {
    // non-critical
  }
};

// Core feature usage ----------------------------------------------------------

export const logBeforeAfterCreated = (templateType) => {
  logEvent('before_after_created', { template_type: templateType || 'default', timestamp: Date.now() });
};

export const logFeatureUsed = (featureName) => {
  logEvent('feature_used', { feature_name: featureName, timestamp: Date.now() });
};

export const logProjectCreated = () => {
  logEvent('project_created', { timestamp: Date.now() });
};

// Job lifecycle (core product metric) -----------------------------------------

export const logBeforePhotoStarted = (projectId, sourceType = 'camera') => {
  logEvent('before_photo_started', { project_id: projectId || null, source_type: sourceType });
};

export const logAfterPhotoCompleted = (projectId, timeSinceBefore = null) => {
  logEvent('after_photo_completed', { project_id: projectId || null, time_since_before: timeSinceBefore });
};

export const logCollageCompleted = (projectId, sourceType = 'camera') => {
  logEvent('collage_completed', { project_id: projectId || null, source_type: sourceType });
};

export const logJobCompleted = (projectId, timeTotal = null, sourceType = 'camera') => {
  logEvent('job_completed', { project_id: projectId || null, time_total: timeTotal, source_type: sourceType });
};

export const logJobCompletedAfterReminder = (timeFromReminder = null) => {
  logEvent('job_completed_after_reminder', { time_from_reminder: timeFromReminder });
};

export const logJobReminderTriggered = (reminderType) => {
  logEvent('job_reminder_triggered', { reminder_type: reminderType });
};

export const logJobReminderOpened = () => {
  logEvent('job_reminder_opened');
};

export default {
  logEvent,
  logScreenView,
  setUserProperties,
  setUserId,
  setAnalyticsEnabled,
  setGlobalUserId,
  extractAndSaveUTMParams,
  logAppOpen,
  logPhotoCapture,
  logPhotoSave,
  logPhotoExport,
  logSettingsChange,
  logSignIn,
  logSignOut,
  logTeamAction,
  logLabelCustomization,
  logLanguageChange,
  // Onboarding
  logOnboardingStarted,
  logOnboardingStepCompleted,
  logOnboardingCompleted,
  // Paywall
  logPaywallView,
  logPlanSelected,
  logTrialSkipped,
  logTrialStarted,
  logTrialConverted,
  logTrialExpiredOnce,
  // Core features
  logBeforeAfterCreated,
  logFeatureUsed,
  logProjectCreated,
  // Job lifecycle
  logBeforePhotoStarted,
  logAfterPhotoCompleted,
  logCollageCompleted,
  logJobCompleted,
  logJobCompletedAfterReminder,
  logJobReminderTriggered,
  logJobReminderOpened,
  // Business helpers
  logAccountCreated,
  logPlanChanged,
  logTrialEvent,
  logSubscriptionStarted,
  logSubscriptionRestored,
  logSubscriptionActive,
  logSubscriptionUpgraded,
  logSubscriptionCancelledDetected,
  logTeamInvitesCreated,
  logTeamMemberJoined,
  logReferralEvent,
  logAdminReferralConversion,
  logCloudAccountConnection,
  logPhotoUpload,
  logFeatureGateShown,
  logFeatureGateAction,
};

/**
 * feedbackService
 *
 * Client-side submission for the Settings → "Send feedback" flow. Two
 * types share the same POST /api/feedback endpoint:
 *   - "bug":     description (required) + optional screenshot + auto metadata
 *   - "feature": title + description
 *
 * Screenshots are downscaled + JPEG-compressed on the client before
 * upload (max 1600px longest edge, quality 0.7) so the proxy's 3MB cap
 * is comfortably respected even for full-resolution device screenshots.
 *
 * Auto metadata is gathered here rather than in the screens so we have
 * one place to keep the field list in sync with the backend's schema.
 */

import { Platform, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n/i18n';
import { PROXY_SERVER_URL } from '../config/proxy';
import { getUserId } from './referralService';
import { getLastMeaningfulScreen } from './screenTracker';
import {
  isBonusEntitlementActive,
  getBonusDaysRemaining,
} from './bonusEntitlementService';

const FEEDBACK_ENDPOINT = `${PROXY_SERVER_URL}/api/feedback`;
const SCREENSHOT_MAX_EDGE = 1600;
const SCREENSHOT_JPEG_QUALITY = 0.7;

// Mirror the tiny helper HelpSupportScreen uses so submissions carry a
// device-locale hint for triage (e.g. "de user reporting broken label
// alignment" vs "en user with same complaint" often narrows to i18n
// truncation issues).
const getDeviceLocale = () => {
  try {
    if (Platform.OS === 'ios') {
      return (
        NativeModules.SettingsManager?.settings?.AppleLocale ||
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] ||
        ''
      );
    }
    return NativeModules.I18nManager?.localeIdentifier || '';
  } catch {
    return '';
  }
};

/**
 * Collect the auto-populated metadata block. All fields are best-effort —
 * a missing value is null on the wire, not a submission blocker.
 */
export async function collectAutoMetadata({ userPlan } = {}) {
  const appVersion =
    Constants?.expoConfig?.version || Constants?.manifest?.version || null;
  const buildNumber =
    (Platform.OS === 'ios'
      ? Constants?.expoConfig?.ios?.buildNumber
      : Constants?.expoConfig?.android?.versionCode) || null;

  // Report bonus entitlement (not "trial") in feedback metadata. The app no
  // longer maintains a parallel local trial timer — store trial state lives
  // inside `planTier` (a user in an Apple/Play intro offer is on the
  // corresponding paid tier from our POV).
  let bonusActive = false;
  let bonusDaysRemaining = null;
  try { bonusActive = await isBonusEntitlementActive(); } catch {}
  if (bonusActive) {
    try {
      const days = await getBonusDaysRemaining();
      if (Number.isFinite(days)) bonusDaysRemaining = days;
    } catch {}
  }

  return {
    appVersion: appVersion ? String(appVersion) : null,
    buildNumber: buildNumber != null ? String(buildNumber) : null,
    platform: Platform.OS,
    osVersion: Device.osVersion || String(Platform.Version || '') || null,
    deviceModel: Device.modelName || Device.deviceName || null,
    currentScreen: getLastMeaningfulScreen(),
    locale: getDeviceLocale() || null,
    appLanguage: i18n?.language || null,
    planTier: userPlan || null,
    bonusActive,
    bonusDaysRemaining,
  };
}

/**
 * Downscale + compress a screenshot for upload. Returns a { uri,
 * mimeType, name } shape ready to append to FormData. If manipulation
 * fails we fall back to the original uri so the user's submission still
 * goes through — the proxy will reject anything oversized with a clear
 * error we can surface.
 */
async function prepareScreenshot(uri) {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: SCREENSHOT_MAX_EDGE } }],
      { compress: SCREENSHOT_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: result.uri, mimeType: 'image/jpeg', name: 'screenshot.jpg' };
  } catch (error) {
    console.warn('[feedbackService] screenshot manipulate failed, sending original:', error?.message);
    return { uri, mimeType: 'image/jpeg', name: 'screenshot.jpg' };
  }
}

async function submit({ type, description, title, severity, screenshotUri, email: emailInput, userPlan }) {
  if (!description || !description.trim()) {
    throw new Error('MISSING_DESCRIPTION');
  }
  if (type === 'feature' && (!title || !title.trim())) {
    throw new Error('MISSING_TITLE');
  }

  const metadata = await collectAutoMetadata({ userPlan });
  let userId = null;
  let deviceId = null;
  try {
    userId = await getUserId();
    deviceId = await AsyncStorage.getItem('@device_id');
  } catch {}

  // Prefer the address the user typed on this form; fall back to the
  // one stored from HelpSupport (`@proofpix_owner_email`). Empty string
  // from the input means "no email" — treat as null so the record
  // doesn't carry a phantom blank.
  let email = null;
  const typed = (emailInput || '').trim();
  if (typed) {
    email = typed;
  } else {
    try {
      const stored = await AsyncStorage.getItem('@proofpix_owner_email');
      if (stored && stored.trim()) email = stored.trim();
    } catch {}
  }

  // Persist a newly-typed email so the next submission is one-tap and
  // it's available to HelpSupport too. Only when non-empty — never blank
  // out a stored value.
  if (typed) {
    try { await AsyncStorage.setItem('@proofpix_owner_email', typed); } catch {}
  }

  // Multipart when we have a screenshot (bug only), JSON otherwise. The
  // proxy accepts both — keeps feature submissions from paying the
  // multipart parsing cost.
  if (type === 'bug' && screenshotUri) {
    const shot = await prepareScreenshot(screenshotUri);
    const fd = new FormData();
    fd.append('type', 'bug');
    fd.append('description', description.trim());
    fd.append('metadata', JSON.stringify(metadata));
    if (severity) fd.append('severity', severity);
    if (userId) fd.append('userId', userId);
    if (deviceId) fd.append('deviceId', deviceId);
    if (email) fd.append('email', email);
    fd.append('screenshot', {
      uri: shot.uri,
      name: shot.name,
      type: shot.mimeType,
    });

    const resp = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      body: fd,
      // Note: no Content-Type header — fetch sets the multipart
      // boundary itself when the body is FormData.
    });
    return handleResponse(resp);
  }

  const body = {
    type,
    description: description.trim(),
    metadata,
    userId,
    deviceId,
    email,
    ...(type === 'bug' ? { severity } : {}),
    ...(type === 'feature' ? { title: title.trim() } : {}),
  };

  const resp = await fetch(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(resp);
}

async function handleResponse(resp) {
  const status = resp.status;
  let json = null;
  try { json = await resp.json(); } catch {}

  if (resp.ok && json?.success) return json;

  if (status === 413) throw new Error('SCREENSHOT_TOO_LARGE');
  if (status === 429) throw new Error('RATE_LIMITED');
  if (status === 400 && json?.error) throw new Error(String(json.error).toUpperCase());
  throw new Error('SUBMIT_FAILED');
}

export async function submitBugReport({ description, severity, screenshotUri, email, userPlan }) {
  return submit({ type: 'bug', description, severity, screenshotUri, email, userPlan });
}

export async function submitFeatureRequest({ title, description, email, userPlan }) {
  return submit({ type: 'feature', title, description, email, userPlan });
}

export default { submitBugReport, submitFeatureRequest, collectAutoMetadata };

/**
 * Invite Link Generator Utility
 * Generates smart invite links that work across platforms
 *
 * The generated link will:
 * 1. Open the app directly if installed (via deep link)
 * 2. Redirect to app store if not installed
 * 3. Pass the invite code to the app
 */

import { Platform } from 'react-native';

// Base URL for the invite landing page. www.proofpix.app hosts static join +
// connect redirect pages under /join and /connect and serves the AASA +
// assetlinks that make these Universal Links / App Links. The apex domain
// proofpix.app cannot be used — GoDaddy DNS points it at an empty S3 bucket,
// not the CloudFront distribution. EXPO_PUBLIC_INVITE_BASE_URL exists for QA
// against Railway's older /join handler; production defaults to www.
const INVITE_BASE_URL = process.env.EXPO_PUBLIC_INVITE_BASE_URL || 'https://www.proofpix.app';

// App Store URLs. Apple auto-fills the region + slug from the numeric
// id so `/app/id<n>` is the shortest canonical form that still works
// globally — saves ~40 chars in the share message.
const IOS_APP_STORE_URL = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL || 'https://apps.apple.com/app/id6754261444';
const ANDROID_PLAY_STORE_URL = process.env.EXPO_PUBLIC_ANDROID_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.proofpix.app';
// Single short download URL that platform-detects and hops to the
// correct store — served by proofpix-landing-page /get. Collapses the
// two-line iOS+Android block below into one line.
const DOWNLOAD_URL = 'https://www.proofpix.app/get';

// Deep link scheme
const APP_SCHEME = 'proofpix';

/**
 * Generate a smart invite link that includes the invite code
 * This creates a web URL that will redirect to the app or app store
 *
 * @param {string} token - The invite token
 * @param {string} sessionId - The proxy session ID
 * @returns {string} The full invite URL
 */
export function generateInviteLink(token, sessionId) {
  // Encode the invite data for URL safety
  const inviteData = encodeURIComponent(`${token}|${sessionId}`);

  // Create a web URL that the proxy server can handle
  // The proxy server should have a /join endpoint that:
  // 1. Detects platform
  // 2. Tries to open the app with deep link
  // 3. Falls back to app store
  return `${INVITE_BASE_URL}/join?invite=${inviteData}`;
}

/**
 * Generate the deep link URL for the app
 * This is used when the app is already installed
 *
 * @param {string} token - The invite token
 * @param {string} sessionId - The proxy session ID
 * @returns {string} The deep link URL
 */
export function generateDeepLink(token, sessionId) {
  const inviteData = encodeURIComponent(`${token}|${sessionId}`);
  return `${APP_SCHEME}://join?invite=${inviteData}`;
}

/**
 * Get the appropriate app store link for the current platform
 *
 * @returns {string} App store URL
 */
export function getAppStoreLink() {
  return Platform.OS === 'ios' ? IOS_APP_STORE_URL : ANDROID_PLAY_STORE_URL;
}

/**
 * Generate a formatted share message with the invite link
 *
 * @param {string} token - The invite token
 * @param {string} sessionId - The proxy session ID
 * @param {string} teamName - Optional team name for personalization
 * @returns {object} Object with title and message for sharing
 */
export function generateShareContent(token, sessionId, teamName = '') {
  const inviteLink = generateInviteLink(token, sessionId);
  const deepLink = generateDeepLink(token, sessionId);
  const inviteCode = generateInviteCode(token, sessionId);

  const teamText = teamName ? `my ${teamName} team` : 'my ProofPix team';

  const message = `You're invited to join ${teamText}! 🎉

Tap to join: ${inviteLink}

Or enter this code in the app:
${inviteCode}

Don't have ProofPix? ${DOWNLOAD_URL}`;

  return {
    title: 'ProofPix Team Invite',
    message,
    inviteLink,
  };
}

/**
 * Generate a simple invite code for manual entry
 * This is a fallback for users who can't use the link
 *
 * @param {string} token - The invite token
 * @param {string} sessionId - The proxy session ID
 * @returns {string} The invite code
 */
export function generateInviteCode(token, sessionId) {
  return `${token}|${sessionId}`;
}

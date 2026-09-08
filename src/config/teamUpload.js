/**
 * Team upload rollout gate (Slice A).
 *
 * Controls whether team_member accounts route their photo uploads
 * through the existing dormant team-upload pipeline
 * (backgroundUploadService.processTeamUpload).
 *
 * Rollout mechanism is OTA-only: these constants are compiled into
 * the JS bundle. To change them in production, push an OTA via
 * `npm run release:ota --branch=<production|development> ...`.
 * There is no runtime remote-config plumbing in ProofPix today; do
 * not treat this like a server-side flag.
 *
 * Canary is scoped by admin proxy sessionId (all members of one
 * admin share it) — this matches how we actually roll out: one
 * admin's entire team gets flipped on together.
 *
 * IMPORTANT: this is a rollout gate, not authorization. The proxy
 * still validates every upload's invite token against the admin's
 * inviteTokens list.
 */

// Master switch. When true, every team_member account uploads via
// the team pipeline regardless of the canary list below.
export const TEAM_UPLOAD_ENABLED = true;

// Canary allow-list: admin proxy sessionIds whose team members are
// opted in to the team upload pipeline. Add a sessionId here to
// enable it for that admin's whole team.
export const TEAM_UPLOAD_CANARY_SESSION_IDS = [
  'e700f98f528391993f26a7b64a838ffb', // canary 2026-07-22 — internal admin
];

// Slice B: when true, PhotoContext.addPhoto auto-enqueues a team
// upload immediately after capture for team_member accounts that
// already satisfy `isTeamUploadEnabled` (canary or master flag) AND
// whose admin storage is supported.
//
// OFF by default (2026-09): auto-sync ignored the Before / After /
// Combined toggles on the Send sheet, so every capture type reached
// the admin regardless of what the cleaner picked. Manual Send is
// the authoritative path and honors those toggles. Flip back on only
// if product wants capture-time sync again (and then filter by a
// persisted type preference).
export const TEAM_AUTO_SYNC_ENABLED = false;

/**
 * Rollout gate: is the caller's team session opted into the team
 * upload pipeline? Answers "yes" for the master flag or when the
 * admin's sessionId is on the canary allow-list. Does NOT check
 * whether the pipeline can actually deliver bytes to the admin's
 * storage — see `getTeamUploadBlockedReason` for that.
 *
 * @param {{ sessionId?: string|null } | null | undefined} teamInfo
 * @returns {boolean}
 */
export function isTeamUploadEnabled(teamInfo) {
  if (TEAM_UPLOAD_ENABLED === true) return true;
  const sessionId = teamInfo?.sessionId;
  if (!sessionId) return false;
  return TEAM_UPLOAD_CANARY_SESSION_IDS.includes(sessionId);
}

/**
 * Slice A.5: capability gate. Even when the rollout flag says yes,
 * the pipeline only knows how to deliver to certain admin storage
 * backends. Others get a clear "coming soon" from the caller
 * instead of a broken upload.
 *
 * Returns a specific reason string when the team upload is blocked,
 * or null when it can proceed. Callers should treat `null` as
 * "green light, enqueue team upload" and any non-null value as
 * "surface a user-facing message and do NOT enqueue."
 *
 * Supported today:
 *   - google       → proxy fans out to admin's Drive
 *   - serviceflow  → proxy attaches directly to admin's SF job
 *                    (SF-primary sessions have no Drive; the proxy's
 *                    /api/upload/:sid SF branch handles this — added
 *                    ahead of client-side unblock so team-member
 *                    uploads with a valid invite token + crmJobId
 *                    already round-trip to SF end-to-end)
 *
 * Coming soon: dropbox, apple/icloud.
 *
 * Default when admin's accountType is unknown (undefined/null): we
 * allow the upload to proceed. This preserves pre-A.5 canary
 * behavior for team members who joined before A.5 shipped and
 * haven't cold-started to self-heal their teamInfo shape yet.
 *
 * @param {{ sessionId?: string|null, adminAccountType?: string|null } | null | undefined} teamInfo
 * @returns {'ADMIN_STORAGE_UNSUPPORTED' | null}
 */
export function getTeamUploadBlockedReason(teamInfo) {
  const at = teamInfo?.adminAccountType;
  if (!at) return null; // unknown → allow (pre-A.5 behavior)
  if (at === 'google') return null;
  // Service Flow–primary workspaces still fan out photos to SF via the
  // proxy even without Drive. Blocking them meant crew photos never
  // reached SF Files when the admin had SF connected but no Google.
  if (at === 'serviceflow') return null;
  return 'ADMIN_STORAGE_UNSUPPORTED';
}

/**
 * Human-readable label for the admin's storage backend, used in
 * user-facing "coming soon" copy.
 * @param {string|null|undefined} accountType
 * @returns {string}
 */
export function adminStorageLabel(accountType) {
  if (accountType === 'dropbox') return 'Dropbox';
  if (accountType === 'apple' || accountType === 'icloud') return 'iCloud';
  if (accountType === 'google') return 'Google Drive';
  return 'this cloud storage';
}

const UPLOAD_TYPES_KEY = '@team_upload_type_prefs';
const DEFAULT_UPLOAD_TYPES = { before: true, after: true, combined: true };

/** Normalize Before/After/Combined toggle bag used by Send sheets. */
export function normalizeUploadTypes(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_UPLOAD_TYPES };
  return {
    before: !!raw.before,
    after: !!raw.after,
    combined: !!raw.combined,
  };
}

/** Last Send-sheet type choice (AsyncStorage). Falls back to all-on. */
export async function loadUploadTypePrefs() {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const raw = await AsyncStorage.getItem(UPLOAD_TYPES_KEY);
    if (!raw) return { ...DEFAULT_UPLOAD_TYPES };
    return normalizeUploadTypes(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_UPLOAD_TYPES };
  }
}

export async function saveUploadTypePrefs(types) {
  try {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await AsyncStorage.setItem(UPLOAD_TYPES_KEY, JSON.stringify(normalizeUploadTypes(types)));
  } catch {
    // non-critical
  }
}

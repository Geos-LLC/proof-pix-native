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
export const TEAM_UPLOAD_ENABLED = false;

// Canary allow-list: admin proxy sessionIds whose team members are
// opted in to the team upload pipeline. Add a sessionId here to
// enable it for that admin's whole team.
export const TEAM_UPLOAD_CANARY_SESSION_IDS = [
  'e700f98f528391993f26a7b64a838ffb', // canary 2026-07-22 — internal admin
];

// Slice B: when true, PhotoContext.addPhoto auto-enqueues a team
// upload immediately after capture for team_member accounts that
// already satisfy `isTeamUploadEnabled` (canary or master flag) AND
// whose admin is Google-backed. Photos land on the admin's Drive
// without the team member having to open the Upload sheet.
//
// Defaults to true because auto-sync is the point of team mode: if
// a team_member is on the canary at all, they should get the live
// experience. Guarded downstream by `isTeamUploadEnabled` and
// `getTeamUploadBlockedReason`, so this flag being on with the
// canary flag off is a safe no-op.
export const TEAM_AUTO_SYNC_ENABLED = true;

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
 * the pipeline only knows how to deliver to Google-backed admins
 * today. Dropbox and iCloud admins get a clear "coming soon" from
 * the caller instead of a broken upload.
 *
 * Returns a specific reason string when the team upload is blocked,
 * or null when it can proceed. Callers should treat `null` as
 * "green light, enqueue team upload" and any non-null value as
 * "surface a user-facing message and do NOT enqueue."
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

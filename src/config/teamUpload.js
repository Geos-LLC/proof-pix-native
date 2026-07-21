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
  // 'session_...',
];

/**
 * @param {{ sessionId?: string|null } | null | undefined} teamInfo
 * @returns {boolean}
 */
export function isTeamUploadEnabled(teamInfo) {
  if (TEAM_UPLOAD_ENABLED === true) return true;
  const sessionId = teamInfo?.sessionId;
  if (!sessionId) return false;
  return TEAM_UPLOAD_CANARY_SESSION_IDS.includes(sessionId);
}

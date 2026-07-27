// Central check for "which cloud backends the admin has connected".
// Team-member photo uploads require at least one of these — Google
// Drive, Dropbox, or Service Flow. Apple Sign-In alone is auth only
// (no shared storage backend). iCloud is per-user, not team-capable.
//
// Callers pass the AdminContext snapshot for the Google check
// (isAuthenticated + accountType) because Google connectivity is
// derived from admin state, not a live probe. Dropbox and SF are
// probed via their own service singletons.
//
// Lazy-requires match the pattern used elsewhere (expo-print,
// crashlytics, FixPrompt, proxyService) so an older binary that
// predates any of these adapters won't brick the OTA at bundle load.

export const getConnectedClouds = async ({ isAuthenticated, accountType } = {}) => {
  const results = { google: false, dropbox: false, serviceflow: false };

  // Google Drive — same derivation CloudSyncScreen uses.
  results.google = !!isAuthenticated && accountType === 'google';

  // Dropbox — sync check via the auth service singleton.
  try {
    const dropboxAuthService = require('../services/dropboxAuthService').default;
    results.dropbox = !!dropboxAuthService.isAuthenticated();
  } catch (e) {
    // Adapter missing — treat as not-connected. Not a fatal error.
  }

  // Service Flow — active adapter with a stored workspace means
  // credentials + workspaceId are live. Same probe CloudSyncScreen
  // uses in refreshServiceFlow.
  try {
    const crmService = require('../services/crm').default;
    const adapter = await crmService.getActiveAdapter();
    if (adapter && typeof adapter.getStoredWorkspace === 'function') {
      const stored = await adapter.getStoredWorkspace();
      results.serviceflow = !!stored?.workspaceId;
    }
  } catch (e) {
    // CRM service missing / adapter failed — treat as not-connected.
  }

  return results;
};

export const isAnyCloudConnected = async (adminState) => {
  const c = await getConnectedClouds(adminState);
  return c.google || c.dropbox || c.serviceflow;
};

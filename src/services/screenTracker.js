/**
 * screenTracker
 *
 * Remembers the last "real" screen the user was on before opening a
 * meta screen (Settings, Feedback, BugReport, FeatureRequest). Feedback
 * bug reports read this so the auto-collected `currentScreen` metadata
 * reflects the screen the user was actually experiencing the issue on,
 * not the Settings tree they navigated through to get to the form.
 *
 * Wired from App.js:onStateChange. Reading is cheap and synchronous —
 * fine to call from any render.
 */

const META_ROUTES = new Set([
  'Settings',
  'Feedback',
  'BugReport',
  'FeatureRequest',
  'HelpSupport',
]);

let lastMeaningfulScreen = null;

export function recordRoute(routeName) {
  if (!routeName || typeof routeName !== 'string') return;
  if (META_ROUTES.has(routeName)) return;
  lastMeaningfulScreen = routeName;
}

export function getLastMeaningfulScreen() {
  return lastMeaningfulScreen;
}

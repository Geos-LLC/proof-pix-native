// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] sf-card-team-thumbnail-v48-' + Date.now() + ' — Team-tab SF cards fall back to team latest-photo thumbnail when admin has no local captures (was placeholder icon on SF-primary admins). Paired with proxy fix that populates latestPhotoThumbnail from SF photo_url on every upload. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] sf-card-tz-and-mapzoom-v50-' + Date.now() + ' — SF card time uses workspace TZ (UTC-hour extraction) instead of admin device TZ, so a 9 AM Jacksonville job no longer displays as 5-6 AM for a Pacific admin. Map thumb zoomed out ~20× (latitudeDelta 0.008→0.15) so the marker sits inside a city-level context view. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

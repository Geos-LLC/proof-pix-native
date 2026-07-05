// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] fullscreen-align-' + Date.now() + ' — Studio tap-to-fullscreen now wraps EnlargedPhotoViewer in absoluteFill so it covers full screen (was half-height). Reset button on fullscreen viewer moved to insets.top + 8 so it aligns with the X close button. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

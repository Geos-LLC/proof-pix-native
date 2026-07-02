// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] build86-embedded — v1.7.7 build 86 embedded bundle. Content = bde1342 (paywall v4 baseline) only. Label fix REMOVED — build 85 shipped an unwrapped recursive PhotoLabels + usePhotos combo that crashed on fresh install. This build restores a launchable baseline; label fix returns in a future build after defensive rewrite is tested. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] build85-embedded — v1.7.7 build 85 embedded bundle. Content = bde1342 (paywall v4) + my label fix (PhotoLabels combined-mode source resolution + GalleryScreen native-bake share fix). e13ece9 project-scope cascade layer NOT included in this build. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

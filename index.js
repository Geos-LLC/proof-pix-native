// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-4x2-grid-' + Date.now() + ' — MarkupSheet consolidates the 6 tools + Color + Size into a single 4-column × 2-row grid = 8 tiles total, matching Customize Labels exactly. No section labels. Dismissal behavior unchanged (X → Studio, any other dismiss → MarkupEditor). Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

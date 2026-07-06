// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-enlarge-icon-' + Date.now() + ' — MarkupSheet now has TWO explicit affordances in the header: X (neutral tile, top-left) returns to Studio, ⤢ enlarge (accent-filled tile, top-right) hands off to the full-screen MarkupEditor with the picked tool/color/stroke. Drag-down + tap-outside dismiss normally (no hidden intercept). Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-two-step-' + Date.now() + ' — Markup now opens in two steps: (1) MarkupSheet pops up from the bottom as a formSheet with the same tile design + sizing as Customize Labels (52×52 tiles, TOOL + ADJUST sections). (2) Tapping "Enlarge to mark" hands off to the full-screen MarkupEditor for pinch-zoom + drawing, carrying the picked tool/color/stroke as initial state. Studio Notes>Markup routes to MarkupSheet first. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

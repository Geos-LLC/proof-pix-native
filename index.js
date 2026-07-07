// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-single-4x2-grid-' + Date.now() + ' — MarkupEditor palette is now a SINGLE 4-column × 2-row grid holding all 8 tiles (Draw, Brush, Highlight, Arrow / Measure, Text, Color, Size). Dropped the TOOL / ADJUST section labels that were breaking the layout into two separate grids. Undo / Clear pills below. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

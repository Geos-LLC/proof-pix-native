// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-fullscreen-direct-' + Date.now() + ' — Studio Notes>Markup navigates directly to the full-screen MarkupEditor (previous inline / sheet variants confused users because they could not actually draw on tiny previews). MarkupEditor palette: 8 buttons in a 4x2 grid (Draw, Brush, Highlight, Arrow, Measure, Text, Color, Size). Circle removed. Undo / Clear pills below. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

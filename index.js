// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] report-chip-mode-only-' + Date.now() + ' — Report photo chip now always shows the MODE label (BEFORE / AFTER / PROGRESS / BEFORE & AFTER) — never the raw photo name. Timeline + Sets previews now honor Include Watermark; timestamps already honored Include Metadata. Show Labels toggles the chip on/off. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

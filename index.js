// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] labels-v16 — PhotoLabels combined-mode now resolves source before/after photos (matches Studio/pairResolved) so capture-preview + PhotoSetPreview reflect per-photo position edits. GalleryScreen native-bake share honors source overrides. Try/catch safety net on the new resolve path falls through to legacy inline render on any error. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

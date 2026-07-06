// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-tap-picture-' + Date.now() + ' — MarkupSheet tools now render in a 3-col grid = balanced 2 rows of 3. "Enlarge to mark" button removed; any sheet dismissal (drag-down, tap on the picture behind, Android back) intercepts via beforeRemove and replaces the sheet with the full-screen MarkupEditor, carrying the picked tool/color/stroke. Only the X close top-left returns to Studio without opening the editor. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

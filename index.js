// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-floating-panel-' + Date.now() + ' — Studio Notes>Markup now sets activeTool=markup (was navigating to MarkupSheet route). A floating bottom-sheet-styled panel renders over the Studio toolbar with the 4x2 tile grid (6 tools + Color + Size). Drawing happens on the Studio photo above; swipe + label drag are already suppressed via isMarkupActiveRef. Enlarge icon (accent-yellow, top-right of the panel header) hands off to the full-screen MarkupEditor with the picks. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

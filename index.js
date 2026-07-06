// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-tile-grid-' + Date.now() + ' — Studio Notes>Markup routes back to the full-screen MarkupEditor (over the studio toolbar). MarkupEditor palette rewritten to match the design spec: TOOL section is a 4-column tile grid (icon square + label under), ADJUST section is a Color tile + Size tile that open bottom-sheet modals (ColorGridPicker for Color, stroke slider for Size). Full-width Undo/Clear pill row stays. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

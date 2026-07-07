// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-autosave-fix-' + Date.now() + ' — Same as markup-autosave-labels, but fixes the crash where useCallback was referenced without being imported. MarkupEditor auto-saves on X close + any unmount, and renders PhotoLabels over the canvas when the global showLabels toggle is on. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

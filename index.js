// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-autosave-labels-' + Date.now() + ' — MarkupEditor now auto-saves shapes on X close AND on any other unmount path (hardware back, gesture pop) via useEffect cleanup + persistShapesRef. PhotoLabels overlay added on the canvas (read-only, pointerEvents="none") so labels show while marking when SettingsContext.showLabels is on. Studio already reads photo.markup for the overlay so shapes surface immediately after leaving. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

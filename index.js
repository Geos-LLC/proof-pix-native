// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-inline-first-' + Date.now() + ' — Notes-panel Markup shortcut now sets activeTool=markup instead of navigating away, so the inline MarkupPanel + Studio drawing gestures activate (matches the other tools UX — photo stays visible). Added a "Zoom & mark" secondary button inside MarkupPanel that navigates to the full-screen MarkupEditor for zoom + detailed marking. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

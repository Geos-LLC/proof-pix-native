// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] report-labels-switch-' + Date.now() + ' — Show Labels switch in the report editor now toggles a real label chip on each preview photo (Timeline, Room-by-Room, Sets, Before&After). Chip shows the photo saved name if set, otherwise falls back to the mode label (BEFORE / AFTER / PROGRESS / BEFORE & AFTER). Chip uses the report brand color when set. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

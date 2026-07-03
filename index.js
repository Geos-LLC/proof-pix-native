// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] build88-embedded — v1.7.7 build 88 clean rebuild from HEAD (0d5ef57 bde1342-effective) with --clear-cache + OTA diagnostic buttons in Settings dev section. Purpose: eliminate any dirty-tree ambiguity of build 87 and give us runtime insight into why OTAs silently reject. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

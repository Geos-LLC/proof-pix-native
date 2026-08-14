// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] sf-primary-not-syncing-badge-v45-' + Date.now() + ' — Scarier soft guard on New Project for SF-primary team members ("Save photos on my phone only" vs old "Create anyway"). "Not syncing to admin" red badge on Projects Mine cards + HomeScreen active project pill for any locally-created project on an SF-primary team. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

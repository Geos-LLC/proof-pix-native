// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] report-regen-preserve-photos-' + Date.now() + ' — Regenerating a report after a per-photo edit no longer collapses it to 1 photo. handleGenerateReport now accepts explicit overrides; callers in the preview (Save-on-back and Regenerate button) pass activeReport photoIds/photoCount directly so the async setState does not race. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] team-ghost-cleanup-guard-v44-' + Date.now() + ' — Cold-start SF-ghost cleanup no longer wipes team_member projects (that path deleted every crmJobId project on every launch, orphaning photos). Admin path also switched from delete-row to unlink so photos survive an SF disconnect. Partial-orphan project recovery heals existing damage. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

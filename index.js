// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] team-share-and-sf-upload-v46-' + Date.now() + ' — 3 fixes: (1) "Team Member" plan normalizes to "team" tier so team members bypass share paywall + get every team-plan feature; (2) team_member auto-upload no longer blocked for SF-primary admins (proxy already routes to SF attach); (3) direct crmService.attachPhoto skipped for team_member (was noisy NO_CRM_CONNECTED, proxy path handles SF now). Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

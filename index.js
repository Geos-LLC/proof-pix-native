// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] data-resilience-' + Date.now() + ' — Photos+projects now have backup snapshots (cleaning-photos-metadata-backup + tracked-projects-backup). loadPhotosMetadata/loadProjects restore from backup when primary is empty. save*(empty) writes emit a stack trace for wipe-caller diagnosis. Reset User Data clears backups too. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

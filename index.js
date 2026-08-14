// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] sf-card-map-thumb-v49-' + Date.now() + ' — SF cards on Team tab: 3-line layout (address / customer name / time · count), map thumbnail (locked MapView geocoded from crmJobMeta.address, in-memory cache) replaces the photo thumb, thumb size bumped 72→100, cardNew minHeight 128. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] markup-full-overlays-' + Date.now() + ' — MarkupEditor now renders every StudioEdit overlay over the photo (labels, watermark, brand logo, metadata) via StudioEditOverlays with renderMarkup=false. The canvas frame is aspect-ratio-matched to the photo so overlays align with actual photo pixels instead of the letterbox that resizeMode=contain used to produce. Auto-save on close still active. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

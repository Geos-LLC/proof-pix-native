// Bundle marker — fires as the very first JS line. If you don't see
// this in the log right after `app_open`, the device is loading an
// older OTA (or the embedded bundle). Bump the version each push so
// it's unambiguous which one landed.
console.warn('[BUNDLE] report-use-studio-overlays-' + Date.now() + ' — Report preview no longer draws its own chips. Overlays the shared StudioEditOverlays (PhotoLabels + PhotoWatermark + MetadataOverlay + BrandLogo + PhotoMarkup) on top of every preview photo — same labels, watermark, timestamps the user sees in Studio. Applied to Room-by-Room, Timeline, Sets, Executive, and Before&After combined heroes. Built ' + new Date().toISOString());

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

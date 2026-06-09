// Report engine — layout-driven. The editor talks to this module via
// LAYOUTS / DEFAULT_LAYOUT_ID / generateReport / OPTION_META. Adding a
// new layout is one new file + one registry line; no edits to existing
// layouts. UX layer uses `name` / `description` for human-facing copy.

import roomByRoom from './layouts/roomByRoom.js';
import beforeAfter from './layouts/beforeAfter.js';
import timeline from './layouts/timeline.js';
import gallery from './layouts/gallery.js';
import executiveSummary from './layouts/executiveSummary.js';
import documentation from './layouts/documentation.js';

export const LAYOUTS = [
  roomByRoom,
  beforeAfter,
  timeline,
  gallery,
  executiveSummary,
  documentation,
];

export const DEFAULT_LAYOUT_ID = 'room-by-room';

const BY_ID = new Map(LAYOUTS.map((l) => [l.id, l]));

export const getLayout = (id) =>
  BY_ID.get(id) || BY_ID.get(DEFAULT_LAYOUT_ID);

export const listLayouts = () =>
  LAYOUTS.map(({ id, name, description }) => ({ id, name, description }));

// User-facing copy + control type for every customization option. The
// editor renders only the entries listed in a layout's
// `supportedOptions`; this object is the single source of truth for
// the option's label/description/control. Adding a new option = add
// it here and reference its key in a layout's supportedOptions.
export const OPTION_META = {
  includeNotes: {
    label: 'Include notes',
    description: 'Show photo notes in the report.',
    control: 'switch',
  },
  includeMetadata: {
    label: 'Include metadata',
    description: 'Show timestamps and capture details.',
    control: 'switch',
  },
  includeBranding: {
    label: 'Include branding',
    description: 'Show your logo in the header.',
    control: 'switch',
  },
  includeProgressPhotos: {
    label: 'Include progress photos',
    description: 'Add progress shots between before and after.',
    control: 'switch',
  },
  showLabels: {
    label: 'Show labels',
    description: 'Display each photo’s saved label.',
    control: 'switch',
  },
  galleryColumns: {
    label: 'Columns',
    description: 'Photos per row.',
    control: 'segmented',
    choices: [
      { value: 2, label: '2' },
      { value: 3, label: '3' },
      { value: 4, label: '4' },
    ],
  },
  docShowGps: {
    label: 'Show GPS data',
    description: 'Include location coordinates when available.',
    control: 'switch',
  },
  docShowCaptureTime: {
    label: 'Show capture time',
    description: 'Include the original timestamp on each entry.',
    control: 'switch',
  },
  docShowDeviceMetadata: {
    label: 'Show device metadata',
    description: 'Include dimensions, aspect ratio, and template.',
    control: 'switch',
  },
  includeWatermark: {
    label: 'Include watermark',
    description: 'Overlay your watermark on report photos.',
    control: 'switch',
  },
  timelineColumns: {
    label: 'Photos per row',
    description: 'How many photos appear side-by-side inside one set.',
    control: 'segmented',
    choices: [
      { value: 1, label: '1' },
      { value: 2, label: '2' },
      { value: 3, label: '3' },
    ],
  },
};

// Merge a layout's defaults over an empty object, then patch the
// user's overrides on top. Returns only the option keys this layout
// supports so a layout never reads an option it didn't declare.
export const resolveOptions = (layoutId, userOptions) => {
  const layout = getLayout(layoutId);
  const merged = { ...layout.defaults };
  if (userOptions && typeof userOptions === 'object') {
    for (const key of layout.supportedOptions) {
      if (key in userOptions) merged[key] = userOptions[key];
    }
  }
  return merged;
};

/**
 * Render a report to a self-contained HTML string.
 *
 * @param {object} args
 * @param {object} args.project   { title, location?, generatedAt? }
 * @param {Array}  args.photos    pre-filtered photo records
 * @param {string} args.layoutType  one of LAYOUTS[].id; falls back to DEFAULT
 * @param {object} args.options   raw user options; merged with layout defaults
 * @param {object} args.branding  { logoUri? }
 * @param {object} args.helpers   { fileToDataUri, displayRoomName }
 * @returns {Promise<string>} HTML document
 */
export async function generateReport({
  project,
  photos,
  layoutType,
  options,
  branding,
  helpers,
}) {
  const layout = getLayout(layoutType);
  const resolved = resolveOptions(layout.id, options);
  const filteredPhotos = layout.id === 'room-by-room' && resolved.includeProgressPhotos === false
    ? photos.filter((p) => p.mode !== 'progress')
    : photos;
  return layout.render({
    project,
    photos: filteredPhotos,
    options: resolved,
    branding: branding || {},
    helpers,
  });
}

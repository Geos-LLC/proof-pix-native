// Documentation — insurance, restoration, legal documentation.
// Metadata + notes lead the photo (not the other way around). The
// goal here is auditability: every photo carries a timestamp, a
// section, optional GPS, and any saved note.

import {
  escapeHtml, formatShortStamp, sortByTime,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml, tsOf,
} from './_shared.js';

const css = `
.entry { display: grid; grid-template-columns: 180px 1fr; gap: 14px; margin-bottom: 18px; page-break-inside: avoid; border: 1px solid #E5E5E5; border-radius: 8px; padding: 10px; }
.entry img { width: 100%; display: block; border-radius: 4px; }
.entry .missing { border-radius: 4px; }
.meta-table { font-size: 11px; color: #1A1A1A; }
.meta-table .row { display: grid; grid-template-columns: 90px 1fr; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #ECECEC; }
.meta-table .row:last-child { border-bottom: 0; }
.meta-table .k { color: #666; text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; padding-top: 2px; }
.meta-table .v { color: #1A1A1A; word-break: break-word; }
.entry .photo { display: flex; align-items: flex-start; justify-content: center; }
.entry .note { margin-top: 6px; padding: 6px 8px; background: #FFFBE6; border-left: 3px solid #F2C31B; font-size: 11px; color: #1A1A1A; }
.entry-title { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
`;

// Pull GPS from whatever the photo happens to carry. Photos in this
// codebase don't always have explicit lat/lng (EXIF stays embedded
// in the JPEG, not re-parsed) but some flows do attach `gps` /
// `location` fields. Fall back gracefully so the row just hides.
const gpsString = (p) => {
  if (p?.gps && (p.gps.lat || p.gps.latitude)) {
    const lat = p.gps.lat ?? p.gps.latitude;
    const lng = p.gps.lng ?? p.gps.longitude;
    if (lat != null && lng != null) return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }
  if (typeof p?.location === 'string' && p.location.trim()) return p.location.trim();
  return '';
};

const deviceMetaString = (p) => {
  const parts = [];
  if (p?.originalWidth && p?.originalHeight) parts.push(`${p.originalWidth} × ${p.originalHeight}`);
  if (p?.aspectRatio) parts.push(`${p.aspectRatio}`);
  if (p?.templateType) parts.push(p.templateType);
  return parts.join(' · ');
};

export default {
  id: 'documentation',
  name: 'Documentation',
  description: 'Audit-ready report with metadata and notes.',
  supportedOptions: ['includeNotes', 'includeBranding', 'docShowGps', 'docShowCaptureTime', 'docShowDeviceMetadata', 'showLabels'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    docShowGps: true,
    docShowCaptureTime: true,
    docShowDeviceMetadata: false,
    showLabels: true,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;

    const ordered = sortByTime(photos);

    const entries = await Promise.all(ordered.map(async (p, idx) => {
      const data = await photoToData(p, helpers);
      const room = helpers.displayRoomName(p.room || '');
      const stamp = formatShortStamp(tsOf(p));
      const gps = gpsString(p);
      const dev = deviceMetaString(p);

      const rows = [];
      if (options.showLabels !== false && p?.name) {
        rows.push(['Label', escapeHtml(p.name)]);
      }
      rows.push(['Section', escapeHtml(room)]);
      if (options.docShowCaptureTime !== false && stamp) {
        rows.push(['Captured', escapeHtml(stamp)]);
      }
      rows.push(['Mode', escapeHtml(p.mode || '—')]);
      if (options.docShowGps !== false && gps) {
        rows.push(['Location', escapeHtml(gps)]);
      }
      if (options.docShowDeviceMetadata && dev) {
        rows.push(['Capture', escapeHtml(dev)]);
      }

      const tableHtml = rows
        .map(([k, v]) => `<div class="row"><div class="k">${k}</div><div class="v">${v}</div></div>`)
        .join('');

      return `
        <div class="entry">
          <div class="photo">
            ${photoImgHtml({ data, photo: p })}
          </div>
          <div>
            <div class="entry-title">Entry ${idx + 1}</div>
            <div class="meta-table">${tableHtml}</div>
            ${noteHtml({ photo: p, options })}
          </div>
        </div>
      `;
    }));

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `Documentation report &middot; ${photos.length} entr${photos.length === 1 ? 'y' : 'ies'}`,
        logoData,
        companyName,
        brandColor,
      })}
      ${entries.join('')}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

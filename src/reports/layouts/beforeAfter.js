// Before & After Comparison — large side-by-side pairs optimized for
// client sharing. When the user already has a "combined" photo (the
// pre-merged before/after composite produced by the camera flow) we
// surface that as the single hero image for the set instead of
// re-pairing the original two — the combined is already the polished
// proof shot the user crafted.

import {
  escapeHtml, formatLongDate, sortByTime, groupByRoom,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml,
} from './_shared.js';

const css = `
.section { margin-bottom: 32px; }
.section-title { font-size: 18px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: stretch; }
.pair .slot { border-radius: 10px; overflow: hidden; background: #000; }
.combined { border-radius: 10px; overflow: hidden; background: #000; }
.meta-strip { margin-top: 6px; font-size: 11px; color: #555; }
.section-notes { margin-top: 8px; }
`;

export default {
  id: 'before-after',
  name: 'Before & After',
  description: 'Side-by-side comparison, ideal for sharing.',
  supportedOptions: ['includeNotes', 'includeBranding', 'showLabels'],
  defaults: {
    includeNotes: false,
    includeBranding: true,
    showLabels: false,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;

    const groups = groupByRoom(photos);
    const sections = [];

    for (const { room, photos: roomPhotos } of groups) {
      // ONLY combined photos. The Before & After report is meant to
      // surface the polished side-by-side shots the user crafted in
      // the camera flow ('mix' mode = PHOTO_MODES.COMBINED). We do
      // not synthesize fresh pairs from the raw before/after photos
      // — sets without a combined are intentionally skipped here.
      const combinedPhotos = sortByTime(
        roomPhotos.filter((p) => p.mode === 'mix'),
      );
      if (combinedPhotos.length === 0) continue;

      const combinedChunks = await Promise.all(
        combinedPhotos.map(async (c) => {
          const data = await photoToData(c, helpers);
          const labelLine = options.showLabels && c?.name
            ? `<div class="meta-strip"><strong>${escapeHtml(c.name)}</strong></div>`
            : '';
          const note = noteHtml({ photo: c, options });
          return `
            <div class="no-break" style="margin-bottom: 18px;">
              <div class="combined">
                ${photoImgHtml({ data, photo: c })}
              </div>
              ${labelLine}
              ${note ? `<div class="section-notes">${note}</div>` : ''}
            </div>`;
        }),
      );

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${combinedChunks.join('')}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `${formatLongDate(project.generatedAt || Date.now())} &middot; ${sections.length} section${sections.length === 1 ? '' : 's'}`,
        logoData,
        companyName,
        brandColor,
      })}
      ${sections.length > 0 ? sections.join('') : `<div class="missing">No combined before/after photos in this report. Create one from the camera or photo editor first.</div>`}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

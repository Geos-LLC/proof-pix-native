// Room-by-Room — default layout. Best for cleaners, contractors,
// Airbnb hosts. Per section: first BEFORE on the left, latest AFTER
// on the right. Progress photos skipped unless `includeProgressPhotos`
// is on; notes appear under the section.

import {
  escapeHtml, formatLongDate, sortByTime, groupByRoom, splitByMode,
  htmlDocument, headerHtml, footerHtml, photoToData, photoCaption,
  noteHtml, labelHtml,
} from './_shared.js';

const css = `
.section { margin-bottom: 28px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair .slot { border: 1px solid #E5E5E5; border-radius: 8px; overflow: hidden; }
.pair .slot img { width: 100%; display: block; }
.pair .label { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #888; padding: 6px 10px 0; }
.pair .meta { padding: 4px 10px 10px; }
.progress { margin-top: 10px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.progress .slot { border: 1px solid #EEE; border-radius: 6px; overflow: hidden; }
.progress .slot img { width: 100%; display: block; }
.progress .slot .meta { padding: 4px 8px 8px; font-size: 10px; color: #666; }
.section-notes { margin-top: 10px; padding: 10px 12px; background: #FAFAFA; border-left: 3px solid #F2C31B; }
`;

export default {
  id: 'room-by-room',
  name: 'Room-by-Room',
  description: 'Best for cleaning and contractor reports.',
  supportedOptions: ['includeNotes', 'includeBranding', 'includeProgressPhotos', 'showLabels'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    includeProgressPhotos: false,
    showLabels: true,
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
      const { before, after, progress } = splitByMode(roomPhotos);
      const firstBefore = sortByTime(before)[0] || null;
      const latestAfter = sortByTime(after).slice(-1)[0] || null;

      // Nothing meaningful for this room — render any standalone shots
      // we have so the section isn't silently dropped.
      if (!firstBefore && !latestAfter && progress.length === 0) continue;

      const [bData, aData] = await Promise.all([
        firstBefore ? photoToData(firstBefore, helpers) : null,
        latestAfter ? photoToData(latestAfter, helpers) : null,
      ]);

      const slot = (label, data, photo) => `
        <div class="slot">
          <div class="label">${escapeHtml(label)}</div>
          ${data ? `<img src="${data}" alt="" />` : `<div class="missing">No ${escapeHtml(label.toLowerCase())} photo</div>`}
          <div class="meta">
            ${photo ? labelHtml({ photo, options }) : ''}
            <div class="caption">${photo ? photoCaption({ photo, helpers, options }) : ''}</div>
            ${photo ? noteHtml({ photo, options }) : ''}
          </div>
        </div>`;

      let progressHtml = '';
      if (options.includeProgressPhotos && progress.length > 0) {
        const chunks = await Promise.all(
          sortByTime(progress).map(async (p) => {
            const d = await photoToData(p, helpers);
            return `<div class="slot">
              ${d ? `<img src="${d}" alt="" />` : `<div class="missing">Image unavailable</div>`}
              <div class="meta">${photoCaption({ photo: p, helpers, options })}</div>
            </div>`;
          }),
        );
        progressHtml = `<div class="progress">${chunks.join('')}</div>`;
      }

      sections.push(`
        <section class="section no-break">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          <div class="pair">
            ${slot('Before', bData, firstBefore)}
            ${slot('After', aData, latestAfter)}
          </div>
          ${progressHtml}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `${formatLongDate(project.generatedAt || Date.now())} &middot; ${photos.length} photo${photos.length === 1 ? '' : 's'}`,
        logoData,
        companyName,
        brandColor,
      })}
      ${sections.join('')}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body });
  },
};

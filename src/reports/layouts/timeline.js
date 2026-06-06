// Timeline — multi-stage projects. Per section: chronological order
// from before → progress shots → after, with date stamps between
// stages so the reader can follow the job over time.

import {
  escapeHtml, formatShortStamp, sortByTime, groupByRoom,
  htmlDocument, headerHtml, footerHtml, photoToData,
  noteHtml, labelHtml, tsOf,
} from './_shared.js';

const css = `
.section { margin-bottom: 30px; }
.stage { display: grid; grid-template-columns: 110px 1fr; gap: 14px; margin-bottom: 14px; align-items: start; }
.stage .when { font-size: 11px; color: #555; padding-top: 6px; border-right: 2px solid #F2C31B; padding-right: 10px; min-height: 60px; }
.stage .tag { display: inline-block; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-top: 4px; }
.stage .card { border: 1px solid #EEE; border-radius: 8px; overflow: hidden; }
.stage .card img { width: 100%; display: block; }
.stage .card .meta { padding: 6px 10px 10px; }
`;

const STAGE_LABEL = {
  before: 'Before',
  progress: 'Progress',
  after: 'After',
  mix: 'Combined',
};

export default {
  id: 'timeline',
  name: 'Timeline',
  description: 'Chronological view of multi-stage work.',
  supportedOptions: ['includeNotes', 'includeBranding', 'showLabels'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    showLabels: true,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;

    const groups = groupByRoom(photos);
    const sections = [];

    for (const { room, photos: roomPhotos } of groups) {
      // Timeline always uses ALL provided photos for the section,
      // sorted by capture time. Progress photos are first-class here
      // (unlike Room-by-Room), so there's no progress toggle.
      const ordered = sortByTime(roomPhotos);
      if (ordered.length === 0) continue;

      const stages = await Promise.all(ordered.map(async (p) => {
        const data = await photoToData(p, helpers);
        const stamp = formatShortStamp(tsOf(p));
        const tag = STAGE_LABEL[p.mode] || 'Photo';
        return `
          <div class="stage no-break">
            <div class="when">
              ${escapeHtml(stamp)}
              <div class="tag">${escapeHtml(tag)}</div>
            </div>
            <div class="card">
              ${data ? `<img src="${data}" alt="" />` : `<div class="missing">Image unavailable</div>`}
              <div class="meta">
                ${labelHtml({ photo: p, options })}
                ${noteHtml({ photo: p, options })}
              </div>
            </div>
          </div>`;
      }));

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${stages.join('')}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `Timeline &middot; ${photos.length} stage${photos.length === 1 ? '' : 's'}`,
        logoData,
      })}
      ${sections.join('')}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body });
  },
};

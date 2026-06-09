// Timeline — multi-stage projects in pure chronological order. Per
// section: every photo (before / progress / after) on its own row,
// timestamp on the left, photo on the right. No grouping into sets —
// reach for the Sets layout when that's what you need.

import {
  escapeHtml, formatShortStamp, sortByTime, groupByRoom,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml, labelHtml, tsOf,
} from './_shared.js';

const css = `
.section { margin-bottom: 30px; }
.stage { display: grid; grid-template-columns: 110px 1fr; gap: 14px; margin-bottom: 14px; align-items: start; }
.stage .when { font-size: 11px; color: #555; padding-top: 6px; border-right: 2px solid var(--brand-color, #F2C31B); padding-right: 10px; min-height: 60px; }
.stage .tag { display: inline-block; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-top: 4px; }
.stage .card { border: 1px solid #EEE; border-radius: 8px; overflow: hidden; }
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
  supportedOptions: ['includeNotes', 'includeBranding', 'includeMetadata', 'includeWatermark', 'showLabels'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    includeMetadata: false,
    includeWatermark: false,
    showLabels: true,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;
    const watermarkText = options.includeWatermark ? (branding?.watermarkText || '') : '';
    const showTimestamp = options.includeMetadata === true;

    const groups = groupByRoom(photos);
    const sections = [];

    for (const { room, photos: roomPhotos } of groups) {
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
              ${photoImgHtml({ data, photo: p, watermarkText, showTimestamp })}
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
        companyName,
        brandColor,
      })}
      ${sections.join('')}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

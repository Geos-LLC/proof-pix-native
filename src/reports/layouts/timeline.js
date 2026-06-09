// Timeline — multi-stage projects in pure chronological order. Per
// section: every photo (before / progress / after) gets its own card
// with the timestamp + stage tag stamped on top. timelineColumns
// controls how many cards sit side-by-side per row (1, 2, or 3).
// For set-based grouping (one before → progress → after), use Sets.

import {
  escapeHtml, formatShortStamp, sortByTime, groupByRoom,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml, labelHtml, tsOf,
} from './_shared.js';

const css = `
.section { margin-bottom: 30px; }
.timeline-grid { display: grid; gap: 12px; }
.timeline-grid .stage { border: 1px solid #EEE; border-radius: 8px; overflow: hidden; page-break-inside: avoid; }
.timeline-grid .stage .when { padding: 6px 10px; font-size: 11px; color: #555; border-bottom: 2px solid var(--brand-color, #F2C31B); display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.timeline-grid .stage .when .tag { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #888; font-weight: 700; }
.timeline-grid .stage .meta { padding: 6px 10px 10px; }
`;

const STAGE_LABEL = {
  before: 'Before',
  progress: 'Progress',
  after: 'After',
  mix: 'Combined',
};

const clampCols = (n) => {
  const v = Number(n);
  if (v === 1 || v === 2 || v === 3) return v;
  return 1;
};

export default {
  id: 'timeline',
  name: 'Timeline',
  description: 'Chronological view of multi-stage work.',
  supportedOptions: ['includeNotes', 'includeBranding', 'includeMetadata', 'includeWatermark', 'showLabels', 'timelineColumns'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    includeMetadata: false,
    includeWatermark: false,
    showLabels: true,
    timelineColumns: 1,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;
    const cols = clampCols(options.timelineColumns);
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
          <div class="stage">
            <div class="when">
              <span>${escapeHtml(stamp)}</span>
              <span class="tag">${escapeHtml(tag)}</span>
            </div>
            ${photoImgHtml({ data, photo: p, watermarkText, showTimestamp })}
            <div class="meta">
              ${labelHtml({ photo: p, options })}
              ${noteHtml({ photo: p, options })}
            </div>
          </div>`;
      }));

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          <div class="timeline-grid" style="grid-template-columns: repeat(${cols}, 1fr);">
            ${stages.join('')}
          </div>
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

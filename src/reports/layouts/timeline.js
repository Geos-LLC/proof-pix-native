// Timeline — multi-stage projects rendered set-by-set. Within each
// room/section, photos are grouped into sets (one before, the progress
// shots between it and its after, then the after). A set renders as a
// stamped header row + an N-column photo grid (timelineColumns). Each
// photo carries its BEFORE/AFTER/PROGRESS chip and, when the report
// options request them, a timestamp overlay and the user's watermark.

import {
  escapeHtml, formatShortStamp, sortByTime, groupByRoom, groupBySet,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml, labelHtml, tsOf,
} from './_shared.js';

const css = `
.section { margin-bottom: 30px; }
.timeline-set { margin-bottom: 22px; padding-left: 14px; border-left: 2px solid var(--brand-color, #F2C31B); }
.timeline-set .set-header { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 6px; }
.timeline-set .set-stamp { font-size: 11px; color: #555; margin-bottom: 8px; }
.timeline-set .set-grid { display: grid; gap: 10px; }
.timeline-set .photo-card { border: 1px solid #EEE; border-radius: 8px; overflow: hidden; }
.timeline-set .photo-card .meta { padding: 6px 10px 10px; }
`;

const clampCols = (n) => {
  const v = Number(n);
  if (v === 1 || v === 2 || v === 3) return v;
  return 2;
};

const setRangeStamp = (set) => {
  const photos = [
    set.before, ...set.progress, set.after, set.mix,
  ].filter(Boolean);
  if (photos.length === 0) return '';
  const ts = photos.map(tsOf).filter((t) => t > 0);
  if (ts.length === 0) return '';
  const first = formatShortStamp(Math.min(...ts));
  const last = formatShortStamp(Math.max(...ts));
  return first === last ? first : `${first} → ${last}`;
};

export default {
  id: 'timeline',
  name: 'Timeline',
  description: 'Set-by-set: before → progress → after, with stamps.',
  supportedOptions: ['includeNotes', 'includeBranding', 'includeMetadata', 'includeWatermark', 'showLabels', 'timelineColumns'],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    includeMetadata: false,
    includeWatermark: false,
    showLabels: true,
    timelineColumns: 2,
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
      const sets = groupBySet(roomPhotos);
      if (sets.length === 0) continue;

      const setChunks = await Promise.all(sets.map(async (set, idx) => {
        // Preserve before → progress → after order inside the set.
        const setPhotos = [
          ...(set.before ? [set.before] : []),
          ...sortByTime(set.progress || []),
          ...(set.after ? [set.after] : []),
          ...(set.mix ? [set.mix] : []),
        ];
        if (setPhotos.length === 0) return '';

        const cards = await Promise.all(setPhotos.map(async (p) => {
          const data = await photoToData(p, helpers);
          return `
            <div class="photo-card no-break">
              ${photoImgHtml({ data, photo: p, watermarkText, showTimestamp })}
              <div class="meta">
                ${labelHtml({ photo: p, options })}
                ${noteHtml({ photo: p, options })}
              </div>
            </div>`;
        }));

        const stamp = setRangeStamp(set);
        return `
          <div class="timeline-set no-break">
            <div class="set-header">Set ${idx + 1}</div>
            ${stamp ? `<div class="set-stamp">${escapeHtml(stamp)}</div>` : ''}
            <div class="set-grid" style="grid-template-columns: repeat(${cols}, 1fr);">
              ${cards.join('')}
            </div>
          </div>`;
      }));

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${setChunks.join('')}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `Timeline &middot; ${photos.length} photo${photos.length === 1 ? '' : 's'}`,
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

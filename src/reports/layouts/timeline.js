// Timeline — mirrors the in-app Timeline tab. Photos split into day
// sections (newest day first), then by room within each day, then by
// capture time within each room. Each photo card carries its own
// timestamp + stage tag header. timelineColumns controls how many
// cards sit side-by-side per row.

import {
  escapeHtml, formatLongDate, formatShortStamp, sortByTime,
  groupByDateThenRoom,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml, labelHtml, tsOf,
} from './_shared.js';

const css = `
.day { margin-bottom: 28px; }
.day-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid var(--brand-color, #F2C31B); }
.day-header .date { font-size: 16px; font-weight: 700; color: #1A1A1A; }
.day-header .count { font-size: 11px; color: #888; }
.room-block { margin-bottom: 18px; padding-left: 12px; border-left: 1px solid #ECECEC; }
.room-block .room-name { font-size: 12px; font-weight: 600; color: #555; margin-bottom: 8px; letter-spacing: 0.04em; text-transform: uppercase; }
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
  description: 'Day-by-day timeline grouped by room.',
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
    const showTimestamp = options.includeMetadata === true;

    const days = groupByDateThenRoom(photos);
    const sections = [];

    for (const day of days) {
      const dayLabel = formatLongDate(day.ts);

      const roomBlocks = await Promise.all(day.rooms.map(async (r) => {
        const ordered = sortByTime(r.photos);
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
              ${photoImgHtml({ data, photo: p, showTimestamp })}
              <div class="meta">
                ${labelHtml({ photo: p, options })}
                ${noteHtml({ photo: p, options })}
              </div>
            </div>`;
        }));
        return `
          <div class="room-block">
            <div class="room-name">${escapeHtml(helpers.displayRoomName(r.room))}</div>
            <div class="timeline-grid" style="grid-template-columns: repeat(${cols}, 1fr);">
              ${stages.join('')}
            </div>
          </div>`;
      }));

      const total = day.rooms.reduce((acc, r) => acc + r.photos.length, 0);
      sections.push(`
        <section class="day">
          <div class="day-header">
            <div class="date">${escapeHtml(dayLabel)}</div>
            <div class="count">${total} photo${total === 1 ? '' : 's'}</div>
          </div>
          ${roomBlocks.join('')}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `Timeline &middot; ${photos.length} photo${photos.length === 1 ? '' : 's'} &middot; ${days.length} day${days.length === 1 ? '' : 's'}`,
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

// Executive Summary — professional client report. A cover photo +
// auto-generated stats block (sections, photo count, date), one or
// two representative before/after examples per section, then the
// full gallery at the end.

import {
  escapeHtml, formatLongDate, sortByTime, groupByRoom, pairBeforeAfter, splitByMode,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  noteHtml,
} from './_shared.js';

const css = `
.cover { margin: 0 0 18px; border-radius: 12px; overflow: hidden; max-height: 360px; }
.cover img { width: 100%; display: block; max-height: 360px; object-fit: cover; }
.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; }
.summary .stat { background: #FAFAFA; border-radius: 8px; padding: 12px; text-align: center; }
.summary .num { font-size: 22px; font-weight: 700; color: #1A1A1A; }
.summary .lbl { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin-top: 4px; }
.highlight { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.highlight .slot { border-radius: 10px; overflow: hidden; background: #000; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.tile { border-radius: 6px; overflow: hidden; }
.location-line { font-size: 12px; color: #555; margin-top: 2px; }
`;

// Pick the best "cover" candidate: latest AFTER if any, otherwise
// latest photo overall. Keeps things meaningful even when a project
// only has before shots so far.
const pickCover = (photos) => {
  const sorted = sortByTime(photos);
  const afters = sorted.filter((p) => p.mode === 'after');
  return afters.slice(-1)[0] || sorted.slice(-1)[0] || null;
};

export default {
  id: 'executive-summary',
  name: 'Executive Summary',
  description: 'Polished client report with highlights and stats.',
  supportedOptions: ['includeNotes', 'includeBranding'],
  defaults: {
    includeNotes: false,
    includeBranding: true,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;

    const cover = pickCover(photos);
    const coverData = cover ? await photoToData(cover, helpers) : null;

    const groups = groupByRoom(photos);
    const sectionCount = groups.length;
    const completedTs = sortByTime(photos).slice(-1)[0];
    const completedLabel = formatLongDate(completedTs ? (completedTs.timestamp || Date.now()) : Date.now());

    // One representative before/after per section. Falls back to the
    // first available photo if no pair exists in that room.
    const highlights = [];
    for (const { room, photos: roomPhotos } of groups) {
      const { pairs } = pairBeforeAfter(roomPhotos);
      const pair = pairs[0];
      if (pair) {
        const [bd, ad] = await Promise.all([
          photoToData(pair.before, helpers),
          photoToData(pair.after, helpers),
        ]);
        highlights.push(`
          <div class="no-break" style="margin-bottom: 14px;">
            <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
            <div class="highlight">
              <div class="slot">
                ${photoImgHtml({ data: bd, photo: pair.before })}
              </div>
              <div class="slot">
                ${photoImgHtml({ data: ad, photo: pair.after })}
              </div>
            </div>
            ${noteHtml({ photo: pair.after, options })}
          </div>
        `);
      } else {
        const { before, after, progress } = splitByMode(roomPhotos);
        const fallback = (after[0] || before[0] || progress[0]);
        if (!fallback) continue;
        const data = await photoToData(fallback, helpers);
        highlights.push(`
          <div class="no-break" style="margin-bottom: 14px;">
            <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
            <div class="highlight">
              <div class="slot" style="grid-column: 1 / span 2;">
                ${photoImgHtml({ data, photo: fallback })}
              </div>
            </div>
            ${noteHtml({ photo: fallback, options })}
          </div>
        `);
      }
    }

    // Full gallery at the end — small thumbnails, no captions, so the
    // reader gets a "all the proof" appendix without competing with
    // the highlights.
    const galleryTiles = await Promise.all(
      sortByTime(photos).map(async (p) => {
        const data = await photoToData(p, helpers);
        return `<div class="tile">${photoImgHtml({ data, photo: p })}</div>`;
      }),
    );

    const locationLine = project.location
      ? `<div class="location-line">${escapeHtml(project.location)}</div>`
      : '';

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `Executive Summary &middot; ${formatLongDate(project.generatedAt || Date.now())}`,
        logoData,
        companyName,
        brandColor,
      })}
      ${locationLine}
      ${coverData ? `<div class="cover"><img src="${coverData}" alt="" /></div>` : ''}
      <div class="summary">
        <div class="stat"><div class="num">${sectionCount}</div><div class="lbl">Section${sectionCount === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="num">${photos.length}</div><div class="lbl">Photos</div></div>
        <div class="stat"><div class="num" style="font-size:14px; padding-top:4px;">${escapeHtml(completedLabel)}</div><div class="lbl">Completed</div></div>
      </div>
      <div class="section-title">Highlights</div>
      ${highlights.join('')}
      <div class="section-title">Full gallery</div>
      <div class="grid">${galleryTiles.join('')}</div>
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

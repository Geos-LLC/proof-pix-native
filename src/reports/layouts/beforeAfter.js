// Before & After Comparison — large side-by-side pairs optimized for
// client sharing. When the user already has a "combined" photo (the
// pre-merged before/after composite produced by the camera flow) we
// surface that as the single hero image for the set instead of
// re-pairing the original two — the combined is already the polished
// proof shot the user crafted.

import {
  escapeHtml, formatLongDate, sortByTime, groupByRoom, pairBeforeAfter,
  htmlDocument, headerHtml, footerHtml, photoToData,
  noteHtml,
} from './_shared.js';

const css = `
.section { margin-bottom: 32px; }
.section-title { font-size: 18px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: stretch; }
.pair .slot { border-radius: 10px; overflow: hidden; background: #000; }
.pair .slot img { width: 100%; display: block; }
.pair .slot .tag { position: relative; top: -28px; left: 10px; display: inline-block; padding: 4px 10px; background: rgba(0,0,0,0.55); color: #fff; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 4px; margin-bottom: -28px; }
.combined { border-radius: 10px; overflow: hidden; background: #000; }
.combined img { width: 100%; display: block; }
.combined .tag { position: relative; top: -28px; left: 10px; display: inline-block; padding: 4px 10px; background: rgba(0,0,0,0.55); color: #fff; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 4px; margin-bottom: -28px; }
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
      // Combined photos for this room. PHOTO_MODES.COMBINED uses the
      // string 'mix' (see src/constants/rooms.js). Each combined has a
      // `beforePhotoId` linking back to its before — we use that to
      // skip re-pairing those befores below.
      const combinedPhotos = sortByTime(
        roomPhotos.filter((p) => p.mode === 'mix'),
      );
      const coveredBeforeIds = new Set(
        combinedPhotos.map((c) => c.beforePhotoId).filter(Boolean),
      );

      // Render combined photos first — one hero image per set.
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
                ${data ? `<img src="${data}" alt="" />` : `<div class="missing">Image unavailable</div>`}
                <span class="tag">Before &amp; After</span>
              </div>
              ${labelLine}
              ${note ? `<div class="section-notes">${note}</div>` : ''}
            </div>`;
        }),
      );

      // For befores that DON'T already have a combined, fall back to
      // the original side-by-side pair so we don't drop them.
      const remainingPhotos = roomPhotos.filter((p) => {
        if (p.mode === 'mix') return false;
        if (p.mode === 'before' && coveredBeforeIds.has(p.id)) return false;
        if (p.mode === 'after' && p.beforePhotoId && coveredBeforeIds.has(p.beforePhotoId)) return false;
        return true;
      });
      const { pairs } = pairBeforeAfter(remainingPhotos);

      const pairChunks = await Promise.all(
        pairs.map(async ({ before, after }) => {
          const [bd, ad] = await Promise.all([
            photoToData(before, helpers),
            photoToData(after, helpers),
          ]);
          const labelLine = options.showLabels
            ? `<div class="meta-strip">${[
                before?.name ? `Before: <strong>${escapeHtml(before.name)}</strong>` : '',
                after?.name ? `After: <strong>${escapeHtml(after.name)}</strong>` : '',
              ].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>`
            : '';
          const noteLine = [
            noteHtml({ photo: before, options }),
            noteHtml({ photo: after, options }),
          ].filter(Boolean).join('');
          return `
            <div class="no-break" style="margin-bottom: 18px;">
              <div class="pair">
                <div class="slot">
                  ${bd ? `<img src="${bd}" alt="" />` : `<div class="missing">No before</div>`}
                  <span class="tag">Before</span>
                </div>
                <div class="slot">
                  ${ad ? `<img src="${ad}" alt="" />` : `<div class="missing">No after</div>`}
                  <span class="tag">After</span>
                </div>
              </div>
              ${labelLine}
              ${noteLine ? `<div class="section-notes">${noteLine}</div>` : ''}
            </div>`;
        }),
      );

      if (combinedChunks.length === 0 && pairChunks.length === 0) continue;

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${combinedChunks.join('')}
          ${pairChunks.join('')}
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
      ${sections.length > 0 ? sections.join('') : `<div class="missing">No matched before/after pairs in this report.</div>`}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

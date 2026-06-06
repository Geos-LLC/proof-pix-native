// Before & After Comparison — large side-by-side pairs optimized for
// client sharing. One pair per row, minimal metadata, progress photos
// are intentionally skipped (this layout is about the transformation
// proof, not the journey).

import {
  escapeHtml, formatLongDate, groupByRoom, pairBeforeAfter,
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

    const groups = groupByRoom(photos);
    const sections = [];

    for (const { room, photos: roomPhotos } of groups) {
      const { pairs } = pairBeforeAfter(roomPhotos);
      if (pairs.length === 0) continue;

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

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${pairChunks.join('')}
        </section>
      `);
    }

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `${formatLongDate(project.generatedAt || Date.now())} &middot; ${sections.length} section${sections.length === 1 ? '' : 's'}`,
        logoData,
      })}
      ${sections.length > 0 ? sections.join('') : `<div class="missing">No matched before/after pairs in this report.</div>`}
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css, body });
  },
};

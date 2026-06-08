// Gallery — large photo collections in a 2 / 3 / 4 column grid.
// Optional captions, minimal text. Defaults to 3 columns.

import {
  formatLongDate, sortByTime,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml,
  photoCaption,
} from './_shared.js';

const css = (cols) => `
.grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 8px; }
.tile { border: 1px solid #EEE; border-radius: 6px; overflow: hidden; }
.tile img { width: 100%; display: block; }
.tile .cap { padding: 4px 8px 8px; font-size: 10px; color: #555; }
`;

const clampCols = (n) => {
  const v = Number(n);
  if (v === 2 || v === 3 || v === 4) return v;
  return 3;
};

export default {
  id: 'gallery',
  name: 'Gallery',
  description: 'Clean photo grid for large collections.',
  supportedOptions: ['includeBranding', 'showLabels', 'galleryColumns'],
  defaults: {
    includeBranding: true,
    showLabels: false,
    galleryColumns: 3,
  },

  async render({ project, photos, options, branding, helpers }) {
    const cols = clampCols(options.galleryColumns);
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;

    const tiles = await Promise.all(
      sortByTime(photos).map(async (p) => {
        const data = await photoToData(p, helpers);
        const caption = options.showLabels
          ? photoCaption({ photo: p, helpers, options })
          : '';
        return `
          <div class="tile no-break">
            ${photoImgHtml({ data, photo: p })}
            ${caption ? `<div class="cap">${caption}</div>` : ''}
          </div>`;
      }),
    );

    const body = `
      ${headerHtml({
        title: project.title,
        subtitle: `${formatLongDate(project.generatedAt || Date.now())} &middot; ${photos.length} photo${photos.length === 1 ? '' : 's'}`,
        logoData,
        companyName,
        brandColor,
      })}
      <div class="grid">${tiles.join('')}</div>
      ${footerHtml()}
    `;
    return htmlDocument({ title: project.title, css: css(cols), body, brandColor });
  },
};

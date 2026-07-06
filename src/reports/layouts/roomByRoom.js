// Room-by-Room — default layout. Per room → one card per capture set.
// Inside each set, in order:
//   1. Combined "Before & After" hero (full width) when one exists
//   2. Before photo (full width)
//   3. After photo (full width)
//   4. A single "Progress" header followed by small progress thumbs
// When `showLabels` ("Include overlays") is on, each big photo carries
// its mode label (Before / After / Before & After) plus watermark and
// timestamp overlays; header logo honors `includeBranding`.
// Progress photos share a single "Progress" line header instead of
// per-thumb labels since the tiles are too small for individual chips.

import {
  escapeHtml, formatLongDate, sortByTime, groupByRoom, groupBySet,
  htmlDocument, headerHtml, footerHtml, photoToData, photoImgHtml, photoCaption,
  noteHtml,
} from './_shared.js';

const css = `
.section { margin-bottom: 32px; }
.set { margin-bottom: 24px; }
.set:last-child { margin-bottom: 0; }
.set-photo { margin-bottom: 14px; page-break-inside: avoid; }
.set-photo:last-child { margin-bottom: 0; }
.role-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 6px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair .col { display: flex; flex-direction: column; }
.single { border: 1px solid #E5E5E5; border-radius: 8px; overflow: hidden; }
.single .meta { padding: 6px 10px 10px; font-size: 11px; color: #555; }
.hero { border: 1px solid #E5E5E5; border-radius: 8px; overflow: hidden; }
.hero .meta { padding: 6px 10px 10px; font-size: 11px; color: #555; }
.progress-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.progress-tiles .tile { border: 1px solid #EEE; border-radius: 6px; overflow: hidden; }
.progress-tiles .tile img { width: 100%; display: block; }
`;

// Look up the source-before id encoded in a combined photo so the
// combined can be attached to the same set as the before/after pair
// the user captured. Mirrors GlobalBackgroundChromeBaker's
// resolveSourcePair (id-prefix → beforePhotoId fallback).
const combinedToBeforeId = (combined) => {
  if (!combined) return null;
  const idStr = String(combined.id || '');
  if (idStr.startsWith('combined_')) return idStr.slice('combined_'.length);
  if (combined.beforePhotoId) return String(combined.beforePhotoId);
  return null;
};

export default {
  id: 'room-by-room',
  name: 'Room-by-Room',
  description: 'Best for cleaning and contractor reports.',
  supportedOptions: [
    'includeNotes',
    'includeBranding',
    'includeProgressPhotos',
    'showLabels',
  ],
  defaults: {
    includeNotes: true,
    includeBranding: true,
    includeProgressPhotos: true,
    showLabels: true,
  },

  async render({ project, photos, options, branding, helpers }) {
    const showBranding = options.includeBranding !== false;
    const logoData = showBranding && branding?.logoUri
      ? await helpers.fileToDataUri(branding.logoUri, 'image/png')
      : null;
    const companyName = showBranding ? (branding?.companyName || '') : '';
    const brandColor = branding?.brandColor || null;
    // Single "Include overlays" gate — when off, no per-photo overlays
    // (labels, watermark, timestamp) render. When on, each still honors
    // its individual config from LabelsLanguage (watermark text etc.).
    const showLabels = options.showLabels !== false;
    const showTimestamp = showLabels;
    const watermarkText = showLabels ? (branding?.watermarkText || '') : '';

    const roleLabel = (text) =>
      showLabels ? `<div class="role-label">${escapeHtml(text)}</div>` : '';

    const fullSlot = (data, photo, role, { cssClass = 'single' } = {}) => `
      <div class="set-photo">
        ${roleLabel(role)}
        <div class="${cssClass}">
          ${photoImgHtml({ data, photo, showTimestamp, watermarkText })}
          <div class="meta">
            <div class="caption">${photoCaption({ photo, helpers, options })}</div>
            ${noteHtml({ photo, options })}
          </div>
        </div>
      </div>`;

    // Half-width slot used for Before / After side-by-side on one row.
    // Same label + caption + note shape as fullSlot, just rendered
    // inside a grid column.
    const halfSlot = (data, photo, role) => `
      <div class="col">
        ${roleLabel(role)}
        <div class="single">
          ${photoImgHtml({ data, photo, showTimestamp, watermarkText })}
          <div class="meta">
            <div class="caption">${photoCaption({ photo, helpers, options })}</div>
            ${noteHtml({ photo, options })}
          </div>
        </div>
      </div>`;

    const groups = groupByRoom(photos);
    const sections = [];

    for (const { room, photos: roomPhotos } of groups) {
      // Build sets from before/after/progress photos, then attach the
      // matching combined ('mix') photo to each set so it can render
      // as the set's hero.
      const rawSets = groupBySet(roomPhotos);
      const beforeIdToSet = new Map();
      for (const s of rawSets) if (s.before) beforeIdToSet.set(String(s.before.id), s);
      const sets = [];
      for (const s of rawSets) {
        if (s.mix) {
          const bid = combinedToBeforeId(s.mix);
          if (bid && beforeIdToSet.has(bid)) {
            beforeIdToSet.get(bid).mix = s.mix;
            continue;
          }
          sets.push(s);
          continue;
        }
        sets.push(s);
      }
      if (sets.length === 0) continue;
      const includeProgress = options.includeProgressPhotos !== false;

      const setBlocks = [];
      for (const set of sets) {
        const hasAny =
          set.before
          || set.after
          || set.mix
          || (includeProgress && set.progress.length > 0);
        if (!hasAny) continue;

        const [bData, aData, mData] = await Promise.all([
          set.before ? photoToData(set.before, helpers) : null,
          set.after ? photoToData(set.after, helpers) : null,
          set.mix ? photoToData(set.mix, helpers) : null,
        ]);

        const parts = [];

        // 1) Combined Before & After hero — at the top of the set.
        if (set.mix) {
          parts.push(fullSlot(mData, set.mix, 'Before & After', { cssClass: 'hero' }));
        }
        // 2) Before + After side-by-side on one row. If only one side
        //    exists, render it alone full width.
        if (set.before && set.after) {
          parts.push(`
            <div class="set-photo">
              <div class="pair">
                ${halfSlot(bData, set.before, 'Before')}
                ${halfSlot(aData, set.after, 'After')}
              </div>
            </div>
          `);
        } else if (set.before) {
          parts.push(fullSlot(bData, set.before, 'Before'));
        } else if (set.after) {
          parts.push(fullSlot(aData, set.after, 'After'));
        }

        // 3) Single "Progress" header + small thumb grid (no
        //    per-thumb labels — tiles are too small for chips).
        if (includeProgress && set.progress.length > 0) {
          const thumbs = await Promise.all(
            sortByTime(set.progress).map(async (p) => {
              const d = await photoToData(p, helpers);
              return `<div class="tile">${photoImgHtml({ data: d, photo: p })}</div>`;
            }),
          );
          parts.push(`
            <div class="set-photo">
              ${roleLabel('Progress')}
              <div class="progress-tiles">${thumbs.join('')}</div>
            </div>
          `);
        }

        setBlocks.push(`<div class="set">${parts.join('')}</div>`);
      }

      if (setBlocks.length === 0) continue;

      sections.push(`
        <section class="section">
          <div class="section-title">${escapeHtml(helpers.displayRoomName(room))}</div>
          ${setBlocks.join('')}
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
    return htmlDocument({ title: project.title, css, body, brandColor });
  },
};

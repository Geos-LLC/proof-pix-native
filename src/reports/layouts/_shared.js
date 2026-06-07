// Shared helpers used by every layout renderer. Kept pure (no React,
// no native imports) so a layout can be unit-tested by feeding it a
// stub `helpers.fileToDataUri` and an array of plain-object photos.

export const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const tsOf = (p) =>
  typeof p?.timestamp === 'number'
    ? p.timestamp
    : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);

export const formatLongDate = (ts) =>
  ts
    ? new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

export const formatShortStamp = (ts) =>
  ts
    ? new Date(ts).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : '';

export const sortByTime = (photos) =>
  [...photos].sort((a, b) => tsOf(a) - tsOf(b));

// Group photos by their `room` id. Preserves first-seen order so the
// caller can present sections in capture order without extra sorting.
export const groupByRoom = (photos) => {
  const order = [];
  const map = new Map();
  for (const p of photos) {
    const key = p.room || '__unsorted__';
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(p);
  }
  return order.map((key) => ({ room: key, photos: map.get(key) }));
};

// Split a room's photos into before/after/progress buckets. `mode`
// values match `src/constants/rooms.js` PHOTO_MODES.
export const splitByMode = (photos) => {
  const before = [];
  const after = [];
  const progress = [];
  const other = [];
  for (const p of photos) {
    if (p.mode === 'before') before.push(p);
    else if (p.mode === 'after') after.push(p);
    else if (p.mode === 'progress') progress.push(p);
    else other.push(p);
  }
  return { before, after, progress, other };
};

// Pair before/after photos in a room. An after photo is paired to a
// before via `beforePhotoId`; falls back to chronological pairing when
// the explicit link is missing. Returns ordered pairs + leftovers so a
// layout can decide whether to render orphan befores/afters.
export const pairBeforeAfter = (photos) => {
  const { before, after } = splitByMode(photos);
  const beforeById = new Map(before.map((b) => [b.id, b]));
  const usedBefore = new Set();
  const pairs = [];
  // Pass 1 — explicit links
  for (const a of sortByTime(after)) {
    if (a.beforePhotoId && beforeById.has(a.beforePhotoId) && !usedBefore.has(a.beforePhotoId)) {
      pairs.push({ before: beforeById.get(a.beforePhotoId), after: a });
      usedBefore.add(a.beforePhotoId);
    }
  }
  // Pass 2 — chronological fill for orphans
  const orphanAfters = sortByTime(after).filter(
    (a) => !a.beforePhotoId || !beforeById.has(a.beforePhotoId),
  );
  const orphanBefores = sortByTime(before).filter((b) => !usedBefore.has(b.id));
  while (orphanAfters.length && orphanBefores.length) {
    pairs.push({ before: orphanBefores.shift(), after: orphanAfters.shift() });
  }
  return {
    pairs,
    leftoverBefore: orphanBefores,
    leftoverAfter: orphanAfters,
  };
};

// Default base styles every layout extends in its own <style>. Keeps
// typography + print rules consistent (page-break-inside avoid, A4
// margin sane for Safari → Print → PDF and for expo-print's WebKit
// renderer).
export const baseCss = `
* { box-sizing: border-box; }
@page { margin: 18mm 14mm; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #1A1A1A; background: #FFFFFF; }
.no-break { page-break-inside: avoid; }
.header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #1A1A1A; padding-bottom: 14px; margin-bottom: 18px; }
.header img.logo { max-height: 56px; max-width: 160px; object-fit: contain; }
.header .htext { flex: 1; }
.header .company { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #888; margin-bottom: 2px; }
.header h1 { font-size: 22px; margin: 0; }
.header .sub { color: #555; font-size: 12px; margin-top: 4px; }
.footer { margin-top: 22px; font-size: 10px; color: #888; text-align: center; }
.missing { padding: 40px; text-align: center; background: #F3F3F3; color: #999; font-size: 12px; }
.muted { color: #6b6b6b; }
.section-title { font-size: 16px; font-weight: 600; margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #ECECEC; }
.note { margin-top: 6px; font-size: 12px; color: #1A1A1A; white-space: pre-wrap; }
.caption { font-size: 11px; color: #555; }
`;

// Common header used by most layouts. Pass `subtitle` to override the
// default "Generated <date> · N photos" line. `companyName` renders as
// a small label above the title; `brandColor` styles the border-bottom.
export const headerHtml = ({ title, subtitle, logoData, companyName, brandColor }) => {
  const borderColor = brandColor || '#1A1A1A';
  return `<div class="header" style="border-bottom-color:${borderColor};">
    ${logoData ? `<img class="logo" src="${logoData}" alt="" />` : ''}
    <div class="htext">
      ${companyName ? `<div class="company">${escapeHtml(companyName)}</div>` : ''}
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">${escapeHtml(subtitle || '')}</div>
    </div>
  </div>`;
};

export const footerHtml = () =>
  `<div class="footer">Created with ProofPix.app</div>`;

// Render the full HTML document shell. Layouts return body fragments;
// this wraps them in <html>/<head>/<body> with the merged stylesheet.
export const htmlDocument = ({ title, css, body }) =>
  `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${baseCss}${css || ''}</style>
</head><body>
${body}
</body></html>`;

// Resolve a photo's source as a data: URI so the produced HTML is
// portable (Safari Print → PDF, expo-print, share sheet). When the
// fetch fails we render the .missing placeholder instead of dropping
// the slot.
export const photoToData = async (p, helpers) => {
  if (!p?.uri) return null;
  try {
    return await helpers.fileToDataUri(p.uri, 'image/jpeg');
  } catch (_) {
    return null;
  }
};

// Standard small caption used inline under photos: "Kitchen · Mar 5,
// 2026, 10:42 AM". Layouts can call this or build their own.
export const photoCaption = ({ photo, helpers, options }) => {
  const room = helpers.displayRoomName(photo.room || '');
  const stamp = options?.docShowCaptureTime === false
    ? ''
    : formatShortStamp(tsOf(photo));
  return [room, stamp].filter(Boolean).map(escapeHtml).join(' &middot; ');
};

// Note text rendered under a photo. Honors includeNotes; returns ''
// when there's nothing to show so callers don't end up with empty
// containers.
export const noteHtml = ({ photo, options }) => {
  if (options?.includeNotes === false) return '';
  if (!photo?.notes) return '';
  return `<div class="note">${escapeHtml(photo.notes)}</div>`;
};

// Label text — when showLabels is on, surface the photo's saved
// `name` (e.g. "Kitchen 1") as a small tag above the caption.
export const labelHtml = ({ photo, options }) => {
  if (options?.showLabels === false) return '';
  if (!photo?.name) return '';
  return `<div class="caption"><strong>${escapeHtml(photo.name)}</strong></div>`;
};

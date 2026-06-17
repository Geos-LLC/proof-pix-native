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

// Group photos by their capture date (local timezone), newest day
// first. Within each day, photos are sub-grouped by room in capture
// order so the day reads chronologically top-to-bottom. Mirrors the
// in-app Timeline tab's buildTimeline() so reports match what the
// user sees on the screen.
export const groupByDateThenRoom = (photos) => {
  const byDate = new Map();
  for (const p of photos) {
    const ts = tsOf(p);
    if (!ts) continue;
    const dateKey = new Date(ts).toLocaleDateString('en-CA'); // YYYY-MM-DD
    if (!byDate.has(dateKey)) byDate.set(dateKey, { ts, byRoom: new Map() });
    const day = byDate.get(dateKey);
    if (ts > day.ts) day.ts = ts;
    const roomKey = p.room || '__unsorted__';
    if (!day.byRoom.has(roomKey)) {
      day.byRoom.set(roomKey, { room: roomKey, photos: [], firstTs: ts });
    }
    const bucket = day.byRoom.get(roomKey);
    bucket.photos.push(p);
    if (ts < bucket.firstTs) bucket.firstTs = ts;
  }
  return Array.from(byDate.entries())
    .map(([dateKey, { ts, byRoom }]) => ({
      dateKey,
      ts,
      rooms: Array.from(byRoom.values())
        .sort((a, b) => a.firstTs - b.firstTs)
        .map((r) => ({ ...r, photos: sortByTime(r.photos) })),
    }))
    .sort((a, b) => b.ts - a.ts);
};

// Group a room's photos into "sets" — each set is one before, the
// progress shots between it and its after, and the after itself. A
// set's after is linked via `beforePhotoId`; if that's missing we
// pair by chronological proximity (next before opens a new set;
// next after closes the current one). Orphan progress/before/after
// photos still get their own minimal sets so nothing is dropped.
// Returns an array of { before, progress: [], after } in capture order.
export const groupBySet = (photos) => {
  const sorted = sortByTime(photos);
  const sets = [];
  // First pass: build explicit sets from before photos and link
  // afters/progress via beforePhotoId where available.
  const beforeIdToSet = new Map();
  for (const p of sorted) {
    if (p.mode === 'before') {
      const set = { before: p, progress: [], after: null };
      beforeIdToSet.set(p.id, set);
      sets.push(set);
    }
  }
  // Pass 2: explicit-link afters + progress to their before's set.
  const consumed = new Set();
  for (const p of sorted) {
    if (p.mode === 'after' && p.beforePhotoId && beforeIdToSet.has(p.beforePhotoId)) {
      const set = beforeIdToSet.get(p.beforePhotoId);
      if (!set.after) {
        set.after = p;
        consumed.add(p.id);
      }
    } else if (p.mode === 'progress' && p.beforePhotoId && beforeIdToSet.has(p.beforePhotoId)) {
      beforeIdToSet.get(p.beforePhotoId).progress.push(p);
      consumed.add(p.id);
    }
  }
  // Pass 3: chronological fill — for unlinked afters/progress, walk
  // forward and assign to the most recent open set (one with no
  // after yet). Orphans land in their own set so they still render.
  let openSet = null;
  for (const p of sorted) {
    if (p.mode === 'before') {
      openSet = beforeIdToSet.get(p.id);
      continue;
    }
    if (consumed.has(p.id)) {
      // already linked above; advance openSet if this closed it
      if (openSet && openSet.after && openSet.after.id === p.id) openSet = null;
      continue;
    }
    if (p.mode === 'after') {
      if (openSet && !openSet.after) {
        openSet.after = p;
        openSet = null;
      } else {
        sets.push({ before: null, progress: [], after: p });
      }
    } else if (p.mode === 'progress') {
      if (openSet) openSet.progress.push(p);
      else sets.push({ before: null, progress: [p], after: null });
    } else if (p.mode === 'mix') {
      // Combined photos render as their own single-card set.
      sets.push({ before: null, progress: [], after: null, mix: p });
    }
  }
  return sets;
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
.label-name { color: var(--brand-color, #1A1A1A); }
.photo-wrap { position: relative; display: block; }
.photo-wrap img { width: 100%; display: block; }
.chip { position: absolute; top: 8px; left: 8px; padding: 3px 8px; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; border-radius: 4px; background: var(--brand-color, rgba(0,0,0,0.6)); color: var(--brand-chip-text, #FFFFFF); }
.ts-overlay { position: absolute; bottom: 8px; left: 8px; padding: 2px 6px; background: rgba(0,0,0,0.55); color: #FFFFFF; font-size: 9px; border-radius: 3px; letter-spacing: 0.03em; }
.watermark-overlay { position: absolute; bottom: 8px; right: 8px; padding: 2px 6px; background: rgba(0,0,0,0.45); color: #FFFFFF; font-size: 9px; border-radius: 3px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
// YIQ luminance — pick black or white text so chips stay legible on
// any brand color. Mirror of contrastText() in ReportPreview.js so
// HTML and in-app preview agree.
export const contrastTextColor = (bgHex) => {
  const hex = String(bgHex || '').replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return '#FFFFFF';
  return ((r * 299 + g * 587 + b * 114) / 1000) >= 140 ? '#1A1A1A' : '#FFFFFF';
};

const CHIP_LABEL = {
  before: 'BEFORE',
  after: 'AFTER',
  progress: 'PROGRESS',
  mix: 'BEFORE &amp; AFTER',
};

// Returns a chip overlay HTML element for a photo's mode, or '' if the
// mode doesn't get a chip. Inline color override is intentional: the
// PDF renderer used by some clients ignores CSS vars set on :root.
export const chipForMode = (mode) => {
  const label = CHIP_LABEL[mode];
  if (!label) return '';
  return `<div class="chip">${label}</div>`;
};

// Wraps an image (or missing placeholder) in a .photo-wrap container.
// We *intentionally* do NOT paint BEFORE/AFTER chips or watermark
// overlays here anymore — the report pipeline now feeds in the baked
// photo URI (label + watermark already composited by labelService),
// so adding them again would duplicate. The only optional overlay
// kept is the timestamp, since the bake doesn't include one and the
// editor doesn't either.
export const photoImgHtml = ({ data, photo, alt = '', showTimestamp, watermarkText }) => {
  const inner = data
    ? `<img src="${data}" alt="${escapeHtml(alt)}" />`
    : `<div class="missing">Image unavailable</div>`;
  const ts = showTimestamp && photo
    ? `<div class="ts-overlay">${escapeHtml(formatShortStamp(tsOf(photo)))}</div>`
    : '';
  // Watermark overlay: layouts that already feed in a baked URI with
  // the watermark composited skip this by not passing watermarkText.
  // Layouts that want a fallback HTML watermark (e.g. when the bake
  // pipeline doesn't include it — combined photos today) pass the
  // text and we render it here.
  const wm = watermarkText
    ? `<div class="watermark-overlay">${escapeHtml(watermarkText)}</div>`
    : '';
  return `<div class="photo-wrap">${inner}${ts}${wm}</div>`;
};

export const htmlDocument = ({ title, css, body, brandColor }) => {
  // Inject brand color as a CSS custom property so any layout can
  // reference it via var(--brand-color, fallback). Layouts that don't
  // pass brandColor get their hardcoded fallbacks.
  const brandVar = brandColor
    ? `:root { --brand-color: ${brandColor}; --brand-chip-text: ${contrastTextColor(brandColor)}; }`
    : '';
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${brandVar}${baseCss}${css || ''}</style>
</head><body>
${body}
</body></html>`;
};

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
  return `<div class="caption label-name"><strong>${escapeHtml(photo.name)}</strong></div>`;
};

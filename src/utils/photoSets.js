import { PHOTO_MODES } from '../constants/rooms';

// A "set" is photos of one place/angle within a (project, room, date). It
// has at most one BEFORE, any number of PROGRESS, one AFTER, and optionally
// one COMBINED (which counts as both Before+After). The set id is derived
// from existing fields — no data migration needed for legacy photos.

export const tsOf = (photo) =>
  typeof photo?.timestamp === 'number'
    ? photo.timestamp
    : (photo?.createdAt ? new Date(photo.createdAt).getTime() : 0);

const sameDay = (a, b) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
};

// Given a list of photos (typically already scoped to a single room+date),
// returns a Map<photoId, setId>. Sets are anchored by the first photo of
// each capture session — that photo's id becomes the setId, and any later
// photos in the same room+date (regardless of mode) attach to it until a
// new BEFORE starts the next session. This means a user reassigning modes
// after the fact doesn't fragment a set: membership follows capture order.
export const computeSetIds = (photos) => {
  const sorted = [...(photos || [])].sort((a, b) => tsOf(a) - tsOf(b));
  const setIdOf = new Map();
  let lastBeforeId = null;
  for (const p of sorted) {
    if (p.mode === PHOTO_MODES.BEFORE) {
      setIdOf.set(p.id, p.id);
      lastBeforeId = p.id;
      continue;
    }
    if (p.beforePhotoId) {
      setIdOf.set(p.id, p.beforePhotoId);
      continue;
    }
    if (lastBeforeId) {
      setIdOf.set(p.id, lastBeforeId);
      continue;
    }
    setIdOf.set(p.id, p.id);
  }
  return setIdOf;
};

// Count distinct sets across an arbitrary photo list (room+date scoping is
// applied internally by partitioning on `room` and the photo's day key).
export const countSets = (photos) => {
  if (!photos || photos.length === 0) return 0;
  const groups = new Map();
  for (const p of photos) {
    const ts = tsOf(p);
    if (!ts) continue;
    const dayKey = new Date(ts).toLocaleDateString('en-CA');
    const key = `${p.room || 'Unsorted'}__${dayKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  let total = 0;
  for (const arr of groups.values()) {
    total += new Set(computeSetIds(arr).values()).size;
  }
  return total;
};

// Sets within a single (room, date) — used by Timeline room tiles.
export const countSetsInRoomDate = (photos, roomName, dateAnchorMs) => {
  if (!photos || photos.length === 0) return 0;
  const subset = photos.filter((p) => {
    if ((p.room || 'Unsorted') !== roomName) return false;
    const ts = tsOf(p);
    if (!ts) return false;
    return sameDay(ts, dateAnchorMs);
  });
  if (subset.length === 0) return 0;
  return new Set(computeSetIds(subset).values()).size;
};

// Share preview route. Reference implementation of the unified
// enlarged-photo viewer per the user's spec — timeline + capture
// preview will migrate to the exact same component once this is the
// shape we want.
//
// Layout (top → bottom):
//   Row 1 (set nav):  ‹ Set N-1   ·   Set N   ·   Set N+1 ›
//   Row 2 (chrome):   X close (left)  ·  Delete (right, removes
//                                       current photo from share)
//   Photo pager (swipe + chevrons + counter)
//   Row 3 (actions):  Overlays switch (left)  ·  Edit pencil (right)
//   Row 4 (share):    "Share photo" button (single-photo flow)
//
// Set membership is derived from each photo's mode + beforePhotoId
// (matching the report engine's groupBySet). Combined photos
// (mode === 'mix') link to their source set via the `combined_<beforeId>`
// id prefix. Sets are numbered by the order they appear in the share
// pool — Set 1 is whichever set the user's first selected photo is in,
// Set 2 the next distinct set, etc.
//
// Route params:
//   photos                — Array<Photo> swipe pool
//   initialPhotoId        — start photo (defaults to first)
//   initialOverlaysOn     — overlays toggle initial value (default true)
//   onOverlaysChange(on)  — share modal flips its switch
//   onToggleSelected(id, selected) — share modal adds/removes from pending
//   onShareNow(photoId)   — kicks off the share for the single visible photo
import React, { useState, useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import EnlargedPhotoViewer from '../components/EnlargedPhotoViewer';
import { useSettings } from '../context/SettingsContext';

// Resolve the capture-set id for a photo. Mirrors the same id rules
// the report layouts (buildSetList in ProjectDetailScreen) use so the
// "Set 1 / Set 2" numbering here matches the rest of the app.
const setIdOf = (photo) => {
  if (!photo) return null;
  if (photo.mode === 'before') return String(photo.id);
  const idStr = String(photo.id || '');
  if (idStr.startsWith('combined_')) return idStr.slice('combined_'.length);
  if (photo.beforePhotoId) return String(photo.beforePhotoId);
  return String(photo.id);
};

export default function SharePreviewScreen({ route, navigation }) {
  const {
    photos = [],
    initialPhotoId,
    initialOverlaysOn = true,
    onOverlaysChange,
    onToggleSelected,
    onShareNow,
  } = route?.params || {};

  const settings = useSettings();
  const { t } = useTranslation();
  const roomDisplayName = useCallback((roomId) => {
    if (!roomId) return '';
    try {
      const list = settings?.getRooms?.() || [];
      const found = list.find((r) => r?.id === roomId || r?.name === roomId);
      return found?.name || roomId;
    } catch (_) {
      return roomId;
    }
  }, [settings]);

  const [overlaysOn, setOverlaysOn] = useState(!!initialOverlaysOn);
  const handleOverlaysChange = useCallback((next) => {
    setOverlaysOn(next);
    if (typeof onOverlaysChange === 'function') onOverlaysChange(next);
  }, [onOverlaysChange]);

  // Local active set — deletes drop entries from this set; the
  // viewer's pool follows.
  const [activeIds, setActiveIds] = useState(() => new Set(photos.map((p) => p.id)));
  const removeFromShare = useCallback((id) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (typeof onToggleSelected === 'function') onToggleSelected(id, false);
  }, [onToggleSelected]);

  const handleClose = useCallback(() => navigation.goBack(), [navigation]);
  const handleEdit = useCallback((photo) => {
    if (!photo?.id) return;
    navigation.navigate('StudioDetail', { photoId: photo.id });
  }, [navigation]);
  const handleDelete = useCallback((photo) => {
    if (!photo?.id) return;
    Alert.alert(
      'Remove from share?',
      `Remove "${photo.name || 'this photo'}" from this share.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeFromShare(photo.id) },
      ],
      { cancelable: true },
    );
  }, [removeFromShare]);
  const handleShare = useCallback((photo) => {
    if (typeof onShareNow === 'function') onShareNow(photo?.id);
    navigation.goBack();
  }, [onShareNow, navigation]);

  // Sort the active pool so photos cluster by set in capture order,
  // and combined (mix) photos always sit at the end of their set —
  // "Before → Progress* → After → Combined" inside each set, matching
  // the buildSetList structure the picker uses.
  const modeRank = (p) => {
    if (!p) return 99;
    if (p.mode === 'before') return 0;
    if (p.mode === 'progress') return 1;
    if (p.mode === 'after') return 2;
    if (p.mode === 'mix' || p.mode === 'combined') return 3;
    return 4;
  };
  const tsOf = (p) => (typeof p?.timestamp === 'number'
    ? p.timestamp
    : (p?.createdAt ? new Date(p.createdAt).getTime() : 0));
  const livePool = useMemo(() => {
    const filtered = photos.filter((p) => activeIds.has(p.id));
    // Capture set ordering — sets sorted by their before photo's
    // timestamp (fallback to first member's timestamp).
    const setIds = new Set();
    const order = [];
    const earliestOf = new Map();
    for (const p of filtered) {
      const sid = setIdOf(p);
      if (!sid) continue;
      const t = tsOf(p);
      const prev = earliestOf.get(sid);
      if (prev == null || t < prev) earliestOf.set(sid, t);
      if (!setIds.has(sid)) { setIds.add(sid); order.push(sid); }
    }
    order.sort((a, b) => (earliestOf.get(a) || 0) - (earliestOf.get(b) || 0));
    const setIndexOf = new Map(order.map((sid, i) => [sid, i]));
    return [...filtered].sort((a, b) => {
      const sa = setIndexOf.get(setIdOf(a)) ?? 999;
      const sb = setIndexOf.get(setIdOf(b)) ?? 999;
      if (sa !== sb) return sa - sb;
      const ra = modeRank(a);
      const rb = modeRank(b);
      if (ra !== rb) return ra - rb;
      // Progress photos sorted chronologically within their mode.
      return tsOf(a) - tsOf(b);
    });
  }, [photos, activeIds]);

  const safeInitialId = useMemo(() => {
    if (initialPhotoId && livePool.some((p) => p.id === initialPhotoId)) return initialPhotoId;
    return livePool[0]?.id;
  }, [initialPhotoId, livePool]);

  // Set membership map — for every set id present in the pool, the
  // first photo we'd land on when jumping to that set. Ordered by
  // first appearance so "Set 1" really is whichever set the first
  // selected photo belongs to.
  const { orderedSetIds, firstPhotoOfSet } = useMemo(() => {
    const seen = new Set();
    const order = [];
    const firstBy = new Map();
    for (const p of livePool) {
      const sid = setIdOf(p);
      if (!sid) continue;
      if (!seen.has(sid)) {
        seen.add(sid);
        order.push(sid);
        firstBy.set(sid, p);
      }
    }
    return { orderedSetIds: order, firstPhotoOfSet: firstBy };
  }, [livePool]);

  const setIdxOf = useCallback((photo) => {
    const sid = setIdOf(photo);
    if (!sid) return -1;
    return orderedSetIds.indexOf(sid);
  }, [orderedSetIds]);

  // Set-nav labels. Boundary behaviour matches PhotoSetPreviewScreen:
  // at the first set the left chip shows the current set number with
  // no arrow (the EnlargedPhotoViewer hides the arrow when the prev
  // label is null), and symmetrically at the last set the right chip
  // is null so the arrow hides there.
  const prevSetLabelFn = useCallback((photo) => {
    const i = setIdxOf(photo);
    if (i <= 0) return null;
    return `Set ${i}`;
  }, [setIdxOf]);
  const setLabelFn = useCallback((photo) => {
    const i = setIdxOf(photo);
    if (i < 0) {
      // Photo isn't in any recognized set (shouldn't happen for a
      // share pool, but defensive); fall back to the room name.
      return roomDisplayName(photo?.room);
    }
    // Format: "Set N — Room Name" when we have the room, just "Set N"
    // otherwise so the chip reads naturally on either side.
    const room = roomDisplayName(photo?.room);
    return room ? `Set ${i + 1} — ${room}` : `Set ${i + 1}`;
  }, [setIdxOf, roomDisplayName]);
  const nextSetLabelFn = useCallback((photo) => {
    const i = setIdxOf(photo);
    if (i < 0 || i >= orderedSetIds.length - 1) return null;
    return `Set ${i + 2}`;
  }, [setIdxOf, orderedSetIds.length]);

  // Imperative scroll signal — bump nonce to scroll the viewer to a
  // photo id without exposing a ref. The optional `label` triggers
  // the 500ms domed "Set N" overlay in the viewer.
  const [scrollSignal, setScrollSignal] = useState({ id: null, nonce: 0 });
  const scrollToWithLabel = useCallback((id, label) => {
    if (!id) return;
    setScrollSignal((prev) => ({ id, nonce: prev.nonce + 1, label }));
  }, []);

  const handlePrevSet = useCallback((currentPhoto) => {
    const i = setIdxOf(currentPhoto);
    if (i <= 0) return;
    const targetSetId = orderedSetIds[i - 1];
    const target = firstPhotoOfSet.get(targetSetId);
    if (target) scrollToWithLabel(target.id, `Set ${i}`);
  }, [setIdxOf, orderedSetIds, firstPhotoOfSet, scrollToWithLabel]);
  const handleNextSet = useCallback((currentPhoto) => {
    const i = setIdxOf(currentPhoto);
    if (i < 0 || i >= orderedSetIds.length - 1) return;
    const targetSetId = orderedSetIds[i + 1];
    const target = firstPhotoOfSet.get(targetSetId);
    if (target) scrollToWithLabel(target.id, `Set ${i + 2}`);
  }, [setIdxOf, orderedSetIds, firstPhotoOfSet, scrollToWithLabel]);

  return (
    <EnlargedPhotoViewer
      photos={livePool}
      initialPhotoId={safeInitialId}
      onClose={handleClose}
      prevSetLabel={prevSetLabelFn}
      setLabel={setLabelFn}
      nextSetLabel={nextSetLabelFn}
      onPrevSet={handlePrevSet}
      onNextSet={handleNextSet}
      scrollSignal={scrollSignal}
      showDelete
      onDelete={handleDelete}
      showEdit
      onEdit={handleEdit}
      showOverlays
      overlaysOn={overlaysOn}
      onOverlaysChange={handleOverlaysChange}
      shareLabel={t('home.sharePhoto')}
      onShare={handleShare}
    />
  );
}

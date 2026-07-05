import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Alert,
  Dimensions,
  Share as RNShare,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { FONTS } from '../constants/fonts';
import { PHOTO_MODES } from '../constants/rooms';
import { computeSetIds } from '../utils/photoSets';
import PhotoLabels from '../components/PhotoLabels';
import EnlargedPhotoViewer from '../components/EnlargedPhotoViewer';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const MODE_LABELS = {
  [PHOTO_MODES.BEFORE]: 'BEFORE',
  [PHOTO_MODES.PROGRESS]: 'PROGRESS',
  [PHOTO_MODES.AFTER]: 'AFTER',
  [PHOTO_MODES.COMBINED]: 'COMBINED',
};

// Format chip → aspect ratio. Keep in sync with StudioScreen's
// FORMAT_ASPECTS so a photo framed as "16:9" in Studio shows up as 16:9
// here too. Missing/legacy values fall back to square (the previous
// hardcoded shape).
const PAIR_TEMPLATE_ASPECTS = {
  square: 1,
  'wide-16-9': 16 / 9,
  'tall-9-16': 9 / 16,
  'wide-2-1': 2,
  'tall-1-2': 0.5,
};

// CameraScreen saves capture aspect as "W:H" strings ("9:16", "16:9",
// "3:4", "4:3"). Convert to a numeric ratio so the preview container can
// match the photo's true shape instead of defaulting to square.
const parseAspectString = (s) => {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!w || !h) return null;
  return w / h;
};

// Pick the most accurate aspect we know for a photo. Order of trust:
// (1) Studio pairTemplate (user explicitly framed it that way),
// (2) the capture-time aspectRatio string set by CameraScreen,
// (3) originalWidth/originalHeight if present,
// (4) square fallback.
const aspectForPhoto = (p) => {
  if (!p) return 1;
  const tpl = PAIR_TEMPLATE_ASPECTS[p.pairTemplate];
  if (tpl) return tpl;
  const fromStr = parseAspectString(p.aspectRatio);
  if (fromStr) return fromStr;
  if (p.originalWidth && p.originalHeight) return p.originalWidth / p.originalHeight;
  return 1;
};

const formatDateLabel = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const formatTimeLabel = (ts) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const tsOf = (photo) =>
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

// One short letter per mode for the thumbnail-strip badges. Combined gets a
// special 'B/A' two-tone pill rendered separately.
const modeShort = (mode) => {
  if (mode === PHOTO_MODES.BEFORE) return 'B';
  if (mode === PHOTO_MODES.PROGRESS) return 'P';
  if (mode === PHOTO_MODES.AFTER) return 'A';
  return null;
};

// Within a set, photos display in capture order (default: first = Before,
// last = After, middle = Progress). Combined is a derived artifact and
// sorts last whenever its timestamp ties the After's — that keeps the
// story reading "B → P → … → P → A → combined". Mode is informational on
// each photo, not the sort key.
const combinedLast = (mode) => (mode === PHOTO_MODES.COMBINED ? 1 : 0);

export default function PhotoSetPreviewScreen({ route, navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { getPhotosByProject, updatePhoto, deletePhoto, setCurrentRoom } = usePhotos();
  const { getRooms } = useSettings();
  const allRooms = useMemo(() => getRooms() || [], [getRooms]);
  const roomDataMap = useMemo(() => {
    const map = new Map();
    for (const room of allRooms) {
      map.set(room.id, room);
    }
    return map;
  }, [allRooms]);

  const { projectId, dateKey, roomName: initialRoom, initialPhotoId } = route?.params || {};

  // All photos for the current room across every date — sets are anchored
  // by Before photos and span days. Ordered by set (earliest photo first)
  // and then by capture time within the set, so the strip reads
  // chronologically with set gaps between work sessions.
  const { dayPhotos, setIdOf } = useMemo(() => {
    if (!projectId || !initialRoom) return { dayPhotos: [], setIdOf: new Map() };
    const all = getPhotosByProject(projectId);
    const filtered = all.filter((p) => (p.room || 'Unsorted') === initialRoom);

    // Sets are scoped to a single (room, day) everywhere else in the app
    // (see countSets in utils/photoSets). Previously this screen called
    // computeSetIds on the entire room across all dates, which collapsed
    // photos that belong to different days into one set whenever an
    // earlier BEFORE was still the most recent one in capture order.
    // That made "Set N" navigation here disagree with the per-project
    // set count on Projects / Project Details. Partitioning by day-key
    // restores parity.
    const byDay = new Map();
    for (const p of filtered) {
      const ts = tsOf(p);
      if (!ts) continue;
      const dayKey = new Date(ts).toLocaleDateString('en-CA');
      if (!byDay.has(dayKey)) byDay.set(dayKey, []);
      byDay.get(dayKey).push(p);
    }
    const ids = new Map();
    for (const arr of byDay.values()) {
      const partial = computeSetIds(arr);
      for (const [pid, sid] of partial.entries()) ids.set(pid, sid);
    }
    const setFirstTs = new Map();
    for (const p of filtered) {
      const sid = ids.get(p.id);
      if (!sid) continue;
      const ts = tsOf(p);
      if (!setFirstTs.has(sid) || ts < setFirstTs.get(sid)) {
        setFirstTs.set(sid, ts);
      }
    }

    const sorted = filtered.slice().sort((a, b) => {
      const sa = ids.get(a.id);
      const sb = ids.get(b.id);
      if (sa !== sb) return (setFirstTs.get(sa) || 0) - (setFirstTs.get(sb) || 0);
      const dt = tsOf(a) - tsOf(b);
      if (dt !== 0) return dt;
      return combinedLast(a.mode) - combinedLast(b.mode);
    });

    return { dayPhotos: sorted, setIdOf: ids };
  }, [projectId, initialRoom, getPhotosByProject]);

  // All rooms in the project that have photos, ordered by their earliest
  // photo's capture time. Drives the Prev/Next Room pills — switching rooms
  // navigates with a `replace`, the pager doesn't span rooms.
  const projectRooms = useMemo(() => {
    if (!projectId) return [];
    const all = getPhotosByProject(projectId);
    const firstTs = new Map();
    for (const p of all) {
      const r = p.room || 'Unsorted';
      const ts = tsOf(p);
      if (!firstTs.has(r) || ts < firstTs.get(r)) firstTs.set(r, ts);
    }
    return Array.from(firstTs.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([r]) => r);
  }, [projectId, getPhotosByProject]);

  // Anchor "where the user is" on the photo's ID, not its array index. Mode
  // swaps re-sort `dayPhotos`, which would silently change which photo lives
  // at any given index. Keeping the anchor as an ID lets `currentIndex`
  // re-derive correctly after each swap and the pager scroll snaps back to
  // the same photo even though it now lives at a different slot.
  const [currentPhotoId, setCurrentPhotoId] = useState(null);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const scrollRef = useRef(null);
  const thumbScrollRef = useRef(null);
  const lastScrolledIdxRef = useRef(-1);
  const overscrollHandledRef = useRef(false);

  useEffect(() => {
    if (dayPhotos.length === 0) return;
    if (currentPhotoId && dayPhotos.some((p) => p.id === currentPhotoId)) return;
    let id = null;
    if (initialPhotoId) {
      const found = dayPhotos.find((p) => p.id === initialPhotoId);
      if (found) id = found.id;
    }
    if (!id && dateKey) {
      const anchor = new Date(`${dateKey}T12:00:00`).getTime();
      const found = dayPhotos.find((p) => sameDay(tsOf(p), anchor));
      if (found) id = found.id;
    }
    if (!id) id = dayPhotos[0].id;
    setCurrentPhotoId(id);
  }, [dayPhotos, initialPhotoId, dateKey, currentPhotoId]);

  const currentIndex = useMemo(() => {
    if (!currentPhotoId) return 0;
    const i = dayPhotos.findIndex((p) => p.id === currentPhotoId);
    return i >= 0 ? i : 0;
  }, [currentPhotoId, dayPhotos]);

  // Whenever `currentIndex` moves (initial resolve, swap-induced re-sort, or
  // an explicit jumpTo), scroll the pager to that slot. We dedupe against
  // `lastScrolledIdxRef` so the natural ScrollView momentum events don't
  // bounce us back to where we already are.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (lastScrolledIdxRef.current === currentIndex) return;
    lastScrolledIdxRef.current = currentIndex;
    scrollRef.current.scrollTo({ x: currentIndex * SCREEN_W, animated: true });
  }, [currentIndex]);

  // Keep the thumbnail strip aligned to the active thumb. The strip mixes
  // 50px thumbs with 8px gaps, ~14px set spacers, and ~25px date dividers,
  // so the math is approximate — we aim to keep the active thumb roughly
  // a third of the way in from the left edge of the visible strip.
  useEffect(() => {
    if (!thumbScrollRef.current) return;
    const approxThumbStride = 106;
    const targetX = Math.max(0, currentIndex * approxThumbStride - SCREEN_W * 0.3);
    thumbScrollRef.current.scrollTo({ x: targetX, animated: true });
  }, [currentIndex]);

  const current = dayPhotos[currentIndex] || null;
  // Expose the active photo's id as a route param so the global bottom nav
  // can do something smart with it (e.g. tapping Studio jumps straight into
  // the photo-edit view instead of the grid landing page).
  useEffect(() => {
    if (current?.id) navigation.setParams({ currentPhotoId: current.id });
  }, [current?.id, navigation]);
  const currentRoom = current ? (current.room || 'Unsorted') : (initialRoom || '');
  const currentMode = current?.mode || PHOTO_MODES.PROGRESS;
  const includeInReport = current ? (current.includeInReport !== false) : true;

  // Photos in the same room+date as the current photo. This is the "set" that
  // owns the single Before / single After invariant — swaps and demotions are
  // scoped to this collection, never the whole day.
  const setPhotos = useMemo(() => {
    if (!current) return [];
    return dayPhotos.filter((p) => (p.room || 'Unsorted') === currentRoom);
  }, [dayPhotos, current, currentRoom]);

  // A combined photo plays BOTH roles, so it counts as both "the set's Before"
  // and "the set's After" until split. Anything else with the matching single
  // mode is treated as the current holder of that role.
  const setBeforePhoto = setPhotos.find(
    (p) => p.mode === PHOTO_MODES.BEFORE || p.mode === PHOTO_MODES.COMBINED
  );
  const setAfterPhoto = setPhotos.find(
    (p) => p.mode === PHOTO_MODES.AFTER || p.mode === PHOTO_MODES.COMBINED
  );

  // Derive a "visual role" per photo. Invariants from the spec:
  //   • Set with 1 photo  → that photo is BEFORE
  //   • Set with 3 photos → BEFORE + AFTER + COMBINED (auto-created on capture)
  //   • Set with 4+       → BEFORE + PROGRESS(es) + AFTER + COMBINED
  //   • A "2-photo" state shouldn't exist, but if it does (legacy data), the
  //     two photos display as BEFORE + AFTER
  // Stored `mode` is authoritative when explicit. Otherwise the first non-
  // combined photo by capture time is the BEFORE; the last non-combined is
  // the AFTER. Combined photos always render both BEFORE + AFTER badges
  // and are NOT substitutes for the visual Before/After of their set.
  const visualRoleOf = useMemo(() => {
    const bySet = new Map();
    for (const p of dayPhotos) {
      const sid = setIdOf.get(p.id);
      if (!bySet.has(sid)) bySet.set(sid, []);
      bySet.get(sid).push(p);
    }
    const out = new Map();
    for (const [, photos] of bySet) {
      const sorted = photos.slice().sort((a, b) => tsOf(a) - tsOf(b));
      const nonCombined = sorted.filter((p) => p.mode !== PHOTO_MODES.COMBINED);
      const explicitBefore = nonCombined.find((p) => p.mode === PHOTO_MODES.BEFORE);
      const explicitAfter = nonCombined.find((p) => p.mode === PHOTO_MODES.AFTER);
      const beforeId =
        explicitBefore?.id || nonCombined[0]?.id || sorted[0]?.id;
      const afterId =
        explicitAfter?.id || nonCombined[nonCombined.length - 1]?.id || sorted[sorted.length - 1]?.id;
      const singlePhotoSet = sorted.length === 1;
      for (const p of sorted) {
        if (p.mode === PHOTO_MODES.COMBINED) {
          out.set(p.id, PHOTO_MODES.COMBINED);
          continue;
        }
        if (singlePhotoSet) {
          // Per spec: a 1-photo set is the Before. Keep an explicit After tag
          // only if the user set it that way intentionally.
          out.set(p.id, p.mode === PHOTO_MODES.AFTER ? PHOTO_MODES.AFTER : PHOTO_MODES.BEFORE);
          continue;
        }
        if (p.id === beforeId) {
          out.set(p.id, PHOTO_MODES.BEFORE);
        } else if (p.id === afterId) {
          out.set(p.id, PHOTO_MODES.AFTER);
        } else {
          out.set(p.id, PHOTO_MODES.PROGRESS);
        }
      }
    }
    return out;
  }, [dayPhotos, setIdOf]);

  // Effective role of the current photo (auto-fills missing Before/After).
  const currentVisualRole = current ? visualRoleOf.get(current.id) : null;
  const isCurrentBefore = currentVisualRole === PHOTO_MODES.BEFORE || currentVisualRole === PHOTO_MODES.COMBINED;
  const isCurrentAfter = currentVisualRole === PHOTO_MODES.AFTER || currentVisualRole === PHOTO_MODES.COMBINED;
  const isCurrentProgress = currentVisualRole === PHOTO_MODES.PROGRESS;

  // Map each set's id to its 1-indexed number within the room. Drives the
  // "Set N" label on the dividers between thumbnails of different sets.
  const setIdToNumber = useMemo(() => {
    const map = new Map();
    let counter = 1;
    for (const p of dayPhotos) {
      const sid = setIdOf.get(p.id);
      if (sid && !map.has(sid)) {
        map.set(sid, counter++);
      }
    }
    return map;
  }, [dayPhotos, setIdOf]);

  const projectRoomsSet = useMemo(() => new Set(projectRooms), [projectRooms]);

  // Adjacent rooms for the cross-room overscroll swipe handler.
  const { prevRoom, nextRoom } = useMemo(() => {
    const idx = projectRooms.indexOf(initialRoom);
    return {
      prevRoom: idx > 0 ? projectRooms[idx - 1] : null,
      nextRoom: idx >= 0 && idx < projectRooms.length - 1 ? projectRooms[idx + 1] : null,
    };
  }, [projectRooms, initialRoom]);

  // Position counts within the CURRENT SET. Sets bar shows prev set on the
  // left and next set on the right (one step at a time). At the first set
  // the left shows the current Set label (no nav); at the last set the
  // right does the same. Arrows appear only when there's an additional
  // set beyond the labeled one (i.e., further nav is possible).
  const { positionInSet, setTotal, setPosition, setCount, prevSetFirstIndex, nextSetFirstIndex } = useMemo(() => {
    const setOrder = [];
    const seen = new Set();
    for (const p of dayPhotos) {
      const sid = setIdOf.get(p.id);
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        setOrder.push(sid);
      }
    }
    const currentSetId = current ? setIdOf.get(current.id) : null;
    const setIdx = currentSetId ? setOrder.indexOf(currentSetId) : -1;
    const firstIdxOf = (sid) => sid ? dayPhotos.findIndex((p) => setIdOf.get(p.id) === sid) : -1;

    const photosInSet = currentSetId
      ? dayPhotos.filter((p) => setIdOf.get(p.id) === currentSetId)
      : [];
    const posInSet = current ? photosInSet.findIndex((p) => p.id === current.id) + 1 : 0;

    const prevSetId = setIdx > 0 ? setOrder[setIdx - 1] : null;
    const nextSetId = setIdx >= 0 && setIdx < setOrder.length - 1 ? setOrder[setIdx + 1] : null;
    return {
      positionInSet: posInSet,
      setTotal: photosInSet.length,
      setPosition: setIdx >= 0 ? setIdx + 1 : 0,
      setCount: setOrder.length,
      prevSetFirstIndex: firstIdxOf(prevSetId),
      nextSetFirstIndex: firstIdxOf(nextSetId),
    };
  }, [dayPhotos, current, setIdOf]);

  const jumpTo = (i) => {
    if (i < 0 || i >= dayPhotos.length) return;
    const photo = dayPhotos[i];
    if (photo) setCurrentPhotoId(photo.id);
  };

  const onMomentumEnd = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (idx < 0 || idx >= dayPhotos.length) return;
    lastScrolledIdxRef.current = idx;
    const photo = dayPhotos[idx];
    if (photo && photo.id !== currentPhotoId) {
      setCurrentPhotoId(photo.id);
    }
  };

  // Overscroll-based cross-room nav. The pager's bounce on iOS lets the
  // content slide past the first/last page briefly while the user drags;
  // we trigger room nav as soon as the offset crosses a threshold past
  // either boundary, then dedupe via overscrollHandledRef so we don't
  // re-fire while the bounce settles.
  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const last = Math.max(0, (dayPhotos.length - 1) * SCREEN_W);
    if (overscrollHandledRef.current) {
      if (x > -10 && x < last + 10) overscrollHandledRef.current = false;
      return;
    }
    if (x > last + 60 && nextRoom) {
      overscrollHandledRef.current = true;
      goToRoom(nextRoom);
    } else if (x < -60 && prevRoom) {
      overscrollHandledRef.current = true;
      goToRoom(prevRoom);
    }
  };

  // Swap-aware assignment. Encapsulates the role-juggling so the JSX just
  // calls handleSetAsBefore / handleSetAsAfter / handleSetAsProgress.
  const demoteRole = async (photo, role) => {
    if (!photo) return;
    if (photo.mode === PHOTO_MODES.COMBINED) {
      // Drop only the requested role; keep the other one.
      await updatePhoto(photo.id, {
        mode: role === 'before' ? PHOTO_MODES.AFTER : PHOTO_MODES.BEFORE,
      });
    } else {
      await updatePhoto(photo.id, { mode: PHOTO_MODES.PROGRESS });
    }
  };

  const handleSetAsBefore = async () => {
    if (!current) return;
    if (isCurrentBefore) {
      // Toggle off: this photo gives up its Before role.
      await demoteRole(current, 'before');
      return;
    }
    // Promoting: demote whoever currently holds Before, then promote current.
    if (setBeforePhoto && setBeforePhoto.id !== current.id) {
      await demoteRole(setBeforePhoto, 'before');
    }
    const nextMode =
      current.mode === PHOTO_MODES.AFTER ? PHOTO_MODES.COMBINED : PHOTO_MODES.BEFORE;
    await updatePhoto(current.id, { mode: nextMode });
  };

  const handleSetAsAfter = async () => {
    if (!current) return;
    if (isCurrentAfter) {
      await demoteRole(current, 'after');
      return;
    }
    if (setAfterPhoto && setAfterPhoto.id !== current.id) {
      await demoteRole(setAfterPhoto, 'after');
    }
    const nextMode =
      current.mode === PHOTO_MODES.BEFORE ? PHOTO_MODES.COMBINED : PHOTO_MODES.AFTER;
    await updatePhoto(current.id, { mode: nextMode });
  };

  const handleSetAsProgress = async () => {
    if (!current || isCurrentProgress) return;
    await updatePhoto(current.id, { mode: PHOTO_MODES.PROGRESS });
  };

  // Promote the current photo to Combined (holds both Before AND After roles).
  // Demotes whoever currently holds either role in the set. Tapping Combined
  // again falls back to Progress.
  const handleSetAsCombined = async () => {
    if (!current) return;
    if (current.mode === PHOTO_MODES.COMBINED) {
      await updatePhoto(current.id, { mode: PHOTO_MODES.PROGRESS });
      return;
    }
    if (setBeforePhoto && setBeforePhoto.id !== current.id) {
      await demoteRole(setBeforePhoto, 'before');
    }
    if (setAfterPhoto && setAfterPhoto.id !== current.id && setAfterPhoto.id !== setBeforePhoto?.id) {
      await demoteRole(setAfterPhoto, 'after');
    }
    await updatePhoto(current.id, { mode: PHOTO_MODES.COMBINED });
  };

  const handleToggleInclude = async () => {
    if (!current) return;
    await updatePhoto(current.id, { includeInReport: !includeInReport });
  };

  const handleEditInStudio = () => {
    if (!current) return;
    // StudioDetail (not Studio) is the photo-edit route — Studio is now the
    // grid landing page, and going there with a photoId would just dump us
    // back into the grid.
    navigation.navigate('StudioDetail', { photoId: current.id });
  };

  // Share the currently-visible single photo via the OS share sheet.
  // Available to every plan (starter included) — single-picture
  // share is the one export gesture the user wanted to keep free.
  const handleShareCurrent = async () => {
    if (!current?.uri) return;
    try {
      await RNShare.share({
        url: current.uri,
        message: current.name || '',
      });
    } catch (_) {
      // user dismissed
    }
  };

  // After deleting, hop to a sensible neighbour: next photo if any, else
  // previous, else back out of the screen entirely.
  const handleDeletePhoto = () => {
    if (!current) return;
    Alert.alert(
      t('photoSet.deleteTitle', { defaultValue: 'Delete photo?' }),
      t('photoSet.deleteMessage', { defaultValue: 'This photo will be removed from the project.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            const id = current.id;
            const idx = dayPhotos.findIndex((p) => p.id === id);
            const fallback =
              dayPhotos[idx + 1]?.id || dayPhotos[idx - 1]?.id || null;
            try {
              await deletePhoto(id);
              if (fallback) {
                setCurrentPhotoId(fallback);
              } else {
                navigation.goBack();
              }
            } catch (e) {
              // swallow — match the rest of the app's silent failure mode
            }
          },
        },
      ]
    );
  };

  const goToRoom = (room) => {
    if (!room || room === initialRoom) return;
    navigation.replace('PhotoSetPreview', {
      projectId,
      roomName: room,
    });
  };

  // Inactive room (no photos in this project yet) → hop to Capture with the
  // room pre-selected so the user can take photos immediately.
  const goToCaptureForRoom = (roomId) => {
    if (!roomId) return;
    setCurrentRoom(roomId);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  if (dayPhotos.length === 0 || !current) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>{initialRoom || 'Photos'}</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="image-outline" size={48} color={theme.textMuted} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No photos in this set.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // PhotoSetPreviewScreen now mirrors the HomeScreen's per-set pool
  // model: the viewer's `photos` array is only the photos in the
  // CURRENT set, not the whole day. Jumping to next/prev set swaps
  // the pool entirely (via currentPhotoId → activeSetId → activeSet
  // recompute) so swipes inside the viewer stay scoped to one set
  // and set-jumps cleanly land on the next set's first photo.
  const setOrderList = useMemo(() => {
    const seen = new Set();
    const order = [];
    for (const p of dayPhotos) {
      const sid = setIdOf.get(p.id);
      if (sid && !seen.has(sid)) { seen.add(sid); order.push(sid); }
    }
    return order;
  }, [dayPhotos, setIdOf]);
  const firstIdxOfSet = (sid) => sid ? dayPhotos.findIndex((p) => setIdOf.get(p.id) === sid) : -1;

  // The set the active photo belongs to, plus its position in the
  // set-order list. Drives the constant `Set N` label that the
  // viewer's chips render. Prev/next wrap around at the ends so an
  // edge swipe on the last set lands on the first set (and vice
  // versa) — matches the wrap the user expects from a "carousel of
  // sets". `hasMultipleSets` gates the wrap so a single-set view
  // doesn't produce a jump-to-self.
  const activeSetId = current ? setIdOf.get(current.id) : null;
  const activeSetIdx = activeSetId ? setOrderList.indexOf(activeSetId) : -1;
  const hasMultipleSets = setOrderList.length > 1;
  const prevSetId = activeSetIdx > 0
    ? setOrderList[activeSetIdx - 1]
    : (hasMultipleSets ? setOrderList[setOrderList.length - 1] : null);
  const nextSetId = activeSetIdx >= 0 && activeSetIdx < setOrderList.length - 1
    ? setOrderList[activeSetIdx + 1]
    : (hasMultipleSets ? setOrderList[0] : null);
  const prevSetIdx = activeSetIdx > 0
    ? activeSetIdx - 1
    : (hasMultipleSets ? setOrderList.length - 1 : -1);
  const nextSetIdx = activeSetIdx >= 0 && activeSetIdx < setOrderList.length - 1
    ? activeSetIdx + 1
    : (hasMultipleSets ? 0 : -1);

  // Photos in the active set only — this is the pool we hand the
  // viewer. Re-derived on every render so it tracks any edits.
  const currentSetMembers = useMemo(() => {
    if (!activeSetId) return current ? [current] : [];
    return dayPhotos.filter((p) => setIdOf.get(p.id) === activeSetId);
  }, [dayPhotos, setIdOf, activeSetId, current]);

  // Local overlays toggle so the Overlays switch in the viewer
  // actually does something — matches the HomeScreen wiring.
  const [pspShowOverlays, setPspShowOverlays] = useState(false);

  // Signal that fires the transient "Set N" flash inside the viewer
  // when a set jump swaps the pool. Bumped from goToPrev/NextSet so
  // both the wrap-around edge swipe and the chip-tap route show the
  // same feedback.
  const [poolChangeSignal, setPoolChangeSignal] = useState({ nonce: 0, label: '' });
  const bumpPoolSignal = (label) => {
    setPoolChangeSignal((prev) => ({ nonce: prev.nonce + 1, label }));
  };

  const goToPrevSet = () => {
    if (!prevSetId) return;
    const idx = firstIdxOfSet(prevSetId);
    if (idx < 0) return;
    setCurrentPhotoId(dayPhotos[idx].id);
    if (prevSetIdx >= 0) bumpPoolSignal(`Set ${prevSetIdx + 1}`);
  };
  const goToNextSet = () => {
    if (!nextSetId) return;
    const idx = firstIdxOfSet(nextSetId);
    if (idx < 0) return;
    setCurrentPhotoId(dayPhotos[idx].id);
    if (nextSetIdx >= 0) bumpPoolSignal(`Set ${nextSetIdx + 1}`);
  };

  if (typeof console !== 'undefined') {
    console.warn('[v57][PhotoSetPreview] render', {
      poolLen: currentSetMembers.length,
      activeSetIdx,
      dayPhotosLen: dayPhotos.length,
      currentPhotoId,
    });
  }

  return (
    // Mirror the HomeScreen wiring exactly so both flows share one
    // source of truth: the EnlargedPhotoViewer is the screen, nothing
    // else around it. Pool = current set only (matches HomeScreen).
    <EnlargedPhotoViewer
      photos={currentSetMembers}
      initialPhotoId={currentPhotoId || current?.id}
      onClose={() => navigation.goBack()}
      setLabel={() => activeSetIdx >= 0 ? `Set ${activeSetIdx + 1}` : ''}
      prevSetLabel={() => prevSetIdx >= 0 ? `Set ${prevSetIdx + 1}` : null}
      nextSetLabel={() => nextSetIdx >= 0 ? `Set ${nextSetIdx + 1}` : null}
      onPrevSet={goToPrevSet}
      onNextSet={goToNextSet}
      poolChangeSignal={poolChangeSignal}
      showOverlays
      overlaysOn={pspShowOverlays}
      onOverlaysChange={setPspShowOverlays}
      showDelete
      onDelete={(p) => { if (p) { setCurrentPhotoId(p.id); handleDeletePhoto(); } }}
      showEdit
      onEdit={(p) => navigation.navigate('StudioDetail', { photoId: p.id })}
      shareLabel="Share photo"
      onShare={(p) => { if (p) { setCurrentPhotoId(p.id); handleShareCurrent(); } }}
    />
  );

  // Legacy inline render — superseded by EnlargedPhotoViewer above.
  // Wrapped in {false && ...} so it never renders but stays around
  // for quick rollback if the migration introduces regressions.
  // eslint-disable-next-line no-unreachable
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        {/* Top-left: back chevron + Edit (pencil). The user
            specifically wants Edit anchored to the left corner so it
            stays in thumb reach with the back gesture. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleEditInStudio}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="pencil-outline" size={22} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {tsOf(current) > 0
              ? new Date(tsOf(current)).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : currentRoom}
          </Text>
        </View>
        {/* Top-right: Share for the currently-visible photo. Single
            picture export — available to starter plan. */}
        <TouchableOpacity
          onPress={handleShareCurrent}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="share-outline" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.setsBar}>
        <TouchableOpacity
          style={styles.setsBarSide}
          disabled={setPosition <= 1}
          onPress={() => jumpTo(prevSetFirstIndex)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {(() => {
            const leftLabelNum = setPosition === 1 ? setPosition : setPosition - 1;
            const showLeftArrow = leftLabelNum > 1;
            return (
              <>
                {showLeftArrow && (
                  <Ionicons name="chevron-back" size={14} color={theme.textSecondary} />
                )}
                <Text style={[styles.setsBarSideText, { color: theme.textSecondary }]}>
                  Set {leftLabelNum || 1}
                </Text>
              </>
            );
          })()}
        </TouchableOpacity>

        <View style={styles.positionPillWrap}>
          <View style={[styles.positionPill, { backgroundColor: theme.surface }]}>
            <Text style={[styles.positionText, { color: theme.textPrimary }]}>
              {positionInSet} / {setTotal}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.setsBarSide, styles.setsBarSideRight]}
          disabled={setPosition >= setCount}
          onPress={() => jumpTo(nextSetFirstIndex)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {(() => {
            const rightLabelNum = setPosition === setCount ? setCount : setPosition + 1;
            const showRightArrow = rightLabelNum < setCount;
            return (
              <>
                <Text style={[styles.setsBarSideText, { color: theme.textSecondary }]}>
                  Set {rightLabelNum || 1}
                </Text>
                {showRightArrow && (
                  <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
                )}
              </>
            );
          })()}
        </TouchableOpacity>
      </View>

      {allRooms.length > 0 && (
        <View style={styles.roomTabsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.roomTabsScrollContent}
          >
            {allRooms.map((room) => {
              const r = room.id;
              const isActive = r === initialRoom;
              const hasPhotos = projectRoomsSet.has(r);
              const dim = !hasPhotos && !isActive;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.roomTab,
                    {
                      backgroundColor: isActive ? theme.surfaceAccent : theme.surfaceElevated,
                      borderColor: isActive
                        ? theme.surfaceAccent
                        : hasPhotos
                          ? theme.textPrimary
                          : theme.border,
                      borderWidth: isActive ? 0 : hasPhotos ? 2 : 1,
                      opacity: dim ? 0.45 : 1,
                    },
                  ]}
                  onPress={() => (hasPhotos ? goToRoom(r) : goToCaptureForRoom(r))}
                >
                  {room.image ? (
                    <Image
                      source={room.image}
                      style={styles.roomTabImage}
                      resizeMode="contain"
                      fadeDuration={0}
                    />
                  ) : room.icon ? (
                    <Text style={{ fontSize: 24 }}>{room.icon}</Text>
                  ) : (
                    <RoomIcon roomId={r} size={30} color={theme.textPrimary} />
                  )}
                  <Text
                    style={[
                      styles.roomTabText,
                      {
                        color: theme.textPrimary,
                        fontWeight: isActive ? '590' : '400',
                      },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {room.name || r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.pagerWrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          onScroll={onScroll}
          scrollEventThrottle={16}
          bounces
          style={styles.pager}
        >
          {dayPhotos.map((p) => {
            const role = visualRoleOf.get(p.id) || p.mode || PHOTO_MODES.PROGRESS;
            // Match the photo's true shape: Studio pairTemplate first (a
            // deliberate user choice), then the capture-time aspectRatio
            // string saved by CameraScreen ("9:16", "4:3", etc.). The old
            // code only honored pairTemplate and fell back to 1:1, which
            // made every regular capture render as 9:16 once `cover`
            // cropping kicked in.
            const photoAspect = aspectForPhoto(p);
            return (
              <View key={p.id} style={styles.pagerSlide}>
                <View style={[styles.photoArea, { aspectRatio: photoAspect }]}>
                  <Image source={{ uri: p.uri }} style={[styles.photo, { backgroundColor: theme.surface }]} resizeMode="cover" />
                  {/* PhotoLabels reads showLabels + positions from Settings.
                      visualRoleOf can override photo.mode (a "this looks
                      like a before but is filed as progress" reframe), so
                      pass a synthetic photo carrying the visual role. */}
                  <PhotoLabels photo={{ ...p, mode: role }} />

                  {setCount > 1 && (
                    <View style={styles.dotsOverlay}>
                      {Array.from({ length: setCount }, (_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.setDot,
                            {
                              backgroundColor: i + 1 === setPosition ? theme.accent : 'rgba(255,255,255,0.6)',
                              width: i + 1 === setPosition ? 18 : 6,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  )}
                  {/* Per-photo controls on the top-right of the picture.
                      Eye toggles include-in-report; trash deletes the
                      photo (handleDeletePhoto already shows a confirm
                      dialog). Only render on the current photo so the
                      pager doesn't show stale toggles on neighbouring
                      slides. */}
                  {p.id === current?.id && (
                    <View style={styles.photoControlOverlay} pointerEvents="box-none">
                      {/* Eye / include-in-report toggle removed per
                          the user's spec — the new Reports flow
                          drives per-report photo selection from the
                          Timeline grid, so this overlay button is
                          obsolete. Trash stays for inline delete. */}
                      <TouchableOpacity
                        style={[styles.photoControlBtn, styles.photoControlBtnDanger]}
                        onPress={handleDeletePhoto}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>

        {currentIndex > 0 && (
          <TouchableOpacity
            style={[styles.chev, styles.chevLeft, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
            onPress={() => jumpTo(currentIndex - 1)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        {currentIndex < dayPhotos.length - 1 && (
          <TouchableOpacity
            style={[styles.chev, styles.chevRight, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
            onPress={() => jumpTo(currentIndex + 1)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[
            styles.controlBtn,
            styles.controlBtnEqual,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
          onPress={handleEditInStudio}
        >
          <Ionicons name="brush-outline" size={16} color={theme.textPrimary} style={{ marginRight: 6 }} />
          <Text
            style={[styles.controlBtnText, { color: theme.textPrimary }]}
            numberOfLines={1}
          >
            {t('photoSet.edit', { defaultValue: 'EDIT' })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.controlBtn,
            styles.controlBtnEqual,
            styles.roleBtnSingle,
            { backgroundColor: theme.accent, borderColor: theme.accent },
          ]}
          onPress={() => setRoleDropdownOpen(true)}
        >
          <Text
            style={[styles.controlBtnText, { color: theme.accentText }]}
            numberOfLines={1}
          >
            {MODE_LABELS[currentVisualRole] || 'PROGRESS'}
          </Text>
          <Ionicons name="chevron-up" size={12} color={theme.accentText} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={thumbScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbStrip}
      >
        {dayPhotos.map((p, i) => {
          const isActive = i === currentIndex;
          const role = visualRoleOf.get(p.id) || p.mode || PHOTO_MODES.PROGRESS;
          const isCombined = role === PHOTO_MODES.COMBINED;
          const short = modeShort(role);
          const badgeColor =
            role === PHOTO_MODES.BEFORE ? theme.modeBefore
            : role === PHOTO_MODES.PROGRESS ? theme.modeProgress
            : role === PHOTO_MODES.AFTER ? theme.modeAfter
            : theme.textPrimary;
          const prevPhoto = i > 0 ? dayPhotos[i - 1] : null;
          const thisSet = setIdOf.get(p.id);
          const prevSet = prevPhoto ? setIdOf.get(prevPhoto.id) : null;
          const thisTs = tsOf(p);
          const prevTs = prevPhoto ? tsOf(prevPhoto) : 0;
          const isNewSet = prevPhoto && prevSet && prevSet !== thisSet;
          const isNewDate = prevPhoto && thisTs && prevTs && !sameDay(thisTs, prevTs);
          return (
            <React.Fragment key={p.id}>
              {isNewDate && (
                <View style={[styles.thumbDateDivider, { borderColor: theme.border }]}>
                  <Text style={[styles.thumbDateText, { color: theme.textMuted }]}>
                    {new Date(thisTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
              )}
              {!isNewDate && isNewSet && (
                <View style={[styles.thumbSetDivider, { borderColor: theme.border }]}>
                  <Text
                    style={[
                      styles.thumbSetDividerText,
                      { color: theme.textMuted },
                    ]}
                  >
                    Set {setIdToNumber.get(thisSet) || ''}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.thumbWrap, { borderColor: isActive ? theme.accent : 'transparent' }]}
                onPress={() => jumpTo(i)}
              >
                <Image source={{ uri: p.uri }} style={styles.thumb} />
                {isCombined ? (
                  <View style={styles.thumbCombinedBadges}>
                    <View style={[styles.thumbBadgeMini, { backgroundColor: theme.modeBefore }]} />
                    <View style={[styles.thumbBadgeMini, { backgroundColor: theme.modeAfter }]} />
                  </View>
                ) : short ? (
                  <View style={[styles.thumbBadge, { backgroundColor: badgeColor }]}>
                    <Text style={[styles.thumbBadgeText, { color: role === PHOTO_MODES.BEFORE ? theme.accentText : '#FFFFFF' }]}>{short}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            </React.Fragment>
          );
        })}
      </ScrollView>

      <View style={{ height: 4 + insets.bottom + 50 + 8 }} />

      {/* Bottom nav moved to PersistentBottomNav (App.js root). */}

      {/* Edit dropdown removed — the EDIT button now goes straight to
          Studio, Delete lives as a trash icon on the photo, and the
          Include-in-Report toggle is the eye icon next to it. */}

      <Modal
        visible={roleDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleDropdownOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setRoleDropdownOpen(false)}>
          <View style={styles.dropdownBackdrop} />
        </TouchableWithoutFeedback>
        <View
          style={[
            styles.dropdownPanel,
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: theme.border,
              bottom: 4 + insets.bottom + 50 + 16 + 128 + 10,
            },
          ]}
        >
          {[
            { key: PHOTO_MODES.BEFORE, label: 'BEFORE', onPress: handleSetAsBefore },
            { key: PHOTO_MODES.PROGRESS, label: 'PROGRESS', onPress: handleSetAsProgress },
            { key: PHOTO_MODES.AFTER, label: 'AFTER', onPress: handleSetAsAfter },
            { key: PHOTO_MODES.COMBINED, label: 'COMBINED', onPress: handleSetAsCombined },
          ].map(({ key, label, onPress }, i, arr) => {
            const active = currentVisualRole === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.dropdownItem,
                  i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.divider },
                ]}
                onPress={() => {
                  setRoleDropdownOpen(false);
                  setTimeout(() => onPress(), 0);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    {
                      color: active ? theme.accent : theme.textPrimary,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {label}
                </Text>
                {active && <Ionicons name="checkmark" size={16} color={theme.accent} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitleWrap: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  headerTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
  },
  setsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  setsBarSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '32%',
  },
  setsBarSideRight: {
    justifyContent: 'flex-end',
  },
  setsBarSideText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    flexShrink: 1,
  },
  roomTabsContainer: {
    paddingVertical: 10,
  },
  roomTabsScrollContent: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 69,
    height: 63,
  },
  roomTabImage: {
    width: 35,
    height: 35,
  },
  roomTabText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    marginTop: 5,
    textAlign: 'center',
    letterSpacing: -0.1,
    flexShrink: 0,
  },
  thumbDateLine: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    paddingTop: 4,
    paddingBottom: 6,
  },
  positionPillWrap: {
    alignItems: 'center',
  },
  positionPill: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 100,
  },
  positionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  positionSetLine: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  pagerWrap: {
    position: 'relative',
  },
  pager: {
    flexGrow: 0,
  },
  pagerSlide: {
    width: SCREEN_W,
    paddingHorizontal: 16,
  },
  chev: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  chevLeft: { left: 24 },
  chevRight: { right: 24 },
  photoArea: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: { width: '100%', height: '100%' },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  modeBadgeSingle: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  combinedBadgeRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    gap: 6,
  },
  photoControlOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 8,
  },
  photoControlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoControlBtnDanger: {
    backgroundColor: 'rgba(219, 68, 70, 0.85)',
  },
  modeBadgeText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  controlBtn: {
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnEqual: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 8,
  },
  roleBtnSingle: {
    flexDirection: 'row',
  },
  dotsOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  setDot: {
    height: 6,
    borderRadius: 3,
  },
  bottomNavPill: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f4',
    borderRadius: 296,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 90,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
    height: 50,
  },
  navItemActive: {
    backgroundColor: '#E0E0E0',
    borderRadius: 100,
    marginHorizontal: -7,
  },
  navItemImage: { width: 22, height: 22 },
  navItemText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '510',
    color: '#1E1E1E',
    marginTop: 1,
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  navItemTextActive: { fontWeight: '590' },
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  editDropdownPanel: {
    left: 16,
    right: undefined,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  sheetActionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '500',
  },
  sheetCancel: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '600',
  },
  dropdownPanel: {
    position: 'absolute',
    right: 16,
    width: 200,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  dropdownItemText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    letterSpacing: 0.3,
  },
  controlBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  thumbStrip: {
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbSetGap: {
    width: 14,
  },
  thumbSetDivider: {
    alignSelf: 'center',
    width: 24,
    borderLeftWidth: 1,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
    marginRight: 4,
  },
  thumbSetDividerText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    transform: [{ rotate: '-90deg' }],
    width: 64,
    textAlign: 'center',
  },
  thumbDateDivider: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    borderLeftWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginLeft: 6,
    marginRight: 2,
  },
  thumbDateText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  thumb: { width: '100%', height: '100%' },
  thumbBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadgeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '800',
  },
  thumbCombinedBadges: {
    position: 'absolute',
    top: 4,
    left: 4,
    flexDirection: 'row',
    gap: 3,
  },
  thumbBadgeMini: {
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  studioBarWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  studioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  studioBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  emptyText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
  },
});

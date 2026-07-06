// Unified enlarged-photo viewer. One implementation backs every
// fullscreen photo flow in the app:
//   - Share preview        (SharePreviewScreen — wired)
//   - Timeline enlarged    (HomeScreen tappedFullPhoto — migration pending)
//   - Capture enlarged     (PhotoSetPreviewScreen — migration pending)
//
// The chrome is composed from props so each flow shows only the
// controls it needs:
//   showEdit         — pencil icon → onEdit(currentPhoto)
//   showSelect       — circular checkbox (matches the picker style)
//                      toggles via onToggleSelected(currentPhoto, nextValue)
//                      Reads selectedIds (Set<id>) to decide checked state
//                      so the photo stays in the pool even when "unchecked"
//   showOverlays     — Switch labelled "Overlays" (controls overlayMode)
//   overlayMode      — bool, mounts StudioEditOverlays on each photo when true
//   onClose          — required, fires when X is tapped
//   title / subtitle — optional header text (e.g. address + date for timeline)
//   shareLabel       — when set, renders a bottom action button with this label
//   onShare          — required when shareLabel is set, fires with currentPhoto
//
// Navigation between photos is a paging horizontal ScrollView (swipe
// + chevrons + N/M counter). Pool entries with no uri are filtered
// out up-front so the user never lands on an unrenderable frame.
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Dimensions, Switch, ScrollView, PanResponder, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import { FONTS } from '../constants/fonts';
import { StudioEditOverlays } from './StudioOverlays';
import PannableImage from './PannableImage';
import { usePhotos } from '../context/PhotoContext';

// Mirrors FORMAT_ASPECTS in StudioScreen + the report engine.
const FORMAT_ASPECTS = {
  square: 1,
  'wide-16-9': 16 / 9,
  'tall-9-16': 9 / 16,
  'wide-2-1': 2,
  'tall-1-2': 0.5,
};

// A combined photo's before/after halves are either stacked (top/bottom)
// or side-by-side (left/right). CameraScreen persists this as
// `photo.combinedLayout` when the composite is saved — that's the
// authoritative signal. Fall through to the source's orientation and
// finally the combined image's own dimensions so pre-2026-07 photos
// missing the field still resolve to the correct layout (a stacked
// composite is taller than wide; a side-by-side is wider than tall).
const combinedLayoutFor = (photo) => {
  if (!photo) return 'side';
  const stored = photo.combinedLayout;
  if (stored === 'stack' || stored === 'STACK') return 'stack';
  if (stored === 'side' || stored === 'SIDE') return 'side';
  if (photo.orientation === 'landscape' || photo.cameraViewMode === 'landscape') return 'stack';
  const w = photo.originalWidth || photo.width;
  const h = photo.originalHeight || photo.height;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    return h > w ? 'stack' : 'side';
  }
  return 'side';
};

// Per-frame component so each visible photo has its own load /
// error state. Photos whose URI loads cleanly render normally;
// photos whose URI is truthy but the file is gone (deleted on disk,
// stale iOS container path that auto-repair didn't catch, etc.) show
// a "Photo unavailable" placeholder so the user isn't staring at a
// silent white frame.
const PhotoFrame = ({ photo, overlayMode, frameW, frameH, theme }) => {
  const { t } = useTranslation();
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  // Reset transient render state if the photo id swaps (re-mount
  // happens automatically via key= in the pager but be defensive).
  React.useEffect(() => {
    setLoadFailed(false);
    setLoaded(false);
  }, [photo?.id, photo?.uri]);

  if (!photo) return <View style={{ width: frameW, height: frameH }} />;
  const showPlaceholder = !photo.uri || loadFailed;
  return (
    <View style={{ width: frameW, height: frameH, alignSelf: 'center', overflow: 'hidden', backgroundColor: theme.mode === 'dark' ? '#000' : '#F2F2F2', borderRadius: 6 }}>
      {photo.uri && !loadFailed ? (
        <Image
          source={{ uri: photo.uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
          onError={() => {
            console.warn('[EnlargedViewer] Image load failed for photo', photo.id, 'uri', String(photo.uri).slice(-60));
            setLoadFailed(true);
          }}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
      {showPlaceholder && (
        <View style={[styles.missing, { backgroundColor: theme.surfaceElevated || (theme.mode === 'dark' ? '#222' : '#F0F0F0') }]}>
          <Ionicons name="image-outline" size={36} color={theme.textMuted || '#888'} />
          <Text style={{ marginTop: 8, color: theme.textMuted || '#888', fontFamily: FONTS.ALEXANDRIA, fontSize: 12 }}>
            {t('gallery.photoUnavailable')}
          </Text>
        </View>
      )}
      {overlayMode && photo.uri && !loadFailed && loaded && (
        <StudioEditOverlays photo={photo} theme={theme} renderLabels combinedLayout={combinedLayoutFor(photo)} />
      )}
    </View>
  );
};

export default function EnlargedPhotoViewer({
  photos: rawPhotos,
  initialPhotoId,
  onClose,
  // Row 1 (set nav). setLabel renders as the centered title; the
  // prev/next chips flank it. Omit any of these to hide that slot.
  setLabel,
  prevSetLabel,
  nextSetLabel,
  onPrevSet,
  onNextSet,
  // Row 2 (close / select / delete). X is always shown via onClose.
  showSelect = false,
  selectedIds,
  onToggleSelected,
  showDelete = false,
  onDelete,
  // Bottom row (overlays switch + share + edit). Edit lives here
  // rather than in the top-right so it doesn't cluster with delete.
  showEdit = false,
  onEdit,
  showOverlays = false,
  overlaysOn = true,
  onOverlaysChange,
  // Bottom row 2 (share button).
  shareLabel,
  onShare,
  // Imperative scroll trigger. Parent passes { id, nonce } — every
  // bump of `nonce` makes the pager jump to the photo with that id.
  // Used by the set-nav chevrons to land on the first photo of the
  // previous/next set without exposing a ref.
  scrollSignal,
  // Fires the transient center-screen "Set N" flash when the parent
  // swaps the photo pool (e.g. after wrapping from last set → first
  // set on an edge swipe). Parent bumps `nonce` and provides `label`.
  poolChangeSignal,
}) {
  // Some screens (notably native-stack routes like PhotoSetPreview)
  // report 0 for the safe area top/bottom even though the viewer is
  // rendering into a frame that does extend under the status bar.
  // Floor the insets so the chrome never lands on the iOS status bar
  // or home indicator.
  const rawInsets = useSafeAreaInsets();
  const insets = useMemo(() => ({
    top: Math.max(rawInsets.top, 44),
    bottom: Math.max(rawInsets.bottom, 24),
    left: rawInsets.left,
    right: rawInsets.right,
  }), [rawInsets.top, rawInsets.bottom, rawInsets.left, rawInsets.right]);
  const theme = useTheme();
  const { t } = useTranslation();
  const screenW = Dimensions.get('window').width;
  const screenH = Dimensions.get('window').height;

  // Filter out entries with no uri up-front so the pager never lands
  // on an unrenderable frame ("photo not showing" issue). Stable order.
  const pool = useMemo(
    () => (Array.isArray(rawPhotos) ? rawPhotos.filter((p) => p && p.uri) : []),
    [rawPhotos]
  );

  // Pull the live PhotoContext entry per photo so per-photo edits in
  // Studio reflect here on return — overrides, markup, pairTemplate
  // all flow through automatically.
  const { photos: allLivePhotos } = usePhotos();
  const liveById = useMemo(() => {
    const m = new Map();
    for (const p of allLivePhotos) m.set(p.id, p);
    return m;
  }, [allLivePhotos]);

  const initialIdx = useMemo(() => {
    if (!initialPhotoId) return 0;
    const i = pool.findIndex((p) => p.id === initialPhotoId);
    return i >= 0 ? i : 0;
  }, [initialPhotoId, pool]);
  const [idx, setIdx] = useState(initialIdx);
  const scrollRef = useRef(null);

  // Scroll to initial idx on mount AND whenever the parent swaps the
  // pool (e.g., set-jump in capture flow). Without syncing `idx` to
  // `initialIdx` the pager scrolls visually but the internal cursor
  // stays at the previous slot, so goPrev/goNext + chrome (counter,
  // chevrons) read from a stale index.
  useEffect(() => {
    if (!scrollRef.current) return;
    setIdx(initialIdx);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ x: initialIdx * screenW, animated: false });
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIdx]);

  // Fullscreen zoom layer — set when the user taps the photo. Shows
  // a pinch/pan-zoomable view of the photo above the rest of the
  // chrome. Ref so the main backdrop's swipe-down responder can
  // disable itself while the zoom layer is open (otherwise the
  // PannableImage's 1-finger pan bubbles up and triggers the
  // viewer's close instead of moving the photo).
  const [zoomPhoto, setZoomPhoto] = useState(null);
  const zoomOpenRef = useRef(false);
  useEffect(() => { zoomOpenRef.current = !!zoomPhoto; }, [zoomPhoto]);


  // Swipe-down-to-close gesture. Captures only when the gesture is
  // clearly vertical-downward so it doesn't fight the horizontal
  // pager. Threshold: 80px down OR fast flick (>0.5 velocity).
  const makeDismissResponder = useCallback((onDismiss) => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => {
      // Bail out completely while the zoom layer is open — its
      // PannableImage owns 1-finger touches. Without this guard the
      // viewer's swipe-down close fires whenever the user tries to
      // drag the zoomed photo.
      if (zoomOpenRef.current) return false;
      return g.dy > 14 && Math.abs(g.dy) > Math.abs(g.dx) * 2;
    },
    onMoveShouldSetPanResponderCapture: () => false,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      if (zoomOpenRef.current) return;
      if (
        (g.dy > 80 || g.vy > 0.5) &&
        Math.abs(g.dy) > Math.abs(g.dx) * 1.5
      ) {
        if (typeof onDismiss === 'function') onDismiss();
      }
    },
  }), []);
  const closeViewerResponder = useMemo(
    () => makeDismissResponder(onClose),
    [makeDismissResponder, onClose]
  );
  // Zoom-layer gesture responder mirrors HomeScreen's
  // tappedFullPanResponder. PannableImage uses panOnLongPress
  // (default true) so 1-finger touches fall through to the parent
  // until a brief long-press arms drag-pan; we then claim 1-finger
  // horizontal swipes (navigate prev/next photo in the pool) and
  // 1-finger downward swipes (close the zoom layer). 2-finger
  // pinch always reaches PannableImage so zoom keeps working.
  const zoomPhotoRef = useRef(null);
  const zoomGestureResponder = useMemo(() => {
    const isHorizontalSwipe = (g) =>
      Math.abs(g.dx) > 30 &&
      Math.abs(g.dx) > Math.abs(g.dy) * 1.4 &&
      (Math.abs(g.vx) > 0.25 || Math.abs(g.dx) > 60);
    const isDownSwipe = (g) =>
      g.dy > 30 &&
      g.dy > Math.abs(g.dx) * 1.4 &&
      (g.vy > 0.25 || g.dy > 80);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, g) => {
        const touches = evt.nativeEvent?.touches?.length || 0;
        if (touches !== 1) return false;
        return isHorizontalSwipe(g) || isDownSwipe(g);
      },
      onPanResponderRelease: (_, g) => {
        if (isDownSwipe(g)) {
          setZoomPhoto(null);
          return;
        }
        if (isHorizontalSwipe(g)) {
          const currentZoom = zoomPhotoRef.current;
          if (!currentZoom) return;
          const idx = pool.findIndex((p) => p.id === currentZoom.id);
          const forward = g.dx < 0;
          const target = idx + (forward ? 1 : -1);
          if (target >= 0 && target < pool.length) {
            const next = pool[target];
            const live = liveById.get(next.id) || next;
            setZoomPhoto(live);
            // Keep the underlying pager in sync so closing returns
            // to the same photo the user last viewed here.
            setIdx(target);
            scrollRef.current?.scrollTo({ x: target * screenW, animated: false });
            return;
          }
          // Edge overscroll → delegate to the set-jump handler when
          // one is wired. The parent swaps the pool; the pool-sync
          // effect below moves the zoom to the new pool's first
          // photo so the fullscreen view stays open across sets.
          if (forward && typeof onNextSet === 'function') {
            onNextSet(currentZoom);
          } else if (!forward && typeof onPrevSet === 'function') {
            onPrevSet(currentZoom);
          }
        }
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [pool, liveById, screenW, onNextSet, onPrevSet]);
  useEffect(() => { zoomPhotoRef.current = zoomPhoto; }, [zoomPhoto]);

  // Sync the zoom photo to the pool after a set-jump. When the
  // parent swaps the pool (e.g. onNextSet handler fires while the
  // zoom layer is open), the currently-zoomed photo id may no
  // longer exist in the new pool — swap to the new pool's first
  // photo so the fullscreen view lands on Set N's opener instead
  // of showing a stale bitmap or closing itself.
  useEffect(() => {
    if (!zoomPhoto) return;
    if (pool.some((p) => p.id === zoomPhoto.id)) return;
    if (pool.length === 0) return;
    const nextRaw = pool[0];
    setZoomPhoto(liveById.get(nextRaw.id) || nextRaw);
  }, [pool, zoomPhoto, liveById]);

  // Transient label shown center-screen for ~500ms after a set jump.
  // Drives the dimmed "Set N" overlay so the user gets feedback that
  // the swipe just crossed into a new set.
  const [transientLabel, setTransientLabel] = useState(null);
  const transientTimerRef = useRef(null);
  // Imperative scroll — every time scrollSignal.nonce changes, jump
  // to the photo at scrollSignal.id (used by set-nav chevrons). If
  // the signal carries a `label`, also flash it as a dimmed overlay
  // on the new photo for 500ms.
  useEffect(() => {
    if (!scrollSignal?.id || !scrollRef.current) return;
    const i = pool.findIndex((p) => p.id === scrollSignal.id);
    if (i < 0) return;
    setIdx(i);
    scrollRef.current.scrollTo({ x: i * screenW, animated: true });
    if (scrollSignal.label) {
      setTransientLabel(scrollSignal.label);
      if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
      transientTimerRef.current = setTimeout(() => {
        setTransientLabel(null);
        transientTimerRef.current = null;
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollSignal?.nonce]);
  useEffect(() => () => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
  }, []);

  // Pool-swap transient. Fires whenever the parent bumps
  // poolChangeSignal.nonce — used by set-jump handlers so wrap-around
  // swipes (last set → first set) still get the "Set N" flash even
  // though there was no scrollSignal involved.
  useEffect(() => {
    if (!poolChangeSignal?.nonce || !poolChangeSignal?.label) return;
    setTransientLabel(poolChangeSignal.label);
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    transientTimerRef.current = setTimeout(() => {
      setTransientLabel(null);
      transientTimerRef.current = null;
    }, 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolChangeSignal?.nonce]);

  // Auto-close if the pool empties.
  useEffect(() => {
    if (pool.length === 0 && typeof onClose === 'function') onClose();
  }, [pool.length, onClose]);

  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, pool.length - 1));
  const currentStale = pool[safeIdx];
  const current = currentStale ? (liveById.get(currentStale.id) || currentStale) : null;

  // Theme-aware backdrop + controls. Light theme = white surface,
  // dark theme = near-black. Pill bg + icon color flip with mode.
  const isDark = theme.mode === 'dark';
  const backdropColor = theme.background || (isDark ? '#000' : '#FFF');
  const controlBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const controlIcon = isDark ? '#FFFFFF' : '#1A1A1A';

  // Allow callers to pass set-nav labels as strings or as functions
  // `(currentPhoto) => string` so the labels can derive from the
  // visible photo without a state roundtrip.
  const resolveLabel = (val) => {
    if (typeof val === 'function') return val(current);
    return val;
  };
  const setLabelResolved = resolveLabel(setLabel);
  const prevSetLabelResolved = resolveLabel(prevSetLabel);
  const nextSetLabelResolved = resolveLabel(nextSetLabel);

  // Top chrome = set nav row (when shown) + close-counter-delete row.
  // Bottom chrome = single row containing overlays + share + edit so
  // the photo gets the maximum vertical space possible. Edit lives
  // in the bottom row (right side) so the top row stays reserved for
  // the destructive delete + close actions.
  const setNavShown = !!(setLabelResolved || prevSetLabelResolved || nextSetLabelResolved);
  const bottomRowShown = showOverlays || !!shareLabel || showEdit;
  // Tightened header height — set nav row + (X close + N/M counter +
  // delete) row sit close together so the photo can start higher.
  // The N/M counter now lives in the center slot of the close row,
  // so we don't need a separate band for it above the action row.
  const HEADER_H = (setNavShown ? 36 : 0) + 44;
  const FOOTER_H = bottomRowShown ? 60 : 12;
  // Photo frame goes full bleed — no side padding so the photo gets
  // the entire screen width.
  const availW = screenW;
  const availH = screenH - (insets.top + HEADER_H) - (insets.bottom + FOOTER_H);

  // Per-photo frame — each page in the pager resolves its own aspect
  // from the photo's pairTemplate (Studio "format" chip), then native
  // aspect, then a screen fallback. The previous pooled-aspect mode
  // forced every photo to the same shape; we now honor whatever the
  // user saved in Studio so a format change shows up in the preview.
  const isValidAspect = (a) => typeof a === 'number' && isFinite(a) && a > 0.05 && a < 20;
  const computeFrame = useCallback((photo) => {
    const formatAspect = photo?.pairTemplate && FORMAT_ASPECTS[photo.pairTemplate];
    const rawNative = photo?.aspectRatio
      || (photo?.originalWidth && photo?.originalHeight
        ? photo.originalWidth / photo.originalHeight
        : null);
    const fallback = availW / availH;
    const aspect = isValidAspect(formatAspect)
      ? formatAspect
      : (isValidAspect(rawNative) ? rawNative : fallback);
    // Photo fills the full width; height derived from aspect, capped
    // at availH so the frame never bleeds into the chrome.
    const frameW = availW;
    const naturalH = frameW / aspect;
    const frameH = Math.min(naturalH, availH);
    return { frameW, frameH: Math.max(frameH, 200) };
  }, [availW, availH]);

  // Captures the user's swipe velocity at release. Paging ScrollView
  // snaps back to the current page when there's nothing past the
  // edge, so onMomentumScrollEnd alone can't tell intent. Recording
  // the drag velocity here lets us detect "user swiped past the last
  // page" → fire onNextSet (parent swaps the pool); same for first.
  const dragVxRef = useRef(0);
  const handleScrollEndDrag = (e) => {
    dragVxRef.current = e?.nativeEvent?.velocity?.x || 0;
  };
  const handleMomentumEnd = (e) => {
    const x = e?.nativeEvent?.contentOffset?.x || 0;
    const next = Math.round(x / screenW);
    const vx = dragVxRef.current;
    dragVxRef.current = 0;
    // Edge-overscroll → set jump. Negative vx == swipe right-to-left
    // (forward / next). Threshold low enough that a deliberate swipe
    // triggers it but a casual touch doesn't.
    const SWIPE_INTENT = 0.2;
    if (next >= pool.length - 1 && vx < -SWIPE_INTENT && typeof onNextSet === 'function') {
      onNextSet(current);
      return;
    }
    if (next <= 0 && vx > SWIPE_INTENT && typeof onPrevSet === 'function') {
      onPrevSet(current);
      return;
    }
    if (next !== safeIdx) setIdx(next);
  };

  const goPrev = () => {
    if (safeIdx <= 0) return;
    const next = safeIdx - 1;
    setIdx(next);
    scrollRef.current?.scrollTo({ x: next * screenW, animated: true });
  };
  const goNext = () => {
    if (safeIdx >= pool.length - 1) return;
    const next = safeIdx + 1;
    setIdx(next);
    scrollRef.current?.scrollTo({ x: next * screenW, animated: true });
  };

  // Edge-overscroll PanResponder. Sits between the backdrop and the
  // paging ScrollView so horizontal swipes at a set boundary (or any
  // horizontal swipe when the set has only one photo and the
  // ScrollView has nowhere to move) get claimed BEFORE they reach the
  // photo's TouchableWithoutFeedback (which would otherwise interpret
  // the swipe as a tap and open the zoom layer).
  //
  // Returns true from onMoveShouldSetPanResponder only for clearly-
  // horizontal motion AT THE RELEVANT EDGE — multi-photo non-edge
  // swipes fall through to ScrollView as usual.
  const edgeSwipeResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => {
        if (zoomOpenRef.current) return false;
        if (Math.abs(g.dx) < 20) return false;
        if (Math.abs(g.dx) < Math.abs(g.dy) * 1.5) return false;
        const atStart = safeIdx <= 0;
        const atEnd = safeIdx >= pool.length - 1;
        if (g.dx < 0 && atEnd && typeof onNextSet === 'function') return true;
        if (g.dx > 0 && atStart && typeof onPrevSet === 'function') return true;
        return false;
      },
      onPanResponderRelease: (_, g) => {
        const dist = Math.abs(g.dx);
        const vel = Math.abs(g.vx);
        const intent = dist > 50 || vel > 0.25;
        if (!intent) return;
        if (g.dx < 0 && typeof onNextSet === 'function') onNextSet(current);
        else if (g.dx > 0 && typeof onPrevSet === 'function') onPrevSet(current);
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [safeIdx, pool.length, onPrevSet, onNextSet, current]);

  const currentIsSelected = useMemo(() => {
    if (!showSelect || !current) return false;
    if (selectedIds instanceof Set) return selectedIds.has(current.id);
    if (Array.isArray(selectedIds)) return selectedIds.includes(current.id);
    return true; // default to selected when no set is provided
  }, [showSelect, current, selectedIds]);

  const handleToggleSelected = () => {
    if (!current || typeof onToggleSelected !== 'function') return;
    onToggleSelected(current, !currentIsSelected);
  };

  return (
    <View
      style={[styles.backdrop, { backgroundColor: backdropColor }]}
      {...closeViewerResponder.panHandlers}
    >
      {/* Top row 1 — set nav. Hidden when no set labels are passed. */}
      {setNavShown && (
        <View style={[styles.setNavRow, { top: insets.top + 8 }]}>
          {prevSetLabelResolved ? (
            <TouchableOpacity
              onPress={() => current && typeof onPrevSet === 'function' && onPrevSet(current)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.setNavSide}
            >
              <Ionicons name="chevron-back" size={16} color={controlIcon} />
              <Text style={[styles.setNavSideText, { color: controlIcon }]} numberOfLines={1}>{prevSetLabelResolved}</Text>
            </TouchableOpacity>
          ) : <View style={styles.setNavSide} />}
          {setLabelResolved ? (
            <Text style={[styles.setNavCenter, { color: theme.textPrimary }]} numberOfLines={1}>{setLabelResolved}</Text>
          ) : <View style={{ flex: 1 }} />}
          {nextSetLabelResolved ? (
            <TouchableOpacity
              onPress={() => current && typeof onNextSet === 'function' && onNextSet(current)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[styles.setNavSide, { justifyContent: 'flex-end' }]}
            >
              <Text style={[styles.setNavSideText, { color: controlIcon }]} numberOfLines={1}>{nextSetLabelResolved}</Text>
              <Ionicons name="chevron-forward" size={16} color={controlIcon} />
            </TouchableOpacity>
          ) : <View style={styles.setNavSide} />}
        </View>
      )}

      {/* Top row 2 — X close on left, N/M counter centered between
          X and edit/delete, optional select checkbox tucked next to
          X, edit pencil + optional delete trash on right. */}
      <View style={[styles.headerRow, { top: insets.top + (setNavShown ? 40 : 8) }]}>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.headerBtn, { backgroundColor: controlBg }]}
        >
          <Ionicons name="close" size={20} color={controlIcon} />
        </TouchableOpacity>
        {showSelect && (
          <TouchableOpacity
            onPress={handleToggleSelected}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.selectedCheck,
              {
                backgroundColor: currentIsSelected ? theme.accent : 'transparent',
                borderColor: currentIsSelected ? theme.accent : controlIcon,
              },
            ]}
          >
            {currentIsSelected && (
              <Ionicons name="checkmark" size={16} color={theme.accentText || '#000'} />
            )}
          </TouchableOpacity>
        )}
        <View style={{ flex: 1, alignItems: 'center' }}>
          {pool.length > 1 && (
            <View style={[styles.counterInline, { backgroundColor: controlBg }]}>
              <Text style={[styles.counterText, { color: controlIcon }]}>
                {safeIdx + 1} / {pool.length}
              </Text>
            </View>
          )}
        </View>
        {showDelete && (
          <TouchableOpacity
            onPress={() => current && typeof onDelete === 'function' && onDelete(current)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[styles.headerBtn, { backgroundColor: '#DC2626' }]}
          >
            <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Paging horizontal ScrollView — pinned to the available band
          between the header and footer so it can't overlap them.
          Without this absolute positioning the ScrollView centers
          vertically across the whole backdrop, which on tall photos
          (9:16) pushed the photo edge up into the X close row. Each
          page is exactly screenW so paging snaps cleanly. */}
      <View
        {...edgeSwipeResponder.panHandlers}
        style={{
          position: 'absolute',
          left: 0, right: 0,
          top: insets.top + HEADER_H,
          bottom: insets.bottom + FOOTER_H,
        }}
      >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumEnd}
        scrollEventThrottle={16}
        bounces={false}
        directionalLockEnabled
        style={{ flex: 1 }}
        contentContainerStyle={{ alignItems: 'center' }}
      >
        {pool.map((rawP) => {
          const liveP = liveById.get(rawP.id) || rawP;
          const { frameW, frameH } = computeFrame(liveP);
          return (
            <View key={rawP.id} style={{ width: screenW, height: availH, alignItems: 'center', justifyContent: 'center' }}>
              {/* Tap the photo to open the fullscreen zoom layer.
                  TouchableWithoutFeedback so we don't paint a press
                  state over the photo; horizontal swipes still reach
                  the pager because TouchableWithoutFeedback doesn't
                  claim move-responders. */}
              <TouchableWithoutFeedback onPress={() => setZoomPhoto(liveP)}>
                <View>
                  <PhotoFrame photo={liveP} overlayMode={overlaysOn} frameW={frameW} frameH={frameH} theme={theme} />
                </View>
              </TouchableWithoutFeedback>
            </View>
          );
        })}
      </ScrollView>
      </View>

      {/* Prev / next chevrons. The pills sit on top of the photo, so
          we use a fixed dark backdrop + white icon regardless of theme
          — the contrast reads on both bright and dark photos. */}
      {pool.length > 1 && (
        <>
          {safeIdx > 0 && (
            <TouchableOpacity onPress={goPrev} style={[styles.navChevron, { left: 8, top: '50%' }]} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
              <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}
          {safeIdx < pool.length - 1 && (
            <TouchableOpacity onPress={goNext} style={[styles.navChevron, { right: 8, top: '50%' }]} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
              <Ionicons name="chevron-forward" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Transient set-label overlay — a domed pill that appears on
          the new photo when the user jumps between sets via the
          prev/next set chips. Fades itself out after 500ms so the
          label confirms the jump without staying in the way. */}
      {transientLabel && (
        <View
          pointerEvents="none"
          style={[
            styles.transientLabelWrap,
            { top: insets.top + HEADER_H + Math.max(8, (availH - 60) / 2) },
          ]}
        >
          <View style={styles.transientLabel}>
            <Text style={styles.transientLabelText}>{transientLabel}</Text>
          </View>
        </View>
      )}

      {/* Single bottom row — overlays switch | share button | edit
          pencil. Edit sits on the right so it's easy to reach with
          the same thumb that took the photo; delete stays up top so
          the two are physically separated. */}
      {bottomRowShown && (
        <View style={[styles.bottomRow, { paddingBottom: insets.bottom + 8 }]}>
          {showOverlays ? (
            <View style={[styles.bottomSwitch, { backgroundColor: controlBg }]}>
              <Text style={[styles.headerSwitchLabel, { color: controlIcon }]}>{t('enlargedViewer.overlays')}</Text>
              <Switch
                value={overlaysOn}
                onValueChange={(v) => typeof onOverlaysChange === 'function' && onOverlaysChange(v)}
                trackColor={{ false: isDark ? '#444' : '#E0E0E0', true: theme.accent }}
                thumbColor="#FFFFFF"
                style={{ transform: [{ scale: 0.75 }] }}
              />
            </View>
          ) : <View />}
          {shareLabel ? (
            <TouchableOpacity
              onPress={() => current && typeof onShare === 'function' && onShare(current)}
              style={[styles.shareBtnInline, { backgroundColor: theme.accent }]}
              activeOpacity={0.85}
            >
              <Ionicons name="share-outline" size={16} color={theme.accentText || '#000'} />
              <Text style={[styles.shareBtnText, { color: theme.accentText || '#000' }]} numberOfLines={1}>
                {shareLabel}
              </Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          {showEdit && (
            <TouchableOpacity
              onPress={() => current && typeof onEdit === 'function' && onEdit(current)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={[styles.headerBtn, { backgroundColor: controlBg }]}
            >
              <Ionicons name="pencil" size={18} color={controlIcon} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Fullscreen zoom layer — photo frame fills the screen
          edge-to-edge. PannableImage uses panOnLongPress (default)
          so a 1-finger swipe falls through to the parent
          zoomGestureResponder (sideways navigates, downward closes).
          Briefly long-press then drag to pan; pinch always zooms.
          Reset button hidden. */}
      {zoomPhoto && (
        <View
          style={styles.zoomLayer}
          {...zoomGestureResponder.panHandlers}
        >
          <View style={{ width: screenW, height: screenH, overflow: 'hidden' }}>
            <PannableImage
              source={{ uri: zoomPhoto.uri }}
              style={{ width: '100%', height: '100%' }}
              imageStyle={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              fitMode="contain"
              panOnLongPress
              showResetButton
              resetBtnStyle={{ top: insets.top + 8 }}
            >
              {overlaysOn && (
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <StudioEditOverlays photo={zoomPhoto} theme={theme} renderLabels combinedLayout={combinedLayoutFor(zoomPhoto)} />
                </View>
              )}
            </PannableImage>
          </View>
          <View style={[styles.zoomHeader, { top: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={() => setZoomPhoto(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.zoomClose}
            >
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // zIndex bumped above the chevrons (20) and absolute ScrollView
    // pager (sibling order put it on top by default on iOS) so taps
    // on the X close / counter / delete row don't fall through to
    // the photo's TouchableWithoutFeedback and open the zoom layer.
    zIndex: 30,
    elevation: 30,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  selectedCheck: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  headerSwitchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14,
  },
  headerSwitchLabel: { fontFamily: FONTS.ALEXANDRIA, fontSize: 11 },
  setNavRow: {
    position: 'absolute',
    left: 16, right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    // Match the headerRow zIndex so set-chip taps don't fall
    // through to the photo's TouchableWithoutFeedback (which
    // would open the zoom layer instead of jumping sets).
    zIndex: 30,
    elevation: 30,
  },
  setNavSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  setNavSideText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 12, fontWeight: '600' },
  setNavCenter: {
    flex: 2,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomActionsRow: {
    position: 'absolute',
    left: 16, right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 9,
  },
  // Single bottom row: overlays switch | share button (flex) | edit
  // pencil. Anchored to the bottom; share button stretches to fill
  // the gap between the side controls.
  bottomRow: {
    position: 'absolute',
    left: 12, right: 12, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 9,
  },
  bottomSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  // Inline variant of the share button — flex 1 so it fills the row
  // between the overlays switch and the edit pencil, but with a
  // sensible min height and rounded full-pill shape.
  shareBtnInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: 100,
  },
  missing: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  navChevron: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -22,
    // Strong dim background so the chevron reads on any photo
    // (bright sky, dark interior, busy textures). Theme-independent
    // because the pill sits on the photo, not the screen backdrop.
    backgroundColor: 'rgba(0,0,0,0.55)',
    // Explicit zIndex/elevation — sibling order alone wasn't enough
    // on iOS for absolute children of the backdrop View; the
    // ScrollView's stacking context can put the pager on top.
    zIndex: 20,
    elevation: 20,
  },
  // Domed "Set N" overlay shown for 500ms after a set jump.
  // The outer wrap is absolutely positioned and uses flex centering
  // to anchor the pill in the horizontal middle of the screen; the
  // inner pill carries the background + text.
  transientLabelWrap: {
    position: 'absolute',
    left: 0, right: 0,
    alignItems: 'center',
    // Sits above the fullscreen zoom layer (zIndex 100) so the
    // "Set N" flash is visible even when the zoom overlay is open
    // and the user is swiping between sets from the zoomed view.
    zIndex: 150,
    elevation: 150,
  },
  transientLabel: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  transientLabelText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Fullscreen pinch/pan zoom layer — covers everything above the
  // backdrop, with its own swipe-down-to-close + X button. Layout
  // centers the photo frame horizontally + vertically, same as
  // HomeScreen's tappedFullPhoto backdrop pattern.
  zoomLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 100,
  },
  // Header strip inside the zoom layer — just the X close on the
  // left. Reset button comes from PannableImage and lands inside the
  // photo frame.
  zoomHeader: {
    position: 'absolute',
    left: 16, right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 110,
  },
  zoomClose: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  // Inline counter chip — fits in the X close header row's center
  // slot. Padding tightened vs. the old absolute-positioned counter.
  counterInline: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
  },
  counterText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 12 },
  footer: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 100,
    minWidth: 220,
  },
  shareBtnText: { fontFamily: FONTS.ALEXANDRIA, fontSize: 15, fontWeight: '700' },
});

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Switch,
  TextInput,
  Share,
  Alert,
  Modal,
  PanResponder,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  PixelRatio,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { PHOTO_MODES } from '../constants/rooms';
import { usePhotos } from '../context/PhotoContext';
import { compositeImages } from '../utils/imageCompositor';
import { savePhotoToDevice } from '../services/storage';
import { computeSetIds } from '../utils/photoSets';
import { useScopedSettings, usePromoteOverridesToGlobal, useResetPhotoOverrides } from '../hooks/useScopedSettings';
import { useTheme } from '../hooks/useTheme';
import PhotoLabels from '../components/PhotoLabels';
import DraggableLabelOverlay from '../components/DraggableLabelOverlay';
import PhotoWatermark from '../components/PhotoWatermark';
import DraggablePreviewItem from '../components/DraggablePreviewItem';
import PannableImage from '../components/PannableImage';
import CompareViewer from '../components/CompareViewer';
import { getLabelPositions } from '../constants/rooms';
import Svg, { Path, Line, Circle as SvgCircle, Polygon, Text as SvgText, G } from 'react-native-svg';
import { Audio } from 'expo-av';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

const TOOLBAR = [
  { key: 'layout', label: 'Layout', icon: 'crop-outline' },
  { key: 'branding', label: 'Labels', icon: 'pricetags-outline' },
  { key: 'notes', label: 'Notes', icon: 'document-text-outline' },
  { key: 'export', label: 'Export', icon: 'share-outline' },
];

const MARKUP_TOOLS = [
  { key: 'draw', label: 'Draw', icon: 'pencil-outline', defaultStroke: 3 },
  { key: 'brush', label: 'Brush', icon: 'brush-outline', defaultStroke: 8 },
  { key: 'highlight', label: 'Highlight', icon: 'color-fill-outline', defaultStroke: 16, opacity: 0.4 },
  { key: 'arrow', label: 'Arrow', icon: 'arrow-forward-outline', defaultStroke: 3 },
  { key: 'circle', label: 'Circle', icon: 'ellipse-outline', defaultStroke: 3 },
  { key: 'measure', label: 'Measure', icon: 'ruler-outline', defaultStroke: 2 },
  { key: 'text', label: 'Text', icon: 'chatbubble-ellipses-outline', defaultStroke: 0 },
];

const MARKUP_COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#007AFF', '#FFFFFF', '#000000'];
const MARKUP_STROKE_PRESETS = [
  { key: 'S', value: 2 },
  { key: 'M', value: 4 },
  { key: 'L', value: 8 },
];

// View modes only apply to COMBINED photos — single photos always render
// as a plain preview, so the VIEW MODE row is hidden for them. Order
// matches the segmented pill in the design: Side by Side (default) →
// Split → Overlay.
const VIEW_MODES = [
  { key: 'side', label: 'Side by Side' },
  { key: 'split', label: 'Split' },
  { key: 'overlay', label: 'Overlay' },
];

// Five fixed format chips. There's no separate "Default" chip — instead,
// each photo gets its OWN default chip auto-selected on first view based
// on its orientation / mode (see resolveDefaultFormat below). The user
// can override per-photo by tapping a different chip.
const FORMAT_TEMPLATES = [
  { key: 'square', label: 'Square', icon: 'square-outline' },
  { key: 'wide-16-9', label: '16:9', icon: 'tablet-landscape-outline' },
  { key: 'tall-9-16', label: '9:16', icon: 'phone-portrait-outline' },
  { key: 'wide-2-1', label: '2:1', icon: 'browsers-outline' },
  { key: 'tall-1-2', label: '1:2', icon: 'phone-portrait-outline' },
];

const FORMAT_ASPECTS = {
  square: 1,
  'wide-16-9': 16 / 9,
  'tall-9-16': 9 / 16,
  'wide-2-1': 2,
  'tall-1-2': 0.5,
};

const getPairTemplateAspect = (templateKey) => FORMAT_ASPECTS[templateKey] ?? 1;

// Auto-default — depends on photo mode AND, for combined photos, on the
// active view mode:
//   COMBINED + side-by-side  → Square  (the merged image is the artifact)
//   COMBINED + split/overlay → orientation of the source Before photo
//                              (16:9 landscape · 9:16 portrait)
//   Single photo             → bitmap-aspect bucket:
//                                ≥ 1.95 → 2:1
//                                ≥ 1.4  → 16:9
//                                ≥ 0.71 → Square
//                                ≥ 0.51 → 9:16
//                                else   → 1:2
const resolveDefaultFormat = (bitmapAspect, mode, viewMode, beforeOrientation) => {
  if (mode === PHOTO_MODES.COMBINED) {
    if (viewMode === 'side') return 'square';
    // Split or Overlay — CompareViewer renders the raw pair, so default
    // to the Before photo's natural orientation.
    return beforeOrientation === 'landscape' ? 'wide-16-9' : 'tall-9-16';
  }
  const a = bitmapAspect || 1;
  if (a >= 1.95) return 'wide-2-1';
  if (a >= 1.4) return 'wide-16-9';
  if (a >= 0.71) return 'square';
  if (a >= 0.51) return 'tall-9-16';
  return 'tall-1-2';
};

// Save-scope sheet options. The key stays 'room' because the in-memory
// scope state + downstream save helpers were named before the rename;
// only the user-facing label changes to "This Folder" to match the
// rest of the app's terminology (Sections/Folders, not Rooms).
const APPLY_SCOPES = [
  { key: 'photo', label: 'This Photo' },
  { key: 'room', label: 'This Folder' },
  { key: 'project', label: 'Project' },
];

const LABEL_POSITION_OPTIONS = [
  { key: 'left-top', icon: 'arrow-up-outline' },
  { key: 'center-top', icon: 'arrow-up-outline' },
  { key: 'right-top', icon: 'arrow-up-outline' },
  { key: 'left-bottom', icon: 'arrow-down-outline' },
  { key: 'center-bottom', icon: 'arrow-down-outline' },
  { key: 'right-bottom', icon: 'arrow-down-outline' },
];

const tsOf = (p) =>
  typeof p?.timestamp === 'number'
    ? p.timestamp
    : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);

const formatDate = (ts) =>
  ts
    ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

const modeBadgeText = (mode) => {
  if (mode === PHOTO_MODES.COMBINED) return 'BEFORE / AFTER';
  if (mode === PHOTO_MODES.BEFORE) return 'BEFORE';
  if (mode === PHOTO_MODES.AFTER) return 'AFTER';
  return 'PROGRESS';
};

const watermarkPositionStyle = (pos) => {
  // Position keys come from SettingsContext; same set the watermark editor
  // uses. We map them to absolute coordinates inside the photo area.
  switch (pos) {
    case 'top-left':      return { top: 8, left: 10, right: undefined, bottom: undefined, alignItems: 'flex-start' };
    case 'top-center':    return { top: 8, left: 0, right: 0, bottom: undefined, alignItems: 'center' };
    case 'top-right':     return { top: 8, right: 10, left: undefined, bottom: undefined, alignItems: 'flex-end' };
    case 'middle-left':   return { top: '50%', left: 10, alignItems: 'flex-start' };
    case 'middle-center': return { top: '50%', left: 0, right: 0, alignItems: 'center' };
    case 'middle-right':  return { top: '50%', right: 10, alignItems: 'flex-end' };
    case 'bottom-left':   return { bottom: 10, left: 10, alignItems: 'flex-start' };
    case 'bottom-center': return { bottom: 10, left: 0, right: 0, alignItems: 'center' };
    case 'bottom-right':
    default:              return { bottom: 10, right: 10, alignItems: 'flex-end' };
  }
};

const formatPhotoMeta = (photo, userLocation) => {
  const ts = typeof photo?.timestamp === 'number'
    ? photo.timestamp
    : (photo?.createdAt ? new Date(photo.createdAt).getTime() : 0);
  if (!ts) return '';
  const date = new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const where = (photo?.location || userLocation || '').toString().trim();
  return [date, time, where].filter(Boolean).join(' · ');
};

export default function StudioScreen({ route, navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { photos, updatePhoto } = usePhotos();
  // Lifted above the settings destructure so useScopedSettings sees
  // the photoId — every read here cascades photo.overrides over global,
  // and the writers passed to the brand/watermark tile toggles route
  // changes to photo.overrides so per-photo customizations persist.
  const studioPhotoId = route?.params?.photoId;
  const {
    getRooms,
    showLabels,
    toggleLabels,
    showWatermark,
    updateShowWatermark,
    customWatermarkEnabled,
    watermarkText,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkOffset,
    updateWatermarkOffset,
    brandLogoUri,
    showBrandLogo,
    updateBrandLogoUri,
    updateShowBrandLogo,
    brandLogoPosition,
    brandLogoSize,
    brandLogoOffset,
    updateBrandLogoOffset,
    showPreviewMetadata,
    togglePreviewMetadata,
    metaShowDate,
    metaShowTime,
    metaShowAddress,
    metaShowGps,
    setMetaField,
    metaPosition,
    metaColor,
    metaOpacity,
    metaFontSize,
    metaFontFamily,
    metaOffset,
    updateMetaOffset,
    labelMarginVertical,
    labelMarginHorizontal,
    location,
  } = useScopedSettings(studioPhotoId);

  const photoId = studioPhotoId;
  const photo = useMemo(
    () => (photoId ? photos.find((p) => String(p.id) === String(photoId)) : null),
    [photoId, photos]
  );

  const roomDataMap = useMemo(() => {
    const map = new Map();
    for (const r of (getRooms() || [])) map.set(r.id, r);
    return map;
  }, [getRooms]);
  const roomDisplayName =
    photo?.room ? (roomDataMap.get(photo.room)?.name || photo.room) : '';

  // All combined (Before/After merged) photos across every project, newest
  // first. Rendered as a grid on the empty Studio landing page so the user
  // can tap straight into the edit view for any existing combined photo.
  const combinedPhotos = useMemo(
    () =>
      (photos || [])
        .filter((p) => p?.mode === PHOTO_MODES.COMBINED && p?.uri)
        .sort((a, b) => tsOf(b) - tsOf(a)),
    [photos]
  );

  // Navigable list for swipe-to-next/prev inside the photo-edit view.
  // Walks every photo in the same project as the current photo, grouped by
  // room (alphabetical by room id), then by timestamp ascending. Combined
  // photos sort to the end of their set so the carousel reads
  // "Before → After → Combined" before crossing into the next set. When
  // no photo is open yet (grid view) the list is empty.
  const navigablePhotos = useMemo(() => {
    if (!photo) return [];
    const projectId = photo.projectId;
    const inProject = (photos || []).filter((p) => {
      if (!p?.uri) return false;
      // Match by project id when set; fall back to no-project (legacy) so
      // those photos still navigate among themselves.
      return (p.projectId || null) === (projectId || null);
    });
    const roomKey = (p) => (p.room || 'Unsorted');
    const combinedRank = (p) => (p.mode === PHOTO_MODES.COMBINED ? 1 : 0);
    return inProject.sort((a, b) => {
      const rk = String(roomKey(a)).localeCompare(String(roomKey(b)));
      if (rk !== 0) return rk;
      const ta = tsOf(a);
      const tb = tsOf(b);
      if (ta !== tb) return ta - tb;
      return combinedRank(a) - combinedRank(b);
    });
  }, [photo, photos]);

  const navigableIndex = useMemo(
    () => navigablePhotos.findIndex((p) => String(p.id) === String(photoId)),
    [navigablePhotos, photoId]
  );

  // Swipe-to-navigate: short horizontal swipe on the photo area jumps to
  // the previous / next photo in the navigable list. Touches without
  // significant horizontal motion (still touches → long-press for drag,
  // 2-finger pinches, taps) pass through to PannableImage.
  const goToPhotoAt = (index) => {
    if (index < 0 || index >= navigablePhotos.length) return;
    const next = navigablePhotos[index];
    if (!next || String(next.id) === String(photoId)) return;
    navigation.setParams({ photoId: next.id });
  };
  // Drawing PanResponder — one-shot create on mount. State is read via
  // refs so changing tool / color / stroke / active doesn't tear down
  // the responder mid-gesture (re-creating it via useMemo was the
  // culprit behind "markup doesn't work").
  const isMarkupActiveRef = useRef(false);
  const markupToolRef = useRef('draw');
  const markupColorRef = useRef('#FF3B30');
  const markupStrokeRef = useRef(4);
  useEffect(() => { isMarkupActiveRef.current = isMarkupActive; }, [isMarkupActive]);
  useEffect(() => { markupToolRef.current = markupTool; }, [markupTool]);
  useEffect(() => { markupColorRef.current = markupColor; }, [markupColor]);
  useEffect(() => { markupStrokeRef.current = markupStroke; }, [markupStroke]);

  const startMarkupShape = (x, y) => {
    const tool = markupToolRef.current;
    const base = {
      tool,
      color: markupColorRef.current,
      stroke: markupStrokeRef.current,
    };
    if (tool === 'draw' || tool === 'brush' || tool === 'highlight') {
      return { ...base, points: [{ x, y }] };
    }
    return { ...base, x1: x, y1: y, x2: x, y2: y };
  };
  const extendMarkupShape = (shape, x, y) => {
    if (!shape) return null;
    if (shape.tool === 'draw' || shape.tool === 'brush' || shape.tool === 'highlight') {
      return { ...shape, points: [...shape.points, { x, y }] };
    }
    return { ...shape, x2: x, y2: y };
  };
  const markupResponder = useRef(
    PanResponder.create({
      // CAPTURE-phase shouldSet runs top-down. Returning true here makes
      // the photoFrame the responder BEFORE PannableImage's wrapper (the
      // child) even gets a chance to refuse — guarantees markup-mode
      // touches go to the drawing handler regardless of any child
      // gesture handling quirks.
      onStartShouldSetPanResponderCapture: () => isMarkupActiveRef.current,
      onMoveShouldSetPanResponderCapture: () => isMarkupActiveRef.current,
      onStartShouldSetPanResponder: () => isMarkupActiveRef.current,
      onMoveShouldSetPanResponder: () => isMarkupActiveRef.current,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (!isMarkupActiveRef.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        if (markupToolRef.current === 'text') {
          setMarkupTextDraft({ visible: true, x: locationX, y: locationY, value: '' });
          return;
        }
        setMarkupInProgress(startMarkupShape(locationX, locationY));
      },
      onPanResponderMove: (evt) => {
        if (!isMarkupActiveRef.current || markupToolRef.current === 'text') return;
        const { locationX, locationY } = evt.nativeEvent;
        setMarkupInProgress((prev) => (prev ? extendMarkupShape(prev, locationX, locationY) : prev));
      },
      onPanResponderRelease: () => {
        if (markupToolRef.current === 'text') return;
        setMarkupInProgress((prev) => {
          if (prev) setMarkupShapes((shapes) => [...shapes, prev]);
          return null;
        });
      },
      onPanResponderTerminate: () => {
        setMarkupInProgress(null);
      },
    })
  ).current;

  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        // Don't claim on start — let PannableImage handle 2-finger pinch
        // and the long-press timer arm drag for single-finger.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (evt, gs) => {
          if (evt.nativeEvent.touches.length !== 1) return false;
          // Read the ref (not the closure variable) so toggling Markup
          // mode actually suppresses swipe-navigate even though this
          // useMemo doesn't list isMarkupActive in its deps.
          if (isMarkupActiveRef.current) return false;
          const horizontalDominant = Math.abs(gs.dx) > Math.abs(gs.dy) * 1.4;
          if (!horizontalDominant) return false;
          return Math.abs(gs.dx) > 20 || Math.abs(gs.vx) > 0.25;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_evt, gs) => {
          const enoughDistance = Math.abs(gs.dx) > 60;
          const enoughVelocity = Math.abs(gs.vx) > 0.25;
          if (!enoughDistance && !enoughVelocity) return;
          // Swipe LEFT (dx < 0) → next photo, swipe RIGHT → previous.
          if (gs.dx < 0) goToPhotoAt(navigableIndex + 1);
          else goToPhotoAt(navigableIndex - 1);
        },
      }),
    [navigableIndex, navigablePhotos, photoId]
  );

  const [activeTool, setActiveTool] = useState('layout');
  // Photo-area dimensions — measured on layout so the inner frame can be
  // sized to the template aspect without needing to know screen width.
  const [photoAreaLayout, setPhotoAreaLayout] = useState({ w: 0, h: 0 });

  // Track keyboard visibility so the Notes tool can shrink the photo area
  // and float the textarea directly above the keyboard (same pattern as
  // the Camera screen's Note modal).
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Markup state — annotation tools (draw, arrow, circle, etc.) drawn on
  // top of the picture. Persisted on the photo so they survive reload /
  // navigation. Drawing happens in photo-frame coordinates (not bitmap
  // coordinates) for simplicity — pan/zoom is disabled while markup is
  // active, so the picture is stationary while the user annotates.
  const [markupTool, setMarkupTool] = useState('draw');
  const [markupColor, setMarkupColor] = useState('#FF3B30');
  const [markupStroke, setMarkupStroke] = useState(4);
  const [markupShapes, setMarkupShapes] = useState([]);
  const [markupInProgress, setMarkupInProgress] = useState(null);
  const [markupTextDraft, setMarkupTextDraft] = useState({ visible: false, x: 0, y: 0, value: '' });
  const isMarkupActive = activeTool === 'markup';

  // Gesture hint overlay — fades out automatically and is throttled by
  // an AsyncStorage counter: after the user has seen it
  // HINT_MAX_SHOWS times total, it stops appearing for good. The counter
  // increments once per photo view that actually shows it. Tapping the
  // hint pill dismisses it immediately AND burns the remaining budget so
  // the user doesn't have to dismiss it again.
  const HINT_STORAGE_KEY = '@studio_gesture_hint_count';
  const HINT_MAX_SHOWS = 5;
  const hintOpacity = useRef(new Animated.Value(0)).current;
  const [hintBudgetExhausted, setHintBudgetExhausted] = useState(true);
  // `hintVisible` controls whether the overlay (and its TouchableOpacity)
  // is rendered at all. Tracking this in addition to opacity is what
  // prevents the invisible pill from eating touches in the photo center
  // and breaking markup / pan after the fade.
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(HINT_STORAGE_KEY);
        const count = stored ? parseInt(stored, 10) || 0 : 0;
        if (!cancelled) setHintBudgetExhausted(count >= HINT_MAX_SHOWS);
      } catch (_) {
        if (!cancelled) setHintBudgetExhausted(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!photo?.id || hintBudgetExhausted) return;
    hintOpacity.setValue(1);
    setHintVisible(true);
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(HINT_STORAGE_KEY);
        const next = (stored ? parseInt(stored, 10) || 0 : 0) + 1;
        await AsyncStorage.setItem(HINT_STORAGE_KEY, String(next));
        if (next >= HINT_MAX_SHOWS) setHintBudgetExhausted(true);
      } catch (_) {}
    })();
    const fadeAt = setTimeout(() => {
      Animated.timing(hintOpacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setHintVisible(false);
      });
    }, 2500);
    return () => clearTimeout(fadeAt);
  }, [photo?.id, hintBudgetExhausted, hintOpacity]);
  const dismissHint = async () => {
    Animated.timing(hintOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setHintVisible(false);
    });
    // Burn the rest of the budget — user has acknowledged the cue.
    try {
      await AsyncStorage.setItem(HINT_STORAGE_KEY, String(HINT_MAX_SHOWS));
    } catch (_) {}
    setHintBudgetExhausted(true);
  };
  // Hydrate from the photo when the active photo changes.
  useEffect(() => {
    const saved = Array.isArray(photo?.markup) ? photo.markup : [];
    setMarkupShapes(saved);
  }, [photo?.id]);
  // Persist on every shape mutation. Debounced via useEffect — runs once
  // after the markupShapes settles.
  useEffect(() => {
    if (!photo?.id) return;
    // Skip the very first run (hydration) — only persist user mutations.
    const saved = Array.isArray(photo?.markup) ? photo.markup : [];
    if (saved === markupShapes) return;
    updatePhoto(photo.id, { markup: markupShapes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markupShapes]);

  // Single photos (Before / After / Progress) always render as one plain
  // preview — the view-mode chips and the CompareViewer only make sense
  // when there's a Before+After pair to compare. The merged COMBINED
  // photo is the only mode that opts into the comparison UI.
  const isCombined = photo?.mode === PHOTO_MODES.COMBINED;
  // Save submenu — opens when the user taps Save in the header, exposes
  // the three apply-to scopes inline so the bottom of the screen stays
  // clean.
  const [saveMenuVisible, setSaveMenuVisible] = useState(false);
  const promoteOverridesToGlobal = usePromoteOverridesToGlobal();
  const resetPhotoOverrides = useResetPhotoOverrides();
  const [viewMode, setViewMode] = useState('side');
  // Initial pairTemplate is a neutral placeholder. The auto-default
  // effect below picks the right chip for each photo as it loads, but
  // if the photo already has a saved `pairTemplate` (set the last time
  // the user picked a chip for this photo) we use that instead so the
  // format follows the photo across screens and app launches.
  const [pairTemplate, setPairTemplateState] = useState('square');
  // Wrap setPairTemplate so every chip pick also persists onto the
  // active photo. The auto-default effect calls the raw setter
  // directly (via setPairTemplateState) so we don't accidentally write
  // the synthetic default into storage and steal the default-once gate.
  const setPairTemplate = useCallback(
    (next) => {
      setPairTemplateState(next);
      if (photo?.id && next && photo.pairTemplate !== next) {
        updatePhoto(photo.id, { pairTemplate: next });
      }
    },
    // photo is recomputed every render; pinning it by id keeps the
    // callback stable through identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [photo?.id, photo?.pairTemplate, updatePhoto]
  );
  // Tracks (photoId + viewMode) so each combination gets defaulted once
  // and the user's manual pick within that combination sticks.
  const lastDefaultedKeyRef = useRef(null);
  const [scope, setScope] = useState('photo');

  // Resolve the real Before + After source photos for compare modes.
  // CameraScreen storage layout:
  //   BEFORE   — { id, name, room, mode: 'before' }
  //   AFTER    — { id, name, room, mode: 'after', beforePhotoId: <BEFORE.id> }
  //   COMBINED — { id: `combined_${BEFORE.id}`, name, room, mode: 'mix' }
  //              (does NOT carry beforePhotoId — link is via id prefix and
  //              shared name+room)
  // Compare modes always want the raw pair, never the merged image, so for a
  // COMBINED target we recover its source Before via the id prefix / name.
  const pairResolved = useMemo(() => {
    if (!photo) return { beforePhoto: null, afterPhoto: null };
    const findRawAfter = (bpid) =>
      photos.find((p) => p.beforePhotoId === bpid && p.mode === PHOTO_MODES.AFTER);
    const resolveBeforeFromCombined = (combined) => {
      const idStr = String(combined.id || '');
      if (idStr.startsWith('combined_')) {
        const beforeIdStr = idStr.slice('combined_'.length);
        const direct = photos.find((p) => String(p.id) === beforeIdStr);
        if (direct) return direct;
      }
      if (combined.name && combined.room) {
        return photos.find(
          (p) =>
            p.name === combined.name &&
            p.room === combined.room &&
            p.mode === PHOTO_MODES.BEFORE
        );
      }
      return null;
    };

    let beforePhoto = null;
    let afterPhoto = null;
    if (photo.mode === PHOTO_MODES.BEFORE) {
      beforePhoto = photo;
      afterPhoto = findRawAfter(photo.id);
    } else if (photo.mode === PHOTO_MODES.AFTER) {
      afterPhoto = photo;
      if (photo.beforePhotoId) {
        beforePhoto = photos.find((p) => p.id === photo.beforePhotoId);
      }
    } else if (photo.mode === PHOTO_MODES.COMBINED) {
      beforePhoto = resolveBeforeFromCombined(photo);
      if (beforePhoto) afterPhoto = findRawAfter(beforePhoto.id);
    } else if (photo.beforePhotoId) {
      beforePhoto = photos.find((p) => p.id === photo.beforePhotoId);
      afterPhoto = findRawAfter(photo.beforePhotoId);
    }
    // Honor swap overrides saved on the active photo. The Layout
    // panel's "Change before/after" picker writes these so the user
    // can pair the combined with a different shot from the same set
    // without rebuilding the composite up-front (re-compositing is
    // wired in on save / share — this just retargets the preview +
    // pairResolved consumers).
    if (photo.beforeOverrideId) {
      const ov = photos.find((p) => p.id === photo.beforeOverrideId);
      if (ov) beforePhoto = ov;
    }
    if (photo.afterOverrideId) {
      const ov = photos.find((p) => p.id === photo.afterOverrideId);
      if (ov) afterPhoto = ov;
    }
    return { beforePhoto, afterPhoto };
  }, [photo, photos]);

  // Universal format set — same chips for every photo, so swiping
  // doesn't reset what the user picked.
  const availablePairTemplates = FORMAT_TEMPLATES;

  // Pool of swap candidates — the photos in the active SET (Before +
  // Progresses + After). Same list for both the Before and After
  // pickers: a Progress shot is a legal candidate for either slot,
  // and a Before can be swapped to the After slot (or vice-versa) if
  // the user prefers the framing. We use computeSetIds (scoped to
  // room+date) so the set membership matches the rest of the app
  // (Timeline, Reports). The active Combined itself is excluded — you
  // can't pair a composite with itself.
  const setSwapCandidates = useMemo(() => {
    if (!photo) return [];
    const room = photo.room;
    if (!room) return [];
    const photoTs = tsOf(photo);
    if (!photoTs) return [];
    const dayKey = new Date(photoTs).toLocaleDateString('en-CA');
    const sameRoomDay = photos.filter((p) => {
      if (p.room !== room) return false;
      const ts = tsOf(p);
      if (!ts) return false;
      return new Date(ts).toLocaleDateString('en-CA') === dayKey;
    });
    const setIdMap = computeSetIds(sameRoomDay);
    // The Combined's setId == its beforePhotoId (the Before anchors
    // the set). For a Before/After active photo, computeSetIds knows.
    // Legacy combined photos may lack beforePhotoId — recover it from
    // the `combined_<beforeId>` id prefix, same fallback pairResolved
    // uses. Last resort: trust computeSetIds' timestamp-order guess.
    const idStr = String(photo.id || '');
    const idPrefixBeforeId = idStr.startsWith('combined_')
      ? idStr.slice('combined_'.length)
      : null;
    const activeSetId = photo.mode === PHOTO_MODES.COMBINED
      ? (photo.beforePhotoId || idPrefixBeforeId || setIdMap.get(photo.id))
      : setIdMap.get(photo.id);
    if (!activeSetId) return [];
    return sameRoomDay
      .filter((p) => setIdMap.get(p.id) === activeSetId
        && p.mode !== PHOTO_MODES.COMBINED)
      .sort((a, b) => tsOf(a) - tsOf(b));
  }, [photo, photos]);
  // Convenience: at least two candidates means there's something to
  // swap with. Hidden when the set has only one source photo (just a
  // lone Before, no After or Progresses).
  const canSwap = setSwapCandidates.length >= 2;
  // LayoutPanel still asks per-card; both flags collapse to canSwap
  // since the picker now offers the same list either way.
  const canSwapBefore = canSwap;
  const canSwapAfter = canSwap;

  // Which slot the user is currently re-picking — 'before' / 'after' /
  // null. Drives the swap-picker Modal at the screen root.
  const [swapTargetSlot, setSwapTargetSlot] = useState(null);
  // True while we're re-compositing the combined bitmap after a swap.
  // Disables the picker + shows a spinner on the photo so taps don't
  // queue up while the native module is working.
  const [isRegeneratingComposite, setIsRegeneratingComposite] = useState(false);

  // Re-composite the COMBINED photo's bitmap using the given before /
  // after URIs, preserving the original layout (SIDE / STACK) so the
  // baked image actually changes the moment the user picks a new
  // source — not only at export time. Mirrors the camera's original
  // composite path (1:1 square output, sourceMaxWidth-driven size,
  // PixelRatio scaling on Android).
  const regenerateCombinedComposite = useCallback(async (beforeUri, afterUri) => {
    if (!photo?.id || !beforeUri || !afterUri) return null;
    const layout = (photo.combinedLayout === 'STACK') ? 'STACK' : 'SIDE';
    const pixelRatio = Platform.OS === 'android' ? PixelRatio.get() : 1;
    const getSize = (u) => new Promise((resolve) => {
      Image.getSize(u, (w, h) => resolve({
        w: Math.round(w * pixelRatio),
        h: Math.round(h * pixelRatio),
      }), () => resolve({ w: 1080, h: 1920 }));
    });
    const aSize = await getSize(beforeUri);
    const bSize = await getSize(afterUri);
    const sourceMaxWidth = Math.max(aSize.w, bSize.w);
    const totalW = Math.min(Math.max(sourceMaxWidth, 2048), 4096);
    const totalH = totalW;
    const dims = layout === 'STACK'
      ? { width: totalW, height: totalH, topH: Math.round(totalH / 2), bottomH: totalH - Math.round(totalH / 2) }
      : { width: totalW, height: totalH, leftW: Math.round(totalW / 2), rightW: totalW - Math.round(totalW / 2) };
    const capUri = await compositeImages(beforeUri, afterUri, layout, dims);
    const safeName = (photo.name || 'Photo').replace(/\s+/g, '_');
    const projectSuffix = photo.projectId ? `_P${photo.projectId}` : '';
    const filename = `${photo.room || 'Combined'}_${safeName}_COMBINED_BASE_${layout}_${Date.now()}${projectSuffix}.jpg`;
    return await savePhotoToDevice(capUri, filename, photo.projectId || null);
  }, [photo?.id, photo?.combinedLayout, photo?.name, photo?.room, photo?.projectId]);

  const handlePickSwap = async (picked) => {
    if (!photo?.id || !picked?.id || isRegeneratingComposite) {
      setSwapTargetSlot(null);
      return;
    }
    const targetSlot = swapTargetSlot;
    setSwapTargetSlot(null);
    if (targetSlot !== 'before' && targetSlot !== 'after') return;
    // No-op if the picked photo is already the resolved photo for
    // this slot. Saves an unnecessary regen and keeps overrides
    // sparse.
    const currentSlotPhoto = targetSlot === 'before'
      ? pairResolved.beforePhoto
      : pairResolved.afterPhoto;
    if (currentSlotPhoto?.id === picked.id) return;

    // Resolve the new before / after pair after applying this pick.
    // If the picked photo equals the natural anchor (i.e., it IS the
    // original Before / After), clear the override instead of saving
    // a redundant pointer.
    const naturalBeforeId = photo.beforePhotoId;
    const naturalAfter = photos.find(
      (p) => p.beforePhotoId === naturalBeforeId && p.mode === PHOTO_MODES.AFTER,
    );
    const updates = {};
    let newBefore = pairResolved.beforePhoto;
    let newAfter = pairResolved.afterPhoto;
    if (targetSlot === 'before') {
      updates.beforeOverrideId = picked.id === naturalBeforeId ? null : picked.id;
      newBefore = picked;
    } else {
      updates.afterOverrideId = picked.id === naturalAfter?.id ? null : picked.id;
      newAfter = picked;
    }
    if (!newBefore?.uri || !newAfter?.uri) {
      // No pair to composite — write override only.
      await updatePhoto(photo.id, updates);
      return;
    }
    // Re-composite with the new pair so the user sees the new picture
    // immediately. Fall back to override-only if native compositing
    // fails (the next render of pairResolved still picks up the
    // override for label rendering even without a fresh bitmap).
    setIsRegeneratingComposite(true);
    try {
      const newUri = await regenerateCombinedComposite(newBefore.uri, newAfter.uri);
      if (newUri) updates.uri = newUri;
    } catch (err) {
      console.warn('[StudioScreen] regenerate composite failed', err);
    } finally {
      await updatePhoto(photo.id, updates);
      setIsRegeneratingComposite(false);
    }
  };

  // Bitmap aspect tracked per-photo so we can apply each photo's
  // own default once we know its dimensions.
  const [bitmapInfo, setBitmapInfo] = useState({ photoId: null, aspect: 1 });
  useEffect(() => {
    const uri = photo?.uri;
    const id = photo?.id;
    if (!uri || !id) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => { if (!cancelled && h > 0) setBitmapInfo({ photoId: id, aspect: w / h }); },
      () => { /* no-op */ },
    );
    return () => { cancelled = true; };
  }, [photo?.uri, photo?.id]);

  // Hydrate / auto-default the chip ONCE PER PHOTO. Priority order:
  //   1. photo.pairTemplate — what the user (or a prior auto-default)
  //      already persisted. Wins, even on first load after a relaunch.
  //   2. resolveDefaultFormat — orientation/mode-aware best guess for
  //      a fresh photo. This is ALSO persisted on the photo so the
  //      format the user sees in Studio is the format every other
  //      screen (PhotoSetPreview, exports, etc.) uses without
  //      requiring the user to explicitly tap a chip first.
  // Switching view modes inside Studio never re-defaults; only a new
  // active photo does.
  useEffect(() => {
    if (!photo?.id) return;
    const key = `${photo.id}`;
    if (lastDefaultedKeyRef.current === key) return;

    if (photo.pairTemplate && FORMAT_ASPECTS[photo.pairTemplate] != null) {
      setPairTemplateState(photo.pairTemplate);
      lastDefaultedKeyRef.current = key;
      return;
    }

    if (photo.mode === PHOTO_MODES.COMBINED) {
      const beforeRef = pairResolved.beforePhoto;
      const beforeOrientation = beforeRef?.orientation || beforeRef?.cameraViewMode || 'portrait';
      const resolved = resolveDefaultFormat(bitmapInfo.aspect, photo.mode, viewMode, beforeOrientation);
      setPairTemplateState(resolved);
      updatePhoto(photo.id, { pairTemplate: resolved });
      lastDefaultedKeyRef.current = key;
      return;
    }

    if (bitmapInfo.photoId !== photo.id) return;
    const resolved = resolveDefaultFormat(bitmapInfo.aspect, photo.mode);
    setPairTemplateState(resolved);
    updatePhoto(photo.id, { pairTemplate: resolved });
    lastDefaultedKeyRef.current = key;
  }, [photo?.id, photo?.pairTemplate, photo?.mode, viewMode, bitmapInfo, pairResolved.beforePhoto, updatePhoto]);

  const templateAspect = getPairTemplateAspect(pairTemplate);

  // Picture (inner frame) sized to fit inside the measured photo-area box
  // at the selected template's aspect ratio. The outer photo area itself
  // is flex:1 — it fills whatever vertical space the layout has — so the
  // frame grows or shrinks with the available space (e.g. shrinks when a
  // bottom-sheet tool is open).
  const photoFrameSize = useMemo(() => {
    const { w, h } = photoAreaLayout;
    if (!w || !h) return { width: 0, height: 0 };
    if (templateAspect >= w / h) {
      return { width: w, height: w / templateAspect };
    }
    return { width: h * templateAspect, height: h };
  }, [templateAspect, photoAreaLayout]);

  // For COMBINED photos we overlay BEFORE / AFTER labels on each half of
  // the merged image. The split direction depends on how the merged
  // image was originally composited — and that is determined by the
  // camera orientation at capture time, not by the user's current
  // format pick. Portrait pairs are side-by-side, landscape pairs stack.
  const combinedIsStacked = useMemo(() => {
    const ref = pairResolved.beforePhoto || photo;
    return ref?.orientation === 'landscape' || ref?.cameraViewMode === 'landscape';
  }, [pairResolved.beforePhoto, photo]);

  if (!photo) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Studio</Text>
        </View>
        {combinedPhotos.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="brush-outline" size={64} color={theme.textMuted} />
            <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No combined photos yet</Text>
            <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
              Capture a Before and After pair to create a combined photo. It will appear here for editing.
            </Text>
          </View>
        ) : (
          <ScrollView
            // Bottom pad accounts for the PersistentBottomNav pill (~58px
            // including its own bottom offset) so the last grid row clears
            // the floating nav.
            contentContainerStyle={[styles.gridContent, { paddingBottom: 24 + insets.bottom + 60 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.grid}>
              {combinedPhotos.map((p) => {
                const room = p?.room ? (roomDataMap.get(p.room)?.name || p.room) : '';
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.gridItem, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('StudioDetail', { photoId: p.id })}
                  >
                    <Image source={{ uri: p.uri }} style={styles.gridItemImage} resizeMode="cover" />
                    <View style={styles.gridItemFooter}>
                      <Text style={[styles.gridItemTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                        {room || 'Combined'}
                      </Text>
                      <Text style={[styles.gridItemSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                        {formatDate(tsOf(p))}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  const beforeForCompare = pairResolved.beforePhoto;
  const afterForCompare = pairResolved.afterPhoto;

  // VIEW MODE drives the render for combined photos:
  //   • 'side' (default) → merged combined bitmap in PannableImage, so
  //     drag/pinch act on the whole picture (the natural editor flow).
  //   • 'split'  → CompareViewer with a draggable divider between
  //     the resolved Before + After sources.
  //   • 'overlay' → CompareViewer cross-fading Before / After.
  // Single photos (Before/After/Progress) always render as PannableImage.
  const compareMode = viewMode === 'split' ? 'split' : viewMode === 'overlay' ? 'overlay' : 'side-by-side';
  const showComparison =
    isCombined &&
    (viewMode === 'split' || viewMode === 'overlay') &&
    !!beforeForCompare &&
    !!afterForCompare;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {roomDisplayName || 'Studio'}
          </Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>
            {formatDate(tsOf(photo))}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: theme.accent }]}
          onPress={() => setSaveMenuVisible(true)}
        >
          <Text style={[styles.saveBtnText, { color: theme.accentText }]}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Default minimal caption above the picture — always visible. The
          on-picture overlay (with field toggles + position + styling) is
          gated on the user's `showPreviewMetadata` switch. */}
      <Text style={[styles.metaLine, { color: theme.textSecondary }]} numberOfLines={1}>
        {formatPhotoMeta(photo, location)}
      </Text>

      <View
        style={[
          styles.photoArea,
          { backgroundColor: theme.background },
          // While editing a note with the keyboard up, collapse the photo
          // area so the textarea + toolbar slot comfortably above the
          // keyboard (matches the Camera note-modal pattern).
          keyboardVisible && activeTool === 'notes' && styles.photoAreaCompact,
        ]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setPhotoAreaLayout((prev) =>
            prev.w === width && prev.h === height ? prev : { w: width, h: height }
          );
        }}
        {...swipeResponder.panHandlers}
      >
        <View
          style={[
            styles.photoFrame,
            {
              width: photoFrameSize.width,
              height: photoFrameSize.height,
              backgroundColor: theme.surface,
            },
          ]}
          {...markupResponder.panHandlers}
        >
        {showComparison ? (
          <CompareViewer
            beforePhoto={beforeForCompare}
            afterPhoto={afterForCompare}
            mode={compareMode}
            // Match the photoFrame's aspect so Split / Overlay fill the
            // default viewport instead of forcing CompareViewer's
            // built-in 1:1 fallback. Also strip CompareViewer's
            // 400-px max cap so it can take the full frame.
            frameAspectRatio={templateAspect}
            style={{ maxWidth: undefined, maxHeight: undefined, width: '100%', height: '100%', borderWidth: 0 }}
            renderBeforeOverlay={() => <PhotoLabels photo={beforeForCompare} role="before" />}
            renderAfterOverlay={() => <PhotoLabels photo={afterForCompare} role="after" />}
          />
        ) : (
          <>
            <PannableImage
              imageKey={photo.uri || photo.id}
              source={{ uri: photo.uri }}
              style={styles.photo}
              resizeMode="cover"
              disabled={activeTool !== 'layout'}
            />
            {/* Labels live OUTSIDE PannableImage so they anchor to the
                photoFrame's corners — not the photo content. PannableImage
                centers an overflowing Animated.View when frame and bitmap
                aspects disagree (e.g. portrait photo in a 16:9 frame), so
                a label placed inside its children would be clipped off
                the top by the wrapper's overflow:hidden. Anchoring to the
                frame keeps "top-left stays top-left" true across format
                changes. */}
            {/* DraggableLabelOverlay = PhotoLabels + finger-drag. The
                user's drag updates beforeLabelOffset/afterLabelOffset
                in SettingsContext, so the new position takes effect
                everywhere else (Home, Gallery, bake pipeline) too. */}
            {photo.mode !== PHOTO_MODES.COMBINED && (
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                <DraggableLabelOverlay photo={photo} />
              </View>
            )}
            {photo.mode === PHOTO_MODES.COMBINED && (
              <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                <View pointerEvents="box-none" style={combinedIsStacked ? styles.combinedHalfTop : styles.combinedHalfLeft}>
                  <DraggableLabelOverlay photo={pairResolved.beforePhoto || photo} role="before" />
                </View>
                <View pointerEvents="box-none" style={combinedIsStacked ? styles.combinedHalfBottom : styles.combinedHalfRight}>
                  <DraggableLabelOverlay photo={pairResolved.afterPhoto || photo} role="after" />
                </View>
              </View>
            )}
          </>
        )}
        {/* Studio preview mirrors the user's toggle directly. The export
            pipeline still consults `shouldShowWatermark` so soft-trial
            branding stays enforced on the final image — preview just
            shouldn't lie about the toggle. */}
        {showWatermark && photoFrameSize.width > 0 && photoFrameSize.height > 0 && (
          <DraggablePreviewItem
            bounds={{ x: 0, y: 0, w: photoFrameSize.width, h: photoFrameSize.height }}
            offset={watermarkOffset}
            fallbackPositionKey={watermarkPosition || 'right-bottom'}
            marginV={labelMarginVertical ?? 10}
            marginH={labelMarginHorizontal ?? 10}
            onOffsetChange={updateWatermarkOffset}
          >
            <PhotoWatermark photo={photo} style={{ position: 'relative' }} />
          </DraggablePreviewItem>
        )}
        {/* Brand logo overlay — only when the user has uploaded one and
            the Logo toggle is on. Size and position come from the
            dedicated Logo Customization screen. */}
        {showBrandLogo && brandLogoUri && photoFrameSize.width > 0 && photoFrameSize.height > 0 && (
          <DraggablePreviewItem
            bounds={{ x: 0, y: 0, w: photoFrameSize.width, h: photoFrameSize.height }}
            offset={brandLogoOffset}
            fallbackPositionKey={brandLogoPosition || 'right-bottom'}
            marginV={labelMarginVertical ?? 10}
            marginH={labelMarginHorizontal ?? 10}
            onOffsetChange={updateBrandLogoOffset}
          >
            <BrandLogoOverlay
              uri={brandLogoUri}
              size={brandLogoSize}
            />
          </DraggablePreviewItem>
        )}
        {/* Metadata overlay on the picture — fields, position, color,
            opacity and font size all come from the dedicated Metadata
            Customization screen. */}
        {showPreviewMetadata && photoFrameSize.width > 0 && photoFrameSize.height > 0 && (
          <DraggablePreviewItem
            bounds={{ x: 0, y: 0, w: photoFrameSize.width, h: photoFrameSize.height }}
            offset={metaOffset}
            fallbackPositionKey={metaPosition || 'left-bottom'}
            marginV={labelMarginVertical ?? 10}
            marginH={labelMarginHorizontal ?? 10}
            onOffsetChange={updateMetaOffset}
            containerStyle={{ opacity: typeof metaOpacity === 'number' ? metaOpacity : 0.85 }}
          >
            <MetadataOverlay
              photo={photo}
              location={location}
              showDate={metaShowDate}
              showTime={metaShowTime}
              showAddress={metaShowAddress}
              showGps={metaShowGps}
              color={metaColor}
              fontSize={metaFontSize}
              fontFamily={metaFontFamily}
            />
          </DraggablePreviewItem>
        )}
        {/* Re-composite spinner — covers the photo while the native
            module rebuilds the combined bitmap from the picked Before /
            After. Without this the user sees the OLD picture for ~1s
            after picking a swap, which reads as "nothing happened". */}
        {isRegeneratingComposite && (
          <View style={styles.regenOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.regenOverlayText}>Updating combined…</Text>
          </View>
        )}
        {/* Split / Overlay need the raw Before + After. If we can't
            resolve them for this combined photo, drop a hint instead of
            silently falling back to the merged image. */}
        {isCombined &&
          (viewMode === 'split' || viewMode === 'overlay') &&
          !showComparison && (
            <View style={[styles.pairMissingOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
              <Ionicons name="information-circle-outline" size={20} color="#FFFFFF" />
              <Text style={styles.pairMissingText}>
                {viewMode === 'split' ? 'Split' : 'Overlay'} needs the original
                Before + After — couldn't find them for this combined photo.
                Showing the merged image instead.
              </Text>
            </View>
          )}
        {/* Markup overlay rendered from the saved photo.markup. The
            MarkupEditor screen owns drawing/editing; here we just
            display. Supports both the legacy raw-array format and the
            new { bounds, shapes } format. Using a viewBox lets the same
            shapes render proportionally in a photoFrame of any size. */}
        {(() => {
          const m = photo?.markup;
          const shapes = Array.isArray(m) ? m : (m && Array.isArray(m.shapes) ? m.shapes : []);
          if (shapes.length === 0) return null;
          const bounds = (m && m.bounds && m.bounds.w > 0 && m.bounds.h > 0) ? m.bounds : null;
          return (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Svg
                width="100%"
                height="100%"
                viewBox={bounds ? `0 0 ${bounds.w} ${bounds.h}` : undefined}
                preserveAspectRatio="xMidYMid meet"
              >
                {shapes.map((shape, i) => (
                  <MarkupShape key={`s-${i}`} shape={shape} theme={theme} />
                ))}
              </Svg>
            </View>
          );
        })()}
        {/* First-look gesture hint — only rendered while actively
            showing, so after the fade completes the TouchableOpacity
            doesn't sit invisibly over the photo eating taps (was
            breaking markup drawing in the photo center). */}
        {hintVisible && (
          <Animated.View
            pointerEvents="box-none"
            style={[styles.gestureHint, { opacity: hintOpacity }]}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={dismissHint}
              style={styles.gestureHintInner}
            >
              <Ionicons name="move-outline" size={32} color="#FFFFFF" />
              <Text style={styles.gestureHintText}>
                Long-press to drag · Pinch to zoom · Swipe to navigate
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Inline text input for the 'text' markup tool — modal-less. */}
        {markupTextDraft.visible && isMarkupActive && (
          <View
            style={[
              styles.markupTextDraft,
              { left: markupTextDraft.x, top: markupTextDraft.y, borderColor: markupColor },
            ]}
          >
            <TextInput
              autoFocus
              value={markupTextDraft.value}
              onChangeText={(v) => setMarkupTextDraft((d) => ({ ...d, value: v }))}
              placeholder="Type…"
              placeholderTextColor="#999"
              style={[styles.markupTextDraftInput, { color: markupColor }]}
              onBlur={() => {
                const text = markupTextDraft.value.trim();
                if (text) {
                  setMarkupShapes((s) => [...s, {
                    tool: 'text',
                    color: markupColor,
                    stroke: 0,
                    x: markupTextDraft.x,
                    y: markupTextDraft.y,
                    text,
                  }]);
                }
                setMarkupTextDraft({ visible: false, x: 0, y: 0, value: '' });
              }}
              onSubmitEditing={() => {
                const text = markupTextDraft.value.trim();
                if (text) {
                  setMarkupShapes((s) => [...s, {
                    tool: 'text',
                    color: markupColor,
                    stroke: 0,
                    x: markupTextDraft.x,
                    y: markupTextDraft.y,
                    text,
                  }]);
                }
                setMarkupTextDraft({ visible: false, x: 0, y: 0, value: '' });
              }}
              returnKeyType="done"
            />
          </View>
        )}
        </View>
      </View>

      <ScrollView
        style={styles.toolPanel}
        contentContainerStyle={styles.toolPanelContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {activeTool === 'layout' && (
          <LayoutPanel
            theme={theme}
            viewMode={viewMode}
            setViewMode={setViewMode}
            isCombined={isCombined}
            pairTemplate={pairTemplate}
            setPairTemplate={setPairTemplate}
            availablePairTemplates={availablePairTemplates}
            scope={scope}
            setScope={setScope}
            beforePhoto={pairResolved.beforePhoto}
            afterPhoto={pairResolved.afterPhoto}
            // The Layout panel decides per-card which Change to
            // render based on the active photo's role + whether
            // there's anywhere to swap to in the room.
            activePhotoMode={photo?.mode}
            canSwapBefore={canSwapBefore}
            canSwapAfter={canSwapAfter}
            onChangeBefore={() => setSwapTargetSlot('before')}
            onChangeAfter={() => setSwapTargetSlot('after')}
          />
        )}
        {activeTool === 'labels' && (
          <LabelsPanel
            theme={theme}
            navigation={navigation}
            showLabels={showLabels}
            toggleLabels={toggleLabels}
            scope={scope}
            setScope={setScope}
          />
        )}
        {activeTool === 'markup' && (
          <MarkupPanel
            theme={theme}
            markupTool={markupTool}
            setMarkupTool={setMarkupTool}
            markupColor={markupColor}
            setMarkupColor={setMarkupColor}
            markupStroke={markupStroke}
            setMarkupStroke={setMarkupStroke}
            onUndo={() => setMarkupShapes((s) => s.slice(0, -1))}
            onClear={() => setMarkupShapes([])}
            shapeCount={markupShapes.length}
            scope={scope}
            setScope={setScope}
          />
        )}
        {activeTool === 'notes' && (
          <NotesPanel
            theme={theme}
            photo={photo}
            updatePhoto={updatePhoto}
            scope={scope}
            setScope={setScope}
            setActiveTool={setActiveTool}
            navigation={navigation}
          />
        )}
        {activeTool === 'branding' && (
          <BrandingPanel
            theme={theme}
            navigation={navigation}
            photoId={photo?.id}
            brandLogoUri={brandLogoUri}
            showBrandLogo={showBrandLogo}
            updateShowBrandLogo={updateShowBrandLogo}
            showWatermark={showWatermark}
            updateShowWatermark={updateShowWatermark}
            watermarkText={watermarkText}
            showPreviewMetadata={showPreviewMetadata}
            togglePreviewMetadata={togglePreviewMetadata}
            showLabels={showLabels}
            toggleLabels={toggleLabels}
          />
        )}
        {activeTool === 'export' && (
          <ExportPanel theme={theme} navigation={navigation} photo={photo} />
        )}
      </ScrollView>

      <View
        style={[
          styles.toolbar,
          {
            backgroundColor: theme.surfaceElevated,
            borderTopColor: theme.border,
            paddingBottom: 6 + insets.bottom,
          },
        ]}
      >
        {TOOLBAR.map((tool) => {
          const isActive = activeTool === tool.key;
          return (
            <TouchableOpacity
              key={tool.key}
              style={styles.toolBtn}
              onPress={() => {
                // Markup goes to a dedicated full-screen editor — no
                // competing gestures, no swipe navigation, just a
                // canvas + tools. Solves "the picture swipes when I try
                // to draw" once and for all.
                if (tool.key === 'markup') {
                  navigation.navigate('MarkupEditor', { photoId: photo.id });
                  return;
                }
                setActiveTool(tool.key);
              }}
            >
              <Ionicons
                name={tool.icon}
                size={22}
                color={isActive ? theme.accent : theme.textPrimary}
              />
              <Text
                style={[
                  styles.toolBtnText,
                  { color: isActive ? theme.accent : theme.textSecondary, fontWeight: isActive ? '700' : '500' },
                ]}
              >
                {tool.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      </KeyboardAvoidingView>

      {/* Swap picker — opens from the Layout panel's Change-before /
          Change-after buttons. Shows every photo in the active set
          as a thumbnail grid; tap one to retarget the slot. The
          picker writes beforeOverrideId / afterOverrideId on the
          active photo (see updatePhoto call in handlePickSwap), and
          pairResolved consumes those overrides on the next render. */}
      <Modal
        visible={!!swapTargetSlot}
        transparent
        animationType="fade"
        onRequestClose={() => setSwapTargetSlot(null)}
      >
        <TouchableWithoutFeedback onPress={() => setSwapTargetSlot(null)}>
          <View style={styles.saveMenuBackdrop} />
        </TouchableWithoutFeedback>
        <View
          style={[
            styles.swapPickerSheet,
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: theme.border,
              paddingBottom: 12 + insets.bottom,
            },
          ]}
        >
          <Text style={[styles.swapPickerTitle, { color: theme.textPrimary }]}>
            {swapTargetSlot === 'before' ? 'Change Before' : swapTargetSlot === 'after' ? 'Change After' : 'Change photo'}
          </Text>
          <Text style={[styles.swapPickerSubtitle, { color: theme.textSecondary }]}>
            Pick a photo from this set
          </Text>
          <ScrollView
            horizontal={false}
            contentContainerStyle={styles.swapPickerGrid}
            showsVerticalScrollIndicator={false}
          >
            {setSwapCandidates.map((m) => {
              const isCurrent = swapTargetSlot === 'before'
                ? pairResolved.beforePhoto?.id === m.id
                : pairResolved.afterPhoto?.id === m.id;
              // Effective role for THIS combined view: a Progress that's
              // currently slotted as the Before reads as "Before" here,
              // so the chip matches what the combined renders.
              const effectiveRole = pairResolved.beforePhoto?.id === m.id
                ? 'before'
                : pairResolved.afterPhoto?.id === m.id
                  ? 'after'
                  : m.mode === PHOTO_MODES.BEFORE
                    ? 'before'
                    : m.mode === PHOTO_MODES.AFTER
                      ? 'after'
                      : 'progress';
              const roleLabel = effectiveRole === 'before'
                ? 'Before'
                : effectiveRole === 'after'
                  ? 'After'
                  : 'Progress';
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.swapPickerTile,
                    {
                      borderColor: isCurrent ? theme.accent : theme.border,
                      borderWidth: isCurrent ? 2 : StyleSheet.hairlineWidth,
                    },
                  ]}
                  onPress={() => handlePickSwap(m)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: m.uri }} style={styles.swapPickerThumb} resizeMode="cover" />
                  <Text style={[styles.swapPickerLabel, { color: theme.textPrimary }]} numberOfLines={1}>
                    {roleLabel}
                  </Text>
                  {isCurrent && (
                    <View style={[styles.swapPickerCurrent, { backgroundColor: theme.accent }]}>
                      <Ionicons name="checkmark" size={12} color={theme.accentText} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.saveMenuCancel, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => setSwapTargetSlot(null)}
          >
            <Text style={[styles.saveMenuCancelText, { color: theme.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Save submenu — tapping Save in the header pops up these three
          scope options. Picking one persists the chosen scope and
          closes the screen. Tapping outside the sheet dismisses. */}
      <Modal
        visible={saveMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveMenuVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSaveMenuVisible(false)}>
          <View style={styles.saveMenuBackdrop} />
        </TouchableWithoutFeedback>
        <View
          style={[
            styles.saveMenuSheet,
            {
              backgroundColor: theme.surfaceElevated,
              borderColor: theme.border,
              paddingBottom: 12 + insets.bottom,
            },
          ]}
        >
          <Text style={[styles.saveMenuTitle, { color: theme.textPrimary }]}>Apply changes to…</Text>
          {APPLY_SCOPES.map((s, i) => (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.saveMenuOption,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
              ]}
              onPress={async () => {
                setScope(s.key);
                setSaveMenuVisible(false);
                // 'photo' — overrides are already on the photo from
                // each tile tap; just close. 'project' — promote this
                // photo's overrides up to global Settings + drop them.
                // 'room' — TODO: apply to other photos in the room
                // (for now behaves like 'photo').
                if (s.key === 'project' && photo?.id) {
                  try { await promoteOverridesToGlobal(photo.id); } catch (_) {}
                }
                navigation.goBack();
              }}
            >
              <Text style={[styles.saveMenuOptionText, { color: theme.textPrimary }]}>{s.label}</Text>
              {scope === s.key && (
                <Ionicons name="checkmark" size={18} color={theme.accent} />
              )}
            </TouchableOpacity>
          ))}
          {/* Reset action — drops this photo's overrides so it follows
              global Settings again. Hidden when the photo has nothing
              custom to reset. */}
          {photo?.overrides && Object.keys(photo.overrides).length > 0 && (
            <TouchableOpacity
              style={[
                styles.saveMenuOption,
                { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
              ]}
              onPress={async () => {
                try { await resetPhotoOverrides(photo.id); } catch (_) {}
                setSaveMenuVisible(false);
              }}
            >
              <Text style={[styles.saveMenuOptionText, { color: theme.danger || '#FF3B30' }]}>Reset this photo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.saveMenuCancel, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => setSaveMenuVisible(false)}
          >
            <Text style={[styles.saveMenuCancelText, { color: theme.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ---- Panels --------------------------------------------------------------

function ScopePicker({ theme, scope, setScope }) {
  return (
    <View style={styles.scopeBlock}>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>APPLY TO</Text>
      <View style={styles.scopeRow}>
        {APPLY_SCOPES.map((s) => {
          const isActive = scope === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.scopeBtn,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setScope(s.key)}
            >
              <Text
                style={[
                  styles.scopeBtnText,
                  { color: isActive ? theme.accentText : theme.textPrimary },
                ]}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function LayoutPanel({
  theme,
  viewMode,
  setViewMode,
  isCombined,
  pairTemplate,
  setPairTemplate,
  availablePairTemplates,
  scope,
  setScope,
  beforePhoto,
  afterPhoto,
  activePhotoMode,
  canSwapBefore,
  canSwapAfter,
  onChangeBefore,
  onChangeAfter,
}) {
  // Decide which Change cards to render per active photo role:
  //   - COMBINED  → both Before + After (current combined sources)
  //   - BEFORE    → only the Before card
  //   - AFTER     → only the After card
  //   - PROGRESS  → only the After card (progresses can stand in)
  //   - other     → none
  // Each card additionally requires canSwap{Before,After} so we don't
  // render a Change button with nothing to swap to.
  const isCombinedMode = isCombined
    || activePhotoMode === 'combined'
    || activePhotoMode === 'mix'
    || activePhotoMode === PHOTO_MODES.COMBINED;
  const showBeforeCard = canSwapBefore
    && (isCombinedMode || activePhotoMode === PHOTO_MODES.BEFORE);
  const showAfterCard = canSwapAfter
    && (isCombinedMode
        || activePhotoMode === PHOTO_MODES.AFTER
        || activePhotoMode === PHOTO_MODES.PROGRESS);
  return (
    <View>
      {/* Source photo card(s) — see role-driven gates above. The
          card always shows the currently-displayed photo for that
          slot + a Change button that opens the room-wide picker.
          Hidden when the active photo has no pair concept or when
          the room has nothing to swap with. */}
      {(showBeforeCard || showAfterCard) && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>SOURCE PHOTOS</Text>
          <View style={styles.layoutSwapRow}>
            {showBeforeCard && (
              <View style={[styles.layoutSwapCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {beforePhoto?.uri ? (
                  <Image source={{ uri: beforePhoto.uri }} style={styles.layoutSwapThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.layoutSwapThumb, { backgroundColor: theme.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="image-outline" size={22} color={theme.textMuted} />
                  </View>
                )}
                <View style={styles.layoutSwapBody}>
                  <Text style={[styles.layoutSwapRole, { color: theme.textSecondary }]}>BEFORE</Text>
                  <TouchableOpacity
                    style={[styles.layoutSwapBtn, { borderColor: theme.borderStrong }]}
                    onPress={onChangeBefore}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={theme.textPrimary} />
                    <Text style={[styles.layoutSwapBtnText, { color: theme.textPrimary }]}>Change</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {showAfterCard && (
              <View style={[styles.layoutSwapCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {afterPhoto?.uri ? (
                  <Image source={{ uri: afterPhoto.uri }} style={styles.layoutSwapThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.layoutSwapThumb, { backgroundColor: theme.surfaceElevated, alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="image-outline" size={22} color={theme.textMuted} />
                  </View>
                )}
                <View style={styles.layoutSwapBody}>
                  <Text style={[styles.layoutSwapRole, { color: theme.textSecondary }]}>AFTER</Text>
                  <TouchableOpacity
                    style={[styles.layoutSwapBtn, { borderColor: theme.borderStrong }]}
                    onPress={onChangeAfter}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="swap-horizontal" size={14} color={theme.textPrimary} />
                    <Text style={[styles.layoutSwapBtnText, { color: theme.textPrimary }]}>Change</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </>
      )}
      {/* FORMAT first — sits right under the photo, anchored, doesn't
          shift when VIEW MODE appears/disappears below it. The selected
          format persists across photo swipes (universal set, no
          orientation-aware snap-back). */}
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>FORMAT</Text>
      <View style={styles.formatCardRow}>
        {availablePairTemplates.map((f) => {
          const isActive = pairTemplate === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.formatCard,
                {
                  backgroundColor: theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                  borderWidth: isActive ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
              onPress={() => setPairTemplate(f.key)}
              activeOpacity={0.85}
            >
              <Ionicons
                name={f.icon}
                size={22}
                color={isActive ? theme.accent : theme.textPrimary}
              />
              <Text
                style={[
                  styles.formatCardLabel,
                  { color: isActive ? theme.accent : theme.textPrimary, fontWeight: isActive ? '700' : '500' },
                ]}
                numberOfLines={1}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* VIEW MODE below FORMAT — combined photos only. Can vary per
          photo without disturbing the FORMAT row above. */}
      {isCombined && (
        <>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>VIEW MODE</Text>
          <View style={[styles.viewModePill, { backgroundColor: theme.surfaceElevated }]}>
            {VIEW_MODES.map((m) => {
              const isActive = viewMode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[
                    styles.viewModePillItem,
                    isActive && { backgroundColor: theme.accent },
                  ]}
                  onPress={() => setViewMode(m.key)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.viewModePillText,
                      { color: isActive ? theme.accentText : theme.textPrimary, fontWeight: isActive ? '700' : '600' },
                    ]}
                    numberOfLines={1}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

    </View>
  );
}

function LabelsPanel({ theme, navigation, showLabels, toggleLabels, scope, setScope }) {
  return (
    <View>
      <View style={[styles.toggleRow, { backgroundColor: theme.surface }]}>
        <Text style={[styles.toggleLabel, { color: theme.textPrimary }]}>Show Labels</Text>
        <Switch
          value={showLabels}
          onValueChange={toggleLabels}
          trackColor={{ false: '#E0E0E0', true: theme.accent }}
          thumbColor="#FFFFFF"
        />
      </View>

      <TouchableOpacity
        style={[styles.deepLinkRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={() => navigation.navigate('LabelCustomization')}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.deepLinkTitle, { color: theme.textPrimary }]}>Customize Labels</Text>
          <Text style={[styles.deepLinkSubtitle, { color: theme.textSecondary }]}>
            Color, font, size, position, per-mode labels
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </TouchableOpacity>

    </View>
  );
}

// ---- Markup ---------------------------------------------------------------

// Renders one saved or in-progress shape inside an <Svg>. Coordinates are
// in photoFrame-relative pixels. Highlight strokes get a baked opacity;
// every other tool uses the user-selected color directly.
function MarkupShape({ shape, theme }) {
  const opacity = shape.tool === 'highlight' ? 0.35 : 1;
  if (shape.tool === 'draw' || shape.tool === 'brush' || shape.tool === 'highlight') {
    const pts = shape.points || [];
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      // Single tap with no drag — render a dot so the user sees
      // immediate feedback that the markup tool received the touch.
      const r = Math.max(shape.stroke / 2, 2);
      return (
        <SvgCircle cx={pts[0].x} cy={pts[0].y} r={r} fill={shape.color} opacity={opacity} />
      );
    }
    const d = pts.reduce(
      (acc, p, i) => acc + (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`),
      ''
    );
    return (
      <Path
        d={d}
        stroke={shape.color}
        strokeWidth={shape.stroke}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={opacity}
      />
    );
  }
  if (shape.tool === 'arrow') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    // Arrowhead as a small filled triangle at (x2, y2).
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular unit vector for the base of the arrowhead.
    const px = -uy;
    const py = ux;
    const headLen = Math.max(stroke * 4, 12);
    const headWidth = Math.max(stroke * 2.5, 8);
    const bx = x2 - ux * headLen;
    const by = y2 - uy * headLen;
    const ax = bx + px * headWidth;
    const ay = by + py * headWidth;
    const cx = bx - px * headWidth;
    const cy = by - py * headWidth;
    return (
      <G opacity={opacity}>
        <Line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <Polygon points={`${x2},${y2} ${ax},${ay} ${cx},${cy}`} fill={color} />
      </G>
    );
  }
  if (shape.tool === 'circle') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const r = Math.sqrt(dx * dx + dy * dy);
    return (
      <SvgCircle cx={x1} cy={y1} r={r} stroke={color} strokeWidth={stroke} fill="none" />
    );
  }
  if (shape.tool === 'measure') {
    const { x1, y1, x2, y2, color, stroke } = shape;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return (
      <G>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={stroke} strokeLinecap="round" />
        <Line x1={x1 - 6} y1={y1} x2={x1 + 6} y2={y1} stroke={color} strokeWidth={stroke} />
        <Line x1={x2 - 6} y1={y2} x2={x2 + 6} y2={y2} stroke={color} strokeWidth={stroke} />
        <SvgText
          x={midX}
          y={midY - 6}
          fill={color}
          fontSize="12"
          fontWeight="700"
          textAnchor="middle"
        >
          {Math.round(len)} px
        </SvgText>
      </G>
    );
  }
  if (shape.tool === 'text') {
    return (
      <SvgText
        x={shape.x}
        y={shape.y}
        fill={shape.color}
        fontSize="16"
        fontWeight="700"
      >
        {shape.text}
      </SvgText>
    );
  }
  return null;
}

function MarkupPanel({
  theme,
  markupTool,
  setMarkupTool,
  markupColor,
  setMarkupColor,
  markupStroke,
  setMarkupStroke,
  onUndo,
  onClear,
  shapeCount,
  scope,
  setScope,
}) {
  return (
    <View>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>TOOL</Text>
      <View style={styles.chipRow}>
        {MARKUP_TOOLS.map((t) => {
          const isActive = markupTool === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[
                styles.markupToolBtn,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => {
                setMarkupTool(t.key);
                if (typeof t.defaultStroke === 'number' && t.defaultStroke > 0) {
                  setMarkupStroke(t.defaultStroke);
                }
              }}
              activeOpacity={0.85}
            >
              <Ionicons name={t.icon} size={18} color={isActive ? theme.accentText : theme.textPrimary} />
              <Text
                style={[styles.markupToolText, { color: isActive ? theme.accentText : theme.textPrimary }]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>COLOR</Text>
      <View style={styles.markupColorRow}>
        {MARKUP_COLORS.map((c) => {
          const isActive = markupColor === c;
          return (
            <TouchableOpacity
              key={c}
              style={[
                styles.markupColorSwatch,
                {
                  backgroundColor: c,
                  borderColor: isActive ? theme.accent : theme.border,
                  borderWidth: isActive ? 3 : StyleSheet.hairlineWidth,
                },
              ]}
              onPress={() => setMarkupColor(c)}
            />
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>STROKE</Text>
      <View style={styles.chipRow}>
        {MARKUP_STROKE_PRESETS.map((s) => {
          const isActive = markupStroke === s.value;
          return (
            <TouchableOpacity
              key={s.key}
              style={[
                styles.chip,
                {
                  backgroundColor: isActive ? theme.accent : theme.surface,
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setMarkupStroke(s.value)}
            >
              <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {s.key} · {s.value}px
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.markupActionRow}>
        <TouchableOpacity
          style={[styles.markupActionBtn, { backgroundColor: theme.surface, borderColor: theme.border, opacity: shapeCount === 0 ? 0.4 : 1 }]}
          onPress={onUndo}
          disabled={shapeCount === 0}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={theme.textPrimary} />
          <Text style={[styles.markupActionText, { color: theme.textPrimary }]}>Undo</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.markupActionBtn, { backgroundColor: theme.surface, borderColor: theme.border, opacity: shapeCount === 0 ? 0.4 : 1 }]}
          onPress={onClear}
          disabled={shapeCount === 0}
        >
          <Ionicons name="trash-outline" size={16} color={theme.danger} />
          <Text style={[styles.markupActionText, { color: theme.danger }]}>Clear</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

function NotesPanel({ theme, photo, updatePhoto, scope, setScope, setActiveTool, navigation }) {
  const [tab, setTab] = useState('notes');
  const [noteText, setNoteText] = useState(photo?.notes || '');
  const [noteType, setNoteType] = useState(photo?.noteType || 'report');

  // Re-hydrate when the active photo changes.
  useEffect(() => {
    setNoteText(photo?.notes || '');
    setNoteType(photo?.noteType || 'report');
  }, [photo?.id]);

  const persistNote = async (text) => {
    setNoteText(text);
    if (photo?.id) await updatePhoto(photo.id, { notes: text });
  };

  const persistNoteType = async (type) => {
    setNoteType(type);
    if (photo?.id) await updatePhoto(photo.id, { noteType: type });
  };

  return (
    <View>
      {/* Notes / Voice / Markup shortcuts on a single horizontal line.
          Location used to live here too but moved to the Project
          Timeline as its own top-level tab (the user wants location
          to be a project-scoped view, not a per-photo note). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}
      >
        {[
          { key: 'notes', label: 'Notes', icon: 'document-text-outline' },
          { key: 'voice', label: 'Voice', icon: 'mic-outline' },
          // 'markup' is a shortcut — tapping it doesn't switch the
          // Notes-panel inner tab, it jumps the whole Studio to the
          // Markup tool (which has the drawing surface + tool palette).
          { key: 'markup', label: 'Markup', icon: 'create-outline', isShortcut: true },
        ].map((t) => {
          const isActive = !t.isShortcut && tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.chip, {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: isActive ? theme.accent : theme.surface,
                borderColor: isActive ? theme.accent : theme.border,
              }]}
              onPress={() => {
                if (t.isShortcut && t.key === 'markup') {
                  navigation?.navigate('MarkupEditor', { photoId: photo?.id });
                  return;
                }
                setTab(t.key);
              }}
            >
              <Ionicons name={t.icon} size={14} color={isActive ? theme.accentText : theme.textPrimary} />
              <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {tab === 'notes' && (
        <>
          <View style={[styles.notesBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TextInput
              value={noteText}
              onChangeText={persistNote}
              placeholder="Add a note about this photo…"
              placeholderTextColor={theme.textMuted}
              multiline
              textAlignVertical="top"
              style={{
                flex: 1,
                fontFamily: FONTS.ALEXANDRIA,
                fontSize: 14,
                color: theme.textPrimary,
                minHeight: 90,
              }}
            />
          </View>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>NOTE TYPE</Text>
          <View style={styles.chipRow}>
            {[
              { key: 'report', label: 'Report Note' },
              { key: 'private', label: 'Private Note' },
            ].map((nt) => {
              const isActive = noteType === nt.key;
              return (
                <TouchableOpacity
                  key={nt.key}
                  style={[styles.chip, {
                    backgroundColor: isActive ? theme.accent : theme.surface,
                    borderColor: isActive ? theme.accent : theme.border,
                  }]}
                  onPress={() => persistNoteType(nt.key)}
                >
                  <Text style={[styles.chipText, { color: isActive ? theme.accentText : theme.textPrimary }]}>
                    {nt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}
      {tab === 'voice' && (
        <VoiceTab
          theme={theme}
          photo={photo}
          updatePhoto={updatePhoto}
        />
      )}

    </View>
  );
}

// Voice memo recorder + manual transcription textarea. Records via
// expo-av at HIGH_QUALITY preset, saves the URI onto the photo
// record as `audioUri`. Transcription is a plain TextInput for now
// (auto-transcription via Whisper / Apple Speech is a follow-up
// that needs either an API key or a native module).
function VoiceTab({ theme, photo, updatePhoto }) {
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [audioUri, setAudioUri] = useState(photo?.audioUri || null);
  const [transcription, setTranscription] = useState(photo?.audioTranscription || '');
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recognitionActive, setRecognitionActive] = useState(false);
  const tickRef = useRef(null);
  // Holds the last `final` transcript so live partials don't keep
  // wiping it — partials append to this baseline.
  const baseTranscriptRef = useRef('');

  // Live speech recognition events. Partial results stream in as
  // the user is talking; finals lock in the recognized segment.
  // On stop, we save whatever's in state to the photo record.
  useSpeechRecognitionEvent('result', (event) => {
    const seg = event?.results?.[0]?.transcript || '';
    if (!seg) return;
    if (event.isFinal) {
      baseTranscriptRef.current = (baseTranscriptRef.current + ' ' + seg).trim();
      setTranscription(baseTranscriptRef.current);
    } else {
      setTranscription((baseTranscriptRef.current + ' ' + seg).trim());
    }
  });
  useSpeechRecognitionEvent('end', () => {
    setRecognitionActive(false);
  });
  useSpeechRecognitionEvent('error', (event) => {
    // Surface the recognizer's own error code/message. Common iOS
    // codes: "not-allowed" (mic/speech perm denied), "audio-capture"
    // (mic in use elsewhere), "service-not-allowed" (system speech
    // disabled). Without this log, transcription silently never
    // appears and we can't tell why.
    console.warn('[StudioScreen] speech error', {
      code: event?.error,
      message: event?.message,
    });
    setRecognitionActive(false);
  });

  useEffect(() => {
    setAudioUri(photo?.audioUri || null);
    setTranscription(photo?.audioTranscription || '');
    baseTranscriptRef.current = photo?.audioTranscription || '';
  }, [photo?.id]);

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (sound) sound.unloadAsync().catch(() => {});
    if (recording) recording.stopAndUnloadAsync().catch(() => {});
    try { ExpoSpeechRecognitionModule.stop(); } catch (_) {}
  }, []);

  const formatMs = (ms) => {
    const total = Math.floor((ms || 0) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone permission needed', 'Enable microphone access in Settings to record voice notes.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const r = new Audio.Recording();
      await r.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await r.startAsync();
      setRecording(r);
      setIsRecording(true);
      setDurationMs(0);
      tickRef.current = setInterval(async () => {
        try {
          const st = await r.getStatusAsync();
          if (st?.isRecording) setDurationMs(st.durationMillis || 0);
        } catch (_) {}
      }, 250);
      // Live transcription via on-device speech recognizer. We
      // start a fresh baseline so the result handler appends from
      // an empty slate (previous transcription stays editable but
      // isn't extended by this session).
      baseTranscriptRef.current = '';
      setTranscription('');
      try {
        const sp = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!sp.granted) {
          console.warn('[StudioScreen] speech permission not granted', sp);
        } else {
          await ExpoSpeechRecognitionModule.start({
            lang: 'en-US',
            interimResults: true,
            continuous: true,
          });
          setRecognitionActive(true);
        }
      } catch (e) {
        // Recognition is best-effort — the recording itself still
        // happens even if the recognizer fails to start. Log so the
        // failure mode is visible in device logs instead of silent.
        console.warn('[StudioScreen] speech recognizer failed to start', e?.message || e);
      }
    } catch (e) {
      Alert.alert('Could not start recording', e?.message || 'Unknown error');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      const uri = recording.getURI();
      setRecording(null);
      setIsRecording(false);
      // Stop the speech recognizer too — its `end` event will
      // settle `recognitionActive` shortly after.
      try { await ExpoSpeechRecognitionModule.stop(); } catch (e) {
        console.warn('[StudioScreen] speech recognizer stop failed', e?.message || e);
      }
      const finalText = (transcription || '').trim();
      if (uri) {
        setAudioUri(uri);
        if (photo?.id) {
          await updatePhoto(photo.id, {
            audioUri: uri,
            audioDurationMs: durationMs,
            audioTranscription: finalText || null,
          });
        }
      }
    } catch (e) {
      Alert.alert('Could not save recording', e?.message || 'Unknown error');
    }
  };

  const playRecording = async () => {
    if (!audioUri) return;
    try {
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
      }
      const { sound: s } = await Audio.Sound.createAsync({ uri: audioUri });
      s.setOnPlaybackStatusUpdate((st) => {
        if (st?.didJustFinish) {
          setIsPlaying(false);
          s.unloadAsync().catch(() => {});
          setSound(null);
        }
      });
      setSound(s);
      setIsPlaying(true);
      await s.playAsync();
    } catch (e) {
      Alert.alert('Could not play', e?.message || 'Unknown error');
    }
  };

  const stopPlayback = async () => {
    if (sound) {
      try { await sound.stopAsync(); } catch (_) {}
      try { await sound.unloadAsync(); } catch (_) {}
      setSound(null);
    }
    setIsPlaying(false);
  };

  const deleteRecording = async () => {
    setAudioUri(null);
    setTranscription('');
    if (photo?.id) await updatePhoto(photo.id, { audioUri: null, audioTranscription: null, audioDurationMs: null });
  };

  const persistTranscription = (text) => {
    setTranscription(text);
    if (photo?.id) updatePhoto(photo.id, { audioTranscription: text });
  };

  return (
    <View>
      {/* Recorder row — Record / Stop while recording, Play / Stop
          when a recording exists. The duration counter ticks at 4 fps
          while recording so the user has feedback. */}
      <View style={[styles.notesBox, { backgroundColor: theme.surface, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, padding: 12 }]}>
        {isRecording ? (
          <>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger }} />
              <Text style={{ color: theme.textPrimary, fontFamily: FONTS.ALEXANDRIA, fontWeight: '700' }}>
                Recording  {formatMs(durationMs)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={stopRecording}
              style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, backgroundColor: theme.danger }}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#FFFFFF', fontFamily: FONTS.ALEXANDRIA, fontWeight: '700' }}>Stop</Text>
            </TouchableOpacity>
          </>
        ) : audioUri ? (
          <>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="musical-note" size={18} color={theme.accent} />
              <Text style={{ color: theme.textPrimary, fontFamily: FONTS.ALEXANDRIA }}>
                Voice memo{photo?.audioDurationMs ? ` · ${formatMs(photo.audioDurationMs)}` : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {isPlaying ? (
                <TouchableOpacity onPress={stopPlayback} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="pause-circle" size={32} color={theme.accent} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={playRecording} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="play-circle" size={32} color={theme.accent} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={deleteRecording} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="trash-outline" size={22} color={theme.danger} />
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={{ color: theme.textSecondary, fontFamily: FONTS.ALEXANDRIA, flex: 1 }}>
              Record a voice memo for this photo.
            </Text>
            <TouchableOpacity
              onPress={startRecording}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, backgroundColor: theme.accent }}
              activeOpacity={0.85}
            >
              <Ionicons name="mic" size={16} color={theme.accentText} />
              <Text style={{ color: theme.accentText, fontFamily: FONTS.ALEXANDRIA, fontWeight: '700' }}>Record</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Transcription textarea — saved to photo.audioTranscription
          on every keystroke. Auto-transcription needs a service
          (Whisper API / Apple Speech) we'll wire up later. */}
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>TRANSCRIPTION</Text>
      <View style={[styles.notesBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TextInput
          value={transcription}
          onChangeText={persistTranscription}
          placeholder={isRecording
            ? (recognitionActive ? 'Listening — transcription appears as you speak…' : 'Recording (transcription unavailable)')
            : (audioUri ? 'Edit the transcription…' : 'Record a memo above to add transcription.')}
          placeholderTextColor={theme.textMuted}
          multiline
          editable={!!audioUri || isRecording}
          textAlignVertical="top"
          style={{
            flex: 1,
            fontFamily: FONTS.ALEXANDRIA,
            fontSize: 14,
            color: theme.textPrimary,
            minHeight: 80,
            opacity: (audioUri || isRecording) ? 1 : 0.6,
          }}
        />
      </View>
    </View>
  );
}

function BrandingPanel({
  theme,
  navigation,
  photoId,
  // Logo
  brandLogoUri,
  showBrandLogo,
  updateShowBrandLogo,
  // Watermark
  showWatermark,
  updateShowWatermark,
  // Metadata
  showPreviewMetadata,
  togglePreviewMetadata,
  // Labels (same tile pattern as the other three)
  showLabels,
  toggleLabels,
}) {
  // Three Tags tiles stacked vertically. Each tile's body opens its own
  // customize screen that shows ONLY that feature's settings — Logo
  // (upload, placement, size), Watermark (text, placement, styling),
  // Metadata (which fields, placement, styling). Labels customize gets
  // the current photoId so its preview shows the real picture.
  const open = (which) => {
    if (which === 'logo') navigation.navigate('LogoCustomization', { photoId });
    else if (which === 'metadata') navigation.navigate('MetadataCustomization', { photoId });
    else if (which === 'labels') navigation.navigate('LabelCustomization', { photoId });
    else navigation.navigate('WatermarkCustomization', { photoId });
  };

  return (
    <View style={styles.brandTileRow}>
      <BrandTile
        theme={theme}
        title="Logo"
        icon={
          brandLogoUri
            ? null
            : 'image-outline'
        }
        previewUri={brandLogoUri || null}
        toggleValue={!!showBrandLogo && !!brandLogoUri}
        onToggle={(v) => updateShowBrandLogo(v)}
        toggleDisabled={!brandLogoUri}
        onPress={() => open('logo')}
      />
      <BrandTile
        theme={theme}
        title="Watermark"
        icon="pricetag-outline"
        toggleValue={!!showWatermark}
        onToggle={(v) => updateShowWatermark(v)}
        onPress={() => open('watermark')}
      />
      <BrandTile
        theme={theme}
        title="Metadata"
        icon="information-circle-outline"
        toggleValue={!!showPreviewMetadata}
        onToggle={togglePreviewMetadata}
        onPress={() => open('metadata')}
      />
      <BrandTile
        theme={theme}
        title="Labels"
        icon="pricetag-outline"
        toggleValue={!!showLabels}
        onToggle={toggleLabels}
        onPress={() => open('labels')}
      />
    </View>
  );
}

// Each Tags tile: leading icon/preview, title + "Customize ›", and a
// toggle on the right. Tapping the tile body opens the dedicated
// customize screen for that tile.
function BrandTile({
  theme,
  title,
  icon,
  previewUri,
  toggleValue,
  onToggle,
  toggleDisabled,
  onPress,
}) {
  // Touchable wraps ONLY the leading icon + the title/customize body.
  // The Switch sits as a sibling so its taps don't bubble up to the
  // parent's onPress (which would navigate to the Customization
  // screen and effectively cancel the toggle). Previously the whole
  // tile was a TouchableOpacity with the Switch nested inside — that
  // made toggling Watermark also fire the navigation, which the user
  // saw as "the toggle does nothing" since they were yanked away
  // before the Switch's UI state could settle.
  return (
    <View
      style={[styles.brandTile, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        style={styles.brandTileTappable}
      >
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.brandTilePreview} resizeMode="contain" />
        ) : (
          <View style={[styles.brandTileLeading, { backgroundColor: theme.surfaceElevated }]}>
            <Ionicons name={icon} size={20} color={toggleValue ? theme.accent : theme.textPrimary} />
          </View>
        )}
        <View style={styles.brandTileBody}>
          <Text style={[styles.brandTileTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.brandTileCustomize, { color: theme.textSecondary }]}>Customize</Text>
          <Ionicons name="chevron-forward" size={12} color={theme.textSecondary} />
        </View>
      </TouchableOpacity>
      <Switch
        value={!!toggleValue}
        onValueChange={onToggle}
        disabled={!!toggleDisabled}
        trackColor={{ false: '#E0E0E0', true: theme.accent }}
        thumbColor="#FFFFFF"
        style={styles.brandTileSwitch}
      />
    </View>
  );
}

function ExportPanel({ theme, navigation, photo }) {
  const shareNow = async () => {
    if (!photo?.uri) {
      Alert.alert('Nothing to share', 'No photo URI available.');
      return;
    }
    try {
      await Share.share({ url: photo.uri, message: photo.notes || '' });
    } catch (e) {
      // user dismissed
    }
  };

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>EXPORT</Text>
      <TouchableOpacity
        style={[styles.deepLinkRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={shareNow}
      >
        <Ionicons name="share-outline" size={18} color={theme.textPrimary} style={{ marginRight: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.deepLinkTitle, { color: theme.textPrimary }]}>Share this photo</Text>
          <Text style={[styles.deepLinkSubtitle, { color: theme.textSecondary }]}>
            Native share sheet (Messages, Mail, copy, save, etc.)
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.deepLinkRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Projects' }] })}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={theme.textPrimary} style={{ marginRight: 12 }} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.deepLinkTitle, { color: theme.textPrimary }]}>Project share / upload</Text>
          <Text style={[styles.deepLinkSubtitle, { color: theme.textSecondary }]}>
            Reuses the existing share + cloud upload flow on Projects
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

// ---- On-picture overlays --------------------------------------------------

// Maps the user's `brandLogoSize` choice to a pixel side. Cheap and
// readable — refine if you need finer sizing.
const LOGO_SIZE_PX = { small: 40, medium: 60, large: 84 };
const META_FONT_PX = { small: 11, medium: 14, large: 18 };

// Build the `style.left / .top / .transform` block that places an
// overlay at a freeform fractional offset (0..1 each). Same trick
// PhotoLabel uses — `translate(-x*100%, -y*100%)` anchors the item by
// its own width/height in proportion to the offset.
const freeformPositionStyle = (offset) =>
  offset && typeof offset.x === 'number' && typeof offset.y === 'number'
    ? {
        left: `${offset.x * 100}%`,
        top: `${offset.y * 100}%`,
        transform: [
          { translateX: `${-offset.x * 100}%` },
          { translateY: `${-offset.y * 100}%` },
        ],
      }
    : null;

function BrandLogoOverlay({ uri, size }) {
  const px = typeof size === 'number' ? size : (LOGO_SIZE_PX[size] || LOGO_SIZE_PX.medium);
  return (
    <Image source={{ uri }} style={{ width: px, height: px }} resizeMode="contain" />
  );
}

// Same font key → loaded font mapping as PhotoLabel — keeps the metadata
// overlay typography in sync with the labels.
const META_FONT_FAMILY_MAP = {
  alexandria: 'Alexandria_400Regular',
  system: 'Alexandria_400Regular',
  shadow: 'PlayfairDisplay_700Bold',
  shanatel: 'Quicksand_400Regular',
  sf: 'Lato_700Bold',
  share: 'RobotoMono_700Bold',
  montserratBold: 'Montserrat_700Bold',
  playfairBold: 'PlayfairDisplay_700Bold',
  robotoMonoBold: 'RobotoMono_700Bold',
  latoBold: 'Lato_700Bold',
  poppinsSemiBold: 'Poppins_600SemiBold',
  oswaldSemiBold: 'Oswald_600SemiBold',
};

function MetadataOverlay({
  photo,
  location,
  showDate,
  showTime,
  showAddress,
  showGps,
  color,
  fontSize,
  fontFamily,
}) {
  const ts = photo?.timestamp
    ? new Date(photo.timestamp)
    : (photo?.createdAt ? new Date(photo.createdAt) : null);
  const parts = [];
  if (showDate && ts) parts.push(ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  if (showTime && ts) parts.push(ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  if (showAddress) {
    const where = (photo?.location || location || '').toString().trim();
    if (where) parts.push(where);
  }
  if (showGps && photo?.gps) parts.push(String(photo.gps));
  if (parts.length === 0) return null;
  const text = parts.join(' · ');
  const fontSizePx = typeof fontSize === 'number' ? fontSize : (META_FONT_PX[fontSize] || META_FONT_PX.small);
  const family = META_FONT_FAMILY_MAP[fontFamily] || META_FONT_FAMILY_MAP.alexandria;
  return (
    <View style={styles.metadataOverlay}>
      <Text
        style={{
          color: color || '#FFFFFF',
          fontSize: fontSizePx,
          fontWeight: '700',
          fontFamily: family,
          textShadowColor: 'rgba(0,0,0,0.5)',
          textShadowRadius: 4,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
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
  headerSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    marginTop: 1,
  },
  saveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  saveBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  metaLine: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 4,
  },
  // Outer photo area: fixed-height letterbox so the chip row below it
  // never jumps when the user picks a different template. The inner frame
  // is centered horizontally and sized to fit the picture's template
  // aspect inside.
  photoArea: {
    height: 360,
    width: '100%',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Compact photo area used while the Notes tool is active and the
  // keyboard is up — leaves enough vertical room for the textarea to
  // sit directly above the keyboard.
  photoAreaCompact: {
    height: 140,
  },
  // Inner frame: matches the selected template's aspect, centered inside
  // the outer box. This is the thing whose shape changes when the user
  // switches formats.
  photoFrame: {
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  // Halves used to anchor BEFORE / AFTER labels on each side of a merged
  // (COMBINED) photo. Each half is absolute and contains a single
  // PhotoLabel — PhotoLabel is itself absolute-positioned, so we get the
  // user's chosen corner within that half.
  combinedHalfLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '50%',
    bottom: 0,
  },
  combinedHalfRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '50%',
    bottom: 0,
  },
  combinedHalfTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  combinedHalfBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  photo: { width: '100%', height: '100%' },
  modeBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  modeBadgeText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  pairMissingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
  },
  pairMissingText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    flex: 1,
  },
  regenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  regenOverlayText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  watermarkOverlay: {
    position: 'absolute',
    paddingHorizontal: 8,
  },
  watermarkText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  metaOverlay: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  metaText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  toolPanel: { flex: 1 },
  toolPanelContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRowScroll: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  // Save submenu (modal sheet that shows the 3 apply-to scopes)
  saveMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  // Layout-panel SOURCE PHOTOS row — two cards (Before / After) side
  // by side, each with a thumbnail, role label, and a Change button
  // that opens the swap picker.
  layoutSwapRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  layoutSwapCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  layoutSwapThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  layoutSwapBody: {
    flex: 1,
    gap: 4,
  },
  layoutSwapRole: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  layoutSwapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  layoutSwapBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
  },
  // Swap-picker bottom sheet (modal). Reuses the save-menu chrome
  // for visual consistency; contains a 3-column grid of every
  // photo in the active set plus a Cancel exit.
  swapPickerSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  swapPickerTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  swapPickerSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  swapPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 12,
  },
  swapPickerTile: {
    width: '31.5%',
    borderRadius: 10,
    overflow: 'hidden',
    paddingBottom: 4,
    position: 'relative',
  },
  swapPickerThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
  },
  swapPickerLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
  swapPickerCurrent: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveMenuSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  saveMenuTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  saveMenuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  saveMenuOptionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '600',
  },
  saveMenuCancel: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  saveMenuCancelText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  // On-picture overlays for metadata
  metadataOverlay: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '92%',
  },
  // Gesture-hint overlay on the photo
  gestureHint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gestureHintInner: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    gap: 8,
    maxWidth: '85%',
  },
  gestureHintText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Markup
  markupToolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  markupToolText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  markupColorRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  markupColorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  markupActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  markupActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  markupActionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
  },
  markupTextDraft: {
    position: 'absolute',
    minWidth: 80,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  markupTextDraftInput: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
    padding: 0,
    minWidth: 60,
  },
  // Tags tiles — three cards stacked vertically.
  brandTileRow: {
    flexDirection: 'column',
    gap: 8,
  },
  brandTile: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 10,
  },
  // Inner tappable region of the tile — leading icon + title block.
  // The Switch sits OUTSIDE this so its taps don't also fire the
  // tile-body navigation.
  brandTileTappable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandTileLeading: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTileBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandTilePreview: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  brandTileTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  brandTileCustomize: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  brandTileSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  // Segmented pill for VIEW MODE — single rounded container holding the
  // three options, active option gets a filled pill behind it.
  viewModePill: {
    flexDirection: 'row',
    borderRadius: 100,
    padding: 4,
    alignSelf: 'stretch',
  },
  viewModePillItem: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewModePillText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  // FORMAT cards — 4 equal-width tiles in a single row, icon above label.
  formatCardRow: {
    flexDirection: 'row',
    gap: 8,
  },
  formatCard: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  formatCardLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    letterSpacing: 0.2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  toggleLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
  deepLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  deepLinkTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  deepLinkSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    marginTop: 2,
  },
  notesBox: {
    minHeight: 100,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  notesBoxPlaceholder: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    lineHeight: 18,
  },
  scopeBlock: { marginTop: 8 },
  scopeRow: { flexDirection: 'row', gap: 8 },
  scopeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  scopeBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  toolBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    letterSpacing: 0.2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  gridItem: {
    width: '48.5%',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  gridItemImage: {
    width: '100%',
    aspectRatio: 1,
  },
  gridItemFooter: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  gridItemTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  gridItemSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
});

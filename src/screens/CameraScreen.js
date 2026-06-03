import React, { useState, useRef, useEffect, useContext, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Alert,
  Dimensions,
  ScrollView,
  Platform,
  PixelRatio,
  PanResponder,
  Animated,
  StatusBar,
  Modal,
  ActivityIndicator,
  Share,
  TextInput,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import Slider from '@react-native-community/slider';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { compositeImages, isNativeCompositorAvailable } from '../utils/imageCompositor';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import * as ExpoLocation from 'expo-location';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { savePhotoToDevice } from '../services/storage';
import { createAlbumName } from '../services/uploadService';
import { getLocationName } from '../config/locations';
import { COLORS, PHOTO_MODES, getLabelPositions } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import {
  calculateSettingsHash,
  saveCachedLabeledPhoto,
  ensureCacheDir,
} from '../services/labelCacheService';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { backgroundCombinedPhotoService } from '../components/GlobalBackgroundCombinedPhotoCreator';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { onBeforePhotoTaken, onAfterPhotoCompleted } from '../services/jobReminderService';
import { logBeforePhotoStarted, logAfterPhotoCompleted, logPhotoCapture } from '../utils/analytics';

const initialDimensions = Dimensions.get('window');
const initialWidth = initialDimensions.width;
const initialHeight = initialDimensions.height;
const initialOrientation = initialWidth > initialHeight ? 'landscape' : 'portrait';

// Get initial specific orientation synchronously
const getInitialSpecificOrientation = () => {
  if (initialOrientation === 'portrait') {
    return 1; // PORTRAIT
  } else {
    // For landscape, default to LANDSCAPE_LEFT (3) - will be corrected immediately by async check
    return 3;
  }
};

// [CAMDIAG] Module-load build marker. Fires once when CameraScreen.js
// is first imported (typically at app startup when React Navigation
// registers screens, or on first nav to Camera). Fires BEFORE any
// component render, so it's the most reliable "I have this bundle"
// signal. If this line doesn't appear in logs after opening Camera,
// the device is NOT running this bundle.
console.warn('[CAMDIAG] MODULE LOAD BUILD=2026-05-26-photodel-v4');

export default function CameraScreen({ route, navigation }) {
  const { mode, beforePhoto, afterPhoto: existingAfterPhoto, combinedPhoto: existingCombinedPhoto, room: initialRoom } = route.params || {};
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Default to a non-empty string so capture handlers never read `.charAt`
  // on undefined when CameraScreen is entered without a room param (e.g. the
  // post-create reset from ProjectsScreen). The useEffect below replaces this
  // with the first valid room from the user's industry once getRooms() is ready.
  const [room, setRoom] = useState(initialRoom || 'kitchen');
  const [facing, setFacing] = useState('back');
  const [enableTorch, setEnableTorch] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('4:3'); // '4:3' or '2:3'
  const [selectedBeforePhoto, setSelectedBeforePhoto] = useState(beforePhoto);
  // Ghost overlay opacity for After mode. Default 0.4 matches the prior
  // hardcoded value; the side slider lets the user dial it up or down.
  const [ghostOpacity, setGhostOpacity] = useState(0.4);
  // Auto-hide for the ghost slider — visible for ~1.5s after Camera
  // mounts and after every camera-area touch, then fades out so it
  // doesn't permanently cover the viewfinder.
  const [showGhostSlider, setShowGhostSlider] = useState(true);
  const ghostSliderHideTimerRef = useRef(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessingAfter, setIsProcessingAfter] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showCarousel, setShowCarousel] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showEnlargedGallery, setShowEnlargedGallery] = useState(false);
  const [enlargedGalleryIndex, setEnlargedGalleryIndex] = useState(0);
  const [enlargedGalleryPhoto, setEnlargedGalleryPhoto] = useState(null);
  const [cameraViewMode, setCameraViewMode] = useState('portrait'); // 'portrait' (9:16 fill) | 'landscape' (3:4 letterbox)
  // True for ~600ms after an aspect-mode change. While true, an opaque
  // overlay sits on top of the camera area to mask the visual blink
  // that happens when vision-camera reconfigures its native session
  // for the new sensor format.
  const [aspectTransitioning, setAspectTransitioning] = useState(false);
  const aspectTransitionTimerRef = useRef(null);
  const [deviceOrientation, setDeviceOrientation] = useState(initialOrientation);
  const [specificOrientation, setSpecificOrientation] = useState(getInitialSpecificOrientation()); // 1=PORTRAIT, 3=LANDSCAPE_LEFT, 4=LANDSCAPE_RIGHT
  const [isGalleryAnimating, setIsGalleryAnimating] = useState(false);
  const [tempPhotoUri, setTempPhotoUri] = useState(null);
  const [tempPhotoLabel, setTempPhotoLabel] = useState(null);
  const [tempPhotoDimensions, setTempPhotoDimensions] = useState({ width: 1080, height: 1920 });
  const [showRoomIndicator, setShowRoomIndicator] = useState(false);
  // Per-photo note modal: opens when the user taps "Add Note" in the
  // half-screen gallery panel. noteDraft holds the live text while the
  // modal is open; on save we updatePhoto({ note }) so the note is
  // persisted with the photo metadata (used later in the report).
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTargetPhotoId, setNoteTargetPhotoId] = useState(null);
  const longPressGalleryTimer = useRef(null);
  const roomIndicatorTimer = useRef(null);
  const enlargedGalleryScrollRef = useRef(null);
  // After-mode strip: index of the currently-matched item in the
  // real-items list ([Before, ...progresses, After]). Updated when
  // the user's swipe momentum settles on a new half-offset snap
  // point. Drives the Match label position only — items do NOT
  // rearrange, so the user sees one smooth scroll, no re-render flash.
  const [matchedItemIdx, setMatchedItemIdx] = useState(-1);
  // Set true while a side-arrow tap is animating the carousel to a
  // new index. onScroll consults this ref to skip its live-index
  // update so the in-flight programmatic scroll isn't clobbered by
  // the intermediate offsets (which round back to the old index).
  const arrowScrollingRef = useRef(false);
  const arrowScrollingTargetRef = useRef(null);
  const arrowScrollClearTimer = useRef(null);
  const completionAlertTimer = useRef(null); // Timer for "All Photos Taken" alert
  // Set of beforePhoto IDs that have already received a progress photo in
  // THIS Progress-mode session. The Progress flow advances through every
  // set in the room one-at-a-time (mirroring After mode); to take a second
  // progress photo for a set, the user exits and re-enters Progress mode,
  // which resets this ref. Lives in a ref (not state) so the post-capture
  // advance can read the freshest value without waiting for re-render.
  const progressedBeforeIdsRef = useRef(new Set());
  // Same idea for After mode. Each capture marks the set as visited and
  // advances to the next un-visited Before across the whole project; the
  // "All Photos Taken" popup only fires once every set has been visited
  // in this session. To re-cycle, the user exits and re-enters Camera.
  // Without this tracker, taking a 3rd photo on a fully-paired room fired
  // the popup immediately (no Befores were "unpaired") even when other
  // rooms still had sets the user wanted to walk through.
  const visitedAfterBeforeIdsRef = useRef(new Set());
  const tapStartTime = useRef(null);
  const [dimensions, setDimensions] = useState({ width: initialWidth, height: initialHeight });
  const lastTap = useRef(null);
  const longPressTimer = useRef(null);
  const cameraRef = useRef(null);
  const [pictureSize, setPictureSize] = useState('Photo'); // Use iOS preset for full resolution
  // Background label preparation is now handled by GlobalBackgroundLabelPreparation component
  // No local state needed - uses global service that stays mounted regardless of navigation
  const carouselScrollRef = useRef(null);
  const fullScreenScrollRef = useRef(null);
  const galleryScrollRef = useRef(null);
  // Tracks whether the small gallery strip is currently being scrolled
  // (drag-in-progress OR coasting to the next snap). Each TouchableOpacity
  // in the strip starts a long-press timer + tap action on press; if the
  // user's finger was actually scrolling, those would fire on release —
  // opening the enlarged view instead of just panning. We consult this
  // ref in onPressOut and skip the tap action whenever a scroll was active.
  const isScrollingGalleryRef = useRef(false);
  const carouselTranslateY = useRef(new Animated.Value(0)).current;
  const enlargedGalleryTranslateY = useRef(new Animated.Value(0)).current;
  const galleryOpacity = useRef(new Animated.Value(0)).current;
  // Photo capture animation state
  const [captureAnimationUri, setCaptureAnimationUri] = useState(null);
  const captureAnimScale = useRef(new Animated.Value(1)).current;
  const captureAnimTranslateX = useRef(new Animated.Value(0)).current;
  const captureAnimTranslateY = useRef(new Animated.Value(0)).current;
  const captureAnimOpacity = useRef(new Animated.Value(1)).current;
  const thumbnailRef = useRef(null);
  const cameraContainerRef = useRef(null);
  const currentRoomRef = useRef(room);
  const dimensionsRef = useRef(dimensions);
  const showCarouselRef = useRef(showCarousel);
  const showGalleryRef = useRef(showGallery);
  const showEnlargedGalleryRef = useRef(showEnlargedGallery);
  const enlargedGalleryPhotoRef = useRef(enlargedGalleryPhoto);
  const isGalleryAnimatingRef = useRef(false);
  const { addPhoto, updatePhoto, getBeforePhotos, getUnpairedBeforePhotos, getAfterPhotos, getProgressPhotos, getCombinedPhotos, deletePhoto, setCurrentRoom, activeProjectId, createProject, setActiveProject, projects } = usePhotos();
  const {
    showLabels,
    shouldShowWatermark,
    getRooms,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    labelMarginVertical,
    labelMarginHorizontal,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelFontFamily,
    shutterSoundEnabled,
    toggleShutterSoundEnabled,
    userName,
    location,
  } = useSettings();

  // Vision Camera setup - request a multi-physical-lens logical device so we
  // can seamlessly zoom from the device's widest lens (0.5x on most phones,
  // 0.6x on Samsung S21 Ultra and similar) through the main + telephoto lenses.
  // This avoids hard-switching physical devices and lets `device.minZoom`
  // reflect whatever ultra-wide the actual hardware supports.
  const device = useCameraDevice(facing, {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });

  // Actual widest zoom this device supports (0.5 on iPhone/Pixel, ~0.6 on S21 Ultra, etc.).
  // Falls back to 1.0 if the device doesn't support ultra-wide.
  //
  // Vision-camera uses LOGICAL zoom values that don't match the UX
  // numbers iOS users expect: `neutralZoom` is the "1x" point (main
  // wide camera) and on iPhones is typically 2.0; the ultra-wide
  // (display "0.5x") is at minZoom (typically 1.0); the telephoto
  // (display "2x") is at 2 * neutralZoom. So we always derive UX
  // numbers as multiples of neutralZoom, never as raw zoom values.
  const deviceMinZoom = device?.minZoom ?? 1.0;
  const deviceNeutralZoom = device?.neutralZoom ?? 1.0;
  const deviceMaxZoom = device?.maxZoom ?? deviceNeutralZoom * 4;
  const hasUltraWide = deviceMinZoom < deviceNeutralZoom;
  const hasTelephoto = !!device?.physicalDevices?.includes?.('telephoto-camera');

  // Declared BEFORE activePresetIndex below — the IIFE that picks the
  // active chip reads `zoom`, so the state declaration must precede it
  // or `zoom` is in the TDZ and the IIFE silently treats it as
  // undefined (NaN distance → bestIdx stuck at 0, no chip highlight).
  const [zoom, setZoom] = useState(1.0);
  // Once the device is known, snap zoom to the widest lens (ultra-wide) on
  // first load — matches the original default of opening at 0.5x / 0.6x.
  const didInitZoomRef = useRef(false);
  useEffect(() => {
    if (!didInitZoomRef.current && device && hasUltraWide) {
      setZoom(deviceMinZoom);
      didInitZoomRef.current = true;
    }
  }, [device, hasUltraWide, deviceMinZoom]);

  // Three fixed presets: .5, 1×, 2×. The min-zoom chip is only shown
  // when the device actually has an ultra-wide lens (otherwise it'd
  // duplicate 1×). Each preset stores its DISPLAY value and the
  // LOGICAL value vision-camera's setZoom needs.
  const zoomPresets = useMemo(() => {
    const presets = [];
    const neutral = deviceNeutralZoom;
    if (hasUltraWide) {
      const disp = Math.round((deviceMinZoom / neutral) * 10) / 10;
      presets.push({ display: disp, logical: deviceMinZoom });
    }
    presets.push({ display: 1, logical: neutral });
    presets.push({ display: 2, logical: Math.min(neutral * 2, deviceMaxZoom) });
    return presets;
  }, [deviceMinZoom, deviceNeutralZoom, deviceMaxZoom, hasUltraWide]);

  // Label format matches the original UI: "0.5X" / "1X" / "2X".
  const formatZoomLabel = (display) => {
    if (Number.isInteger(display)) return `${display}X`;
    return `${display.toFixed(1)}X`;
  };

  // Active-preset detection: pick the preset whose LOGICAL zoom is
  // closest to the current zoom state. Comparing logicals directly
  // avoids any dependency on deviceNeutralZoom (the previous version
  // divided zoom by neutralZoom to get a "display zoom" and matched
  // on display values — on some devices neutralZoom reports a value
  // that makes every actual zoom round down to the smallest preset,
  // so activeIdx was stuck at 0 forever and no chip ever highlighted).
  const activePresetIndex = (() => {
    if (!zoomPresets.length) return -1;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < zoomPresets.length; i++) {
      const d = Math.abs(zoomPresets[i].logical - zoom);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  })();
  // Some Samsung/Android lenses (especially ultra-wide) report no flash/torch support.
  // Guard all flash/torch usage by these caps to avoid runtime crashes.
  const supportsFlash = !!device?.hasFlash;
  const supportsTorch = device?.hasTorch != null ? !!device.hasTorch : supportsFlash;

  // If we switch to a lens that doesn't support torch, automatically turn off the toggle
  useEffect(() => {
    if (!supportsTorch && enableTorch) {
      setEnableTorch(false);
    }
  }, [supportsTorch, enableTorch]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (completionAlertTimer.current) {
        clearTimeout(completionAlertTimer.current);
      }
    };
  }, []);

  const { hasPermission, requestPermission } = useCameraPermission();
  const isFocused = useIsFocused();

  // Per-mode sensor format (restored from v1.6.5 behavior):
  //   'landscape' (3:4 letterbox) → 4:3 sensor → full sensor area, native FoV
  //   'portrait'  (9:16 fullscreen) → 16:9 sensor → native iPhone 9:16 FoV
  // Each mode uses the sensor format that captures its target aspect
  // natively, so the captured photo always matches what's framed in
  // the viewfinder — no post-capture cropping needed.
  // Trade-off: toggling between modes triggers a vision-camera native
  // session reconfig (~200-400ms). The transition mask hides the blink.
  const targetAspectRatio = useMemo(
    () => (cameraViewMode === 'landscape' ? 4 / 3 : 16 / 9),
    [cameraViewMode],
  );

  // Select best camera format
  // IMPORTANT: The preview stream uses VIDEO resolution, not photo.
  // Filtering only on photoWidth/photoHeight could pick a "16:9 photo
  // / 4:3 video" combo, in which case the preview stays 4:3 and the
  // mode toggle has no visible effect (which is exactly what we
  // observed). We now require BOTH the photo *and* the video aspect
  // to be within tolerance of the target. Tolerance 0.15 to absorb
  // device-format rounding (1.778 vs e.g. 1.77).
  const format = useMemo(() => {
    if (!device?.formats) return undefined;

    // Simple 4:3 filter — target is constant 4/3 now, so we just want
    // formats close to that. Tight tolerance so we don't accidentally
    // pick a 16:9 format.
    const matchingFormats = device.formats.filter(f => {
      const photoRatio = Math.max(f.photoWidth, f.photoHeight) / Math.min(f.photoWidth, f.photoHeight);
      return Math.abs(photoRatio - targetAspectRatio) < 0.05;
    });

    let selected;
    if (matchingFormats.length > 0) {
      // Sort by video pixels first (for sharp preview), then photo pixels
      // Preview quality depends on video resolution, not photo resolution
      const sorted = matchingFormats.sort((a, b) => {
        const aVideoPixels = (a.videoWidth || 0) * (a.videoHeight || 0);
        const bVideoPixels = (b.videoWidth || 0) * (b.videoHeight || 0);
        // Prioritize high video resolution for sharp preview
        if (aVideoPixels !== bVideoPixels) {
          return bVideoPixels - aVideoPixels;
        }
        // Secondary: high photo resolution
        const aPhotoPixels = a.photoWidth * a.photoHeight;
        const bPhotoPixels = b.photoWidth * b.photoHeight;
        return bPhotoPixels - aPhotoPixels;
      });
      selected = sorted[0];
    } else {
      // Find closest ratio, prioritizing video resolution
      const withDiff = device.formats.map(f => {
        const formatRatio = Math.max(f.photoWidth, f.photoHeight) / Math.min(f.photoWidth, f.photoHeight);
        return {
          format: f,
          diff: Math.abs(formatRatio - targetAspectRatio),
          ratio: formatRatio,
          videoPixels: (f.videoWidth || 0) * (f.videoHeight || 0)
        };
      });

      withDiff.sort((a, b) => {
        if (Math.abs(a.diff - b.diff) < 0.01) {
          // Same aspect ratio - prioritize video resolution for sharp preview
          if (a.videoPixels !== b.videoPixels) {
            return b.videoPixels - a.videoPixels;
          }
          const aPhotoPixels = a.format.photoWidth * a.format.photoHeight;
          const bPhotoPixels = b.format.photoWidth * b.format.photoHeight;
          return bPhotoPixels - aPhotoPixels;
        }
        return a.diff - b.diff;
      });

      selected = withDiff[0].format;
    }

    if (selected) {
      const photoR = Math.max(selected.photoWidth, selected.photoHeight) / Math.min(selected.photoWidth, selected.photoHeight);
      const vw = selected.videoWidth || selected.photoWidth;
      const vh = selected.videoHeight || selected.photoHeight;
      const videoR = Math.max(vw, vh) / Math.min(vw, vh);
      console.warn(
        `[CAMDIAG] selected photo=${selected.photoWidth}x${selected.photoHeight} (r=${photoR.toFixed(3)}) ` +
        `video=${selected.videoWidth || '?'}x${selected.videoHeight || '?'} (r=${videoR.toFixed(3)}) ` +
        `target=${targetAspectRatio.toFixed(3)}`,
      );
    } else {
      console.warn(`[CAMDIAG] NO FORMAT SELECTED target=${targetAspectRatio.toFixed(3)}`);
    }

    return selected;
    // targetAspectRatio flips (4/3 ⇄ 16/9) with cameraViewMode, so
    // the format useMemo re-runs and vision-camera reconfigures the
    // native session on each aspect toggle. The transition mask
    // covers the ~200-400ms blink.
  }, [device, targetAspectRatio]);

  // Get rooms from settings (custom or default)
  const rooms = getRooms();

  // If the screen was entered without a valid room (e.g. post-create reset
  // from ProjectsScreen passes only { mode: 'before' }), or the provided room
  // isn't in the user's current industry folder list, fall back to the first
  // available room. Without this, capture handlers used to throw on
  // `room.charAt` and surface as a generic "Failed to save photo".
  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    if (!room || !rooms.some(r => r.id === room)) {
      setRoom(rooms[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);
  const labelViewRef = useRef(null);

  // Clear the per-session "progressed sets" tracker every time the user
  // (re)enters Progress mode. Without this the second pass through
  // Progress would inherit the first pass's "already done" set and
  // immediately fire the "All Sets Progressed" alert with no captures.
  useEffect(() => {
    if (mode === 'progress') {
      progressedBeforeIdsRef.current = new Set();
    }
    if (mode === 'after') {
      visitedAfterBeforeIdsRef.current = new Set();
    }
  }, [mode]);

  // Shows the ghost slider and (re)starts the auto-hide countdown.
  // Called on mount when entering After mode, on every camera-area
  // touch, and on every slider value change so it stays visible while
  // the user is actively adjusting opacity.
  const pingGhostSlider = useCallback(() => {
    setShowGhostSlider(true);
    if (ghostSliderHideTimerRef.current) {
      clearTimeout(ghostSliderHideTimerRef.current);
    }
    ghostSliderHideTimerRef.current = setTimeout(() => {
      setShowGhostSlider(false);
      ghostSliderHideTimerRef.current = null;
    }, 1500);
  }, []);

  // [CAMDIAG] Wraps setCameraViewMode so every chip tap is timestamped
  // in the log. Pair this with the STATE log in the effect below to see
  // the press → state-flip latency (JS side). Anything noticeable after
  // STATE log = native session reconfig in vision-camera.
  const handleViewModeChange = useCallback((nextMode) => {
    const t = Date.now();
    console.warn(`[CAMDIAG] CHIP PRESS at ${t} -> ${nextMode}`);
    setAspectTransitioning(true);
    // Safety fallback: if the Camera's onStarted callback doesn't fire
    // within 2s for any reason (session error, callback not delivered),
    // clear the mask anyway so the UI doesn't stay stuck black.
    if (aspectTransitionTimerRef.current) {
      clearTimeout(aspectTransitionTimerRef.current);
    }
    aspectTransitionTimerRef.current = setTimeout(() => {
      console.warn('[CAMDIAG] mask cleared by SAFETY TIMEOUT (onStarted never fired)');
      setAspectTransitioning(false);
      aspectTransitionTimerRef.current = null;
    }, 2000);
    setCameraViewMode(nextMode);
  }, []);

  // Event-driven mask clear: when vision-camera signals the new
  // session is streaming frames (onStarted), drop the mask. This
  // syncs the mask removal to the exact moment the new format is
  // ready, instead of guessing with a fixed timer.
  const handleCameraStarted = useCallback(() => {
    console.warn(`[CAMDIAG] Camera onStarted at ${Date.now()}`);
    if (aspectTransitionTimerRef.current) {
      clearTimeout(aspectTransitionTimerRef.current);
      aspectTransitionTimerRef.current = null;
    }
    setAspectTransitioning(false);
  }, []);

  const handleCameraStopped = useCallback(() => {
    console.warn(`[CAMDIAG] Camera onStopped at ${Date.now()}`);
  }, []);

  useEffect(() => {
    return () => {
      if (aspectTransitionTimerRef.current) {
        clearTimeout(aspectTransitionTimerRef.current);
        aspectTransitionTimerRef.current = null;
      }
    };
  }, []);

  // [CAMDIAG] Build marker — bump the version string with every new
  // OTA so it's trivial to verify which bundle the device is running.
  useEffect(() => {
    console.warn('[CAMDIAG] MOUNT BUILD=2026-05-26-photodel-v4');
  }, []);

  // [CAMDIAG] Same idea for zoom chips — confirms the press fires and
  // tells us when setZoom was called.
  const handleZoomPresetPress = useCallback((logical, display) => {
    const t = Date.now();
    console.warn(`[CAMDIAG] ZOOM PRESS at ${t} -> ${display} (logical=${logical})`);
    setZoom(logical);
  }, []);

  // Show the slider for ~1.5s whenever After mode becomes active with
  // a valid before photo (mount or switching into After). Cleanup
  // cancels the pending hide if the screen unmounts mid-countdown.
  useEffect(() => {
    if (mode === 'after' && getActiveBeforePhoto()) {
      pingGhostSlider();
    }
    return () => {
      if (ghostSliderHideTimerRef.current) {
        clearTimeout(ghostSliderHideTimerRef.current);
        ghostSliderHideTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Hidden vertical side-by-side base renderer
  const [isTakingPicture, setIsTakingPicture] = useState(false);
  const [showFullScreenPhoto, setShowFullScreenPhoto] = useState(null);
  const [layout, setLayout] = useState(null);

  // Helper function to get the active before photo based on current room and mode
  const getActiveBeforePhoto = () => {
    if (mode === 'after' || mode === 'progress') {
      // After / Progress mode: both attach to an existing set's Before.
      // Use selectedBeforePhoto if set (driven by horizontal-swipe set
      // switching), otherwise fall back to the route-param beforePhoto
      // for the current room, otherwise the first Before in the room
      // so capture has something to link to.
      if (selectedBeforePhoto?.room === room) return selectedBeforePhoto;
      if (beforePhoto?.room === room) return beforePhoto;
      const list = getBeforePhotos(room);
      return list.length > 0 ? list[0] : null;
    } else {
      // Before mode: show selectedBeforePhoto if matches room, otherwise show last photo from gallery
      if (selectedBeforePhoto?.room === room) {
        return selectedBeforePhoto;
      }
      const photos = getBeforePhotos(room);
      return photos.length > 0 ? photos[photos.length - 1] : null;
    }
  };

  // Update ref when room changes AND sync with global room state
  useEffect(() => {
    currentRoomRef.current = room;
    // Update global room state so HomeScreen shows the same room when camera closes
    setCurrentRoom(room);
  }, [room, setCurrentRoom]);

  // Log when navigating during processing (but don't block)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const unsubscribe = navigation.addListener('beforeRemove', () => {
      // Combined photos now use background service, so navigation is safe
    });

    return unsubscribe;
  }, [navigation]);

  // Cleanup: Turn off flashlight when component unmounts
  useEffect(() => {
    return () => {
      if (enableTorch) {
        setEnableTorch(false);
      }
    };
  }, []);

  // Update dimensions ref when dimensions change
  useEffect(() => {
    dimensionsRef.current = dimensions;
  }, [dimensions]);

  // Update showCarousel ref when showCarousel changes
  useEffect(() => {
    showCarouselRef.current = showCarousel;
  }, [showCarousel]);

  // Update showGallery ref when showGallery changes
  useEffect(() => {
    showGalleryRef.current = showGallery;
  }, [showGallery]);

  // Update showEnlargedGallery ref when it changes
  useEffect(() => {
    showEnlargedGalleryRef.current = showEnlargedGallery;
  }, [showEnlargedGallery]);

  // Update enlargedGalleryPhoto ref when it changes
  useEffect(() => {
    enlargedGalleryPhotoRef.current = enlargedGalleryPhoto;
  }, [enlargedGalleryPhoto]);

  // Mirror selectedBeforePhoto into a ref. cameraViewPanResponder is
  // built once via useRef(PanResponder.create(...)) so any direct
  // reference to selectedBeforePhoto inside its handlers stays frozen
  // at the first render's value — and set-switching swipes would then
  // bounce between only the first two sets instead of cycling all of
  // them. Reading from this ref instead picks up every state update.
  const selectedBeforePhotoRef = useRef(selectedBeforePhoto);
  useEffect(() => {
    selectedBeforePhotoRef.current = selectedBeforePhoto;
  }, [selectedBeforePhoto]);

  // Scroll gallery to correct position when opening
  // Initialize `galleryIndex` to the centered slot when the strip
  // first opens. The ScrollView's `contentOffset` prop pre-positions
  // the view without firing a scroll event, so without this effect
  // galleryIndex stays at 0 and downstream pieces (header pill set
  // number, "Retake" label, corner-thumbnail mirror, "Match" badge)
  // read the wrong slot. Mirrors the same case branches as
  // initialScrollX — default to the LAST item in both modes.
  useEffect(() => {
    if (!showGallery) return;
    if (mode === 'before') {
      // Strip is [...befores, placeholder]. Placeholder lives at
      // index = befores.length; that's the "next capture" slot, and
      // it's the default centered slot so shutter taps land on a
      // fresh capture (not a retake of the last Before).
      const befores = getBeforePhotos(room) || [];
      setGalleryIndex(befores.length);
    } else if (mode === 'after' || mode === 'progress') {
      const activeBefore = selectedBeforePhoto && selectedBeforePhoto.room === room
        ? selectedBeforePhoto
        : (getBeforePhotos(room)[0] || null);
      if (!activeBefore) {
        setGalleryIndex(0);
        if (mode === 'after') setMatchedItemIdx(-1);
        return;
      }
      const progressesCount = (getProgressPhotos?.(room) || [])
        .filter((p) => p.beforePhotoId === activeBefore.id).length;
      const afterCount = (getAfterPhotos?.(room) || [])
        .find((p) => p.beforePhotoId === activeBefore.id) ? 1 : 0;
      const realLen = 1 + progressesCount + afterCount;
      const lastIdx = Math.max(0, realLen - 1);
      setGalleryIndex(lastIdx);
      // After mode: Match badge tracks the centered card. When the
      // strip reopens (e.g. after closing the enlarged view + reopening
      // from the camera), matchedItemIdx can hold a stale index from
      // the previous session — sync it here so the badge lands on the
      // same card the center frame is highlighting.
      if (mode === 'after') setMatchedItemIdx(lastIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGallery, mode, room, selectedBeforePhoto?.id]);

  // Reset the matched item index when the active set changes so the
  // strip opens with the After (default last item) marked.
  useEffect(() => {
    setMatchedItemIdx(-1);
  }, [room, selectedBeforePhoto?.id, mode]);

  // When the enlarged carousel closes back into the half-screen
  // strip, restore the strip's scroll position to the slot the user
  // was just looking at. The strip is conditionally rendered
  // (showGallery && !showEnlargedGallery), so flipping
  // showEnlargedGallery off remounts a fresh ScrollView at offset 0 —
  // which surfaced as "active thumbnail becomes Set 1" in Before mode
  // and "jumps to the Before" in After mode. The setTimeout lets RN
  // commit the remount before we issue the scroll.
  //
  // Guard against firing on the *initial* gallery open, where
  // showEnlargedGallery has always been false and there's no position
  // to restore — without the guard we'd scroll to enlargedGalleryIndex
  // (initial 0 = first item) and override the placeholder-centering
  // effect that's supposed to land the user on the empty next-set
  // slot when the gallery first opens.
  const enlargedWasOpenRef = useRef(false);
  useEffect(() => {
    if (showEnlargedGallery) {
      enlargedWasOpenRef.current = true;
      return;
    }
    if (!showEnlargedGallery && showGallery && enlargedWasOpenRef.current) {
      // The strip is fresh-mounted with `contentOffset` already
      // positioned at enlargedGalleryIndex (see the inline calc in the
      // ScrollView), so no scrollTo call is needed here — that was the
      // source of the visible jump when closing the enlarged carousel.
      // We still mirror the index into galleryIndex so the center-
      // frame label, Retake state, and After-mode "Match" badge stay
      // in sync with the slot the user was just looking at.
      setGalleryIndex(enlargedGalleryIndex);
      if (mode === 'after') {
        setMatchedItemIdx(enlargedGalleryIndex);
      }
    }
    // Intentionally not depending on enlargedGalleryIndex — we only
    // want to fire this restore once per enlarged-close transition,
    // using whatever index was last viewed in the enlarged carousel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEnlargedGallery, showGallery]);

  // Clear the "enlarged was open" memory once the user closes the
  // small gallery entirely, so the next fresh open lands on the
  // placeholder again.
  useEffect(() => {
    if (!showGallery) {
      enlargedWasOpenRef.current = false;
    }
  }, [showGallery]);

  // Scroll enlarged gallery to correct position when opening.
  // Uses the same peek-pagination math as the render path so the
  // landing offset matches a snap boundary instead of overshooting.
  useEffect(() => {
    if (showEnlargedGallery && enlargedGalleryScrollRef.current) {
      setTimeout(() => {
        if (enlargedGalleryScrollRef.current) {
          const PEEK = 18;
          const GAP = 12;
          const cardWidth = dimensions.width - 2 * (PEEK + GAP);
          const snapInterval = cardWidth + GAP;
          const scrollX = enlargedGalleryIndex * snapInterval;
          enlargedGalleryScrollRef.current.scrollTo({
            x: scrollX,
            animated: false,
          });
        }
      }, 50);
    }
  }, [showEnlargedGallery, enlargedGalleryIndex, dimensions.width]);


  // Handle double tap
  const handleDoubleTap = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (lastTap.current && (now - lastTap.current) < DOUBLE_TAP_DELAY) {
      // Double tap detected
      const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
      const currentPhoto = mode === 'after' ? getActiveBeforePhoto() : getBeforePhotos(room)[getBeforePhotos(room).length - 1];
      const index = photos.findIndex(p => p.id === currentPhoto?.id);
      
      // Set index first, then show carousel
      setCarouselIndex(index >= 0 ? index : 0);
      
      // Use setTimeout to ensure index is set before carousel opens
      setTimeout(() => {
        carouselTranslateY.setValue(0);
      setShowCarousel(true);
      }, 10);
      
      lastTap.current = null;
    } else {
      lastTap.current = now;
    }
  };

  // Handle long press with delay
  const handleThumbnailPressIn = () => {
    // Clear any existing timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    // Set a timer for long press (500ms delay)
    longPressTimer.current = setTimeout(() => {
      // Set the index to current photo
      const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
      const currentPhoto = mode === 'after' ? getActiveBeforePhoto() : getBeforePhotos(room)[getBeforePhotos(room).length - 1];
      const index = photos.findIndex(p => p.id === currentPhoto?.id);
      setFullScreenIndex(index >= 0 ? index : 0);
      setIsFullScreen(true);
    }, 500);
  };

  const handleThumbnailPressOut = () => {
    // Clear the timer if user releases before long press is triggered
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Hide full screen
    setIsFullScreen(false);
  };

  // Handle thumbnail tap to toggle gallery (open/close)
  const handleThumbnailPress = () => {
    // If enlarged carousel is open, tapping the corner thumbnail
    // collapses the enlarged view ONLY — strip stays open so the
    // user lands back on the thumbnails view. Previous behavior
    // closed everything (back to full camera), which the user
    // reported as wrong.
    if (showEnlargedGalleryRef.current) {
      setEnlargedGalleryPhoto(null);
      setShowEnlargedGallery(false);
      return;
    }

    // If gallery is open, close it
    if (showGalleryRef.current) {
      isGalleryAnimatingRef.current = true;
      setIsGalleryAnimating(true);
      setShowGallery(false);

      Animated.timing(galleryOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true
      }).start(() => {
        isGalleryAnimatingRef.current = false;
        setIsGalleryAnimating(false);
      });
      return;
    }

    // Open gallery
    isGalleryAnimatingRef.current = true;
    setIsGalleryAnimating(true);
    setShowGallery(true);

    // Just show gallery with opacity animation - no scaling needed
    Animated.timing(galleryOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true
    }).start(() => {
      isGalleryAnimatingRef.current = false;
      setIsGalleryAnimating(false);
    });
  };

  // PanResponder for swipe-to-dismiss carousel (swipe DOWN)
  const carouselPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for vertical swipes (more vertical than horizontal)
        const { dx, dy } = gestureState;
        const isVertical = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20;
        if (isVertical) {
        }
        return isVertical;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        // Capture vertical gestures, let horizontal pass through to ScrollView
        const { dx, dy } = gestureState;
        return Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow downward swipes (positive dy)
        if (gestureState.dy > 0) {
          carouselTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        const threshold = 100; // Swipe down at least 100px to dismiss
        if (gestureState.dy > threshold) {
          // Dismiss carousel with animation - slide down
          Animated.timing(carouselTranslateY, {
            toValue: dimensionsRef.current.height,
            duration: 300,
            useNativeDriver: true
          }).start(() => {
            setShowCarousel(false);
            carouselTranslateY.setValue(0);
          });
        } else {
          // Spring back to original position
          Animated.spring(carouselTranslateY, {
            toValue: 0,
            useNativeDriver: true
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false
    })
  ).current;

  // PanResponder for closing camera (vertical swipe down)
  const cameraClosePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for vertical downward swipes (more vertical than horizontal)
        const { dx, dy } = gestureState;
        return Math.abs(dy) > Math.abs(dx) && dy > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't show movement - just detect threshold
      },
      onPanResponderRelease: (evt, gestureState) => {
        const threshold = 100; // Swipe down at least 100px to close
        if (gestureState.dy > threshold) {
          // Close camera immediately - native animation handles it
          navigation.goBack();
        }
      }
    })
  ).current;

  // PanResponder for room switching (horizontal swipes)
  const roomSwitchPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for horizontal swipes
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
        let newRoomIndex;
        
        if (gestureState.dx > swipeThreshold) {
          // Swipe right - go to previous room (circular)
          newRoomIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
        } else if (gestureState.dx < -swipeThreshold) {
          // Swipe left - go to next room (circular)
          newRoomIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
        } else {
          return; // Not enough swipe distance
        }

        const newRoom = rooms[newRoomIndex].id;
        setRoom(newRoom);
        
        // Update thumbnail based on mode
        if (mode === 'after') {
          // For after mode, try to get first unpaired before photo
          const allBeforePhotos = getBeforePhotos(newRoom);
          if (allBeforePhotos.length > 0) {
            // Set to first before photo in the room
            setSelectedBeforePhoto(allBeforePhotos[0]);
          } else {
            // No before photos in this room
            setSelectedBeforePhoto(null);
            Alert.alert(
              'No Before Photos',
              `There are no before photos in ${rooms[newRoomIndex].name}. Please take a before photo first.`,
              [{ text: 'OK' }]
            );
          }
        } else {
          // For before mode, clear the selected photo (will show empty thumbnail)
          setSelectedBeforePhoto(null);
        }
      }
    })
  ).current;

  // Combined PanResponder that handles both swipe directions
  const combinedPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Don't capture gestures if carousel or gallery is open
        if (showCarouselRef.current) {
          return false;
        }
        if (showGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        // Vertical swipe down for closing camera
        if (Math.abs(dy) > Math.abs(dx) && dy > 10) {
          return true;
        }
        // Horizontal swipe for room switching
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30) {
          return true;
        }
        return false;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't show movement - just detect threshold
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        
        // Check if it's a vertical swipe down (closing gesture)
        if (Math.abs(dy) > Math.abs(dx)) {
          const threshold = 100;
          if (dy > threshold) {
            // Close camera immediately - native animation handles it
            navigation.goBack();
          }
        } 
        // Check if it's a horizontal swipe (room switching)
        else if (Math.abs(dx) > Math.abs(dy)) {
          const swipeThreshold = 50;
          const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
          
          if (dx > swipeThreshold) {
            // Swipe right - go to previous room (circular)
            const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
            const newRoom = rooms[newIndex].id;
            setRoom(newRoom);
            if (mode === 'after') {
              const unpairedPhotos = getUnpairedBeforePhotos(newRoom);
              if (unpairedPhotos.length > 0) {
                setSelectedBeforePhoto(unpairedPhotos[0]);
              } else {
                setSelectedBeforePhoto(null);
              }
            }
          } else if (dx < -swipeThreshold) {
            // Swipe left - go to next room (circular)
            const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
            const newRoom = rooms[newIndex].id;
            setRoom(newRoom);
            if (mode === 'after') {
              const unpairedPhotos = getUnpairedBeforePhotos(newRoom);
              if (unpairedPhotos.length > 0) {
                setSelectedBeforePhoto(unpairedPhotos[0]);
              } else {
                setSelectedBeforePhoto(null);
              }
            }
          }
        }
      }
    })
  ).current;

  // Unified PanResponder for camera view (handles swipe up/down based on gallery state)
  const cameraViewPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Don't activate if carousel, fullscreen, or enlarged gallery/photo is open
        // NOTE: Allow gestures even when gallery is animating, so user can cancel the opening animation
        if (showCarouselRef.current || isFullScreen || enlargedGalleryPhotoRef.current || showEnlargedGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        
        // If gallery is shown, respond to swipe down from ANYWHERE or horizontal swipe
        if (showGalleryRef.current) {
          const gestureY = evt.nativeEvent.pageY;
          const screenHeight = dimensionsRef.current.height;
          const galleryTop = screenHeight * 0.6; // top of bottom gallery area
          const isTopArea = gestureY < galleryTop;
          const isSwipeDown = dy > 0 && (Math.abs(dy) >= Math.abs(dx) || Math.abs(dx) < 5);
          const isHorizontal = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5;
          // Only allow horizontal room switching from TOP area; bottom area horizontal should be handled by ScrollView
          return isSwipeDown || (isTopArea && isHorizontal);
        }
        
        // If gallery is NOT shown, respond to swipe up, swipe down, or horizontal swipes
        const isVerticalSwipe = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10;
        const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
        return isVerticalSwipe || isHorizontalSwipe;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        // Don't activate if carousel, fullscreen, or enlarged gallery/photo is open
        // NOTE: Allow gestures even when gallery is animating, so user can cancel the opening animation
        if (showCarouselRef.current || isFullScreen || enlargedGalleryPhotoRef.current || showEnlargedGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        
        // When gallery is shown:
        // Capture strategy: be EXTREMELY aggressive to beat ScrollView
        if (showGalleryRef.current) {
          const gestureY = evt.nativeEvent.pageY;
          const screenHeight = dimensionsRef.current.height;
          const galleryTop = screenHeight * 0.6;
          const isBottomArea = gestureY >= galleryTop;
          
          // Gallery area (bottom 40%): Capture at the SLIGHTEST vertical movement
          // We need to capture before ScrollView claims it
          if (isBottomArea) {
            // ANY downward movement, even 0.1px, as long as it's not clearly horizontal
            const isDownward = dy > 0;
            const notClearlyHorizontal = Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 5;
            if (isDownward && notClearlyHorizontal) {
              return true;
            }
            // Don't capture horizontal gestures - let ScrollView handle them
            return false;
          }
          
          // Camera area (top 60%): Standard capture for vertical/horizontal
          const isVertical = dy > 2 && Math.abs(dy) > Math.abs(dx);
          const isHorizontal = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
          if (isVertical || isHorizontal) {
            return true;
          }
          
          return false;
        }
        
        return (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) || 
               (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        
        // If gallery is shown, handle swipes
        if (showGalleryRef.current) {
          // Vertical swipe down - close gallery (reduced threshold for better responsiveness)
          if (Math.abs(dy) > Math.abs(dx) && dy > 20) {
            // Stop any ongoing animations immediately
            galleryOpacity.stopAnimation();

            // Set animating flag to block new gestures
            isGalleryAnimatingRef.current = true;
            setIsGalleryAnimating(true);

            // Update state immediately before animation
            setShowGallery(false);

            // Only animate gallery opacity - no camera scaling
            Animated.timing(galleryOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true
            }).start(() => {
              galleryOpacity.setValue(0);

              // Add small delay before allowing next gesture
              setTimeout(() => {
                isGalleryAnimatingRef.current = false;
                setIsGalleryAnimating(false);
              }, 100);
            });
            return;
          }
          
          // Horizontal swipe — switches SET, not room, while either
          // gallery panel is open. The "set" navigation walks through
          // each Before photo in the current room (each Before = one
          // capture session). The thumbnails row + enlarged carousel
          // both re-derive their contents from selectedBeforePhoto, so
          // updating it here is enough to swap the visible set.
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            // Only react to gestures that started in the TOP camera area
            // — the bottom thumbnails strip has its own horizontal
            // scroll and must not be hijacked here.
            const startY = gestureState.y0;
            const galleryTop = dimensionsRef.current.height * 0.6;
            if (startY >= galleryTop) {
              return;
            }
            // Set-switching applies to any mode that operates on an
            // existing Before (After + Progress). In Before mode each
            // capture creates a NEW set, so there's nothing to switch.
            if (mode !== 'after' && mode !== 'progress') return;
            const roomBefores = getBeforePhotos(currentRoomRef.current) || [];
            if (roomBefores.length < 2) return; // nothing to swipe between
            const liveSelected = selectedBeforePhotoRef.current;
            const currentBeforeId = liveSelected?.id || roomBefores[0]?.id;
            const idx = Math.max(0, roomBefores.findIndex((b) => b.id === currentBeforeId));
            const nextIdx = dx > 0
              ? (idx > 0 ? idx - 1 : roomBefores.length - 1)
              : (idx < roomBefores.length - 1 ? idx + 1 : 0);
            const nextBefore = roomBefores[nextIdx];
            if (nextBefore) {
              setSelectedBeforePhoto(nextBefore);
              setEnlargedGalleryIndex(0); // reset to the new set's Before
            }
            return;
          }
        }
        
        // If gallery is NOT shown, handle all gestures
        if (!showGalleryRef.current) {
          // Check for vertical swipe
          if (Math.abs(dy) > Math.abs(dx)) {
            // Swipe down - close camera. Mirror the Done button: prefer
            // navigate('Home') so the existing Home screen isn't re-
            // mounted (avoids the brief layout glitch). Camera screen
            // has animation: 'none' globally so this is instant.
            if (dy > 100) {
              try {
                const state = navigation.getState?.();
                const hasHome = state?.routes?.some?.((r) => r.name === 'Home');
                if (hasHome) {
                  navigation.navigate('Home');
                  return;
                }
              } catch {}
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              return;
            }
            // Swipe up - show gallery
            if (dy < -100) {
              // Set animating flag
              isGalleryAnimatingRef.current = true;
              setIsGalleryAnimating(true);
              setShowGallery(true);

              // Only animate gallery opacity - no camera scaling
              Animated.timing(galleryOpacity, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true
              }).start(() => {
                setTimeout(() => {
                  isGalleryAnimatingRef.current = false;
                  setIsGalleryAnimating(false);
                }, 100);
              });
              return;
            }
          }
          
          // Horizontal swipe on the camera area — switches SET (the
          // active Before within the current room). Replaces the
          // previous room-switching behavior per user spec; set
          // switching matches what happens when the gallery panel is
          // open, so the gesture is now consistent across both states.
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            if (mode !== 'after' && mode !== 'progress') return;
            const roomBefores = getBeforePhotos(currentRoomRef.current) || [];
            if (roomBefores.length < 2) return; // nothing to swipe between
            const liveSelected = selectedBeforePhotoRef.current;
            const currentBeforeId = liveSelected?.id || roomBefores[0]?.id;
            const idx = Math.max(0, roomBefores.findIndex((b) => b.id === currentBeforeId));
            const nextIdx = dx > 0
              ? (idx > 0 ? idx - 1 : roomBefores.length - 1)
              : (idx < roomBefores.length - 1 ? idx + 1 : 0);
            const nextBefore = roomBefores[nextIdx];
            if (nextBefore) {
              setSelectedBeforePhoto(nextBefore);
              setEnlargedGalleryIndex(0);
            }
          }
        }
      },
      onPanResponderTerminationRequest: () => false
    })
  ).current;

  // PanResponder for swipe down on enlarged gallery carousel
  const enlargedGalleryPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dy } = gestureState;
        return showEnlargedGalleryRef.current && dy > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't animate movement - just detect swipe down gesture
        // This prevents visual sliding that would flash the gallery underneath
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dy } = gestureState;
        const threshold = 80;

        if (dy > threshold) {
          // Swipe-down from the enlarged carousel goes ALL the way back to
          // the full camera view (closes the thumbnail row too), so the
          // user doesn't have to dismiss two layers manually. The top-left
          // back arrow handles the partial close back to thumbnails.
          setEnlargedGalleryPhoto(null);
          setShowEnlargedGallery(false);
          setShowGallery(false);
          galleryOpacity.setValue(0);
        }
        // If swipe wasn't strong enough, just ignore it (no spring back animation needed)
      }
    })
  ).current;

  // Detect screen rotation and update dimensions
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const newOrientation = window.width > window.height ? 'landscape' : 'portrait';
      console.warn(`[CAMDIAG] DIMS change w=${window.width} h=${window.height} -> ${newOrientation} at ${Date.now()}`);
      // Update dimensions immediately for instant response
      setDimensions({ width: window.width, height: window.height });
      setDeviceOrientation(newOrientation);
      
      // Also update specificOrientation to match if there's a clear portrait/landscape change
      if (newOrientation === 'portrait') {
        setSpecificOrientation(1); // Force to portrait
      }
      // For landscape, let the ScreenOrientation listener handle the specific value (3 or 4)
    });

    // Get specific orientation (landscape-left vs landscape-right)
    const getSpecificOrientation = async () => {
      const orientation = await ScreenOrientation.getOrientationAsync();
      setSpecificOrientation(orientation);
    };
    
    const orientationSubscription = ScreenOrientation.addOrientationChangeListener((event) => {
      const orientation = event.orientationInfo.orientation;
      const orientationNames = {
        1: 'PORTRAIT',
        2: 'PORTRAIT_UPSIDE_DOWN',
        3: 'LANDSCAPE_LEFT (counter-clockwise)',
        4: 'LANDSCAPE_RIGHT (clockwise)'
      };
      // Cross-check with dimensions to ensure consistency
      const currentDims = Dimensions.get('window');
      const currentOrientation = currentDims.width > currentDims.height ? 'landscape' : 'portrait';
      
      if (currentOrientation === 'portrait' && (orientation === 3 || orientation === 4)) {
        setSpecificOrientation(1);
      } else if (currentOrientation === 'landscape' && orientation === 1) {
        // Keep the landscape orientation (3 or 4) - don't force to portrait
      } else {
        // Update immediately - native rotation is already smooth
        setSpecificOrientation(event.orientationInfo.orientation);
      }
    });
    
    // Get orientation immediately on mount
    getSpecificOrientation();

    // Cleanup listener on unmount
    return () => {
      subscription?.remove();
      ScreenOrientation.removeOrientationChangeListener(orientationSubscription);
    };
  }, []);

  // [CAMDIAG] Log every cameraViewMode change with timestamp so we can
  // measure how long the actual state flip → visible re-render takes.
  useEffect(() => {
    console.warn(`[CAMDIAG] STATE cameraViewMode=${cameraViewMode} at ${Date.now()}`);
  }, [cameraViewMode]);

  // [CAMDIAG] Log every format-reference change. If the format prop is
  // STABLE across a toggle (same object identity), vision-camera won't
  // reconfigure the native session — toggles should feel instant. If it
  // changes, we know reconfig is happening and the delay is native.
  useEffect(() => {
    console.warn(`[CAMDIAG] FORMAT ref changed at ${Date.now()} hasFormat=${!!format}`);
  }, [format]);

  // [CAMDIAG] Log when the Camera wrapper's React key would change. The
  // wrapper only remounts when key changes (letterbox toggle or rotation
  // inside letterbox). If we see this fire on every 9:16⇄3:4 toggle the
  // wrapper logic is wrong; if it doesn't, the toggle is layout-only.
  useEffect(() => {
    const cameraKey = `cam-${deviceOrientation}`;
    console.warn(`[CAMDIAG] CAMERA wrapper key="${cameraKey}" mode=${cameraViewMode} at ${Date.now()}`);
  }, [cameraViewMode, deviceOrientation]);

  // [CAMDIAG] Confirms zoom state actually flips after a chip press.
  // If ZOOM PRESS fires but this doesn't, setZoom isn't being applied.
  useEffect(() => {
    console.warn(`[CAMDIAG] ZOOM state=${zoom} activeIdx=${activePresetIndex} at ${Date.now()}`);
  }, [zoom, activePresetIndex]);

  // [CAMDIAG] Logs the device's reported zoom capabilities once so we
  // can verify the preset math matches the actual hardware. If
  // neutralZoom or minZoom differ from the assumed values, the
  // activePresetIndex calculation will pick the wrong chip and the
  // highlight will look broken.
  useEffect(() => {
    if (device) {
      const presetSummary = zoomPresets
        .map((p) => `(disp=${p.display},log=${p.logical})`)
        .join(' ');
      console.warn(
        `[CAMDIAG] DEVICE min=${device.minZoom} neutral=${device.neutralZoom} ` +
        `max=${device.maxZoom} hasUW=${hasUltraWide} presets=${presetSummary}`,
      );
    }
  }, [device, hasUltraWide, zoomPresets]);

  // [CAMDIAG] Confirms deviceOrientation state flips on rotation. If
  // this never fires when the phone rotates, the Dimensions listener
  // is not propagating to React state.
  useEffect(() => {
    console.warn(`[CAMDIAG] ORIENT state=${deviceOrientation} at ${Date.now()}`);
  }, [deviceOrientation]);

  // Track when aspectRatio state changes
  useEffect(() => {
  }, [aspectRatio]);

  // Handle screen focus/blur to re-check permissions and settings
  useFocusEffect(
    useCallback(() => {
      if (!hasPermission) {
        requestPermission();
      }
    }, [hasPermission, requestPermission, dimensions, deviceOrientation, cameraViewMode, aspectRatio, pictureSize, mode])
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission]);

  // Force orientation check on mount to ensure correct initial state
  // Show room indicator when room changes (but not on initial mount)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    // Clear any existing timer
    if (roomIndicatorTimer.current) {
      clearTimeout(roomIndicatorTimer.current);
    }
    
    // Show indicator
    setShowRoomIndicator(true);
    
    // Hide after 500ms
    roomIndicatorTimer.current = setTimeout(() => {
      setShowRoomIndicator(false);
      roomIndicatorTimer.current = null;
    }, 500);
    
    return () => {
      if (roomIndicatorTimer.current) {
        clearTimeout(roomIndicatorTimer.current);
      }
    };
  }, [room]);

  useEffect(() => {
    const checkOrientation = async () => {
      // Delay to ensure screen transition is complete and stable
      setTimeout(async () => {
        const orientation = await ScreenOrientation.getOrientationAsync();
        const currentDims = Dimensions.get('window');
        const currentOrientation = currentDims.width > currentDims.height ? 'landscape' : 'portrait';
        // Cross-check: If dimensions say portrait but API says landscape (or vice versa), trust dimensions
        if (currentOrientation === 'portrait' && (orientation === 3 || orientation === 4)) {
          setSpecificOrientation(1);
        } else if (currentOrientation === 'landscape' && orientation === 1) {
          setSpecificOrientation(3);
        } else {
          setSpecificOrientation(orientation);
        }
      }, 250);
    };
    checkOrientation();
  }, []);

  // Initialize selectedBeforePhoto from beforePhoto if not set
  useEffect(() => {
    if (mode === 'after' && beforePhoto && !selectedBeforePhoto) {
      setSelectedBeforePhoto(beforePhoto);
    }
  }, [mode, beforePhoto]);

  // Check if there are before photos when entering after mode
  useEffect(() => {
    if (mode === 'after' && !beforePhoto && !selectedBeforePhoto) {
      const allBeforePhotos = getBeforePhotos(room);
      if (allBeforePhotos.length > 0) {
        // Set to first before photo in the room
        setSelectedBeforePhoto(allBeforePhotos[0]);
      }
    }
  }, [mode, room]);

  // Calculate and set aspect ratio for before mode (iOS portrait)
  useEffect(() => {
    if (mode === 'before' && Platform.OS === 'ios' && cameraViewMode === 'portrait') {
      const screenWidth = dimensions.width;
      const screenHeight = dimensions.height;
      const ratio = deviceOrientation === 'landscape'
        ? screenWidth / screenHeight
        : screenHeight / screenWidth;
      const calculatedRatio = `${ratio.toFixed(2)}:1`;
      setAspectRatio(calculatedRatio);
    } else if (mode === 'before' && Platform.OS === 'ios' && cameraViewMode === 'landscape') {
      setAspectRatio('4:3');
    } else if (mode === 'before' && Platform.OS === 'android') {
      const androidRatio = cameraViewMode === 'landscape' ? '4:3' : '9:16';
      setAspectRatio(androidRatio);
    }
  }, [mode, cameraViewMode, dimensions, deviceOrientation]);

  // Set aspect ratio to match before photo in after mode
  useEffect(() => {
    if (mode === 'after') {
      const activeBeforePhoto = getActiveBeforePhoto();
      if (activeBeforePhoto) {
        if (activeBeforePhoto.aspectRatio) {
          setAspectRatio(activeBeforePhoto.aspectRatio);
        }
      }
    }
  }, [selectedBeforePhoto, mode, beforePhoto]);

  // In After / Progress mode, default the camera view mode AND the
  // zoom to whatever the previous photo in this set used. The user
  // can still override either; this only seeds the initial values
  // when the active set changes (or on mount). For Progress mode
  // we look at the most recent photo (the user's latest capture in
  // the set), so consecutive progress shots stay framed the same.
  useEffect(() => {
    if (mode !== 'after' && mode !== 'progress') return;
    const activeBeforePhoto = getActiveBeforePhoto();
    if (!activeBeforePhoto) return;

    const progresses = (getProgressPhotos?.(room) || [])
      .filter((p) => p.beforePhotoId === activeBeforePhoto.id);
    const after = (getAfterPhotos?.(room) || [])
      .find((p) => p.beforePhotoId === activeBeforePhoto.id);
    const setMembers = [activeBeforePhoto, ...progresses, ...(after ? [after] : [])]
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const previous = setMembers[0] || activeBeforePhoto;

    if (previous.cameraViewMode) {
      setCameraViewMode(previous.cameraViewMode);
    } else {
      setCameraViewMode((prev) => prev || deviceOrientation);
    }
    if (typeof previous.zoom === 'number' && !Number.isNaN(previous.zoom)) {
      setZoom(previous.zoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deviceOrientation, selectedBeforePhoto, room]);

  // Log when selectedBeforePhoto changes in after mode
  useEffect(() => {
    if (mode === 'after' && selectedBeforePhoto) {
    }
  }, [selectedBeforePhoto, mode, deviceOrientation]);

  // Ensure carousel starts at correct position
  useEffect(() => {
    if (showCarousel && carouselScrollRef.current) {
      // Small delay to ensure ScrollView is rendered, then force scroll to position
      requestAnimationFrame(() => {
        carouselScrollRef.current?.scrollTo({
          x: carouselIndex * dimensions.width,
          y: 0,
          animated: false
        });
      });
    }
  }, [showCarousel]);

  useEffect(() => {
    if (route.params?.beforePhoto) {
      setSelectedBeforePhoto(route.params.beforePhoto);
    }
    // Analytics removed for build compatibility
  }, [route.params]);

  useEffect(() => {
    const getPermissions = async () => {
      if (hasPermission) return;
      requestPermission();
    };
    getPermissions();
  }, [hasPermission, requestPermission]);

  // Using pictureSize="Photo" + skipProcessing=true for maximum resolution without preview scaling

  const takePicture = async () => {
    if (!cameraRef.current || isCapturing || !device) return;

    // Check orientation mismatch for after mode
    if (isOrientationMismatch()) {
      const beforeOrientation = getActiveBeforePhoto()?.orientation || 'portrait';
      Alert.alert(
        'Wrong Orientation',
        `The before photo was taken in ${beforeOrientation} mode. Please rotate your phone to ${beforeOrientation} orientation to match.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setIsCapturing(true);

      // Auto-create a project on first photo if none exists
      if (!activeProjectId && projects.length === 0) {
        try {
          const locationDisplay = getLocationName(location);
          const name = createAlbumName((userName || '').trim() || 'Project', new Date(), null, locationDisplay);
          const safeName = name.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
          const proj = await createProject(safeName);
          if (proj?.id) {
            await setActiveProject(proj.id);
          }
        } catch (e) {
          console.error('[CameraScreen] Failed to auto-create project:', e);
        }
      }

      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'quality',
        // Only request flash if the current device reports flash support
        flash: enableTorch && supportsFlash ? 'on' : 'off',
        enableShutterSound: shutterSoundEnabled
      });
      const photoUri = `file://${photo.path}`;
      // No post-capture crop needed: each cameraViewMode uses the
      // sensor format that natively produces the target aspect (4:3
      // for landscape/3:4 letterbox, 16:9 for portrait/9:16 full).

      // Start capture animation (runs in parallel with photo processing)
      runCaptureAnimation(photoUri);

      if (mode === 'before') {
        // Retake context: when the gallery strip is open and the user
        // has scrolled it back onto an existing Set, shutter ought to
        // ask whether to replace that set's Before or save the new
        // shot as a brand new set. Without the strip open (or with the
        // placeholder centered) it's always a new set.
        const beforesForRetake = getBeforePhotos(room) || [];
        const isRetakeContext =
          showGalleryRef.current && galleryIndex >= 0 && galleryIndex < beforesForRetake.length;
        if (isRetakeContext) {
          const target = beforesForRetake[galleryIndex];
          const choice = await new Promise((resolve) => {
            Alert.alert(
              'Replace or new set?',
              `You're viewing Set ${galleryIndex + 1}. Replace this Before with the new photo, or save it as a new set?`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
                { text: 'Save as new', onPress: () => resolve('new') },
                { text: 'Replace', style: 'destructive', onPress: () => resolve('replace') },
              ],
              { cancelable: false },
            );
          });
          if (!choice) return; // user canceled — drop the captured frame
          if (choice === 'replace') {
            await handleBeforePhoto(photoUri, { replaceId: target?.id });
          } else {
            await handleBeforePhoto(photoUri);
          }
        } else {
          await handleBeforePhoto(photoUri);
        }
      } else if (mode === 'after') {
        await handleAfterPhoto(photoUri);
      } else if (mode === 'progress') {
        await handleProgressPhoto(photoUri);
      }
    } catch (error) {
      const msg = error?.message || String(error) || 'unknown error';
      console.error('[CameraScreen] takePicture failed:', msg, error?.stack || error);
      Alert.alert('Error', `Failed to take picture: ${msg}`);
    } finally {
      setIsCapturing(false);
    }
  };

  // Pick a photo from the device gallery
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const pickedAsset = result.assets[0];
      const photoUri = pickedAsset.uri;

      // Auto-create project if needed (same as takePicture)
      if (!activeProjectId && projects.length === 0) {
        try {
          const locationDisplay = getLocationName(location);
          const name = createAlbumName((userName || '').trim() || 'Project', new Date(), null, locationDisplay);
          const safeName = name.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
          const proj = await createProject(safeName);
          if (proj?.id) {
            await setActiveProject(proj.id);
          }
        } catch (e) {
          console.error('[CameraScreen] Failed to auto-create project:', e);
        }
      }

      if (mode === 'before') {
        await handleBeforePhoto(photoUri);
      } else if (mode === 'after') {
        setIsProcessingAfter(true);
        try {
          await handleAfterPhoto(photoUri);
        } finally {
          setIsProcessingAfter(false);
        }
      } else if (mode === 'progress') {
        await handleProgressPhoto(photoUri);
      }
    } catch (error) {
      const msg = error?.message || String(error) || 'unknown error';
      console.error('[CameraScreen] pickFromGallery failed:', msg, error?.stack || error);
      Alert.alert('Error', `Failed to pick photo from gallery: ${msg}`);
    }
  };

  // Animate captured photo flying to thumbnail
  const runCaptureAnimation = useCallback((photoUri) => {
    // Reset animation values
    captureAnimScale.setValue(1);
    captureAnimTranslateX.setValue(0);
    captureAnimTranslateY.setValue(0);
    captureAnimOpacity.setValue(1);

    // Set the captured photo URI to show the overlay
    setCaptureAnimationUri(photoUri);

    const screenWidth = dimensions.width;
    const screenHeight = dimensions.height;

    // The animated image starts centered on screen (due to justifyContent/alignItems center)
    // Thumbnail is in bottom controls area: left side, near bottom of screen
    // Bottom controls: paddingBottom: 20, mainControlRow has 3 equal buttonContainers

    // Thumbnail dimensions (now 68x68 square)
    const thumbnailSize = 68;

    // The overlay image is 100% width and 70% height, centered
    // Starting center: (screenWidth/2, screenHeight/2)
    const startCenterX = screenWidth / 2;
    const startCenterY = screenHeight / 2;

    let thumbnailCenterX, thumbnailCenterY;

    if (deviceOrientation === 'landscape') {
      // In landscape mode, the UI layer is counter-rotated to keep buttons fixed.
      // The animation overlay is NOT rotated, so we need to calculate where
      // the thumbnail appears in actual screen coordinates.
      //
      // specificOrientation: 3 = LANDSCAPE_LEFT (phone rotated counter-clockwise)
      //   - UI rotated +90deg, buttons appear on RIGHT side of screen
      //   - Thumbnail (first in row) appears at BOTTOM-RIGHT of screen
      //
      // specificOrientation: 4 = LANDSCAPE_RIGHT (phone rotated clockwise)
      //   - UI rotated -90deg, buttons appear on LEFT side of screen
      //   - Thumbnail (first in row) appears at TOP-LEFT of screen
      //
      if (specificOrientation === 4) {
        // LANDSCAPE_RIGHT: thumbnail is at BOTTOM-RIGHT
        thumbnailCenterX = screenWidth - 60 - (thumbnailSize / 2);
        thumbnailCenterY = screenHeight - 60 - (thumbnailSize / 2);
      } else {
        // LANDSCAPE_LEFT: thumbnail is at TOP-LEFT
        thumbnailCenterX = 60 + (thumbnailSize / 2);
        thumbnailCenterY = 60 + (thumbnailSize / 2);
      }
    } else {
      // Portrait mode: thumbnail is always on the left
      thumbnailCenterX = screenWidth / 6;
      thumbnailCenterY = screenHeight - 60 - (thumbnailSize / 2);
    }

    // Calculate required translation (target - start)
    const targetX = thumbnailCenterX - startCenterX;
    const targetY = thumbnailCenterY - startCenterY;

    // Scale: from full size to thumbnail size
    const imageHeight = screenHeight * 0.7; // 70% as per style
    const targetScale = thumbnailSize / imageHeight;

    // Run the animation
    Animated.parallel([
      Animated.timing(captureAnimScale, {
        toValue: targetScale,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(captureAnimTranslateX, {
        toValue: targetX,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(captureAnimTranslateY, {
        toValue: targetY,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(250),
        Animated.timing(captureAnimOpacity, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      // Clear the animation URI when done
      setCaptureAnimationUri(null);
    });
  }, [dimensions, cameraViewMode, deviceOrientation, specificOrientation, captureAnimScale, captureAnimTranslateX, captureAnimTranslateY, captureAnimOpacity]);

  // Helper function to prepare combined photo with labels in background
  // Now uses global service that stays mounted regardless of navigation
  const prepareCombinedPhotoInBackground = (combinedPhoto, beforePhoto, afterPhoto, settingsHash, isLetterbox) => {
    return new Promise((resolve, reject) => {
      if (!combinedPhoto || !beforePhoto || !afterPhoto) {
        resolve();
        return;
      }

      try {
        // Get dimensions of combined photo
        // Image.getSize returns actual file pixel dimensions for local file:// URIs.
        // No PixelRatio conversion needed - native module loads the same file and gets the same dimensions.
        Image.getSize(combinedPhoto.uri, (width, height) => {
          console.log(`[CameraScreen] Combined photo dimensions: ${width}x${height}`);

          // Queue preparation in global service (stays mounted regardless of navigation)
          backgroundLabelPreparationService.queuePreparation({
            photo: combinedPhoto,
            beforePhoto,
            afterPhoto,
            width,
            height,
            settingsHash,
            isLetterbox,
            combinedLayout: combinedPhoto.combinedLayout,
            beforeLabelPosition: beforeLabelPosition || 'top-left',
            afterLabelPosition: afterLabelPosition || 'top-right',
            isCombined: true,
            resolve,
            reject,
          });
        }, (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  // Helper function to prepare labeled photo in background and save to cache
  // Now uses global service that stays mounted regardless of navigation
  const prepareLabeledPhotoInBackground = (photo, settingsHash, mode) => {
    return new Promise((resolve, reject) => {
      if (!photo || !photo.uri || !photo.id) {
        resolve();
        return;
      }

      try {
        // Get image dimensions
        // Image.getSize returns actual file pixel dimensions for local file:// URIs.
        // No PixelRatio conversion needed - native module loads the same file and gets the same dimensions.
        Image.getSize(photo.uri, (width, height) => {
          console.log(`[CameraScreen] Single photo dimensions: ${width}x${height}`);

          // Determine label position based on photo mode
          let labelPosition;
          if (mode === 'before') {
            labelPosition = beforeLabelPosition || 'top-left';
          } else if (mode === 'after') {
            labelPosition = afterLabelPosition || 'top-right';
          } else {
            labelPosition = 'top-left';
          }

          // Queue preparation in global service (stays mounted regardless of navigation)
          backgroundLabelPreparationService.queuePreparation({
            photo,
            width,
            height,
            labelPosition,
            settingsHash,
            mode,
            resolve,
            reject,
          });
        }, (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  // Background label preparation is now handled by GlobalBackgroundLabelPreparation component
  // No local useEffect hooks needed - the global component stays mounted regardless of navigation

  // Helper function to add label to photo
  const addLabelToPhoto = async (uri, labelText) => {
    return uri; // Temporarily disabled
    
    if (!showLabels) {
      return uri;
    }

    try {
      // Get image dimensions
      return new Promise((resolve) => {
        Image.getSize(uri, async (width, height) => {
          setTempPhotoDimensions({ width, height });
          setTempPhotoUri(uri);
          setTempPhotoLabel(labelText);
          
          // Wait for next frame to ensure view is rendered
          setTimeout(async () => {
            try {
              if (labelViewRef.current) {
                const capturedUri = await captureRef(labelViewRef, {
                  format: 'jpg',
                  quality: 0.95,
                  width,
                  height
                });
                setTempPhotoUri(null);
                setTempPhotoLabel(null);
                setTempPhotoDimensions({ width: 1080, height: 1920 });
                resolve(capturedUri);
              } else {
                setTempPhotoUri(null);
                setTempPhotoLabel(null);
                setTempPhotoDimensions({ width: 1080, height: 1920 });
                resolve(uri);
              }
            } catch (error) {
              setTempPhotoUri(null);
              setTempPhotoLabel(null);
              setTempPhotoDimensions({ width: 1080, height: 1920 });
              resolve(uri);
            }
          }, 300);
        }, (error) => {
          resolve(uri);
        });
      });
    } catch (error) {
      return uri;
    }
  };

  // Best-effort GPS snapshot. Returns { lat, lng } or null if
  // permission denied / lookup fails / times out. Bounded to ~3 s
  // so a slow GPS lock can't stall the save.
  const captureGpsForPhoto = async () => {
    try {
      const perm = await ExpoLocation.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        const req = await ExpoLocation.requestForegroundPermissionsAsync();
        if (req.status !== 'granted') return null;
      }
      const loc = await Promise.race([
        ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced }),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!loc || !loc.coords) return null;
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch (_) {
      return null;
    }
  };

  const handleBeforePhoto = async (uri, options = {}) => {
    const { replaceId = null } = options;
    try {
      // Retake / replace branch: the user scrolled the gallery strip
      // onto a previous set, hit shutter, and picked "Replace" in the
      // confirm popup. Keep the existing Before record (id, name,
      // timestamp, ordering) but swap its photo file + freshly-
      // captured orientation/aspect/zoom values. Cleans up the old
      // file in Documents; the PhotoKit asset stays on the device to
      // avoid an interrupting iOS delete prompt — same trade-off the
      // After demote path makes.
      if (replaceId) {
        const existing = (getBeforePhotos(room) || []).find((b) => b.id === replaceId);
        if (!existing) {
          // The target vanished between popup and save — fall through
          // to the default "new set" path so the photo isn't lost.
        } else {
          const currentOrientation = deviceOrientation;
          const aspectRatio = cameraViewMode === 'landscape'
            ? (currentOrientation === 'landscape' ? '4:3' : '3:4')
            : (currentOrientation === 'landscape' ? '16:9' : '9:16');
          const oldUri = existing.uri;
          const savedUri = await savePhotoToDevice(
            uri,
            `${room}_${existing.name}_BEFORE_${Date.now()}.jpg`,
            activeProjectId || null,
          );
          await updatePhoto(replaceId, {
            uri: savedUri,
            aspectRatio,
            orientation: currentOrientation,
            cameraViewMode,
            zoom,
          });
          // Best-effort cleanup of the prior Documents file. We don't
          // touch the iOS Photos library entry here.
          try {
            if (oldUri && oldUri.startsWith('file://')) {
              await FileSystem.deleteAsync(oldUri, { idempotent: true });
            }
          } catch {}
          setSelectedBeforePhoto({ ...existing, uri: savedUri, aspectRatio, orientation: currentOrientation, cameraViewMode, zoom });
          return;
        }
      }

      // Generate photo name
      const roomPhotos = getBeforePhotos(room);
      const photoNumber = roomPhotos.length + 1;
      const photoName = `${room.charAt(0).toUpperCase() + room.slice(1)} ${photoNumber}`;

      // Capture device orientation (actual phone orientation)
      const currentOrientation = deviceOrientation;
      let processedUri = uri;

      // Aspect ratio is derived deterministically from the user's
      // chosen mode + the device's physical orientation at capture
      // time. No need to probe the captured image's dimensions —
      // they always reflect the same combination, and Image.getSize
      // adds latency. The values stored are the user-facing aspect:
      //   3:4 mode portrait device  → '3:4'   (portrait letterbox)
      //   3:4 mode landscape device → '4:3'   (landscape letterbox)
      //   9:16 mode portrait device → '9:16'  (portrait full screen)
      //   9:16 mode landscape device→ '16:9'  (landscape full screen)
      const aspectRatio = cameraViewMode === 'landscape'
        ? (currentOrientation === 'landscape' ? '4:3' : '3:4')
        : (currentOrientation === 'landscape' ? '16:9' : '9:16');

      // Save processed photo to device
      const savedUri = await savePhotoToDevice(processedUri, `${room}_${photoName}_BEFORE_${Date.now()}.jpg`, activeProjectId || null);

      // GPS snapshot (best-effort, non-blocking). Stored on the
      // Before record so the project's Location-tab map can drop
      // a pin per capture session. After / Progress photos in the
      // same set will inherit this Before's lat/lng — see
      // handleAfterPhoto / handleProgressPhoto.
      const gps = await captureGpsForPhoto();

      // Add to photos with device orientation AND camera view mode
      // AND zoom — saved so the next photo in this set (After /
      // Progress) can default to the same framing.
      const newPhoto = {
        id: Date.now(),
        uri: savedUri,
        room,
        mode: PHOTO_MODES.BEFORE,
        name: photoName,
        timestamp: Date.now(),
        aspectRatio: aspectRatio,
        orientation: currentOrientation,
        cameraViewMode: cameraViewMode, // Save the camera view mode
        zoom,
        ...(gps ? { lat: gps.lat, lng: gps.lng } : null),
      };

      await addPhoto(newPhoto);
      logPhotoCapture('before', 'camera', activeProjectId);
      logBeforePhotoStarted(activeProjectId, 'camera');
      onBeforePhotoTaken(newPhoto).catch(() => {}); // schedule job reminder (non-blocking)

      // Update selectedBeforePhoto so thumbnail shows immediately
      setSelectedBeforePhoto(newPhoto);

      // Strip just grew by 1 — the new Before pushed the placeholder
      // one slot to the right. Snap the strip back to the placeholder
      // so the user's next shutter tap stays a fresh capture (instead
      // of accidentally hitting "Retake" on the brand-new Before).
      // The 120 ms delay lets React commit the photo-store update so
      // the new count is reflected before we read it.
      if (!options?.replaceId) {
        setTimeout(() => {
          const newBeforeCount = (getBeforePhotos(room) || []).length;
          const placeholderIdx = newBeforeCount; // placeholder sits at the end
          const SNAP = 100 + 12; // ITEM_WIDTH + ITEM_GAP
          if (galleryScrollRef.current?.scrollTo) {
            galleryScrollRef.current.scrollTo({ x: placeholderIdx * SNAP, animated: false });
          }
          setGalleryIndex(placeholderIdx);
        }, 120);
      }

      // Prepare labeled photo in background immediately after before photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels && newPhoto && newPhoto.id && newPhoto.uri) {
        // Queue immediately - no cache check (photo was just taken, can't be cached)
        try {
          const settingsHash = calculateSettingsHash({
            showLabels,
            beforeLabelPosition,
            afterLabelPosition,
            beforeLabelPositionLandscape,
            afterLabelPositionLandscape,
            labelBackgroundColor: labelBackgroundColor || null,
            labelTextColor: labelTextColor || null,
            labelSize: labelSize || null,
            labelFontFamily: labelFontFamily || null,
            labelMarginVertical,
            labelMarginHorizontal,
          });
          prepareLabeledPhotoInBackground(newPhoto, settingsHash, 'before');
        } catch (error) {
          console.warn('[CameraScreen] Failed to queue before label preparation:', error);
        }
      }

      // Stay in before mode to allow taking more photos
      // User can close camera to see photos in home grid
    } catch (error) {
      const msg = error?.message || String(error) || 'unknown error';
      console.error('[CameraScreen] handleBeforePhoto failed:', msg, error?.stack || error);
      Alert.alert('Error', `Failed to save photo: ${msg}`);
    }
  };

  // Progress capture: single-shot, never paired, never combined. The user
  // stays in camera after capture so they can take several in a row; a Done
  // button (rendered when mode === 'progress') returns them to the section
  // detail screen. No background label preparation is queued — progress
  // photos are kept clean/raw per spec.
  const handleProgressPhoto = async (uri) => {
    try {
      const currentOrientation = deviceOrientation;
      // Same deterministic derivation as handleBeforePhoto — no
      // Image.getSize probe, no branchy ratio guessing. The stored
      // aspectRatio reflects exactly the user's chosen mode + device
      // orientation at capture time.
      const aspectRatio = cameraViewMode === 'landscape'
        ? (currentOrientation === 'landscape' ? '4:3' : '3:4')
        : (currentOrientation === 'landscape' ? '16:9' : '9:16');

      // Link the progress photo to the active SET (the currently-
      // selected Before in this room). Without a beforePhotoId the
      // photo floats around unattached and never appears under any
      // set, defeating the set-based flow.
      const activeBefore = getActiveBeforePhoto();
      const beforePhotoId = activeBefore?.id || null;

      const photoName = `progress_${Date.now()}`;
      const savedUri = await savePhotoToDevice(
        uri,
        `${room}_${photoName}_PROGRESS_${Date.now()}.jpg`,
        activeProjectId || null
      );

      const newPhoto = {
        id: Date.now(),
        uri: savedUri,
        room,
        mode: PHOTO_MODES.PROGRESS,
        name: photoName,
        timestamp: Date.now(),
        aspectRatio,
        orientation: currentOrientation,
        cameraViewMode,
        zoom,
        beforePhotoId,
        // Progress photos belong to the same physical session as the
        // Before — inherit its GPS so map markers stay clustered.
        ...(typeof activeBefore?.lat === 'number' && typeof activeBefore?.lng === 'number'
          ? { lat: activeBefore.lat, lng: activeBefore.lng }
          : null),
      };

      await addPhoto(newPhoto);
      logPhotoCapture('progress', 'camera', activeProjectId);

      // Progress flow: one photo per set, auto-advance through EVERY
      // set in the project (every room, every Before within it), exit
      // only when the user has visited each set once. To shoot a
      // second round, the user re-enters Progress mode (which resets
      // the tracker via the useEffect above).
      if (beforePhotoId) {
        progressedBeforeIdsRef.current.add(beforePhotoId);
      }
      // Flatten every Before across every room in the order the rooms
      // appear in the user's room list, then by capture order within
      // each room. This is the same order the rest of the UI presents.
      const allBefores = [];
      for (const r of rooms || []) {
        const list = getBeforePhotos(r.id) || [];
        for (const b of list) allBefores.push(b);
      }
      const remaining = allBefores.filter(
        (b) => !progressedBeforeIdsRef.current.has(b.id),
      );
      if (remaining.length === 0) {
        Alert.alert(
          'All Sets Progressed',
          'A progress photo has been added to every set in this project.',
          [
            {
              text: 'OK',
              onPress: () => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }
              },
            },
          ],
        );
      }
      // Auto-advance to the next un-progressed set was REMOVED per
      // the user's UX rule: stay on the current set after capture so
      // the user can take multiple progresses in a row if they want.
      // They can navigate to other sets manually via the set-switching
      // horizontal swipe on the camera area.
    } catch (error) {
      const msg = error?.message || String(error) || 'unknown error';
      console.error('[CameraScreen] handleProgressPhoto failed:', msg, error?.stack || error);
      Alert.alert('Error', `Failed to save progress photo: ${msg}`);
    }
  };

  const handleAfterPhoto = async (uri) => {
    const startTime = Date.now();
    console.log('[DEBUG] [start] handleAfterPhoto started');
    try {
      // Get the active before photo
      const activeBeforePhoto = getActiveBeforePhoto();

      if (!activeBeforePhoto) {
        Alert.alert('Error', 'Please select a before photo first');
        return;
      }

      const beforePhotoId = activeBeforePhoto.id;
      // Sequential progression: a previous after becomes a progress photo in
      // the same set (retains beforePhotoId so the gallery still groups it).
      // The combined image is rebuilt from the new after, so the old one goes.
      //
      // Derive the current set's existing After / Combined from the live
      // photo list rather than the route params: with cross-room session
      // cycling, the route's `existingAfterPhoto` / `existingCombinedPhoto`
      // are the FIRST set's references and become stale after the first
      // auto-advance. Using them to demote/delete on a later set would
      // either no-op (already demoted) or — worse — touch the wrong set,
      // which is exactly why the user wasn't seeing a progress counter on
      // subsequent sets.
      const currentSetAfter = (getAfterPhotos?.(activeBeforePhoto.room) || [])
        .find((p) => p.beforePhotoId === beforePhotoId);
      const currentSetCombined = (getCombinedPhotos?.(activeBeforePhoto.room) || [])
        .find((p) => p.name === activeBeforePhoto.name);
      if (currentSetAfter) {
        const deleteStart = Date.now();
        await updatePhoto(currentSetAfter.id, { mode: PHOTO_MODES.PROGRESS });
        console.log(`[DEBUG] â±ï¸Demote previous after to progress: ${Date.now() - deleteStart}ms`);
      }
      if (currentSetCombined) {
        const deleteStart = Date.now();
        // deleteFromStorage: false → only drop the app's metadata reference.
        // Skipping the iOS Photos library delete call avoids the system
        // "Allow ProofPix to delete this photo?" dialog that was interrupting
        // the retake flow. Stale combined remains on disk; user can delete
        // manually if they want.
        await deletePhoto(currentSetCombined.id, { deleteFromStorage: false });
        console.log(`[DEBUG] â±ï¸ Delete existing combined photo: ${Date.now() - deleteStart}ms`);
      }

      // Crop after photo to match before photo's camera view mode
      let processedUri = uri;
      const beforeCameraViewMode = activeBeforePhoto.cameraViewMode || 'portrait';

      if (beforeCameraViewMode === 'landscape') {
        // Letterbox mode: Camera captures at native 4:3, no cropping needed
        processedUri = uri;
      } else {
        // Full screen mode: Save full sensor output to match before photo (no cropping)
        processedUri = uri;
      }

      // Save processed photo to device
      const savedUri = await savePhotoToDevice(
        processedUri,
        `${activeBeforePhoto.room}_${activeBeforePhoto.name}_AFTER_${Date.now()}.jpg`,
        activeProjectId || null
      );

      // Add after photo. Aspect / orientation / cameraViewMode are
      // derived from the LIVE camera state, not blindly inherited
      // from the Before — so if the user overrides the aspect chip
      // (or rotates the phone) before capturing, the After reflects
      // that choice. The default-from-previous useEffect seeds these
      // values from the Before on entry, so the common case still
      // produces a matched pair.
      const currentOrientation = deviceOrientation;
      const aspectRatio = cameraViewMode === 'landscape'
        ? (currentOrientation === 'landscape' ? '4:3' : '3:4')
        : (currentOrientation === 'landscape' ? '16:9' : '9:16');
      const newAfterPhoto = {
        id: Date.now(),
        uri: savedUri,
        room: activeBeforePhoto.room,
        mode: PHOTO_MODES.AFTER,
        name: activeBeforePhoto.name,
        timestamp: Date.now(),
        beforePhotoId: beforePhotoId,
        aspectRatio,
        orientation: currentOrientation,
        cameraViewMode,
        zoom,
        // Inherit Before's GPS so map markers cluster correctly
        // even when the After was taken minutes / hours later
        // without re-locking GPS.
        ...(typeof activeBeforePhoto.lat === 'number' && typeof activeBeforePhoto.lng === 'number'
          ? { lat: activeBeforePhoto.lat, lng: activeBeforePhoto.lng }
          : null),
      };
      await addPhoto(newAfterPhoto);
      logPhotoCapture('after', 'camera', activeProjectId);
      const timeSinceBefore = activeBeforePhoto?.timestamp ? Math.round((Date.now() - activeBeforePhoto.timestamp) / 1000) : null;
      logAfterPhotoCompleted(activeProjectId, timeSinceBefore);
      onAfterPhotoCompleted(beforePhotoId).catch(() => {}); // cancel job reminder (non-blocking)

      // Sequential auto-advance: next Before in the CURRENT ROOM's
      // capture order, regardless of pair state. "Unpaired-first" used
      // to skip Set 4 → Set 6 if Set 4 already had an After from a
      // previous session — surprising when the user just expects
      // Set N → Set N+1. The modal fires only when the just-captured
      // set is the last one in the row (no nextSequential).
      const roomBefores = getBeforePhotos(activeBeforePhoto.room) || [];
      const currentRoomIdx = roomBefores.findIndex((b) => b.id === beforePhotoId);
      const nextSequential = currentRoomIdx >= 0 && currentRoomIdx < roomBefores.length - 1
        ? roomBefores[currentRoomIdx + 1]
        : null;
      const allPhotosPaired = !nextSequential;

      // Mark that we're processing after photo (for visual feedback)
      // Button is now active, but we show different visual state to indicate background processing
      setIsProcessingAfter(true);

      // Clear processing state after combined photo creation starts (it's non-blocking)
      // This gives visual feedback that background processing is happening
      setTimeout(() => {
        setIsProcessingAfter(false);
      }, 300); // Short delay just for visual feedback

      // Prepare labeled photo in background IMMEDIATELY after after photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels && newAfterPhoto && newAfterPhoto.id && newAfterPhoto.uri) {
        // Queue immediately - no setTimeout, no cache check (photo was just taken, can't be cached)
        try {
          const settingsHash = calculateSettingsHash({
            showLabels,
            beforeLabelPosition,
            afterLabelPosition,
            beforeLabelPositionLandscape,
            afterLabelPositionLandscape,
            labelBackgroundColor: labelBackgroundColor || null,
            labelTextColor: labelTextColor || null,
            labelSize: labelSize || null,
            labelFontFamily: labelFontFamily || null,
            labelMarginVertical,
            labelMarginHorizontal,
          });
          // Don't await - just queue it for background processing
          prepareLabeledPhotoInBackground(newAfterPhoto, settingsHash, 'after');
        } catch (error) {
          console.warn('[CameraScreen] Failed to queue label preparation:', error);
        }
      }

      // Create combined photo in background (non-blocking)
      // Use setTimeout with 100ms delay to give UI time to become responsive
      setTimeout(() => {
        (async () => {
          try {
            // Measure original sizes
            // On Android, Image.getSize returns dp (density-independent pixels), not actual file pixels.
            // We must multiply by PixelRatio to get actual pixel dimensions for creating full-resolution combined photos.
            // The native compositor will then create a combined photo at these full dimensions.
            const pixelRatio = Platform.OS === 'android' ? PixelRatio.get() : 1;
            const getSize = (u) => new Promise((resolve) => {
              Image.getSize(u, (w, h) => resolve({
                w: Math.round(w * pixelRatio),
                h: Math.round(h * pixelRatio)
              }), () => resolve({ w: 1080, h: 1920 }));
            });
            const aSize = await getSize(activeBeforePhoto.uri);
            const bSize = await getSize(savedUri);
            console.log(`[CameraScreen] Combined photo source sizes: before=${aSize.w}x${aSize.h}, after=${bSize.w}x${bSize.h}`);
          const beforeOrientation = activeBeforePhoto.orientation || 'portrait';
          const cameraVM = activeBeforePhoto.cameraViewMode || 'portrait';
          const isLandscapePair = beforeOrientation === 'landscape' || cameraVM === 'landscape';

          // Letterbox mode: cameraViewMode === 'landscape' (4:3 camera view with bars)
          const isLetterboxMode = cameraVM === 'landscape';
          const isLetterboxPortrait = beforeOrientation === 'portrait' && cameraVM === 'landscape';
          const isLetterboxLandscape = beforeOrientation === 'landscape' && cameraVM === 'landscape';

          // Determine layout FIRST before calculating dimensions
          // Letterbox portrait (portrait phone + landscape camera): SIDE layout
          // Letterbox landscape (landscape phone + landscape camera): STACK layout
          // Landscape full (landscape phone + portrait/full camera): STACK layout
          const layout = isLetterboxPortrait ? 'SIDE' : (isLandscapePair ? 'STACK' : 'SIDE');
          const isStackLayout = layout === 'STACK';

          // Force 1:1 square output for Instagram/social media compatibility
          const sourceMaxWidth = Math.max(aSize.w, bSize.w);
          const totalW = Math.min(Math.max(sourceMaxWidth, 2048), 4096);
          const totalH = totalW; // 1:1 square

          let dimsLocal;
          if (isStackLayout) {
            // STACK: split height equally between top and bottom
            const topH = Math.round(totalH / 2);
            const bottomH = totalH - topH;
            dimsLocal = { width: totalW, height: totalH, topH, bottomH };
          } else {
            // SIDE-BY-SIDE: split width equally between left and right
            const leftW = Math.round(totalW / 2);
            const rightW = totalW - leftW;
            dimsLocal = { width: totalW, height: totalH, leftW, rightW };
          }

          const safeName = (activeBeforePhoto.name || 'Photo').replace(/\s+/g, '_');
          const baseType = layout;
          const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

          // Create both STACK and SIDE layouts only for letterbox mode (portrait/landscape phone + landscape camera view)
          // For landscape full (landscape phone + portrait/full camera view), only create STACK
          const shouldCreateBothLayouts = isLetterboxMode;

          if (Platform.OS === 'ios') {
            // iOS: use native image compositor
            try {
              console.log('[CameraScreen] [layout] compositeImages start', Platform.OS, {
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                dims: dimsLocal,
                beforeSize: aSize,
                afterSize: bSize,
                beforeOrientation,
                cameraVM,
                isLandscapePair,
                shouldCreateBothLayouts,
              });
              const capUri = await compositeImages(
                activeBeforePhoto.uri,
                savedUri,
                layout,
                dimsLocal
              );
              console.log('[CameraScreen] [OK] compositeImages success', Platform.OS, layout, capUri);

              const combinedPhotoSavedUri = await savePhotoToDevice(
                capUri,
                `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${baseType}_${Date.now()}${projectIdSuffix}.jpg`,
                activeProjectId || null
              );
              console.log('[CameraScreen] Primary combined base saved', Platform.OS, layout, combinedPhotoSavedUri);

              // Store combined photo in context so upload can use it directly (no filesystem scanning needed)
              if (combinedPhotoSavedUri) {
                const combinedPhotoId = `combined_${activeBeforePhoto.id}`;
                const combinedPhoto = {
                  id: combinedPhotoId,
                  mode: PHOTO_MODES.COMBINED,
                  uri: combinedPhotoSavedUri,
                  name: activeBeforePhoto.name,
                  room: activeBeforePhoto.room,
                  projectId: activeProjectId,
                  beforePhotoId: activeBeforePhoto.id,
                  combinedLayout: layout,
                  timestamp: Date.now(),
                };
                await addPhoto(combinedPhoto);

                // Prepare labeled combined photo in background (non-blocking)
                if (showLabels) {
                  try {
                    const settingsHash = calculateSettingsHash({
                      showLabels,
                      beforeLabelPosition,
                      afterLabelPosition,
                      beforeLabelPositionLandscape,
                      afterLabelPositionLandscape,
                      labelBackgroundColor: labelBackgroundColor || null,
                      labelTextColor: labelTextColor || null,
                      labelSize: labelSize || null,
                      labelFontFamily: labelFontFamily || null,
                      labelMarginVertical,
                      labelMarginHorizontal,
                    });
                    // Queue immediately - no cache check (combined was just created)
                    prepareCombinedPhotoInBackground(
                      combinedPhoto,
                      activeBeforePhoto,
                      newAfterPhoto,
                      settingsHash,
                      isLetterboxMode
                    );
                  } catch (error) {
                    console.warn('[CameraScreen] Failed to queue combined label preparation:', error);
                  }
                }
              }

              // For landscape pairs, also create the alternate layout (STACK <-> SIDE)
              if (shouldCreateBothLayouts) {
                try {
                  const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                  console.log(`[CameraScreen] [layout] Creating ${alternateLayout} layout (alternate to ${layout})`);

                  let alternateDims;
                  if (alternateLayout === 'SIDE') {
                    // Prepare side-by-side dims
                    const r1wLB = aSize.w / aSize.h;
                    const r2wLB = bSize.w / bSize.h;
                    const denomLB = (r1wLB + r2wLB) || 1;
                    const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                    const leftWLB = Math.round(totalW * (r1wLB / denomLB));
                    const rightWLB = totalW - leftWLB;
                    alternateDims = { width: totalW, height: totalHLB, leftW: leftWLB, rightW: rightWLB };
                  } else {
                    // Prepare stack dims
                    const r1h = aSize.h / aSize.w;
                    const r2h = bSize.h / bSize.w;
                    const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                    const topH = Math.round(totalW * r1h);
                    const bottomH = totalH - topH;
                    alternateDims = { width: totalW, height: totalH, topH, bottomH };
                  }

                  console.log(`[CameraScreen] [layout] ${alternateLayout} layout dims:`, alternateDims);
                  const capUriLB = await compositeImages(
                    activeBeforePhoto.uri,
                    savedUri,
                    alternateLayout,
                    alternateDims
                  );
                  console.log(`[CameraScreen] [OK] ${alternateLayout} layout composite success:`, capUriLB);

                  const altSavedUri = await savePhotoToDevice(
                    capUriLB,
                    `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${alternateLayout}_${Date.now()}${projectIdSuffix}.jpg`,
                    activeProjectId || null
                  );
                  console.log(`[CameraScreen] [saved] ${alternateLayout} layout saved:`, altSavedUri);
                } catch (eLB) {
                  console.error(`[CameraScreen] âŒ Failed to create ${alternateLayout || 'alternate'} layout:`, eLB);
                  console.error(`[CameraScreen] ${alternateLayout || 'alternate'} layout error details:`, {
                    message: eLB.message,
                    stack: eLB.stack,
                    beforeUri: activeBeforePhoto.uri,
                    afterUri: savedUri,
                  });
                }
              }
            } catch (captureError) {
              console.error('[CameraScreen] âŒ Combined photo creation failed:', captureError);
              console.error('[CameraScreen] Error details:', {
                message: captureError.message,
                stack: captureError.stack,
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                dims: dimsLocal,
              });
              Alert.alert('Error', `Failed to create combined photo: ${captureError.message || 'Unknown error'}`);
            }
          } else if (Platform.OS === 'android') {
            // Android: Try to use native compositor, fallback to background service if not available
            const hasNativeCompositor = isNativeCompositorAvailable();
            console.log(`[CameraScreen][Android] Native compositor available: ${hasNativeCompositor}`);

            if (!hasNativeCompositor) {
              // Fallback to background service
              console.log('[CameraScreen][Android] Using background service fallback');
              const MAX_DIMENSION = 2048;
              let limitedWidth = dimsLocal.width;
              let limitedHeight = dimsLocal.height;

              if (limitedWidth > MAX_DIMENSION || limitedHeight > MAX_DIMENSION) {
                const scale = Math.min(MAX_DIMENSION / limitedWidth, MAX_DIMENSION / limitedHeight);
                limitedWidth = Math.round(limitedWidth * scale);
                limitedHeight = Math.round(limitedHeight * scale);
              }

              const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

              backgroundCombinedPhotoService.addJob({
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                width: limitedWidth,
                height: limitedHeight,
                room: activeBeforePhoto.room,
                safeName,
                projectId: activeProjectId || null,
                projectIdSuffix,
                jobId: `${Date.now()}_${layout}`,
              });

              if (shouldCreateBothLayouts) {
                const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                let altWidth, altHeight;

                if (alternateLayout === 'SIDE') {
                  const r1wLB = aSize.w / aSize.h;
                  const r2wLB = bSize.w / bSize.h;
                  const denomLB = (r1wLB + r2wLB) || 1;
                  const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                  altWidth = totalW;
                  altHeight = totalHLB;
                } else {
                  const r1h = aSize.h / aSize.w;
                  const r2h = bSize.h / bSize.w;
                  const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                  altWidth = totalW;
                  altHeight = totalH;
                }

                let limitedAltWidth = altWidth;
                let limitedAltHeight = altHeight;

                if (limitedAltWidth > MAX_DIMENSION || limitedAltHeight > MAX_DIMENSION) {
                  const scaleAlt = Math.min(MAX_DIMENSION / limitedAltWidth, MAX_DIMENSION / limitedAltHeight);
                  limitedAltWidth = Math.round(limitedAltWidth * scaleAlt);
                  limitedAltHeight = Math.round(limitedAltHeight * scaleAlt);
                }

                backgroundCombinedPhotoService.addJob({
                  beforeUri: activeBeforePhoto.uri,
                  afterUri: savedUri,
                  layout: alternateLayout,
                  width: limitedAltWidth,
                  height: limitedAltHeight,
                  room: activeBeforePhoto.room,
                  safeName,
                  projectId: activeProjectId || null,
                  projectIdSuffix,
                  jobId: `${Date.now() + 1}_${alternateLayout}`,
                });
              }
            } else {
              // Use native compositor
              try {
                const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

                // Create primary layout (STACK for landscape, SIDE for portrait)
                console.log(`[CameraScreen][Android] Creating ${layout} layout with native compositor`);

                const capUri = await compositeImages(
                  activeBeforePhoto.uri,
                  savedUri,
                  layout,
                  dimsLocal
                );

              const combinedPhotoSavedUri = await savePhotoToDevice(
                capUri,
                `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${layout}_${Date.now()}${projectIdSuffix}.jpg`,
                activeProjectId || null
              );

              console.log(`[CameraScreen][Android] ${layout} combined photo saved:`, combinedPhotoSavedUri);

              // Store combined photo in context so upload can use it directly (no filesystem scanning needed)
              if (combinedPhotoSavedUri) {
                const combinedPhotoId = `combined_${activeBeforePhoto.id}`;
                const combinedPhoto = {
                  id: combinedPhotoId,
                  mode: PHOTO_MODES.COMBINED,
                  uri: combinedPhotoSavedUri,
                  name: activeBeforePhoto.name,
                  room: activeBeforePhoto.room,
                  projectId: activeProjectId,
                  beforePhotoId: activeBeforePhoto.id,
                  combinedLayout: layout,
                  timestamp: Date.now(),
                };
                await addPhoto(combinedPhoto);

                // Prepare labeled combined photo in background (non-blocking)
                if (showLabels) {
                  try {
                    const settingsHash = calculateSettingsHash({
                      showLabels,
                      beforeLabelPosition,
                      afterLabelPosition,
                      beforeLabelPositionLandscape,
                      afterLabelPositionLandscape,
                      labelBackgroundColor: labelBackgroundColor || null,
                      labelTextColor: labelTextColor || null,
                      labelSize: labelSize || null,
                      labelFontFamily: labelFontFamily || null,
                      labelMarginVertical,
                      labelMarginHorizontal,
                    });
                    // Queue immediately - no cache check (combined was just created)
                    prepareCombinedPhotoInBackground(
                      combinedPhoto,
                      activeBeforePhoto,
                      newAfterPhoto,
                      settingsHash,
                      isLetterboxMode
                    );
                  } catch (error) {
                    console.warn('[CameraScreen][Android] Failed to queue combined label preparation:', error);
                  }
                }
              }

              // For letterbox modes, also create the alternate layout (STACK <-> SIDE)
              if (shouldCreateBothLayouts) {
                const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                console.log(`[CameraScreen][Android] Creating ${alternateLayout} layout (alternate to ${layout})`);

                let altWidth, altHeight, altDims;
                if (alternateLayout === 'SIDE') {
                  // Prepare side-by-side dims
                  const r1wLB = aSize.w / aSize.h;
                  const r2wLB = bSize.w / bSize.h;
                  const denomLB = (r1wLB + r2wLB) || 1;
                  const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                  altWidth = totalW;
                  altHeight = totalHLB;

                  const lw = Math.round(altWidth * (r1wLB / denomLB));
                  const rw = altWidth - lw;
                  altDims = {
                    width: altWidth,
                    height: altHeight,
                    leftW: lw,
                    rightW: rw,
                  };
                } else {
                  // Prepare stack dims
                  const r1h = aSize.h / aSize.w;
                  const r2h = bSize.h / bSize.w;
                  const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                  altWidth = totalW;
                  altHeight = totalH;

                  const th = Math.round(altHeight * (r1h / (r1h + r2h)));
                  const bh = altHeight - th;
                  altDims = {
                    width: altWidth,
                    height: altHeight,
                    topH: th,
                    bottomH: bh,
                  };
                }

                const altCapUri = await compositeImages(
                  activeBeforePhoto.uri,
                  savedUri,
                  alternateLayout,
                  altDims
                );

                const altCombinedPhotoSavedUri = await savePhotoToDevice(
                  altCapUri,
                  `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${alternateLayout}_${Date.now()}${projectIdSuffix}.jpg`,
                  activeProjectId || null
                );

                console.log(`[CameraScreen][Android] [OK] ${alternateLayout} combined photo saved:`, altCombinedPhotoSavedUri);
              }
              } catch (compositeError) {
                console.error('[CameraScreen][Android] âŒ Combined photo creation failed:', compositeError);
                console.error('[CameraScreen][Android] Error details:', {
                  message: compositeError.message,
                  stack: compositeError.stack,
                  beforeUri: activeBeforePhoto.uri,
                  afterUri: savedUri,
                  layout,
                  dims: dimsLocal,
                });
                Alert.alert('Error', `Failed to create combined photo: ${compositeError.message || 'Unknown error'}`);
              }
            }
          }
        } catch (error) {
        }
        })();
      }, 100); // 100ms delay to give UI time to become responsive

      // NOTE: Pre-v1.7 retake used to navigate to PhotoEditor here to let
      // the user pick a new combined-image template. That flow contradicts
      // the sequential-progression model — a retake demotes the prior
      // after to progress and the background composite job regenerates the
      // combined automatically. Keep the user in the capture flow instead
      // of dumping them into the legacy editor.
      if (existingCombinedPhoto) {
        // Fall through to the normal post-capture handling below.
      }

      // Show "All Photos Taken" alert when every set in the project
      // has been visited this session. Otherwise auto-advance to the
      // next un-visited Before so the user keeps shooting Afters back-
      // to-back without manually switching sets.
      if (allPhotosPaired) {
        // No more sets to advance to — stay on the just-captured set
        // so the user can see their After in the strip with the Match
        // badge. Snap the strip there directly (onMomentumScrollEnd
        // doesn't fire reliably for programmatic scrolls). The 120 ms
        // delay lets React commit the photo-store updates first.
        setTimeout(() => {
          const newProgressesCount = (getProgressPhotos?.(activeBeforePhoto.room) || [])
            .filter((p) => p.beforePhotoId === beforePhotoId).length;
          const newAfterIdx = 1 + newProgressesCount;
          const SNAP = 100 + 12; // ITEM_WIDTH + ITEM_GAP
          if (galleryScrollRef.current?.scrollTo) {
            galleryScrollRef.current.scrollTo({ x: newAfterIdx * SNAP, animated: false });
          }
          setGalleryIndex(newAfterIdx);
          setMatchedItemIdx(newAfterIdx);
        }, 120);
        Alert.alert(
          'All Photos Taken',
          'All after photos have been captured!',
          [
            {
              text: 'OK',
              onPress: () => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }
              }
            }
          ]
        );
      } else {
        // Auto-advance to the next sequential Before in this room.
        // The strip-init useEffect re-fires on selectedBeforePhoto?.id
        // change and lands the strip on the new set's last item.
        setSelectedBeforePhoto(nextSequential);
      }
      console.log('[DEBUG] [OK] handleAfterPhoto completed');
    } catch (error) {
      const msg = error?.message || String(error) || 'unknown error';
      console.error('[CameraScreen] handleAfterPhoto failed:', msg, error?.stack || error);
      Alert.alert('Error', `Failed to save photo: ${msg}`);
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => {
      const newFacing = current === 'back' ? 'front' : 'back';
      // Turn off flashlight when switching to front camera
      if (newFacing === 'front' && enableTorch) {
        setEnableTorch(false);
      }
      return newFacing;
    });
  };

  // Android combined photos are now handled by GlobalBackgroundCombinedPhotoCreator
  // No local processor needed - jobs are queued to the background service

  // Get current room info
  const getCurrentRoomInfo = () => {
    return rooms.find(r => r.id === room) || rooms[0];
  };

  // Check if orientation matches for after mode
  const isOrientationMismatch = () => {
    if (mode !== 'after') return false;
    
    const activeBeforePhoto = getActiveBeforePhoto();
    if (!activeBeforePhoto) {
      return false;
    }
    
    const beforeOrientation = activeBeforePhoto.orientation || 'portrait';
    // In after mode, device orientation must match before photo orientation
    const mismatch = beforeOrientation !== deviceOrientation;
    return mismatch;
  };

  // Render overlay mode (current implementation)
  const renderOverlayMode = () => (
              <View
      style={styles.container}
      {...cameraViewPanResponder.panHandlers}
    >
      {/* Camera view content - scale transform is applied by parent Animated.View.
          onTouchStart lives HERE (not on the outer container) so the
          ghost-opacity slider only re-surfaces on taps inside the
          camera preview itself — pressing the shutter, the thumbnail
          circle, or the Done button at the bottom no longer pings it. */}
      <View style={styles.cameraWrapper} onTouchStart={pingGhostSlider}>
        {/* Orientation mismatch warning */}
        {(() => {
          const mismatch = isOrientationMismatch();
          return mismatch;
        })() && (
          <View style={styles.orientationWarning}>
            <Text style={styles.rotatePhoneIcon}>🔄</Text>
            <Text style={styles.orientationWarningText}>Rotate Phone!</Text>
            <Text style={styles.orientationWarningHint}>
              Before photo was taken in {getActiveBeforePhoto()?.orientation || 'portrait'} mode. 
              Please rotate your device.
            </Text>
        </View>
        )}

      {/* Camera preview with before photo overlay (for after mode).
          ONE Camera component is rendered regardless of aspect mode —
          only its container reshapes. This is what makes the 9:16 ⇄ 3:4
          toggle feel instant: the native capture session stays alive
          (no mount/unmount), only JS layout changes. */}
      <View style={styles.cameraContainer}>
        {(() => {
          const showLetterbox = cameraViewMode === 'landscape';
          const innerCameraStyle = showLetterbox
            ? [
                styles.letterboxCamera,
                deviceOrientation === 'landscape' ? styles.letterboxCameraLandscape : null,
              ]
            : { flex: 1 };
          const outerStyle = showLetterbox
            ? [
                styles.letterboxContainer,
                deviceOrientation === 'landscape' ? styles.letterboxContainerLandscape : null,
              ]
            : { flex: 1 };
          return (
            <View style={outerStyle}>
              {showLetterbox && (
                <View style={deviceOrientation === 'landscape' ? styles.letterboxBarHorizontal : styles.letterboxBar} />
              )}
              <View
                // Key on orientation ONLY — not on cameraViewMode.
                // Previously this also flipped on 9:16⇄3:4 toggle
                // (`cam-fill` ⇄ `cam-letterbox-*`), which remounted
                // the Camera and tore down the native capture session
                // on every toggle. That was the ~1s perceived delay.
                // Keeping the key stable across cameraViewMode lets
                // the Camera component reshape via style change only
                // (no native re-init). Rotation still remounts so the
                // letterbox box rebuilds with the correct aspect.
                key={`cam-${deviceOrientation}`}
                style={innerCameraStyle}
              >
                {layout && device && (
                  <Camera
                    ref={cameraRef}
                    style={styles.camera}
                    device={device}
                    format={format}
                    isActive={isFocused}
                    photo={true}
                    zoom={zoom}
                    // Pinch-to-zoom disabled — vision-camera doesn't
                    // notify React when the pinch changes zoom, so the
                    // chip row would silently desync (chip says ".5",
                    // actual zoom is at 1×, etc.). Chip-only zoom keeps
                    // state and UI in lockstep.
                    enableZoomGesture={false}
                    torch={enableTorch && supportsTorch ? 'on' : 'off'}
                    resizeMode="cover"
                    onStarted={handleCameraStarted}
                    onStopped={handleCameraStopped}
                  />
                )}
                {mode === 'after' && getActiveBeforePhoto() && (() => {
                  // Ghost source = whichever thumbnail the user has
                  // currently centered in the half-screen strip
                  // (galleryIndex). When the strip isn't open or the
                  // centered slot is the trailing placeholder, fall
                  // back to the LATEST real photo in the set (After if
                  // present, else last Progress, else the Before). The
                  // corner-circle thumbnail mirrors this same value so
                  // ghost + circle + highlighted strip thumb agree.
                  const activeBefore = getActiveBeforePhoto();
                  const progresses = (getProgressPhotos?.(room) || [])
                    .filter((p) => p.beforePhotoId === activeBefore.id)
                    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                  const after = (getAfterPhotos?.(room) || [])
                    .find((p) => p.beforePhotoId === activeBefore.id);
                  const realPhotos = [activeBefore, ...progresses, ...(after ? [after] : [])];
                  const latest = realPhotos[realPhotos.length - 1] || activeBefore;
                  const ghost = (() => {
                    if (showEnlargedGallery) {
                      if (
                        enlargedGalleryIndex >= 0 &&
                        enlargedGalleryIndex < realPhotos.length
                      ) {
                        return realPhotos[enlargedGalleryIndex];
                      }
                      return latest;
                    }
                    if (
                      showGallery &&
                      galleryIndex >= 0 &&
                      galleryIndex < realPhotos.length
                    ) {
                      return realPhotos[galleryIndex];
                    }
                    return latest;
                  })();
                  return (
                    <View style={[styles.beforePhotoOverlay, { opacity: ghostOpacity }]}>
                      <Image
                        source={{ uri: ghost.uri }}
                        style={styles.beforePhotoImage}
                        resizeMode="cover"
                      />
                    </View>
                  );
                })()}
              </View>
              {showLetterbox && (
                <View style={deviceOrientation === 'landscape' ? styles.letterboxBarHorizontal : styles.letterboxBar} />
              )}
            </View>
          );
        })()}
        {aspectTransitioning && (
          <View style={styles.aspectTransitionMask} pointerEvents="none" />
        )}
      </View>
      </View>

      {/* Ghost-opacity slider — vertical pill on the right edge of the
          camera preview. Top = camera-only (no ghost); bottom = the
          BEFORE photo fully overlaid. The camera icon caps the top of
          the pill, the picture icon caps the bottom, so the mapping is
          obvious. Hidden while the enlarged carousel is open. */}
      {/* Floating control row — rendered while EITHER gallery panel is
          open (small thumbnail row OR enlarged carousel). Matches the
          full-camera bottom row layout: 9:16 / 3:4 on the LEFT, zoom on
          the RIGHT. Positioned at the lower edge of the shrunk camera
          area — just above whichever gallery panel is open. */}
      {(showEnlargedGallery || showGallery) && (
        <View
          style={[
            styles.floatingZoomRow,
            // Anchor target depends on which surface is open below:
            //   - Enlarged carousel: dimensions.height * 0.41 tall,
            //     sits ON TOP of the strip's reserved space and at
            //     a higher zIndex (250), so chips need to clear the
            //     top of the enlarged container — anything lower
            //     gets covered.
            //   - Strip only: chips snap to the gallery panel's top
            //     edge (the yellow split line) with a 4 px gap.
            {
              bottom: showEnlargedGallery
                ? dimensions.height * 0.41 + 4
                : Math.max(20, insets.bottom + 10) + 75 + 28 + 180 + 4,
            },
          ]}
          pointerEvents="box-none"
        >
          {/* Aspect ratio cluster — left. Same chips as on the full
              camera screen, shown in both Before and After modes here so
              the user has the controls handy while reviewing photos. */}
          <View style={styles.floatingZoomCluster}>
            <TouchableOpacity
              style={[styles.aspectRatioButtonBottom, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomActive]}
              onPress={() => handleViewModeChange('portrait')}
            >
              <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomTextActive]}>9:16</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.aspectRatioButtonBottom, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomActive]}
              onPress={() => handleViewModeChange('landscape')}
            >
              <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomTextActive]}>3:4</Text>
            </TouchableOpacity>
          </View>
          {/* Zoom cluster — right. Dynamic preset list driven by
              actual device lenses (see zoomPresets useMemo). On iPhone
              Pro w/ telephoto this expands to 4 chips; on a basic
              device with no ultra-wide it collapses to fewer. Active
              chip follows pinch as well as taps via activePresetIndex. */}
          <View style={styles.floatingZoomCluster}>
            {zoomPresets.map((preset, i) => {
              const active = i === activePresetIndex;
              return (
                <TouchableOpacity
                  key={`fz-${preset.display}`}
                  style={[styles.zoomButtonBottom, active && styles.zoomButtonBottomActive]}
                  onPress={() => handleZoomPresetPress(preset.logical, preset.display)}
                >
                  <Text style={[styles.zoomButtonBottomText, active && styles.zoomButtonBottomTextActive]}>
                    {formatZoomLabel(preset.display)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {mode === 'after' && getActiveBeforePhoto() && showGhostSlider && (() => {
        // The slider tracks the SAME PHYSICAL EDGE of the phone across
        // rotations — the "long" edge that sits under the user's right
        // hand in portrait. In landscape, that edge maps to either the
        // top of the screen (CCW / LANDSCAPE_LEFT) or the bottom
        // (CW / LANDSCAPE_RIGHT). The slider re-orients to horizontal
        // in landscape so the camera/picture icons read in the user's
        // natural reading direction along that edge.
        const isLandscape = specificOrientation === 3 || specificOrientation === 4;
        // Per user spec: swap the landscape edges so the slider sits
        // on the OPPOSITE long edge from before.
        //   LANDSCAPE_LEFT (3, CCW) → bottom edge.
        //   LANDSCAPE_RIGHT (4, CW) → top edge.
        const landscapeTopEdge = specificOrientation === 4;

        // Camera-area height in portrait: ~45% (full) or ~38% (gallery
        // panel open). In landscape we span most of the long edge.
        const portraitContainerStyle = (showEnlargedGallery || showGallery)
          ? {
              top: Math.max(
                insets.top + 60,
                (dimensions.height * 0.59 - dimensions.height * 0.38) / 2,
              ),
              height: dimensions.height * 0.38,
            }
          : { top: insets.top + 80, height: dimensions.height * 0.45 };

        const landscapeContainerStyle = landscapeTopEdge
          ? {
              top: insets.top + 8,
              left: 0,
              right: 0,
              width: undefined,
              height: 44,
              alignItems: 'stretch',
            }
          : {
              bottom: insets.bottom + 8,
              top: undefined,
              left: 0,
              right: 0,
              width: undefined,
              height: 44,
              alignItems: 'stretch',
            };

        return (
          <View
            style={[
              styles.ghostSliderContainer,
              isLandscape ? landscapeContainerStyle : portraitContainerStyle,
            ]}
            pointerEvents="box-none"
          >
            <View style={[
              styles.ghostSliderPill,
              isLandscape && styles.ghostSliderPillLandscape,
            ]}>
              <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
              {/* In portrait the Slider is rotated 90° (vertical column);
                  in landscape it stays in its natural horizontal axis so
                  drag direction matches the icons' left-to-right reading. */}
              <Slider
                style={isLandscape ? styles.ghostSliderLandscape : styles.ghostSlider}
                minimumValue={0}
                maximumValue={1}
                step={0.01}
                value={ghostOpacity}
                onValueChange={(v) => {
                  setGhostOpacity(v);
                  pingGhostSlider();
                }}
                minimumTrackTintColor="#F2C31B"
                maximumTrackTintColor="rgba(255,255,255,0.45)"
                thumbTintColor="#F2C31B"
              />
              <Ionicons name="image-outline" size={16} color="#FFFFFF" />
            </View>
          </View>
        );
      })()}


      {/* Fixed UI Layer - doesn't rotate with device */}
      <Animated.View style={[
        styles.fixedUILayer,
        // Counter-rotate to keep UI fixed to screen geometry
        // LANDSCAPE_LEFT (3) = buttons should be on RIGHT (counter-rotate -90)
        specificOrientation === 3 && {
          transform: [{ rotate: '90deg' }],
          width: dimensions.height,
          height: dimensions.width,
          left: (dimensions.width - dimensions.height) / 2,
          top: (dimensions.height - dimensions.width) / 2
        },
        // LANDSCAPE_RIGHT (4) = buttons should be on LEFT (counter-rotate +90)
        specificOrientation === 4 && {
          transform: [{ rotate: '-90deg' }],
          width: dimensions.height,
          height: dimensions.width,
          left: (dimensions.width - dimensions.height) / 2,
          top: (dimensions.height - dimensions.width) / 2
        }
      ]} pointerEvents="box-none">
        {/* Room name + set number - single segmented pill (e.g. "Kitchen | Set 2").
            Replaces the legacy "Before / After" mode label: every capture
            session ultimately walks through sets in sequence, and the
            mode is implicit from the set's state, so showing which set
            we're on is more useful than the mode word. */}
        <View style={styles.roomModeContainer}>
          <View style={styles.roomModePillWrapper}>
            <TouchableOpacity style={styles.roomButton} activeOpacity={0.8}>
              <Text style={styles.roomButtonText}>{getCurrentRoomInfo().name}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modeButton} activeOpacity={0.8}>
              <Text style={styles.modeButtonText}>{(() => {
                const roomBefores = getBeforePhotos(room) || [];
                // Role label: "Before" in Before mode, "After" in
                // After/Progress mode. Shown alongside the set number
                // in the same pill ("Before Set 1", "After Set 2") so
                // the user sees what they're capturing AND which set
                // it lands in without leaving the camera view.
                const roleLabel = mode === 'before' ? 'Before' : 'After';
                // When the enlarged carousel is open, the pill should
                // reflect the SET the enlarged is anchored on (the
                // selectedBeforePhoto), not the strip's centered slot
                // — otherwise the pill says "Set 9" (strip on the
                // next-set placeholder) while the enlarged shows a
                // different set's photo (e.g. "Set 7 Before").
                if (mode === 'before' && showEnlargedGalleryRef.current) {
                  const activeBefore = getActiveBeforePhoto();
                  const idx = activeBefore
                    ? roomBefores.findIndex((b) => b.id === activeBefore.id)
                    : -1;
                  const setNumber = idx >= 0 ? idx + 1 : roomBefores.length + 1;
                  return `${roleLabel} Set ${setNumber}`;
                }
                // In Before mode with the strip open, the centered slot
                // determines the set number — including the trailing
                // placeholder, which represents "the next set". Without
                // this branch the pill stayed on the previous Before's
                // number even after scrolling the placeholder under the
                // active-slot frame ("Set 7" while looking at Set 8).
                if (mode === 'before' && showGalleryRef.current) {
                  const centered = Math.max(0, Math.min(galleryIndex, roomBefores.length));
                  return `${roleLabel} Set ${centered + 1}`;
                }
                const activeBefore = getActiveBeforePhoto();
                const idx = activeBefore
                  ? roomBefores.findIndex((b) => b.id === activeBefore.id)
                  : -1;
                // Before mode with no Before yet → we're about to create
                // the next set, so show the next ordinal.
                const setNumber = idx >= 0 ? idx + 1 : roomBefores.length + 1;
                return `${roleLabel} Set ${setNumber}`;
              })()}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sound toggle button - left of flash button */}
        <TouchableOpacity
          style={styles.soundButton}
          onPress={toggleShutterSoundEnabled}
          activeOpacity={0.7}
        >
          <Ionicons
            name={shutterSoundEnabled ? "volume-high-outline" : "volume-mute-outline"}
            size={20}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        {/* Torch toggle button - rightmost */}
        {facing === 'back' && (
          <TouchableOpacity
            style={styles.torchButton}
            onPress={() => {
              if (!supportsTorch) {
                Alert.alert(
                  'Flash Not Available',
                  'The selected camera lens does not support flash on this device. Try switching to the 1x camera.'
                );
                return;
              }
              setEnableTorch(!enableTorch);
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={enableTorch ? "flash" : "flash-outline"}
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        )}


        <View style={[styles.bottomControls, { paddingBottom: Math.max(20, insets.bottom + 10) }]}>
          {/* Controls row above capture - aspect ratio & zoom.
              Hidden while the enlarged gallery is open because the row
              sits visually on top of the enlarged photo; a duplicated
              floating zoom pill is rendered in the camera viewfinder
              area in that case (see below). */}
          {!showEnlargedGallery && !showGallery && (
          <View style={styles.controlsRowAboveCapture}>
            {/* Aspect ratio selector — shown in both Before and After
                modes so the layout (left cluster + right cluster) stays
                identical across every camera state. */}
            <View style={styles.aspectRatioSelector}>
              <TouchableOpacity
                style={[styles.aspectRatioButtonBottom, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomActive]}
                onPress={() => handleViewModeChange('portrait')}
              >
                <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomTextActive]}>9:16</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.aspectRatioButtonBottom, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomActive]}
                onPress={() => handleViewModeChange('landscape')}
              >
                <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomTextActive]}>3:4</Text>
              </TouchableOpacity>
            </View>
            {/* Zoom controls — dynamic preset list driven by actual
                device lenses (zoomPresets). 4 chips on iPhone Pro w/
                telephoto, 3 on most phones with ultra-wide+wide, 2 on
                basic phones. Labels: ".5", "1×", "2×", "3×" matching
                iOS native Camera. */}
            <View style={[styles.zoomControlsBottom, showGallery && styles.zoomControlsBottomWithGallery]}>
              {zoomPresets.map((preset, i) => {
                const active = i === activePresetIndex;
                return (
                  <TouchableOpacity
                    key={`bz-${preset.display}`}
                    style={[styles.zoomButtonBottom, active && styles.zoomButtonBottomActive]}
                    onPress={() => handleZoomPresetPress(preset.logical, preset.display)}
                  >
                    <Text style={[styles.zoomButtonBottomText, active && styles.zoomButtonBottomTextActive]}>
                      {formatZoomLabel(preset.display)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          )}


          {/* Main control row */}
          <View style={styles.mainControlRow}>
            {/* Left container - Thumbnail */}
            <View style={styles.buttonContainer}>
              {(() => {
                const activePhoto = getActiveBeforePhoto();
                // The corner thumbnail mirrors whatever slot is
                // currently highlighted under the active-slot frame
                // in the half-screen strip (driven by galleryIndex).
                // That way the circle and the centered thumbnail
                // always agree — if the user has scrolled the strip
                // onto "Progress 1", the circle shows Progress 1.
                // We rebuild the strip's photos array here (without
                // the trailing placeholder) and index into it.
                const stripPhotos = (() => {
                  if (mode === 'before') {
                    return getBeforePhotos(room) || [];
                  }
                  if (mode === 'after' || mode === 'progress') {
                    if (!activePhoto?.id) return [];
                    const progresses = (getProgressPhotos?.(room) || [])
                      .filter((p) => p.beforePhotoId === activePhoto.id)
                      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    const after = (getAfterPhotos?.(room) || [])
                      .find((p) => p.beforePhotoId === activePhoto.id);
                    return [activePhoto, ...progresses, ...(after ? [after] : [])];
                  }
                  return [];
                })();
                const centeredPhoto = (() => {
                  // When the enlarged carousel is open, the circle
                  // follows the currently visible enlarged slide
                  // (driven by enlargedGalleryIndex). The enlarged
                  // photos array adds a trailing placeholder, so if
                  // the user has swiped to that slot we fall back to
                  // the last real photo in the set — same logic as
                  // the strip-centered fallback below.
                  if (showEnlargedGallery) {
                    if (
                      enlargedGalleryIndex >= 0 &&
                      enlargedGalleryIndex < stripPhotos.length
                    ) {
                      return stripPhotos[enlargedGalleryIndex];
                    }
                    return stripPhotos[stripPhotos.length - 1] || null;
                  }
                  if (galleryIndex >= 0 && galleryIndex < stripPhotos.length) {
                    return stripPhotos[galleryIndex];
                  }
                  // Fallback: the last real photo in the set if the
                  // index points past the strip's last item (e.g. the
                  // placeholder slot in Before/After mode).
                  return stripPhotos[stripPhotos.length - 1] || null;
                })();
                const thumbPhoto = centeredPhoto
                  || activePhoto
                  || ((getBeforePhotos(room) || [])[((getBeforePhotos(room) || []).length - 1)] || null);

                if (thumbPhoto) {
                  return (
                    <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait,
                        // White border reads on dark surfaces; on a
                        // light theme it disappears against the panel,
                        // so switch to brand yellow there.
                        { borderColor: theme.mode === 'light' ? '#F2C31B' : '#FFFFFF' },
                      ]}
                      activeOpacity={1}
                      onPress={handleThumbnailPress}
                      onPressIn={handleThumbnailPressIn}
                      onPressOut={handleThumbnailPressOut}
                    >
                      <View style={styles.thumbnailInnerRing}>
                        <Image
                          source={{ uri: thumbPhoto.uri }}
                          style={styles.thumbnailViewerImage}
                          resizeMode="cover"
                        />
                      </View>
                    </TouchableOpacity>
                  );
                } else {
                  // Show empty placeholder - also opens gallery on press
                  return (
                    <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait,
                        // White border reads on dark surfaces; on a
                        // light theme it disappears against the panel,
                        // so switch to brand yellow there.
                        { borderColor: theme.mode === 'light' ? '#F2C31B' : '#FFFFFF' },
                      ]}
                      activeOpacity={0.7}
                      onPress={handleThumbnailPress}
                    >
                      <View style={styles.thumbnailInnerRing} />
                    </TouchableOpacity>
                  );
                }
              })()}
            </View>

            {/* Mid slot — host for the Record Audio mini icon, sized
                flex:1 so the icon centers in the dead space BETWEEN
                the thumbnail circle (left) and the capture button
                (middle). Rendered unconditionally so the 5-column row
                stays balanced in full-camera mode too; the icon
                itself only appears in half-screen mode. */}
            <View style={styles.midIconSlot}>
              {(showGallery || showEnlargedGallery) && (() => {
                // Light theme: solid-black pill with a white icon so
                // it reads on the white panel surface. Dark theme:
                // translucent dark pill with a yellow icon (existing
                // chrome on the dark background).
                const isLight = theme.mode === 'light';
                return (
                  <TouchableOpacity
                    style={[
                      styles.inlineMidIcon,
                      isLight
                        ? { backgroundColor: '#000', borderColor: '#000' }
                        : null,
                    ]}
                    onPress={() => { /* recording wiring lands later */ }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="mic-outline"
                      size={22}
                      color={isLight ? '#FFFFFF' : '#F2C31B'}
                    />
                  </TouchableOpacity>
                );
              })()}
            </View>

            {/* Center container - Capture button */}
            <View style={styles.buttonContainer}>
              {/* Capture button */}
              <TouchableOpacity
                style={[
                  styles.captureButton,
                  (isOrientationMismatch() || isCapturing) && styles.captureButtonDisabled,
                  isProcessingAfter && styles.captureButtonProcessing
                ]}
                onPress={takePicture}
                disabled={isOrientationMismatch() || isCapturing}
              >
                {isCapturing ? (
                  <ActivityIndicator size="large" color={COLORS.PRIMARY} />
                ) : isProcessingAfter ? (
                  <View style={styles.captureButtonProcessingContent}>
                    <ActivityIndicator size="small" color={COLORS.PRIMARY} />
                    <Text style={styles.captureButtonProcessingText}>Processing...</Text>
                  </View>
                ) : isOrientationMismatch() ? (
                  <Text style={styles.captureButtonWarning}>🔄</Text>
                ) : (
                  <Ionicons name="camera" size={38} color="#000" />
                )}
              </TouchableOpacity>
            </View>

            {/* Mid slot — host for the Add Note mini icon, centered
                in the dead space BETWEEN the capture button and the
                done button. Same flex:1 sizing as the left slot for
                visual balance. */}
            <View style={styles.midIconSlot}>
              {(showGallery || showEnlargedGallery) && (() => {
                const activeBefore = getActiveBeforePhoto();
                const stripPhotos = mode === 'before'
                  ? (getBeforePhotos(room) || [])
                  : (activeBefore
                      ? [
                          activeBefore,
                          ...(getProgressPhotos?.(room) || [])
                            .filter((p) => p.beforePhotoId === activeBefore.id)
                            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
                          ...((getAfterPhotos?.(room) || []).filter((p) => p.beforePhotoId === activeBefore.id)),
                        ]
                      : []);
                const idx = showEnlargedGallery ? enlargedGalleryIndex : galleryIndex;
                const centeredPhoto = (idx >= 0 && idx < stripPhotos.length)
                  ? stripPhotos[idx]
                  : (stripPhotos[stripPhotos.length - 1] || activeBefore || null);
                const hasNote = !!(centeredPhoto && centeredPhoto.note && String(centeredPhoto.note).trim());
                const isLight = theme.mode === 'light';
                return (
                  <TouchableOpacity
                    style={[
                      styles.inlineMidIcon,
                      isLight
                        ? { backgroundColor: '#000', borderColor: '#000' }
                        : null,
                    ]}
                    onPress={() => {
                      if (!centeredPhoto?.id) return;
                      setNoteTargetPhotoId(centeredPhoto.id);
                      setNoteDraft(centeredPhoto.note || '');
                      setShowNoteModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={hasNote ? 'document-text' : 'document-text-outline'}
                      size={22}
                      color={isLight ? '#FFFFFF' : '#F2C31B'}
                    />
                  </TouchableOpacity>
                );
              })()}
            </View>

            {/* Right container - Done / return button. In Progress mode this
                returns to the SectionDetail screen instead of resetting to
                Home, so the user keeps the section context they came from. */}
            <View style={styles.buttonContainer}>
              <View style={[styles.checkmarkButtonBorder, { borderColor: theme.mode === 'light' ? '#F2C31B' : '#FFFFFF' }]}>
                <TouchableOpacity
                  style={styles.checkmarkButton}
                  onPress={() => {
                    if (mode === 'progress' && navigation.canGoBack && navigation.canGoBack()) {
                      navigation.goBack();
                      return;
                    }
                    // Prefer navigate('Home') when Home is already in the
                    // stack — it pops Camera off without re-mounting Home,
                    // which avoids the brief layout glitch (folders un-
                    // scrolled, nav missing) caused by reset's full
                    // remount. Falls back to reset if Home isn't in the
                    // stack (e.g. when Camera was reset-pushed directly).
                    try {
                      const state = navigation.getState?.();
                      const hasHome = state?.routes?.some?.((r) => r.name === 'Home');
                      if (hasHome) {
                        navigation.navigate('Home');
                        return;
                      }
                    } catch {}
                    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.doneButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Gallery at bottom - shown when swiping up (hidden when enlarged gallery is open) */}
      {showGallery && !showEnlargedGallery && (
        <Animated.View
          style={[
            styles.bottomGallery,
            {
              opacity: galleryOpacity,
              // Surface color follows the active theme — light theme
              // panel reads as white, dark theme as near-black, so the
              // strip doesn't look out of place against either app
              // background.
              backgroundColor: theme.background,
              // Height = bottomControls reservation (paddingBottom +
              // 75 capture row) + 28 px breathing room ABOVE the
              // capture row + 180 px of in-panel content (4 paddingTop
              // + 38 header row + 138 strip with name + date labels).
              // Strip allocation grew from 120 → 138 to accommodate
              // the new date row beneath each thumbnail's name.
              height: Math.max(20, insets.bottom + 10) + 75 + 28 + 180,
            }
          ]}
        >
          {/* Row that hosts BOTH the down-chevron and the Set title
              so the two share a single line at the very top of the
              panel. Title sits in the normal flex flow on the left;
              the chevron is absolutely centered within the row so it
              stays optically aligned regardless of title length. */}
          <View style={styles.galleryHeaderRow}>
            <Text style={styles.galleryTitleInline}>
            {(() => {
              if (mode === 'before') return `${getCurrentRoomInfo().name} Photos`;
              // After mode: title reflects which set is currently active
              // (matches the "Set N" labels on the capture screen tiles).
              // Falls back to "Before Photos" only when no Befores exist
              // in the room yet — nothing to enumerate.
              const roomBefores = getBeforePhotos(room) || [];
              if (roomBefores.length === 0) return 'Before Photos';
              const activeBefore = selectedBeforePhoto && selectedBeforePhoto.room === room
                ? selectedBeforePhoto
                : roomBefores[0];
              const idx = roomBefores.findIndex((b) => b.id === activeBefore?.id);
              return `Set ${(idx >= 0 ? idx : 0) + 1}`;
            })()}
          </Text>
            <TouchableOpacity
              style={styles.galleryHeaderChevron}
              onPress={() => {
                setShowGallery(false);
                galleryOpacity.setValue(0);
              }}
              hitSlop={{ top: 8, bottom: 12, left: 24, right: 24 }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-down" size={22} color={COLORS.PRIMARY} />
            </TouchableOpacity>
            {/* "Match Before" header button — top-RIGHT of the panel,
                mirroring "Set N" on the left. Always visible in After
                mode; snaps the strip back to the Before (index 0) so
                the ghost overlay + corner circle re-anchor to it. */}
            {mode === 'after' && (
              <TouchableOpacity
                style={styles.matchBeforeHeaderBtn}
                activeOpacity={0.7}
                onPress={() => {
                  if (galleryScrollRef.current?.scrollTo) {
                    galleryScrollRef.current.scrollTo({ x: 0, animated: true });
                  }
                  setGalleryIndex(0);
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="arrow-undo" size={12} color="#000" />
                <Text style={styles.matchBeforeHeaderBtnText}>Match Before</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.galleryStripWrap}>
          {(() => {
            // In Before mode the gallery shows every Before in the room.
            // In After mode it normally shows only Befores still waiting
            // for an After (the user is picking which one to pair), but
            // when every Before is already paired we fall back to all
            // individual room photos so the gallery isn't empty — the
            // user can long-press any of them to enlarge and review what
            // they've already shot. Combined photos are intentionally
            // excluded from the thumbnail row — only the originals show.
            const tsOf = (p) =>
              typeof p?.timestamp === 'number'
                ? p.timestamp
                : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
            let photos;
            if (mode === 'before') {
              // Strip is [...befores, placeholder]. The trailing
              // placeholder is the "next capture" slot — tapping
              // shutter while centered on it adds a NEW Before; the
              // shutter handler's `isRetakeContext` check leaves it
              // out of bounds so it doesn't trigger the retake prompt.
              // Centering on any real Before instead lets the user
              // retake (or save-as-new) that specific set.
              const befores = getBeforePhotos(room) || [];
              photos = [
                ...befores,
                { id: '__next_set_placeholder__', __placeholder: true, mode: 'placeholder' },
              ];
            } else {
              // After mode: show ONLY the active set's members (Before
              // + its Progresses + its After). The "set" is identified
              // by the active Before; switching sets happens via
              // horizontal swipe on the camera area (see panResponder).
              const activeBefore = selectedBeforePhoto && selectedBeforePhoto.room === room
                ? selectedBeforePhoto
                : (getBeforePhotos(room)[0] || null);
              if (activeBefore) {
                const progresses = (getProgressPhotos?.(room) || [])
                  .filter((p) => p.beforePhotoId === activeBefore.id)
                  .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                const after = (getAfterPhotos?.(room) || [])
                  .find((p) => p.beforePhotoId === activeBefore.id);
                photos = [
                  activeBefore,
                  ...progresses,
                  ...(after ? [after] : []),
                ];
              } else {
                photos = [];
              }
            }

            if (photos.length === 0) {
              return (
                <View style={styles.galleryEmpty}>
                  <Text style={styles.galleryEmptyText}>
                    {mode === 'before' ? 'No photos yet' : 'No photos yet'}
                  </Text>
                </View>
              );
            }

            // Friendly thumbnail label. Mode-driven so the set number
            // shows up exactly once on screen:
            //   - Before mode: each slide is a different set, so "Set N"
            //     by the room's capture order is the only useful label.
            //   - After / Progress mode: the strip walks one set's
            //     chronological members, and the active set number is
            //     already shown in the header pill (top-left). Each
            //     slide here gets its role label only: Before /
            //     Progress N / After.
            const roomBeforesForLabel = getBeforePhotos(room) || [];
            const labelForPhoto = (p, slotIndex) => {
              if (!p) return '';
              if (mode === 'before') {
                if (p.mode === PHOTO_MODES.BEFORE) {
                  const idx = roomBeforesForLabel.findIndex((b) => b.id === p.id);
                  // Centered Before → "Retake" instead of "Set N". The
                  // strip's center frame highlights the same slot, so
                  // both visual cues line up: ring + word both tell
                  // the user "shutter on this one will offer to retake".
                  if (slotIndex === galleryIndex) return 'Retake';
                  return idx >= 0 ? `Set ${idx + 1}` : 'Set';
                }
                return p.name || '';
              }
              // After / Progress mode — role-only labels.
              if (p.mode === PHOTO_MODES.BEFORE) return 'Before';
              if (p.mode === PHOTO_MODES.AFTER) return 'After';
              if (p.mode === PHOTO_MODES.PROGRESS) {
                const setProgresses = (getProgressPhotos?.(room) || [])
                  .filter((pp) => pp.beforePhotoId === p.beforePhotoId)
                  .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                const pIdx = setProgresses.findIndex((pp) => pp.id === p.id);
                return pIdx >= 0 ? `Progress ${pIdx + 1}` : 'Progress';
              }
              return p.name || '';
            };

            // Short capture-time string shown beneath each thumbnail's
            // name. Format mirrors the design reference ("May 27, 1:58 PM")
            // — month + day, then hour:minute with AM/PM. Callers pass
            // `{ timestamp: Date.now() }` for the placeholder card so
            // the user sees the time the NEXT shutter tap will land at.
            const formatThumbDate = (p) => {
              if (!p) return '';
              const ts = typeof p.timestamp === 'number'
                ? p.timestamp
                : (p.createdAt ? new Date(p.createdAt).getTime() : 0);
              if (!ts) return '';
              try {
                return new Date(ts).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                });
              } catch (_) {
                return '';
              }
            };

            // Center-as-active pattern, mirroring the enlarged gallery:
            // the photo sitting in the screen center is the active one
            // (ghost on the camera view). The user can scroll any photo
            // into the center to make it active. paddingHorizontal lets
            // the first/last items reach the center without overshoot.
            const ITEM_WIDTH = 100;
            const ITEM_GAP = 12;
            const SNAP_INTERVAL = ITEM_WIDTH + ITEM_GAP;
            const sidePadding = Math.max(16, (dimensions.width - ITEM_WIDTH) / 2);
            // Both modes use the same center-on-item snap: the
            // currently centered card is the "active" one. In Before
            // mode it's the retake target; in After mode it's the
            // ghost / Match source.
            const initialScrollX = (() => {
              if (enlargedWasOpenRef.current) {
                return Math.max(0, enlargedGalleryIndex * SNAP_INTERVAL);
              }
              // Default to the last item — most recent Before in
              // Before mode; the After (or latest Progress, else the
              // Before) in After mode.
              const targetIdx = Math.max(0, photos.length - 1);
              return Math.max(0, targetIdx * SNAP_INTERVAL);
            })();
            return (
              <ScrollView
                ref={galleryScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={SNAP_INTERVAL}
                bounces={false}
                decelerationRate="fast"
                snapToAlignment="start"
                scrollEventThrottle={16}
                directionalLockEnabled={true}
                contentOffset={{ x: initialScrollX, y: 0 }}
                onScrollBeginDrag={() => {
                  // Mark this touch as a scroll. onPressOut consults
                  // this ref and skips the tap action so a panning
                  // gesture doesn't open the enlarged view. The flag
                  // stays set until the NEXT onPressIn clears it; we
                  // don't clear it on scroll-end because onPressOut
                  // may fire after onScrollEndDrag and we still want
                  // it to count as "was scrolling this touch."
                  isScrollingGalleryRef.current = true;
                  // Cancel any pending long-press capture started by a
                  // touch that's now turning into a scroll.
                  if (longPressGalleryTimer.current) {
                    clearTimeout(longPressGalleryTimer.current);
                    longPressGalleryTimer.current = null;
                  }
                }}
                onMomentumScrollEnd={(event) => {
                  const offsetX = event.nativeEvent.contentOffset.x;
                  const index = Math.max(
                    0,
                    Math.min(photos.length - 1, Math.round(offsetX / SNAP_INTERVAL)),
                  );
                  setGalleryIndex(index);
                  if (mode === 'after') {
                    // matchedItemIdx drives the "Match" corner badge.
                    // Centered = active = match source.
                    setMatchedItemIdx(index);
                    return;
                  }
                  if (mode !== 'progress') return;
                  const centered = photos[index];
                  if (centered && centered.mode === PHOTO_MODES.BEFORE && centered.id !== selectedBeforePhoto?.id) {
                    setSelectedBeforePhoto(centered);
                  }
                }}
                contentContainerStyle={[
                  styles.galleryContent,
                  {
                    paddingLeft: sidePadding,
                    paddingRight: sidePadding,
                    gap: ITEM_GAP,
                  },
                ]}
              >
                {photos.map((photo, index) => {
                if (photo.__placeholder) {
                  // "Next capture" tile — empty dashed card with a
                  // camera icon. Not tappable: a tap on the strip's
                  // empty slot would conflict with the snap-to-center
                  // behavior. Label is the next set's ordinal so the
                  // user sees what they're about to create. After mode
                  // never receives a placeholder in the photos array
                  // (per the user's design), so this branch only fires
                  // for Before mode now.
                  //
                  // The dashed border + camera box gets the yellow
                  // accent permanently so the user can always identify
                  // the "next capture" slot — even if they scrolled
                  // a real Before into the center to retake, the
                  // placeholder remains visually marked.
                  const placeholderLabel = `Set ${(getBeforePhotos(room) || []).length + 1}`;
                  return (
                    <View
                      key={photo.id}
                      style={[
                        styles.galleryItem,
                        { width: ITEM_WIDTH, marginRight: 0 },
                      ]}
                    >
                      <View style={[styles.galleryPlaceholderItem, { borderColor: COLORS.PRIMARY, borderStyle: 'solid', width: ITEM_WIDTH, height: ITEM_WIDTH }]}>
                        <Ionicons name="camera-outline" size={28} color={COLORS.PRIMARY} />
                      </View>
                      <Text style={[styles.galleryItemName, { color: theme.textPrimary, width: ITEM_WIDTH }]} numberOfLines={1}>
                        {placeholderLabel}
                      </Text>
                      <Text style={[styles.galleryItemDate, { color: theme.textSecondary, width: ITEM_WIDTH }]} numberOfLines={1}>
                        {formatThumbDate({ timestamp: Date.now() })}
                      </Text>
                    </View>
                  );
                }
                return (
                <View
                  key={photo.id}
                  style={[
                    styles.galleryItem,
                    { width: ITEM_WIDTH, marginRight: 0 },
                  ]}
                >
      <TouchableOpacity
                    activeOpacity={0.7}
                    delayPressIn={50}
                    onPressIn={() => {
                      // Fresh touch — clear the "was scrolling" flag so
                      // a previous pan doesn't bleed into this gesture.
                      isScrollingGalleryRef.current = false;
                      // Track tap start time
                      tapStartTime.current = Date.now();

                      // Start long press timer for full-screen
                      longPressGalleryTimer.current = setTimeout(() => {
                        setEnlargedGalleryPhoto(photo);
                      }, 300);
                    }}
                    onPressOut={() => {
                      const pressDuration = Date.now() - (tapStartTime.current || 0);
                      const wasScrolling = isScrollingGalleryRef.current;

                      // Cancel long press timer
                      if (longPressGalleryTimer.current) {
                        clearTimeout(longPressGalleryTimer.current);
                        longPressGalleryTimer.current = null;
                      }

                      // If full-screen photo is showing, close it
                      if (enlargedGalleryPhoto) {
                        setEnlargedGalleryPhoto(null);
                      }
                      // Suppress the tap action when this touch was
                      // actually a scroll gesture — otherwise releasing
                      // after a quick pan would still satisfy the
                      // <300ms condition and open the enlarged view.
                      else if (wasScrolling) {
                        tapStartTime.current = null;
                        return;
                      }
                      // If it was a quick tap (< 300ms)
                      else if (pressDuration < 300) {
                        if (mode === 'before') {
                          // Before mode: two-step tap, same as After
                          //   1st tap on a non-centered slot → scroll
                          //     it into the active-slot frame.
                          //   2nd tap on the already-centered slot →
                          //     open the enlarged view.
                          // The placeholder card isn't wrapped in a
                          // TouchableOpacity, so it never reaches this
                          // handler — taps on it are no-ops.
                          if (galleryIndex === index) {
                            // Re-anchor the active set to the tapped
                            // Before so the enlarged carousel renders
                            // THAT set's members (Before → Progresses
                            // → After), not the room's list of
                            // Befores. Index resets to 0 so the
                            // carousel lands on the Before itself.
                            if (photo.mode === PHOTO_MODES.BEFORE) {
                              setSelectedBeforePhoto(photo);
                            }
                            setEnlargedGalleryIndex(0);
                            setShowEnlargedGallery(true);
                          } else {
                            if (galleryScrollRef.current?.scrollTo) {
                              galleryScrollRef.current.scrollTo({
                                x: index * SNAP_INTERVAL,
                                animated: true,
                              });
                            }
                            setGalleryIndex(index);
                          }
                        } else if (mode === 'after') {
                          // After mode: a tap on any thumbnail opens
                          // the enlarged carousel anchored on that
                          // photo. SCROLLING is the only way to change
                          // which item is the "matched" right card —
                          // taps must not snap the strip or change
                          // matchedItemIdx (per the user's UX rule).
                          setEnlargedGalleryIndex(index);
                          setShowEnlargedGallery(true);
                        }
                      }
                      
                      tapStartTime.current = null;
                    }}
                  >
                    <View>
                <Image
                        source={{ uri: photo.uri }}
                        style={[styles.galleryImage, { width: ITEM_WIDTH, height: ITEM_WIDTH }]}
                  resizeMode="cover"
                />
                      {/* "Match" tag — follows the scroll. Default to
                          the last item (After). After a swipe, lands
                          on whichever item is currently flanking the
                          placeholder on its right. */}
                      {mode === 'after' && (() => {
                        const targetIdx = matchedItemIdx >= 0
                          ? matchedItemIdx
                          : Math.max(0, photos.length - 1);
                        if (index !== targetIdx) return null;
                        return (
                          <View style={styles.matchCorner} pointerEvents="none">
                            <Text style={styles.matchCornerText}>Match</Text>
                          </View>
                        );
                      })()}
                      {/* Per-set photo count badge — Before-mode only.
                          Shows how many photos belong to THIS set
                          (Before + every Progress + the After, if
                          any). Sits top-right on the thumbnail. */}
                      {mode === 'before' && photo.mode === PHOTO_MODES.BEFORE && (() => {
                        const setProgresses = (getProgressPhotos?.(room) || [])
                          .filter((p) => p.beforePhotoId === photo.id);
                        const setAfter = (getAfterPhotos?.(room) || [])
                          .find((p) => p.beforePhotoId === photo.id);
                        const count = 1 + setProgresses.length + (setAfter ? 1 : 0);
                        return (
                          <View style={styles.galleryItemCountBadge}>
                            <Text style={styles.galleryItemCountText}>{count}</Text>
                          </View>
                        );
                      })()}
                      <Text style={[styles.galleryItemName, { color: theme.textPrimary, width: ITEM_WIDTH }]} numberOfLines={1}>
                        {labelForPhoto(photo, index)}
                      </Text>
                      <Text style={[styles.galleryItemDate, { color: theme.textSecondary, width: ITEM_WIDTH }]} numberOfLines={1}>
                        {formatThumbDate(photo)}
                      </Text>
                    </View>
              </TouchableOpacity>
                </View>
                );
              })}
              </ScrollView>
            );
          })()}
          {/* Static "active slot" frame — sits in the dead center of
              the strip area (parent wrapper has position:relative so
              centerFrame's top:0 aligns with the strip items' top
              automatically, no manual pixel math). Photos scroll past
              it; whichever photo lines up under the frame is the
              active one. */}
          {(mode === 'after' || mode === 'before') && (
            <View pointerEvents="none" style={styles.galleryCenterFrame} />
          )}
          </View>

          {/*
            Record Audio + Add Note row used to live here (inside the
            gallery's Animated.View, zIndex 150). It got rendered
            beneath the 3 round buttons because the fixedUILayer
            wrapping those buttons sits at zIndex 260. The row has
            since been moved into bottomControls right above
            mainControlRow so it floats correctly between the thumb
            strip and the round buttons.
          */}
          {false && (() => {
            // Figure out which photo gets the note (or audio later):
            // the currently centered slot in the strip, falling back to
            // the active Before if the centered slot is a placeholder.
            const centeredPhoto = (() => {
              const activeBefore = getActiveBeforePhoto();
              const stripPhotos = mode === 'before'
                ? (getBeforePhotos(room) || [])
                : (activeBefore
                    ? [
                        activeBefore,
                        ...(getProgressPhotos?.(room) || [])
                          .filter((p) => p.beforePhotoId === activeBefore.id)
                          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
                        ...((getAfterPhotos?.(room) || []).filter((p) => p.beforePhotoId === activeBefore.id)),
                      ]
                    : []);
              if (galleryIndex >= 0 && galleryIndex < stripPhotos.length) {
                return stripPhotos[galleryIndex];
              }
              return stripPhotos[stripPhotos.length - 1] || activeBefore || null;
            })();
            const hasNote = !!(centeredPhoto && centeredPhoto.note && String(centeredPhoto.note).trim());
            return (
              <View style={styles.notesAudioRow}>
                <TouchableOpacity
                  style={styles.notesAudioBtn}
                  onPress={() => {
                    // Placeholder — recording wiring lands in a later
                    // task. For now we just acknowledge the tap so the
                    // button doesn't feel dead.
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="mic-outline" size={16} color="#F2C31B" />
                  <Text style={styles.notesAudioBtnText}>Record Audio</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.notesAudioBtn}
                  onPress={() => {
                    if (!centeredPhoto?.id) return;
                    setNoteTargetPhotoId(centeredPhoto.id);
                    setNoteDraft(centeredPhoto.note || '');
                    setShowNoteModal(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={hasNote ? 'document-text' : 'document-text-outline'}
                    size={16}
                    color="#F2C31B"
                  />
                  <Text style={styles.notesAudioBtnText}>{hasNote ? 'Edit Note' : 'Add Note'}</Text>
                </TouchableOpacity>
              </View>
            );
          })()}
        </Animated.View>
      )}

      {/* Add Note modal — text input that writes the note onto the
          targeted photo's metadata when saved. */}
      <Modal
        visible={showNoteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNoteModal(false)}
      >
        <View style={styles.noteModalOverlay}>
          <View style={styles.noteModalCard}>
            <Text style={styles.noteModalTitle}>Add Note</Text>
            <TextInput
              style={styles.noteModalInput}
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Type your note…"
              placeholderTextColor="#888"
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.noteModalActions}>
              <TouchableOpacity
                style={[styles.noteModalBtn, { backgroundColor: '#333' }]}
                onPress={() => {
                  setShowNoteModal(false);
                  setNoteDraft('');
                  setNoteTargetPhotoId(null);
                }}
              >
                <Text style={[styles.noteModalBtnText, { color: '#FFF' }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noteModalBtn, { backgroundColor: '#F2C31B' }]}
                onPress={async () => {
                  if (noteTargetPhotoId) {
                    try {
                      await updatePhoto(noteTargetPhotoId, { note: noteDraft });
                    } catch (e) {
                      console.warn('[CameraScreen] failed to save note:', e?.message);
                    }
                  }
                  setShowNoteModal(false);
                  setNoteDraft('');
                  setNoteTargetPhotoId(null);
                }}
              >
                <Text style={[styles.noteModalBtnText, { color: '#000' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Android combined photos are now handled by GlobalBackgroundCombinedPhotoCreator */}

      {/* Enlarged gallery carousel - shown when tapping a gallery item */}
      {showEnlargedGallery && (() => {
        // Mirror the small gallery's photo source so swiping the enlarged
        // carousel lines up 1:1 with the thumbnails underneath. Combined
        // photos are excluded — only the originals (Before / Progress /
        // After) are shown.
        const tsOf = (p) =>
          typeof p?.timestamp === 'number'
            ? p.timestamp
            : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
        let photos;
        // Both modes now show the SAME set-scoped slide list: the
        // active set's Before → Progresses → After → "next capture"
        // placeholder. In Before mode the small-strip tap re-anchors
        // selectedBeforePhoto on the tapped tile, so this branch
        // surfaces that exact set's members instead of every Before
        // in the room.
        const activeBefore = selectedBeforePhoto && selectedBeforePhoto.room === room
          ? selectedBeforePhoto
          : (getBeforePhotos(room)[0] || null);
        if (activeBefore) {
          const progresses = (getProgressPhotos?.(room) || [])
            .filter((p) => p.beforePhotoId === activeBefore.id)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          const after = (getAfterPhotos?.(room) || [])
            .find((p) => p.beforePhotoId === activeBefore.id);
          // Enlarged carousel = REAL photos only (Before → Progresses
          // → After). The "next capture" placeholder is intentionally
          // omitted — showing a giant empty dashed-box card here is
          // not useful; the user already sees the live camera above.
          photos = [
            activeBefore,
            ...progresses,
            ...(after ? [after] : []),
          ];
        } else {
          photos = [];
        }
        const currentPhoto = photos[enlargedGalleryIndex];
        const closeEnlarged = () => {
          setEnlargedGalleryPhoto(null);
          setShowEnlargedGallery(false);
        };
        const handleEditCurrent = () => {
          if (!currentPhoto) return;
          closeEnlarged();
          // Studio is the photo-edit destination — same route the photo-set
          // preview uses, so the user lands on the same Studio surface
          // whether they came from the capture screen gallery or from the
          // project timeline.
          navigation.navigate('StudioDetail', { photoId: currentPhoto.id });
        };
        const handleShareCurrent = async () => {
          if (!currentPhoto?.uri) return;
          try {
            await Share.share({ url: currentPhoto.uri, message: currentPhoto.name || '' });
          } catch (_) {
            // user dismissed
          }
        };
        const handleDeleteCurrent = () => {
          if (!currentPhoto) return;
          Alert.alert(
            'Delete photo?',
            'This photo will be removed permanently.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await deletePhoto(currentPhoto.id);
                  closeEnlarged();
                  const remainingPhotos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
                  if (remainingPhotos.length === 0) setShowGallery(false);
                },
              },
            ]
          );
        };

        return (
          <Animated.View
            style={[
              styles.enlargedGalleryContainer,
              {
                height: dimensions.height * 0.41,
                backgroundColor: theme.background,
                borderTopColor: theme.border,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderBottomWidth: 0,
                borderLeftWidth: 0,
                borderRightWidth: 0,
              },
            ]}
            {...enlargedGalleryPanResponder.panHandlers}
          >
            {/* Down-chevron close button — sits at the top of the
                enlarged panel. Now styled as a brand-yellow pill with
                a black icon (same chrome as the old top-left back
                button, which is removed) so it reads as a deliberate
                primary action rather than a faint hint. Tap or swipe
                both jump back to the full camera (also closes the
                small thumbnail row). */}
            <TouchableOpacity
              style={styles.gallerySwipeHintBtn}
              onPress={() => {
                setEnlargedGalleryPhoto(null);
                setShowEnlargedGallery(false);
                setShowGallery(false);
                galleryOpacity.setValue(0);
              }}
              hitSlop={{ top: 8, bottom: 12, left: 24, right: 24 }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-down" size={22} color="#000" />
            </TouchableOpacity>
            {(() => {
              // Peek pagination — show edges of the previous/next photo on
              // either side so the user sees there's more to swipe through.
              // PEEK is how much of a neighbor pokes in; GAP is the visual
              // separator between cards.
              const PEEK = 18;
              const GAP = 12;
              const cardWidth = dimensions.width - 2 * (PEEK + GAP);
              const snapInterval = cardWidth + GAP;
              const canGoLeft = enlargedGalleryIndex > 0;
              const canGoRight = enlargedGalleryIndex < photos.length - 1;
              const scrollToIndex = (i) => {
                if (i < 0 || i >= photos.length) return;
                // Suppress onScroll's live index updates for the
                // duration of this animation. Without this guard,
                // the ScrollView's intermediate offsets during the
                // programmatic scroll round to the OLD index for a
                // few frames and call setEnlargedGalleryIndex(old)
                // — overwriting our setEnlargedGalleryIndex(new)
                // and snapping the carousel right back. Cleared on
                // onMomentumScrollEnd or via a safety timeout.
                arrowScrollingRef.current = true;
                arrowScrollingTargetRef.current = i;
                setEnlargedGalleryIndex(i);
                requestAnimationFrame(() => {
                  enlargedGalleryScrollRef.current?.scrollTo?.({
                    x: i * snapInterval,
                    y: 0,
                    animated: true,
                  });
                });
                if (arrowScrollClearTimer.current) {
                  clearTimeout(arrowScrollClearTimer.current);
                }
                arrowScrollClearTimer.current = setTimeout(() => {
                  arrowScrollingRef.current = false;
                  arrowScrollClearTimer.current = null;
                }, 500);
              };
              return (
                <View style={{ flex: 1, position: 'relative' }}>
                <ScrollView
                  ref={enlargedGalleryScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  snapToInterval={snapInterval}
                  decelerationRate="fast"
                  snapToAlignment="start"
                  contentContainerStyle={{ paddingHorizontal: PEEK + GAP }}
                  style={{ flex: 1 }}
                  scrollEventThrottle={16}
                  onScroll={(event) => {
                    // Live index update during scroll so the side
                    // arrows toggle visibility immediately when the
                    // user pans into the first/last page — previously
                    // only onMomentumScrollEnd updated the index, so
                    // the "available" arrow appeared with a visible
                    // delay after the snap completed.
                    // SKIP during a programmatic arrow-tap scroll —
                    // the intermediate offsets round to the OLD
                    // index for several frames and would clobber the
                    // setEnlargedGalleryIndex(new) we just queued.
                    if (arrowScrollingRef.current) return;
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const idx = Math.round(offsetX / snapInterval);
                    if (idx !== enlargedGalleryIndex && idx >= 0 && idx < photos.length) {
                      setEnlargedGalleryIndex(idx);
                    }
                  }}
                  onMomentumScrollEnd={(event) => {
                    // Programmatic arrow scroll just finished — clear
                    // the guard so user-driven scrolls update the
                    // index live again.
                    if (arrowScrollingRef.current) {
                      arrowScrollingRef.current = false;
                      if (arrowScrollClearTimer.current) {
                        clearTimeout(arrowScrollClearTimer.current);
                        arrowScrollClearTimer.current = null;
                      }
                    }
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const index = Math.round(offsetX / snapInterval);
                    if (photos[index]) {
                      setEnlargedGalleryIndex(index);
                      // The enlarged carousel walks through the ACTIVE
                      // set's chronological members (Before → Progresses
                      // → After). Scrolling within that set must NOT
                      // re-anchor selectedBeforePhoto to a non-Before —
                      // doing so leaves the room with no findable
                      // active Before (header pill jumps to "Set N+1"),
                      // the thumbnail row collapses to just the
                      // centered photo, and the active set is lost.
                    }
                  }}
                >
                  {photos.map((photo, index) => {
                    if (photo.__placeholder) {
                      // "Next photo" placeholder card — same dashed-
                      // camera tile the small strip uses, sized to
                      // the enlarged slide. No trash, no tap action.
                      return (
                        <View
                          key={photo.id}
                          style={[
                            styles.enlargedGallerySlide,
                            { width: cardWidth, marginRight: index === photos.length - 1 ? 0 : GAP },
                          ]}
                        >
                          <View style={styles.enlargedGalleryPlaceholder}>
                            <Ionicons name="camera-outline" size={48} color="#888" />
                          </View>
                        </View>
                      );
                    }
                    return (
                    <TouchableWithoutFeedback
                      key={photo.id}
                      onPressIn={() => {
                        tapStartTime.current = Date.now();
                        longPressGalleryTimer.current = setTimeout(() => {
                          setEnlargedGalleryPhoto(photo);
                        }, 300);
                      }}
                      onPressOut={() => {
                        const pressDuration = Date.now() - (tapStartTime.current || 0);
                        if (longPressGalleryTimer.current) {
                          clearTimeout(longPressGalleryTimer.current);
                          longPressGalleryTimer.current = null;
                        }
                        if (enlargedGalleryPhoto) {
                          setEnlargedGalleryPhoto(null);
                        } else if (pressDuration < 300 && mode === 'after') {
                          // Just track the centered index; do not write
                          // a non-Before into selectedBeforePhoto (see
                          // the matching comment in onMomentumScrollEnd
                          // above for why this breaks the active set).
                          setEnlargedGalleryIndex(index);
                        }
                        tapStartTime.current = null;
                      }}
                    >
                      <View style={[
                        styles.enlargedGallerySlide,
                        { width: cardWidth, marginRight: index === photos.length - 1 ? 0 : GAP },
                      ]}>
                        <Image
                          source={{ uri: photo.uri }}
                          style={styles.enlargedGalleryImage}
                          resizeMode="cover"
                        />
                        {/* Top-center label on the photo itself: "Set N
                            Before" / "Set N Progress X" / "Set N After".
                            Per-card so swiping pages updates the label
                            in lockstep with the photo. */}
                        {(() => {
                          const roomBefores = getBeforePhotos(room) || [];
                          let setIdx;
                          if (photo.mode === PHOTO_MODES.BEFORE) {
                            setIdx = roomBefores.findIndex((b) => b.id === photo.id);
                          } else {
                            setIdx = roomBefores.findIndex((b) => b.id === photo.beforePhotoId);
                          }
                          const setLabel = setIdx >= 0 ? `Set ${setIdx + 1}` : '';
                          let roleLabel = '';
                          if (photo.mode === PHOTO_MODES.BEFORE) roleLabel = 'Before';
                          else if (photo.mode === PHOTO_MODES.AFTER) roleLabel = 'After';
                          else if (photo.mode === PHOTO_MODES.PROGRESS) {
                            const setProgresses = (getProgressPhotos?.(room) || [])
                              .filter((pp) => pp.beforePhotoId === photo.beforePhotoId)
                              .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                            const pIdx = setProgresses.findIndex((pp) => pp.id === photo.id);
                            roleLabel = pIdx >= 0 ? `Progress ${pIdx + 1}` : 'Progress';
                          }
                          const text = `${setLabel} ${roleLabel}`.trim();
                          if (!text) return null;
                          return (
                            <View style={styles.enlargedPhotoTopLabel} pointerEvents="none">
                              <Text style={styles.enlargedPhotoTopLabelText} numberOfLines={1}>
                                {text}
                              </Text>
                            </View>
                          );
                        })()}
                        {/* Eye (top-left) — opens Home's modern in-
                            screen preview modal (same one that appears
                            when tapping a card on the home grid).
                            Resolves the photo's set members (Before /
                            After / Progresses) so the modal lands on
                            the exact slide the user was viewing. We
                            avoid PhotoSetPreviewScreen — that's the
                            legacy "old view" still wired to Projects. */}
                        <TouchableOpacity
                          style={styles.enlargedGalleryPhotoEye}
                          onPress={() => {
                            const targetRoom = photo?.room || room;
                            let previewBeforeId = null;
                            let previewAfterId = null;
                            if (photo.mode === PHOTO_MODES.BEFORE) {
                              previewBeforeId = photo.id;
                              const afterMatch = (getAfterPhotos?.(targetRoom) || [])
                                .find((p) => p.beforePhotoId === photo.id);
                              previewAfterId = afterMatch?.id || null;
                            } else if (photo.mode === PHOTO_MODES.AFTER) {
                              previewBeforeId = photo.beforePhotoId || null;
                              previewAfterId = photo.id;
                            } else if (photo.mode === PHOTO_MODES.PROGRESS) {
                              previewBeforeId = photo.beforePhotoId || null;
                              const afterMatch = previewBeforeId
                                ? (getAfterPhotos?.(targetRoom) || [])
                                    .find((p) => p.beforePhotoId === previewBeforeId)
                                : null;
                              previewAfterId = afterMatch?.id || null;
                            }
                            closeEnlarged();
                            setShowGallery(false);
                            galleryOpacity.setValue(0);
                            navigation.navigate('Home', {
                              previewBeforeId,
                              previewAfterId,
                              previewRoom: targetRoom,
                              previewProjectId: photo?.projectId || activeProjectId || null,
                              previewPhotoId: photo.id,
                            });
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="eye-outline" size={20} color="#FFFFFF" />
                        </TouchableOpacity>
                        {/* Trash overlay — top-right of THIS photo. Per
                            card so swiping to another page and tapping
                            delete removes the visible photo, not whatever
                            the global "currentPhoto" ref still pointed at. */}
                        <TouchableOpacity
                          style={[styles.enlargedGalleryPhotoTrash, { backgroundColor: theme.danger }]}
                          onPress={() => {
                            Alert.alert(
                              'Delete photo?',
                              'This photo will be removed permanently.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: async () => {
                                    await deletePhoto(photo.id);
                                    closeEnlarged();
                                    const remainingPhotos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
                                    if (remainingPhotos.length === 0) setShowGallery(false);
                                  },
                                },
                              ]
                            );
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
                        </TouchableOpacity>
                      </View>
                    </TouchableWithoutFeedback>
                    );
                  })}
                </ScrollView>
                {/* Side arrows — hint there are more photos in the
                    row and act as a one-tap "next/prev" without
                    requiring a swipe. Hidden at the row's edges so
                    they only show when there's somewhere to go.
                    Renders for both Before-mode (multiple sets) and
                    After/Progress-mode (set members), since both
                    cases can have more than one photo in the row. */}
                {canGoLeft && (
                  <TouchableOpacity
                    style={[styles.enlargedGalleryArrow, styles.enlargedGalleryArrowLeft, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
                    onPress={() => scrollToIndex(enlargedGalleryIndex - 1)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
                {canGoRight && (
                  <TouchableOpacity
                    style={[styles.enlargedGalleryArrow, styles.enlargedGalleryArrowRight, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
                    onPress={() => scrollToIndex(enlargedGalleryIndex + 1)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
                </View>
              );
            })()}
          </Animated.View>
        );
      })()}

      {/* Full-screen photo - shown when long-pressing in enlarged gallery (only when enlarged gallery is open) */}
      {enlargedGalleryPhoto && showEnlargedGallery && (
        <View style={styles.fullScreenPhotoContainer}>
          <Image
            source={{ uri: enlargedGalleryPhoto.uri }}
            style={styles.fullScreenPhotoImage}
            resizeMode="contain"
          />
          <Text style={styles.fullScreenPhotoName}>{enlargedGalleryPhoto.name}</Text>
        </View>
      )}

      {/* Room transition indicator - shown briefly when switching rooms */}
      {showRoomIndicator && (() => {
        const squareSize = (dimensions.width - 60) / 2;
        const iconSize = 48; // matches styles.roomTransitionIcon
        const screenCenterTopForCard = (dimensions.height - squareSize) / 2; // centers the square
        // Both full and half screen: move up by 1/3 of square size
        const topOffset = squareSize / 3;
        const computedTop = screenCenterTopForCard - topOffset;
        return (
          <View style={[styles.roomTransitionIndicator, { top: computedTop }]}>
            <View
              style={[
                styles.roomTransitionCard,
                { width: squareSize, height: squareSize }
              ]}
            >
              <Text style={styles.roomTransitionIcon}>{getCurrentRoomInfo().icon}</Text>
              <Text style={styles.roomTransitionName}>{getCurrentRoomInfo().name}</Text>
            </View>
          </View>
        );
      })()}

      {/* Full screen view - activated by holding thumbnail */}
      {isFullScreen && !showCarousel && (() => {
        const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
        
        if (photos.length === 0) return null;
        
        return (
          <View style={styles.fullScreenContainer} pointerEvents="box-none">
            <View style={styles.fullScreenBackground} />
            <ScrollView
              ref={fullScreenScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              snapToInterval={dimensions.width}
              decelerationRate="fast"
              contentOffset={{ x: fullScreenIndex * dimensions.width, y: 0 }}
              onMomentumScrollEnd={(event) => {
                const offsetX = event.nativeEvent.contentOffset.x;
                const index = Math.round(offsetX / dimensions.width);
                setFullScreenIndex(index);
                // Update selected photo in after mode
                if (mode === 'after' && photos[index]) {
                  setSelectedBeforePhoto(photos[index]);
                }
              }}
              scrollEventThrottle={16}
              style={styles.fullScreenScroll}
            >
              {photos.map((photo) => (
                <View key={photo.id} style={[styles.fullScreenSlide, { width: dimensions.width, height: dimensions.height }]}>
            <Image
                    source={{ uri: photo.uri }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
                </View>
              ))}
            </ScrollView>
            <View style={styles.fullScreenInfo} pointerEvents="none">
              <Text style={styles.fullScreenName}>{photos[fullScreenIndex]?.name}</Text>
              <Text style={styles.fullScreenHint}>Release to return - Swipe to navigate</Text>
            </View>
          </View>
        );
      })()}

      {/* Carousel view - activated by double-tap */}
      {showCarousel && (() => {
        const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
        
        return (
          <View style={styles.carouselOverlay}>
            <TouchableOpacity
              style={styles.carouselBackground}
              activeOpacity={1}
              onPress={() => {
                setShowCarousel(false);
              }}
            />
            
            <Animated.View 
              style={[
                styles.carouselContainer,
                {
                  transform: [{ translateY: carouselTranslateY }]
                }
              ]}
              {...carouselPanResponder.panHandlers}
            >
              <ScrollView
                ref={carouselScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={dimensions.width}
                decelerationRate="fast"
                snapToAlignment="center"
                contentOffset={{ x: carouselIndex * dimensions.width, y: 0 }}
                onMomentumScrollEnd={(event) => {
                  const offsetX = event.nativeEvent.contentOffset.x;
                  const index = Math.round(offsetX / dimensions.width);
                  setCarouselIndex(index);
                  // Update selected photo in after mode
                  if (mode === 'after' && photos[index]) {
                    setSelectedBeforePhoto(photos[index]);
                  }
                }}
                scrollEventThrottle={16}
              >
                {photos.map((photo) => (
                  <View key={photo.id} style={[styles.carouselSlide, { width: dimensions.width, height: dimensions.height }]}>
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.carouselImage}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </ScrollView>

              <View style={styles.carouselInfo}>
                <Text style={styles.carouselPhotoName}>{photos[carouselIndex]?.name}</Text>
                <Text style={styles.carouselCounter}>{carouselIndex + 1} / {photos.length}</Text>
              </View>

              <TouchableOpacity
                style={styles.carouselCloseButton}
                onPress={() => {
                  setShowCarousel(false);
                }}
              >
                <Ionicons name="close" size={28} color="#FFF" />
              </TouchableOpacity>
            </Animated.View>
          </View>
        );
      })()}
    </View>
  );

  const renderLabelView = () => {
    if (!tempPhotoUri || !tempPhotoLabel) return null;

      return (
      <View
        ref={labelViewRef}
        style={[
          styles.hiddenLabelView,
          {
            width: tempPhotoDimensions.width,
            height: tempPhotoDimensions.height
          }
        ]}
        collapsable={false}
      >
        <Image
          source={{ uri: tempPhotoUri }}
          style={styles.hiddenLabelImage}
          resizeMode="cover"
        />
        {/* Calculate scale factor for label to match standard size
            Camera photos are typically 1920x1080 (portrait) or 1080x1920 (landscape)
            Scale factor needed to make label appear the same size as on screen photos
        */}
        {(() => {
          // Use the same consistent scale factor as PhotoDetailScreen
          // Reference width: 1920px (landscape photo width for consistent scaling)
          const referenceWidth = 1920;
          const screenWidth = Dimensions.get('window').width;
          const scaleFactor = referenceWidth / screenWidth;

          // Determine which position to use based on the label
          const currentLabelPosition = tempPhotoLabel === 'BEFORE' ? beforeLabelPosition : afterLabelPosition;
          const positions = getLabelPositions(labelMarginVertical, labelMarginHorizontal);
          const positionConfig = positions[currentLabelPosition] || positions['left-top'];

          // Scale position coordinates for capture
          const capturePositionStyle = {};
          if (positionConfig.top !== undefined) {
            capturePositionStyle.top = typeof positionConfig.top === 'string'
              ? positionConfig.top
              : positionConfig.top * scaleFactor;
          }
          if (positionConfig.bottom !== undefined) {
            capturePositionStyle.bottom = positionConfig.bottom * scaleFactor;
          }
          if (positionConfig.left !== undefined) {
            capturePositionStyle.left = typeof positionConfig.left === 'string'
              ? positionConfig.left
              : positionConfig.left * scaleFactor;
          }
          if (positionConfig.right !== undefined) {
            capturePositionStyle.right = positionConfig.right * scaleFactor;
          }
          if (positionConfig.transform) {
            capturePositionStyle.transform = positionConfig.transform;
          }

          return (
            <>
              <PhotoLabel
                label={tempPhotoLabel}
                position={currentLabelPosition}
                style={{
                  ...capturePositionStyle,
                  paddingHorizontal: 12 * scaleFactor,
                  paddingVertical: 6 * scaleFactor,
                  borderRadius: 6 * scaleFactor
                }}
                textStyle={{
                  fontSize: 14 * scaleFactor
                }}
              />
              {shouldShowWatermark && (
                <PhotoWatermark
                  style={{
                    paddingHorizontal: 10 * scaleFactor,
                    paddingVertical: 4 * scaleFactor,
                    borderRadius: 4 * scaleFactor
                  }}
                  onPress={null}
                />
              )}
            </>
          );
        })()}
        </View>
      );
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
    }
    return () => {
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible');
      }
    };
  }, []);

  if (hasPermission === null) {
    // Camera permissions are still loading.
    return <View />;
  }

  if (!hasPermission) {
    // Camera permissions are not granted yet.
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera device not available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={(event) => setLayout(event.nativeEvent.layout)}>
     
      {/* Container for camera - no scaling, just full screen */}
      <View style={styles.cameraWrapper}>
        {renderOverlayMode()}
        {renderLabelView()}
      </View>

      {/* Photo capture animation overlay */}
      {captureAnimationUri && (
        <Animated.View
          style={[
            styles.captureAnimationOverlay,
            {
              opacity: captureAnimOpacity,
              transform: [
                { translateX: captureAnimTranslateX },
                { translateY: captureAnimTranslateY },
                { scale: captureAnimScale },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: captureAnimationUri }}
            style={styles.captureAnimationImage}
            resizeMode="cover"
          />
        </Animated.View>
      )}

      {/* Background label preparation is now handled by GlobalBackgroundLabelPreparation component */}
      {/* No local Modals needed - the global component stays mounted regardless of navigation */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  orientationWarning: {
    position: 'absolute',
    top: '40%',
    left: 20,
    right: 20,
    backgroundColor: 'rgba(242, 195, 27, 0.95)',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    zIndex: 1500,
    elevation: 1500,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10
  },
  rotatePhoneIcon: {
    fontSize: 64,
    marginBottom: 12
  },
  orientationWarningText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 8
  },
  orientationWarningHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: COLORS.TEXT,
    textAlign: 'center',
    opacity: 0.8
  },
  message: {
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
    paddingBottom: 10,
    color: 'white',
    fontSize: 16
  },
  permissionButton: {
    backgroundColor: COLORS.PRIMARY,
    padding: 16,
    borderRadius: 8,
    margin: 20
  },
  permissionButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    textAlign: 'center',
    fontWeight: 'bold'
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  camera: {
    flex: 1
  },
  beforePhotoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Opacity comes from `ghostOpacity` state via the inline style on
    // the rendered View — kept dynamic so the side slider can dial it.
    justifyContent: 'center',
    alignItems: 'center'
  },
  beforePhotoImage: {
    width: '100%',
    height: '100%'
  },
  // Opaque black overlay on top of the camera area for ~600ms after
  // an aspect-mode change, masking the format-reconfig blink.
  aspectTransitionMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
  },
  fixedUILayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 260,
    elevation: 260,
    backgroundColor: 'transparent',
    overflow: 'hidden'
  },
  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 260,
    elevation: 260
  },
  roomModeContainer: {
    position: 'absolute',
    top: 50,
    left: 15,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  roomModePillWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
    overflow: 'hidden',
    height: 32,
    paddingLeft: 14,
    paddingRight: 4,
  },
  roomButton: {
    backgroundColor: 'transparent',
    paddingRight: 8,
    justifyContent: 'center',
  },
  roomButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '590',
    letterSpacing: -0.11,
  },
  modeButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 30,
    justifyContent: 'center',
    height: 25,
  },
  modeButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    fontSize: 13.7,
    fontWeight: '590',
    textAlign: 'center',
  },
  torchButton: {
    position: 'absolute',
    top: 50,
    right: 15,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  soundButton: {
    position: 'absolute',
    top: 50,
    right: 60,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: 'white',
    fontSize: 24
  },
  flashlightButton: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,   // Portrait orientation - narrow width
    height: 84   // Portrait orientation - full height
  },
  flashlightButtonText: {
    fontSize: 24
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  flipButtonText: {
    fontSize: 24
  },
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 20,
    paddingHorizontal: 0,
    backgroundColor: 'transparent'
  },
  mainControlRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    position: 'relative',
    paddingHorizontal: 10,
  },
  buttonContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    // Buttons (thumbnail, capture, done) are all 75 px tall, so the
    // container is sized to match — no extra empty space above the
    // capture button. Combined with notesAudioRow.paddingBottom = 10
    // this gives the 10 px gap the layout spec asks for between the
    // record/note row and the capture button.
    minHeight: 75,
    width: 80,
  },
  modeInfo: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20
  },
  modeText: {
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: '600'
  },
  captureButtonContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  // Flex slot between two of the big circle buttons. Renders empty
  // in full-camera mode (keeps the row layout consistent) and hosts
  // the Record Audio / Add Note mini icon in half-screen mode. Equal
  // flex with its sibling slot so the icons land at the visual
  // midpoint between the circles on either side.
  midIconSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 75,
  },
  // Small round button that sits centered in midIconSlot — the dead
  // space BETWEEN the big circles (thumbnail / capture / done). Used
  // for Record Audio + Add Note in half-screen mode. mainControlRow
  // uses align-items: flex-end, so the marginBottom roughly centers
  // the 44 px button vertically against the 75 px circles.
  inlineMidIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(242, 195, 27, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  controlsRowAboveCapture: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  // Format switch (design 07): two segments sit inside one continuous
  // translucent-dark capsule instead of two separately outlined chips
  // with a gap. Active segment fills white with dark text; inactive
  // stays transparent with white text. Reads as a single segmented
  // control, like the zoom pill next to it.
  aspectRatioSelector: {
    flexDirection: 'row',
    gap: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 999,
    padding: 3,
  },
  aspectRatioButtonBottom: {
    backgroundColor: 'transparent',
    alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
    minWidth: 44,
    height: 26,
    paddingHorizontal: 10,
  },
  aspectRatioButtonBottomActive: {
    backgroundColor: '#FFFFFF',
  },
  aspectRatioButtonBottomText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  aspectRatioButtonBottomTextActive: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#1E1E1E',
    fontWeight: '700',
  },
  aspectRatioButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
     alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    minWidth: 55,
    alignItems: 'center'
  },
  aspectRatioButtonActive: {
    backgroundColor: COLORS.PRIMARY
  },
  aspectRatioText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600'
  },
  aspectRatioTextActive: {
    color: '#000'
  },
   captureButton: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#F2C31B',
    padding: 3,
  },
  captureButtonInnerCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    backgroundColor: '#F2C31B',
  },
  captureButtonDisabled: {
    opacity: 0.5,
    backgroundColor: '#333',
  },
  captureButtonProcessing: {
    backgroundColor: '#000',
    borderWidth: 4,
    borderColor: COLORS.PRIMARY,
  },
  captureButtonProcessingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  captureButtonProcessingText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2
  },
  captureButtonInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'transparent'
  },
  captureButtonInnerDisabled: {
    backgroundColor: '#999'
  },
  captureButtonWarning: {
    position: 'absolute',
    fontSize: 32
  },
  zoomContainer: {
    alignItems: 'center',
    marginBottom: 20
  },
  // Refresh pass 9 (cosmetic) — design 07: zoom pill is a tight
  // translucent capsule with snug zoom-preset chips inside. Was a wider
  // dark pill with 44-px-tall preset buttons + scale animation on the
  // active. Active zoom now reads as yellow text inline (no scale, no
  // background change) — matches the screenshot exactly.
  zoomButtons: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  zoomPresetButton: {
    minWidth: 30,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 1,
  },
  zoomPresetButtonActive: {
    backgroundColor: 'transparent',
    opacity: 1,
  },
  zoomPresetText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  zoomPresetTextActive: {
    color: COLORS.PRIMARY,
    fontWeight: '800',
  },
  aspectRatioContainer: {
    flexDirection: 'column',
    gap: 8,
    width: 80,
    position: 'absolute',
    left: 10
  },
  aspectRatioButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center'
  },
  aspectRatioButtonActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  aspectRatioButtonLocked: {
    backgroundColor: 'rgba(242, 195, 27, 0.3)',
    borderColor: COLORS.PRIMARY,
    opacity: 0.7
  },
  aspectRatioText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600'
  },
  aspectRatioTextActive: {
    color: COLORS.TEXT
  },
  aspectRatioHint: {
    fontSize: 10,
    marginTop: 2
  },
  aspectRatioLockIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
    fontSize: 10
  },
  // Thumbnail viewer: white outer border (matches Figma design)
  thumbnailViewerContainer: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    overflow: 'hidden',
    backgroundColor: '#00000000',
    borderWidth: 2,
    borderColor: 'rgb(255, 255, 255)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailInnerRing: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: '#000000c7',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailLandscape: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
  },
  thumbnailPortrait: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
  },
  thumbnailViewerImage: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
  },
  thumbnailViewerLabel: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    fontSize: 20
  },
  // Full screen styles
  fullScreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 1001,
    elevation: 1001
  },
  fullScreenBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    width: '100%',
    height: '100%'
  },
  fullScreenScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%'
  },
  fullScreenSlide: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  fullScreenImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenInfo: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center'
  },
  fullScreenName: {
    color: COLORS.PRIMARY,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4
  },
  fullScreenHint: {
    color: COLORS.GRAY,
    fontSize: 13
  },
  // Carousel styles
  carouselOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1002,
    elevation: 1002
  },
  carouselBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000'
  },
  carouselCloseHintText: {
    color: COLORS.GRAY,
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20
  },
  carouselContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center'
  },
  carouselSwipeIndicator: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    paddingVertical: 10
  },
  carouselDragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 8
  },
  carouselSlide: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  carouselImage: {
    width: '100%',
    height: '100%'
  },
  carouselInfo: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 12,
    paddingHorizontal: 20
  },
  carouselPhotoName: {
    color: COLORS.PRIMARY,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4
  },
  carouselCounter: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600'
  },
  carouselCloseButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
    color: COLORS.TEXT,
    fontSize: 24,
    fontWeight: 'bold'
  },
  photoFrameGuide: {
    position: 'absolute',
    top: '5%',
    left: '5%',
    right: '5%',
    bottom: '5%',
    borderWidth: 2,
    borderColor: 'rgba(242, 195, 27, 0.6)',
    borderStyle: 'dashed'
  },
  frameCorner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: COLORS.PRIMARY
  },
  frameTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4
  },
  frameTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4
  },
  frameBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4
  },
  frameBottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4
  },
  // Crop overlay styles
  cropOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center'
  },
  darkOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)'
  },
  frameArea: {
    position: 'relative',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY
  },
  // Gallery swipe-up styles
  cameraWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 30,
  },
  bottomGallery: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY,
    paddingTop: 4,
    zIndex: 150,
    elevation: 150
  },
  gallerySwipeHint: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
    paddingBottom: 2,
  },
  // Pill version of the close chevron used on the enlarged panel.
  // Brand-yellow background + black icon — inherited chrome from
  // the removed top-left back button so the close action stays
  // visually obvious without that extra control on screen.
  gallerySwipeHintBtn: {
    alignSelf: 'center',
    marginTop: 6,
    width: 56,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 5,
  },
  // Combined header row: chevron centered, "Set N" left-aligned, both
  // at the same vertical baseline. 6 px top padding puts the row's
  // content the same 6 px below the split line as the standalone
  // chevron used to be.
  galleryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    position: 'relative',
  },
  galleryTitleInline: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'left',
  },
  galleryHeaderChevron: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    marginLeft: 16,
    textAlign: 'left'
  },
  galleryContent: {
    // paddingHorizontal is set inline so it can react to screen width
    // (centers the first/last items in the visible viewport).
    gap: 12,
  },
  // Static yellow ring at the dead center of the gallery panel, sized
  // to wrap a single 100x100 thumbnail (100 photo + 3px border on each
  // side = 106). Vertical offset matches where the thumbnail image
  // starts within the panel (paddingTop + swipe hint + title +
  // ScrollView padding ≈ 60). Only the border is visible; the inside
  // is transparent so the centered photo shows through.
  // Wrapper around the strip ScrollView + the centered active-slot
  // frame. position:relative so the centerFrame's `top:0` lands at
  // the same y as the ScrollView's first row of items — eliminates
  // the manual `top: 36/42` pixel guessing that drifted whenever
  // the header row's font metrics or padding changed.
  galleryStripWrap: {
    position: 'relative',
  },
  galleryCenterFrame: {
    position: 'absolute',
    // Anchored to the wrapper's top (which is the ScrollView's top),
    // so the ring naturally aligns with the centered thumbnail's
    // outer top edge. Height = photo (100) + name row (~21) + date
    // row (~16) + 6 px border = 143 px, matches the thumbnail box.
    top: 0,
    width: 106,
    height: 143,
    left: '50%',
    marginLeft: -53,
    borderWidth: 3,
    borderColor: COLORS.PRIMARY,
    borderRadius: 11,
    zIndex: 1,
  },
  // Pinned "next capture" placeholder — After mode only. Sized
  // identically to a galleryItem (100 wide, padding for label + date
  // rows) and anchored to the dead center of the strip area. Real
  // photos in the ScrollView slide past behind it; the spacer slot
  // in the photos array keeps snap math correct.
  pinnedPlaceholder: {
    position: 'absolute',
    // 100 wide matches a real thumbnail's content rect (the 3 px
    // border is transparent so it doesn't need covering). Height
    // matches the full galleryItem so labels under the date row
    // can't peek beneath the placeholder either.
    top: 0,
    width: 100,
    height: 143,
    left: '50%',
    marginLeft: -50,
    alignItems: 'center',
    paddingTop: 3,
    zIndex: 5,
    elevation: 5,
  },
  // Wrapper that hosts both the center-frame border AND the After-
  // mode "Match" / "Match Before" badge. Sized + positioned identically
  // to galleryCenterFrame; the border is rendered as an inner View so
  // the badge can sit as a sibling and attach to the border edge.
  galleryCenterFrameWrap: {
    position: 'absolute',
    top: 36,
    width: 106,
    height: 106,
    left: '50%',
    marginLeft: -53,
    zIndex: 2,
  },
  galleryCenterFrameBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 3,
    borderColor: COLORS.PRIMARY,
    borderRadius: 11,
  },
  // Top-LEFT corner tag mounted INSIDE the thumbnail / placeholder
  // box. top:0 / left:0 anchors the badge at the inside corner of
  // the surrounding 3 px transparent (or dashed) border, so the
  // badge's top + left edges sit flush against the inner edges of
  // the border. Bottom-right corner is slightly rounded so the
  // badge reads as a clipped corner tag rather than a square chip.
  // Width is bounded by the 100 px thumbnail; text size is dialed
  // in so the longer "Match Before" still fits.
  // Match tag clipped to the TOP-LEFT corner of the centered real
  // thumbnail. Straddles the upper border — bottom half overlaps the
  // photo's top area, top half sticks above. Left edge sits ~3 px
  // outside the photo's left edge so it visually "clips" the corner.
  // Match tag clipped to the TOP-LEFT corner of the centered real
  // thumbnail. Anchored top:0 / left:0 INSIDE the photo area so the
  // badge's top + left edges sit flush against the inner edges of
  // the yellow border. Bottom-right corner rounded so it reads as a
  // clipped corner tag instead of a square chip. Previous straddle
  // (top:-16) got clipped by the ScrollView's viewport — keeping the
  // badge inside the thumbnail box guarantees it always renders.
  matchCorner: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#F2C31B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderBottomRightRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
    zIndex: 6,
  },
  matchCornerText: {
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '800',
  },
  // Match Before — promoted to a HEADER-ROW button at the TOP-RIGHT
  // of the gallery panel (mirroring "Set N" on the left, where the
  // user circled in red). Renders inside galleryHeaderRow, absolutely
  // positioned so it doesn't interfere with the centered chevron.
  // Always tappable in After mode regardless of which thumbnail is
  // currently centered.
  matchBeforeHeaderBtn: {
    position: 'absolute',
    right: 12,
    top: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F2C31B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
    zIndex: 6,
  },
  matchBeforeHeaderBtnText: {
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '800',
  },
  // Record Audio + Add Note row beneath the thumbnail strip in the
  // half-screen view. Both buttons share a chrome that mirrors the
  // brand yellow outline on a dark fill so they read clearly over
  // the gallery panel without competing with the photos above.
  notesAudioRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    // 10 px gap between the bottom of these pills and the top of the
    // capture row (buttonContainer minHeight matches button height,
    // so there's no extra empty space below this padding).
    paddingBottom: 10,
    gap: 12,
  },
  notesAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#F2C31B',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  notesAudioBtnText: {
    color: '#F2C31B',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  // Add Note modal — centered card with a multiline text input and
  // Cancel/Save actions. Save calls updatePhoto({ note }) on the
  // targeted photo so the note persists in the photo metadata for
  // the report.
  noteModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  noteModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1A1A1A',
    borderRadius: 18,
    padding: 20,
  },
  noteModalTitle: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  noteModalInput: {
    minHeight: 120,
    maxHeight: 240,
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    backgroundColor: '#262626',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  noteModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  noteModalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
  },
  noteModalBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  galleryItem: {
    borderRadius: 8,
    // overflow: visible so the Match / Match Before corner tag can
    // straddle the top border (extends ~10 px above the thumbnail).
    // Image + placeholder children get their own inner borderRadius
    // so rounded corners are preserved without the parent clipping.
    overflow: 'visible',
    borderWidth: 3,
    borderColor: 'transparent',
    width: 100,
    alignSelf: 'flex-start'
  },
  // Small yellow badge in the top-right corner of a Before-mode
  // strip thumbnail, showing how many photos exist in that set
  // (1 = Before only, 2 = Before + After, etc.).
  galleryItemCountBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 4,
  },
  galleryItemCountText: {
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '800',
  },
  // Yellow "Match" label — After-mode strip thumbnail, top-left
  // corner. Marks the photo that the camera ghost overlay (and the
  // corner circle thumbnail) are currently mirroring.
  matchLabelBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: '#F2C31B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 4,
  },
  matchLabelText: {
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '800',
  },
  // "Match Before" return button — sits inside the After-mode
  // placeholder card under the camera icon. Tapping snaps the strip
  // to index 0 so the Before becomes the centered / ghost source.
  matchBeforeBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: '#F2C31B',
    borderRadius: 4,
  },
  matchBeforeBtnText: {
    color: '#000',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9,
    fontWeight: '800',
  },
  // Top-center label inside the enlarged carousel slide showing
  // "Set N Before" / "Set N Progress X" / "Set N After". Floats on
  // top of the photo with a translucent dark chip so it reads on any
  // background.
  enlargedPhotoTopLabel: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  enlargedPhotoTopLabelText: {
    color: '#FFFFFF',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  galleryItemSelected: {
    borderColor: COLORS.PRIMARY
  },
  galleryImage: {
    width: 100,
    height: 100,
    backgroundColor: '#333',
    // Inner radius = outer (8) - border (3). Preserves the rounded
    // photo corners now that galleryItem no longer overflow:hidden.
    borderRadius: 5,
  },
  // "Next set" placeholder tile shown at the end of the Before-mode
  // strip. Sized identically to galleryImage so it lines up with the
  // active-slot frame. Dashed border + camera icon read as "the next
  // capture lands here".
  galleryPlaceholderItem: {
    width: 100,
    height: 100,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderStyle: 'dashed',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryItemName: {
    fontFamily: FONTS.ALEXANDRIA,
    // color set inline via theme.textPrimary so the name reads on
    // both light + dark panel surfaces.
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 1,
    width: 100,
  },
  // Capture-time line that sits right below the name. Smaller font +
  // secondary color so the name remains the dominant label. Width
  // matches the thumbnail so long timestamps clip cleanly.
  galleryItemDate: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 4,
    paddingTop: 0,
    paddingBottom: 4,
    width: 100,
  },
  galleryEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40
  },
  galleryEmptyText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.GRAY,
    fontSize: 14,
    fontStyle: 'italic'
  },
  // Enlarged gallery carousel styles (bottom 40%)
  enlargedGalleryContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderWidth: 3,
    borderColor: COLORS.PRIMARY,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    zIndex: 250,
    elevation: 250
  },
  // Single style for every enlarged-gallery control button (back, share,
  // edit, delete). Light/dark colors are passed in via inline `backgroundColor`
  // so the same shape works in both themes.
  enlargedGalleryCtrlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 260,
  },
  enlargedGalleryCtrlLeft: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  // Close-enlarged "back" button — sits at the top-right of the
  // enlarged container, immediately to the LEFT of the per-slide
  // trash button so the two form a top-right action cluster.
  // Trash is at right: 10; this sits at right: 56 (36 button + 10 gap).
  enlargedGalleryCtrlBack: {
    position: 'absolute',
    top: 10,
    right: 56,
  },
  // Eye icon — top-left of the enlarged photo slide. Taps navigate
  // to the project's Photo Set preview screen, anchored to THIS
  // slide's photo via initialPhotoId so the preview lands on the
  // same photo the user was looking at.
  enlargedGalleryPhotoEye: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    zIndex: 5,
  },
  enlargedGalleryCtrlRight: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    gap: 8,
    zIndex: 260,
  },
  // Side navigation arrows centered vertically over the enlarged
  // carousel. Visible only when there is somewhere to go in that
  // direction (computed from enlargedGalleryIndex).
  enlargedGalleryArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    zIndex: 270,
  },
  // The pager wraps each photo in a card that's narrower than the
  // outer wrapper by PEEK (18) + GAP (12) on each side — so 30 px in
  // from the wrapper edges. Sitting the chevrons at 30+8 px puts them
  // ON the photo itself (just inside its edge), matching the project
  // detail screen's arrow placement instead of floating in the peek
  // strip outside the card.
  enlargedGalleryArrowLeft: {
    left: 38,
  },
  enlargedGalleryArrowRight: {
    right: 38,
  },
  // "Next photo" placeholder card inside the enlarged carousel. Sized
  // identically to enlargedGalleryImage so the dashed box fills the
  // pager slot. Matches the small-strip placeholder visually.
  enlargedGalleryPlaceholder: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centered title bar above the enlarged pager — reads
  // "Kitchen Before Set 1" / "Kitchen After Set 2" etc. Pulled out
  // of pointerEvents so it never blocks the back button or pager.
  enlargedGalleryTitleRow: {
    position: 'absolute',
    top: 10,
    left: 60,
    right: 60,
    zIndex: 250,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enlargedGalleryTitleText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Trash icon overlaid on the top-right of each card in the enlarged
  // pager. Per-card so it always targets the visible photo.
  enlargedGalleryPhotoTrash: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    zIndex: 270,
  },
  enlargedGallerySlide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  enlargedGalleryImage: {
    width: '100%',
    height: '100%'
  },
  // Full-screen photo styles (entire screen)
  fullScreenPhotoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 300,
    elevation: 300
  },
  fullScreenPhotoImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenPhotoName: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    color: COLORS.PRIMARY,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 12,
    paddingHorizontal: 20
  },
  // Room transition indicator (shows briefly when switching rooms)
  roomTransitionIndicator: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    zIndex: 500,
    pointerEvents: 'none'
  },
  roomTransitionCard: {
    width: 120,
    height: 120,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8
  },
  roomTransitionIcon: {
    fontSize: 48
  },
  roomTransitionName: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center'
  },
  // Orientation toggle styles (replaces save button in before mode)
  orientationToggle: {
    position: 'absolute',
    right: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    transform: [{ rotate: '90deg' }],
    justifyContent: 'center',
    alignItems: 'center'
  },
  orientationToggleIcon: {
    transform: [{ rotate: '-90deg' }]
  },
  orientationToggleText: {
    fontSize: 24
  },
  // Letterbox styles for landscape camera mode
  letterboxContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  letterboxContainerLandscape: {
    flexDirection: 'row'
  },
  letterboxBar: {
    width: '100%',
    backgroundColor: '#000',
    flex: 1
  },
  letterboxBarHorizontal: {
    height: '100%',
    backgroundColor: '#000',
    flex: 1
  },
  letterboxCamera: {
    // Portrait device: the camera output (after vision-camera rotates
    // the sensor frame to match the device) is 3:4 portrait. The box
    // matches that ratio (3/4 = 0.75) so the preview fills it exactly
    // — no cover-crop zoom. The captured photo also reads as 3:4
    // portrait, mirroring how iOS native Camera behaves in 4:3 mode
    // when the phone is held vertically.
    width: '100%',
    aspectRatio: 0.75,
    position: 'relative',
    overflow: 'hidden',
  },
  letterboxCameraLandscape: {
    // Landscape device: sensor output is 4:3 landscape, box matches.
    width: undefined,
    height: '100%',
    aspectRatio: 1.333,
  },
  camera: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  // Hidden view for adding labels to photos
  hiddenLabelView: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
  hiddenLabelImage: {
    width: '100%',
    height: '100%'
  },
  androidCameraWrapper: {
    width: '100%',
    aspectRatio: 0.5625, // 9/16 = 0.5625
    overflow: 'hidden',
    alignSelf: 'center',
  },
  // Zoom row (design 07): preset chips sit inside one continuous
  // translucent-dark capsule, like the format switch on the other side.
  // No marginTop here — must stay vertically aligned with the aspect
  // ratio cluster on the opposite side of controlsRowAboveCapture. The
  // breathing room above the row when the thumbnail gallery is open is
  // added inline via `zoomControlsBottomWithGallery` instead.
  zoomControlsBottom: {
    flexDirection: 'row',
    gap: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 999,
    padding: 3,
  },
  zoomControlsBottomWithGallery: {
    marginTop: 28,
  },
  // Used only while the enlarged gallery is open — relocates the zoom
  // chips out of the bottom row (which sits underneath the enlarged
  // photo) and onto the lower edge of the shrunk camera viewfinder.
  // Two clusters: aspect ratio on the LEFT (Before mode only), zoom on
  // the RIGHT — same layout as the full-camera bottom row.
  floatingZoomRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Above the enlarged carousel container (zIndex 250) so the
    // chips stay tappable + visible when that panel is open.
    zIndex: 265,
    elevation: 265,
  },
  // Same translucent-dark capsule as zoomControlsBottom — chips inside
  // are transparent and the cluster provides the visual container, so
  // the floating row matches the full-camera bottom row.
  floatingZoomCluster: {
    flexDirection: 'row',
    gap: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 999,
    padding: 3,
  },
  // Each zoom chip: transparent inside the host capsule, snug 30-px
  // minWidth so multiple presets fit. No border (the capsule provides
  // the visual container). Per design 07 the active preset just paints
  // its label yellow inline — no background, no scale, no ring — so
  // "1×" reads as the only yellow glyph in the row.
  zoomButtonBottom: {
    backgroundColor: 'transparent',
    alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 999,
    minWidth: 30,
    height: 26,
    paddingHorizontal: 6,
  },
  zoomButtonBottomActive: {
    backgroundColor: 'transparent',
  },
  zoomButtonBottomText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  zoomButtonBottomTextActive: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 12,
    fontWeight: '800',
  },
  galleryPickerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
   checkmarkButtonBorder: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
   checkmarkButton: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  // Ghost overlay opacity slider — vertical column on the right edge.
  // The Slider widget itself is rotated 90deg so a horizontal slider
  // reads vertically: up = max opacity, down = 0.
  ghostSliderContainer: {
    position: 'absolute',
    right: 8,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  ghostSliderPill: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 24,
    paddingHorizontal: 4,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '100%',
    width: 40,
  },
  ghostSlider: {
    // Rotate +90deg so the slider's natural left-to-right axis becomes
    // top-to-bottom: dragging the thumb DOWN raises the underlying
    // value, which (after the 1 - v inversion in JSX) RAISES ghost
    // opacity — i.e. shows more of the BEFORE picture. Width becomes
    // the visible vertical length after the rotation.
    transform: [{ rotate: '90deg' }],
    width: 220,
    height: 32,
  },
  // Landscape: pill spans the long edge of the screen as a horizontal
  // strip and the Slider keeps its native horizontal axis (no rotate).
  ghostSliderPillLandscape: {
    flexDirection: 'row',
    height: 40,
    width: undefined,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  ghostSliderLandscape: {
    flex: 1,
    height: 32,
    marginHorizontal: 8,
  },
  // Photo capture animation styles
  captureAnimationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    elevation: 2000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureAnimationImage: {
    width: '100%',
    height: '70%',
    borderRadius: 8,
  },
});

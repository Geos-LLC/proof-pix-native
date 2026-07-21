// Off-screen view that bakes Studio's live JS overlays into a flat JPG
// for report rendering. Mounted at the app root so it survives nav
// changes; subscribes to chromeBakeService's job queue and processes
// one bake at a time.
//
// Why this exists:
//   The native compositor pipeline (PATH 1 / PATH 2 in
//   GlobalBackgroundLabelPreparation) only supports 4 corner positions
//   and can't render markup, brand logo, or metadata. Studio renders
//   labels at fractional offsets via PhotoLabels (JS) — which produces
//   the look the user expects in the report. To reproduce that look
//   without sending the React tree to a PDF engine, we render the
//   same overlays into a hidden View and captureRef it.
//
// What gets baked (in z-order, matching Studio's preview):
//   1. The combined Image at native pixel dimensions
//   2. PhotoLabels (BEFORE + AFTER on the appropriate halves)
//   3. PhotoWatermark
//   4. BrandLogoOverlay (if uploaded + toggle on)
//   5. MetadataOverlay (if toggle on)
//   6. PhotoMarkupOverlay (drawings/arrows/text saved on photo.markup)
//
// Everything reads from useScopedSettings(photo.id) so per-photo
// `overrides` win over global Settings — same cascade Studio uses.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Image, Text, Dimensions, StyleSheet } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import { useTranslation } from 'react-i18next';
import chromeBakeService from '../services/chromeBakeService';
import PhotoLabels from './PhotoLabels';
import PhotoWatermark from './PhotoWatermark';
import {
  BrandLogoOverlay,
  MetadataOverlay,
  PhotoMarkupOverlay,
} from './StudioOverlays';
import { useScopedSettings } from '../hooks/useScopedSettings';
import { useTheme } from '../hooks/useTheme';
import { usePhotos } from '../context/PhotoContext';
import { PHOTO_MODES, getLabelPositions } from '../constants/rooms';
import { FORMAT_ASPECTS } from '../constants/formats';
import {
  pickBeforeLabelPosition,
  pickAfterLabelPosition,
  pickBeforeLabelOffset,
  pickAfterLabelOffset,
} from '../utils/labelPosition';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Half-View styles — same geometry PhotoLabels uses internally. We
// re-implement them here so the baker can render two SEPARATE
// PhotoLabels components (one per source photo) inside each half,
// which lets each label read its own source photo's overrides.
const halves = StyleSheet.create({
  left:   { position: 'absolute', top: 0, bottom: 0, left: 0, width: '50%' },
  right:  { position: 'absolute', top: 0, bottom: 0, right: 0, width: '50%' },
  top:    { position: 'absolute', left: 0, right: 0, top: 0, height: '50%' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '50%' },
});

// Standalone label renderer for the bake. Replaces PhotoLabels here
// because PhotoLabel's reliance on @expo-google-fonts custom fonts
// (Alexandria etc.) doesn't always reach the off-screen captureRef
// layer in time, producing invisible text. Uses system bold and
// explicit fallback colors so the chip is always visible.
const bakeLabel = StyleSheet.create({
  box: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});

function BakeLabel({ role, settings, photo, isCombinedHalf }) {
  // Use the bake-level global settings — per-photo overrides via
  // useScopedSettings(sourceBefore.id) produced inconsistent results
  // across multiple combined photos in the same report (some labels
  // rendered, others didn't, depending on whether the source photo's
  // override cascade happened to leave a color/font/visibility key
  // in an invisible state at bake time). Global-only is predictable;
  // per-photo Studio drag overrides can come back as a refinement.
  const { t } = useTranslation();
  if (settings.showLabels === false) return null;
  const marginH = settings.labelMarginHorizontal ?? 10;
  const marginV = settings.labelMarginVertical ?? 10;

  // Delegate position + offset picking to the same helpers PhotoLabels
  // uses in the on-screen viewer so the shared JPG lands the label in
  // the same spot the user sees. Picker honors per-photo overrides,
  // landscape variants, and the single/combined cascade — the previous
  // inline resolver did none of that, which is why shared photos landed
  // in a different corner than the preview.
  const offset = role === 'after'
    ? pickAfterLabelOffset(settings, photo, isCombinedHalf)
    : pickBeforeLabelOffset(settings, photo, isCombinedHalf);
  const positionKey = role === 'after'
    ? pickAfterLabelPosition(settings, photo, isCombinedHalf)
    : pickBeforeLabelPosition(settings, photo, isCombinedHalf);

  const bg = settings.labelBackgroundColor || '#FFD700';
  const fg = settings.labelTextColor || '#000000';
  const useFreeform = offset && typeof offset.x === 'number' && typeof offset.y === 'number';

  // Translate the label using the user's chosen label language, mirroring
  // PhotoLabel. Fall back to English on missing key so translators can
  // ship incrementally without breaking the bake. labelLanguage defaults
  // to 'en' in SettingsContext, so unset users keep English.
  const labelKey = role === 'after' ? 'common.after'
    : role === 'progress' ? 'common.progress'
    : 'common.before';
  const fallback = role === 'after' ? 'AFTER' : role === 'progress' ? 'PROGRESS' : 'BEFORE';
  const text = t(labelKey, { lng: settings.labelLanguage || 'en', defaultValue: fallback });

  // Honor the corner-style toggle. 'rounded' is the app default and
  // renders as a full pill (borderRadius 999 collapses to a capsule
  // regardless of label width). 'square' keeps the legacy chip look.
  const isRounded = (settings.labelCornerStyle || 'rounded') !== 'square';
  const borderRadius = isRounded ? 999 : 6;

  // Non-freeform: use the SAME 9-position map PhotoLabel consumes
  // (getLabelPositions with the user's margins baked in). The previous
  // inline `cornerStyle` only covered 4 corners; anything else (e.g.
  // right-middle, center-top) silently fell back to left-top in the
  // bake. Spread the position style directly so the transform key
  // (used for center positions to translate(-50%,-50%)) survives.
  if (!useFreeform) {
    const positions = getLabelPositions(marginV, marginH);
    const posStyle = positions[positionKey] || positions['left-top'];
    // Strip the non-style metadata fields — RN warns on unknown style keys.
    const { name: _n, horizontalAlign: _h, verticalAlign: _v, ...coords } = posStyle;
    return (
      <View
        style={[bakeLabel.box, { position: 'absolute', ...coords }, { backgroundColor: bg, borderRadius }]}
        pointerEvents="none"
      >
        <Text style={[bakeLabel.text, { color: fg }]}>{text}</Text>
      </View>
    );
  }

  // Freeform: match PhotoLabels' LabelWithMargins exactly. Wrap in a
  // View inset by (marginH, marginV) on every edge; then place the
  // label at (x*100%, y*100%) inside THAT inset with a translate(-x*100%,
  // -y*100%) so offset {1,1} lands the label's right/bottom edge flush
  // with the inset's right/bottom (i.e. marginH/V away from the photo
  // frame). The previous implementation applied `marginHorizontal` /
  // `marginVertical` to the absolute label directly, which does nothing
  // in RN's abs-layout and put the label at 0/marginH from the RAW
  // frame edge — visibly off vs. the viewer.
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: marginV, bottom: marginV, left: marginH, right: marginH }}
    >
      <View
        pointerEvents="none"
        style={[
          bakeLabel.box,
          {
            position: 'absolute',
            left: `${offset.x * 100}%`,
            top: `${offset.y * 100}%`,
            transform: [
              { translateX: `${-offset.x * 100}%` },
              { translateY: `${-offset.y * 100}%` },
            ],
            backgroundColor: bg,
            borderRadius,
          },
        ]}
      >
        <Text style={[bakeLabel.text, { color: fg }]}>{text}</Text>
      </View>
    </View>
  );
}

// Resolve the combined photo's layout — STACK = before on top / after
// on bottom; SIDE = before on left / after on right. Falls back to
// dimensions when metadata is missing.
const resolveLayout = (photo, width, height) => {
  const stored = photo?.combinedLayout;
  if (stored === 'STACK' || stored === 'stack') return 'stack';
  if (stored === 'SIDE' || stored === 'side') return 'side';
  return height > width ? 'stack' : 'side';
};

// Mirror Studio's pairResolved logic — finds the SOURCE before/after
// photos for a combined target. The user's Studio drags persist label
// overrides on these source photos (not on the combined), so the bake
// has to render labels scoped to them or freeform offsets get lost.
const resolveSourcePair = (combined, allPhotos) => {
  if (!combined || !Array.isArray(allPhotos)) return { sourceBefore: null, sourceAfter: null };
  const findRawAfter = (bpid) =>
    allPhotos.find((p) => p.beforePhotoId === bpid && p.mode === PHOTO_MODES.AFTER);
  let sourceBefore = null;
  let sourceAfter = null;
  // 1) `combined_<beforeId>` id convention used by CameraScreen.
  const idStr = String(combined.id || '');
  if (idStr.startsWith('combined_')) {
    const beforeIdStr = idStr.slice('combined_'.length);
    sourceBefore = allPhotos.find((p) => String(p.id) === beforeIdStr) || null;
  }
  // 2) Fall back to name + room match (Android composite path).
  if (!sourceBefore && combined.name && combined.room) {
    sourceBefore = allPhotos.find(
      (p) => p.name === combined.name && p.room === combined.room && p.mode === PHOTO_MODES.BEFORE,
    ) || null;
  }
  // 3) Last resort — `combined.beforePhotoId` is set by the iOS path.
  if (!sourceBefore && combined.beforePhotoId) {
    sourceBefore = allPhotos.find((p) => String(p.id) === String(combined.beforePhotoId)) || null;
  }
  if (sourceBefore) sourceAfter = findRawAfter(sourceBefore.id) || null;
  // Honor Studio's swap overrides — when the user picked a different
  // Before / After in the Layout panel, those win over the natural pair.
  if (combined.beforeOverrideId) {
    const ov = allPhotos.find((p) => p.id === combined.beforeOverrideId);
    if (ov) sourceBefore = ov;
  }
  if (combined.afterOverrideId) {
    const ov = allPhotos.find((p) => p.id === combined.afterOverrideId);
    if (ov) sourceAfter = ov;
  }
  return { sourceBefore, sourceAfter };
};

// Inner component runs per-job so useScopedSettings can scope to the
// active photo's overrides. Mounting/unmounting per job is fine — each
// job ends with captureRef + cleanup, so the React tree churn is bounded.
function BakeJob({ photo, onComplete }) {
  const viewRef = useRef(null);
  const [bitmapSize, setBitmapSize] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const capturedRef = useRef(false);
  // Theme is consumed by some overlays (PhotoMarkupOverlay uses it for
  // shape styling). Reading it here keeps the off-screen render visually
  // identical to the on-screen Studio render.
  const theme = useTheme();
  const settings = useScopedSettings(photo.id);
  // Resolve the source before/after photos for combined targets so the
  // per-photo `overrides` Studio writes during a drag actually drive
  // the label position in the bake.
  const { photos: allPhotos } = usePhotos();
  const isCombined = photo.mode === PHOTO_MODES.COMBINED || photo.mode === 'mix';
  const { sourceBefore, sourceAfter } = useMemo(
    () => (isCombined ? resolveSourcePair(photo, allPhotos) : { sourceBefore: null, sourceAfter: null }),
    [isCombined, photo, allPhotos],
  );

  // Measure the source bitmap so the off-screen View matches its
  // intrinsic aspect ratio. Without this, label offsets land in the
  // wrong place because the photo gets stretched/letterboxed.
  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      photo.uri,
      (w, h) => {
        if (cancelled) return;
        if (w > 0 && h > 0) setBitmapSize({ w, h });
        else setBitmapSize({ w: 1080, h: 1080 });
      },
      (err) => {
        if (cancelled) return;
        console.warn('[ChromeBaker] Image.getSize FAIL', photo.id, String(err?.message || err));
        setBitmapSize({ w: 1080, h: 1080 });
      },
    );
    return () => { cancelled = true; };
  }, [photo.uri, photo.id]);

  // Capture once the image has loaded AND the bitmap size is known.
  // A short delay gives RN time to lay out the overlays (PhotoLabels
  // measures itself via onLayout). Skipping the delay produces a
  // bake with labels at (0,0) because the layout pass hasn't fired.
  useEffect(() => {
    if (!viewRef.current || !bitmapSize || !imageLoaded || capturedRef.current) return;
    capturedRef.current = true;
    const t = setTimeout(async () => {
      let outUri = null;
      try {
        const captured = await captureRef(viewRef, {
          format: 'jpg',
          quality: 0.95,
        });
        const filename = `chrome_baked_${photo.id}_${Date.now()}.jpg`;
        const docUri = `${FileSystem.documentDirectory}${filename}`;
        try {
          await FileSystem.copyAsync({ from: captured, to: docUri });
          outUri = docUri;
        } catch (e) {
          console.warn('[ChromeBaker] copy to docDir failed, using tmp uri:', e?.message);
          outUri = captured;
        }
      } catch (e) {
        console.warn('[ChromeBaker] captureRef FAILED', photo.id, String(e?.message || e));
      }
      onComplete(outUri);
    }, 600);
    return () => clearTimeout(t);
  }, [bitmapSize, imageLoaded, onComplete, photo.id]);

  if (!bitmapSize) return null;

  const { w, h } = bitmapSize;
  // Render-view target size. PhotoLabel reads `labelSize` from settings
  // as a raw pixel number sized for the on-screen Studio preview (~400-
  // 600 px wide). Baking at 2048 px made the label a 0.7%-of-width
  // speck — visually absent. We render the bake at ~800 px so the
  // label retains a reasonable visual proportion (1.5-3% of width), and
  // 800 px is still plenty for a PDF/HTML report; the image is embedded
  // as a data URI so smaller is better for memory.
  const TARGET_SIDE = 800;
  // Studio format wins over the bitmap's natural aspect: if the user
  // picked a chip in Studio (photo.pairTemplate), the bake matches that
  // frame so downstream share / report artifacts look identical to what
  // Studio showed. Falls back to the bitmap aspect when no format is
  // saved so pre-Studio photos still bake at their natural shape.
  const bitmapAspect = w / h;
  const formatAspect = FORMAT_ASPECTS[photo?.pairTemplate];
  const targetAspect = formatAspect || bitmapAspect;
  let renderW, renderH;
  if (targetAspect >= 1) {
    renderW = TARGET_SIDE;
    renderH = Math.max(1, Math.round(TARGET_SIDE / targetAspect));
  } else {
    renderH = TARGET_SIDE;
    renderW = Math.max(1, Math.round(TARGET_SIDE * targetAspect));
  }
  // Stack-vs-side is a property of the source bitmap (how before/after
  // were composited at capture), NOT of the Studio format. Keep this
  // computed from the raw w/h so labels land on the correct halves even
  // when the user picks a format aspect that differs from the source.
  const layout = resolveLayout(photo, w, h);

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={{
        width: renderW,
        height: renderH,
        backgroundColor: '#000',
        overflow: 'hidden',
      }}
    >
      <Image
        source={{ uri: photo.uri, cache: 'reload' }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
        onLoad={() => setImageLoaded(true)}
        onError={(e) => {
          console.warn('[ChromeBaker] Image onError', photo.id, String(e?.nativeEvent?.error || ''));
          setImageLoaded(true);
        }}
      />
      {/* Labels — inline BakeLabel reads the user's color + position
          settings (per-photo override on sourceBefore/sourceAfter, then
          global), but skips the custom-font path that was making
          PhotoLabels invisible in the captureRef layer. System bold. */}
      {isCombined ? (
        <>
          <View pointerEvents="none" style={layout === 'stack' ? halves.top : halves.left}>
            <BakeLabel
              role="before"
              settings={settings}
              photo={sourceBefore || photo}
              isCombinedHalf
            />
          </View>
          <View pointerEvents="none" style={layout === 'stack' ? halves.bottom : halves.right}>
            <BakeLabel
              role="after"
              settings={settings}
              photo={sourceAfter || photo}
              isCombinedHalf
            />
          </View>
        </>
      ) : (
        <BakeLabel role={photo.mode || 'before'} settings={settings} photo={photo} />
      )}
      {/* Watermark — same gate Studio uses. */}
      {settings.showWatermark && <PhotoWatermark photo={photo} />}
      {/* Brand logo — only when uploaded + toggle on. */}
      {settings.showBrandLogo && settings.brandLogoUri && (
        <BrandLogoOverlay
          uri={settings.brandLogoUri}
          position={settings.brandLogoPosition}
          size={settings.brandLogoSize}
          offset={settings.brandLogoOffset}
        />
      )}
      {/* Metadata — date / time / address / GPS string. */}
      {settings.showPreviewMetadata && (
        <MetadataOverlay
          photo={photo}
          location={settings.location}
          showDate={settings.metaShowDate}
          showTime={settings.metaShowTime}
          showAddress={settings.metaShowAddress}
          showGps={settings.metaShowGps}
          position={settings.metaPosition}
          color={settings.metaColor}
          opacity={settings.metaOpacity}
          fontSize={settings.metaFontSize}
          fontFamily={settings.metaFontFamily}
          offset={settings.metaOffset}
        />
      )}
      {/* Markup overlay — drawings/arrows/text saved on photo.markup. */}
      <PhotoMarkupOverlay photo={photo} theme={theme} />
    </View>
  );
}

// Per-job watchdog. If a bake doesn't complete inside WATCHDOG_MS
// (Image.getSize / onLoad never fired, captureRef wedged, etc.) we
// resolve with null so the queue advances and the report build doesn't
// hang. The caller's bakeChrome() converts a null result to the
// original photo.uri — report still renders, just without the chrome.
// 25s watchdog. The previous 8s was tripping when Image.getSize on
// a large JPEG took its time during memory pressure. 25s is generous
// without going past chromeBakeService's 90s service timeout.
const WATCHDOG_MS = 25000;

// Startup marker — fires once when the module is first imported on app
// boot. Shows up in the captured log so we can tell at a glance which
// OTA bundle is actually running (vs. asking the user to read an
// update ID). Bump the version literal each time you push so the log
// is unambiguous.
console.warn('[ChromeBaker] BUNDLE v10 — freeform label wraps in inset (matches viewer margins) + 9-position grid');

export default function GlobalBackgroundChromeBaker() {
  const [currentJob, setCurrentJob] = useState(null);
  // Synchronous mirror of currentJob — `handleComplete` and the
  // subscribe callback read this instead of React state to dodge the
  // "set state during render / inside another updater" race that
  // caused the second combined photo to never start baking.
  const currentJobRef = useRef(null);
  const watchdogRef = useRef(null);
  // One-shot mount log — confirms the component is alive in the tree.
  useEffect(() => {
    return undefined;
  }, []);

  // Pick the next job from the queue if the baker is idle. Single
  // source of advancement — every code path that might wake the baker
  // (initial mount, queue-changed notify, post-complete effect) ends
  // up here.
  const tryPickNext = useCallback(() => {
    if (currentJobRef.current) return;
    const jobs = chromeBakeService.getJobs();
    const next = jobs[0];
    if (next) {
      currentJobRef.current = next;
      setCurrentJob(next);
    }
  }, []);

  // Subscribe to service updates so new enqueues wake us up.
  useEffect(() => {
    const unsub = chromeBakeService.subscribe(tryPickNext);
    tryPickNext();
    return unsub;
  }, [tryPickNext]);

  // When currentJob clears, defer-then-advance so the unmount of the
  // previous BakeJob has flushed before the next one mounts. setTimeout(0)
  // is the simplest cross-platform "next tick".
  useEffect(() => {
    if (currentJob) return undefined;
    const t = setTimeout(tryPickNext, 0);
    return () => clearTimeout(t);
  }, [currentJob, tryPickNext]);

  const handleComplete = useCallback((bakedUri) => {
    const cur = currentJobRef.current;
    if (!cur) return;
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    try { cur.resolve(bakedUri); } catch (_) {}
    // Clear ref BEFORE finishJob — when finishJob's notify fires the
    // subscribe callback, tryPickNext sees an idle baker and picks the
    // next job (synchronously, no setState race). Then setState to
    // unmount the just-completed BakeJob component.
    currentJobRef.current = null;
    chromeBakeService.finishJob(cur.jobId);
    setCurrentJob(null);
  }, []);

  // Arm the watchdog when a new job starts; clear it when it completes.
  useEffect(() => {
    if (!currentJob) return undefined;
    watchdogRef.current = setTimeout(() => {
      console.warn(
        '[ChromeBaker] watchdog fired — bake stalled, advancing queue',
        currentJob.photo?.id,
      );
      handleComplete(null);
    }, WATCHDOG_MS);
    return () => {
      if (watchdogRef.current) {
        clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };
  }, [currentJob, handleComplete]);

  if (!currentJob) return null;

  // On-screen but invisible. captureRef on iOS needs the view to
  // actually rasterize — pushing it far off-screen (`left: SCREEN_WIDTH
  // + N`) lets RN skip the rasterization pass on some devices, which
  // is why the previous off-screen position produced empty bakes.
  // opacity 0.01 (not 0) plus zIndex below everything keeps it
  // invisible without flagging the renderer to skip it. pointerEvents
  // none so it can't intercept taps.
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        opacity: 0.01,
        zIndex: -1,
      }}
    >
      {/* key forces a fresh mount per job — without it, internal state
          (capturedRef, bitmapSize, imageLoaded) persists from the
          previous photo and captureRef bails out. */}
      <BakeJob key={currentJob.jobId} photo={currentJob.photo} onComplete={handleComplete} />
    </View>
  );
}

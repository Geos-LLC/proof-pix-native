// Singleton job queue for the chrome bake — the report-time step that
// renders a combined photo with the exact same JS overlays Studio uses
// (PhotoLabels at fractional offsets, PhotoWatermark, BrandLogoOverlay,
// MetadataOverlay, PhotoMarkupOverlay), then captureRef's the result so
// the report's HTML/PDF carries a flattened image that matches the
// Studio preview pixel-for-pixel.
//
// Why a queue, not a one-shot:
//   captureRef requires a mounted, laid-out View. The mounted baker
//   lives at the app root (GlobalBackgroundChromeBaker) so it survives
//   navigation. Multiple report regenerations may queue many jobs at
//   once — we serialize them one at a time to keep RAM in check (each
//   job holds a high-resolution bitmap until release).
//
// Persistent cache:
//   The chrome bake is expensive (~1-3s per photo). Without caching,
//   every report open re-bakes every combined photo, slowing the
//   "Generate" path to N × 1-3 s. We cache the baked URI per photo +
//   per label-settings hash so the second open is instant. Cache lives
//   in AsyncStorage; the baked JPGs sit in documentDirectory and
//   survive reinstall on iOS via the existing photo-doc backup path.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

// 90s service timeout. The previous 10s was tight under load: with N
// photos in the queue, photo N waits N × per-bake-time before the
// baker even starts, but its service timer starts the moment
// bakeChrome was called. 10s could fire on photo #5 in a 20-photo
// queue. 90s leaves enough headroom for a ~25-photo queue at the
// observed ~1-3s per bake while still bounding hung calls.
const SERVICE_TIMEOUT_MS = 90000;
const CACHE_KEY = 'chrome-bake-cache-v1';

class ChromeBakeService {
  constructor() {
    this.jobs = [];
    this.listeners = new Set();
    // In-memory mirror of the AsyncStorage cache so cache hits don't
    // pay an AsyncStorage round-trip on every report open. Loaded on
    // first call; subsequent calls read from this map synchronously.
    this.cache = null;
    this.cacheLoadPromise = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getJobs() {
    return [...this.jobs];
  }

  notify() {
    const snapshot = this.getJobs();
    for (const l of this.listeners) l(snapshot);
  }

  async loadCache() {
    if (this.cache) return this.cache;
    if (this.cacheLoadPromise) return this.cacheLoadPromise;
    this.cacheLoadPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(CACHE_KEY);
        this.cache = stored ? JSON.parse(stored) : {};
      } catch (e) {
        console.warn('[ChromeBake] cache load failed:', e?.message);
        this.cache = {};
      }
      return this.cache;
    })();
    return this.cacheLoadPromise;
  }

  async getCachedUri(cacheKey) {
    const cache = await this.loadCache();
    const entry = cache[cacheKey];
    if (!entry) return null;
    // Verify the file still exists. AsyncStorage can outlive
    // documentDirectory cleanup (e.g. user offloaded the app and
    // reinstalled). Stale entries get evicted lazily here.
    try {
      const info = await FileSystem.getInfoAsync(entry);
      if (info.exists) return entry;
      delete cache[cacheKey];
      this.persistCache();
    } catch (_) {
      // ignore — fall through to bake
    }
    return null;
  }

  async setCachedUri(cacheKey, uri) {
    const cache = await this.loadCache();
    cache[cacheKey] = uri;
    this.persistCache();
  }

  persistCache() {
    if (!this.cache) return;
    // Fire-and-forget — caller doesn't need to await the disk write.
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(this.cache)).catch((e) => {
      console.warn('[ChromeBake] cache persist failed:', e?.message);
    });
  }

  // Invalidate every cached entry for a photo (e.g. when its source
  // pair changes in Studio or the user re-takes the after shot). Hashes
  // come and go, but the prefix is always `${photoId}_`.
  async invalidatePhoto(photoId) {
    const cache = await this.loadCache();
    let changed = false;
    for (const key of Object.keys(cache)) {
      if (key.startsWith(`${photoId}_`)) {
        delete cache[key];
        changed = true;
      }
    }
    if (changed) this.persistCache();
  }

  // Stable, short hash of label-relevant settings. When the user
  // changes label color, position, etc., this changes and the cache
  // misses — forcing a re-bake. Watermark, brand logo, metadata are
  // intentionally NOT in the key because the bake doesn't render them
  // (yet); add them here when those layers come back.
  static labelSettingsHash(settings) {
    if (!settings) return 'g0';
    const off = (o) =>
      o && typeof o.x === 'number' && typeof o.y === 'number'
        ? `${o.x},${o.y}`
        : '';
    const parts = [
      // showLabels MUST be in the key — when the user toggles labels
      // off the bake should miss its previous-with-labels cache and
      // re-render without the chip. Without this, regenerate-after-
      // toggle returns the labeled photo from cache.
      settings.showLabels === false ? '0' : '1',
      settings.labelBackgroundColor || '',
      settings.labelTextColor || '',
      settings.labelMarginHorizontal ?? '',
      settings.labelMarginVertical ?? '',
      settings.beforeLabelPosition || '',
      settings.afterLabelPosition || '',
      off(settings.beforeLabelOffset),
      off(settings.afterLabelOffset),
      // Single-photo position/offset drive the BEFORE/AFTER/PROGRESS
      // chip on flat photos (now routed through this same baker).
      // Without these in the key, dragging the Single label to a new
      // corner would not invalidate the previous single-photo bakes.
      settings.singleLabelPosition || '',
      off(settings.singleLabelOffset),
      // Language + corner-style + landscape variants — the bake reads
      // these directly since the label-render fix routes through the
      // shared PhotoLabel logic. Without them in the hash, changing
      // labelLanguage or the pill/square toggle would keep serving the
      // stale English/square-corner bake from cache.
      settings.labelLanguage || '',
      settings.labelCornerStyle || '',
      // labelSize drives the bake's chip font + padding + border-radius
      // as of the proportional-scaling fix. Cache must miss when the
      // user changes size, or the shared JPG keeps the previous scale.
      settings.labelSize ?? '',
      settings.beforeLabelPositionLandscape || '',
      settings.afterLabelPositionLandscape || '',
      settings.singleLabelPositionLandscape || '',
      off(settings.beforeLabelOffsetLandscape),
      off(settings.afterLabelOffsetLandscape),
      off(settings.singleLabelOffsetLandscape),
    ];
    // djb2-ish hash → 8-char hex.
    let h = 5381;
    for (const p of parts) {
      const s = String(p);
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      }
    }
    return (h >>> 0).toString(16).slice(0, 8);
  }

  // Enqueue a bake. Returns a promise that resolves to the URI of the
  // baked file on disk. Cache-first: if we've baked this photo with
  // the same label settings before, resolve immediately.
  bakeChrome(photo, labelSettings) {
    if (!photo?.uri || !photo?.id) return Promise.resolve(photo?.uri || null);
    const settingsHash = ChromeBakeService.labelSettingsHash(labelSettings);
    // pairTemplate is part of the cache key so a Studio format change
    // (e.g. square → 16:9) misses the cache and re-bakes the photo at
    // the new aspect. As of the viewer-aspect-mirror fix, the bake's
    // targetAspect can also change based on photo.aspectRatio /
    // originalWidth/originalHeight when pairTemplate is unset — include
    // those so metadata edits force a re-bake instead of serving the
    // stale composition.
    const formatKey = photo.pairTemplate || 'auto';
    const aspectKey = [
      photo.aspectRatio ?? '',
      photo.originalWidth ?? '',
      photo.originalHeight ?? '',
    ].join(':');
    const cacheKey = `${photo.id}_${settingsHash}_${formatKey}_${aspectKey}`;

    return new Promise((resolve) => {
      // Cache hit short-circuits the entire queue/render path.
      this.getCachedUri(cacheKey).then((cachedUri) => {
        if (cachedUri) {
          resolve(cachedUri);
          return;
        }

        const jobId = `${photo.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        let settled = false;
        const finalize = (uri, reason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          this.jobs = this.jobs.filter((j) => j.jobId !== jobId);
          this.notify();
          if (reason !== 'baker-done' || !uri) {
            console.warn('[ChromeBake] resolve', jobId, 'reason', reason, 'uri', uri ? String(uri).slice(-40) : 'null→fallback');
          }
          // Cache successful bakes (uri is a fresh chrome_baked_*.jpg
          // in documentDirectory). Skip fallback-to-original — those
          // are NOT the labeled version we want to serve next time.
          if (uri && uri !== photo.uri && reason === 'baker-done') {
            this.setCachedUri(cacheKey, uri).catch(() => {});
          }
          resolve(uri || photo.uri);
        };

        const timeoutId = setTimeout(() => {
          console.warn('[ChromeBake] SERVICE TIMEOUT', jobId, 'photo', photo.id);
          finalize(null, 'service-timeout');
        }, SERVICE_TIMEOUT_MS);

        this.jobs.push({
          jobId,
          photo,
          resolve: (uri) => finalize(uri, 'baker-done'),
        });
        this.notify();
      });
    });
  }

  finishJob(jobId) {
    const had = this.jobs.some((j) => j.jobId === jobId);
    this.jobs = this.jobs.filter((j) => j.jobId !== jobId);
    if (had) this.notify();
  }
}

const chromeBakeService = new ChromeBakeService();
export default chromeBakeService;

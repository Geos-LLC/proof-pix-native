// Layout-aware in-app preview of a report. Mirrors the HTML layout
// engine's structure using React Native primitives so the user can see
// roughly what the shared report will look like without leaving the
// app. Not pixel-perfect with the HTML — that needs a WebView and
// thus a native build — but covers the shape, grouping, and photo
// arrangement for each of the six layout types.

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  groupByRoom,
  groupBySet,
  groupByDateThenRoom,
  sortByTime,
  splitByMode,
  pairBeforeAfter,
  tsOf,
  formatShortStamp,
  formatLongDate,
} from '../reports/layouts/_shared.js';
import { resolveOptions } from '../reports/index.js';

const PHOTO_MODE_COMBINED = 'mix';

// YIQ luminance — pick black or white text so the chip stays legible
// no matter what brand color the user picks.
const contrastText = (bgHex) => {
  const hex = String(bgHex || '').replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return '#FFFFFF';
  return ((r * 299 + g * 587 + b * 114) / 1000) >= 140 ? '#1A1A1A' : '#FFFFFF';
};

const MODE_CHIP = {
  before: 'BEFORE',
  after: 'AFTER',
  progress: 'PROGRESS',
  mix: 'BEFORE & AFTER',
};

const SectionHeader = ({ name, theme }) => (
  <Text style={[styles.sectionTitle, { color: theme.textPrimary, borderBottomColor: theme.border }]}>
    {name}
  </Text>
);

// Photo cell for previews. Chips and watermark overlays were removed
// once the report pipeline started feeding baked photo URIs (the
// editor's bake already composites label + watermark into the
// image). The optional `label` prop now drops because the baked
// image carries it; we keep `timestamp` since the bake doesn't.
const PhotoSlot = ({ uri, theme, missing, timestamp }) => (
  <View style={[styles.slot, { borderColor: theme.border, backgroundColor: theme.surface }]}>
    {uri ? (
      <Image source={{ uri }} style={styles.slotImage} resizeMode="cover" />
    ) : (
      <View style={[styles.slotImage, styles.slotPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
        <Ionicons name="image-outline" size={28} color={theme.textMuted} />
        <Text style={[styles.slotMissing, { color: theme.textMuted }]}>
          {missing || 'Image unavailable'}
        </Text>
      </View>
    )}
    {timestamp ? (
      <View style={styles.tsOverlay}>
        <Text style={styles.overlayText}>{timestamp}</Text>
      </View>
    ) : null}
  </View>
);

const Note = ({ note, theme }) => (
  note ? (
    <View style={[styles.note, { backgroundColor: theme.surface }]}>
      <Text style={[styles.noteText, { color: theme.textPrimary }]}>{note}</Text>
    </View>
  ) : null
);

// ---------------------------------------------------------------
// ROOM BY ROOM
// ---------------------------------------------------------------
const RoomByRoomPreview = ({ photos, options, displayRoomName, theme, chipBg, chipText }) => {
  const groups = groupByRoom(photos);
  if (groups.length === 0) return <Empty theme={theme} />;
  return (
    <View>
      {groups.map(({ room, photos: roomPhotos }) => {
        const { before, after, progress } = splitByMode(roomPhotos);
        const firstBefore = sortByTime(before)[0] || null;
        const latestAfter = sortByTime(after).slice(-1)[0] || null;
        if (!firstBefore && !latestAfter && progress.length === 0) return null;
        return (
          <View key={`room-${room}`} style={styles.section}>
            <SectionHeader name={displayRoomName(room)} theme={theme} />
            <View style={styles.pairRow}>
              <PhotoSlot uri={firstBefore?.uri} label="BEFORE" theme={theme} missing="No before" chipBg={chipBg} chipText={chipText} />
              <PhotoSlot uri={latestAfter?.uri} label="AFTER" theme={theme} missing="No after" chipBg={chipBg} chipText={chipText} />
            </View>
            {options.includeProgressPhotos && progress.length > 0 && (
              <View style={styles.progressRow}>
                {sortByTime(progress).slice(0, 4).map((p) => (
                  <View key={p.id} style={styles.progressTile}>
                    {p.uri ? <Image source={{ uri: p.uri }} style={styles.progressThumb} /> : null}
                  </View>
                ))}
              </View>
            )}
            {options.includeNotes && firstBefore?.notes ? <Note note={firstBefore.notes} theme={theme} /> : null}
            {options.includeNotes && latestAfter?.notes ? <Note note={latestAfter.notes} theme={theme} /> : null}
          </View>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------
// BEFORE & AFTER (prefers combined photos)
// ---------------------------------------------------------------
// Render the combined photo's URI flat — no PhotoLabels, no
// PhotoWatermark, no MetadataOverlay. The report pipeline feeds a
// baked URI that already has whatever labels/watermark/timestamps
// the user chose; layering more chrome on top duplicates them.
const BeforeAfterPreview = ({ photos, options, displayRoomName, theme }) => {
  // Mirror the HTML layout: ONLY combined ('mix') photos. Don't
  // synthesize fresh before/after pairs from raw photos — sets that
  // don't have a combined are intentionally omitted.
  const groups = groupByRoom(photos);
  const visible = groups
    .map(({ room, photos: roomPhotos }) => ({
      room,
      combinedPhotos: sortByTime(roomPhotos.filter((p) => p.mode === PHOTO_MODE_COMBINED)),
    }))
    .filter((g) => g.combinedPhotos.length > 0);
  if (visible.length === 0) return <Empty theme={theme} />;
  return (
    <View>
      {visible.map(({ room, combinedPhotos }) => (
        <View key={`room-${room}`} style={styles.section}>
          <SectionHeader name={displayRoomName(room)} theme={theme} />
          {combinedPhotos.map((c) => {
            const w = c.originalWidth || c.width;
            const h = c.originalHeight || c.height;
            const aspect = (w && h) ? (w / h) : (16 / 9);
            return (
              <View key={`combined-${c.id}`} style={[styles.combinedHero, { aspectRatio: aspect }]}>
                {c.uri ? (
                  <Image
                    source={{ uri: c.uri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : null}
              </View>
            );
          })}
          {/* Notes rendered outside the photo frame so they don't
              overlay the image. */}
          {options.includeNotes && combinedPhotos.map((c) => (
            c.notes ? <Note key={`n-${c.id}`} note={c.notes} theme={theme} /> : null
          ))}
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------
// TIMELINE
// ---------------------------------------------------------------
const TIMELINE_STAGE_LABEL = {
  before: 'Before',
  progress: 'Progress',
  after: 'After',
  mix: 'Combined',
};
const TimelinePreview = ({ photos, options, displayRoomName, theme, chipBg, watermarkText }) => {
  const days = groupByDateThenRoom(photos);
  const cols = clampSetCols(options.timelineColumns);
  const showTimestamp = options.includeMetadata === true;
  return (
    <View>
      {days.map((day) => {
        const total = day.rooms.reduce((acc, r) => acc + r.photos.length, 0);
        const dayLabel = formatLongDate(day.ts);
        return (
          <View key={`day-${day.dateKey}`} style={styles.timelineDay}>
            <View style={[styles.timelineDayHeader, { borderBottomColor: chipBg || theme.accent }]}>
              <Text style={[styles.timelineDayDate, { color: theme.textPrimary }]}>{dayLabel}</Text>
              <Text style={[styles.timelineDayCount, { color: theme.textSecondary }]}>
                {total} {total === 1 ? 'photo' : 'photos'}
              </Text>
            </View>
            {day.rooms.map((r) => (
              <View key={`room-${day.dateKey}-${r.room}`} style={styles.timelineRoomBlock}>
                <Text style={[styles.timelineRoomName, { color: theme.textSecondary }]}>
                  {displayRoomName(r.room).toUpperCase()}
                </Text>
                <View style={styles.setGrid}>
                  {r.photos.map((p) => (
                    <View key={p.id} style={[styles.setCell, { width: `${100 / cols}%` }]}>
                      <View style={[styles.timelineGridCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                        <View style={[styles.timelineGridWhen, { borderBottomColor: chipBg || theme.accent }]}>
                          <Text style={[styles.timelineStamp, { color: theme.textSecondary }]}>
                            {formatShortStamp(tsOf(p))}
                          </Text>
                          <Text style={[styles.timelineStage, { color: theme.textMuted }]}>
                            {(TIMELINE_STAGE_LABEL[p.mode] || 'Photo').toUpperCase()}
                          </Text>
                        </View>
                        <PhotoSlot
                          uri={p.uri}
                          theme={theme}
                          timestamp={showTimestamp ? formatShortStamp(tsOf(p)) : null}
                        />
                        {options.includeNotes && p.notes ? <Note note={p.notes} theme={theme} /> : null}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
};

// Sets — chronological + grouped by before/progress/after sets.
// Photos inside a set render in an N-column grid using a
// negative-margin trick so percentage widths fit exactly without
// the gap pushing the last column to wrap.
const clampSetCols = (n) => ([1, 2, 3].includes(Number(n)) ? Number(n) : 2);

const setRangeStampPreview = (set) => {
  const ps = [set.before, ...(set.progress || []), set.after, set.mix].filter(Boolean);
  const ts = ps.map(tsOf).filter((t) => t > 0);
  if (ts.length === 0) return '';
  const first = formatShortStamp(Math.min(...ts));
  const last = formatShortStamp(Math.max(...ts));
  return first === last ? first : `${first} → ${last}`;
};

const SetsPreview = ({ photos, options, displayRoomName, theme, chipBg, chipText, watermarkText }) => {
  const groups = groupByRoom(photos);
  const cols = clampSetCols(options.timelineColumns);
  const showTimestamp = options.includeMetadata === true;
  return (
    <View>
      {groups.map(({ room, photos: roomPhotos }) => {
        const sets = groupBySet(roomPhotos);
        if (sets.length === 0) return null;
        return (
          <View key={`room-${room}`} style={styles.section}>
            <SectionHeader name={displayRoomName(room)} theme={theme} />
            {sets.map((set, idx) => {
              const setPhotos = [
                ...(set.before ? [set.before] : []),
                ...sortByTime(set.progress || []),
                ...(set.after ? [set.after] : []),
                ...(set.mix ? [set.mix] : []),
              ];
              if (setPhotos.length === 0) return null;
              const stamp = setRangeStampPreview(set);
              return (
                <View
                  key={`set-${idx}`}
                  style={[styles.timelineSet, { borderLeftColor: chipBg || theme.accent }]}
                >
                  <Text style={[styles.timelineSetHeader, { color: theme.textSecondary }]}>
                    SET {idx + 1}
                  </Text>
                  {stamp ? (
                    <Text style={[styles.timelineSetStamp, { color: theme.textSecondary }]}>
                      {stamp}
                    </Text>
                  ) : null}
                  <View style={styles.setGrid}>
                    {setPhotos.map((p) => (
                      <View
                        key={p.id}
                        style={[styles.setCell, { width: `${100 / cols}%` }]}
                      >
                        <PhotoSlot
                          uri={p.uri}
                          label={MODE_CHIP[p.mode] || ''}
                          theme={theme}
                          chipBg={chipBg}
                          chipText={chipText}
                          timestamp={showTimestamp ? formatShortStamp(tsOf(p)) : null}
                          watermarkText={watermarkText || null}
                        />
                        {options.includeNotes && p.notes ? (
                          <Note note={p.notes} theme={theme} />
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------
// GALLERY
// ---------------------------------------------------------------
const GalleryPreview = ({ photos, options, theme, chipBg, chipText }) => {
  const cols = [2, 3, 4].includes(options.galleryColumns) ? options.galleryColumns : 3;
  const ordered = sortByTime(photos);
  return (
    <View style={[styles.galleryGrid, { gap: 4 }]}>
      {ordered.map((p) => (
        <View key={p.id} style={[styles.galleryTile, { width: `${(100 / cols) - 1}%` }]}>
          {p.uri ? <Image source={{ uri: p.uri }} style={styles.galleryThumb} /> : null}
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------
// EXECUTIVE SUMMARY
// ---------------------------------------------------------------
const ExecutivePreview = ({ photos, options, displayRoomName, theme, chipBg, chipText }) => {
  const groups = groupByRoom(photos);
  const ordered = sortByTime(photos);
  const cover = ordered.filter((p) => p.mode === 'after').slice(-1)[0] || ordered.slice(-1)[0] || null;
  const completedLabel = formatLongDate(cover ? tsOf(cover) : Date.now());
  return (
    <View>
      {cover && cover.uri ? (
        <View style={styles.coverWrap}>
          <Image source={{ uri: cover.uri }} style={styles.coverImage} resizeMode="cover" />
        </View>
      ) : null}
      <View style={styles.statsRow}>
        <Stat n={groups.length} label="SECTIONS" theme={theme} />
        <Stat n={photos.length} label="PHOTOS" theme={theme} />
        <Stat text={completedLabel} label="COMPLETED" theme={theme} />
      </View>
      <Text style={[styles.execHeading, { color: theme.textPrimary }]}>Highlights</Text>
      {groups.map(({ room, photos: roomPhotos }) => {
        const { pairs } = pairBeforeAfter(roomPhotos);
        const pair = pairs[0];
        if (pair) {
          return (
            <View key={`hl-${room}`} style={styles.section}>
              <SectionHeader name={displayRoomName(room)} theme={theme} />
              <View style={styles.pairRow}>
                <PhotoSlot uri={pair.before?.uri} label="BEFORE" theme={theme} chipBg={chipBg} chipText={chipText} />
                <PhotoSlot uri={pair.after?.uri} label="AFTER" theme={theme} chipBg={chipBg} chipText={chipText} />
              </View>
              {options.includeNotes && pair.after?.notes ? <Note note={pair.after.notes} theme={theme} /> : null}
            </View>
          );
        }
        const { before, after, progress } = splitByMode(roomPhotos);
        const fallback = after[0] || before[0] || progress[0];
        if (!fallback) return null;
        return (
          <View key={`hl-${room}`} style={styles.section}>
            <SectionHeader name={displayRoomName(room)} theme={theme} />
            {fallback.uri ? <Image source={{ uri: fallback.uri }} style={styles.coverImage} resizeMode="cover" /> : null}
          </View>
        );
      })}
    </View>
  );
};

const Stat = ({ n, text, label, theme }) => (
  <View style={[styles.statTile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
    {n != null ? (
      <Text style={[styles.statNum, { color: theme.textPrimary }]}>{n}</Text>
    ) : (
      <Text style={[styles.statText, { color: theme.textPrimary }]}>{text}</Text>
    )}
    <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{label}</Text>
  </View>
);

// ---------------------------------------------------------------
// DOCUMENTATION
// ---------------------------------------------------------------
const DocumentationPreview = ({ photos, options, displayRoomName, theme, chipBg, chipText }) => {
  const ordered = sortByTime(photos);
  if (ordered.length === 0) return <Empty theme={theme} />;
  return (
    <View>
      {ordered.map((p, idx) => {
        const rows = [];
        if (options.showLabels !== false && p.name) rows.push(['Label', p.name]);
        rows.push(['Section', displayRoomName(p.room || '')]);
        if (options.docShowCaptureTime !== false) {
          const stamp = formatShortStamp(tsOf(p));
          if (stamp) rows.push(['Captured', stamp]);
        }
        rows.push(['Mode', p.mode || '—']);
        if (options.docShowGps !== false) {
          const gps = typeof p.location === 'string' ? p.location.trim() : '';
          const coords = p.lat != null && p.lng != null
            ? `${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}`
            : '';
          const loc = coords || gps;
          if (loc) rows.push(['Location', loc]);
        }
        if (options.docShowDeviceMetadata) {
          const parts = [];
          if (p.originalWidth && p.originalHeight) parts.push(`${p.originalWidth} × ${p.originalHeight}`);
          if (p.aspectRatio) parts.push(`${p.aspectRatio}`);
          if (p.templateType) parts.push(p.templateType);
          if (parts.length) rows.push(['Capture', parts.join(' · ')]);
        }
        return (
          <View key={p.id} style={[styles.docEntry, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={styles.docPhotoWrap}>
              {p.uri ? <Image source={{ uri: p.uri }} style={styles.docPhoto} resizeMode="cover" /> : null}
            </View>
            <View style={{ flex: 1, padding: 8 }}>
              <Text style={[styles.docEntryTitle, { color: theme.textPrimary }]}>Entry {idx + 1}</Text>
              {rows.map(([k, v]) => (
                <View key={k} style={styles.docRow}>
                  <Text style={[styles.docRowKey, { color: theme.textSecondary }]}>{k.toUpperCase()}</Text>
                  <Text style={[styles.docRowValue, { color: theme.textPrimary }]} numberOfLines={2}>{String(v)}</Text>
                </View>
              ))}
              {options.includeNotes && p.notes ? <Note note={p.notes} theme={theme} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const Empty = ({ theme }) => (
  <View style={{ padding: 24, alignItems: 'center' }}>
    <Ionicons name="document-outline" size={32} color={theme.textMuted} />
    <Text style={{ color: theme.textSecondary, marginTop: 8, fontSize: 13 }}>
      No photos to preview.
    </Text>
  </View>
);

// ---------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------
export default function ReportPreviewView({ photos, layoutId, options, displayRoomName, theme, branding }) {
  const safePhotos = photos || [];
  // Run user options through the same merge that the HTML engine
  // uses so the preview honors per-layout defaults (e.g. timeline's
  // includeNotes: true). Without this, an unset switch reads as
  // falsey here but truthy in the rendered PDF — exactly the
  // "preview shows different thing than the file" issue.
  const opts = resolveOptions(layoutId || 'room-by-room', options || {});
  const chipBg = branding?.brandColor || null;
  const chipText = chipBg ? contrastText(chipBg) : null;
  const watermarkText = opts.includeWatermark ? (branding?.watermarkText || '') : '';
  const props = { photos: safePhotos, options: opts, displayRoomName, theme, chipBg, chipText, watermarkText };
  switch (layoutId) {
    case 'before-after':       return <BeforeAfterPreview {...props} />;
    case 'timeline':           return <TimelinePreview {...props} />;
    case 'sets':               return <SetsPreview {...props} />;
    case 'gallery':            return <GalleryPreview {...props} />;
    case 'executive-summary':  return <ExecutivePreview {...props} />;
    case 'documentation':      return <DocumentationPreview {...props} />;
    case 'room-by-room':
    default:                   return <RoomByRoomPreview {...props} />;
  }
}

const styles = StyleSheet.create({
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 14, fontWeight: '600',
    marginBottom: 8, paddingBottom: 4,
    borderBottomWidth: 1,
  },
  pairRow: { flexDirection: 'row', gap: 6 },
  slot: { flex: 1, aspectRatio: 1, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  slotImage: { width: '100%', height: '100%' },
  slotPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  slotMissing: { fontSize: 10 },
  slotTag: {
    position: 'absolute', top: 6, left: 6,
    paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4,
  },
  slotTagText: { color: '#FFF', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  tsOverlay: {
    position: 'absolute', bottom: 6, left: 6,
    paddingHorizontal: 5, paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3,
  },
  watermarkOverlay: {
    position: 'absolute', bottom: 6, right: 6,
    paddingHorizontal: 5, paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 3,
    maxWidth: '60%',
  },
  overlayText: { color: '#FFF', fontSize: 8, fontWeight: '600' },
  progressRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  progressTile: { width: 60, height: 60, borderRadius: 4, overflow: 'hidden' },
  progressThumb: { width: '100%', height: '100%' },
  note: { padding: 8, borderRadius: 6, marginTop: 6 },
  noteText: { fontSize: 12, lineHeight: 16 },
  combinedHero: { borderRadius: 8, overflow: 'hidden', marginBottom: 12, position: 'relative' },
  combinedHeroImage: { width: '100%', aspectRatio: 16 / 9 },
  timelineRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  timelineColumn: { width: 80, borderRightWidth: 2, paddingRight: 8, paddingTop: 4 },
  timelineStamp: { fontSize: 10 },
  timelineStage: { fontSize: 9, fontWeight: '700' },
  timelineCard: { flex: 1, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  timelineImage: { width: '100%', aspectRatio: 16 / 10 },
  timelineGridCard: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  timelineGridWhen: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 5, borderBottomWidth: 2,
  },
  timelineDay: { marginBottom: 20 },
  timelineDayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingBottom: 4, marginBottom: 10, borderBottomWidth: 2,
  },
  timelineDayDate: { fontSize: 15, fontWeight: '700' },
  timelineDayCount: { fontSize: 10 },
  timelineRoomBlock: { marginBottom: 14, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#ECECEC' },
  timelineRoomName: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4, marginBottom: 6 },
  timelineSet: { marginBottom: 16, paddingLeft: 10, borderLeftWidth: 2 },
  timelineSetHeader: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
  timelineSetStamp: { fontSize: 10, marginBottom: 6 },
  // Negative horizontal margin offsets each cell's padding so the
  // grid edges sit flush. With width = exactly 100/cols%, three
  // 33.33% cells fit a row without wrapping.
  setGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  setCell: { paddingHorizontal: 3, paddingVertical: 3 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  galleryTile: { aspectRatio: 1, marginBottom: 4 },
  galleryThumb: { width: '100%', height: '100%', borderRadius: 4 },
  coverWrap: { borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  coverImage: { width: '100%', aspectRatio: 16 / 9 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  statTile: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '700' },
  statText: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  statLabel: { fontSize: 9, letterSpacing: 0.8, marginTop: 2 },
  execHeading: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  docEntry: { flexDirection: 'row', gap: 8, borderRadius: 8, borderWidth: 1, marginBottom: 10, padding: 6 },
  docPhotoWrap: { width: 100, borderRadius: 6, overflow: 'hidden' },
  docPhoto: { width: '100%', height: '100%' },
  docEntryTitle: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  docRow: { flexDirection: 'row', paddingVertical: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ECECEC', gap: 6 },
  docRowKey: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4, width: 70 },
  docRowValue: { fontSize: 11, flex: 1 },
});

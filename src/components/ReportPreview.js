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
  sortByTime,
  splitByMode,
  pairBeforeAfter,
  tsOf,
  formatShortStamp,
  formatLongDate,
} from '../reports/layouts/_shared.js';

const PHOTO_MODE_COMBINED = 'mix';

const SectionHeader = ({ name, theme }) => (
  <Text style={[styles.sectionTitle, { color: theme.textPrimary, borderBottomColor: theme.border }]}>
    {name}
  </Text>
);

const PhotoSlot = ({ uri, label, theme, missing }) => (
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
    {label ? (
      <View style={styles.slotTag}>
        <Text style={styles.slotTagText}>{label}</Text>
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

const PhotoLabel = ({ name, theme }) => (
  name ? (
    <Text style={[styles.photoLabel, { color: theme.textSecondary }]}>{name}</Text>
  ) : null
);

// ---------------------------------------------------------------
// ROOM BY ROOM
// ---------------------------------------------------------------
const RoomByRoomPreview = ({ photos, options, displayRoomName, theme }) => {
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
              <PhotoSlot uri={firstBefore?.uri} label="BEFORE" theme={theme} missing="No before" />
              <PhotoSlot uri={latestAfter?.uri} label="AFTER" theme={theme} missing="No after" />
            </View>
            {options.showLabels !== false && (firstBefore?.name || latestAfter?.name) ? (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <View style={{ flex: 1 }}><PhotoLabel name={firstBefore?.name} theme={theme} /></View>
                <View style={{ flex: 1 }}><PhotoLabel name={latestAfter?.name} theme={theme} /></View>
              </View>
            ) : null}
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
const BeforeAfterPreview = ({ photos, options, displayRoomName, theme }) => {
  const groups = groupByRoom(photos);
  return (
    <View>
      {groups.map(({ room, photos: roomPhotos }) => {
        const combinedPhotos = sortByTime(roomPhotos.filter((p) => p.mode === PHOTO_MODE_COMBINED));
        const coveredBeforeIds = new Set(combinedPhotos.map((c) => c.beforePhotoId).filter(Boolean));
        const remainingPhotos = roomPhotos.filter((p) => {
          if (p.mode === PHOTO_MODE_COMBINED) return false;
          if (p.mode === 'before' && coveredBeforeIds.has(p.id)) return false;
          if (p.mode === 'after' && p.beforePhotoId && coveredBeforeIds.has(p.beforePhotoId)) return false;
          return true;
        });
        const { pairs } = pairBeforeAfter(remainingPhotos);
        if (combinedPhotos.length === 0 && pairs.length === 0) return null;
        return (
          <View key={`room-${room}`} style={styles.section}>
            <SectionHeader name={displayRoomName(room)} theme={theme} />
            {combinedPhotos.map((c) => (
              <View key={`combined-${c.id}`} style={styles.combinedHero}>
                {c.uri ? <Image source={{ uri: c.uri }} style={styles.combinedHeroImage} resizeMode="cover" /> : null}
                <View style={styles.slotTag}>
                  <Text style={styles.slotTagText}>BEFORE & AFTER</Text>
                </View>
                {options.showLabels !== false && c.name ? <PhotoLabel name={c.name} theme={theme} /> : null}
                {options.includeNotes && c.notes ? <Note note={c.notes} theme={theme} /> : null}
              </View>
            ))}
            {pairs.map(({ before, after }, idx) => (
              <View key={`pair-${idx}`} style={{ marginBottom: 12 }}>
                <View style={styles.pairRow}>
                  <PhotoSlot uri={before?.uri} label="BEFORE" theme={theme} missing="No before" />
                  <PhotoSlot uri={after?.uri} label="AFTER" theme={theme} missing="No after" />
                </View>
                {options.showLabels !== false && (before?.name || after?.name) ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <View style={{ flex: 1 }}><PhotoLabel name={before?.name} theme={theme} /></View>
                    <View style={{ flex: 1 }}><PhotoLabel name={after?.name} theme={theme} /></View>
                  </View>
                ) : null}
                {options.includeNotes && before?.notes ? <Note note={before.notes} theme={theme} /> : null}
                {options.includeNotes && after?.notes ? <Note note={after.notes} theme={theme} /> : null}
              </View>
            ))}
          </View>
        );
      })}
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
const TimelinePreview = ({ photos, options, displayRoomName, theme }) => {
  const groups = groupByRoom(photos);
  return (
    <View>
      {groups.map(({ room, photos: roomPhotos }) => {
        const ordered = sortByTime(roomPhotos);
        if (ordered.length === 0) return null;
        return (
          <View key={`room-${room}`} style={styles.section}>
            <SectionHeader name={displayRoomName(room)} theme={theme} />
            {ordered.map((p) => (
              <View key={p.id} style={styles.timelineRow}>
                <View style={[styles.timelineColumn, { borderRightColor: theme.accent }]}>
                  <Text style={[styles.timelineStamp, { color: theme.textSecondary }]}>
                    {formatShortStamp(tsOf(p))}
                  </Text>
                  <Text style={[styles.timelineStage, { color: theme.textMuted }]}>
                    {(TIMELINE_STAGE_LABEL[p.mode] || 'Photo').toUpperCase()}
                  </Text>
                </View>
                <View style={[styles.timelineCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  {p.uri ? <Image source={{ uri: p.uri }} style={styles.timelineImage} resizeMode="cover" /> : null}
                  {options.showLabels !== false && p.name ? <PhotoLabel name={p.name} theme={theme} /> : null}
                  {options.includeNotes && p.notes ? <Note note={p.notes} theme={theme} /> : null}
                </View>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
};

// ---------------------------------------------------------------
// GALLERY
// ---------------------------------------------------------------
const GalleryPreview = ({ photos, options, theme }) => {
  const cols = [2, 3, 4].includes(options.galleryColumns) ? options.galleryColumns : 3;
  const ordered = sortByTime(photos);
  return (
    <View style={[styles.galleryGrid, { gap: 4 }]}>
      {ordered.map((p) => (
        <View key={p.id} style={[styles.galleryTile, { width: `${(100 / cols) - 1}%` }]}>
          {p.uri ? <Image source={{ uri: p.uri }} style={styles.galleryThumb} /> : null}
          {options.showLabels !== false && p.name ? (
            <Text style={[styles.galleryLabel, { color: theme.textSecondary }]} numberOfLines={1}>{p.name}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------
// EXECUTIVE SUMMARY
// ---------------------------------------------------------------
const ExecutivePreview = ({ photos, options, displayRoomName, theme }) => {
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
                <PhotoSlot uri={pair.before?.uri} label="BEFORE" theme={theme} />
                <PhotoSlot uri={pair.after?.uri} label="AFTER" theme={theme} />
              </View>
              {options.showLabels !== false && (pair.before?.name || pair.after?.name) ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <View style={{ flex: 1 }}><PhotoLabel name={pair.before?.name} theme={theme} /></View>
                  <View style={{ flex: 1 }}><PhotoLabel name={pair.after?.name} theme={theme} /></View>
                </View>
              ) : null}
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
            {options.showLabels !== false && fallback.name ? <PhotoLabel name={fallback.name} theme={theme} /> : null}
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
const DocumentationPreview = ({ photos, options, displayRoomName, theme }) => {
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
export default function ReportPreviewView({ photos, layoutId, options, displayRoomName, theme }) {
  const safePhotos = photos || [];
  const opts = options || {};
  const props = { photos: safePhotos, options: opts, displayRoomName, theme };
  switch (layoutId) {
    case 'before-after':       return <BeforeAfterPreview {...props} />;
    case 'timeline':           return <TimelinePreview {...props} />;
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
  progressRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  progressTile: { width: 60, height: 60, borderRadius: 4, overflow: 'hidden' },
  progressThumb: { width: '100%', height: '100%' },
  note: { padding: 8, borderRadius: 6, marginTop: 6 },
  noteText: { fontSize: 12, lineHeight: 16 },
  photoLabel: { fontSize: 11, fontWeight: '600', marginTop: 4, paddingHorizontal: 2 },
  galleryLabel: { fontSize: 9, paddingHorizontal: 4, paddingBottom: 4, paddingTop: 2 },
  combinedHero: { borderRadius: 8, overflow: 'hidden', marginBottom: 12, position: 'relative' },
  combinedHeroImage: { width: '100%', aspectRatio: 16 / 9 },
  timelineRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  timelineColumn: { width: 80, borderRightWidth: 2, paddingRight: 8, paddingTop: 4 },
  timelineStamp: { fontSize: 10 },
  timelineStage: { fontSize: 9, marginTop: 2, fontWeight: '600' },
  timelineCard: { flex: 1, borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  timelineImage: { width: '100%', aspectRatio: 16 / 10 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  galleryTile: { marginBottom: 4 },
  galleryThumb: { width: '100%', aspectRatio: 1, borderRadius: 4 },
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

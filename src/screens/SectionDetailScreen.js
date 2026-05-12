import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS, ROOMS } from '../constants/rooms';
import CompareViewer from '../components/CompareViewer';
import CompareModeSwitcher from '../components/CompareModeSwitcher';
import PhotoLabel from '../components/PhotoLabel';
import { pickBeforeLabelPosition, pickAfterLabelPosition } from '../utils/labelPosition';

/**
 * Section / folder detail screen with two tabs:
 *
 *   Compare  — most recent before/after pair for this section, rendered with
 *              the v1.6.1 CompareViewer (overlay / split / side-by-side).
 *   Progress — timeline of progress photos grouped by date, with a primary
 *              "Add Progress Photo" CTA that launches Camera in single-shot
 *              progress mode.
 *
 * "Section" is the user-facing name; internally we still pass `sectionId`
 * which matches the existing room/folder id. The screen title uses the
 * section's display name (Kitchen / Section 1 / etc.) rather than the word
 * "Room", per the spec.
 */
export default function SectionDetailScreen({ route, navigation }) {
  const { sectionId, initialTab = 'compare' } = route.params || {};
  const { t } = useTranslation();
  const {
    getBeforePhotos,
    getAfterPhotos,
    getProgressPhotos,
  } = usePhotos();
  const settings = useSettings();
  const {
    showLabels,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    sectionLanguage,
    getRooms,
  } = settings;

  const [activeTab, setActiveTab] = useState(initialTab === 'progress' ? 'progress' : 'compare');
  const [compareMode, setCompareMode] = useState('split');

  // Resolve the display name for this section. Custom industry-seeded folders
  // carry their own `name`; legacy rooms (Kitchen, Bathroom, etc.) are
  // translated via the rooms.<id> key.
  const sectionName = useMemo(() => {
    const allRooms = (getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS) || ROOMS;
    const section = allRooms.find((r) => r.id === sectionId);
    if (!section) return sectionId || 'Section';
    return t(`rooms.${section.id}`, { lng: sectionLanguage, defaultValue: section.name });
  }, [sectionId, getRooms, sectionLanguage, t]);

  const beforePhotos = useMemo(() => getBeforePhotos ? getBeforePhotos(sectionId) : [], [getBeforePhotos, sectionId]);
  const afterPhotos = useMemo(() => getAfterPhotos ? getAfterPhotos(sectionId) : [], [getAfterPhotos, sectionId]);
  const progressPhotos = useMemo(() => getProgressPhotos ? getProgressPhotos(sectionId) : [], [getProgressPhotos, sectionId]);

  // Pick the most recent before/after pair for the Compare tab. We match by
  // beforePhotoId on the after photo when present; otherwise just pair the
  // newest of each. Unpaired before-only photos fall through to "no pair yet".
  const latestPair = useMemo(() => {
    if (!beforePhotos.length || !afterPhotos.length) return null;
    const byTime = (a, b) => (b.timestamp || 0) - (a.timestamp || 0);
    const afters = [...afterPhotos].sort(byTime);
    for (const after of afters) {
      const before = beforePhotos.find((b) => b.id === after.beforePhotoId);
      if (before) return { before, after };
    }
    // No explicit beforePhotoId link — fall back to newest of each.
    return { before: [...beforePhotos].sort(byTime)[0], after: afters[0] };
  }, [beforePhotos, afterPhotos]);

  // Group progress photos by local-date YYYY-MM-DD label for the timeline.
  const progressByDay = useMemo(() => {
    const groups = new Map();
    for (const p of progressPhotos) {
      const d = new Date(p.timestamp || Date.now());
      const key = d.toDateString();
      const arr = groups.get(key) || [];
      arr.push(p);
      groups.set(key, arr);
    }
    // Preserve insertion order (already newest-first from getProgressPhotos).
    return Array.from(groups.entries()).map(([day, items]) => ({ day, items }));
  }, [progressPhotos]);

  const handleAddProgress = () => {
    navigation.navigate('Camera', { mode: 'progress', room: sectionId });
  };

  const labelPosSettings = {
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: back / section name / overflow */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{sectionName}</Text>
        <View style={styles.headerIcon} />
      </View>

      {/* Tab bar: Compare / Progress */}
      <View style={styles.tabBar}>
        {[
          { key: 'compare', label: t('section.compareTab', { defaultValue: 'Compare' }) },
          { key: 'progress', label: t('section.progressTab', { defaultValue: 'Progress' }) },
        ].map(({ key, label }) => {
          const active = activeTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.tabPill, active && styles.tabPillActive]}
              onPress={() => setActiveTab(key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {activeTab === 'compare' ? (
        // Compare tab — most recent pair via the v1.6.1 viewer. Falls back
        // to a friendly empty state when this section has no completed
        // before/after pair yet.
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {latestPair ? (
            <>
              <CompareViewer
                beforePhoto={latestPair.before}
                afterPhoto={latestPair.after}
                mode={compareMode}
                renderBeforeOverlay={() => (showLabels ? (
                  <PhotoLabel
                    label="common.before"
                    position={pickBeforeLabelPosition(labelPosSettings, latestPair.before)}
                  />
                ) : null)}
                renderAfterOverlay={() => (showLabels ? (
                  <PhotoLabel
                    label="common.after"
                    position={pickAfterLabelPosition(labelPosSettings, latestPair.after)}
                  />
                ) : null)}
              />
              <CompareModeSwitcher
                mode={compareMode}
                onChange={setCompareMode}
                style={{ marginTop: 14 }}
              />
            </>
          ) : (
            <View style={styles.emptyCompare}>
              <Ionicons name="images-outline" size={48} color="#999" />
              <Text style={styles.emptyTitle}>{t('section.noPairTitle', { defaultValue: 'No before/after yet' })}</Text>
              <Text style={styles.emptySubtitle}>
                {t('section.noPairSubtitle', { defaultValue: 'Take a before photo, then an after photo to compare them here.' })}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        // Progress tab — primary CTA up top, then timeline grouped by date.
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.addProgressBtn} onPress={handleAddProgress} activeOpacity={0.85}>
            <Ionicons name="camera-outline" size={18} color="#000" style={{ marginRight: 8 }} />
            <Text style={styles.addProgressText}>
              {t('section.addProgress', { defaultValue: 'Add Progress Photo' })}
            </Text>
          </TouchableOpacity>

          {progressByDay.length === 0 ? (
            <View style={styles.emptyCompare}>
              <Ionicons name="time-outline" size={48} color="#999" />
              <Text style={styles.emptyTitle}>{t('section.noProgressTitle', { defaultValue: 'No progress photos yet' })}</Text>
              <Text style={styles.emptySubtitle}>
                {t('section.noProgressSubtitle', { defaultValue: 'Capture work-in-progress photos to build a timeline for this section.' })}
              </Text>
            </View>
          ) : (
            progressByDay.map(({ day, items }) => (
              <View key={day} style={styles.daySection}>
                <View style={styles.dayHeaderRow}>
                  <View style={styles.dayDot} />
                  <Text style={styles.dayLabel}>{formatDayLabel(day)}</Text>
                  <Text style={styles.dayCount}>
                    {items.length} {items.length === 1 ? 'photo' : 'photos'}
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
                  {items.map((photo) => (
                    <TouchableOpacity
                      key={photo.id}
                      style={styles.progressThumb}
                      onPress={() => navigation.navigate('PhotoDetail', { photo })}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: photo.uri }} style={styles.progressImg} resizeMode="cover" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Human-friendly day label. Today / Yesterday for the two most recent days,
// otherwise the locale long-form. Avoids pulling in a date library.
function formatDayLabel(dateString) {
  try {
    const d = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateString;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  headerIcon: { width: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: '#000' },

  tabBar: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginTop: 12,
    backgroundColor: '#F5F5F5',
    borderRadius: 999,
    padding: 4,
  },
  tabPill: {
    paddingVertical: 8,
    paddingHorizontal: 28,
    borderRadius: 999,
  },
  tabPillActive: { backgroundColor: COLORS.PRIMARY },
  tabText: { fontSize: 13, fontWeight: '600', color: '#555' },
  tabTextActive: { color: '#000' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  emptyCompare: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#222',
    marginTop: 14,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Add Progress button — yellow paywall-like CTA at the top of the
  // Progress tab. Tapping launches CameraScreen in progress mode.
  addProgressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7D1',
    borderColor: COLORS.PRIMARY,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 18,
  },
  addProgressText: { color: '#000', fontWeight: '700', fontSize: 14 },

  // Day section in the timeline.
  daySection: { marginBottom: 18 },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.PRIMARY,
    marginRight: 8,
  },
  dayLabel: { fontSize: 14, fontWeight: '700', color: '#000', flex: 1 },
  dayCount: { fontSize: 12, color: '#666' },

  dayRow: { paddingRight: 8 },
  progressThumb: {
    width: 96,
    height: 96,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: '#EEE',
  },
  progressImg: { width: '100%', height: '100%' },
});

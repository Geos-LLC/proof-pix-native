import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS, ROOMS } from '../constants/rooms';
import CompareViewer from '../components/CompareViewer';
import CompareModeSwitcher from '../components/CompareModeSwitcher';
import PhotoLabels from '../components/PhotoLabels';
import { useTheme } from '../hooks/useTheme';

/**
 * Section / folder detail screen — Compare-only.
 *
 * The Progress tab was removed because the Gallery now shows progress photos
 * inline in each set's horizontal row. The unified Take Photo capture flow
 * auto-promotes/demotes photos between the before/after/progress roles, so a
 * dedicated progress capture screen is no longer needed.
 *
 * What's left here: the v1.6.1 CompareViewer (overlay / split / side-by-side)
 * showing the latest before/after pair for this section. Routed to from the
 * Home card whole-card tap.
 */
export default function SectionDetailScreen({ route, navigation }) {
  const { sectionId } = route.params || {};
  const { t } = useTranslation();
  const {
    getBeforePhotos,
    getAfterPhotos,
  } = usePhotos();
  const settings = useSettings();
  const { sectionLanguage, getRooms } = settings;
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [compareMode, setCompareMode] = useState('split');

  const sectionName = useMemo(() => {
    const allRooms = (getRooms && typeof getRooms === 'function' ? getRooms() : ROOMS) || ROOMS;
    const section = allRooms.find((r) => r.id === sectionId);
    if (!section) return sectionId || 'Section';
    return t(`rooms.${section.id}`, { lng: sectionLanguage, defaultValue: section.name });
  }, [sectionId, getRooms, sectionLanguage, t]);

  const beforePhotos = useMemo(() => getBeforePhotos ? getBeforePhotos(sectionId) : [], [getBeforePhotos, sectionId]);
  const afterPhotos = useMemo(() => getAfterPhotos ? getAfterPhotos(sectionId) : [], [getAfterPhotos, sectionId]);

  // Latest before/after pair: prefer an after whose beforePhotoId matches an
  // existing before; otherwise fall back to newest of each.
  const latestPair = useMemo(() => {
    if (!beforePhotos.length || !afterPhotos.length) return null;
    const byTime = (a, b) => (b.timestamp || 0) - (a.timestamp || 0);
    const afters = [...afterPhotos].sort(byTime);
    for (const after of afters) {
      const before = beforePhotos.find((b) => b.id === after.beforePhotoId);
      if (before) return { before, after };
    }
    return { before: [...beforePhotos].sort(byTime)[0], after: afters[0] };
  }, [beforePhotos, afterPhotos]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{sectionName}</Text>
        <View style={styles.headerIcon} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {latestPair ? (
          <>
            <CompareViewer
              beforePhoto={latestPair.before}
              afterPhoto={latestPair.after}
              mode={compareMode}
              renderBeforeOverlay={() => <PhotoLabels photo={latestPair.before} role="before" />}
              renderAfterOverlay={() => <PhotoLabels photo={latestPair.after} role="after" />}
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
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surfaceElevated },
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
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});

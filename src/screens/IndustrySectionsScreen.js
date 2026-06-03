import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import QualificationPromptModal, { getStoredUserType } from '../components/QualificationPromptModal';
import RoomEditor from '../components/RoomEditor';

// IndustrySectionsScreen — dedicated route.
//
// Layout (mirrors the design's row pattern):
//   • Header [back / "Industry & sections" / spacer]
//   • INDUSTRY eyebrow
//     - Single row showing the current industry + a "Change" pill that
//       opens the existing QualificationPromptModal. The modal handles
//       all of the picker UX + folder seeding + analytics.
//   • SECTIONS eyebrow + count
//     - Read-only list of the user's current sections (rooms), each
//       in a hairline row with the icon + name. Tapping a row scrolls
//       back to the Settings inline editor (the deep edit UI lives
//       there and would duplicate >300 lines to copy here).
//   • Footer CTA: "Manage in Settings" — same destination, explicit.

export default function IndustrySectionsScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { customRooms, saveCustomRooms } = useSettings();

  const [showPicker, setShowPicker] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [currentIndustryId, setCurrentIndustryId] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await getStoredUserType();
        if (mounted) setCurrentIndustryId(stored || null);
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Refresh stored industry after the modal closes.
  const handleClosePicker = async () => {
    setShowPicker(false);
    try {
      const stored = await getStoredUserType();
      setCurrentIndustryId(stored || null);
    } catch {}
  };

  const industry = useMemo(
    () => (currentIndustryId ? getIndustryById(currentIndustryId) : null),
    [currentIndustryId],
  );
  const industryLabel = industry?.defaultLabel
    || t('industrySections.notSet', { defaultValue: 'Not set' });

  const sections = Array.isArray(customRooms) && customRooms.length > 0
    ? customRooms
    : [];

  const openEditor = () => setShowRoomEditor(true);
  const handleSaveRooms = (rooms) => {
    try { saveCustomRooms(rooms); } catch {}
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={20} color="#1E1E1E" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('industrySections.title', { defaultValue: 'Industry & sections' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>
          {t('industrySections.industry', { defaultValue: 'Industry' })}
        </Text>
        <View style={styles.rowGroup}>
          <View style={styles.row}>
            <View style={styles.rowIc}>
              <Ionicons name={industry?.icon || 'briefcase-outline'} size={19} color="#1E1E1E" />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{industryLabel}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {t('industrySections.industrySub', {
                  defaultValue: 'Sets up the right rooms for your trade',
                })}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.changePill}
              onPress={() => setShowPicker(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.changePillText}>
                {t('industrySections.change', { defaultValue: 'Change' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>
            {t('industrySections.sections', { defaultValue: 'Sections' })}
          </Text>
          <Text style={styles.eyebrowCount}>{sections.length}</Text>
        </View>

        <View style={styles.rowGroup}>
          {sections.length === 0 ? (
            <View style={styles.row}>
              <View style={styles.rowIc}>
                <Ionicons name="information-circle-outline" size={19} color="#1E1E1E" />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('industrySections.emptyTitle', { defaultValue: 'Default sections' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={2}>
                  {t('industrySections.emptySub', {
                    defaultValue: 'Pick an industry above to seed your sections, or customize them in Settings.',
                  })}
                </Text>
              </View>
            </View>
          ) : (
            sections.map((room) => (
              <View key={room.id || room.name} style={styles.row}>
                <View style={styles.rowIc}>
                  <Ionicons
                    name={room.icon ? 'square-outline' : 'folder-outline'}
                    size={19}
                    color="#1E1E1E"
                  />
                </View>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {room.name || room.id || t('industrySections.unnamedSection', { defaultValue: 'Section' })}
                  </Text>
                  {room.subtitle ? (
                    <Text style={styles.rowSub} numberOfLines={1}>{room.subtitle}</Text>
                  ) : null}
                </View>
              </View>
            ))
          )}
        </View>

        <TouchableOpacity
          style={styles.manageButton}
          onPress={openEditor}
          activeOpacity={0.85}
        >
          <Ionicons name="pencil-outline" size={16} color="#1E1E1E" />
          <Text style={styles.manageButtonText}>
            {sections.length > 0
              ? t('industrySections.editSections', { defaultValue: 'Edit sections' })
              : t('industrySections.addSections', { defaultValue: 'Add sections' })}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <QualificationPromptModal
        visible={showPicker}
        onClose={handleClosePicker}
      />

      <RoomEditor
        visible={showRoomEditor}
        onClose={() => setShowRoomEditor(false)}
        onSave={handleSaveRooms}
        initialRooms={customRooms}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.2,
  },

  eyebrow: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#9A9A9A',
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 22,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
    marginHorizontal: 22,
  },
  eyebrowCount: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: -0.1,
  },

  rowGroup: { marginHorizontal: 18, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  rowIc: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  rowSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    color: '#9A9A9A',
    letterSpacing: -0.1,
    marginTop: 1,
  },

  changePill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#F2C31B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePillText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },

  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginTop: 14,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#D0D0D0',
  },
  manageButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});

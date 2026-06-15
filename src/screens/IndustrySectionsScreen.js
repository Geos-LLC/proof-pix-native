import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { COLORS } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import QualificationPromptModal, { getStoredUserType } from '../components/QualificationPromptModal';
import RoomEditor from '../components/RoomEditor';
import { logEvent } from '../utils/analytics';

// IndustrySectionsScreen — dedicated route for the inline "Sections"
// card that used to live in Settings. Same JSX, same behavior, just
// hoisted into its own screen so the Workspace nav row in Settings
// (Industry & folders) lands here instead of scrolling inline.

export default function IndustrySectionsScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    customRooms,
    saveCustomRooms,
    getRooms,
    sectionLanguage,
    cleaningServiceEnabled,
    splitPhotosByDate,
    updateSplitPhotosByDate,
  } = useSettings();

  // Local copy of the rooms list — re-derived whenever customRooms changes
  // (e.g. after the user re-seeds via an industry pick or edits in
  // RoomEditor).
  const [rooms, setRooms] = useState(() => getRooms());
  useEffect(() => { setRooms(getRooms()); }, [customRooms]);

  const [currentRoom, setCurrentRoom] = useState(rooms.length > 0 ? rooms[0].id : null);
  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    if (!currentRoom || !rooms.some((r) => r.id === currentRoom)) {
      setCurrentRoom(rooms[0].id);
    }
  }, [rooms]);

  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [showIndustryPicker, setShowIndustryPicker] = useState(false);
  const [industryDropdownOpen, setIndustryDropdownOpen] = useState(false);
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

  // Mirror of SettingsScreen.renderRoomTabs — horizontal scroll of the
  // first 5 rooms as tappable pills with image/icon + name.
  const renderRoomTabs = () => {
    const displayRooms = rooms.slice(0, 5);
    return (
      <View style={styles.roomListContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomListScrollContent}
        >
          {displayRooms.map((room, index) => {
            const isActive = currentRoom === room.id;
            const hasImage = !!room.image;
            return (
              <TouchableOpacity
                key={`${room.id}-${index}`}
                style={[styles.roomListItem, isActive && styles.roomListItemActive]}
                onPress={() => setCurrentRoom(room.id)}
              >
                {hasImage ? (
                  <Image source={room.image} style={{ width: 24, height: 24 }} />
                ) : (
                  <Text style={{ fontSize: 20, lineHeight: 24 }}>{room.icon || '📁'}</Text>
                )}
                <Text style={[
                  styles.roomListItemText,
                  isActive && styles.roomListItemTextActive,
                ]}>
                  {cleaningServiceEnabled
                    ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                    : `${t('settings.section', { lng: sectionLanguage })} ${index + 1}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
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
          {t('industrySections.title', { defaultValue: 'Industry & folders' })}
        </Text>
        <View style={styles.headerIconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* ───── EXACT inline Sections card ────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('settings.folderCustomization_short', { defaultValue: 'Sections' })}
          </Text>
          <Text style={styles.sectionDescription}>
            {t('settings.folderCustomizationDescription', { defaultValue: 'Customize the names and default status of your project sections.' })}
          </Text>

          {/* Industry dropdown — defaults to the industry the user
              picked during onboarding (@user_qualification); picking a
              different one re-seeds the rooms via saveCustomRooms. */}
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {t('settings.industry', { defaultValue: 'Industry' })}
              </Text>
              <Text style={styles.settingDescription}>
                {t('settings.industryDescription', { defaultValue: 'Used to seed your section names. Customize any section after selecting.' })}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.locationPicker}
              onPress={() => setIndustryDropdownOpen((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.locationPickerText} numberOfLines={1}>
                {getIndustryById(currentIndustryId)?.defaultLabel
                  || t('settings.industryPick', { defaultValue: 'Pick an industry' })}
              </Text>
              <Ionicons
                name={industryDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={COLORS.GRAY}
                style={styles.locationPickerArrow}
              />
            </TouchableOpacity>
          </View>
          {industryDropdownOpen && (
            <View style={styles.locationDropdown}>
              {INDUSTRIES.map((ind) => {
                const isActive = currentIndustryId === ind.id;
                return (
                  <TouchableOpacity
                    key={ind.id}
                    style={[styles.locationOption, isActive && styles.locationOptionSelected]}
                    onPress={async () => {
                      setIndustryDropdownOpen(false);
                      setCurrentIndustryId(ind.id);
                      try { await AsyncStorage.setItem('@user_qualification', ind.id); } catch (_) {}
                      if (ind.folders?.length) {
                        try { await saveCustomRooms(ind.folders); } catch (_) {}
                      }
                    }}
                  >
                    <Text style={[
                      styles.locationOptionText,
                      isActive && styles.locationOptionTextSelected,
                    ]}>
                      {ind.defaultLabel}
                    </Text>
                    {isActive && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={COLORS.PRIMARY}
                        style={styles.locationOptionCheck}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {renderRoomTabs()}

          {/* Customize Sections — opens the existing RoomEditor modal
              for full add / rename / remove / reorder of folders. */}
          <TouchableOpacity
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: 'rgba(0, 0, 0, 0.1)' }]}
            onPress={() => setShowRoomEditor(true)}
          >
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {t('settings.customizeSections', { defaultValue: 'Customize Sections' })}
              </Text>
              <Text style={styles.settingDescription}>
                {t('settings.customizeSectionsDescription', { defaultValue: 'Add/edit/remove sections' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666666" />
          </TouchableOpacity>

          {/* Choose industry — opens the qualification modal in non-
              mandatory mode so it can be dismissed without changes. */}
          <TouchableOpacity
            style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: 'rgba(0, 0, 0, 0.1)' }]}
            onPress={() => {
              try { logEvent('qualification_prompt_shown', { context: 'settings_repick' }); } catch {}
              setShowIndustryPicker(true);
            }}
          >
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {t('settings.chooseIndustry', { defaultValue: 'Choose industry' })}
              </Text>
              <Text style={styles.settingDescription}>
                {t('settings.chooseIndustryDescription', { defaultValue: 'Replace your sections with a preset list for your business type.' })}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#666666" />
          </TouchableOpacity>
        </View>

        {/* ───── Upload Structure card (moved from LabelsLanguage) ──
            Lives here because it's a folder-organization concern, not
            a labels concern — the user wanted it next to the Sections
            controls. Same SettingsContext flag (splitPhotosByDate)
            the legacy inline section toggled. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('settings.uploadStructure', { defaultValue: 'Upload Structure' })}
          </Text>
          <Text style={styles.sectionDescription}>
            {t('settings.uploadStructureDescription', { defaultValue: 'Configure how photos are organized in cloud storage.' })}
          </Text>

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>
                {t('settings.splitByDate', { defaultValue: 'Split photos by date' })}
              </Text>
              <Text style={styles.settingDescription}>
                {t('settings.splitByDateDescription', { defaultValue: 'Group uploaded photos into per-day subfolders.' })}
              </Text>
            </View>
            <Switch
              value={!!splitPhotosByDate}
              onValueChange={updateSplitPhotosByDate}
              trackColor={{ false: '#E0E0E0', true: '#4CAF50' }}
              thumbColor="white"
            />
          </View>
        </View>
      </ScrollView>

      <RoomEditor
        visible={showRoomEditor}
        onClose={() => setShowRoomEditor(false)}
        onSave={(updatedRooms) => { try { saveCustomRooms(updatedRooms); } catch {} }}
        initialRooms={customRooms}
      />

      <QualificationPromptModal
        visible={showIndustryPicker}
        onClose={() => setShowIndustryPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Header row — back chevron + title + symmetric spacer on the right.
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

  // ───── Styles below mirror SettingsScreen.styles so the card looks
  // identical to the old inline Sections section. Keep them in sync if
  // SettingsScreen's design tokens change.

  section: {
    backgroundColor: '#FFFFFF',
    marginTop: 10,
    marginHorizontal: 18,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 2,
  },
  sectionTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
    color: '#1E1E1E',
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  sectionDescription: {
    fontSize: 12,
    color: 'grey',
    marginBottom: 2,
    lineHeight: 20,
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    paddingRight: 16,
  },
  settingLabel: {
    color: COLORS.TEXT,
    fontWeight: '600',
    fontSize: 15,
    flexShrink: 1,
  },
  settingDescription: {
    color: COLORS.GRAY,
    fontSize: 12,
    flexShrink: 1,
  },

  locationPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    padding: 12,
    borderRadius: 8,
  },
  locationPickerText: {
    color: COLORS.TEXT,
    fontWeight: '600',
  },
  locationPickerArrow: { color: COLORS.GRAY },

  locationDropdown: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    overflow: 'hidden',
  },
  locationOption: {
    padding: 12,
    paddingRight: 40,
    backgroundColor: 'white',
    position: 'relative',
  },
  locationOptionSelected: { backgroundColor: '#f7f7f7' },
  locationOptionText: { color: COLORS.TEXT },
  locationOptionTextSelected: { fontWeight: '700' },
  locationOptionCheck: {
    position: 'absolute',
    right: 12,
    top: 12,
    color: COLORS.PRIMARY,
  },

  roomListContainer: { marginVertical: 12 },
  roomListScrollContent: { paddingRight: 20, gap: 8 },
  roomListItem: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 3,
    borderRadius: 10,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    minWidth: 65,
    gap: 6,
  },
  roomListItemActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  roomListItemText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666666',
    textAlign: 'center',
  },
  roomListItemTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
});

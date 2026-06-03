import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { FONTS } from '../constants/fonts';
import { useSettings } from '../context/SettingsContext';
import { usePhotos } from '../context/PhotoContext';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import QualificationPromptModal, { getStoredUserType } from '../components/QualificationPromptModal';
import RoomEditor from '../components/RoomEditor';

// IndustrySectionsScreen — dedicated route. Mirrors the inline
// "Sections" section that used to live inside Settings, just on its
// own screen + with the "Folders" terminology the user prefers.
//
// State + persistence — all reused from existing settings paths:
// - currentIndustryId  → read from @user_qualification on mount, written
//                        back when the user picks a new industry
// - customRooms        → SettingsContext.getRooms() / saveCustomRooms()
//
// Layout:
//   • INDUSTRY eyebrow + a tap-to-expand card that lists INDUSTRIES
//     inline (same behavior as the Settings industry dropdown).
//     Picking an industry persists + re-seeds folders.
//   • FOLDERS eyebrow + a row per folder. Tap any folder OR the
//     "Edit folders" CTA at the bottom to open the existing
//     RoomEditor modal for full add / rename / remove / reorder.

export default function IndustrySectionsScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { customRooms, saveCustomRooms, getRooms } = useSettings();
  const photoCtx = usePhotos();
  const photos = photoCtx?.photos;
  const activeProjectId = photoCtx?.activeProjectId;
  const createProject = photoCtx?.createProject;
  const setActiveProject = photoCtx?.setActiveProject;
  const updatePhotos = photoCtx?.updatePhotos;

  const [showQualPicker, setShowQualPicker] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [industryDropdownOpen, setIndustryDropdownOpen] = useState(false);
  const [currentIndustryId, setCurrentIndustryId] = useState(null);
  // Pending industry-change confirmation modal. `pendingIndustry`
  // holds the industry the user just tapped; the modal asks how to
  // handle their existing photos before we actually swap folders.
  const [pendingIndustry, setPendingIndustry] = useState(null);
  // After they pick "Move existing photos to a folder", a second
  // modal lets them choose WHICH new folder receives all the photos.
  const [reassignTargetFor, setReassignTargetFor] = useState(null);

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

  const refreshIndustryFromStore = async () => {
    try {
      const stored = await getStoredUserType();
      setCurrentIndustryId(stored || null);
    } catch {}
  };

  const handleQualPickerClose = async () => {
    setShowQualPicker(false);
    await refreshIndustryFromStore();
  };

  // Persist the picked industry id + replace the folder template. Does
  // NOT touch photos — that's handled by the wrapper below depending on
  // what the user chose in the confirmation modal.
  const applyIndustryFolders = async (industry) => {
    setCurrentIndustryId(industry.id);
    try { await AsyncStorage.setItem('@user_qualification', industry.id); } catch {}
    if (Array.isArray(industry.folders) && industry.folders.length) {
      try { await saveCustomRooms(industry.folders); } catch {}
    }
  };

  // Returns the photos that live in the currently-active project AND
  // sit in one of the current folder ids — i.e. the photos that would
  // visually "disappear" from Home when we swap to a different industry.
  const activeProjectPhotosInCurrentFolders = useMemo(() => {
    if (!Array.isArray(photos) || photos.length === 0) return [];
    const currentRoomIds = new Set(
      (Array.isArray(customRooms) && customRooms.length > 0
        ? customRooms
        : (() => {
            try { return getRooms?.() || []; } catch { return []; }
          })()
      ).map((r) => r?.id).filter(Boolean),
    );
    return photos.filter(
      (p) =>
        currentRoomIds.has(p?.room)
        && (activeProjectId ? p?.projectId === activeProjectId : !p?.projectId),
    );
  }, [photos, customRooms, getRooms, activeProjectId]);

  // First handler — bound to every industry tile in the dropdown. Shows
  // the confirmation modal when there's content that would be affected;
  // otherwise just applies the swap immediately.
  const handlePickIndustry = async (industry) => {
    setIndustryDropdownOpen(false);
    // No-op if they're picking the industry they're already on.
    if (industry?.id && industry.id === currentIndustryId) return;

    const willStrandPhotos = activeProjectPhotosInCurrentFolders.length > 0;
    if (!willStrandPhotos) {
      await applyIndustryFolders(industry);
      return;
    }
    setPendingIndustry(industry);
  };

  // "Move existing photos to a folder" path. Opens the target-folder
  // picker; on confirm, reassigns every affected photo's `room` to the
  // chosen new folder, then applies the new industry folders. Photos
  // stay accessible from Home under the picked folder.
  const handleMovePhotosToFolder = async (industry, targetFolder) => {
    const affected = activeProjectPhotosInCurrentFolders;
    // Bulk reassign in a single pass — call updatePhoto for each id so
    // PhotoContext's photosRef + AsyncStorage stay in sync. Sequential
    // awaits guarantee the writes apply in order.
    if (typeof photoCtx?.updatePhoto === 'function') {
      for (const p of affected) {
        try {
          await photoCtx.updatePhoto(p.id, { room: targetFolder.id });
        } catch {}
      }
    }
    await applyIndustryFolders(industry);
    setReassignTargetFor(null);
    setPendingIndustry(null);
  };

  // "Create a new project" path. Spins up a fresh project named after
  // the new industry, switches the active project to it, then applies
  // the new folders. The old project + its photos stay untouched — if
  // the user switches back to the old industry, those photos re-appear
  // in their original folders.
  const handleStartNewProject = async (industry) => {
    try {
      if (typeof createProject === 'function') {
        const baseName = industry?.defaultLabel
          ? `${industry.defaultLabel} project`
          : 'New project';
        const created = await createProject(baseName);
        if (created?.id && typeof setActiveProject === 'function') {
          await setActiveProject(created.id);
        }
      }
    } catch {}
    await applyIndustryFolders(industry);
    setPendingIndustry(null);
  };

  const industry = useMemo(
    () => (currentIndustryId ? getIndustryById(currentIndustryId) : null),
    [currentIndustryId],
  );
  const industryLabel = industry?.defaultLabel
    || t('industrySections.notSet', { defaultValue: 'Pick an industry' });

  const folders = useMemo(() => {
    if (Array.isArray(customRooms) && customRooms.length > 0) return customRooms;
    try { return getRooms?.() || []; } catch { return []; }
  }, [customRooms, getRooms]);

  const openEditor = () => setShowRoomEditor(true);
  const handleSaveFolders = (rooms) => {
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
          {t('industrySections.title', { defaultValue: 'Industry & folders' })}
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
          {/* Selected industry — tap to expand the inline dropdown.
              Same pattern as the old Settings inline section. */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => setIndustryDropdownOpen((v) => !v)}
            activeOpacity={0.85}
          >
            <View style={styles.rowIc}>
              <Ionicons
                name={industry?.icon || 'briefcase-outline'}
                size={19}
                color="#1E1E1E"
              />
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTitle}>{industryLabel}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {t('industrySections.industrySub', {
                  defaultValue: 'Seeds folder names for your trade',
                })}
              </Text>
            </View>
            <Ionicons
              name={industryDropdownOpen ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="#9A9A9A"
            />
          </TouchableOpacity>

          {industryDropdownOpen && (
            <View style={styles.dropdownCard}>
              {INDUSTRIES.map((ind) => {
                const isActive = currentIndustryId === ind.id;
                return (
                  <TouchableOpacity
                    key={ind.id}
                    style={[styles.dropdownRow, isActive && styles.dropdownRowActive]}
                    onPress={() => handlePickIndustry(ind)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={ind.icon || 'briefcase-outline'}
                      size={17}
                      color={isActive ? '#7A5B00' : '#1E1E1E'}
                    />
                    <Text style={[styles.dropdownRowText, isActive && styles.dropdownRowTextActive]}>
                      {ind.defaultLabel}
                    </Text>
                    {isActive ? (
                      <Ionicons name="checkmark-circle" size={18} color="#F2C31B" />
                    ) : (
                      <View style={{ width: 18 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>
            {t('industrySections.folders', { defaultValue: 'Folders' })}
          </Text>
          <Text style={styles.eyebrowCount}>{folders.length}</Text>
        </View>

        <View style={styles.rowGroup}>
          {folders.length === 0 ? (
            <TouchableOpacity style={styles.row} onPress={openEditor} activeOpacity={0.85}>
              <View style={styles.rowIc}>
                <Ionicons name="folder-open-outline" size={19} color="#1E1E1E" />
              </View>
              <View style={styles.rowMeta}>
                <Text style={styles.rowTitle}>
                  {t('industrySections.noFoldersTitle', { defaultValue: 'No folders yet' })}
                </Text>
                <Text style={styles.rowSub} numberOfLines={2}>
                  {t('industrySections.noFoldersSub', {
                    defaultValue: 'Pick an industry above to seed folders, or tap to add them manually.',
                  })}
                </Text>
              </View>
              <Ionicons name="add" size={18} color="#9A9A9A" />
            </TouchableOpacity>
          ) : (
            folders.map((folder, index) => (
              <TouchableOpacity
                key={`${folder.id || folder.name}-${index}`}
                style={styles.row}
                onPress={openEditor}
                activeOpacity={0.85}
              >
                <View style={styles.rowIc}>
                  {folder.image ? (
                    <Image source={folder.image} style={styles.rowImage} />
                  ) : folder.icon && /[\p{Emoji}]/u.test(String(folder.icon)) ? (
                    <Text style={styles.rowEmoji}>{folder.icon}</Text>
                  ) : (
                    <Ionicons name="folder-outline" size={19} color="#1E1E1E" />
                  )}
                </View>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {folder.name || folder.id || t('industrySections.unnamedFolder', { defaultValue: 'Folder' })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
              </TouchableOpacity>
            ))
          )}

          {/* Add folder row — opens RoomEditor in add mode. */}
          {folders.length > 0 ? (
            <TouchableOpacity
              style={[styles.row, styles.rowAdd]}
              onPress={openEditor}
              activeOpacity={0.85}
            >
              <View style={[styles.rowIc, styles.rowIcAdd]}>
                <Ionicons name="add" size={20} color="#7A5B00" />
              </View>
              <Text style={styles.rowAddText}>
                {t('industrySections.addFolder', { defaultValue: 'Add a folder' })}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.manageButton}
          onPress={openEditor}
          activeOpacity={0.85}
        >
          <Ionicons name="pencil-outline" size={16} color="#1E1E1E" />
          <Text style={styles.manageButtonText}>
            {folders.length > 0
              ? t('industrySections.editFolders', { defaultValue: 'Edit folders' })
              : t('industrySections.addFolders', { defaultValue: 'Add folders' })}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryAction}
          onPress={() => setShowQualPicker(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.secondaryActionText}>
            {t('industrySections.reseedFromIndustry', {
              defaultValue: 'Re-seed folders from an industry preset',
            })}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <QualificationPromptModal
        visible={showQualPicker}
        onClose={handleQualPickerClose}
      />

      <RoomEditor
        visible={showRoomEditor}
        onClose={() => setShowRoomEditor(false)}
        onSave={handleSaveFolders}
        initialRooms={customRooms}
      />

      {/* Industry-change confirmation. Three options:
          • Cancel — close, nothing changes
          • Move existing photos to a folder — opens the target picker
            below; one tap → all affected photos move to that folder
          • Create a new project — keeps current photos + folders in the
            existing project; new project gets the new industry */}
      <Modal
        visible={!!pendingIndustry && !reassignTargetFor}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingIndustry(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {t('industrySections.changeIndustryTitle', {
                defaultValue: `Switch to ${pendingIndustry?.defaultLabel || ''}?`,
              })}
            </Text>
            <Text style={styles.modalBody}>
              {t('industrySections.changeIndustryBody', {
                defaultValue:
                  `${activeProjectPhotosInCurrentFolders.length} photo${activeProjectPhotosInCurrentFolders.length === 1 ? '' : 's'} in this project sit in the current folders. Switching industries replaces those folders. What should we do with the photos?`,
              })}
            </Text>

            <TouchableOpacity
              style={styles.modalPrimary}
              onPress={() => setReassignTargetFor(pendingIndustry)}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-forward-circle-outline" size={18} color="#1E1E1E" />
              <Text style={styles.modalPrimaryText}>
                {t('industrySections.movePhotosCTA', {
                  defaultValue: `Move them to a folder in ${pendingIndustry?.defaultLabel || ''}`,
                })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondary}
              onPress={() => handleStartNewProject(pendingIndustry)}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle-outline" size={18} color="#1E1E1E" />
              <Text style={styles.modalSecondaryText}>
                {t('industrySections.newProjectCTA', {
                  defaultValue: 'Create a new project (keep current photos)',
                })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalGhost}
              onPress={() => setPendingIndustry(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalGhostText}>
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Target-folder picker. Opens after "Move them to a folder" tap;
          shows every folder in the new industry. One tap → reassigns
          all affected photos to that folder + applies the new folder
          set. */}
      <Modal
        visible={!!reassignTargetFor}
        transparent
        animationType="slide"
        onRequestClose={() => setReassignTargetFor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>
              {t('industrySections.pickTargetTitle', { defaultValue: 'Move photos to which folder?' })}
            </Text>
            <Text style={styles.modalBody}>
              {t('industrySections.pickTargetBody', {
                defaultValue:
                  `${activeProjectPhotosInCurrentFolders.length} photo${activeProjectPhotosInCurrentFolders.length === 1 ? '' : 's'} will move to the folder you pick.`,
              })}
            </Text>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {(reassignTargetFor?.folders || []).map((folder) => (
                <TouchableOpacity
                  key={folder.id}
                  style={styles.targetRow}
                  onPress={() => handleMovePhotosToFolder(reassignTargetFor, folder)}
                  activeOpacity={0.85}
                >
                  <View style={styles.targetRowIc}>
                    {folder.image ? (
                      <Image source={folder.image} style={{ width: 22, height: 22 }} />
                    ) : folder.icon && /[\p{Emoji}]/u.test(String(folder.icon)) ? (
                      <Text style={{ fontSize: 19 }}>{folder.icon}</Text>
                    ) : (
                      <Ionicons name="folder-outline" size={18} color="#1E1E1E" />
                    )}
                  </View>
                  <Text style={styles.targetRowText} numberOfLines={1}>
                    {folder.name || folder.id}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#9A9A9A" />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalGhost, { marginTop: 8 }]}
              onPress={() => setReassignTargetFor(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.modalGhostText}>
                {t('common.back', { defaultValue: 'Back' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  rowImage: { width: 24, height: 24 },
  rowEmoji: { fontSize: 20, lineHeight: 24 },
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

  // Inline industry dropdown — soft accent fill so it visually attaches
  // to the row above and reads as "this row's expanded options".
  dropdownCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  dropdownRowActive: {
    backgroundColor: '#FFF4C2',
  },
  dropdownRowText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  dropdownRowTextActive: {
    color: '#7A5B00',
    fontWeight: '700',
  },

  // "+ Add a folder" inline row at the tail of the list.
  rowAdd: {
    backgroundColor: '#FFFCEC',
    borderColor: '#F2C31B',
  },
  rowIcAdd: {
    backgroundColor: '#FFF4C2',
  },
  rowAddText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#7A5B00',
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
  secondaryAction: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  secondaryActionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: -0.1,
  },

  // Industry-change confirmation + target-folder picker modals.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.55)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 28,
  },
  modalTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '800',
    color: '#1E1E1E',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  modalBody: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13.5,
    fontWeight: '500',
    color: '#666666',
    letterSpacing: -0.1,
    lineHeight: 19,
    marginBottom: 18,
  },
  modalPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFF4C2',
    borderWidth: 1.5,
    borderColor: '#F2C31B',
    marginBottom: 10,
  },
  modalPrimaryText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  modalSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    marginBottom: 6,
  },
  modalSecondaryText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14.5,
    fontWeight: '600',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
  modalGhost: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalGhostText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
    color: '#9A9A9A',
    letterSpacing: -0.1,
  },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    marginBottom: 6,
  },
  targetRowIc: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetRowText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
    color: '#1E1E1E',
    letterSpacing: -0.1,
  },
});

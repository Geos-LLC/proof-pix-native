import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Linking,
  Share as RNShareDialog,
  FlatList,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { countSets } from '../utils/photoSets';
import { useAdmin } from '../context/AdminContext';
import { COLORS, TEMPLATE_CONFIGS, TEMPLATE_TYPES, PHOTO_MODES } from '../constants/rooms';
import { INDUSTRIES, getIndustryById } from '../constants/industries';
import { getStoredUserType } from '../components/QualificationPromptModal';
import { FEATURES } from '../constants/featurePermissions';
import { FONTS } from '../constants/fonts';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EnlargedPhotoViewer from '../components/EnlargedPhotoViewer';
import { importTeamProject, localPathForTeamPhoto } from '../services/teamPhotoImport';
import { PROXY_SERVER_URL } from '../config/proxy';
import { readSecure as readSecureStorage } from '../services/secureStorageService';
import { UploadDetailsModal } from '../components/BackgroundUploadStatus';
import UploadCompletionModal from '../components/UploadCompletionModal';
import { LOCATIONS, getLocationName } from '../config/locations';
import { createAlbumName, ensureLabelForPhoto } from '../services/uploadService';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import { isTeamUploadEnabled, getTeamUploadBlockedReason, adminStorageLabel } from '../config/teamUpload';
import { getConnectedClouds } from '../utils/cloudConnectivity';
import * as ExpoLocation from 'expo-location';
import { logProjectCreated } from '../utils/analytics';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import Constants from 'expo-constants';
// expo-print is a native module that was added to package.json AFTER
// some older binaries were compiled (build 76 = pre-expo-print). An
// eager top-level `import` would fail JS bundle init on those older
// binaries and brick the entire OTA. Lazy-require inside the PDF
// handler so the bundle loads on any build; only the PDF action
// itself fails if expo-print isn't compiled into the host binary.
import dropboxAuthService from '../services/dropboxAuthService';
import googleDriveService from '../services/googleDriveService';
import dropboxService from '../services/dropboxService';
import iCloudService from '../services/iCloudService';
import { ensureShareAllowed, recordShare } from '../utils/shareRateLimit';

// Ensure a URI has the file:// prefix (expo FileSystem URIs already include it on Android)
const ensureFileUri = (uri) => uri.startsWith('file://') ? uri : `file://${uri}`;

import * as Sharing from 'expo-sharing';

// react-native-share for multi-file sharing (not available in Expo Go)
let RNShare = { open: async () => {} };
const isExpoGo = Constants?.appOwnership === 'expo';
if (!isExpoGo) {
  try {
    const shareModule = require('react-native-share');
    RNShare = shareModule.default || shareModule;
  } catch (e) {
    console.warn('[Projects] Failed to load react-native-share:', e?.message);
  }
}

// Format a unix-ms timestamp as "Xm ago", "Xh ago", or "Xd ago". Falls back
// to "—" when nothing is available (project with zero photos and no createdAt).
const formatRelative = (ts) => {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
};

export default function ProjectsScreen({ navigation, route }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  // Date-range chip filter above the project list. 'all' shows every
  // project; the other buckets narrow by crmJobMeta.scheduledAt (SF-
  // linked jobs) or project.createdAt (local-only). SF sync itself
  // pulls a wider window (-30d..+30d) so switching chips reveals the
  // slice we already have in memory instead of re-fetching.
  const [dateFilter, setDateFilter] = useState('all');
  // Cleaner filter on Team tab. `null` = show everything. Otherwise:
  //   { kind: 'sf', id: number }    — matches local SF projects where
  //                                    crmJobMeta.teamMemberId(s) match
  //   { kind: 'cloud', name: string } — matches cloud team-projects where
  //                                     ownerName equals the chip label
  // SF cleaners come from the proxy's passthrough to SF's
  // /sf-team-members; cloud owners are derived from teamProjects'
  // ownerName. Both sources render as chips in the same row.
  const [cleanerFilter, setCleanerFilter] = useState(null);
  const [sfCleanerList, setSfCleanerList] = useState([]);
  const [actionSheetProject, setActionSheetProject] = useState(null);
  // Multi-select mode for bulk delete / share. Long-press a card to
  // enter; tap-toggle, then act via the toolbar that replaces the
  // search row.
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  // Action-sheet opened by the search-row menu button (three-dot on
  // the right of the search bar). Hosts bulk actions that used to be
  // long-press-only: enter multi-select, delete every project.
  const [menuSheetVisible, setMenuSheetVisible] = useState(false);
  const {
    projects,
    getPhotosByProject,
    deleteProject,
    setActiveProject,
    activeProjectId,
    createProject,
    addPhoto,
    photos,
  } = usePhotos();
  
  const {
    userName,
    userPlan,
    updateUserPlan,
    location,
    updateUserInfo,
    showLabels,
    useFolderStructure,
    enabledFolders,
    getRooms,
    saveCustomRooms,
    autoUseCurrentLocationForProjects,
    updateAutoUseCurrentLocationForProjects,
    // Slice D.3.2: read admin's global label positions so the grid
    // chip overlay matches wherever the enlarged view's PhotoLabels
    // renders. Photo-level overrides from team-member snapshot win
    // when present.
    singleLabelPosition: adminSingleLabelPosition,
    beforeLabelPosition: adminBeforeLabelPosition,
    afterLabelPosition: adminAfterLabelPosition,
  } = useSettings();
  const roomDataMap = useMemo(() => {
    const map = new Map();
    for (const room of (getRooms() || [])) {
      map.set(room.id, room);
    }
    return map;
  }, [getRooms]);
  // Fallback industry id used when a project has no `industry` stored.
  // Computed per-project from the room IDs of that project's photos
  // (same overlap logic as HomeScreen's qualification auto-restore),
  // so cards reflect the industry the project was ACTUALLY done under
  // — not the user's most recent global qualification pick. Falls
  // back to the onboarding qualification when a project has no rooms
  // we can match.
  const [defaultIndustryId, setDefaultIndustryId] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getStoredUserType();
        if (!cancelled) setDefaultIndustryId(stored || null);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const inferredIndustryByProject = useMemo(() => {
    const map = new Map();
    const roomsByProject = new Map();
    for (const p of photos || []) {
      if (!p?.projectId || !p?.room) continue;
      let set = roomsByProject.get(p.projectId);
      if (!set) { set = new Set(); roomsByProject.set(p.projectId, set); }
      set.add(p.room);
    }
    const industryFolderIds = INDUSTRIES.map((ind) => ({
      id: ind.id,
      folderIds: new Set((ind.folders || []).map((f) => f.id)),
    }));
    for (const [pid, rooms] of roomsByProject) {
      let bestId = null;
      let bestOverlap = 0;
      for (const { id, folderIds } of industryFolderIds) {
        let overlap = 0;
        for (const rid of rooms) if (folderIds.has(rid)) overlap++;
        if (overlap > bestOverlap) { bestOverlap = overlap; bestId = id; }
      }
      if (bestId) map.set(pid, bestId);
    }
    return map;
  }, [photos]);
  const { userMode, teamInfo, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType, connectedAccounts, inviteTokens } = useAdmin();
  const { exceedsLimit, canUse, effectivePlan } = useFeaturePermissions();
  const { uploadStatus, startBackgroundUpload, cancelUpload, cancelAllUploads, clearCompletedUploads } = useBackgroundUpload();
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';

  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [newProjectNamePart, setNewProjectNamePart] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState(location);
  // Ref + selection used to scroll the project-name input back to the
  // beginning after the auto-fill drops in a long address. Without
  // this, the input keeps the cursor at the end and iOS renders the
  // tail of the string instead of "1234 Main St…", which made the
  // address read as scrolled-to-the-right.
  const newProjectNameRef = useRef(null);
  const [newProjectNameSelection, setNewProjectNameSelection] = useState(null);
  // Industry the user picks for THIS project. Defaults to the industry
  // they chose during onboarding (from `@user_qualification` storage).
  // Picking a different one will reseed the global rooms via
  // saveCustomRooms when the project is created.
  const [newProjectIndustry, setNewProjectIndustry] = useState(null);
  const [industryPickerOpen, setIndustryPickerOpen] = useState(false);
  // When the FAB on HomeScreen sends us here with
  // `navigateToCameraAfter`, we push Camera right after a successful
  // create so the user lands on the capture surface (the prior FAB
  // flow used to do this with its own old modal).
  const navigateToCameraAfterCreateRef = useRef(false);

  // Load the user's onboarding industry once when the modal opens so
  // the default dropdown selection matches their initial pick.
  useEffect(() => {
    if (!newProjectVisible) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await getStoredUserType();
        if (!cancelled && stored) setNewProjectIndustry(stored);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [newProjectVisible]);

  // Route-param auto-open: HomeScreen's camera FAB sends us here with
  // `{ openNewProject: true, navigateToCameraAfter: true }` when there
  // is no active project, so the user always sees the same canonical
  // New Project modal (no separate HomeScreen copy). We consume the
  // params and reset them so re-entering Projects doesn't re-open the
  // modal accidentally.
  useEffect(() => {
    const params = route?.params || {};
    if (params.openNewProject) {
      navigateToCameraAfterCreateRef.current = !!params.navigateToCameraAfter;
      setNewProjectVisible(true);
      try { navigation.setParams({ openNewProject: undefined, navigateToCameraAfter: undefined }); } catch {}
    }
  }, [route?.params?.openNewProject, route?.params?.navigateToCameraAfter, navigation]);

  // Route-param auto-open: ProjectDetail's Share tab sends us here with
  // `{ openUploadForProjectId: <id> }` when the user taps the "Upload
  // Photos to Cloud" card. We look up the project and reuse the same
  // handleUploadProject entry point the projects-list action sheet
  // uses — user lands on Projects with the sheet already open, no code
  // duplication vs. porting the whole upload flow into ProjectDetail.
  // Clear the param after consuming so re-entering Projects doesn't
  // re-open the sheet.
  useEffect(() => {
    const params = route?.params || {};
    const id = params.openUploadForProjectId;
    if (!id) return;
    const project = projects.find((p) => p.id === id);
    if (project) handleUploadProject(project);
    try { navigation.setParams({ openUploadForProjectId: undefined }); } catch {}
  }, [route?.params?.openUploadForProjectId, projects, navigation]);

  // Whenever the modal opens, seed the name with the "Project N"
  // default. If the user has the "always use current location"
  // checkbox on, kick off a silent location fill — that effect
  // replaces the default name with the address (if granted) or
  // leaves it as "Project N" (if denied).
  useEffect(() => {
    if (!newProjectVisible) return;
    const nextNum = (projects?.length || 0) + 1;
    setNewProjectNamePart(`Project ${nextNum}`);
    if (autoUseCurrentLocationForProjects) {
      handleUseCurrentLocationInModal({ interactive: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newProjectVisible]);
  const [locationLoadingInModal, setLocationLoadingInModal] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [showUploadDetails, setShowUploadDetails] = useState(false);
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [shareOptionsVisible, setShareOptionsVisible] = useState(false);
  const [projectToShare, setProjectToShare] = useState(null);
  const [selectedShareTypes, setSelectedShareTypes] = useState({ before: true, after: true, combined: true });
  const [selectedFormats, setSelectedFormats] = useState(() => {
    const initial = {};
    Object.keys(TEMPLATE_CONFIGS).forEach((key) => { initial[key] = false; });
    return initial;
  });
  // Share format: 'files' (system sheet w/ individual photos), 'zip',
  // 'pdf' (rendered report), 'link' (upload to cloud + shareable URL).
  const [shareFormat, setShareFormat] = useState('files');
  // Which cloud the shareable link comes from. Auto-defaults to whichever
  // cloud is connected when the modal opens.
  const [shareLinkProvider, setShareLinkProvider] = useState('google');
  const [showAdvancedShareFormats, setShowAdvancedShareFormats] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState('');

  // Upload options modal state
  const [uploadOptionsVisible, setUploadOptionsVisible] = useState(false);
  const [projectToUpload, setProjectToUpload] = useState(null);
  const lastUploadedProjectIdRef = useRef(null);
  const [selectedUploadTypes, setSelectedUploadTypes] = useState({ before: true, after: true, combined: true });
  const [uploadDestinations, setUploadDestinations] = useState({ google: true, dropbox: false });
  const [uploading, setUploading] = useState(false);

  // Auto-show completion modal when uploads finish (only after details modal closes)
  useEffect(() => {
    if (!showUploadDetails && uploadStatus.completedUploads && uploadStatus.completedUploads.length > 0) {
      setShowCompletionModal(true);
    }
  }, [uploadStatus.completedUploads, showUploadDetails]);

  const handleCreateProject = async () => {
    const namePart = (newProjectNamePart || userName || '').trim();
    if (!namePart) {
      Alert.alert(t('common.error'), t('projects.enterProjectName'));
      return;
    }

    if (!userName) {
      Alert.alert(
        t('projects.userNameRequiredTitle'),
        t('projects.userNameRequiredMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('projects.goToSettings'), onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Settings' }] }) }
        ]
      );
      return;
    }

    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setNewProjectNamePart('');
      setNewProjectVisible(false);
      navigation.navigate('PlanSelection');
      return;
    }

    // Soft guard: team members whose admin uses Service Flow as the
    // proxy backend can only sync photos that attach to an SF job.
    // The proxy hard-rejects uploads without a crmJobId, so a locally
    // created project silently fails to reach admin. Show a heads-up
    // pointing at the Team tab (which lists synced SF jobs) and let
    // the member either switch tabs or proceed knowing photos stay
    // on-device. Only fires for SF-primary admins — Google/Dropbox
    // sessions accept any album name so no guard needed.
    if (isTeamMember && teamInfo?.adminAccountType === 'serviceflow') {
      const sfSyncedCount = (projects || []).filter(
        (p) => p?.crmProvider === 'serviceflow' && p?.crmJobId,
      ).length;
      const proceed = await new Promise((resolve) => {
        const buttons = [];
        if (sfSyncedCount > 0) {
          buttons.push({
            text: t('projects.sfGuardOpenTeamTab', { defaultValue: 'Open Team tab' }),
            onPress: () => {
              setNewProjectVisible(false);
              setProjectsTab('team');
              resolve(false);
            },
          });
        }
        buttons.push({
          text: t('projects.sfGuardCreateAnyway', { defaultValue: 'Create anyway' }),
          style: 'destructive',
          onPress: () => resolve(true),
        });
        buttons.push({
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
          onPress: () => resolve(false),
        });
        const message = sfSyncedCount > 0
          ? t('projects.sfGuardMessage', {
              count: sfSyncedCount,
              defaultValue: `Your admin uses Service Flow. Photos in a new local project won't sync to admin.\n\n${sfSyncedCount} Service Flow job(s) are on your Team tab — pick one to send photos to admin.`,
            })
          : t('projects.sfGuardMessageNoJobs', {
              defaultValue: 'Your admin uses Service Flow. Photos in a new local project won\'t sync to admin. No Service Flow jobs are synced yet — create anyway to work locally, or cancel and check back after admin schedules a job.',
            });
        Alert.alert(
          t('projects.sfGuardTitle', { defaultValue: "Won't sync with admin" }),
          message,
          buttons,
          { cancelable: false },
        );
      });
      if (!proceed) return;
    }

    // Single field: the user's input IS the folder name (location-derived
     // by default). Skip the legacy "Name - Date - Location" composition.
    const fullName = namePart;
    const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9_\- ]/gi, '_');
    const existing = projects.map(p => p.name);
    const existingNorm = new Set(existing.map(normalize));
    let finalName = fullName;
    if (existingNorm.has(normalize(fullName))) {
      let i = 2;
      while (existingNorm.has(normalize(`${i} ${fullName}`))) i++;
      finalName = `${i} ${fullName}`;
    }

    try {
      setCreating(true);
      // Apply the picked industry's folder seed before creating the
      // project so the new project lands on the right room set. We
      // only re-seed when the user picked an industry different from
      // their onboarding default, to avoid clobbering folders they
      // may have customised manually.
      try {
        const stored = await getStoredUserType();
        if (newProjectIndustry && newProjectIndustry !== stored) {
          const industry = getIndustryById(newProjectIndustry);
          if (industry?.folders?.length) {
            await saveCustomRooms(industry.folders);
          }
        }
      } catch {}
      const project = await createProject(
        finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_'),
        { industry: newProjectIndustry || null },
      );
      logProjectCreated();
      setNewProjectNamePart('');
      setNewProjectVisible(false);
      setActiveProject(project.id);
      // If the FAB on HomeScreen routed us here, jump to the camera
      // right after create so the user lands on the capture surface.
      // Otherwise return to Home — the main dashboard for the newly
      // active project. Previously this landed on an empty Gallery
      // (share-heavy layout with only a floating share FAB), which
      // looked like a "share project" screen rather than the project
      // home.
      if (navigateToCameraAfterCreateRef.current) {
        navigateToCameraAfterCreateRef.current = false;
        const firstRoomId = (getRooms() || [])[0]?.id;
        navigation.reset({
          index: 0,
          routes: [{ name: 'Camera', params: { mode: 'before', room: firstRoomId } }],
        });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    } catch (e) {
      Alert.alert(t('common.error'), e?.message || t('projects.createError'));
    } finally {
      setCreating(false);
    }
  };

  // Resolve the current location and use it as the project name. Three
  // permission states: granted → fetch and prefill; undetermined → iOS
  // shows the prompt; denied → offer Settings (iOS won't reprompt). The
  // name field is only overwritten while it still equals the default
  // ("Project N") so we don't clobber what the user typed.
  const handleUseCurrentLocationInModal = async (opts = {}) => {
    const { interactive = true } = opts;
    setLocationLoadingInModal(true);
    try {
      let { status } = await ExpoLocation.getForegroundPermissionsAsync();
      if (status === 'undetermined') {
        const res = await ExpoLocation.requestForegroundPermissionsAsync();
        status = res.status;
      }
      if (status === 'denied') {
        setLocationDenied(true);
        if (interactive) {
          Alert.alert(
            t('settings.locationPermissionTitle', { defaultValue: 'Location access' }),
            t('settings.locationPermissionMessage', {
              defaultValue: 'Enable Location in Settings to auto-fill the project name with your current place.',
            }),
            [
              { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
              {
                text: t('common.openSettings', { defaultValue: 'Open Settings' }),
                onPress: () => Linking.openSettings(),
              },
            ]
          );
        }
        return;
      }
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const [address] = await ExpoLocation.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      // Build the most precise address Expo gives us. Order:
      // <streetNumber street>, <city>, <region>. Each segment is only
      // appended when present so partial data degrades gracefully
      // instead of producing dangling commas. Falls back to city /
      // region / country if no street info came back.
      const streetLine = [address?.streetNumber, address?.street].filter(Boolean).join(' ').trim();
      const cityLine = address?.city || address?.subregion;
      const regionLine = address?.region;
      const segments = [streetLine, cityLine, regionLine].filter(Boolean);
      const locationDisplay = segments.length
        ? segments.join(', ')
        : (address?.country || null);
      if (!locationDisplay) {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      const defaultName = `Project ${(projects?.length || 0) + 1}`;
      setNewProjectNamePart((current) =>
        !current?.trim() || current === defaultName ? locationDisplay : current
      );
      // After the auto-fill lands, scroll the input back to the start
      // so the user sees the street number / street, not the tail of
      // the address. Two-part nudge: pin the selection to {0, 0} for
      // a tick so iOS rewinds, then clear the controlled selection so
      // tapping the field continues to work normally.
      setNewProjectNameSelection({ start: 0, end: 0 });
      setTimeout(() => {
        try { newProjectNameRef.current?.blur(); } catch {}
        setNewProjectNameSelection(null);
      }, 50);
    } catch (error) {
      console.error('[ProjectsScreen] Use current location in modal:', error);
      setLocationDenied(true);
    } finally {
      setLocationLoadingInModal(false);
    }
  };

  const handleDeleteProject = (project) => {
    setProjectToDelete(project);
    setShowDeleteConfirm(true);
  };

  // Multi-select handlers (mirror HomeScreen pattern).
  const handleProjectLongPress = (projectId) => {
    setIsMultiSelectMode(true);
    setSelectedProjects(new Set([projectId]));
  };
  const handleProjectPressInSelectMode = (projectId) => {
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  const exitMultiSelect = () => {
    setIsMultiSelectMode(false);
    setSelectedProjects(new Set());
  };
  const handleDeleteSelected = () => {
    const ids = Array.from(selectedProjects);
    if (ids.length === 0) return;
    Alert.alert(
      t('projects.deleteSelectedTitle', {
        count: ids.length,
        defaultValue: `Delete ${ids.length} project${ids.length === 1 ? '' : 's'}?`,
      }),
      t('projects.deleteSelectedBody', { defaultValue: 'Photos stay in your iOS Photos library. Project records + linked photo metadata in the app will be removed.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            const deletedSet = new Set(ids);
            const activeWasDeleted = activeProjectId && deletedSet.has(activeProjectId);
            for (const id of ids) {
              try { await deleteProject(id, { deleteFromStorage: false }); }
              catch (e) { console.warn('[ProjectsScreen] bulk delete failed for', id, e?.message); }
            }
            // Mirror the single-project delete flow: if the active project
            // was one of the deleted, hand active over to a survivor (or
            // null). Without this, downstream screens keep pointing at a
            // ghost projectId and the list can look stale.
            if (activeWasDeleted) {
              const survivor = projects.find(p => !deletedSet.has(p.id));
              setActiveProject(survivor ? survivor.id : null);
            }
            exitMultiSelect();
          },
        },
      ],
    );
  };
  // Nuke every local project. Only wired to the search-row menu on
  // the My-projects tab — team projects live on the proxy KV and are
  // out of scope here. Photos stay in iOS Photos (deleteFromStorage:
  // false), matching the bulk-delete flow.
  const handleDeleteAllProjects = () => {
    // Scope delete-all to the tab the user is looking at. Before, this
    // ran across `projects` (every local project regardless of tab),
    // which meant Team-tab admins had no way to purge just their SF
    // projects — the button either did nothing (disabled) or would
    // have nuked My-tab manual projects too. Now:
    //   My tab   → delete manual (non-SF) local projects
    //   Team tab → delete local SF-linked projects (Team tab also has
    //              the separate "trash" icon that clears proxy-KV team
    //              projects; kept independent so SF vs KV can be
    //              wiped separately).
    const targets = projectsTab === 'team' ? localSfProjects : localMineProjects;
    if (targets.length === 0) return;
    const total = targets.length;
    Alert.alert(
      t('projects.deleteAllTitle', {
        count: total,
        defaultValue: `Delete all ${total} project${total === 1 ? '' : 's'}?`,
      }),
      t('projects.deleteAllBody', {
        defaultValue:
          'This removes every project on this device. Photos stay in your iOS Photos library. This cannot be undone.',
      }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.deleteAll', { defaultValue: 'Delete all' }),
          style: 'destructive',
          onPress: async () => {
            for (const p of targets) {
              try {
                await deleteProject(p.id, { deleteFromStorage: false });
              } catch (e) {
                console.warn('[ProjectsScreen] delete-all failed for', p.id, e?.message);
              }
            }
            setActiveProject(null);
            if (isMultiSelectMode) exitMultiSelect();
          },
        },
      ],
    );
  };

  const handleShareSelected = () => {
    const ids = Array.from(selectedProjects);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      const p = projects.find((proj) => proj.id === ids[0]);
      if (p) {
        exitMultiSelect();
        handleShareProject(p);
      }
      return;
    }
    Alert.alert(
      t('projects.shareSelectedTitle', { defaultValue: 'Multi-project share' }),
      t('projects.shareSelectedBody', { defaultValue: 'Sharing multiple projects in one bundle is coming soon. For now, select a single project to share, or use the per-project Share tab.' }),
      [{ text: t('common.ok', { defaultValue: 'OK' }) }],
    );
  };

  const handleDeleteConfirmed = async (deleteFromStorage) => {
    if (!projectToDelete) return;
    
    try {
      await deleteProject(projectToDelete.id, { deleteFromStorage });
      if (activeProjectId === projectToDelete.id) {
        if (projects.length > 1) {
          const remainingProjects = projects.filter(p => p.id !== projectToDelete.id);
          if (remainingProjects.length > 0) {
            setActiveProject(remainingProjects[0].id);
          } else {
            setActiveProject(null);
          }
        } else {
          setActiveProject(null);
        }
      }
    } catch (error) {
      Alert.alert(t('common.error'), 'Failed to delete project.');
    } finally {
      setShowDeleteConfirm(false);
      setProjectToDelete(null);
    }
  };

  const handleShareProject = (project) => {
    const projectPhotos = getPhotosByProject(project.id);
    if (projectPhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosInProject'));
      return;
    }
    // Route to the canonical Share flow inside ProjectDetail — same
    // destination as HomeScreen's action-sheet Share button. Lands on the
    // Share tab with the "Share N photos" format modal auto-opened,
    // matching the single source-of-truth UX. The old local
    // shareOptionsVisible modal (below in JSX) is now dead code kept
    // around only until the follow-up cleanup PR.
    navigation.navigate('ProjectDetail', {
      projectId: project.id,
      initialShareFlow: true,
    });
  };

  const handleFormatToggle = (key) => {
    if (!canUse(FEATURES.ADVANCED_TEMPLATES)) {
      Alert.alert(
        t('share.advancedFormatsTitle', { defaultValue: 'Paid feature' }),
        t('share.advancedFormatsMessage', { defaultValue: 'Advanced templates are available on the Pro plan. Upgrade to unlock all formats and side-by-side layouts.' }),
        [
          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
          { text: t('share.upgradeCTA', { defaultValue: 'Upgrade to Pro' }), onPress: () => navigation.navigate('PlanSelection') },
        ]
      );
      return;
    }
    setSelectedFormats(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Build an HTML report from the labeled photos and hand it to
  // expo-print so iOS/Android render a real PDF. Images are embedded as
  // base64 so the resulting PDF works fully offline once shared.
  const sharePhotosAsPdf = async (urls, sharePhotos) => {
    if (!urls.length) {
      Alert.alert('No Photos', 'Nothing to put in the report.');
      return;
    }
    // Lazy-load expo-print so older binaries (e.g. build 76, which was
    // compiled before expo-print was added to package.json) can still
    // load this JS bundle over the air. If the native module isn't in
    // the host binary, this throws — we catch and show a clear error
    // instead of crashing the share flow.
    let Print;
    try {
      Print = require('expo-print');
    } catch (e) {
      Alert.alert(
        'PDF not supported in this build',
        'Update to the latest TestFlight build to share as PDF. Try Files, ZIP, or Link in the meantime.',
      );
      return;
    }
    setShareStatus(t('gallery.preparingPhotos', { defaultValue: 'Preparing PDF...' }));
    const modeLabel = (m) => {
      if (m === 'before') return 'Before';
      if (m === 'after') return 'After';
      if (m === PHOTO_MODES.COMBINED || m === 'combined' || m === 'mix') return 'Before / After';
      if (m === 'progress') return 'Progress';
      return '';
    };
    const photoBlocks = [];
    for (let i = 0; i < urls.length; i++) {
      const uri = urls[i];
      const meta = sharePhotos[i] || {};
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      photoBlocks.push(`
        <div class="photo">
          <img src="data:image/jpeg;base64,${b64}" />
          <div class="caption">${modeLabel(meta.mode) || ''}</div>
        </div>
      `);
    }
    const safeName = (projectToShare?.name || 'Project').replace(/[<>&]/g, '');
    const reportDate = new Date().toLocaleDateString();
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 0; color: #1C274C; }
            /* Header is its own page so each photo block below can
               occupy a full viewport-height page and vertically
               center its image. */
            .header { border-bottom: 2px solid #F2C31B; padding: 32px; margin: 0; page-break-after: always; }
            .title { font-size: 24px; font-weight: 700; margin: 0 0 4px 0; }
            .meta { font-size: 12px; color: #666; margin: 0; }
            /* Full-page centered photo block: 100vh container with
               flex centering puts the image dead-center vertically
               on its own page. */
            .photo {
              page-break-inside: avoid;
              page-break-after: always;
              height: 100vh;
              display: flex;
              flex-direction: column;
              justify-content: center;
              align-items: center;
              text-align: center;
              padding: 32px;
              margin: 0;
            }
            .photo:last-of-type { page-break-after: auto; }
            .photo img { max-width: 100%; max-height: 80vh; border-radius: 8px; }
            .caption { font-size: 12px; color: #444; margin-top: 12px; font-weight: 600; }
            .footer { text-align: center; font-size: 10px; color: #999; padding: 32px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${safeName}</div>
            <div class="meta">${urls.length} photo${urls.length === 1 ? '' : 's'} · Generated ${reportDate}</div>
          </div>
          ${photoBlocks.join('\n')}
          <div class="footer">Generated by ProofPix</div>
        </body>
      </html>
    `;
    setShareStatus('Rendering PDF...');
    const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });
    const friendlyName = `${safeName}_${Date.now()}.pdf`;
    const targetUri = `${FileSystem.cacheDirectory}${friendlyName}`;
    try {
      await FileSystem.copyAsync({ from: pdfUri, to: targetUri });
    } catch {
      // Fall back to the raw printer URI if copy fails
    }
    const finalUri = (await FileSystem.getInfoAsync(targetUri)).exists ? targetUri : pdfUri;
    await Sharing.shareAsync(ensureFileUri(finalUri), {
      mimeType: 'application/pdf',
      dialogTitle: friendlyName,
      UTI: 'com.adobe.pdf',
    });
    await recordShare();
    try { await FileSystem.deleteAsync(finalUri, { idempotent: true }); } catch {}
  };

  // Upload photos to Drive or Dropbox and share the resulting folder URL.
  // Both providers serve a single "anyone with the link can view" folder
  // link; we don't try to add per-file ACLs, just inherit from the folder.
  const sharePhotosAsLink = async (urls) => {
    const provider = shareLinkProvider;
    const isAppleConnected = !!(connectedAccounts || []).find(
      a => a.accountType === 'apple' && a.isActive
    );
    if (provider === 'google' && !isAuthenticated) {
      Alert.alert(
        'Google Drive not connected',
        'Connect Google Drive in Settings to share a link.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
        ]
      );
      return;
    }
    if (provider === 'dropbox' && !dropboxAuthService.isAuthenticated()) {
      Alert.alert(
        'Dropbox not connected',
        'Connect Dropbox in Settings to share a link.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
        ]
      );
      return;
    }
    if (provider === 'apple' && !isAppleConnected) {
      Alert.alert(
        'iCloud Drive not connected',
        'Turn on iCloud Drive sync for ProofPix in Settings to use this option.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
        ]
      );
      return;
    }

    const providerLabel = provider === 'google' ? 'Google Drive' : provider === 'dropbox' ? 'Dropbox' : 'iCloud Drive';
    const safeName = (projectToShare?.name || 'ProofPix Project').replace(/[\\/:*?"<>|]/g, '_');
    setShareStatus(`Uploading to ${providerLabel}...`);

    let shareUrl = '';
    if (provider === 'apple') {
      // iCloud: there's no app-facing API for a public URL. We copy
      // photos into the app's iCloud-synced Documents directory and
      // point the user at the Files app to share the folder by hand.
      const proofPixPath = await iCloudService.findOrCreateProofPixFolder();
      const albumPath = `${proofPixPath}${safeName}/`;
      const info = await FileSystem.getInfoAsync(albumPath);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(albumPath, { intermediates: true });
      }
      for (let i = 0; i < urls.length; i++) {
        setShareStatus(`Uploading ${i + 1}/${urls.length} to iCloud Drive...`);
        const filename = urls[i].split('/').pop() || `photo_${i}.jpg`;
        const cleanUri = urls[i].startsWith('file://') ? urls[i] : `file://${urls[i]}`;
        try {
          await FileSystem.copyAsync({ from: cleanUri, to: `${albumPath}${filename}` });
        } catch (e) {
          console.warn('[Projects] iCloud copy failed for', filename, e?.message);
        }
      }
      await recordShare();
      Alert.alert(
        'Saved to iCloud Drive',
        `Photos are in iCloud Drive → ProofPix-Uploads → ${safeName}. Open the Files app to share the folder.`,
        [
          { text: 'OK', style: 'cancel' },
          {
            text: 'Open Files',
            onPress: () => {
              try { Linking.openURL('shareddocuments://'); } catch {}
            },
          },
        ]
      );
      return;
    }
    if (provider === 'google') {
      const rootId = await googleDriveService.findOrCreateProofPixFolder();
      const uniqueAlbumName = await googleDriveService.findUniqueAlbumName(rootId, safeName);
      const albumId = await googleDriveService.findOrCreateAlbumFolder(rootId, uniqueAlbumName);
      for (let i = 0; i < urls.length; i++) {
        setShareStatus(`Uploading ${i + 1}/${urls.length} to Google Drive...`);
        const filename = urls[i].split('/').pop() || `photo_${i}.jpg`;
        await googleDriveService.uploadFileFromUri(urls[i], filename, albumId, 'image/jpeg');
      }
      setShareStatus('Generating shareable link...');
      shareUrl = await googleDriveService.createShareableFolderLink(albumId);
    } else {
      const rootPath = await dropboxService.findOrCreateProofPixFolder();
      const albumPath = await dropboxService.findOrCreateAlbumFolder(rootPath, safeName);
      for (let i = 0; i < urls.length; i++) {
        setShareStatus(`Uploading ${i + 1}/${urls.length} to Dropbox...`);
        const filename = urls[i].split('/').pop() || `photo_${i}.jpg`;
        await dropboxService.uploadFile(`${albumPath}/${filename}`, urls[i]);
      }
      setShareStatus('Generating shareable link...');
      shareUrl = await dropboxService.createSharedLink(albumPath);
    }

    if (!shareUrl) {
      throw new Error('No share URL returned by provider.');
    }

    // Copy to clipboard as a safety net, then hand to the native share
    // sheet so the user can paste into iMessage, Mail, Slack, etc.
    //
    // IMPORTANT: pass the URL as text inside `message` only — NOT in the
    // `url` field. On iOS the `url` activity item is treated as a
    // downloadable resource, so AirDrop / Mail / Files try to fetch the
    // page contents and end up grabbing the Drive/Dropbox download
    // instead of just sharing the link. Sending text keeps it a link.
    try {
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(shareUrl);
    } catch {}
    await RNShareDialog.share({
      title: safeName,
      message: `${safeName}\n${shareUrl}`,
    });
    await recordShare();
    Alert.alert('Link ready', 'The share link was also copied to your clipboard.');
  };

  const startSharingWithOptions = async () => {
    if (!projectToShare) return;
    const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
    if (!allowed) {
      setShareOptionsVisible(false);
      return;
    }
    try {
      setSharing(true);
      setShareOptionsVisible(false);

      const sourcePhotos = getPhotosByProject(projectToShare.id);
      const sharePhotos = []; // {uri, mode, id} objects for labeling

      if (selectedShareTypes.before) {
        sourcePhotos.filter(p => p.mode === 'before' && p.uri).forEach(p => sharePhotos.push({ uri: p.uri, mode: p.mode, id: p.id }));
      }
      if (selectedShareTypes.after) {
        sourcePhotos.filter(p => p.mode === 'after' && p.uri).forEach(p => sharePhotos.push({ uri: p.uri, mode: p.mode, id: p.id }));
      }
      if (selectedShareTypes.combined) {
        // Add combined photos directly from PhotoContext (already generated at capture time)
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before');
        for (const beforePhoto of beforePhotos) {
          const combinedPhoto = photos.find(p => p.mode === PHOTO_MODES.COMBINED && p.beforePhotoId === beforePhoto.id);
          if (combinedPhoto) {
            sharePhotos.push({ uri: combinedPhoto.uri, mode: combinedPhoto.mode, id: combinedPhoto.id });
          }
        }
      }

      if (sharePhotos.length === 0) {
        Alert.alert('No Photos', 'Please select at least one photo type to share.');
        setSharing(false);
        return;
      }
      // Starter tier is single-photo share only. This screen's "Share
      // project" flow expands into 1..N photos (before/after/combined
      // toggles), so if more than one photo lands in the batch and the
      // user is on Starter, bounce to paywall.
      if (sharePhotos.length > 1 && !canUse(FEATURES.MULTI_PHOTO_SHARE)) {
        setSharing(false);
        setShareOptionsVisible(false);
        navigation.navigate('PlanSelection', {
          mode: 'upgrade',
          trigger: PAYWALL_TRIGGERS.MULTI_PHOTO_SHARE,
        });
        return;
      }

      setShareStatus(t('gallery.preparingPhotos', { defaultValue: 'Preparing photos...' }));

      // Apply labels to photos before sharing (uses cached versions from background service)
      if (showLabels) {
        for (let i = 0; i < sharePhotos.length; i++) {
          try {
            const photo = sharePhotos[i];
            const photoWithType = { ...photo, type: photo.mode };
            const labeledUri = await ensureLabelForPhoto(photoWithType);
            if (labeledUri && labeledUri !== photo.uri) {
              sharePhotos[i] = { ...photo, uri: labeledUri };
            }
          } catch (e) {
            console.warn('[PROJECTS] Label failed for share photo, using original:', e?.message);
          }
        }
      }

      const urls = sharePhotos.map(p => p.uri).filter(Boolean);

      if (shareFormat === 'pdf') {
        await sharePhotosAsPdf(urls, sharePhotos);
      } else if (shareFormat === 'link') {
        await sharePhotosAsLink(urls);
      } else if (shareFormat === 'zip') {
        setShareStatus(t('gallery.zippingPhotos', { defaultValue: `Zipping ${urls.length} photos...`, count: urls.length }));
        const zip = new JSZip();
        for (const uri of urls) {
          const fileName = uri.split('/').pop() || `photo_${Date.now()}.jpg`;
          const fileData = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          zip.file(fileName, fileData, { base64: true });
        }
        const zipContent = await zip.generateAsync({ type: 'base64' });
        const zipFileName = `${projectToShare.name || 'photos'}_${Date.now()}.zip`;
        const zipUri = `${FileSystem.cacheDirectory}${zipFileName}`;
        await FileSystem.writeAsStringAsync(zipUri, zipContent, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Sharing.shareAsync(ensureFileUri(zipUri), {
          mimeType: 'application/zip',
          dialogTitle: zipFileName,
        });
        await recordShare();
        await FileSystem.deleteAsync(zipUri, { idempotent: true });
      } else if (urls.length === 1) {
        await Sharing.shareAsync(ensureFileUri(urls[0]), {
          mimeType: 'image/jpeg',
          dialogTitle: 'Share Photo',
        });
        await recordShare();
      } else if (urls.length > 1) {
        // Share multiple photos via react-native-share using temp file copies
        setShareStatus(t('gallery.preparingPhotos', { defaultValue: `Preparing ${urls.length} photos...`, count: urls.length }));
        const tempDir = `${FileSystem.cacheDirectory}share_temp_${Date.now()}/`;
        await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
        const tempUris = [];
        for (let i = 0; i < urls.length; i++) {
          const fileName = urls[i].split('/').pop() || `photo_${i}.jpg`;
          const tempPath = `${tempDir}${fileName}`;
          await FileSystem.copyAsync({ from: urls[i], to: tempPath });
          tempUris.push(ensureFileUri(tempPath));
        }
        await RNShare.open({
          urls: tempUris,
          type: 'image/jpeg',
          failOnCancel: false,
        });
        await recordShare();
        // Clean up temp files
        await FileSystem.deleteAsync(tempDir, { idempotent: true });
      }
    } catch (error) {
      if (error?.message === 'User did not share' || error?.dismissedAction) return;
      console.error('[PROJECTS] Share error:', error);
      Alert.alert('Share Error', 'Failed to share photos. Please try again.');
    } finally {
      setSharing(false);
      setShareStatus('');
      setProjectToShare(null);
    }
  };

  const handleUploadProject = (project) => {
    const projectPhotos = getPhotosByProject(project.id);
    if (projectPhotos.length === 0) {
      Alert.alert(t('gallery.noPhotosTitle'), t('gallery.noPhotosToUpload', { defaultValue: 'No photos to upload in this project.' }));
      return;
    }

    const isDropboxConnected = dropboxAuthService.isAuthenticated();

    if (!isAuthenticated && !isDropboxConnected) {
      Alert.alert(
        t('gallery.uploadTitle', { defaultValue: 'Upload Photos' }),
        'Please connect your Google or Dropbox account first.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Go to Settings',
            onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }),
          },
        ]
      );
      return;
    }

    // Pre-set upload destinations based on what's connected
    setUploadDestinations({
      google: isAuthenticated,
      dropbox: isDropboxConnected,
    });
    setSelectedUploadTypes({ before: true, after: true, combined: true });
    setProjectToUpload(project);
    setUploadOptionsVisible(true);
  };

  const handleConfirmUpload = async () => {
    if (!projectToUpload) return;
    // Capture the project reference for the AUTH_CODE_UNAVAILABLE retry
    // path — `finally` clears projectToUpload state before the alert
    // callback fires, so state-based re-lookup would find null.
    const projectForRetry = projectToUpload;
    lastUploadedProjectIdRef.current = projectToUpload.id;
    try {
      setUploading(true);
      setUploadOptionsVisible(false);
      setShowCompletionModal(false);
      clearCompletedUploads();
      setIsPreparingUpload(true);
      // NOTE: setShowUploadDetails(true) intentionally moved to the
      // success path — right before startBackgroundUpload — so the
      // "Upload Status" modal only appears when an upload is actually
      // starting. Previously it fired here at the top and stuck around
      // if any downstream validation failed (no photos, no cloud
      // connected, proxy session couldn't init), leaving the user
      // staring at an empty modal that had to be dismissed by tapping
      // through nothing. User report 2026-07-21: modal hung after
      // "Session expired" alert dismissed.

      const sourcePhotos = getPhotosByProject(projectToUpload.id);
      const photosToUpload = [];

      console.log('[PROJECTS_UPLOAD] Selected types:', JSON.stringify(selectedUploadTypes));
      console.log('[PROJECTS_UPLOAD] Source photos in project:', sourcePhotos.length, 'modes:', sourcePhotos.map(p => p.mode));

      // NOTE: `flat: true` is forced at both startBackgroundUpload call
      // sites below, so the per-photo `flatOverride` wrapping that used
      // to gate before/after/combined into their own subfolders is
      // now dead — every photo goes to the project album root. User
      // request 2026-07-21: "remove folders before after and combined
      // - allow all the photos are upload under the project name".
      if (selectedUploadTypes.before) {
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before' && p.uri);
        console.log('[PROJECTS_UPLOAD] Before photos found:', beforePhotos.length);
        beforePhotos.forEach(p => photosToUpload.push(p));
      }
      if (selectedUploadTypes.after) {
        const afterPhotos = sourcePhotos.filter(p => p.mode === 'after' && p.uri);
        console.log('[PROJECTS_UPLOAD] After photos found:', afterPhotos.length);
        afterPhotos.forEach(p => photosToUpload.push(p));
      }

      // Add combined photos directly from PhotoContext (already generated at capture time)
      if (selectedUploadTypes.combined) {
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before');
        console.log('[PROJECTS_UPLOAD] Looking for combined photos for', beforePhotos.length, 'before photos');
        // Log all combined photos in context for debugging
        const allCombined = photos.filter(p => p.mode === PHOTO_MODES.COMBINED || p.mode === 'combined' || p.mode === 'mix');
        console.log('[PROJECTS_UPLOAD] All combined/mix photos in context:', allCombined.length, allCombined.map(p => ({ id: p.id, mode: p.mode, beforePhotoId: p.beforePhotoId, projectId: p.projectId })));
        for (const beforePhoto of beforePhotos) {
          const combinedPhoto = photos.find(p => p.mode === PHOTO_MODES.COMBINED && p.beforePhotoId === beforePhoto.id);
          console.log('[PROJECTS_UPLOAD] Before photo', beforePhoto.id, '→ combined:', combinedPhoto ? combinedPhoto.id : 'NOT FOUND');
          if (combinedPhoto) {
            photosToUpload.push(combinedPhoto);
          }
        }
      }

      console.log('[PROJECTS_UPLOAD] Total photos to upload:', photosToUpload.length, 'modes:', photosToUpload.map(p => p.mode));

      if (photosToUpload.length === 0) {
        Alert.alert('No Photos', 'No photos match the selected types.');
        setUploading(false);
        return;
      }

      const albumName = projectToUpload.name || createAlbumName(userName || 'User', new Date(), null, location);

      // Slice A: team_member branch — routes uploads through the
      // existing dormant team pipeline (backgroundUploadService.
      // processTeamUpload). Gated by isTeamUploadEnabled which
      // checks the master flag + admin-sessionId canary list. Team
      // members don't have their own Google/Dropbox connected, so
      // this must run before the connectivity check below; otherwise
      // the "No Cloud Connected" alert would fire.
      //
      // Admin-storage guard (Slice A.5 pending): the client can't yet
      // tell if the admin uses Google/Dropbox/iCloud. Canary is
      // enabled per-sessionId, so we know out-of-band that canary
      // admins are on Google Drive. Do NOT enable globally until
      // getSessionInfo exposes accountType.
      if (userMode === 'team_member' && isTeamUploadEnabled(teamInfo)) {
        // Slice A.5: capability gate. Even with the canary flag on,
        // only Google-backed admins have a working end-to-end path.
        // Dropbox and iCloud admins get a "coming soon" instead of
        // an upload that would fail on the proxy side. Unknown
        // accountType falls through as "allow" for pre-A.5 members
        // who haven't cold-started to refresh their teamInfo shape.
        const blocked = getTeamUploadBlockedReason(teamInfo);
        if (blocked === 'ADMIN_STORAGE_UNSUPPORTED') {
          setIsPreparingUpload(false);
          setShowUploadDetails(false);
          Alert.alert(
            t('team.upload.comingSoonTitle', { defaultValue: 'Coming soon' }),
            t('team.upload.comingSoonMessage', {
              defaultValue: `Team uploads to ${adminStorageLabel(teamInfo?.adminAccountType)} admins aren't supported yet. Ask your admin to connect Google Drive, or check back soon.`,
              storage: adminStorageLabel(teamInfo?.adminAccountType),
            }),
          );
          return;
        }
        setIsPreparingUpload(false);
        startBackgroundUpload({
          uploadType: 'team',
          teamInfo,
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: true, // Always upload flat under the project album — matches google/dropbox branches (user request 2026-07-21).
          config: {
            accountType: teamInfo?.accountType || 'google',
          },
        });
        return;
      }

      const googleConnected = uploadDestinations.google && isAuthenticated;
      const dropboxConnected = uploadDestinations.dropbox && dropboxAuthService.isAuthenticated();

      if (!googleConnected && !dropboxConnected) {
        setIsPreparingUpload(false);
        Alert.alert(
          t('gallery.noConnectionTitle', { defaultValue: 'No Cloud Connected' }),
          t('gallery.noConnectionMessage', { defaultValue: 'Please connect Google Drive or Dropbox in Settings before uploading.' }),
          [
            { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
            { text: t('settings.goToSettings', { defaultValue: 'Go to Settings' }), onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
          ]
        );
        return;
      }

      if (googleConnected) {
        let sessionId = null;
        let effectiveFolderId = folderId;
        // Capture the specific failure code from initializeProxySession
        // so the alert can tell the user *why* (previously every failure
        // mode surfaced as "session expired" even when the real cause was
        // AUTH_CODE_UNAVAILABLE — user is signed in per isAuthenticated
        // but the silent Google auth refresh failed, requiring a real
        // sign-out/sign-in, not just reconnect).
        let sessionErrorCode = null;
        try {
          const result = await initializeProxySession(folderId, accountType || 'google');
          if (result?.success && result?.sessionId) {
            sessionId = result.sessionId;
            effectiveFolderId = result.folderId || folderId;
          } else if (result && result.error) {
            sessionErrorCode = result.error;
            console.warn('[PROJECTS] Proxy session init returned failure:', result.error);
          }
        } catch (e) {
          sessionErrorCode = e?.message || 'UNKNOWN';
          console.error('[PROJECTS] Failed to init proxy session:', e);
        }

        if (!sessionId) {
          setIsPreparingUpload(false);
          // AUTH_CODE_UNAVAILABLE fires when the silent Google OAuth
          // refresh returns no serverAuthCode. The account shows as
          // connected in Settings because the sign-in record persists,
          // but the one-time serverAuthCode the proxy needs to build
          // an admin session has already been consumed / expired /
          // revoked. Only an INTERACTIVE re-sign-in produces a new
          // serverAuthCode — the "Reconnect" button in Settings runs
          // the same silent refresh and fails identically. So the
          // primary action here is inline "Sign In with Google" which
          // runs signInAsAdmin() (interactive), and on success re-opens
          // the upload sheet with the project pre-selected so the user
          // can immediately retry.
          const isAuthCodeGone = sessionErrorCode === 'AUTH_CODE_UNAVAILABLE';
          if (isAuthCodeGone) {
            Alert.alert(
              'Google Sign-In Needed',
              'Your Google authorization expired. Sign in again to continue uploading.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign In with Google',
                  onPress: async () => {
                    try {
                      const authMod = await import('../services/googleAuthService');
                      const result = await authMod.default.signInAsAdmin();
                      if (result?.success || result?.userInfo) {
                        // Fresh serverAuthCode is now in AsyncStorage.
                        // Force google=true because the AdminContext
                        // isAuthenticated state may not have propagated
                        // yet from the sign-in callback.
                        setUploadDestinations({ google: true, dropbox: dropboxAuthService.isAuthenticated() });
                        setSelectedUploadTypes({ before: true, after: true, combined: true });
                        setProjectToUpload(projectForRetry);
                        setUploadOptionsVisible(true);
                      } else {
                        Alert.alert('Sign-In Failed', result?.error || 'Please try again from Settings → Cloud sync.');
                      }
                    } catch (e) {
                      console.error('[PROJECTS] Interactive Google re-auth failed:', e);
                      Alert.alert('Sign-In Error', e?.message || 'Unknown error. Please try again from Settings.');
                    }
                  },
                },
              ],
            );
          } else {
            Alert.alert(
              'Upload Session Error',
              `Couldn't start the upload (${sessionErrorCode || 'no session'}). Please reconnect your Google account in Settings.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
              ],
            );
          }
          return;
        }

        setIsPreparingUpload(false);
        // Only reveal the Upload Status modal once we know we're
        // actually starting an upload — see the comment at the top of
        // this function.
        setShowUploadDetails(true);
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: true, // Always upload flat under the project album — no before/after/combined subfolders (user request 2026-07-21).
          config: {
            folderId: effectiveFolderId,
            sessionId,
            accountType: accountType || 'google',
            useDirectDrive: true,
          },
        });
      }

      if (dropboxConnected) {
        setIsPreparingUpload(false);
        setShowUploadDetails(true);
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: true, // Always upload flat under the project album — no before/after/combined subfolders (user request 2026-07-21).
          config: {
            accountType: 'dropbox',
          },
        });
      }

    } catch (error) {
      console.error('[PROJECTS] Upload error:', error);
      setIsPreparingUpload(false);
      // Only hide the details modal if we already opened it (Google or
      // Dropbox success path). Defensive — extra hides are cheap.
      setShowUploadDetails(false);
      Alert.alert('Upload Error', 'Failed to upload photos. Please try again.');
    } finally {
      setUploading(false);
      setProjectToUpload(null);
    }
  };

  const handleSelectProject = (project) => {
    setActiveProject(project.id);
    navigation.navigate('ProjectDetail', { projectId: project.id });
  };

  const openNewProjectModal = () => {
    setLocationDenied(false);
    setNewProjectVisible(true);
    // The newProjectVisible useEffect seeds the "Project N" default
    // name and only runs the auto-fill when the persistent
    // `autoUseCurrentLocationForProjects` checkbox is on. That keeps
    // explicit opens and route-driven opens behaving identically.
  };

  const openProjectActions = (project) => {
    setActionSheetProject(project);
  };

  const closeActionSheet = () => setActionSheetProject(null);

  const runSheetAction = (fn) => {
    const proj = actionSheetProject;
    setActionSheetProject(null);
    // Defer so the sheet's exit animation runs first, then the next modal
    // (delete confirm / share / upload) presents cleanly instead of jumping.
    setTimeout(() => fn(proj), 220);
  };

  // Aggregate per-project stats (counters, rooms, latest timestamp, thumbnail,
  // set count) in a single pass so each card render is O(photos-in-project).
  const projectStats = (projectId) => {
    const arr = getPhotosByProject(projectId);
    const counters = { before: 0, progress: 0, after: 0 };
    const rooms = new Set();
    let latestTs = 0;
    let thumbUri = null;
    for (const p of arr) {
      if (p.mode === 'before') counters.before++;
      else if (p.mode === 'progress') counters.progress++;
      else if (p.mode === 'after') counters.after++;
      if (p.room) rooms.add(p.room);
      const ts = typeof p.timestamp === 'number'
        ? p.timestamp
        : (p.createdAt ? new Date(p.createdAt).getTime() : 0);
      if (ts > latestTs) {
        latestTs = ts;
        if (p.uri) thumbUri = p.uri;
      } else if (!thumbUri && p.uri) {
        thumbUri = p.uri;
      }
    }
    const sets = countSets(arr);
    return { count: arr.length, sets, counters, rooms: Array.from(rooms), latestTs, thumbUri };
  };

  // Date-range window for the active chip filter, or null when 'all'.
  // `from` is inclusive, `to` is exclusive.
  // Scope is intentionally day-only (yesterday / today / tomorrow) —
  // the sync itself only pulls jobs in that ±1..+2 day range so
  // week-scope chips would show mostly zeros.
  const dateFilterRange = useMemo(() => {
    if (dateFilter === 'all') return null;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86_400_000;
    switch (dateFilter) {
      case 'yesterday':
        return { from: todayStart - dayMs, to: todayStart };
      case 'today':
        return { from: todayStart, to: todayStart + dayMs };
      case 'tomorrow':
        return { from: todayStart + dayMs, to: todayStart + 2 * dayMs };
      default:
        return null;
    }
  }, [dateFilter]);

  // "When this project matters" timestamp. SF-linked projects prefer
  // the SF scheduled time so a job scheduled for tomorrow lands in
  // the "Tomorrow" bucket even if it was locally created weeks ago.
  const projectFilterTs = (p) => {
    const scheduled = p?.crmJobMeta?.scheduledAt;
    if (typeof scheduled === 'number' && scheduled > 0) return scheduled;
    const created = p?.createdAt;
    if (typeof created === 'number' && created > 0) return created;
    if (typeof created === 'string') {
      const parsed = Date.parse(created);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  // TZ-safe day-bucketing helper. Prefer SF's raw scheduled_date
  // string (YYYY-MM-DD in the workspace's TZ) so a job SF says is
  // "tomorrow" lands in Tomorrow regardless of the device's TZ. Bit
  // us with Katrina Holt 2026-07-28: a job at 00:30 workspace-TZ
  // parsed to a scheduledAt whose device-local day was one day
  // earlier. When scheduledDate is absent (older data or non-SF
  // projects), fall back to the ts-based math projectFilterTs uses.
  const projectDayTs = (p) => {
    const sd = p?.crmJobMeta?.scheduledDate;
    if (typeof sd === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sd)) {
      const [y, m, d] = sd.slice(0, 10).split('-').map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return new Date(y, m - 1, d).getTime();
      }
    }
    return projectFilterTs(p);
  };

  // Compare helper for the "time asc, then name A→Z" sort applied to
  // both filtered lists. Undated projects fall to the bottom (Infinity
  // keeps them out of scheduled work) — deliberate so cleaners see
  // real appointments at the top.
  const compareByTimeThenName = (a, b) => {
    const tsA = projectFilterTs(a) || Number.POSITIVE_INFINITY;
    const tsB = projectFilterTs(b) || Number.POSITIVE_INFINITY;
    if (tsA !== tsB) return tsA - tsB;
    return (a?.name || '').localeCompare(b?.name || '');
  };

  // Split local projects: SF-linked → Team tab, everything else → My tab.
  // Before, SF-synced jobs cluttered My projects even though they're
  // shared workspace work. Admin's manually-created projects stay in
  // My; SF-sourced work moves to Team.
  const localMineProjects = useMemo(
    () => projects.filter((p) => p?.crmProvider !== 'serviceflow'),
    [projects]
  );
  const localSfProjects = useMemo(() => {
    // Dedupe by crmJobId — a stale duplicate can slip in when SF
    // returns the same row twice in one paginated /jobs response;
    // sync-side dedupe was added 2026-07-28 but this is the
    // defensive belt-and-suspenders in case dupes are already
    // sitting in local storage from previous syncs.
    const seen = new Set();
    const out = [];
    for (const p of projects) {
      if (p?.crmProvider !== 'serviceflow') continue;
      const key = p?.crmJobId != null ? String(p.crmJobId) : null;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(p);
    }
    return out;
  }, [projects]);

  const filteredProjects = useMemo(() => {
    let list = localMineProjects;
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
    if (dateFilterRange) {
      list = list.filter((p) => {
        const ts = projectDayTs(p);
        if (!ts) return false;
        return ts >= dateFilterRange.from && ts < dateFilterRange.to;
      });
    }
    return [...list].sort(compareByTimeThenName);
  }, [localMineProjects, searchQuery, dateFilterRange]);

  const getProjectPhotoCount = (projectId) => {
    return getPhotosByProject(projectId).length;
  };

  // ===== Team Projects (admin-only) =====
  // Every admin sees the "Team Projects" tab so the surface is
  // discoverable even before they sign into the team proxy. The tab
  // renders a connect-CTA empty state when there is no proxy session
  // (falls through to fetch + list once one exists). Data lives in
  // Vercel KV on the proxy — populated by syncTeamProject on
  // create/rename AND by the upload endpoint as a backstop (so counts
  // still show up for older member builds that don't publish on
  // create). No photo blobs are fetched — the admin taps
  // "Open in Drive" to inspect the actual folder.
  // Tabs render for EVERYONE. Team projects fetch is still gated on
  // proxySessionId inside fetchTeamProjects, so no wasted network
  // for accounts without a live proxy. The tab bar itself is a
  // free-cost UI element and shipping it unconditionally kills a
  // whole class of "why aren't tabs showing" debugging.
  const showTeamTab = true;
  // Broken-state detector: admin has invited team members but has
  // no cloud backend connected → their photos silently fail to
  // upload. Renders a banner near the top of the Projects screen
  // with a "Fix" CTA that jumps to Cloud Sync. Re-checks on any
  // change to admin state so reconnecting instantly clears it.
  const [teamCloudBroken, setTeamCloudBroken] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (userMode !== 'admin') { setTeamCloudBroken(false); return; }
      if ((inviteTokens?.length || 0) === 0) { setTeamCloudBroken(false); return; }
      try {
        const clouds = await getConnectedClouds({ isAuthenticated, accountType });
        const any = clouds.google || clouds.dropbox || clouds.serviceflow;
        if (!cancelled) setTeamCloudBroken(!any);
      } catch {
        if (!cancelled) setTeamCloudBroken(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userMode, inviteTokens, isAuthenticated, accountType]);

  // Diagnostic: fires on every mount + whenever mode/session change.
  // Includes an OTA tag (bump per push) so we can tell which bundle
  // produced the log in Loki:
  //   {service_name="proofpix-native"} |~ "\[PROJTAB\]"
  useEffect(() => {
    console.warn(
      `[PROJTAB ota=v14-force] mode=${userMode === null ? 'null' : userMode} showTeamTab=${showTeamTab} proxySession=${!!proxySessionId}`,
    );
  }, [userMode, showTeamTab, proxySessionId]);
  const [projectsTab, setProjectsTab] = useState('mine'); // 'mine' | 'team' | 'edits'
  // Slice D.7: "Team edits" tab — flat grid across all team projects
  // of photos where preLabeled=true (originated as a team-member
  // "Send edited copy to admin" bake). Fetched on tab open; each
  // entry is augmented with _sourceProjectId + _sourceProjectName
  // so the per-photo Import action + caption know where they came
  // from without a second lookup.
  const [teamEdits, setTeamEdits] = useState([]);
  const [teamEditsLoading, setTeamEditsLoading] = useState(false);
  const [teamEditsError, setTeamEditsError] = useState(null);
  const [editsViewerPhoto, setEditsViewerPhoto] = useState(null);
  const [teamProjects, setTeamProjects] = useState([]);
  const [teamProjectsLoading, setTeamProjectsLoading] = useState(false);
  const [teamProjectsError, setTeamProjectsError] = useState(null);

  // Slice C+: photo grid + full-res viewer for a specific team
  // project. Fetches via proxyService.getTeamProjectPhotos (which
  // uses the admin's Drive OAuth server-side). Two modals:
  //   1. Grid modal — 3-col FlatList of `=s220` thumbnails
  //   2. Viewer modal — full-res `=s2000` version of a single photo,
  //      opened by tapping a grid tile
  const [tpPhotosProject, setTpPhotosProject] = useState(null);   // project being viewed
  const [tpPhotos, setTpPhotos] = useState([]);
  const [tpPhotosLoading, setTpPhotosLoading] = useState(false);
  const [tpPhotosError, setTpPhotosError] = useState(null);
  const [tpViewerPhoto, setTpViewerPhoto] = useState(null);       // photo shown in viewer
  // Slice D.2: labels-on/off toggle state for the reused EnlargedPhotoViewer
  // when viewing team photos. Defaults to on; kept local for now (no
  // per-photo/per-project persistence). Team-member editing not
  // supported — this is admin's view-only surface with the standard
  // viewer chrome.
  const [tpViewerOverlaysOn, setTpViewerOverlaysOn] = useState(true);
  // Slice D.5: import-to-local state. tpImporting gates the header
  // button; tpImportProgress drives the "Importing X/Y" label so admin
  // can see download progress on large team projects.
  const [tpImporting, setTpImporting] = useState(false);
  const [tpImportProgress, setTpImportProgress] = useState({ done: 0, total: 0 });

  const openTeamProjectPhotos = async (project) => {
    if (!project?.id || !proxySessionId) return;
    setTpPhotosProject(project);
    setTpPhotos([]);
    setTpPhotosError(null);
    setTpPhotosLoading(true);
    try {
      const proxyService = require('../services/proxyService').default;
      const result = await proxyService.getTeamProjectPhotos(proxySessionId, project.id, { limit: 200 });
      setTpPhotos(Array.isArray(result?.photos) ? result.photos : []);
    } catch (err) {
      console.warn('[ProjectsScreen] Failed to load team project photos:', err?.message);
      setTpPhotosError(err?.message || 'Failed to load');
    } finally {
      setTpPhotosLoading(false);
    }
  };

  const closeTeamProjectPhotos = () => {
    setTpPhotosProject(null);
    setTpPhotos([]);
    setTpPhotosError(null);
    setTpViewerPhoto(null);
  };

  // Slice D.5: shared download helper. Returns a caller-shaped
  // downloadPhoto function bound to a resolution choice.
  //   'reduced'  → Drive's =s2000 thumbnail CDN. Fast, no admin OAuth
  //                on the wire from the phone, capped at ~4 MP.
  //   'original' → proxy passthrough that streams the byte-exact
  //                file from Drive using admin's stored refresh token.
  //                Slower + full quality; needs X-Session-Binding
  //                header the same way every other proxy call does.
  // Files are cached per-resolution (localPathForTeamPhoto handles
  // the suffix) so re-imports at the same res don't re-download.
  const makeDownloadPhoto = (resolution, sourceProjectId) => async (tp) => {
    const driveFileId = tp?.id;
    if (!driveFileId) return null;
    const localPath = localPathForTeamPhoto(driveFileId, resolution);
    try {
      const info = await FileSystem.getInfoAsync(localPath);
      if (info.exists) return localPath;
    } catch {}

    if (resolution === 'original') {
      if (!proxySessionId || !sourceProjectId) return null;
      const url = `${PROXY_SERVER_URL}/api/admin/${proxySessionId}/projects/${encodeURIComponent(sourceProjectId)}/photos/${encodeURIComponent(driveFileId)}/download`;
      let bindingSecret = null;
      try { bindingSecret = await readSecureStorage('@proxy_session_binding'); } catch {}
      const result = await FileSystem.downloadAsync(url, localPath, {
        headers: bindingSecret ? { 'X-Session-Binding': bindingSecret } : {},
      });
      if (result.status !== 200) {
        console.warn('[TEAM_IMPORT] original download non-200', { driveFileId, status: result.status });
        return null;
      }
      return localPath;
    }

    // Reduced-resolution path
    const url = swapDriveThumbSize(tp.thumbnailLink, 2000);
    if (!url) return null;
    const result = await FileSystem.downloadAsync(url, localPath);
    if (result.status !== 200) {
      console.warn('[TEAM_IMPORT] reduced download non-200', { driveFileId, status: result.status });
      return null;
    }
    return localPath;
  };

  // Slice D.5: three-way confirmation before an import kicks off.
  // Wraps the standard Alert as a promise so both bulk and per-photo
  // handlers can share the same UX. Returns the chosen resolution
  // ('reduced' | 'original') or null if the user cancelled.
  const promptImportResolution = async (photoCount) => {
    return new Promise((resolve) => {
      const suffix = photoCount === 1 ? '' : 's';
      Alert.alert(
        'Import',
        `Import ${photoCount} photo${suffix}. Choose resolution:\n\n• Reduced (~2000px) — fast, suitable for reports and on-device editing.\n• Original — full quality, larger download.\n\nOriginal files remain in Drive either way.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Reduced', onPress: () => resolve('reduced') },
          { text: 'Original', onPress: () => resolve('original') },
        ],
        { onDismiss: () => resolve(null) },
      );
    });
  };

  // Bulk import — whole team project into a new local project. On
  // completion the modal closes and admin lands on My Projects with
  // the fresh project at the top.
  const handleImportTeamProject = async () => {
    if (!tpPhotosProject || tpPhotos.length === 0) return;
    if (tpImporting) return;

    const resolution = await promptImportResolution(tpPhotos.length);
    if (!resolution) return;

    setTpImporting(true);
    setTpImportProgress({ done: 0, total: tpPhotos.length });
    try {
      const downloadPhoto = makeDownloadPhoto(resolution, tpPhotosProject?.id);
      const result = await importTeamProject({
        teamProject: tpPhotosProject,
        teamPhotos: tpPhotos,
        downloadPhoto,
        createProject,
        addPhoto,
        onProgress: (done, total) => setTpImportProgress({ done, total }),
      });
      closeTeamProjectPhotos();
      setProjectsTab('mine');
      try {
        Alert.alert(
          'Imported',
          `${result.imported} photo${result.imported === 1 ? '' : 's'} imported${result.failed > 0 ? ` (${result.failed} failed)` : ''}.`,
        );
      } catch {}
    } catch (err) {
      console.warn('[ProjectsScreen] Import failed:', err?.message);
      try {
        Alert.alert('Import failed', err?.message || 'Could not import team project.');
      } catch {}
    } finally {
      setTpImporting(false);
      setTpImportProgress({ done: 0, total: 0 });
    }
  };

  // Slice D.5: per-photo import from the EnlargedPhotoViewer's
  // bottom action button. Creates a NEW local project named after
  // the source team project + adds this one photo to it. Admin can
  // rename/move afterward with the standard project actions. Kept
  // simple: no project picker, no add-to-existing — those are
  // reasonable follow-ups if usage warrants.
  const handleImportSingleTeamPhoto = async (viewerPhoto) => {
    if (!tpPhotosProject || !viewerPhoto) return;
    if (tpImporting) return;

    // The viewer photo was adapted for the viewer (thumbnailLink not
    // preserved). Look up the raw team photo record so the download
    // helper has thumbnailLink + type + room + capturedBy.
    const raw = tpPhotos.find((p) => String(p.id) === String(viewerPhoto.id));
    if (!raw) {
      Alert.alert('Import failed', 'Could not resolve this photo. Reopen the project and try again.');
      return;
    }

    const resolution = await promptImportResolution(1);
    if (!resolution) return;

    setTpImporting(true);
    setTpImportProgress({ done: 0, total: 1 });
    try {
      const downloadPhoto = makeDownloadPhoto(resolution, tpPhotosProject?.id);
      const result = await importTeamProject({
        teamProject: tpPhotosProject,
        teamPhotos: [raw],
        downloadPhoto,
        createProject,
        addPhoto,
        onProgress: (done, total) => setTpImportProgress({ done, total }),
      });
      closeTeamProjectPhotos();
      setProjectsTab('mine');
      try {
        Alert.alert(
          'Imported',
          result.imported === 1 ? '1 photo imported.' : 'Photo could not be imported.',
        );
      } catch {}
    } catch (err) {
      console.warn('[ProjectsScreen] Single-photo import failed:', err?.message);
      try {
        Alert.alert('Import failed', err?.message || 'Could not import this photo.');
      } catch {}
    } finally {
      setTpImporting(false);
      setTpImportProgress({ done: 0, total: 0 });
    }
  };

  // Slice D.7: per-photo import from the Team Edits tab viewer. The
  // photo carries its source project id/name in _sourceProjectId /
  // _sourceProjectName from the aggregator, so we can create a
  // local project named after the source without needing the
  // tpPhotosProject state to be set.
  const handleImportSingleEditPhoto = async (viewerPhoto) => {
    if (!viewerPhoto) return;
    if (tpImporting) return;
    const raw = teamEdits.find((p) => String(p.id) === String(viewerPhoto.id));
    if (!raw?._sourceProjectId) {
      try { Alert.alert('Import failed', 'Missing source project info for this photo.'); } catch {}
      return;
    }
    const teamProject = {
      id: raw._sourceProjectId,
      name: raw._sourceProjectName || 'Team edit',
      industry: null,
    };
    const resolution = await promptImportResolution(1);
    if (!resolution) return;
    setTpImporting(true);
    setTpImportProgress({ done: 0, total: 1 });
    try {
      const downloadPhoto = makeDownloadPhoto(resolution, teamProject.id);
      const result = await importTeamProject({
        teamProject,
        teamPhotos: [raw],
        downloadPhoto,
        createProject,
        addPhoto,
        onProgress: (done, total) => setTpImportProgress({ done, total }),
      });
      setEditsViewerPhoto(null);
      setProjectsTab('mine');
      try {
        Alert.alert(
          'Imported',
          result.imported === 1 ? '1 photo imported.' : 'Photo could not be imported.',
        );
      } catch {}
    } catch (err) {
      console.warn('[ProjectsScreen] Single-edit import failed:', err?.message);
      try { Alert.alert('Import failed', err?.message || 'Could not import this photo.'); } catch {}
    } finally {
      setTpImporting(false);
      setTpImportProgress({ done: 0, total: 0 });
    }
  };

  // Slice D+: resolve the photo's type (before/after/combined) from
  // stored meta first, then fall back to parsing the filename
  // suffix. Legacy uploads (before the meta pipeline landed) have no
  // photo.type but do have filenames like "seed_kitchen_12_after.jpg"
  // — the suffix carries the type reliably because uploadService
  // constructs filenames as `${name}_${format!=='default'?format:typeParam}.jpg`.
  const resolveTeamPhotoType = (photo) => {
    if (!photo) return null;
    if (photo.type) {
      const t = String(photo.type).toLowerCase();
      if (t === 'before' || t === 'after' || t === 'combined') return t;
    }
    const name = photo?.name ? String(photo.name).toLowerCase() : '';
    if (/_before(\.[a-z0-9]+)?$/.test(name)) return 'before';
    if (/_after(\.[a-z0-9]+)?$/.test(name)) return 'after';
    if (/_(combined|mix)(\.[a-z0-9]+)?$/.test(name)) return 'combined';
    return null;
  };

  // Slice D: primary caption for a team-uploaded photo. Prefers the
  // room + type pair (set at capture by the team member) and falls
  // back to null so callers can substitute the filename. Kept
  // display-only; the underlying `overrides` object flows through
  // untouched for a future PhotoLabels-overlay renderer.
  const formatTeamPhotoCaption = (photo) => {
    if (!photo) return null;
    const room = photo.room && photo.room !== 'general' ? String(photo.room) : null;
    const rawType = resolveTeamPhotoType(photo);
    const type = rawType === 'combined' ? 'Combined' : rawType === 'before' ? 'Before' : rawType === 'after' ? 'After' : null;
    const parts = [];
    if (room) parts.push(room);
    if (type) parts.push(type);
    return parts.length ? parts.join(' · ') : null;
  };

  // Secondary caption line: capturedBy + "Custom labels" hint when
  // the team member customized label position/color for this photo.
  const formatTeamPhotoSubcaption = (photo) => {
    if (!photo) return null;
    const parts = [];
    if (photo.capturedBy) parts.push(`by ${photo.capturedBy}`);
    if (photo.overrides && typeof photo.overrides === 'object' && Object.keys(photo.overrides).length > 0) {
      parts.push('Custom labels');
    }
    return parts.length ? parts.join(' · ') : null;
  };

  // Slice D.3.2: translate a PhotoLabels position key (e.g. 'top-left',
  // 'bottom-right', 'top-center') into an absolute-positioning style
  // object for grid chip overlays. `combinedHalf` narrows a combined
  // photo's chip to the correct half — the "before" chip's -left/-right
  // key is anchored inside the LEFT half, "after" inside the RIGHT
  // half — matching how the pixel labels sit in a side-by-side layout.
  // Falls back to top-left when the key is unrecognized.
  const chipCornerStyle = (positionKey, combinedHalf = null) => {
    const V = 4;
    const H = 4;
    const s = {};
    const key = String(positionKey || 'top-left').toLowerCase();
    // Vertical anchor
    if (key.startsWith('bottom')) s.bottom = V; else s.top = V;
    // Horizontal anchor. For combined halves, force left of the left
    // half or right of the right half regardless of key's horizontal
    // component (grid tile is only 3-col; a "before-half bottom-right"
    // would visually overlap the "after-half bottom-left" and read as
    // a single chip).
    if (combinedHalf === 'left') s.left = H;
    else if (combinedHalf === 'right') s.right = H;
    else if (key.endsWith('right')) s.right = H;
    else if (key.endsWith('center')) { s.left = 0; s.right = 0; s.alignItems = 'center'; }
    else s.left = H;
    return s;
  };

  // Drive thumbnailLinks look like ".../s220"; swap the suffix to
  // get a higher-res version for the viewer without hitting Drive
  // again (Google's user-content CDN handles the resize).
  const swapDriveThumbSize = (url, size) => {
    if (!url) return url;
    // Handles both =sNNN and /sNNN patterns Google uses across
    // account types + geo-CDN buckets.
    return url.replace(/=s\d+(-[^&?]*)?$/, `=s${size}`).replace(/\/s\d+(\/[^?]*)?$/, `/s${size}$1`);
  };

  // Slice D.2: shape team-photo API objects to what EnlargedPhotoViewer
  // expects. The viewer only requires `id` + `uri` to render a frame
  // and reads `overrides` / `mode` / `room` for the labels overlay via
  // StudioEditOverlays. We DO NOT import these into PhotoContext —
  // usePhotos() inside the viewer returns admin's own live photos and
  // falls back to the raw pool entry when there's no match, which is
  // exactly what we want for team photos.
  const adaptTeamPhotoForViewer = (tp) => {
    const resolvedType = resolveTeamPhotoType(tp);
    return {
      id: tp.id,
      uri: swapDriveThumbSize(tp.thumbnailLink, 2000),
      overrides: tp.overrides || null,
      // Viewer / StudioEditOverlays branch on `mode` for combined vs
      // single-photo label layout; resolveTeamPhotoType normalizes
      // filename suffixes for legacy uploads with no meta.
      mode: resolvedType === 'combined' ? 'combined' : resolvedType || 'single',
      room: tp.room || null,
      capturedBy: tp.capturedBy || null,
      // Slice D.3: preLabeled = true → pixel already has baked labels
      // (chromeBake path or legacy team upload). false → raw pixel;
      // admin viewer's PhotoLabels overlay should render labels on
      // top. null (legacy pre-D.3 upload) → assume baked so the
      // overlay doesn't double-render on top of existing chips.
      preLabeled: tp.preLabeled == null ? true : !!tp.preLabeled,
    };
  };

  const fetchTeamProjects = async ({ userInitiated = false } = {}) => {
    if (!proxySessionId) return;
    if (userInitiated || teamProjects.length === 0) {
      setTeamProjectsLoading(true);
    }
    try {
      setTeamProjectsError(null);
      const proxyService = require('../services/proxyService').default;
      const result = await proxyService.getTeamProjects(proxySessionId);
      const list = Array.isArray(result?.projects) ? result.projects : [];
      setTeamProjects(list);
      // One-shot diagnostic (v15): dump sessionId + full project ID
      // list so we can force-purge stale ghost KV entries from the
      // server side. Grep Loki:
      //   {service_name="proofpix-native"} |~ "\[TEAMDUMP\]"
      try {
        console.warn(
          `[TEAMDUMP v15] session=${proxySessionId} count=${list.length} ids=${JSON.stringify(list.map(p => ({ id: p?.id, name: p?.name, owner: p?.ownerName })))}`,
        );
      } catch {}
    } catch (err) {
      console.warn('[ProjectsScreen] Failed to load team projects:', err?.message);
      setTeamProjectsError(err?.message || 'Failed to load');
    } finally {
      setTeamProjectsLoading(false);
    }
  };

  // Slice D.7: Team edits aggregator. Iterates every team project's
  // photo list, keeps only preLabeled=true rows (edited copies from
  // team-member Studio's "Send to admin"), and augments each with
  // _sourceProjectId + _sourceProjectName. Client-side fan-out is
  // acceptable while team sizes are small — swap for a dedicated
  // proxy aggregator (`/api/admin/:s/team-edits`) if N gets large.
  const fetchTeamEdits = async () => {
    if (!proxySessionId) return;
    setTeamEditsLoading(true);
    setTeamEditsError(null);
    try {
      const proxyService = require('../services/proxyService').default;
      let projectsList = teamProjects;
      if (!projectsList || projectsList.length === 0) {
        try {
          const r = await proxyService.getTeamProjects(proxySessionId);
          projectsList = Array.isArray(r?.projects) ? r.projects : [];
        } catch (_) { projectsList = []; }
      }
      const results = await Promise.all(
        projectsList.map(async (proj) => {
          try {
            const r = await proxyService.getTeamProjectPhotos(proxySessionId, proj.id, { limit: 200 });
            const photos = Array.isArray(r?.photos) ? r.photos : [];
            return photos
              .filter((p) => p?.preLabeled === true)
              .map((p) => ({ ...p, _sourceProjectId: proj.id, _sourceProjectName: proj.name || 'Project' }));
          } catch (e) {
            console.warn('[ProjectsScreen] team-edits fetch failed for project', proj?.id, e?.message);
            return [];
          }
        })
      );
      const flat = results.flat().sort((a, b) => {
        const ta = a?.createdTime ? Date.parse(a.createdTime) : 0;
        const tb = b?.createdTime ? Date.parse(b.createdTime) : 0;
        return tb - ta;
      });
      setTeamEdits(flat);
    } catch (err) {
      console.warn('[ProjectsScreen] fetchTeamEdits failed:', err?.message);
      setTeamEditsError(err?.message || 'Failed to load edits');
    } finally {
      setTeamEditsLoading(false);
    }
  };

  // Refetch team projects when this screen regains focus while the
  // Team tab is active. Without this, an admin who leaves Projects
  // (Home / Settings / etc.) and comes back sees stale data — team
  // members who created a project meanwhile don't appear until the
  // admin manually pulls to refresh or switches tabs.
  useEffect(() => {
    if (!navigation?.addListener) return;
    const unsub = navigation.addListener('focus', () => {
      if (projectsTab === 'team' && showTeamTab) {
        fetchTeamProjects();
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, projectsTab, showTeamTab, proxySessionId]);

  // Fetch on tab switch / session change. Not on mount to avoid a
  // wasted request for admins who never open the Team tab.
  useEffect(() => {
    if (projectsTab === 'team' && showTeamTab) {
      fetchTeamProjects();
      // Also pull the SF cleaner list so the cleaner-filter chip row
      // on Team tab can render real names instead of raw ids.
      // Cached in local state; refreshed on each Team-tab visit.
      (async () => {
        try {
          if (!proxySessionId) return;
          const proxyService = require('../services/proxyService').default;
          const result = await proxyService.listServiceFlowCleaners(proxySessionId);
          const cleaners = Array.isArray(result?.cleaners) ? result.cleaners : [];
          setSfCleanerList(cleaners);
        } catch (e) {
          console.warn('[ProjectsScreen] listServiceFlowCleaners failed:', e?.message);
        }
      })();
    }
    if (projectsTab === 'edits' && showTeamTab) {
      fetchTeamEdits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsTab, showTeamTab, proxySessionId]);

  // If the admin loses proxy access mid-session (signed out from
  // team), snap back to the local tab so the empty Team view doesn't
  // strand them.
  useEffect(() => {
    if (!showTeamTab && (projectsTab === 'team' || projectsTab === 'edits')) setProjectsTab('mine');
  }, [showTeamTab, projectsTab]);

  // Team projects come from the proxy KV store. They carry `updatedAt`
  // as an ISO string (set on create + upload) but no crmJobMeta —
  // fall back to updatedAt for the date-chip filter.
  const teamProjectFilterTs = (p) => {
    if (typeof p?.updatedAt === 'string') {
      const parsed = Date.parse(p.updatedAt);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof p?.updatedAt === 'number') return p.updatedAt;
    return 0;
  };

  const compareByTimeThenNameTeam = (a, b) => {
    const tsA = teamProjectFilterTs(a) || Number.POSITIVE_INFINITY;
    const tsB = teamProjectFilterTs(b) || Number.POSITIVE_INFINITY;
    if (tsA !== tsB) return tsA - tsB;
    return (a?.name || '').localeCompare(b?.name || '');
  };

  // Team tab shows both:
  //   (a) local SF-linked projects (admin's sync of the workspace's
  //       SF jobs) — rendered like My-tab cards, tap opens the project
  //   (b) team-created projects from the proxy KV (what other team
  //       members created + uploaded) — Drive-folder shortcut cards
  // Kept as two separate arrays so the render loop can pick the
  // right card style per source without a discriminator prop.
  const filteredTeamSfProjects = useMemo(() => {
    let list = localSfProjects;
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
    if (dateFilterRange) {
      list = list.filter((p) => {
        const ts = projectDayTs(p);
        if (!ts) return false;
        return ts >= dateFilterRange.from && ts < dateFilterRange.to;
      });
    }
    if (cleanerFilter?.kind === 'sf' && cleanerFilter.id != null) {
      const target = Number(cleanerFilter.id);
      list = list.filter((p) => {
        const primary = p?.crmJobMeta?.teamMemberId;
        if (primary != null && Number(primary) === target) return true;
        const extras = p?.crmJobMeta?.teamMemberIds;
        if (Array.isArray(extras) && extras.some((v) => Number(v) === target)) return true;
        return false;
      });
    } else if (cleanerFilter?.kind === 'cloud') {
      // Cloud chip active — SF projects have no cloud-owner concept
      // (they're pulled from CRM), so scope collapses to empty rather
      // than mixing sources into one filter result.
      list = [];
    }
    return [...list].sort(compareByTimeThenName);
  }, [localSfProjects, searchQuery, dateFilterRange, cleanerFilter]);

  // Cross-source dedupe. Proxy /team/:sessionId/projects keys entries
  // by mobile `id`, so two team members syncing the same SF job land
  // as two distinct KV rows. The admin also has that job as a local
  // SF sync (localSfProjects). Result before this pass: same job
  // renders up to 3× on Team tab. Dedupe strategy:
  //   1) Drop teamProjects whose normalized name matches a local SF
  //      sync — the SF card is the interactive one, admin should see
  //      that, not a redundant Drive-folder shortcut.
  //   2) Within teamProjects, keep the newest row per normalized name.
  // Name is imperfect (mutable, collisions possible) but the proxy
  // doesn't carry crmJobId, so it's the strongest signal we have
  // without a schema change.
  const dedupedTeamProjects = useMemo(() => {
    const sfNames = new Set(
      (localSfProjects || [])
        .map((p) => (p?.name || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const bestByName = new Map();
    for (const p of teamProjects || []) {
      const key = (p?.name || '').trim().toLowerCase();
      if (!key || sfNames.has(key)) continue;
      const prior = bestByName.get(key);
      const currTs = teamProjectFilterTs(p);
      const priorTs = prior ? teamProjectFilterTs(prior) : -Infinity;
      if (!prior || currTs > priorTs) bestByName.set(key, p);
    }
    return Array.from(bestByName.values());
  }, [teamProjects, localSfProjects]);

  // SF card sidecar: for every local SF project on Team tab, find any
  // team-member-uploaded proxy project that represents the same job so
  // the SF card can surface a "Team photos" chip. Two match paths:
  //   - crmJobId (new uploads/syncs after the crmJobId fix land the
  //     field on the proxy KV row + photoMeta)
  //   - name (legacy rows synced before the fix that never got
  //     crmJobId — kept as a fallback so pre-fix uploads don't stay
  //     hidden after the admin ships the OTA)
  // Falls back to the SF project's own crmJobId as the tap-target id
  // when no proxy row exists yet — proxy /photos accepts either id or
  // crmJobId and returns [] when there are no uploads.
  const teamProjectsForSf = useMemo(() => {
    const byCrmJobId = new Map();
    const byName = new Map();
    for (const tp of teamProjects || []) {
      if (tp?.crmJobId != null) {
        const key = String(tp.crmJobId);
        const prior = byCrmJobId.get(key);
        const currTs = teamProjectFilterTs(tp);
        const priorTs = prior ? teamProjectFilterTs(prior) : -Infinity;
        if (!prior || currTs > priorTs) byCrmJobId.set(key, tp);
      }
      const nameKey = (tp?.name || '').trim().toLowerCase();
      if (nameKey) {
        const prior = byName.get(nameKey);
        const currTs = teamProjectFilterTs(tp);
        const priorTs = prior ? teamProjectFilterTs(prior) : -Infinity;
        if (!prior || currTs > priorTs) byName.set(nameKey, tp);
      }
    }
    const out = new Map();
    for (const sf of localSfProjects || []) {
      if (!sf?.id) continue;
      const jobKey = sf?.crmJobId != null ? String(sf.crmJobId) : null;
      const nameKey = (sf?.name || '').trim().toLowerCase();
      const match = (jobKey && byCrmJobId.get(jobKey)) || (nameKey && byName.get(nameKey)) || null;
      if (match) {
        out.set(sf.id, match);
      } else if (jobKey) {
        // No proxy row yet — synthesize one so the chip can still open
        // the viewer against crmJobId (which the proxy resolves to the
        // Drive folder created on the first team upload).
        out.set(sf.id, { id: jobKey, name: sf.name || 'Project', photoCount: 0, _synthetic: true });
      }
    }
    return out;
  }, [teamProjects, localSfProjects]);

  const filteredTeamProjects = useMemo(() => {
    let list = dedupedTeamProjects;
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));
    if (dateFilterRange) {
      list = list.filter((p) => {
        const ts = teamProjectFilterTs(p);
        if (!ts) return false;
        return ts >= dateFilterRange.from && ts < dateFilterRange.to;
      });
    }
    if (cleanerFilter?.kind === 'cloud' && cleanerFilter.name) {
      const target = String(cleanerFilter.name).trim().toLowerCase();
      list = list.filter((p) => String(p?.ownerName || '').trim().toLowerCase() === target);
    } else if (cleanerFilter?.kind === 'sf') {
      // SF chip active — cloud projects have no SF team_member_id
      // linkage, so scope collapses. Mirror of the SF branch above.
      list = [];
    }
    return [...list].sort(compareByTimeThenNameTeam);
  }, [dedupedTeamProjects, searchQuery, dateFilterRange, cleanerFilter]);

  // Per-chip counts for the currently visible tab. Same range math as
  // dateFilterRange so counts always match what a tap on the chip
  // would surface. Surfaced next to each chip label so a "Today: 3"
  // chip is obvious when the user expected 10 — makes sync-vs-filter
  // discrepancies visible without cracking open logs.
  const chipCounts = useMemo(() => {
    // Team tab pools the local SF-linked projects + proxy-KV team
    // projects. My tab is only local non-SF projects (SF-linked moved
    // to Team). Timestamp helper differs per source but we don't need
    // to tag the row — SF rows have crmProvider === 'serviceflow' and
    // proxy rows have updatedAt, so we branch on that.
    const list = projectsTab === 'team'
      ? [...localSfProjects, ...dedupedTeamProjects]
      : localMineProjects;
    const tsFn = (p) => {
      if (p?.crmProvider === 'serviceflow') return projectDayTs(p);
      if (projectsTab === 'team') return teamProjectFilterTs(p);
      return projectDayTs(p);
    };
    const q = searchQuery.trim().toLowerCase();
    const pool = q ? list.filter((p) => (p.name || '').toLowerCase().includes(q)) : list;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 86_400_000;
    const ranges = {
      yesterday: { from: todayStart - dayMs, to: todayStart },
      today: { from: todayStart, to: todayStart + dayMs },
      tomorrow: { from: todayStart + dayMs, to: todayStart + 2 * dayMs },
    };
    const counts = { all: pool.length, yesterday: 0, today: 0, tomorrow: 0 };
    for (const p of pool) {
      const ts = tsFn(p);
      if (!ts) continue;
      for (const key of ['yesterday', 'today', 'tomorrow']) {
        const r = ranges[key];
        if (ts >= r.from && ts < r.to) counts[key] += 1;
      }
    }
    return counts;
  }, [localMineProjects, localSfProjects, dedupedTeamProjects, projectsTab, searchQuery]);

  const handleOpenTeamProjectFolder = async (proj) => {
    const url = proj?.folderUrl
      || (proj?.folderId ? `https://drive.google.com/drive/folders/${proj.folderId}` : null);
    if (!url) {
      Alert.alert(
        t('projects.teamNoFolderTitle', { defaultValue: 'No folder yet' }),
        t('projects.teamNoFolderMessage', {
          defaultValue: 'This project has no uploads yet, so there is no Drive folder to open.',
        }),
      );
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('cannot-open');
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('teamMembers.driveOpenError', { defaultValue: 'Could not open Google Drive.' }),
      );
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          {t('projects.title')}
        </Text>
      </View>

      {teamCloudBroken && (
        <TouchableOpacity
          onPress={() => navigation.navigate('CloudSync')}
          activeOpacity={0.85}
          style={{
            marginHorizontal: 19,
            marginBottom: 10,
            padding: 12,
            borderRadius: 10,
            backgroundColor: '#FBECEC',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: '#E53935',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Ionicons name="warning-outline" size={20} color="#C62828" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 13, fontWeight: '700', color: '#C62828' }}>
              {t('projects.teamCloudBrokenTitle', { defaultValue: 'Team uploads are failing' })}
            </Text>
            <Text style={{ fontFamily: FONTS.ALEXANDRIA, fontSize: 12, color: '#8A1F1F', marginTop: 2 }}>
              {t('projects.teamCloudBrokenBody', {
                defaultValue: 'No cloud is connected. Tap to open Cloud Sync and reconnect Drive, Dropbox, or Service Flow.',
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#C62828" />
        </TouchableOpacity>
      )}

      {showTeamTab && (
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              projectsTab === 'mine' && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => {
              if (isMultiSelectMode) exitMultiSelect();
              setProjectsTab('mine');
            }}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: projectsTab === 'mine' ? theme.textPrimary : theme.textMuted },
              ]}
            >
              {t('projects.tabs.mine', { defaultValue: 'My projects' })}
              {` ${localMineProjects.length}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.tabBtn,
              projectsTab === 'team' && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => {
              if (isMultiSelectMode) exitMultiSelect();
              setProjectsTab('team');
            }}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: projectsTab === 'team' ? theme.textPrimary : theme.textMuted },
              ]}
            >
              {t('projects.tabs.team', { defaultValue: 'Team projects' })}
              {` ${localSfProjects.length + dedupedTeamProjects.length}`}
            </Text>
          </TouchableOpacity>
          {/* Slice D.7: Team edits tab. Flat grid across all team
              projects of photos with preLabeled=true (Studio "Send to
              admin" bakes). Gives admin one-tap access to team-member
              edits without needing to open each project. */}
          <TouchableOpacity
            style={[
              styles.tabBtn,
              projectsTab === 'edits' && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => {
              if (isMultiSelectMode) exitMultiSelect();
              setProjectsTab('edits');
            }}
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: projectsTab === 'edits' ? theme.textPrimary : theme.textMuted },
              ]}
            >
              {t('projects.tabs.edits', { defaultValue: 'Edits' })}
              {` ${teamEdits.length}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isMultiSelectMode && projectsTab === 'mine' ? (
        <View style={[styles.searchRow, { alignItems: 'center' }]}>
          <TouchableOpacity onPress={exitMultiSelect} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={22} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={{ flex: 1, marginLeft: 14, color: theme.textPrimary, fontSize: 16, fontWeight: '600' }}>
            {selectedProjects.size} selected
          </Text>
          <TouchableOpacity
            onPress={() => {
              const allSelected = filteredProjects.length > 0 && selectedProjects.size === filteredProjects.length;
              setSelectedProjects(allSelected ? new Set() : new Set(filteredProjects.map((p) => p.id)));
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginRight: 18 }}
          >
            <Ionicons
              name={filteredProjects.length > 0 && selectedProjects.size === filteredProjects.length ? 'checkbox' : 'square-outline'}
              size={22}
              color={theme.textPrimary}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShareSelected}
            disabled={selectedProjects.size === 0}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ marginRight: 18 }}
          >
            <Ionicons name="share-outline" size={22} color={selectedProjects.size === 0 ? theme.textMuted : theme.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDeleteSelected}
            disabled={selectedProjects.size === 0}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="trash-outline" size={22} color={selectedProjects.size === 0 ? theme.textMuted : '#E53935'} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.searchRow}>
          <View style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="search" size={16} color={theme.textMuted} />
            <TextInput
              placeholder={t('projects.search', { defaultValue: 'Search projects' })}
              placeholderTextColor={theme.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={[styles.searchInput, { color: theme.textPrimary }]}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="close-circle" size={16} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.filterBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setMenuSheetVisible(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
      )}

      {!isMultiSelectMode && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateChipScroll}
          contentContainerStyle={styles.dateChipRow}
        >
          {[
            { key: 'all', label: t('projects.dateFilter.all', { defaultValue: 'All' }) },
            { key: 'yesterday', label: t('projects.dateFilter.yesterday', { defaultValue: 'Yesterday' }) },
            { key: 'today', label: t('projects.dateFilter.today', { defaultValue: 'Today' }) },
            { key: 'tomorrow', label: t('projects.dateFilter.tomorrow', { defaultValue: 'Tomorrow' }) },
          ].map((chip) => {
            const active = dateFilter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                onPress={() => setDateFilter(chip.key)}
                activeOpacity={0.8}
                style={[
                  styles.dateChip,
                  {
                    backgroundColor: active ? theme.accent : theme.surface,
                    borderColor: active ? theme.accent : theme.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateChipText,
                    { color: active ? theme.accentText : theme.textPrimary },
                  ]}
                >
                  {chip.label} {chipCounts[chip.key] ?? 0}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {!isMultiSelectMode && projectsTab === 'team' && (() => {
        // Chip row shows SF cleaners AND distinct cloud owners so admins
        // can filter Team Projects by either backend from one place.
        // Dedupe cloud owner names against SF cleaner names (case-insensitive)
        // to avoid double-listing the same person who works both backends.
        const sfChips = sfCleanerList.map((c) => ({
          kind: 'sf',
          id: c.id,
          label: [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || `Cleaner ${c?.id}`,
        }));
        const sfLabelSet = new Set(sfChips.map((c) => c.label.toLowerCase()));
        const cloudNames = Array.from(new Set(
          (teamProjects || [])
            .map((p) => (p?.ownerName || '').trim())
            .filter((n) => n && !sfLabelSet.has(n.toLowerCase())),
        )).sort((a, b) => a.localeCompare(b));
        const cloudChips = cloudNames.map((name) => ({ kind: 'cloud', name, label: name }));
        const chips = [{ kind: 'all', label: t('projects.cleanerFilter.all', { defaultValue: 'All cleaners' }) }, ...sfChips, ...cloudChips];
        if (chips.length <= 1) return null;
        return (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateChipScroll}
            contentContainerStyle={styles.dateChipRow}
          >
            {chips.map((chip) => {
              const active = chip.kind === 'all'
                ? cleanerFilter == null
                : chip.kind === 'sf'
                  ? cleanerFilter?.kind === 'sf' && Number(cleanerFilter.id) === Number(chip.id)
                  : cleanerFilter?.kind === 'cloud' && cleanerFilter.name === chip.name;
              const key = chip.kind === 'all' ? 'all' : chip.kind === 'sf' ? `sf-${chip.id}` : `cloud-${chip.name}`;
              const nextValue = chip.kind === 'all' ? null : chip.kind === 'sf' ? { kind: 'sf', id: chip.id } : { kind: 'cloud', name: chip.name };
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setCleanerFilter(nextValue)}
                  activeOpacity={0.8}
                  style={[
                    styles.dateChip,
                    {
                      backgroundColor: active ? theme.accent : theme.surface,
                      borderColor: active ? theme.accent : theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.dateChipText,
                      { color: active ? theme.accentText : theme.textPrimary },
                    ]}
                  >
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        );
      })()}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: 20 + insets.bottom + 50 + 24 }]}
      >
        {projectsTab === 'edits' && showTeamTab ? (
          !proxySessionId ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={40} color={theme.textMuted} style={{ marginBottom: 8 }} />
              <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
                {t('projects.teamConnectTitle', { defaultValue: 'Connect your team' })}
              </Text>
            </View>
          ) : teamEditsLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.textMuted} />
              <Text style={{ color: theme.textSecondary, marginTop: 10, fontFamily: FONTS.ALEXANDRIA }}>
                {t('projects.editsLoading', { defaultValue: 'Loading edits…' })}
              </Text>
            </View>
          ) : teamEditsError ? (
            <View style={{ paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center' }}>
              <Ionicons name="alert-circle-outline" size={28} color={theme.textMuted} />
              <Text style={{ color: theme.textPrimary, marginTop: 10, fontFamily: FONTS.ALEXANDRIA, textAlign: 'center' }}>
                {teamEditsError}
              </Text>
              <TouchableOpacity
                onPress={fetchTeamEdits}
                style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.PRIMARY }}
              >
                <Text style={{ color: '#000', fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : teamEdits.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="brush-outline" size={40} color={theme.textMuted} style={{ marginBottom: 8 }} />
              <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
                {t('projects.editsEmptyTitle', { defaultValue: 'No edited copies yet' })}
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
                {t('projects.editsEmptyBody', {
                  defaultValue:
                    'When a team member uses "Send edited copy to admin" from Studio, the edit will appear here.',
                })}
              </Text>
            </View>
          ) : (
            (() => {
              const screenW = Dimensions.get('window').width;
              const cols = 3;
              const gutter = 4;
              const padH = 12;
              const tile = Math.floor((screenW - padH * 2 - gutter * (cols - 1)) / cols);
              return (
                <FlatList
                  data={teamEdits}
                  keyExtractor={(item) => `${item._sourceProjectId}_${item.id}`}
                  numColumns={cols}
                  contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 20 }}
                  columnWrapperStyle={{ gap: gutter }}
                  ItemSeparatorComponent={() => <View style={{ height: gutter }} />}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => setEditsViewerPhoto(item)}
                      style={{ width: tile, height: tile, backgroundColor: theme.surfaceElevated, borderRadius: 6, overflow: 'hidden' }}
                    >
                      {item.thumbnailLink ? (
                        <Image
                          source={{ uri: item.thumbnailLink }}
                          style={{ width: '100%', height: '100%' }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="image-outline" size={20} color={theme.textMuted} />
                        </View>
                      )}
                      {item._sourceProjectName ? (
                        <View style={teamPhotosStyles.gridCaption}>
                          <Text style={teamPhotosStyles.gridCaptionText} numberOfLines={1}>
                            {item._sourceProjectName}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  )}
                />
              );
            })()
          )
        ) : projectsTab === 'team' && showTeamTab ? (
          !proxySessionId ? (
            <View style={styles.emptyState}>
              <Ionicons
                name="people-outline"
                size={40}
                color={theme.textMuted}
                style={{ marginBottom: 8 }}
              />
              <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
                {t('projects.teamConnectTitle', { defaultValue: 'Connect your team' })}
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
                {t('projects.teamConnectBody', {
                  defaultValue:
                    'Sign in to your team account to see projects your team members create and upload to.',
                })}
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('TeamMembers')}
                style={{
                  marginTop: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 20,
                  backgroundColor: theme.accent,
                }}
              >
                <Text style={{ color: theme.accentText, fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' }}>
                  {t('projects.teamConnectCta', { defaultValue: 'Open team settings' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : teamProjectsLoading && teamProjects.length === 0 ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={theme.textMuted} />
              <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary, marginTop: 10 }]}>
                {t('projects.teamLoading', { defaultValue: 'Loading team projects…' })}
              </Text>
            </View>
          ) : teamProjectsError && teamProjects.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
                {t('projects.teamErrorTitle', { defaultValue: 'Could not load' })}
              </Text>
              <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
                {teamProjectsError}
              </Text>
              <TouchableOpacity
                onPress={() => fetchTeamProjects({ userInitiated: true })}
                style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.accent }}
              >
                <Text style={{ color: theme.accentText, fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' }}>
                  {t('common.retry', { defaultValue: 'Retry' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : filteredTeamProjects.length === 0 && filteredTeamSfProjects.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
                {searchQuery.trim()
                  ? t('projects.noMatch', { defaultValue: 'No projects match your search' })
                  : dateFilter !== 'all'
                    ? t('projects.noInRange', { defaultValue: 'No projects in this date range' })
                    : t('projects.teamEmptyTitle', { defaultValue: 'No team projects yet' })}
              </Text>
              {!searchQuery.trim() && dateFilter === 'all' && (
                <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
                  {t('projects.teamEmptyBody', {
                    defaultValue: 'Projects created by your team members will appear here.',
                  })}
                </Text>
              )}
              {!searchQuery.trim() && dateFilter !== 'all' && (
                <TouchableOpacity
                  onPress={() => setDateFilter('all')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginTop: 10 }}
                >
                  <Text style={{ color: theme.accent, fontFamily: FONTS.ALEXANDRIA, fontSize: 13, fontWeight: '600' }}>
                    {t('projects.dateFilter.clear', { defaultValue: 'Show all projects' })}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => fetchTeamProjects({ userInitiated: true })}
                style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}
              >
                <Text style={{ color: theme.textPrimary, fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' }}>
                  {t('common.refresh', { defaultValue: 'Refresh' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.teamRefreshRow}>
                <Text style={[styles.teamRefreshHint, { color: theme.textMuted }]} numberOfLines={1}>
                  {t('projects.teamCount', {
                    count: filteredTeamSfProjects.length + filteredTeamProjects.length,
                    defaultValue: '{{count}} project(s)',
                  })}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <TouchableOpacity
                    onPress={() => {
                      if (!proxySessionId || teamProjects.length === 0) return;
                      Alert.alert(
                        t('projects.teamClearAllTitle', { defaultValue: 'Clear all team projects?' }),
                        t('projects.teamClearAllBody', {
                          defaultValue:
                            'Wipes every project from the shared team list on the server. Live members will re-sync their projects on next create or upload. Use this to purge ghost entries from removed members.',
                        }),
                        [
                          { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                          {
                            text: t('common.clear', { defaultValue: 'Clear' }),
                            style: 'destructive',
                            onPress: async () => {
                              const proxyService = require('../services/proxyService').default;
                              setTeamProjectsLoading(true);
                              try {
                                for (const tp of teamProjects) {
                                  try {
                                    await proxyService.adminDeleteTeamProject(proxySessionId, tp.id);
                                  } catch (e) {
                                    console.warn('[ProjectsScreen] adminDeleteTeamProject failed for', tp.id, e?.message);
                                  }
                                }
                              } finally {
                                await fetchTeamProjects({ userInitiated: true });
                              }
                            },
                          },
                        ],
                      );
                    }}
                    disabled={teamProjectsLoading || teamProjects.length === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={teamProjects.length === 0 ? theme.textMuted : '#E53935'}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => fetchTeamProjects({ userInitiated: true })}
                    disabled={teamProjectsLoading}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {teamProjectsLoading ? (
                      <ActivityIndicator size="small" color={theme.textMuted} />
                    ) : (
                      <Ionicons name="refresh" size={18} color={theme.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
              {filteredTeamSfProjects.map((project) => {
                const stats = projectStats(project.id);
                const scheduledAt = project?.crmJobMeta?.scheduledAt;
                const timeStr = (typeof scheduledAt === 'number' && scheduledAt > 0)
                  ? new Date(scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  : '';
                const isActive = activeProjectId === project.id;
                const cleanerName = project?.crmJobMeta?.customerName || '';
                const teamMirror = teamProjectsForSf.get(project.id);
                // Only show the chip when we have positive evidence of
                // team uploads. `_synthetic` rows are stub placeholders
                // in the map with photoCount=0 — a `Team: 0` chip would
                // clutter every SF card and mislead the admin.
                const teamPhotoCount = teamMirror && !teamMirror._synthetic
                  ? (teamMirror.photoCount || 0)
                  : 0;
                return (
                  <TouchableOpacity
                    key={project.id}
                    activeOpacity={0.7}
                    onPress={() => handleSelectProject(project)}
                    onLongPress={() => openProjectActions(project)}
                    delayLongPress={300}
                    style={[
                      styles.cardNew,
                      { backgroundColor: theme.surface, borderColor: isActive ? theme.cardSelectedBorder : 'transparent' },
                    ]}
                  >
                    <View style={styles.cardRow}>
                      {stats.thumbUri ? (
                        <Image source={{ uri: stats.thumbUri }} style={styles.cardThumb} />
                      ) : (
                        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                          <Ionicons name="briefcase-outline" size={26} color={theme.textMuted} />
                        </View>
                      )}
                      <View style={styles.cardBody}>
                        <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>{project.name}</Text>
                        <Text style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                          {[timeStr, cleanerName, `${stats.count} photo(s)`].filter(Boolean).join(' · ')}
                        </Text>
                        {teamPhotoCount > 0 ? (
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => openTeamProjectPhotos(teamMirror)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            style={[teamPhotosStyles.sfTeamChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
                          >
                            <Ionicons name="people-outline" size={12} color={theme.textSecondary} />
                            <Text style={[teamPhotosStyles.sfTeamChipText, { color: theme.textSecondary }]}>
                              {t('projects.teamPhotosChip', {
                                count: teamPhotoCount,
                                defaultValue: `Team: ${teamPhotoCount} photo(s)`,
                              })}
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                      <TouchableOpacity
                        style={styles.kebabBtn}
                        onPress={() => openProjectActions(project)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons name="ellipsis-vertical" size={18} color={theme.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {filteredTeamProjects.map((tp) => {
                const industry = tp.industry ? getIndustryById(tp.industry) : null;
                const updatedTs = tp.updatedAt ? Date.parse(tp.updatedAt) : 0;
                return (
                  <TouchableOpacity
                    key={tp.id}
                    activeOpacity={0.85}
                    onPress={() => openTeamProjectPhotos(tp)}
                    style={[
                      styles.cardNew,
                      { backgroundColor: theme.surface, borderColor: 'transparent' },
                    ]}
                  >
                    <View style={styles.cardRow}>
                      {/* Slice C: latest-photo thumbnail (Drive-signed
                          URL from the proxy). Falls back to the
                          folder icon when the project has no uploads
                          yet OR when the proxy couldn't fetch a
                          thumbnail (auth failed, folder empty, etc.). */}
                      {tp.latestPhotoThumbnail ? (
                        <View style={[styles.cardThumb, { backgroundColor: theme.surfaceElevated, overflow: 'hidden' }]}>
                          <Image
                            source={{ uri: tp.latestPhotoThumbnail }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        </View>
                      ) : (
                        <View style={[styles.cardThumb, styles.cardThumbPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                          <Ionicons name="folder-outline" size={26} color={theme.textMuted} />
                        </View>
                      )}

                      <View style={styles.cardBody}>
                        <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>
                          {tp.name}
                        </Text>
                        {industry && (
                          <View style={[styles.industryChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                            <Ionicons name={industry.icon} size={11} color={theme.textSecondary} />
                            <Text style={[styles.industryChipText, { color: theme.textSecondary }]} numberOfLines={1}>
                              {t(industry.labelKey, { defaultValue: industry.defaultLabel })}
                            </Text>
                          </View>
                        )}
                        <Text style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                          {t('projects.teamCardMeta', {
                            owner: tp.ownerName || 'Team member',
                            count: tp.photoCount || 0,
                            updated: formatRelative(updatedTs),
                            defaultValue: '{{owner}} · {{count}} photos · {{updated}}',
                          })}
                        </Text>
                        <TouchableOpacity
                          onPress={() => handleOpenTeamProjectFolder(tp)}
                          style={[
                            styles.teamOpenBtn,
                            { borderColor: theme.border, backgroundColor: theme.surfaceElevated },
                          ]}
                          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name="folder-open-outline"
                            size={14}
                            color={tp.folderId ? theme.textPrimary : theme.textMuted}
                          />
                          <Text
                            style={[
                              styles.teamOpenBtnText,
                              { color: tp.folderId ? theme.textPrimary : theme.textMuted },
                            ]}
                          >
                            {tp.folderId
                              ? t('projects.teamOpenInDrive', { defaultValue: 'Open in Drive' })
                              : t('projects.teamNoDriveYet', { defaultValue: 'No uploads yet' })}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )
        ) : projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>{t('projects.noProjects')}</Text>
            <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
              Create your first project to get started
            </Text>
          </View>
        ) : filteredProjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
              {searchQuery.trim()
                ? t('projects.noMatch', { defaultValue: 'No projects match your search' })
                : t('projects.noInRange', { defaultValue: 'No projects in this date range' })}
            </Text>
            {!searchQuery.trim() && dateFilter !== 'all' && (
              <TouchableOpacity
                onPress={() => setDateFilter('all')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ marginTop: 10 }}
              >
                <Text style={{ color: theme.accent, fontFamily: FONTS.ALEXANDRIA, fontSize: 13, fontWeight: '600' }}>
                  {t('projects.dateFilter.clear', { defaultValue: 'Show all projects' })}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          filteredProjects.map((project) => {
            const stats = projectStats(project.id);
            const isActive = activeProjectId === project.id;
            const updatedTs = stats.latestTs || (project.createdAt ? new Date(project.createdAt).getTime() : 0);

            const isSelected = selectedProjects.has(project.id);
            return (
              <TouchableOpacity
                key={project.id}
                style={[
                  styles.cardNew,
                  {
                    backgroundColor: theme.surface,
                    borderColor: isMultiSelectMode && isSelected
                      ? theme.accent
                      : isActive
                        ? theme.cardSelectedBorder
                        : 'transparent',
                  },
                ]}
                onPress={() => {
                  if (isMultiSelectMode) handleProjectPressInSelectMode(project.id);
                  else handleSelectProject(project);
                }}
                onLongPress={() => { if (!isMultiSelectMode) handleProjectLongPress(project.id); }}
                delayLongPress={300}
                activeOpacity={0.7}
              >
                {isMultiSelectMode && (
                  <View style={{ position: 'absolute', top: 10, left: 10, zIndex: 2 }}>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={isSelected ? theme.accent : theme.textMuted}
                    />
                  </View>
                )}
                <View style={styles.cardRow}>
                  {stats.thumbUri ? (
                    <Image source={{ uri: stats.thumbUri }} style={styles.cardThumb} />
                  ) : (
                    <View style={[styles.cardThumb, styles.cardThumbPlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                      <Ionicons name="image-outline" size={26} color={theme.textMuted} />
                    </View>
                  )}

                  <View style={styles.cardBody}>
                    <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>{project.name}</Text>
                    {(() => {
                      const indId = project.industry
                        || inferredIndustryByProject.get(project.id)
                        || defaultIndustryId;
                      const ind = indId ? getIndustryById(indId) : null;
                      if (!ind) return null;
                      return (
                        <View style={[styles.industryChip, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                          <Ionicons name={ind.icon} size={11} color={theme.textSecondary} />
                          <Text style={[styles.industryChipText, { color: theme.textSecondary }]} numberOfLines={1}>
                            {t(ind.labelKey, { defaultValue: ind.defaultLabel })}
                          </Text>
                        </View>
                      );
                    })()}
                    <Text style={[styles.cardMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      {t('projects.cardMeta', { count: stats.count, sets: stats.sets, updated: formatRelative(updatedTs) })}
                    </Text>
                    <View style={styles.countersRow}>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>{t('common.before')}</Text>
                        <Text style={[styles.counterValue, { color: theme.modeBefore }]}>{stats.counters.before}</Text>
                      </View>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>{t('common.progress')}</Text>
                        <Text style={[styles.counterValue, { color: theme.modeProgress }]}>{stats.counters.progress}</Text>
                      </View>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>{t('common.after')}</Text>
                        <Text style={[styles.counterValue, { color: theme.modeAfter }]}>{stats.counters.after}</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.kebabBtn}
                    onPress={() => openProjectActions(project)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>

                {stats.rooms.length > 0 && (
                  <View style={styles.roomChipsRow}>
                    {stats.rooms.slice(0, 5).map((r) => {
                      const data = roomDataMap.get(r);
                      return (
                        <View
                          key={r}
                          style={[styles.roomIconBubble, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
                        >
                          {data?.image ? (
                            <Image source={data.image} style={styles.roomIconBubbleImage} resizeMode="contain" />
                          ) : data?.icon ? (
                            <Text style={{ fontSize: 16 }}>{data.icon}</Text>
                          ) : (
                            <RoomIcon roomId={r} size={18} color={theme.textSecondary} />
                          )}
                        </View>
                      );
                    })}
                    {stats.rooms.length > 5 && (
                      <View style={[styles.roomIconBubble, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                        <Text style={[styles.roomChipText, { color: theme.textSecondary }]}>+{stats.rooms.length - 5}</Text>
                      </View>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Bottom nav moved to PersistentBottomNav (App.js root). */}


      {projectsTab === 'mine' && (
        <TouchableOpacity
          style={[styles.floatingAddButton, { bottom: 20 + insets.bottom + 50 + 16, backgroundColor: theme.accent }]}
          onPress={openNewProjectModal}
        >
          <Ionicons name="add" size={40} color={theme.accentText} />
        </TouchableOpacity>
      )}

      {/* Search-row menu (three-dot icon on the right of the search
          bar). Only bulk-op entry point outside of long-press. Team
          projects live on the proxy KV and are read-only from here, so
          both actions are gated to the My-projects tab. */}
      <Modal
        visible={menuSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuSheetVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setMenuSheetVisible(false)}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          {(() => {
            const onTeamTab = projectsTab === 'team';
            // Delete-all now targets the current tab's projects
            // (SF-linked on Team, non-SF on My). Multi-select mode
            // still assumes filteredProjects (My) — keep gated to My
            // for now until Team-tab multi-select is properly wired.
            const targetLen = onTeamTab ? localSfProjects.length : localMineProjects.length;
            const deleteDisabled = targetLen === 0;
            const selectDisabled = onTeamTab || projects.length === 0;
            const selectColor = selectDisabled ? theme.textMuted : theme.textPrimary;
            const deleteColor = deleteDisabled ? theme.textMuted : theme.danger;
            return (
              <>
                <TouchableOpacity
                  style={[styles.sheetAction, { borderBottomColor: theme.divider }]}
                  disabled={selectDisabled}
                  onPress={() => {
                    setMenuSheetVisible(false);
                    if (selectDisabled) return;
                    setIsMultiSelectMode(true);
                    setSelectedProjects(new Set());
                  }}
                >
                  <Ionicons name="checkmark-done-outline" size={20} color={selectColor} />
                  <Text style={[styles.sheetActionText, { color: selectColor }]}>
                    {t('projects.menuSelect', { defaultValue: 'Select projects' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetAction}
                  disabled={deleteDisabled}
                  onPress={() => {
                    setMenuSheetVisible(false);
                    if (deleteDisabled) return;
                    // Let the sheet slide-out finish before the
                    // Alert opens — iOS misroutes taps when an
                    // Alert lands on top of a still-animating Modal.
                    setTimeout(handleDeleteAllProjects, 250);
                  }}
                >
                  <Ionicons name="trash-outline" size={20} color={deleteColor} />
                  <Text style={[styles.sheetActionText, { color: deleteColor }]}>
                    {t('projects.menuDeleteAll', { defaultValue: 'Delete all projects' })}
                  </Text>
                </TouchableOpacity>
              </>
            );
          })()}
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={() => setMenuSheetVisible(false)}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={!!actionSheetProject}
        transparent
        animationType="slide"
        onRequestClose={closeActionSheet}
      >
        <TouchableWithoutFeedback onPress={closeActionSheet}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {actionSheetProject?.name}
          </Text>
          <TouchableOpacity
            style={[styles.sheetAction, { borderBottomColor: theme.divider }]}
            onPress={() => runSheetAction((p) => handleUploadProject(p))}
          >
            <Ionicons name="cloud-upload-outline" size={20} color={theme.textPrimary} />
            <Text style={[styles.sheetActionText, { color: theme.textPrimary }]}>
              {t('projects.upload', { defaultValue: 'Upload' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetAction, { borderBottomColor: theme.divider }]}
            onPress={() => runSheetAction((p) => handleShareProject(p))}
          >
            <Ionicons name="paper-plane-outline" size={20} color={theme.textPrimary} />
            <Text style={[styles.sheetActionText, { color: theme.textPrimary }]}>
              {t('projects.share', { defaultValue: 'Share' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={() => runSheetAction((p) => handleDeleteProject(p))}
          >
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
            <Text style={[styles.sheetActionText, { color: theme.danger }]}>
              {t('common.delete', { defaultValue: 'Delete' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={closeActionSheet}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* New Project Modal */}
      <Modal
        visible={newProjectVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setNewProjectVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalOverlayTop}>
          <View style={[styles.modalContent, { backgroundColor: theme.surfaceElevated }]}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t('projects.newProject', { defaultValue: 'New Project' })}</Text>
            {/* Project name input with a trailing ✕ button so the
                user can wipe the whole field (auto-filled address or
                typed name) in one tap. */}
            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <TextInput
                ref={newProjectNameRef}
                style={[styles.input, { paddingRight: 38, backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
                placeholder={t('projects.projectNamePlaceholder', { defaultValue: 'Project name' })}
                value={newProjectNamePart}
                onChangeText={(text) => {
                  setNewProjectNamePart(text);
                  if (newProjectNameSelection) setNewProjectNameSelection(null);
                }}
                placeholderTextColor={theme.textMuted}
                selection={newProjectNameSelection}
              />
              {newProjectNamePart?.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setNewProjectNamePart('');
                    setNewProjectNameSelection(null);
                    newProjectNameRef.current?.focus?.();
                  }}
                  style={{
                    position: 'absolute',
                    right: 10,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: theme.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color={theme.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Location row: tap the button for a one-time fill;
                tick the checkbox to always auto-fill new projects with
                the current address (persisted in settings). The two
                controls live on the same row so the relationship —
                button = one-shot, checkbox = persistent — is obvious. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 10,
                gap: 10,
              }}
            >
              <TouchableOpacity
                onPress={() => handleUseCurrentLocationInModal({ interactive: true })}
                disabled={locationLoadingInModal}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  backgroundColor: theme.surface,
                  opacity: locationLoadingInModal ? 0.7 : 1,
                }}
              >
                {locationLoadingInModal ? (
                  <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="locate" size={18} color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                )}
                <Text style={{ fontSize: 13, color: theme.textPrimary }}>
                  {locationLoadingInModal
                    ? t('projects.gettingLocation', { defaultValue: 'Getting location…' })
                    : t('projects.useCurrentLocation', { defaultValue: 'Use current location' })}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={async () => {
                  const next = !autoUseCurrentLocationForProjects;
                  await updateAutoUseCurrentLocationForProjects(next);
                  // Turning on the checkbox = the user agreed to use
                  // the current location for THIS and future projects.
                  // Fill the current field immediately so they see the
                  // address right away.
                  if (next) {
                    handleUseCurrentLocationInModal({ interactive: true });
                  }
                }}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    borderWidth: 2,
                    borderColor: autoUseCurrentLocationForProjects ? COLORS.PRIMARY : theme.borderStrong,
                    backgroundColor: autoUseCurrentLocationForProjects ? COLORS.PRIMARY : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {autoUseCurrentLocationForProjects && (
                    <Ionicons name="checkmark" size={16} color="#000" />
                  )}
                </View>
                <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                  {t('projects.always', { defaultValue: 'Always' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Industry picker — defaults to the onboarding choice but
                lets the user override per-project. Tapping it expands
                an inline list. */}
            <Text style={{ marginTop: 16, marginBottom: 6, fontSize: 13, color: theme.textSecondary, fontWeight: '600' }}>
              {t('projects.industry', { defaultValue: 'Industry' })}
            </Text>
            <TouchableOpacity
              onPress={() => setIndustryPickerOpen((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                backgroundColor: theme.surface,
              }}
              activeOpacity={0.85}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {newProjectIndustry && (
                  <Ionicons
                    name={getIndustryById(newProjectIndustry)?.icon || 'briefcase-outline'}
                    size={18}
                    color={theme.textPrimary}
                  />
                )}
                <Text style={{ fontSize: 14, color: theme.textPrimary }}>
                  {getIndustryById(newProjectIndustry)?.defaultLabel
                    || t('projects.pickIndustry', { defaultValue: 'Pick an industry' })}
                </Text>
              </View>
              <Ionicons
                name={industryPickerOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.textMuted}
              />
            </TouchableOpacity>
            {industryPickerOpen && (
              <View
                style={{
                  marginTop: 6,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 10,
                  maxHeight: 220,
                  backgroundColor: theme.surfaceElevated,
                  overflow: 'hidden',
                }}
              >
                <ScrollView keyboardShouldPersistTaps="handled">
                  {INDUSTRIES.map((ind) => {
                    const active = ind.id === newProjectIndustry;
                    return (
                      <TouchableOpacity
                        key={ind.id}
                        onPress={() => {
                          setNewProjectIndustry(ind.id);
                          setIndustryPickerOpen(false);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 10,
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          backgroundColor: active ? theme.surfaceAccent : 'transparent',
                        }}
                      >
                        <Ionicons name={ind.icon || 'briefcase-outline'} size={18} color={theme.textPrimary} />
                        <Text style={{ flex: 1, fontSize: 14, color: theme.textPrimary }}>
                          {ind.defaultLabel}
                        </Text>
                        {active && <Ionicons name="checkmark" size={16} color="#F2C31B" />}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            <View style={[styles.modalButtons, { marginTop: 24 }]}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel, { backgroundColor: theme.surface }]}
                onPress={() => {
                  setNewProjectNamePart('');
                  setNewProjectVisible(false);
                }}
              >
                <Text style={[styles.modalButtonTextCancel, { color: theme.textPrimary }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCreate]}
                onPress={handleCreateProject}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={styles.modalButtonTextCreate}>{t('projects.create')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && projectToDelete && (
        <DeleteConfirmationModal
          visible={showDeleteConfirm}
          title={t('projects.deleteProject', { defaultValue: 'Delete Project' })}
          message={t('projects.deleteProjectMessage', {
            defaultValue: `Are you sure you want to delete "${projectToDelete.name}"? This will remove the project. Uncheck the box below to keep the photos.`,
            name: projectToDelete.name,
            projectName: projectToDelete.name,
          })}
          onCancel={() => {
            setShowDeleteConfirm(false);
            setProjectToDelete(null);
          }}
          onConfirm={handleDeleteConfirmed}
          deleteFromStorageDefault={false}
        />
      )}

      {/* Upload Details Modal */}
      {showUploadDetails && (
        <UploadDetailsModal
          visible={showUploadDetails}
          onClose={() => {
            setShowUploadDetails(false);
            setIsPreparingUpload(false);
            if (uploadStatus.completedUploads && uploadStatus.completedUploads.length > 0) {
              setShowCompletionModal(true);
            }
          }}
          uploadStatus={uploadStatus}
          onCancelUpload={cancelUpload}
          onMinimize={() => setShowUploadDetails(false)}
          isPreparing={isPreparingUpload}
        />
      )}

      {/* Upload Completion Modal */}
      {showCompletionModal && (
        <UploadCompletionModal
          visible={showCompletionModal}
          completedUploads={uploadStatus.completedUploads || []}
          onClearCompleted={clearCompletedUploads}
          onClose={() => setShowCompletionModal(false)}
          onDeleteProject={async (deleteFromStorage) => {
            const projectId = lastUploadedProjectIdRef.current || activeProjectId;
            if (!projectId) return;
            try {
              await deleteProject(projectId, { deleteFromStorage });
              if (activeProjectId === projectId) {
                const remaining = projects.filter(p => p.id !== projectId);
                setActiveProject(remaining.length > 0 ? remaining[0].id : null);
              }
            } catch (error) {
              Alert.alert(t('common.error'), 'Failed to delete project.');
            }
          }}
        />
      )}

      {/* Share Options Modal */}
      <Modal
        visible={shareOptionsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShareOptionsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShareOptionsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.shareModalContent}>
                {/* Grabber */}
                <View style={styles.grabberContainer}>
                  <View style={styles.modalGrabber} />
                </View>

                {/* Header */}
                <View style={styles.shareModalHeader}>
                  <TouchableOpacity
                    onPress={() => setShareOptionsVisible(false)}
                    style={styles.shareCloseButton}
                  >
                    <Ionicons name="close" size={20} color="#999999" />
                  </TouchableOpacity>
                  <Text style={styles.shareModalTitle}>Choose Shared Formats</Text>
                </View>

                <ScrollView
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Photo Types Section */}
                  <Text style={styles.shareSectionLabel}>Photo types</Text>
                  <View style={styles.shareTypeButtons}>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.before && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, before: !prev.before }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.before && styles.shareTypeButtonTextActive]}>
                        Before
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.after && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, after: !prev.after }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.after && styles.shareTypeButtonTextActive]}>
                        After
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedShareTypes.combined && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedShareTypes(prev => ({ ...prev, combined: !prev.combined }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedShareTypes.combined && styles.shareTypeButtonTextActive]}>
                        Combined
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Advance Options Header */}
                  <TouchableOpacity
                    style={styles.advanceOptionsHeader}
                    onPress={() => setShowAdvancedShareFormats(!showAdvancedShareFormats)}
                  >
                    <Text style={styles.advanceOptionsTitle}>Advance Options</Text>
                    <Ionicons
                      name={showAdvancedShareFormats ? "chevron-up" : "chevron-down"}
                      size={24}
                      color="#1C274C"
                    />
                  </TouchableOpacity>

                  {showAdvancedShareFormats && (
                    <>
                      {/* Stacked Formats */}
                      <Text style={styles.shareFormatLabel}>Stacked formats</Text>
                      <View style={styles.shareFormatButtons}>
                        {[TEMPLATE_TYPES.STACK_PORTRAIT, TEMPLATE_TYPES.STACK_LANDSCAPE, TEMPLATE_TYPES.SQUARE_STACK].map((key) => {
                          const config = TEMPLATE_CONFIGS[key];
                          if (!config) return null;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.shareFormatButton, selectedFormats[key] && styles.shareFormatButtonActive]}
                              onPress={() => handleFormatToggle(key)}
                            >
                              <Text style={[styles.shareFormatButtonText, selectedFormats[key] && styles.shareFormatButtonTextActive]}>
                                {config.name || key}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Divider */}
                      <View style={styles.shareDivider} />

                      {/* Side-by-side Formats */}
                      <Text style={styles.shareFormatLabel}>Side-by-side formats</Text>
                      <View style={styles.shareFormatButtons}>
                        {[TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE, TEMPLATE_TYPES.SIDE_BY_SIDE_WIDE, TEMPLATE_TYPES.BLOG_FORMAT, TEMPLATE_TYPES.SQUARE_SIDE].map((key) => {
                          const config = TEMPLATE_CONFIGS[key];
                          if (!config) return null;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={[styles.shareFormatButton, selectedFormats[key] && styles.shareFormatButtonActive]}
                              onPress={() => handleFormatToggle(key)}
                            >
                              <Text style={[styles.shareFormatButtonText, selectedFormats[key] && styles.shareFormatButtonTextActive]}>
                                {config.name || key}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Format Selector — Pictures / ZIP / PDF / Link */}
                  <Text style={styles.shareSectionLabel}>Share as</Text>
                  <View style={styles.shareFormatButtons}>
                    {[
                      // Project-photos dispatcher (Projects list quick
                      // share). The "files" key shares JPEG(s) through
                      // the system share sheet, so "Pictures" reads
                      // truer to what the recipient receives.
                      { key: 'files', label: 'Pictures' },
                      { key: 'zip', label: 'ZIP' },
                      { key: 'pdf', label: 'PDF' },
                      { key: 'link', label: 'Link' },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={[styles.shareFormatButton, shareFormat === key && styles.shareFormatButtonActive]}
                        onPress={() => setShareFormat(key)}
                      >
                        <Text style={[styles.shareFormatButtonText, shareFormat === key && styles.shareFormatButtonTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Link provider sub-selector (only when format === 'link') */}
                  {shareFormat === 'link' && (
                    <>
                      <Text style={styles.shareSectionLabel}>Link via</Text>
                      {(() => {
                        const isAppleConnected = !!(connectedAccounts || []).find(
                          a => a.accountType === 'apple' && a.isActive
                        );
                        const providers = [
                          { key: 'google', label: 'Google Drive', icon: 'logo-google', connected: !!isAuthenticated, show: true },
                          { key: 'dropbox', label: 'Dropbox', icon: 'cloud-outline', connected: dropboxAuthService.isAuthenticated(), show: true },
                          { key: 'apple', label: 'iCloud Drive', icon: 'logo-apple', connected: isAppleConnected, show: Platform.OS === 'ios' },
                        ].filter(p => p.show);
                        return providers.map(p => (
                          <TouchableOpacity
                            key={p.key}
                            style={[styles.uploadDestRow, shareLinkProvider === p.key && p.connected && styles.uploadDestRowActive]}
                            onPress={() => {
                              if (!p.connected) {
                                setShareOptionsVisible(false);
                                navigation.navigate('Settings', { scrollToCloudSync: true });
                                return;
                              }
                              setShareLinkProvider(p.key);
                            }}
                          >
                            <Ionicons name={p.icon} size={20} color={shareLinkProvider === p.key && p.connected ? '#000' : '#999'} />
                            <Text style={[styles.uploadDestText, shareLinkProvider === p.key && p.connected && styles.uploadDestTextActive]}>
                              {p.label}
                            </Text>
                            {!p.connected && (
                              <Text style={styles.uploadDestHint}>Tap to connect</Text>
                            )}
                            {shareLinkProvider === p.key && p.connected && (
                              <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                            )}
                          </TouchableOpacity>
                        ));
                      })()}
                    </>
                  )}
                </ScrollView>

                {/* Share Now Button */}
                <View style={[styles.shareButtonContainer, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <TouchableOpacity
                    style={styles.shareNowButton}
                    onPress={startSharingWithOptions}
                  >
                    <Text style={styles.shareNowButtonText}>Share Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Upload Options Modal */}
      <Modal
        visible={uploadOptionsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setUploadOptionsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setUploadOptionsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              {/* Sheet — inline theme overrides so the sheet reads on
                  both light and dark. Module-scope `styles` (line ~2989)
                  hardcodes white bg / dark text and MUST NOT reference
                  theme.X directly (theme is undefined at module load,
                  crash → memory feedback_settingsscreen_module_scope).
                  The overrides land as later entries in the style array
                  so they take precedence. */}
              <View style={[styles.shareModalContent, { backgroundColor: theme.surfaceElevated }]}>
                {/* Grabber */}
                <View style={styles.grabberContainer}>
                  <View style={[styles.modalGrabber, { backgroundColor: theme.borderStrong }]} />
                </View>

                {/* Header */}
                <View style={styles.shareModalHeader}>
                  <TouchableOpacity
                    onPress={() => setUploadOptionsVisible(false)}
                    style={[styles.shareCloseButton, { backgroundColor: theme.surface }]}
                  >
                    <Ionicons name="close" size={20} color={theme.textMuted} />
                  </TouchableOpacity>
                  <Text style={[styles.shareModalTitle, { color: theme.textPrimary }]}>Upload Photos</Text>
                </View>

                <ScrollView
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Photo Types Section */}
                  <Text style={[styles.shareSectionLabel, { color: theme.textSecondary }]}>Photo types to upload</Text>
                  <View style={styles.shareTypeButtons}>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, { borderColor: theme.border }, selectedUploadTypes.before && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, before: !prev.before }))}
                    >
                      <Text style={[styles.shareTypeButtonText, { color: selectedUploadTypes.before ? '#000' : theme.textPrimary }]}>
                        Before
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, { borderColor: theme.border }, selectedUploadTypes.after && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, after: !prev.after }))}
                    >
                      <Text style={[styles.shareTypeButtonText, { color: selectedUploadTypes.after ? '#000' : theme.textPrimary }]}>
                        After
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, { borderColor: theme.border }, selectedUploadTypes.combined && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, combined: !prev.combined }))}
                    >
                      <Text style={[styles.shareTypeButtonText, { color: selectedUploadTypes.combined ? '#000' : theme.textPrimary }]}>
                        Combined
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={[styles.shareDivider, { backgroundColor: theme.divider, opacity: 1 }]} />

                  {/* Upload Destinations */}
                  <Text style={[styles.shareSectionLabel, { color: theme.textSecondary }]}>Upload to</Text>

                  {userMode === 'team_member' && isTeamUploadEnabled(teamInfo) ? (
                    // Slice A follow-up: team-upload mode overrides the
                    // destination picker in handleConfirmUpload, so
                    // showing the Google/Dropbox toggles here is
                    // misleading (user picks Dropbox, upload goes to
                    // admin's Google Drive). Render a read-only info
                    // row that reflects what will actually happen.
                    (() => {
                      const at = teamInfo?.adminAccountType;
                      const isComingSoon = at && at !== 'google';
                      return (
                        <View
                          style={[
                            styles.uploadDestRow,
                            { backgroundColor: theme.surface, borderWidth: 1, borderColor: isComingSoon ? theme.border : theme.accent },
                          ]}
                        >
                          <Ionicons
                            name={isComingSoon ? 'time-outline' : 'cloud-upload'}
                            size={20}
                            color={isComingSoon ? theme.textMuted : theme.accent}
                          />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={[styles.uploadDestText, { color: theme.textPrimary, marginLeft: 0 }]}>
                              {isComingSoon
                                ? `${adminStorageLabel(at)} — coming soon`
                                : "Your team admin's Google Drive"}
                            </Text>
                            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                              {isComingSoon
                                ? `Team uploads to ${adminStorageLabel(at)} admins aren't supported yet.`
                                : 'Photos sync to your admin automatically.'}
                            </Text>
                          </View>
                        </View>
                      );
                    })()
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.uploadDestRow, { backgroundColor: theme.surface }, uploadDestinations.google && { backgroundColor: theme.surfaceAccent, borderWidth: 1, borderColor: theme.accent }]}
                        onPress={() => setUploadDestinations(prev => ({ ...prev, google: !prev.google }))}
                      >
                        <Ionicons name="logo-google" size={20} color={uploadDestinations.google ? theme.accent : theme.textMuted} />
                        <Text style={[styles.uploadDestText, { color: uploadDestinations.google ? theme.textPrimary : theme.textMuted }]}>
                          Google Drive
                        </Text>
                        {!isAuthenticated && (
                          <Text style={styles.uploadDestHint}>Not connected</Text>
                        )}
                        {uploadDestinations.google && (
                          <Ionicons name="checkmark-circle" size={22} color={theme.accent} style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.uploadDestRow, { backgroundColor: theme.surface }, uploadDestinations.dropbox && { backgroundColor: theme.surfaceAccent, borderWidth: 1, borderColor: theme.accent }]}
                        onPress={() => setUploadDestinations(prev => ({ ...prev, dropbox: !prev.dropbox }))}
                      >
                        <Ionicons name="cloud-outline" size={20} color={uploadDestinations.dropbox ? theme.accent : theme.textMuted} />
                        <Text style={[styles.uploadDestText, { color: uploadDestinations.dropbox ? theme.textPrimary : theme.textMuted }]}>
                          Dropbox
                        </Text>
                        {!dropboxAuthService.isAuthenticated() && (
                          <Text style={styles.uploadDestHint}>Not connected</Text>
                        )}
                        {uploadDestinations.dropbox && (
                          <Ionicons name="checkmark-circle" size={22} color={theme.accent} style={{ marginLeft: 'auto' }} />
                        )}
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>

                {/* Upload Now Button */}
                <View style={[styles.shareButtonContainer, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <TouchableOpacity
                    style={[styles.shareNowButton, { backgroundColor: theme.accent }, uploading && { opacity: 0.6 }]}
                    onPress={handleConfirmUpload}
                    disabled={uploading}
                  >
                    <Text style={[styles.shareNowButtonText, { color: '#000' }]}>{uploading ? 'Uploading...' : 'Upload Now'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Processing overlay */}
      {sharing && (
        <View style={styles.processingOverlay}>
          <View style={styles.processingBox}>
            <ActivityIndicator size="large" color="#F2C31B" />
            <Text style={styles.processingText}>{shareStatus || t('gallery.sharing', { defaultValue: 'Sharing...' })}</Text>
          </View>
        </View>
      )}

      {/* Slice C+ — Team Project photos grid modal. Opens when admin
          taps a Team Projects card. Renders a 3-column grid of Drive
          thumbnails fetched from the proxy. Tapping a tile opens the
          full-res viewer below. */}
      <Modal
        visible={!!tpPhotosProject}
        transparent
        animationType="slide"
        onRequestClose={() => {
          // Android back button: close viewer first if it's open,
          // otherwise close the whole grid. Prevents an accidental
          // triple-back from a full-res viewer.
          if (tpViewerPhoto) setTpViewerPhoto(null);
          else closeTeamProjectPhotos();
        }}
      >
        <View style={teamPhotosStyles.overlay}>
          <View style={[teamPhotosStyles.sheet, { backgroundColor: theme.surface, paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={teamPhotosStyles.grabberWrap}>
              <View style={[teamPhotosStyles.grabber, { backgroundColor: theme.borderStrong }]} />
            </View>
            <View style={teamPhotosStyles.header}>
              <TouchableOpacity onPress={closeTeamProjectPhotos} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[teamPhotosStyles.title, { color: theme.textPrimary }]} numberOfLines={1}>
                  {tpPhotosProject?.name || ''}
                </Text>
                <Text style={[teamPhotosStyles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                  {(tpPhotosProject?.ownerName || 'Team member')} · {(tpPhotosProject?.photoCount || tpPhotos.length || 0)} photo{(tpPhotosProject?.photoCount || tpPhotos.length) === 1 ? '' : 's'}
                </Text>
                {/* Slice D.5: always-visible resolution disclosure.
                    Import downloads at ~2000px from Drive's thumbnail
                    CDN — plenty for on-device editing + report render,
                    but not byte-exact originals. Making this visible
                    up-front prevents a "why are my imports smaller
                    than what I shot?" support ticket. */}
                {tpPhotos.length > 0 && !tpPhotosLoading ? (
                  <Text style={[teamPhotosStyles.subtitle, { color: theme.textMuted, marginTop: 2, fontSize: 11 }]} numberOfLines={2}>
                    Import saves reduced-resolution copies (~2000px). Originals stay in Drive.
                  </Text>
                ) : null}
              </View>
              {/* Slice D.5: Import to Project — download all team photos
                  to admin's device and create a normal local project.
                  From that point the imported project is owned by the
                  admin and uses the standard Studio / share / report
                  pipelines. Team project remains untouched (staging). */}
              {!tpPhotosLoading && !tpPhotosError && tpPhotos.length > 0 ? (
                <TouchableOpacity
                  onPress={handleImportTeamProject}
                  disabled={tpImporting}
                  style={[teamPhotosStyles.driveBtn, {
                    borderColor: theme.accent,
                    backgroundColor: tpImporting ? theme.surfaceElevated : theme.accent,
                    marginRight: 8,
                    opacity: tpImporting ? 0.7 : 1,
                  }]}
                >
                  <Ionicons name="cloud-download-outline" size={14} color={tpImporting ? theme.textPrimary : (theme.accentText || '#000')} />
                  <Text style={[teamPhotosStyles.driveBtnText, { color: tpImporting ? theme.textPrimary : (theme.accentText || '#000') }]}>
                    {tpImporting
                      ? `Importing ${tpImportProgress.done}/${tpImportProgress.total}`
                      : 'Import'}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {tpPhotosProject?.folderUrl ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(tpPhotosProject.folderUrl)}
                  style={[teamPhotosStyles.driveBtn, { borderColor: theme.border, backgroundColor: theme.surfaceElevated }]}
                >
                  <Ionicons name="folder-open-outline" size={14} color={theme.textPrimary} />
                  <Text style={[teamPhotosStyles.driveBtnText, { color: theme.textPrimary }]}>Drive</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {tpPhotosLoading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.textMuted} />
                <Text style={{ color: theme.textSecondary, marginTop: 10, fontFamily: FONTS.ALEXANDRIA }}>
                  Loading photos…
                </Text>
              </View>
            ) : tpPhotosError ? (
              <View style={{ paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center' }}>
                <Ionicons name="alert-circle-outline" size={28} color={theme.textMuted} />
                <Text style={{ color: theme.textPrimary, marginTop: 10, fontFamily: FONTS.ALEXANDRIA, textAlign: 'center' }}>
                  {tpPhotosError}
                </Text>
                <TouchableOpacity
                  onPress={() => openTeamProjectPhotos(tpPhotosProject)}
                  style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.PRIMARY }}
                >
                  <Text style={{ color: '#000', fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' }}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : tpPhotos.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Ionicons name="images-outline" size={28} color={theme.textMuted} />
                <Text style={{ color: theme.textPrimary, marginTop: 10, fontFamily: FONTS.ALEXANDRIA }}>
                  No photos in this project yet.
                </Text>
              </View>
            ) : (
              (() => {
                // 3-column grid — recompute tile size from the current
                // screen width so it stays crisp on tablets + rotation.
                const screenW = Dimensions.get('window').width;
                const cols = 3;
                const gutter = 4;
                const padH = 12;
                const tile = Math.floor((screenW - padH * 2 - gutter * (cols - 1)) / cols);
                return (
                  <FlatList
                    data={tpPhotos}
                    keyExtractor={(item) => item.id}
                    numColumns={cols}
                    contentContainerStyle={{ paddingHorizontal: padH, paddingBottom: 20 }}
                    columnWrapperStyle={{ gap: gutter }}
                    ItemSeparatorComponent={() => <View style={{ height: gutter }} />}
                    renderItem={({ item }) => {
                      const caption = formatTeamPhotoCaption(item);
                      const resolvedType = resolveTeamPhotoType(item);
                      // Slice D.3.2: derive chip position from the same
                      // source PhotoLabels uses in the enlarged view.
                      // Photo-level override (from team-member snapshot
                      // sent via proxy meta) wins; falls back to admin's
                      // global label position; final fallback is
                      // top-left. Combined uses separate before/after
                      // positions per half.
                      const singlePos = item.overrides?.singleLabelPosition || adminSingleLabelPosition || 'top-left';
                      const beforePos = item.overrides?.beforeLabelPosition || adminBeforeLabelPosition || 'top-left';
                      const afterPos = item.overrides?.afterLabelPosition || adminAfterLabelPosition || 'top-right';
                      const isBeforeOrAfter = resolvedType === 'before' || resolvedType === 'after';
                      const chipLabel = resolvedType === 'before' ? 'Before' : 'After';
                      return (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => setTpViewerPhoto(item)}
                          style={{ width: tile, height: tile, backgroundColor: theme.surfaceElevated, borderRadius: 6, overflow: 'hidden' }}
                        >
                          {item.thumbnailLink ? (
                            <Image
                              source={{ uri: item.thumbnailLink }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="image-outline" size={20} color={theme.textMuted} />
                            </View>
                          )}
                          {isBeforeOrAfter ? (
                            <View style={[teamPhotosStyles.gridTypeChipBase, chipCornerStyle(singlePos)]}>
                              <Text style={teamPhotosStyles.gridTypeChipText}>{chipLabel}</Text>
                            </View>
                          ) : null}
                          {resolvedType === 'combined' ? (
                            <>
                              <View style={[teamPhotosStyles.gridTypeChipBase, chipCornerStyle(beforePos, 'left')]}>
                                <Text style={teamPhotosStyles.gridTypeChipText}>Before</Text>
                              </View>
                              <View style={[teamPhotosStyles.gridTypeChipBase, chipCornerStyle(afterPos, 'right')]}>
                                <Text style={teamPhotosStyles.gridTypeChipText}>After</Text>
                              </View>
                            </>
                          ) : null}
                          {caption ? (
                            <View style={teamPhotosStyles.gridCaption}>
                              <Text style={teamPhotosStyles.gridCaptionText} numberOfLines={1}>
                                {caption}
                              </Text>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      );
                    }}
                  />
                );
              })()
            )}
          </View>

          {/* Slice D.2: reuse the app's standard EnlargedPhotoViewer for
              team-uploaded photos. Team photo objects are adapted to the
              viewer's expected shape (id, uri, overrides, mode, room).
              We hide every destructive/editing action (delete, select,
              edit, share) — admin's team-photo surface is view-only for
              now with just the labels on/off toggle. The viewer is
              layered inside the grid Modal via absoluteFill because RN's
              Modal doesn't reliably nest another Modal cross-platform. */}
          {tpViewerPhoto ? (
            <View style={StyleSheet.absoluteFillObject}>
              <EnlargedPhotoViewer
                photos={tpPhotos.map(adaptTeamPhotoForViewer)}
                initialPhotoId={tpViewerPhoto.id}
                onClose={() => setTpViewerPhoto(null)}
                // Overlays toggle re-enabled with Slice D.3: team uploads
                // now send raw pixels (skipLabelBake), so PhotoLabels
                // overlay is the authoritative renderer and the toggle
                // actually hides labels. Legacy pre-D.3 photos carry
                // preLabeled=true in their adapter output — PhotoFrame
                // skips the overlay for those specifically so they don't
                // double-render.
                showOverlays
                overlaysOn={tpViewerOverlaysOn}
                onOverlaysChange={setTpViewerOverlaysOn}
                // Still hidden: no edit / delete / select on admin's
                // team-photo surface. The bottom-action slot is
                // repurposed for per-photo Import via shareLabel /
                // onShare (Slice D.5) — same import service as the
                // bulk header button, just with a one-item pool.
                showEdit={false}
                showDelete={false}
                showSelect={false}
                shareLabel={tpImporting ? `Importing…` : 'Import photo'}
                onShare={handleImportSingleTeamPhoto}
              />
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Slice D.7: viewer overlay for the Team Edits tab. Rendered
          at ProjectsScreen root (not inside the team-project modal)
          because the Edits tab has no per-project modal — the flat
          grid lives directly in the tab content. Pool is teamEdits
          adapted for the viewer; per-photo Import uses the source
          project pulled from _sourceProjectId. */}
      {editsViewerPhoto ? (
        <View style={StyleSheet.absoluteFillObject}>
          <EnlargedPhotoViewer
            photos={teamEdits.map(adaptTeamPhotoForViewer)}
            initialPhotoId={editsViewerPhoto.id}
            onClose={() => setEditsViewerPhoto(null)}
            showOverlays
            overlaysOn={tpViewerOverlaysOn}
            onOverlaysChange={setTpViewerOverlaysOn}
            showEdit={false}
            showDelete={false}
            showSelect={false}
            shareLabel={tpImporting ? 'Importing…' : 'Import photo'}
            onShare={handleImportSingleEditPhoto}
          />
        </View>
      ) : null}

    </SafeAreaView>
  );
}

// Slice C+ — team project photos grid + full-res viewer styles.
// Kept in its own StyleSheet block so this feature can be cleanly
// extracted into a dedicated component/screen in the future.
const teamPhotosStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    width: '100%',
    maxHeight: '92%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  grabberWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 16, fontFamily: FONTS.ALEXANDRIA, fontWeight: '700' },
  subtitle: { fontSize: 12, fontFamily: FONTS.ALEXANDRIA, marginTop: 2 },
  driveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  driveBtnText: { fontSize: 12, fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' },
  sfTeamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sfTeamChipText: { fontSize: 11, fontFamily: FONTS.ALEXANDRIA, fontWeight: '600' },
  viewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerCloseBtn: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },
  viewerCaption: {
    position: 'absolute',
    left: 20,
    right: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  viewerCaptionText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
  },
  viewerSubcaptionText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
    marginTop: 2,
  },
  gridCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  gridCaptionText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: FONTS.ALEXANDRIA,
    fontWeight: '600',
  },
  // Base style for grid label chips — corner placement is applied
  // separately via chipCornerStyle() so a single style can serve
  // top-left / top-right / bottom-left / bottom-right variants.
  gridTypeChipBase: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#FFD84D',
  },
  gridTypeChipText: {
    color: '#1a1a1a',
    fontSize: 10,
    fontFamily: FONTS.ALEXANDRIA,
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  // Refresh: page background now plain white (was tinted #F6F8FA) per the
  // design's --bg token. Card chrome below sits more cleanly on white.
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 19,
    paddingTop: 16,
    paddingBottom: 12,
  },
  newProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 100,
  },
  newProjectBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 19,
    paddingBottom: 12,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 19,
    marginBottom: 6,
    gap: 20,
  },
  tabBtn: {
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  teamRefreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  teamRefreshHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  teamOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  teamOpenBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    padding: 0,
  },
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateChipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  dateChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 19,
    paddingBottom: 10,
  },
  dateChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateChipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  cardNew: {
    borderRadius: 14,
    borderWidth: 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  cardThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 3,
  },
  cardMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    marginBottom: 8,
  },
  industryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 6,
  },
  industryChipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '500',
    maxWidth: 180,
  },
  countersRow: {
    flexDirection: 'row',
    gap: 16,
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  counterLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
  },
  counterValue: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
  kebabBtn: {
    padding: 6,
  },
  roomChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    paddingLeft: 86,
  },
  roomIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomIconBubbleImage: {
    width: 22,
    height: 22,
  },
  roomChipText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetActionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '500',
  },
  sheetCancel: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 23,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.201242,
    lineHeight: 29,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 120,
  },
  // Refresh pass 8 — design screenshot 28: project rows are taller cards
  // with hairline border + soft shadow-card recipe (replacing the prior
  // heavy 11% black shadow + 2px transparent border). Active project
  // gets the accent border per the existing model.
  projectCard: {
    minHeight: 84,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    shadowColor: '#141420',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ECECEC',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  projectCardActive: {
    borderColor: '#F2C31B',
    borderWidth: 2,
  },
  projectCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectInfo: {
    flex: 1,
  },
  projectName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
    lineHeight: 21,
    marginBottom: 2,
  },
  projectSubtitle: {
    fontSize: 12,
    fontWeight: '300',
    color: '#000000',
    lineHeight: 15,
  },
  projectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  actionIconButton: {
    width: 27,
    height: 27,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  navItemImage:{
    width: 22,
    height: 22,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  bottomNavPill: {
    position: 'absolute',
    bottom: 20,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f4f4',
    borderRadius: 296,
    height: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 90,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
  },
  navItemActive: {
    backgroundColor: '#E0E0E0',
    borderRadius: 100,
    marginHorizontal: -7,
  },
  navItemText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '510',
    color: '#1E1E1E',
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  navItemTextActive: {
    fontWeight: '590',
  },
  floatingAddButton: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'yellow',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 10,
    zIndex: 95,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 24,
    width: '85%',
    maxWidth: 400,
  },
  modalTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    fontFamily: FONTS.ALEXANDRIA,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#F8F8F8',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#F0F0F0',
  },
  modalButtonCreate: {
    backgroundColor: '#F2C31B',
  },
  modalButtonTextCancel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  modalButtonTextCreate: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  loadingContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    minWidth: 200,
  },
  loadingText: {
    fontFamily: FONTS.ALEXANDRIA,
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#000000',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    justifyContent: 'flex-end',
  },
  shareModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -15 },
    shadowOpacity: 0.18,
    shadowRadius: 75,
    elevation: 20,
  },
  grabberContainer: {
    alignItems: 'center',
    paddingTop: 5,
  },
  modalGrabber: {
    width: 36,
    height: 5,
    backgroundColor: '#CCCCCC',
    borderRadius: 100,
  },
  shareModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  shareCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(120, 120, 128, 0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareModalTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    textAlign: 'center',
    marginRight: 44,
    letterSpacing: -0.43,
  },
  shareModalScroll: {
    maxHeight: 500,
  },
  shareModalScrollContent: {
    paddingHorizontal: 19,
    paddingBottom: 20,
  },
  shareSectionLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: COLORS.TEXT,
    marginBottom: 11,
    marginTop: 17,
    lineHeight: 17,
  },
  shareTypeButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  shareTypeButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    backgroundColor: 'transparent',
  },
  shareTypeButtonActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: 'rgba(0, 0, 0, 0.25)',
  },
  shareTypeButtonText: {
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.TEXT,
    lineHeight: 17,
  },
  shareTypeButtonTextActive: {
    color: COLORS.TEXT,
  },
  shareDivider: {
    height: 1,
    backgroundColor: '#000000',
    opacity: 0.15,
    marginTop: 17,
  },
  advanceOptionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 5,
  },
  advanceOptionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.TEXT,
    lineHeight: 17,
  },
  shareFormatLabel: {
    fontSize: 14,
    fontWeight: '300',
    color: COLORS.TEXT,
    marginBottom: 11,
    marginTop: 17,
    lineHeight: 17,
  },
  shareFormatButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  shareFormatButton: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    backgroundColor: 'transparent',
  },
  shareFormatButtonActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: 'rgba(0, 0, 0, 0.25)',
  },
  shareFormatButtonText: {
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.TEXT,
    lineHeight: 17,
  },
  shareFormatButtonTextActive: {
    color: COLORS.TEXT,
  },
  archiveToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
    marginTop: 5,
  },
  archiveToggleLabel: {
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.TEXT,
    lineHeight: 17,
  },
  shareButtonContainer: {
    paddingHorizontal: 19.5,
    paddingBottom: 34,
    paddingTop: 10,
  },
  shareNowButton: {
    backgroundColor: '#000000',
    borderRadius: 100,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  shareNowButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  uploadDestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    marginBottom: 8,
    gap: 12,
  },
  uploadDestRowActive: {
    backgroundColor: '#FFF9E0',
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
  },
  uploadDestText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONTS.ALEXANDRIA,
    color: '#999',
  },
  uploadDestTextActive: {
    color: '#000',
  },
  uploadDestHint: {
    fontSize: 12,
    fontFamily: FONTS.ALEXANDRIA,
    color: '#CC0000',
    marginLeft: 'auto',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  processingBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  processingText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    color: '#333',
  },
});
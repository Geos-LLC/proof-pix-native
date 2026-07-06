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
import { UploadDetailsModal } from '../components/BackgroundUploadStatus';
import UploadCompletionModal from '../components/UploadCompletionModal';
import { LOCATIONS, getLocationName } from '../config/locations';
import { createAlbumName, ensureLabelForPhoto } from '../services/uploadService';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
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
  const [actionSheetProject, setActionSheetProject] = useState(null);
  // Multi-select mode for bulk delete / share. Long-press a card to
  // enter; tap-toggle, then act via the toolbar that replaces the
  // search row.
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  const {
    projects,
    getPhotosByProject,
    deleteProject,
    setActiveProject,
    activeProjectId,
    createProject,
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
  const { userMode, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType, connectedAccounts } = useAdmin();
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
      // Otherwise keep the legacy Gallery jump.
      if (navigateToCameraAfterCreateRef.current) {
        navigateToCameraAfterCreateRef.current = false;
        const firstRoomId = (getRooms() || [])[0]?.id;
        navigation.reset({
          index: 0,
          routes: [{ name: 'Camera', params: { mode: 'before', room: firstRoomId } }],
        });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] });
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
      t('projects.deleteSelectedTitle', { defaultValue: `Delete ${ids.length} project${ids.length === 1 ? '' : 's'}?` }),
      t('projects.deleteSelectedBody', { defaultValue: 'Photos stay in your iOS Photos library. Project records + linked photo metadata in the app will be removed.' }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('common.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            for (const id of ids) {
              try { await deleteProject(id, { deleteFromStorage: false }); }
              catch (e) { console.warn('[ProjectsScreen] bulk delete failed for', id, e?.message); }
            }
            exitMultiSelect();
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
    // Seed link provider default to whichever cloud the user has connected
    // (Google wins ties since most users start there). Without this the
    // selector would default to Google even when only Dropbox is linked.
    if (!isAuthenticated && dropboxAuthService.isAuthenticated()) {
      setShareLinkProvider('dropbox');
    } else {
      setShareLinkProvider('google');
    }
    setShareFormat('files');
    setProjectToShare(project);
    setShareOptionsVisible(true);
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
    lastUploadedProjectIdRef.current = projectToUpload.id;
    try {
      setUploading(true);
      setUploadOptionsVisible(false);
      setShowCompletionModal(false);
      clearCompletedUploads();
      setIsPreparingUpload(true);
      setShowUploadDetails(true);

      const sourcePhotos = getPhotosByProject(projectToUpload.id);
      const photosToUpload = [];

      console.log('[PROJECTS_UPLOAD] Selected types:', JSON.stringify(selectedUploadTypes));
      console.log('[PROJECTS_UPLOAD] Source photos in project:', sourcePhotos.length, 'modes:', sourcePhotos.map(p => p.mode));

      if (selectedUploadTypes.before) {
        const beforePhotos = sourcePhotos.filter(p => p.mode === 'before' && p.uri);
        console.log('[PROJECTS_UPLOAD] Before photos found:', beforePhotos.length);
        beforePhotos.forEach(p => photosToUpload.push(
          useFolderStructure && !enabledFolders.before ? { ...p, flatOverride: true } : p
        ));
      }
      if (selectedUploadTypes.after) {
        const afterPhotos = sourcePhotos.filter(p => p.mode === 'after' && p.uri);
        console.log('[PROJECTS_UPLOAD] After photos found:', afterPhotos.length);
        afterPhotos.forEach(p => photosToUpload.push(
          useFolderStructure && !enabledFolders.after ? { ...p, flatOverride: true } : p
        ));
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
            photosToUpload.push(
              useFolderStructure && !enabledFolders.combined ? { ...combinedPhoto, flatOverride: true } : combinedPhoto
            );
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

      const googleConnected = uploadDestinations.google && isAuthenticated;
      const dropboxConnected = uploadDestinations.dropbox && dropboxAuthService.isAuthenticated();

      if (!googleConnected && !dropboxConnected) {
        setIsPreparingUpload(false);
        setShowUploadDetails(false);
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
        try {
          const result = await initializeProxySession(folderId, accountType || 'google');
          if (result?.success && result?.sessionId) {
            sessionId = result.sessionId;
            effectiveFolderId = result.folderId || folderId;
          }
        } catch (e) {
          console.error('[PROJECTS] Failed to init proxy session:', e);
        }

        if (!sessionId) {
          setIsPreparingUpload(false);
          Alert.alert('Session Error', 'Your upload session has expired. Please reconnect your Google account in Settings.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
          ]);
          return;
        }

        setIsPreparingUpload(false);
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: !useFolderStructure,
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
        startBackgroundUpload({
          items: photosToUpload,
          albumName,
          location: location || '',
          userName: userName || 'User',
          flat: !useFolderStructure,
          config: {
            accountType: 'dropbox',
          },
        });
      }

    } catch (error) {
      console.error('[PROJECTS] Upload error:', error);
      setIsPreparingUpload(false);
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

  const filteredProjects = searchQuery.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : projects;

  const getProjectPhotoCount = (projectId) => {
    return getPhotosByProject(projectId).length;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          {t('projects.title')}
        </Text>
      </View>

      {isMultiSelectMode ? (
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
          >
            <Ionicons name="options-outline" size={18} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: 20 + insets.bottom + 50 + 24 }]}
      >
        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>{t('projects.noProjects')}</Text>
            <Text style={[styles.emptyStateSubtext, { color: theme.textSecondary }]}>
              Create your first project to get started
            </Text>
          </View>
        ) : filteredProjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: theme.textPrimary }]}>
              {t('projects.noMatch', { defaultValue: 'No projects match your search' })}
            </Text>
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
                      {stats.count} {stats.count === 1 ? 'photo' : 'photos'} · {stats.sets} {stats.sets === 1 ? 'set' : 'sets'} · Updated {formatRelative(updatedTs)}
                    </Text>
                    <View style={styles.countersRow}>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>Before</Text>
                        <Text style={[styles.counterValue, { color: theme.modeBefore }]}>{stats.counters.before}</Text>
                      </View>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>Progress</Text>
                        <Text style={[styles.counterValue, { color: theme.modeProgress }]}>{stats.counters.progress}</Text>
                      </View>
                      <View style={styles.counter}>
                        <Text style={[styles.counterLabel, { color: theme.textMuted }]}>After</Text>
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


      <TouchableOpacity
        style={[styles.floatingAddButton, { bottom: 20 + insets.bottom + 50 + 16, backgroundColor: theme.accent }]}
        onPress={openNewProjectModal}
      >
        <Ionicons name="add" size={40} color={theme.accentText} />
      </TouchableOpacity>

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
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('projects.newProject', { defaultValue: 'New Project' })}</Text>
            {/* Project name input with a trailing ✕ button so the
                user can wipe the whole field (auto-filled address or
                typed name) in one tap. */}
            <View style={{ position: 'relative', justifyContent: 'center' }}>
              <TextInput
                ref={newProjectNameRef}
                style={[styles.input, { paddingRight: 38 }]}
                placeholder={t('projects.projectNamePlaceholder', { defaultValue: 'Project name' })}
                value={newProjectNamePart}
                onChangeText={(text) => {
                  setNewProjectNamePart(text);
                  if (newProjectNameSelection) setNewProjectNameSelection(null);
                }}
                placeholderTextColor="#999"
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
                    backgroundColor: '#E5E5E5',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={14} color="#666" />
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
                  backgroundColor: locationLoadingInModal ? '#E8E8E8' : '#F0F0F0',
                }}
              >
                {locationLoadingInModal ? (
                  <ActivityIndicator size="small" color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="locate" size={18} color={COLORS.PRIMARY} style={{ marginRight: 6 }} />
                )}
                <Text style={{ fontSize: 13, color: '#333' }}>
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
                    borderColor: autoUseCurrentLocationForProjects ? COLORS.PRIMARY : '#BBB',
                    backgroundColor: autoUseCurrentLocationForProjects ? COLORS.PRIMARY : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {autoUseCurrentLocationForProjects && (
                    <Ionicons name="checkmark" size={16} color="#000" />
                  )}
                </View>
                <Text style={{ fontSize: 12, color: '#555' }}>
                  {t('projects.always', { defaultValue: 'Always' })}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Industry picker — defaults to the onboarding choice but
                lets the user override per-project. Tapping it expands
                an inline list. */}
            <Text style={{ marginTop: 16, marginBottom: 6, fontSize: 13, color: '#555', fontWeight: '600' }}>
              {t('projects.industry', { defaultValue: 'Industry' })}
            </Text>
            <TouchableOpacity
              onPress={() => setIndustryPickerOpen((v) => !v)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: '#DDD',
                borderRadius: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                backgroundColor: '#FAFAFA',
              }}
              activeOpacity={0.85}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {newProjectIndustry && (
                  <Ionicons
                    name={getIndustryById(newProjectIndustry)?.icon || 'briefcase-outline'}
                    size={18}
                    color="#333"
                  />
                )}
                <Text style={{ fontSize: 14, color: '#333' }}>
                  {getIndustryById(newProjectIndustry)?.defaultLabel
                    || t('projects.pickIndustry', { defaultValue: 'Pick an industry' })}
                </Text>
              </View>
              <Ionicons
                name={industryPickerOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#666"
              />
            </TouchableOpacity>
            {industryPickerOpen && (
              <View
                style={{
                  marginTop: 6,
                  borderWidth: 1,
                  borderColor: '#DDD',
                  borderRadius: 10,
                  maxHeight: 220,
                  backgroundColor: '#FFFFFF',
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
                          backgroundColor: active ? '#FFF4C2' : 'transparent',
                        }}
                      >
                        <Ionicons name={ind.icon || 'briefcase-outline'} size={18} color="#333" />
                        <Text style={{ flex: 1, fontSize: 14, color: '#333' }}>
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
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setNewProjectNamePart('');
                  setNewProjectVisible(false);
                }}
              >
                <Text style={styles.modalButtonTextCancel}>{t('common.cancel')}</Text>
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
            projectName: projectToDelete.name
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
              <View style={styles.shareModalContent}>
                {/* Grabber */}
                <View style={styles.grabberContainer}>
                  <View style={styles.modalGrabber} />
                </View>

                {/* Header */}
                <View style={styles.shareModalHeader}>
                  <TouchableOpacity
                    onPress={() => setUploadOptionsVisible(false)}
                    style={styles.shareCloseButton}
                  >
                    <Ionicons name="close" size={20} color="#999999" />
                  </TouchableOpacity>
                  <Text style={styles.shareModalTitle}>Upload Photos</Text>
                </View>

                <ScrollView
                  style={styles.shareModalScroll}
                  contentContainerStyle={styles.shareModalScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Photo Types Section */}
                  <Text style={styles.shareSectionLabel}>Photo types to upload</Text>
                  <View style={styles.shareTypeButtons}>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedUploadTypes.before && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, before: !prev.before }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedUploadTypes.before && styles.shareTypeButtonTextActive]}>
                        Before
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedUploadTypes.after && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, after: !prev.after }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedUploadTypes.after && styles.shareTypeButtonTextActive]}>
                        After
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareTypeButton, selectedUploadTypes.combined && styles.shareTypeButtonActive]}
                      onPress={() => setSelectedUploadTypes(prev => ({ ...prev, combined: !prev.combined }))}
                    >
                      <Text style={[styles.shareTypeButtonText, selectedUploadTypes.combined && styles.shareTypeButtonTextActive]}>
                        Combined
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Divider */}
                  <View style={styles.shareDivider} />

                  {/* Upload Destinations */}
                  <Text style={styles.shareSectionLabel}>Upload to</Text>

                  <TouchableOpacity
                    style={[styles.uploadDestRow, uploadDestinations.google && styles.uploadDestRowActive]}
                    onPress={() => setUploadDestinations(prev => ({ ...prev, google: !prev.google }))}
                  >
                    <Ionicons name="logo-google" size={20} color={uploadDestinations.google ? '#000' : '#999'} />
                    <Text style={[styles.uploadDestText, uploadDestinations.google && styles.uploadDestTextActive]}>
                      Google Drive
                    </Text>
                    {!isAuthenticated && (
                      <Text style={styles.uploadDestHint}>Not connected</Text>
                    )}
                    {uploadDestinations.google && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.uploadDestRow, uploadDestinations.dropbox && styles.uploadDestRowActive]}
                    onPress={() => setUploadDestinations(prev => ({ ...prev, dropbox: !prev.dropbox }))}
                  >
                    <Ionicons name="cloud-outline" size={20} color={uploadDestinations.dropbox ? '#000' : '#999'} />
                    <Text style={[styles.uploadDestText, uploadDestinations.dropbox && styles.uploadDestTextActive]}>
                      Dropbox
                    </Text>
                    {!dropboxAuthService.isAuthenticated() && (
                      <Text style={styles.uploadDestHint}>Not connected</Text>
                    )}
                    {uploadDestinations.dropbox && (
                      <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </ScrollView>

                {/* Upload Now Button */}
                <View style={[styles.shareButtonContainer, { paddingBottom: Math.max(34, insets.bottom + 16) }]}>
                  <TouchableOpacity
                    style={[styles.shareNowButton, uploading && { opacity: 0.6 }]}
                    onPress={handleConfirmUpload}
                    disabled={uploading}
                  >
                    <Text style={styles.shareNowButtonText}>{uploading ? 'Uploading...' : 'Upload Now'}</Text>
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

    </SafeAreaView>
  );
}

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
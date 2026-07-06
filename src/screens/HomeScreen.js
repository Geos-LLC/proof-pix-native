import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Dimensions,
  PanResponder,
  Modal,
  Alert,
  TextInput,
  ActivityIndicator,
  Switch,
  InteractionManager,
  Platform,
  KeyboardAvoidingView,
  Linking,
  Animated,
  Share as RNShare,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { usePhotos } from '../context/PhotoContext';
import { ROOMS, COLORS, PHOTO_MODES, TEMPLATE_CONFIGS, TEMPLATE_TYPES } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { CroppedThumbnail } from '../components/CroppedThumbnail';
import { StudioEditOverlays } from '../components/StudioOverlays';
import PannableImage from '../components/PannableImage';
import CompareViewer from '../components/CompareViewer';
import CompareModeSwitcher from '../components/CompareModeSwitcher';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system/legacy';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { useAdmin } from '../context/AdminContext';
import { createAlbumName, ensureLabelForPhoto } from '../services/uploadService';
import { compositeImages, addLabelToImage, calculateAfterLabelOffsets } from '../utils/imageCompositor';
import { LOCATIONS, getLocationName } from '../config/locations';
import { useBackgroundUpload } from '../hooks/useBackgroundUpload';
import RoomEditor from '../components/RoomEditor';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { countSets } from '../utils/photoSets';
import { PAYWALL_TRIGGERS } from '../constants/softTrial';
import EnterpriseContactModal from '../components/EnterpriseContactModal';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EnlargedPhotoViewer from '../components/EnlargedPhotoViewer';
import { useUiOverlayReporter } from '../components/uiOverlayState';
import * as ExpoLocation from 'expo-location';
// IAP handled by PlanSelectionScreen
import Constants from 'expo-constants';
import UnfinishedJobBanner from '../components/UnfinishedJobBanner';
import SoftTrialBadge from '../components/SoftTrialBadge';
import QualificationPromptModal, { hasCompletedQualification } from '../components/QualificationPromptModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { INDUSTRIES } from '../constants/industries';

// Pair-preview template helpers — orientation-aware list and aspect-ratio
// lookup. Mirrors the existing PhotoEditor logic but stripped down to what
// the live preview needs (just the frame aspect; no image compositing).
const getAvailablePairTemplates = (beforePhoto) => {
  const phoneOrientation = beforePhoto?.orientation || 'portrait';
  const cameraViewMode = beforePhoto?.cameraViewMode || 'portrait';
  const isLandscape = phoneOrientation === 'landscape' || cameraViewMode === 'landscape';

  // Portrait shots → side-by-side templates feel natural. Landscape shots
  // (or letterbox) → stacked templates plus a few square options. Match
  // the legacy editor's filtering.
  if (isLandscape) {
    return [
      { key: 'original-stack', name: 'Original (stack)' },
      { key: TEMPLATE_TYPES.STACK_LANDSCAPE, name: 'Stack (16:9)' },
      { key: TEMPLATE_TYPES.STACK_PORTRAIT, name: 'Stack (9:16)' },
      { key: TEMPLATE_TYPES.SQUARE_STACK, name: 'Square Stack (1:1)' },
    ];
  }
  return [
    { key: 'original-side', name: 'Original (side)' },
    { key: TEMPLATE_TYPES.SIDE_BY_SIDE_LANDSCAPE, name: 'Side-by-Side (16:9)' },
    { key: TEMPLATE_TYPES.SIDE_BY_SIDE_WIDE, name: 'Wide (2:1)' },
    { key: TEMPLATE_TYPES.SQUARE_SIDE, name: 'Square Side (1:1)' },
    { key: TEMPLATE_TYPES.BLOG_FORMAT, name: 'Blog (16:9)' },
  ];
};

const getPairTemplateAspect = (templateKey, beforePhoto) => {
  if (templateKey === 'original-side') {
    // Two portrait photos side-by-side → 2× wider than tall (rough).
    return 2 / 3 * 2; // 4/3
  }
  if (templateKey === 'original-stack') {
    // Two landscape photos stacked → half as tall as wide.
    return 16 / 9 / 2; // ~0.89
  }
  const cfg = TEMPLATE_CONFIGS[templateKey];
  if (cfg && cfg.width && cfg.height) {
    return cfg.width / cfg.height;
  }
  return 1;
};

// Capture-time + place caption rendered under the preview photo. Uses the
// photo's stored timestamp and the user's saved location setting (the app
// does not record GPS coordinates separately).
const formatPhotoMetaLine = (photo, place) => {
  if (!photo) return '';
  const ts = photo.timestamp ? new Date(photo.timestamp) : null;
  const datePart = ts ? ts.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const timePart = ts ? ts.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  const when = [datePart, timePart].filter(Boolean).join(' ');
  const where = (place || '').trim();
  return [when, where].filter(Boolean).join(' · ');
};
import { logEvent } from '../utils/analytics';

// Ensure a URI has the file:// prefix (expo FileSystem URIs already include it on Android)
const ensureFileUri = (uri) => uri.startsWith('file://') ? uri : `file://${uri}`;

// react-native-share for proper image file sharing (not available in Expo Go)
let Share = {
  open: async () => {
    console.log('[Share] react-native-share not available (likely Expo Go). Share.open call ignored.');
  },
};
if (Constants?.appOwnership !== 'expo') {
  try {
    const shareModule = require('react-native-share');
    Share = shareModule.default || shareModule;
  } catch (e) {
    console.warn('[Share] Failed to load react-native-share:', e?.message);
  }
}

const { width } = Dimensions.get('window');
const PHOTO_SIZE = (width - 60) / 2; // 2 columns - thumbnails MUST be square (1:1)

// Helper to check if aspect ratio is portrait (height > width)
const isPortraitAspectRatio = (aspectRatio) => {
  if (!aspectRatio) return true; // Default to portrait if unknown
  const [w, h] = aspectRatio.split(':').map(Number);
  return h > w; // 3:4, 9:16 etc are portrait
};

// Helper to check if layout should be stacked based on template or aspect ratio
const isStackedLayout = (templateType, aspectRatio) => {
  // First check templateType if available
  if (templateType) {
    const config = TEMPLATE_CONFIGS[templateType];
    if (config?.layout) return config.layout === 'stack';
  }
  // Fallback to aspect ratio - landscape photos should be stacked, portrait should be side-by-side
  // Portrait (3:4, 9:16): side-by-side (vertical divider)
  // Landscape (4:3, 16:9): stacked (horizontal divider)
  return !isPortraitAspectRatio(aspectRatio);
};

// Aspect helpers — hoisted to module scope so both the pager IIFE and
// the tap-to-fullscreen modal can resolve a photo's display aspect the
// same way: Studio pairTemplate first, then the capture-time aspectRatio
// string saved by CameraScreen ("9:16" / "16:9" / "4:3" / "3:4"), then
// originalWidth/Height, finally 0 (fill height fallback).
const PAIR_TEMPLATE_ASPECTS = { square: 1, 'wide-16-9': 16 / 9, 'tall-9-16': 9 / 16, 'wide-2-1': 2, 'tall-1-2': 0.5 };
const parseAspectString = (s) => {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = parseFloat(m[1]);
  const h = parseFloat(m[2]);
  if (!w || !h) return null;
  return w / h;
};
const aspectForPhoto = (p) => {
  if (!p) return 0;
  const tpl = PAIR_TEMPLATE_ASPECTS[p.pairTemplate];
  if (tpl) return tpl;
  const fromStr = parseAspectString(p.aspectRatio);
  if (fromStr) return fromStr;
  if (p.originalWidth && p.originalHeight) return p.originalWidth / p.originalHeight;
  return 0;
};

export default function HomeScreen({ navigation, route }) {
  const { t } = useTranslation();
  const {
    currentRoom,
    setCurrentRoom,
    getBeforePhotos,
    getAfterPhotos,
    getCombinedPhotos,
    getProgressPhotos,
    deletePhotoSet,
    deletePhoto,
  } = usePhotos();

  const [fullScreenPhoto, setFullScreenPhoto] = useState(null);
  // Bare mode = preview with all chrome hidden (just the photo + a small
  // return arrow). Entered by double-tapping the photo INSIDE the preview;
  // exited by tapping the return arrow or swiping the preview closed.
  const [bareMode, setBareMode] = useState(false);
  // Template-driven frame aspect for the comparison-pair preview. Mirrors
  // the legacy PhotoEditor's "Choose Template" row but applied to the live
  // CompareViewer frame so the share output matches what the user sees.
  const [pairTemplate, setPairTemplate] = useState('original-side');
  const [fullScreenPhotoSet, setFullScreenPhotoSet] = useState(null);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [fullScreenPhotos, setFullScreenPhotos] = useState([]);
  const [fullScreenLoading, setFullScreenLoading] = useState(false);
  const [fullScreenError, setFullScreenError] = useState(null);
  // Individual photos in the active set (Before → Progress(es) → After
  // → Combined). Drives the pager + thumb strip in the simple preview.
  const [setMembers, setSetMembers] = useState([]);
  const [setMemberIndex, setSetMemberIndex] = useState(0);
  // Per-preview toggle that reveals the labels Studio bakes onto the
  // share output. Kept local so flipping it here doesn't change the
  // global Settings flag — the user just wants a visual preview of
  // the edits without committing them anywhere.
  const [showStudioEdits, setShowStudioEdits] = useState(false);
  // Photo opened via tap inside the preview pager — drives a simple
  // full-screen modal viewer (image only, tap or chevron to close).
  const [tappedFullPhoto, setTappedFullPhoto] = useState(null);
  // Fires the transient "Set N" flash inside EnlargedPhotoViewer
  // whenever jumpToSet swaps the pool (edge swipe or chip tap).
  const [fullScreenPoolSignal, setFullScreenPoolSignal] = useState({ nonce: 0, label: '' });
  // Tell the PersistentBottomNav to hide itself while the fullscreen
  // viewer is up so the user gets a clean edge-to-edge photo experience
  // (no nav pill floating over the bottom of the image). The reporter
  // is reference-counted in UiOverlayProvider, so open/close is safe
  // to fire even during rapid interactions.
  const reportOverlay = useUiOverlayReporter();
  useEffect(() => {
    const on = !!tappedFullPhoto;
    reportOverlay(on);
    return () => { if (on) reportOverlay(false); };
  }, [tappedFullPhoto, reportOverlay]);
  // Read-only notes viewer opened by tapping the document glyph on a
  // preview card. `{ text, type }` while open, null when dismissed.
  const [viewingNotes, setViewingNotes] = useState(null);
  // Off-screen composite renderer used by Share when the "Edited"
  // toggle is on. We mount a hidden View containing the Image + the
  // same StudioEditOverlays stack, captureRef it to a file, and share
  // that file instead of the raw photo URI.
  const [shareCaptureContext, setShareCaptureContext] = useState(null);
  const shareCaptureRef = useRef(null);
  // Transient big-title that flashes over the pager when the user
  // crosses into a new set (replaces the old "Previous / Next set"
  // sentinel cards). Holds for 500 ms then fades out.
  const [flashTitle, setFlashTitle] = useState(null);
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const flashTimerRef = useRef(null);
  const flashSetTitle = (text) => {
    if (!text) return;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashTitle(text);
    flashOpacity.setValue(0);
    Animated.timing(flashOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
    flashTimerRef.current = setTimeout(() => {
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setFlashTitle(null);
      });
    }, 500);
  };
  // Use state for the pager width so the first render already uses a
  // sane width (the screen width) — a ref would leave the pages at 0px
  // wide until onLayout fires, which was making the very first preview
  // open blank until the user closed and reopened it.
  const [previewWidth, setPreviewWidth] = useState(() => Dimensions.get('window').width);
  // Measured body height — used by the preview pager to fit the photo
  // container EXACTLY to the photo's rendered size (no letterbox bars),
  // so the trash + share icons land on the photo edges instead of on
  // the surrounding grey surface.
  const [previewHeight, setPreviewHeight] = useState(0);
  const previewPagerRef = useRef(null);
  const previewPagerScrolling = useRef(false);
  const [openProjectVisible, setOpenProjectVisible] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState(new Set());
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [showQualification, setShowQualification] = useState(false);
  const [bannerRefreshKey, setBannerRefreshKey] = useState(0);
  const { projects, getPhotosByProject, deleteProject, setActiveProject, activeProjectId, createProject, renameProject, photos } = usePhotos();
  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  // Derived: setMembers re-mapped against the LIVE photos store on
  // every render. setMembers caches snapshot photo objects from the
  // moment the preview opened — when the user jumps to Edit (Studio),
  // changes pairTemplate / metadata / etc., and comes back, those
  // snapshots stay stale. Re-resolving by id every render keeps the
  // pager + everything downstream (aspectForPhoto, overlays, share
  // composite) pinned to the latest store data. Must live AFTER the
  // usePhotos() destructure above — earlier the useMemo was declared
  // before `photos` was in scope, which hit a TDZ ReferenceError on
  // first render of the preview.
  const liveSetMembers = useMemo(() => {
    if (!setMembers || setMembers.length === 0) return setMembers;
    const byId = new Map(photos.map((p) => [p.id, p]));
    return setMembers.map((m) => byId.get(m.id) || m).filter(Boolean);
  }, [setMembers, photos]);
  const liveTappedFullPhoto = useMemo(() => {
    if (!tappedFullPhoto?.id) return tappedFullPhoto;
    return photos.find((p) => p.id === tappedFullPhoto.id) || tappedFullPhoto;
  }, [tappedFullPhoto, photos]);
  // Locate the merged Before/After composite for a given Before. The
  // camera capture flow names combined photos after their source
  // Before (same `name`), so a name match in the room's combined list
  // is the link. Returns null when no composite exists yet.
  const findCombinedForBefore = (beforePhoto, roomOverride) => {
    if (!beforePhoto) return null;
    const cs = getCombinedPhotos?.(roomOverride || beforePhoto.room || currentRoom) || [];
    return cs.find((c) => c?.name === beforePhoto.name) || null;
  };
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const {
    userName,
    location,
    getRooms,
    userPlan,
    cleaningServiceEnabled,
    sectionLanguage,
    updateUserPlan,
    showLabels,
    toggleLabels,
    showPreviewMetadata,
    togglePreviewMetadata,
    // The remaining label fields below are read only by the bake-time
    // share pipeline (addLabelToImage). UI rendering reads from
    // SettingsContext via <PhotoLabels>, so we don't destructure the
    // landscape/freeform variants here.
    beforeLabelPosition,
    afterLabelPosition,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelMarginHorizontal,
    labelMarginVertical,
    updateUserInfo,
    captureSortOrder,
    toggleCaptureSortOrder,
  } = useSettings();
  const { userMode } = useAdmin();
  const fullScreenTopInset = Math.max(insets.top, 25);
  const fullScreenBottomInset = Math.max(insets.bottom, 20);
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';
  const { exceedsLimit } = useFeaturePermissions();
  const { uploadStatus, cancelUpload, cancelAllUploads } = useBackgroundUpload();
  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [contextMenuRoom, setContextMenuRoom] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [roomEditorMode, setRoomEditorMode] = useState('customize');
  const [newProjectNamePart, setNewProjectNamePart] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState(location);
  const [locationLoadingInModal, setLocationLoadingInModal] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [pendingCameraAfterCreate, setPendingCameraAfterCreate] = useState(false);
  const [combinedBaseUris, setCombinedBaseUris] = useState({});
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const [showDeleteProjectsConfirm, setShowDeleteProjectsConfirm] = useState(false);
  const deletedProjectIdsRef = useRef([]);
  const selectedProjectsForDeleteRef = useRef(new Set());
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editedProjectName, setEditedProjectName] = useState('');
  const [sharing, setSharing] = useState(false);
  // Compare mode for the full-screen before/after viewer. Persists across
  // swipes within a session; default to 'split' (the draggable divider).
  const [compareMode, setCompareMode] = useState('split');
  const [showDeletePhotoConfirm, setShowDeletePhotoConfirm] = useState(false);
  const pendingDeletePhotoIdRef = useRef(null);
  // captureRef target for the fullscreen CompareViewer. Used by the Share
  // button to capture whatever mode (overlay / split / side-by-side) is
  // currently rendered instead of forcing the combined re-composite.
  const fullScreenCompareRef = useRef(null);

  const { customRooms, saveCustomRooms, resetCustomRooms } = useSettings();
  const [rooms, setRooms] = useState(() => getRooms());
  
  useEffect(() => {
    const newRooms = getRooms();
    setRooms(newRooms);
  }, [customRooms]);

  // Show qualification prompt on first landing — UNLESS the user is
  // a returning user whose projects survived an iOS reinstall via
  // Keychain. In that case we infer the original industry from the
  // photos' rooms and silently mark qualification complete, so the
  // (out-of-date) prompt never shows and the user's restored rooms
  // list isn't overwritten by a fresh saveCustomRooms call.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const done = await hasCompletedQualification();
      if (cancelled) return;
      if (done) return;

      // Returning user: projects survived reinstall via Keychain.
      // Pick the industry whose folder set best matches the rooms
      // the user's existing photos sit in. If we can match, we set
      // both the qualification flag AND the customRooms list so the
      // app behaves identically to a user who completed onboarding
      // originally on this industry. If we can't match (rooms were
      // heavily customized post-onboarding), still mark qualification
      // complete so the prompt doesn't pop and overwrite the rooms
      // that were already restored from Keychain.
      if (projects && projects.length > 0) {
        const photoRoomIds = new Set();
        for (const p of photos || []) {
          if (p?.room) photoRoomIds.add(p.room);
        }
        let bestIndustry = null;
        let bestOverlap = 0;
        for (const ind of INDUSTRIES) {
          const folderIds = new Set((ind.folders || []).map(f => f.id));
          let overlap = 0;
          for (const rid of photoRoomIds) if (folderIds.has(rid)) overlap++;
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestIndustry = ind;
          }
        }
        if (bestIndustry && bestOverlap > 0) {
          await AsyncStorage.setItem('@user_qualification', bestIndustry.id);
          // Only reseed rooms if customRooms is empty (i.e. they
          // didn't restore from Keychain). Don't clobber a restored
          // customRooms list with our inferred seed.
          if (!customRooms || customRooms.length === 0) {
            await saveCustomRooms(bestIndustry.folders);
          }
          logEvent('qualification_auto_restored', {
            industry_id: bestIndustry.id,
            inferred_from_photos: true,
            overlap_count: bestOverlap,
          });
        } else {
          // No match — just mark complete so the prompt doesn't pop.
          await AsyncStorage.setItem('@user_qualification', 'returning_user');
          logEvent('qualification_auto_restored', {
            industry_id: null,
            inferred_from_photos: false,
            overlap_count: 0,
          });
        }
        return;
      }

      // True first-time user — show the prompt.
      logEvent('qualification_prompt_shown', { context: 'onboarding' });
      setShowQualification(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects?.length]);

  // Refresh banner when screen focuses (user may have completed a job)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setBannerRefreshKey(k => k + 1);
    });
    return unsubscribe;
  }, [navigation]);


  const handleRoomLongPress = (room, event) => {
    setContextMenuRoom(room);
    const { pageX, pageY } = event.nativeEvent;
    setContextMenuPosition({ x: pageX, y: pageY });
    setShowContextMenu(true);
  };

  const handleAddFolder = () => {
    setRoomEditorMode('add');
    setShowRoomEditor(true);
  };

  const handleDuplicateFolder = async (room) => {
    const generateDuplicateName = (baseName, existingRooms) => {
      const baseNameWithoutNumber = baseName.replace(/\s+\d+$/, '');
      let maxNumber = 1;
      existingRooms.forEach(room => {
        const match = room.name.match(new RegExp(`^${baseNameWithoutNumber}\\s+(\\d+)$`));
        if (match) {
          const number = parseInt(match[1], 10);
          if (number > maxNumber) {
            maxNumber = number;
          }
        }
      });
      return `${baseNameWithoutNumber} ${maxNumber + 1}`;
    };

    const duplicateName = generateDuplicateName(room.name, rooms);
    const newRoom = {
      id: `room_${Date.now()}`,
      name: duplicateName,
      icon: room.icon
    };
    
    const baseNameWithoutNumber = room.name.replace(/\s+\d+$/, '');
    let insertIndex = rooms.length;
    for (let i = rooms.length - 1; i >= 0; i--) {
      const roomName = rooms[i].name;
      if (roomName.startsWith(baseNameWithoutNumber)) {
        insertIndex = i + 1;
        break;
      }
    }
    
    const updatedRooms = [...rooms];
    updatedRooms.splice(insertIndex, 0, newRoom);
    await saveCustomRooms(updatedRooms);
    setCurrentRoom(newRoom.id);
    setContextMenuRoom(newRoom);
    setRoomEditorMode('edit');
    setShowRoomEditor(true);
  };

  const handleDeleteFolder = (room) => {
    const isDefaultRoom = ROOMS.some(defaultRoom => defaultRoom.id === room.id);
    
    if (isDefaultRoom) {
      Alert.alert(
        t('home.protectedFolder'),
        t('home.protectedFolderMessage'),
        [{ text: t('common.confirm') }]
      );
      return;
    }

    Alert.alert(
      t('home.deleteFolder'),
      t('home.deleteFolderConfirm', { name: room.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { 
          text: t('common.delete'), 
          style: 'destructive',
          onPress: () => {
            if (customRooms) {
              const updatedRooms = customRooms.filter(r => r.id !== room.id);
              const currentIndex = rooms.findIndex(r => r.id === room.id);
              const isDeletingCurrentRoom = currentRoom.id === room.id;
              let newCurrentRoom;
              if (updatedRooms.length > 0) {
                if (isDeletingCurrentRoom) {
                  if (currentIndex > 0) {
                    newCurrentRoom = updatedRooms[currentIndex - 1];
                  } else {
                    newCurrentRoom = updatedRooms[updatedRooms.length - 1];
                  }
                } else {
                  newCurrentRoom = rooms.find(r => r.id === currentRoom.id);
                }
                saveCustomRooms(updatedRooms);
                if (newCurrentRoom) {
                  setCurrentRoom(newCurrentRoom.id);
                }
              } else {
                resetCustomRooms();
                setCurrentRoom(ROOMS[0].id);
              }
            }
          }
        }
      ]
    );
  };

  useEffect(() => {
    if (rooms && rooms.length > 0) {
      const currentRoomExists = rooms.some(room => room.id === currentRoom);
      if (!currentRoomExists) {
        setCurrentRoom(rooms[0].id);
      }
    }
  }, [rooms, currentRoom]);

  // (Studio's old "Test" tab used to hand off to this screen via
  // previewPhotoId / previewBeforeId / previewAfterId params. Tab was
  // removed; the handoff is dead code now.)

  useEffect(() => {
    if (activeProjectId && projects.length > 0) {
      const activeProjectExists = projects.some(p => p.id === activeProjectId);
      if (!activeProjectExists) {
        setActiveProject(projects[0].id);
      }
    } else if (projects.length > 0 && !activeProjectId) {
      setActiveProject(projects[0].id);
    } else if (projects.length === 0 && activeProjectId) {
      setActiveProject(null);
    }
  }, [projects, activeProjectId]);


  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);
  const touchStartPos = useRef(null);
  const isSwiping = useRef(false);
  const lastTap = useRef(null);
  const swipeStartX = useRef(null);
  const tapCount = useRef(0);

  const beforePhotos = getBeforePhotos(currentRoom);
  const afterPhotos = getAfterPhotos(currentRoom);
  const currentRoomRef = useRef(currentRoom);
  const roomTabsScrollRef = useRef(null);
  // Stores the measured x + width of the currently-rendered "middle" tab
  // (the active room, after circular rotation). Updated by onLayout
  // every time the row re-renders. Lets us center the active room
  // exactly, regardless of variable tab widths driven by label length.
  const activeTabLayoutRef = useRef({ x: 0, width: 0 });

  // Create circular room arrangement with active room in center
  const getCircularRooms = useCallback(() => {
    if (!rooms.length) return [];

    const activeIndex = rooms.findIndex(r => r.id === currentRoom);
    if (activeIndex < 0) return rooms;

    const totalRooms = rooms.length;
    const middleIndex = Math.floor(totalRooms / 2);

    // Calculate how much to rotate the array to put active item in middle
    const rotateBy = activeIndex - middleIndex;

    // Create new array with circular rotation
    const circularRooms = [];
    for (let i = 0; i < totalRooms; i++) {
      const sourceIndex = (i + rotateBy + totalRooms) % totalRooms;
      circularRooms.push(rooms[sourceIndex]);
    }

    return circularRooms;
  }, [rooms, currentRoom]);

  // Slide-in animation for the main content (photo grid) on room
  // change. When the user picks a room AFTER the previous one in the
  // list, content slides in from the right; BEFORE → from the left.
  // Comparison runs against the previous room id, kept in a ref so it
  // doesn't trigger renders.
  const contentSlideX = useRef(new Animated.Value(0)).current;
  const prevRoomIdRef = useRef(currentRoom);
  useEffect(() => {
    if (!rooms.length) return;
    if (prevRoomIdRef.current === currentRoom) return;
    const prevIdx = rooms.findIndex((r) => r.id === prevRoomIdRef.current);
    const nextIdx = rooms.findIndex((r) => r.id === currentRoom);
    prevRoomIdRef.current = currentRoom;
    if (prevIdx < 0 || nextIdx < 0) return;
    const direction = nextIdx > prevIdx ? 1 : -1;
    const screenW = Dimensions.get('window').width;
    contentSlideX.setValue(direction * screenW * 0.18);
    Animated.timing(contentSlideX, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [currentRoom, rooms, contentSlideX]);

  // Smooth-scroll the room row so the active card lands in the visible
  // centre. We can't rely on a fixed TAB_WIDTH because tab widths vary
  // by label length (e.g. "Living Room" vs "Office") — the previous
  // hardcoded 79 left the active card off-center. Instead the active
  // tab reports its measured x + width via onLayout (see
  // activeTabLayoutRef), and we scroll to put that exact pixel center
  // under the screen center.
  const scrollActiveTabToCenter = useCallback((animated = true) => {
    if (!roomTabsScrollRef.current) return;
    const { x, width } = activeTabLayoutRef.current;
    if (!width) return;
    const screenWidth = Dimensions.get('window').width;
    const scrollX = Math.max(0, x + width / 2 - screenWidth / 2);
    roomTabsScrollRef.current.scrollTo({ x: scrollX, animated });
  }, []);

  useEffect(() => {
    if (!rooms.length) return;
    // Defer so the new circular array has laid out and onLayout fired
    // with the new active tab's coordinates before we scroll.
    const timer = setTimeout(() => scrollActiveTabToCenter(true), 60);
    return () => clearTimeout(timer);
  }, [currentRoom, rooms, scrollActiveTabToCenter]);

  useEffect(() => {
    let cancelled = false;

    setTimeout(() => {
      (async () => {
        try {
          const dir = FileSystem.documentDirectory;
          if (!dir || cancelled) return;

          const beforePhotos = getBeforePhotos(currentRoom);
          const afterPhotos = getAfterPhotos(currentRoom);
          const uriMap = {};

          const entries = await FileSystem.readDirectoryAsync(dir);
          if (cancelled) return;
        
        for (const beforePhoto of beforePhotos) {
          const afterPhoto = afterPhotos.find(p => p.beforePhotoId === beforePhoto.id);
          if (!afterPhoto) continue;

          const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
          const projectId = beforePhoto.projectId;
          const projectIdSuffix = projectId ? `_P${projectId}` : '';
          
          const extractTimestamp = (filename) => {
            const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
            return match ? parseInt(match[1], 10) : 0;
          };

          const phoneOrientation = beforePhoto.orientation || 'portrait';
          const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
          const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

          const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
          const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

          let newestUri = null;
          let newestTs = -1;

          const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
          const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

          const primaryMatches = entries.filter(name => {
            if (!name.startsWith(primaryPrefix)) return false;
            if (projectId && !name.includes(projectIdSuffix)) return false;
            return true;
          });

          for (const filename of primaryMatches) {
            const ts = extractTimestamp(filename);
            if (ts > newestTs) {
              newestTs = ts;
              newestUri = `${dir}${filename}`;
            }
          }

          if (!newestUri) {
            const fallbackMatches = entries.filter(name => {
              if (!name.startsWith(fallbackPrefix)) return false;
              if (projectId && !name.includes(projectIdSuffix)) return false;
              return true;
            });

            for (const filename of fallbackMatches) {
              const ts = extractTimestamp(filename);
              if (ts > newestTs) {
                newestTs = ts;
                newestUri = `${dir}${filename}`;
              }
            }
          }
          
          if (newestUri) {
            uriMap[beforePhoto.name] = newestUri;
          }
        }
        
        if (!cancelled) {
          setCombinedBaseUris(uriMap);
        }
      } catch (e) {
      }
      })();
    }, 50);

    return () => { cancelled = true; };
  }, [photos.length, currentRoom]);

  useFocusEffect(
    React.useCallback(() => {
      isSwiping.current = false;
      longPressTriggered.current = false;
      let cancelled = false;
      const timeoutId = setTimeout(() => {
        (async () => {
          try {
            const dir = FileSystem.documentDirectory;
            if (!dir || cancelled) return;

            const beforePhotos = getBeforePhotos(currentRoom);
            const afterPhotos = getAfterPhotos(currentRoom);
            const uriMap = {};

            const entries = await FileSystem.readDirectoryAsync(dir);
            
            for (const beforePhoto of beforePhotos) {
              const afterPhoto = afterPhotos.find(p => p.beforePhotoId === beforePhoto.id);
              if (!afterPhoto || cancelled) continue;

              const safeName = (beforePhoto.name || 'Photo').replace(/\s+/g, '_');
              const projectId = beforePhoto.projectId;
              const projectIdSuffix = projectId ? `_P${projectId}` : '';
              
              const extractTimestamp = (filename) => {
                const match = filename.match(/_(\d+)(?:_P\d+)?\.(jpg|jpeg|png)$/i);
                return match ? parseInt(match[1], 10) : 0;
              };

              const phoneOrientation = beforePhoto.orientation || 'portrait';
              const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
              const isLetterboxPortrait = phoneOrientation === 'portrait' && cameraViewMode === 'landscape';

              const stackPrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_STACK_`;
              const sidePrefix = `${beforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_`;

              let newestUri = null;
              let newestTs = -1;

              const primaryPrefix = isLetterboxPortrait ? sidePrefix : stackPrefix;
              const fallbackPrefix = isLetterboxPortrait ? stackPrefix : sidePrefix;

              const primaryMatches = entries.filter(name => {
                if (!name.startsWith(primaryPrefix)) return false;
                if (projectId && !name.includes(projectIdSuffix)) return false;
                return true;
              });

              for (const filename of primaryMatches) {
                const ts = extractTimestamp(filename);
                if (ts > newestTs) {
                  newestTs = ts;
                  newestUri = `${dir}${filename}`;
                }
              }

              if (!newestUri) {
                const fallbackMatches = entries.filter(name => {
                  if (!name.startsWith(fallbackPrefix)) return false;
                  if (projectId && !name.includes(projectIdSuffix)) return false;
                  return true;
                });

                for (const filename of fallbackMatches) {
                  const ts = extractTimestamp(filename);
                  if (ts > newestTs) {
                    newestTs = ts;
                    newestUri = `${dir}${filename}`;
                  }
                }
              }
              
              if (newestUri) {
                uriMap[beforePhoto.name] = newestUri;
              }
            }
            
            if (!cancelled) {
              setCombinedBaseUris(uriMap);
            }
          } catch (e) {
          }
        })();
      }, 600);
      
      return () => {
        cancelled = true;
        clearTimeout(timeoutId);
      };
    }, [currentRoom, getBeforePhotos, getAfterPhotos])
  );

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  const handleLongPressStart = (photo, beforePhoto = null, afterPhoto = null) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      const photoSet = beforePhoto || photo;
      if (!photoSet) return;

      pendingDeletePhotoIdRef.current = photoSet.id;
      setShowDeletePhotoConfirm(true);
    }, 500);
  };

  const handleLongPressEnd = () => {
    const wasLongPress = longPressTriggered.current;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    setFullScreenPhoto(null);
    setBareMode(false);
    setFullScreenPhotoSet(null);
    setFullScreenLoading(false);
    setFullScreenError(null);
    setSetMembers([]);
    setSetMemberIndex(0);

    if (wasLongPress) {
      setTimeout(() => {
        longPressTriggered.current = false;
      }, 100);
    } else {
      longPressTriggered.current = false;
    }
  };

  const handleDoubleTap = (photo, beforePhoto = null, afterPhoto = null) => {
    const allPhotos = [];
    const beforePhotos = getBeforePhotos(currentRoom);
    const afterPhotos = getAfterPhotos(currentRoom);
    const combinedPhotos = getCombinedPhotos(currentRoom);

    const beforeToAfterMap = new Map();
    afterPhotos.forEach(afterPhoto => {
      if (afterPhoto.beforePhotoId) {
        beforeToAfterMap.set(afterPhoto.beforePhotoId, afterPhoto);
      }
    });

    beforePhotos.forEach(beforePhoto => {
      const afterPhoto = beforeToAfterMap.get(beforePhoto.id);
      if (afterPhoto) {
        const combinedPhoto = combinedPhotos.find(p => p.name === beforePhoto.name);
        if (combinedPhoto) {
          allPhotos.push({ ...combinedPhoto, type: 'combined', beforePhoto, afterPhoto });
        } else {
          allPhotos.push({ ...beforePhoto, type: 'split', beforePhoto, afterPhoto });
        }
      } else {
        allPhotos.push({ ...beforePhoto, type: 'before' });
      }
    });

    let photoIndex = 0;
    if (photo) {
      photoIndex = allPhotos.findIndex(p => p.id === photo.id);
    } else if (beforePhoto) {
      photoIndex = allPhotos.findIndex(p => p.id === beforePhoto.id || p.beforePhoto?.id === beforePhoto.id);
    }
    if (photoIndex >= 0) {
      setFullScreenPhotos(allPhotos);
      setFullScreenIndex(photoIndex);
      setFullScreenLoading(false);
      setFullScreenError(null);
      // NOTE: fullScreenPhoto / fullScreenPhotoSet are intentionally
      // NOT set here anymore. They used to trigger an older inline
      // "enlarged preview" (project name + date + Edited toggle + share)
      // that has been superseded by the shared EnlargedPhotoViewer
      // (matching the timeline flow). The inline block still exists
      // guarded by `fullScreenPhoto || fullScreenPhotoSet` but never
      // renders because neither is set. `setTappedFullPhoto(...)` at
      // the bottom of this function opens EnlargedPhotoViewer instead.
      // Build the set members for the shared-viewer pager: every
      // individual photo that belongs to the same capture session,
      // ordered Before → Progress(es) → After → Combined. Lets the user
      // swipe through originals + the merged result.
      const anchorBefore =
        beforePhoto
          || (photo?.type === 'before' ? photo : null)
          || (photo?.beforePhoto || null)
          || (photo?.beforePhotoId ? beforePhotos.find(b => b.id === photo.beforePhotoId) : null)
          || photo;
      const members = [];
      if (anchorBefore?.mode === 'before' || anchorBefore?.type === 'before') {
        members.push(anchorBefore);
      } else if (anchorBefore) {
        // Standalone photo — just preview that one.
        members.push(anchorBefore);
      }
      if (anchorBefore?.id) {
        const progresses = (getProgressPhotos?.(currentRoom) || []).filter(
          (p) => p.beforePhotoId === anchorBefore.id
        );
        progresses.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        members.push(...progresses);
        const after = beforeToAfterMap.get(anchorBefore.id);
        if (after) members.push(after);
        // Append the merged combined composite at the END so the user
        // can swipe past After to see the share/export artifact too.
        const combined = findCombinedForBefore(anchorBefore, currentRoom);
        if (combined) members.push(combined);
      }
      const startMemberIndex = (() => {
        if (!photo) return 0;
        const i = members.findIndex((m) => m.id === photo.id);
        return i >= 0 ? i : 0;
      })();
      setSetMembers(members);
      setSetMemberIndex(startMemberIndex);
      // Open the shared EnlargedPhotoViewer on the tapped photo. It
      // renders full-chrome (set nav chips, close, delete, overlays
      // toggle, edit) matching PhotoSetPreviewScreen exactly.
      const startPhoto = members[startMemberIndex] || members[0] || photo || beforePhoto;
      if (startPhoto) setTappedFullPhoto(startPhoto);
    }
  };

  // Camera's enlarged "eye" icon navigates here with previewBeforeId /
  // previewRoom / previewProjectId / previewPhotoId so the user lands
  // on the SAME modal preview that taps from the home photo grid
  // use — not the older PhotoSetPreview screen (which still serves
  // ProjectDetail). On arrival, we switch project + room if needed
  // and replicate handleDoubleTap's state setup against the target
  // room directly (handleDoubleTap reads `currentRoom` from closure,
  // which is stale until the next render).
  useFocusEffect(
    React.useCallback(() => {
      const params = route?.params;
      if (!params?.previewBeforeId) return;

      const targetRoom = params.previewRoom || currentRoom;
      const targetProjectId = params.previewProjectId;
      const targetPhotoId = params.previewPhotoId;

      if (targetProjectId && targetProjectId !== activeProjectId) {
        setActiveProject(targetProjectId);
      }
      if (targetRoom && targetRoom !== currentRoom) {
        setCurrentRoom(targetRoom);
      }

      const beforePhotos = getBeforePhotos(targetRoom);
      const afterPhotos = getAfterPhotos(targetRoom);
      const combinedPhotos = getCombinedPhotos(targetRoom);
      const beforePhoto = beforePhotos.find((p) => p.id === params.previewBeforeId);
      const afterPhoto = params.previewAfterId
        ? afterPhotos.find((p) => p.id === params.previewAfterId)
        : null;

      const clearParams = () => {
        navigation.setParams({
          previewBeforeId: undefined,
          previewAfterId: undefined,
          previewRoom: undefined,
          previewProjectId: undefined,
          previewPhotoId: undefined,
        });
      };

      if (!beforePhoto) {
        clearParams();
        return;
      }

      const beforeToAfterMap = new Map();
      afterPhotos.forEach((ap) => {
        if (ap.beforePhotoId) beforeToAfterMap.set(ap.beforePhotoId, ap);
      });

      const allPhotos = [];
      beforePhotos.forEach((bp) => {
        const ap = beforeToAfterMap.get(bp.id);
        if (ap) {
          const cp = combinedPhotos.find((p) => p.name === bp.name);
          if (cp) {
            allPhotos.push({ ...cp, type: 'combined', beforePhoto: bp, afterPhoto: ap });
          } else {
            allPhotos.push({ ...bp, type: 'split', beforePhoto: bp, afterPhoto: ap });
          }
        } else {
          allPhotos.push({ ...bp, type: 'before' });
        }
      });

      const photoIndex = allPhotos.findIndex(
        (p) => p.id === beforePhoto.id || p.beforePhoto?.id === beforePhoto.id,
      );
      if (photoIndex < 0) {
        clearParams();
        return;
      }

      setFullScreenPhotos(allPhotos);
      setFullScreenIndex(photoIndex);
      setFullScreenLoading(false);
      setFullScreenError(null);
      if (afterPhoto) {
        setFullScreenPhotoSet({ before: beforePhoto, after: afterPhoto });
      } else {
        setFullScreenPhoto(allPhotos[photoIndex]);
      }

      const members = [beforePhoto];
      const progresses = (getProgressPhotos?.(targetRoom) || []).filter(
        (p) => p.beforePhotoId === beforePhoto.id,
      );
      progresses.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      members.push(...progresses);
      if (afterPhoto) members.push(afterPhoto);
      const combinedRestore = findCombinedForBefore(beforePhoto, targetRoom);
      if (combinedRestore) members.push(combinedRestore);
      setSetMembers(members);
      const startMemberIndex = Math.max(
        0,
        members.findIndex((m) => m.id === (targetPhotoId || beforePhoto.id)),
      );
      setSetMemberIndex(startMemberIndex);

      clearParams();
    }, [route?.params, currentRoom, activeProjectId])
  );

  const handleSwipeNavigation = (direction) => {
    if (fullScreenPhotos.length === 0) {
      return;
    }

    let newIndex = fullScreenIndex;
    if (direction === 'left') {
      newIndex = (fullScreenIndex + 1) % fullScreenPhotos.length;
    } else if (direction === 'right') {
      newIndex = fullScreenIndex === 0 ? fullScreenPhotos.length - 1 : fullScreenIndex - 1;
    }
    setFullScreenIndex(newIndex);
    setFullScreenLoading(false);
    setFullScreenError(null);
    const newPhoto = fullScreenPhotos[newIndex];
    if (newPhoto.type === 'combined' || newPhoto.type === 'split') {
      setFullScreenPhotoSet({ before: newPhoto.beforePhoto, after: newPhoto.afterPhoto });
      setFullScreenPhoto(null);
    setBareMode(false);
    } else {
      setFullScreenPhoto(newPhoto);
      setFullScreenPhotoSet(null);
    }
  };

  const shareCombinedPhoto = async (thumbnailUri, photoName, roomId, combinedPhoto, beforePhoto, afterPhoto) => {
    try {
      setSharing(true);

      let shareUri = thumbnailUri;

      // Re-composite a fresh 1:1 square combined photo for sharing
      if (beforePhoto?.uri && afterPhoto?.uri) {
        try {
          // Determine layout from stored metadata or template/aspect ratio
          const storedLayout = combinedPhoto?.combinedLayout;
          const isStack = storedLayout
            ? storedLayout === 'STACK'
            : isStackedLayout(null, beforePhoto.aspectRatio);
          const layout = isStack ? 'STACK' : 'SIDE';

          // Get before photo dimensions to calculate square size
          const getImageSize = (uri) => new Promise((resolve, reject) => {
            Image.getSize(uri, (w, h) => resolve({ w, h }), reject);
          });
          const bSize = await getImageSize(beforePhoto.uri);
          const squareSize = Math.min(Math.max(bSize.w, 2048), 4096);

          const dims = isStack
            ? { width: squareSize, height: squareSize, topH: Math.round(squareSize / 2), bottomH: squareSize - Math.round(squareSize / 2) }
            : { width: squareSize, height: squareSize, leftW: Math.round(squareSize / 2), rightW: squareSize - Math.round(squareSize / 2) };

          console.log('[HomeScreen] Re-compositing 1:1 combined for share:', layout, squareSize);
          const freshUri = await compositeImages(beforePhoto.uri, afterPhoto.uri, layout, dims);

          // Apply labels if enabled
          if (showLabels) {
            try {
              const labelSizeMap = { small: 48, medium: 56, large: 64 };
              const fontSize = labelSizeMap[labelSize] || 56;
              const convertPos = (pos) => {
                const map = { 'top-left': 'left-top', 'top-right': 'right-top', 'bottom-left': 'left-bottom', 'bottom-right': 'right-bottom' };
                return map[pos] || pos || 'left-top';
              };

              const baseLabelConfig = {
                backgroundColor: labelBackgroundColor || '#FFD700',
                textColor: labelTextColor || '#000000',
                fontSize,
                marginHorizontal: labelMarginHorizontal || 20,
                marginVertical: labelMarginVertical || 20,
                padding: 16,
              };

              // Add Before label
              const beforePos = convertPos(beforeLabelPosition || 'top-left');
              const withBeforeLabel = await addLabelToImage(freshUri, t('common.before') || 'BEFORE', { ...baseLabelConfig, position: beforePos });

              // Add After label with offset
              const afterPos = convertPos(afterLabelPosition || 'top-right');
              const halfW = Math.round(squareSize / 2);
              const halfH = Math.round(squareSize / 2);
              const { offsetX, offsetY } = calculateAfterLabelOffsets(afterPos, isStack, halfW, halfH, squareSize, squareSize);
              shareUri = await addLabelToImage(withBeforeLabel, t('common.after') || 'AFTER', { ...baseLabelConfig, position: afterPos, offsetX, offsetY });
              console.log('[HomeScreen] Labels applied to combined share photo');
            } catch (labelErr) {
              console.warn('[HomeScreen] Label application failed, sharing without labels:', labelErr?.message);
              shareUri = freshUri;
            }
          } else {
            shareUri = freshUri;
          }
        } catch (compositeErr) {
          console.warn('[HomeScreen] Re-composite failed, falling back to stored URI:', compositeErr?.message);
        }
      }

      const tempFileName = `${roomId}_${photoName}_combined_${Date.now()}.jpg`;
      const tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
      await FileSystem.copyAsync({ from: shareUri, to: tempUri });

      await Share.open({
        title: `${t('common.before')}/${t('common.after')} - ${photoName}`,
        url: ensureFileUri(tempUri),
        type: 'image/jpeg',
      });

      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.error('[HomeScreen] Cleanup error:', cleanupError);
      }
    } catch (error) {
      console.error('[HomeScreen] Share error:', error);
      Alert.alert(t('common.error'), t('gallery.sharePhotoError'));
    } finally {
      setSharing(false);
    }
  };

  const panResponder = useMemo(() => {
    const resetSwiping = () => {
      setTimeout(() => {
        isSwiping.current = false;
      }, 100);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
        if (isHorizontalSwipe) {
          isSwiping.current = true;
          return true;
        }
        return false;
      },
      onPanResponderGrant: () => {},
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
        if (currentIndex !== -1) {
          if (gestureState.dx > swipeThreshold) {
            const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
            setCurrentRoom(rooms[newIndex].id);
          } else if (gestureState.dx < -swipeThreshold) {
            const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
            setCurrentRoom(rooms[newIndex].id);
          }
        }
        resetSwiping();
      },
      onPanResponderTerminate: () => {
        resetSwiping();
      },
    });
  }, [rooms]);

  // Swipe gestures for the tap-to-fullscreen Modal. BUBBLE phase only
  // — PannableImage's PanResponder gets first dibs (2-finger pinch
  // claims on touchStart, long-press-armed drag claims on touchMove).
  // We only catch single-finger quick swipes that PannableImage didn't
  // claim, and use them to walk through the set members (left/right)
  // or close the modal (down). High velocity OR large displacement
  // triggers the claim so casual moves don't accidentally fire.
  //
  // The refs below let the responder always read the LATEST
  // setMembers / active id / setIdx without being recreated on every
  // photo navigation (useMemo recreating PanResponder mid-gesture would
  // drop the gesture).
  const tappedFullSetMembersRef = useRef([]);
  useEffect(() => { tappedFullSetMembersRef.current = setMembers; }, [setMembers]);
  const tappedFullActivePhotoRef = useRef(null);
  useEffect(() => { tappedFullActivePhotoRef.current = liveTappedFullPhoto; }, [liveTappedFullPhoto]);
  const tappedFullPanResponder = useMemo(() => {
    const isHorizontalSwipe = (g) =>
      Math.abs(g.dx) > 30 &&
      Math.abs(g.dx) > Math.abs(g.dy) * 1.4 &&
      (Math.abs(g.vx) > 0.25 || Math.abs(g.dx) > 60);
    const isDownSwipe = (g) =>
      g.dy > 30 &&
      g.dy > Math.abs(g.dx) * 1.4 &&
      (g.vy > 0.25 || g.dy > 80);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, g) => {
        const touches = evt.nativeEvent?.touches?.length || 0;
        if (touches !== 1) return false;
        return isHorizontalSwipe(g) || isDownSwipe(g);
      },
      onPanResponderRelease: (_, g) => {
        if (isDownSwipe(g)) {
          setTappedFullPhoto(null);
          return;
        }
        if (isHorizontalSwipe(g)) {
          const members = tappedFullSetMembersRef.current || [];
          const active = tappedFullActivePhotoRef.current;
          const idx = members.findIndex((mm) => mm?.id === active?.id);
          const safe = idx >= 0 ? idx : 0;
          // Swipe-right = previous photo, swipe-left = next photo
          // (standard photo-viewer convention).
          const target = safe + (g.dx > 0 ? -1 : 1);
          if (target >= 0 && target < members.length) {
            setSetMemberIndex(target);
            setTappedFullPhoto(members[target]);
          }
        }
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);

  // Swipe-down-to-close gesture for the simple preview. Only claims
  // gestures that are clearly vertical-downward; horizontal swipes fall
  // through to the inner pager so paging keeps working.
  const previewDismissPanResponder = useMemo(() => {
    // A clearly-vertical downward drag dismisses the preview. The
    // *Capture variants let this PanResponder claim the gesture even
    // when it starts on the inner photo pager — without them the
    // horizontal ScrollView often grabs the touch first and the
    // vertical swipe never registers. Thresholds lowered so a flick
    // works (was dy > 14 / release dy > 80; now 6 / 50).
    const isVerticalDown = (g) =>
      g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => isVerticalDown(g),
      onMoveShouldSetPanResponderCapture: (_, g) => isVerticalDown(g),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 50 && Math.abs(g.dy) > Math.abs(g.dx)) {
          handleLongPressEnd();
        }
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [handleLongPressEnd]);

  const fullScreenPanResponder = useMemo(() => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => {
        swipeStartX.current = null;
        return false;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        if (fullScreenPhoto || fullScreenPhotoSet) {
          const isHorizontalSwipe = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
          const isVerticalSwipe = Math.abs(gestureState.dy) > Math.abs(gestureState.dx) && Math.abs(gestureState.dy) > 30;
          if (isHorizontalSwipe && fullScreenPhotos.length > 1 && !swipeStartX.current) {
            swipeStartX.current = gestureState.dx;
          }
          const shouldActivate = isHorizontalSwipe || isVerticalSwipe;
          return shouldActivate;
        }
        return false;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        if (gestureState.dx > swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('right');
        } else if (gestureState.dx < -swipeThreshold && fullScreenPhotos.length > 1) {
          handleSwipeNavigation('left');
        }
        
        if (Math.abs(gestureState.dy) > swipeThreshold) {
          handleLongPressEnd();
        }
        
        swipeStartX.current = null;
      }
    });
  }, [fullScreenPhoto, fullScreenPhotoSet, fullScreenPhotos.length, handleSwipeNavigation, handleLongPressEnd]);

  const openNewProjectModal = (navigateToCamera = false) => {
    if (!userName || userName.trim() === '') {
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
      navigation.navigate('PlanSelection');
      return;
    }

    // Single source of truth: defer to ProjectsScreen's New Project
    // modal (the one with the industry picker + precise location).
    // The route params tell that screen to auto-open the modal on
    // focus and — if `navigateToCamera` — push Camera right after the
    // user creates the project, preserving the FAB → Camera flow.
    navigation.navigate('Projects', {
      openNewProject: true,
      navigateToCameraAfter: !!navigateToCamera,
    });
  };

  const handleUseCurrentLocationInModal = async (opts = {}) => {
    const { interactive = true } = opts;
    // Same flow as ProjectsScreen: silent on open (no Alert), interactive
    // when user taps the button. Granted → fetch and prefill name. Denied →
    // offer Settings (interactive). Undetermined → triggers system prompt.
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
              { text: t('common.openSettings', { defaultValue: 'Open Settings' }), onPress: () => Linking.openSettings() },
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
      const locationDisplay =
        address?.city || address?.region || address?.subregion || address?.country;
      if (!locationDisplay) {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      const defaultName = `Project ${(projects?.length || 0) + 1}`;
      setNewProjectNamePart((current) =>
        !current?.trim() || current === defaultName ? locationDisplay : current
      );
    } catch (error) {
      console.error('[HomeScreen] Use current location in modal:', error);
      setLocationDenied(true);
    } finally {
      setLocationLoadingInModal(false);
    }
  };

  // Starter tier is capped at maxSets before/after sets across the whole app.
  // Returns true if the current tap should proceed to Camera; returns false
  // and opens the paywall (SETS_LIMIT trigger) if the user has already used
  // their allotment. Team members are exempt — they operate under the
  // admin's tier.
  const guardStartSet = () => {
    if (isTeamMember) return true;
    if (!exceedsLimit('maxSets', countSets(photos || []))) return true;
    navigation.navigate('PlanSelection', {
      mode: 'upgrade',
      trigger: PAYWALL_TRIGGERS.SETS_LIMIT,
    });
    return false;
  };

  const handleCreateProject = async () => {
    if (!isTeamMember && exceedsLimit('maxProjects', projects.length)) {
      setNewProjectVisible(false);
      navigation.navigate('PlanSelection');
      return;
    }
    const namePart = (newProjectNamePart || userName || 'Project').trim();
    if (!namePart) {
      Alert.alert(t('common.error'), t('projects.enterProjectName'));
      return;
    }
    // Single field: the user's input IS the folder name. No date suffix.
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
    const safeName = finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
    try {
      const proj = await createProject(safeName);
      await setActiveProject(proj.id);
      setNewProjectVisible(false);
      setNewProjectNamePart('');
      if (pendingCameraAfterCreate) {
        setPendingCameraAfterCreate(false);
        if (!guardStartSet()) return;
        navigation.navigate('Camera', {
          mode: 'before',
          room: currentRoom
        });
      }
    } catch (e) {
      Alert.alert(t('common.error'), e?.message || t('projects.createError'));
    }
  };

  const handleProjectLongPress = (projectId) => {
    setIsMultiSelectMode(true);
    setSelectedProjects(new Set([projectId]));
  };

  const handleProjectPress = (projectId) => {
    if (isMultiSelectMode) {
      setSelectedProjects(prev => {
        const newSet = new Set(prev);
        if (newSet.has(projectId)) {
          newSet.delete(projectId);
        } else {
          newSet.add(projectId);
        }
        return newSet;
      });
    } else {
      setActiveProject(projectId);
      setOpenProjectVisible(false);
    }
  };

  const handleDeleteSelectedProjects = () => {
    if (selectedProjects.size === 0) {
      return;
    }
    selectedProjectsForDeleteRef.current = new Set(selectedProjects);
    setOpenProjectVisible(false);
    setTimeout(() => {
      setShowDeleteProjectsConfirm(true);
    }, 300);
  };

  const handleDeleteSelectedProjectsConfirmed = async (deleteFromStorageParam) => {
    try {
      const shouldDeleteFromStorage = deleteFromStorageParam !== undefined ? deleteFromStorageParam : true;
      
      const projectsToDelete = Array.from(selectedProjectsForDeleteRef.current);
      const wasActiveProjectSelected = projectsToDelete.includes(activeProjectId);
      const projectIdsToDelete = projectsToDelete;
      deletedProjectIdsRef.current = projectIdsToDelete;
      
      setShowDeleteProjectsConfirm(false);
      setSelectedProjects(new Set());
      setIsMultiSelectMode(false);
      selectedProjectsForDeleteRef.current = new Set();
      
      for (let i = 0; i < projectIdsToDelete.length; i++) {
        const projectId = projectIdsToDelete[i];
        try {
          await deleteProject(projectId, { deleteFromStorage: shouldDeleteFromStorage });
        } catch (error) {
          console.error(`[HomeScreen] Failed to delete project ${projectId}:`, error);
        }
      }
    } catch (error) {
      console.error('[HomeScreen] Error deleting selected projects:', error);
      Alert.alert(t('common.error'), 'Failed to delete some projects. Please try again.');
      deletedProjectIdsRef.current = [];
    }
  };

  useEffect(() => {
    if (deletedProjectIdsRef.current.length > 0) {
      const deletedIds = [...deletedProjectIdsRef.current];
      deletedProjectIdsRef.current = [];
      
      if (activeProjectId && deletedIds.includes(activeProjectId)) {
        const remainingProjects = projects.filter(p => !deletedIds.includes(p.id));
        if (remainingProjects.length > 0) {
          setActiveProject(remainingProjects[0].id);
        } else {
          setActiveProject(null);
        }
      } else if (!activeProjectId && projects.length > 0) {
        setActiveProject(projects[0].id);
      }
    }
  }, [projects, activeProjectId, setActiveProject]);

  const exitMultiSelectMode = () => {
    setIsMultiSelectMode(false);
    setSelectedProjects(new Set());
  };

  const handleDisabledDeleteClick = () => {
    Alert.alert(
      t('projects.selectToDelete'),
      t('projects.selectToDeleteHint'),
      [
        { text: t('common.confirm'), style: 'default' }
      ]
    );
  };

  const renderRoomTabs = () => {
    const circularRooms = getCircularRooms();
    // Mark rooms that have at least one photo in the active project — they
    // get a bolder border so the user can see at a glance which rooms have
    // already been shot.
    const projectRoomIds = new Set();
    for (const p of (photos || [])) {
      if (!activeProjectId || p.projectId === activeProjectId) {
        if (p.room) projectRoomIds.add(p.room);
      }
    }

    return (
      <View style={styles.roomTabsContainer}>
        <ScrollView
          ref={roomTabsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.roomTabsScrollContent}
          style={styles.roomTabsScrollView}
          nestedScrollEnabled={true}
          directionalLockEnabled={true}
          scrollEnabled={true}
          bounces={false}
        >
          {circularRooms.map((room, index) => {
            const isActive = room.id === currentRoom;
            const hasPhotos = projectRoomIds.has(room.id);
            return (
              <TouchableOpacity
                key={room.id}
                style={[
                  styles.roomTab,
                  // Three visual states:
                  //   • Active room    → yellow fill + dark border
                  //   • Has photos     → no border, full opacity
                  //   • No photos      → dimmed, dashed outline
                  isActive && styles.roomTabActive,
                  !isActive && hasPhotos && styles.roomTabFilled,
                  !isActive && !hasPhotos && styles.roomTabEmpty,
                ]}
                onPress={() => setCurrentRoom(room.id)}
                onLongPress={(event) => handleRoomLongPress(room, event)}
                // Only the active tab needs its layout for centering.
                // Captures the real (variable) width so the scroll math
                // doesn't depend on a hardcoded TAB_WIDTH guess.
                onLayout={isActive ? (e) => {
                  activeTabLayoutRef.current = {
                    x: e.nativeEvent.layout.x,
                    width: e.nativeEvent.layout.width,
                  };
                  scrollActiveTabToCenter(false);
                } : undefined}
              >
                {room.image ? (
                  <Image
                    key={`room-icon-${room.id}`}
                    source={room.image}
                    style={styles.roomTabImage}
                    resizeMode="contain"
                    fadeDuration={0}
                  />
                ) : room.icon ? (
                  <Text style={{ fontSize: 24 }}>{room.icon}</Text>
                ) : (
                  <RoomIcon
                    roomId={room.id}
                    size={30}
                    color={isActive ? '#000' : theme.textPrimary}
                  />
                )}
                <Text
                  style={[
                    styles.roomTabText,
                    isActive && styles.roomTabTextActive
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {cleaningServiceEnabled
                    ? t(`rooms.${room.id}`, { lng: sectionLanguage, defaultValue: room.name })
                    : room.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  const renderPhotoGrid = () => {
    const gridItems = [];
    const gridSetNumbers = [];
    const combinedPhotos = getCombinedPhotos(currentRoom);
    // Fetched once per render — progress photos for the current room, used
    // to overlay a "N progress" badge on each card's main thumbnail.
    const progressPhotosForRoom = getProgressPhotos ? getProgressPhotos(currentRoom) : [];
    const hasPhotos = beforePhotos.length > 0;
    // Canonical "Set N" numbering tied to chronological capture order
    // (oldest = 1). Computed BEFORE applying the user's sort preference
    // so the label travelling with a set stays stable across order flips.
    const setNumberById = new Map();
    [...beforePhotos]
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .forEach((photo, idx) => {
        setNumberById.set(photo.id, idx + 1);
      });
    const orderedBeforePhotos = [...beforePhotos].sort((a, b) => {
      const ta = a.timestamp || 0;
      const tb = b.timestamp || 0;
      return captureSortOrder === 'asc' ? ta - tb : tb - ta;
    });

    if (!hasPhotos || !activeProjectId) {
      return (
        <View style={styles.emptyStateContainer}>
          <TouchableOpacity
            style={styles.addPhotoItemCenter}
            delayPressIn={50}
            onPress={() => {
              if (isSwiping.current) return;
              if (!activeProjectId) {
                openNewProjectModal(true);
                return;
              }
              if (!guardStartSet()) return;
              navigation.navigate('Camera', {
                mode: 'before',
                room: currentRoom
              });
            }}
          >
            <Image
              source={ROOMS.image}
              size={64} 
              color={COLORS.PRIMARY} 
            />
            <Text style={styles.addPhotoTextCenter}>
              {!activeProjectId ? t('home.selectProject') : t('camera.takePhoto')}
            </Text>
          </TouchableOpacity>
          {activeProjectId && (
            <TouchableOpacity
              style={styles.uploadPhotosButton}
              delayPressIn={50}
              onPress={() => {
                if (isSwiping.current) return;
                navigation.navigate('UploadPhotos', { room: currentRoom });
              }}
            >
              <Ionicons name="images-outline" size={22} color={COLORS.PRIMARY} />
              <Text style={styles.uploadPhotosText}>
                {t('home.uploadPhotos', { defaultValue: 'Upload 2 Photos' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    orderedBeforePhotos.forEach((beforePhoto, index) => {
      const setNumber = setNumberById.get(beforePhoto.id) ?? index + 1;
      gridSetNumbers.push(setNumber);
      const afterPhoto = afterPhotos.find(
        (p) => p.beforePhotoId === beforePhoto.id
      );
      // Number of progress photos linked to THIS set (demoted afters retain
      // beforePhotoId so they're still grouped). Rendered as a yellow chip
      // at the top-right of the thumbnail so the user can see how many
      // intermediate captures the set has at a glance.
      const progressCount = progressPhotosForRoom.filter(
        (p) => p.beforePhotoId === beforePhoto.id
      ).length;

      if (afterPhoto) {
        const combinedPhoto = combinedPhotos.find(
          (p) => p.name === beforePhoto.name
        );
        const thumbnailUri = combinedBaseUris[beforePhoto.name] || combinedPhoto?.uri;
        // Mirror the layout decision used when the combined image was
        // built (handleAfterPhoto → "STACK" for true-landscape pairs):
        // landscape pairs are stitched top/bottom, so the on-thumbnail
        // divider needs to run horizontally to match what the user sees
        // in the stitched image. Portrait pairs stay side-by-side and
        // keep the original vertical divider.
        const phoneOrientationCombined = beforePhoto.orientation || 'portrait';
        const cameraViewModeCombined = beforePhoto.cameraViewMode || 'portrait';
        const isLetterboxCombined =
          beforePhoto.templateType === 'letterbox' ||
          (phoneOrientationCombined === 'portrait' && cameraViewModeCombined === 'landscape');
        const isTrueLandscapeCombined = phoneOrientationCombined === 'landscape';
        const useStackedLayoutCombined =
          isTrueLandscapeCombined && !isLetterboxCombined
            ? true
            : isLetterboxCombined && isTrueLandscapeCombined;

        if (thumbnailUri) {
          // Tap behaviour on the card:
          //   single tap → Camera in After mode (most common contractor action)
          //   double tap → full-screen preview viewer (handleDoubleTap)
          //   eye icon (top-left) → same as double tap, a discoverable UI cue
          gridItems.push(
            <TouchableOpacity
              key={beforePhoto.id}
              style={styles.photoItem}
              activeOpacity={1}
              onPress={() => {
                if (longPressTriggered.current || isSwiping.current) return;
                tapCount.current += 1;
                if (tapCount.current === 1) {
                  setTimeout(() => {
                    if (tapCount.current === 1) {
                      navigation.navigate('Camera', {
                        mode: 'after',
                        beforePhoto,
                        afterPhoto,
                        combinedPhoto,
                        room: currentRoom,
                      });
                    }
                    tapCount.current = 0;
                  }, 280);
                } else if (tapCount.current === 2) {
                  handleDoubleTap(null, beforePhoto, afterPhoto);
                  tapCount.current = 0;
                }
              }}
            >
              <CroppedThumbnail
                imageUri={thumbnailUri}
                aspectRatio={beforePhoto.aspectRatio || '4:3'}
                orientation={beforePhoto.orientation || 'portrait'}
                size={PHOTO_SIZE}
              />
              {progressCount > 0 && (
                <View style={styles.progressCountBadge} pointerEvents="none">
                  <Ionicons
                    name="trending-up"
                    size={14}
                    color="#000"
                    style={{ marginRight: 3 }}
                  />
                  <Text style={styles.progressCountBadgeText}>{progressCount}</Text>
                </View>
              )}
              <View
                style={useStackedLayoutCombined ? styles.photoCenterDividerHorizontal : styles.photoCenterDivider}
                pointerEvents="none"
              />
              {/* Eye icon top-left: opens the full-screen preview viewer.
                  Same destination as a double-tap on the card body — exists
                  as a discoverable UI cue. */}
              <TouchableOpacity
                style={styles.previewIconBadge}
                onPress={(e) => {
                  e.stopPropagation();
                  handleDoubleTap(null, beforePhoto, afterPhoto);
                }}
                activeOpacity={0.7}
                // Bigger hit area than the visible 28×28 circle so the
                // preview tap is forgiving — the visible icon stays
                // small, but a much larger surrounding zone responds.
                hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
              >
                <Ionicons name="eye-outline" size={16} color={theme.textPrimary} />
              </TouchableOpacity>
              {/* Green completion check at TOP-RIGHT — only when the
                  set has its After AND there are no Progress photos.
                  Once the user adds a 3rd shot, the yellow progress-
                  count badge (also top-right) takes over the slot. */}
              {progressCount === 0 && (
                <View style={styles.photoOverlayBadgeTopRight} pointerEvents="none">
                  <Ionicons name="checkmark-circle-sharp" size={25} color="#22C55E" />
                </View>
              )}
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={(e) => {
                    e.stopPropagation();
                    if (!isSwiping.current) {
                      navigation.navigate('Camera', {
                        mode: 'after',
                        beforePhoto,
                        afterPhoto,
                        combinedPhoto,
                        room: currentRoom
                      });
                    }
                  }}
                >
                  <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>{t('home.updateAfter', { defaultValue: 'Update After' })}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        } else {
          // Has after photo but no combined yet - show split preview
          const phoneOrientation = beforePhoto.orientation || 'portrait';
          const cameraViewMode = beforePhoto.cameraViewMode || 'portrait';
          const isLetterbox = beforePhoto.templateType === 'letterbox' || (phoneOrientation === 'portrait' && cameraViewMode === 'landscape');
          const isTrueLandscape = phoneOrientation === 'landscape';
          const isLetterboxLandscape = isLetterbox && isTrueLandscape;
          const useStackedLayout = isTrueLandscape && !isLetterbox ? true : isLetterboxLandscape;

          gridItems.push(
            <TouchableOpacity
              key={beforePhoto.id}
              style={styles.photoItem}
              delayPressIn={50}
              onPress={() => {
                if (!longPressTriggered.current && !isSwiping.current) {
                  tapCount.current += 1;
                  const now = Date.now();
                  if (tapCount.current === 1) {
                    lastTap.current = now;
                    setTimeout(() => {
                      if (tapCount.current === 1 && lastTap.current) {
                        navigation.navigate('Camera', {
                          mode: 'after',
                          beforePhoto,
                          afterPhoto,
                          room: currentRoom
                        });
                      }
                      tapCount.current = 0;
                      lastTap.current = null;
                    }, 300);
                  } else if (tapCount.current === 2) {
                    handleDoubleTap(null, beforePhoto, afterPhoto);
                    tapCount.current = 0;
                    lastTap.current = null;
                  }
                }
              }}
              onPressIn={() => handleLongPressStart(null, beforePhoto, afterPhoto)}
              onPressOut={handleLongPressEnd}
            >
              <View style={[styles.splitPreview, useStackedLayout ? styles.stackedPreview : styles.sideBySidePreview]}>
                <Image source={{ uri: beforePhoto.uri }} style={styles.halfPreviewImage} resizeMode="cover" />
                <Image source={{ uri: afterPhoto.uri }} style={styles.halfPreviewImage} resizeMode="cover" />
              </View>
              {progressCount > 0 && (
                <View style={styles.progressCountBadge} pointerEvents="none">
                  <Ionicons
                    name="trending-up"
                    size={14}
                    color="#000"
                    style={{ marginRight: 3 }}
                  />
                  <Text style={styles.progressCountBadgeText}>{progressCount}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.previewIconBadge}
                onPress={(e) => {
                  e.stopPropagation();
                  handleDoubleTap(null, beforePhoto, afterPhoto);
                }}
                activeOpacity={0.7}
                // Bigger hit area than the visible 28×28 circle so the
                // preview tap is forgiving — the visible icon stays
                // small, but a much larger surrounding zone responds.
                hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
              >
                <Ionicons name="eye-outline" size={16} color={theme.textPrimary} />
              </TouchableOpacity>
              {/* Green completion check at TOP-RIGHT — only when the
                  set has its After AND no Progress photos. Once a 3rd
                  shot exists the yellow progress-count badge (also
                  top-right) replaces this in the same slot. */}
              {progressCount === 0 && (
                <View style={styles.photoOverlayBadgeTopRight} pointerEvents="none">
                  <Ionicons name="checkmark-circle-sharp" size={25} color="#22C55E" />
                </View>
              )}
              <View style={styles.thumbnailButtonsOverlay}>
                <TouchableOpacity
                  style={styles.retakeButton}
                  onPress={() => {
                    if (!isSwiping.current) {
                      navigation.navigate('Camera', {
                        mode: 'after',
                        beforePhoto,
                        afterPhoto,
                        room: currentRoom
                      });
                    }
                  }}
                >
                  <Ionicons name="camera-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.retakeButtonText}>{t('home.updateAfter', { defaultValue: 'Update After' })}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }
      } else {
        // Before-only card. Same tap rules as the before+after card:
        //   single tap → Camera in After mode
        //   double tap → full-screen preview (single before photo)
        //   eye icon (top-left) → same as double tap
        gridItems.push(
          <TouchableOpacity
            key={beforePhoto.id}
            style={[styles.photoItem]}
            activeOpacity={1}
            onPress={() => {
              if (longPressTriggered.current || isSwiping.current) return;
              tapCount.current += 1;
              if (tapCount.current === 1) {
                setTimeout(() => {
                  if (tapCount.current === 1) {
                    navigation.navigate('Camera', {
                      mode: 'after',
                      beforePhoto,
                      room: currentRoom,
                    });
                  }
                  tapCount.current = 0;
                }, 280);
              } else if (tapCount.current === 2) {
                handleDoubleTap(null, beforePhoto, null);
                tapCount.current = 0;
              }
            }}
          >
            <CroppedThumbnail
              imageUri={beforePhoto.uri}
              aspectRatio={beforePhoto.aspectRatio || '4:3'}
              orientation={beforePhoto.orientation || 'portrait'}
              size={PHOTO_SIZE}
            />
            <TouchableOpacity
              style={styles.previewIconBadge}
              onPress={(e) => {
                e.stopPropagation();
                handleDoubleTap(null, beforePhoto, null);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 18, bottom: 18, left: 18, right: 18 }}
            >
              <Ionicons name="eye-outline" size={16} color={theme.textPrimary} />
            </TouchableOpacity>
            <View style={styles.thumbnailButtonsOverlay}>
              <TouchableOpacity
                style={styles.takeAfterButton}
                onPress={(e) => {
                  e.stopPropagation();
                  if (!isSwiping.current) {
                    navigation.navigate('Camera', {
                      mode: 'after',
                      beforePhoto,
                      room: currentRoom
                    });
                  }
                }}
              >
                <Ionicons name="camera" size={14} color="#000" />
                <Text style={styles.takeAfterButtonText}>{t('home.takeNext', { defaultValue: 'Take Next' })}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.photoOverlayBadgeTopRight}>
              <View style={styles.clockBadge}>
                <Ionicons name="timer-outline" size={20} color={theme.textPrimary} fill={theme.textPrimary} />
              </View>
            </View>
          </TouchableOpacity>
        );
      }
    });

    // Wrap each tile with a "Set N" label beneath it. The number is
    // bound to chronological capture order (oldest = 1), so flipping
    // the user's sort preference reorders the tiles without renaming
    // any set. Done at the very end so the three different
    // gridItems.push paths above don't each need to know about it.
    return (
      <View style={styles.photoGrid}>
        {gridItems.map((item, i) => (
          <View key={item.key || `set-wrap-${i}`} style={styles.setTileWrapper}>
            {item}
            <Text style={styles.setTileLabel} numberOfLines={1}>
              {`Set ${gridSetNumbers[i] ?? i + 1}`}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <Text style={styles.appName}>ProofPix</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.planButtonsContainer}>
            <TouchableOpacity
              style={[
                styles.starterButton,
                styles.planButtonSelected,
                styles.planButtonSelectedBackground
              ]}
              onPress={() => navigation.navigate('PlanSelection')}
            >
              <Text style={[
                styles.starterButtonText,
                styles.planButtonSelectedText
              ]}>{(userPlan || 'starter').charAt(0).toUpperCase() + (userPlan || 'starter').slice(1)}</Text>
            </TouchableOpacity>
            {(!userPlan || userPlan === 'starter') && (
              <TouchableOpacity
                style={styles.upgradeButton}
                onPress={() => navigation.navigate('PlanSelection')}
              >
                <Image source={require('../../assets/Magic_Stick.png')} style={styles.upgradeButtonImage} resizeMode="contain" />
                <Text style={styles.upgradeButtonText}>Upgrade</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* SoftTrialBadge banner removed — starter plan now has
          unlimited single-photo share, so the "X of 3 free exports"
          banner has no information to surface. */}

      <View style={styles.projectNameContainer}>
        <View style={styles.projectInfoRow}>
          <View style={styles.projectInfoLeft}>
            <Text style={styles.projectLabel}>Project</Text>
            {(() => {
              const activeProject = projects.find(p => p.id === activeProjectId);
              const displayName = activeProject?.name || t('projects.noProjects');

              if (!activeProject) {
                return (
                  <Text style={styles.projectNameText} numberOfLines={1}>
                    {displayName}
                  </Text>
                );
              }

              if (isEditingProjectName) {
                return (
                  <TextInput
                    style={styles.projectNameInput}
                    value={editedProjectName}
                    onChangeText={setEditedProjectName}
                    placeholder={t('projects.projectNamePlaceholder', { defaultValue: 'Project name' })}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={async () => {
                      const trimmed = editedProjectName.trim();
                      if (!trimmed || trimmed === activeProject.name) {
                        setIsEditingProjectName(false);
                        setEditedProjectName('');
                        return;
                      }
                      try {
                        await renameProject(activeProject.id, trimmed);
                      } catch (e) {
                      } finally {
                        setIsEditingProjectName(false);
                        setEditedProjectName('');
                      }
                    }}
                  />
                );
              }

              return (
                <TouchableOpacity
                  // Tapping the name opens the same project menu the
                  // 3-dot button opens. Inline rename was the previous
                  // behavior; rename now lives in the menu's "Edit"
                  // action so the user has a single consistent entry
                  // point for managing the active project.
                  onPress={() => {
                    setOpenProjectVisible(true);
                  }}
                  style={styles.projectNameTouchable}
                >
                  <Text style={styles.projectNameText} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Ionicons name="chevron-down" size={14} color={theme.textMuted} style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              );
            })()}
          </View>
          <TouchableOpacity
            style={styles.projectMenuButton}
            onPress={() => setOpenProjectVisible(true)}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {renderRoomTabs()}

      <View style={styles.content} {...panResponder.panHandlers}>
        {beforePhotos.length > 0 && activeProjectId ? (
          <View style={styles.sortBar}>
            <TouchableOpacity
              style={styles.sortPill}
              onPress={() => toggleCaptureSortOrder && toggleCaptureSortOrder()}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={captureSortOrder === 'asc' ? 'arrow-up' : 'arrow-down'}
                size={14}
                color={theme.textPrimary}
                style={{ marginRight: 4 }}
              />
              <Text style={styles.sortPillText}>
                {captureSortOrder === 'asc' ? 'Oldest first' : 'Newest first'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <Animated.View style={{ flex: 1, transform: [{ translateX: contentSlideX }] }}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: 20 + insets.bottom + 50 + 80 }}
            showsVerticalScrollIndicator={false}
          >
            {renderPhotoGrid()}
          </ScrollView>
        </Animated.View>
      </View>

      {/* Camera FAB — hidden while the fullscreen photo viewer
          (tappedFullPhoto) is up. Its zIndex (100) sits above the
          viewer's bottom action row, so leaving it visible covered
          the Share button + Edit pencil we render there. */}
      {!tappedFullPhoto && (
        <TouchableOpacity
          style={[styles.fab, { bottom: 90 + insets.bottom }]}
          onPress={() => {
            if (!activeProjectId) {
              openNewProjectModal(true);
              return;
            }
            if (!guardStartSet()) return;
            navigation.navigate('Camera', {
              mode: 'before',
              room: currentRoom
            });
          }}
        >
          <Ionicons name="camera" size={38} color="#000" />
        </TouchableOpacity>
      )}

      {/* Bottom nav moved to PersistentBottomNav (App.js root). */}

      {(fullScreenPhoto || fullScreenPhotoSet) && liveSetMembers.length > 0 && (() => {
        // aspectForPhoto + helpers are hoisted to module scope; see top
        // of file. Pager + tap-to-fullscreen share the same precedence
        // (Studio pairTemplate → capture aspectRatio → original W/H).
        //
        // Shadow `setMembers` with the live, store-resolved version so
        // every read inside this render uses the latest photo data
        // (pairTemplate, metadata, etc.) — fixes the case where edits
        // saved in Studio didn't reflect back in the preview because
        // setMembers held snapshot objects from when the preview
        // opened.
        const setMembers = liveSetMembers;
        const activeMember = setMembers[setMemberIndex] || setMembers[0];
        const memberAspect = aspectForPhoto(activeMember);
        // Shared peek constants — used both by the pager render and by
        // scroll-to calls below so onLayout + thumb taps snap to the
        // exact same offsets the pager itself uses.
        const PREVIEW_PEEK = 18;
        const PREVIEW_GAP = 12;
        const pagerCardWidth = Math.max(0, previewWidth - 2 * (PREVIEW_PEEK + PREVIEW_GAP));
        const pagerSnapInterval = pagerCardWidth + PREVIEW_GAP;
        const memberLabel = (m) => {
          if (!m) return '';
          if (m.mode === 'before') return 'Before';
          if (m.mode === 'after') return 'After';
          if (m.mode === 'progress') return 'Progress';
          if (m.mode === 'combined' || m.mode === 'mix') return 'Combined';
          return '';
        };
        return (
          <View
            style={[
              styles.simplePreviewContainer,
              {
                backgroundColor: theme.background,
                // Top inset moved onto the container itself now that
                // the old top bar (back button + center swipe-down
                // hint) is gone — keeps the rest of the preview clear
                // of the notch without needing a dedicated header.
                paddingTop: fullScreenTopInset,
              },
            ]}
            {...previewDismissPanResponder.panHandlers}
          >

            {/* Sets bar — three-column row that mirrors the project
                detail screen's pattern: previous-set link on the left,
                current photo position (X / Y) in the middle, next-set
                link on the right. Tapping the side labels jumps the
                pager to that set's first photo. Hidden when the room
                has only one set (nothing to switch to). */}
            {(() => {
              const roomBefores = getBeforePhotos(currentRoom) || [];
              if (roomBefores.length < 2) return null;
              const afters = getAfterPhotos(currentRoom) || [];
              const afterByBeforeId = new Map();
              for (const a of afters) {
                if (a.beforePhotoId) afterByBeforeId.set(a.beforePhotoId, a);
              }
              const activeSetId = setMembers.find((mm) => mm?.mode === 'before')?.id
                || (setMembers[0]?.beforePhotoId ?? setMembers[0]?.id);
              const setIdx = Math.max(0, roomBefores.findIndex((b) => b.id === activeSetId));
              const setPosition = setIdx + 1;
              const setCount = roomBefores.length;
              const switchToSet = (before) => {
                if (!before) return;
                const members = [before];
                const progresses = (getProgressPhotos?.(currentRoom) || [])
                  .filter((p) => p.beforePhotoId === before.id)
                  .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                members.push(...progresses);
                const after = afterByBeforeId.get(before.id);
                if (after) members.push(after);
                const combined = findCombinedForBefore(before, currentRoom);
                if (combined) members.push(combined);
                setSetMembers(members);
                setSetMemberIndex(0);
                setFullScreenPhotoSet({ before, after: after || null });
                // Flash the destination set's title on the first photo
                // — replaces the old "Previous / Next set" sentinel
                // cards with a transient label.
                const newIdx = roomBefores.findIndex((b) => b.id === before.id);
                flashSetTitle(`Set ${newIdx >= 0 ? newIdx + 1 : setPosition}`);
                requestAnimationFrame(() => {
                  if (previewPagerRef.current && previewWidth > 0) {
                    previewPagerRef.current.scrollTo({ x: 0, animated: false });
                  }
                });
              };
              const prevBefore = setPosition > 1 ? roomBefores[setIdx - 1] : null;
              const nextBefore = setPosition < setCount ? roomBefores[setIdx + 1] : null;
              const positionInSet = Math.min(setMemberIndex + 1, Math.max(1, setMembers.length));
              return (
                <View style={styles.simplePreviewSetsBar}>
                  <TouchableOpacity
                    style={styles.simplePreviewSetsBarSide}
                    disabled={!prevBefore}
                    onPress={() => switchToSet(prevBefore)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {prevBefore && (
                      <>
                        <Ionicons name="chevron-back" size={14} color={theme.textSecondary} />
                        <Text style={[styles.simplePreviewSetsBarText, { color: theme.textSecondary }]}>
                          Set {setPosition - 1}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <View style={styles.simplePreviewSetsBarCenter}>
                    <View style={[styles.simplePreviewPositionPill, { backgroundColor: theme.surface }]}>
                      <Text style={[styles.simplePreviewPositionText, { color: theme.textPrimary }]}>
                        {positionInSet} / {Math.max(1, setMembers.length)}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.simplePreviewSetsBarSide, styles.simplePreviewSetsBarSideRight]}
                    disabled={!nextBefore}
                    onPress={() => switchToSet(nextBefore)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {nextBefore && (
                      <>
                        <Text style={[styles.simplePreviewSetsBarText, { color: theme.textSecondary }]}>
                          Set {setPosition + 1}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={theme.textSecondary} />
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })()}

            {/* Project name + capture date — sits above the photo so
                the user can see which project and when each photo was
                taken without leaving the preview. The date comes from
                the active member's timestamp (falls back to its
                createdAt if no timestamp was recorded). */}
            <View style={styles.simplePreviewInfoRow}>
              <Text
                style={[styles.simplePreviewProjectName, { color: theme.textPrimary }]}
                numberOfLines={1}
              >
                {activeProject?.name || ''}
              </Text>
              <Text style={[styles.simplePreviewPhotoDate, { color: theme.textSecondary }]}>
                {(() => {
                  const ts = typeof activeMember?.timestamp === 'number'
                    ? activeMember.timestamp
                    : (activeMember?.createdAt ? new Date(activeMember.createdAt).getTime() : null);
                  if (!ts) return '';
                  try {
                    return new Date(ts).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    });
                  } catch {
                    return '';
                  }
                })()}
              </Text>
            </View>

            {/* Pager — horizontal swipe through the set members. Each
                page renders the photo at its own pairTemplate aspect so
                the framing matches what the user picked in Studio.
                The body reserves bottom padding for both the thumb
                strip and the bottom nav so neither overlaps the photo
                or each other. */}
            <View
              style={[
                styles.simplePreviewBody,
                {
                  // No padding here — the compact swipe-down chevron
                  // below the body now reserves nav clearance via its
                  // own paddingBottom. Letting the body extend all the
                  // way down makes the photo noticeably larger,
                  // especially on portrait captures where the picture
                  // used to leave a wide empty strip below itself.
                  paddingBottom: 0,
                },
              ]}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                const h = e.nativeEvent.layout.height;
                if (w > 0 && w !== previewWidth) setPreviewWidth(w);
                if (h > 0 && h !== previewHeight) setPreviewHeight(h);
                // Snap to the active page using the SAME interval the
                // pager uses internally; using `w` directly would over-
                // scroll past each card since the card is narrower
                // than the container.
                requestAnimationFrame(() => {
                  if (previewPagerRef.current && w > 0) {
                    const cardW = Math.max(0, w - 2 * (PREVIEW_PEEK + PREVIEW_GAP));
                    const snap = cardW + PREVIEW_GAP;
                    // Offset by 1 when a prev-set sentinel is the
                    // first slide so the layout lands on the first
                    // REAL photo, not the sentinel.
                    const roomBeforesNow = getBeforePhotos(currentRoom) || [];
                    const activeSetIdNow = setMembers.find((mm) => mm?.mode === 'before')?.id
                      || (setMembers[0]?.beforePhotoId ?? setMembers[0]?.id);
                    const activeIdxNow = roomBeforesNow.findIndex((b) => b.id === activeSetIdNow);
                    const hasPrevSentinel = activeIdxNow > 0;
                    const startOffset = (hasPrevSentinel ? 1 : 0) + setMemberIndex;
                    previewPagerRef.current.scrollTo({
                      x: startOffset * snap,
                      animated: false,
                    });
                  }
                });
              }}
            >
              {(() => {
                // Card-style pagination with peek: each photo is rendered
                // narrower than the container, so the previous/next
                // photo's edge is visible on the sides as a cue to swipe.
                // snapToInterval = card + gap so the pager still snaps
                // crisply to each photo. Constants live in the outer
                // scope so onLayout + thumb taps stay in sync.
                const sideInset = (previewWidth - pagerCardWidth) / 2;
                // Identify the prev/next sets (if any) so we can
                // bracket the pager with sentinel pages that trigger
                // auto-advance when the user swipes past either end.
                const roomBeforesForPager = getBeforePhotos(currentRoom) || [];
                const activePagerSetId = setMembers.find((mm) => mm?.mode === 'before')?.id
                  || (setMembers[0]?.beforePhotoId ?? setMembers[0]?.id);
                const activePagerSetIdx = Math.max(0, roomBeforesForPager.findIndex((b) => b.id === activePagerSetId));
                const nextPagerBefore = activePagerSetIdx < roomBeforesForPager.length - 1
                  ? roomBeforesForPager[activePagerSetIdx + 1]
                  : null;
                const prevPagerBefore = activePagerSetIdx > 0
                  ? roomBeforesForPager[activePagerSetIdx - 1]
                  : null;
                const switchToPagerSet = (before, opts = {}) => {
                  if (!before) return;
                  const { landOnLast = false } = opts;
                  const aftersForRoom = getAfterPhotos(currentRoom) || [];
                  const afterEntry = aftersForRoom.find((p) => p.beforePhotoId === before.id);
                  const members = [before];
                  const progresses = (getProgressPhotos?.(currentRoom) || [])
                    .filter((p) => p.beforePhotoId === before.id)
                    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                  members.push(...progresses);
                  if (afterEntry) members.push(afterEntry);
                  const combinedSwitch = findCombinedForBefore(before, currentRoom);
                  if (combinedSwitch) members.push(combinedSwitch);
                  setSetMembers(members);
                  const landIdx = landOnLast ? members.length - 1 : 0;
                  setSetMemberIndex(landIdx);
                  setFullScreenPhotoSet({ before, after: afterEntry || null });
                  // Flash the destination set's title — the user spec'd
                  // a transient (≈500 ms) big label on the set's
                  // start/finish photo in place of the old sentinel
                  // "Previous / Next set" cards.
                  const newRoomBefores = getBeforePhotos(currentRoom) || [];
                  const newIdx = newRoomBefores.findIndex((b) => b.id === before.id);
                  flashSetTitle(`Set ${newIdx >= 0 ? newIdx + 1 : 1}`);
                  requestAnimationFrame(() => {
                    if (previewPagerRef.current && previewWidth > 0) {
                      previewPagerRef.current.scrollTo({
                        x: landIdx * pagerSnapInterval,
                        animated: false,
                      });
                    }
                  });
                };
                // Sentinels stay in pagerSlides as INVISIBLE pages so
                // the user can still swipe past the start / end of a
                // set to trigger the next-set transition. The visible
                // "Previous / Next set" card is replaced by a brief
                // big title that flashes over the new set's first /
                // last photo (see flashSetTitle + the render branch
                // for `m.__prevSet || m.__nextSet`).
                const pagerSlides = [
                  ...(prevPagerBefore ? [{ id: '__prev_set_sentinel__', __prevSet: true }] : []),
                  ...setMembers,
                  ...(nextPagerBefore ? [{ id: '__next_set_sentinel__', __nextSet: true }] : []),
                ];
                const realStartIdx = prevPagerBefore ? 1 : 0;
                return (
                  <View style={{ flex: 1, position: 'relative' }}>
                  <ScrollView
                    ref={previewPagerRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={pagerSnapInterval}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    bounces={false}
                    onScrollBeginDrag={() => { previewPagerScrolling.current = true; }}
                    onMomentumScrollEnd={(e) => {
                      previewPagerScrolling.current = false;
                      const idx = Math.round(e.nativeEvent.contentOffset.x / pagerSnapInterval);
                      // Edge sentinels — at the leftmost slot when a
                      // prev set exists, or the rightmost slot when a
                      // next set exists. Landing on either triggers
                      // the switch; "prev" lands on the previous set's
                      // LAST photo so the user perceives continuous
                      // backward navigation.
                      if (prevPagerBefore && idx === 0) {
                        switchToPagerSet(prevPagerBefore, { landOnLast: true });
                        return;
                      }
                      if (nextPagerBefore && idx === pagerSlides.length - 1) {
                        switchToPagerSet(nextPagerBefore);
                        return;
                      }
                      const realIdx = idx - realStartIdx;
                      if (realIdx !== setMemberIndex && realIdx >= 0 && realIdx < setMembers.length) {
                        setSetMemberIndex(realIdx);
                      }
                    }}
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                      paddingHorizontal: sideInset,
                      alignItems: 'center',
                    }}
                  >
                    {pagerSlides.map((m) => {
                      if (m.__prevSet || m.__nextSet) {
                        // Invisible swipe-trigger page. The card chrome
                        // ("Previous / Next set" label) is gone — the
                        // user now sees a brief title flash on the new
                        // set's start/finish photo (flashSetTitle) the
                        // moment switchToPagerSet fires.
                        return (
                          <View
                            key={m.id}
                            style={{
                              width: pagerCardWidth,
                              height: '100%',
                              marginRight: PREVIEW_GAP,
                            }}
                          />
                        );
                      }
                      // Size the photo container to its EXACT rendered
                      // dimensions (computed from aspect + available
                      // body w/h). With the container matching the
                      // photo's aspect, resizeMode="cover" fills it
                      // edge-to-edge — no letterbox bars — and the
                      // trash/share icons land on the photo itself.
                      // Top-align so the photo sits up under the
                      // header info row instead of being centered with
                      // a big empty strip above it.
                      const aspect = aspectForPhoto(m);
                      // previewHeight is the body's full layout height.
                      // Action rows above + below the photo each take
                      // ~48 px (40 px button + 8 px breathing); reserve
                      // their combined height plus a tiny gap so the
                      // photo shrinks to fit and the rows aren't
                      // overlapped by the picture.
                      const ACTION_ROW_HEIGHT = 40;
                      const ACTION_ROW_GAP = 8;
                      const reservedRows = (ACTION_ROW_HEIGHT + ACTION_ROW_GAP) * 2;
                      const availW = Math.max(0, pagerCardWidth);
                      const availH = Math.max(0, previewHeight - reservedRows);
                      let cardW = availW;
                      let cardH = availH;
                      if (aspect > 0 && availW > 0 && availH > 0) {
                        // Fit to whichever dimension is the binding
                        // constraint, preserving the photo's aspect.
                        if (aspect >= availW / availH) {
                          // Wider than the slot — width-bound.
                          cardW = availW;
                          cardH = availW / aspect;
                        } else {
                          // Taller than the slot — height-bound.
                          cardH = availH;
                          cardW = availH * aspect;
                        }
                      }
                      return (
                        <View
                          key={m.id}
                          style={{
                            width: pagerCardWidth,
                            height: '100%',
                            marginRight: PREVIEW_GAP,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {/* TOP action row — Edit on the left, Trash
                              on the right. Sits ABOVE the photo, sized
                              to the photo's width so both buttons line
                              up with the picture's edges. */}
                          <View style={[styles.simplePreviewActionRow, { width: cardW, marginBottom: ACTION_ROW_GAP }]}>
                            <TouchableOpacity
                              style={[styles.simplePreviewActionBtn, { backgroundColor: theme.surface }]}
                              onPress={() => {
                                if (!m?.id) return;
                                navigation.navigate('StudioDetail', { photoId: m.id });
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="create-outline" size={18} color={theme.textPrimary} />
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.simplePreviewActionBtn, { backgroundColor: theme.danger }]}
                              onPress={() => {
                                if (!m?.id) return;
                                pendingDeletePhotoIdRef.current = m.id;
                                setShowDeletePhotoConfirm(true);
                              }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
                            </TouchableOpacity>
                          </View>
                          {/* Photo card — only the picture (and the
                              Studio overlay stack when the Edited
                              switch is on) lives here. Tapping it opens
                              the fullscreen viewer Modal (tappedFullPhoto)
                              where pinch-zoom + drag-pan live. */}
                          <View
                            style={{
                              width: cardW,
                              height: cardH,
                              backgroundColor: theme.surface,
                              borderRadius: 12,
                              overflow: 'hidden',
                            }}
                          >
                            <TouchableOpacity
                              activeOpacity={0.95}
                              onPress={() => setTappedFullPhoto(m)}
                              style={{ width: '100%', height: '100%' }}
                            >
                              <Image
                                source={{ uri: m.uri }}
                                style={{ width: '100%', height: '100%' }}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                            {/* The Edited toggle is the master switch for
                                all on-photo overlays — labels, watermark,
                                brand logo, metadata, markup. PhotoLabels
                                still respects Settings.showLabels too, so
                                turning labels off in Settings hides them
                                even when Edited is on. */}
                            {showStudioEdits && (
                              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                                <StudioEditOverlays photo={m} theme={theme} />
                              </View>
                            )}
                          </View>
                          {/* BOTTOM action row — Edited toggle on the
                              left, Share on the right. Same width as
                              the photo so buttons sit flush with the
                              picture's edges. */}
                          <View style={[styles.simplePreviewActionRow, { width: cardW, marginTop: ACTION_ROW_GAP }]}>
                            <View style={[styles.simplePreviewEditedToggleInline, { backgroundColor: theme.surface }]}>
                              <Text style={[styles.simplePreviewEditedToggleLabel, { color: theme.textPrimary }]}>Edited</Text>
                              <Switch
                                value={showStudioEdits}
                                onValueChange={setShowStudioEdits}
                                trackColor={{ false: theme.border, true: COLORS.PRIMARY }}
                                thumbColor="#FFFFFF"
                                ios_backgroundColor={theme.border}
                                style={styles.simplePreviewEditedSwitch}
                              />
                            </View>
                            <View style={styles.simplePreviewActionRowEnd}>
                              {/* Notes glyph — only shown when this photo
                                  has a non-empty note. Tapping it opens a
                                  read-only viewer; private notes are
                                  surfaced here too since this is the
                                  photographer's own preview. */}
                              {!!(m?.notes && String(m.notes).trim()) && (
                                <TouchableOpacity
                                  style={[styles.simplePreviewActionBtn, { backgroundColor: theme.surface }]}
                                  onPress={() => setViewingNotes({ text: String(m.notes).trim(), type: m?.noteType || 'report' })}
                                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                >
                                  <Ionicons name="document-text-outline" size={18} color={theme.textPrimary} />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity
                                style={[styles.simplePreviewActionBtn, { backgroundColor: theme.surface }]}
                                onPress={async () => {
                                  if (!m?.uri) return;
                                  try {
                                    let shareUri = m.uri;
                                    if (showStudioEdits) {
                                      setShareCaptureContext({ photo: m, w: cardW, h: cardH });
                                      await new Promise((resolve) => setTimeout(resolve, 120));
                                      if (shareCaptureRef.current) {
                                        try {
                                          const composed = await captureRef(shareCaptureRef, {
                                            format: 'jpg',
                                            quality: 0.95,
                                            result: 'tmpfile',
                                          });
                                          shareUri = composed;
                                        } catch (capErr) {
                                          console.warn('[HomeScreen] composite capture failed, falling back to original URI:', capErr?.message);
                                        }
                                      }
                                      setShareCaptureContext(null);
                                    }
                                    await RNShare.share({
                                      url: shareUri,
                                      message: activeProject?.name || '',
                                    });
                                  } catch (_) {
                                    setShareCaptureContext(null);
                                  }
                                }}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Ionicons name="share-outline" size={18} color={theme.textPrimary} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                  {/* Transient set-title overlay — fires from
                      switchToSet / switchToPagerSet whenever the pager
                      crosses into a different set. Pointer-events
                      none so it never eats taps even mid-fade. */}
                  {flashTitle && (
                    <Animated.View
                      pointerEvents="none"
                      style={[styles.setFlashOverlay, { opacity: flashOpacity }]}
                    >
                      <Text style={styles.setFlashText}>{flashTitle}</Text>
                    </Animated.View>
                  )}
                  </View>
                );
              })()}
            </View>

            {/* Thumbnail strip — pinned to the very bottom and tall
                enough to cover the persistent bottom nav so no nav-bar
                separator peeks above it. Active cell gets the accent
                ring. Tap to jump straight to that page. */}
            {/* Bottom thumbnail strip was removed at the user's
                request — set navigation is handled by the < Set N | X/Y
                | Set N+1 > row at the top and by horizontal swipes
                across the pager (which also walk to the prev/next set
                via the sentinel pages at the row's edges). */}

            {/* Compact swipe-down close chevron — mirrors the camera
                screen's gallery-panel chevron: just an icon, centered.
                Tap also closes the preview. paddingBottom keeps the
                chevron above the floating PersistentBottomNav (50 px +
                safe-area). */}
            <TouchableOpacity
              onPress={handleLongPressEnd}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
              style={[
                styles.simplePreviewSwipeHint,
                {
                  paddingTop: 6,
                  paddingBottom: insets.bottom + 50 + 6,
                },
              ]}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-down" size={22} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Hidden share-composite renderer — mounted only while a share
          with the "Edited" toggle on is in flight. Positioned off-
          screen with the same dimensions the preview pager card uses
          (so the captured composition matches what the user saw).
          collapsable=false is required on Android to keep the View in
          the native hierarchy for captureRef to find it. */}
      {shareCaptureContext && (
        <View
          ref={shareCaptureRef}
          collapsable={false}
          style={{
            position: 'absolute',
            left: -10000,
            top: 0,
            width: shareCaptureContext.w,
            height: shareCaptureContext.h,
            backgroundColor: theme.surface,
            overflow: 'hidden',
          }}
        >
          <Image
            source={{ uri: shareCaptureContext.photo.uri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <StudioEditOverlays photo={shareCaptureContext.photo} theme={theme} />
          </View>
        </View>
      )}

      {/* Tap-to-fullscreen viewer — now backed by the shared
          enlarged-photo viewer component so the capture-screen
          enlarged view matches PhotoSetPreviewScreen (bigger frame,
          prev/next set chips, swipe navigation). setMembers is the
          current set's pool; jumping between sets rebuilds it in place. */}
      {!!tappedFullPhoto && (() => {
        // Build the room's ordered before list once so we can derive
        // the active-set index + neighbour sets for the top set-nav row.
        const roomBeforesForNav = getBeforePhotos(currentRoom) || [];
        const aftersForNav = getAfterPhotos(currentRoom) || [];
        const afterByBeforeIdNav = new Map();
        for (const a of aftersForNav) {
          if (a.beforePhotoId) afterByBeforeIdNav.set(a.beforePhotoId, a);
        }
        const activeBeforeIdNav = setMembers.find((mm) => mm?.mode === 'before')?.id
          || (setMembers[0]?.beforePhotoId ?? setMembers[0]?.id);
        const activeSetIdxNav = Math.max(
          0,
          roomBeforesForNav.findIndex((b) => b.id === activeBeforeIdNav)
        );
        // Wrap prev/next around the room's before list so the last
        // set's next-swipe lands on the first set (and vice versa).
        // hasMultipleSetsNav guards against jump-to-self.
        const hasMultipleSetsNav = roomBeforesForNav.length > 1;
        const prevBeforeNav = activeSetIdxNav > 0
          ? roomBeforesForNav[activeSetIdxNav - 1]
          : (hasMultipleSetsNav ? roomBeforesForNav[roomBeforesForNav.length - 1] : null);
        const nextBeforeNav = activeSetIdxNav < roomBeforesForNav.length - 1
          ? roomBeforesForNav[activeSetIdxNav + 1]
          : (hasMultipleSetsNav ? roomBeforesForNav[0] : null);
        const prevSetIdxNav = activeSetIdxNav > 0
          ? activeSetIdxNav - 1
          : (hasMultipleSetsNav ? roomBeforesForNav.length - 1 : -1);
        const nextSetIdxNav = activeSetIdxNav < roomBeforesForNav.length - 1
          ? activeSetIdxNav + 1
          : (hasMultipleSetsNav ? 0 : -1);

        // Build the members list for a given "before" (Before →
        // Progresses → After → Combined). Shared by both jump handlers.
        const buildMembersForBefore = (before) => {
          if (!before) return { members: [], after: null };
          const members = [before];
          const progresses = (getProgressPhotos?.(currentRoom) || [])
            .filter((p) => p.beforePhotoId === before.id)
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          members.push(...progresses);
          const after = afterByBeforeIdNav.get(before.id);
          if (after) members.push(after);
          const combined = findCombinedForBefore(before, currentRoom);
          if (combined) members.push(combined);
          return { members, after: after || null };
        };
        const jumpToSet = (before, targetSetIdx) => {
          if (!before) return;
          const built = buildMembersForBefore(before);
          if (!built.members?.length) return;
          setSetMembers(built.members);
          setSetMemberIndex(0);
          // DO NOT set fullScreenPhotoSet here — that would re-enable the
          // deprecated inline enlarged view (project-name + date + Edited
          // toggle chrome) and the fullscreen EnlargedPhotoViewer would
          // collapse back to the smaller UI. Only tappedFullPhoto drives
          // the shared viewer now.
          setTappedFullPhoto(built.members[0]);
          if (typeof targetSetIdx === 'number' && targetSetIdx >= 0) {
            setFullScreenPoolSignal((prev) => ({
              nonce: prev.nonce + 1,
              label: `Set ${targetSetIdx + 1}`,
            }));
          }
        };
        return (
          <View style={StyleSheet.absoluteFill}>
            {/* Capture-screen tapped-photo viewer — matches the timeline
                (PhotoSetPreviewScreen) chrome exactly so users see the
                same UI on both flows. Set nav chips, close, delete,
                overlays toggle, share, and edit are all wired to the
                same shared component. */}
            <EnlargedPhotoViewer
              photos={setMembers}
              initialPhotoId={liveTappedFullPhoto?.id || tappedFullPhoto?.id}
              onClose={() => setTappedFullPhoto(null)}
              setLabel={() => roomBeforesForNav.length > 1 ? `Set ${activeSetIdxNav + 1}` : ''}
              prevSetLabel={() => prevSetIdxNav >= 0 ? `Set ${prevSetIdxNav + 1}` : null}
              nextSetLabel={() => nextSetIdxNav >= 0 ? `Set ${nextSetIdxNav + 1}` : null}
              onPrevSet={() => jumpToSet(prevBeforeNav, prevSetIdxNav)}
              onNextSet={() => jumpToSet(nextBeforeNav, nextSetIdxNav)}
              poolChangeSignal={fullScreenPoolSignal}
              showOverlays
              overlaysOn={showStudioEdits}
              onOverlaysChange={setShowStudioEdits}
              showDelete
              onDelete={(p) => {
                if (!p?.id) return;
                setTappedFullPhoto(null);
                deletePhoto?.(p.id);
              }}
              showEdit
              onEdit={(p) => {
                if (!p?.id) return;
                setTappedFullPhoto(null);
                navigation.navigate('StudioDetail', { photoId: p.id });
              }}
              shareLabel="Share photo"
              onShare={async (p) => {
                if (!p?.uri) return;
                try {
                  await RNShare.share({
                    url: p.uri,
                    message: activeProject?.name || '',
                  });
                } catch (_) {
                  // user dismissed
                }
              }}
            />
          </View>
        );
      })()}

      <Modal
        visible={openProjectVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setOpenProjectVisible(false)}
      >
        <View style={styles.optionsModalOverlay}>
          <View style={styles.optionsModalContent}>
            <Text style={styles.optionsTitle}>
              {t('projects.switchProject', { defaultValue: 'Projects' })}
            </Text>

            {projects.length > 0 && (
              <ScrollView style={styles.projectList} showsVerticalScrollIndicator={false}>
                {projects.map((proj) => {
                  const isActive = proj.id === activeProjectId;
                  return (
                    <TouchableOpacity
                      key={proj.id}
                      style={[
                        styles.projectItem,
                        isActive && { backgroundColor: '#FFEAA0', borderWidth: 1.5, borderColor: '#F2C31B' },
                      ]}
                      onPress={() => {
                        setActiveProject(proj.id);
                        setOpenProjectVisible(false);
                      }}
                    >
                      <View style={styles.projectItemContent}>
                        {isActive && (
                          <Ionicons name="checkmark-circle" size={18} color="#B8860B" style={{ marginRight: 8 }} />
                        )}
                        <Text style={[styles.projectItemText, isActive && { fontWeight: '700', color: '#000' }]} numberOfLines={1}>
                          {proj.name}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {projects.length === 0 && (
              <Text style={{ textAlign: 'center', color: '#999', marginBottom: 12 }}>
                {t('projects.noProjects')}
              </Text>
            )}

            <View style={{ height: 1, backgroundColor: '#ECECEC', marginVertical: 12 }} />

            {activeProject && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#FFF8E1' }]}
                onPress={() => {
                  setOpenProjectVisible(false);
                  setTimeout(() => {
                    setEditedProjectName(activeProject.name);
                    setIsEditingProjectName(true);
                  }, 100);
                }}
              >
                <Ionicons name="pencil-outline" size={18} color="#B8860B" style={{ marginRight: 6 }} />
                <Text style={[styles.actionBtnText, { color: '#B8860B' }]}>{t('home.renameProject', { defaultValue: 'Edit' })}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#22A45D', marginTop: 8 }]}
              onPress={() => {
                setOpenProjectVisible(false);
                setTimeout(() => openNewProjectModal(false), 50);
              }}
            >
              <Text style={[styles.actionBtnText, { color: 'white' }]}>＋ {t('home.newProject')}</Text>
            </TouchableOpacity>

            {activeProject && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#FFE6E6', marginTop: 8 }]}
                onPress={() => {
                  selectedProjectsForDeleteRef.current = new Set([activeProject.id]);
                  setOpenProjectVisible(false);
                  setTimeout(() => {
                    setShowDeleteProjectsConfirm(true);
                  }, 300);
                }}
              >
                <Ionicons name="trash-outline" size={18} color="#CC0000" style={{ marginRight: 6 }} />
                <Text style={[styles.actionBtnText, { color: '#CC0000' }]}>{t('common.delete', { defaultValue: 'Delete' })}</Text>
              </TouchableOpacity>
            )}

            {activeProject && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#D6ECFF', marginTop: 8 }]}
                onPress={() => {
                  setOpenProjectVisible(false);
                  navigation.reset({ index: 0, routes: [{ name: 'Gallery', params: { openManage: true } }] });
                }}
              >
                <Ionicons name="share-outline" size={18} color="#0077CC" style={{ marginRight: 6 }} />
                <Text style={[styles.actionBtnText, { color: '#0077CC' }]}>{t('home.shareProject', { defaultValue: 'Share' })}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#F2F2F2', marginTop: 16 }]}
              onPress={() => setOpenProjectVisible(false)}
            >
              <Text style={styles.actionBtnText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Old HomeScreen-local New Project modal removed — the FAB now
          navigates to Projects with `openNewProject: true`, which opens
          the canonical modal (street-precise location, industry
          dropdown, location checkbox, clearable name). Single source
          of truth in ProjectsScreen.js. */}

      <Modal visible={showContextMenu} transparent={true} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowContextMenu(false)}>
          <View style={styles.contextMenuOverlay}>
            <View style={[styles.contextMenu, { 
              left: Math.min(contextMenuPosition.x, width - 200),
              top: Math.max(contextMenuPosition.y - 100, 50)
            }]}>
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  setShowContextMenu(false);
                  handleAddFolder();
                }}
              >
                <Text style={styles.contextMenuIcon}>➕</Text>
                <Text style={styles.contextMenuText}>{t('home.addFolder')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.contextMenuItem}
                onPress={() => {
                  setShowContextMenu(false);
                  handleDuplicateFolder(contextMenuRoom);
                }}
              >
                <Text style={styles.contextMenuIcon}>📋</Text>
                <Text style={styles.contextMenuText}>{t('home.duplicateFolder')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.contextMenuItem, styles.contextMenuItemDanger]}
                onPress={() => {
                  setShowContextMenu(false);
                  handleDeleteFolder(contextMenuRoom);
                }}
              >
                <Text style={styles.contextMenuIcon}>🗑️</Text>
                <Text style={[styles.contextMenuText, styles.contextMenuTextDanger]}>{t('home.deleteFolder')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <RoomEditor
        visible={showRoomEditor}
        mode={roomEditorMode}
        onClose={() => {
          setShowRoomEditor(false);
          setContextMenuRoom(null);
          setRoomEditorMode('customize');
        }}
        onSave={(rooms) => {
          saveCustomRooms(rooms);
          if (contextMenuRoom) {
            setCurrentRoom(contextMenuRoom.id);
          }
          setShowRoomEditor(false);
          setContextMenuRoom(null);
          setRoomEditorMode('customize');
        }}
        initialRooms={customRooms}
        editRoom={contextMenuRoom}
      />


      <EnterpriseContactModal
        visible={showEnterpriseModal}
        onClose={() => setShowEnterpriseModal(false)}
      />

      <DeleteConfirmationModal
        visible={showDeleteProjectsConfirm}
        title={t('projects.deleteProjects')}
        message={showDeleteProjectsConfirm ? (() => {
          const selectedIds = Array.from(selectedProjectsForDeleteRef.current);
          const projectNames = selectedIds.map(id => 
            projects.find(p => p.id === id)?.name
          ).filter(Boolean);
          return t('projects.deleteProjectsConfirm', { count: selectedIds.length, names: projectNames.join(', ') });
        })() : ''}
        onConfirm={handleDeleteSelectedProjectsConfirmed}
        onCancel={() => {
          setShowDeleteProjectsConfirm(false);
          selectedProjectsForDeleteRef.current = new Set();
          setTimeout(() => {
            setOpenProjectVisible(true);
          }, 100);
        }}
        deleteFromStorageDefault={true}
      />

      <DeleteConfirmationModal
        visible={showDeletePhotoConfirm}
        title={t('home.deletePhotoSet')}
        message={t('home.deletePhotoSetConfirm', {
          name: (() => {
            if (!pendingDeletePhotoIdRef.current) return '';
            const p = photos.find(ph => ph.id === pendingDeletePhotoIdRef.current);
            return p?.name || '';
          })()
        })}
        onConfirm={(deleteFromStorage) => {
          const photoId = pendingDeletePhotoIdRef.current;
          setShowDeletePhotoConfirm(false);
          pendingDeletePhotoIdRef.current = null;
          handleLongPressEnd();
          if (!photoId) return;
          // Trash now lives ON the photo and always targets a single
          // photo (any mode). deletePhoto handles all modes; the old
          // deletePhotoSet path nuked the whole set, which is the wrong
          // intent for a per-photo trash icon.
          deletePhoto(photoId, { deleteFromStorage });
        }}
        onCancel={() => {
          setShowDeletePhotoConfirm(false);
          pendingDeletePhotoIdRef.current = null;
          longPressTriggered.current = false;
        }}
        deleteFromStorageDefault={true}
      />

      <QualificationPromptModal
        visible={showQualification}
        mandatory
        onClose={() => setShowQualification(false)}
      />

      {/* Read-only notes viewer — opens from the document glyph next to
          the share button on each preview card. Plain centered card with
          a single Close action; private vs. report type is shown as a
          small label so the user can tell at a glance. */}
      <Modal
        visible={!!viewingNotes}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingNotes(null)}
      >
        <TouchableWithoutFeedback onPress={() => setViewingNotes(null)}>
          <View style={styles.notesViewerBackdrop} />
        </TouchableWithoutFeedback>
        <View style={styles.notesViewerCenter} pointerEvents="box-none">
          <View style={[styles.notesViewerCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
            <View style={styles.notesViewerHeader}>
              <Ionicons name="document-text-outline" size={18} color={theme.textPrimary} />
              <Text style={[styles.notesViewerTitle, { color: theme.textPrimary }]}>Note</Text>
              {viewingNotes?.type === 'private' && (
                <Text style={[styles.notesViewerTag, { color: theme.textSecondary, borderColor: theme.border }]}>Private</Text>
              )}
            </View>
            <ScrollView
              style={styles.notesViewerScroll}
              contentContainerStyle={styles.notesViewerScrollContent}
              showsVerticalScrollIndicator
            >
              <Text style={[styles.notesViewerText, { color: theme.textPrimary }]}>
                {viewingNotes?.text || ''}
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.notesViewerClose, { backgroundColor: COLORS.PRIMARY }]}
              onPress={() => setViewingNotes(null)}
            >
              <Text style={styles.notesViewerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.background,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    
  },
  logoImage: {
    width: 41,
    height: 28,
    marginRight: 0,
  },
  appName: {
    fontSize: 23,
    fontWeight: '700',
    fontFamily: 'Alexandria_400Regular',
    color: theme.textPrimary,
    letterSpacing: -0.1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  planButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F2C31B',
    borderRadius: 30,
    overflow: 'hidden',
    height: 32,
  },
  starterButton: {
    backgroundColor: theme.surfaceElevated,
    paddingHorizontal: 16,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starterButtonText: {
    color: theme.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.11,
  },
  navItemImage:{
    width: 22,
    height: 22,
  },
  upgradeButton: {
    paddingHorizontal: 12,
    height: 32,
    fontWeight: '700',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 30,
  },
  upgradeButtonIcon: {
    marginRight: 4,
  },
  upgradeButtonText: {
    color: theme.textPrimary,
    fontSize: 13.7,
    fontWeight: '700',
  },
  planButtonSelected: {
    borderRadius: 20,
    borderColor: COLORS.PRIMARY,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
  planButtonSelectedBackground: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 20,
  },
  planButtonSelectedText: {
    color: '#000000',
    fontWeight: '700',
  },
  projectNameContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 17,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: 'grey',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 9,
  },
  upgradeButtonImage:{
    width: 14,
    height: 14,
    marginRight: 4,
  },
  roomTabImage:{
    width: 35,
    height: 35,
  },
  projectInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  projectInfoLeft: {
    flex: 1,
    marginRight: 12,
  },
  projectLabel: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '500',
    marginBottom: 4,
    letterSpacing: -0.1,
  },
  projectNameText: {
    fontSize: 17,
    color: theme.textPrimary,
    fontWeight: '700',
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  projectNameTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  projectMenuButton: {
    padding: 8,
  },
  projectNameInput: {
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 16,
    color: COLORS.TEXT,
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F2C31B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
    zIndex: 100,
  },
  bottomNavPill: {
    position: 'absolute',
    bottom: 20,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
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
    height: 50,
  },
  navItemActive: {
    backgroundColor: theme.borderStrong,
    borderRadius: 100,
    marginHorizontal: -7,
  },
  navItemText: {
    fontSize: 10,
    fontWeight: '510',
    color: theme.textPrimary,
    marginTop: 1,
    textAlign: 'center',
  },
  navItemTextActive: {
    color: theme.textPrimary,
    fontWeight: '590',
    letterSpacing: -0.1,
  },
  roomTabsContainer: {
    backgroundColor: theme.background,
    paddingVertical: 12,
  },
  roomTabsScrollView: {
    flex: 0,
  },
  roomTabsScrollContent: {
    paddingHorizontal: 16,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roomTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.surfaceElevated,
    minWidth: 69,
    height: 63,
    borderWidth: 1,
    borderColor: theme.border,
  },
  // Active room: yellow fill + dark border. Only the active card has a
  // visible border so the eye lands cleanly on the focused room.
  roomTabActive: {
    backgroundColor: '#FFEAA0',
    borderColor: '#1E1E1E',
    borderWidth: 2,
  },
  // Inactive room with photos — full opacity, no border. Cleaner row
  // since only the active room is outlined.
  roomTabFilled: {
    backgroundColor: theme.surfaceElevated,
    borderColor: 'transparent',
    borderWidth: 0,
  },
  // "No photos in this room yet" — dimmed + dashed outline so the user
  // can tell at a glance which rooms they haven't shot in.
  roomTabEmpty: {
    backgroundColor: theme.surface,
    borderColor: theme.borderStrong,
    borderWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.55,
  },
  roomTabText: {
    fontSize: 10,
    color: theme.textPrimary,
    fontWeight: '400',
    marginTop: 5,
    textAlign: 'center',
    letterSpacing: -0.1,
    flexShrink: 0,
  },
  roomTabTextActive: {
    color: '#000000',
    fontWeight: '590',
  },
  content: {
    flex: 1,
    paddingHorizontal: 17,
    paddingTop: 8,
    backgroundColor: theme.background,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  sortBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sortPillText: {
    fontFamily: FONTS.SEMIBOLD,
    fontSize: 11,
    color: theme.textPrimary,
  },
  photoItem: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: theme.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  // Column wrapper for the photo card + its "Set N" label so the grid
  // still flex-wraps two-per-row but each cell now also includes the
  // label underneath the tile.
  setTileWrapper: {
    width: PHOTO_SIZE,
    marginBottom: 16,
    alignItems: 'center',
  },
  setTileLabel: {
    marginTop: 6,
    fontFamily: FONTS.SEMIBOLD,
    fontSize: 12,
    color: theme.textPrimary,
    textAlign: 'center',
  },
  photoCenterDivider: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#FFFFFF',
    zIndex: 5,
  },
  photoCenterDividerHorizontal: {
    position: 'absolute',
    top: '50%',
    marginTop: -1,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#FFFFFF',
    zIndex: 5,
  },
  photoOverlayBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    zIndex: 10,
  },
  // Used for the clock / "waiting for After" badge in upper-right
  // when a set has only its Before photo (no second photo yet).
  photoOverlayBadgeTopRight: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  // Used for the green completion checkmark in lower-left once a
  // set has both Before + After (with or without combined). Sits in
  // the opposite corner from the yellow progress-count badge so the
  // two read together without overlapping.
  photoOverlayBadgeBottomLeft: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    zIndex: 10,
  },
  checkmarkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clockBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.textInverse,
    color: theme.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
  },
  // Eye / preview icon sits at the top-LEFT of the photo card. Tapping opens
  // the full-screen preview viewer (same as a double-tap on the card body —
  // exists as a discoverable UI affordance).
  previewIconBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 2,
    zIndex: 11,
  },
  // Yellow progress-count badge sits at the top-right of the photo card so it
  // doesn't collide with the existing checkmark (bottom-right) or the retake
  // button (bottom-left). Tappable: opens SectionDetail on the Progress tab.
  progressCountBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 36,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#F2C31B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
    zIndex: 11,
  },
  progressCountBadgeText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  thumbnailButtonsOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    alignItems: 'center',
    zIndex: 10,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
    gap: 3,
    // Same width as takeAfterButton so the two pills line up
    // visually across cards (Take Next vs Update After).
    minWidth: 140,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  retakeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  takeAfterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 20,
    gap: 4,
    // Matches retakeButton.minWidth so both pills look identical
    // across cards.
    minWidth: 140,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  takeAfterButtonText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },
  addPhotoItemCenter: {
    width: 200,
    height: 200,
    borderRadius: 20,
    backgroundColor: theme.surfaceElevated,
    borderWidth: 2,
    borderColor: theme.borderStrong,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  addPhotoTextCenter: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 12,
  },
  uploadPhotosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(242, 195, 27, 0.3)',
    backgroundColor: 'rgba(242, 195, 27, 0.08)',
  },
  uploadPhotosText: {
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 40,
  },
  splitPreview: {
    width: '100%',
    height: '100%',
  },
  stackedPreview: {
    flexDirection: 'column',
  },
  sideBySidePreview: {
    flexDirection: 'row',
  },
  halfPreviewImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  // Simple preview (eye-icon → quick look). Theme-aware container, top
  // bar with Back + Share/Edit/Delete cluster, image fills the body.
  simplePreviewContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  simplePreviewTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  simplePreviewTopBarRight: {
    flexDirection: 'row',
    gap: 8,
  },
  simplePreviewCtrlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 3,
  },
  // Trash icon overlaid on the top-right corner of each photo in the
  // preview pager. Per-photo so it always targets the currently-shown
  // page, not the whole set.
  simplePreviewPhotoTrash: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    // Above PhotoWatermark (zIndex 100) so its built-in URL link
    // doesn't intercept taps meant for these buttons.
    zIndex: 200,
  },
  // Bottom-right share button on each pager card. Same chrome as the
  // top-right trash so the two icons read as a consistent pair.
  simplePreviewPhotoShare: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    // Above PhotoWatermark (zIndex 100) so its built-in URL link
    // doesn't intercept taps meant for these buttons.
    zIndex: 200,
  },
  // Project name + capture date sit between the top control bar and
  // the photo pager. Compact two-line row so the photo still has room.
  simplePreviewInfoRow: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    alignItems: 'center',
  },
  // Three-column row that mirrors the project detail screen's sets
  // bar: previous set on the left, position pill in the center,
  // next set on the right. Without `flexDirection: 'row'` the three
  // children stack vertically and the "next set" label collapses to
  // the left under the position pill.
  simplePreviewSetsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  simplePreviewSetsBarSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 80,
  },
  simplePreviewSetsBarSideRight: {
    justifyContent: 'flex-end',
  },
  simplePreviewSetsBarText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  simplePreviewSetsBarCenter: {
    flex: 1,
    alignItems: 'center',
  },
  simplePreviewPositionPill: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 14,
  },
  simplePreviewPositionText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
  },
  // New fullscreen-viewer header (replaces simplePreviewSetsBar). Three
  // slots: circular X close on the left, photo position centre, and the
  // tap-to-jump "Set N+1 ›" on the right.
  simplePreviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  simplePreviewHeaderClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simplePreviewHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 12,
  },
  simplePreviewHeaderPosition: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  simplePreviewHeaderSetJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingLeft: 6,
    minWidth: 64,
    justifyContent: 'flex-end',
  },
  simplePreviewHeaderSetJumpText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  // Horizontal scroll of set thumbnails — sits above the project name
  // / date row so the user can jump between sets without leaving the
  // preview. Mirrors the room tabs row on the project detail screen.
  simplePreviewSetTabsRow: {
    paddingVertical: 6,
  },
  simplePreviewSetTabsContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  simplePreviewSetTab: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simplePreviewSetTabThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  simplePreviewSetTabLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  simplePreviewProjectName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  simplePreviewPhotoDate: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  simplePreviewBody: {
    flex: 1,
  },
  simplePreviewImage: {
    width: '100%',
    height: '100%',
  },
  simplePreviewThumbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingBottom: 8,
  },
  simplePreviewSwipeHint: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  // Top-LEFT pencil icon — opens StudioDetail for the current photo.
  // Same chrome as the bottom-right share button so the pair reads as
  // a consistent set of per-photo actions.
  simplePreviewPhotoEdit: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    // Above PhotoWatermark (zIndex 100) so its built-in URL link
    // doesn't intercept taps meant for these buttons.
    zIndex: 200,
  },
  // Bottom-LEFT pill that hosts the "Edited" preview toggle. Wider
  // than the round action buttons because it carries a label, but
  // sized so it doesn't reach the share button on the right.
  simplePreviewEditedToggle: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    height: 36,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
    // Above PhotoWatermark (zIndex 100) so its built-in URL link
    // doesn't intercept taps meant for these buttons.
    zIndex: 200,
  },
  simplePreviewEditedToggleLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  simplePreviewEditedSwitch: {
    transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
  },
  // Action rows that sit ABOVE and BELOW the preview photo. Inline
  // versions of the corner buttons (no absolute positioning) so the
  // photo can shrink to fit and the buttons no longer overlap the
  // image. Both rows have flex justify space-between with the photo's
  // width, so the buttons line up flush with the picture's edges.
  simplePreviewActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Round 40 px action button — same chrome as the old corner
  // overlays, just laid out inline now.
  simplePreviewActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },
  // Inline version of the Edited toggle pill (no absolute position).
  // Sits at the left of the bottom action row.
  simplePreviewEditedToggleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 6,
    height: 40,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 3,
  },
  // Right-hand cluster on the bottom action row — wraps the optional
  // notes glyph and the share button so they sit together at the right
  // edge without expanding the row's overall layout.
  simplePreviewActionRowEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Centered card backing the read-only notes viewer modal.
  notesViewerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  notesViewerCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  notesViewerCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
  },
  notesViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  notesViewerTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  notesViewerTag: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  notesViewerScroll: {
    maxHeight: 320,
  },
  notesViewerScrollContent: {
    paddingBottom: 4,
  },
  notesViewerText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    lineHeight: 22,
  },
  notesViewerClose: {
    marginTop: 16,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesViewerCloseText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
    color: theme.textPrimary,
  },
  // Fullscreen modal swipe-down close gesture target. Fills the
  // screen behind the framed photo; the PanResponder lives on this
  // wrapper. See the modal JSX above for the responder definition.
  tappedFullPhotoSwipeArea: {
    flex: 1,
  },
  // Big transient title flashed over the pager when the user moves
  // into a new set. Replaces the old "Previous / Next set" sentinel
  // cards. Fills the pager bounds so it sits centered over whichever
  // photo is on-screen, with a subtle dark scrim behind the text so
  // it stays legible regardless of underlying image brightness.
  setFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  setFlashText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 16,
    overflow: 'hidden',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  // Full-screen photo modal — tapping any photo in the preview pager
  // opens it edge-to-edge over a near-black backdrop. No overlays, no
  // chrome other than a single dismiss button (tap anywhere also closes).
  tappedFullPhotoBackdrop: {
    // Plain overlay (not Modal) — absolute-positioned full-screen so it
    // covers the screen above everything (including the persistent
    // bottom nav). zIndex 1000 matches the pattern GalleryScreen uses
    // for its fullscreen overlay.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  tappedFullPhotoImage: {
    width: '100%',
    height: '100%',
  },
  tappedFullPhotoClose: {
    position: 'absolute',
    // Top-LEFT so it doesn't collide with PannableImage's built-in
    // reset button (which sits at top-right of the framed image).
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  // New tap-to-fullscreen modal header (per design 17-fullscreen-
  // viewer): three slots laid out across the top — circular X close on
  // the left, photo position pill centre, and "Set N+1 ›" jump on the
  // right. Positioned absolute above the photo so the existing centred
  // layout of the framed image stays intact.
  tappedFullHeaderRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 8,
  },
  tappedFullHeaderClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  tappedFullHeaderCenter: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 12,
  },
  tappedFullHeaderPosition: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.2,
  },
  tappedFullHeaderSetJump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingLeft: 6,
    minWidth: 64,
    justifyContent: 'flex-end',
  },
  tappedFullHeaderSetJumpText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  // Left / right navigation chevrons sitting on top of the photo
  // frame. Outside the PannableImage transform too so they don't drift
  // when the user pans / zooms.
  tappedFullChev: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 6,
  },
  tappedFullChevLeft: { left: -18 },
  tappedFullChevRight: { right: -18 },
  // Carousel dots below the photo. Active dot grows wider in the
  // accent yellow; the rest stay round and translucent white.
  tappedFullDots: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    bottom: 24,
    zIndex: 7,
  },
  tappedFullDot: {
    height: 6,
    borderRadius: 3,
  },
  simplePreviewSwipeHintText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '600',
  },
  simplePreviewThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  simplePreviewThumbImage: {
    width: '100%',
    height: '100%',
  },
  simplePreviewThumbLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 56,
  },
  // Legacy full-screen preview styles — still used by GalleryScreen and
  // other places that import these names. Keep them intact even though
  // the HomeScreen preview no longer uses them.
  fullScreenPhotoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 1000
  },
  fullScreenPhoto: {
    width: '100%',
    height: '100%'
  },
  fullScreenSinglePreview: {
    aspectRatio: 1,
    width: '100%',
    maxWidth: 400,
    maxHeight: 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    position: 'relative'
  },
  fullScreenLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 10
  },
  fullScreenErrorOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    zIndex: 10,
    padding: 20
  },
  fullScreenErrorText: {
    color: '#fff',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center'
  },
  fullScreenHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 12,
    zIndex: 1002
  },
  fullScreenLabelsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  fullScreenLabelsText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  fullScreenCustomizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: 'grey',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 15
  },
  fullScreenCustomizeText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600'
  },
  fullScreenCloseButton: {
    width: 27,
    height: 27,
    borderRadius: 15,
    backgroundColor: 'rgba(99, 3, 3, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'grey',
    zIndex: 1002
  },
  pairTemplateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pairTemplateChipActive: {
    backgroundColor: '#F2C31B',
    borderColor: '#F2C31B',
  },
  pairTemplateChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  pairTemplateChipTextActive: {
    color: '#000000',
  },
  // Small return arrow shown only when the preview is in bareMode (no
  // chrome, just the photo). Positioned top-left, semi-transparent so it
  // doesn't pull focus from the photo.
  bareReturnButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1003,
  },
  // Top-right delete button in the full-screen preview header. Replaces the
  // former red close-X. Same dimensions as the bottom share/return circles so
  // the row reads as a deliberate destructive action, not a chrome control.
  fullScreenHeaderDeleteButton: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1002
  },
  // Bottom-left return button in the full-screen preview. Pair with
  // fullScreenShareCircle on the right. Light fill keeps the back affordance
  // distinct from the destructive top-right delete.
  fullScreenReturnCircle: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreenMetaLine: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  fullScreenPhotoArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20
  },
  fullScreenCombinedPreview: {
    aspectRatio: 1,
    width: '100%',
    maxWidth: 400,
    maxHeight: 400,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
    position: 'relative',
    flexDirection: 'column' // Default to stacked, will be overridden by fullScreenStacked/SideBySide
  },
  fullScreenStacked: {
    flexDirection: 'column'
  },
  fullScreenSideBySide: {
    flexDirection: 'row'
  },
  fullScreenHalf: {
    flex: 1,
    position: 'relative'
  },
  fullScreenHalfImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenCenterDivider: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -1,
    backgroundColor: COLORS.PRIMARY,
    zIndex: 5
  },
  fullScreenCenterDividerHorizontal: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    marginTop: -1,
    backgroundColor: COLORS.PRIMARY,
    zIndex: 5
  },
  fullScreenRoomNameRow: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    zIndex: 1001
  },
  fullScreenRoomName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8
  },
  fullScreenPaginationDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  fullScreenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.35)'
  },
  fullScreenDotActive: {
    backgroundColor: '#FFFFFF'
  },
  fullScreenBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingBottom:20,
    paddingTop: 16,
    zIndex: 1002
  },
  fullScreenDeleteCircle: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'grey',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fullScreenShareCircle: {
    width: 35,
    height: 35,
    borderRadius: 17,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center'
  },
  fullScreenNavigation: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 1001
  },
  fullScreenCounter: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  fullScreenDeleteButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
    padding: 10,
    zIndex: 1002
  },
  fullScreenBottomButtons: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    gap: 12,
    zIndex: 1002
  },
  fullScreenActionButton: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenActionButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700'
  },
  fullScreenShareButton: {
    flex: 1,
    backgroundColor: '#0077CC',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenShareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  fullScreenRetakeButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5
  },
  fullScreenRetakeButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 16,
    fontWeight: '700'
  },
  optionsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  optionsModalContent: {
    backgroundColor: theme.surfaceElevated,
    borderRadius: 16,
    padding: 20,
    width: '86%',
    maxWidth: 380,
    maxHeight: '85%'
  },
  optionsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.textPrimary,
    marginBottom: 16,
    textAlign: 'center'
  },
  projectList: {
    maxHeight: 280
  },
  projectItem: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    marginBottom: 10
  },
  projectItemContent: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surfaceElevated,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  checkboxSelected: {
    borderColor: '#FF0000',
    backgroundColor: '#FFE6E6'
  },
  checkmark: {
    color: '#FF0000',
    fontSize: 14,
    fontWeight: 'bold'
  },
  projectItemText: {
    color: theme.textPrimary,
    fontSize: 15,
    fontWeight: '500'
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600'
  },
  actionPrimary: {
    backgroundColor: COLORS.PRIMARY
  },
  contextMenuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  contextMenu: {
    position: 'absolute',
    backgroundColor: theme.surfaceElevated,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  contextMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  contextMenuItemDanger: {
    backgroundColor: 'rgba(255, 0, 0, 0.05)',
  },
  contextMenuIcon: {
    fontSize: 18,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
  },
  contextMenuText: {
    fontSize: 16,
    color: theme.textPrimary,
    fontWeight: '500',
  },
  contextMenuTextDanger: {
    color: '#FF4444',
  },
  planModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#F2C31B',
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  planModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  planModalScrollView: {
    flex: 1,
  },
  planModalContent: {
    padding: 16,
    paddingBottom: 20,
  },
  planContainer: {
    marginBottom: 20
  },
  planButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    alignItems: 'center'
  },
  planButtonSelected: {
    backgroundColor: COLORS.PRIMARY,
  },
  planButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.PRIMARY
  },
  planButtonTextSelected: {
    color: '#000000'
  },
  planSubtext: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 10
  },
  // New card-style plan modal styles
  planModalContainer: {
    flex: 1,
    backgroundColor: '#F2C31B',
  },
  planModalBody: {
    flex: 1,
    position: 'relative',
  },
  planModalBackButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  planCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  planCardRecommended: {
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  planCardSelected: {
    borderWidth: 2.5,
    borderColor: COLORS.PRIMARY,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  planCardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.5,
  },
  planBadgeFree: {
    backgroundColor: '#81C784',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#81C784',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  planBadgePrice: {
    backgroundColor: '#81C784',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#81C784',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  planBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  planBadgeTrialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planBadgeStrikethrough: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999999',
    textDecorationLine: 'line-through',
  },
  planCardDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 22,
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  trialSubtext: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666666',
    marginBottom: 4,
  },
  currentPlanButton: {
    backgroundColor: COLORS.PRIMARY,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
    marginTop: 4,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  currentPlanButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  recommendedBadge: {
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  recommendedBadgeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  getMoreButton: {
    backgroundColor: '#000000',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  getMoreButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});


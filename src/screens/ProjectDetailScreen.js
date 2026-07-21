import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Modal,
  Alert,
  TextInput,
  Switch,
  ActivityIndicator,
  Platform,
  Linking,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
// expo-print is intentionally NOT imported. Its top-level
// requireNativeModule('ExpoPrint') call routes errors through Hermes'
// global handler — even a lazy `require()` inside try/catch produces a
// FATAL uncaught error on builds that don't yet have the native side
// linked (TestFlight build 76 and earlier). Reports are HTML-only
// here; PDF generation will land alongside the next native build.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readSecure, writeSecure, deleteSecure } from '../services/secureStorageService';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Share as RNShareDialog } from 'react-native';
import Constants from 'expo-constants';
import JSZip from 'jszip';
import { usePhotos } from '../context/PhotoContext';
import { useAdmin } from '../context/AdminContext';
import { useFeaturePermissions } from '../hooks/useFeaturePermissions';
import { FEATURES } from '../constants/featurePermissions';
import { PAYWALL_TRIGGERS } from '../constants/softTrial';
import { PHOTO_MODES, COLORS } from '../constants/rooms';
import dropboxAuthService from '../services/dropboxAuthService';
import googleDriveService from '../services/googleDriveService';
import dropboxService from '../services/dropboxService';
import iCloudService from '../services/iCloudService';
import { ensureLabelForPhoto } from '../services/uploadService';
import crmService from '../services/crm';
import chromeBakeService from '../services/chromeBakeService';
import { ensureShareAllowed, recordShare } from '../utils/shareRateLimit';
import { maybeShowFirstReportReferralPrompt } from '../services/referralPromptService';

// react-native-share for multi-file sharing (not available in Expo Go)
let __RNShare = { open: async () => {} };
const __isExpoGo = Constants?.appOwnership === 'expo';
if (!__isExpoGo) {
  try {
    const shareModule = require('react-native-share');
    __RNShare = shareModule.default || shareModule;
  } catch (e) {
    console.warn('[ProjectDetail] react-native-share not available:', e?.message);
  }
}

const __ensureFileUri = (uri) => uri.startsWith('file://') ? uri : `file://${uri}`;
import {
  generateReport,
  getLayout,
  resolveOptions,
  OPTION_META,
  DEFAULT_LAYOUT_ID,
} from '../reports';
import { consumePendingLayoutSelection } from '../reports/pickerBridge';
import ReportPreviewView from '../components/ReportPreview';
import {
  listReportTemplates,
  saveReportTemplate,
  deleteReportTemplate,
} from '../services/reportTemplateService';

// Group keys for the report editor sheet. Section "Report" carries
// the knobs that change WHAT lands in the report (branding, location
// map, notes, progress photos). Section "Layout" carries layout-
// specific presentation knobs (grid columns, the overlays master
// toggle, docu-specific switches). Anything in supportedOptions that
// isn't in either list falls into "Layout" as a safety net.
const REPORT_OPTION_GROUPS = [
  {
    id: 'report',
    title: 'REPORT',
    keys: ['includeBranding', 'includeLocation', 'includeNotes', 'includeProgressPhotos', 'showLabels'],
  },
  {
    id: 'layout',
    title: 'LAYOUT',
    keys: ['showOverlays', 'galleryColumns', 'timelineColumns', 'docShowGps', 'docShowCaptureTime', 'docShowDeviceMetadata'],
  },
];

// Storage key for the report's selected photo ids — legacy, retained
// so the Default-settings reset can still wipe it cleanly when an
// older version's single-selection lingers. New writes go to the
// `reports` list below.
const reportSelectionKey = (projectId) => `project:${projectId}:reportPhotoIds`;

// Storage key for the project's reports list. Each report is a saved
// configuration the user can re-open, update, or generate later:
//   { id, title, photoIds, photoCount, layoutType, options,
//     createdAt, updatedAt, generatedFilePath?, generatedPdfPath?,
//     generatedAt? }
// Legacy records may carry `includeNotes`/`includeMap` instead of
// `options`; the editor seeder migrates them on first open.
// generatedFilePath + generatedAt are set after the user successfully
// builds + shares the report; subsequent shares reuse the file from
// disk without regenerating, until the user explicitly hits Regenerate.
const reportsKey = (projectId) => `project:${projectId}:reports`;
const newReportId = () => `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
// Persistent directory for generated report HTML files. Uses
// documentDirectory so the artifacts survive OS cache cleanups and
// app restarts. Created lazily on first generate.
const reportsDir = () => `${FileSystem.documentDirectory}reports/`;
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../hooks/useTheme';
import { FONTS } from '../constants/fonts';
import { computeSetIds } from '../utils/photoSets';

// Tabs source-of-truth. Labels are keys, not strings — the tab strip
// resolves them through t() at render so the whole bar switches language
// live without a remount.
const TABS = [
  { key: 'timeline', labelKey: 'projectDetail.tabPhotos' },
  { key: 'location', labelKey: 'projectDetail.tabLocations' },
  { key: 'report',   labelKey: 'projectDetail.tabReport' },
  { key: 'share',    labelKey: 'projectDetail.tabShare' },
];

// Date section headers respect the active i18n locale. We used to hard-
// code 'en-US' which surfaced "July 6, 2026" even when the UI was
// Russian; formatDateLabelI18n receives i18n.language from the caller.
const formatDateLabelI18n = (ts, locale) =>
  new Date(ts).toLocaleDateString(locale || 'en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Date-section view: each day surfaces every photo taken on that day
// as its own tile. Set membership is computed per (room, date) so each
// photo carries the set label it belongs to ("Set 1", "Set 2" …) —
// the user wanted the full photo stream, not a roll-up of sets. Tiles
// stay in capture order so the day reads chronologically left-to-right.
const tsOfPhoto = (photo) =>
  typeof photo?.timestamp === 'number'
    ? photo.timestamp
    : (photo?.createdAt ? new Date(photo.createdAt).getTime() : 0);

// One row per capture set, used by the Pick photos selection screen.
// Each row holds Before / Progress* / After / Combined in that order so
// the user can scan a set's thumbnails left-to-right and (optionally)
// tap the combined hero at the end. Combined photos are linked to
// their source set via the `combined_<beforeId>` id prefix, with
// `beforePhotoId` as a fallback. Sets are sorted chronologically by
// the earliest photo they contain so the list reads top-down in
// capture order.
const buildSetList = (photos) => {
  const setMap = new Map(); // setId → { id, room, before, progress[], after, combined, ts }
  const ensureSet = (setId, room) => {
    if (!setMap.has(setId)) {
      setMap.set(setId, {
        id: setId,
        room: room || 'Unsorted',
        before: null,
        after: null,
        progress: [],
        combined: null,
        ts: 0,
      });
    }
    return setMap.get(setId);
  };

  // Pass 1: Before / After / Progress
  for (const p of photos) {
    if (!p) continue;
    if (p.mode === 'mix' || p.mode === 'combined') continue;
    // Hide contamination-pattern URIs (same guard as buildTimeline).
    if (p.uri && /_COMBINED_(?:BASE|EDIT)_(?:SIDE|STACK)_/i.test(p.uri)) continue;
    const setId = p.mode === 'before'
      ? String(p.id)
      : (p.beforePhotoId ? String(p.beforePhotoId) : String(p.id));
    const s = ensureSet(setId, p.room);
    const t = tsOfPhoto(p);
    if (t > s.ts) s.ts = t;
    if (p.mode === 'before') s.before = p;
    else if (p.mode === 'after') s.after = p;
    else if (p.mode === 'progress') s.progress.push(p);
  }

  // Pass 2: Combined photos — link to source set by id prefix.
  for (const p of photos) {
    if (!p) continue;
    if (p.mode !== 'mix' && p.mode !== 'combined') continue;
    const idStr = String(p.id || '');
    const setId = idStr.startsWith('combined_')
      ? idStr.slice('combined_'.length)
      : (p.beforePhotoId ? String(p.beforePhotoId) : idStr);
    const s = ensureSet(setId, p.room);
    const t = tsOfPhoto(p);
    if (t > s.ts) s.ts = t;
    s.combined = p;
  }

  const sets = Array.from(setMap.values());
  for (const s of sets) {
    s.progress.sort((a, b) => tsOfPhoto(a) - tsOfPhoto(b));
  }
  sets.sort((a, b) => a.ts - b.ts);
  return sets;
};

const buildTimeline = (photos) => {
  const byDate = new Map();
  for (const photo of photos) {
    // Combined photos are derived from a Before / After pair — they're
    // a Studio-tab concept, not a Timeline one. Timeline should only
    // surface the original capture records (Before / After / Progress)
    // so the user isn't staring at the same content twice.
    if (photo?.mode === 'mix' || photo?.mode === 'combined') continue;
    // Defensive: a non-combined record whose `uri` filename is still a
    // side-by-side composite means the pre-fix picker overwrote it
    // and the auto-repair couldn't recover the original (see
    // repairCorruptedPhotoUris in storage.js). Hide it from Timeline
    // so the user isn't staring at a fake combined tile — the record
    // stays in storage so future repair runs can still rescue it.
    if (photo?.uri && /_COMBINED_(?:BASE|EDIT)_(?:SIDE|STACK)_/i.test(photo.uri)) continue;
    const ts = tsOfPhoto(photo);
    if (!ts) continue;
    const dateKey = new Date(ts).toLocaleDateString('en-CA');
    if (!byDate.has(dateKey)) byDate.set(dateKey, { ts, byRoom: new Map() });
    const dateEntry = byDate.get(dateKey);
    if (ts > dateEntry.ts) dateEntry.ts = ts;
    const roomKey = photo.room || 'Unsorted';
    if (!dateEntry.byRoom.has(roomKey)) {
      dateEntry.byRoom.set(roomKey, { name: roomKey, photos: [], firstTs: ts });
    }
    const bucket = dateEntry.byRoom.get(roomKey);
    bucket.photos.push(photo);
    if (ts < bucket.firstTs) bucket.firstTs = ts;
  }
  return Array.from(byDate.entries())
    .map(([dateKey, { ts, byRoom }]) => {
      // For every (room, date) bucket: compute set ids, attach a
      // setIndex + setAnchor to each photo tile, and keep the tiles
      // grouped by room so the timeline can render one room-section
      // per room within the date (vertical stack of rooms inside the
      // date header).
      const rooms = [];
      for (const r of byRoom.values()) {
        const setIdOf = computeSetIds(r.photos);
        const setIndexBySetId = new Map();
        const earliestBySetId = new Map();
        for (const p of r.photos) {
          const sid = setIdOf.get(p.id) || p.id;
          const t = tsOfPhoto(p);
          if (!earliestBySetId.has(sid) || t < earliestBySetId.get(sid)) {
            earliestBySetId.set(sid, t);
          }
        }
        Array.from(earliestBySetId.entries())
          .sort((a, b) => a[1] - b[1])
          .forEach(([sid], i) => {
            setIndexBySetId.set(sid, i + 1);
          });
        const sortedRoom = [...r.photos].sort((a, b) => tsOfPhoto(a) - tsOfPhoto(b));
        const anchorBySetId = new Map();
        for (const p of sortedRoom) {
          const sid = setIdOf.get(p.id) || p.id;
          if (!anchorBySetId.has(sid)) {
            const beforeOfSet = sortedRoom.find(
              (pp) => (setIdOf.get(pp.id) || pp.id) === sid && pp.mode === 'before',
            );
            anchorBySetId.set(sid, beforeOfSet?.id || p.id);
          }
        }
        const photoTiles = sortedRoom.map((p) => {
          const sid = setIdOf.get(p.id) || p.id;
          return {
            id: p.id,
            uri: p.uri,
            ts: tsOfPhoto(p),
            roomName: r.name,
            setIndex: setIndexBySetId.get(sid) || 1,
            anchorPhotoId: anchorBySetId.get(sid) || sid,
          };
        });
        rooms.push({
          name: r.name,
          firstTs: r.firstTs,
          setCount: earliestBySetId.size,
          photoCount: r.photos.length,
          photoTiles,
        });
      }
      // Rooms render in capture order (earliest session first) so
      // the day reads chronologically top-to-bottom.
      rooms.sort((a, b) => a.firstTs - b.firstTs);
      const totalPhotos = rooms.reduce((acc, rr) => acc + rr.photoCount, 0);
      return { dateKey, ts, rooms, totalPhotos };
    })
    .sort((a, b) => b.ts - a.ts);
};

export default function ProjectDetailScreen({ route, navigation }) {
  const { t, i18n } = useTranslation();
  // Local alias so we can pass the active locale to Intl-based date
  // formatters (Timeline day headers, "Most recent: …" prefix). Falls
  // back to en-US when i18n is still initialising.
  const dateLocale = i18n?.language || 'en-US';
  const formatDateLabel = (ts) => formatDateLabelI18n(ts, dateLocale);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { projects, getPhotosByProject, deleteProject, activeProjectId, setActiveProject, updatePhoto, patchProject, photos: allPhotos, clearPhotoOverrides, deletePhoto } = usePhotos();
  const { isAuthenticated, connectedAccounts, accountType, folderId: adminFolderId, saveFolderId } = useAdmin();
  const { effectivePlan, canUse } = useFeaturePermissions();
  const {
    getRooms,
    showLabels,
    toggleLabels,
    updateShowWatermark,
    togglePreviewMetadata,
    updateShowBrandLogo,
    brandLogoUri,
    reportBrandLogoUri,
    reportCompanyName,
    reportBrandColor,
    showWatermark,
    watermarkText,
    customWatermarkEnabled,
    location,
    labelBackgroundColor,
    labelTextColor,
    labelMarginHorizontal,
    labelMarginVertical,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelOffset,
    afterLabelOffset,
    singleLabelPosition,
    singleLabelOffset,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    singleLabelPositionLandscape,
    singleLabelOffsetLandscape,
    // Watermark fields — full set so the report can honor the user's
    // configured position, color, opacity, and font.
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkOffset,
    watermarkFontFamily,
    // Metadata overlay fields — date / time / address / GPS string
    // positioned per the user's preference. Mirrors what
    // StudioOverlays.MetadataOverlay renders in-app.
    showPreviewMetadata,
    metaShowDate,
    metaShowTime,
    metaShowAddress,
    metaShowGps,
    metaPosition,
    metaColor,
    metaOpacity,
    metaFontSize,
    metaFontFamily,
    metaOffset,
    // Photo brand logo — independent of the report header logo
    // (reportBrandLogoUri). This one gets overlaid on every photo per
    // the user's PositionGrid + size in Logo Customization.
    showBrandLogo,
    brandLogoPosition,
    brandLogoOffset,
    brandLogoSize,
  } = useSettings();

  // Label settings — passed via `branding.labelSettings`. Includes
  // margin so the chip's inset distance honors the user's setting.
  const reportLabelSettings = useMemo(() => ({
    showLabels,
    labelBackgroundColor,
    labelTextColor,
    labelMarginHorizontal,
    labelMarginVertical,
    beforeLabelPosition,
    afterLabelPosition,
    singleLabelPosition,
    beforeLabelOffset,
    afterLabelOffset,
    singleLabelOffset,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    singleLabelPositionLandscape,
    beforeLabelOffsetLandscape,
    afterLabelOffsetLandscape,
    singleLabelOffsetLandscape,
  }), [
    showLabels, labelBackgroundColor, labelTextColor,
    labelMarginHorizontal, labelMarginVertical,
    beforeLabelPosition, afterLabelPosition, singleLabelPosition,
    beforeLabelOffset, afterLabelOffset, singleLabelOffset,
    beforeLabelPositionLandscape, afterLabelPositionLandscape, singleLabelPositionLandscape,
    beforeLabelOffsetLandscape, afterLabelOffsetLandscape, singleLabelOffsetLandscape,
  ]);

  // Watermark settings — passed via `branding.watermarkSettings`.
  // Layouts gate on options.includeWatermark AND watermarkSettings.showWatermark.
  const reportWatermarkSettings = useMemo(() => ({
    showWatermark,
    customWatermarkEnabled,
    watermarkText,
    watermarkColor,
    watermarkOpacity,
    watermarkPosition,
    watermarkOffset,
    watermarkFontFamily,
  }), [
    showWatermark, customWatermarkEnabled, watermarkText,
    watermarkColor, watermarkOpacity, watermarkPosition,
    watermarkOffset, watermarkFontFamily,
  ]);

  // Photo brand logo settings — passed via
  // `branding.brandLogoSettings`. The logo URI itself is read from
  // brandLogoUri (separate from reportBrandLogoUri — that one is the
  // report HEADER logo). Layouts encode the logo to a data URI once
  // and reuse across photos.
  const reportBrandLogoSettings = useMemo(() => ({
    showBrandLogo,
    brandLogoUri,
    brandLogoPosition,
    brandLogoOffset,
    brandLogoSize,
  }), [
    showBrandLogo, brandLogoUri, brandLogoPosition, brandLogoOffset, brandLogoSize,
  ]);

  // Metadata overlay settings — passed via `branding.metaSettings`.
  // Layouts gate on options.includeMetadata AND metaSettings.showPreviewMetadata.
  const reportMetaSettings = useMemo(() => ({
    showPreviewMetadata,
    metaShowDate,
    metaShowTime,
    metaShowAddress,
    metaShowGps,
    metaPosition,
    metaColor,
    metaOpacity,
    metaFontSize,
    metaFontFamily,
    metaOffset,
  }), [
    showPreviewMetadata, metaShowDate, metaShowTime, metaShowAddress, metaShowGps,
    metaPosition, metaColor, metaOpacity, metaFontSize, metaFontFamily, metaOffset,
  ]);

  const roomDataMap = useMemo(() => {
    const map = new Map();
    for (const room of (getRooms() || [])) {
      map.set(room.id, room);
    }
    return map;
  }, [getRooms]);

  const displayRoomName = (id) => roomDataMap.get(id)?.name || id;

  const projectId = route?.params?.projectId || activeProjectId;
  const project = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId]
  );

  const [activeTab, setActiveTab] = useState('timeline');
  // Sub-tab under the "Photos" top tab: 'timeline' = existing
  // date → room → grid view; 'gallery' = flat 4-col grid of every
  // photo in the project sorted newest first. Selection mode is
  // shared across both sub-tabs.
  const [photosSubTab, setPhotosSubTab] = useState('timeline');
  // Locations tab: 'project' shows only THIS project's locations,
  // 'all' aggregates every project the user has. Default is 'project'
  // so the tab still answers "where were this project's photos taken"
  // without surprise; user flips to 'all' for a portfolio-wide view.
  const [locationsScope, setLocationsScope] = useState('project');
  const [actionsVisible, setActionsVisible] = useState(false);

  // Share-tab state. Mirrors ProjectsScreen's share modal — kept here
  // because the Share tab is in-page (not a modal) and needs its own
  // local state. TODO: extract into a shared hook if any third surface
  // needs sharing.
  const [shareFormat, setShareFormat] = useState('files');
  const [shareLinkProvider, setShareLinkProvider] = useState(() =>
    !isAuthenticated && dropboxAuthService.isAuthenticated() ? 'dropbox' : 'google'
  );
  // Modal that opens after the user finishes picking photos via the
  // Timeline selection flow with selectionPurpose='share'. Picks
  // Files / ZIP / PDF / Link, optional Drive/Dropbox provider, fires.
  const [shareFormatModalVisible, setShareFormatModalVisible] = useState(false);
  // Filter at the top of the Share Photos sheet — 'all' includes
  // every project photo; 'combined' narrows to the merged before/after
  // (mode === 'mix') shots only. Changing it auto-updates the
  // pendingSharePhotoIds set so the count + share output stay in sync
  // unless the user has manually refined via "Pick photos".
  const [sharePhotosFilter, setSharePhotosFilter] = useState('all');
  // Flag set when the user opens PhotoDetail from the share sheet
  // via "Preview" — when ProjectDetail comes back into focus we
  // re-open the share sheet so the user lands where they left off.
  const [reopenShareModalOnFocus, setReopenShareModalOnFocus] = useState(false);
  // When ON, the share flow routes every selected photo through
  // chromeBakeService.bakeChrome to flatten the studio overlays
  // (label / watermark / brand logo / metadata / markup) into the
  // shared file. When OFF, the original camera files are shared.
  // Defaults ON so the shared photos look identical to what the
  // user just previewed.
  const [shareWithOverlays, setShareWithOverlays] = useState(true);
  const [pendingSharePhotoIds, setPendingSharePhotoIds] = useState([]);
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState('');

  // Report-share format modal. Mirrors the photos share modal but
  // operates on the generated report HTML file instead of a photo
  // selection — the user picks Files / ZIP / PDF / Link.
  const [reportShareModalVisible, setReportShareModalVisible] = useState(false);
  const [reportShareTargetId, setReportShareTargetId] = useState(null);
  const [reportShareFormat, setReportShareFormat] = useState('files');

  // PDF: lazy-require expo-print so older binaries (build 76 etc.)
  // can still load this JS bundle without crashing. See note at the
  // top of this file about why the top-level import is intentionally
  // omitted.
  const sharePhotosAsPdf = async (urls, sharePhotos) => {
    if (!urls.length) {
      Alert.alert('No Photos', 'Nothing to put in the report.');
      return;
    }
    let Print;
    try { Print = require('expo-print'); }
    catch {
      Alert.alert(
        'PDF not supported in this build',
        'Update to the latest TestFlight build to share as PDF. Try Files, ZIP, or Link in the meantime.',
      );
      return;
    }
    setShareStatus('Preparing PDF...');
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
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      photoBlocks.push(`
        <div class="photo">
          <img src="data:image/jpeg;base64,${b64}" />
          <div class="caption">${modeLabel(meta.mode) || ''}</div>
        </div>
      `);
    }
    const safeName = (project?.name || 'Project').replace(/[<>&]/g, '');
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
               center its image. Without page-break-after here the
               first photo would sit beneath the header and lose
               its vertical centering. */
            .header { border-bottom: 2px solid #F2C31B; padding: 32px; margin: 0; page-break-after: always; }
            .title { font-size: 24px; font-weight: 700; margin: 0 0 4px 0; }
            .meta { font-size: 12px; color: #666; margin: 0; }
            /* Full-page centered photo block: 100vh container with
               flex centering puts the image dead-center vertically
               on its own page. page-break-after on every block
               except the last keeps each photo on its own sheet. */
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
    try { await FileSystem.copyAsync({ from: pdfUri, to: targetUri }); } catch {}
    const finalUri = (await FileSystem.getInfoAsync(targetUri)).exists ? targetUri : pdfUri;
    await Sharing.shareAsync(__ensureFileUri(finalUri), {
      mimeType: 'application/pdf',
      dialogTitle: friendlyName,
      UTI: 'com.adobe.pdf',
    });
    await recordShare();
    try { await FileSystem.deleteAsync(finalUri, { idempotent: true }); } catch {}
  };

  const sharePhotosAsLink = async (urls) => {
    const provider = shareLinkProvider;
    const isAppleConnected = !!(connectedAccounts || []).find(
      a => a.accountType === 'apple' && a.isActive
    );
    if (provider === 'google' && !isAuthenticated) {
      Alert.alert('Google Drive not connected', 'Connect Google Drive in Settings to share a link.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
      ]);
      return;
    }
    if (provider === 'dropbox' && !dropboxAuthService.isAuthenticated()) {
      Alert.alert('Dropbox not connected', 'Connect Dropbox in Settings to share a link.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
      ]);
      return;
    }
    if (provider === 'apple' && !isAppleConnected) {
      Alert.alert('iCloud Drive not connected', 'Turn on iCloud Drive sync for ProofPix in Settings to use this option.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go to Settings', onPress: () => navigation.navigate('Settings', { scrollToCloudSync: true }) },
      ]);
      return;
    }
    const providerLabel = provider === 'google' ? 'Google Drive' : provider === 'dropbox' ? 'Dropbox' : 'iCloud Drive';
    const safeName = (project?.name || 'ProofPix Project').replace(/[\\/:*?"<>|]/g, '_');
    setShareStatus(`Uploading to ${providerLabel}...`);
    let shareUrl = '';
    if (provider === 'apple') {
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
          console.warn('[ProjectDetail] iCloud copy failed for', filename, e?.message);
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
            onPress: () => { try { Linking.openURL('shareddocuments://'); } catch {} },
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
    if (!shareUrl) throw new Error('No share URL returned by provider.');
    try {
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(shareUrl);
    } catch {}
    await RNShareDialog.share({ title: safeName, message: `${safeName}\n${shareUrl}` });
    await recordShare();
    Alert.alert('Link ready', 'The share link was also copied to your clipboard.');
  };

  // Entrypoint #1 — "Share Project Photos" card on the Share tab.
  // Switches to Timeline with selectionPurpose='share'. The user
  // picks photos via the existing gallery selection UI; when they
  // tap the bottom "Share Selected" bar, we open the format modal.
  // Build the photo-id list that matches the active filter. 'all'
  // is every project photo; 'combined' narrows to merged before/after
  // shots (PHOTO_MODES.COMBINED === 'mix'). Used on flow entry and
  // every time the user flips the filter pill in the share sheet.
  const photoIdsForShareFilter = (filter) => {
    const pool = projectPhotos || [];
    const filtered = filter === 'combined'
      ? pool.filter((p) => p.mode === PHOTO_MODES.COMBINED)
      : pool;
    return filtered.map((p) => p.id);
  };

  const handleStartSharePhotosFlow = () => {
    if ((projectPhotos?.length || 0) === 0) {
      Alert.alert('No photos', 'This project has no photos yet.');
      return;
    }
    // Open the share format sheet directly with all photos
    // pre-selected. The sheet now carries the filter pill (All /
    // Combined) and a "Pick photos →" link that drops into the same
    // timeline selection flow Reports uses — so the user can either
    // share the whole filtered set in one tap, or narrow it manually.
    setSharePhotosFilter('all');
    setPendingSharePhotoIds(photoIdsForShareFilter('all'));
    setActiveTab('share');
    setShareFormatModalVisible(true);
  };

  // "Open Google Drive Folder" — one-tap jump to this project's album
  // folder in Drive. First call resolves + creates the album via the
  // existing findOrCreateAlbumFolder chain, caches the folder ID on the
  // project record (`driveFolderId`), and opens the folder URL.
  // Subsequent calls short-circuit straight to Linking.openURL, no
  // Drive API round-trip. Gated on Google admins — Dropbox/Apple use
  // different providers and this shortcut wouldn't apply there.
  const [driveOpening, setDriveOpening] = useState(false);
  const canOpenDriveFolder = accountType === 'google' && isAuthenticated;
  const handleOpenProjectDriveFolder = async () => {
    if (driveOpening) return;
    if (!canOpenDriveFolder) {
      Alert.alert(
        t('projectDetail.openDriveFolderNoGoogleTitle', { defaultValue: 'Google Drive not connected' }),
        t('projectDetail.openDriveFolderNoGoogleMessage', {
          defaultValue: 'Sign in to Google in Settings → Cloud sync to open this project on Drive.',
        }),
      );
      return;
    }
    const openUrl = async (id) => {
      const url = `https://drive.google.com/drive/folders/${id}`;
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('cannot-open');
      await Linking.openURL(url);
    };
    // Fast path — folder ID already cached on the project record.
    if (project?.driveFolderId) {
      try {
        await openUrl(project.driveFolderId);
        return;
      } catch {
        // fall through to re-resolve if the cached ID is stale (folder
        // was moved to trash, admin re-signed with a different account,
        // etc.)
      }
    }
    setDriveOpening(true);
    try {
      let rootId = adminFolderId;
      if (!rootId) {
        rootId = await googleDriveService.findOrCreateProofPixFolder();
        if (rootId && saveFolderId) {
          try { await saveFolderId(rootId); } catch {}
        }
      }
      if (!rootId) throw new Error('no-root');
      const safeName = (project?.name || 'ProofPix Project').replace(/[\\/:*?"<>|]/g, '_');
      const albumId = await googleDriveService.findOrCreateAlbumFolder(rootId, safeName);
      if (!albumId) throw new Error('no-album');
      if (project?.id && patchProject) {
        try { await patchProject(project.id, { driveFolderId: albumId }); } catch {}
      }
      await openUrl(albumId);
    } catch (e) {
      // console.error routes through FixPrompt → Loki (console.warn does
      // not), so failed opens actually show up in {service_name="proofpix-native"}.
      console.error('[ProjectDetail] open drive folder failed:', e?.message, e?.stack);
      const reason = e?.message || 'unknown';
      // Map internal throw codes to human-readable copy; unknown errors
      // fall through to the raw message so the user has enough context
      // to describe the problem (previously they only saw "Could not
      // open the Drive folder." with no reason).
      const detail = reason === 'no-root'
        ? 'ProofPix folder not found on Drive and could not be created.'
        : reason === 'no-album'
        ? 'Project folder not found on Drive and could not be created.'
        : reason === 'cannot-open'
        ? 'The Google Drive app or web link could not be opened on this device.'
        : reason;
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        `${t('projectDetail.openDriveFolderError', { defaultValue: 'Could not open the Drive folder.' })}\n\n${detail}`,
      );
    } finally {
      setDriveOpening(false);
    }
  };

  // CRM bulk upload: explicit, user-triggered. Sends every photo in
  // the current project to the linked CRM job. Bypasses any cloud
  // upload chain — straight from photo metadata to crmService.
  // Sequential to avoid hammering the server; SF backend dedups on
  // proofpix_photo_id within 24h so re-runs are safe no-ops.
  const [crmBulkUploading, setCrmBulkUploading] = useState(false);
  const handleUploadProjectToCrm = async () => {
    if (crmBulkUploading) return;
    if (!project?.crmJobId || !project?.crmProvider) {
      Alert.alert('Not linked', 'This project is not linked to a CRM job.');
      return;
    }
    if ((projectPhotos?.length || 0) === 0) {
      Alert.alert('No photos', 'This project has no photos yet.');
      return;
    }
    setCrmBulkUploading(true);
    let ok = 0, dedup = 0, failed = 0;
    const failures = [];
    const uriKind = (u) => {
      if (!u) return 'none';
      if (typeof u !== 'string') return `non-string(${typeof u})`;
      if (u.startsWith('file://')) return 'file';
      if (u.startsWith('ph://')) return 'ph';
      if (u.startsWith('assets-library://')) return 'assets-library';
      if (u.startsWith('http')) return 'http';
      return `other(${u.slice(0, 12)}...)`;
    };
    try {
      for (const p of projectPhotos) {
        const localUri = p?.cachedLocalUri || p?.uri;
        const idMissing = p?.id == null;
        const kind = uriKind(localUri);
        // Per-photo diagnostic — printed to [CRM] tag, ends up in
        // local error log export so we can see exactly which field
        // is empty when the adapter returns INVALID_PAYLOAD.
        console.warn('[CRM] bulk attempt', {
          name: p?.name,
          photoId: p?.id,
          id_missing: idMissing,
          uri_kind: kind,
          has_cached: !!p?.cachedLocalUri,
          has_uri: !!p?.uri,
          uri_sample: typeof localUri === 'string' ? localUri.slice(0, 60) : null,
          jobId: String(project.crmJobId),
        });
        if (!localUri || idMissing) {
          failed += 1;
          failures.push(`${p?.name || p?.id || 'unknown'}: ${idMissing ? 'no id' : 'no uri'} (kind=${kind})`);
          continue;
        }
        try {
          const result = await crmService.attachPhoto(String(project.crmJobId), {
            id: p.id,
            localUri,
            filename: p.name || `${p.id}.jpg`,
            mimeType: 'image/jpeg',
            mode: p.mode,
            room: p.room,
            timestamp: p.timestamp,
            gps: p.gps,
            capturedBy: p.capturedBy,
            notes: p.notes,
            projectId: p.projectId,
          });
          console.warn('[CRM] bulk result', { photoId: p.id, ok: !!result?.success, code: result?.error || null, dedup: !!result?.alreadyExisted });
          if (result?.success) {
            if (result.alreadyExisted) dedup += 1; else ok += 1;
          } else {
            failed += 1;
            failures.push(`${p?.name || p?.id}: ${result?.error || 'unknown'} (kind=${kind})`);
          }
        } catch (e) {
          console.warn('[CRM] bulk threw', { photoId: p.id, msg: e?.message });
          failed += 1;
          failures.push(`${p?.name || p?.id}: ${e?.message || 'threw'} (kind=${kind})`);
        }
      }
      const summary = `New: ${ok}\nAlready on job: ${dedup}\nFailed: ${failed}`;
      const detail = failed > 0 ? `\n\nFailures:\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? `\n…+${failures.length - 5} more` : ''}` : '';
      Alert.alert(`Uploaded to Service Flow`, summary + detail);
    } finally {
      setCrmBulkUploading(false);
    }
  };

  // Filter pill handler in the share sheet. Applies the filter and
  // resets pendingSharePhotoIds to match — overrides any prior
  // manual "Pick photos" selection, which the user can redo from the
  // same sheet via the Pick photos link if needed.
  //
  // Starter is single-photo share only. Both pills ("All photos" /
  // "Only combined") would swap in every photo matching the filter, so
  // either tap by a starter fires the paywall — matches the gate on
  // Select all / Select date in the Timeline selection flow below.
  const applySharePhotosFilter = (filter) => {
    if (!canUse(FEATURES.MULTI_PHOTO_SHARE)) {
      showMultiSharePaywall();
      return;
    }
    setSharePhotosFilter(filter);
    setPendingSharePhotoIds(photoIdsForShareFilter(filter));
  };

  // "Pick photos →" link in the share sheet. Closes the sheet, drops
  // the user into the same timeline selection flow Reports uses, with
  // the currently pending share ids pre-selected so they can refine
  // by toggling individual photos. handleConfirmShareSelection then
  // re-opens the share sheet with the refined ids.
  const handlePickPhotosForShare = () => {
    setShareFormatModalVisible(false);
    setSelectionPurpose('share');
    setSelectionDraft(new Set(pendingSharePhotoIds));
    setSelectionMode(true);
    setActiveTab('timeline');
  };

  // "Preview →" link in the share sheet. Opens SharePreview (the
  // dedicated dark-backdrop viewer modeled on Home's enlarged photo
  // viewer) with the current pending set as the swipe pool. The
  // top-bar controls let the user X-close, edit the current photo in
  // Studio, deselect it from the share, and flip the Show overlays
  // toggle in-place. The bottom Share button triggers the share via
  // a callback so the existing pipeline runs. On close we reopen the
  // share sheet so the user lands where they left off.
  const handlePreviewShareSelection = () => {
    if (pendingSharePhotoIds.length === 0) return;
    const ids = new Set(pendingSharePhotoIds);
    const pool = (projectPhotos || []).filter((p) => ids.has(p.id));
    if (pool.length === 0) return;
    setShareFormatModalVisible(false);
    navigation.navigate('SharePreview', {
      photos: pool,
      initialPhotoId: pool[0]?.id,
      initialOverlaysOn: shareWithOverlays,
      initialSelectedIds: new Set(pendingSharePhotoIds),
      onOverlaysChange: (next) => setShareWithOverlays(next),
      // Toggle behavior — tap the circular checkbox to add or remove
      // this photo from the pending share set. The photo stays in
      // the swipe pool either way; the share modal's count reflects
      // the live selectedIds when the user returns.
      onToggleSelected: (id, selected) => {
        setPendingSharePhotoIds((prev) => {
          const set = new Set(prev);
          if (selected) set.add(id);
          else set.delete(id);
          return Array.from(set);
        });
      },
      onShareNow: (singlePhotoId) => {
        // Share kicked off from the preview — don't re-open the
        // share modal when ProjectDetail comes back into focus,
        // the share pipeline is already running.
        setReopenShareModalOnFocus(false);
        // SharePreview ships one photo at a time. Pass the id
        // directly via the override arg so we don't depend on a
        // setState reaching the closure before the share runs.
        startShareTabSharing(singlePhotoId ? [singlePhotoId] : null);
      },
    });
    // Re-open the share sheet next time this screen comes into focus
    // so the user lands back on it instead of the share tab card.
    setReopenShareModalOnFocus(true);
  };

  // Entrypoint #2 — "Share Project Report" card. Routes into the
  // existing Report tab. If a report exists, jump to its preview;
  // if not, open the editor to build one.
  const handleStartShareReportFlow = () => {
    setActiveTab('report');
    if (reports && reports.length > 0) {
      setActiveReportId(reports[0].id);
      setReportPreviewStale(false);
      setReportViewMode('preview');
    } else {
      setReportViewMode('editor');
    }
  };

  // Pencil-on-photo handler in the report preview. Opens an app-
  // styled bottom sheet (see the photoEditMenuPhoto modal at the
  // bottom of this screen). The sheet has Open in editor, Reset to
  // global, Remove from report, and Cancel.
  const handlePhotoEditFromReport = useCallback((photo) => {
    if (!photo?.id) return;
    setPhotoEditMenuPhoto(photo);
  }, []);

  // Drop a photo from the current report — patches activeReport's
  // photoIds list, marks the preview stale, and bounces the share
  // button out for a Regenerate. Confirmed via a native Alert because
  // it's destructive and per-platform OS convention reads better here
  // than another in-app modal stacked on top of the action sheet.
  const handleRemovePhotoFromReport = useCallback((photo) => {
    if (!photo?.id || !activeReport?.id) return;
    Alert.alert(
      'Remove photo?',
      `Remove "${photo.name || 'this photo'}" from "${activeReport.title || 'this report'}"? The photo stays in the project; only the report drops it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const currentIds = Array.isArray(activeReport.photoIds) ? activeReport.photoIds : [];
              const nextIds = currentIds.filter((id) => String(id) !== String(photo.id));
              const nextReports = reports.map((r) =>
                r.id === activeReport.id
                  ? { ...r, photoIds: nextIds, photoCount: Math.max(1, Math.min(r.photoCount || nextIds.length, nextIds.length || 1)), updatedAt: Date.now() }
                  : r,
              );
              await persistReportsToStorageOnly(nextReports);
              setReports(nextReports);
              setReportPreviewStale(true);
              setPhotoEditMenuPhoto(null);
            } catch (e) {
              console.warn('[ProjectDetail] remove photo from report failed:', e?.message);
              Alert.alert('Could not remove', e?.message || 'Unknown error');
            }
          },
        },
      ],
      { cancelable: true },
    );
  }, [activeReport, reports]);

  // Called from the bottom selection bar when selectionPurpose==='share'.
  // Stashes the picked ids, exits selection mode, opens the format modal.
  const handleConfirmShareSelection = () => {
    if (selectionDraft.size === 0) return;
    setPendingSharePhotoIds(Array.from(selectionDraft));
    setSelectionMode(false);
    setSelectionDraft(new Set());
    setSelectionPurpose('report'); // reset for future selections
    setActiveTab('share');
    setShareFormatModalVisible(true);
  };

  // Runs after the user picks a format in the modal. Pulls the
  // pending photo ids from state, gathers their full photo objects,
  // and dispatches to the format-specific helpers.
  const startShareTabSharing = async (overrideIds = null) => {
    if (!project) return;
    setShareFormatModalVisible(false);
    const allowed = await ensureShareAllowed({ effectivePlan, navigation, t });
    if (!allowed) return;
    try {
      setSharing(true);
      // SharePreview ships one photo at a time and passes the id
      // explicitly via this override. Without the override we use the
      // pending set the modal accumulated (the normal share flow).
      const ids = new Set(Array.isArray(overrideIds) && overrideIds.length > 0 ? overrideIds : pendingSharePhotoIds);
      const source = getPhotosByProject(project.id) || [];
      const sharePhotos = source
        .filter(p => ids.has(p.id) && p.uri)
        .map(p => ({ uri: p.uri, mode: p.mode, id: p.id }));
      if (sharePhotos.length === 0) {
        Alert.alert('No Photos', 'No photos were selected to share.');
        setSharing(false);
        return;
      }
      // Starter tier is single-photo share only. Anything ≥2 kicks to
      // paywall (MULTI_PHOTO_SHARE trigger). The SharePreview / single-
      // photo tap paths go through this same function with a length-1
      // override, so they stay allowed.
      if (sharePhotos.length > 1 && !canUse(FEATURES.MULTI_PHOTO_SHARE)) {
        setSharing(false);
        setShareStatus('');
        navigation.navigate('PlanSelection', {
          mode: 'upgrade',
          trigger: PAYWALL_TRIGGERS.MULTI_PHOTO_SHARE,
        });
        return;
      }
      setShareStatus('Preparing photos...');
      // Two overlay paths. shareWithOverlays = ON routes each photo
      // through chromeBakeService, which mounts the full studio
      // overlay set (label + watermark + brand logo + metadata +
      // markup) and captureRef's the composite — the shared file is
      // pixel-equivalent to what the user just previewed in
      // PhotoDetail. shareWithOverlays = OFF falls back to the legacy
      // ensureLabelForPhoto path (labels only) so users who want raw
      // captures aren't forced into the heavier bake.
      if (shareWithOverlays) {
        setShareStatus(`Applying overlays (0/${sharePhotos.length})...`);
        // Enqueue every bake at once so chromeBakeService reports the
        // real N pending — GlobalBakeProgressBanner reads
        // service.getJobs() and shows "X of N" progress. The baker
        // still processes serially (single BakeJob mount), so total
        // wall time is the same as the previous for-await loop; only
        // the queue depth changes. Cached photos short-circuit and
        // resolve without pushing to the queue.
        const bakedResults = await Promise.all(
          sharePhotos.map((photo) => {
            const fullPhoto = source.find((p) => p.id === photo.id) || photo;
            return chromeBakeService.bakeChrome(fullPhoto, reportLabelSettings)
              .catch((e) => {
                console.warn('[ProjectDetail] Chrome bake failed for share photo:', e?.message);
                return null;
              });
          })
        );
        for (let i = 0; i < sharePhotos.length; i++) {
          const bakedUri = bakedResults[i];
          if (bakedUri && bakedUri !== sharePhotos[i].uri) {
            sharePhotos[i] = { ...sharePhotos[i], uri: bakedUri };
          }
        }
      } else if (showLabels) {
        for (let i = 0; i < sharePhotos.length; i++) {
          try {
            const photo = sharePhotos[i];
            const labeledUri = await ensureLabelForPhoto({ ...photo, type: photo.mode });
            if (labeledUri && labeledUri !== photo.uri) sharePhotos[i] = { ...photo, uri: labeledUri };
          } catch (e) {
            console.warn('[ProjectDetail] Label failed for share photo:', e?.message);
          }
        }
      }
      const urls = sharePhotos.map(p => p.uri).filter(Boolean);
      if (shareFormat === 'pdf') {
        await sharePhotosAsPdf(urls, sharePhotos);
      } else if (shareFormat === 'link') {
        await sharePhotosAsLink(urls);
      } else if (shareFormat === 'zip') {
        setShareStatus(`Zipping ${urls.length} photos...`);
        const zip = new JSZip();
        for (const uri of urls) {
          const fileName = uri.split('/').pop() || `photo_${Date.now()}.jpg`;
          const fileData = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          zip.file(fileName, fileData, { base64: true });
        }
        const zipContent = await zip.generateAsync({ type: 'base64' });
        const zipFileName = `${project.name || 'photos'}_${Date.now()}.zip`;
        const zipUri = `${FileSystem.cacheDirectory}${zipFileName}`;
        await FileSystem.writeAsStringAsync(zipUri, zipContent, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(__ensureFileUri(zipUri), { mimeType: 'application/zip', dialogTitle: zipFileName });
        await recordShare();
        await FileSystem.deleteAsync(zipUri, { idempotent: true });
      } else if (urls.length === 1) {
        await Sharing.shareAsync(__ensureFileUri(urls[0]), { mimeType: 'image/jpeg', dialogTitle: 'Share Photo' });
        await recordShare();
      } else if (urls.length > 1) {
        setShareStatus(`Preparing ${urls.length} photos...`);
        const tempDir = `${FileSystem.cacheDirectory}share_temp_${Date.now()}/`;
        await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
        const tempUris = [];
        for (let i = 0; i < urls.length; i++) {
          const fileName = urls[i].split('/').pop() || `photo_${i}.jpg`;
          const tempPath = `${tempDir}${fileName}`;
          await FileSystem.copyAsync({ from: urls[i], to: tempPath });
          tempUris.push(__ensureFileUri(tempPath));
        }
        await __RNShare.open({ urls: tempUris, type: 'image/jpeg', failOnCancel: false });
        await recordShare();
        await FileSystem.deleteAsync(tempDir, { idempotent: true });
      }
    } catch (error) {
      if (error?.message === 'User did not share' || error?.dismissedAction) return;
      console.error('[ProjectDetail] Share error:', error);
      Alert.alert('Share Error', 'Failed to share photos. Please try again.');
    } finally {
      setSharing(false);
      setShareStatus('');
    }
  };
  // Report tab state — see the Report panel further down for usage.
  // `reportTitle` is seeded from project name + global location once the
  // project is resolved; user can edit. `reportPhotoCount` is the max
  // number of photos to include (capped at the project's total).
  // `reportLayoutType` + `reportOptions` are the layout choice + the
  // option overrides the user has flipped in the editor; both live as
  // draft state and only get committed to the report record on
  // Generate. `isBuildingReport` blocks the button while we compose.
  const [reportTitle, setReportTitle] = useState('');
  const [reportPhotoCount, setReportPhotoCount] = useState(0);
  const [reportLayoutType, setReportLayoutType] = useState(DEFAULT_LAYOUT_ID);
  const [reportOptions, setReportOptions] = useState({});
  const [isBuildingReport, setIsBuildingReport] = useState(false);
  // Report templates — user-saved bundles of (layoutType + options)
  // reusable across reports. `pickerVisible` shows the apply picker,
  // `savePromptVisible` shows the naming prompt; both are local to the
  // Report editor. Templates load once when the picker opens.
  const [reportTemplatePickerVisible, setReportTemplatePickerVisible] = useState(false);
  const [reportTemplateSaveVisible, setReportTemplateSaveVisible] = useState(false);
  const [reportTemplateNameDraft, setReportTemplateNameDraft] = useState('');
  const [reportTemplates, setReportTemplates] = useState([]);

  // Selection mode for the Timeline grid. Enters via the
  // "Select photos" pill at the top of the Timeline tab, exits via
  // Cancel / "Add to report". (Long-press used to enter selection;
  // it now triggers the enlarged-preview overlay below so users can
  // peek at a photo without leaving the timeline.) `selectionDraft`
  // is what the user is toggling. When the user taps "Add to
  // report", we either create a brand-new report from the draft (if
  // no reports exist) or pop a modal so the user can choose between
  // updating an existing report or creating a new one.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState(new Set());
  // What the user is selecting FOR. 'report' is the existing flow
  // (Add to report bottom bar). 'share' is the new Share-tab flow:
  // the bottom bar reads "Share Selected" and opens the format
  // chooser instead of routing into the report editor.
  const [selectionPurpose, setSelectionPurpose] = useState('report');
  // Long-press-to-enlarge overlay on the Timeline grid. The URI
  // stays in state while the user holds; clearing it on press-out
  // closes the overlay.
  const [enlargedPreviewUri, setEnlargedPreviewUri] = useState(null);
  // When set, selection mode is editing the photo pool of an
  // EXISTING report instead of building a new selection. The Save
  // bar routes straight to updateReportPhotosFromSelection(id) and
  // skips the add-to-report picker modal.
  const [selectionEditingReportId, setSelectionEditingReportId] = useState(null);
  // When true, selection mode is feeding the editor's IN-MEMORY
  // draft (no report record yet). The Save bar writes the picked
  // ids back into editorPhotoIds and returns the user to the
  // editor without creating a report.
  const [selectionEditingDraft, setSelectionEditingDraft] = useState(false);

  // Persistent list of saved reports for this project. Loaded from
  // AsyncStorage on project change; written back through persistReports
  // any time a report is created / updated / deleted.
  const [reports, setReports] = useState([]);
  // Report tab view mode: 'list' (default) shows saved reports;
  // 'editor' shows the create/edit form; 'preview' shows the
  // post-generate read-only summary with Share. activeReportId
  // anchors editor + preview to a specific record (null while
  // creating a brand-new draft).
  const [reportViewMode, setReportViewMode] = useState('list');
  const [activeReportId, setActiveReportId] = useState(null);
  // Tracks per-photo edits made via the pencil affordance in the
  // preview. While true the Share button is replaced with Regenerate
  // and a banner warns that the rendered report is out of date.
  // Cleared on regenerate or when entering a fresh preview.
  const [reportPreviewStale, setReportPreviewStale] = useState(false);
  // The photo whose pencil was tapped — drives the per-photo action
  // sheet (Edit / Reset / Remove / Cancel). null = sheet closed.
  const [photoEditMenuPhoto, setPhotoEditMenuPhoto] = useState(null);
  // Per-edit-session photo selection — separate from the persisted
  // report's photoIds so the user can change the pool in the
  // editor without mutating the record until they hit Generate.
  const [editorPhotoIds, setEditorPhotoIds] = useState([]);
  // Modal that asks "add to which report?" when the user just
  // committed a selection but already has at least one saved report.
  const [addToReportModalOpen, setAddToReportModalOpen] = useState(false);

  // Load reports on project change. Also clears any old single-
  // selection AsyncStorage key — the new model stores everything in
  // the `reports` list, so the legacy key is dead weight.
  useEffect(() => {
    if (!project?.id) return;
    (async () => {
      try {
        const raw = await readSecure(reportsKey(project.id));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setReports(parsed);
          else setReports([]);
        } else {
          setReports([]);
        }
      } catch (_) {
        setReports([]);
      }
    })();
  }, [project?.id]);

  // Single point of truth for writing the reports list back to
  // AsyncStorage. Always updates local state too so re-renders
  // pick up changes immediately.
  const persistReports = async (next) => {
    setReports(next);
    if (project?.id) {
      try { await writeSecure(reportsKey(project.id), JSON.stringify(next)); } catch (_) {}
    }
  };
  // Storage-only variant: writes to AsyncStorage without touching
  // React state. Used by flows that batch multiple state updates
  // together at the end so an `await` between them doesn't split
  // them into separate React renders (which created a window where
  // setActiveReportId saw stale `reports` and the preview view
  // resolved activeReport to null).
  const persistReportsToStorageOnly = async (next) => {
    if (project?.id) {
      try { await writeSecure(reportsKey(project.id), JSON.stringify(next)); } catch (_) {}
    }
  };

  // The active report's saved photo ids (or empty set when no active
  // report). Drives the editor's photo pool and the Generate flow.
  const activeReport = useMemo(
    () => {
      const r = reports.find((rr) => rr.id === activeReportId) || null;
      console.warn('[Report] activeReport resolve', {
        activeReportId,
        reportsLen: reports.length,
        reportIds: reports.map((rr) => rr.id),
        found: !!r,
      });
      return r;
    },
    [reports, activeReportId],
  );
  const activeReportPhotoIds = useMemo(
    () => new Set(activeReport?.photoIds || []),
    [activeReport],
  );

  const projectPhotos = useMemo(
    () => (project ? getPhotosByProject(project.id) : []),
    [project, getPhotosByProject]
  );

  // "Share Project" entry from HomeScreen action-sheet and ProjectsScreen
  // 3-dot menu. One-shot: on arrival with `initialShareFlow=true`, open
  // the Share tab and immediately show the "Share N photos" format sheet
  // (the same state a user reaches by tapping "Share Project Photos" on
  // the Share tab card). Starter plan is single-photo share only (gated
  // at share time by MULTI_PHOTO_SHARE), so we seed pending ids with just
  // the first photo instead of all of them — the modal reads "Share 1
  // photo" and no paywall fires. Consume the flag via setParams so a
  // subsequent focus doesn't re-trigger.
  useEffect(() => {
    if (!route?.params?.initialShareFlow) return;
    if (!project) return;
    if ((projectPhotos?.length || 0) === 0) return;
    const canMultiShare = canUse(FEATURES.MULTI_PHOTO_SHARE);
    const seedIds = canMultiShare
      ? projectPhotos.map((p) => p.id)
      : [projectPhotos[0].id];
    setSharePhotosFilter('all');
    setPendingSharePhotoIds(seedIds);
    setActiveTab('share');
    setShareFormatModalVisible(true);
    navigation.setParams({ initialShareFlow: undefined });
  }, [route?.params?.initialShareFlow, project, projectPhotos, canUse, navigation]);

  // No more URI baking. The report renders the original photo file
  // with the BEFORE/AFTER chip overlaid as an HTML/CSS `<div>` —
  // same model as the studio's PhotoLabels component, just rendered
  // by expo-print's WebKit instead of React Native. No captureRef,
  // no native compositor, no cache invalidation churn. The label
  // settings flow through `branding.labelSettings` into the layout
  // engine's `labelChipsHtml` helper.
  const isBakingReportPhotos = false;

  // When entering the editor — either with an existing report or
  // a fresh draft — seed the form inputs + the editorPhotoIds draft
  // pool. Edits in the form stay LOCAL (no auto-save) until the
  // user hits Generate; that's the only commit point now.
  useEffect(() => {
    if (reportViewMode !== 'editor') return;
    if (activeReport) {
      // Editing an existing report — load its fields into the form.
      // Legacy reports without layoutType render as Room-by-Room.
      setReportTitle(activeReport.title || '');
      setReportPhotoCount(activeReport.photoCount || (activeReport.photoIds?.length ?? 0));
      setReportLayoutType(activeReport.layoutType || DEFAULT_LAYOUT_ID);
      // Merge any legacy `includeNotes` field into the new options
      // object so editing an old report doesn't silently flip the
      // toggle off.
      const legacyMerge = {};
      if (typeof activeReport.includeNotes === 'boolean') legacyMerge.includeNotes = activeReport.includeNotes;
      setReportOptions({ ...legacyMerge, ...(activeReport.options || {}) });
      setEditorPhotoIds(activeReport.photoIds || []);
    } else {
      // New draft — seed from project's last-used layout/options when
      // available, otherwise the engine defaults. Title gets a unique
      // sequence hint from the current list length.
      const idx = reports.length + 1;
      const baseTitle = [project?.name || 'Report', `#${idx}`].join(' ');
      setReportTitle(baseTitle);
      setReportPhotoCount(projectPhotos.length);
      setReportLayoutType(project?.lastReportLayoutType || DEFAULT_LAYOUT_ID);
      setReportOptions(project?.lastReportOptions ? { ...project.lastReportOptions } : {});
      setEditorPhotoIds(projectPhotos.map((p) => p.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportViewMode, activeReportId]);

  // Layout pick from the ReportStyleScreen is delivered via a
  // callback param (see openStylePicker below) rather than a
  // round-tripped route param — the nav merge pattern was unreliable.
  const applyPickedLayoutType = (id) => {
    console.warn('[Report] picker -> applyPickedLayoutType', id);
    if (!id) return;
    setReportLayoutType(id);
    setReportOptions((prev) => {
      const layout = getLayout(id);
      const supported = new Set(layout.supportedOptions);
      const next = {};
      for (const k of Object.keys(prev || {})) {
        if (supported.has(k)) next[k] = prev[k];
      }
      return next;
    });
  };

  // When the editor regains focus (after the Style picker pops),
  // check the module-level bridge for a pending selection. This is
  // the reliable handoff path — the route-param callback could be
  // stripped by React Navigation, but a module-level ref always
  // survives. Consume-on-read so a stale selection doesn't reapply
  // on every subsequent focus.
  useFocusEffect(
    useCallback(() => {
      const picked = consumePendingLayoutSelection();
      console.warn('[Report] editor focus, pending=', picked);
      if (picked) applyPickedLayoutType(picked);
      // After previewing the share selection in PhotoDetail, this
      // flag is set so when the user returns to ProjectDetail we
      // bring the share sheet back up where they left off.
      if (reopenShareModalOnFocus) {
        setReopenShareModalOnFocus(false);
        setShareFormatModalVisible(true);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reopenShareModalOnFocus]),
  );
  const timelineGroups = useMemo(() => buildTimeline(projectPhotos), [projectPhotos]);
  // Set-by-set layout used by the Pick photos selection mode. Each
  // entry is { id, room, before, progress[], after, combined, ts }.
  const setList = useMemo(() => buildSetList(projectPhotos), [projectPhotos]);
  // Flat gallery list for the Photos → Gallery sub-tab. Applies the
  // same filters buildTimeline does (drop combined/mix and side-by-
  // side composite URIs) so the user sees the original captures once
  // each, newest → oldest.
  const galleryTiles = useMemo(() => {
    const tiles = [];
    for (const p of projectPhotos) {
      if (!p) continue;
      if (p.mode === 'mix' || p.mode === 'combined') continue;
      if (p.uri && /_COMBINED_(?:BASE|EDIT)_(?:SIDE|STACK)_/i.test(p.uri)) continue;
      const ts = tsOfPhoto(p);
      if (!ts) continue;
      const dateKey = new Date(ts).toLocaleDateString('en-CA');
      const roomName = p.room || 'Unsorted';
      tiles.push({ id: p.id, uri: p.uri, ts, dateKey, roomName });
    }
    tiles.sort((a, b) => b.ts - a.ts);
    return tiles;
  }, [projectPhotos]);

  const handleRoomTap = (dateKey, roomName) => {
    navigation.navigate('PhotoSetPreview', {
      projectId: project.id,
      dateKey,
      roomName,
    });
  };

  // Long-press anywhere in the Timeline grid enters select mode with
  // every photo in the project pre-selected (per the user's spec:
  // "default all selected"). Cancel just exits; Save persists the
  // current draft to storage so the Report tab picks it up.
  const enterSelectionMode = () => {
    const allIds = new Set(projectPhotos.map((p) => p.id));
    setSelectionDraft(allIds);
    setSelectionMode(true);
  };
  // Delete flow — only reachable from within selection mode, once the
  // user has picked at least one photo. Confirms via Alert and skips
  // device-file deletion so the underlying Photos-library asset stays
  // intact (matches the existing Delete Photo Set policy).
  const handleDeleteSelected = () => {
    const ids = Array.from(selectionDraft);
    if (ids.length === 0) return;
    Alert.alert(
      t('gallery.deleteSelected'),
      t('gallery.deleteSelectedMessage', { count: ids.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            for (const id of ids) {
              try {
                await deletePhoto(id, { deleteFromStorage: false });
              } catch (e) {
                console.warn('[ProjectDetail] deletePhoto failed', id, e);
              }
            }
            cancelSelectionMode();
          },
        },
      ],
    );
  };

  const cancelSelectionMode = () => {
    setSelectionMode(false);
    setSelectionDraft(new Set());
    setSelectionEditingReportId(null);
    // Reset the share-flow flag so a future selection (e.g. for
    // "Add to report") goes back to its default behavior.
    setSelectionPurpose('report');
    if (selectionEditingDraft) {
      setSelectionEditingDraft(false);
      setActiveTab('report');
      setReportViewMode('editor');
    }
  };

  // Entry point from the report editor: pre-fill the selection draft
  // with the report's current photoIds (or the in-progress editor
  // draft if this is a new unsaved report), jump to the Timeline tab
  // in selection mode, and remember which report we're editing so
  // Save routes back here instead of popping the add-to-report
  // picker.
  const editReportPhotosInTimeline = (reportId) => {
    if (reportId) {
      const r = reports.find((rr) => rr.id === reportId);
      if (!r) return;
      setSelectionEditingReportId(reportId);
      setSelectionEditingDraft(false);
    } else {
      setSelectionEditingReportId(null);
      setSelectionEditingDraft(true);
    }
    // Default to ALL photos selected, regardless of the report's
    // saved selection or the editor draft. The user has been
    // explicit that the timeline should ALWAYS open with everything
    // selected — they'll deselect what they don't want.
    setSelectionDraft(new Set(projectPhotos.map((p) => p.id)));
    setSelectionMode(true);
    setReportViewMode('list');
    setActiveTab('timeline');
  };
  // Starter is single-photo share only. Instead of letting them build a
  // multi-select and hitting the paywall at Share time (frustrating —
  // they've already done the work), we gate the *entry points* to a
  // multi-selection: Select all, date-bucket select all, and any tap that
  // would grow the draft from 1 → 2+. Removals and single swaps stay
  // free. Only fires when selectionPurpose==='share' — Reports selection
  // isn't gated by MULTI_PHOTO_SHARE.
  const showMultiSharePaywall = useCallback(() => {
    navigation.navigate('PlanSelection', {
      mode: 'upgrade',
      trigger: PAYWALL_TRIGGERS.MULTI_PHOTO_SHARE,
    });
  }, [navigation]);
  const shareGateActive = () =>
    selectionPurpose === 'share' && !canUse(FEATURES.MULTI_PHOTO_SHARE);

  const togglePhotoSelected = (photoId) => {
    if (shareGateActive()) {
      const already = selectionDraft.has(photoId);
      // Deselect is always OK (only shrinks the set).
      if (already) {
        setSelectionDraft((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
        return;
      }
      // Add is OK only if the draft is currently empty — the result stays
      // at size 1. Adding when already at 1 = paywall.
      if (selectionDraft.size >= 1) {
        showMultiSharePaywall();
        return;
      }
      setSelectionDraft(new Set([photoId]));
      return;
    }
    setSelectionDraft((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (shareGateActive()) {
      showMultiSharePaywall();
      return;
    }
    const allSelected = projectPhotos.length > 0 && selectionDraft.size === projectPhotos.length;
    if (allSelected) setSelectionDraft(new Set());
    else setSelectionDraft(new Set(projectPhotos.map((p) => p.id)));
  };
  const toggleSelectDate = (datePhotoIds) => {
    if (shareGateActive()) {
      // Bucket toggle only matters if it would *add* multiple. A pure
      // shrink (everything in the bucket is already selected) is fine.
      const anyMissing = datePhotoIds.some((id) => !selectionDraft.has(id));
      if (anyMissing) {
        showMultiSharePaywall();
        return;
      }
      setSelectionDraft((prev) => {
        const next = new Set(prev);
        datePhotoIds.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }
    const allSelected = datePhotoIds.every((id) => selectionDraft.has(id));
    setSelectionDraft((prev) => {
      const next = new Set(prev);
      if (allSelected) datePhotoIds.forEach((id) => next.delete(id));
      else datePhotoIds.forEach((id) => next.add(id));
      return next;
    });
  };
  // "Add to report" / "Save to report" entrypoint from the Timeline
  // selection bar.
  //   - If selection mode was launched from a report editor (Pick
  //     photos link) → write straight back to that report.
  //   - No reports exist yet → create a fresh one immediately and
  //     jump to the Report tab's editor for that new report.
  //   - At least one report exists → open the add-to-report modal so
  //     the user can pick "update an existing report" or "create new".
  const handleAddSelectionToReport = () => {
    if (selectionDraft.size === 0) return;
    // Draft-editing flow — Save writes back to the editor's
    // in-memory photoIds without touching the persisted reports
    // list. The user lands back on the editor where they can
    // tweak more fields and finally hit Generate.
    if (selectionEditingDraft) {
      setEditorPhotoIds(Array.from(selectionDraft));
      setSelectionEditingDraft(false);
      setSelectionMode(false);
      setSelectionDraft(new Set());
      setSelectionEditingReportId(null);
      setActiveTab('report');
      setReportViewMode('editor');
      return;
    }
    if (selectionEditingReportId) {
      updateReportPhotosFromSelection(selectionEditingReportId);
      return;
    }
    if (reports.length === 0) {
      createReportFromSelection();
    } else {
      setAddToReportModalOpen(true);
    }
  };

  // Build a fresh report object out of the current selection draft +
  // sensible defaults, persist it, and open the Report editor on it.
  // Title seeds from the project name + a sequence number so the
  // user can rename later without picking from scratch.
  const createReportFromSelection = async () => {
    const ids = Array.from(selectionDraft);
    const idx = reports.length + 1;
    const baseTitle = [project?.name || 'Report', `#${idx}`].join(' ');
    const ts = Date.now();
    const newReport = {
      id: newReportId(),
      title: baseTitle,
      photoIds: ids,
      photoCount: ids.length,
      layoutType: project?.lastReportLayoutType || DEFAULT_LAYOUT_ID,
      options: project?.lastReportOptions ? { ...project.lastReportOptions } : {},
      createdAt: ts,
      updatedAt: ts,
    };
    await persistReports([...reports, newReport]);
    setActiveReportId(newReport.id);
    setAddToReportModalOpen(false);
    setSelectionMode(false);
    setSelectionDraft(new Set());
    setSelectionEditingReportId(null);
    setActiveTab('report');
    setReportViewMode('editor');
  };

  // Overwrite an existing report's photo pool with the current
  // selection draft. Keeps every other report field (title, notes
  // toggle, etc.) intact and bumps updatedAt for ordering.
  const updateReportPhotosFromSelection = async (reportId) => {
    const ids = Array.from(selectionDraft);
    const next = reports.map((r) =>
      r.id === reportId
        ? { ...r, photoIds: ids, photoCount: ids.length, updatedAt: Date.now() }
        : r,
    );
    await persistReports(next);
    setActiveReportId(reportId);
    setAddToReportModalOpen(false);
    setSelectionMode(false);
    setSelectionDraft(new Set());
    setSelectionEditingReportId(null);
    setActiveTab('report');
    setReportViewMode('editor');
  };

  // Generic patch helper used by the Report editor's inputs +
  // toggles. Always bumps updatedAt so the list view's "Updated …"
  // line stays accurate.
  const patchReport = async (reportId, patch) => {
    const next = reports.map((r) =>
      r.id === reportId ? { ...r, ...patch, updatedAt: Date.now() } : r,
    );
    await persistReports(next);
  };

  // Wipe a report from the project. Confirms first because the
  // action can't be undone and a long-polished report represents
  // real user time investment. Also cleans up the generated file
  // on disk so we don't leave orphans.
  const deleteReport = (reportId) => {
    Alert.alert(
      'Delete report?',
      'This removes the saved report. The photos themselves stay in the project.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const target = reports.find((r) => r.id === reportId);
            if (target?.generatedFilePath) {
              try { await FileSystem.deleteAsync(target.generatedFilePath, { idempotent: true }); } catch (_) {}
            }
            const next = reports.filter((r) => r.id !== reportId);
            await persistReports(next);
            if (activeReportId === reportId) setActiveReportId(null);
          },
        },
      ],
    );
  };

  const handleSetTap = (dateKey, roomName, anchorPhotoId) => {
    // initialPhotoId lands PhotoSetPreview on the tapped set's anchor
    // (Before, or earliest member when no Before exists). Without it
    // the pager always opens on the room's first photo regardless of
    // which set the user wanted to see.
    navigation.navigate('PhotoSetPreview', {
      projectId: project.id,
      dateKey,
      roomName,
      initialPhotoId: anchorPhotoId,
    });
  };

  if (!project) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Project</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.missingState}>
          <Text style={[styles.missingText, { color: theme.textSecondary }]}>
            This project no longer exists.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleDelete = async () => {
    setActionsVisible(false);
    setTimeout(async () => {
      try {
        await deleteProject(project.id, { deleteFromStorage: false });
        if (activeProjectId === project.id) setActiveProject(null);
        navigation.goBack();
      } catch (e) {
        // swallow — same approach as ProjectsScreen
      }
    }, 220);
  };

  // Read a local image into a data URI so the generated HTML is
  // self-contained — when the user shares the file, the receiver sees
  // the photos inline even without the original file:// paths.
  // Returns null on failure so the report can keep rendering with a
  // placeholder slot.
  //
  // Concurrency semaphore: every report layout calls fileToDataUri
  // through Promise.all, so without a limit ALL the photos in the
  // selection are base64-encoded simultaneously — that's enough
  // memory pressure to make iOS silently force-quit the app on
  // larger projects. Refs (not useState) so the queue + counter
  // survive re-renders without retriggering effects.
  const fileReadActiveRef = useRef(0);
  const fileReadQueueRef = useRef([]);
  const FILE_READ_LIMIT = 3;
  const fileReadSlot = async () => {
    if (fileReadActiveRef.current < FILE_READ_LIMIT) {
      fileReadActiveRef.current += 1;
      return;
    }
    await new Promise((resolve) => fileReadQueueRef.current.push(resolve));
    fileReadActiveRef.current += 1;
  };
  const fileReadRelease = () => {
    fileReadActiveRef.current = Math.max(0, fileReadActiveRef.current - 1);
    const next = fileReadQueueRef.current.shift();
    if (next) next();
  };

  // Bounded-concurrency base64 reader. Each layout runs Promise.all
  // over its photo list, which previously meant every photo in the
  // report was being loaded as base64 simultaneously. For projects
  // with ~30+ photos that's hundreds of MB of string allocation at
  // once, and iOS force-kills the app under that memory pressure
  // (silent — the JS try/catch never fires). Capping at 3 reads at a
  // time keeps the working set bounded without slowing single-photo
  // layouts perceptibly.
  // Detect the right image MIME from the URI's extension. Browsers
  // (including expo-print's WebKit) are usually permissive about
  // data: URI mime mismatches, but PNG with transparency can render
  // as a solid block when wrapped in image/jpeg, so be precise when
  // we can.
  const inferImageMime = (uri) => {
    const m = String(uri || '').toLowerCase().match(/\.(png|jpe?g|webp|gif|heic|heif)(?:[?#]|$)/);
    if (!m) return 'image/jpeg';
    const ext = m[1];
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'heic' || ext === 'heif') return 'image/heic';
    return 'image/jpeg';
  };
  const fileToDataUri = async (uri, mime) => {
    if (!uri) return null;
    await fileReadSlot();
    // Diagnostic just for the brand logo path — photos are too noisy.
    // We can't tell from outside whether the read succeeded; log the
    // mime + b64 length on success, or the error on failure.
    const isLogo = typeof uri === 'string'
      && (uri.includes('brand_logo') || uri.includes('ImagePicker') || uri.includes('Logo'));
    try {
      const finalMime = mime || inferImageMime(uri);
      const path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
      const b64 = await FileSystem.readAsStringAsync(path, { encoding: 'base64' });
      if (isLogo) {
        console.warn(`[Report] logo READ ok mime=${finalMime} b64Len=${b64.length} pathTail=${path.slice(-60)}`);
      }
      return `data:${finalMime};base64,${b64}`;
    } catch (e) {
      if (isLogo) {
        console.warn(`[Report] logo READ FAILED: ${e?.message || String(e)}`);
      }
      return null;
    } finally {
      fileReadRelease();
    }
  };

  // Build the report's HTML body via the layout dispatcher. The
  // engine resolves the layout (legacy reports → Room-by-Room) and
  // merges user options over the layout's defaults; output is a
  // self-contained HTML string (logo + photos embedded as data URIs)
  // suitable for sharing or feeding to expo-print for PDF.
  const buildReportHtml = async ({ title, photos, layoutType, options, logoUri }) => {
    const effectiveLogoUri = logoUri || null;
    // Photos are used as-is — original camera files. The layout
    // engine paints the BEFORE/AFTER chip as an HTML/CSS overlay via
    // labelChipsHtml inside photoImgHtml, driven by the
    // labelSettings we pass through `branding` below. No file
    // mutation, no bake queue.
    return generateReport({
      project: {
        title,
        location: location || '',
        generatedAt: Date.now(),
      },
      photos,
      layoutType: layoutType || DEFAULT_LAYOUT_ID,
      options: options || {},
      branding: {
        logoUri: effectiveLogoUri,
        companyName: reportCompanyName || '',
        brandColor: reportBrandColor || '#1A1A1A',
        // Watermark text + whether the global "show watermark" switch
        // is on. The layout still gates rendering on its own
        // includeWatermark option so the report editor can toggle it
        // per report.
        watermarkText: (showWatermark && watermarkText) ? watermarkText : '',
        labelSettings: reportLabelSettings,
        watermarkSettings: reportWatermarkSettings,
        metaSettings: reportMetaSettings,
        brandLogoSettings: reportBrandLogoSettings,
        // Maps Static API key — surfaced via app.config.js `extra`
        // from MAP_API_KEY in .env.local so the value isn't tracked
        // in git. When the env var is missing, mapsApiKey is null and
        // locationMapHtml emits '' (the report just skips the map).
        mapsApiKey: Constants?.expoConfig?.extra?.mapsApiKey || null,
      },
      helpers: {
        fileToDataUri,
        displayRoomName,
      },
    });
  };

  // Build a report's HTML, save it to persistent storage, and patch
  // the report record with the file path + timestamp. Returns the
  // saved file path (or null on failure). The actual share is done
  // by handleShareReport, which calls this when a regenerate is
  // needed.
  //
  // `skipStatePatch=true` skips the patchReport call. Used by
  // handleGenerateReport which batches the file paths into its own
  // final setReports/setActiveReportId/setReportViewMode block —
  // patchReport reads stale React state and would clobber the
  // not-yet-applied new report.
  const generateReportFile = async (report, { skipStatePatch = false } = {}) => {
    if (!report || !project) return null;
    const pool = (report.photoIds && report.photoIds.length > 0)
      ? projectPhotos.filter((p) => report.photoIds.includes(p.id))
      : projectPhotos;
    const sorted = [...pool].sort((a, b) => {
      const at = typeof a.timestamp === 'number' ? a.timestamp : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bt = typeof b.timestamp === 'number' ? b.timestamp : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return at - bt;
    });
    // Hard cap on photos per report. Each photo is embedded as a
    // base64 data URI in the HTML; without a cap a project with
    // hundreds of photos blows past iOS's memory budget and the OS
    // force-kills the app before any JS handler can fire. 50 is a
    // good balance — covers most real reports without OOM risk.
    const HARD_PHOTO_CAP = 50;
    const requested = report.photoCount || sorted.length;
    const cap = Math.max(1, Math.min(requested, sorted.length, HARD_PHOTO_CAP));
    const chosen = sorted.slice(0, cap);
    if (requested > HARD_PHOTO_CAP) {
      console.warn(
        `[Report] capped at ${HARD_PHOTO_CAP} photos (requested ${requested}) to avoid OOM`,
      );
    }
    console.warn(
      `[Report] generateReportFile id=${report.id} stored_layout=${report.layoutType} resolved_layout=${report.layoutType || DEFAULT_LAYOUT_ID} photos=${chosen.length}`,
    );
    // Honor the "Include branding" option for which logo (if any) is
    // passed to the engine. The engine also checks the option, but
    // not passing the URI saves an unnecessary file read on the
    // branding-off path.
    const resolved = resolveOptions(report.layoutType || DEFAULT_LAYOUT_ID, report.options);
    const chosenLogoUri = resolved.includeBranding === false ? null : (reportBrandLogoUri || brandLogoUri);
    // Diagnostic — these are the three things that have to all be
    // true for the logo to appear: include is on, a URI is stored,
    // and the file at that URI exists. The third we check live so
    // a stale cache URI (deleted by the OS) doesn't silently no-op.
    let logoFileSize = null;
    if (chosenLogoUri) {
      try {
        const info = await FileSystem.getInfoAsync(chosenLogoUri, { size: true });
        logoFileSize = info?.exists ? (info.size ?? -1) : 0;
      } catch (_) { logoFileSize = -1; }
    }
    console.warn(`[Report] logo includeBranding=${resolved.includeBranding !== false} report=${reportBrandLogoUri ? 'set' : 'null'} photo=${brandLogoUri ? 'set' : 'null'} chosen=${chosenLogoUri ? String(chosenLogoUri).slice(-50) : 'null'} fileSize=${logoFileSize}`);
    const html = await buildReportHtml({
      title: report.title?.trim() || project.name,
      photos: chosen,
      layoutType: report.layoutType || DEFAULT_LAYOUT_ID,
      options: report.options || {},
      logoUri: chosenLogoUri,
    });
    // Confirm the logo img tag actually made it into the final HTML.
    const hasLogoTag = typeof html === 'string' && html.includes('<img class="logo"');
    console.warn(`[Report] html hasLogoTag=${hasLogoTag} htmlLen=${html?.length || 0}`);
    // Persistent reports/ directory inside documentDirectory.
    try {
      const dir = reportsDir();
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } catch (_) {}
    const safeName = (report.title || project.name || 'report')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .slice(0, 80);
    const target = `${reportsDir()}${safeName}-${report.id}.html`;
    await FileSystem.writeAsStringAsync(target, html);
    // PDF via expo-print. Native module is now bundled in build 77+
    // (runtime 1.7.7 in app.config.js), so the top-level import in
    // the require() call below is safe — Hermes will resolve the
    // native ExpoPrint module without throwing. If a future OTA ever
    // lands on a pre-1.7.7 binary, the runtimeVersion mismatch will
    // already filter the bundle out before this code runs.
    let pdfTarget = null;
    try {
      // Lazy require keeps the module reference out of the module
      // init phase, so even if expo-print is somehow missing the
      // failure happens here (catchable) rather than during bundle
      // evaluation (uncatchable).
      const Print = require('expo-print');
      const pdfPath = `${reportsDir()}${safeName}-${report.id}.pdf`;
      const pdfResult = await Print.printToFileAsync({
        html,
        base64: false,
      });
      // expo-print writes to a temp path; move it to reportsDir/ so
      // we control its lifetime and can find it again from the
      // saved report record.
      await FileSystem.moveAsync({ from: pdfResult.uri, to: pdfPath });
      pdfTarget = pdfPath;
    } catch (e) {
      console.warn('[Report] PDF generation failed:', e?.message);
    }
    if (!skipStatePatch) {
      await patchReport(report.id, {
        generatedFilePath: target,
        generatedPdfPath: pdfTarget,
        generatedAt: Date.now(),
      });
    }
    return { html: target, pdf: pdfTarget, generatedAt: Date.now() };
  };

  // Share a report — uses the cached generated file when it still
  // exists on disk; regenerates and writes a fresh one otherwise.
  // Set `forceRegenerate` to true for the editor's "Generate & share"
  // button (the user explicitly wants the latest content).
  const handleShareReport = async (reportId, { forceRegenerate = false, format = 'html' } = {}) => {
    if (!project) return;
    if (isBuildingReport) return;
    setIsBuildingReport(true);
    try {
      const r = reports.find((rr) => rr.id === reportId);
      if (!r) return;
      let htmlTarget = r.generatedFilePath;
      let pdfTarget = r.generatedPdfPath;
      let needsRegenerate = forceRegenerate || !htmlTarget;
      if (htmlTarget && !needsRegenerate) {
        try {
          const info = await FileSystem.getInfoAsync(htmlTarget);
          if (!info.exists) needsRegenerate = true;
        } catch (_) {
          needsRegenerate = true;
        }
      }
      // Asking for PDF but we don't have one cached → regenerate.
      if (format === 'pdf' && !pdfTarget) needsRegenerate = true;
      if (needsRegenerate) {
        const out = await generateReportFile(r);
        htmlTarget = out?.html || null;
        pdfTarget = out?.pdf || null;
      }
      // Prefer the requested format; fall back gracefully when PDF
      // failed to render (e.g. expo-print unavailable in this build).
      const target = format === 'pdf' ? (pdfTarget || htmlTarget) : (htmlTarget || pdfTarget);
      if (!target) {
        Alert.alert('Could not share', 'No file produced.');
        return;
      }
      const isPdf = target.endsWith('.pdf');
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(__ensureFileUri(target), {
          mimeType: isPdf ? 'application/pdf' : 'text/html',
          UTI: isPdf ? 'com.adobe.pdf' : 'public.html',
          dialogTitle: 'Share report',
        });
        // Value-moment nudge — service handles all eligibility (only
        // fires once, never if user already saw the Referral screen).
        setTimeout(() => { maybeShowFirstReportReferralPrompt().catch(() => {}); }, 700);
      } else {
        Alert.alert('Saved', `Report saved to ${target}`);
      }
    } catch (e) {
      Alert.alert('Could not share report', e?.message || 'Unknown error');
    } finally {
      setIsBuildingReport(false);
    }
  };

  // Open the report-share format modal. Mirrors the Projects share
  // modal so the user gets the same four options (Files/ZIP/PDF/Link).
  const openReportShareModal = (reportId) => {
    if (!project || !reportId) return;
    setReportShareTargetId(reportId);
    setReportShareFormat('files');
    setReportShareModalVisible(true);
  };

  // Dispatch the report share by selected format. Each path operates
  // on the generated HTML file. Reuses shareLinkProvider state and
  // sharePhotosAsLink for the Link path so the user's last picked
  // cloud carries over from the project share.
  const handleReportShareConfirm = async () => {
    if (!project || !reportShareTargetId) return;
    const r = reports.find((rr) => rr.id === reportShareTargetId);
    if (!r) {
      Alert.alert('Report not found', 'Pick a report from the list and try again.');
      return;
    }
    setReportShareModalVisible(false);
    if (isBuildingReport) return;
    setIsBuildingReport(true);
    try {
      let htmlTarget = r.generatedFilePath;
      let needs = !htmlTarget;
      if (htmlTarget && !needs) {
        try { const info = await FileSystem.getInfoAsync(htmlTarget); if (!info.exists) needs = true; }
        catch (_) { needs = true; }
      }
      if (needs) {
        const out = await generateReportFile(r);
        htmlTarget = out?.html || null;
      }
      if (!htmlTarget) {
        Alert.alert('Could not share', 'Report file failed to render.');
        return;
      }
      const safeName = (r.title || project.name || 'report').replace(/[\\/:*?"<>|]/g, '_');

      if (reportShareFormat === 'files') {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(__ensureFileUri(htmlTarget), {
            mimeType: 'text/html', UTI: 'public.html',
            dialogTitle: `Share ${safeName}`,
          });
          setTimeout(() => { maybeShowFirstReportReferralPrompt().catch(() => {}); }, 700);
        } else {
          Alert.alert('Saved', `Report saved to ${htmlTarget}`);
        }
        return;
      }

      if (reportShareFormat === 'pdf') {
        // Same lazy-require risk as sharePhotosAsPdf — on Hermes the
        // throw can bypass try/catch when ExpoPrint isn't compiled in.
        // User accepted this risk for the Projects share PDF path.
        try {
          const Print = require('expo-print');
          const htmlString = await FileSystem.readAsStringAsync(htmlTarget);
          const printed = await Print.printToFileAsync({ html: htmlString, base64: false });
          const pdfDest = `${reportsDir()}${safeName}-${r.id}.pdf`;
          try { await FileSystem.deleteAsync(pdfDest, { idempotent: true }); } catch (_) {}
          try { await FileSystem.moveAsync({ from: printed.uri, to: pdfDest }); } catch (_) {}
          const finalPdf = (await FileSystem.getInfoAsync(pdfDest)).exists ? pdfDest : printed.uri;
          // expo-sharing on iOS needs a `file://` URI; without it the
          // share extension hands the recipient a path string instead
          // of a file descriptor and downstream apps can't detect the
          // MIME type even though we set it here.
          await Sharing.shareAsync(__ensureFileUri(finalPdf), {
            mimeType: 'application/pdf', UTI: 'com.adobe.pdf',
            dialogTitle: `Share ${safeName}`,
          });
          setTimeout(() => { maybeShowFirstReportReferralPrompt().catch(() => {}); }, 700);
        } catch (_) {
          Alert.alert(
            'PDF not supported in this build',
            'A new TestFlight build is required to share as PDF. Try Files, ZIP, or Link instead.',
          );
        }
        return;
      }

      if (reportShareFormat === 'zip') {
        // Mirror the working project-photos ZIP path exactly: read the
        // HTML as base64 and add to JSZip with { base64: true }. The
        // previous code read the HTML as a UTF-8 string and added it
        // untyped, which produced an archive some unzippers (Finder,
        // some Windows tools) refused to open — same payload bytes,
        // but JSZip's CRC/size headers came out differently. Use the
        // cacheDirectory + Date.now() filename pattern too, also
        // matching the photo path that works in production.
        const htmlBase64 = await FileSystem.readAsStringAsync(htmlTarget, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const zip = new JSZip();
        zip.file(`${safeName}.html`, htmlBase64, { base64: true });
        const zipB64 = await zip.generateAsync({ type: 'base64' });
        const zipFileName = `${safeName}_${Date.now()}.zip`;
        const zipPath = `${FileSystem.cacheDirectory}${zipFileName}`;
        await FileSystem.writeAsStringAsync(zipPath, zipB64, { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(__ensureFileUri(zipPath), {
          mimeType: 'application/zip',
          dialogTitle: zipFileName,
        });
        try { await FileSystem.deleteAsync(zipPath, { idempotent: true }); } catch {}
        setTimeout(() => { maybeShowFirstReportReferralPrompt().catch(() => {}); }, 700);
        return;
      }

      if (reportShareFormat === 'link') {
        // Reuse sharePhotosAsLink with the HTML file as the single
        // upload target. Provider picked via shareLinkProvider state.
        await sharePhotosAsLink([htmlTarget]);
        setTimeout(() => { maybeShowFirstReportReferralPrompt().catch(() => {}); }, 700);
        return;
      }
    } catch (e) {
      Alert.alert('Could not share report', e?.message || 'Unknown error');
    } finally {
      setIsBuildingReport(false);
    }
  };

  // "Generate" in the editor — commits the editor draft (creating
  // a new report or updating the existing one), then builds the
  // HTML file and transitions to the preview view. The user shares
  // from the preview, not from the editor; this avoids the
  // every-tap-makes-a-report problem the user flagged.
  const handleGenerateReport = async (overrides = null) => {
    if (!project || projectPhotos.length === 0) {
      Alert.alert('No photos', 'This project has no photos to put in a report.');
      return;
    }
    if (isBuildingReport) return;
    // Callers can pass explicit `overrides` (photoIds/photoCount/title/
    // layoutType/options) to bypass editor state. Needed when the user
    // hits Regenerate from the preview after a per-photo edit: the
    // editor state was never hydrated for this session so reading
    // editorPhotoIds/reportPhotoCount from closure would give the
    // initial empty values, wiping the report down to 1 photo.
    const existing = targetReportId => reports.find((r) => r.id === targetReportId);
    const existingActive = activeReportId ? existing(activeReportId) : null;
    const effectivePhotoIds = Array.isArray(overrides?.photoIds)
      ? overrides.photoIds
      : (Array.isArray(editorPhotoIds) && editorPhotoIds.length > 0
        ? editorPhotoIds
        : (existingActive?.photoIds || projectPhotos.map((p) => p.id)));
    const effectivePhotoCountRaw = overrides?.photoCount
      || reportPhotoCount
      || existingActive?.photoCount
      || effectivePhotoIds.length;
    const effectiveTitle = overrides?.title ?? reportTitle;
    const effectiveLayoutType = overrides?.layoutType ?? reportLayoutType;
    const effectiveOptions = overrides?.options ?? reportOptions;
    console.warn('[Report] Generate tapped — reportLayoutType state =', effectiveLayoutType);
    setIsBuildingReport(true);
    try {
      const ts = Date.now();
      const draftIds = effectivePhotoIds;
      const baseTitle = (effectiveTitle || '').trim() || project.name || 'Report';
      let targetReportId = activeReportId;
      let nextReports;
      if (targetReportId && reports.find((r) => r.id === targetReportId)) {
        // Editing an existing report — patch its fields with the
        // current draft state. generatedFilePath stays for now;
        // generateReportFile will overwrite it after the rebuild.
        nextReports = reports.map((r) =>
          r.id === targetReportId
            ? {
                ...r,
                title: baseTitle,
                photoIds: draftIds,
                photoCount: Math.max(1, Math.min(effectivePhotoCountRaw || draftIds.length, draftIds.length || 1)),
                layoutType: effectiveLayoutType || DEFAULT_LAYOUT_ID,
                options: { ...effectiveOptions },
                updatedAt: ts,
              }
            : r,
        );
      } else {
        // Fresh draft — only NOW does the report record get
        // created, so the list doesn't fill up with empty drafts.
        const newReport = {
          id: newReportId(),
          title: baseTitle,
          photoIds: draftIds,
          photoCount: Math.max(1, Math.min(effectivePhotoCountRaw || draftIds.length, draftIds.length || 1)),
          layoutType: effectiveLayoutType || DEFAULT_LAYOUT_ID,
          options: { ...effectiveOptions },
          createdAt: ts,
          updatedAt: ts,
        };
        targetReportId = newReport.id;
        nextReports = [...reports, newReport];
      }
      // Two-phase commit so React batches all state updates:
      //
      //  1. Render the HTML/PDF file with the new report config
      //     (passing skipStatePatch so it doesn't call patchReport,
      //     which reads stale `reports` state via closure and would
      //     clobber the not-yet-applied new report).
      //  2. Bake the resulting file paths into the report record.
      //  3. Write to AsyncStorage and patch the project last-used.
      //  4. Apply ALL React state updates synchronously at the end.
      //     No more `await` between them — they batch into one
      //     render so activeReport useMemo sees the new record.
      const committedReport = nextReports.find((r) => r.id === targetReportId);
      const fileOut = await generateReportFile(committedReport, { skipStatePatch: true });
      const finalizedReports = nextReports.map((r) =>
        r.id === targetReportId
          ? {
              ...r,
              generatedFilePath: fileOut?.html || null,
              generatedPdfPath: fileOut?.pdf || null,
              generatedAt: fileOut?.generatedAt || Date.now(),
            }
          : r,
      );
      await persistReportsToStorageOnly(finalizedReports);
      if (project?.id && patchProject) {
        await patchProject(project.id, {
          lastReportLayoutType: effectiveLayoutType || DEFAULT_LAYOUT_ID,
          lastReportOptions: { ...effectiveOptions },
        });
      }
      setReports(finalizedReports);
      setActiveReportId(targetReportId);
      setReportPreviewStale(false);
      setReportViewMode('preview');
    } catch (e) {
      Alert.alert('Could not build report', e?.message || 'Unknown error');
    } finally {
      setIsBuildingReport(false);
    }
  };

  // Duplicate a report — clones every field except id / timestamps /
  // generated file (a fresh report has no file yet). Title gets a
  // " (copy)" suffix unless it would collide with another report,
  // in which case we append " (copy 2)", " (copy 3)", etc.
  const duplicateReport = async (reportId) => {
    const src = reports.find((r) => r.id === reportId);
    if (!src) return;
    const existing = new Set(reports.map((r) => r.title || ''));
    let copyTitle = `${src.title || 'Report'} (copy)`;
    let n = 2;
    while (existing.has(copyTitle)) {
      copyTitle = `${src.title || 'Report'} (copy ${n++})`;
    }
    const ts = Date.now();
    const clone = {
      ...src,
      id: newReportId(),
      title: copyTitle,
      generatedFilePath: undefined,
      generatedAt: undefined,
      createdAt: ts,
      updatedAt: ts,
    };
    await persistReports([...reports, clone]);
  };

  // Reset the project to the app's defaults:
  //   1. Per-photo edits — clear pairTemplate (format) and any
  //      beforeOverrideId / afterOverrideId (Studio Layout swap)
  //      on every photo in the project. Capture-time aspect kicks
  //      back in; Studio's auto-default will re-pick a format if
  //      the user opens the photo in Edit.
  //   2. Saved Report selection — wipe the AsyncStorage entry so
  //      the Report tab falls back to "all photos." Otherwise the
  //      report keeps using a stale subset after a reset.
  //   3. Label settings (global toggles):
  //      Watermark ON · Labels ON · Metadata OFF · Logo OFF.
  // Wrapped in a confirm so the user can't bulk-wipe edits by
  // accident.
  const handleDefaultSettings = () => {
    setActionsVisible(false);
    setTimeout(() => {
      Alert.alert(
        'Reset to default settings?',
        `Clears the per-photo format and source swaps for every photo in "${project.name}", drops any saved Report photo selection, and turns labels + watermark on, metadata + logo off.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: async () => {
              try {
                // Clear per-photo edits. Done sequentially because
                // updatePhoto re-saves the whole photos array each
                // call — parallelizing would race and the last
                // writer would clobber the others.
                for (const p of projectPhotos) {
                  const patch = {};
                  if (p?.pairTemplate != null) patch.pairTemplate = null;
                  if (p?.beforeOverrideId != null) patch.beforeOverrideId = null;
                  if (p?.afterOverrideId != null) patch.afterOverrideId = null;
                  if (Object.keys(patch).length > 0) {
                    await updatePhoto(p.id, patch);
                  }
                }
                // Drop the project's reports list (and the legacy
                // single-selection key) so the Report tab returns to
                // an empty state on reset. Also delete any generated
                // report files on disk so we don't leave orphans
                // behind in documentDirectory/reports/.
                if (project?.id) {
                  try { await AsyncStorage.removeItem(reportSelectionKey(project.id)); } catch (_) {}
                  try { await deleteSecure(reportSelectionKey(project.id)); } catch (_) {}
                  for (const r of reports) {
                    if (r?.generatedFilePath) {
                      try { await FileSystem.deleteAsync(r.generatedFilePath, { idempotent: true }); } catch (_) {}
                    }
                  }
                  try { await deleteSecure(reportsKey(project.id)); } catch (_) {}
                  setReports([]);
                  setActiveReportId(null);
                }
                // Apply the default label settings. toggleLabels has
                // no boolean form, so check + flip only when needed.
                if (!showLabels) await toggleLabels();
                await updateShowWatermark(true);
                await togglePreviewMetadata(false);
                await updateShowBrandLogo(false);
              } catch (_) {
                // swallow — Settings persisters log their own errors
              }
            },
          },
        ],
      );
    }, 220);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>
          {project.name}
        </Text>
        <TouchableOpacity
          onPress={() => setActionsVisible(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                {
                  backgroundColor: isActive ? theme.accent : 'transparent',
                  borderColor: isActive ? theme.accent : theme.border,
                },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: isActive ? theme.accentText : theme.textSecondary },
                ]}
              >
                {t(tab.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 20 + insets.bottom + 50 + 24 }]}
      >
        {activeTab === 'timeline' && (
          timelineGroups.length === 0 ? (
            <View style={styles.stubState}>
              <Ionicons name="time-outline" size={40} color={theme.textMuted} />
              <Text style={[styles.stubTitle, { color: theme.textPrimary }]}>No photos yet</Text>
              <Text style={[styles.stubSubtitle, { color: theme.textSecondary }]}>
                Capture photos in this project and they'll appear here grouped by date and room.
              </Text>
            </View>
          ) : (
            <>
              {/* Sub-tab strip under the "Photos" top tab. Timeline =
                  date → room grouped view; Gallery = flat grid of every
                  photo newest-first. Hidden while the user is in
                  selection mode (the set-list picker takes over). */}
              {!selectionMode && (
                <View style={styles.photosSubTabsRow}>
                  {[
                    { key: 'timeline', labelKey: 'projectDetail.tabTimeline' },
                    { key: 'gallery', labelKey: 'projectDetail.photosSubGallery' },
                    { key: 'rooms', labelKey: 'projectDetail.photosSubRooms' },
                  ].map((sub) => {
                    const isActive = photosSubTab === sub.key;
                    return (
                      <TouchableOpacity
                        key={sub.key}
                        onPress={() => setPhotosSubTab(sub.key)}
                        style={[
                          styles.photosSubTab,
                          {
                            backgroundColor: isActive ? theme.surfaceElevated : 'transparent',
                            borderColor: isActive ? theme.borderStrong : theme.border,
                          },
                        ]}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text
                          style={[
                            styles.photosSubTabText,
                            { color: isActive ? theme.textPrimary : theme.textSecondary },
                          ]}
                        >
                          {t(sub.labelKey)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {/* Select-photos pill — replaces the long-press entry
                  for selection mode now that long-press is reserved
                  for the enlarged-preview overlay. Hidden once
                  selectionMode is on (the banner below takes over). */}
              {!selectionMode && projectPhotos.length > 0 && (
                <TouchableOpacity
                  onPress={enterSelectionMode}
                  style={[styles.timelineSelectPill, { borderColor: theme.borderStrong }]}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="checkbox-outline" size={16} color={theme.textPrimary} />
                  <Text style={[styles.timelineSelectPillText, { color: theme.textPrimary }]}>
                    {t('projectDetail.selectPhotos')}
                  </Text>
                </TouchableOpacity>
              )}
              {/* Selection-mode banner — anchors the "Select all"
                  checkbox plus a Cancel exit. Only renders while the
                  user is mid-selection. Save sits at the bottom so it
                  stays in thumb reach even when the grid is long. */}
              {selectionMode && (() => {
                const allSelected = projectPhotos.length > 0 && selectionDraft.size === projectPhotos.length;
                const selectedCount = selectionDraft.size;
                return (
                  <View style={[styles.selectionBanner, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
                    <TouchableOpacity
                      style={styles.selectionBannerLeft}
                      onPress={toggleSelectAll}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <View style={[
                        styles.selectionCheckbox,
                        {
                          backgroundColor: allSelected ? theme.accent : 'transparent',
                          borderColor: allSelected ? theme.accent : theme.borderStrong,
                        },
                      ]}>
                        {allSelected && (
                          <Ionicons name="checkmark" size={14} color={theme.accentText} />
                        )}
                      </View>
                      <Text style={[styles.selectionBannerText, { color: theme.textPrimary }]}>
                        Select all ({selectedCount}/{projectPhotos.length})
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.selectionBannerActions}>
                      {selectedCount > 0 && (
                        <TouchableOpacity
                          onPress={handleDeleteSelected}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={[styles.selectionBannerCancel, { color: theme.danger || '#D9534F' }]}>
                            {t('common.delete')}
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={cancelSelectionMode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={[styles.selectionBannerCancel, { color: theme.textSecondary }]}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })()}
              {/* Rooms sub-tab (and legacy Selection-mode flow) render
                  one section per capture set — Before / Progress* /
                  After / Combined in a single row. In selection mode
                  each tile toggles the draft on tap; in read-only
                  mode taps route to PhotoSetPreview anchored on the
                  tapped photo. The set-level checkbox + scrim only
                  render while selecting. */}
              {photosSubTab === 'rooms' ? (
                setList.length === 0 ? null : setList.map((set) => {
                  const setMembers = [set.before, ...set.progress, set.after, set.combined].filter(Boolean);
                  if (setMembers.length === 0) return null;
                  const memberIds = setMembers.map((p) => p.id);
                  const setAllSelected = selectionMode && memberIds.every((id) => selectionDraft.has(id));
                  const toggleSet = () => {
                    if (setAllSelected) memberIds.forEach((id) => { if (selectionDraft.has(id)) togglePhotoSelected(id); });
                    else memberIds.forEach((id) => { if (!selectionDraft.has(id)) togglePhotoSelected(id); });
                  };
                  const labelFor = (p) => {
                    if (!p) return '';
                    if (p.mode === 'before') return 'Before';
                    if (p.mode === 'after') return 'After';
                    if (p.mode === 'progress') return 'Progress';
                    if (p.mode === 'mix' || p.mode === 'combined') return 'Combined';
                    return '';
                  };
                  return (
                    <View key={set.id} style={styles.dateSection}>
                      <View style={styles.dateHeader}>
                        <Text style={[styles.dateLabel, { color: theme.textPrimary }]} numberOfLines={1}>
                          {displayRoomName(set.room) || 'Unsorted'}
                        </Text>
                        {selectionMode && (
                          <TouchableOpacity
                            onPress={toggleSet}
                            style={styles.dateSelectBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <View style={[
                              styles.dateSelectCheck,
                              {
                                backgroundColor: setAllSelected ? theme.accent : 'transparent',
                                borderColor: setAllSelected ? theme.accent : theme.borderStrong,
                              },
                            ]}>
                              {setAllSelected && (
                                <Ionicons name="checkmark" size={10} color={theme.accentText} />
                              )}
                            </View>
                            <Text style={[styles.dateSelectBtnText, { color: theme.textSecondary }]}>Set</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.timelineGrid}>
                        {setMembers.map((p) => {
                          const isSelected = selectionDraft.has(p.id);
                          const pTs = tsOfPhoto(p);
                          const pDateKey = pTs ? new Date(pTs).toLocaleDateString('en-CA') : '';
                          return (
                            <TouchableOpacity
                              key={`${set.id}-${p.id}`}
                              style={styles.timelineGridTile}
                              onPress={() => {
                                if (selectionMode) togglePhotoSelected(p.id);
                                else if (pDateKey) handleSetTap(pDateKey, set.room, p.id);
                              }}
                              onLongPress={() => { if (p.uri) setEnlargedPreviewUri(p.uri); }}
                              onPressOut={() => { if (enlargedPreviewUri) setEnlargedPreviewUri(null); }}
                              delayLongPress={250}
                              activeOpacity={0.7}
                            >
                              <View style={styles.timelineGridThumbWrap}>
                                {p.uri ? (
                                  <Image source={{ uri: p.uri }} style={styles.timelineGridThumb} />
                                ) : (
                                  <View style={[styles.timelineGridThumb, styles.roomTilePlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                                    <Ionicons name="image-outline" size={28} color={theme.textMuted} />
                                  </View>
                                )}
                                {selectionMode && (
                                  <View style={[
                                    styles.timelineSelectCheck,
                                    {
                                      backgroundColor: isSelected ? theme.accent : 'rgba(0,0,0,0.45)',
                                      borderColor: isSelected ? theme.accent : '#FFFFFF',
                                    },
                                  ]}>
                                    {isSelected && (
                                      <Ionicons name="checkmark" size={14} color={theme.accentText} />
                                    )}
                                  </View>
                                )}
                                {selectionMode && !isSelected && (
                                  <View pointerEvents="none" style={styles.timelineDeselectScrim} />
                                )}
                              </View>
                              <Text style={[styles.roomTileName, { color: theme.textPrimary }]} numberOfLines={1}>
                                {labelFor(p)}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              ) : photosSubTab === 'timeline' ? (
              timelineGroups.map((group) => {
                const datePhotoIds = group.rooms.flatMap((r) => r.photoTiles.map((t) => t.id));
                const dateAllSelected = selectionMode && datePhotoIds.length > 0 && datePhotoIds.every((id) => selectionDraft.has(id));
                return (
              <View key={group.dateKey} style={styles.dateSection}>
                <View style={styles.dateHeader}>
                  <Text style={[styles.dateLabel, { color: theme.textPrimary }]}>
                    {formatDateLabel(group.ts)}
                  </Text>
                  {selectionMode ? (
                    <TouchableOpacity
                      onPress={() => toggleSelectDate(datePhotoIds)}
                      style={styles.dateSelectBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <View style={[
                        styles.dateSelectCheck,
                        {
                          backgroundColor: dateAllSelected ? theme.accent : 'transparent',
                          borderColor: dateAllSelected ? theme.accent : theme.borderStrong,
                        },
                      ]}>
                        {dateAllSelected && (
                          <Ionicons name="checkmark" size={10} color={theme.accentText} />
                        )}
                      </View>
                      <Text style={[styles.dateMeta, { color: dateAllSelected ? theme.accent : theme.textSecondary }]}>
                        {dateAllSelected ? t('projectDetail.deselectDate') : t('projectDetail.selectDate')}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                  <Text style={[styles.dateMeta, { color: theme.textSecondary }]}>
                    {t('common.photoCount', { count: group.totalPhotos })}
                  </Text>
                  )}
                </View>
                {/* For each date, render one section per room — room
                    header (room name + count) then a 4-column grid of
                    that room's photos. Rooms stack vertically in the
                    order they were first captured during the day. */}
                {group.rooms.map((room) => (
                  <View key={`${group.dateKey}-${room.name}`} style={styles.timelineRoomBlock}>
                    <View style={styles.timelineRoomHeader}>
                      <Text style={[styles.timelineRoomName, { color: theme.textPrimary }]} numberOfLines={1}>
                        {displayRoomName(room.name)}
                      </Text>
                      <Text style={[styles.timelineRoomMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                        {room.setCount > 1
                          ? t('projectDetail.roomMetaWithSets', { count: room.photoCount, sets: room.setCount })
                          : t('common.photoCount', { count: room.photoCount })}
                      </Text>
                    </View>
                    <View style={styles.timelineGrid}>
                      {room.photoTiles.map((tile) => {
                        const isSelected = selectionDraft.has(tile.id);
                        return (
                          <TouchableOpacity
                            key={`${group.dateKey}-${tile.id}`}
                            style={styles.timelineGridTile}
                            onPress={() => {
                              if (selectionMode) togglePhotoSelected(tile.id);
                              else handleSetTap(group.dateKey, tile.roomName, tile.anchorPhotoId);
                            }}
                            onLongPress={() => {
                              if (tile.uri) setEnlargedPreviewUri(tile.uri);
                            }}
                            onPressOut={() => {
                              if (enlargedPreviewUri) setEnlargedPreviewUri(null);
                            }}
                            delayLongPress={250}
                            activeOpacity={0.7}
                          >
                            <View style={styles.timelineGridThumbWrap}>
                              {tile.uri ? (
                                <Image source={{ uri: tile.uri }} style={styles.timelineGridThumb} />
                              ) : (
                                <View style={[styles.timelineGridThumb, styles.roomTilePlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                                  <Ionicons name="image-outline" size={28} color={theme.textMuted} />
                                </View>
                              )}
                              {selectionMode && (
                                <View style={[
                                  styles.timelineSelectCheck,
                                  {
                                    backgroundColor: isSelected ? theme.accent : 'rgba(0,0,0,0.45)',
                                    borderColor: isSelected ? theme.accent : '#FFFFFF',
                                  },
                                ]}>
                                  {isSelected && (
                                    <Ionicons name="checkmark" size={14} color={theme.accentText} />
                                  )}
                                </View>
                              )}
                              {selectionMode && !isSelected && (
                                <View pointerEvents="none" style={styles.timelineDeselectScrim} />
                              )}
                            </View>
                            {/* Room name is implied by the room
                                header above — only the set label
                                stays on each tile inside the room
                                section. */}
                            <Text style={[styles.roomTileName, { color: theme.textPrimary }]} numberOfLines={1}>
                              {t('home.setLabel', { n: tile.setIndex })}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
              );
              })
              ) : (
              // Gallery sub-tab: flat 4-column grid of every photo in
              // the project, sorted newest → oldest. Reuses the
              // timelineGrid tile styles for visual parity with the
              // Timeline sub-tab. Tap → PhotoSetPreview anchored on
              // the tapped photo; long-press → enlarged preview
              // overlay (same as Timeline).
              <View style={styles.timelineGrid}>
                {galleryTiles.map((tile) => {
                  const isSelected = selectionDraft.has(tile.id);
                  return (
                    <TouchableOpacity
                      key={`gallery-${tile.id}`}
                      style={styles.timelineGridTile}
                      onPress={() => {
                        if (selectionMode) togglePhotoSelected(tile.id);
                        else handleSetTap(tile.dateKey, tile.roomName, tile.id);
                      }}
                      onLongPress={() => { if (tile.uri) setEnlargedPreviewUri(tile.uri); }}
                      onPressOut={() => { if (enlargedPreviewUri) setEnlargedPreviewUri(null); }}
                      delayLongPress={250}
                      activeOpacity={0.7}
                    >
                      <View style={styles.timelineGridThumbWrap}>
                        {tile.uri ? (
                          <Image source={{ uri: tile.uri }} style={styles.timelineGridThumb} />
                        ) : (
                          <View style={[styles.timelineGridThumb, styles.roomTilePlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                            <Ionicons name="image-outline" size={28} color={theme.textMuted} />
                          </View>
                        )}
                        {selectionMode && (
                          <View style={[
                            styles.timelineSelectCheck,
                            {
                              backgroundColor: isSelected ? theme.accent : 'rgba(0,0,0,0.45)',
                              borderColor: isSelected ? theme.accent : '#FFFFFF',
                            },
                          ]}>
                            {isSelected && (
                              <Ionicons name="checkmark" size={14} color={theme.accentText} />
                            )}
                          </View>
                        )}
                        {selectionMode && !isSelected && (
                          <View pointerEvents="none" style={styles.timelineDeselectScrim} />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              )}
            </>
          )
        )}
        {activeTab === 'location' && (() => {
          // Source pool depends on the scope toggle: 'project' uses
          // only the current project's photos, 'all' aggregates across
          // every project the user has. Cards are PER-PROJECT — each
          // card represents one project and lists every distinct
          // location string captured in that project's photos.
          const sourcePhotos = locationsScope === 'all' ? (allPhotos || []) : projectPhotos;
          const projectNameById = new Map((projects || []).map((p) => [p.id, p.name]));
          // Per project: aggregate locations (set), ts (newest), and a
          // representative lat/lng for the "open in maps" action. The
          // map at the top still renders one marker per GPS-tagged
          // photo so the overview stays accurate.
          const byProject = new Map();
          const gpsPoints = [];
          // Sentinel projectId for photos with no projectId — keeps
          // them visible in the list rather than silently dropping
          // them on the floor (the map already shows their pin).
          const UNASSIGNED_PID = '__unassigned__';
          for (const p of sourcePhotos) {
            const where = (p?.location || '').toString().trim();
            const ts = typeof p?.timestamp === 'number'
              ? p.timestamp
              : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
            const lat = typeof p?.lat === 'number' ? p.lat : (typeof p?.latitude === 'number' ? p.latitude : null);
            const lng = typeof p?.lng === 'number' ? p.lng : (typeof p?.longitude === 'number' ? p.longitude : null);
            const pid = p?.projectId || UNASSIGNED_PID;
            if (where || (lat != null && lng != null)) {
              let bucket = byProject.get(pid);
              if (!bucket) {
                bucket = { projectId: pid, locations: new Map(), ts: 0, lat: null, lng: null };
                byProject.set(pid, bucket);
              }
              if (where) {
                const loc = bucket.locations.get(where);
                if (!loc) {
                  bucket.locations.set(where, { ts, lat, lng });
                } else {
                  if (ts > loc.ts) loc.ts = ts;
                  if (lat != null && loc.lat == null) { loc.lat = lat; loc.lng = lng; }
                }
              }
              if (ts > bucket.ts) bucket.ts = ts;
              if (lat != null && lng != null && bucket.lat == null) {
                bucket.lat = lat;
                bucket.lng = lng;
              }
            }
            if (lat != null && lng != null) {
              gpsPoints.push({ id: p.id, lat, lng, uri: p.uri, ts, where: where || null });
            }
          }
          // In "All projects" mode, seed a bucket for every project
          // even if its photos carry no location text / GPS — many
          // users put the address in the project NAME rather than on
          // each photo, and they still expect to see one card per
          // project. Tap → opens Maps with the project name as the
          // search query (best-effort but useful for address-named
          // projects). In "This project" mode we stay strict.
          if (locationsScope === 'all') {
            for (const proj of (projects || [])) {
              if (!byProject.has(proj.id)) {
                const projTs = proj.createdAt ? new Date(proj.createdAt).getTime() : 0;
                byProject.set(proj.id, {
                  projectId: proj.id,
                  locations: new Map(),
                  ts: projTs,
                  lat: null,
                  lng: null,
                });
              }
            }
          }
          const projectCards = Array.from(byProject.values())
            .filter((b) =>
              b.locations.size > 0
              || (b.lat != null && b.lng != null)
              || locationsScope === 'all'
            )
            .sort((a, b) => b.ts - a.ts);
          const hasMap = gpsPoints.length > 0;
          const mapRegion = hasMap
            ? (() => {
                const lats = gpsPoints.map((g) => g.lat);
                const lngs = gpsPoints.map((g) => g.lng);
                const minLat = Math.min(...lats);
                const maxLat = Math.max(...lats);
                const minLng = Math.min(...lngs);
                const maxLng = Math.max(...lngs);
                const latitudeDelta = Math.max(0.01, (maxLat - minLat) * 1.5);
                const longitudeDelta = Math.max(0.01, (maxLng - minLng) * 1.5);
                return {
                  latitude: (minLat + maxLat) / 2,
                  longitude: (minLng + maxLng) / 2,
                  latitudeDelta,
                  longitudeDelta,
                };
              })()
            : null;
          // Build the URL that the OS Maps app expects. Prefer
          // lat,lng when we have it (precise pin); fall back to a
          // text query so a city-only entry still opens something
          // useful. iOS: maps:// → Apple Maps. Android: geo: →
          // user's default maps app (typically Google).
          const openInMaps = (label, lat, lng) => {
            try {
              if (Platform.OS === 'ios') {
                const url = (lat != null && lng != null)
                  ? `maps://?ll=${lat},${lng}&q=${encodeURIComponent(label || `${lat},${lng}`)}`
                  : `maps://?q=${encodeURIComponent(label || '')}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(label || `${lat},${lng}`)}`);
                });
              } else {
                const url = (lat != null && lng != null)
                  ? `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label || '')})`
                  : `geo:0,0?q=${encodeURIComponent(label || '')}`;
                Linking.openURL(url).catch(() => {
                  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || '')}`);
                });
              }
            } catch (_) {}
          };

          // Scope toggle — always rendered so the user can flip even
          // when one scope is empty.
          const ScopeToggle = (
            <View style={[styles.locationsScopeRow, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
              {[
                { key: 'project', label: t('projectDetail.thisProject') },
                { key: 'all', label: t('projectDetail.allProjects') },
              ].map((opt) => {
                const active = locationsScope === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.locationsScopeBtn,
                      active && { backgroundColor: theme.accent },
                    ]}
                    onPress={() => setLocationsScope(opt.key)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.locationsScopeText,
                        { color: active ? theme.accentText : theme.textSecondary },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          );

          if (projectCards.length === 0 && !hasMap) {
            return (
              <View style={styles.locationList}>
                {ScopeToggle}
                <View style={styles.stubState}>
                  <Ionicons name="location-outline" size={40} color={theme.textMuted} />
                  <Text style={[styles.stubTitle, { color: theme.textPrimary }]}>No locations yet</Text>
                  <Text style={[styles.stubSubtitle, { color: theme.textSecondary }]}>
                    Locations + GPS pins captured with your photos will appear here.
                  </Text>
                </View>
              </View>
            );
          }
          return (
            <View style={styles.locationList}>
              {ScopeToggle}
              {hasMap && mapRegion && (
                <MapView
                  provider={PROVIDER_DEFAULT}
                  style={styles.locationMap}
                  initialRegion={mapRegion}
                >
                  {gpsPoints.map((g) => (
                    <Marker
                      key={`gps-${g.id}`}
                      coordinate={{ latitude: g.lat, longitude: g.lng }}
                      title={g.where || ''}
                      description={g.ts ? new Date(g.ts).toLocaleString('en-US') : ''}
                    />
                  ))}
                </MapView>
              )}
              {projectCards.map((bucket) => {
                const projectName = bucket.projectId === '__unassigned__'
                  ? 'Unassigned photos'
                  : (projectNameById.get(bucket.projectId) || 'Untitled project');
                const locs = Array.from(bucket.locations.entries())
                  .sort((a, b) => b[1].ts - a[1].ts);
                const primary = locs[0];
                return (
                  <TouchableOpacity
                    key={bucket.projectId}
                    style={[styles.locationCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={() => openInMaps(primary?.[0] || projectName, primary?.[1]?.lat ?? bucket.lat, primary?.[1]?.lng ?? bucket.lng)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.locationCardIcon, { backgroundColor: theme.surfaceElevated }]}>
                      <Ionicons name="location" size={18} color={theme.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.locationCardTitle, { color: theme.textPrimary }]}
                        numberOfLines={1}
                      >
                        {projectName}
                      </Text>
                      {locs.length > 0 ? (
                        locs.map(([where, info]) => (
                          <TouchableOpacity
                            key={where}
                            onPress={() => openInMaps(where, info.lat, info.lng)}
                            activeOpacity={0.7}
                            style={styles.locationCardLocationRow}
                          >
                            <Ionicons name="pin-outline" size={12} color={theme.textSecondary} />
                            <Text
                              style={[styles.locationCardLocationText, { color: theme.textSecondary }]}
                              numberOfLines={2}
                            >
                              {where}
                            </Text>
                          </TouchableOpacity>
                        ))
                      ) : (bucket.lat != null && bucket.lng != null) ? (
                        <TouchableOpacity
                          onPress={() => openInMaps(projectName, bucket.lat, bucket.lng)}
                          activeOpacity={0.7}
                          style={styles.locationCardLocationRow}
                        >
                          <Ionicons name="pin-outline" size={12} color={theme.textSecondary} />
                          <Text
                            style={[styles.locationCardLocationText, { color: theme.textSecondary }]}
                            numberOfLines={1}
                          >
                            {bucket.lat.toFixed(5)}, {bucket.lng.toFixed(5)}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {bucket.ts > 0 && (
                        <Text style={[styles.locationCardMeta, { color: theme.textMuted }]}>
                          {t('projectDetail.mostRecent', { date: new Date(bucket.ts).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric', year: 'numeric' }) })}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="open-outline" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })()}
        {activeTab === 'report' && reportViewMode === 'list' && (
          // LIST VIEW — every saved report as a card, plus a
          // primary "+ New report" button. Reports are sorted by
          // most recently updated. Tapping a card opens the
          // PREVIEW for that report (not the editor — the editor
          // sits behind an explicit Edit button on the preview).
          // "+ New report" enters the editor with a fresh draft;
          // the report record is created only when the user hits
          // Generate.
          <View style={styles.reportPanel}>
            <TouchableOpacity
              style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent }]}
              onPress={() => {
                setActiveReportId(null);
                setReportViewMode('editor');
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color={theme.accentText} />
              <Text style={[styles.reportPrimaryBtnText, { color: theme.accentText }]}>
                {t('projectDetail.newReport')}
              </Text>
            </TouchableOpacity>
            {reports.length === 0 ? (
              <View style={styles.stubState}>
                <Ionicons name="document-text-outline" size={40} color={theme.textMuted} />
                <Text style={[styles.stubTitle, { color: theme.textPrimary }]}>No reports yet</Text>
                <Text style={[styles.stubSubtitle, { color: theme.textSecondary }]}>
                  Tap "New report" above, or long-press a photo in the Timeline tab to start one.
                </Text>
              </View>
            ) : (
              [...reports]
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .map((r) => {
                  const hasGenerated = !!r.generatedFilePath;
                  return (
                    <View
                      key={r.id}
                      style={[styles.reportListCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    >
                      {/* Tile body — tap opens the PREVIEW (read-
                          only summary + Share). Edit access is via
                          the pencil action button below. */}
                      <TouchableOpacity
                        style={styles.reportListCardBody}
                        onPress={() => {
                          setActiveReportId(r.id);
                          setReportViewMode('preview');
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.addToReportIcon, { backgroundColor: theme.surfaceElevated }]}>
                          <Ionicons name="document-text-outline" size={18} color={theme.textPrimary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.addToReportRowTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                            {r.title || 'Untitled report'}
                          </Text>
                          <Text style={[styles.addToReportRowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                            {getLayout(r.layoutType).name}
                            {` · ${r.photoIds?.length ?? 0} ${r.photoIds?.length === 1 ? 'photo' : 'photos'}`}
                            {hasGenerated && r.generatedAt
                              ? ` · Generated ${new Date(r.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              : (r.updatedAt ? ` · Updated ${new Date(r.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                      {/* Per-card action row — Share, Duplicate, Delete.
                          Each is its own TouchableOpacity so taps don't
                          accidentally open the editor. */}
                      <View style={styles.reportListActions}>
                        <TouchableOpacity
                          onPress={() => {
                            setActiveReportId(r.id);
                            setReportViewMode('editor');
                          }}
                          style={styles.reportListActionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="pencil-outline" size={18} color={theme.textPrimary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => openReportShareModal(r.id)}
                          style={styles.reportListActionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          disabled={isBuildingReport}
                        >
                          <Ionicons name="share-outline" size={18} color={theme.accent} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => duplicateReport(r.id)}
                          style={styles.reportListActionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="copy-outline" size={18} color={theme.textPrimary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => deleteReport(r.id)}
                          style={styles.reportListActionBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="trash-outline" size={16} color={theme.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
            )}
          </View>
        )}
        {activeTab === 'report' && reportViewMode === 'editor' && (() => {
          // EDITOR VIEW — draft state lives in the local input
          // setters (reportTitle / reportPhotoCount / etc.) and
          // editorPhotoIds. Nothing is persisted until the user
          // hits Generate. The pool below is derived from
          // editorPhotoIds + the full project photos, so the photo
          // stepper's cap reflects the user's current selection.
          const draftIds = Array.isArray(editorPhotoIds) ? editorPhotoIds : [];
          const pool = draftIds.length > 0
            ? projectPhotos.filter((p) => draftIds.includes(p.id))
            : projectPhotos;
          const maxPhotos = pool.length;
          // Bump the photo count up/down in single steps; clamped to
          // [1, maxPhotos] so the user can't request more photos than
          // the project actually has.
          // Plain draft-state setters — nothing persists until
          // the user hits Generate, which builds the file and
          // commits the report record in one shot.
          const setCountClamped = (next) => {
            const clamped = Math.max(1, Math.min(next, maxPhotos || 1));
            setReportPhotoCount(clamped);
          };
          const bumpCount = (delta) => setCountClamped((reportPhotoCount || maxPhotos) + delta);
          const isEditingExisting = !!activeReportId && !!reports.find((r) => r.id === activeReportId);
          return (
            <View style={styles.reportPanel}>
              {/* Editor header — back to reports list + (only when
                  editing an EXISTING report) a delete button. New
                  drafts can just be navigated away from without
                  leaving anything behind. */}
              <View style={styles.reportEditorHeader}>
                <TouchableOpacity
                  style={styles.reportEditorBackBtn}
                  onPress={() => {
                    setReportViewMode('list');
                    setActiveReportId(null);
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="chevron-back" size={18} color={theme.textPrimary} />
                  <Text style={[styles.reportEditorBackText, { color: theme.textPrimary }]}>Reports</Text>
                </TouchableOpacity>
                {isEditingExisting && (
                  <TouchableOpacity
                    onPress={() => deleteReport(activeReportId)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.danger} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Title — local draft state; only committed when
                  the user hits Generate. */}
              <Text style={[styles.reportSectionLabel, { color: theme.textSecondary }]}>TITLE</Text>
              <TextInput
                value={reportTitle}
                onChangeText={setReportTitle}
                placeholder="Report title"
                placeholderTextColor={theme.textMuted}
                style={[styles.reportInput, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
              />

              {/* Branding section — shows current report branding summary
                  with a link to open BrandingSettings. Falls back to
                  the photo-editor logo when no report logo is set.
                  When the active layout declares includeBranding, the
                  toggle lives here (not in the layout-options block
                  below) so users flip it in-context with the config it
                  drives. */}
              {(() => {
                const layoutForBranding = getLayout(reportLayoutType);
                const supportsBrandingToggle = layoutForBranding.supportedOptions.includes('includeBranding');
                const brandingResolved = resolveOptions(layoutForBranding.id, reportOptions);
                const brandingOn = brandingResolved.includeBranding !== false;
                return (
                  <>
                    <View style={styles.reportSectionHeader}>
                      <Text style={[styles.reportSectionLabel, { color: theme.textSecondary }]}>BRANDING</Text>
                      <TouchableOpacity
                        onPress={() => navigation.navigate('BrandingSettings')}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={[styles.reportSectionLink, { color: theme.accent }]}>Edit →</Text>
                      </TouchableOpacity>
                    </View>
                    {supportsBrandingToggle && (
                      <View style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>
                            {OPTION_META.includeBranding.label}
                          </Text>
                          <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>
                            {OPTION_META.includeBranding.description}
                          </Text>
                        </View>
                        <Switch
                          value={brandingOn}
                          onValueChange={(next) => setReportOptions((prev) => ({ ...prev, includeBranding: next }))}
                          trackColor={{ false: '#E0E0E0', true: theme.accent }}
                          thumbColor="#FFFFFF"
                        />
                      </View>
                    )}
                    <View style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                      {(reportBrandLogoUri || brandLogoUri) ? (
                        <Image
                          source={{ uri: reportBrandLogoUri || brandLogoUri }}
                          style={styles.reportLogoThumb}
                          resizeMode="contain"
                        />
                      ) : null}
                      <View style={{ flex: 1, marginLeft: (reportBrandLogoUri || brandLogoUri) ? 10 : 0 }}>
                        {reportCompanyName ? (
                          <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>{reportCompanyName}</Text>
                        ) : (
                          <Text style={[styles.reportRowSubtle, { color: theme.textMuted || theme.textSecondary }]}>No company name set</Text>
                        )}
                        <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>
                          {reportBrandLogoUri ? 'Report logo' : brandLogoUri ? 'Using photo logo (no report logo set)' : 'No logo set'}
                        </Text>
                      </View>
                      {reportBrandColor ? (
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: reportBrandColor, marginLeft: 8 }} />
                      ) : null}
                    </View>
                  </>
                );
              })()}

              {/* Photo count stepper. Max is the active report's
                  saved photo pool; min 1. The "Pick photos" link
                  jumps to the Timeline pre-loaded with this report's
                  current selection so the user can toggle which
                  actual photos belong to the report (the stepper
                  only trims the count, not the membership). */}
              <View style={styles.reportSectionHeader}>
                <Text style={[styles.reportSectionLabel, { color: theme.textSecondary }]}>PHOTOS</Text>
                <TouchableOpacity
                  onPress={() => editReportPhotosInTimeline(activeReportId)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={[styles.reportSectionLink, { color: theme.accent }]}>Pick photos →</Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>
                  Include {reportPhotoCount} of {maxPhotos}
                </Text>
                <View style={styles.reportStepper}>
                  <TouchableOpacity
                    onPress={() => bumpCount(-1)}
                    disabled={reportPhotoCount <= 1}
                    style={[styles.reportStepBtn, { backgroundColor: theme.surfaceElevated, opacity: reportPhotoCount <= 1 ? 0.4 : 1 }]}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="remove" size={18} color={theme.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => bumpCount(1)}
                    disabled={reportPhotoCount >= maxPhotos}
                    style={[styles.reportStepBtn, { backgroundColor: theme.surfaceElevated, opacity: reportPhotoCount >= maxPhotos ? 0.4 : 1 }]}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons name="add" size={18} color={theme.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setCountClamped(maxPhotos)}
                    disabled={reportPhotoCount === maxPhotos}
                    style={[styles.reportAllBtn, { borderColor: theme.border, opacity: reportPhotoCount === maxPhotos ? 0.4 : 1 }]}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={[styles.reportAllBtnText, { color: theme.textPrimary }]}>All</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Style row — opens the layout picker. The label is
                  the human-facing name of the selected layout (e.g.
                  "Room-by-Room"). Selection round-trips via the
                  pendingLayoutType route param + useEffect above. */}
              {(() => {
                const currentLayout = getLayout(reportLayoutType);
                return (
                  <>
                    <Text style={[styles.reportSectionLabel, { color: theme.textSecondary }]}>STYLE</Text>
                    <TouchableOpacity
                      style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                      onPress={() => navigation.navigate('ReportStyle', {
                        current: reportLayoutType,
                        onSelect: applyPickedLayoutType,
                      })}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>
                          {currentLayout.name}
                        </Text>
                        <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>
                          {currentLayout.description}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>

                    {/* Report templates — snapshot the current
                        layoutType + reportOptions under a name and
                        reapply to any report later. Templates live in
                        AsyncStorage (per-device). No shipped presets:
                        the user creates their own. */}
                    <TouchableOpacity
                      style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                      onPress={async () => {
                        try {
                          const list = await listReportTemplates();
                          setReportTemplates(list);
                        } catch (_) {}
                        setReportTemplatePickerVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="albums-outline" size={18} color={theme.textPrimary} style={{ marginRight: 12 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>
                          {t('report.applyTemplate', { defaultValue: 'Apply template' })}
                        </Text>
                        <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>
                          {t('report.applyTemplateSubtitle', { defaultValue: 'Reuse a saved layout + options' })}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                      onPress={() => {
                        setReportTemplateNameDraft('');
                        setReportTemplateSaveVisible(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="bookmark-outline" size={18} color={theme.textPrimary} style={{ marginRight: 12 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>
                          {t('report.saveAsTemplate', { defaultValue: 'Save as template…' })}
                        </Text>
                        <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>
                          {t('report.saveAsTemplateSubtitle', { defaultValue: 'Snapshot this layout + options' })}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Layout-specific options — rendered from the
                        layout's supportedOptions + OPTION_META, split
                        into two sections by REPORT_OPTION_GROUPS so
                        the user has a clear separation between report
                        content knobs and layout presentation knobs.
                        Hidden keys (options the active layout doesn't
                        declare) are kept in `reportOptions` only until
                        the user changes the layout, at which point the
                        useEffect above prunes them. */}
                    {(() => {
                      const renderOptionRow = (key) => {
                        const meta = OPTION_META[key];
                        if (!meta) return null;
                        const resolved = resolveOptions(currentLayout.id, reportOptions);
                        const value = resolved[key];
                        const update = (next) => {
                          setReportOptions((prev) => ({ ...prev, [key]: next }));
                        };
                        if (meta.control === 'segmented') {
                          return (
                            <View
                              key={key}
                              style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>{meta.label}</Text>
                                {meta.description ? (
                                  <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>{meta.description}</Text>
                                ) : null}
                              </View>
                              <View style={{ flexDirection: 'row', gap: 6 }}>
                                {meta.choices.map((choice) => {
                                  const active = value === choice.value;
                                  return (
                                    <TouchableOpacity
                                      key={String(choice.value)}
                                      onPress={() => update(choice.value)}
                                      style={{
                                        paddingHorizontal: 12,
                                        paddingVertical: 6,
                                        borderRadius: 6,
                                        borderWidth: 1,
                                        borderColor: active ? theme.accent : theme.border,
                                        backgroundColor: active ? theme.accent : 'transparent',
                                      }}
                                      activeOpacity={0.7}
                                    >
                                      <Text style={{
                                        color: active ? theme.accentText : theme.textPrimary,
                                        fontWeight: '600',
                                        fontSize: 12,
                                      }}>{choice.label}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          );
                        }
                        // "Include overlays" (showLabels) links to
                        // LabelsLanguage where the per-overlay config
                        // (labels, watermark, brand logo, metadata) lives.
                        const CUSTOMIZE_ROUTE_BY_KEY = {
                          showOverlays: 'LabelsLanguage',
                          showLabels: 'LabelsLanguage',
                        };
                        const customizeRoute = CUSTOMIZE_ROUTE_BY_KEY[key];
                        return (
                          <View
                            key={key}
                            style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>{meta.label}</Text>
                              {meta.description ? (
                                <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>{meta.description}</Text>
                              ) : null}
                              {customizeRoute && (
                                <TouchableOpacity
                                  onPress={() => navigation.navigate(customizeRoute)}
                                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                  style={{ marginTop: 4 }}
                                >
                                  <Text style={[styles.reportSectionLink, { color: theme.accent }]}>Customize →</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            <Switch
                              value={!!value}
                              onValueChange={update}
                              trackColor={{ false: '#E0E0E0', true: theme.accent }}
                              thumbColor="#FFFFFF"
                            />
                          </View>
                        );
                      };

                      const supportedSet = new Set(currentLayout.supportedOptions);
                      const knownKeys = new Set(REPORT_OPTION_GROUPS.flatMap((g) => g.keys));
                      const orphanKeys = currentLayout.supportedOptions.filter((k) => !knownKeys.has(k));
                      // includeBranding lives inside the BRANDING section
                      // (rendered above alongside the logo / company /
                      // color summary + "Edit →" link to BrandingSettings)
                      // so users toggle it in-context with the config it
                      // controls. Skip it here to avoid a duplicate row.
                      const HOISTED_KEYS = new Set(['includeBranding']);
                      return (
                        <>
                          {REPORT_OPTION_GROUPS.map((group) => {
                            const groupKeys = group.keys.filter((k) => supportedSet.has(k) && !HOISTED_KEYS.has(k));
                            // Tack any orphan keys (declared by a layout
                            // but not categorized in REPORT_OPTION_GROUPS)
                            // onto the Layout section as a safety net.
                            const keys = group.id === 'layout'
                              ? [...groupKeys, ...orphanKeys.filter((k) => !HOISTED_KEYS.has(k))]
                              : groupKeys;
                            if (keys.length === 0) return null;
                            return (
                              <React.Fragment key={group.id}>
                                <Text style={[styles.reportSectionLabel, { color: theme.textSecondary, marginTop: 6 }]}>
                                  {group.title}
                                </Text>
                                {keys.map(renderOptionRow)}
                              </React.Fragment>
                            );
                          })}
                        </>
                      );
                    })()}
                  </>
                );
              })()}

              {/* Generate — commits the draft (new record on first
                  generate, or update on subsequent), builds the
                  HTML + PDF files, then jumps to the preview view
                  where the user can share. */}
              <TouchableOpacity
                style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent, opacity: isBuildingReport ? 0.7 : 1 }]}
                onPress={handleGenerateReport}
                disabled={isBuildingReport || projectPhotos.length === 0}
                activeOpacity={0.85}
              >
                {isBuildingReport ? (
                  <ActivityIndicator color={theme.accentText} />
                ) : (
                  <>
                    <Ionicons name="document-text-outline" size={18} color={theme.accentText} />
                    <Text style={[styles.reportPrimaryBtnText, { color: theme.accentText }]}>
                      {isEditingExisting ? 'Regenerate' : 'Generate'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.reportFooterNote, { color: theme.textSecondary }]}>
                Generates a PDF (and a portable HTML copy) using the selected style.
              </Text>
            </View>
          );
        })()}
        {/* Diagnostic + safety net: when the Report tab is active but
            none of the three view-mode branches match (e.g. preview mode
            but activeReport resolved to null after a state-update race),
            render a fallback instead of an empty screen. */}
        {activeTab === 'report' && (() => {
          const inList = reportViewMode === 'list';
          const inEditor = reportViewMode === 'editor';
          const inPreview = reportViewMode === 'preview' && !!activeReport;
          if (inList || inEditor || inPreview) return null;
          console.warn('[Report] tab fallback fired', {
            viewMode: reportViewMode,
            activeReportId,
            hasActiveReport: !!activeReport,
            reportCount: reports.length,
          });
          return (
            <View style={styles.reportPanel}>
              <Text style={[styles.reportSectionLabel, { color: theme.textSecondary, marginBottom: 10 }]}>
                REPORT
              </Text>
              <Text style={[styles.reportRowLabel, { color: theme.textPrimary, marginBottom: 6 }]}>
                Something went sideways.
              </Text>
              <Text style={[styles.reportRowSubtle, { color: theme.textSecondary, marginBottom: 14 }]}>
                The selected report didn't load. Try going back to the report list.
              </Text>
              <TouchableOpacity
                style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent }]}
                onPress={() => {
                  setReportViewMode('list');
                  setActiveReportId(null);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="list-outline" size={18} color={theme.accentText} />
                <Text style={[styles.reportPrimaryBtnText, { color: theme.accentText }]}>
                  Back to reports
                </Text>
              </TouchableOpacity>
            </View>
          );
        })()}
        {activeTab === 'report' && reportViewMode === 'preview' && activeReport && (() => {
          // PREVIEW VIEW — read-only summary of a generated report
          // with the Share button as the primary action. Edit
          // bounces back into the editor for tweaks; Regenerate
          // rebuilds the file from the latest settings; Back
          // returns to the list.
          const previewIds = new Set(activeReport.photoIds || []);
          const previewPhotos = projectPhotos.filter((p) => previewIds.has(p.id));
          const previewPool = previewPhotos.length > 0 ? previewPhotos : projectPhotos;
          const cappedPreview = previewPool.slice(0, Math.min(activeReport.photoCount || previewPool.length, previewPool.length));
          return (
            <View style={styles.reportPanel}>
              {/* Preview header — back link + Edit shortcut. When
                  per-photo edits are pending (reportPreviewStale) any
                  attempt to leave the preview is intercepted with a
                  Save / Discard / Cancel confirm so the user can't
                  accidentally walk away from an out-of-date share. */}
              <View style={styles.reportEditorHeader}>
                <TouchableOpacity
                  style={styles.reportEditorBackBtn}
                  onPress={() => {
                    const leave = () => { setReportViewMode('list'); setActiveReportId(null); };
                    if (!reportPreviewStale) { leave(); return; }
                    Alert.alert(
                      'Save changes?',
                      'You edited a photo since the report was generated. Save (regenerate) before leaving, or discard and the report stays as it was.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Discard', style: 'destructive', onPress: () => { setReportPreviewStale(false); leave(); } },
                        { text: 'Save', onPress: () => {
                          // Pass activeReport's fields as explicit
                          // overrides so handleGenerateReport doesn't
                          // read stale editor state via closure (the
                          // setState calls above wouldn't apply before
                          // the async handler runs).
                          const overrides = activeReport ? {
                            photoIds: activeReport.photoIds || [],
                            photoCount: activeReport.photoCount || (activeReport.photoIds || []).length,
                            title: activeReport.title || '',
                            layoutType: activeReport.layoutType || DEFAULT_LAYOUT_ID,
                            options: activeReport.options || {},
                          } : null;
                          handleGenerateReport(overrides).then(() => leave());
                        } },
                      ],
                      { cancelable: true },
                    );
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="chevron-back" size={18} color={theme.textPrimary} />
                  <Text style={[styles.reportEditorBackText, { color: theme.textPrimary }]}>Reports</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setReportViewMode('editor')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="pencil-outline" size={18} color={theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {/* Title + meta block — mirrors the bake-time HTML
                  header so the user sees roughly what the share
                  will look like before sending. */}
              <View style={[styles.reportPreviewHeader, { backgroundColor: theme.surface, borderColor: theme.border, borderBottomColor: reportBrandColor || theme.border }]}>
                {(reportBrandLogoUri || brandLogoUri) ? (
                  <Image
                    source={{ uri: reportBrandLogoUri || brandLogoUri }}
                    style={styles.reportPreviewLogo}
                    resizeMode="contain"
                  />
                ) : null}
                <View style={{ flex: 1 }}>
                  {reportCompanyName ? (
                    <Text style={[styles.reportPreviewCompany, { color: theme.textSecondary }]} numberOfLines={1}>
                      {reportCompanyName.toUpperCase()}
                    </Text>
                  ) : null}
                  <Text style={[styles.reportPreviewTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                    {activeReport.title || 'Untitled report'}
                  </Text>
                  <Text style={[styles.reportPreviewMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                    {getLayout(activeReport.layoutType).name}
                    {` · ${cappedPreview.length} ${cappedPreview.length === 1 ? 'photo' : 'photos'}`}
                    {activeReport.generatedAt ? ` · Generated ${new Date(activeReport.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </Text>
                </View>
              </View>

              {/* Layout-aware inline preview — renders the report's
                  content using React Native components so the user
                  can see roughly what the shared file will look like
                  without leaving the app. Inline-HTML preview would
                  need react-native-webview (native module); this is
                  the OTA-able alternative. */}
              {/* Pinch-zoom + pan via nested ScrollView. iOS handles
                  this natively when maximumZoomScale > 1; the user can
                  pinch to zoom and drag to pan once zoomed. Android
                  doesn't pinch-zoom inside a ScrollView so this is a
                  no-op there, but the preview still scrolls via the
                  outer panel ScrollView on both platforms. */}
              <ScrollView
                maximumZoomScale={4}
                minimumZoomScale={1}
                bouncesZoom
                pinchGestureEnabled
                showsHorizontalScrollIndicator={false}
                showsVerticalScrollIndicator={false}
              >
                <ReportPreviewView
                  photos={cappedPreview}
                  layoutId={activeReport.layoutType || 'room-by-room'}
                  options={activeReport.options || {}}
                  displayRoomName={displayRoomName}
                  theme={theme}
                  branding={{
                    brandColor: reportBrandColor,
                    watermarkText: (showWatermark && watermarkText) ? watermarkText : '',
                    labelSettings: reportLabelSettings,
                    watermarkSettings: reportWatermarkSettings,
                    metaSettings: reportMetaSettings,
                    brandLogoSettings: reportBrandLogoSettings,
                  }}
                  onPhotoEdit={handlePhotoEditFromReport}
                />
              </ScrollView>

              {/* Stale banner — shows whenever the user has edited a
                  photo via the pencil affordance since the last
                  generate. Disables Share until they Regenerate so
                  the shared PDF can't drift from the in-app preview. */}
              {reportPreviewStale && (
                <View style={styles.staleBanner}>
                  <Ionicons name="alert-circle-outline" size={18} color="#92400E" />
                  <Text style={styles.staleBannerText}>
                    Photo edits made — regenerate to update the report before sharing.
                  </Text>
                </View>
              )}
              {/* Share/Regenerate action — when stale, the Share
                  button is replaced with Regenerate (calls the same
                  generate path that the editor uses, which clears
                  the stale flag on success). */}
              {reportPreviewStale ? (
                <TouchableOpacity
                  style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent, opacity: isBuildingReport ? 0.7 : 1 }]}
                  onPress={() => {
                    // Pass activeReport's fields as explicit overrides.
                    // setState here wouldn't apply before the async
                    // handleGenerateReport reads editor state via
                    // closure — the report record would collapse to
                    // photoIds=[] + photoCount=1 (initial state).
                    const overrides = activeReport ? {
                      photoIds: activeReport.photoIds || [],
                      photoCount: activeReport.photoCount || (activeReport.photoIds || []).length,
                      title: activeReport.title || '',
                      layoutType: activeReport.layoutType || DEFAULT_LAYOUT_ID,
                      options: activeReport.options || {},
                    } : null;
                    handleGenerateReport(overrides);
                  }}
                  disabled={isBuildingReport || projectPhotos.length === 0}
                  activeOpacity={0.85}
                >
                  {isBuildingReport ? (
                    <ActivityIndicator color={theme.accentText} />
                  ) : (
                    <>
                      <Ionicons name="refresh-outline" size={18} color={theme.accentText} />
                      <Text style={[styles.reportPrimaryBtnText, { color: theme.accentText }]}>Regenerate report</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent, opacity: isBuildingReport ? 0.7 : 1 }]}
                  onPress={() => openReportShareModal(activeReport.id)}
                  disabled={isBuildingReport}
                  activeOpacity={0.85}
                >
                  {isBuildingReport ? (
                    <ActivityIndicator color={theme.accentText} />
                  ) : (
                    <>
                      <Ionicons name="share-outline" size={18} color={theme.accentText} />
                      <Text style={[styles.reportPrimaryBtnText, { color: theme.accentText }]}>Share report</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <Text style={[styles.reportFooterNote, { color: theme.textSecondary }]}>
                Tap "Edit" above and "Regenerate" if photos, title, or style have changed since this was generated.
              </Text>
            </View>
          );
        })()}
        {activeTab === 'share' && (
          <View style={shareTabStyles.container}>
            <Text style={[shareTabStyles.heading, { color: theme.textPrimary }]}>
              {t('projectDetail.shareThisProject')}
            </Text>
            <Text style={[shareTabStyles.subheading, { color: theme.textSecondary }]}>
              {t('projectDetail.shareSubtitle')}
            </Text>

            {canOpenDriveFolder && (
              <TouchableOpacity
                style={[shareTabStyles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border, opacity: driveOpening ? 0.6 : 1 }]}
                onPress={handleOpenProjectDriveFolder}
                disabled={driveOpening}
                activeOpacity={0.85}
              >
                <View style={[shareTabStyles.actionIconWrap, { backgroundColor: COLORS.PRIMARY }]}>
                  <Ionicons name="folder-open-outline" size={26} color="#000" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[shareTabStyles.actionTitle, { color: theme.textPrimary }]}>
                    {driveOpening
                      ? t('projectDetail.openDriveFolderResolving', { defaultValue: 'Opening Google Drive…' })
                      : t('projectDetail.openDriveFolderTitle', { defaultValue: 'Open Google Drive Folder' })}
                  </Text>
                  <Text style={[shareTabStyles.actionSubtitle, { color: theme.textSecondary }]}>
                    {t('projectDetail.openDriveFolderSubtitle', { defaultValue: "Jump to this project's photos on Drive" })}
                  </Text>
                </View>
                {driveOpening ? (
                  <ActivityIndicator size="small" color={theme.textMuted} />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[shareTabStyles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={handleStartShareReportFlow}
              activeOpacity={0.85}
            >
              <View style={[shareTabStyles.actionIconWrap, { backgroundColor: COLORS.PRIMARY }]}>
                <Ionicons name="document-text-outline" size={26} color="#000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[shareTabStyles.actionTitle, { color: theme.textPrimary }]}>
                  {t('projectDetail.shareReportTitle')}
                </Text>
                <Text style={[shareTabStyles.actionSubtitle, { color: theme.textSecondary }]}>
                  {reports && reports.length > 0
                    ? t('projectDetail.shareReportOpen', { name: reports[0].title || t('projectDetail.shareReportFallbackName', { defaultValue: 'your report' }) })
                    : t('projectDetail.shareReportEmpty')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[shareTabStyles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={handleStartSharePhotosFlow}
              activeOpacity={0.85}
            >
              <View style={[shareTabStyles.actionIconWrap, { backgroundColor: COLORS.PRIMARY }]}>
                <Ionicons name="images-outline" size={26} color="#000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[shareTabStyles.actionTitle, { color: theme.textPrimary }]}>
                  {t('projectDetail.sharePhotosTitle')}
                </Text>
                <Text style={[shareTabStyles.actionSubtitle, { color: theme.textSecondary }]}>
                  {t('projectDetail.sharePhotosSubtitle')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
            </TouchableOpacity>

            {project?.crmJobId && project?.crmProvider && (
              <TouchableOpacity
                style={[shareTabStyles.actionCard, { backgroundColor: theme.surface, borderColor: theme.border, opacity: crmBulkUploading ? 0.6 : 1 }]}
                onPress={handleUploadProjectToCrm}
                disabled={crmBulkUploading}
                activeOpacity={0.85}
              >
                <View style={[shareTabStyles.actionIconWrap, { backgroundColor: COLORS.PRIMARY }]}>
                  <Ionicons name="cloud-upload-outline" size={26} color="#000" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[shareTabStyles.actionTitle, { color: theme.textPrimary }]}>
                    {crmBulkUploading ? 'Uploading to Service Flow…' : `Upload to Service Flow (job ${project.crmJobId})`}
                  </Text>
                  <Text style={[shareTabStyles.actionSubtitle, { color: theme.textSecondary }]}>
                    Send every photo in this project to the linked SF job. Idempotent — re-runs only upload new photos.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Report-share format chooser — same UX as the photos
            share modal but operates on the generated report HTML
            file. Each option re-uses the existing share machinery:
            Files = direct Sharing.shareAsync, PDF = lazy-require
            expo-print, ZIP = JSZip wrap of the HTML, Link = upload
            via sharePhotosAsLink with the HTML as the single file. */}
        <Modal
          visible={reportShareModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setReportShareModalVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setReportShareModalVisible(false)}>
            <View style={shareTabStyles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[shareTabStyles.modalContent, { backgroundColor: theme.surface }]}>
                  <View style={shareTabStyles.modalGrabberWrap}>
                    <View style={[shareTabStyles.modalGrabber, { backgroundColor: theme.borderStrong }]} />
                  </View>
                  <View style={shareTabStyles.modalHeader}>
                    <TouchableOpacity onPress={() => setReportShareModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close" size={22} color={theme.textMuted} />
                    </TouchableOpacity>
                    <Text style={[shareTabStyles.modalTitle, { color: theme.textPrimary }]}>
                      Share report
                    </Text>
                  </View>

                  <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary }]}>Share as</Text>
                  <View style={shareTabStyles.pillRow}>
                    {[
                      // Report-share dispatcher. The "files" key still
                      // routes through handleReportShareConfirm's HTML
                      // branch — only the user-facing label changes,
                      // since what gets shared is the raw .html report
                      // file. Renaming "Files" → "HTML" so users know
                      // what the recipient will actually receive.
                      { key: 'files', label: 'HTML' },
                      { key: 'zip', label: 'ZIP' },
                      { key: 'pdf', label: 'PDF' },
                      { key: 'link', label: 'Link' },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={[
                          shareTabStyles.pill,
                          { borderColor: theme.border },
                          reportShareFormat === key && { backgroundColor: COLORS.PRIMARY, borderColor: COLORS.PRIMARY },
                        ]}
                        onPress={() => setReportShareFormat(key)}
                      >
                        <Text style={[shareTabStyles.pillText, { color: theme.textPrimary }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {reportShareFormat === 'link' && (
                    <>
                      <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary, marginTop: 18 }]}>Link via</Text>
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
                            style={[
                              shareTabStyles.providerRow,
                              { backgroundColor: theme.surfaceElevated },
                              shareLinkProvider === p.key && p.connected && { backgroundColor: '#FFF9E0', borderWidth: 1, borderColor: COLORS.PRIMARY },
                            ]}
                            onPress={() => {
                              if (!p.connected) {
                                setReportShareModalVisible(false);
                                navigation.navigate('Settings', { scrollToCloudSync: true });
                                return;
                              }
                              setShareLinkProvider(p.key);
                            }}
                          >
                            <Ionicons name={p.icon} size={20} color={shareLinkProvider === p.key && p.connected ? '#000' : theme.textMuted} />
                            <Text style={[shareTabStyles.providerText, { color: shareLinkProvider === p.key && p.connected ? '#000' : theme.textSecondary }]}>
                              {p.label}
                            </Text>
                            {!p.connected && <Text style={shareTabStyles.providerHint}>Tap to connect</Text>}
                            {shareLinkProvider === p.key && p.connected && (
                              <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                            )}
                          </TouchableOpacity>
                        ));
                      })()}
                    </>
                  )}

                  <TouchableOpacity
                    style={[shareTabStyles.shareNowButton, isBuildingReport && { opacity: 0.6 }]}
                    onPress={handleReportShareConfirm}
                    disabled={isBuildingReport}
                    activeOpacity={0.85}
                  >
                    {isBuildingReport ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator size="small" color="#FFF" />
                        <Text style={shareTabStyles.shareNowButtonText}>Sharing...</Text>
                      </View>
                    ) : (
                      <Text style={shareTabStyles.shareNowButtonText}>
                        {reportShareFormat === 'link' ? 'Generate link' : 'Share'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Format chooser — opens after the user finishes picking
            photos via the Timeline selection flow with
            selectionPurpose==='share'. Same Files/ZIP/PDF/Link options
            as ProjectsScreen but slim (no photo-type pills since the
            user already curated the exact set). */}
        <Modal
          visible={shareFormatModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setShareFormatModalVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShareFormatModalVisible(false)}>
            <View style={shareTabStyles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[shareTabStyles.modalContent, { backgroundColor: theme.surface }]}>
                  <View style={shareTabStyles.modalGrabberWrap}>
                    <View style={[shareTabStyles.modalGrabber, { backgroundColor: theme.borderStrong }]} />
                  </View>
                  <View style={shareTabStyles.modalHeader}>
                    <TouchableOpacity onPress={() => setShareFormatModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close" size={22} color={theme.textMuted} />
                    </TouchableOpacity>
                    <Text style={[shareTabStyles.modalTitle, { color: theme.textPrimary }]}>
                      Share {pendingSharePhotoIds.length} {pendingSharePhotoIds.length === 1 ? 'photo' : 'photos'}
                    </Text>
                  </View>

                  {/* Photo set filter — All vs Combined-only. Mirrors
                      the segmented control style used in the report
                      editor so the two share flows feel consistent. */}
                  <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary }]}>Photos</Text>
                  <View style={shareTabStyles.pillRow}>
                    {[
                      { key: 'all', label: 'All photos' },
                      { key: 'combined', label: 'Only combined' },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={[
                          shareTabStyles.pill,
                          { borderColor: theme.border },
                          sharePhotosFilter === key && { backgroundColor: COLORS.PRIMARY, borderColor: COLORS.PRIMARY },
                        ]}
                        onPress={() => applySharePhotosFilter(key)}
                      >
                        <Text style={[shareTabStyles.pillText, { color: theme.textPrimary }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* Pick photos + Preview links. Pick photos drops
                      into the same timeline selection flow Reports
                      uses (pre-selects the current pending ids).
                      Preview opens PhotoDetail in swipe mode with the
                      current pending set as the pool — user can swipe
                      through, tap the pencil to edit a photo (jumps
                      to StudioDetail), then come back here to share. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 6, marginBottom: 4 }}>
                    <TouchableOpacity
                      onPress={handlePickPhotosForShare}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={[shareTabStyles.pillText, { color: theme.accent, fontWeight: '600' }]}>
                        Pick photos →
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handlePreviewShareSelection}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={pendingSharePhotoIds.length === 0}
                      style={{ opacity: pendingSharePhotoIds.length === 0 ? 0.4 : 1 }}
                    >
                      <Text style={[shareTabStyles.pillText, { color: theme.accent, fontWeight: '600' }]}>
                        Preview →
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Show overlays toggle — when ON, the share flow
                      bakes each photo with the full studio overlay
                      stack (label + watermark + brand logo + meta +
                      markup) before sharing. OFF shares the raw camera
                      files. Defaults to ON so what you preview is
                      what you ship. */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingVertical: 6 }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary, marginTop: 0 }]}>Show overlays</Text>
                      <Text style={[shareTabStyles.pillText, { color: theme.textSecondary, fontSize: 11 }]}>
                        Bake labels, watermark, metadata, brand logo, and markup into each photo.
                      </Text>
                    </View>
                    <Switch
                      value={shareWithOverlays}
                      onValueChange={setShareWithOverlays}
                      trackColor={{ false: '#E0E0E0', true: theme.accent }}
                      thumbColor="#FFFFFF"
                    />
                  </View>

                  <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary, marginTop: 14 }]}>Share as</Text>
                  <View style={shareTabStyles.pillRow}>
                    {[
                      // Project-photos dispatcher. The "files" key
                      // shares the individual JPEG(s) directly through
                      // the system share sheet, so "Pictures" reads
                      // truer to what the recipient receives than the
                      // generic "Files".
                      { key: 'files', label: 'Pictures' },
                      { key: 'zip', label: 'ZIP' },
                      { key: 'pdf', label: 'PDF' },
                      { key: 'link', label: 'Link' },
                    ].map(({ key, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={[
                          shareTabStyles.pill,
                          { borderColor: theme.border },
                          shareFormat === key && { backgroundColor: COLORS.PRIMARY, borderColor: COLORS.PRIMARY },
                        ]}
                        onPress={() => setShareFormat(key)}
                      >
                        <Text style={[shareTabStyles.pillText, { color: theme.textPrimary }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {shareFormat === 'link' && (
                    <>
                      <Text style={[shareTabStyles.sectionLabel, { color: theme.textPrimary, marginTop: 18 }]}>Link via</Text>
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
                            style={[
                              shareTabStyles.providerRow,
                              { backgroundColor: theme.surfaceElevated },
                              shareLinkProvider === p.key && p.connected && { backgroundColor: '#FFF9E0', borderWidth: 1, borderColor: COLORS.PRIMARY },
                            ]}
                            onPress={() => {
                              if (!p.connected) {
                                setShareFormatModalVisible(false);
                                navigation.navigate('Settings', { scrollToCloudSync: true });
                                return;
                              }
                              setShareLinkProvider(p.key);
                            }}
                          >
                            <Ionicons name={p.icon} size={20} color={shareLinkProvider === p.key && p.connected ? '#000' : theme.textMuted} />
                            <Text style={[shareTabStyles.providerText, { color: shareLinkProvider === p.key && p.connected ? '#000' : theme.textSecondary }]}>
                              {p.label}
                            </Text>
                            {!p.connected && <Text style={shareTabStyles.providerHint}>Tap to connect</Text>}
                            {shareLinkProvider === p.key && p.connected && (
                              <Ionicons name="checkmark-circle" size={22} color={COLORS.PRIMARY} style={{ marginLeft: 'auto' }} />
                            )}
                          </TouchableOpacity>
                        ));
                      })()}
                    </>
                  )}

                  <TouchableOpacity
                    style={[shareTabStyles.shareNowButton, (sharing || pendingSharePhotoIds.length === 0) && { opacity: 0.6 }]}
                    onPress={startShareTabSharing}
                    disabled={sharing || pendingSharePhotoIds.length === 0}
                  >
                    {sharing ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator size="small" color="#FFF" />
                        <Text style={shareTabStyles.shareNowButtonText}>{shareStatus || 'Sharing...'}</Text>
                      </View>
                    ) : (
                      <Text style={shareTabStyles.shareNowButtonText}>
                        {pendingSharePhotoIds.length === 0 ? 'No photos selected' : 'Share Now'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </ScrollView>

      {/* Floating "Add to report" bar — only while the user is in
          selection mode on the Timeline. Tap routes through
          handleAddSelectionToReport, which creates a fresh report
          when none exist or pops the add-to-report modal so the
          user can pick between updating an existing report or
          creating a new one. */}
      {selectionMode && activeTab === 'timeline' && (() => {
        const editingReport = selectionEditingReportId
          ? reports.find((r) => r.id === selectionEditingReportId)
          : null;
        const isShareFlow = selectionPurpose === 'share';
        const label = isShareFlow
          ? `Share Selected (${selectionDraft.size})`
          : editingReport
          ? `Save to "${editingReport.title || 'report'}" (${selectionDraft.size})`
          : `Add to report (${selectionDraft.size})`;
        const iconName = isShareFlow
          ? 'share-outline'
          : editingReport ? 'checkmark-circle' : 'add-circle';
        const onPress = isShareFlow ? handleConfirmShareSelection : handleAddSelectionToReport;
        return (
          <View style={[styles.selectionSaveBar, { bottom: insets.bottom + 50 + 8 }]} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.selectionSaveBtn, { backgroundColor: theme.accent }]}
              onPress={onPress}
              activeOpacity={0.85}
              disabled={selectionDraft.size === 0}
            >
              <Ionicons name={iconName} size={18} color={theme.accentText} />
              <Text style={[styles.selectionSaveBtnText, { color: theme.accentText }]} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Enlarged-preview overlay — shows while a Timeline tile is
          held down. Pure read-only viewer, contained inside a Modal
          so it floats above the bottom nav. Tapping the backdrop
          also dismisses (defensive — onPressOut on the tile is the
          primary close path). */}
      <Modal
        visible={!!enlargedPreviewUri}
        transparent
        animationType="fade"
        onRequestClose={() => setEnlargedPreviewUri(null)}
      >
        <TouchableWithoutFeedback onPress={() => setEnlargedPreviewUri(null)}>
          <View style={styles.timelinePreviewBackdrop}>
            {enlargedPreviewUri && (
              <Image
                source={{ uri: enlargedPreviewUri }}
                style={styles.timelinePreviewImage}
                resizeMode="contain"
              />
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Add-to-report picker — appears when the user taps "Add to
          report" while reports already exist. Lists every saved
          report (most recently updated first) plus a "Create new"
          option. Picking a report updates its photoIds and jumps
          to the Report tab editor for that report. */}
      <Modal
        visible={addToReportModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAddToReportModalOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setAddToReportModalOpen(false)}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>Add to report</Text>
          <Text style={[styles.addToReportSubtitle, { color: theme.textSecondary }]}>
            {selectionDraft.size} {selectionDraft.size === 1 ? 'photo' : 'photos'} selected
          </Text>
          <ScrollView style={{ maxHeight: 280 }}>
            {[...reports]
              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
              .map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.addToReportRow, { borderBottomColor: theme.divider }]}
                  onPress={() => updateReportPhotosFromSelection(r.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.addToReportIcon, { backgroundColor: theme.surfaceElevated }]}>
                    <Ionicons name="document-text-outline" size={18} color={theme.textPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.addToReportRowTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                      {r.title || 'Untitled report'}
                    </Text>
                    <Text style={[styles.addToReportRowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      Currently {r.photoIds?.length ?? 0} {r.photoIds?.length === 1 ? 'photo' : 'photos'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              ))}
            <TouchableOpacity
              style={[styles.addToReportRow, { borderBottomColor: theme.divider }]}
              onPress={createReportFromSelection}
              activeOpacity={0.7}
            >
              <View style={[styles.addToReportIcon, { backgroundColor: theme.accent }]}>
                <Ionicons name="add" size={20} color={theme.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.addToReportRowTitle, { color: theme.textPrimary }]}>
                  Create new report
                </Text>
                <Text style={[styles.addToReportRowMeta, { color: theme.textSecondary }]}>
                  Start a fresh report with the selected photos
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={() => setAddToReportModalOpen(false)}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Bottom nav moved to PersistentBottomNav (App.js root). */}

      <Modal
        visible={actionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setActionsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setActionsVisible(false)}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {project.name}
          </Text>
          <TouchableOpacity style={styles.sheetAction} onPress={handleDefaultSettings}>
            <Ionicons name="refresh-outline" size={20} color={theme.textPrimary} />
            <Text style={[styles.sheetActionText, { color: theme.textPrimary }]}>
              Default settings
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetAction} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
            <Text style={[styles.sheetActionText, { color: theme.danger }]}>
              {t('common.delete', { defaultValue: 'Delete project' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={() => setActionsVisible(false)}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Per-photo action sheet — opened from the pencil affordance in
          the report preview. Same bottom-sheet shell as the project
          actions sheet above so the styling is consistent. */}
      <Modal
        visible={!!photoEditMenuPhoto}
        transparent
        animationType="slide"
        onRequestClose={() => setPhotoEditMenuPhoto(null)}
      >
        <TouchableWithoutFeedback onPress={() => setPhotoEditMenuPhoto(null)}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]} numberOfLines={1}>
            {photoEditMenuPhoto?.name || 'Edit photo'}
          </Text>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={() => {
              const p = photoEditMenuPhoto;
              setPhotoEditMenuPhoto(null);
              if (p) {
                setReportPreviewStale(true);
                navigation.navigate('StudioDetail', { photoId: p.id });
              }
            }}
          >
            <Ionicons name="brush-outline" size={20} color={theme.textPrimary} />
            <Text style={[styles.sheetActionText, { color: theme.textPrimary }]}>
              Open in editor
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={async () => {
              const p = photoEditMenuPhoto;
              setPhotoEditMenuPhoto(null);
              if (!p) return;
              try {
                await clearPhotoOverrides(p.id);
                setReportPreviewStale(true);
              } catch (e) {
                console.warn('[ProjectDetail] reset overrides failed:', e?.message);
              }
            }}
          >
            <Ionicons name="refresh-outline" size={20} color={theme.textPrimary} />
            <Text style={[styles.sheetActionText, { color: theme.textPrimary }]}>
              Reset to global
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetAction}
            onPress={() => {
              const p = photoEditMenuPhoto;
              if (p) handleRemovePhotoFromReport(p);
            }}
          >
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
            <Text style={[styles.sheetActionText, { color: theme.danger }]}>
              Remove from report
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={() => setPhotoEditMenuPhoto(null)}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Report template picker — lists user-saved report templates.
          Tap a row to apply (writes layoutType + options into the
          editor draft; user still has to hit Generate to persist).
          Long-press to delete. No shipped presets for reports. */}
      <Modal
        visible={reportTemplatePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setReportTemplatePickerVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setReportTemplatePickerVisible(false)}>
          <View style={styles.sheetBackdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheetContainer, { backgroundColor: theme.surface, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.borderStrong }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>
            {t('report.applyTemplate', { defaultValue: 'Apply template' })}
          </Text>
          {reportTemplates.length === 0 ? (
            <View style={{ paddingHorizontal: 20, paddingVertical: 24 }}>
              <Text style={{ color: theme.textSecondary, fontFamily: 'Alexandria_400Regular', textAlign: 'center' }}>
                {t('report.noTemplates', { defaultValue: 'No saved templates yet. Save the current layout with "Save as template…" first.' })}
              </Text>
            </View>
          ) : (
            reportTemplates.map((tpl) => (
              <TouchableOpacity
                key={tpl.id}
                style={styles.sheetAction}
                onPress={() => {
                  setReportLayoutType(tpl.layoutType || DEFAULT_LAYOUT_ID);
                  setReportOptions({ ...(tpl.options || {}) });
                  setReportPreviewStale(true);
                  setReportTemplatePickerVisible(false);
                }}
                onLongPress={() => {
                  Alert.alert(
                    t('report.template.deleteTitle', { defaultValue: 'Delete template?' }),
                    t('report.template.deleteMessage', { name: tpl.name, defaultValue: `Delete "${tpl.name}"?` }),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('common.delete', { defaultValue: 'Delete' }),
                        style: 'destructive',
                        onPress: async () => {
                          await deleteReportTemplate(tpl.id);
                          try {
                            const list = await listReportTemplates();
                            setReportTemplates(list);
                          } catch (_) {}
                        },
                      },
                    ],
                  );
                }}
              >
                <Ionicons name="albums-outline" size={20} color={theme.textPrimary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.sheetActionText, { color: theme.textPrimary }]} numberOfLines={1}>
                    {tpl.name}
                  </Text>
                  <Text style={{ color: theme.textSecondary, fontFamily: 'Alexandria_400Regular', fontSize: 12 }}>
                    {getLayout(tpl.layoutType || DEFAULT_LAYOUT_ID).name}
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity
            style={[styles.sheetCancel, { backgroundColor: theme.surfaceElevated }]}
            onPress={() => setReportTemplatePickerVisible(false)}
          >
            <Text style={[styles.sheetCancelText, { color: theme.textPrimary }]}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Report save-as-template naming prompt. Centered dialog (the
          bottom-sheet form hid the input behind the keyboard). */}
      <Modal
        visible={reportTemplateSaveVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportTemplateSaveVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback onPress={() => setReportTemplateSaveVisible(false)}>
            <View style={StyleSheet.absoluteFill}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
            </View>
          </TouchableWithoutFeedback>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }} pointerEvents="box-none">
            <View
              style={{
                width: '100%',
                maxWidth: 380,
                backgroundColor: theme.surfaceElevated || theme.surface,
                borderColor: theme.border,
                borderWidth: StyleSheet.hairlineWidth,
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingTop: 16,
                paddingBottom: 12,
              }}
            >
              <Text style={[styles.sheetTitle, { color: theme.textPrimary, marginBottom: 10, paddingHorizontal: 0 }]}>
                {t('report.template.namePromptTitle', { defaultValue: 'Name this template' })}
              </Text>
              <TextInput
                value={reportTemplateNameDraft}
                onChangeText={setReportTemplateNameDraft}
                placeholder={t('report.template.namePlaceholder', { defaultValue: 'e.g. Standard Handoff Report' })}
                placeholderTextColor={theme.textMuted || theme.textSecondary}
                autoFocus
                selectionColor={theme.accent}
                returnKeyType="done"
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: theme.accent,
                  backgroundColor: theme.surface,
                  color: theme.textPrimary,
                  fontFamily: 'Alexandria_400Regular',
                  fontSize: 16,
                  marginBottom: 14,
                }}
                onSubmitEditing={async () => {
                  const name = (reportTemplateNameDraft || '').trim();
                  if (!name) return;
                  try {
                    await saveReportTemplate({ name, layoutType: reportLayoutType, options: reportOptions });
                    setReportTemplateSaveVisible(false);
                    setReportTemplateNameDraft('');
                  } catch (e) {
                    Alert.alert('Error', e.message || 'Could not save template.');
                  }
                }}
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                    alignItems: 'center',
                  }}
                  onPress={() => setReportTemplateSaveVisible(false)}
                >
                  <Text style={{ color: theme.textSecondary, fontFamily: 'Alexandria_400Regular', fontSize: 15 }}>
                    {t('common.cancel', { defaultValue: 'Cancel' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    backgroundColor: theme.accent,
                    alignItems: 'center',
                    opacity: (reportTemplateNameDraft || '').trim() ? 1 : 0.5,
                  }}
                  disabled={!(reportTemplateNameDraft || '').trim()}
                  onPress={async () => {
                    const name = (reportTemplateNameDraft || '').trim();
                    if (!name) return;
                    try {
                      await saveReportTemplate({ name, layoutType: reportLayoutType, options: reportOptions });
                      setReportTemplateSaveVisible(false);
                      setReportTemplateNameDraft('');
                    } catch (e) {
                      Alert.alert('Error', e.message || 'Could not save template.');
                    }
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontFamily: 'Alexandria_400Regular', fontSize: 15, fontWeight: '700' }}>
                    {t('common.save', { defaultValue: 'Save' })}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 17,
    fontWeight: '600',
    marginHorizontal: 12,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tabText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  // Sub-tab strip under the "Photos" top tab. Sits inside the scroll
  // container (not the fixed header), so it scrolls out of view once
  // the user is deep in a long grid — same behavior as other page-
  // level filters. Pill style is intentionally quieter than the top-
  // level tabs so the hierarchy reads: top tab (loud) → sub tab (soft).
  photosSubTabsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  photosSubTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  photosSubTabText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  // Right side of the selection banner — hosts Delete (shown only
  // when selection > 0) + Cancel, with a small gap so they don't
  // collide when both are visible.
  selectionBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
  },
  dateSection: {
    marginBottom: 24,
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  dateLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
  dateMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
  },
  dateSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dateSelectCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Container for each room within a date. Stacks a small header
  // (room name + count metadata) above a grid of set tiles, with a
  // little vertical breathing room between rooms.
  roomBlock: {
    marginBottom: 14,
  },
  roomBlockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  roomBlockName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  roomBlockMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '500',
  },
  roomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  roomTile: {
    width: '31.8%',
  },
  // Single-row horizontal scroller — one room's set tiles all live
  // on the same line; overflow scrolls horizontally instead of
  // wrapping to a second row.
  roomRow: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 4,
  },
  // Tile in the row uses a fixed width so multiple sets line up
  // crisply and the horizontal scroll snaps cleanly.
  roomRowTile: {
    width: 110,
  },
  // Timeline date section — 4-column grid of photo tiles. flexWrap
  // hops to the next row every four items; the smaller `gap` keeps
  // the tiles compact enough that four fit on a typical phone width
  // (4 × 23 % = 92 %, leaving 8 % for the three 8 px gaps).
  timelineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // 23 % per tile so 4 fit per row across phone widths even after
  // accounting for the 3 × 8 px column gaps.
  timelineGridTile: {
    width: '23%',
  },
  // Vertical room-block inside a date section. Each room renders a
  // header + its own 4-column photo grid stacked beneath. Rooms
  // chain top-to-bottom in capture order, so the date reads
  // chronologically room-by-room.
  timelineRoomBlock: {
    marginBottom: 12,
  },
  timelineRoomHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  timelineRoomName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  timelineRoomMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '500',
  },
  // Small "Select photos" pill that anchors the entry point for
  // selection mode (long-press is reserved for the enlarged
  // preview). Aligned right so it sits in thumb reach.
  timelineSelectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-end',
    marginBottom: 10,
  },
  timelineSelectPillText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
  },
  // Long-press preview overlay — fills the screen with a near-
  // black backdrop and centers the photo. resizeMode=contain so
  // the user sees the entire image regardless of aspect ratio.
  timelinePreviewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelinePreviewImage: {
    width: '95%',
    height: '85%',
  },
  // Tile thumbnail — square, filling the tile's width so all three
  // columns line up visually regardless of source aspect ratio.
  timelineGridThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    marginBottom: 4,
  },
  // Wraps the thumbnail so the selection-check overlay can position
  // itself absolutely inside the tile's image rectangle without
  // bleeding over the set / room labels below.
  timelineGridThumbWrap: {
    position: 'relative',
  },
  // Top-right selection check overlay — visible only in selection
  // mode. Filled when the tile is in the draft; hollow over a dark
  // scrim otherwise.
  timelineSelectCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Dim layer applied to deselected tiles so the active selection
  // pops visually.
  timelineDeselectScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 8,
  },
  // Inline banner at the top of the Timeline tab while the user is
  // mid-selection. Hosts the Select-all checkbox + a Cancel exit.
  selectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  selectionBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionBannerText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  selectionBannerCancel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  // Floating Save-to-project bar — only renders during selection
  // mode. Centered horizontally; bottom inset is computed inline
  // so it sits just above the persistent bottom nav.
  selectionSaveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 50,
  },
  selectionSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  selectionSaveBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  roomTileThumb: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    marginBottom: 6,
  },
  roomTilePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomTileName: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
  },
  roomTileCount: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 1,
  },
  roomTileMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    marginTop: 2,
  },
  // Report tab — vertical stack of editable inputs / toggles followed
  // by the Generate & share primary button.
  reportPanel: {
    gap: 12,
    paddingTop: 4,
  },
  // Card in the Reports list view (one per saved report).
  reportListCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportListCardBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportListDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  // Preview-view header card — title + meta + optional logo.
  // Mirrors the HTML headerHtml so the in-app preview's title block
  // matches the rendered PDF: logo on the left, company name in a
  // small uppercase label above the title, and a brand-coloured
  // bottom border.
  reportPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 2,
  },
  reportPreviewLogo: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  reportPreviewCompany: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  reportPreviewTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '800',
  },
  reportPreviewMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
  // Per-card action row holding Share / Duplicate / Delete buttons.
  // Sits to the right of the tile body inside the card so the user
  // doesn't have to long-press or swipe to discover the actions.
  reportListActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reportListActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  // Editor header — back link + delete; sits above the form so the
  // user can return to the list at any time.
  reportEditorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  reportEditorBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reportEditorBackText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '700',
  },
  // Add-to-report picker (modal sheet) rows.
  addToReportSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 10,
  },
  addToReportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addToReportIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToReportRowTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  addToReportRowMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
  reportSectionLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginTop: 6,
  },
  // Section header row that holds the SECTION label on the left and
  // an inline action link on the right (e.g. "Pick photos →").
  // No marginTop here — the inner label already provides it.
  reportSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportSectionLink: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  reportInput: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportLogoThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
  },
  reportLogoText: {
    flex: 1,
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  reportRowLabel: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '600',
  },
  reportRowSubtle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    marginTop: 2,
  },
  reportStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportStepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportAllBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '700',
  },
  reportPrimaryBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 100,
  },
  reportPrimaryBtnText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
    fontWeight: '700',
  },
  reportFooterNote: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
    textAlign: 'center',
  },
  // Warning banner above Share when per-photo edits have happened
  // since the last generate. Amber so it reads as "attention needed"
  // without being alarming.
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  staleBannerText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    lineHeight: 16,
    color: '#92400E',
    flex: 1,
  },
  reportPreparingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginTop: 8,
  },
  reportPreparingTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 16,
    fontWeight: '700',
  },
  reportPreparingSub: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  // Location tab — list of distinct location strings aggregated from
  // the project's photos. Each entry is a card with an icon, the
  // location string, and the most recent capture date.
  locationList: {
    gap: 10,
    paddingTop: 4,
  },
  locationsScopeRow: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  locationsScopeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationsScopeText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 13,
    fontWeight: '600',
  },
  // Inline MapView at the top of the Location tab. Tall enough to
  // give the user a real overview but bounded so the location card
  // list still fits underneath without scrolling for short projects.
  locationMap: {
    width: '100%',
    height: 240,
    borderRadius: 12,
  },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  locationCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCardTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    fontWeight: '700',
  },
  locationCardMeta: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  locationCardLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  locationCardLocationText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    lineHeight: 16,
  },
  stubState: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 12,
  },
  stubTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 18,
    fontWeight: '700',
  },
  stubSubtitle: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  missingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  missingText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 15,
  },
  bottomNavPill: {
    position: 'absolute',
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
    height: 50,
  },
  navItemActive: {
    backgroundColor: '#E0E0E0',
    borderRadius: 100,
    marginHorizontal: -7,
  },
  navItemImage: { width: 22, height: 22 },
  navItemText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 10,
    fontWeight: '510',
    color: '#1E1E1E',
    marginTop: 1,
    textAlign: 'center',
    letterSpacing: -0.1,
    lineHeight: 12,
  },
  navItemTextActive: { fontWeight: '590' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
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
});

const shareTabStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 14,
    marginBottom: 20,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  actionIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  modalGrabberWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  modalGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    marginTop: 8,
  },
  sublabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
    marginTop: 12,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 30,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  providerText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONTS.ALEXANDRIA,
  },
  providerHint: {
    fontSize: 12,
    fontFamily: FONTS.ALEXANDRIA,
    color: '#CC0000',
    marginLeft: 'auto',
  },
  advancedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  shareNowButton: {
    marginTop: 24,
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
});

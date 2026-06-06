import React, { useState, useMemo, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { usePhotos } from '../context/PhotoContext';

// Storage key for the report's selected photo ids — legacy, retained
// so the Default-settings reset can still wipe it cleanly when an
// older version's single-selection lingers. New writes go to the
// `reports` list below.
const reportSelectionKey = (projectId) => `project:${projectId}:reportPhotoIds`;

// Storage key for the project's reports list. Each report is a saved
// configuration the user can re-open, update, or generate later:
//   { id, title, photoIds, photoCount, includeNotes, includeMap,
//     createdAt, updatedAt, generatedFilePath?, generatedAt? }
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

const TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'location', label: 'Location' },
  { key: 'report', label: 'Report' },
  { key: 'share', label: 'Share' },
];

const formatDateLabel = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Date-section view: each day surfaces every photo taken on that day
// as its own tile. Set membership is computed per (room, date) so each
// photo carries the set label it belongs to ("Set 1", "Set 2" …) —
// the user wanted the full photo stream, not a roll-up of sets. Tiles
// stay in capture order so the day reads chronologically left-to-right.
const tsOfPhoto = (photo) =>
  typeof photo?.timestamp === 'number'
    ? photo.timestamp
    : (photo?.createdAt ? new Date(photo.createdAt).getTime() : 0);

const buildTimeline = (photos) => {
  const byDate = new Map();
  for (const photo of photos) {
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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { projects, getPhotosByProject, deleteProject, activeProjectId, setActiveProject, updatePhoto } = usePhotos();
  const {
    getRooms,
    showLabels,
    toggleLabels,
    updateShowWatermark,
    togglePreviewMetadata,
    updateShowBrandLogo,
    brandLogoUri,
    location,
  } = useSettings();
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
  const [actionsVisible, setActionsVisible] = useState(false);
  // Report tab state — see the Report panel further down for usage.
  // `reportTitle` is seeded from project name + global location once the
  // project is resolved; user can edit. `reportPhotoCount` is the max
  // number of photos to include (capped at the project's total).
  // `reportIncludeNotes` toggles note text below each photo.
  // `reportIncludeMap` is wired but disabled — implementation comes
  // later. `isBuildingReport` blocks the button while we compose.
  const [reportTitle, setReportTitle] = useState('');
  const [reportPhotoCount, setReportPhotoCount] = useState(0);
  const [reportIncludeNotes, setReportIncludeNotes] = useState(true);
  const [reportIncludeMap, setReportIncludeMap] = useState(false);
  const [isBuildingReport, setIsBuildingReport] = useState(false);

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
        const raw = await AsyncStorage.getItem(reportsKey(project.id));
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
      try { await AsyncStorage.setItem(reportsKey(project.id), JSON.stringify(next)); } catch (_) {}
    }
  };

  // The active report's saved photo ids (or empty set when no active
  // report). Drives the editor's photo pool and the Generate flow.
  const activeReport = useMemo(
    () => reports.find((r) => r.id === activeReportId) || null,
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

  // When entering the editor — either with an existing report or
  // a fresh draft — seed the form inputs + the editorPhotoIds draft
  // pool. Edits in the form stay LOCAL (no auto-save) until the
  // user hits Generate; that's the only commit point now.
  useEffect(() => {
    if (reportViewMode !== 'editor') return;
    if (activeReport) {
      // Editing an existing report — load its fields into the form.
      setReportTitle(activeReport.title || '');
      setReportPhotoCount(activeReport.photoCount || (activeReport.photoIds?.length ?? 0));
      setReportIncludeNotes(activeReport.includeNotes !== false);
      setReportIncludeMap(!!activeReport.includeMap);
      setEditorPhotoIds(activeReport.photoIds || []);
    } else {
      // New draft — sensible defaults that don't touch the reports
      // list yet. The next sequence number is derived from the
      // current list length so the user sees a unique title hint.
      const idx = reports.length + 1;
      const baseTitle = [project?.name || 'Report', `#${idx}`].join(' ');
      setReportTitle(baseTitle);
      setReportPhotoCount(projectPhotos.length);
      setReportIncludeNotes(true);
      setReportIncludeMap(false);
      setEditorPhotoIds(projectPhotos.map((p) => p.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportViewMode, activeReportId]);
  const timelineGroups = useMemo(() => buildTimeline(projectPhotos), [projectPhotos]);

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
  const cancelSelectionMode = () => {
    setSelectionMode(false);
    setSelectionDraft(new Set());
    setSelectionEditingReportId(null);
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
      setSelectionDraft(new Set(r.photoIds || []));
    } else {
      // No persisted report yet (the editor is on a fresh draft).
      // Use the in-memory editorPhotoIds as the starting set; fall
      // back to all project photos when the draft is empty (e.g. the
      // useEffect that seeds editorPhotoIds hasn't run yet because
      // the user tapped "Pick photos" before the editor had a chance
      // to populate the field). Mark that Save should write back into
      // the draft, not create a new report.
      setSelectionEditingReportId(null);
      setSelectionEditingDraft(true);
      const seedIds = (editorPhotoIds && editorPhotoIds.length > 0)
        ? editorPhotoIds
        : projectPhotos.map((p) => p.id);
      setSelectionDraft(new Set(seedIds));
    }
    setSelectionMode(true);
    setReportViewMode('list');
    setActiveTab('timeline');
  };
  const togglePhotoSelected = (photoId) => {
    setSelectionDraft((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const allSelected = projectPhotos.length > 0 && selectionDraft.size === projectPhotos.length;
    if (allSelected) setSelectionDraft(new Set());
    else setSelectionDraft(new Set(projectPhotos.map((p) => p.id)));
  };
  const toggleSelectByDate = (dateKey) => {
    const group = timelineGroups.find((g) => g.dateKey === dateKey);
    if (!group) return;
    const datePhotoIds = group.rooms.flatMap((r) => r.photoTiles.map((t) => t.id));
    const allSelected = datePhotoIds.length > 0 && datePhotoIds.every((id) => selectionDraft.has(id));
    setSelectionDraft((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        datePhotoIds.forEach((id) => next.delete(id));
      } else {
        datePhotoIds.forEach((id) => next.add(id));
      }
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
      includeNotes: true,
      includeMap: false,
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
  const fileToDataUri = async (uri, mime = 'image/jpeg') => {
    if (!uri) return null;
    try {
      // Strip the file:// prefix so FileSystem reads consistently
      // across iOS / Android.
      const path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
      const b64 = await FileSystem.readAsStringAsync(path, { encoding: 'base64' });
      return `data:${mime};base64,${b64}`;
    } catch (_) {
      return null;
    }
  };

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Build the report's HTML body. Self-contained — embeds the logo +
  // every photo as data URIs so opening the file in Safari → Print →
  // Save as PDF produces the full report end-to-end. When we add
  // expo-print in a later native build, this same HTML string can be
  // fed to Print.printToFileAsync({ html }) for a true PDF.
  const buildReportHtml = async ({ title, photos, includeNotes, logoUri }) => {
    const logoData = logoUri ? await fileToDataUri(logoUri, 'image/png') : null;
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });

    const photoChunks = await Promise.all(photos.map(async (p) => {
      const data = await fileToDataUri(p.uri);
      const note = includeNotes && p?.notes ? p.notes : '';
      const ts = typeof p.timestamp === 'number'
        ? p.timestamp
        : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
      const dateLabel = ts
        ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      const roomName = displayRoomName(p.room || '');
      return `
        <div class="photo">
          ${data ? `<img src="${data}" alt="" />` : `<div class="missing">Image unavailable</div>`}
          <div class="meta">
            <div class="meta-line">${escapeHtml(roomName)}${dateLabel ? ` &middot; ${escapeHtml(dateLabel)}` : ''}</div>
            ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
          </div>
        </div>
      `;
    }));

    return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; color: #1A1A1A; background: #FFFFFF; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #1A1A1A; padding-bottom: 14px; margin-bottom: 18px; }
  header img.logo { max-height: 60px; max-width: 160px; object-fit: contain; }
  header .header-text { flex: 1; }
  h1 { font-size: 22px; margin: 0; }
  .meta-subtitle { color: #555; font-size: 12px; margin-top: 4px; }
  .photo { page-break-inside: avoid; margin-bottom: 22px; border: 1px solid #E5E5E5; border-radius: 8px; overflow: hidden; }
  .photo img { width: 100%; display: block; }
  .photo .missing { padding: 40px; text-align: center; background: #F3F3F3; color: #999; }
  .photo .meta { padding: 8px 12px; }
  .meta-line { font-size: 11px; color: #555; }
  .note { margin-top: 6px; font-size: 13px; color: #1A1A1A; white-space: pre-wrap; }
  footer { margin-top: 18px; font-size: 10px; color: #888; text-align: center; }
</style>
</head><body>
<header>
  ${logoData ? `<img class="logo" src="${logoData}" alt="" />` : ''}
  <div class="header-text">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta-subtitle">Generated ${escapeHtml(today)} &middot; ${photos.length} photo${photos.length === 1 ? '' : 's'}</div>
  </div>
</header>
${photoChunks.join('\n')}
<footer>Created with ProofPix.app</footer>
</body></html>`;
  };

  // Build a report's HTML, save it to persistent storage, and patch
  // the report record with the file path + timestamp. Returns the
  // saved file path (or null on failure). The actual share is done
  // by handleShareReport, which calls this when a regenerate is
  // needed.
  const generateReportFile = async (report) => {
    if (!report || !project) return null;
    const pool = (report.photoIds && report.photoIds.length > 0)
      ? projectPhotos.filter((p) => report.photoIds.includes(p.id))
      : projectPhotos;
    const sorted = [...pool].sort((a, b) => {
      const at = typeof a.timestamp === 'number' ? a.timestamp : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bt = typeof b.timestamp === 'number' ? b.timestamp : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return at - bt;
    });
    const cap = Math.max(1, Math.min(report.photoCount || sorted.length, sorted.length));
    const chosen = sorted.slice(0, cap);
    const html = await buildReportHtml({
      title: report.title?.trim() || project.name,
      photos: chosen,
      includeNotes: report.includeNotes !== false,
      logoUri: brandLogoUri,
    });
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
    // Patch the report record so future shares can skip regenerate.
    await patchReport(report.id, {
      generatedFilePath: target,
      generatedAt: Date.now(),
    });
    return target;
  };

  // Share a report — uses the cached generated file when it still
  // exists on disk; regenerates and writes a fresh one otherwise.
  // Set `forceRegenerate` to true for the editor's "Generate & share"
  // button (the user explicitly wants the latest content).
  const handleShareReport = async (reportId, { forceRegenerate = false } = {}) => {
    if (!project) return;
    if (isBuildingReport) return;
    setIsBuildingReport(true);
    try {
      const r = reports.find((rr) => rr.id === reportId);
      if (!r) return;
      let target = r.generatedFilePath;
      let needsRegenerate = forceRegenerate || !target;
      if (target && !needsRegenerate) {
        try {
          const info = await FileSystem.getInfoAsync(target);
          if (!info.exists) needsRegenerate = true;
        } catch (_) {
          needsRegenerate = true;
        }
      }
      if (needsRegenerate) {
        target = await generateReportFile(r);
      }
      if (!target) {
        Alert.alert('Could not share', 'No file produced.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(target, {
          mimeType: 'text/html',
          UTI: 'public.html',
          dialogTitle: 'Share report',
        });
      } else {
        Alert.alert('Saved', `Report saved to ${target}`);
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
  const handleGenerateReport = async () => {
    if (!project || projectPhotos.length === 0) {
      Alert.alert('No photos', 'This project has no photos to put in a report.');
      return;
    }
    if (isBuildingReport) return;
    setIsBuildingReport(true);
    try {
      const ts = Date.now();
      const draftIds = Array.isArray(editorPhotoIds) ? editorPhotoIds : [];
      const baseTitle = (reportTitle || '').trim() || project.name || 'Report';
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
                photoCount: Math.max(1, Math.min(reportPhotoCount || draftIds.length, draftIds.length || 1)),
                includeNotes: reportIncludeNotes,
                includeMap: reportIncludeMap,
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
          photoCount: Math.max(1, Math.min(reportPhotoCount || draftIds.length, draftIds.length || 1)),
          includeNotes: reportIncludeNotes,
          includeMap: reportIncludeMap,
          createdAt: ts,
          updatedAt: ts,
        };
        targetReportId = newReport.id;
        nextReports = [...reports, newReport];
      }
      await persistReports(nextReports);
      // generateReportFile reads from the reports list, so wait
      // a tick for state to settle before passing the target.
      const committedReport = nextReports.find((r) => r.id === targetReportId);
      await generateReportFile(committedReport);
      setActiveReportId(targetReportId);
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
                  for (const r of reports) {
                    if (r?.generatedFilePath) {
                      try { await FileSystem.deleteAsync(r.generatedFilePath, { idempotent: true }); } catch (_) {}
                    }
                  }
                  try { await AsyncStorage.removeItem(reportsKey(project.id)); } catch (_) {}
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
                {tab.label}
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
                    Select photos
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
                    <TouchableOpacity onPress={cancelSelectionMode} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={[styles.selectionBannerCancel, { color: theme.textSecondary }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
              {timelineGroups.map((group) => {
                const datePhotoIds = group.rooms.flatMap((r) => r.photoTiles.map((t) => t.id));
                const allDateSelected = selectionMode && datePhotoIds.length > 0 && datePhotoIds.every((id) => selectionDraft.has(id));
                return (
              <View key={group.dateKey} style={styles.dateSection}>
                <View style={styles.dateHeader}>
                  <Text style={[styles.dateLabel, { color: theme.textPrimary }]}>
                    {formatDateLabel(group.ts)}
                  </Text>
                  {selectionMode ? (
                    <TouchableOpacity
                      onPress={() => toggleSelectByDate(group.dateKey)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.dateSelectBtn}
                    >
                      <View style={[
                        styles.dateSelectCheck,
                        {
                          backgroundColor: allDateSelected ? theme.accent : 'transparent',
                          borderColor: allDateSelected ? theme.accent : theme.borderStrong,
                        },
                      ]}>
                        {allDateSelected && (
                          <Ionicons name="checkmark" size={11} color={theme.accentText} />
                        )}
                      </View>
                      <Text style={[styles.dateSelectText, { color: allDateSelected ? theme.accent : theme.textSecondary }]}>
                        {allDateSelected ? 'Deselect date' : 'Select date'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                  <Text style={[styles.dateMeta, { color: theme.textSecondary }]}>
                    {group.totalPhotos} {group.totalPhotos === 1 ? 'photo' : 'photos'}
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
                        {room.photoCount} {room.photoCount === 1 ? 'photo' : 'photos'}
                        {room.setCount > 1 ? ` · ${room.setCount} sets` : ''}
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
                              Set {tile.setIndex}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
              );
              })}
            </>
          )
        )}
        {activeTab === 'location' && (() => {
          // Two passes over project photos:
          //   1. Collect distinct location STRINGS (text-only — what
          //      we surfaced before).
          //   2. Collect photos with GPS coordinates so a MapView
          //      can drop a marker per coordinate.
          // Coordinates start populating once new captures store
          // lat/lng on the photo record (camera flow integration
          // ships alongside this UI).
          const seen = new Map();
          const gpsPoints = [];
          for (const p of projectPhotos) {
            const where = (p?.location || '').toString().trim();
            const ts = typeof p?.timestamp === 'number'
              ? p.timestamp
              : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
            if (where) {
              const existing = seen.get(where);
              if (!existing || ts > existing) seen.set(where, ts);
            }
            const lat = typeof p?.lat === 'number' ? p.lat : (typeof p?.latitude === 'number' ? p.latitude : null);
            const lng = typeof p?.lng === 'number' ? p.lng : (typeof p?.longitude === 'number' ? p.longitude : null);
            if (lat != null && lng != null) {
              gpsPoints.push({ id: p.id, lat, lng, uri: p.uri, ts, where: where || null });
            }
          }
          const entries = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
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
          if (entries.length === 0 && !hasMap) {
            return (
              <View style={styles.stubState}>
                <Ionicons name="location-outline" size={40} color={theme.textMuted} />
                <Text style={[styles.stubTitle, { color: theme.textPrimary }]}>No locations yet</Text>
                <Text style={[styles.stubSubtitle, { color: theme.textSecondary }]}>
                  Locations + GPS pins captured with your photos will appear here.
                </Text>
              </View>
            );
          }
          return (
            <View style={styles.locationList}>
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
              {entries.map(([where, ts]) => (
                <View
                  key={where}
                  style={[styles.locationCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                >
                  <View style={[styles.locationCardIcon, { backgroundColor: theme.surfaceElevated }]}>
                    <Ionicons name="location" size={18} color={theme.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.locationCardTitle, { color: theme.textPrimary }]}
                      numberOfLines={2}
                    >
                      {where}
                    </Text>
                    {ts > 0 && (
                      <Text style={[styles.locationCardMeta, { color: theme.textSecondary }]}>
                        Most recent: {new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
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
                New report
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
                            {r.photoIds?.length ?? 0} {r.photoIds?.length === 1 ? 'photo' : 'photos'}
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
                          onPress={() => handleShareReport(r.id)}
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

              {/* Logo preview — only when a brand logo is configured. */}
              {brandLogoUri && (
                <View style={[styles.reportLogoRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                  <Image source={{ uri: brandLogoUri }} style={styles.reportLogoThumb} resizeMode="contain" />
                  <Text style={[styles.reportLogoText, { color: theme.textSecondary }]}>
                    Brand logo will appear in the report header
                  </Text>
                </View>
              )}

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

              {/* Include notes toggle — draft only; persisted on
                  Generate. */}
              <View style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>Include notes</Text>
                <Switch
                  value={reportIncludeNotes}
                  onValueChange={setReportIncludeNotes}
                  trackColor={{ false: '#E0E0E0', true: theme.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Include map — wired but disabled. The check below
                  short-circuits the toggle so the visual state stays
                  off until the implementation lands in a later pass. */}
              <View style={[styles.reportRow, { backgroundColor: theme.surface, borderColor: theme.border, opacity: 0.55 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.reportRowLabel, { color: theme.textPrimary }]}>Include map</Text>
                  <Text style={[styles.reportRowSubtle, { color: theme.textSecondary }]}>Coming soon</Text>
                </View>
                <Switch
                  value={reportIncludeMap}
                  onValueChange={() => {}}
                  disabled
                  trackColor={{ false: '#E0E0E0', true: theme.accent }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {/* Generate — commits the draft (new record on first
                  generate, or update on subsequent), builds the
                  HTML file, then jumps to the preview view where
                  the user can share. */}
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
                Report exports as a self-contained HTML file. Open it in Safari → Share → Print → Save as PDF to send a polished PDF version. Native PDF export ships in the next update.
              </Text>
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
              {/* Preview header — back link + Edit shortcut. */}
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
              <View style={[styles.reportPreviewHeader, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                {brandLogoUri && (
                  <Image source={{ uri: brandLogoUri }} style={styles.reportPreviewLogo} resizeMode="contain" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.reportPreviewTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                    {activeReport.title || 'Untitled report'}
                  </Text>
                  <Text style={[styles.reportPreviewMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                    {cappedPreview.length} {cappedPreview.length === 1 ? 'photo' : 'photos'}
                    {activeReport.includeNotes === false ? '' : ' · notes'}
                    {activeReport.generatedAt ? ` · Generated ${new Date(activeReport.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </Text>
                </View>
              </View>

              {/* Photo grid preview — 4 cols, same layout the share
                  output uses (stacked per page). Read-only; tapping
                  a tile is a no-op here. */}
              <View style={styles.timelineGrid}>
                {cappedPreview.map((p) => (
                  <View key={`preview-${p.id}`} style={styles.timelineGridTile}>
                    {p.uri ? (
                      <Image source={{ uri: p.uri }} style={styles.timelineGridThumb} />
                    ) : (
                      <View style={[styles.timelineGridThumb, styles.roomTilePlaceholder, { backgroundColor: theme.surfaceElevated }]}>
                        <Ionicons name="image-outline" size={28} color={theme.textMuted} />
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* Share action — re-uses the cached HTML file if
                  it's still on disk; regenerates only when missing. */}
              <TouchableOpacity
                style={[styles.reportPrimaryBtn, { backgroundColor: theme.accent, opacity: isBuildingReport ? 0.7 : 1 }]}
                onPress={() => handleShareReport(activeReport.id)}
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
              <Text style={[styles.reportFooterNote, { color: theme.textSecondary }]}>
                Reusing the saved file. Tap "Edit" above and "Regenerate" if the photos or title have changed since this report was last generated.
              </Text>
            </View>
          );
        })()}
        {activeTab === 'share' && (
          <View style={styles.stubState}>
            <Ionicons name="share-social-outline" size={40} color={theme.textMuted} />
            <Text style={[styles.stubTitle, { color: theme.textPrimary }]}>Share</Text>
            <Text style={[styles.stubSubtitle, { color: theme.textSecondary }]}>
              PDF, link, photos, and ZIP options coming soon.
            </Text>
          </View>
        )}
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
        const label = editingReport
          ? `Save to "${editingReport.title || 'report'}" (${selectionDraft.size})`
          : `Add to report (${selectionDraft.size})`;
        return (
          <View style={[styles.selectionSaveBar, { bottom: insets.bottom + 50 + 8 }]} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.selectionSaveBtn, { backgroundColor: theme.accent }]}
              onPress={handleAddSelectionToReport}
              activeOpacity={0.85}
              disabled={selectionDraft.size === 0}
            >
              <Ionicons name={editingReport ? 'checkmark-circle' : 'add-circle'} size={18} color={theme.accentText} />
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
    gap: 5,
  },
  dateSelectCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSelectText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 12,
    fontWeight: '600',
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
  reportPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportPreviewLogo: {
    width: 48,
    height: 48,
    borderRadius: 8,
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
  // Location tab — list of distinct location strings aggregated from
  // the project's photos. Each entry is a card with an icon, the
  // location string, and the most recent capture date.
  locationList: {
    gap: 10,
    paddingTop: 4,
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

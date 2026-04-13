import React, { useState, useEffect, useRef } from 'react';
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
  Switch,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { useAdmin } from '../context/AdminContext';
import { COLORS, TEMPLATE_CONFIGS, TEMPLATE_TYPES, PHOTO_MODES } from '../constants/rooms';
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
import dropboxAuthService from '../services/dropboxAuthService';

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

export default function ProjectsScreen({ navigation }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    projects,
    getPhotosByProject,
    deleteProject,
    setActiveProject,
    activeProjectId,
    createProject,
    photos,
  } = usePhotos();
  
  const { userName, userPlan, updateUserPlan, location, updateUserInfo, showLabels, useFolderStructure, enabledFolders } = useSettings();
  const { userMode, isAuthenticated, folderId, proxySessionId, initializeProxySession, accountType } = useAdmin();
  const { exceedsLimit, canUse } = useFeaturePermissions();
  const { uploadStatus, startBackgroundUpload, cancelUpload, cancelAllUploads, clearCompletedUploads } = useBackgroundUpload();
  const isTeamMember = userMode === 'team_member' || userPlan === 'team' || userPlan === 'Team Member';

  const [newProjectVisible, setNewProjectVisible] = useState(false);
  const [newProjectNamePart, setNewProjectNamePart] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState(location);
  const [locationLoadingInModal, setLocationLoadingInModal] = useState(false);
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
  const [shareAsArchive, setShareAsArchive] = useState(false);
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
      navigation.navigate('PlanSelection');
      return;
    }

    const fullName = createAlbumName(namePart, new Date(), null, newProjectLocation || getLocationName(location));
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
      const project = await createProject(finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_'));
      logProjectCreated();
      setNewProjectNamePart('');
      setNewProjectVisible(false);
      setActiveProject(project.id);
      navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] });
    } catch (e) {
      Alert.alert(t('common.error'), e?.message || t('projects.createError'));
    } finally {
      setCreating(false);
    }
  };

  const handleUseCurrentLocationInModal = async () => {
    setLocationLoadingInModal(true);
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('settings.locationPermissionTitle', { defaultValue: 'Location access' }),
          t('settings.locationPermissionMessage', { defaultValue: 'Permission to use location is required to set folder location from GPS.' }),
          [{ text: 'OK', style: 'cancel' }]
        );
        return;
      }
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });
      const [address] = await ExpoLocation.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const locationDisplay = address?.city || address?.region || address?.subregion || address?.country || t('projects.unknownLocation', { defaultValue: 'Unknown' });
      setNewProjectLocation(locationDisplay);
    } catch (error) {
      console.error('[ProjectsScreen] Use current location in modal:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('settings.locationError', { defaultValue: 'Could not get current location. Please try again or select a location manually.' }),
        [{ text: 'OK', style: 'cancel' }]
      );
    } finally {
      setLocationLoadingInModal(false);
    }
  };

  const handleDeleteProject = (project) => {
    setProjectToDelete(project);
    setShowDeleteConfirm(true);
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
    setProjectToShare(project);
    setShareOptionsVisible(true);
  };

  const handleFormatToggle = (key) => {
    if (!canUse(FEATURES.ADVANCED_TEMPLATES)) {
      return;
    }
    setSelectedFormats(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const startSharingWithOptions = async () => {
    if (!projectToShare) return;
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

      if (shareAsArchive) {
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
        await FileSystem.deleteAsync(zipUri, { idempotent: true });
      } else if (urls.length === 1) {
        await Sharing.shareAsync(ensureFileUri(urls[0]), {
          mimeType: 'image/jpeg',
          dialogTitle: 'Share Photo',
        });
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
    navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] });
  };

  const getProjectPhotoCount = (projectId) => {
    return getPhotosByProject(projectId).length;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('projects.title')} ({projects.length})
        </Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingBottom: 20 + insets.bottom + 50 + 80 }]}
      >
        {projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>{t('projects.noProjects')}</Text>
            <Text style={styles.emptyStateSubtext}>
              Create your first project to get started
            </Text>
          </View>
        ) : (
          projects.map((project) => {
            const photoCount = getProjectPhotoCount(project.id);
            const isActive = activeProjectId === project.id;
            
            return (
              <TouchableOpacity
                key={project.id}
                style={[
                  styles.projectCard,
                  isActive && styles.projectCardActive
                ]}
                onPress={() => handleSelectProject(project)}
                activeOpacity={0.7}
              >
                <View style={styles.projectCardContent}>
                  <View style={styles.projectInfo}>
                    <Text style={styles.projectName} numberOfLines={1} ellipsizeMode="tail">{project.name}</Text>
                    <Text style={styles.projectSubtitle}>
                      {photoCount} {photoCount === 1 ? 'Photo' : 'Photos'}
                    </Text>
                  </View>
                  
                  <View style={styles.projectActions} onStartShouldSetResponder={() => true}>
                    <TouchableOpacity
                      style={styles.actionIconButton}
                      onPress={() => handleDeleteProject(project)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="trash" size={16} color="#DB4446" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionIconButton}
                      onPress={() => handleShareProject(project)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="paper-plane" size={16} color="#000000" />
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.actionIconButton}
                      onPress={() => handleUploadProject(project)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="cloud-upload" size={16} color="#000000" />
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.bottomNavPill, { bottom: 20 + insets.bottom }]}>
        <TouchableOpacity 
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] })}
          style={styles.navItem}
        >
          <Image source={require('../../assets/icons/home.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={[styles.navItemText, styles.navItemTextActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.navItem, styles.navItemActive]}
        >
          <Image source={require('../../assets/icons/projects.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Projects</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Gallery' }] })}
        >
          <Image source={require('../../assets/icons/gallery.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Gallery</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Settings' }] })}
        >
          <Image source={require('../../assets/icons/settings.png')} style={styles.navItemImage} resizeMode="contain" />
          <Text style={styles.navItemText}>Settings</Text>
        </TouchableOpacity>
      </View>


      <TouchableOpacity
        style={[styles.floatingAddButton, { bottom: 20 + insets.bottom + 50 + 16 }]}
        onPress={() => {
          const locationDisplay = getLocationName(location);
          setNewProjectNamePart(userName || '');
          setNewProjectLocation(locationDisplay);
          setNewProjectVisible(true);
        }}
      >
        <Ionicons name="add" size={40} color="#000000" style={{ fontWeight: 'bold' }} />
      </TouchableOpacity>

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
            <TextInput
              style={styles.input}
              placeholder={t('projects.projectNamePart', { defaultValue: 'Name (date & location added when created)' })}
              value={newProjectNamePart}
              onChangeText={setNewProjectNamePart}
              autoFocus={true}
              placeholderTextColor="#999"
            />
            {/* Folder location: user can type any location, with optional quick suggestions */}
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontSize: 13, marginBottom: 6 }}>
                {t('settings.folderLocation', { defaultValue: 'Folder location' })}
              </Text>
              <TextInput
                style={[styles.input, { fontSize: 14, paddingVertical: 8 }]}
                value={newProjectLocation}
                onChangeText={setNewProjectLocation}
                placeholder={t('settings.folderLocationPlaceholder', { defaultValue: 'Type city or location name' })}
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                onPress={handleUseCurrentLocationInModal}
                disabled={locationLoadingInModal}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 8,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  alignSelf: 'flex-start',
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
                  {locationLoadingInModal ? t('projects.gettingLocation', { defaultValue: 'Getting location…' }) : t('projects.useCurrentLocation', { defaultValue: 'Use current location' })}
                </Text>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                {LOCATIONS.map((loc) => (
                  <TouchableOpacity
                    key={loc.id}
                    onPress={() => setNewProjectLocation(loc.name)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: newProjectLocation === loc.name ? COLORS.PRIMARY : COLORS.BORDER,
                      marginRight: 6,
                      marginBottom: 6,
                      backgroundColor: newProjectLocation === loc.name ? '#FFF7D1' : '#FFFFFF',
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: '#000000',
                      }}
                    >
                      {loc.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.modalButtons}>
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

                  {/* Share as Archive Toggle */}
                  <View style={styles.archiveToggleRow}>
                    <Switch
                      value={shareAsArchive}
                      onValueChange={setShareAsArchive}
                      trackColor={{ false: '#E0E0E0', true: '#34C759' }}
                      thumbColor="#FFFFFF"
                      ios_backgroundColor="#E0E0E0"
                    />
                    <Text style={styles.archiveToggleLabel}>Share as archive (zip)</Text>
                  </View>
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
  container: {
    flex: 1,
    backgroundColor: '#F6F8FA',
  },
  header: {
    paddingHorizontal: 19,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#F6F8FA',
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
  projectCard: {
    height: 78,
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 11,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.11,
    shadowRadius: 8.2,
    elevation: 3,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  projectCardActive: {
    borderColor: '#F2C31B',
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
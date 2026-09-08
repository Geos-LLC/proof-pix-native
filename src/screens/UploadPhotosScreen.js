import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  PixelRatio,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { usePhotos } from '../context/PhotoContext';
import { COLORS, PHOTO_MODES } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import { savePhotoToDevice } from '../services/storage';
import { logEvent } from '../utils/analytics';
import { useTheme } from '../hooks/useTheme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { compositeImages } from '../utils/imageCompositor';

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_SIZE = (SCREEN_W - 48) / 2;
const FIRST_USE_KEY = '@upload_2_photos_seen';

export default function UploadPhotosScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { addPhoto, activeProjectId, projects, createProject, setActiveProject } = usePhotos();
  const room = route.params?.room || 'General';
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [photo1, setPhoto1] = useState(null); // before
  const [photo2, setPhoto2] = useState(null); // after
  const [loading, setLoading] = useState(false);
  const [showFirstUse, setShowFirstUse] = useState(false);
  const [projectPromptVisible, setProjectPromptVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    logEvent('upload_2_photos_tapped');
    checkFirstUse();
  }, []);

  const checkFirstUse = async () => {
    try {
      const seen = await AsyncStorage.getItem(FIRST_USE_KEY);
      if (!seen) {
        setShowFirstUse(true);
        await AsyncStorage.setItem(FIRST_USE_KEY, 'true');
      }
    } catch { /* non-critical */ }
  };

  const openPicker = async () => {
    logEvent('upload_picker_opened');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 2,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        logEvent('upload_picker_cancelled');
        return;
      }

      const assets = result.assets;
      logEvent('upload_photos_selected', { selected_count: assets.length, valid_selection: assets.length === 2 });

      if (assets.length < 2) {
        logEvent('upload_selection_invalid', { reason: 'less_than_2' });
        Alert.alert(
          t('upload.notEnoughTitle', { defaultValue: 'Need 2 Photos' }),
          t('upload.notEnoughMessage', { defaultValue: 'Please select 2 photos to create a before/after collage.' })
        );
        // Use the one photo they selected and let them pick another
        if (assets.length === 1) {
          setPhoto1({ uri: assets[0].uri, width: assets[0].width, height: assets[0].height });
        }
        return;
      }

      if (assets.length > 2) {
        logEvent('upload_selection_invalid', { reason: 'more_than_2' });
        Alert.alert(
          t('upload.tooManyTitle', { defaultValue: 'Too Many Photos' }),
          t('upload.tooManyMessage', { defaultValue: 'You can upload only 2 photos at a time. Using the first 2.' })
        );
      }

      setPhoto1({ uri: assets[0].uri, width: assets[0].width, height: assets[0].height });
      setPhoto2({ uri: assets[1].uri, width: assets[1].width, height: assets[1].height });
    } catch (error) {
      console.error('[Upload] Picker error:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('upload.pickerError', { defaultValue: "Couldn't open photo picker. Please try again." })
      );
    }
  };

  const pickSingle = async (slot) => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const photoData = { uri: asset.uri, width: asset.width, height: asset.height };

      if (slot === 1) setPhoto1(photoData);
      else setPhoto2(photoData);
    } catch (error) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('upload.loadError', { defaultValue: "Couldn't load the selected photo. Try again." })
      );
    }
  };

  const handleSwap = () => {
    logEvent('upload_photos_reordered');
    setPhoto1(photo2);
    setPhoto2(photo1);
  };

  const handleCreateCollage = async () => {
    if (!photo1 || !photo2) return;
    // No active project? Prompt for a name first — the collage save waits.
    if (!activeProjectId) {
      logEvent('upload_project_prompt_shown');
      setNewProjectName(`Project ${(projects?.length || 0) + 1}`);
      setProjectPromptVisible(true);
      return;
    }
    await runCollageSave(activeProjectId);
  };

  const handleConfirmProjectAndContinue = async () => {
    const namePart = (newProjectName || '').trim();
    if (!namePart) {
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('projects.enterProjectName', { defaultValue: 'Please enter a project name.' })
      );
      return;
    }
    setLoading(true);
    try {
      const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[^a-z0-9_\- ]/gi, '_');
      const existingNorm = new Set((projects || []).map((p) => normalize(p.name)));
      let finalName = namePart;
      if (existingNorm.has(normalize(namePart))) {
        let i = 2;
        while (existingNorm.has(normalize(`${i} ${namePart}`))) i++;
        finalName = `${i} ${namePart}`;
      }
      const safeName = finalName.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
      const proj = await createProject(safeName, { assignUnassigned: false });
      await setActiveProject(proj.id);
      setProjectPromptVisible(false);
      setNewProjectName('');
      logEvent('upload_project_created_inline', { project_id: proj.id });
      await runCollageSave(proj.id);
    } catch (error) {
      console.error('[Upload] Create project error:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('projects.createError', { defaultValue: 'Could not create the project. Please try again.' })
      );
      setLoading(false);
    }
  };

  const runCollageSave = async (projectIdToUse) => {
    setLoading(true);
    logEvent('upload_review_opened');

    try {
      // Determine orientation from first image dimensions
      const isLandscape = (photo1.width || 0) > (photo1.height || 0);
      const aspectRatio = isLandscape ? '4:3' : '3:4';
      const orientation = isLandscape ? 'landscape' : 'portrait';

      const timestamp = Date.now();
      const name = `Upload ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      // Save photos to device storage
      const beforeFilename = `upload_before_${timestamp}.jpg`;
      const afterFilename = `upload_after_${timestamp}.jpg`;

      const beforeSavedUri = await savePhotoToDevice(photo1.uri, beforeFilename, projectIdToUse);
      const afterSavedUri = await savePhotoToDevice(photo2.uri, afterFilename, projectIdToUse);

      if (!beforeSavedUri || !afterSavedUri) {
        throw new Error('Failed to save photos');
      }

      const beforePhoto = {
        id: timestamp,
        uri: beforeSavedUri,
        room,
        mode: PHOTO_MODES.BEFORE,
        name,
        timestamp,
        aspectRatio,
        orientation,
        cameraViewMode: orientation,
        projectId: projectIdToUse,
        sourceType: 'upload',
      };

      const afterPhoto = {
        id: timestamp + 1,
        uri: afterSavedUri,
        room,
        mode: PHOTO_MODES.AFTER,
        name,
        timestamp: timestamp + 1,
        beforePhotoId: timestamp,
        aspectRatio,
        orientation,
        cameraViewMode: orientation,
        projectId: projectIdToUse,
        sourceType: 'upload',
      };

      // Save to context
      await addPhoto(beforePhoto);
      await addPhoto(afterPhoto);

      // Composite the pair into a COMBINED photo so the Home grid thumbnail
      // and Studio have something to render. Mirrors CameraScreen's
      // handleAfterPhoto: force 1:1 square output, SIDE for portrait pairs
      // and STACK for landscape pairs. Failure is non-fatal — the Home grid
      // can re-composite on the fly from the before/after uris.
      try {
        const pixelRatio = Platform.OS === 'android' ? PixelRatio.get() : 1;
        const getSize = (u) => new Promise((resolve) => {
          Image.getSize(
            u,
            (w, h) => resolve({ w: Math.round(w * pixelRatio), h: Math.round(h * pixelRatio) }),
            () => resolve({ w: 1080, h: 1920 })
          );
        });
        const aSize = await getSize(beforeSavedUri);
        const bSize = await getSize(afterSavedUri);

        const layout = isLandscape ? 'STACK' : 'SIDE';
        const sourceMaxWidth = Math.max(aSize.w, bSize.w);
        const totalW = Math.min(Math.max(sourceMaxWidth, 2048), 4096);
        const totalH = totalW; // 1:1 square

        const dims = layout === 'STACK'
          ? { width: totalW, height: totalH, topH: Math.round(totalH / 2), bottomH: totalH - Math.round(totalH / 2) }
          : { width: totalW, height: totalH, leftW: Math.round(totalW / 2), rightW: totalW - Math.round(totalW / 2) };

        const compositedUri = await compositeImages(beforeSavedUri, afterSavedUri, layout, dims);

        const safeName = name.replace(/\s+/g, '_');
        const projectIdSuffix = projectIdToUse ? `_P${projectIdToUse}` : '';
        const combinedSavedUri = await savePhotoToDevice(
          compositedUri,
          `${room}_${safeName}_COMBINED_BASE_${layout}_${Date.now()}${projectIdSuffix}.jpg`,
          projectIdToUse
        );

        if (combinedSavedUri) {
          await addPhoto({
            id: `combined_${beforePhoto.id}`,
            mode: PHOTO_MODES.COMBINED,
            uri: combinedSavedUri,
            name,
            room,
            projectId: projectIdToUse,
            beforePhotoId: beforePhoto.id,
            combinedLayout: layout,
            timestamp: Date.now(),
            sourceType: 'upload',
          });
        }
      } catch (compositeError) {
        console.warn('[Upload] Composite step failed (non-fatal):', compositeError?.message || compositeError);
      }

      logEvent('upload_collage_created', { source_type: 'upload', project_id: projectIdToUse || null });

      // Navigate to editor
      navigation.replace('PhotoEditor', {
        beforePhoto,
        afterPhoto,
      });
    } catch (error) {
      console.error('[Upload] Create collage error:', error);
      Alert.alert(
        t('common.error', { defaultValue: 'Error' }),
        t('upload.collageError', { defaultValue: 'Something went wrong while creating the collage. Please try again.' })
      );
    } finally {
      setLoading(false);
    }
  };

  const hasAllPhotos = photo1 && photo2;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            if (photo1 || photo2) {
              logEvent('upload_flow_abandoned');
            }
            navigation.goBack();
          }}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('upload.title', { defaultValue: 'Upload 2 Photos' })}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* First-use helper */}
      {showFirstUse && (
        <View style={styles.helperBanner}>
          <Text style={styles.helperText}>
            {t('upload.helperText', { defaultValue: 'Choose 2 existing photos from your gallery to create a before/after collage. ProofPix only accesses the photos you select.' })}
          </Text>
          <TouchableOpacity onPress={() => setShowFirstUse(false)}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.content}>
        {/* Photo slots */}
        <View style={styles.photoRow}>
          {/* Photo 1 (Before) */}
          <TouchableOpacity
            style={styles.photoSlot}
            onPress={() => pickSingle(1)}
          >
            {photo1 ? (
              <View style={styles.photoWrapper}>
                <Image source={{ uri: photo1.uri }} style={styles.photoPreview} />
                <View style={styles.photoLabel}>
                  <Text style={styles.photoLabelText}>
                    {t('upload.before', { defaultValue: 'Before' })}
                  </Text>
                </View>
                <TouchableOpacity style={styles.removeBtn} onPress={() => setPhoto1(null)}>
                  <Ionicons name="close-circle" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptySlot}>
                <Ionicons name="image-outline" size={40} color="#666" />
                <Text style={styles.emptySlotText}>
                  {t('upload.selectBefore', { defaultValue: 'Before' })}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Swap button */}
          {hasAllPhotos && (
            <TouchableOpacity style={styles.swapButton} onPress={handleSwap}>
              <Ionicons name="swap-horizontal" size={24} color={COLORS.PRIMARY} />
            </TouchableOpacity>
          )}

          {/* Photo 2 (After) */}
          <TouchableOpacity
            style={styles.photoSlot}
            onPress={() => pickSingle(2)}
          >
            {photo2 ? (
              <View style={styles.photoWrapper}>
                <Image source={{ uri: photo2.uri }} style={styles.photoPreview} />
                <View style={styles.photoLabel}>
                  <Text style={styles.photoLabelText}>
                    {t('upload.after', { defaultValue: 'After' })}
                  </Text>
                </View>
                <TouchableOpacity style={styles.removeBtn} onPress={() => setPhoto2(null)}>
                  <Ionicons name="close-circle" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptySlot}>
                <Ionicons name="image-outline" size={40} color="#666" />
                <Text style={styles.emptySlotText}>
                  {t('upload.selectAfter', { defaultValue: 'After' })}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Pick both button (when no photos selected) */}
        {!photo1 && !photo2 && (
          <TouchableOpacity style={styles.pickBothButton} onPress={openPicker}>
            <Ionicons name="images-outline" size={24} color="#000" />
            <Text style={styles.pickBothText}>
              {t('upload.pickBoth', { defaultValue: 'Choose 2 Photos from Gallery' })}
            </Text>
          </TouchableOpacity>
        )}

        {/* Pick remaining (when only 1 photo selected) */}
        {((photo1 && !photo2) || (!photo1 && photo2)) && (
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              {t('upload.pickRemaining', { defaultValue: 'Tap the empty slot to select the second photo' })}
            </Text>
          </View>
        )}

        {/* Create Collage CTA */}
        {hasAllPhotos && (
          <TouchableOpacity
            style={[styles.createButton, loading && styles.createButtonDisabled]}
            onPress={handleCreateCollage}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Ionicons name="grid-outline" size={20} color="#000" />
                <Text style={styles.createButtonText}>
                  {t('upload.createCollage', { defaultValue: 'Create Collage' })}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Reset */}
        {(photo1 || photo2) && (
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => {
              setPhoto1(null);
              setPhoto2(null);
            }}
          >
            <Text style={styles.resetText}>
              {t('upload.startOver', { defaultValue: 'Start Over' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* New Project prompt — shown when user taps Create Collage without an active project */}
      <Modal
        visible={projectPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!loading) {
            setProjectPromptVisible(false);
            logEvent('upload_project_prompt_dismissed');
          }
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('projects.newProject', { defaultValue: 'New Project' })}
            </Text>
            <Text style={styles.modalSubtitle}>
              {t('upload.projectPromptSubtitle', {
                defaultValue: 'Name a project for this before/after set.',
              })}
            </Text>
            <TextInput
              value={newProjectName}
              onChangeText={setNewProjectName}
              placeholder={t('projects.projectNamePlaceholder', { defaultValue: 'Project name' })}
              placeholderTextColor="#888"
              style={styles.modalInput}
              autoFocus
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleConfirmProjectAndContinue}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancel]}
                onPress={() => {
                  if (loading) return;
                  setProjectPromptVisible(false);
                  logEvent('upload_project_prompt_dismissed');
                }}
                disabled={loading}
              >
                <Text style={styles.modalCancelText}>
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalConfirm, loading && styles.createButtonDisabled]}
                onPress={handleConfirmProjectAndContinue}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.modalConfirmText}>
                    {t('common.continue', { defaultValue: 'Continue' })}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    fontFamily: FONTS.BOLD,
  },
  helperBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(242, 195, 27, 0.15)',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
  },
  helperText: {
    flex: 1,
    fontSize: 13,
    color: '#ccc',
    fontFamily: FONTS.REGULAR,
    marginRight: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  photoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  photoSlot: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE * 1.3,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  photoWrapper: {
    flex: 1,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  photoLabelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FONTS.SEMIBOLD,
  },
  removeBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  emptySlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptySlotText: {
    color: theme.textSecondary,
    fontSize: 13,
    fontFamily: FONTS.MEDIUM,
  },
  swapButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(242, 195, 27, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Refresh: primary CTA spec — 52px / radius 16 / warm pop-shadow.
  pickBothButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.PRIMARY,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  pickBothText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    fontFamily: FONTS.BOLD,
    letterSpacing: -0.1,
  },
  hintContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  hintText: {
    color: theme.textMuted,
    fontSize: 14,
    fontFamily: FONTS.REGULAR,
  },
  // Refresh: primary CTA spec.
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.PRIMARY,
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: COLORS.PRIMARY,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 6,
  },
  createButtonDisabled: {
    opacity: 0.35,
    shadowOpacity: 0,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.textPrimary,
    fontFamily: FONTS.BOLD,
    letterSpacing: -0.1,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  resetText: {
    color: theme.textMuted,
    fontSize: 14,
    fontFamily: FONTS.MEDIUM,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.surface || '#1E1E1E',
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: FONTS.BOLD,
    color: theme.textPrimary,
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: theme.textMuted,
    fontFamily: FONTS.REGULAR,
    marginBottom: 14,
  },
  modalInput: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border || '#333',
    backgroundColor: theme.surfaceMuted || '#111',
    color: theme.textPrimary,
    paddingHorizontal: 14,
    fontFamily: FONTS.REGULAR,
    fontSize: 15,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalButton: {
    minWidth: 96,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalCancel: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.border || '#333',
  },
  modalCancelText: {
    color: theme.textPrimary,
    fontFamily: FONTS.MEDIUM,
    fontSize: 15,
  },
  modalConfirm: {
    backgroundColor: COLORS.PRIMARY,
  },
  modalConfirmText: {
    color: '#000',
    fontFamily: FONTS.BOLD,
    fontSize: 15,
  },
});

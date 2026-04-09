import React, { useState, useEffect } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width: SCREEN_W } = Dimensions.get('window');
const PREVIEW_SIZE = (SCREEN_W - 48) / 2;
const FIRST_USE_KEY = '@upload_2_photos_seen';

export default function UploadPhotosScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { addPhoto, activeProjectId } = usePhotos();
  const room = route.params?.room || 'General';

  const [photo1, setPhoto1] = useState(null); // before
  const [photo2, setPhoto2] = useState(null); // after
  const [loading, setLoading] = useState(false);
  const [showFirstUse, setShowFirstUse] = useState(false);

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

      const beforeSavedUri = await savePhotoToDevice(photo1.uri, beforeFilename, activeProjectId);
      const afterSavedUri = await savePhotoToDevice(photo2.uri, afterFilename, activeProjectId);

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
        projectId: activeProjectId,
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
        projectId: activeProjectId,
        sourceType: 'upload',
      };

      // Save to context
      await addPhoto(beforePhoto);
      await addPhoto(afterPhoto);

      logEvent('upload_collage_created', { source_type: 'upload', project_id: activeProjectId || null });

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    color: '#666',
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
  pickBothButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  pickBothText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    fontFamily: FONTS.BOLD,
  },
  hintContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  hintText: {
    color: '#888',
    fontSize: 14,
    fontFamily: FONTS.REGULAR,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.PRIMARY,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000',
    fontFamily: FONTS.BOLD,
  },
  resetButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  resetText: {
    color: '#888',
    fontSize: 14,
    fontFamily: FONTS.MEDIUM,
  },
});

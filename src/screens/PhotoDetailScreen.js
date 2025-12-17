import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
  Dimensions,
  Share,
  ActivityIndicator,
  ScrollView,
  Platform,
  PixelRatio
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { COLORS, PHOTO_MODES, getLabelPositions, ROOMS } from '../constants/rooms';
import * as FileSystem from 'expo-file-system/legacy';
import PhotoWatermark from '../components/PhotoWatermark';
import { getCachedLabeledPhoto, calculateSettingsHash } from '../services/labelCacheService';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { Image as RNImage } from 'react-native';

const { width, height } = Dimensions.get('window');

export default function PhotoDetailScreen({ route, navigation }) {
  const { photo, isSelectionMode = false, selectedPhotos = [], onSelectionChange, allPhotos: providedPhotos } = route.params;
  const { deletePhoto, getBeforePhotos, getAfterPhotos, activeProjectId } = usePhotos();
  const settings = useSettings();
  const { showLabels, shouldShowWatermark, beforeLabelPosition, afterLabelPosition, labelMarginVertical, labelMarginHorizontal, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily } = settings || {};
  const getRooms = settings?.getRooms;
  const [sharing, setSharing] = useState(false);
  const [containerLayout, setContainerLayout] = useState(null);
  const [imageSize, setImageSize] = useState(null);
  const [currentPhoto, setCurrentPhoto] = useState(photo);
  const [allPhotos, setAllPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayUri, setDisplayUri] = useState(photo.uri); // URI to display for current photo (original or labeled)
  const [displayUriMap, setDisplayUriMap] = useState({}); // Map of photo.id -> displayUri for all photos
  const [loadingLabeledImage, setLoadingLabeledImage] = useState(false);
  const scrollViewRef = useRef(null);
  const imageContainerRef = useRef(null);
  const captureViewRef = useRef(null);
  const imageRef = useRef(null);
  
  // Track selected photos locally
  const [localSelectedPhotos, setLocalSelectedPhotos] = useState(new Set(selectedPhotos));
  
  // Load cached labeled images for all photos when settings or photos change
  useEffect(() => {
    const loadAllDisplayImages = async () => {
      if (!allPhotos || allPhotos.length === 0) return;

      const newDisplayUriMap = {};

      // Calculate settings hash once
      const settingsHash = showLabels ? calculateSettingsHash({
        showLabels,
        beforeLabelPosition,
        afterLabelPosition,
        labelBackgroundColor,
        labelTextColor,
        labelSize,
        labelFontFamily,
        labelMarginVertical,
        labelMarginHorizontal,
      }) : null;

      console.log('[PhotoDetailScreen] Loading display images for', allPhotos.length, 'photos with hash:', settingsHash);

      // Load display URIs for all photos
      for (const photoItem of allPhotos) {
        // If labels are disabled or photo doesn't have a mode, use original
        if (!showLabels || !photoItem.mode) {
          newDisplayUriMap[photoItem.id] = photoItem.uri;
          continue;
        }

        try {
          // Try to get cached labeled image
          const cachedUri = await getCachedLabeledPhoto(photoItem, settingsHash);

          if (cachedUri) {
            console.log('[PhotoDetailScreen] Cache HIT for photo', photoItem.id);
            newDisplayUriMap[photoItem.id] = cachedUri;
          } else {
            console.log('[PhotoDetailScreen] Cache MISS for photo', photoItem.id, '- queuing for lazy re-labeling');
            // Cache miss - show original for now and queue for background labeling
            newDisplayUriMap[photoItem.id] = photoItem.uri;

            // Queue photo for lazy re-labeling (will be processed in background)
            // Image.getSize returns actual file pixel dimensions for local file:// URIs.
            // No PixelRatio conversion needed - native module loads the same file and gets the same dimensions.
            RNImage.getSize(photoItem.uri, (width, height) => {
              console.log(`[PhotoDetailScreen] Photo dimensions: ${width}x${height}`);

              backgroundLabelPreparationService.queuePreparation({
                photo: photoItem,
                width,
                height,
                settingsHash: settingsHash,
                mode: photoItem.mode,
              });
              console.log('[PhotoDetailScreen] Queued photo', photoItem.id, 'for re-labeling');
            }, (error) => {
              console.error('[PhotoDetailScreen] Failed to get image size for', photoItem.id, error);
            });
          }
        } catch (error) {
          console.error('[PhotoDetailScreen] Error loading labeled image for', photoItem.id, error);
          newDisplayUriMap[photoItem.id] = photoItem.uri;
        }
      }

      setDisplayUriMap(newDisplayUriMap);
    };

    loadAllDisplayImages();
  }, [allPhotos, showLabels, beforeLabelPosition, afterLabelPosition, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily, labelMarginVertical, labelMarginHorizontal]);

  // Update displayUri when currentPhoto changes
  useEffect(() => {
    if (displayUriMap[currentPhoto.id]) {
      setDisplayUri(displayUriMap[currentPhoto.id]);
    } else {
      setDisplayUri(currentPhoto.uri);
    }
  }, [currentPhoto, displayUriMap]);

  // Listen for background labeling completion to update display
  useEffect(() => {
    const unsubscribe = backgroundLabelPreparationService.subscribe(async (state) => {
      // When background labeling completes, refresh the displayUriMap
      // This will cause photos to automatically update from unlabeled to labeled
      if (state.pendingPreparations.length === 0 && allPhotos.length > 0 && showLabels) {
        console.log('[PhotoDetailScreen] Background labeling queue empty - refreshing display URIs');

        const settingsHash = calculateSettingsHash({
          showLabels,
          beforeLabelPosition,
          afterLabelPosition,
          labelBackgroundColor,
          labelTextColor,
          labelSize,
          labelFontFamily,
          labelMarginVertical,
          labelMarginHorizontal,
        });

        const updatedMap = {};
        for (const photoItem of allPhotos) {
          if (!photoItem.mode) {
            updatedMap[photoItem.id] = photoItem.uri;
            continue;
          }

          try {
            const cachedUri = await getCachedLabeledPhoto(photoItem, settingsHash);
            updatedMap[photoItem.id] = cachedUri || photoItem.uri;
          } catch (error) {
            updatedMap[photoItem.id] = photoItem.uri;
          }
        }

        setDisplayUriMap(updatedMap);
      }
    });

    return () => unsubscribe();
  }, [allPhotos, showLabels, beforeLabelPosition, afterLabelPosition, labelBackgroundColor, labelTextColor, labelSize, labelFontFamily, labelMarginVertical, labelMarginHorizontal]);

  // Sync with route params when they change
  useEffect(() => {
    const newSet = new Set(selectedPhotos);
    setLocalSelectedPhotos(newSet);
    console.log('[PhotoDetailScreen] Selected photos updated:', Array.from(newSet), 'Current photo ID:', currentPhoto.id, 'Is selected:', newSet.has(currentPhoto.id));
  }, [selectedPhotos]);
  
  // Update selection state when current photo changes
  useEffect(() => {
    if (isSelectionMode) {
      const isCurrentlySelected = localSelectedPhotos.has(currentPhoto.id);
      console.log('[PhotoDetailScreen] Current photo changed:', currentPhoto.id, 'Is selected:', isCurrentlySelected);
    }
  }, [currentPhoto.id, isSelectionMode, localSelectedPhotos]);
  
  // Toggle selection for current photo
  const toggleSelection = () => {
    if (!isSelectionMode || !onSelectionChange) return;
    
    const newSelected = new Set(localSelectedPhotos);
    if (newSelected.has(currentPhoto.id)) {
      newSelected.delete(currentPhoto.id);
    } else {
      newSelected.add(currentPhoto.id);
    }
    setLocalSelectedPhotos(newSelected);
    onSelectionChange(Array.from(newSelected));
  };
  
  // Get selection state for a specific photo
  const getIsSelected = (photoId) => {
    return isSelectionMode && localSelectedPhotos.has(photoId);
  };

  // Get all photos for swiping
  useEffect(() => {
    // If photos are provided via route params (e.g., from preview selected or selection mode), use those
    if (providedPhotos && Array.isArray(providedPhotos) && providedPhotos.length > 0) {
      setAllPhotos(providedPhotos);
      const index = providedPhotos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        setCurrentIndex(index);
        setCurrentPhoto(providedPhotos[index]);
        console.log('[PhotoDetailScreen] Using provided photos:', providedPhotos.length, 'Found photo at index:', index);
      } else {
        setCurrentIndex(0);
        setCurrentPhoto(photo);
        console.log('[PhotoDetailScreen] Photo not found in provided list, using index 0');
      }
      return;
    }

    // If in selection mode, filter to show only selected photos
    if (isSelectionMode && selectedPhotos && selectedPhotos.length > 0) {
      const selected = [];
      if (!getRooms || typeof getRooms !== 'function') {
        console.warn('[PhotoDetailScreen] getRooms is not available in selection mode');
        setAllPhotos([photo]);
        setCurrentIndex(0);
        setCurrentPhoto(photo);
        return;
      }
      const rooms = getRooms();
      if (!rooms || !Array.isArray(rooms)) {
        console.warn('[PhotoDetailScreen] getRooms returned invalid data in selection mode');
        setAllPhotos([photo]);
        setCurrentIndex(0);
        setCurrentPhoto(photo);
        return;
      }
      const selectedSet = new Set(selectedPhotos);
      rooms.forEach(room => {
        const beforePhotos = getBeforePhotos(room.id);
        const afterPhotos = getAfterPhotos(room.id);
        // Only include photos that are in the selected set
        selected.push(...beforePhotos.filter(p => selectedSet.has(p.id)));
        selected.push(...afterPhotos.filter(p => selectedSet.has(p.id)));
      });
      if (selected.length > 0) {
        setAllPhotos(selected);
        const index = selected.findIndex(p => p.id === photo.id);
        if (index >= 0) {
          setCurrentIndex(index);
          setCurrentPhoto(selected[index]);
          console.log('[PhotoDetailScreen] Using selected photos:', selected.length, 'Found photo at index:', index);
        } else {
          setCurrentIndex(0);
          setCurrentPhoto(photo);
          console.log('[PhotoDetailScreen] Photo not found in selected list, using index 0');
        }
        return;
      }
    }

    // Otherwise, load all photos from all rooms
    // Check if getRooms is available
    if (!getRooms || typeof getRooms !== 'function') {
      console.warn('[PhotoDetailScreen] getRooms is not available, using only current photo');
      setAllPhotos([photo]);
      setCurrentIndex(0);
      setCurrentPhoto(photo);
      return;
    }

    const rooms = getRooms();
    if (!rooms || !Array.isArray(rooms)) {
      console.warn('[PhotoDetailScreen] getRooms returned invalid data, using only current photo');
      setAllPhotos([photo]);
      setCurrentIndex(0);
      setCurrentPhoto(photo);
      return;
    }

    const all = [];
    
    // Collect photos from all rooms
    rooms.forEach(room => {
      const beforePhotos = getBeforePhotos(room.id);
      const afterPhotos = getAfterPhotos(room.id);
      all.push(...beforePhotos, ...afterPhotos);
    });
    
    setAllPhotos(all);
    
    console.log('[PhotoDetailScreen] All photos loaded:', all.length, 'photos from', rooms.length, 'rooms');
    console.log('[PhotoDetailScreen] Current photo:', photo.id, photo.name, photo.mode, 'room:', photo.room);
    console.log('[PhotoDetailScreen] Photo IDs in list:', all.map(p => `${p.id} (${p.name}, ${p.mode})`));
    
    // Find current photo index
    const index = all.findIndex(p => p.id === photo.id);
    if (index >= 0) {
      setCurrentIndex(index);
      setCurrentPhoto(all[index]);
      console.log('[PhotoDetailScreen] Found photo at index:', index);
    } else {
      setCurrentIndex(0);
      setCurrentPhoto(photo);
      console.log('[PhotoDetailScreen] Photo not found in list, using index 0');
    }
  }, [photo, getBeforePhotos, getAfterPhotos, activeProjectId, getRooms, providedPhotos]);

  // Scroll to current index when photos load
  useEffect(() => {
    if (scrollViewRef.current && allPhotos.length > 0 && currentIndex >= 0) {
      console.log('[PhotoDetailScreen] Scrolling to index:', currentIndex, 'of', allPhotos.length);
      requestAnimationFrame(() => {
        setTimeout(() => {
          scrollViewRef.current?.scrollTo({
            x: currentIndex * width,
            animated: false
          });
        }, 100);
      });
    }
  }, [allPhotos.length, currentIndex]);

  // Handle scroll to update current photo
  const handleScroll = (event) => {
    const { contentOffset, layoutMeasurement } = event.nativeEvent;
    const pageWidth = layoutMeasurement.width;
    const pageIndex = Math.round(contentOffset.x / pageWidth);
    
    console.log('[PhotoDetailScreen] Swipe detected - pageIndex:', pageIndex, 'currentIndex:', currentIndex, 'totalPhotos:', allPhotos.length);
    console.log('[PhotoDetailScreen] Content offset:', contentOffset.x, 'pageWidth:', pageWidth);
    
    if (pageIndex >= 0 && pageIndex < allPhotos.length && pageIndex !== currentIndex) {
      const newPhoto = allPhotos[pageIndex];
      console.log('[PhotoDetailScreen] Swiping to photo:', newPhoto.id, newPhoto.name, newPhoto.mode, 'at index:', pageIndex);
      setCurrentIndex(pageIndex);
      setCurrentPhoto(newPhoto);
      
      // Update selection state for new photo if in selection mode
      if (isSelectionMode && onSelectionChange) {
        const newSelected = new Set(localSelectedPhotos);
        if (newSelected.has(newPhoto.id)) {
          // Photo is selected
        } else {
          // Photo is not selected
        }
      }
    } else {
      console.log('[PhotoDetailScreen] Swipe ignored - same index or out of bounds');
    }
  };

  // Calculate capture view dimensions maintaining aspect ratio
  const captureDimensions = useMemo(() => {
    if (!imageSize) return null;
    
    const maxDimension = 2000; // Reasonable max size for sharing
    const ratio = imageSize.width / imageSize.height;
    let captureWidth, captureHeight;
    
    if (ratio >= 1) {
      // Landscape or square
      captureWidth = maxDimension;
      captureHeight = maxDimension / ratio;
    } else {
      // Portrait
      captureHeight = maxDimension;
      captureWidth = maxDimension * ratio;
    }
    
    const result = { captureWidth, captureHeight };

    return result;
  }, [imageSize]);

  const handleDelete = async () => {
    await deletePhoto(currentPhoto.id);
    // If there are more photos, navigate to the next one, otherwise go back
    if (allPhotos.length > 1) {
      const newIndex = currentIndex >= allPhotos.length - 1 ? currentIndex - 1 : currentIndex;
      if (newIndex >= 0) {
        const nextPhoto = allPhotos[newIndex];
        setCurrentIndex(newIndex);
        setCurrentPhoto(nextPhoto);
        // Update route params to reflect new photo
        navigation.setParams({ photo: nextPhoto });
      } else {
        navigation.goBack();
      }
    } else {
      navigation.goBack();
    }
  };

  const handleShare = async () => {
    try {
      setSharing(true);

      let tempUri;

      // If watermark is enabled, capture the view (image + watermark)
      // Otherwise, share the displayUri directly (which already has labels if enabled)
      if (shouldShowWatermark && captureDimensions) {
        try {
          // Capture the hidden view which has exact image dimensions (no white padding)
          const capturedUri = await captureRef(captureViewRef, {
            format: 'jpg',
            quality: 0.95
          });

          // Copy captured image to cache directory to ensure it's temporary
          const tempFileName = `${currentPhoto.room}_${currentPhoto.name}_${currentPhoto.mode}_watermarked_${Date.now()}.jpg`;
          tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
          await FileSystem.copyAsync({ from: capturedUri, to: tempUri });

        } catch (error) {
          console.error('[PhotoDetailScreen] Capture failed:', error);
          // Fall back to displayUri if capture fails
          const tempFileName = `${currentPhoto.room}_${currentPhoto.name}_${currentPhoto.mode}_${Date.now()}.jpg`;
          tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
          await FileSystem.copyAsync({ from: displayUri, to: tempUri });
        }
      } else {
        // Share displayUri (labeled or original) - copy to cache directory
        const tempFileName = `${currentPhoto.room}_${currentPhoto.name}_${currentPhoto.mode}_${Date.now()}.jpg`;
        tempUri = `${FileSystem.cacheDirectory}${tempFileName}`;
        await FileSystem.copyAsync({ from: displayUri, to: tempUri });
      }

      // Share the image
      const shareOptions = {
        title: `${currentPhoto.mode === 'before' ? 'Before' : 'After'} Photo - ${currentPhoto.name}`,
        url: tempUri,
        type: 'image/jpeg'
      };

      const result = await Share.share(shareOptions);

      // Clean up temporary file after sharing
      try {
        const fileInfo = await FileSystem.getInfoAsync(tempUri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(tempUri, { idempotent: true });
        }
      } catch (cleanupError) {
        console.error('[PhotoDetailScreen] Cleanup error:', cleanupError);
      }
    } catch (error) {
      console.error('[PhotoDetailScreen] Share error:', error);
      Alert.alert('Error', 'Failed to share photo');
    } finally {
      setSharing(false);
    }
  };

  const getImageDisplayBounds = () => {
    if (!containerLayout || !imageSize) {
      return null;
    }

    const containerWidth = containerLayout.width;
    const containerHeight = containerLayout.height;
    const imageWidth = imageSize.width;
    const imageHeight = imageSize.height;

    // Calculate scaling to fit within container while maintaining aspect ratio
    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    const scale = Math.min(scaleX, scaleY);

    const displayWidth = imageWidth * scale;
    const displayHeight = imageHeight * scale;

    // Calculate centered position
    const offsetX = (containerWidth - displayWidth) / 2;
    const offsetY = (containerHeight - displayHeight) / 2;

    return {
      displayWidth,
      displayHeight,
      offsetX,
      offsetY
    };
  };

  const renderPhoto = (photoToRender = currentPhoto, uriToDisplay = displayUri) => {
    const photoIsSelected = getIsSelected(photoToRender.id);

    // Calculate watermark position based on actual image display area
    const getWatermarkStyle = () => {
      const bounds = getImageDisplayBounds();
      if (!bounds) {
        return { bottom: 10, right: 10 };
      }

      // Position watermark 10px from the bottom-right of the actual image display area
      return {
        bottom: bounds.offsetY + 10,
        right: bounds.offsetX + 10
      };
    };

    // Unified approach: Display either original or cached labeled image
    // No overlay labels needed - labels are permanently embedded in cached images
    return (
      <View
        ref={imageContainerRef}
        style={styles.imageContainer}
        collapsable={false}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setContainerLayout({ width, height });
        }}
      >
        <Image
          ref={imageRef}
          source={{ uri: uriToDisplay }}
          style={styles.image}
          resizeMode="contain"
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source;
            setImageSize({ width, height });
          }}
        />
        {/* Show watermark if enabled */}
        {shouldShowWatermark && (
          <PhotoWatermark style={getWatermarkStyle()} />
        )}

        {/* Checkbox overlay in selection mode */}
        {isSelectionMode && (
          <TouchableOpacity
            style={styles.checkboxOverlay}
            onPress={() => {
              if (!onSelectionChange) return;
              const newSelected = new Set(localSelectedPhotos);
              if (newSelected.has(photoToRender.id)) {
                newSelected.delete(photoToRender.id);
              } else {
                newSelected.add(photoToRender.id);
              }
              setLocalSelectedPhotos(newSelected);
              onSelectionChange(Array.from(newSelected));
            }}
            activeOpacity={0.8}
          >
            <View style={[styles.checkboxContainer, photoIsSelected && styles.checkboxSelected]}>
              {photoIsSelected && (
                <Text style={styles.checkmark}>✓</Text>
              )}
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>

        <View style={styles.titleContainer}>
          <Text style={styles.title}>{currentPhoto.name}</Text>
          <Text style={[
            styles.mode,
            { color: currentPhoto.mode === 'before' ? '#4CAF50' : '#2196F3' }
          ]}>
            {currentPhoto.mode.toUpperCase()}
          </Text>
        </View>

        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>

      {allPhotos.length > 1 ? (
        <ScrollView
          ref={scrollViewRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={width}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onMomentumScrollEnd={handleScroll}
          directionalLockEnabled={true}
          bounces={false}
        >
          {allPhotos.map((photoItem, index) => (
            <View key={photoItem.id} style={{ width, height: height - 200 }}>
              {renderPhoto(photoItem, displayUriMap[photoItem.id] || photoItem.uri)}
            </View>
          ))}
        </ScrollView>
      ) : (
        renderPhoto()
      )}

      {/* Hidden capture view - only needed for watermark now (labels are in cached images) */}
      {shouldShowWatermark && captureDimensions && (
        <View
          ref={captureViewRef}
          style={{
            position: 'absolute',
            left: -10000,
            top: -10000,
            width: captureDimensions.captureWidth,
            height: captureDimensions.captureHeight,
            backgroundColor: 'black',
            justifyContent: 'center',
            alignItems: 'center'
          }}
          collapsable={false}
        >
          <Image
            source={{ uri: displayUri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
          {(() => {
            // Use a consistent scale factor for watermark
            const referenceWidth = 1920;
            const screenWidth = width;
            const scaleFactor = referenceWidth / screenWidth;

            return (
              <PhotoWatermark
                style={{
                  bottom: 10 * scaleFactor,
                  right: 10 * scaleFactor,
                  paddingHorizontal: 10 * scaleFactor,
                  paddingVertical: 4 * scaleFactor,
                  borderRadius: 4 * scaleFactor
                }}
                onPress={null}
              />
            );
          })()}
        </View>
      )}

      <TouchableOpacity 
        style={styles.shareButton} 
        onPress={handleShare}
        disabled={sharing}
      >
        {sharing ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.shareButtonText}>Share</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 20
  },
  title: {
    color: 'black',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2
  },
  shareButton: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
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
  shareButtonText: {
    color: COLORS.TEXT,
    fontSize: 18,
    fontWeight: 'bold'
  },
  backButton: {
    padding: 8
  },
  backButtonText: {
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold'
  },
  deleteButton: {
    padding: 8
  },
  deleteButtonText: {
    fontSize: 24
  },
  image: {
    width: '100%',
    height: '100%'
  },
  checkboxOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 10
  },
  checkboxContainer: {
    width: 32,
    height: 32,
    borderRadius: 16, // Fully round
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden' // Ensure it stays round
  },
  checkboxSelected: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  checkmark: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold'
  },
  imageContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'white',
    position: 'relative'
  },
  mode: {
    color: COLORS.PRIMARY,
    fontSize: 12,
    fontWeight: '600'
  },
});

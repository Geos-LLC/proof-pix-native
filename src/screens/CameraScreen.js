import React, { useState, useRef, useEffect, useContext, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Image,
  Alert,
  Dimensions,
  ScrollView,
  Platform,
  PixelRatio,
  PanResponder,
  Animated,
  StatusBar,
  Modal,
  ActivityIndicator
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { Ionicons, MaterialIcons, Feather } from '@expo/vector-icons';
import { RoomIcon } from '../utils/roomIcons';
import { compositeImages, isNativeCompositorAvailable } from '../utils/imageCompositor';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { savePhotoToDevice } from '../services/storage';
import { createAlbumName } from '../services/uploadService';
import { getLocationName } from '../config/locations';
import { COLORS, PHOTO_MODES, getLabelPositions } from '../constants/rooms';
import { FONTS } from '../constants/fonts';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import {
  calculateSettingsHash,
  saveCachedLabeledPhoto,
  ensureCacheDir,
} from '../services/labelCacheService';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { backgroundCombinedPhotoService } from '../components/GlobalBackgroundCombinedPhotoCreator';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { onBeforePhotoTaken, onAfterPhotoCompleted } from '../services/jobReminderService';
import { logBeforePhotoStarted, logAfterPhotoCompleted, logPhotoCapture } from '../utils/analytics';

const initialDimensions = Dimensions.get('window');
const initialWidth = initialDimensions.width;
const initialHeight = initialDimensions.height;
const initialOrientation = initialWidth > initialHeight ? 'landscape' : 'portrait';

// Get initial specific orientation synchronously
const getInitialSpecificOrientation = () => {
  if (initialOrientation === 'portrait') {
    return 1; // PORTRAIT
  } else {
    // For landscape, default to LANDSCAPE_LEFT (3) - will be corrected immediately by async check
    return 3;
  }
};

export default function CameraScreen({ route, navigation }) {
  const { mode, beforePhoto, afterPhoto: existingAfterPhoto, combinedPhoto: existingCombinedPhoto, room: initialRoom } = route.params || {};
  const insets = useSafeAreaInsets();
  const [room, setRoom] = useState(initialRoom);
  const [facing, setFacing] = useState('back');
  const [enableTorch, setEnableTorch] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('4:3'); // '4:3' or '2:3'
  const [selectedBeforePhoto, setSelectedBeforePhoto] = useState(beforePhoto);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isProcessingAfter, setIsProcessingAfter] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showCarousel, setShowCarousel] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [fullScreenIndex, setFullScreenIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showEnlargedGallery, setShowEnlargedGallery] = useState(false);
  const [enlargedGalleryIndex, setEnlargedGalleryIndex] = useState(0);
  const [enlargedGalleryPhoto, setEnlargedGalleryPhoto] = useState(null);
  const [cameraViewMode, setCameraViewMode] = useState('portrait'); // 'portrait' or 'landscape'
  const [deviceOrientation, setDeviceOrientation] = useState(initialOrientation);
  const [specificOrientation, setSpecificOrientation] = useState(getInitialSpecificOrientation()); // 1=PORTRAIT, 3=LANDSCAPE_LEFT, 4=LANDSCAPE_RIGHT
  const [isGalleryAnimating, setIsGalleryAnimating] = useState(false);
  const [tempPhotoUri, setTempPhotoUri] = useState(null);
  const [tempPhotoLabel, setTempPhotoLabel] = useState(null);
  const [tempPhotoDimensions, setTempPhotoDimensions] = useState({ width: 1080, height: 1920 });
  const [showRoomIndicator, setShowRoomIndicator] = useState(false);
  const longPressGalleryTimer = useRef(null);
  const roomIndicatorTimer = useRef(null);
  const enlargedGalleryScrollRef = useRef(null);
  const completionAlertTimer = useRef(null); // Timer for "All Photos Taken" alert
  const tapStartTime = useRef(null);
  const [dimensions, setDimensions] = useState({ width: initialWidth, height: initialHeight });
  const lastTap = useRef(null);
  const longPressTimer = useRef(null);
  const cameraRef = useRef(null);
  const [pictureSize, setPictureSize] = useState('Photo'); // Use iOS preset for full resolution
  // Background label preparation is now handled by GlobalBackgroundLabelPreparation component
  // No local state needed - uses global service that stays mounted regardless of navigation
  const carouselScrollRef = useRef(null);
  const fullScreenScrollRef = useRef(null);
  const galleryScrollRef = useRef(null);
  const carouselTranslateY = useRef(new Animated.Value(0)).current;
  const enlargedGalleryTranslateY = useRef(new Animated.Value(0)).current;
  const galleryOpacity = useRef(new Animated.Value(0)).current;
  // Photo capture animation state
  const [captureAnimationUri, setCaptureAnimationUri] = useState(null);
  const captureAnimScale = useRef(new Animated.Value(1)).current;
  const captureAnimTranslateX = useRef(new Animated.Value(0)).current;
  const captureAnimTranslateY = useRef(new Animated.Value(0)).current;
  const captureAnimOpacity = useRef(new Animated.Value(1)).current;
  const thumbnailRef = useRef(null);
  const cameraContainerRef = useRef(null);
  const currentRoomRef = useRef(room);
  const dimensionsRef = useRef(dimensions);
  const showCarouselRef = useRef(showCarousel);
  const showGalleryRef = useRef(showGallery);
  const showEnlargedGalleryRef = useRef(showEnlargedGallery);
  const enlargedGalleryPhotoRef = useRef(enlargedGalleryPhoto);
  const isGalleryAnimatingRef = useRef(false);
  const { addPhoto, updatePhoto, getBeforePhotos, getUnpairedBeforePhotos, deletePhoto, setCurrentRoom, activeProjectId, createProject, setActiveProject, projects } = usePhotos();
  const {
    showLabels,
    shouldShowWatermark,
    getRooms,
    beforeLabelPosition,
    afterLabelPosition,
    beforeLabelPositionLandscape,
    afterLabelPositionLandscape,
    labelMarginVertical,
    labelMarginHorizontal,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelFontFamily,
    shutterSoundEnabled,
    toggleShutterSoundEnabled,
    userName,
    location,
  } = useSettings();

  // Vision Camera setup - request a multi-physical-lens logical device so we
  // can seamlessly zoom from the device's widest lens (0.5x on most phones,
  // 0.6x on Samsung S21 Ultra and similar) through the main + telephoto lenses.
  // This avoids hard-switching physical devices and lets `device.minZoom`
  // reflect whatever ultra-wide the actual hardware supports.
  const device = useCameraDevice(facing, {
    physicalDevices: [
      'ultra-wide-angle-camera',
      'wide-angle-camera',
      'telephoto-camera',
    ],
  });

  // Actual widest zoom this device supports (0.5 on iPhone/Pixel, ~0.6 on S21 Ultra, etc.).
  // Falls back to 1.0 if the device doesn't support ultra-wide.
  const deviceMinZoom = device?.minZoom ?? 1.0;
  const deviceNeutralZoom = device?.neutralZoom ?? 1.0;
  const hasUltraWide = deviceMinZoom < deviceNeutralZoom;
  // Some Samsung/Android lenses (especially ultra-wide) report no flash/torch support.
  // Guard all flash/torch usage by these caps to avoid runtime crashes.
  const supportsFlash = !!device?.hasFlash;
  const supportsTorch = device?.hasTorch != null ? !!device.hasTorch : supportsFlash;

  // If we switch to a lens that doesn't support torch, automatically turn off the toggle
  useEffect(() => {
    if (!supportsTorch && enableTorch) {
      setEnableTorch(false);
    }
  }, [supportsTorch, enableTorch]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (completionAlertTimer.current) {
        clearTimeout(completionAlertTimer.current);
      }
    };
  }, []);

  const { hasPermission, requestPermission } = useCameraPermission();
  const isFocused = useIsFocused();
  const [zoom, setZoom] = useState(1.0);
  // Once the device is known, snap zoom to the widest lens (ultra-wide) on
  // first load — matches the original default of opening at 0.5x / 0.6x.
  const didInitZoomRef = useRef(false);
  useEffect(() => {
    if (!didInitZoomRef.current && device && hasUltraWide) {
      setZoom(deviceMinZoom);
      didInitZoomRef.current = true;
    }
  }, [device, hasUltraWide, deviceMinZoom]);

  // Calculate target aspect ratio for format selection
  const targetAspectRatio = useMemo(() => {
    // Letterbox mode: always use 4:3 ratio
    if (cameraViewMode === 'landscape') {
      return 4 / 3;
    }

    // Full screen mode: match screen ratio
    const screenWidth = dimensions.width;
    const screenHeight = dimensions.height;
    const isLandscape = screenWidth > screenHeight;
    const ratio = isLandscape
      ? screenWidth / screenHeight
      : screenHeight / screenWidth;
    return ratio;
  }, [dimensions, cameraViewMode]);

  // Select best camera format
  // IMPORTANT: Consider BOTH photo resolution AND video/preview resolution
  // The preview stream uses video resolution, so low video resolution = blurry preview
  const format = useMemo(() => {
    if (!device?.formats) return undefined;

    // Find formats close to target aspect ratio
    const matchingFormats = device.formats.filter(f => {
      const formatRatio = Math.max(f.photoWidth, f.photoHeight) / Math.min(f.photoWidth, f.photoHeight);
      const diff = Math.abs(formatRatio - targetAspectRatio);
      return diff < 0.5;
    });

    let selected;
    if (matchingFormats.length > 0) {
      // Sort by video pixels first (for sharp preview), then photo pixels
      // Preview quality depends on video resolution, not photo resolution
      const sorted = matchingFormats.sort((a, b) => {
        const aVideoPixels = (a.videoWidth || 0) * (a.videoHeight || 0);
        const bVideoPixels = (b.videoWidth || 0) * (b.videoHeight || 0);
        // Prioritize high video resolution for sharp preview
        if (aVideoPixels !== bVideoPixels) {
          return bVideoPixels - aVideoPixels;
        }
        // Secondary: high photo resolution
        const aPhotoPixels = a.photoWidth * a.photoHeight;
        const bPhotoPixels = b.photoWidth * b.photoHeight;
        return bPhotoPixels - aPhotoPixels;
      });
      selected = sorted[0];
    } else {
      // Find closest ratio, prioritizing video resolution
      const withDiff = device.formats.map(f => {
        const formatRatio = Math.max(f.photoWidth, f.photoHeight) / Math.min(f.photoWidth, f.photoHeight);
        return {
          format: f,
          diff: Math.abs(formatRatio - targetAspectRatio),
          ratio: formatRatio,
          videoPixels: (f.videoWidth || 0) * (f.videoHeight || 0)
        };
      });

      withDiff.sort((a, b) => {
        if (Math.abs(a.diff - b.diff) < 0.01) {
          // Same aspect ratio - prioritize video resolution for sharp preview
          if (a.videoPixels !== b.videoPixels) {
            return b.videoPixels - a.videoPixels;
          }
          const aPhotoPixels = a.format.photoWidth * a.format.photoHeight;
          const bPhotoPixels = b.format.photoWidth * b.format.photoHeight;
          return bPhotoPixels - aPhotoPixels;
        }
        return a.diff - b.diff;
      });

      selected = withDiff[0].format;
    }

    if (selected) {
      const ratio = Math.max(selected.photoWidth, selected.photoHeight) / Math.min(selected.photoWidth, selected.photoHeight);
      console.log(`[CameraScreen] Selected format: photo=${selected.photoWidth}x${selected.photoHeight}, video=${selected.videoWidth || 'N/A'}x${selected.videoHeight || 'N/A'}, ratio=${ratio.toFixed(2)}`);
    }

    return selected;
  }, [device, targetAspectRatio]);

  // Get rooms from settings (custom or default)
  const rooms = getRooms();
  const labelViewRef = useRef(null);
  // Hidden vertical side-by-side base renderer
  const [isTakingPicture, setIsTakingPicture] = useState(false);
  const [showFullScreenPhoto, setShowFullScreenPhoto] = useState(null);
  const [layout, setLayout] = useState(null);

  // Helper function to get the active before photo based on current room and mode
  const getActiveBeforePhoto = () => {
    if (mode === 'after') {
      // After mode: show selectedBeforePhoto if set, otherwise beforePhoto if it matches current room
      return selectedBeforePhoto || (beforePhoto?.room === room ? beforePhoto : null);
    } else {
      // Before mode: show selectedBeforePhoto if matches room, otherwise show last photo from gallery
      if (selectedBeforePhoto?.room === room) {
        return selectedBeforePhoto;
      }
      const photos = getBeforePhotos(room);
      return photos.length > 0 ? photos[photos.length - 1] : null;
    }
  };

  // Update ref when room changes AND sync with global room state
  useEffect(() => {
    currentRoomRef.current = room;
    // Update global room state so HomeScreen shows the same room when camera closes
    setCurrentRoom(room);
  }, [room, setCurrentRoom]);

  // Log when navigating during processing (but don't block)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const unsubscribe = navigation.addListener('beforeRemove', () => {
      // Combined photos now use background service, so navigation is safe
    });

    return unsubscribe;
  }, [navigation]);

  // Cleanup: Turn off flashlight when component unmounts
  useEffect(() => {
    return () => {
      if (enableTorch) {
        setEnableTorch(false);
      }
    };
  }, []);

  // Update dimensions ref when dimensions change
  useEffect(() => {
    dimensionsRef.current = dimensions;
  }, [dimensions]);

  // Update showCarousel ref when showCarousel changes
  useEffect(() => {
    showCarouselRef.current = showCarousel;
  }, [showCarousel]);

  // Update showGallery ref when showGallery changes
  useEffect(() => {
    showGalleryRef.current = showGallery;
  }, [showGallery]);

  // Update showEnlargedGallery ref when it changes
  useEffect(() => {
    showEnlargedGalleryRef.current = showEnlargedGallery;
  }, [showEnlargedGallery]);

  // Update enlargedGalleryPhoto ref when it changes
  useEffect(() => {
    enlargedGalleryPhotoRef.current = enlargedGalleryPhoto;
  }, [enlargedGalleryPhoto]);

  // Scroll gallery to correct position when opening
  useEffect(() => {
    if (showGallery && galleryScrollRef.current) {
      setTimeout(() => {
        if (!galleryScrollRef.current) return;
        
        if (mode === 'after' && selectedBeforePhoto) {
          // In after mode, scroll to selected photo
          const photos = getUnpairedBeforePhotos(room);
          const index = photos.findIndex(p => p.id === selectedBeforePhoto.id);
          if (index !== -1) {
            galleryScrollRef.current.scrollTo({ x: index * 112, animated: false });
          }
        } else if (mode === 'before') {
          // In before mode, scroll to the LAST photo (newest, on the right)
          const photos = getBeforePhotos(room);
          if (photos.length > 0) {
            const lastIndex = photos.length - 1;
            const scrollX = lastIndex * 112;
            galleryScrollRef.current.scrollTo({ x: scrollX, animated: false });
          }
        }
      }, 50);
    }
  }, [showGallery, mode, room, selectedBeforePhoto]);

  // Scroll enlarged gallery to correct position when opening
  useEffect(() => {
    if (showEnlargedGallery && enlargedGalleryScrollRef.current) {
      setTimeout(() => {
        if (enlargedGalleryScrollRef.current) {
          // Scroll to the tapped photo index
          const scrollX = enlargedGalleryIndex * dimensions.width;
          enlargedGalleryScrollRef.current.scrollTo({ 
            x: scrollX, 
            animated: false 
          });
        }
      }, 50);
    }
  }, [showEnlargedGallery, enlargedGalleryIndex]);


  // Handle double tap
  const handleDoubleTap = () => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (lastTap.current && (now - lastTap.current) < DOUBLE_TAP_DELAY) {
      // Double tap detected
      const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
      const currentPhoto = mode === 'after' ? getActiveBeforePhoto() : getBeforePhotos(room)[getBeforePhotos(room).length - 1];
      const index = photos.findIndex(p => p.id === currentPhoto?.id);
      
      // Set index first, then show carousel
      setCarouselIndex(index >= 0 ? index : 0);
      
      // Use setTimeout to ensure index is set before carousel opens
      setTimeout(() => {
        carouselTranslateY.setValue(0);
      setShowCarousel(true);
      }, 10);
      
      lastTap.current = null;
    } else {
      lastTap.current = now;
    }
  };

  // Handle long press with delay
  const handleThumbnailPressIn = () => {
    // Clear any existing timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    // Set a timer for long press (500ms delay)
    longPressTimer.current = setTimeout(() => {
      // Set the index to current photo
      const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
      const currentPhoto = mode === 'after' ? getActiveBeforePhoto() : getBeforePhotos(room)[getBeforePhotos(room).length - 1];
      const index = photos.findIndex(p => p.id === currentPhoto?.id);
      setFullScreenIndex(index >= 0 ? index : 0);
      setIsFullScreen(true);
    }, 500);
  };

  const handleThumbnailPressOut = () => {
    // Clear the timer if user releases before long press is triggered
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Hide full screen
    setIsFullScreen(false);
  };

  // Handle thumbnail tap to toggle gallery (open/close)
  const handleThumbnailPress = () => {
    // If enlarged gallery is open, close it and return to full screen
    if (showEnlargedGalleryRef.current) {
      setEnlargedGalleryPhoto(null);
      setShowEnlargedGallery(false);
      setShowGallery(false);

      isGalleryAnimatingRef.current = true;
      setIsGalleryAnimating(true);

      Animated.timing(galleryOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true
      }).start(() => {
        isGalleryAnimatingRef.current = false;
        setIsGalleryAnimating(false);
      });
      return;
    }

    // If gallery is open, close it
    if (showGalleryRef.current) {
      isGalleryAnimatingRef.current = true;
      setIsGalleryAnimating(true);
      setShowGallery(false);

      Animated.timing(galleryOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true
      }).start(() => {
        isGalleryAnimatingRef.current = false;
        setIsGalleryAnimating(false);
      });
      return;
    }

    // Open gallery
    isGalleryAnimatingRef.current = true;
    setIsGalleryAnimating(true);
    setShowGallery(true);

    // Just show gallery with opacity animation - no scaling needed
    Animated.timing(galleryOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true
    }).start(() => {
      isGalleryAnimatingRef.current = false;
      setIsGalleryAnimating(false);
    });
  };

  // PanResponder for swipe-to-dismiss carousel (swipe DOWN)
  const carouselPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for vertical swipes (more vertical than horizontal)
        const { dx, dy } = gestureState;
        const isVertical = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20;
        if (isVertical) {
        }
        return isVertical;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        // Capture vertical gestures, let horizontal pass through to ScrollView
        const { dx, dy } = gestureState;
        return Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 20;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Only allow downward swipes (positive dy)
        if (gestureState.dy > 0) {
          carouselTranslateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        const threshold = 100; // Swipe down at least 100px to dismiss
        if (gestureState.dy > threshold) {
          // Dismiss carousel with animation - slide down
          Animated.timing(carouselTranslateY, {
            toValue: dimensionsRef.current.height,
            duration: 300,
            useNativeDriver: true
          }).start(() => {
            setShowCarousel(false);
            carouselTranslateY.setValue(0);
          });
        } else {
          // Spring back to original position
          Animated.spring(carouselTranslateY, {
            toValue: 0,
            useNativeDriver: true
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false
    })
  ).current;

  // PanResponder for closing camera (vertical swipe down)
  const cameraClosePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for vertical downward swipes (more vertical than horizontal)
        const { dx, dy } = gestureState;
        return Math.abs(dy) > Math.abs(dx) && dy > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't show movement - just detect threshold
      },
      onPanResponderRelease: (evt, gestureState) => {
        const threshold = 100; // Swipe down at least 100px to close
        if (gestureState.dy > threshold) {
          // Close camera immediately - native animation handles it
          navigation.goBack();
        }
      }
    })
  ).current;

  // PanResponder for room switching (horizontal swipes)
  const roomSwitchPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only activate for horizontal swipes
        return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30;
      },
      onPanResponderRelease: (evt, gestureState) => {
        const swipeThreshold = 50;
        const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
        let newRoomIndex;
        
        if (gestureState.dx > swipeThreshold) {
          // Swipe right - go to previous room (circular)
          newRoomIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
        } else if (gestureState.dx < -swipeThreshold) {
          // Swipe left - go to next room (circular)
          newRoomIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
        } else {
          return; // Not enough swipe distance
        }

        const newRoom = rooms[newRoomIndex].id;
        setRoom(newRoom);
        
        // Update thumbnail based on mode
        if (mode === 'after') {
          // For after mode, try to get first unpaired before photo
          const allBeforePhotos = getBeforePhotos(newRoom);
          if (allBeforePhotos.length > 0) {
            // Set to first before photo in the room
            setSelectedBeforePhoto(allBeforePhotos[0]);
          } else {
            // No before photos in this room
            setSelectedBeforePhoto(null);
            Alert.alert(
              'No Before Photos',
              `There are no before photos in ${rooms[newRoomIndex].name}. Please take a before photo first.`,
              [{ text: 'OK' }]
            );
          }
        } else {
          // For before mode, clear the selected photo (will show empty thumbnail)
          setSelectedBeforePhoto(null);
        }
      }
    })
  ).current;

  // Combined PanResponder that handles both swipe directions
  const combinedPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Don't capture gestures if carousel or gallery is open
        if (showCarouselRef.current) {
          return false;
        }
        if (showGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        // Vertical swipe down for closing camera
        if (Math.abs(dy) > Math.abs(dx) && dy > 10) {
          return true;
        }
        // Horizontal swipe for room switching
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 30) {
          return true;
        }
        return false;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't show movement - just detect threshold
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        
        // Check if it's a vertical swipe down (closing gesture)
        if (Math.abs(dy) > Math.abs(dx)) {
          const threshold = 100;
          if (dy > threshold) {
            // Close camera immediately - native animation handles it
            navigation.goBack();
          }
        } 
        // Check if it's a horizontal swipe (room switching)
        else if (Math.abs(dx) > Math.abs(dy)) {
          const swipeThreshold = 50;
          const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
          
          if (dx > swipeThreshold) {
            // Swipe right - go to previous room (circular)
            const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
            const newRoom = rooms[newIndex].id;
            setRoom(newRoom);
            if (mode === 'after') {
              const unpairedPhotos = getUnpairedBeforePhotos(newRoom);
              if (unpairedPhotos.length > 0) {
                setSelectedBeforePhoto(unpairedPhotos[0]);
              } else {
                setSelectedBeforePhoto(null);
              }
            }
          } else if (dx < -swipeThreshold) {
            // Swipe left - go to next room (circular)
            const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
            const newRoom = rooms[newIndex].id;
            setRoom(newRoom);
            if (mode === 'after') {
              const unpairedPhotos = getUnpairedBeforePhotos(newRoom);
              if (unpairedPhotos.length > 0) {
                setSelectedBeforePhoto(unpairedPhotos[0]);
              } else {
                setSelectedBeforePhoto(null);
              }
            }
          }
        }
      }
    })
  ).current;

  // Unified PanResponder for camera view (handles swipe up/down based on gallery state)
  const cameraViewPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Don't activate if carousel, fullscreen, or enlarged gallery/photo is open
        // NOTE: Allow gestures even when gallery is animating, so user can cancel the opening animation
        if (showCarouselRef.current || isFullScreen || enlargedGalleryPhotoRef.current || showEnlargedGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        
        // If gallery is shown, respond to swipe down from ANYWHERE or horizontal swipe
        if (showGalleryRef.current) {
          const gestureY = evt.nativeEvent.pageY;
          const screenHeight = dimensionsRef.current.height;
          const galleryTop = screenHeight * 0.6; // top of bottom gallery area
          const isTopArea = gestureY < galleryTop;
          const isSwipeDown = dy > 0 && (Math.abs(dy) >= Math.abs(dx) || Math.abs(dx) < 5);
          const isHorizontal = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5;
          // Only allow horizontal room switching from TOP area; bottom area horizontal should be handled by ScrollView
          return isSwipeDown || (isTopArea && isHorizontal);
        }
        
        // If gallery is NOT shown, respond to swipe up, swipe down, or horizontal swipes
        const isVerticalSwipe = Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10;
        const isHorizontalSwipe = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
        return isVerticalSwipe || isHorizontalSwipe;
      },
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        // Don't activate if carousel, fullscreen, or enlarged gallery/photo is open
        // NOTE: Allow gestures even when gallery is animating, so user can cancel the opening animation
        if (showCarouselRef.current || isFullScreen || enlargedGalleryPhotoRef.current || showEnlargedGalleryRef.current) {
          return false;
        }
        
        const { dx, dy } = gestureState;
        
        // When gallery is shown:
        // Capture strategy: be EXTREMELY aggressive to beat ScrollView
        if (showGalleryRef.current) {
          const gestureY = evt.nativeEvent.pageY;
          const screenHeight = dimensionsRef.current.height;
          const galleryTop = screenHeight * 0.6;
          const isBottomArea = gestureY >= galleryTop;
          
          // Gallery area (bottom 40%): Capture at the SLIGHTEST vertical movement
          // We need to capture before ScrollView claims it
          if (isBottomArea) {
            // ANY downward movement, even 0.1px, as long as it's not clearly horizontal
            const isDownward = dy > 0;
            const notClearlyHorizontal = Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 5;
            if (isDownward && notClearlyHorizontal) {
              return true;
            }
            // Don't capture horizontal gestures - let ScrollView handle them
            return false;
          }
          
          // Camera area (top 60%): Standard capture for vertical/horizontal
          const isVertical = dy > 2 && Math.abs(dy) > Math.abs(dx);
          const isHorizontal = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;
          if (isVertical || isHorizontal) {
            return true;
          }
          
          return false;
        }
        
        return (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) || 
               (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        
        // If gallery is shown, handle swipes
        if (showGalleryRef.current) {
          // Vertical swipe down - close gallery (reduced threshold for better responsiveness)
          if (Math.abs(dy) > Math.abs(dx) && dy > 20) {
            // Stop any ongoing animations immediately
            galleryOpacity.stopAnimation();

            // Set animating flag to block new gestures
            isGalleryAnimatingRef.current = true;
            setIsGalleryAnimating(true);

            // Update state immediately before animation
            setShowGallery(false);

            // Only animate gallery opacity - no camera scaling
            Animated.timing(galleryOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true
            }).start(() => {
              galleryOpacity.setValue(0);

              // Add small delay before allowing next gesture
              setTimeout(() => {
                isGalleryAnimatingRef.current = false;
                setIsGalleryAnimating(false);
              }, 100);
            });
            return;
          }
          
          // Horizontal swipe - switch rooms (in half-screen mode, reduced threshold)
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            // Only switch rooms if the gesture started in the TOP camera area
            const startY = gestureState.y0;
            const galleryTop = dimensionsRef.current.height * 0.6;
            if (startY >= galleryTop) {
              return;
            }
            const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
            
            if (dx > 0) {
              // Swipe right - previous room
              const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
              const newRoom = rooms[newIndex].id;
              setRoom(newRoom);
              if (mode === 'after') {
                const beforePhotos = getBeforePhotos(newRoom);
                if (beforePhotos.length > 0) {
                  setSelectedBeforePhoto(beforePhotos[0]);
                } else {
                  setSelectedBeforePhoto(null);
                  Alert.alert(
                    'No Before Photos',
                    `There are no before photos in ${rooms[newIndex].name}. Please take a before photo first.`,
                    [{ text: 'OK' }]
                  );
                }
              }
            } else {
              // Swipe left - next room
              const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
              const newRoom = rooms[newIndex].id;
              setRoom(newRoom);
              if (mode === 'after') {
                const beforePhotos = getBeforePhotos(newRoom);
                if (beforePhotos.length > 0) {
                  setSelectedBeforePhoto(beforePhotos[0]);
                } else {
                  setSelectedBeforePhoto(null);
                  Alert.alert(
                    'No Before Photos',
                    `There are no before photos in ${rooms[newIndex].name}. Please take a before photo first.`,
                    [{ text: 'OK' }]
                  );
                }
              }
            }
            return;
          }
        }
        
        // If gallery is NOT shown, handle all gestures
        if (!showGalleryRef.current) {
          // Check for vertical swipe
          if (Math.abs(dy) > Math.abs(dx)) {
            // Swipe down - close camera
            if (dy > 100) {
              navigation.goBack();
              return;
            }
            // Swipe up - show gallery
            if (dy < -100) {
              // Set animating flag
              isGalleryAnimatingRef.current = true;
              setIsGalleryAnimating(true);
              setShowGallery(true);

              // Only animate gallery opacity - no camera scaling
              Animated.timing(galleryOpacity, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true
              }).start(() => {
                setTimeout(() => {
                  isGalleryAnimatingRef.current = false;
                  setIsGalleryAnimating(false);
                }, 100);
              });
              return;
            }
          }
          
          // Check for horizontal swipe (room switching, reduced threshold)
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
            const currentIndex = rooms.findIndex(r => r.id === currentRoomRef.current);
            
            if (dx > 0) {
              // Swipe right - previous room
              const newIndex = currentIndex > 0 ? currentIndex - 1 : rooms.length - 1;
              const newRoom = rooms[newIndex].id;
              setRoom(newRoom);
              if (mode === 'after') {
                const beforePhotos = getBeforePhotos(newRoom);
                if (beforePhotos.length > 0) {
                  setSelectedBeforePhoto(beforePhotos[0]);
                } else {
                  setSelectedBeforePhoto(null);
                  Alert.alert(
                    'No Before Photos',
                    `There are no before photos in ${rooms[newIndex].name}. Please take a before photo first.`,
                    [{ text: 'OK' }]
                  );
                }
              } else {
                setSelectedBeforePhoto(null);
              }
            } else {
              // Swipe left - next room
              const newIndex = currentIndex < rooms.length - 1 ? currentIndex + 1 : 0;
              const newRoom = rooms[newIndex].id;
              setRoom(newRoom);
              if (mode === 'after') {
                const beforePhotos = getBeforePhotos(newRoom);
                if (beforePhotos.length > 0) {
                  setSelectedBeforePhoto(beforePhotos[0]);
                } else {
                  setSelectedBeforePhoto(null);
                  Alert.alert(
                    'No Before Photos',
                    `There are no before photos in ${rooms[newIndex].name}. Please take a before photo first.`,
                    [{ text: 'OK' }]
                  );
                }
              } else {
                setSelectedBeforePhoto(null);
              }
            }
          }
        }
      },
      onPanResponderTerminationRequest: () => false
    })
  ).current;

  // PanResponder for swipe down on enlarged gallery carousel
  const enlargedGalleryPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        const { dy } = gestureState;
        return showEnlargedGalleryRef.current && dy > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        // Don't animate movement - just detect swipe down gesture
        // This prevents visual sliding that would flash the gallery underneath
      },
      onPanResponderRelease: (evt, gestureState) => {
        const { dy } = gestureState;
        const threshold = 80;
        
        if (dy > threshold) {
          // Clear both states immediately (same as cross button)
          setEnlargedGalleryPhoto(null);
          setShowEnlargedGallery(false);
        }
        // If swipe wasn't strong enough, just ignore it (no spring back animation needed)
      }
    })
  ).current;

  // Detect screen rotation and update dimensions
  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) => {
      const newOrientation = window.width > window.height ? 'landscape' : 'portrait';
      // Update dimensions immediately for instant response
      setDimensions({ width: window.width, height: window.height });
      setDeviceOrientation(newOrientation);
      
      // Also update specificOrientation to match if there's a clear portrait/landscape change
      if (newOrientation === 'portrait') {
        setSpecificOrientation(1); // Force to portrait
      }
      // For landscape, let the ScreenOrientation listener handle the specific value (3 or 4)
    });

    // Get specific orientation (landscape-left vs landscape-right)
    const getSpecificOrientation = async () => {
      const orientation = await ScreenOrientation.getOrientationAsync();
      setSpecificOrientation(orientation);
    };
    
    const orientationSubscription = ScreenOrientation.addOrientationChangeListener((event) => {
      const orientation = event.orientationInfo.orientation;
      const orientationNames = {
        1: 'PORTRAIT',
        2: 'PORTRAIT_UPSIDE_DOWN',
        3: 'LANDSCAPE_LEFT (counter-clockwise)',
        4: 'LANDSCAPE_RIGHT (clockwise)'
      };
      // Cross-check with dimensions to ensure consistency
      const currentDims = Dimensions.get('window');
      const currentOrientation = currentDims.width > currentDims.height ? 'landscape' : 'portrait';
      
      if (currentOrientation === 'portrait' && (orientation === 3 || orientation === 4)) {
        setSpecificOrientation(1);
      } else if (currentOrientation === 'landscape' && orientation === 1) {
        // Keep the landscape orientation (3 or 4) - don't force to portrait
      } else {
        // Update immediately - native rotation is already smooth
        setSpecificOrientation(event.orientationInfo.orientation);
      }
    });
    
    // Get orientation immediately on mount
    getSpecificOrientation();

    // Cleanup listener on unmount
    return () => {
      subscription?.remove();
      ScreenOrientation.removeOrientationChangeListener(orientationSubscription);
    };
  }, []);

  // Track when cameraViewMode state changes
  useEffect(() => {
  }, [cameraViewMode]);

  // Track when aspectRatio state changes
  useEffect(() => {
  }, [aspectRatio]);

  // Handle screen focus/blur to re-check permissions and settings
  useFocusEffect(
    useCallback(() => {
      if (!hasPermission) {
        requestPermission();
      }
    }, [hasPermission, requestPermission, dimensions, deviceOrientation, cameraViewMode, aspectRatio, pictureSize, mode])
  );

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission]);

  // Force orientation check on mount to ensure correct initial state
  // Show room indicator when room changes (but not on initial mount)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    // Clear any existing timer
    if (roomIndicatorTimer.current) {
      clearTimeout(roomIndicatorTimer.current);
    }
    
    // Show indicator
    setShowRoomIndicator(true);
    
    // Hide after 500ms
    roomIndicatorTimer.current = setTimeout(() => {
      setShowRoomIndicator(false);
      roomIndicatorTimer.current = null;
    }, 500);
    
    return () => {
      if (roomIndicatorTimer.current) {
        clearTimeout(roomIndicatorTimer.current);
      }
    };
  }, [room]);

  useEffect(() => {
    const checkOrientation = async () => {
      // Delay to ensure screen transition is complete and stable
      setTimeout(async () => {
        const orientation = await ScreenOrientation.getOrientationAsync();
        const currentDims = Dimensions.get('window');
        const currentOrientation = currentDims.width > currentDims.height ? 'landscape' : 'portrait';
        // Cross-check: If dimensions say portrait but API says landscape (or vice versa), trust dimensions
        if (currentOrientation === 'portrait' && (orientation === 3 || orientation === 4)) {
          setSpecificOrientation(1);
        } else if (currentOrientation === 'landscape' && orientation === 1) {
          setSpecificOrientation(3);
        } else {
          setSpecificOrientation(orientation);
        }
      }, 250);
    };
    checkOrientation();
  }, []);

  // Initialize selectedBeforePhoto from beforePhoto if not set
  useEffect(() => {
    if (mode === 'after' && beforePhoto && !selectedBeforePhoto) {
      setSelectedBeforePhoto(beforePhoto);
    }
  }, [mode, beforePhoto]);

  // Check if there are before photos when entering after mode
  useEffect(() => {
    if (mode === 'after' && !beforePhoto && !selectedBeforePhoto) {
      const allBeforePhotos = getBeforePhotos(room);
      if (allBeforePhotos.length > 0) {
        // Set to first before photo in the room
        setSelectedBeforePhoto(allBeforePhotos[0]);
      }
    }
  }, [mode, room]);

  // Calculate and set aspect ratio for before mode (iOS portrait)
  useEffect(() => {
    if (mode === 'before' && Platform.OS === 'ios' && cameraViewMode === 'portrait') {
      const screenWidth = dimensions.width;
      const screenHeight = dimensions.height;
      const ratio = deviceOrientation === 'landscape'
        ? screenWidth / screenHeight
        : screenHeight / screenWidth;
      const calculatedRatio = `${ratio.toFixed(2)}:1`;
      setAspectRatio(calculatedRatio);
    } else if (mode === 'before' && Platform.OS === 'ios' && cameraViewMode === 'landscape') {
      setAspectRatio('4:3');
    } else if (mode === 'before' && Platform.OS === 'android') {
      const androidRatio = cameraViewMode === 'landscape' ? '4:3' : '9:16';
      setAspectRatio(androidRatio);
    }
  }, [mode, cameraViewMode, dimensions, deviceOrientation]);

  // Set aspect ratio to match before photo in after mode
  useEffect(() => {
    if (mode === 'after') {
      const activeBeforePhoto = getActiveBeforePhoto();
      if (activeBeforePhoto) {
        if (activeBeforePhoto.aspectRatio) {
          setAspectRatio(activeBeforePhoto.aspectRatio);
        }
      }
    }
  }, [selectedBeforePhoto, mode, beforePhoto]);

  // In after mode, camera view mode should match the before photo's camera view mode
  useEffect(() => {
    if (mode === 'after') {
      const activeBeforePhoto = getActiveBeforePhoto();
      if (activeBeforePhoto && activeBeforePhoto.cameraViewMode) {
        // Prefer the camera view mode that was used when taking the before photo
        setCameraViewMode(activeBeforePhoto.cameraViewMode);
      } else {
        // Fallback: keep current mode but align with device orientation if unset
        setCameraViewMode(prev => prev || deviceOrientation);
      }
    }
  }, [mode, deviceOrientation, selectedBeforePhoto]);

  // Log when selectedBeforePhoto changes in after mode
  useEffect(() => {
    if (mode === 'after' && selectedBeforePhoto) {
    }
  }, [selectedBeforePhoto, mode, deviceOrientation]);

  // Ensure carousel starts at correct position
  useEffect(() => {
    if (showCarousel && carouselScrollRef.current) {
      // Small delay to ensure ScrollView is rendered, then force scroll to position
      requestAnimationFrame(() => {
        carouselScrollRef.current?.scrollTo({
          x: carouselIndex * dimensions.width,
          y: 0,
          animated: false
        });
      });
    }
  }, [showCarousel]);

  useEffect(() => {
    if (route.params?.beforePhoto) {
      setSelectedBeforePhoto(route.params.beforePhoto);
    }
    // Analytics removed for build compatibility
  }, [route.params]);

  useEffect(() => {
    const getPermissions = async () => {
      if (hasPermission) return;
      requestPermission();
    };
    getPermissions();
  }, [hasPermission, requestPermission]);

  // Using pictureSize="Photo" + skipProcessing=true for maximum resolution without preview scaling

  const takePicture = async () => {
    if (!cameraRef.current || isCapturing || !device) return;

    // Check orientation mismatch for after mode
    if (isOrientationMismatch()) {
      const beforeOrientation = getActiveBeforePhoto()?.orientation || 'portrait';
      Alert.alert(
        'Wrong Orientation',
        `The before photo was taken in ${beforeOrientation} mode. Please rotate your phone to ${beforeOrientation} orientation to match.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setIsCapturing(true);

      // Auto-create a project on first photo if none exists
      if (!activeProjectId && projects.length === 0) {
        try {
          const locationDisplay = getLocationName(location);
          const name = createAlbumName((userName || '').trim() || 'Project', new Date(), null, locationDisplay);
          const safeName = name.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
          const proj = await createProject(safeName);
          if (proj?.id) {
            await setActiveProject(proj.id);
          }
        } catch (e) {
          console.error('[CameraScreen] Failed to auto-create project:', e);
        }
      }

      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'quality',
        // Only request flash if the current device reports flash support
        flash: enableTorch && supportsFlash ? 'on' : 'off',
        enableShutterSound: shutterSoundEnabled
      });
      const photoUri = `file://${photo.path}`;

      // Start capture animation (runs in parallel with photo processing)
      runCaptureAnimation(photoUri);

      if (mode === 'before') {
        await handleBeforePhoto(photoUri);
      } else if (mode === 'after') {
        await handleAfterPhoto(photoUri);
      } else if (mode === 'progress') {
        await handleProgressPhoto(photoUri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take picture');
    } finally {
      setIsCapturing(false);
    }
  };

  // Pick a photo from the device gallery
  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const pickedAsset = result.assets[0];
      const photoUri = pickedAsset.uri;

      // Auto-create project if needed (same as takePicture)
      if (!activeProjectId && projects.length === 0) {
        try {
          const locationDisplay = getLocationName(location);
          const name = createAlbumName((userName || '').trim() || 'Project', new Date(), null, locationDisplay);
          const safeName = name.replace(/[^\p{L}\p{N}_\- ]/gu, '_');
          const proj = await createProject(safeName);
          if (proj?.id) {
            await setActiveProject(proj.id);
          }
        } catch (e) {
          console.error('[CameraScreen] Failed to auto-create project:', e);
        }
      }

      if (mode === 'before') {
        await handleBeforePhoto(photoUri);
      } else if (mode === 'after') {
        setIsProcessingAfter(true);
        try {
          await handleAfterPhoto(photoUri);
        } finally {
          setIsProcessingAfter(false);
        }
      } else if (mode === 'progress') {
        await handleProgressPhoto(photoUri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to pick photo from gallery');
    }
  };

  // Animate captured photo flying to thumbnail
  const runCaptureAnimation = useCallback((photoUri) => {
    // Reset animation values
    captureAnimScale.setValue(1);
    captureAnimTranslateX.setValue(0);
    captureAnimTranslateY.setValue(0);
    captureAnimOpacity.setValue(1);

    // Set the captured photo URI to show the overlay
    setCaptureAnimationUri(photoUri);

    const screenWidth = dimensions.width;
    const screenHeight = dimensions.height;

    // The animated image starts centered on screen (due to justifyContent/alignItems center)
    // Thumbnail is in bottom controls area: left side, near bottom of screen
    // Bottom controls: paddingBottom: 20, mainControlRow has 3 equal buttonContainers

    // Thumbnail dimensions (now 68x68 square)
    const thumbnailSize = 68;

    // The overlay image is 100% width and 70% height, centered
    // Starting center: (screenWidth/2, screenHeight/2)
    const startCenterX = screenWidth / 2;
    const startCenterY = screenHeight / 2;

    let thumbnailCenterX, thumbnailCenterY;

    if (deviceOrientation === 'landscape') {
      // In landscape mode, the UI layer is counter-rotated to keep buttons fixed.
      // The animation overlay is NOT rotated, so we need to calculate where
      // the thumbnail appears in actual screen coordinates.
      //
      // specificOrientation: 3 = LANDSCAPE_LEFT (phone rotated counter-clockwise)
      //   - UI rotated +90deg, buttons appear on RIGHT side of screen
      //   - Thumbnail (first in row) appears at BOTTOM-RIGHT of screen
      //
      // specificOrientation: 4 = LANDSCAPE_RIGHT (phone rotated clockwise)
      //   - UI rotated -90deg, buttons appear on LEFT side of screen
      //   - Thumbnail (first in row) appears at TOP-LEFT of screen
      //
      if (specificOrientation === 4) {
        // LANDSCAPE_RIGHT: thumbnail is at BOTTOM-RIGHT
        thumbnailCenterX = screenWidth - 60 - (thumbnailSize / 2);
        thumbnailCenterY = screenHeight - 60 - (thumbnailSize / 2);
      } else {
        // LANDSCAPE_LEFT: thumbnail is at TOP-LEFT
        thumbnailCenterX = 60 + (thumbnailSize / 2);
        thumbnailCenterY = 60 + (thumbnailSize / 2);
      }
    } else {
      // Portrait mode: thumbnail is always on the left
      thumbnailCenterX = screenWidth / 6;
      thumbnailCenterY = screenHeight - 60 - (thumbnailSize / 2);
    }

    // Calculate required translation (target - start)
    const targetX = thumbnailCenterX - startCenterX;
    const targetY = thumbnailCenterY - startCenterY;

    // Scale: from full size to thumbnail size
    const imageHeight = screenHeight * 0.7; // 70% as per style
    const targetScale = thumbnailSize / imageHeight;

    // Run the animation
    Animated.parallel([
      Animated.timing(captureAnimScale, {
        toValue: targetScale,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(captureAnimTranslateX, {
        toValue: targetX,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(captureAnimTranslateY, {
        toValue: targetY,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(250),
        Animated.timing(captureAnimOpacity, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      // Clear the animation URI when done
      setCaptureAnimationUri(null);
    });
  }, [dimensions, cameraViewMode, deviceOrientation, specificOrientation, captureAnimScale, captureAnimTranslateX, captureAnimTranslateY, captureAnimOpacity]);

  // Helper function to prepare combined photo with labels in background
  // Now uses global service that stays mounted regardless of navigation
  const prepareCombinedPhotoInBackground = (combinedPhoto, beforePhoto, afterPhoto, settingsHash, isLetterbox) => {
    return new Promise((resolve, reject) => {
      if (!combinedPhoto || !beforePhoto || !afterPhoto) {
        resolve();
        return;
      }

      try {
        // Get dimensions of combined photo
        // Image.getSize returns actual file pixel dimensions for local file:// URIs.
        // No PixelRatio conversion needed - native module loads the same file and gets the same dimensions.
        Image.getSize(combinedPhoto.uri, (width, height) => {
          console.log(`[CameraScreen] Combined photo dimensions: ${width}x${height}`);

          // Queue preparation in global service (stays mounted regardless of navigation)
          backgroundLabelPreparationService.queuePreparation({
            photo: combinedPhoto,
            beforePhoto,
            afterPhoto,
            width,
            height,
            settingsHash,
            isLetterbox,
            combinedLayout: combinedPhoto.combinedLayout,
            beforeLabelPosition: beforeLabelPosition || 'top-left',
            afterLabelPosition: afterLabelPosition || 'top-right',
            isCombined: true,
            resolve,
            reject,
          });
        }, (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  // Helper function to prepare labeled photo in background and save to cache
  // Now uses global service that stays mounted regardless of navigation
  const prepareLabeledPhotoInBackground = (photo, settingsHash, mode) => {
    return new Promise((resolve, reject) => {
      if (!photo || !photo.uri || !photo.id) {
        resolve();
        return;
      }

      try {
        // Get image dimensions
        // Image.getSize returns actual file pixel dimensions for local file:// URIs.
        // No PixelRatio conversion needed - native module loads the same file and gets the same dimensions.
        Image.getSize(photo.uri, (width, height) => {
          console.log(`[CameraScreen] Single photo dimensions: ${width}x${height}`);

          // Determine label position based on photo mode
          let labelPosition;
          if (mode === 'before') {
            labelPosition = beforeLabelPosition || 'top-left';
          } else if (mode === 'after') {
            labelPosition = afterLabelPosition || 'top-right';
          } else {
            labelPosition = 'top-left';
          }

          // Queue preparation in global service (stays mounted regardless of navigation)
          backgroundLabelPreparationService.queuePreparation({
            photo,
            width,
            height,
            labelPosition,
            settingsHash,
            mode,
            resolve,
            reject,
          });
        }, (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  };

  // Background label preparation is now handled by GlobalBackgroundLabelPreparation component
  // No local useEffect hooks needed - the global component stays mounted regardless of navigation

  // Helper function to add label to photo
  const addLabelToPhoto = async (uri, labelText) => {
    return uri; // Temporarily disabled
    
    if (!showLabels) {
      return uri;
    }

    try {
      // Get image dimensions
      return new Promise((resolve) => {
        Image.getSize(uri, async (width, height) => {
          setTempPhotoDimensions({ width, height });
          setTempPhotoUri(uri);
          setTempPhotoLabel(labelText);
          
          // Wait for next frame to ensure view is rendered
          setTimeout(async () => {
            try {
              if (labelViewRef.current) {
                const capturedUri = await captureRef(labelViewRef, {
                  format: 'jpg',
                  quality: 0.95,
                  width,
                  height
                });
                setTempPhotoUri(null);
                setTempPhotoLabel(null);
                setTempPhotoDimensions({ width: 1080, height: 1920 });
                resolve(capturedUri);
              } else {
                setTempPhotoUri(null);
                setTempPhotoLabel(null);
                setTempPhotoDimensions({ width: 1080, height: 1920 });
                resolve(uri);
              }
            } catch (error) {
              setTempPhotoUri(null);
              setTempPhotoLabel(null);
              setTempPhotoDimensions({ width: 1080, height: 1920 });
              resolve(uri);
            }
          }, 300);
        }, (error) => {
          resolve(uri);
        });
      });
    } catch (error) {
      return uri;
    }
  };

  const handleBeforePhoto = async (uri) => {
    try {
      // Generate photo name
      const roomPhotos = getBeforePhotos(room);
      const photoNumber = roomPhotos.length + 1;
      const photoName = `${room.charAt(0).toUpperCase() + room.slice(1)} ${photoNumber}`;

      // Capture device orientation (actual phone orientation)
      const currentOrientation = deviceOrientation;


      // Calculate aspect ratio and crop if needed
      let aspectRatio;
      let processedUri = uri;

      // Get original image dimensions first
      let imageInfo;
      try {
        imageInfo = await new Promise((resolve, reject) => {
          Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
        });
      } catch (error) {
        console.error('[CameraScreen] Failed to get image dimensions:', error);
        imageInfo = null;
      }

      if (cameraViewMode === 'landscape') {
        // Letterbox mode: Camera captures at native 4:3, no cropping needed
        aspectRatio = '4:3';
        processedUri = uri;

        if (imageInfo) {
          console.log('[CameraScreen] Letterbox - Device orientation:', deviceOrientation);
          console.log('[CameraScreen] Letterbox - Photo dimensions (native 4:3):', imageInfo);
        }
      } else {
        // Full screen mode: Save the full sensor output without cropping
        // Determine aspect ratio based on actual photo dimensions
        if (imageInfo) {
          if (imageInfo.width > imageInfo.height) {
            // Landscape photo
            const ratio = imageInfo.width / imageInfo.height;
            if (ratio >= 1.7) {
              aspectRatio = '16:9';
            } else {
              aspectRatio = '4:3';
            }
          } else {
            // Portrait photo
            const ratio = imageInfo.height / imageInfo.width;
            if (ratio >= 1.7) {
              aspectRatio = '9:16';
            } else {
              aspectRatio = '3:4';
            }
          }
        } else {
          // Fallback if we can't get dimensions
          aspectRatio = deviceOrientation === 'landscape' ? '4:3' : '3:4';
        }
        // No cropping - save full sensor output
        processedUri = uri;
      }

      // Save processed photo to device
      const savedUri = await savePhotoToDevice(processedUri, `${room}_${photoName}_BEFORE_${Date.now()}.jpg`, activeProjectId || null);

      // Add to photos with device orientation AND camera view mode
      const newPhoto = {
        id: Date.now(),
        uri: savedUri,
        room,
        mode: PHOTO_MODES.BEFORE,
        name: photoName,
        timestamp: Date.now(),
        aspectRatio: aspectRatio,
        orientation: currentOrientation,
        cameraViewMode: cameraViewMode // Save the camera view mode
      };

      await addPhoto(newPhoto);
      logPhotoCapture('before', 'camera', activeProjectId);
      logBeforePhotoStarted(activeProjectId, 'camera');
      onBeforePhotoTaken(newPhoto).catch(() => {}); // schedule job reminder (non-blocking)

      // Update selectedBeforePhoto so thumbnail shows immediately
      setSelectedBeforePhoto(newPhoto);

      // Prepare labeled photo in background immediately after before photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels && newPhoto && newPhoto.id && newPhoto.uri) {
        // Queue immediately - no cache check (photo was just taken, can't be cached)
        try {
          const settingsHash = calculateSettingsHash({
            showLabels,
            beforeLabelPosition,
            afterLabelPosition,
            beforeLabelPositionLandscape,
            afterLabelPositionLandscape,
            labelBackgroundColor: labelBackgroundColor || null,
            labelTextColor: labelTextColor || null,
            labelSize: labelSize || null,
            labelFontFamily: labelFontFamily || null,
            labelMarginVertical,
            labelMarginHorizontal,
          });
          prepareLabeledPhotoInBackground(newPhoto, settingsHash, 'before');
        } catch (error) {
          console.warn('[CameraScreen] Failed to queue before label preparation:', error);
        }
      }

      // Stay in before mode to allow taking more photos
      // User can close camera to see photos in home grid
    } catch (error) {
      Alert.alert('Error', 'Failed to save photo');
    }
  };

  // Progress capture: single-shot, never paired, never combined. The user
  // stays in camera after capture so they can take several in a row; a Done
  // button (rendered when mode === 'progress') returns them to the section
  // detail screen. No background label preparation is queued — progress
  // photos are kept clean/raw per spec.
  const handleProgressPhoto = async (uri) => {
    try {
      const currentOrientation = deviceOrientation;
      let imageInfo = null;
      try {
        imageInfo = await new Promise((resolve, reject) => {
          Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
        });
      } catch {}

      let aspectRatio;
      if (cameraViewMode === 'landscape') {
        aspectRatio = '4:3';
      } else if (imageInfo) {
        if (imageInfo.width > imageInfo.height) {
          aspectRatio = (imageInfo.width / imageInfo.height) >= 1.7 ? '16:9' : '4:3';
        } else {
          aspectRatio = (imageInfo.height / imageInfo.width) >= 1.7 ? '9:16' : '3:4';
        }
      } else {
        aspectRatio = deviceOrientation === 'landscape' ? '4:3' : '3:4';
      }

      const photoName = `progress_${Date.now()}`;
      const savedUri = await savePhotoToDevice(
        uri,
        `${room}_${photoName}_PROGRESS_${Date.now()}.jpg`,
        activeProjectId || null
      );

      const newPhoto = {
        id: Date.now(),
        uri: savedUri,
        room,
        mode: PHOTO_MODES.PROGRESS,
        name: photoName,
        timestamp: Date.now(),
        aspectRatio,
        orientation: currentOrientation,
        cameraViewMode,
      };

      await addPhoto(newPhoto);
      logPhotoCapture('progress', 'camera', activeProjectId);
      // Stay in camera so the user can take more progress photos quickly.
      // The Done button in the camera UI exits back to the caller.
    } catch (error) {
      Alert.alert('Error', 'Failed to save progress photo');
    }
  };

  const handleAfterPhoto = async (uri) => {
    const startTime = Date.now();
    console.log('[DEBUG] [start] handleAfterPhoto started');
    try {
      // Get the active before photo
      const activeBeforePhoto = getActiveBeforePhoto();

      if (!activeBeforePhoto) {
        Alert.alert('Error', 'Please select a before photo first');
        return;
      }

      const beforePhotoId = activeBeforePhoto.id;
      // Sequential progression: a previous after becomes a progress photo in
      // the same set (retains beforePhotoId so the gallery still groups it).
      // The combined image is rebuilt from the new after, so the old one goes.
      if (existingAfterPhoto) {
        const deleteStart = Date.now();
        await updatePhoto(existingAfterPhoto.id, { mode: PHOTO_MODES.PROGRESS });
        console.log(`[DEBUG] â±ï¸Demote previous after to progress: ${Date.now() - deleteStart}ms`);
      }
      if (existingCombinedPhoto) {
        const deleteStart = Date.now();
        await deletePhoto(existingCombinedPhoto.id);
        console.log(`[DEBUG] â±ï¸ Delete existing combined photo: ${Date.now() - deleteStart}ms`);
      }

      // Crop after photo to match before photo's camera view mode
      let processedUri = uri;
      const beforeCameraViewMode = activeBeforePhoto.cameraViewMode || 'portrait';

      if (beforeCameraViewMode === 'landscape') {
        // Letterbox mode: Camera captures at native 4:3, no cropping needed
        processedUri = uri;
      } else {
        // Full screen mode: Save full sensor output to match before photo (no cropping)
        processedUri = uri;
      }

      // Save processed photo to device
      const savedUri = await savePhotoToDevice(
        processedUri,
        `${activeBeforePhoto.room}_${activeBeforePhoto.name}_AFTER_${Date.now()}.jpg`,
        activeProjectId || null
      );

      // Add after photo (use same aspect ratio, orientation, and camera view mode as before photo)
      const newAfterPhoto = {
        id: Date.now(),
        uri: savedUri,
        room: activeBeforePhoto.room,
        mode: PHOTO_MODES.AFTER,
        name: activeBeforePhoto.name,
        timestamp: Date.now(),
        beforePhotoId: beforePhotoId,
        aspectRatio: activeBeforePhoto.aspectRatio || '4:3',
        orientation: activeBeforePhoto.orientation || deviceOrientation,
        cameraViewMode: activeBeforePhoto.cameraViewMode || 'portrait'
      };
      await addPhoto(newAfterPhoto);
      logPhotoCapture('after', 'camera', activeProjectId);
      const timeSinceBefore = activeBeforePhoto?.timestamp ? Math.round((Date.now() - activeBeforePhoto.timestamp) / 1000) : null;
      logAfterPhotoCompleted(activeProjectId, timeSinceBefore);
      onAfterPhotoCompleted(beforePhotoId).catch(() => {}); // cancel job reminder (non-blocking)

      // Check if all photos are paired BEFORE starting background processing
      // This prevents UI freeze when showing the "All Photos Taken" alert
      const remainingUnpaired = getUnpairedBeforePhotos(activeBeforePhoto.room);
      const nextUnpaired = remainingUnpaired.filter(p => p.id !== beforePhotoId);
      const allPhotosPaired = nextUnpaired.length === 0;

      // Mark that we're processing after photo (for visual feedback)
      // Button is now active, but we show different visual state to indicate background processing
      setIsProcessingAfter(true);

      // Clear processing state after combined photo creation starts (it's non-blocking)
      // This gives visual feedback that background processing is happening
      setTimeout(() => {
        setIsProcessingAfter(false);
      }, 300); // Short delay just for visual feedback

      // Prepare labeled photo in background IMMEDIATELY after after photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels && newAfterPhoto && newAfterPhoto.id && newAfterPhoto.uri) {
        // Queue immediately - no setTimeout, no cache check (photo was just taken, can't be cached)
        try {
          const settingsHash = calculateSettingsHash({
            showLabels,
            beforeLabelPosition,
            afterLabelPosition,
            beforeLabelPositionLandscape,
            afterLabelPositionLandscape,
            labelBackgroundColor: labelBackgroundColor || null,
            labelTextColor: labelTextColor || null,
            labelSize: labelSize || null,
            labelFontFamily: labelFontFamily || null,
            labelMarginVertical,
            labelMarginHorizontal,
          });
          // Don't await - just queue it for background processing
          prepareLabeledPhotoInBackground(newAfterPhoto, settingsHash, 'after');
        } catch (error) {
          console.warn('[CameraScreen] Failed to queue label preparation:', error);
        }
      }

      // Create combined photo in background (non-blocking)
      // Use setTimeout with 100ms delay to give UI time to become responsive
      setTimeout(() => {
        (async () => {
          try {
            // Measure original sizes
            // On Android, Image.getSize returns dp (density-independent pixels), not actual file pixels.
            // We must multiply by PixelRatio to get actual pixel dimensions for creating full-resolution combined photos.
            // The native compositor will then create a combined photo at these full dimensions.
            const pixelRatio = Platform.OS === 'android' ? PixelRatio.get() : 1;
            const getSize = (u) => new Promise((resolve) => {
              Image.getSize(u, (w, h) => resolve({
                w: Math.round(w * pixelRatio),
                h: Math.round(h * pixelRatio)
              }), () => resolve({ w: 1080, h: 1920 }));
            });
            const aSize = await getSize(activeBeforePhoto.uri);
            const bSize = await getSize(savedUri);
            console.log(`[CameraScreen] Combined photo source sizes: before=${aSize.w}x${aSize.h}, after=${bSize.w}x${bSize.h}`);
          const beforeOrientation = activeBeforePhoto.orientation || 'portrait';
          const cameraVM = activeBeforePhoto.cameraViewMode || 'portrait';
          const isLandscapePair = beforeOrientation === 'landscape' || cameraVM === 'landscape';

          // Letterbox mode: cameraViewMode === 'landscape' (4:3 camera view with bars)
          const isLetterboxMode = cameraVM === 'landscape';
          const isLetterboxPortrait = beforeOrientation === 'portrait' && cameraVM === 'landscape';
          const isLetterboxLandscape = beforeOrientation === 'landscape' && cameraVM === 'landscape';

          // Determine layout FIRST before calculating dimensions
          // Letterbox portrait (portrait phone + landscape camera): SIDE layout
          // Letterbox landscape (landscape phone + landscape camera): STACK layout
          // Landscape full (landscape phone + portrait/full camera): STACK layout
          const layout = isLetterboxPortrait ? 'SIDE' : (isLandscapePair ? 'STACK' : 'SIDE');
          const isStackLayout = layout === 'STACK';

          // Force 1:1 square output for Instagram/social media compatibility
          const sourceMaxWidth = Math.max(aSize.w, bSize.w);
          const totalW = Math.min(Math.max(sourceMaxWidth, 2048), 4096);
          const totalH = totalW; // 1:1 square

          let dimsLocal;
          if (isStackLayout) {
            // STACK: split height equally between top and bottom
            const topH = Math.round(totalH / 2);
            const bottomH = totalH - topH;
            dimsLocal = { width: totalW, height: totalH, topH, bottomH };
          } else {
            // SIDE-BY-SIDE: split width equally between left and right
            const leftW = Math.round(totalW / 2);
            const rightW = totalW - leftW;
            dimsLocal = { width: totalW, height: totalH, leftW, rightW };
          }

          const safeName = (activeBeforePhoto.name || 'Photo').replace(/\s+/g, '_');
          const baseType = layout;
          const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

          // Create both STACK and SIDE layouts only for letterbox mode (portrait/landscape phone + landscape camera view)
          // For landscape full (landscape phone + portrait/full camera view), only create STACK
          const shouldCreateBothLayouts = isLetterboxMode;

          if (Platform.OS === 'ios') {
            // iOS: use native image compositor
            try {
              console.log('[CameraScreen] [layout] compositeImages start', Platform.OS, {
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                dims: dimsLocal,
                beforeSize: aSize,
                afterSize: bSize,
                beforeOrientation,
                cameraVM,
                isLandscapePair,
                shouldCreateBothLayouts,
              });
              const capUri = await compositeImages(
                activeBeforePhoto.uri,
                savedUri,
                layout,
                dimsLocal
              );
              console.log('[CameraScreen] [OK] compositeImages success', Platform.OS, layout, capUri);

              const combinedPhotoSavedUri = await savePhotoToDevice(
                capUri,
                `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${baseType}_${Date.now()}${projectIdSuffix}.jpg`,
                activeProjectId || null
              );
              console.log('[CameraScreen] Primary combined base saved', Platform.OS, layout, combinedPhotoSavedUri);

              // Store combined photo in context so upload can use it directly (no filesystem scanning needed)
              if (combinedPhotoSavedUri) {
                const combinedPhotoId = `combined_${activeBeforePhoto.id}`;
                const combinedPhoto = {
                  id: combinedPhotoId,
                  mode: PHOTO_MODES.COMBINED,
                  uri: combinedPhotoSavedUri,
                  name: activeBeforePhoto.name,
                  room: activeBeforePhoto.room,
                  projectId: activeProjectId,
                  beforePhotoId: activeBeforePhoto.id,
                  combinedLayout: layout,
                  timestamp: Date.now(),
                };
                await addPhoto(combinedPhoto);

                // Prepare labeled combined photo in background (non-blocking)
                if (showLabels) {
                  try {
                    const settingsHash = calculateSettingsHash({
                      showLabels,
                      beforeLabelPosition,
                      afterLabelPosition,
                      beforeLabelPositionLandscape,
                      afterLabelPositionLandscape,
                      labelBackgroundColor: labelBackgroundColor || null,
                      labelTextColor: labelTextColor || null,
                      labelSize: labelSize || null,
                      labelFontFamily: labelFontFamily || null,
                      labelMarginVertical,
                      labelMarginHorizontal,
                    });
                    // Queue immediately - no cache check (combined was just created)
                    prepareCombinedPhotoInBackground(
                      combinedPhoto,
                      activeBeforePhoto,
                      newAfterPhoto,
                      settingsHash,
                      isLetterboxMode
                    );
                  } catch (error) {
                    console.warn('[CameraScreen] Failed to queue combined label preparation:', error);
                  }
                }
              }

              // For landscape pairs, also create the alternate layout (STACK <-> SIDE)
              if (shouldCreateBothLayouts) {
                try {
                  const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                  console.log(`[CameraScreen] [layout] Creating ${alternateLayout} layout (alternate to ${layout})`);

                  let alternateDims;
                  if (alternateLayout === 'SIDE') {
                    // Prepare side-by-side dims
                    const r1wLB = aSize.w / aSize.h;
                    const r2wLB = bSize.w / bSize.h;
                    const denomLB = (r1wLB + r2wLB) || 1;
                    const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                    const leftWLB = Math.round(totalW * (r1wLB / denomLB));
                    const rightWLB = totalW - leftWLB;
                    alternateDims = { width: totalW, height: totalHLB, leftW: leftWLB, rightW: rightWLB };
                  } else {
                    // Prepare stack dims
                    const r1h = aSize.h / aSize.w;
                    const r2h = bSize.h / bSize.w;
                    const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                    const topH = Math.round(totalW * r1h);
                    const bottomH = totalH - topH;
                    alternateDims = { width: totalW, height: totalH, topH, bottomH };
                  }

                  console.log(`[CameraScreen] [layout] ${alternateLayout} layout dims:`, alternateDims);
                  const capUriLB = await compositeImages(
                    activeBeforePhoto.uri,
                    savedUri,
                    alternateLayout,
                    alternateDims
                  );
                  console.log(`[CameraScreen] [OK] ${alternateLayout} layout composite success:`, capUriLB);

                  const altSavedUri = await savePhotoToDevice(
                    capUriLB,
                    `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${alternateLayout}_${Date.now()}${projectIdSuffix}.jpg`,
                    activeProjectId || null
                  );
                  console.log(`[CameraScreen] [saved] ${alternateLayout} layout saved:`, altSavedUri);
                } catch (eLB) {
                  console.error(`[CameraScreen] âŒ Failed to create ${alternateLayout || 'alternate'} layout:`, eLB);
                  console.error(`[CameraScreen] ${alternateLayout || 'alternate'} layout error details:`, {
                    message: eLB.message,
                    stack: eLB.stack,
                    beforeUri: activeBeforePhoto.uri,
                    afterUri: savedUri,
                  });
                }
              }
            } catch (captureError) {
              console.error('[CameraScreen] âŒ Combined photo creation failed:', captureError);
              console.error('[CameraScreen] Error details:', {
                message: captureError.message,
                stack: captureError.stack,
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                dims: dimsLocal,
              });
              Alert.alert('Error', `Failed to create combined photo: ${captureError.message || 'Unknown error'}`);
            }
          } else if (Platform.OS === 'android') {
            // Android: Try to use native compositor, fallback to background service if not available
            const hasNativeCompositor = isNativeCompositorAvailable();
            console.log(`[CameraScreen][Android] Native compositor available: ${hasNativeCompositor}`);

            if (!hasNativeCompositor) {
              // Fallback to background service
              console.log('[CameraScreen][Android] Using background service fallback');
              const MAX_DIMENSION = 2048;
              let limitedWidth = dimsLocal.width;
              let limitedHeight = dimsLocal.height;

              if (limitedWidth > MAX_DIMENSION || limitedHeight > MAX_DIMENSION) {
                const scale = Math.min(MAX_DIMENSION / limitedWidth, MAX_DIMENSION / limitedHeight);
                limitedWidth = Math.round(limitedWidth * scale);
                limitedHeight = Math.round(limitedHeight * scale);
              }

              const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

              backgroundCombinedPhotoService.addJob({
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                width: limitedWidth,
                height: limitedHeight,
                room: activeBeforePhoto.room,
                safeName,
                projectId: activeProjectId || null,
                projectIdSuffix,
                jobId: `${Date.now()}_${layout}`,
              });

              if (shouldCreateBothLayouts) {
                const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                let altWidth, altHeight;

                if (alternateLayout === 'SIDE') {
                  const r1wLB = aSize.w / aSize.h;
                  const r2wLB = bSize.w / bSize.h;
                  const denomLB = (r1wLB + r2wLB) || 1;
                  const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                  altWidth = totalW;
                  altHeight = totalHLB;
                } else {
                  const r1h = aSize.h / aSize.w;
                  const r2h = bSize.h / bSize.w;
                  const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                  altWidth = totalW;
                  altHeight = totalH;
                }

                let limitedAltWidth = altWidth;
                let limitedAltHeight = altHeight;

                if (limitedAltWidth > MAX_DIMENSION || limitedAltHeight > MAX_DIMENSION) {
                  const scaleAlt = Math.min(MAX_DIMENSION / limitedAltWidth, MAX_DIMENSION / limitedAltHeight);
                  limitedAltWidth = Math.round(limitedAltWidth * scaleAlt);
                  limitedAltHeight = Math.round(limitedAltHeight * scaleAlt);
                }

                backgroundCombinedPhotoService.addJob({
                  beforeUri: activeBeforePhoto.uri,
                  afterUri: savedUri,
                  layout: alternateLayout,
                  width: limitedAltWidth,
                  height: limitedAltHeight,
                  room: activeBeforePhoto.room,
                  safeName,
                  projectId: activeProjectId || null,
                  projectIdSuffix,
                  jobId: `${Date.now() + 1}_${alternateLayout}`,
                });
              }
            } else {
              // Use native compositor
              try {
                const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

                // Create primary layout (STACK for landscape, SIDE for portrait)
                console.log(`[CameraScreen][Android] Creating ${layout} layout with native compositor`);

                const capUri = await compositeImages(
                  activeBeforePhoto.uri,
                  savedUri,
                  layout,
                  dimsLocal
                );

              const combinedPhotoSavedUri = await savePhotoToDevice(
                capUri,
                `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${layout}_${Date.now()}${projectIdSuffix}.jpg`,
                activeProjectId || null
              );

              console.log(`[CameraScreen][Android] ${layout} combined photo saved:`, combinedPhotoSavedUri);

              // Store combined photo in context so upload can use it directly (no filesystem scanning needed)
              if (combinedPhotoSavedUri) {
                const combinedPhotoId = `combined_${activeBeforePhoto.id}`;
                const combinedPhoto = {
                  id: combinedPhotoId,
                  mode: PHOTO_MODES.COMBINED,
                  uri: combinedPhotoSavedUri,
                  name: activeBeforePhoto.name,
                  room: activeBeforePhoto.room,
                  projectId: activeProjectId,
                  beforePhotoId: activeBeforePhoto.id,
                  combinedLayout: layout,
                  timestamp: Date.now(),
                };
                await addPhoto(combinedPhoto);

                // Prepare labeled combined photo in background (non-blocking)
                if (showLabels) {
                  try {
                    const settingsHash = calculateSettingsHash({
                      showLabels,
                      beforeLabelPosition,
                      afterLabelPosition,
                      beforeLabelPositionLandscape,
                      afterLabelPositionLandscape,
                      labelBackgroundColor: labelBackgroundColor || null,
                      labelTextColor: labelTextColor || null,
                      labelSize: labelSize || null,
                      labelFontFamily: labelFontFamily || null,
                      labelMarginVertical,
                      labelMarginHorizontal,
                    });
                    // Queue immediately - no cache check (combined was just created)
                    prepareCombinedPhotoInBackground(
                      combinedPhoto,
                      activeBeforePhoto,
                      newAfterPhoto,
                      settingsHash,
                      isLetterboxMode
                    );
                  } catch (error) {
                    console.warn('[CameraScreen][Android] Failed to queue combined label preparation:', error);
                  }
                }
              }

              // For letterbox modes, also create the alternate layout (STACK <-> SIDE)
              if (shouldCreateBothLayouts) {
                const alternateLayout = layout === 'STACK' ? 'SIDE' : 'STACK';
                console.log(`[CameraScreen][Android] Creating ${alternateLayout} layout (alternate to ${layout})`);

                let altWidth, altHeight, altDims;
                if (alternateLayout === 'SIDE') {
                  // Prepare side-by-side dims
                  const r1wLB = aSize.w / aSize.h;
                  const r2wLB = bSize.w / bSize.h;
                  const denomLB = (r1wLB + r2wLB) || 1;
                  const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                  altWidth = totalW;
                  altHeight = totalHLB;

                  const lw = Math.round(altWidth * (r1wLB / denomLB));
                  const rw = altWidth - lw;
                  altDims = {
                    width: altWidth,
                    height: altHeight,
                    leftW: lw,
                    rightW: rw,
                  };
                } else {
                  // Prepare stack dims
                  const r1h = aSize.h / aSize.w;
                  const r2h = bSize.h / bSize.w;
                  const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
                  altWidth = totalW;
                  altHeight = totalH;

                  const th = Math.round(altHeight * (r1h / (r1h + r2h)));
                  const bh = altHeight - th;
                  altDims = {
                    width: altWidth,
                    height: altHeight,
                    topH: th,
                    bottomH: bh,
                  };
                }

                const altCapUri = await compositeImages(
                  activeBeforePhoto.uri,
                  savedUri,
                  alternateLayout,
                  altDims
                );

                const altCombinedPhotoSavedUri = await savePhotoToDevice(
                  altCapUri,
                  `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${alternateLayout}_${Date.now()}${projectIdSuffix}.jpg`,
                  activeProjectId || null
                );

                console.log(`[CameraScreen][Android] [OK] ${alternateLayout} combined photo saved:`, altCombinedPhotoSavedUri);
              }
              } catch (compositeError) {
                console.error('[CameraScreen][Android] âŒ Combined photo creation failed:', compositeError);
                console.error('[CameraScreen][Android] Error details:', {
                  message: compositeError.message,
                  stack: compositeError.stack,
                  beforeUri: activeBeforePhoto.uri,
                  afterUri: savedUri,
                  layout,
                  dims: dimsLocal,
                });
                Alert.alert('Error', `Failed to create combined photo: ${compositeError.message || 'Unknown error'}`);
              }
            }
          }
        } catch (error) {
        }
        })();
      }, 100); // 100ms delay to give UI time to become responsive

      // If we're replacing an existing combined photo, navigate to PhotoEditor to recreate it
      if (existingCombinedPhoto) {
        navigation.navigate('PhotoEditor', {
          beforePhoto: activeBeforePhoto,
          afterPhoto: newAfterPhoto
        });
        return;
      }

      // Show "All Photos Taken" alert or advance to next photo
      // This happens immediately without waiting for background processing
      if (allPhotosPaired) {
        // All photos paired - show alert and navigate immediately
        Alert.alert(
          'All Photos Taken',
          'All after photos have been captured!',
          [
            {
              text: 'OK',
              onPress: () => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                }
              }
            }
          ]
        );
      } else {
        // Auto-advance to next unpaired photo (immediate)
        setSelectedBeforePhoto(nextUnpaired[0]);
      }
      console.log('[DEBUG] [OK] handleAfterPhoto completed');
    } catch (error) {
      Alert.alert('Error', 'Failed to save photo');
    }
  };

  const toggleCameraFacing = () => {
    setFacing(current => {
      const newFacing = current === 'back' ? 'front' : 'back';
      // Turn off flashlight when switching to front camera
      if (newFacing === 'front' && enableTorch) {
        setEnableTorch(false);
      }
      return newFacing;
    });
  };

  // Android combined photos are now handled by GlobalBackgroundCombinedPhotoCreator
  // No local processor needed - jobs are queued to the background service

  // Get current room info
  const getCurrentRoomInfo = () => {
    return rooms.find(r => r.id === room) || rooms[0];
  };

  // Check if orientation matches for after mode
  const isOrientationMismatch = () => {
    if (mode !== 'after') return false;
    
    const activeBeforePhoto = getActiveBeforePhoto();
    if (!activeBeforePhoto) {
      return false;
    }
    
    const beforeOrientation = activeBeforePhoto.orientation || 'portrait';
    // In after mode, device orientation must match before photo orientation
    const mismatch = beforeOrientation !== deviceOrientation;
    return mismatch;
  };

  // Render overlay mode (current implementation)
  const renderOverlayMode = () => (
              <View
      style={styles.container}
      {...cameraViewPanResponder.panHandlers}
    >
      {/* Camera view content - scale transform is applied by parent Animated.View */}
      <View style={styles.cameraWrapper}>
        {/* Orientation mismatch warning */}
        {(() => {
          const mismatch = isOrientationMismatch();
          return mismatch;
        })() && (
          <View style={styles.orientationWarning}>
            <Text style={styles.rotatePhoneIcon}>🔄</Text>
            <Text style={styles.orientationWarningText}>Rotate Phone!</Text>
            <Text style={styles.orientationWarningHint}>
              Before photo was taken in {getActiveBeforePhoto()?.orientation || 'portrait'} mode. 
              Please rotate your device.
            </Text>
        </View>
        )}

      {/* Camera preview with before photo overlay (for after mode) */}
      <View style={styles.cameraContainer}>
          {/* Letterbox container for landscape mode */}
          {(() => {
            const showLetterbox = cameraViewMode === 'landscape';
            return showLetterbox;
          })() ? (
            <View
              key={`letterbox-${deviceOrientation}`}
              style={[
                styles.letterboxContainer,
                deviceOrientation === 'landscape' ? styles.letterboxContainerLandscape : null
              ]}>
              {/* First bar - top for portrait, left for landscape */}
              <View style={deviceOrientation === 'landscape' ? styles.letterboxBarHorizontal : styles.letterboxBar} />
              
              {/* Camera in landscape aspect ratio */}
              <View style={[
                styles.letterboxCamera,
                deviceOrientation === 'landscape' ? styles.letterboxCameraLandscape : null
              ]}>
                {layout && device && (
                  <Camera
                    ref={cameraRef}
                    style={styles.camera}
                    device={device}
                    format={format}
                    isActive={isFocused}
                    photo={true}
                    zoom={zoom}
                    enableZoomGesture={false}
                // Only enable torch when the current device reports torch/flash support
                torch={enableTorch && supportsTorch ? 'on' : 'off'}
                    resizeMode="cover"
                  />
                )}

                {/* Before photo overlay (for after mode) */}
                {mode === 'after' && getActiveBeforePhoto() && (
                  <View style={styles.beforePhotoOverlay}>
                    <Image
                      source={{ uri: getActiveBeforePhoto().uri }}
                      style={styles.beforePhotoImage}
                      resizeMode="cover"
                    />
                  </View>
                )}
              </View>

              {/* Second bar - bottom for portrait, right for landscape */}
              <View style={deviceOrientation === 'landscape' ? styles.letterboxBarHorizontal : styles.letterboxBar} />
            </View>
          ) : (
            // Full-screen camera preview on both platforms when not in letterbox mode
            <View style={{ flex: 1 }}>
              {layout && device && (
                <Camera
                  ref={cameraRef}
                  style={styles.camera}
                  device={device}
                  format={format}
                  isActive={isFocused}
                  photo={true}
                  zoom={zoom}
                  enableZoomGesture={false}
                  // Only enable torch when the current device reports torch/flash support
                  torch={enableTorch && supportsTorch ? 'on' : 'off'}
                  resizeMode="cover"
                />
              )}
              
              {/* Before photo overlay (for after mode) */}
              {mode === 'after' && getActiveBeforePhoto() && (
                <View style={styles.beforePhotoOverlay}>
                  <Image
                    source={{ uri: getActiveBeforePhoto().uri }}
                    style={styles.beforePhotoImage}
                    resizeMode="cover"
                  />
                </View>
              )}
            </View>
          )}
        </View>
      </View>


      {/* Fixed UI Layer - doesn't rotate with device */}
      <Animated.View style={[
        styles.fixedUILayer,
        // Counter-rotate to keep UI fixed to screen geometry
        // LANDSCAPE_LEFT (3) = buttons should be on RIGHT (counter-rotate -90)
        specificOrientation === 3 && {
          transform: [{ rotate: '90deg' }],
          width: dimensions.height,
          height: dimensions.width,
          left: (dimensions.width - dimensions.height) / 2,
          top: (dimensions.height - dimensions.width) / 2
        },
        // LANDSCAPE_RIGHT (4) = buttons should be on LEFT (counter-rotate +90)
        specificOrientation === 4 && {
          transform: [{ rotate: '-90deg' }],
          width: dimensions.height,
          height: dimensions.width,
          left: (dimensions.width - dimensions.height) / 2,
          top: (dimensions.height - dimensions.width) / 2
        }
      ]} pointerEvents="box-none">
        {/* Room name and mode - single segmented pill (Kitchen | Before) */}
        <View style={styles.roomModeContainer}>
          <View style={styles.roomModePillWrapper}>
            <TouchableOpacity style={styles.roomButton} activeOpacity={0.8}>
              <Text style={styles.roomButtonText}>{getCurrentRoomInfo().name}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modeButton} activeOpacity={0.8}>
              <Text style={styles.modeButtonText}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sound toggle button - left of flash button */}
        <TouchableOpacity
          style={styles.soundButton}
          onPress={toggleShutterSoundEnabled}
          activeOpacity={0.7}
        >
          <Ionicons
            name={shutterSoundEnabled ? "volume-high-outline" : "volume-mute-outline"}
            size={20}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        {/* Torch toggle button - rightmost */}
        {facing === 'back' && (
          <TouchableOpacity
            style={styles.torchButton}
            onPress={() => {
              if (!supportsTorch) {
                Alert.alert(
                  'Flash Not Available',
                  'The selected camera lens does not support flash on this device. Try switching to the 1x camera.'
                );
                return;
              }
              setEnableTorch(!enableTorch);
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={enableTorch ? "flash" : "flash-outline"}
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        )}


        <View style={[styles.bottomControls, { paddingBottom: Math.max(20, insets.bottom + 10) }]}>
          {/* Controls row above capture - aspect ratio & zoom */}
          <View style={styles.controlsRowAboveCapture}>
            {/* Aspect ratio selector - only in before mode */}
            {mode === 'before' && (
              <View style={styles.aspectRatioSelector}>
                <TouchableOpacity
                  style={[styles.aspectRatioButtonBottom, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomActive]}
                  onPress={() => setCameraViewMode('portrait')}
                >
                  <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'portrait' && styles.aspectRatioButtonBottomTextActive]}>9:16</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.aspectRatioButtonBottom, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomActive]}
                  onPress={() => setCameraViewMode('landscape')}
                >
                  <Text style={[styles.aspectRatioButtonBottomText, cameraViewMode === 'landscape' && styles.aspectRatioButtonBottomTextActive]}>3:4</Text>
                </TouchableOpacity>
              </View>
            )}
            {/* Zoom controls — ultra-wide button uses device.minZoom so devices
                like Samsung S21 Ultra (which only goes to 0.6x) still work. */}
            <View style={styles.zoomControlsBottom}>
              {hasUltraWide && (
                <TouchableOpacity
                  style={[styles.zoomButtonBottom, zoom < deviceNeutralZoom && styles.zoomButtonBottomActive]}
                  onPress={() => setZoom(deviceMinZoom)}
                >
                  <Text style={[styles.zoomButtonBottomText, zoom < deviceNeutralZoom && styles.zoomButtonBottomTextActive]}>
                    {`${deviceMinZoom.toFixed(1)}X`}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.zoomButtonBottom, zoom >= deviceNeutralZoom && zoom < 2 && styles.zoomButtonBottomActive]}
                onPress={() => setZoom(deviceNeutralZoom)}
              >
                <Text style={[styles.zoomButtonBottomText, zoom >= deviceNeutralZoom && zoom < 2 && styles.zoomButtonBottomTextActive]}>1X</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.zoomButtonBottom, zoom >= 2 && styles.zoomButtonBottomActive]}
                onPress={() => setZoom(2.0)}
              >
                <Text style={[styles.zoomButtonBottomText, zoom >= 2 && styles.zoomButtonBottomTextActive]}>2X</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Main control row */}
          <View style={styles.mainControlRow}>
            {/* Left container - Thumbnail */}
            <View style={styles.buttonContainer}>
              {(() => {
                const activePhoto = getActiveBeforePhoto();

                if (activePhoto) {
                  return (
                    <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait
                      ]}
                      activeOpacity={1}
                      onPress={handleThumbnailPress}
                      onPressIn={handleThumbnailPressIn}
                      onPressOut={handleThumbnailPressOut}
                    >
                      <View style={styles.thumbnailInnerRing}>
                        <Image
                          source={{ uri: activePhoto.uri }}
                          style={styles.thumbnailViewerImage}
                          resizeMode="cover"
                        />
                      </View>
                    </TouchableOpacity>
                  );
                } else {
                  // Show empty placeholder - also opens gallery on press
                  return (
                    <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait
                      ]}
                      activeOpacity={0.7}
                      onPress={handleThumbnailPress}
                    >
                      <View style={styles.thumbnailInnerRing} />
                    </TouchableOpacity>
                  );
                }
              })()}
            </View>

            {/* Center container - Capture button */}
            <View style={[styles.buttonContainer, styles.captureButtonContainer]}>
              {/* Capture button */}
              <TouchableOpacity
                style={[
                  styles.captureButton,
                  (isOrientationMismatch() || isCapturing) && styles.captureButtonDisabled,
                  isProcessingAfter && styles.captureButtonProcessing
                ]}
                onPress={takePicture}
                disabled={isOrientationMismatch() || isCapturing}
              >
                {isCapturing ? (
                  <ActivityIndicator size="large" color={COLORS.PRIMARY} />
                ) : isProcessingAfter ? (
                  <View style={styles.captureButtonProcessingContent}>
                    <ActivityIndicator size="small" color={COLORS.PRIMARY} />
                    <Text style={styles.captureButtonProcessingText}>Processing...</Text>
                  </View>
                ) : isOrientationMismatch() ? (
                  <Text style={styles.captureButtonWarning}>🔄</Text>
                ) : (
                  <Ionicons name="camera" size={38} color="#000" />
                )}
              </TouchableOpacity>
            </View>

            {/* Right container - Done / return button. In Progress mode this
                returns to the SectionDetail screen instead of resetting to
                Home, so the user keeps the section context they came from. */}
            <View style={styles.buttonContainer}>
              <View style={styles.checkmarkButtonBorder}>
                <TouchableOpacity
                  style={styles.checkmarkButton}
                  onPress={() => {
                    if (mode === 'progress') {
                      if (navigation.canGoBack && navigation.canGoBack()) {
                        navigation.goBack();
                      } else {
                        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                      }
                    } else {
                      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-undo" size={32} color="#000000" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Gallery at bottom - shown when swiping up (hidden when enlarged gallery is open) */}
      {showGallery && !showEnlargedGallery && (
        <Animated.View 
          style={[
            styles.bottomGallery,
            {
              opacity: galleryOpacity,
              height: dimensions.height * 0.41
            }
          ]}
        >
          <Text style={styles.galleryTitle}>
            {mode === 'before' ? `${getCurrentRoomInfo().name} Photos` : 'Before Photos'}
          </Text>
          {(() => {
            const photos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
            
            if (photos.length === 0) {
              return (
                <View style={styles.galleryEmpty}>
                  <Text style={styles.galleryEmptyText}>
                    {mode === 'before' ? 'No photos yet' : 'All photos paired'}
                  </Text>
      </View>
              );
            }
            
            return (
              <ScrollView
                ref={galleryScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={112} // Gallery item width (100) + gap (12)
                decelerationRate="fast"
                snapToAlignment="center"
                scrollEventThrottle={16}
                directionalLockEnabled={true}
                onMomentumScrollEnd={(event) => {
                  // Only update state in after mode (for auto-selection)
                  if (mode === 'after') {
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const index = Math.round(offsetX / 112);
                    if (photos[index]) {
                      setSelectedBeforePhoto(photos[index]);
                    }
                  }
                }}
                contentContainerStyle={styles.galleryContent}
              >
                {photos.map((photo, index) => (
                <View
                  key={photo.id}
                  style={[
                    styles.galleryItem,
                    mode === 'after' && selectedBeforePhoto?.id === photo.id && styles.galleryItemSelected
                  ]}
                >
      <TouchableOpacity
                    activeOpacity={0.7}
                    delayPressIn={50}
                    onPressIn={() => {
                      // Track tap start time
                      tapStartTime.current = Date.now();
                      
                      // Start long press timer for full-screen
                      longPressGalleryTimer.current = setTimeout(() => {
                        setEnlargedGalleryPhoto(photo);
                      }, 300);
                    }}
                    onPressOut={() => {
                      const pressDuration = Date.now() - (tapStartTime.current || 0);
                      
                      // Cancel long press timer
                      if (longPressGalleryTimer.current) {
                        clearTimeout(longPressGalleryTimer.current);
                        longPressGalleryTimer.current = null;
                      }
                      
                      // If full-screen photo is showing, close it
                      if (enlargedGalleryPhoto) {
                        setEnlargedGalleryPhoto(null);
                      }
                      // If it was a quick tap (< 300ms)
                      else if (pressDuration < 300) {
                        if (mode === 'before') {
                          // Before mode: tap opens enlarged carousel immediately
                          setEnlargedGalleryIndex(index);
                          setShowEnlargedGallery(true);
                        } else if (mode === 'after') {
                          // After mode: first tap selects, second tap (on already selected) opens enlarged carousel
                          if (selectedBeforePhoto?.id === photo.id) {
                            // Already selected - open enlarged carousel
                            setEnlargedGalleryIndex(index);
                            setShowEnlargedGallery(true);
                          } else {
                            // Not selected yet - just select it
                            setSelectedBeforePhoto(photo);
                          }
                        }
                      }
                      
                      tapStartTime.current = null;
                    }}
                  >
                    <View>
                <Image
                        source={{ uri: photo.uri }}
                        style={styles.galleryImage}
                  resizeMode="cover"
                />
                      <Text style={styles.galleryItemName} numberOfLines={1}>
                        {photo.name}
                      </Text>
                    </View>
              </TouchableOpacity>
                </View>
              ))}
              </ScrollView>
            );
          })()}
        </Animated.View>
      )}

      {/* Android combined photos are now handled by GlobalBackgroundCombinedPhotoCreator */}

      {/* Enlarged gallery carousel - shown when tapping a gallery item */}
      {showEnlargedGallery && (() => {
        const photos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
        
        return (
          <Animated.View 
            style={[
              styles.enlargedGalleryContainer,
              {
                height: dimensions.height * 0.41
              }
            ]}
            {...enlargedGalleryPanResponder.panHandlers}
          >
            {/* Close button - top right */}
            <TouchableOpacity
              style={styles.enlargedGalleryCloseButton}
              onPress={() => {
                // Clear both states immediately
                setEnlargedGalleryPhoto(null);
                setShowEnlargedGallery(false);
              }}
            >
              <Text style={styles.enlargedGalleryCloseText}>X</Text>
            </TouchableOpacity>

            {/* Delete button - top left */}
      <TouchableOpacity
              style={styles.enlargedGalleryDeleteButton}
        onPress={async () => {
                const currentPhoto = photos[enlargedGalleryIndex];
                if (!currentPhoto) return;
                await deletePhoto(currentPhoto.id);

                // Close enlarged gallery and refresh
                setEnlargedGalleryPhoto(null);
                setShowEnlargedGallery(false);

                // If no more photos, close gallery
                const remainingPhotos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
                if (remainingPhotos.length === 0) {
                  setShowGallery(false);
                }
              }}
            >
              <Ionicons name="trash-outline" size={24} color="#EF4444" />
      </TouchableOpacity>
            <ScrollView
              ref={enlargedGalleryScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(event) => {
                // Only update state in after mode (for auto-selection)
                if (mode === 'after') {
                  const offsetX = event.nativeEvent.contentOffset.x;
                  const index = Math.round(offsetX / dimensions.width);
                  if (photos[index]) {
                    setSelectedBeforePhoto(photos[index]);
                  }
                }
              }}
            >
              {photos.map((photo, index) => (
                <TouchableWithoutFeedback
                  key={photo.id}
                  onPressIn={() => {
                    // Track when the press started
                    tapStartTime.current = Date.now();
                    
                    // Start long press timer for full-screen
                    longPressGalleryTimer.current = setTimeout(() => {
                      setEnlargedGalleryPhoto(photo);
                    }, 300);
                  }}
                  onPressOut={() => {
                    const pressDuration = Date.now() - (tapStartTime.current || 0);
                    
                    // Cancel long press timer if released early
                    if (longPressGalleryTimer.current) {
                      clearTimeout(longPressGalleryTimer.current);
                      longPressGalleryTimer.current = null;
                    }
                    
                    // If full-screen photo is showing, close it on release
                    if (enlargedGalleryPhoto) {
                      setEnlargedGalleryPhoto(null);
                    } 
                    // If it was a quick tap (< 300ms) and in after mode, select the photo
                    else if (pressDuration < 300 && mode === 'after') {
                      setSelectedBeforePhoto(photo);
                      setEnlargedGalleryIndex(index);
                    }
                    
                    tapStartTime.current = null;
                  }}
                >
                  <View style={[styles.enlargedGallerySlide, { width: dimensions.width }]}>
                    {(() => {
                      // Match the camera's aspect ratio from the upper half
                      // Upper half: width x (height x 0.6)
                      // Camera aspect ratio: width / (height x 0.6)
                      const cameraAspect = dimensions.width / (dimensions.height * 0.6);

                      // Lower container height is 40% of screen
                      const containerHeight = dimensions.height * 0.41;
                      
                      // Calculate width to fit height while maintaining camera aspect
                      const photoWidth = containerHeight * cameraAspect;
                      return (
                        <View style={{
                          width: photoWidth,
                          height: containerHeight,
                          overflow: 'hidden'
                        }}>
                          <Image
                            source={{ uri: photo.uri }}
                            style={styles.enlargedGalleryImage}
                            resizeMode="cover"
                          />
                        </View>
                      );
                    })()}
                  </View>
                </TouchableWithoutFeedback>
              ))}
            </ScrollView>
          </Animated.View>
        );
      })()}

      {/* Full-screen photo - shown when long-pressing in enlarged gallery (only when enlarged gallery is open) */}
      {enlargedGalleryPhoto && showEnlargedGallery && (
        <View style={styles.fullScreenPhotoContainer}>
          <Image
            source={{ uri: enlargedGalleryPhoto.uri }}
            style={styles.fullScreenPhotoImage}
            resizeMode="contain"
          />
          <Text style={styles.fullScreenPhotoName}>{enlargedGalleryPhoto.name}</Text>
        </View>
      )}

      {/* Room transition indicator - shown briefly when switching rooms */}
      {showRoomIndicator && (() => {
        const squareSize = (dimensions.width - 60) / 2;
        const iconSize = 48; // matches styles.roomTransitionIcon
        const screenCenterTopForCard = (dimensions.height - squareSize) / 2; // centers the square
        // Both full and half screen: move up by 1/3 of square size
        const topOffset = squareSize / 3;
        const computedTop = screenCenterTopForCard - topOffset;
        return (
          <View style={[styles.roomTransitionIndicator, { top: computedTop }]}>
            <View
              style={[
                styles.roomTransitionCard,
                { width: squareSize, height: squareSize }
              ]}
            >
              <Text style={styles.roomTransitionIcon}>{getCurrentRoomInfo().icon}</Text>
              <Text style={styles.roomTransitionName}>{getCurrentRoomInfo().name}</Text>
            </View>
          </View>
        );
      })()}

      {/* Full screen view - activated by holding thumbnail */}
      {isFullScreen && !showCarousel && (() => {
        const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
        
        if (photos.length === 0) return null;
        
        return (
          <View style={styles.fullScreenContainer} pointerEvents="box-none">
            <View style={styles.fullScreenBackground} />
            <ScrollView
              ref={fullScreenScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              snapToInterval={dimensions.width}
              decelerationRate="fast"
              contentOffset={{ x: fullScreenIndex * dimensions.width, y: 0 }}
              onMomentumScrollEnd={(event) => {
                const offsetX = event.nativeEvent.contentOffset.x;
                const index = Math.round(offsetX / dimensions.width);
                setFullScreenIndex(index);
                // Update selected photo in after mode
                if (mode === 'after' && photos[index]) {
                  setSelectedBeforePhoto(photos[index]);
                }
              }}
              scrollEventThrottle={16}
              style={styles.fullScreenScroll}
            >
              {photos.map((photo) => (
                <View key={photo.id} style={[styles.fullScreenSlide, { width: dimensions.width, height: dimensions.height }]}>
            <Image
                    source={{ uri: photo.uri }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
                </View>
              ))}
            </ScrollView>
            <View style={styles.fullScreenInfo} pointerEvents="none">
              <Text style={styles.fullScreenName}>{photos[fullScreenIndex]?.name}</Text>
              <Text style={styles.fullScreenHint}>Release to return - Swipe to navigate</Text>
            </View>
          </View>
        );
      })()}

      {/* Carousel view - activated by double-tap */}
      {showCarousel && (() => {
        const photos = mode === 'after' ? getUnpairedBeforePhotos(room) : getBeforePhotos(room);
        
        return (
          <View style={styles.carouselOverlay}>
            <TouchableOpacity
              style={styles.carouselBackground}
              activeOpacity={1}
              onPress={() => {
                setShowCarousel(false);
              }}
            />
            
            <Animated.View 
              style={[
                styles.carouselContainer,
                {
                  transform: [{ translateY: carouselTranslateY }]
                }
              ]}
              {...carouselPanResponder.panHandlers}
            >
              <ScrollView
                ref={carouselScrollRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={dimensions.width}
                decelerationRate="fast"
                snapToAlignment="center"
                contentOffset={{ x: carouselIndex * dimensions.width, y: 0 }}
                onMomentumScrollEnd={(event) => {
                  const offsetX = event.nativeEvent.contentOffset.x;
                  const index = Math.round(offsetX / dimensions.width);
                  setCarouselIndex(index);
                  // Update selected photo in after mode
                  if (mode === 'after' && photos[index]) {
                    setSelectedBeforePhoto(photos[index]);
                  }
                }}
                scrollEventThrottle={16}
              >
                {photos.map((photo) => (
                  <View key={photo.id} style={[styles.carouselSlide, { width: dimensions.width, height: dimensions.height }]}>
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.carouselImage}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </ScrollView>

              <View style={styles.carouselInfo}>
                <Text style={styles.carouselPhotoName}>{photos[carouselIndex]?.name}</Text>
                <Text style={styles.carouselCounter}>{carouselIndex + 1} / {photos.length}</Text>
              </View>

              <TouchableOpacity
                style={styles.carouselCloseButton}
                onPress={() => {
                  setShowCarousel(false);
                }}
              >
                <Ionicons name="close" size={28} color="#FFF" />
              </TouchableOpacity>
            </Animated.View>
          </View>
        );
      })()}
    </View>
  );

  const renderLabelView = () => {
    if (!tempPhotoUri || !tempPhotoLabel) return null;

      return (
      <View
        ref={labelViewRef}
        style={[
          styles.hiddenLabelView,
          {
            width: tempPhotoDimensions.width,
            height: tempPhotoDimensions.height
          }
        ]}
        collapsable={false}
      >
        <Image
          source={{ uri: tempPhotoUri }}
          style={styles.hiddenLabelImage}
          resizeMode="cover"
        />
        {/* Calculate scale factor for label to match standard size
            Camera photos are typically 1920x1080 (portrait) or 1080x1920 (landscape)
            Scale factor needed to make label appear the same size as on screen photos
        */}
        {(() => {
          // Use the same consistent scale factor as PhotoDetailScreen
          // Reference width: 1920px (landscape photo width for consistent scaling)
          const referenceWidth = 1920;
          const screenWidth = Dimensions.get('window').width;
          const scaleFactor = referenceWidth / screenWidth;

          // Determine which position to use based on the label
          const currentLabelPosition = tempPhotoLabel === 'BEFORE' ? beforeLabelPosition : afterLabelPosition;
          const positions = getLabelPositions(labelMarginVertical, labelMarginHorizontal);
          const positionConfig = positions[currentLabelPosition] || positions['left-top'];

          // Scale position coordinates for capture
          const capturePositionStyle = {};
          if (positionConfig.top !== undefined) {
            capturePositionStyle.top = typeof positionConfig.top === 'string'
              ? positionConfig.top
              : positionConfig.top * scaleFactor;
          }
          if (positionConfig.bottom !== undefined) {
            capturePositionStyle.bottom = positionConfig.bottom * scaleFactor;
          }
          if (positionConfig.left !== undefined) {
            capturePositionStyle.left = typeof positionConfig.left === 'string'
              ? positionConfig.left
              : positionConfig.left * scaleFactor;
          }
          if (positionConfig.right !== undefined) {
            capturePositionStyle.right = positionConfig.right * scaleFactor;
          }
          if (positionConfig.transform) {
            capturePositionStyle.transform = positionConfig.transform;
          }

          return (
            <>
              <PhotoLabel
                label={tempPhotoLabel}
                position={currentLabelPosition}
                style={{
                  ...capturePositionStyle,
                  paddingHorizontal: 12 * scaleFactor,
                  paddingVertical: 6 * scaleFactor,
                  borderRadius: 6 * scaleFactor
                }}
                textStyle={{
                  fontSize: 14 * scaleFactor
                }}
              />
              {shouldShowWatermark && (
                <PhotoWatermark
                  style={{
                    paddingHorizontal: 10 * scaleFactor,
                    paddingVertical: 4 * scaleFactor,
                    borderRadius: 4 * scaleFactor
                  }}
                  onPress={null}
                />
              )}
            </>
          );
        })()}
        </View>
      );
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
    }
    return () => {
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible');
      }
    };
  }, []);

  if (hasPermission === null) {
    // Camera permissions are still loading.
    return <View />;
  }

  if (!hasPermission) {
    // Camera permissions are not granted yet.
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera device not available</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={(event) => setLayout(event.nativeEvent.layout)}>
     
      {/* Container for camera - no scaling, just full screen */}
      <View style={styles.cameraWrapper}>
        {renderOverlayMode()}
        {renderLabelView()}
      </View>

      {/* Photo capture animation overlay */}
      {captureAnimationUri && (
        <Animated.View
          style={[
            styles.captureAnimationOverlay,
            {
              opacity: captureAnimOpacity,
              transform: [
                { translateX: captureAnimTranslateX },
                { translateY: captureAnimTranslateY },
                { scale: captureAnimScale },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: captureAnimationUri }}
            style={styles.captureAnimationImage}
            resizeMode="cover"
          />
        </Animated.View>
      )}

      {/* Background label preparation is now handled by GlobalBackgroundLabelPreparation component */}
      {/* No local Modals needed - the global component stays mounted regardless of navigation */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  orientationWarning: {
    position: 'absolute',
    top: '40%',
    left: 20,
    right: 20,
    backgroundColor: 'rgba(242, 195, 27, 0.95)',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    zIndex: 1500,
    elevation: 1500,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10
  },
  rotatePhoneIcon: {
    fontSize: 64,
    marginBottom: 12
  },
  orientationWarningText: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 8
  },
  orientationWarningHint: {
    fontFamily: FONTS.ALEXANDRIA,
    fontSize: 14,
    color: COLORS.TEXT,
    textAlign: 'center',
    opacity: 0.8
  },
  message: {
    fontFamily: FONTS.ALEXANDRIA,
    textAlign: 'center',
    paddingBottom: 10,
    color: 'white',
    fontSize: 16
  },
  permissionButton: {
    backgroundColor: COLORS.PRIMARY,
    padding: 16,
    borderRadius: 8,
    margin: 20
  },
  permissionButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.TEXT,
    textAlign: 'center',
    fontWeight: 'bold'
  },
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  camera: {
    flex: 1
  },
  beforePhotoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.4,
    justifyContent: 'center',
    alignItems: 'center'
  },
  beforePhotoImage: {
    width: '100%',
    height: '100%'
  },
  fixedUILayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 260,
    elevation: 260,
    backgroundColor: 'transparent',
    overflow: 'hidden'
  },
  controls: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 260,
    elevation: 260
  },
  roomModeContainer: {
    position: 'absolute',
    top: 50,
    left: 15,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  roomModePillWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: COLORS.PRIMARY,
    overflow: 'hidden',
    height: 32,
    paddingLeft: 14,
    paddingRight: 4,
  },
  roomButton: {
    backgroundColor: 'transparent',
    paddingRight: 8,
    justifyContent: 'center',
  },
  roomButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '590',
    letterSpacing: -0.11,
  },
  modeButton: {
    backgroundColor: COLORS.PRIMARY,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 30,
    justifyContent: 'center',
    height: 25,
  },
  modeButtonText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#000000',
    fontSize: 13.7,
    fontWeight: '590',
    textAlign: 'center',
  },
  torchButton: {
    position: 'absolute',
    top: 50,
    right: 15,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  soundButton: {
    position: 'absolute',
    top: 50,
    right: 60,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  closeButtonText: {
    color: 'white',
    fontSize: 24
  },
  flashlightButton: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    width: 56,   // Portrait orientation - narrow width
    height: 84   // Portrait orientation - full height
  },
  flashlightButtonText: {
    fontSize: 24
  },
  flipButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  flipButtonText: {
    fontSize: 24
  },
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 20,
    paddingHorizontal: 0,
    backgroundColor: 'transparent'
  },
  mainControlRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    position: 'relative',
    paddingHorizontal: 10,
  },
  buttonContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 100,
    width: 80,
  },
  modeInfo: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20
  },
  modeText: {
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: '600'
  },
  captureButtonContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  controlsRowAboveCapture: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  aspectRatioSelector: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  aspectRatioButtonBottom: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    minWidth: 55,
    height: 23,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  aspectRatioButtonBottomActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
    borderWidth: 1,
  },
  aspectRatioButtonBottomText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  aspectRatioButtonBottomTextActive: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  aspectRatioButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
     alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    minWidth: 55,
    alignItems: 'center'
  },
  aspectRatioButtonActive: {
    backgroundColor: COLORS.PRIMARY
  },
  aspectRatioText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600'
  },
  aspectRatioTextActive: {
    color: '#000'
  },
   captureButton: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#F2C31B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#F2C31B',
    padding: 3,
  },
  captureButtonInnerCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    backgroundColor: '#F2C31B',
  },
  captureButtonDisabled: {
    opacity: 0.5,
    backgroundColor: '#333',
  },
  captureButtonProcessing: {
    backgroundColor: '#000',
    borderWidth: 4,
    borderColor: COLORS.PRIMARY,
  },
  captureButtonProcessingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  captureButtonProcessingText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2
  },
  captureButtonInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'transparent'
  },
  captureButtonInnerDisabled: {
    backgroundColor: '#999'
  },
  captureButtonWarning: {
    position: 'absolute',
    fontSize: 32
  },
  zoomContainer: {
    alignItems: 'center',
    marginBottom: 20
  },
  zoomButtons: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 24,
    backdropFilter: 'blur(10px)'
  },
  zoomPresetButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.7
  },
  zoomPresetButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    opacity: 1,
    transform: [{ scale: 1.1 }]
  },
  zoomPresetText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2
  },
  zoomPresetTextActive: {
    color: COLORS.PRIMARY,
    fontWeight: '700'
  },
  aspectRatioContainer: {
    flexDirection: 'column',
    gap: 8,
    width: 80,
    position: 'absolute',
    left: 10
  },
  aspectRatioButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center'
  },
  aspectRatioButtonActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY
  },
  aspectRatioButtonLocked: {
    backgroundColor: 'rgba(242, 195, 27, 0.3)',
    borderColor: COLORS.PRIMARY,
    opacity: 0.7
  },
  aspectRatioText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600'
  },
  aspectRatioTextActive: {
    color: COLORS.TEXT
  },
  aspectRatioHint: {
    fontSize: 10,
    marginTop: 2
  },
  aspectRatioLockIcon: {
    position: 'absolute',
    top: 2,
    right: 2,
    fontSize: 10
  },
  // Thumbnail viewer: white outer border (matches Figma design)
  thumbnailViewerContainer: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    overflow: 'hidden',
    backgroundColor: '#00000000',
    borderWidth: 2,
    borderColor: 'rgb(255, 255, 255)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailInnerRing: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: '#000000c7',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailLandscape: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
  },
  thumbnailPortrait: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
  },
  thumbnailViewerImage: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
  },
  thumbnailViewerLabel: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    fontSize: 20
  },
  // Full screen styles
  fullScreenContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 1001,
    elevation: 1001
  },
  fullScreenBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    width: '100%',
    height: '100%'
  },
  fullScreenScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%'
  },
  fullScreenSlide: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  fullScreenImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenInfo: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center'
  },
  fullScreenName: {
    color: COLORS.PRIMARY,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4
  },
  fullScreenHint: {
    color: COLORS.GRAY,
    fontSize: 13
  },
  // Carousel styles
  carouselOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1002,
    elevation: 1002
  },
  carouselBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#000'
  },
  carouselCloseHintText: {
    color: COLORS.GRAY,
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20
  },
  carouselContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    justifyContent: 'center'
  },
  carouselSwipeIndicator: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
    paddingVertical: 10
  },
  carouselDragHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 8
  },
  carouselSlide: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  carouselImage: {
    width: '100%',
    height: '100%'
  },
  carouselInfo: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 12,
    paddingHorizontal: 20
  },
  carouselPhotoName: {
    color: COLORS.PRIMARY,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4
  },
  carouselCounter: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600'
  },
  carouselCloseButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
    color: COLORS.TEXT,
    fontSize: 24,
    fontWeight: 'bold'
  },
  photoFrameGuide: {
    position: 'absolute',
    top: '5%',
    left: '5%',
    right: '5%',
    bottom: '5%',
    borderWidth: 2,
    borderColor: 'rgba(242, 195, 27, 0.6)',
    borderStyle: 'dashed'
  },
  frameCorner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: COLORS.PRIMARY
  },
  frameTopLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4
  },
  frameTopRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4
  },
  frameBottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4
  },
  frameBottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4
  },
  // Crop overlay styles
  cropOverlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center'
  },
  darkOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)'
  },
  frameArea: {
    position: 'relative',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY
  },
  // Gallery swipe-up styles
  cameraWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 30,
  },
  bottomGallery: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1a1a1a',
    borderTopWidth: 2,
    borderTopColor: COLORS.PRIMARY,
    paddingTop: 10,
    zIndex: 150,
    elevation: 150
  },
  galleryTitle: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.PRIMARY,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    marginLeft: 16,
    textAlign: 'left'
  },
  galleryContent: {
    paddingHorizontal: 16,
    gap: 12
  },
  galleryItem: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'transparent',
    width: 100,
    alignSelf: 'flex-start'
  },
  galleryItemSelected: {
    borderColor: COLORS.PRIMARY
  },
  galleryImage: {
    width: 100,
    height: 100,
    backgroundColor: '#333'
  },
  galleryItemName: {
    fontFamily: FONTS.ALEXANDRIA,
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.8)',
    width: 100
  },
  galleryEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40
  },
  galleryEmptyText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: COLORS.GRAY,
    fontSize: 14,
    fontStyle: 'italic'
  },
  // Enlarged gallery carousel styles (bottom 40%)
  enlargedGalleryContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderWidth: 3,
    borderColor: COLORS.PRIMARY,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    zIndex: 250,
    elevation: 250
  },
  enlargedGalleryCloseButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 260
  },
  enlargedGalleryDeleteButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 260
  },
  enlargedGallerySlide: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  enlargedGalleryImage: {
    width: '100%',
    height: '100%'
  },
  // Full-screen photo styles (entire screen)
  fullScreenPhotoContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 300,
    elevation: 300
  },
  fullScreenPhotoImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenPhotoName: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    color: COLORS.PRIMARY,
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingVertical: 12,
    paddingHorizontal: 20
  },
  // Room transition indicator (shows briefly when switching rooms)
  roomTransitionIndicator: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
    zIndex: 500,
    pointerEvents: 'none'
  },
  roomTransitionCard: {
    width: 120,
    height: 120,
    backgroundColor: 'rgba(240, 240, 240, 0.5)',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8
  },
  roomTransitionIcon: {
    fontSize: 48
  },
  roomTransitionName: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center'
  },
  // Orientation toggle styles (replaces save button in before mode)
  orientationToggle: {
    position: 'absolute',
    right: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    transform: [{ rotate: '90deg' }],
    justifyContent: 'center',
    alignItems: 'center'
  },
  orientationToggleIcon: {
    transform: [{ rotate: '-90deg' }]
  },
  orientationToggleText: {
    fontSize: 24
  },
  // Letterbox styles for landscape camera mode
  letterboxContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000'
  },
  letterboxContainerLandscape: {
    flexDirection: 'row'
  },
  letterboxBar: {
    width: '100%',
    backgroundColor: '#000',
    flex: 1
  },
  letterboxBarHorizontal: {
    height: '100%',
    backgroundColor: '#000',
    flex: 1
  },
  letterboxCamera: {
    width: '100%',
    aspectRatio: 1.333, // Portrait device: full width, black bars top/bottom (4/3 = 1.333)
    position: 'relative',
    overflow: 'hidden'
  },
  letterboxCameraLandscape: {
    width: undefined,
    height: '100%',
    aspectRatio: 1.333, // Landscape device: full height, black bars left/right (4/3 = 1.333)
  },
  camera: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  // Hidden view for adding labels to photos
  hiddenLabelView: {
    position: 'absolute',
    top: -10000,
    left: 0,
  },
  hiddenLabelImage: {
    width: '100%',
    height: '100%'
  },
  androidCameraWrapper: {
    width: '100%',
    aspectRatio: 0.5625, // 9/16 = 0.5625
    overflow: 'hidden',
    alignSelf: 'center',
  },
  zoomControlsBottom: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  zoomButtonBottom: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    minWidth: 55,
    height: 23,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  zoomButtonBottomActive: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
    borderWidth: 1,
  },
  zoomButtonBottomText: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  zoomButtonBottomTextActive: {
    fontFamily: FONTS.ALEXANDRIA,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  galleryPickerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
   checkmarkButtonBorder: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 3,
  },
   checkmarkButton: {
    width: '100%',
    height: '100%',
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Photo capture animation styles
  captureAnimationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2000,
    elevation: 2000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureAnimationImage: {
    width: '100%',
    height: '70%',
    borderRadius: 8,
  },
});

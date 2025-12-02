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
  PanResponder,
  Animated,
  StatusBar,
  Modal,
  ActivityIndicator
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import { compositeImages } from '../utils/imageCompositor';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePhotos } from '../context/PhotoContext';
import { useSettings } from '../context/SettingsContext';
import { savePhotoToDevice } from '../services/storage';
import { COLORS, PHOTO_MODES, getLabelPositions } from '../constants/rooms';
import PhotoLabel from '../components/PhotoLabel';
import PhotoWatermark from '../components/PhotoWatermark';
import {
  calculateSettingsHash,
  getCachedLabeledPhoto,
  saveCachedLabeledPhoto,
  ensureCacheDir,
} from '../services/labelCacheService';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { useFocusEffect } from '@react-navigation/native';

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
  const [room, setRoom] = useState(initialRoom);
  const [facing, setFacing] = useState('back');
  const [enableTorch, setEnableTorch] = useState(false);
  const [enableSound, setEnableSound] = useState(false); // Default shutter sound OFF
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
  const androidCombinedRef = useRef(null);
  const [androidCombinedJob, setAndroidCombinedJob] = useState(null); // Android-only combined base capture job
  const androidCombinedImagesLoaded = useRef(0); // Count how many images finished loading for the off-screen combined view
  const [androidCombinedReadyTick, setAndroidCombinedReadyTick] = useState(0); // Bump to trigger capture once both images are ready
  const androidCombinedCaptureInProgress = useRef(false); // Prevent simultaneous captures
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
  const cameraScale = useRef(new Animated.Value(1)).current;
  const cameraTranslateY = useRef(new Animated.Value(0)).current;
  const galleryOpacity = useRef(new Animated.Value(0)).current;
  const currentRoomRef = useRef(room);
  const dimensionsRef = useRef(dimensions);
  const showCarouselRef = useRef(showCarousel);
  const showGalleryRef = useRef(showGallery);
  const showEnlargedGalleryRef = useRef(showEnlargedGallery);
  const enlargedGalleryPhotoRef = useRef(enlargedGalleryPhoto);
  const isGalleryAnimatingRef = useRef(false);
  const { addPhoto, getBeforePhotos, getUnpairedBeforePhotos, deletePhoto, setCurrentRoom, activeProjectId } = usePhotos();
  const { 
    showLabels, 
    shouldShowWatermark, 
    getRooms, 
    beforeLabelPosition, 
    afterLabelPosition, 
    labelMarginVertical, 
    labelMarginHorizontal,
    labelBackgroundColor,
    labelTextColor,
    labelSize,
    labelFontFamily,
  } = useSettings();

  // Vision Camera setup - default to ultra-wide (0.5x)
  const [cameraType, setCameraType] = useState('ultra-wide-angle-camera'); // 'ultra-wide-angle-camera' or 'wide-angle-camera'
  const device = useCameraDevice(facing, {
    physicalDevices: [cameraType]
  });
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
  const [zoom, setZoom] = useState(1.0);

  // Calculate target aspect ratio for format selection
  const targetAspectRatio = useMemo(() => {
    const screenWidth = dimensions.width;
    const screenHeight = dimensions.height;
    const isLandscape = screenWidth > screenHeight;
    const ratio = isLandscape
      ? screenWidth / screenHeight
      : screenHeight / screenWidth;
    return ratio;
  }, [dimensions]);

  // Select best camera format
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
      // Sort by total pixels (highest first)
      const sorted = matchingFormats.sort((a, b) => {
        const aPixels = a.photoWidth * a.photoHeight;
        const bPixels = b.photoWidth * b.photoHeight;
        return bPixels - aPixels;
      });
      selected = sorted[0];
    } else {
      // Find closest ratio
      const withDiff = device.formats.map(f => {
        const formatRatio = Math.max(f.photoWidth, f.photoHeight) / Math.min(f.photoWidth, f.photoHeight);
        return {
          format: f,
          diff: Math.abs(formatRatio - targetAspectRatio),
          ratio: formatRatio
        };
      });

      withDiff.sort((a, b) => {
        if (Math.abs(a.diff - b.diff) < 0.01) {
          const aPixels = a.format.photoWidth * a.format.photoHeight;
          const bPixels = b.format.photoWidth * b.format.photoHeight;
          return bPixels - aPixels;
        }
        return a.diff - b.diff;
      });

      selected = withDiff[0].format;
    }

    if (selected) {
      const ratio = Math.max(selected.photoWidth, selected.photoHeight) / Math.min(selected.photoWidth, selected.photoHeight);
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
      // Before mode: show selectedBeforePhoto only if it matches current room
      return selectedBeforePhoto?.room === room ? selectedBeforePhoto : null;
    }
  };

  // Update ref when room changes AND sync with global room state
  useEffect(() => {
    currentRoomRef.current = room;
    // Update global room state so HomeScreen shows the same room when camera closes
    setCurrentRoom(room);
  }, [room, setCurrentRoom]);

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
            cameraScale.stopAnimation();
            cameraTranslateY.stopAnimation();
            galleryOpacity.stopAnimation();
            
            // Set animating flag to block new gestures
            isGalleryAnimatingRef.current = true;
            setIsGalleryAnimating(true);
            
            // Update state immediately before animation
            setShowGallery(false);
            Animated.parallel([
              Animated.spring(cameraScale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 50,
                friction: 10
              }),
              Animated.spring(cameraTranslateY, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 10
              }),
              Animated.timing(galleryOpacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true
              })
            ]).start(() => {
              // Explicitly reset values to ensure they're at default
              cameraScale.setValue(1);
              cameraTranslateY.setValue(0);
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
              
              const galleryHeight = dimensions.height * 0.4;
              const cameraHeight = dimensions.height - galleryHeight;
              
              // Scale to fill width, cropping top/bottom
              // Container: width × cameraHeight (60% of screen)
              // Camera: 4:3 aspect ratio
              // To fill width: scale = baseScale × (cameraAspect / containerAspect)
              const containerAspect = dimensions.width / cameraHeight; // W/H of visible area
              const cameraAspect = 4 / 3; // Camera is 4:3 (W/H)
              const baseScale = cameraHeight / dimensions.height; // 0.6
              const zoomFactor = cameraAspect / containerAspect; // Zoom to fill width
              const scale = baseScale * zoomFactor; // Final scale
              const translateY = -galleryHeight / 2;
              Animated.parallel([
                Animated.spring(cameraScale, {
                  toValue: scale,
                  useNativeDriver: true,
                  tension: 50,
                  friction: 10
                }),
                Animated.spring(cameraTranslateY, {
                  toValue: translateY,
                  useNativeDriver: true,
                  tension: 50,
                  friction: 10
                }),
                Animated.timing(galleryOpacity, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true
                })
              ]).start(() => {
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
    }, [hasPermission, requestPermission, dimensions, deviceOrientation, cameraViewMode, aspectRatio, pictureSize, mode, cameraType])
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

      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: 'quality',
        // Only request flash if the current device reports flash support
        flash: enableTorch && supportsFlash ? 'on' : 'off',
        enableShutterSound: enableSound
      });
      const photoUri = `file://${photo.path}`;

      if (mode === 'before') {
        await handleBeforePhoto(photoUri);
      } else if (mode === 'after') {
        await handleAfterPhoto(photoUri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take picture');
    } finally {
      setIsCapturing(false);
    }
  };

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
        Image.getSize(combinedPhoto.uri, (width, height) => {
          // Queue preparation in global service (stays mounted regardless of navigation)
          backgroundLabelPreparationService.queuePreparation({
            photo: combinedPhoto,
            beforePhoto,
            afterPhoto,
            width,
            height,
            settingsHash,
            isLetterbox,
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
        Image.getSize(photo.uri, (width, height) => {
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
        // Letterbox mode: Crop to 4:3 aspect ratio to match the visible area between bars
        aspectRatio = '4:3';

        if (imageInfo) {
          try {
            // Calculate 4:3 crop (1.333:1 ratio - width is 1.333x the height)
            const targetRatio = 4 / 3;
            const photoRatio = imageInfo.width / imageInfo.height;

            let cropWidth, cropHeight, cropX, cropY;

            if (photoRatio > targetRatio) {
              // Photo is wider than 4:3 - crop sides
              cropHeight = imageInfo.height;
              cropWidth = cropHeight * targetRatio;
              cropX = (imageInfo.width - cropWidth) / 2;
              cropY = 0;
            } else {
              // Photo is taller than 4:3 - crop top/bottom
              cropWidth = imageInfo.width;
              cropHeight = cropWidth / targetRatio;
              cropX = 0;
              cropY = (imageInfo.height - cropHeight) / 2;
            }

            const croppedImage = await ImageManipulator.manipulateAsync(
              uri,
              [
                {
                  crop: {
                    originX: cropX,
                    originY: cropY,
                    width: cropWidth,
                    height: cropHeight
                  }
                }
              ],
              { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
            );

            processedUri = croppedImage.uri;
          } catch (cropError) {
            console.error('[CameraScreen] Failed to crop letterbox photo:', cropError);
            // Fall back to original uri if cropping fails
          }
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

      // Update selectedBeforePhoto so thumbnail shows immediately
      setSelectedBeforePhoto(newPhoto);

      // Prepare labeled photo in background immediately after before photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels) {
        // Start background preparation immediately (no delay needed)
        // Use Promise.resolve().then() to run async code without blocking
        Promise.resolve().then(async () => {
          try {
            // Calculate settings hash
            const settingsHash = calculateSettingsHash({
              showLabels,
              beforeLabelPosition,
              afterLabelPosition,
              labelBackgroundColor: labelBackgroundColor || null,
              labelTextColor: labelTextColor || null,
              labelSize: labelSize || null,
              labelFontFamily: labelFontFamily || null,
              labelMarginVertical,
              labelMarginHorizontal,
            });

            // Prepare before photo with label (don't await - just queue it)
            if (!newPhoto || !newPhoto.id || !newPhoto.uri) {
            } else {
              const cachedBefore = await getCachedLabeledPhoto(newPhoto, settingsHash);
              if (!cachedBefore) {
                try {
                  // Don't await - just queue it for background processing
                  prepareLabeledPhotoInBackground(newPhoto, settingsHash, 'before');
                } catch (error) {
                }
              }
            }
          } catch (error) {
          }
        });
      }

      // Stay in before mode to allow taking more photos
      // User can close camera to see photos in home grid
    } catch (error) {
      Alert.alert('Error', 'Failed to save photo');
    }
  };

  const handleAfterPhoto = async (uri) => {
    const startTime = Date.now();
    console.log('[DEBUG] 🎬 handleAfterPhoto started');
    try {
      // Get the active before photo
      const activeBeforePhoto = getActiveBeforePhoto();

      if (!activeBeforePhoto) {
        Alert.alert('Error', 'Please select a before photo first');
        return;
      }

      const beforePhotoId = activeBeforePhoto.id;
      // If replacing existing photos, delete them first
      if (existingAfterPhoto) {
        const deleteStart = Date.now();
        await deletePhoto(existingAfterPhoto.id);
        console.log(`[DEBUG] ⏱️ Delete existing after photo: ${Date.now() - deleteStart}ms`);
      }
      if (existingCombinedPhoto) {
        const deleteStart = Date.now();
        await deletePhoto(existingCombinedPhoto.id);
        console.log(`[DEBUG] ⏱️ Delete existing combined photo: ${Date.now() - deleteStart}ms`);
      }

      // Crop after photo to match before photo's camera view mode
      let processedUri = uri;
      const beforeCameraViewMode = activeBeforePhoto.cameraViewMode || 'portrait';

      if (beforeCameraViewMode === 'landscape') {
        // Letterbox mode: Crop to 4:3 aspect ratio to match before photo
        try {
          const imageInfo = await new Promise((resolve, reject) => {
            Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
          });

          // Calculate 4:3 crop (1.333:1 ratio)
          const targetRatio = 4 / 3;
          const photoRatio = imageInfo.width / imageInfo.height;

          let cropWidth, cropHeight, cropX, cropY;

          if (photoRatio > targetRatio) {
            // Photo is wider than 4:3 - crop sides
            cropHeight = imageInfo.height;
            cropWidth = cropHeight * targetRatio;
            cropX = (imageInfo.width - cropWidth) / 2;
            cropY = 0;
          } else {
            // Photo is taller than 4:3 - crop top/bottom
            cropWidth = imageInfo.width;
            cropHeight = cropWidth / targetRatio;
            cropX = 0;
            cropY = (imageInfo.height - cropHeight) / 2;
          }

          const croppedImage = await ImageManipulator.manipulateAsync(
            uri,
            [
              {
                crop: {
                  originX: cropX,
                  originY: cropY,
                  width: cropWidth,
                  height: cropHeight
                }
              }
            ],
            { compress: 0.95, format: ImageManipulator.SaveFormat.JPEG }
          );

          processedUri = croppedImage.uri;
        } catch (cropError) {
          console.error('[CameraScreen] Failed to crop letterbox after photo:', cropError);
          // Fall back to original uri if cropping fails
        }
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
      
      // Mark that we're processing after photo (for visual feedback)
      // Button is now active, but we show different visual state to indicate background processing
      setIsProcessingAfter(true);
      
      // Clear processing state after combined photo creation starts (it's non-blocking)
      // This gives visual feedback that background processing is happening
      setTimeout(() => {
        setIsProcessingAfter(false);
      }, 300); // Short delay just for visual feedback

      // Prepare labeled photo in background immediately after after photo is captured
      // This ensures it's ready when user clicks share, making sharing instant
      // Run this in background (don't await) so it doesn't block the UI
      if (showLabels) {
        // Start background preparation immediately (no delay needed)
        // Use Promise.resolve().then() to run async code without blocking
        Promise.resolve().then(async () => {
          try {
            // Calculate settings hash
            const settingsHash = calculateSettingsHash({
              showLabels,
              beforeLabelPosition,
              afterLabelPosition,
              labelBackgroundColor: labelBackgroundColor || null,
              labelTextColor: labelTextColor || null,
              labelSize: labelSize || null,
              labelFontFamily: labelFontFamily || null,
              labelMarginVertical,
              labelMarginHorizontal,
            });

            // Prepare after photo with label (don't await - just queue it)
            if (!newAfterPhoto || !newAfterPhoto.id || !newAfterPhoto.uri) {
            } else {
              const cachedAfter = await getCachedLabeledPhoto(newAfterPhoto, settingsHash);
              if (!cachedAfter) {
                try {
                  // Don't await - just queue it for background processing
                  prepareLabeledPhotoInBackground(newAfterPhoto, settingsHash, 'after');
                } catch (error) {
                }
              }
            }
          } catch (error) {
          }
        });
      }

      // Create combined photo in background (non-blocking)
      (async () => {
        try {
          // Measure original sizes
          const getSize = (u) => new Promise((resolve) => {
            Image.getSize(u, (w, h) => resolve({ w, h }), () => resolve({ w: 1080, h: 1920 }));
          });
          const aSize = await getSize(activeBeforePhoto.uri);
          const bSize = await getSize(savedUri);
          const beforeOrientation = activeBeforePhoto.orientation || 'portrait';
          const cameraVM = activeBeforePhoto.cameraViewMode || 'portrait';
          const isLandscapePair = beforeOrientation === 'landscape' || cameraVM === 'landscape';
          const isLetterbox = beforeOrientation === 'portrait' && cameraVM === 'landscape';

          const sourceMaxWidth = Math.max(aSize.w, bSize.w);
          const combinedWidthCandidate = aSize.w + bSize.w;
          const targetWidthBase = Math.max(sourceMaxWidth, 2048);
          const totalW = Math.min(
            isLandscapePair ? targetWidthBase : Math.max(targetWidthBase, combinedWidthCandidate),
            8192
          );

          let dimsLocal;
          if (isLandscapePair) {
            // STACK: heights sum based on width
            const r1h = aSize.h / aSize.w; // height per unit width
            const r2h = bSize.h / bSize.w;
            const totalH = Math.max(400, Math.round(totalW * (r1h + r2h)));
            const topH = Math.round(totalW * r1h);
            const bottomH = totalH - topH;
            dimsLocal = { width: totalW, height: totalH, topH, bottomH };
          } else {
            // SIDE-BY-SIDE: widths split based on height-normalized ratios
            const r1w = aSize.w / aSize.h;
            const r2w = bSize.w / bSize.h;
            const denom = (r1w + r2w) || 1;
            const totalH = Math.max(400, Math.round(totalW / denom));
            const leftW = Math.round(totalW * (r1w / denom));
            const rightW = totalW - leftW;
            dimsLocal = { width: totalW, height: totalH, leftW, rightW };
          }

          const safeName = (activeBeforePhoto.name || 'Photo').replace(/\s+/g, '_');
          const layout = isLandscapePair ? 'STACK' : 'SIDE';
          const baseType = layout;
          const projectIdSuffix = activeProjectId ? `_P${activeProjectId}` : '';

          if (Platform.OS === 'ios') {
            // iOS: use native image compositor
            try {
              console.log('[CameraScreen] 🧩 compositeImages start', Platform.OS, {
                beforeUri: activeBeforePhoto.uri,
                afterUri: savedUri,
                layout,
                dims: dimsLocal,
                beforeSize: aSize,
                afterSize: bSize,
                beforeOrientation,
                cameraVM,
                isLandscapePair,
              });
              const capUri = await compositeImages(
                activeBeforePhoto.uri,
                savedUri,
                layout,
                dimsLocal
              );
              console.log('[CameraScreen] ✅ compositeImages success', Platform.OS, capUri);

              const combinedPhotoSavedUri = await savePhotoToDevice(
                capUri,
                `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_${baseType}_${Date.now()}${projectIdSuffix}.jpg`,
                activeProjectId || null
              );
              console.log('[CameraScreen] 💾 combined base saved', Platform.OS, combinedPhotoSavedUri);
              
              // Prepare labeled combined photo in background (non-blocking)
              if (showLabels && combinedPhotoSavedUri) {
                // Use Promise.resolve().then() to run async code without blocking
                Promise.resolve().then(async () => {
                  try {
                    // Create a combined photo object for cache lookup/preparation
                    // The ID format matches what GalleryScreen uses: combined_<beforePhotoId>
                    const combinedPhotoId = `combined_${activeBeforePhoto.id}`;
                    const combinedPhoto = {
                      id: combinedPhotoId,
                      mode: PHOTO_MODES.COMBINED,
                      uri: combinedPhotoSavedUri,
                      name: activeBeforePhoto.name,
                      room: activeBeforePhoto.room,
                      projectId: activeProjectId,
                      beforePhotoId: activeBeforePhoto.id,
                    };
                    
                    // Calculate settings hash
                    const settingsHash = calculateSettingsHash({
                      showLabels,
                      beforeLabelPosition,
                      afterLabelPosition,
                      labelBackgroundColor: labelBackgroundColor || null,
                      labelTextColor: labelTextColor || null,
                      labelSize: labelSize || null,
                      labelFontFamily: labelFontFamily || null,
                      labelMarginVertical,
                      labelMarginHorizontal,
                    });
                    
                    // Check if already cached
                    const cachedCombined = await getCachedLabeledPhoto(combinedPhoto, settingsHash);
                    if (!cachedCombined) {
                      try {
                        // Prepare combined photo with labels in background (don't await - just queue it)
                        prepareCombinedPhotoInBackground(
                          combinedPhoto,
                          activeBeforePhoto,
                          newAfterPhoto,
                          settingsHash,
                          isLetterbox
                        );
                      } catch (error) {
                      }
                    }
                  } catch (error) {
                  }
                });
              }

              // In LETTERBOX, also save the SIDE-BY-SIDE variant in addition to STACK
              if (isLetterbox) {
                try {
                  // Prepare side-by-side dims based on existing sizes and totalW
                  const r1wLB = aSize.w / aSize.h;
                  const r2wLB = bSize.w / bSize.h;
                  const denomLB = (r1wLB + r2wLB) || 1;
                  const totalHLB = Math.max(400, Math.round(totalW / denomLB));
                  const leftWLB = Math.round(totalW * (r1wLB / denomLB));
                  const rightWLB = totalW - leftWLB;
                  const sideDimsLB = { width: totalW, height: totalHLB, leftW: leftWLB, rightW: rightWLB };

                  const capUriLB = await compositeImages(
                    activeBeforePhoto.uri,
                    savedUri,
                    'SIDE',
                    sideDimsLB
                  );

                  await savePhotoToDevice(
                    capUriLB,
                    `${activeBeforePhoto.room}_${safeName}_COMBINED_BASE_SIDE_${Date.now()}${projectIdSuffix}.jpg`,
                    activeProjectId || null
                  );
                } catch (eLB) {
                }
              }
            } catch (captureError) {
              console.error('[CameraScreen] ❌ Combined photo creation failed:', captureError);
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
            // Android: use JS/ViewShot-based compositor
            // Limit dimensions to prevent ViewShot failures on large images
            const MAX_DIMENSION = 4096; // ViewShot has limits on Android
            let limitedWidth = dimsLocal.width;
            let limitedHeight = dimsLocal.height;

            if (limitedWidth > MAX_DIMENSION || limitedHeight > MAX_DIMENSION) {
              const scale = Math.min(MAX_DIMENSION / limitedWidth, MAX_DIMENSION / limitedHeight);
              limitedWidth = Math.round(limitedWidth * scale);
              limitedHeight = Math.round(limitedHeight * scale);
              console.log('[CameraScreen][Android] Scaling down dimensions to prevent ViewShot failure:', {
                original: { width: dimsLocal.width, height: dimsLocal.height },
                limited: { width: limitedWidth, height: limitedHeight },
                scale,
              });
            }

            // Reset image load counter for the new job; capture will run once both images report onLoad.
            androidCombinedImagesLoaded.current = 0;
            setAndroidCombinedJob({
              beforeUri: activeBeforePhoto.uri,
              afterUri: savedUri,
              layout,
              width: limitedWidth,
              height: limitedHeight,
              room: activeBeforePhoto.room,
              safeName,
              projectId: activeProjectId || null,
            });
          }
        } catch (error) {
        }
      })();

      // If we're replacing an existing combined photo, navigate to PhotoEditor to recreate it
      if (existingCombinedPhoto) {
        navigation.navigate('PhotoEditor', {
          beforePhoto: activeBeforePhoto,
          afterPhoto: newAfterPhoto
        });
        return;
      }

      // Auto-advance to next unpaired photo (immediate)
      const remainingUnpaired = getUnpairedBeforePhotos(activeBeforePhoto.room);
      // Filter out the photo we just paired to ensure we don't count it
      const nextUnpaired = remainingUnpaired.filter(p => p.id !== beforePhotoId);
      if (nextUnpaired.length > 0) {
        // Select the next unpaired photo
        setSelectedBeforePhoto(nextUnpaired[0]);
      } else {
        // All photos paired - wait for the combined photo capture to complete
        // before showing the completion alert. This prevents navigation from
        // unmounting the camera screen mid-capture.
        const showCompletionAlert = () => {
          // Check if a capture is still in progress
          if (Platform.OS === 'android' && androidCombinedCaptureInProgress.current) {
            console.log('[CameraScreen] Waiting for combined photo capture to complete before showing alert...');
            // Check again in 500ms
            completionAlertTimer.current = setTimeout(showCompletionAlert, 500);
            return;
          }

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
                    navigation.navigate('Home');
                  }
                }
              }
            ]
          );
        };

        // Start with initial delay to give capture time to start
        completionAlertTimer.current = setTimeout(showCompletionAlert, 800);
      }
      console.log('[DEBUG] ✅ handleAfterPhoto completed');
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

  // Android-only: when a combined capture job is queued and both images have finished loading,
  // render an off-screen combined view and capture it with ViewShot, then save as a COMBINED_BASE image
  // via savePhotoToDevice so it appears in the gallery and can be cleaned up later.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!androidCombinedJob) return;
    // Wait until both BEFORE and AFTER images reported onLoad
    if (androidCombinedImagesLoaded.current < 2) return;

    // Prevent simultaneous captures
    if (androidCombinedCaptureInProgress.current) {
      console.log('[CameraScreen][Android] ⏸️ Capture already in progress, waiting...');
      return;
    }

    let cancelled = false;

    const run = async () => {
      const { room, safeName, layout, width, height, projectId } = androidCombinedJob;
      const baseType = layout === 'STACK' ? 'STACK' : 'SIDE';
      const projectIdSuffix = projectId ? `_P${projectId}` : '';

      // Set capture in progress flag
      androidCombinedCaptureInProgress.current = true;

      try {
        console.log('[CameraScreen][Android] 🧩 Starting combined photo capture:', {
          layout,
          requestedDimensions: { width, height },
          beforeUri: androidCombinedJob.beforeUri,
          afterUri: androidCombinedJob.afterUri,
        });

        // Give React more time to render and stabilize the off-screen view
        // Increased from 120ms to 300ms for better reliability
        await new Promise(resolve => setTimeout(resolve, 300));
        if (cancelled || !androidCombinedRef.current) {
          console.log('[CameraScreen][Android] ⚠️ Capture cancelled or ref not available');
          return;
        }

        // Use a normalized canvas size to avoid huge off-screen views, preserve aspect ratio
        // Cap at 2048 for better compatibility
        const MAX_CAPTURE_WIDTH = 2048;
        const baseWidth = Math.min(width, MAX_CAPTURE_WIDTH);
        const aspect = height > 0 ? height / width : 1;
        const baseHeight = Math.max(400, Math.round(baseWidth * aspect));

        console.log('[CameraScreen][Android] 📐 Capture dimensions:', { width: baseWidth, height: baseHeight, aspect });

        // Update the view size just before capture
        if (androidCombinedRef.current) {
          androidCombinedRef.current.setNativeProps({
            style: { width: baseWidth, height: baseHeight },
          });
          // Give the view a moment to apply the new dimensions
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Retry mechanism for ViewShot capture
        let capturedUri = null;
        let lastError = null;
        const MAX_RETRIES = 2;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            // Validate ref before each attempt
            if (!androidCombinedRef.current) {
              throw new Error('View ref is no longer available');
            }

            console.log(`[CameraScreen][Android] 📸 Capture attempt ${attempt}/${MAX_RETRIES}`);

            capturedUri = await captureRef(androidCombinedRef, {
              format: 'jpg',
              quality: 0.95,
            });

            console.log('[CameraScreen][Android] ✅ ViewShot capture successful:', capturedUri);
            break; // Success, exit retry loop
          } catch (captureError) {
            lastError = captureError;
            console.warn(`[CameraScreen][Android] ⚠️ Capture attempt ${attempt} failed:`, captureError.message);

            if (attempt < MAX_RETRIES) {
              // Check if component was cancelled/unmounted
              if (cancelled) {
                console.log('[CameraScreen][Android] ⚠️ Capture cancelled, aborting retries');
                break;
              }

              // Wait before retrying, increasing delay with each attempt
              const retryDelay = 300 * attempt;
              console.log(`[CameraScreen][Android] ⏳ Waiting ${retryDelay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));

              // Verify ref is still valid after waiting
              if (!androidCombinedRef.current) {
                console.error('[CameraScreen][Android] ❌ View ref lost during retry delay');
                break;
              }
            }
          }
        }

        if (!capturedUri) {
          throw lastError || new Error('Failed to capture view after retries');
        }

        const savedUri = await savePhotoToDevice(
          capturedUri,
          `${room}_${safeName}_COMBINED_BASE_${baseType}_${Date.now()}${projectIdSuffix}.jpg`,
          projectId || null
        );
        console.log('[CameraScreen][Android] 💾 combined base saved via ViewShot', savedUri);
      } catch (err) {
        console.error('[CameraScreen][Android] ❌ Failed to create combined base via ViewShot:', err);
        console.error('[CameraScreen][Android] Error details:', {
          message: err.message,
          stack: err.stack,
          job: androidCombinedJob,
        });
      } finally {
        // Clear capture in progress flag
        androidCombinedCaptureInProgress.current = false;

        if (!cancelled) {
          // Reset load counter and clear the job so the off-screen view unmounts
          androidCombinedImagesLoaded.current = 0;
          setAndroidCombinedJob(null);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [androidCombinedJob, androidCombinedReadyTick]);

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
      {/* Animated camera view 
          Gesture handling:
          - When gallery is shown: swipe down closes gallery (returns to full camera)
          - When gallery is NOT shown: swipe down closes camera (navigates to main), swipe up shows gallery, horizontal swipes switch rooms
      */}
      <Animated.View
                style={[
          styles.cameraWrapper,
          {
            transform: [
              { scaleX: cameraScale },
              { scaleY: cameraScale },
              { translateY: cameraTranslateY }
            ]
          }
        ]}
      >
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
                    isActive={true}
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
                  isActive={true}
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
      </Animated.View>


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
        {/* Room name indicator - fixed to screen */}
        <View style={styles.roomIndicator}>
          <Text style={styles.roomIndicatorIcon}>{getCurrentRoomInfo().icon}</Text>
          <View style={styles.roomIndicatorTextContainer}>
            <Text style={styles.roomIndicatorText}>{getCurrentRoomInfo().name}</Text>
            <Text style={styles.roomIndicatorMode}>{mode.toUpperCase()}</Text>
          </View>
        </View>

        {/* Sound toggle button - between room name and close button */}
        <TouchableOpacity
          style={styles.soundButton}
          onPress={() => {
            setEnableSound(!enableSound);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.soundButtonText}>{enableSound ? '🔔' : '🔕'}</Text>
        </TouchableOpacity>

        {/* Close button - fixed to screen */}
        <TouchableOpacity
          style={styles.closeButtonTopRight}
          onPress={() => {
            navigation.goBack();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>

        {/* Camera zoom controls - fixed to screen */}
        <View style={styles.zoomControls}>
          <View style={styles.zoomButtons}>
            <TouchableOpacity
              style={[styles.zoomButton, cameraType === 'ultra-wide-angle-camera' && styles.zoomButtonActive]}
              onPress={() => {
                setCameraType('ultra-wide-angle-camera');
                setZoom(1.0);
              }}
            >
              <Text style={styles.zoomButtonText}>0.5x</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomButton, cameraType === 'wide-angle-camera' && zoom < 2 && styles.zoomButtonActive]}
              onPress={() => {
                setCameraType('wide-angle-camera');
                setZoom(1.0);
              }}
            >
              <Text style={styles.zoomButtonText}>1x</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.zoomButton, cameraType === 'wide-angle-camera' && zoom >= 2 && styles.zoomButtonActive]}
              onPress={() => {
                setCameraType('wide-angle-camera');
                setZoom(2.0);
              }}
            >
              <Text style={styles.zoomButtonText}>2x</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomControls}>
          {/* Main control row */}
          <View style={styles.mainControlRow}>
            {/* Left container - Thumbnail */}
            <View style={styles.buttonContainer}>
              {!showGallery && !showEnlargedGallery && (() => {
                const activePhoto = getActiveBeforePhoto();
                
                if (activePhoto) {
                  const photoOrientation = activePhoto.orientation || 'portrait';
                  return (
                <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait
                      ]}
                  activeOpacity={1}
                  onPress={() => {
                    const newMode = cameraViewMode === 'portrait' ? 'landscape' : 'portrait';
                    setCameraViewMode(newMode);
                  }}
                      onPressIn={handleThumbnailPressIn}
                      onPressOut={handleThumbnailPressOut}
                >
                  <Image
                        source={{ uri: activePhoto.uri }}
                    style={styles.thumbnailViewerImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.thumbnailViewerLabel}>👁</Text>
                </TouchableOpacity>
                  );
                } else {
                  // Show empty placeholder - allow switching camera view mode
                  return (
                    <TouchableOpacity
                      style={[
                        styles.thumbnailViewerContainer,
                        cameraViewMode === 'landscape' ? styles.thumbnailLandscape : styles.thumbnailPortrait
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        const newMode = cameraViewMode === 'portrait' ? 'landscape' : 'portrait';
                        setCameraViewMode(newMode);
                      }}
                    />
                  );
                }
              })()}
            </View>

            {/* Center container - Capture button */}
            <View style={styles.buttonContainer}>
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
                ) : (
                  <>
                    <View style={[styles.captureButtonInner, isOrientationMismatch() && styles.captureButtonInnerDisabled]} />
                    {isOrientationMismatch() && (
                      <Text style={styles.captureButtonWarning}>🔄</Text>
                    )}
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Right container - Flashlight */}
            <View style={styles.buttonContainer}>
              {facing === 'back' ? (
                <TouchableOpacity
                  style={styles.flashlightButton}
                  onPress={() => {
                    // If this lens reports no torch support, show a one-time explanation instead of crashing.
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
                  <Text style={styles.flashlightButtonText}>
                    {enableTorch ? '💡' : '⚫'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.flashlightButton} />
              )}
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
              height: dimensions.height * 0.4
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

      {/* Android-only off-screen combined view for original COMBINED_BASE capture via ViewShot */}
      {Platform.OS === 'android' && androidCombinedJob && (() => {
        // Use reasonable initial dimensions to prevent rendering issues
        const MAX_INITIAL = 2048;
        const initialWidth = Math.min(androidCombinedJob.width || 1920, MAX_INITIAL);
        const initialAspect = androidCombinedJob.height / androidCombinedJob.width;
        const initialHeight = Math.round(initialWidth * initialAspect);

        return (
        <View
          style={{
            position: 'absolute',
            left: -10000,
            top: -10000,
            width: initialWidth,
            height: initialHeight,
          }}
          pointerEvents="none"
        >
          <View
            ref={androidCombinedRef}
            collapsable={false}
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'white',
              overflow: 'hidden',
              flexDirection: androidCombinedJob.layout === 'STACK' ? 'column' : 'row',
            }}
          >
            <View style={{ flex: 1 }}>
              <Image
                source={{ uri: androidCombinedJob.beforeUri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                onLoad={() => {
                  // Track when the BEFORE image has loaded for the off-screen combined view
                  if (Platform.OS === 'android') {
                    console.log('[CameraScreen][Android] 📥 BEFORE image loaded');
                    androidCombinedImagesLoaded.current += 1;
                    if (androidCombinedImagesLoaded.current >= 2) {
                      setAndroidCombinedReadyTick(t => t + 1);
                    }
                  }
                }}
                onError={(error) => {
                  console.error('[CameraScreen][Android] ❌ BEFORE image failed to load:', error);
                  // Reset job on error to prevent hanging
                  androidCombinedImagesLoaded.current = 0;
                  setAndroidCombinedJob(null);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Image
                source={{ uri: androidCombinedJob.afterUri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                onLoad={() => {
                  // Track when the AFTER image has loaded for the off-screen combined view
                  if (Platform.OS === 'android') {
                    console.log('[CameraScreen][Android] 📥 AFTER image loaded');
                    androidCombinedImagesLoaded.current += 1;
                    if (androidCombinedImagesLoaded.current >= 2) {
                      setAndroidCombinedReadyTick(t => t + 1);
                    }
                  }
                }}
                onError={(error) => {
                  console.error('[CameraScreen][Android] ❌ AFTER image failed to load:', error);
                  // Reset job on error to prevent hanging
                  androidCombinedImagesLoaded.current = 0;
                  setAndroidCombinedJob(null);
                }}
              />
            </View>
          </View>
        </View>
        );
      })()}

      {/* Enlarged gallery carousel - shown when tapping a gallery item */}
      {showEnlargedGallery && (() => {
        const photos = mode === 'before' ? getBeforePhotos(room) : getUnpairedBeforePhotos(room);
        
        return (
          <Animated.View 
            style={[
              styles.enlargedGalleryContainer,
              {
                height: dimensions.height * 0.4
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
              <Text style={styles.enlargedGalleryCloseText}>✕</Text>
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
              <Text style={styles.enlargedGalleryDeleteText}>🗑️</Text>
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
                      // Upper half: width × (height × 0.6)
                      // Camera aspect ratio: width / (height × 0.6)
                      const cameraAspect = dimensions.width / (dimensions.height * 0.6);
                      
                      // Lower container height is 40% of screen
                      const containerHeight = dimensions.height * 0.4;
                      
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
              <Text style={styles.fullScreenHint}>Release to return • Swipe to navigate</Text>
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
                <Text style={styles.carouselCloseButtonText}>✕</Text>
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
                    bottom: 10 * scaleFactor,
                    right: 10 * scaleFactor,
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
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
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
     
      {/* Animated container for camera and gallery - allows sliding up/down */}
      <Animated.View
        style={[
          styles.cameraWrapper,
          {
            transform: [
              { scaleX: cameraScale },
              { scaleY: cameraScale },
              { translateY: cameraTranslateY }
            ]
          }
        ]}
      >
        {renderOverlayMode()}
        {renderLabelView()}
      </Animated.View>
      {/* Background label preparation is now handled by GlobalBackgroundLabelPreparation component */}
      {/* No local Modals needed - the global component stays mounted regardless of navigation */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.TEXT,
    marginBottom: 8
  },
  orientationWarningHint: {
    fontSize: 14,
    color: COLORS.TEXT,
    textAlign: 'center',
    opacity: 0.8
  },
  message: {
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
  roomIndicator: {
    position: 'absolute',
    top: 50,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 2,
    borderColor: COLORS.PRIMARY,
    gap: 8
  },
  roomIndicatorIcon: {
    fontSize: 20
  },
  roomIndicatorTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  roomIndicatorText: {
    color: COLORS.PRIMARY,
    fontSize: 16,
    fontWeight: 'bold'
  },
  roomIndicatorMode: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6
  },
  soundButton: {
    position: 'absolute',
    top: 50,
    right: 80, // Positioned between room indicator and close button
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)'
  },
  soundButtonText: {
    fontSize: 24
  },
  closeButtonTopRight: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)'
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
    paddingHorizontal: 20,
    backgroundColor: 'transparent'
  },
  mainControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    position: 'relative',
    paddingHorizontal: 10
  },
  buttonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 84  // Match tallest button height
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
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureButtonDisabled: {
    opacity: 0.5,
    backgroundColor: '#ccc'
  },
  captureButtonProcessing: {
    backgroundColor: 'rgba(255, 193, 7, 0.3)', // Amber/yellow tint to show processing
    borderWidth: 2,
    borderColor: COLORS.PRIMARY
  },
  captureButtonProcessingContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  captureButtonProcessingText: {
    color: COLORS.PRIMARY,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2
  },
  captureButtonInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.PRIMARY
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
    fontSize: 14,
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
  // Thumbnail viewer styles (overlay mode - left side of shutter button)
  thumbnailViewerContainer: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 2,
    borderColor: COLORS.PRIMARY
  },
  thumbnailLandscape: {
    width: 100,
    height: 75  // Landscape orientation - wider than tall
  },
  thumbnailPortrait: {
    width: 56,
    height: 84  // Portrait orientation - taller than wide (3:4 ratio approx)
  },
  thumbnailViewerImage: {
    width: '100%',
    height: '100%'
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
    elevation: 5
  },
  carouselCloseButtonText: {
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
    overflow: 'hidden'
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
  enlargedGalleryCloseText: {
    color: COLORS.PRIMARY,
    fontSize: 24,
    fontWeight: 'bold'
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
  enlargedGalleryDeleteText: {
    color: COLORS.PRIMARY,
    fontSize: 20
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
    aspectRatio: 4 / 3, // Portrait device: full width, black bars top/bottom
    position: 'relative',
    overflow: 'hidden'
  },
  letterboxCameraLandscape: {
    width: undefined,
    height: '100%',
    aspectRatio: 4 / 3, // Landscape device: full height, black bars left/right
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
    left: 0
  },
  hiddenLabelImage: {
    width: '100%',
    height: '100%'
  },
  androidCameraWrapper: {
    width: '100%',
    aspectRatio: 9/16,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  zoomControls: {
    position: 'absolute',
    top: 100, // Moved up since we removed the label
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
    margin: 10,
  },
  zoomButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  zoomButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 60,
    alignItems: 'center',
  },
  zoomButtonActive: {
    backgroundColor: COLORS.PRIMARY,
  },
  zoomButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});

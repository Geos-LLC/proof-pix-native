/**
 * Global component for background label preparation
 * This component stays mounted at the app root level, independent of navigation
 * It handles all background label preparation tasks using react-native-view-shot
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Modal, Image, Dimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as FileSystem from 'expo-file-system';
import backgroundLabelPreparationService from '../services/backgroundLabelPreparationService';
import { saveCachedLabeledPhoto } from '../services/labelCacheService';
import PhotoLabel from './PhotoLabel';
import { PHOTO_MODES } from '../constants/rooms';
import { useSettings } from '../context/SettingsContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function GlobalBackgroundLabelPreparation() {
  const [preparingPhoto, setPreparingPhoto] = useState(null);
  const labelCaptureRef = useRef(null);
  const combinedCaptureRef = useRef(null);
  const { showLabels } = useSettings();
  const [imagesLoaded, setImagesLoaded] = useState({ before: false, after: false });
  const captureTriggeredRef = useRef(false);
  const fallbackTimeoutRef = useRef(null);

  useEffect(() => {
    // Subscribe to preparation service updates
    const unsubscribe = backgroundLabelPreparationService.subscribe((state) => {
      // When new preparations are queued, process them if we're not already processing
      setPreparingPhoto((current) => {
        if (current) return current; // Already processing one
        
        const pending = state.pendingPreparations;
        if (pending.length > 0) {
          const next = pending[0];
          return next;
        }
        return null;
      });
    });

    // Check for pending preparations on mount
    const state = backgroundLabelPreparationService.getState();
    const pending = state.pendingPreparations;
    if (pending.length > 0) {
      const next = pending[0];
      setPreparingPhoto(next);
    }

    return unsubscribe;
  }, []); // Empty deps - only run on mount/unmount

  // When preparingPhoto becomes null (after completion), process next
  useEffect(() => {
    if (!preparingPhoto) {
      // Current preparation completed, check for next
      const state = backgroundLabelPreparationService.getState();
      const pending = state.pendingPreparations;
      if (pending.length > 0) {
        const next = pending[0];
        setPreparingPhoto(next);
      }
    }
  }, [preparingPhoto]);

  const captureAndSave = useCallback(async () => {
    if (!preparingPhoto) return;
    
    try {
      const ref = preparingPhoto.isCombined ? combinedCaptureRef : labelCaptureRef;
      
      if (!ref.current) {
        setTimeout(() => {
          if (ref.current && !captureTriggeredRef.current) {
            captureAndSave();
          }
        }, 200);
        return;
      }

      const capturedUri = await captureRef(ref, {
        format: 'jpg',
        quality: 0.95
      });

      // Save to cache
      const cachedUri = await saveCachedLabeledPhoto(
        preparingPhoto.photo, 
        capturedUri, 
        preparingPhoto.settingsHash
      );

      // Resolve promise if provided
      if (preparingPhoto.resolve) {
        preparingPhoto.resolve(cachedUri || capturedUri);
      }

      // Remove from queue and move to next
      backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
      setPreparingPhoto(null);
    } catch (error) {
      if (preparingPhoto?.reject) {
        preparingPhoto.reject(error);
      }
      if (preparingPhoto) {
        backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
      }
      setPreparingPhoto(null);
    }
  }, [preparingPhoto]);

  const attemptCapture = useCallback(() => {
    if (captureTriggeredRef.current || !preparingPhoto) return;
    
    const isCombined = preparingPhoto.isCombined;
    const allImagesLoaded = isCombined 
      ? imagesLoaded.before && imagesLoaded.after
      : imagesLoaded.before;

    if (allImagesLoaded) {
      captureTriggeredRef.current = true;
      // Wait for image to be fully rendered before capturing
      // This runs in background and doesn't block user workflow
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Small delay in background to ensure image is fully painted
          // This is non-blocking - user can continue working while label prep happens
          setTimeout(() => {
            // Verify image source is valid before capturing
            if (preparingPhoto) {
              const imageUri = preparingPhoto.isCombined 
                ? preparingPhoto.beforePhoto?.uri 
                : preparingPhoto.photo?.uri;
              
              if (!imageUri) {
                backgroundLabelPreparationService.removePreparation(preparingPhoto.key);
                setPreparingPhoto(null);
                return;
              }
              captureAndSave();
            }
          }, 300); // 300ms background delay - doesn't block UI, just ensures image is rendered
        });
      });
    }
  }, [imagesLoaded, preparingPhoto, captureAndSave]);

  // Reset loaded state when preparingPhoto changes
  useEffect(() => {
    if (preparingPhoto) {
      setImagesLoaded({ before: false, after: false });
      captureTriggeredRef.current = false;
      
      // Clear any existing fallback timeout
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }

      // Set fallback timeout (2 seconds) in case onLoad doesn't fire
      // Use a ref to the current preparingPhoto to avoid stale closure
      const currentPreparingPhoto = preparingPhoto;
      fallbackTimeoutRef.current = setTimeout(() => {
        if (!captureTriggeredRef.current && currentPreparingPhoto) {
          console.log(`[DEBUG] ⚠️ Fallback timeout reached, attempting capture anyway...`);
          // Force capture even if images haven't loaded (fallback safety)
          captureTriggeredRef.current = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // captureAndSave is in component scope, safe to call
              captureAndSave();
            });
          });
        }
      }, 2000);
    }

    return () => {
      if (fallbackTimeoutRef.current) {
        clearTimeout(fallbackTimeoutRef.current);
        fallbackTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingPhoto]); // Only depend on preparingPhoto, captureAndSave is stable enough

  // Attempt capture when images are loaded
  useEffect(() => {
    if (preparingPhoto) {
      attemptCapture();
    }
  }, [imagesLoaded, preparingPhoto, attemptCapture]);

  const handleImageLoad = (imageType) => {
    if (preparingPhoto) {
      const imageUri = preparingPhoto.isCombined
        ? (imageType === 'before' ? preparingPhoto.beforePhoto?.uri : preparingPhoto.afterPhoto?.uri)
        : preparingPhoto.photo?.uri;
    }
    setImagesLoaded(prev => {
      const updated = { ...prev, [imageType]: true };
      return updated;
    });
  };

  const handleImageError = (imageType, error) => {
    // Still mark as loaded to prevent infinite waiting, but log the error
    setImagesLoaded(prev => {
      const updated = { ...prev, [imageType]: true };
      return updated;
    });
  };

  // Render hidden modals for capture
  return (
    <>
      {/* Single photo preparation */}
      {preparingPhoto && !preparingPhoto.isCombined && (
        <Modal
          visible={true}
          transparent={true}
          animationType="none"
          onRequestClose={() => {}}
        >
          <View style={{ 
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
            opacity: 0,
            position: 'absolute',
            left: SCREEN_WIDTH + 1000, // Off-screen but still rendered
            top: 0,
          }}>
            <View
              ref={labelCaptureRef}
              collapsable={false}
              style={{
                width: Math.min(preparingPhoto.width, SCREEN_WIDTH),
                height: Math.min(preparingPhoto.height, SCREEN_WIDTH * (preparingPhoto.height / preparingPhoto.width)),
                backgroundColor: 'white',
                overflow: 'hidden',
              }}
            >
              <Image
                source={{ uri: preparingPhoto.photo.uri }}
                style={{
                  width: '100%',
                  height: '100%'
                }}
                resizeMode="cover"
                onLoadEnd={() => handleImageLoad('before')}
                onError={(error) => handleImageError('before', error)}
              />
              {showLabels && preparingPhoto.photo.mode && (
                <PhotoLabel
                  label={preparingPhoto.photo.mode === PHOTO_MODES.BEFORE ? 'common.before' : 'common.after'}
                  position={preparingPhoto.labelPosition}
                />
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Combined photo preparation */}
      {preparingPhoto && preparingPhoto.isCombined && (
        <Modal
          visible={true}
          transparent={true}
          animationType="none"
          onRequestClose={() => {}}
        >
          <View style={{ 
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transparent',
            opacity: 0,
            position: 'absolute',
            left: SCREEN_WIDTH + 1000, // Off-screen but still rendered
            top: 0,
          }}>
            <View
              ref={combinedCaptureRef}
              collapsable={false}
              style={{
                width: Math.min(preparingPhoto.width, SCREEN_WIDTH),
                height: Math.min(preparingPhoto.height, SCREEN_WIDTH * (preparingPhoto.height / preparingPhoto.width)),
                backgroundColor: 'white',
                overflow: 'hidden',
                flexDirection: preparingPhoto.isLetterbox ? 'column' : 'row',
              }}
            >
              {/* Before photo */}
              <View style={{ flex: 1 }}>
                <Image
                  source={{ uri: preparingPhoto.beforePhoto.uri }}
                  style={{
                    width: '100%',
                    height: '100%'
                  }}
                  resizeMode="cover"
                  onLoad={() => handleImageLoad('before')}
                  onError={(error) => handleImageError('before', error)}
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.before"
                    position={preparingPhoto.beforeLabelPosition || 'top-left'}
                  />
                )}
              </View>
              {/* After photo */}
              <View style={{ flex: 1 }}>
                <Image
                  source={{ uri: preparingPhoto.afterPhoto.uri }}
                  style={{
                    width: '100%',
                    height: '100%'
                  }}
                  resizeMode="cover"
                  onLoadEnd={() => handleImageLoad('after')}
                  onError={(error) => handleImageError('after', error)}
                />
                {showLabels && (
                  <PhotoLabel
                    label="common.after"
                    position={preparingPhoto.afterLabelPosition || 'top-right'}
                  />
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}


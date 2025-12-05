/**
 * Global component for background combined photo creation (Android only)
 * This component stays mounted at the app root level, independent of navigation
 * It handles all background combined photo creation tasks using react-native-view-shot
 * This solves the issue where navigating away from CameraScreen causes ViewShot to fail
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Modal, Image, Dimensions, Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { savePhotoToDevice } from '../services/storage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Simple service to manage background job queue
class BackgroundCombinedPhotoService {
  constructor() {
    this.jobs = [];
    this.listeners = [];
  }

  addJob(job) {
    this.jobs.push(job);
    this.notifyListeners();
    console.log('[BackgroundCombinedPhotoService] Job added, total jobs:', this.jobs.length);
  }

  removeJob(jobId) {
    this.jobs = this.jobs.filter(j => j.jobId !== jobId);
    this.notifyListeners();
    console.log('[BackgroundCombinedPhotoService] Job removed, remaining jobs:', this.jobs.length);
  }

  getJobs() {
    return [...this.jobs];
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.jobs));
  }
}

export const backgroundCombinedPhotoService = new BackgroundCombinedPhotoService();

export default function GlobalBackgroundCombinedPhotoCreator() {
  // Only render on Android - iOS uses native compositor
  if (Platform.OS !== 'android') {
    return null;
  }

  const [currentJob, setCurrentJob] = useState(null);
  const [imagesLoaded, setImagesLoaded] = useState(0);
  const viewRef = useRef(null);
  const captureTriggeredRef = useRef(false);

  // Subscribe to job queue updates
  useEffect(() => {
    const unsubscribe = backgroundCombinedPhotoService.subscribe((jobs) => {
      // Don't update if we're currently processing a job
      setCurrentJob((current) => {
        if (current) {
          console.log('[BackgroundCombinedPhotoCreator] Already processing job, queued jobs:', jobs.length);
          return current; // Keep processing current job
        }
        if (jobs.length > 0) {
          console.log('[BackgroundCombinedPhotoCreator] Starting next job from queue');
          return jobs[0];
        }
        return null;
      });
    });

    // Check for pending jobs on mount
    const jobs = backgroundCombinedPhotoService.getJobs();
    if (jobs.length > 0) {
      console.log('[BackgroundCombinedPhotoCreator] Found', jobs.length, 'pending jobs on mount');
      setCurrentJob(jobs[0]);
    }

    return unsubscribe;
  }, []);

  // When currentJob becomes null (after completion), process next
  useEffect(() => {
    if (!currentJob) {
      const jobs = backgroundCombinedPhotoService.getJobs();
      if (jobs.length > 0) {
        console.log('[BackgroundCombinedPhotoCreator] Current job done, processing next. Queue length:', jobs.length);
        // Small delay to ensure state is clean before next job
        setTimeout(() => {
          setCurrentJob(jobs[0]);
        }, 100);
      } else {
        console.log('[BackgroundCombinedPhotoCreator] All jobs completed, queue empty');
      }
    }
  }, [currentJob]);

  // Reset state when job changes
  useEffect(() => {
    if (currentJob) {
      setImagesLoaded(0);
      captureTriggeredRef.current = false;
      console.log('[BackgroundCombinedPhotoCreator] 🚀 Processing job:', currentJob.layout, currentJob.jobId);
    }
  }, [currentJob]);

  const captureAndSave = useCallback(async () => {
    if (!currentJob || !viewRef.current) {
      console.warn('[BackgroundCombinedPhotoCreator] Cannot capture - no job or ref');
      return;
    }

    try {
      console.log('[BackgroundCombinedPhotoCreator] 📸 Capturing', currentJob.layout);

      const capturedUri = await captureRef(viewRef, {
        format: 'jpg',
        quality: 0.95,
      });

      console.log('[BackgroundCombinedPhotoCreator] ✅ Capture successful:', currentJob.layout, capturedUri);

      const savedUri = await savePhotoToDevice(
        capturedUri,
        `${currentJob.room}_${currentJob.safeName}_COMBINED_BASE_${currentJob.layout}_${Date.now()}${currentJob.projectIdSuffix}.jpg`,
        currentJob.projectId || null
      );

      console.log('[BackgroundCombinedPhotoCreator] 💾 Saved:', currentJob.layout, savedUri);

      // Resolve promise if provided
      if (currentJob.resolve) {
        currentJob.resolve(savedUri);
      }

      // Remove job and move to next
      backgroundCombinedPhotoService.removeJob(currentJob.jobId);
      setCurrentJob(null);
    } catch (error) {
      console.error('[BackgroundCombinedPhotoCreator] ❌ Failed:', error);
      if (currentJob?.reject) {
        currentJob.reject(error);
      }
      backgroundCombinedPhotoService.removeJob(currentJob.jobId);
      setCurrentJob(null);
    }
  }, [currentJob]);

  // Attempt capture when both images are loaded
  useEffect(() => {
    if (currentJob && imagesLoaded === 2 && !captureTriggeredRef.current) {
      captureTriggeredRef.current = true;
      console.log('[BackgroundCombinedPhotoCreator] ✅ Both images loaded, waiting 500ms for full render...');

      // Wait longer for images to fully render to avoid white/blank images
      // This is non-blocking - happens in background while user continues using app
      setTimeout(() => {
        if (currentJob) {
          console.log('[BackgroundCombinedPhotoCreator] 📸 Starting capture now');
          captureAndSave();
        }
      }, 500);
    }
  }, [imagesLoaded, currentJob, captureAndSave]);

  // Fallback timeout in case images don't load
  useEffect(() => {
    if (!currentJob) return;

    const timeout = setTimeout(() => {
      if (imagesLoaded < 2 && !captureTriggeredRef.current) {
        console.warn('[BackgroundCombinedPhotoCreator] ⚠️ Timeout waiting for images, loaded:', imagesLoaded);
        // Try to capture anyway after timeout
        captureTriggeredRef.current = true;
        captureAndSave();
      }
    }, 5000); // 5 second timeout

    return () => clearTimeout(timeout);
  }, [currentJob, imagesLoaded, captureAndSave]);

  const handleImageLoad = useCallback((imageType) => {
    console.log('[BackgroundCombinedPhotoCreator] 📥', imageType, 'image loaded');
    setImagesLoaded(prev => {
      const newCount = prev + 1;
      console.log('[BackgroundCombinedPhotoCreator] Total loaded:', `${newCount}/2`);
      return newCount;
    });
  }, []);

  const handleImageError = useCallback((imageType, error) => {
    console.error('[BackgroundCombinedPhotoCreator] ❌', imageType, 'image failed to load:', error.nativeEvent?.error);
    // Mark as loaded to prevent hanging, but capture will likely fail
    setImagesLoaded(prev => prev + 1);
  }, []);

  if (!currentJob) {
    return null;
  }

  const { beforeUri, afterUri, layout, width, height, jobId } = currentJob;
  const isStack = layout === 'STACK';

  return (
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
          key={jobId}
          ref={viewRef}
          collapsable={false}
          style={{
            width,
            height,
            backgroundColor: 'white',
            overflow: 'hidden',
            flexDirection: isStack ? 'column' : 'row',
          }}
        >
          {/* Before photo */}
          <View style={{ flex: 1, backgroundColor: 'white' }}>
            <Image
              key={`before_${jobId}`}
              source={{ uri: beforeUri, cache: 'reload' }}
              style={{
                width: '100%',
                height: '100%'
              }}
              resizeMode="cover"
              onLoad={() => handleImageLoad('BEFORE')}
              onError={(error) => handleImageError('BEFORE', error)}
            />
          </View>
          {/* After photo */}
          <View style={{ flex: 1, backgroundColor: 'white' }}>
            <Image
              key={`after_${jobId}`}
              source={{ uri: afterUri, cache: 'reload' }}
              style={{
                width: '100%',
                height: '100%'
              }}
              resizeMode="cover"
              onLoad={() => handleImageLoad('AFTER')}
              onError={(error) => handleImageError('AFTER', error)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Random from 'expo-random';
import * as Device from 'expo-device';
import { logReferralEvent } from '../utils/analytics';

const REFERRAL_STORAGE_KEY = '@user_referral_info';
const REFERRAL_CODE_KEY = '@user_referral_code';
const REFERRAL_ACCEPTED_KEY = '@referral_accepted';

// API base URL - Railway deployment (no body size limits)
const PROXY_SERVER_URL = process.env.EXPO_PUBLIC_PROXY_URL || 'https://steadfast-blessing-production.up.railway.app';

/**
 * Referral Service
 * Manages user referral codes, tracking, and rewards
 */

/**
 * Generate a unique ID
 * @returns {Promise<string>} Unique ID
 */
const generateUniqueId = async () => {
  try {
    const bytes = await Random.getRandomBytesAsync(16);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  } catch (error) {
    // Fallback
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  }
};

/**
 * Generate or retrieve user's unique referral code
 * @returns {Promise<string>} Referral code
 */
export const getOrCreateReferralCode = async () => {
  try {
    let code = await AsyncStorage.getItem(REFERRAL_CODE_KEY);
    if (!code) {
      // Generate a unique code (8 characters)
      const uniqueId = await generateUniqueId();
      code = uniqueId.substring(0, 8).toUpperCase();
      await AsyncStorage.setItem(REFERRAL_CODE_KEY, code);
      console.log('[ReferralService] Generated new referral code:', code);
      logReferralEvent('code_created', { code });
    }
    return code;
  } catch (error) {
    console.error('[ReferralService] Error getting referral code:', error);
    // Fallback code
    return 'REF' + Date.now().toString(36).toUpperCase().substring(0, 5);
  }
};

/**
 * Get referral information (invites sent, rewards earned)
 * @returns {Promise<Object>} Referral info
 */
export const getReferralInfo = async () => {
  try {
    const stored = await AsyncStorage.getItem(REFERRAL_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return {
      invitesSent: [],
      rewardsEarned: 0,
      totalMonthsEarned: 0,
    };
  } catch (error) {
    console.error('[ReferralService] Error getting referral info:', error);
    return {
      invitesSent: [],
      rewardsEarned: 0,
      totalMonthsEarned: 0,
    };
  }
};

/**
 * Add a referral invite (when user shares)
 * @param {string} method - Sharing method (whatsapp, email, sms, etc.)
 * @returns {Promise<void>}
 */
export const addReferralInvite = async (method = 'unknown') => {
  try {
    const info = await getReferralInfo();
    const uniqueId = await generateUniqueId();
    const invite = {
      id: uniqueId,
      method,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    info.invitesSent.push(invite);
    await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(info));
    console.log('[ReferralService] Added referral invite:', invite);
    const code = await AsyncStorage.getItem(REFERRAL_CODE_KEY);
    logReferralEvent('invite_shared', { code, method });
  } catch (error) {
    console.error('[ReferralService] Error adding referral invite:', error);
  }
};

/**
 * Check if user signed up via referral
 * @returns {Promise<Object|null>} Referral code if found, null otherwise
 */
export const getAcceptedReferral = async () => {
  try {
    const stored = await AsyncStorage.getItem(REFERRAL_ACCEPTED_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return null;
  } catch (error) {
    console.error('[ReferralService] Error getting accepted referral:', error);
    return null;
  }
};

/**
 * Mark referral as accepted (called when new user completes setup)
 * @param {string} referralCode - The referral code used
 * @returns {Promise<void>}
 */
export const acceptReferral = async (referralCode) => {
  try {
    const referralData = {
      code: referralCode,
      acceptedAt: new Date().toISOString(),
      setupCompleted: true,
    };
    await AsyncStorage.setItem(REFERRAL_ACCEPTED_KEY, JSON.stringify(referralData));
    console.log('[ReferralService] Referral accepted:', referralCode);
    logReferralEvent('accepted', { code: referralCode });
  } catch (error) {
    console.error('[ReferralService] Error accepting referral:', error);
  }
};

/**
 * Process referral reward (when friend completes setup)
 * This would typically be called by a backend service, but for now we'll track locally
 * @param {string} referralCode - The referral code that was used
 * @returns {Promise<number>} Number of months earned (1-3 based on total referrals)
 */
export const processReferralReward = async (referralCode) => {
  try {
    // In a real implementation, this would be handled by a backend
    // For now, we'll simulate it locally
    const info = await getReferralInfo();
    
    // Find the invite that matches this code (if we tracked it)
    // For now, we'll just increment rewards
    const completedCount = info.invitesSent.filter(inv => inv.status === 'completed').length;
    const newCompletedCount = completedCount + 1;
    
    // Calculate months earned (1 friend = 1 month, 2 friends = 2 months, 3+ = 3 months)
    let monthsEarned = 0;
    if (newCompletedCount === 1) {
      monthsEarned = 1;
    } else if (newCompletedCount === 2) {
      monthsEarned = 2;
    } else if (newCompletedCount >= 3) {
      monthsEarned = 3;
    }
    
    // Update the invite status
    const invite = info.invitesSent.find(inv => inv.status === 'pending');
    if (invite) {
      invite.status = 'completed';
      invite.completedAt = new Date().toISOString();
      invite.referralCode = referralCode;
    }
    
    info.rewardsEarned = newCompletedCount;
    info.totalMonthsEarned = monthsEarned;
    
    await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(info));
    console.log('[ReferralService] Processed referral reward:', monthsEarned, 'months');
    
    return monthsEarned;
  } catch (error) {
    console.error('[ReferralService] Error processing referral reward:', error);
    return 0;
  }
};

/**
 * Get referral link
 * @param {string} referralCode - User's referral code
 * @returns {string} Full referral link
 */
export const getReferralLink = (referralCode) => {
  // Use web URL (universal link) instead of custom scheme — custom schemes
  // don't work reliably from browsers/share sheets on iOS and get redirected
  // to the App Store. The web URL triggers universal links on iOS and intent
  // filters on Android, falling back to a redirect page if app isn't installed.
  return `https://steadfast-blessing-production.up.railway.app/referral/${referralCode}`;
};

/**
 * Get share message with referral link
 * @param {string} referralCode - User's referral code
 * @returns {string} Pre-formatted share message
 */
export const getShareMessage = (referralCode) => {
  const referralLink = getReferralLink(referralCode);
  const iosLink = 'https://apps.apple.com/us/app/proofpix-before-after/id6754261444';
  const androidLink = 'https://play.google.com/store/apps/details?id=com.proofpix.app';
  return `Try ProofPix to manage your cleaning jobs effortlessly!\n\nTap here to get started:\n${referralLink}\n\nDownload ProofPix:\niOS: ${iosLink}\nAndroid: ${androidLink}\n\nUse my referral code: ${referralCode}\nYou'll get 15 extra days free!`;
};

/**
 * Reset referral data (for testing)
 * @returns {Promise<void>}
 */
export const resetReferralData = async () => {
  try {
    await AsyncStorage.multiRemove([
      REFERRAL_STORAGE_KEY,
      REFERRAL_CODE_KEY,
      REFERRAL_ACCEPTED_KEY,
    ]);
    console.log('[ReferralService] Referral data reset');
  } catch (error) {
    console.error('[ReferralService] Error resetting referral data:', error);
  }
};

// ============================================================================
// SERVER-SIDE API FUNCTIONS
// ============================================================================

/**
 * Get device ID for tracking
 * @returns {Promise<string>}
 */
const getDeviceId = async () => {
  try {
    let deviceId = await AsyncStorage.getItem('@device_id');
    if (!deviceId) {
      // Generate a unique device ID
      const bytes = await Random.getRandomBytesAsync(16);
      deviceId = Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      await AsyncStorage.setItem('@device_id', deviceId);
    }
    return deviceId;
  } catch (error) {
    console.error('[ReferralService] Error getting device ID:', error);
    return `device_${Date.now()}`;
  }
};

/**
 * Get user ID (from AsyncStorage or context)
 * Generates and persists a consistent userId based on deviceId if not exists
 * @returns {Promise<string>}
 */
export const getUserId = async () => {
  try {
    // Try to get userId from AsyncStorage (you might store it during auth)
    let userId = await AsyncStorage.getItem('@user_id');
    if (userId) return userId;

    // Fallback: generate a consistent ID based on device
    const deviceId = await getDeviceId();
    userId = `user_${deviceId}`;

    // Store it for next time
    await AsyncStorage.setItem('@user_id', userId);
    console.log('[ReferralService] Generated and stored new userId:', userId);

    return userId;
  } catch (error) {
    console.error('[ReferralService] Error getting user ID:', error);
    // Final fallback
    return `user_${Date.now()}`;
  }
};

/**
 * Register user's referral code with the server
 * @param {string} userId - User ID
 * @param {string} referralCode - Referral code to register
 * @returns {Promise<boolean>}
 */
export const registerReferralCodeOnServer = async (userId, referralCode) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/referrals/register-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        referralCode
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[ReferralService] Code registered on server:', referralCode);
      logReferralEvent('code_registered', { code: referralCode });
      return true;
    } else {
      // Only log as error if it's not "already in use" (which is expected for existing users)
      if (!data.error || !data.error.includes('already in use')) {
        console.error('[ReferralService] Failed to register code:', data.error);
      }
      return false;
    }
  } catch (error) {
    console.log('[ReferralService] Could not register code on server (non-critical):', error?.message);
    return false;
  }
};

/**
 * Track referral installation on server
 * @param {string} referralCode - The referral code that was used
 * @returns {Promise<Object|null>}
 */
export const trackReferralInstallation = async (referralCode) => {
  try {
    const deviceId = await getDeviceId();

    const response = await fetch(`${PROXY_SERVER_URL}/api/referrals/track-installation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode,
        deviceId,
        timestamp: new Date().toISOString()
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[ReferralService] Installation tracked on server:', data.referralId);
      logReferralEvent('installation_tracked', { code: referralCode });
      // Also store locally
      await acceptReferral(referralCode);
      return { success: true, data };
    } else {
      // Only log as error if it's not the "already used" case (which is expected)
      if (!data.error || !data.error.includes('already used a referral code')) {
        console.error('[ReferralService] Failed to track installation:', data.error);
      }
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.error('[ReferralService] Error tracking installation:', error);
    return { success: false, error: error.message || 'Network error' };
  }
};

/**
 * Complete referral setup on server (when new user finishes onboarding)
 * @param {string} referralCode - The referral code that was used
 * @param {string} userId - The new user's ID
 * @returns {Promise<Object|null>}
 */
export const completeReferralSetup = async (referralCode, userId) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/referrals/complete-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode,
        userId,
        setupCompletedAt: new Date().toISOString()
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[ReferralService] Setup completed on server. Referrer earned:', data.monthsEarned, 'month(s)');
      logReferralEvent('setup_completed', { code: referralCode });
      return data;
    } else {
      const isNoPending = data.error && String(data.error).toLowerCase().includes('no pending referral');
      if (isNoPending) {
        console.warn('[ReferralService] No pending referral found for this code (expected when using dev test tools).', data.error);
      } else {
        console.error('[ReferralService] Failed to complete setup:', data.error);
      }
      return null;
    }
  } catch (error) {
    console.error('[ReferralService] Error completing setup:', error);
    return null;
  }
};

/**
 * Get referral stats from server
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>}
 */
export const getReferralStatsFromServer = async (userId) => {
  try {
    const response = await fetch(`${PROXY_SERVER_URL}/api/referrals/stats?userId=${encodeURIComponent(userId)}`);
    const data = await response.json();

    if (data.code !== undefined) {
      return data;
    } else {
      console.error('[ReferralService] Failed to get stats:', data.error);
      return null;
    }
  } catch (error) {
    console.error('[ReferralService] Error getting stats from server:', error);
    return null;
  }
};

/**
 * Initialize referral code on server (call this when user first creates their code)
 * @returns {Promise<string>}
 */
export const initializeReferralCode = async () => {
  try {
    // Get or create local referral code
    const code = await getOrCreateReferralCode();

    // Get user ID (this will generate and persist if not exists)
    const userId = await getUserId();

    if (userId) {
      // Register on server (idempotent - safe to call multiple times)
      await registerReferralCodeOnServer(userId, code);
    }

    return code;
  } catch (error) {
    console.error('[ReferralService] Error initializing referral code:', error);
    return await getOrCreateReferralCode();
  }
};

/**
 * Check and apply any pending referral rewards for this user
 * This extends the user's trial by 15 days for each completed referral
 * @returns {Promise<number>} Number of rewards applied
 */
export const checkAndApplyReferralRewards = async () => {
  try {
    const userId = await getUserId();
    if (!userId) {
      return 0;
    }

    // Get stats from server to see how many completed referrals we have
    const stats = await getReferralStatsFromServer(userId);
    if (!stats || !stats.monthsEarned || stats.monthsEarned === 0) {
      return 0;
    }

    // Check how many rewards we've already applied locally
    const appliedRewards = await AsyncStorage.getItem('@referral_rewards_applied');
    const alreadyApplied = appliedRewards ? parseInt(appliedRewards, 10) : 0;

    const pendingRewards = stats.monthsEarned - alreadyApplied;

    if (pendingRewards > 0) {
      console.log(`[ReferralService] Found ${pendingRewards} pending reward(s). Applying...`);

      // Import trial service dynamically to avoid circular dependencies
      const { extendTrial } = await import('./trialService');

      // Apply each pending reward (15 days per reward)
      const daysToAdd = pendingRewards * 15;
      const result = await extendTrial(daysToAdd);

      if (result) {
        // Mark these rewards as applied
        await AsyncStorage.setItem('@referral_rewards_applied', stats.monthsEarned.toString());
        console.log(`[ReferralService] ✅ Applied ${pendingRewards} reward(s) - added ${daysToAdd} days to trial`);
        logReferralEvent('reward_applied', { code: stats.code || null, rewards: pendingRewards, days_added: daysToAdd });
        return pendingRewards;
      }
    }

    return 0;
  } catch (error) {
    console.error('[ReferralService] Error checking/applying rewards:', error);
    return 0;
  }
};

/**
 * TESTING ONLY: Clear referral acceptance data for this device
 * This allows you to test accepting referral codes multiple times
 * NOTE: Does NOT clear your own referral code or userId - those should persist
 */
export const clearReferralDataForTesting = async () => {
  try {
    // Only clear the accepted referral data, not the user's own code or ID
    await AsyncStorage.removeItem(REFERRAL_ACCEPTED_KEY);
    await AsyncStorage.removeItem('@device_id');
    console.log('[ReferralService] ✅ Cleared referral acceptance data for testing');
    console.log('[ReferralService] Your own referral code and userId are preserved');
    return true;
  } catch (error) {
    console.error('[ReferralService] Error clearing referral data:', error);
    return false;
  }
};

/**
 * TESTING ONLY: Simulate a friend completing setup with your referral code
 * This will trigger a reward on the server for testing
 * @returns {Promise<boolean>} Success status
 */
export const simulateFriendSignup = async () => {
  try {
    const myCode = await getOrCreateReferralCode();
    const myUserId = await getUserId();

    // Create a fake friend user ID
    const friendUserId = `test_friend_${Date.now()}`;

    console.log(`[ReferralService] Simulating friend signup with your code: ${myCode}`);

    // Complete setup as the friend
    const result = await completeReferralSetup(myCode, friendUserId);

    if (result && result.success) {
      console.log(`[ReferralService] ✅ Friend signup simulated! You earned ${result.monthsEarned} month(s)`);
      console.log(`[ReferralService] Run checkAndApplyReferralRewards() to apply the reward to your trial`);
      return true;
    }

    // If server-side simulation failed (e.g., "No pending referral found for this code"),
    // fall back to a local-only simulation so the test button is still useful.
    console.warn('[ReferralService] Server simulation unavailable (no pending referral). Falling back to local simulation.');
    // Add a fake pending invite so processReferralReward can apply a reward locally
    await addReferralInvite('test');
    const monthsEarned = await processReferralReward(myCode);
    if (monthsEarned > 0) {
      console.log(`[ReferralService] ✅ Local friend signup simulation applied: ${monthsEarned} month(s) locally`);
      return true;
    }

    console.warn('[ReferralService] Local friend signup simulation did not apply any rewards (run checkAndApplyReferralRewards if server has rewards).');
    return false;
  } catch (error) {
    console.error('[ReferralService] Error simulating friend signup:', error);
    return false;
  }
};


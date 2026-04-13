import { useState, useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { 
  hasFeature, 
  getLimit, 
  isUnlimited, 
  exceedsLimit,
  getTierFeatures,
  getTierRole,
  FEATURES 
} from '../constants/featurePermissions';
import { getEffectivePlan } from '../services/trialService';

/**
 * Hook to check feature permissions and limits based on user's tier
 * Automatically uses trial plan if trial is active
 * 
 * Usage:
 * const { canUse, getLimit, isUnlimited, exceedsLimit } = useFeaturePermissions();
 * 
 * if (canUse(FEATURES.GOOGLE_DRIVE_SYNC)) {
 *   // Show Google Drive sync option
 * }
 * 
 * if (exceedsLimit('maxProjects', projects.length)) {
 *   // Show upgrade message
 * }
 */
export const useFeaturePermissions = () => {
  const { userPlan } = useSettings();
  const [effectivePlan, setEffectivePlan] = useState(userPlan);
  const [planResolved, setPlanResolved] = useState(false);

  // Update effective plan when userPlan changes or on mount
  useEffect(() => {
    setPlanResolved(false);
    const updateEffectivePlan = async () => {
      console.log('[useFeaturePermissions] useEffect running, userPlan:', userPlan);
      // Check trial expiration first (this will mark it inactive if expired)
      const { isTrialActive } = await import('../services/trialService');
      await isTrialActive();

      // Then get the effective plan
      const effective = await getEffectivePlan(userPlan);
      console.log('[useFeaturePermissions] getEffectivePlan returned:', effective, 'for userPlan:', userPlan);
      setEffectivePlan(effective);
      setPlanResolved(true);
    };
    updateEffectivePlan();
  }, [userPlan]);

  /**
   * Check if current tier has access to a feature
   * @param {string} feature - Feature constant from FEATURES
   * @returns {boolean}
   */
  const canUse = (feature) => {
    // Use effectivePlan, but if it's stale or doesn't match userPlan (and no trial), use userPlan directly
    // This is a safety measure to ensure permissions work even if effectivePlan hasn't updated yet
    const planToCheck = effectivePlan && effectivePlan !== 'starter' ? effectivePlan : userPlan;
    const result = hasFeature(feature, planToCheck);
    console.log('[useFeaturePermissions] canUse check:', { feature, userPlan, effectivePlan, planToCheck, result });
    return result;
  };

  /**
   * Get the limit for a resource type
   * @param {string} limitType - Limit type (maxProjects, maxPhotosPerProject, etc.)
   * @returns {number} - Limit value (-1 means unlimited)
   */
  const getResourceLimit = (limitType) => {
    return getLimit(limitType, effectivePlan);
  };

  /**
   * Check if a resource type is unlimited
   * @param {string} limitType - Limit type
   * @returns {boolean}
   */
  const isResourceUnlimited = (limitType) => {
    return isUnlimited(limitType, effectivePlan);
  };

  /**
   * Check if current usage exceeds the limit
   * @param {string} limitType - Limit type
   * @param {number} currentUsage - Current usage count
   * @returns {boolean}
   */
  const resourceExceedsLimit = (limitType, currentUsage) => {
    // Don't block while the async trial/plan check is still resolving —
    // the effective plan may still be 'starter' even though a trial is active.
    if (!planResolved) return false;
    return exceedsLimit(limitType, effectivePlan, currentUsage);
  };

  /**
   * Get all features available for current tier
   * @returns {Array<string>}
   */
  const getAvailableFeatures = () => {
    return getTierFeatures(effectivePlan);
  };

  /**
   * Get current tier role information
   * @returns {Object|null}
   */
  const getCurrentTierRole = () => {
    return getTierRole(effectivePlan);
  };

  return {
    // Current tier (actual plan)
    userPlan,
    // Effective tier (trial plan if trial is active)
    effectivePlan,
    
    // Feature checks
    canUse,
    hasFeature: canUse, // Alias for convenience
    
    // Limit checks
    getLimit: getResourceLimit,
    isUnlimited: isResourceUnlimited,
    exceedsLimit: resourceExceedsLimit,
    
    // Information
    getAvailableFeatures,
    getTierRole: getCurrentTierRole,
    
    // Export FEATURES for convenience
    FEATURES,
  };
};

export default useFeaturePermissions;

// Re-export FEATURES for convenience
export { FEATURES } from '../constants/featurePermissions';


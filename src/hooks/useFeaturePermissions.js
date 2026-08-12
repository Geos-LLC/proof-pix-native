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

/**
 * Hook to check feature permissions and limits based on the user's effective tier.
 *
 * `effectivePlan` is provided by SettingsContext as the single source of truth:
 *   effectivePlan = store entitlement OR bonus premium entitlement OR 'starter'
 * (see SettingsContext for the exact derivation). This hook simply consumes it
 * — no async trial resolution, no re-render race between userPlan and effective.
 *
 * Usage:
 *   const { canUse, getLimit, isUnlimited, exceedsLimit } = useFeaturePermissions();
 *
 *   if (canUse(FEATURES.GOOGLE_DRIVE_SYNC)) { ... }
 *   if (exceedsLimit('maxProjects', projects.length)) { ... }
 */
export const useFeaturePermissions = () => {
  const { userPlan, effectivePlan } = useSettings();

  const planToCheck = effectivePlan || userPlan || 'starter';

  const canUse = (feature) => hasFeature(feature, planToCheck);

  const getResourceLimit = (limitType) => getLimit(limitType, planToCheck);

  const isResourceUnlimited = (limitType) => isUnlimited(limitType, planToCheck);

  const resourceExceedsLimit = (limitType, currentUsage) =>
    exceedsLimit(limitType, planToCheck, currentUsage);

  const getAvailableFeatures = () => getTierFeatures(planToCheck);

  const getCurrentTierRole = () => getTierRole(planToCheck);

  return {
    userPlan,
    effectivePlan: planToCheck,
    canUse,
    hasFeature: canUse,
    getLimit: getResourceLimit,
    isUnlimited: isResourceUnlimited,
    exceedsLimit: resourceExceedsLimit,
    getAvailableFeatures,
    getTierRole: getCurrentTierRole,
    FEATURES,
  };
};

export default useFeaturePermissions;

// Re-export FEATURES for convenience
export { FEATURES } from '../constants/featurePermissions';

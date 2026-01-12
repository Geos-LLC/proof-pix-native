/**
 * Feature Permissions Configuration
 * 
 * This file defines which features are available for each tier/plan.
 * This is for internal use (developer and App Store) to control feature access.
 * 
 * Plans: starter, pro, business, enterprise, team
 */

// Feature definitions
export const FEATURES = {
  // Photo Management
  UNLIMITED_PHOTOS: 'unlimited_photos',
  PHOTO_EXPORT: 'photo_export',
  BULK_DELETE: 'bulk_delete',
  
  // Cloud Integration
  GOOGLE_DRIVE_SYNC: 'google_drive_sync',
  DROPBOX_SYNC: 'dropbox_sync',
  MULTIPLE_CLOUD_ACCOUNTS: 'multiple_cloud_accounts',
  BACKGROUND_UPLOAD: 'background_upload',
  
  // Team Features
  TEAM_COLLABORATION: 'team_collaboration',
  TEAM_INVITES: 'team_invites',
  TEAM_MANAGEMENT: 'team_management',
  MULTIPLE_TEAMS: 'multiple_teams',
  
  // Customization
  CUSTOM_WATERMARKS: 'custom_watermarks',
  CUSTOM_LABELS: 'custom_labels',
  ADVANCED_TEMPLATES: 'advanced_templates',
  BRANDING: 'branding',
  
  // Projects
  MULTIPLE_PROJECTS: 'multiple_projects',
  UNLIMITED_PROJECTS: 'unlimited_projects',
  PROJECT_SHARING: 'project_sharing',
  
  // Analytics & Reporting
  ANALYTICS: 'analytics',
  REPORTS: 'reports',
  EXPORT_REPORTS: 'export_reports',
  
  // Advanced Features
  API_ACCESS: 'api_access',
  WEBHOOKS: 'webhooks',
  CUSTOM_INTEGRATIONS: 'custom_integrations',
  PRIORITY_SUPPORT: 'priority_support',
};

// Role definitions for each tier
export const TIER_ROLES = {
  starter: {
    name: 'Starter',
    features: [
      FEATURES.PHOTO_EXPORT,
      FEATURES.BULK_DELETE,
      // No MULTIPLE_PROJECTS - starter can only have 1 project
      // No cloud sync, no team features, no watermark customization, no label customization
    ],
    limits: {
      maxProjects: 1,
      maxPhotosPerProject: 100,
      maxTeamMembers: 0,
      maxCloudAccounts: 0,
    }
  },
  
  pro: {
    name: 'Pro',
    features: [
      FEATURES.UNLIMITED_PHOTOS,
      FEATURES.PHOTO_EXPORT,
      FEATURES.BULK_DELETE,
      FEATURES.GOOGLE_DRIVE_SYNC,
      FEATURES.DROPBOX_SYNC,
      FEATURES.BACKGROUND_UPLOAD,
      FEATURES.MULTIPLE_PROJECTS,
      FEATURES.UNLIMITED_PROJECTS,
      FEATURES.CUSTOM_WATERMARKS,
      FEATURES.CUSTOM_LABELS,
      FEATURES.ADVANCED_TEMPLATES,
      FEATURES.PROJECT_SHARING,
      // No team features - everything else
    ],
    limits: {
      maxProjects: -1, // Unlimited
      maxPhotosPerProject: -1, // Unlimited
      maxTeamMembers: 0, // No team features
      maxCloudAccounts: 1,
    }
  },
  
  business: {
    name: 'Business',
    features: [
      FEATURES.UNLIMITED_PHOTOS,
      FEATURES.PHOTO_EXPORT,
      FEATURES.BULK_DELETE,
      FEATURES.GOOGLE_DRIVE_SYNC,
      FEATURES.DROPBOX_SYNC,
      FEATURES.BACKGROUND_UPLOAD,
      FEATURES.MULTIPLE_PROJECTS,
      FEATURES.UNLIMITED_PROJECTS,
      FEATURES.CUSTOM_WATERMARKS,
      FEATURES.CUSTOM_LABELS,
      FEATURES.ADVANCED_TEMPLATES,
      FEATURES.BRANDING,
      FEATURES.PROJECT_SHARING,
      FEATURES.TEAM_COLLABORATION,
      FEATURES.TEAM_INVITES,
      FEATURES.ANALYTICS,
    ],
    limits: {
      maxProjects: -1,
      maxPhotosPerProject: -1,
      maxTeamMembers: 10,
      maxCloudAccounts: 2,
    }
  },
  
  enterprise: {
    name: 'Enterprise',
    features: [
      FEATURES.UNLIMITED_PHOTOS,
      FEATURES.PHOTO_EXPORT,
      FEATURES.BULK_DELETE,
      FEATURES.GOOGLE_DRIVE_SYNC,
      FEATURES.DROPBOX_SYNC,
      FEATURES.MULTIPLE_CLOUD_ACCOUNTS,
      FEATURES.BACKGROUND_UPLOAD,
      FEATURES.MULTIPLE_PROJECTS,
      FEATURES.UNLIMITED_PROJECTS,
      FEATURES.CUSTOM_WATERMARKS,
      FEATURES.CUSTOM_LABELS,
      FEATURES.ADVANCED_TEMPLATES,
      FEATURES.BRANDING,
      FEATURES.PROJECT_SHARING,
      FEATURES.TEAM_COLLABORATION,
      FEATURES.TEAM_INVITES,
      FEATURES.TEAM_MANAGEMENT,
      FEATURES.MULTIPLE_TEAMS,
      FEATURES.ANALYTICS,
      FEATURES.REPORTS,
      FEATURES.EXPORT_REPORTS,
      FEATURES.API_ACCESS,
      FEATURES.WEBHOOKS,
      FEATURES.CUSTOM_INTEGRATIONS,
      FEATURES.PRIORITY_SUPPORT,
    ],
    limits: {
      maxProjects: -1,
      maxPhotosPerProject: -1,
      maxTeamMembers: -1, // Unlimited
      maxCloudAccounts: -1, // Unlimited
    }
  },
  
  team: {
    name: 'Team',
    features: [
      FEATURES.UNLIMITED_PHOTOS,
      FEATURES.PHOTO_EXPORT,
      FEATURES.BULK_DELETE,
      FEATURES.MULTIPLE_PROJECTS,
      FEATURES.CUSTOM_LABELS,
      FEATURES.TEAM_COLLABORATION,
    ],
    limits: {
      maxProjects: -1,
      maxPhotosPerProject: -1,
      maxTeamMembers: 0, // Team members don't have team management
      maxCloudAccounts: 0, // Team members use admin's cloud
    }
  },
};

/**
 * Check if a feature is available for a given tier
 * @param {string} feature - The feature constant from FEATURES
 * @param {string} tier - The tier/plan name (starter, pro, business, enterprise, team)
 * @returns {boolean} - True if feature is available for the tier
 */
export const hasFeature = (feature, tier) => {
  if (!tier) {
    console.log('[hasFeature] No tier provided:', { feature, tier });
    return false;
  }
  
  // Normalize tier to lowercase for case-insensitive matching
  const normalizedTier = String(tier).toLowerCase();
  
  if (!TIER_ROLES[normalizedTier]) {
    console.log('[hasFeature] Tier not found in TIER_ROLES:', { feature, tier, normalizedTier, availableTiers: Object.keys(TIER_ROLES) });
    return false;
  }
  
  const role = TIER_ROLES[normalizedTier];
  const hasAccess = role.features.includes(feature);
  if (!hasAccess) {
    console.log('[hasFeature] Feature not in tier features:', { feature, tier, normalizedTier, tierFeatures: role.features });
  }
  return hasAccess;
};

/**
 * Get the limit for a specific resource for a given tier
 * @param {string} limitType - The limit type (maxProjects, maxPhotosPerProject, etc.)
 * @param {string} tier - The tier/plan name
 * @returns {number} - The limit value (-1 means unlimited)
 */
export const getLimit = (limitType, tier) => {
  if (!tier) {
    return 0;
  }
  
  // Normalize tier to lowercase for case-insensitive matching
  const normalizedTier = String(tier).toLowerCase();
  
  if (!TIER_ROLES[normalizedTier]) {
    return 0;
  }
  
  const role = TIER_ROLES[normalizedTier];
  return role.limits[limitType] ?? 0;
};

/**
 * Check if a tier has unlimited access to a resource
 * @param {string} limitType - The limit type
 * @param {string} tier - The tier/plan name
 * @returns {boolean} - True if unlimited
 */
export const isUnlimited = (limitType, tier) => {
  return getLimit(limitType, tier) === -1;
};

/**
 * Get all features available for a tier
 * @param {string} tier - The tier/plan name
 * @returns {Array<string>} - Array of feature constants
 */
export const getTierFeatures = (tier) => {
  if (!tier) {
    return [];
  }
  
  // Normalize tier to lowercase for case-insensitive matching
  const normalizedTier = String(tier).toLowerCase();
  
  if (!TIER_ROLES[normalizedTier]) {
    return [];
  }
  
  return TIER_ROLES[normalizedTier].features;
};

/**
 * Get tier role information
 * @param {string} tier - The tier/plan name
 * @returns {Object|null} - Role object with name, features, and limits
 */
export const getTierRole = (tier) => {
  if (!tier) {
    return null;
  }
  
  // Normalize tier to lowercase for case-insensitive matching
  const normalizedTier = String(tier).toLowerCase();
  
  if (!TIER_ROLES[normalizedTier]) {
    return null;
  }
  
  return TIER_ROLES[normalizedTier];
};

/**
 * Check if current usage exceeds tier limit
 * @param {string} limitType - The limit type
 * @param {string} tier - The tier/plan name
 * @param {number} currentUsage - Current usage count
 * @returns {boolean} - True if limit is exceeded
 */
export const exceedsLimit = (limitType, tier, currentUsage) => {
  const limit = getLimit(limitType, tier);
  
  // -1 means unlimited
  if (limit === -1) {
    return false;
  }
  
  return currentUsage >= limit;
};


/**
 * Soft Trial Configuration
 *
 * Pre-subscription free usage. User gets a small number of full exports
 * (low-res + watermark) before being routed to the real Apple/Google paywall.
 * Counts ONLY exports — no time-based expiry.
 */

// Soft-trial export limit removed per the user's spec — starter
// plan now has unlimited single-photo share. The huge sentinel
// value keeps the existing isAvailable/getRemaining/tryConsume
// plumbing intact (so the keychain counter still increments) but
// the badge + paywall trigger never fire in practice.
export const SOFT_TRIAL_EXPORT_LIMIT = 1000000;

export const SOFT_TRIAL_LOW_RES_MAX_DIM = 720;
export const SOFT_TRIAL_QUALITY = 0.6;

export const SOFT_TRIAL_WATERMARK_TEXT = 'ProofPix';
export const SOFT_TRIAL_WATERMARK_OPACITY = 0.55;

export const SOFT_TRIAL_KEYCHAIN_SERVICE = 'com.proofpix.soft_trial';

export const SOFT_TRIAL_SECURE_KEY = 'pp.soft_trial.v1';
export const SOFT_TRIAL_DEVICE_ID_KEY = 'pp.device_id.v1';

export const SOFT_TRIAL_BLOCK_REASONS = {
  LIMIT_REACHED: 'limit_reached',
  TRIAL_USED: 'trial_used',
};

export const PAYWALL_TRIGGERS = {
  EXPORT_LIMIT: 'export_limit',
  WATERMARK: 'watermark',
  HD_EXPORT: 'hd_export',
  UNLIMITED: 'unlimited',
  GENERIC: 'generic',
  SETS_LIMIT: 'sets_limit',           // Starter tried to start an 11th before/after set
  PROGRESS_PHOTOS: 'progress_photos', // Starter tried to capture a progress photo
  MULTI_PHOTO_SHARE: 'multi_share',   // Starter tried to share more than one photo at once
};

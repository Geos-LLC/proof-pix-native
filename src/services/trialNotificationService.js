import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTrialDaysRemaining, isTrialActive, getTrialPlan, getTrialInfo } from './trialService';
import { readSecureJSON } from './secureStorageService';

const TRIAL_NOTIFICATIONS_KEY = '@trial_notifications_shown';

// Trial Notification Service — 7-day trial lifecycle.
//
// Timeline:
//   Day 0  (days=7) → Welcome + First Success      "Welcome to ProofPix"
//   Day 1  (days=6) → Capture Workflow             "Document Every Stage…"
//   Day 2  (days=5) → Core Value (first report)    "Create Your First Client Report"
//   Day 3  (days=4) → Professional Branding        "Promote Your Brand…"
//   Day 4  (days=3) → Cloud Backup                 "Never Lose Job Photos…"
//   Day 5  (days=2) → Referral + Upgrade           "Need More Trial Time?"
//   Day 6  (days=1) → Urgency                      "Your Trial Ends Tomorrow"
//   Day 7+ (days=0) → Expiration                   "Your Trial Has Ended"
//
// Each notification carries a `cta` action key consumed by App.handleTrialCTA
// to route to the right screen (Projects, Camera, ProjectDetail, Settings
// sections, PlanSelection, Referral, restore-purchase flow).

const DEFAULT_SHOWN = {
  day0: false,
  day1: false,
  day7_10: false,   // legacy key — now used for Day 2 (reports)
  day15: false,     // legacy key — now used for Day 3 (branding)
  day22_24: false,  // legacy key — now used for Day 4 (cloud)
  day27_28: false,  // legacy key — now used for Day 5 (referral + upgrade) and Day 6 (urgency)
  day6: false,      // new key for Day 6 distinct from Day 5
  day30: false,
};

/**
 * Get which notifications have been shown
 */
export const getShownNotifications = async () => {
  try {
    const stored = await AsyncStorage.getItem(TRIAL_NOTIFICATIONS_KEY);
    if (stored) return { ...DEFAULT_SHOWN, ...JSON.parse(stored) };
    return { ...DEFAULT_SHOWN };
  } catch (error) {
    console.error('[TrialNotification] Error getting shown notifications:', error);
    return { ...DEFAULT_SHOWN };
  }
};

/**
 * Mark a notification as shown
 */
export const markNotificationShown = async (notificationKey) => {
  try {
    const shown = await getShownNotifications();
    shown[notificationKey] = true;
    await AsyncStorage.setItem(TRIAL_NOTIFICATIONS_KEY, JSON.stringify(shown));
  } catch (error) {
    console.error('[TrialNotification] Error marking notification shown:', error);
  }
};

// --- Suppression context ---------------------------------------------------
// Reads user state to suppress banners whose action the user has already
// completed (e.g. don't push "Connect Cloud Storage" if Drive is connected).
// Every check is best-effort: on read error we default to "show the banner"
// rather than over-suppress.

const ADMIN_CONNECTED_ACCOUNTS_KEY = '@admin_connected_accounts';
const SETTINGS_STORAGE_KEY = 'app-settings';
const PROJECTS_STORAGE_KEY = 'tracked-projects';

const checkSuppressionContext = async () => {
  const ctx = {
    isSubscribed: false,
    hasCloudConnected: false,
    hasBrandConfigured: false,
    hasGeneratedReport: false,
    referralRewardsMaxed: false,
  };

  // userPlan + brand state live in app-settings (secure storage)
  try {
    const settings = await readSecureJSON(SETTINGS_STORAGE_KEY);
    const plan = settings?.userPlan || 'starter';
    ctx.isSubscribed = plan !== 'starter';
    // "Brand configured" = user uploaded a logo. The watermark text defaults
    // to "Created with ProofPix.app" for every user, so checking that field
    // would always suppress the Day 3 banner.
    ctx.hasBrandConfigured = !!(settings?.brandLogoUri || settings?.brandLogo);
  } catch (e) {
    // non-critical
  }

  // Connected cloud accounts
  try {
    const stored = await AsyncStorage.getItem(ADMIN_CONNECTED_ACCOUNTS_KEY);
    if (stored) {
      const accs = JSON.parse(stored);
      ctx.hasCloudConnected = Array.isArray(accs) && accs.some(a => a?.isActive);
    }
  } catch (e) {
    // non-critical
  }

  // Any tracked project with at least one report
  try {
    const projects = await readSecureJSON(PROJECTS_STORAGE_KEY);
    if (Array.isArray(projects)) {
      ctx.hasGeneratedReport = projects.some(p => Array.isArray(p?.reports) && p.reports.length > 0);
    }
  } catch (e) {
    // non-critical
  }

  // Referral rewards — server is source of truth
  try {
    const { getReferralStatsFromServer, getUserId } = await import('./referralService');
    const userId = await getUserId();
    const stats = await getReferralStatsFromServer(userId);
    if (stats?.completedInvites >= 3) ctx.referralRewardsMaxed = true;
  } catch (e) {
    // non-critical
  }

  return ctx;
};

// --- Notification builder --------------------------------------------------

/**
 * Check if a notification should be shown based on days remaining
 * @param {boolean} skipDay0 - Skip Day 0 welcome message (for app startup checks)
 * @returns {Promise<Object|null>}
 */
export const getNotificationToShow = async (skipDay0 = false) => {
  const shown = await getShownNotifications();
  const ctx = await checkSuppressionContext();

  // --- Expired (Day 7+) — fires regardless of trial.active flag ---
  if (!shown.day30) {
    const trialInfo = await getTrialInfo();
    if (trialInfo && trialInfo.plan) {
      const now = new Date().getTime();
      const endMs = new Date(trialInfo.endDate).getTime();
      const daysRemaining = Math.ceil((endMs - now) / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 0 || !trialInfo.active) {
        // Suppress entirely if user already subscribed during trial
        if (ctx.isSubscribed) return null;
        await markNotificationShown('day30');
        return {
          key: 'day30',
          type: 'expiration',
          title: 'Your Trial Has Ended',
          message: 'Upgrade to continue documenting jobs, generating reports, and protecting your business.',
          primaryCTA: 'Upgrade to Pro',
          primaryAction: 'paywall',
          secondaryCTA: 'Restore Purchase',
          secondaryAction: 'restore',
          showUpgrade: true,
          urgent: true,
        };
      }
    }
  }

  // From here on we need an active trial
  const trialActive = await isTrialActive();
  if (!trialActive) return null;

  const daysRemaining = await getTrialDaysRemaining();
  const trialPlan = await getTrialPlan();
  const trialInfo = await getTrialInfo();

  // Compute trial duration from durationDays, falling back to dates so
  // the welcome banner always reports the real length.
  const computeDurationFromDates = () => {
    try {
      if (!trialInfo?.startDate || !trialInfo?.endDate) return null;
      const s = new Date(trialInfo.startDate).getTime();
      const e = new Date(trialInfo.endDate).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
      return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
    } catch { return null; }
  };
  const trialDuration = trialInfo?.durationDays || computeDurationFromDates() || 7;

  // --- Day 0 — Welcome + First Success ---
  // Fires while we're still near the start (>= duration - 1). For a fresh
  // 7-day trial that means days=6 or 7.
  const welcomeThreshold = trialDuration - 1;
  if (!skipDay0 && daysRemaining >= welcomeThreshold && !shown.day0) {
    await markNotificationShown('day0');
    let formattedDate = '';
    try {
      if (trialInfo?.endDate) {
        formattedDate = new Date(trialInfo.endDate).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        });
      }
    } catch {}
    const planDisplayName = trialPlan ? trialPlan.charAt(0).toUpperCase() + trialPlan.slice(1) : 'Premium';
    return {
      key: 'day0',
      type: 'welcome',
      title: 'Welcome to ProofPix',
      message: 'Create your first project and generate a professional report in minutes.',
      secondaryText: 'The fastest way to experience ProofPix is to document your first job from start to finish.',
      primaryCTA: 'Create First Project',
      primaryAction: 'create_project',
      endDate: formattedDate,
      showUpgrade: false,
      urgent: false,
      days: trialDuration,
      planName: planDisplayName,
    };
  }

  // --- Day 1 — Capture Workflow (days=6) ---
  if (daysRemaining === 6 && !shown.day1) {
    await markNotificationShown('day1');
    return {
      key: 'day1',
      type: 'engagement',
      title: 'Document Every Stage of the Job',
      message: 'Capture before, progress, and after photos to create complete job documentation.',
      secondaryText: 'Professional documentation protects your business and impresses clients.',
      primaryCTA: 'Take Photos',
      primaryAction: 'camera',
      showUpgrade: false,
      urgent: false,
    };
  }

  // --- Day 2 — Core Value: First Report (days=5) ---
  // Suppress if user has already generated at least one report.
  if (daysRemaining === 5 && !shown.day7_10 && !ctx.hasGeneratedReport) {
    await markNotificationShown('day7_10');
    return {
      key: 'day7_10',
      type: 'engagement',
      title: 'Create Your First Client Report',
      message: 'Turn your job photos into a professional branded report your clients will love.',
      secondaryText: 'Most professionals experience the real value of ProofPix after generating their first report.',
      primaryCTA: 'Create Report',
      primaryAction: 'create_report',
      showUpgrade: false,
      urgent: false,
    };
  }

  // --- Day 3 — Professional Branding (days=4) ---
  // Suppress if branding (logo or watermark) is already configured.
  if (daysRemaining === 4 && !shown.day15 && !ctx.hasBrandConfigured) {
    await markNotificationShown('day15');
    return {
      key: 'day15',
      type: 'engagement',
      title: 'Promote Your Brand on Every Job',
      message: 'Add your company logo, watermarks, labels, and metadata to every photo and report.',
      primaryCTA: 'Customize Branding',
      primaryAction: 'branding',
      showUpgrade: false,
      urgent: false,
    };
  }

  // --- Day 4 — Cloud Backup (days=3) ---
  // Suppress if cloud already connected.
  if (daysRemaining === 3 && !shown.day22_24 && !ctx.hasCloudConnected) {
    await markNotificationShown('day22_24');
    return {
      key: 'day22_24',
      type: 'engagement',
      title: 'Never Lose Job Photos Again',
      message: 'Connect Google Drive, Dropbox, or iCloud and automatically back up every project.',
      primaryCTA: 'Connect Cloud Storage',
      primaryAction: 'cloud',
      showUpgrade: false,
      urgent: false,
    };
  }

  // --- Day 5 — Referral + Upgrade (days=2) ---
  // Suppress entirely if user already paying; downgrade to upgrade-only
  // if they've already maxed referral rewards.
  if (daysRemaining === 2 && !shown.day27_28 && !ctx.isSubscribed) {
    await markNotificationShown('day27_28');
    return {
      key: 'day27_28',
      type: 'referral_upgrade',
      title: 'Need More Time?',
      message: 'Invite another professional and both of you will receive 7 extra free days.',
      secondaryText: ctx.referralRewardsMaxed
        ? 'Or upgrade now to keep unlimited access.'
        : 'You can earn up to 21 additional free days.',
      // If rewards maxed, swap primary/secondary so Upgrade leads.
      primaryCTA: ctx.referralRewardsMaxed ? 'Upgrade Now' : 'Invite Friends',
      primaryAction: ctx.referralRewardsMaxed ? 'paywall' : 'referral',
      secondaryCTA: ctx.referralRewardsMaxed ? null : 'Upgrade Now',
      secondaryAction: ctx.referralRewardsMaxed ? null : 'paywall',
      showUpgrade: true,
      urgent: false,
      days: daysRemaining,
    };
  }

  // --- Day 6 — Urgency (days=1) ---
  // Suppress entirely if subscribed. If referrals maxed, drop the secondary.
  if (daysRemaining === 1 && !shown.day6 && !ctx.isSubscribed) {
    await markNotificationShown('day6');
    return {
      key: 'day6',
      type: 'urgent',
      title: 'Your Trial Ends Tomorrow',
      message: 'Keep unlimited projects, professional reports, cloud sync, and branded documentation.',
      primaryCTA: 'Upgrade Now',
      primaryAction: 'paywall',
      secondaryCTA: ctx.referralRewardsMaxed ? null : 'Invite Friends',
      secondaryAction: ctx.referralRewardsMaxed ? null : 'referral',
      showUpgrade: true,
      urgent: true,
      days: daysRemaining,
    };
  }

  return null;
};

/**
 * Reset all notifications (useful for testing or new trial)
 */
export const resetNotifications = async () => {
  try {
    await AsyncStorage.removeItem(TRIAL_NOTIFICATIONS_KEY);
  } catch (error) {
    console.error('[TrialNotification] Error resetting notifications:', error);
  }
};

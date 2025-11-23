# Referral System Implementation Guide

## Current Implementation (Client-Side Only)

The current referral system is **client-side only** using AsyncStorage. Here's how it works:

### How It Currently Works:

1. **Referral Code Generation**: Each user gets a unique 8-character code stored locally
2. **Deep Link Tracking**: When a friend opens the app via referral link (`proofpix://referral?code=XXXXX`), the code is stored
3. **Setup Completion Detection**: When the friend completes setup (in `SectionLanguageSetupScreen`), the referral is processed
4. **Local Reward Tracking**: Rewards are tracked locally in AsyncStorage

### Current Flow:

```
User A shares link → Friend clicks link → App opens with code → 
Friend completes setup → Local storage updated → Reward tracked locally
```

## What's Missing for Production

### 1. Backend API Endpoints Needed

You'll need a backend server with these endpoints:

#### A. Track Referral Installation
```
POST /api/referrals/track-installation
Body: {
  referralCode: "ABC12345",
  deviceId: "unique-device-id",
  timestamp: "2024-01-01T00:00:00Z"
}
Response: {
  success: true,
  referralId: "ref_123"
}
```

#### B. Complete Referral Setup
```
POST /api/referrals/complete-setup
Body: {
  referralCode: "ABC12345",
  userId: "new-user-id",
  setupCompletedAt: "2024-01-01T00:00:00Z"
}
Response: {
  success: true,
  referrerId: "user-who-invited",
  monthsEarned: 1
}
```

#### C. Apply Reward to Referrer
```
POST /api/subscriptions/extend
Body: {
  userId: "referrer-id",
  monthsToAdd: 1,
  reason: "referral_reward",
  referralId: "ref_123"
}
Response: {
  success: true,
  newExpiryDate: "2024-02-01T00:00:00Z"
}
```

#### D. Get Referral Stats
```
GET /api/referrals/stats?userId=user-id
Response: {
  code: "ABC12345",
  totalInvites: 5,
  completedInvites: 2,
  monthsEarned: 2,
  pendingInvites: 3
}
```

### 2. Database Schema

You'll need a database with these tables:

#### `referrals` table:
```sql
CREATE TABLE referrals (
  id VARCHAR PRIMARY KEY,
  referrer_user_id VARCHAR NOT NULL,
  referral_code VARCHAR(8) UNIQUE NOT NULL,
  referred_user_id VARCHAR,
  status VARCHAR, -- 'pending', 'completed', 'expired'
  created_at TIMESTAMP,
  completed_at TIMESTAMP,
  device_id VARCHAR,
  FOREIGN KEY (referrer_user_id) REFERENCES users(id),
  FOREIGN KEY (referred_user_id) REFERENCES users(id)
);
```

#### `referral_rewards` table:
```sql
CREATE TABLE referral_rewards (
  id VARCHAR PRIMARY KEY,
  referral_id VARCHAR NOT NULL,
  referrer_user_id VARCHAR NOT NULL,
  months_earned INT NOT NULL,
  applied_at TIMESTAMP,
  subscription_extended_to TIMESTAMP,
  FOREIGN KEY (referral_id) REFERENCES referrals(id),
  FOREIGN KEY (referrer_user_id) REFERENCES users(id)
);
```

### 3. Updated Service Implementation

Here's how to update `referralService.js` to work with a backend:

```javascript
// Add API base URL
const API_BASE_URL = 'https://your-api.com/api';

// Track when friend installs app
export const trackReferralInstallation = async (referralCode) => {
  try {
    const deviceId = await getDeviceId(); // You'll need a device ID
    const response = await fetch(`${API_BASE_URL}/referrals/track-installation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode,
        deviceId,
        timestamp: new Date().toISOString(),
      }),
    });
    const data = await response.json();
    if (data.success) {
      await acceptReferral(referralCode); // Store locally too
      return data;
    }
  } catch (error) {
    console.error('[ReferralService] Error tracking installation:', error);
  }
};

// Complete referral when friend finishes setup
export const completeReferralSetup = async (referralCode, userId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/referrals/complete-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referralCode,
        userId,
        setupCompletedAt: new Date().toISOString(),
      }),
    });
    const data = await response.json();
    if (data.success) {
      // Backend automatically applies reward to referrer
      return data;
    }
  } catch (error) {
    console.error('[ReferralService] Error completing setup:', error);
  }
};

// Get referral stats from backend
export const getReferralStats = async (userId) => {
  try {
    const response = await fetch(`${API_BASE_URL}/referrals/stats?userId=${userId}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ReferralService] Error getting stats:', error);
    return null;
  }
};
```

### 4. Integration Points

#### Update `FirstLoadScreen.js`:
```javascript
// When referral code is detected
useEffect(() => {
  const checkReferralCode = async () => {
    const referralCode = route?.params?.code;
    if (referralCode) {
      await acceptReferral(referralCode); // Store locally
      await trackReferralInstallation(referralCode); // Track on backend
    }
  };
  checkReferralCode();
}, [route?.params?.code]);
```

#### Update `SectionLanguageSetupScreen.js`:
```javascript
const handleContinue = async () => {
  // Get user ID (you'll need to get this from your auth system)
  const userId = await getCurrentUserId();
  
  // Process referral completion
  const acceptedReferral = await getAcceptedReferral();
  if (acceptedReferral && acceptedReferral.code) {
    await completeReferralSetup(acceptedReferral.code, userId);
    // Backend will automatically:
    // 1. Mark referral as completed
    // 2. Calculate months earned for referrer
    // 3. Extend referrer's subscription
    // 4. Send notification to referrer
  }
  
  navigation.replace('Home');
};
```

#### Update `SettingsScreen.js`:
```javascript
const loadReferralInfo = async () => {
  try {
    const userId = await getCurrentUserId();
    const stats = await getReferralStats(userId);
    if (stats) {
      setReferralInfo({
        code: stats.code,
        invitesSent: stats.totalInvites,
        rewardsEarned: stats.completedInvites,
        totalMonthsEarned: stats.monthsEarned,
      });
    }
  } catch (error) {
    console.error('[Settings] Error loading referral info:', error);
  }
};
```

## Backend Implementation Requirements

### 1. Validation Rules

- **One referral per device**: Prevent same device from claiming multiple referrals
- **Setup completion required**: Only count referrals where friend completes full setup
- **Time limits**: Referrals expire after 30 days if not completed
- **Prevent self-referral**: User can't use their own referral code
- **Stackable rewards**: Track total referrals and calculate months (1=1mo, 2=2mo, 3+=3mo)

### 2. Subscription Extension Logic

```javascript
// Backend pseudocode
function applyReferralReward(referrerId, monthsEarned) {
  const user = getUser(referrerId);
  const currentSubscription = user.subscription;
  
  // Calculate new expiry date
  const currentExpiry = new Date(currentSubscription.expiresAt);
  const newExpiry = new Date(currentExpiry);
  newExpiry.setMonth(newExpiry.getMonth() + monthsEarned);
  
  // Update subscription
  updateSubscription(referrerId, {
    expiresAt: newExpiry,
    referralMonthsAdded: monthsEarned
  });
  
  // Send notification
  sendNotification(referrerId, {
    title: "Referral Reward Earned!",
    message: `You earned ${monthsEarned} free month(s) for referring a friend!`
  });
}
```

### 3. Security Considerations

- **Validate referral codes**: Check code exists and is valid
- **Rate limiting**: Prevent abuse (max referrals per user)
- **Device fingerprinting**: Track unique devices to prevent fraud
- **Email verification**: Optional - verify friend's email matches referral
- **Audit logging**: Log all referral activities for security

## Testing the Current System

For now, you can test locally:

1. **Reset referral data**: Use the reset function in dev mode
2. **Simulate referral**: Manually set referral code in AsyncStorage
3. **Complete setup**: Go through setup flow to trigger reward processing
4. **Check stats**: View referral info in Settings screen

## Next Steps

1. **Set up backend API** with the endpoints above
2. **Create database tables** for referrals and rewards
3. **Update referralService.js** to call backend APIs
4. **Add user authentication** to get userId for API calls
5. **Implement subscription extension** logic on backend
6. **Add push notifications** to notify referrers of rewards
7. **Add analytics** to track referral conversion rates



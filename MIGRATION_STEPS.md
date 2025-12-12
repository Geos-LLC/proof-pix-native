# Migration: Switch from proofpix-475818 to proofpix-d87f0

## Current Issue
Your mobile app's `google-services.json` points to `proofpix-475818`, but you want to use `proofpix-d87f0` as your main project.

## Step-by-Step Migration

### Step 1: Download Correct Firebase Config Files

#### For Android:
1. Go to: https://console.firebase.google.com/project/proofpix-d87f0/settings/general
2. Scroll to "Your apps"
3. Find: **Android app** with package `com.proofpix.app`
4. Click the settings gear icon → "Download google-services.json"
5. **Replace** `android/app/google-services.json` with the downloaded file

#### For iOS:
1. In the same Firebase project settings page
2. Find: **iOS app** with bundle `com.proofpix.nativeapp` (or `com.proofpix.app` if you unified them)
3. Click settings gear icon → "Download GoogleService-Info.plist"
4. **Replace** `GoogleService-Info.plist` with the downloaded file

### Step 2: Verify SHA-1 Fingerprints in proofpix-d87f0

1. Stay on: https://console.firebase.google.com/project/proofpix-d87f0/settings/general
2. Find Android app `com.proofpix.app`
3. Check if your SHA-1 fingerprints are added
4. If not, click "Add fingerprint" and add them:
   - Get SHA-1 by running: `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`
   - Add both SHA-1 and SHA-256

### Step 3: Get OAuth Client IDs from proofpix-d87f0

1. Go to: https://console.cloud.google.com/apis/credentials?project=proofpix-d87f0
2. Look for these OAuth 2.0 Client IDs:
   - **Web client** (Type: Web application)
   - **Android client** (Type: Android)
   - **iOS client** (Type: iOS)
3. Copy their Client IDs

### Step 4: Update .env File

Replace the OAuth client IDs in your `.env` with the ones from `proofpix-d87f0`:

```env
# OLD (proofpix-475818) - REMOVE THESE
# EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=366423185-r9t2c8bcroqaiii2e6jvokmnovjbog0v.apps.googleusercontent.com
# EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don.apps.googleusercontent.com
# EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=366423185-iru8jpgqfgmtp8j61095fqp3fm0kpai0.apps.googleusercontent.com

# NEW (proofpix-d87f0) - ADD THESE
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web_client_id_from_proofpix-d87f0>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<ios_client_id_from_proofpix-d87f0>
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<android_client_id_from_proofpix-d87f0>
```

### Step 5: Update Proxy Server (if needed)

If your proxy server uses OAuth client IDs or service account:
1. Update environment variables on Vercel
2. Use the **Web Client ID** from `proofpix-d87f0`
3. If using service account, download new credentials from `proofpix-d87f0`

### Step 6: Clean Up proofpix-475818

To resolve the conflict warning:

**Option A: Delete the Android app from proofpix-475818**
1. Go to: https://console.firebase.google.com/project/proofpix-475818/settings/general
2. Find Android app `com.proofpix.app`
3. Click settings → "Delete app"

**Option B: Change package name in proofpix-475818** (if you need to keep it)
1. Delete the current Android app
2. Create a new Android app with a different package name (e.g., `com.proofpix.server`)

### Step 7: Fix iOS/Android Package Name Mismatch (Optional but Recommended)

Currently:
- Android: `com.proofpix.app`
- iOS: `com.proofpix.nativeapp`

They should match for easier OAuth configuration.

**To unify them:**
1. In Firebase `proofpix-d87f0`, update iOS app:
   - Delete current iOS app with `com.proofpix.nativeapp`
   - Add new iOS app with bundle ID: `com.proofpix.app`
2. Update `app.config.js`:
   ```javascript
   ios: {
     bundleIdentifier: "com.proofpix.app",
     // ...
   }
   ```
3. Download new `GoogleService-Info.plist`

### Step 8: Rebuild App

After all config changes:

```bash
# Clean build
cd android
./gradlew clean
cd ..

# Rebuild
npx expo run:android
npx expo run:ios
```

### Step 9: Test

1. Open app on Android
2. Try Google Sign-In
3. Should work without DEVELOPER_ERROR
4. Test iOS as well

## Verification Checklist

- [ ] `google-services.json` has project_id: "proofpix-d87f0"
- [ ] `GoogleService-Info.plist` has PROJECT_ID: "proofpix-d87f0"
- [ ] `.env` has OAuth client IDs from proofpix-d87f0
- [ ] SHA-1 fingerprints added to proofpix-d87f0 Android app
- [ ] No warning about duplicate SHA-1 in Firebase
- [ ] Google Sign-In works on Android
- [ ] Google Sign-In works on iOS
- [ ] Proxy server still works (if updated)

## Common Issues After Migration

**"DEVELOPER_ERROR still appears"**
- Clear app data: `adb shell pm clear com.proofpix.app`
- Verify you rebuilt the app (config changes need rebuild)
- Check SHA-1 is in the correct project

**"OAuth client not found"**
- Verify OAuth client IDs in `.env` match proofpix-d87f0
- Check Google Cloud Console has OAuth clients enabled

**"serverAuthCode is null"**
- Verify Web Client ID is from proofpix-d87f0
- Check `offlineAccess: true` in GoogleSignin.configure()

---

**Bottom Line:** Your mobile app should use `proofpix-d87f0` for all platforms. The conflict is because you have the same package name in two different Firebase projects.


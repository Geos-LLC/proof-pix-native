# Google Sign-In Error Fix Guide

## Problem
Getting `DEVELOPER_ERROR` (code 10) when trying to sign in with Google on Android.

## Root Cause
The SHA-1/SHA-256 fingerprints from your debug keystore are not properly registered in the Firebase Console, or they don't match the ones registered for your app.

## Solution

### Step 1: Get Your SHA-1 and SHA-256 Fingerprints

You need to extract the SHA-1 and SHA-256 fingerprints from your debug keystore. Run one of these commands:

#### Option A: Using Java keytool (if Java is in your PATH)
```bash
keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

#### Option B: If Java is not in PATH, use full path
Find your Java installation (usually in `C:\Program Files\Java\jdk-XX.X.X\bin\`) and run:
```powershell
"C:\Program Files\Java\jdk-17\bin\keytool.exe" -list -v -keystore android\app\debug.keystore -alias androiddebugkey -storepass android -keypass android
```

#### Option C: Using Gradle (alternative method)
```bash
cd android
./gradlew signingReport
```

**Look for these two values in the output:**
- **SHA1:** Something like `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- **SHA256:** Something like `92:A6:2E:20:57:B9:69:01:6B:E6:5C:C2:DC:7F:53:C4:2E:04:40:D6`

### Step 2: Add SHA Fingerprints to Firebase Console

1. **Go to Firebase Console:** https://console.firebase.google.com/
2. **Select your project:** `proofpix-475818`
3. **Go to Project Settings:**
   - Click the gear icon ⚙️ in the top left
   - Select "Project settings"
4. **Scroll down to "Your apps" section**
5. **Find your Android app:** `com.proofpix.app`
6. **Click "Add fingerprint"** button
7. **Paste your SHA-1 fingerprint** (the one from Step 1)
8. **Click "Add fingerprint"** again and **add your SHA-256** fingerprint too
9. **Download the updated `google-services.json`** file
   - Click the "Download google-services.json" button
10. **Replace** your existing `android/app/google-services.json` with the downloaded file

### Step 3: Verify OAuth 2.0 Client Configuration

1. **Go to Google Cloud Console:** https://console.cloud.google.com/
2. **Select your project:** `proofpix-475818`
3. **Navigate to:** APIs & Services → Credentials
4. **Find your Android OAuth 2.0 Client ID:**
   - Should be named something like "Android client (auto created by Google Service)"
   - Should have package name: `com.proofpix.app`
   - Should have your SHA-1 fingerprint listed
5. **If it doesn't exist or doesn't have your SHA-1:**
   - Click "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: Android
   - Name: ProofPix Android
   - Package name: `com.proofpix.app`
   - SHA-1 certificate fingerprint: (paste your SHA-1 from Step 1)
   - Click "Create"

### Step 4: Verify Web Client ID Configuration

Make sure you have a Web Client ID (not just Android). This is required for `serverAuthCode` to work:

1. In Google Cloud Console → Credentials
2. You should have a "Web client" OAuth 2.0 Client ID
3. The client ID should match the one in your `.env`:
   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=366423185-r9t2c8bcroqaiii2e6jvokmnovjbog0v.apps.googleusercontent.com
   ```

### Step 5: Rebuild Your App

After making these changes, you **MUST** rebuild your app:

```bash
# Clean the build
cd android
./gradlew clean
cd ..

# Rebuild the app
npx expo run:android
```

**Important:** Just restarting the Metro bundler is NOT enough. You need a full rebuild because `google-services.json` is compiled into the app.

### Step 6: Test Google Sign-In

1. Open your app
2. Try signing in with Google
3. You should see the Google account picker
4. Sign in should succeed without DEVELOPER_ERROR

## Additional Troubleshooting

### If you still get DEVELOPER_ERROR:

1. **Check package name consistency:**
   - `android/app/build.gradle`: `applicationId 'com.proofpix.app'` ✅
   - `google-services.json`: `"package_name": "com.proofpix.app"` ✅
   - Firebase Console: Android app package name ✅
   - Google Cloud Console OAuth client: Package name ✅

2. **Verify you're using the debug keystore:**
   - Look in `android/app/build.gradle` lines 100-106
   - Both debug and release builds use `signingConfigs.debug` ✅

3. **Clear app data and cache:**
   ```bash
   adb shell pm clear com.proofpix.app
   ```

4. **Check Google Play Services:**
   - Make sure Google Play Services is installed and updated on your device/emulator

5. **Enable Google Sign-In API:**
   - Go to Google Cloud Console → APIs & Services → Library
   - Search for "Google Sign-In API" or "Google+ API"
   - Make sure it's enabled

### Common Mistakes:

❌ **Wrong:** Using production keystore fingerprint for debug builds  
✅ **Correct:** Use debug.keystore fingerprint for development

❌ **Wrong:** Only adding SHA-1 to Google Cloud Console but not Firebase  
✅ **Correct:** Add SHA-1 to both Firebase Console AND Google Cloud Console

❌ **Wrong:** Not rebuilding the app after updating google-services.json  
✅ **Correct:** Always rebuild with `npx expo run:android` after config changes

## Firebase Analytics Deprecation Warning

**Note:** You may see a deprecation warning about `logEvent`:
```
This method is deprecated (as well as all React Native Firebase namespaced API)
```

This is a **false positive**. Your code is already using the correct modular API (`analytics().logEvent()`). This warning can be safely ignored or suppressed by updating to the latest Firebase packages when they become available.

The correct syntax (which you're already using):
```javascript
import analytics from '@react-native-firebase/analytics';
await analytics().logEvent('event_name', { params });
```

## Files Modified

- `.env` - Added `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`

## Next Steps

1. ✅ Extract SHA-1 and SHA-256 fingerprints (Step 1)
2. ✅ Add fingerprints to Firebase Console (Step 2)
3. ✅ Verify OAuth configuration (Step 3 & 4)
4. ✅ Rebuild app (Step 5)
5. ✅ Test sign-in (Step 6)

---

**Created:** December 12, 2025  
**Issue:** DEVELOPER_ERROR code 10 on Android Google Sign-In  
**Status:** Ready to implement


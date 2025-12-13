# 🚨 CRITICAL: EAS Build Keystore SHA-1 Issue

## The Problem

You're getting DEVELOPER_ERROR because:

1. ✅ Your `google-services.json` has SHA-1 fingerprints from **local debug keystore**
2. ❌ EAS Build signs APKs with **EAS's keystore** (different SHA-1!)
3. ❌ Firebase doesn't recognize EAS's keystore SHA-1
4. ❌ Google Sign-In fails with DEVELOPER_ERROR

## The Solution

### Option 1: Get SHA-1 from EAS Credentials (Recommended)

1. **View your EAS credentials:**
   ```bash
   eas credentials
   ```
   - Select: Android
   - Select: Production or Preview (whichever you're using)
   - Find the keystore info
   - Copy the SHA-1 fingerprint

2. **Add EAS keystore SHA-1 to Firebase:**
   - Go to: https://console.firebase.google.com/project/proofpix-475818/settings/general
   - Find Android app
   - Click "Add fingerprint"
   - Paste the SHA-1 from EAS credentials
   - Save

3. **Download updated `google-services.json`** and rebuild

### Option 2: Use Local Build (Development Only)

Build locally with your debug keystore:
```bash
npx expo run:android --device
```

This will use the SHA-1 fingerprints already in Firebase and should work immediately.

### Option 3: Configure EAS to Use Your Local Keystore

In `eas.json`, add:
```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease",
        "credentialsSource": "local"
      }
    }
  }
}
```

Then run:
```bash
eas build --platform android --profile preview --local
```

## Why This Happened

- EAS Build has its own keystore for each project
- This keystore has a different SHA-1 than your local `debug.keystore`
- Firebase only knows about your local keystore's SHA-1
- When you install the EAS-built APK, Google can't verify it

## Quick Test

To confirm this is the issue, try building and installing locally:
```bash
npx expo run:android --device
```

If Google Sign-In works with the local build, then the EAS keystore SHA-1 is definitely the problem!

---

**Next Step:** Get the SHA-1 from EAS credentials and add it to Firebase!


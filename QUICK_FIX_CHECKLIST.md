# Quick Fix Checklist - Google Sign-In Error

## ⚡ Quick Commands (Copy & Paste)

### 1. Get SHA-1 Fingerprint (Choose one):

**If Java is in PATH:**
```bash
cd android/app
keytool -list -v -keystore debug.keystore -alias androiddebugkey -storepass android -keypass android
```

**If Java is NOT in PATH:**
```powershell
cd android/app
"C:\Program Files\Java\jdk-17\bin\keytool.exe" -list -v -keystore debug.keystore -alias androiddebugkey -storepass android -keypass android
```
*(Adjust JDK version in path as needed)*

**Using Gradle:**
```bash
cd android
./gradlew signingReport
cd ..
```

### 2. Copy These Values:
Look for these in the command output:
- **SHA1:** `XX:XX:XX:...`
- **SHA256:** `YY:YY:YY:...`

### 3. Add to Firebase Console:
1. Go to: https://console.firebase.google.com/project/proofpix-475818/settings/general
2. Scroll to "Your apps" → Find Android app `com.proofpix.app`
3. Click "Add fingerprint"
4. Paste **SHA-1** → Save
5. Click "Add fingerprint" again
6. Paste **SHA-256** → Save
7. Download new `google-services.json`
8. Replace `android/app/google-services.json`

### 4. Rebuild & Test:
```bash
cd android
./gradlew clean
cd ..
npx expo run:android
```

## ✅ What I've Already Fixed:

1. ✅ Added Android Client ID to `.env`:
   ```
   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=366423185-iru8jpgqfgmtp8j61095fqp3fm0kpai0.apps.googleusercontent.com
   ```

2. ✅ Identified the issue: SHA-1 fingerprint not registered in Firebase

3. ✅ Firebase Analytics warning is a false positive - your code is already using the correct API

## 🔴 What You Need to Do:

1. [ ] Run one of the commands above to get SHA-1/SHA-256
2. [ ] Add fingerprints to Firebase Console
3. [ ] Download updated google-services.json
4. [ ] Replace the file in `android/app/google-services.json`
5. [ ] Rebuild the app with `npx expo run:android`
6. [ ] Test Google Sign-In

## 📋 Expected Result:

After completing these steps, Google Sign-In should work without the DEVELOPER_ERROR.

---

**See `GOOGLE_SIGNIN_FIX.md` for detailed explanations and troubleshooting.**


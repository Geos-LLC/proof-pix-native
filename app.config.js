import 'dotenv/config';
// dotenv/config only auto-loads `.env`. `.env.local` is the file we
// keep out of git for secrets like MAP_API_KEY, so load it
// explicitly here (override:true so values in .env.local win over
// any earlier .env value).
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local', override: true });

export default {
  expo: {
    name: process.env.APP_NAME || "ProofPix",
    slug: "proof-pix-native",
    // Hardcoded — DO NOT use `process.env.VERSION || "..."` here. The EAS
    // production environment had VERSION=1.2.0 stored as a secret, which
    // silently overrode the fallback and shipped 1.2.0 IPAs that Apple
    // rejected (already deleted from EAS env, but keep this guard).
    version: "1.7.7",
    runtimeVersion: "1.7.7",
    updates: {
      url: "https://u.expo.dev/c65badb3-ddbc-4bb8-9de5-fab32a427f16"
    },
    orientation: "default",
    icon: "./assets/PP_logo.png",
    userInterfaceStyle: "light",
    newArchEnabled: true,
    backgroundColor: "#000000",
    scheme: "proofpix",
    splash: {
      image: "./assets/PP_logo_app.png",
      resizeMode: "contain",
      backgroundColor: "#F2C31B"
    },
    // Fonts: we load at runtime via useFonts() in App.js using @expo-google-fonts/* packages.
    // To embed local fonts (dev build only), add: ["expo-font", { fonts: ["./assets/fonts/MyFont.otf"] }] to plugins.
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.proofpix.app",
      buildNumber: "95",
      googleServicesFile: "./GoogleService-Info.plist",
      requireFullScreen: false,
      infoPlist: {
        NSCameraUsageDescription: "ProofPix needs access to your camera to take before and after photos.",
        NSPhotoLibraryUsageDescription: "ProofPix needs access to your photo library to save before and after photos.",
        NSPhotoLibraryAddUsageDescription: "ProofPix needs permission to save photos to your library.",
        NSLocationWhenInUseUsageDescription: "ProofPix may use your location to help tag cleaning projects by city and improve your reports. Your location is never stored in the photos themselves.",
        NSMicrophoneUsageDescription: "ProofPix uses the microphone to record voice notes attached to your photos.",
        NSSpeechRecognitionUsageDescription: "ProofPix transcribes your voice notes on-device using the system speech recognizer.",
        UIViewControllerBasedStatusBarAppearance: true,
        UISupportedInterfaceOrientations: [
          "UIInterfaceOrientationPortrait",
          "UIInterfaceOrientationLandscapeLeft",
          "UIInterfaceOrientationLandscapeRight"
        ],
        ITSAppUsesNonExemptEncryption: false,
        UIFileSharingEnabled: true,
        LSSupportsOpeningDocumentsInPlace: true,
      },
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "com.apple.developer.icloud-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.ubiquity-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.icloud-services": ["CloudDocuments"],
        "com.apple.developer.associated-domains": [
          "applinks:proofpix.app",
          "applinks:www.proofpix.app",
          "applinks:steadfast-blessing-production.up.railway.app"
        ]
      },
      usesAppleSignIn: true,
      usesIcloudStorage: true
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#F2C31B"
      },
      package: "com.proofpix.app",
      versionCode: 79,
      // Google Play Photo/Video Permissions policy (rejection 2026-07-31):
      // apps without a "browse the whole gallery" core use case must use the
      // Android system photo picker (expo-image-picker does this on API 33+,
      // no permission needed) and MUST NOT declare READ_MEDIA_IMAGES /
      // READ_MEDIA_VIDEO / READ_MEDIA_AUDIO / READ_EXTERNAL_STORAGE. Own-app
      // gallery writes go through the native MediaStoreSaver module using
      // scoped-storage MediaStore APIs, which don't need READ_MEDIA_* either.
      permissions: [
        "CAMERA",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.ACCESS_MEDIA_LOCATION"
      ],
      // Strip any READ_MEDIA_* permission that expo-media-library or
      // expo-image-picker might re-inject via manifest merge. Play Console's
      // scanner reads the merged manifest, so blocking here is what actually
      // clears the rejection.
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
      ],
      edgeToEdgeEnabled: true,
      googleServicesFile: "./google-services.json",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "proofpix.app", pathPrefix: "/join" },
            { scheme: "https", host: "proofpix.app", pathPrefix: "/connect" },
            { scheme: "https", host: "www.proofpix.app", pathPrefix: "/join" },
            { scheme: "https", host: "www.proofpix.app", pathPrefix: "/connect" },
            { scheme: "https", host: "steadfast-blessing-production.up.railway.app", pathPrefix: "/join" },
            { scheme: "https", host: "steadfast-blessing-production.up.railway.app", pathPrefix: "/referral" }
          ],
          category: ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      [
        "expo-media-library",
        {
          photosPermission: "Allow ProofPix to access your photos.",
          savePhotosPermission: "Allow ProofPix to save photos.",
          isAccessMediaLocationEnabled: true
        }
      ],
      "expo-screen-orientation",
      [
        "expo-speech-recognition",
        {
          "microphonePermission": "ProofPix uses the microphone to record voice notes attached to your photos.",
          "speechRecognitionPermission": "ProofPix transcribes your voice notes on-device using the system speech recognizer."
        }
      ],
      [
        "expo-build-properties",
        {
          "ios": {
            "useFrameworks": "static",
            "deploymentTarget": "15.1",
            "forceStaticLinking": [
              "RNFBApp",
              "RNFBAnalytics"
            ]
          },
          "android": {
            "compileSdkVersion": 36,
            "targetSdkVersion": 36,
            "buildToolsVersion": "36.0.0"
          }
        }
      ],
      [
        "@react-native-firebase/app",
        {
          "enableFirebaseStaticFramework": true
        }
      ],
      "expo-font",
      // expo-notifications config plugin omitted intentionally: the app only
      // schedules LOCAL notifications (trial / job reminders) via the JS
      // module, and including the plugin auto-adds an aps-environment
      // entitlement that the production provisioning profile under goscha01
      // does not carry. Local notifications work without the plugin.
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "com.googleusercontent.apps.366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don"
        }
      ],
      "./plugins/withImageCompositor.js",
      "./plugins/withMediaStoreSaver.js",
      "react-native-iap",
      // Strip aps-environment last so any earlier autolinked module that
      // re-injected it gets cleared before Xcode codesigns.
      "./plugins/withStripPushEntitlement.js"
    ],
    extra: {
      eas: {
        projectId: "c65badb3-ddbc-4bb8-9de5-fab32a427f16"
      },
      // Environment variables accessible in your app
      googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      // Google OAuth Client IDs - available at runtime via Constants.expoConfig.extra
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "366423185-r9t2c8bcroqaiii2e6jvokmnovjbog0v.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "366423185-iru8jpgqfgmtp8j61095fqp3fm0kpai0.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don.apps.googleusercontent.com",
      // Dropbox OAuth App Key. Set via EAS env vars — no fallback so a
      // silent env-var wipe doesn't reintroduce the compromised value that
      // used to be committed here.
      EXPO_PUBLIC_DROPBOX_APP_KEY: process.env.EXPO_PUBLIC_DROPBOX_APP_KEY,
      // Google Static Maps API key — used by the includeLocation
      // option in report layouts. Plumbed via `extra` (not
      // EXPO_PUBLIC_*) so the value is read at bundle time from
      // .env.local and isn't tracked in git. No fallback by design —
      // if the env var is missing the location map block silently
      // omits itself (locationMapHtml returns '' when apiKey is null).
      mapsApiKey: process.env.MAP_API_KEY || null,
    }
  }
};

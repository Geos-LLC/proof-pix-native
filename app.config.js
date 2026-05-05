import 'dotenv/config';

export default {
  expo: {
    name: process.env.APP_NAME || "ProofPix",
    slug: "proof-pix-native",
    version: process.env.VERSION || "1.5.20",
    runtimeVersion: {
      policy: "appVersion"
    },
    updates: {
      url: "https://u.expo.dev/3e7ed884-bb3a-4191-bcb0-188386d7e977"
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
      buildNumber: "54",
      googleServicesFile: "./GoogleService-Info.plist",
      requireFullScreen: false,
      infoPlist: {
        NSCameraUsageDescription: "ProofPix needs access to your camera to take before and after photos.",
        NSPhotoLibraryUsageDescription: "ProofPix needs access to your photo library to save before and after photos.",
        NSPhotoLibraryAddUsageDescription: "ProofPix needs permission to save photos to your library.",
        NSLocationWhenInUseUsageDescription: "ProofPix may use your location to help tag cleaning projects by city and improve your reports. Your location is never stored in the photos themselves.",
        UIViewControllerBasedStatusBarAppearance: true,
        UISupportedInterfaceOrientations: [
          "UIInterfaceOrientationPortrait",
          "UIInterfaceOrientationLandscapeLeft",
          "UIInterfaceOrientationLandscapeRight"
        ],
        ITSAppUsesNonExemptEncryption: false,
        UIFileSharingEnabled: true,
        LSSupportsOpeningDocumentsInPlace: true,
        NSUserTrackingUsageDescription: "This identifier will be used to deliver personalized ads and measure campaign performance.",
        SKAdNetworkItems: [
          { SKAdNetworkIdentifier: "v9wttpbfk9.skadnetwork" },
          { SKAdNetworkIdentifier: "n38lu8286q.skadnetwork" },
        ]
      },
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "com.apple.developer.icloud-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.ubiquity-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.icloud-services": ["CloudDocuments"],
        "com.apple.developer.associated-domains": [
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
      versionCode: 61,
      permissions: [
        "CAMERA",
        "WRITE_EXTERNAL_STORAGE",
        "READ_EXTERNAL_STORAGE",
        "READ_MEDIA_IMAGES",
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.ACCESS_MEDIA_LOCATION",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO"
      ],
      edgeToEdgeEnabled: true,
      googleServicesFile: "./google-services.json",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "steadfast-blessing-production.up.railway.app",
              pathPrefix: "/join"
            },
            {
              scheme: "https",
              host: "steadfast-blessing-production.up.railway.app",
              pathPrefix: "/referral"
            }
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
            "compileSdkVersion": 35,
            "targetSdkVersion": 35,
            "buildToolsVersion": "35.0.0"
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
      "expo-notifications",
      [
        "@react-native-google-signin/google-signin",
        {
          "iosUrlScheme": "com.googleusercontent.apps.366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don"
        }
      ],
      "./plugins/withImageCompositor.js",
      "./plugins/withMediaStoreSaver.js",
      "react-native-iap",
      [
        "react-native-fbsdk-next",
        {
          "appID": process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || "1650098936170722",
          "clientToken": process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN || "2310b5dd834d666acdfbe3d7182f7d1e",
          "displayName": "ProofPix",
          "autoLogAppEventsEnabled": true,
          "advertiserIDCollectionEnabled": true,
          "isAutoInitEnabled": true,
          "iosUserTrackingPermission": "This identifier will be used to deliver personalized ads and measure campaign performance."
        }
      ],
      "expo-tracking-transparency"
    ],
    extra: {
      eas: {
        projectId: "3e7ed884-bb3a-4191-bcb0-188386d7e977"
      },
      // Environment variables accessible in your app
      googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      // Google OAuth Client IDs - available at runtime via Constants.expoConfig.extra
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "366423185-r9t2c8bcroqaiii2e6jvokmnovjbog0v.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "366423185-iru8jpgqfgmtp8j61095fqp3fm0kpai0.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don.apps.googleusercontent.com",
      // Dropbox OAuth App Key - available at runtime via Constants.expoConfig.extra
      EXPO_PUBLIC_DROPBOX_APP_KEY: process.env.EXPO_PUBLIC_DROPBOX_APP_KEY || "78ht1k015widero",
    }
  }
};

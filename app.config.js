import 'dotenv/config';

export default {
  expo: {
    name: process.env.APP_NAME || "ProofPix",
    slug: "proof-pix-native",
    owner: "sayapingeorge",
    version: process.env.VERSION || "1.2.4",
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
    fonts: [
      "./assets/fonts/Quicksand-Light.ttf",
      "./assets/fonts/Quicksand-Regular.ttf",
      "./assets/fonts/Quicksand-Medium.ttf",
      "./assets/fonts/Quicksand-Bold.ttf"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.proofpix.app",
      buildNumber: "2",
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
        LSSupportsOpeningDocumentsInPlace: true
      },
      entitlements: {
        "com.apple.developer.applesignin": ["Default"],
        "com.apple.developer.icloud-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.ubiquity-container-identifiers": ["iCloud.com.proofpix.app"],
        "com.apple.developer.icloud-services": ["CloudDocuments"]
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
      versionCode: 11,
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
      googleServicesFile: "./google-services.json"
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      [
        "react-native-vision-camera",
        {
          cameraPermissionText: "ProofPix needs access to your camera to take before and after photos.",
          enableMicrophonePermission: false
        }
      ],
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
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: 'com.googleusercontent.apps.366423185-oboi1er7n69rgrbqtkf5il8j6tsm4don'
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
      "./plugins/withImageCompositor.js",
      "./plugins/withMediaStoreSaver.js"
    ],
    extra: {
      eas: {
        projectId: "3e7ed884-bb3a-4191-bcb0-188386d7e977"
      },
      // Environment variables accessible in your app
      googleServiceAccountPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    }
  }
};

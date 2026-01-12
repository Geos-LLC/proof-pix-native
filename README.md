# ProofPix Native - React Native App

A professional before & after photo documentation app for cleaning services, built with React Native and Expo.

## Features

- 📷 **Before & After Photos**: Take photos of cleaning jobs before and after work
- 🏠 **Room Organization**: Organize photos by room (Kitchen, Bathroom, Bedroom, etc.)
- 🖼️ **Combined Photos**: Automatically create combined before/after comparison images
- 💾 **Auto-Save**: Photos are automatically saved to your device's photo library
- 📱 **Native Performance**: Built with React Native for iOS and Android

## Getting Started

### Prerequisites

- Node.js (v20.16.0 or higher)
- Expo CLI
- iOS Simulator (macOS) or Android Emulator
- Physical device with Expo Go app (optional)

### Installation

1. Install dependencies:
```bash
cd proof-pix-native
npm install
```

2. Start the development server:
```bash
npm start
```

3. Run on your device:
   - Scan the QR code with Expo Go app (Android) or Camera app (iOS)
   - Or press `i` for iOS simulator
   - Or press `a` for Android emulator

## Project Structure

```
proof-pix-native/
├── src/
│   ├── components/         # Reusable UI components
│   ├── screens/           # App screens
│   │   ├── HomeScreen.js          # Main gallery view
│   │   ├── CameraScreen.js        # Camera interface
│   │   ├── PhotoEditorScreen.js   # Create combined images
│   │   ├── AllPhotosScreen.js     # View all photos
│   │   └── PhotoDetailScreen.js   # Photo detail view
│   ├── context/           # React Context for state management
│   │   └── PhotoContext.js        # Photo state management
│   ├── services/          # Business logic and API calls
│   │   └── storage.js             # AsyncStorage & File System
│   ├── utils/             # Helper functions
│   └── constants/         # App constants
│       └── rooms.js              # Room definitions & colors
├── App.js                 # App entry point with navigation
├── app.json              # Expo configuration
└── package.json          # Dependencies

```

## Key Dependencies

- **React Native**: Core framework
- **Expo**: Development framework and tools
- **expo-camera**: Camera functionality
- **expo-media-library**: Save photos to device
- **@react-navigation/native**: Navigation
- **@react-native-async-storage/async-storage**: Local storage
- **react-native-view-shot**: Capture views as images

## How It Works

### Taking Photos

1. **Before Photo**:
   - Select a room from the tabs
   - Tap the "Take Photo" card
   - Camera opens with back camera
   - Take the "before" photo
   - Photo is saved with room name and number

2. **After Photo**:
   - After taking before photo, camera reopens automatically
   - Before photo appears as overlay to help align the shot
   - Take the "after" photo
   - Photo is saved and linked to before photo

3. **Combined Photo**:
   - After taking both photos, editor screen opens
   - Choose layout (Portrait or Landscape)
   - Combined photo is created automatically
   - Save to device photo library

### Storage

- **Metadata**: Photo metadata (room, name, timestamps) stored in AsyncStorage
- **Images**: Full-resolution images saved to device photo library in "ProofPix" album
- **Organization**: Photos organized by location, room, and timestamp. Album/folder names include location (e.g., "John - Tampa - Dec 21, 2024")

## Building for Production

### iOS

```bash
# Create development build
npx expo run:ios

# Create production build
eas build --platform ios
```

### Android

```bash
# Create development build
npx expo run:android

# Create production build
eas build --platform android
```

## Permissions

The app requires the following permissions:

- **Camera**: To take before and after photos
- **Photo Library**: To save photos to device
- **Media Library**: To organize photos in albums

Permissions are requested at runtime when needed.

## Features vs Web Version

| Feature | Web | Native |
|---------|-----|--------|
| Before/After Photos | ✅ | ✅ |
| Room Organization | ✅ | ✅ |
| Combined Images | ✅ | ✅ |
| Photo Storage | LocalStorage | Device + AsyncStorage |
| Camera | Web API | Native Camera |
| Performance | Good | Excellent |
| Offline Support | Limited | Full |
| App Store | N/A | Yes |

## Troubleshooting

### Camera not working
- Check permissions in device settings
- Restart the Expo development server
- Clear cache: `npm start -- --clear`

### Photos not saving
- Ensure media library permissions are granted
- Check device storage space
- Verify photo library access in settings

### Build errors
- Clear node modules: `rm -rf node_modules && npm install`
- Update Expo SDK: `npx expo install --fix`

## Future Enhancements

- [ ] Share photos via email/text
- [ ] Export multiple photos as PDF
- [ ] Cloud backup and sync
- [ ] Team collaboration features
- [ ] Custom branding/watermarks
- [ ] Advanced photo editing tools

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact support or file an issue in the repository.

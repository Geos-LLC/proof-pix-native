# Testing Guide: Location in Folder Names

## Overview
This guide explains how to test that location is included in folder/album names when creating projects and uploading photos.

## Current Implementation Status

✅ **Location IS included** in folder names via the `createAlbumName()` function
- Location is retrieved from Settings (stored as ID: 'tampa', 'st-petersburg', etc.)
- Album names follow format: `"UserName - Location - Date - TimeID"`
- Example: `"John - tampa - Dec 21, 2024 - 143025"`

**Note:** Currently, location is stored and used as an ID (lowercase, hyphenated) rather than display name. If you want display names (e.g., "Tampa" instead of "tampa"), the code would need a small modification.

## How to Test

### Prerequisites
1. **Start the development server:**
   ```bash
   npm start
   ```

2. **Run on device/emulator:**
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Or scan QR code with Expo Go app

### Test 1: Verify Location in New Project Names

**Steps:**
1. Open the app
2. Navigate to **Settings** (⚙️ icon)
3. Set your **Cleaner Name** (e.g., "John")
4. Select a **Location** from dropdown:
   - Tampa
   - St. Petersburg
   - Jacksonville
   - Miami
5. Save settings
6. Go back to **Home Screen**
7. Tap the **"+" button** to create a new project
8. Check the suggested project name in the modal

**Expected Result:**
- Project name should include location in the format: `"John - tampa - [Current Date] - [Time]"`
- Example: `"John - tampa - Dec 21, 2024 - 143025"`

**Note:** Location appears as lowercase ID (e.g., "tampa") not display name (e.g., "Tampa")

### Test 2: Verify Location in Uploaded Album Names (Google Drive)

**Steps:**
1. Ensure settings are configured:
   - Cleaner Name is set
   - Location is selected
   - Google Drive is connected (if testing uploads)
2. Take some photos (or use existing photos)
3. Navigate to **All Photos** screen
4. Tap **Upload** button (📤)
5. Select upload destination (Google Drive)
6. Complete the upload
7. Check Google Drive folder structure

**Expected Result:**
- In Google Drive, navigate to the location-specific folder
- Album folder should be named: `"John - tampa - Dec 21, 2024 - 143025"`
- Location should appear in the folder name

### Test 3: Verify Location in Dropbox Uploads

**Steps:**
1. Ensure Dropbox is connected in Settings
2. Follow same steps as Test 2, but select Dropbox as upload destination
3. Check Dropbox folder structure

**Expected Result:**
- In Dropbox, navigate to `/proofpix-uploads` folder
- Album folder should be named: `"John - tampa - Dec 21, 2024 - 143025"`
- Location should appear in the folder name

### Test 4: Test Different Locations

**Steps:**
1. Change location in Settings to a different city (e.g., from "Tampa" to "St. Petersburg")
2. Create a new project
3. Verify the new project name includes the new location

**Expected Result:**
- New project name should show: `"John - st-petersburg - [Date] - [Time]"`
- Location ID changes based on selected location

### Test 5: Verify Team Uploads Include Location

**Steps:**
1. Ensure you're in team mode (if applicable)
2. Follow upload process for team uploads
3. Check uploaded folder names

**Expected Result:**
- Team uploads should also include location in album names
- Format: `"Team Member Name - location - [Date] - [Time]"`

## Troubleshooting

### Location Not Appearing in Folder Names

**Check:**
1. Is location set in Settings?
   - Go to Settings → Verify "Location" dropdown has a value selected
2. Check console logs:
   - Look for `[UPLOAD] Album name:` logs during uploads
   - Verify location is included in the log output
3. Verify location is saved:
   - Close and reopen app
   - Check if location persists in Settings

### Location Appears as ID Instead of Name

**Current Behavior:**
- Location is stored as ID (e.g., "tampa", "st-petersburg")
- Album names show the ID, not display name
- This is the current implementation

**If you want display names:**
- Would need to modify `createAlbumName()` to convert location ID to name
- Use `getLocationName(locationId)` from `src/config/locations.js`

### Testing on Different Platforms

**iOS:**
- Test on iOS Simulator or physical device
- Check iCloud Drive uploads (if enabled)
- Verify folder names in Files app

**Android:**
- Test on Android Emulator or physical device
- Check Google Drive uploads
- Verify folder names in Google Drive app

## Code Verification

To verify the code is working correctly, check these locations:

1. **Album Name Creation:**
   - File: `src/services/uploadService.js`
   - Function: `createAlbumName()` (line ~818)
   - Should include location in parts array if provided

2. **Project Name Creation:**
   - File: `src/screens/HomeScreen.js`
   - Function: `openNewProjectModal()` (line ~790)
   - Calls `createAlbumName(userName, new Date(), null, location)`

3. **Upload Album Names:**
   - File: `src/screens/GalleryScreen.js`
   - Lines: ~2105, ~2202
   - Calls `createAlbumName(..., location)`

## Expected Format

The album/folder name format is:
```
{userName} - {location} - {Month} {Day}, {Year} - {HHMMSS}
```

Example outputs:
- `"John - tampa - Dec 21, 2024 - 143025"`
- `"Jane - st-petersburg - Jan 15, 2025 - 091530"`
- `"Team Member - miami - Feb 3, 2025 - 162045"`

## Notes

- Location is optional - if location is null/undefined, it won't be included
- Location ID format: lowercase with hyphens (e.g., "st-petersburg")
- Display name format: Title Case with spaces (e.g., "St. Petersburg")
- Current implementation uses location ID, not display name


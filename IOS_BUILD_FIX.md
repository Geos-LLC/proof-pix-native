# iOS Build Fix for react-native-iap Error

## Problem
The build was failing with this error:
```
type 'OpenIapSerialization' has no member 'receiptValidationProps'
```

This was happening in `react-native-iap` version 14.4.37 and 14.4.46 due to an API incompatibility between the library and the `openiap` pod.

## Solution Applied ✅

### 1. Downgraded react-native-iap
Changed from `14.4.46` to `14.4.37` in package.json

### 2. Created Patch File
Created a patch using `patch-package` that fixes the API mismatch:
- **File**: `patches/react-native-iap+14.4.37.patch`
- **Change**: Fixed `HybridRnIap.swift` line 308
  - From: `OpenIapSerialization.receiptValidationProps(from: ["sku": params.sku])`
  - To: `OpenIapSerialization.verifyPurchaseProps(from: ["sku": params.sku])`

The patch is automatically applied during `npm install` via the `postinstall` script.

### 3. How It Works
1. When you run `npm install`, the `postinstall` script runs
2. `patch-package` automatically applies the patch from `patches/react-native-iap+14.4.37.patch`
3. The Swift compilation error is resolved

### 4. For EAS Build
Your next EAS build will work automatically because:
- ✅ package.json specifies `react-native-iap@14.4.37`
- ✅ The patch file is committed to git
- ✅ The postinstall script applies the patch automatically
- ✅ EAS runs `npm install` which triggers the patch application

Simply run:
```bash
eas build --platform ios --profile production
```

### 5. Verification
To verify the patch is working locally:
```bash
# Remove and reinstall to test
rm -rf node_modules/react-native-iap
npm install

# You should see:
# patch-package 8.0.1
# Applying patches...
# react-native-iap@14.4.37 ✔
```

## Root Cause
The issue was caused by an API mismatch between `react-native-iap` and its dependency `openiap` pod (version 1.2.31). The Swift code in `HybridRnIap.swift` was calling `receiptValidationProps()` which doesn't exist - the correct method is `verifyPurchaseProps()`.

## Files Changed
1. ✅ `package.json` - Updated react-native-iap version
2. ✅ `patches/react-native-iap+14.4.37.patch` - Created patch file
3. ✅ Package already has `patch-package` in postinstall script

## Version Info
- React Native: 0.81.5
- react-native-iap: 14.4.37 (with patch)
- openiap (iOS pod): ~1.2.31
- Expo: 54.0.21
- patch-package: 8.0.1

## Important Notes
- ⚠️ **Do not upgrade react-native-iap** beyond 14.4.37 without testing, as newer versions may have the same issue
- ✅ The patch file must be committed to git for EAS builds to work
- ✅ The postinstall script is already configured in package.json

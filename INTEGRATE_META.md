# Task: Integrate Meta (Facebook) SDK into ProofPix iOS App

## Objective

Integrate Meta SDK to enable app install tracking and in-app event optimization for Meta Ads. Ensure alignment with existing Firebase events.

---

## 1. Install Meta SDK

Use Swift Package Manager:

Repository:
https://github.com/facebook/facebook-ios-sdk

Add package:

* FacebookCore
* FacebookLogin (optional)
* FacebookAEM (recommended)

---

## 2. Configure Info.plist

Add the following keys:

<key>FacebookAppID</key> <string>{YOUR_APP_ID}</string>

<key>FacebookDisplayName</key> <string>ProofPix</string>

<key>FacebookClientToken</key> <string>{YOUR_CLIENT_TOKEN}</string>

<key>LSApplicationQueriesSchemes</key> <array> <string>fbapi</string> <string>fbapi20130214</string> <string>fbapi20130410</string> <string>fbapi20130702</string> <string>fbapi20131010</string> <string>fbapi20131219</string> <string>fbapi20140410</string> <string>fbapi20140116</string> <string>fbapi20150313</string> <string>fbapi20150629</string> <string>fbapi20160328</string> <string>fbauth2</string> <string>fbshareextension</string> </array>

<key>NSUserTrackingUsageDescription</key> <string>This identifier will be used to deliver personalized ads.</string>

---

## 3. Initialize SDK

In AppDelegate (or App entry point):

```swift
import FBSDKCoreKit

ApplicationDelegate.shared.application(
    application,
    didFinishLaunchingWithOptions: launchOptions
)
```

---

## 4. Enable App Tracking Transparency (iOS 14+)

Implement ATT request:

```swift
import AppTrackingTransparency
import AdSupport

ATTrackingManager.requestTrackingAuthorization { status in
    // handle status if needed
}
```

Trigger this after first app launch (recommended: onboarding step).

---

## 5. Automatic Events

Ensure auto logging is enabled:

```swift
Settings.shared.isAutoLogAppEventsEnabled = true
Settings.shared.isAdvertiserTrackingEnabled = true
```

---

## 6. Map Firebase Events → Meta Events

Implement manual event logging to match Firebase events:

### Core events:

```swift
AppEvents.shared.logEvent("first_open")

AppEvents.shared.logEvent("account_created", parameters: [
  "method": method,
  "plan": plan
])

AppEvents.shared.logEvent("photo_save", parameters: [
  "has_labels": hasLabels
])

AppEvents.shared.logEvent("photo_export", parameters: [
  "export_type": exportType
])

AppEvents.shared.logEvent("trial_start", parameters: [
  "plan": plan
])

AppEvents.shared.logEvent("team_invite", parameters: [
  "count": inviteCount
])
```

---

## 7. SKAdNetwork Configuration

Add SKAdNetwork IDs to Info.plist:

<key>SKAdNetworkItems</key> <array> <dict> <key>SKAdNetworkIdentifier</key> <string>v9wttpbfk9.skadnetwork</string> </dict> </array>

(Include full Meta SKAdNetwork list from official docs)

---

## 8. Testing

1. Build and install app (NOT dev mode)
2. Open Meta Events Manager
3. Use Test Events tool
4. Verify:

   * App Install
   * first_open
   * photo_save

---

## 9. Validation Checklist

* SDK initializes without errors
* ATT prompt appears
* Events visible in Meta Events Manager
* Events match Firebase naming
* No duplicate events

---

## 10. Notes

* Use production/TestFlight build for accurate tracking
* Do NOT rely on Meta Pixel (not applicable for App Store)
* Keep event naming consistent with Firebase for unified analytics

---

## Expected Outcome

* Meta Ads can optimize for installs and in-app actions
* Events available for campaign optimization (photo_save, trial_start)
* Full attribution coverage for iOS campaigns

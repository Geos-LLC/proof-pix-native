# ProofPix — QA Test Plan

> **Version:** 1.4.3
> **Platforms:** iOS & Android
> **Date:** March 2026

---

## Table of Contents

1. [Tester Setup Instructions](#1-tester-setup-instructions)
2. [First Launch & Onboarding](#2-first-launch--onboarding)
3. [Camera & Photo Capture](#3-camera--photo-capture)
4. [Photo Editor & Templates](#4-photo-editor--templates)
5. [Projects & Gallery](#5-projects--gallery)
6. [Labels & Watermarks](#6-labels--watermarks)
7. [Cloud Sync (Google Drive & Dropbox)](#7-cloud-sync-google-drive--dropbox)
8. [Teams & Invites](#8-teams--invites)
9. [Subscriptions & In-App Purchases](#9-subscriptions--in-app-purchases)
10. [Trial System](#10-trial-system)
11. [Referral System](#11-referral-system)
12. [Settings](#12-settings)
13. [Localization (Languages)](#13-localization-languages)
14. [Deep Links](#14-deep-links)
15. [Orientation & UI](#15-orientation--ui)
16. [Edge Cases & Error Handling](#16-edge-cases--error-handling)

---

## 1. Tester Setup Instructions

### iOS Setup (TestFlight)

1. Install **TestFlight** from the App Store on your iPhone/iPad.
2. The developer will send you an invite email or a public TestFlight link.
3. Open the link on your iOS device → tap **Accept** → tap **Install** in TestFlight.
4. The app "ProofPix" will appear on your home screen.
5. To test purchases: Apple uses a **Sandbox** environment automatically for TestFlight builds. When prompted to sign in for a purchase, use a **Sandbox Apple ID** (the developer can create one in App Store Connect → Users and Access → Sandbox Testers), or you'll be prompted to create one.
6. **Important:** Sandbox subscriptions renew on an accelerated schedule:
   - 1 month → renews every 5 minutes
   - Subscriptions auto-renew up to 6 times then expire

### Android Setup (Internal/Closed Testing)

1. The developer will add your Google account email as a tester.
2. You will receive an **opt-in link** (e.g., `https://play.google.com/apps/testing/com.proofpix.app`).
3. Open the link in a browser where you're signed in with the tester Google account.
4. Tap **Become a tester** → then **Download it on Google Play**.
5. Install the app from the Play Store.
6. To test purchases: The developer must add your Google account as a **License Tester** in Google Play Console → Setup → License testing. Once added, all purchases are treated as test purchases (no real charges).
7. **Important:** Test subscriptions on Android also use accelerated renewal (5 minutes per "month").

### For Both Platforms

- Grant all permissions when prompted (Camera, Photo Library, Location).
- Test on a real device (not emulator/simulator) for camera and purchase testing.
- Record the device model, OS version, and app version for each bug found.
- Take screenshots or screen recordings when reporting issues.

---

## 2. First Launch & Onboarding

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 2.1 | Fresh install splash screen | Install app → open | Yellow splash screen with ProofPix logo appears. No black screen or "Loading assets..." text visible. |
| 2.2 | Android navigation bar hidden during splash | Open app on Android | System navigation bar (bottom) is hidden during splash/loading. Reappears after load completes. |
| 2.3 | Welcome setup flow | Open app for first time | Welcome screen appears → User info setup → Permissions setup → Plan selection → Home screen. |
| 2.4 | Welcome screen content | View welcome screen | Branding, logo, and "Get Started" button are visible and properly styled. |
| 2.5 | User info setup | Fill in user info on setup screen | User info is saved. Can proceed to next step. |
| 2.6 | Permissions setup | Reach permissions screen | App requests Camera, Photo Library, and Location permissions. Can proceed even if some are denied. |
| 2.7 | Plan selection | Reach plan selection screen | All plans displayed (Starter, Pro, Business, Enterprise). Trial info shown. Can select a plan. |
| 2.8 | Skip to Starter | On plan selection, skip or choose Starter | Trial starts. User lands on Home screen with Starter features. |

---

## 3. Camera & Photo Capture

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 3.1 | Open camera | Tap camera button from Home | Camera opens. Viewfinder shows live preview. |
| 3.2 | Take "Before" photo | Tap capture button | Photo is taken. Thumbnail preview shown. Photo saved as "Before". |
| 3.3 | Take "After" photo | After taking Before, take After photo | Photo is taken. Both Before and After are paired. |
| 3.4 | Switch camera (front/back) | Tap camera flip button | Camera switches between front and rear. |
| 3.5 | Flash toggle | Tap flash icon | Flash cycles through on/off/auto modes. |
| 3.6 | Camera in landscape | Rotate device to landscape | Camera adapts. Photos taken in landscape are correctly oriented. |
| 3.7 | Camera in portrait | Rotate device to portrait | Camera adapts. Photos taken in portrait are correctly oriented. |
| 3.8 | Cancel camera | Tap back/cancel from camera | Returns to previous screen without saving. |
| 3.9 | Photo from gallery | Tap gallery/import button (if available) | Can select existing photo from device gallery as Before or After. |

---

## 4. Photo Editor & Templates

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 4.1 | Open editor | Take Before + After → open editor | Editor opens with both photos visible. |
| 4.2 | Stack Portrait template (9:16) | Select Stack Portrait layout | Photos stacked vertically, 1080×1920 output. |
| 4.3 | Stack Landscape template (16:9) | Select Stack Landscape layout | Photos stacked vertically, 1920×1080 output. |
| 4.4 | Side-by-Side Landscape (16:9) | Select Side-by-Side layout | Photos side by side, 1920×1080 output. |
| 4.5 | Wide template (2:1) | Select Wide layout | Photos side by side, 2000×1000 output. |
| 4.6 | Square Stack (1:1) | Select Square Stack layout | Photos stacked, 1080×1080 output. |
| 4.7 | Square Side (1:1) | Select Square Side layout | Photos side by side, 1080×1080 output. |
| 4.8 | Blog Format (16:9) | Select Blog Format layout | Photos side by side, 1920×1080 output. |
| 4.9 | Save combined photo | Choose template → tap Save | Combined image saved to device gallery. Success message shown. |
| 4.10 | Share combined photo | Choose template → tap Share | Share sheet opens with combined image. Can share to other apps. |
| 4.11 | Export individual photos | Export Before or After separately | Individual photo exported correctly. |

---

## 5. Projects & Gallery

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 5.1 | Create project | Tap "New Project" or "+" | Project creation screen appears. Can enter name, room type, location. |
| 5.2 | View project list | Go to Projects screen | All projects listed with names and photo counts. |
| 5.3 | View gallery | Open a project | Gallery shows all photo pairs in the project. |
| 5.4 | Photo detail view | Tap a photo in gallery | Full-size photo displayed with details (date, labels, etc.). |
| 5.5 | Delete single photo | Long-press or select photo → Delete | Photo removed from project. Confirmation prompt shown first. |
| 5.6 | Bulk delete (Pro+) | Select multiple photos → Delete | All selected photos removed. Feature locked on Starter plan. |
| 5.7 | Starter: 1 project limit | On Starter plan, try to create 2nd project | Blocked with upgrade prompt. Only 1 project allowed. |
| 5.8 | Starter: 100 photo limit | On Starter plan, add 100+ photos to project | Blocked at 100 photos with upgrade prompt. |
| 5.9 | Pro+: Unlimited projects | On Pro plan, create multiple projects | No limit enforced. |
| 5.10 | Pro+: Unlimited photos | On Pro plan, add many photos | No limit enforced. |
| 5.11 | Project sharing (Pro+) | Share a project | Share link or export generated. Feature locked on Starter. |

---

## 6. Labels & Watermarks

### Labels

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 6.1 | Default labels | Take photos without customization | Default "Before" / "After" labels appear on photos. |
| 6.2 | Label position (9 positions) | Settings → Label Customization → change position | Label moves to selected position: left-top, left-middle, left-bottom, center-top, center-middle, center-bottom, right-top, right-middle, right-bottom. |
| 6.3 | Label background color | Change label background color | Color picker works. Label background updates. |
| 6.4 | Label text color | Change label text color | Label text color updates. |
| 6.5 | Label size (small/medium/large) | Toggle label size | Small (10px), Medium (14px), Large (18px) — visual difference clear. |
| 6.6 | Custom label text (Pro+) | On Pro plan, edit label text | Can type custom Before/After labels. Locked on Starter. |
| 6.7 | Label language | Change label language in settings | Labels switch to selected language. |

### Watermarks

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 6.8 | Custom watermark (Pro+) | Settings → Watermark Customization | Can enter custom watermark text. Locked on Starter. |
| 6.9 | Watermark text | Enter watermark text | Text appears as overlay on exported photos. |
| 6.10 | Watermark color | Change watermark color | Watermark color updates via color picker. |
| 6.11 | Watermark opacity | Adjust opacity slider | Watermark transparency changes (0% = invisible, 100% = opaque). |
| 6.12 | Watermark font | Select different font | 5 fonts available: Arial Blank, Shadow Into Light, Shanatel Light, SF Compact, Share Tech. |
| 6.13 | Watermark position | Change watermark position | Watermark moves to selected position on photo. |
| 6.14 | Watermark link | Add link/URL to watermark | Link is embedded in watermark. |

---

## 7. Cloud Sync (Google Drive & Dropbox)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 7.1 | Connect Google Drive (Pro+) | Settings → Cloud → Connect Google | Google sign-in flow opens. Account connects. "Connected" status shown. |
| 7.2 | Connect Dropbox (Pro+) | Settings → Cloud → Connect Dropbox | Dropbox auth flow opens. Account connects. "Connected" status shown. |
| 7.3 | Starter: Cloud blocked | On Starter plan, tap Connect Google/Dropbox | Upgrade prompt shown. Cannot connect. |
| 7.4 | Upload photo to Google Drive | Connect Google → take photo → upload | Photo uploaded to Google Drive. Progress indicator shown. |
| 7.5 | Upload photo to Dropbox | Connect Dropbox → take photo → upload | Photo uploaded to Dropbox. Progress indicator shown. |
| 7.6 | Background upload | Enable background upload → take photos | Photos upload in background. Notification or indicator shown. |
| 7.7 | Non-enterprise: 1 account limit | On Pro/Business, connect Google → try connect Dropbox | Both connect buttons hidden after first connection. "Manage Profiles" button visible but disabled (opens plan selection). |
| 7.8 | Enterprise: Multiple accounts | On Enterprise, connect Google + Dropbox | Both can be connected. "Manage Profiles" opens account manager. |
| 7.9 | Disconnect cloud account | Settings → Cloud → Manage/Disconnect | Account disconnects. Connect buttons reappear. |
| 7.10 | Switch account modal (non-enterprise) | On Pro/Business with account connected, if somehow connect button shown, tap it | Styled bottom-sheet modal appears with: "Disconnect & Connect New", "Upgrade to Enterprise", "Cancel". No silent replacement. |

---

## 8. Teams & Invites

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 8.1 | Set up team (Business+) | Settings → Set up Team | Team creation flow starts. Team name entry, etc. |
| 8.2 | Starter/Pro: Team blocked | On Starter or Pro, tap team button | Upgrade prompt shown. Cannot create team. |
| 8.3 | Manage Team button (green) | Set up team on Business/Enterprise | "Manage Team" button turns **green with white text** (not default white). |
| 8.4 | Manage Team button (default) | No team set up | Button shows "Set up Team" with default white/gray styling. |
| 8.5 | Create team invites | Manage Team → Create Invite | Invite link generated. Can share via share sheet. |
| 8.6 | Join team via invite link | Receive invite link → open on another device | App opens (or app store if not installed). Team join flow starts. |
| 8.7 | Join team via deep link | Open `proofpix://join?invite=...` | App navigates to JoinTeam screen. |
| 8.8 | Team member permissions | Join as team member | Team member has limited features (no team management, no cloud, uses admin's cloud). Unlimited photos and projects. |
| 8.9 | Business: 10 member limit | On Business plan, try to add 11th member | Blocked at 10 members. Upgrade prompt shown. |
| 8.10 | Enterprise: Unlimited members | On Enterprise plan, add many members | No limit enforced. |

---

## 9. Subscriptions & In-App Purchases

### Subscription Plans

| Plan | Monthly Price | Features |
|------|--------------|----------|
| **Starter** | Free | 1 project, 100 photos, basic export |
| **Pro** | Paid | Unlimited photos/projects, cloud sync (1 account), watermarks, labels |
| **Business** | Paid | Pro + team (10 members), 2 cloud accounts, branding, analytics |
| **Enterprise** | Paid | All features, unlimited everything, API access, priority support |

### Seat Add-ons (Business & Enterprise)

| Product | Description |
|---------|-------------|
| Business Seat | Add extra team member slot to Business plan |
| Enterprise Seat | Add extra team member slot to Enterprise plan |

### Test Cases

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 9.1 | View subscription options | Settings → Plan/Upgrade | All plans shown with prices and features listed. |
| 9.2 | Purchase Pro subscription | Select Pro → Confirm purchase | Payment flow (sandbox/test). Subscription activates. Features unlock immediately. |
| 9.3 | Purchase Business subscription | Select Business → Confirm purchase | Payment flow. Business features (team, branding) unlock. |
| 9.4 | Purchase Enterprise subscription | Select Enterprise → Confirm purchase | Payment flow. All features unlock. |
| 9.5 | Purchase seat add-on (Business) | On Business plan → Add Seat | Seat purchase flow. Team member limit increases. |
| 9.6 | Purchase seat add-on (Enterprise) | On Enterprise plan → Add Seat | Seat purchase flow. |
| 9.7 | Subscription renewal | Wait for sandbox renewal (5 min) | Subscription renews. Features remain active. No interruption. |
| 9.8 | Cancel subscription | Cancel via device subscription settings | Subscription remains active until period ends. Features downgrade after expiry. |
| 9.9 | Restore purchases | Settings → Restore Purchases | Previous purchases restored. Correct plan activated. |
| 9.10 | Upgrade plan | Go from Pro → Business | Upgrade flow works. New features unlock. |
| 9.11 | Downgrade plan | Go from Business → Pro | Features restricted to Pro level after current period ends. |
| 9.12 | iOS product IDs verify | Purchase on iOS | Products: `com.goscha01.proofpix.pro.monthly`, `com.goscha01.proofpix.business.monthly`, `com.goscha01.proofpix.enterprise.monthly` |
| 9.13 | Android product IDs verify | Purchase on Android | Products: `com.goscha01.proofpix.pro`, `com.goscha01.proofpix.business`, `com.goscha01.proofpix.enterprise` |

---

## 10. Trial System

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 10.1 | Trial starts on first launch | Install → complete onboarding → select plan | Trial begins. Trial badge/indicator visible. |
| 10.2 | Android trial duration | Check trial on Android | **14 days** trial duration shown. |
| 10.3 | iOS trial duration | Check trial on iOS | **30 days** trial duration shown. |
| 10.4 | Trial countdown | Check trial remaining days over time | Days remaining decreases correctly. |
| 10.5 | Trial expiry | Let trial expire (or adjust device clock) | Features downgrade to Starter. Upgrade prompt appears. |
| 10.6 | Trial with referral bonus | Apply referral code during trial | Trial extended by 15 days. New end date reflects bonus. |
| 10.7 | Trial indicator in UI | During trial period | Clear indication of trial status and days remaining somewhere in the app (Settings or banner). |

---

## 11. Referral System

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 11.1 | Referral code generation | Open Referral screen | Unique 8-character code displayed (uppercase alphanumeric). |
| 11.2 | Share referral code | Tap Share on Referral screen | Share sheet opens with message containing: download links for iOS & Android, referral code, "15 extra days free!" text. |
| 11.3 | Apply referral code (Settings) | Settings → Enter referral code → Apply | Code accepted. Trial extended by 15 days. Success message shown. |
| 11.4 | Apply referral code (deep link) | Open `proofpix://referral/ABC12345` | App opens to referral screen with code pre-filled. |
| 11.5 | Cross-platform referral | Share code from Android → Apply on iOS (or vice versa) | Code works across platforms. Both sides update. |
| 11.6 | Referrer reward: 1 friend | 1 friend uses your code | Friend count shows 1/3. Referrer gets 15 bonus days. |
| 11.7 | Referrer reward: 2 friends | 2 friends use your code | Friend count shows 2/3. Referrer gets 30 bonus days total. |
| 11.8 | Referrer reward: 3 friends (max) | 3 friends use your code | Friend count shows 3/3. Referrer gets 45 bonus days total. |
| 11.9 | Referrer reward: 4th friend | 4th friend tries to use code | Max 3 friends limit reached. No additional days awarded. |
| 11.10 | Referral rewards card | Open Referral screen | Card shows: days earned (not months), "X out of 3" friends. Reward tiers: 1 Friend = 15 Days, 2 = 30 Days, 3 = 45 Days. |
| 11.11 | Auto-register code on launch | Open app after install | Referral code auto-registers on server (no manual step needed). |
| 11.12 | Auto-apply rewards on launch | Open app when rewards are pending | Pending referral rewards auto-applied on app launch. |
| 11.13 | Invalid referral code | Enter random/wrong code | Error message shown. No trial extension. |
| 11.14 | Own code rejected | Try to apply your own referral code | Should be rejected or show error. |

---

## 12. Settings

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 12.1 | Open settings | Tap Settings icon/button | Settings screen loads with all sections visible. |
| 12.2 | Account info | View account section | Shows current plan, email (if signed in), trial status. |
| 12.3 | Google Sign-In | Settings → Sign in with Google | Google auth flow. Account linked. |
| 12.4 | Sign out | Settings → Sign out | User signed out. Data persists locally. |
| 12.5 | Change plan | Settings → Change Plan | Plan selection screen shown. Can upgrade/downgrade. |
| 12.6 | Contact Us | Settings → Contact Us | Contact screen opens with support options. |
| 12.7 | Language selection | Settings → Language | 13 languages listed: English, Spanish, French, German, Russian, Belarusian, Ukrainian, Chinese, Tagalog, Arabic, Korean, Portuguese, Vietnamese. |
| 12.8 | Change language | Select a different language | App UI updates to selected language. Labels, buttons, text all translated. |
| 12.9 | Label customization link | Settings → Label Customization | Opens Label Customization screen. |
| 12.10 | Watermark customization link | Settings → Watermark Customization | Opens Watermark Customization screen. |
| 12.11 | Cloud accounts section | View cloud section | Shows connected accounts (if any). Connect/Manage buttons appropriate to plan. |
| 12.12 | Restore purchases | Settings → Restore Purchases | Purchases restored from App Store / Play Store. |

---

## 13. Localization (Languages)

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 13.1 | English (default) | Fresh install or select English | All UI in English. |
| 13.2 | Spanish | Select Español | UI switches to Spanish. |
| 13.3 | French | Select Français | UI switches to French. |
| 13.4 | German | Select Deutsch | UI switches to German. |
| 13.5 | Russian | Select Русский | UI switches to Russian. |
| 13.6 | Belarusian | Select Беларуская | UI switches to Belarusian. |
| 13.7 | Ukrainian | Select Українська | UI switches to Ukrainian. |
| 13.8 | Chinese | Select 中文 | UI switches to Chinese. |
| 13.9 | Tagalog | Select Tagalog | UI switches to Tagalog. |
| 13.10 | Arabic | Select العربية | UI switches to Arabic. Text direction RTL where applicable. |
| 13.11 | Korean | Select 한국어 | UI switches to Korean. |
| 13.12 | Portuguese | Select Português | UI switches to Portuguese. |
| 13.13 | Vietnamese | Select Tiếng Việt | UI switches to Vietnamese. |
| 13.14 | Labels in selected language | Change language → take photo | Before/After labels appear in the selected language. |
| 13.15 | Language persists after restart | Change language → close app → reopen | Language setting persists. |

---

## 14. Deep Links

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 14.1 | Team invite deep link | Open `proofpix://invite/{token}` | App opens to Invite screen with token loaded. |
| 14.2 | Team join deep link | Open `proofpix://join?invite={data}` | App opens to JoinTeam screen. |
| 14.3 | Referral deep link | Open `proofpix://referral` | App opens to Referral screen. |
| 14.4 | Referral with code deep link | Open `proofpix://referral/{code}` | App opens to Referral screen with code pre-filled. |
| 14.5 | Deep link — app not installed | Open deep link when app not installed | Redirects to App Store (iOS) or Play Store (Android). |
| 14.6 | Web invite link | Open `https://.../join?invite={data}` in browser | Page detects platform, attempts to open app, falls back to app store. |

---

## 15. Orientation & UI

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 15.1 | Portrait mode | Use app in portrait | All screens render correctly. No cut-off content. |
| 15.2 | Landscape mode | Rotate to landscape | App adapts. Camera, editor, and gallery work in landscape. |
| 15.3 | Rotation during photo capture | Rotate while taking photo | Photo orientation is correct. No upside-down or sideways images. |
| 15.4 | iPad / Tablet layout | Use on tablet (if available) | App scales properly. No stretched or tiny elements. |
| 15.5 | Dark/Light mode | Toggle device dark/light mode | App maintains its own styling (light UI style). No broken colors. |
| 15.6 | Android back button | Press hardware/gesture back on Android | Navigates back correctly through screens. No crashes. |
| 15.7 | iOS swipe back | Swipe from left edge on iOS | Navigates back. Smooth animation. |
| 15.8 | Bottom modal styling | Open any bottom-sheet modal | Modal slides up from bottom. Overlay background. Close/cancel button works. |
| 15.9 | App icon (Android) | Check home screen icon | ProofPix logo with yellow background (not Expo default). |
| 15.10 | App icon (iOS) | Check home screen icon | ProofPix logo. |

---

## 16. Edge Cases & Error Handling

| # | Test Case | Steps | Expected Result |
|---|-----------|-------|-----------------|
| 16.1 | No internet — app launch | Disable internet → open app | App launches. Local features work. Cloud features show offline message. |
| 16.2 | No internet — cloud upload | Disable internet → try upload | Clear error message. Upload queued or retry option shown. |
| 16.3 | Camera permission denied | Deny camera permission → try camera | Helpful message explaining how to enable permission in Settings. |
| 16.4 | Storage permission denied | Deny storage permission → try save | Helpful message about enabling permission. |
| 16.5 | Low storage | Fill device storage → try saving photos | Error message. App doesn't crash. |
| 16.6 | App backgrounded during upload | Start upload → switch to another app → return | Upload continues or resumes. No data loss. |
| 16.7 | Force close during operation | Force close app during photo save | On reopen, no corrupt data. Partial save handled gracefully. |
| 16.8 | Expired trial + no subscription | Trial expired, no purchase made | Downgraded to Starter features. Upgrade prompts work. |
| 16.9 | Feature gate popups | Tap a locked feature on Starter plan | Popup explains the feature and shows upgrade option. Tapping upgrade goes to plan selection. |
| 16.10 | Multiple rapid taps | Double/triple tap buttons quickly | No duplicate actions (double purchases, double saves, etc.). |
| 16.11 | Very long project/label name | Enter very long text for project name or label | Text truncated or scrollable. No crash or layout break. |

---

## Bug Report Template

When reporting issues, please include:

```
**Device:** [e.g., iPhone 15 Pro, Samsung Galaxy S24]
**OS Version:** [e.g., iOS 17.4, Android 14]
**App Version:** 1.4.3
**Plan:** [Starter/Pro/Business/Enterprise/Trial]

**Steps to Reproduce:**
1.
2.
3.

**Expected Result:**

**Actual Result:**

**Screenshot/Video:** [attach]
```

---

## Test Priority Guide

| Priority | What to Test First |
|----------|-------------------|
| **P0 — Critical** | App launch, camera, photo save/export, purchases, trial system |
| **P1 — High** | Cloud sync, team invites, referral codes, plan upgrades |
| **P2 — Medium** | Labels, watermarks, templates, language switching |
| **P3 — Low** | Deep links, orientation edge cases, UI polish |

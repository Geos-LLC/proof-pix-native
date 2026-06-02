# ProofPix — Feature Tier Review

A complete inventory of user-visible functionality in the app, grouped by area, with a recommended tier per feature. Use this to decide what belongs in **Starter** (free), **Pro**, **Business**, and **Enterprise**. Leave the "Decision" column blank or annotate inline.

Legend:
- ✅ = currently gated by `canUse(FEATURES.X)` somewhere in code
- ⚙️ = exists but not currently gated by tier
- 🆕 = ships in build 74 (in flight)

---

## 1. Capture (Camera)

| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Take photos (Before / Progress / After) | ⚙️ | Starter | |
| Aspect ratio toggle (4:3, 16:9, 9:16, 1:1, 2:1, 1:2) | ⚙️ | Starter | |
| Front/back camera, flash, zoom | ⚙️ | Starter | |
| Ghost overlay (Before opacity slider while shooting After) | ⚙️ | Starter | |
| Set switching within a room (`< Set N | Set N+1 >`) | ⚙️ | Starter | |
| Room switching (horizontal swipe on capture area) | ⚙️ | Starter | |
| Source-photo swap from library | ⚙️ | Pro | |
| GPS auto-capture on Before photos | 🆕 | Starter (passive) | |
| 100-photo project cap | ✅ `UNLIMITED_PHOTOS` | Starter cap; unlimited from Pro | |

## 2. Edit / Studio

### Layout tab
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Format picker (Square / 16:9 / 9:16 / 2:1 / 1:2) | ⚙️ | Starter (Square + native aspect) / Pro (all) | |
| Combined-photo view modes (Side / Split / Overlay) | ⚙️ | Pro | |
| Source-photo swap (`SOURCE PHOTOS` row, picker by room) | ⚙️ | Pro | |
| Pinch + pan on the preview | ⚙️ | Starter | |

### Labels tab (was "Tags")
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Show BEFORE / AFTER labels (toggle) | ⚙️ | Starter | |
| Label position / font / colors / margins customization | ✅ `CUSTOM_LABELS` | Pro | |
| Customize Watermark (text, URL, color, opacity, font, position) | ✅ `CUSTOM_WATERMARKS` | Pro | |
| Customize Logo (upload PNG + position + size) | ⚙️ | **Business** | |
| Customize Metadata / Timestamp overlay (date/time/address/GPS) | ⚙️ | **Business** | |

### Notes tab
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Text note (per photo) | ⚙️ | Starter | |
| Voice memo recording + playback | 🆕 | Pro | |
| Live transcription (on-device, free) | 🆕 | Pro | |
| Markup (draw / brush / highlight / arrow / circle / measure / text) | ⚙️ | Pro | |

### Export tab
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Single-photo share | ⚙️ | **Starter** | |
| Combined-photo share | ⚙️ | Pro | |
| Apply-changes scope (this photo / room / project) | ⚙️ | Pro | |

## 3. Projects / Timeline / Reports

| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Single project | ⚙️ | Starter | |
| Multiple projects | ✅ `MULTIPLE_PROJECTS` | Pro | |
| Unlimited projects | ✅ `UNLIMITED_PROJECTS` | Pro | |
| Project rename / delete | ⚙️ | Starter | |
| Timeline view (date → room → 4-col photo grid) | ⚙️ | Starter | |
| Long-press to preview a photo | ⚙️ | Starter | |
| Select-photos mode (multi-select for report) | ⚙️ | Pro | |
| **Reports — full feature set below** | ✅ `REPORTS` | **Pro / Business** | |
| Report list view (saved reports) | ⚙️ | Pro | |
| Report editor (title, photo count, include-notes, include-map) | ⚙️ | Pro | |
| Report Preview screen (per saved report) | ⚙️ | Pro | |
| Report Share (re-uses cached HTML file) | ⚙️ | Pro | |
| Report Duplicate | ⚙️ | Pro | |
| Report Generate as PDF (today: self-contained HTML) | ⚙️ | Pro | |
| Include map in report (placeholder, wired but disabled) | ⚙️ | Business | |
| Location tab (distinct strings + 🆕 MapView with GPS pins) | ⚙️ | Pro | |
| 3-dots → Default Settings reset (clears formats + overrides + reports) | ⚙️ | Starter | |
| Share tab on project detail | ⚙️ | Pro | |

## 4. Preview / Fullscreen

| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Pager with 4 corner buttons (Edit / Trash / Edited toggle / Share) | ⚙️ | Starter | |
| "Edited" toggle (preview labels/watermark/logo/metadata/markup) | ⚙️ | Pro | |
| Tap → fullscreen modal with pinch zoom + pan + swipe-down close | ⚙️ | Starter | |
| Set-title flash on set transition | ⚙️ | Starter | |
| Share single photo (preview pager + PhotoSetPreview header) | ⚙️ | Starter | |
| Share composite with overlays (Edited toggle on) | ⚙️ | Pro | |

## 5. Settings

### User / plan
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| User name / email | ⚙️ | Starter | |
| Plan badge + Manage subscription | ⚙️ | All | |
| Restore purchases | ⚙️ | All | |

### Folder / location
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Folder name (LOCATIONS dropdown + "Use current location") | ⚙️ | Starter | |

### Labels section (Settings)
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Show Labels toggle | ⚙️ | Starter | |
| Customize Watermark link (→ WatermarkCustomization) | ✅ `CUSTOM_WATERMARKS` | Pro | |
| Customize Logo link (→ LogoCustomization) | ⚙️ | **Business** | |
| Customize Timestamp link (→ MetadataCustomization) | ⚙️ | **Business** | |

### Sections (rooms)
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Industry dropdown (auto-seeds room list) | ⚙️ | Starter | |
| Custom Sections editor (add/edit/remove room) | ⚙️ | Pro | |

### Upload Structure
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Split photos by date toggle | ⚙️ | Pro | |

### Appearance
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Dark / light mode | ⚙️ | Starter | |

### Cloud & Team Sync
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Google Drive connect / sync / disconnect | ✅ `GOOGLE_DRIVE_SYNC` | Pro | |
| Dropbox connect / sync / disconnect | ✅ `DROPBOX_SYNC` | Pro | |
| Multiple cloud accounts (both at once) | ⚙️ | Business | |
| Background upload | ✅ `BACKGROUND_UPLOAD` | Pro | |
| Team — admin: invite / revoke members | ✅ `TEAM_INVITES` | **Business** | |
| Team — member: view shared projects | ✅ `TEAM_COLLABORATION` | Business | |
| Project sharing (read-only link) | ✅ `PROJECT_SHARING` | Pro | |

### Localization
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Label language picker (13 langs) | ⚙️ | Starter | |
| Section language picker (13 langs) | ⚙️ | Starter | |

### Referral
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Personal referral link + rewards tracking | ⚙️ | All | |

### Misc
| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Reset to defaults (full data wipe) | ⚙️ | All | |
| Admin/dev tools (8-tap unlock) | ⚙️ | Internal only | |

## 6. Sharing / Export

| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Single photo → OS share sheet | ⚙️ | **Starter** | |
| Single photo with overlays baked (Edited toggle) | ⚙️ | Pro | |
| Combined photo (BEFORE+AFTER composite) | ⚙️ | Pro | |
| HTML report file via expo-sharing | ⚙️ | Pro | |
| ZIP of project photos | ⚙️ (stub) | Pro | |
| Share rate limit (was 3/day soft trial — now removed for everyone) | ✅ `UNLIMITED_SHARING` | Starter unlimited single-photo; reports gated | |

## 7. Cloud / Team / Sync

| Feature | Status | Recommended Tier | Decision |
|---|---|---|---|
| Soft trial (free pre-subscription exports) — **REMOVED** | n/a | n/a | |
| Google Drive | ✅ `GOOGLE_DRIVE_SYNC` | Pro | |
| Dropbox | ✅ `DROPBOX_SYNC` | Pro | |
| Multiple cloud accounts | ⚙️ `MULTIPLE_CLOUD_ACCOUNTS` (gate exists) | Business | |
| Team mode (admin manages member access) | ✅ `TEAM_COLLABORATION` | Business | |
| Team — adding/removing team members (admin only) | ✅ `TEAM_MANAGEMENT` (or `TEAM_INVITES`) | Business | |

## 8. Already-gated FEATURES (for reference)

These constants are wired in `useFeaturePermissions`:

| Constant | Currently in tier(s) |
|---|---|
| `UNLIMITED_PHOTOS` | Pro+ |
| `UNLIMITED_SHARING` | Pro+ |
| `MULTIPLE_PROJECTS`, `UNLIMITED_PROJECTS` | Pro+ |
| `CUSTOM_WATERMARKS` | Pro+ |
| `CUSTOM_LABELS` | Pro+ |
| `ADVANCED_TEMPLATES` | Pro+ |
| `BACKGROUND_UPLOAD` | Pro+ |
| `GOOGLE_DRIVE_SYNC`, `DROPBOX_SYNC` | Pro+ |
| `PROJECT_SHARING` | Pro+ |
| `BULK_DELETE` | All |
| `TEAM_COLLABORATION`, `TEAM_INVITES`, `TEAM_MANAGEMENT` | Business+ |
| `ANALYTICS` | Business+ |
| `MULTIPLE_CLOUD_ACCOUNTS` | Business+ |
| `BRANDING` | Business+ |
| `REPORTS` | (declared, recommend Pro) |

## 9. 🆕 In build 74 (just shipped)

| Feature | Recommended Tier | Decision |
|---|---|---|
| Voice memo recording (expo-av) | Pro | |
| On-device live transcription (expo-speech-recognition) | Pro | |
| MapView with GPS markers (Location tab) | Pro | |
| GPS auto-capture on Before photo (`lat`/`lng` on photo record) | Starter (data collection) | |

## 10. Suggested final tier map

A starting point — adjust the Decision column above and we can apply.

### Starter (free)
- Single project, 100-photo cap
- Capture (all modes, formats, ghost overlay, set/room switching)
- Show Labels toggle
- Preview pager + fullscreen viewer (zoom + swipe-down close)
- **Single-photo share** (preview + PhotoSetPreview header)
- Text notes
- Industry picker, sections, localization
- Dark mode, folder name (location), default-settings reset

### Pro
- Everything in Starter +
- Unlimited projects + photos
- Combined-photo formats / view modes / source-photo swap
- Label / Watermark customization
- Markup tools
- Voice memo + transcription
- Reports (list, editor, preview, share, duplicate)
- Google Drive **or** Dropbox (one)
- Background upload, split-by-date
- Custom rooms editor
- "Edited" composite share

### Business
- Everything in Pro +
- Logo upload + overlay
- Metadata / Timestamp overlay (date / time / address / GPS)
- Map embedded in report
- Google Drive **and** Dropbox (both connected)
- Team mode: invite / remove members; shared project access
- Analytics dashboard (when shipped)

### Enterprise
- Everything in Business +
- Multiple cloud accounts beyond 2
- API / webhooks (future)
- Priority support / custom integrations (future)

---

## Decisions to make

Before locking the matrix, the questions that need your call:

1. **Single-photo share — Starter or Pro?** Today the soft-trial limit was removed, so Starter has unlimited single-photo share. Keep that, or gate it (e.g., 1 share/day on Starter)?
2. **Reports — Pro or Business?** Currently the code constant `REPORTS` exists but isn't tied to a tier yet. Pro feels right for solo users; Business if you want to push smaller teams up.
3. **Voice notes + transcription — Pro or Business?** It's data-heavy (audio file + text) and a clear power-user feature.
4. **Logo / Metadata overlays — Business or Pro?** I've put them in Business because they're brand-heavy.
5. **Combined-photo source-photo swap — Pro or Business?** Currently in Pro, but it's a deep editing feature.
6. **Map in Report — Business or Enterprise?** Implementation is a follow-up either way.
7. **Custom Sections editor — Pro or Starter?** Onboarding industry seed is Starter; do users on Starter get to edit room names?
8. **Google Drive + Dropbox simultaneously — Business?** Currently both are Pro-gated independently; "both at once" reads as Business-tier.

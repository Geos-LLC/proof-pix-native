# ProofPix — User Journey Flows

A UX walkthrough of how users move through the app, screen by screen. Pair this with `FEATURE_TIER_REVIEW.md` for tier decisions — every paywall moment is flagged inline as **⚠️ paywall**.

Legend:
- 🟢 = primary action
- 🟡 = optional / secondary action
- ⚠️ = paywall / friction point
- ➜ = navigation transition

---

## 1. First launch (onboarding)

**Goal**: get the user past auth + setup into the capture loop as fast as possible.

```
AuthLoading ➜ FirstLoad / WelcomeSetup ➜ PermissionsSetup ➜ UserInfoSetup ➜ PlanSelection ➜ Home
```

| Step | Screen | What the user sees / does |
|---|---|---|
| 1 | **AuthLoading** | Splash — checking auth state |
| 2 | **WelcomeSetup** | Tagline, "Get started" CTA |
| 3 | **PermissionsSetup** | Camera + Photos permission prompts |
| 4 | **UserInfoSetup** | 🟢 Name + (optional) email |
| 5 | **QualificationPromptModal** | 🟢 Pick industry (Cleaning / Contractors / Real Estate / …) — seeds the room list |
| 6 | **PlanSelection** | 🟡 Plan picker (skippable to Starter) — IAP if user upgrades. ⚠️ paywall (soft) |
| 7 | **Home** | Lands on capture-ready home with default project |

**UX notes**
- Skipping plan picker drops user on Starter with no friction.
- The industry choice persists to `@user_qualification` and seeds the project's room list — re-pickable in Settings later.

---

## 2. Core capture loop (daily use)

**Goal**: take Before, do work, take After (and optional Progress shots in between).

### 2a. Take a Before
```
Home ➜ FAB (camera icon) ➜ CameraScreen [mode=before]
```

| Step | Screen | What the user sees / does |
|---|---|---|
| 1 | **Home** | Tap the yellow camera FAB |
| 2 | **CameraScreen** | Top: room pill ("Kitchen") + mode pill ("Before"). Right: sound + flash. Bottom: mic / shutter / notes / Done. |
| 3 | | 🟢 Tap shutter — Before saved, GPS captured (🆕 build 74), strip auto-snaps to "next capture" placeholder |
| 4 | | 🟡 Swipe up — open the half-screen photo strip below to retake earlier Befores |
| 5 | | 🟡 Swipe left/right on camera area — switch room (or set if strip is open) |
| 6 | | 🟢 Tap Done — back to Home |

### 2b. Come back later for the After
```
Home ➜ (tap the active project's photo card) ➜ camera-ready preview ➜ Camera button [mode=after]
```

OR

```
Home (Projects tab list) ➜ ProjectDetail ➜ FAB ➜ CameraScreen [mode=after]
```

| Step | Screen | What the user sees / does |
|---|---|---|
| 1 | **CameraScreen [after]** | Ghost overlay of the Before is half-transparent over the live view. Opacity slider on the right. |
| 2 | | 🟢 Match framing → tap shutter |
| 3 | | After capture, auto-advance to next un-paired Before in the room. Big "Set N" title flashes briefly. |
| 4 | | Loop until all room sets have Afters → modal "All Photos Taken" → return to Home |

### 2c. Optional Progress shots
- From CameraScreen toggle mode to Progress. Behaves like After but the photo is tagged `PROGRESS` and joins the active set.

**Friction / UX notes**
- The strip's center "next capture" frame is the default landing slot; tapping shutter just adds a new Before. No prompt unless the user has scrolled to an existing Before (then: Replace vs Save as new).
- After mode's set-switching gesture is documented in code comments but not surfaced visually — a small tutorial card could help.

---

## 3. Browse photos (Projects tab + Project Detail)

```
Bottom nav: Projects ➜ ProjectsScreen (list) ➜ tap a project ➜ ProjectDetailScreen
```

### Project Detail tabs

| Tab | Purpose |
|---|---|
| **Timeline** | Photos grouped by date → room → 4-col grid. Tap = open PhotoSetPreview. Long-press = enlarge in-place modal. "Select Photos" pill = enter selection mode (build report). |
| **Location** 🆕 | MapView with GPS markers + list of distinct location strings |
| **Report** | List of saved reports / editor / preview (see §5) |
| **Share** | Stub for future bulk-share options |

### PhotoSetPreviewScreen (tap a photo in Timeline)

| Region | Action |
|---|---|
| Top-left | `<` back chevron + pencil **Edit** (→ StudioDetail) |
| Top-center | Date + room |
| Top-right | **Share** (current photo) |
| Set bar | `< Set N-1 │ X/Y │ Set N+1 >` — switch within the room |
| Room tabs | Horizontal scroll of rooms |
| Big photo | Pager: swipe to walk Before → Progresses → After → Combined |
| Bottom-right (over photo) | 🗑️ trash (delete this photo) |

**UX notes**
- Long-press on a Timeline tile pops a fullscreen enlarge while held (no nav transition).
- Selection mode pre-selects all photos; "Add to report" routes to the picker modal or creates a fresh report.

---

## 4. Edit a photo (Studio)

```
PhotoSetPreview ➜ pencil Edit  OR  Preview pager top-left Edit icon  ➜  StudioDetail (Studio)
```

```
[Layout]  [Labels]  [Notes]  [Export]    (bottom tab bar)
```

### 4a. Layout tab (default)
| Section | What user does |
|---|---|
| **Photo viewport** | Pinch-zoom + pan; pinch reset button |
| **SOURCE PHOTOS** (when set has multiples) | Cards for Before / After with **Change** button — opens room-wide picker |
| **FORMAT** | Square / 16:9 / 9:16 / 2:1 / 1:2 chips |
| **VIEW MODE** (combined only) | Side-by-Side / Split / Overlay segmented pill |

### 4b. Labels tab (was "Tags")
| Tile | Action | Gate |
|---|---|---|
| Watermark | Toggle on/off; tap to → WatermarkCustomization | ⚠️ Pro (text + URL + color edits) |
| Logo | Toggle on/off; tap to → LogoCustomization | ⚠️ **Business candidate** |
| Metadata (Timestamp) | Toggle on/off; tap to → MetadataCustomization | ⚠️ **Business candidate** |
| Labels | Toggle on/off; tap to → LabelCustomization | (free toggle; ⚠️ Pro for customization) |

### 4c. Notes tab
| Section | What user does |
|---|---|
| Inner pills (Notes / Voice / Markup) | Switch the body below |
| **Notes** body | Multiline text input, "Report Note vs Private Note" chip |
| **Voice** body 🆕 | Record button → live timer → Stop. Playback + delete. Transcription textarea fills in as you talk (on-device, free) |
| **Markup** shortcut | Jumps to MarkupEditor screen (full-screen canvas: draw / brush / highlight / arrow / circle / measure / text + color + stroke + undo) |

### 4d. Export tab
| Action | What user does | Gate |
|---|---|---|
| "Share this photo" | Native share sheet | Free |
| "Project share / upload" | Resets to Projects tab for the cloud-upload flow | ⚠️ Pro (cloud sync) |

### 4e. Save button (top-right)
Modal asks scope: **This photo** / **This room** / **Entire project**. Picking persists; closes Studio.

**Friction / UX notes**
- "Customize Watermark / Logo / Metadata" tile rows hit a paywall when not on the right plan — currently route to PlanSelection.
- The Save scope picker is a strong UX moment — explicit consent to apply a change broadly.
- Voice tab's live transcription needs both Mic + Speech permissions — handled inline with one alert each.

---

## 5. Build and share a report

```
ProjectDetail → Report tab ➜ "+ New report" ➜ Editor draft ➜ Generate ➜ Preview ➜ Share
```

### Flow A — fresh report
| Step | Screen | What the user sees / does |
|---|---|---|
| 1 | **Report tab — List** | List of saved reports (or empty state) + 🟢 yellow `+ New report` button |
| 2 | **Report — Editor** | Title (auto: "Project N #1"), Pick photos →, photo count stepper, Include notes, (Include map — disabled), Generate |
| 3 | (optional) tap **Pick photos →** | Jumps to Timeline in selection mode with the draft's photoIds pre-checked; Save returns to editor with new pool |
| 4 | 🟢 Tap **Generate** | Builds self-contained HTML, writes to `documentDirectory/reports/<id>.html`, transitions to Preview |
| 5 | **Report — Preview** | Title + brand logo (if any) + meta line + grid of photos as they'll appear. 🟢 **Share** button. 🟡 pencil Edit (back to editor). 🟡 `< Reports` back. |
| 6 | 🟢 Tap **Share** | Native share sheet — receiver opens HTML in Safari → Print → "Save as PDF" |

### Flow B — share a report you already made
```
Report tab — List ➜ tap a card body ➜ Preview ➜ Share
```
The cached HTML file is re-used (no regenerate) unless the user explicitly hits Edit → Regenerate.

### Flow C — add Timeline photos to an existing report
```
Timeline tab ➜ "Select Photos" pill ➜ tap photos ➜ floating "Add to report (N)" ➜ picker modal:
  • Update [Report 1 name]  → overwrites that report's photo pool
  • Update [Report 2 name]
  • Create new report
```

### Per-card actions on the Reports list

| Icon | Action |
|---|---|
| (card body tap) | → **Preview** |
| ✏️ pencil | → **Editor** |
| 📤 share | Re-share cached file (regenerate if missing) |
| 📋 copy | Duplicate the report ("Title (copy)") |
| 🗑️ trash | Delete report + on-disk file |

**Friction / UX notes**
- "+ New report" used to create the record immediately; it now opens an empty draft — nothing persists until Generate. (Fixed)
- HTML-only export today; expo-print bundling pending for a true PDF.
- Editor's "Regenerate" wording appears when editing an existing report; "Generate" for fresh drafts.

---

## 6. Cloud / Team setup

```
Settings ➜ Cloud & Team Sync section
```

| Action | Result | Gate |
|---|---|---|
| Connect Google Drive | OAuth, pick folder | ⚠️ Pro |
| Connect Dropbox | OAuth, pick folder | ⚠️ Pro |
| Toggle Background upload | New photos auto-sync | ⚠️ Pro |
| Invite team members | Generate token + link + (optional) QR | ⚠️ Business |
| Switch to admin account (team member) | Modal — read-only info | Team member only |

**UX notes**
- Cloud setup is high-friction (OAuth flows on a tiny modal); worth a "tour" first time.
- Team member mode hides admin-only sections instead of showing them locked — cleaner UX but easier to miss.

---

## 7. The bottom nav (always available — except auth flow)

The persistent pill at the bottom shows on every screen except onboarding:

| Tab | Lands on |
|---|---|
| Capture | Home (camera-ready) |
| Projects | ProjectsScreen |
| Edit | StudioScreen grid (last edit context if any) |
| Settings | SettingsScreen |

Tap = always `reset({ index: 0, routes: [{ name: tab }] })` — Back closes the app rather than retracing.

---

## 8. Friction / paywall touch-points (consolidated)

Every spot in the app where a Starter user hits a wall today:

| Where | What they tried | Result |
|---|---|---|
| Settings → Labels → Customize Watermark | Tap the tile | Navigate to **PlanSelection** (PRO badge shown) |
| Settings → Labels → Customize Logo / Timestamp | Tap the tile | Navigate to **PlanSelection** (PRO badge shown) |
| Studio → Layout → SOURCE PHOTOS Change | (currently no gate) | Works; consider gating |
| Studio → Notes → Voice 🆕 | Tap Record | (currently no gate) Works; consider gating |
| Studio → Notes → Markup | Open canvas | (currently no gate) |
| ProjectsScreen | Create 2nd project | ⚠️ Paywall via `MULTIPLE_PROJECTS` |
| Photo grid | Take >100 photos | ⚠️ Paywall via `UNLIMITED_PHOTOS` |
| Share sheet — composite or report | (today: no rate limit since soft-trial removed) | Free for all |
| Settings → Cloud | Connect Google Drive / Dropbox | ⚠️ Paywall |
| Settings → Team | Invite a member | ⚠️ Paywall (Business) |
| Settings → Reports tab → Generate | (today: no tier gate — `REPORTS` constant declared but unused) | Free for all — needs decision |

---

## 9. Recommended UX moments to add / improve

These aren't bugs — they're opportunities surfaced by the journey audit:

1. **Onboarding tour** — after first capture, a one-time overlay showing the strip, set-switching, and the Done flow.
2. **"What's new" sheet** for build 74 — point out Voice memos + MapView so existing users discover them.
3. **Plan badge in the header bar** of long screens (Studio, ProjectDetail) — keeps the user oriented on what they can/can't do.
4. **Smarter empty states**:
   - Reports list when empty: shows "Create your first report" CTA. Good.
   - Location tab when no GPS pins: friendly hint. Good.
   - Voice tab before recording: a single CTA, no clutter. Good.
5. **PreviewScreen polish** — the title + logo + meta block could fade in / show "Generated MMM D" more prominently.
6. **Save scope picker** in Studio — consider auto-defaulting to "This photo" with a Remember-my-choice toggle (some users won't read three options every time).
7. **Cloud OAuth fallback** — currently fails silently if the user backs out; add a friendly "We didn't get connected" toast.
8. **Single-photo share** on Starter — surface in the Preview pager's bottom-row Share button with a small "Starter: 1 photo at a time" hint (or keep silent if you want it to feel premium-by-default).
9. **Industry switcher in Settings** — when changing industries, ask "Reset rooms to new industry's defaults or keep current?" instead of immediately re-seeding.
10. **Report Preview** — add a "Last generated MMM D" subtitle in the editor when reopening an existing report so the user knows whether to regenerate.

---

## 10. Critical journeys (one-screen summary)

```
NEW USER:     Auth → Permissions → Name → Industry → Plan(skip) → Home → Camera → Done
DAILY:        Home → Camera (Before) → … → Camera (After) → All Photos Taken modal → Home
ORGANIZE:     Home → Projects → ProjectDetail → Timeline → tap photo → PhotoSetPreview
EDIT:         PhotoSetPreview → Edit (pencil) → Studio → Layout/Labels/Notes/Export → Save (scope) → back
REPORT:       Project → Report tab → + New report → fill draft → Generate → Preview → Share
SHARE QUICK:  any photo screen → Share icon → OS share sheet
TEAM ADMIN:   Settings → Cloud & Team → Invite → QR / link → member redeems
```

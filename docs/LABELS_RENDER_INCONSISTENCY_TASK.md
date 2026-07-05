# Task: Investigate label position inconsistency across combined-photo render paths

## Symptom

Same combined photo, three different views, three different label positions rendered:

1. **Studio edit screen** (`StudioScreen.js`) — uses `CompareViewer` with `<PhotoLabels photo={beforeForCompare} role="before">` + `<PhotoLabels photo={afterForCompare} role="after">`. Renders BEFORE at top-left of left half, AFTER at bottom-right of right half.

2. **Fullscreen tap-to-preview** (`EnlargedPhotoViewer` main view, opened by tapping the photo on Studio) — uses `<StudioEditOverlays photo={combined} combinedLayout="side">`. Renders BEFORE at top-center of left half, AFTER at top-right of right half.

3. **Fullscreen zoom** (`EnlargedPhotoViewer` zoom layer, entered by long-press inside the fullscreen viewer) — uses `<StudioEditOverlays photo={zoomPhoto} combinedLayout="side">`. Same-as-2 read path, but visually shifted because of pan/zoom transforms.

User reported after OTA `019f33bb` on 2026-07-05 late-night. Three screenshots attached to that conversation turn show the three variations.

## What we know already

- `bde1342` restored on 2026-07-05: `LabelCustomizationScreen` now routes writes for combined photos to source before/after singles via `setPhotoOverride(sourceId, key, value)`.
- `e35bb18` restored via cherry-pick on 2026-07-05: `PhotoLabels` combined branch resolves source before/after and delegates via recursive `<PhotoLabels photo={sourceSide} role="before"/"after">`. Uses same id-prefix + name+room fallback + beforeOverrideId/afterOverrideId swap logic as `StudioScreen.pairResolved`.
- Fixed 2026-07-05: StudioScreen's `<TouchableOpacity onPress={...} navigation.navigate('LabelCustomization')>` deep-link now passes `{ photoId: photo?.id }`. Prior omission caused writes to route through `useScopedSettings(undefined)` → global Settings, affecting every photo in the project.

## Hypotheses to test

The user has been through many write-path fixes today. Their current photo may have overrides scattered across three storage layers:
- `combined.overrides` — from the pre-`bde1342` era when writes went to `useScopedSettings(combined.id)` → `setPhotoOverride(combined.id, ...)`
- `sourceBefore.overrides` / `sourceAfter.overrides` — from post-`bde1342` writes routed to source photos
- Global `SettingsContext` — from the deep-link-missing-photoId era when writes went to `useScopedSettings(undefined)` → global writers

Different render paths may pick up different subsets:

- **StudioScreen's `<PhotoLabels photo={beforeForCompare} role="before">`** reads via `useScopedSettings(sourceId).beforeLabelPosition` etc. Falls back to global. Never touches `combined.overrides`.

- **`StudioEditOverlays photo={combined}`** first calls `useScopedSettings(combined.id)` at line 267 of `StudioOverlays.js` for its OWN overlay-visibility flags (`s.showWatermark` etc.). It then passes `combined` to `<PhotoLabels photo={combined} combinedLayout={combinedLayout}>` without opening a scoped-settings context. `PhotoLabels` internally does `useScopedSettings(photo.id)` — but `photo.id` here is the combined's id. Then `resolveCombinedSources` finds source before/after and recurses with `<PhotoLabels photo={sourceSide} role="before"/"after">`. In the recursive call, `useScopedSettings(sourceId)` reads from source photo's overrides.

Both paths should end up reading source photo's overrides for `beforeLabelPosition` etc. But if `combined.overrides.beforeLabelPosition` is set and something in the outer render intercepts it, the reads may diverge.

**Likely investigation checklist:**

1. Add temporary console.warn log lines in three spots and capture Loki output for one label pick:
   - Inside `StudioScreen`, right before rendering `<PhotoLabels photo={beforeForCompare} role="before">`: log `photo.id`, `photo.overrides?.beforeLabelPosition`, global settings' `beforeLabelPosition`, and what `pickBeforeLabelPosition` returns.
   - Inside `StudioEditOverlays` at line 267, right after `useScopedSettings(photo?.id)`: log `photo.id`, `s.beforeLabelPosition`, and `photo.overrides`.
   - Inside `PhotoLabels`'s combined branch after `resolveCombinedSources`, log the resolved `srcBefore.id`, `srcBefore.overrides?.beforeLabelPosition`, and what the recursive PhotoLabels' inner picker returns.

   All three should show the same final position value. Whichever diverges is the bug source.

2. Check `pickBeforeLabelPosition` at `src/utils/labelPosition.js:68` — it uses `treatAsCombined(photo, combinedContext)` and `isLandscape(photo)` to pick between portrait / landscape variants. Studio's CompareViewer path might pass a `combinedContext` (or not) that differs from StudioEditOverlays' `combinedLayout` prop. Trace how each path constructs the args to `pickBeforeLabelPosition`.

3. Inspect the actual photo data in the app's current state:
   - Combined photo's `overrides` object — what keys are set?
   - Source before's `overrides`
   - Source after's `overrides`
   - Global settings' before/after position values
   - Study which values each render path resolves to.

4. Consider whether the combined image itself is a BAKED bitmap with labels burned in. If so, `EnlargedPhotoViewer` may be showing labels twice: once baked into the image, once from the overlay. If that's the case, the "fullscreen" labels position is actually the BAKE-TIME labels (frozen at capture) while Studio's live overlay is CURRENT positions.

5. Consider aspect ratio effects — Studio uses `pairTemplate` (Square/16:9/9:16/etc.) to reshape the compare view. `EnlargedPhotoViewer` displays the combined bitmap at its native aspect. Same `left-top` position value renders differently in a square container vs a wide-landscape container. If this is the whole story, the fix is to pass `pairTemplate` (or equivalent) through to the fullscreen viewer.

## Expected outcome

Either:
- **Single source of truth for reads**: make all three views resolve label positions from the exact same override cascade + orientation logic. Likely add a shared helper `getEffectiveLabelState(photo, photos, settings, layout)` and have all three views call it.
- **OR**: identify which path is "right" and fix the other two to match.

## Related files

- `src/screens/StudioScreen.js` — Studio edit screen, `pairResolved`, CompareViewer render
- `src/screens/StudioScreen.js:1094-1095` — `<PhotoLabels photo={beforeForCompare} role="before">` calls
- `src/components/EnlargedPhotoViewer.js:86, 687` — StudioEditOverlays render sites
- `src/components/StudioOverlays.js:261-300` — `StudioEditOverlays` component
- `src/components/PhotoLabels.js` — combined-branch resolution + recursion (e35bb18)
- `src/utils/labelPosition.js:68-100` — `pickBeforeLabelPosition` / `pickAfterLabelPosition` / `isLandscape` / `treatAsCombined`
- `src/hooks/useScopedSettings.js` — the 3-layer cascade `photo.overrides → project.overrides → global`
- `src/screens/LabelCustomizationScreen.js:549-585` — combined-source write routing (bde1342 restored)

## Session context ending 2026-07-05

Last committed state on `main` after tonight's push: `495f171 fix(data): resilience + Bullet paywall crash + modals in provider`. Uncommitted work in this task's commit contains: labels-write-fix (bde1342 restored), PhotoLabels e35bb18 recovery, back-arrow menu with Leave-without-saving, This-Set label, StudioScreen deep-link photoId, reset button relocated, tap-to-fullscreen.

User is on production channel, build 77 native, latest OTA `019f33bb`.

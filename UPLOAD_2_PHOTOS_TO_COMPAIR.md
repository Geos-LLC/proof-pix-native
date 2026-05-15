

## AI Agent Task — Add “Upload 2 Photos” collage flow to ProofPix mobile app

### Goal

Add a new **Upload 2 Photos** entry point on the main screen so users can select exactly **2 existing photos** from their phone gallery and create a ProofPix collage with watermark, using the existing collage/output flow where possible.

This feature is intended as a lightweight acquisition feature for users who want to edit existing photos, while keeping the core ProofPix camera workflow unchanged.

---

## Product requirements

### Main UX

On the main/home screen:

* Keep existing **Take Photo** action as primary
* Add a new action/button:

  * **Upload 2 Photos**
* Place it **below the Take Photo icon/button**
* This should feel like a secondary action, not the main workflow

### Upload behavior

When the user taps **Upload 2 Photos**:

* Open the **system photo picker**
* Allow selecting **up to 2 photos only**
* User must end with **exactly 2 photos** to continue
* Do **not** request broad gallery/media permissions if avoidable
* Use **picker-based selected-photo access**, not full gallery access

### Flow after selection

After 2 photos are selected:

* Send user into a dedicated upload-based collage flow
* Reuse as much of the existing before/after collage pipeline as possible
* User should be able to:

  * preview both images
  * swap image order if needed
  * continue to collage generation
  * apply existing watermark/export logic
* Final output should behave like regular ProofPix collage output wherever possible

### Constraints

* Only **2 photos** can be uploaded at one time
* No multi-select beyond 2
* No gallery browser inside the app
* No broad media library sync/import feature
* This is **not** a photo management feature

---

## Policy / architecture requirements

### Important

Implement this in a way that is compliant with app store media access expectations:

* Prefer **system photo picker**
* Avoid broad Android gallery permissions such as unnecessary full media access
* Treat this as **user-initiated selected-photo upload only**
* Do not introduce any architecture that looks like persistent gallery access

### Consent / messaging

Do **not** create a heavy legal-style consent modal.

Instead:

* Optionally show a lightweight first-use explanation:

  * “Choose 2 photos from your gallery to create a before/after collage.”
  * “ProofPix only accesses the photos you select.”
* This should be informational only, not a blocking compliance dialog unless needed by platform implementation

---

## UX details

### Entry point

Home screen additions:

* Existing: **Take Photo**
* New: **Upload 2 Photos**

The new option should:

* visually sit below the take-photo action
* be clearly understandable
* not overpower the core camera flow

### Upload flow states

Implement the following states:

#### 1. Idle

User sees home screen with new button

#### 2. Picker opened

System photo picker opens

#### 3. Fewer than 2 photos selected

If user selects only 1 photo or cancels:

* show friendly prompt:

  * “Please choose 2 photos to create a collage.”
* allow retry

#### 4. More than 2 attempt

If platform picker allows selecting more than 2, enforce app-side validation:

* only allow continuation with 2
* if needed show:

  * “You can upload only 2 photos at a time.”

#### 5. Review step

After selection:

* show both images
* allow swap/reorder
* allow remove/reselect if needed
* CTA: **Create Collage**

#### 6. Output step

Generate collage using existing output pipeline

* include watermark using current rules
* preserve existing share/export behavior where possible

---

## Technical implementation guidance

### Architecture

Implement as a **separate input flow** but **shared output/editor pipeline**.

Suggested structure:

* `HomeScreen`

  * `TakePhotoAction`
  * `UploadTwoPhotosAction`

* `PhotoSourceService`

  * `captureFromCamera()`
  * `pickTwoFromGallery()`

* `UploadCollageFlow`

  * validation for exactly 2 images
  * preview
  * reorder/swap
  * continue

* `CollageSession`

  * source type: `camera` or `upload`
  * selected assets
  * ordering metadata

* `CollageOutputPipeline`

  * existing collage generation logic
  * watermark
  * export/share

### Reuse

Reuse existing logic for:

* collage layout creation
* watermark rendering
* export/share
* preview screen if already available

Only create new logic for:

* picker entry
* 2-photo validation
* upload review/reorder step
* source tracking

### Data model

Add source metadata to session/output if useful:

* `sourceType: "camera" | "upload"`
* `selectedAssetCount`
* optional `entryPoint`

This will help later with analytics and conversion measurement.

---

## Analytics requirements

Add events so we can later measure whether this feature brings useful traffic.

Track at minimum:

* `upload_2_photos_tapped`
* `upload_picker_opened`
* `upload_picker_cancelled`
* `upload_photos_selected`

  * include count
* `upload_selection_invalid`

  * reason: `less_than_2`, `more_than_2`, `unsupported_file`, etc.
* `upload_review_opened`
* `upload_photos_reordered`
* `upload_collage_created`
* `upload_collage_exported`
* `upload_flow_abandoned`

Also include:

* platform
* app version
* user plan if available
* source type = `upload`

---

## Error handling

Handle these cleanly:

* user cancels picker
* only one photo selected
* unsupported/corrupted image
* image load failure
* collage generation failure
* export failure

Use simple messages, not technical ones.

Examples:

* “Please select 2 photos.”
* “Couldn’t load one of the selected photos. Try again.”
* “Something went wrong while creating the collage.”

---

## Non-goals

Do **not** implement any of the following in this task:

* landing page version
* bulk uploads
* gallery browsing inside app
* full album access
* editing more than 2 photos
* advanced photo editor tools
* separate subscription/paywall redesign
* new watermark logic
* new collage styles unless required for compatibility

---

## Acceptance criteria

This task is complete when:

1. Main screen shows **Upload 2 Photos** below **Take Photo**
2. Tapping it opens the system photo picker
3. User can proceed only with exactly 2 selected images
4. User can preview and swap selected photos before collage creation
5. Collage output is generated through existing ProofPix pipeline where possible
6. Watermark appears according to existing rules
7. Export/share works for upload-generated collages
8. No unnecessary broad media/gallery permissions are introduced
9. Analytics events are added for key steps
10. UX remains clean and does not disrupt the main camera-based workflow

---

## Implementation note for reviewer / store-policy positioning

This feature should be implemented and described internally as:

> “Optional user-initiated selection of up to 2 existing photos via the system picker to create a branded before/after collage.”

It should **not** be positioned in code/comments/docs as gallery access, media import infrastructure, or broad library integration.

---

## Nice-to-have

If easy, add a small first-use helper text for this feature:

* “Use 2 existing photos to create a before/after collage.”
* “ProofPix only uses the photos you select.”

Store first-use seen state locally so it is not shown every time.


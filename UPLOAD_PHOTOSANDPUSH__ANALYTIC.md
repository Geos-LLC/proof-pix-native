

# AI Agent Task — Full Analytics Implementation for ProofPix (v2)

## Goal

Implement a **clean, minimal, high-signal analytics system** for ProofPix focused on:

1. **Job completion lifecycle (core product metric)**
2. **Upload vs camera behavior**
3. **Reminder system effectiveness**
4. **User segmentation (qualification)**
5. **Conversion to export (business value)**

This replaces all previous analytics tasks.

---

# Core Principle

Track only what matters:

👉 **Did the user complete the job?**

Everything else supports that.

---

# Global Requirements

## Platform

Use existing:

* Firebase Analytics (GA4)

## Event rules

* All events must be:

  * deduplicated (no double firing)
  * lightweight
  * consistent naming (snake_case)

## Common parameters (attach where available)

Add these params to most events:

* `project_id` (string, required where applicable)
* `source_type` = `"camera" | "upload"`
* `user_type` (if available)
* `platform` = `"ios" | "android"`
* `app_version`

---

# 1️⃣ JOB LIFECYCLE EVENTS (CORE)

## Purpose

Track full flow from start → completion

---

### `before_photo_started`

Triggered when user takes first BEFORE photo

Params:

* `project_id`
* `source_type`

---

### `after_photo_completed`

Triggered when AFTER photo is taken

Params:

* `project_id`
* `time_since_before` (seconds)

---

### `collage_completed`

Triggered when before + after are combined

Params:

* `project_id`
* `source_type`

---

### `job_completed` ⭐ MOST IMPORTANT

Triggered when final output is exported/shared

Params:

* `project_id`
* `time_total` (seconds from before start)
* `source_type`

---

# 2️⃣ UPLOAD FLOW EVENTS

## Purpose

Measure adoption and conversion of new feature

---

### `upload_2_photos_tapped`

---

### `upload_picker_opened`

---

### `upload_picker_cancelled`

---

### `upload_photos_selected`

Params:

* `selected_count`
* `valid_selection` (bool)

---

### `upload_selection_invalid`

Params:

* `reason` = `less_than_2 | more_than_2 | load_failed | unsupported_format`

---

### `upload_review_opened`

---

### `upload_photos_reordered`

---

### `upload_collage_created`

Params:

* `project_id`
* `has_watermark` (bool)

---

# 3️⃣ REMINDER SYSTEM EVENTS

## Purpose

Measure if reminders improve completion

---

### `job_reminder_scheduled`

Params:

* `reminder_type` = `2h | 24h`

---

### `job_reminder_triggered`

(when notification fires)

Params:

* `reminder_type`

---

### `job_reminder_opened`

(when user taps notification)

---

### `job_reminder_cancelled`

Params:

* `reason` = `job_completed | deleted | app_logic`

---

### `job_completed_after_reminder` ⭐

Triggered if job completes after reminder

Params:

* `time_from_reminder`

---

### `unfinished_job_banner_shown`

---

### `unfinished_job_banner_tapped`

---

# 4️⃣ QUALIFICATION EVENTS

## Purpose

Segment users

---

### `qualification_prompt_shown`

---

### `qualification_answered`

Params:

* `user_type` =

  * `cleaning`
  * `contracting`
  * `restoration`
  * `editing`
  * `personal`
  * `other`

---

### `qualification_skipped`

---

## User property (REQUIRED)

Set persistent user property:

* `user_type`

---

# 5️⃣ UPDATE EXISTING EVENTS

Modify existing events to include new params:

---

### `photo_capture`

Add:

* `source_type`
* `project_id`

---

### `photo_export`

Add:

* `source_type`
* `project_id`

---

### `photo_save`

Add:

* `source_type`

---

# 6️⃣ FUNNELS (for GA4 dashboards)

## Core Product Funnel

1. `before_photo_started`
2. `after_photo_completed`
3. `collage_completed`
4. `job_completed`

---

## Upload Funnel

1. `upload_2_photos_tapped`
2. `upload_photos_selected (valid)`
3. `upload_review_opened`
4. `upload_collage_created`
5. `job_completed`

---

## Reminder Funnel

1. `before_photo_started`
2. (no after)
3. `job_reminder_triggered`
4. `job_reminder_opened`
5. `job_completed`

---

## Segmentation

Break all funnels by:

* `user_type`
* `source_type`

---

# 7️⃣ SESSION TRACKING (LIGHTWEIGHT)

For each project/job:

Track locally:

* `project_id`
* `start_time`
* `before_started_at`
* `after_completed_at`
* `completed_at`

Used to compute:

* `time_since_before`
* `time_total`

---

# 8️⃣ DATA QUALITY RULES

Ensure:

* no duplicate events on re-render
* events fire only once per action
* invalid upload selections tracked correctly
* reminders are not double-counted
* project_id is consistent across events

---

# 9️⃣ DEBUG & QA

Verify using Firebase DebugView:

Test flows:

### Camera flow

* before → after → export

### Upload flow

* select → reorder → collage → export

### Reminder flow

* before → leave → reminder → return → complete

### Qualification flow

* show → answer
* show → skip

---

# 10️⃣ ACCEPTANCE CRITERIA

This task is complete when:

1. All lifecycle events are firing correctly
2. `job_completed` is reliably tracked
3. Upload flow events are complete
4. Reminder system events are tracked
5. Qualification events + user_type property are set
6. All key events include `source_type`
7. Funnels can be built in GA4 without gaps
8. No duplicate or noisy events
9. Works on both iOS and Android

---

# 🚀 Final Note (for agent)

This analytics system is designed to answer ONE question:

👉 **Do users complete jobs?**

Everything else (upload, reminders, segmentation) exists to improve that number.

Do not over-engineer. Keep it clean, consistent, and reliable.



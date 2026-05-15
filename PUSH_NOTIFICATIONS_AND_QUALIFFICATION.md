

# AI Agent Task — Add job reminder notifications + optional qualification screen to ProofPix

## Goal

Implement two new activation/retention features in ProofPix:

1. A **job completion reminder notification system** for users who take **before** photos but do not come back to complete the **after** photos.
2. An **optional qualification screen/modal** to identify user type (cleaning, contractor, editor, etc.) for analytics and future personalization.

Important: this should be implemented in a way that **does not add unnecessary friction** to first-time activation and **does not replace** the existing trial milestone modal system.

---

# Part 1 — Reminder notifications for unfinished before/after flow

## Product intent

This is **not** a generic marketing push system.

This is a **workflow reminder system**:

* user starts a before/after job
* user takes before photos
* user leaves without completing after photos
* app reminds them to come back and finish proof

This is the highest-value notification use case for ProofPix.

---

## Scope decision

Implement this as a **lightweight reminder system**, preferably in this order:

### Preferred implementation

* **Local notifications** first

### Also add

* in-app unfinished-job reminder banner/card on home screen

### Do not build now

* broad remote push notification campaigns
* generic “new version available” pushes
* generic feature announcement pushes
* trial milestone push notifications

The existing `trialNotificationService` remains unchanged and continues handling trial/upgrade in-app modals.

---

## Architecture

Create a separate service for workflow reminders.

### New service

* `jobReminderService`

This must be conceptually separate from:

* `trialNotificationService`

### Responsibilities of `jobReminderService`

* detect when a user has started a before/after workflow
* detect whether after photos were completed
* schedule reminders for unfinished jobs
* cancel reminders when workflow is completed
* expose state for home screen unfinished-job UI

---

## Trigger logic

### Reminder should be created when:

* user successfully captures or starts a **before** photo flow

### Reminder should be cancelled when:

* user completes **after** photo(s)
* user finishes collage/output
* user exports/shares final proof
* project/job is deleted
* user manually dismisses unfinished draft, if such state exists

---

## Reminder timing

Implement two reminders for unfinished jobs:

### Reminder 1

Send/schedule at:

* **1–2 hours** after before photo creation

Purpose:

* short jobs / same-day jobs

### Reminder 2

Send/schedule at:

* **24 hours** after before photo creation

Purpose:

* longer jobs / user forgot to finish

If technical implementation needs exact defaults, use:

* first reminder: **2 hours**
* second reminder: **24 hours**

Make these timing values configurable in code/constants.

---

## Notification copy

Use simple, task-oriented copy.

### First reminder

Title:

* `Don’t forget your AFTER photos`

Body:

* `Finish your before/after proof in just a few taps.`

### Second reminder

Title:

* `Still need your AFTER photo?`

Body:

* `Come back and complete your proof for this job.`

If localization is easy, wire through the translation system. If not, structure it so localization can be added cleanly.

---

## Home screen unfinished-job reminder

In addition to local notifications, add a lightweight in-app reminder on the home/main screen.

### Behavior

If user has an unfinished before/after session:

* show a banner/card on main screen

### Example copy

* `You still have an unfinished before/after project`
* CTA: `Finish Now`

If multiple unfinished sessions exist, either:

* show the most recent one only, or
* show count-based text like:

  * `You have 2 unfinished projects`

Preferred for now:

* show only the **most recent unfinished job**

---

## Job/session state model

Add or extend local state/session tracking for incomplete projects.

Suggested fields:

* `job_id` or `project_id`
* `started_at`
* `before_started_at`
* `after_completed_at`
* `is_completed`
* `notification_1_scheduled`
* `notification_2_scheduled`
* `notification_1_sent`
* `notification_2_sent`
* `source_type` if useful later

If there is already a project/session model, integrate with it instead of duplicating logic.

---

## Edge cases

Handle these cases correctly:

* user takes before photo and immediately finishes after → no reminder
* user takes before photo, closes app, comes back before notification time, completes job → cancel reminder
* user has multiple unfinished jobs → no notification spam
* app reinstall / stale local reminder state → avoid broken or duplicate reminders
* reminder tap should deep link back into the most relevant unfinished workflow if possible
* if deep link is not available, open main screen and show unfinished project banner/card

---

## Technical implementation details

If using Expo / React Native local notifications:

* add/install notification package needed for local notifications
* request notification permission only when needed and with clear context
* do **not** over-prompt on first launch

### Permission timing

Do not ask for notification permission immediately on install.

Ask only after the user has completed enough product value to understand the use case, for example:

* after first before photo flow starts
* or after first before photo is saved

Permission explanation should be contextual:

* `Allow reminders so ProofPix can remind you to take your AFTER photos.`

---

## Analytics for reminder system

Add analytics coverage for this feature.

### New events

* `job_reminder_permission_prompt_shown`
* `job_reminder_permission_result`

  * params: `status`
* `job_reminder_scheduled`

  * params: `reminder_type` = `2h` or `24h`
* `job_reminder_cancelled`

  * params: `reason`
* `job_reminder_opened`

  * when user taps notification
* `unfinished_job_banner_shown`
* `unfinished_job_banner_tapped`
* `unfinished_job_completed_after_reminder`

### Recommended params

Include where possible:

* `job_id` or anonymized session id
* `time_since_before`
* `user_plan`
* `user_type` if available
* `platform`

---

## Acceptance criteria — Reminder system

This part is complete when:

1. Users who start a before-photo workflow and do not complete after photos receive reminder scheduling
2. Reminder 1 is scheduled for about 2 hours
3. Reminder 2 is scheduled for about 24 hours
4. Reminders are cancelled automatically when the job is completed
5. Home screen shows an unfinished-project reminder card/banner
6. Tapping notification or banner takes user toward completion flow
7. No generic marketing/update pushes are introduced
8. Analytics events are added and firing correctly

---

# Part 2 — qualification screen/modal

## Product intent

We need to identify what type of user ProofPix is attracting, without harming activation.

This screen is for:

* segmentation
* analytics
* later personalization
* better reminder copy in the future
* understanding who responds to ads/features like Upload 2 Photos

It is **not** intended to block usage.

---

## Placement

Do **not** place this before first value.

Do **not** place it as a blocking screen immediately after paywall before the main screen.

### Correct placement

Show it **after the user lands on the main screen**, as a lightweight modal/card/sheet.

### Requirements

* skippable
* shown once
* dismissible
* not aggressive

---

## UX behavior

### Trigger

Show qualification prompt after:

* onboarding/paywall is complete
* user reaches main screen
* user has not answered qualification before

Optional delay:

* a short delay after main screen loads is acceptable if needed for UX smoothness

---

## Question

Prompt:

* `What do you use ProofPix for?`

Options:

* Cleaning
* Contracting
* Restoration
* Editing / Content
* Personal use
* Other

Buttons:

* `Continue`
* `Skip`

If design supports one-tap selection:

* selection itself can submit
* still include `Skip`

---

## Storage

Persist response locally and to analytics/user profile if such profile storage exists.

Suggested stored field:

* `user_type`

Allowed values:

* `cleaning`
* `contracting`
* `restoration`
* `editing`
* `personal`
* `other`
* `skipped`

If user skips:

* mark as skipped so it does not show repeatedly

If later profile/settings screen exists, user type should eventually become editable there, but that is **not required in this task**.

---

## Localization

Add qualification prompt to translation files if the app already uses i18next for this layer.

---

## Analytics for qualification screen

### New events

* `qualification_prompt_shown`
* `qualification_option_selected`

  * param: `user_type`
* `qualification_completed`

  * param: `user_type`
* `qualification_skipped`

If possible, also update user properties / profile traits:

* `user_type`

---

## Future-proofing

Structure qualification so it can later support:

* better onboarding copy
* reminder message personalization
* paywall copy personalization
* feature prioritization by segment

But do **not** add those personalized behaviors now unless trivial.

---

## Acceptance criteria — Qualification screen

This part is complete when:

1. An optional qualification prompt appears after the user reaches the main screen
2. It does not block first use
3. User can select one option or skip
4. Response is saved
5. Prompt is not repeatedly shown after completion/skip
6. Analytics events are added and firing correctly

---

# Non-goals

Do **not** implement in this task:

* remote marketing push campaigns
* version update notifications
* feature announcement pushes
* paywall redesign
* deep onboarding questionnaire with multiple questions
* mandatory qualification gating before first use
* CRM/backend messaging automation
* landing page version of qualification flow

---

# Suggested implementation structure

## Services / components

Create or extend:

* `jobReminderService`
* `UnfinishedJobBanner` or `UnfinishedJobCard`
* `QualificationPromptModal` or `QualificationBottomSheet`

## Integrations

Connect into:

* before photo creation/completion flow
* after photo completion flow
* main screen rendering lifecycle
* analytics service
* localization system

---

# Final product logic summary

## Existing

* `trialNotificationService` handles in-app trial milestone modals

## New

* `jobReminderService` handles unfinished before/after reminders
* `QualificationPrompt` handles optional segmentation after main screen

These systems must remain logically separate.

---

# Priority

Implement in this order if needed:

1. qualification prompt
2. unfinished-job home banner
3. local notification scheduling
4. analytics instrumentation cleanup

---

# Reviewer note

This should feel like:

* less friction
* better task completion
* better audience understanding

It should **not** feel like:

* more onboarding friction
* more marketing spam
* more generic notifications

s based on your current React Native/Expo structure**.

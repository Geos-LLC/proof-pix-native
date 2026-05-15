TASK: Extend the existing referral tracking system so referral codes are attributable to real marketing channels/sources/campaigns in Firebase/GA4 and downstream conversion events.

Goal:
When a user redeems an existing referral/admin code, Firebase should record not only the referral code but also its metadata (channel, source, campaign, placement, link_type). That attribution must then persist and be attached to downstream events such as trial_event, subscription_start, and purchase.

Context:

* Existing analytics already logs referral_code as an event parameter
* In Firebase, referral codes appear as raw codes (e.g. 529A353C) but there is no way to know which code maps to which channel/source
* Existing admin-created referral links/codes already exist
* Existing purchase/subscription tracking has just been added
* We want to preserve existing referral flow and add attribution metadata without breaking current behavior

Required outcome:
After implementation, Firebase/GA4 should be able to answer:

* Which referral/admin channel produced redeems?
* Which channel produced trial starts?
* Which channel produced subscriptions/purchases?

---

1. FIND THE EXISTING REFERRAL FLOW

Locate:

* referral link handling
* referral code redemption flow
* any proxy/backend endpoint that validates or redeems a referral code
* current analytics event firing for referral_event

Identify:

* where referral_code is first known
* where the app can fetch metadata for that code

Do not change user-facing redemption UX unless necessary.

---

2. ADD METADATA LOOKUP FOR EXISTING CODES

For each referral/admin code, add or use metadata fields such as:

* code
* link_type (admin | user | promo)
* channel (instagram | facebook | whatsapp | flyer | friend | etc.)
* source (bio | story | dm | group | qr | manual | etc.)
* campaign (launch_april | cleaners_test_1 | warm_outreach | etc.)
* placement (optional)
* created_by / creator_type if available (optional)

If backend/proxy already stores these, fetch them during redemption.
If backend does not yet expose them, add a lightweight endpoint or extend the existing redemption/validation response so the app receives the metadata together with the code resolution.

Expected behavior:
When app redeems code 529A353C, it should also receive metadata like:
{
"code": "529A353C",
"link_type": "admin",
"channel": "instagram",
"source": "bio",
"campaign": "launch_april"
}

---

3. EXTEND referral_event ANALYTICS

Wherever referral_event currently fires for code redemption, include:

* action
* referral_code
* link_type
* channel
* source
* campaign
* placement (if available)

Preferred event shape:
referral_event {
action: "admin_link_redeemed" | "user_referral_redeemed" | existing action name,
referral_code: "...",
link_type: "admin",
channel: "instagram",
source: "bio",
campaign: "launch_april"
}

Important:

* Preserve existing event names and existing action semantics when possible
* This task should enhance current analytics, not break existing dashboards

---

4. PERSIST ATTRIBUTION LOCALLY AFTER SUCCESSFUL REDEMPTION

After a referral/admin code is successfully redeemed, save attribution context locally (AsyncStorage or existing local state mechanism) so future events can reuse it.

Store fields like:

* @attribution_referral_code
* @attribution_link_type
* @attribution_channel
* @attribution_source
* @attribution_campaign
* @attribution_placement (optional)

Requirements:

* Persist only after successful redemption / acceptance
* Overwrite only when business logic allows replacing attribution
* Do not clear attribution on normal app restart
* Add a helper to read this attribution bundle easily from analytics code

---

5. ATTACH ATTRIBUTION TO DOWNSTREAM EVENTS

Update analytics helpers so these events include the saved attribution context when available:

* trial_event
* subscription_start
* purchase

Also add attribution to any already-existing key monetization events if easy and safe:

* plan_changed
* account_created (if this happens after redemption and makes sense)

Example:
trial_event {
action: "start",
plan: "pro",
referral_code: "529A353C",
link_type: "admin",
channel: "instagram",
source: "bio",
campaign: "launch_april"
}

subscription_start {
plan: "pro",
platform: "ios",
referral_code: "529A353C",
link_type: "admin",
channel: "instagram",
source: "bio",
campaign: "launch_april"
}

purchase {
value: 8.99,
currency: "USD",
referral_code: "529A353C",
link_type: "admin",
channel: "instagram",
source: "bio",
campaign: "launch_april"
}

Important:

* Make this additive and backward-compatible
* If attribution is missing, events should still fire normally without errors

---

6. CREATE A SHARED ATTRIBUTION HELPER

Add a reusable helper in the analytics layer, e.g.:

* getStoredAttributionContext()
* mergeAttributionContext(params)

This helper should:

* read attribution context from local storage
* merge into event payloads safely
* never throw if storage is empty or corrupt
* be reusable by trial_event, subscription_start, purchase, and future events

---

7. DO NOT CHANGE CORE EVENT NAMES UNLESS NECESSARY

Keep existing working events intact:

* referral_event
* trial_event
* subscription_start
* purchase

Do not rename them in this task unless there is a strong technical reason.

Goal is to enrich event params, not rebuild analytics taxonomy.

---

8. ADD BASIC SAFETY RULES

* Do not attach attribution before referral/admin code is actually accepted
* Do not duplicate referral_event on every app launch
* Do not replace attribution silently unless user redeems a new valid code and product rules allow override
* If the same code is redeemed repeatedly, avoid firing duplicate "redeemed" success events unless there is a real new redemption outcome

---

9. PROVIDE VERIFICATION NOTES IN TASK RESULT

At the end, include:

* where metadata is fetched from
* where attribution is stored
* which events were enriched
* exact event parameter names added
* how to test

Testing checklist should include:

1. Redeem known admin code with known metadata
2. Confirm referral_event in Firebase DebugView contains:

   * referral_code
   * channel
   * source
   * campaign
3. Start trial and confirm trial_event includes same attribution
4. Complete purchase and confirm subscription_start / purchase include same attribution

---

10. IMPORTANT CONSTRAINTS

* Do NOT rebuild referral UX
* Do NOT remove existing referral code handling
* Do NOT break current rewards logic
* Do NOT hardcode one channel in the app
* Metadata must come from actual code mapping / backend response / existing admin data source
* Keep implementation small, practical, and backward-compatible

Expected result:
Firebase/GA4 can later be broken down by:

* referral_code
* channel
* source
* campaign

and downstream events (trial_event, subscription_start, purchase) will carry the same attribution context, allowing analysis of which admin link/channel actually drives conversions.

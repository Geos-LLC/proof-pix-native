TASK: Add Firebase analytics events for successful subscription purchases in ProofPix so Google Ads can later optimize for paid conversions.

Goal:
Track real subscription success events (not button clicks) for both iOS and Android after the store confirms payment.

Context:

* Existing analytics system already uses @react-native-firebase/analytics
* Firebase events currently appear for trial_event, login, referral_event, etc.
* purchase / subscription conversion events are not reliably firing
* Current ads can optimize on trial_event for now, but we need proper paid-conversion events in the next build

Requirements:

1. Find the existing subscription / in-app purchase success flow in the codebase.

   * Search for RevenueCat, StoreKit, expo-in-app-purchases, react-native-iap, or any purchase success callback / listener
   * Identify the exact point where the app receives confirmed successful purchase/subscription from Apple App Store / Google Play
   * Do NOT fire analytics on paywall open, subscribe button click, checkout open, or payment initiation
   * Fire analytics ONLY after confirmed success

2. Add Firebase analytics event on successful subscription start / conversion.
   Preferred event:

   * subscription_start

   Also add purchase event for compatibility / reporting:

   * purchase

3. Event payloads:
   For subscription_start:

   * platform: ios or android
   * plan: starter / pro / business / enterprise if available
   * price: numeric value if available
   * currency: USD if available
   * is_trial: true/false if known
   * source: paywall / upgrade / feature_gate / settings if available

   For purchase:

   * value: numeric price if available
   * currency: USD if available
   * item_category: subscription
   * item_name: plan name if available
   * platform: ios or android

4. If there is already an internal analytics wrapper (for example in src/utils/analytics.js), add reusable helper methods there:

   * logSubscriptionStart(...)
   * logPurchase(...)

   Those helpers should:

   * guard against missing analytics instance
   * safely handle missing optional params
   * never throw if analytics fails
   * log to console in dev mode for visibility

5. Hook the new helpers into the confirmed purchase success flow.

   * Fire exactly once per successful purchase confirmation
   * Avoid duplicate firing on app relaunch / receipt refresh / restore flow unless it is truly a new conversion event
   * If there is already logic for restore purchases, do NOT count restores as new subscription_start unless business logic explicitly considers them conversions

6. Add basic deduplication protection if needed.

   * If purchase callbacks can fire more than once for the same transaction, use transaction ID / purchase token / product ID + timestamp guard
   * Store short-lived dedupe state locally if necessary

7. Keep existing trial_event tracking unchanged.

   * Do NOT remove or rename current working trial_event tracking in this task
   * This task is additive: keep trial optimization working while adding paid conversion tracking

8. Add clear code comments explaining:

   * why event fires only after confirmed purchase
   * why this matters for Firebase / Google Ads optimization

9. After implementation, provide a short verification checklist in the PR / task result:

   * where the event was added
   * which purchase success callback is used
   * exact event names sent to Firebase
   * sample payload
   * how to test in sandbox / TestFlight / internal Android testing

10. Important constraints:

* Do NOT add website tags or Google Ads web conversion snippets
* Do NOT fire events from UI button handlers before purchase success
* Do NOT rename existing trial_event in this task
* Do NOT break Meta analytics currently in place

Implementation target:

* Existing React Native / Expo app codebase
* Existing Firebase analytics integration

Expected outcome:

* New build sends Firebase events:

  * subscription_start
  * purchase
* After release and real subscription tests, these events should appear in Firebase Events and later be importable into Google Ads as app conversion actions

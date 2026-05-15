

## AI Agent Task — Fix Google Play subscription policy rejection for Android

We need to fix the Android subscription flow for Google Play production review. The latest Android build was rejected for subscription policy violations. Update the purchase/paywall flow so it complies with Google Play Subscriptions policy.

### Rejection reasons to fix

Google flagged 3 issues in version code 40:

1. **Dismiss experience is misleading**

   * The dismiss / skip / close action must not send the user into Google Play billing.
   * The dismiss / skip / close action must not reopen the paywall or push the user back into the purchase flow.

2. **Currency mismatch**

   * The app currently shows hardcoded USD prices like `$8.99/month`, `$24.99/month`, etc.
   * Google Play billing sheet shows localized prices in the user’s currency.
   * The paywall must display the exact localized price returned by Google Play Billing for that user and product.

3. **Trial terms are unclear**

   * The paywall currently says things like “15-Day FREE Trial Available!” and “Start Free Trial” without clearly stating:

     * trial duration,
     * price after trial,
     * auto-renewal,
     * cancellation method.

---

## Required fixes

### 1) Fix dismiss / skip / close behavior

Update the subscription flow so:

* `Skip`, `Close`, `X`, back button, or any dismiss action must fully exit the purchase flow.
* Dismiss must return the user to the previous app screen or continue free-tier app usage.
* Dismiss must **not** open Google Play billing.
* Dismiss must **not** trigger another modal/paywall automatically.
* Dismiss must **not** loop the user back into the same purchase flow.
* If user dismisses, they should remain on Starter/free plan unless they intentionally tap purchase again.

Also review:

* hardware back behavior on Android
* modal close behavior
* any navigation side effects after dismiss
* any auto-open logic when screen regains focus

### 2) Remove all hardcoded subscription prices from Android paywall

The Android paywall must use live Google Play Billing product data.

For every paid plan shown in app:

* Pro
* Business
* Enterprise
* any other billed plan or offer

Replace hardcoded price strings with the localized formatted price returned by Play Billing.

Requirements:

* show the exact billing price string from Google Play
* show correct localized currency
* do not hardcode USD
* do not show stale or fallback fake prices if billing data is available
* if billing data fails to load, show a neutral loading / unavailable state, not misleading pricing

### 3) Make trial / offer terms explicit and compliant

For any plan with a free trial or introductory pricing, show clear text on the paywall itself before billing starts.

Required disclosure format:

* trial duration
* post-trial recurring price
* billing period
* auto-renewal
* cancellation instructions

Example structure:

* `15-day free trial`
* `Then [localized price]/month`
* `Auto-renews unless canceled`
* `Cancel anytime in Google Play Subscriptions`

Or in one line:

* `15-day free trial, then [localized price]/month. Auto-renews unless canceled. Cancel anytime in Google Play Subscriptions.`

Requirements:

* disclosure must appear close to CTA
* disclosure must match the actual Google Play offer
* disclosure must be visible before user taps purchase
* use localized live price from billing
* do not say only “FREE” without terms

### 4) Fix misleading “FREE” labels on paid plans

Current UI appears to show paid plans with original monthly prices and a green `FREE` label, which is risky and likely misleading.

Update plan cards so they do not imply the full paid plan itself is permanently free.

Use clearer wording such as:

* `15-day free trial`
* `Free during trial`
* `Trial available`

Do not display:

* `$8.99/month FREE`
* `$24.99/month FREE`
* `$69.99/month FREE`

The UI must clearly distinguish:

* free Starter plan
* paid plans with trial offers

### 5) Align CTA wording with actual action

Review CTA labels:

* If tapping button opens billing for a trial offer, CTA can be:

  * `Start Free Trial`
* If no trial exists, CTA should be:

  * `Subscribe`

Ensure CTA accurately matches offer.
Do not use ambiguous language that hides the paid subscription after trial.

### 6) Review plan selection flow

Current flow seems to be:

* choose plan
* open custom modal
* tap Start
* then Google Play billing opens

This is okay only if all terms are clear before the Play screen and dismiss works properly.

Update flow so:

* user chooses plan
* sees compliant pre-purchase modal or direct purchase screen
* can dismiss safely
* only intentional confirmation launches Play Billing

### 7) Ensure price and offer consistency across screens

The following must match:

* plan list / paywall
* pre-purchase modal
* Google Play billing sheet

No mismatches in:

* currency
* billing period
* trial duration
* plan name
* post-trial recurring amount

### 8) Keep iOS behavior separate if needed

This task is specifically for Android / Google Play compliance.
Do not break iOS purchase flow, but Android must use Google Play-compliant pricing and offer text.

If needed:

* gate platform-specific strings and purchase logic by platform.

---

## Implementation notes

Please inspect the existing subscription UI and billing integration and update all affected components. Also search for any hardcoded pricing strings in the Android subscription flow and remove them.

Areas to review:

* paywall screen
* plan cards
* free trial modal
* purchase CTA handlers
* Play Billing integration layer
* Android back handler / modal dismiss logic
* subscription text constants
* any fallback mocks used in production builds

---

## Acceptance criteria

### Dismiss behavior

* tapping `Skip`, `X`, close, or Android back fully exits purchase flow
* no billing screen opens on dismiss
* no immediate re-prompt appears after dismiss

### Pricing

* all Android paid plan prices come from Google Play Billing
* localized currency matches Play billing sheet exactly
* no hardcoded USD prices remain in Android purchase UI

### Trial disclosures

* trial duration is shown clearly
* post-trial price is shown clearly
* auto-renew is stated clearly
* cancellation guidance is shown clearly
* all shown terms match actual Play offer

### UI wording

* free tier is labeled as free
* paid tiers with trials are labeled as trials, not just “FREE”
* CTA wording matches actual billing action

### Testing

Test all Android flows:

* Starter/free only
* Pro with trial
* Business with trial
* Enterprise with trial if applicable
* dismiss from pre-purchase modal
* dismiss from plan screen
* Android back button
* localized currency test
* successful purchase initiation
* no broken navigation after dismiss

---

## Deliverables

1. Implement the fix in code
2. Provide a short summary of what changed
3. List all screens/components/files touched
4. Confirm whether any hardcoded Android prices remain
5. Confirm exact versionCode bump needed for next submission

---

## Important

This is not a visual redesign task. Keep current design mostly intact. Focus on compliance fixes only:

* dismiss behavior
* localized pricing
* clear trial terms
* removal of misleading “FREE” wording on paid plans

-
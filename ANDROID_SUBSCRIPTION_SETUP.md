Below is a **ready-to-paste AI Code Agent task** to implement Google Play subscriptions **without a custom server** (client-side entitlements + RTDN optional). It’s written to be executable and structured.

---

## TASK — ProofPix: Connect Google Play Subscriptions (Client-side) + Plan/Seat Entitlements

### Context

We already created these Google Play subscriptions (SUBS):

* `com.goscha01.proofpix.pro`
* `com.goscha01.proofpix.business`
* `com.goscha01.proofpix.enterprise`
* `com.goscha01.proofpix.business.seat`
* `com.goscha01.proofpix.enterprise.seat`

Each has base plan `monthly` (auto-renewing). We currently **do not have a backend** for purchase verification; only a proxy for picture upload exists. We still need a working production-grade integration with best possible security given constraints.

### Goal

1. Show subscription paywall with correct prices from Play Billing
2. Allow user to purchase: Pro / Business / Enterprise + seat add-ons
3. Persist and refresh entitlements on device (and optionally in cloud using existing storage)
4. Handle restore purchases, upgrades/downgrades, cancellations, grace period, account hold
5. Enforce business rules for seats (cannot buy seat without main plan)
6. Ensure purchases are acknowledged
7. Add QA/test harness + logging

### Assumptions

* App is Android (native Kotlin) **OR** uses a framework (React Native/Flutter).
* If framework: implement via standard library wrapper (RN: `react-native-iap` or Google Play Billing wrapper; Flutter: `in_app_purchase`).
* If native Kotlin: use `com.android.billingclient:billing` current stable.

> If stack is unknown, implement native Kotlin Billing module + expose minimal interface so RN/Flutter can call it later if needed.

---

## Deliverables

* `billing/` module (or package) implementing:

  * BillingClient connection lifecycle
  * ProductDetails query
  * Purchase flow launch with offerToken
  * Purchase update handler
  * Acknowledge purchases
  * Restore purchases on app start and on “Restore” button
* `EntitlementsService`

  * Computes current plan (free/pro/business/enterprise)
  * Computes seatCount (0+)
  * Returns `Entitlements` object to UI
* Paywall UI screen

  * Lists Pro/Business/Enterprise with localized price strings
  * Lists seat add-ons (only enabled if eligible)
  * Buttons: Subscribe / Add Seat / Restore / Manage subscription
* Local persistence

  * Store purchase tokens + computed entitlements in encrypted storage (Android Keystore + EncryptedSharedPreferences)
* Telemetry/logging

  * Structured logs for billing flows and errors

---

## Functional Requirements

### A) Query & Display Plans

* Query `ProductDetails` for all 5 product IDs using `ProductType.SUBS`.
* For each `ProductDetails`, select the offer that corresponds to the “monthly” base plan.

  * Choose the `subscriptionOfferDetails` item where `pricingPhases` includes a recurring monthly phase.
  * Save `offerToken` for purchase launch.
* Display:

  * Plan title
  * Price (e.g., `$8.99/month`) from Play `pricingPhase.formattedPrice`
  * Brief description (use our 80-char descriptions as subtitles in-app)

### B) Purchase Flow

* Start purchase via `launchBillingFlow()` with `ProductDetailsParams` + `offerToken`.
* On successful purchase:

  * Validate basic fields locally:

    * `purchaseState == PURCHASED`
    * `products` contains expected product ID
    * `purchaseToken` non-empty
  * Acknowledge purchase if not acknowledged.
  * Update entitlements.

### C) Restore Purchases

* On app start and on “Restore purchases”:

  * Call `queryPurchasesAsync(SUBS)`
  * For each returned purchase that is PURCHASED:

    * Acknowledge if needed
    * Update local cache with purchaseTokens

### D) Entitlement Rules

Compute entitlements from active purchases (SUBS):

**Main plan precedence**

* Enterprise overrides Business overrides Pro.
* If multiple exist, choose highest tier.

**Seat rules**

* `business.seat` only counts if main plan is Business (or higher?)

  * Recommended: Business seat counts only if main plan is **Business** (NOT Enterprise).
* `enterprise.seat` counts only if main plan is Enterprise.
* If user has seats but no valid main plan → seats do not apply and UI should show “Seat add-on requires Business/Enterprise plan”.

**Seat count**

* Each seat product purchase counts as +1 seat subscription.
* If Google allows only one active subscription per product ID per account, seats will cap at 1.

  * Implement fallback UX: “Need more seats? Contact support” OR add multiple seat SKUs later (seat1, seat2, seat3…).
  * Detect this limitation in testing and document it.

### E) Upgrade/Downgrade Support

* If user buys Business while Pro active (or Enterprise while Business active):

  * Use subscription update flow with replacement:

    * `BillingFlowParams.SubscriptionUpdateParams`
    * Provide old purchase token
    * Set proration mode to immediate with time proration (recommended)
* Add a helper:

  * `purchaseOrUpgrade(targetProductId)`
  * If an active main plan exists, upgrade using `SubscriptionUpdateParams`.
  * Else, normal purchase.

### F) Manage Subscription Link

* Add button opening Google Play manage subscription UI for the current product:

  * Use deep link to Play subscription management (standard intent).
  * If can’t deep link reliably, open Google Play “Subscriptions” screen.

### G) Security & Limitations (No Server)

* Implement best-effort client-only protections:

  * Store purchase tokens in EncryptedSharedPreferences
  * Re-check purchases at app resume and every 24h
  * Do not unlock premium if no active purchases returned by `queryPurchasesAsync`
* Add internal note in code:

  * “Client-only verification is weaker than server-side; consider adding server later using Google Play Developer API.”

---

## Technical Tasks (Native Kotlin reference)

1. **Create BillingManager**

   * `connect()`, `disconnect()`
   * `queryProductDetails(productIds: List<String>)`
   * `launchPurchase(activity, productDetails, offerToken, oldPurchaseToken?)`
   * `restorePurchases()`
   * Handle `PurchasesUpdatedListener`

2. **Implement Offer Selection**

   * Function `selectMonthlyOffer(productDetails): OfferSelection`
   * Must return:

     * offerToken
     * formattedPrice
     * billingPeriod (P1M)
   * If none found, surface error in UI.

3. **Acknowledge Purchases**

   * `acknowledgeIfNeeded(purchase)`
   * Retry transient errors (limited retries)

4. **EntitlementsService**

   * Input: list of active purchases from restore
   * Output:

     ```ts
     {
       plan: "free" | "pro" | "business" | "enterprise",
       seats: number,
       activeProductIds: string[],
       lastRefreshedAt: timestamp
     }
     ```
   * Persist this object.

5. **UI Paywall**

   * Show plan cards (Pro/Business/Enterprise)
   * Buttons:

     * Subscribe/Upgrade
     * Add seat (when eligible)
     * Restore purchases
     * Manage subscription

6. **Testing Utilities**

   * “Billing Debug” screen (dev-only)

     * list queried product details
     * list active purchases and tokens (masked)
     * current entitlement state
   * Add logs for billing response codes

7. **Play Console Checklist**

   * Confirm app is uploaded to Internal Testing track
   * Add license testers in Play Console
   * Test purchase flow from installed test build

---

## Acceptance Criteria

* App displays correct localized prices for all plans.
* User can subscribe to Pro/Business/Enterprise and app unlocks features immediately after purchase.
* Restore purchases works after reinstall.
* Purchases are acknowledged.
* Upgrade path Pro→Business→Enterprise works without double-charging (uses subscription update params).
* Seat add-on purchase is blocked unless eligible plan is active; UI communicates requirement.
* Entitlements remain correct after cancellation (restore no longer returns purchase or state changes).

---

## Notes / Follow-ups (Optional but recommended)

* Consider minimal backend later:

  * Cloud Function that verifies purchase tokens via Google Play Developer API
  * Store entitlements per user securely
  * Enables real multi-seat quantities + prevents fraud

-
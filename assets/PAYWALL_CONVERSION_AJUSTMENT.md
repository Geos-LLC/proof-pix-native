

---

# 🚀 AI AGENT TASK — Paywall Conversion Optimization (Compliant)

## Objective

Improve paywall conversion (trial starts → paid users) while maintaining full compliance with Google Play subscription policies.

⚠️ This is NOT a redesign.
Only adjust:

* text
* hierarchy
* emphasis
* structure

---

## 🔴 DO NOT CHANGE (COMPLIANCE LOCK)

Keep unchanged:

* Pricing source (Play Billing only)
* Trial disclosure text block
* Dismiss behavior
* Purchase flow logic

---

## 🟢 1. Update Header Section

### Replace:

```txt
Choose a Plan
```

### With:

```txt
Turn every job into before & after proof
```

---

### Add subheader under title:

```txt
Avoid disputes. Save time. Impress your clients.
```

---

## 🟢 2. Update Trial Banner

### Replace:

```txt
15-Day FREE Trial Available!
```

### With:

```txt
15-day free trial • No charges today
```

---

## 🟢 3. Restructure Plan Cards

---

### 🎯 Goal:

Make **Pro plan the primary decision**

---

## 🟢 3a. Pro Plan (PRIMARY CARD)

Update Pro card content:

```txt
⭐ MOST POPULAR

Pro

Free Trial
then {price}/month

Best for solo cleaners & professionals
```

---

### Add value bullets under description:

```txt
✔ Create before & after photos in seconds  
✔ Cloud sync & bulk upload  
✔ Share proof instantly with clients  
```

---

## 🟡 3b. Starter Plan (DE-EMPHASIZE)

Update Starter card:

```txt
Starter

Free forever

Basic before & after photos
```

---

### UI change:

* Reduce visual prominence (smaller padding or lighter style)
* Keep accessible but not dominant

---

## 🟡 3c. Business & Enterprise

### Replace full cards with:

```txt
For teams? View Business plans →
```

---

### Behavior:

* Tap → opens full plans screen (existing or new)
* Do NOT show all plans by default

---

## 🟢 4. Fix Pricing Labels

### Remove ALL:

```txt
$X/month FREE
```

---

### Replace with:

```txt
Free Trial
then {price}/month
```

---

## 🟢 5. Add Primary CTA Button (CRITICAL)

Add large CTA button under Pro plan:

```txt
Start 15-Day Free Trial
```

---

### Add subtext under CTA:

```txt
No charges today • Cancel anytime
```

---

## 🟢 6. Add Trust Element

Below CTA:

```txt
Used by cleaning professionals daily
```

---

## 🟢 7. Keep Legal Disclosure (REQUIRED)

Keep exactly as is:

```txt
15-day free trial, then {price}/month.
Auto-renews unless canceled.
Cancel anytime in Google Play > Subscriptions.
```

---

## 🟢 8. Layout Structure (FINAL ORDER)

Implement this hierarchy:

1. Headline
2. Subheadline
3. Trial banner
4. Pro plan (primary card)
5. CTA button
6. Risk reversal text
7. Trust text
8. Starter plan (secondary)
9. Business link
10. Legal text

---

## 🟢 9. Interaction Rules

* CTA → opens existing trial confirmation modal (no change)
* Dismiss behavior → unchanged (already compliant)
* No auto-open paywall after dismiss

---

## 🟢 10. Styling Adjustments

* Pro card → most visually prominent
* Starter → reduced emphasis
* Business → link only (not full card)
* CTA button → full width, primary color

---

## ✅ Acceptance Criteria

### Conversion UX

* User sees value BEFORE price
* Only 1 main decision (Pro)
* Clear CTA visible without scrolling

---

### Compliance

* Price matches Play Billing exactly
* Trial terms visible BEFORE purchase
* No misleading “FREE” wording
* Dismiss does not trigger billing

---

### Functional

* Existing purchase flow works unchanged
* No regression in subscriptions
* No new navigation bugs

---

## 📦 Deliverables

1. Updated UI text
2. Updated layout hierarchy
3. List of modified components
4. Screenshot of updated paywall

---

## 🎯 Expected Outcome

* +25–50% trial starts
* Higher paid conversion
* No risk of Play Store rejection


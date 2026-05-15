## Task: Standardize Subscription & Trial Analytics (Firebase)

### Objective

Fix and unify analytics tracking to accurately measure:

* Trial → Paid conversion
* Trial → Free conversion
* Drop-offs after plan selection

---

## 1. Standardize Event Names

### Replace / deprecate:

* `purchase`
* `subscription_start`

### Use ONE canonical event:

```js
subscription_started
```

---

## 2. Implement Required Events

### A. Trial Events

Ensure these exist:

```js
trial_started
trial_expired
trial_skipped
```

---

### B. Paywall Funnel Events

```js
paywall_view
plan_selected
```

Update `plan_selected` to include:

```js
plan_selected: {
  plan_id: "starter" | "pro" | "business"
}
```

---

### C. Subscription Event (CRITICAL)

Implement:

```js
subscription_started
```

With parameters:

```js
{
  subscription_type: "paid" | "free",
  plan_id: "starter" | "pro" | "business",
  platform: "ios" | "android",
  entry_point: "paywall" | "restore" | "trial_expired"
}
```

---

## 3. Where to Trigger Events (IMPORTANT)

### subscription_started must fire ONLY when:

* Purchase is successful
* OR subscription is restored and active

---

### Entry point mapping:

| Scenario                          | entry_point       |
| --------------------------------- | ----------------- |
| User buys from paywall            | `"paywall"`       |
| User restores purchase            | `"restore"`       |
| User converts after trial expired | `"trial_expired"` |

---

## 4. Implementation (React Native / Expo)

### Import:

```js
import analytics from '@react-native-firebase/analytics';
import { Platform } from 'react-native';
```

---

### Plan Selected:

```js
await analytics().logEvent('plan_selected', {
  plan_id: selectedPlan,
});
```

---

### Subscription Success:

```js
await analytics().logEvent('subscription_started', {
  subscription_type: isFree ? 'free' : 'paid',
  plan_id: selectedPlan,
  platform: Platform.OS,
  entry_point: entryPoint,
});
```

---

## 5. Debug & Validation

### Use DebugView in Firebase:

Test flow:

1. Open paywall
2. Select plan
3. Complete purchase

Expected events:

* `paywall_view`
* `plan_selected`
* `subscription_started`

---

## 6. GA4 Configuration

### Create Custom Dimensions:

Go to GA4 → Admin → Custom Definitions

Add:

* `subscription_type`
* `plan_id`
* `platform`
* `entry_point`

Scope: **Event**

---

## 7. Data Consistency Rules

* NEVER send both `purchase` and `subscription_started`
* ALWAYS send `subscription_started` after success
* NEVER fire on failed purchase

---

## 8. Optional (Recommended)

### Add derived event:

```js
trial_converted
```

Trigger when:

* user had `trial_expired`
* AND triggers `subscription_started`

---

## 9. Success Criteria

After deployment, Firebase must show:

* `subscription_started` events > 0
* Parameters visible in DebugView
* Funnel:
  `trial_expired → plan_selected → subscription_started`

---

## 10. Priority

HIGH — analytics currently underreporting conversions and blocking decision-making.

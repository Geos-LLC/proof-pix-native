Perfect — let’s make this **clean, structured, and ready to give to your AI agent**.

# 🧠 AI AGENT TASK — FULL ANALYTICS IMPLEMENTATION

## 🎯 Objective

Implement a complete event tracking system in the mobile app (iOS + Android) using Firebase Analytics (+ Meta dual-fire) to track the full funnel:

**Acquisition → Onboarding → Paywall → Trial → Usage → Referral → Subscription**

---

# 🧩 1. CENTRAL ANALYTICS MODULE

### Create / update:

```js
analytics/logEvent.js
```

### Requirements:

* Single entry point:

```js
logEvent(name, params = {})
```

* Automatically attach:

```js
{
  platform: 'ios' | 'android',
  user_id,
  session_id,
  app_version,
  referral_code (if exists),
  utm_source,
  utm_campaign
}
```

* Dual fire:

```js
Firebase + Meta (if enabled)
```

---

# 🧲 2. ATTRIBUTION (VERY IMPORTANT)

### On app first open:

Extract and persist:

```js
referral_code
utm_source
utm_campaign
utm_medium
```

Store in:

* AsyncStorage (or secure storage)
* Attach to ALL future events

---

# 📲 3. ONBOARDING TRACKING

### Add events:

```js
onboarding_started
onboarding_step_completed { step_name }
onboarding_completed
```

### Steps example:

```js
step_name:
- intro
- permissions
- account_created
- tutorial_completed
```

---

# 💰 4. PAYWALL TRACKING

### Add:

```js
paywall_view
trial_started
trial_skipped
purchase
subscription_start
```

### Rules:

* `trial_started` → when user activates trial
* `purchase` / `subscription_start` → ONLY after:

```js
finishTransaction() succeeds
```

### Params:

```js
{
  plan: 'starter' | 'pro' | 'business',
  price: number,
  currency: 'USD',
  is_trial: true/false,
  transaction_id
}
```

---

# ⏳ 5. TRIAL LOGIC (CRITICAL)

### Add:

```js
trial_expired
```

### Logic:

On app open:

```js
IF:
- trial_start_date exists
- now > trial_start_date + trial_duration
- AND no active subscription
- AND not already fired

→ logEvent('trial_expired')
```

### Store flag:

```js
trial_expired_logged = true
```

---

# 📸 6. CORE FEATURE TRACKING

Track product usage:

```js
before_after_created
photo_export { type }
feature_used { feature_name }
project_created
```

### Example:

```js
logEvent('photo_export', {
  type: 'social' | 'messenger' | 'gallery'
})
```

```js
logEvent('feature_used', {
  feature_name: 'ghost_mode'
})
```

---

# 👥 7. REFERRAL SYSTEM TRACKING

### Extend existing:

```js
invite_sent
invite_redeemed
```

### Add params:

```js
invite_sent:
{
  method: 'link' | 'whatsapp' | 'sms',
  invite_count
}
```

```js
invite_redeemed:
{
  referral_code
}
```

---

# 💳 8. SUBSCRIPTION LIFECYCLE

### Add:

```js
subscription_start
subscription_renew
subscription_cancel
plan_selected
```

---

# 🔁 9. SESSION / ENGAGEMENT

(Optional but recommended)

```js
session_start (already exists)
app_open
```

---

# 🧪 10. DEBUG + VALIDATION

### Enable:

* Firebase DebugView support

### Add console logs:

```js
[Analytics] event_name: {...params}
```

---

# ⚠️ 11. DATA QUALITY RULES

* NEVER fire purchase on button click
* ONLY after store confirmation
* Deduplicate using:

```js
transaction_id
```

* Prevent duplicate:

```js
trial_expired
subscription_start
```

---

# 📦 12. FILES TO UPDATE

* `analytics.js` ✅ (extend)
* `metaAnalytics.js` ✅ (extend)
* `iapService.js` ✅ (already partially done)
* `onboarding screens`
* `paywall screen`
* `export/share logic`
* `referral logic`

---

# 🧠 EXPECTED RESULT

After implementation, Firebase will show:

### Funnel:

```text
first_open
→ onboarding_completed
→ paywall_view
→ trial_started
→ trial_expired
→ subscription_start
```

### Behavior:

```text
feature_used
photo_export
invite_sent
```


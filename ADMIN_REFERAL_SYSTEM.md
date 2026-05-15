Use this as the AI-agent task:

---

## Task: Implement admin-only referral link generator for ProofPix

### Objective

Build an **internal admin-only referral link system** for ProofPix that allows me to generate referral-looking invite links for warm outreach. These links should look like real referral codes to users, route them to the correct store, and grant **15 extra trial days** after signup/install redemption.

This is **not** a public referral feature. It is an **internal growth tool** only accessible to me in admin/development mode.

---

## Main business goal

I want to send warm prospects a link that looks like a normal referral/invite link, for example:

* `proofpix.app/r/7KQ4M2`
* `proofpix.app/r/CLEAN15`

The user should feel like they got a real referral link.

Internally, I need to:

* create links without code changes or redeploys
* optionally assign each link to a source/channel/campaign
* later track which links were used
* grant **15 extra trial days** automatically when redeemed

---

## Scope

Implement:

1. **Backend data model for referral links**
2. **Admin-only UI to create/manage referral links**
3. **Public redirect route for referral links**
4. **Redemption logic that applies extra trial days**
5. **Basic tracking**
6. **Access control so only admin can manage links**

Do **not** build a customer-facing referral program, sharing flow, or rewards dashboard.

---

## Functional requirements

### 1) Referral link model

Create a DB table/collection for referral links.

Suggested fields:

* `id`
* `code` string, unique
* `label` string, optional internal name
* `channel` string, optional
* `source` string, optional
* `notes` text, optional
* `bonusTrialDays` integer, default `15`
* `maxUses` integer nullable
* `usedCount` integer default `0`
* `isActive` boolean default `true`
* `expiresAt` datetime nullable
* `createdBy` user/admin id nullable
* `createdAt`
* `updatedAt`

Optional but useful:

* `lastUsedAt`
* `redirectIosUrl` nullable
* `redirectAndroidUrl` nullable

Important:

* `code` is the public token in the URL
* support both random generated codes and custom codes
* codes must be unique, case-insensitive in validation
* normalize codes to uppercase for consistency if needed

---

### 2) Admin-only referral management UI

Add an internal admin page. Suggested placement:

* `Admin > Referral Links`
  or
* `Internal Tools > Referral Links`

This page must only be visible to admin/internal users.

#### Page features

Show a list/table of referral links with columns like:

* Code
* Label
* Channel
* Bonus days
* Uses / Max uses
* Active
* Expires
* Created at
* Copy link action
* Edit / Disable action

#### Create referral link form

Fields:

* `Label` optional
* `Public code`

  * auto-generate by default
  * allow custom override
* `Bonus trial days`

  * default 15
* `Max uses`

  * optional
* `Channel`

  * optional
* `Source`

  * optional
* `Notes`

  * optional
* `Expires at`

  * optional
* `Active`

  * default true

Buttons:

* `Generate Code`
* `Create Link`

After create, show full link ready to copy:

* `https://proofpix.app/r/{CODE}`

Also add quick copy button.

#### Edit actions

Allow admin to:

* activate/deactivate
* update label/channel/source/notes
* change max uses
* change expiry
* optionally change bonus days
* do not allow breaking used links accidentally; if code editing is risky, keep code immutable after creation

---

### 3) Public referral redirect route

Create public route:

* `/r/:code`

Example:

* `https://proofpix.app/r/7KQ4M2`

#### Required behavior

When user opens the link:

1. Look up referral code
2. Validate:

   * exists
   * active
   * not expired
   * under max uses if applicable
3. Persist referral code for later redemption
4. Redirect based on platform:

   * iOS → App Store
   * Android → Google Play
   * desktop/unknown → landing page with both options

#### Important

We need best-effort attribution across install/open flow.

Implement a simple mechanism to preserve the referral code:

* store code in cookie/localStorage/sessionStorage on web landing
* append code where possible to store or fallback URLs
* if app already installed and deep linking is available, pass code into app directly
* if deferred deep linking is not fully supported yet, build the backend/web side so it is compatible with future improvements

If exact deferred deep linking is not yet available in current stack, implement the cleanest version possible now and structure it so Branch or similar could be added later.

---

### 4) Redemption logic

When a user signs up or first activates trial inside the app, the system should be able to redeem a referral code and grant extra trial days.

#### Required redemption behavior

* referral code should grant **15 extra trial days** by default
* reward is applied only once per newly eligible account
* prevent repeated redemption abuse
* if code is invalid/inactive/expired/maxed out, do not grant reward
* increment `usedCount` only on successful redemption, not on mere link click
* store redemption record for auditability

Create redemption table/collection:

* `id`
* `referralLinkId`
* `userId`
* `redeemedAt`
* `grantedDays`
* `metadata` optional
* `install/session/device fingerprint` optional if available

Optional tracking fields:

* first seen timestamp
* IP / user agent hash if already supported
* platform at redemption

#### Trial logic

If current app already has free trial logic:

* extend trial end by +15 days rather than replacing it
* keep logic centralized in billing/subscription/trial service
* avoid duplicating trial calculations in multiple places

---

### 5) Tracking and analytics

At minimum, track:

#### Click-level

* code opened
* timestamp
* platform guess
* referrer/user agent if easy

This can be a lightweight events table if needed:

* `referral_link_events`
* `type`: `click`, `redirect`, `redeem`
* `referralLinkId`
* `timestamp`
* `metadata`

#### Redemption-level

Show in admin UI:

* total clicks optional
* total successful redemptions
* used count
* last used date

This does not need full marketing analytics yet. Keep it simple but structured.

---

### 6) Access control

Only admin/internal users can:

* view referral management page
* create referral links
* edit/deactivate referral links
* see usage stats

Public users can only access `/r/:code`.

Do not expose referral management in normal user settings or customer UI.

---

## UX requirements

### Admin UX

Keep it simple and lightweight.
No complex referral dashboard needed.

Good enough:

* create link quickly
* copy link quickly
* see if it was used
* disable link quickly

### Public UX

The user should never feel like they are dealing with a technical promo flow.

They should just get:

* a clean invite/referral-looking link
* store redirect
* bonus applied automatically later

No forced manual promo code entry unless absolutely necessary as fallback.

---

## Technical guidance

### Code generation

Implement code generation utility:

* 6–8 characters
* uppercase letters and digits
* avoid ambiguous characters if possible (`O/0`, `I/1`)
* examples:

  * `7KQ4M2`
  * `X9LM4P`
  * `CLEAN15`

Support custom code input too.

Validation:

* unique
* safe characters only
* reasonable length

---

### Suggested route behavior

#### Public route `/r/:code`

Pseudo-flow:

1. normalize code
2. fetch referral link
3. validate active/expiry/usage
4. log click event
5. persist code client-side/server-side
6. redirect:

   * iOS App Store URL
   * Android Play Store URL
   * desktop landing/download page

#### App signup/redemption flow

At signup / onboarding completion / trial activation:

1. check for pending referral code from:

   * deep link payload
   * stored session/local API state
   * onboarding param
2. call backend redeem endpoint
3. backend validates eligibility
4. backend extends trial by bonus days
5. create redemption record
6. return success/failure gracefully

---

## API endpoints to add

Suggested endpoints, adapt to existing architecture.

### Admin

* `GET /admin/referral-links`
* `POST /admin/referral-links`
* `PATCH /admin/referral-links/:id`
* `POST /admin/referral-links/:id/deactivate`
* `POST /admin/referral-links/:id/activate`

### Public

* `GET /r/:code`

### Redemption

* `POST /referrals/redeem`

Payload example:

```json
{
  "code": "7KQ4M2",
  "userId": "...optional if session-based..."
}
```

Response example:

```json
{
  "success": true,
  "grantedDays": 15,
  "newTrialEndDate": "..."
}
```

---

## Eligibility rules

Implement sane defaults:

A referral reward can be redeemed only if:

* account is newly eligible / within allowed onboarding stage
* same user has not redeemed another referral reward already
* code is active
* code not expired
* code not exhausted
* user does not already have paid subscription if that conflicts with current trial logic

If there is ambiguity in existing trial/subscription logic, integrate in the safest non-breaking way and document assumptions in code comments.

---

## Non-goals

Do **not** implement:

* public user-to-user referral sharing
* referral rewards for existing customers
* multi-sided rewards
* complex attribution dashboards
* external campaign integrations
* push notifications/emails for referrals
* full deferred deep link vendor integration unless already easy in current stack

---

## UI copy suggestions

Use internal/admin wording, not customer-facing marketing copy.

Admin page title:

* `Referral Links`

Create form labels:

* `Label`
* `Public Code`
* `Bonus Trial Days`
* `Max Uses`
* `Channel`
* `Source`
* `Notes`
* `Expires At`
* `Active`

Table actions:

* `Copy Link`
* `Edit`
* `Deactivate`
* `Activate`

---

## Edge cases

Handle these properly:

* invalid code
* inactive code
* expired code
* max uses reached
* code clicked but no signup
* signup without code
* repeated redeem attempts by same user
* referral link created with custom code already in use
* desktop visitor opening link
* app installed vs not installed

For invalid/expired links on web, show a simple fallback page:

* “This invite link is no longer active.”
* include normal download buttons if appropriate

---

## Security / abuse prevention

At minimum:

* server-side validation on every redemption
* no trust in client-side trial extension
* one successful redemption per eligible user
* admin routes protected
* avoid exposing internal metadata publicly

---

## Deliverables

1. DB schema/migration for referral links and redemptions
2. Admin-only referral links page
3. Public `/r/:code` route
4. Backend referral redemption logic
5. Trial extension integration
6. Basic click/redeem tracking
7. Copy-ready working referral links

---

## Acceptance criteria

This task is done when:

1. I can log into admin/internal mode and create a referral link
2. The system generates a real-looking code such as `7KQ4M2`
3. I can copy a full link like `https://proofpix.app/r/7KQ4M2`
4. Opening that link redirects to the correct store or download page
5. After signup/onboarding, the linked user can receive **15 extra trial days**
6. The code usage is tracked in admin
7. I can deactivate a link and it stops working
8. Only admin/internal users can manage links

---

## Implementation preference

Keep the implementation **small, clean, and extensible**.

This should be built as an internal admin growth tool, not overengineered as a full referral product.

Prioritize:

* minimal UI
* robust backend logic
* easy future expansion for channel testing



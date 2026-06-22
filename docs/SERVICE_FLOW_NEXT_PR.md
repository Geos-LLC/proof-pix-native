# Service Flow Integration — Next PR (Three-Surface Pairing)

**Scope:** add the second + third pairing surfaces so ProofPix can be connected from anywhere (SF web QR, SF web in-app browser via OAuth-style redirect, future SF mobile if it ships). Today only the SF-web-typed-code path works; this PR unlocks the same-device flows.

**Audience:** Service Flow backend + frontend team. The previous three PRs (handshake, jobs list, photo upload) are live in staging. This builds on top of them — no migrations to existing tables, only additions.

## What's changing (v.s. what shipped)

- **Renaming** `POST /api/integrations/proofpix/connect/code/redeem` → `POST /api/integrations/proofpix/connect/redeem`. Same payload, accepts either format. Old route stays as a 308 redirect for ≥30 days.
- **Adding** `POST /api/integrations/proofpix/connect/token/issue` — mints a URL-safe single-use token for same-device deep-link pairing. SF JWT auth required (caller is a logged-in SF user via web or PWA).
- **Adding** `GET /integrations/proofpix/authorize?return_to=<proofpix-url>` — OAuth-style authorize endpoint on the SF web/PWA. Prompts login if needed, mints a token, 302 redirects to `return_to`.
- **Adding** "Connect ProofPix" button somewhere in the SF web/PWA settings — calls `authorize?return_to=proofpix://connect` directly so the user never sees a typed code.
- **Adding** server-side dedupe on re-pair: when `/connect/redeem` lands and the SF user already has an unrevoked `proofpix_connections` row, set `revoked_at` on the old one before inserting the new one. Same SF user across reinstalls keeps one active connection.

## Why this matters

The current 16-char code flow assumes the user is at a laptop displaying the code while their phone scans it. That breaks for:
1. **Admin pairing from their phone** — can't QR yourself
2. **Same-device handoffs in the future** when SF mobile native ships — wants deep-link not paste
3. **OAuth-style flow when ProofPix initiates the pairing** — clean UX, well-understood pattern

## Endpoints to add

### 1. `POST /api/integrations/proofpix/connect/token/issue`

Mints a one-time URL-safe token for the calling SF user.

**Auth:** `Authorization: Bearer <SF user JWT>` (existing surface).

**Response:**
```json
{ "token": "<base64url, 32 bytes random>", "expires_in": 60 }
```

- Token TTL: 60 seconds. Short because it's redeemed instantly via deep-link.
- Single-use, same dedup table as the 16-char codes (`proofpix_connect_codes`). Add a `format` column (`'code'` | `'token'`) so the redeem handler can branch on storage, or just store both with the same shape and let the column be free-form `text`.
- Same user can mint multiple tokens (multi-device).

### 2. `POST /api/integrations/proofpix/connect/redeem`

Renamed from `/connect/code/redeem`. Accepts either format.

**Body:**
```json
{ "code": "<16-char code OR base64url token>", "device_label": "string" }
```

The handler discriminates by shape — codes have hyphens + uppercase letters, tokens are base64url-clean. Internal lookup against `proofpix_connect_codes` (or whatever you rename it to — `proofpix_connect_credentials` would be cleaner).

**Response, errors:** unchanged from `/connect/code/redeem`.

**Dedupe on re-pair:** before inserting the new `proofpix_connections` row:

```sql
UPDATE proofpix_connections
SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
```

(Or skip dedupe and allow parallel; both shapes work for our use case. Recommendation: dedupe — keeps the active-connections list clean for the future "Active ProofPix devices" admin UI.)

### 3. `GET /integrations/proofpix/authorize?return_to=<url>`

OAuth-style authorize page. Lives on the SF web/PWA, served by the backend.

**Behavior:**

1. **Validate `return_to`:** must start with `proofpix://` or `https://proofpix.app/`. Reject otherwise with 400 — protects against open-redirect abuse.
2. **If user not authenticated:** redirect to SF login with `?continue=/integrations/proofpix/authorize?return_to=<encoded>`. Existing SF login flow.
3. **If authenticated:** mint a token via the same path as `/connect/token/issue`. Then 302 to:
   ```
   <return_to>?token=<token>&workspace=<users.id>
   ```
4. **No consent screen needed in v1** — ProofPix is a first-party integration. (Future third-party integrations would slot a consent step in here.)

### 4. SF web/PWA UI

Anywhere reasonable in SF settings (Integrations tab, probably), a "Connect ProofPix" button:

```html
<a href="/integrations/proofpix/authorize?return_to=proofpix://connect">
  Connect ProofPix
</a>
```

When the user taps this on their phone (where ProofPix is installed):

1. SF backend mints token → redirects to `proofpix://connect?token=…&workspace=…`
2. OS deep-links to ProofPix (or App Store fallback if not installed)
3. ProofPix's deep-link handler reads the token, calls `/connect/redeem`, persists, shows "Connected"

When the user taps on a laptop:

1. Same flow, but step 2's deep-link doesn't resolve (no ProofPix on laptop)
2. SF web detects this (timeout or absence of return navigation) and falls back to showing the QR + text code via the existing `/connect/code/issue` path
3. User scans QR with ProofPix camera

The fallback is a small piece of frontend logic — try the deep-link, listen for `pageshow` after a 1-second timeout, show QR if still on the SF page. Reference: how Slack handles "Open in App" buttons.

## Non-changes (explicitly out of scope)

- **No native SF mobile app required.** Mobile-web / PWA is enough — see the §"why each option works" matrix in `docs/SERVICE_FLOW_INTEGRATION.md`. The `proofpix://` scheme is invokable from any web page (including PWAs).
- **No new tables.** Reuse `proofpix_connect_codes` (rename optional) and `proofpix_connections` from PR 1.
- **No changes to the upload flow.** PR 3's `/jobs/:jobId/photos` is untouched.
- **No webhook / job-complete photo gate yet.** Those are deferred — see §10 in the main integration doc.

## Definition of done

- [ ] `/connect/token/issue` live behind `PROOFPIX_INTEGRATION_ENABLED`, smoke-tested with a 60-second redemption round-trip.
- [ ] `/connect/redeem` accepts both formats. Old `/connect/code/redeem` route still works for 30 days (308 redirect or duplicate handler — your call).
- [ ] `/integrations/proofpix/authorize` lives on SF web + PWA, validates `return_to`, handles unauthenticated → login → return-with-token flow.
- [ ] SF settings UI has a "Connect ProofPix" button that hits `/authorize`, with a same-page fallback to the QR + text code when the deep-link can't resolve.
- [ ] Server-side dedupe on `/connect/redeem`: pre-existing unrevoked connection for the same `user_id` gets `revoked_at = now()` before the new one is inserted.
- [ ] Tests for: token TTL expiry, double-redeem, format discrimination, dedupe-on-repair, `return_to` validation, authorize-when-unauthenticated.

## On the ProofPix side (parallel work, no SF coordination needed until staging is ready)

Already done in commit `bcd3868` (this commit batch): team-session keys migrated to Keychain so technician reinstalls don't lose their session. That's step 1 of the build order; this SF backend PR is step 2. Once your endpoints are in staging I'll:

1. Update `serviceFlowAdapter.connect()` to accept either `{ code }` (existing) or `{ token }` (new, from deep-link).
2. Add the `proofpix://connect?token=…` deep-link handler to App.js' linking config — it'll route to a `CRMConnectScreen` that auto-calls `adapter.connect({ token })`.
3. Build the "Connect Service Flow" universal entry in Settings → Cloud Sync — tries `Linking.openURL('serviceflow://pair')` first (future-proofs for SF native), falls back to `WebBrowser.openAuthSessionAsync('/integrations/proofpix/authorize?return_to=…')`.

That's the user-facing v1 of the integration. After it lands in TestFlight, ping for the prod flag flip.

## Then what

- **Proxy routes** (`/api/crm/serviceflow/connection`, `/jobs`, `/jobs/:jobId/photos`, `DELETE /connection`) — separate task on the proxy repo, makes team-member uploads possible. Doesn't block this PR.
- **Job-sync pull on app open** — ProofPix-side. Calls `/jobs` via the proxy, mirrors into local projects.
- **Capture deep-link** (`proofpix://capture?sf_job_id=…&mode=before`) — opens ProofPix camera in the right project. Pairs with the SF web/PWA job-row button.
- **Photos-required-to-complete** — SF backend gate. Decoupled, can land anytime after the photo flow is in real use.

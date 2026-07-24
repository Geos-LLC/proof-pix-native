# SF ↔ ProofPix — Team-Member Visibility

**Owner:** SF backend agent
**ProofPix side:** ready to call as soon as endpoints are live; adapter changes are one commit + one OTA.
**Depends on:** current `/api/integrations/proofpix/*` namespace + `proofpix_connections` table (already shipped in PR 1).

---

## 1. Problem

Today the SF admin panel only sees the **admin's** ProofPix connection (the row minted by `POST /connect/code/redeem`). When admin invites crew members through ProofPix and members join, SF has no signal until the member's first photo attachment arrives with a `captured_by` string in `POST /jobs/:jobId/photos` metadata.

That means:
- SF admin can't tell "how many crew members are linked" without waiting for a first upload.
- No way to revoke a specific member from SF (only from the ProofPix side).
- No audit trail of "member X joined admin Y's workspace at time Z" independent of upload activity.

## 2. Data model

Team members are already tracked on the ProofPix side (`session.teamMembers[]` in Vercel-KV-style `session:${sessionId}` on the ProofPix proxy). Each row has `{ token, name?, email?, status, joinedAt, lastSeenAt, lastUploadAt }`.

We want a shadow row on SF, scoped to the admin's `workspace_id` (= admin's `users.id` per §2 of `SERVICE_FLOW_INTEGRATION.md`):

```sql
CREATE TABLE proofpix_team_members (
  id                BIGSERIAL PRIMARY KEY,
  workspace_id      TEXT NOT NULL,           -- FK to users.id (admin)
  proofpix_member_token TEXT NOT NULL,       -- ProofPix invite-token, stable per member
  display_name      TEXT,                    -- from teamMembers[].name (may be null pre-upload)
  email             TEXT,                    -- from teamMembers[].email if collected
  device_model      TEXT,                    -- from adapter's /connect/redeem payload
  os_name           TEXT,
  os_version        TEXT,
  status            TEXT NOT NULL DEFAULT 'joined',  -- 'joined' | 'revoked'
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ,
  last_upload_at    TIMESTAMPTZ,
  photo_count       INT NOT NULL DEFAULT 0,  -- bump on each photos POST from this member
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, proofpix_member_token)
);
CREATE INDEX proofpix_team_members_workspace_idx ON proofpix_team_members(workspace_id);
```

`proofpix_member_token` uniqueness within a workspace is enforced because that's the ProofPix-side identity; upserts key on `(workspace_id, proofpix_member_token)`.

## 3. Endpoints

Base URL: `https://service-flow.pro/api/integrations/proofpix` (prod).
All endpoints under the existing `PROOFPIX_INTEGRATION_ENABLED` feature flag (return 404 when off).

### `POST /team-members`

Called by the ProofPix proxy when a team-member joins the admin's session. Idempotent — repeated calls with the same `token` update the existing row instead of creating a duplicate.

**Auth:** `Authorization: Bearer <SF access token>` obtained by the proxy via the existing `POST /connect/refresh` flow using the admin's stored refresh token. Access token's `sub` establishes `workspace_id` — the proxy never passes it in the body.

**Body:**
```json
{
  "proofpix_member_token": "pp_inv_ULID",
  "display_name": "Alex Bond",
  "email": null,
  "device_model": "iPhone 15",
  "os_name": "iOS",
  "os_version": "18.4"
}
```
- `proofpix_member_token` required. Everything else optional (may be null on first join if collected later during first upload).

**Response `200`:**
```json
{
  "id": 42,
  "workspace_id": "21",
  "proofpix_member_token": "pp_inv_ULID",
  "status": "joined",
  "joined_at": "2026-07-24T18:12:03Z"
}
```

**Response `409` — revoked-and-rejoined:** if the row exists with `status='revoked'`, flip back to `joined`, clear `revoked_at`, update `joined_at`. Return `200` with the refreshed row.

**Errors:** standard SF envelope (`{ error: { code, message, retryable } }`) with codes: `INVALID_PAYLOAD` (missing token), `INVALID_TOKEN` (bad access token), `UNAUTHORIZED` (feature flag off / wrong sub claim).

### `GET /team-members?status=joined&limit=100&cursor=...`

Lists team members for the caller's workspace. Cursor-paginated (opaque, ULID-like). Filter by `status` (default `joined`; `revoked` and `all` also supported).

**Auth:** `Authorization: Bearer <SF access token>` — same access-token model as everything else in the namespace.

**Response `200`:**
```json
{
  "team_members": [
    {
      "id": 42,
      "proofpix_member_token": "pp_inv_ULID",
      "display_name": "Alex Bond",
      "email": null,
      "device_model": "iPhone 15",
      "os_name": "iOS",
      "os_version": "18.4",
      "status": "joined",
      "joined_at": "2026-07-24T18:12:03Z",
      "last_seen_at": "2026-07-24T19:03:11Z",
      "last_upload_at": "2026-07-24T19:03:11Z",
      "photo_count": 12
    }
  ],
  "next_cursor": null
}
```

### `POST /team-members/:token/revoke`

Admin-driven revoke from the SF panel. Sets `status='revoked'`, `revoked_at=NOW()`. SF backend should also POST back to the ProofPix proxy at `POST https://steadfast-blessing-production.up.railway.app/api/admin/:sessionId/tokens/:token/revoke` so the mobile side stops accepting uploads with that token. (Endpoint doesn't exist yet on the proxy — I'll ship it in the same iteration once the SF side is live.)

**Auth:** same as above.

**Response `200`:** `{ "success": true }`.

### `POST /jobs/:jobId/photos` — additive tweak

The existing photo-upload endpoint (PR 3) should now:
1. Read `metadata.captured_by` (already sent by the proxy's `attachToServiceFlow`).
2. Match it against `display_name` on `proofpix_team_members` for the same workspace.
3. If a row matches, bump `last_upload_at`, `last_seen_at`, `photo_count`.
4. If no row matches but `metadata.captured_by` is non-empty, do NOT auto-create a row — that path stays reserved for `POST /team-members`. Just log for now.

## 4. Auth flow — how the proxy authenticates for team-member POSTs

The proxy already stores each admin's SF refresh token on the session (`session.serviceFlowRefreshToken`, see `attachToServiceFlow` in `[proof-pix-proxy/index.js:3766](../../proof-pix-proxy/index.js#L3766)`). To call `POST /team-members`:

1. Proxy loads `session.serviceFlowRefreshToken`.
2. Calls `POST /connect/refresh` → gets a 1h access token.
3. Calls `POST /team-members` with `Authorization: Bearer <access_token>`.

The `sub` claim on the access token = admin's SF `users.id` = workspace_id. SF enforces that all team-member rows land under that workspace. No cross-tenant leak possible.

## 5. Sequence — team-member joins

```
User taps invite link on their phone
  ↓
ProofPix mobile joinTeam(token, sessionId)
  ↓
Proxy `POST /api/session/join` — validates invite, adds token to session.teamMembers[]
  ↓ (NEW — proxy pings SF)
Proxy hits SF `POST /connect/refresh` for admin's access token
  ↓
Proxy hits SF `POST /team-members` with member metadata
  ↓
SF creates proofpix_team_members row, returns 200
  ↓
Proxy returns success to mobile
  ↓
Mobile navigates to Home
```

If step "proxy pings SF" fails (SF down, refresh token dead, etc.):
- Log on the proxy, do NOT fail the mobile join.
- Retry opportunistically on the next `/api/upload/:sessionId` call from that member (proxy tries a shadow POST to `/team-members` before the photo attach if `last_registered_at` is missing).

## 6. Sequence — admin revokes from SF panel

```
Admin taps "Revoke" on the SF panel
  ↓
SF `POST /team-members/:token/revoke` — flips status to 'revoked'
  ↓
SF hits ProofPix proxy `POST /api/admin/:sessionId/tokens/:token/revoke` (server-to-server, shared secret via header)
  ↓
Proxy removes token from session.inviteTokens, marks member as revoked in session.teamMembers[]
  ↓
Member's next upload attempt → 403 from proxy → mobile shows "Removed from team, sign out"
```

## 7. Migration / rollout

- Ship `POST /team-members` behind existing feature flag first. No traffic yet.
- ProofPix proxy adds the "ping SF on join" call, gated on `session.serviceFlowRefreshToken` being present. Existing admins on the Google-Drive team session are unaffected (no SF creds → skip the call).
- Backfill: not needed — new team-member rows populate as members join or on their first upload. Existing sessions with prior members will populate on their next photo attach (via the additive tweak in §3).

## 8. What ProofPix will change once SF ships this

- **Proxy:** in the team-member join path, add `await postTeamMemberToSF(session)` (best-effort, non-blocking).
- **Proxy:** on `/api/upload/:sessionId` for SF-primary sessions where `last_registered_at` is missing, shadow-POST `/team-members` before `attachToServiceFlow`.
- **Mobile:** no change required.
- **Estimated ProofPix diff:** ~40 LOC + one OTA.

## 9. Open questions for the SF agent

1. Is `service-flow.pro/api/integrations/proofpix` the right base for prod, or do we want a distinct subdomain for machine-to-machine calls?
2. Do you want to expose `email` in the `POST /team-members` body, or should SF only collect what SF's own auth would have? (ProofPix collects a display name at join; email is optional.)
3. For the revoke callback (SF → proxy), what auth do you want on the server-to-server hop? Simplest is a shared secret header (`X-ProofPix-Signature`); we'd add the env var on Railway.
4. Rate limit — expected member-join rate is low (<10 per admin per hour under normal usage), but SF may want to cap at ~100/h per workspace to be safe.

## 10. Ready-to-ship signal

Once the SF side is live on prod, please reply with:
- Endpoint URL + example curl for `POST /team-members` and `GET /team-members` against a test workspace.
- Confirmation that the feature flag is on for staging AND prod.
- The shared-secret env var name for the revoke callback (if you choose that route in Q3).

We'll turn around the ProofPix proxy commit + OTA within a day of that signal.

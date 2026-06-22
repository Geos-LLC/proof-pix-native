# Service Flow ↔ ProofPix Integration

**Scope:** `/api/integrations/proofpix/*` namespace on the Service Flow backend so the ProofPix mobile app can attach captured before/after photos to Service Flow jobs.

**PR status:**
- **PR 1 (handshake + connection lifecycle)** — ✅ live on staging (`service-flow-backend-staging-303f.up.railway.app`). Five endpoints in §3 verified end-to-end. Adapter wired in [src/services/crm/serviceFlowAdapter.js](../src/services/crm/serviceFlowAdapter.js).
- **PR 2 (`GET /jobs`)** — pending. Will unblock the project-create job picker.
- **PR 3 (`POST /jobs/:jobId/photos` + idempotency)** — pending. Will unblock background uploads to SF.
- **PR 4 (batch endpoint, webhook for job delete/complete)** — optional, after PR 3.

---

## 1. Flow

1. Admin (already a Service Flow user) clicks **Generate ProofPix code** in the SF web UI → SF mints a 10-minute single-use connect code formatted `XXXX-XXXX-XXXX-XXXX` (Crockford base32, ~80 bits entropy).
2. Admin opens ProofPix → **Settings → Cloud Sync → Service Flow → Connect** → pastes the code.
3. The adapter calls `POST /connect/code/redeem` with the code + a device label. SF returns a long-lived refresh token (`pprt_…`) + short-lived access token + workspace metadata.
4. The refresh token is stored in iOS Keychain via `secureStorageService.writeSecure`. The access token is cached in memory and refreshed on demand against `POST /connect/refresh` (1-hour TTL, refreshed with a 60-second safety margin).
5. Picker / upload code calls `crmService.listJobs()` / `crmService.attachPhoto()` — the facade resolves the active adapter and forwards.

**Phase 1 limitation:** admin-only. The token lives on the admin's device. Team-member uploads will route through the Railway proxy in Phase 2.

---

## 2. Identity model

Service Flow has no separate "company" abstraction. **The `users` row IS the tenant.** That means:

- `workspace_id` = `users.id` (stringified, e.g. `"21"`)
- `admin_user_id` = same stringified `users.id` (1:1 with `workspace_id`)
- `workspace_name` = `users.business_name` → falls back to `users.email` if `business_name` is null

Team members of that tenant (when Phase 2 lands) share the same `workspace_id` because they upload under the admin's session.

---

## 3. Endpoints (PR 1 — live on staging)

Base URL: `https://service-flow-backend-staging-303f.up.railway.app`

All endpoints sit under `/api/integrations/proofpix/*` and are gated by the global `PROOFPIX_INTEGRATION_ENABLED` feature flag. When the flag is off, every endpoint returns 404 — the namespace appears not to exist.

### `POST /connect/code/issue`

Mints a connect code for the calling SF user.

**Auth:** `Authorization: Bearer <SF user JWT>` (existing SF auth surface).

**Response:**
```json
{ "code": "AJEF-VVCT-P6Y3-PP9Z", "expires_in": 600 }
```
- Code is single-use, 10-minute TTL, Crockford base32 (no `I L O U`).
- Multiple codes can exist for the same user simultaneously (each redeem is independent).

### `POST /connect/code/redeem`

Exchanges a connect code for a refresh token + access token. The code is the credential — no other auth required.

**Body:**
```json
{ "code": "AJEF-VVCT-P6Y3-PP9Z", "device_label": "ProofPix iOS - iPhone 15" }
```

**Response:**
```json
{
  "refresh_token": "pprt_<base64url-encoded random>",
  "access_token":  "<JWT, aud='proofpix', 1h TTL>",
  "expires_in":    3600,
  "workspace_id":   "21",
  "workspace_name": "test busuines",
  "admin_user_id":  "21"
}
```
- Refresh token is opaque (`pprt_` prefix → greppable in logs / proxy KV).
- Each redeem adds a new row to `proofpix_connections` on the SF side — multi-device by design. Revoking one connection leaves siblings untouched.
- Codes are single-use; double-redeem returns `INVALID_CODE`.

### `POST /connect/refresh`

Exchanges the refresh token for a fresh access token. Idempotent.

**Body:**
```json
{ "refresh_token": "pprt_<…>" }
```

**Response:**
```json
{ "access_token": "<new JWT>", "expires_in": 3600 }
```

### `GET /connection/status`

Cheap probe that confirms the connection is still alive (called on app open).

**Auth:** `Authorization: Bearer <access token>`

**Response:**
```json
{ "valid": true, "workspace_id": "21", "workspace_name": "test busuines" }
```
After revoke this returns 401 with `{ "error": { "code": "INVALID_TOKEN", "message": "Connection revoked." } }`.

### `DELETE /connection`

Revokes the calling connection (soft-delete, idempotent).

**Auth:** `Authorization: Bearer <access token>`
**Response:** `204 No Content`

---

## 4. Endpoints (PR 2 — pending)

### `GET /jobs`

Will list jobs the admin can attach photos to. Spec from the original task doc:

```
GET /jobs?status=active&search=&limit=50&cursor=
Headers: Authorization: Bearer <access token>
→ 200 {
    "jobs": [
      {
        "id": "string",                 // SF-side stable job id
        "title": "string",              // displayed in picker
        "customer_name": "string|null",
        "address": "string|null",
        "status": "active|completed|scheduled|cancelled",
        "scheduled_at": "number|null",  // ms epoch
        "photo_count": "number"
      }
    ],
    "next_cursor": "string|null"
  }
```

Default `status=active`, cap `limit` at 100. Sort `scheduled_at DESC, created_at DESC`.

---

## 5. Endpoints (PR 3 — pending)

### `POST /jobs/:jobId/photos`

Attaches a single photo to a job. Multipart upload + JSON metadata sidecar. SF stores it in the existing `customer_files` table (with a `source = 'proofpix'` column added in PR 3), so the photo automatically appears in the existing Files tab on `/customer/:id`.

```
POST /jobs/:jobId/photos
Headers:
  Authorization: Bearer <access token>
  Content-Type: multipart/form-data
Body:
  file:        <binary>   (image/jpeg or image/png; up to 20 MB)
  metadata:    JSON string with shape:
    {
      filename, mode, room, timestamp, gps,
      captured_by: { name?, email? } | null,
      notes, proofpix_photo_id, proofpix_project_id
    }
→ 200 { success: true, crm_photo_id: "...", photo_url: "..." }
→ 409 if proofpix_photo_id already attached (returns the existing crm_photo_id)
→ 413 if file > 20 MB
```

**Idempotency:** dedup by `proofpix_photo_id` for ≥ 24 hours so retries don't double-upload.

### `POST /jobs/:jobId/photos/batch` (optional, PR 4)

Multi-photo upload in one request. Falls back to per-photo `attachPhoto` calls in `BaseCRMAdapter.attachPhotoBatch` if the endpoint doesn't exist, so PR 3 can ship without it.

---

## 6. Error envelope

Every error response (any non-2xx) returns:

```json
{
  "error": {
    "code": "INVALID_PAYLOAD | INVALID_TOKEN | INVALID_CODE | CODE_EXPIRED | RATE_LIMITED | JOB_NOT_FOUND | QUOTA_EXCEEDED | NOT_IMPLEMENTED",
    "message": "Human-readable.",
    "retryable": false,
    "retry_after_seconds": null
  }
}
```

Status code mapping:
| HTTP | When |
|---|---|
| `400` | `INVALID_PAYLOAD`, `INVALID_CODE`, `CODE_EXPIRED` |
| `401` | `INVALID_TOKEN` (access token bad, expired, revoked) |
| `403` | `QUOTA_EXCEEDED` |
| `404` | `JOB_NOT_FOUND` *or* the integration flag is off (entire namespace 404s) |
| `413` | photo > 20 MB |
| `429` | `RATE_LIMITED` (with `retry_after_seconds`) |

Field names are **snake_case** (`retry_after_seconds`, not `retryAfterSeconds`).

---

## 7. Auth model (Phase 1 — admin-only)

```
┌──────────┐  paste code   ┌──────────────────┐
│ admin    │ ────────────▶ │ proofpix-native  │
│ SF web   │               │ ServiceFlow      │
│ (mints   │               │ Adapter          │
│  code)   │               └──────┬───────────┘
└──────────┘                      │
                          POST /connect/code/redeem
                                  ▼
                      ┌────────────────────────────┐
                      │ service-flow-backend       │
                      │ (returns refresh + access) │
                      └──────────┬─────────────────┘
                                 │
                ┌────────────────┼───────────────────┐
                │                │                   │
                ▼                ▼                   ▼
       refresh_token       access_token        workspace
       (iOS Keychain)      (in-memory cache)   (Keychain JSON)
```

Storage on the device:
- `serviceflow.refresh_token` → Keychain (survives iOS uninstall+reinstall)
- `serviceflow.workspace` → Keychain JSON (provider, workspaceId, workspaceName, adminUserId, connectedAt)
- Access token → in-memory only, refreshed against `/connect/refresh` when expired

## 8. Auth model (Phase 2 — team members)

Will land alongside team-member upload support. The Railway proxy (`steadfast-blessing-production.up.railway.app`) will hold the admin's refresh token. Team members upload through the proxy with their existing team session id; the proxy looks up the admin's SF connection, refreshes the access token if needed, and forwards to `POST /jobs/:jobId/photos`. The `captured_by` field on the metadata carries the team-member name for display in SF.

---

## 9. Smoke test (curl)

The adapter was verified against PR 1 staging with this recipe. To reproduce, get a SF user JWT (24-hour, from `staging.service-flow.pro` devtools) and run:

```bash
BASE="https://service-flow-backend-staging-303f.up.railway.app"
SF_JWT="<paste>"

# 1. mint a code
ISSUE=$(curl -s -X POST "$BASE/api/integrations/proofpix/connect/code/issue" \
  -H "Authorization: Bearer $SF_JWT")
CODE=$(echo "$ISSUE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).code))")

# 2. redeem
REDEEM=$(curl -s -X POST "$BASE/api/integrations/proofpix/connect/code/redeem" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"device_label\":\"smoke-test\"}")
ACCESS=$(echo "$REDEEM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).access_token))")

# 3. status
curl -s "$BASE/api/integrations/proofpix/connection/status" \
  -H "Authorization: Bearer $ACCESS"
# → { valid: true, workspace_id, workspace_name }

# 4. revoke
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  "$BASE/api/integrations/proofpix/connection" \
  -H "Authorization: Bearer $ACCESS"
# → 204

# 5. post-revoke
curl -s "$BASE/api/integrations/proofpix/connection/status" \
  -H "Authorization: Bearer $ACCESS"
# → 401 { error: { code: "INVALID_TOKEN", message: "Connection revoked." } }
```

---

## 10. Open questions for PR 2 / PR 3

1. **Photo storage:** SF will reuse `customer_files` with a new `source = 'proofpix'` column. Confirmed in PR 3 prep.
2. **Geofencing:** does SF want to reject photos whose GPS coords are >X miles from the job's service address? Default: nothing in v1; revisit if false attribution becomes a problem.
3. **Soft-delete propagation:** if a job is completed or deleted in SF, should ProofPix clear the project's `crmJobId` link? Probably via a webhook in PR 4.

# Service Flow ↔ ProofPix Integration

**Scope:** `/api/integrations/proofpix/*` namespace on the Service Flow backend so the ProofPix mobile app can attach captured before/after photos to Service Flow jobs.

**PR status:**
- **PR 1 (handshake + connection lifecycle)** — ✅ live on staging (`service-flow-backend-staging-303f.up.railway.app`). Five endpoints in §3 verified end-to-end. Adapter wired in [src/services/crm/serviceFlowAdapter.js](../src/services/crm/serviceFlowAdapter.js).
- **PR 2 (`GET /jobs`)** — ✅ live on staging. Pagination, filters, search, error envelope all verified. `listJobs()` wired in the adapter.
- **PR 3 (`POST /jobs/:jobId/photos` + idempotency)** — ✅ live on staging. Happy path + idempotent retry + bad mime + oversize + photo_count bump all verified by the SF side. `attachPhoto()` wired in the adapter.
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

## 4. Endpoints (PR 2 — live on staging)

### `GET /jobs`

Lists jobs the admin can attach photos to. Used by the project-create job picker.

**Auth:** `Authorization: Bearer <access token>`

**Query parameters:**
| Param | Default | Notes |
|---|---|---|
| `status` | `active` | One of `active` / `all` / `completed` / `cancelled` / `scheduled`. See §4.1 for the SF-status → bucket mapping. |
| `search` | — | Free-text. Matches service name OR customer first/last name. Numeric query (e.g. `42` or `#42`) hits the job id directly. |
| `limit` | `50` | Capped at `100`. |
| `cursor` | — | Opaque base64. Encodes the `(scheduled_date, id)` tuple of the last item of the prior page. |

**Response:**
```json
{
  "jobs": [
    {
      "id":            "142183",
      "title":         "test  service",
      "customer_name": "Georgiy Sayapin",
      "address":       "5332 Raven Ct, Bloomfield Township, MI 48301, USA",
      "status":        "active",
      "scheduled_at":  1778922000000,
      "photo_count":   0
    }
  ],
  "next_cursor": null
}
```

Sort is `scheduled_at DESC, id DESC`. Cursor is set on the response when there are more rows past `limit`; null on the last page.

### 4.1 Status bucket mapping

Service Flow has 12 internal statuses; the response collapses them to 4 buckets. The `status` filter accepts the bucket name and the server expands it to the matching SF statuses.

| API bucket | SF internal statuses |
|---|---|
| `active` (default) | `pending`, `confirmed`, `in-progress`, `en-route`, `started`, `late`, `rescheduled` |
| `completed` | `completed`, `complete`, `paid` |
| `cancelled` | `cancelled` |
| `scheduled` | `scheduled` |
| `all` | every status above (no filter) |

If a job sits in an SF status that's not in any bucket (future workflow additions, etc.), it's returned only under `status=all`. Safe default for the picker.

### 4.2 Address-quality note

Some SF tenants have denormalised job rows where `service_address_street` already contains the full address while state/zip are also populated, producing strings like `"5332 Raven Ct, Bloomfield Township, MI 48301, USA, MI 48301"`. The adapter applies a light client-side dedup that splits on commas, drops consecutive duplicates case-insensitively, and rejoins — so the picker shows a clean address even when the server returns a duplicated one. SF backend may add server-side dedup in a follow-up; this client guard is forward-compatible.

---

## 5. Endpoints (PR 3 — live on staging)

### `POST /jobs/:jobId/photos`

Attaches a single photo to a job. Multipart upload + JSON metadata sidecar. SF stores it in the existing `customer_files` table with `source = 'proofpix'`, so the photo automatically appears in the existing Files tab on `/customer/:id` (when the job has a customer) and in the job's own attachments view.

**Auth:** `Authorization: Bearer <access token>`
**Content-Type:** `multipart/form-data`

**Body:**

| Field | Type | Notes |
|---|---|---|
| `file` | binary | `image/jpeg` or `image/png`. Strict — 400 on anything else (e.g. `image/heic`). Up to 20 MB. |
| `metadata` | JSON string | Shape below. |

```jsonc
{
  "filename":            "section1_before_1782131766.jpg",
  "mode":                "before",         // 'before' | 'after' | 'progress' | 'combined'
  "room":                "front_roof",     // ProofPix folder id
  "timestamp":           1782131766000,    // capture ms epoch
  "gps":                 { "lat": 42.5803, "lng": -83.2424 },  // or null
  "captured_by":         { "name": "Crew #1", "email": null }, // or null
  "notes":               "",
  "proofpix_photo_id":   "pp-section1-...",  // idempotency key (≥24h dedup window)
  "proofpix_project_id": "proj-..."
}
```

**Responses:**
- `200 { success: true, crm_photo_id, photo_url }` — first time this `proofpix_photo_id` was seen on this job.
- `409 { success: true, crm_photo_id, photo_url }` — dedup hit. **Body shape is identical to 200; only the HTTP status differs.** The photo is already on the job. The adapter treats both as success with `alreadyExisted: true` on 409.
- `400 INVALID_PAYLOAD` — bad mime, missing metadata fields, malformed JSON.
- `401 INVALID_TOKEN` — connection revoked or token expired.
- `404 JOB_NOT_FOUND` — job id doesn't exist for this workspace.
- `413 PAYLOAD_TOO_LARGE` — file > 20 MB.
- `429 RATE_LIMITED` — burst guard; respect `retry_after_seconds`.

**Idempotency:** SF dedupes by `proofpix_photo_id` for at least 24 hours. Mobile retries (network blip, app suspend mid-upload, etc.) are safe — the dedup hit returns the same `crm_photo_id` and `photo_url` the original upload produced, so the photo record on the ProofPix side stays consistent.

### 5.1 Storage layout

SF writes the file to a public Supabase bucket named `proofpix-photos` (created on backend boot via `ensureBuckets()`). The `photo_url` returned is:

```
https://<supabase-project>.supabase.co/storage/v1/object/public/proofpix-photos/user-<userId>/job-<jobId>/<proofpix_photo_id>.<ext>
```

URLs are public but unguessable because `proofpix_photo_id` is a 32+ bit random id minted by the ProofPix app. No auth required to GET — the proofpix-native app stores the `photo_url` and reuses it directly for thumbnails, share sheets, etc.

### 5.2 customer_files schema (relevant fields)

PR 3 added three columns to `customer_files` and made `customer_id` nullable:

| Column | Type | Notes |
|---|---|---|
| `source` | `text` | `'proofpix'` for these rows; future integrations may add others. SF UI may filter on this to render a "via ProofPix" badge. |
| `proofpix_photo_id` | `text` | The idempotency key. Unique partial index per (`user_id`, `job_id`, `proofpix_photo_id`). |
| `proofpix_metadata` | `jsonb` | The full metadata sidecar — `mode`, `room`, `timestamp`, `gps`, `captured_by`, `notes`, `proofpix_project_id`. Available for SF-side reporting. |
| `customer_id` | `bigint NULL` | Was `NOT NULL`; relaxed in migration 068 because jobs without a linked customer can still have ProofPix uploads. Such photos won't appear in any customer's Files tab — only reachable via the job's attachments view. |

### 5.3 HEIC note

iOS Camera defaults to HEIC; the ProofPix capture pipeline already converts to JPEG before save (label compositor / image processor outputs JPEG). The adapter's mime guard exists as a belt-and-suspenders against future capture paths that might surface HEIC — it returns `UNSUPPORTED_MIME` locally so a clear error is surfaced to the user instead of round-tripping a server 400.

### `POST /jobs/:jobId/photos/batch` (optional, PR 4)

Multi-photo upload in one request. Falls back to per-photo `attachPhoto` calls in `BaseCRMAdapter.attachPhotoBatch` if the endpoint doesn't exist, so PR 3 doesn't require it.

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

## 10. Open / deferred items

1. **Photo storage:** ✅ shipped — `customer_files` reused with `source = 'proofpix'`, `proofpix_photo_id`, `proofpix_metadata` columns + nullable `customer_id` (migration 068).
2. **Geofencing:** still deferred. SF returns GPS in metadata; if false attribution becomes a problem we can either gate at upload or just flag in the UI.
3. **Soft-delete propagation:** still deferred to PR 4 (webhook surface on job complete/delete).
4. **Batch endpoint:** still deferred; adapter falls back to per-photo loops.
5. **Burst rate limit:** only the 120/min steady-state limit landed in PR 3. Adapter respects `retry_after_seconds` if the burst guard ships later — no client changes needed.
6. **Admin UI for "Active ProofPix devices":** backend already has the data (`SELECT * FROM proofpix_connections WHERE user_id = ? AND revoked_at IS NULL`). No mobile-side surface needed; this is a Service Flow web UI concern.
7. **Address dedup:** kept as the client-side guard in `serviceFlowAdapter.dedupAddress`. Server-side can ship later without a coordinated mobile change.

## 11. Production rollout

When the proofpix-native PR 3 adapter ships to production (TestFlight build that includes commit chain through `e931ff5 → dd312cd → <PR 3 commit>`):

```bash
# 1. Merge staging → main on service-flow-backend
# 2. Apply migrations 066, 067, 068 to prod (same Supabase project, no-op there since same DB)
# 3. Flip the flag on prod Railway
railway variables --service service-flow-backend --environment prod --set PROOFPIX_INTEGRATION_ENABLED=true
```

Staging keeps the flag on indefinitely for iteration.

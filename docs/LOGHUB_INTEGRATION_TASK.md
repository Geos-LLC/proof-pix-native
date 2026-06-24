# Task: Wire ProofPix to the FixPrompt LogHub broker

## Why

ProofPix mobile is shipping to TestFlight + App Store with thousands of users on the horizon. We need server-side observability so:
- Errors and tagged warnings stream to Grafana Loki in real time
- We can query device logs without asking users to AirDrop a JSON file
- At scale, only error/anomaly traffic hits the wire (no per-user activity logs)

The existing implementation in [src/services/errorLogger.js](../src/services/errorLogger.js) already filters by tag (so only `[PhotoContext]`, `[CRM]`, `[ADMIN]`, etc. console.warn/error calls route through), but it posts to a **stale broker endpoint** — every fetch has been 404'ing for ≥7 days. Zero `proofpix-native` logs have ever landed in Loki.

## What's broken

In `src/services/errorLogger.js:16-40` the `sendToLogHub()` function does:

```js
fetch(`${LOGHUB_URL}/ingest`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-ingest-key': LOGHUB_KEY,         // ← wrong header name
  },
  body: JSON.stringify({ service: 'proofpix-native', ... }),
}).catch(() => {});                      // ← failure silently swallowed
```

The current broker (NestJS, source at `C:\Users\HP\Desktop\Projects\Active\Development\FixPrompt\broker\`) exposes:

- `POST /ingest/log` (NOT `/ingest`)
- Required headers: `x-loghub-source: <slug>-prod` AND `x-loghub-key: <real key>` (NOT `x-ingest-key`)
- Each `source` must be pre-registered in the broker's `api_keys` table

The legacy keys (`RAILWAY_INGEST_KEY_123`) belonged to the old loghub. The new broker uses per-source SHA-256 hashed keys created at project registration time.

## Verified facts

- Broker base URL: `https://geosloghub-production.up.railway.app`
- `/health` returns `200 {ok: true, db: 'ok'}` — broker is alive
- `/ingest` returns `404` — confirmed dead
- Current `service_name` labels in Loki (last 7 days): `hiringflow`, `leadbridge-api`, `service-flow-backend`, `sigcore-api`, `twilio-webhook` — no ProofPix
- ProofPix Loki query returns empty for any time window — never received a single log
- The broker's `ProjectsController` (broker/src/projects/projects.controller.ts) exposes `POST /projects` for registering new sources

## Steps to implement

### 1. Register `proofpix-native` as a project on the broker

The broker's `POST /projects` is gated by `InternalAuthGuard`, requires `x-internal-admin-token` header matching `INTERNAL_ADMIN_TOKEN` env var on the broker's Railway deploy.

Fetch the admin token from Railway:

```bash
RAILWAY_TOKEN=$(aws secretsmanager get-secret-value --secret-id geos-dashboard-tokens --region us-east-1 \
  --query 'SecretString' --output text | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).RAILWAY_TOKEN))")

# Loghub broker service id — find via Railway graphql or dashboard.
# Service name on Railway: geosloghub-production
# Query env vars from the service to get INTERNAL_ADMIN_TOKEN

curl -s "https://backboard.railway.com/graphql/v2" \
  -H "Authorization: Bearer $RAILWAY_TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query { service(id: \"<SERVICE_ID>\") { serviceInstances { edges { node { environmentVariables } } } } }"}'
```

If the env var isn't in Railway, check the FixPrompt broker repo for a default or generate one and set it on Railway.

Then register the project:

```bash
ADMIN_TOKEN="<from-Railway>"
curl -s -X POST "https://geosloghub-production.up.railway.app/projects" \
  -H "x-internal-admin-token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ProofPix Native",
    "slug": "proofpix-native",
    "project_type": "mobile"
  }'
```

Response shape (from `broker/src/projects/projects.service.ts:31-36`):

```json
{
  "project_id": "uuid",
  "environment_id": "uuid",
  "source": "proofpix-native-prod",
  "key": "k_<48hex>"
}
```

**Save the `key` immediately** — it's not retrievable later (only the SHA-256 hash is stored).

### 2. Update `errorLogger.js` to use the correct endpoint + headers

Replace the `sendToLogHub` function:

```js
const LOGHUB_URL = process.env.EXPO_PUBLIC_LOGHUB_URL || 'https://geosloghub-production.up.railway.app';
const LOGHUB_SOURCE = process.env.EXPO_PUBLIC_LOGHUB_SOURCE || 'proofpix-native-prod';
const LOGHUB_KEY = process.env.EXPO_PUBLIC_LOGHUB_KEY || '';
const APP_VERSION = Constants?.expoConfig?.version || 'unknown';

const sendToLogHub = async (level, message, extra = {}) => {
  if (!LOGHUB_KEY) return;  // no key configured — skip silently
  try {
    fetch(`${LOGHUB_URL}/ingest/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-loghub-source': LOGHUB_SOURCE,
        'x-loghub-key': LOGHUB_KEY,
      },
      body: JSON.stringify({
        // Payload shape: check broker/src/ingest/ingest.service.ts for the
        // exact field names. Known optional fields: request_id, lead_id,
        // callSid, messageSid, user_id, phone_hash.
        level,
        message,
        attrs: {
          app: 'proofpix',
          env: __DEV__ ? 'dev' : 'prod',
          platform: Platform.OS,
          app_version: APP_VERSION,
          ...extra,
        },
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch (_) {}
};
```

The broker's `IngestService.ingestLog()` (see `broker/src/ingest/ingest.service.ts`) is the source of truth for the payload contract — adapt the body shape to whatever it expects (might need `attrs` vs flat fields, might need `stack` separately, etc.). Run a curl test against the broker after registering to confirm the contract before editing the RN code.

### 3. Add the new env vars to `eas.json`

For each build profile that ships to a real device (`testflight`, `production`, `production-apk`), add:

```json
"EXPO_PUBLIC_LOGHUB_URL": "https://geosloghub-production.up.railway.app",
"EXPO_PUBLIC_LOGHUB_SOURCE": "proofpix-native-prod",
"EXPO_PUBLIC_LOGHUB_KEY": "k_<paste-the-real-key>"
```

The `production` profile already has `EXPO_PUBLIC_LOGHUB_URL` + `EXPO_PUBLIC_LOGHUB_KEY` — update those to the new key, add `EXPO_PUBLIC_LOGHUB_SOURCE`. The `testflight` profile needs all three added.

### 4. Test end-to-end before merging

```bash
# 1. Curl test the broker with the new credentials
curl -X POST "https://geosloghub-production.up.railway.app/ingest/log" \
  -H "Content-Type: application/json" \
  -H "x-loghub-source: proofpix-native-prod" \
  -H "x-loghub-key: <real-key>" \
  -d '{"level":"warn","message":"manual test from claude","attrs":{"app":"proofpix"},"timestamp":"2026-06-23T22:00:00.000Z"}'

# Expected: 200 or 202 with {ok: true, id: <uuid>, forwarded: true/false}

# 2. Query Loki immediately to confirm it landed
TOKEN=$(aws secretsmanager get-secret-value --secret-id geos-dashboard-tokens --region us-east-1 \
  --query 'SecretString' --output text | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).GRAFANA_SA_TOKEN))")
curl -s "https://info3d7b.grafana.net/api/org" -H "Authorization: Bearer $TOKEN"  # wake instance
curl -s -G "https://info3d7b.grafana.net/api/datasources/proxy/7/loki/api/v1/query_range" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'query={service_name="proofpix-native-prod"}' \
  --data-urlencode 'limit=10' \
  --data-urlencode 'direction=backward'
```

If the curl test passes and Loki shows the row, the RN code change will work.

### 5. Push as OTA (no rebuild needed)

```bash
git commit -am "fix(logging): switch errorLogger to new LogHub broker contract"
npx eas update --branch development --message "fix(logging): wire LogHub broker" --non-interactive
npx eas update --branch production  --message "fix(logging): wire LogHub broker" --non-interactive
```

Per memory `feedback_ota_push_both_channels.md`: always push JS-only fixes to BOTH channels so build 77 (production) AND build 78 (development) get it.

## Acceptance

1. Curl with `x-loghub-source: proofpix-native-prod` + valid key returns 200/202 on `/ingest/log`.
2. Loki query `{service_name="proofpix-native-prod"}` shows logs within 30 seconds of the curl.
3. After OTA push + cold-start on TestFlight phone, real-time logs flow to Loki — verify by triggering any tagged warn (e.g. switching screens generates `[PhotoContext]` logs) and seeing them in Loki within 10s.
4. Pre-existing local AsyncStorage logging continues to work — local error log export still functions for offline diagnostics.

## At scale (thousands of users)

The current capture list at [errorLogger.js:235-253](../src/services/errorLogger.js#L235-L253) is already filter-first: only console calls whose first arg matches one of the regex prefixes (`[IAP`, `[ADMIN`, `[PROXY`, `[CRM`, `[ServiceFlow`, etc.) hit `logError()` and `sendToLogHub()`. Untagged `console.log` is never captured.

So volume is bounded by tagged-warn frequency, not user count. To tighten further for production:

- Drop `console.warn` capture and keep only `console.error` for prod builds (gate the `patchConsole` call on `__DEV__` or a runtime flag).
- Add a sampler to `sendToLogHub` (e.g., always send level=error, sample warn at 10%).
- Have errorLogger batch multiple events into a single broker call to reduce request count.

These are post-launch optimizations — wire the basic pipeline first.

## Reference

- Broker source: `C:\Users\HP\Desktop\Projects\Active\Development\FixPrompt\broker\`
- Broker routes: `broker/src/ingest/ingest.controller.ts`, `broker/src/projects/projects.controller.ts`
- Auth contract: `broker/src/common/auth.guard.ts`
- Ingest payload validation: `broker/src/ingest/ingest.service.ts`
- Grafana Cloud Loki: `https://info3d7b.grafana.net` (stack `info3d7b`)
- Loki Datasource ID: `7` (per CLAUDE.md `GRAFANA_LOKI_PROXY_ID`)
- Memory: `feedback_ota_push_both_channels.md`, `project_proofpix_context.md`

## Not in scope

- Rebranding (the broker is being renamed from "loghub" → "fixprompt" per `Active\Development\FixPrompt\PLAN_FINAL.md`; the `x-loghub-*` headers are legacy aliases. Use the legacy header names today, plan to swap when broker rebrand cuts over).
- Migrating to `@geos/loghub-client` package — the inline fetch in errorLogger.js works fine once the contract is right; adding a native dep would require a new binary build.
- Server-side dashboards in Grafana — first prove logs land in Loki, then build dashboards.

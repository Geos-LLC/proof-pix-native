# Task: Wire ProofPix to the FixPrompt LogHub broker (client side)

## Why

ProofPix mobile is shipping to TestFlight + App Store with thousands of users on the horizon. We need server-side observability so:
- Errors and tagged warnings stream to Grafana Loki in real time
- We can query device logs without asking users to AirDrop a JSON file
- At scale, only error/anomaly traffic hits the wire (no per-user activity logs)

The existing implementation in [src/services/errorLogger.js](../src/services/errorLogger.js) already filters by tag (so only `[PhotoContext]`, `[CRM]`, `[ADMIN]`, etc. console.warn/error calls route through), but it posts to a **stale broker endpoint** — every fetch has been 404'ing for ≥7 days. Zero `proofpix-native` logs have ever landed in Loki.

## Server-side onboarding — already separated out

This task is **client-side only**. It assumes the FixPrompt broker has already registered `proofpix-native` and produced a `(source, key)` pair. That step is a broker-side concern owned by the FixPrompt repo — see `Active\Development\FixPrompt\ONBOARDING.md` for the registration template.

**Before starting this task**, obtain:

| Value | Example |
|---|---|
| `source` | `proofpix-native-prod` |
| `key`    | `k_<48hex>` |

If those don't exist yet, run the FixPrompt onboarding doc first, then come back here.

## What's broken on the client

In [src/services/errorLogger.js:16-40](../src/services/errorLogger.js#L16-L40) the `sendToLogHub()` function does:

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

The current broker expects:

- `POST /ingest/log` (NOT `/ingest`)
- Required headers: `x-loghub-source: <source>` AND `x-loghub-key: <key>` (NOT `x-ingest-key`)
- Source must already be registered (handled by the FixPrompt onboarding step)

`/ingest` returns `404`. Confirmed via `curl` against `https://geosloghub-production.up.railway.app/ingest`. `/health` returns 200 so the broker itself is alive — it's the path + headers that drifted.

The body shape the broker accepts is defined in `Active\Development\FixPrompt\broker\src\ingest\ingest.service.ts` — verify against that file before editing the RN code.

## Steps

### 1. Update `errorLogger.js` to use the correct endpoint + headers

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

The broker's `IngestService.ingestLog()` (see `broker/src/ingest/ingest.service.ts` in the FixPrompt repo) is the source of truth for the payload contract — adapt the body shape to whatever it expects (might need `attrs` vs flat fields, might need `stack` separately, etc.). Run a curl test against the broker after registering to confirm the contract before editing the RN code.

### 2. Add the new env vars to `eas.json`

For each build profile that ships to a real device (`testflight`, `production`, `production-apk`), add:

```json
"EXPO_PUBLIC_LOGHUB_URL": "https://geosloghub-production.up.railway.app",
"EXPO_PUBLIC_LOGHUB_SOURCE": "proofpix-native-prod",
"EXPO_PUBLIC_LOGHUB_KEY": "k_<paste-the-real-key>"
```

The `production` profile already has `EXPO_PUBLIC_LOGHUB_URL` + `EXPO_PUBLIC_LOGHUB_KEY` — update those to the new key, add `EXPO_PUBLIC_LOGHUB_SOURCE`. The `testflight` profile needs all three added.

Do **not** commit the real key. Per memory `feedback_bash_permissions.md` and CLAUDE.md, EAS env vars live in `eas.json` which is checked in, so production keys belong in EAS Cloud env vars instead — set them via `eas env:create production EXPO_PUBLIC_LOGHUB_KEY <value>` and let the build resolve from there. Use the inline `env` block only for non-secret values like the URL.

### 3. Smoke test before pushing OTA

Curl test the broker with the issued credentials (use the test path from `FixPrompt/ONBOARDING.md` step "verify end-to-end"). If that round-trip succeeds and Grafana shows the test row, the RN code change will work.

### 4. Push as OTA (no rebuild needed)

```bash
git commit -am "fix(logging): switch errorLogger to new LogHub broker contract"
npx eas update --branch development --message "fix(logging): wire LogHub broker" --non-interactive
npx eas update --branch production  --message "fix(logging): wire LogHub broker" --non-interactive
```

Per memory `feedback_ota_push_both_channels.md`: always push JS-only fixes to BOTH channels so build 77 (production) AND build 78 (development) get it.

## Acceptance

1. ProofPix on TestFlight cold-starts and within ~30 seconds, `{service_name="proofpix-native-prod"}` shows the bundle startup log entries (`[BUNDLE]`, `[Analytics] app_open`) in Loki.
2. Triggering any tagged warn on the device (e.g. switching screens generates `[PhotoContext]` logs) appears in Loki within 10 seconds.
3. Pre-existing local AsyncStorage logging continues to work — the local error log export still functions for offline diagnostics.

## At scale (thousands of users)

The current capture list at [errorLogger.js:235-253](../src/services/errorLogger.js#L235-L253) is already filter-first: only console calls whose first arg matches one of the regex prefixes (`[IAP`, `[ADMIN`, `[PROXY`, `[CRM`, `[ServiceFlow`, etc.) hit `logError()` and `sendToLogHub()`. Untagged `console.log` is never captured.

So volume is bounded by tagged-warn frequency, not user count. To tighten further for production:

- Drop `console.warn` capture and keep only `console.error` for prod builds (gate the `patchConsole` call on `__DEV__` or a runtime flag).
- Add a sampler to `sendToLogHub` (e.g., always send level=error, sample warn at 10%).
- Have errorLogger batch multiple events into a single broker call to reduce request count.

These are post-launch optimizations — wire the basic pipeline first.

## Reference

- Broker source: `C:\Users\HP\Desktop\Projects\Active\Development\FixPrompt\broker\`
- Onboarding template (server side): `Active\Development\FixPrompt\ONBOARDING.md`
- Grafana Cloud Loki: `https://info3d7b.grafana.net` (stack `info3d7b`)
- Loki Datasource ID: `7` (per CLAUDE.md `GRAFANA_LOKI_PROXY_ID`)
- Memory: `feedback_ota_push_both_channels.md`, `project_proofpix_context.md`

## Not in scope

- Registering `proofpix-native` on the broker — handled in the FixPrompt onboarding doc.
- Migrating to `@geos/loghub-client` package — the inline fetch in errorLogger.js works fine once the contract is right; adding a native dep would require a new binary build.
- Server-side dashboards in Grafana — first prove logs land in Loki, then build dashboards.

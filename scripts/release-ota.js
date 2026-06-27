#!/usr/bin/env node
// Wraps `eas update` + `@fixprompt/cli deploy-start` into one command.
// Cross-platform replacement for a bash one-liner — npm config vars
// don't expand under cmd.exe on Windows.
//
// Usage:
//   npm run release:ota --branch=production --message="..."
//   npm run release:ota --branch=development --message="..."
//
// Strict failure handling:
// - Pre-flight probes broker auth with the resolved key. Aborts before
//   `eas update` if 401/network failure — no point shipping a bundle the
//   devices can't authenticate with.
// - Post-flight captures @fixprompt/cli output and exits non-zero on any
//   "✗" / "401" / "Unauthorized" pattern. The CLI itself sometimes exits
//   0 on HTTP failure; our parser catches it.

const { spawnSync, execSync } = require('node:child_process');
const https = require('node:https');

const branch = process.env.npm_config_branch;
const message = process.env.npm_config_message;

if (!branch) {
  console.error('Usage: npm run release:ota --branch=<production|development> --message="..."');
  process.exit(1);
}

// Branch -> EAS environment mapping (see memory feedback_eas_update_environment.md):
// development branch ships dev-client + TestFlight binaries which build under
// the `preview` EAS env, so its env vars live there.
const ENV_BY_BRANCH = { production: 'production', preview: 'preview', development: 'preview' };
const environment = ENV_BY_BRANCH[branch] ?? branch;

const LOGHUB_URL = 'https://geosloghub-production.up.railway.app';
const LOGHUB_SOURCE = 'proofpix-native-prod';

const fail = (msg) => { console.error(`\n✗ release:ota — ${msg}\n`); process.exit(1); };

// On Windows we need shell:true to resolve npx.cmd; the shell then re-splits
// args on whitespace, so wrap each arg in double-quotes (escape any internal
// quotes) to keep multi-word args intact.
const quoteForShell = (a) => `"${String(a).replace(/"/g, '\\"')}"`;

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`);
  const useShell = process.platform === 'win32';
  const finalArgs = useShell ? args.map(quoteForShell) : args;
  const r = spawnSync(cmd, finalArgs, { stdio: 'inherit', shell: useShell, ...opts });
  if (r.status !== 0) fail(`${cmd} exited ${r.status}`);
};

// Same as run() but captures stdout/stderr so we can parse for failure
// indicators that the called process may not surface as a non-zero exit.
const runCapture = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`);
  const useShell = process.platform === 'win32';
  const finalArgs = useShell ? args.map(quoteForShell) : args;
  const r = spawnSync(cmd, finalArgs, {
    encoding: 'utf8', shell: useShell, ...opts,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  return { status: r.status ?? 1, out };
};

// Two auth paths:
//   A) Deploy-token mode (preferred): $FIXPROMPT_DEPLOY_TOKEN (fpd_…). Pre-flight
//      uses key-less GET /ingest/probe. Deploy marker uses CLI --deploy-token.
//      The runtime k_… SDK key NEVER needs to leave EAS — it's only used by
//      devices at runtime, not by the deploy script.
//   B) Runtime-key mode (legacy): $LOGHUB_KEY / $EXPO_PUBLIC_FIXPROMPT_KEY.
//      Requires the key in shell env because EAS type=secret won't reveal it
//      to `eas env:list`. Kept for backward compat with old release flows.
const deployToken = process.env.FIXPROMPT_DEPLOY_TOKEN || null;
let fixpromptKey = deployToken ? null : (process.env.LOGHUB_KEY || process.env.EXPO_PUBLIC_FIXPROMPT_KEY || null);

if (!deployToken && !fixpromptKey) {
  // Try EAS as last resort for the legacy path. Won't reveal type=secret values.
  try {
    const out = execSync(
      `npx eas env:list ${environment} --include-sensitive --format short`,
      { encoding: 'utf8', shell: true },
    );
    const line = out.split('\n').find((l) => l.startsWith('EXPO_PUBLIC_FIXPROMPT_KEY='));
    const raw = line?.slice('EXPO_PUBLIC_FIXPROMPT_KEY='.length).trim();
    if (raw && !raw.startsWith('*****') && !raw.startsWith('(')) fixpromptKey = raw;
  } catch (e) { /* fall through to error */ }
}

if (!deployToken && !fixpromptKey) {
  fail(
    `Could not resolve auth for FixPrompt.\n` +
    `   Recommended (works without copy-pasting the runtime key):\n` +
    `     1. Mint a deploy token: https://fixprompt-dashboard.vercel.app → Integrations → Deploy tokens\n` +
    `     2. Store it: export FIXPROMPT_DEPLOY_TOKEN=fpd_...\n` +
    `        (or 'eas env:create' as plain — fpd_ tokens are deploy-only, safe to expose to CI)\n` +
    `   Legacy fallback:\n` +
    `     export LOGHUB_KEY=k_...  (the runtime SDK key — EAS type=secret hides this)`,
  );
}

// PRE-FLIGHT: deploy-token mode uses GET /ingest/probe (no auth, just confirms
// the source slug is registered). Runtime-key mode POSTs a real event to
// /ingest/log to validate auth end-to-end. Both abort the release if the
// broker doesn't accept the request.
const probeBrokerDeployToken = () => new Promise((resolve) => {
  const url = new URL(`${LOGHUB_URL}/ingest/probe?source=${encodeURIComponent(LOGHUB_SOURCE)}`);
  const req = https.request({
    method: 'GET',
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    timeout: 10_000,
  }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', (err) => resolve(`error: ${err.message}`));
  req.on('timeout', () => { req.destroy(); resolve('timeout'); });
  req.end();
});

const probeBrokerKey = () => new Promise((resolve) => {
  const url = new URL(`${LOGHUB_URL}/ingest/log`);
  const req = https.request(
    {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'x-loghub-source': LOGHUB_SOURCE,
        'x-loghub-key': fixpromptKey,
      },
      timeout: 10_000,
    },
    (res) => { res.resume(); resolve(res.statusCode); },
  );
  req.on('error', (err) => resolve(`error: ${err.message}`));
  req.on('timeout', () => { req.destroy(); resolve('timeout'); });
  req.write(JSON.stringify({
    level: 'info',
    service: 'proofpix-native',
    message: 'release:ota pre-flight',
    attrs: { kind: 'release.preflight' },
  }));
  req.end();
});

const probeBroker = () => deployToken ? probeBrokerDeployToken() : probeBrokerKey();

(async () => {
  // PRE-FLIGHT: probe the broker with the key we're about to bundle.
  // If auth is broken right now, abort before publishing a useless bundle.
  // Uses Node's https module to avoid cross-platform shell-quoting issues
  // with curl on Windows cmd.exe vs Git Bash.
  const mode = deployToken ? 'deploy-token' : 'runtime-key';
  console.log(`\n• Pre-flight (${mode}): probing broker for source=${LOGHUB_SOURCE}…`);
  const probeStatus = await probeBroker();
  if (probeStatus !== 200) {
    const cause = deployToken
      ? `Likely cause: source slug '${LOGHUB_SOURCE}' isn't registered on the broker, or broker is unreachable.`
      : `Likely cause: the key in EAS doesn't match the broker's current api_keys row.`;
    const fix = deployToken
      ? `Fix: confirm LOGHUB_SOURCE matches a slug shown in https://fixprompt-dashboard.vercel.app, or check broker status.`
      : `Fix: rotate from dashboard, then \`eas env:update ${environment} EXPO_PUBLIC_FIXPROMPT_KEY <new>\`.`;
    fail(`broker pre-flight returned ${probeStatus} — aborting before OTA.\n` +
         `   ${cause}\n` +
         `   ${fix}`);
  }
  console.log(`  ✓ broker accepts the request (200)\n`);

  const updateMessage = message || `OTA release on ${branch}`;

  // STEP 1 — eas update (inherits stdio so the user sees progress)
  run('npx', [
    'eas', 'update',
    '--branch', branch,
    '--environment', environment,
    '--message', updateMessage,
    '--non-interactive',
  ]);

  // STEP 2 — deploy marker (captures output, parses for silent failures)
  const cliEnv = deployToken
    ? { ...process.env, LOGHUB_SOURCE, FIXPROMPT_DEPLOY_TOKEN: deployToken }
    : { ...process.env, LOGHUB_SOURCE, LOGHUB_KEY: fixpromptKey };
  const marker = runCapture(
    'npx',
    ['--yes', '@fixprompt/cli', 'deploy-start', '--status', 'success', '--branch', branch],
    { env: cliEnv },
  );
  const failureSignals = /\b(401|403|4\d\d|5\d\d|Unauthorized|Forbidden|Invalid key|Invalid deploy token|✗)\b/i;
  if (marker.status !== 0 || failureSignals.test(marker.out)) {
    const rerunCmd = deployToken
      ? `LOGHUB_SOURCE=${LOGHUB_SOURCE} FIXPROMPT_DEPLOY_TOKEN=fpd_... npx --yes @fixprompt/cli deploy-start --status success --branch ${branch}`
      : `LOGHUB_SOURCE=${LOGHUB_SOURCE} LOGHUB_KEY=... npx --yes @fixprompt/cli deploy-start --status success --branch ${branch}`;
    fail(
      `deploy-start reported failure (exit=${marker.status}).\n` +
      `   The OTA published, but the FixPrompt deploy marker did not.\n` +
      `   Dashboard's "Latest deploy" pill will still point at the previous release.\n` +
      `   Investigate, then re-fire manually:\n` +
      `     ${rerunCmd}`,
    );
  }

  console.log(`\n✓ Released to ${branch} (env=${environment}) and marked deploy in FixPrompt.`);
})();

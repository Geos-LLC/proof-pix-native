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

// Resolve key in this order:
//   1. process.env.LOGHUB_KEY (explicit shell override)
//   2. process.env.EXPO_PUBLIC_FIXPROMPT_KEY (same, alt name)
//   3. EAS env:list (only works if the var is type=sensitive; type=secret
//      values come back masked from the CLI)
let fixpromptKey = process.env.LOGHUB_KEY || process.env.EXPO_PUBLIC_FIXPROMPT_KEY || null;
if (!fixpromptKey) {
  try {
    const out = execSync(
      `npx eas env:list ${environment} --include-sensitive --format short`,
      { encoding: 'utf8', shell: true },
    );
    const line = out.split('\n').find((l) => l.startsWith('EXPO_PUBLIC_FIXPROMPT_KEY='));
    const raw = line?.slice('EXPO_PUBLIC_FIXPROMPT_KEY='.length).trim();
    // EAS returns "*****" or "(This is a secret env variable...)" when the
    // value is type=secret — reject those, force the user to provide it.
    if (raw && !raw.startsWith('*****') && !raw.startsWith('(')) fixpromptKey = raw;
  } catch (e) {
    // Don't fail yet — let the explicit missing-key check below print a
    // more useful error.
  }
}
if (!fixpromptKey) {
  fail(
    `Could not resolve FIXPROMPT_KEY.\n` +
    `   The EAS env ${environment} probably stores it as type=secret (CLI can't read).\n` +
    `   Export it once in your shell:\n` +
    `     export LOGHUB_KEY=k_...\n` +
    `   Or rotate from the FixPrompt dashboard and capture the new value.`,
  );
}

// PRE-FLIGHT: probe the broker with the key we're about to bundle.
// If auth is broken right now, abort before publishing a useless bundle.
console.log(`\n• Pre-flight: probing broker auth for source=${LOGHUB_SOURCE}…`);
try {
  const probe = execSync(
    `curl -s -o /dev/null -w "%{http_code}" -X POST ${LOGHUB_URL}/ingest/log ` +
    `-H "Content-Type: application/json" ` +
    `-H "x-loghub-source: ${LOGHUB_SOURCE}" ` +
    `-H "x-loghub-key: ${fixpromptKey}" ` +
    `-d "{\\"level\\":\\"info\\",\\"service\\":\\"proofpix-native\\",\\"message\\":\\"release:ota pre-flight\\"}"`,
    { encoding: 'utf8', shell: true, timeout: 15_000 },
  ).trim();
  if (probe !== '200') {
    fail(`broker pre-flight returned HTTP ${probe} — aborting before OTA.\n` +
         `   This means the bundle would 401 against the broker for every event.\n` +
         `   Likely cause: the key in EAS doesn't match the broker's current api_keys row.\n` +
         `   Fix: rotate from dashboard, then \`eas env:update ${environment} EXPO_PUBLIC_FIXPROMPT_KEY <new>\`.`);
  }
  console.log(`  ✓ broker accepts the resolved key (200)\n`);
} catch (e) {
  fail(`broker pre-flight failed: ${e.message}`);
}

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
const marker = runCapture(
  'npx',
  ['--yes', '@fixprompt/cli', 'deploy-start', '--status', 'success', '--branch', branch],
  { env: { ...process.env, LOGHUB_SOURCE, LOGHUB_KEY: fixpromptKey } },
);
const failureSignals = /\b(401|403|4\d\d|5\d\d|Unauthorized|Forbidden|Invalid key|error|✗)\b/i;
if (marker.status !== 0 || failureSignals.test(marker.out)) {
  fail(
    `deploy-start reported failure (exit=${marker.status}).\n` +
    `   The OTA published, but the FixPrompt deploy marker did not.\n` +
    `   Dashboard's "Latest deploy" pill will still point at the previous release.\n` +
    `   Investigate, then re-fire manually:\n` +
    `     LOGHUB_SOURCE=${LOGHUB_SOURCE} LOGHUB_KEY=... npx --yes @fixprompt/cli deploy-start --status success --branch ${branch}`,
  );
}

console.log(`\n✓ Released to ${branch} (env=${environment}) and marked deploy in FixPrompt.`);

#!/usr/bin/env node
// Wraps `eas update` + `@fixprompt/cli deploy-start` into one command.
// Cross-platform replacement for a bash one-liner — npm config vars
// don't expand under cmd.exe on Windows.
//
// Usage:
//   npm run release:ota --branch=production --message="..."
//   npm run release:ota --branch=development --message="..."

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

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Pull FIXPROMPT_KEY from EAS Cloud so devs don't have to keep it in their
// shell. The source is the constant from eas.json.
let fixpromptKey;
try {
  const out = execSync(
    `npx eas env:list ${environment} --include-sensitive --format short`,
    { encoding: 'utf8', shell: true },
  );
  const line = out.split('\n').find((l) => l.startsWith('EXPO_PUBLIC_FIXPROMPT_KEY='));
  fixpromptKey = line?.slice('EXPO_PUBLIC_FIXPROMPT_KEY='.length).trim();
} catch (e) {
  console.error(`Could not read EXPO_PUBLIC_FIXPROMPT_KEY from EAS env ${environment}: ${e.message}`);
  process.exit(1);
}
if (!fixpromptKey) {
  console.error(`EXPO_PUBLIC_FIXPROMPT_KEY not set in EAS env ${environment}.`);
  process.exit(1);
}

const updateMessage = message || `OTA release on ${branch}`;

run('npx', [
  'eas', 'update',
  '--branch', branch,
  '--environment', environment,
  '--message', updateMessage,
  '--non-interactive',
]);

run(
  'npx',
  ['--yes', '@fixprompt/cli', 'deploy-start', '--status', 'success', '--branch', branch],
  { env: { ...process.env, LOGHUB_SOURCE: 'proofpix-native-prod', LOGHUB_KEY: fixpromptKey } },
);

console.log(`\n✓ Released to ${branch} (env=${environment}) and marked deploy in FixPrompt.`);

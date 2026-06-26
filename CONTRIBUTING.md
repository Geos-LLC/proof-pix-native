# Contributing to ProofPix Native

## Shipping an OTA update

Every OTA push should also mark a deploy in FixPrompt so the dashboard's Overview tab shows "Latest deploy: {sha} on {branch} — {time ago}" and the Deployments tab populates. The `release:ota` script does both in one command.

### Production (App Store + production-apk binaries)

```bash
npm run release:ota --branch=production --message="<commit subject>"
```

### Development channel (dev-client + TestFlight binaries)

```bash
npm run release:ota --branch=development --message="<commit subject>"
```

### What it does

1. Runs `eas update --branch <branch> --environment <env>` with the right environment mapping (development branch → preview EAS env; everything else → same-named env). The mapping is enforced because EAS Cloud env vars (like `EXPO_PUBLIC_FIXPROMPT_KEY`) only live in `production` and `preview` envs.
2. Pulls `EXPO_PUBLIC_FIXPROMPT_KEY` from EAS Cloud automatically — no need to keep it in your local shell.
3. Runs `npx @fixprompt/cli deploy-start --status success --branch <branch>`. The CLI auto-detects commit SHA + commit subject from `git`. The deploy marker links the FixPrompt dashboard issue feed to your release.

### Push to both channels (the usual flow)

JS-only fixes should land on both channels in the same flow (build 77 production binary + earlier dev-client / TestFlight builds):

```bash
npm run release:ota --branch=development --message="fix: ..."
npm run release:ota --branch=production  --message="fix: ..."
```

Run them sequentially, not in parallel — two concurrent `eas update` runs race on `dist/` and the second one fails with `EPERM rmdir` on Windows.

## Shipping a binary build

Binary builds (`eas build`) consume EAS quota, take ~25 min, and produce an IPA/AAB that ships to TestFlight / Play Store. Don't run them casually.

After build + submit:

```bash
# iOS, production profile, auto-submit to App Store Connect
npm run build:ios:production -- --auto-submit
```

Manually mark the deploy after submit completes (the binary marker for path 2 is not yet wired into CI — see "Deploy markers from CI" below):

```bash
LOGHUB_SOURCE=proofpix-native-prod \
LOGHUB_KEY=$(npx eas env:list production --include-sensitive --format short | grep ^EXPO_PUBLIC_FIXPROMPT_KEY= | cut -d= -f2) \
  npx @fixprompt/cli deploy-start --status success --branch=production
```

## Deploy markers from CI

Currently `.github/workflows/claude.yml` is the only GitHub Actions workflow and it doesn't call `eas build`. If/when a build workflow lands, append a step like:

```yaml
- name: Mark deploy in FixPrompt
  env:
    LOGHUB_SOURCE: proofpix-native-prod
    LOGHUB_KEY: ${{ secrets.FIXPROMPT_KEY }}
  run: |
    npx --yes @fixprompt/cli deploy-start \
      --status success \
      --commit-sha "$GITHUB_SHA" \
      --branch "$GITHUB_REF_NAME"
```

The `FIXPROMPT_KEY` GitHub secret is already set on the repo.

## Verifying logs land in FixPrompt

```
# Grafana (browser):
https://info3d7b.grafana.net → Explore → Loki → {service_name="proofpix-native"}

# Or curl:
TOKEN=$(aws secretsmanager get-secret-value --secret-id geos-dashboard-tokens --region us-east-1 \
  --query 'SecretString' --output text \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).GRAFANA_SA_TOKEN))")
curl -s -G "https://info3d7b.grafana.net/api/datasources/proxy/7/loki/api/v1/query_range" \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode 'query={service_name="proofpix-native"}' \
  --data-urlencode 'limit=20'
```

Useful filters once events flow:

```
{service_name="proofpix-native"} |= "[CRM]"                          # filter by tag prefix
{service_name="proofpix-native"} | json | level="error"              # errors only
{service_name="proofpix-native"} | json | attr_app_version="1.7.7"   # filter by app version
{service_name="proofpix-native"} | json | attr_ota_channel="production"
```

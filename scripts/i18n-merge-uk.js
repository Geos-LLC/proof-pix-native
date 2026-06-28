// Deep-merge i18n-additions-uk.json into src/i18n/locales/uk.json. Existing
// keys win (we do NOT overwrite) so re-running is idempotent. Pass an alternate
// target file as argv[2] if needed.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || path.join(ROOT, 'src/i18n/locales/uk.json');
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-additions-uk.json'), 'utf8'));
const existing = JSON.parse(fs.readFileSync(target, 'utf8'));

let added = 0;
let skipped = 0;

function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!into[k] || typeof into[k] !== 'object') into[k] = {};
      merge(into[k], v);
    } else {
      if (!(k in into)) {
        into[k] = v;
        added++;
      } else {
        skipped++;
      }
    }
  }
}

merge(existing, additions);

fs.writeFileSync(target, JSON.stringify(existing, null, 2) + '\n');
console.log(`Merged additions into ${path.basename(target)} — added ${added} new key(s), skipped ${skipped} existing key(s).`);

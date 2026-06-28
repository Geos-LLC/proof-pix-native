// Deep-merge i18n-additions-pt.json into src/i18n/locales/pt.json. Existing
// keys win (we do NOT overwrite) so re-running is idempotent.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const target = path.join(ROOT, 'src/i18n/locales/pt.json');
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-additions-pt.json'), 'utf8'));
const existing = JSON.parse(fs.readFileSync(target, 'utf8'));

let added = 0;
let skipped = 0;

function merge(into, from, pathPrefix = '') {
  for (const [k, v] of Object.entries(from)) {
    const keyPath = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!into[k] || typeof into[k] !== 'object') into[k] = {};
      merge(into[k], v, keyPath);
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
console.log(`Merged additions into ${path.basename(target)}`);
console.log(`  Added: ${added} new key(s)`);
console.log(`  Skipped (already present): ${skipped} key(s)`);

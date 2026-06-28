// Deep-merge i18n-additions.json into a target locale file. Existing keys win
// (we do NOT overwrite) so re-running is idempotent. Pass the target file as
// argv[2]; defaults to en.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const target = process.argv[2] || path.join(ROOT, 'src/i18n/locales/en.json');
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-additions.json'), 'utf8'));
const existing = JSON.parse(fs.readFileSync(target, 'utf8'));

function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!into[k] || typeof into[k] !== 'object') into[k] = {};
      merge(into[k], v);
    } else {
      if (!(k in into)) into[k] = v;
    }
  }
}

merge(existing, additions);

fs.writeFileSync(target, JSON.stringify(existing, null, 2) + '\n');
console.log(`Merged additions into ${path.basename(target)}`);

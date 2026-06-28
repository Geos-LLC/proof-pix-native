// One-shot helper: extract every t('key', { defaultValue: '...' }) pair from
// src/screens and src/components, then diff against en.json to print only the
// keys we still need to add. Output is JSON ready to merge into a locale file.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIRS = [path.join(ROOT, 'src/screens'), path.join(ROOT, 'src/components')];

function walk(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') || f.endsWith('.jsx'))
    .map(f => path.join(dir, f));
}

const files = SRC_DIRS.flatMap(walk);

// Match t('key.path', { ..., defaultValue: '...' })
// Supports single-quoted, double-quoted, and template-literal defaultValues.
// Greedy enough to handle multi-line option objects but stops at the closing }.
const STR = /defaultValue\s*:\s*('((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/;

function extract(src) {
  const out = {};
  // Find every t('foo.bar', { ... })
  const re = /\bt\(\s*['"`]([\w.\-]+)['"`]\s*,\s*\{([\s\S]{0,400}?)\}\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const key = m[1];
    const opts = m[2];
    const dv = opts.match(STR);
    if (!dv) continue;
    const val = (dv[2] ?? dv[3] ?? dv[4] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (!out[key]) out[key] = val;
  }
  return out;
}

const all = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  Object.assign(all, extract(src));
}

const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/locales/en.json'), 'utf8'));

function get(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o && k in o) ? o[k] : undefined, obj);
}

const missing = {};
for (const [k, v] of Object.entries(all).sort()) {
  if (get(en, k) === undefined) missing[k] = v;
}

console.log(`Total t(key,{defaultValue}) pairs found: ${Object.keys(all).length}`);
console.log(`Missing from en.json: ${Object.keys(missing).length}`);
console.log('---');
console.log(JSON.stringify(missing, null, 2));

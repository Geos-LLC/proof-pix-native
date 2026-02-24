const en = require('../src/i18n/locales/en.json');

function getKeys(obj, prefix) {
  prefix = prefix || '';
  let keys = [];
  for (const key in obj) {
    const fullKey = prefix ? prefix + '.' + key : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      keys = keys.concat(getKeys(obj[key], fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getValue(obj, keyPath) {
  const parts = keyPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function setValue(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

const enKeys = getKeys(en);
const locales = ['ar','es','fr','de','ru','be','uk','zh','tl','ko','pt','vi'];

for (const loc of locales) {
  const data = require('../src/i18n/locales/' + loc + '.json');
  const localeKeys = new Set(getKeys(data));
  const missing = enKeys.filter(k => !localeKeys.has(k));

  console.log(`\n${loc}: ${missing.length} missing keys`);
  if (missing.length > 0) {
    // Group by section
    const sections = {};
    for (const key of missing) {
      const section = key.split('.')[0];
      if (!sections[section]) sections[section] = [];
      sections[section].push(key);
    }
    for (const [section, keys] of Object.entries(sections)) {
      console.log(`  ${section}: ${keys.length} keys`);
    }
  }
}

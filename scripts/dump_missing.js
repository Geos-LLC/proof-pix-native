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

const allLocales = ['ar','es','fr','de','ru','be','uk','zh','tl','ko','pt','vi'];
const enKeys = getKeys(en);
const allMissing = new Set();

for (const loc of allLocales) {
  const data = require('../src/i18n/locales/' + loc + '.json');
  const localeKeys = new Set(getKeys(data));
  enKeys.filter(k => !localeKeys.has(k)).forEach(k => allMissing.add(k));
}

const sorted = [...allMissing].sort();
for (const key of sorted) {
  const val = getValue(en, key);
  console.log(key + ' = ' + JSON.stringify(val));
}

const fs = require("fs");
const path = require("path");

function setValue(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

const filePath = path.join(__dirname, "..", "src", "i18n", "locales", "fr.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

const translationsPath = path.join(__dirname, "fr_translations.json");
const translations = JSON.parse(fs.readFileSync(translationsPath, "utf8"));

for (const [key, value] of Object.entries(translations)) {
  setValue(data, key, value);
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "
");
console.log("Updated fr.json successfully with " + Object.keys(translations).length + " translations");
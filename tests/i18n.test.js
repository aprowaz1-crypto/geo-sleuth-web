// Static checks for the UA/EN dictionaries and their usage in the UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadDict() {
  const ctx = {
    window: {},
    navigator: { language: 'uk' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      documentElement: {},
      querySelectorAll: () => [],
      getElementById: () => null,
      dispatchEvent: () => {},
    },
    CustomEvent: function CustomEvent() {},
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/i18n.js'), 'utf8'), ctx);
  return ctx.window.GeoI18n.dict;
}

const dict = loadDict();
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const report = fs.readFileSync(path.join(ROOT, 'js/report.js'), 'utf8');

function collectUsedKeys() {
  const used = new Set();
  const sources = [html, app, report];
  for (const source of sources) {
    for (const m of source.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria)?="([A-Za-z0-9_]+)"/g)) used.add(m[1]);
  }
  // Keys selected dynamically from constant maps in app.js.
  const dynamic = [
    'wmoClear', 'wmoMainlyClear', 'wmoPartlyCloudy', 'wmoOvercast', 'wmoFog', 'wmoDrizzle',
    'wmoRain', 'wmoSnow', 'wmoShowers', 'wmoThunder', 'wmoUnknown',
    'moonNew', 'moonWaxingCrescent', 'moonFirstQuarter', 'moonWaxingGibbous',
    'moonFull', 'moonWaningGibbous', 'moonLastQuarter', 'moonWaningCrescent',
    'dirN', 'dirNE', 'dirE', 'dirSE', 'dirS', 'dirSW', 'dirW', 'dirNW',
    'orientationNormal', 'orientationRotated', 'orientationMirrored',
    'flashFired', 'flashNo',
    'cluesPhone', 'cluesEmail', 'cluesUrl', 'cluesCoords', 'cluesAddress',
    'cluesDate', 'cluesPlate', 'cluesNumber', 'cluesName', 'cluesHandle', 'cluesHashtag',
    'reverseGoogleLens', 'reverseGoogleImages', 'reverseYandex', 'reverseBaidu',
    'reverseTinEye', 'reverseBing', 'reverseSauceNAO', 'reverseKarma',
    'layerDark', 'layerOsm', 'layerSatellite', 'layerTopo',
  ];
  dynamic.forEach((key) => used.add(key));
  return used;
}

const used = collectUsedKeys();

test('every used i18n key exists in both languages', () => {
  const missingUk = [...used].filter((key) => !(key in dict.uk)).sort();
  const missingEn = [...used].filter((key) => !(key in dict.en)).sort();
  assert.deepEqual(missingUk, [], `missing in uk: ${missingUk.join(', ')}`);
  assert.deepEqual(missingEn, [], `missing in en: ${missingEn.join(', ')}`);
});

test('uk and en dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(dict.uk).sort(), Object.keys(dict.en).sort());
});

test('no empty translations', () => {
  for (const lang of ['uk', 'en']) {
    for (const [key, value] of Object.entries(dict[lang])) {
      assert.equal(typeof value, 'string', `${lang}.${key} must be a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
    }
  }
});

test('placeholders match between languages', () => {
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of Object.keys(dict.uk)) {
    assert.deepEqual(
      placeholders(dict.uk[key]),
      placeholders(dict.en[key]),
      `placeholder mismatch for ${key}`
    );
  }
});

test('sunNoExactTime exists and mentions the assumed time', () => {
  assert.match(dict.uk.sunNoExactTime, /12:00/);
  assert.match(dict.en.sunNoExactTime, /12:00/);
});

test('keys used without variables contain no placeholders', () => {
  const offenders = new Set();
  for (const source of [app, report]) {
    for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_]+)'\s*\)/g)) {
      const key = match[1];
      const value = dict.uk[key] || dict.en[key];
      if (value && /\{\w+\}/.test(value)) offenders.add(key);
    }
  }
  assert.deepEqual([...offenders].sort(), []);
});

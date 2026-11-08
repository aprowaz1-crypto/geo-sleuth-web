// EXIF parser checks against a real JPEG with GPS + camera metadata.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/exif.js'), 'utf8'), ctx);
const GeoExif = ctx.window.GeoExif;

const photo = fs.readFileSync(path.join(__dirname, 'fixtures/gps-photo.jpg'));
const minimal = fs.readFileSync(path.join(__dirname, 'fixtures/gps.jpg'));

test('parses GPS from a JPEG produced by a normal camera pipeline', () => {
  const raw = GeoExif.parseExif(photo);
  assert.ok(Math.abs(raw.lat - 50.0833333) < 1e-5, `lat was ${raw.lat}`);
  assert.ok(Math.abs(raw.lon - 14.4166667) < 1e-5, `lon was ${raw.lon}`);
  assert.equal(raw.alt, 200);
  assert.equal(raw.heading, 135);
  assert.equal(raw.gpsAccuracy, 8);
});

test('parses camera and capture-time tags', () => {
  const raw = GeoExif.parseExif(photo);
  assert.equal(raw.make, 'Geo-Sleuth');
  assert.equal(raw.model, 'Test Camera');
  assert.equal(raw.dateTimeOriginal, '2024:06:20 15:30:00');
  assert.equal(raw.offsetTimeOriginal, '+02:00');
  assert.equal(raw.iso, 100);
  assert.ok(Math.abs(raw.fNumber - 2.8) < 1e-9);
  assert.equal(raw.lensModel, 'Test 35mm f/2.8');
});

test('parses a minimal EXIF-only JPEG', () => {
  const raw = GeoExif.parseExif(minimal);
  assert.ok(Math.abs(raw.lat - 50.0833333) < 1e-5);
  assert.ok(Math.abs(raw.lon - 14.4166667) < 1e-5);
});

test('DMS conversion respects hemispheres', () => {
  assert.equal(GeoExif.dmsToDecimal([50, 30, 0], 'N'), 50.5);
  assert.equal(GeoExif.dmsToDecimal([50, 30, 0], 'S'), -50.5);
  assert.equal(GeoExif.dmsToDecimal([30, 15, 36], 'E'), 30.26);
  assert.equal(GeoExif.dmsToDecimal([30, 15, 36], 'W'), -30.26);
});

test('returns an empty object for a non-EXIF buffer', () => {
  const raw = GeoExif.parseExif(Buffer.from('not an image at all'));
  assert.equal(Object.keys(raw).length, 0);
});

test('exposes a version marker', () => {
  assert.equal(typeof GeoExif.version, 'string');
  assert.match(GeoExif.version, /^\d+\.\d+\.\d+$/);
});

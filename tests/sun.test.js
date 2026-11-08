// Sanity checks for the solar, lunar and geodesic math.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sun.js'), 'utf8'), ctx);
const Sun = ctx.window.GeoSun;

const KYIV = { lat: 50.4501, lon: 30.5234 };

test('sun is high over Kyiv at summer solstice noon', () => {
  const date = new Date('2024-06-20T09:57:00Z');
  const pos = Sun.solarPosition(KYIV.lat, KYIV.lon, date);
  assert.ok(pos.elevation > 61 && pos.elevation < 64, `elevation ${pos.elevation}`);
  assert.ok(pos.azimuth > 170 && pos.azimuth < 190, `azimuth ${pos.azimuth}`);
  assert.ok(pos.declination > 23 && pos.declination < 23.5);
});

test('Kyiv day length is ~16.5 h at the summer solstice', () => {
  const events = Sun.dayEvents(KYIV.lat, KYIV.lon, new Date('2024-06-20T12:00:00Z'), 180);
  assert.ok(events.sunrise && Number.isFinite(events.sunrise.getTime()));
  assert.ok(events.sunset && Number.isFinite(events.sunset.getTime()));
  assert.ok(events.sunset.getTime() > events.sunrise.getTime());
  const hours = events.dayLengthMs / 3600000;
  assert.ok(hours > 16 && hours < 17, `day length ${hours}`);
  assert.ok(events.solarNoon && Number.isFinite(events.solarNoon.getTime()));
});

test('polar day and polar night are detected', () => {
  const summer = Sun.dayEvents(80, 20, new Date('2024-06-21T12:00:00Z'), 0);
  const winter = Sun.dayEvents(80, 20, new Date('2024-12-21T12:00:00Z'), 0);
  assert.equal(summer.polar, 'day');
  assert.equal(winter.polar, 'night');
});

test('shadow points opposite the sun', () => {
  assert.equal(Sun.shadowBearing(0), 180);
  assert.equal(Sun.shadowBearing(90), 270);
  assert.equal(Sun.shadowBearing(359), 179);
});

test('compass keys cover all eight directions', () => {
  assert.equal(Sun.compassKey(0), 'dirN');
  assert.equal(Sun.compassKey(45), 'dirNE');
  assert.equal(Sun.compassKey(90), 'dirE');
  assert.equal(Sun.compassKey(180), 'dirS');
  assert.equal(Sun.compassKey(270), 'dirW');
  assert.equal(Sun.compassKey(359), 'dirN');
});

test('EXIF UTC offsets parse correctly', () => {
  assert.equal(Sun.parseOffsetMinutes('+02:00'), 120);
  assert.equal(Sun.parseOffsetMinutes('-05:30'), -330);
  assert.equal(Sun.parseOffsetMinutes('+0200'), 120);
  assert.equal(Sun.parseOffsetMinutes('nope'), null);
});

test('new moon on 2024-04-08 is dark', () => {
  const moon = Sun.moonPhase(new Date('2024-04-08T18:21:00Z'));
  assert.ok(moon.illumination < 0.03, `illumination ${moon.illumination}`);
  assert.equal(moon.key, 'moonNew');
});

test('full moon on 2024-04-23 is bright', () => {
  const moon = Sun.moonPhase(new Date('2024-04-23T23:49:00Z'));
  assert.ok(moon.illumination > 0.97, `illumination ${moon.illumination}`);
  assert.equal(moon.key, 'moonFull');
});

test('Kyiv–Lviv distance is about 470 km', () => {
  const d = Sun.distanceMeters(KYIV.lat, KYIV.lon, 49.8397, 24.0297);
  assert.ok(d > 430000 && d < 500000, `distance ${d}`);
});

test('destination point one degree north is ~111 km away', () => {
  const p = Sun.destinationPoint(50, 30, 0, 111320);
  assert.ok(Math.abs(p.lat - 51) < 0.02, `lat ${p.lat}`);
  assert.ok(Math.abs(p.lon - 30) < 0.001, `lon ${p.lon}`);
});

test('sun path returns a full local day of samples', () => {
  const points = Sun.sunPath(KYIV.lat, KYIV.lon, new Date('2024-06-20T12:00:00Z'), 180, 10);
  assert.equal(points.length, 145);
  assert.ok(points.some((p) => p.alt > 0));
  assert.ok(points.some((p) => p.alt < 0));
});

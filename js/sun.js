// Solar geometry, sun path and moon phase — no dependencies.
// All dates are JS Date objects representing UTC instants.
(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const DAY_MS = 86400000;

  function toRad(d) { return d * RAD; }
  function toDeg(r) { return r * DEG; }

  function solarPosition(lat, lon, date) {
    const jd = date.getTime() / DAY_MS + 2440587.5;
    const T = (jd - 2451545.0) / 36525.0;
    const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    const M = ((357.52911 + T * (35999.05029 - 0.0001537 * T)) % 360 + 360) % 360;
    const Mr = toRad(M);
    const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(Mr)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * Mr)
      + 0.000289 * Math.sin(3 * Mr);
    const trueLon = L0 + C;
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLon - 0.00569 - 0.00478 * Math.sin(toRad(omega));
    const epsilon0 = 23.439291 - T * (0.0130042 + T * (0.000000164 - T * 0.000000504));
    const epsilon = epsilon0 + 0.00256 * Math.cos(toRad(omega));
    const sinEps = Math.sin(toRad(epsilon));
    const alpha = toDeg(Math.atan2(Math.cos(toRad(epsilon)) * Math.sin(toRad(lambda)), Math.cos(toRad(lambda))));
    const delta = toDeg(Math.asin(sinEps * Math.sin(toRad(lambda))));

    const theta0 = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    const lst = ((theta0 + lon) % 360 + 360) % 360;
    const ha = ((lst - alpha) % 360 + 360) % 360;
    const haR = toRad(ha < 180 ? ha : ha - 360);
    const latR = toRad(lat);
    const deltaR = toRad(delta);
    const sinAlt = Math.sin(latR) * Math.sin(deltaR) + Math.cos(latR) * Math.cos(deltaR) * Math.cos(haR);
    const alt = toDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
    const cosAz = (Math.sin(deltaR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * Math.cos(toRad(alt)) || 1e-9);
    let az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
    if (Math.sin(haR) > 0) az = 360 - az;
    return {
      azimuth: (az + 360) % 360,
      elevation: alt,
      declination: delta,
      rightAscension: alpha,
    };
  }

  function shadowBearing(azimuth) {
    return (azimuth + 180) % 360;
  }

  function compassKey(az) {
    const keys = ['dirN', 'dirNE', 'dirE', 'dirSE', 'dirS', 'dirSW', 'dirW', 'dirNW'];
    return keys[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  }

  function parseOffsetMinutes(offset) {
    if (typeof offset !== 'string') return null;
    const m = offset.trim().match(/^([+-])(\d{1,2}):?(\d{2})?$/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
  }

  function localDayStartUTC(dateUTC, tzOffsetMinutes) {
    const local = new Date(dateUTC.getTime() + tzOffsetMinutes * 60000);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - tzOffsetMinutes * 60000;
  }

  function dayEvents(lat, lon, dateUTC, tzOffsetMinutes) {
    const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0;
    const start = localDayStartUTC(dateUTC, offset);
    const step = 2 * 60000;
    const samples = [];
    for (let ts = start; ts <= start + DAY_MS; ts += step) {
      const p = solarPosition(lat, lon, new Date(ts));
      samples.push({ ts, alt: p.elevation, az: p.azimuth });
    }

    function crossing(threshold, rising) {
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];
        const fa = a.alt - threshold;
        const fb = b.alt - threshold;
        if (fa === 0) return new Date(a.ts);
        if (fa * fb <= 0) {
          const isRising = b.alt > a.alt;
          if (rising !== isRising) continue;
          const f = fa === fb ? 0 : (threshold - a.alt) / (b.alt - a.alt);
          return new Date(a.ts + f * (b.ts - a.ts));
        }
      }
      return null;
    }

    // solar noon: refine the maximum sample parabolically
    let maxIndex = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i].alt > samples[maxIndex].alt) maxIndex = i;
    let solarNoon = new Date(samples[maxIndex].ts);
    let maxElevation = samples[maxIndex].alt;
    if (maxIndex > 0 && maxIndex < samples.length - 1) {
      const y0 = samples[maxIndex - 1].alt;
      const y1 = samples[maxIndex].alt;
      const y2 = samples[maxIndex + 1].alt;
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-9) {
        const delta = 0.5 * (y0 - y2) / denom;
        if (Math.abs(delta) <= 1) {
          const ts = samples[maxIndex].ts + delta * step;
          const p = solarPosition(lat, lon, new Date(ts));
          solarNoon = new Date(ts);
          maxElevation = p.elevation;
        }
      }
    }

    const sunrise = crossing(-0.833, true);
    const sunset = crossing(-0.833, false);
    const goldenMorningEnd = crossing(6, true);
    const goldenEveningStart = crossing(6, false);
    const civilDawn = crossing(-6, true);
    const civilDusk = crossing(-6, false);
    const nauticalDawn = crossing(-12, true);
    const nauticalDusk = crossing(-12, false);
    const astroDawn = crossing(-18, true);
    const astroDusk = crossing(-18, false);

    const dayLengthMs = sunrise && sunset && sunset > sunrise ? sunset.getTime() - sunrise.getTime() : null;
    const polar = !sunrise && !sunset ? (maxElevation > 0 ? 'day' : 'night') : null;

    return {
      startUTC: new Date(start),
      sunrise, sunset,
      goldenMorningEnd, goldenEveningStart,
      civilDawn, civilDusk,
      nauticalDawn, nauticalDusk,
      astroDawn, astroDusk,
      solarNoon, maxElevation, dayLengthMs, polar,
      samples,
    };
  }

  function sunPath(lat, lon, dateUTC, tzOffsetMinutes, stepMinutes) {
    const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0;
    const start = localDayStartUTC(dateUTC, offset);
    const step = (stepMinutes || 10) * 60000;
    const points = [];
    for (let ts = start; ts <= start + DAY_MS; ts += step) {
      const p = solarPosition(lat, lon, new Date(ts));
      points.push({ ts: new Date(ts), az: p.azimuth, alt: p.elevation });
    }
    return points;
  }

  function moonPhase(date) {
    const synodic = 29.530588853;
    const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
    let phase = ((date.getTime() - knownNewMoon) / DAY_MS / synodic) % 1;
    if (phase < 0) phase += 1;
    const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    const idx = Math.round(phase * 8) % 8;
    const keys = ['moonNew', 'moonWaxingCrescent', 'moonFirstQuarter', 'moonWaxingGibbous', 'moonFull', 'moonWaningGibbous', 'moonLastQuarter', 'moonWaningCrescent'];
    return { phase, illumination, key: keys[idx], waxing: phase < 0.5 };
  }

  function destinationPoint(lat, lon, bearingDeg, distanceM) {
    const R = 6371000;
    const brng = toRad(bearingDeg);
    const lat1 = toRad(lat);
    const lon1 = toRad(lon);
    const d = distanceM / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  global.GeoSun = {
    solarPosition, shadowBearing, compassKey, parseOffsetMinutes,
    dayEvents, sunPath, moonPhase, destinationPoint, distanceMeters,
    toRad, toDeg,
  };
})(window);

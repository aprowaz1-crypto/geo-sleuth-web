// Solar position (NOAA simplified). Returns {azimuth, elevation} in degrees.
// azimuth: 0=N, 90=E, 180=S, 270=W. elevation: degrees above horizon.
(function (global) {
  'use strict';
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function solarPosition(lat, lon, date) {
    // date: JS Date (UTC)
    const jd = date.getTime() / 86400000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525.0;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = (357.52911 + T * (35999.05029 - T * 0.0001537)) % 360;
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
    const delta = toDeg(Math.asin(Math.sin(toRad(epsilon)) * Math.sin(toRad(lambda))));
    // hour angle
    const theta0 = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    const lst = (theta0 + lon) % 360;
    const ha = (lst - alpha + 360) % 360;
    const haR = toRad(ha < 180 ? ha : ha - 360);
    const latR = toRad(lat);
    const deltaR = toRad(delta);
    const sinAlt = Math.sin(latR) * Math.sin(deltaR) + Math.cos(latR) * Math.cos(deltaR) * Math.cos(haR);
    const alt = toDeg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
    const cosAz = (Math.sin(deltaR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * Math.cos(toRad(alt)));
    let az = toDeg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
    if (Math.sin(haR) > 0) az = 360 - az;
    return { azimuth: az, elevation: alt, declination: delta, rightAscension: alpha };
  }

  function shadowBearing(azimuth) {
    // shadow points opposite to sun: bearing = azimuth + 180
    return (azimuth + 180) % 360;
  }

  global.GeoSun = { solarPosition, shadowBearing, toRad, toDeg };
})(window);

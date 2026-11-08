// Report builder + download helper for Geo-Sleuth Web.
(function (global) {
  'use strict';

  function t(key, vars) {
    return global.GeoI18n ? global.GeoI18n.t(key, vars) : key;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtCoord(v, axis) {
    if (!Number.isFinite(v)) return '—';
    const hemi = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
    const abs = Math.abs(v);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    return `${abs.toFixed(6)}° ${hemi} (${deg}° ${pad(min)}′ ${sec.toFixed(1)}″)`;
  }

  function fmtOffset(min) {
    if (!Number.isFinite(min)) return '—';
    const sign = min >= 0 ? '+' : '-';
    const abs = Math.abs(min);
    return t('utcOffset', { sign, h: Math.floor(abs / 60), m: pad(abs % 60) });
  }

  function fmtDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    const min = Math.round(ms / 60000);
    return `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
  }

  function fmtDate(date) {
    if (!date) return '—';
    try { return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch (e) { return '—'; }
  }

  function mdTable(rows) {
    const body = rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '');
    if (!body.length) return '';
    return ['| Field | Value |', '| --- | --- |']
      .concat(body.map((r) => `| ${String(r[0]).replace(/\|/g, '\\|')} | ${String(r[1]).replace(/\|/g, '\\|')} |`))
      .join('\n');
  }

  function buildMarkdown(model) {
    if (!model) return '';
    const lines = [];
    const exif = model.exif || {};
    lines.push('# Geo-Sleuth Web — location report');
    lines.push('');
    lines.push(`Generated: ${model.generatedAt || new Date().toISOString()}`);
    if (model.app && model.app.url) lines.push(`Tool: ${model.app.url}`);
    lines.push('');

    lines.push('## File');
    lines.push('');
    lines.push(mdTable([
      ['Name', model.file && model.file.name],
      ['Size', model.file && model.file.sizeLabel],
      ['Type', model.file && model.file.type],
      ['Last modified', model.file && model.file.lastModified],
    ]));
    lines.push('');

    lines.push('## Coordinates');
    lines.push('');
    if (Number.isFinite(model.coords && model.coords.lat)) {
      lines.push(mdTable([
        [t('labelLatitude'), fmtCoord(model.coords.lat, 'lat')],
        [t('labelLongitude'), fmtCoord(model.coords.lon, 'lon')],
        [t('labelCoords'), `${model.coords.lat.toFixed(6)}, ${model.coords.lon.toFixed(6)}`],
        [t('labelGpsAccuracy'), Number.isFinite(model.coords.accuracy) ? `${Math.round(model.coords.accuracy)} m` : ''],
        [t('labelAltitude'), Number.isFinite(model.coords.alt) ? `${model.coords.alt.toFixed(1)} m` : ''],
        [t('labelUtcOffset'), fmtOffset(model.tz && model.tz.offsetMin)],
        [t('labelTimezone'), model.tz && model.tz.name],
        [t('labelLocalTimeAtPhoto'), model.photoLocal],
        [t('utcTime'), model.photoUTC],
      ]));
    } else {
      lines.push('_No GPS coordinates in EXIF._');
    }
    lines.push('');

    if (model.address && model.address.displayName) {
      lines.push('## Address');
      lines.push('');
      lines.push(model.address.displayName);
      lines.push('');
    }

    lines.push('## EXIF');
    lines.push('');
    const exifRows = [
      [t('labelMake'), exif.make],
      [t('labelModel'), exif.model],
      [t('labelLens'), exif.lens],
      [t('labelDateTime'), exif.dateTime],
      [t('labelSoftware'), exif.software],
      [t('labelDimensions'), exif.dimensions],
      [t('labelExposure'), exif.exposure],
      [t('labelFNumber'), exif.fNumber],
      [t('labelIso'), exif.iso],
      [t('labelFocalLength'), exif.focalLength],
      [t('labelOrientation'), exif.orientation],
      [t('labelGpsDirection'), exif.heading],
    ];
    const table = mdTable(exifRows);
    lines.push(table || '_No metadata._');
    lines.push('');

    if (model.sun) {
      lines.push('## Sun & shadows');
      lines.push('');
      const s = model.sun;
      lines.push(mdTable([
        [t('sunAzimuth'), Number.isFinite(s.azimuth) ? `${s.azimuth.toFixed(1)}° (${s.azimuthDir})` : ''],
        [t('sunElevation'), Number.isFinite(s.elevation) ? `${s.elevation.toFixed(1)}°` : ''],
        [t('sunShadow'), Number.isFinite(s.shadow) ? `${s.shadow.toFixed(1)}° (${s.shadowDir})` : ''],
        [t('solarNoon'), s.solarNoon],
        [t('sunrise'), s.sunrise],
        [t('sunset'), s.sunset],
        [t('goldenMorning'), s.goldenMorning],
        [t('goldenEvening'), s.goldenEvening],
        [t('dayLength'), s.dayLength],
        [t('sunMoon'), s.moon],
      ]));
      lines.push('');
    }

    if (model.weather) {
      lines.push('## Weather at capture time');
      lines.push('');
      const w = model.weather;
      lines.push(mdTable([
        [t('weatherAt'), w.hour],
        [t('weatherTemp'), w.temp],
        [t('weatherClouds'), w.cloud],
        [t('weatherPrecip'), w.precip],
        [t('weatherWind'), w.wind],
        [t('weatherCode'), w.condition],
        ['Source', w.source],
      ]));
      lines.push('');
    }

    if (model.wiki && model.wiki.length) {
      lines.push('## Nearby Wikipedia');
      lines.push('');
      model.wiki.forEach((w) => lines.push(`- [${w.title}](${w.url}) — ${w.distanceLabel}`));
      lines.push('');
    }

    if (model.osm && model.osm.length) {
      lines.push('## Nearby OSM features');
      lines.push('');
      model.osm.forEach((f) => lines.push(`- ${f.type}: ${f.name} — ${f.distanceLabel}`));
      lines.push('');
    }

    if (model.ocr && model.ocr.text) {
      lines.push('## OCR text');
      lines.push('');
      lines.push('```');
      lines.push(model.ocr.text);
      lines.push('```');
      lines.push('');
    }

    if (model.ocr && model.ocr.clues && model.ocr.clues.length) {
      lines.push('## Clues');
      lines.push('');
      model.ocr.clues.forEach((c) => lines.push(`- **${c.type}:** ${c.value}`));
      lines.push('');
    }

    if (model.links) {
      lines.push('## Links');
      lines.push('');
      Object.entries(model.links).forEach(([name, url]) => {
        if (url) lines.push(`- [${name}](${url})`);
      });
      lines.push('');
    }

    if (model.notes) {
      lines.push('## Notes');
      lines.push('');
      lines.push(model.notes);
      lines.push('');
    }

    lines.push('---');
    lines.push('Built with Geo-Sleuth Web (browser) + geo-sleuth skill (OpenCode).');
    return lines.join('\n');
  }

  function buildJson(model) {
    return JSON.stringify(model || {}, null, 2);
  }

  function buildText(model) {
    if (!model) return '';
    const out = [];
    if (Number.isFinite(model.coords && model.coords.lat)) {
      out.push(`${fmtCoord(model.coords.lat, 'lat')}, ${fmtCoord(model.coords.lon, 'lon')}`);
      out.push(`Coordinates: ${model.coords.lat.toFixed(6)}, ${model.coords.lon.toFixed(6)}`);
      if (model.address && model.address.displayName) out.push(model.address.displayName);
    } else {
      out.push('No GPS coordinates in EXIF');
    }
    if (model.sun) {
      out.push(`Sun: az ${model.sun.azimuth}°, elev ${model.sun.elevation}°, shadows → ${model.sun.shadowDir}`);
    }
    if (model.ocr && model.ocr.clues && model.ocr.clues.length) {
      out.push('Clues: ' + model.ocr.clues.map((c) => c.value).join(', '));
    }
    if (model.links && model.links.google) out.push(model.links.google);
    return out.join('\n');
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return filename;
  }

  global.GeoReport = { buildMarkdown, buildJson, buildText, download, fmtCoord, fmtOffset, fmtDuration, fmtDate };
})(window);

// Geo-Sleuth Web — main application.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => window.GeoI18n.t(key, vars);
  const FILE_LIMIT = 80 * 1024 * 1024;

  const state = {
    file: null,
    objectUrl: null,
    previewUrl: null,
    heicBlob: null,
    heicConverted: false,
    analysisId: 0,
    exifSource: 'none',
    rawExif: {},
    exif: {},
    lat: null,
    lon: null,
    heading: null,
    accuracy: null,
    photo: null,
    photoUTC: null,
    hasTime: false,
    tzOffsetMin: null,
    tzName: '',
    tzSource: '',
    geo: null,
    geoError: null,
    elevationApi: null,
    sunModel: null,
    weather: null,
    weatherError: null,
    wiki: [],
    wikiError: null,
    osm: [],
    osmError: null,
    ocr: { text: '', clues: [], lang: '' },
    mapReady: false,
  };

  // ---------------------------------------------------------------- helpers

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

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

  function fmtCoordPair(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '—';
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  }

  function prettyDate(value) {
    if (!value) return '';
    return String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  }

  function fmtShutter(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 1) return `${v.toFixed(1)} s`;
    return `1/${Math.round(1 / v)} s`;
  }

  function fmtOffset(minutes) {
    if (!Number.isFinite(minutes)) return '—';
    const sign = minutes >= 0 ? '+' : '-';
    const abs = Math.abs(minutes);
    return t('utcOffset', { sign, h: Math.floor(abs / 60), m: pad(abs % 60) });
  }

  function fmtDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    const total = Math.round(ms / 60000);
    return `${Math.floor(total / 60)} h ${pad(total % 60)} min`;
  }

  function errorLabel(err) {
    if (!err) return t('unknown');
    if (err.name === 'AbortError') return 'timeout';
    return err.message ? err.message : String(err);
  }

  function parseDateTimeParts(value) {
    if (!value) return null;
    const m = String(value).match(/(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return {
      y, mo, d,
      h: m[4] != null ? Number(m[4]) : 12,
      mi: m[5] != null ? Number(m[5]) : 0,
      s: m[6] != null ? Number(m[6]) : 0,
      hasTime: m[4] != null,
      raw: String(value),
    };
  }

  function tzOffsetForZone(tzName, date) {
    if (!tzName || !date) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(date);
      const map = {};
      parts.forEach((p) => { map[p.type] = p.value; });
      const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
      return Math.round((asUTC - date.getTime()) / 60000);
    } catch (e) {
      return null;
    }
  }

  function fmtClock(date) {
    if (!date) return '—';
    if (state.tzName) {
      try {
        return new Intl.DateTimeFormat(t('dateLocale'), {
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: state.tzName,
        }).format(date);
      } catch (e) { /* fall through */ }
    }
    const shifted = new Date(date.getTime() + (Number.isFinite(state.tzOffsetMin) ? state.tzOffsetMin : 0) * 60000);
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  }

  function fmtDateTime(date) {
    if (!date) return '—';
    if (state.tzName) {
      try {
        return new Intl.DateTimeFormat(t('dateLocale'), {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: state.tzName,
        }).format(date);
      } catch (e) { /* fall through */ }
    }
    const shifted = new Date(date.getTime() + (Number.isFinite(state.tzOffsetMin) ? state.tzOffsetMin : 0) * 60000);
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  }

  function photoLocalLabel() {
    if (!state.photo) return '';
    const p = state.photo;
    return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${p.hasTime ? '' : ' (date only)'}`;
  }

  function updatePhotoUTC() {
    if (!state.photo) { state.photoUTC = null; state.hasTime = false; return; }
    if (!Number.isFinite(state.tzOffsetMin)) state.tzOffsetMin = 0;
    const p = state.photo;
    state.hasTime = !!p.hasTime;
    state.photoUTC = new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - state.tzOffsetMin * 60000);
  }

  function sunDateRef() {
    if (state.photoUTC) return state.photoUTC;
    if (state.photo) {
      const p = state.photo;
      return new Date(Date.UTC(p.y, p.mo - 1, p.d, 12, 0, 0) - (state.tzOffsetMin || 0) * 60000);
    }
    return null;
  }

  function hasGps() {
    return Number.isFinite(state.lat) && Number.isFinite(state.lon);
  }

  function isImageFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    return /\.(jpe?g|png|webp|heic|heif|avif|tiff?)$/i.test(file.name || '');
  }

  function isHeicFile(file) {
    return !!file && (/heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || ''));
  }

  function kvRow(label, value, extraClass) {
    if (value === undefined || value === null || value === '') return '';
    return `<div class="kv-row${extraClass ? ' ' + extraClass : ''}"><span class="kv-label">${esc(label)}</span><span class="kv-value">${esc(value)}</span></div>`;
  }

  function kvRowHtml(label, htmlValue, extraClass) {
    if (htmlValue === undefined || htmlValue === null || htmlValue === '') return '';
    return `<div class="kv-row${extraClass ? ' ' + extraClass : ''}"><span class="kv-label">${esc(label)}</span><span class="kv-value">${htmlValue}</span></div>`;
  }

  function emptyBlock(text) {
    return `<div class="empty">${esc(text)}</div>`;
  }

  function loadingBlock(text) {
    return `<div class="empty loading"><span class="spinner"></span> ${esc(text)}</div>`;
  }

  function showFileError(message) {
    const el = $('fileError');
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
  }

  let toastTimer = null;
  function toast(message, kind) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function rawReplacer(key, value) {
    if (value && (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)) {
      const len = value.byteLength || value.length || 0;
      return `[binary ${len} bytes]`;
    }
    if (typeof value === 'string' && value.length > 600) return value.slice(0, 600) + '…';
    return value;
  }

  // ---------------------------------------------------------------- EXIF

  let exifrPromise = null;

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label || 'timeout')), ms);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
    });
  }

  function loadExifr() {
    if (window.exifr && typeof window.exifr.parse === 'function') return Promise.resolve(window.exifr);
    if (exifrPromise) return exifrPromise;
    exifrPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js';
      script.async = true;
      script.onload = () => resolve(window.exifr);
      script.onerror = () => reject(new Error('exifr load failed'));
      document.head.appendChild(script);
    });
    return exifrPromise;
  }

  async function readExif(file) {
    try {
      const exifr = await withTimeout(loadExifr(), 12000, 'exifr timeout');
      if (exifr && typeof exifr.parse === 'function') {
        const raw = await withTimeout(exifr.parse(file, {
          tiff: true, ifd0: true, exif: true, gps: true, interop: true,
          reviveValues: false, translateValues: false, sanitize: true, mergeOutput: true,
        }), 15000, 'exifr parse timeout');
        if (raw && Object.keys(raw).length) return { raw, source: 'exifr' };
      }
    } catch (e) {
      console.warn('exifr failed:', e);
    }
    try {
      const buffer = await file.arrayBuffer();
      const raw = window.GeoExif.parseExif(buffer);
      return { raw: raw || {}, source: Object.keys(raw || {}).length ? 'builtin' : 'none' };
    } catch (e) {
      console.warn('built-in EXIF failed:', e);
      return { raw: {}, source: 'none' };
    }
  }

  function normalizeExif(raw) {
    const e = raw || {};
    const first = (...keys) => {
      for (const key of keys) {
        const value = e[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return undefined;
    };
    const num = (value) => {
      if (Array.isArray(value)) value = value[0];
      if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const str = (value) => {
      if (value === undefined || value === null) return undefined;
      if (Array.isArray(value)) return value.join(', ').replace(/\0/g, '').trim() || undefined;
      return String(value).replace(/\0/g, '').trim() || undefined;
    };

    let lat = num(first('latitude', 'lat'));
    let lon = num(first('longitude', 'lon'));
    if (!Number.isFinite(lat) && e.GPSLatitude) lat = window.GeoExif.dmsToDecimal(e.GPSLatitude, e.GPSLatitudeRef || 'N');
    if (!Number.isFinite(lon) && e.GPSLongitude) lon = window.GeoExif.dmsToDecimal(e.GPSLongitude, e.GPSLongitudeRef || 'E');

    let alt;
    if (e.GPSAltitude !== undefined) {
      alt = num(e.GPSAltitude);
      if (e.GPSAltitudeRef === 1 || e.gpsAltitudeRef === 1) alt = -Math.abs(alt);
    } else {
      alt = num(first('alt', 'altitude'));
    }

    const dateRaw = first('DateTimeOriginal', 'dateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'DateTime', 'dateTime');
    let dateStr;
    if (dateRaw instanceof Date) {
      dateStr = `${dateRaw.getFullYear()}-${pad(dateRaw.getMonth() + 1)}-${pad(dateRaw.getDate())} ${pad(dateRaw.getHours())}:${pad(dateRaw.getMinutes())}:${pad(dateRaw.getSeconds())}`;
    } else {
      dateStr = str(dateRaw);
    }

    const offsetRaw = str(first('OffsetTimeOriginal', 'offsetTimeOriginal', 'OffsetTime', 'offsetTime', 'offsetTimeDigitized'));
    const offsetMin = window.GeoSun.parseOffsetMinutes(offsetRaw);

    let lens = str(first('LensModel', 'lensModel', 'Lens', 'lens'));
    if (!lens) {
      const spec = first('LensSpecification', 'lensSpecification');
      if (Array.isArray(spec) && spec.length >= 4) lens = `${spec[0]}-${spec[1]}mm f/${spec[2]}-${spec[3]}`;
    }
    if (!lens && e.lensSpec) lens = e.lensSpec;

    const width = num(first('ExifImageWidth', 'ImageWidth', 'pixelXDimension', 'imageWidth'));
    const height = num(first('ExifImageHeight', 'ImageHeight', 'pixelYDimension', 'imageHeight'));

    let gpsTime;
    const gpsTimeRaw = first('GPSTimeStamp', 'gpsTimeStamp', 'gpsTime');
    if (Array.isArray(gpsTimeRaw) && gpsTimeRaw.length >= 3) {
      gpsTime = `${pad(gpsTimeRaw[0])}:${pad(gpsTimeRaw[1])}:${pad(gpsTimeRaw[2])}`;
    } else {
      gpsTime = str(gpsTimeRaw);
    }

    const gpsDateRaw = first('GPSDateStamp', 'gpsDateStamp', 'gpsDate');
    const gpsDate = str(gpsDateRaw);

    return {
      lat, lon, alt,
      heading: num(first('GPSImgDirection', 'gpsImgDirection', 'heading')),
      accuracy: num(first('GPSHPositioningError', 'gpsHPositioningError', 'gpsAccuracy')),
      dateTimeOriginal: dateStr,
      dateTime: dateStr,
      offsetRaw,
      offsetMin,
      gpsDate,
      gpsTime,
      make: str(first('Make', 'make')),
      model: str(first('Model', 'model')),
      lens,
      software: str(first('Software', 'software')),
      artist: str(first('Artist', 'artist')),
      copyright: str(first('Copyright', 'copyright')),
      serial: str(first('SerialNumber', 'serialNumber', 'BodySerialNumber')),
      orientation: num(first('Orientation', 'orientation')),
      focalLength: num(first('FocalLength', 'focalLength')),
      focal35: num(first('FocalLengthIn35mmFormat', 'focalLength35mm', 'FocalLength35mm')),
      fNumber: num(first('FNumber', 'fNumber')),
      exposure: num(first('ExposureTime', 'exposureTime')),
      iso: num(first('ISO', 'iso', 'ISOSpeedRatings')),
      exposureBias: num(first('ExposureCompensation', 'exposureBias', 'ExposureBiasValue')),
      flash: num(first('Flash', 'flash')),
      colorSpace: num(first('ColorSpace', 'colorSpace')),
      whiteBalance: num(first('WhiteBalance', 'whiteBalance')),
      width, height,
      dimensions: width && height ? `${width} × ${height}` : undefined,
    };
  }

  // ---------------------------------------------------------------- theme / i18n

  function applyThemeIcon() {
    const theme = document.documentElement.dataset.theme || 'dark';
    const icon = $('themeIcon');
    if (icon) icon.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1020' : '#f4f7ff');
  }

  function initTheme() {
    applyThemeIcon();
    const btn = $('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('geoTheme', next); } catch (e) { /* ignore */ }
      applyThemeIcon();
      document.dispatchEvent(new CustomEvent('geo:themechange', { detail: { theme: next } }));
    });
  }

  function initLang() {
    window.GeoI18n.init();
    const btn = $('langBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        window.GeoI18n.setLang(window.GeoI18n.getLang() === 'uk' ? 'en' : 'uk');
      });
    }
  }

  // ---------------------------------------------------------------- preview / reset

  function cleanupUrls() {
    if (state.objectUrl) { try { URL.revokeObjectURL(state.objectUrl); } catch (e) { /* ignore */ } }
    if (state.previewUrl) { try { URL.revokeObjectURL(state.previewUrl); } catch (e) { /* ignore */ } }
    state.objectUrl = null;
    state.previewUrl = null;
  }

  function showPreview(url, file) {
    const img = $('preview');
    const wrap = $('previewWrap');
    const placeholder = wrap ? wrap.querySelector('.preview-placeholder') : null;
    if (!img || !wrap) return;
    img.style.display = 'block';
    if (placeholder) { placeholder.style.display = 'none'; placeholder.textContent = t('noPhoto'); }
    img.onerror = () => {
      img.style.display = 'none';
      if (placeholder) { placeholder.style.display = 'block'; placeholder.textContent = isHeicFile(file) ? 'HEIC' : t('noPhoto'); }
    };
    img.onload = () => {
      img.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    };
    img.src = url;
    wrap.classList.remove('empty');
    const name = $('fileName');
    const size = $('fileSize');
    if (name) name.textContent = file.name || 'photo';
    if (size) size.textContent = formatBytes(file.size);
  }

  function loadHeic2Any() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      script.async = true;
      script.onload = () => resolve(window.heic2any);
      script.onerror = () => reject(new Error('heic2any load failed'));
      document.head.appendChild(script);
    });
  }

  async function convertHeicPreview(file, id) {
    const verdict = $('verdict');
    if (verdict) verdict.innerHTML = `<div class="verdict info"><span class="spinner"></span> ${esc(t('heicConverting'))}</div>`;
    try {
      const heic2any = await loadHeic2Any();
      const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
      const blob = Array.isArray(result) ? result[0] : result;
      if (id !== state.analysisId) return null;
      state.heicBlob = blob;
      state.heicConverted = true;
      if (state.previewUrl) { try { URL.revokeObjectURL(state.previewUrl); } catch (e) { /* ignore */ } }
      state.previewUrl = URL.createObjectURL(blob);
      showPreview(state.previewUrl, file);
      return blob;
    } catch (e) {
      console.warn('HEIC conversion failed:', e);
      toast(t('heicFailed'), 'error');
      return null;
    }
  }

  function resetStateForFile() {
    state.heicBlob = null;
    state.heicConverted = false;
    state.exifSource = 'none';
    state.rawExif = {};
    state.exif = {};
    state.lat = null;
    state.lon = null;
    state.heading = null;
    state.accuracy = null;
    state.photo = null;
    state.photoUTC = null;
    state.hasTime = false;
    state.tzOffsetMin = null;
    state.tzName = '';
    state.tzSource = '';
    state.geo = null;
    state.geoError = null;
    state.elevationApi = null;
    state.sunModel = null;
    state.weather = null;
    state.weatherError = null;
    state.wiki = [];
    state.wikiError = null;
    state.osm = [];
    state.osmError = null;
    state.ocr = { text: '', clues: [], lang: '' };
    state.mapReady = false;
  }

  function resetPanels() {
    const verdict = $('verdict');
    if (verdict) verdict.innerHTML = `<div class="verdict info"><span class="spinner"></span> ${esc(t('exifrLoading'))}</div>`;
    const exifPanel = $('exifPanel');
    if (exifPanel) exifPanel.innerHTML = loadingBlock(t('loading'));
    const exifSource = $('exifSource');
    if (exifSource) { exifSource.hidden = true; exifSource.textContent = ''; }
    const rawDetails = $('rawDetails');
    if (rawDetails) rawDetails.hidden = true;
    const rawJson = $('rawJson');
    if (rawJson) rawJson.textContent = '';
    const quick = $('quickChips');
    if (quick) quick.innerHTML = '';
    ['mapCard', 'sunCard', 'locationCard', 'weatherCard', 'wikiCard', 'osmCard'].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
    const map = $('map');
    if (map) { map.innerHTML = ''; map.hidden = false; }
    const fallback = $('mapFallback');
    if (fallback) { fallback.hidden = true; fallback.innerHTML = ''; }
    const mapCoords = $('mapCoords');
    if (mapCoords) mapCoords.textContent = t('mapCoordsHint');
    if (window.GeoMapView) window.GeoMapView.destroy();
    const ocrOutput = $('ocrOutput');
    if (ocrOutput) ocrOutput.textContent = '';
    const ocrStatus = $('ocrStatus');
    if (ocrStatus) ocrStatus.textContent = t('ocrEmpty');
    const ocrProgress = $('ocrProgress');
    if (ocrProgress) { ocrProgress.hidden = true; ocrProgress.value = 0; }
    const clues = $('cluesPanel');
    if (clues) clues.innerHTML = emptyBlock(t('cluesEmpty'));
    const copyClues = $('copyClues');
    if (copyClues) copyClues.hidden = true;
    renderReverseLinks();
  }

  function resetAll() {
    state.analysisId += 1;
    cleanupUrls();
    if (window.GeoMapView) window.GeoMapView.destroy();
    state.file = null;
    resetStateForFile();
    const results = $('results');
    if (results) results.hidden = true;
    const input = $('fileInput');
    if (input) input.value = '';
    const err = $('fileError');
    if (err) { err.hidden = true; err.textContent = ''; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // ---------------------------------------------------------------- render: status / EXIF

  function renderVerdict() {
    const el = $('verdict');
    if (!el) return;
    if (!state.file) { el.innerHTML = ''; return; }
    const extra = state.heicConverted ? `<div class="verdict-extra">${esc(t('verdictHeic'))}</div>` : '';
    if (hasGps()) {
      el.innerHTML = `<div class="verdict good">
        <div class="verdict-head"><span class="verdict-dot" aria-hidden="true"></span>${esc(t('verdictGpsTitle'))}</div>
        <div>${esc(t('verdictGpsBody', { lat: state.lat.toFixed(5), lon: state.lon.toFixed(5) }))}</div>
        <div class="verdict-coords mono">${esc(fmtCoordPair(state.lat, state.lon))}</div>
        ${extra}
      </div>`;
    } else if (state.exifSource !== 'none') {
      el.innerHTML = `<div class="verdict warn">
        <div class="verdict-head"><span class="verdict-dot" aria-hidden="true"></span>${esc(t('verdictNoGpsTitle'))}</div>
        <div>${esc(t('verdictNoGpsBody'))}</div>
        ${extra}
      </div>`;
    } else {
      el.innerHTML = `<div class="verdict bad">
        <div class="verdict-head"><span class="verdict-dot" aria-hidden="true"></span>${esc(t('verdictNoExifTitle'))}</div>
        <div>${esc(t('verdictNoExifBody'))}</div>
        ${extra}
      </div>`;
    }
  }

  function orientationLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const key = (n === 2 || n === 4 || n === 5 || n === 7) ? 'orientationMirrored'
      : (n === 3 || n === 6 || n === 8) ? 'orientationRotated' : 'orientationNormal';
    return `${n} · ${t(key)}`;
  }

  function renderExif() {
    const panel = $('exifPanel');
    if (!panel) return;
    const e = state.exif || {};
    const rows = [];
    const add = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      rows.push(kvRow(label, value));
    };

    if (hasGps()) {
      add(t('labelLatitude'), fmtCoord(state.lat, 'lat'));
      add(t('labelLongitude'), fmtCoord(state.lon, 'lon'));
    }
    add(t('labelAltitude'), Number.isFinite(e.alt) ? `${e.alt.toFixed(1)} m` : '');
    add(t('labelGpsAccuracy'), Number.isFinite(e.accuracy) ? `±${Math.round(e.accuracy)} m` : '');
    add(t('labelGpsDirection'), Number.isFinite(e.heading) ? `${Math.round(e.heading)}° · ${t(window.GeoSun.compassKey(e.heading))}` : '');
    add(t('labelDateTime'), prettyDate(e.dateTimeOriginal));
    add(t('labelOffset'), e.offsetRaw ? `${e.offsetRaw}${Number.isFinite(e.offsetMin) ? ' · ' + fmtOffset(e.offsetMin) : ''}` : '');
    add(t('labelGpsDate'), prettyDate(e.gpsDate));
    add(t('labelGpsTime'), e.gpsTime);
    add(t('labelMake'), e.make);
    add(t('labelModel'), e.model);
    add(t('labelLens'), e.lens);
    add(t('labelFocalLength'), Number.isFinite(e.focalLength) ? `${e.focalLength} mm` : '');
    add(t('labelFocal35'), Number.isFinite(e.focal35) ? `${e.focal35} mm` : '');
    add(t('labelExposure'), fmtShutter(e.exposure));
    add(t('labelFNumber'), Number.isFinite(e.fNumber) && e.fNumber > 0 ? `f/${e.fNumber}` : '');
    add(t('labelIso'), Number.isFinite(e.iso) ? String(e.iso) : '');
    add(t('labelExposureBias'), Number.isFinite(e.exposureBias) ? `${e.exposureBias > 0 ? '+' : ''}${e.exposureBias} EV` : '');
    if (Number.isFinite(e.flash)) add(t('labelFlash'), e.flash & 1 ? t('flashFired') : t('flashNo'));
    add(t('labelOrientation'), orientationLabel(e.orientation));
    add(t('labelDimensions'), e.dimensions);
    add(t('labelColorSpace'), e.colorSpace === 1 ? 'sRGB' : e.colorSpace === 65535 ? 'Adobe RGB' : (Number.isFinite(e.colorSpace) ? String(e.colorSpace) : ''));
    add(t('labelWhiteBalance'), Number.isFinite(e.whiteBalance) ? (e.whiteBalance === 0 ? 'auto' : 'manual') : '');
    add(t('labelSoftware'), e.software);
    add(t('labelArtist'), e.artist);
    add(t('labelCopyright'), e.copyright);
    add(t('labelSerial'), e.serial);

    panel.innerHTML = rows.length ? rows.join('') : emptyBlock(t('exifNoData'));

    const source = $('exifSource');
    if (source) {
      if (state.exifSource === 'exifr') { source.hidden = false; source.textContent = t('exifSourceExifr'); }
      else if (state.exifSource === 'builtin') { source.hidden = false; source.textContent = t('exifSourceBuiltin'); }
      else { source.hidden = true; source.textContent = ''; }
    }
  }

  function renderRaw() {
    const details = $('rawDetails');
    const pre = $('rawJson');
    if (!details || !pre) return;
    const raw = state.rawExif || {};
    const keys = Object.keys(raw);
    if (!keys.length) {
      details.hidden = true;
      pre.textContent = '';
      return;
    }
    let text;
    try {
      text = JSON.stringify(raw, rawReplacer, 2);
    } catch (e) {
      text = String(raw);
    }
    if (text.length > 40000) text = text.slice(0, 40000) + '\n…';
    pre.textContent = text;
    details.hidden = false;
  }

  const CHIP_ICON = {
    clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.1"/><path d="M8 4.7V8l2.3 1.5"/></svg>',
    camera: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.2 5.2h2.2l1-1.8h5.2l1 1.8h2.2v7.2H2.2z"/><circle cx="8" cy="8.8" r="2.2"/></svg>',
    lens: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="2.1"/><path d="M8 1.1v1.5M8 13.4v1.5M1.1 8h1.5M13.4 8h1.5"/></svg>',
    pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 14.4s4.7-4.1 4.7-7.6a4.7 4.7 0 1 0-9.4 0C3.3 10.3 8 14.4 8 14.4Z"/><circle cx="8" cy="6.6" r="1.7"/></svg>',
    mountain: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.4 13 6 5.3l2.6 4.2 1.6-2.3 4.4 5.8z"/><circle cx="11.4" cy="3.5" r="1.2"/></svg>',
    compass: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><circle cx="8" cy="8" r="6.1"/><path d="m10.5 5.5-1.4 3.6-3.6 1.4 1.4-3.6z"/></svg>',
    target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="5.9"/><circle cx="8" cy="8" r="2"/><path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2"/></svg>',
  };

  function renderQuickChips() {
    const wrap = $('quickChips');
    if (!wrap) return;
    const e = state.exif || {};
    const chips = [];
    const add = (icon, text) => {
      if (!text) return;
      chips.push(`<span class="chip"><span class="chip-ico" aria-hidden="true">${CHIP_ICON[icon] || ''}</span>${esc(text)}</span>`);
    };
    add('clock', prettyDate(e.dateTimeOriginal));
    add('camera', [e.make, e.model].filter(Boolean).join(' '));
    add('lens', e.lens);
    if (hasGps()) add('pin', fmtCoordPair(state.lat, state.lon));
    add('mountain', Number.isFinite(e.alt) ? `${Math.round(e.alt)} m` : '');
    add('compass', Number.isFinite(e.heading) ? `${Math.round(e.heading)}°` : '');
    add('target', Number.isFinite(e.accuracy) ? `±${Math.round(e.accuracy)} m` : '');
    wrap.innerHTML = chips.join('');
  }

  // ---------------------------------------------------------------- render: map

  function renderMap() {
    const card = $('mapCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; if (window.GeoMapView) window.GeoMapView.destroy(); return; }
    card.hidden = false;

    const lat = state.lat;
    const lon = state.lon;
    const popup = `<strong>${esc(fmtCoordPair(lat, lon))}</strong><br>${esc(prettyDate(state.exif.dateTimeOriginal) || '')}`;
    const labels = {
      dark: t('layerDark'), osm: t('layerOsm'), satellite: t('layerSatellite'), topo: t('layerTopo'),
    };
    const ok = window.GeoMapView ? window.GeoMapView.init({
      container: 'map', lat, lon, heading: state.heading, accuracy: state.accuracy,
      theme: document.documentElement.dataset.theme, labels, popupHtml: popup,
      onMove: (ll) => {
        const el = $('mapCoords');
        if (!el) return;
        if (!ll) { el.textContent = t('mapCoordsHint'); return; }
        el.textContent = `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`;
      },
    }) : false;

    const mapEl = $('map');
    const fallback = $('mapFallback');
    if (ok && mapEl) {
      mapEl.hidden = false;
      state.mapReady = true;
      if (fallback) { fallback.hidden = true; fallback.innerHTML = ''; }
      setTimeout(() => { try { window.GeoMapView.invalidate(); } catch (e) { /* ignore */ } }, 120);
    } else {
      state.mapReady = false;
      if (mapEl) mapEl.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        const d = 0.012;
        const bbox = `${(lon - d).toFixed(6)},${(lat - d * 0.7).toFixed(6)},${(lon + d).toFixed(6)},${(lat + d * 0.7).toFixed(6)}`;
        fallback.innerHTML = `<p class="hint">${esc(t('mapLeafletFailed'))}</p>
          <iframe class="map-frame" loading="lazy" referrerpolicy="no-referrer" title="OpenStreetMap"
            src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&amp;layer=mapnik&amp;marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}"></iframe>`;
      }
    }

    const linkGoogle = $('linkGoogle');
    const linkOsm = $('linkOsm');
    const linkGeoHack = $('linkGeoHack');
    const linkApple = $('linkApple');
    const linkMapillary = $('linkMapillary');
    if (linkGoogle) linkGoogle.href = `https://www.google.com/maps?q=${lat},${lon}`;
    if (linkOsm) linkOsm.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
    if (linkGeoHack) linkGeoHack.href = `https://geohack.toolforge.org/geohack.php?params=${lat};${lon}`;
    if (linkApple) linkApple.href = `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
    if (linkMapillary) linkMapillary.href = `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17`;
    const coordsEl = $('mapCoords');
    if (coordsEl) coordsEl.textContent = t('mapCoordsHint');
  }

  // ---------------------------------------------------------------- render: sun

  function renderSun() {
    const card = $('sunCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; state.sunModel = null; return; }
    card.hidden = false;

    const details = $('sunDetails');
    const compass = $('sunCompass');
    const pathWrap = $('sunPathWrap');
    const pathEl = $('sunPath');
    const timesEl = $('sunTimes');
    const noteEl = $('sunNote');
    const badge = $('sunBadge');
    const dateRef = sunDateRef();

    if (!dateRef) {
      if (details) details.innerHTML = emptyBlock(t('sunNoTime'));
      if (compass) compass.innerHTML = '';
      if (pathWrap) pathWrap.hidden = true;
      if (timesEl) timesEl.innerHTML = '';
      if (noteEl) noteEl.textContent = '';
      if (badge) badge.hidden = true;
      state.sunModel = null;
      return;
    }

    const events = window.GeoSun.dayEvents(state.lat, state.lon, dateRef, Number.isFinite(state.tzOffsetMin) ? state.tzOffsetMin : 0);
    const pos = state.hasTime && state.photoUTC
      ? window.GeoSun.solarPosition(state.lat, state.lon, state.photoUTC)
      : null;
    const moon = window.GeoSun.moonPhase(dateRef);
    const shadow = pos ? window.GeoSun.shadowBearing(pos.azimuth) : null;
    const azDir = pos ? t(window.GeoSun.compassKey(pos.azimuth)) : '';
    const shDir = Number.isFinite(shadow) ? t(window.GeoSun.compassKey(shadow)) : '';

    if (badge) {
      badge.hidden = !state.photo;
      badge.textContent = state.photo ? `${state.photo.y}-${pad(state.photo.mo)}-${pad(state.photo.d)}` : '';
    }

    const rows = [];
    if (state.photo) rows.push(kvRow(t('labelLocalTimeAtPhoto'), photoLocalLabel()));
    if (state.photoUTC) rows.push(kvRow(t('labelUtcOffset'), `${fmtOffset(state.tzOffsetMin)}${state.tzName ? ' · ' + state.tzName : ''}`));
    if (pos) {
      rows.push(kvRow(t('sunAzimuth'), `${pos.azimuth.toFixed(1)}° · ${azDir}`));
      rows.push(kvRow(t('sunElevation'), `${pos.elevation.toFixed(1)}°`));
      rows.push(kvRow(t('sunShadow'), `${shadow.toFixed(1)}° · ${shDir}`));
      rows.push(kvRow(t('sunDeclination'), `${pos.declination.toFixed(2)}°`));
    }
    rows.push(kvRow(t('sunMoon'), `${t(moon.key)} · ${Math.round(moon.illumination * 100)}%`));
    if (details) details.innerHTML = rows.join('') || emptyBlock(t('sunNoTime'));

    if (compass) {
      compass.innerHTML = pos ? compassSvg(pos.azimuth, pos.elevation, shadow, state.heading) : '';
      compass.hidden = !pos;
    }

    if (pathEl && pathWrap) {
      const points = window.GeoSun.sunPath(state.lat, state.lon, dateRef, Number.isFinite(state.tzOffsetMin) ? state.tzOffsetMin : 0, 10);
      pathEl.innerHTML = sunPathSvg(points, pos);
      pathWrap.hidden = false;
    }

    if (timesEl) {
      const items = [
        [t('sunrise'), fmtClock(events.sunrise)],
        [t('sunset'), fmtClock(events.sunset)],
        [t('solarNoon'), fmtClock(events.solarNoon)],
        [t('goldenMorning'), fmtClock(events.goldenMorningEnd)],
        [t('goldenEvening'), fmtClock(events.goldenEveningStart)],
        [t('civilDawn'), fmtClock(events.civilDawn)],
        [t('civilDusk'), fmtClock(events.civilDusk)],
        [t('dayLength'), events.dayLengthMs ? fmtDuration(events.dayLengthMs) : '—'],
      ];
      if (events.polar === 'day') items.unshift([t('sunrise'), '—']);
      timesEl.innerHTML = items.map(([label, value]) => `<div class="sun-time"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    }

    let note = '';
    if (!state.hasTime) note += t('sunNoExactTime') + ' ';
    if (state.tzSource === 'exif') note += t('sunTzFromExif');
    else if (state.tzSource === 'api') note += t('sunTzFromApi', { tz: state.tzName || '' });
    else note += t('sunTzGuessed');
    if (pos) {
      if (pos.elevation < -0.833) note += ' ' + t('sunBelowHorizon') + '.';
      else if (pos.elevation < 5) note += ' ' + t('sunNoShadow');
      else note += ' ' + t('sunShadowsPoint', { dir: shDir, deg: shadow.toFixed(0) });
    }
    if (noteEl) noteEl.textContent = note;

    state.sunModel = {
      azimuth: pos ? Number(pos.azimuth.toFixed(1)) : null,
      elevation: pos ? Number(pos.elevation.toFixed(1)) : null,
      azimuthDir: azDir,
      shadow: Number.isFinite(shadow) ? Number(shadow.toFixed(1)) : null,
      shadowDir: shDir,
      solarNoon: fmtClock(events.solarNoon),
      sunrise: fmtClock(events.sunrise),
      sunset: fmtClock(events.sunset),
      goldenMorning: fmtClock(events.goldenMorningEnd),
      goldenEvening: fmtClock(events.goldenEveningStart),
      dayLength: events.dayLengthMs ? fmtDuration(events.dayLengthMs) : null,
      moon: `${t(moon.key)} · ${Math.round(moon.illumination * 100)}%`,
      timezone: state.tzName,
      offsetMin: state.tzOffsetMin,
      tzSource: state.tzSource,
    };
  }

  function compassSvg(azimuth, elevation, shadow, heading) {
    const c = 110;
    const R = 88;
    const rad = Math.PI / 180;
    const point = (az, radius) => [c + Math.sin(az * rad) * radius, c - Math.cos(az * rad) * radius];
    let svg = `<svg viewBox="0 0 220 220" class="compass-svg" role="img" aria-label="${esc(t('sunAzimuth') + ' ' + azimuth.toFixed(0) + '°')}">`;
    svg += `<circle cx="${c}" cy="${c}" r="${R}" class="cmp-ring"/>`;
    svg += `<circle cx="${c}" cy="${c}" r="${R * 0.55}" class="cmp-ring faint"/>`;
    for (let a = 0; a < 360; a += 30) {
      const len = a % 90 === 0 ? 11 : 5;
      const [x1, y1] = point(a, R - len);
      const [x2, y2] = point(a, R);
      svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="cmp-tick"/>`;
    }
    ['N', 'E', 'S', 'W'].forEach((label, index) => {
      const [x, y] = point(index * 90, R + 15);
      svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="cmp-label" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
    });
    if (Number.isFinite(heading)) {
      const [hx, hy] = point(heading, R * 0.9);
      svg += `<line x1="${c}" y1="${c}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" class="cmp-heading"/>`;
    }
    if (Number.isFinite(shadow)) {
      const [sx, sy] = point(shadow, R * 0.78);
      svg += `<line x1="${c}" y1="${c}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" class="cmp-shadow"/>`;
      svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4" class="cmp-shadow-dot"/>`;
    }
    if (Number.isFinite(azimuth)) {
      const [sx, sy] = point(azimuth, R * 0.78);
      svg += `<line x1="${c}" y1="${c}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" class="cmp-sunline"/>`;
      for (let i = 0; i < 8; i++) {
        const a = i * 45 * rad;
        const r1 = 9;
        const r2 = 13;
        svg += `<line x1="${(sx + Math.sin(a) * r1).toFixed(1)}" y1="${(sy - Math.cos(a) * r1).toFixed(1)}" x2="${(sx + Math.sin(a) * r2).toFixed(1)}" y2="${(sy - Math.cos(a) * r2).toFixed(1)}" class="cmp-ray"/>`;
      }
      svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" class="cmp-sun"/>`;
      if (elevation < -0.833) {
        const ax = (sx - 4).toFixed(1);
        const ay = (sy + 20).toFixed(1);
        svg += `<path d="M${ax} ${ay} l4 4 4-4" class="cmp-below-arrow"/>`;
      }
    }
    svg += `<circle cx="${c}" cy="${c}" r="3" class="cmp-center"/>`;
    svg += `</svg>`;
    return svg;
  }

  function sunPathSvg(points, pos) {
    const C = 180;
    const R = 130;
    const rad = Math.PI / 180;
    const project = (az, alt) => {
      const r = R * (1 - alt / 90);
      return [C + Math.sin(az * rad) * r, C - Math.cos(az * rad) * r];
    };
    let svg = `<svg viewBox="0 0 360 360" class="sun-svg" role="img" aria-label="${esc(t('sunPathCaption'))}">`;
    [0, 30, 60].forEach((alt) => {
      const r = R * (1 - alt / 90);
      svg += `<circle cx="${C}" cy="${C}" r="${r.toFixed(1)}" class="sun-grid${alt === 0 ? ' horizon' : ''}"/>`;
    });
    svg += `<line x1="${C - R - 8}" y1="${C}" x2="${C + R + 8}" y2="${C}" class="sun-axis"/>`;
    svg += `<line x1="${C}" y1="${C - R - 8}" x2="${C}" y2="${C + R + 8}" class="sun-axis"/>`;
    ['N', 'E', 'S', 'W'].forEach((label, index) => {
      const [x, y] = project(index * 90, 0);
      const dx = x - C;
      const dy = y - C;
      const scale = (R + 20) / Math.hypot(dx, dy);
      const tx = C + dx * scale;
      const ty = C + dy * scale;
      svg += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" class="sun-cardinal" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
    });
    const linePath = (filter) => {
      let d = '';
      let pen = false;
      points.forEach((p) => {
        if (!filter(p)) { pen = false; return; }
        const [x, y] = project(p.az, p.alt);
        d += `${pen ? ' L' : ' M'}${x.toFixed(1)},${y.toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    const below = linePath((p) => p.alt < -0.833);
    const above = linePath((p) => p.alt >= -0.833);
    if (below) svg += `<path d="${below}" class="sun-line below"/>`;
    if (above) svg += `<path d="${above}" class="sun-line above"/>`;
    if (pos) {
      const [x, y] = project(pos.azimuth, pos.elevation);
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" class="sun-now-halo"/>`;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" class="sun-now"/>`;
    }
    svg += `<circle cx="${C}" cy="${C}" r="2.5" class="sun-center"/>`;
    svg += `</svg>`;
    return svg;
  }

  // ---------------------------------------------------------------- render: location / weather

  function renderLocation() {
    const card = $('locationCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; return; }
    card.hidden = false;
    const panel = $('locationPanel');
    const links = $('locationLinks');
    if (!panel) return;

    const rows = [];
    if (state.geo) {
      const a = state.geo.address || {};
      rows.push(kvRow(t('labelAddress'), state.geo.display_name));
      rows.push(kvRow(t('labelRoad'), [a.road || a.street, a.house_number].filter(Boolean).join(', ')));
      rows.push(kvRow(t('labelCity'), a.city || a.town || a.village || a.hamlet || a.municipality));
      rows.push(kvRow(t('labelState'), a.state || a.region || a.county));
      rows.push(kvRow(t('labelCountry'), a.country));
      rows.push(kvRow(t('labelPostcode'), a.postcode));
    }
    if (state.tzName) rows.push(kvRow(t('labelTimezone'), state.tzName));
    if (Number.isFinite(state.tzOffsetMin)) rows.push(kvRow(t('labelUtcOffset'), fmtOffset(state.tzOffsetMin)));
    if (Number.isFinite(state.elevationApi)) rows.push(kvRow(t('labelElevation'), `${Math.round(state.elevationApi)} m`));
    if (Number.isFinite(state.exif.alt)) {
      let text = `${state.exif.alt.toFixed(1)} m`;
      if (Number.isFinite(state.elevationApi)) {
        const diff = state.exif.alt - state.elevationApi;
        text += ` · ${t('locationElevationDiff', { diff: (diff >= 0 ? '+' : '') + diff.toFixed(0) })}`;
      }
      rows.push(kvRow(t('labelElevationExif'), text));
    }
    if (state.photo) rows.push(kvRow(t('labelLocalTimeAtPhoto'), photoLocalLabel()));

    if (state.geoError) {
      panel.innerHTML = emptyBlock(t('locationError', { err: state.geoError })) + rows.join('');
    } else if (!state.geo && rows.length === 0) {
      panel.innerHTML = loadingBlock(t('locationLoading'));
    } else {
      panel.innerHTML = rows.join('') || emptyBlock(t('locationNoData'));
    }

    if (links) {
      const wikiLang = window.GeoI18n.getLang() === 'uk' ? 'uk' : 'en';
      links.innerHTML = `
        <a class="link-btn" href="https://www.openstreetmap.org/?mlat=${state.lat}&mlon=${state.lon}#map=17/${state.lat}/${state.lon}" target="_blank" rel="noopener">${esc(t('locationOpenOsm'))}</a>
        <a class="link-btn" href="https://www.google.com/maps?q=${state.lat},${state.lon}" target="_blank" rel="noopener">${esc(t('locationOpenGoogle'))}</a>
        <a class="link-btn" href="https://${wikiLang}.wikipedia.org/w/index.php?title=Special:Nearby&lat=${state.lat}&lon=${state.lon}" target="_blank" rel="noopener">${esc(t('locationOpenWiki'))}</a>`;
    }
  }

  function wmoKey(code) {
    const c = Number(code);
    if (c === 0) return 'wmoClear';
    if (c === 1) return 'wmoMainlyClear';
    if (c === 2) return 'wmoPartlyCloudy';
    if (c === 3) return 'wmoOvercast';
    if (c === 45 || c === 48) return 'wmoFog';
    if ((c >= 51 && c <= 57)) return 'wmoDrizzle';
    if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'wmoRain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'wmoSnow';
    if (c >= 95 && c <= 99) return 'wmoThunder';
    return 'wmoUnknown';
  }

  function renderWeather() {
    const card = $('weatherCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; return; }
    card.hidden = false;
    const panel = $('weatherPanel');
    const badge = $('weatherBadge');
    if (!panel) return;

    if (state.weatherError) {
      if (badge) badge.hidden = true;
      const message = state.weatherError === 'no-time' ? t('weatherNoTime')
        : state.weatherError === 'no-data' ? t('weatherNoData')
          : t('weatherError', { err: state.weatherError });
      panel.innerHTML = emptyBlock(message);
      return;
    }
    if (!state.weather) {
      if (badge) badge.hidden = true;
      panel.innerHTML = loadingBlock(t('weatherLoading'));
      return;
    }

    const w = state.weather;
    if (badge) {
      badge.hidden = false;
      badge.textContent = t(w.source === 'archive' ? 'weatherArchive' : 'weatherForecast');
    }
    const numText = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
    const rows = [];
    rows.push(kvRow(t('weatherAt'), w.hour));
    rows.push(kvRow(t('weatherTemp'), Number.isFinite(w.temp) ? t('unitsC', { v: numText(w.temp, 1) }) : '—'));
    rows.push(kvRow(t('weatherClouds'), Number.isFinite(w.cloud) ? `${Math.round(w.cloud)}%` : '—'));
    rows.push(kvRow(t('weatherPrecip'), Number.isFinite(w.precip) ? t('unitsMm', { v: numText(w.precip, 1) }) : '—'));
    rows.push(kvRow(t('weatherWind'), Number.isFinite(w.wind) ? t('unitsKmh', { v: numText(w.wind, 1) }) : '—'));
    rows.push(kvRow(t('weatherCode'), Number.isFinite(w.code) ? t(wmoKey(w.code)) : '—'));
    if (Number.isFinite(w.cloud)) {
      const advice = w.cloud < 25 ? t('weatherCloudClear') : w.cloud < 70 ? t('weatherCloudPartly') : t('weatherCloudOvercast');
      rows.push(kvRow(t('weatherShadow'), t('weatherCloudHint', { cloud: Math.round(w.cloud), advice })));
    }
    panel.innerHTML = rows.join('');
  }

  // ---------------------------------------------------------------- render: wiki / OSM

  function distanceLabel(meters) {
    if (!Number.isFinite(meters)) return '';
    if (meters < 1000) return t('unitsM', { v: Math.round(meters) });
    return t('unitsKm', { v: (meters / 1000).toFixed(1) });
  }

  const WIKI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 9.4 12 4l9.4 5.4"/><path d="M4.6 10.6V19h14.8v-8.4"/><path d="M9 19v-5h6v5"/><path d="M2.6 19h18.8"/></svg>';
  const OSM_PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 20.8s6.4-5.6 6.4-10.2a6.4 6.4 0 1 0-12.8 0C5.6 15.2 12 20.8 12 20.8Z"/><circle cx="12" cy="10.1" r="2.3"/></svg>';

  function renderWiki() {
    const card = $('wikiCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; return; }
    card.hidden = false;
    const panel = $('wikiPanel');
    if (!panel) return;
    if (state.wikiError) { panel.innerHTML = emptyBlock(t('wikiError', { err: state.wikiError })); return; }
    if (!state.wiki.length) { panel.innerHTML = emptyBlock(t('wikiEmpty')); return; }
    panel.innerHTML = state.wiki.map((w) => `
      <a class="nearby-item" href="${esc(w.url)}" target="_blank" rel="noopener">
        ${w.thumb ? `<img class="nearby-thumb" src="${esc(w.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="nearby-icon" aria-hidden="true">${WIKI_ICON}</span>`}
        <span class="nearby-main">
          <strong>${esc(w.title)}</strong>
          <span class="nearby-meta">${esc(t('wikiDistance', { d: distanceLabel(w.distance) }))}</span>
          ${w.extract ? `<span class="nearby-text">${esc(w.extract)}</span>` : ''}
        </span>
      </a>`).join('');
  }

  function renderOsm() {
    const card = $('osmCard');
    if (!card) return;
    if (!hasGps()) { card.hidden = true; return; }
    card.hidden = false;
    const panel = $('osmPanel');
    const status = $('osmStatus');
    if (!panel) return;
    if (status) {
      status.hidden = false;
      status.textContent = t('osmRadius');
    }
    if (state.osmError) {
      panel.innerHTML = emptyBlock(t('osmError', { err: state.osmError })) +
        `<button id="osmRetry" class="btn secondary small" type="button">${esc(t('retry'))}</button>`;
      const retry = $('osmRetry');
      if (retry) retry.addEventListener('click', () => fetchOsm(state.analysisId));
      return;
    }
    if (!state.osm.length) { panel.innerHTML = emptyBlock(t('osmEmpty')); return; }
    panel.innerHTML = state.osm.map((f) => `
      <a class="nearby-item" href="${esc(f.url)}" target="_blank" rel="noopener">
        <span class="nearby-icon" aria-hidden="true">${OSM_PIN_ICON}</span>
        <span class="nearby-main">
          <strong>${esc(f.name || t('osmUnnamed'))}</strong>
          <span class="nearby-meta">${esc(f.type.replace(/_/g, ' '))} · ${esc(distanceLabel(f.distance))}</span>
        </span>
      </a>`).join('');
  }

  // ---------------------------------------------------------------- render: OCR clues

  const CLUE_ORDER = ['phone', 'email', 'url', 'coords', 'address', 'date', 'plate', 'number', 'name', 'handle', 'hashtag'];
  const CLUE_LABEL = {
    phone: 'cluesPhone', email: 'cluesEmail', url: 'cluesUrl', coords: 'cluesCoords',
    address: 'cluesAddress', date: 'cluesDate', plate: 'cluesPlate', number: 'cluesNumber',
    name: 'cluesName', handle: 'cluesHandle', hashtag: 'cluesHashtag',
  };

  function extractClues(text) {
    const src = String(text || '').slice(0, 20000);
    const found = [];
    const add = (type, value) => {
      let v = String(value || '').replace(/\s+/g, ' ').trim();
      v = v.replace(/^[,;:]+|[,;:]+$/g, '').trim();
      if (!v || v.length < 2 || v.length > 90) return;
      if (found.some((c) => c.type === type && c.value.toLowerCase() === v.toLowerCase())) return;
      found.push({ type, value: v });
    };

    const urlRe = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    const urls = src.match(urlRe) || [];
    urls.forEach((u) => add('url', u.replace(/[).,;]+$/, '')));
    let scrubbed = src.replace(urlRe, ' ');

    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    (scrubbed.match(emailRe) || []).forEach((e) => add('email', e));
    scrubbed = scrubbed.replace(emailRe, ' ');

    const coordRe = /([-+]?\d{1,3}\.\d{2,})\s*[,; ]\s*([-+]?\d{1,3}\.\d{2,})/g;
    let m;
    while ((m = coordRe.exec(scrubbed)) !== null) {
      const lat = Number(m[1]);
      const lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) add('coords', `${m[1]}, ${m[2]}`);
    }

    const phoneRe = /(?:\+\d[\d\s\-().]{7,}\d)|(?:\b0\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b)/g;
    (scrubbed.match(phoneRe) || []).forEach((p) => add('phone', p));

    const dateRe = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
    (scrubbed.match(dateRe) || []).forEach((d) => add('date', d));

    const plateRe = /\b[A-Z]{2}\s?\d{4}\s?[A-Z]{2}\b/g;
    (scrubbed.match(plateRe) || []).forEach((p) => add('plate', p));

    const addressRe = /(?:вул\.|вулиця|просп\.|проспект|бульв\.|бульвар|пров\.|провулок|пл\.|площа|наб\.|набережна|street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.|square|sq\.)\s*[A-ZА-ЯІЇЄҐ][\p{L}\p{N}’'\-]{1,30}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}\p{N}’'\-]{1,30}){0,4}(?:\s+\d+[A-Za-zА-Яа-я]?)?/giu;
    (scrubbed.match(addressRe) || []).forEach((a) => add('address', a));

    const handleRe = /(?:^|\s)@([A-Za-z0-9_.]{2,32})/g;
    while ((m = handleRe.exec(scrubbed)) !== null) add('handle', '@' + m[1]);

    const tagRe = /(?:^|\s)(#[\p{L}\p{N}_]{2,40})/gu;
    while ((m = tagRe.exec(scrubbed)) !== null) add('hashtag', m[1]);

    const numRe = /\b\d{4,6}\b/g;
    (scrubbed.match(numRe) || []).forEach((n) => {
      const value = Number(n);
      if (value >= 1900 && value <= 2099) return;
      add('number', n);
    });

    const stop = new Set(['the', 'this', 'that', 'photo', 'image', 'picture', 'street', 'road', 'avenue', 'hotel', 'restaurant', 'cafe', 'open', 'closed', 'city', 'center', 'centre', 'park', 'beach', 'station', 'airport', 'google', 'maps', 'camera', 'phone', 'email', 'www', 'http', 'https', 'ukraine', 'kyiv', 'kiev', 'london', 'new', 'york', 'image', 'photo']);
    const nameRe = /\b[A-ZА-ЯІЇЄҐ][\p{L}’'\-]{2,}(?:\s+[A-ZА-ЯІЇЄҐ][\p{L}’'\-]{2,}){0,3}\b/gu;
    let nameCount = 0;
    while ((m = nameRe.exec(scrubbed)) !== null && nameCount < 20) {
      const value = m[0].trim();
      if (stop.has(value.toLowerCase())) continue;
      add('name', value);
      nameCount += 1;
    }

    return found;
  }

  function renderClues() {
    const panel = $('cluesPanel');
    const copy = $('copyClues');
    if (!panel) return;
    const clues = state.ocr.clues || [];
    if (!clues.length) {
      panel.innerHTML = emptyBlock(t('cluesNone'));
      if (copy) copy.hidden = true;
      return;
    }
    if (copy) copy.hidden = false;
    const groups = {};
    clues.forEach((c) => { (groups[c.type] = groups[c.type] || []).push(c.value); });
    let html = `<div class="clues-summary">${esc(t('cluesSummary', { n: clues.length }))} · ${esc(t('cluesClickCopy'))}</div>`;
    CLUE_ORDER.forEach((type) => {
      const values = groups[type];
      if (!values || !values.length) return;
      html += `<div class="clue-group"><strong>${esc(t(CLUE_LABEL[type] || type))}</strong><div class="clue-chips">`;
      values.forEach((value) => {
        html += `<button type="button" class="clue-chip" data-value="${esc(value)}" title="${esc(t('cluesClickCopy'))}">${esc(value)}</button>`;
      });
      html += `</div></div>`;
    });
    panel.innerHTML = html;
  }

  const REVERSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="3.4" width="12.6" height="12.6" rx="2.4"/><path d="m2.6 12.2 3.4-3.4 3.3 3.3 3.3-3.2 2.6-2.6"/><circle cx="17.2" cy="17.2" r="4.1"/><path d="m20.2 20.2 2.1 2.1"/></svg>';

  function renderReverseLinks() {
    const wrap = $('reverseLinks');
    if (!wrap) return;
    const links = [
      ['reverseGoogleLens', 'https://lens.google.com/'],
      ['reverseGoogleImages', 'https://images.google.com/'],
      ['reverseYandex', 'https://yandex.com/images/'],
      ['reverseBaidu', 'https://graph.baidu.com/pcpage/index?entry=shitu'],
      ['reverseTinEye', 'https://tineye.com/'],
      ['reverseBing', 'https://www.bing.com/visualsearch'],
      ['reverseSauceNAO', 'https://saucenao.com/'],
      ['reverseKarma', 'http://karmadecay.com/'],
    ];
    wrap.innerHTML = links.map(([key, url]) => `<a class="link-btn" href="${url}" target="_blank" rel="noopener"><span class="link-ico" aria-hidden="true">${REVERSE_ICON}</span>${esc(t(key))}</a>`).join('');
  }

  // ---------------------------------------------------------------- report model

  function reportFilename(ext) {
    const date = state.photo
      ? `${state.photo.y}-${pad(state.photo.mo)}-${pad(state.photo.d)}`
      : new Date().toISOString().slice(0, 10);
    const coords = hasGps() ? `_${state.lat.toFixed(4)}_${state.lon.toFixed(4)}` : '';
    return `${t('reportFileBase')}_${date}${coords}.${ext}`;
  }

  function buildReportModel() {
    const e = state.exif || {};
    const addr = state.geo ? (state.geo.address || {}) : null;
    const street = addr ? [addr.road || addr.street, addr.house_number].filter(Boolean).join(', ') : '';
    const wikiLang = window.GeoI18n.getLang() === 'uk' ? 'uk' : 'en';
    const links = hasGps() ? {
      'Google Maps': `https://www.google.com/maps?q=${state.lat},${state.lon}`,
      'OpenStreetMap': `https://www.openstreetmap.org/?mlat=${state.lat}&mlon=${state.lon}#map=17/${state.lat}/${state.lon}`,
      'GeoHack': `https://geohack.toolforge.org/geohack.php?params=${state.lat};${state.lon}`,
      'Apple Maps': `https://maps.apple.com/?ll=${state.lat},${state.lon}&q=${state.lat},${state.lon}`,
      'Mapillary': `https://www.mapillary.com/app/?lat=${state.lat}&lng=${state.lon}&z=17`,
      'Street View': `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${state.lat},${state.lon}`,
    } : {};

    const notes = [];
    if (state.tzSource === 'guess') notes.push(t('sunTzGuessed'));
    if (state.tzSource === 'api') notes.push(t('sunTzFromApi', { tz: state.tzName || '' }));
    if (state.tzSource === 'exif') notes.push(t('sunTzFromExif'));
    if (state.heicConverted) notes.push(t('verdictHeic'));
    if (state.ocr.lang) notes.push(`OCR: ${state.ocr.lang}`);

    return {
      generatedAt: new Date().toISOString(),
      app: { name: 'Geo-Sleuth Web', url: location.origin + location.pathname },
      file: state.file ? {
        name: state.file.name,
        sizeLabel: formatBytes(state.file.size),
        type: state.file.type || (state.file.name || '').split('.').pop(),
        lastModified: state.file.lastModified ? new Date(state.file.lastModified).toISOString().slice(0, 19) + ' UTC' : '',
      } : null,
      coords: hasGps() ? {
        lat: state.lat,
        lon: state.lon,
        alt: Number.isFinite(e.alt) ? e.alt : null,
        accuracy: Number.isFinite(e.accuracy) ? e.accuracy : null,
      } : null,
      tz: { offsetMin: state.tzOffsetMin, name: state.tzName, source: state.tzSource },
      photoLocal: photoLocalLabel(),
      photoUTC: state.photoUTC ? state.photoUTC.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '',
      address: addr ? {
        displayName: state.geo.display_name,
        road: street,
        city: addr.city || addr.town || addr.village || addr.hamlet || addr.municipality,
        state: addr.state || addr.region || addr.county,
        country: addr.country,
        postcode: addr.postcode,
      } : null,
      exif: {
        make: e.make, model: e.model, lens: e.lens,
        dateTime: prettyDate(e.dateTimeOriginal), software: e.software,
        dimensions: e.dimensions, exposure: fmtShutter(e.exposure),
        fNumber: Number.isFinite(e.fNumber) && e.fNumber > 0 ? `f/${e.fNumber}` : '',
        iso: Number.isFinite(e.iso) ? String(e.iso) : '',
        focalLength: Number.isFinite(e.focalLength) ? `${e.focalLength} mm` : '',
        orientation: orientationLabel(e.orientation),
        heading: Number.isFinite(e.heading) ? `${Math.round(e.heading)}°` : '',
        altitude: Number.isFinite(e.alt) ? `${e.alt.toFixed(1)} m` : '',
        gpsAccuracy: Number.isFinite(e.accuracy) ? `±${Math.round(e.accuracy)} m` : '',
      },
      sun: state.sunModel,
      weather: state.weather ? {
        hour: state.weather.hour,
        temp: t('unitsC', { v: Number(state.weather.temp).toFixed(1) }),
        cloud: `${Math.round(state.weather.cloud)}%`,
        precip: t('unitsMm', { v: Number(state.weather.precip).toFixed(1) }),
        wind: t('unitsKmh', { v: Number(state.weather.wind).toFixed(1) }),
        condition: t(wmoKey(state.weather.code)),
        source: t(state.weather.source === 'archive' ? 'weatherArchive' : 'weatherForecast'),
      } : null,
      wiki: state.wiki.map((w) => ({ title: w.title, url: w.url, distanceLabel: distanceLabel(w.distance) })),
      osm: state.osm.map((f) => ({ type: f.type.replace(/_/g, ' '), name: f.name || t('osmUnnamed'), distanceLabel: distanceLabel(f.distance) })),
      ocr: {
        text: state.ocr.text,
        clues: state.ocr.clues.map((c) => ({ type: t(CLUE_LABEL[c.type] || c.type), value: c.value })),
      },
      links,
      notes: notes.join('. '),
    };
  }
  // ---------------------------------------------------------------- network

  async function fetchJson(url, options) {
    const opts = Object.assign({}, options || {});
    const timeout = opts.timeout || 15000;
    delete opts.timeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
      const response = await fetch(url, Object.assign({}, opts, { signal: controller.signal, headers }));
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchGeoInfo(id) {
    if (!hasGps()) return;
    const lat = state.lat;
    const lon = state.lon;
    renderLocation();
    const lang = window.GeoI18n.getLang();
    const requests = [
      fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=${lang}`, { timeout: 15000 }),
      fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { timeout: 15000 }),
      fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&current=temperature_2m`, { timeout: 15000 }),
    ];
    const [geo, elevation, timezone] = await Promise.allSettled(requests);
    if (id !== state.analysisId) return;

    state.geo = geo.status === 'fulfilled' ? geo.value : null;
    state.geoError = geo.status === 'rejected' ? errorLabel(geo.reason) : null;
    if (elevation.status === 'fulfilled' && Array.isArray(elevation.value.elevation)) {
      const value = Number(elevation.value.elevation[0]);
      state.elevationApi = Number.isFinite(value) ? value : null;
    }
    if (timezone.status === 'fulfilled' && timezone.value.timezone) {
      state.tzName = timezone.value.timezone;
      if (state.exif.offsetMin == null && state.photo) {
        const newOffset = tzOffsetForZone(state.tzName, state.photoUTC || new Date());
        if (newOffset != null) {
          const changed = newOffset !== state.tzOffsetMin;
          state.tzOffsetMin = newOffset;
          state.tzSource = 'api';
          if (changed) updatePhotoUTC();
          renderSun();
        }
      }
    }
    renderLocation();
  }

  async function fetchWeather(id) {
    if (!hasGps()) return;
    if (!state.photo || !state.hasTime) {
      state.weatherError = 'no-time';
      renderWeather();
      return;
    }
    state.weather = null;
    state.weatherError = null;
    renderWeather();

    const p = state.photo;
    const dateStr = `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const diff = Math.round((Date.parse(dateStr + 'T12:00:00Z') - Date.parse(todayStr + 'T12:00:00Z')) / 86400000);
    let url;
    let source;
    if (diff < -5) {
      source = 'archive';
      url = `https://archive-api.open-meteo.com/v1/archive?latitude=${state.lat}&longitude=${state.lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,cloud_cover,precipitation,weather_code,wind_speed_10m&timezone=auto`;
    } else if (diff <= 15) {
      source = 'forecast';
      url = `https://api.open-meteo.com/v1/forecast?latitude=${state.lat}&longitude=${state.lon}&hourly=temperature_2m,cloud_cover,precipitation,weather_code,wind_speed_10m&past_days=5&forecast_days=16&timezone=auto`;
    } else {
      state.weatherError = 'no-data';
      renderWeather();
      return;
    }

    try {
      const data = await fetchJson(url, { timeout: 20000 });
      if (id !== state.analysisId) return;
      const hourly = data.hourly || {};
      const times = hourly.time || [];
      let best = -1;
      let bestDiff = Infinity;
      times.forEach((value, index) => {
        const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):/);
        if (!match) return;
        if (`${match[1]}-${match[2]}-${match[3]}` !== dateStr) return;
        const delta = Math.abs(Number(match[4]) - p.h);
        if (delta < bestDiff) { bestDiff = delta; best = index; }
      });
      if (best < 0) {
        state.weatherError = 'no-data';
        renderWeather();
        return;
      }
      const num = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      state.weather = {
        hour: String(times[best]).replace('T', ' ').slice(0, 16),
        temp: num(hourly.temperature_2m && hourly.temperature_2m[best]),
        cloud: num(hourly.cloud_cover && hourly.cloud_cover[best]),
        precip: num(hourly.precipitation && hourly.precipitation[best]),
        wind: num(hourly.wind_speed_10m && hourly.wind_speed_10m[best]),
        code: num(hourly.weather_code && hourly.weather_code[best]),
        source,
      };
      renderWeather();
    } catch (e) {
      if (id !== state.analysisId) return;
      state.weatherError = errorLabel(e);
      renderWeather();
    }
  }

  async function fetchWiki(id) {
    if (!hasGps()) return;
    state.wikiError = null;
    const panel = $('wikiPanel');
    if (panel) panel.innerHTML = loadingBlock(t('wikiLoading'));
    const lang = window.GeoI18n.getLang() === 'uk' ? 'uk' : 'en';
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${state.lat}%7C${state.lon}&ggsradius=10000&ggslimit=12&ggsnamespace=0&prop=coordinates%7Cpageimages%7Cextracts&coprimary=primary&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=180&format=json&formatversion=2&origin=*`;
    try {
      const data = await fetchJson(url, { timeout: 15000 });
      if (id !== state.analysisId) return;
      const pages = (data.query && data.query.pages) || [];
      state.wiki = pages.map((page) => {
        const coord = page.coordinates && page.coordinates[0];
        const distance = coord ? window.GeoSun.distanceMeters(state.lat, state.lon, coord.lat, coord.lon) : Infinity;
        return {
          title: page.title,
          extract: String(page.extract || '').replace(/\s+/g, ' ').slice(0, 240),
          thumb: page.thumbnail && page.thumbnail.source,
          url: `https://${lang}.wikipedia.org/?curid=${page.pageid}`,
          distance,
        };
      }).filter((page) => page.title).sort((a, b) => a.distance - b.distance);
      renderWiki();
    } catch (e) {
      if (id !== state.analysisId) return;
      state.wiki = [];
      state.wikiError = errorLabel(e);
      renderWiki();
    }
  }

  async function fetchOsm(id) {
    if (!hasGps()) return;
    state.osmError = null;
    const panel = $('osmPanel');
    if (panel) panel.innerHTML = loadingBlock(t('osmLoading'));
    const query = `[out:json][timeout:20];(nwr(around:300,${state.lat},${state.lon})[amenity];nwr(around:300,${state.lat},${state.lon})[shop];nwr(around:300,${state.lat},${state.lon})[tourism];nwr(around:300,${state.lat},${state.lon})[historic];nwr(around:300,${state.lat},${state.lon})[leisure];);out center tags 80;`;
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ];
    let data = null;
    let lastError = null;
    for (const endpoint of endpoints) {
      if (id !== state.analysisId) return;
      try {
        data = await fetchJson(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: query }),
          timeout: 12000,
        });
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (id !== state.analysisId) return;
    if (!data) {
      state.osm = [];
      state.osmError = errorLabel(lastError) || 'unavailable';
      renderOsm();
      return;
    }

    const seen = new Set();
    const features = [];
    (data.elements || []).forEach((el) => {
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'] || tags['name:uk'] || '';
      const type = tags.amenity || tags.shop || tags.tourism || tags.historic || tags.leisure || tags.highway;
      const lat = Number.isFinite(el.lat) ? el.lat : (el.center && el.center.lat);
      const lon = Number.isFinite(el.lon) ? el.lon : (el.center && el.center.lon);
      if (!type || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const key = `${type}|${name}|${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      features.push({
        type, name, lat, lon,
        distance: window.GeoSun.distanceMeters(state.lat, state.lon, lat, lon),
        url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      });
    });
    features.sort((a, b) => a.distance - b.distance);
    state.osm = features.slice(0, 30);
    renderOsm();
  }

  // ---------------------------------------------------------------- OCR

  let tesseractPromise = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error('Tesseract.js load failed'));
      document.head.appendChild(script);
    });
    return tesseractPromise;
  }

  function loadImageElement(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      img.src = url;
    });
  }

  async function buildOcrCanvas(blob, enhance) {
    let source;
    try {
      source = await createImageBitmap(blob);
    } catch (e) {
      source = await loadImageElement(blob);
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('image has no dimensions');
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (enhance) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const contrast = 1.35;
      for (let i = 0; i < data.length; i += 4) {
        let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray = (gray - 128) * contrast + 128;
        gray = Math.max(0, Math.min(255, gray));
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return canvas;
  }

  async function runOcr(options) {
    if (!state.file) return;
    const id = state.analysisId;
    const btn = $('ocrRun');
    const statusEl = $('ocrStatus');
    const progress = $('ocrProgress');
    const output = $('ocrOutput');
    if (btn) btn.disabled = true;
    if (progress) { progress.hidden = false; progress.value = 0; }
    if (statusEl) statusEl.textContent = t('ocrLoadingEngine');
    try {
      const Tesseract = await loadTesseract();
      if (id !== state.analysisId) return;
      if (statusEl) statusEl.textContent = t('ocrDownloading');
      const source = state.heicBlob || state.file;
      const enhance = !$('ocrPreprocess') || $('ocrPreprocess').checked;
      const canvas = await buildOcrCanvas(source, enhance);
      if (id !== state.analysisId) return;
      const langs = $('ocrLang') ? $('ocrLang').value : 'eng';
      if (statusEl) statusEl.textContent = t('ocrRunning');
      const result = await Tesseract.recognize(canvas, langs, {
        logger: (message) => {
          if (id !== state.analysisId) return;
          if (progress && Number.isFinite(message.progress)) progress.value = message.progress;
          if (statusEl && message.status) {
            if (/loading language|downloading/i.test(message.status)) {
              statusEl.textContent = t('ocrDownloading');
            } else if (/recognizing/i.test(message.status)) {
              statusEl.textContent = `${t('ocrRunning')} ${Math.round((message.progress || 0) * 100)}%`;
            }
          }
        },
      });
      if (id !== state.analysisId) return;
      const text = String((result && result.data && result.data.text) || '').trim();
      state.ocr.text = text;
      state.ocr.clues = extractClues(text);
      state.ocr.lang = langs;
      if (output) output.textContent = text || t('ocrNoText');
      if (statusEl) statusEl.textContent = t('ocrDone');
      renderClues();
    } catch (e) {
      if (id !== state.analysisId) return;
      const message = t('ocrFailed', { err: errorLabel(e) });
      if (statusEl) statusEl.textContent = message;
      if (output) output.textContent = '';
      toast(message, 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (progress) {
        setTimeout(() => {
          if (id === state.analysisId) progress.hidden = true;
        }, 1200);
      }
    }
  }
  // ---------------------------------------------------------------- analysis flow

  function preparePhotoTime() {
    const e = state.exif || {};
    state.photo = parseDateTimeParts(e.dateTimeOriginal);
    state.hasTime = !!(state.photo && state.photo.hasTime);
    if (Number.isFinite(e.offsetMin)) {
      state.tzOffsetMin = e.offsetMin;
      state.tzSource = 'exif';
    } else {
      state.tzOffsetMin = Math.round((state.lon || 0) / 15) * 60;
      state.tzSource = 'guess';
    }
    updatePhotoUTC();
  }

  function showGeoCards(show) {
    ['mapCard', 'sunCard', 'locationCard', 'weatherCard', 'wikiCard', 'osmCard'].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = !show;
    });
  }

  function applyExif(result, id) {
    if (id !== state.analysisId) return;
    state.exifSource = result.source || 'none';
    state.rawExif = result.raw || {};
    state.exif = normalizeExif(state.rawExif);
    state.lat = Number.isFinite(state.exif.lat) ? state.exif.lat : null;
    state.lon = Number.isFinite(state.exif.lon) ? state.exif.lon : null;
    state.heading = Number.isFinite(state.exif.heading) ? state.exif.heading : null;
    state.accuracy = Number.isFinite(state.exif.accuracy) ? state.exif.accuracy : null;

    renderVerdict();
    renderExif();
    renderQuickChips();
    renderRaw();

    if (hasGps()) {
      preparePhotoTime();
      showGeoCards(true);
      renderSun();
      renderMap();
      renderLocation();
      renderWeather();
      fetchGeoInfo(id);
      fetchWeather(id);
      fetchWiki(id);
      fetchOsm(id);
    } else {
      showGeoCards(false);
      state.sunModel = null;
      if (window.GeoMapView) window.GeoMapView.destroy();
    }
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > FILE_LIMIT) { showFileError(t('fileTooLarge')); return; }
    if (!isImageFile(file)) { showFileError(t('fileNotImage')); return; }
    const errorBox = $('fileError');
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }

    const id = ++state.analysisId;
    cleanupUrls();
    resetStateForFile();
    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    showPreview(state.objectUrl, file);

    const results = $('results');
    if (results) results.hidden = false;
    resetPanels();
    setTimeout(() => {
      if (id !== state.analysisId || !results) return;
      const top = results.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top, behavior: 'smooth' });
    }, 60);

    try {
      const previewPromise = isHeicFile(file) ? convertHeicPreview(file, id) : Promise.resolve(null);
      const exifResult = await readExif(file);
      if (id !== state.analysisId) return;
      applyExif(exifResult, id);
      await previewPromise;
      if (id !== state.analysisId) return;
      if (!hasGps()) {
        setTimeout(() => {
          if (id === state.analysisId && state.file) runOcr({ auto: true });
        }, 500);
      }
    } catch (e) {
      if (id !== state.analysisId) return;
      const verdict = $('verdict');
      if (verdict) verdict.innerHTML = `<div class="verdict bad">${esc(t('analysisError', { err: errorLabel(e) }))}</div>`;
    }
  }

  // ---------------------------------------------------------------- UI wiring

  function setupDrop() {
    const zone = $('dropZone');
    const input = $('fileInput');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((type) => {
      zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('dragging'); });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      zone.addEventListener(type, () => zone.classList.remove('dragging'));
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragging');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    document.addEventListener('paste', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); handleFile(file); break; }
        }
      }
    });
  }

  function closeMapFullscreen() {
    const card = $('mapCard');
    if (!card) return;
    card.classList.remove('fullscreen');
    document.body.classList.remove('map-fullscreen');
    const btn = $('mapFullscreen');
    if (btn) btn.textContent = t('fullscreen');
    if (window.GeoMapView) window.GeoMapView.invalidate();
  }

  function setupButtons() {
    const downloadPhoto = $('downloadPhoto');
    if (downloadPhoto) {
      downloadPhoto.addEventListener('click', () => {
        if (!state.file) return;
        downloadBlob(state.file.name || 'photo.jpg', state.file);
        toast(t('toastDownloaded'));
      });
    }

    const resetBtn = $('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', resetAll);

    const copyCoords = $('copyCoords');
    if (copyCoords) {
      copyCoords.addEventListener('click', async () => {
        if (!hasGps()) return;
        const ok = await copyText(fmtCoordPair(state.lat, state.lon));
        toast(ok ? t('toastCopied') : t('toastCopyFailed'), ok ? '' : 'error');
      });
    }

    const copyRaw = $('copyRaw');
    if (copyRaw) {
      copyRaw.addEventListener('click', async () => {
        let text = '';
        try { text = JSON.stringify(state.rawExif || {}, rawReplacer, 2); } catch (e) { text = String(state.rawExif || ''); }
        const ok = await copyText(text);
        toast(ok ? t('toastCopied') : t('toastCopyFailed'), ok ? '' : 'error');
      });
    }

    const copyClues = $('copyClues');
    if (copyClues) {
      copyClues.addEventListener('click', async () => {
        const lines = (state.ocr.clues || []).map((c) => `${t(CLUE_LABEL[c.type] || c.type)}: ${c.value}`);
        const ok = await copyText(lines.join('\n'));
        toast(ok ? t('toastCopied') : t('toastCopyFailed'), ok ? '' : 'error');
      });
    }

    const reportMd = $('reportMd');
    if (reportMd) {
      reportMd.addEventListener('click', () => {
        if (!state.file) { toast(t('reportNoData'), 'error'); return; }
        const model = buildReportModel();
        window.GeoReport.download(reportFilename('md'), window.GeoReport.buildMarkdown(model), 'text/markdown;charset=utf-8');
        toast(t('toastDownloaded'));
      });
    }

    const reportJson = $('reportJson');
    if (reportJson) {
      reportJson.addEventListener('click', () => {
        if (!state.file) { toast(t('reportNoData'), 'error'); return; }
        const model = buildReportModel();
        window.GeoReport.download(reportFilename('json'), window.GeoReport.buildJson(model), 'application/json;charset=utf-8');
        toast(t('toastDownloaded'));
      });
    }

    const copyReport = $('copyReport');
    if (copyReport) {
      copyReport.addEventListener('click', async () => {
        if (!state.file) { toast(t('reportNoData'), 'error'); return; }
        const model = buildReportModel();
        const ok = await copyText(window.GeoReport.buildMarkdown(model));
        toast(ok ? t('toastCopied') : t('toastCopyFailed'), ok ? '' : 'error');
      });
    }

    const ocrRun = $('ocrRun');
    if (ocrRun) ocrRun.addEventListener('click', () => runOcr({ manual: true }));

    const mapFullscreen = $('mapFullscreen');
    if (mapFullscreen) {
      mapFullscreen.addEventListener('click', () => {
        const card = $('mapCard');
        if (!card) return;
        const on = card.classList.toggle('fullscreen');
        document.body.classList.toggle('map-fullscreen', on);
        mapFullscreen.textContent = on ? t('close') : t('fullscreen');
        setTimeout(() => { if (window.GeoMapView) window.GeoMapView.invalidate(); }, 120);
      });
    }
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMapFullscreen(); });
  }

  function initClueCopy() {
    const panel = $('cluesPanel');
    if (!panel) return;
    panel.addEventListener('click', async (e) => {
      const chip = e.target.closest('.clue-chip');
      if (!chip) return;
      const ok = await copyText(chip.getAttribute('data-value') || '');
      toast(ok ? t('toastCopied') : t('toastCopyFailed'), ok ? '' : 'error');
    });
  }

  function initOcrLang() {
    const select = $('ocrLang');
    if (!select) return;
    let saved = null;
    try { saved = localStorage.getItem('geoOcrLang'); } catch (e) { /* ignore */ }
    if (saved && Array.from(select.options).some((option) => option.value === saved)) select.value = saved;
    else select.value = window.GeoI18n.getLang() === 'uk' ? 'eng+ukr+rus' : 'eng';
    select.addEventListener('change', () => {
      try { localStorage.setItem('geoOcrLang', select.value); } catch (e) { /* ignore */ }
    });
  }

  function setupLangChange() {
    document.addEventListener('geo:langchange', () => {
      if (!state.file) return;
      renderVerdict();
      renderExif();
      renderRaw();
      renderQuickChips();
      if (hasGps()) {
        renderSun();
        renderLocation();
        renderWeather();
        renderWiki();
        renderOsm();
      }
      renderClues();
      renderReverseLinks();
      const status = $('ocrStatus');
      if (status) {
        if (state.ocr.lang) status.textContent = t('ocrDone');
        else status.textContent = t('ocrEmpty');
      }
      const output = $('ocrOutput');
      if (output && state.ocr.lang) output.textContent = state.ocr.text || t('ocrNoText');
    });
  }

  function initPwa() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
    });
  }

  function init() {
    initLang();
    initTheme();
    setupDrop();
    setupButtons();
    initClueCopy();
    initOcrLang();
    setupLangChange();
    initPwa();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

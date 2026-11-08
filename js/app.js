// geo-sleuth web: drop a photo -> EXIF + map + OCR + reverse search links
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatCoord(v) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    const deg = Math.floor(abs);
    const min = Math.floor((abs - deg) * 60);
    const sec = ((abs - deg) * 60 - min) * 60;
    const hemi = v >= 0 ? (deg === abs ? 'N' : '') : '';
    return `${v.toFixed(6)}°  (${deg}° ${min}' ${sec.toFixed(2)}")`;
  }

  let currentFile = null;
  let currentExif = null;
  let objectUrl = null;

  function showImage(file) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const img = $('preview');
    img.src = objectUrl;
    img.style.display = 'block';
    $('previewWrap').classList.remove('empty');
    $('fileName').textContent = file.name;
    $('fileSize').textContent = `${(file.size / 1024).toFixed(1)} KB`;
  }

  function renderExif(exif) {
    const panel = $('exifPanel');
    const rows = [];
    const add = (label, value) => {
      if (value === undefined || value === null || value === '') return;
      rows.push(`<div class="exif-row"><span class="exif-label">${escapeHtml(label)}</span><span class="exif-value">${escapeHtml(String(value))}</span></div>`);
    };
    add('Latitude', exif.lat !== undefined ? formatCoord(exif.lat) : undefined);
    add('Longitude', exif.lon !== undefined ? formatCoord(exif.lon) : undefined);
    add('Altitude', exif.alt !== undefined ? `${exif.alt.toFixed(1)} m` : undefined);
    add('Date/Time', exif.dateTimeOriginal || exif.dateTime || exif.dateTimeDigitized);
    add('GPS date', exif.gpsDateStamp);
    add('Make', exif.make);
    add('Model', exif.model);
    add('Focal length', exif.focalLength ? `${exif.focalLength} mm` : undefined);
    add('Focal length (35mm)', exif.focalLength35mm ? `${exif.focalLength35mm} mm` : undefined);
    add('Exposure', exif.exposureTime ? `1/${Math.round(1 / exif.exposureTime)} s` : undefined);
    add('F-number', exif.fNumber ? `f/${exif.fNumber}` : undefined);
    add('ISO', exif.iso);
    if (rows.length === 0) rows.push('<div class="exif-empty">No EXIF metadata found (or not a JPEG with EXIF).</div>');
    panel.innerHTML = rows.join('');
  }

  function showMap(lat, lon) {
    const wrap = $('mapWrap');
    const iframe = $('mapFrame');
    const link = $('mapLink');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      wrap.hidden = true;
      return;
    }
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    iframe.src = url;
    link.href = `https://www.google.com/maps?q=${lat},${lon}`;
    link.textContent = `Open in Google Maps (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
    wrap.hidden = false;
  }

  function buildReverseSearchLinks(file) {
    const list = $('reverseLinks');
    const links = [
      { name: 'Google Lens', url: 'https://lens.google.com/uploadbyurl?url=' },
      { name: 'Yandex Images', url: 'https://yandex.com/images/search?rpt=imageview&url=' },
      { name: 'Bing Visual Search', url: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIIDP&sbisrc=Url&q=imgurl:' },
      { name: 'TinEye', url: 'https://tineye.com/search?url=' },
    ];
    // These need a public URL; since the photo is local, provide a note + Baidu/Yandex upload
    list.innerHTML = `
      <p class="hint">Reverse image search needs a public URL. Upload the photo to one of these services manually, or use the links below to open the search pages:</p>
      <div class="link-grid">
        <a class="link-btn" href="https://www.google.com/searchbyimage" target="_blank" rel="noopener">Google (search by image)</a>
        <a class="link-btn" href="https://yandex.com/images/" target="_blank" rel="noopener">Yandex Images</a>
        <a class="link-btn" href="https://graph.baidu.com/pcpage/index?entry=shitu" target="_blank" rel="noopener">Baidu (图寻)</a>
        <a class="link-btn" href="https://tineye.com/" target="_blank" rel="noopener">TinEye</a>
        <a class="link-btn" href="https://www.bing.com/visualsearch" target="_blank" rel="noopener">Bing Visual Search</a>
      </div>
    `;
  }

  function runOcr(file) {
    const status = $('ocrStatus');
    const out = $('ocrOutput');
    status.textContent = 'Loading OCR engine (Tesseract.js)…';
    out.textContent = '';
    // lazy load tesseract.js from CDN
    if (!window.Tesseract) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => doOcr(file, status, out);
      s.onerror = () => { status.textContent = 'Failed to load OCR engine.'; };
      document.head.appendChild(s);
    } else {
      doOcr(file, status, out);
    }
  }

  function doOcr(file, status, out) {
    status.textContent = 'Running OCR…';
    const url = URL.createObjectURL(file);
    window.Tesseract.recognize(url, 'eng+chi_sim+jpn+ara+rus', {
      logger: (m) => { if (m.status === 'recognizing text') status.textContent = `OCR: ${Math.round(m.progress * 100)}%`; },
    }).then((res) => {
      URL.revokeObjectURL(url);
      const text = (res.data.text || '').trim();
      out.textContent = text || '(no text detected)';
      status.textContent = 'OCR complete.';
      // extract candidate clues: numbers, all-caps, capitalized words
      const clues = extractClues(text);
      renderClues(clues);
    }).catch((err) => {
      URL.revokeObjectURL(url);
      status.textContent = 'OCR failed: ' + (err && err.message ? err.message : err);
    });
  }

  function extractClues(text) {
    const clues = [];
    // phone numbers
    const phones = text.match(/\+?\d[\d\s\-()]{6,}\d/g) || [];
    phones.forEach((p) => clues.push({ type: 'phone', value: p.trim() }));
    // email
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    emails.forEach((e) => clues.push({ type: 'email', value: e }));
    // URLs
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    urls.forEach((u) => clues.push({ type: 'url', value: u }));
    // postal codes (4-6 digit standalone)
    const postals = text.match(/\b\d{4,6}\b/g) || [];
    postals.forEach((p) => clues.push({ type: 'number', value: p }));
    // capitalized words (likely place names)
    const caps = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) || [];
    const uniq = new Set();
    caps.forEach((c) => { if (!uniq.has(c)) { uniq.add(c); clues.push({ type: 'name', value: c }); } });
    return clues;
  }

  function renderClues(clues) {
    const panel = $('cluesPanel');
    if (!clues.length) {
      panel.innerHTML = '<div class="exif-empty">No obvious clues extracted. Try reverse image search.</div>';
      return;
    }
    const groups = {};
    clues.forEach((c) => { (groups[c.type] = groups[c.type] || []).push(c.value); });
    const labels = { phone: 'Phone', email: 'Email', url: 'URL', number: 'Number', name: 'Name' };
    let html = '';
    for (const type of Object.keys(groups)) {
      html += `<div class="clue-group"><strong>${labels[type] || type}:</strong> ${groups[type].map((v) => `<span class="clue-chip">${escapeHtml(v)}</span>`).join(' ')}</div>`;
    }
    // copy button
    const allText = clues.map((c) => c.value).join(', ');
    html += `<div class="clue-actions"><button type="button" class="btn" id="copyClues">Copy clues</button></div>`;
    panel.innerHTML = html;
    const btn = $('copyClues');
    if (btn) btn.addEventListener('click', () => {
      navigator.clipboard.writeText(allText).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy clues'; }, 1500); });
    });
  }

  function handleFile(file) {
    if (!file) return;
    currentFile = file;
    showImage(file);
    $('results').hidden = false;
    $('reverseLinks').innerHTML = '';
    buildReverseSearchLinks(file);
    $('cluesPanel').innerHTML = '';
    $('ocrOutput').textContent = '';
    $('ocrStatus').textContent = '';
    $('exifPanel').innerHTML = '<div class="exif-empty">Reading EXIF…</div>';
    $('mapWrap').hidden = true;

    const reader = new FileReader();
    reader.onload = (e) => {
      const buf = e.target.result;
      let exif = null;
      try { exif = window.GeoExif.parseExif(buf); } catch (err) { console.error(err); }
      currentExif = exif || {};
      renderExif(currentExif);
      if (currentExif.lat !== undefined && currentExif.lon !== undefined) {
        showMap(currentExif.lat, currentExif.lon);
        $('verdict').innerHTML = `<div class="verdict good">📍 GPS found in EXIF: ${currentExif.lat.toFixed(6)}, ${currentExif.lon.toFixed(6)}</div>`;
      } else {
        $('verdict').innerHTML = `<div class="verdict warn">No GPS in EXIF. Running OCR for clues…</div>`;
        runOcr(file);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function setupDrop() {
    const zone = $('dropZone');
    const input = $('fileInput');
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragging'); if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupDrop();
  });
})();

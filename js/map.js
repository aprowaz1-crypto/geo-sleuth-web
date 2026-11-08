// Leaflet wrapper for Geo-Sleuth Web.
(function (global) {
  'use strict';

  const state = { map: null, marker: null, accuracy: null, heading: null, container: null };

  function destroy() {
    if (state.map) {
      try { state.map.remove(); } catch (e) { /* ignore */ }
    }
    state.map = null;
    state.marker = null;
    state.accuracy = null;
    state.heading = null;
    state.container = null;
  }

  function init(opts) {
    if (!global.L) return false;
    const el = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    if (!el) return false;
    destroy();
    state.container = el;
    el.innerHTML = '';

    const lat = Number(opts.lat);
    const lon = Number(opts.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

    const map = global.L.map(el, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      worldCopyJump: true,
    }).setView([lat, lon], Number.isFinite(opts.zoom) ? opts.zoom : 16);

    const labels = opts.labels || {};
    const dark = global.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    });
    const osm = global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
    const satellite = global.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri',
    });
    const topo = global.L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    });

    const base = (opts.theme || document.documentElement.dataset.theme) === 'light' ? osm : dark;
    base.addTo(map);

    const layerControl = global.L.control.layers({
      [labels.dark || 'Dark']: dark,
      [labels.osm || 'OSM']: osm,
      [labels.satellite || 'Satellite']: satellite,
      [labels.topo || 'Topo']: topo,
    }, null, { position: 'topright', collapsed: true });
    layerControl.addTo(map);

    global.L.control.scale({ imperial: false, maxWidth: 130 }).addTo(map);

    const pin = global.L.divIcon({
      className: 'geo-pin-wrap',
      html: '<div class="geo-pin"><span class="geo-pin-dot"></span></div>',
      iconSize: [30, 42],
      iconAnchor: [15, 40],
      popupAnchor: [0, -34],
    });
    const marker = global.L.marker([lat, lon], { icon: pin, keyboard: false }).addTo(map);
    const popupHtml = opts.popupHtml || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    marker.bindPopup(popupHtml);

    const accuracyM = Number.isFinite(opts.accuracy) && opts.accuracy > 0
      ? Math.min(Math.max(opts.accuracy, 5), 10000)
      : 30;
    const accuracy = global.L.circle([lat, lon], {
      radius: accuracyM,
      color: '#38d9ff',
      weight: 1,
      opacity: 0.5,
      fillColor: '#38d9ff',
      fillOpacity: 0.07,
      interactive: false,
    }).addTo(map);

    let headingLayer = null;
    if (Number.isFinite(opts.heading)) {
      const heading = Number(opts.heading);
      const left = global.GeoSun.destinationPoint(lat, lon, heading - 24, 190);
      const tip = global.GeoSun.destinationPoint(lat, lon, heading, 240);
      const right = global.GeoSun.destinationPoint(lat, lon, heading + 24, 190);
      headingLayer = global.L.polygon([
        [lat, lon],
        [left.lat, left.lon],
        [tip.lat, tip.lon],
        [right.lat, right.lon],
      ], {
        color: '#a78bfa',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#a78bfa',
        fillOpacity: 0.18,
        interactive: false,
      }).addTo(map);
    }

    if (typeof opts.onMove === 'function') {
      map.on('mousemove', (e) => opts.onMove(e.latlng));
      map.on('mouseout', () => opts.onMove(null));
    }

    state.map = map;
    state.marker = marker;
    state.accuracy = accuracy;
    state.heading = headingLayer;

    setTimeout(() => {
      try { map.invalidateSize(); } catch (e) { /* ignore */ }
    }, 150);
    return true;
  }

  function invalidate() {
    if (state.map) {
      try { state.map.invalidateSize(); } catch (e) { /* ignore */ }
    }
  }

  function setView(lat, lon, zoom) {
    if (!state.map) return;
    try { state.map.setView([lat, lon], zoom || state.map.getZoom()); } catch (e) { /* ignore */ }
  }

  function isReady() { return !!state.map; }

  global.GeoMapView = { init, destroy, invalidate, setView, isReady };
})(window);

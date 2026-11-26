(function(){
/* ============================================================
   FIND A MOSQUE :: live map ("Mosques around you").

   Fed by find-a-mosque.js: WWPMap.render(plan, loc) after each
   /api/mosques/plan answer. Leaflet is vendored (assets/vendor/leaflet)
   and loaded the first time the map is needed.

   Rules:
   - Pin colour = can you make the next Jama'ah from where you are?
       green  = yes     red = may miss it
       grey   = done for today / no time on record
   - Pins shrink to dots when zoomed out (crowded areas stay readable).
   - Tap a pin: a card with distance, travel time, next Jama'ah,
     leave-by, today's Jama'ah (expandable) and "Getting there".
   - Map colours follow the site theme (light tiles on light themes,
     dark tiles on dark/AMOLED).
   - Map never recentres itself on refresh; only a new location does.
   ============================================================ */

  const LEAFLET_JS = '/assets/vendor/leaflet/leaflet.js';
  const PRAYER_LABELS = { fajr: 'Fajr', zuhr: 'Zuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
  const PRAYER_KEYS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];
  const DEFAULT_ZOOM = 14;

  let map = null;
  let pinLayer = null;
  let youLayer = null;
  let tileLayer = null;
  let tileMode = null;
  let leafletPromise = null;
  let currentLoc = null;
  let hasCentred = false;
  let entriesBySlug = new Map();
  let openSlug = null;
  let lastPlan = null;

  function el(id){ return document.getElementById(id); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function loadLeaflet(){
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('leaflet failed to load')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  // ---- theme: pick light or dark tiles from the page background -------
  function isDarkTheme(){
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 110;
  }
  function themeVar(name, fallback){
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function applyTiles(){
    const mode = isDarkTheme() ? 'dark_all' : 'light_all';
    if (mode === tileMode || !map) return;
    tileMode = mode;
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = window.L.tileLayer(`https://{s}.basemaps.cartocdn.com/${mode}/{z}/{x}/{y}{r}.png`, {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);
  }

  // ---- pins ------------------------------------------------------------
  function pinColour(e){
    if (e.state === 'active' && e.canMakeIt === true) return themeVar('--green', '#4C9A6A');
    if (e.state === 'active' && e.canMakeIt === false) return themeVar('--red', '#D8654A');
    return themeVar('--text-faint', '#B4A896');
  }
  function pinRadius(){
    const z = map ? map.getZoom() : DEFAULT_ZOOM;
    return z >= 15 ? 9 : z >= 13 ? 7 : 5;
  }

  function ensureMap(){
    return loadLeaflet().then(L => {
      if (map) return map;
      const host = el('mqMap');
      if (!host) return null;
      map = L.map(host, { zoomControl: true, attributionControl: true }).setView([currentLoc.lat, currentLoc.lon], DEFAULT_ZOOM);
      pinLayer = L.layerGroup().addTo(map);
      youLayer = L.layerGroup().addTo(map);
      map.on('zoomend', () => {
        pinLayer.eachLayer(layer => { if (layer.setRadius) layer.setRadius(pinRadius()); });
      });
      map.on('click', closeCard);
      applyTiles();
      return map;
    });
  }

  function drawPins(){
    const L = window.L;
    pinLayer.clearLayers();
    youLayer.clearLayers();
    L.circleMarker([currentLoc.lat, currentLoc.lon], {
      radius: 7, color: '#fff', weight: 2, fillColor: themeVar('--coral', '#F4714E'), fillOpacity: 1, interactive: false
    }).addTo(youLayer);

    entriesBySlug.forEach(e => {
      if (e.latitude == null || e.longitude == null) return;
      const m = L.circleMarker([e.latitude, e.longitude], {
        radius: pinRadius(), color: '#fff', weight: 2,
        fillColor: pinColour(e), fillOpacity: 1
      });
      m.on('click', ev => { if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev); openCard(e.slug, true); });
      m.addTo(pinLayer);
    });
  }

  // ---- card ------------------------------------------------------------
  function formatIn(mins){
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m === 0 ? `in ${h}hr` : `in ${h}hr ${m}min`;
  }

  function leaveByLine(e){
    if (e.state !== 'active' || e.jamaahInMinutes == null) return '';
    if (e.canMakeIt === false) return '<div class="mqm-leave is-tight">May miss it at this travel time</div>';
    const leaveIn = e.jamaahInMinutes - e.travelMinutes;
    return `<div class="mqm-leave">${leaveIn <= 0 ? 'Leave now' : `Leave in ${leaveIn} min`}</div>`;
  }

  function timeOf(v){
    if (!v) return null;
    if (typeof v === 'string') return v;
    return v.time || null;
  }

  function cardHtml(e){
    const travelWord = e.travelMode === 'walk' ? 'walk' : 'drive';
    let next;
    if (e.state === 'no_times') next = `<div class="mqm-next is-muted">No Jama'ah time yet</div>`;
    else if (!e.prayer) next = `<div class="mqm-next is-muted">Done for today · tomorrow's Fajr ${esc(e.tomorrowFajr || '')}</div>`;
    else {
      const label = (PRAYER_LABELS[e.prayer] || e.prayer) + (e.isTomorrow ? ' · tomorrow' : '');
      const when = e.isTomorrow ? '' : ` · ${formatIn(e.jamaahInMinutes)}`;
      next = `<div class="mqm-next"><span class="mqm-next-label">Next: ${esc(label)}</span> <strong>${esc(e.time)}</strong>${esc(when)}</div>`;
    }
    const rows = PRAYER_KEYS.map(k => {
      const t = timeOf(e.today && e.today[k]);
      const passed = e.prayer && e.prayer !== k && !e.isTomorrow && PRAYER_KEYS.indexOf(k) < PRAYER_KEYS.indexOf(e.prayer);
      return t ? `<div class="mqm-time${passed ? ' is-passed' : ''}"><span>${PRAYER_LABELS[k]}</span><strong>${esc(t)}</strong></div>` : '';
    }).join('');
    const dest = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.latitude + ',' + e.longitude)}`;
    return `
      <div class="mqm-card-head">
        <div>
          <div class="mqm-name">${esc(e.name)}</div>
          <div class="mqm-sub">${e.distanceMiles} mi · ${e.travelMinutes} min ${travelWord}</div>
        </div>
        <button type="button" class="mqm-close" aria-label="Close">×</button>
      </div>
      ${next}
      ${leaveByLine(e)}
      <details class="mqm-times">
        <summary>Today's Jama'ah</summary>
        <div class="mqm-times-grid">${rows || '<div class="mqm-next is-muted">No times on record</div>'}</div>
      </details>
      <a class="mqm-dir" href="${dest}" target="_blank" rel="noopener">🧭 Getting there</a>`;
  }

  function openCard(slug, pan){
    const e = entriesBySlug.get(slug);
    const card = el('mqMapCard');
    if (!e || !card) return;
    openSlug = slug;
    card.innerHTML = cardHtml(e);
    card.classList.remove('hidden');
    const close = card.querySelector('.mqm-close');
    if (close) close.addEventListener('click', closeCard);
    // Keep the mosque's list card in step if it is on screen.
    if (pan && map) map.panTo([e.latitude, e.longitude], { animate: true });
  }
  function closeCard(){
    openSlug = null;
    const card = el('mqMapCard');
    if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
  }

  // ---- public ----------------------------------------------------------
  function render(plan, loc){
    const host = el('mqMap');
    if (!host || !plan || !Array.isArray(plan.mosques) || !loc) return;
    lastPlan = plan;
    const moved = !currentLoc || Math.abs(currentLoc.lat - loc.lat) > 0.0005 || Math.abs(currentLoc.lon - loc.lon) > 0.0005;
    currentLoc = loc;
    entriesBySlug = new Map();
    [...(plan.pinned || []), ...plan.mosques].forEach(e => {
      if (e && e.slug && e.latitude != null && e.longitude != null && !entriesBySlug.has(e.slug)) entriesBySlug.set(e.slug, e);
    });
    host.parentElement.classList.remove('hidden');
    ensureMap().then(() => {
      if (!map) return;
      applyTiles();
      drawPins();
      if (!hasCentred || moved) {
        map.setView([loc.lat, loc.lon], hasCentred ? map.getZoom() : DEFAULT_ZOOM, { animate: hasCentred });
        hasCentred = true;
        closeCard();
      }
      if (openSlug) {
        if (entriesBySlug.has(openSlug)) openCard(openSlug); else closeCard();
      }
      setTimeout(() => map && map.invalidateSize(), 0);
    }).catch(() => { /* map is an extra; the list still works */ });
  }

  window.WWPMap = { render };
})();

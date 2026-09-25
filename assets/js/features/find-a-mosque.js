(function(){
/* ============================================================
   FIND A MOSQUE :: "Mosques near you".

   Rules (see functions/api/mosques/plan.js):
   1. Closest mosques first, always - 3 by default, the person can pick
      1 to 10 ("Show [n] nearest", remembered on this device).
   2. Every mosque has a card, times or not. Once a mosque's last
      Jama'ah of the day has passed its card is greyed out showing
      tomorrow's Fajr; after midnight it's back to normal on its own.
      Mosques are never hidden because of the time.
   3. Tap a card: today's Jama'ah (passed ones dimmed, the next one
      highlighted), the address, and "Getting there" (Google Maps) /
      Waze.
   4. ☆ favourites (up to 10, stored on this device) show in their own
      section wherever they are. "Hide this mosque" (in a mosque's card)
      removes it from the list; the settings panel at the bottom brings
      it back, and holds "how many nearest" and the reset button. Search looks up any mosque by name,
      town or postcode - in the browser, against a daily directory.

   ---- LOCATION :: four independent sources, best-wins ----
   Previous version only tried GPS *silently* (skipped unless the
   browser already had a saved "granted" permission), which meant
   almost every visit — desktop or mobile, first time or returning —
   fell straight to IP-based geo, which can be miles off. That's the
   "always shows the same random mosques" bug.

   Now all four sources are genuinely independent — no source's
   success or failure depends on another:
     1. GEO    — real GPS (Platform.getLocation). Requested directly
                 on load, not gated behind a silent permission check.
                 iOS Safari can swallow an auto-prompt with no tap
                 behind it, so this may quietly do nothing there —
                 harmless, since it races against three others, and
                 the always-visible "Use precise location" button
                 below covers that case with a real tap.
     2. EDGE   — same-origin /api/geo, Cloudflare's own per-request
                 IP geolocation. No permission dialog, no 3rd party.
     3. IP     — REMOVED 25 Sep 2026 (sent the IP to geojs.io, a
                 third party). EDGE above covers the same need.
     4. MANUAL — a postcode/place box (always visible, not gated
                 behind failure). A postcode or outcode ("IG2 7HS",
                 "E14") is looked up via postcodes.io (real Royal
                 Mail data); a free-text area name ("Poplar",
                 "Redbridge") via Photon (OpenStreetMap), which has
                 proper London neighbourhood-level detail, filtered
                 to a UK match. Always wins over an automatic guess
                 since it's what the person typed.

   All four race in parallel; whichever most-precise one lands wins
   (rank: manual 5 > geo 4 > edge/ip 2 > cached-from-last-visit 1),
   and a later, more precise result silently upgrades an earlier,
   coarser one — never the other way round.

   Privacy: coordinates are rounded to 3 decimal places (~110m) the
   moment they're received, before they're used, cached, or sent
   anywhere — plenty precise for picking the right mosque, without
   keeping or transmitting an exact GPS fix. The plan request itself
   is a POST with the coordinates in the body, not a GET with them in
   the URL, so they don't end up in access logs, browser history, or
   a Referer header. The server already never stores a visitor's
   location (functions/api/mosques/plan.js computes the match and
   returns it — nothing is written to D1/KV); this doesn't change
   that, it just keeps the coordinates out of transit-level logs too.

   deviceHeaders, escapeHtml: shared, defined once in wwp-core.js.
   ============================================================ */
  const PRAYER_LABELS = {fajr:'Fajr', zuhr:'Dhuhr', asr:'Asr', maghrib:'Maghrib', isha:'Isha'};
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches the plan endpoint's own refresh cadence
  const REFRESH_MS = 5 * 60 * 1000;   // re-check every 5 min while the page is open
  const PLAN_CACHE_KEY = 'wwp_mq_plan_v3';
  const USUAL_MOSQUE_KEY = 'wwp_usual_mosque_slug'; // same key the old list view used — carries over any existing saved choice
  const LOCATION_OPTS = { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 };
  const POSTCODES_IO_BASE = 'https://api.postcodes.io';
  const PHOTON_BASE = 'https://photon.komoot.io/api/';
  const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
  // A full UK postcode ("IG2 7HS") vs just its first half, an "outcode"
  // ("IG2", "E14") — both are looked up via postcodes.io, which has
  // real Royal Mail data, rather than a general place-name geocoder
  // (which doesn't carry postcode-level data at all).
  const FULL_POSTCODE_RE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\d[A-Za-z]{2}$/;
  const OUTCODE_RE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/;
  // Higher = more precise/trusted. A result only ever replaces the
  // current one if it's strictly higher rank (or the person just
  // explicitly asked for a fresh fix) — a fast-but-coarse source can
  // never clobber a slow-but-precise one that already landed.
  const LOCATION_RANK = { manual: 5, geo: 4, edge: 2, ip: 2, cached: 1 };

  let mqTimer = null;
  let mqLocation = null; // {lat, lon, source, label} once known

  function getUsualMosque(){
    return window.LocalCache ? window.LocalCache.get(USUAL_MOSQUE_KEY, null) : null;
  }
  function setUsualMosque(slug){
    if (window.LocalCache) window.LocalCache.set(USUAL_MOSQUE_KEY, slug);
  }
  function clearUsualMosque(){
    if (window.LocalCache) window.LocalCache.remove(USUAL_MOSQUE_KEY);
  }

  function readCachedPlan(){
    if (!window.LocalCache) return null;
    const entry = window.LocalCache.get(PLAN_CACHE_KEY, null);
    if (!entry || !entry.savedAt) return null;
    if (Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry;
  }
  function writeCachedPlan(loc, plan){
    if (!window.LocalCache) return;
    window.LocalCache.set(PLAN_CACHE_KEY, {
      lat: loc.lat, lon: loc.lon, label: loc.label || null, plan, savedAt: Date.now()
    });
  }

  // Rounds to ~110m — enough to pick the right mosque, without
  // keeping/sending an exact fix. Applied the instant a coordinate is
  // received, before it touches state, cache, or the network.
  function roundCoord(v){ return Math.round(v * 1000) / 1000; }

  async function fetchWithTimeout(url, opts, ms){
    const controller = new AbortController();
    const t = setTimeout(()=> controller.abort(), ms);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  // ---- Source 1: real GPS ----
  // Requested directly, not gated behind a silent permission check —
  // on most browsers the native prompt appears fine without a prior
  // tap. iOS Safari is the known exception (a hard-won gotcha from
  // the old code): it can swallow an automatic prompt with no dialog
  // ever appearing. That's harmless here since this races against
  // three independent sources, and the always-visible "Use precise
  // location" button covers iOS with a real tap.
  function gpsLocation(){
    if (!window.Platform || typeof window.Platform.getLocation !== 'function') return Promise.resolve(null);
    return window.Platform.getLocation(LOCATION_OPTS)
      .then(loc => ({ lat: roundCoord(loc.lat), lon: roundCoord(loc.lon), source: 'geo' }))
      .catch(() => null);
  }

  // ---- Source 2: same-origin Cloudflare edge geo ----
  async function edgeGeoLocation(){
    try {
      const res = await fetchWithTimeout('/api/geo', { cache: 'no-store' }, 3000);
      if (res.ok) {
        const d = await res.json();
        if (typeof d.lat === 'number' && typeof d.lon === 'number') {
          return { lat: roundCoord(d.lat), lon: roundCoord(d.lon), source: 'edge' };
        }
      }
    } catch (e) { /* offline, or function not deployed — give up */ }
    return null;
  }

  // (Former Source 3 — third-party IP lookup via geojs.io — removed
  // 25 Sep 2026: it sent the visitor's IP to a third party without
  // consent. The same-origin /api/geo edge lookup above covers it.)

  // ---- Source 4: manual postcode/place entry ----
  // Two different lookups depending on what was typed, since neither
  // service alone covers both well:
  //   - A postcode or outcode ("IG2 7HS", "E14") → postcodes.io, the
  //     real Royal Mail/ONS dataset. A general place-name geocoder
  //     (tried first, originally) simply doesn't have postcode-level
  //     UK data, which is why postcodes always came back "not found".
  //   - A free-text place/area name ("Poplar", "Redbridge") → Photon
  //     (OpenStreetMap data), which has proper London
  //     neighbourhood-level detail. The previous Open-Meteo geocoder
  //     is city-level only — it matched "Poplar" to whichever
  //     same-named place ranked first worldwide, which is why it
  //     silently returned the wrong location instead of E14.
  // A full postcode covers one street or block of flats - far more precise
  // than a ward (a council voting area of ~10,000 people). The label is
  // built from the postcode itself plus the nearest neighbourhood name
  // (e.g. "IG2 7HS · Newbury Park"), never the ward.
  // A postcode's centre point isn't a personal GPS fix, so it's kept to
  // 4 decimal places (~11m) rather than the ~110m rounding used for GPS.
  function roundPostcodeCoord(v){ return Math.round(v * 10000) / 10000; }

  async function geocodePostcode(compact){
    const res = await fetchWithTimeout(POSTCODES_IO_BASE + '/postcodes/' + encodeURIComponent(compact), null, 5000);
    if (!res.ok) return null; // 404 = genuinely not a postcode on record
    const data = await res.json();
    const r = data && data.result;
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    const lat = roundPostcodeCoord(r.latitude), lon = roundPostcodeCoord(r.longitude);
    const area = await neighbourhoodName(lat, lon);
    return {
      lat, lon,
      label: postcodeLabel(r.postcode || compact, area, r.admin_district),
      source: 'manual'
    };
  }

  async function geocodeOutcode(compact){
    const res = await fetchWithTimeout(POSTCODES_IO_BASE + '/outcodes/' + encodeURIComponent(compact), null, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data && data.result;
    if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
    const district = r.admin_district && r.admin_district[0] ? r.admin_district[0] : null;
    return {
      lat: roundCoord(r.latitude), lon: roundCoord(r.longitude),
      label: postcodeLabel(r.outcode || compact, null, district),
      source: 'manual'
    };
  }

  // "IG2 7HS · Newbury Park", or "IG2 7HS, Redbridge" if no neighbourhood
  // name came back.
  function postcodeLabel(pc, area, district){
    const code = String(pc || '').toUpperCase().trim();
    if (area) return code + ' · ' + area;
    return district ? code + ', ' + district : code;
  }

  // Nearest named neighbourhood (Newbury Park, Gants Hill, Seven Kings...)
  // from OpenStreetMap via Photon. Best effort - never blocks a result.
  async function neighbourhoodName(lat, lon){
    const base = PHOTON_REVERSE + '?lat=' + lat + '&lon=' + lon + '&lang=en&limit=1';
    // 1st try: nearest neighbourhood/suburb place itself.
    try {
      const res = await fetchWithTimeout(base + '&layer=district&layer=locality', null, 3000);
      if (res.ok) {
        const d = await res.json();
        const p = d && d.features && d.features[0] && d.features[0].properties;
        const n = p && (p.name || p.district || p.locality);
        if (n) return n;
      }
    } catch (e) { /* fall through */ }
    // 2nd try: nearest address, and the neighbourhood it belongs to.
    try {
      const res = await fetchWithTimeout(base, null, 3000);
      if (res.ok) {
        const d = await res.json();
        const p = d && d.features && d.features[0] && d.features[0].properties;
        const n = p && (p.district || p.locality || p.city);
        if (n) return n;
      }
    } catch (e) { /* no name - postcode alone is still shown */ }
    return null;
  }

  async function geocodePlaceName(query){
    const url = PHOTON_BASE + '?q=' + encodeURIComponent(query) + '&limit=5&lang=en';
    const res = await fetchWithTimeout(url, null, 6000);
    if (!res.ok) throw new Error('Location search failed');
    const data = await res.json();
    const features = (data && data.features) || [];
    if (!features.length) throw new Error("Couldn't find that place");
    // This is a UK-only mosque finder, so among same-named matches
    // worldwide, prefer one actually in the UK rather than blindly
    // taking whichever ranks first.
    const uk = features.find(f => f.properties && f.properties.country === 'United Kingdom');
    const f = uk || features[0];
    const coords = f.geometry && f.geometry.coordinates; // Photon returns [lon, lat]
    if (!coords) throw new Error("Couldn't find that place");
    const p = f.properties || {};
    const label = [p.name, p.city || p.district || p.county || p.state].filter(Boolean).join(', ') || query;
    return { lat: roundCoord(coords[1]), lon: roundCoord(coords[0]), label, source: 'manual' };
  }

  async function geocodeManual(query){
    const trimmed = query.trim();
    const compact = trimmed.replace(/\s+/g, '').toUpperCase();
    if (FULL_POSTCODE_RE.test(compact)) {
      const loc = await geocodePostcode(compact);
      if (loc) return loc;
    } else if (OUTCODE_RE.test(compact)) {
      const loc = await geocodeOutcode(compact);
      if (loc) return loc;
    }
    return geocodePlaceName(trimmed);
  }

  // Best-effort place name for auto-detected fixes — never blocks
  // rendering the plan; just fills in the label a moment later.
  // postcodes.io's "nearest postcodes" lookup doubles as a UK-relevant
  // reverse geocoder — ward + district reads better than a generic
  // city name for this app's audience.
  // GPS gets the nearest postcode + neighbourhood ("IG2 7HS · Newbury
  // Park"). IP-based guesses are only town-level accurate, so they get
  // just the borough - showing a postcode there would look more precise
  // than it is.
  async function reverseGeocodeLabel(lat, lon, precise){
    try {
      const url = POSTCODES_IO_BASE + '/postcodes?lon=' + lon + '&lat=' + lat + '&limit=1';
      const res = await fetchWithTimeout(url, null, 3500);
      if (!res.ok) return null;
      const data = await res.json();
      const r = data && data.result && data.result[0];
      if (!r) return null;
      if (!precise) return r.admin_district || null;
      const area = await neighbourhoodName(lat, lon);
      return postcodeLabel(r.postcode, area, r.admin_district);
    } catch (e) { /* skip — generic source label still shown */ }
    return null;
  }

  function locationBarText(loc){
    if (!loc) return '';
    if (loc.source === 'manual') return 'Showing mosques near ' + (loc.label || 'your search') + '.';
    if (loc.source === 'cached') return 'Last known location — updating…';
    if (loc.source === 'geo') return loc.label ? 'Using your precise location near ' + loc.label + '.' : 'Using your precise location.';
    return loc.label ? 'Using your approximate area near ' + loc.label + '.' : 'Using your approximate area.';
  }

  function renderLocationLabel(){
    const el = document.getElementById('mqLocationLabel');
    if (!el) return;
    el.textContent = mqLocation ? locationBarText(mqLocation) : '';
  }

  async function fetchPlan(lat, lon){
    // POST with coords in the body (not a GET query string) so they
    // never land in access logs, browser history, or a Referer header.
    const pins = getFavs().map(f => ({ slug: f.slug, lat: f.lat, lon: f.lon }));
    if (searchPin && !pins.some(p => p.slug === searchPin.slug)) pins.push({ slug: searchPin.slug, lat: searchPin.lat, lon: searchPin.lon });
    const res = await fetch('/api/mosques/plan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, deviceHeaders()),
      body: JSON.stringify({ lat, lon, count: getCount(), pins, exclude: getHidden().map(h => h.slug) })
    });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    return res.json();
  }

  function renderSkeleton(){
    const list = document.getElementById('mqList');
    if (!list) return;
    list.innerHTML = `
      <div class="mq-plan-card">
        <div class="mq-plan-header">
          <span class="mq-plan-icon" aria-hidden="true">🕌</span>
          <div>
            <h2>Mosques near you</h2>
            <p>Closest first. Tap a mosque for today's Jama'ah times and directions.</p>
          </div>
        </div>
        <div class="mq-plan-rows">
          ${[0,1,2].map(()=>`
            <div class="mq-plan-row mq-plan-skeleton">
              <span class="mq-plan-row-icon" aria-hidden="true">📍</span>
              <div class="mq-plan-row-main">
                <div class="mq-skel-line mq-skel-name"></div>
                <div class="mq-skel-line mq-skel-sub"></div>
              </div>
              <div class="mq-skel-chip"></div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderNoLocationYet(){
    const list = document.getElementById('mqList');
    if (!list) return;
    list.innerHTML = `
      <div class="mq-plan-card mq-plan-empty">
        <span class="mq-plan-icon" aria-hidden="true">📍</span>
        <h2>We couldn't work out your location</h2>
        <p>Use "Use precise location" or enter a postcode/area above to see nearby mosques.</p>
      </div>`;
  }

  function renderNote(note){
    const list = document.getElementById('mqList');
    if (!list) return;
    list.innerHTML = `
      <div class="mq-plan-card mq-plan-empty">
        <span class="mq-plan-icon" aria-hidden="true">🕌</span>
        <h2>Nothing left today nearby</h2>
        <p>${escapeHtml(note)}</p>
      </div>`;
  }

  function formatMinutesUntil(mins){
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `in ${h}hr` : `in ${h}hr ${m}min`;
  }

  // ============================================================
  //   CARDS - closest first, always.
  //   state from the server (functions/api/mosques/plan.js):
  //     active     next Jama'ah still to come today
  //     done_today all of today's have passed -> greyed out, showing
  //                tomorrow's Fajr; back to normal after midnight
  //     no_times   nothing on record -> "No Jama'ah time yet"
  //   Tap a card: today's Jama'ah, address, "Getting there".
  // ============================================================
  const COUNT_KEY = 'wwp_mq_count';
  const FAVS_KEY = 'wwp_mq_favs_v1';
  const HIDDEN_KEY = 'wwp_mq_hidden_v1';
  const MAX_HIDDEN = 100;
  const MAX_FAVS = 10;
  const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const PRAYER_KEYS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];
  let searchPin = null;          // a mosque picked from search: {slug, name, lat, lon}
  let openAfterRender = null;    // slug whose card should open once drawn
  let lastPlan = null;
  let entriesBySlug = new Map();

  function getCount(){
    const n = window.LocalCache ? parseInt(window.LocalCache.get(COUNT_KEY, 3), 10) : 3;
    return n >= 1 && n <= 10 ? n : 3;
  }
  function setCount(n){ if (window.LocalCache) window.LocalCache.set(COUNT_KEY, n); }
  function getFavs(){
    const f = window.LocalCache ? window.LocalCache.get(FAVS_KEY, []) : [];
    return Array.isArray(f) ? f.filter(x => x && x.slug) : [];
  }
  function isFav(slug){ return getFavs().some(f => f.slug === slug); }
  function getHidden(){
    const h = window.LocalCache ? window.LocalCache.get(HIDDEN_KEY, []) : [];
    return Array.isArray(h) ? h.filter(x => x && x.slug) : [];
  }
  function hideMosque(e){
    const list = getHidden().filter(h => h.slug !== e.slug);
    list.push({ slug: e.slug, name: e.name });
    if (window.LocalCache) {
      window.LocalCache.set(HIDDEN_KEY, list.slice(-MAX_HIDDEN));
      window.LocalCache.set(FAVS_KEY, getFavs().filter(f => f.slug !== e.slug)); // hidden = not a favourite
    }
  }
  function unhideMosque(slug){
    if (window.LocalCache) window.LocalCache.set(HIDDEN_KEY, getHidden().filter(h => h.slug !== slug));
  }
  function toggleFav(m){
    let favs = getFavs();
    if (favs.some(f => f.slug === m.slug)) favs = favs.filter(f => f.slug !== m.slug);
    else {
      if (favs.length >= MAX_FAVS) { alert('You can favourite up to ' + MAX_FAVS + ' mosques.'); return false; }
      favs.push({ slug: m.slug, name: m.name, lat: m.latitude ?? m.lat, lon: m.longitude ?? m.lon });
    }
    if (window.LocalCache) window.LocalCache.set(FAVS_KEY, favs);
    return true;
  }

  function starHtml(slug){
    const on = isFav(slug);
    return `<button type="button" class="mq-star${on ? ' is-on' : ''}" data-star="${escapeHtml(slug)}" aria-pressed="${on}" aria-label="${on ? 'Remove from favourites' : 'Add to favourites'}">${on ? '★' : '☆'}</button>`;
  }

  function chipHtml(e){
    if (e.state === 'no_times') {
      return `<div class="mq-plan-chip is-empty"><div class="mq-plan-chip-note">No Jama'ah time yet</div></div>`;
    }
    if (!e.prayer) {
      return `<div class="mq-plan-chip is-empty"><div class="mq-plan-chip-note">Done for today</div></div>`;
    }
    const isEstimated = e.prayer === 'maghrib' && !e.isTomorrow && e.today && e.today.maghribEstimated;
    const label = (PRAYER_LABELS[e.prayer] || e.prayer) + (e.isTomorrow ? ' · tomorrow' : '');
    const sub = e.isTomorrow ? 'Done for today'
      : isEstimated ? 'Estimated for this area'
      : (e.canMakeIt === false ? 'May miss it' : formatMinutesUntil(e.jamaahInMinutes));
    return `
      <div class="mq-plan-chip${e.canMakeIt === false ? ' is-tight' : ''}">
        <div class="mq-plan-chip-label">${label}</div>
        <div class="mq-plan-chip-time">${escapeHtml(e.time)}</div>
        <div class="mq-plan-chip-countdown">${sub}</div>
      </div>`;
  }

  function cardHtml(e, tag){
    const travelWord = e.travelMode === 'walk' ? 'walk' : 'drive';
    const cls = ['mq-plan-row', 'mq-clickable'];
    if (tag === 'Closest') cls.push('is-primary');
    if (e.state === 'done_today') cls.push('is-done');
    if (e.state === 'no_times') cls.push('is-notimes');
    return `
      <div class="mq-item">
        <div class="${cls.join(' ')}" data-slug="${escapeHtml(e.slug)}" role="button" tabindex="0" aria-expanded="false">
          ${starHtml(e.slug)}
          <div class="mq-plan-row-main">
            <div class="mq-plan-row-name"${e.aliases && e.aliases.length ? ` title="Also known as ${escapeHtml(e.aliases.join(', '))}"` : ''}>${escapeHtml(e.name)}${tag ? `<span class="mq-plan-row-tag">${tag}</span>` : ''}</div>
            <div class="mq-plan-row-sub">${e.distanceMiles} mi · ${e.travelMinutes} min ${travelWord}</div>
          </div>
          ${chipHtml(e)}
        </div>
        <div class="mq-detail hidden"></div>
      </div>`;
  }

  function sectionHtml(title, entries, firstTag){
    if (!entries.length) return '';
    return `
      <div class="mq-section">
        ${title ? `<div class="mq-nearby-title">${title}</div>` : ''}
        <div class="mq-plan-rows">${entries.map((e, i) => cardHtml(e, i === 0 ? firstTag : '')).join('')}</div>
      </div>`;
  }

  function rememberEntries(plan){
    entriesBySlug = new Map();
    [...(plan.pinned || []), ...(plan.mosques || [])].forEach(e => {
      if (e && e.slug && !entriesBySlug.has(e.slug)) entriesBySlug.set(e.slug, e);
    });
  }

  function renderPlan(plan){
    const list = document.getElementById('mqList');
    if (!list) return;
    if (!plan || !Array.isArray(plan.mosques)) { renderNoLocationYet(); return; } // old cached shape
    lastPlan = plan;
    rememberEntries(plan);
    ensureControls();

    const pinned = plan.pinned || [];
    const favSlugs = new Set(getFavs().map(f => f.slug));
    const searched = searchPin ? pinned.filter(p => p.slug === searchPin.slug) : [];
    const favs = pinned.filter(p => favSlugs.has(p.slug));
    const nearest = plan.mosques;

    if (!nearest.length && !favs.length && !searched.length) {
      renderNote(plan.note || 'No mosques found near this location yet.');
      return;
    }
    list.innerHTML = `
      <div class="mq-plan-card">
        <div class="mq-plan-header">
          <span class="mq-plan-icon" aria-hidden="true">🕌</span>
          <div>
            <h2>Mosques near you</h2>
            <p>Closest first. Tap a mosque for today's Jama'ah times and directions.</p>
          </div>
        </div>
        ${sectionHtml('Search result', searched, '')}
        ${sectionHtml('Your favourites', favs, '')}
        ${sectionHtml(favs.length || searched.length ? 'Nearest' : '', nearest, 'Closest')}
      </div>`;

    if (openAfterRender) {
      const row = list.querySelector(`.mq-clickable[data-slug="${CSS.escape(openAfterRender)}"]`);
      openAfterRender = null;
      if (row) { toggleDetail(row, true); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
  }

  // ---- Detail: today's Jama'ah + getting there ----
  function detailHtml(e){
    const today = e.today || {};
    const hasAny = PRAYER_KEYS.some(k => today[k]);
    const nowMins = lastPlan ? lastPlan.generatedAtMinutes : null;
    const nextKey = (e.prayer && !e.isTomorrow) ? e.prayer : null;
    const toMins = (k, t) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return null;
      let h = +m[1]; if (k !== 'fajr' && h >= 1 && h <= 11) h += 12;
      return h * 60 + +m[2];
    };
    const grid = hasAny ? `
      <div class="mq-detail-times">
        ${PRAYER_KEYS.map(k => {
          const past = nowMins != null && today[k] && toMins(k, today[k]) < nowMins;
          return `
          <div class="mq-detail-cell${k === nextKey ? ' is-next' : ''}${past ? ' is-past' : ''}">
            <div class="mq-detail-prayer">${PRAYER_LABELS[k]}</div>
            <div class="mq-detail-time">${today[k] ? escapeHtml(today[k]) : '—'}</div>
            ${k === 'maghrib' && today.maghribEstimated ? `<div class="mq-detail-estimated">Estimated for this area</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${e.tomorrowFajr ? `<div class="mq-detail-note">Tomorrow's Fajr: <b>${escapeHtml(e.tomorrowFajr)}</b></div>` : ''}`
      : `<div class="mq-detail-note">No Jama'ah times on record for this mosque yet.</div>`;
    const where = [e.address, e.postcode].filter(Boolean).join(', ');
    let actions = '';
    if (e.latitude != null && e.longitude != null) {
      const ll = Number(e.latitude).toFixed(6) + ',' + Number(e.longitude).toFixed(6);
      actions = `
        <div class="mq-detail-actions">
          <a class="mq-dir-btn" href="https://www.google.com/maps/dir/?api=1&destination=${ll}" target="_blank" rel="noopener">🧭 Getting there</a>
          <a class="mq-dir-btn is-alt" href="https://waze.com/ul?ll=${ll}&navigate=yes" target="_blank" rel="noopener">Waze</a>
        </div>`;
    }
    const isUsual = getUsualMosque() === e.slug;
    const aliasLine = e.aliases && e.aliases.length
      ? `<div class="mq-detail-aliases">Also known as ${escapeHtml(e.aliases.join(', '))}</div>` : '';
    return `
      <div class="mq-detail-title">Today's Jama'ah</div>
      ${aliasLine}
      ${grid}
      ${where ? `<div class="mq-detail-address">📍 ${escapeHtml(where)}</div>` : ''}
      ${actions}
      <div class="mq-detail-links">
        <button type="button" class="mq-usual-btn${isUsual ? ' is-usual' : ''}" data-usual-slug="${escapeHtml(e.slug)}">${isUsual ? 'Saved as your usual mosque ✓' : 'Set as my usual mosque'}</button>
        <button type="button" class="mq-hide-btn" data-hide-slug="${escapeHtml(e.slug)}">Hide this mosque</button>
      </div>`;
  }

  function toggleDetail(row, forceOpen){
    const item = row.closest('.mq-item');
    const panel = item && item.querySelector('.mq-detail');
    if (!panel) return;
    const opening = forceOpen || panel.classList.contains('hidden');
    document.querySelectorAll('#mqList .mq-detail:not(.hidden)').forEach(p => {
      p.classList.add('hidden');
      const r = p.closest('.mq-item').querySelector('.mq-clickable');
      if (r) { r.setAttribute('aria-expanded', 'false'); r.classList.remove('is-open'); }
    });
    if (!opening) return;
    const e = entriesBySlug.get(row.dataset.slug);
    if (!e) return;
    panel.innerHTML = detailHtml(e);
    panel.classList.remove('hidden');
    row.setAttribute('aria-expanded', 'true');
    row.classList.add('is-open');
  }

  document.getElementById('mqList')?.addEventListener('click', (ev) => {
    const star = ev.target.closest('.mq-star');
    if (star) {
      ev.stopPropagation();
      const e = entriesBySlug.get(star.dataset.star);
      if (e && toggleFav(e)) { if (lastPlan) renderPlan(lastPlan); if (mqLocation) loadPlanForLocation(mqLocation); }
      return;
    }
    const hideBtn = ev.target.closest('.mq-hide-btn');
    if (hideBtn) {
      const e = entriesBySlug.get(hideBtn.dataset.hideSlug);
      if (e && confirm('Hide ' + e.name + '? You can bring it back in Find a Mosque settings at the bottom of the page.')) {
        hideMosque(e);
        renderSettings();
        if (lastPlan) {
          lastPlan = Object.assign({}, lastPlan, {
            mosques: lastPlan.mosques.filter(m => m.slug !== e.slug),
            pinned: (lastPlan.pinned || []).filter(m => m.slug !== e.slug)
          });
          renderPlan(lastPlan);
        }
        if (mqLocation) loadPlanForLocation(mqLocation);
      }
      return;
    }
    if (ev.target.closest('.mq-usual-btn, .mq-detail')) return;
    const row = ev.target.closest('.mq-clickable');
    if (row) toggleDetail(row);
  });
  document.getElementById('mqList')?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const row = ev.target.closest('.mq-clickable');
    if (!row || ev.target !== row) return;
    ev.preventDefault();
    toggleDetail(row);
  });

  // ---- Controls: search + how many mosques ----
  // Built once, above the list. Search runs in the browser against the
  // daily mosque directory (/api/mosques/directory) - no server call per
  // keystroke.
  let directory = null, directoryLoading = null;

  function loadDirectory(){
    // A once-off empty [] (not null) here would look "loaded and searched"
    // forever after — a directory that never came back, not a directory
    // with nothing in it — so a failed or empty fetch must NOT be cached:
    // only a real list sets `directory`, and directoryLoading is always
    // cleared so the next keystroke tries again.
    if (directory) return Promise.resolve(directory);
    if (directoryLoading) return directoryLoading;
    directoryLoading = fetch('/api/mosques/directory', { headers: deviceHeaders() })
      .then(r => { if (!r.ok) throw new Error('directory http ' + r.status); return r.json(); })
      .then(d => {
        const list = d && Array.isArray(d.mosques) ? d.mosques : [];
        if (!list.length) throw new Error('directory came back empty');
        directory = list.map(m => ({
          slug: m[0], name: m[1], place: m[2], lat: m[3], lon: m[4], aliases: m[5] || [],
          // Searching "NPM" or "Newbury Park Mosque" should find the same
          // card as "Newbury Park Masjid" - m[5] (when present) is every
          // other name that mosque is known by.
          key: [m[1], m[2], ...(m[5] || [])].join(' ').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
        }));
        directoryLoading = null;
        return directory;
      })
      .catch((e) => {
        directoryLoading = null;
        console.warn('[find-a-mosque] mosque directory failed to load:', e);
        return [];
      });
    return directoryLoading;
  }

  function milesBetween(a, b, c, d){
    const r = x => x * Math.PI / 180;
    const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(h));
  }

  function searchDirectory(q){
    const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length || !directory) return [];
    const hits = directory.filter(m => words.every(w => m.key.includes(w)));
    if (mqLocation) hits.forEach(m => { m.dist = milesBetween(mqLocation.lat, mqLocation.lon, m.lat, m.lon); });
    hits.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0) || a.name.localeCompare(b.name));
    return hits.slice(0, 12);
  }

  function renderResults(results, q){
    const box = document.getElementById('mqSearchResults');
    if (!box) return;
    if (!q) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (!directory) {
      box.innerHTML = directoryLoading
        ? '<div class="mq-search-empty">Loading mosques…</div>'
        : '<div class="mq-search-empty">Couldn\'t load the mosque list. <button type="button" class="mq-search-retry">Try again</button></div>';
      return;
    }
    if (!results.length) {
      box.innerHTML = '<div class="mq-search-empty">No mosque named or listed in "' + escapeHtml(q) + '".<br>' +
        '<button type="button" class="mq-search-retry mq-search-place" data-place="' + escapeHtml(q) + '">Show mosques near "' + escapeHtml(q) + '" instead</button></div>';
      return;
    }
    box.innerHTML = results.map(m => `
      <div class="mq-search-hit" data-hit="${escapeHtml(m.slug)}" role="button" tabindex="0">
        <div class="mq-search-hit-main">
          <div class="mq-search-hit-name">${escapeHtml(m.name)}</div>
          <div class="mq-search-hit-sub">${escapeHtml(m.place || '')}${m.dist != null ? ' · ' + (Math.round(m.dist * 10) / 10) + ' mi' : ''}${m.aliases && m.aliases.length ? ' · also known as ' + escapeHtml(m.aliases.join(', ')) : ''}</div>
        </div>
        ${starHtml(m.slug)}
      </div>`).join('');
  }

  function pickSearchResult(slug){
    const m = directory && directory.find(x => x.slug === slug);
    if (!m) return;
    searchPin = { slug: m.slug, name: m.name, lat: m.lat, lon: m.lon };
    openAfterRender = m.slug;
    const input = document.getElementById('mqSearchInput');
    if (input) input.value = '';
    renderResults([], '');
    if (!mqLocation) { mqLocation = { lat: m.lat, lon: m.lon, source: 'manual', label: m.name }; renderLocationLabel(); }
    loadPlanForLocation(mqLocation);
  }

  function ensureControls(){
    if (document.getElementById('mqControls')) return;
    const list = document.getElementById('mqList');
    if (!list) return;
    const wrap = document.createElement('div');
    wrap.id = 'mqControls';
    wrap.className = 'mq-controls';
    wrap.innerHTML = `
      <div class="mq-search">
        <input type="search" id="mqSearchInput" class="mq-search-input" placeholder="Search mosques by name, town or postcode" autocomplete="off" aria-label="Search mosques">
        <div id="mqSearchResults" class="mq-search-results hidden"></div>
      </div>
`;
    list.parentNode.insertBefore(wrap, list);
    renderSettings();

    const input = wrap.querySelector('#mqSearchInput');
    let t = null;
    input.addEventListener('focus', () => { loadDirectory(); });
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      t = setTimeout(async () => {
        if (q.length < 2) { renderResults([], ''); return; }
        renderResults([], q);
        await loadDirectory();
        if (input.value.trim() === q) renderResults(searchDirectory(q), q);
      }, 150);
    });
    wrap.querySelector('#mqSearchResults').addEventListener('click', async (ev) => {
      const placeBtn = ev.target.closest('.mq-search-place');
      if (placeBtn) {
        placeBtn.disabled = true;
        placeBtn.textContent = 'Searching…';
        try {
          const loc = await geocodeManual(placeBtn.dataset.place);
          applyLocation(loc, true);
          input.value = '';
          renderResults([], '');
        } catch (err) {
          placeBtn.disabled = false;
          placeBtn.textContent = 'Show mosques near "' + placeBtn.dataset.place + '" instead';
          const box = document.getElementById('mqSearchResults');
          const msg = document.createElement('div');
          msg.className = 'mq-search-place-error';
          msg.textContent = err.message || "Couldn't find that place.";
          box.appendChild(msg);
        }
        return;
      }
      if (ev.target.closest('.mq-search-retry')) { loadDirectory().then(() => renderResults(searchDirectory(input.value.trim()), input.value.trim())); return; }
      const star = ev.target.closest('.mq-star');
      if (star) {
        ev.stopPropagation();
        const m = directory && directory.find(x => x.slug === star.dataset.star);
        if (m && toggleFav({ slug: m.slug, name: m.name, lat: m.lat, lon: m.lon })) {
          renderResults(searchDirectory(input.value.trim()), input.value.trim());
          if (mqLocation) loadPlanForLocation(mqLocation);
        }
        return;
      }
      const hit = ev.target.closest('.mq-search-hit');
      if (hit) pickSearchResult(hit.dataset.hit);
    });
    wrap.querySelector('#mqSearchResults').addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const hit = ev.target.closest('.mq-search-hit');
      if (hit) pickSearchResult(hit.dataset.hit);
    });
  }

  // ---- Settings panel (bottom of the page) ----
  // How many nearest mosques to show, the mosques you've hidden, and the
  // reset button - folded away until opened. Built from JS around the
  // existing #mqResetAllBtn, so index.html doesn't need to change.
  function renderSettings(){
    const reset = document.getElementById('mqResetAllBtn');
    if (!reset) return;
    let panel = document.getElementById('mqSettings');
    if (!panel) {
      panel = document.createElement('details');
      panel.id = 'mqSettings';
      panel.className = 'mq-settings';
      panel.innerHTML = `
        <summary>⚙️ Find a Mosque settings</summary>
        <div class="mq-settings-body">
          <label class="mq-settings-row">
            <span>Nearest mosques to show</span>
            <select id="mqCountSelect" aria-label="How many nearest mosques to show">
              ${COUNT_OPTIONS.map(n => `<option value="${n}">${n}</option>`).join('')}
            </select>
          </label>
          <div class="mq-settings-sub">Hidden mosques</div>
          <div id="mqHiddenList"></div>
          <div id="mqResetSlot"></div>
        </div>`;
      reset.parentNode.insertBefore(panel, reset);
      panel.querySelector('#mqResetSlot').appendChild(reset);
      panel.querySelector('#mqCountSelect').addEventListener('change', (ev) => {
        setCount(parseInt(ev.target.value, 10));
        if (mqLocation) loadPlanForLocation(mqLocation);
      });
      panel.querySelector('#mqHiddenList').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-unhide]');
        if (!b) return;
        unhideMosque(b.dataset.unhide);
        renderSettings();
        if (mqLocation) loadPlanForLocation(mqLocation);
      });
    }
    panel.querySelector('#mqCountSelect').value = String(getCount());
    const hidden = getHidden();
    panel.querySelector('#mqHiddenList').innerHTML = hidden.length
      ? hidden.map(h => `
          <div class="mq-hidden-row">
            <span>${escapeHtml(h.name || h.slug)}</span>
            <button type="button" class="mq-hidden-undo" data-unhide="${escapeHtml(h.slug)}">Show again</button>
          </div>`).join('')
      : `<div class="mq-settings-empty">None. Open a mosque and tap "Hide this mosque" to hide it.</div>`;
  }

  // Delegated click handler for the usual-mosque toggle buttons rendered
  // inside the detail panels - survives every re-render since it's
  // bound once on the container.
  document.getElementById('mqList')?.addEventListener('click', (e) => {
    const usualBtn = e.target.closest('.mq-usual-btn');
    if (!usualBtn) return;
    const slug = usualBtn.dataset.usualSlug;
    if (getUsualMosque() === slug) {
      clearUsualMosque();
      usualBtn.classList.remove('is-usual');
      usualBtn.textContent = 'Set as my usual mosque';
    } else {
      setUsualMosque(slug);
      usualBtn.classList.add('is-usual');
      usualBtn.textContent = 'Saved as your usual mosque ✓';
    }
  });

  // The one visible "reset" control is the static button already in
  // index.html right after #mqList ("Reset usual mosque & favourites")
  // — not rendered by this file, just wired up here, once.
  document.getElementById('mqResetAllBtn')?.addEventListener('click', resetFindAMosqueData);

  // "Reset" for this page: usual mosque + this device's cached
  // plan/location, so the next load starts completely fresh.
  function resetFindAMosqueData(){
    if (!confirm("Reset your usual mosque, favourites, hidden mosques and cached location for Find a Mosque? This can't be undone.")) return;
    clearUsualMosque();
    if (window.LocalCache) { window.LocalCache.remove(FAVS_KEY); window.LocalCache.remove(HIDDEN_KEY); }
    renderSettings();
    searchPin = null;
    if (window.LocalCache) window.LocalCache.remove(PLAN_CACHE_KEY);
    mqLocation = null;
    renderLocationLabel();
    kickOffLocationDetection();
  }

  // Fetches + renders the plan for a given location, and caches it.
  // Shared by every source — cached instant-paint, the three
  // automatic races, and manual/precise-button submissions all end
  // up here once they have coordinates.
  // Several location sources report in at different speeds (IP/edge in
  // under a second, GPS a few seconds later), and each one fetches its own
  // list. Only the NEWEST request may paint: a slow answer for an older,
  // less accurate location (e.g. an IP that places a VPN or mobile network
  // in another country) must never overwrite the list for the real one.
  let planSeq = 0;
  async function loadPlanForLocation(loc){
    const seq = ++planSeq;
    try {
      const plan = await fetchPlan(loc.lat, loc.lon);
      if (seq !== planSeq) return; // a newer request superseded this one
      renderPlan(plan);
      writeCachedPlan(loc, plan);
    } catch (e) {
      if (seq !== planSeq) return;
      // A fetch failure for one source shouldn't nuke a result another
      // source already painted — only show the "no location" state if
      // nothing has ever rendered successfully this load.
      if (!document.querySelector('#mqList .mq-plan-rows')) renderNoLocationYet();
    }
  }

  // Adopts a location result if it's more precise than what's already
  // showing (or `force` is set, for an explicit user action like the
  // precise-location button or the postcode form — those always win).
  function applyLocation(loc, force){
    if (!loc) return;
    const rank = LOCATION_RANK[loc.source] || 0;
    const currentRank = mqLocation ? (LOCATION_RANK[mqLocation.source] || 0) : -1;
    if (!force && rank <= currentRank) return;
    mqLocation = loc;
    renderLocationLabel();
    loadPlanForLocation(loc);
    // Best-effort place name for auto-detected fixes — fills in the
    // label a moment later without blocking anything above.
    if ((loc.source === 'geo' || loc.source === 'edge' || loc.source === 'ip') && !loc.label) {
      reverseGeocodeLabel(loc.lat, loc.lon, loc.source === 'geo').then(label => {
        if (label && mqLocation === loc) { loc.label = label; renderLocationLabel(); }
      });
    }
  }

  // Kicks off all independent sources in parallel. Each one applies
  // itself the instant it resolves (see applyLocation) rather than
  // waiting for the others — fastest reasonable result paints first,
  // then silently upgrades if something more precise lands after.
  async function kickOffLocationDetection(){
    try { renderSettings(); } catch (e) { /* settings are optional */ }
    const cached = readCachedPlan();
    if (cached) {
      renderPlan(cached.plan);
      mqLocation = { lat: cached.lat, lon: cached.lon, source: 'cached', label: cached.label || null };
      renderLocationLabel();
    } else {
      renderSkeleton();
    }

    const sources = [gpsLocation(), edgeGeoLocation()];
    sources.forEach(p => p.then(loc => applyLocation(loc, false)));

    const settled = await Promise.allSettled(sources);
    const gotAny = settled.some(r => r.status === 'fulfilled' && r.value) || mqLocation;
    if (!gotAny) renderNoLocationYet();
  }

  // Lighter-weight refresh for the periodic timer and page-revisit —
  // reuses the already-known location instead of re-racing all four
  // sources every 5 minutes.
  function refreshPlan(){
    // Don't spend network/battery while the app is in the background.
    if (document.hidden) return;
    const status = document.getElementById('mqStatus');
    if (status) status.textContent = '';
    if (mqLocation) loadPlanForLocation(mqLocation);
    else kickOffLocationDetection();
  }

  // ---- Location bar: always-visible precise-location button + postcode form ----
  const usePreciseBtn = document.getElementById('mqUsePreciseBtn');
  const manualToggleBtn = document.getElementById('mqManualToggleBtn');
  const manualForm = document.getElementById('mqManualLocationForm');
  const manualInput = document.getElementById('mqManualLocationInput');
  const manualStatus = document.getElementById('mqManualLocationStatus');

  usePreciseBtn?.addEventListener('click', async () => {
    const originalText = usePreciseBtn.textContent;
    usePreciseBtn.disabled = true;
    usePreciseBtn.textContent = 'Locating…';
    // A real tap, so this reliably shows the permission prompt on every
    // platform including iOS Safari — not gated behind any prior state.
    const loc = await gpsLocation();
    usePreciseBtn.disabled = false;
    usePreciseBtn.textContent = originalText;
    if (loc) {
      applyLocation(loc, true);
    } else if (manualStatus) {
      manualStatus.textContent = "Couldn't get a precise location — check your device's location permission, or enter a postcode below.";
    }
  });

  manualToggleBtn?.addEventListener('click', () => {
    manualForm?.classList.toggle('hidden');
    if (manualForm && !manualForm.classList.contains('hidden')) manualInput?.focus();
  });

  manualForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = (manualInput?.value || '').trim();
    if (!query) return;
    if (manualStatus) manualStatus.textContent = 'Searching…';
    try {
      const loc = await geocodeManual(query);
      applyLocation(loc, true);
      if (manualStatus) manualStatus.textContent = '';
      manualForm.classList.add('hidden');
    } catch (err) {
      if (manualStatus) manualStatus.textContent = err.message || "Couldn't find that place — try a postcode instead.";
    }
  });

  let lastShownAt = 0;
  function onMosqueShown(){
    // The page-shown event and the nav-link click both call this on the
    // same tap — run once, not twice (was doubling GPS + plan calls).
    const now = Date.now();
    if (now - lastShownAt < 1500) return;
    lastShownAt = now;
    const header = document.getElementById('mqPrayerHeader');
    if (header) header.classList.add('hidden');
    const liveToggle = document.getElementById('mqLiveToggle');
    if (liveToggle) liveToggle.classList.add('hidden');
    clearInterval(mqTimer);
    kickOffLocationDetection();
    mqTimer = setInterval(refreshPlan, REFRESH_MS);
  }

  window.addEventListener('wwp-page-shown', (e)=>{
    if(e.detail && e.detail.id === 'mosque') onMosqueShown();
    else { clearInterval(mqTimer); mqTimer = null; } // left the page: stop refreshing
  });
  document.querySelectorAll('a[data-page="mosque"]').forEach(a=>{
    a.addEventListener('click', onMosqueShown);
  });
  // Covers a direct load/refresh landing on /find-a-mosque.
  if(!document.getElementById('page-mosque')?.classList.contains('hidden')){
    onMosqueShown();
  }

  // ---- "Screen protector" sneak-peek overlay ----
  // The real plan loads in the background regardless (see above), so
  // whichever state the overlay is in, revealing it just uncovers data
  // that's already there. Choice persists across visits via localStorage.
  const PEEK_KEY = 'wwp_mosque_preview_unlocked';
  const overlay = document.getElementById('mqPreviewOverlay');
  const peekBtn = document.getElementById('mqPeekBtn');
  const hideBtn = document.getElementById('mqHideBtn');

  function setPeekState(unlocked){
    if(!overlay || !hideBtn) return;
    overlay.classList.toggle('is-hidden', unlocked);
    hideBtn.classList.toggle('hidden', !unlocked);
    if(window.LocalCache){
      if(unlocked) window.LocalCache.set(PEEK_KEY, true);
      else window.LocalCache.remove(PEEK_KEY);
    }
  }

  let alreadyUnlocked = window.LocalCache ? !!window.LocalCache.get(PEEK_KEY, false) : false;
  setPeekState(alreadyUnlocked);

  peekBtn?.addEventListener('click', ()=> setPeekState(true));
  hideBtn?.addEventListener('click', ()=> setPeekState(false));
})();

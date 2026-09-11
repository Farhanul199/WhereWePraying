(function(){
/* ============================================================
   FIND A MOSQUE :: "Explore Alternatives" plan view.

   Replaces the old nationwide ranked list / By Time / By Area /
   postcode-search browser. The person never sees a big list — just
   their ONE best mosque right now (Primary) plus up to TWO backup
   mosques with later Jama'ah times in case they miss it, worked out
   from their real location. Backed by functions/api/mosques/plan.js.

   Two small things carried over from the old list view, since they
   were built after the rewrite and are still worth keeping:
   - "Set as my usual mosque" — a plain per-device bookmark (not a
     mode switch like it used to be), shown as a small link under
     each of the 3 cards.
   - "Reset" — clears the usual-mosque bookmark and this device's
     cached plan/location, then reloads.

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
     3. IP     — a second, separate IP-geolocation provider
                 (geojs.io), queried directly from the browser. A
                 genuinely different network path/provider to EDGE,
                 so if Cloudflare's own geo data is missing or wrong
                 for a given PoP, this doesn't share the same blind
                 spot. Note: this sends the visitor's IP directly to
                 geojs.io, a third party — same trade-off as any
                 "detect my location" widget.
     4. MANUAL — a postcode/place box (always visible, not gated
                 behind failure), geocoded via the same Open-Meteo
                 API already used by Prayer Times. Always wins over
                 an automatic guess since it's what the person typed.

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
  const PLAN_CACHE_KEY = 'wwp_mq_plan_v1';
  const USUAL_MOSQUE_KEY = 'wwp_usual_mosque_slug'; // same key the old list view used — carries over any existing saved choice
  const LOCATION_OPTS = { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 };
  const IP_GEO_TIMEOUT_MS = 3500;
  const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
  const REVERSE_GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/reverse';
  const IP_GEO_URL = 'https://get.geojs.io/v1/ip/geo.json';
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

  // ---- Source 3: independent 3rd-party IP geolocation ----
  // Deliberately a different provider to EDGE so the two don't share
  // a failure mode (e.g. a PoP where Cloudflare's own cf.latitude is
  // null). Sends the visitor's IP to geojs.io directly from the
  // browser — flagged in the header comment above.
  async function ipGeoLocation(){
    try {
      const res = await fetchWithTimeout(IP_GEO_URL, { cache: 'no-store' }, IP_GEO_TIMEOUT_MS);
      if (res.ok) {
        const d = await res.json();
        const lat = parseFloat(d.latitude), lon = parseFloat(d.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat: roundCoord(lat), lon: roundCoord(lon), source: 'ip' };
        }
      }
    } catch (e) { /* offline, blocked, or provider down — give up */ }
    return null;
  }

  // ---- Source 4: manual postcode/place entry ----
  // Same geocoding API Prayer Times already uses — no key, free.
  async function geocodeManual(query){
    const url = GEOCODE_BASE + '?name=' + encodeURIComponent(query) + '&count=1&language=en&format=json&country=GB';
    const res = await fetchWithTimeout(url, null, 5000);
    if (!res.ok) throw new Error('Location search failed');
    const data = await res.json();
    const r = data && data.results && data.results[0];
    if (!r) throw new Error("Couldn't find that place");
    return {
      lat: roundCoord(r.latitude), lon: roundCoord(r.longitude),
      label: [r.name, r.admin1].filter(Boolean).join(', '),
      source: 'manual'
    };
  }

  // Best-effort place name for auto-detected fixes — never blocks
  // rendering the plan; just fills in the label a moment later.
  async function reverseGeocodeLabel(lat, lon){
    try {
      const url = REVERSE_GEOCODE_BASE + '?latitude=' + lat + '&longitude=' + lon + '&count=1&language=en&format=json';
      const res = await fetchWithTimeout(url, null, 3500);
      if (!res.ok) return null;
      const data = await res.json();
      const r = data && data.results && data.results[0];
      if (r) return [r.name, r.admin1].filter(Boolean).join(', ');
    } catch (e) { /* skip — generic source label still shown */ }
    return null;
  }

  function locationBarText(loc){
    if (!loc) return '';
    if (loc.source === 'manual') return 'Showing mosques near ' + escapeHtml(loc.label || 'your search') + '.';
    if (loc.source === 'cached') return 'Last known location — updating…';
    if (loc.source === 'geo') return loc.label ? 'Using your precise location near ' + escapeHtml(loc.label) + '.' : 'Using your precise location.';
    return loc.label ? 'Using your approximate area near ' + escapeHtml(loc.label) + '.' : 'Using your approximate area.';
  }

  function renderLocationLabel(){
    const el = document.getElementById('mqLocationLabel');
    if (!el) return;
    el.textContent = mqLocation ? locationBarText(mqLocation).replace(/<[^>]+>/g, '') : '';
  }

  async function fetchPlan(lat, lon){
    // POST with coords in the body (not a GET query string) so they
    // never land in access logs, browser history, or a Referer header.
    const res = await fetch('/api/mosques/plan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, deviceHeaders()),
      body: JSON.stringify({ lat, lon })
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
            <h2>Explore Alternatives</h2>
            <p>See alternative mosques nearby so you can always find a place to pray.</p>
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

  function planRowHtml(entry, isPrimary){
    const label = isPrimary ? 'Primary' : 'Backup';
    const travelWord = entry.travelMode === 'walk' ? 'walk' : 'drive';
    const isUsual = getUsualMosque() === entry.slug;
    return `
      <div class="mq-plan-row${isPrimary ? ' is-primary' : ''}" data-slug="${escapeHtml(entry.slug)}">
        <span class="mq-plan-row-icon" aria-hidden="true">${isPrimary ? '🕌' : '📍'}</span>
        <div class="mq-plan-row-main">
          <div class="mq-plan-row-name">${escapeHtml(entry.name)}<span class="mq-plan-row-tag">${label}</span></div>
          <div class="mq-plan-row-sub">${entry.distanceMiles} mi · ${entry.travelMinutes} min ${travelWord}</div>
          <button type="button" class="mq-usual-btn${isUsual ? ' is-usual' : ''}" data-usual-slug="${escapeHtml(entry.slug)}">${isUsual ? 'Saved as your usual mosque ✓' : 'Set as my usual mosque'}</button>
        </div>
        <div class="mq-plan-chip">
          <div class="mq-plan-chip-label">${PRAYER_LABELS[entry.prayer] || entry.prayer}${entry.isTomorrow ? ' · tomorrow' : ''}</div>
          <div class="mq-plan-chip-time">${entry.isTomorrow ? entry.time : formatMinutesUntil(entry.jamaahInMinutes)}</div>
          ${entry.isTomorrow ? `<div class="mq-plan-chip-countdown">${formatMinutesUntil(entry.jamaahInMinutes)}</div>` : ''}
        </div>
      </div>`;
  }

  function renderPlan(plan){
    const list = document.getElementById('mqList');
    if (!list) return;
    if (!plan.primary) { renderNote(plan.note || "No mosques with Jama'ah times found nearby."); return; }
    const rows = [planRowHtml(plan.primary, true), ...(plan.backups || []).map(b => planRowHtml(b, false))].join('');
    list.innerHTML = `
      <div class="mq-plan-card">
        <div class="mq-plan-header">
          <span class="mq-plan-icon" aria-hidden="true">🕌</span>
          <div>
            <h2>Explore Alternatives</h2>
            <p>See alternative mosques nearby so you can always find a place to pray.</p>
          </div>
        </div>
        <div class="mq-plan-rows">${rows}</div>
        ${plan.expanded ? '<div class="mq-plan-expanded-note">Widened the search area to find enough options nearby.</div>' : ''}
      </div>`;
  }

  // Delegated click handler for the usual-mosque toggle buttons rendered
  // inside the plan card rows — survives every re-render since it's
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
      document.querySelectorAll('.mq-usual-btn.is-usual').forEach(b => {
        if (b !== usualBtn) { b.classList.remove('is-usual'); b.textContent = 'Set as my usual mosque'; }
      });
    }
  });

  // The one visible "reset" control is the static button already in
  // index.html right after #mqList ("Reset usual mosque & favourites")
  // — not rendered by this file, just wired up here, once.
  document.getElementById('mqResetAllBtn')?.addEventListener('click', resetFindAMosqueData);

  // "Reset" for this page: usual mosque + this device's cached
  // plan/location, so the next load starts completely fresh.
  function resetFindAMosqueData(){
    if (!confirm("Reset your usual mosque and cached location for Find a Mosque? This can't be undone.")) return;
    clearUsualMosque();
    if (window.LocalCache) window.LocalCache.remove(PLAN_CACHE_KEY);
    mqLocation = null;
    renderLocationLabel();
    kickOffLocationDetection();
  }

  // Fetches + renders the plan for a given location, and caches it.
  // Shared by every source — cached instant-paint, the three
  // automatic races, and manual/precise-button submissions all end
  // up here once they have coordinates.
  async function loadPlanForLocation(loc){
    try {
      const plan = await fetchPlan(loc.lat, loc.lon);
      renderPlan(plan);
      writeCachedPlan(loc, plan);
    } catch (e) {
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
      reverseGeocodeLabel(loc.lat, loc.lon).then(label => {
        if (label && mqLocation === loc) { loc.label = label; renderLocationLabel(); }
      });
    }
  }

  // Kicks off all independent sources in parallel. Each one applies
  // itself the instant it resolves (see applyLocation) rather than
  // waiting for the others — fastest reasonable result paints first,
  // then silently upgrades if something more precise lands after.
  async function kickOffLocationDetection(){
    const cached = readCachedPlan();
    if (cached) {
      renderPlan(cached.plan);
      mqLocation = { lat: cached.lat, lon: cached.lon, source: 'cached', label: cached.label || null };
      renderLocationLabel();
    } else {
      renderSkeleton();
    }

    const sources = [gpsLocation(), edgeGeoLocation(), ipGeoLocation()];
    sources.forEach(p => p.then(loc => applyLocation(loc, false)));

    const settled = await Promise.allSettled(sources);
    const gotAny = settled.some(r => r.status === 'fulfilled' && r.value) || mqLocation;
    if (!gotAny) renderNoLocationYet();
  }

  // Lighter-weight refresh for the periodic timer and page-revisit —
  // reuses the already-known location instead of re-racing all four
  // sources every 5 minutes.
  function refreshPlan(){
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

  function onMosqueShown(){
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

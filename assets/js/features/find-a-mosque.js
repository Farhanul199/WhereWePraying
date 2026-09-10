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

   Load order, cheapest-first:
   1. Skeleton rows — paint instantly, no network wait.
   2. Last-known plan from this device's own cache (LocalCache),
      if recent — replaces the skeleton immediately while a fresh
      fetch runs quietly in the background.
   3. Real location (GPS via Platform.getLocation, falling back to
      the same-origin /api/geo edge-geo lookup if GPS is denied,
      unavailable, or times out) → fetch the real plan → replace
      whatever's showing with the fresh result, and save it to
      LocalCache for next time.

   deviceHeaders, escapeHtml: shared, defined once in wwp-core.js.
   ============================================================ */
(function(){
  const PRAYER_LABELS = {fajr:'Fajr', zuhr:'Dhuhr', asr:'Asr', maghrib:'Maghrib', isha:'Isha'};
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches the plan endpoint's own refresh cadence
  const REFRESH_MS = 5 * 60 * 1000;   // re-check every 5 min while the page is open
  const PLAN_CACHE_KEY = 'wwp_mq_plan_v1';
  const USUAL_MOSQUE_KEY = 'wwp_usual_mosque_slug'; // same key the old list view used — carries over any existing saved choice
  const LOCATION_OPTS = { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 };

  let mqTimer = null;
  let mqLastLocation = null; // {lat, lon} once known, reused for auto-refresh

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
  function writeCachedPlan(lat, lon, plan){
    if (!window.LocalCache) return;
    window.LocalCache.set(PLAN_CACHE_KEY, { lat, lon, plan, savedAt: Date.now() });
  }

  async function fetchWithTimeout(url, opts, ms){
    const controller = new AbortController();
    const t = setTimeout(()=> controller.abort(), ms);
    try {
      return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  // GPS first, same-origin Cloudflare edge-geo fallback (no third-party
  // call, no extra cost). Resolves {lat, lon} or null — never throws,
  // callers just treat null as "couldn't find you."
  async function detectLocation(){
    if (window.Platform && typeof window.Platform.getLocation === 'function') {
      try {
        return await window.Platform.getLocation(LOCATION_OPTS);
      } catch (e) { /* denied, unsupported, or timed out — fall through */ }
    }
    try {
      const res = await fetchWithTimeout('/api/geo', { cache: 'no-store' }, 3000);
      if (res.ok) {
        const d = await res.json();
        if (typeof d.lat === 'number' && typeof d.lon === 'number') return { lat: d.lat, lon: d.lon };
      }
    } catch (e) { /* offline, or function not deployed — give up */ }
    return null;
  }

  async function fetchPlan(lat, lon){
    const res = await fetch(`/api/mosques/plan?lat=${lat}&lon=${lon}`, { headers: deviceHeaders() });
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

  function renderLocatePrompt(){
    const list = document.getElementById('mqList');
    if (!list) return;
    list.innerHTML = `
      <div class="mq-plan-card mq-plan-empty">
        <span class="mq-plan-icon" aria-hidden="true">📍</span>
        <h2>We need your location</h2>
        <p>Turn on location for this site to see nearby mosques and whether you can still make it in time.</p>
        <button type="button" id="mqRetryLocation" class="mq-plan-retry-btn">Try again</button>
      </div>`;
    document.getElementById('mqRetryLocation')?.addEventListener('click', loadPlan);
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
        <button type="button" id="mqResetAllBtn" class="mq-reset-all-btn">Reset</button>
      </div>`;
  }

  // Delegated click handler for the two small buttons rendered inside
  // the plan card (usual-mosque toggle per row, reset at the bottom) —
  // survives every re-render since it's bound once on the container.
  document.getElementById('mqList')?.addEventListener('click', (e) => {
    const usualBtn = e.target.closest('.mq-usual-btn');
    if (usualBtn) {
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
      return;
    }
    if (e.target.closest('#mqResetAllBtn')) resetFindAMosqueData();
  });

  // "Reset" for this page: usual mosque + this device's cached
  // plan/location, so the next load starts completely fresh.
  function resetFindAMosqueData(){
    if (!confirm("Reset your usual mosque and cached location for Find a Mosque? This can't be undone.")) return;
    clearUsualMosque();
    if (window.LocalCache) window.LocalCache.remove(PLAN_CACHE_KEY);
    mqLastLocation = null;
    loadPlan();
  }

  async function loadPlan(){
    const status = document.getElementById('mqStatus');
    if (status) status.textContent = '';

    renderSkeleton();

    // Instant paint from last time, if recent — real fetch still runs
    // right after regardless, this just avoids a blank/skeleton wait
    // for a returning visitor.
    const cached = readCachedPlan();
    if (cached) {
      renderPlan(cached.plan);
      mqLastLocation = { lat: cached.lat, lon: cached.lon };
    }

    const loc = mqLastLocation || await detectLocation();
    if (!loc) {
      if (!cached) renderLocatePrompt();
      return;
    }
    mqLastLocation = loc;

    try {
      const plan = await fetchPlan(loc.lat, loc.lon);
      renderPlan(plan);
      writeCachedPlan(loc.lat, loc.lon, plan);
    } catch (e) {
      if (!cached) {
        if (status) status.textContent = "Couldn't load nearby mosques right now — please try again shortly.";
        const list = document.getElementById('mqList');
        if (list) list.innerHTML = '';
      }
    }
  }

  function onMosqueShown(){
    const header = document.getElementById('mqPrayerHeader');
    if (header) header.classList.add('hidden');
    const liveToggle = document.getElementById('mqLiveToggle');
    if (liveToggle) liveToggle.classList.add('hidden');
    clearInterval(mqTimer);
    loadPlan();
    mqTimer = setInterval(loadPlan, REFRESH_MS);
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

})();

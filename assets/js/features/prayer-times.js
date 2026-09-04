/* WhereWePraying — Prayer Times module.
   Pulled out of wwp-core.js so this feature can be changed on its own
   without touching anything else. Same code, just moved. */

/* ============================================================
   PRAYER TIMES :: live prayer time calculation + next-prayer
   countdown, powering both the homepage "Next Prayer" strip and
   the full Prayer Times page.
   Source: api.aladhan.com (free, no key, CORS-open) — same family
   as the Qur'an API already used elsewhere in this app. Times are
   calculated from the user's coordinates via the `timings` endpoint,
   cached in localStorage per (date + coords + method) so repeat
   visits on the same day are instant and mostly offline-safe.
   Location: browser geolocation first (with permission), falling
   back to a manual city search (geocoded via Open-Meteo's free
   geocoding API, also no key required) if denied or unavailable.
   ==> CONNECT: swap PT_GEOCODE_BASE for a paid geocoder if greater
   accuracy/coverage is needed later; the rest of this module is
   provider-agnostic and only needs {lat, lon, label} back.
   ============================================================ */
const PrayerTimes = (function(){
  const API_BASE = 'https://api.aladhan.com/v1';
  const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
  const REVERSE_GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1/reverse';
  const LOC_KEY = 'wwp:prayertimes:location';
  const METHOD_KEY = 'wwp:prayertimes:method';
  const CACHE_PREFIX = 'wwp:prayertimes:cache:';

  const METHOD_NAMES = {
    1:'University of Islamic Sciences, Karachi', 2:'Islamic Society of North America (ISNA)',
    3:'Muslim World League', 4:'Umm Al-Qura University, Makkah', 5:'Egyptian General Authority of Survey',
    8:'Gulf Region', 12:'Union Organization Islamic de France', 13:'Diyanet, Turkey',
    15:'Moonsighting Committee Worldwide', 17:'JAKIM, Malaysia'
  };

  const PRAYER_ORDER = ['Fajr','Sunrise','Dhuhr','Asr','Maghrib','Isha'];

  let state = {
    location: null,   // {lat, lon, label, source:'geo'|'manual'}
    method: 3,
    timings: null,    // {Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha}
    hijri: null,
    loading: false,
    error: null
  };

  const listeners = [];
  function subscribe(fn){ listeners.push(fn); return ()=>{ const i=listeners.indexOf(fn); if(i>-1) listeners.splice(i,1); }; }
  function notify(){ listeners.forEach(fn=>{ try{ fn(state); }catch(e){} }); }

  // Location/method now sync to the account (when signed in) via the
  // same WWP backend other sections use — localStorage stays as a fast
  // local cache and offline fallback, but the backend copy is what
  // makes a saved location follow you across devices.
  function locationSourceRank(source){
    // Higher = more precise. Used so a slower-but-better result never
    // gets clobbered by a faster-but-coarser one landing after it, and
    // vice versa a coarse result is only ever applied over something
    // worse (or nothing at all).
    switch(source){
      case 'geo': case 'manual': case 'preset': return 3;
      case 'network': case 'ip': return 2;
      case 'default': return 0;
      default: return 1;
    }
  }
  function applyLocationUpgrade(loc){
    if(!loc) return;
    const current = state.location;
    if(current && locationSourceRank(loc.source) < locationSourceRank(current.source)) return;
    saveLocation(loc);
    notify();
    fetchTimings();
  }

  async function loadSavedLocation(){
    const loc = window.LocalCache ? window.LocalCache.get(LOC_KEY, null) : null;
    if(loc) state.location = loc;
    const m = window.LocalCache ? window.LocalCache.get(METHOD_KEY, null) : null;
    if(m !== null) state.method = parseInt(m,10);

    // Backend copy is non-critical. Wait until the first paint/initial
    // prayer request has had a chance to run, then reconcile quietly.
    const reconcile = ()=>syncSavedLocationFromBackend();
    if('requestIdleCallback' in window) requestIdleCallback(reconcile, {timeout:4000});
    else setTimeout(reconcile, 2500);
  }

  async function syncSavedLocationFromBackend(){
    try{
      const saved = await Promise.race([
        WWP.get('prayertimes'),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), 4000))
      ]);
      if(saved && typeof saved.method === 'number' && saved.method !== state.method){
        state.method = saved.method;
        if(window.LocalCache) window.LocalCache.set(METHOD_KEY, saved.method);
      }
      if(saved && saved.location){
        applyLocationUpgrade(saved.location);
      }
    }catch(e){ /* offline, not signed in, or timed out — local cache is fine */ }
  }

  async function preCachePrayerTimes(loc){
    // Cache the next 3 days of prayer times for offline access.
    // Today's timings are already cached by fetchTimings(), so start with tomorrow.
    // Keeping this small avoids a background burst of API requests on first load.
    try{
      const today = new Date();
      for(let i = 1; i <= 3; i++){
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const dateStr = String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();
        const url = API_BASE+'/timings/'+dateStr+'?latitude='+loc.lat+'&longitude='+loc.lon+'&method='+state.method;
        try{
          const res = await fetchWithTimeout(url, {cache:'no-store'}, 3500);
          if(res.ok){
            const data = await res.json();
            if(data.data && data.data.timings){
              const t = data.data.timings;
              const timings = {};
              PRAYER_ORDER.forEach(p=>{ timings[p] = (t[p]||'').split(' ')[0]; });
              try{
                const hanafiUrl = API_BASE+'/timings/'+dateStr+'?latitude='+loc.lat+'&longitude='+loc.lon+'&method='+state.method+'&school=1';
                const hRes = await fetchWithTimeout(hanafiUrl, {cache:'no-store'}, 3500);
                if(hRes.ok){
                  const hData = await hRes.json();
                  if(hData.data && hData.data.timings && hData.data.timings.Asr){
                    timings.AsrHanafi = hData.data.timings.Asr.split(' ')[0];
                  }
                }
              }catch(e){ /* best-effort */ }
              const cacheKey = 'pt:'+dateStr+':'+loc.lat.toFixed(2)+','+loc.lon.toFixed(2)+':'+state.method;
              await OfflineData.set('metadata', {key:cacheKey, value:JSON.stringify({timings, hijri:data.data.date?.hijri})});
            }
          }
        }catch(e){ /* skip individual dates */ }
      }
    }catch(e){ console.log('Prayer times pre-cache failed:', e); }
  }

  let preCacheQueuedKey = null;
  function queuePreCachePrayerTimes(loc){
    if(!loc) return;
    const key = loc.lat.toFixed(2)+','+loc.lon.toFixed(2)+':'+state.method;
    if(preCacheQueuedKey === key) return;
    preCacheQueuedKey = key;
    const run = ()=>{ preCachePrayerTimes(loc).catch(()=>0); };
    // Never compete with first paint or the live prayer-time request.
    if('requestIdleCallback' in window){
      requestIdleCallback(run, {timeout: 5000});
    }else{
      setTimeout(run, 3500);
    }
  }

  function saveLocation(loc){
    state.location = loc;
    if(window.LocalCache) window.LocalCache.set(LOC_KEY, loc);
    WWP.save('prayertimes', {location: state.location, method: state.method});
    // Offline pre-cache is deliberately deferred. It used to fire 14
    // network requests immediately on a fresh visit, competing with the
    // one request needed to paint today's page.
  }
  function saveMethod(method){
    state.method = method;
    if(window.LocalCache) window.LocalCache.set(METHOD_KEY, method);
    WWP.save('prayertimes', {location: state.location, method: state.method});
  }

  // todayKey: shared, defined once in wwp-core.js — no local copy needed.
  function cacheKey(){
    if(!state.location) return null;
    const lat = state.location.lat.toFixed(2), lon = state.location.lon.toFixed(2);
    return CACHE_PREFIX+todayKey()+':'+lat+','+lon+':'+state.method;
  }

  function detectGeolocation(opts){
    const options = Object.assign({
      enableHighAccuracy:false,   // network/cell-assisted — works far better indoors & underground than raw GPS
      timeout:12000,
      maximumAge:21600000         // accept a fix up to 6h old rather than block waiting for a fresh one that may never arrive underground
    }, opts||{});
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation){ reject(new Error('Geolocation not supported')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({lat:pos.coords.latitude, lon:pos.coords.longitude}),
        err => reject(err),
        options
      );
    });
  }

  // Caps how long any single network call in the location chain can
  // take, so a slow/dead connection (weak signal, underground) can
  // never stall things — it just fails fast and the chain moves to
  // the next fallback instead.
  function fetchWithTimeout(url, opts, ms){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), ms);
    return fetch(url, Object.assign({}, opts||{}, {signal:controller.signal})).finally(()=>clearTimeout(timer));
  }

  async function reverseGeocodeLabel(lat, lon){
    try{
      const url = REVERSE_GEOCODE_BASE+'?latitude='+lat+'&longitude='+lon+'&count=1&language=en&format=json';
      const res = await fetchWithTimeout(url, null, 4000);
      if(!res.ok) throw new Error('reverse geocode failed');
      const data = await res.json();
      const r = data && data.results && data.results[0];
      if(r) return [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    }catch(e){ /* fall through to coordinate label */ }
    return lat.toFixed(2)+', '+lon.toFixed(2);
  }

  async function geocodeCity(query){
    const url = GEOCODE_BASE+'?name='+encodeURIComponent(query)+'&count=5&language=en&format=json';
    const res = await fetch(url);
    if(!res.ok) throw new Error('Location search failed');
    const data = await res.json();
    if(!data.results || !data.results.length) throw new Error('No matching location found');
    const r = data.results[0];
    return {
      lat: r.latitude, lon: r.longitude,
      label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      source: 'manual'
    };
  }

  async function useGeolocation(){
    const coords = await detectGeolocation();
    const label = await reverseGeocodeLabel(coords.lat, coords.lon);
    let tz = null;
    try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
    const loc = {lat:coords.lat, lon:coords.lon, label:label, tz:tz, source:'geo'};
    saveLocation(loc);
    await fetchTimings();
    return loc;
  }

  async function useManualLocation(query){
    const loc = await geocodeCity(query);
    saveLocation(loc);
    await fetchTimings();
    return loc;
  }

  // Instant location switch from the curated city list — no geocoding
  // API call needed since lat/lon/tz are already known for these.
  async function usePresetCity(city){
    const loc = {lat:city.lat, lon:city.lon, label:city.label, tz:city.tz, source:'preset'};
    saveLocation(loc);
    await fetchTimings();
    return loc;
  }

  function setMethod(method){
    saveMethod(method);
    return fetchTimings();
  }

  async function fetchTimings(){
    if(!state.location){ state.error = 'No location set'; notify(); return; }
    const key = cacheKey();
    state.loading = true; state.error = null; notify();

    // Try cache first (same day, same coords/method) for instant paint.
    if(key && window.LocalCache){
      const cached = window.LocalCache.get(key, null);
      if(cached){
        state.timings = cached.timings;
        state.hijri = cached.hijri;
        state.loading = false;
        notify();
      }
    }

    // Try IndexedDB offline cache
    const offlineKey = 'pt:'+todayKey()+':'+state.location.lat.toFixed(2)+','+state.location.lon.toFixed(2)+':'+state.method;
    try{
      const cached = await OfflineData.get('metadata', offlineKey);
      if(cached && !state.timings){
        const data = JSON.parse(cached.value);
        state.timings = data.timings;
        state.hijri = data.hijri;
        state.loading = false;
        notify();
      }
    }catch(e){}

    // ==> CONNECT (resolved): live call to api.aladhan.com — no key needed.
    try{
      const d = new Date();
      const dateStr = String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();
      const url = API_BASE+'/timings/'+dateStr+'?latitude='+state.location.lat+'&longitude='+state.location.lon+'&method='+state.method;
      // Hard timeout: a stalled third-party API must never leave the
      // Prayer Times page looking half-rendered indefinitely.
      const res = await fetchWithTimeout(url, {cache:'no-store'}, 5000);
      if(!res.ok) throw new Error('Prayer times request failed');
      const data = await res.json();
      if(!data.data || !data.data.timings) throw new Error('Unexpected response');

      const t = data.data.timings;
      const timings = {};
      PRAYER_ORDER.forEach(p=>{ timings[p] = (t[p]||'').split(' ')[0]; });

      // Asr is the one prayer whose start genuinely differs by school
      // of thought (shadow-length factor 1 vs 2), so fetch the Hanafi
      // Asr time alongside the default (Shafi'i/Maliki/Hanbali) one
      // and show both. Best-effort — never blocks the main timings.
      try{
        const hanafiUrl = API_BASE+'/timings/'+dateStr+'?latitude='+state.location.lat+'&longitude='+state.location.lon+'&method='+state.method+'&school=1';
        const hRes = await fetchWithTimeout(hanafiUrl, {cache:'no-store'}, 3500);
        if(hRes.ok){
          const hData = await hRes.json();
          if(hData.data && hData.data.timings && hData.data.timings.Asr){
            timings.AsrHanafi = hData.data.timings.Asr.split(' ')[0];
          }
        }
      }catch(e){ /* Hanafi Asr is a nice-to-have; ignore failures */ }

      const hijri = data.data.date && data.data.date.hijri
        ? (data.data.date.hijri.day+' '+data.data.date.hijri.month.en+' '+data.data.date.hijri.year+' AH')
        : null;

      state.timings = timings;
      state.hijri = hijri;
      state.loading = false;
      state.error = null;
      notify();

      if(key && window.LocalCache) window.LocalCache.set(key, {timings:timings, hijri:hijri});

      // Today's data is now painted. Only after that do we build the
      // optional three-day offline cache, so it cannot delay the page.
      queuePreCachePrayerTimes(state.location);
      
      // Also cache to IndexedDB
      try{
        await OfflineData.set('metadata', {key:offlineKey, value:JSON.stringify({timings, hijri})});
      }catch(e){}
    }catch(e){
      state.loading = false;
      if(!state.timings) state.error = e.message || 'Could not load prayer times';
      notify();
    }
  }

  function parseTimeToday(hhmm){
    if(!hhmm) return null;
    const [h,m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  // Returns {name, time, date, remainingMs, isTomorrowFajr}
  function getNextPrayer(){
    if(!state.timings) return null;
    const now = new Date();
    const order = ['Fajr','Dhuhr','Asr','Maghrib','Isha']; // Sunrise excluded from "next prayer" countdown
    for(const name of order){
      const t = parseTimeToday(state.timings[name]);
      if(t && t.getTime() > now.getTime()){
        return {name, time: state.timings[name], date: t, remainingMs: t.getTime()-now.getTime()};
      }
    }
    // All of today's prayers have passed — next is tomorrow's Fajr.
    const fajrTomorrow = parseTimeToday(state.timings['Fajr']);
    if(fajrTomorrow){
      fajrTomorrow.setDate(fajrTomorrow.getDate()+1);
      return {name:'Fajr', time: state.timings['Fajr'], date: fajrTomorrow, remainingMs: fajrTomorrow.getTime()-now.getTime(), isTomorrow:true};
    }
    return null;
  }

  function formatRemaining(ms){
    if(ms == null || ms < 0) return '';
    const totalMin = Math.floor(ms/60000);
    const h = Math.floor(totalMin/60), m = totalMin%60;
    if(h > 0) return 'In '+h+'h '+m+'m remaining';
    return 'In '+m+'m remaining';
  }

  function to12h(hhmm){
    if(!hhmm) return '—';
    const [h,m] = hhmm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if(h12 === 0) h12 = 12;
    return h12+':'+String(m).padStart(2,'0')+' '+period;
  }

  // ---- Location fallback chain ----
  // Ordered from most-accurate to least, each one only attempted if
  // the previous failed. Prayer times and Qiblah direction are core
  // to the app, so this is deliberately layered with redundancy for
  // poor cellular coverage, being underground/on the tube, or a
  // completely fresh install with no cached data yet.

  // 1. Silent GPS — fires instantly if permission was already granted
  // in a past session, no prompt shown. Accepts a fix up to 6h old so
  // a last-known position from before losing signal still resolves.
  async function detectSilentGeolocation(){
    try{
      if(!navigator.permissions || !navigator.permissions.query) return null;
      const status = await navigator.permissions.query({name:'geolocation'});
      if(status.state !== 'granted') return null;
      const coords = await detectGeolocation();
      const label = await reverseGeocodeLabel(coords.lat, coords.lon);
      let tz = null;
      try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
      return {lat:coords.lat, lon:coords.lon, label:label, tz:tz, source:'geo'};
    }catch(e){ return null; }
  }

  // 2. Active GPS request — used the first time permission hasn't been
  // decided yet. Shown after a brief explainer (see requestGeoWithExplainer
  // below) so the person understands why it matters before the native
  // OS prompt appears.
  async function detectActiveGeolocation(){
    try{
      const coords = await detectGeolocation();
      const label = await reverseGeocodeLabel(coords.lat, coords.lon);
      let tz = null;
      try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone; }catch(e){}
      return {lat:coords.lat, lon:coords.lon, label:label, tz:tz, source:'geo'};
    }catch(e){ return null; }
  }

  // 3. Same-origin network geolocation — a tiny Pages Function
  // (functions/api/geo.js) that reads Cloudflare's own edge geo data
  // for the request, derived from IP. No third-party domain, no CORS,
  // no separate rate limit — the most reliable fallback when GPS is
  // denied or unavailable, since it's just one small same-domain
  // request that tends to succeed even on a weak connection.
  async function detectCloudflareGeo(){
    try{
      const res = await fetchWithTimeout('/api/geo', {cache:'no-store'}, 3000);
      if(!res.ok) throw new Error('cf geo failed');
      const d = await res.json();
      if(d && typeof d.lat === 'number' && typeof d.lon === 'number'){
        return {
          lat: d.lat, lon: d.lon,
          label: [d.city, d.region, d.country].filter(Boolean).join(', '),
          tz: d.timezone || null,
          source: 'network'
        };
      }
    }catch(e){ /* function not deployed yet, or offline — fall through */ }
    return null;
  }

  // 4. Third-party IP geolocation — extra redundancy in case the
  // Cloudflare function above isn't deployed yet or is briefly down.
  async function detectRoughLocationByIP(){
    try{
      const res = await fetchWithTimeout('https://ipapi.co/json/', null, 4000);
      if(!res.ok) throw new Error('ip lookup failed');
      const d = await res.json();
      if(d && typeof d.latitude === 'number' && typeof d.longitude === 'number'){
        return {
          lat: d.latitude, lon: d.longitude,
          label: [d.city, d.region, d.country_name].filter(Boolean).join(', '),
          tz: d.timezone || null,
          source: 'ip'
        };
      }
    }catch(e){ /* offline, blocked, or rate-limited — fall through */ }
    return null;
  }

  const GEO_EXPLAINER_KEY = 'wwp:geo:explainerAnswered';
  // Shows the "why we need this" explainer once, waits for the tap,
  // then makes the real (native-prompting) GPS request if allowed.
  // Never shown again once answered either way — a decline is
  // respected, not re-asked on every visit.
  function requestGeoWithExplainer(){
    return new Promise((resolve)=>{
      const backdrop = document.getElementById('ptGeoExplainerBackdrop');
      const allowBtn = document.getElementById('ptGeoExplainerAllow');
      const laterBtn = document.getElementById('ptGeoExplainerLater');
      if(!backdrop || !allowBtn || !laterBtn){ resolve(null); return; }
      let answered = false;
      const cleanup = ()=>{ backdrop.style.display = 'none'; allowBtn.onclick = null; laterBtn.onclick = null; };
      allowBtn.onclick = async ()=>{
        if(answered) return; answered = true;
        if(window.LocalCache) window.LocalCache.set(GEO_EXPLAINER_KEY, true);
        cleanup();
        const loc = await detectActiveGeolocation();
        resolve(loc);
      };
      laterBtn.onclick = ()=>{
        if(answered) return; answered = true;
        if(window.LocalCache) window.LocalCache.set(GEO_EXPLAINER_KEY, true);
        cleanup();
        resolve(null);
      };
      backdrop.style.display = 'flex';
    });
  }

  // Fast, automatic track — no user interaction required. Tried in
  // order and applied the moment any of them resolves; each result is
  // only ever applied if it's at least as precise as what's already
  // showing (see applyLocationUpgrade), so this can run safely even
  // after the page has already painted with something else.
  async function autoDetectLocation(){
    let loc = await detectSilentGeolocation();
    if(loc) return loc;
    loc = await detectCloudflareGeo();
    if(loc) return loc;
    loc = await detectRoughLocationByIP();
    return loc;
  }

  function updateLocationAccuracyBadge(){
    const badge = document.getElementById('ptLocationAccuracyBadge');
    if(!badge) return;
    const loc = state.location;
    const degraded = loc && (loc.source === 'default' || loc.source === 'ip' || loc.source === 'network');
    if(!degraded){ badge.classList.add('hidden'); badge.textContent=''; return; }
    badge.classList.remove('hidden');
    badge.textContent = loc.source === 'default'
      ? 'Location unavailable — using London. Tap to set your real location.'
      : 'Approximate location — tap to set your exact address for accurate Qiblah.';
  }

  async function init(){
    // Paint instantly with whatever's cached (or, on a fresh install,
    // the London default) so prayer times and Qiblah are usable right
    // away — nothing here waits on a network round-trip. Anything
    // more accurate that turns up afterwards (backend sync, GPS, IP)
    // swaps in seamlessly via applyLocationUpgrade once it resolves.
    loadSavedLocation();
    if(!state.location){
      state.location = {lat:51.5074, lon:-0.1278, label:'London, UK', tz:'Europe/London', source:'default'};
      saveLocation(state.location);
    }
    notify();
    fetchTimings();

    // Background upgrade, entirely non-blocking:
    // — the automatic track (silent GPS → same-origin geo → IP geo)
    //   runs immediately, no tap required.
    // — the interactive track (one-time permission explainer → real
    //   GPS) runs in parallel; if the person never responds to it,
    //   the automatic track above has already improved on the
    //   default, so nothing is left waiting on that dialog.
    autoDetectLocation().then(applyLocationUpgrade).catch(()=>{});
    let alreadyAsked = false;
    alreadyAsked = window.LocalCache ? !!window.LocalCache.get(GEO_EXPLAINER_KEY, false) : false;
    if(!alreadyAsked){
      // Slight delay so the explainer never competes with the initial
      // paint — prayer times & Qiblah are already visible and usable
      // by the time this appears.
      setTimeout(()=>{ requestGeoWithExplainer().then(applyLocationUpgrade).catch(()=>{}); }, 1200);
    }
  }

  return {
    subscribe, init, updateLocationAccuracyBadge,
    useGeolocation, useManualLocation, usePresetCity, setMethod, fetchTimings,
    getNextPrayer, formatRemaining, to12h,
    getState: ()=> state,
    methodName: (id)=> METHOD_NAMES[id] || 'Muslim World League',
    PRAYER_ORDER
  };
})();

// Top-level `const` doesn't attach to `window` automatically — expose
// explicitly so other features (e.g. Travel Mode) can reliably check
// `window.PrayerTimes` before it's guaranteed to be in scope.
window.PrayerTimes = PrayerTimes;

// Expose for offline auto-refresh
window.PrayerTimesAPI = { fetchTimings: ()=> PrayerTimes.fetchTimings() };

/* ============================================================
   PRAYER TIMES UI :: renders PrayerTimes state into both the
   homepage strip (#homeNext*, #homeTimeline) and the full Prayer
   Times page (#pt*). Both surfaces subscribe to the same store so
   they always agree, and a 1s tick keeps the countdown live.
   ============================================================ */
(function(){
  // showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

  const PT_ICONS = {
    Fajr: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
    Sunrise: '<path d="M12 2v6M5 9l2 2M19 9l-2 2M2 17h20M6 17a6 6 0 0 1 12 0"/>',
    Dhuhr: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    Asr: '<circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    Maghrib: '<path d="M12 2v6M5 9l2 2M19 9l-2 2M2 17h20M6 17a6 6 0 0 1 12 0"/><path d="M2 21h20"/>',
    Isha: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>'
  };
  const PT_IMAGES = {
    Fajr: 'assets/prayertimes/fajr.webp',
    Dhuhr: 'assets/prayertimes/dhuhr.webp',
    Asr: 'assets/prayertimes/asr.webp',
    Maghrib: 'assets/prayertimes/maghrib.webp',
    Isha: 'assets/prayertimes/isha.webp'
  };
  function ptIconMarkup(name, size){
    const img = PT_IMAGES[name];
    if(img) return '<img src="'+img+'" alt="" width="'+size+'" height="'+size+'">';
    return '<svg width="'+Math.round(size*0.42)+'" height="'+Math.round(size*0.42)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+PT_ICONS[name]+'</svg>';
  }

  // ==> CONNECT: primary (strongest-authenticity) virtue per prayer for
  // the compact homepage/Prayer-Times widgets. Full sourced entries
  // (Arabic, translation, grade) live in ITEMS under the 'pb-*' ids,
  // browsable in Du'a & Dhikr → Salah and After Salah, and also in the
  // read-only "Prayer Benefits & Protections" reference section on the
  // Prayer Times page (#ptHadithSection). Each prayer has an array —
  // one is picked per day (stable all day, rotates at midnight local
  // time) so the same quote doesn't show every day.
  const PRAYER_QUOTE_WIDGET = {
    Fajr: [
      {headline:"Allah's Protection", text:"Whoever prays the morning (Fajr) prayer is under the protection of Allah.", cite:"Sahih Muslim 657a"},
      {headline:'Gateway to Jannah', text:'Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.', cite:'Sahih al-Bukhari 574'},
      {headline:'Witnessed by Angels', text:'Angels come to you in succession by night and by day, and they gather at the Fajr and Asr prayers.', cite:'Sahih al-Bukhari 555'},
      {headline:'Better Than the World', text:"The two rak'ahs before Fajr are better than this world and everything in it.", cite:'Sahih Muslim 725a'}
    ],
    Dhuhr: [
      {headline:'Shield from the Fire', text:"Whoever preserves four rak'ahs before Dhuhr and four after it, Allah will forbid him from the Fire.", cite:'Sunan at-Tirmidhi 428'},
      {headline:"Heaven's Gates Open", text:'The gates of heaven are opened when the sun passes its zenith, just before Dhuhr.', cite:'Sunan Ibn Majah 1157'}
    ],
    Asr: [
      {headline:'Gateway to Jannah', text:'Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.', cite:'Sahih al-Bukhari 574'},
      {headline:'A Serious Warning', text:'Whoever leaves the Asr prayer, his deeds are nullified.', cite:'Sahih al-Bukhari 553'},
      {headline:'Like Losing Everything', text:'Whoever misses the Asr prayer, it is as if he had lost his family and his wealth.', cite:'Sahih al-Bukhari 552 / Muslim 626'},
      {headline:"The Prophet's Du'a", text:'May Allah have mercy on a person who prays four rak\'ahs before Asr.', cite:'Jami\' at-Tirmidhi 430'}
    ],
    Maghrib: [
      {headline:'A House in Paradise', text:"Whoever prays twelve rak'ahs in a day and night — including two after Maghrib — a house will be built for him in Paradise.", cite:"Jami' at-Tirmidhi 415"}
    ],
    Isha: [
      {headline:"Half a Night's Worship", text:'Whoever attends Isha in congregation, it is as if he had stood half the night in prayer.', cite:"Sahih Muslim 656 / Tirmidhi 221"},
      {headline:"A Whole Night's Worship", text:'Whoever prays Isha and Fajr in congregation, it is as if he had stood the whole night in prayer.', cite:"Sahih Muslim 656 / Tirmidhi 221"},
      {headline:'Immense Hidden Reward', text:'No prayer is heavier upon the hypocrites than Fajr and Isha; if they knew what reward is in them, they would come even if crawling.', cite:'Sahih al-Bukhari 657 / Muslim 651'}
    ]
  };
  function dayOfYear(d){
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }
  function getPrayerQuoteOfDay(prayerName){
    const arr = PRAYER_QUOTE_WIDGET[prayerName];
    if(!arr || !arr.length) return null;
    return arr[dayOfYear(new Date()) % arr.length];
  }

  // ==> CONNECT: Adhkar After Salah — dynamic, current-prayer-only view.
  // Every entry carries a rough "weight" (shorter = lower number) used
  // to sort shortest-to-longest; general adhkar always render in
  // phc-general (sage) regardless of the current prayer, while a
  // prayer-specific entry renders in that prayer's own colour. Sourced
  // and verified the same way as the Prayer Benefits & Protections data.
  const ADHKAR_GENERAL = [
    { weight:1,
      arabic:"أَسْتَغْفِرُ اللَّهَ (×٣) — اللَّهُمَّ أَنْتَ السَّلَامُ وَمِنْكَ السَّلَامُ تَبَارَكْتَ يَا ذَا الْجَلَالِ وَالْإِكْرَامِ",
      translit:"Astaghfirullah (×3). Allahumma antas-salam, wa minkas-salam, tabarakta ya dhal-jalali wal-ikram.",
      translation:"\"I seek the forgiveness of Allah (×3). O Allah, You are Peace, and from You comes peace. Blessed are You, O Possessor of majesty and honour.\" — said right after the salam, before moving or speaking.",
      cite:"Sahih Muslim 591 — Sahih" },
    { weight:2,
      arabic:"سُبْحَانَ اللَّهِ (×٣٣) — الْحَمْدُ لِلَّهِ (×٣٣) — اللَّهُ أَكْبَرُ (×٣٤)",
      translit:"Subhan Allah (×33) — Alhamdu lillah (×33) — Allahu akbar (×34).",
      translation:"\"Glory be to Allah (×33). Praise be to Allah (×33). Allah is the greatest (×34).\" — whoever says this after every prayer will be forgiven, even if his sins are like the foam of the sea.",
      cite:"Sahih Muslim 1/418" },
    { weight:4,
      arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ، اللَّهُمَّ لَا مَانِعَ لِمَا أَعْطَيْتَ، وَلَا مُعْطِيَ لِمَا مَنَعْتَ، وَلَا يَنْفَعُ ذَا الْجَدِّ مِنْكَ الْجَدُّ",
      translit:"La ilaha illallah, wahdahu la sharika lah, lahul-mulku wa lahul-hamd, wa huwa 'ala kulli shay'in qadir. Allahumma la mani'a lima a'tayt, wa la mu'tiya lima mana't, wa la yanfa'u dhal-jaddi minkal-jadd.",
      translation:"\"None has the right to be worshipped but Allah alone, He has no partner, His is the dominion and His is the praise, and He is able to do all things. O Allah, there is none who can withhold what You give, and none may give what You have withheld, and the might of the mighty person cannot benefit him against You.\"",
      cite:"Hisn al-Muslim 67 (Al-Bukhari 1/255, Muslim 1/414)" },
    { weight:5, arabic:null, translit:null,
      translation:"The Three Quls — Al-Ikhlas, Al-Falaq and An-Nas — recited once after every prayer (three times each after Fajr and Maghrib specifically). Full Arabic &amp; transliteration in the Three Quls card, Du'a &amp; Dhikr section.",
      cite:"Qur'an 112–114 — Sunan Abi Dawud, An-Nasa'i" },
    { weight:6, arabic:null, translit:null,
      translation:"Ayat al-Kursi (Qur'an 2:255) — recited after each of the five obligatory prayers, one of the most emphasized daily practices in the Sunnah. Full Arabic &amp; transliteration in the Morning card, Du'a &amp; Dhikr section.",
      cite:"An-Nasa'i, 'Amal al-Yawm wal-Laylah 100" }
  ];
  const ADHKAR_BY_PRAYER = {
    Fajr: [
      { weight:3,
        arabic:"لَاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ يُحْيِي وَيُمِيتُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
        translit:"La ilaha illallahu wahdahu la sharika lahu, lahul-mulku wa lahul-hamdu, yuhyi wa yumitu wa huwa 'ala kulli shay'in qadir. (×10)",
        translation:"\"None has the right to be worshipped but Allah alone, without partner. His is the dominion and His is the praise. He gives life and causes death, and He is able to do all things.\" — recited ten times, before speaking or moving from the place of prayer.",
        cite:"Jami' at-Tirmidhi 3474 — Hasan Sahih" }
    ],
    Dhuhr: [],
    Asr: [],
    Maghrib: [
      { weight:3,
        arabic:"لَاَ إِلَهَ إِلاَّ اللَّهُ وَحْدَهُ لاَ شَرِيكَ لَهُ لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ يُحْيِي وَيُمِيتُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ",
        translit:"La ilaha illallahu wahdahu la sharika lahu, lahul-mulku wa lahul-hamdu, yuhyi wa yumitu wa huwa 'ala kulli shay'in qadir. (×10)",
        translation:"Same wording as after Fajr — recited ten times after Maghrib, before speaking or moving from the place of prayer.",
        cite:"Jami' at-Tirmidhi 3474 — Hasan Sahih" }
    ],
    Isha: []
  };
  // "Expanded" adhkar — additional authentic supplications beyond the
  // core after-salah set, shown below a divider. Same colour rules
  // apply (general = sage, prayer-specific = that prayer's colour).
  const ADHKAR_EXPANDED_GENERAL = [
    { weight:1,
      arabic:"اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ",
      translit:"Allahumma a'inni 'ala dhikrika, wa shukrika, wa husni 'ibadatik.",
      translation:"\"O Allah, help me to remember You, to give thanks to You, and to worship You in the best manner.\" — the Prophet ﷺ told Mu'adh ibn Jabal never to leave this off after every prayer.",
      cite:"Sunan Abi Dawud 1522 — Sahih" }
  ];
  const ADHKAR_EXPANDED_BY_PRAYER = {
    Fajr: [
      { weight:1,
        arabic:"اللَّهُمَّ إِنِّي أَسْأَلُكَ عِلْمًا نَافِعًا وَرِزْقًا طَيِّبًا وَعَمَلًا مُتَقَبَّلًا",
        translit:"Allahumma inni as'aluka 'ilman nafi'an, wa rizqan tayyiban, wa 'amalan mutaqabbalan.",
        translation:"\"O Allah, I ask You for beneficial knowledge, wholesome provision, and accepted deeds.\" — recited by the Prophet ﷺ right after the salam of Fajr specifically.",
        cite:"Sunan Ibn Majah 925 — Sahih" }
    ],
    Dhuhr: [], Asr: [], Maghrib: [], Isha: []
  };
  // ==> Prayer Benefits & Protections — authentic hadith per prayer.
  // Rendered dynamically: current/upcoming prayer's group shows by
  // default, "For Every Prayer" always shows beneath it, and a
  // "Show all prayers" toggle reveals every group Fajr→Isha in order.
  const HADITH_BY_PRAYER = {
    Fajr: [
      { arabic:"مَنْ صَلَّى الصُّبْحَ فَهُوَ فِي ذِمَّةِ اللَّهِ فَلاَ يَطْلُبَنَّكُمُ اللَّهُ مِنْ ذِمَّتِهِ بِشَىْءٍ فَيُدْرِكَهُ فَيَكُبَّهُ فِي نَارِ جَهَنَّمَ",
        translation:"\"Whoever prays the morning (Fajr) prayer is under the protection of Allah — so do not violate that protection in any way, for whoever does, Allah will seize him and throw him down on his face into the Fire of Hell.\"",
        cite:"Sahih Muslim 657a — Sahih" },
      { arabic:"مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ",
        translation:"\"Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.\"",
        cite:"Sahih al-Bukhari 574 — Sahih (agreed upon)" },
      { arabic:"يَتَعَاقَبُونَ فِيكُمْ مَلاَئِكَةٌ بِاللَّيْلِ وَمَلاَئِكَةٌ بِالنَّهَارِ، وَيَجْتَمِعُونَ فِي صَلاَةِ الْفَجْرِ وَصَلاَةِ الْعَصْرِ",
        translation:"\"Angels come to you in succession by night and by day, and they gather together at the Fajr and Asr prayers.\"",
        cite:"Sahih al-Bukhari 555 — Sahih" },
      { arabic:"رَكْعَتَا الْفَجْرِ خَيْرٌ مِنْ الدُّنْيَا وَمَا فِيهَا",
        translation:"\"The two rak'ahs before Fajr are better than this world and everything in it.\"",
        cite:"Sahih Muslim 725a — Sahih" }
    ],
    Dhuhr: [
      { arabic:"مَنْ حَافَظَ عَلَى أَرْبَعِ رَكَعَاتٍ قَبْلَ الظُّهْرِ وَأَرْبَعٍ بَعْدَهَا حَرَّمَهُ اللَّهُ عَلَى النَّارِ",
        translation:"\"Whoever preserves four rak'ahs before Dhuhr and four after it, Allah will forbid him from the Fire.\"",
        cite:"Sunan at-Tirmidhi 428 — Hasan Sahih" },
      { arabic:"إِنَّ أَبْوَابَ السَّمَاءِ تُفْتَحُ إِذَا زَالَتِ الشَّمْسُ",
        translation:"\"The gates of heaven are opened when the sun passes its zenith\" — said of the time before Dhuhr, when the Prophet ﷺ loved for his good deeds to rise.",
        cite:"Sunan Ibn Majah 1157 — Hasan (Al-Albani)" }
    ],
    Asr: [
      { arabic:"مَنْ تَرَكَ صَلاَةَ الْعَصْرِ فَقَدْ حَبِطَ عَمَلُهُ",
        translation:"\"Whoever leaves the Asr prayer, his deeds are nullified.\"",
        cite:"Sahih al-Bukhari 553 — Sahih" },
      { arabic:"الَّذِي تَفُوتُهُ صَلاَةُ الْعَصْرِ كَأَنَّمَا وُتِرَ أَهْلَهُ وَمَالَهُ",
        translation:"\"Whoever misses the Asr prayer, it is as if he had lost his family and his wealth.\"",
        cite:"Sahih al-Bukhari 552 / Muslim 626 — Muttafaqun Alayhi" },
      { arabic:"رَحِمَ اللَّهُ امْرَأً صَلَّى قَبْلَ الْعَصْرِ أَرْبَعًا",
        translation:"\"May Allah have mercy on a person who prays four rak'ahs before Asr.\"",
        cite:"Jami' at-Tirmidhi 430 — Hasan" }
    ],
    Maghrib: [
      { arabic:"مَنْ صَلَّى فِي يَوْمٍ وَلَيْلَةٍ ثِنْتَىْ عَشْرَةَ رَكْعَةً بُنِيَ لَهُ بَيْتٌ فِي الْجَنَّةِ أَرْبَعًا قَبْلَ الظُّهْرِ وَرَكْعَتَيْنِ بَعْدَهَا وَرَكْعَتَيْنِ بَعْدَ الْمَغْرِبِ وَرَكْعَتَيْنِ بَعْدَ الْعِشَاءِ وَرَكْعَتَيْنِ قَبْلَ صَلاَةِ الْفَجْرِ",
        translation:"\"Whoever prays twelve rak'ahs in a day and night — including two after Maghrib — a house will be built for him in Paradise.\"",
        cite:"Jami' at-Tirmidhi 415 — Hasan Sahih" }
    ],
    Isha: [
      { arabic:"مَنْ شَهِدَ الْعِشَاءَ فِي جَمَاعَةٍ كَانَ لَهُ قِيَامُ نِصْفِ لَيْلَةٍ",
        translation:"\"Whoever attends Isha in congregation, it is as if he had stood half the night in prayer.\"",
        cite:"Sahih Muslim 656 / Tirmidhi 221 — Sahih" },
      { arabic:"وَمَنْ صَلَّى الْعِشَاءَ وَالْفَجْرَ فِي جَمَاعَةٍ كَانَ لَهُ كَقِيَامِ لَيْلَةٍ",
        translation:"\"And whoever prays Isha and Fajr in congregation, it is as if he had stood the whole night in prayer.\"",
        cite:"Sahih Muslim 656 / Tirmidhi 221 — Sahih" },
      { arabic:"لَيْسَ صَلاَةٌ أَثْقَلَ عَلَى الْمُنَافِقِينَ مِنَ الْفَجْرِ وَالْعِشَاءِ، وَلَوْ يَعْلَمُونَ مَا فِيهِمَا لأَتَوْهُمَا وَلَوْ حَبْوًا",
        translation:"\"No prayer is heavier upon the hypocrites than Fajr and Isha; if they knew what reward is in them, they would come to them even if they had to crawl.\"",
        cite:"Sahih al-Bukhari 657 / Muslim 651 — Muttafaqun Alayhi" }
    ]
  };
  const HADITH_GENERAL = [
    { arabic:"الصَّلَوَاتُ الْخَمْسُ، وَالْجُمُعَةُ إِلَى الْجُمُعَةِ، وَرَمَضَانُ إِلَى رَمَضَانَ، مُكَفِّرَاتٌ مَا بَيْنَهُنَّ إِذَا اجْتَنَبَ الْكَبَائِرَ",
      translation:"\"The five daily prayers, one Friday prayer to the next, and one Ramadan to the next, are expiation for whatever comes between them, so long as major sins are avoided.\"",
      cite:"Sahih Muslim 233a — Sahih" }
  ];
  function renderHadithCard(entry, colorClass){
    return '<div class="pt-hadith-card '+colorClass+'">'
      + '<div class="phc-arabic">'+entry.arabic+'</div>'
      + '<div class="phc-translation">'+entry.translation+'</div>'
      + '<div class="phc-cite">'+entry.cite+'</div>'
      + '</div>';
  }
  let ptHadithShowAll = false;
  let ptHadithCurrentPrayer = 'Isha';
  function renderHadithSection(prayerName){
    ptHadithCurrentPrayer = prayerName;
    const body = document.getElementById('ptHadithBody');
    const subhead = document.getElementById('ptHadithSubhead');
    const showAllBtn = document.getElementById('ptHadithShowAllBtn');
    if(!body) return;
    let html = '';
    if(ptHadithShowAll){
      ['Fajr','Dhuhr','Asr','Maghrib','Isha'].forEach(name=>{
        const cls = 'phc-'+name.toLowerCase();
        html += '<div class="pt-hadith-group-title">'+name+'</div>'
          + (HADITH_BY_PRAYER[name]||[]).map(e=>renderHadithCard(e,cls)).join('');
      });
    } else {
      const cls = 'phc-'+prayerName.toLowerCase();
      html += '<div class="pt-hadith-group-title">'+prayerName+'</div>'
        + (HADITH_BY_PRAYER[prayerName]||[]).map(e=>renderHadithCard(e,cls)).join('');
    }
    html += '<div class="pt-hadith-group-title">For Every Prayer</div>'
      + HADITH_GENERAL.map(e=>renderHadithCard(e,'phc-general')).join('');
    setPrayerContent(body, html);
    if(subhead) subhead.textContent = ptHadithShowAll
      ? 'Authentic hadith on the virtues of each prayer.'
      : 'Authentic hadith for '+prayerName+' — expand to see all five.';
    if(showAllBtn) showAllBtn.setAttribute('aria-expanded', ptHadithShowAll ? 'true' : 'false');
    const label = document.getElementById('ptHadithShowAllLabel');
    if(label) label.textContent = ptHadithShowAll ? 'Show current prayer only' : 'Show all prayers';
  }
  const ptHadithShowAllBtn = document.getElementById('ptHadithShowAllBtn');
  if(ptHadithShowAllBtn){
    ptHadithShowAllBtn.addEventListener('click', function(){
      ptHadithShowAll = !ptHadithShowAll;
      renderHadithSection(ptHadithCurrentPrayer);
    });
  }

  // ==> Adhkar After Salah — Arabic / transliteration / translation
  // display toggle. One button cycles through 4 modes; the chosen
  // mode is saved to localStorage on this device so it persists for
  // the user across visits.
  const ADHKAR_DISPLAY_KEY = 'wwp:adhkar:displayMode';
  const ADHKAR_DISPLAY_MODES = [
    { cls:'', short:'Aa' },
    { cls:'hide-arabic', short:'No Ar' },
    { cls:'hide-translit', short:'No Tl' },
    { cls:'hide-translation', short:'No Tr' }
  ];
  let adhkarDisplayIdx = 0;
  {
    const saved = parseInt(window.LocalCache ? window.LocalCache.get(ADHKAR_DISPLAY_KEY, null) : null, 10);
    if(!isNaN(saved) && saved >= 0 && saved < ADHKAR_DISPLAY_MODES.length) adhkarDisplayIdx = saved;
  }
  function applyAdhkarDisplayMode(){
    const body = document.getElementById('ptAdhkarBody');
    const btn = document.getElementById('ptAdhkarDisplayBtn');
    if(!body) return;
    body.classList.remove('hide-arabic','hide-translit','hide-translation');
    const mode = ADHKAR_DISPLAY_MODES[adhkarDisplayIdx];
    if(mode.cls) body.classList.add(mode.cls);
    if(btn) btn.textContent = mode.short;
  }
  const ptAdhkarDisplayBtn = document.getElementById('ptAdhkarDisplayBtn');
  if(ptAdhkarDisplayBtn){
    ptAdhkarDisplayBtn.addEventListener('click', function(){
      adhkarDisplayIdx = (adhkarDisplayIdx + 1) % ADHKAR_DISPLAY_MODES.length;
      if(window.LocalCache) window.LocalCache.set(ADHKAR_DISPLAY_KEY, adhkarDisplayIdx);
      applyAdhkarDisplayMode();
    });
  }

  function renderAdhkarCard(entry, colorClass){
    let html = '<div class="pt-hadith-card '+colorClass+'">';
    if(entry.arabic) html += '<div class="phc-arabic">'+entry.arabic+'</div>';
    if(entry.translit) html += '<div class="phc-translit">'+entry.translit+'</div>';
    html += '<div class="phc-translation">'+entry.translation+'</div>';
    html += '<div class="phc-cite">'+entry.cite+'</div>';
    html += '</div>';
    return html;
  }
  function renderInitialPrayerReferenceContent(){
    // These sections contain local, bundled content, so they never need to
    // wait for the prayer API just to show useful words. Paint a small
    // general set first, then swap to the prayer-specific list when live
    // timings identify the next prayer.
    const hadithBody = document.getElementById('ptHadithBody');
    if(hadithBody && hadithBody.dataset.ptSkeleton === '1'){
      const hadithHtml = '<div class="pt-hadith-group-title">For Every Prayer</div>'
        + HADITH_GENERAL.map(e=>renderHadithCard(e,'phc-general')).join('');
      setPrayerContent(hadithBody, hadithHtml);
      const sub = document.getElementById('ptHadithSubhead');
      if(sub) sub.textContent = 'Authentic hadith on the virtues of the five daily prayers.';
    }

    const adhkarBody = document.getElementById('ptAdhkarBody');
    if(adhkarBody && adhkarBody.dataset.ptSkeleton === '1'){
      const general = ADHKAR_GENERAL.slice().sort((a,b)=>a.weight-b.weight);
      setPrayerContent(adhkarBody, general.map(e=>renderAdhkarCard(e,'phc-general')).join(''));
      const sub = document.getElementById('ptAdhkarSubhead');
      if(sub) sub.textContent = 'Short adhkar commonly recited after salah.';
      applyAdhkarDisplayMode();
    }
  }

  function renderAdhkarSection(prayerName){
    const body = document.getElementById('ptAdhkarBody');
    const subhead = document.getElementById('ptAdhkarSubhead');
    if(!body) return;
    const colorClass = 'phc-'+prayerName.toLowerCase();
    const specific = (ADHKAR_BY_PRAYER[prayerName] || []).map(e=>({entry:e, cls:colorClass}));
    const general = ADHKAR_GENERAL.map(e=>({entry:e, cls:'phc-general'}));
    const combined = specific.concat(general).sort((a,b)=> a.entry.weight - b.entry.weight);
    let html = combined.map(x=> renderAdhkarCard(x.entry, x.cls)).join('');

    const expSpecific = (ADHKAR_EXPANDED_BY_PRAYER[prayerName] || []).map(e=>({entry:e, cls:colorClass}));
    const expGeneral = ADHKAR_EXPANDED_GENERAL.map(e=>({entry:e, cls:'phc-general'}));
    const expCombined = expSpecific.concat(expGeneral).sort((a,b)=> a.entry.weight - b.entry.weight);
    if(expCombined.length){
      html += '<div class="pt-adhkar-divider"></div>'
        + '<div class="pt-hadith-group-title">Expanded List of Adhkar</div>'
        + expCombined.map(x=> renderAdhkarCard(x.entry, x.cls)).join('');
    }

    setPrayerContent(body, html);
    if(subhead) subhead.textContent = 'What to recite after '+prayerName+', shortest to longest.';
    applyAdhkarDisplayMode();
  }

  // Navigates to the Prayer Times page's full reference list and
  // scrolls it into view. Callable from the homepage (cross-page) or
  // directly from the Prayer Times page itself (same-page scroll).
  function openPrayerHadithSection(){
    const el = document.getElementById('ptHadithSection');
    const toggle = document.getElementById('ptHadithToggle');
    if(el && !el.classList.contains('open')){
      el.classList.add('open');
      if(toggle) toggle.setAttribute('aria-expanded', 'true');
    }
  }
  function goToPrayerHadithSection(){
    const doScroll = () => {
      openPrayerHadithSection();
      const el = document.getElementById('ptHadithSection');
      if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
    };
    if(document.getElementById('page-prayertimes') && !document.getElementById('page-prayertimes').classList.contains('hidden')){
      doScroll();
    } else if(typeof window.switchPage === 'function'){
      window.switchPage('prayertimes');
      setTimeout(doScroll, 220);
    }
  }
  window.goToPrayerHadithSection = goToPrayerHadithSection; // needed for inline onclick on the dynamically-rendered Prayer Times card
  const homePQCard = document.getElementById('homePrayerQuoteCard');
  if(homePQCard){
    homePQCard.addEventListener('click', goToPrayerHadithSection);
    homePQCard.addEventListener('keypress', e=>{ if(e.key==='Enter') goToPrayerHadithSection(); });
  }
  // Open by default (the section is easy to miss on mobile if collapsed);
  // click the header to expand/collapse. (No scroll-based auto-open
  // logic — it was fighting the manual toggle, making the button feel
  // broken when the section re-opened itself.)
  const ptHadithToggleBtn = document.getElementById('ptHadithToggle');
  const ptHadithSectionEl = document.getElementById('ptHadithSection');
  if(ptHadithToggleBtn && ptHadithSectionEl){
    ptHadithToggleBtn.addEventListener('click', function(){
      const isOpen = ptHadithSectionEl.classList.toggle('open');
      ptHadithToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }
  function updatePrayerQuoteWidget(labelId, headlineId, prayerName){
    const labelEl = document.getElementById(labelId);
    const headlineEl = document.getElementById(headlineId);
    if(!labelEl || !headlineEl) return;
    const q = getPrayerQuoteOfDay(prayerName);
    if(!q) return;
    labelEl.textContent = prayerName;
    headlineEl.textContent = q.headline;
    const textEl = document.getElementById(headlineId).closest('.home-prayer-quote, .pt-prayer-quote');
    if(textEl){
      const t = textEl.querySelector('.hpq-text, .ppq-text');
      const c = textEl.querySelector('.hpq-cite, .ppq-cite');
      if(t) t.textContent = '"'+q.text+'"';
      if(c) c.textContent = '— '+q.cite;
    }
  }

  function renderHome(){
    const state = PrayerTimes.getState();
    const nameEl = document.getElementById('homeNextName');
    const timeEl = document.getElementById('homeNextTime');
    const remEl = document.getElementById('homeNextRemaining');
    if(!nameEl) return; // homepage not mounted

    if(state.error && !state.timings){
      nameEl.textContent = '—'; timeEl.textContent = '—';
      remEl.textContent = state.error;
      return;
    }
    if(!state.timings){
      remEl.textContent = state.loading ? 'Loading…' : 'Loading…';
      return;
    }

    const next = PrayerTimes.getNextPrayer();
    if(next){
      nameEl.textContent = next.name;
      timeEl.textContent = PrayerTimes.to12h(next.time);
      remEl.textContent = PrayerTimes.formatRemaining(next.remainingMs) + (next.isTomorrow ? ' (tomorrow)' : '');
      updatePrayerQuoteWidget('homePQLabel', 'homePQHeadline', next.name);
    }

    PrayerTimes.PRAYER_ORDER.forEach(name=>{
      const item = document.querySelector('#homeTimeline .home-timeline-item[data-prayer="'+name+'"]');
      if(!item) return;
      const timeSpan = item.querySelector('.ptime');
      if(timeSpan) timeSpan.textContent = PrayerTimes.to12h(state.timings[name]);
      item.classList.toggle('active', !!(next && next.name===name));
    });
  }

  /* ---- World clocks (Prayer Times page) ----
     5-slot layout: the centre slot always mirrors the currently
     selected main location ("Set your location" — London by default)
     and is labelled "GMT 0" as the reference point. The other 4 slots
     hold user-editable cities (persisted in localStorage); their GMT
     badge shows their live offset *relative to the anchor* (not a
     fixed absolute UTC offset), so picking e.g. New York and LA on
     either side updates both badges to the real gap between them. */
  const PT_CLOCK_KEY = 'wwp:prayertimes:clocks';
  const PT_CITY_LIST = [
    {label:'London', country:'UK', lat:51.5074, lon:-0.1278, tz:'Europe/London'},
    {label:'New York', country:'USA', lat:40.7128, lon:-74.0060, tz:'America/New_York'},
    {label:'Los Angeles', country:'USA', lat:34.0522, lon:-118.2437, tz:'America/Los_Angeles'},
    {label:'Chicago', country:'USA', lat:41.8781, lon:-87.6298, tz:'America/Chicago'},
    {label:'Toronto', country:'Canada', lat:43.6532, lon:-79.3832, tz:'America/Toronto'},
    {label:'Mexico City', country:'Mexico', lat:19.4326, lon:-99.1332, tz:'America/Mexico_City'},
    {label:'São Paulo', country:'Brazil', lat:-23.5505, lon:-46.6333, tz:'America/Sao_Paulo'},
    {label:'Rio de Janeiro', country:'Brazil', lat:-22.9068, lon:-43.1729, tz:'America/Sao_Paulo'},
    {label:'Buenos Aires', country:'Argentina', lat:-34.6037, lon:-58.3816, tz:'America/Argentina/Buenos_Aires'},
    {label:'Praia', country:'Cabo Verde', lat:14.9330, lon:-23.5133, tz:'Atlantic/Cape_Verde'},
    {label:'Casablanca', country:'Morocco', lat:33.5731, lon:-7.5898, tz:'Africa/Casablanca'},
    {label:'Paris', country:'France', lat:48.8566, lon:2.3522, tz:'Europe/Paris'},
    {label:'Madrid', country:'Spain', lat:40.4168, lon:-3.7038, tz:'Europe/Madrid'},
    {label:'Berlin', country:'Germany', lat:52.5200, lon:13.4050, tz:'Europe/Berlin'},
    {label:'Rome', country:'Italy', lat:41.9028, lon:12.4964, tz:'Europe/Rome'},
    {label:'Istanbul', country:'Turkey', lat:41.0082, lon:28.9784, tz:'Europe/Istanbul'},
    {label:'Cairo', country:'Egypt', lat:30.0444, lon:31.2357, tz:'Africa/Cairo'},
    {label:'Lagos', country:'Nigeria', lat:6.5244, lon:3.3792, tz:'Africa/Lagos'},
    {label:'Johannesburg', country:'South Africa', lat:-26.2041, lon:28.0473, tz:'Africa/Johannesburg'},
    {label:'Riyadh', country:'Saudi Arabia', lat:24.7136, lon:46.6753, tz:'Asia/Riyadh'},
    {label:'Makkah', country:'Saudi Arabia', lat:21.3891, lon:39.8579, tz:'Asia/Riyadh'},
    {label:'Dubai', country:'UAE', lat:25.2048, lon:55.2708, tz:'Asia/Dubai'},
    {label:'Karachi', country:'Pakistan', lat:24.8607, lon:67.0011, tz:'Asia/Karachi'},
    {label:'Dhaka', country:'Bangladesh', lat:23.8103, lon:90.4125, tz:'Asia/Dhaka'},
    {label:'Delhi', country:'India', lat:28.6139, lon:77.2090, tz:'Asia/Kolkata'},
    {label:'Jakarta', country:'Indonesia', lat:-6.2088, lon:106.8456, tz:'Asia/Jakarta'},
    {label:'Kuala Lumpur', country:'Malaysia', lat:3.1390, lon:101.6869, tz:'Asia/Kuala_Lumpur'},
    {label:'Singapore', country:'Singapore', lat:1.3521, lon:103.8198, tz:'Asia/Singapore'},
    {label:'Hong Kong', country:'China', lat:22.3193, lon:114.1694, tz:'Asia/Hong_Kong'},
    {label:'Beijing', country:'China', lat:39.9042, lon:116.4074, tz:'Asia/Shanghai'},
    {label:'Tokyo', country:'Japan', lat:35.6762, lon:139.6503, tz:'Asia/Tokyo'},
    {label:'Seoul', country:'South Korea', lat:37.5665, lon:126.9780, tz:'Asia/Seoul'},
    {label:'Sydney', country:'Australia', lat:-33.8688, lon:151.2093, tz:'Australia/Sydney'}
  ];
  window.PT_CITY_LIST = PT_CITY_LIST; // shared reuse (e.g. Travel Mode's own location modal)
  const PT_CLOCK_DEFAULT_LABELS = ['New York','São Paulo','Cairo','Riyadh']; // matches the reference layout
  const findCity = (label)=> PT_CITY_LIST.find(c=>c.label===label) || PT_CITY_LIST[1];

  function loadClockCities(){
    const saved = window.LocalCache ? window.LocalCache.get(PT_CLOCK_KEY, null) : null;
    if(Array.isArray(saved) && saved.length===4) return saved.map(l=>findCity(l).label);
    return PT_CLOCK_DEFAULT_LABELS.slice();
  }
  function saveClockCities(labels){
    if(window.LocalCache) window.LocalCache.set(PT_CLOCK_KEY, labels);
  }
  let ptClockLabels = loadClockCities(); // 4 editable city labels, left→right around the anchor

  function cityOptionsHtml(selectedLabel){
    return PT_CITY_LIST.map(c=>'<option value="'+c.label+'"'+(c.label===selectedLabel?' selected':'')+'>'+c.label+', '+c.country+'</option>').join('');
  }

  function renderClockFace(tz){
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'numeric',minute:'numeric',hour12:false}).formatToParts(now);
    let h=0, m=0;
    parts.forEach(p=>{ if(p.type==='hour') h=parseInt(p.value,10); if(p.type==='minute') m=parseInt(p.value,10); });
    const hourDeg = ((h%12) + m/60) * 30;
    const minDeg = m * 6;
    const timeLabel = new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit'}).format(now);
    return {hourDeg, minDeg, timeLabel};
  }

  // Builds a real vintage/watercolour analogue clock face — parchment
  // dial, painted rim, 12 tick marks with numerals at the quarters,
  // and hour/minute hands — as an inline SVG (viewBox 0 0 100 100).
  function clockFaceSvg(hourDeg, minDeg){
    let ticks = '';
    for(let i=0;i<12;i++){
      const isMajor = i%3===0;
      const r1 = isMajor ? 34.5 : 36.5;
      const cls = isMajor ? 'major' : 'minor';
      ticks += '<line class="cf-tick '+cls+'" x1="50" y1="'+(50-r1)+'" x2="50" y2="'+(50-40)+'" transform="rotate('+(i*30)+' 50 50)"/>';
    }
    const numerals = ''
      + '<text class="cf-num" x="50" y="15">12</text>'
      + '<text class="cf-num" x="85" y="51">3</text>'
      + '<text class="cf-num" x="50" y="87">6</text>'
      + '<text class="cf-num" x="15" y="51">9</text>';
    return '<svg class="pt-clock-svg" viewBox="0 0 100 100">'
      + '<circle cx="50" cy="50" r="47" fill="url(#cfParchment)"/>'
      + '<circle cx="50" cy="50" r="47" fill="#8A6A45" filter="url(#cfGrain)" opacity="0.5"/>'
      + '<circle class="cf-rim" cx="50" cy="50" r="46"/>'
      + '<circle class="cf-rim-inner" cx="50" cy="50" r="40.5"/>'
      + ticks + numerals
      + '<line class="cf-hand cf-hour" x1="50" y1="58" x2="50" y2="29" transform="rotate('+hourDeg+' 50 50)"/>'
      + '<line class="cf-hand cf-min" x1="50" y1="61" x2="50" y2="21" transform="rotate('+minDeg+' 50 50)"/>'
      + '<circle class="cf-pin" cx="50" cy="50" r="3.2"/>'
    + '</svg>';
  }

  // UTC offset in minutes for a timezone at the current instant (DST-aware).
  function tzOffsetMinutes(tz){
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US',{timeZone:tz,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const parts = {};
    dtf.formatToParts(now).forEach(p=>{ if(p.type!=='literal') parts[p.type]=p.value; });
    const asUTC = Date.UTC(parts.year, parts.month-1, parts.day, parts.hour===24?0:parts.hour, parts.minute, parts.second);
    return Math.round((asUTC - now.getTime())/60000);
  }

  // Badge relative to the anchor (the currently selected main
  // location) rather than absolute UTC — "GMT 0" always labels the
  // anchor itself, others show the real live gap either side of it.
  function relativeGmtBadge(tz, anchorTz){
    const diffMin = tzOffsetMinutes(tz) - tzOffsetMinutes(anchorTz);
    if(diffMin === 0) return 'GMT 0';
    const sign = diffMin > 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    const h = Math.floor(abs/60), m = abs%60;
    return 'GMT '+sign+h+(m ? ':'+String(m).padStart(2,'0') : '');
  }

  function anchorCity(){
    const loc = PrayerTimes.getState().location;
    if(loc && loc.tz) return {label: (loc.label||'').split(',')[0] || 'My location', tz: loc.tz};
    return {label:'London', tz:'Europe/London'};
  }

  let ptClockSignature = '';
  let ptClockLastMinuteTick = -1;
  function renderClocks(force){
    const wrap = document.getElementById('ptClocks');
    if(!wrap) return;
    const anchor = anchorCity();
    const leftCities = ptClockLabels.slice(0,2).map(findCity);
    const rightCities = ptClockLabels.slice(2,4).map(findCity);
    const slots = [leftCities[0], leftCities[1], anchor, rightCities[0], rightCities[1]];
    const signature = slots.map(c=>c.label+'|'+c.tz).join('~')+'|'+anchor.tz;
    const minuteTick = Math.floor(Date.now()/60000);

    // City choices/structure rarely change. Build the five clock faces only
    // when the layout changes, then update hands/text once per minute.
    // The old 1-second full-SVG rebuild was needless work because the clock
    // face has no second hand.
    if(!force && signature === ptClockSignature && minuteTick === ptClockLastMinuteTick) return;
    if(force || signature !== ptClockSignature){
      wrap.innerHTML = slots.map((city, i)=>{
        const isAnchor = i===2;
        const editIdx = i<2 ? i : (i>2 ? i-1 : null);
        return '<div class="pt-clock'+(isAnchor?' pt-clock-anchor':'')+'" data-clock-slot="'+i+'">'
          + '<span class="pt-gmt-badge"></span>'
          + '<div class="pt-clock-face-wrap">'
            + '<div class="pt-clock-face">'+clockFaceSvg(0,0)+'</div>'
            + (isAnchor ? '' :
                '<select class="pt-clock-select" data-idx="'+editIdx+'">'+cityOptionsHtml(city.label)+'</select>'
                + '<button type="button" class="pt-clock-edit" data-idx="'+editIdx+'" title="Change city">'
                  + '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
                + '</button>')
          + '</div>'
          + '<span class="pt-clock-city">'+city.label+'</span>'
          + '<span class="pt-clock-time"></span>'
        + '</div>';
      }).join('');
      ptClockSignature = signature;
    }
    ptClockLastMinuteTick = minuteTick;

    slots.forEach((city,i)=>{
      const slot = wrap.querySelector('[data-clock-slot="'+i+'"]');
      if(!slot) return;
      const face = renderClockFace(city.tz);
      const badge = slot.querySelector('.pt-gmt-badge');
      const time = slot.querySelector('.pt-clock-time');
      const hourHand = slot.querySelector('.cf-hour');
      const minHand = slot.querySelector('.cf-min');
      if(badge) badge.textContent = relativeGmtBadge(city.tz, anchor.tz);
      if(time) time.textContent = face.timeLabel;
      if(hourHand) hourHand.setAttribute('transform','rotate('+face.hourDeg+' 50 50)');
      if(minHand) minHand.setAttribute('transform','rotate('+face.minDeg+' 50 50)');
    });
  }

  // Clicking a city name opens its (hidden, absolutely-positioned)
  // native <select> right on top of it — simplest reliable cross-device
  // picker without building a custom dropdown component.
  // The 1s clock-hand tick (setInterval(renderClocks,1000) below) rebuilds
  // this whole innerHTML, which was destroying the native <select> the
  // instant it opened (closing the picker after a flash). Guard the tick
  // so it skips re-rendering while a picker is open.
  let ptClockPickerOpen = false;
  document.addEventListener('click', function(e){
    const btn = e.target.closest('.pt-clock-edit[data-idx]');
    if(!btn) return;
    const idx = btn.dataset.idx;
    const select = btn.parentElement.querySelector('.pt-clock-select[data-idx="'+idx+'"]');
    if(select){
      ptClockPickerOpen = true;
      select.style.position='absolute'; select.style.left='0'; select.style.top='0';
      select.style.width='100%'; select.style.height='100%'; select.style.opacity='0.01'; select.style.pointerEvents='auto';
      select.focus();
      if(typeof select.showPicker === 'function'){ try{ select.showPicker(); }catch(e2){} }
    }
  });
  document.addEventListener('change', function(e){
    const select = e.target.closest('.pt-clock-select[data-idx]');
    if(!select) return;
    const idx = parseInt(select.dataset.idx,10);
    ptClockLabels[idx] = select.value;
    saveClockCities(ptClockLabels);
    ptClockPickerOpen = false;
    renderClocks();
  });
  // Cancelled without choosing a new city (native picker dismissed) —
  // no 'change' fires, so clear the guard on blur once focus leaves.
  document.addEventListener('focusout', function(e){
    if(e.target && e.target.classList && e.target.classList.contains('pt-clock-select')){
      setTimeout(function(){ ptClockPickerOpen = false; }, 300);
    }
  }, true);

  /* ---- Day & Night World Map ----
     Uses two real watercolour illustrations (day + night) rather than
     code-drawn shapes. The night image sits on top of the day image,
     clipped to a polygon that follows the actual solar terminator for
     whatever moment the slider represents — so the art is genuinely
     hand-painted while the day/night line itself is astronomically
     accurate and live. Both images are standard equirectangular
     (lon -180..180 -> x 0..100%, lat 90..-90 -> y 0..100%), matching
     the projection the artwork was painted to. */
  const MAP_W = 100, MAP_H = 100; // percentage-space projection

  // The artwork is cropped top/bottom (close to Greenland and New
  // Zealand) rather than a full pole-to-pole equirectangular sheet,
  // so latitude maps to y over this narrower visible range instead
  // of the full ±90°. Longitude is unaffected (no horizontal crop).
  const MAP_LAT_TOP = 75.79, MAP_LAT_BOTTOM = -67.27;
  function lonToX(lon){ return (lon+180)/360*MAP_W; }
  function latToY(lat){ return (MAP_LAT_TOP-lat)/(MAP_LAT_TOP-MAP_LAT_BOTTOM)*MAP_H; }

  // ---- Solar geometry (NOAA simplified equations) ----
  function solarPosition(date){
    const start = Date.UTC(date.getUTCFullYear(),0,1);
    const dayOfYear = Math.floor((date.getTime()-start)/86400000);
    const utcHours = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600;
    const gamma = 2*Math.PI/365 * (dayOfYear - 1 + (utcHours-12)/24);
    const decl = 0.006918 - 0.399912*Math.cos(gamma) + 0.070257*Math.sin(gamma)
      - 0.006758*Math.cos(2*gamma) + 0.000907*Math.sin(2*gamma)
      - 0.002697*Math.cos(3*gamma) + 0.00148*Math.sin(3*gamma); // radians
    const eqtime = 229.18*(0.000075 + 0.001868*Math.cos(gamma) - 0.032077*Math.sin(gamma)
      - 0.014615*Math.cos(2*gamma) - 0.040849*Math.sin(2*gamma)); // minutes
    const subsolarLon = -15*(utcHours - 12) - eqtime/4; // degrees
    const subsolarLat = decl * 180/Math.PI;
    return {lon: ((subsolarLon+180)%360+360)%360-180, lat: subsolarLat};
  }

  function terminatorRing(subsolar){
    const decRad = (Math.abs(subsolar.lat) < 0.2 ? (subsolar.lat<0?-0.2:0.2) : subsolar.lat) * Math.PI/180;
    const lon0 = subsolar.lon;
    const pts = [];
    for(let lon=-180; lon<=180; lon+=5){
      const dlonRad = (lon-lon0) * Math.PI/180;
      const latRad = Math.atan(-Math.cos(dlonRad) / Math.tan(decRad));
      pts.push([lon, latRad*180/Math.PI]);
    }
    return pts;
  }

  function renderMapSvg(dateForMap){
    const nightImg = document.getElementById('ptMapNightImg');
    const termPolygon = document.getElementById('ptTermPolygon');
    const wrap = document.getElementById('ptMapImgWrap');
    if(!nightImg || !termPolygon || !wrap) return;
    const subsolar = solarPosition(dateForMap);
    const term = terminatorRing(subsolar);
    const nightBelow = subsolar.lat >= 0; // north pole in daylight => night is south of the curve

    // Build the night-side mask polygon (curve + map edge) in real pixel
    // coordinates matching the image's rendered box (userSpaceOnUse), so
    // the Gaussian blur filter feathers the terminator into a soft,
    // gradual day/night band instead of a razor-sharp line.
    const w = wrap.clientWidth || 800, h = wrap.clientHeight || 300;
    const curvePts = term.map(p=>[lonToX(p[0])/MAP_W*w, latToY(p[1])/MAP_H*h]);
    const edgeY = nightBelow ? h : 0;
    const pts = curvePts.slice();
    pts.push([w, edgeY], [0, edgeY]);
    const polygon = pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
    termPolygon.setAttribute('points', polygon);
  }

  function formatMinutes(mins){
    const h = Math.floor(mins/60), m = mins%60;
    const period = h>=12 ? 'PM':'AM';
    let h12 = h%12; if(h12===0) h12=12;
    return h12+':'+String(m).padStart(2,'0')+' '+period;
  }

  const mapState = { mode:'live', minutes:0, playing:false, playTimer:null, zoom:1 };

  function currentAnchorLocalMinutes(){
    const anchor = anchorCity();
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:anchor.tz,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
    let h=0,m=0;
    parts.forEach(p=>{ if(p.type==='hour') h=parseInt(p.value,10); if(p.type==='minute') m=parseInt(p.value,10); });
    return h*60+m;
  }

  function dateForAnchorMinutes(mins){
    // Convert "mins past midnight, anchor-local" into the equivalent
    // real UTC Date (today), so solar geometry is computed correctly.
    const anchor = anchorCity();
    const anchorOffset = tzOffsetMinutes(anchor.tz);
    const utcMinutes = mins - anchorOffset;
    const base = new Date();
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, utcMinutes));
    return d;
  }

  let ptMapRenderKey = '';
  function renderMap(){
    const slider = document.getElementById('ptMapSlider');
    const bubble = document.getElementById('ptMapSliderBubble');
    const timeLabel = document.getElementById('ptMapTimeLabel');
    if(!slider) return; // page not mounted

    if(mapState.mode === 'live'){
      mapState.minutes = currentAnchorLocalMinutes();
    }
    const anchor = anchorCity();
    const renderKey = mapState.mode+'|'+mapState.minutes+'|'+anchor.tz+'|'+anchor.label;
    if(renderKey === ptMapRenderKey) return;
    ptMapRenderKey = renderKey;
    slider.value = mapState.minutes;
    if(bubble){
      bubble.textContent = formatMinutes(mapState.minutes);
      bubble.style.left = (mapState.minutes/1439*100)+'%';
    }
    if(timeLabel){
      timeLabel.querySelector('.pmt-time').textContent = formatMinutes(mapState.minutes);
      timeLabel.querySelector('.pmt-place').textContent = anchor.label+' (GMT 0)';
    }
    renderMapSvg(dateForAnchorMinutes(mapState.minutes));
  }

  function stopMapPlay(){
    mapState.playing = false;
    if(mapState.playTimer){ clearInterval(mapState.playTimer); mapState.playTimer = null; }
    const btn = document.getElementById('ptMapPlay');
    if(btn) btn.classList.remove('playing');
  }
  function startMapPlay(){
    mapState.mode = 'preview';
    const liveToggle = document.getElementById('ptMapLiveToggle');
    if(liveToggle) liveToggle.setAttribute('aria-pressed','false');
    mapState.playing = true;
    const btn = document.getElementById('ptMapPlay');
    if(btn) btn.classList.add('playing');
    mapState.playTimer = setInterval(()=>{
      mapState.minutes = (mapState.minutes + 6) % 1440;
      renderMap();
    }, 120);
  }

  const mapSliderEl = document.getElementById('ptMapSlider');
  if(mapSliderEl) mapSliderEl.addEventListener('input', function(){
    stopMapPlay();
    mapState.mode = 'preview';
    const liveToggle = document.getElementById('ptMapLiveToggle');
    if(liveToggle) liveToggle.setAttribute('aria-pressed','false');
    mapState.minutes = parseInt(this.value,10);
    renderMap();
  });

  const mapPlayBtn = document.getElementById('ptMapPlay');
  if(mapPlayBtn) mapPlayBtn.addEventListener('click', function(){
    if(mapState.playing) stopMapPlay(); else startMapPlay();
  });

  const mapLiveToggle = document.getElementById('ptMapLiveToggle');
  if(mapLiveToggle) mapLiveToggle.addEventListener('click', function(){
    stopMapPlay();
    const isLive = this.getAttribute('aria-pressed') === 'true';
    this.setAttribute('aria-pressed', isLive ? 'false' : 'true');
    mapState.mode = isLive ? 'preview' : 'live';
    renderMap();
  });

  const mapFrame = document.querySelector('.pt-map-frame');
  function setMapZoom(z){
    mapState.zoom = Math.max(1, Math.min(2.5, z));
    const wrap = document.getElementById('ptMapImgWrap');
    if(wrap) wrap.style.transform = 'scale('+mapState.zoom+')';
  }
  const zoomInBtn = document.getElementById('ptMapZoomIn');
  const zoomOutBtn = document.getElementById('ptMapZoomOut');
  const locateBtn = document.getElementById('ptMapLocate');
  if(zoomInBtn) zoomInBtn.addEventListener('click', ()=> setMapZoom(mapState.zoom+0.25));
  if(zoomOutBtn) zoomOutBtn.addEventListener('click', ()=> setMapZoom(mapState.zoom-0.25));
  if(locateBtn) locateBtn.addEventListener('click', ()=> setMapZoom(1));

  // The map ticks live once a minute while in "live" mode; the play
  // animation above handles its own faster interval when active.
  setInterval(()=>{ if(mapState.mode==='live') renderMap(); }, 30000);

  /* ---- Previous / next prayer stack ---- */
  const PT_STACK_ORDER = ['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  function getPrayerStack(){
    const state = PrayerTimes.getState();
    if(!state.timings) return null;
    const now = new Date();
    function toDate(hhmm){
      const [h,m] = (hhmm||'0:0').split(':').map(Number);
      const d = new Date(now); d.setHours(h,m,0,0); return d;
    }
    const times = PT_STACK_ORDER.map(name=>({name, date: toDate(state.timings[name])}));
    let curIdx = -1;
    for(let i=0;i<times.length;i++){ if(times[i].date <= now) curIdx = i; }
    if(curIdx === -1) curIdx = 4; // before Fajr — still within yesterday's Isha window
    const at = (i)=> times[((i%5)+5)%5];
    return {
      beforePrev: at(curIdx-2),
      prev: at(curIdx-1),
      current: at(curIdx),
      next: at(curIdx+1),
      afterNext: at(curIdx+2)
    };
  }

  function compactTime(hhmm){
    return PrayerTimes.to12h(hhmm).replace(' AM','am').replace(' PM','pm');
  }

  function setPrayerContent(el, html){
    if(!el) return;
    const firstReveal = el.dataset.ptSkeleton === '1';
    if(firstReveal){
      el.innerHTML = '<div class="pt-live-content">'+html+'</div>';
      el.dataset.ptSkeleton = '0';
      el.classList.remove('pt-loading-state');
      el.removeAttribute('aria-busy');
    } else {
      el.innerHTML = html;
    }
  }

  let ptDayRowSignature = '';
  function renderDayRow(){
    const state = PrayerTimes.getState();
    const row = document.getElementById('ptDayRow');
    if(!row) return;
    if(!state.timings){ return; }
    const stack = getPrayerStack();
    const signature = PT_STACK_ORDER.map(p=>state.timings[p]||'').join('|')+'|'+(state.timings.AsrHanafi||'')+'|'+(stack?.current?.name||'');
    if(signature === ptDayRowSignature && !row.classList.contains('pt-loading-state')) return;
    ptDayRowSignature = signature;
    row.innerHTML = PT_STACK_ORDER.map((name,i)=>{
      const active = stack && stack.current.name === name;
      const nextName = PT_STACK_ORDER[i+1];
      const finish = nextName ? compactTime(state.timings[nextName]) : '—';
      const asrAlt = (name === 'Asr' && state.timings.AsrHanafi)
        ? '<div class="pdc-time-alt">Hanafi '+compactTime(state.timings.AsrHanafi)+'</div>'
        : '';
      return '<div class="pt-day-card'+(active?' active':'')+'" title="'+name+' '+compactTime(state.timings[name])+' – '+finish+'">'
        + '<div class="pdc-top"><span class="pdc-icon">'+ptIconMarkup(name,28)+'</span><span class="pdc-name">'+name+'</span></div>'
        + '<div class="pdc-body">'
          + '<div class="pdc-time">'+compactTime(state.timings[name])+'</div>'
          + '<div class="pdc-time-until">until '+finish+'</div>'
          + asrAlt
        + '</div>'
      + '</div>';
    }).join('');
    row.classList.remove('pt-loading-state');
    row.removeAttribute('aria-busy');
  }

  function shortRemaining(ms){
    if(ms == null || ms < 0) return '';
    const totalMin = Math.floor(ms/60000);
    const h = Math.floor(totalMin/60), m = totalMin%60;
    return (h>0 ? h+'h ' : '') + String(m).padStart(h>0?2:1,'0')+'m';
  }

  let ptPrayerContentPrayer = '';

  function renderNextCards(){
    const state = PrayerTimes.getState();
    const nextCard = document.getElementById('ptNextCard');
    const afterCard = document.getElementById('ptAfterNextCard');
    if(!nextCard || !afterCard) return; // full page not mounted

    if(!state.timings){ return; }

    const stack = getPrayerStack();
    if(!stack) return;
    const next = PrayerTimes.getNextPrayer();

    setPrayerContent(nextCard,
      '<div class="pnc-icon">'+ptIconMarkup(stack.next.name,52)+'</div>'
      + '<div class="pnc-body">'
        + '<div class="pnc-name">'+stack.next.name+'</div>'
        + '<div class="pnc-time">'+PrayerTimes.to12h(state.timings[stack.next.name])+'</div>'
        + (next ? '<div class="pnc-countdown">(Adhan in '+shortRemaining(next.remainingMs)+')</div>' : '')
      + '</div>'
      + '<div class="pnc-finish">'
        + '<div class="pnc-finish-label">Finishes</div>'
        + '<div class="pnc-finish-time">'+PrayerTimes.to12h(state.timings[stack.afterNext.name])+'</div>'
      + '</div>');

    const quoteCard = document.getElementById('ptPrayerQuote');
    if(quoteCard){
      const q = getPrayerQuoteOfDay(stack.next.name);
      quoteCard.setAttribute('role','button');
      quoteCard.setAttribute('tabindex','0');
      quoteCard.onclick = goToPrayerHadithSection;
      quoteCard.onkeypress = function(e){ if(e.key==='Enter') goToPrayerHadithSection(); };
      setPrayerContent(quoteCard, q
        ? '<div class="ppq-label">'+stack.next.name+'</div>'
          + '<div class="ppq-headline">'+q.headline+'</div>'
          + '<div class="ppq-text">"'+q.text+'"</div>'
          + '<span class="ppq-cite">— '+q.cite+'</span>'
        : '');
    }
    if(ptPrayerContentPrayer !== stack.next.name){
      ptPrayerContentPrayer = stack.next.name;
      renderAdhkarSection(stack.next.name);
      renderHadithSection(stack.next.name);
    }

    setPrayerContent(afterCard,
      '<div class="pac-icon">'+ptIconMarkup(stack.afterNext.name,36)+'</div>'
      + '<div class="pac-name">'+stack.afterNext.name+'</div>'
      + '<div class="pac-time">'+PrayerTimes.to12h(state.timings[stack.afterNext.name])+'</div>');
  }

  function qiblaBearing(lat,lon){
    const KAABA_LAT=21.4225, KAABA_LON=39.8262;
    const φ1=lat*Math.PI/180, φ2=KAABA_LAT*Math.PI/180, Δλ=(KAABA_LON-lon)*Math.PI/180;
    const y=Math.sin(Δλ)*Math.cos(φ2);
    const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function qiblaBearingDir(d){
    const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(d/22.5)%16];
  }
  function renderQibla(){
    const loc=PrayerTimes.getState().location||{};
    const q=qiblaBearing(Number(loc.lat||51.5074),Number(loc.lon||-0.1278));
    const deg=document.getElementById('ptQiblaDeg');
    const dir=document.getElementById('ptQiblaDir');
    if(deg) deg.textContent=Math.round(q)+'°';
    if(dir) dir.textContent=qiblaBearingDir(q);
  }

  function renderFullPage(){
    const state = PrayerTimes.getState();

    renderLocationLabel();

    const methodLabel = document.getElementById('ptMethodLabel');
    if(methodLabel) methodLabel.textContent = 'Calculation method: '+PrayerTimes.methodName(state.method);

    renderClocks();
    renderDayRow();
    renderNextCards();
    renderMap();
    renderQibla();
  }

  function isPrayerTimesPageVisible(){
    const el = document.getElementById('page-prayertimes');
    return !!el && !el.classList.contains('hidden');
  }
  function renderAll(){ renderHome(); if(isPrayerTimesPageVisible()) renderFullPage(); }
  // Clock faces tick every second independent of the 15s prayer-time
  // refresh, so hands move smoothly while the page is open.
  setInterval(function(){ if(!ptClockPickerOpen && isPrayerTimesPageVisible()) renderClocks(); }, 60000);

  // ---- Location popover wiring (shared by both entry points) ----
  // Opt-in only: nothing here runs until the person explicitly clicks
  // "Set your location" or "Change" — no location is requested on load.
  const backdrop = document.getElementById('ptPopoverBackdrop');
  function renderLocationLabel(){
    const state = PrayerTimes.getState();
    const label = document.getElementById('ptLocationLabel');
    if(label) label.textContent = (state.location && state.location.source !== 'default') ? state.location.label : 'Set your location';
    PrayerTimes.updateLocationAccuracyBadge();
  }
  function renderCityList(filter){
    const list = document.getElementById('ptCityList');
    if(!list) return;
    const q = (filter||'').trim().toLowerCase();
    const matches = PT_CITY_LIST.filter(c => !q || (c.label+' '+c.country).toLowerCase().includes(q));
    if(!matches.length){
      list.innerHTML = '<div class="pt-city-empty">No cities match “'+filter+'”.</div>';
      return;
    }
    list.innerHTML = matches.map(c=>
      '<button type="button" class="pt-city-item" data-label="'+c.label+'">'+c.label+'<span class="pci-country">, '+c.country+'</span></button>'
    ).join('');
  }
  function openPopover(){
    if(!backdrop) return;
    const state = PrayerTimes.getState();
    const methodSelect = document.getElementById('ptMethodSelect');
    const citySearch = document.getElementById('ptCitySearch');
    if(methodSelect) methodSelect.value = String(state.method);
    if(citySearch) citySearch.value = '';
    renderCityList('');
    backdrop.style.display = 'flex';
  }
  function closePopover(){ if(backdrop) backdrop.style.display = 'none'; }

  document.addEventListener('click', function(e){
    const trigger = e.target.closest('#ptLocationBtn, #ptChangeMethodBtn, .home-next-prayer, #ptLocationAccuracyBadge');
    if(trigger){ openPopover(); }
  });

  const closeBtn = document.getElementById('ptPopoverClose');
  const cancelBtn = document.getElementById('ptPopoverCancel');
  if(closeBtn) closeBtn.addEventListener('click', closePopover);
  if(cancelBtn) cancelBtn.addEventListener('click', closePopover);
  if(backdrop) backdrop.addEventListener('click', function(e){ if(e.target === backdrop) closePopover(); });

  const citySearchEl = document.getElementById('ptCitySearch');
  if(citySearchEl) citySearchEl.addEventListener('input', function(){ renderCityList(this.value); });

  document.addEventListener('click', async function(e){
    const item = e.target.closest('.pt-city-item[data-label]');
    if(!item) return;
    const city = findCity(item.dataset.label);
    item.disabled = true;
    try{
      await PrayerTimes.usePresetCity(city);
      showToast('Showing prayer times for '+city.label+'.');
      closePopover();
    }catch(e2){
      showToast('Could not load that city — try again.');
    }finally{
      item.disabled = false;
    }
  });

  const geoBtn = document.getElementById('ptGeoBtn');
  if(geoBtn) geoBtn.addEventListener('click', async function(){
    geoBtn.disabled = true;
    const original = geoBtn.innerHTML;
    geoBtn.innerHTML = 'Detecting…';
    try{
      await PrayerTimes.useGeolocation();
      closePopover();
    }catch(e){
      showToast('Could not detect your location — try picking a city instead.');
    }finally{
      geoBtn.disabled = false;
      geoBtn.innerHTML = original;
    }
  });

  const saveBtn = document.getElementById('ptPopoverSave');
  if(saveBtn) saveBtn.addEventListener('click', async function(){
    const methodSelect = document.getElementById('ptMethodSelect');
    const method = methodSelect ? parseInt(methodSelect.value,10) : 3;
    const original = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    try{
      await PrayerTimes.setMethod(method);
      closePopover();
    }catch(e){
      showToast(e.message || 'Could not update calculation method.');
    }finally{
      saveBtn.textContent = original;
    }
  });

  PrayerTimes.subscribe(renderAll);
  renderAll();
  renderInitialPrayerReferenceContent();
  PrayerTimes.init();

  // Live countdown tick — re-renders once a minute is enough for the
  // "Xh Ym remaining" display, but check every 15s so it flips promptly
  // right as a prayer time passes.
  setInterval(function(){
    if(isPrayerTimesPageVisible()) renderFullPage();
    else if(!document.getElementById('page-home')?.classList.contains('hidden')) renderHome();
  }, 15000);

  // Expose for cross-IIFE access (e.g., the header-height sync listener
  // needs to call renderMapSvg on window resize)
  window.__PTRenderMapSvg = renderMapSvg;
  window.__PTMapState = mapState;
  window.__PTDateForAnchorMinutes = dateForAnchorMinutes;
})();

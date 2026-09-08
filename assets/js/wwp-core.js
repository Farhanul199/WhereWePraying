/* ============================================================
   WWP :: anonymous device identity + backend sync client.
   No login, no account — a UUID is generated on first visit and
   stored in localStorage. Every save/load call is scoped to that
   ID via the X-Device-Id header, and the Worker keys all data by
   it. If a real account system is added later, this ID becomes
   the thing a login links together, rather than being thrown away.
   ==> CONNECT: this already points at the real Pages Functions API
   below (/api/state/:section). Nothing further to wire here.
   ============================================================ */
window.WWP = (function(){
  const DEVICE_KEY = 'wwp_device_id';

  function uuidv4(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8);
      return v.toString(16);
    });
  }

  let deviceId = null;
  try{ deviceId = localStorage.getItem(DEVICE_KEY); }catch(e){}
  if(!deviceId){
    deviceId = uuidv4();
    try{ localStorage.setItem(DEVICE_KEY, deviceId); }catch(e){}
  }

  const saveTimers = {};
  const SAVE_DEBOUNCE_MS = 700;

  /* ============================================================
     OFFLINE DURABILITY :: every section saved through WWP (Qur'an
     reading position/bookmarks, Journal, Du'a bookmarks, Guides
     progress, etc.) is mirrored into localStorage the moment it's
     saved — not just sent to the backend. That means:
       - toggling a bookmark, switching surah, etc. while offline
         still survives a reload (previously this lived only in
         page memory and vanished the instant the tab closed).
       - if the backend PUT fails (no signal), the section is
         flagged "pending" and automatically retried the next time
         the browser reports it's back online, or on the next app
         open if that never happened while the tab was open — so an
         offline change reaches the server on its own instead of
         being silently dropped and lost for good.
     ============================================================ */
  const OFFLINE_PREFIX = 'wwp_offline_';
  const PENDING_KEY = 'wwp_pending_sections';

  function offlineKey(section){ return OFFLINE_PREFIX + section; }
  function readOfflineCache(section){
    try{
      const raw = localStorage.getItem(offlineKey(section));
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  function writeOfflineCache(section, data){
    try{ localStorage.setItem(offlineKey(section), JSON.stringify(data)); }catch(e){ /* storage full/unavailable — save still attempts the network write */ }
  }
  function getPending(){
    try{ return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }catch(e){ return []; }
  }
  function setPending(list){
    try{ localStorage.setItem(PENDING_KEY, JSON.stringify(list)); }catch(e){}
  }
  function markPending(section){
    const list = getPending();
    if(list.indexOf(section)===-1){ list.push(section); setPending(list); }
  }
  function clearPending(section){
    const list = getPending().filter(function(s){ return s!==section; });
    setPending(list);
  }

  // GET the saved blob for a section. Returns null if nothing saved
  // yet (first visit) or if the request fails (offline, API not
  // deployed yet, etc.) — callers should fall back to local defaults.
  function requestWithTimeout(url, opts, ms){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), ms);
    return fetch(url, Object.assign({}, opts||{}, {signal:controller.signal}))
      .finally(()=>clearTimeout(timer));
  }

  async function get(section){
    try{
      const res = await requestWithTimeout('/api/state/'+section, {
        headers: { 'X-Device-Id': deviceId }
      }, 3500);
      if(!res.ok) throw new Error('Load request failed: '+res.status);
      const json = await res.json();
      const data = (json && json.data !== undefined) ? json.data : null;
      // If this device has an unsynced offline edit for this section
      // waiting to go out, keep serving that instead of the (now
      // stale, about-to-be-overwritten) server copy — otherwise a
      // successful background load could clobber a change the user
      // made moments ago while offline, before it's had a chance to
      // sync.
      if(getPending().indexOf(section)!==-1){
        const cached = readOfflineCache(section);
        if(cached) return cached;
      }
      if(data !== null) writeOfflineCache(section, data);
      return data;
    }catch(e){
      // Offline, timed out, or the API errored — fall back to the
      // last known local copy (a previous successful sync, or an
      // unsynced offline edit) instead of null/empty defaults.
      return readOfflineCache(section);
    }
  }

  function _put(section, data){
    return requestWithTimeout('/api/state/'+section, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', 'X-Device-Id': deviceId },
      body: JSON.stringify({ data })
    }, 15000).then(function(res){
      if(!res.ok) throw new Error('Save request failed: '+res.status);
      return res;
    });
  }

  // Writes to the local offline cache immediately — before attempting
  // the network at all — so the data survives a reload no matter what
  // happens next, then tries to push it to the backend. On failure,
  // flags the section "pending" so it's retried automatically (see
  // the 'online' listener and startup flush below) rather than the
  // change just being lost.
  function _persist(section, data){
    writeOfflineCache(section, data);
    return _put(section, data).then(function(res){
      clearPending(section);
      return res;
    }).catch(function(err){
      markPending(section);
      throw err;
    });
  }

  // Debounced save — call this freely on every small mutation (a
  // checkbox tick, a bookmark toggle); rapid repeated calls coalesce
  // into a single network write ~700ms after the last change. Silent
  // on failure — the change is already durable in the local offline
  // cache and queued for automatic retry, so nagging the user over a
  // background auto-save blip would be more annoying than useful.
  function save(section, data){
    clearTimeout(saveTimers[section]);
    writeOfflineCache(section, data); // durable immediately, even before the debounce timer fires
    saveTimers[section] = setTimeout(function(){ _persist(section, data).catch(function(){}); }, SAVE_DEBOUNCE_MS);
  }

  // Immediate save — use for explicit "Save" button actions where the
  // user expects the write to happen right away and to know if it
  // didn't reach the server yet. The data itself is never lost (it's
  // cached locally and queued for retry either way) — the toast is
  // just about setting expectations for when it'll show up elsewhere.
  function saveNow(section, data){
    clearTimeout(saveTimers[section]);
    return _persist(section, data).catch(function(err){
      showToast("Saved on this device — will sync once you're back online");
      throw err;
    });
  }

  // Retry any sections that failed to sync while offline, the moment
  // the browser reports connectivity is back — instead of waiting for
  // the user to make another edit before the next save attempt.
  window.addEventListener('online', function(){
    getPending().forEach(function(section){
      const data = readOfflineCache(section);
      if(data) _persist(section, data).catch(function(){});
    });
  });

  // Covers the case the 'online' event above doesn't: the tab was
  // closed (or never reloaded) while offline, so no online->offline
  // transition ever fires in this session, even though the device is
  // connected by the time the app is opened again.
  if(getPending().length && navigator.onLine !== false){
    getPending().forEach(function(section){
      const data = readOfflineCache(section);
      if(data) _persist(section, data).catch(function(){});
    });
  }

  return { deviceId: deviceId, get: get, save: save, saveNow: saveNow };
})();

/* Prayer Times module lives in assets/js/features/prayer-times.js */


/* ============================================================
   SHARED :: header nav router, global theme toggle, shared toast.
   Each section below keeps its own full original logic, scoped in
   its own IIFE so nothing collides between sections.
   ============================================================ */
const $ = (sel,root)=> (root||document).querySelector(sel);
let __toastTimer;
function showToast(msg){
  const t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(__toastTimer); __toastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}

// Shared fetch headers for every /api/* call except /api/auth/* — scopes
// requests to this device via WWP's anonymous device ID. Was previously
// copy-pasted identically into 4 separate feature files.
function deviceHeaders(extra){
  return Object.assign({ 'X-Device-Id': window.WWP?.deviceId || '' }, extra || {});
}

// Shared HTML-escaping for any user-submitted or dynamic text rendered
// via innerHTML. Was previously copy-pasted (2 identical DOM-based
// copies + 1 narrower regex-based copy) across 3 feature files.
// Plain string replacement instead of creating/discarding a DOM element
// per call — matters on pages that escape hundreds of list items.
function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Shared local-date-key formatter ("YYYY-MM-DD"), used for day-scoped
// storage keys (Journal entries, Qur'an last-read date, seasonal-theme
// day checks, Prayer Times day cache). todayKey() is just dkey(now).
function dkey(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function todayKey(){ return dkey(new Date()); }

/* ============================================================
   FEATURE LOADER :: lazy-loads a page's JS bundle + CSS the first
   time the user actually navigates there, instead of every feature
   downloading on every visit regardless of which page is used.
   Hooks into the existing wwp-page-shown event dispatched by
   switchPage() below, so no change to the router itself is needed.
   `deps` lets a module declare another module it needs loaded (and
   executed) first — e.g. guides.js reads window.CATEGORIES that
   dua.js defines, so guides declares dua as a dependency.
   ============================================================ */
const FEATURE_MODULES = {
  quran:   { js:['/assets/js/features/quran.js?v=6'],        css:['/assets/css/features/quran.css?v=1'] },
  journal: { js:['/assets/js/features/journal.js?v=3'],      css:['/assets/css/features/journal.css?v=1'] },
  dua:     { js:['/assets/js/features/dua.js?v=4'],          css:['/assets/css/features/dua.css?v=1'] },
  guides:  { js:['/assets/js/features/guides.js?v=4'],       css:['/assets/css/features/guides.css?v=1'] },
  mosque:  { js:['/assets/js/features/find-a-mosque.js?v=6'],css:['/assets/css/features/find-a-mosque.css?v=1'] },
  travel:  { js:['/assets/js/features/travel-mode.js?v=4'],  css:['/assets/css/features/travel-mode.css?v=2'] },
  community:{js:['/assets/js/features/community.js?v=2'],    css:['/assets/css/features/community.css?v=1'] }
};
const loadedModules = new Set();
const loadingModules = {};

function loadCss(href){
  if(document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
function loadScript(src){
  return new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = ()=> reject(new Error('Failed to load '+src));
    document.body.appendChild(s);
  });
}
function loadFeature(id){
  const mod = FEATURE_MODULES[id];
  if(!mod) return Promise.resolve(); // not a lazy-loaded feature (e.g. home/prayertimes)
  if(loadedModules.has(id)) return Promise.resolve();
  if(loadingModules[id]) return loadingModules[id];

  loadingModules[id] = (async ()=>{
    if(mod.deps){
      for(const dep of mod.deps){ await loadFeature(dep); }
    }
    (mod.css||[]).forEach(loadCss);
    for(const src of (mod.js||[])){ await loadScript(src); }
    loadedModules.add(id);
  })();
  return loadingModules[id];
}
window.WWP_loadFeature = loadFeature;

// Fetch-with-offline-cache for large, rarely-changing feature data
// (guides content, du'a text, etc). Network-first so content updates
// reach users normally; falls back to the last cached copy in
// IndexedDB when offline or the request fails, so a page that has
// been opened before still works with no signal.
window.WWP_fetchCached = async function(url, cacheKey){
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('bad status '+res.status);
    const data = await res.json();
    OfflineData.set('metadata', {key:cacheKey, value:data}).catch(()=>0);
    return data;
  }catch(err){
    try{
      const cached = await OfflineData.get('metadata', cacheKey);
      if(cached && cached.value) return cached.value;
    }catch(_e){}
    throw err;
  }
};

const PAGES = ['home','mosque','prayertimes','quran','journal','dua','guides','travel','community'];

/* ============================================================
   ROUTER :: maps each in-app page to a real URL path so every
   section is independently linkable, shareable, and indexable —
   e.g. wherewepraying.com/quran instead of everything living
   behind one URL. Uses the History API (pushState) so navigating
   inside the app updates the address bar and supports back/forward
   without a full reload; a matching `_redirects` rule on Cloudflare
   Pages serves this same index.html for direct visits/refreshes on
   any of these paths, so search engines and shared links land on
   the right section on first load too.
   ============================================================ */
const ROUTES = {
  home:        { path: '/',              title: "WhereWePraying? — Find a Mosque, Prayer Times, Qur'an & More",
                 desc: "WhereWePraying? is your all-in-one Islamic companion: find nearby mosques and Jama'ah times, check accurate prayer times, read the Qur'an with translation and recitation, track good deeds in your Islamic journal, and explore du'a, dhikr and worship guides." },
  mosque:      { path: '/find-a-mosque',  title: "Find a Mosque Near You — WhereWePraying?",
                 desc: "Locate nearby mosques and find the next available Jama'ah prayer time, wherever you are." },
  prayertimes: { path: '/prayer-times',   title: "Prayer Times — WhereWePraying?",
                 desc: "Accurate, location-based prayer times with a live countdown to the next prayer, Jama'ah info and your choice of calculation method." },
  quran:       { path: '/quran',          title: "Read the Qur'an Online — WhereWePraying?",
                 desc: "Read the Qur'an online with Arabic text, translation, transliteration and audio recitation, plus Tafsir Ibn Kathir explanatory notes." },
  journal:     { path: '/journal',        title: "Islamic Journal & Good Deeds Tracker — WhereWePraying?",
                 desc: "Track your daily prayers, good deeds and reflections with an Islamic journal built for consistency and growth." },
  dua:         { path: '/dua-dhikr',      title: "Du'a & Dhikr — WhereWePraying?",
                 desc: "Timeless du'a and adhkar for every moment of the day, drawn from the Qur'an and authentic Sunnah." },
  guides:      { path: '/guides',         title: "Islamic Worship Guides — WhereWePraying?",
                 desc: "Step-by-step guides for daily acts of worship — wudu, salah, and more — made simple." },
  travel:      { path: '/travel-mode',    title: "Travel Mode — WhereWePraying?",
                 desc: "Your prayer companion wherever you are — Qiblah direction, prayer times, and travel-friendly guidance for the road." },
  community:   { path: '/community-ideas', title: "The Community Ideas — WhereWePraying?",
                 desc: "Suggest features, vote on what to build next, and help us find and confirm mosques by sharing photos." }
};

/* Per-guide sub-routes: /guides/wudu, /guides/salah, etc — one
   indexable URL per guide instead of everything living behind
   /guides. Kept as a plain id->meta map (rather than reading GUIDES
   directly) because the Guides section's data lives in its own
   scoped IIFE further down the file and isn't available yet when
   the router first runs — see GUIDE_ROUTE_READY below. Titles/
   descriptions here are duplicated from GUIDES on purpose, so the
   router has something correct to show even before that section
   has initialized (e.g. on a fast direct visit to /guides/wudu). */
const GUIDE_ROUTES = {
  wudu:       { title: "Wudu (Ablution) — Step-by-Step Guide — WhereWePraying?",
                desc: "How to perform Wudu (ablution) before prayer, step by step, with the intention, sequence and duas explained simply." },
  salah:      { title: "Salah (How to Pray) — Step-by-Step Guide — WhereWePraying?",
                desc: "A simple, step-by-step walkthrough of how to pray Salah, covering the core structure shared by every daily prayer." },
  tayammum:   { title: "Tayammum (Dry Ablution) — Step-by-Step Guide — WhereWePraying?",
                desc: "How to perform Tayammum, the dry ablution used in place of Wudu when water is unavailable or unsafe to use." },
  ghusl:      { title: "Ghusl (Ritual Bath) — Step-by-Step Guide — WhereWePraying?",
                desc: "How to perform Ghusl, the full-body ritual purification required before certain acts of worship." },
  adhan:      { title: "Adhan & Iqamah — Step-by-Step Guide — WhereWePraying?",
                desc: "An explanation of the Adhan (call to prayer) and Iqamah, and how they lead into each prayer." },
  sujoodsahw: { title: "Sujood as-Sahw — Step-by-Step Guide — WhereWePraying?",
                desc: "How to perform Sujood as-Sahw, the prostration of forgetfulness, when a mistake happens during prayer." },
  qibla:      { title: "Facing the Qibla — Step-by-Step Guide — WhereWePraying?",
                desc: "How to find and face the Qibla, the direction of the Kaaba, for prayer." },
  fasting:    { title: "A Simple Fasting Routine — Step-by-Step Guide — WhereWePraying?",
                desc: "A simple daily routine for fasting, from the pre-dawn meal through to breaking the fast at Maghrib." }
};

function pageIdFromPath(path){
  // Normalise trailing slashes (except root) so "/quran/" and "/quran" match.
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;

  // /guides/<slug> — parsed separately from the flat ROUTES lookup
  // below since it's the only route with a dynamic segment.
  if(clean === '/guides' || clean.indexOf('/guides/') === 0){
    const slug = clean === '/guides' ? null : clean.slice('/guides/'.length);
    // Any slug is passed through as-is (not gated on GUIDE_ROUTES, which
    // only holds SEO copy for a handful of guides, not the full list) —
    // the Guides section already falls back to an empty state for a
    // genuinely unknown id, so an unrecognised slug degrades safely.
    return { id: 'guides', guide: slug || null };
  }

  for(const id in ROUTES){
    if(ROUTES[id].path === clean) return { id: id, guide: null };
  }
  return null;
}

function updateSEOTags(id, guideSlug){
  let title, desc, path, schema = null;
  const g = (id === 'guides' && guideSlug && window.getGuide) ? window.getGuide(guideSlug) : null;
  if(g){
      title = g.title + ' — WhereWePraying?';
      desc = g.summary.slice(0, 155);
      path = '/guides/'+guideSlug;
      schema = {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": g.title,
        "description": g.summary,
        "estimatedDuration": "PT"+g.time,
        "step": g.steps.map((s,i) => ({
          "@type": "HowToStep",
          "position": i+1,
          "name": s.title,
          "text": s.body
        }))
      };
  }else{
    const route = ROUTES[id] || ROUTES.home;
    title = route.title; desc = route.desc; path = route.path;
  }

  document.title = title;
  let metaDesc = document.querySelector('meta[name="description"]');
  if(!metaDesc){
    metaDesc = document.createElement('meta');
    metaDesc.setAttribute('name', 'description');
    document.head.appendChild(metaDesc);
  }
  metaDesc.setAttribute('content', desc);
  let canonical = document.querySelector('link[rel="canonical"]');
  if(!canonical){
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', 'https://wherewepraying.com'+path);
  
  if(schema){
    let schemaScript = document.querySelector('script[data-guide-schema]');
    if(!schemaScript){
      schemaScript = document.createElement('script');
      schemaScript.setAttribute('type', 'application/ld+json');
      schemaScript.setAttribute('data-guide-schema', '');
      document.head.appendChild(schemaScript);
    }
    schemaScript.textContent = JSON.stringify(schema);
  }
}
// Exposed so selectGuide() (Guides section, own scoped IIFE further
// down) can update <title>/description directly when a guide is
// selected without routing back through switchPage/WWP_openGuide.
window.__WWP_updateGuideSEO = (slug)=> updateSEOTags('guides', slug);

// The Guides section (further down this file, in its own scoped
// IIFE) exposes window.WWP_openGuide once it has initialized. The
// router can run before that happens on a fresh /guides/<slug> load,
// so a requested guide is queued here and opened as soon as it's ready.
let __pendingGuideSlug = null;
function openGuideWhenReady(slug){
  if(window.WWP_openGuide){
    window.WWP_openGuide(slug, {skipRoute:true});
  }else{
    __pendingGuideSlug = slug;
  }
}
window.__WWP_guideSectionReady = function(){
  if(__pendingGuideSlug){
    window.WWP_openGuide(__pendingGuideSlug, {skipRoute:true});
    __pendingGuideSlug = null;
  }
};

/* Keeps body's top padding in sync with the fixed header's real
   height (which changes between desktop's single row and mobile's
   wrapped rows), so content always starts right below it instead of
   overlapping or leaving a gap. */
(function(){
  const header = document.querySelector('header.topbar');
  if(!header) return;
  function syncHeaderHeight(){
    const h = header.offsetHeight;
    document.body.style.paddingTop = h + 'px';
    document.documentElement.style.setProperty('--header-h', h + 'px');
  }
  syncHeaderHeight();
  // ResizeObserver below already covers header size changes (and fires
  // more precisely/less often than a blanket window resize listener) —
  // a separate `resize` listener calling the same function was redundant
  // extra layout work on every resize event.
  window.addEventListener('resize', function(){
    const wrap = document.getElementById('ptMapImgWrap');
    if(wrap && window.__PTRenderMapSvg && window.__PTMapState && window.__PTDateForAnchorMinutes){
      window.__PTRenderMapSvg(window.__PTDateForAnchorMinutes(window.__PTMapState.minutes));
    }
  });
  window.addEventListener('load', syncHeaderHeight);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(syncHeaderHeight);
  new ResizeObserver(syncHeaderHeight).observe(header);
})();

function switchPage(id, opts){
  opts = opts || {};
  if(!PAGES.includes(id)) id = 'home';

  PAGES.forEach(p=>{
    document.getElementById('page-'+p).classList.toggle('hidden', p!==id);
  });
  const activePage = document.getElementById('page-'+id);
  if(activePage){
    // Promote only the first image of the page that is actually being
    // viewed. Hidden SPA pages keep their artwork lazy, saving bandwidth
    // on the common home-page entry path.
    const pageHero = activePage.querySelector('img');
    if(pageHero && pageHero.getAttribute('loading') === 'lazy'){
      pageHero.setAttribute('loading','eager');
      pageHero.setAttribute('fetchpriority','high');
    }
    activePage.classList.add('page-enter');
    // Force a reflow so the browser registers the 'page-enter' start
    // state before we remove it — otherwise the transition is skipped
    // because both class changes land in the same paint frame.
    void activePage.offsetWidth;
    requestAnimationFrame(()=> activePage.classList.remove('page-enter'));
  }
  document.querySelectorAll('.nav a[data-page], .nav button[data-page], .bottom-nav a[data-page]').forEach(a=>{
    a.classList.toggle('active', a.dataset.page===id);
  });
  document.body.classList.toggle('tm-mode', id==='travel');
  if(id==='travel' && window.__WWP_applyTravelBackground) window.__WWP_applyTravelBackground();
  if(window.WWP_Twinkle) setTimeout(window.WWP_Twinkle.render, 50);

  const guideSlug = (id === 'guides') ? opts.guide : null;
  updateSEOTags(id, guideSlug);

  // Only ask the Guides section to select a guide if this navigation
  // actually specifies one AND it isn't already the selected guide —
  // selectGuide() and WWP_openGuide() both route back through here,
  // so without this guard a guide-select would loop back into itself.
  if(id === 'guides' && guideSlug && window.__WWP_currentGuide !== guideSlug){
    openGuideWhenReady(guideSlug);
  }

  // Update the address bar unless this call originated from a
  // popstate event (browser back/forward) or from the guide-select
  // handler itself (which manages its own URL), which already
  // reflect the URL the user navigated to — pushing again would
  // break history or fight with that other code.
  if(!opts.fromPopState && !opts.skipHistory){
    const path = (id === 'guides' && guideSlug) ? '/guides/'+guideSlug : (ROUTES[id]||ROUTES.home).path;
    if(location.pathname !== path){
      history.pushState({page:id, guide:guideSlug||null}, '', path);
    }
  }

  window.scrollTo({top:0, behavior:'auto'});

  // Lets sections load their own data whenever they become the visible
  // page — not just on a nav-link click. Direct loads/refreshes and
  // popstate (back/forward) call switchPage() directly, so anything
  // that only listened for nav clicks (e.g. Community Ideas) would
  // silently never fetch its data on those paths.
  window.dispatchEvent(new CustomEvent('wwp-page-shown', {detail:{id:id}}));
}
window.switchPage = switchPage;

// Kick off lazy-loading a page's feature bundle the moment it's shown —
// including the very first page shown on load, since the initialRoute()
// call at the bottom of this file also goes through switchPage() and
// therefore fires this same event.
window.addEventListener('wwp-page-shown', (e)=>{
  if(e.detail && e.detail.id) window.WWP_loadFeature(e.detail.id).catch(()=>0);
});

// Browser back/forward support.
window.addEventListener('popstate', (e)=>{
  const fromState = e.state;
  if(fromState && fromState.page){
    switchPage(fromState.page, {fromPopState:true, guide:fromState.guide});
  }else{
    const parsed = pageIdFromPath(location.pathname);
    if(parsed) switchPage(parsed.id, {fromPopState:true, guide:parsed.guide});
    else switchPage('home', {fromPopState:true});
  }
});

function cycleTheme(){
  const order=['light','sepia','dark','amoled'];
  const cur = document.body.getAttribute('data-theme') || 'light';
  const next = order[(order.indexOf(cur)+1)%order.length];
  document.body.setAttribute('data-theme', next);
}

document.addEventListener('DOMContentLoaded', ()=> {}); // no-op guard

document.querySelectorAll('a[data-page], button[data-page], [data-page].home-feature-card, .brand[data-page]').forEach(a=>{
  a.addEventListener('click', ()=> switchPage(a.dataset.page));
});
document.querySelectorAll('a[data-soon]').forEach(a=>{
  a.addEventListener('click', ()=> showToast(a.dataset.soon));
});
document.getElementById('sharedThemeToggle').addEventListener('click', cycleTheme);

// ---- Mobile bottom nav: "More" sheet ----
(function(){
  const backdrop = document.getElementById('bnSheetBackdrop');
  const moreBtn = document.getElementById('bnMoreBtn');
  const accountBtn = document.getElementById('bnAccountBtn');
  const themeBtn = document.getElementById('bnThemeBtn');
  if(!backdrop || !moreBtn) return;

  function openSheet(){ backdrop.classList.add('open'); }
  function closeSheet(){ backdrop.classList.remove('open'); }

  moreBtn.addEventListener('click', openSheet);
  backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeSheet(); });
  backdrop.querySelectorAll('[data-bn-close]').forEach(el=> el.addEventListener('click', closeSheet));

  accountBtn?.addEventListener('click', ()=>{
    closeSheet();
    if(window.AuthSystem && window.AuthSystem.toggleAuthPopup) window.AuthSystem.toggleAuthPopup();
  });
  themeBtn?.addEventListener('click', ()=>{
    cycleTheme();
  });
})();

const headerHelpBtn = document.getElementById('headerHelpBtn');
const helpPopup = document.getElementById('helpPopup');
const closeHelpPopupBtn = document.getElementById('closeHelpPopupBtn');
const helpTabAndroid = document.getElementById('helpTabAndroid');
const helpTabIos = document.getElementById('helpTabIos');
const helpPanelAndroid = document.getElementById('helpPanelAndroid');
const helpPanelIos = document.getElementById('helpPanelIos');

function openHelpPopup(){
  if(!helpPopup) return;
  helpPopup.classList.remove('hidden');
  document.body.classList.add('help-popup-open');
}
function closeHelpPopup(){
  if(!helpPopup) return;
  helpPopup.classList.add('hidden');
  document.body.classList.remove('help-popup-open');
}
function switchHelpTab(tab){
  const isAndroid = tab === 'android';
  if(helpTabAndroid) helpTabAndroid.classList.toggle('active', isAndroid);
  if(helpTabIos) helpTabIos.classList.toggle('active', !isAndroid);
  if(helpPanelAndroid) helpPanelAndroid.classList.toggle('hidden', !isAndroid);
  if(helpPanelIos) helpPanelIos.classList.toggle('hidden', isAndroid);
}

if(headerHelpBtn) headerHelpBtn.addEventListener('click', function(e){
  e.stopPropagation();
  if(!helpPopup) return;
  if(helpPopup.classList.contains('hidden')) openHelpPopup();
  else closeHelpPopup();
});
if(closeHelpPopupBtn) closeHelpPopupBtn.addEventListener('click', closeHelpPopup);
if(helpTabAndroid) helpTabAndroid.addEventListener('click', ()=>switchHelpTab('android'));
if(helpTabIos) helpTabIos.addEventListener('click', ()=>switchHelpTab('ios'));

document.addEventListener('click', (e) => {
  if(helpPopup && !helpPopup.classList.contains('hidden') && !helpPopup.contains(e.target) && e.target !== headerHelpBtn && !headerHelpBtn?.contains(e.target)) {
    closeHelpPopup();
  }
});

(function(){
  if(!headerHelpBtn) return;
  var seen = false;
  try { seen = localStorage.getItem('wwp_help_seen') === '1'; } catch(e){}
  if(!seen) headerHelpBtn.classList.add('help-btn-pulse');
  headerHelpBtn.addEventListener('click', function(){
    if(headerHelpBtn.classList.contains('help-btn-pulse')){
      headerHelpBtn.classList.remove('help-btn-pulse');
      headerHelpBtn.classList.add('help-btn-glow-once');
      setTimeout(function(){ headerHelpBtn.classList.remove('help-btn-glow-once'); }, 900);
      try { localStorage.setItem('wwp_help_seen', '1'); } catch(e){}
    }
  });
})();

/* ---------- Welcome / early-access popup ----------
   Shows once, ~20s after first arriving, inviting people to join the
   mailing list. Dismissing it (X, "just explore", backdrop click, or
   a successful signup) sets a localStorage flag so it never nags a
   returning visitor again. */
(function(){
  const SEEN_KEY = 'wwp:welcomeSeen';
  const backdrop = document.getElementById('welcomeBackdrop');
  if(!backdrop) return;
  let alreadySeen = false;
  try{ alreadySeen = localStorage.getItem(SEEN_KEY) === '1'; }catch(e){}
  if(alreadySeen) return;

  function markSeen(){ try{ localStorage.setItem(SEEN_KEY,'1'); }catch(e){} }
  function openWelcome(){
    backdrop.style.display = 'flex';
    requestAnimationFrame(()=> backdrop.classList.add('show'));
  }
  function closeWelcome(){
    backdrop.classList.remove('show');
    markSeen();
    setTimeout(()=>{ backdrop.style.display = 'none'; }, 400);
  }

  setTimeout(openWelcome, 20000);

  const closeBtn = document.getElementById('welcomeClose');
  const skipLink = document.getElementById('welcomeSkip');
  if(closeBtn) closeBtn.addEventListener('click', closeWelcome);
  if(skipLink) skipLink.addEventListener('click', closeWelcome);
  backdrop.addEventListener('click', function(e){ if(e.target === backdrop) closeWelcome(); });

  const form = document.getElementById('welcomeForm');
  const statusEl = document.getElementById('welcomeStatus');
  if(form) form.addEventListener('submit', async function(e){
    e.preventDefault();
    const emailInput = document.getElementById('welcomeEmail');
    const submitBtn = document.getElementById('welcomeSubmit');
    const email = emailInput ? emailInput.value.trim() : '';
    if(!email) return;

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Sending…';
    statusEl.textContent = '';
    statusEl.className = 'welcome-status';

    try{
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'X-Device-Id': window.WWP.deviceId || ''
        },
        body: JSON.stringify({email: email})
      });
      if(!res.ok) throw new Error('Request failed');
      statusEl.textContent = "You're on the list — thank you! 🤍";
      statusEl.className = 'welcome-status ok';
      form.reset();
      setTimeout(closeWelcome, 1800);
    }catch(err){
      statusEl.textContent = "Couldn't sign you up right now — please try again shortly.";
      statusEl.className = 'welcome-status err';
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
})();

// Footer newsletter signup — kept independent of the welcome-popup
// IIFE above, which returns early once a visitor has already seen
// that popup. The footer form must keep working regardless.
(function(){
  const footerForm = document.getElementById('footerNewsletterForm');
  const footerStatusEl = document.getElementById('footerNewsletterStatus');
  if(!footerForm) return;
  footerForm.addEventListener('submit', async function(e){
    e.preventDefault();
    const emailInput = document.getElementById('footerNewsletterEmail');
    const submitBtn = document.getElementById('footerNewsletterSubmit');
    const email = emailInput ? emailInput.value.trim() : '';
    if(!email) return;

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = 'Sending…';
    footerStatusEl.textContent = '';
    footerStatusEl.className = 'footer-newsletter-status';

    try{
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'X-Device-Id': window.WWP.deviceId || ''
        },
        body: JSON.stringify({email: email})
      });
      if(!res.ok) throw new Error('Request failed');
      footerStatusEl.textContent = "You're on the list — thank you! 🤍";
      footerStatusEl.className = 'footer-newsletter-status ok';
      footerForm.reset();
    }catch(err){
      footerStatusEl.textContent = "Couldn't sign you up right now — please try again shortly.";
      footerStatusEl.className = 'footer-newsletter-status err';
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });
})();

// Initial route: land on whichever page (and, for guides, which
// specific guide) matches the URL the user arrived on — a direct
// visit/refresh to /quran or /guides/wudu, a shared link, etc —
// falling back to the home page for unrecognised paths.
(function initialRoute(){
  const parsed = pageIdFromPath(location.pathname) || {id:'home', guide:null};
  switchPage(parsed.id, {fromPopState:true, guide:parsed.guide});
  // Replace so the very first history entry has the right state
  // object for popstate to read on a subsequent back navigation.
  const path = (parsed.id === 'guides' && parsed.guide) ? '/guides/'+parsed.guide : (ROUTES[parsed.id]||ROUTES.home).path;
  history.replaceState({page:parsed.id, guide:parsed.guide||null}, '', path);
})();
/* ============================================================
   OFFLINE DATA :: IndexedDB persistence for Quran, Dua/Dhikr, Guides
   Enables full offline access without network
   ============================================================ */
const OfflineData = (function(){
  const DB_NAME = 'wherewepraying';
  const DB_VERSION = 1;
  let db = null;
  
  const init = async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        db = e.target.result;
        if(!db.objectStoreNames.contains('quran_cache')) {
          db.createObjectStore('quran_cache', { keyPath: 'surah' });
        }
        if(!db.objectStoreNames.contains('dua_dhikr')) {
          db.createObjectStore('dua_dhikr', { keyPath: 'id' });
        }
        if(!db.objectStoreNames.contains('guides')) {
          db.createObjectStore('guides', { keyPath: 'id' });
        }
        if(!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  };
  
  const set = async (storeName, key, data) => {
    if(!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const req = tx.objectStore(storeName).put(typeof key === 'object' ? key : { [key]: data });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  };
  
  const get = async (storeName, key) => {
    if(!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
  };
  
  const getAll = async (storeName) => {
    if(!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || []);
    });
  };
  
  const clear = async (storeName) => {
    if(!db) await init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  };
  
  return { init, set, get, getAll, clear };
})();
window.OfflineData = OfflineData;

/* ============================================================
   OFFLINE SYNC :: caches Dua/Dhikr categories and Guides content
   into IndexedDB (via OfflineData above) for offline access. Lives
   here rather than in either dua.js or guides.js — both features
   call it, so it's genuinely shared, not owned by one feature.
   ============================================================ */
window.OfflineSync = (function(){
  const syncCategories = async (categories) => {
    try{
      await OfflineData.set('metadata', { key:'categories_timestamp', value: Date.now() });
      for(const cat of categories){
        await OfflineData.set('dua_dhikr', cat);
      }
    }catch(e){ console.log('Offline sync for categories failed:', e); }
  };

  const syncGuides = async (guides) => {
    try{
      await OfflineData.set('metadata', { key:'guides_timestamp', value: Date.now() });
      for(const guide of guides){
        await OfflineData.set('guides', guide);
      }
    }catch(e){ console.log('Offline sync for guides failed:', e); }
  };

  return { syncCategories, syncGuides };
})();

// Initialize offline DB on page load
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => OfflineData.init().catch(()=>0));
} else {
  OfflineData.init().catch(()=>0);
}



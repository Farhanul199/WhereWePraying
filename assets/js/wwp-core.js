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
      if(!res.ok) return null;
      const json = await res.json();
      return (json && json.data !== undefined) ? json.data : null;
    }catch(e){
      return null;
    }
  }

  function _put(section, data){
    return requestWithTimeout('/api/state/'+section, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json', 'X-Device-Id': deviceId },
      body: JSON.stringify({ data })
    }, 5000).catch(function(){});
  }

  // Debounced save — call this freely on every small mutation (a
  // checkbox tick, a bookmark toggle); rapid repeated calls coalesce
  // into a single network write ~700ms after the last change.
  function save(section, data){
    clearTimeout(saveTimers[section]);
    saveTimers[section] = setTimeout(function(){ _put(section, data); }, SAVE_DEBOUNCE_MS);
  }

  // Immediate save — use for explicit "Save" button actions where
  // the user expects the write to happen right away.
  function saveNow(section, data){
    clearTimeout(saveTimers[section]);
    return _put(section, data);
  }

  return { deviceId: deviceId, get: get, save: save, saveNow: saveNow };
})();

/* Prayer Times module moved to src/features/prayer-times/prayer-times.js */


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
    return { id: 'guides', guide: (slug && GUIDE_ROUTES[slug]) ? slug : null };
  }

  for(const id in ROUTES){
    if(ROUTES[id].path === clean) return { id: id, guide: null };
  }
  return null;
}

function updateSEOTags(id, guideSlug){
  let title, desc, path, schema = null;
  if(id === 'guides' && guideSlug && GUIDE_ROUTES[guideSlug]){
    const g = window.getGuide ? window.getGuide(guideSlug) : null;
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
    }
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
  window.addEventListener('resize', syncHeaderHeight);
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
  document.querySelectorAll('.nav a[data-page], .bottom-nav a[data-page]').forEach(a=>{
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

document.querySelectorAll('a[data-page], [data-page].home-feature-card, .brand[data-page]').forEach(a=>{
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

// Initialize offline DB on page load
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => OfflineData.init().catch(()=>0));
} else {
  OfflineData.init().catch(()=>0);
}



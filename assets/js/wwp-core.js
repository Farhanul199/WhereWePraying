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
   QUR'AN SECTION
   ============================================================ */
(function(){

/* ============================================================
   DATA :: static reference data (surah list, juz boundaries)
   These are structural facts about the Qur'an's standard mushaf
   layout — safe to hardcode, independent of any text source.
   ============================================================ */
const SURAHS = [
[1,"Al-Fatihah","الفاتحة","The Opening",7,"Meccan"],
[2,"Al-Baqarah","البقرة","The Cow",286,"Medinan"],
[3,"Aal-e-Imran","آل عمران","The Family of Imran",200,"Medinan"],
[4,"An-Nisa","النساء","The Women",176,"Medinan"],
[5,"Al-Ma'idah","المائدة","The Table Spread",120,"Medinan"],
[6,"Al-An'am","الأنعام","The Cattle",165,"Meccan"],
[7,"Al-A'raf","الأعراف","The Heights",206,"Meccan"],
[8,"Al-Anfal","الأنفال","The Spoils of War",75,"Medinan"],
[9,"At-Tawbah","التوبة","The Repentance",129,"Medinan"],
[10,"Yunus","يونس","Jonah",109,"Meccan"],
[11,"Hud","هود","Hud",123,"Meccan"],
[12,"Yusuf","يوسف","Joseph",111,"Meccan"],
[13,"Ar-Ra'd","الرعد","The Thunder",43,"Medinan"],
[14,"Ibrahim","إبراهيم","Abraham",52,"Meccan"],
[15,"Al-Hijr","الحجر","The Rocky Tract",99,"Meccan"],
[16,"An-Nahl","النحل","The Bee",128,"Meccan"],
[17,"Al-Isra","الإسراء","The Night Journey",111,"Meccan"],
[18,"Al-Kahf","الكهف","The Cave",110,"Meccan"],
[19,"Maryam","مريم","Mary",98,"Meccan"],
[20,"Ta-Ha","طه","Ta-Ha",135,"Meccan"],
[21,"Al-Anbiya","الأنبياء","The Prophets",112,"Meccan"],
[22,"Al-Hajj","الحج","The Pilgrimage",78,"Medinan"],
[23,"Al-Mu'minun","المؤمنون","The Believers",118,"Meccan"],
[24,"An-Nur","النور","The Light",64,"Medinan"],
[25,"Al-Furqan","الفرقان","The Criterion",77,"Meccan"],
[26,"Ash-Shu'ara","الشعراء","The Poets",227,"Meccan"],
[27,"An-Naml","النمل","The Ant",93,"Meccan"],
[28,"Al-Qasas","القصص","The Narrations",88,"Meccan"],
[29,"Al-Ankabut","العنكبوت","The Spider",69,"Meccan"],
[30,"Ar-Rum","الروم","The Romans",60,"Meccan"],
[31,"Luqman","لقمان","Luqman",34,"Meccan"],
[32,"As-Sajdah","السجدة","The Prostration",30,"Meccan"],
[33,"Al-Ahzab","الأحزاب","The Combined Forces",73,"Medinan"],
[34,"Saba","سبأ","Sheba",54,"Meccan"],
[35,"Fatir","فاطر","Originator",45,"Meccan"],
[36,"Ya-Sin","يس","Ya-Sin",83,"Meccan"],
[37,"As-Saffat","الصافات","Those who set the Ranks",182,"Meccan"],
[38,"Sad","ص","The Letter Sad",88,"Meccan"],
[39,"Az-Zumar","الزمر","The Troops",75,"Meccan"],
[40,"Ghafir","غافر","The Forgiver",85,"Meccan"],
[41,"Fussilat","فصلت","Explained in Detail",54,"Meccan"],
[42,"Ash-Shura","الشورى","The Consultation",53,"Meccan"],
[43,"Az-Zukhruf","الزخرف","The Ornaments of Gold",89,"Meccan"],
[44,"Ad-Dukhan","الدخان","The Smoke",59,"Meccan"],
[45,"Al-Jathiyah","الجاثية","The Crouching",37,"Meccan"],
[46,"Al-Ahqaf","الأحقاف","The Wind-Curved Sandhills",35,"Meccan"],
[47,"Muhammad","محمد","Muhammad",38,"Medinan"],
[48,"Al-Fath","الفتح","The Victory",29,"Medinan"],
[49,"Al-Hujurat","الحجرات","The Rooms",18,"Medinan"],
[50,"Qaf","ق","The Letter Qaf",45,"Meccan"],
[51,"Adh-Dhariyat","الذاريات","The Winnowing Winds",60,"Meccan"],
[52,"At-Tur","الطور","The Mount",49,"Meccan"],
[53,"An-Najm","النجم","The Star",62,"Meccan"],
[54,"Al-Qamar","القمر","The Moon",55,"Meccan"],
[55,"Ar-Rahman","الرحمن","The Most Merciful",78,"Medinan"],
[56,"Al-Waqi'ah","الواقعة","The Inevitable",96,"Meccan"],
[57,"Al-Hadid","الحديد","The Iron",29,"Medinan"],
[58,"Al-Mujadilah","المجادلة","The Pleading Woman",22,"Medinan"],
[59,"Al-Hashr","الحشر","The Exile",24,"Medinan"],
[60,"Al-Mumtahanah","الممتحنة","She that is Examined",13,"Medinan"],
[61,"As-Saff","الصف","The Ranks",14,"Medinan"],
[62,"Al-Jumu'ah","الجمعة","Friday",11,"Medinan"],
[63,"Al-Munafiqun","المنافقون","The Hypocrites",11,"Medinan"],
[64,"At-Taghabun","التغابن","Mutual Disillusion",18,"Medinan"],
[65,"At-Talaq","الطلاق","Divorce",12,"Medinan"],
[66,"At-Tahrim","التحريم","The Prohibition",12,"Medinan"],
[67,"Al-Mulk","الملك","The Sovereignty",30,"Meccan"],
[68,"Al-Qalam","القلم","The Pen",52,"Meccan"],
[69,"Al-Haqqah","الحاقة","The Reality",52,"Meccan"],
[70,"Al-Ma'arij","المعارج","The Ascending Stairways",44,"Meccan"],
[71,"Nuh","نوح","Noah",28,"Meccan"],
[72,"Al-Jinn","الجن","The Jinn",28,"Meccan"],
[73,"Al-Muzzammil","المزمل","The Enshrouded One",20,"Meccan"],
[74,"Al-Muddaththir","المدثر","The Cloaked One",56,"Meccan"],
[75,"Al-Qiyamah","القيامة","The Resurrection",40,"Meccan"],
[76,"Al-Insan","الإنسان","Man",31,"Medinan"],
[77,"Al-Mursalat","المرسلات","Those Sent Forth",50,"Meccan"],
[78,"An-Naba","النبأ","The Tidings",40,"Meccan"],
[79,"An-Nazi'at","النازعات","Those who drag forth",46,"Meccan"],
[80,"Abasa","عبس","He Frowned",42,"Meccan"],
[81,"At-Takwir","التكوير","The Overthrowing",29,"Meccan"],
[82,"Al-Infitar","الإنفطار","The Cleaving",19,"Meccan"],
[83,"Al-Mutaffifin","المطففين","The Defrauding",36,"Meccan"],
[84,"Al-Inshiqaq","الإنشقاق","The Sundering",25,"Meccan"],
[85,"Al-Buruj","البروج","The Mansions of the Stars",22,"Meccan"],
[86,"At-Tariq","الطارق","The Nightcomer",17,"Meccan"],
[87,"Al-A'la","الأعلى","The Most High",19,"Meccan"],
[88,"Al-Ghashiyah","الغاشية","The Overwhelming",26,"Meccan"],
[89,"Al-Fajr","الفجر","The Dawn",30,"Meccan"],
[90,"Al-Balad","البلد","The City",20,"Meccan"],
[91,"Ash-Shams","الشمس","The Sun",15,"Meccan"],
[92,"Al-Layl","الليل","The Night",21,"Meccan"],
[93,"Ad-Duha","الضحى","The Morning Hours",11,"Meccan"],
[94,"Ash-Sharh","الشرح","The Relief",8,"Meccan"],
[95,"At-Tin","التين","The Fig",8,"Meccan"],
[96,"Al-Alaq","العلق","The Clot",19,"Meccan"],
[97,"Al-Qadr","القدر","The Power",5,"Meccan"],
[98,"Al-Bayyinah","البينة","The Clear Proof",8,"Medinan"],
[99,"Az-Zalzalah","الزلزلة","The Earthquake",8,"Medinan"],
[100,"Al-Adiyat","العاديات","The Courser",11,"Meccan"],
[101,"Al-Qari'ah","القارعة","The Calamity",11,"Meccan"],
[102,"At-Takathur","التكاثر","Rivalry in World Increase",8,"Meccan"],
[103,"Al-Asr","العصر","The Declining Day",3,"Meccan"],
[104,"Al-Humazah","الهمزة","The Traducer",9,"Meccan"],
[105,"Al-Fil","الفيل","The Elephant",5,"Meccan"],
[106,"Quraysh","قريش","Quraysh",4,"Meccan"],
[107,"Al-Ma'un","الماعون","Small Kindnesses",7,"Meccan"],
[108,"Al-Kawthar","الكوثر","Abundance",3,"Meccan"],
[109,"Al-Kafirun","الكافرون","The Disbelievers",6,"Meccan"],
[110,"An-Nasr","النصر","Divine Support",3,"Medinan"],
[111,"Al-Masad","المسد","The Palm Fibre",5,"Meccan"],
[112,"Al-Ikhlas","الإخلاص","Sincerity",4,"Meccan"],
[113,"Al-Falaq","الفلق","The Daybreak",5,"Meccan"],
[114,"An-Nas","الناس","Mankind",6,"Meccan"]
].map(function(r){return {num:r[0],en:r[1],ar:r[2],meaning:r[3],ayahs:r[4],type:r[5]};});

// Standard 30-Juz starting boundaries [juz, surah, ayah]
const JUZ_BOUNDS = [
[1,1,1],[2,2,142],[3,2,253],[4,3,93],[5,4,24],[6,4,148],[7,5,82],[8,6,111],
[9,7,88],[10,8,41],[11,9,93],[12,11,6],[13,12,53],[14,15,1],[15,17,1],[16,18,75],
[17,21,1],[18,23,1],[19,25,21],[20,27,56],[21,29,46],[22,33,31],[23,36,28],[24,39,32],
[25,41,47],[26,46,1],[27,51,31],[28,58,1],[29,67,1],[30,78,1]
];

// Seed text — original plain-English renderings (not quoted from any
// published translation) used only to demonstrate the reading layout.
// ==> CONNECT: replace with licensed Qur'an text + translation API
const SEED = {
  "1:1":{ar:"بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",tr:"In the name of Allah, the Most Gracious, the Most Merciful.",tl:"Bismillāhi r-raḥmāni r-raḥīm"},
  "1:2":{ar:"الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",tr:"All praise belongs to Allah, Lord of all the worlds.",tl:"Al-ḥamdu lillāhi rabbi l-ʿālamīn"},
  "1:3":{ar:"الرَّحْمَٰنِ الرَّحِيمِ",tr:"The Most Gracious, the Most Merciful.",tl:"Ar-raḥmāni r-raḥīm"},
  "1:4":{ar:"مَالِكِ يَوْمِ الدِّينِ",tr:"Master of the Day of Judgment.",tl:"Māliki yawmi d-dīn"},
  "1:5":{ar:"إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",tr:"You alone we worship, and You alone we ask for help.",tl:"Iyyāka naʿbudu wa iyyāka nastaʿīn"},
  "1:6":{ar:"اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",tr:"Guide us along the straight path —",tl:"Ihdinā ṣ-ṣirāṭa l-mustaqīm"},
  "1:7":{ar:"صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",tr:"the path of those You have blessed, not of those who have earned Your anger, nor of those who have gone astray.",tl:"Ṣirāṭa lladhīna anʿamta ʿalayhim ghayri l-maghḍūbi ʿalayhim wa lā ḍ-ḍāllīn"},
  "2:1":{ar:"الم",tr:"Alif. Lam. Meem.",tl:"Alif-Lām-Mīm"},
  "2:2":{ar:"ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ",tr:"This is the Book — there is no doubt in it — a guide for those mindful of Allah,",tl:"Dhālika l-kitābu lā rayba fīh, hudan lil-muttaqīn"},
  "2:3":{ar:"الَّذِينَ يُؤْمِنُونَ بِالْغَيْبِ وَيُقِيمُونَ الصَّلَاةَ وَمِمَّا رَزَقْنَاهُمْ يُنفِقُونَ",tr:"who believe in the unseen, establish prayer, and give from what We have provided for them,",tl:"Alladhīna yuʾminūna bi-l-ghaybi wa yuqīmūna ṣ-ṣalāta wa mimmā razaqnāhum yunfiqūn"},
  "2:255":{ar:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
    tr:"Allah — there is no god but Him, the Ever-Living, the Sustainer of all existence. Neither drowsiness nor sleep overtakes Him. To Him belongs everything in the heavens and everything on the earth. Who could intercede with Him without His permission? He knows what lies before His creation and what lies behind them, and they grasp none of His knowledge except what He wills. His throne extends over the heavens and the earth, and preserving them tires Him not. He is the Most High, the Most Great.",
    tl:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm, lā taʾkhudhuhū sinatun wa lā nawm, lahū mā fī s-samāwāti wa mā fī l-arḍ, man dhā lladhī yashfaʿu ʿindahū illā bi-idhnih, yaʿlamu mā bayna aydīhim wa mā khalfahum, wa lā yuḥīṭūna bi-shayʾin min ʿilmihī illā bi-mā shāʾ, wasiʿa kursiyyuhu s-samāwāti wa l-arḍ, wa lā yaʾūduhū ḥifẓuhumā, wa huwa l-ʿaliyyu l-ʿaẓīm."}
};

/* ============================================================
   LIVE QUR'AN SOURCE
   Primary: api.alquran.cloud (free, no key, CORS-open) — Arabic
   (quran-uthmani) + Saheeh International translation + Latin
   transliteration, one request per edition.
   Fallback: fawazahmed0/quran-api, served as static JSON off the
   jsDelivr CDN (free, no key, CORS-open, and — being a CDN-cached
   static file rather than a live API server — far less likely to
   have an off moment). Used automatically if the primary fails,
   so a single provider hiccup doesn't take the whole reader down.
   Whichever source succeeds gets cached in localStorage so re-
   opening a surah — or using the app offline afterwards — is instant.
   ============================================================ */
const QURAN_API_BASE = 'https://api.alquran.cloud/v1';
const QURAN_CDN_BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions';
const QURAN_CACHE_VERSION = 'v3';
const surahCache = {};        // in-memory: surahNum -> {ayahs:{n:{ar,tr,tl}}, source}
const surahLoadPromises = {}; // in-flight fetches, keyed by surahNum

function quranStorageKey(num){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':surah:'+num; }

function seedFallbackForSurah(num){
  const ayahs = {};
  Object.keys(SEED).forEach(k=>{
    const [s,a] = k.split(':').map(Number);
    if(s===num) ayahs[a] = SEED[k];
  });
  return {ayahs, source:'seed'};
}

async function fetchEdition(num, edition){
  const res = await fetch(`${QURAN_API_BASE}/surah/${num}/${edition}`);
  if(!res.ok) throw new Error(`Qur'an API request failed for ${edition}: ${res.status}`);
  const json = await res.json();
  if(!json || !json.data || !Array.isArray(json.data.ayahs)){
    throw new Error(`Unexpected Qur'an API response shape for ${edition}`);
  }
  return json.data;
}

// Fetches all three editions from the primary source, retrying each
// once on failure before giving up — most "Failed to fetch" errors
// are transient network blips, not the API being genuinely down.
async function fetchSurahPrimary(num){
  const withRetry = (edition)=> fetchEdition(num, edition).catch(()=> fetchEdition(num, edition));
  const [arabicEd, transEd, translitEd] = await Promise.all([
    withRetry('quran-uthmani'),
    withRetry('en.sahih'),
    withRetry('en.transliteration')
  ]);
  const ayahs = {};
  arabicEd.ayahs.forEach((a, i)=>{
    ayahs[a.numberInSurah] = {
      ar: a.text,
      tr: (transEd.ayahs[i]) ? transEd.ayahs[i].text : '',
      tl: (translitEd.ayahs[i]) ? translitEd.ayahs[i].text : ''
    };
  });
  return ayahs;
}

async function fetchCdnEdition(num, slug){
  const res = await fetch(`${QURAN_CDN_BASE}/${slug}/${num}.min.json`);
  if(!res.ok) throw new Error(`Qur'an CDN request failed for ${slug}: ${res.status}`);
  const json = await res.json();
  if(!json || !Array.isArray(json.chapter)){
    throw new Error(`Unexpected Qur'an CDN response shape for ${slug}`);
  }
  return json.chapter; // [{chapter, verse, text}, ...]
}

// Fallback source — same three pieces (Arabic Uthmani script, Sahih
// International / "Umm Muhammad" translation, transliteration), from
// the jsDelivr-hosted mirror instead of the live API.
async function fetchSurahFallback(num){
  const [arabicVerses, transVerses, translitVerses] = await Promise.all([
    fetchCdnEdition(num, 'ara-quranacademy'),
    fetchCdnEdition(num, 'eng-ummmuhammad'),
    fetchCdnEdition(num, 'ara-quran-la')
  ]);
  const ayahs = {};
  arabicVerses.forEach((a, i)=>{
    ayahs[a.verse] = {
      ar: a.text,
      tr: (transVerses[i]) ? transVerses[i].text : '',
      tl: (translitVerses[i]) ? translitVerses[i].text : ''
    };
  });
  return ayahs;
}

/* ============================================================
   ALTERNATE TRANSLATIONS
   Saheeh International loads automatically as part of the base
   surah fetch above. Dr. Mustafa Khattab (The Clear Qur'an) and
   Pickthall are fetched lazily, only once selected in the toolbar,
   from the same jsDelivr-hosted CDN mirror used as the fallback
   source — its response shape is already verified elsewhere in
   this file (see fetchCdnEdition).
   ============================================================ */
const TRANSLATION_EDITIONS = {
  sahih: null,                        // uses the base ayahs.tr already fetched
  khattab: 'eng-mustafakhattaba',     // Dr. Mustafa Khattab — The Clear Qur'an
  pickthall: 'eng-mohammedmarmadu'    // Mohammed Marmaduke William Pickthall
};
const translationCache = {};        // `${key}:${surah}` -> {verseNum: text}
const translationLoadPromises = {};

function translationStorageKey(key, num){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':translation:'+key+':'+num; }

async function loadTranslation(surahNum, key){
  const slug = TRANSLATION_EDITIONS[key];
  if(!slug) return null; // 'sahih' — nothing extra to fetch
  const cacheKey = key+':'+surahNum;
  if(translationCache[cacheKey]) return translationCache[cacheKey];
  if(translationLoadPromises[cacheKey]) return translationLoadPromises[cacheKey];

  translationLoadPromises[cacheKey] = (async ()=>{
    try{
      const raw = localStorage.getItem(translationStorageKey(key, surahNum));
      if(raw){
        const parsed = JSON.parse(raw);
        translationCache[cacheKey] = parsed;
        return parsed;
      }
    }catch(e){ /* fall through to network */ }

    try{
      const verses = await fetchCdnEdition(surahNum, slug).catch(()=> fetchCdnEdition(surahNum, slug));
      const map = {};
      verses.forEach(v=> map[v.verse] = v.text);
      translationCache[cacheKey] = map;
      try{ localStorage.setItem(translationStorageKey(key, surahNum), JSON.stringify(map)); }catch(e){}
      return map;
    } catch(err){
      console.error('Translation fetch failed for', key, 'surah', surahNum, err);
      translationCache[cacheKey] = {}; // empty map — render falls back to Saheeh International text
      return {};
    }
  })();

  return translationLoadPromises[cacheKey];
}

/* ============================================================
   EXPLANATORY NOTES (Tafsir) — Tafsir Ibn Kathir (abridged, English),
   fetched lazily per-ayah only when the person opens/auto-loads the
   note panel.

   // ==> CONNECT: source #1 below is this site's own backend endpoint
   // (/api/tafsir/:surah/:ayah — see functions/api/tafsir/[surah]/[ayah].js).
   // Until that's deployed with a KV binding, it 404s harmlessly and the
   // code falls through to the public sources below. Once deployed, it's
   // same-origin (no CORS exposure at all) and serves from cache after
   // the first request, so every visitor after the first gets an
   // instant, reliable note with zero dependency on third-party CDNs.
   ============================================================ */
const TAFSIR_SOURCES = [
  {
    url: (s,a)=> `/api/tafsir/${s}/${a}`,
    extract: json => json && json.text
  },
  {
    url: (s,a)=> `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
    extract: json => json && (json.text || json.tafsir || json.content)
  },
  {
    url: (s,a)=> `https://cdn.jsdelivr.net/gh/fauwadwali-oss/nwv-islamic-data@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
    extract: json => json && (json.text || json.tafsir || json.content)
  },
  {
    url: (s,a)=> `https://ummahapi.com/api/tafsir/ibn_kathir/surah/${s}/ayah/${a}`,
    extract: json => json && json.data && json.data.tafsir
  }
];
const tafsirCache = {};        // `${surah}:${ayah}` -> paragraph array (or null if failed)
const tafsirLoadPromises = {};
const tafsirLastError = {};    // `${surah}:${ayah}` -> human-readable error, for the retry panel

function tafsirStorageKey(surah, ayah){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':tafsir:ibnkathir:v3:'+surah+':'+ayah; }

// Tafsir text comes back as plain text with single line breaks between
// sections/hadith (occasionally with light HTML in some editions) —
// strip any tags, then split on line breaks for readable paragraphs.
function tafsirHtmlToParagraphs(raw){
  if(!raw) return [];
  const withBreaks = String(raw).replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return div.textContent.split(/\n+/).map(p=> p.trim()).filter(Boolean);
}

async function fetchTafsirFromSources(surah, ayah){
  const errors = [];
  for(const source of TAFSIR_SOURCES){
    try{
      const res = await fetch(source.url(surah, ayah));
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rawText = source.extract(json) || '';
      const paragraphs = tafsirHtmlToParagraphs(rawText);
      if(paragraphs.length) return paragraphs;
      throw new Error('empty response');
    } catch(err){
      errors.push(err.message || String(err));
      // try the next source
    }
  }
  throw new Error(errors.join(' · ') || 'All tafsir sources failed');
}

async function loadTafsir(surah, ayah){
  const cacheKey = surah+':'+ayah;
  if(tafsirCache[cacheKey]) return tafsirCache[cacheKey];
  if(tafsirLoadPromises[cacheKey]) return tafsirLoadPromises[cacheKey];

  tafsirLoadPromises[cacheKey] = (async ()=>{
    try{
      const raw = localStorage.getItem(tafsirStorageKey(surah, ayah));
      if(raw){
        const parsed = JSON.parse(raw);
        tafsirCache[cacheKey] = parsed;
        return parsed;
      }
    }catch(e){ /* fall through to network */ }

    try{
      const paragraphs = await fetchTafsirFromSources(surah, ayah);
      tafsirCache[cacheKey] = paragraphs;
      try{ localStorage.setItem(tafsirStorageKey(surah, ayah), JSON.stringify(paragraphs)); }catch(e){}
      return paragraphs;
    } catch(err){
      console.error('Tafsir fetch failed for', surah, ayah, err);
      tafsirLastError[cacheKey] = err.message || String(err);
      tafsirCache[cacheKey] = null; // null (not []) signals "failed", so it isn't cached as "no note"
      return null;
    }
  })();

  return tafsirLoadPromises[cacheKey];
}

async function loadSurahData(num){
  if(surahCache[num]) return surahCache[num];
  if(surahLoadPromises[num]) return surahLoadPromises[num];

  surahLoadPromises[num] = (async ()=>{
    // 1) localStorage cache — the Qur'an text never changes, so once fetched
    //    we never need to hit the network for this surah again.
    try{
      const raw = localStorage.getItem(quranStorageKey(num));
      if(raw){
        const parsed = JSON.parse(raw);
        surahCache[num] = parsed;
        return parsed;
      }
    }catch(e){ /* localStorage unavailable — fall through */ }

    // 1b) IndexedDB fallback — persistent offline cache
    try{
      const cached = await OfflineData.get('quran_cache', num);
      if(cached){
        surahCache[num] = cached;
        return cached;
      }
    }catch(e){ /* IndexedDB unavailable */ }

    // 2) primary source, with 3) CDN fallback if it fails outright
    let ayahs, source;
    try{
      ayahs = await fetchSurahPrimary(num);
      source = 'live';
    } catch(primaryErr){
      console.error('Primary Qur\'an source failed for surah', num, primaryErr);
      try{
        ayahs = await fetchSurahFallback(num);
        source = 'live-fallback';
      } catch(fallbackErr){
        console.error('Fallback Qur\'an source also failed for surah', num, fallbackErr);
        // 4) offline / both sources down — seed text where we have it
        const fallback = seedFallbackForSurah(num);
        fallback.error = true;
        surahCache[num] = fallback;
        return fallback;
      }
    }

    const result = {ayahs, source};
    surahCache[num] = result;
    try{ localStorage.setItem(quranStorageKey(num), JSON.stringify(result)); }catch(e){ /* storage full/unavailable — still usable in-memory */ }
    // Also cache in IndexedDB for offline access
    try{ await OfflineData.set('quran_cache', { surah: num, ...result }); }catch(e){ /* IndexedDB unavailable */ }
    return result;
  })();

  return surahLoadPromises[num];
}

/* ============================================================
   UTIL
   ============================================================ */
const TOTAL_AYAHS = SURAHS.reduce((s,x)=>s+x.ayahs,0); // 6236
const TOTAL_PAGES = 604;
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));

function getSurah(num){ return SURAHS.find(s=>s.num===num); }

function toArabicIndicDigits(n){
  const map = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  return String(n).split('').map(d=> map[+d] ?? d).join('');
}

function cumulativeAyahsBefore(surahNum){
  let c=0;
  for(const s of SURAHS){ if(s.num===surahNum) break; c+=s.ayahs; }
  return c;
}

function getJuz(surahNum, ayahNum){
  let juz=1;
  for(const [j,s,a] of JUZ_BOUNDS){
    if(surahNum>s || (surahNum===s && ayahNum>=a)) juz=j; else break;
  }
  return juz;
}

function approxPage(surahNum, ayahNum){
  const globalIdx = cumulativeAyahsBefore(surahNum)+ayahNum;
  return Math.max(1, Math.min(TOTAL_PAGES, Math.round((globalIdx/TOTAL_AYAHS)*TOTAL_PAGES)));
}

let toastTimer;
function showToast(msg){
  const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

function dkey(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }

/* ============================================================
   STATE :: fresh-device defaults — a brand new device gets a
   genuinely empty state (no fake demo streak/progress). Real
   values load in from the backend in Services.loadFromBackend()
   if this device has saved data already.
   ============================================================ */
const state = {
  theme:'light',
  arabicSize:30,
  transSize:15,
  showTranslit:true,
  showNotes:false,
  arabicFont:"'Amiri',serif",
  currentSurah:1,
  currentAyah:1,
  translation:'sahih',            // 'sahih' | 'khattab' | 'pickthall'
  sidebarTab:'surah',            // 'surah' | 'juz' | 'bookmarks'
  bookmarks:new Set(),           // "surah:ayah"
  history:[],                    // {surah,ayah,ts}
  lastRead:{surah:1,ayah:1,ts:Date.now()},
  physicalBookmark:null,          // {surah, ayah, ts} | null — where the person is in their paper mushaf; optional, manual, unrelated to streak
  readDates:{},                   // dateKey -> true; drives the real streak below
  streak:{days:0, week:[false,false,false,false,false,false,false]}, // Mon..Sun
  streakFreezeMonth:null,         // 'YYYY-MM' of the last month a freeze was used, or null
  todayIdx:(new Date().getDay()+6)%7,
  dailyGoal:{amount:1,unit:'page(s)',freq:'Every day'},
  todayProgress:0,
  progress:{juzDone:0,pagesRead:0,ayatRead:0,timeSpent:'0m'}
};

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

// Initialize offline DB on page load
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => OfflineData.init().catch(()=>0));
} else {
  OfflineData.init().catch(()=>0);
}

/* ============================================================
   SERVICES :: live Qur'an data fetch/cache, local logic, and
   backend sync via WWP (anonymous device-id-first — see shared
   WWP module at top of file).
   ============================================================ */
const Services = {
  fetchAyahText(surah, ayah){
    // Live/cached data first (whole-surah cache from loadSurahData),
    // falling back to the small offline seed set if nothing has loaded yet.
    const cached = surahCache[surah];
    if(cached && cached.ayahs[ayah]) return cached.ayahs[ayah];
    return SEED[surah+':'+ayah] || null;
  },
  surahStatus(surah){
    if(surahCache[surah]) return surahCache[surah].error ? 'error' : 'ready';
    return surahLoadPromises[surah] ? 'loading' : 'idle';
  },
  logHistory(surah, ayah){
    state.history.unshift({surah,ayah,ts:Date.now()});
    state.history = state.history.slice(0,30);
  },
  toggleBookmark(surah, ayah){
    const key = surah+':'+ayah;
    if(state.bookmarks.has(key)) state.bookmarks.delete(key); else state.bookmarks.add(key);
    return state.bookmarks.has(key);
  },
  saveLastRead(surah, ayah){
    state.lastRead = {surah, ayah, ts:Date.now()};
  },
  // Marks today as a reading day and recomputes the streak from real
  // activity (not a mock number) — mirrors the Journal section's
  // reflection-based streak logic.
  markReadToday(){
    state.readDates[dkey(new Date())] = true;
    Services.recomputeStreak();
  },
  recomputeStreak(){
    const today = new Date(); today.setHours(0,0,0,0);
    let cursor = new Date(today);
    if(!state.readDates[dkey(today)]) cursor.setDate(cursor.getDate()-1); // today not logged yet — don't zero the streak early
    // One gap day per calendar month can pass through without breaking
    // the chain (a streak freeze, Duolingo-style) — mirrors the
    // Journal section's freeze logic.
    const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    const freezeAvailable = state.streakFreezeMonth !== monthKey;
    let days = 0, freezeUsedThisPass = false;
    while(true){
      if(state.readDates[dkey(cursor)]){
        days++;
        cursor.setDate(cursor.getDate()-1);
        continue;
      }
      if(days>0 && freezeAvailable && !freezeUsedThisPass){
        freezeUsedThisPass = true;
        cursor.setDate(cursor.getDate()-1);
        continue;
      }
      break;
    }
    state.streak.days = days;
    if(freezeUsedThisPass) state.streakFreezeMonth = monthKey;
    const dow = (today.getDay()+6)%7; // Mon=0..Sun=6
    const monday = new Date(today); monday.setDate(monday.getDate()-dow);
    const week = [];
    for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(d.getDate()+i); week.push(!!state.readDates[dkey(d)]); }
    state.streak.week = week;
    state.todayIdx = dow;
  },
  streakFreezeStatus(){
    const today = new Date();
    const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    return state.streakFreezeMonth === monthKey ? 'used' : 'available';
  },
  // Debounced write of everything worth persisting for this device.
  persist(){
    WWP.save('quran', {
      currentSurah: state.currentSurah,
      currentAyah: state.currentAyah,
      translation: state.translation,
      bookmarks: Array.from(state.bookmarks),
      history: state.history,
      lastRead: state.lastRead,
      physicalBookmark: state.physicalBookmark,
      readDates: state.readDates,
      streakFreezeMonth: state.streakFreezeMonth,
      dailyGoal: state.dailyGoal,
      todayProgress: state.todayProgress,
      progress: state.progress
    });
  },
  // Pulls this device's saved Qur'an state, if any, and merges it in.
  // ==> CONNECT (resolved): this is the real backend load — no auth
  // needed, the device ID from WWP does the scoping.
  async loadFromBackend(){
    const saved = await WWP.get('quran');
    if(!saved) return;
    if(typeof saved.currentSurah==='number') state.currentSurah = saved.currentSurah;
    if(typeof saved.currentAyah==='number') state.currentAyah = saved.currentAyah;
    if(typeof saved.translation==='string') state.translation = saved.translation;
    if(Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
    if(Array.isArray(saved.history)) state.history = saved.history;
    if(saved.lastRead) state.lastRead = saved.lastRead;
    if(saved.physicalBookmark) state.physicalBookmark = saved.physicalBookmark;
    if(saved.readDates) state.readDates = saved.readDates;
    if(saved.streakFreezeMonth !== undefined) state.streakFreezeMonth = saved.streakFreezeMonth;
    if(saved.dailyGoal) state.dailyGoal = saved.dailyGoal;
    if(typeof saved.todayProgress==='number') state.todayProgress = saved.todayProgress;
    if(saved.progress) state.progress = saved.progress;
    Services.recomputeStreak();
  }
};

/* ============================================================
   UI :: render functions
   ============================================================ */
function renderSurahList(filter){
  const list = $('#surahList');
  list.innerHTML='';
  const f = (filter||'').trim().toLowerCase();
  SURAHS.forEach(s=>{
    if(f && !(s.en.toLowerCase().includes(f) || s.meaning.toLowerCase().includes(f) || String(s.num)===f)) return;
    const li = document.createElement('li');
    li.className='surah-row'+(s.num===state.currentSurah?' active':'');
    li.innerHTML = `
      <span class="s-num">${s.num}</span>
      <div class="s-info">
        <div class="s-en">${s.en}</div>
        <div class="s-meaning">${s.meaning}</div>
      </div>
      <div class="s-right">
        <div class="s-ar">${s.ar}</div>
        <div class="s-ayahs">${s.ayahs} Ayahs</div>
      </div>`;
    li.addEventListener('click', ()=> selectSurah(s.num, 1));
    list.appendChild(li);
  });
  if(f && list.children.length===0){
    list.innerHTML = '<div class="popover-empty">No surahs match "'+filter+'"</div>';
  }
}

function renderJuzList(){
  const list = $('#surahList');
  list.innerHTML='';
  JUZ_BOUNDS.forEach(([j, surahNum, ayahNum])=>{
    const s = getSurah(surahNum);
    const isActive = getJuz(state.currentSurah, state.currentAyah)===j;
    const li = document.createElement('li');
    li.className='surah-row'+(isActive?' active':'');
    li.innerHTML = `
      <span class="s-num">${j}</span>
      <div class="s-info">
        <div class="s-en">Juz ${j}</div>
        <div class="s-meaning">Starts at ${s.en} ${ayahNum}</div>
      </div>`;
    li.addEventListener('click', ()=> selectSurah(surahNum, ayahNum));
    list.appendChild(li);
  });
}

function renderBookmarksList(){
  const list = $('#surahList');
  list.innerHTML='';
  const keys = Array.from(state.bookmarks).sort((a,b)=>{
    const [as,aa] = a.split(':').map(Number), [bs,ba] = b.split(':').map(Number);
    return as-bs || aa-ba;
  });
  if(keys.length===0){
    list.innerHTML = '<div class="popover-empty">No bookmarks yet — tap the bookmark icon on any ayah while reading.</div>';
    return;
  }
  keys.forEach(key=>{
    const [su,ay] = key.split(':').map(Number);
    const s = getSurah(su);
    const isActive = su===state.currentSurah && ay===state.currentAyah;
    const li = document.createElement('li');
    li.className='surah-row'+(isActive?' active':'');
    li.innerHTML = `
      <span class="s-num">${su}</span>
      <div class="s-info">
        <div class="s-en">${s.en}</div>
        <div class="s-meaning">Ayah ${ay}</div>
      </div>
      <div class="s-right"><div class="s-ar">${s.ar}</div></div>`;
    li.addEventListener('click', ()=> selectSurah(su, ay));
    list.appendChild(li);
  });
}

function renderSidebarContent(){
  $('#sidebarCount').style.display = state.sidebarTab==='surah' ? '' : 'none';
  if(state.sidebarTab==='surah') renderSurahList($('#globalSearch').value);
  else if(state.sidebarTab==='juz') renderJuzList();
  else renderBookmarksList();
}

function renderBookmarksPopover(){
  const wrap = $('#bookmarksPopoverList');
  const keys = Array.from(state.bookmarks).sort((a,b)=>{
    const [as,aa] = a.split(':').map(Number), [bs,ba] = b.split(':').map(Number);
    return as-bs || aa-ba;
  });
  if(keys.length===0){
    wrap.innerHTML = '<div class="popover-empty">No bookmarks yet — tap the bookmark icon on any ayah.</div>';
    return;
  }
  wrap.innerHTML = keys.map(key=>{
    const [su,ay] = key.split(':').map(Number);
    const s = getSurah(su);
    return `<div class="popover-row" data-surah="${su}" data-ayah="${ay}"><span>${s.en} ${ay}</span><span class="s-ar" style="font-size:15px;">${s.ar}</span></div>`;
  }).join('');
  $$('.popover-row', wrap).forEach(row=>{
    row.addEventListener('click', ()=>{
      selectSurah(+row.dataset.surah, +row.dataset.ayah);
      $('#bookmarksPopover').classList.remove('open');
    });
  });
}

function renderReaderHeader(){
  const s = getSurah(state.currentSurah);
  $('#rHeaderEn').textContent = s.en;
  $('#rHeaderAr').textContent = s.ar;
  const juz = getJuz(state.currentSurah, state.currentAyah);
  const page = approxPage(state.currentSurah, state.currentAyah);
  $('#rHeaderMeta').textContent = `Juz ${juz} · Page ${page} · ${s.type} · ${s.ayahs} Ayahs`;
  renderSurahQuickJumps();
}

// Direct-jump pills for a small set of notable ayah ranges, shown
// right under the surah title — Al-Kahf's first/last 10 (the Jummah
// recommendation) and Al-Baqarah's last 10 + Ayat al-Kursi. Empty for
// every other surah.
function renderSurahQuickJumps(){
  const wrap = $('#surahQuickJumps');
  if(!wrap) return;
  const num = state.currentSurah;
  let pills = [];
  if(num === 18){ // Al-Kahf, 110 ayahs
    pills = [
      {cls:'sqj-kahf', ayah:1, label:'First 10 Ayah'},
      {cls:'sqj-kahf', ayah:101, label:'Last 10 Ayah'}
    ];
  }else if(num === 2){ // Al-Baqarah, 286 ayahs
    pills = [
      {cls:'sqj-baqarah', ayah:255, label:'Ayat al-Kursi'},
      {cls:'sqj-baqarah', ayah:277, label:'Last 10 Ayah'}
    ];
  }
  if(!pills.length){ wrap.innerHTML=''; return; }
  wrap.innerHTML = pills.map(p=>
    `<button type="button" class="sqj-pill ${p.cls}" data-jump-ayah="${p.ayah}">${p.label}</button>`
  ).join('');
  $$('.sqj-pill', wrap).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ayah = parseInt(btn.dataset.jumpAyah, 10);
      state.currentAyah = ayah;
      Services.saveLastRead(num, ayah);
      Services.persist();
      if(!scrollToAyahCard(num, ayah)){
        ensureSurahLoaded(num, ayah);
      }
    });
  });
}

// Builds the markup for one ayah — used when rendering the full,
// continuously-scrollable surah (see renderReader below).
function ayahCardHTML(surahNum, ayahNum, data, isBm){
  const endMark = `<span class="ayah-end-mark">﴾${toArabicIndicDigits(ayahNum)}﴿</span>`;
  // Surah Al-Kahf (18): first 10 and last 10 ayahs get a subtle,
  // theme-matched tint — sage green in Jummah, light peach normally,
  // light lilac in Ramadan. Styling lives entirely in CSS (see
  // .ayah-kahf-highlight rules), keyed off body[data-event-theme] so
  // it stays correct if the active theme changes without a re-render.
  let kahfClass = '';
  if(surahNum === 18){
    if(ayahNum <= 10) kahfClass = ' ayah-kahf-highlight ayah-kahf-first10';
    else if(ayahNum >= 101) kahfClass = ' ayah-kahf-highlight ayah-kahf-last10';
  }
  return `
    <div class="ayah-card${kahfClass}" id="ayah-${surahNum}-${ayahNum}" data-surah="${surahNum}" data-ayah="${ayahNum}">
      <div class="ayah-top">
        <span class="ayah-num">${ayahNum}</span>
        <div class="ayah-mini-actions">
          <button class="mini-btn ${isBm?'bookmarked':''}" data-action="bookmark" title="Bookmark this ayah">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
          </button>
          <button class="mini-btn" data-action="copy" title="Copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          </button>
          <button class="mini-btn" data-action="share" title="Share">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6 15.4 6.4M8.6 13.4l6.8 4.2"/></svg>
          </button>
          <button class="mini-btn${state.showNotes?' active-state':''}" data-action="note" title="Explanatory note">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
          </button>
        </div>
      </div>
      <div class="ayah-ar">${data.ar} ${endMark}</div>
      ${state.showTranslit ? `<div class="ayah-translit">${data.tl}</div>` : ''}
      <div class="ayah-trans">${data.tr}</div>
      <div class="ayah-note${state.showNotes?' open':''}" id="note-${surahNum}-${ayahNum}"></div>
    </div>`;
}

function loadingBlockHTML(){
  return `<div class="ayah-placeholder">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none" class="spin"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>
      Loading this surah…
    </div>`;
}

function errorBlockHTML(){
  return `<div class="ayah-placeholder">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      Couldn't load this surah — check your connection.
      <button id="ayahRetryBtn" class="mini-btn" style="margin-left:8px;width:auto;padding:0 10px;">Retry</button>
    </div>`;
}

// Renders the ENTIRE current surah, ayah 1 through the end, as one
// continuous scrollable pane — no "next ayah" paging needed.
function renderReader(){
  const s = getSurah(state.currentSurah);
  const list = $('#ayahList');
  const cached = surahCache[state.currentSurah];
  const status = Services.surahStatus(state.currentSurah);

  if(!cached){
    list.innerHTML = status==='error' ? errorBlockHTML() : loadingBlockHTML();
    const retryBtn = $('#ayahRetryBtn');
    if(retryBtn) retryBtn.addEventListener('click', ()=>{
      delete surahCache[state.currentSurah];
      delete surahLoadPromises[state.currentSurah];
      ensureSurahLoaded(state.currentSurah);
    });
  } else {
    // Alternate translation (Khattab/Pickthall) — lazy-loaded per surah.
    // Falls back to Saheeh International text for this render if not
    // loaded yet; loadTranslation's own promise triggers a re-render
    // once it resolves.
    const transKey = state.translation;
    let transMap = null;
    if(TRANSLATION_EDITIONS[transKey]){
      transMap = translationCache[transKey+':'+state.currentSurah];
      if(!transMap){
        const requestedSurah = state.currentSurah;
        loadTranslation(requestedSurah, transKey).then(()=>{
          if(state.currentSurah===requestedSurah && state.translation===transKey) renderReader();
        });
      }
    }

    let html='';
    for(let a=1; a<=s.ayahs; a++){
      const data = cached.ayahs[a] || SEED[state.currentSurah+':'+a];
      if(!data) continue; // shouldn't happen once cached, but guards against gaps
      const isBm = state.bookmarks.has(state.currentSurah+':'+a);
      const tr = (transMap && transMap[a]) ? transMap[a] : data.tr;
      html += ayahCardHTML(state.currentSurah, a, {...data, tr}, isBm);
    }
    list.innerHTML = html || loadingBlockHTML();
  }

  // Prev/next surah nav labels
  const prevS = getSurah(state.currentSurah-1);
  const nextS = getSurah(state.currentSurah+1);
  $('#prevSurahLbl').textContent = prevS ? prevS.en : 'Start of Qur\'an';
  $('#nextSurahLbl').textContent = nextS ? nextS.en : 'End of Qur\'an';
  $('#prevSurahBtn').style.opacity = prevS ? 1 : .45;
  $('#nextSurahBtn').style.opacity = nextS ? 1 : .45;
  initNotesAutoLoad();
  if(playingAyah) highlightPlayingAyah(state.currentSurah, playingAyah); // survive re-renders mid-playback
  activeReadAyah = null;
  computeActiveReadAyah();
}

// Reading-position tracking: as the user scrolls through a surah, the
// ayah whose midpoint is nearest the vertical center of the viewport
// becomes the "active" one — a subtle border glow (see
// .ayah-card.active-read), and after a short settle it's saved as the
// real Continue Reading position and counts toward today's reading
// streak.
//
// This deliberately measures directly (getBoundingClientRect on every
// scroll tick, rAF-throttled) rather than using IntersectionObserver.
// A narrow-band IntersectionObserver only fires when an element's edge
// crosses the band boundary between two browser-computed frames — with
// fast or discrete scrolling (mouse-wheel ticks, arrow keys, a finger
// flick), a short ayah card can move from below the band to above it
// without ever registering as "intersecting", so the highlight skips
// it entirely. Directly measuring the closest card on every tick always
// finds the true nearest ayah regardless of how the scroll happened.
let activeReadAyah = null;
let activeReadSaveTimer = null;
let activeReadTicking = false;

function computeActiveReadAyah(){
  const list = document.getElementById('ayahList');
  if(!list) return;
  const cards = list.querySelectorAll('.ayah-card');
  if(!cards.length) return;
  const centerY = window.innerHeight/2;
  let best = null, bestDist = Infinity;
  cards.forEach(card=>{
    const rect = card.getBoundingClientRect();
    if(rect.bottom < -200 || rect.top > window.innerHeight+200) return; // cheap reject, well off-screen
    const mid = rect.top + rect.height/2;
    const dist = Math.abs(mid - centerY);
    if(dist < bestDist){ bestDist = dist; best = card; }
  });
  if(best) setActiveReadAyah(parseInt(best.dataset.surah,10), parseInt(best.dataset.ayah,10));
}

function onActiveReadScroll(){
  if(activeReadTicking) return;
  activeReadTicking = true;
  requestAnimationFrame(()=>{
    activeReadTicking = false;
    const page = document.getElementById('page-quran');
    if(!page || page.classList.contains('hidden')) return;
    computeActiveReadAyah();
  });
}
window.addEventListener('scroll', onActiveReadScroll, {passive:true});

function setActiveReadAyah(surah, ayah){
  if(ayah===activeReadAyah) return;
  activeReadAyah = ayah;

  $$('.ayah-card.active-read').forEach(el=> el.classList.remove('active-read'));
  const card = document.getElementById(`ayah-${surah}-${ayah}`);
  if(card) card.classList.add('active-read');

  state.currentAyah = ayah;
  clearTimeout(activeReadSaveTimer);
  activeReadSaveTimer = setTimeout(()=>{
    Services.logHistory(surah, ayah);
    Services.saveLastRead(surah, ayah);
    Services.markReadToday();
    Services.persist();
    renderContinueCard();
    renderProgressRing();
    renderStreak();
  }, 900);
}

function renderProgressRing(){
  const s = getSurah(state.currentSurah);
  const pct = Math.round((state.currentAyah/s.ayahs)*100);
  const r=33, c=2*Math.PI*r;
  const fg = $('#ringFg');
  fg.setAttribute('stroke-dasharray', c.toFixed(1));
  fg.setAttribute('stroke-dashoffset', (c*(1-pct/100)).toFixed(1));
  $('#ringPctLbl').textContent = pct+'%';
}

function renderStreak(){
  $('#streakNum').textContent = state.streak.days;
  const freezeNote = $('#streakFreezeNote');
  if(freezeNote){
    freezeNote.textContent = Services.streakFreezeStatus()==='available' ? '❄️ freeze available' : '❄️ freeze used this month';
  }
  const days = ['M','T','W','T','F','S','S'];
  const row = $('#weekRow');
  row.innerHTML='';
  days.forEach((d,i)=>{
    const done = state.streak.week[i];
    const isToday = i===state.todayIdx;
    row.innerHTML += `<div class="week-day"><span>${d}</span><div class="day-dot ${done?'done':''} ${isToday && !done?'today':''}">${done?'✓':''}</div></div>`;
  });
  submitQuranStreak(state.streak.days);
  loadQuranPokePanel();
}

// Debounced, fire-and-forget — mirrors the Journal leaderboard-score
// submission pattern. Only signed-in users have a row here at all.
let quranStreakSubmitTimer = null;
function submitQuranStreak(days){
  clearTimeout(quranStreakSubmitTimer);
  quranStreakSubmitTimer = setTimeout(async ()=>{
    try{
      await fetch('/api/quran-streak', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials: 'include',
        body: JSON.stringify({ streakDays: days })
      });
    }catch(e){ /* silent — nice-to-have, not critical */ }
  }, 1500);
}

// Friends' Qur'an reading streaks + poke panel. Self-contained here
// (not sharing helpers with the auth/friends IIFE — top-level consts
// there are invisible from this script) — keeps its own tiny renderer.
let pokePanelLastLoad = 0;
function escapeHtmlQ(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadQuranPokePanel(force){
  if(!force && Date.now()-pokePanelLastLoad<30000) return;
  pokePanelLastLoad = Date.now();
  const msgEl = $('#pokePanelMsg');
  const listEl = $('#pokeFriendsList');
  if(!msgEl || !listEl) return;
  try{
    const res = await fetch('/api/quran-streak', {
      credentials:'include',
      headers:{ 'X-Device-Id': window.WWP?.deviceId || '' }
    });
    if(res.status===401){
      msgEl.style.display='block';
      msgEl.innerHTML = 'Sign in to see friends\' streaks.';
      listEl.innerHTML='';
      return;
    }
    if(!res.ok){
      console.warn('loadQuranPokePanel: request failed', res.status, await res.text().catch(()=>''));
      msgEl.style.display='block';
      msgEl.textContent = 'Couldn\'t load friends\' streaks — try again shortly.';
      listEl.innerHTML='';
      return;
    }
    const data = await res.json();
    listEl.innerHTML='';
    if(!data.entries || !data.entries.length){
      msgEl.style.display='block';
      msgEl.textContent = 'Add friends to see their streaks here.';
      return;
    }
    msgEl.style.display='none';
    data.entries.forEach(entry=>{
      const item = document.createElement('div');
      item.className='poke-friend-item';
      item.innerHTML = `
        <span class="poke-friend-name">${escapeHtmlQ(entry.username)} <span class="poke-friend-streak">${entry.streakDays}d</span></span>
        <button class="poke-btn" ${entry.pokedToday?'disabled':''} data-friend="${entry.userId}">
          ${entry.pokedToday ? 'Poked ✓' : 'Poke'}
        </button>`;
      const btn = item.querySelector('.poke-btn');
      btn.addEventListener('click', ()=> sendQuranPoke(entry.userId, btn));
      listEl.appendChild(item);
    });
  }catch(e){
    console.warn('loadQuranPokePanel failed', e);
    msgEl.style.display='block';
    msgEl.textContent = 'Couldn\'t load friends\' streaks — try again shortly.';
    listEl.innerHTML='';
  }
}
async function sendQuranPoke(friendUserId, btn){
  btn.disabled = true;
  const original = btn.textContent;
  try{
    const res = await fetch('/api/push/poke', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
      credentials:'include',
      body: JSON.stringify({ friendUserId })
    });
    const data = await res.json();
    if(res.ok && data.success){
      btn.textContent = 'Poked ✓';
      showToast(data.delivered ? 'Poke sent!' : 'Poked — they haven\'t enabled notifications');
    } else if(res.status===409){
      btn.textContent = 'Poked ✓';
      showToast('Already poked them today');
    } else {
      btn.textContent = original;
      btn.disabled = false;
      showToast('Could not send poke');
    }
  }catch(e){
    btn.textContent = original;
    btn.disabled = false;
    showToast('Could not send poke');
  }
}

function renderPlan(){
  $('#planGoalVal').textContent = `${state.dailyGoal.amount} ${state.dailyGoal.unit.replace('(s)','')}${state.dailyGoal.amount>1?'s':''} a day`;
  const pct = Math.min(100, Math.round((state.todayProgress/state.dailyGoal.amount)*100));
  $('#planBarFill').style.width = pct+'%';
  $('#planCaption').textContent = `${state.todayProgress} / ${state.dailyGoal.amount} ${state.dailyGoal.unit.replace('(s)','')}${state.dailyGoal.amount>1?'s':''} today`;
}

function renderContinueCard(){
  const s = getSurah(state.lastRead.surah);
  $('#continueSurah').textContent = s.en;
  $('#continueLoc').textContent = `Page ~${approxPage(state.lastRead.surah,state.lastRead.ayah)} · Ayah ${state.lastRead.ayah}`;
  const mins = Math.round((Date.now()-state.lastRead.ts)/60000);
  $('#continueTime').textContent = mins<1 ? 'Last read just now' : `Last read ${mins}m ago`;
}

// Physical copy bookmark: a single, optional, manually-updated marker for
// where the person is in their own paper mushaf. Deliberately separate
// from the app's Bookmarks (multi-save) and Last Read (auto-tracked) —
// and never touches the reading streak.
function populatePhysicalBmSurahSelect(){
  const sel = $('#physicalBmSurah');
  if(!sel || sel.options.length) return; // populate once
  sel.innerHTML = SURAHS.map(s=>`<option value="${s.num}">${s.num}. ${s.en}</option>`).join('');
}

function renderPhysicalBookmark(){
  const loc = $('#physicalBmLoc');
  if(!loc) return;
  const pb = state.physicalBookmark;
  if(pb){
    const s = getSurah(pb.surah);
    loc.textContent = s ? `${s.en}, Ayah ${pb.ayah}` : 'Not set';
  } else {
    loc.textContent = 'Not set';
  }
}

function renderProgressStats(){
  $('#statJuz').textContent = `${state.progress.juzDone}/30`;
  $('#statPages').textContent = `${state.progress.pagesRead}/604`;
  $('#statAyat').textContent = state.progress.ayatRead.toLocaleString();
  $('#statTime').textContent = state.progress.timeSpent;
}

// Estimated Completion card (audio-tools pane): projects a finish date
// from the person's daily reading goal and current progress, converting
// whatever unit/frequency they picked into an average pages-per-day pace.
const QURAN_TOTAL_PAGES = 604;
const QURAN_TOTAL_AYAHS = 6236;
const QURAN_TOTAL_SURAHS = 114;
function renderEstimatedCompletion(){
  const dateEl = $('#estDate'), subEl = $('#estSub');
  if(!dateEl || !subEl) return;
  const pagesRemaining = QURAN_TOTAL_PAGES - state.progress.pagesRead;
  if(pagesRemaining<=0){
    dateEl.textContent = "Complete!";
    subEl.textContent = "You've finished the whole Qur'an";
    return;
  }
  const goal = state.dailyGoal;
  let pagesPerOccurrence;
  if(goal.unit==='page(s)') pagesPerOccurrence = goal.amount;
  else if(goal.unit==='ayah(s)') pagesPerOccurrence = goal.amount * (QURAN_TOTAL_PAGES/QURAN_TOTAL_AYAHS);
  else pagesPerOccurrence = goal.amount * (QURAN_TOTAL_PAGES/QURAN_TOTAL_SURAHS); // surah(s)

  const occurrencesPerWeek = goal.freq==='Weekdays only' ? 5 : goal.freq==='Weekly' ? 1 : 7;
  const pagesPerDay = (pagesPerOccurrence * occurrencesPerWeek) / 7;

  if(!pagesPerDay || pagesPerDay<=0){
    dateEl.textContent = "—";
    subEl.textContent = "Set a reading plan to see this";
    return;
  }
  const daysLeft = Math.max(1, Math.ceil(pagesRemaining / pagesPerDay));
  const completion = new Date();
  completion.setDate(completion.getDate() + daysLeft);
  dateEl.textContent = completion.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  subEl.textContent = `${daysLeft} day${daysLeft===1?'':'s'} left`;
}

function renderAll(){
  renderSidebarContent();
  renderReaderHeader();
  renderReader();
  renderProgressRing();
  renderStreak();
  renderPlan();
  renderContinueCard();
  renderPhysicalBookmark();
  renderProgressStats();
  renderSidebarCurrentToggle();
  renderEstimatedCompletion();
  if($('#bookmarksPopover').classList.contains('open')) renderBookmarksPopover();
}

// Mobile-only compact "currently reading" row shown while the surah
// list is collapsed (see .sidebar-current-toggle CSS, scoped to
// max-width:760px). Content adapts to whichever tab is active.
// Harmless no-op visually on larger screens.
function renderSidebarCurrentToggle(){
  const s = getSurah(state.currentSurah);
  if(!s) return;
  if(state.sidebarTab==='juz'){
    const j = getJuz(state.currentSurah, state.currentAyah);
    $('#sctNum').textContent = j;
    $('#sctLabel').textContent = 'Currently in';
    $('#sctName').textContent = `Juz ${j}`;
  } else if(state.sidebarTab==='bookmarks'){
    const count = state.bookmarks.size;
    $('#sctNum').textContent = count;
    $('#sctLabel').textContent = 'Bookmarks saved';
    $('#sctName').textContent = count===1 ? '1 ayah bookmarked' : `${count} ayahs bookmarked`;
  } else {
    $('#sctNum').textContent = s.num;
    $('#sctLabel').textContent = 'Currently reading';
    $('#sctName').textContent = s.en;
  }
}

/* ============================================================
   Actions
   ============================================================ */
function scrollToAyahCard(surah, ayah){
  const card = document.getElementById(`ayah-${surah}-${ayah}`);
  if(!card) return false;
  card.scrollIntoView({behavior:'smooth', block:'center'});
  // Brief flash so it's obvious which ayah was jumped to, distinct from
  // the persistent highlight used during audio playback.
  card.classList.add('jump-highlight');
  setTimeout(()=> card.classList.remove('jump-highlight'), 1800);
  return true;
}

function ensureSurahLoaded(num, scrollToAyah){
  loadSurahData(num).then(()=>{
    // Only re-render if the user hasn't navigated away from this surah
    // while the fetch was in flight.
    if(state.currentSurah===num){
      renderReader();
      if(scrollToAyah) scrollToAyahCard(num, scrollToAyah);
    }
  });
}

function selectSurah(num, ayah){
  state.currentSurah = num;
  state.currentAyah = ayah || 1;
  Services.logHistory(num, state.currentAyah);
  Services.saveLastRead(num, state.currentAyah);
  Services.markReadToday();
  Services.persist();
  renderAll();
  ensureSurahLoaded(num, state.currentAyah);
  updateAudioForSurah();
  // Mobile: once a surah is picked, collapse the list back down to the
  // compact "currently reading" row (no-op on desktop).
  $('#sidebar')?.classList.remove('expanded');
  // Jump straight to the exact ayah (e.g. from a bookmark) rather than
  // always landing at the top of the surah. If the surah's content
  // hasn't loaded yet, ensureSurahLoaded's callback above will scroll
  // to it the moment it's rendered — meanwhile just get the reader
  // pane into view so the loading state is visible.
  if(!scrollToAyahCard(num, state.currentAyah)){
    $('.reader-pane') && $('.reader-pane').scrollIntoView({behavior:'smooth', block:'start'});
  }
}

/* ============================================================
   Surah audio player — per-ayah recitation from everyayah.com (free,
   no key, CORS-open, one MP3 per ayah: SSSAAA.mp3). Using per-ayah
   files instead of one continuous surah file lets us know exactly
   which ayah is playing at any moment — no timestamp/segment data
   needed — so the currently-recited ayah can be highlighted and
   auto-scrolled into view as playback moves through the surah.
   Default reciter is Mishary Rashid Alafasy. Avatars are initials,
   not real photos — we don't have licensed photos of the reciters.
   ============================================================ */
const RECITERS = [
  {code:'Alafasy_128kbps', name:'Mishary Rashid Alafasy', initials:'MA'},
  {code:'Husary_128kbps', name:'Mahmoud Al-Husary', initials:'MH'},
  {code:'Abdul_Basit_Murattal_192kbps', name:'Abdul Basit (Murattal)', initials:'AB'},
  {code:'Minshawy_Murattal_128kbps', name:'Mohamed Al-Minshawi', initials:'MM'},
];
// Two independent mirrors hosting the same per-ayah file structure —
// if the primary is unreachable (hotlink protection, transient CDN
// issues, a browser-specific block), the player automatically retries
// on the second before giving up.
const AUDIO_MIRRORS = [
  'https://everyayah.com/data',
  'https://www.versebyversequran.com/data',
];
let currentReciter = RECITERS[0].code;
let playingAyah = null;   // ayah number currently loaded/playing, or null when stopped
let audioReady = false;   // true once #surahAudio.src matches playingAyah (avoids reload-on-resume)
let audioMirrorIndex = 0; // which AUDIO_MIRRORS entry is currently in use
let audioWantsPlay = false; // remembers autoplay intent across a mirror fallback retry

function ayahAudioSrc(surahNum, ayahNum, reciter, mirrorIndex){
  const s = String(surahNum).padStart(3,'0');
  const a = String(ayahNum).padStart(3,'0');
  return `${AUDIO_MIRRORS[mirrorIndex]}/${reciter}/${s}${a}.mp3`;
}
function formatAudioTime(sec){
  if(!isFinite(sec) || sec<0) sec = 0;
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
// Highlights the ayah currently being recited and scrolls it gently
// into view; clears the highlight entirely when ayah is null.
function highlightPlayingAyah(surah, ayah){
  $$('#ayahList .ayah-card.playing').forEach(el=> el.classList.remove('playing'));
  if(ayah==null) return;
  const card = $(`#ayah-${surah}-${ayah}`);
  if(!card) return;
  card.classList.add('playing');
  card.scrollIntoView({behavior:'smooth', block:'center'});
}
function updateAyahAudioLabel(){
  const label = $('#audioAyahLabel');
  if(!label) return;
  label.textContent = playingAyah ? `Ayah ${playingAyah} of ${getSurah(state.currentSurah).ayahs}` : 'Ready to play';
}
// Loads and (optionally) plays a specific ayah's clip. Always starts
// from the first mirror; the audio element's own 'error' event (wired
// in init()) handles falling back to the next mirror automatically.
function loadAndPlayAyah(surah, ayah, autoplay){
  const audio = $('#surahAudio');
  playingAyah = ayah;
  audioMirrorIndex = 0;
  audioWantsPlay = !!autoplay;
  audio.src = ayahAudioSrc(surah, ayah, currentReciter, audioMirrorIndex);
  audioReady = true;
  updateAyahAudioLabel();
  highlightPlayingAyah(surah, ayah);
  if(autoplay) audio.play().catch(()=> showToast("Couldn't play audio — check your connection"));
}
// Called whenever the current surah changes: stop playback, clear the
// highlight, and reset the transport UI. Does not autoplay.
function updateAudioForSurah(){
  const audio = $('#surahAudio');
  if(!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audioReady = false;
  playingAyah = null;
  setAudioPlayingUI(false);
  updateAyahAudioLabel();
  highlightPlayingAyah(state.currentSurah, null);
  $('#audioSeek').value = 0;
  $('#audioCurTime').textContent = '00:00';
  $('#audioDurTime').textContent = '00:00';
}
// Renders the reciter dropdown options and the current-selection button.
function renderReciterPicker(){
  const dd = $('#reciterDropdown');
  if(!dd) return;
  dd.innerHTML = RECITERS.map(r=>`
    <button class="reciter-option${r.code===currentReciter?' active':''}" data-reciter="${r.code}" type="button">
      <span class="reciter-avatar">${r.initials}</span>${r.name}
    </button>`).join('');
  $$('.reciter-option', dd).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      setReciter(btn.dataset.reciter);
      $('#reciterPicker').classList.remove('open');
    });
  });
  const cur = RECITERS.find(r=>r.code===currentReciter);
  $('#reciterCurrentAvatar').textContent = cur.initials;
  $('#reciterCurrentName').textContent = cur.name;
}
// Switches reciter, keeping the current ayah position and play state.
function setReciter(code){
  const audio = $('#surahAudio');
  const wasPlaying = !audio.paused;
  currentReciter = code;
  if(playingAyah){
    loadAndPlayAyah(state.currentSurah, playingAyah, wasPlaying);
  }
  renderReciterPicker();
  showToast(`Reciter set to ${RECITERS.find(r=>r.code===code).name}`);
}
function setAudioPlayingUI(isPlaying){
  const icon = $('#audioPlayIcon');
  const btn = $('#audioPlayBtn');
  if(!icon || !btn) return;
  btn.title = isPlaying ? 'Pause' : 'Play';
  icon.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

function goPrevSurah(){
  const prevS = getSurah(state.currentSurah-1);
  if(prevS) selectSurah(prevS.num, 1);
}
function goNextSurah(){
  const nextS = getSurah(state.currentSurah+1);
  if(nextS) selectSurah(nextS.num, 1);
}
function scrollToTop(){
  $('.reader-pane') && $('.reader-pane').scrollIntoView({behavior:'smooth', block:'start'});
}

function toggleAyahBookmark(surah, ayah){
  const isNowBm = Services.toggleBookmark(surah, ayah);
  showToast(isNowBm ? 'Ayah bookmarked' : 'Bookmark removed');
  Services.persist();
  const btn = $(`#ayah-${surah}-${ayah} [data-action="bookmark"]`);
  if(btn) btn.classList.toggle('bookmarked', isNowBm);
  if(state.sidebarTab==='bookmarks') renderSidebarContent();
  renderSidebarCurrentToggle();
  if($('#bookmarksPopover').classList.contains('open')) renderBookmarksPopover();
}

function copyAyah(surah, ayah){
  const s = getSurah(surah);
  const data = Services.fetchAyahText(surah, ayah);
  const transMap = TRANSLATION_EDITIONS[state.translation] ? translationCache[state.translation+':'+surah] : null;
  const tr = (transMap && transMap[ayah]) ? transMap[ayah] : (data ? data.tr : null);
  const text = data
    ? `${data.ar}\n${tr}\n— ${s.en} ${ayah}`
    : `${s.en} ${ayah} — WhereWePraying?`;
  navigator.clipboard?.writeText(text).then(()=>showToast('Copied to clipboard'))
    .catch(()=>showToast('Could not copy — try selecting the text manually'));
}

function shareAyah(surah, ayah){
  const s = getSurah(surah);
  const text = `${s.en} ${ayah} — read on WhereWePraying?`;
  if(navigator.share){
    navigator.share({title:'WhereWePraying? — Qur\'an', text}).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others'))
      .catch(()=>showToast('Sharing is not available on this device'));
  }
}

// Fetches and renders the tafsir into a given note-wrap element. Shared
// by the manual toggle click and the auto-load IntersectionObserver
// (see initNotesAutoLoad) so both paths render identically.
async function loadNoteInto(wrap, surah, ayah){
  if(wrap.dataset.loaded) return;

  wrap.innerHTML = `<div class="ayah-note-inner">
    <div class="ayah-note-loading">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>
      Loading explanation…
    </div>
  </div>`;

  const paragraphs = await loadTafsir(surah, ayah);
  // Bail out quietly if this note panel was closed or removed while the
  // fetch was in flight (surah scroll, next-surah, toggled off, etc.).
  if(!document.body.contains(wrap) || !wrap.classList.contains('open')) return;

  if(paragraphs === null){
    const cacheKey = surah+':'+ayah;
    const detail = tafsirLastError[cacheKey] || '';
    const fileHint = location.protocol==='file:'
      ? `<div class="ayah-note-src" style="margin-top:8px;">This page is open as a local file — some browsers block this kind of request unless the site is hosted on a real web server (e.g. Cloudflare Pages) or a local dev server.</div>`
      : '';
    wrap.innerHTML = `<div class="ayah-note-inner">
      Couldn't load the explanatory note — check your connection.
      <button class="mini-btn" data-action="retry-note" style="margin-left:8px;width:auto;padding:0 10px;">Retry</button>
      ${detail ? `<div class="ayah-note-src" style="margin-top:8px;">Details: ${detail}</div>` : ''}
      ${fileHint}
    </div>`;
    $('[data-action="retry-note"]', wrap)?.addEventListener('click', ()=>{
      delete tafsirCache[cacheKey];
      delete tafsirLoadPromises[cacheKey];
      delete tafsirLastError[cacheKey];
      wrap.dataset.loaded = '';
      loadNoteInto(wrap, surah, ayah);
    });
    return;
  }
  if(paragraphs.length===0){
    wrap.innerHTML = `<div class="ayah-note-inner">No explanatory note available for this ayah yet.</div>`;
    wrap.dataset.loaded = '1';
    return;
  }
  wrap.innerHTML = `<div class="ayah-note-inner">
    <div class="ayah-note-label">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
      Explanatory note
    </div>
    <div class="ayah-note-body">${paragraphs.map(p=>`<p>${p}</p>`).join('')}</div>
    <div class="ayah-note-src">Source: Tafsir Ibn Kathir (abridged)</div>
  </div>`;
  wrap.dataset.loaded = '1';
}

// Toggles the explanatory-note panel for one ayah open/closed, fetching
// the tafsir on first open only (subsequent toggles just show/hide it).
function toggleAyahNote(surah, ayah, btn){
  const wrap = $(`#note-${surah}-${ayah}`);
  if(!wrap) return;
  const willOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', willOpen);
  btn.classList.toggle('active-state', willOpen);
  if(willOpen) loadNoteInto(wrap, surah, ayah);
}

// Auto-loads notes for every open-by-default panel as it scrolls into
// view (Explanatory Notes toggle) — one fetch per ayah, only when the
// person actually reaches it, rather than firing every request in a
// long surah at once. Called after every reader re-render.
let notesObserver = null;
function initNotesAutoLoad(){
  if(notesObserver){ notesObserver.disconnect(); notesObserver = null; }
  if(!state.showNotes) return;
  const list = $('#ayahList');
  if(!list) return;
  notesObserver = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const wrap = entry.target;
      if(!entry.isIntersecting) return;
      notesObserver.unobserve(wrap);
      if(wrap.dataset.loaded) return;
      const card = wrap.closest('.ayah-card');
      if(!card) return;
      loadNoteInto(wrap, +card.dataset.surah, +card.dataset.ayah);
    });
  }, {rootMargin:'500px 0px', threshold:0.01});
  $$('.ayah-note.open', list).forEach(wrap=>{
    if(!wrap.dataset.loaded) notesObserver.observe(wrap);
  });
}

function shareSurah(){
  const s = getSurah(state.currentSurah);
  const text = `${s.en} (${s.meaning}) — read on WhereWePraying?`;
  if(navigator.share){
    navigator.share({title:'WhereWePraying? — Qur\'an', text}).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others'))
      .catch(()=>showToast('Sharing is not available on this device'));
  }
}

function setTheme(mode){
  state.theme = mode;
  document.body.setAttribute('data-theme', mode);
  $$('#modePills button').forEach(b=> b.classList.toggle('active', b.dataset.mode===mode));
}

function setFontSize(delta){
  state.arabicSize = Math.max(22, Math.min(44, state.arabicSize + delta));
  state.transSize = Math.max(12, Math.min(20, state.transSize + Math.round(delta*0.35)));
  document.documentElement.style.setProperty('--arabic-size', state.arabicSize+'px');
  document.documentElement.style.setProperty('--trans-size', state.transSize+'px');
  $('#fsVal').textContent = Math.round((state.arabicSize/30)*100)+'%';
}

/* ============================================================
   PAGE :: wire up events + init
   ============================================================ */
async function init(){
  document.documentElement.style.setProperty('--arabic-size', state.arabicSize+'px');
  document.documentElement.style.setProperty('--trans-size', state.transSize+'px');
  document.documentElement.style.setProperty('--arabic-font', state.arabicFont);

  // ==> CONNECT (resolved): load this device's saved reading position,
  // bookmarks and streak before the first render.
  await Services.loadFromBackend();

  Services.logHistory(state.currentSurah, state.currentAyah);
  populatePhysicalBmSurahSelect();
  renderAll();
  // Do not fetch Qur'an text while the Qur'an page is hidden. If the
  // user opened Qur'an directly, load the current surah after the shell
  // has painted; otherwise the first fetch waits until that page is opened.
  const quranPage = document.getElementById('page-quran');
  if(quranPage && !quranPage.classList.contains('hidden')){
    setTimeout(()=>ensureSurahLoaded(state.currentSurah), 0);
  }
  document.addEventListener('wwp-page-shown', function(e){
    if(e.detail && e.detail.id === 'quran') ensureSurahLoaded(state.currentSurah);
  }, {once:true});

  // Sidebar tabs (Surah / Juz / Bookmarks) — tapping the active tab
  // toggles the list open/closed; tapping a different tab switches
  // to it and expands the list.
  $$('#sidebarTabs .sidebar-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      const wasActive = state.sidebarTab === tab.dataset.tab;
      state.sidebarTab = tab.dataset.tab;
      $$('#sidebarTabs .sidebar-tab').forEach(t=> t.classList.toggle('active', t===tab));
      renderSidebarContent();
      renderSidebarCurrentToggle();
      if(wasActive) $('#sidebar').classList.toggle('expanded');
      else $('#sidebar').classList.add('expanded');
    });
  });

  // Mobile-only: tapping the compact "currently reading" row expands
  // the full list; no effect on desktop where it's never shown.
  $('#sidebarCurrentToggle').addEventListener('click', ()=>{
    $('#sidebar').classList.toggle('expanded');
  });

  // Sidebar search — collapsed behind the search icon until tapped
  $('#sidebarSearchToggle').addEventListener('click', ()=>{
    const box = $('#sidebarSearch');
    const willOpen = !box.classList.contains('open');
    box.classList.toggle('open', willOpen);
    if(willOpen){ $('#globalSearch').focus(); $('#sidebar').classList.add('expanded'); }
    else { $('#globalSearch').value=''; renderSurahList(''); }
  });
  $('#globalSearch').addEventListener('input', e=>{
    if(state.sidebarTab!=='surah'){
      state.sidebarTab='surah';
      $$('#sidebarTabs .sidebar-tab').forEach(t=> t.classList.toggle('active', t.dataset.tab==='surah'));
    }
    renderSurahList(e.target.value);
  });

  // Surah header actions
  $('#toolbarToggle').addEventListener('click', function(){
    $('#readerToolbar').classList.toggle('closed');
    this.classList.toggle('active-state', !$('#readerToolbar').classList.contains('closed'));
  });
  $('#bookmarkBtn').addEventListener('click', ()=>{
    const pop = $('#bookmarksPopover');
    const willOpen = !pop.classList.contains('open');
    if(willOpen) renderBookmarksPopover();
    pop.classList.toggle('open', willOpen);
  });
  document.addEventListener('click', e=>{
    const pop = $('#bookmarksPopover');
    if(pop.classList.contains('open') && !pop.contains(e.target) && e.target!==$('#bookmarkBtn') && !$('#bookmarkBtn').contains(e.target)){
      pop.classList.remove('open');
    }
  });
  $('#shareBtn').addEventListener('click', shareSurah);

  // ---------- Audio player ----------
  const audioEl = $('#surahAudio');
  renderReciterPicker();
  updateAudioForSurah(); // set initial src for whatever surah loads first

  $('#reciterCurrentBtn').addEventListener('click', function(e){
    e.stopPropagation();
    const picker = $('#reciterPicker');
    const willOpen = !picker.classList.contains('open');
    picker.classList.toggle('open', willOpen);
    this.setAttribute('aria-expanded', willOpen);
  });
  document.addEventListener('click', e=>{
    const picker = $('#reciterPicker');
    if(picker.classList.contains('open') && !picker.contains(e.target)){
      picker.classList.remove('open');
      $('#reciterCurrentBtn').setAttribute('aria-expanded', 'false');
    }
  });

  // If the current mirror fails to load this ayah's clip (hotlink
  // protection, a transient CDN issue, a browser-specific block),
  // automatically retry on the next mirror before surfacing an error.
  audioEl.addEventListener('error', ()=>{
    if(!playingAyah) return; // no real source was ever set — ignore
    if(audioMirrorIndex < AUDIO_MIRRORS.length - 1){
      audioMirrorIndex += 1;
      audioEl.src = ayahAudioSrc(state.currentSurah, playingAyah, currentReciter, audioMirrorIndex);
      if(audioWantsPlay) audioEl.play().catch(()=>{});
    } else {
      showToast("Couldn't load this reciter's audio — check your connection");
    }
  });

  $('#audioPlayBtn').addEventListener('click', ()=>{
    if(!audioEl.paused){ audioEl.pause(); return; }
    if(audioReady && playingAyah){
      audioEl.play().catch(()=> showToast("Couldn't play audio — check your connection"));
    } else {
      loadAndPlayAyah(state.currentSurah, playingAyah || state.currentAyah || 1, true);
    }
  });
  audioEl.addEventListener('play', ()=> setAudioPlayingUI(true));
  audioEl.addEventListener('pause', ()=> setAudioPlayingUI(false));
  audioEl.addEventListener('ended', ()=>{
    const s = getSurah(state.currentSurah);
    if(playingAyah && playingAyah < s.ayahs){
      loadAndPlayAyah(state.currentSurah, playingAyah+1, true); // read-along: auto-advance
    } else {
      setAudioPlayingUI(false);
      audioReady = false;
      playingAyah = null;
      updateAyahAudioLabel();
      highlightPlayingAyah(state.currentSurah, null);
    }
  });
  audioEl.addEventListener('loadedmetadata', ()=>{
    $('#audioDurTime').textContent = formatAudioTime(audioEl.duration);
  });
  audioEl.addEventListener('timeupdate', ()=>{
    $('#audioCurTime').textContent = formatAudioTime(audioEl.currentTime);
    if(audioEl.duration){
      $('#audioSeek').value = (audioEl.currentTime/audioEl.duration)*100;
    }
  });
  $('#audioSeek').addEventListener('input', ()=>{
    if(audioEl.duration){
      audioEl.currentTime = (Number($('#audioSeek').value)/100)*audioEl.duration;
    }
  });
  $('#audioRestart').addEventListener('click', ()=>{
    if(playingAyah) audioEl.currentTime = 0;
  });
  $('#audioPrevAyah').addEventListener('click', ()=>{
    const target = Math.max(1, (playingAyah || state.currentAyah || 1) - 1);
    loadAndPlayAyah(state.currentSurah, target, true);
  });
  $('#audioNextAyah').addEventListener('click', ()=>{
    const s = getSurah(state.currentSurah);
    const target = Math.min(s.ayahs, (playingAyah || state.currentAyah || 1) + 1);
    loadAndPlayAyah(state.currentSurah, target, true);
  });
  $('#audioMuteBtn').addEventListener('click', function(){
    audioEl.muted = !audioEl.muted;
    this.classList.toggle('muted', audioEl.muted);
  });

  // ---------- Tools pane ----------
  $('#toolBookmarksPane').addEventListener('click', ()=> $('#bookmarkBtn').click());
  $('#toolTafsir').addEventListener('click', ()=> showToast('Tap the notes icon on any ayah to read its Tafsir Ibn Kathir explanation'));
  $('#toolWbw').addEventListener('click', ()=> showToast('Word by word is coming soon'));
  $('#toolNotes').addEventListener('click', ()=> showToast('Notes are coming soon'));
  $('#toolHighlights').addEventListener('click', ()=> showToast('Highlights are coming soon'));

  // ---------- Explore More (cross-links into Du'a & Guides) ----------
  $('#exploreDua1').addEventListener('click', ()=>{
    if(window.WWP_openDua) window.WWP_openDua('sleep','ayat-al-kursi');
  });
  $('#exploreDua2').addEventListener('click', ()=>{
    if(window.WWP_openDua) window.WWP_openDua('sleep','three-quls');
  });
  $('#exploreGuide1').addEventListener('click', ()=>{
    if(window.WWP_openGuide) window.WWP_openGuide('salah');
  });
  $('#exploreGuide2').addEventListener('click', ()=>{
    if(window.WWP_openGuide) window.WWP_openGuide('wudu');
  });

  // Toolbar (collapsed by default — see #toolbarToggle above)
  $('#arabicFontSelect').addEventListener('change', e=>{
    document.documentElement.style.setProperty('--arabic-font', e.target.value);
  });
  $('#fsMinus').addEventListener('click', ()=> setFontSize(-2));
  $('#fsPlus').addEventListener('click', ()=> setFontSize(2));
  $('#translitSwitch').addEventListener('click', function(){
    state.showTranslit = !state.showTranslit;
    this.classList.toggle('on', state.showTranslit);
    renderReader();
  });
  $('#notesSwitch').addEventListener('click', function(){
    state.showNotes = !state.showNotes;
    this.classList.toggle('on', state.showNotes);
    renderReader();
  });
  $$('#modePills button').forEach(b=> b.addEventListener('click', ()=> setTheme(b.dataset.mode)));
  $('#translationSelect').addEventListener('change', e=>{
    state.translation = e.target.value;
    Services.persist();
    renderReader();
  });

  // Per-ayah actions (bookmark/copy/share) — one delegated listener covers
  // every ayah in the continuously-scrolling surah, however many there are.
  $('#ayahList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const card = e.target.closest('.ayah-card');
    if(!card) return;
    const surah = +card.dataset.surah, ayah = +card.dataset.ayah;
    if(btn.dataset.action==='bookmark') toggleAyahBookmark(surah, ayah);
    else if(btn.dataset.action==='copy') copyAyah(surah, ayah);
    else if(btn.dataset.action==='share') shareAyah(surah, ayah);
    else if(btn.dataset.action==='note') toggleAyahNote(surah, ayah, btn);
  });

  // Surah nav
  $('#prevSurahBtn').addEventListener('click', goPrevSurah);
  $('#nextSurahBtn').addEventListener('click', goNextSurah);
  $('#scrollTopBtn').addEventListener('click', scrollToTop);

  // Footer: plan
  $('#managePlanBtn').addEventListener('click', ()=>{
    $('#planEdit').classList.toggle('open');
    $('#planAmount').value = state.dailyGoal.amount;
  });
  $('#planSaveBtn').addEventListener('click', ()=>{
    const amt = Math.max(1, parseInt($('#planAmount').value)||1);
    state.dailyGoal = {amount:amt, unit:$('#planUnit').value, freq:$('#planFreq').value};
    state.todayProgress = 0;
    $('#planEdit').classList.remove('open');
    Services.persist();
    renderPlan();
    renderEstimatedCompletion();
    showToast('Reading plan updated');
  });

  // Footer: streak
  $('#viewHistoryBtn').addEventListener('click', ()=> showToast(`${state.streak.days}-day streak · full history view coming soon`));

  // Footer: continue
  $('#continueBtn').addEventListener('click', continueReading);

  // Footer: physical copy bookmark — manual, optional, separate from
  // both the app's Bookmarks list and Last Read/streak tracking.
  $('#physicalBmEditBtn').addEventListener('click', ()=>{
    const form = $('#physicalBmForm');
    const willOpen = !form.classList.contains('open');
    if(willOpen){
      const pb = state.physicalBookmark;
      $('#physicalBmSurah').value = pb ? pb.surah : state.currentSurah;
      $('#physicalBmAyah').value = pb ? pb.ayah : '';
    }
    form.classList.toggle('open', willOpen);
  });
  $('#physicalBmSaveBtn').addEventListener('click', ()=>{
    const surah = parseInt($('#physicalBmSurah').value, 10);
    const meta = getSurah(surah);
    let ayah = parseInt($('#physicalBmAyah').value, 10);
    if(!meta){ showToast('Pick a surah first'); return; }
    if(!ayah || ayah<1) ayah = 1;
    if(ayah > meta.ayahs) ayah = meta.ayahs;
    state.physicalBookmark = {surah, ayah, ts:Date.now()};
    $('#physicalBmForm').classList.remove('open');
    Services.persist();
    renderPhysicalBookmark();
    showToast('Physical copy position saved');
  });
}

function continueReading(){
  selectSurah(state.lastRead.surah, state.lastRead.ayah);
  showToast('Resumed where you left off');
}

// Exposed for cross-section navigation — e.g. the homepage's Jummah
// "Read Surah Al-Kahf today" reminder, or any other deep-link into a
// specific surah/ayah from outside this IIFE.
window.WWP_openSurah = function(surahNum, ayahNum){
  selectSurah(surahNum, ayahNum || 1);
};

init();

// Jummah-only: landing on the Qur'an tab (fresh navigation, not a
// specific bookmark/history restore) during Friday's event theme
// opens Surah Al-Kahf automatically, since it's the day's signature
// recommended reading. Only applies once per navigation — flagged by
// the router via window.__WWP_pendingJummahKahf so it doesn't fight
// a user who's mid-way through a different surah and just re-renders.
if(window.__WWP_pendingJummahKahf){
  window.__WWP_pendingJummahKahf = false;
  var __pendingAyah = window.__WWP_pendingJummahKahfAyah || 1;
  window.__WWP_pendingJummahKahfAyah = null;
  selectSurah(18, __pendingAyah);
}

})();


/* ============================================================
   DU'A & DHIKR SECTION
   ============================================================ */
(function(){

/* ============================================================
   UTIL
   ============================================================ */
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
let toastTimer;
function showToast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2600); }

const ICONS = {
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  moonstars:'<path d="M20 12.8A8 8 0 1 1 11.2 4 6.2 6.2 0 0 0 20 12.8Z"/><path d="M19 3v3M17.5 4.5h3"/>',
  mosque:'<path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/><path d="M4 21v-6h4v6M16 21v-6h4v6"/><path d="M4 21h16"/>',
  allah:'<circle cx="12" cy="12" r="8"/><path d="M9 8v8M15 8v5a3 3 0 0 1-3 3"/>',
  bookstand:'<path d="M4 19V6l8-3 8 3v13"/><path d="M12 3v16M4 19h16"/>',
  tasbih:'<circle cx="12" cy="5" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="19" cy="16" r="2"/><circle cx="14" cy="21" r="2"/><circle cx="7" cy="20" r="2"/><circle cx="3" cy="14" r="2"/><circle cx="5" cy="7" r="2"/>',
  people:'<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 21c0-3.5 2.7-6 6-6s6 2.5 6 6M10 21c0-3.5 2.7-6 6-6s6 2.5 6 6"/>',
  clouds:'<path d="M6 17a4 4 0 0 1 .3-8 5 5 0 0 1 9.6-1.6A4.5 4.5 0 0 1 17 17H6Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20"/>',
  star:'<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 7.6 9.4 7Z"/>',
  shield:'<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6Z"/>',
  repeat:'<path d="M17 2l4 4-4 4"/><path d="M3 12v-2a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>'
};
function iconSvg(name, size){ size = size||14; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.star}</svg>`; }

/* ============================================================
   DUA_TILE_IMAGES / DUA_BANNER_IMAGES :: category card artwork
   (illustrated scenes with baked-in title text) for the Du'a &
   Dhikr section. Two sizes are served because the grid tile
   (~1.22:1) and the opened-category banner (~1.62:1) have very
   different box ratios — using one crop for both caused uneven
   zoom/cropping across cards. Tile crops are pre-cropped to the
   grid's own ratio (anchored to keep each image's title text and
   arrow fully in frame) so every tile looks consistently framed;
   banner images use the original wider artwork, which already
   matches that box's ratio closely. Served as static files from
   /assets/dua/ so they cache independently of the page and keep
   index.html lean.
   ============================================================ */
const DUA_TILE_IMAGES = {
  morning: "assets/dua/tile/morning.webp",
  evening: "assets/dua/tile/evening.webp",
  salah: "assets/dua/tile/salah.webp",
  sleep: "assets/dua/tile/sleep.webp",
  praise: "assets/dua/tile/praise.webp",
  qurandua: "assets/dua/tile/qurandua.webp",
  istighfar: "assets/dua/tile/istighfar.webp",
  ummah: "assets/dua/tile/ummah.webp",
  names: "assets/dua/tile/names.webp",
  other: "assets/dua/tile/other.webp"
};
const DUA_BANNER_IMAGES = {
  morning: "assets/dua/banner/morning.webp",
  evening: "assets/dua/banner/evening.webp",
  salah: "assets/dua/banner/salah.webp",
  sleep: "assets/dua/banner/sleep.webp",
  praise: "assets/dua/banner/praise.webp",
  qurandua: "assets/dua/banner/qurandua.webp",
  istighfar: "assets/dua/banner/istighfar.webp",
  ummah: "assets/dua/banner/ummah.webp",
  names: "assets/dua/banner/names.webp",
  other: "assets/dua/banner/other.webp"
};

/* ============================================================
   SCENES :: high-quality vector illustrations, one per category —
   layered gradients, soft glows and fine linework for a premium
   finish while staying crisp at any size (unlike a raster crop).
   Kept as a fallback source for views without dedicated artwork
   (e.g. the "My Favourites" banner).
   ============================================================ */

const SCENES = {
  morning: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="m-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF3D9"/><stop offset=".5" stop-color="#FBCE8F"/><stop offset="1" stop-color="#EE9A5C"/>
      </linearGradient>
      <radialGradient id="m-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#FFF8E6" stop-opacity=".95"/><stop offset="1" stop-color="#FFF8E6" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="m-sun" cx="38%" cy="35%" r="65%">
        <stop offset="0" stop-color="#FFF3CE"/><stop offset="1" stop-color="#F8B65E"/>
      </radialGradient>
      <linearGradient id="m-hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9A465"/><stop offset="1" stop-color="#DD8C4E"/></linearGradient>
      <linearGradient id="m-hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C97142"/><stop offset="1" stop-color="#A85A34"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#m-sky)"/>
    <circle cx="224" cy="66" r="46" fill="url(#m-glow)"/>
    <circle cx="224" cy="66" r="22" fill="url(#m-sun)"/>
    <g stroke="#FCD9A0" stroke-width="1.4" opacity=".55" stroke-linecap="round">
      <path d="M224 26v10"/><path d="M224 96v10"/><path d="M264 66h-10"/><path d="M194 66h-10"/>
      <path d="M252 38l-7 7"/><path d="M203 94l-7 7"/><path d="M252 94l-7-7"/><path d="M203 38l-7-7"/>
    </g>
    <path d="M0 118 Q45 100 90 112 T190 106 T300 100 L300 170 L0 170 Z" fill="url(#m-hill1)" opacity=".9"/>
    <path d="M0 142 Q60 122 130 138 T300 126 L300 170 L0 170 Z" fill="url(#m-hill2)"/>
    <g stroke="#7A3F22" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".55">
      <path d="M40 46 q5 -5 10 0 q5 -5 10 0"/>
      <path d="M76 34 q5 -5 10 0 q5 -5 10 0"/>
      <path d="M108 50 q5 -5 10 0 q5 -5 10 0"/>
    </g>
  </svg>`,

  evening: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="e-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C9BEE6"/><stop offset=".55" stop-color="#8478B8"/><stop offset="1" stop-color="#463B67"/>
      </linearGradient>
      <radialGradient id="e-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#F6EFD8" stop-opacity=".8"/><stop offset="1" stop-color="#F6EFD8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="e-hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8172AC"/><stop offset="1" stop-color="#655594"/></linearGradient>
      <linearGradient id="e-hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C3F71"/><stop offset="1" stop-color="#392E56"/></linearGradient>
      <linearGradient id="e-flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFEBB0"/><stop offset="1" stop-color="#F4B94A"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#e-sky)"/>
    <circle cx="220" cy="34" r="30" fill="url(#e-glow)"/>
    <path d="M212 20a15 15 0 1 0 18-13 11.5 11.5 0 1 1-18 13Z" fill="#FBF3DC"/>
    <g fill="#fff">
      <circle cx="258" cy="24" r="1.5" opacity=".85"/><circle cx="272" cy="46" r="1.1" opacity=".7"/>
      <circle cx="60" cy="30" r="1.2" opacity=".7"/><circle cx="100" cy="18" r="1.4" opacity=".8"/>
      <circle cx="150" cy="14" r="1" opacity=".6"/>
    </g>
    <path d="M0 108 Q60 84 130 104 T300 92 L300 170 L0 170 Z" fill="url(#e-hill1)" opacity=".85"/>
    <path d="M0 138 Q70 116 150 134 T300 122 L300 170 L0 170 Z" fill="url(#e-hill2)"/>
    <g transform="translate(50,84)">
      <line x1="0" y1="-30" x2="0" y2="-20" stroke="#E4C27C" stroke-width="1.6"/>
      <path d="M-4 -20 h8 l3 6 h-14 Z" fill="#D9B25C"/>
      <path d="M-13 -14 L13 -14 L10 22 L-10 22 Z" fill="none" stroke="#E4C27C" stroke-width="1.8"/>
      <path d="M-13 -2 h26 M-13 8 h26" stroke="#E4C27C" stroke-width="1" opacity=".6"/>
      <ellipse cx="0" cy="6" rx="5.5" ry="7" fill="url(#e-flame)" opacity=".92"/>
      <path d="M-10 22 h20 l-3 6 h-14 Z" fill="#D9B25C"/>
    </g>
  </svg>`,

  salah: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="s-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EEF6E4"/><stop offset="1" stop-color="#9BBC8C"/>
      </linearGradient>
      <radialGradient id="s-glow" cx="50%" cy="45%" r="55%">
        <stop offset="0" stop-color="#FFFDF2" stop-opacity=".7"/><stop offset="1" stop-color="#FFFDF2" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="s-dome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C9A6E"/><stop offset="1" stop-color="#516D48"/></linearGradient>
      <linearGradient id="s-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#688861"/><stop offset="1" stop-color="#4C6944"/></linearGradient>
      <linearGradient id="s-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#87A879"/><stop offset="1" stop-color="#6C8C60"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#s-sky)"/>
    <circle cx="150" cy="80" r="70" fill="url(#s-glow)"/>
    <path d="M0 132 Q80 110 160 128 T300 118 L300 170 L0 170 Z" fill="url(#s-hill)" opacity=".8"/>
    <g>
      <path d="M150 62c13 11 20 24 20 40h-40c0-16 7-29 20-40Z" fill="url(#s-dome)"/>
      <circle cx="150" cy="56" r="3" fill="#4C6944"/><line x1="150" y1="48" x2="150" y2="56" stroke="#4C6944" stroke-width="2"/>
      <rect x="112" y="102" width="76" height="46" fill="url(#s-body)"/>
      <path d="M136 148v-24a14 14 0 0 1 28 0v24Z" fill="#3F5A38"/>
      <rect x="102" y="76" width="11" height="72" fill="#5C7A54"/>
      <rect x="187" y="76" width="11" height="72" fill="#5C7A54"/>
      <path d="M102 76 L107.5 60 L113 76Z" fill="#4C6944"/>
      <path d="M187 76 L192.5 60 L198 76Z" fill="#4C6944"/>
      <circle cx="107.5" cy="54" r="2.2" fill="#4C6944"/><circle cx="192.5" cy="54" r="2.2" fill="#4C6944"/>
      <rect x="103" y="92" width="9" height="6" fill="#41593B" opacity=".7"/>
      <rect x="188" y="92" width="9" height="6" fill="#41593B" opacity=".7"/>
      <path d="M122 122a8 8 0 0 1 16 0v10h-16Z" fill="#41593B" opacity=".8"/>
      <path d="M162 122a8 8 0 0 1 16 0v10h-16Z" fill="#41593B" opacity=".8"/>
    </g>
  </svg>`,

  sleep: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="sl-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#31356A"/><stop offset="1" stop-color="#121227"/>
      </linearGradient>
      <linearGradient id="sl-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454A87"/><stop offset="1" stop-color="#2B2F5C"/></linearGradient>
      <radialGradient id="sl-moon-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#F6EFCB" stop-opacity=".65"/><stop offset="1" stop-color="#F6EFCB" stop-opacity="0"/></radialGradient>
      <radialGradient id="sl-lamp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFE9B0" stop-opacity=".9"/><stop offset="1" stop-color="#FFE9B0" stop-opacity="0"/></radialGradient>
      <linearGradient id="sl-bed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#565A93"/><stop offset="1" stop-color="#3E4278"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#sl-sky)"/>
    <g fill="#fff">
      <circle cx="26" cy="20" r="1.3" opacity=".8"/><circle cx="55" cy="38" r="1" opacity=".6"/>
      <circle cx="90" cy="16" r="1.4" opacity=".85"/><circle cx="130" cy="30" r="1" opacity=".6"/>
      <circle cx="170" cy="14" r="1.2" opacity=".7"/>
    </g>
    <rect x="200" y="14" width="80" height="102" rx="6" fill="url(#sl-win)"/>
    <rect x="204" y="18" width="72" height="94" rx="4" fill="#1B1E42"/>
    <line x1="240" y1="18" x2="240" y2="112" stroke="url(#sl-win)" stroke-width="3"/>
    <line x1="204" y1="65" x2="276" y2="65" stroke="url(#sl-win)" stroke-width="3"/>
    <circle cx="255" cy="42" r="16" fill="url(#sl-moon-glow)"/>
    <path d="M248 33a9 9 0 1 0 11-8 7 7 0 1 1-11 8Z" fill="#F3EAC9"/>
    <circle cx="222" cy="86" r="1.5" fill="#fff" opacity=".9"/>
    <circle cx="264" cy="94" r="1" fill="#fff" opacity=".7"/>
    <circle cx="46" cy="96" r="26" fill="url(#sl-lamp)"/>
    <line x1="46" y1="60" x2="46" y2="80" stroke="#8B8FBE" stroke-width="1.6"/>
    <path d="M36 80h20l4 14h-28Z" fill="#6C6FA0"/>
    <rect x="8" y="130" width="164" height="14" rx="5" fill="url(#sl-bed)"/>
    <rect x="12" y="106" width="38" height="26" rx="8" fill="#E7E9F5"/>
    <rect x="8" y="120" width="164" height="28" rx="7" fill="#6468A0"/>
    <path d="M60 122 q40 -8 100 0" stroke="#7B7FB4" stroke-width="1.4" fill="none" opacity=".6"/>
  </svg>`,

  praise: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="p-bg" cx="50%" cy="45%" r="75%">
        <stop offset="0" stop-color="#FBF2DC"/><stop offset="1" stop-color="#D9B87C"/>
      </radialGradient>
      <radialGradient id="p-glow" cx="50%" cy="48%" r="45%">
        <stop offset="0" stop-color="#FFFAEC" stop-opacity=".9"/><stop offset="1" stop-color="#FFFAEC" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="p-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C99A4C"/><stop offset="1" stop-color="#9C7130"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#p-bg)"/>
    <circle cx="150" cy="85" r="58" fill="url(#p-glow)"/>
    <circle cx="150" cy="85" r="50" fill="none" stroke="url(#p-gold)" stroke-width="1.6" opacity=".55"/>
    <circle cx="150" cy="85" r="41" fill="none" stroke="url(#p-gold)" stroke-width="1" opacity=".4"/>
    <g fill="url(#p-gold)" opacity=".65">
      <circle cx="150" cy="35" r="2.4"/><circle cx="150" cy="135" r="2.4"/>
      <circle cx="100" cy="85" r="2.4"/><circle cx="200" cy="85" r="2.4"/>
      <circle cx="115" cy="50" r="1.7"/><circle cx="185" cy="50" r="1.7"/>
      <circle cx="115" cy="120" r="1.7"/><circle cx="185" cy="120" r="1.7"/>
    </g>
    <text x="150" y="100" font-family="Amiri,serif" font-size="40" fill="url(#p-gold)" text-anchor="middle">اللَّه</text>
  </svg>`,

  qurandua: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="q-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#E4F4EF"/><stop offset="1" stop-color="#7FB6AC"/>
      </linearGradient>
      <radialGradient id="q-glow" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="#FBFFFB" stop-opacity=".7"/><stop offset="1" stop-color="#FBFFFB" stop-opacity="0"/></radialGradient>
      <linearGradient id="q-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6FA79C"/><stop offset="1" stop-color="#548C81"/></linearGradient>
      <linearGradient id="q-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A34"/><stop offset="1" stop-color="#6B4426"/></linearGradient>
      <linearGradient id="q-page" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFCF3"/><stop offset="1" stop-color="#F3E9D2"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#q-sky)"/>
    <circle cx="150" cy="60" r="60" fill="url(#q-glow)"/>
    <path d="M0 132 Q90 112 180 130 T300 120 L300 170 L0 170 Z" fill="url(#q-hill)" opacity=".55"/>
    <ellipse cx="150" cy="140" rx="52" ry="6" fill="#345048" opacity=".25"/>
    <g stroke="url(#q-wood)" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M112 132 L150 90 L188 132"/>
      <path d="M98 135 L202 135"/>
    </g>
    <path d="M114 92 q36 -14 72 0 v22 a36 6 0 0 1 -72 0 Z" fill="url(#q-page)" stroke="#C7A968" stroke-width="1.4"/>
    <path d="M150 92 v22" stroke="#C7A968" stroke-width="1.4"/>
    <g stroke="#B79E77" stroke-width="1" opacity=".65">
      <path d="M122 98 q14 -5 26 -1"/><path d="M122 104 q14 -5 26 -1"/>
      <path d="M152 97 q14 -4 26 1"/><path d="M152 103 q14 -4 26 1"/>
    </g>
  </svg>`,

  istighfar: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EEF3E0"/><stop offset="1" stop-color="#A9BE87"/>
      </linearGradient>
      <radialGradient id="i-glow" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="#FBFFF0" stop-opacity=".7"/><stop offset="1" stop-color="#FBFFF0" stop-opacity="0"/></radialGradient>
      <radialGradient id="i-bead" cx="35%" cy="32%" r="70%">
        <stop offset="0" stop-color="#A8C288"/><stop offset=".55" stop-color="#6E8A50"/><stop offset="1" stop-color="#516738"/>
      </radialGradient>
      <radialGradient id="i-imam" cx="35%" cy="32%" r="70%">
        <stop offset="0" stop-color="#8FAE72"/><stop offset=".6" stop-color="#547038"/><stop offset="1" stop-color="#3C5226"/>
      </radialGradient>
    </defs>
    <rect width="300" height="170" fill="url(#i-sky)"/>
    <circle cx="150" cy="85" r="66" fill="url(#i-glow)"/>
    <ellipse cx="150" cy="146" rx="46" ry="6" fill="#41531F" opacity=".18"/>
    <g>
      <circle cx="150" cy="40" r="7.5" fill="url(#i-bead)"/>
      <circle cx="182" cy="49" r="7" fill="url(#i-bead)"/>
      <circle cx="204" cy="76" r="7" fill="url(#i-bead)"/>
      <circle cx="211" cy="108" r="7" fill="url(#i-bead)"/>
      <circle cx="196" cy="136" r="7" fill="url(#i-bead)"/>
      <circle cx="167" cy="152" r="7" fill="url(#i-bead)"/>
      <circle cx="133" cy="152" r="7" fill="url(#i-bead)"/>
      <circle cx="104" cy="136" r="7" fill="url(#i-bead)"/>
      <circle cx="89" cy="108" r="7" fill="url(#i-bead)"/>
      <circle cx="96" cy="76" r="7" fill="url(#i-bead)"/>
      <circle cx="118" cy="49" r="7" fill="url(#i-bead)"/>
      <circle cx="150" cy="40" r="10" fill="url(#i-imam)"/>
    </g>
    <path d="M150 156 q3 12 -2 24" stroke="#6E8A50" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M144 178 q6 5 12 0 q6 5 -0 8" stroke="#8FAE72" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/>
  </svg>`,

  ummah: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="u-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FBEACB"/><stop offset="1" stop-color="#DE9E6D"/>
      </linearGradient>
      <radialGradient id="u-glow" cx="50%" cy="35%" r="60%"><stop offset="0" stop-color="#FFF6E4" stop-opacity=".8"/><stop offset="1" stop-color="#FFF6E4" stop-opacity="0"/></radialGradient>
      <linearGradient id="u-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D2926866"/><stop offset="1" stop-color="#C97B4E"/></linearGradient>
      <linearGradient id="u-fig1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B36A3E"/><stop offset="1" stop-color="#8F5029"/></linearGradient>
      <linearGradient id="u-fig2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C67C4A"/><stop offset="1" stop-color="#9C5C31"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#u-sky)"/>
    <circle cx="150" cy="55" r="70" fill="url(#u-glow)"/>
    <path d="M0 146 Q90 126 180 144 T300 134 L300 170 L0 170 Z" fill="url(#u-hill)" opacity=".55"/>
    <path d="M62 150 V96 a30 30 0 0 1 60 0 v54" fill="none" stroke="#B4795032" stroke-width="10" opacity=".35"/>
    <g fill="url(#u-fig1)">
      <path d="M118 150 v-42 a17 17 0 0 1 34 0 v42 Z"/>
      <circle cx="135" cy="97" r="10"/>
    </g>
    <g fill="url(#u-fig2)">
      <path d="M162 150 v-50 a21 21 0 0 1 42 0 v50 Z"/>
      <circle cx="183" cy="87" r="11"/>
    </g>
    <path d="M126 150 v-18 q9 -8 18 0 v18" fill="none" stroke="#7A431E" stroke-width="1.4" opacity=".5"/>
  </svg>`,

  names: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="n-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F3E7F8"/><stop offset="1" stop-color="#AD91C9"/>
      </linearGradient>
      <radialGradient id="n-glow" cx="50%" cy="45%" r="50%"><stop offset="0" stop-color="#FFF9FF" stop-opacity=".85"/><stop offset="1" stop-color="#FFF9FF" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="300" height="170" fill="url(#n-sky)"/>
    <circle cx="150" cy="80" r="60" fill="url(#n-glow)"/>
    <g fill="#fff" opacity=".5">
      <ellipse cx="60" cy="118" rx="42" ry="15"/>
      <ellipse cx="92" cy="106" rx="28" ry="12"/>
      <ellipse cx="230" cy="52" rx="46" ry="16"/>
      <ellipse cx="258" cy="68" rx="24" ry="10"/>
    </g>
    <g fill="#fff" opacity=".38">
      <ellipse cx="150" cy="140" rx="60" ry="12"/>
    </g>
    <text x="150" y="96" font-family="Amiri,serif" font-size="32" fill="#6B4E82" text-anchor="middle" opacity=".92">اللَّه</text>
  </svg>`
};
function sceneSvg(catId){ return SCENES[catId] || ''; }

/* ============================================================
   DATA :: original plain-English renderings — not quoted from any
   published translation. Hadith references are described in general
   terms rather than citing a specific book+number where that exact
   citation hasn't been verified against a primary source.
   ==> CONNECT: replace with a verified, licensed content source.
   ============================================================ */
const ITEMS = {
  // ============ MORNING ============
  'morning-dhikr':{ title:"Morning Remembrance", subtitle:"Asbahna wa asbahal-mulku lillah", icon:'sun',
    arabic:"أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
    translit:"Aṣbaḥnā wa aṣbaḥa l-mulku lillāh, wal-ḥamdu lillāh, lā ilāha illallāhu waḥdahū lā sharīka lah.",
    translation:"We have entered the morning, and with us the whole dominion belongs to Allah. All praise is for Allah. There is no god but Allah alone, without any partner.",
    reference:"Hisn al-Muslim 77 (Muslim 4/2088)" },

  'ayat-al-kursi':{ title:"Ayat al-Kursi", subtitle:"Al-Baqarah 2:255", icon:'star',
    arabic:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
    translit:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm, lā taʾkhudhuhū sinatun wa lā nawm, lahū mā fī s-samāwāti wa mā fī l-arḍ, man dhā lladhī yashfaʿu ʿindahū illā bi-idhnih, yaʿlamu mā bayna aydīhim wa mā khalfahum, wa lā yuḥīṭūna bi-shayʾin min ʿilmihī illā bi-mā shāʾ, wasiʿa kursiyyuhu s-samāwāti wa l-arḍ, wa lā yaʾūduhū ḥifẓuhumā, wa huwa l-ʿaliyyu l-ʿaẓīm.",
    translation:"Allah — there is no god but Him, the Ever-Living, the Sustainer of all existence. Neither drowsiness nor sleep overtakes Him. To Him belongs everything in the heavens and everything on the earth. Who could intercede with Him without His permission? He knows what lies before His creation and what lies behind them, and they grasp none of His knowledge except what He wills. His throne extends over the heavens and the earth, and preserving them tires Him not. He is the Most High, the Most Great.",
    reference:"Qur'an 2:255 — Hisn al-Muslim 75, recited morning and evening for protection" },

  'sayyidul-istighfar':{ title:"Sayyidul Istighfar", subtitle:"The Master Supplication for Forgiveness", icon:'star',
    arabic:"اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَىٰ عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ",
    translit:"Allāhumma anta Rabbī lā ilāha illā ant, khalaqtanī wa anā ʿabduk, wa anā ʿalā ʿahdika wa waʿdika mastaṭaʿt, aʿūdhu bika min sharri mā ṣanaʿt, abūʾu laka bi niʿmatika ʿalayya, wa abūʾu bidhanbī faghfir lī, fa-innahū lā yaghfirudh-dhunūba illā ant.",
    translation:"O Allah, You are my Lord, there is none worthy of worship but You. You created me and I am Your slave. I keep Your covenant and my pledge to You so far as I am able. I seek refuge in You from the evil of what I have done. I acknowledge Your blessing upon me, and I acknowledge my sin. Forgive me, for there is none who may forgive sins but You.",
    reference:"Hisn al-Muslim 79 (Al-Bukhari 7/150) — whoever recites this with conviction in the morning and dies that day enters Paradise" },

  'morning-wellbeing':{ title:"For Wellbeing in Body, Hearing and Sight", subtitle:"Recite three times", icon:'shield',
    arabic:"اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَٰهَ إِلَّا أَنْتَ",
    translit:"Allāhumma ʿāfinī fī badanī, Allāhumma ʿāfinī fī samʿī, Allāhumma ʿāfinī fī baṣarī, lā ilāha illā ant. (×3)",
    translation:"O Allah, make me healthy in my body. O Allah, preserve for me my hearing. O Allah, preserve for me my sight. There is none worthy of worship but You.",
    reference:"Hisn al-Muslim 82 (Abu Dawud 4/324, Ahmad 5/42) — recite three times" },

  'morning-sufficient':{ title:"Allah is Sufficient for Me", subtitle:"Recite seven times", icon:'shield',
    arabic:"حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ، وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ",
    translit:"Ḥasbiyallāhu lā ilāha illā huwa ʿalayhi tawakkaltu, wa huwa Rabbu l-ʿArshi l-ʿAẓīm. (×7)",
    translation:"Allah is sufficient for me. There is none worthy of worship but Him. I have placed my trust in Him, He is Lord of the Majestic Throne.",
    reference:"Hisn al-Muslim 83 (Ibn As-Sunni, Abu Dawud 4/321) — recite seven times in the morning or evening" },

  'hundred-hasanat':{ title:"None Has the Right to Be Worshipped But Allah", subtitle:"Recite ten times (or one hundred for the fuller reward)", icon:'repeat',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
    translit:"Lā ilāha illallāhu waḥdahu lā sharīka lah, lahu l-mulku wa lahu l-ḥamd, wa huwa ʿalā kulli shayʾin qadīr. (×10)",
    translation:"None has the right to be worshipped but Allah alone, He has no partner. His is the dominion and His is the praise, and He is able to do all things.",
    reference:"Hisn al-Muslim 92 (An-Nasa'i, 'Amal al-Yawm wal-Laylah) — recited ten times, this carries the reward of freeing ten slaves; recited one hundred times a day carries the reward of freeing ten slaves from the Children of Isma'il, plus one hundred good deeds recorded and one hundred sins erased (Al-Bukhari, Muslim)" },

  'two-light-words':{ title:"Two Phrases Light on the Tongue", subtitle:"Beloved to the Most Merciful, heavy on the Scale", icon:'star',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
    translit:"Subḥānallāhi wa biḥamdih, subḥānallāhi l-ʿAẓīm.",
    translation:"Glory be to Allah and praise Him, glory be to Allah the Magnificent.",
    reference:"Al-Bukhari 6682, Muslim 2694 — two phrases light on the tongue, heavy on the Scale, and beloved to the Most Merciful" },

  'four-witnesses-morning':{ title:"Bearing Witness at the Start of the Day", subtitle:"Recite four times", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَصْبَحْتُ أُشْهِدُكَ وَأُشْهِدُ حَمَلَةَ عَرْشِكَ، وَمَلَائِكَتَكَ وَجَمِيعَ خَلْقِكَ، أَنَّكَ أَنْتَ اللَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ وَحْدَكَ لَا شَرِيكَ لَكَ، وَأَنَّ مُحَمَّدًا عَبْدُكَ وَرَسُولُكَ",
    translit:"Allāhumma innī aṣbaḥtu ush-hiduka wa ush-hidu ḥamalata ʿarshik, wa malāʾikataka wa jamīʿa khalqik, annaka anta-llāhu lā ilāha illā ant, waḥdaka lā sharīka lak, wa anna Muḥammadan ʿabduka wa rasūluk. (×4)",
    translation:"O Allah, I have entered a new morning and call upon You and upon the bearers of Your Throne, upon Your angels and all creation to bear witness that You are Allah, none has the right to be worshipped but You alone, You have no partner, and that Muhammad is Your slave and Your Messenger.",
    reference:"Hisn al-Muslim 80 (Abu Dawud 4/317) — whoever says this four times in the morning or evening, Allah spares them from the Fire" },

  'four-witnesses-evening':{ title:"Bearing Witness at the Close of the Day", subtitle:"Recite four times", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَمْسَيْتُ أُشْهِدُكَ وَأُشْهِدُ حَمَلَةَ عَرْشِكَ، وَمَلَائِكَتَكَ وَجَمِيعَ خَلْقِكَ، أَنَّكَ أَنْتَ اللَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ وَحْدَكَ لَا شَرِيكَ لَكَ، وَأَنَّ مُحَمَّدًا عَبْدُكَ وَرَسُولُكَ",
    translit:"Allāhumma innī amsaytu ush-hiduka wa ush-hidu ḥamalata ʿarshik, wa malāʾikataka wa jamīʿa khalqik, annaka anta-llāhu lā ilāha illā ant, waḥdaka lā sharīka lak, wa anna Muḥammadan ʿabduka wa rasūluk. (×4)",
    translation:"O Allah, I have entered a new evening and call upon You and upon the bearers of Your Throne, upon Your angels and all creation to bear witness that You are Allah, none has the right to be worshipped but You alone, You have no partner, and that Muhammad is Your slave and Your Messenger.",
    reference:"Hisn al-Muslim 80 (Abu Dawud 4/317) — evening form of the same witnessing du'a; Allah spares from the Fire whoever recites it four times" },

  'fitrah-morning':{ title:"Upon the Fitrah of Islam", subtitle:"Rising upon the natural religion", icon:'sun',
    arabic:"أَصْبَحْنَا عَلَىٰ فِطْرَةِ الْإِسْلَامِ، وَعَلَىٰ كَلِمَةِ الْإِخْلَاصِ، وَعَلَىٰ دِينِ نَبِيِّنَا مُحَمَّدٍ ﷺ، وَعَلَىٰ مِلَّةِ أَبِينَا إِبْرَاهِيمَ، حَنِيفًا مُسْلِمًا وَمَا كَانَ مِنَ الْمُشْرِكِينَ",
    translit:"Aṣbaḥnā ʿalā fiṭrati l-Islām, wa ʿalā kalimati l-ikhlāṣ, wa ʿalā dīni Nabiyyinā Muḥammadin (ṣallallāhu ʿalayhi wa sallam), wa ʿalā millati abīnā Ibrāhīm, ḥanīfan musliman wa mā kāna minal-mushrikīn.",
    translation:"We have risen this morning upon the fitrah of Islam, upon the word of pure faith, upon the religion of our Prophet Muhammad ﷺ, and upon the way of our father Ibrahim, who was upright and submitted to Allah, and was not of those who associate partners with Him.",
    reference:"Hisn al-Muslim 90 (Ahmad 3/406-407, 3/439) — narrated by Ibn 'Umar; the evening form substitutes 'amsaynā' (we have entered the evening) for 'aṣbaḥnā'" },

  'blessing-from-you':{ title:"Every Blessing Is From You Alone", subtitle:"A short acknowledgement of Allah's favour", icon:'star',
    arabic:"اللَّهُمَّ مَا أَصْبَحَ بِي مِنْ نِعْمَةٍ أَوْ بِأَحَدٍ مِنْ خَلْقِكَ، فَمِنْكَ وَحْدَكَ لَا شَرِيكَ لَكَ، فَلَكَ الْحَمْدُ وَلَكَ الشُّكْرُ",
    translit:"Allāhumma mā aṣbaḥa bī min niʿmatin aw bi-aḥadin min khalqik, fa-minka waḥdaka lā sharīka lak, fa-lakal-ḥamdu wa lakash-shukr.",
    translation:"O Allah, whatever blessing I or any of Your creation have risen upon this morning is from You alone, without partner. So to You belongs all praise and to You belongs all thanks.",
    reference:"Hisn al-Muslim 81 (Abu Dawud, Ibn As-Sunni) — whoever says this has fulfilled their thanks for that day" },

  'afw-afiyah':{ title:"Pardon and Well-Being in Every Direction", subtitle:"Comprehensive protection for the day ahead", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ، اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي دِينِي وَدُنْيَايَ وَأَهْلِي وَمَالِي، اللَّهُمَّ اسْتُرْ عَوْرَاتِي وَآمِنْ رَوْعَاتِي، اللَّهُمَّ احْفَظْنِي مِنْ بَيْنِ يَدَيَّ وَمِنْ خَلْفِي وَعَنْ يَمِينِي وَعَنْ شِمَالِي وَمِنْ فَوْقِي، وَأَعُوذُ بِعَظَمَتِكَ أَنْ أُغْتَالَ مِنْ تَحْتِي",
    translit:"Allāhumma innī asʾalukal-ʿafwa wal-ʿāfiyata fid-dunyā wal-ākhirah. Allāhumma innī asʾalukal-ʿafwa wal-ʿāfiyata fī dīnī wa dunyāya wa ahlī wa mālī. Allāhummastur ʿawrātī wa āmin rawʿātī. Allāhumma ḥfaẓnī min bayni yadayya wa min khalfī wa ʿan yamīnī wa ʿan shimālī wa min fawqī, wa aʿūdhu biʿaẓamatika an ughtāla min taḥtī.",
    translation:"O Allah, I ask You for pardon and well-being in this life and the next. O Allah, I ask You for pardon and well-being in my religious and worldly affairs, and my family and my wealth. O Allah, veil my weaknesses and ease my fears. O Allah, protect me from in front of me, from behind me, from my right, from my left, and from above me, and I take refuge in Your greatness from being seized from beneath me.",
    reference:"Hisn al-Muslim 84 (Abu Dawud, Ibn Majah)" },

  'witness-unseen-seen':{ title:"Bearing Witness to the Knower of the Unseen", subtitle:"Refuge from the evil of one's own soul", icon:'shield',
    arabic:"اللَّهُمَّ عَالِمَ الْغَيْبِ وَالشَّهَادَةِ فَاطِرَ السَّمَاوَاتِ وَالْأَرْضِ، رَبَّ كُلِّ شَيْءٍ وَمَلِيكَهُ، أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا أَنْتَ، أَعُوذُ بِكَ مِنْ شَرِّ نَفْسِي وَمِنْ شَرِّ الشَّيْطَانِ وَشِرْكِهِ",
    translit:"Allāhumma ʿālimal-ghaybi wash-shahādah, fāṭiras-samāwāti wal-arḍ, Rabba kulli shayʾin wa malīkah, ash-hadu an lā ilāha illā ant, aʿūdhu bika min sharri nafsī wa min sharrish-shayṭāni wa shirkih.",
    translation:"O Allah, Knower of the unseen and the seen, Creator of the heavens and the earth, Lord and Sovereign of all things — I bear witness that none has the right to be worshipped but You. I take refuge in You from the evil of my own soul and from the evil of Shaytan and his shirk.",
    reference:"Hisn al-Muslim 85 (At-Tirmidhi, Abu Dawud)" },

  'bismillah-protection':{ title:"Nothing Can Cause Harm With This Name", subtitle:"Recite three times", icon:'shield',
    arabic:"بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ",
    translit:"Bismillāhil-ladhī lā yaḍurru maʿa smihi shayʾun fil-arḍi wa lā fis-samāʾi wa huwas-Samīʿul-ʿAlīm. (×3)",
    translation:"In the name of Allah, with whose name nothing on earth or in the heavens can cause harm, and He is the All-Hearing, the All-Knowing.",
    reference:"Hisn al-Muslim 86 (Abu Dawud, At-Tirmidhi) — whoever recites this three times will not be struck by sudden affliction until the next morning or evening" },

  'ya-hayyu-ya-qayyum':{ title:"O Ever-Living, O Sustainer", subtitle:"Seeking Allah's mercy for every affair", icon:'star',
    arabic:"يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَىٰ نَفْسِي طَرْفَةَ عَيْنٍ",
    translit:"Yā Ḥayyu yā Qayyūmu bi-raḥmatika astaghīth, aṣliḥ lī shaʾnī kullah, wa lā takilnī ilā nafsī ṭarfata ʿayn.",
    translation:"O Ever-Living, O Self-Subsisting Sustainer of all, by Your mercy I seek relief. Set right all of my affairs, and do not leave me to myself even for the blink of an eye.",
    reference:"Hisn al-Muslim 88 (An-Nasa'i, Al-Hakim)" },

  'khayra-hadhal-yawm':{ title:"The Good of This Day", subtitle:"Asking for its triumphs and guidance", icon:'sun',
    arabic:"أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ رَبِّ الْعَالَمِينَ، اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَ هَٰذَا الْيَوْمِ فَتْحَهُ وَنَصْرَهُ وَنُورَهُ وَبَرَكَتَهُ وَهُدَاهُ، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِيهِ وَشَرِّ مَا بَعْدَهُ",
    translit:"Aṣbaḥnā wa aṣbaḥal-mulku lillāhi Rabbil-ʿālamīn. Allāhumma innī asʾaluka khayra hādhal-yawm: fatḥahu wa naṣrahu wa nūrahu wa barakatahu wa hudāh, wa aʿūdhu bika min sharri mā fīhi wa sharri mā baʿdah.",
    translation:"We have entered the morning, and with us the whole dominion of Allah, Lord of all the worlds. O Allah, I ask You for the good of this day: its triumphs, its help, its light, its blessing, and its guidance, and I take refuge in You from the evil in it and the evil that follows it.",
    reference:"Hisn al-Muslim 89 (Abu Dawud) — evening form substitutes 'this night' for 'this day'" },

  'subhanallahi-hundred':{ title:"Subhanallahi wa Bihamdihi", subtitle:"Recite one hundred times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    translit:"Subḥānallāhi wa biḥamdih. (×100)",
    translation:"How perfect Allah is, and I praise Him.",
    reference:"Hisn al-Muslim 91 (Muslim) — whoever says this one hundred times a day will have their sins forgiven, even if they are like the foam of the sea" },

  'subhanallahi-extended':{ title:"By the Weight of His Throne", subtitle:"Recite three times", icon:'star',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ",
    translit:"Subḥānallāhi wa biḥamdih, ʿadada khalqih, wa riḍā nafsih, wa zinata ʿarshih, wa midāda kalimātih. (×3)",
    translation:"How perfect Allah is, and I praise Him, by the number of His creation, by His pleasure, by the weight of His Throne, and by the extent of His words.",
    reference:"Hisn al-Muslim 94 (Muslim)" },

  // ============ EVENING ============
  'evening-dhikr':{ title:"Evening Remembrance", subtitle:"Amsayna wa amsal-mulku lillah", icon:'moon',
    arabic:"أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
    translit:"Amsaynā wa amsal-mulku lillāh, wal-ḥamdu lillāh, lā ilāha illallāhu waḥdahū lā sharīka lah.",
    translation:"We have entered the evening, and with us the whole dominion belongs to Allah. All praise is for Allah. There is no god but Allah alone, without any partner.",
    reference:"Hisn al-Muslim 77 (evening form) — Muslim 4/2088" },

  'evening-protection':{ title:"Refuge in Allah's Perfect Words", subtitle:"Recite three times in the evening", icon:'shield',
    arabic:"أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
    translit:"Aʿūdhu bikalimāti-llāhit-tāmmāti min sharri mā khalaq. (×3)",
    translation:"I seek refuge in the Perfect Words of Allah from the evil of what He has created.",
    reference:"Hisn al-Muslim 97 (Ahmad 2/290, At-Tirmidhi 3/187) — protects from insect stings and harm through the night" },

  'evening-pleased':{ title:"Pleased with Allah as Lord", subtitle:"Recite three times", icon:'star',
    arabic:"رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا",
    translit:"Raḍītu billāhi Rabban, wa bil-Islāmi dīnan, wa bi-Muḥammadin (ṣallallāhu ʿalayhi wa sallam) nabiyyan. (×3)",
    translation:"I am pleased with Allah as my Lord, with Islam as my religion, and with Muhammad ﷺ as my Prophet.",
    reference:"Hisn al-Muslim 87 (Ahmad 4/337, At-Tirmidhi 5/465) — Allah has promised whoever says this three times every morning or evening will be pleased on the Day of Resurrection" },

  // ============ SALAH & AFTER SALAH ============
  'tasbih-33':{ title:"Tasbih, Tahmid and Takbir", subtitle:"33, 33 and 34 times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ (×٣٣) — الْحَمْدُ لِلَّهِ (×٣٣) — اللَّهُ أَكْبَرُ (×٣٤)",
    translit:"Subḥān Allāh (×33) — Alḥamdu lillāh (×33) — Allāhu akbar (×34)",
    translation:"Glory be to Allah (33 times). Praise be to Allah (33 times). Allah is the greatest (34 times).",
    reference:"Hisn al-Muslim 69 (Muslim 1/418) — whoever says this after every prayer will be forgiven, even if his sins are like the foam of the sea" },

  'dua-after-salah':{ title:"Remembrance After Salam", subtitle:"None has the right to be worshipped but Allah", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ، اللَّهُمَّ لَا مَانِعَ لِمَا أَعْطَيْتَ، وَلَا مُعْطِيَ لِمَا مَنَعْتَ، وَلَا يَنْفَعُ ذَا الْجَدِّ مِنْكَ الْجَدُّ",
    translit:"Lā ilāha illallāh, waḥdahu lā sharīka lah, lahu l-mulku wa lahu l-ḥamd, wa huwa ʿalā kulli shayʾin qadīr. Allāhumma lā māniʿa limā aʿṭayt, wa lā muʿṭiya limā manaʿt, wa lā yanfaʿu dhal-jaddi minkal-jadd.",
    translation:"None has the right to be worshipped but Allah alone, He has no partner, His is the dominion and His is the praise, and He is able to do all things. O Allah, there is none who can withhold what You give, and none may give what You have withheld, and the might of the mighty person cannot benefit him against You.",
    reference:"Hisn al-Muslim 67 (Al-Bukhari 1/255, Muslim 1/414)" },

  'ayat-al-kursi-salah':{ title:"Ayat al-Kursi After Prayer", subtitle:"Recite after each obligatory prayer", icon:'star',
    arabic:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ...",
    translit:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm... (full verse — see Ayat al-Kursi card)",
    translation:"See the full translation under Ayat al-Kursi. Reciting it after every obligatory prayer is one of the most emphasized daily practices in the Sunnah.",
    reference:"Hisn al-Muslim 71 (An-Nasa'i, 'Amal al-Yawm wal-Laylah, no. 100) — to be recited in Arabic after each prayer",
    isPointer:true, pointerNote:"This is the same Ayat al-Kursi (Qur'an 2:255) found in the Morning card — recited again here specifically after each of the five daily prayers." },

  'three-quls':{ title:"The Three Quls", subtitle:"Al-Ikhlas, Al-Falaq, An-Nas", icon:'shield',
    reference:"Hisn al-Muslim 70 & 76 (Qur'an 112, 113 & 114) — recited after each prayer (3× after Fajr and Maghrib), and morning, evening and before sleep for protection.",
    parts:[
      {label:"Al-Ikhlas (112)",
        arabic:"قُلْ هُوَ اللَّهُ أَحَدٌ. اللَّهُ الصَّمَدُ. لَمْ يَلِدْ وَلَمْ يُولَدْ. وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ",
        translit:"Qul huwa llāhu aḥad, Allāhu ṣ-ṣamad, lam yalid wa lam yūlad, wa lam yakul lahū kufuwan aḥad.",
        translation:"Say: He is Allah, the One. Allah, the Eternal Refuge. He does not give birth, nor was He born. And there is none comparable to Him."},
      {label:"Al-Falaq (113)",
        arabic:"قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ. مِنْ شَرِّ مَا خَلَقَ. وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ. وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ. وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ",
        translit:"Qul aʿūdhu bi-rabbi l-falaq, min sharri mā khalaq, wa min sharri ghāsiqin idhā waqab, wa min sharri n-naffāthāti fī l-ʿuqad, wa min sharri ḥāsidin idhā ḥasad.",
        translation:"Say: I seek refuge in the Lord of the daybreak, from the evil of what He has created, from the evil of darkness as it settles, from the evil of those who blow on knots, and from the evil of an envier when he envies."},
      {label:"An-Nas (114)",
        arabic:"قُلْ أَعُوذُ بِرَبِّ النَّاسِ. مَلِكِ النَّاسِ. إِلَٰهِ النَّاسِ. مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ. الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ. مِنَ الْجِنَّةِ وَالنَّاسِ",
        translit:"Qul aʿūdhu bi-rabbi n-nās, maliki n-nās, ilāhi n-nās, min sharri l-waswāsi l-khannās, alladhī yuwaswisu fī ṣudūri n-nās, mina l-jinnati wa n-nās.",
        translation:"Say: I seek refuge in the Lord of mankind, the King of mankind, the God of mankind, from the evil of the retreating whisperer, who whispers in the hearts of people, from among the jinn and mankind."}
    ] },

  'istikhara':{ title:"Prayer of Guidance (Istikhara)", subtitle:"For seeking Allah's counsel in a decision", icon:'star',
    arabic:"اللَّهُمَّ إِنِّي أَسْتَخِيرُكَ بِعِلْمِكَ، وَأَسْتَقْدِرُكَ بِقُدْرَتِكَ، وَأَسْأَلُكَ مِنْ فَضْلِكَ الْعَظِيمِ، فَإِنَّكَ تَقْدِرُ وَلَا أَقْدِرُ، وَتَعْلَمُ وَلَا أَعْلَمُ، وَأَنْتَ عَلَّامُ الْغُيُوبِ",
    translit:"Allāhumma innī astakhīruka biʿilmik, wa astaqdiruka biqudratik, wa asʾaluka min faḍlika l-ʿaẓīm, fa-innaka taqdiru wa lā aqdir, wa taʿlamu wa lā aʿlam, wa anta ʿallāmu l-ghuyūb.",
    translation:"O Allah, I seek Your counsel through Your knowledge, and I seek ability through Your power, and I ask You from Your immense favour. You are able and I am not, You know and I do not, and You are the Knower of the unseen. [Continue: 'O Allah, if You know that this matter is good for me in my religion, my livelihood, and the outcome of my affairs, then decree it for me, make it easy for me, and bless me in it...']",
    reference:"Hisn al-Muslim 74 (Al-Bukhari 7/162) — pray two rak'ahs other than the obligatory prayer, then recite this in full" },

  // ============ BEFORE SLEEP & TAHAJJUD ============
  'sajdah-mulk':{ title:"Surah al-Sajdah & Surah al-Mulk", subtitle:"Recite both Surahs", icon:'book',
    isPointer:true, pointerNote:"These are two full Surahs (32 and 67), recited by the Prophet ﷺ before sleep. Read them in full in the Qur'an section — this card will link straight there once the two sections are connected.",
    reference:"At-Tirmidhi 5/159, authenticated by Al-Albani — the Prophet ﷺ would not sleep until he had recited Alif Lam Mim Tanzil (as-Sajdah) and Tabarakalladhi (al-Mulk)" },

  'ayat-al-kursi-sleep':{ title:"Ayat al-Kursi Before Sleep", subtitle:"Al-Baqarah 2:255", icon:'star',
    isPointer:true, pointerNote:"The same Ayat al-Kursi found in the Morning card. Whoever recites it before sleeping will have a guardian from Allah remain with them through the night.",
    reference:"Hisn al-Muslim 100 (Al-Bukhari, Fath al-Bari 4/487)" },

  'last-two-baqarah':{ title:"Last Two Ayahs of Surah al-Baqarah", subtitle:"2:285-286", icon:'book',
    arabic:"آمَنَ الرَّسُولُ بِمَا أُنْزِلَ إِلَيْهِ مِنْ رَبِّهِ وَالْمُؤْمِنُونَ ۚ كُلٌّ آمَنَ بِاللَّهِ وَمَلَائِكَتِهِ وَكُتُبِهِ وَرُسُلِهِ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِنْ رُسُلِهِ ۚ وَقَالُوا سَمِعْنَا وَأَطَعْنَا ۖ غُفْرَانَكَ رَبَّنَا وَإِلَيْكَ الْمَصِيرُ. لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا اكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَا إِنْ نَسِينَا أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَا إِصْرًا كَمَا حَمَلْتَهُ عَلَى الَّذِينَ مِنْ قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِ ۖ وَاعْفُ عَنَّا وَاغْفِرْ لَنَا وَارْحَمْنَا ۚ أَنْتَ مَوْلَانَا فَانْصُرْنَا عَلَى الْقَوْمِ الْكَافِرِينَ",
    translit:"Āmana r-rasūlu bimā unzila ilayhi mir rabbihī wal-muʾminūn... Rabbanā lā tuʾākhidhnā in nasīnā aw akhṭaʾnā, rabbanā wa lā taḥmil ʿalaynā iṣran kamā ḥamaltahū ʿalā lladhīna min qablinā, rabbanā wa lā tuḥammilnā mā lā ṭāqata lanā bih, waʿfu ʿannā waghfir lanā warḥamnā, anta mawlānā fanṣurnā ʿalā l-qawmi l-kāfirīn.",
    translation:"The Messenger believes in what has been sent down to him from his Lord, and so do the believers. Each one believes in Allah, His angels, His books, and His messengers — 'We make no distinction between any of His messengers.' And they say: 'We hear and we obey; grant us Your forgiveness, our Lord, for to You is the return.' Allah does not burden a soul beyond what it can bear... 'Our Lord, do not take us to task if we forget or make a mistake. Our Lord, do not place upon us a burden like the one You placed on those before us. Our Lord, do not burden us with more than we have strength to bear. Pardon us, forgive us, and have mercy on us — You are our Protector, so grant us victory over the disbelieving people.'",
    reference:"Qur'an 2:285-286 — Hisn al-Muslim 101 (Al-Bukhari 9/94, Muslim 1/554), sufficient for anyone who recites it at night before sleeping" },

  'al-kafirun':{ title:"Surah al-Kafirun", subtitle:"Recite before sleep", icon:'book',
    arabic:"قُلْ يَا أَيُّهَا الْكَافِرُونَ. لَا أَعْبُدُ مَا تَعْبُدُونَ. وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ. وَلَا أَنَا عَابِدٌ مَا عَبَدْتُمْ. وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ. وَلَا لَكُمْ دِينِ",
    translit:"Qul yā ayyuhā l-kāfirūn, lā aʿbudu mā taʿbudūn, wa lā antum ʿābidūna mā aʿbud, wa lā ana ʿābidun mā ʿabadtum, wa lā antum ʿābidūna mā aʿbud, lakum dīnukum wa liya dīn.",
    translation:"Say: O disbelievers — I do not worship what you worship, nor do you worship what I worship. I will not worship what you worship, nor will you worship what I worship. You have your way, and I have mine.",
    reference:"Qur'an 109:1-6 — reported as recited by the Prophet ﷺ before sleep, described as 'freedom from shirk'" },

  'tasbih-fatima':{ title:"Tasbih Fatimah (before sleep)", subtitle:"33, 33 and 34 times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ (×٣٣) — الْحَمْدُ لِلَّهِ (×٣٣) — اللَّهُ أَكْبَرُ (×٣٤)",
    translit:"Subḥān Allāh (×33) — Alḥamdu lillāh (×33) — Allāhu akbar (×34)",
    translation:"Glory be to Allah (33 times). Praise be to Allah (33 times). Allah is the greatest (34 times).",
    reference:"Al-Bukhari 7/71, Muslim 4/2091 — taught by the Prophet ﷺ to Fatimah (RA) instead of a servant, described as better than what she had asked for" },

  'mercy-protection':{ title:"By Your Name I Die and Live", subtitle:"Upon lying down to sleep", icon:'shield',
    arabic:"بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
    translit:"Bismika Allāhumma amūtu wa aḥyā.",
    translation:"In Your name, O Allah, I die and I live.",
    reference:"Hisn al-Muslim 105 (Al-Bukhari, Fath al-Bari 11/113; Muslim 4/2083)" },

  'sleep-soul':{ title:"You Created My Soul", subtitle:"Comprehensive night supplication", icon:'shield',
    arabic:"اللَّهُمَّ إِنَّكَ خَلَقْتَ نَفْسِي وَأَنْتَ تَوَفَّاهَا، لَكَ مَمَاتُهَا وَمَحْيَاهَا، إِنْ أَحْيَيْتَهَا فَاحْفَظْهَا، وَإِنْ أَمَتَّهَا فَاغْفِرْ لَهَا. اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَافِيَةَ",
    translit:"Allāhumma innaka khalaqta nafsī wa anta tawaffāhā, laka mamātuhā wa maḥyāhā, in aḥyaytahā faḥfaẓhā, wa in amattahā faghfir lahā. Allāhumma innī asʾaluka l-ʿāfiyah.",
    translation:"O Allah, You have created my soul and You take it back. Unto You is its death and its life. If You give it life then protect it, and if You cause it to die then forgive it. O Allah, I ask You for well-being.",
    reference:"Hisn al-Muslim 103 (Muslim 4/2083, Ahmad 2/79)" },

  'sleep-punishment':{ title:"Save Me From Your Punishment", subtitle:"Upon lying down, hand under cheek", icon:'shield',
    arabic:"اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ",
    translit:"Allāhumma qinī ʿadhābaka yawma tabʿathu ʿibādak.",
    translation:"O Allah, save me from Your punishment on the Day that You resurrect Your slaves.",
    reference:"Hisn al-Muslim 104 (Abu Dawud 4/311) — the Prophet ﷺ would place his right hand under his cheek and say this before sleeping" },

  // ============ PRAISE OF ALLAH & SALAWAT ============
  'salawat':{ title:"The Ibrahimi Prayer", subtitle:"Blessings upon the Prophet ﷺ (after tashahhud)", icon:'star',
    arabic:"اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ، كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ. اللَّهُمَّ بَارِكْ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ، كَمَا بَارَكْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ",
    translit:"Allāhumma ṣalli ʿalā Muḥammadin wa ʿalā āli Muḥammadin, kamā ṣallayta ʿalā Ibrāhīma wa ʿalā āli Ibrāhīma, innaka ḥamīdum-majīd. Allāhumma bārik ʿalā Muḥammadin wa ʿalā āli Muḥammadin, kamā bārakta ʿalā Ibrāhīma wa ʿalā āli Ibrāhīma, innaka ḥamīdum-majīd.",
    translation:"O Allah, bestow Your favour on Muhammad and on the family of Muhammad as You have bestowed Your favour on Ibrahim and on the family of Ibrahim, You are Praiseworthy, Most Glorious. O Allah, bless Muhammad and the family of Muhammad as You have blessed Ibrahim and the family of Ibrahim, You are Praiseworthy, Most Glorious.",
    reference:"Hisn al-Muslim 53 (Al-Bukhari, Fath al-Bari 6/408) — the standard form of salawat recited in every prayer" },

  'salawat-short':{ title:"Short Salawat", subtitle:"Recite ten times, morning and evening", icon:'star',
    arabic:"اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَىٰ نَبِيِّنَا مُحَمَّدٍ",
    translit:"Allāhumma ṣalli wa sallim ʿalā nabiyyinā Muḥammad. (×10)",
    translation:"O Allah, send Your blessings and peace upon our Prophet Muhammad.",
    reference:"Hisn al-Muslim 98 — the Prophet ﷺ said: 'Whoever sends blessings upon me ten times in the morning and ten times in the evening will obtain my intercession on the Day of Resurrection.' (At-Tabarani, graded good by Al-Albani)" },

  'salawat-tenfold':{ title:"The Reward of a Single Salawat", subtitle:"Sending blessings once", icon:'star',
    isPointer:true, pointerNote:"There is no fixed wording required — any authentic form of salawat (such as the Ibrahimi prayer above) fulfils this.",
    reference:"Sunan an-Nasa'i 1297 — the Prophet ﷺ said: 'Whoever sends salah upon me once, Allah will send salah upon him tenfold, will erase ten sins from him, and will raise him ten degrees in status.'" },

  'subhanallah-bihamdihi':{ title:"Glory and Praise be to Allah", subtitle:"Recite one hundred times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    translit:"Subḥānallāhi wa biḥamdih. (×100)",
    translation:"Glory is to Allah and praise is to Him.",
    reference:"Hisn al-Muslim 91 (Al-Bukhari 4/2071) — whoever recites this one hundred times a day will have their sins forgiven even if as much as the foam of the sea" },

  'subhanallah-adad':{ title:"By the Multitude of His Creation", subtitle:"Recite three times, upon rising", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ",
    translit:"Subḥānallāhi wa biḥamdih: ʿadada khalqih, wa riḍā nafsih, wa zinata ʿarshih, wa midāda kalimātih. (×3)",
    translation:"Glory is to Allah and praise is to Him, by the multitude of His creation, by His Pleasure, by the weight of His Throne, and by the extent of His Words.",
    reference:"Hisn al-Muslim 94 (Muslim 4/2090)" },

  // ============ QUR'ANIC DU'A & SUNNAH DU'A ============
  'rabbana-atina':{ title:"Rabbana Atina", subtitle:"Al-Baqarah 2:201", icon:'book',
    arabic:"رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ",
    translit:"Rabbanā ātinā fid-dunyā ḥasanatan wa fil-ākhirati ḥasanatan wa qinā ʿadhāban-nār.",
    translation:"Our Lord, grant us goodness in this world, goodness in the Hereafter, and protect us from the torment of the Fire.",
    reference:"Qur'an 2:201 — the supplication most often recited by the Prophet ﷺ (Al-Bukhari and Muslim)" },

  'rabbi-zidni-ilma':{ title:"Rabbi Zidni Ilma", subtitle:"Ta-Ha 20:114", icon:'book',
    arabic:"رَبِّ زِدْنِي عِلْمًا",
    translit:"Rabbi zidnī ʿilmā.",
    translation:"My Lord, increase me in knowledge.",
    reference:"Qur'an 20:114 — the only supplication Allah specifically instructed the Prophet ﷺ to make in the Qur'an" },

  'rabbana-la-tuzigh':{ title:"Rabbana La Tuzigh", subtitle:"Aal-Imran 3:8", icon:'book',
    arabic:"رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِنْ لَدُنْكَ رَحْمَةً إِنَّكَ أَنْتَ الْوَهَّابُ",
    translit:"Rabbanā lā tuzigh qulūbanā baʿda idh hadaytanā wa hab lanā min ladunka raḥmatan innaka anta l-Wahhāb.",
    translation:"Our Lord, do not let our hearts turn away after You have guided us. Grant us mercy from You. Truly, You are the Bestower.",
    reference:"Qur'an 3:8" },

  'rabbana-zulm':{ title:"Rabbana Zalamna", subtitle:"Al-A'raf 7:23 — the du'a of Adam and Hawwa", icon:'book',
    arabic:"رَبَّنَا ظَلَمْنَا أَنْفُسَنَا وَإِنْ لَمْ تَغْفِرْ لَنَا وَتَرْحَمْنَا لَنَكُونَنَّ مِنَ الْخَاسِرِينَ",
    translit:"Rabbanā ẓalamnā anfusanā wa in lam taghfir lanā wa tarḥamnā lanakūnanna mina l-khāsirīn.",
    translation:"Our Lord, we have wronged ourselves. If You do not forgive us and show us mercy, we will surely be among the losers.",
    reference:"Qur'an 7:23 — the words of repentance of Adam and Hawwa after the forbidden tree" },

  'rabbana-afrigh':{ title:"Rabbana Afrigh", subtitle:"Al-Baqarah 2:250 — the du'a of Dawud's army", icon:'book',
    arabic:"رَبَّنَا أَفْرِغْ عَلَيْنَا صَبْرًا وَثَبِّتْ أَقْدَامَنَا وَانْصُرْنَا عَلَى الْقَوْمِ الْكَافِرِينَ",
    translit:"Rabbanā afrigh ʿalaynā ṣabran wa thabbit aqdāmanā wa-nṣurnā ʿalā l-qawmi l-kāfirīn.",
    translation:"Our Lord, pour patience upon us, make our steps firm, and grant us victory over those who reject faith.",
    reference:"Qur'an 2:250 — recited by the believers facing Jalut (Goliath)" },

  'rabbi-ishrah':{ title:"Rabbi Ishrah Li Sadri", subtitle:"Ta-Ha 20:25-28 — the du'a of Musa", icon:'book',
    arabic:"رَبِّ اشْرَحْ لِي صَدْرِي، وَيَسِّرْ لِي أَمْرِي، وَاحْلُلْ عُقْدَةً مِنْ لِسَانِي، يَفْقَهُوا قَوْلِي",
    translit:"Rabbi shraḥ lī ṣadrī, wa yassir lī amrī, wa ḥlul ʿuqdatan min lisānī, yafqahū qawlī.",
    translation:"My Lord, expand for me my chest, ease my task for me, and remove the knot from my tongue, so they may understand my speech.",
    reference:"Qur'an 20:25-28 — Musa's du'a before speaking to Pharaoh" },

  'rabbi-inni-lima':{ title:"Rabbi Inni Lima Anzalta", subtitle:"Al-Qasas 28:24 — the du'a of Musa at Madyan", icon:'book',
    arabic:"رَبِّ إِنِّي لِمَا أَنْزَلْتَ إِلَيَّ مِنْ خَيْرٍ فَقِيرٌ",
    translit:"Rabbi innī limā anzalta ilayya min khayrin faqīr.",
    translation:"My Lord, indeed I am, for whatever good You would send down to me, in need.",
    reference:"Qur'an 28:24 — Musa's du'a after fleeing Egypt, having nothing but reliance on Allah" },

  'yunus-la-ilaha':{ title:"La ilaha illa Anta", subtitle:"Al-Anbiya 21:87 — the du'a of Yunus", icon:'book',
    arabic:"لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ",
    translit:"Lā ilāha illā anta subḥānaka innī kuntu mina ẓ-ẓālimīn.",
    translation:"There is no god but You, glory be to You. Indeed, I was among the wrongdoers.",
    reference:"Qur'an 21:87 — the du'a of Yunus (Jonah) in the belly of the whale. The Prophet ﷺ said whoever supplicates with it will be answered (At-Tirmidhi)" },

  // ============ ISTIGHFAR & DHIKR FOR ALL TIMES ============
  'astaghfirullah':{ title:"Astaghfirullah", subtitle:"I seek the forgiveness of Allah", icon:'repeat',
    arabic:"أَسْتَغْفِرُ اللَّهَ",
    translit:"Astaghfirullāh.",
    translation:"I seek the forgiveness of Allah.",
    reference:"A short, easily repeated form of istighfar recited throughout the day and after prayer" },

  'la-ilaha-illallah':{ title:"La ilaha illallah", subtitle:"The best of what has been said", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ",
    translit:"Lā ilāha illallāh.",
    translation:"There is no god but Allah.",
    reference:"At-Tirmidhi — the Prophet ﷺ said the best that he and the prophets before him have said is this declaration" },

  'rabbighfir-tub':{ title:"Rabbighfir li wa Tub Alayya", subtitle:"Recited by the Prophet ﷺ 100 times in one sitting", icon:'repeat',
    arabic:"رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ",
    translit:"Rabbighfir lī wa tub ʿalayya, innaka Antat-Tawwābur-Raḥīm.",
    translation:"My Lord, forgive me and accept my repentance. Indeed, You are the Accepter of repentance, the Most Merciful.",
    reference:"Sunan Abi Dawud 1516, Jami' at-Tirmidhi 3434, Sunan Ibn Majah 3814 — Ibn Umar (RA) counted the Prophet ﷺ saying this a hundred times in a single sitting" },

  'astaghfirullah-full':{ title:"The Fuller Istighfar", subtitle:"I seek forgiveness of Allah, besides Whom there is no god", icon:'repeat',
    arabic:"أَسْتَغْفِرُ اللَّهَ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ",
    translit:"Astaghfirullāh alladhī lā ilāha illā huwal-Ḥayyul-Qayyūmu wa atūbu ilayh.",
    translation:"I seek the forgiveness of Allah, besides Whom there is no god, the Ever-Living, the Self-Subsisting, and I turn to Him in repentance.",
    reference:"Abu Dawud, At-Tirmidhi, and Al-Hakim — whoever says this will be forgiven even if they had fled the battlefield" },

  'subhanallah-general':{ title:"Subhanallah wa Bihamdihi", subtitle:"The most beloved words to Allah", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
    translit:"Subḥānallāhi wa biḥamdih, Subḥānallāhil-ʿAẓīm.",
    translation:"Glory be to Allah and praise is to Him. Glory be to Allah, the Magnificent.",
    reference:"Al-Bukhari 7/168, Muslim 4/2072 — two phrases described by the Prophet ﷺ as light on the tongue, heavy on the scale, and beloved to the Most Merciful" },

  // ============ DU'AS FOR THE UMMAH ============
  'dua-ummah':{ title:"Allahumma Aslih Ummata Muhammad", subtitle:"For the wellbeing of the Ummah", icon:'people',
    arabic:"اللَّهُمَّ أَصْلِحْ أُمَّةَ مُحَمَّدٍ. اللَّهُمَّ فَرِّجْ عَنْ أُمَّةِ مُحَمَّدٍ. اللَّهُمَّ ارْحَمْ أُمَّةَ مُحَمَّدٍ",
    translit:"Allāhumma aṣliḥ Ummata Muḥammad. Allāhumma farrij ʿan Ummati Muḥammad. Allāhumma rḥam Ummata Muḥammad ﷺ.",
    translation:"O Allah, set right the affairs of the Ummah of Muhammad. O Allah, grant relief to the Ummah of Muhammad. O Allah, have mercy on the Ummah of Muhammad.",
    reference:"A widely-used supplication for the Muslim community, especially recited during Dhul Hijjah and times of collective hardship" },

  'dua-ibrahim-descendants':{ title:"Rabbi Ij'alni Muqim as-Salah", subtitle:"Ibrahim 14:37-41 — Ibrahim's du'a for his descendants", icon:'people',
    arabic:"رَبَّنَا إِنِّي أَسْكَنْتُ مِنْ ذُرِّيَّتِي بِوَادٍ غَيْرِ ذِي زَرْعٍ عِنْدَ بَيْتِكَ الْمُحَرَّمِ رَبَّنَا لِيُقِيمُوا الصَّلَاةَ فَاجْعَلْ أَفْئِدَةً مِنَ النَّاسِ تَهْوِي إِلَيْهِمْ وَارْزُقْهُمْ مِنَ الثَّمَرَاتِ لَعَلَّهُمْ يَشْكُرُونَ",
    translit:"Rabbanā innī askantu min dhurriyyatī bi-wādin ghayri dhī zarʿin ʿinda baytika l-muḥarram, rabbanā li-yuqīmū ṣ-ṣalāta fa-jʿal afʾidatan mina n-nāsi tahwī ilayhim wa rzuqhum mina ṯ-ṯamarāti laʿallahum yashkurūn.",
    translation:"Our Lord, I have settled some of my descendants in a barren valley near Your Sacred House, our Lord, that they may establish prayer. So make hearts among the people incline toward them, and provide for them from the fruits that they might be grateful.",
    reference:"Qur'an 14:37 — Ibrahim's supplication for the Muslim community he left at the Ka'bah, before it was ever inhabited" },

  'rabbana-ighfir-lana':{ title:"Rabbana Ighfir Lana wa li Ikhwanina", subtitle:"Al-Hashr 59:10 — du'a for fellow believers", icon:'people',
    arabic:"رَبَّنَا اغْفِرْ لَنَا وَلِإِخْوَانِنَا الَّذِينَ سَبَقُونَا بِالْإِيمَانِ وَلَا تَجْعَلْ فِي قُلُوبِنَا غِلًّا لِلَّذِينَ آمَنُوا رَبَّنَا إِنَّكَ رَءُوفٌ رَحِيمٌ",
    translit:"Rabbanā ighfir lanā wa li-ikhwāninā lladhīna sabaqūnā bil-īmāni wa lā tajʿal fī qulūbinā ghillan lilladhīna āmanū rabbanā innaka Raʾūfur-Raḥīm.",
    translation:"Our Lord, forgive us and our brothers who preceded us in faith, and do not let there be resentment in our hearts toward those who believe. Our Lord, indeed You are Kind and Merciful.",
    reference:"Qur'an 59:10 — a du'a made on behalf of the wider community of believers, past and present" },

  'dua-victory-islam':{ title:"For the Aid of Islam and the Muslims", subtitle:"A call for strength and unity", icon:'people',
    arabic:"اللَّهُمَّ أَعِزَّ الْإِسْلَامَ وَالْمُسْلِمِينَ",
    translit:"Allāhumma aʿizza al-Islāma wal-Muslimīn.",
    translation:"O Allah, grant honour and strength to Islam and the Muslims.",
    reference:"Musnad Ahmad, narrated from Anas ibn Malik (RA) — hadith no. 12695" },

  // ============ THE 99 NAMES OF ALLAH ============
  'name-ar-rahman':{ title:"Ar-Rahman", subtitle:"The Entirely Merciful", icon:'star', arabic:"الرَّحْمَٰن", translit:"Ar-Raḥmān", translation:"The Entirely Merciful — whose mercy encompasses all creation.", reference:"Qur'an 1:1, and throughout the Qur'an" },
  'name-ar-raheem':{ title:"Ar-Raheem", subtitle:"The Especially Merciful", icon:'star', arabic:"الرَّحِيم", translit:"Ar-Raḥīm", translation:"The Especially Merciful — whose mercy is directed particularly toward the believers.", reference:"Qur'an 1:1, and throughout the Qur'an" },
  'name-al-malik':{ title:"Al-Malik", subtitle:"The Sovereign King", icon:'star', arabic:"الْمَلِك", translit:"Al-Malik", translation:"The Sovereign King, the true Owner of all dominion.", reference:"Qur'an 59:23" },
  'name-al-quddus':{ title:"Al-Quddus", subtitle:"The Absolutely Pure", icon:'star', arabic:"الْقُدُّوس", translit:"Al-Quddūs", translation:"The Absolutely Pure, free from any imperfection.", reference:"Qur'an 59:23" },
  'name-as-salam':{ title:"As-Salam", subtitle:"The Giver of Peace", icon:'star', arabic:"السَّلَام", translit:"As-Salām", translation:"The Source of Peace and Safety, free from every defect.", reference:"Qur'an 59:23" },
  'name-al-mumin':{ title:"Al-Mu'min", subtitle:"The Granter of Security", icon:'star', arabic:"الْمُؤْمِن", translit:"Al-Muʾmin", translation:"The Granter of security and faith to His creation.", reference:"Qur'an 59:23" },
  'name-al-muhaymin':{ title:"Al-Muhaymin", subtitle:"The Guardian Overseer", icon:'star', arabic:"الْمُهَيْمِن", translit:"Al-Muhaymin", translation:"The Guardian and Overseer of all things.", reference:"Qur'an 59:23" },
  'name-al-aziz':{ title:"Al-Aziz", subtitle:"The All-Mighty", icon:'star', arabic:"الْعَزِيز", translit:"Al-ʿAzīz", translation:"The Almighty, whose might is never overcome.", reference:"Qur'an 59:23" },
  'name-al-jabbar':{ title:"Al-Jabbar", subtitle:"The Restorer & Compeller", icon:'star', arabic:"الْجَبَّار", translit:"Al-Jabbār", translation:"The Compeller, who restores and repairs the affairs of His creation.", reference:"Qur'an 59:23" },
  'name-al-mutakabbir':{ title:"Al-Mutakabbir", subtitle:"The Supremely Great", icon:'star', arabic:"الْمُتَكَبِّر", translit:"Al-Mutakabbir", translation:"The Supremely Great, above every imperfection ascribed to Him.", reference:"Qur'an 59:23" },
  'name-al-khaliq':{ title:"Al-Khaliq", subtitle:"The Creator of All", icon:'star', arabic:"الْخَالِق", translit:"Al-Khāliq", translation:"The Creator, who brings all things into being from nothing.", reference:"Qur'an 59:24" },
  'name-al-bari':{ title:"Al-Bari'", subtitle:"The Evolver", icon:'star', arabic:"الْبَارِئ", translit:"Al-Bāriʾ", translation:"The Evolver, who shapes creation free from any flaw.", reference:"Qur'an 59:24" },
  'name-al-musawwir':{ title:"Al-Musawwir", subtitle:"The Fashioner of Forms", icon:'star', arabic:"الْمُصَوِّر", translit:"Al-Muṣawwir", translation:"The Fashioner, who gives every creation its unique form.", reference:"Qur'an 59:24" },
  'name-al-ghaffar':{ title:"Al-Ghaffar", subtitle:"The Oft-Forgiving", icon:'star', arabic:"الْغَفَّار", translit:"Al-Ghaffār", translation:"The Repeatedly Forgiving, who forgives sins again and again.", reference:"Qur'an 20:82" },
  'name-al-qahhar':{ title:"Al-Qahhar", subtitle:"The Subduer of All", icon:'star', arabic:"الْقَهَّار", translit:"Al-Qahhār", translation:"The Subduer, before whom all creation is powerless.", reference:"Qur'an 13:16" },
  'name-al-wahhab':{ title:"Al-Wahhab", subtitle:"The Bestower of Gifts", icon:'star', arabic:"الْوَهَّاب", translit:"Al-Wahhāb", translation:"The Bestower, who gives freely and without limit.", reference:"Qur'an 3:8" },
  'name-ar-razzaq':{ title:"Ar-Razzaq", subtitle:"The Provider of Sustenance", icon:'star', arabic:"الرَّزَّاق", translit:"Ar-Razzāq", translation:"The Provider, who sustains every creature.", reference:"Qur'an 51:58" },
  'name-al-fattah':{ title:"Al-Fattah", subtitle:"The Opener of Ways", icon:'star', arabic:"الْفَتَّاح", translit:"Al-Fattāḥ", translation:"The Opener, who opens the way to mercy, provision and judgement.", reference:"Qur'an 34:26" },
  'name-al-alim':{ title:"Al-Alim", subtitle:"The All-Knowing", icon:'star', arabic:"الْعَلِيم", translit:"Al-ʿAlīm", translation:"The All-Knowing, whose knowledge encompasses everything.", reference:"Qur'an 2:29" },
  'name-al-qabid':{ title:"Al-Qabid", subtitle:"The Withholder of Provision", icon:'star', arabic:"الْقَابِض", translit:"Al-Qābiḍ", translation:"The One who withholds provision by His wisdom.", reference:"Derived from Qur'an 2:245" },
  'name-al-basit':{ title:"Al-Basit", subtitle:"The Expander of Provision", icon:'star', arabic:"الْبَاسِط", translit:"Al-Bāsiṭ", translation:"The One who expands provision by His generosity.", reference:"Derived from Qur'an 2:245" },
  'name-al-khafid':{ title:"Al-Khafid", subtitle:"The Abaser", icon:'star', arabic:"الْخَافِض", translit:"Al-Khāfiḍ", translation:"The Abaser, who humbles whom He wills.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-ar-rafi':{ title:"Ar-Rafi'", subtitle:"The Exalter", icon:'star', arabic:"الرَّافِع", translit:"Ar-Rāfiʿ", translation:"The Exalter, who raises whom He wills in honour.", reference:"Derived from Qur'an 6:83" },
  'name-al-muizz':{ title:"Al-Mu'izz", subtitle:"The Giver of Honour", icon:'star', arabic:"الْمُعِزّ", translit:"Al-Muʿizz", translation:"The One who gives honour to whom He wills.", reference:"Qur'an 3:26" },
  'name-al-mudhill':{ title:"Al-Mudhill", subtitle:"The Humiliator", icon:'star', arabic:"الْمُذِلّ", translit:"Al-Mudhill", translation:"The One who humbles whom He wills.", reference:"Qur'an 3:26" },
  'name-as-sami':{ title:"As-Sami'", subtitle:"The All-Hearing", icon:'star', arabic:"السَّمِيع", translit:"As-Samīʿ", translation:"The All-Hearing, who hears every sound, spoken or silent.", reference:"Qur'an 2:127" },
  'name-al-basir':{ title:"Al-Basir", subtitle:"The All-Seeing", icon:'star', arabic:"الْبَصِير", translit:"Al-Baṣīr", translation:"The All-Seeing, who sees all things, however hidden.", reference:"Qur'an 4:58" },
  'name-al-hakam':{ title:"Al-Hakam", subtitle:"The Perfect Judge", icon:'star', arabic:"الْحَكَم", translit:"Al-Ḥakam", translation:"The Perfect Judge, whose ruling is always just.", reference:"Traditional enumeration (Abu Dawud)" },
  'name-al-adl':{ title:"Al-Adl", subtitle:"The Utterly Just", icon:'star', arabic:"الْعَدْل", translit:"Al-ʿAdl", translation:"The Utterly Just, free from any trace of unfairness.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-latif':{ title:"Al-Latif", subtitle:"The Subtle, Most Kind", icon:'star', arabic:"اللَّطِيف", translit:"Al-Laṭīf", translation:"The Subtle and Most Kind, aware of the finest details of His creation's needs.", reference:"Qur'an 6:103" },
  'name-al-khabir':{ title:"Al-Khabir", subtitle:"The All-Aware", icon:'star', arabic:"الْخَبِير", translit:"Al-Khabīr", translation:"The All-Aware, fully acquainted with the reality of all things.", reference:"Qur'an 6:103" },
  'name-al-halim':{ title:"Al-Halim", subtitle:"The Forbearing", icon:'star', arabic:"الْحَلِيم", translit:"Al-Ḥalīm", translation:"The Forbearing, who delays punishment out of mercy.", reference:"Qur'an 2:225" },
  'name-al-azim':{ title:"Al-Azim", subtitle:"The Magnificent", icon:'star', arabic:"الْعَظِيم", translit:"Al-ʿAẓīm", translation:"The Magnificent, whose greatness has no bound.", reference:"Qur'an 2:255" },
  'name-al-ghafur':{ title:"Al-Ghafur", subtitle:"The All-Forgiving", icon:'star', arabic:"الْغَفُور", translit:"Al-Ghafūr", translation:"The All-Forgiving, who covers and pardons sin.", reference:"Qur'an 2:173" },
  'name-ash-shakur':{ title:"Ash-Shakur", subtitle:"The Most Appreciative", icon:'star', arabic:"الشَّكُور", translit:"Ash-Shakūr", translation:"The Most Appreciative, who rewards even small acts of good generously.", reference:"Qur'an 35:30" },
  'name-al-aliyy':{ title:"Al-Aliyy", subtitle:"The Most High", icon:'star', arabic:"الْعَلِيّ", translit:"Al-ʿAliyy", translation:"The Most High, exalted above all creation.", reference:"Qur'an 2:255" },
  'name-al-kabir':{ title:"Al-Kabir", subtitle:"The Most Great", icon:'star', arabic:"الْكَبِير", translit:"Al-Kabīr", translation:"The Most Great, greater than anything that can be imagined.", reference:"Qur'an 13:9" },
  'name-al-hafiz':{ title:"Al-Hafiz", subtitle:"The Preserver & Protector", icon:'star', arabic:"الْحَفِيظ", translit:"Al-Ḥafīẓ", translation:"The Preserver, who protects His creation and their deeds.", reference:"Qur'an 11:57" },
  'name-al-muqit':{ title:"Al-Muqit", subtitle:"The Nourisher", icon:'star', arabic:"الْمُقِيت", translit:"Al-Muqīt", translation:"The Nourisher, who sustains every soul with what it needs.", reference:"Qur'an 4:85" },
  'name-al-hasib':{ title:"Al-Hasib", subtitle:"The Reckoner", icon:'star', arabic:"الْحَسِيب", translit:"Al-Ḥasīb", translation:"The Reckoner, sufficient as a keeper of account.", reference:"Qur'an 4:6" },
  'name-al-jalil':{ title:"Al-Jalil", subtitle:"The Majestic", icon:'star', arabic:"الْجَلِيل", translit:"Al-Jalīl", translation:"The Majestic, possessor of greatness and honour.", reference:"Derived from Qur'an 55:27" },
  'name-al-karim':{ title:"Al-Karim", subtitle:"The Generous & Noble", icon:'star', arabic:"الْكَرِيم", translit:"Al-Karīm", translation:"The Generous and Noble, giving abundantly without being asked.", reference:"Qur'an 27:40" },
  'name-ar-raqib':{ title:"Ar-Raqib", subtitle:"The Ever-Watchful", icon:'star', arabic:"الرَّقِيب", translit:"Ar-Raqīb", translation:"The Ever-Watchful, observing all things at all times.", reference:"Qur'an 4:1" },
  'name-al-mujib':{ title:"Al-Mujib", subtitle:"The Responsive One", icon:'star', arabic:"الْمُجِيب", translit:"Al-Mujīb", translation:"The Responsive One, who answers the call of those who supplicate.", reference:"Qur'an 11:61" },
  'name-al-wasi':{ title:"Al-Wasi'", subtitle:"The All-Encompassing", icon:'star', arabic:"الْوَاسِع", translit:"Al-Wāsiʿ", translation:"The All-Encompassing, whose mercy and knowledge embrace everything.", reference:"Qur'an 2:268" },
  'name-al-hakim':{ title:"Al-Hakim", subtitle:"The All-Wise", icon:'star', arabic:"الْحَكِيم", translit:"Al-Ḥakīm", translation:"The All-Wise, whose every decree carries perfect wisdom.", reference:"Qur'an 2:32" },
  'name-al-wadud':{ title:"Al-Wadud", subtitle:"The Loving One", icon:'star', arabic:"الْوَدُود", translit:"Al-Wadūd", translation:"The Loving One, who loves and is beloved by the righteous.", reference:"Qur'an 11:90" },
  'name-al-majid':{ title:"Al-Majid", subtitle:"The Most Glorious", icon:'star', arabic:"الْمَجِيد", translit:"Al-Majīd", translation:"The Most Glorious, possessor of perfect majesty.", reference:"Qur'an 11:73" },
  'name-al-baith':{ title:"Al-Ba'ith", subtitle:"The Resurrector", icon:'star', arabic:"الْبَاعِث", translit:"Al-Bāʿith", translation:"The Resurrector, who will raise all creation on the Day of Judgement.", reference:"Derived from Qur'an 22:7" },
  'name-ash-shahid':{ title:"Ash-Shahid", subtitle:"The Witness", icon:'star', arabic:"الشَّهِيد", translit:"Ash-Shahīd", translation:"The Witness, present and aware of everything without exception.", reference:"Qur'an 4:79" },
  'name-al-haqq':{ title:"Al-Haqq", subtitle:"The Truth", icon:'star', arabic:"الْحَقّ", translit:"Al-Ḥaqq", translation:"The Truth, whose existence and promise are absolute.", reference:"Qur'an 22:6" },
  'name-al-wakil':{ title:"Al-Wakil", subtitle:"The Trusted Guardian", icon:'star', arabic:"الْوَكِيل", translit:"Al-Wakīl", translation:"The Trusted Guardian, sufficient for those who rely on Him.", reference:"Qur'an 3:173" },
  'name-al-qawiyy':{ title:"Al-Qawiyy", subtitle:"The All-Strong", icon:'star', arabic:"الْقَوِيّ", translit:"Al-Qawiyy", translation:"The All-Strong, whose strength never fails.", reference:"Qur'an 22:40" },
  'name-al-matin':{ title:"Al-Matin", subtitle:"The Firm & Steadfast", icon:'star', arabic:"الْمَتِين", translit:"Al-Matīn", translation:"The Firm, whose power is unshakeable.", reference:"Qur'an 51:58" },
  'name-al-waliyy':{ title:"Al-Waliyy", subtitle:"The Protecting Ally", icon:'star', arabic:"الْوَلِيّ", translit:"Al-Waliyy", translation:"The Protecting Ally and Friend of the believers.", reference:"Qur'an 42:28" },
  'name-al-hamid':{ title:"Al-Hamid", subtitle:"The Praiseworthy", icon:'star', arabic:"الْحَمِيد", translit:"Al-Ḥamīd", translation:"The Praiseworthy, deserving of all praise in every state.", reference:"Qur'an 14:8" },
  'name-al-muhsi':{ title:"Al-Muhsi", subtitle:"The Reckoner of All", icon:'star', arabic:"الْمُحْصِي", translit:"Al-Muḥṣī", translation:"The One who has counted and encompassed all things in knowledge.", reference:"Derived from Qur'an 72:28" },
  'name-al-mubdi':{ title:"Al-Mubdi'", subtitle:"The Originator", icon:'star', arabic:"الْمُبْدِئ", translit:"Al-Mubdiʾ", translation:"The Originator, who began creation without precedent.", reference:"Qur'an 29:19" },
  'name-al-muid':{ title:"Al-Mu'id", subtitle:"The Restorer", icon:'star', arabic:"الْمُعِيد", translit:"Al-Muʿīd", translation:"The Restorer, who will bring creation back after death.", reference:"Qur'an 29:19" },
  'name-al-muhyi':{ title:"Al-Muhyi", subtitle:"The Giver of Life", icon:'star', arabic:"الْمُحْيِي", translit:"Al-Muḥyī", translation:"The Giver of Life to all that lives.", reference:"Qur'an 30:50" },
  'name-al-mumit':{ title:"Al-Mumit", subtitle:"The Taker of Life", icon:'star', arabic:"الْمُمِيت", translit:"Al-Mumīt", translation:"The One who causes death at the appointed time.", reference:"Derived from Qur'an 15:23" },
  'name-al-hayy':{ title:"Al-Hayy", subtitle:"The Ever-Living", icon:'star', arabic:"الْحَيّ", translit:"Al-Ḥayy", translation:"The Ever-Living, whose life has no beginning and no end.", reference:"Qur'an 2:255" },
  'name-al-qayyum':{ title:"Al-Qayyum", subtitle:"The Sustainer of All", icon:'star', arabic:"الْقَيُّوم", translit:"Al-Qayyūm", translation:"The Sustainer, upon whom all creation depends for its existence.", reference:"Qur'an 2:255" },
  'name-al-wajid':{ title:"Al-Wajid", subtitle:"The Finder", icon:'star', arabic:"الْوَاجِد", translit:"Al-Wājid", translation:"The Finder, who lacks nothing and finds all that He wills.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-majid-2':{ title:"Al-Majid", subtitle:"The Noble", icon:'star', arabic:"الْمَاجِد", translit:"Al-Mājid", translation:"The Noble, of perfect and abundant glory.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-wahid':{ title:"Al-Wahid", subtitle:"The One", icon:'star', arabic:"الْوَاحِد", translit:"Al-Wāḥid", translation:"The One, singular in His essence, attributes and actions.", reference:"Qur'an 13:16" },
  'name-as-samad':{ title:"As-Samad", subtitle:"The Eternal Refuge", icon:'star', arabic:"الصَّمَد", translit:"Aṣ-Ṣamad", translation:"The Eternal Refuge, upon whom all creation depends while He depends on none.", reference:"Qur'an 112:2" },
  'name-al-qadir':{ title:"Al-Qadir", subtitle:"The Able", icon:'star', arabic:"الْقَادِر", translit:"Al-Qādir", translation:"The Able, capable of all things.", reference:"Qur'an 6:65" },
  'name-al-muqtadir':{ title:"Al-Muqtadir", subtitle:"The Omnipotent", icon:'star', arabic:"الْمُقْتَدِر", translit:"Al-Muqtadir", translation:"The Omnipotent, whose power overwhelms every obstacle.", reference:"Qur'an 54:42" },
  'name-al-muqaddim':{ title:"Al-Muqaddim", subtitle:"The Expediter", icon:'star', arabic:"الْمُقَدِّم", translit:"Al-Muqaddim", translation:"The Expediter, who advances whom and what He wills.", reference:"Traditional enumeration, derived from prophetic supplication (Muslim 1/534)" },
  'name-al-muakhkhir':{ title:"Al-Mu'akhkhir", subtitle:"The Delayer", icon:'star', arabic:"الْمُؤَخِّر", translit:"Al-Muʾakhkhir", translation:"The Delayer, who defers whom and what He wills.", reference:"Traditional enumeration, derived from prophetic supplication (Muslim 1/534)" },
  'name-al-awwal':{ title:"Al-Awwal", subtitle:"The First", icon:'star', arabic:"الْأَوَّل", translit:"Al-Awwal", translation:"The First, before whom nothing existed.", reference:"Qur'an 57:3" },
  'name-al-akhir':{ title:"Al-Akhir", subtitle:"The Last", icon:'star', arabic:"الْآخِر", translit:"Al-Ākhir", translation:"The Last, after whom nothing remains.", reference:"Qur'an 57:3" },
  'name-az-zahir':{ title:"Az-Zahir", subtitle:"The Manifest", icon:'star', arabic:"الظَّاهِر", translit:"Aẓ-Ẓāhir", translation:"The Manifest, evident through the signs of His creation.", reference:"Qur'an 57:3" },
  'name-al-batin':{ title:"Al-Batin", subtitle:"The Hidden", icon:'star', arabic:"الْبَاطِن", translit:"Al-Bāṭin", translation:"The Hidden, whose true essence cannot be perceived.", reference:"Qur'an 57:3" },
  'name-al-wali':{ title:"Al-Wali", subtitle:"The Patron", icon:'star', arabic:"الْوَالِي", translit:"Al-Wālī", translation:"The Patron, who governs and manages all affairs.", reference:"Qur'an 13:11" },
  'name-al-mutaali':{ title:"Al-Muta'ali", subtitle:"The Most High", icon:'star', arabic:"الْمُتَعَالِي", translit:"Al-Mutaʿālī", translation:"The Most High, transcendent above every limitation.", reference:"Qur'an 13:9" },
  'name-al-barr':{ title:"Al-Barr", subtitle:"The Most Kind", icon:'star', arabic:"الْبَرّ", translit:"Al-Barr", translation:"The Most Kind, generous and gentle to His servants.", reference:"Qur'an 52:28" },
  'name-at-tawwab':{ title:"At-Tawwab", subtitle:"The Accepter of Repentance", icon:'star', arabic:"التَّوَّاب", translit:"At-Tawwāb", translation:"The Accepter of Repentance, who repeatedly turns to His servants in forgiveness.", reference:"Qur'an 2:37" },
  'name-al-muntaqim':{ title:"Al-Muntaqim", subtitle:"The Avenger", icon:'star', arabic:"الْمُنْتَقِم", translit:"Al-Muntaqim", translation:"The Avenger, who requites the wrongdoer with justice.", reference:"Qur'an 32:22" },
  'name-al-afuw':{ title:"Al-Afuw", subtitle:"The Pardoner", icon:'star', arabic:"الْعَفُوّ", translit:"Al-ʿAfuww", translation:"The Pardoner, who erases sin entirely.", reference:"Qur'an 4:99" },
  'name-ar-rauf':{ title:"Ar-Ra'uf", subtitle:"The Most Compassionate", icon:'star', arabic:"الرَّؤُوف", translit:"Ar-Raʾūf", translation:"The Most Compassionate, gentle with His creation.", reference:"Qur'an 2:143" },
  'name-al-muqsit':{ title:"Al-Muqsit", subtitle:"The Just in Fairness", icon:'star', arabic:"الْمُقْسِط", translit:"Al-Muqsiṭ", translation:"The Just, who deals with absolute fairness.", reference:"Qur'an 21:47 (concept); traditional enumeration" },
  'name-al-jami':{ title:"Al-Jami'", subtitle:"The Gatherer", icon:'star', arabic:"الْجَامِع", translit:"Al-Jāmiʿ", translation:"The Gatherer, who will assemble all creation on the Day of Judgement.", reference:"Qur'an 3:9" },
  'name-al-ghaniyy':{ title:"Al-Ghaniyy", subtitle:"The Self-Sufficient", icon:'star', arabic:"الْغَنِيّ", translit:"Al-Ghaniyy", translation:"The Self-Sufficient, in need of nothing from His creation.", reference:"Qur'an 2:263" },
  'name-al-mughni':{ title:"Al-Mughni", subtitle:"The Enricher", icon:'star', arabic:"الْمُغْنِي", translit:"Al-Mughnī", translation:"The Enricher, who grants sufficiency to whom He wills.", reference:"Qur'an 9:28" },
  'name-al-mani':{ title:"Al-Mani'", subtitle:"The Preventer of Harm", icon:'star', arabic:"الْمَانِع", translit:"Al-Māniʿ", translation:"The Preventer, who withholds harm from His servants.", reference:"Traditional enumeration (Al-Bukhari, Muslim)" },
  'name-ad-darr':{ title:"Ad-Darr", subtitle:"The Bringer of Harm", icon:'star', arabic:"الضَّارّ", translit:"Aḍ-Ḍārr", translation:"The One from whom harm proceeds only by His wise decree.", reference:"Traditional enumeration, paired with An-Nafi'" },
  'name-an-nafi':{ title:"An-Nafi'", subtitle:"The Giver of Benefit", icon:'star', arabic:"النَّافِع", translit:"An-Nāfiʿ", translation:"The Giver of benefit to whomever He wills.", reference:"Traditional enumeration, paired with Ad-Darr" },
  'name-an-nur':{ title:"An-Nur", subtitle:"The Light", icon:'star', arabic:"النُّور", translit:"An-Nūr", translation:"The Light of the heavens and the earth.", reference:"Qur'an 24:35" },
  'name-al-hadi':{ title:"Al-Hadi", subtitle:"The Guide", icon:'star', arabic:"الْهَادِي", translit:"Al-Hādī", translation:"The Guide, who leads His servants to the straight path.", reference:"Qur'an 25:31" },
  'name-al-badi':{ title:"Al-Badi'", subtitle:"The Incomparable Originator", icon:'star', arabic:"الْبَدِيع", translit:"Al-Badīʿ", translation:"The Incomparable Originator, who created without precedent or model.", reference:"Qur'an 2:117" },
  'name-al-baqi':{ title:"Al-Baqi", subtitle:"The Everlasting", icon:'star', arabic:"الْبَاقِي", translit:"Al-Bāqī", translation:"The Everlasting, who remains after all creation perishes.", reference:"Derived from Qur'an 55:27" },
  'name-al-warith':{ title:"Al-Warith", subtitle:"The Inheritor", icon:'star', arabic:"الْوَارِث", translit:"Al-Wārith", translation:"The Inheritor, to whom all things return.", reference:"Qur'an 15:23" },
  'name-ar-rashid':{ title:"Ar-Rashid", subtitle:"The Guide to the Right Way", icon:'star', arabic:"الرَّشِيد", translit:"Ar-Rashīd", translation:"The Guide, whose wisdom directs all things to their proper end.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-as-sabur':{ title:"As-Sabur", subtitle:"The Most Patient", icon:'star', arabic:"الصَّبُور", translit:"Aṣ-Ṣabūr", translation:"The Most Patient, who does not hasten in punishing.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-malik-ul-mulk':{ title:"Malik-ul-Mulk", subtitle:"The Owner of All Sovereignty", icon:'star', arabic:"مَالِكُ الْمُلْك", translit:"Mālik-ul-Mulk", translation:"The Owner of all sovereignty, giving dominion to whom He wills.", reference:"Qur'an 3:26" },
  'name-dhul-jalal':{ title:"Dhul-Jalali wal-Ikram", subtitle:"Lord of Glory and Honour", icon:'star', arabic:"ذُو الْجَلَالِ وَالْإِكْرَام", translit:"Dhul-Jalāli wal-Ikrām", translation:"The Lord of Majesty and Generosity.", reference:"Qur'an 55:27" },
  'name-al-muhsin':{ title:"Al-Muhsin", subtitle:"The Doer of Good", icon:'star', arabic:"الْمُحْسِن", translit:"Al-Muḥsin", translation:"The Doer of Good, perfect in every action toward His creation.", reference:"Traditional enumeration" },

  // ============ OTHER BENEFICIAL SUPPLICATIONS — Protection & Ruqyah ============
  'other-expel-devil':{ title:"Seeking Refuge from Satan", subtitle:"To expel the devil and his whisperings", icon:'shield',
    arabic:"أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
    translit:"A'ūdhu billāhi minash-shayṭānir-rajīm.",
    translation:"I seek refuge in Allah from Satan, the accursed.",
    reference:"Hisn al-Muslim 141 (Abu Dawud 1/206, At-Tirmidhi) — recited to expel whispers and distractions, especially in prayer" },

  'other-fear-shirk':{ title:"Refuge from Shirk", subtitle:"For fear of associating partners with Allah, knowingly or not", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَعُوذُ بِكَ أَنْ أُشْرِكَ بِكَ وَأَنَا أَعْلَمُ، وَأَسْتَغْفِرُكَ لِمَا لَا أَعْلَمُ",
    translit:"Allāhumma innī a'ūdhu bika an ushrika bika wa anā a'lam, wa astaghfiruka limā lā a'lam.",
    translation:"O Allah, I seek refuge in You lest I associate anything with You knowingly, and I seek Your forgiveness for what I know not.",
    reference:"Hisn al-Muslim 203 (Ahmad 4/403) — graded good by Al-Albani" },

  'other-childrens-protection':{ title:"Protection for Children", subtitle:"Placing children under Allah's protection", icon:'shield',
    arabic:"أُعِيذُكُمَا بِكَلِمَاتِ اللَّهِ التَّامَّةِ مِنْ كُلِّ شَيْطَانٍ وَهَامَّةٍ، وَمِنْ كُلِّ عَيْنٍ لَامَّةٍ",
    translit:"U'īdhukumā bikalimāti-llāhit-tāmmati min kulli shayṭānin wa hāmmah, wa min kulli 'aynin lāmmah.",
    translation:"I seek protection for you both in the Perfect Words of Allah, from every devil and every beast, and from every envious, harmful eye.",
    reference:"Hisn al-Muslim 146 (Al-Bukhari 4/119) — the Prophet ﷺ would say this over Al-Hasan and Al-Husain" },

  'other-ward-off-devils':{ title:"Warding off the Rebellious Devils", subtitle:"To ward off the plot of the rebellious devils", icon:'shield',
    arabic:"أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ الَّتِي لَا يُجَاوِزُهُنَّ بَرٌّ وَلَا فَاجِرٌ مِنْ شَرِّ مَا خَلَقَ، وَبَرَأَ وَذَرَأَ، وَمِنْ شَرِّ مَا يَنْزِلُ مِنَ السَّمَاءِ، وَمِنْ شَرِّ مَا يَعْرُجُ فِيهَا، وَمِنْ شَرِّ مَا ذَرَأَ فِي الْأَرْضِ، وَمِنْ شَرِّ مَا يَخْرُجُ مِنْهَا، وَمِنْ شَرِّ فِتَنِ اللَّيْلِ وَالنَّهَارِ، وَمِنْ شَرِّ كُلِّ طَارِقٍ إِلَّا طَارِقًا يَطْرُقُ بِخَيْرٍ يَا رَحْمَٰنُ",
    translit:"A'ūdhu bikalimāti-llāhit-tāmmāti llatī lā yujāwizuhunna barrun wa lā fājirun min sharri mā khalaq, wa bara'a wa dhara', wa min sharri mā yanzilu minas-samā', wa min sharri mā ya'ruju fīhā, wa min sharri mā dhara'a fil-arḍ, wa min sharri mā yakhruju minhā, wa min sharri fitani l-layli wan-nahār, wa min sharri kulli ṭāriqin illā ṭāriqan yaṭruqu bikhayr yā Raḥmān.",
    translation:"I seek refuge in the Perfect Words of Allah — which neither the upright nor the corrupt may overcome — from the evil of what He created, of what He made and scattered, from the evil of what descends from the sky and what rises to it, from the evil of what He scattered in the earth and what emerges from it, from the evil trials of night and day, and from the evil of every visitor by night, except the visitor who brings good. O Most Merciful.",
    reference:"Hisn al-Muslim 247 (Ahmad 3/419, Ibn As-Sunni 637) — chain graded authentic by Al-Arna'ut" },

  // ============ Distress & Difficult Times ============
  'other-distress-1':{ title:"None Worthy of Worship but Allah", subtitle:"For one in distress", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ",
    translit:"Lā ilāha illallāhu l-'Aẓīmu l-Ḥalīm, lā ilāha illallāhu Rabbu l-'Arshi l-'Aẓīm, lā ilāha illallāhu Rabbu s-samāwāti wa Rabbu l-arḍi wa Rabbu l-'Arshi l-Karīm.",
    translation:"There is none worthy of worship but Allah, the Mighty, the Forbearing. There is none worthy of worship but Allah, Lord of the Magnificent Throne. There is none worthy of worship but Allah, Lord of the heavens, Lord of the earth, and Lord of the Noble Throne.",
    reference:"Hisn al-Muslim 122 (Al-Bukhari 8/154, Muslim 4/2092)" },

  'other-distress-2':{ title:"Do Not Leave Me to Myself", subtitle:"For one in distress", icon:'star',
    arabic:"اللَّهُمَّ رَحْمَتَكَ أَرْجُو فَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ، وَأَصْلِحْ لِي شَأْنِي كُلَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ",
    translit:"Allāhumma raḥmataka arjū falā takilnī ilā nafsī ṭarfata 'ayn, wa aṣliḥ lī sha'nī kullah, lā ilāha illā ant.",
    translation:"O Allah, I hope for Your mercy. Do not leave me to myself even for the blink of an eye. Correct all of my affairs for me. There is none worthy of worship but You.",
    reference:"Hisn al-Muslim 123 (Abu Dawud 4/324, Ahmad 5/42) — graded good by Al-Albani" },

  'other-distress-3':{ title:"Glory Be to You, I Was of the Wrongdoers", subtitle:"For one in distress — the du'a of Yunus", icon:'star',
    isPointer:true, pointerNote:"This is the same du'a of Yunus (peace be upon him) found in the Qur'anic Du'a section — recited here specifically at a moment of personal distress or hardship.",
    reference:"Hisn al-Muslim 124 (At-Tirmidhi 5/529, Al-Hakim, graded authentic by Adh-Dhahabi)" },

  'other-distress-4':{ title:"Allah is My Lord", subtitle:"For one in distress", icon:'star',
    arabic:"اللَّهُ اللَّهُ رَبِّي لَا أُشْرِكُ بِهِ شَيْئًا",
    translit:"Allāh, Allāhu Rabbī lā ushriku bihi shay'ā.",
    translation:"Allah, Allah is my Lord. I do not associate anything with Him.",
    reference:"Hisn al-Muslim 125 (Abu Dawud 2/87) — graded authentic by Al-Albani" },

  'other-enemy-1':{ title:"Restrain Them by Their Necks", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"اللَّهُمَّ إِنَّا نَجْعَلُكَ فِي نُحُورِهِمْ، وَنَعُوذُ بِكَ مِنْ شُرُورِهِمْ",
    translit:"Allāhumma innā naj'aluka fī nuḥūrihim, wa na'ūdhu bika min shurūrihim.",
    translation:"O Allah, we ask You to restrain them by their necks, and we seek refuge in You from their evil.",
    reference:"Hisn al-Muslim 126 (Abu Dawud 2/89) — graded authentic by Al-Hakim and Adh-Dhahabi" },

  'other-enemy-2':{ title:"You Are My Strength", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"اللَّهُمَّ أَنْتَ عَضُدِي وَأَنْتَ نَصِيرِي، بِكَ أَجُولُ وَبِكَ أَصُولُ وَبِكَ أُقَاتِلُ",
    translit:"Allāhumma anta 'aḍudī, wa anta naṣīrī, bika ajūlu, wa bika aṣūlu, wa bika uqātil.",
    translation:"O Allah, You are my strength and You are my support. For Your sake I go forth, for Your sake I advance, and for Your sake I fight.",
    reference:"Hisn al-Muslim 127 (Abu Dawud 3/42, At-Tirmidhi 5/572) — graded authentic by Al-Albani" },

  'other-enemy-3':{ title:"Allah is Sufficient for Us", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
    translit:"Ḥasbunallāhu wa ni'ma l-wakīl.",
    translation:"Allah is sufficient for us, and He is the best Disposer of affairs.",
    reference:"Hisn al-Muslim 128 (Al-Bukhari 5/172) — the words of Ibrahim (peace be upon him) when cast into the fire" },

  'other-affairs-difficult':{ title:"There is No Ease Except What You Make Easy", subtitle:"When affairs become difficult", icon:'star',
    arabic:"اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزْنَ إِذَا شِئْتَ سَهْلًا",
    translit:"Allāhumma lā sahla illā mā ja'altahu sahlā, wa anta taj'alu l-ḥazna idhā shi'ta sahlā.",
    translation:"O Allah, there is no ease except in what You have made easy, and You make sorrow easy if You wish.",
    reference:"Hisn al-Muslim 139 (Ibn Hibban 2427, Ibn As-Sunni 351) — graded authentic by Ibn Hajar" },

  // ============ Travel ============
  'other-travel':{ title:"Du'a for Travel", subtitle:"Recited when setting out, and upon returning", icon:'clouds',
    arabic:"اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ. سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ، وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ. اللَّهُمَّ إِنَّا نَسْأَلُكَ فِي سَفَرِنَا هَذَا الْبِرَّ وَالتَّقْوَى، وَمِنَ الْعَمَلِ مَا تَرْضَى. اللَّهُمَّ هَوِّنْ عَلَيْنَا سَفَرَنَا هَذَا وَاطْوِ عَنَّا بُعْدَهُ. اللَّهُمَّ أَنْتَ الصَّاحِبُ فِي السَّفَرِ، وَالْخَلِيفَةُ فِي الْأَهْلِ. اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ وَعْثَاءِ السَّفَرِ، وَكَآبَةِ الْمَنْظَرِ، وَسُوءِ الْمُنْقَلَبِ فِي الْمَالِ وَالْأَهْلِ",
    translit:"Allāhu Akbar, Allāhu Akbar, Allāhu Akbar. Subḥāna lladhī sakhkhara lanā hādhā wa mā kunnā lahu muqrinīn, wa innā ilā Rabbinā lamunqalibūn. Allāhumma innā nas'aluka fī safarinā hādha l-birra wat-taqwā, wa mina l-'amali mā tarḍā. Allāhumma hawwin 'alaynā safaranā hādhā waṭwi 'annā bu'dah. Allāhumma anta ṣ-ṣāḥibu fis-safar, wal-khalīfatu fil-ahl. Allāhumma innī a'ūdhu bika min wa'thā'is-safar, wa ka'ābati l-manẓar, wa sū'il-munqalabi fil-māli wal-ahl.",
    translation:"Allah is the Greatest, Allah is the Greatest, Allah is the Greatest. Glory to Him who has subjected this to us, for we could never have accomplished it by ourselves. Surely to our Lord we are returning. O Allah, we ask You for righteousness and piety on this journey of ours, and for deeds that please You. O Allah, lighten this journey for us and make its distance easy. O Allah, You are our Companion on the road and the Guardian of our family. O Allah, I seek refuge in You from the hardships of travel, from a distressing sight, and from finding our family and property in misfortune upon returning. (Upon returning, repeat the same, adding: We return, repentant, worshipping, and praising our Lord.)",
    reference:"Hisn al-Muslim 207 (Muslim 2/978)" },

  // ============ Daily Life & Nature ============
  'other-thunder':{ title:"Upon Hearing Thunder", subtitle:"Glorifying Allah, Whom thunder and angels glorify", icon:'clouds',
    arabic:"سُبْحَانَ الَّذِي يُسَبِّحُ الرَّعْدُ بِحَمْدِهِ وَالْمَلَائِكَةُ مِنْ خِيفَتِهِ",
    translit:"Subḥāna lladhī yusabbiḥu r-ra'du biḥamdihi wal-malā'ikatu min khīfatih.",
    translation:"Glory is to Him Whom thunder glorifies with praise, and the angels too, out of fear of Him.",
    reference:"Al-Muwatta 2/992 — the practice of Abdullah ibn az-Zubayr (RA), who would pause his conversation upon hearing thunder to recite this" },

  'other-rain-beneficial':{ title:"A Beneficial Downpour", subtitle:"When it begins to rain", icon:'clouds',
    arabic:"اللَّهُمَّ صَيِّبًا نَافِعًا",
    translit:"Allāhumma ṣayyiban nāfi'ā.",
    translation:"O Allah, (let it be) a beneficial rain cloud.",
    reference:"Hisn al-Muslim (Al-Bukhari 1/205, Muslim 1/83)" },

  'other-crescent-moon':{ title:"Upon Sighting the Crescent Moon", subtitle:"At the start of a new month", icon:'moon',
    arabic:"اللَّهُ أَكْبَرُ. اللَّهُمَّ أَهِلَّهُ عَلَيْنَا بِالْأَمْنِ وَالْإِيمَانِ، وَالسَّلَامَةِ وَالْإِسْلَامِ، وَالتَّوْفِيقِ لِمَا تُحِبُّ رَبَّنَا وَتَرْضَى. رَبُّنَا وَرَبُّكَ اللَّهُ",
    translit:"Allāhu Akbar. Allāhumma ahillahu 'alaynā bil-amni wal-īmān, was-salāmati wal-Islām, wat-tawfīqi limā tuḥibbu Rabbanā wa tarḍā. Rabbunā wa Rabbukallāh.",
    translation:"Allah is the Greatest. O Allah, bring this new moon upon us with security and faith, with peace and in Islam, and with guidance to that which You love and are pleased with. Our Lord and your Lord is Allah.",
    reference:"Hisn al-Muslim 175 (At-Tirmidhi 5/504, Ad-Darimi 1/336) — graded authentic by Al-Albani" },

  'other-sneezing':{ title:"Upon Sneezing", subtitle:"The exchange between the one who sneezes and those nearby", icon:'star',
    arabic:"الْحَمْدُ لِلَّهِ ← يَرْحَمُكَ اللَّهُ ← يَهْدِيكُمُ اللَّهُ وَيُصْلِحُ بَالَكُمْ",
    translit:"[Sneezer says:] Alḥamdulillāh. [Others reply:] Yarḥamukallāh. [Sneezer then says:] Yahdīkumullāhu wa yuṣliḥu bālakum.",
    translation:"[Sneezer:] Praise be to Allah. [Others:] May Allah have mercy on you. [Sneezer replies:] May Allah guide you and set right your affairs.",
    reference:"Al-Bukhari 6224, and Hisn al-Muslim Ch. 77 — an etiquette of mutual remembrance among Muslims" },

  'other-anger':{ title:"When Angry", subtitle:"Seeking refuge from Satan's provocation", icon:'shield',
    isPointer:true, pointerNote:"The same 'A'udhu billahi minash-shaytanir-rajim' found under Protection above — recited specifically to calm anger.",
    reference:"Hisn al-Muslim 193 (Al-Bukhari 7/99, Muslim 4/2015)" },

  'other-qunoot-witr':{ title:"Qunoot al-Witr", subtitle:"Recited in the third rak'ah of Witr prayer", icon:'mosque',
    arabic:"اللَّهُمَّ اهْدِنِي فِيمَنْ هَدَيْتَ، وَعَافِنِي فِيمَنْ عَافَيْتَ، وَتَوَلَّنِي فِيمَنْ تَوَلَّيْتَ، وَبَارِكْ لِي فِيمَا أَعْطَيْتَ، وَقِنِي شَرَّ مَا قَضَيْتَ، إِنَّكَ تَقْضِي وَلَا يُقْضَى عَلَيْكَ، وَإِنَّهُ لَا يَذِلُّ مَنْ وَالَيْتَ وَلَا يَعِزُّ مَنْ عَادَيْتَ، تَبَارَكْتَ رَبَّنَا وَتَعَالَيْتَ",
    translit:"Allāhumma-hdinī fīman hadayt, wa 'āfinī fīman 'āfayt, wa tawallanī fīman tawallayt, wa bārik lī fīmā a'ṭayt, wa qinī sharra mā qaḍayt, innaka taqḍī wa lā yuqḍā 'alayk, wa innahu lā yadhillu man wālayt, wa lā ya'izzu man 'ādayt, tabārakta Rabbanā wa ta'ālayt.",
    translation:"O Allah, guide me among those You have guided, pardon me among those You have pardoned, take me into Your care among those You have taken into Your care, bless me in what You have granted, and protect me from the evil You have decreed. Indeed You decree, and none decrees over You. He whom You befriend is not humiliated, nor is he honoured whom You oppose. Blessed are You, our Lord, and Exalted.",
    reference:"Hisn al-Muslim (Sunan Abi Dawud 1425) — taught by the Prophet ﷺ to his grandson Al-Hasan ibn Ali" },

  // ============ Family & Life Events ============
  'other-visiting-sick-1':{ title:"It Will Be a Purification", subtitle:"When visiting the sick", icon:'star',
    arabic:"لَا بَأْسَ طَهُورٌ إِنْ شَاءَ اللَّهُ",
    translit:"Lā ba'sa ṭahūrun in shā'allāh.",
    translation:"Do not worry, it will be a purification for you, Allah willing.",
    reference:"Hisn al-Muslim 147 (Al-Bukhari 10/118)" },

  'other-visiting-sick-2':{ title:"I Ask Allah to Heal You", subtitle:"When visiting the sick — recite seven times", icon:'star',
    arabic:"أَسْأَلُ اللَّهَ الْعَظِيمَ رَبَّ الْعَرْشِ الْعَظِيمِ أَنْ يَشْفِيَكَ",
    translit:"As'alullāha l-'Aẓīma Rabba l-'Arshi l-'Aẓīmi an yashfiyak. (×7)",
    translation:"I ask Almighty Allah, Lord of the Magnificent Throne, to heal you.",
    reference:"Hisn al-Muslim 148 (At-Tirmidhi, Abu Dawud) — recite seven times, graded authentic by Al-Albani" },

  'other-condolence':{ title:"Words of Condolence", subtitle:"To offer comfort after a loss", icon:'people',
    arabic:"إِنَّ لِلَّهِ مَا أَخَذَ، وَلَهُ مَا أَعْطَى، وَكُلُّ شَيْءٍ عِنْدَهُ بِأَجَلٍ مُسَمًّى، فَلْتَصْبِرْ وَلْتَحْتَسِبْ",
    translit:"Inna lillāhi mā akhadh, wa lahu mā a'ṭā, wa kullu shay'in 'indahu bi-ajalin musammā, faltaṣbir wal-taḥtasib.",
    translation:"Surely to Allah belongs what He takes, and to Him belongs what He gives; everything with Him has an appointed time. So be patient and seek reward.",
    reference:"Hisn al-Muslim 162 (Al-Bukhari 2/80, Muslim 2/636)" },

  // ============ PRAYER BENEFITS & PROTECTIONS ============
  // ==> CONNECT: starter set of fully-verified hadith (Arabic checked
  // directly against sunnah.com). Scoped to the entries the site owner
  // asked to prioritise per prayer, plus the universal one. Continuable
  // to 20-30 per prayer in a future data-build session using the same
  // sourcing method (Tier 1/2 sources only, grade always shown).
  'pb-fajr-protection':{ title:"Fajr: Under Allah's Protection", subtitle:"Sahih Muslim 657a", icon:'shield',
    arabic:"مَنْ صَلَّى الصُّبْحَ فَهُوَ فِي ذِمَّةِ اللَّهِ فَلاَ يَطْلُبَنَّكُمُ اللَّهُ مِنْ ذِمَّتِهِ بِشَىْءٍ فَيُدْرِكَهُ فَيَكُبَّهُ فِي نَارِ جَهَنَّمَ",
    translit:"Man ṣallā aṣ-ṣubḥa fahuwa fī dhimmatillāh, falā yaṭlubannakumullāhu min dhimmatihī bishay'in fayudrikahū fayakubbahū fī nāri jahannam.",
    translation:"Whoever prays the morning (Fajr) prayer is under the protection of Allah — so do not violate that protection in any way, for whoever does, Allah will seize him and throw him down on his face into the Fire of Hell.",
    reference:"Sahih Muslim 657a — Grade: Sahih (authentic)" },

  'pb-fajr-asr-jannah':{ title:"Fajr + Asr → Paradise", subtitle:"Sahih al-Bukhari 574", icon:'star',
    arabic:"مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ",
    translit:"Man ṣallā al-bardayni dakhala al-jannah.",
    translation:"Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.",
    reference:"Sahih al-Bukhari 574 — Grade: Sahih (agreed upon)" },

  'pb-fajr-angels':{ title:"Fajr & Asr: Witnessed by Angels", subtitle:"Sahih al-Bukhari 555", icon:'people',
    arabic:"يَتَعَاقَبُونَ فِيكُمْ مَلاَئِكَةٌ بِاللَّيْلِ وَمَلاَئِكَةٌ بِالنَّهَارِ، وَيَجْتَمِعُونَ فِي صَلاَةِ الْفَجْرِ وَصَلاَةِ الْعَصْرِ",
    translit:"Yata'āqabūna fīkum malā'ikatun bil-layli wa malā'ikatun bin-nahār, wa yajtami'ūna fī ṣalāti al-fajri wa ṣalāti al-'aṣr.",
    translation:"Angels come to you in succession by night and by day, and they gather together at the Fajr and Asr prayers.",
    reference:"Sahih al-Bukhari 555 — Grade: Sahih" },

  'pb-dhuhr-fire':{ title:"Dhuhr: 4 Before + 4 After → Protection from the Fire", subtitle:"Sunan at-Tirmidhi 428", icon:'shield',
    arabic:"مَنْ حَافَظَ عَلَى أَرْبَعِ رَكَعَاتٍ قَبْلَ الظُّهْرِ وَأَرْبَعٍ بَعْدَهَا حَرَّمَهُ اللَّهُ عَلَى النَّارِ",
    translit:"Man ḥāfaẓa 'alā arba'i raka'ātin qabla aẓ-ẓuhri wa arba'in ba'dahā ḥarramahullāhu 'alan-nār.",
    translation:"Whoever preserves four rak'ahs before Dhuhr and four after it, Allah will forbid him from the Fire.",
    reference:"Sunan at-Tirmidhi 428 — Grade: Hasan Sahih" },

  'pb-asr-warning':{ title:"Asr: Severe Warning Against Abandoning It", subtitle:"Sahih al-Bukhari 553", icon:'shield',
    arabic:"مَنْ تَرَكَ صَلاَةَ الْعَصْرِ فَقَدْ حَبِطَ عَمَلُهُ",
    translit:"Man taraka ṣalāta al-'aṣri faqad ḥabiṭa 'amaluh.",
    translation:"Whoever leaves the Asr prayer, his deeds are nullified.",
    reference:"Sahih al-Bukhari 553 — Grade: Sahih" },

  'pb-maghrib-house':{ title:"Maghrib: Part of the Twelve Sunnah Rak'ahs", subtitle:"Jami' at-Tirmidhi 415", icon:'mosque',
    arabic:"مَنْ صَلَّى فِي يَوْمٍ وَلَيْلَةٍ ثِنْتَىْ عَشْرَةَ رَكْعَةً بُنِيَ لَهُ بَيْتٌ فِي الْجَنَّةِ أَرْبَعًا قَبْلَ الظُّهْرِ وَرَكْعَتَيْنِ بَعْدَهَا وَرَكْعَتَيْنِ بَعْدَ الْمَغْرِبِ وَرَكْعَتَيْنِ بَعْدَ الْعِشَاءِ وَرَكْعَتَيْنِ قَبْلَ صَلاَةِ الْفَجْرِ",
    translit:"Man ṣallā fī yawmin wa laylatin thintay 'ashrata rak'atan buniya lahu baytun fī al-jannah...",
    translation:"Whoever prays twelve rak'ahs in a day and night — four before Dhuhr and two after, two after Maghrib, two after Isha, and two before Fajr — a house will be built for him in Paradise.",
    reference:"Jami' at-Tirmidhi 415 — Grade: Hasan Sahih" },

  'pb-isha-half-night':{ title:"Isha in Congregation → Half a Night's Worship", subtitle:"Sahih Muslim 656 / Tirmidhi 221", icon:'moon',
    arabic:"مَنْ شَهِدَ الْعِشَاءَ فِي جَمَاعَةٍ كَانَ لَهُ قِيَامُ نِصْفِ لَيْلَةٍ",
    translit:"Man shahida al-'ishā'a fī jamā'atin kāna lahu qiyāmu niṣfi laylah.",
    translation:"Whoever attends Isha in congregation, it is as if he had stood half the night in prayer.",
    reference:"Sahih Muslim 656 / Jami' at-Tirmidhi 221 — Grade: Sahih" },

  'pb-isha-fajr-whole-night':{ title:"Isha + Fajr in Congregation → a Whole Night's Worship", subtitle:"Sahih Muslim 656 / Tirmidhi 221", icon:'moonstars',
    arabic:"وَمَنْ صَلَّى الْعِشَاءَ وَالْفَجْرَ فِي جَمَاعَةٍ كَانَ لَهُ كَقِيَامِ لَيْلَةٍ",
    translit:"Wa man ṣallā al-'ishā'a wal-fajra fī jamā'atin kāna lahu ka qiyāmi laylah.",
    translation:"And whoever prays Isha and Fajr in congregation, it is as if he had stood the whole night in prayer.",
    reference:"Sahih Muslim 656 / Jami' at-Tirmidhi 221 — Grade: Sahih" },

  'pb-isha-hypocrites':{ title:"Isha & Fajr: Immense Reward Despite the Difficulty", subtitle:"Sahih al-Bukhari 657 / Muslim 651", icon:'star',
    arabic:"لَيْسَ صَلاَةٌ أَثْقَلَ عَلَى الْمُنَافِقِينَ مِنَ الْفَجْرِ وَالْعِشَاءِ، وَلَوْ يَعْلَمُونَ مَا فِيهِمَا لأَتَوْهُمَا وَلَوْ حَبْوًا",
    translit:"Laysa ṣalātun athqalu 'alal-munāfiqīna minal-fajri wal-'ishā'i, wa law ya'lamūna mā fīhimā la'atawhumā wa law ḥabwā.",
    translation:"No prayer is heavier upon the hypocrites than Fajr and Isha; if they knew what reward is in them, they would come to them even if they had to crawl.",
    reference:"Sahih al-Bukhari 657 / Sahih Muslim 651 — Grade: Muttafaqun Alayhi (agreed upon)" },

  'pb-universal-expiate':{ title:"All Five Prayers Erase Sins Between Them", subtitle:"Sahih Muslim 233a", icon:'shield',
    arabic:"الصَّلَوَاتُ الْخَمْسُ، وَالْجُمُعَةُ إِلَى الْجُمُعَةِ، وَرَمَضَانُ إِلَى رَمَضَانَ، مُكَفِّرَاتٌ مَا بَيْنَهُنَّ إِذَا اجْتَنَبَ الْكَبَائِرَ",
    translit:"Aṣ-ṣalawātu al-khamsu, wal-jumu'atu ilā al-jumu'ah, wa ramaḍānu ilā ramaḍān, mukaffirātun mā baynahunna idhā ijtanaba al-kabā'ir.",
    translation:"The five daily prayers, one Friday prayer to the next, and one Ramadan to the next, are expiation for whatever comes between them, so long as major sins are avoided.",
    reference:"Sahih Muslim 233a — Grade: Sahih" },

  // ---- continued data-build (batch 2) ----
  'pb-fajr-two-rakat':{ title:"Fajr: The Two Sunnah Rak'ahs Are Better Than the World", subtitle:"Sahih Muslim 725a", icon:'star',
    arabic:"رَكْعَتَا الْفَجْرِ خَيْرٌ مِنْ الدُّنْيَا وَمَا فِيهَا",
    translit:"Rak'atā al-fajri khayrun min ad-dunyā wa mā fīhā.",
    translation:"The two rak'ahs before Fajr are better than this world and everything in it.",
    reference:"Sahih Muslim 725a — Grade: Sahih" },

  'pb-dhuhr-gates-heaven':{ title:"Dhuhr: An Hour When the Gates of Heaven Open", subtitle:"Sunan Ibn Majah 1157", icon:'shield',
    arabic:"إِنَّ أَبْوَابَ السَّمَاءِ تُفْتَحُ إِذَا زَالَتِ الشَّمْسُ",
    translit:"Inna abwāba as-samā'i tuftaḥu idhā zālati ash-shams.",
    translation:"The gates of heaven are opened when the sun passes its zenith — the Prophet ﷺ used this time before Dhuhr, saying he loved for his good deeds to rise up in that hour.",
    reference:"Sunan Ibn Majah 1157 — Grade: Hasan (Al-Albani, Sahih al-Jami)" },

  'pb-asr-lost-family':{ title:"Asr: Missing It Is Like Losing Family and Wealth", subtitle:"Sahih al-Bukhari 552 / Muslim 626", icon:'shield',
    arabic:"الَّذِي تَفُوتُهُ صَلاَةُ الْعَصْرِ كَأَنَّمَا وُتِرَ أَهْلَهُ وَمَالَهُ",
    translit:"Alladhī tafūtuhu ṣalātu al-'aṣri ka'annamā wutira ahlahu wa mālah.",
    translation:"Whoever misses the Asr prayer, it is as if he had lost his family and his wealth.",
    reference:"Sahih al-Bukhari 552 / Sahih Muslim 626 — Grade: Muttafaqun Alayhi (agreed upon)" },

  'pb-asr-four-before':{ title:"Asr: A Prophetic Supplication for Whoever Prays Four Before It", subtitle:"Jami' at-Tirmidhi 430", icon:'star',
    arabic:"رَحِمَ اللَّهُ امْرَأً صَلَّى قَبْلَ الْعَصْرِ أَرْبَعًا",
    translit:"Raḥima Allāhu imra'an ṣallā qabla al-'aṣri arba'an.",
    translation:"May Allah have mercy on a person who prays four rak'ahs before Asr.",
    reference:"Jami' at-Tirmidhi 430 — Grade: Hasan" }

};

/* ============================================================
   OFFLINE SYNC :: Cache categories and guides to IndexedDB
   for offline access to Dua/Dhikr and Guides
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


window.CATEGORIES = [
  {id:'morning', title:"Morning", icon:'sun', theme:'theme-morning', light:false,
    desc:"Adhkar to start your day with light and protection.",
    items:['morning-dhikr','ayat-al-kursi','sayyidul-istighfar','morning-wellbeing','morning-sufficient','three-quls','hundred-hasanat','two-light-words','four-witnesses-morning','fitrah-morning','blessing-from-you','afw-afiyah','witness-unseen-seen','bismillah-protection','ya-hayyu-ya-qayyum','khayra-hadhal-yawm','subhanallahi-hundred','subhanallahi-extended']},
  {id:'evening', title:"Evening", icon:'moon', theme:'theme-evening', light:true,
    desc:"Adhkar to close the day and seek Allah's protection through the night.",
    items:['evening-dhikr','evening-protection','evening-pleased','ayat-al-kursi','three-quls','hundred-hasanat','two-light-words','four-witnesses-evening','afw-afiyah','witness-unseen-seen','bismillah-protection','ya-hayyu-ya-qayyum','subhanallahi-hundred','subhanallahi-extended']},
  {id:'salah', title:"Salah and After Salah", icon:'mosque', theme:'theme-salah', light:false,
    desc:"Remembrance to say after completing each obligatory prayer.",
    items:['tasbih-33','dua-after-salah','ayat-al-kursi-salah','three-quls','istikhara',
      'pb-fajr-protection','pb-fajr-asr-jannah','pb-fajr-angels','pb-fajr-two-rakat',
      'pb-dhuhr-fire','pb-dhuhr-gates-heaven',
      'pb-asr-warning','pb-asr-lost-family','pb-asr-four-before',
      'pb-maghrib-house','pb-isha-half-night','pb-isha-fajr-whole-night','pb-isha-hypocrites','pb-universal-expiate']},
  {id:'sleep', title:"Before Sleep and Tahajjud", icon:'moonstars', theme:'theme-sleep', light:true,
    desc:"Du'as and Surahs to recite before sleep and during the blessed hours of the night.",
    items:['sajdah-mulk','ayat-al-kursi-sleep','last-two-baqarah','al-kafirun','three-quls','tasbih-fatima','mercy-protection','sleep-soul','sleep-punishment']},
  {id:'praise', title:"Praise of Allah and Salawat", icon:'allah', theme:'theme-praise', light:false,
    desc:"Words that magnify and praise Allah, and blessings upon the Prophet ﷺ.",
    items:['salawat','salawat-short','salawat-tenfold','subhanallah-bihamdihi','subhanallah-adad']},
  {id:'qurandua', title:"Qur'anic Du'a and Sunnah Du'a", icon:'bookstand', theme:'theme-qurandua', light:false,
    desc:"Supplications drawn directly from the Qur'an and the Sunnah.",
    items:['rabbana-atina','rabbi-zidni-ilma','rabbana-la-tuzigh','rabbana-zulm','rabbana-afrigh','rabbi-ishrah','rabbi-inni-lima','yunus-la-ilaha']},
  {id:'istighfar', title:"Istighfar and Dhikr for All Times", icon:'tasbih', theme:'theme-istighfar', light:false,
    desc:"Short remembrance to keep your tongue moist with the mention of Allah.",
    items:['astaghfirullah','la-ilaha-illallah','sayyidul-istighfar','rabbighfir-tub','astaghfirullah-full','subhanallah-general']},
  {id:'ummah', title:"Du'as for the Ummah", icon:'people', theme:'theme-ummah', light:false,
    desc:"Supplications for the wellbeing and unity of the Muslim community.",
    items:['dua-ummah','dua-ibrahim-descendants','rabbana-ighfir-lana','dua-victory-islam']},
  {id:'names', title:"The 99 Names of Allah", icon:'clouds', theme:'theme-names', light:false, wide:true,
    desc:"The complete 99 beautiful names of Allah, with meaning and reflection.",
    items:['name-ar-rahman','name-ar-raheem','name-al-malik','name-al-quddus','name-as-salam','name-al-mumin','name-al-muhaymin','name-al-aziz','name-al-jabbar','name-al-mutakabbir','name-al-khaliq','name-al-bari','name-al-musawwir','name-al-ghaffar','name-al-qahhar','name-al-wahhab','name-ar-razzaq','name-al-fattah','name-al-alim','name-al-qabid','name-al-basit','name-al-khafid','name-ar-rafi','name-al-muizz','name-al-mudhill','name-as-sami','name-al-basir','name-al-hakam','name-al-adl','name-al-latif','name-al-khabir','name-al-halim','name-al-azim','name-al-ghafur','name-ash-shakur','name-al-aliyy','name-al-kabir','name-al-hafiz','name-al-muqit','name-al-hasib','name-al-jalil','name-al-karim','name-ar-raqib','name-al-mujib','name-al-wasi','name-al-hakim','name-al-wadud','name-al-majid','name-al-baith','name-ash-shahid','name-al-haqq','name-al-wakil','name-al-qawiyy','name-al-matin','name-al-waliyy','name-al-hamid','name-al-muhsi','name-al-mubdi','name-al-muid','name-al-muhyi','name-al-mumit','name-al-hayy','name-al-qayyum','name-al-wajid','name-al-majid-2','name-al-wahid','name-as-samad','name-al-qadir','name-al-muqtadir','name-al-muqaddim','name-al-muakhkhir','name-al-awwal','name-al-akhir','name-az-zahir','name-al-batin','name-al-wali','name-al-mutaali','name-al-barr','name-at-tawwab','name-al-muntaqim','name-al-afuw','name-ar-rauf','name-al-muqsit','name-al-jami','name-al-ghaniyy','name-al-mughni','name-al-mani','name-ad-darr','name-an-nafi','name-an-nur','name-al-hadi','name-al-badi','name-al-baqi','name-al-warith','name-ar-rashid','name-as-sabur','name-malik-ul-mulk','name-dhul-jalal','name-al-muhsin']},
  {id:'other', title:"Other Beneficial Supplications", icon:'clouds', theme:'theme-other', light:false, wide:true,
    desc:"Du'as and dhikr for situations outside the categories above — including protection, travel, and life events.",
    items:['other-expel-devil','other-fear-shirk','other-childrens-protection','other-ward-off-devils','other-distress-1','other-distress-2','other-distress-3','other-distress-4','other-enemy-1','other-enemy-2','other-enemy-3','other-affairs-difficult','other-travel','other-thunder','other-rain-beneficial','other-crescent-moon','other-sneezing','other-anger','other-qunoot-witr','other-visiting-sick-1','other-visiting-sick-2','other-condolence'],
    subGroups:[
      {label:"Protection & Ruqyah", items:['other-expel-devil','other-fear-shirk','other-childrens-protection','other-ward-off-devils']},
      {label:"Distress & Difficult Times", items:['other-distress-1','other-distress-2','other-distress-3','other-distress-4','other-enemy-1','other-enemy-2','other-enemy-3','other-affairs-difficult']},
      {label:"Travel", items:['other-travel']},
      {label:"Daily Life & Nature", items:['other-thunder','other-rain-beneficial','other-crescent-moon','other-sneezing','other-anger','other-qunoot-witr']},
      {label:"Family & Life Events", items:['other-visiting-sick-1','other-visiting-sick-2','other-condolence']}
    ]}
];


const TIPS = {
  morning:"Even one short dhikr said with presence outweighs many said in a rush.",
  evening:"Closing the day with remembrance settles the heart before rest.",
  salah:"A minute of tasbih after salah carries reward well beyond its length.",
  sleep:"Even a few minutes before sleep can be a source of immense reward.",
  praise:"Salawat upon the Prophet ﷺ is answered with ten blessings in return.",
  qurandua:"Praying in the Qur'an's own words is a Sunnah in itself.",
  istighfar:"A tongue busy with istighfar is rarely idle in heedlessness.",
  ummah:"Du'a for others is answered for the one who makes it too.",
  names:"Reflecting on a single Name slowly often reaches the heart more than reciting all 99 quickly."
};

/* ============================================================
   STATE
   ============================================================ */
const state = {
  selectedCategory:'sleep',
  selectedItem:'ayat-al-kursi',
  hasUserSelectedCategory:false,  // true once the user actually taps a category — used to suppress the active-border on the default pre-selected card
  favoritesMode:false,
  bookmarks:new Set(),           // fresh device starts empty; loaded from backend below
  audioPlaying:false,
  audioSpeed:1.0,
  muted:false,
  mobilePane:'categories'
};

function persistDua(){
  WWP.save('dua', { bookmarks: Array.from(state.bookmarks) });
}
async function loadDuaFromBackend(){
  const saved = await WWP.get('dua');
  if(saved && Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
}

/* ============================================================
   UI :: render
   ============================================================ */
function getCategory(id){ return CATEGORIES.find(c=>c.id===id); }

const DUA_TILE_ASPECT = {
  morning:700/574, evening:700/574, salah:700/574, sleep:700/574,
  praise:700/574, qurandua:700/574, istighfar:700/573, ummah:700/574,
  names:1689/453, other:1709/609
};
function renderCategories(){
  const grid = $('#catGrid'); grid.innerHTML='';
  CATEGORIES.forEach((cat,i)=>{
    const card = document.createElement('div');
    const isFull = !!cat.wide;
    card.className = `cat-card cat-card-art ${state.hasUserSelectedCategory && state.selectedCategory===cat.id && !state.favoritesMode?'active':''} ${isFull?'full':''}`;
    // Tile art has its title baked into the image at a fixed spot, so the
    // card box must match that image's aspect ratio or object-fit:cover
    // crops straight through the words. Wide tiles also have their title
    // anchored to the left, so bias the crop to eat into the empty right
    // side of the art rather than the text.
    const ratio = DUA_TILE_ASPECT[cat.id];
    if(ratio) card.style.aspectRatio = String(ratio);
    card.innerHTML = `
      <div class="cat-scene-wrap"><img src="${DUA_TILE_IMAGES[cat.id]}" alt="${cat.title}" loading="lazy" style="${isFull?'object-position:left center;':''}"></div>
    `;
    card.addEventListener('click', ()=> selectCategory(cat.id));
    grid.appendChild(card);
  });
}

function renderItemsPane(){
  const fav = state.favoritesMode;
  const cat = getCategory(state.selectedCategory);
  $('#itemsHeadTitle').textContent = fav ? 'My Favourites' : "Du'a & Dhikr";
  $('#catFavToggle').classList.toggle('saved', fav);

  const banner = $('#catBanner');
  if(fav){
    banner.innerHTML = `
      <div class="cat-banner">
        <div class="banner-scene">${sceneSvg('praise')}</div>
        <div class="banner-scrim"></div>
        <div class="banner-content">
          <h2>My Favourites</h2>
          <p>Everything you've bookmarked, in one place.</p>
          <span class="item-count">${state.bookmarks.size} item${state.bookmarks.size===1?'':'s'}</span>
        </div>
      </div>`;
  } else {
    banner.innerHTML = `
      <div class="cat-banner cat-banner-art">
        <div class="banner-scene"><img src="${DUA_BANNER_IMAGES[cat.id]}" alt="${cat.title}"></div>
        <div class="banner-content banner-content-art">
          <p>${cat.desc}</p>
          <span class="item-count">${cat.items.length} item${cat.items.length===1?'':'s'}</span>
        </div>
      </div>`;
  }

  const list = $('#itemList'); list.innerHTML='';
  const ids = fav ? Array.from(state.bookmarks) : cat.items;
  if(ids.length===0){
    list.innerHTML = `<div class="empty-state">${iconSvg('heart',30)}<div>No favourites yet — tap the bookmark icon on any du'a to save it here.</div></div>`;
  }
  if(!fav && cat.subGroups && cat.subGroups.length){
    cat.subGroups.forEach(group=>{
      const header = document.createElement('div');
      header.className = 'item-subheader';
      header.textContent = group.label;
      list.appendChild(header);
      group.items.forEach(id=>{
        const item = ITEMS[id]; if(!item) return;
        list.appendChild(buildItemRow(id, item));
      });
    });
  } else {
    ids.forEach(id=>{
      const item = ITEMS[id]; if(!item) return;
      list.appendChild(buildItemRow(id, item));
    });
  }

  const tip = $('#tipCard');
  const tipText = TIPS[fav ? 'sleep' : cat.id] || "Consistency is key.";
  tip.innerHTML = `<span class="tip-icon">${iconSvg('shield',18)}</span><div><strong>Consistency is key</strong><p>${tipText}</p></div>`;
}

function buildItemRow(id, item){
  const row = document.createElement('div');
  row.className = 'item-row'+(state.selectedItem===id?' active':'');
  const isBm = state.bookmarks.has(id);
  row.innerHTML = `
    <span class="item-icon">${iconSvg(item.icon,16)}</span>
    <div class="item-body"><div class="item-title">${item.title}</div><div class="item-sub">${item.subtitle}</div></div>
    <div class="item-actions">
      <span class="item-bm ${isBm?'saved':''}" data-id="${id}">${iconSvg('star',0)}</span>
      <span class="item-chev"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg></span>
    </div>
  `;
  row.querySelector('.item-bm').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${isBm?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>`;
  row.querySelector('.item-bm').addEventListener('click', e=>{ e.stopPropagation(); toggleBookmark(id); });
  row.addEventListener('click', ()=> selectItem(id));
  return row;
}

function renderDetailPane(){
  const item = ITEMS[state.selectedItem];
  const body = $('#detailBody');
  const audioBar = $('#audioBar');
  const tipCallout = $('#tipCallout');

  if(!item){
    $('#detailHeadTitle').textContent = '—';
    body.innerHTML = `<div class="empty-state">${iconSvg('heart',30)}<div>Select a du'a or dhikr to read it here.</div></div>`;
    audioBar.innerHTML=''; tipCallout.innerHTML='';
    return;
  }

  $('#detailHeadTitle').textContent = item.title;
  const isBm = state.bookmarks.has(state.selectedItem);
  $('#detailBmBtn').classList.toggle('saved', isBm);

  if(item.isPointer){
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      <div class="pointer-box">
        ${iconSvg('book',26)}
        <p style="margin-top:10px;">${item.pointerNote}</p>
      </div>
    `;
  } else if(item.parts){
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      ${item.parts.map(p=>`
        <div class="dd-part">
          <div class="dd-part-label">${p.label}</div>
          <div class="dd-arabic" style="margin-bottom:10px;">${p.arabic}</div>
          <div class="dd-translit" style="margin-bottom:8px;">${p.translit}</div>
          <div class="dd-translation">${p.translation}</div>
        </div>
      `).join('')}
      <div class="ref-box"><span class="ref-icon">${iconSvg('bookstand',15)}</span><p>${item.reference}</p></div>
    `;
  } else {
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      <div class="dd-section"><div class="dd-section-label">Arabic</div><div class="dd-arabic">${item.arabic}</div></div>
      <div class="dd-section"><div class="dd-section-label">Transliteration</div><div class="dd-translit">${item.translit}</div></div>
      <div class="dd-section"><div class="dd-section-label">Translation</div><div class="dd-translation">${item.translation}</div></div>
      <div class="dd-section-label">Reference &amp; Source</div>
      <div class="ref-box"><span class="ref-icon">${iconSvg('bookstand',15)}</span><p>${item.reference}</p></div>
    `;
  }

  audioBar.innerHTML = '';
  tipCallout.innerHTML = '';
}

function renderAll(){
  renderCategories();
  renderItemsPane();
  renderDetailPane();
}

/* ============================================================
   Actions
   ============================================================ */
function selectCategory(id){
  state.selectedCategory = id;
  state.hasUserSelectedCategory = true;
  state.favoritesMode = false;
  const cat = getCategory(id);
  state.selectedItem = cat.items[0] || null;
  state.mobilePane = 'items';
  document.body.dataset.mobilePane = 'items';
  renderAll();
}

function selectItem(id){
  state.selectedItem = id;
  state.mobilePane = 'detail';
  document.body.dataset.mobilePane = 'detail';
  renderAll();
}

function stepItem(dir){
  const ids = state.favoritesMode ? Array.from(state.bookmarks) : getCategory(state.selectedCategory).items;
  const idx = ids.indexOf(state.selectedItem);
  if(idx===-1) return;
  const next = ids[idx+dir];
  if(next){ state.selectedItem = next; renderAll(); }
  else showToast(dir>0 ? "That's the last item in this list." : "That's the first item in this list.");
}

function toggleBookmark(id){
  if(state.bookmarks.has(id)){ state.bookmarks.delete(id); showToast('Removed from favourites'); }
  else { state.bookmarks.add(id); showToast('Saved to favourites'); }
  persistDua();
  renderAll();
}

function showFavorites(){
  state.favoritesMode = true;
  state.selectedItem = state.bookmarks.size ? Array.from(state.bookmarks)[0] : null;
  state.mobilePane = 'items';
  document.body.dataset.mobilePane = 'items';
  renderAll();
}

function setTheme(mode){
  const order=['light','sepia','dark'];
  const next = mode || order[(order.indexOf(document.body.getAttribute('data-theme'))+1)%order.length];
  document.body.setAttribute('data-theme', next);
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
// Auto-opens whichever of the first four categories (Morning, Evening,
// Salah and After Salah, Before Sleep and Tahajjud) best matches the
// time of day at the signed-in user's saved location — only runs for
// signed-in users with a saved location; everyone else keeps the
// existing static default.
async function applyTimeBasedCategory(){
  try{
    // Reuse the already-loaded Prayer Times store. The old implementation
    // made a second Aladhan request just to choose a Du'a category, even
    // though PrayerTimes had already fetched the same day's timings.
    let t = window.PrayerTimesAPI?.getState?.().timings || null;
    if(!t) return;

    const parse = (hhmm)=>{
      if(!hhmm) return null;
      const [h,m] = hhmm.split(' ')[0].split(':').map(Number);
      const dd = new Date(); dd.setHours(h,m,0,0); return dd;
    };

    const times = {
      Fajr: parse(t.Fajr), Dhuhr: parse(t.Dhuhr),
      Asr: parse(t.Asr), Maghrib: parse(t.Maghrib), Isha: parse(t.Isha)
    };

    const now = new Date();
    const WINDOW_MS = 30*60*1000; // within 30 min of a prayer counts as "at salah"

    const nearAnyPrayer = ['Fajr','Dhuhr','Asr','Maghrib','Isha'].some(p=>{
      const pt = times[p];
      return pt && Math.abs(now - pt) <= WINDOW_MS;
    });

    let category;
    if(nearAnyPrayer){
      category = 'salah';
    } else if(times.Isha && times.Fajr && (now >= times.Isha || now < times.Fajr)){
      category = 'sleep';
    } else if(times.Fajr && times.Dhuhr && now >= times.Fajr && now < times.Dhuhr){
      category = 'morning';
    } else if(times.Asr && times.Isha && now >= times.Asr && now < times.Isha){
      category = 'evening';
    } else if(times.Dhuhr && times.Asr && now >= times.Dhuhr && now < times.Asr){
      // Between Dhuhr and Asr — no dedicated midday category, lean
      // toward whichever adjacent window is closer in time.
      category = (times.Asr - now) < (now - times.Dhuhr) ? 'evening' : 'morning';
    }

    if(category){
      state.selectedCategory = category;
      const cat = getCategory(category);
      if(cat) state.selectedItem = cat.items[0] || null;
    }
  }catch(e){
    // Silent — keeps the existing static default category on any failure.
  }
}

async function init(){
  // Paint immediately with local defaults. Backend bookmarks hydrate after
  // the first frame, and the category resolver only runs when Du'a is the
  // page the user is actually viewing.
  renderAll();
  loadDuaFromBackend().then(renderAll).catch(()=>0);
  const hydrateCategory = ()=>applyTimeBasedCategory().then(()=>renderAll()).catch(()=>0);
  const duaPage = document.getElementById('page-dua');
  if(duaPage && !duaPage.classList.contains('hidden')) setTimeout(hydrateCategory, 0);
  document.addEventListener('wwp-page-shown', function(e){
    if(e.detail && e.detail.id === 'dua') setTimeout(hydrateCategory, 0);
  });

  $('#viewFavoritesBtn').addEventListener('click', showFavorites);
  $('#catFavToggle').addEventListener('click', showFavorites);

  $('#backToCategories').addEventListener('click', ()=>{ state.mobilePane='categories'; document.body.dataset.mobilePane='categories'; });
  $('#backToItems').addEventListener('click', ()=>{ state.mobilePane='items'; document.body.dataset.mobilePane='items'; });

  $('#detailBmBtn').addEventListener('click', ()=> toggleBookmark(state.selectedItem));
  $('#detailShareBtn').addEventListener('click', ()=>{
    const item = ITEMS[state.selectedItem];
    const text = `${item.title} — WhereWePraying?`;
    if(navigator.share){ navigator.share({title:"Du'a & Dhikr", text}).catch(()=>{}); }
    else { navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others')).catch(()=>showToast('Sharing is not available on this device')); }
  });
  $('#detailMoreBtn').addEventListener('click', ()=> showToast('More options — coming soon'));


  // ==> CONNECT: swap ITEMS/CATEGORIES for a verified, sourced content
  // API; wire the audio bar to a real reciter/audio source; link the
  // "Surah al-Sajdah & Surah al-Mulk" pointer through to the Qur'an
  // section once both are part of the same app shell.
}

// Cross-page deep link: lets other pages (e.g. the Qur'an page's
// "Explore more" shortcuts) jump straight to a specific category/item.
window.WWP_openDua = function(categoryId, itemId){
  if(categoryId) selectCategory(categoryId);
  if(itemId) selectItem(itemId);
  window.switchPage('dua');
};

init();

})();


/* ============================================================
   GUIDES SECTION
   ============================================================ */
(function(){
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
let __gToastTimer;
function showToast(msg){
  const t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  clearTimeout(__gToastTimer); __gToastTimer=setTimeout(()=>t.classList.remove('show'),2600);
}

const ICONS = {
  droplet:'<path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13Z"/>',
  pray:'<circle cx="12" cy="5" r="2.4"/><path d="M12 9v6M8 12l4-3 4 3M7 21l5-4 5 4M9 15l-3 3M15 15l3 3"/>',
  hand:'<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4a1.5 1.5 0 0 1 3 0v7M14 12V6a1.5 1.5 0 0 1 3 0v8"/><path d="M8 13c-1-1-3-1-3 1 0 4 3 8 8 8h1a6 6 0 0 0 6-6v-3"/>',
  shower:'<path d="M4 12a8 8 0 0 1 15.3-3.2"/><path d="M20 9h-3V6"/><path d="M8 16v2M12 16v3M16 16v2"/>',
  megaphone:'<path d="M3 11v2a2 2 0 0 0 2 2h1l3 5V9L6 9a2 2 0 0 0-2 2Z"/><path d="M9 9l10-5v16L9 15"/><path d="M19 10a3 3 0 0 1 0 4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6 6-2Z"/>',
  mosque:'<path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/><path d="M4 21v-6h4v6M16 21v-6h4v6"/><path d="M4 21h16"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  star:'<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 7.6 9.4 7Z"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  home:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  utensils:'<path d="M7 3v7a2 2 0 0 0 4 0V3"/><path d="M9 10v11"/><path d="M17 3c-2 0-3 2.5-3 5.5S15 14 17 14v7"/>'
};
function iconSvg(name, size){ size = size||14; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.star}</svg>`; }

/* ============================================================
   DATA :: original plain-English step descriptions. The overall
   sequence shown is the commonly taught one — exact order and a
   few details vary between schools of thought (madhabs), noted
   per guide where it matters.
   ==> CONNECT: replace with a scholar-reviewed content source.
   ============================================================ */
const GUIDES = [
  { id:'wudu', title:'Wudu (Ablution)', icon:'droplet', tag:'Essential', time:'5 min',
    related:['salah','tayammum','wudu-mistakes','wudu-limited-water'],
    summary:"The ritual washing performed before prayer and before handling the Qur'an. Wudu (ablution) is one of Islam's most frequent daily practices, honoring the body as a vessel for worship. Maintaining wudu throughout the day brings baraka (blessing) and mindfulness into routine.",
    note:"The sequence shown here is the commonly taught one — small details (like exact wiping order) vary between schools of thought. Ask a local teacher if you're unsure.",
    steps:[
      {title:'Make the intention (Niyyah)', body:"Silently intend in your heart to purify yourself for prayer. No specific words are required."},
      {title:'Say Bismillah', body:'Begin by mentioning the name of Allah.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Wash your hands', body:'Wash both hands up to the wrists three times, making sure water reaches between the fingers.'},
      {title:'Rinse your mouth and nose', body:'Rinse your mouth three times, then sniff water gently into your nose and blow it out, three times.'},
      {title:'Wash your face', body:'Wash your face three times, from the hairline to the chin, and ear to ear.'},
      {title:'Wash your arms', body:'Wash your right arm to the elbow three times, then your left arm to the elbow three times.'},
      {title:'Wipe your head and ears', body:'Wipe your head once with wet hands, front to back and back to front, then wipe the inside and outside of your ears.'},
      {title:'Wash your feet', body:'Wash your right foot to the ankle three times, then your left foot to the ankle three times.'},
      {title:'Close with the testimony', body:'Finish by reciting the shahada.', arabic:'أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ', translit:"Ashhadu an la ilaha illallah, wa ashhadu anna Muhammadan 'abduhu wa rasuluh", translation:'I bear witness that there is no god but Allah, and I bear witness that Muhammad is His servant and messenger.'}
    ],
    mistakes:[{wrong:'Washing limbs fewer than the required number of times or skipping a limb entirely', fix:'Wash each limb in the correct order at least once fully; three times is the fuller sunnah. If unsure a spot was covered, wash it again.', source:'Sahih al-Bukhari, Hadith on the description of Wudu'},{wrong:'Forgetting to wipe the ears after the head', fix:'After wiping the head, use wet fingers to wipe the inside and outside of both ears in the same motion.', source:'Sunan Abu Dawud, Hadith on wiping the ears'},{wrong:'Not letting water reach between the fingers and toes', fix:'Interlace fingers and toes briefly while washing hands and feet to ensure water reaches every gap.', source:'Jami\' at-Tirmidhi, Hadith on khilal (interlacing)'}]},

  { id:'salah', title:'Salah (How to Pray)', icon:'pray', tag:'Essential', time:'10 min',
    related:['wudu','sujoodsahw','salah-mistakes','five-prayers'],
    summary:"The core structure shared by every prayer, shown here as a simple two-rak'ah walkthrough. Salah (prayer) is the second pillar of Islam and the most direct conversation with Allah. Praying five times daily creates rhythm, discipline, and connection throughout your life, anchor points that transform ordinary moments into spiritual acts.",
    rakahInfo:[['Fajr','2'],['Dhuhr','4'],['Asr','4'],['Maghrib','3'],['Isha','4']],
    note:"For prayers with more than two rak'ahs, sit briefly for a short Tashahhud after the second rak'ah, then stand again for the rest before the final, longer Tashahhud. Hand position and a few other details vary between schools of thought.",
    steps:[
      {title:'Make the intention (Niyyah)', body:"Decide in your heart which prayer you're performing."},
      {title:'Face the Qibla and say the opening Takbir', body:'Raise your hands and say Allahu Akbar, then place your hands on your chest.', arabic:'اللَّهُ أَكْبَرُ', translit:'Allahu Akbar', translation:'Allah is the Greatest.'},
      {title:'Stand and recite (Qiyam)', body:"Recite Surah Al-Fatihah, then a short surah or a few verses of your choosing."},
      {title:'Bow (Ruku)', body:'Say Allahu Akbar and bow with your back straight and hands on your knees, repeating the tasbih three times.', arabic:'سُبْحَانَ رَبِّيَ الْعَظِيمِ', translit:"Subhana Rabbiyal 'Adheem", translation:'Glory be to my Lord, the Magnificent.'},
      {title:'Rise from Ruku', body:'Stand up straight again, saying the rising phrases.', arabic:'سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ، رَبَّنَا لَكَ الْحَمْدُ', translit:'Sami Allahu liman hamidah, Rabbana lakal hamd', translation:'Allah hears whoever praises Him. Our Lord, praise be to You.'},
      {title:'Prostrate (Sujood)', body:'Say Allahu Akbar and lower into prostration — forehead, nose, palms, knees and toes touching the ground — repeating the tasbih three times.', arabic:'سُبْحَانَ رَبِّيَ الْأَعْلَى', translit:"Subhana Rabbiyal A'la", translation:'Glory be to my Lord, the Most High.'},
      {title:'Sit briefly, then prostrate again', body:'Say Allahu Akbar, sit up for a moment asking for forgiveness, then prostrate a second time, repeating the same tasbih.', arabic:'رَبِّ اغْفِرْ لِي', translit:'Rabbighfirli', translation:'My Lord, forgive me.'},
      {title:"Stand for the second rak'ah", body:'Repeat the recitation, bowing and prostration exactly as before.'},
      {title:'Sit for the Tashahhud', body:'After the final prostration, sit and recite the Tashahhud.', arabic:'التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ، السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ، السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ، أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ', translit:"At-tahiyyatu lillahi was-salawatu wat-tayyibat, as-salamu 'alayka ayyuhan-nabiyyu wa rahmatullahi wa barakatuh, as-salamu 'alayna wa 'ala 'ibadillahis-salihin, ashhadu an la ilaha illallah wa ashhadu anna Muhammadan 'abduhu wa rasuluh.", translation:"All greetings, prayers and good deeds belong to Allah. Peace be upon you, O Prophet, and the mercy of Allah and His blessings. Peace be upon us and upon the righteous servants of Allah. I bear witness that there is no god but Allah, and I bear witness that Muhammad is His servant and messenger."},
      {title:'End with the Salam', body:'Turn your head to the right and say the salam, then turn to the left and repeat it.', arabic:'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ', translit:'Assalamu alaikum wa rahmatullah', translation:'Peace and the mercy of Allah be upon you.'}
    ],
    mistakes:[{wrong:'Rushing through ruku and sujood without settling', fix:'Pause briefly and settle into each position — the Prophet ﷺ told a man to repeat his prayer because he moved too quickly (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith of the poorly-praying man'},{wrong:'Praying without facing the Qibla correctly', fix:'Double-check direction using a reliable Qibla compass or app before starting, especially in unfamiliar locations.', source:'Fiqh us-Sunnah, Chapter on conditions of prayer'},{wrong:'Losing focus and thinking of unrelated matters throughout', fix:'Bring attention back gently each time it wanders; understanding the meaning of what you recite helps anchor focus (khushu).', source:'Riyad as-Salihin, Chapter on khushu in prayer'}]},

  { id:'tayammum', title:'Tayammum (Dry Ablution)', icon:'hand', tag:'When needed', time:'2 min',
    related:['wudu','wudu-limited-water','ghusl-or-wudu'],
    summary:'A substitute for Wudu using clean earth or dust, when water is unavailable or unsafe to use.',
    note:'Exactly how far up the arm to wipe varies between schools of thought — this shows the commonly taught general form.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to purify yourself for prayer, in place of Wudu.'},
      {title:'Say Bismillah', body:'Begin by mentioning the name of Allah.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Strike the surface', body:'Gently strike both palms on clean earth, sand, or a dust-covered surface.'},
      {title:'Wipe your face', body:'Wipe your entire face once with both palms.'},
      {title:'Strike again', body:'Strike your palms on the surface a second time.'},
      {title:'Wipe your hands and arms', body:'Wipe your hands and arms, up to the wrists or further depending on your school of thought.'}
    ],
    mistakes:[{wrong:'Using tayammum when water is actually available and accessible', fix:'Tayammum is only for when water is absent, harmful to use, or too far to reasonably reach — check availability first.', source:'Qur\'an 5:6, verse on tayammum conditions'},{wrong:'Striking the ground more than once per wipe unnecessarily', fix:'One strike of clean earth or dust is sufficient for both the face and hands in the simplified method most scholars teach.', source:'Sahih al-Bukhari, Hadith on tayammum method'}]},

  { id:'ghusl', title:'Ghusl (Ritual Bath)', icon:'shower', tag:'Essential', time:'10 min',
    related:['wudu','ghusl-or-wudu','hygiene'],
    summary:'The full-body purification required after certain occasions, such as before Friday prayer or Eid. Ghusl is a complete physical and spiritual cleansing, restoring your readiness for prayer and worship. The practice intertwines bodily care with spiritual renewal, honoring both dimensions of human nature.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to perform a complete purification.'},
      {title:'Say Bismillah and wash your hands', body:'Begin by mentioning the name of Allah, then wash both hands.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Wash away any impurity', body:'Clean any impurity from the body before continuing.'},
      {title:'Perform Wudu', body:'Perform Wudu as you would before prayer — you may leave washing your feet until the end.'},
      {title:'Pour water over your head', body:'Pour water over your head three times, making sure it reaches the roots of your hair.'},
      {title:'Pour water over your whole body', body:'Pour water over the right side of your body, then the left, making sure it covers you completely.'},
      {title:'Wash your feet', body:"Wash your feet now if you didn't already during Wudu."}
    ],
    mistakes:[{wrong:'Not ensuring water reaches the roots of the hair', fix:'Run fingers through the hair while pouring water to make sure water reaches the scalp, not just the surface.', source:'Sahih Muslim, Hadith on ghusl description'},{wrong:'Skipping the initial wudu before the full-body wash', fix:'Perform a complete wudu first, then pour water over the rest of the body — this is the sequence the Prophet ﷺ followed.', source:'Sahih al-Bukhari, Hadith on the Prophet\'s ghusl'}]},

  { id:'adhan', title:'Adhan & Iqamah', icon:'megaphone', tag:'Good to know', time:'2 min',
    related:['salah','jumuah','morning-routine'],
    summary:'The call to prayer, and the shorter call said just before the prayer begins.',
    crossLink:{label:"See the wording in Du'a & Dhikr", page:'dua'},
    steps:[
      {title:'Face the Qibla, if possible', body:'When prayer time begins, face the direction of the Qibla to give the call.'},
      {title:'Call the Adhan', body:'Recite the Adhan in a raised, clear voice — it announces that prayer time has begun and invites others to join.'},
      {title:'Call the Iqamah', body:'Just before standing to pray, say the Iqamah — a shorter, quicker version of the Adhan said right before the prayer starts.'},
      {title:'Respond if you hear someone else calling it', body:'When you hear the Adhan being called nearby, it\'s recommended to quietly repeat each phrase after the caller, then make the dua for the Prophet ﷺ once it finishes.'}
    ],
    mistakes:[{wrong:'Rushing the call to prayer without pausing between phrases', fix:'Recite each phrase clearly with a brief pause, allowing the call to be heard and understood distinctly.', source:'Sunan Abu Dawud, Hadith on the method of Adhan'},{wrong:'Treating the Adhan and Iqamah as interchangeable', fix:'The Adhan announces that prayer time has begun and may be called well before the prayer itself; the Iqamah is said moments before standing to pray and signals it\'s time to line up.', source:'Sahih al-Bukhari, Hadith distinguishing Adhan and Iqamah'}]},

  { id:'sujoodsahw', title:'Sujood as-Sahw', icon:'refresh', tag:'Good to know', time:'2 min',
    related:['salah','salah-mistakes','actions-during-prayer'],
    summary:'Two extra prostrations that correct a small, honest mistake during prayer — you never need to restart.',
    note:'Whether these go before or after the final Salam depends on the type of mistake, and differs slightly between schools of thought.',
    steps:[
      {title:'Notice the mistake', body:"If you add an extra rak'ah, miss a step, or become unsure how many rak'ahs you've prayed, there's no need to start over."},
      {title:'Prostrate twice', body:'Perform two extra prostrations, either just before or just after the final Salam.'},
      {title:'Repeat the usual tasbih', body:'Say the same phrase you say in ordinary Sujood, in each of the two prostrations.', arabic:'سُبْحَانَ رَبِّيَ الْأَعْلَى', translit:"Subhana Rabbiyal A'la", translation:'Glory be to my Lord, the Most High.'},
      {title:'Finish as normal', body:'Complete the prayer with the Salam, if you haven\u2019t already said it.'}
    ],
    mistakes:[{wrong:'Restarting the entire prayer over a minor, honest mistake', fix:"Sujood as-Sahw exists precisely so you don't have to start over — it applies to things like an extra rak'ah, a forgotten step, or uncertainty over the count, not deliberate errors.", source:"Sahih Muslim, Hadith on the Prophet's own Sujood as-Sahw"},{wrong:'Not knowing whether to prostrate before or after the Salam', fix:"As a simple default: if you added something extra, prostrate before the Salam; if you left something out, prostrate after it — schools of thought vary on the finer details.", source:'Fiqh us-Sunnah, Chapter on Sujood as-Sahw'}]},

  { id:'travel-combining', title:"Combining & Shortening Prayers While Traveling", icon:'plane', tag:'For travelers', time:'7 min',
    related:['travel','salah','qibla','finding-jamaah-away'],
    summary:"Islam eases the burden of travel through two related concessions: Qasr (shortening the four-rak'ah prayers to two) and Jam' (combining Dhuhr with Asr, or Maghrib with Isha, into one time slot). The two are separate rulings — you can shorten without combining, and in some schools of thought, combine without shortening — and the exact conditions differ noticeably between the four schools of thought.",
    note:"This guide summarizes the mainstream position of each school of thought. It is not a substitute for asking a knowledgeable local scholar about your specific journey, especially for edge cases like short layovers or unclear travel status.",
    steps:[
      {title:'Confirm you qualify as a traveler (musafir)', body:"The concessions only apply once you meet your school of thought's definition of 'travel' — both a minimum distance and, for combining specifically, genuine difficulty in praying each prayer at its own time. [Hanafi: roughly 77km / 48 miles as the minimum distance] [Shafi'i, Maliki, Hanbali: roughly 80-88km / 48-55 miles, historically described as a journey of two days by camel or foot]. You're generally considered a traveler once you leave the built-up limits of your home city or town, not merely once you leave your house."},
      {title:'Check how long you plan to stay', body:"Once you arrive and settle at your destination, the traveler concessions have a time limit before you're considered a resident again. [Hanafi: your traveler status continues for up to 15 days at the destination] [Shafi'i, Maliki, Hanbali: up to 4 days, not counting the day you arrive or the day you leave]. Staying longer than this at one location generally ends the concessions until you travel again."},
      {title:"Shorten the four-rak'ah prayers (Qasr)", body:"Dhuhr, Asr, and Isha are prayed as two rak'ahs instead of four. Fajr (already two rak'ahs) and Maghrib (three rak'ahs) are never shortened. [Hanafi: shortening is considered obligatory (wajib) for a traveler — praying four rak'ahs deliberately, without sitting for the first Tashahhud after the second, is said to invalidate the prayer] [Shafi'i, Maliki, Hanbali: shortening is a strongly emphasized Sunnah — praying the full four rak'ahs is valid but considered less complete than following the Prophet's ﷺ consistent practice while traveling]."},
      {title:"Understand the two ways to combine (Jam')", body:"Where combining applies, it can be done in one of two ways: Jam' Taqdim, praying the second prayer early, in the first prayer's time slot — for example praying Asr right after Dhuhr, both within Dhuhr's window; or Jam' Ta'khir, delaying the first prayer so it's prayed together with the second, in the second prayer's time slot — for example delaying Dhuhr until Asr time and praying both then."},
      {title:'Know your school of thought\'s position on combining', body:"This is where the schools of thought diverge most. [Shafi'i, Maliki, Hanbali: genuine combining (Jam' Haqiqi) of Dhuhr with Asr, and Maghrib with Isha, is permitted for ordinary travel, using either Taqdim or Ta'khir] [Hanafi: does not permit genuine combining for ordinary travel outside of Hajj — the two daily prayers at Arafah and Muzdalifah are treated as a specific exception. What can look like combining on an everyday journey is instead 'apparent' combining (Jam' Suri): praying the first prayer right at the very end of its own time window, then praying the second right at the very start of its own window, so each prayer technically still falls within its own time]. Fajr is never combined with any other prayer in any school of thought."},
      {title:'Consider the purpose of your journey', body:"[Shafi'i, Hanbali: the journey should be for a lawful purpose — these schools of thought withhold the traveler concessions from a journey undertaken specifically to commit sin] [Hanafi, Maliki: the concessions apply regardless of the purpose of the journey]."},
      {title:'Apply it practically on a flight or long journey', body:"In practice, many travelers combine Dhuhr and Asr before a flight departs or shortly after landing, and combine Maghrib and Isha similarly, rather than trying to pray precisely on a moving plane. Set an alarm for prayer times in your departure and arrival timezones so a short layover or overnight flight doesn't cause a prayer to be missed entirely."}
    ],
    mistakes:[{wrong:'Combining prayers as a default whenever traveling, regardless of genuine difficulty', fix:"Combining is a concession for hardship, not a routine convenience — where your school of thought permits it, use it when actually needed (during the flight, an overnight journey, or a packed itinerary), and pray on time separately when it's easy to do so.", source:"Fiqh us-Sunnah, Chapter on prayer while traveling"},{wrong:'Not knowing your own school of thought\'s distance and duration thresholds before a trip', fix:'Check the specific figures for your school of thought in advance, since they materially affect whether shortening and combining apply to a given journey.', source:'Kitab al-Fiqh ala al-Madhahib al-Arba\'ah, Chapter on the prayer of the traveler'},{wrong:'Assuming combining and shortening are the same ruling', fix:"They're separate concessions with separate conditions — a traveler may shorten without combining, and depending on the school of thought, the two don't always travel together.", source:'Fiqh us-Sunnah, Chapter on Qasr and Jam\''}]},

  { id:'qibla', title:'Facing the Qibla', icon:'compass', tag:'Good to know', time:'3 min',
    related:['salah','praying-in-car','finding-jamaah-away'],
    summary:'The direction of the Kaaba in Makkah, faced during every prayer.',
    steps:[
      {title:'Understand the Qibla', body:'The Qibla is the direction of the Kaaba in Makkah. Muslims around the world face this direction during every prayer.'},
      {title:'Find your direction', body:'Use a compass, a Qibla-finder app, or ask locally to work out the direction from where you are.'},
      {title:"If you can't be sure", body:'If you genuinely cannot determine the direction, such as while travelling, face your best estimate — your prayer is still valid.'},
      {title:'Mark it for next time', body:"Once you know your Qibla direction at home or another regular spot, a small mark or sticker saves you looking it up each time."},
      {title:'Understand congregational alignment', body:"In congregational prayer, only the Imam needs to face the exact Qibla direction — worshippers line up behind and beside them, forming rows that follow the Imam's orientation rather than each individually rechecking direction."}
    ],
    mistakes:[{wrong:'Assuming the Qibla is always due east or due south based on rough geography', fix:'The actual direction depends on great-circle distance to Makkah, which can feel counterintuitive — always check a reliable compass or app rather than guessing from a map.', source:'Fiqh us-Sunnah, Chapter on the direction of prayer'}]},

  { id:'jumuah', title:"Jumu'ah (Friday) Prayer", icon:'mosque', tag:'Weekly', time:'5 min',
    related:['mosque-etiquette','adhan','salah'],
    summary:'The congregational Friday prayer that replaces Dhuhr for those attending.',
    steps:[
      {title:'Know when it applies', body:"Jumu'ah replaces the Dhuhr prayer every Friday for adult Muslim men attending the mosque. Women may attend Jumu'ah or pray Dhuhr."},
      {title:'Prepare beforehand', body:"It's encouraged to perform Ghusl, wear clean clothes, and arrive early."},
      {title:'Listen to the Khutbah', body:'Listen attentively to the two-part sermon given by the Imam before the prayer begins.'},
      {title:'Pray in congregation', body:"Pray two rak'ahs led by the Imam, just as in a normal prayer."},
      {title:"If you can't attend", body:"If Jumu'ah isn't accessible — due to work, illness, or no mosque nearby — pray Dhuhr as usual instead; missing Jumu'ah without a valid reason is discouraged, but circumstances are taken into account."}
    ],
    mistakes:[{wrong:'Arriving after the khutbah has started and talking during it', fix:'Arrive early and remain silent once the khutbah begins — even saying \'be quiet\' to someone else during the khutbah is discouraged (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on silence during khutbah'},{wrong:'Skipping the Sunnah prayers before or after Jumu\u2019ah', fix:'Praying voluntary rak\u2019ahs before the khutbah and after the fard prayer, when time allows, follows the Prophet\u2019s ﷺ regular practice on Fridays.', source:'Sahih Muslim, Hadith on Sunnah prayers around Jumu\u2019ah'}]},

  { id:'fasting', title:'A Simple Fasting Routine', icon:'moon', tag:'Occasional', time:'5 min',
    related:['ramadan','ramadan-fasting-guide','can-i-fast-today','breaking-fast-traveling'],
    summary:'The daily rhythm of fasting during Ramadan or a voluntary fast.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend to fast, ideally before dawn.'},
      {title:'Eat Suhoor', body:'Have a pre-dawn meal before the Fajr prayer begins — it\u2019s encouraged, even if light.'},
      {title:'Fast through the day', body:'Refrain from food, drink and other invalidators from dawn (Fajr) until sunset (Maghrib).'},
      {title:'Break your fast', body:'At Maghrib, break your fast promptly — traditionally with a few dates and water — saying the breaking-fast dua.'},
      {title:'Continue as normal', body:'Carry on with your prayers and daily life; extra Qur\u2019an reading and dua are especially encouraged while fasting.'},
      {title:'Know what genuinely breaks the fast', body:'Eating, drinking, and intimacy during fasting hours invalidate the fast, along with vomiting on purpose — but things like a headache, tasting food without swallowing, or an injection generally do not.'}
    ],
    mistakes:[{wrong:'Delaying the intention until after dawn', fix:'Make the intention (niyyah) for an obligatory fast before Fajr begins — even the night before is sufficient.', source:'Sunan Abu Dawud, Hadith on intention for fasting'},{wrong:'Believing minor things like an accidental sip of water break the fast', fix:'Genuinely forgetful eating or drinking does not invalidate the fast — only continue once you remember (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on forgetfulness while fasting'}]},

  { id:'mosque-etiquette', title:'Mosque Etiquette (Adab of the Masjid)', icon:'mosque', tag:'Good to know', time:'4 min',
    summary:"The everyday manners that keep a mosque calm, clean and welcoming — from how you enter to how you leave.",
    note:"A few small details — like whether to pray Tahiyyat al-Masjid during times when voluntary prayer is normally discouraged, or how someone in a state of major ritual impurity may enter — vary between schools of thought. Ask a local imam if you're unsure.",
    steps:[
      {title:'Arrive in a state of purity', body:"Perform Wudu before you leave, if you can — arriving already purified is the recommended way to enter Allah's house. [Hanafi and Maliki: if you're in a state of major impurity and there's no water available, tayammum is enough to enter briefly.]"},
      {title:'Dress modestly and avoid strong smells', body:'Wear clean, modest clothing. The Prophet \ufdfa asked anyone who had eaten garlic or onion to stay away from the mosque until the smell had gone, so as not to disturb others.'},
      {title:'Enter with your right foot', body:'Step in right foot first, and say the dua for entering.', arabic:'\u0627\u0644\u0644\u0651\u0647\u0645\u0651 \u0627\u0641\u0652\u062a\u064e\u062d\u0652 \u0644\u064a \u0623\u064e\u0628\u0652\u0648\u064e\u0627\u0628\u064e \u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0643\u064e', translit:'Allahumma-ftah li abwaba rahmatik', translation:'O Allah, open for me the doors of Your mercy.'},
      {title:"Pray two rak'ahs before you sit (Tahiyyat al-Masjid)", body:"It's recommended to greet the mosque with a short two-rak'ah prayer before sitting down, unless it's a time when voluntary prayer is discouraged. [Shafi'i and Hanbali: pray it any time you enter, citing the general hadith 'do not sit until you pray two rak'ahs.' Hanafi: skip it specifically during those discouraged times.]"},
      {title:'Keep your voice low, and silence your phone', body:'Conversation should be brief and gentle. A ringing phone or loud talking disturbs everyone around you.'},
      {title:"Don't walk in front of someone praying", body:'Pass behind them, or wait until they finish, rather than crossing directly in front.'},
      {title:'Help straighten the rows', body:'Standing shoulder to shoulder and closing gaps in the row is part of the prayer itself \u2014 a small habit that keeps the congregation orderly.'},
      {title:'Be patient and gentle with children', body:'Children are welcome in the mosque \u2014 the Prophet was famously gentle with them, even during prayer. Guide them calmly rather than treating their presence as a disruption.'},
      {title:'Keep the space clean', body:'Take any rubbish with you and leave the area as you found it.'},
      {title:'Leave with your left foot', body:'Step out left foot first, and say the dua for leaving.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u0647\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u0627\u0629\u064f \u0648\u064e\u0627\u0644\u0633\u0651\u064e\u0644\u0627\u0645\u064f \u0639\u064e\u0644\u064e\u0649 \u0631\u064e\u0633\u0648\u0644\u0650 \u0627\u0644\u0644\u0651\u0647\u0650\u060c \u0627\u0644\u0644\u0651\u0647\u0645\u0651 \u0625\u0650\u0646\u0651\u064a \u0623\u064e\u0633\u0652\u0623\u064e\u0644\u064f\u0643\u064e \u0645\u0650\u0646 \u0641\u064e\u0636\u0652\u0644\u0650\u0643\u064e', translit:"Bismillah, was-salatu was-salamu 'ala Rasulillah, Allahumma inni as'aluka min fadlik", translation:'In the name of Allah, and peace and blessings be upon the Messenger of Allah. O Allah, I ask You from Your favor.'}
    ],
    mistakes:[{wrong:'Walking in front of someone who is praying', fix:'Walk around or wait; passing directly in front of someone in prayer is strongly discouraged (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on passing in front of a person praying'}]},

  { id:'home-etiquette', title:'Home Etiquette', icon:'home', tag:'Good to know', time:'4 min',
    summary:'The small daily habits — coming in, going out, and hosting others — that the Prophet \ufdfa taught around the home.',
    steps:[
      {title:'Say Bismillah as you enter', body:'Mentioning the name of Allah as you come home is more than a formality \u2014 the Prophet \ufdfa said it keeps the shaytan from settling in with you for the night.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u0648\u064e\u0644\u064e\u062c\u0652\u0646\u0627 \u0648\u064e\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u062e\u064e\u0631\u064e\u062c\u0652\u0646\u0627 \u0648\u064e\u0639\u064e\u0644\u0649 \u0631\u064e\u0628\u0651\u0650\u0646\u0627 \u062a\u064e\u0648\u064e\u0643\u0651\u0644\u0652\u0646\u0627', translit:'Bismillahi walajna, wa bismillahi kharajna, wa \u2018ala Rabbina tawakkalna', translation:'In the Name of Allah we enter, in the Name of Allah we leave, and upon our Lord we depend.'},
      {title:'Greet those inside with Salam', body:"Even if you find no one home, it's still recommended to say the greeting \u2014 angels present in the house reply on their behalf."},
      {title:'Enter with your right foot', body:"It's customary to enter with your right foot first, the same as entering the mosque."},
      {title:'Close doors gently', body:'The Prophet \ufdfa said gentleness adorns everything it touches, and its absence leaves everything flawed (Sahih Muslim). Avoid slamming doors or letting them bang shut.'},
      {title:'Keep dhikr alive in your home', body:'Reciting Surah Al-Baqarah regularly in the house is encouraged \u2014 the Prophet \ufdfa said Satan flees a home in which it is recited (Sahih Muslim).'},
      {title:'Honor your guests, and mind your neighbors', body:'The Prophet \ufdfa said: "Whoever believes in Allah and the Last Day should serve his guest generously, should not harm his neighbor, and should speak what is good or remain silent." (Sahih al-Bukhari)'},
      {title:'Say the dua before you leave', body:'Step out with trust in Allah for whatever the day holds.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u062a\u064e\u0648\u064e\u0643\u064e\u0651\u0644\u0652\u062a\u064f \u0639\u064e\u0644\u0649 \u0627\u0644\u0644\u0647\u0650 \u0648\u064e\u0644\u0627 \u062d\u064e\u0648\u0652\u0644\u064e \u0648\u064e\u0644\u0627 \u0642\u064f\u0648\u064e\u0651\u0629\u064e \u0625\u0650\u0644\u0627\u0651 \u0628\u0650\u0627\u0644\u0644\u0647', translit:'Bismillahi, tawakkaltu \u2018alallahi, wa la hawla wa la quwwata illa billah', translation:'In the Name of Allah, I have placed my trust in Allah; there is no might and no power except by Allah.'},
      {title:'Ask for protection as you go', body:"There's a second dua the Prophet \ufdfa used to say when leaving home, asking Allah for protection from misguiding others or being misguided, and from wronging others or being wronged."}
    ],
    mistakes:[{wrong:'Forgetting to say Bismillah when entering, allowing distraction to take over', fix:'Make it a consistent habit tied to the physical act of opening the door, so it becomes automatic over time.', source:'Sahih Muslim, Hadith on entering the home'}]},

  { id:'food-etiquette', title:'Food & Eating Etiquette', icon:'utensils', tag:'Good to know', time:'4 min',
    summary:'Simple sunnah manners that turn an everyday meal into an act of gratitude.',
    steps:[
      {title:'Wash your hands before eating', body:"Washing your hands before and after a meal is recommended, and traditionally seen as part of what brings blessing to the food."},
      {title:'Sit down to eat', body:'Eating while sitting, rather than standing or walking around, is the fuller sunnah.'},
      {title:'Say Bismillah before you start', body:"If you forget and only remember partway through, say the fuller version covering the whole meal.", arabic:'\u0628\u0633\u0645\u0650 \u0627\u0644\u0644\u064e\u0651\u0647\u0650', translit:'Bismillah', translation:'In the Name of Allah.'},
      {title:'Eat and drink with your right hand', body:'The Prophet \ufdfa specifically taught this \u2014 it applies even if you\u2019re left-handed for other everyday tasks.'},
      {title:"Eat from what's nearest to you", body:'When sharing a dish with others, take from the part closest to you rather than reaching across.'},
      {title:"Don't waste, and don't overeat", body:'The Prophet \ufdfa advised filling a third of the stomach with food, a third with drink, and leaving a third for air \u2014 eating to satisfy hunger rather than to excess.'},
      {title:'Praise Allah when you finish', body:'A short dua of thanks for the meal.', arabic:'\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0644\u0647\u0650 \u0627\u0644\u064e\u0651\u0630\u064a \u0623\u064e\u0637\u0652\u0639\u064e\u0645\u064e\u0646\u064a \u0647\u0630\u0627 \u0648\u064e\u0631\u064e\u0632\u064e\u0642\u064e\u0646\u064a\u0647\u0650 \u0645\u0650\u0646\u0652 \u063a\u064e\u064a\u0652\u0631\u0650 \u062d\u064e\u0648\u0652\u0644\u064d \u0645\u0650\u0646\u0651\u064a \u0648\u064e\u0644\u0627 \u0642\u064f\u0648\u064e\u0651\u0629', translit:'Alhamdu lillahil-ladhi at\u2019amani hadha, wa razaqanihi min ghayri hawlin minni wa la quwwah', translation:'Praise be to Allah, who fed me this and provided it for me without any power or might on my part.'},
      {title:'Thank whoever fed you', body:"If someone gave you food or drink, it's recommended to make dua for them in return \u2014 a simple exchange of gratitude."}
    ],
    mistakes:[{wrong:'Eating with the left hand out of habit rather than intention', fix:'Consciously switch to the right hand for eating and drinking, even if it feels unfamiliar at first — it becomes natural with practice.', source:'Sahih Muslim, Hadith on eating with the right hand'}]},

  { id:'hygiene', title:'Personal Hygiene (Fitrah)', icon:'droplet', tag:'Good to know', time:'4 min',
    summary:'The everyday acts of cleanliness the Prophet ﷺ described as part of human nature (fitrah).',
    steps:[
      {title:'Trim your nails regularly', body:"Cutting the nails is one of the five acts of fitrah the Prophet ﷺ mentioned (Sahih Muslim). A common guideline is not to let 40 nights pass without doing so."},
      {title:'Keep underarm and pubic hair trimmed', body:'Also listed among the acts of fitrah — regular trimming is the recommended practice, again within roughly a 40-day window.'},
      {title:'Trim the moustache and let the beard grow', body:"The Prophet ﷺ instructed trimming the moustache short and leaving the beard (some schools of thought define a minimum length — a fist's length is a commonly cited measure — other schools of thought leave the exact trimming looser)."},
      {title:'Use the miswak', body:'A tooth-stick or brush used to clean the teeth, especially before prayer. The Prophet ﷺ said that were it not a hardship on his people, he would have made it obligatory before every prayer (Sahih al-Bukhari).'},
      {title:'Wash thoroughly before Jumuah', body:'A fuller wash (ghusl) before Friday prayer is strongly encouraged, alongside wearing clean clothes and using pleasant scent.'},
      {title:'Keep clean for the sake of others too', body:'Attention to breath, body odor and tidy appearance is part of respecting the people around you, especially in the mosque and in gatherings.'}
    ],
    mistakes:[{wrong:'Letting nail and hair trimming go far beyond 40 days', fix:'Set a recurring reminder every few weeks so it doesn\'t slip past the recommended window.', source:'Sahih Muslim, Hadith on the 40-night limit'}]},

  { id:'sleep', title:'Sleep Etiquette', icon:'moon', tag:'Good to know', time:'4 min',
    summary:'A short nightly routine the Prophet ﷺ followed before sleeping, and how to start the day that follows.',
    steps:[
      {title:'Make wudu before bed', body:'The Prophet ﷺ advised performing wudu as you would for prayer before lying down to sleep (Sahih al-Bukhari).'},
      {title:'Dust off your bed', body:'Shake out the bedding before lying down — a small precaution the Prophet ﷺ taught, since you never know what may have settled there while you were away (Sahih al-Bukhari).'},
      {title:'Lie on your right side', body:'The commonly taught sleeping position, following the Prophet\u2019s ﷺ own habit.'},
      {title:'Recite Ayat al-Kursi', body:'Reciting this verse (Qur\u2019an 2:255) before sleep is recommended as protection through the night.'},
      {title:'Recite the three Quls', body:'Recite Surah Al-Ikhlas, Al-Falaq and An-Nas, blow gently into your cupped hands, and wipe them over as much of your body as you can reach — a nightly habit of the Prophet ﷺ (Sahih al-Bukhari).'},
      {title:'Say the sleeping dua', body:'A short statement of trust before drifting off.', arabic:'\u0628ِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا', translit:'Bismika Allahumma amutu wa ahya', translation:'In Your name, O Allah, I die and I live.'},
      {title:'Say the waking dua', body:'The first words on opening your eyes, thanking Allah for another day.', arabic:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', translit:"Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur", translation:'Praise be to Allah who gave us life after having caused us to die, and to Him is the return.'}
    ]},

  { id:'family', title:'Family Etiquette', icon:'users', tag:'Good to know', time:'4 min',
    summary:'How the Prophet ﷺ taught treating parents, children and relatives — the closest circle first.',
    steps:[
      {title:'Honor your parents', body:'The Qur\u2019an pairs worshipping Allah alone with kindness to parents, going as far as forbidding even a sigh of impatience toward them in old age (Qur\u2019an 17:23\u201324).'},
      {title:'Make dua for them', body:'A short prayer asking mercy on parents, echoing the words taught in the Qur\u2019an.', arabic:'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا', translit:'Rabbi irhamhuma kama rabbayani saghira', translation:'My Lord, have mercy upon them as they raised me when I was small.'},
      {title:'Maintain ties of kinship', body:"Staying in touch with relatives — visiting, calling, helping where needed — is described as something that lengthens one's provision and remembrance (Sahih al-Bukhari)."},
      {title:'Treat children with mercy', body:'The Prophet ﷺ was famously gentle and playful with children, and taught that kissing and showing affection to them is part of mercy, not indulgence.'},
      {title:'Be fair between your children', body:'Gifts and attention should be distributed evenly among children — the Prophet ﷺ refused to witness a gift given to only one child until it was made fair (Sahih al-Bukhari).'},
      {title:'Consult your family', body:'Involving a spouse or family in decisions that affect them, rather than deciding unilaterally, reflects the Qur\u2019anic principle of mutual consultation (shura).'},
      {title:'Spend generously on your household', body:'Money spent on one\u2019s family is described as among the most rewarded of all spending (Sahih Muslim).'}
    ]},

  { id:'manners', title:'Everyday Manners (Adab)', icon:'hand', tag:'Good to know', time:'4 min',
    summary:'Small social habits — greetings, speech, and the courtesies between people — drawn from the Prophet\u2019s ﷺ example.',
    steps:[
      {title:'Give salam first', body:'Initiating the greeting of peace, whether to someone you know or a stranger, is encouraged rather than waiting to be greeted.'},
      {title:'Lower your gaze', body:"A basic courtesy toward others' privacy and dignity, mentioned directly in the Qur\u2019an (24:30\u201331)."},
      {title:'Smile', body:'The Prophet ﷺ described smiling at another person as an act of charity (Jami\u2019 at-Tirmidhi).'},
      {title:'Speak well, or stay silent', body:"\"Whoever believes in Allah and the Last Day should speak what is good or remain silent\" (Sahih al-Bukhari) — a simple filter for everyday conversation."},
      {title:'Avoid backbiting and gossip', body:'The Qur\u2019an compares speaking ill of someone behind their back to eating the flesh of a dead sibling (Qur\u2019an 49:12) — a vivid warning against it.'},
      {title:'Ask permission before entering', body:"Whether it's a room, a home, or someone's personal space, asking first — and knocking or announcing yourself — is basic adab."},
      {title:'Respond to a sneeze', body:'The sneezer says Alhamdulillah; those nearby reply with a blessing, and the sneezer responds again in turn.', arabic:'يَرْحَمُكَ اللَّهُ \u2014 يَهْدِيكُمُ اللَّهُ وَيُصْلِحُ بَالَكُمْ', translit:'Yarhamuk Allah \u2014 Yahdikumullahu wa yuslihu balakum', translation:'May Allah have mercy on you \u2014 May Allah guide you and set your affairs right.'}
    ]},

  { id:'ramadan', title:'Ramadan Etiquette', icon:'moon', tag:'Good to know', time:'5 min',
    related:['fasting','ramadan-preparation','eid'],
    summary:"The rhythm of a fasting day, from before dawn to sunset, and the habits that shape the month.",
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to fast for the sake of Allah before dawn — no specific words are required.'},
      {title:'Eat suhoor, and delay it', body:'The pre-dawn meal is encouraged, and pushing it close to the start of Fajr is the fuller sunnah — the Prophet ﷺ called it a blessed meal (Sahih al-Bukhari).'},
      {title:'Guard your tongue and behavior', body:'Fasting is more than avoiding food and drink — the Prophet ﷺ said whoever doesn\u2019t give up false speech and bad conduct, Allah has no need of them giving up their food and drink (Sahih al-Bukhari).'},
      {title:'Hasten to break the fast', body:'Break your fast as soon as the sun sets, traditionally with dates and water, rather than delaying.'},
      {title:'Say the breaking-fast dua', body:'A short statement of gratitude at iftar.', arabic:'ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللَّهُ', translit:"Dhahaba adh-dhama'u wabtallatil-'uruqu wa thabatal-ajru in sha Allah", translation:'The thirst has gone, the veins are moistened, and the reward is confirmed, if Allah wills.'},
      {title:'Increase Qur\u2019an recitation and taraweeh', body:'Ramadan nights are commonly spent in extra night prayer (taraweeh) and more time with the Qur\u2019an than usual.'},
      {title:'Give charity', body:'Generosity is encouraged throughout the month, including Zakat al-Fitr — a set charity due from every Muslim before the Eid prayer.'},
      {title:'Seek Laylat al-Qadr', body:'The odd nights of the last ten days of Ramadan are when this night, described as better than a thousand months, is most likely to fall.'}
    ],
    mistakes:[{wrong:'Skipping suhoor entirely due to sleep or convenience', fix:'Even a few dates and water before dawn count as suhoor and carry real blessing — don\'t skip it for extra sleep.', source:'Sahih al-Bukhari, Hadith on the blessing of suhoor'}]},

  { id:'eid', title:'Eid Etiquette', icon:'gift', tag:'Good to know', time:'4 min',
    summary:'The small sunnahs around Eid morning — from getting ready to greeting others afterward.',
    steps:[
      {title:'Wash and wear your best clothes', body:'Ghusl and dressing well (not necessarily new clothes, just your best) is encouraged before heading out.'},
      {title:'Eat before Eid al-Fitr prayer', body:'It\u2019s sunnah to eat something, traditionally an odd number of dates, before leaving for the prayer.'},
      {title:'Delay eating for Eid al-Adha', body:"For Eid al-Adha, the opposite applies — it's recommended to wait until after the prayer, then eat from the sacrifice if one is offered."},
      {title:'Pay Zakat al-Fitr beforehand', body:'This charity is due before the Eid al-Fitr prayer, so it reaches those in need in time for the celebration.'},
      {title:'Say the Takbir on the way', body:'It\u2019s sunnah to recite the Takbir aloud on the way to the prayer ground.', arabic:'اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ لَا إِلَٰهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ وَلِلَّهِ الْحَمْدُ', translit:'Allahu akbar, Allahu akbar, la ilaha illallah, wallahu akbar, Allahu akbar, wa lillahil-hamd', translation:'Allah is the Greatest, Allah is the Greatest, there is no god but Allah, and Allah is the Greatest, Allah is the Greatest, and to Allah belongs all praise.'},
      {title:'Attend the Eid prayer', body:'Two rakahs with extra takbirs, followed by a khutbah — there is no adhan or iqamah beforehand.'},
      {title:'Take a different route home', body:'The Prophet ﷺ would return from Eid prayer by a different path than the one he took to get there (Sahih al-Bukhari).'},
      {title:'Greet others warmly', body:'A simple exchange wishing acceptance of the good deeds of the season.', arabic:'تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ', translit:'Taqabbalallahu minna wa minkum', translation:'May Allah accept it from us and from you.'}
    ],
    mistakes:[{wrong:'Forgetting to pay Zakat al-Fitr before the Eid al-Fitr prayer', fix:'Set this aside a few days in advance so it\'s ready before you leave for prayer — paying it after invalidates the intended timing.', source:'Sunan Abu Dawud, Hadith on the timing of Zakat al-Fitr'}]},

  { id:'travel', title:'Travel Etiquette', icon:'plane', tag:'Good to know', time:'5 min',
    related:['travel-combining','finding-jamaah-away','breaking-fast-traveling','praying-in-car'],
    summary:'How the Prophet ﷺ prepared for journeys, and the concessions Islam gives travelers along the way.',
    steps:[
      {title:'Say the traveler\u2019s dua', body:'Recited on setting off, once you\u2019re seated or underway.', arabic:'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَٰذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَىٰ رَبِّنَا لَمُنقَلِبُونَ', translit:'Subhanal-ladhi sakhkhara lana hadha wa ma kunna lahu muqrinin, wa inna ila Rabbina lamunqalibun', translation:'Glory be to Him who has subjected this to us, and we could never have accomplished it by ourselves. And indeed, to our Lord we will return.'},
      {title:'Shorten your prayers (Qasr)', body:'The four-rakah prayers (Dhuhr, Asr, Isha) are shortened to two while traveling (some schools of thought set a minimum distance and duration for this to apply, other schools of thought are more lenient) — check which applies to you.'},
      {title:'Combine prayers (Jama\u2019) when needed', body:"Dhuhr with Asr, and Maghrib with Isha, can be combined at one of their times if travel makes performing them separately difficult (the exact conditions for when this is permitted vary between schools of thought)."},
      {title:'Keep up your daily dhikr', body:'The remembrances for morning, evening, and entering a new place don\u2019t pause for travel — if anything, they\u2019re emphasized more.'},
      {title:'Seek out the local mosque', body:'Finding where and when Jama\u2019ah is held at your destination keeps you connected to prayer in community, even away from home.'},
      {title:'Make up missed Ramadan fasts', body:'If travel falls during Ramadan, fasting is not obligatory for the journey — those days are made up later, at a more convenient time.'},
      {title:'Say the dua on returning', body:'A fuller version of the traveler\u2019s dua, said on the way back, closing with words of repentance and praise.', arabic:'آيِبُونَ تَائِبُونَ عَابِدُونَ لِرَبِّنَا حَامِدُونَ', translit:"Ayibuna ta'ibuna 'abidun li Rabbina hamidun", translation:'We return, repentant, worshipping, and praising our Lord.'}
    ],
    mistakes:[{wrong:'Not knowing the distance threshold for shortening prayers', fix:'Check your school of thought\'s specific distance guideline in advance, or use a reliable app that calculates it for your location.', source:'Fiqh us-Sunnah, Chapter on prayer while traveling'}]},

  { id:'finance', title:'Wealth & Finance Etiquette', icon:'scale', tag:'Good to know', time:'4 min',
    summary:'How Islam frames earning, spending, and giving — the everyday principles behind money.',
    steps:[
      {title:'Earn from halal sources', body:'Income should come from permissible work, avoiding riba (interest-based transactions) and other forbidden dealings.'},
      {title:'Pay Zakat on eligible wealth', body:'A yearly obligation on savings and wealth above a set threshold (nisab), commonly calculated at 2.5% (some schools of thought base the nisab on the value of gold, other schools of thought use silver, which gives a lower threshold).'},
      {title:'Give sadaqah regularly', body:'Voluntary charity, even in small and consistent amounts, is encouraged well beyond the obligatory Zakat.'},
      {title:'Deal honestly in business', body:'Giving full measure and weight, and not concealing faults in what you sell, is a repeated Qur\u2019anic theme (Qur\u2019an 83:1\u20133).'},
      {title:'Pay debts without delay', body:'The Prophet ﷺ described delaying repayment when able to pay as a form of injustice (Sahih al-Bukhari).'},
      {title:'Balance spending', body:'Neither extravagance nor stinginess — the Qur\u2019an describes the balanced middle path between the two (Qur\u2019an 25:67).'},
      {title:'Spend on family before others', body:'Providing for your own household comes first, and is itself counted as charity when done with the right intention.'}
    ],
    mistakes:[{wrong:'Calculating Zakat incorrectly by including non-zakatable assets', fix:'Only wealth held for a full lunar year above the nisab threshold is zakatable — consult a knowledgeable source for your specific assets.', source:'Fiqh us-Sunnah, Chapter on Zakat calculation'}]},

  { id:'quran-etiquette', title:'Qur\u2019an Etiquette', icon:'book', tag:'Good to know', time:'4 min',
    summary:'How to approach, handle, and recite the Qur\u2019an with the respect it\u2019s given in the tradition.',
    steps:[
      {title:'Consider wudu before touching the mushaf', body:"Purity before touching the physical Qur'an is the majority position, based on Qur'an 56:79 (some schools of thought treat this as obligatory, other schools of thought as recommended) — reciting from memory or reading a translation doesn't require wudu."},
      {title:'Begin with the Isti\u2018adhah and Basmalah', body:'Seek refuge from Satan, then begin in the name of Allah, before starting recitation.', arabic:'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', translit:"A'udhu billahi minash-shaytanir-rajim, Bismillahir-Rahmanir-Rahim", translation:'I seek refuge in Allah from Satan, the accursed. In the name of Allah, the Most Compassionate, the Most Merciful.'},
      {title:'Recite with tarteel', body:'Unhurried, clear recitation rather than rushing through — the Qur\u2019an itself instructs reciting it slowly and distinctly (Qur\u2019an 73:4).'},
      {title:'Reflect as you recite', body:'Pausing to think about the meaning (tadabbur), rather than treating recitation as a pace to get through, is encouraged throughout the tradition.'},
      {title:'Prostrate at verses of sajdah', body:'Certain verses call for a single prostration when recited or heard — a brief pause built into the reading.'},
      {title:'Handle the mushaf with care', body:"Keep it off the floor, store it somewhere elevated and clean, and avoid placing other items on top of it."},
      {title:'Listen quietly when it\u2019s recited', body:"\"When the Qur'an is recited, listen to it and pay attention\" (Qur'an 7:204) — a simple instruction for gatherings where it's being read aloud."}
    ],
    mistakes:[{wrong:'Reciting too fast to actually reflect on the meaning', fix:'Slow down deliberately, even if it means reading less — tarteel (unhurried recitation) is explicitly commanded in the Qur\'an (73:4).', source:'Qur\'an 73:4, verse on reciting the Qur\'an slowly'}]},

  { id:'life-events', title:'Life Events Etiquette', icon:'heart', tag:'Good to know', time:'5 min',
    summary:'The sunnahs marking birth, marriage, and death \u2014 the milestones a family moves through together.',
    steps:[
      {title:'Announce a birth with the adhan', body:"It's commonly practiced to say the call to prayer softly into a newborn's right ear shortly after birth (some scholars have questioned the strength of the specific hadith for this, while noting it remains a long-held and widespread practice)."},
      {title:'Choose a good name', body:'Naming the child, ideally within the first week, with a name that carries a good meaning is emphasized in the tradition.'},
      {title:'Perform the Aqiqah', body:'A sacrifice offered in gratitude for a child \u2014 traditionally two animals for a boy and one for a girl (some schools of thought treat this as strongly recommended, other schools of thought, such as the Hanafi school, treat it as optional rather than emphasized).'},
      {title:'Shave the baby\u2019s head', body:'Traditionally done on the seventh day, with the equivalent weight of the hair in silver given as charity.'},
      {title:'Announce a marriage publicly', body:'A nikah is encouraged to be announced openly rather than kept quiet, often marked with a walima (wedding feast).'},
      {title:'Give the mahr', body:'A mandatory gift from the groom to the bride as part of the marriage contract, amount agreed between them.'},
      {title:'Face the dying toward Qibla', body:'Where possible, a dying person is turned to face the Qibla, and those present gently remind them of the shahada.'},
      {title:'Perform ghusl, kafan, and Janazah prayer', body:'The deceased is washed, wrapped in a simple shroud, and prayed over collectively by the community before burial, which is typically not delayed.'}
    ]},

  { id:'morning-routine', title:'Morning Routine', icon:'sun', tag:'Daily', time:'3 min',
    related:['evening-routine','salah','gratitude'],
    summary:'Starting the day with intention — small habits that set the tone before anything else.',
    steps:[
      {title:'Wake with gratitude', body:'The moment you open your eyes, say the waking dua thanking Allah for another day.', arabic:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', translit:"Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur", translation:'Praise be to Allah who gave us life after having caused us to die, and to Him is the return.'},
      {title:'Use the siwak or brush your teeth', body:'Cleaning the mouth is encouraged first thing, before even drinking water or eating.'},
      {title:'Make wudu', body:'Start fresh with ablution, even before the morning prayer (Fajr), to be in a state of purity.'},
      {title:'Pray Fajr in congregation if possible', body:'The first prayer of the day, ideally prayed with others in the mosque.'},
      {title:'Read or listen to Qur\'an', body:'Spending time with the Qur\'an early settles the heart and anchors the day in remembrance.'},
      {title:'Make morning dhikr', body:'Short remembrances of Allah — tasbihat and tahlil — traditionally said after Fajr prayer before sunrise.'},
      {title:'Eat a light breakfast with intention', body:"Even a simple meal counts as worship when begun with Bismillah — the Prophet ﷺ encouraged not skipping breakfast where possible, as strength for the day's tasks."}
    ],
    mistakes:[{wrong:'Going back to sleep right after Fajr and missing the blessed early morning', fix:'The time between Fajr and sunrise is considered especially blessed for dhikr and productivity — try staying awake even briefly before resuming sleep if needed.', source:'Jami\' at-Tirmidhi, Hadith on the blessing of the early morning'}]},

  { id:'evening-routine', title:'Evening Routine', icon:'moon', tag:'Daily', time:'3 min',
    related:['morning-routine','sleep','family'],
    summary:'Winding down with reflection and intention — habits that close the day well.',
    steps:[
      {title:'Attend Maghrib prayer', body:'The sunset prayer, traditionally at the time the sun fully disappears — a natural marker for the evening.'},
      {title:'Review your day', body:'Quietly reflect on what went well and what could have been better, asking Allah for forgiveness and improvement.'},
      {title:'Make evening dhikr', body:'Tasbihat and remembrance said after Maghrib or Isha prayer, honoring the transition into night.'},
      {title:'Spend time with family', body:'The evening is traditionally a time to be present with those at home, sharing a meal or conversation.'},
      {title:'Read before bed', body:'Whether Qur\'an, Islamic knowledge, or something uplifting — settling the mind before sleep.'},
      {title:'Make wudu and say the night duas', body:'Final preparations: ablution, recitation of protective verses and the sleeping dua, before resting.'},
      {title:'Set tomorrow\'s intention before sleeping', body:'Briefly decide what you want to accomplish or improve the next day — a small habit that carries the day\'s momentum into the next.'}
    ],
    mistakes:[{wrong:'Skipping the night duas and protective verses out of tiredness', fix:'These take only a minute or two and were a consistent part of the Prophet\u2019s ﷺ nightly routine — try saying them even briefly before sleep overtakes you.', source:'Sahih al-Bukhari, Hadith on the Prophet\u2019s nightly recitations'}]},

  { id:'work-etiquette', title:'Work & Workplace Etiquette', icon:'hand', tag:'Daily', time:'4 min',
    summary:'How to carry Islamic values into your job — integrity, fairness, and good character with colleagues.',
    steps:[
      {title:'Do your work with excellence', body:'The Prophet ﷺ said Allah loves when any of you does a job that you do it excellently (Sunan Ibn Majah). This applies to whatever work you do.'},
      {title:'Be punctual', body:'Arriving on time and meeting deadlines is part of honoring agreements and respecting others\' time.'},
      {title:'Treat colleagues fairly', body:"Avoiding favoritism and dealing justly with everyone around you, regardless of rank or friendship — the Qur'an repeatedly emphasizes this (Qur'an 4:58)."},
      {title:'Honor confidentiality', body:"Don't spread workplace secrets or gossip, even in casual conversation. This is part of trustworthiness (amanah)."},
      {title:'Ask permission before leaving', body:'If your workplace has norms around breaks or leaving early, respect them — part of honoring the agreement with your employer.'},
      {title:'Say bismillah before eating at your desk', body:'If you eat during work, beginning with the name of Allah is a simple grounding moment, even in a busy environment.'},
      {title:'Guard your tongue', body:"Avoid complaints, backbiting, or spreading negativity — the Prophet ﷺ said whoever guards their tongue and their eyes, I guarantee them Paradise (Jami' at-Tirmidhi)."}
    ]},

  { id:'neighbors', title:'Neighbor Etiquette', icon:'home', tag:'Daily', time:'3 min',
    summary:'The people next door deserve some of your best character — simple ways to be a good neighbor.',
    steps:[
      {title:'Greet them warmly', body:'A simple hello or nod when you pass by sets a tone of peace and openness.'},
      {title:'Mind your noise', body:'Keeping sounds at reasonable levels, especially late at night, is basic respect for their rest and quiet.'},
      {title:'Keep your space neat', body:'A tidy yard, clean entrance, and orderly common areas shows you care about the shared surroundings.'},
      {title:'Help when you see need', body:'If a neighbor is moving, ill, or struggling with something, offering a hand is part of the faith — even small gestures matter.'},
      {title:"Don't pry or spy", body:'Avoiding looking into their windows or asking intrusive questions is part of respecting privacy and dignity (Qur\'an 24:27).'},
      {title:'Return borrowed items promptly', body:'If you borrow something, return it in good condition and within a reasonable time without being reminded.'},
      {title:'Bring them a small gift', body:'The Prophet ﷺ said the best charity is when your neighbor eats what you eat (Sunan Ibn Majah) — sharing food or small gifts builds bonds.'}
    ]},

  { id:'patience-hardship', title:'Patience During Hardship (Sabr)', icon:'shield', tag:'Spiritual', time:'4 min',
    summary:'How Islam frames difficulty — patience is not passivity, but an active trust in Allah through trials.',
    steps:[
      {title:'Recognize hardship as a test', body:'The Qur\'an says with hardship comes ease (Qur\'an 94:5) — trials are opportunities for growth, not punishments (unless one truly transgresses).'},
      {title:'Make dua immediately', body:'When something difficult happens, turning to Allah in supplication is the first response — asking for help, relief, and wisdom.'},
      {title:'Accept what you cannot control', body:'Some things are beyond your power. Accepting that and focusing energy on what you can influence is the essence of sabr.'},
      {title:'Seek counsel', body:'Talk to someone wise — a scholar, elder, or trusted friend — to gain perspective and explore options, rather than suffering in silence.'},
      {title:'Maintain your prayers and remembrance', body:'When times are hard, staying consistent with salah and dhikr actually steadies the heart more than ever (Qur\'an 2:45).'},
      {title:'Help others in their hardship', body:'Showing compassion to someone else in difficulty, even while struggling yourself, shifts your focus and builds resilience.'},
      {title:'Trust the outcome to Allah', body:'Sabr means doing what you can, then truly trusting Allah with the result — no anxiety over what is beyond your reach.'}
    ]},

  { id:'anger-management', title:'Managing Anger (Hilm)', icon:'hand', tag:'Spiritual', time:'4 min',
    summary:'Islam teaches gentleness and restraint — how to handle anger before it handles you.',
    steps:[
      {title:'Recognize anger arising', body:'The first step is noticing it without acting on impulse — a moment of awareness before the emotion takes over.'},
      {title:'Change your physical state', body:'The Prophet ﷺ gave practical advice: if you\'re standing, sit down; if sitting, lie down. Movement interrupts the anger cycle (Sunan Abu Dawud).'},
      {title:'Make wudu', body:'Washing with water is calming and resets the nervous system — the Prophet ﷺ connected it to managing anger.'},
      {title:'Stay silent', body:'Not speaking while angry protects you from saying things you\'ll regret. Silence is often the wisest response (Jami\' at-Tirmidhi).'},
      {title:'Seek refuge from Satan', body:'Say "I seek refuge in Allah from Satan the accursed" (A\'udhu billahi minash-shaytanir-rajim) — anger is often his whisper.', arabic:'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ', translit:'A\'udhu billahi minash-shaytanir-rajim', translation:'I seek refuge in Allah from Satan, the accursed.'},
      {title:'Breathe deeply and make dhikr', body:'Slow breathing and remembrance of Allah calm the nervous system and bring clarity back.'},
      {title:'Apologize if you\'ve wronged', body:'If your anger led you to hurt someone, apologizing and making amends is essential — humility is strength in Islam.'}
    ]},

  { id:'gratitude', title:'Gratitude (Shukr)', icon:'star', tag:'Spiritual', time:'4 min',
    summary:'Recognizing blessings big and small — gratitude reshapes how you see the whole of life.',
    steps:[
      {title:'Notice small blessings', body:'A warm cup of tea, a good conversation, arriving safely — the practice starts with noticing what\'s already there.'},
      {title:'Say Alhamdulillah often', body:'Throughout the day, when good things happen or even when difficulty passes, praise Allah aloud. It trains the heart toward gratitude.'},
      {title:'Use blessings well', body:'Gratitude isn\'t just words — it\'s shown through using what Allah gave you responsibly and not wasting it (Qur\'an 7:10).'},
      {title:'Share what you have', body:'Giving sadaqah and sharing blessings with others is a form of gratitude — acknowledging that what you have came from Allah (Qur\'an 2:272).'},
      {title:'Thank those who help you', body:'Making dua for people who do you good, and expressing appreciation to them, mirrors gratitude to Allah.'},
      {title:'Reflect on what could have been worse', body:'In difficulty, remember that it could have been much harder — this perspective itself is a form of shukr.'},
      {title:'Make the gratitude dua', body:'Especially after a meal or blessing, a simple statement thanking Allah and asking for more.', arabic:'الْحَمْدُ لِلَّهِ حَمْدًا كَثِيرًا طَيِّبًا مُبَارَكًا فِيهِ', translit:'Alhamdu lillahi hamdan kathiran tayyiban mubarakan fih', translation:'Praise be to Allah — a plentiful, pure, and blessed praise.'}
    ]},

  { id:'intention', title:'Setting Intention (Niyyah)', icon:'star', tag:'Spiritual', time:'4 min',
    summary:'Islam is built on intention — how to align what you do with why you do it.',
    steps:[
      {title:'Understand that deeds are by intention', body:'The Prophet ﷺ opened his teaching with this principle: every act is judged by its intention (Sahih al-Bukhari). The outcome matters less than why you acted.'},
      {title:'Make your intention clear to yourself', body:'Before a big action or even a daily task, pause and clarify in your heart: why am I doing this? Is it for Allah or for something else?'},
      {title:'Purify your intention', body:'If you catch yourself doing something partly for show or partly for the wrong reason, pause and reset — ask Allah to purify your intention.'},
      {title:'Distinguish between niyyah and nafs', body:'The nafs (ego) whispers selfish reasons; niyyah is the conscious commitment to do something for Allah. Both can be present — work to let niyyah win.'},
      {title:'Make the same act count twice', body:"When you intend something for Allah's sake, a single act — helping a friend, earning money, going to work — becomes worship, not just routine."},
      {title:'Renew intentions regularly', body:'Intentions drift over time. Regularly asking yourself "Why am I still doing this?" keeps actions aligned with what matters.'},
      {title:'Know that Allah sees your intention', body:'Even if no one else knows why you acted, Allah knows your heart. This is both comfort (He rewards what no one sees) and accountability (He sees everything).'}
    ]},

  { id:'seeking-knowledge', title:'Seeking Knowledge (Talab al-Ilm)', icon:'book', tag:'Spiritual', time:'4 min',
    summary:'Islam places learning at the center — the first revelation commanded "Read." How to approach seeking knowledge.',
    steps:[
      {title:'Start with sincere intention', body:'Before learning anything, clarify that you\'re seeking knowledge for Allah\'s sake, to draw closer to Him and serve His creation better.'},
      {title:'Respect the teacher', body:'The tradition emphasizes respect for those who teach you — honor their time and wisdom, even if you don\'t agree on everything (some differences are legitimate).'},
      {title:'Seek authenticated sources', body:'Don\'t accept claims at face value, even from popular teachers. Verify against the Qur\'an, hadith collections like Sahih al-Bukhari, and scholarly consensus (ijmaa\').'},
      {title:'Learn foundational matters first', body:'Build upward: start with core beliefs, then fiqh essentials, then deeper specializations. Rushing to advanced topics without foundations leads to misunderstanding.'},
      {title:'Apply what you learn', body:'Knowledge that doesn\'t change how you act or think isn\'t really knowledge — the Prophet ﷺ said the most learned of people are those who fear Allah most (Sunan Ibn Majah).'},
      {title:'Teach others', body:'Teaching what you\'ve learned deepens it and spreads benefit. The Prophet ﷺ said the best of you are those who learn the Qur\'an and teach it (Sahih al-Bukhari).'},
      {title:'Continue learning your whole life', body:'The Prophet ﷺ said to seek knowledge from the cradle to the grave. No age is too late to start; no amount is ever complete.'}
    ]},

  { id:'dealing-with-loss', title:'Dealing with Loss & Grief', icon:'heart', tag:'Spiritual', time:'4 min',
    summary:'Islam acknowledges loss deeply and teaches a path through grief — not around it, but through it with Allah.',
    steps:[
      {title:'Allow yourself to grieve', body:'The Prophet ﷺ wept at the deaths of loved ones, showing that sadness is natural and human, not a lack of faith (Sahih Muslim).'},
      {title:'Say Inna lillahi wa inna ilayhi raji\'un', body:'Reciting this verse from the Qur\'an (2:156) centers you in the truth that all things belong to Allah and return to Him.', arabic:'إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ', translit:'Inna lillahi wa inna ilayhi raji\'un', translation:'Indeed we belong to Allah, and indeed to Him we will return.'},
      {title:'Make dua for those who have passed', body:'Asking Allah\'s mercy for the deceased is ongoing — a connection that persists through prayer.'},
      {title:'Share the grief with others', body:'Isolation in grief deepens it. Tell your story, cry with others, and allow support from your community.'},
      {title:'Remember them well', body:'Speak kindly of those who have died, recall their good qualities, and live out the values they taught you.'},
      {title:'Take care of dependents left behind', body:'If someone dies and leaves family, caring for them is a continuation of that person\'s legacy and a duty in Islam.'},
      {title:'Trust Allah\'s wisdom', body:'Grief is real, but beneath it is the belief that Allah\'s decision is just, even when we don\'t understand it now. Time and faith gradually reveal the wisdom.'}
    ]},


  { id:'five-prayers', title:'The Five Daily Prayers (Salah)', icon:'pray', tag:'Essential', time:'8 min',
    related:['salah','adhan','qibla'],
    summary:'A quick reference to the names, times, and number of rakahs for each obligatory prayer.',
    steps:[
      {title:'Fajr — Dawn prayer', body:'Two rakahs, performed after the first light of dawn and before sunrise. The community is encouraged to attend; many mosques hold Fajr in congregation daily.'},
      {title:'Dhuhr — Noon prayer', body:'Four rakahs, performed after the sun has passed its zenith and begins descending. The full name refers to the sun\u2019s decline toward afternoon.'},
      {title:'Asr — Afternoon prayer', body:'Four rakahs, performed when shadows lengthen in the afternoon. It falls between Dhuhr and Maghrib, and is listed in hadith as one of the most rewarded prayers when prayed in congregation.'},
      {title:'Maghrib — Sunset prayer', body:'Three rakahs, performed immediately after sunset. The time window for Maghrib is shorter than the others, typically lasting about 20 minutes.'},
      {title:'Isha — Night prayer', body:'Four rakahs, performed after the sun has completely set and darkness falls. The end time extends until just before dawn, but it is recommended to pray it earlier rather than later in the night.'},
      {title:'Make the intention for each', body:'Before each prayer, decide in your heart which prayer you are performing — no specific words are needed, just a clear intent (niyyah).'},
      {title:'Find the prayer times for your location', body:'Use the Al Adhan app or website, which calculates accurate times based on Islamic methods. Times vary slightly by location, season, and calculation method used.'}
    ]},

  { id:'wudu-mistakes', title:'Common Wudu Mistakes', icon:'droplet', tag:'Good to know', time:'4 min',
    summary:'Pitfalls to avoid when performing ablution — things that invalidate wudu or weaken it.',
    steps:[
      {title:'Not making the intention', body:'Even silently, there must be an intention to purify yourself for prayer. Simply washing without intent does not count as wudu.'},
      {title:'Washing too quickly', body:'Rushing through the motions defeats the purpose. Each limb should be washed at least once, but many schools of thought consider three washings more complete (some schools of thought consider this mandatory, other schools of thought recommend it).'},
      {title:'Leaving a dry spot', body:'Even a small area of the face, arms, or feet left unwashed means wudu is incomplete and invalidates the ablution for prayer.'},
      {title:'Using water that is not pure', body:'The water itself must be ritually pure — not contaminated or questionable in condition.'},
      {title:'Talking excessively while making wudu', body:'While silence is not mandatory, the spiritual focus can be lost with idle chatter. The Prophet ﷺ emphasized mindfulness during ablution.'},
      {title:'Wasting water', body:'The Prophet ﷺ taught moderation — even doing wudu by a river, never use excessive water beyond what cleanses.'},
      {title:'Touching private parts afterward', body:'After completing wudu, touching private parts without a barrier (like clothing) breaks wudu — one of the most commonly overlooked invalidators.'}
    ]},

  { id:'salah-mistakes', title:'Common Prayer Mistakes', icon:'pray', tag:'Good to know', time:'4 min',
    summary:'Errors in salah that weaken it or invalidate it — posture, timing, and focus.',
    steps:[
      {title:'Not facing the Qibla', body:'The direction must be toward the Kaaba in Mecca. Ignorance of direction is forgivable, but deliberately praying away from it invalidates the prayer (most schools of thought permit small angles off-direction for those genuinely confused).'},
      {title:'Rushing through the prayer', body:'Each movement should be unhurried and deliberate. The Prophet ﷺ criticized those who "pecked" their prayers like birds — quick, shallow movements without substance.'},
      {title:'Not completing a full ruku or sujood', body:'The bowing and prostration must be full and clear — bent low enough that it is visibly different from standing or sitting.'},
      {title:'Talking or laughing during prayer', body:'These invalidate the prayer entirely (some schools of thought permit necessary speech in emergencies, other schools of thought maintain strict silence rules).'},
      {title:'Praying with distracting thoughts or wandering mind', body:'While total focus is ideal, some distraction is human. However, deliberately allowing gross inattention weakens the salah (the exact threshold varies by school of thought).'},
      {title:'Praying in impure clothes or place', body:'The garment and ground should be clean. Uncertainty about impurity does not require repetition, but knowingly praying in filth invalidates it.'},
      {title:'Missing the congregation without reason', body:'While not invalidating the prayer itself, missing Jama\u2019ah without excuse is discouraged — the collective prayer carries greater reward.'}
    ]},

  { id:'ramadan-preparation', title:'Preparing for Ramadan', icon:'moon', tag:'Seasonal', time:'4 min',
    summary:'A month before Ramadan: physical, spiritual, and practical steps to enter the month ready.',
    steps:[
      {title:'Review your intention', body:'Clarify why you fast — is it out of habit, cultural practice, or genuine seeking of closeness to Allah? A clear niyyah transforms the month.'},
      {title:'Read about the month ahead', body:'Understanding what Ramadan is — a month of mercy, forgiveness, and Qur\u2019an — helps prepare your mindset.'},
      {title:'Gradually adjust your eating schedule', body:'If you typically eat breakfast, start eating it slightly later; if you eat late at night, shift backward. This eases the transition into fasting.'},
      {title:'Practice shorter fasts', body:'A few days before Ramadan, fast for part of a day to reacquaint your body with hunger and thirst.'},
      {title:'Plan your Qur\u2019an reading', body:'Decide how much you want to recite — a juz a day (one-thirtieth) completes the Qur\u2019an by month\u2019s end, or adjust to your pace.'},
      {title:'Arrange your work and social schedule', body:'Alert your employer if you need adjustment to prayer times; plan meal times with family; reduce non-essential commitments if possible.'},
      {title:'Settle debts and grudges', body:'Entering the month with a clear heart — forgiving those who wronged you, apologizing for your own wrongs — opens the door to receiving mercy.'}
    ]},

  { id:'ramadan-fasting-guide', title:'Ramadan Fasting: A Day-by-Day Guide', icon:'moon', tag:'Seasonal', time:'6 min',
    summary:'What a fasting day looks like — from suhoor to iftar to taraweeh — hour by hour.',
    steps:[
      {title:'Before dawn: Suhoor (pre-dawn meal)', body:'Eat a light but sustaining meal, preferably dates, and drink water. The Prophet ﷺ said suhoor is a blessed meal because it is timed just before fasting (Sahih al-Bukhari). Some schools of thought require eating suhoor, other schools of thought treat it as highly recommended.'},
      {title:'At dawn: Make your intention', body:'Before Fajr begins, intend in your heart to fast. If you intend after Fajr begins, that day does not count as a full fast.'},
      {title:'During the day: Avoid food, drink, and relations', body:'From the first light of dawn until sunset, abstain from eating, drinking, and marital relations. The fast is not merely physical — it is spiritual guard against anger, backbiting, and idle talk.'},
      {title:'Mid-morning: Recite Qur\u2019an and make dua', body:'Use the extra time from not preparing or eating meals to spend with the Qur\u2019an. Any duas made during fasting are said to be answered readily (Jami\u2019 at-Tirmidhi).'},
      {title:'Afternoon: Rest if able', body:'A short nap after Dhuhr prayer conserves energy. Many working adults find this difficult but aim for even 15 minutes of rest.'},
      {title:'At sunset: Break the fast (Iftar)', body:'Do not delay — break your fast immediately when the sun sets. The Prophet ﷺ emphasized haste in this. Traditionally dates and water are the first items eaten, mirroring his own practice.'},
      {title:'After Maghrib: Light meal and prayer', body:'After breaking the fast, eat a moderate meal (not excessive), then head to the mosque for Maghrib prayer.'},
      {title:'Evening: Taraweeh (night prayer)', body:'The special nightly prayer unique to Ramadan, typically 8 to 20 rakahs depending on mosque and school of thought. This is an optional but widely kept tradition.'},
      {title:'Late night: Recite Qur\u2019an and sleep', body:'Spend time with the Qur\u2019an, make duas, and rest well. The goal is balance — full participation without exhaustion.'}
    ]},

  { id:'laylat-qadr', title:'Laylat al-Qadr (Night of Power)', icon:'star', tag:'Seasonal', time:'4 min',
    summary:'The holiest night of the year — when to seek it, how to spend it, and its significance.',
    steps:[
      {title:'Understand its significance', body:'The Qur\u2019an was first revealed on this night, and the Qur\u2019an itself states that worship on this night is worth more than a thousand months (Qur\u2019an 97:3). It is the night most Muslims wait for during Ramadan.'},
      {title:'Know when to seek it', body:'The exact date is unknown by divine wisdom, but it falls in the last ten nights of Ramadan. Most scholars believe it falls on an odd night (21st, 23rd, 25th, etc.) — some point specifically to the 27th.'},
      {title:'Spend the last ten nights in I\u2019tikaf (seclusion)', body:'Many Muslims, especially those who can, retreat to the mosque for the last ten nights, dedicating themselves to worship. While not obligatory, it is a honored tradition (some schools of thought view it as strongly encouraged, other schools of thought as optional).'},
      {title:'Stay awake in prayer and recitation', body:'Stand in tahajjud (night prayer), recite Qur\u2019an slowly, and make lengthy duas. The benefit of this night depends on sincere effort, not mere presence.'},
      {title:'Make heartfelt duas', body:'Ask Allah for forgiveness, guidance, healing, and all that your heart desires. This night is marked as one when duas are especially heard and answered.'},
      {title:'Recite this dua', body:'The Prophet ﷺ taught Aisha a specific dua to recite on Laylat al-Qadr.', arabic:'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', translit:"Allahumma innaka 'afuwwun tuhibbul-'afwa fa'fu 'anni", translation:'O Allah, You are Pardoning and love pardon, so pardon me.'},
      {title:'Share the blessing with others', body:'If you experience or believe you have found the night, keep the blessing humble and private — the spiritual reward is personal with Allah.'}
    ]},

  { id:'eid-prayer-detailed', title:'Eid Prayer (Salat al-Eid) Step by Step', icon:'gift', tag:'Seasonal', time:'5 min',
    summary:'The structure of the Eid prayer — different from the five daily prayers in its format and khutbah.',
    steps:[
      {title:'Arrive early', body:'The Eid prayer typically begins at sunrise (for Eid al-Fitr) or mid-morning (for Eid al-Adha). Arriving early lets you find a place and enjoy the gathering.'},
      {title:'Stand in rows', body:'Unlike other prayers, there is no iqamah called, and rows are simply organized without being perfectly straight (some schools of thought require straighter rows for all prayers, other schools of thought are more lenient for Eid).'},
      {title:'First takbir: Say Allahu Akbar seven times', body:'The imam begins, and the congregation follows, raising hands and saying the takbir seven times at the start. This sets the tone of celebration and remembrance.', arabic:'اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ لَا إِلَٰهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ وَلِلَّهِ الْحَمْدُ', translit:'Allahu akbar, Allahu akbar, la ilaha illallah, wallahu akbar, Allahu akbar, wa lillahil-hamd', translation:'Allah is Greatest, Allah is Greatest, there is no god but Allah, and Allah is Greatest, Allah is Greatest, and to Allah belongs all praise.'},
      {title:'Lower your hands and begin silently', body:'After the seven takbirs, lower your hands, and the imam begins the prayer silently without an audible Qur\u2019an recitation (this is a key difference from daily prayers).'},
      {title:'Second takbir: Say Allahu Akbar five times', body:'After the first ruku, the imam rises and says takbir five times before bowing again.'},
      {title:'Two rakahs total', body:'Unlike daily four-rakah prayers, Eid prayer consists of only two rakahs, following a simpler structure.'},
      {title:'Khutbah (sermon) after prayer', body:'After the prayer ends with salam, the imam gives a khutbah (sermon) addressing the community. This is the main teaching moment of Eid.'},
      {title:'Greet and embrace others', body:'After prayer, it is customary and encouraged to greet fellow worshippers warmly, embrace close friends and family, and exchange wishes.'}
    ]},

  { id:'hajj-umrah-basics', title:'Hajj and Umrah Basics', icon:'mosque', tag:'Seasonal', time:'5 min',
    summary:'An introduction to the two pilgrimages to Mecca — their timing, intent, and essential steps.',
    steps:[
      {title:'Understand Hajj (the major pilgrimage)', body:'Hajj is one of the Five Pillars of Islam, obligatory once in a lifetime on those who are physically and financially able. It takes place in the Islamic month of Dhul-Hijjah, typically 4\u20136 days.'},
      {title:'Understand Umrah (the minor pilgrimage)', body:'Umrah is a voluntary pilgrimage to Mecca that can be performed at any time of year, taking only a few hours to complete.'},
      {title:'Enter ihram (sacred state)', body:'Before approaching Mecca or the pilgrim boundary (Miqat), don the ihram garments (two simple white sheets for men, or modest clothing for women) and make the niyyah (intention) to perform Hajj or Umrah.'},
      {title:'Recite the Talbiyah', body:'While in ihram, continuously recite the pilgrim\u2019s call.', arabic:'لَبَّيْكَ اللَّهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ الْحَمْدَ وَالنِّعْمَةَ لَكَ وَالْمُلْكُ، لَا شَرِيكَ لَكَ', translit:'Labbayka Allahumma labbayk, labbayka la sharika laka labbayk, innal hamda wa ni\u2019mata laka wal-mulk, la sharika lak', translation:'Here I am, O Allah, here I am. Here I am, You have no partner, here I am. Surely all praise and favor is Yours, and dominion — You have no partner.'},
      {title:'Perform Tawaf (circumambulation)', body:'Circle the Kaaba seven times counterclockwise, starting from the Black Stone corner. This is done for both Hajj and Umrah.'},
      {title:'Perform Sa\u2019y (walking between Safa and Marwah)', body:'Walk back and forth between the two hills (Safa and Marwah) seven times. This commemorates Hagar\u2019s desperate search for water (both Hajj and Umrah include this).'},
      {title:'For Hajj only: Stand at Arafah', body:'On the 9th of Dhul-Hijjah, pilgrims gather on the plain of Arafah and spend the day in worship, prayer, and dua. This is the spiritual climax of Hajj.'},
      {title:'For Hajj only: Night at Muzdalifah and pebble-throwing', body:'Spend the night of the 10th at Muzdalifah, then proceed to Mina to throw pebbles at stone pillars (jamrah) — symbolic rejection of evil — over the course of two or three days.'},
      {title:'Sacrifice an animal (for Hajj)', body:'For Hajj, an animal (sheep, goat, cow, or camel) is sacrificed, with the meat distributed to family, friends, and the poor. This commemorates Abraham\u2019s willingness to sacrifice his son.'}
    ]},

  { id:'death-preparation', title:'Islamic Death and Dying Preparation', icon:'heart', tag:'Life Events', time:'5 min',
    summary:'How Islam approaches the end of life — both practical preparation and the care of the dying.',
    steps:[
      {title:'Know it is coming', body:'The Qur\u2019an reminds us repeatedly that every soul will taste death. Awareness of mortality is not morbid but clarifying — it focuses priorities and encourages repentance while able.'},
      {title:'Update your will and affairs', body:'Make clear who your beneficiaries are, what debts must be settled, and any final wishes. While not an Islamic mandate per se, good planning honors dependents left behind.'},
      {title:'Keep repentance current', body:'The Prophet ﷺ advised frequently seeking forgiveness (istighfar) — not waiting for a deathbed to make peace with Allah. This is a lifelong habit, not a last-minute gesture.'},
      {title:'When someone is dying: Recite Surah Yasin', body:'It is customary and encouraged to recite Surah Yasin (chapter 36) at the bedside of the dying — the Prophet ﷺ recommended this (Jami\u2019 at-Tirmidhi).'},
      {title:'Position the body toward Qibla', body:'If the dying person loses consciousness, gently position them facing Mecca. If not possible, the intention counts.'},
      {title:'Prompt them gently to recite the Shahada', body:'Softly remind them of the declaration of faith — "La ilaha illallah, Muhammad rasulullah" — without pressure or insistence (Sahih Muslim).'},
      {title:'After death: Perform Ghusl', body:'The body is ritually washed (ghusl) by family or designated community members of the same gender, in a specific sequence, with respect and gentleness (the exact order varies between schools of thought).'},
      {title:'Wrap in Kafan (shroud)', body:'The body is wrapped in simple white cloth — no expensive coffin or ornamentation. The focus is humility and equality before Allah.'},
      {title:'Pray Salat al-Janazah', body:'The funeral prayer is performed standing (not bowing or prostrating), making duas for the deceased\u2019s forgiveness and mercy.'},
      {title:'Bury within a day', body:'Burial should not be delayed — the Prophet ﷺ taught to avoid unnecessary waiting. The body is placed in the ground, and grief is expressed while avoiding excessive wailing.'}
    ]},

  { id:'mourning-etiquette', title:'Mourning Etiquette (Iddah and After)', icon:'moon', tag:'Life Events', time:'4 min',
    summary:'How to grieve Islamically — what is encouraged, what to avoid, and how to honor the deceased.',
    steps:[
      {title:'Know the mourning period (Iddah)', body:'For a spouse, the mourning period is 4 months and 10 days. For other close relatives, there is no fixed Islamic period, though cultural practices vary. What matters is the quality of grief, not its duration.'},
      {title:'Make dua for forgiveness for the deceased', body:'The most beneficial thing for the dead is the duas of the living. Regular duas of forgiveness are encouraged for all departed loved ones.', arabic:'رَبِّ اغْفِرْ لِي وَلِوَالِدَيَّ وَلِمَنْ دَخَلَ بَيْتِي مُؤْمِنًا', translit:'Rabbi ighfir li wa li walidayya wa liman dakhal bayti mu\u2019minan', translation:'My Lord, forgive me and my parents and whoever enters my house believing.'},
      {title:'Give charity on their behalf', body:'Sadaqah (voluntary charity) offered with the intention that its reward reaches the deceased is encouraged (Sahih Muslim). Waqf (endowed charity) is also a way to provide ongoing benefit.'},
      {title:'Avoid extravagant mourning displays', body:'The Prophet ﷺ taught against excessive wailing, tearing clothes, or public displays of grief that cross into despair of Allah\u2019s mercy. Expression is human; despair is discouraged.'},
      {title:'Continue their good deeds if able', body:'If the deceased had unfinished charitable work or prayer goals, completing them on their behalf is seen as a beautiful way to honor their memory and extend their legacy.'},
      {title:'Visit their grave', body:'Visiting the grave to make dua for them and remember them is permissible and encouraged (some schools of thought see it as strongly recommended, other schools of thought leave it optional). Avoid elaborate grave decorations or excessive visiting.'},
      {title:'Speak well of them', body:'The Prophet ﷺ advised speaking only good of the dead. Mentioning their virtues and positive impact is part of honoring them.'}
    ]},

  { id:'menstruation', title:'Menstruation (Haydh)', icon:'moon', tag:'Women', time:'4 min',
    summary:'Islamic guidance on menstruation — what changes in worship, what doesn\'t, and maintaining dignity.',
    steps:[
      {title:'Understand haydh (menstruation)', body:'In Islamic law, menstruation is a natural state, not impurity of character. A menstruating woman remains a full believer with all spiritual standing; only certain acts of worship are paused, not her value.'},
      {title:'Pause salah (prayer)', body:'During menstruation, the five daily prayers are not performed. This is not a punishment but a exemption — you are not required, and performing them during this time does not count. The missed prayers are not made up afterward (Sahih Muslim).'},
      {title:'Pause fasting during Ramadan', body:'Days missed due to menstruation are made up after Ramadan ends, at a time of your choosing (Sahih al-Bukhari). This is among the most well-known exemptions in Islamic law.'},
      {title:'Continue Qur\'an recitation and duas', body:'You can recite Qur\'an from memory, make duas, listen to recitation, and engage in all spiritual reflection. The exemption is specific to ritual prayer and fasting, not Islamic practice broadly (some scholars differ on physical contact with the Qur\'an mushaf itself during menstruation).'},
      {title:'Maintain intimacy boundaries with spouse', body:'Sexual intercourse is forbidden during menstruation (Qur\'an 2:222). Other forms of affection and closeness are permissible and encouraged — the relationship remains warm and present.'},
      {title:'Continue daily life normally', body:'Work, study, socializing, and all ordinary activities continue as usual. There is no requirement to isolate or treat yourself differently in public or family life.'},
      {title:'Make up the fasts, not the prayers', body:'The key difference: fasting days are made up later; prayer days are not. This reflects Islamic jurisprudence across all schools of thought.'},
      {title:'Know the duration', body:'Menstruation typically lasts 3-10 days (some schools of thought set the minimum at 3 days and maximum at 10, other schools of thought are more flexible with variations). Once bleeding stops, you resume all worship.'},
      {title:'Perform ghusl when it ends', body:'Once menstruation ends, perform a full ritual wash (ghusl) before resuming prayer and fasting. This marks the return to the full practice of worship.'}
    ]},

  { id:'postpartum', title:'Post-Partum Period (Nifas)', icon:'heart', tag:'Women', time:'4 min',
    summary:'The Islamic postpartum period — rest, recovery, and when worship resumes.',
    steps:[
      {title:'Understand nifas (postpartum bleeding)', body:'The bleeding and discharge after childbirth is called nifas. Like menstruation, it exempts a woman from prayer and fasting during its duration, and carries no spiritual diminishment.'},
      {title:'Duration of nifas', body:'Nifas typically lasts up to 40 days (some schools of thought set it strictly at 40 days, other schools of thought permit variation based on individual circumstance, typically between 21-40 days). Once bleeding stops before 40 days, you may resume worship.'},
      {title:'Pause salah and fasting', body:'Like menstruation, prayer and fasting are paused during nifas. Days of Ramadan missed due to nifas are made up after the postpartum period and recovery allow.'},
      {title:'Continue duas and Qur\'an reflection', body:'Spiritual connection through memory and meditation continues; the exemption is limited to formal ritual prayer and fasting.'},
      {title:'Rest and recover physically', body:'The postpartum period is recognized in Islamic teaching as a time of physical recovery. The exemption from prayer reflects the reality of healing and the demands of newborn care.'},
      {title:'Maintain spousal boundaries', body:'Sexual intercourse is forbidden during nifas, similar to menstruation. The husband\'s role is support and patience during this vulnerable time.'},
      {title:'Perform ghusl when nifas ends', body:'Once the postpartum bleeding ceases, perform ghusl to resume full worship — salah, fasting, and all acts of devotion.'},
      {title:'Know you\'re not weaker for needing rest', body:'The Islamic framework recognizes biological reality without shame. Recovery is honored, not hidden. Asking for and accepting help is part of the sunnah example of how families supported mothers historically.'}
    ]},

  { id:'pregnancy-etiquette', title:'Pregnancy Etiquette & Care', icon:'heart', tag:'Women', time:'4 min',
    summary:'How Islam honors pregnancy — spiritual practice, rights, and self-care during this sacred time.',
    steps:[
      {title:'Know pregnancy is honored in Islam', body:'The Qur\'an speaks of the carrying and nursing of children as a hardship and a kindness (Qur\'an 31:14). Pregnancy is recognized as significant spiritually and physically.'},
      {title:'Continue your regular prayers', body:'Pregnancy does not excuse prayer. Modify as needed for comfort — sit instead of stand, reduce bowing depth — but maintain your connection to salah throughout.'},
      {title:'Fast during Ramadan if able', body:'If fasting is difficult or harmful to your health or the baby\'s, you may break the fast and make up the days later (Qur\'an 2:184). This is a mercy, not a failure — consult your body and your doctor.'},
      {title:'Make duas for easy pregnancy and delivery', body:'Asking Allah for ease during pregnancy and childbirth is encouraged. Many duas exist for protection of mother and child.', arabic:'رَبِّ اجْعَلْ لِي مِنْ لَدُنْكَ نَسْلًا طَيِّبًا إِنَّكَ سَمِيعُ الدُّعَاءِ', translit:'Rabbi ij\'al li min ladunka naslan tayyiba innaka Samiul-du\'a', translation:'My Lord, grant me from You a good offspring. Indeed, You are the Hearer of supplication.'},
      {title:'Accept help and support', body:'The Prophet ﷺ emphasized the role of family and community in supporting pregnant women. Accepting help is not weakness — it is part of the Islamic community structure.'},
      {title:'Recite Qur\'an for the baby', body:'Reciting the Qur\'an, especially Surah Maryam (the chapter about Mary, mother of Jesus), is a practice many pregnant women maintain for spiritual connection with the child.'},
      {title:'Prepare practically and spiritually', body:'Alongside practical preparation for birth, spend time in dhikr, dua, and reflection. The spiritual preparation is as important as the physical.'},
      {title:'Know your rights', body:'Islam gives pregnant women specific rights: kindness from spouse, care from family, exemption from fasting if needed, and the expectation that others lighten her load during this time.'}
    ]},

  { id:'women-leadership', title:'Women in Islamic Leadership', icon:'users', tag:'Women', time:'4 min',
    summary:'Roles, rights, and Islamic history of women in decision-making and spiritual teaching.',
    steps:[
      {title:'Know women were teachers and advisors from the start', body:'Aisha, Umm Salamah, and other Sahabi women taught hadith, gave fatwas, and advised the Prophet ﷺ and the early community. Their scholarship is still studied today.'},
      {title:'Understand the difference between roles and worth', body:'Some roles in prayer leadership are reserved for men (imam of congregational prayer); this is a matter of fiqh, not an assessment of spiritual capability or intellect. Different roles reflect different contexts, not hierarchy of value.'},
      {title:'Lead in your sphere authentically', body:'Women lead in education, community building, family guidance, charitable work, and many professional roles. Islamic history is full of women scholars, judges, and advisors (some schools of thought permit women qadis, other schools of thought restrict this, but the scholarly discussion itself reflects serious engagement).'},
      {title:'Teaching is an honored role', body:'A woman teaching Islamic knowledge to men and women alike carries full reward. Umm Salamah\'s hadith are in Sahih al-Bukhari — she is a full authority in the tradition.'},
      {title:'Speak up in family decisions', body:'The Qur\'an calls for shura (consultation); a wife\'s counsel in family matters is Islamic practice, not indulgence. Your voice matters in decisions that affect you and your children.'},
      {title:'Know your rights in marriage and divorce', body:'Islam grants women specific marriage rights: mahr (bridal gift), financial support, kind treatment, and the right to seek khul\' (woman-initiated divorce) if the marriage is untenable.'},
      {title:'Don\'t confuse culture with Islam', body:'Practices restricting women\'s speech, education, or movement are often cultural, not Islamic. The Qur\'an and hadith do not forbid women from learning, working, or contributing to community decisions.'},
      {title:'Seek knowledge to lead better', body:'Whatever your role — mother, teacher, professional, community member — Islamic knowledge deepens your ability to lead authentically and serve your community.'}
    ]},

  { id:'youth-identity', title:'Islamic Identity as a Young Person', icon:'star', tag:'Youth', time:'4 min',
    summary:'Navigating faith while growing up — finding your Islamic identity in a diverse world.',
    steps:[
      {title:'Your faith is your own journey', body:'You will inherit beliefs from family, but faith that sticks is faith you choose and understand yourself. Ask questions, read, think deeply — this is not rebellion, it\'s spiritual maturity.'},
      {title:'Find your why for the five pillars', body:'Don\'t pray just because you\'re told to. Understand why salah matters to you. When you own the reason, the practice becomes alive instead of a chore.'},
      {title:'Build friendships with other Muslim youth', body:'Peer support is real. Friends who share your faith can make the difference between isolation and belonging. Seek out youth groups, camps, or communities where you feel seen.'},
      {title:'It\'s okay to be different from peers', body:'If your friends aren\'t Muslim, that\'s fine — you can be close while having different practices. If they pressure you to abandon your faith, that\'s a sign to reassess those friendships. True friends respect your values.'},
      {title:'Ask hard questions about your faith', body:'Doubts aren\'t a sign of weak faith — they\'re a sign you\'re thinking. Talk to teachers, imams, or trusted mentors about the things that confuse you. Honest questions deserve honest answers.'},
      {title:'Your body is yours to protect', body:'Modest dress, avoiding dating culture, waiting for marriage — these aren\'t restrictions meant to control you, they\'re frameworks to protect your autonomy and dignity. Own these choices as yours.'},
      {title:'Balance your culture and your faith', body:'If your family\'s culture and Islam differ, you might feel torn. It\'s possible to honor your heritage while following your own understanding of Islam. You\'re not betraying either by choosing thoughtfully.'},
      {title:'Find role models who look like you', body:'Seek out Muslim youth, professionals, activists who share your background or struggles. Seeing people like you living Islamic lives authentically makes the path feel possible.'}
    ]},

  { id:'youth-relationships', title:'Youth & Relationships (Islamic Perspective)', icon:'heart', tag:'Youth', time:'4 min',
    summary:'How Islam approaches attraction, dating, and marriage — from a young person\'s perspective.',
    steps:[
      {title:'Attraction is normal, not sinful', body:'Feeling drawn to someone is a human reality, not a sign of weak faith. How you act on that attraction matters; the feeling itself is neutral.'},
      {title:'Know what Islam forbids', body:'Premarital sexual relationships are forbidden. Dating in the Western sense — alone with someone you\'re not related to, with romantic and physical intimacy — crosses Islamic boundaries (some schools of thought permit chaperoned meetings with intent to marry, other schools of thought advise stricter separation).'},
      {title:'Understand the reasons behind these limits', body:'The restrictions exist to protect: your emotional security, your family\'s honor, your future marriage, and your ability to make clear-headed decisions about partnership. They\'re not arbitrary.'},
      {title:'Talk to parents early', body:'If you\'re serious about someone, involve your family. Parents aren\'t meant to be obstacles — they\'re meant to help ensure the person and the process are sound. The conversation might be awkward, but it\'s necessary.'},
      {title:'Marriage is the framework for commitment', body:'If you want a serious relationship, marriage is the Islamic goal. This doesn\'t mean rushing — it means being honest about intent and timeline.'},
      {title:'You can know someone before marriage', body:'Chaperoned meetings, conversations with family present, and getting to know someone\'s character, values, and family are all encouraged. You\'re not going in blind; you\'re being thoughtful.'},
      {title:'Your consent matters', body:'Islam requires a woman\'s explicit consent to a marriage contract. No guardian can force you, and if you feel pressured, that\'s a red flag. Your agreement must be genuine.'},
      {title:'It\'s okay to say no', body:'If someone doesn\'t feel right for you, saying no is Islamic and wise. Rushing into marriage to avoid loneliness or pressure is how people end up miserable. Take your time and trust your instincts.'}
    ]},

  { id:'youth-career', title:'Career & Work for Young Muslims', icon:'hand', tag:'Youth', time:'4 min',
    summary:'Finding and building a career that aligns with your faith and values.',
    steps:[
      {title:'Work is worship if your intention is right', body:'Seeking an honest livelihood to support yourself and your family is Islamic. Career ambition is not greed if the intent is responsibility and excellence.'},
      {title:'Halal income matters more than status', body:'A modest job with halal income is better than a lucrative one built on haram (forbidden) practices. Don\'t compromise your integrity for a paycheck or a title.'},
      {title:'Find fields that align with your values', body:'If you care about justice, consider law, activism, or civil service. If you care about healing, medicine or counseling might fit. If you care about education, teaching or research. Align your work with what matters to you.'},
      {title:'You don\'t have to hide your faith at work', body:'Praying at work, taking off for Eid, mentioning your Islamic values — these are protected in most workplaces and are part of your identity. Don\'t shrink yourself.'},
      {title:'Avoid industries that contradict your faith', body:'Banks dealing in riba (interest), entertainment industries you\'re uncomfortable with, or roles that exploit others — these might pay well but will cost you spiritually long-term.'},
      {title:'Seek mentors who share your values', body:'Finding people further along who\'ve built careers while staying true to their faith gives you a roadmap and moral support.'},
      {title:'Build your skills intentionally', body:'Invest in education, certifications, and skills that open doors. The Prophet ﷺ praised those who were excellent at their craft. Your professionalism is part of your Islamic identity.'},
      {title:'Remember: career is one part of life', body:'Success in work doesn\'t define you. A good job supports a good life, but it doesn\'t replace family, faith, or community. Keep perspective.'}
    ]},

  { id:'tawheed-basics', title:'Tawheed (Islamic Monotheism) Foundations', icon:'star', tag:'Spiritual', time:'5 min',
    summary:'The central principle of Islam — what it means to believe in one God and live by that belief.',
    steps:[
      {title:'Tawheed means unity of God', body:'At its core, tawheed is the belief that Allah is one — singular, unique, without partners or equals. This is the first principle of Islam, stated in the Shahada.', arabic:'لَا إِلَٰهَ إِلَّا اللَّهُ مُحَمَّدٌ رَسُولُ اللَّهِ', translit:'La ilaha illallah, Muhammadun rasulullah', translation:'There is no god but Allah, and Muhammad is His messenger.'},
      {title:'Understand the three dimensions of tawheed', body:'Tawheed of Allah\'s lordship (He alone creates and sustains), tawheed of His names and attributes (He has perfect qualities), and tawheed of worship (we worship Him alone, not created things). All three are interwoven.'},
      {title:'Avoid shirk (associating partners with God)', body:'Shirk is the opposite of tawheed — putting anything or anyone on equal standing with Allah. This includes idols, saints, money, desires, or any created thing. Shirk is the one unforgivable sin if a person dies without repenting (Qur\'an 4:48).'},
      {title:'Distinguish between major and minor shirk', body:'Major shirk is obvious — worshipping idols or calling on the dead for help. Minor shirk is subtle — showing off in good deeds, seeking praise from people instead of from Allah, or trusting something other than Allah (some schools of thought debate the boundaries, but the principle is clear).'},
      {title:'Tawheed means trusting only Allah\'s power', body:'While you plan and work, ultimate control belongs to Allah alone. You do not fear loss because only He provides; you do not fear people because only He judges. This trust (tawakkul) is the fruit of tawheed.'},
      {title:'Live tawheed, don\'t just believe it', body:'Tawheed isn\'t intellectual assent alone — it shapes how you live. When you truly believe Allah is one and all-powerful, you pray even when no one is watching, you speak truth even when it costs you, you do good even when no one will praise you.'},
      {title:'Reflect on creation as a sign of tawheed', body:'The Qur\'an repeatedly points to the sky, mountains, seas, and all creation as evidence of Allah\'s oneness. Contemplating creation deepens tawheed in the heart.'},
      {title:'Remember tawheed when you stumble', body:'Tawheed doesn\'t mean perfection — it means returning. When you sin or doubt, tawheed is the foundation that brings you back: there is only Allah to turn to, only His mercy available.'}
    ]},

  { id:'shirk-avoidance', title:'Understanding Shirk (Polytheism) & Avoiding It', icon:'shield', tag:'Spiritual', time:'4 min',
    summary:'Shirk is the greatest sin in Islam — learning what it is and how to guard against subtle forms.',
    steps:[
      {title:'Shirk is putting anything equal to or above Allah', body:'The Qur\'an defines shirk as associating partners with Allah in worship, power, or authority. It ranges from obvious (idol worship) to subtle (trusting wealth more than Allah).'},
      {title:'Know the major forms of shirk', body:'Calling on saints or the dead for help, making statues or idols for worship, believing in astrology as determining fate, or worshipping prophets or angels — these are explicit shirk that nullify tawheed.'},
      {title:'Recognize subtle shirk in daily life', body:'Seeking approval from people more than from Allah, showing off your good deeds, trusting your plans without trusting Allah, or fearing people more than fearing Allah — these are minor shirk that weaken your faith without necessarily invalidating it (some schools of thought debate severity).'},
      {title:'Guard your heart against hidden shirk', body:'The Prophet ﷺ said hidden shirk is like an ant walking on a black stone in the darkness of night — easy to miss. Regularly check your intentions: are you doing good for Allah, or for reputation?'},
      {title:'Distinguish between seeking blessing and shirk', body:'Asking for the intercession of the Prophet ﷺ or righteous people (tawassul) is debated among scholars (some schools of thought permit it, others forbid it as a form of shirk). Know your school\'s position and stay within it.'},
      {title:'Don\'t fear shirk accusation without reason', body:'Some people worry constantly about committing hidden shirk. This anxiety itself can become problematic. Shirk requires actual belief or intent — an honest mistake or momentary thought is not shirk.'},
      {title:'Repent if you fear you\'ve committed shirk', body:'If you realize you\'ve trusted something other than Allah or called on someone other than Him, repent sincerely. Allah forgives all sins except shirk if repented before death (Qur\'an 4:48).'},
      {title:'Strengthen tawheed to guard against shirk', body:'The best defense against shirk is a strong, living belief in tawheed. When Allah is truly your focus, everything else naturally falls into proper proportion.'}
    ]},

  { id:'innovation-bidah', title:'Innovation in Religion (Bid\'ah) & Staying True', icon:'book', tag:'Spiritual', time:'4 min',
    summary:'What constitutes forbidden innovation in Islam, and how to distinguish it from permissible change.',
    steps:[
      {title:'Understand bid\'ah (religious innovation)', body:'Bid\'ah is introducing something new into the religion that Allah and His Prophet ﷺ did not prescribe. The Prophet ﷺ said every innovation is misguidance (Sunan Ibn Majah). However, bid\'ah in non-religious matters is permissible.'},
      {title:'Know the distinction: religion vs. culture', body:'Adding new Qur\'anic verses, creating new prayers, or inventing new obligatory acts are bid\'ah. But innovations in how you organize daily life, use technology, or conduct business are not bid\'ah — they\'re human progress.'},
      {title:'Distinguish between bid\'ah and ijtihad (scholarly reasoning)', body:'When a scholar applies Islamic principles to a new situation (like using cameras for taraweeh during lockdown), that\'s ijtihad, not bid\'ah. When someone creates an entirely new religious practice without scriptural basis, that\'s bid\'ah (some schools of thought are stricter, others more lenient about what qualifies).'},
      {title:'Watch out for added rituals dressed as Sunnah', body:'Some practices are presented as Islamic but lack clear Qur\'anic or hadith basis — excessive rituals on certain days, elaborate commemorations, or repeated acts with specific numbers (like 313 salat-salam on specific occasions) fall into this category. Question their source.'},
      {title:'Follow established madhabs to stay grounded', body:'The four schools of thought (Hanafi, Maliki, Shafi\'i, Hanbali) represent centuries of scholarly consensus. Following one school helps you avoid wandering into innovation while still having flexibility within that framework.'},
      {title:'Be cautious of charismatic new movements', body:'Movements that claim to have rediscovered something lost or introduce practices unknown to the earliest generations should be examined carefully against Qur\'an and authentic hadith.'},
      {title:'Not everything old is sunnah, not everything new is bid\'ah', body:'Some old practices lack basis; some new approaches (like modern Islamic education methods) are permissible adaptations. Judge by Qur\'an and hadith, not by age.'},
      {title:'Bid\'ah can be sincere but still wrong', body:'Someone might innovate out of genuine love for Islam and the Prophet ﷺ, but sincere intention doesn\'t make innovation permissible. It\'s the adherence to Qur\'an and Sunnah that matters, not how much someone cares.'}
    ]},

  { id:'common-mistakes', title:'Common Mistakes in Islamic Practice', icon:'shield', tag:'Good to know', time:'6 min',
    summary:'A cross-topic look at the mistakes Muslims most often make in worship, and how small corrections lead to more meaningful practice.',
    deeperDive:'Most mistakes in Islamic practice fall into three categories: mechanical errors (getting the steps wrong), timing errors (doing the right thing at the wrong time), and intention errors (going through the motions without presence). Mechanical errors are the easiest to fix — a teacher or a guide corrects them in minutes. Intention errors are the hardest, because they require ongoing self-awareness rather than a one-time correction. The Prophet ﷺ said that the first matter to be judged on the Day of Resurrection would be prayer, and if it was sound, the rest of a person\u2019s deeds would be sound (Sunan an-Nasa\u2019i) \u2014 which is why so much attention in the tradition goes to getting salah right, not just performed. A helpful mental model: treat every mistake as information, not failure. Scholars across the four madhabs agree that Allah does not burden a soul beyond its capacity (Qur\u2019an 2:286), and that sincere effort followed by correction is itself an act of worship.',
    steps:[
      {title:'Rushing through worship', body:'Whether it\'s wudu, salah, or Qur\'an recitation, speed is the most common mistake across the board. The Prophet ﷺ corrected a man who prayed too quickly, telling him to go back and pray again because he had not truly prayed (Sahih al-Bukhari).'},
      {title:'Not knowing the "why" behind an act', body:'Performing rituals without understanding their purpose leads to mechanical worship. Take time to learn the wisdom (hikmah) behind each act — it transforms repetition into genuine devotion.'},
      {title:'Assuming one method is the only correct one', body:'Many differences between Muslims are legitimate differences between schools of thought (madhabs), not one side being wrong. Mistaking khilaf (valid difference) for error creates unnecessary division.'},
      {title:'Neglecting the heart while perfecting the form', body:'It\'s possible to have flawless outward technique — correct wudu, correct prayer positions — while the heart is distracted or indifferent. Both form and presence (khushu) matter.'},
      {title:'Delaying repentance for small sins', body:'Many people wait for a "big" sin to repent, while small sins accumulate. The Prophet ﷺ warned against belittling small sins, comparing them to sticks that build a fire (Musnad Ahmad).'},
      {title:'Comparing your practice to others', body:'Worship is not a competition. Excessive comparison — feeling superior or inferior based on how much others pray or fast — misses the point of sincere, personal devotion to Allah.'},
      {title:'Treating mistakes as permanent failures', body:'A single missed prayer, a broken fast, or an imperfect recitation does not erase your standing with Allah. Correction and consistency matter more than a flawless record.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on prayer correction'},{book:'Sunan an-Nasa\u2019i', ref:'Hadith on Day of Judgment and prayer'},{book:'Riyad as-Salihin', ref:'Chapters on sincerity and repentance'}],
    keywords:['common mistakes in islam','islamic practice errors','fixing prayer mistakes','worship mistakes muslims make'],
    snippet:'The most common mistakes in Islamic practice — from rushing worship to comparing yourself to others — and how small corrections lead to deeper, more meaningful devotion.'},


  { id:'praying-in-car', title:'Praying While Traveling by Car', icon:'plane', tag:'Scenario', time:'4 min',
    summary:'How to maintain your prayers on road trips, commutes, and long drives without missing a Salah.',
    deeperDive:'Islamic law was never designed around the assumption of constant travel, yet it built in enough flexibility that a believer is never truly excused from prayer entirely — only its form adapts. The scholars call this rukhsah (concession), a mercy built into the religion rather than a loophole. Practically, this means the driver of a car should treat the vehicle the way earlier generations treated a camel or a ship: a moving platform on which worship still happens, just modified. The psychological benefit of knowing this in advance is real — many people avoid praying while traveling simply because they assume it is impossible, when in fact Islamic law anticipated this exact situation over a thousand years before the automobile existed.',
    steps:[
      {title:'Pull over safely if you can', body:'Whenever possible and safe, stop at a rest area, gas station, or quiet spot to pray with full movements — this is always preferable to praying while driving.'},
      {title:'If stopping isn\'t possible, pray seated', body:'If you cannot safely stop (heavy traffic, no safe shoulder, tight schedule), you may pray while seated in the car, facing the Qibla as best you can, using head nods for ruku and sujood instead of full movements (some schools of thought are more lenient about this concession than others).'},
      {title:'Combine prayers when traveling long distances', body:'If your journey qualifies as travel under Islamic law, you may combine Dhuhr with Asr, and Maghrib with Isha, at one of their times — reducing how many stops you need to make.'},
      {title:'Use a Qibla app for direction', body:'Most prayer time apps include a Qibla compass using your phone\'s GPS — check it before starting to pray, especially on unfamiliar roads.'},
      {title:'Keep a small prayer mat or clean cloth in the car', body:'A collapsible mat takes little space and ensures a clean surface at rest stops, avoiding uncertainty about the ground\'s cleanliness.'},
      {title:'Plan fuel and rest stops around prayer times', body:'If you know Dhuhr or Asr is approaching, choose your next stop with prayer facilities or a quiet spot in mind — this avoids the last-minute scramble.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on prayer during travel and necessity'},{book:'Reliance of the Traveller', ref:'Section on prayer concessions'}],
    keywords:['praying in car islam','salah while driving','prayer during road trip muslim','can i pray sitting in car'],
    snippet:'How to pray while driving or traveling by car — from pulling over safely to combining prayers and using seated prayer when needed.'},

  { id:'wudu-limited-water', title:'Making Wudu with Limited Water', icon:'droplet', tag:'Scenario', time:'3 min',
    related:['wudu','tayammum','praying-in-car'],
    summary:'How to perform valid ablution when water is scarce, during travel, or in emergency situations.',
    steps:[
      {title:'Know the minimum requirement', body:'Wudu requires washing each limb only once at minimum — the three-times method is preferred, not obligatory. In water-scarce situations, one wash per limb, done thoroughly, is fully valid.'},
      {title:'Use a cup or bottle rather than a running tap', body:'Pouring small controlled amounts from a bottle over each limb uses far less water than a running faucet, while still ensuring full coverage.'},
      {title:'Prioritize covering every required area over splashing generously', body:'Thin, careful coverage over the face, arms, head-wipe, and feet matters more than the volume of water used — a wet hand wiped fully counts.'},
      {title:'If water is truly unavailable, move to tayammum', body:'When there is no accessible water at all — not just inconvenient water — tayammum (dry ablution with clean earth or dust) becomes the valid substitute (Qur\'an 5:6).'},
      {title:'Carry a small reusable water bottle when traveling', body:'A portable bottle dedicated to wudu solves most limited-water situations before they become a problem, especially at work, on hikes, or during flights.'},
      {title:'Use wet wipes or a damp cloth only as a last resort before tayammum', body:'A truly damp cloth can technically substitute for water in extreme scarcity for some scholars, but this is a minority position — tayammum is the safer, agreed-upon fallback when water genuinely runs out.'}
    ],
    sources:[{book:'Qur\'an', ref:'5:6, verse on ablution and tayammum'},{book:'Fiqh us-Sunnah', ref:'Chapter on the minimum requirements of Wudu'}],
    keywords:['wudu with little water','ablution water scarcity','minimal water wudu islam','how to save water during wudu'],
    snippet:'How to perform a fully valid wudu using minimal water — the real minimum requirements, and when to switch to tayammum instead.'},

  { id:'praying-at-work', title:'Praying at Work or School', icon:'hand', tag:'Scenario', time:'4 min',
    summary:'Navigating prayer times, space, and conversations with employers or teachers about your daily Salah.',
    steps:[
      {title:'Know your prayer window before your shift', body:'Check prayer times for the day in advance so you know exactly when Dhuhr or Asr will fall during work hours, rather than discovering it mid-shift.'},
      {title:'Ask for a quiet space in advance, not last-minute', body:'A calm conversation with HR or a manager ahead of time — explaining you need 5-10 minutes at a specific time — is usually well received and avoids awkward last-minute requests.'},
      {title:'Use empty rooms, stairwells, or your car if no prayer room exists', body:'Many workplaces don\'t have a designated space; a quiet corner, an empty meeting room, or your parked car can all work as a private prayer spot.'},
      {title:'Combine prayers if your schedule genuinely doesn\'t allow separate times', body:'If Dhuhr and Asr both fall within a shift with no reasonable break, some scholars permit combining them in situations of genuine hardship (this is more restrictive than travel combining — check with a knowledgeable source for your specific case).'},
      {title:'Keep wudu simple with a bathroom sink', body:'Most workplace and school bathrooms are sufficient for wudu — a paper towel afterward avoids dripping on shared spaces.'},
      {title:'Know your rights', body:'In many countries, requesting brief prayer breaks is a protected religious accommodation — familiarize yourself with your workplace or school\'s policy if you\'re unsure.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on excuses for combining prayers'}],
    keywords:['praying at work islam','muslim prayer school','asking employer for prayer time','salah during shift'],
    snippet:'How to fit daily prayers into a work or school schedule — finding space, talking to employers, and knowing when combining prayers is valid.'},

  { id:'finding-jamaah-away', title:'Finding Jama\'ah While Away From Home', icon:'mosque', tag:'Scenario', time:'3 min',
    related:['travel','mosque-etiquette','jumuah'],
    summary:'Locating a mosque and congregational prayer when traveling, relocating, or visiting somewhere new.',
    steps:[
      {title:'Search before you arrive, not after', body:'A quick search for mosques at your destination before you travel saves scrambling once you\'re there, especially in unfamiliar cities.'},
      {title:'Use the Find a Mosque feature', body:'Once available, this app feature will help locate nearby mosques and their Jama\'ah times directly from your location.'},
      {title:'Ask locally — taxi drivers, hotel staff, and shopkeepers often know', body:'In many cities, especially with visible Muslim communities, asking around locally can be faster than searching online.'},
      {title:'Check if the mosque follows a different madhab\'s timing', body:'Some mosques calculate Asr or Isha slightly differently based on their school of thought — don\'t assume the same schedule as home.'},
      {title:'If no mosque is nearby, gather 2-3 people for Jama\'ah anywhere', body:'Congregational prayer doesn\'t require a mosque — even a small group of Muslims in a hotel room or shared space praying together earns the reward of Jama\'ah.'},
      {title:'Check mosque apps and online directories specific to your destination country', body:'Many countries and cities have their own dedicated mosque-finder apps or community directories, often more complete than generic map searches for that region.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the reward of congregational prayer'}],
    keywords:['find mosque while traveling','jamaah away from home','mosque near me travel','congregational prayer while visiting'],
    snippet:'How to find congregational prayer and a mosque while traveling or visiting a new city, including options when no mosque is available.'},

  { id:'fasting-physical-job', title:'Fasting with a Physically Demanding Job', icon:'moon', tag:'Scenario', time:'4 min',
    summary:'Managing Ramadan fasting alongside manual labor, long shifts, or physically strenuous work.',
    steps:[
      {title:'Adjust your suhoor for sustained energy', body:'Prioritize complex carbohydrates, protein, and hydration over sugary or heavy foods, which spike and crash energy quickly during demanding physical work.'},
      {title:'Pace your exertion throughout the shift', body:'If possible, front-load the most demanding tasks earlier in the fast when energy is higher, saving lighter tasks for later hours.'},
      {title:'Know the genuine exemption for hardship', body:'If fasting causes real harm — not just difficulty, but danger to health — Islamic law permits breaking the fast and making up the day later (Qur\'an 2:184). This is not a small allowance to take lightly, but it exists for real cases.'},
      {title:'Talk to your employer if adjustments are possible', body:'Some workplaces allow shift adjustments during Ramadan — it doesn\'t hurt to ask, especially in workplaces with other fasting employees.'},
      {title:'Stay hydrated during non-fasting hours', body:'Physically demanding work increases fluid loss — prioritize water intake at suhoor and iftar rather than relying on caffeinated drinks.'},
      {title:'Rest when you can, even briefly', body:'A short break to sit, breathe, and recover during the workday — even five minutes — helps sustain the fast without pushing your body past reasonable limits.'}
    ],
    sources:[{book:'Qur\'an', ref:'2:184, verse on exemptions from fasting due to hardship'},{book:'Fiqh us-Sunnah', ref:'Chapter on excuses for breaking the fast'}],
    keywords:['fasting manual labor ramadan','fasting physical job','ramadan construction work','fasting while working out'],
    snippet:'How to manage Ramadan fasting during physically demanding work — pacing energy, knowing genuine exemptions, and staying safe.'},

  { id:'ramadan-timezones', title:'Ramadan Timing Across Time Zones', icon:'moon', tag:'Scenario', time:'3 min',
    summary:'How fasting hours, moon sighting, and prayer times work when you travel across time zones during Ramadan.',
    steps:[
      {title:'Fasting hours follow local time, not your origin', body:'When you cross time zones, your fasting hours reset to the local dawn and sunset of wherever you currently are — not the schedule from where you started.'},
      {title:'Extremely long or short fasting days are handled with local timing', body:'In regions with unusual daylight patterns (very long or very short days), most scholars recommend following the nearest moderate location\'s timing or your home country\'s timing, rather than the extreme local hours (this is a debated area — several approaches exist).'},
      {title:'Moon sighting may differ by country', body:'Ramadan\'s start and end dates can vary by a day depending on regional moon sighting methods — check local mosque announcements rather than assuming your home country\'s dates apply.'},
      {title:'Use reliable prayer time apps set to your current location', body:'Ensure your app\'s location settings update automatically when you travel, so fasting and prayer times reflect where you actually are.'},
      {title:'A day "lost" or "gained" crossing the international date line has scholarly guidance', body:'This is a genuinely rare and complex situation — if it applies to you, consult a knowledgeable scholar for your specific itinerary rather than guessing.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on fasting and geographic variation'}],
    keywords:['ramadan different timezone','fasting hours travel','ramadan long days country','moon sighting ramadan travel'],
    snippet:'How Ramadan fasting hours, moon sighting, and prayer times adjust when traveling across time zones during the month.'},

  { id:'mosque-with-kids', title:'Attending the Mosque with Young Children', icon:'users', tag:'Scenario', time:'3 min',
    summary:'Practical tips for bringing children to the mosque without stress — for you or for others praying nearby.',
    steps:[
      {title:'Remember the Prophet ﷺ welcomed children in the mosque', body:'He was known to shorten his prayer if he heard a baby crying, out of consideration for the mother (Sahih al-Bukhari) — children belong in the mosque, not as a disruption to tolerate but as part of the community.'},
      {title:'Bring quiet activities for young children', body:'Small toys, snacks, or a coloring book can help children stay occupied calmly during longer parts of the service, like the khutbah.'},
      {title:'Position yourself near an exit for easy stepping out', body:'If a child becomes fussy, having a quick path outside means less disruption and less stress for you.'},
      {title:'Teach older children the basics gradually, not all at once', body:'Rather than expecting perfect stillness, let kids gradually learn the rhythm of standing, bowing, and prostrating by watching and mimicking over time.'},
      {title:'Talk to other parents at your mosque', body:'Many mosques have informal or formal parent networks — connecting with them normalizes the experience and provides mutual support.'},
      {title:'Don\'t feel guilty for their noise', body:'A crying baby or a fidgety toddler is not a failure on your part — the earliest Muslim community prayed with children present as a matter of course.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on shortening prayer for a crying child'}],
    keywords:['bringing kids to mosque','children in mosque islam','toddler at jummah prayer','kids disrupting salah'],
    snippet:'Practical advice for bringing young children to the mosque, rooted in how the Prophet ﷺ himself welcomed children during prayer.'},

  { id:'praying-while-sick', title:'Praying While Sick or Injured', icon:'heart', tag:'Scenario', time:'4 min',
    summary:'How Salah adapts to illness, injury, and physical limitation — prayer remains accessible in nearly every condition.',
    steps:[
      {title:'Pray standing if you can, even with support', body:'If you can stand while leaning on a wall, cane, or piece of furniture, this is still preferred over sitting.'},
      {title:'Pray seated if standing isn\'t possible', body:'If standing is too difficult or medically inadvisable, sit for the entire prayer, performing ruku and sujood with a lower bow from the seated position.'},
      {title:'Pray lying down if seated isn\'t possible either', body:'If you cannot sit up, you may pray lying on your side facing the Qibla, or on your back with feet toward the Qibla if that\'s the only option, using slight movements or eye motion for ruku and sujood in extreme cases.'},
      {title:'Adjust wudu for injuries or medical devices', body:'If a wound, cast, or bandage prevents washing a limb, wiping over the covering (masah) is often sufficient — this is a well-established concession (some schools of thought have specific conditions for how long this applies).'},
      {title:'Combine prayers if illness makes frequent movement difficult', body:'In cases of genuine hardship from illness, combining Dhuhr with Asr, and Maghrib with Isha, is permitted by many scholars to reduce physical strain.'},
      {title:'Know that reduced capacity does not reduce reward', body:'The Prophet ﷺ said that when a servant falls ill or travels, they still receive the reward of the good deeds they used to do when well and settled (Sahih al-Bukhari) — illness does not diminish your standing.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on reward during illness and travel'},{book:'Fiqh us-Sunnah', ref:'Chapter on prayer for the sick'}],
    keywords:['praying while sick islam','salah with injury','prayer bedridden muslim','how to pray if you cant stand'],
    snippet:'How to pray while sick, injured, or physically limited — standing, sitting, or lying down, with wudu adaptations for wounds and casts.'},

  { id:'breaking-fast-traveling', title:'Breaking Fast While Still Traveling', icon:'plane', tag:'Scenario', time:'3 min',
    related:['fasting','travel','ramadan-timezones'],
    summary:'What to do at sunset when you\'re mid-journey and haven\'t reached your destination.',
    steps:[
      {title:'Break your fast at the correct local time, not your destination\'s time', body:'Iftar happens based on sunset wherever you currently are — not the time zone or city you\'re heading toward.'},
      {title:'Keep dates and water accessible while traveling', body:'Packing a small snack for iftar means you\'re not caught unprepared if you\'re still in transit — on a plane, train, or road at sunset.'},
      {title:'If flying, check with airline staff or use a reliable app for local sunset time', body:'Time zones shift quickly during flights — a prayer app with GPS tracking gives a more accurate iftar time than guessing based on your departure city.'},
      {title:'Delay if you\'re unsure, don\'t break early', body:'If genuinely uncertain whether sunset has occurred at your current location, it\'s safer to wait a few extra minutes than to break the fast prematurely.'},
      {title:'Continuing travel after iftar doesn\'t affect your fast\'s validity', body:'Once you\'ve broken your fast at the correct time, continuing your journey afterward has no bearing on that day\'s fast — it was already completed correctly.'},
      {title:'Remember travelers have the option to not fast at all', body:'As a traveler, you\'re permitted to break your fast entirely and make up the missed day later — this timing guidance is for those choosing to fast anyway while in transit.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on the timing of Iftar during travel'}],
    keywords:['breaking fast while traveling','iftar time flight','ramadan travel sunset time','fasting on a plane'],
    snippet:'How to correctly time breaking your fast while still traveling — using local sunset time rather than your destination\'s schedule.'},

  { id:'quran-with-interruptions', title:'Reciting Qur\'an with Frequent Interruptions', icon:'book', tag:'Scenario', time:'3 min',
    summary:'Maintaining a Qur\'an habit around a busy, unpredictable schedule — kids, work, and constant distractions.',
    steps:[
      {title:'Lower the bar for what counts as "enough"', body:'A few verses recited with focus is better than a long session abandoned halfway through in frustration — consistency matters more than volume.'},
      {title:'Use small pockets of time intentionally', body:'Waiting rooms, commutes, or the few minutes before a meeting can hold a page or two — treat these moments as valid recitation time, not just "not enough time."'},
      {title:'Mark your place clearly so restarting is effortless', body:'A bookmark or app that saves your exact position removes the friction of "where was I?" that often derails a habit after interruption.'},
      {title:'It\'s fine to pause mid-verse if truly necessary', body:'Life interrupts — pausing to attend to a child or an urgent task and resuming later doesn\'t diminish the value of what you\'ve already recited.'},
      {title:'Pair recitation with an existing daily habit', body:'Attaching Qur\'an time to something you already do consistently (after Fajr, before sleeping) makes it easier to protect from interruption.'},
      {title:'Remember that effort amid difficulty carries its own reward', body:'The Prophet ﷺ said the one who recites the Qur\'an with difficulty will have a double reward (Sahih Muslim) — a fragmented, effortful practice is not lesser in Allah\'s sight.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on the double reward for reciting with difficulty'}],
    keywords:['quran reading busy schedule','reciting quran with kids around','quran habit interruptions','how to read quran consistently'],
    snippet:'How to build and maintain a Qur\'an recitation habit despite a busy, interrupted schedule — using small pockets of time effectively.'},


  { id:'should-i-pray-now', title:'Should I Pray Right Now? A Decision Guide', icon:'compass', tag:'Fiqh', time:'4 min',
    summary:'A practical framework for figuring out whether you can, should, or must pray in your current situation.',
    steps:[
      {title:'Check: Has the prayer time actually started?', body:'Each prayer has a defined window. If the time hasn\'t begun yet (e.g., it\'s still before Dhuhr), wait — praying early doesn\'t count for that prayer.'},
      {title:'Check: Is the time window about to close?', body:'If you\'re near the end of a prayer\'s window (like Asr just before Maghrib), pray immediately rather than risk missing it — a rushed prayer within time is better than a missed one.'},
      {title:'Check: Are you in a state of purity?', body:'If you\'re not sure you have wudu, it\'s safer to redo it. If you can\'t access water and none is nearby, tayammum becomes valid.'},
      {title:'Check: Is your current location reasonably clean?', body:'You don\'t need a perfect space — just a clean-enough spot to place your forehead. A clean cloth, mat, or even a clean patch of floor works.'},
      {title:'Check: Can you determine the Qibla direction?', body:'Use a compass app if unsure. If you genuinely cannot determine direction (like on a plane with no reference), pray facing your best estimate — the effort is what matters (some schools of thought are lenient here given genuine inability).'},
      {title:'Check: Are you physically able to perform normal movements?', body:'If yes, pray standing with full movements. If illness, injury, or the situation prevents this, adapt — sitting, lying down, or minimal movements are all valid based on your capability.'},
      {title:'Conclusion: In almost every situation, the answer is yes', body:'Islamic law is built so that prayer remains accessible in nearly every circumstance — the form adapts, but the obligation rarely disappears entirely.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on conditions and concessions in prayer'}],
    keywords:['can i pray right now','when am i allowed to pray islam','prayer conditions checklist','is it time to pray'],
    snippet:'A step-by-step decision framework to determine whether you can pray in your current situation — covering timing, purity, direction, and physical ability.'},

  { id:'can-i-fast-today', title:'Can I Fast Today? A Decision Guide', icon:'moon', tag:'Fiqh', time:'4 min',
    summary:'A clear framework for determining whether fasting is required, permitted, exempted, or discouraged for you today.',
    steps:[
      {title:'Check: Are you menstruating or in postpartum bleeding?', body:'If yes, fasting is not permitted during this time — you are exempted and will make up the day later. This is not optional avoidance; it\'s a required pause.'},
      {title:'Check: Are you pregnant or breastfeeding and fasting poses genuine risk?', body:'If a doctor or your own clear assessment indicates real risk to you or the baby, you may break the fast and make up the day later, or in some views, pay fidyah (compensation) instead — check which applies to your situation.'},
      {title:'Check: Are you traveling a recognized distance?', body:'If you\'re on a genuine journey, fasting is optional — you may fast if it\'s not difficult, or delay to another day if it is (Qur\'an 2:184).'},
      {title:'Check: Are you seriously ill or on medication that requires food?', body:'Genuine illness that fasting would worsen is a valid reason to break the fast, with make-up days once recovered — or fidyah if the illness is chronic and unlikely to improve.'},
      {title:'Check: Is today a day fasting is actually forbidden?', body:'The two Eid days (Eid al-Fitr and Eid al-Adha) are days fasting is not permitted, regardless of intention or reason.'},
      {title:'Check: None of the above apply?', body:'If you are healthy, not traveling, not menstruating, and it\'s a permitted day — fasting is expected as normal, whether it\'s Ramadan or a voluntary fast day you\'ve intended.'},
      {title:'Remember: exemptions are mercy, not failure', body:'Using a valid exemption is not a lesser form of worship — it\'s following the same guidance that instructs you to fast in the first place.'}
    ],
    sources:[{book:'Qur\'an', ref:'2:184-185, verses on fasting exemptions'},{book:'Fiqh us-Sunnah', ref:'Chapter on who is exempted from fasting'}],
    keywords:['can i fast today islam','fasting exemptions checklist','am i allowed to skip fasting','ramadan fasting rules who is exempt'],
    snippet:'A decision framework covering who is exempt from fasting — illness, travel, pregnancy, menstruation — and when fasting remains required.'},

  { id:'is-this-halal-framework', title:'Is This Halal? A General Framework', icon:'scale', tag:'Fiqh', time:'4 min',
    summary:'The underlying principles Islamic scholars use to assess whether something is permissible, rather than a list of specific rulings.',
    deeperDive:'Many people approach halal/haram as a memorized list, but the tradition actually works from a small number of underlying principles applied to countless situations. The default assumption in Islamic law is permissibility (al-asl fil-ashya al-ibaha) — things are considered allowed unless there is a specific, clear textual reason to forbid them. This matters because it shifts the burden: you don\'t need to prove something is halal, you need a real reason to believe it\'s haram. Scholars also weigh harm (dharar) heavily; anything with clear, established harm to the body, mind, or society tends to be restricted even without an explicit verse, because the broader objectives of Islamic law (maqasid al-shariah) include protecting life, intellect, and wellbeing. When genuinely unsure, the guidance to "leave what makes you doubt for what does not make you doubt" (Jami\' at-Tirmidhi) offers a practical, personal filter beyond formal rulings.',
    steps:[
      {title:'Start from the default: things are permissible unless proven otherwise', body:'Islamic law\'s baseline assumption is that everyday matters — food, activities, objects — are allowed unless clear evidence forbids them.'},
      {title:'Check if there\'s a direct textual prohibition', body:'Some things are explicitly named as haram in the Qur\'an or authentic hadith — pork, alcohol, gambling, interest (riba). These don\'t require additional reasoning.'},
      {title:'Check if it causes clear harm', body:'Even without an explicit verse, things that cause significant harm to health, mind, or relationships often fall under general principles against self-harm and harming others.'},
      {title:'Check if it involves deception or injustice', body:'Fraud, cheating, exploitation, or dishonesty in any transaction is broadly prohibited under Islamic principles of justice, even in situations not explicitly named in scripture.'},
      {title:'Check if scholars differ, and if so, why', body:'Some matters are genuinely debated among schools of thought — this isn\'t a sign of confusion in Islam, but of scholars applying the same principles to complex or new situations differently.'},
      {title:'If genuinely unsure, lean toward caution', body:'The Prophet ﷺ advised leaving what causes doubt for what doesn\'t cause doubt (Jami\' at-Tirmidhi) — when uncertain, the safer choice is often the more cautious one.'},
      {title:'Ask a knowledgeable source for anything high-stakes', body:'For significant decisions (financial products, medical procedures, business dealings), a general framework is a starting point — consult someone qualified for your specific situation.'}
    ],
    sources:[{book:'Jami\' at-Tirmidhi', ref:'Hadith on leaving doubtful matters'},{book:'Fiqh us-Sunnah', ref:'Introduction on principles of permissibility'}],
    keywords:['is this halal framework','how to know if something is haram','islamic principles permissible','halal haram general rules'],
    snippet:'The underlying principles scholars use to determine permissibility in Islam — not a memorized list, but a framework you can apply broadly.'},

  { id:'actions-during-prayer', title:'What Can I Do During Prayer? A Decision Guide', icon:'pray', tag:'Fiqh', time:'3 min',
    summary:'A quick reference for what breaks Salah, what\'s discouraged, and what\'s genuinely fine to do mid-prayer.',
    steps:[
      {title:'Speaking intentionally: breaks the prayer', body:'Deliberately talking to someone or responding to a question invalidates the prayer — this is one of the clearer invalidators across all schools of thought.'},
      {title:'Coughing, sneezing, or clearing your throat: does not break it', body:'Involuntary sounds like these don\'t invalidate the prayer — continue as normal.'},
      {title:'Correcting the Imam\'s recitation mistake: permitted, even encouraged', body:'If you\'re following an Imam and notice a recitation error, saying "Subhanallah" (for men) to alert them is acceptable and doesn\'t break your prayer.'},
      {title:'Moving to address a genuine necessity: usually permitted with limits', body:'Taking a small step to stop a child from danger, or adjusting clothing that has slipped, is generally allowed if minimal and necessary — excessive movement is discouraged.'},
      {title:'Crying due to genuine emotion or reflecting on the Qur\'an: does not break it', body:'Tears from sincere emotional response to what you\'re reciting are not only permitted but were part of the Prophet\'s ﷺ own practice.'},
      {title:'Answering your phone or checking a notification: breaks the prayer', body:'This counts as a deliberate distraction and interruption — silence your phone before starting.'},
      {title:'Laughing audibly: breaks the prayer', body:'Unlike a quiet smile, audible laughter is considered an invalidator by consensus among scholars.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on invalidators of prayer'},{book:'Sahih al-Bukhari', ref:'Hadith on correcting recitation during prayer'}],
    keywords:['what breaks salah','things that invalidate prayer islam','can i cough during prayer','actions allowed during salah'],
    snippet:'A quick reference guide for what actions invalidate prayer, what\'s discouraged, and what\'s genuinely fine to do while praying.'},

  { id:'ghusl-or-wudu', title:'Do I Need Ghusl or Just Wudu? A Decision Guide', icon:'shower', tag:'Fiqh', time:'3 min',
    summary:'Determining which level of purification you need before prayer, based on what happened.',
    steps:[
      {title:'Ask: Has sexual intimacy or ejaculation occurred?', body:'This requires a full ghusl (complete ritual bath), not just wudu — this is one of the clearest triggers for ghusl.'},
      {title:'Ask: Has your menstrual or postpartum bleeding just ended?', body:'Ghusl is required once bleeding stops, before resuming prayer and fasting.'},
      {title:'Ask: Have you just embraced Islam?', body:'A ghusl is recommended upon converting to Islam, as a symbolic and physical fresh start (some schools of thought treat this as strongly recommended rather than obligatory).'},
      {title:'Ask: Have you simply used the bathroom, passed gas, or touched something impure?', body:'These situations require only wudu, not a full ghusl — a common point of confusion.'},
      {title:'Ask: Have you slept deeply enough to lose awareness?', body:'Deep sleep that removes full consciousness invalidates wudu — you\'ll need to redo wudu, though not necessarily ghusl unless one of the ghusl triggers above also applies.'},
      {title:'Ask: Have you touched your spouse without arousal or fluid release?', body:'Simple touch or affection without the specific triggers above does not require ghusl (some schools of thought differ on whether it invalidates wudu at all).'},
      {title:'When in doubt between the two, ghusl covers both', body:'A full ghusl includes the purification of wudu within it — if genuinely uncertain which is required, performing ghusl resolves both possibilities.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on the causes of major and minor ritual impurity'},{book:'Sahih Muslim', ref:'Hadith on the necessity of ghusl after intimacy'}],
    keywords:['do i need ghusl or wudu','when is full bath required islam','ghusl triggers checklist','wudu vs ghusl difference'],
    snippet:'A clear decision guide for determining whether a situation requires full ghusl or just standard wudu before prayer.'},


  { id:'new-muslim-first-month', title:'A New Muslim\'s First Month', icon:'star', tag:'Life Stage', time:'5 min',
    summary:'A roadmap for the first weeks after taking Shahada — what to focus on first, and where to find deeper guidance.',
    deeperDive:'The first month after Shahada is often described by converts as simultaneously overwhelming and clarifying — overwhelming because there is genuinely a lot to learn, clarifying because the core of Islam is simpler than it can appear from outside. A useful psychological reframe: you are not expected to master everything at once. The Prophet ﷺ taught the religion to the earliest converts gradually, prioritizing belief and the essentials of worship before layering in the deeper details of law and jurisprudence over years. Many converts report that trying to learn everything simultaneously — Arabic, fiqh, history, all five prayers perfectly — creates burnout. A staged approach, one solid habit at a time, tends to produce more lasting change than trying to become a scholar in week one.',
    steps:[
      {title:'Understand what actually changed: your declaration of faith', body:'Saying the Shahada sincerely is what makes you Muslim — everything else is practice you build over time, not a prerequisite you needed beforehand.'},
      {title:'Learn Wudu and the basic prayer movements first', body:'These are the most immediate practical skills — see the Wudu and Salah guides for step-by-step walkthroughs with Arabic and transliteration.'},
      {title:'Don\'t worry about praying five times perfectly right away', body:'Start with what you can manage — even one or two prayers a day while you\'re learning — and build up. Consistency over time matters more than immediate perfection.'},
      {title:'Find a local mosque or community, even virtually', body:'Community support makes an enormous difference in the early period — see the Mosque Etiquette and Finding Jama\'ah guides for what to expect.'},
      {title:'Expect family and social adjustment, and that\'s normal', body:'How friends and family respond varies widely — see the Family Etiquette and Islamic Identity guides for navigating this transition with patience.'},
      {title:'Learn a few short Qur\'an chapters, not the whole book at once', body:'Surah Al-Fatihah and a few short chapters (like Al-Ikhlas) are enough to begin praying properly — deeper Qur\'an study can follow at your own pace.'},
      {title:'Give yourself grace for mistakes', body:'Forgetting steps, mixing up Arabic, or feeling awkward at the mosque are completely normal in the first weeks — everyone who has ever learned this started exactly where you are now.'},
      {title:'Explore Tawheed and the foundations of belief when ready', body:'Once daily practice feels more natural, the Tawheed Foundations guide offers a deeper look at the core beliefs underlying everything you\'re now practicing.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the gradual teaching of religion to new believers'},{book:'Fiqh us-Sunnah', ref:'Introduction on the pillars of faith and practice'}],
    keywords:['new muslim guide','what to do after shahada','convert to islam first steps','new revert guide islam'],
    snippet:'A roadmap for the first month after taking Shahada — prioritizing what matters most and pointing to deeper guides as you\'re ready.'},

  { id:'converts-journey', title:'The Convert\'s Ongoing Journey', icon:'compass', tag:'Life Stage', time:'5 min',
    summary:'Guidance for the months and years after converting — identity, family relationships, and finding lasting community.',
    steps:[
      {title:'Expect your relationship with faith to keep evolving', body:'The intensity of early conversion often shifts into something steadier over time — this isn\'t losing faith, it\'s faith becoming lived-in rather than novel.'},
      {title:'Navigate family relationships with patience', body:'Some families adjust quickly, others take years, and some never fully accept it — see the Family Etiquette guide for maintaining ties of kinship even amid tension.'},
      {title:'Distinguish cultural practices from Islamic requirements', body:'Many converts feel pressure to adopt a specific culture alongside Islam — they\'re separate. See the Innovation (Bid\'ah) guide for understanding what\'s actually religious versus cultural.'},
      {title:'Build a support network of other converts if possible', body:'Other people who\'ve walked this specific path often understand challenges that born-Muslim friends, however well-meaning, may not fully grasp.'},
      {title:'Address doubts directly rather than suppressing them', body:'Questions and doubts are a normal part of a maturing faith, not a sign of failure — see the Dealing with Doubt guide for a range of perspectives on working through them.'},
      {title:'Deepen your knowledge at a sustainable pace', body:'There\'s no deadline for becoming a scholar — the Seeking Knowledge guide frames this as a lifelong process, not a race.'},
      {title:'Consider what "explaining Islam" means for you personally', body:'Some converts become natural educators for curious friends and family; others prefer to practice quietly — both are valid, and neither is required of you.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the rights of new believers and community integration'}],
    keywords:['convert muslim journey','revert struggles islam','new muslim family issues','convert identity islam'],
    snippet:'Guidance for the ongoing journey after the first weeks of conversion — family dynamics, doubt, community, and sustainable growth.'},

  { id:'parents-teaching-kids', title:'A Parent\'s Guide to Teaching Kids Islam', icon:'users', tag:'Life Stage', time:'5 min',
    summary:'How to introduce Islamic practice to children at an age-appropriate pace, without pressure or disconnection.',
    steps:[
      {title:'Start with love and warmth, not obligation', body:'Children who associate Islam with connection and comfort in early years tend to carry that association forward — see the Family Etiquette guide for the broader framework of a warm Islamic home.'},
      {title:'Introduce prayer through participation, not instruction alone', body:'Young children often learn salah best by praying alongside you and mimicking movements, well before they understand every detail — formal teaching can follow around age seven, as is traditionally recommended.'},
      {title:'Make Ramadan inclusive even before they fast', body:'Young children can participate in suhoor, decorate for iftar, or do partial fasts as they grow — full fasting typically begins around puberty, but the culture of the month can start much earlier.'},
      {title:'Read Qur\'an stories in an engaging, age-appropriate way', body:'Stories of the prophets are often the most accessible entry point for young children — the Qur\'an Etiquette guide covers respect for the text itself as children grow into handling it directly.'},
      {title:'Answer hard questions honestly, even if imperfectly', body:'Kids ask "why" constantly — an honest "I don\'t fully know, but here\'s what I understand" builds more trust than a dismissive non-answer.'},
      {title:'Model consistency more than perfection', body:'Children notice whether practice is genuine and steady far more than whether it\'s flawless — your own effort, visible to them, teaches more than any lecture.'},
      {title:'Expect the teenage years to bring their own questions', body:'As children become teenagers, see the Islamic Identity as a Young Person guide, written directly for them, to support their own developing relationship with faith.'}
    ],
    sources:[{book:'Sunan Abu Dawud', ref:'Hadith on teaching children to pray from age seven'},{book:'Fiqh us-Sunnah', ref:'Chapter on raising children in the faith'}],
    keywords:['teaching kids islam','how to raise muslim children','kids prayer age','muslim parenting guide'],
    snippet:'How to introduce Islamic practice to children at each stage — from early participation to the teenage years — without pressure.'},

  { id:'elders-in-islam', title:'Elders in Islam: Worship, Rest, and Legacy', icon:'heart', tag:'Life Stage', time:'5 min',
    summary:'How Islamic practice adapts gracefully with age, and the honored place of elders in the Islamic tradition.',
    steps:[
      {title:'Know that prayer adapts to your body, not the other way around', body:'Sitting, using support, or reduced movements in prayer due to age are fully valid — see the Praying While Sick or Injured guide, which applies equally to the natural changes of aging.'},
      {title:'Understand the elevated status the Qur\'an gives elders', body:'The Qur\'an specifically commands gentleness and honor toward aging parents, even forbidding a sigh of impatience toward them (Qur\'an 17:23) — this is a foundational value, not an afterthought.'},
      {title:'Rest is not a spiritual failure', body:'Reduced physical capacity for standing, fasting, or attending every prayer in congregation does not diminish your standing — Allah rewards intention and consistent effort, not just physical output.'},
      {title:'Consider what legacy and knowledge you want to pass on', body:'Many elders find deep meaning in teaching grandchildren, sharing life experience, or mentoring younger community members — the Seeking Knowledge guide notes teaching as one of the most rewarded acts.'},
      {title:'Prepare practically and spiritually for end of life', body:'The Death Preparation guide covers practical steps — wills, repentance, and family clarity — that bring peace of mind rather than being something to avoid discussing.'},
      {title:'Stay connected to community even with reduced mobility', body:'Many mosques offer support for elderly attendance, or family and community members can help arrange transportation and company for prayer and gatherings.'},
      {title:'Continue seeking closeness to Allah at whatever pace fits', body:'Dhikr, dua, and reflection require no physical exertion and can deepen meaningfully in later years, often described by elders as a more peaceful and settled stage of faith.'}
    ],
    sources:[{book:'Qur\'an', ref:'17:23-24, verses on honoring aging parents'},{book:'Fiqh us-Sunnah', ref:'Chapter on prayer concessions for the elderly and infirm'}],
    keywords:['elderly muslim prayer','islam and aging','elders in islam honor','praying with limited mobility elderly'],
    snippet:'How Islamic practice gracefully adapts with age — prayer concessions, the honored status of elders, and preparing a lasting legacy.'},

  { id:'teen-young-adult-guide', title:'Teen & Young Adult: Building Your Own Islam', icon:'star', tag:'Life Stage', time:'5 min',
    summary:'A starting point for teenagers and young adults navigating faith, identity, relationships, and independence.',
    steps:[
      {title:'Start with understanding your identity as your own', body:'The Islamic Identity as a Young Person guide is written specifically for this stage — faith that becomes genuinely yours, not just inherited, tends to last.'},
      {title:'Navigate friendships, dating culture, and boundaries', body:'The Youth & Relationships guide addresses attraction, boundaries, and how Islam frames commitment — real questions this age group actually faces.'},
      {title:'Think intentionally about career and future direction', body:'The Career & Work for Young Muslims guide connects your ambitions with Islamic values, rather than treating them as separate tracks.'},
      {title:'Expect doubts, and know that\'s part of maturing faith', body:'The Dealing with Doubt in Faith guide offers multiple honest perspectives — doubt at this stage is common and workable, not something to hide or panic over.'},
      {title:'Build habits now that will carry you forward', body:'The Building a Consistent Prayer Practice guide focuses on realistic habit-building — more useful at this stage than aiming for unattainable perfection.'},
      {title:'Understand the foundations more deeply as you\'re ready', body:'The Tawheed Foundations and Seeking Knowledge guides offer a deeper dive once the basics feel settled — there\'s no rush, this is a lifelong process.'},
      {title:'Know that struggling with faith doesn\'t mean you\'re failing', body:'Many of the most grounded adults in their faith went through real questioning as teens and young adults — the struggle itself is often part of how faith becomes solid.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the rights and responsibilities of young adults'}],
    keywords:['muslim teenager guide','young adult islam','islam for teens','muslim youth identity guide'],
    snippet:'A starting point for teens and young adults navigating faith, relationships, career, and doubt — pointing to deeper guides for each area.'},


  { id:'consistent-prayer-practice', title:'Building a Consistent Prayer Practice', icon:'refresh', tag:'Spiritual', time:'5 min',
    summary:'Practical, psychology-informed strategies for making the five daily prayers a genuine habit rather than a daily struggle.',
    deeperDive:'Habit researchers describe consistent behavior as depending less on willpower and more on removing friction and attaching new habits to existing cues — this maps closely onto how Islamic practice was structured from the start. The five prayers are already tied to natural time markers (dawn, midday, afternoon, sunset, night), which function as built-in habit cues far more reliable than an arbitrary reminder. From a psychological lens, the biggest threat to consistency isn\'t lack of belief, it\'s decision fatigue — having to decide anew each time whether "now" is a good time to stop and pray. Removing that decision (by fixing routines around the prayer window rather than deciding fresh each time) is often more effective than motivation alone. From a spiritual lens, scholars have long taught that consistency (even in small amounts) is more beloved to Allah than sporadic intensity — a teaching that happens to align closely with modern habit science.',
    steps:[
      {title:'Anchor prayer to something you already do consistently', body:'Rather than treating prayer as a separate task to remember, link it to an existing routine — right after you finish lunch for Dhuhr, right when you get home for Maghrib.'},
      {title:'Set a specific, early alarm for each prayer window', body:'An alarm right at the start of a prayer\'s time window, rather than near the end, gives you buffer and reduces the odds of the day running away from you.'},
      {title:'Track your prayers, even simply', body:'A basic checklist or app tracker creates visible momentum — many people find that not wanting to "break the streak" becomes its own motivator.'},
      {title:'Start with the prayer you find hardest, not easiest', body:'If Fajr is consistently the one you miss, focus your energy there specifically rather than spreading effort evenly — targeted habit change works better than general intention.'},
      {title:'Prepare the night before for Fajr specifically', body:'Sleeping earlier, keeping the alarm across the room, and having wudu-ready water nearby reduces the friction that usually derails the hardest prayer of the day.'},
      {title:'Forgive missed prayers without spiraling', body:'A missed prayer is a moment to make up (if within a reasonable window) and move forward — treating one miss as proof you\'ve failed tends to cause a larger collapse than the original miss itself.'},
      {title:'Remember the reward is in the effort, not just the outcome', body:'The Prophet ﷺ said the deeds most beloved to Allah are the most consistent, even if small (Sahih al-Bukhari) — small, steady effort outperforms occasional intensity.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the most beloved deeds being the most consistent'},{book:'Riyad as-Salihin', ref:'Chapter on moderation and consistency in worship'}],
    keywords:['how to be consistent with prayer','building salah habit','stop missing prayers islam','pray five times a day tips'],
    snippet:'Practical, psychology-informed strategies for making the five daily prayers a genuine, lasting habit rather than a daily struggle.'},

  { id:'prayer-feels-empty', title:'When Your Prayers Feel Empty', icon:'heart', tag:'Spiritual', time:'6 min',
    summary:'Multiple perspectives — spiritual, psychological, and practical — on the common experience of praying without feeling present.',
    deeperDive:'This experience is remarkably universal across the Islamic tradition — even companions of the Prophet ﷺ reported struggling with distraction in prayer, and entire chapters of classical fiqh texts address how to handle it. What varies is which lens helps a given person most. A theological lens frames the disconnect as spiritual — a heart in need of remembrance (dhikr) and closeness. A psychological lens frames it as attentional — the mind wandering is simply what unfocused minds do, and prayer is, among other things, a structured attention practice. A practical lens frames it as circumstantial — poor sleep, rushing, or lack of understanding of the words being recited will predictably produce a disconnected prayer regardless of sincerity. None of these lenses cancel the others out; most people benefit from addressing all three at once rather than assuming there\'s a single root cause.',
    steps:[
      {title:'Spiritual take: understand khushu as a skill, not a fixed trait', body:'Presence in prayer (khushu) is described in the tradition as something built over time through practice and sincerity, not something you either have or don\'t — early struggle is expected, not a red flag.'},
      {title:'Spiritual take: remember who you\'re speaking to', body:'Pausing before starting to consciously remember that you\'re addressing Allah directly — not performing a routine — can shift the felt experience of the prayer that follows.'},
      {title:'Psychological take: understand that mind-wandering is the brain\'s default state', body:'Neuroscience research on the brain\'s "default mode network" shows that minds wander during almost any repetitive or quiet activity — this isn\'t a personal spiritual failure, it\'s baseline human cognition.'},
      {title:'Psychological take: reduce cognitive load beforehand', body:'A racing, overloaded mind (from stress, multitasking, or rushing straight from a screen into prayer) is far less likely to settle — a brief pause before starting prayer to consciously transition can help.'},
      {title:'Practical take: learn the meaning of what you\'re reciting', body:'Reciting words in a language you don\'t understand naturally feels more mechanical — learning even the translation of Al-Fatihah and commonly recited short surahs often transforms the felt experience significantly.'},
      {title:'Practical take: slow down the physical pace', body:'Rushing through movements physically reinforces a rushed mental state — deliberately slowing your pace, even slightly, often brings the mind along with it.'},
      {title:'Combined approach: don\'t wait to "feel ready" to pray well', body:'Across all three lenses, the consistent advice is the same: keep praying attentively even when it doesn\'t feel emotionally rewarding — the feeling of connection often follows the practice, rather than preceding it.'}
    ],
    sources:[{book:'Riyad as-Salihin', ref:'Chapter on presence of heart in worship'},{book:'Fiqh us-Sunnah', ref:'Chapter on khushu and its cultivation'}],
    keywords:['prayer feels empty islam','no khushu in salah','distracted during prayer','how to focus during salah'],
    snippet:'Multiple perspectives — spiritual, psychological, and practical — on why prayers can feel disconnected, and how to work through it.'},

  { id:'dealing-with-doubt', title:'Dealing with Doubt in Faith', icon:'compass', tag:'Spiritual', time:'6 min',
    summary:'Different theological, emotional, and logical angles on religious doubt — a genuinely common experience, not a sign of failed faith.',
    deeperDive:'Islamic scholarship has a long history of directly engaging doubt rather than treating it as taboo — theologians like Al-Ghazali wrote extensively about his own period of profound doubt before arriving at a more settled faith, describing the process as ultimately strengthening rather than weakening his belief. This matters because many people experiencing doubt assume they\'re alone or uniquely broken, when in fact doubt is a well-documented and even historically productive part of religious development for many serious believers. Modern psychology of religion similarly frames doubt as a normal developmental stage rather than a pathology — often correlated with deeper, more examined faith later on, rather than apostasy. The key distinction worth holding onto is between doubt as an honest question seeking an answer, and doubt as a settled conclusion — the first is healthy and common; only you can determine, over time, which one you\'re experiencing.',
    steps:[
      {title:'Theological take: doubt is documented even among the earliest generations', body:'Companions of the Prophet ﷺ are recorded asking him directly about troubling thoughts and doubts, and he reassured them this itself was a sign of true faith, not its absence (Sahih Muslim) — this is a strikingly direct precedent.'},
      {title:'Theological take: distinguish between a whisper and a conclusion', body:'Islamic scholarship traditionally separates waswasa (intrusive, passing doubts) from a genuine settled disbelief — the former is considered a normal test, not sinful in itself.'},
      {title:'Emotional take: doubt often correlates with life stress, not just belief', body:'Grief, major life transitions, or burnout frequently manifest as spiritual doubt — addressing the underlying emotional state sometimes resolves what felt like a theological crisis.'},
      {title:'Emotional take: isolation makes doubt heavier', body:'Doubt processed alone, without any trusted person to talk to, tends to feel more catastrophic than doubt shared — even one honest conversation with someone non-judgmental can shift the emotional weight significantly.'},
      {title:'Logical take: separate the specific question from the whole framework', body:'A single unanswered question ("why does X happen") doesn\'t logically require abandoning an entire belief system — most worldviews, religious or secular, contain some unresolved questions.'},
      {title:'Logical take: seek out serious answers, not just reassurance', body:'If a specific intellectual question is driving the doubt, seeking a substantive answer from Islamic scholarship (rather than avoiding the question) tends to be more resolving than simply being told to have more faith.'},
      {title:'Practical take: give it time rather than forcing an immediate resolution', body:'Doubt resolved through patient reflection over months tends to produce more durable conviction than doubt suppressed quickly out of fear — rushing to "fix" it can sometimes bury the question rather than answer it.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on companions experiencing doubt and the Prophet\'s reassurance'},{book:'Riyad as-Salihin', ref:'Chapter on trials of faith and steadfastness'}],
    keywords:['doubting my faith islam','religious doubt muslim','waswasa doubts in islam','losing faith help'],
    snippet:'Theological, emotional, and logical perspectives on religious doubt — a documented, common experience rather than a sign of failed faith.'},

  { id:'why-islam-forbids-things', title:'Why Does Islam Forbid Certain Things?', icon:'shield', tag:'Spiritual', time:'5 min',
    summary:'A framework for understanding the reasoning behind Islamic restrictions, rather than treating them as arbitrary rules.',
    steps:[
      {title:'Understand the concept of maqasid al-shariah (objectives of Islamic law)', body:'Classical scholars identified core objectives behind Islamic law: protecting faith, life, intellect, lineage, and property — most specific rulings can be traced back to protecting one of these.'},
      {title:'Restrictions on substances protect the intellect', body:'Prohibitions like alcohol connect directly to protecting clear thinking and decision-making — the objective, not just the specific substance, is what the ruling serves.'},
      {title:'Restrictions on financial dealings protect fairness and property', body:'Riba (interest) and fraud are forbidden because they create systemic exploitation — the underlying objective is economic justice, not an arbitrary dislike of profit.'},
      {title:'Restrictions on relationships protect lineage and emotional wellbeing', body:'Boundaries around premarital relationships connect to protecting family structure, emotional security, and clear lines of responsibility — not a rejection of human connection itself.'},
      {title:'Some restrictions exist even without a fully explained reason', body:'Not every ruling comes with a stated rationale in the text — trusting divine wisdom even where the reasoning isn\'t immediately visible is itself considered part of faith (though many restrictions do have clear, traceable benefit).'},
      {title:'Restrictions are rarely about the act being "impure" for its own sake', body:'Reframing from "this is dirty or bad" to "this protects something valuable" tends to make the wisdom behind rulings more graspable than a purely moralistic framing.'},
      {title:'You\'re allowed to seek understanding, not just obey blindly', body:'Asking "why" about Islamic rulings is not disrespectful — Islamic scholarship has an extensive tradition of explaining wisdom (hikmah) behind law precisely because understanding deepens rather than threatens sincere practice.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Introduction on the objectives of Islamic law (maqasid al-shariah)'}],
    keywords:['why is this haram in islam','reasoning behind islamic rules','maqasid al shariah explained','why does islam forbid things'],
    snippet:'A framework for understanding the reasoning behind Islamic restrictions — rooted in protecting faith, life, intellect, lineage, and property.'},

  { id:'breaking-bad-habits', title:'Breaking Bad Habits: Islamic and Psychological Approaches', icon:'refresh', tag:'Spiritual', time:'5 min',
    summary:'Combining classical Islamic guidance on sin and repentance with modern behavioral science on habit change.',
    steps:[
      {title:'Islamic take: understand repentance as a repeatable process, not a one-time event', body:'Tawbah (repentance) in Islamic teaching is described as available every single time, without limit — the Prophet ﷺ said Allah is more pleased with a servant\'s repentance than a traveler finding a lost camel in the desert (Sahih Muslim), illustrating genuine relief rather than reluctant forgiveness.'},
      {title:'Psychological take: understand habits as cue-routine-reward loops', body:'Behavioral science frames habits as automatic responses to specific triggers — identifying your specific triggers (boredom, stress, a certain time of day) is often more effective than relying on willpower alone.'},
      {title:'Islamic take: replace, don\'t just remove', body:'The Prophet ﷺ taught following a bad deed with a good one to erase it (Jami\' at-Tirmidhi) — this mirrors modern habit-replacement strategies more closely than pure suppression.'},
      {title:'Psychological take: change your environment before relying on discipline', body:'Removing physical or digital triggers (blocking apps, changing routines, avoiding specific settings) reduces the number of times willpower is even tested — environment design often outperforms willpower.'},
      {title:'Islamic take: surround yourself with supportive company', body:'The Prophet ﷺ compared good and bad companionship to a perfume seller and a blacksmith (Sahih al-Bukhari) — who you spend time with measurably shapes what habits feel normal.'},
      {title:'Psychological take: expect and plan for relapse rather than being shocked by it', body:'Most successful habit change involves setbacks along the way — planning your response to a slip-up in advance prevents one lapse from spiraling into total abandonment.'},
      {title:'Combined approach: track small wins, not just the absence of failure', body:'Both traditions converge here — celebrating small, consistent progress (a day, then a week) tends to sustain motivation better than focusing only on the distant, larger goal.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on Allah\'s joy at a servant\'s repentance'},{book:'Jami\' at-Tirmidhi', ref:'Hadith on following bad deeds with good ones'},{book:'Sahih al-Bukhari', ref:'Hadith on the comparison of companionship to perfume and smoke'}],
    keywords:['breaking bad habits islam','how to stop sinning','islamic habit change','repentance and self improvement'],
    snippet:'Combining classical Islamic teaching on repentance and companionship with modern behavioral science on how habits actually change.'},

  { id:'staying-focused-salah', title:'Staying Focused During Salah', icon:'pray', tag:'Spiritual', time:'5 min',
    summary:'Practical and neurological perspectives on maintaining attention during prayer, and why distraction is normal, not shameful.',
    steps:[
      {title:'Neurological take: understand that sustained attention is naturally limited', body:'Cognitive research shows focused attention typically holds for only a few minutes before naturally drifting — expecting a completely undistracted five-minute prayer works against basic brain function, not against your sincerity.'},
      {title:'Practical take: recite with understanding, not just memorized sound', body:'Learning the meaning of what you\'re reciting engages more of the brain\'s language and comprehension centers than rote recitation, which tends to run on autopilot and drift more easily.'},
      {title:'Neurological take: reduce pre-prayer stimulation when possible', body:'Coming directly from a fast-paced, high-stimulation activity (scrolling, arguing, rushing) into prayer makes the mental shift harder — even 30 seconds of stillness beforehand can help the transition.'},
      {title:'Practical take: choose a fixed, minimally distracting spot when possible', body:'A consistent prayer space, away from visual clutter or a visible phone, reduces the number of environmental triggers competing for attention.'},
      {title:'Neurological take: gently redirect rather than fight the wandering mind', body:'Trying to forcefully "not think" about something usually backfires — noticing the distraction without frustration and gently returning to the recitation mirrors techniques used in focused-attention practices more broadly.'},
      {title:'Practical take: vary your recitation instead of always the same short surahs', body:'Repeating the exact same familiar verses every prayer can increase autopilot recitation — occasionally reciting something less memorized re-engages conscious attention.'},
      {title:'Spiritual take: remember that Allah is aware of your effort, not just the outcome', body:'The intention to focus and the effort of returning attention each time it wanders are themselves part of the worship — a wandering mind gently brought back repeatedly is not a failed prayer.'}
    ],
    sources:[{book:'Riyad as-Salihin', ref:'Chapter on presence of heart in prayer'},{book:'Fiqh us-Sunnah', ref:'Chapter on the etiquettes and inner dimensions of prayer'}],
    keywords:['how to focus in prayer','staying present during salah','mind wandering in prayer islam','improve concentration in salah'],
    snippet:'Practical and neurological perspectives on maintaining attention during prayer, and why the mind naturally wanders — and what helps.'},


  { id:'islamic-calendar-explained', title:'The Islamic Calendar Explained', icon:'moon', tag:'Good to know', time:'4 min',
    summary:'A simple guide to the Hijri calendar — its months, why dates shift each year, and how to plan around it.',
    steps:[
      {title:'Understand it\'s a lunar calendar, not solar', body:'The Islamic (Hijri) calendar follows the moon\'s cycle rather than the sun, making each year about 10-11 days shorter than the Gregorian calendar most countries use for civil dates.'},
      {title:'Know why dates shift every year', body:'Because the Hijri year is shorter, Islamic months and events (like Ramadan) shift roughly 10-11 days earlier each Gregorian year, cycling through all seasons over about 33 years.'},
      {title:'Learn the twelve months', body:'The months are: Muharram, Safar, Rabi\' al-Awwal, Rabi\' al-Thani, Jumada al-Awwal, Jumada al-Thani, Rajab, Sha\'ban, Ramadan, Shawwal, Dhul-Qa\'dah, and Dhul-Hijjah.'},
      {title:'Know the four sacred months', body:'Muharram, Rajab, Dhul-Qa\'dah, and Dhul-Hijjah are considered sacred months, traditionally associated with heightened restraint from conflict and increased mindfulness (Qur\'an 9:36).'},
      {title:'Understand the significance of key months', body:'Ramadan (the ninth month) is the month of fasting; Dhul-Hijjah (the twelfth) contains the Hajj pilgrimage and Eid al-Adha; Shawwal (the tenth) begins with Eid al-Fitr.'},
      {title:'Know how the new month is determined', body:'Traditionally, the start of each Hijri month depends on the sighting of the new crescent moon — some regions still use physical sighting, while others rely on astronomical calculation (this is a genuinely debated methodological difference, not a religious disagreement).'},
      {title:'Use both calendars practically', body:'Most Muslims track Gregorian dates for daily and work life, while following the Hijri calendar for religious observances — many prayer apps display both simultaneously for convenience.'}
    ],
    sources:[{book:'Qur\'an', ref:'9:36, verse on the sacred months'},{book:'Fiqh us-Sunnah', ref:'Chapter on the determination of Islamic months'}],
    keywords:['islamic calendar explained','hijri calendar months','why does ramadan move each year','islamic sacred months'],
    snippet:'A simple explanation of the Hijri lunar calendar — its twelve months, the four sacred months, and why Islamic dates shift each year.'},

  { id:'planning-your-islamic-year', title:'Planning Your Year Around the Islamic Calendar', icon:'moon', tag:'Good to know', time:'3 min',
    summary:'A practical look at what to expect and prepare for across the Hijri year, month by month in broad terms.',
    steps:[
      {title:'Muharram: the year begins, with Ashura included', body:'The tenth day of Muharram (Ashura) carries historical and spiritual significance, and voluntary fasting on this day is a well-established sunnah.'},
      {title:'Rajab and Sha\'ban: the lead-up to Ramadan', body:'Many Muslims use these two months to gradually increase worship and prepare spiritually and practically for the intensity of Ramadan ahead.'},
      {title:'Ramadan: the month of fasting', body:'The ninth month, marked by daily fasting from dawn to sunset, increased Qur\'an recitation, and the search for Laylat al-Qadr in the final ten nights.'},
      {title:'Shawwal: Eid al-Fitr and six days of voluntary fasting', body:'The month opens with Eid al-Fitr celebrations, and many follow the tradition of fasting six additional days sometime during this month.'},
      {title:'Dhul-Qa\'dah: a quieter sacred month', body:'One of the four sacred months, often used for continued reflection and preparation for those planning to perform Hajj the following month.'},
      {title:'Dhul-Hijjah: Hajj and Eid al-Adha', body:'The first ten days of this month are considered especially blessed, culminating in the Hajj pilgrimage for those able, and Eid al-Adha for the wider Muslim community.'},
      {title:'Use the Islamic Calendar feature in the app', body:'The Journal section\'s Islamic Calendar card tracks upcoming dates automatically, helping you plan ahead for fasting days, Eid, and other key dates without manual calculation.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the virtues of specific months and voluntary fasting days'}],
    keywords:['islamic year planning','what to expect each hijri month','ramadan dhul hijjah calendar','muslim year overview'],
    snippet:'A practical, month-by-month overview of the Islamic calendar year — what each period means and how to prepare for it.'}
];

// Sync guides and categories to offline storage on page load
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => {
    OfflineSync.syncCategories(CATEGORIES).catch(()=>0);
    OfflineSync.syncGuides(GUIDES).catch(()=>0);
  });
} else {
  OfflineSync.syncCategories(CATEGORIES).catch(()=>0);
  OfflineSync.syncGuides(GUIDES).catch(()=>0);
}

const QA = [];


// ==> GUIDE CATEGORIZATION
const GUIDE_CATEGORIES = {
  'Prayer': ['wudu', 'salah', 'ghusl', 'tayammum', 'adhan', 'sujoodsahw', 'qibla', 'jumuah', 'five-prayers', 'consistent-prayer-practice', 'prayer-feels-empty', 'actions-during-prayer', 'should-i-pray-now', 'staying-focused-salah', 'praying-in-car', 'wudu-limited-water', 'praying-at-work', 'praying-while-sick', 'prayer-with-disabilities'],
  'Etiquette': ['mosque-etiquette', 'home-etiquette', 'food-etiquette', 'quran-etiquette', 'manners', 'neighbors', 'work-etiquette', 'women-in-workplace', 'mosque-with-kids'],
  'Ritual Purification': ['wudu-mistakes', 'salah-mistakes', 'ghusl-or-wudu', 'common-mistakes'],
  'Fasting': ['fasting', 'ramadan', 'ramadan-preparation', 'ramadan-fasting-guide', 'laylat-qadr', 'eid', 'eid-prayer-detailed', 'can-i-fast-today', 'fasting-physical-job', 'ramadan-timezones', 'breaking-fast-traveling', 'fasting-medical-procedures', 'muharram-ashura'],
  'Scenarios': ['travel', 'finding-jamaah-away', 'hajj-umrah-basics', 'hajj-umrah-detailed', 'planning-your-islamic-year', 'islamic-calendar-explained'],
  'Personal Dev': ['patience-hardship', 'anger-management', 'gratitude', 'intention', 'seeking-knowledge', 'dealing-with-loss', 'dealing-with-doubt', 'why-islam-forbids-things', 'breaking-bad-habits', 'perfectionism-islamic-lens', 'geographic-isolation-faith', 'anxiety-waswasa-distinction'],
  'Knowledge': ['tawheed-basics', 'shirk-avoidance', 'innovation-bidah', 'is-this-halal-framework', 'seeking-knowledge-guide'],
  'Women': ['menstruation', 'postpartum', 'pregnancy-etiquette', 'women-leadership'],
  'Youth': ['youth-identity', 'youth-relationships', 'youth-career'],
  'Life Events': ['death-preparation', 'mourning-etiquette', 'grief-major-loss', 'divorce-islamic-process', 'interfaith-families', 'aging-parents-care', 'new-muslim-first-month', 'converts-journey', 'parents-teaching-kids', 'elders-in-islam', 'teen-young-adult-guide'],
  'Health': ['sleep', 'hygiene', 'chronic-illness-faith', 'mental-health-stigma'],
  'Finance': ['finance', 'financial-hardship-survival']
};

const CATEGORY_COLORS = {
  'Prayer': '#F4714E',
  'Etiquette': '#D4A574',
  'Ritual Purification': '#B8956A',
  'Fasting': '#E6B8A2',
  'Scenarios': '#C9A77A',
  'Personal Dev': '#A789A8',
  'Knowledge': '#8B7BA8',
  'Women': '#D4A5C8',
  'Youth': '#7FA8B8',
  'Life Events': '#A89575',
  'Health': '#9BBD8B',
  'Finance': '#C9A77A'
};
// <== GUIDE CATEGORIZATION

// Expose to other <script> blocks (e.g. the guides display override),
// which run in a sibling scope and cannot see these IIFE-local consts.
window.GUIDES = GUIDES;
window.getGuide = getGuide;
window.QA = QA;
window.GUIDE_CATEGORIES = GUIDE_CATEGORIES;
window.CATEGORY_COLORS = CATEGORY_COLORS;

/* ============================================================
   STATE
   ============================================================ */
const state = {
  selectedGuide: null,
  bookmarks: new Set(),
  completedSteps: {}, // guideId -> Set of step indices
};
GUIDES.forEach(g => { state.completedSteps[g.id] = new Set(); });
QA.forEach(q => { state.completedSteps[q.id] = new Set(); });

function getGuide(id){ return GUIDES.find(g=>g.id===id) || QA.find(q=>q.id===id); }

function persistGuides(){
  const completedSteps = {};
  Object.keys(state.completedSteps).forEach(id=>{ completedSteps[id] = Array.from(state.completedSteps[id]); });
  WWP.save('guides', { bookmarks: Array.from(state.bookmarks), completedSteps });
}
async function loadGuidesFromBackend(){
  const saved = await WWP.get('guides');
  if(!saved) return;
  if(Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
  if(saved.completedSteps){
    Object.keys(saved.completedSteps).forEach(id=>{
      if(state.completedSteps[id]) state.completedSteps[id] = new Set(saved.completedSteps[id]);
    });
  }
}

/* ============================================================
   UI :: render
   ============================================================ */
function renderSidebar(){
  const list = $('#guideList'); list.innerHTML='';
  GUIDES.forEach(g=>{
    const done = state.completedSteps[g.id];
    const allDone = done.size===g.steps.length && g.steps.length>0;
    const row = document.createElement('li');
    row.className = 'guide-row'+(state.selectedGuide===g.id?' active':'')+(allDone?' all-done':'');
    row.innerHTML = `
      <span class="g-row-icon">${iconSvg(g.icon,15)}</span>
      <div class="g-row-body">
        <div class="g-row-title">${g.title}</div>
        <div class="g-row-meta">${g.tag} · ${g.time}</div>
      </div>
      <span class="g-row-check">${allDone?iconSvg('check',11):''}</span>
    `;
    row.addEventListener('click', ()=> selectGuide(g.id));
    list.appendChild(row);
  });
  $('#guideSidebarCount').textContent = GUIDES.length+' guides';
}

function renderGuide(){
  const g = getGuide(state.selectedGuide);
  const emptyState = $('#guideEmptyState');
  const paneBody = $('#guidePaneBody');
  if(!g){
    if(emptyState) emptyState.style.display = '';
    if(paneBody) paneBody.style.display = 'none';
    return;
  }
  if(emptyState) emptyState.style.display = 'none';
  if(paneBody) paneBody.style.display = '';
  $('#guideOrn').innerHTML = iconSvg(g.icon,20);
  $('#guideTitle').textContent = g.title;
  $('#guideTag').textContent = g.tag;
  $('#guideTime').textContent = g.time;
  $('#guideSummary').textContent = g.summary;
  $('#guideBmBtn').classList.toggle('active-state', state.bookmarks.has(g.id));
  $('#guideBmBtn').style.background = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--surface-alt)';
  $('#guideBmBtn').style.color = state.bookmarks.has(g.id) ? '#fff' : 'var(--text)';
  $('#guideBmBtn').style.borderColor = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--border)';

  // info box (rak'ah counts, only for Salah)
  const infoSlot = $('#infoBoxSlot');
  if(g.rakahInfo){
    infoSlot.innerHTML = `
      <div class="info-box">
        <h4>Rak'ahs per prayer</h4>
        <div class="rakah-grid">
          ${g.rakahInfo.map(([name,count])=>`<div class="rakah-item"><div class="rk-name">${name}</div><div class="rk-count">${count}</div></div>`).join('')}
        </div>
      </div>`;
  } else {
    infoSlot.innerHTML = '';
  }

  const done = state.completedSteps[g.id];
  const stepsWrap = $('#guideSteps'); stepsWrap.innerHTML='';
  g.steps.forEach((step, idx)=>{
    const isDone = done.has(idx);
    const card = document.createElement('div');
    card.className = 'step-card'+(isDone?' done':'');
    card.innerHTML = `
      <span class="step-check" data-idx="${idx}">${isDone?iconSvg('check',13):''}</span>
      <div class="step-body">
        <div class="step-title"><span class="step-num" style="display:inline-flex;width:20px;height:20px;font-size:10.5px;margin-right:8px;vertical-align:middle;">${idx+1}</span>${step.title}</div>
        <div class="step-text">${step.body}</div>
        ${step.arabic ? `
          <div class="step-arabic-box">
            <div class="step-arabic">${step.arabic}</div>
            <div class="step-translit">${step.translit}</div>
            <div class="step-translation">${step.translation}</div>
          </div>` : ''}
      </div>
    `;
    card.querySelector('.step-check').addEventListener('click', ()=> toggleStep(g.id, idx));
    stepsWrap.appendChild(card);
  });

  $('#progressLabel').textContent = `${done.size} of ${g.steps.length} steps`;
  $('#progressFill').style.width = g.steps.length ? Math.round((done.size/g.steps.length)*100)+'%' : '0%';

  const crossSlot = $('#crossLinkSlot');
  if(g.crossLink){
    crossSlot.innerHTML = `<button class="cross-link-btn" id="crossLinkBtn">${g.crossLink.label} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    $('#crossLinkBtn').addEventListener('click', ()=>{
      if(typeof window.switchPage === 'function') window.switchPage(g.crossLink.page);
    });
  } else {
    crossSlot.innerHTML = '';
  }

  const relatedSlot = $('#relatedGuidesSlot');
  if(g.related && g.related.length){
    const chips = g.related.map(rid=>{
      const rg = getGuide(rid);
      return rg ? `<button class="related-chip" data-rid="${rid}">${rg.title}</button>` : '';
    }).join('');
    relatedSlot.innerHTML = `<div class="related-guides"><h4>Related guides</h4><div class="related-chips">${chips}</div></div>`;
    relatedSlot.querySelectorAll('.related-chip').forEach(btn=>{
      btn.addEventListener('click', ()=> window.WWP_openGuide(btn.dataset.rid));
    });
  } else {
    relatedSlot.innerHTML = '';
  }

  const noteSlot = $('#noteSlot');
  noteSlot.innerHTML = g.note ? `<div class="guide-note">💡<span>${g.note}</span></div>` : '';

  renderStats();
}

function renderStats(){
  $('#gBookmarkCount').textContent = state.bookmarks.size;
  const completedGuides = GUIDES.filter(g => state.completedSteps[g.id].size===g.steps.length && g.steps.length>0).length;
  $('#gCompletedCount').textContent = `${completedGuides} of ${GUIDES.length}`;
  const curG = getGuide(state.selectedGuide);
  $('#gContinueLabel').textContent = curG ? curG.title : 'No guide selected';
}

function renderAll(){
  renderSidebar();
  renderGuide();
}

/* ============================================================
   Actions
   ============================================================ */
function selectGuide(id, opts){
  opts = opts || {};
  // Toggle: if this guide is already selected, close it
  if(state.selectedGuide === id){
    state.selectedGuide = null;
    window.__WWP_currentGuide = null;
    renderAll();
    return;
  }
  state.selectedGuide = id;
  window.__WWP_currentGuide = id;
  renderAll();
  const pane = document.querySelector('#page-guides .guide-pane');
  if(pane) pane.scrollIntoView({behavior:'smooth', block:'start'});

  // Keep the URL in sync with the guide being read (e.g. /guides/wudu)
  // so each guide is independently linkable and indexable. Goes
  // straight to history.pushState (rather than back through
  // window.switchPage/WWP_openGuide) so clicking a guide in the list
  // can't re-trigger guide-selection and loop back into itself.
  if(!opts.skipRoute){
    const path = '/guides/'+id;
    if(location.pathname !== path){
      history.pushState({page:'guides', guide:id}, '', path);
    }
    if(window.__WWP_updateGuideSEO) window.__WWP_updateGuideSEO(id);
  }
}

function toggleStep(guideId, idx){
  const set = state.completedSteps[guideId];
  if(set.has(idx)) set.delete(idx); else set.add(idx);
  persistGuides();
  renderAll();
}

function toggleBookmark(id){
  if(state.bookmarks.has(id)){ state.bookmarks.delete(id); showToast('Removed from bookmarks'); }
  else { state.bookmarks.add(id); showToast('Guide bookmarked'); }
  persistGuides();
  renderAll();
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
async function init(){
  // Paint the guide shell first; bookmarks/progress hydrate afterwards.
  renderAll();
  loadGuidesFromBackend().then(renderAll).catch(()=>0);

  $('#guideBmBtn').addEventListener('click', ()=> { if(state.selectedGuide) toggleBookmark(state.selectedGuide); });
  $('#guideShareBtn').addEventListener('click', ()=>{
    const g = getGuide(state.selectedGuide);
    if(!g) return;
    const text = `${g.title} — WhereWePraying?`;
    if(navigator.share){ navigator.share({title:'Guides', text}).catch(()=>{}); }
    else { navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others')).catch(()=>showToast('Sharing is not available on this device')); }
  });
  $('#progressReset').addEventListener('click', ()=>{
    if(!state.selectedGuide) return;
    state.completedSteps[state.selectedGuide] = new Set();
    persistGuides();
    renderAll();
    showToast('Progress reset for this guide');
  });

  // ==> CONNECT (resolved): bookmarks/progress now sync per-device via
  // WWP above. GUIDES content itself is still placeholder text pending
  // a scholar-reviewed source — separate from storage.

  // Tell the router this section is ready — if a direct visit landed
  // on /guides/<slug> before this section finished initializing, the
  // router queued the slug and opens it now.
  if(window.__WWP_guideSectionReady) window.__WWP_guideSectionReady();
}

// Cross-page deep link: lets other pages jump straight to a specific
// guide (e.g. "Explore More" cards on other sections, or the router
// resolving a direct visit to /guides/<slug>). `opts.skipRoute` is
// used internally by the router on initial load / back-forward,
// where it already owns the URL for that navigation.
window.WWP_openGuide = function(guideId, opts){
  opts = opts || {};
  if(guideId) selectGuide(guideId, {skipRoute:true});
  // Pass the *post-toggle* current guide (not the raw guideId argument)
  // on to switchPage. selectGuide() above toggles closed if guideId was
  // already open, setting __WWP_currentGuide back to null — passing the
  // original guideId here instead would make switchPage think a new
  // guide selection is needed and immediately reopen the one we just
  // closed, which is why a second tap on an open guide used to do
  // nothing (open -> close -> instant reopen).
  window.switchPage('guides', {guide: window.__WWP_currentGuide, skipHistory: !!opts.skipRoute});
};

init();

})();

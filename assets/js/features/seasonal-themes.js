
/* ===== deferred feature script 09 ===== */
(function(){
// ==== Jummah (Friday) + Ramadan event themes: date resolver + application layer ====
// ==> CONNECT: themes #1 and #2 of the planned seasonal/event engine.
// Registry pattern (per-theme config + application layer) can extend this
// further to Eid/Dhul Hijjah/Summer/Winter without touching this logic.
// Priority when both could apply on the same day (e.g. a Friday in
// Ramadan): Ramadan takes precedence as the rarer, higher-priority event.
//
// Ramadan detection is LIVE, not a hardcoded date table: it reads the
// Hijri month (month.number === 9) from api.aladhan.com's calendar
// calculation (Umm al-Qura), the same free/no-key API already powering
// prayer times elsewhere in this app. It's calculated for a location:
//   1) the user's saved prayer-times location (wwp:prayertimes:location),
//      if they've set one — so someone whose local moonsighting authority
//      differs from Saudi still gets an accurate date for their area;
//   2) otherwise Saudi Arabia (Makkah coordinates) as the default, since
//      that's the most widely-followed reference globally.
// Result is cached in localStorage for the day so this costs one network
// request per visitor per day, not one per page load.
(function(){
  // ==> CONNECT: admin/theme-preview.html drives this via ?previewTheme=
  // and ?previewEvent= query params so themes can be tested on any day
  // without touching real visitors (no query params = normal behaviour).
  var preview = window.__wwpPreview || {theme:null, event:null};
  var forceBaseTheme = preview.theme;   // light|sepia|dark|amoled
  var forceEventTheme = preview.event;  // jummah|ramadan|none

  var HIJRI_API = 'https://api.aladhan.com/v1/gToH';
  var MAKKAH_COORDS = {lat:21.4225, lon:39.8262}; // Saudi fallback reference point
  var LOC_KEY = 'wwp:prayertimes:location';       // shared with the Prayer Times module
  var HIJRI_CACHE_KEY = 'wwp:ramadan:hijriCheck';  // {dateKey, isRamadan, source, day}

  function todayKey(){
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
  }
  function dateStrForApi(){
    var d = new Date();
    return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear();
  }

  function getSavedLocation(){
    try{
      var raw = localStorage.getItem(LOC_KEY);
      if(raw){
        var loc = JSON.parse(raw);
        if(loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') return loc;
      }
    }catch(e){}
    return null;
  }

  // Cached result for today, so repeat visits/page loads don't re-fetch.
  // {dateKey, isRamadan, source:'user'|'saudi', day} — day is the Hijri
  // day-of-month, used to detect "day 1" for the Saudi-attribution note.
  var hijriState = null;
  function loadCachedHijriState(){
    try{
      var raw = localStorage.getItem(HIJRI_CACHE_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        if(parsed && parsed.dateKey === todayKey()) return parsed;
      }
    }catch(e){}
    return null;
  }
  function saveCachedHijriState(s){
    hijriState = s;
    try{ localStorage.setItem(HIJRI_CACHE_KEY, JSON.stringify(s)); }catch(e){}
  }

  // Fetches the live Hijri date for a given lat/lon via api.aladhan.com,
  // resolving to {isRamadan, day}. Falls back to Saudi coordinates if no
  // location is available or the request fails.
  function fetchHijriState(){
    var savedLoc = getSavedLocation();
    var usingSource = savedLoc ? 'user' : 'saudi';
    var coords = savedLoc || MAKKAH_COORDS;
    var url = HIJRI_API + '/' + dateStrForApi() + '?latitude=' + coords.lat + '&longitude=' + coords.lon;

    return fetch(url).then(function(res){
      if(!res.ok) throw new Error('Hijri lookup failed');
      return res.json();
    }).then(function(data){
      var hijri = data && data.data && data.data.hijri;
      if(!hijri) throw new Error('Unexpected Hijri response');
      var result = {
        dateKey: todayKey(),
        isRamadan: parseInt(hijri.month.number, 10) === 9,
        source: usingSource,
        day: parseInt(hijri.day, 10)
      };
      saveCachedHijriState(result);
      return result;
    }).catch(function(){
      // Network/API failure: if we're not sure, don't force the theme on —
      // safer to fall back to standard than to wrongly show Ramadan mode.
      var fallback = {dateKey: todayKey(), isRamadan:false, source:usingSource, day:null};
      saveCachedHijriState(fallback);
      return fallback;
    });
  }

  function isJummah(){
    if(forceEventTheme) return forceEventTheme === 'jummah';
    return new Date().getDay() === 5; // Friday, user's local time
  }

  function applyWithHijriState(state){
    hijriState = state;
    var ramadanActive = forceEventTheme ? forceEventTheme === 'ramadan' : !!state.isRamadan;
    var jummahActive = !ramadanActive && isJummah(); // Ramadan takes priority over Jummah

    if(ramadanActive){ document.body.setAttribute('data-event-theme', 'ramadan'); }
    else if(jummahActive){ document.body.setAttribute('data-event-theme', 'jummah'); }
    else{ document.body.removeAttribute('data-event-theme'); }

    var jummahBanner = document.getElementById('jummah-banner');
    if(jummahBanner){ jummahBanner.classList.toggle('hidden', !jummahActive); }

    var ramadanBanner = document.getElementById('ramadan-banner');
    if(ramadanBanner){ ramadanBanner.classList.toggle('hidden', !ramadanActive); }

    // Subtle Monday/Thursday optional-fasting note — standard theme only.
    // Sunnah fasting is a distinct, separate matter from Ramadan (already
    // obligatory) and Jummah (fasting Friday alone is discouraged), so this
    // only ever shows when neither of those themes is active.
    var fastingNote = document.getElementById('homeFastingNote');
    if(fastingNote){
      var dow = new Date().getDay(); // 0=Sun..6=Sat
      var isSunnahFastDay = (dow === 1 || dow === 4); // Monday or Thursday
      var showFastingNote = !ramadanActive && !jummahActive && isSunnahFastDay;
      fastingNote.style.display = showFastingNote ? 'flex' : 'none';
      if(showFastingNote){
        var textEl = document.getElementById('homeFastingNoteText');
        if(textEl){
          textEl.textContent = dow === 1
            ? "Monday is a Sunnah day for optional fasting"
            : "Thursday is a Sunnah day for optional fasting";
        }
      }
    }

    // Small top-right attribution note, shown only on Ramadan's first day
    // AND only when we fell back to the Saudi reference point (no saved
    // user location) — tells the visitor which authority the start date
    // is based on, since moonsighting can differ by a day region to region.
    var note = document.getElementById('ramadan-source-note');
    if(note){
      var showNote = ramadanActive && state.source === 'saudi' && state.day === 1;
      note.classList.toggle('hidden', !showNote);
    }
  }

  function apply(){
    if(forceBaseTheme){ document.body.setAttribute('data-theme', forceBaseTheme); }

    if(forceEventTheme){
      // Preview mode: skip the network call, resolve synchronously.
      applyWithHijriState({dateKey:todayKey(), isRamadan:forceEventTheme==='ramadan', source:'saudi', day:1});
      return;
    }

    var cached = loadCachedHijriState();
    if(cached){
      applyWithHijriState(cached);
      // Still refresh quietly in the background in case the user's saved
      // location changed since the cache was written earlier today.
      fetchHijriState().then(applyWithHijriState);
    }else{
      fetchHijriState().then(applyWithHijriState);
    }
  }
  apply();
  setInterval(apply, 5 * 60 * 1000); // catches day/event boundaries without a reload
})();

})();

/* ===== deferred feature script 10 ===== */
(function(){
// ==== Jummah homepage good-deed ticks: toggle state + Journal sync ====
// Each of the 4 reminder rows on the homepage (Read Surah Al-Kahf, send
// salawat, make du'a, give charity) is independently tickable. Ticking
// one writes it into today's Journal entry as a completed deed, so it
// shows up in the person's existing Good Deeds count/streak without
// them having to open the Journal separately. State is keyed by date so
// yesterday's ticks don't carry over and the boxes reset each Jummah.
(function(){
  // todayKey: shared, defined once in wwp-core.js — no local copy needed.
  var TICK_STORE_KEY = 'wwp:jummahTicks';

  function loadTickState(){
    try{
      var raw = localStorage.getItem(TICK_STORE_KEY);
      if(raw){
        var parsed = JSON.parse(raw);
        if(parsed && parsed.dateKey === todayKey()) return parsed.ticked || {};
      }
    }catch(e){}
    return {};
  }
  function saveTickState(ticked){
    try{ localStorage.setItem(TICK_STORE_KEY, JSON.stringify({dateKey:todayKey(), ticked:ticked})); }catch(e){}
  }

  var tickedState = loadTickState();

  function applyTickVisuals(){
    document.querySelectorAll('#jummahRemindersList li[data-deed-id]').forEach(function(li){
      var id = li.getAttribute('data-deed-id');
      li.classList.toggle('done', !!tickedState[id]);
    });
  }
  applyTickVisuals();

  // Merges a completed deed into today's Journal entry via the shared
  // WWP backend module (same device-scoped storage the Journal page
  // itself reads from/writes to) — reads the current blob first so this
  // doesn't clobber reflections/prayers/mistakes/routines already saved.
  async function addDeedToJournal(deedId, label){
    if(typeof window.WWP === 'undefined') return;
    var key = todayKey();
    var saved = await window.WWP.get('journal');
    var blob = saved || {reflections:{}, prayers:{}, deeds:{}, mistakes:{}, routines:[], heartSaved:false};
    if(!blob.deeds) blob.deeds = {};
    if(!blob.deeds[key]) blob.deeds[key] = [];
    var already = blob.deeds[key].some(function(d){ return d.id === 'jummah-'+deedId; });
    if(!already){
      blob.deeds[key].push({id:'jummah-'+deedId, label:label, done:true});
    }
    window.WWP.saveNow ? window.WWP.saveNow('journal', blob) : window.WWP.save('journal', blob);
  }

  // Removes a previously-added Jummah deed from today's Journal entry
  // if the person un-ticks it on the homepage — keeps the two views
  // (homepage ticks, Journal deed list) consistent in both directions.
  async function removeDeedFromJournal(deedId){
    if(typeof window.WWP === 'undefined') return;
    var key = todayKey();
    var saved = await window.WWP.get('journal');
    if(!saved || !saved.deeds || !saved.deeds[key]) return;
    saved.deeds[key] = saved.deeds[key].filter(function(d){ return d.id !== 'jummah-'+deedId; });
    window.WWP.saveNow ? window.WWP.saveNow('journal', saved) : window.WWP.save('journal', saved);
  }

  function toggleTick(li){
    var id = li.getAttribute('data-deed-id');
    var label = li.getAttribute('data-deed-label') || id;
    var nowDone = !tickedState[id];
    tickedState[id] = nowDone;
    saveTickState(tickedState);
    li.classList.toggle('done', nowDone);
    if(nowDone) addDeedToJournal(id, label);
    else removeDeedFromJournal(id);
  }

  document.querySelectorAll('#jummahRemindersList .hjr-check').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      toggleTick(btn.closest('li[data-deed-id]'));
    });
  });

  // The Al-Kahf row's text/arrow is a real link (kept as an <a href>
  // for SEO/no-JS fallback) — intercept the click to route through the
  // in-app router instead of a full page reload, and flag the Qur'an
  // section to auto-open Surah Al-Kahf once it mounts.
  var kahfLink = document.querySelector('.hjr-kahf-link');
  if(kahfLink){
    kahfLink.addEventListener('click', function(e){
      e.preventDefault();
      window.__WWP_pendingJummahKahf = true;
      if(typeof window.WWP_openSurah === 'function'){
        // Qur'an section already initialized this session — open directly.
        if(typeof window.switchPage === 'function') window.switchPage('quran');
        window.__WWP_pendingJummahKahf = false;
        window.WWP_openSurah(18, 1);
      }else if(typeof window.switchPage === 'function'){
        // First visit to the Qur'an tab this session — the section's own
        // init() will see the pending flag and open Al-Kahf itself.
        window.switchPage('quran');
      }
    });
  }

  // First/Last 10 Ayah boxes — same routing pattern as the Al-Kahf
  // reminder link above, but jumping to ayah 1 or ayah 101 specifically
  // rather than always landing at the top of the surah.
  document.querySelectorAll('.hjr-kahf-box').forEach(function(box){
    box.addEventListener('click', function(e){
      e.preventDefault();
      var ayah = parseInt(box.getAttribute('data-open-ayah'), 10) || 1;
      if(typeof window.WWP_openSurah === 'function'){
        if(typeof window.switchPage === 'function') window.switchPage('quran');
        window.WWP_openSurah(18, ayah);
      }else if(typeof window.switchPage === 'function'){
        window.__WWP_pendingJummahKahfAyah = ayah;
        window.__WWP_pendingJummahKahf = true;
        window.switchPage('quran');
      }
    });
  });
})();

})();

/* ===== deferred feature script 11 ===== */
(function(){
// ==== Jummah-only: Qur'an tab auto-opens Surah Al-Kahf ====
// Separate from the homepage tick script above so it applies even if
// the person navigates to the Qur'an tab directly via the nav bar (not
// just via the homepage's "Read Surah Al-Kahf today" link) while the
// Jummah event theme is active. Sets the same pending flag the Qur'an
// section's init() checks — see window.WWP_openSurah usage there.
(function(){
  document.querySelectorAll('.nav a[data-page="quran"], .brand[data-page="quran"]').forEach(function(a){
    a.addEventListener('click', function(){
      if(document.body.getAttribute('data-event-theme') === 'jummah'){
        if(typeof window.WWP_openSurah === 'function'){
          window.WWP_openSurah(18, 1);
        }else{
          window.__WWP_pendingJummahKahf = true;
        }
      }
    });
  });
})();

})();
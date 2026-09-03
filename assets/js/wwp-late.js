
/* ===== deferred feature script 08 ===== */
(function(){
// ==> GUIDES DISPLAY OVERRIDE
(function() {
  // Hook the real router (window.switchPage) rather than a nonexistent
  // window.showPage. switchPage is assigned synchronously above, so it
  // exists by the time this IIFE runs (this script tag loads after it).
  const originalSwitchPage = window.switchPage;
  window.switchPage = function(id, opts) {
    originalSwitchPage.call(this, id, opts);
    if (id === 'guides') {
      setTimeout(renderGroupedGuides, 150);
    }
  };

  window.renderGroupedGuides = function() {
    const pageContent = document.querySelector('#page-guides .page');
    if (!pageContent) return;

    let container = pageContent.querySelector('.guides-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'guides-container grouped-guides';
      const layout = pageContent.querySelector('.guides-layout');
      if (layout) {
        layout.parentNode.insertBefore(container, layout.nextSibling);
      } else {
        pageContent.appendChild(container);
      }
    }

    container.innerHTML = '';

    // === All Guides Section ===
    const guidesSection = document.createElement('div');
    guidesSection.className = 'collapsible-section';

    const guidesHeader = document.createElement('div');
    guidesHeader.className = 'collapsible-header open';
    guidesHeader.textContent = 'All Guides (Grouped by Category)';

    const guidesList = document.createElement('div');
    guidesList.className = 'collapsible-content';

    guidesHeader.addEventListener('click', function() {
      this.classList.toggle('open');
      guidesList.classList.toggle('closed');
    });

    guidesSection.appendChild(guidesHeader);
    guidesSection.appendChild(guidesList);

    Object.keys(GUIDE_CATEGORIES).forEach(cat => {
      const ids = GUIDE_CATEGORIES[cat];
      const guides = GUIDES.filter(g => ids.includes(g.id));
      const color = CATEGORY_COLORS[cat];

      if (guides.length > 0) {
        const catDiv = document.createElement('div');
        catDiv.className = 'guides-category';

        const catTitle = document.createElement('h3');
        catTitle.className = 'category-title';
        catTitle.textContent = cat;
        catDiv.appendChild(catTitle);

        const grid = document.createElement('div');
        grid.className = 'guides-grid';

        guides.forEach(g => {
          const card = document.createElement('div');
          card.className = 'guide-card';
          card.style.borderLeft = `4px solid ${color}`;

          const header = document.createElement('div');
          header.className = 'guide-header';

          const title = document.createElement('span');
          title.className = 'guide-title';
          title.textContent = g.title;

          const time = document.createElement('span');
          time.className = 'guide-time';
          time.textContent = g.time;

          header.appendChild(title);
          header.appendChild(time);
          card.appendChild(header);

          const summary = document.createElement('div');
          summary.className = 'guide-summary';
          summary.textContent = g.summary;
          card.appendChild(summary);

          card.addEventListener('click', () => window.WWP_openGuide(g.id));

          grid.appendChild(card);
        });

        catDiv.appendChild(grid);
        guidesList.appendChild(catDiv);
      }
    });

    container.appendChild(guidesSection);
  };

  // If the guides page is already the active page on load (e.g. direct
  // URL to /guides/...), render immediately rather than waiting for a
  // switchPage call that may never come.
  document.addEventListener('DOMContentLoaded', function() {
    const guidesPageEl = document.getElementById('page-guides');
    if (guidesPageEl && !guidesPageEl.classList.contains('hidden')) {
      setTimeout(renderGroupedGuides, 150);
    }
  });
})();
// <== GUIDES DISPLAY OVERRIDE

})();

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
  function todayKey(){
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
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

/* ===== deferred feature script 12 ===== */
(function(){
// Auth System: Popup logic + Session management
(function() {
  const AUTH_POPUP_ID = 'accountPopup';
  const EMAIL_INPUT_ID = 'authEmailInput';
  const SEND_LINK_BTN_ID = 'sendMagicLinkBtn';
  const SIGN_OUT_BTN_ID = 'signOutBtn';
  const CLOSE_POPUP_BTN_ID = 'closeAuthPopupBtn';
  const ACCOUNT_BTN_SELECTOR = '.topbar-icons button[title="Account"]';

  let authState = { authenticated: false, email: null, role: null };

  const $ = (sel) => sel.startsWith('#') || sel.startsWith('.') ? document.querySelector(sel) : document.getElementById(sel);

  async function init() {
    await checkSession();
    setupEventListeners();
    handleVerifyRedirect();
    handleGoogleRedirect();
  }

  function handleGoogleRedirect() {
    const result = window.__wwpGoogleAuthResult;
    if (!result) return;

    if (result.signedIn) {
      // checkSession() above already picked up the session cookie the
      // callback set server-side, so authState is current — just confirm.
      showAuthToast("You're signed in!", 'success');
    } else if (result.error) {
      showAuthToast('Google sign-in failed. Please try again.', 'error');
    }
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/session', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' }
      });
      const data = await res.json();

      if (data.authenticated) {
        authState = { authenticated: true, email: data.email, userId: data.userId, role: data.role || 'user' };
        renderAuthUI('signed-in');
      } else {
        authState = { authenticated: false, email: null, role: null };
        renderAuthUI('sign-in');
      }
      window.WWP_authState = authState;
      document.dispatchEvent(new CustomEvent('wwp-auth-ready', { detail: authState }));
    } catch (err) {
      console.error('checkSession error:', err);
      renderAuthUI('sign-in');
    }
  }

  function renderAuthUI(state) {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (!popup) return;

    const signedInDiv = popup.querySelector('.auth-popup-signed-in');
    const signInDiv = popup.querySelector('.auth-popup-sign-in');
    const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);

    if (state === 'signed-in') {
      signedInDiv.classList.remove('hidden');
      signInDiv.classList.add('hidden');
      const emailSpan = popup.querySelector('#authPopupEmail');
      if (emailSpan) emailSpan.textContent = authState.email;
      loadProfile();
      loadSettingsLocation();
      if (accountBtn) accountBtn.classList.add('account-signed-in');
    } else {
      signedInDiv.classList.add('hidden');
      signInDiv.classList.remove('hidden');
      if (accountBtn) accountBtn.classList.remove('account-signed-in');
    }
  }

  async function loadProfile() {
    try {
      const res = await fetch('/api/user/profile', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      const input = document.getElementById('usernameInput');
      const saveBtn = document.getElementById('saveUsernameBtn');
      const msgEl = document.getElementById('usernameMessage');

      if (input && data.username) input.value = data.username;

      if (data.username && data.canChangeUsername === false) {
        if (input) input.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = "You've already used your one username change.";
          msgEl.classList.remove('hidden');
        }
      } else {
        if (input) input.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
      }

      const recoveryInput = document.getElementById('recoveryEmailInput');
      if (recoveryInput) recoveryInput.value = data.recoveryEmail || '';

      const notifyToggle = document.getElementById('notifyFriendRequestsToggle');
      if (notifyToggle) notifyToggle.checked = !!data.notifyFriendRequests;

      if (window.WWP_Supporter) window.WWP_Supporter.render(!!data.isSupporter);
    } catch (e) {
      console.error('loadProfile error:', e);
    }
  }

  function loadSettingsLocation() {
    const labelEl = document.getElementById('settingsLocationLabel');
    if (!labelEl) return;
    try {
      const raw = localStorage.getItem('wwp:prayertimes:location');
      if (raw) {
        const loc = JSON.parse(raw);
        labelEl.textContent = loc.label || (loc.lat + ', ' + loc.lon);
        return;
      }
    } catch (e) {}
    labelEl.textContent = 'Not set';
  }

  function setupEventListeners() {
    const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);
    if (accountBtn) {
      accountBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAuthPopup();
      });
    }

    const sendBtn = document.getElementById(SEND_LINK_BTN_ID);
    if (sendBtn) sendBtn.addEventListener('click', sendMagicLink);

    const signOutBtn = document.getElementById(SIGN_OUT_BTN_ID);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
    wireDeleteAccountUI();

    const closeBtn = document.getElementById(CLOSE_POPUP_BTN_ID);
    if (closeBtn) closeBtn.addEventListener('click', closeAuthPopup);

    document.addEventListener('click', (e) => {
      const popup = document.getElementById(AUTH_POPUP_ID);
      const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);
      if (popup && !popup.contains(e.target) && e.target !== accountBtn && !accountBtn?.contains(e.target)) {
        closeAuthPopup();
      }
    });

    const emailInput = document.getElementById(EMAIL_INPUT_ID);
    if (emailInput) {
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMagicLink();
      });
    }

    const tabAccount = document.getElementById('authTabAccount');
    const tabSettings = document.getElementById('authTabSettings');
    if (tabAccount) tabAccount.addEventListener('click', () => switchAuthTab('account'));
    if (tabSettings) tabSettings.addEventListener('click', () => switchAuthTab('settings'));

    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    if (saveUsernameBtn) saveUsernameBtn.addEventListener('click', saveUsername);

    const usernameInput = document.getElementById('usernameInput');
    if (usernameInput) {
      usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveUsername();
      });
    }

    const manageLocationBtn = document.getElementById('manageLocationBtn');
    if (manageLocationBtn) {
      manageLocationBtn.addEventListener('click', () => {
        closeAuthPopup();
        if (typeof window.switchPage === 'function') window.switchPage('prayertimes');
      });
    }

    const saveRecoveryEmailBtn = document.getElementById('saveRecoveryEmailBtn');
    if (saveRecoveryEmailBtn) saveRecoveryEmailBtn.addEventListener('click', saveRecoveryEmail);

    const recoveryEmailInput = document.getElementById('recoveryEmailInput');
    if (recoveryEmailInput) {
      recoveryEmailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRecoveryEmail();
      });
    }

    const notifyToggle = document.getElementById('notifyFriendRequestsToggle');
    if (notifyToggle) {
      notifyToggle.addEventListener('change', async () => {
        try {
          await fetch('/api/user/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Id': window.WWP?.deviceId || '',
            },
            credentials: 'include',
            body: JSON.stringify({ notifyFriendRequests: notifyToggle.checked }),
          });
        } catch (e) {
          console.error('notifyFriendRequests toggle error:', e);
        }
      });
    }

    const tabFriends = document.getElementById('authTabFriends');
    if (tabFriends) tabFriends.addEventListener('click', () => switchAuthTab('friends'));

    const addFriendBtn = document.getElementById('addFriendBtn');
    if (addFriendBtn) addFriendBtn.addEventListener('click', addFriend);

    const addFriendInput = document.getElementById('addFriendInput');
    if (addFriendInput) {
      addFriendInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addFriend();
      });
    }

    const copyFriendCodeBtn = document.getElementById('copyFriendCodeBtn');
    if (copyFriendCodeBtn) {
      copyFriendCodeBtn.addEventListener('click', () => {
        const label = document.getElementById('friendCodeLabel');
        const code = label?.textContent?.trim();
        if (!code || code === '—') return;
        navigator.clipboard?.writeText(code);
        const original = copyFriendCodeBtn.textContent;
        copyFriendCodeBtn.textContent = 'Copied!';
        setTimeout(() => { copyFriendCodeBtn.textContent = original; }, 1500);
      });
    }

    const toggleGlobalBtn = document.getElementById('toggleGlobalBtn');
    if (toggleGlobalBtn) {
      toggleGlobalBtn.addEventListener('click', () => {
        const listEl = document.getElementById('globalLeaderboardList');
        const isHidden = listEl.classList.contains('hidden');
        if (isHidden) {
          listEl.classList.remove('hidden');
          toggleGlobalBtn.textContent = 'Hide Global Top 100';
          loadGlobalLeaderboard();
        } else {
          listEl.classList.add('hidden');
          toggleGlobalBtn.textContent = 'Show Global Top 100';
        }
      });
    }
  }

  function switchAuthTab(tab) {
    const tabAccount = document.getElementById('authTabAccount');
    const tabSettings = document.getElementById('authTabSettings');
    const tabFriends = document.getElementById('authTabFriends');
    const panelAccount = document.getElementById('authPanelAccount');
    const panelSettings = document.getElementById('authPanelSettings');
    const panelFriends = document.getElementById('authPanelFriends');

    [tabAccount, tabSettings, tabFriends].forEach((t) => t?.classList.remove('active'));
    [panelAccount, panelSettings, panelFriends].forEach((p) => p?.classList.add('hidden'));

    if (tab === 'settings') {
      tabSettings.classList.add('active');
      panelSettings.classList.remove('hidden');
      loadSettingsLocation();
    } else if (tab === 'friends') {
      tabFriends.classList.add('active');
      panelFriends.classList.remove('hidden');
      loadFriends();
      loadLeaderboard();
      loadFollowers();
    } else {
      tabAccount.classList.add('active');
      panelAccount.classList.remove('hidden');
    }
  }

  async function loadFriends() {
    const codeLabel = document.getElementById('friendCodeLabel');
    const listEl = document.getElementById('friendList');
    const incomingSection = document.getElementById('friendIncomingSection');
    const incomingListEl = document.getElementById('friendIncomingList');

    try {
      const res = await fetch('/api/friends', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) return;

      if (codeLabel) codeLabel.textContent = data.code || '—';

      if (incomingListEl) {
        incomingListEl.innerHTML = '';
        if (data.incoming && data.incoming.length) {
          incomingSection?.classList.remove('hidden');
          data.incoming.forEach((req) => {
            const item = document.createElement('div');
            item.className = 'auth-friend-item';
            item.innerHTML = `<span class="auth-friend-item-name">${renderAvatarAndName(req)}</span>`;
            const actions = document.createElement('div');
            actions.className = 'auth-friend-item-actions';

            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'auth-btn auth-btn-primary auth-btn-tiny';
            acceptBtn.textContent = 'Accept';
            acceptBtn.addEventListener('click', () => respondToRequest(req.requestId, 'accept'));

            const declineBtn = document.createElement('button');
            declineBtn.className = 'auth-btn auth-btn-secondary auth-btn-tiny';
            declineBtn.textContent = 'Decline';
            declineBtn.addEventListener('click', () => respondToRequest(req.requestId, 'decline'));

            actions.appendChild(acceptBtn);
            actions.appendChild(declineBtn);
            item.appendChild(actions);
            incomingListEl.appendChild(item);
          });
        } else {
          incomingSection?.classList.add('hidden');
        }
      }

      if (listEl) {
        listEl.innerHTML = '';
        if (data.friends && data.friends.length) {
          data.friends.forEach((f) => {
            const item = document.createElement('div');
            item.className = 'auth-friend-item';
            item.innerHTML = `<span class="auth-friend-item-name">${renderAvatarAndName(f)}</span>`;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'auth-btn auth-btn-secondary auth-btn-tiny';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => removeFriend(f.id));
            item.appendChild(removeBtn);
            listEl.appendChild(item);
          });
        } else {
          listEl.innerHTML = '<span class="auth-popup-text">No friends yet.</span>';
        }
      }
    } catch (e) {
      console.error('loadFriends error:', e);
    }
  }

  async function loadLeaderboard() {
    const listEl = document.getElementById('leaderboardList');
    if (!listEl) return;

    try {
      const res = await fetch('/api/leaderboard', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) return;

      listEl.innerHTML = '';

      if (!data.entries || data.entries.length <= 1) {
        listEl.innerHTML = '<span class="auth-popup-text">Add friends to see the leaderboard.</span>';
        return;
      }

      data.entries.forEach((entry, i) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';
        const rank = i + 1;
        const extra = entry.isYou ? ' (You)' : '';
        item.innerHTML = `<span class="auth-friend-item-name">#${rank} ${renderAvatarAndName(entry, extra)}</span><span>${entry.score}</span>`;
        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadLeaderboard error:', e);
    }
  }

  async function loadFollowers() {
    const sectionEl = document.getElementById('followersSection');
    const listEl = document.getElementById('followersList');
    if (!sectionEl || !listEl) return;

    try {
      const res = await fetch('/api/follow', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok || !data.followers || !data.followers.length) {
        sectionEl.classList.add('hidden');
        return;
      }

      sectionEl.classList.remove('hidden');
      listEl.innerHTML = '';

      data.followers.forEach((f) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'auth-friend-item-name';
        nameSpan.innerHTML = `<span class="af-target" data-user-id="${f.userId}" title="Send friend request">${renderAvatarAndName(f)}</span>`;
        const afTarget = nameSpan.querySelector('.af-target');
        if (afTarget) afTarget.addEventListener('click', () => sendFriendRequestTo(f.userId, afTarget));
        item.appendChild(nameSpan);

        if (f.followingBack) {
          const badge = document.createElement('span');
          badge.className = 'auth-popup-text';
          badge.textContent = 'Following';
          item.appendChild(badge);
        } else {
          const followBackBtn = document.createElement('button');
          followBackBtn.className = 'auth-btn auth-btn-primary auth-btn-tiny';
          followBackBtn.textContent = 'Follow Back';
          followBackBtn.addEventListener('click', () => {
            followBackBtn.disabled = true;
            fetch('/api/follow', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-Id': window.WWP?.deviceId || '',
              },
              credentials: 'include',
              body: JSON.stringify({ action: 'follow', targetUserId: f.userId }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.success) {
                  item.removeChild(followBackBtn);
                  const badge = document.createElement('span');
                  badge.className = 'auth-popup-text';
                  badge.textContent = 'Following';
                  item.appendChild(badge);
                  loadLeaderboard();
                }
              })
              .catch((e) => console.error('followBack error:', e))
              .finally(() => { followBackBtn.disabled = false; });
          });
          item.appendChild(followBackBtn);
        }

        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadFollowers error:', e);
      sectionEl.classList.add('hidden');
    }
  }

  async function loadGlobalLeaderboard() {
    const listEl = document.getElementById('globalLeaderboardList');
    if (!listEl) return;

    listEl.innerHTML = '<span class="auth-popup-text">Loading…</span>';

    try {
      const res = await fetch('/api/leaderboard/global', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) {
        listEl.innerHTML = '<span class="auth-popup-text">Could not load rankings.</span>';
        return;
      }

      listEl.innerHTML = '';

      if (!data.entries || !data.entries.length) {
        listEl.innerHTML = '<span class="auth-popup-text">No scores yet.</span>';
        return;
      }

      data.entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';
        const extra = entry.isYou ? ' (You)' : '';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'auth-friend-item-name';
        const avatarHtml = renderAvatarAndName(entry, extra);
        nameSpan.innerHTML = entry.isYou
          ? `#${entry.rank} ${avatarHtml} — ${entry.score}`
          : `#${entry.rank} <span class="af-target" data-user-id="${entry.userId}" title="Send friend request">${avatarHtml}</span> — ${entry.score}`;
        item.appendChild(nameSpan);

        if (!entry.isYou) {
          const afTarget = nameSpan.querySelector('.af-target');
          if (afTarget) afTarget.addEventListener('click', () => sendFriendRequestTo(entry.userId, afTarget));

          const followBtn = document.createElement('button');
          followBtn.className = 'auth-btn auth-btn-tiny ' + (entry.isFollowing ? 'auth-btn-secondary' : 'auth-btn-primary');
          followBtn.textContent = entry.isFollowing ? 'Following' : 'Follow';
          followBtn.dataset.following = entry.isFollowing ? 'true' : 'false';
          followBtn.addEventListener('click', () => toggleFollow(entry.userId, followBtn));
          item.appendChild(followBtn);
        }

        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadGlobalLeaderboard error:', e);
      listEl.innerHTML = '<span class="auth-popup-text">Could not load rankings.</span>';
    }
  }

  async function toggleFollow(targetUserId, buttonEl) {
    // Read current state from the button itself rather than a value
    // captured when the listener was first attached — otherwise every
    // click after the first re-sends the same original action (e.g.
    // "Following" never actually unfollows on a second click).
    const currentlyFollowing = buttonEl.dataset.following === 'true';
    const action = currentlyFollowing ? 'unfollow' : 'follow';
    buttonEl.disabled = true;

    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action, targetUserId }),
      });
      const data = await res.json();

      if (res.ok) {
        buttonEl.dataset.following = data.following ? 'true' : 'false';
        buttonEl.textContent = data.following ? 'Following' : 'Follow';
        buttonEl.className = 'auth-btn auth-btn-tiny ' + (data.following ? 'auth-btn-secondary' : 'auth-btn-primary');
        loadLeaderboard(); // personal ranking now includes/excludes this user
      }
    } catch (e) {
      console.error('toggleFollow error:', e);
    } finally {
      buttonEl.disabled = false;
    }
  }

  async function sendFriendRequestTo(targetUserId, wrapperEl) {
    if (wrapperEl.dataset.requested === 'true') return;
    wrapperEl.dataset.requested = 'true';
    const prevTitle = wrapperEl.title;
    wrapperEl.title = 'Sending friend request…';

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'add', targetUserId }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        wrapperEl.title = 'Friend request sent';
      } else {
        // Already friends / already pending isn't a failure worth
        // retrying — leave it marked as requested either way.
        wrapperEl.title = data.error || 'Friend request sent';
      }
    } catch (e) {
      console.error('sendFriendRequestTo error:', e);
      wrapperEl.dataset.requested = 'false';
      wrapperEl.title = prevTitle;
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Deterministic watercolour-style avatar for anyone without a real
  // profile picture (i.e. not signed in via Google) — same seed always
  // produces the same soft gradient blob, so it feels personal rather
  // than random on every render.
  function generateAvatarDataUri(seed) {
    seed = String(seed || 'wwp');
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const abs = Math.abs(hash);
    const hue1 = abs % 360;
    const hue2 = (hue1 + 45 + ((abs >> 3) % 70)) % 360;
    const cx = 32 + (abs % 20);
    const cy = 32 + ((abs >> 5) % 20);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue1},60%,80%)"/>
        <stop offset="100%" stop-color="hsl(${hue2},55%,68%)"/>
      </linearGradient></defs>
      <circle cx="50" cy="50" r="50" fill="url(#g)"/>
      <circle cx="${cx}" cy="${cy}" r="20" fill="rgba(255,255,255,0.28)"/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // Renders the avatar + username markup used consistently across
  // friends, followers, and both leaderboards — Google picture (or a
  // generated blob) plus a golden ring/shine for supporters.
  function renderAvatarAndName(entry, extraLabel) {
    const src = entry.avatarUrl || generateAvatarDataUri(entry.username || entry.userId || entry.email || 'x');
    const avatarClass = 'auth-avatar' + (entry.isSupporter ? ' auth-avatar-supporter' : '');
    const nameClass = entry.isSupporter ? 'username-supporter' : '';
    const label = escapeHtml(entry.username || entry.email || 'Unnamed') + (extraLabel || '');
    return `<img src="${src}" class="${avatarClass}" alt=""><span class="${nameClass}">${label}</span>`;
  }

  async function addFriend() {
    const input = document.getElementById('addFriendInput');
    const msgEl = document.getElementById('friendMessage');
    const errEl = document.getElementById('friendError');
    const identifier = input?.value?.trim();

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    if (!identifier) {
      if (errEl) {
        errEl.textContent = 'Enter a username, email, or friend ID';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'add', identifier }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Could not send request';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = data.message || 'Friend request sent!';
        msgEl.classList.remove('hidden');
      }
      if (input) input.value = '';
      loadFriends();
    } catch (e) {
      console.error('addFriend error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function respondToRequest(requestId, action) {
    try {
      await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action, requestId }),
      });
      loadFriends();
    } catch (e) {
      console.error('respondToRequest error:', e);
    }
  }

  async function removeFriend(friendUserId) {
    try {
      await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'remove', friendUserId }),
      });
      loadFriends();
    } catch (e) {
      console.error('removeFriend error:', e);
    }
  }

  async function saveUsername() {
    const input = document.getElementById('usernameInput');
    const msgEl = document.getElementById('usernameMessage');
    const errEl = document.getElementById('usernameError');
    const username = input?.value?.trim();

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      if (errEl) {
        errEl.textContent = 'Username must be 3-20 characters, letters/numbers/underscores only';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ username }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Failed to save username';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = 'Username saved!';
        msgEl.classList.remove('hidden');
      }
      loadProfile(); // re-checks canChangeUsername and locks the field if that was the one allowed change
    } catch (e) {
      console.error('saveUsername error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function saveRecoveryEmail() {
    const input = document.getElementById('recoveryEmailInput');
    const msgEl = document.getElementById('recoveryEmailMessage');
    const errEl = document.getElementById('recoveryEmailError');
    const recoveryEmail = input?.value?.trim() || '';

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ recoveryEmail }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Failed to save recovery email';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = recoveryEmail ? 'Recovery email saved!' : 'Recovery email removed.';
        msgEl.classList.remove('hidden');
      }
    } catch (e) {
      console.error('saveRecoveryEmail error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  function toggleAuthPopup() {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (popup) {
      popup.classList.toggle('hidden');
      document.body.classList.toggle('auth-popup-open', !popup.classList.contains('hidden'));
      if (!popup.classList.contains('hidden') && window.WWP_Twinkle) {
        window.WWP_Twinkle.syncRadioUI();
      }
    }
  }

  function closeAuthPopup() {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (popup) popup.classList.add('hidden');
    document.body.classList.remove('auth-popup-open');
  }

  // Exposed so other modules (e.g. Community Ideas) can check sign-in
  // state and prompt sign-in without duplicating the auth popup logic.
  window.WWP_getAuthState = () => authState;
  window.WWP_promptSignIn = () => { toggleAuthPopup(); };

  async function sendMagicLink() {
    const emailInput = document.getElementById(EMAIL_INPUT_ID);
    const email = emailInput?.value?.trim();

    if (!email || !email.includes('@')) {
      showAuthError('Please enter a valid email');
      return;
    }

    showAuthLoading(true);
    clearMessages();

    try {
      const res = await fetch('/api/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || ''
        },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        showAuthError(data.error || 'Failed to send link');
        return;
      }

      showAuthMessage('Check your email for the sign-in link. Link expires in 24 hours.');
      emailInput.value = '';
    } catch (err) {
      console.error('sendMagicLink error:', err);
      showAuthError('Network error. Please try again.');
    } finally {
      showAuthLoading(false);
    }
  }

  async function signOut() {
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials: 'include',
      });

      if (res.ok) {
        authState = { authenticated: false, email: null, role: null };
        renderAuthUI('sign-in');
        closeAuthPopup();
      } else {
        showAuthError('Sign out failed');
      }
    } catch (err) {
      console.error('signOut error:', err);
      showAuthError('Network error. Please try again.');
    }
  }

  function wireDeleteAccountUI() {
    const step1 = document.getElementById('deleteAccountStep1');
    const step2 = document.getElementById('deleteAccountStep2');
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const cancelBtn = document.getElementById('deleteAccountCancelBtn');
    const confirmBtn = document.getElementById('deleteAccountConfirmBtn');
    const confirmInput = document.getElementById('deleteAccountConfirmInput');
    const errorBox = document.getElementById('deleteAccountError');
    if (!deleteBtn || !step1 || !step2 || !confirmBtn || !cancelBtn || !confirmInput) return;

    deleteBtn.addEventListener('click', () => {
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      confirmInput.value = '';
      if (errorBox) errorBox.classList.add('hidden');
    });

    cancelBtn.addEventListener('click', () => {
      step2.classList.add('hidden');
      step1.classList.remove('hidden');
      if (errorBox) errorBox.classList.add('hidden');
    });

    confirmBtn.addEventListener('click', async () => {
      if (errorBox) errorBox.classList.add('hidden');
      if (confirmInput.value.trim().toUpperCase() !== 'DELETE') {
        if (errorBox) {
          errorBox.textContent = 'Please type DELETE to confirm.';
          errorBox.classList.remove('hidden');
        }
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      try {
        const res = await fetch('/api/user/delete', {
          method: 'POST',
          headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
          credentials: 'include',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (errorBox) {
            errorBox.textContent = data.error || 'Failed to delete account. Please try again.';
            errorBox.classList.remove('hidden');
          }
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Delete';
          return;
        }
        authState = { authenticated: false, email: null, role: null };
        closeAuthPopup();
        renderAuthUI('sign-in');
        window.location.reload();
      } catch (err) {
        console.error('deleteAccount error:', err);
        if (errorBox) {
          errorBox.textContent = 'Network error. Please try again.';
          errorBox.classList.remove('hidden');
        }
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Delete';
      }
    });
  }

  async function handleVerifyRedirect() {
    const token = window.__wwpAuthToken;

    if (!token) return;

    try {
      const res = await fetch(`/api/verify-token?token=${encodeURIComponent(token)}`, {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' }
      });

      const data = await res.json();

      if (res.ok) {
        authState = { authenticated: true, email: data.email, userId: data.userId, role: data.role || 'user' };
        renderAuthUI('signed-in');
        window.history.replaceState({}, document.title, '/');
        showAuthToast("You're signed in!", 'success');
        checkSession();
      } else {
        window.history.replaceState({}, document.title, '/');
        showAuthToast(data.error || 'Sign-in failed', 'error');
      }
    } catch (err) {
      console.error('handleVerifyRedirect error:', err);
      window.history.replaceState({}, document.title, '/');
    }
  }

  function showAuthMessage(msg) {
    const msgEl = document.getElementById('authPopupMessage');
    if (msgEl) {
      msgEl.textContent = msg;
      msgEl.classList.remove('hidden');
    }
  }

  function showAuthError(msg) {
    const errEl = document.getElementById('authPopupError');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  function showAuthLoading(show) {
    const loadingEl = document.getElementById('authPopupLoading');
    const sendBtn = document.getElementById(SEND_LINK_BTN_ID);
    if (loadingEl) loadingEl.classList.toggle('hidden', !show);
    if (sendBtn) sendBtn.disabled = show;
  }

  function clearMessages() {
    const msgEl = document.getElementById('authPopupMessage');
    const errEl = document.getElementById('authPopupError');
    if (msgEl) msgEl.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');
  }

  function showAuthToast(msg, type = 'success') {
    // Remove any existing toast first
    const existing = document.querySelector('.auth-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'auth-toast' + (type === 'error' ? ' error' : '');

    const icon = type === 'error'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>';

    toast.innerHTML = `<span class="auth-toast-icon">${icon}</span><span>${msg}</span>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AuthSystem = { checkSession, signOut, toggleAuthPopup };
})();

})();

/* ===== deferred feature script 13 ===== */
(function(){
/* ============================================================
   THE COMMUNITY IDEAS :: feature-request feed with upvotes,
   comments/replies, and a signed-in-only masjid photo submission
   flow that lands in an admin approval queue (see admin/broadcast.html)
   before ever reaching Find a Mosque. Talks to /api/community/*.
   ============================================================ */
(function(){
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function deviceHeaders(extra){
    const h = Object.assign({ 'X-Device-Id': window.WWP?.deviceId || '' }, extra || {});
    return h;
  }

  function isSignedIn(){
    const s = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
    return !!(s && s.authenticated);
  }

  function escapeHtml(str){
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function timeAgo(ts){
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if(s < 60) return 'just now';
    const m = Math.floor(s/60); if(m < 60) return m+'m ago';
    const h = Math.floor(m/60); if(h < 24) return h+'h ago';
    const dd = Math.floor(h/24); if(dd < 30) return dd+'d ago';
    return new Date(ts).toLocaleDateString();
  }

  // ---- Tabs ----
  $$('.cm-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      if(tab.classList.contains('cm-tab-disabled')){
        showToast("Masjid photo submissions are paused for now — coming back soon.");
        return;
      }
      $$('.cm-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.cmtab;
      $('#cmPanelIdeas').classList.toggle('active', target==='ideas');
      $('#cmPanelBugs').classList.toggle('active', target==='bugs');
      $('#cmPanelPhotos')?.classList.toggle('active', target==='photos');
      if(target==='bugs') loadMyBugs();
      if(target==='photos') loadMyPhotos();
    });
  });

  // ---- Sign-in gating ----
  function refreshSignInNotes(){
    const signed = isSignedIn();
    $('#cmSigninNoteIdeas')?.classList.toggle('hidden', signed);
    $('#cmSigninNotePhotos')?.classList.toggle('hidden', signed);
    $('#cmSigninNoteBugs')?.classList.toggle('hidden', signed);
  }
  function openSignIn(){
    if (window.WWP_promptSignIn) { window.WWP_promptSignIn(); return; }
    if (window.AuthSystem && window.AuthSystem.toggleAuthPopup) { window.AuthSystem.toggleAuthPopup(); return; }
    console.warn('Sign-in popup unavailable — WWP_promptSignIn/AuthSystem not yet loaded.');
  }
  $('#cmSignInBtnIdeas')?.addEventListener('click', openSignIn);
  $('#cmSignInBtnPhotos')?.addEventListener('click', openSignIn);
  $('#cmSignInBtnBugs')?.addEventListener('click', openSignIn);
  document.addEventListener('wwp-auth-ready', refreshSignInNotes);
  // Covers direct navigation (e.g. reloading on /community-ideas) where the
  // data-page click listener never fires. window.WWP_authState is set
  // synchronously once checkSession() resolves, so if it's already
  // available by the time this script runs, reflect it immediately;
  // 'wwp-auth-ready' above still covers the case where it resolves later.
  if (window.WWP_authState) refreshSignInNotes();

  // ---- New idea form ----
  $('#cmNewIdeaToggle')?.addEventListener('click', ()=>{
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    $('#cmNewIdeaForm').classList.toggle('hidden');
  });
  $('#cmCancelIdeaBtn')?.addEventListener('click', ()=>{
    $('#cmNewIdeaForm').classList.add('hidden');
    $('#cmIdeaTitle').value = '';
    $('#cmIdeaBody').value = '';
  });
  $('#cmSubmitIdeaBtn')?.addEventListener('click', async ()=>{
    const title = $('#cmIdeaTitle').value.trim();
    const body = $('#cmIdeaBody').value.trim();
    if(!title){ showToast('Give your idea a short title.'); return; }
    const btn = $('#cmSubmitIdeaBtn');
    btn.disabled = true; btn.textContent = 'Posting…';
    try{
      const res = await fetch('/api/community/ideas', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not post idea.'); return; }
      $('#cmIdeaTitle').value = ''; $('#cmIdeaBody').value = '';
      $('#cmNewIdeaForm').classList.add('hidden');
      showToast('Idea posted — jazakAllah khair!');
      loadIdeas();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Post idea';
    }
  });

  // ---- Ideas list ----
  function ideaCardHTML(idea){
    const voted = !!idea.voted;
    return `
    <div class="cm-card" data-idea-id="${idea.id}">
      <div class="cm-idea-title">${escapeHtml(idea.title)}</div>
      ${idea.body ? `<div class="cm-idea-body">${escapeHtml(idea.body)}</div>` : ''}
      <div class="cm-idea-meta">
        <button class="cm-vote-btn${voted?' voted':''}" data-action="vote" data-id="${idea.id}" aria-label="${voted?'Remove upvote':'Upvote this idea'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          <span data-role="votecount">${idea.votes}</span>
        </button>
        <button class="cm-comment-toggle" data-action="toggle-comments" data-id="${idea.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
          <span data-role="commentcount">${idea.commentCount || 0}</span> comments
        </button>
        <span class="cm-author">${escapeHtml(idea.username || 'Someone')} · ${timeAgo(idea.created_at)}</span>
      </div>
      <div class="cm-comments" id="cmComments-${idea.id}">
        <div class="cm-comment-list" id="cmCommentList-${idea.id}"><span style="font-size:12.5px;color:var(--text-dim);">Loading…</span></div>
        <div class="cm-comment-form" id="cmCommentForm-${idea.id}">
          <input type="text" placeholder="${isSignedIn() ? 'Add a comment…' : 'Sign in to comment'}" ${isSignedIn() ? '' : 'disabled'} data-role="comment-input">
          <button class="cm-btn" data-action="post-comment" data-id="${idea.id}">Post</button>
        </div>
      </div>
    </div>`;
  }

  async function loadIdeas(){
    const list = $('#cmIdeasList');
    if(!list) return;
    try{
      const res = await fetch('/api/community/ideas', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const ideas = data.ideas || [];
      if(!ideas.length){
        list.innerHTML = `<div class="cm-empty">No ideas yet — be the first to share one!</div>`;
        return;
      }
      list.innerHTML = ideas.map(ideaCardHTML).join('');
    }catch(e){
      list.innerHTML = `<div class="cm-empty">Couldn't load ideas right now.</div>`;
    }
  }

  function isModerator(){
    const s = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
    return !!(s && (s.role === 'admin' || s.role === 'moderator'));
  }

  function modDeleteBtn(commentId){
    if(!isModerator()) return '';
    return `<button class="cm-mod-delete" data-action="delete-comment" data-comment="${commentId}" title="Remove this comment" aria-label="Remove this comment">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>
    </button>`;
  }

  function commentHTML(c, ideaId){
    return `
    <div class="cm-comment" data-comment-id="${c.id}">
      <div class="cm-comment-author">${escapeHtml(c.username || 'Someone')} <span style="font-weight:400;color:var(--text-dim);">· ${timeAgo(c.created_at)}</span>${modDeleteBtn(c.id)}</div>
      <div class="cm-comment-body">${escapeHtml(c.body)}</div>
      <button class="cm-reply-btn" data-action="show-reply" data-id="${ideaId}" data-parent="${c.id}">Reply</button>
      <div class="cm-reply-row hidden" id="cmReplyRow-${c.id}">
        <div class="cm-comment-form">
          <input type="text" placeholder="Write a reply…" data-role="comment-input">
          <button class="cm-btn" data-action="post-comment" data-id="${ideaId}" data-parent="${c.id}">Reply</button>
        </div>
      </div>
      <div class="cm-reply-row" data-role="replies-${c.id}">
        ${(c.replies || []).map(r => `
          <div class="cm-comment">
            <div class="cm-comment-author">${escapeHtml(r.username || 'Someone')} <span style="font-weight:400;color:var(--text-dim);">· ${timeAgo(r.created_at)}</span>${modDeleteBtn(r.id)}</div>
            <div class="cm-comment-body">${escapeHtml(r.body)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  async function loadComments(ideaId){
    const holder = $('#cmCommentList-'+ideaId);
    if(!holder) return;
    try{
      const res = await fetch('/api/community/ideas?commentsFor='+ideaId, { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const comments = data.comments || [];
      holder.innerHTML = comments.length
        ? comments.map(c => commentHTML(c, ideaId)).join('')
        : `<div style="font-size:12.5px;color:var(--text-dim);">No comments yet.</div>`;
    }catch(e){
      holder.innerHTML = `<div style="font-size:12.5px;color:var(--text-dim);">Couldn't load comments.</div>`;
    }
  }

  async function postComment(ideaId, input, parentId){
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    const body = input.value.trim();
    if(!body) return;
    input.disabled = true;
    try{
      const res = await fetch('/api/community/ideas', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'comment', ideaId, parentId: parentId || null, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not post comment.'); return; }
      input.value = '';
      loadComments(ideaId);
      const idea = $(`.cm-card[data-idea-id="${ideaId}"]`);
      const cc = idea?.querySelector('[data-role="commentcount"]');
      if(cc) cc.textContent = String((parseInt(cc.textContent, 10) || 0) + 1);
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      input.disabled = false;
    }
  }

  $('#cmIdeasList')?.addEventListener('click', (e)=>{
    const voteBtn = e.target.closest('[data-action="vote"]');
    if(voteBtn){
      if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
      const id = voteBtn.dataset.id;
      fetch('/api/community/ideas', {
        method: 'POST', credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'vote', ideaId: id })
      }).then(r=>r.json()).then(data=>{
        if(data.error){ showToast(data.error); return; }
        voteBtn.classList.toggle('voted', data.voted);
        voteBtn.querySelector('[data-role="votecount"]').textContent = data.votes;
      }).catch(()=> showToast('Network error. Please try again.'));
      return;
    }
    const toggleBtn = e.target.closest('[data-action="toggle-comments"]');
    if(toggleBtn){
      const id = toggleBtn.dataset.id;
      const panel = $('#cmComments-'+id);
      const nowOpen = panel.classList.toggle('open');
      if(nowOpen) loadComments(id);
      return;
    }
    const postBtn = e.target.closest('[data-action="post-comment"]');
    if(postBtn){
      const id = postBtn.dataset.id;
      const parent = postBtn.dataset.parent || null;
      const input = postBtn.previousElementSibling;
      postComment(id, input, parent);
      return;
    }
    const replyBtn = e.target.closest('[data-action="show-reply"]');
    if(replyBtn){
      if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
      const row = $('#cmReplyRow-'+replyBtn.dataset.parent);
      row?.classList.toggle('hidden');
      return;
    }
    const delBtn = e.target.closest('[data-action="delete-comment"]');
    if(delBtn){
      if(!confirm('Remove this comment? This can\'t be undone.')) return;
      delBtn.disabled = true;
      fetch('/api/community/ideas', {
        method: 'POST', credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'delete-comment', commentId: delBtn.dataset.comment })
      }).then(r=>r.json()).then(data=>{
        if(data.error){ showToast(data.error); delBtn.disabled = false; return; }
        delBtn.closest('.cm-comment')?.remove();
        showToast('Comment removed.');
      }).catch(()=>{ showToast('Network error. Please try again.'); delBtn.disabled = false; });
      return;
    }
  });

  // ---- Masjid photo submission ----
  let selectedPhotoFile = null;
  $('#cmPhotoInput')?.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    selectedPhotoFile = file;
    $('#cmPhotoLabel').textContent = file.name.length > 28 ? file.name.slice(0,25)+'…' : file.name;
    const preview = $('#cmPhotoPreview');
    const reader = new FileReader();
    reader.onload = () => { preview.src = reader.result; preview.style.display = 'block'; };
    reader.readAsDataURL(file);
  });

  $('#cmSubmitPhotoBtn')?.addEventListener('click', async ()=>{
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    if(!selectedPhotoFile){ showToast('Choose a photo first.'); return; }
    const btn = $('#cmSubmitPhotoBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try{
      const fd = new FormData();
      fd.append('photo', selectedPhotoFile);
      fd.append('masjidName', $('#cmMasjidName').value.trim());
      fd.append('note', $('#cmPhotoNote').value.trim());
      const res = await fetch('/api/community/photos', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders(),
        body: fd
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Upload failed.'); return; }
      showToast('Photo submitted — thanks! It\'ll appear once reviewed.');
      selectedPhotoFile = null;
      $('#cmPhotoInput').value = '';
      $('#cmPhotoPreview').style.display = 'none';
      $('#cmPhotoLabel').textContent = 'Take or choose a photo';
      $('#cmMasjidName').value = ''; $('#cmPhotoNote').value = '';
      loadMyPhotos();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Submit for review';
    }
  });

  async function loadMyPhotos(){
    if(!isSignedIn()) return;
    const holder = $('#cmMyPhotosList');
    if(!holder) return;
    try{
      const res = await fetch('/api/community/photos', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const photos = data.photos || [];
      if(!photos.length){ holder.innerHTML = ''; return; }
      holder.innerHTML = `<div style="font-size:12.5px;font-weight:700;color:var(--text-dim);margin:6px 0 10px;">Your submissions</div>` +
        photos.map(p => `
          <div class="cm-card" style="display:flex;align-items:center;gap:12px;">
            <img src="${escapeHtml(p.url)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex:none;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHtml(p.masjid_name || 'Unnamed masjid')}</div>
              <div style="font-size:11.5px;color:var(--text-dim);">${timeAgo(p.created_at)}</div>
            </div>
            <span class="cm-photo-status ${p.status}">${p.status}</span>
          </div>`).join('');
    }catch(e){ /* silent */ }
  }

  // ---- Bug reports ----
  $('#cmSubmitBugBtn')?.addEventListener('click', async ()=>{
    if(!isSignedIn()){ openSignIn(); return; }
    const title = $('#cmBugTitle').value.trim();
    const body = $('#cmBugBody').value.trim();
    if(!title){ showToast('Give a short summary of the bug first.'); return; }
    const btn = $('#cmSubmitBugBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try{
      const res = await fetch('/api/community/bugs', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not submit bug report.'); return; }
      $('#cmBugTitle').value = ''; $('#cmBugBody').value = '';
      showToast('Bug report sent — jazakAllah khair!');
      loadMyBugs();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Submit bug report';
    }
  });

  async function loadMyBugs(){
    const holder = $('#cmMyBugsList');
    if(!holder) return;
    try{
      const res = await fetch('/api/community/bugs', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const bugs = data.bugs || [];
      if(!bugs.length){ holder.innerHTML = `<div class="cm-empty">No bugs reported yet — you're either very lucky or very forgiving.</div>`; return; }
      holder.innerHTML = bugs.map(b => `
          <div class="cm-card">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
              <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHtml(b.title)}</div>
              <span class="cm-photo-status ${b.status}">${b.status}</span>
            </div>
            ${b.body ? `<div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;white-space:pre-wrap;">${escapeHtml(b.body)}</div>` : ''}
            <div style="font-size:11.5px;color:var(--text-dim);margin-top:6px;">${escapeHtml(b.username || 'Someone')} · ${timeAgo(b.created_at)}</div>
          </div>`).join('');
    }catch(e){ holder.innerHTML = `<div class="cm-empty">Couldn't load bug reports right now.</div>`; }
  }

  // ---- Init whenever the Community page becomes visible ----
  // Covers: clicking the nav icon, a direct load/refresh landing on
  // /community-ideas, and browser back/forward — not just the click
  // case, which was the original bug (data never loaded on refresh).
  let cmInitialized = false;
  function onCommunityShown(){
    refreshSignInNotes();
    cmInitialized = true;
    loadIdeas();
    if($('#cmPanelBugs')?.classList.contains('active')) loadMyBugs();
    if($('#cmPanelPhotos')?.classList.contains('active')) loadMyPhotos();
  }
  document.querySelectorAll('a[data-page="community"]').forEach(a=>{
    a.addEventListener('click', onCommunityShown);
  });
  window.addEventListener('wwp-page-shown', (e)=>{
    if(e.detail && e.detail.id === 'community') onCommunityShown();
  });
  // Covers the very first page load landing directly on /community-ideas:
  // switchPage() already ran (earlier in the document) before this
  // listener above existed, so check current visibility once at parse time.
  if(!document.getElementById('page-community')?.classList.contains('hidden')){
    onCommunityShown();
  }

  // ---- Keep-fresh polling ----
  // API responses are always fetched live (see /api/community/* — no
  // caching), but without this, someone else's new idea/comment/bug report
  // only ever shows up if you switch tabs or reload. Refresh the panel
  // that's actually on screen every 20s while Community is open and the
  // browser tab is visible, plus immediately when you switch back to this
  // browser tab after being away.
  function refreshActiveCmPanel(){
    const communityShown = !document.getElementById('page-community')?.classList.contains('hidden');
    if(!communityShown || document.visibilityState !== 'visible') return;
    if($('#cmPanelIdeas')?.classList.contains('active')) loadIdeas();
    else if($('#cmPanelBugs')?.classList.contains('active')) loadMyBugs();
  }
  setInterval(refreshActiveCmPanel, 20000);
  document.addEventListener('visibilitychange', refreshActiveCmPanel);
})();

})();

/* ===== deferred feature script 15 ===== */
(function(){
/* ============================================================
   BACKUP & RESTORE :: full account data export/import, wired
   into Settings. Download builds a JSON file client-side from
   /api/user/backup and hands it to the native share sheet on
   iOS/Android (falls back to a plain download link on desktop).
   Restore uses a native file picker, confirms, then POSTs the
   file straight back to the same endpoint.
   ============================================================ */
(function(){
  const $ = (id) => document.getElementById(id);

  function deviceHeaders(extra){
    return Object.assign({ 'X-Device-Id': window.WWP?.deviceId || '' }, extra || {});
  }

  function showBackupMsg(text){
    const el = $('backupMessage');
    const err = $('backupError');
    if(err) err.classList.add('hidden');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }
  function showBackupErr(text){
    const el = $('backupError');
    const msg = $('backupMessage');
    if(msg) msg.classList.add('hidden');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }

  async function downloadBackup(){
    const btn = $('downloadBackupBtn');
    if(!btn) return;
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showBackupErr('Sign in first to back up your account.'); return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Preparing…';

    try{
      const res = await fetch('/api/user/backup', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      if(!res.ok){ showBackupErr(data.error || 'Could not build backup.'); return; }

      const dateStr = new Date().toISOString().slice(0,10);
      const filename = `wherewepraying-backup-${dateStr}.json`;
      const jsonText = JSON.stringify(data, null, 2);
      const file = new File([jsonText], filename, { type: 'application/json' });

      if(navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'WhereWePraying? backup' });
          showBackupMsg('Backup ready — choose where to save it.');
          return;
        }catch(shareErr){
          // User cancelled the share sheet, or share failed — fall through to download link.
        }
      }

      const url = URL.createObjectURL(new Blob([jsonText], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showBackupMsg('Backup downloaded.');
    }catch(e){
      showBackupErr('Network error. Please try again.');
    }finally{
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function pickRestoreFile(){
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showBackupErr('Sign in first to restore a backup.'); return; }
    $('restoreBackupInput')?.click();
  }

  async function handleRestoreFile(e){
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;

    const confirmed = confirm('Restoring will overwrite your current prayer times, journal, Qur\'an, du\'a, and guide data on this account with what\'s in this backup file. Continue?');
    if(!confirmed) return;

    const btn = $('restoreBackupBtn');
    if(btn){ btn.disabled = true; btn.textContent = 'Restoring…'; }

    try{
      const text = await file.text();
      const res = await fetch('/api/user/backup', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: text
      });
      const data = await res.json();
      if(!res.ok){ showBackupErr(data.error || 'Could not restore this backup.'); return; }
      showBackupMsg(`Restored: ${(data.restored || []).join(', ') || 'nothing found'}. Refresh the page to see your data.`);
    }catch(err){
      showBackupErr('That file could not be read. Please try again.');
    }finally{
      if(btn){ btn.disabled = false; btn.textContent = 'Restore from file'; }
    }
  }

  $('downloadBackupBtn')?.addEventListener('click', downloadBackup);
  $('restoreBackupBtn')?.addEventListener('click', pickRestoreFile);
  $('restoreBackupInput')?.addEventListener('change', handleRestoreFile);
})();

})();

/* ===== deferred feature script 16 ===== */
(function(){
/* ============================================================
   SUPPORTER CHECKOUT :: web-only "support the app" flow via
   Stripe Checkout (hosted page, Apple Pay/Google Pay automatic).
   Deliberately NOT gated behind any feature — pure optional
   support, framed the same way in the UI. Kept out of any future
   native iOS wrapper build (should be excluded/hidden there to
   stay clear of Apple's In-App Purchase requirement — see chat
   notes). Talks to /api/supporter/checkout.
   ============================================================ */
(function(){
  const $ = (id) => document.getElementById(id);

  function deviceHeaders(extra){
    return Object.assign({ 'X-Device-Id': window.WWP?.deviceId || '' }, extra || {});
  }

  function showSupporterErr(text){
    const el = $('supporterError');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }

  function render(isSupporter){
    const already = $('supporterAlreadyBox');
    const form = $('supporterForm');
    const intro = $('supporterIntroText');
    if(!already || !form) return;
    already.classList.toggle('hidden', !isSupporter);
    form.classList.toggle('hidden', isSupporter);
    if(intro) intro.classList.toggle('hidden', isSupporter);
  }

  document.querySelectorAll('input[name="supporterAmount"]').forEach(radio=>{
    radio.addEventListener('change', ()=>{
      $('supporterCustomAmount')?.classList.toggle('hidden', radio.value !== 'custom' || !radio.checked);
    });
  });

  $('supporterCheckoutBtn')?.addEventListener('click', async ()=>{
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showSupporterErr('Sign in first to support the app.'); return; }

    const modeInput = document.querySelector('input[name="supporterMode"]:checked');
    const amountInput = document.querySelector('input[name="supporterAmount"]:checked');
    const mode = modeInput ? modeInput.value : 'payment';
    let amount = amountInput ? amountInput.value : '5';
    if(amount === 'custom'){
      amount = ($('supporterCustomAmount')?.value || '').trim();
    }
    amount = Number(amount);
    if(!Number.isFinite(amount) || amount < 1){
      showSupporterErr('Please enter a valid amount.');
      return;
    }

    const btn = $('supporterCheckoutBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Redirecting…';

    try{
      const res = await fetch('/api/supporter/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount, mode })
      });
      const data = await res.json();
      if(!res.ok || !data.url){
        showSupporterErr(data.error || 'Could not start checkout.');
        return;
      }
      window.location.href = data.url;
    }catch(e){
      showSupporterErr('Network error. Please try again.');
    }finally{
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  window.WWP_Supporter = { render };

  // Post-checkout redirect handling.
  const params = new URLSearchParams(location.search);
  if(params.get('supporter_success') === '1'){
    showToast("Jazakhallah khair — you're now a Supporter! 🤍");
    history.replaceState({}, '', location.pathname);
  } else if(params.get('supporter_cancel') === '1'){
    history.replaceState({}, '', location.pathname);
  }
})();

})();

/* ===== deferred feature script 17 ===== */
(function(){
/* ============================================================
   SITE-WIDE TWINKLE / SPARKLE SYSTEM
   Generates a field of soft twinkling dots spanning the full
   scroll height of whichever page is currently visible. Density
   and opacity scale with the saved preference (off/low/medium/
   full), stored per-device and — when signed in — mirrored to
   the account settings radio group in the Account popup.
   Regenerates on page switch (via switchPage) and on window
   resize (debounced), since full-page height changes with content.
   ============================================================ */
window.WWP_Twinkle = (function(){
  const STORAGE_KEY = 'wwp:twinkle:level';
  const LEVELS = {
    off:    { count: 0,  minSize: 0,   maxSize: 0   },
    low:    { count: 18, minSize: 1.5, maxSize: 2.5 },
    medium: { count: 36, minSize: 1.5, maxSize: 3   },
    full:   { count: 60, minSize: 1.5, maxSize: 3.5 }
  };
  const VALID = Object.keys(LEVELS);

  function getLevel(){
    try{
      const v = localStorage.getItem(STORAGE_KEY);
      return VALID.includes(v) ? v : 'low';
    }catch(e){ return 'low'; }
  }
  function setLevel(level){
    if(!VALID.includes(level)) return;
    try{ localStorage.setItem(STORAGE_KEY, level); }catch(e){}
    document.body.setAttribute('data-twinkle', level);
    render();
  }

  function currentVisiblePage(){
    return document.querySelector('.app-page:not(.hidden)');
  }

  function render(){
    const level = document.body.getAttribute('data-twinkle') || getLevel();
    // Clear any existing field on every page, not just the one about
    // to be shown — otherwise hidden pages accumulate stale fields
    // every time render() runs (page switch, resize, interval tick).
    document.querySelectorAll('.wwp-twinkle-field').forEach(el=>el.remove());

    const page = currentVisiblePage();
    if(!page) return;
    if(level === 'off') return;

    const cfg = LEVELS[level];
    if(!cfg || cfg.count === 0) return;

    const field = document.createElement('div');
    field.className = 'wwp-twinkle-field';
    field.setAttribute('aria-hidden', 'true');

    // Spread stars across the page's full rendered height, not just
    // the visible viewport, so scrolling reveals more rather than a
    // twinkle field that ends abruptly partway down a long page.
    const pageHeight = Math.max(page.scrollHeight, window.innerHeight);
    const frag = document.createDocumentFragment();
    for(let i=0; i<cfg.count; i++){
      const star = document.createElement('span');
      star.className = 'wwp-star';
      const size = cfg.minSize + Math.random()*(cfg.maxSize - cfg.minSize);
      const left = Math.random()*100;
      const top = Math.random()*pageHeight;
      const delay = Math.random()*3.4;
      star.style.width = size+'px';
      star.style.height = size+'px';
      star.style.left = left+'%';
      star.style.top = top+'px';
      star.style.setProperty('--wwp-tw-delay', delay+'s');
      frag.appendChild(star);
    }
    field.appendChild(frag);
    field.style.height = pageHeight+'px';
    page.insertBefore(field, page.firstChild);
  }

  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 250);
  });

  // Re-render whenever the page's own content height might have
  // changed (images loading, accordions opening, etc.) without a
  // full page switch — cheap enough to run on a slow interval.
  setInterval(()=>{
    if(document.body.getAttribute('data-twinkle') !== 'off') render();
  }, 4000);

  document.body.setAttribute('data-twinkle', getLevel());

  function syncRadioUI(){
    const level = getLevel();
    document.querySelectorAll('input[name="twinkleLevel"]').forEach(r=>{
      r.checked = (r.value === level);
    });
  }

  document.addEventListener('change', (e)=>{
    if(e.target && e.target.name === 'twinkleLevel'){
      setLevel(e.target.value);
    }
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ syncRadioUI(); render(); });
  }else{
    syncRadioUI();
    render();
  }

  return { getLevel, setLevel, render, syncRadioUI, LEVELS: Object.keys(LEVELS) };
})();

})();

/* ===== deferred feature script 18 ===== */
(function(){
/* ============================================================
   EXPERIMENTAL GLASS MODE :: opt-in site-wide glassmorphism.
   Off by default. Applies body[data-glass="on"], which the CSS above
   uses to swap --surface/--surface-alt/--border/--shadow to translucent
   values and activate --surface-blur — every card/panel already
   references these tokens, so this one attribute frosts the whole site.
   ============================================================ */
(function(){
  const STORAGE_KEY = 'wwp:glass:mode';

  function isOn(){
    try{ return localStorage.getItem(STORAGE_KEY) === 'on'; }
    catch(e){ return false; }
  }

  function apply(on){
    document.body.setAttribute('data-glass', on ? 'on' : 'off');
  }

  function setMode(on){
    try{ localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); }catch(e){}
    apply(on);
  }

  function syncToggleUI(){
    const el = document.getElementById('glassModeToggle');
    if (el) el.checked = isOn();
  }

  // Apply immediately (before DOMContentLoaded where possible) so
  // there's no flash of the non-glass look when it's enabled.
  apply(isOn());

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'glassModeToggle') {
      setMode(e.target.checked);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleUI);
  } else {
    syncToggleUI();
  }
})();

})();


/* ===== deferred feature script 21 ===== */
(function(){
/* Qur'an reader — floating "back to top" button. Only relevant while
   scrolling through the ayahs themselves: hidden above the reading pane
   (nothing to scroll back up to yet) and hidden again once scrolled
   past it into the prev/next-surah nav and footer widgets, which
   already have their own "Back to Top" text button. */
(function(){
  var btn = document.getElementById('qrScrollTopBtn');
  var page = document.getElementById('page-quran');
  if(!btn || !page) return;

  var ticking = false;
  function onScroll(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      ticking = false;
      if(page.classList.contains('hidden')){ btn.classList.remove('show'); return; }
      var list = document.getElementById('ayahList');
      if(!list){ btn.classList.remove('show'); return; }
      var rect = list.getBoundingClientRect();
      var insideReadingArea = rect.top <= 0 && rect.bottom > 0;
      btn.classList.toggle('show', insideReadingArea);
    });
  }
  window.addEventListener('scroll', onScroll, {passive:true});

  btn.addEventListener('click', function(){
    window.scrollTo({top:0, behavior:'smooth'});
  });
})();

})();

/* ===== deferred feature script 22 ===== */
(function(){
(function(){
  var overlay = document.getElementById('pokeNotifyOverlay');
  var listEl = document.getElementById('pokeNotifyList');
  var closeBtn = document.getElementById('pokeNotifyClose');
  var badgeBtn = document.getElementById('pokeReceivedBadge');
  if(!overlay || !listEl || !closeBtn) return;

  var lastPokes = [];

  function escapeHtmlPN(s){
    var div = document.createElement('div');
    div.textContent = s == null ? '' : s;
    return div.innerHTML;
  }

  // Small deterministic colour-initial avatar for pokers without a real
  // profile picture — self-contained here rather than sharing the auth
  // popup's version, since consts/functions inside one script block
  // aren't visible from another.
  function avatarMarkup(poke){
    if(poke.avatarUrl){
      return '<img src="'+poke.avatarUrl+'" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex:none;">';
    }
    var seed = poke.username || 'wwp';
    var hash = 0;
    for(var i=0;i<seed.length;i++) hash = (hash*31 + seed.charCodeAt(i))|0;
    var hue = Math.abs(hash) % 360;
    var initial = (seed.trim()[0] || '?').toUpperCase();
    return '<span style="width:24px;height:24px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:hsl('+hue+',55%,70%);color:#fff;font-size:11px;font-weight:800;">'+initial+'</span>';
  }

  function renderPokeBackBtn(fromUserId){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poke-notify-back-btn';
    btn.textContent = 'Poke back';
    btn.addEventListener('click', function(){
      btn.disabled = true;
      btn.textContent = 'Poking…';
      fetch('/api/push/poke', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials:'include',
        body: JSON.stringify({ friendUserId: fromUserId })
      })
        .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, status:r.status, data:d}; }); })
        .then(function(res){
          if((res.ok && res.data.success) || res.status===409){ btn.textContent = 'Poked ✓'; }
          else { btn.textContent = 'Poke back'; btn.disabled = false; }
        })
        .catch(function(){ btn.textContent = 'Poke back'; btn.disabled = false; });
    });
    return btn;
  }

  function renderNotifyList(pokes){
    listEl.innerHTML = '';
    pokes.forEach(function(p){
      var item = document.createElement('div');
      item.className = 'poke-notify-item';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'poke-notify-name';
      nameSpan.innerHTML = avatarMarkup(p) + '<span class="pn-name-text">'+escapeHtmlPN(p.username)+'</span><span class="poke-notify-streak">'+p.streakDays+'d</span>';
      item.appendChild(nameSpan);
      item.appendChild(renderPokeBackBtn(p.fromUserId));
      listEl.appendChild(item);
    });
  }

  function openOverlay(){
    overlay.classList.remove('hidden');
    requestAnimationFrame(function(){ overlay.classList.add('show'); });
  }
  function closeOverlay(){
    overlay.classList.remove('show');
    setTimeout(function(){ overlay.classList.add('hidden'); }, 250);
  }
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeOverlay(); });

  function updateBadge(){
    if(!badgeBtn) return;
    if(lastPokes.length){
      badgeBtn.textContent = '👋 ' + lastPokes.length;
      badgeBtn.classList.remove('hidden');
    } else {
      badgeBtn.classList.add('hidden');
    }
  }
  if(badgeBtn){
    badgeBtn.addEventListener('click', function(){
      if(!lastPokes.length) return;
      renderNotifyList(lastPokes);
      openOverlay();
    });
  }

  async function checkPokesOnLogin(){
    try{
      var res = await fetch('/api/push/pokes-received', {
        credentials:'include',
        headers:{ 'X-Device-Id': window.WWP?.deviceId || '' }
      });
      if(!res.ok) return;
      var data = await res.json();
      if(!data.pokes || !data.pokes.length) return;

      lastPokes = data.pokes;
      window.WWP_recentPokes = lastPokes;
      updateBadge();
      renderNotifyList(lastPokes);
      openOverlay();
    }catch(e){ console.warn('poke notification check failed', e); }
  }

  document.addEventListener('wwp-auth-ready', function(e){
    if(e.detail && e.detail.authenticated) checkPokesOnLogin();
  });
})();

})();

/* ===== deferred feature script 23 ===== */
(function(){
(function(){
  function revealLampFxWhenLoaded(containers){
    containers.forEach(function(container){
      if(!container) return;
      var imgs = Array.prototype.filter.call(container.children, function(el){ return el.tagName === 'IMG'; });
      var fx = Array.prototype.filter.call(container.children, function(el){ return el.classList && el.classList.contains('wwp-lamp-fx'); });
      if(!imgs.length || !fx.length) return;

      var reveal = function(){ fx.forEach(function(f){ f.classList.add('wwp-loaded'); }); };
      var pending = 0;
      imgs.forEach(function(img){
        if(img.complete) return; // already loaded (cache, or arrived before this ran)
        pending++;
        var done = function(){ pending--; if(pending<=0) reveal(); };
        img.addEventListener('load', done, {once:true});
        img.addEventListener('error', done, {once:true}); // don't hide the glow forever if the image fails
      });
      if(pending===0) reveal();
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    revealLampFxWhenLoaded([
      document.querySelector('.home-hero-art'),
      document.querySelector('.qh-hero-art'),
      document.querySelector('.dd-hero-inner')
    ]);
  });
})();

})();

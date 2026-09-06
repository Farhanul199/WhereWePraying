(function(){
/* ============================================================
   FIND A MOSQUE :: ranked-by-Jama'ah view. A static header bar
   lists the 5 prayer names. Below it, each mosque is its own
   widget, ordered ascending by whichever prayer is currently
   "live" (the earliest prayer whose last mosque + 10min buffer
   hasn't passed yet). Mosques tied on the same time get a
   coloured tie border. Once every mosque's Isha + buffer has
   passed for today, ranking loops to tomorrow's Fajr.

   NEW: a "By Time" / "By Area" toggle lets the person switch to
   a region-grouped view instead (Tower Hamlets first, then other
   regions alphabetically, each mosque listed under its region).
   The toggle buttons are created here in JS rather than in the
   HTML template, so this file is the only thing that needs to
   change. Last-used view mode is remembered via LocalCache.
   ============================================================ */
(function(){
  const PRAYER_LABELS = {fajr:'Fajr', zuhr:'Dhuhr', asr:'Asr', maghrib:'Maghrib', isha:'Isha'};
  const PRAYER_ORDER = ['fajr','zuhr','asr','maghrib','isha'];
  const TYPE_LABELS = {mosque:'Mosque', community_hall:'Community Hall', prayer_room:'Prayer Room'};
  const BUFFER_MIN = 10;
  const PINNED_REGION = 'Tower Hamlets';

  // deviceHeaders, escapeHtml: shared, defined once in wwp-core.js — no local copy needed.

  function londonNow(){
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    return {
      dateIso: `${get('year')}-${get('month')}-${get('day')}`,
      minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10),
    };
  }

  function parseTimeToMinutes(prayer, raw){
    if (!raw) return null;
    const cleaned = raw.replace('.', ':').trim();
    const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (prayer !== 'fajr' && h >= 1 && h <= 11) h += 12;
    return h * 60 + min;
  }

  // The source mixes "1:30", "01:30" and 24h "13:30" for the same
  // prayer across mosques. Always display from the already-parsed
  // minutes-since-midnight value so every mosque renders the same
  // 12h style (no leading zero, no stray 24h times) regardless of
  // how the raw string was written.
  function formatMinutes(mins){
    if (mins == null) return '—';
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + String(m).padStart(2, '0');
  }

  function addDaysIso(iso, days){
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function isFridayIso(iso){
    const d = new Date(iso + 'T12:00:00Z');
    return d.getUTCDay() === 5;
  }

  async function fetchMosques(dateIso){
    const res = await fetch('/api/mosques/list?date=' + dateIso, { headers: deviceHeaders() });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    const data = await res.json();
    return data.mosques || [];
  }

  async function fetchJummah(dateIso){
    const res = await fetch('/api/mosques/jummah?date=' + dateIso, { headers: deviceHeaders() });
    if (!res.ok) throw new Error('Request failed: ' + res.status);
    const data = await res.json();
    return data.locations || [];
  }

  // On Fridays the Dhuhr slot is served by Jummah venues (mosques,
  // community halls, prayer rooms — any of which can run one or more
  // Jummah slots) instead of the daily mosque list.
  async function getDayData(prayer, dateIso){
    if (prayer === 'zuhr' && isFridayIso(dateIso)) {
      const locations = await fetchJummah(dateIso);
      return { items: locations, isJummah: true };
    }
    const mosques = await fetchMosques(dateIso);
    return { items: mosques, isJummah: false };
  }

  function timesFor(prayer, dayResult){
    if (dayResult.isJummah) {
      return dayResult.items.flatMap(l => l.slots.map(s => s.minutes)).filter(t => t !== null);
    }
    return dayResult.items.map(m => parseTimeToMinutes(prayer, m.jamaah[prayer])).filter(t => t !== null);
  }

  // Live/auto mode: finds the earliest prayer whose last mosque + buffer
  // hasn't passed yet, cycling through the day. Loops to tomorrow's Fajr
  // once every prayer today is done.
  async function resolveLive(){
    const { dateIso, minutes: nowMinutes } = londonNow();
    const mosques = await fetchMosques(dateIso);
    const friday = isFridayIso(dateIso);
    const jummahLocations = friday ? await fetchJummah(dateIso) : [];

    for (const prayer of PRAYER_ORDER) {
      if (prayer === 'zuhr' && friday) {
        const times = jummahLocations.flatMap(l => l.slots.map(s => s.minutes)).filter(t => t !== null);
        if (!times.length) continue;
        if (nowMinutes < Math.max(...times) + BUFFER_MIN) {
          return { items: jummahLocations, isJummah: true, prayer, dateIso, isTomorrow: false, referenceItems: null, referenceIsJummah: false };
        }
        continue;
      }
      const times = mosques.map(m => parseTimeToMinutes(prayer, m.jamaah[prayer])).filter(t => t !== null);
      if (!times.length) continue;
      if (nowMinutes < Math.max(...times) + BUFFER_MIN) {
        return { items: mosques, isJummah: false, prayer, dateIso, isTomorrow: false, referenceItems: null, referenceIsJummah: false };
      }
    }

    const tomorrowIso = addDaysIso(dateIso, 1);
    const tomorrowMosques = await fetchMosques(tomorrowIso);
    return { items: tomorrowMosques, isJummah: false, prayer: 'fajr', dateIso: tomorrowIso, isTomorrow: false, referenceItems: null, referenceIsJummah: false };
  }

  // Manual mode: shows whichever prayer the person clicked in the
  // header. If every mosque's time for that prayer + buffer has already
  // passed today, shows tomorrow's time instead (a prayer's time can
  // shift day to day), keeping today's now-passed time as a small
  // reference on each card.
  async function resolveManual(prayer){
    const { dateIso: todayIso, minutes: nowMinutes } = londonNow();
    const today = await getDayData(prayer, todayIso);
    const todayTimes = timesFor(prayer, today);
    const donePastToday = todayTimes.length > 0 && nowMinutes >= Math.max(...todayTimes) + BUFFER_MIN;

    if (!donePastToday) {
      return { ...today, prayer, dateIso: todayIso, isTomorrow: false, referenceItems: null, referenceIsJummah: false };
    }

    const tomorrowIso = addDaysIso(todayIso, 1);
    const tomorrow = await getDayData(prayer, tomorrowIso);
    return { ...tomorrow, prayer, dateIso: tomorrowIso, isTomorrow: true, referenceItems: today.items, referenceIsJummah: today.isJummah };
  }

  function renderHeader(activePrayer, dateIso){
    const header = document.getElementById('mqPrayerHeader');
    if (!header) return;
    const friday = isFridayIso(dateIso);
    header.innerHTML = PRAYER_ORDER.map(p => {
      const label = (p === 'zuhr' && friday) ? 'Jummah' : PRAYER_LABELS[p];
      return `<span data-prayer="${p}"${p === activePrayer ? ' class="is-active"' : ''}>${label}</span>`;
    }).join('');
  }

  function renderCard(r, prayer, isJummah, isTomorrow, tieClass, refBySlug){
    const initial = escapeHtml((r.m.name || '?').trim().charAt(0).toUpperCase());
    const photoHtml = r.m.photoUrl
      ? `<img src="${escapeHtml(r.m.photoUrl)}" alt="">`
      : `<span class="mq-rank-photo-fallback">${initial}</span>`;

    const typeBadge = isJummah
      ? `<span class="mq-type-badge">${escapeHtml(TYPE_LABELS[r.m.type] || 'Mosque')}</span>`
      : '';
    const tomorrowTag = isTomorrow ? `<span class="mq-tomorrow-tag">Tomorrow</span>` : '';
    const refMins = refBySlug.get(r.m.slug);
    const refHtml = (isTomorrow && refMins !== undefined)
      ? `<div class="mq-rank-ref">Today was ${formatMinutes(refMins)}</div>`
      : '';

    const metaHtml = isJummah
      ? `<div class="mq-rank-meta">Jummah${typeBadge}${tomorrowTag}</div>
         <div class="mq-slot-chips">${r.m.slots.map(s =>
           `<span class="mq-slot-chip${s.minutes === r.m.firstMinutes ? ' is-first' : ''}">${formatMinutes(s.minutes)}</span>`
         ).join('')}</div>${refHtml}`
      : `<div class="mq-rank-meta">${PRAYER_LABELS[prayer]}${tomorrowTag}</div>${refHtml}`;

    const isFav = mqFavorites.has(r.m.slug);
    const addressHtml = `<div class="mq-rank-address hidden">${r.m.address ? escapeHtml(r.m.address) : 'Address not added yet.'}</div>`;

    return `
      <div class="mq-rank-card${tieClass}" data-slug="${escapeHtml(r.m.slug)}">
        <div class="mq-rank-left">
          <div class="mq-rank-photo">
            ${photoHtml}
            <button type="button" class="mq-fav-btn${isFav ? ' is-fav' : ''}" data-slug="${escapeHtml(r.m.slug)}" aria-label="Favourite ${escapeHtml(r.m.name)}">♥</button>
            <button type="button" class="mq-photo-add" data-slug="${escapeHtml(r.m.slug)}" data-name="${escapeHtml(r.m.name)}" aria-label="Add a photo of ${escapeHtml(r.m.name)}">+</button>
          </div>
          <div style="min-width:0;flex:1;">
            <div class="mq-rank-name">${escapeHtml(r.m.name)}</div>
            ${metaHtml}
            ${addressHtml}
          </div>
        </div>
        <div class="mq-rank-time">${formatMinutes(r.mins)}</div>
      </div>`;
  }

  const DEFAULT_GROUP_VISIBLE = 3;
  let mqLastRenderArgs = null;

  function renderRankList(items, prayer, isJummah, isTomorrow, referenceItems, referenceIsJummah){
    mqLastRenderArgs = { items, prayer, isJummah, isTomorrow, referenceItems, referenceIsJummah };
    const list = document.getElementById('mqList');
    const status = document.getElementById('mqStatus');
    if (!list || !status) return;

    const label = isJummah ? 'Jummah' : PRAYER_LABELS[prayer];
    const ranked = items
      .map(m => ({ m, mins: isJummah ? m.firstMinutes : parseTimeToMinutes(prayer, m.jamaah[prayer]) }))
      .filter(r => r.mins !== null)
      .sort((a, b) => a.mins - b.mins);

    if (!ranked.length) {
      list.innerHTML = '';
      status.textContent = 'No ' + label + " Jama'ah times available right now.";
      return;
    }
    status.textContent = '';

    const refBySlug = new Map();
    if (isTomorrow && referenceItems) {
      referenceItems.forEach(m => {
        const mins = referenceIsJummah ? m.firstMinutes : parseTimeToMinutes(prayer, m.jamaah[prayer]);
        if (mins !== null) refBySlug.set(m.slug, mins);
      });
    }

    // FLIP: capture current on-screen positions before re-render so the
    // widgets can animate into their new ranked positions.
    const before = new Map();
    list.querySelectorAll('[data-slug]').forEach(el => before.set(el.dataset.slug, el.getBoundingClientRect()));

    // Group ascending times into distinct clusters (earliest group
    // first). Each group gets its own colour wash and, once it has
    // more than a few mosques, only shows the first few by default so
    // the person doesn't have to scroll through everything to see
    // which time is next.
    const groups = [];
    let lastMins = null;
    ranked.forEach(r => {
      if (r.mins !== lastMins) { groups.push({ mins: r.mins, items: [] }); lastMins = r.mins; }
      groups[groups.length - 1].items.push(r);
    });

    list.innerHTML = groups.map((group, groupIdx) => {
      const groupKey = prayer + ':' + group.mins;
      const expanded = mqExpandedGroups.has(groupKey);
      const showCount = (group.items.length <= DEFAULT_GROUP_VISIBLE || expanded) ? group.items.length : DEFAULT_GROUP_VISIBLE;
      const hiddenCount = group.items.length - showCount;
      const tieClass = ` mq-tie-${groupIdx % 6}`;

      const cardsHtml = group.items.slice(0, showCount)
        .map(r => renderCard(r, prayer, isJummah, isTomorrow, tieClass, refBySlug))
        .join('');

      const toggleHtml = group.items.length > DEFAULT_GROUP_VISIBLE
        ? `<button type="button" class="mq-group-toggle" data-group-key="${escapeHtml(groupKey)}">${expanded ? 'Show less' : 'Show ' + hiddenCount + ' more'}</button>`
        : '';

      return `
        <div class="mq-time-group">
          <div class="mq-time-group-header">
            <span class="mq-time-group-time">${formatMinutes(group.mins)}</span>
            <span class="mq-time-group-count">${group.items.length} location${group.items.length > 1 ? 's' : ''}</span>
          </div>
          <div class="mq-time-group-cards">${cardsHtml}</div>
          ${toggleHtml}
        </div>`;
    }).join('');

    list.querySelectorAll('[data-slug]').forEach(el => {
      const prev = before.get(el.dataset.slug);
      if (!prev) return;
      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left, dy = prev.top - now.top;
      if (dx || dy) {
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = '';
          el.style.transform = '';
        });
      }
    });
  }

  function reRenderList(){
    if (!mqLastRenderArgs) return;
    const a = mqLastRenderArgs;
    renderRankList(a.items, a.prayer, a.isJummah, a.isTomorrow, a.referenceItems, a.referenceIsJummah);
  }

  /* ============================================================
     BY AREA VIEW :: groups mosques by region instead of ranking
     by time. Tower Hamlets is pinned first, then every other
     region alphabetically. Each mosque still shows its next
     jamaah time (if any) as a small badge, reusing the same
     favourite/photo interactions as the time-ranked cards.
     ============================================================ */

  function renderAreaCard(m){
    const initial = escapeHtml((m.name || '?').trim().charAt(0).toUpperCase());
    const photoHtml = m.photoUrl
      ? `<img src="${escapeHtml(m.photoUrl)}" alt="">`
      : `<span class="mq-rank-photo-fallback">${initial}</span>`;
    const isFav = mqFavorites.has(m.slug);
    const addressHtml = `<div class="mq-rank-address hidden">${m.address ? escapeHtml(m.address) : 'Address not added yet.'}</div>`;
    const nextHtml = m.next
      ? `<div class="mq-rank-meta">${PRAYER_LABELS[m.next.prayer] || m.next.prayer}: ${escapeHtml(m.next.time || '')}</div>`
      : `<div class="mq-rank-meta">Times not available</div>`;

    return `
      <div class="mq-rank-card" data-slug="${escapeHtml(m.slug)}">
        <div class="mq-rank-left">
          <div class="mq-rank-photo">
            ${photoHtml}
            <button type="button" class="mq-fav-btn${isFav ? ' is-fav' : ''}" data-slug="${escapeHtml(m.slug)}" aria-label="Favourite ${escapeHtml(m.name)}">♥</button>
            <button type="button" class="mq-photo-add" data-slug="${escapeHtml(m.slug)}" data-name="${escapeHtml(m.name)}" aria-label="Add a photo of ${escapeHtml(m.name)}">+</button>
          </div>
          <div style="min-width:0;flex:1;">
            <div class="mq-rank-name">${escapeHtml(m.name)}</div>
            ${nextHtml}
            ${addressHtml}
          </div>
        </div>
      </div>`;
  }

  function sortRegions(regions){
    return regions.sort((a, b) => {
      if (a === PINNED_REGION) return -1;
      if (b === PINNED_REGION) return 1;
      return a.localeCompare(b);
    });
  }

  function renderAreaList(mosques){
    const list = document.getElementById('mqList');
    const status = document.getElementById('mqStatus');
    if (!list || !status) return;

    if (!mosques.length) {
      list.innerHTML = '';
      status.textContent = 'No mosque data available right now.';
      return;
    }
    status.textContent = '';

    const byRegion = new Map();
    mosques.forEach(m => {
      const region = m.region || 'Other';
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push(m);
    });

    const regions = sortRegions(Array.from(byRegion.keys()));

    list.innerHTML = regions.map(region => {
      const items = byRegion.get(region).slice().sort((a, b) => a.name.localeCompare(b.name));
      const cardsHtml = items.map(renderAreaCard).join('');
      return `
        <div class="mq-time-group">
          <div class="mq-time-group-header">
            <span class="mq-time-group-time">${escapeHtml(region)}</span>
            <span class="mq-time-group-count">${items.length} location${items.length > 1 ? 's' : ''}</span>
          </div>
          <div class="mq-time-group-cards">${cardsHtml}</div>
        </div>`;
    }).join('');
  }

  async function loadAreaList(){
    const status = document.getElementById('mqStatus');
    if (status) status.textContent = 'Loading mosques by area…';
    try {
      const { dateIso } = londonNow();
      const mosques = await fetchMosques(dateIso);
      renderAreaList(mosques);
    } catch (e) {
      if (status) status.textContent = "Couldn't load mosques right now — please try again shortly.";
    }
  }

  /* ---- View mode toggle (By Time / By Area) ---- */
  const VIEW_MODE_KEY = 'wwp_mosque_view_mode';
  let mqViewMode = (window.LocalCache && window.LocalCache.get(VIEW_MODE_KEY, 'time')) || 'time';

  function ensureViewToggle(){
    if (document.getElementById('mqViewToggle')) return;
    const header = document.getElementById('mqPrayerHeader');
    if (!header || !header.parentNode) return;

    const wrap = document.createElement('div');
    wrap.id = 'mqViewToggle';
    wrap.setAttribute('role', 'tablist');
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.margin = '0 0 12px';

    const makeBtn = (mode, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.viewMode = mode;
      btn.style.flex = '1';
      btn.style.padding = '8px 12px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid rgba(255,255,255,0.15)';
      btn.style.background = mode === mqViewMode ? 'rgba(255,255,255,0.15)' : 'transparent';
      btn.style.color = 'inherit';
      btn.style.cursor = 'pointer';
      btn.style.fontWeight = mode === mqViewMode ? '600' : '400';
      return btn;
    };

    wrap.appendChild(makeBtn('time', 'By Time'));
    wrap.appendChild(makeBtn('area', 'By Area'));

    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view-mode]');
      if (!btn) return;
      setViewMode(btn.dataset.viewMode);
    });

    header.parentNode.insertBefore(wrap, header);
  }

  function updateViewToggleUI(){
    const wrap = document.getElementById('mqViewToggle');
    if (!wrap) return;
    wrap.querySelectorAll('[data-view-mode]').forEach(btn => {
      const active = btn.dataset.viewMode === mqViewMode;
      btn.style.background = active ? 'rgba(255,255,255,0.15)' : 'transparent';
      btn.style.fontWeight = active ? '600' : '400';
    });
  }

  function setViewMode(mode){
    if (mode === mqViewMode) return;
    mqViewMode = mode;
    if (window.LocalCache) window.LocalCache.set(VIEW_MODE_KEY, mode);
    updateViewToggleUI();

    const header = document.getElementById('mqPrayerHeader');
    const liveToggle = document.getElementById('mqLiveToggle');
    if (header) header.classList.toggle('hidden', mode === 'area');
    if (liveToggle) liveToggle.classList.toggle('hidden', mode === 'area' || !mqSelectedPrayer);

    loadMosqueList();
  }

  // ---- Add a photo (signed-in users submit for review; admin flow
  // lives separately in admin/broadcast.html) ----
  function uploadMosquePhoto(slug, mosqueName, file){
    const status = document.getElementById('mqStatus');
    const fd = new FormData();
    fd.append('photo', file);
    fd.append('mosque', slug);
    if (status) status.textContent = `Uploading photo for ${mosqueName}…`;
    return fetch('/api/mosques/photos', { method: 'POST', body: fd })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Upload failed.');
        if (status) status.textContent = "Thanks! Your photo is pending admin review.";
      })
      .catch(e => {
        if (status) status.textContent = e.message || "Couldn't upload that photo — please try again.";
      });
  }

  // ---- Favourites (signed-in only) ----
  let mqFavorites = new Set();
  let mqExpandedGroups = new Set();

  async function fetchFavorites(){
    const authState = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
    if (!authState || !authState.authenticated) { mqFavorites = new Set(); return; }
    try {
      const res = await fetch('/api/mosques/favorites', { headers: deviceHeaders() });
      if (!res.ok) { mqFavorites = new Set(); return; }
      const data = await res.json();
      mqFavorites = new Set(data.slugs || []);
    } catch (e) {
      mqFavorites = new Set();
    }
  }

  async function toggleFavorite(slug, btn){
    btn.disabled = true;
    try {
      const res = await fetch('/api/mosques/favorites', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, deviceHeaders()),
        body: JSON.stringify({ mosque: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.favorited) mqFavorites.add(slug); else mqFavorites.delete(slug);
        btn.classList.toggle('is-fav', !!data.favorited);
      }
    } catch (e) {
      // leave state as-is; next refresh will resync
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById('mqList')?.addEventListener('click', (e) => {
    const photoBtn = e.target.closest('.mq-photo-add');
    if (photoBtn) {
      const authState = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
      if (!authState || !authState.authenticated) {
        window.WWP_promptSignIn && window.WWP_promptSignIn();
        return;
      }
      const slug = photoBtn.dataset.slug;
      const name = photoBtn.dataset.name || 'this mosque';
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) uploadMosquePhoto(slug, name, file);
      });
      input.click();
      return;
    }

    const favBtn = e.target.closest('.mq-fav-btn');
    if (favBtn) {
      const authState = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
      if (!authState || !authState.authenticated) {
        window.WWP_promptSignIn && window.WWP_promptSignIn();
        return;
      }
      toggleFavorite(favBtn.dataset.slug, favBtn);
      return;
    }

    const toggleBtn = e.target.closest('.mq-group-toggle');
    if (toggleBtn) {
      const key = toggleBtn.dataset.groupKey;
      if (mqExpandedGroups.has(key)) mqExpandedGroups.delete(key);
      else mqExpandedGroups.add(key);
      reRenderList();
      return;
    }

    // Tapping the card itself (not a button on it) reveals the address.
    const card = e.target.closest('.mq-rank-card');
    if (card) {
      const addr = card.querySelector('.mq-rank-address');
      if (addr) addr.classList.toggle('hidden');
    }
  });

  let mqInitialized = false;
  let mqTimer = null;
  let mqSelectedPrayer = null; // null = live/auto mode; else pinned to one prayer

  async function loadMosqueList(){
    ensureViewToggle();

    if (mqViewMode === 'area') {
      const header = document.getElementById('mqPrayerHeader');
      const liveToggle = document.getElementById('mqLiveToggle');
      if (header) header.classList.add('hidden');
      if (liveToggle) liveToggle.classList.add('hidden');
      await loadAreaList();
      return;
    }

    const status = document.getElementById('mqStatus');
    if (!status) return;
    if (!mqInitialized) status.textContent = "Loading Jama'ah times…";

    try {
      const result = mqSelectedPrayer ? await resolveManual(mqSelectedPrayer) : await resolveLive();
      renderHeader(result.prayer, result.dateIso);
      const header = document.getElementById('mqPrayerHeader');
      if (header) header.classList.remove('hidden');
      const liveToggle = document.getElementById('mqLiveToggle');
      if (liveToggle) liveToggle.classList.toggle('hidden', !mqSelectedPrayer);
      if (!result.items.length) {
        status.textContent = 'No mosque data available right now.';
        document.getElementById('mqList').innerHTML = '';
        return;
      }
      renderRankList(result.items, result.prayer, result.isJummah, result.isTomorrow, result.referenceItems, result.referenceIsJummah);
    } catch (e) {
      status.textContent = "Couldn't load mosque times right now — please try again shortly.";
    }
  }

  document.getElementById('mqPrayerHeader')?.addEventListener('click', (e) => {
    const span = e.target.closest('[data-prayer]');
    if (!span) return;
    mqSelectedPrayer = span.dataset.prayer;
    loadMosqueList();
  });

  document.getElementById('mqLiveToggle')?.addEventListener('click', () => {
    mqSelectedPrayer = null;
    loadMosqueList();
  });

  function onMosqueShown(){
    mqInitialized = true;
    ensureViewToggle();
    fetchFavorites().then(loadMosqueList);
    clearInterval(mqTimer);
    mqTimer = setInterval(loadMosqueList, 30000);
  }

  window.addEventListener('wwp-page-shown', (e)=>{
    if(e.detail && e.detail.id === 'mosque') onMosqueShown();
  });
  document.querySelectorAll('a[data-page="mosque"]').forEach(a=>{
    a.addEventListener('click', onMosqueShown);
  });
  // Covers a direct load/refresh landing on /find-a-mosque, same pattern
  // as Community Ideas above.
  if(!document.getElementById('page-mosque')?.classList.contains('hidden')){
    onMosqueShown();
  }

  // ---- "Screen protector" sneak-peek overlay ----
  // The real list loads in the background regardless (see above), so
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

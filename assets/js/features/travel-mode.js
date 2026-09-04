/* ===== deferred feature script 19 ===== */
(function(){
/* ============================================================
   TRAVEL MODE :: home-location tracking + travel detection
   Step 1: silently capture the user's first-ever Prayer Times
   location as "home" (no extra onboarding step).
   Step 2: exposed via Settings so the user can correct it.
   Step 3: on every subsequent location change, compare distance
   from home — if far enough, offer (never force) Travel Mode.
   Step 4: a "always open Travel Mode" override skips all of this.
   ============================================================ */
window.WWP_TravelHome = (function(){
  const HOME_KEY = 'wwp:travel:home';
  const DEFAULT_HOME_KEY = 'wwp:travel:openByDefault';
  const DISMISS_KEY = 'wwp:travel:bannerDismissedFor';
  const TRAVEL_THRESHOLD_KM = 80; // roughly "left your city"

  function getHome(){
    return window.LocalCache ? window.LocalCache.get(HOME_KEY, null) : null;
  }
  function setHome(loc){
    if(window.LocalCache) window.LocalCache.set(HOME_KEY, {lat:loc.lat, lon:loc.lon, label:loc.label});
  }
  function getOpenByDefault(){
    return window.LocalCache ? !!window.LocalCache.get(DEFAULT_HOME_KEY, false) : false;
  }
  function setOpenByDefault(v){
    if(window.LocalCache) window.LocalCache.set(DEFAULT_HOME_KEY, !!v);
  }
  function haversineKm(lat1,lon1,lat2,lon2){
    const R=6371, toRad=Math.PI/180;
    const dLat=(lat2-lat1)*toRad, dLon=(lon2-lon1)*toRad;
    const a=Math.sin(dLat/2)**2 + Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function showTravelBanner(distanceKm, label){
    if(document.getElementById('travelSuggestBanner')) return;
    const dismissedFor = window.LocalCache ? window.LocalCache.get(DISMISS_KEY, null) : null;
    if(dismissedFor === label) return;

    const bar = document.createElement('div');
    bar.id = 'travelSuggestBanner';
    bar.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2000;background:var(--surface,#fff);border:1px solid var(--border,#e2ddd3);border-radius:14px;box-shadow:0 12px 34px rgba(0,0,0,.16);padding:12px 14px;display:flex;align-items:center;gap:12px;max-width:calc(100% - 24px);font-family:Manrope,sans-serif;';
    bar.innerHTML =
      '<span style="font-size:20px;line-height:1;">✈</span>'+
      '<span style="font-size:13px;color:var(--text,#2a2620);max-width:260px;">Looks like you\u2019re travelling \u2014 switch to Travel Mode?</span>'+
      '<button type="button" id="travelSuggestGo" style="background:#F4714E;color:#fff;border:0;border-radius:9px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;">Switch</button>'+
      '<button type="button" id="travelSuggestDismiss" style="background:none;border:0;color:var(--text-muted,#96907f);font-size:18px;line-height:1;cursor:pointer;padding:0 2px;">×</button>';
    document.body.appendChild(bar);

    document.getElementById('travelSuggestGo').addEventListener('click', ()=>{
      bar.remove();
      if(window.switchPage) window.switchPage('travel');
    });
    document.getElementById('travelSuggestDismiss').addEventListener('click', ()=>{
      bar.remove();
      if(window.LocalCache) window.LocalCache.set(DISMISS_KEY, label);
    });
  }

  function onLocationChange(loc){
    if(!loc || loc.lat == null || loc.lon == null) return;
    let home = getHome();
    if(!home){
      // First-ever location becomes home automatically — no prompt.
      setHome(loc);
      return;
    }
    const dist = haversineKm(home.lat, home.lon, loc.lat, loc.lon);
    if(dist >= TRAVEL_THRESHOLD_KM){
      const onTravelPage = document.getElementById('page-travel') && !document.getElementById('page-travel').classList.contains('hidden');
      if(!onTravelPage) showTravelBanner(dist, loc.label||'');
    }
  }

  return { getHome, setHome, getOpenByDefault, setOpenByDefault, onLocationChange, haversineKm };
})();

// Hook into every PrayerTimes location save without touching that
// module directly — subscribe fires on every state change including
// location updates, so we just watch for a changed lat/lon.
(function(){
  if(!window.PrayerTimes || !window.PrayerTimes.subscribe) return;
  let lastKey = null;
  PrayerTimes.subscribe(function(state){
    const loc = state && state.location;
    if(!loc || loc.lat == null) return;
    const key = loc.lat.toFixed(3)+','+loc.lon.toFixed(3);
    if(key === lastKey) return;
    lastKey = key;
    window.WWP_TravelHome.onLocationChange(loc);
  });
})();

// Step 3 (continued): if the user has chosen "open Travel Mode by
// default", land there instead of the home page on a fresh visit to "/".
(function(){
  if(location.pathname !== '/') return;
  if(!window.WWP_TravelHome || !window.WWP_TravelHome.getOpenByDefault()) return;
  if(window.switchPage) window.switchPage('travel', {skipHistory:true});
})();

})();

/* ===== deferred feature script 20 ===== */
(function(){
/* ============================================================
   TRAVEL MODE :: live dashboard bindings
   Uses the existing PrayerTimes store for location, prayer times,
   calculation method and cached/offline data. Qiblah is calculated
   locally from the Kaaba coordinates, so no extra API is required.
   ============================================================ */
(function(){
  const page=document.getElementById('page-travel');
  if(!page) return;
  const $=s=>page.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const KAABA={lat:21.4225,lon:39.8262};
  const PRAYERS=['Fajr','Dhuhr','Asr','Maghrib','Isha'];
  const BACKGROUNDS=['ocean','sunset','night'];
  let checklistKey='wwp:travel:checklist';

  function applyBackground(){
    const hero=document.getElementById('tmHero');
    if(!hero) return;
    const theme=document.body.getAttribute('data-theme')||'light';
    if(theme==='dark'){
      hero.setAttribute('data-bg','dark-scene');
    }else if(theme==='amoled'){
      hero.setAttribute('data-bg','amoled-scene');
    }else if(theme==='sepia'){
      hero.setAttribute('data-bg','sepia-scene');
    }else{
      hero.setAttribute('data-bg','light-scene');
    }
  }
  window.__WWP_applyTravelBackground = applyBackground;
  applyBackground();

  // Re-apply whenever the site theme toggle changes while Travel Mode
  // is open, so switching Light/Sepia/Dark/AMOLED updates the hero
  // immediately rather than needing a page reload.
  const tmThemeObserver=new MutationObserver(()=>applyBackground());
  tmThemeObserver.observe(document.body, {attributes:true, attributeFilter:['data-theme']});

  function qiblaBearing(lat,lon){
    const toRad=Math.PI/180,toDeg=180/Math.PI;
    const φ1=lat*toRad,φ2=KAABA.lat*toRad,dLon=(KAABA.lon-lon)*toRad;
    const y=Math.sin(dLon),x=Math.cos(φ1)*Math.tan(φ2)-Math.sin(φ1)*Math.cos(dLon);
    return (Math.atan2(y,x)*toDeg+360)%360;
  }
  function bearingDir(d){
    const dirs=['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(d/45)%8];
  }
  function localTime(tz){
    try{return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz||undefined}).format(new Date());}catch(e){return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
  }
  function dateLabel(hijri){
    const d=new Date();
    const greg=d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    return (hijri ? hijri.replace(/ AH$/,'') : '')+(hijri?'  |  ':'')+greg;
  }
  function parseLocal(hhmm){
    if(!hhmm) return null;
    const [h,m]=hhmm.split(':').map(Number); const d=new Date(); d.setHours(h,m,0,0); return d;
  }
  function progressToNext(state,next){
    if(!state.timings||!next) return 0;
    const now=new Date(), end=next.date;
    const idx=PRAYERS.indexOf(next.name);
    let prevName=idx>0?PRAYERS[idx-1]:null;
    let prev=prevName?parseLocal(state.timings[prevName]):null;
    if(!prev){prev=parseLocal(state.timings.Isha); if(prev) prev.setDate(prev.getDate()-1);}
    const span=Math.max(1,end.getTime()-prev.getTime());
    return Math.max(0,Math.min(100,((now.getTime()-prev.getTime())/span)*100));
  }
  function saveChecklist(){
    const vals=[...page.querySelectorAll('.tm-check-card input')].map(x=>x.checked);if(window.LocalCache) window.LocalCache.set(checklistKey,vals);
  }
  function loadChecklist(){const v=window.LocalCache?window.LocalCache.get(checklistKey,null):null;if(Array.isArray(v)) page.querySelectorAll('.tm-check-card input').forEach((x,i)=>x.checked=!!v[i]);}

  function render(){
    if(!window.PrayerTimes) return;
    const st=PrayerTimes.getState();
    const loc=st.location||{};
    const tz=loc.tz||Intl.DateTimeFormat().resolvedOptions().timeZone;
    $('#tmLocationName').textContent=loc.label||'—';
    $('#tmLocalTime').textContent=localTime(tz);
    $('#tmDateLabel').textContent=dateLabel(st.hijri);
    $('#tmMethodValue').textContent=PrayerTimes.methodName(st.method);
    $('#tmTimezoneValue').textContent=tz||'Local time';

    const q=qiblaBearing(Number(loc.lat||51.5074),Number(loc.lon||-0.1278));
    $('#tmQiblaDeg').textContent=Math.round(q)+'°';
    $('#tmQiblaDir').textContent=bearingDir(q);
    qcCurrentQibla=q;

    const next=PrayerTimes.getNextPrayer();
    if(next){
      $('#tmNextName').textContent=next.name;
      $('#tmNextCountdown').textContent=PrayerTimes.formatRemaining(next.remainingMs).replace(' remaining','');
      $('#tmNextTime').textContent=PrayerTimes.to12h(next.time);
      $('#tmPrayerProgress').style.width=progressToNext(st,next)+'%';
    }

    const rows=$('#tmPrayerRows');
    if(!st.timings){rows.innerHTML='<div class="tm-time-row"><span>Loading prayer times…</span><span></span><span></span></div>';return;}
    const now=new Date();
    rows.innerHTML=PRAYERS.map(name=>{
      const d=parseLocal(st.timings[name]); const passed=d?d<=now:false; const isNext=next&&next.name===name;
      return '<div class="tm-time-row"><span>'+esc(name)+'</span><span class="tm-time">'+esc(PrayerTimes.to12h(st.timings[name]))+'</span><span class="tm-status">'+(isNext?'◷':(passed?'✓':'○'))+'</span></div>';
    }).join('');
  }

  page.querySelectorAll('.tm-check-card input').forEach(x=>x.addEventListener('change',saveChecklist));

  // ---- Travel Mode's own location modal (glass style) ----
  const tmModalBackdrop=$('#tmLocationModalBackdrop');
  const tmCityList=$('#tmModalCityList');
  const tmCitySearch=$('#tmModalCitySearch');

  function tmRenderCityList(filter){
    if(!tmCityList) return;
    const cities = window.PT_CITY_LIST || [];
    const q=(filter||'').trim().toLowerCase();
    const matches = cities.filter(c=>!q || (c.label+' '+c.country).toLowerCase().includes(q)).slice(0,40);
    if(!matches.length){
      tmCityList.innerHTML='<div class="tm-modal-empty">No cities match “'+esc(filter)+'”.</div>';
      return;
    }
    tmCityList.innerHTML=matches.map(c=>
      '<button type="button" class="tm-modal-city-item" data-label="'+esc(c.label)+'">'+esc(c.label)+'<span class="tm-mci-country">, '+esc(c.country)+'</span></button>'
    ).join('');
  }
  function tmOpenModal(){
    if(!tmModalBackdrop) return;
    if(tmCitySearch) tmCitySearch.value='';
    tmRenderCityList('');
    tmModalBackdrop.style.display='flex';
  }
  function tmCloseModal(){ if(tmModalBackdrop) tmModalBackdrop.style.display='none'; }

  $('#tmLocationBtn')?.addEventListener('click',tmOpenModal);
  $('#tmModalClose')?.addEventListener('click',tmCloseModal);
  tmModalBackdrop?.addEventListener('click',(e)=>{ if(e.target===tmModalBackdrop) tmCloseModal(); });
  tmCitySearch?.addEventListener('input',function(){ tmRenderCityList(this.value); });

  tmCityList?.addEventListener('click', async (e)=>{
    const item=e.target.closest('.tm-modal-city-item[data-label]');
    if(!item) return;
    const cities=window.PT_CITY_LIST||[];
    const city=cities.find(c=>c.label===item.dataset.label);
    if(!city) return;
    item.disabled=true;
    try{
      await PrayerTimes.usePresetCity(city);
      render();
      showToast('Showing prayer times for '+city.label+'.');
      tmCloseModal();
    }catch(err){
      showToast('Could not load that city — try again.');
    }finally{
      item.disabled=false;
    }
  });

  $('#tmModalGeoBtn')?.addEventListener('click', async function(){
    const btn=this; const original=btn.innerHTML;
    btn.disabled=true; btn.textContent='Detecting…';
    try{
      await PrayerTimes.useGeolocation();
      render();
      tmCloseModal();
    }catch(err){
      showToast('Could not detect your location — try picking a city instead.');
    }finally{
      btn.disabled=false; btn.innerHTML=original;
    }
  });

  // First-ever visit to Travel Mode with no location set yet: prompt once.
  if(window.PrayerTimes){
    const st0=PrayerTimes.getState();
    if(!st0.location || st0.location.source==='default'){
      setTimeout(tmOpenModal, 400);
    }
  }
  $('#tmTimetableBtn')?.addEventListener('click',()=>window.switchPage('prayertimes'));
  $('#tmFullTimesBtn')?.addEventListener('click',()=>window.switchPage('prayertimes'));
  $('#tmFindSpaces')?.addEventListener('click',()=>window.switchPage('mosque'));
  // ---- Qiblah compass: real device orientation, live and popup-free ----
  // Matches the Pillars-app UX: tap Qiblah, it just works. The one thing
  // no web or native app can skip is iOS's own one-time system permission
  // dialog for motion sensors — that's Apple's OS prompt, not ours, and
  // it only ever appears once per browser. We trigger it directly from
  // the tap itself so there's no extra step, modal, or toast in between.
  let qcWatching=false, qcHeadingHandler=null, qcCurrentQibla=0, qcGotReading=false, qcWatchdog=null, qcSmoothedHeading=null;

  function qcApplyHeading(heading){
    const rel=((qcCurrentQibla-heading)%360+360)%360;
    // Signed offset in (-180, 180]: positive = Qiblah is to the
    // right of where the phone's currently facing, negative = left.
    const diff = rel > 180 ? rel - 360 : rel;
    const aligned=Math.abs(diff)<5;
    document.querySelectorAll('.wwp-qc-needle').forEach(n=>{ n.style.transform='rotate('+rel+'deg)'; });
    const statusHtml = aligned
      ? 'Aligned — facing the Qiblah'
      : 'Turn to your <b>'+(diff>0?'right':'left')+'</b>';
    document.querySelectorAll('.wwp-qibla-status').forEach(l=>{ l.innerHTML = statusHtml; });
    document.querySelectorAll('.wwp-qibla-card').forEach(c=>{ c.classList.toggle('tm-qc-aligned',aligned); });
  }

  function qcOnOrientation(e){
    let heading=null;
    if(typeof e.webkitCompassHeading==='number'){
      heading=e.webkitCompassHeading; // iOS: already a true, north-referenced compass heading
    }else if(typeof e.alpha==='number' && e.absolute===true){
      // Only trust alpha as a true heading when the browser confirms the
      // reading is absolute (north-referenced). Plain `deviceorientation`
      // on many Android browsers fires with absolute:false — alpha there
      // is relative to an arbitrary starting angle, not north, so using
      // it unconditionally silently points somewhere confidently wrong
      // rather than just being unavailable.
      heading=(360-e.alpha)%360;
    }
    if(heading===null||isNaN(heading)){
      if(!qcGotReading){
        document.querySelectorAll('.wwp-qibla-status').forEach(l=>{ l.textContent='This device can\'t give a true compass heading — try a dedicated compass app.'; });
      }
      return;
    }
    qcGotReading=true;
    if(qcWatchdog){clearTimeout(qcWatchdog);qcWatchdog=null;}

    // Smooth noisy raw sensor readings with a circular exponential moving
    // average — naive numeric averaging breaks at the 0°/360° wrap (e.g.
    // 350° and 10° would naively average to 180°, the opposite direction).
    if(qcSmoothedHeading===null){
      qcSmoothedHeading=heading;
    }else{
      const rad=Math.PI/180;
      const sx=Math.sin(qcSmoothedHeading*rad)*0.8 + Math.sin(heading*rad)*0.2;
      const cx=Math.cos(qcSmoothedHeading*rad)*0.8 + Math.cos(heading*rad)*0.2;
      qcSmoothedHeading=(Math.atan2(sx,cx)*180/Math.PI+360)%360;
    }
    qcApplyHeading(qcSmoothedHeading);
  }

  function qcBeginListening(){
    if(qcWatching) return;
    qcGotReading=false;
    qcSmoothedHeading=null;
    qcHeadingHandler=qcOnOrientation;
    const evt=('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evt,qcHeadingHandler,true);
    qcWatching=true;
    if(qcWatchdog) clearTimeout(qcWatchdog);
    qcWatchdog=setTimeout(()=>{
      if(!qcGotReading){
        const msg = location.protocol!=='https:'
          ? 'Compass needs https to work.'
          : 'No compass sensor found on this device.';
        document.querySelectorAll('.wwp-qibla-status').forEach(l=>{ l.textContent=msg; });
      }
    },2500);
  }

  function qcRefreshBearing(){
    const st=window.PrayerTimes?.getState?.()||{};
    const loc=st.location||{};
    qcCurrentQibla=qiblaBearing(Number(loc.lat||51.5074),Number(loc.lon||-0.1278));
  }

  // Runs once, automatically, no tap required — works immediately on
  // Android/desktop browsers that don't gate the sensor behind permission.
  function qcAutoStart(){
    qcRefreshBearing();
    if(typeof window.DeviceOrientationEvent==='undefined') return;
    if(typeof DeviceOrientationEvent.requestPermission==='function') return; // iOS: wait for the tap
    qcBeginListening();
  }

  // iOS Safari only: the tap on the card itself doubles as the required
  // user gesture, so the browser's one-time system prompt fires right
  // here — no separate "Enable" step, no in-app modal.
  async function qcHandleTap(){
    if(typeof window.DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function' && !qcWatching){
      try{
        qcRefreshBearing();
        const res=await DeviceOrientationEvent.requestPermission();
        if(res==='granted') qcBeginListening();
      }catch(err){/* ignore — user can tap again */}
    }
  }
  document.querySelectorAll('.wwp-qibla-trigger').forEach(btn=>btn.addEventListener('click', qcHandleTap));

  qcAutoStart();
  $('#tmOfflineTimes')?.addEventListener('click',()=>{const ok=window.LocalCache&&window.LocalCache.set('wwp:travel:offline-times',PrayerTimes.getState().timings||{});if(ok){showToast('Today’s prayer times saved for offline use.');}else{showToast('Offline saving is unavailable on this device.');}});
  $('#tmShareLocation')?.addEventListener('click',()=>{
    const text='I’m travelling in '+(PrayerTimes.getState().location?.label||'my current location')+'.';
    Platform.share({title:'WhereWePraying? Travel Mode',text}, ()=>{
      Platform.copyToClipboard(text, {onSuccess:()=>showToast('Location note copied.'), onFail:()=>showToast('Sharing is unavailable.')});
    });
  });
  $('#tmGuideBtn')?.addEventListener('click',()=>window.switchPage('guides'));
  page.querySelectorAll('.tm-guide-row').forEach(btn=>btn.addEventListener('click',(e)=>{
    const slug=btn.dataset.guide;
    if(slug && window.WWP_openGuide) window.WWP_openGuide(slug);
    else window.switchPage('guides');
  }));
  $('#tmMethodBtn')?.addEventListener('click',()=>document.getElementById('ptChangeMethodBtn')?.click());
  $('#tmManageSettingsBtn')?.addEventListener('click',()=>document.getElementById('ptChangeMethodBtn')?.click());
  $('#tmJuristicBtn')?.addEventListener('click',()=>showToast('Juristic preference controls will be available in Travel Settings.'));
  $('#tmChecklistBtn')?.addEventListener('click',()=>showToast('Checklist items are editable directly.'));

  const defaultToggle=$('#tmDefaultHomeToggle');
  if(defaultToggle && window.WWP_TravelHome){
    defaultToggle.checked = window.WWP_TravelHome.getOpenByDefault();
    defaultToggle.addEventListener('change', ()=>{
      window.WWP_TravelHome.setOpenByDefault(defaultToggle.checked);
      showToast(defaultToggle.checked ? 'Travel Mode will open by default.' : 'Homepage restored to default.');
    });
  }

  if(window.PrayerTimes){
    const sub=PrayerTimes.subscribe(render);
    window.addEventListener('beforeunload',sub);
  }
  loadChecklist(); render();
  setInterval(()=>{if(!page.classList.contains('hidden'))render();},1000);

  // ---- Flight Tracker ----
  // Stores tracked flights locally (device-only, no account needed).
  // Live status comes from /api/flight-status, a Cloudflare Pages
  // Function that holds the AeroDataBox key server-side — the key can
  // never live in this static HTML file, so lookups fail gracefully
  // with a clear message until that endpoint is deployed.
  const FLIGHTS_KEY='wwp:travel:flights';
  const flightList=$('#tmFlightList');
  const flightEmpty=$('#tmFlightEmpty');
  const flightAddBtn=$('#tmFlightAddBtn');
  const flightFormBackdrop=$('#tmFlightFormBackdrop');
  const flightNumberInput=$('#tmFlightNumberInput');
  const flightDateInput=$('#tmFlightDateInput');
  const flightDirectionSelect=$('#tmFlightDirectionSelect');
  const flightFormError=$('#tmFlightFormError');
  const flightSaveBtn=$('#tmFlightSaveBtn');

  function loadFlights(){
    const v=window.LocalCache?window.LocalCache.get(FLIGHTS_KEY,[]):[]; return Array.isArray(v)?v:[];
  }
  function saveFlights(list){
    if(window.LocalCache) window.LocalCache.set(FLIGHTS_KEY, list);
  }
  function flightStatusLabel(status){
    const map={scheduled:'Scheduled',active:'In the air',landed:'Landed',delayed:'Delayed',cancelled:'Cancelled',unknown:'Saved'};
    return map[status]||'Saved';
  }
  function fmtFlightTime(iso){
    if(!iso) return '—';
    try{
      const d=new Date(iso);
      return d.toLocaleString([], {weekday:'short', hour:'2-digit', minute:'2-digit'});
    }catch(e){ return iso; }
  }

  async function fetchFlightStatus(flightNumber, date){
    const url='/api/flight-status?number='+encodeURIComponent(flightNumber)+'&date='+encodeURIComponent(date);
    let res;
    try{
      res = await fetch(url);
    }catch(networkErr){
      throw new Error('Live tracking isn\u2019t connected yet \u2014 your flight is saved and will update once it is.');
    }
    if(res.status===404 || res.status===501){
      throw new Error('Live tracking isn\u2019t connected yet \u2014 your flight is saved and will update once it is.');
    }
    if(!res.ok){
      const body=await res.json().catch(()=>({}));
      throw new Error(body.error || 'Couldn\u2019t reach live flight data right now.');
    }
    return res.json();
  }

  function renderFlights(){
    if(!flightEmpty || !flightList) return; // Flight Tracker UI is hidden behind the teaser card for now.
    const flights=loadFlights();
    if(!flights.length){
      flightEmpty.style.display='block';
      flightList.innerHTML='';
      return;
    }
    flightEmpty.style.display='none';
    flightList.innerHTML=flights.map(f=>{
      const status=(f.data && f.data.status) || (f.error ? 'unknown' : 'scheduled');
      const badgeClass='status-'+status;
      const dep=f.data ? f.data.departure : null;
      const arr=f.data ? f.data.arrival : null;
      return '<div class="tm-flight-item" data-id="'+f.id+'">'
        + '<div class="tm-flight-item-top">'
          + '<span class="tm-flight-number">'+esc(f.number)+'</span>'
          + '<span class="tm-flight-badge '+badgeClass+'">'+esc(flightStatusLabel(status))+'</span>'
        + '</div>'
        + (f.loading ? '<div class="tm-flight-loading">Looking up flight…</div>' : '')
        + (f.error ? '<div class="tm-flight-loading">'+esc(f.error)+'</div>' : '')
        + (dep || arr ?
          '<div class="tm-flight-route">'
            + '<div class="tm-flight-endpoint"><span class="code">'+esc(dep && dep.airportCode || '—')+'</span><span class="time">'+fmtFlightTime(dep && dep.time)+'</span></div>'
            + '<span class="tm-flight-arrow">✈</span>'
            + '<div class="tm-flight-endpoint right"><span class="code">'+esc(arr && arr.airportCode || '—')+'</span><span class="time">'+fmtFlightTime(arr && arr.time)+'</span></div>'
          + '</div>'
          + '<div class="tm-flight-meta">'
            + (dep && dep.terminal ? '<span>Terminal '+esc(dep.terminal)+'</span>' : '')
            + (dep && dep.gate ? '<span>Gate '+esc(dep.gate)+'</span>' : '')
            + (f.direction ? '<span>'+(f.direction==='outbound'?'Outbound':'Return')+'</span>' : '')
          + '</div>'
          : '<div class="tm-flight-meta"><span>'+esc(f.date)+' · '+(f.direction==='outbound'?'Outbound':'Return')+'</span></div>')
        + '<div class="tm-flight-actions">'
          + '<button class="tm-flight-refresh-btn" data-action="refresh" data-id="'+f.id+'" type="button">Refresh</button>'
          + '<button class="tm-flight-remove-btn" data-action="remove" data-id="'+f.id+'" type="button">Remove</button>'
        + '</div>'
      + '</div>';
    }).join('');
  }

  async function refreshFlight(id){
    const flights=loadFlights();
    const idx=flights.findIndex(f=>f.id===id);
    if(idx===-1) return;
    flights[idx].loading=true; flights[idx].error=null;
    saveFlights(flights); renderFlights();
    try{
      const data=await fetchFlightStatus(flights[idx].number, flights[idx].date);
      const latest=loadFlights();
      const i2=latest.findIndex(f=>f.id===id);
      if(i2>-1){ latest[i2].data=data; latest[i2].loading=false; latest[i2].error=null; saveFlights(latest); }
    }catch(err){
      const latest=loadFlights();
      const i2=latest.findIndex(f=>f.id===id);
      if(i2>-1){ latest[i2].loading=false; latest[i2].error=err.message||'Could not fetch flight status.'; saveFlights(latest); }
    }
    renderFlights();
  }

  function openFlightForm(){
    flightNumberInput.value='';
    flightDateInput.value='';
    flightDirectionSelect.value='outbound';
    flightFormError.style.display='none';
    flightFormBackdrop.style.display='flex';
    setTimeout(()=>flightNumberInput.focus(), 50);
  }
  function closeFlightForm(){ flightFormBackdrop.style.display='none'; }

  flightAddBtn?.addEventListener('click', openFlightForm);
  $('#tmFlightModalClose')?.addEventListener('click', closeFlightForm);
  flightFormBackdrop?.addEventListener('click',(e)=>{ if(e.target===flightFormBackdrop) closeFlightForm(); });

  flightSaveBtn?.addEventListener('click', async ()=>{
    const number=(flightNumberInput.value||'').trim().toUpperCase().replace(/\s+/g,'');
    const date=flightDateInput.value;
    const direction=flightDirectionSelect.value;
    if(!/^[A-Z0-9]{3,8}$/.test(number)){
      flightFormError.textContent='Enter a valid flight number, e.g. BA106.';
      flightFormError.style.display='block';
      return;
    }
    if(!date){
      flightFormError.textContent='Choose a departure date.';
      flightFormError.style.display='block';
      return;
    }
    flightFormError.style.display='none';
    const id='flt_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
    const flights=loadFlights();
    flights.push({id, number, date, direction, data:null, loading:true, error:null});
    saveFlights(flights);
    closeFlightForm();
    renderFlights();
    await refreshFlight(id);
  });

  flightList?.addEventListener('click',(e)=>{
    const btn=e.target.closest('button[data-action]');
    if(!btn) return;
    const id=btn.dataset.id;
    if(btn.dataset.action==='remove'){
      const flights=loadFlights().filter(f=>f.id!==id);
      saveFlights(flights);
      renderFlights();
    }else if(btn.dataset.action==='refresh'){
      refreshFlight(id);
    }
  });

  renderFlights();
})();

})();

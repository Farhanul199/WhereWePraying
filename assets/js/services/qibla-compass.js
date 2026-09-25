/* ============================================================
   QIBLA COMPASS :: shared Kaaba bearing calc + live device-
   orientation compass. Loaded as a CORE asset (see index.html /
   sw.js) — NOT a lazy feature bundle — so both the Prayer Times
   page and Travel Mode get a live compass independently of each
   other and of which page (if any) the person has opened.

   Drives every element carrying these shared classes, on
   whichever page(s) they currently exist in the DOM:
     .wwp-qibla-card     the tappable card/button
     .wwp-qc-needle       the rotating needle
     .wwp-qibla-status    the status/instruction line
     .wwp-qibla-trigger   anything that should also request iOS
                          motion permission on tap
   Both the Prayer Times card (#ptQiblaCard) and the Travel Mode
   card (#tmQiblaBtn) already carry these classes, so one listener
   updates both at once — no per-page wiring needed, and neither
   page has to load the other's module to get a live needle.
   ============================================================ */
window.WWP_QiblaCompass = (function(){
  const KAABA_LAT = 21.4225, KAABA_LON = 39.8262;

  // Standard great-circle initial-bearing formula, Kaaba as destination.
  function bearing(lat, lon){
    const φ1 = lat * Math.PI/180, φ2 = KAABA_LAT * Math.PI/180, Δλ = (KAABA_LON - lon) * Math.PI/180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180/Math.PI + 360) % 360;
  }

  // ---- Live device-orientation compass: real heading, popup-free ----
  // The one thing no web or native app can skip is iOS's own one-time
  // system permission dialog for motion sensors — that's Apple's OS
  // prompt, not ours, and it only ever appears once per browser. We
  // trigger it directly from the person's first tap anywhere so there's
  // no extra step, modal, or toast in between.
  let qcWatching=false, qcCurrentQibla=0, qcGotReading=false, qcWatchdog=null, qcSmoothedHeading=null;

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
    const evt=('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evt,qcOnOrientation,true);
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
    qcCurrentQibla=bearing(Number(loc.lat||51.5074),Number(loc.lon||-0.1278));
  }

  // Runs once, automatically, no tap required — works immediately on
  // Android/desktop browsers that don't gate the sensor behind permission.
  function qcAutoStart(){
    qcRefreshBearing();
    if(typeof window.DeviceOrientationEvent==='undefined') return;
    if(typeof DeviceOrientationEvent.requestPermission==='function') return; // iOS: needs a tap (below)
    qcBeginListening();
  }

  // iOS Safari gates the motion sensor behind its own one-time system
  // prompt, and that prompt can only be triggered from inside a real,
  // synchronous tap — that's an OS rule, not something this app can turn
  // off. But the tap doesn't have to land on the compass itself: the
  // person's location is already in use the moment they open the app, so
  // we ask for motion access on their FIRST tap anywhere, whatever they
  // were already tapping (a nav icon, a button — anything). By the time
  // they actually open Qiblah it's normally already live, with nothing
  // for them to press. The compass card's own tap handler stays as a
  // fallback for the rare case that first tap didn't count (e.g. it hit
  // an element mid-navigation) or the person dismissed the system prompt
  // and wants to retry.
  let qcPermissionSettled=false; // true once we have a real answer: granted, or the person said no
  async function qcRequestIOSPermission(){
    if(qcPermissionSettled || qcWatching) return;
    if(typeof window.DeviceOrientationEvent==='undefined' || typeof DeviceOrientationEvent.requestPermission!=='function') return;
    try{
      qcRefreshBearing();
      const res=await DeviceOrientationEvent.requestPermission(); // must be the first await after the tap - it is
      if(res==='granted'){ qcPermissionSettled=true; qcBeginListening(); }
      else if(res==='denied'){
        qcPermissionSettled=true;
        document.querySelectorAll('.wwp-qibla-status').forEach(l=>{ l.textContent='Compass access is off for this site — turn on Motion & Orientation Access in Settings ▸ Safari, then reopen the app.'; });
      }
      // any other result (e.g. the browser silently ignored an untrusted
      // event): leave qcPermissionSettled false so the next real tap,
      // including the card itself, gets another try.
    }catch(err){ /* not treated as settled — the compass card can still be tapped directly */ }
  }
  // Capture phase + {once:true}: fires on the very next real tap anywhere
  // in the document, ahead of that element's own click handler, and only
  // ever once — it unregisters itself whether or not it succeeded, so a
  // denial or an unrelated click never asks twice.
  document.addEventListener('click', qcRequestIOSPermission, {capture:true, once:true});

  function wireTapTargets(){
    document.querySelectorAll('.wwp-qibla-trigger').forEach(btn=>{
      if(btn.__wwpQcWired) return;
      btn.__wwpQcWired = true;
      btn.addEventListener('click', ()=>{ qcRequestIOSPermission(); });
    });
  }
  wireTapTargets();
  // The Travel Mode card is injected later (lazy feature bundle), so
  // re-wire whenever new DOM shows up carrying the trigger class.
  new MutationObserver(wireTapTargets).observe(document.body, {childList:true, subtree:true});

  qcAutoStart();

  // Keep the live bearing fresh whenever location/method/etc. changes —
  // e.g. the person corrects their location while Qiblah is already
  // live — without needing a page-specific render loop to push updates.
  if(window.PrayerTimes && typeof window.PrayerTimes.subscribe === 'function'){
    window.PrayerTimes.subscribe(qcRefreshBearing);
  }

  return { bearing: bearing, refreshBearing: qcRefreshBearing };
})();

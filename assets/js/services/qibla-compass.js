/* ============================================================
   QIBLA COMPASS :: shared Kaaba bearing calc + live device-
   orientation compass. Loaded as a CORE asset (see index.html /
   sw.js) — NOT a lazy feature bundle — so both the Prayer Times
   page and Travel Mode get a live compass independently of each
   other and of which page (if any) the person has opened.

   Drives every element carrying these shared classes:
     .wwp-qibla-card      the tappable card/button
     .wwp-qc-needle       the rotating needle (inside a card)
     .wwp-qibla-status    the status/instruction line (inside a card)
     .wwp-qibla-trigger   anything that should also request iOS
                          motion permission on tap

   PERFORMANCE (rewritten 28 Sep 2026):
   - The motion sensor only runs while a compass card is actually on
     screen (IntersectionObserver) and the app is in the foreground.
     It used to run on every page from app start, 60+ times a second.
   - Screen updates are batched to one per animation frame, and only
     touch the DOM when something visibly changed (needle moved by
     ≥0.3°, status text or aligned state flipped). Element lookups are
     cached per card instead of 3 document-wide queries per sensor event.
   - The needle angle is "unwrapped", so crossing 359°→0° turns the
     needle a couple of degrees instead of spinning it a full circle.
   - The iOS tap-to-allow wiring uses one delegated click listener
     instead of a MutationObserver watching the whole page.
   - When a card comes back on screen, the last known heading is drawn
     immediately — no blank "Turning on…" wait.
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

  const hasSensor = typeof window.DeviceOrientationEvent !== 'undefined';
  const needsIOSPermission = hasSensor && typeof DeviceOrientationEvent.requestPermission === 'function';
  const SENSOR_EVENT = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';

  // Fixed status strings. Only these (never data) go through innerHTML.
  const STATUS_ALIGNED = 'Aligned — facing the Qiblah';
  const STATUS_RIGHT = 'Turn to your <b>right</b>';
  const STATUS_LEFT = 'Turn to your <b>left</b>';

  let qibla = 0;               // bearing to the Kaaba from the current location
  let smoothed = null;         // smoothed device heading, degrees from north
  let gotReading = false;
  let listening = false;
  let sensorAllowed = hasSensor && !needsIOSPermission; // iOS flips this after its prompt
  let iosSettled = false;      // true once iOS gave a real answer (granted/denied)
  let message = null;          // plain-text message that replaces the status (no sensor, denied…)
  let watchdog = null;
  let rafId = 0;
  let needleAngle = null;      // unwrapped needle angle (can go past 360 / below 0)

  const visibleCards = new Set();
  const partsCache = new WeakMap();
  function parts(card){
    let p = partsCache.get(card);
    if(!p){
      p = {
        needle: card.querySelector('.wwp-qc-needle'),
        status: card.querySelector('.wwp-qibla-status'),
        angle: null, statusKey: null, aligned: null
      };
      partsCache.set(card, p);
    }
    return p;
  }

  // ---- Rendering: at most once per frame, only for on-screen cards ----
  function scheduleRender(){
    if(!rafId) rafId = requestAnimationFrame(render);
  }

  function render(){
    rafId = 0;
    if(!visibleCards.size) return;

    let statusKey = null, statusHtml = null, aligned = false;
    if(smoothed !== null){
      const rel = ((qibla - smoothed) % 360 + 360) % 360;
      if(needleAngle === null){
        needleAngle = rel;
      }else{
        let d = rel - ((needleAngle % 360) + 360) % 360;
        if(d > 180) d -= 360; else if(d < -180) d += 360;
        needleAngle += d;
      }
      // Signed offset in (-180, 180]: positive = Qiblah is to the right.
      const diff = rel > 180 ? rel - 360 : rel;
      aligned = Math.abs(diff) < 5;
      statusHtml = aligned ? STATUS_ALIGNED : (diff > 0 ? STATUS_RIGHT : STATUS_LEFT);
      statusKey = statusHtml;
    }else if(message){
      statusKey = 'msg:' + message;
    }

    visibleCards.forEach(card => {
      const p = parts(card);
      if(p.needle && needleAngle !== null && (p.angle === null || Math.abs(p.angle - needleAngle) >= 0.3)){
        p.angle = needleAngle;
        p.needle.style.transform = 'rotate(' + needleAngle.toFixed(1) + 'deg)';
      }
      if(p.status && statusKey !== null && p.statusKey !== statusKey){
        p.statusKey = statusKey;
        if(statusHtml !== null) p.status.innerHTML = statusHtml;
        else p.status.textContent = message;
      }
      if(p.aligned !== aligned){
        p.aligned = aligned;
        card.classList.toggle('tm-qc-aligned', aligned);
      }
    });
  }

  function showMessage(text){
    if(gotReading || message === text) return; // a live heading always wins over a message
    message = text;
    scheduleRender();
  }

  // ---- Sensor ----
  function onOrientation(e){
    let heading = null;
    if(typeof e.webkitCompassHeading === 'number'){
      heading = e.webkitCompassHeading; // iOS: already a true, north-referenced heading
    }else if(typeof e.alpha === 'number' && e.absolute === true){
      // Only trust alpha as a true heading when the browser confirms the
      // reading is absolute (north-referenced). Plain `deviceorientation`
      // on many Android browsers fires with absolute:false — alpha there
      // is relative to an arbitrary starting angle, not north.
      heading = (360 - e.alpha) % 360;
    }
    if(heading === null || isNaN(heading)){
      showMessage('This device can\'t give a true compass heading — try a dedicated compass app.');
      return;
    }
    if(!gotReading){
      gotReading = true;
      message = null;
      if(watchdog){ clearTimeout(watchdog); watchdog = null; }
    }

    // Circular exponential moving average — plain numeric averaging breaks
    // at the 0°/360° wrap (350° and 10° would average to 180°).
    if(smoothed === null){
      smoothed = heading;
    }else{
      const rad = Math.PI/180;
      const sx = Math.sin(smoothed*rad)*0.8 + Math.sin(heading*rad)*0.2;
      const cx = Math.cos(smoothed*rad)*0.8 + Math.cos(heading*rad)*0.2;
      smoothed = (Math.atan2(sx, cx)*180/Math.PI + 360) % 360;
    }
    scheduleRender();
  }

  function startSensor(){
    if(listening) return;
    window.addEventListener(SENSOR_EVENT, onOrientation, true);
    listening = true;
    if(!gotReading && !watchdog){
      watchdog = setTimeout(() => {
        watchdog = null;
        if(!gotReading){
          showMessage(location.protocol !== 'https:' ? 'Compass needs https to work.' : 'No compass sensor found on this device.');
        }
      }, 2500);
    }
  }

  function stopSensor(){
    if(!listening) return;
    window.removeEventListener(SENSOR_EVENT, onOrientation, true);
    listening = false;
    if(watchdog){ clearTimeout(watchdog); watchdog = null; }
  }

  // Sensor runs only when it's allowed, a compass is on screen, and the
  // app is in the foreground. Everything else is battery for nothing.
  function updateSensor(){
    const want = sensorAllowed && visibleCards.size > 0 && !document.hidden;
    if(want) startSensor(); else stopSensor();
    if(visibleCards.size) scheduleRender();
  }

  // ---- Which cards are on screen ----
  const io = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
    entries.forEach(en => {
      if(en.isIntersecting) visibleCards.add(en.target);
      else visibleCards.delete(en.target);
    });
    updateSensor();
  }, { rootMargin: '200px 0px' }) : null; // start just before the card scrolls into view

  const observed = new WeakSet();
  function scanCards(){
    document.querySelectorAll('.wwp-qibla-card').forEach(card => {
      if(observed.has(card)) return;
      observed.add(card);
      if(io) io.observe(card);
      else visibleCards.add(card); // very old browsers: behave like before (always on)
    });
    if(!io) updateSensor();
  }

  document.addEventListener('visibilitychange', updateSensor);
  // Pages are swapped in by the SPA router — pick up any compass card
  // that wasn't in the DOM yet (cheap: only runs on page change).
  window.addEventListener('wwp-page-shown', scanCards);

  // ---- Bearing from the person's location ----
  function refreshBearing(){
    const st = window.PrayerTimes?.getState?.() || {};
    const loc = st.location || {};
    const q = bearing(Number(loc.lat || 51.5074), Number(loc.lon || -0.1278));
    if(q !== qibla){ qibla = q; scheduleRender(); }
  }

  // ---- iOS motion permission ----
  // iOS Safari gates the motion sensor behind its own one-time system
  // prompt, which can only be triggered from inside a real tap. We ask on
  // the person's FIRST tap anywhere, so by the time they open Qiblah it's
  // normally already live. Tapping a compass card also retries.
  async function requestIOSPermission(){
    if(!needsIOSPermission || iosSettled) return;
    try{
      const res = await DeviceOrientationEvent.requestPermission(); // must be the first await after the tap
      if(res === 'granted'){
        iosSettled = true;
        sensorAllowed = true;
        message = 'Turning on…';
        updateSensor();
      }else if(res === 'denied'){
        iosSettled = true;
        showMessage('Compass access is off for this site — turn on Motion & Orientation Access in Settings ▸ Safari, then reopen the app.');
      }
      // Any other result (browser ignored an untrusted event): not settled,
      // so the next real tap — including the card itself — tries again.
    }catch(err){ /* not settled — the compass card can still be tapped */ }
  }
  if(needsIOSPermission){
    document.addEventListener('click', requestIOSPermission, {capture:true, once:true});
    document.addEventListener('click', e => {
      if(e.target && e.target.closest && e.target.closest('.wwp-qibla-trigger')) requestIOSPermission();
    });
  }

  refreshBearing();
  if(!hasSensor) message = 'No compass sensor found on this device.';
  else if(needsIOSPermission) message = 'Tap to turn on the compass.';
  scanCards();

  // Keep the bearing fresh whenever location changes.
  if(window.PrayerTimes && typeof window.PrayerTimes.subscribe === 'function'){
    window.PrayerTimes.subscribe(refreshBearing);
  }

  return { bearing: bearing, refreshBearing: refreshBearing };
})();

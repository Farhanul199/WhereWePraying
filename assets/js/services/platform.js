/* ============================================================
   PLATFORM (WEB) :: isolates platform-specific capabilities behind
   one call so features never touch navigator.* directly. Wraps the
   Web Share API and the Clipboard API — the two capabilities that
   were repeated (with slightly different content each) across
   several feature files. On a future native Android/iOS build,
   only this file changes — Platform.share()/copyToClipboard() would
   route to native equivalents instead — no feature file needs
   touching again.
   ============================================================ */
window.Platform = (function(){
  // data: { title, text, files } ...
  function share(data, handlers){
    const opts = typeof handlers === 'function' ? { onUnsupported: handlers } : (handlers || {});
    const filesOk = !data.files || (navigator.canShare && navigator.canShare(data));
    if(navigator.share && filesOk){
      return navigator.share(data).then(()=>{
        if(typeof opts.onSuccess === 'function') opts.onSuccess();
      }).catch(()=>{
        if(typeof opts.onCancelOrFail === 'function') opts.onCancelOrFail();
      });
    }
    if(typeof opts.onUnsupported === 'function') opts.onUnsupported();
    return Promise.resolve();
  }

  function copyToClipboard(text, handlers){
    const opts = typeof handlers === 'function' ? { onSuccess: handlers } : (handlers || {});
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).then(()=>{
        if(typeof opts.onSuccess === 'function') opts.onSuccess();
      }).catch(()=>{
        if(typeof opts.onFail === 'function') opts.onFail();
      });
    }
    if(typeof opts.onFail === 'function') opts.onFail();
    return Promise.resolve();
  }

  // `accuracy` (metres, 68% confidence radius) added 28 Sep 2026 so the
  // UI can say how precise a fix is. Existing callers only read lat/lon.
  function getLocation(opts){
    return new Promise((resolve, reject)=>{
      if(!navigator.geolocation){ reject(new Error('Geolocation not supported')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy}),
        err => reject(err),
        opts || {}
      );
    });
  }

  // Continuous location updates. Returns a stop() function. Callers must
  // stop it when their page is hidden — it keeps the location hardware
  // awake while it runs.
  function watchLocation(onFix, opts){
    if(!navigator.geolocation || typeof navigator.geolocation.watchPosition !== 'function') return function(){};
    const id = navigator.geolocation.watchPosition(
      pos => onFix({lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy}),
      () => {},
      opts || {}
    );
    return function(){ try{ navigator.geolocation.clearWatch(id); }catch(e){} };
  }

  // 'granted' | 'denied' | 'prompt' | 'unknown' — never shows a prompt.
  async function locationPermission(){
    try{
      if(!navigator.permissions || !navigator.permissions.query) return 'unknown';
      const status = await navigator.permissions.query({name:'geolocation'});
      return status.state || 'unknown';
    }catch(e){ return 'unknown'; }
  }

  return { share, copyToClipboard, getLocation, watchLocation, locationPermission };
})();

/* ============================================================
   PAGE TRANSITION LOADER
   Keeps the existing opaque boot loader over SPA pages while their
   lazy CSS/JS is being fetched. This prevents raw/un-styled HTML
   from painting during navigation, without making every feature
   bundle load up front.
   ============================================================ */

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
  // data: { title, text, files } (any subset — matches navigator.share's
  // own shape).
  //
  // Second argument accepts either:
  //   - a plain function: onUnsupported (original, simplest shape — used
  //     by Journal/Guides/Du'a/Qur'an/Travel Mode share buttons)
  //   - an options object: { onSuccess, onUnsupported, onCancelOrFail }
  //     for callers that need to distinguish "shared successfully" from
  //     "share sheet was cancelled/failed" (e.g. Backup & Restore, which
  //     shows a success message only once the share actually completes).
  //
  // When data.files is present, checks navigator.canShare first — some
  // browsers support navigator.share but not file-sharing specifically,
  // so treating that as "unsupported" avoids opening a share sheet that
  // can't actually handle the payload.
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

  // text: string to copy.
  //
  // Second argument accepts either:
  //   - a plain function: onSuccess (matches the common "copied!"
  //     toast case used by most callers)
  //   - an options object: { onSuccess, onFail }
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

  // opts: forwarded as-is to getCurrentPosition's PositionOptions
  // (enableHighAccuracy, timeout, maximumAge) — each caller tunes
  // these differently, so this stays a thin pass-through rather than
  // enforcing one set of defaults.
  //
  // Resolves { lat, lon } on success, rejects on error/unsupported —
  // callers that want "never reject, just fall back" should .catch()
  // at the call site (matches the existing behaviour of both callers
  // this replaces).
  function getLocation(opts){
    return new Promise((resolve, reject)=>{
      if(!navigator.geolocation){ reject(new Error('Geolocation not supported')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({lat:pos.coords.latitude, lon:pos.coords.longitude}),
        err => reject(err),
        opts || {}
      );
    });
  }
  return { share, copyToClipboard, getLocation };
})();

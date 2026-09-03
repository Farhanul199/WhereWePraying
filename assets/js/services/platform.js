/* ============================================================
   PLATFORM (WEB) :: isolates platform-specific capabilities behind
   one call so features never touch navigator.* directly. Today
   this only wraps the Web Share API (the one capability repeated
   across 6 feature files with slightly different content each).
   On a future native Android/iOS build, only this file changes —
   Platform.share() would route to a native share intent instead —
   no feature file needs touching again.
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
  return { share };
})();

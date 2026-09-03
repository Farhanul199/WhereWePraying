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
  // own shape). onUnsupported: optional fallback called when the Web
  // Share API isn't available at all (desktop browsers mostly).
  function share(data, onUnsupported){
    if(navigator.share){
      return navigator.share(data).catch(()=>{});
    }
    if(typeof onUnsupported === 'function') onUnsupported();
    return Promise.resolve();
  }
  return { share };
})();

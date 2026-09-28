/* ============================================================
   BOOT :: event-banners.js
   Early Jummah/Ramadan banner visibility (before hero paint).
   Moved out of inline <script> tags in index.html (28 Sep 2026) so the
   app pages can run a Content-Security-Policy with no 'unsafe-inline'
   scripts (blocks injected onerror=/onclick= style XSS). Loaded as a
   normal blocking <script src> at the SAME spot in the page, so it runs
   at exactly the same moment the inline version did.
   If you edit it, bump its ?v= in index.html AND in sw.js CORE_ASSETS.
   ============================================================ */

// Early banner-visibility resolver — runs right after the banners exist
// in the DOM but before the hero content below is parsed/painted, so a
// banner appearing doesn't push the hero image down after first paint.
(function(){
  try{
    var early = window.__wwpEarlyEvent;
    if(!early) return; // preview mode or resolver bailed out — leave as-is

    if(!early.ramadanActive && early.isFriday){
      var jb = document.getElementById('jummah-banner');
      if(jb) jb.classList.remove('hidden');
    }
    if(early.ramadanActive){
      var rb = document.getElementById('ramadan-banner');
      if(rb) rb.classList.remove('hidden');
    }
  }catch(e){}
})();

/* ============================================================
   BOOT :: event-theme.js
   Early Jummah/Ramadan theme resolver (before header paint).
   Moved out of inline <script> tags in index.html (28 Sep 2026) so the
   app pages can run a Content-Security-Policy with no 'unsafe-inline'
   scripts (blocks injected onerror=/onclick= style XSS). Loaded as a
   normal blocking <script src> at the SAME spot in the page, so it runs
   at exactly the same moment the inline version did.
   If you edit it, bump its ?v= in index.html AND in sw.js CORE_ASSETS.
   ============================================================ */


// Early event-theme resolver — runs before any header/content is painted,
// so Jummah/Ramadan styling is already in place on first paint instead of
// flashing standard theme first. Mirrors the cache/Friday logic in the
// full resolver further down the page; that block re-verifies via the
// live Hijri API afterward and corrects this if the cache was stale.
(function(){
  try{
    var preview = window.__wwpPreview || {theme:null, event:null};
    var forceEventTheme = preview.event;

    if(forceEventTheme === 'ramadan' || forceEventTheme === 'jummah'){
      document.body.setAttribute('data-event-theme', forceEventTheme);
    }else if(forceEventTheme !== 'none'){
      var d = new Date();
      var todayKey = d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
      var isFriday = d.getDay() === 5;

      var ramadanActive = false;
      try{
        var raw = localStorage.getItem('wwp:ramadan:hijriCheck');
        if(raw){
          var cached = JSON.parse(raw);
          if(cached && cached.dateKey === todayKey) ramadanActive = !!cached.isRamadan;
        }
      }catch(e){}

      if(ramadanActive){ document.body.setAttribute('data-event-theme', 'ramadan'); }
      else if(isFriday){ document.body.setAttribute('data-event-theme', 'jummah'); }

      // Stash the computed values so the banner-visibility script just
      // below the banners (they don't exist in the DOM yet at this point)
      // can reuse them without recomputing.
      window.__wwpEarlyEvent = {ramadanActive: ramadanActive, isFriday: isFriday, todayKey: todayKey};
    }

    // Match the Android status bar to whichever event theme + base theme
    // + accent preference is active (see WWP_applyThemeColor, defined in
    // the script above this one).
    if(window.WWP_applyThemeColor) window.WWP_applyThemeColor();
  }catch(e){}
})();

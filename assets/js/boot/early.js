/* ============================================================
   BOOT :: early.js
   URL-param capture + boot-loader timer + saved-theme restore (before paint).
   Moved out of inline <script> tags in index.html (28 Sep 2026) so the
   app pages can run a Content-Security-Policy with no 'unsafe-inline'
   scripts (blocks injected onerror=/onclick= style XSS). Loaded as a
   normal blocking <script src> at the SAME spot in the page, so it runs
   at exactly the same moment the inline version did.
   If you edit it, bump its ?v= in index.html AND in sw.js CORE_ASSETS.
   ============================================================ */

/* ---- (was <head> inline script) ---- */
// Capture ?previewTheme= / ?previewEvent= before the router's
// history.replaceState (later in the page) wipes the query string.
// ==> CONNECT: read by admin/theme-preview.html's forced-theme logic
// further down the page — see window.__wwpPreview.
window.__wwpPreview = (function(){
  try{
    var p = new URLSearchParams(location.search);
    return { theme: p.get('previewTheme'), event: p.get('previewEvent') };
  }catch(e){ return { theme:null, event:null }; }
})();

// Capture ?token= (magic link sign-in) before the router's
// history.replaceState wipes the query string — see window.__wwpAuthToken,
// read by the auth system script further down the page.
window.__wwpAuthToken = (function(){
  try{
    var p = new URLSearchParams(location.search);
    return p.get('token');
  }catch(e){ return null; }
})();

// Same early-capture for the Google sign-in redirect (?signed_in=1 or
// ?auth_error=...), which lands here after /api/auth/google/callback.
window.__wwpGoogleAuthResult = (function(){
  try{
    var p = new URLSearchParams(location.search);
    return { signedIn: p.get('signed_in') === '1', error: p.get('auth_error') };
  }catch(e){ return { signedIn:false, error:null }; }
})();

/* ---- (was boot-loader timer) ---- */
setTimeout(function(){ var l=document.getElementById('bootLoader'); if(l){ l.classList.add('hide'); setTimeout(function(){l.remove();},300);} }, 400);

/* ---- (was theme restore) ---- */
(function(){
  // Restore the saved theme immediately (before the rest of the page
  // parses) to avoid a flash of the default theme on load.
  try{
    var saved = localStorage.getItem('wwp:theme');
    if(saved && ['light','sepia','dark','amoled'].indexOf(saved) !== -1){
      document.body.setAttribute('data-theme', saved);
    }
  }catch(e){}

  // ---- Status bar (theme-color) accent ----
  // Three inputs decide the Android status bar colour:
  //   1) which event theme is active — normal / jummah / ramadan
  //      (read from body[data-event-theme], set by the event resolvers)
  //   2) the base app theme — light/sepia vs dark vs amoled
  //   3) the user's own Light/Dark accent preference (Settings > App
  //      Display), which only matters on the light/sepia base theme —
  //      dark and amoled always use their own dimmed/near-black variant
  //      so the status bar never clashes with those dark backgrounds.
  var WWP_ACCENT = {
    light:  {normal:'#F5956A', jummah:'#A8C68F', ramadan:'#C4A0D9'}, // light peach / light sage / light plum
    dark:   {normal:'#D85A38', jummah:'#5C7A59', ramadan:'#7E5182'}, // original darker tone
    darkTheme:   {normal:'#6B4423', jummah:'#4D5C38', ramadan:'#6B4A5C'}, // dimmed, for body[data-theme=dark]
    amoledTheme: {normal:'#3D2818', jummah:'#2D3E20', ramadan:'#4A2E52'}  // near-black, for body[data-theme=amoled]
  };

  window.WWP_applyThemeColor = function(){
    try{
      var baseTheme = document.body.getAttribute('data-theme') || 'light';
      var eventTheme = document.body.getAttribute('data-event-theme'); // 'ramadan' | 'jummah' | null
      var key = eventTheme === 'ramadan' ? 'ramadan' : (eventTheme === 'jummah' ? 'jummah' : 'normal');

      var palette;
      if(baseTheme === 'amoled'){ palette = WWP_ACCENT.amoledTheme; }
      else if(baseTheme === 'dark'){ palette = WWP_ACCENT.darkTheme; }
      else{
        var pref = 'light';
        try{ pref = localStorage.getItem('wwp:themeColorMode') || 'light'; }catch(e2){}
        palette = (pref === 'dark') ? WWP_ACCENT.dark : WWP_ACCENT.light;
      }

      var tc = document.querySelector('meta[name="theme-color"]');
      if(tc) tc.setAttribute('content', palette[key]);
    }catch(e){}
  };

  // There are several setTheme()/cycleTheme() functions across the app
  // (topbar toggle, Qur'an reader, Journal, Du'a) that all just set
  // body[data-theme] directly. Rather than editing each one, watch the
  // attribute itself so every theme change — current and future — gets
  // saved the same way, from whichever section triggered it (including
  // Travel Mode) — and re-run the status bar colour alongside it. Also
  // watches data-event-theme so Jummah/Ramadan switching (set elsewhere)
  // updates the status bar too.
  try{
    new MutationObserver(function(){
      var val = document.body.getAttribute('data-theme');
      if(val){ try{ localStorage.setItem('wwp:theme', val); }catch(e){} }
      window.WWP_applyThemeColor();
    }).observe(document.body, {attributes:true, attributeFilter:['data-theme','data-event-theme']});
  }catch(e){}

  // User's Light/Dark status-bar-accent choice, set from Settings > App Display.
  document.addEventListener('change', function(e){
    if(e.target && e.target.name === 'themeColorMode'){
      try{ localStorage.setItem('wwp:themeColorMode', e.target.value); }catch(e2){}
      window.WWP_applyThemeColor();
    }
  });

  function wwpSyncThemeColorRadioUI(){
    var pref = 'light';
    try{ pref = localStorage.getItem('wwp:themeColorMode') || 'light'; }catch(e){}
    var els = document.querySelectorAll('input[name="themeColorMode"]');
    for(var i=0;i<els.length;i++){ els[i].checked = (els[i].value === pref); }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wwpSyncThemeColorRadioUI);
  }else{
    wwpSyncThemeColorRadioUI();
  }
})();

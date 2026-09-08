
/* ===== deferred feature script 18 ===== */
(function(){
/* ============================================================
   EXPERIMENTAL GLASS MODE :: opt-in site-wide glassmorphism.
   Off by default. Applies body[data-glass="on"], which the CSS above
   uses to swap --surface/--surface-alt/--border/--shadow to translucent
   values and activate --surface-blur — every card/panel already
   references these tokens, so this one attribute frosts the whole site.
   ============================================================ */
(function(){
  const STORAGE_KEY = 'wwp:glass:mode';

  function isOn(){
    return window.LocalCache ? window.LocalCache.get(STORAGE_KEY, null) === 'on' : false;
  }

  function apply(on){
    document.body.setAttribute('data-glass', on ? 'on' : 'off');
  }

  function setMode(on){
    if(window.LocalCache) window.LocalCache.set(STORAGE_KEY, on ? 'on' : 'off');
    apply(on);
  }

  function syncToggleUI(){
    const el = document.getElementById('glassModeToggle');
    if (el) el.checked = isOn();
  }

  // Apply immediately (before DOMContentLoaded where possible) so
  // there's no flash of the non-glass look when it's enabled.
  apply(isOn());

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'glassModeToggle') {
      setMode(e.target.checked);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleUI);
  } else {
    syncToggleUI();
  }
})();

/* ============================================================
   TWA safe-area padding toggle :: off by default (full-bleed,
   edge-to-edge look — the preferred default). Sets
   body[data-safe-area="on"], which app.css only acts on inside
   @media (display-mode: standalone) — so this has zero effect in
   a regular browser tab, only in the installed app. Same
   LocalCache + body-attribute pattern as glass mode above.
   ============================================================ */
(function(){
  const STORAGE_KEY = 'wwp:safearea:padding';

  function isOn(){
    return window.LocalCache ? window.LocalCache.get(STORAGE_KEY, null) === 'on' : false;
  }

  function apply(on){
    document.body.setAttribute('data-safe-area', on ? 'on' : 'off');
  }

  function setMode(on){
    if(window.LocalCache) window.LocalCache.set(STORAGE_KEY, on ? 'on' : 'off');
    apply(on);
  }

  function syncToggleUI(){
    const el = document.getElementById('safeAreaPaddingToggle');
    if (el) el.checked = isOn();
  }

  apply(isOn());

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'safeAreaPaddingToggle') {
      setMode(e.target.checked);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncToggleUI);
  } else {
    syncToggleUI();
  }
})();

})();
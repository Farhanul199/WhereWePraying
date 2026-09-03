
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
    try{ return localStorage.getItem(STORAGE_KEY) === 'on'; }
    catch(e){ return false; }
  }

  function apply(on){
    document.body.setAttribute('data-glass', on ? 'on' : 'off');
  }

  function setMode(on){
    try{ localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); }catch(e){}
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

})();
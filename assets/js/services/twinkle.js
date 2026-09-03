
/* ===== deferred feature script 17 ===== */
(function(){
/* ============================================================
   SITE-WIDE TWINKLE / SPARKLE SYSTEM
   Generates a field of soft twinkling dots spanning the full
   scroll height of whichever page is currently visible. Density
   and opacity scale with the saved preference (off/low/medium/
   full), stored per-device and — when signed in — mirrored to
   the account settings radio group in the Account popup.
   Regenerates on page switch (via switchPage) and on window
   resize (debounced), since full-page height changes with content.
   ============================================================ */
window.WWP_Twinkle = (function(){
  const STORAGE_KEY = 'wwp:twinkle:level';
  const LEVELS = {
    off:    { count: 0,  minSize: 0,   maxSize: 0   },
    low:    { count: 18, minSize: 1.5, maxSize: 2.5 },
    medium: { count: 36, minSize: 1.5, maxSize: 3   },
    full:   { count: 60, minSize: 1.5, maxSize: 3.5 }
  };
  const VALID = Object.keys(LEVELS);

  function getLevel(){
    try{
      const v = localStorage.getItem(STORAGE_KEY);
      return VALID.includes(v) ? v : 'low';
    }catch(e){ return 'low'; }
  }
  function setLevel(level){
    if(!VALID.includes(level)) return;
    try{ localStorage.setItem(STORAGE_KEY, level); }catch(e){}
    document.body.setAttribute('data-twinkle', level);
    render();
  }

  function currentVisiblePage(){
    return document.querySelector('.app-page:not(.hidden)');
  }

  function render(){
    const level = document.body.getAttribute('data-twinkle') || getLevel();
    // Clear any existing field on every page, not just the one about
    // to be shown — otherwise hidden pages accumulate stale fields
    // every time render() runs (page switch, resize, interval tick).
    document.querySelectorAll('.wwp-twinkle-field').forEach(el=>el.remove());

    const page = currentVisiblePage();
    if(!page) return;
    if(level === 'off') return;

    const cfg = LEVELS[level];
    if(!cfg || cfg.count === 0) return;

    const field = document.createElement('div');
    field.className = 'wwp-twinkle-field';
    field.setAttribute('aria-hidden', 'true');

    // Spread stars across the page's full rendered height, not just
    // the visible viewport, so scrolling reveals more rather than a
    // twinkle field that ends abruptly partway down a long page.
    const pageHeight = Math.max(page.scrollHeight, window.innerHeight);
    const frag = document.createDocumentFragment();
    for(let i=0; i<cfg.count; i++){
      const star = document.createElement('span');
      star.className = 'wwp-star';
      const size = cfg.minSize + Math.random()*(cfg.maxSize - cfg.minSize);
      const left = Math.random()*100;
      const top = Math.random()*pageHeight;
      const delay = Math.random()*3.4;
      star.style.width = size+'px';
      star.style.height = size+'px';
      star.style.left = left+'%';
      star.style.top = top+'px';
      star.style.setProperty('--wwp-tw-delay', delay+'s');
      frag.appendChild(star);
    }
    field.appendChild(frag);
    field.style.height = pageHeight+'px';
    page.insertBefore(field, page.firstChild);
  }

  let resizeTimer = null;
  window.addEventListener('resize', ()=>{
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 250);
  });

  // Re-render whenever the page's own content height might have
  // changed (images loading, accordions opening, etc.) without a
  // full page switch — cheap enough to run on a slow interval.
  setInterval(()=>{
    if(document.body.getAttribute('data-twinkle') !== 'off') render();
  }, 4000);

  document.body.setAttribute('data-twinkle', getLevel());

  function syncRadioUI(){
    const level = getLevel();
    document.querySelectorAll('input[name="twinkleLevel"]').forEach(r=>{
      r.checked = (r.value === level);
    });
  }

  document.addEventListener('change', (e)=>{
    if(e.target && e.target.name === 'twinkleLevel'){
      setLevel(e.target.value);
    }
  });

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ syncRadioUI(); render(); });
  }else{
    syncRadioUI();
    render();
  }

  return { getLevel, setLevel, render, syncRadioUI, LEVELS: Object.keys(LEVELS) };
})();

})();
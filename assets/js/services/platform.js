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

/* ============================================================
   PAGE TRANSITION LOADER
   Keeps the existing opaque boot loader over SPA pages while their
   lazy CSS/JS is being fetched. This prevents raw/un-styled HTML
   from painting during navigation, without making every feature
   bundle load up front.
   ============================================================ */
(function PageTransitionLoader(){
  const BOOT_ID = 'bootLoader';
  let activeToken = 0;
  let ready = false;
  let observer = null;

  function createLoader(){
    const el = document.createElement('div');
    el.id = BOOT_ID;
    el.innerHTML = '<img src="/assets/logo.png" alt="" width="56" height="56">';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#FBF3EC;display:flex;align-items:center;justify-content:center;transition:opacity .25s ease;';
    const img = el.querySelector('img');
    if(img){
      img.style.cssText = 'width:56px;height:56px;animation:wwpBootPulse 1.1s ease-in-out infinite;mix-blend-mode:multiply;';
    }
    return el;
  }

  function ensureLoader(){
    let el = document.getElementById(BOOT_ID);
    if(!el){
      el = createLoader();
      document.body.appendChild(el);
    }
    el.classList.remove('hide');
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    return el;
  }

  function hideLoader(){
    const el = document.getElementById(BOOT_ID);
    if(!el) return;
    el.classList.add('hide');
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(()=>{
      if(ready && el.classList.contains('hide')) el.remove();
    },300);
  }

  function waitForPaint(){
    return new Promise(resolve=>{
      requestAnimationFrame(()=>requestAnimationFrame(resolve));
    });
  }

  async function preparePage(id, token){
    ensureLoader();
    try{
      if(window.WWP_loadFeature) await window.WWP_loadFeature(id);
      await waitForPaint();
    }catch(e){
      // Never leave the app permanently covered if a feature fails.
    }
    if(token !== activeToken) return;
    ready = true;
    hideLoader();
  }

  function beginTransition(){
    ready = false;
    ensureLoader();
    activeToken += 1;
    return activeToken;
  }

  /*
   * The original index.html has a short 400ms boot-loader timeout.
   * We deliberately keep this compatibility guard here so the fix
   * works even before index.html is replaced: while the app is not
   * ready, a premature hide/removal is immediately reversed.
   */
  function watchBootLoader(){
    if(!document.body || observer) return;
    observer = new MutationObserver(function(mutations){
      if(ready) return;
      let needsRestore = false;
      for(const m of mutations){
        if(m.type === 'childList'){
          for(const n of m.removedNodes){
            if(n.nodeType === 1 && n.id === BOOT_ID){
              needsRestore = true;
              break;
            }
          }
        }else if(m.type === 'attributes' && m.target && m.target.id === BOOT_ID){
          if(m.target.classList.contains('hide') || m.target.style.opacity === '0'){
            needsRestore = true;
            break;
          }
        }
        if(needsRestore) break;
      }
      if(needsRestore) ensureLoader();
    });
    observer.observe(document.body,{
      childList:true,
      subtree:true,
      attributes:true,
      attributeFilter:['class','style']
    });
  }

  function init(){
    if(!document.body) return;

    watchBootLoader();

    // Keep the loader up for the initial route until its lazy feature
    // bundle has loaded and the browser has painted it.
    const initialToken = ++activeToken;
    preparePage(
      (function(){
        const pages = Array.from(document.querySelectorAll('[id^="page-"]'));
        const visible = pages.find(p=>!p.classList.contains('hidden'));
        return visible ? visible.id.replace(/^page-/,'') : 'home';
      })(),
      initialToken
    );

    /*
     * Navigation capture runs before wwp-core's normal click handlers.
     * The loader therefore covers the page before switchPage() reveals
     * the destination, eliminating the raw-HTML flash.
     */
    document.addEventListener('click', function(e){
      const link = e.target.closest && e.target.closest('[data-page]');
      if(!link || !window.switchPage) return;

      const id = link.dataset.page;
      if(!id) return;

      const current = Array.from(document.querySelectorAll('[id^="page-"]'))
        .find(p=>!p.classList.contains('hidden'));
      const currentId = current ? current.id.replace(/^page-/,'') : 'home';

      if(id !== currentId) beginTransition();
    }, true);

    /*
     * switchPage() dispatches this after the destination page becomes
     * visible. WWP_loadFeature() is the same promise used by the core
     * feature-loader listener, so this does not load a bundle twice.
     * We wait for two animation frames so the stylesheet has actually
     * painted before removing the opaque cover.
     */
    window.addEventListener('wwp-page-shown', function(e){
      const id = e.detail && e.detail.id ? e.detail.id : 'home';
      const token = activeToken;
      ready = false;
      ensureLoader();

      Promise.resolve()
        .then(()=> window.WWP_loadFeature ? window.WWP_loadFeature(id) : null)
        .then(()=>waitForPaint())
        .catch(()=>0)
        .then(()=>{
          if(token !== activeToken) return;
          ready = true;
          hideLoader();
        });
    });

    /*
     * Back/forward can call switchPage() without a click. Capture the
     * event before wwp-core's popstate handler reveals the destination.
     */
    window.addEventListener('popstate', function(){
      beginTransition();
    }, true);

    const style = document.createElement('style');
    style.textContent =
      '@keyframes wwpBootPulse{0%,100%{opacity:.5;transform:scale(.94)}50%{opacity:1;transform:scale(1)}}' +
      '#bootLoader.hide{opacity:0!important;pointer-events:none!important}';
    document.head.appendChild(style);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, {once:true});
  }else{
    init();
  }
})();

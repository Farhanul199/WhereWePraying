/* ============================================================
   BOOT :: shell.js
   Offline banner + install banner wiring + footer year.
   Moved out of inline <script> tags in index.html (28 Sep 2026) so the
   app pages can run a Content-Security-Policy with no 'unsafe-inline'
   scripts (blocks injected onerror=/onclick= style XSS). Loaded as a
   normal blocking <script src> at the SAME spot in the page, so it runs
   at exactly the same moment the inline version did.
   If you edit it, bump its ?v= in index.html AND in sw.js CORE_ASSETS.
   ============================================================ */

(function OfflineDetection(){
  const b=document.getElementById('offline-banner');
  const closeBtn=document.getElementById('offlineBannerClose');
  let touchStart=0;
  let autoDismissTimer=null;
  const clearAutoDismiss=()=>{ if(autoDismissTimer){ clearTimeout(autoDismissTimer); autoDismissTimer=null; } };
  const dismiss=()=>{clearAutoDismiss();b.classList.add('hide');setTimeout(()=>{b.classList.remove('show','hide');},300);};
  const show=()=>{
    b.classList.remove('hide');b.classList.add('show');
    clearAutoDismiss();
    // Small/non-blocking notice — don't leave it sitting there forever
    // even if we never actually come back online (e.g. airplane mode).
    autoDismissTimer=setTimeout(dismiss,12000);
  };
  closeBtn.addEventListener('click',dismiss);
  b.addEventListener('click',dismiss);
  b.addEventListener('touchstart',(e)=>{touchStart=e.touches[0].clientY;},{passive:true});
  b.addEventListener('touchend',(e)=>{const touchEnd=e.changedTouches[0].clientY;if(touchEnd-touchStart>50){dismiss();}},{passive:true});
  window.addEventListener('offline',show);
  window.addEventListener('online',()=>{
    dismiss();
    // Auto-refresh prayer times when reconnecting
    if(window.PrayerTimesAPI && window.PrayerTimesAPI.fetchTimings){
      window.PrayerTimesAPI.fetchTimings().catch(()=>0);
    }
  });
  if('serviceWorker' in navigator){window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').then((reg)=>{
      // Check for a newer sw.js whenever the app is opened/foregrounded.
      reg.update().catch(()=>0);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>0)});
      // If an update is already waiting, activate it immediately.
      if(reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      reg.addEventListener('updatefound',()=>{
        const nw=reg.installing;
        if(!nw)return;
        nw.addEventListener('statechange',()=>{
          if(nw.state==='installed' && navigator.serviceWorker.controller) nw.postMessage('SKIP_WAITING');
        });
      });

      // Periodic Background Sync: on Android/Chrome, ask permission to
      // refresh cached prayer-time/mosque data in the background every
      // ~12h so offline opens are never more than half a day stale.
      // Silently a no-op anywhere unsupported (iOS Safari, desktop) —
      // feature-detected end to end, nothing else depends on it.
      (async ()=>{
        try{
          if(!('periodicSync' in reg)) return;
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
          if(status.state !== 'granted') return;
          const tags = await reg.periodicSync.getTags();
          if(!tags.includes('wwp-refresh-data')){
            await reg.periodicSync.register('wwp-refresh-data', { minInterval: 12 * 60 * 60 * 1000 });
          }
        }catch(_){}
      })();
    }).catch(()=>0);
    // Once the new SW takes control, reload once so the fresh app shell renders.
    let refreshed=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(refreshed)return; refreshed=true; window.location.reload();
    });
    // Background Sync: when the SW wakes up on reconnect (tag registered
    // from wwp-core.js whenever an offline save fails), it messages this
    // page to flush any pending saves — covers the case where the tab is
    // backgrounded rather than closed, which the plain 'online' listener
    // in wwp-core.js doesn't catch.
    navigator.serviceWorker.addEventListener('message', (e)=>{
      if(e.data === 'FLUSH_PENDING' && window.WWP && window.WWP.flushPending) window.WWP.flushPending();
    });
  })}
})();


// ---- Install banner (custom "Add to Home Screen") ----
(function(){
  var deferredPrompt = null;
  var banner = document.getElementById('installBanner');
  var actionBtn = document.getElementById('installBannerAction');
  var closeBtn = document.getElementById('installBannerClose');
  var DISMISS_KEY = 'wwp_install_dismissed_at';

  function alreadyInstalled(){
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function recentlyDismissed(){
    var t = localStorage.getItem(DISMISS_KEY);
    if(!t) return false;
    return (Date.now() - Number(t)) < 1000*60*60*24*14; // 14 days
  }
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    if(!alreadyInstalled() && !recentlyDismissed() && banner){
      setTimeout(function(){ banner.style.display='flex'; banner.classList.add('show'); }, 2500);
    }
  });
  if(actionBtn) actionBtn.addEventListener('click', function(){
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function(){
      deferredPrompt = null;
      banner.classList.add('hide');
      setTimeout(function(){ banner.style.display='none'; }, 300);
    });
  });
  if(closeBtn) closeBtn.addEventListener('click', function(){
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    banner.classList.add('hide');
    setTimeout(function(){ banner.style.display='none'; }, 300);
  });
  window.addEventListener('appinstalled', function(){
    if(banner){ banner.classList.add('hide'); setTimeout(function(){ banner.style.display='none'; },300); }
    deferredPrompt = null;
  });
})();

// ---- Share target receiver (manifest share_target -> /share-target) ----
(function(){
  if(location.pathname !== '/share-target') return;
  var p = new URLSearchParams(location.search);
  var title = p.get('title')||'', text = p.get('text')||'', url = p.get('url')||'';
  var content = [title, text, url].filter(Boolean).join('\n');
  if(!content) return;
  window.addEventListener('DOMContentLoaded', function(){
    var box = document.createElement('div');
    box.setAttribute('style','position:fixed;inset:0;z-index:99999;background:rgba(20,15,10,.45);display:flex;align-items:center;justify-content:center;padding:20px;');
    box.innerHTML = '<div style="background:var(--surface);backdrop-filter:var(--surface-blur,none);-webkit-backdrop-filter:var(--surface-blur,none);border-radius:18px;max-width:420px;width:100%;padding:20px;box-shadow:var(--shadow);">'
      + '<div style="font-weight:700;font-size:15px;margin-bottom:8px;color:var(--text);">Shared to WhereWePraying?</div>'
      + '<div style="font-size:13px;color:var(--text-dim);white-space:pre-wrap;word-break:break-word;margin-bottom:14px;">'+content.replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];})+'</div>'
      + '<button id="shareTargetClose" style="background:var(--coral);color:#fff;border:none;border-radius:10px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;">Close</button></div>';
    document.body.appendChild(box);
    document.getElementById('shareTargetClose').addEventListener('click', function(){
      box.remove();
      history.replaceState({}, '', '/');
    });
  });
})();

// ---- Push notification opt-in (foundation) ----
(function(){
  var VAPID_PUBLIC_KEY = 'BEGcvPtMd1YMXHZBml_Ugb5_mUHmAmP-o3p_WJxqyELkxIoRMM5yFQIMQ8o-u0Fm3uzM9jr0xMMji2SbyH_aWQs';
  var banner = document.getElementById('pushBanner');
  var actionBtn = document.getElementById('pushBannerAction');
  var closeBtn = document.getElementById('pushBannerClose');
  var DISMISS_KEY = 'wwp_push_dismissed_at';

  function urlBase64ToUint8Array(base64String){
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function recentlyDismissed(){
    var t = localStorage.getItem(DISMISS_KEY);
    if(!t) return false;
    return (Date.now() - Number(t)) < 1000*60*60*24*14;
  }
  function maybeShowBanner(){
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if(Notification.permission !== 'default') return;
    if(recentlyDismissed()) return;
    navigator.serviceWorker.ready.then(function(reg){
      return reg.pushManager.getSubscription();
    }).then(function(sub){
      if(sub) return;
      setTimeout(function(){ if(banner){ banner.style.display='flex'; banner.classList.add('show'); } }, 6000);
    }).catch(function(){});
  }
  function subscribe(){
    navigator.serviceWorker.ready.then(function(reg){
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }).then(function(sub){
      var deviceId = (window.WWP && window.WWP.deviceId) ? window.WWP.deviceId : null;
      function send(lat, lon){
        return fetch('/api/push/subscribe', {
          method:'POST',
          headers:Object.assign({'Content-Type':'application/json'}, deviceId?{'X-Device-Id':deviceId}:{}),
          body: JSON.stringify({
            subscription: sub,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
            lat: lat, lon: lon
          })
        });
      }
      if('geolocation' in navigator){
        Platform.getLocation({ timeout: 6000, maximumAge: 600000 }).then(
          function(loc){ send(loc.lat, loc.lon); },
          function(){ send(null, null); }
        );
      } else { send(null, null); }
    }).catch(function(){}).finally(function(){
      if(banner){ banner.classList.add('hide'); setTimeout(function(){ banner.style.display='none'; },300); }
    });
  }
  if(actionBtn) actionBtn.addEventListener('click', function(){
    Notification.requestPermission().then(function(perm){
      if(perm === 'granted') subscribe();
      else { banner.classList.add('hide'); setTimeout(function(){ banner.style.display='none'; },300); }
    });
  });
  if(closeBtn) closeBtn.addEventListener('click', function(){
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    banner.classList.add('hide');
    setTimeout(function(){ banner.style.display='none'; }, 300);
  });
  window.addEventListener('load', maybeShowBanner);
})();

/* ---- footer year (was an inline script at the end of the page) ---- */
document.addEventListener('DOMContentLoaded', function(){
  try{document.getElementById('footerYear').textContent=new Date().getFullYear();}catch(e){}
});

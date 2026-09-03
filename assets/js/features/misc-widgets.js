

/* ===== deferred feature script 21 ===== */
(function(){
/* Qur'an reader — floating "back to top" button. Only relevant while
   scrolling through the ayahs themselves: hidden above the reading pane
   (nothing to scroll back up to yet) and hidden again once scrolled
   past it into the prev/next-surah nav and footer widgets, which
   already have their own "Back to Top" text button. */
(function(){
  var btn = document.getElementById('qrScrollTopBtn');
  var page = document.getElementById('page-quran');
  if(!btn || !page) return;

  var ticking = false;
  function onScroll(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){
      ticking = false;
      if(page.classList.contains('hidden')){ btn.classList.remove('show'); return; }
      var list = document.getElementById('ayahList');
      if(!list){ btn.classList.remove('show'); return; }
      var rect = list.getBoundingClientRect();
      var insideReadingArea = rect.top <= 0 && rect.bottom > 0;
      btn.classList.toggle('show', insideReadingArea);
    });
  }
  window.addEventListener('scroll', onScroll, {passive:true});

  btn.addEventListener('click', function(){
    window.scrollTo({top:0, behavior:'smooth'});
  });
})();

})();

/* ===== deferred feature script 22 ===== */
(function(){
(function(){
  var overlay = document.getElementById('pokeNotifyOverlay');
  var listEl = document.getElementById('pokeNotifyList');
  var closeBtn = document.getElementById('pokeNotifyClose');
  var badgeBtn = document.getElementById('pokeReceivedBadge');
  if(!overlay || !listEl || !closeBtn) return;

  var lastPokes = [];

  // escapeHtml: shared, defined once in wwp-core.js — no local copy needed.

  // Small deterministic colour-initial avatar for pokers without a real
  // profile picture — self-contained here rather than sharing the auth
  // popup's version, since consts/functions inside one script block
  // aren't visible from another.
  function avatarMarkup(poke){
    if(poke.avatarUrl){
      return '<img src="'+poke.avatarUrl+'" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex:none;">';
    }
    var seed = poke.username || 'wwp';
    var hash = 0;
    for(var i=0;i<seed.length;i++) hash = (hash*31 + seed.charCodeAt(i))|0;
    var hue = Math.abs(hash) % 360;
    var initial = (seed.trim()[0] || '?').toUpperCase();
    return '<span style="width:24px;height:24px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:hsl('+hue+',55%,70%);color:#fff;font-size:11px;font-weight:800;">'+initial+'</span>';
  }

  function renderPokeBackBtn(fromUserId){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'poke-notify-back-btn';
    btn.textContent = 'Poke back';
    btn.addEventListener('click', function(){
      btn.disabled = true;
      btn.textContent = 'Poking…';
      fetch('/api/push/poke', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials:'include',
        body: JSON.stringify({ friendUserId: fromUserId })
      })
        .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, status:r.status, data:d}; }); })
        .then(function(res){
          if((res.ok && res.data.success) || res.status===409){ btn.textContent = 'Poked ✓'; }
          else { btn.textContent = 'Poke back'; btn.disabled = false; }
        })
        .catch(function(){ btn.textContent = 'Poke back'; btn.disabled = false; });
    });
    return btn;
  }

  function renderNotifyList(pokes){
    listEl.innerHTML = '';
    pokes.forEach(function(p){
      var item = document.createElement('div');
      item.className = 'poke-notify-item';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'poke-notify-name';
      nameSpan.innerHTML = avatarMarkup(p) + '<span class="pn-name-text">'+escapeHtml(p.username)+'</span><span class="poke-notify-streak">'+p.streakDays+'d</span>';
      item.appendChild(nameSpan);
      item.appendChild(renderPokeBackBtn(p.fromUserId));
      listEl.appendChild(item);
    });
  }

  function openOverlay(){
    overlay.classList.remove('hidden');
    requestAnimationFrame(function(){ overlay.classList.add('show'); });
  }
  function closeOverlay(){
    overlay.classList.remove('show');
    setTimeout(function(){ overlay.classList.add('hidden'); }, 250);
  }
  closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeOverlay(); });

  function updateBadge(){
    if(!badgeBtn) return;
    if(lastPokes.length){
      badgeBtn.textContent = '👋 ' + lastPokes.length;
      badgeBtn.classList.remove('hidden');
    } else {
      badgeBtn.classList.add('hidden');
    }
  }
  if(badgeBtn){
    badgeBtn.addEventListener('click', function(){
      if(!lastPokes.length) return;
      renderNotifyList(lastPokes);
      openOverlay();
    });
  }

  async function checkPokesOnLogin(){
    try{
      var res = await fetch('/api/push/pokes-received', {
        credentials:'include',
        headers:{ 'X-Device-Id': window.WWP?.deviceId || '' }
      });
      if(!res.ok) return;
      var data = await res.json();
      if(!data.pokes || !data.pokes.length) return;

      lastPokes = data.pokes;
      window.WWP_recentPokes = lastPokes;
      updateBadge();
      renderNotifyList(lastPokes);
      openOverlay();
    }catch(e){ console.warn('poke notification check failed', e); }
  }

  document.addEventListener('wwp-auth-ready', function(e){
    if(e.detail && e.detail.authenticated) checkPokesOnLogin();
  });
})();

})();

/* ===== deferred feature script 23 ===== */
(function(){
(function(){
  function revealLampFxWhenLoaded(containers){
    containers.forEach(function(container){
      if(!container) return;
      var imgs = Array.prototype.filter.call(container.children, function(el){ return el.tagName === 'IMG'; });
      var fx = Array.prototype.filter.call(container.children, function(el){ return el.classList && el.classList.contains('wwp-lamp-fx'); });
      if(!imgs.length || !fx.length) return;

      var reveal = function(){ fx.forEach(function(f){ f.classList.add('wwp-loaded'); }); };
      var pending = 0;
      imgs.forEach(function(img){
        if(img.complete) return; // already loaded (cache, or arrived before this ran)
        pending++;
        var done = function(){ pending--; if(pending<=0) reveal(); };
        img.addEventListener('load', done, {once:true});
        img.addEventListener('error', done, {once:true}); // don't hide the glow forever if the image fails
      });
      if(pending===0) reveal();
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    revealLampFxWhenLoaded([
      document.querySelector('.home-hero-art'),
      document.querySelector('.qh-hero-art'),
      document.querySelector('.dd-hero-inner')
    ]);
  });
})();

})();
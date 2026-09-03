
/* ===== deferred feature script 16 ===== */
(function(){
/* ============================================================
   SUPPORTER CHECKOUT :: web-only "support the app" flow via
   Stripe Checkout (hosted page, Apple Pay/Google Pay automatic).
   Deliberately NOT gated behind any feature — pure optional
   support, framed the same way in the UI. Kept out of any future
   native iOS wrapper build (should be excluded/hidden there to
   stay clear of Apple's In-App Purchase requirement — see chat
   notes). Talks to /api/supporter/checkout.
   ============================================================ */
(function(){
  const $ = (id) => document.getElementById(id);

  // deviceHeaders: shared, defined once in wwp-core.js — no local copy needed.

  function showSupporterErr(text){
    const el = $('supporterError');
    if(el){ el.textContent = text; el.classList.remove('hidden'); }
  }

  function render(isSupporter){
    const already = $('supporterAlreadyBox');
    const form = $('supporterForm');
    const intro = $('supporterIntroText');
    if(!already || !form) return;
    already.classList.toggle('hidden', !isSupporter);
    form.classList.toggle('hidden', isSupporter);
    if(intro) intro.classList.toggle('hidden', isSupporter);
  }

  document.querySelectorAll('input[name="supporterAmount"]').forEach(radio=>{
    radio.addEventListener('change', ()=>{
      $('supporterCustomAmount')?.classList.toggle('hidden', radio.value !== 'custom' || !radio.checked);
    });
  });

  $('supporterCheckoutBtn')?.addEventListener('click', async ()=>{
    const authed = window.WWP_getAuthState && window.WWP_getAuthState().authenticated;
    if(!authed){ showSupporterErr('Sign in first to support the app.'); return; }

    const modeInput = document.querySelector('input[name="supporterMode"]:checked');
    const amountInput = document.querySelector('input[name="supporterAmount"]:checked');
    const mode = modeInput ? modeInput.value : 'payment';
    let amount = amountInput ? amountInput.value : '5';
    if(amount === 'custom'){
      amount = ($('supporterCustomAmount')?.value || '').trim();
    }
    amount = Number(amount);
    if(!Number.isFinite(amount) || amount < 1){
      showSupporterErr('Please enter a valid amount.');
      return;
    }

    const btn = $('supporterCheckoutBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Redirecting…';

    try{
      const res = await fetch('/api/supporter/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount, mode })
      });
      const data = await res.json();
      if(!res.ok || !data.url){
        showSupporterErr(data.error || 'Could not start checkout.');
        return;
      }
      window.location.href = data.url;
    }catch(e){
      showSupporterErr('Network error. Please try again.');
    }finally{
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  window.WWP_Supporter = { render };

  // Post-checkout redirect handling.
  const params = new URLSearchParams(location.search);
  if(params.get('supporter_success') === '1'){
    showToast("Jazakhallah khair — you're now a Supporter! 🤍");
    history.replaceState({}, '', location.pathname);
  } else if(params.get('supporter_cancel') === '1'){
    history.replaceState({}, '', location.pathname);
  }
})();

})();
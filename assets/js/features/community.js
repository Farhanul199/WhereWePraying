
/* ===== deferred feature script 13 ===== */
(function(){
/* ============================================================
   THE COMMUNITY IDEAS :: feature-request feed with upvotes,
   comments/replies, and a signed-in-only masjid photo submission
   flow that lands in an admin approval queue (see admin/broadcast.html)
   before ever reaching Find a Mosque. Talks to /api/community/*.
   ============================================================ */
(function(){
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // deviceHeaders: shared, defined once in wwp-core.js — no local copy needed.

  function isSignedIn(){
    const s = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
    return !!(s && s.authenticated);
  }

  // escapeHtml: shared, defined once in wwp-core.js — no local copy needed.

  function timeAgo(ts){
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if(s < 60) return 'just now';
    const m = Math.floor(s/60); if(m < 60) return m+'m ago';
    const h = Math.floor(m/60); if(h < 24) return h+'h ago';
    const dd = Math.floor(h/24); if(dd < 30) return dd+'d ago';
    return new Date(ts).toLocaleDateString();
  }

  // ---- Tabs ----
  $$('.cm-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      if(tab.classList.contains('cm-tab-disabled')){
        showToast("Masjid photo submissions are paused for now — coming back soon.");
        return;
      }
      $$('.cm-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.cmtab;
      $('#cmPanelIdeas').classList.toggle('active', target==='ideas');
      $('#cmPanelBugs').classList.toggle('active', target==='bugs');
      $('#cmPanelPhotos')?.classList.toggle('active', target==='photos');
      if(target==='bugs') loadMyBugs();
      if(target==='photos') loadMyPhotos();
    });
  });

  // ---- Sign-in gating ----
  function refreshSignInNotes(){
    const signed = isSignedIn();
    $('#cmSigninNoteIdeas')?.classList.toggle('hidden', signed);
    $('#cmSigninNotePhotos')?.classList.toggle('hidden', signed);
    $('#cmSigninNoteBugs')?.classList.toggle('hidden', signed);
  }
  function openSignIn(){
    if (window.WWP_promptSignIn) { window.WWP_promptSignIn(); return; }
    if (window.AuthSystem && window.AuthSystem.toggleAuthPopup) { window.AuthSystem.toggleAuthPopup(); return; }
    console.warn('Sign-in popup unavailable — WWP_promptSignIn/AuthSystem not yet loaded.');
  }
  $('#cmSignInBtnIdeas')?.addEventListener('click', openSignIn);
  $('#cmSignInBtnPhotos')?.addEventListener('click', openSignIn);
  $('#cmSignInBtnBugs')?.addEventListener('click', openSignIn);
  document.addEventListener('wwp-auth-ready', refreshSignInNotes);
  // Covers direct navigation (e.g. reloading on /community-ideas) where the
  // data-page click listener never fires. window.WWP_authState is set
  // synchronously once checkSession() resolves, so if it's already
  // available by the time this script runs, reflect it immediately;
  // 'wwp-auth-ready' above still covers the case where it resolves later.
  if (window.WWP_authState) refreshSignInNotes();

  // ---- New idea form ----
  $('#cmNewIdeaToggle')?.addEventListener('click', ()=>{
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    $('#cmNewIdeaForm').classList.toggle('hidden');
  });
  $('#cmCancelIdeaBtn')?.addEventListener('click', ()=>{
    $('#cmNewIdeaForm').classList.add('hidden');
    $('#cmIdeaTitle').value = '';
    $('#cmIdeaBody').value = '';
  });
  $('#cmSubmitIdeaBtn')?.addEventListener('click', async ()=>{
    const title = $('#cmIdeaTitle').value.trim();
    const body = $('#cmIdeaBody').value.trim();
    if(!title){ showToast('Give your idea a short title.'); return; }
    const btn = $('#cmSubmitIdeaBtn');
    btn.disabled = true; btn.textContent = 'Posting…';
    try{
      const res = await fetch('/api/community/ideas', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not post idea.'); return; }
      $('#cmIdeaTitle').value = ''; $('#cmIdeaBody').value = '';
      $('#cmNewIdeaForm').classList.add('hidden');
      showToast('Idea posted — jazakAllah khair!');
      loadIdeas();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Post idea';
    }
  });

  // ---- Ideas list ----
  function ideaCardHTML(idea){
    const voted = !!idea.voted;
    return `
    <div class="cm-card" data-idea-id="${idea.id}">
      <div class="cm-idea-title">${escapeHtml(idea.title)}</div>
      ${idea.body ? `<div class="cm-idea-body">${escapeHtml(idea.body)}</div>` : ''}
      <div class="cm-idea-meta">
        <button class="cm-vote-btn${voted?' voted':''}" data-action="vote" data-id="${idea.id}" aria-label="${voted?'Remove upvote':'Upvote this idea'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          <span data-role="votecount">${idea.votes}</span>
        </button>
        <button class="cm-comment-toggle" data-action="toggle-comments" data-id="${idea.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"/></svg>
          <span data-role="commentcount">${idea.commentCount || 0}</span> comments
        </button>
        <span class="cm-author">${escapeHtml(idea.username || 'Someone')} · ${timeAgo(idea.created_at)}</span>
      </div>
      <div class="cm-comments" id="cmComments-${idea.id}">
        <div class="cm-comment-list" id="cmCommentList-${idea.id}"><span style="font-size:12.5px;color:var(--text-dim);">Loading…</span></div>
        <div class="cm-comment-form" id="cmCommentForm-${idea.id}">
          <input type="text" placeholder="${isSignedIn() ? 'Add a comment…' : 'Sign in to comment'}" ${isSignedIn() ? '' : 'disabled'} data-role="comment-input">
          <button class="cm-btn" data-action="post-comment" data-id="${idea.id}">Post</button>
        </div>
      </div>
    </div>`;
  }

  async function loadIdeas(){
    const list = $('#cmIdeasList');
    if(!list) return;
    try{
      const res = await fetch('/api/community/ideas', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const ideas = data.ideas || [];
      if(!ideas.length){
        list.innerHTML = `<div class="cm-empty">No ideas yet — be the first to share one!</div>`;
        return;
      }
      list.innerHTML = ideas.map(ideaCardHTML).join('');
    }catch(e){
      list.innerHTML = `<div class="cm-empty">Couldn't load ideas right now.</div>`;
    }
  }

  function isModerator(){
    const s = window.WWP_getAuthState ? window.WWP_getAuthState() : null;
    return !!(s && (s.role === 'admin' || s.role === 'moderator'));
  }

  function modDeleteBtn(commentId){
    if(!isModerator()) return '';
    return `<button class="cm-mod-delete" data-action="delete-comment" data-comment="${commentId}" title="Remove this comment" aria-label="Remove this comment">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>
    </button>`;
  }

  function commentHTML(c, ideaId){
    return `
    <div class="cm-comment" data-comment-id="${c.id}">
      <div class="cm-comment-author">${escapeHtml(c.username || 'Someone')} <span style="font-weight:400;color:var(--text-dim);">· ${timeAgo(c.created_at)}</span>${modDeleteBtn(c.id)}</div>
      <div class="cm-comment-body">${escapeHtml(c.body)}</div>
      <button class="cm-reply-btn" data-action="show-reply" data-id="${ideaId}" data-parent="${c.id}">Reply</button>
      <div class="cm-reply-row hidden" id="cmReplyRow-${c.id}">
        <div class="cm-comment-form">
          <input type="text" placeholder="Write a reply…" data-role="comment-input">
          <button class="cm-btn" data-action="post-comment" data-id="${ideaId}" data-parent="${c.id}">Reply</button>
        </div>
      </div>
      <div class="cm-reply-row" data-role="replies-${c.id}">
        ${(c.replies || []).map(r => `
          <div class="cm-comment">
            <div class="cm-comment-author">${escapeHtml(r.username || 'Someone')} <span style="font-weight:400;color:var(--text-dim);">· ${timeAgo(r.created_at)}</span>${modDeleteBtn(r.id)}</div>
            <div class="cm-comment-body">${escapeHtml(r.body)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  async function loadComments(ideaId){
    const holder = $('#cmCommentList-'+ideaId);
    if(!holder) return;
    try{
      const res = await fetch('/api/community/ideas?commentsFor='+ideaId, { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const comments = data.comments || [];
      holder.innerHTML = comments.length
        ? comments.map(c => commentHTML(c, ideaId)).join('')
        : `<div style="font-size:12.5px;color:var(--text-dim);">No comments yet.</div>`;
    }catch(e){
      holder.innerHTML = `<div style="font-size:12.5px;color:var(--text-dim);">Couldn't load comments.</div>`;
    }
  }

  async function postComment(ideaId, input, parentId){
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    const body = input.value.trim();
    if(!body) return;
    input.disabled = true;
    try{
      const res = await fetch('/api/community/ideas', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'comment', ideaId, parentId: parentId || null, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not post comment.'); return; }
      input.value = '';
      loadComments(ideaId);
      const idea = $(`.cm-card[data-idea-id="${ideaId}"]`);
      const cc = idea?.querySelector('[data-role="commentcount"]');
      if(cc) cc.textContent = String((parseInt(cc.textContent, 10) || 0) + 1);
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      input.disabled = false;
    }
  }

  $('#cmIdeasList')?.addEventListener('click', (e)=>{
    const voteBtn = e.target.closest('[data-action="vote"]');
    if(voteBtn){
      if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
      const id = voteBtn.dataset.id;
      fetch('/api/community/ideas', {
        method: 'POST', credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'vote', ideaId: id })
      }).then(r=>r.json()).then(data=>{
        if(data.error){ showToast(data.error); return; }
        voteBtn.classList.toggle('voted', data.voted);
        voteBtn.querySelector('[data-role="votecount"]').textContent = data.votes;
      }).catch(()=> showToast('Network error. Please try again.'));
      return;
    }
    const toggleBtn = e.target.closest('[data-action="toggle-comments"]');
    if(toggleBtn){
      const id = toggleBtn.dataset.id;
      const panel = $('#cmComments-'+id);
      const nowOpen = panel.classList.toggle('open');
      if(nowOpen) loadComments(id);
      return;
    }
    const postBtn = e.target.closest('[data-action="post-comment"]');
    if(postBtn){
      const id = postBtn.dataset.id;
      const parent = postBtn.dataset.parent || null;
      const input = postBtn.previousElementSibling;
      postComment(id, input, parent);
      return;
    }
    const replyBtn = e.target.closest('[data-action="show-reply"]');
    if(replyBtn){
      if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
      const row = $('#cmReplyRow-'+replyBtn.dataset.parent);
      row?.classList.toggle('hidden');
      return;
    }
    const delBtn = e.target.closest('[data-action="delete-comment"]');
    if(delBtn){
      if(!confirm('Remove this comment? This can\'t be undone.')) return;
      delBtn.disabled = true;
      fetch('/api/community/ideas', {
        method: 'POST', credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'delete-comment', commentId: delBtn.dataset.comment })
      }).then(r=>r.json()).then(data=>{
        if(data.error){ showToast(data.error); delBtn.disabled = false; return; }
        delBtn.closest('.cm-comment')?.remove();
        showToast('Comment removed.');
      }).catch(()=>{ showToast('Network error. Please try again.'); delBtn.disabled = false; });
      return;
    }
  });

  // ---- Masjid photo submission ----
  let selectedPhotoFile = null;
  $('#cmPhotoInput')?.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    selectedPhotoFile = file;
    $('#cmPhotoLabel').textContent = file.name.length > 28 ? file.name.slice(0,25)+'…' : file.name;
    const preview = $('#cmPhotoPreview');
    const reader = new FileReader();
    reader.onload = () => { preview.src = reader.result; preview.style.display = 'block'; };
    reader.readAsDataURL(file);
  });

  $('#cmSubmitPhotoBtn')?.addEventListener('click', async ()=>{
    if(!isSignedIn()){ window.WWP_promptSignIn && window.WWP_promptSignIn(); return; }
    if(!selectedPhotoFile){ showToast('Choose a photo first.'); return; }
    const btn = $('#cmSubmitPhotoBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try{
      const fd = new FormData();
      fd.append('photo', selectedPhotoFile);
      fd.append('masjidName', $('#cmMasjidName').value.trim());
      fd.append('note', $('#cmPhotoNote').value.trim());
      const res = await fetch('/api/community/photos', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders(),
        body: fd
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Upload failed.'); return; }
      showToast('Photo submitted — thanks! It\'ll appear once reviewed.');
      selectedPhotoFile = null;
      $('#cmPhotoInput').value = '';
      $('#cmPhotoPreview').style.display = 'none';
      $('#cmPhotoLabel').textContent = 'Take or choose a photo';
      $('#cmMasjidName').value = ''; $('#cmPhotoNote').value = '';
      loadMyPhotos();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Submit for review';
    }
  });

  async function loadMyPhotos(){
    if(!isSignedIn()) return;
    const holder = $('#cmMyPhotosList');
    if(!holder) return;
    try{
      const res = await fetch('/api/community/photos', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const photos = data.photos || [];
      if(!photos.length){ holder.innerHTML = ''; return; }
      holder.innerHTML = `<div style="font-size:12.5px;font-weight:700;color:var(--text-dim);margin:6px 0 10px;">Your submissions</div>` +
        photos.map(p => `
          <div class="cm-card" style="display:flex;align-items:center;gap:12px;">
            <img src="${escapeHtml(p.url)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px;flex:none;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHtml(p.masjid_name || 'Unnamed masjid')}</div>
              <div style="font-size:11.5px;color:var(--text-dim);">${timeAgo(p.created_at)}</div>
            </div>
            <span class="cm-photo-status ${p.status}">${p.status}</span>
          </div>`).join('');
    }catch(e){ /* silent */ }
  }

  // ---- Bug reports ----
  $('#cmSubmitBugBtn')?.addEventListener('click', async ()=>{
    if(!isSignedIn()){ openSignIn(); return; }
    const title = $('#cmBugTitle').value.trim();
    const body = $('#cmBugBody').value.trim();
    if(!title){ showToast('Give a short summary of the bug first.'); return; }
    const btn = $('#cmSubmitBugBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try{
      const res = await fetch('/api/community/bugs', {
        method: 'POST',
        credentials: 'include',
        headers: deviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, body })
      });
      const data = await res.json();
      if(!res.ok){ showToast(data.error || 'Could not submit bug report.'); return; }
      $('#cmBugTitle').value = ''; $('#cmBugBody').value = '';
      showToast('Bug report sent — jazakAllah khair!');
      loadMyBugs();
    }catch(e){
      showToast('Network error. Please try again.');
    }finally{
      btn.disabled = false; btn.textContent = 'Submit bug report';
    }
  });

  async function loadMyBugs(){
    const holder = $('#cmMyBugsList');
    if(!holder) return;
    try{
      const res = await fetch('/api/community/bugs', { credentials: 'include', headers: deviceHeaders() });
      const data = await res.json();
      const bugs = data.bugs || [];
      if(!bugs.length){ holder.innerHTML = `<div class="cm-empty">No bugs reported yet — you're either very lucky or very forgiving.</div>`; return; }
      holder.innerHTML = bugs.map(b => `
          <div class="cm-card">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
              <div style="font-weight:700;font-size:13px;color:var(--text);">${escapeHtml(b.title)}</div>
              <span class="cm-photo-status ${b.status}">${b.status}</span>
            </div>
            ${b.body ? `<div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;white-space:pre-wrap;">${escapeHtml(b.body)}</div>` : ''}
            <div style="font-size:11.5px;color:var(--text-dim);margin-top:6px;">${escapeHtml(b.username || 'Someone')} · ${timeAgo(b.created_at)}</div>
          </div>`).join('');
    }catch(e){ holder.innerHTML = `<div class="cm-empty">Couldn't load bug reports right now.</div>`; }
  }

  // ---- Init whenever the Community page becomes visible ----
  // Covers: clicking the nav icon, a direct load/refresh landing on
  // /community-ideas, and browser back/forward — not just the click
  // case, which was the original bug (data never loaded on refresh).
  let cmInitialized = false;
  function onCommunityShown(){
    refreshSignInNotes();
    cmInitialized = true;
    loadIdeas();
    if($('#cmPanelBugs')?.classList.contains('active')) loadMyBugs();
    if($('#cmPanelPhotos')?.classList.contains('active')) loadMyPhotos();
  }
  document.querySelectorAll('a[data-page="community"]').forEach(a=>{
    a.addEventListener('click', onCommunityShown);
  });
  window.addEventListener('wwp-page-shown', (e)=>{
    if(e.detail && e.detail.id === 'community') onCommunityShown();
  });
  // Covers the very first page load landing directly on /community-ideas:
  // switchPage() already ran (earlier in the document) before this
  // listener above existed, so check current visibility once at parse time.
  if(!document.getElementById('page-community')?.classList.contains('hidden')){
    onCommunityShown();
  }

  // ---- Keep-fresh polling ----
  // API responses are always fetched live (see /api/community/* — no
  // caching), but without this, someone else's new idea/comment/bug report
  // only ever shows up if you switch tabs or reload. Refresh the panel
  // that's actually on screen every 20s while Community is open and the
  // browser tab is visible, plus immediately when you switch back to this
  // browser tab after being away.
  function refreshActiveCmPanel(){
    const communityShown = !document.getElementById('page-community')?.classList.contains('hidden');
    if(!communityShown || document.visibilityState !== 'visible') return;
    if($('#cmPanelIdeas')?.classList.contains('active')) loadIdeas();
    else if($('#cmPanelBugs')?.classList.contains('active')) loadMyBugs();
  }
  setInterval(refreshActiveCmPanel, 20000);
  document.addEventListener('visibilitychange', refreshActiveCmPanel);
})();

})();
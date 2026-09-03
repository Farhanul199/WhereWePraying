
/* ===== deferred feature script 12 ===== */
(function(){
// Auth System: Popup logic + Session management
(function() {
  const AUTH_POPUP_ID = 'accountPopup';
  const EMAIL_INPUT_ID = 'authEmailInput';
  const SEND_LINK_BTN_ID = 'sendMagicLinkBtn';
  const SIGN_OUT_BTN_ID = 'signOutBtn';
  const CLOSE_POPUP_BTN_ID = 'closeAuthPopupBtn';
  const ACCOUNT_BTN_SELECTOR = '.topbar-icons button[title="Account"]';

  let authState = { authenticated: false, email: null, role: null };

  const $ = (sel) => sel.startsWith('#') || sel.startsWith('.') ? document.querySelector(sel) : document.getElementById(sel);

  async function init() {
    await checkSession();
    setupEventListeners();
    handleVerifyRedirect();
    handleGoogleRedirect();
  }

  function handleGoogleRedirect() {
    const result = window.__wwpGoogleAuthResult;
    if (!result) return;

    if (result.signedIn) {
      // checkSession() above already picked up the session cookie the
      // callback set server-side, so authState is current — just confirm.
      showAuthToast("You're signed in!", 'success');
    } else if (result.error) {
      showAuthToast('Google sign-in failed. Please try again.', 'error');
    }
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/session', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' }
      });
      const data = await res.json();

      if (data.authenticated) {
        authState = { authenticated: true, email: data.email, userId: data.userId, role: data.role || 'user' };
        renderAuthUI('signed-in');
      } else {
        authState = { authenticated: false, email: null, role: null };
        renderAuthUI('sign-in');
      }
      window.WWP_authState = authState;
      document.dispatchEvent(new CustomEvent('wwp-auth-ready', { detail: authState }));
    } catch (err) {
      console.error('checkSession error:', err);
      renderAuthUI('sign-in');
    }
  }

  function renderAuthUI(state) {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (!popup) return;

    const signedInDiv = popup.querySelector('.auth-popup-signed-in');
    const signInDiv = popup.querySelector('.auth-popup-sign-in');
    const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);

    if (state === 'signed-in') {
      signedInDiv.classList.remove('hidden');
      signInDiv.classList.add('hidden');
      const emailSpan = popup.querySelector('#authPopupEmail');
      if (emailSpan) emailSpan.textContent = authState.email;
      loadProfile();
      loadSettingsLocation();
      if (accountBtn) accountBtn.classList.add('account-signed-in');
    } else {
      signedInDiv.classList.add('hidden');
      signInDiv.classList.remove('hidden');
      if (accountBtn) accountBtn.classList.remove('account-signed-in');
    }
  }

  async function loadProfile() {
    try {
      const res = await fetch('/api/user/profile', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      const input = document.getElementById('usernameInput');
      const saveBtn = document.getElementById('saveUsernameBtn');
      const msgEl = document.getElementById('usernameMessage');

      if (input && data.username) input.value = data.username;

      if (data.username && data.canChangeUsername === false) {
        if (input) input.disabled = true;
        if (saveBtn) saveBtn.disabled = true;
        if (msgEl) {
          msgEl.textContent = "You've already used your one username change.";
          msgEl.classList.remove('hidden');
        }
      } else {
        if (input) input.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
      }

      const recoveryInput = document.getElementById('recoveryEmailInput');
      if (recoveryInput) recoveryInput.value = data.recoveryEmail || '';

      const notifyToggle = document.getElementById('notifyFriendRequestsToggle');
      if (notifyToggle) notifyToggle.checked = !!data.notifyFriendRequests;

      if (window.WWP_Supporter) window.WWP_Supporter.render(!!data.isSupporter);
    } catch (e) {
      console.error('loadProfile error:', e);
    }
  }

  function loadSettingsLocation() {
    const labelEl = document.getElementById('settingsLocationLabel');
    if (!labelEl) return;
    try {
      const raw = localStorage.getItem('wwp:prayertimes:location');
      if (raw) {
        const loc = JSON.parse(raw);
        labelEl.textContent = loc.label || (loc.lat + ', ' + loc.lon);
        return;
      }
    } catch (e) {}
    labelEl.textContent = 'Not set';
  }

  function setupEventListeners() {
    const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);
    if (accountBtn) {
      accountBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAuthPopup();
      });
    }

    const sendBtn = document.getElementById(SEND_LINK_BTN_ID);
    if (sendBtn) sendBtn.addEventListener('click', sendMagicLink);

    const signOutBtn = document.getElementById(SIGN_OUT_BTN_ID);
    if (signOutBtn) signOutBtn.addEventListener('click', signOut);
    wireDeleteAccountUI();

    const closeBtn = document.getElementById(CLOSE_POPUP_BTN_ID);
    if (closeBtn) closeBtn.addEventListener('click', closeAuthPopup);

    document.addEventListener('click', (e) => {
      const popup = document.getElementById(AUTH_POPUP_ID);
      const accountBtn = document.querySelector(ACCOUNT_BTN_SELECTOR);
      if (popup && !popup.contains(e.target) && e.target !== accountBtn && !accountBtn?.contains(e.target)) {
        closeAuthPopup();
      }
    });

    const emailInput = document.getElementById(EMAIL_INPUT_ID);
    if (emailInput) {
      emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMagicLink();
      });
    }

    const tabAccount = document.getElementById('authTabAccount');
    const tabSettings = document.getElementById('authTabSettings');
    if (tabAccount) tabAccount.addEventListener('click', () => switchAuthTab('account'));
    if (tabSettings) tabSettings.addEventListener('click', () => switchAuthTab('settings'));

    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    if (saveUsernameBtn) saveUsernameBtn.addEventListener('click', saveUsername);

    const usernameInput = document.getElementById('usernameInput');
    if (usernameInput) {
      usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveUsername();
      });
    }

    const manageLocationBtn = document.getElementById('manageLocationBtn');
    if (manageLocationBtn) {
      manageLocationBtn.addEventListener('click', () => {
        closeAuthPopup();
        if (typeof window.switchPage === 'function') window.switchPage('prayertimes');
      });
    }

    const saveRecoveryEmailBtn = document.getElementById('saveRecoveryEmailBtn');
    if (saveRecoveryEmailBtn) saveRecoveryEmailBtn.addEventListener('click', saveRecoveryEmail);

    const recoveryEmailInput = document.getElementById('recoveryEmailInput');
    if (recoveryEmailInput) {
      recoveryEmailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRecoveryEmail();
      });
    }

    const notifyToggle = document.getElementById('notifyFriendRequestsToggle');
    if (notifyToggle) {
      notifyToggle.addEventListener('change', async () => {
        try {
          await fetch('/api/user/profile', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Device-Id': window.WWP?.deviceId || '',
            },
            credentials: 'include',
            body: JSON.stringify({ notifyFriendRequests: notifyToggle.checked }),
          });
        } catch (e) {
          console.error('notifyFriendRequests toggle error:', e);
        }
      });
    }

    const tabFriends = document.getElementById('authTabFriends');
    if (tabFriends) tabFriends.addEventListener('click', () => switchAuthTab('friends'));

    const addFriendBtn = document.getElementById('addFriendBtn');
    if (addFriendBtn) addFriendBtn.addEventListener('click', addFriend);

    const addFriendInput = document.getElementById('addFriendInput');
    if (addFriendInput) {
      addFriendInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addFriend();
      });
    }

    const copyFriendCodeBtn = document.getElementById('copyFriendCodeBtn');
    if (copyFriendCodeBtn) {
      copyFriendCodeBtn.addEventListener('click', () => {
        const label = document.getElementById('friendCodeLabel');
        const code = label?.textContent?.trim();
        if (!code || code === '—') return;
        navigator.clipboard?.writeText(code);
        const original = copyFriendCodeBtn.textContent;
        copyFriendCodeBtn.textContent = 'Copied!';
        setTimeout(() => { copyFriendCodeBtn.textContent = original; }, 1500);
      });
    }

    const toggleGlobalBtn = document.getElementById('toggleGlobalBtn');
    if (toggleGlobalBtn) {
      toggleGlobalBtn.addEventListener('click', () => {
        const listEl = document.getElementById('globalLeaderboardList');
        const isHidden = listEl.classList.contains('hidden');
        if (isHidden) {
          listEl.classList.remove('hidden');
          toggleGlobalBtn.textContent = 'Hide Global Top 100';
          loadGlobalLeaderboard();
        } else {
          listEl.classList.add('hidden');
          toggleGlobalBtn.textContent = 'Show Global Top 100';
        }
      });
    }
  }

  function switchAuthTab(tab) {
    const tabAccount = document.getElementById('authTabAccount');
    const tabSettings = document.getElementById('authTabSettings');
    const tabFriends = document.getElementById('authTabFriends');
    const panelAccount = document.getElementById('authPanelAccount');
    const panelSettings = document.getElementById('authPanelSettings');
    const panelFriends = document.getElementById('authPanelFriends');

    [tabAccount, tabSettings, tabFriends].forEach((t) => t?.classList.remove('active'));
    [panelAccount, panelSettings, panelFriends].forEach((p) => p?.classList.add('hidden'));

    if (tab === 'settings') {
      tabSettings.classList.add('active');
      panelSettings.classList.remove('hidden');
      loadSettingsLocation();
    } else if (tab === 'friends') {
      tabFriends.classList.add('active');
      panelFriends.classList.remove('hidden');
      loadFriends();
      loadLeaderboard();
      loadFollowers();
    } else {
      tabAccount.classList.add('active');
      panelAccount.classList.remove('hidden');
    }
  }

  async function loadFriends() {
    const codeLabel = document.getElementById('friendCodeLabel');
    const listEl = document.getElementById('friendList');
    const incomingSection = document.getElementById('friendIncomingSection');
    const incomingListEl = document.getElementById('friendIncomingList');

    try {
      const res = await fetch('/api/friends', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) return;

      if (codeLabel) codeLabel.textContent = data.code || '—';

      if (incomingListEl) {
        incomingListEl.innerHTML = '';
        if (data.incoming && data.incoming.length) {
          incomingSection?.classList.remove('hidden');
          data.incoming.forEach((req) => {
            const item = document.createElement('div');
            item.className = 'auth-friend-item';
            item.innerHTML = `<span class="auth-friend-item-name">${renderAvatarAndName(req)}</span>`;
            const actions = document.createElement('div');
            actions.className = 'auth-friend-item-actions';

            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'auth-btn auth-btn-primary auth-btn-tiny';
            acceptBtn.textContent = 'Accept';
            acceptBtn.addEventListener('click', () => respondToRequest(req.requestId, 'accept'));

            const declineBtn = document.createElement('button');
            declineBtn.className = 'auth-btn auth-btn-secondary auth-btn-tiny';
            declineBtn.textContent = 'Decline';
            declineBtn.addEventListener('click', () => respondToRequest(req.requestId, 'decline'));

            actions.appendChild(acceptBtn);
            actions.appendChild(declineBtn);
            item.appendChild(actions);
            incomingListEl.appendChild(item);
          });
        } else {
          incomingSection?.classList.add('hidden');
        }
      }

      if (listEl) {
        listEl.innerHTML = '';
        if (data.friends && data.friends.length) {
          data.friends.forEach((f) => {
            const item = document.createElement('div');
            item.className = 'auth-friend-item';
            item.innerHTML = `<span class="auth-friend-item-name">${renderAvatarAndName(f)}</span>`;
            const removeBtn = document.createElement('button');
            removeBtn.className = 'auth-btn auth-btn-secondary auth-btn-tiny';
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => removeFriend(f.id));
            item.appendChild(removeBtn);
            listEl.appendChild(item);
          });
        } else {
          listEl.innerHTML = '<span class="auth-popup-text">No friends yet.</span>';
        }
      }
    } catch (e) {
      console.error('loadFriends error:', e);
    }
  }

  async function loadLeaderboard() {
    const listEl = document.getElementById('leaderboardList');
    if (!listEl) return;

    try {
      const res = await fetch('/api/leaderboard', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) return;

      listEl.innerHTML = '';

      if (!data.entries || data.entries.length <= 1) {
        listEl.innerHTML = '<span class="auth-popup-text">Add friends to see the leaderboard.</span>';
        return;
      }

      data.entries.forEach((entry, i) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';
        const rank = i + 1;
        const extra = entry.isYou ? ' (You)' : '';
        item.innerHTML = `<span class="auth-friend-item-name">#${rank} ${renderAvatarAndName(entry, extra)}</span><span>${entry.score}</span>`;
        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadLeaderboard error:', e);
    }
  }

  async function loadFollowers() {
    const sectionEl = document.getElementById('followersSection');
    const listEl = document.getElementById('followersList');
    if (!sectionEl || !listEl) return;

    try {
      const res = await fetch('/api/follow', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok || !data.followers || !data.followers.length) {
        sectionEl.classList.add('hidden');
        return;
      }

      sectionEl.classList.remove('hidden');
      listEl.innerHTML = '';

      data.followers.forEach((f) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'auth-friend-item-name';
        nameSpan.innerHTML = `<span class="af-target" data-user-id="${f.userId}" title="Send friend request">${renderAvatarAndName(f)}</span>`;
        const afTarget = nameSpan.querySelector('.af-target');
        if (afTarget) afTarget.addEventListener('click', () => sendFriendRequestTo(f.userId, afTarget));
        item.appendChild(nameSpan);

        if (f.followingBack) {
          const badge = document.createElement('span');
          badge.className = 'auth-popup-text';
          badge.textContent = 'Following';
          item.appendChild(badge);
        } else {
          const followBackBtn = document.createElement('button');
          followBackBtn.className = 'auth-btn auth-btn-primary auth-btn-tiny';
          followBackBtn.textContent = 'Follow Back';
          followBackBtn.addEventListener('click', () => {
            followBackBtn.disabled = true;
            fetch('/api/follow', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-Id': window.WWP?.deviceId || '',
              },
              credentials: 'include',
              body: JSON.stringify({ action: 'follow', targetUserId: f.userId }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.success) {
                  item.removeChild(followBackBtn);
                  const badge = document.createElement('span');
                  badge.className = 'auth-popup-text';
                  badge.textContent = 'Following';
                  item.appendChild(badge);
                  loadLeaderboard();
                }
              })
              .catch((e) => console.error('followBack error:', e))
              .finally(() => { followBackBtn.disabled = false; });
          });
          item.appendChild(followBackBtn);
        }

        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadFollowers error:', e);
      sectionEl.classList.add('hidden');
    }
  }

  async function loadGlobalLeaderboard() {
    const listEl = document.getElementById('globalLeaderboardList');
    if (!listEl) return;

    listEl.innerHTML = '<span class="auth-popup-text">Loading…</span>';

    try {
      const res = await fetch('/api/leaderboard/global', {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
      });
      const data = await res.json();
      if (!res.ok) {
        listEl.innerHTML = '<span class="auth-popup-text">Could not load rankings.</span>';
        return;
      }

      listEl.innerHTML = '';

      if (!data.entries || !data.entries.length) {
        listEl.innerHTML = '<span class="auth-popup-text">No scores yet.</span>';
        return;
      }

      data.entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'auth-friend-item';
        const extra = entry.isYou ? ' (You)' : '';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'auth-friend-item-name';
        const avatarHtml = renderAvatarAndName(entry, extra);
        nameSpan.innerHTML = entry.isYou
          ? `#${entry.rank} ${avatarHtml} — ${entry.score}`
          : `#${entry.rank} <span class="af-target" data-user-id="${entry.userId}" title="Send friend request">${avatarHtml}</span> — ${entry.score}`;
        item.appendChild(nameSpan);

        if (!entry.isYou) {
          const afTarget = nameSpan.querySelector('.af-target');
          if (afTarget) afTarget.addEventListener('click', () => sendFriendRequestTo(entry.userId, afTarget));

          const followBtn = document.createElement('button');
          followBtn.className = 'auth-btn auth-btn-tiny ' + (entry.isFollowing ? 'auth-btn-secondary' : 'auth-btn-primary');
          followBtn.textContent = entry.isFollowing ? 'Following' : 'Follow';
          followBtn.dataset.following = entry.isFollowing ? 'true' : 'false';
          followBtn.addEventListener('click', () => toggleFollow(entry.userId, followBtn));
          item.appendChild(followBtn);
        }

        listEl.appendChild(item);
      });
    } catch (e) {
      console.error('loadGlobalLeaderboard error:', e);
      listEl.innerHTML = '<span class="auth-popup-text">Could not load rankings.</span>';
    }
  }

  async function toggleFollow(targetUserId, buttonEl) {
    // Read current state from the button itself rather than a value
    // captured when the listener was first attached — otherwise every
    // click after the first re-sends the same original action (e.g.
    // "Following" never actually unfollows on a second click).
    const currentlyFollowing = buttonEl.dataset.following === 'true';
    const action = currentlyFollowing ? 'unfollow' : 'follow';
    buttonEl.disabled = true;

    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action, targetUserId }),
      });
      const data = await res.json();

      if (res.ok) {
        buttonEl.dataset.following = data.following ? 'true' : 'false';
        buttonEl.textContent = data.following ? 'Following' : 'Follow';
        buttonEl.className = 'auth-btn auth-btn-tiny ' + (data.following ? 'auth-btn-secondary' : 'auth-btn-primary');
        loadLeaderboard(); // personal ranking now includes/excludes this user
      }
    } catch (e) {
      console.error('toggleFollow error:', e);
    } finally {
      buttonEl.disabled = false;
    }
  }

  async function sendFriendRequestTo(targetUserId, wrapperEl) {
    if (wrapperEl.dataset.requested === 'true') return;
    wrapperEl.dataset.requested = 'true';
    const prevTitle = wrapperEl.title;
    wrapperEl.title = 'Sending friend request…';

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'add', targetUserId }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        wrapperEl.title = 'Friend request sent';
      } else {
        // Already friends / already pending isn't a failure worth
        // retrying — leave it marked as requested either way.
        wrapperEl.title = data.error || 'Friend request sent';
      }
    } catch (e) {
      console.error('sendFriendRequestTo error:', e);
      wrapperEl.dataset.requested = 'false';
      wrapperEl.title = prevTitle;
    }
  }

  // escapeHtml: shared, defined once in wwp-core.js — no local copy needed.

  // Deterministic watercolour-style avatar for anyone without a real
  // profile picture (i.e. not signed in via Google) — same seed always
  // produces the same soft gradient blob, so it feels personal rather
  // than random on every render.
  function generateAvatarDataUri(seed) {
    seed = String(seed || 'wwp');
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    const abs = Math.abs(hash);
    const hue1 = abs % 360;
    const hue2 = (hue1 + 45 + ((abs >> 3) % 70)) % 360;
    const cx = 32 + (abs % 20);
    const cy = 32 + ((abs >> 5) % 20);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue1},60%,80%)"/>
        <stop offset="100%" stop-color="hsl(${hue2},55%,68%)"/>
      </linearGradient></defs>
      <circle cx="50" cy="50" r="50" fill="url(#g)"/>
      <circle cx="${cx}" cy="${cy}" r="20" fill="rgba(255,255,255,0.28)"/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  // Renders the avatar + username markup used consistently across
  // friends, followers, and both leaderboards — Google picture (or a
  // generated blob) plus a golden ring/shine for supporters.
  function renderAvatarAndName(entry, extraLabel) {
    const src = entry.avatarUrl || generateAvatarDataUri(entry.username || entry.userId || entry.email || 'x');
    const avatarClass = 'auth-avatar' + (entry.isSupporter ? ' auth-avatar-supporter' : '');
    const nameClass = entry.isSupporter ? 'username-supporter' : '';
    const label = escapeHtml(entry.username || entry.email || 'Unnamed') + (extraLabel || '');
    return `<img src="${src}" class="${avatarClass}" alt=""><span class="${nameClass}">${label}</span>`;
  }

  async function addFriend() {
    const input = document.getElementById('addFriendInput');
    const msgEl = document.getElementById('friendMessage');
    const errEl = document.getElementById('friendError');
    const identifier = input?.value?.trim();

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    if (!identifier) {
      if (errEl) {
        errEl.textContent = 'Enter a username, email, or friend ID';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'add', identifier }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Could not send request';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = data.message || 'Friend request sent!';
        msgEl.classList.remove('hidden');
      }
      if (input) input.value = '';
      loadFriends();
    } catch (e) {
      console.error('addFriend error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function respondToRequest(requestId, action) {
    try {
      await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action, requestId }),
      });
      loadFriends();
    } catch (e) {
      console.error('respondToRequest error:', e);
    }
  }

  async function removeFriend(friendUserId) {
    try {
      await fetch('/api/friends', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ action: 'remove', friendUserId }),
      });
      loadFriends();
    } catch (e) {
      console.error('removeFriend error:', e);
    }
  }

  async function saveUsername() {
    const input = document.getElementById('usernameInput');
    const msgEl = document.getElementById('usernameMessage');
    const errEl = document.getElementById('usernameError');
    const username = input?.value?.trim();

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      if (errEl) {
        errEl.textContent = 'Username must be 3-20 characters, letters/numbers/underscores only';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ username }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Failed to save username';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = 'Username saved!';
        msgEl.classList.remove('hidden');
      }
      loadProfile(); // re-checks canChangeUsername and locks the field if that was the one allowed change
    } catch (e) {
      console.error('saveUsername error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  async function saveRecoveryEmail() {
    const input = document.getElementById('recoveryEmailInput');
    const msgEl = document.getElementById('recoveryEmailMessage');
    const errEl = document.getElementById('recoveryEmailError');
    const recoveryEmail = input?.value?.trim() || '';

    msgEl?.classList.add('hidden');
    errEl?.classList.add('hidden');

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || '',
        },
        credentials: 'include',
        body: JSON.stringify({ recoveryEmail }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (errEl) {
          errEl.textContent = data.error || 'Failed to save recovery email';
          errEl.classList.remove('hidden');
        }
        return;
      }

      if (msgEl) {
        msgEl.textContent = recoveryEmail ? 'Recovery email saved!' : 'Recovery email removed.';
        msgEl.classList.remove('hidden');
      }
    } catch (e) {
      console.error('saveRecoveryEmail error:', e);
      if (errEl) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.classList.remove('hidden');
      }
    }
  }

  function toggleAuthPopup() {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (popup) {
      popup.classList.toggle('hidden');
      document.body.classList.toggle('auth-popup-open', !popup.classList.contains('hidden'));
      if (!popup.classList.contains('hidden') && window.WWP_Twinkle) {
        window.WWP_Twinkle.syncRadioUI();
      }
    }
  }

  function closeAuthPopup() {
    const popup = document.getElementById(AUTH_POPUP_ID);
    if (popup) popup.classList.add('hidden');
    document.body.classList.remove('auth-popup-open');
  }

  // Exposed so other modules (e.g. Community Ideas) can check sign-in
  // state and prompt sign-in without duplicating the auth popup logic.
  window.WWP_getAuthState = () => authState;
  window.WWP_promptSignIn = () => { toggleAuthPopup(); };

  async function sendMagicLink() {
    const emailInput = document.getElementById(EMAIL_INPUT_ID);
    const email = emailInput?.value?.trim();

    if (!email || !email.includes('@')) {
      showAuthError('Please enter a valid email');
      return;
    }

    showAuthLoading(true);
    clearMessages();

    try {
      const res = await fetch('/api/send-magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || ''
        },
        body: JSON.stringify({ email }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        showAuthError(data.error || 'Failed to send link');
        return;
      }

      showAuthMessage('Check your email for the sign-in link. Link expires in 24 hours.');
      emailInput.value = '';
    } catch (err) {
      console.error('sendMagicLink error:', err);
      showAuthError('Network error. Please try again.');
    } finally {
      showAuthLoading(false);
    }
  }

  async function signOut() {
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials: 'include',
      });

      if (res.ok) {
        authState = { authenticated: false, email: null, role: null };
        renderAuthUI('sign-in');
        closeAuthPopup();
      } else {
        showAuthError('Sign out failed');
      }
    } catch (err) {
      console.error('signOut error:', err);
      showAuthError('Network error. Please try again.');
    }
  }

  function wireDeleteAccountUI() {
    const step1 = document.getElementById('deleteAccountStep1');
    const step2 = document.getElementById('deleteAccountStep2');
    const deleteBtn = document.getElementById('deleteAccountBtn');
    const cancelBtn = document.getElementById('deleteAccountCancelBtn');
    const confirmBtn = document.getElementById('deleteAccountConfirmBtn');
    const confirmInput = document.getElementById('deleteAccountConfirmInput');
    const errorBox = document.getElementById('deleteAccountError');
    if (!deleteBtn || !step1 || !step2 || !confirmBtn || !cancelBtn || !confirmInput) return;

    deleteBtn.addEventListener('click', () => {
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      confirmInput.value = '';
      if (errorBox) errorBox.classList.add('hidden');
    });

    cancelBtn.addEventListener('click', () => {
      step2.classList.add('hidden');
      step1.classList.remove('hidden');
      if (errorBox) errorBox.classList.add('hidden');
    });

    confirmBtn.addEventListener('click', async () => {
      if (errorBox) errorBox.classList.add('hidden');
      if (confirmInput.value.trim().toUpperCase() !== 'DELETE') {
        if (errorBox) {
          errorBox.textContent = 'Please type DELETE to confirm.';
          errorBox.classList.remove('hidden');
        }
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      try {
        const res = await fetch('/api/user/delete', {
          method: 'POST',
          headers: { 'X-Device-Id': window.WWP?.deviceId || '' },
          credentials: 'include',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (errorBox) {
            errorBox.textContent = data.error || 'Failed to delete account. Please try again.';
            errorBox.classList.remove('hidden');
          }
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Confirm Delete';
          return;
        }
        authState = { authenticated: false, email: null, role: null };
        closeAuthPopup();
        renderAuthUI('sign-in');
        window.location.reload();
      } catch (err) {
        console.error('deleteAccount error:', err);
        if (errorBox) {
          errorBox.textContent = 'Network error. Please try again.';
          errorBox.classList.remove('hidden');
        }
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm Delete';
      }
    });
  }

  async function handleVerifyRedirect() {
    const token = window.__wwpAuthToken;

    if (!token) return;

    try {
      const res = await fetch(`/api/verify-token?token=${encodeURIComponent(token)}`, {
        credentials: 'include',
        headers: { 'X-Device-Id': window.WWP?.deviceId || '' }
      });

      const data = await res.json();

      if (res.ok) {
        authState = { authenticated: true, email: data.email, userId: data.userId, role: data.role || 'user' };
        renderAuthUI('signed-in');
        window.history.replaceState({}, document.title, '/');
        showAuthToast("You're signed in!", 'success');
        checkSession();
      } else {
        window.history.replaceState({}, document.title, '/');
        showAuthToast(data.error || 'Sign-in failed', 'error');
      }
    } catch (err) {
      console.error('handleVerifyRedirect error:', err);
      window.history.replaceState({}, document.title, '/');
    }
  }

  function showAuthMessage(msg) {
    const msgEl = document.getElementById('authPopupMessage');
    if (msgEl) {
      msgEl.textContent = msg;
      msgEl.classList.remove('hidden');
    }
  }

  function showAuthError(msg) {
    const errEl = document.getElementById('authPopupError');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  function showAuthLoading(show) {
    const loadingEl = document.getElementById('authPopupLoading');
    const sendBtn = document.getElementById(SEND_LINK_BTN_ID);
    if (loadingEl) loadingEl.classList.toggle('hidden', !show);
    if (sendBtn) sendBtn.disabled = show;
  }

  function clearMessages() {
    const msgEl = document.getElementById('authPopupMessage');
    const errEl = document.getElementById('authPopupError');
    if (msgEl) msgEl.classList.add('hidden');
    if (errEl) errEl.classList.add('hidden');
  }

  function showAuthToast(msg, type = 'success') {
    // Remove any existing toast first
    const existing = document.querySelector('.auth-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'auth-toast' + (type === 'error' ? ' error' : '');

    const icon = type === 'error'
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>';

    toast.innerHTML = `<span class="auth-toast-icon">${icon}</span><span>${msg}</span>`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AuthSystem = { checkSession, signOut, toggleAuthPopup };
})();

})();
/* ============================================================
   JOURNAL SECTION
   ============================================================ */
(function(){

/* ============================================================
   UTIL
   ============================================================ */
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
// showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

// dkey: shared, defined once in wwp-core.js — no local copy needed.
function addDays(d,n){ const c=new Date(d); c.setDate(c.getDate()+n); return c; }
function startOfWeekMon(d){ const c=new Date(d); const day=(c.getDay()+6)%7; c.setDate(c.getDate()-day); c.setHours(0,0,0,0); return c; }
function fmtLong(d){ return d.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function fmtMonthYear(d){ return d.toLocaleDateString(undefined,{month:'long',year:'numeric'}); }

const PRAYER_ORDER = ['Fajr','Dhuhr','Asr','Maghrib','Isha'];
const STATUS_CYCLE = ['pending','ontime','congregation','missed'];
const STATUS_LABEL = {pending:'Not yet',ontime:'Prayed · on time',congregation:'Prayed · congregation',missed:'Missed'};

const DEED_PRESETS = ['Read Qur\'an','Dhikr','Charity / Sadaqah','Helped Family','Attended Mosque','Learned Something'];

/* ============================================================
   DATA :: fresh-device defaults. A brand new device starts
   genuinely empty (no fake demo history) — real data loads in
   from the backend below if this device already has some saved.
   ============================================================ */
const today = new Date(); today.setHours(0,0,0,0);
const todayKey = dkey(today);

// The "active" day is whichever day's entries are being viewed/edited —
// defaults to today, but the calendar lets you jump to any past day
// (e.g. logging last night after midnight) without touching the real
// streak/stats math, which always keys off todayKey.
let activeDate = new Date(today);
let activeKey = todayKey;

const state = {
  theme:'light',
  reflections:{},      // dateKey -> {mood,gratitude,intention,dua,reflection,savedAt}
  prayers:{},           // dateKey -> {Fajr:'ontime',...}
  deeds:{},              // dateKey -> [{id,label,done}]
  mistakes:{},          // dateKey -> [{note,ts}]
  streakDays:0,
  streakFreezeMonth:null, // 'YYYY-MM' of the last month a freeze was used, or null
  calMonth:new Date(today.getFullYear(), today.getMonth(), 1),
  routines:[
    {id:'r1', name:'Morning Routine', icon:'sun', steps:['Fajr','Qur\'an','Dhikr','Set intention']},
    {id:'r2', name:'Evening Routine', icon:'moon', steps:['Dhikr','Reflection','Qur\'an']},
    {id:'r3', name:'Sleep Routine', icon:'zzz', steps:['Isha','Du\'a','Sleep early']}
  ],
  heartSaved:false
};

function ensureDay(key){
  if(!state.prayers[key]) state.prayers[key] = {Fajr:'pending',Dhuhr:'pending',Asr:'pending',Maghrib:'pending',Isha:'pending'};
  if(!state.deeds[key]) state.deeds[key] = DEED_PRESETS.map((label,i)=>({id:'d'+i,label,done:false}));
  if(!state.mistakes[key]) state.mistakes[key] = [];
}
ensureDay(todayKey);

/* ============================================================
   SERVICES :: derived calculations + backend sync via WWP
   (anonymous device-id-first — see shared WWP module at top).
   ============================================================ */
function recomputeStreak(){
  // Count today (if logged) plus consecutive prior days with a saved
  // reflection — but allow ONE gap day per calendar month to pass
  // through without breaking the chain (a streak freeze, Duolingo-
  // style), so one missed day doesn't wipe out a long streak.
  let s=0, freezeUsedThisPass=false, cursor=new Date(today);
  const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  const freezeAvailable = state.streakFreezeMonth !== monthKey;

  while(true){
    const key = dkey(cursor);
    if(state.reflections[key]){
      s++;
      cursor = addDays(cursor,-1);
      continue;
    }
    if(s>0 && freezeAvailable && !freezeUsedThisPass){
      freezeUsedThisPass = true;
      cursor = addDays(cursor,-1);
      continue;
    }
    break;
  }

  state.streakDays = s;
  if(freezeUsedThisPass) state.streakFreezeMonth = monthKey;
}

function streakFreezeStatus(){
  const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
  return state.streakFreezeMonth === monthKey ? 'used' : 'available';
}

// Debounced write of everything worth persisting for this device.
function persistJournal(){
  WWP.save('journal', {
    reflections: state.reflections,
    prayers: state.prayers,
    deeds: state.deeds,
    mistakes: state.mistakes,
    routines: state.routines,
    heartSaved: state.heartSaved,
    streakFreezeMonth: state.streakFreezeMonth
  });
}

// Pulls this device's saved Journal state, if any, and merges it in.
// ==> CONNECT (resolved): real backend load, scoped by the device ID
// from WWP — no auth needed for this test phase.
async function loadJournalFromBackend(){
  const saved = await WWP.get('journal');
  if(saved){
    if(saved.reflections) state.reflections = saved.reflections;
    if(saved.prayers) state.prayers = saved.prayers;
    if(saved.deeds) state.deeds = saved.deeds;
    if(saved.mistakes) state.mistakes = saved.mistakes;
    if(Array.isArray(saved.routines)) state.routines = saved.routines;
    if(typeof saved.heartSaved==='boolean') state.heartSaved = saved.heartSaved;
    if(saved.streakFreezeMonth !== undefined) state.streakFreezeMonth = saved.streakFreezeMonth;
  }
  ensureDay(todayKey);
  recomputeStreak();
}
function computeQuality(key){
  const p = state.prayers[key], d = state.deeds[key], m = state.mistakes[key];
  if(!p) return null;
  const prayedCount = PRAYER_ORDER.filter(x=> p[x]==='ontime'||p[x]==='congregation').length;
  const missedCount = PRAYER_ORDER.filter(x=> p[x]==='missed').length;
  const deedsDone = (d||[]).filter(x=>x.done).length;
  const mistakeCount = (m||[]).length;
  const hasAnyData = prayedCount>0 || missedCount>0 || deedsDone>0 || mistakeCount>0 || !!state.reflections[key];
  if(!hasAnyData) return null;
  if(prayedCount>=4 && mistakeCount===0 && deedsDone>=2) return 'great';
  if(prayedCount>=3 && mistakeCount<=1) return 'good';
  if(mistakeCount>prayedCount && mistakeCount>0) return 'missed';
  return 'okay';
}

function weekDates(){ const start = startOfWeekMon(today); return Array.from({length:7},(_,i)=> addDays(start,i)); }

function prayerConsistencyPct(key){
  const p = state.prayers[key]; if(!p) return 0;
  const done = PRAYER_ORDER.filter(x=> p[x]==='ontime'||p[x]==='congregation').length;
  return Math.round((done/5)*100);
}

/* ============================================================
   UI :: render
   ============================================================ */
function renderSummaryLine(){
  const p = state.prayers[activeKey];
  const prayedCount = PRAYER_ORDER.filter(x=> p[x]==='ontime'||p[x]==='congregation').length;
  const deedsDone = state.deeds[activeKey].filter(x=>x.done).length;
  const dayWord = activeKey===todayKey ? 'today' : fmtLong(activeDate);
  $('#summaryLine').textContent = `Alhamdulillah — ${prayedCount} of 5 prayers and ${deedsDone} good deed${deedsDone===1?'':'s'} logged ${dayWord}.`;
}

function renderStats(){
  $('#streakVal').textContent = `${state.streakDays} day${state.streakDays===1?'':'s'}`;
  const freezeNote = streakFreezeStatus()==='available' ? ' · ❄️ freeze available' : ' · ❄️ freeze used this month';
  $('#streakSub').textContent = (state.reflections[todayKey] ? 'Logged today ✓' : 'Save today\'s reflection to keep it going') + (state.streakDays>0 ? freezeNote : '');

  const wk = weekDates();
  const pcts = wk.map(d=> dkey(d)<=todayKey || dkey(d)===todayKey ? prayerConsistencyPct(dkey(d)) : null);
  const validPcts = pcts.filter(x=>x!==null);
  const avg = validPcts.length ? Math.round(validPcts.reduce((a,b)=>a+b,0)/validPcts.length) : 0;
  $('#consistencyVal').textContent = avg+'%';
  const spark = $('#sparkRow'); spark.innerHTML='';
  wk.forEach(d=>{
    const key = dkey(d);
    const pct = key<=todayKey ? prayerConsistencyPct(key) : 0;
    const bar = document.createElement('div');
    bar.className = 'spark-bar'+(key===todayKey?' today':'');
    bar.style.height = Math.max(4,pct*0.28)+'px';
    bar.title = d.toLocaleDateString(undefined,{weekday:'short'})+': '+pct+'%';
    spark.appendChild(bar);
  });

  const deedsThisWeek = wk.reduce((sum,d)=>{ const key=dkey(d); return sum + (state.deeds[key]? state.deeds[key].filter(x=>x.done).length : 0); },0);
  $('#deedsWeekVal').textContent = deedsThisWeek;

  const daysOnTrack = wk.filter(d=> dkey(d)<=todayKey && state.reflections[dkey(d)]).length;
  const totalTrackable = wk.filter(d=> dkey(d)<=todayKey).length || 1;
  const pct2 = Math.round((daysOnTrack/7)*100);
  $('#weekGoalVal').textContent = `${daysOnTrack} of 7`;
  $('#weekRingPct').textContent = pct2+'%';
  const r=21, c=2*Math.PI*r;
  const fg = $('#weekRingFg');
  fg.setAttribute('stroke-dasharray', c.toFixed(1));
  fg.setAttribute('stroke-dashoffset', (c*(1-pct2/100)).toFixed(1));

  // Combined activity score for the friends leaderboard — weights streak
  // most heavily (consistency over time matters more than any one day),
  // then weekly prayer consistency, then deeds logged this week.
  const combinedScore = (state.streakDays * 10) + avg + (deedsThisWeek * 3);
  submitLeaderboardScore(combinedScore);
}

// Debounced so we're not hitting the API on every keystroke-triggered
// re-render — only signed-in users have a leaderboard entry at all.
let leaderboardSubmitTimer = null;
function submitLeaderboardScore(score){
  clearTimeout(leaderboardSubmitTimer);
  leaderboardSubmitTimer = setTimeout(async ()=>{
    try{
      await fetch('/api/leaderboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': window.WWP?.deviceId || ''
        },
        credentials: 'include',
        body: JSON.stringify({ score })
      });
    }catch(e){ /* silent — leaderboard is a nice-to-have, not critical */ }
  }, 1500);
}

function renderReflectionForm(){
  const isToday = activeKey===todayKey;
  $('#reflectionDateLbl').textContent = fmtLong(activeDate) + (isToday ? '' : ' · editing a past day');
  $('#backToTodayBtn').style.display = isToday ? 'none' : '';
  const r = state.reflections[activeKey];
  $('#moodSelect').value = r? (r.mood||'') : '';
  $('#gratitudeInput').value = r? (r.gratitude||'') : '';
  $('#intentionInput').value = r? (r.intention||'') : '';
  $('#duaInput').value = r? (r.dua||'') : '';
  $('#reflectionInput').value = r? (r.reflection||'') : '';
}

function renderSalah(){
  const list = $('#salahList'); list.innerHTML='';
  const p = state.prayers[activeKey];
  PRAYER_ORDER.forEach(name=>{
    const status = p[name];
    const row = document.createElement('div');
    row.className='salah-row';
    row.innerHTML = `
      <span class="salah-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/></svg></span>
      <span class="salah-name">${name}</span>
      <span class="salah-status"><span class="status-dot ${status}"></span>${STATUS_LABEL[status]}</span>
    `;
    row.addEventListener('click', ()=>{
      const idx = STATUS_CYCLE.indexOf(status);
      p[name] = STATUS_CYCLE[(idx+1)%STATUS_CYCLE.length];
      persistJournal();
      renderAll();
    });
    list.appendChild(row);
  });
}

function renderDeeds(){
  const wrap = $('#deedsWrap'); wrap.innerHTML='';
  state.deeds[activeKey].forEach(deed=>{
    const pill = document.createElement('div');
    pill.className = 'deed-pill'+(deed.done?' done':'');
    pill.innerHTML = `<span class="deed-check">${deed.done?'✓':''}</span>${deed.label}`;
    pill.addEventListener('click', ()=>{ deed.done=!deed.done; persistJournal(); renderAll(); });
    wrap.appendChild(pill);
  });
}

function renderBalance(){
  const deedsDone = state.deeds[activeKey].filter(x=>x.done).length;
  const mistakeCount = state.mistakes[activeKey].length;
  $('#goodDeedsNum').textContent = deedsDone;
  $('#mistakesNum').textContent = mistakeCount;
  const total = deedsDone+mistakeCount;
  const goodPct = total>0 ? Math.round((deedsDone/total)*100) : 50;
  $('#segGood').style.width = goodPct+'%';
  $('#segBad').style.width = (100-goodPct)+'%';
  let msg = 'Log a deed or a reflection to see how today is going.';
  if(total>0){
    if(deedsDone>=mistakeCount*2 && deedsDone>0) msg = 'You\'re doing well. Keep going and trust in Allah\'s mercy.';
    else if(mistakeCount>deedsDone) msg = 'Every day is a fresh chance — turn back to Allah, He loves those who repent.';
    else msg = 'A mixed day is still a day you showed up. Small, steady deeds matter most.';
  }
  $('#balanceMsg').textContent = msg;
  $('#mistakeCharCount').textContent = $('#mistakeInput').value.length;
}

function renderCalendar(){
  const monthStart = state.calMonth;
  $('#calMonthLbl').textContent = fmtMonthYear(monthStart);

  const dow = $('#calDow'); dow.innerHTML='';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=> dow.innerHTML += `<div class="cal-dow">${d}</div>`);

  const grid = $('#calGrid'); grid.innerHTML='';
  const firstDay = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  const startOffset = (firstDay.getDay()+6)%7; // Mon=0
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth()+1, 0).getDate();

  for(let i=0;i<startOffset;i++){ grid.innerHTML += `<div class="cal-cell blank"></div>`; }
  for(let day=1; day<=daysInMonth; day++){
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const key = dkey(d);
    const q = computeQuality(key);
    const cls = q ? q : '';
    const isToday = key===todayKey;
    const isActive = key===activeKey;
    const isFuture = d.getTime() > today.getTime();
    const cell = document.createElement('div');
    cell.className = 'cal-cell '+cls+(isToday?' today-cell':'')+(isActive?' active-cell':'')+(isFuture?' future-cell':'');
    cell.textContent = day;
    cell.title = isFuture ? 'Tap to plan this day' : 'Tap to view/edit this day';
    cell.addEventListener('click', ()=>{
      activeDate = d; activeKey = key;
      ensureDay(activeKey);
      renderAll();
      showToast(`Now editing ${d.toLocaleDateString(undefined,{day:'numeric',month:'short'})}`);
    });
    grid.appendChild(cell);
  }
}

function renderRoutines(){
  const list = $('#routineList'); list.innerHTML='';
  const icons = { sun:'M12 4V2M12 22v-2M4.9 4.9 3.5 3.5M20.5 20.5l-1.4-1.4M4.9 19.1l-1.4 1.4M20.5 3.5l-1.4 1.4M2 12H0M24 12h-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
                  moon:'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z',
                  zzz:'M8 6h8l-8 8h8M4 15h6l-6 6h6' };
  state.routines.forEach(r=>{
    const card = document.createElement('div');
    card.className='routine-card';
    card.innerHTML = `
      <div class="routine-top">
        <span class="routine-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${icons[r.icon]||icons.sun}"/></svg></span>
        <span class="routine-name">${r.name}</span>
        <span class="routine-edit-link" data-id="${r.id}">Edit</span>
      </div>
      <div class="routine-steps">${r.steps.map(s=>`<span class="step-chip">${s}</span>`).join('')}</div>
      <div class="routine-edit-row" style="display:none;" data-edit-for="${r.id}">
        <input type="text" placeholder="Add a step…" data-new-step="${r.id}">
        <button data-add-step="${r.id}">Add</button>
      </div>
    `;
    list.appendChild(card);
  });

  $$('.routine-edit-link').forEach(link=> link.addEventListener('click', function(){
    const row = $(`.routine-edit-row[data-edit-for="${this.dataset.id}"]`);
    row.style.display = row.style.display==='none' ? 'flex' : 'none';
  }));
  $$('[data-add-step]').forEach(btn=> btn.addEventListener('click', function(){
    const id = this.dataset.addStep;
    const input = $(`[data-new-step="${id}"]`);
    const val = input.value.trim();
    if(!val) return;
    const routine = state.routines.find(r=>r.id===id);
    routine.steps.push(val);
    input.value='';
    persistJournal();
    renderRoutines();
  }));
}

function renderAll(){
  renderSummaryLine();
  renderStats();
  renderReflectionForm();
  renderSalah();
  renderDeeds();
  renderBalance();
  renderCalendar();
  renderRoutines();
  loadJamaahBroadcastPanel();
}

/* ============================================================
   Jama'ah Broadcast :: share today's prayer plan with friends,
   see friends' active plans. Self-contained, mirrors the Qur'an
   reading-streak poke panel pattern (friends-based, 401-aware,
   30s-throttled refresh).
   ============================================================ */
let jbPanelLastLoad = 0;
async function loadJamaahBroadcastPanel(force){
  if(!force && Date.now()-jbPanelLastLoad<30000) return;
  jbPanelLastLoad = Date.now();
  const msgEl = $('#jbMsg');
  const listEl = $('#jbFriendsList');
  if(!msgEl || !listEl) return;
  try{
    const res = await fetch('/api/jamaah-broadcast', {
      credentials:'include',
      headers:{ 'X-Device-Id': window.WWP?.deviceId || '' }
    });
    if(res.status===401){
      msgEl.style.display='block';
      msgEl.innerHTML = 'Sign in to broadcast Jama\'ah plans and see friends\' plans.';
      listEl.innerHTML='';
      return;
    }
    if(!res.ok){
      msgEl.style.display='block';
      msgEl.textContent = 'Couldn\'t load friends\' plans — try again shortly.';
      listEl.innerHTML='';
      return;
    }
    const data = await res.json();
    listEl.innerHTML='';
    if(!data.entries || !data.entries.length){
      msgEl.style.display='block';
      msgEl.textContent = 'No friends have broadcast a Jama\'ah plan right now.';
      return;
    }
    msgEl.style.display='none';
    data.entries.forEach(entry=>{
      const item = document.createElement('div');
      item.className='jb-friend-item';
      item.innerHTML = `
        <span class="jb-friend-name">${escapeHtml(entry.username)}</span>
        <span class="jb-friend-detail">${escapeHtml(entry.prayerName)} · ${escapeHtml(entry.mosqueName)} · ${escapeHtml(entry.plannedTime)}</span>
        ${entry.note ? `<span class="jb-friend-note">${escapeHtml(entry.note)}</span>` : ''}
      `;
      listEl.appendChild(item);
    });
  }catch(e){
    console.warn('loadJamaahBroadcastPanel failed', e);
    msgEl.style.display='block';
    msgEl.textContent = 'Couldn\'t load friends\' plans — try again shortly.';
    listEl.innerHTML='';
  }
}

async function sendJamaahBroadcast(){
  const btn = $('#jbBroadcastBtn');
  const prayerName = $('#jbPrayerSelect').value;
  const mosqueName = $('#jbMosqueInput').value.trim();
  const plannedTime = $('#jbTimeInput').value;
  const note = $('#jbNoteInput').value.trim();
  if(!mosqueName){ showToast('Enter a mosque or location.'); return; }
  if(!plannedTime){ showToast('Pick a time.'); return; }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Broadcasting…';
  try{
    const res = await fetch('/api/jamaah-broadcast', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
      credentials:'include',
      body: JSON.stringify({ prayerName, mosqueName, plannedTime, note: note || undefined })
    });
    if(res.status===401){ showToast('Sign in to broadcast to friends.'); return; }
    const data = await res.json();
    if(res.ok && data.success){
      showToast('Broadcast sent — your friends can see it.');
      $('#jbMosqueInput').value=''; $('#jbNoteInput').value='';
      loadJamaahBroadcastPanel(true);
    } else {
      showToast(data.error || 'Could not broadcast.');
    }
  }catch(e){
    showToast('Could not broadcast.');
  }finally{
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ============================================================
   Actions
   ============================================================ */
function saveReflection(){
  state.reflections[activeKey] = {
    mood: $('#moodSelect').value,
    gratitude: $('#gratitudeInput').value.trim(),
    intention: $('#intentionInput').value.trim(),
    dua: $('#duaInput').value.trim(),
    reflection: $('#reflectionInput').value.trim(),
    savedAt: Date.now()
  };
  recomputeStreak();
  persistJournal();
  showToast(activeKey===todayKey ? 'Reflection saved. JazakAllah khayr.' : `Saved for ${fmtLong(activeDate)}. JazakAllah khayr.`);
  renderAll();
}

function clearReflection(){
  $('#moodSelect').value=''; $('#gratitudeInput').value=''; $('#intentionInput').value='';
  $('#duaInput').value=''; $('#reflectionInput').value='';
}

function addCustomDeed(){
  const input = $('#newDeedInput');
  const val = input.value.trim();
  if(!val) return;
  state.deeds[activeKey].push({id:'custom-'+Date.now(), label:val, done:true});
  input.value='';
  persistJournal();
  renderAll();
  showToast('Added "'+val+'" to '+(activeKey===todayKey?"today's":fmtLong(activeDate)+"'s")+' deeds');
}

function logMistake(){
  const ta = $('#mistakeInput');
  const val = ta.value.trim();
  if(!val){ showToast('Write a line first, then log it.'); return; }
  state.mistakes[activeKey].push({note:val, ts:Date.now()});
  ta.value='';
  persistJournal();
  renderAll();
  showToast('Noted — may Allah forgive and guide you.');
}

function setTheme(mode){
  const order = ['light','sepia','dark'];
  const next = mode || order[(order.indexOf(document.body.getAttribute('data-theme'))+1)%order.length];
  document.body.setAttribute('data-theme', next);
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
async function init(){
  // Paint the journal shell first. Saved data hydrates after first paint
  // so IndexedDB/network latency cannot hold the page open.
  renderAll();
  loadJournalFromBackend().then(renderAll).catch(()=>0);

  $('#saveReflectionBtn').addEventListener('click', saveReflection);
  $('#clearReflectionBtn').addEventListener('click', clearReflection);
  $('#addDeedBtn').addEventListener('click', addCustomDeed);
  $('#newDeedInput').addEventListener('keydown', e=>{ if(e.key==='Enter') addCustomDeed(); });
  $('#logMistakeBtn').addEventListener('click', logMistake);
  $('#backToTodayBtn').addEventListener('click', ()=>{
    activeDate = new Date(today); activeKey = todayKey;
    renderAll();
  });
  $('#journalShareBtn')?.addEventListener('click', ()=>{
    const text = `${state.streakDays} day${state.streakDays===1?'':'s'} streak on WhereWePraying? 🕌 Tracking my prayers and good deeds — join me!`;
    Platform.share({title:'My WhereWePraying? Streak', text}, ()=>{
      Platform.copyToClipboard(text, {onSuccess:()=>showToast('Streak copied to clipboard.'), onFail:()=>showToast('Sharing is unavailable.')});
    });
  });
  $('#mistakeInput').addEventListener('input', ()=> $('#mistakeCharCount').textContent = $('#mistakeInput').value.length);

  $('#calPrev').addEventListener('click', ()=>{ state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth()-1, 1); renderCalendar(); });
  $('#calNext').addEventListener('click', ()=>{ state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth()+1, 1); renderCalendar(); });

  $('#addRoutineBtn').addEventListener('click', ()=>{
    const name = prompt('Name this routine (e.g. "Jumu\'ah Routine"):');
    if(!name) return;
    state.routines.push({id:'r'+Date.now(), name, icon:'sun', steps:[]});
    persistJournal();
    renderRoutines();
  });

  $('#jbBroadcastBtn')?.addEventListener('click', sendJamaahBroadcast);

  $('#heartToggle').addEventListener('click', function(){
    state.heartSaved = !state.heartSaved;
    this.classList.toggle('saved', state.heartSaved);
    persistJournal();
    showToast(state.heartSaved ? 'Saved to your favourites' : 'Removed from favourites');
  });

  // Note: Hijri date is still estimated client-side — a proper lunar-
  // calendar source is a separate, non-storage piece of future work.
}

init();

})();

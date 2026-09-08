/* ============================================================
   GUIDES SECTION
   ============================================================ */
(function(){
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
// showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

const ICONS = {
  droplet:'<path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13Z"/>',
  pray:'<circle cx="12" cy="5" r="2.4"/><path d="M12 9v6M8 12l4-3 4 3M7 21l5-4 5 4M9 15l-3 3M15 15l3 3"/>',
  hand:'<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4a1.5 1.5 0 0 1 3 0v7M14 12V6a1.5 1.5 0 0 1 3 0v8"/><path d="M8 13c-1-1-3-1-3 1 0 4 3 8 8 8h1a6 6 0 0 0 6-6v-3"/>',
  shower:'<path d="M4 12a8 8 0 0 1 15.3-3.2"/><path d="M20 9h-3V6"/><path d="M8 16v2M12 16v3M16 16v2"/>',
  megaphone:'<path d="M3 11v2a2 2 0 0 0 2 2h1l3 5V9L6 9a2 2 0 0 0-2 2Z"/><path d="M9 9l10-5v16L9 15"/><path d="M19 10a3 3 0 0 1 0 4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6 6-2Z"/>',
  mosque:'<path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/><path d="M4 21v-6h4v6M16 21v-6h4v6"/><path d="M4 21h16"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  star:'<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 7.6 9.4 7Z"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  home:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  utensils:'<path d="M7 3v7a2 2 0 0 0 4 0V3"/><path d="M9 10v11"/><path d="M17 3c-2 0-3 2.5-3 5.5S15 14 17 14v7"/>'
};
function iconSvg(name, size){ size = size||14; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.star}</svg>`; }

/* ============================================================
   DATA :: original plain-English step descriptions. The overall
   sequence shown is the commonly taught one — exact order and a
   few details vary between schools of thought (madhabs), noted
   per guide where it matters.
   ==> CONNECT: replace with a scholar-reviewed content source.
   ============================================================ */
const GUIDES = []; // populated async from /assets/data/guides.json — see loadGuidesData() below

const QA = [];


// ==> GUIDE CATEGORIZATION
const GUIDE_CATEGORIES = {
  'Prayer': ['wudu', 'salah', 'ghusl', 'tayammum', 'adhan', 'sujoodsahw', 'qibla', 'jumuah', 'five-prayers', 'consistent-prayer-practice', 'prayer-feels-empty', 'actions-during-prayer', 'should-i-pray-now', 'staying-focused-salah', 'praying-in-car', 'wudu-limited-water', 'praying-at-work', 'praying-while-sick', 'prayer-with-disabilities'],
  'Etiquette': ['mosque-etiquette', 'home-etiquette', 'food-etiquette', 'quran-etiquette', 'manners', 'neighbors', 'work-etiquette', 'women-in-workplace', 'mosque-with-kids'],
  'Ritual Purification': ['wudu-mistakes', 'salah-mistakes', 'ghusl-or-wudu', 'common-mistakes'],
  'Fasting': ['fasting', 'ramadan', 'ramadan-preparation', 'ramadan-fasting-guide', 'laylat-qadr', 'eid', 'eid-prayer-detailed', 'can-i-fast-today', 'fasting-physical-job', 'ramadan-timezones', 'breaking-fast-traveling', 'fasting-medical-procedures', 'muharram-ashura'],
  'Scenarios': ['travel', 'finding-jamaah-away', 'hajj-umrah-basics', 'hajj-umrah-detailed', 'planning-your-islamic-year', 'islamic-calendar-explained'],
  'Personal Dev': ['patience-hardship', 'anger-management', 'gratitude', 'intention', 'seeking-knowledge', 'dealing-with-loss', 'dealing-with-doubt', 'why-islam-forbids-things', 'breaking-bad-habits', 'perfectionism-islamic-lens', 'geographic-isolation-faith', 'anxiety-waswasa-distinction'],
  'Knowledge': ['tawheed-basics', 'shirk-avoidance', 'innovation-bidah', 'is-this-halal-framework', 'seeking-knowledge-guide'],
  'Women': ['menstruation', 'postpartum', 'pregnancy-etiquette', 'women-leadership'],
  'Youth': ['youth-identity', 'youth-relationships', 'youth-career'],
  'Life Events': ['death-preparation', 'mourning-etiquette', 'grief-major-loss', 'divorce-islamic-process', 'interfaith-families', 'aging-parents-care', 'new-muslim-first-month', 'converts-journey', 'parents-teaching-kids', 'elders-in-islam', 'teen-young-adult-guide'],
  'Health': ['sleep', 'hygiene', 'chronic-illness-faith', 'mental-health-stigma'],
  'Finance': ['finance', 'financial-hardship-survival']
};

const CATEGORY_COLORS = {
  'Prayer': '#F4714E',
  'Etiquette': '#D4A574',
  'Ritual Purification': '#B8956A',
  'Fasting': '#E6B8A2',
  'Scenarios': '#C9A77A',
  'Personal Dev': '#A789A8',
  'Knowledge': '#8B7BA8',
  'Women': '#D4A5C8',
  'Youth': '#7FA8B8',
  'Life Events': '#A89575',
  'Health': '#9BBD8B',
  'Finance': '#C9A77A'
};
// <== GUIDE CATEGORIZATION

// Expose to other <script> blocks (e.g. the guides display override),
// which run in a sibling scope and cannot see these IIFE-local consts.
window.GUIDES = GUIDES;
window.getGuide = getGuide;
window.QA = QA;
window.GUIDE_CATEGORIES = GUIDE_CATEGORIES;
window.CATEGORY_COLORS = CATEGORY_COLORS;

/* ============================================================
   STATE
   ============================================================ */
const state = {
  selectedGuide: null,
  bookmarks: new Set(),
  completedSteps: {}, // guideId -> Set of step indices
};
// GUIDES/QA are populated async (see loadGuidesData below) — completedSteps
// for each is filled in there, right after the data arrives.

function getGuide(id){ return GUIDES.find(g=>g.id===id) || QA.find(q=>q.id===id); }

function persistGuides(){
  const completedSteps = {};
  Object.keys(state.completedSteps).forEach(id=>{ completedSteps[id] = Array.from(state.completedSteps[id]); });
  WWP.save('guides', { bookmarks: Array.from(state.bookmarks), completedSteps });
}
async function loadGuidesFromBackend(){
  const saved = await WWP.get('guides');
  if(!saved) return;
  if(Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
  if(saved.completedSteps){
    Object.keys(saved.completedSteps).forEach(id=>{
      if(state.completedSteps[id]) state.completedSteps[id] = new Set(saved.completedSteps[id]);
    });
  }
}

/* ============================================================
   UI :: render
   ============================================================ */
function renderSidebar(){
  const list = $('#guideList'); list.innerHTML='';
  GUIDES.forEach(g=>{
    const done = state.completedSteps[g.id];
    const allDone = done.size===g.steps.length && g.steps.length>0;
    const row = document.createElement('li');
    row.className = 'guide-row'+(state.selectedGuide===g.id?' active':'')+(allDone?' all-done':'');
    row.innerHTML = `
      <span class="g-row-icon">${iconSvg(g.icon,15)}</span>
      <div class="g-row-body">
        <div class="g-row-title">${g.title}</div>
        <div class="g-row-meta">${g.tag} · ${g.time}</div>
      </div>
      <span class="g-row-check">${allDone?iconSvg('check',11):''}</span>
    `;
    row.addEventListener('click', ()=> selectGuide(g.id));
    list.appendChild(row);
  });
  $('#guideSidebarCount').textContent = GUIDES.length+' guides';
}

function renderGuide(){
  const g = getGuide(state.selectedGuide);
  const emptyState = $('#guideEmptyState');
  const paneBody = $('#guidePaneBody');
  if(!g){
    if(emptyState) emptyState.style.display = '';
    if(paneBody) paneBody.style.display = 'none';
    return;
  }
  if(emptyState) emptyState.style.display = 'none';
  if(paneBody) paneBody.style.display = '';
  $('#guideOrn').innerHTML = iconSvg(g.icon,20);
  $('#guideTitle').textContent = g.title;
  $('#guideTag').textContent = g.tag;
  $('#guideTime').textContent = g.time;
  $('#guideSummary').textContent = g.summary;
  $('#guideBmBtn').classList.toggle('active-state', state.bookmarks.has(g.id));
  $('#guideBmBtn').style.background = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--surface-alt)';
  $('#guideBmBtn').style.color = state.bookmarks.has(g.id) ? '#fff' : 'var(--text)';
  $('#guideBmBtn').style.borderColor = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--border)';

  // info box (rak'ah counts, only for Salah)
  const infoSlot = $('#infoBoxSlot');
  if(g.rakahInfo){
    infoSlot.innerHTML = `
      <div class="info-box">
        <h4>Rak'ahs per prayer</h4>
        <div class="rakah-grid">
          ${g.rakahInfo.map(([name,count])=>`<div class="rakah-item"><div class="rk-name">${name}</div><div class="rk-count">${count}</div></div>`).join('')}
        </div>
      </div>`;
  } else {
    infoSlot.innerHTML = '';
  }

  const done = state.completedSteps[g.id];
  const stepsWrap = $('#guideSteps'); stepsWrap.innerHTML='';
  g.steps.forEach((step, idx)=>{
    const isDone = done.has(idx);
    const card = document.createElement('div');
    card.className = 'step-card'+(isDone?' done':'');
    card.innerHTML = `
      <span class="step-check" data-idx="${idx}">${isDone?iconSvg('check',13):''}</span>
      <div class="step-body">
        <div class="step-title"><span class="step-num" style="display:inline-flex;width:20px;height:20px;font-size:10.5px;margin-right:8px;vertical-align:middle;">${idx+1}</span>${step.title}</div>
        <div class="step-text">${step.body}</div>
        ${step.arabic ? `
          <div class="step-arabic-box">
            <div class="step-arabic">${step.arabic}</div>
            <div class="step-translit">${step.translit}</div>
            <div class="step-translation">${step.translation}</div>
          </div>` : ''}
      </div>
    `;
    card.querySelector('.step-check').addEventListener('click', ()=> toggleStep(g.id, idx));
    stepsWrap.appendChild(card);
  });

  $('#progressLabel').textContent = `${done.size} of ${g.steps.length} steps`;
  $('#progressFill').style.width = g.steps.length ? Math.round((done.size/g.steps.length)*100)+'%' : '0%';

  const crossSlot = $('#crossLinkSlot');
  if(g.crossLink){
    crossSlot.innerHTML = `<button class="cross-link-btn" id="crossLinkBtn">${g.crossLink.label} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    $('#crossLinkBtn').addEventListener('click', ()=>{
      if(typeof window.switchPage === 'function') window.switchPage(g.crossLink.page);
    });
  } else {
    crossSlot.innerHTML = '';
  }

  const relatedSlot = $('#relatedGuidesSlot');
  if(g.related && g.related.length){
    const chips = g.related.map(rid=>{
      const rg = getGuide(rid);
      return rg ? `<button class="related-chip" data-rid="${rid}">${rg.title}</button>` : '';
    }).join('');
    relatedSlot.innerHTML = `<div class="related-guides"><h4>Related guides</h4><div class="related-chips">${chips}</div></div>`;
    relatedSlot.querySelectorAll('.related-chip').forEach(btn=>{
      btn.addEventListener('click', ()=> window.WWP_openGuide(btn.dataset.rid));
    });
  } else {
    relatedSlot.innerHTML = '';
  }

  const noteSlot = $('#noteSlot');
  noteSlot.innerHTML = g.note ? `<div class="guide-note">💡<span>${g.note}</span></div>` : '';

  renderStats();
}

function renderStats(){
  $('#gBookmarkCount').textContent = state.bookmarks.size;
  const completedGuides = GUIDES.filter(g => state.completedSteps[g.id].size===g.steps.length && g.steps.length>0).length;
  $('#gCompletedCount').textContent = `${completedGuides} of ${GUIDES.length}`;
  const curG = getGuide(state.selectedGuide);
  $('#gContinueLabel').textContent = curG ? curG.title : 'No guide selected';
}

function renderAll(){
  renderSidebar();
  renderGuide();
}

/* ============================================================
   Actions
   ============================================================ */
function selectGuide(id, opts){
  opts = opts || {};
  // Toggle: if this guide is already selected, close it
  if(state.selectedGuide === id){
    state.selectedGuide = null;
    window.__WWP_currentGuide = null;
    renderAll();
    return;
  }
  state.selectedGuide = id;
  window.__WWP_currentGuide = id;
  renderAll();
  const pane = document.querySelector('#page-guides .guide-pane');
  if(pane) pane.scrollIntoView({behavior:'smooth', block:'start'});

  // Keep the URL in sync with the guide being read (e.g. /guides/wudu)
  // so each guide is independently linkable and indexable. Goes
  // straight to history.pushState (rather than back through
  // window.switchPage/WWP_openGuide) so clicking a guide in the list
  // can't re-trigger guide-selection and loop back into itself.
  if(!opts.skipRoute){
    const path = '/guides/'+id;
    if(location.pathname !== path){
      history.pushState({page:'guides', guide:id}, '', path);
    }
    if(window.__WWP_updateGuideSEO) window.__WWP_updateGuideSEO(id);
  }
}

function toggleStep(guideId, idx){
  const set = state.completedSteps[guideId];
  if(set.has(idx)) set.delete(idx); else set.add(idx);
  persistGuides();
  renderAll();
}

function toggleBookmark(id){
  if(state.bookmarks.has(id)){ state.bookmarks.delete(id); showToast('Removed from bookmarks'); }
  else { state.bookmarks.add(id); showToast('Guide bookmarked'); }
  persistGuides();
  renderAll();
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
async function init(){
  // Paint the guide shell first; bookmarks/progress hydrate afterwards.
  renderAll();
  loadGuidesFromBackend().then(renderAll).catch(()=>0);

  $('#guideBmBtn').addEventListener('click', ()=> { if(state.selectedGuide) toggleBookmark(state.selectedGuide); });
  $('#guideShareBtn').addEventListener('click', ()=>{
    const g = getGuide(state.selectedGuide);
    if(!g) return;
    const text = `${g.title} — WhereWePraying?`;
    Platform.share({title:'Guides', text}, ()=>{
      Platform.copyToClipboard(text, {onSuccess:()=>showToast('Link copied — share it with others'), onFail:()=>showToast('Sharing is not available on this device')});
    });
  });
  $('#progressReset').addEventListener('click', ()=>{
    if(!state.selectedGuide) return;
    state.completedSteps[state.selectedGuide] = new Set();
    persistGuides();
    renderAll();
    showToast('Progress reset for this guide');
  });

  // ==> CONNECT (resolved): bookmarks/progress now sync per-device via
  // WWP above. GUIDES content itself is still placeholder text pending
  // a scholar-reviewed source — separate from storage.

  // Tell the router this section is ready — if a direct visit landed
  // on /guides/<slug> before this section finished initializing, the
  // router queued the slug and opens it now.
  if(window.__WWP_guideSectionReady) window.__WWP_guideSectionReady();
}

// Cross-page deep link: lets other pages jump straight to a specific
// guide (e.g. "Explore More" cards on other sections, or the router
// resolving a direct visit to /guides/<slug>). `opts.skipRoute` is
// used internally by the router on initial load / back-forward,
// where it already owns the URL for that navigation.
window.WWP_openGuide = function(guideId, opts){
  opts = opts || {};
  if(guideId) selectGuide(guideId, {skipRoute:true});
  // Pass the *post-toggle* current guide (not the raw guideId argument)
  // on to switchPage. selectGuide() above toggles closed if guideId was
  // already open, setting __WWP_currentGuide back to null — passing the
  // original guideId here instead would make switchPage think a new
  // guide selection is needed and immediately reopen the one we just
  // closed, which is why a second tap on an open guide used to do
  // nothing (open -> close -> instant reopen).
  window.switchPage('guides', {guide: window.__WWP_currentGuide, skipHistory: !!opts.skipRoute});
};

// Fetches the guide content (previously a 200KB+ literal baked into this
// file) from a static JSON file instead, caching it in IndexedDB via
// WWP_fetchCached (see wwp-core.js) so it still works offline after the
// first successful load. init() above already painted an empty shell,
// so the guide list/detail pane simply re-renders once this resolves.
async function loadGuidesData(){
  try{
    const data = await window.WWP_fetchCached('/assets/data/guides.json', 'guides_data');
    if(Array.isArray(data) && data.length){
      GUIDES.push(...data);
      GUIDES.forEach(g => { state.completedSteps[g.id] = new Set(); });
      QA.forEach(q => { state.completedSteps[q.id] = new Set(); });
      OfflineSync.syncGuides(GUIDES).catch(()=>0);
      // Reuses the Du'a & Dhikr categories (window.CATEGORIES, set by
      // dua.js) for the same offline sync guides.js already did before
      // this refactor — only runs if dua.js happens to have loaded
      // already (e.g. visited earlier this session); otherwise dua.js
      // does this same sync itself once its own page is opened.
      if(window.CATEGORIES && window.CATEGORIES.length) OfflineSync.syncCategories(window.CATEGORIES).catch(()=>0);
      renderAll();
      if(window.renderGroupedGuides) window.renderGroupedGuides();
    }
  }catch(err){
    console.log('Guides content failed to load:', err);
    showToast("Couldn't load guides — check your connection and try again");
  }
}

init();
loadGuidesData();

})();

/* ===== deferred: guides display override (grouped-by-category rendering) ===== */

/* ===== deferred feature script 08 ===== */
(function(){
// ==> GUIDES DISPLAY OVERRIDE
(function() {
  // Hook the real router (window.switchPage) rather than a nonexistent
  // window.showPage. switchPage is assigned synchronously above, so it
  // exists by the time this IIFE runs (this script tag loads after it).
  const originalSwitchPage = window.switchPage;
  window.switchPage = function(id, opts) {
    originalSwitchPage.call(this, id, opts);
    if (id === 'guides') {
      setTimeout(renderGroupedGuides, 150);
    }
  };

  window.renderGroupedGuides = function() {
    const pageContent = document.querySelector('#page-guides .page');
    if (!pageContent) return;

    let container = pageContent.querySelector('.guides-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'guides-container grouped-guides';
      const layout = pageContent.querySelector('.guides-layout');
      if (layout) {
        layout.parentNode.insertBefore(container, layout.nextSibling);
      } else {
        pageContent.appendChild(container);
      }
    }

    container.innerHTML = '';

    // === All Guides Section ===
    const guidesSection = document.createElement('div');
    guidesSection.className = 'collapsible-section';

    const guidesHeader = document.createElement('div');
    guidesHeader.className = 'collapsible-header open';
    guidesHeader.textContent = 'All Guides (Grouped by Category)';

    const guidesList = document.createElement('div');
    guidesList.className = 'collapsible-content';

    guidesHeader.addEventListener('click', function() {
      this.classList.toggle('open');
      guidesList.classList.toggle('closed');
    });

    guidesSection.appendChild(guidesHeader);
    guidesSection.appendChild(guidesList);

    Object.keys(GUIDE_CATEGORIES).forEach(cat => {
      const ids = GUIDE_CATEGORIES[cat];
      const guides = GUIDES.filter(g => ids.includes(g.id));
      const color = CATEGORY_COLORS[cat];

      if (guides.length > 0) {
        const catDiv = document.createElement('div');
        catDiv.className = 'guides-category';

        const catTitle = document.createElement('h3');
        catTitle.className = 'category-title';
        catTitle.textContent = cat;
        catDiv.appendChild(catTitle);

        const grid = document.createElement('div');
        grid.className = 'guides-grid';

        guides.forEach(g => {
          const card = document.createElement('div');
          card.className = 'guide-card';
          card.style.borderLeft = `4px solid ${color}`;

          const header = document.createElement('div');
          header.className = 'guide-header';

          const title = document.createElement('span');
          title.className = 'guide-title';
          title.textContent = g.title;

          const time = document.createElement('span');
          time.className = 'guide-time';
          time.textContent = g.time;

          header.appendChild(title);
          header.appendChild(time);
          card.appendChild(header);

          const summary = document.createElement('div');
          summary.className = 'guide-summary';
          summary.textContent = g.summary;
          card.appendChild(summary);

          card.addEventListener('click', () => window.WWP_openGuide(g.id));

          grid.appendChild(card);
        });

        catDiv.appendChild(grid);
        guidesList.appendChild(catDiv);
      }
    });

    container.appendChild(guidesSection);
  };

  // If the guides page is already the active page on load (e.g. direct
  // URL to /guides/...), render immediately rather than waiting for a
  // switchPage call that may never come.
  document.addEventListener('DOMContentLoaded', function() {
    const guidesPageEl = document.getElementById('page-guides');
    if (guidesPageEl && !guidesPageEl.classList.contains('hidden')) {
      setTimeout(renderGroupedGuides, 150);
    }
  });
})();
// <== GUIDES DISPLAY OVERRIDE

})();
/* ============================================================
   STORAGE SERVICE :: single documented home for how WhereWePraying
   persists data. This file does not move or redefine anything —
   WWP and OfflineData must stay defined early in wwp-core.js since
   other early code depends on them existing immediately. This file
   is the "front door": it names the three storage mechanisms in
   use, points at where each actually lives, and gives new code a
   consistent local-cache helper to use instead of raw localStorage.

   1) window.WWP        — anonymous device-id-scoped backend sync.
      Defined in: wwp-core.js (top of file).
      Use for: data that should follow the user's device across
      sessions via the backend (journal, dua/guides bookmarks,
      settings, etc). WWP.save(section, data) / WWP.get(section).

   2) window.OfflineData — IndexedDB wrapper for offline access.
      Defined in: wwp-core.js (shared core section).
      Use for: larger cached datasets that need to work offline
      (Qur'an text, Dua/Dhikr categories, Guides content).
      OfflineData.set(store, value) / OfflineData.get(store, key).

   3) Raw localStorage — device-local, non-synced preferences and
      caches (e.g. Prayer Times location/method cache, Qur'an
      per-surah text/translation/tafsir cache, Travel Mode home
      location, flight list, UI preferences like clock format).
      Currently called directly (not through a wrapper) in:
      prayer-times.js, quran.js, travel-mode.js, auth.js.

   ==> KNOWN ARCHITECTURE DEBT (intentionally not auto-migrated):
   That third category is scattered raw localStorage.getItem/
   setItem calls rather than going through one helper. Rewriting
   all of those call sites to route through LocalCache below would
   touch device-local caches for existing users — a real risk to
   test carefully rather than do as a blind bulk find/replace, so
   it wasn't done as part of this pass. New code should use
   LocalCache from here on; migrating old call sites is a separate,
   deliberate follow-up task, not urgent or production-breaking.
   ============================================================ */
window.LocalCache = (function(){
  function get(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(raw === null || raw === undefined) return fallback;
      try{ return JSON.parse(raw); }catch(e){ return raw; }
    }catch(e){ return fallback; }
  }
  function set(key, value){
    try{
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    }catch(e){ return false; }
  }
  function remove(key){
    try{ localStorage.removeItem(key); return true; }catch(e){ return false; }
  }
  return { get, set, remove };
})();

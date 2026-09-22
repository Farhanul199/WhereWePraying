// functions/_lib/area-times.js
//
// READ, DON'T COPY.
//
// Every mosque we collect from Mawaqit already carries its own full year
// of jama'ah times. We keep that year as-is and simply read the day the
// visitor asked for. The only thing we store per mosque is a small
// month-sized page of that year (mosque_month_times), so a busy city
// query reads a few hundred KB instead of a few hundred MB.
//
//   mosque_month_times(mosque, month 'YYYY-MM', times, jummah, source)
//     times  = one 20-character block per day: 5 prayers x "HHMM",
//              "----" where a mosque has no jama'ah time for that prayer.
//              A whole month is ~620 characters.
//     source = every linked source that actually contributed a slot to
//              this page, most-trusted first ("mawaqit+masjidbox_scrape")
//              - an admin diagnostic label, not something the site reads.
//
// A mosque linked to more than one source (e.g. Mawaqit AND MasjidBox)
// gets ONE merged page: each of the 5 daily slots is taken from the
// most-trusted linked source that actually HAS it, so one source's gaps
// get patched by the next instead of a whole month losing to whichever
// source is "most trusted" even when it only half-covers that mosque.
// See mergeEntries() and SOURCE_RANK below.
//
// Nothing is written per day, and nothing expires. A month page is
// written once, and rewritten only when one of that mosque's linked
// sources' own timetable changes. Months are filled in three ways, all
// of them cheap:
//   1. the admin "Prepare times" button (bulk, for a country going live)
//   2. automatically, the first time someone looks at an area whose
//      mosques have no page yet (so we only ever do work where there
//      are actually users)
//   3. the same code path rolls into the next month on its own
//
// Areas: a visitor's position is rounded to a ~7-mile grid cell, and the
// answer for that cell is cached at Cloudflare's edge and in KV. The
// first visitor in a cell builds it; everyone else that day is served
// without touching the database.

import { buildCalculatedMonthPage, isCalcMaghribEnabled } from './calculated-times.js';

const GRID_SIZE_DEG = 0.1;            // ~7 miles - area bucket
const CANDIDATE_BOX_MILES = 25;       // what one area file covers
const EDGE_TTL = 3600;                // 1 hour at this Cloudflare location
const KV_TTL = 21600;                 // 6 hours, shared worldwide
// Bump AREA_CACHE_VERSION to throw away every cached area at once (e.g.
// after a fix that changes what an area holds). merge-duplicates.js also
// clears today's KV areas after a merge, using AREA_KV_PREFIX.
export const AREA_CACHE_VERSION = 5;
export const AREA_KV_PREFIX = `mq_area_v${AREA_CACHE_VERSION}:`;
const MAX_COMPILE_PER_AREA = 120;     // year->month pages built per area build
// "Current schedule" sources (Masjidal, Takbeer Time - a snapshot, not a
// full calendar) stop being shown after this many days without a fresh
// scrape, rather than risk serving an outdated timetable forever. This
// check runs in-memory while building a page a visitor is already
// requesting - it doesn't scrape, write, or store anything on its own,
// so changing this number has no effect on D1 or Cloudflare usage either
// way. Shortened from 45 as asked; if the goal was reducing actual
// usage, the levers for that are elsewhere (cache TTLs, batch sizes),
// not this constant.
const SNAPSHOT_MAX_AGE_DAYS = 30;
const YEAR_SOURCES = ['mawaqit'];
const SNAPSHOT_SOURCES = ['masjidal', 'takbeertime', 'mosqueslondon'];
// Every source whose timetable lives on source_discoveries (not jamaah_raw).
const DISCOVERY_TIME_SOURCES = ['mawaqit', 'masjidal', 'takbeertime', 'mosqueslondon'];
const DISCOVERY_TIME_SQL = DISCOVERY_TIME_SOURCES.map((s) => `'${s}'`).join(',');
// mosques.london publishes ONE dated day. It's used only for the 7 days
// from that date, and never across a clock change - nothing older, and
// nothing carried forward. Maghrib is never stored for it (moves daily).
const DATED_SNAPSHOT_DAYS = 7;
function lastSundayUtc(y, month0) {
  const d = new Date(Date.UTC(y, month0 + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
function isBst(iso) {
  const y = +iso.slice(0, 4);
  return iso >= lastSundayUtc(y, 2) && iso < lastSundayUtc(y, 9);
}
const PRAYERS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];

/* ------------------------------------------------------------ dates */

export function londonNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { dateIso: `${g('year')}-${g('month')}-${g('day')}`, minutes: parseInt(g('hour'), 10) * 60 + parseInt(g('minute'), 10) };
}
export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const monthKey = (iso) => iso.slice(0, 7);
// The calendar month after this date's month. (Adding 32 days skipped a
// month from late in some months - e.g. 30 March + 32 days = 1 May - so
// April's page was never prepared and "tomorrow's Fajr" went missing.)
export function nextMonthKey(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const daysInMonth = (key) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();

/* ------------------------------------------------- month page format */

function pack(t) { return t ? t.slice(0, 2) + t.slice(3, 5) : '----'; }
function unpack(chunk) { return chunk === '----' ? null : chunk.slice(0, 2) + ':' + chunk.slice(2, 4); }

// Pull one day out of a month page.
export function readDay(times, dateIso) {
  if (!times) return null;
  const day = +dateIso.slice(8, 10);
  const block = times.slice((day - 1) * 20, day * 20);
  if (block.length < 20) return null;
  const out = {};
  let any = false;
  PRAYERS.forEach((p, i) => {
    const v = unpack(block.slice(i * 4, i * 4 + 4));
    out[p] = v;
    if (v) any = true;
  });
  return any ? out : null;
}

/* ------------------------------------------------ year -> month page */

function safeJson(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function hm(v) {
  const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(String(v == null ? '' : v));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h <= 23 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}
function ampm(v) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(String(v == null ? '' : v));
  if (!m) return hm(v);
  let h = +m[1];
  const pm = m[3].toUpperCase() === 'PM';
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
const toMins = (t) => (+t.slice(0, 2)) * 60 + (+t.slice(3, 5));
const fromMins = (x) => { x = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

function monthEntry(cal, month, day) {
  if (!cal) return null;
  const list = Array.isArray(cal) ? cal : Object.values(cal);
  if (list.length !== 12) return null;
  const days = list[month];
  if (!days) return null;
  const e = Array.isArray(days) ? days[day - 1] : (days[day] || days[String(day)]);
  return Array.isArray(e) ? e : null;
}

// Build one month page for one mosque out of whatever that source stores.
// Returns { times, jummah } or null when the mosque has no usable
// jama'ah data - we never invent or estimate a time.
export function buildMonthPage(row, key) {
  const days = daysInMonth(key);
  const month = +key.slice(5, 7) - 1;
  let out = '';
  let jummah = null;

  if (YEAR_SOURCES.includes(row.source)) {
    if (!row.iqama_enabled) return null;
    if (row.quality === 'bad' || row.iqama_quality === 'bad' || row.iqama_quality === 'placeholder') return null;
    const cal = safeJson(row.calendar_json), iq = safeJson(row.iqama_json);
    if (!cal || !iq) return null;
    let any = false;
    for (let d = 1; d <= days; d++) {
      const b = monthEntry(cal, month, d), q = monthEntry(iq, month, d);
      const begin = b ? [b[0], b[2], b[3], b[4], b[5]].map(hm) : [null, null, null, null, null];
      for (let p = 0; p < 5; p++) {
        let t = null;
        const rawv = q ? String(q[p] == null ? '' : q[p]).trim() : '';
        const off = /^\+\s*(\d{1,3})$/.exec(rawv);
        if (off && begin[p]) t = +off[1] > 150 ? null : fromMins(toMins(begin[p]) + +off[1]);
        else if (rawv) t = hm(rawv);
        // a jama'ah can't come before its prayer begins, or hours after
        if (t && begin[p]) { const diff = ((toMins(t) - toMins(begin[p])) + 1440) % 1440; if (diff > 150 && diff < 1437) t = null; }
        if (t) any = true;
        out += pack(t);
      }
    }
    if (!any) return null;
    const j1 = row.jumua_as_duhr ? null : hm(row.jumua);
    const j2 = hm(row.jumua2);
    if (j1 || j2) jummah = JSON.stringify({ 1: j1 || undefined, 2: j2 || undefined });
    return { times: out, jummah };
  }

  if (SNAPSHOT_SOURCES.includes(row.source)) {
    if (row.source === 'takbeertime' && !row.iqama_enabled) return null; // unverified community entry
    if (row.source === 'mosqueslondon') return mosquesLondonPage(row, key, days);
    const age = row.times_updated_at ? (Date.now() - Date.parse(row.times_updated_at)) / 86400000 : 999;
    if (!(age < SNAPSHOT_MAX_AGE_DAYS)) return null;
    const cal = safeJson(row.calendar_json);
    if (!cal) return null;
    const src = row.source === 'masjidal' ? (cal.iqamah || {}) : cal;
    const day = [ampm(src.fajr), ampm(src.zuhr || src.dhuhr), ampm(src.asr), ampm(src.maghrib), ampm(src.isha)];
    if (day.every((x) => !x)) return null;
    const block = day.map(pack).join('');
    out = block.repeat(days);
    const j1 = ampm(row.jumua), j2 = ampm(row.jumua2);
    if (j1 || j2) jummah = JSON.stringify({ 1: j1 || undefined, 2: j2 || undefined });
    return { times: out, jummah };
  }

  return null;
}

// mosques.london: prefer a full committee-sourced year calendar (real
// Maghrib included - see scrape-mosqueslondon.js mode=importYear, which
// writes one packed month blob per month, exactly like this table's own
// format, so no expansion work happens on the request path). Falls back
// to the older single dated snapshot (7 days, no Maghrib) for any
// mosque only ever given a one-day export.
function mosquesLondonPage(row, key, days) {
  const cal = safeJson(row.calendar_json);
  if (!cal) return null;
  if (cal.shape === 'year' && cal.months) {
    const blob = cal.months[key];
    if (!blob || blob.length !== days * 20 || !/[0-9]/.test(blob)) return null;
    const j1 = hm(row.jumua), j2 = hm(row.jumua2);
    return { times: blob, jummah: (j1 || j2) ? JSON.stringify({ 1: j1 || undefined, 2: j2 || undefined }) : null };
  }
  return datedSnapshotPage(row, key, days);
}

// mosques.london: fill only the days from the published date, up to 7,
// stopping at a clock change. Every other day stays '----'.
function datedSnapshotPage(row, key, days) {
  const cal = safeJson(row.calendar_json);
  if (!cal || !/^\d{4}-\d{2}-\d{2}$/.test(cal.date || '')) return null;
  const day = [hm(cal.fajr), hm(cal.zuhr), hm(cal.asr), null, hm(cal.isha)];
  if (day.every((x) => !x)) return null;
  const block = day.map(pack).join('');
  const bst = isBst(cal.date);
  const last = addDaysIso(cal.date, DATED_SNAPSHOT_DAYS - 1);
  let out = '', any = false;
  for (let d = 1; d <= days; d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    if (iso >= cal.date && iso <= last && isBst(iso) === bst) { out += block; any = true; }
    else out += '-'.repeat(20);
  }
  if (!any) return null;
  const j1 = hm(row.jumua), j2 = hm(row.jumua2);
  return { times: out, jummah: (j1 || j2) ? JSON.stringify({ 1: j1 || undefined, 2: j2 || undefined }) : null };
}

/* ----------------------------------------------------------- schema */

let ready = false;
export async function ensureTimesSchema(db) {
  if (ready) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS mosque_month_times (
       mosque TEXT NOT NULL, month TEXT NOT NULL, times TEXT, jummah TEXT,
       source TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (mosque, month))`
  ).run();
  try { await db.prepare(`ALTER TABLE source_discoveries ADD COLUMN compiled_through TEXT`).run(); } catch (e) {}
  try { await db.prepare(`ALTER TABLE source_discoveries ADD COLUMN compiled_at TEXT`).run(); } catch (e) {}
  try { await db.prepare(`ALTER TABLE source_discoveries ADD COLUMN has_times INTEGER`).run(); } catch (e) {}
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS mosque_aliases (
       mosque_slug TEXT NOT NULL, alias TEXT NOT NULL, source TEXT,
       created_at TEXT NOT NULL, PRIMARY KEY (mosque_slug, alias))`
  ).run();
  ready = true;
}

const TIMETABLE_COLS = `sd.source, sd.source_ref, sd.calendar_json, sd.iqama_json, sd.iqama_enabled,
  sd.jumua, sd.jumua2, sd.jumua_as_duhr, sd.quality, sd.iqama_quality, sd.times_updated_at`;

// A mosque can be linked to more than one timetable source (e.g. the same
// mosque on Mawaqit AND MasjidBox). Every linked source is merged into
// ONE page per mosque per month, per prayer, per day: for each of the 5
// daily slots, the most-trusted source that actually HAS a value wins
// that slot - not "the most trusted source that has anything", so one
// source's gaps get patched by the next rather than a whole month
// losing to a source that only half-covers that mosque. See
// mergeEntries() below; writePage() just stores whatever mergeEntries()
// (or, for the calculated-Maghrib fallback, buildCalculatedMonthPage())
// decided, unconditionally - the merge itself is the authority now,
// there's nothing left for a WHERE guard on the write to decide.
//
// Order (most to least trusted): Mawaqit, then mosques.london (a real
// committee-submitted year calendar, not the old one-day snapshot - see
// scrape-mosqueslondon.js), then MasjidBox and MyMasjid (tied), then
// DITIB, then Takbeer Time, then Masjidal.
//   - DITIB has no prayer-time pipeline at all (see scrape-ditib.js -
//     it's location-only, always shows "No live prayer time available"),
//     so its rank here is never actually exercised - included only for
//     a complete, documented order.
export const SOURCE_RANK = { mawaqit: 1, mosqueslondon: 2, masjidbox_scrape: 3, mymasjid_scrape: 3, ditib: 4, takbeertime: 5, masjidal: 6, calculated: 7 };

function writePage(db, slug, key, page, source, now) {
  return db.prepare(
    `INSERT INTO mosque_month_times (mosque, month, times, jummah, source, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(mosque, month) DO UPDATE SET times=excluded.times, jummah=excluded.jummah,
       source=excluded.source, updated_at=excluded.updated_at`
  ).bind(slug, key, page ? page.times : null, page ? page.jummah : null, source, now);
}

// Combine every linked source's own page for one mosque, one month, into
// a single blob, slot by slot (see the SOURCE_RANK comment above for
// why). `entries` is [{source, blob, jummah}]; blob is the same 20-
// chars-per-day packed format buildMonthPage()/buildDailyMonthPage()
// both already produce. `source` on the result is every source that
// actually contributed at least one slot, most-trusted first
// ("mawaqit+masjidbox_scrape") - an admin diagnostic label, not
// something the site reads.
function mergeEntries(entries, key) {
  if (!entries.length) return null;
  const ranked = entries.slice().sort((a, b) => (SOURCE_RANK[a.source] || 9) - (SOURCE_RANK[b.source] || 9));
  const days = daysInMonth(key);
  let out = '';
  const contributors = [];
  for (let d = 0; d < days; d++) {
    for (let p = 0; p < 5; p++) {
      let val = '----';
      for (const e of ranked) {
        const chunk = e.blob.slice(d * 20 + p * 4, d * 20 + p * 4 + 4);
        if (chunk && chunk !== '----') {
          val = chunk;
          if (!contributors.includes(e.source)) contributors.push(e.source);
          break;
        }
      }
      out += val;
    }
  }
  if (!/[0-9]/.test(out)) return null;
  let jummah = null;
  for (const e of ranked) { if (e.jummah) { jummah = e.jummah; break; } }
  return { times: out, jummah, source: contributors.join('+').slice(0, 60) };
}

/* --------------------------------------- daily-row sources (MasjidBox,
   MyMasjid): one row per mosque per day in jamaah_raw, not a whole
   calendar/year dump like buildMonthPage() above expects. Packed into
   the exact same mosque_month_times format so readDay() and everything
   downstream needs no changes - this is a second WRITER for that table,
   reading a different shape of source data. */

export const DAILY_SOURCES = ['masjidbox_scrape', 'mymasjid_scrape'];

function buildDailyMonthPage(dayRows, key) {
  const days = daysInMonth(key);
  const byDate = new Map(dayRows.map((r) => [r.date, r]));
  let out = '';
  let any = false;
  for (let d = 1; d <= days; d++) {
    const dateIso = `${key}-${String(d).padStart(2, '0')}`;
    const r = byDate.get(dateIso);
    for (const p of PRAYERS) {
      const t = r ? hm(r[p + '_jamaah']) : null;
      if (t) any = true;
      out += pack(t);
    }
  }
  return any ? { times: out, jummah: null } : null;
}

/* ----------------------------------------- shared merge-and-compile,
   used by fillMissing() (lazy, per visited area), prepareMonths() (the
   admin "Prepare times" bulk button) and prepareDailySourceMonths()
   (its MasjidBox/MyMasjid counterpart) alike, so a mosque linked to
   several sources always gets the SAME best-of-everything page no
   matter which of the three triggered the rebuild. Two batched reads
   regardless of how many mosques - never one query per mosque. */

async function fetchDiscoveryEntries(db, slugs) {
  const map = new Map();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    const ph = part.map((_, k) => '?' + (k + 1)).join(',');
    const { results } = await db.prepare(
      `SELECT ms.mosque_slug AS slug, ${TIMETABLE_COLS}
         FROM mosque_sources ms JOIN source_discoveries sd
           ON sd.source = ms.source AND sd.source_ref = ms.source_ref
        WHERE ms.mosque_slug IN (${ph}) AND sd.times_status = 'ok'
          AND sd.source IN (${DISCOVERY_TIME_SQL})`
    ).bind(...part).all();
    for (const r of results || []) { if (!map.has(r.slug)) map.set(r.slug, []); map.get(r.slug).push(r); }
  }
  return map;
}

async function fetchDailyEntries(db, slugs, thisKey, nextKey) {
  const map = new Map();
  const start = `${thisKey}-01`, end = addDaysIso(`${nextKey}-01`, daysInMonth(nextKey));
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    const ph = part.map((_, k) => '?' + (k + 1)).join(',');
    const { results } = await db.prepare(
      `SELECT ms.mosque_slug AS slug, r.source, r.date, r.fajr_jamaah, r.zuhr_jamaah, r.asr_jamaah, r.maghrib_jamaah, r.isha_jamaah
         FROM jamaah_raw r JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
        WHERE ms.mosque_slug IN (${ph}) AND r.source IN (${DAILY_SOURCES.map((s) => `'${s}'`).join(',')})
          AND r.date >= ?${part.length + 1} AND r.date < ?${part.length + 2}`
    ).bind(...part, start, end).all();
    for (const r of results || []) { if (!map.has(r.slug)) map.set(r.slug, []); map.get(r.slug).push(r); }
  }
  return map;
}

// One mosque's merged page for one month, from whichever of its linked
// sources (discovery-based or daily-based) already showed up in the two
// batched fetches above.
function mergedPageFor(slug, key, discBySlug, dailyBySlug) {
  const list = [];
  for (const src of discBySlug.get(slug) || []) {
    const p = buildMonthPage(src, key);
    if (p) list.push({ source: src.source, blob: p.times, jummah: p.jummah });
  }
  const dayRows = (dailyBySlug.get(slug) || []).filter((r) => monthKey(r.date) === key);
  if (dayRows.length) {
    const bySrc = new Map();
    for (const r of dayRows) { if (!bySrc.has(r.source)) bySrc.set(r.source, []); bySrc.get(r.source).push(r); }
    for (const [src, rowsForSrc] of bySrc) {
      const p = buildDailyMonthPage(rowsForSrc, key);
      if (p) list.push({ source: src, blob: p.times, jummah: p.jummah });
    }
  }
  return mergeEntries(list, key);
}

// Fetch + merge only (no write) - fillMissing() uses this directly so it
// can defer the actual database write to after the response goes out.
async function computeMergedPages(db, slugs, thisKey, nextKey) {
  if (!slugs.length) return new Map();
  const [discBySlug, dailyBySlug] = await Promise.all([
    fetchDiscoveryEntries(db, slugs),
    fetchDailyEntries(db, slugs, thisKey, nextKey),
  ]);
  const out = new Map();
  for (const slug of slugs) {
    out.set(slug, { a: mergedPageFor(slug, thisKey, discBySlug, dailyBySlug), b: mergedPageFor(slug, nextKey, discBySlug, dailyBySlug) });
  }
  return out;
}

// Fetch + merge + write, awaited to completion - what the two admin
// "prepare" jobs use, since they're expected to report a final count
// once done rather than fire-and-forget.
async function mergeAndWrite(db, slugs, thisKey, nextKey) {
  if (!slugs.length) return { withTimes: 0, without: 0 };
  const merged = await computeMergedPages(db, slugs, thisKey, nextKey);
  const now = new Date().toISOString();
  const stmts = [];
  let withTimes = 0, without = 0;
  for (const slug of slugs) {
    const { a, b } = merged.get(slug) || {};
    stmts.push(writePage(db, slug, thisKey, a, a ? a.source : null, now));
    stmts.push(writePage(db, slug, nextKey, b, b ? b.source : null, now));
    if (a || b) withTimes++; else without++;
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return { withTimes, without };
}

// The write-time invalidation hook. Call this right after writing new
// source data (jamaah_raw rows, a source_discoveries timetable, or a
// fresh mosque_sources link) for a known set of mosque slugs, so their
// month_times page is recompiled from ALL of that mosque's linked
// sources immediately - the visitor-facing page is correct on the very
// next request, no staleness check ever needed on the read path.
// Safe to call with duplicate/unlinked slugs (filters to non-empty).
// Best-effort: never throws, so a sync job's own response isn't held up
// or broken by a compile failure - errors are swallowed and left for
// the periodic prepareMonths()/prepareDailySourceMonths() safety net.
export async function recompileMosquePages(db, slugs) {
  const clean = [...new Set((slugs || []).filter(Boolean))];
  if (!clean.length) return { withTimes: 0, without: 0 };
  await ensureTimesSchema(db);
  const { dateIso } = londonNowParts();
  const thisKey = monthKey(dateIso);
  const nextKey = nextMonthKey(dateIso);
  try {
    return await mergeAndWrite(db, clean, thisKey, nextKey);
  } catch (e) {
    return { withTimes: 0, without: 0, error: String(e) };
  }
}

// Given a source + a list of source_ref codes that were just written to
// (e.g. MasjidBox slugs, MyMasjid IDs), look up which mosques they're
// currently linked to and recompile those mosques' pages. Call this at
// the end of every sync job right after its own writes. Unlinked source
// codes are simply skipped (nothing to recompile yet) - they'll pick up
// a mosque_slug the next time the admin matcher runs, which itself
// calls recompileMosquePages() directly once linked.
export async function recompileForSourceRefs(db, source, sourceRefs) {
  const refs = [...new Set((sourceRefs || []).filter(Boolean))];
  if (!refs.length) return { withTimes: 0, without: 0 };
  const slugs = new Set();
  for (let i = 0; i < refs.length; i += 90) {
    const part = refs.slice(i, i + 90);
    const ph = part.map((_, k) => '?' + (k + 2)).join(',');
    const { results } = await db.prepare(
      `SELECT DISTINCT mosque_slug FROM mosque_sources WHERE source = ?1 AND source_ref IN (${ph}) AND mosque_slug IS NOT NULL`
    ).bind(source, ...part).all();
    for (const r of results || []) slugs.add(r.mosque_slug);
  }
  return recompileMosquePages(db, [...slugs]);
}

// Same shape as prepareMonths() below, for the daily sources: find every
// (mosque, source) pair whose stored month page is missing or older than
// its newest jamaah_raw row, then merge-and-write the FULL set of
// affected mosques (every source each one has, not just its MasjidBox/
// MyMasjid row - see mergeAndWrite above). Staleness is tracked against
// mosque_month_times.updated_at directly (these sources never write to
// source_discoveries, unlike the year/snapshot ones above, so there's
// no compiled_through column to compare against here).
export async function prepareDailySourceMonths(db, limit) {
  await ensureTimesSchema(db);
  const { dateIso } = londonNowParts();
  const thisKey = monthKey(dateIso);
  const nextKey = nextMonthKey(dateIso);
  const n = Math.max(1, Math.min(limit || 120, 150));

  const { results } = await db.prepare(
    `SELECT ms.mosque_slug AS slug, ms.source, ms.source_ref, MAX(r.updated_at) AS latest
       FROM jamaah_raw r
       JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
      WHERE r.source IN (${DAILY_SOURCES.map((s) => `'${s}'`).join(',')}) AND ms.mosque_slug IS NOT NULL
      GROUP BY ms.mosque_slug, ms.source, ms.source_ref
     HAVING latest > COALESCE(
              (SELECT MIN(mt.updated_at) FROM mosque_month_times mt
                WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?1, ?2)),
              '')
         OR (SELECT COUNT(*) FROM mosque_month_times mt WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?1, ?2)) < 2
      LIMIT ${n}`
  ).bind(thisKey, nextKey).all();

  const rows = results || [];
  const slugs = [...new Set(rows.map((r) => r.slug))];
  const { withTimes, without } = await mergeAndWrite(db, slugs, thisKey, nextKey);

  const left = await db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT ms.mosque_slug, MAX(r.updated_at) AS latest
         FROM jamaah_raw r
         JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
        WHERE r.source IN (${DAILY_SOURCES.map((s) => `'${s}'`).join(',')}) AND ms.mosque_slug IS NOT NULL
        GROUP BY ms.mosque_slug, ms.source, ms.source_ref
       HAVING latest > COALESCE(
                (SELECT MIN(mt.updated_at) FROM mosque_month_times mt
                  WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?1, ?2)),
                '')
           OR (SELECT COUNT(*) FROM mosque_month_times mt WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?1, ?2)) < 2
     )`
  ).bind(thisKey, nextKey).first();

  return { checked: rows.length, withTimes, without, stillToPrepare: (left && left.n) || 0 };
}

/* -------------------------------------------------- bulk preparation */

// Admin "Prepare times": writes this month's and next month's pages for
// promoted mosques that don't have them yet. ~3 database writes per
// mosque, once - not per day.
export async function prepareMonths(db, limit) {
  await ensureTimesSchema(db);
  // One-time tidy-up: the old design copied these sources into one row
  // per mosque per day. Nothing reads those rows now, so clear them out.
  // After the first run this deletes nothing and costs nothing.
  try { await db.prepare(`DELETE FROM jamaah_raw WHERE source IN ('mawaqit','masjidal','takbeertime')`).run(); } catch (e) {}
  const { dateIso } = londonNowParts();
  const thisKey = monthKey(dateIso);
  const nextKey = nextMonthKey(dateIso);
  const n = Math.max(1, Math.min(limit || 120, 150));
  const { results } = await db.prepare(
    `SELECT ms.mosque_slug AS slug, ${TIMETABLE_COLS}
       FROM source_discoveries sd
       JOIN mosque_sources ms ON ms.source = sd.source AND ms.source_ref = sd.source_ref
      WHERE sd.times_status = 'ok' AND ms.mosque_slug IS NOT NULL
        AND sd.source IN (${DISCOVERY_TIME_SQL})
        AND (sd.compiled_through IS NULL OR sd.compiled_through < ?1
             OR (sd.times_updated_at IS NOT NULL AND (sd.compiled_at IS NULL OR sd.compiled_at < sd.times_updated_at)))
      LIMIT ${n}`
  ).bind(nextKey).all();

  const rows = results || [];
  // Diagnostics per stale (mosque, source) row - drives the "Progress by
  // source" table's Times Sent / no-times-in-source columns, so this
  // stays keyed exactly as before even though the ACTUAL write below
  // covers every source a mosque has, not just the stale one that got
  // it onto this list.
  const now = new Date().toISOString();
  const markStmts = [];
  let withTimes = 0, without = 0;
  for (const row of rows) {
    const a = buildMonthPage(row, thisKey);
    const b = buildMonthPage(row, nextKey);
    markStmts.push(db.prepare(
      `UPDATE source_discoveries SET compiled_through = ?1, compiled_at = ?2, has_times = ?3
        WHERE source = ?4 AND source_ref = ?5`
    ).bind(nextKey, now, (a || b) ? 1 : 0, row.source, row.source_ref));
    if (a || b) withTimes++; else without++;
  }
  for (let i = 0; i < markStmts.length; i += 90) await db.batch(markStmts.slice(i, i + 90));

  // The actual write: every mosque touched by this batch, merged across
  // ALL of its linked sources (see mergeAndWrite above), not just the
  // stale one above - so a mosque with e.g. both mosques.london and
  // MasjidBox linked gets the best of both instead of one blocking the
  // other.
  const slugs = [...new Set(rows.map((r) => r.slug))];
  await mergeAndWrite(db, slugs, thisKey, nextKey);

  const left = await db.prepare(
    `SELECT COUNT(*) AS n FROM source_discoveries sd JOIN mosque_sources ms
        ON ms.source = sd.source AND ms.source_ref = sd.source_ref
      WHERE sd.times_status='ok' AND ms.mosque_slug IS NOT NULL
        AND sd.source IN (${DISCOVERY_TIME_SQL})
        AND (sd.compiled_through IS NULL OR sd.compiled_through < ?1
             OR (sd.times_updated_at IS NOT NULL AND (sd.compiled_at IS NULL OR sd.compiled_at < sd.times_updated_at)))`
  ).bind(nextKey).first();
  return { checked: rows.length, withTimes, without, stillToPrepare: (left && left.n) || 0 };
}

/* ------------------------------------------------------ area loading */

export function milesToLat(miles) { return miles / 69; }
export function milesToLon(miles, atLat) {
  const per = 69 * Math.cos((atLat * Math.PI) / 180);
  return per > 0.1 ? miles / per : miles / 0.1;
}

const AREA_QUERY = `
  SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region, m.country,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         tmr.fajr_jamaah AS tomorrow_fajr,
         mt.times AS month_times, mt2.times AS next_month_times,
         mt.source AS month_source, mt2.source AS next_month_source,
         mt.updated_at AS month_updated_at,
         ph.r2_key AS photo_key,
         (SELECT GROUP_CONCAT(alias, '||') FROM mosque_aliases WHERE mosque_slug = m.slug) AS aliases
    FROM mosques m
    LEFT JOIN thm_jamaah_times t   ON t.mosque = m.slug AND t.date = ?1
    LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?2
    LEFT JOIN mosque_month_times mt  ON mt.mosque = m.slug  AND mt.month = ?3
    LEFT JOIN mosque_month_times mt2 ON mt2.mosque = m.slug AND mt2.month = ?4
    LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
   WHERE m.active = 1 AND m.type = 'mosque'
     AND m.latitude BETWEEN ?5 AND ?6 AND m.longitude BETWEEN ?7 AND ?8`;

function applyPage(row, dateIso, tomorrowIso, thisKey) {
  const isThisMonth = dateIso.slice(0, 7) === thisKey;
  const page = isThisMonth ? row.month_times : row.next_month_times;
  const pageSource = isThisMonth ? row.month_source : row.next_month_source;
  const today = readDay(page, dateIso);
  if (today && !row.fajr_jamaah && !row.zuhr_jamaah && !row.asr_jamaah && !row.maghrib_jamaah && !row.isha_jamaah) {
    row.fajr_jamaah = today.fajr; row.zuhr_jamaah = today.zuhr; row.asr_jamaah = today.asr;
    row.maghrib_jamaah = today.maghrib; row.isha_jamaah = today.isha;
    // Calculated pages only ever hold Maghrib - flag it so the UI can
    // mark it "Estimated for this area" rather than a real committee time.
    if (pageSource === 'calculated' && today.maghrib) row.maghrib_estimated = true;
  }
  if (!row.tomorrow_fajr) {
    const tPage = tomorrowIso.slice(0, 7) === thisKey ? row.month_times : row.next_month_times;
    const tmr = readDay(tPage, tomorrowIso);
    if (tmr) row.tomorrow_fajr = tmr.fajr;
  }
  delete row.month_times; delete row.next_month_times;
  delete row.month_source; delete row.next_month_source;
  delete row.month_updated_at;
  return row;
}

// Fill in month pages for mosques in this area that don't have one yet
// AT ALL, so an area is only ever "prepared" when someone actually
// looks at it. This is now the ONLY thing fillMissing does - it no
// longer re-checks every already-compiled mosque's sources for newer
// data on every cache miss (that per-request JOIN across every mosque
// in the viewport was the actual cause of slow /find-a-mosque loads).
//
// Staleness is handled at write time instead: every sync/scrape/import
// job calls recompileMosquePages() (below) for exactly the mosques it
// just touched, right after writing, so a page is fresh the moment its
// source changes - not "eventually, whenever a visitor's request
// happens to trigger a recheck". prepareMonths()/prepareDailySourceMonths()
// remain as a periodic safety net (run them on a schedule, e.g. from
// the r2-cache-builder cron) for anything a write-time call ever misses.
async function fillMissing(context, rows, thisKey, nextKey, dateIso, tomorrowIso) {
  const db = context.env.DB;
  const slugs = rows.filter((r) => !r.month_times && !r.next_month_times).map((r) => r.slug).slice(0, MAX_COMPILE_PER_AREA);
  if (!slugs.length) return;
  const byslug = new Map(rows.map((r) => [r.slug, r]));

  let merged = new Map();
  try { merged = await computeMergedPages(db, slugs, thisKey, nextKey); } catch (e) { return; }
  const calcOn = await isCalcMaghribEnabled(db).catch(() => false);

  const now = new Date().toISOString();
  const stmts = [];
  for (const slug of slugs) {
    const row = byslug.get(slug);
    if (!row) continue;
    let { a, b } = merged.get(slug) || {};

    // Last resort, gated by an admin toggle: only when no real source
    // covers this mosque at all does it get Maghrib computed from its
    // own coordinates - never a substitute for a real committee time.
    if (!a && !b && calcOn && row.latitude != null && row.longitude != null) {
      const ca = buildCalculatedMonthPage(row.latitude, row.longitude, row.country, thisKey);
      const cb = buildCalculatedMonthPage(row.latitude, row.longitude, row.country, nextKey);
      if (ca) a = { times: ca.times, jummah: ca.jummah, source: 'calculated' };
      if (cb) b = { times: cb.times, jummah: cb.jummah, source: 'calculated' };
    }
    if (!a && !b) continue;

    if (a) { row.month_times = a.times; row.month_source = a.source; }
    if (b) { row.next_month_times = b.times; row.next_month_source = b.source; }
    stmts.push(writePage(db, slug, thisKey, a, a ? a.source : null, now));
    stmts.push(writePage(db, slug, nextKey, b, b ? b.source : null, now));
  }

  if (stmts.length) {
    // Saving the pages is housekeeping - the visitor already has their
    // answer, so it happens after the response goes out.
    context.waitUntil((async () => {
      try { for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90)); } catch (e) {}
    })());
  }
}

// The one way every visitor-facing endpoint gets mosques + times.
// Cached per area per day: first visitor builds, everyone else is free.
export async function loadArea(context, lat, lon, dateIso) {
  const { env } = context;
  const tomorrowIso = addDaysIso(dateIso, 1);
  const thisKey = monthKey(dateIso);
  const nextKey = nextMonthKey(dateIso);

  const gLat = Math.round(lat / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gLon = Math.round(lon / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gridKey = `${gLat.toFixed(2)},${gLon.toFixed(2)}`;
  const cacheReq = new Request(`https://cache-key.internal/mosques/area?v=${AREA_CACHE_VERSION}&g=${gridKey}&d=${dateIso}`);
  const kvKey = `${AREA_KV_PREFIX}${gridKey}:${dateIso}`;
  const cache = caches.default;

  const edgeHit = await cache.match(cacheReq);
  if (edgeHit) return { rows: await edgeHit.json(), from: 'edge' };

  if (env.RATE_LIMIT) {
    const kvHit = await env.RATE_LIMIT.get(kvKey);
    if (kvHit) return { rows: JSON.parse(kvHit), from: 'kv' };
  }

  const latD = milesToLat(CANDIDATE_BOX_MILES), lonD = milesToLon(CANDIDATE_BOX_MILES, gLat);
  const binds = [dateIso, tomorrowIso, thisKey, nextKey, gLat - latD, gLat + latD, gLon - lonD, gLon + lonD];
  let results;
  try {
    ({ results } = await env.DB.prepare(AREA_QUERY).bind(...binds).all());
  } catch (e) {
    // First run after deploy: the month-page table doesn't exist yet.
    // Create it and try once more, so a visitor never sees a broken page.
    await ensureTimesSchema(env.DB);
    ({ results } = await env.DB.prepare(AREA_QUERY).bind(...binds).all());
  }
  const rows = results || [];
  await fillMissing(context, rows, thisKey, nextKey, dateIso, tomorrowIso);
  const out = rows.map((r) => applyPage(r, dateIso, tomorrowIso, thisKey));

  const body = JSON.stringify(out);
  context.waitUntil(cache.put(cacheReq, new Response(body, {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${EDGE_TTL}` },
  })));
  if (env.RATE_LIMIT) context.waitUntil(env.RATE_LIMIT.put(kvKey, body, { expirationTtl: KV_TTL }));
  return { rows: out, from: 'db' };
}

// Drop today's cached areas (KV) so a data fix shows on the next visit
// instead of waiting up to 6 hours. Cloudflare's per-location edge copy
// can still take up to an hour. Best effort; capped to stay cheap.
export async function clearTodaysAreas(env, max = 300) {
  if (!env.RATE_LIMIT) return 0;
  const today = londonNowParts().dateIso;
  let cleared = 0, cursor;
  try {
    do {
      const page = await env.RATE_LIMIT.list({ prefix: AREA_KV_PREFIX, cursor, limit: 1000 });
      for (const k of page.keys) {
        if (!k.name.endsWith(':' + today)) continue;
        await env.RATE_LIMIT.delete(k.name);
        if (++cleared >= max) return cleared;
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch (e) { /* areas expire within 6 hours anyway */ }
  return cleared;
}

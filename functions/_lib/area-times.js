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
//
// Nothing is written per day, and nothing expires. A month page is
// written once, and rewritten only when that mosque's own timetable
// changes. Months are filled in three ways, all of them cheap:
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

const GRID_SIZE_DEG = 0.1;            // ~7 miles - area bucket
const CANDIDATE_BOX_MILES = 25;       // what one area file covers
const EDGE_TTL = 3600;                // 1 hour at this Cloudflare location
const KV_TTL = 21600;                 // 6 hours, shared worldwide
// Bump AREA_CACHE_VERSION to throw away every cached area at once (e.g.
// after a fix that changes what an area holds). merge-duplicates.js also
// clears today's KV areas after a merge, using AREA_KV_PREFIX.
export const AREA_CACHE_VERSION = 4;
export const AREA_KV_PREFIX = `mq_area_v${AREA_CACHE_VERSION}:`;
const MAX_COMPILE_PER_AREA = 120;     // year->month pages built per area build
const SNAPSHOT_MAX_AGE_DAYS = 45;     // "current schedule" sources go stale
const YEAR_SOURCES = ['mawaqit'];
const SNAPSHOT_SOURCES = ['masjidal', 'takbeertime'];
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
  ready = true;
}

const TIMETABLE_COLS = `sd.source, sd.source_ref, sd.calendar_json, sd.iqama_json, sd.iqama_enabled,
  sd.jumua, sd.jumua2, sd.jumua_as_duhr, sd.quality, sd.iqama_quality, sd.times_updated_at`;

// A mosque can be linked to more than one timetable source (e.g. the same
// mosque on Mawaqit AND Takbeer Time). Each source writes the same month
// row, so the rule for who wins matters - before this, whichever source
// happened to be written LAST won, even when it had no times at all, so a
// perfectly good Mawaqit timetable could be wiped by an empty one.
//
// Now: a source only replaces what's there if
//   - it's the same source updating its own page, or
//   - the page is currently empty, or
//   - it has real times AND it's at least as trusted as the current one.
// An empty result from a DIFFERENT source never wipes real times.
const SOURCE_RANK_SQL = (col) =>
  `CASE ${col} WHEN 'mawaqit' THEN 1 WHEN 'masjidal' THEN 2 WHEN 'takbeertime' THEN 3 ELSE 9 END`;
export const SOURCE_RANK = { mawaqit: 1, masjidal: 2, takbeertime: 3 };

function writePage(db, slug, key, page, source, now) {
  return db.prepare(
    `INSERT INTO mosque_month_times (mosque, month, times, jummah, source, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(mosque, month) DO UPDATE SET times=excluded.times, jummah=excluded.jummah,
       source=excluded.source, updated_at=excluded.updated_at
     WHERE mosque_month_times.source IS excluded.source
        OR mosque_month_times.times IS NULL
        OR (excluded.times IS NOT NULL
            AND ${SOURCE_RANK_SQL('excluded.source')} <= ${SOURCE_RANK_SQL('mosque_month_times.source')})`
  ).bind(slug, key, page ? page.times : null, page ? page.jummah : null, source, now);
}

/* --------------------------------------- daily-row sources (MasjidBox,
   MyMasjid): one row per mosque per day in jamaah_raw, not a whole
   calendar/year dump like buildMonthPage() above expects. Packed into
   the exact same mosque_month_times format so readDay() and everything
   downstream needs no changes - this is a second WRITER for that table,
   reading a different shape of source data. */

const DAILY_SOURCES = ['masjidbox_scrape', 'mymasjid_scrape'];

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

// Same shape as prepareMonths() below, for the daily sources: find every
// (mosque, source) pair whose stored month page is missing or older than
// its newest jamaah_raw row, rebuild this month + next month for it, and
// write it the same way buildMonthPage()'s output does. Staleness is
// tracked against mosque_month_times.updated_at directly (these sources
// never write to source_discoveries, unlike the year/snapshot ones
// above, so there's no compiled_through column to compare against here).
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
  const now = new Date().toISOString();
  const stmts = [];
  let withTimes = 0, without = 0;
  for (const row of rows) {
    const raw = await db.prepare(
      `SELECT date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah
         FROM jamaah_raw WHERE source = ?1 AND source_ref = ?2 AND date >= ?3 AND date < ?4`
    ).bind(row.source, row.source_ref, `${thisKey}-01`, addDaysIso(`${nextKey}-01`, daysInMonth(nextKey))).all();
    const byMonth = { [thisKey]: [], [nextKey]: [] };
    for (const r of raw.results || []) { const k = monthKey(r.date); if (byMonth[k]) byMonth[k].push(r); }
    const a = buildDailyMonthPage(byMonth[thisKey], thisKey);
    const b = buildDailyMonthPage(byMonth[nextKey], nextKey);
    stmts.push(writePage(db, row.slug, thisKey, a, row.source, now));
    stmts.push(writePage(db, row.slug, nextKey, b, row.source, now));
    if (a || b) withTimes++; else without++;
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));

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
        AND sd.source IN ('mawaqit','masjidal','takbeertime')
        AND (sd.compiled_through IS NULL OR sd.compiled_through < ?1
             OR (sd.times_updated_at IS NOT NULL AND (sd.compiled_at IS NULL OR sd.compiled_at < sd.times_updated_at)))
      LIMIT ${n}`
  ).bind(nextKey).all();

  const rows = results || [];
  const now = new Date().toISOString();
  const stmts = [];
  let withTimes = 0, without = 0;
  for (const row of rows) {
    const a = buildMonthPage(row, thisKey);
    const b = buildMonthPage(row, nextKey);
    stmts.push(writePage(db, row.slug, thisKey, a, row.source, now));
    stmts.push(writePage(db, row.slug, nextKey, b, row.source, now));
    stmts.push(db.prepare(
      `UPDATE source_discoveries SET compiled_through = ?1, compiled_at = ?2, has_times = ?3
        WHERE source = ?4 AND source_ref = ?5`
    ).bind(nextKey, now, (a || b) ? 1 : 0, row.source, row.source_ref));
    if (a || b) withTimes++; else without++;
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  const left = await db.prepare(
    `SELECT COUNT(*) AS n FROM source_discoveries sd JOIN mosque_sources ms
        ON ms.source = sd.source AND ms.source_ref = sd.source_ref
      WHERE sd.times_status='ok' AND ms.mosque_slug IS NOT NULL
        AND sd.source IN ('mawaqit','masjidal','takbeertime')
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
  SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         tmr.fajr_jamaah AS tomorrow_fajr,
         mt.times AS month_times, mt2.times AS next_month_times,
         ph.r2_key AS photo_key
    FROM mosques m
    LEFT JOIN thm_jamaah_times t   ON t.mosque = m.slug AND t.date = ?1
    LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?2
    LEFT JOIN mosque_month_times mt  ON mt.mosque = m.slug  AND mt.month = ?3
    LEFT JOIN mosque_month_times mt2 ON mt2.mosque = m.slug AND mt2.month = ?4
    LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
   WHERE m.active = 1 AND m.type = 'mosque'
     AND m.latitude BETWEEN ?5 AND ?6 AND m.longitude BETWEEN ?7 AND ?8`;

function applyPage(row, dateIso, tomorrowIso, thisKey) {
  const page = dateIso.slice(0, 7) === thisKey ? row.month_times : row.next_month_times;
  const today = readDay(page, dateIso);
  if (today && !row.fajr_jamaah && !row.zuhr_jamaah && !row.asr_jamaah && !row.maghrib_jamaah && !row.isha_jamaah) {
    row.fajr_jamaah = today.fajr; row.zuhr_jamaah = today.zuhr; row.asr_jamaah = today.asr;
    row.maghrib_jamaah = today.maghrib; row.isha_jamaah = today.isha;
  }
  if (!row.tomorrow_fajr) {
    const tPage = tomorrowIso.slice(0, 7) === thisKey ? row.month_times : row.next_month_times;
    const tmr = readDay(tPage, tomorrowIso);
    if (tmr) row.tomorrow_fajr = tmr.fajr;
  }
  delete row.month_times; delete row.next_month_times;
  return row;
}

// Fill in month pages for mosques in this area that don't have one yet,
// so an area is only ever "prepared" when someone actually looks at it.
async function fillMissing(context, rows, thisKey, nextKey, dateIso, tomorrowIso) {
  const missing = rows.filter((r) => !r.month_times && !r.next_month_times).map((r) => r.slug);
  if (!missing.length) return;
  const slugs = missing.slice(0, MAX_COMPILE_PER_AREA);
  const db = context.env.DB;
  const placeholders = slugs.map((_, i) => '?' + (i + 1)).join(',');
  let results;
  try {
    ({ results } = await db.prepare(
      `SELECT ms.mosque_slug AS slug, ${TIMETABLE_COLS}
         FROM mosque_sources ms JOIN source_discoveries sd
           ON sd.source = ms.source AND sd.source_ref = ms.source_ref
        WHERE ms.mosque_slug IN (${placeholders}) AND sd.times_status = 'ok'
          AND sd.source IN ('mawaqit','masjidal','takbeertime')`
    ).bind(...slugs).all());
  } catch (e) { return; }

  const now = new Date().toISOString();
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  const stmts = [];
  // Most trusted source first; a later (less trusted) source only fills a
  // month the better one left empty.
  const ordered = (results || []).slice().sort((x, y) => (SOURCE_RANK[x.source] || 9) - (SOURCE_RANK[y.source] || 9));
  for (const src of ordered) {
    const a = buildMonthPage(src, thisKey);
    const b = buildMonthPage(src, nextKey);
    const row = byslug.get(src.slug);
    if (row) {
      if (a && !row.month_times) row.month_times = a.times;
      if (b && !row.next_month_times) row.next_month_times = b.times;
    }
    stmts.push(writePage(db, src.slug, thisKey, a, src.source, now));
    stmts.push(writePage(db, src.slug, nextKey, b, src.source, now));
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

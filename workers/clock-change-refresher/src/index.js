// clock-change-refresher — re-checks every mosque's times after a clock change.
//
// Deployed from GitHub (Workers Builds, root: workers/clock-change-refresher).
// One-time setup: Worker Settings -> Variables -> add secret SYNC_SECRET
// (same value the site uses). Everything else is automatic.
//
// WHAT IT DOES
//  Every 10 minutes (cheap — nothing happens most of the year):
//  1. Planner (once a day): for every country that changes its clocks, looks
//     at the device clock rules (Intl / IANA tz data, so no hand-kept dates)
//     to see if that country's clocks changed in the last 3 days. If so, and
//     not already handled, it schedules a re-check of every mosque with live
//     times in that country, spread over SPREAD_DAYS starting the day after:
//       - Mawaqit         -> moves the runner's next_refresh_at into the window
//       - MasjidBox, Masjidal, Takbeer Time -> sets refresh_due_at
//       - UK staggered syncs (MyMasjid, MasjidBox jama'ah) -> full pass
//     Logged in clock_change_log, so each country is done once per change
//     (twice a year for most; Morocco also changes around Ramadan).
//  2. Driver: calls each source's mode=times&due=1 for mosques now due, and
//     walks the UK staggered lists slice by slice until done.
//
// Good times are never replaced by a failed or empty re-check.

const SPREAD_DAYS = 4;      // re-checks spread over this many days
const LOOKBACK_DAYS = 3;    // catch a change even if the planner missed a day
const CALLS_PER_SOURCE = 2; // per 10-min run, keeps well under subrequest caps

// Sources re-checked through their own mode=times&due=1 endpoint.
const DUE_SOURCES = {
  masjidbox:   { path: '/api/admin/scrape-masjidbox',   limit: 40 },
  masjidal:    { path: '/api/admin/scrape-masjidal',    limit: 30 },
  takbeertime: { path: '/api/admin/scrape-takbeertime', limit: 30 },
};

// UK-only staggered lists: one full pass after a GB change.
const UK_PASSES = {
  mymasjid_sync:  { path: '/api/admin/sync-mymasjid-jamaah-staggered',  step: 19 },
  masjidbox_sync: { path: '/api/admin/sync-masjidbox-jamaah-staggered', step: 50 },
};

// Countries that change clocks (or did recently / might again). The tz data
// decides each year whether a change actually happens, so a country that
// drops DST simply never triggers. First zone that changes wins.
const COUNTRY_ZONES = {
  GB: ['Europe/London'], IE: ['Europe/Dublin'], IM: ['Europe/Isle_of_Man'], JE: ['Europe/Jersey'], GG: ['Europe/Guernsey'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores'], ES: ['Europe/Madrid', 'Atlantic/Canary'], FR: ['Europe/Paris'], BE: ['Europe/Brussels'],
  NL: ['Europe/Amsterdam'], LU: ['Europe/Luxembourg'], DE: ['Europe/Berlin'], AT: ['Europe/Vienna'], CH: ['Europe/Zurich'],
  LI: ['Europe/Vaduz'], IT: ['Europe/Rome'], SM: ['Europe/San_Marino'], VA: ['Europe/Vatican'], MT: ['Europe/Malta'],
  MC: ['Europe/Monaco'], AD: ['Europe/Andorra'], GI: ['Europe/Gibraltar'], DK: ['Europe/Copenhagen'], FO: ['Atlantic/Faroe'],
  NO: ['Europe/Oslo'], SE: ['Europe/Stockholm'], FI: ['Europe/Helsinki'], AX: ['Europe/Mariehamn'], EE: ['Europe/Tallinn'],
  LV: ['Europe/Riga'], LT: ['Europe/Vilnius'], PL: ['Europe/Warsaw'], CZ: ['Europe/Prague'], SK: ['Europe/Bratislava'],
  HU: ['Europe/Budapest'], SI: ['Europe/Ljubljana'], HR: ['Europe/Zagreb'], BA: ['Europe/Sarajevo'], RS: ['Europe/Belgrade'],
  XK: ['Europe/Belgrade'], ME: ['Europe/Podgorica'], MK: ['Europe/Skopje'], AL: ['Europe/Tirane'], GR: ['Europe/Athens'],
  BG: ['Europe/Sofia'], RO: ['Europe/Bucharest'], MD: ['Europe/Chisinau'], UA: ['Europe/Kyiv', 'Europe/Kiev'], CY: ['Asia/Nicosia'],
  TR: ['Europe/Istanbul'], RU: ['Europe/Moscow'], BY: ['Europe/Minsk'],
  LB: ['Asia/Beirut'], IL: ['Asia/Jerusalem'], PS: ['Asia/Gaza', 'Asia/Hebron'], SY: ['Asia/Damascus'], JO: ['Asia/Amman'],
  IR: ['Asia/Tehran'], EG: ['Africa/Cairo'], MA: ['Africa/Casablanca'], EH: ['Africa/El_Aaiun'],
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage'],
  CA: ['America/Toronto', 'America/Vancouver', 'America/Winnipeg', 'America/Edmonton', 'America/Halifax', 'America/St_Johns'],
  MX: ['America/Tijuana', 'America/Ciudad_Juarez', 'America/Matamoros'], CU: ['America/Havana'], HT: ['America/Port-au-Prince'],
  BS: ['America/Nassau'], BM: ['Atlantic/Bermuda'], TC: ['America/Grand_Turk'], PM: ['America/Miquelon'], GL: ['America/Nuuk'],
  CL: ['America/Santiago'], PY: ['America/Asuncion'],
  AU: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Adelaide', 'Australia/Hobart'], NZ: ['Pacific/Auckland'],
  NF: ['Pacific/Norfolk'], FJ: ['Pacific/Fiji'],
};

const DAY = 86400000;
const UA = 'WhereWePraying-ClockRefresher/1.0 (+https://wherewepraying.com)';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch((e) => console.error('run failed', e && e.stack || e)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/status' || url.pathname === '/') return json(await status(env));
    return new Response('Not found', { status: 404 });
  },
};

async function run(env) {
  await setup(env.DB);
  await plan(env);
  await drive(env);
}

/* ------------------------------------------------------------ planner */

async function plan(env) {
  const db = env.DB, now = new Date(), today = now.toISOString().slice(0, 10);
  if ((await getSetting(db, 'clockfix_planned_day')) === today) return;

  // Countries whose clocks just changed and aren't handled yet, grouped by
  // date so e.g. all of Europe is one indexed UPDATE, not 50 table scans.
  const byDate = {};
  for (const [country, zones] of Object.entries(COUNTRY_ZONES)) {
    const change = recentChange(zones, now);
    if (!change) continue;
    const seen = await db.prepare('SELECT 1 FROM clock_change_log WHERE country = ?1 AND change_date = ?2')
      .bind(country, change).first();
    if (!seen) (byDate[change] ||= []).push(country);
  }

  const srcList = Object.keys(DUE_SOURCES).map((s) => `'${s}'`).join(',');
  const due = `strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '+' || (abs(random()) % ?2) || ' seconds')`;
  for (const [change, countries] of Object.entries(byDate)) {
    const startMs = Math.max(Date.parse(change + 'T00:00:00Z') + DAY, now.getTime());
    const start = new Date(startMs).toISOString(), end = new Date(startMs + SPREAD_DAYS * DAY).toISOString();
    const spreadSec = SPREAD_DAYS * 86400;
    const ph = countries.map((_, i) => '?' + (i + 3)).join(',');
    const bind = [start, spreadSec, ...countries];

    // Rows with a country, then rows without one (Masjidal) via their live mosque.
    const a = await db.prepare(
      `UPDATE source_discoveries SET refresh_due_at = ${due}
        WHERE source IN (${srcList}) AND times_status = 'ok' AND country IN (${ph})`
    ).bind(...bind).run();
    const b = await db.prepare(
      `UPDATE source_discoveries SET refresh_due_at = ${due}
        WHERE source IN (${srcList}) AND times_status = 'ok' AND country IS NULL
          AND (SELECT m.country FROM mosque_sources ms JOIN mosques m ON m.slug = ms.mosque_slug
                WHERE ms.source = source_discoveries.source AND ms.source_ref = source_discoveries.source_ref
                LIMIT 1) IN (${ph})`
    ).bind(...bind).run();

    let mw = { meta: { changes: 0 } };
    try {
      mw = await db.prepare(
        `UPDATE mawaqit_runner_meta SET next_refresh_at = ${due}
          WHERE slug IN (SELECT source_ref FROM source_discoveries
                          WHERE source = 'mawaqit' AND times_status = 'ok' AND country IN (${ph}))`
      ).bind(...bind).run();
    } catch (e) { /* Mawaqit runner not set up yet */ }

    const n = (a.meta.changes || 0) + (b.meta.changes || 0) + (mw.meta.changes || 0);
    await db.batch(countries.map((country) => db.prepare(
      `INSERT OR IGNORE INTO clock_change_log (country, change_date, window_start, window_end, rows_marked, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(country, change, start, end, n, now.toISOString())));
    console.log(`clock change ${change} [${countries.join(',')}]: ${n} mosques scheduled ${start} -> ${end}`);
  }
  await setSetting(db, 'clockfix_planned_day', today);
}

// Date (YYYY-MM-DD, UTC) of a clock change in the last LOOKBACK_DAYS, or null.
function recentChange(zones, now) {
  const noon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  for (const zone of zones) {
    for (let i = 0; i <= LOOKBACK_DAYS; i++) {
      const a = offsetMin(zone, noon - (i + 1) * DAY), b = offsetMin(zone, noon - i * DAY);
      if (a !== null && b !== null && a !== b) return new Date(noon - i * DAY).toISOString().slice(0, 10);
    }
  }
  return null;
}

const fmtCache = new Map();
function offsetMin(zone, ms) {
  try {
    let f = fmtCache.get(zone);
    if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }); fmtCache.set(zone, f); }
    const name = (f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName') || {}).value || '';
    const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!m) return name === 'GMT' ? 0 : null;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
  } catch (e) { return null; } // unknown zone in this runtime
}

/* ------------------------------------------------------------- driver */

async function drive(env) {
  const db = env.DB, nowIso = new Date().toISOString();
  if (!env.SYNC_SECRET) { console.warn('SYNC_SECRET not set — re-checks waiting'); return; }

  const { results } = await db.prepare(
    `SELECT source, COUNT(*) AS n FROM source_discoveries
      WHERE refresh_due_at IS NOT NULL AND refresh_due_at <= ?1 GROUP BY source`
  ).bind(nowIso).all();
  for (const r of results || []) {
    const cfg = DUE_SOURCES[r.source];
    if (!cfg) continue;
    for (let i = 0; i < Math.min(CALLS_PER_SOURCE, Math.ceil(r.n / cfg.limit)); i++) {
      const j = await call(env, `${cfg.path}?mode=times&due=1&limit=${cfg.limit}`);
      if (!j || !j.attempted) break;
    }
  }

  // UK staggered lists: one full pass per GB change.
  const gb = await db.prepare(
    `SELECT change_date, window_start FROM clock_change_log WHERE country = 'GB' ORDER BY change_date DESC LIMIT 1`
  ).first();
  if (!gb || gb.window_start > nowIso) return;
  for (const [key, cfg] of Object.entries(UK_PASSES)) {
    const k = 'clockfix_' + key;
    let st = safeJson(await getSetting(db, k)) || {};
    if (st.change !== gb.change_date) st = { change: gb.change_date, next: 0, done: false };
    if (st.done) continue;
    const j = await call(env, `${cfg.path}?start=${st.next}&end=${st.next + cfg.step}`);
    if (!j) continue; // try again next run
    const did = (j.processed || []).length + (j.failed || []).length + (j.skipped || []).length;
    if (!did) st.done = true; else st.next += cfg.step;
    await setSetting(db, k, JSON.stringify(st));
  }
}

async function call(env, path) {
  const base = (env.SITE_URL || 'https://wherewepraying.com').replace(/\/$/, '');
  try {
    const res = await fetch(base + path, { headers: { 'X-Sync-Key': env.SYNC_SECRET, 'User-Agent': UA } });
    if (!res.ok) { console.warn(path, 'HTTP', res.status); return null; }
    return await res.json();
  } catch (e) { console.warn(path, String(e)); return null; }
}

/* -------------------------------------------------------------- utils */

async function setup(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS clock_change_log (
      country TEXT NOT NULL, change_date TEXT NOT NULL, window_start TEXT, window_end TEXT,
      rows_marked INTEGER, created_at TEXT, PRIMARY KEY (country, change_date))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`),
  ]);
  try { await db.prepare('ALTER TABLE source_discoveries ADD COLUMN refresh_due_at TEXT').run(); } catch (e) {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_sd_refresh_due ON source_discoveries (refresh_due_at)').run(); } catch (e) {}
}

async function status(env) {
  await setup(env.DB);
  const log = (await env.DB.prepare('SELECT * FROM clock_change_log ORDER BY change_date DESC, country LIMIT 60').all()).results;
  const pending = (await env.DB.prepare(
    `SELECT source, COUNT(*) AS waiting FROM source_discoveries WHERE refresh_due_at IS NOT NULL GROUP BY source`
  ).all()).results;
  return { secret_set: !!env.SYNC_SECRET, pending, recent_changes: log };
}

async function getSetting(db, key) {
  const r = await db.prepare('SELECT value FROM app_settings WHERE key = ?1').bind(key).first();
  return r ? r.value : null;
}
async function setSetting(db, key, value) {
  await db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, value, new Date().toISOString()).run();
}
function safeJson(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function json(o) { return new Response(JSON.stringify(o, null, 2), { headers: { 'Content-Type': 'application/json' } }); }

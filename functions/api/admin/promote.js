// functions/api/admin/promote.js
//
// V4 — the "go live" step. Moves mosques out of the source_discoveries
// holding pen into the live `mosques` table, deliberately and in batches,
// from the "Go live" box on admin/sources.html. Pressing the button IS the
// manual sign-off; nothing here runs on a timer.
//
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   GET  ?action=status&source=ditib
//        -> counts: ready / needs coordinates / live / duplicates / unusable
//   GET  ?action=diag&lat=..&lon=..
//        -> what Find a Mosque would see at that spot: how many mosques,
//           how many have times today, and the exact error if it fails.
//   GET  ?action=overview
//        -> per-source progress: promoted / linked / still waiting / times
//           sent / times waiting, plus what the live site currently holds.
//   GET  ?action=preview&source=ditib&limit=50
//        -> what "promote" WOULD do to the next rows (no writes)
//   POST { action:'promote', source, limit?, country? }
//        -> promotes the next batch (max 150). Each row becomes EITHER
//           a new live mosque, OR is linked to an existing live mosque it
//           duplicates (its times then attach to that mosque instead).
//   POST { action:'geocode', source, limit? }
//        -> fills missing coordinates from the address (OpenStreetMap
//           Nominatim, 1 request/second, max 20 per call). Needed for
//           DITIB before it can promote.
//   POST { action:'prepare_times', limit? }
//        -> gets promoted mosques' own timetables ready to read (one small
//           month page each). Areas with visitors also do this themselves.
//   POST { action:'sideline', keepThm?:true }
//        -> hides every mosque that did NOT come from the Sources page, so
//           the live site shows source-page data only. Reversible.
//   POST { action:'restore' }  -> brings those back.
//   POST { action:'undo', source }
//        -> removes the mosques created by this source's LAST batch and
//           puts those rows back in the holding pen. Only touches rows
//           this tool created.
//
// Rules:
//   - Mawaqit's own internal duplicates (runner-flagged) are skipped.
//   - Rows without a name or coordinates are never promoted - the live
//     site (R2 cache, /nearby, /plan) only shows mosques with coordinates.
//   - Duplicate check against every existing mosque AND rows already
//     promoted earlier in the same batch:
//       coordinates within 75m (exact geocodes only) ..... duplicate
//       same name + same postcode ........................ duplicate
//       strong name match within 400m ................... duplicate
//   - A duplicate never edits the existing mosque's name/address. It only
//     fills missing coordinates, and never touches locked_fields.
//   - New mosques go live after the next R2 cache rebuild (02:00 / 14:00
//     UTC). /nearby picks them up within ~10 minutes.
//   - Imamia Mission London (IG2 7LX) is always skipped.

import { isAdminRequest } from '../../_lib/auth.js';
import { prepareMonths, prepareDailySourceMonths, ensureTimesSchema, loadArea, clearTodaysAreas } from '../../_lib/area-times.js';

const BLOCKED_SOURCES = {};
const MAX_PROMOTE = 150;
const MAX_GEOCODE = 20;
const DUP_METERS = 75;
const NEAR_NAME_METERS = 400;
const UA = 'WhereWePraying/1.0 (+https://wherewepraying.com; admin geocoder)';

// jamaah sync workers write under their own source names - link those too
// so their times attach to the promoted mosque automatically.
const SYNC_SOURCE_ALIASES = {
  masjidbox: ['masjidbox_scrape'],
  mymasjid: ['mymasjid_scrape'],
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/* ---------------------------------------------------------------- schema */

const DISCOVERY_COLS = {
  promoted_slug: 'TEXT', promoted_at: 'TEXT', promote_batch: 'TEXT',
  duplicate_of: 'TEXT', duplicate_source: 'TEXT', duplicate_reason: 'TEXT',
  geocode_status: 'TEXT', geocoded_at: 'TEXT',
};
const MOSQUE_COLS = { sidelined_at: 'TEXT', country: 'TEXT', created_by: 'TEXT', locked_fields: 'TEXT', merged_into: 'TEXT', canonical_key: 'TEXT', region: 'TEXT' };

async function ensureSchema(db) {
  const [d, m] = await db.batch([
    db.prepare('PRAGMA table_info(source_discoveries)'),
    db.prepare('PRAGMA table_info(mosques)'),
  ]);
  const have = (r) => new Set((r.results || []).map((c) => c.name));
  const dHave = have(d), mHave = have(m);
  const alters = [];
  for (const [c, t] of Object.entries(DISCOVERY_COLS)) if (!dHave.has(c)) alters.push(`ALTER TABLE source_discoveries ADD COLUMN ${c} ${t}`);
  for (const [c, t] of Object.entries(MOSQUE_COLS)) if (!mHave.has(c)) alters.push(`ALTER TABLE mosques ADD COLUMN ${c} ${t}`);
  for (const sql of alters) {
    try { await db.prepare(sql).run(); } catch (e) { /* already there */ }
  }
}

/* --------------------------------------------------------------- helpers */

function londonTodayIso() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function fold(s) {
  return String(s || '')
    .replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/İ/g, 'I')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function slugify(s) {
  return fold(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
}

const STOP = new Set([
  'mosque', 'masjid', 'islamic', 'islam', 'centre', 'center', 'the', 'of', 'and', 'uk',
  'muslim', 'muslims', 'trust', 'association', 'community', 'jamia', 'jame', 'jamme',
  'al', 'el', 'bin', 'ibn', 'ev', 'e', 'v', 'verein', 'moschee', 'camii', 'cami',
  'ditib', 'turkisch', 'islamische', 'kultur', 'gemeinde', 'kulturverein', 'und', 'der', 'die',
]);

function tokens(name) {
  return fold(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

function normName(name) { return fold(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normPostcode(pc) { return String(pc || '').toUpperCase().replace(/\s+/g, ''); }

function strongNameMatch(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.length || !B.length) return normName(a) && normName(a) === normName(b);
  const bSet = new Set(B), aSet = new Set(A);
  const shared = A.filter((w) => bSet.has(w)).length;
  const contained = A.every((w) => bSet.has(w)) || B.every((w) => aSet.has(w));
  return contained && shared >= 1;
}

function meters(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function titleCase(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

const UK_PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

// Map one holding-pen row to live mosque fields. raw_json fills gaps
// (DITIB keeps city/postcode/website there; MuslimsInBritain keeps the
// postcode inside the address).
function mapRow(r) {
  let raw = {};
  try { raw = r.raw_json ? JSON.parse(r.raw_json) : {}; } catch (e) { raw = {}; }
  const address = String(r.address || raw.address || '').replace(/,\s*,/g, ',').replace(/\s{2,}/g, ' ').trim() || null;
  let postcode = r.zipcode || raw.postcode || raw.zipcode || raw.zip || null;
  if (!postcode && address) { const m = address.toUpperCase().match(UK_PC); if (m) postcode = m[1] + ' ' + m[2]; }
  const city = titleCase(r.city || raw.city || raw.town || '') || null;
  const website = r.site || raw.website || raw.site || null;
  return {
    name: String(r.name || '').replace(/\s{2,}/g, ' ').trim(),
    address, postcode: postcode ? String(postcode).trim() : null,
    city, country: (r.country || raw.country_code || '').toUpperCase() || null,
    website: website ? String(website).trim().replace(/\/+$/, '') : null,
    lat: r.lat, lon: r.lon,
    approx: r.geocode_status === 'approx',
  };
}

function isExcluded(m) {
  return normPostcode(m.postcode) === 'IG27LX' || /imamia mission/i.test(m.name);
}

/* ---------------------------------------------------------------- decide */

async function loadLive(db) {
  const { results } = await db.prepare(
    `SELECT slug, name, postcode, latitude, longitude, locked_fields, merged_into, sidelined_at FROM mosques`
  ).all();
  return results || [];
}

function findDuplicate(m, live) {
  const pc = normPostcode(m.postcode);
  const nn = normName(m.name);
  for (const x of live) {
    if (pc && nn && normPostcode(x.postcode) === pc && normName(x.name) === nn) {
      return { slug: x.slug, reason: 'same name + postcode' };
    }
  }
  if (m.lat == null || m.lon == null) return null;
  let best = null;
  for (const x of live) {
    if (x.latitude == null || x.longitude == null) continue;
    const d = meters(m.lat, m.lon, x.latitude, x.longitude);
    if (!m.approx && d <= DUP_METERS) {
      if (!best || d < best.d) best = { slug: x.slug, d, reason: `same spot (${Math.round(d)}m)` };
    } else if (d <= NEAR_NAME_METERS && strongNameMatch(m.name, x.name)) {
      if (!best) best = { slug: x.slug, d, reason: `same name, ${Math.round(d)}m apart` };
    }
  }
  return best ? { slug: best.slug, reason: best.reason } : null;
}

function uniqueSlug(m, taken) {
  const generic = tokens(m.name).length === 0; // e.g. "DITIB Türkisch Islamische Kultur Verein e.V."
  const tries = [];
  if (!generic || !m.city) tries.push(slugify(m.name) || 'mosque');
  if (m.city) tries.push(slugify(m.name + ' ' + m.city));
  if (m.postcode) tries.push(slugify(m.name + ' ' + (m.city || '') + ' ' + m.postcode));
  for (const s of tries) if (s && !taken.has(s)) return s;
  const root = tries[tries.length - 1];
  for (let i = 2; ; i++) { const s = `${root}-${i}`; if (!taken.has(s)) return s; }
}

const PENDING_WHERE = `source = ?1 AND (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))`;

async function nextRows(db, source, country, limit) {
  const binds = [source];
  let sql = `SELECT source_ref, name, country, city, address, zipcode, lat, lon, site, raw_json, geocode_status
               FROM source_discoveries
              WHERE ${PENDING_WHERE}
                AND COALESCE(times_status,'') <> 'duplicate'
                AND name IS NOT NULL AND TRIM(name) <> ''
                AND lat IS NOT NULL AND lon IS NOT NULL`;
  if (country) { binds.push(country.toUpperCase()); sql += ' AND country = ?2'; }
  // Mosques whose timetable we already hold go first - they're the ones
  // that light up with real jama'ah times the moment they're live.
  sql += ` ORDER BY (COALESCE(times_status,'') = 'ok') DESC, source_ref LIMIT ${limit}`;
  return (await db.prepare(sql).bind(...binds).all()).results || [];
}

function plan(rows, live) {
  const taken = new Set(live.map((x) => x.slug));
  const pool = live.filter((x) => !x.merged_into && !x.sidelined_at);
  return rows.map((r) => {
    const m = mapRow(r);
    if (isExcluded(m)) return { ref: r.source_ref, m, action: 'exclude', reason: 'excluded mosque' };
    const dup = findDuplicate(m, pool);
    if (dup) return { ref: r.source_ref, m, action: 'duplicate', slug: dup.slug, reason: dup.reason };
    const slug = uniqueSlug(m, taken);
    taken.add(slug);
    pool.push({ slug, name: m.name, postcode: m.postcode, latitude: m.lat, longitude: m.lon });
    return { ref: r.source_ref, m, action: 'new', slug };
  });
}

/* -------------------------------------------------------------- overview */

// One row per source: what's live, what still waits, and whether its times
// have been sent. Drives the progress table + tab ticks on admin/sources.html.
async function overview(db) {
  await ensureTimesSchema(db);
  const today = londonTodayIso();
  const soon = londonTodayIso().slice(0, 7); // month pages are prepared a month at a time
  const [bySource, live] = await db.batch([
    db.prepare(
      `SELECT source,
              COUNT(*) AS total,
              SUM(CASE WHEN status='imported' THEN 1 ELSE 0 END) AS promoted,
              SUM(CASE WHEN status='duplicate' THEN 1 ELSE 0 END) AS linked,
              SUM(CASE WHEN (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
                        AND COALESCE(times_status,'') <> 'duplicate'
                        AND name IS NOT NULL AND TRIM(name) <> ''
                        AND lat IS NOT NULL AND lon IS NOT NULL THEN 1 ELSE 0 END) AS ready,
              SUM(CASE WHEN (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
                        AND name IS NOT NULL AND TRIM(name) <> ''
                        AND (lat IS NULL OR lon IS NULL) AND geocode_status IS NULL THEN 1 ELSE 0 END) AS needs_geocode,
              SUM(CASE WHEN has_times = 1 THEN 1 ELSE 0 END) AS times_sent,
              SUM(CASE WHEN has_times = 0 THEN 1 ELSE 0 END) AS times_none,
              SUM(CASE WHEN status IN ('imported','duplicate') AND promoted_slug IS NOT NULL AND times_status='ok'
                        AND (compiled_through IS NULL OR compiled_through < ?1
                             OR (times_updated_at IS NOT NULL AND (compiled_at IS NULL OR compiled_at < times_updated_at)))
                       THEN 1 ELSE 0 END) AS times_waiting,
              MAX(promoted_at) AS last_promoted_at,
              MAX(compiled_at) AS last_times_at
         FROM source_discoveries GROUP BY source ORDER BY source`
    ).bind(soon),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM mosques WHERE active=1 AND type='mosque' AND merged_into IS NULL) AS live_mosques,
              (SELECT COUNT(*) FROM mosques WHERE active=1 AND type='mosque' AND merged_into IS NULL
                 AND latitude IS NOT NULL AND longitude IS NOT NULL) AS live_on_map,
              (SELECT COUNT(*) FROM mosques WHERE active=1 AND type='mosque' AND merged_into IS NULL
                 AND created_by LIKE 'promote:%') AS live_from_sources,
              (SELECT COUNT(*) FROM mosques WHERE active=1 AND type='mosque' AND merged_into IS NULL
                 AND (created_by IS NULL OR created_by NOT LIKE 'promote:%')) AS live_pre_existing,
              (SELECT COUNT(*) FROM mosques WHERE sidelined_at IS NOT NULL) AS set_aside,
              (SELECT COUNT(*) FROM (
                 SELECT mt.mosque AS m FROM mosque_month_times mt
                   JOIN mosques mo ON mo.slug = mt.mosque AND mo.active = 1 AND mo.merged_into IS NULL
                  WHERE mt.month = ?2 AND mt.times IS NOT NULL
                 UNION
                 SELECT t.mosque AS m FROM thm_jamaah_times t
                   JOIN mosques mo2 ON mo2.slug = t.mosque AND mo2.active = 1 AND mo2.merged_into IS NULL
                  WHERE t.date = ?1)) AS with_times_today`
    ).bind(today, today.slice(0, 7)),
  ]);
  return {
    today,
    sources: (bySource.results || []).map((r) => ({
      ...r,
      promote_done: (r.ready || 0) === 0 && ((r.promoted || 0) + (r.linked || 0)) > 0,
      times_done: (r.times_waiting || 0) === 0 && (r.times_sent || 0) > 0,
    })),
    site: (live.results && live.results[0]) || null,
  };
}

/* ---------------------------------------------------------------- status */

// MasjidBox/MyMasjid never write compiled_through/times_updated_at onto
// source_discoveries (their sync only touches jamaah_raw + mosque_sources
// - see area-times.js), so the times_due column below is always 0 for
// them regardless of real pending work. For these two, times_due instead
// mirrors prepareDailySourceMonths()'s own staleness check, so the
// button lights up for exactly the sources it can actually do work for.
//
// The admin tab is named after the DISCOVERY source ("masjidbox"), but
// the daily sync that actually writes jamaah_raw runs under its own,
// different name ("masjidbox_scrape") - same split match-locations.js's
// SYNC_SOURCE_ALIASES exists to bridge. This is that same mapping.
const DAILY_SYNC_SOURCE = { masjidbox: 'masjidbox_scrape', mymasjid: 'mymasjid_scrape' };

async function dailySourceTimesDue(db, syncSource) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT ms.mosque_slug, MAX(r.updated_at) AS latest
         FROM jamaah_raw r
         JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
        WHERE r.source = ?1 AND ms.mosque_slug IS NOT NULL
        GROUP BY ms.mosque_slug, ms.source, ms.source_ref
       HAVING latest > COALESCE(
                (SELECT MIN(mt.updated_at) FROM mosque_month_times mt
                  WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?2, ?3)),
                '')
           OR (SELECT COUNT(*) FROM mosque_month_times mt WHERE mt.mosque = ms.mosque_slug AND mt.month IN (?2, ?3)) < 2
     )`
  ).bind(syncSource, londonTodayIso().slice(0, 7), (function(){ const [y,m]=londonTodayIso().slice(0,7).split('-').map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,'0')}`; })()).first();
  return (row && row.n) || 0;
}

async function status(db, source) {
  await ensureTimesSchema(db);
  const row = await db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status='imported' THEN 1 ELSE 0 END) AS live,
       SUM(CASE WHEN status='duplicate' THEN 1 ELSE 0 END) AS duplicates,
       SUM(CASE WHEN status='excluded' THEN 1 ELSE 0 END) AS excluded,
       SUM(CASE WHEN (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
                 AND COALESCE(times_status,'') <> 'duplicate'
                 AND name IS NOT NULL AND TRIM(name) <> '' AND lat IS NOT NULL AND lon IS NOT NULL THEN 1 ELSE 0 END) AS ready,
       SUM(CASE WHEN (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
                 AND name IS NOT NULL AND TRIM(name) <> '' AND (lat IS NULL OR lon IS NULL)
                 AND (geocode_status IS NULL) THEN 1 ELSE 0 END) AS needs_geocode,
       SUM(CASE WHEN status IN ('imported','duplicate') AND promoted_slug IS NOT NULL AND times_status='ok'
                 AND (compiled_through IS NULL OR compiled_through < ?2
                      OR (times_updated_at IS NOT NULL AND (compiled_at IS NULL OR compiled_at < times_updated_at)))
                THEN 1 ELSE 0 END) AS times_due,
       SUM(CASE WHEN (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
                 AND (lat IS NULL OR lon IS NULL) AND geocode_status = 'not_found' THEN 1 ELSE 0 END) AS geocode_failed,
       SUM(CASE WHEN name IS NULL OR TRIM(name) = '' THEN 1 ELSE 0 END) AS unnamed,
       MAX(promote_batch) AS last_batch
     FROM source_discoveries WHERE source = ?1`
  ).bind(source, londonTodayIso().slice(0, 7)).first();
  if (DAILY_SYNC_SOURCE[source]) row.times_due = await dailySourceTimesDue(db, DAILY_SYNC_SOURCE[source]);
  return { source, blocked: BLOCKED_SOURCES[source] || null, ...row };
}

/* --------------------------------------------------------------- promote */

async function promote(db, source, country, limit) {
  const [rows, live] = await Promise.all([nextRows(db, source, country, limit), loadLive(db)]);
  if (!rows.length) return { ok: true, processed: 0, created: 0, linked: 0, message: 'Nothing ready to promote.' };

  const liveBySlug = new Map(live.map((x) => [x.slug, x]));
  const decisions = plan(rows, live);
  const now = new Date().toISOString();
  const batch = now;
  const aliases = SYNC_SOURCE_ALIASES[source] || [];
  const groups = [];

  for (const d of decisions) {
    const m = d.m;
    const stmts = [];
    groups.push(stmts);
    if (d.action === 'exclude') {
      stmts.push(db.prepare(`UPDATE source_discoveries SET status='excluded', duplicate_reason=?1 WHERE source=?2 AND source_ref=?3`)
        .bind(d.reason, source, d.ref));
      continue;
    }

    if (d.action === 'new') {
      stmts.push(db.prepare(
        `INSERT INTO mosques (slug, name, city, address, postcode, latitude, longitude, website_url,
                              active, type, created_at, country, created_by, canonical_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 'mosque', ?9, ?10, ?11, ?12)`
      ).bind(d.slug, m.name, m.city || m.country || 'Unknown', m.address, m.postcode, m.lat, m.lon, m.website,
             now, m.country, 'promote:' + source,
             m.name.toLowerCase().trim() + '|' + normPostcode(m.postcode)));
      stmts.push(db.prepare(
        `UPDATE source_discoveries SET status='imported', promoted_slug=?1, promoted_at=?2, promote_batch=?3,
                duplicate_of=NULL, duplicate_source=NULL, duplicate_reason=NULL
          WHERE source=?4 AND source_ref=?5`
      ).bind(d.slug, now, batch, source, d.ref));
    } else {
      const existing = liveBySlug.get(d.slug);
      const locked = existing && /(^|,)\s*(latitude|longitude)\s*(,|$)/.test(existing.locked_fields || '');
      if (existing && !locked && !m.approx) {
        stmts.push(db.prepare(
          `UPDATE mosques SET latitude=?1, longitude=?2 WHERE slug=?3 AND (latitude IS NULL OR longitude IS NULL)`
        ).bind(m.lat, m.lon, d.slug));
      }
      stmts.push(db.prepare(
        `UPDATE source_discoveries SET status='duplicate', promoted_slug=?1, promoted_at=?2, promote_batch=?3,
                duplicate_of=?1, duplicate_source='mosques', duplicate_reason=?4
          WHERE source=?5 AND source_ref=?6`
      ).bind(d.slug, now, batch, d.reason, source, d.ref));
    }

    // Translator sheet: this source's code -> the live mosque, so any
    // times this source has (now or later) show on that mosque.
    stmts.push(db.prepare(
      `INSERT INTO mosque_sources (source, source_ref, name, lat, lon, mosque_slug, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(source, source_ref) DO UPDATE SET
         mosque_slug = COALESCE(mosque_sources.mosque_slug, excluded.mosque_slug),
         lat = COALESCE(mosque_sources.lat, excluded.lat),
         lon = COALESCE(mosque_sources.lon, excluded.lon),
         last_seen = excluded.last_seen`
    ).bind(source, d.ref, m.name, m.lat, m.lon, d.slug, now));
    for (const alias of aliases) {
      stmts.push(db.prepare(
        `UPDATE mosque_sources SET mosque_slug=?1, last_seen=?2 WHERE source=?3 AND source_ref=?4 AND mosque_slug IS NULL`
      ).bind(d.slug, now, alias, d.ref));
    }
  }

  // Chunk by whole rows (~4 statements each) so a failed batch never
  // leaves a mosque inserted without its holding-pen row marked, or vice versa.
  let failedChunks = 0; const errors = [];
  for (let i = 0; i < groups.length; i += 12) {
    const chunk = [].concat(...groups.slice(i, i + 12));
    if (!chunk.length) continue;
    try { await db.batch(chunk); }
    catch (e) { failedChunks++; if (errors.length < 3) errors.push(String(e).slice(0, 200)); }
  }

  const created = decisions.filter((d) => d.action === 'new').length;
  const linked = decisions.filter((d) => d.action === 'duplicate').length;
  return {
    ok: failedChunks === 0, processed: decisions.length, created, linked,
    excluded: decisions.filter((d) => d.action === 'exclude').length,
    batch, errors,
    sample: decisions.slice(0, 10).map((d) => ({ name: d.m.name, action: d.action, slug: d.slug || null, reason: d.reason || null })),
  };
}

/* ------------------------------------------------------------ sideline */

// Everything the live site shows that did NOT come from the Sources page
// gets hidden (active = 0) and stamped, so 'restore' can bring back exactly
// those and nothing else. Tower Hamlets is kept by default - it's the only
// committee-backed jama'ah data currently on the site.
async function sideline(db, keepThm) {
  const now = new Date().toISOString();
  const thm = keepThm
    ? ` AND slug NOT IN (SELECT mosque_slug FROM mosque_sources WHERE source LIKE 'thm%' AND mosque_slug IS NOT NULL)`
    : '';
  const r = await db.prepare(
    `UPDATE mosques SET active = 0, sidelined_at = ?1
      WHERE active = 1 AND sidelined_at IS NULL
        AND (created_by IS NULL OR created_by NOT LIKE 'promote:%')${thm}`
  ).bind(now).run();
  const hidden = (r.meta && r.meta.changes) || 0;
  const left = await db.prepare(
    `SELECT COUNT(*) AS n FROM mosques WHERE active = 1 AND type='mosque' AND merged_into IS NULL`
  ).first();
  return { ok: true, hidden, stillLive: (left && left.n) || 0, keptTowerHamlets: !!keepThm };
}

async function restore(db) {
  const r = await db.prepare(`UPDATE mosques SET active = 1, sidelined_at = NULL WHERE sidelined_at IS NOT NULL`).run();
  return { ok: true, restored: (r.meta && r.meta.changes) || 0 };
}

/* ---------------------------------------------------------------- undo */

async function undo(db, source) {
  const last = await db.prepare(`SELECT MAX(promote_batch) AS b FROM source_discoveries WHERE source=?1`).bind(source).first();
  if (!last || !last.b) return { ok: true, removed: 0, message: 'No batch to undo.' };
  const b = last.b;
  const { results } = await db.prepare(
    `SELECT source_ref, status, promoted_slug FROM source_discoveries WHERE source=?1 AND promote_batch=?2`
  ).bind(source, b).all();
  const rows = results || [];
  const stmts = [];
  let removed = 0;
  for (const r of rows) {
    if (r.status === 'imported' && r.promoted_slug) {
      // Only delete a mosque this tool created for this source.
      stmts.push(db.prepare(`DELETE FROM mosques WHERE slug=?1 AND created_by=?2`).bind(r.promoted_slug, 'promote:' + source));
      stmts.push(db.prepare(`UPDATE mosque_sources SET mosque_slug=NULL WHERE mosque_slug=?1`).bind(r.promoted_slug));
      removed++;
    } else if (r.promoted_slug) {
      stmts.push(db.prepare(`UPDATE mosque_sources SET mosque_slug=NULL WHERE source=?1 AND source_ref=?2`).bind(source, r.source_ref));
    }
    stmts.push(db.prepare(
      `UPDATE source_discoveries SET status='new', promoted_slug=NULL, promoted_at=NULL, promote_batch=NULL,
              duplicate_of=NULL, duplicate_source=NULL, duplicate_reason=NULL
        WHERE source=?1 AND source_ref=?2`
    ).bind(source, r.source_ref));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { ok: true, batch: b, rows: rows.length, removed };
}

/* -------------------------------------------------------------- geocode */

function cleanStreet(s) {
  return String(s || '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
}

async function nominatim(params) {
  const q = new URLSearchParams({ format: 'jsonv2', limit: '1', ...params });
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + q.toString(), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
  });
  if (!res.ok) throw new Error('nominatim http ' + res.status);
  const arr = await res.json();
  return arr && arr[0] ? { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) } : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(db, source, limit) {
  const { results } = await db.prepare(
    `SELECT source_ref, name, country, city, address, zipcode, raw_json FROM source_discoveries
      WHERE ${PENDING_WHERE} AND (lat IS NULL OR lon IS NULL) AND geocode_status IS NULL
        AND name IS NOT NULL AND TRIM(name) <> ''
      ORDER BY source_ref LIMIT ${limit}`
  ).bind(source).all();
  const rows = results || [];
  const now = new Date().toISOString();
  const stmts = [];
  let exact = 0, approx = 0, missed = 0, stoppedEarly = false;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let raw = {};
    try { raw = r.raw_json ? JSON.parse(r.raw_json) : {}; } catch (e) { raw = {}; }
    const cc = (r.country || raw.country_code || '').toLowerCase();
    const street = cleanStreet(raw.street || '');
    const postcode = r.zipcode || raw.postcode || '';
    const city = r.city || raw.city || '';
    let hit = null, kind = 'ok';
    try {
      if (street && (postcode || city)) {
        hit = await nominatim({ street, postalcode: postcode, city, countrycodes: cc });
        await sleep(1100);
      }
      if (!hit && (postcode || city)) {
        hit = await nominatim({ postalcode: postcode, city, countrycodes: cc });
        kind = 'approx';
        await sleep(1100);
      }
    } catch (e) {
      stoppedEarly = true; // rate-limited or down - leave the rest for next call
      break;
    }
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
      stmts.push(db.prepare(
        `UPDATE source_discoveries SET lat=?1, lon=?2, geocode_status=?3, geocoded_at=?4 WHERE source=?5 AND source_ref=?6`
      ).bind(hit.lat, hit.lon, kind, now, source, r.source_ref));
      kind === 'ok' ? exact++ : approx++;
    } else {
      stmts.push(db.prepare(
        `UPDATE source_discoveries SET geocode_status='not_found', geocoded_at=?1 WHERE source=?2 AND source_ref=?3`
      ).bind(now, source, r.source_ref));
      missed++;
    }
  }
  if (stmts.length) await db.batch(stmts);
  return { ok: true, attempted: exact + approx + missed, exact, approx, notFound: missed, stoppedEarly };
}

/* -------------------------------------------------------------- routing */

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const db = context.env.DB;
  const p = new URL(context.request.url).searchParams;
  const action = (p.get('action') || 'status').toLowerCase();
  const source = (p.get('source') || '').trim();
  try {
    await ensureSchema(db);
    if (action === 'overview') { return json(await overview(db)); }
    if (action === 'diag') {
      const lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'lat and lon required' }, 400);
      try {
        const area = await loadArea(context, lat, lon, londonTodayIso());
        const rows = area.rows || [];
        const withTimes = rows.filter((r) => r.fajr_jamaah || r.zuhr_jamaah || r.asr_jamaah || r.maghrib_jamaah || r.isha_jamaah);
        return json({
          ok: true, servedFrom: area.from, mosquesInArea: rows.length, withTimesToday: withTimes.length,
          sample: withTimes.slice(0, 3).map((r) => ({ name: r.name, fajr: r.fajr_jamaah, zuhr: r.zuhr_jamaah, isha: r.isha_jamaah })),
          nearestWithoutTimes: rows.filter((r) => !withTimes.includes(r)).slice(0, 3).map((r) => r.name),
        });
      } catch (e) {
        return json({ ok: false, failure: String(e).slice(0, 500) });
      }
    }
    if (!source) return json({ error: 'source is required' }, 400);
    if (action === 'preview') {
      const limit = Math.min(parseInt(p.get('limit') || '50', 10) || 50, MAX_PROMOTE);
      const [rows, live] = await Promise.all([nextRows(db, source, p.get('country'), limit), loadLive(db)]);
      return json({
        blocked: BLOCKED_SOURCES[source] || null,
        rows: plan(rows, live).map((d) => ({
          ref: d.ref, name: d.m.name, city: d.m.city, postcode: d.m.postcode,
          action: d.action, slug: d.slug || null, reason: d.reason || null, approx: d.m.approx,
        })),
      });
    }
    return json(await status(db, source));
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const db = context.env.DB;
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'Invalid JSON body.' }, 400); }
  const source = String(body.source || '').trim();
  if (body.action === 'prepare_times') {
    try {
      await ensureSchema(db);
      const limit = parseInt(body.limit, 10) || 120;
      // Two independent pipelines feed the same mosque_month_times table:
      // year/snapshot sources (Mawaqit, Masjidal, Takbeer Time) via
      // prepareMonths(), and daily-row sources (MasjidBox, MyMasjid) via
      // prepareDailySourceMonths() - see area-times.js. One button press
      // clears both, split roughly in half so neither starves the other
      // when there's a big backlog in just one of them.
      const [r1, r2] = await Promise.all([
        prepareMonths(db, Math.ceil(limit / 2)),
        prepareDailySourceMonths(db, Math.floor(limit / 2)),
      ]);
      const stillToPrepare = (r1.stillToPrepare || 0) + (r2.stillToPrepare || 0);
      // Without this, freshly-written times sit correct in the database
      // but invisible on the live site for up to 6 hours - whichever
      // area cache a visitor already triggered keeps answering from
      // before this run, same as merge-duplicates.js and
      // match-locations.js already clear after their own writes.
      const areasCleared = (r1.withTimes + r2.withTimes) > 0 ? await clearTodaysAreas(context.env) : 0;
      return json({
        ok: true,
        checked: r1.checked + r2.checked,
        withTimes: r1.withTimes + r2.withTimes,
        without: r1.without + r2.without,
        stillToPrepare,
        areasCleared,
      });
    } catch (e) { return json({ error: 'db_error', message: String(e) }, 500); }
  }
  if (body.action === 'sideline' || body.action === 'restore') {
    try {
      await ensureSchema(db);
      return json(body.action === 'sideline' ? await sideline(db, body.keepThm !== false) : await restore(db));
    } catch (e) { return json({ error: 'db_error', message: String(e) }, 500); }
  }
  if (!source) return json({ error: 'source is required' }, 400);

  try {
    await ensureSchema(db);
    if (body.action === 'promote') {
      if (BLOCKED_SOURCES[source]) return json({ error: BLOCKED_SOURCES[source] }, 409);
      const limit = Math.max(1, Math.min(parseInt(body.limit, 10) || MAX_PROMOTE, MAX_PROMOTE));
      return json(await promote(db, source, body.country || null, limit));
    }
    if (body.action === 'geocode') {
      const limit = Math.max(1, Math.min(parseInt(body.limit, 10) || MAX_GEOCODE, MAX_GEOCODE));
      return json(await geocode(db, source, limit));
    }
    if (body.action === 'undo') return json(await undo(db, source));
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

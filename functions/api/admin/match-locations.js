// functions/api/admin/match-locations.js
//
// "Match locations" - for holding-pen mosques that can't go live because
// they have no map location (e.g. MasjidBox: 308 waiting), suggest the
// same mosque from somewhere that DOES have coordinates:
//   - a mosque already LIVE on the site (any source), or
//   - a MuslimsInBritain entry that isn't live yet.
// You approve or reject each suggestion by hand; nothing is copied until
// you press Approve.
//
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   GET  ?action=suggest&source=masjidbox&limit=25
//        -> mosques still missing a location, each with its best matches
//   POST { action:'approve', source, ref, cand_source, cand_ref }
//        -> match is a LIVE mosque (cand_source 'live'): links straight to
//           it, right now. Its prayer times (e.g. MasjidBox's live daily
//           sync) start showing on that listing - no "Put live" needed.
//        -> match is a MuslimsInBritain entry: copies its coordinates (and
//           address/postcode where missing) so the mosque can go live with
//           "Put live + send times".
//   POST { action:'reject', source, ref, cand_refs:[...] }
//        -> "not the same mosque" - those suggestions never come back.
//
// Adding a location by hand (any source - MasjidBox, Masjidal, DITIB...):
//   GET  ?action=missing&source=masjidbox&q=newbury&offset=0
//        -> mosques on that source with no location (25 at a time)
//   POST { action:'set_location', source, ref, input }
//        -> `input` can be any of:
//             a UK postcode ............ "IG2 7HS"
//             coordinates .............. "51.5813, 0.0913"
//             a Google Maps link ....... long links, or maps.app.goo.gl
//                                        short links (followed to the
//                                        real place)
//           Saves the location (and postcode) on the mosque, marked as set
//           by hand. It can then go live with "Put live + send times".
//
// How a match is scored (shown next to each suggestion):
//   same postcode ............. +50     same postcode area (IG2) .. +10
//   same phone number ......... +40
//   names match ............... +40     names share words ......... up to +25
//   town appears in address ... +10
// Only suggestions scoring 40+ AND with at least one of postcode / phone /
// name agreeing are shown. Candidates are looked up through small indexes
// (postcode, phone, name words), so this stays fast.

import { isAdminRequest } from '../../_lib/auth.js';
import { clearTodaysAreas } from '../../_lib/area-times.js';

// The live jama'ah sync workers write under their own source names -
// link those too so their times attach (same list as promote.js).
const SYNC_SOURCE_ALIASES = { masjidbox: ['masjidbox_scrape'], mymasjid: ['mymasjid_scrape'] };

const MIN_SCORE = 40;
const MAX_CANDIDATES = 3;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/* ------------------------------------------------------------- matching */

const STOP = new Set([
  'mosque', 'masjid', 'islamic', 'islam', 'centre', 'center', 'the', 'of', 'and', 'uk',
  'muslim', 'muslims', 'trust', 'association', 'community', 'jamia', 'jame', 'jamme',
  'al', 'el', 'bin', 'ibn', 'society', 'education', 'educational', 'academy', 'institute',
  'ltd', 'limited', 'cic', 'charity', 'foundation',
]);
const UK_PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function tokens(name) {
  return fold(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}
function postcodeOf(...texts) {
  for (const t of texts) {
    const m = String(t || '').toUpperCase().match(UK_PC);
    if (m) return m[1] + ' ' + m[2];
  }
  return null;
}
function outcode(pc) { return pc ? pc.split(' ')[0] : null; }
function phoneKey(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null; // drops +44 / leading 0 differences
}

function foundOnUrl(r) {
  if (!r.raw_json) return null;
  try { return JSON.parse(r.raw_json).foundOnUrl || null; } catch (e) { return null; }
}

function describe(r) {
  const site = r.site || foundOnUrl(r);
  return {
    name: r.name || null,          // null => no name on record; show source_ref + site instead
    address: r.address || null,
    city: r.city || null,
    postcode: postcodeOf(r.zipcode, r.address),
    phone: r.phone || null,
    site: site ? (/^https?:\/\//i.test(site) ? site : 'https://' + site) : null,
  };
}

function scorePair(a, b) {
  let score = 0;
  const why = [];
  const pcA = postcodeOf(a.zipcode, a.address), pcB = postcodeOf(b.zipcode, b.address);
  let anchor = false;
  if (pcA && pcB && pcA === pcB) { score += 50; why.push('same postcode'); anchor = true; }
  else if (pcA && pcB && outcode(pcA) === outcode(pcB)) { score += 10; why.push('same postcode area'); }

  const phA = phoneKey(a.phone), phB = phoneKey(b.phone);
  if (phA && phB && phA === phB) { score += 40; why.push('same phone'); anchor = true; }

  const A = tokens(a.name || ''), B = tokens(b.name || '');
  if (A.length && B.length) {
    const aSet = new Set(A), bSet = new Set(B);
    const shared = A.filter((w) => bSet.has(w)).length;
    if (A.every((w) => bSet.has(w)) || B.every((w) => aSet.has(w))) {
      score += 40; why.push('names match'); anchor = true;
    } else if (shared) {
      const j = shared / new Set([...A, ...B]).size;
      score += Math.round(j * 25); why.push(`names share "${A.filter((w) => bSet.has(w)).join(' ')}"`);
    }
  }
  const town = String(a.city || '').trim().toLowerCase();
  if (town.length > 2 && String(b.address || '').toLowerCase().includes(town)) { score += 10; why.push('same town'); }
  return anchor && score >= MIN_SCORE ? { score, why } : null;
}

function buildIndex(pool) {
  const byPc = new Map(), byPhone = new Map(), byWord = new Map();
  const add = (map, k, i) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(i); };
  pool.forEach((r, i) => {
    add(byPc, postcodeOf(r.zipcode, r.address), i);
    add(byPhone, phoneKey(r.phone), i);
    for (const w of new Set(tokens(r.name))) add(byWord, w, i);
  });
  return { byPc, byPhone, byWord };
}

function suggestFor(row, pool, idx, rejected) {
  const ids = new Set();
  for (const i of idx.byPc.get(postcodeOf(row.zipcode, row.address)) || []) ids.add(i);
  for (const i of idx.byPhone.get(phoneKey(row.phone)) || []) ids.add(i);
  for (const w of new Set(tokens(row.name))) {
    const hits = idx.byWord.get(w) || [];
    if (hits.length <= 60) hits.forEach((i) => ids.add(i)); // skip very common words
  }
  const out = [];
  for (const i of ids) {
    const c = pool[i];
    if (rejected.has(c.source + ':' + c.source_ref)) continue;
    const s = scorePair(row, c);
    if (s) out.push({ c, ...s });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, MAX_CANDIDATES).map((o) => ({
    source: o.c.source, ref: o.c.source_ref, ...describe(o.c),
    lat: o.c.lat, lon: o.c.lon, liveSlug: o.c.promoted_slug || o.c.duplicate_of || null,
    score: o.score, why: o.why,
  }));
}

/* ------------------------------------------------------------------ data */

async function ensureTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS source_match_reviews (
       source TEXT NOT NULL, source_ref TEXT NOT NULL,
       cand_source TEXT NOT NULL, cand_ref TEXT NOT NULL,
       decision TEXT NOT NULL, decided_at TEXT NOT NULL,
       PRIMARY KEY (source, source_ref, cand_source, cand_ref))`
  ).run();
}

// Name isn't required — Masjidal rows have none at all (only a mosque ID
// and the page they were found on: raw_json.foundOnUrl). describe() below
// falls back to that page, or the source_ref, so there's always something
// to show and act on.
const NEEDS_LOCATION = `source = ?1 AND (lat IS NULL OR lon IS NULL)
  AND (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))`;

async function suggest(context, url) {
  const db = context.env.DB;
  const source = String(url.searchParams.get('source') || 'masjidbox');
  const poolSource = String(url.searchParams.get('pool') || 'muslimsinbritain');
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit'), 10) || 25, 50));
  await ensureTable(db);

  const [waiting, live, mib, reviews] = await db.batch([
    db.prepare(`SELECT source_ref, name, city, address, zipcode, phone FROM source_discoveries WHERE ${NEEDS_LOCATION}`).bind(source),
    db.prepare(
      `SELECT 'live' AS source, slug AS source_ref, name, city, address, postcode AS zipcode, NULL AS phone,
              latitude AS lat, longitude AS lon, slug AS promoted_slug, NULL AS duplicate_of
         FROM mosques WHERE active = 1 AND merged_into IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL`
    ),
    db.prepare(
      `SELECT source, source_ref, name, city, address, zipcode, phone, lat, lon, promoted_slug, duplicate_of
         FROM source_discoveries WHERE source = ?1 AND lat IS NOT NULL AND lon IS NOT NULL
          AND promoted_slug IS NULL AND duplicate_of IS NULL`
    ).bind(poolSource),
    db.prepare(`SELECT source_ref, cand_source, cand_ref FROM source_match_reviews WHERE source = ?1 AND decision = 'reject'`).bind(source),
  ]);
  const pool = { results: [...(live.results || []), ...(mib.results || [])] };

  const rejectedBy = new Map();
  for (const r of reviews.results || []) {
    if (!rejectedBy.has(r.source_ref)) rejectedBy.set(r.source_ref, new Set());
    rejectedBy.get(r.source_ref).add(r.cand_source + ':' + r.cand_ref);
  }
  const poolRows = pool.results || [];
  const idx = buildIndex(poolRows);

  const list = [];
  let noMatch = 0;
  for (const r of waiting.results || []) {
    const candidates = suggestFor(r, poolRows, idx, rejectedBy.get(r.source_ref) || new Set());
    if (!candidates.length) { noMatch++; continue; }
    if (list.length < limit) list.push({ ref: r.source_ref, ...describe(r), candidates });
  }
  const withMatch = (waiting.results || []).length - noMatch;
  return json({
    source, pool: poolSource,
    waitingForLocation: (waiting.results || []).length,
    withSuggestion: withMatch, noSuggestion: noMatch,
    shown: list.length, list,
  });
}

async function approve(context, body) {
  const db = context.env.DB;
  const source = String(body.source || ''), ref = String(body.ref || '');
  const cSource = String(body.cand_source || ''), cRef = String(body.cand_ref || '');
  if (!source || !ref || !cSource || !cRef) return json({ error: 'source, ref, cand_source and cand_ref are required' }, 400);
  if (cSource === 'live') return approveLive(context, source, ref, cRef);
  const [rowR, candR] = await db.batch([
    db.prepare(`SELECT source_ref, address, zipcode, lat, lon FROM source_discoveries WHERE source = ?1 AND source_ref = ?2`).bind(source, ref),
    db.prepare(`SELECT source_ref, address, zipcode, lat, lon FROM source_discoveries WHERE source = ?1 AND source_ref = ?2`).bind(cSource, cRef),
  ]);
  const row = (rowR.results || [])[0], cand = (candR.results || [])[0];
  if (!row || !cand) return json({ error: 'Mosque or match not found' }, 404);
  if (cand.lat == null || cand.lon == null) return json({ error: 'That match has no location either' }, 400);

  const now = new Date().toISOString();
  await ensureTable(db);
  await db.batch([
    db.prepare(
      `UPDATE source_discoveries
          SET lat = ?1, lon = ?2,
              address = COALESCE(NULLIF(TRIM(address), ''), ?3),
              zipcode = COALESCE(NULLIF(TRIM(zipcode), ''), ?4),
              geocode_status = 'matched', geocoded_at = ?5
        WHERE source = ?6 AND source_ref = ?7`
    ).bind(cand.lat, cand.lon, cand.address || null, cand.zipcode || postcodeOf(cand.address), now, source, ref),
    db.prepare(
      `INSERT INTO source_match_reviews (source, source_ref, cand_source, cand_ref, decision, decided_at)
       VALUES (?1, ?2, ?3, ?4, 'approve', ?5)
       ON CONFLICT(source, source_ref, cand_source, cand_ref) DO UPDATE SET decision='approve', decided_at=excluded.decided_at`
    ).bind(source, ref, cSource, cRef, now),
  ]);
  return json({ success: true, ref, lat: cand.lat, lon: cand.lon });
}

// The match is a mosque already on the site: link to it directly, the
// same way "Put live" links a duplicate (see promote.js).
async function approveLive(context, source, ref, slug) {
  const db = context.env.DB;
  const m = await db.prepare(
    `SELECT slug, name, latitude, longitude, address, postcode FROM mosques WHERE slug = ?1 AND active = 1`
  ).bind(slug).first();
  if (!m) return json({ error: 'That live mosque no longer exists' }, 404);
  const row = await db.prepare(`SELECT name FROM source_discoveries WHERE source = ?1 AND source_ref = ?2`).bind(source, ref).first();
  if (!row) return json({ error: 'Mosque not found' }, 404);

  const now = new Date().toISOString();
  await ensureTable(db);
  const stmts = [
    db.prepare(
      `UPDATE source_discoveries
          SET lat = ?1, lon = ?2, geocode_status = 'matched', geocoded_at = ?3,
              address = COALESCE(NULLIF(TRIM(address), ''), ?4), zipcode = COALESCE(NULLIF(TRIM(zipcode), ''), ?5),
              status = 'duplicate', promoted_slug = ?6, promoted_at = ?3,
              duplicate_of = ?6, duplicate_source = 'mosques', duplicate_reason = 'matched by hand'
        WHERE source = ?7 AND source_ref = ?8`
    ).bind(m.latitude, m.longitude, now, m.address || null, m.postcode || null, slug, source, ref),
    db.prepare(
      `INSERT INTO source_match_reviews (source, source_ref, cand_source, cand_ref, decision, decided_at)
       VALUES (?1, ?2, 'live', ?3, 'approve', ?4)
       ON CONFLICT(source, source_ref, cand_source, cand_ref) DO UPDATE SET decision='approve', decided_at=excluded.decided_at`
    ).bind(source, ref, slug, now),
  ];
  // You approved this by hand, so the link is set even if the code was
  // previously linked somewhere else.
  for (const src of [source, ...(SYNC_SOURCE_ALIASES[source] || [])]) {
    stmts.push(db.prepare(
      `INSERT INTO mosque_sources (source, source_ref, name, lat, lon, mosque_slug, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT(source, source_ref) DO UPDATE SET mosque_slug = excluded.mosque_slug, last_seen = excluded.last_seen`
    ).bind(src, ref, row.name, m.latitude, m.longitude, slug, now));
  }
  await db.batch(stmts);
  const cleared = await clearTodaysAreas(context.env);
  return json({ success: true, ref, linkedTo: slug, areasCleared: cleared });
}

async function reject(db, body) {
  const source = String(body.source || ''), ref = String(body.ref || '');
  const cands = Array.isArray(body.cand_refs) ? body.cand_refs : [];
  if (!source || !ref || !cands.length) return json({ error: 'source, ref and cand_refs are required' }, 400);
  await ensureTable(db);
  const now = new Date().toISOString();
  await db.batch(cands.slice(0, 10).map((c) => {
    const [cs, ...rest] = String(c).split(':');
    return db.prepare(
      `INSERT INTO source_match_reviews (source, source_ref, cand_source, cand_ref, decision, decided_at)
       VALUES (?1, ?2, ?3, ?4, 'reject', ?5)
       ON CONFLICT(source, source_ref, cand_source, cand_ref) DO UPDATE SET decision='reject', decided_at=excluded.decided_at`
    ).bind(source, ref, cs, rest.join(':'), now);
  }));
  return json({ success: true, ref, rejected: cands.length });
}

/* ------------------------------------------------------ manual entry */

const PAGE = 25;

async function missing(context, url) {
  const db = context.env.DB;
  const source = String(url.searchParams.get('source') || '');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
  if (!source) return json({ error: 'source is required' }, 400);
  let where = NEEDS_LOCATION;
  const binds = [source];
  if (q) { where += ` AND (name LIKE ?2 OR city LIKE ?2 OR address LIKE ?2 OR zipcode LIKE ?2 OR source_ref LIKE ?2 OR raw_json LIKE ?2)`; binds.push('%' + q + '%'); }
  const [rows, total] = await db.batch([
    db.prepare(`SELECT source_ref, name, city, address, zipcode, phone, site, raw_json FROM source_discoveries
                 WHERE ${where} ORDER BY name IS NULL, name, source_ref LIMIT ${PAGE + 1} OFFSET ${offset}`).bind(...binds),
    db.prepare(`SELECT COUNT(*) AS n FROM source_discoveries WHERE ${where}`).bind(...binds),
  ]);
  const list = (rows.results || []);
  return json({
    source, total: (total.results && total.results[0] && total.results[0].n) || 0,
    offset, more: list.length > PAGE,
    list: list.slice(0, PAGE).map((r) => ({ ref: r.source_ref, ...describe(r) })),
  });
}

const okLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const okLon = (v) => Number.isFinite(v) && v >= -180 && v <= 180;

function coordsFromText(t) {
  const pats = [
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,                         // .../@51.58,0.09,17z
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,                         // ...!3d51.58!4d0.09
    /[?&](?:q|query|ll|destination|daddr|center)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /^\s*\(?(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\)?\s*$/,       // "51.58, 0.09"
  ];
  for (const re of pats) {
    const m = re.exec(t);
    if (m) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (okLat(lat) && okLon(lon)) return { lat, lon };
    }
  }
  return null;
}

async function resolveInput(input) {
  const text = String(input || '').trim();
  if (!text) return { error: 'Enter a postcode, coordinates or a Google Maps link' };

  let c = coordsFromText(text);
  if (c) return { ...c, how: 'coordinates' };

  // Short Google Maps links: follow the redirect to the full link.
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text)) {
    try {
      let next = text;
      for (let i = 0; i < 4; i++) {
        const res = await fetch(next, { redirect: 'manual' });
        const loc = res.headers.get('Location');
        if (!loc) break;
        next = new URL(loc, next).toString();
        c = coordsFromText(decodeURIComponent(next));
        if (c) return { ...c, how: 'Google Maps link' };
      }
    } catch (e) { /* fall through to the error below */ }
    return { error: "Couldn't read that short link - open it, then copy the full link from the address bar" };
  }

  const pc = postcodeOf(text);
  if (pc) {
    try {
      const res = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s+/g, '')));
      if (res.ok) {
        const d = await res.json();
        if (d && d.result && okLat(d.result.latitude)) {
          return { lat: d.result.latitude, lon: d.result.longitude, postcode: d.result.postcode, how: 'postcode' };
        }
      }
    } catch (e) { /* fall through */ }
    return { error: `Postcode ${pc} wasn't found` };
  }
  return { error: 'Enter a postcode, coordinates (51.58, 0.09) or a Google Maps link' };
}

async function setLocation(db, body) {
  const source = String(body.source || ''), ref = String(body.ref || '');
  if (!source || !ref) return json({ error: 'source and ref are required' }, 400);
  const name = String(body.name || '').trim().slice(0, 200) || null;
  const r = await resolveInput(body.input);
  if (r.error) return json({ error: r.error }, 400);
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE source_discoveries
        SET lat = ?1, lon = ?2, zipcode = COALESCE(?3, zipcode),
            name = COALESCE(NULLIF(TRIM(name), ''), ?4, name),
            geocode_status = 'manual', geocoded_at = ?5
      WHERE source = ?6 AND source_ref = ?7`
  ).bind(r.lat, r.lon, r.postcode || null, name, now, source, ref).run();
  if (res && res.meta && res.meta.changes === 0) return json({ error: 'Mosque not found' }, 404);
  return json({ success: true, ref, lat: r.lat, lon: r.lon, postcode: r.postcode || null, how: r.how, name });
}

/* ------------------------------------------------------------ handlers */

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(context.request.url);
  try {
    const action = url.searchParams.get('action') || 'suggest';
    if (action === 'suggest') return await suggest(context, url);
    if (action === 'missing') return await missing(context, url);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  try {
    if (body.action === 'approve') return await approve(context, body);
    if (body.action === 'reject') return await reject(context.env.DB, body);
    if (body.action === 'set_location') return await setLocation(context.env.DB, body);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

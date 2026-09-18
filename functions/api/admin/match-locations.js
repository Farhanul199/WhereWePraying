// functions/api/admin/match-locations.js
//
// "Match locations" - for holding-pen mosques that can't go live because
// they have no map location (e.g. MasjidBox: 308 waiting), suggest the
// same mosque from a source that DOES have coordinates (MuslimsInBritain).
// You approve or reject each suggestion by hand; nothing is copied until
// you press Approve.
//
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   GET  ?action=suggest&source=masjidbox&pool=muslimsinbritain&limit=25
//        -> mosques still missing a location, each with its best matches
//   POST { action:'approve', source, ref, cand_source, cand_ref }
//        -> copies the match's coordinates (and address/postcode where the
//           mosque has none) onto the mosque. It can then go live with
//           "Put live + send times" as normal, and because it now sits on
//           the exact same spot it LINKS to the live MuslimsInBritain
//           listing instead of creating a duplicate - so its prayer times
//           show on that listing.
//   POST { action:'reject', source, ref, cand_refs:[...] }
//        -> "not the same mosque" - those suggestions never come back.
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

function describe(r) {
  return {
    name: r.name || '',
    address: r.address || null,
    city: r.city || null,
    postcode: postcodeOf(r.zipcode, r.address),
    phone: r.phone || null,
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

  const A = tokens(a.name), B = tokens(b.name);
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

const NEEDS_LOCATION = `source = ?1 AND (lat IS NULL OR lon IS NULL)
  AND (status IS NULL OR status NOT IN ('imported','duplicate','excluded'))
  AND name IS NOT NULL AND TRIM(name) <> ''`;

async function suggest(context, url) {
  const db = context.env.DB;
  const source = String(url.searchParams.get('source') || 'masjidbox');
  const poolSource = String(url.searchParams.get('pool') || 'muslimsinbritain');
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit'), 10) || 25, 50));
  await ensureTable(db);

  const [waiting, pool, reviews] = await db.batch([
    db.prepare(`SELECT source_ref, name, city, address, zipcode, phone FROM source_discoveries WHERE ${NEEDS_LOCATION}`).bind(source),
    db.prepare(
      `SELECT source, source_ref, name, city, address, zipcode, phone, lat, lon, promoted_slug, duplicate_of
         FROM source_discoveries WHERE source = ?1 AND lat IS NOT NULL AND lon IS NOT NULL`
    ).bind(poolSource),
    db.prepare(`SELECT source_ref, cand_source, cand_ref FROM source_match_reviews WHERE source = ?1 AND decision = 'reject'`).bind(source),
  ]);

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

async function approve(db, body) {
  const source = String(body.source || ''), ref = String(body.ref || '');
  const cSource = String(body.cand_source || ''), cRef = String(body.cand_ref || '');
  if (!source || !ref || !cSource || !cRef) return json({ error: 'source, ref, cand_source and cand_ref are required' }, 400);
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

/* ------------------------------------------------------------ handlers */

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(context.request.url);
  try {
    if ((url.searchParams.get('action') || 'suggest') === 'suggest') return await suggest(context, url);
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
    if (body.action === 'approve') return await approve(context.env.DB, body);
    if (body.action === 'reject') return await reject(context.env.DB, body);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

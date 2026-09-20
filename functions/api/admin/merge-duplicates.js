// functions/api/admin/merge-duplicates.js
//
// Finds live mosques that are the same place listed twice, and merges
// each group into ONE definitive entry that carries everything both
// entries knew: coordinates, address, postcode, website, prayer times,
// photos, favourites, source links.
//
// How a merge works (nothing is deleted):
//   - One entry in the group is the KEEPER (the one with prayer times,
//     then the one you edited by hand, then the one with more details).
//   - Every gap in the keeper (empty address, postcode, coordinates,
//     website, city, region, country) is filled from the other entry.
//     Fields you locked by hand on the keeper are never touched.
//   - Everything pointing at the other entry moves to the keeper:
//     source links (so its times follow), month timetable pages, photos,
//     favourites, and holding-pen references.
//   - The other entry is hidden (active = 0) with merged_into = keeper,
//     so old links can still be traced. Reversible by hand.
//
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   GET  ?action=scan                        -> every duplicate group
//   GET  ?action=scan&lat=..&lon=..&miles=5  -> only groups near a spot
//   POST { action:'merge', groups:[{ keep, merge:[slug, ...] }, ...] }
//        -> merges the groups you ticked (max 50 groups per call)
//
// Same-mosque rule (same as promote.js uses when putting mosques live):
//   within 75m of each other ......................... same mosque
//   within 400m AND names match once words like
//   "mosque / masjid / centre / community" are ignored  same mosque
//
// After merging, today's cached areas are cleared so the change shows
// on Find a Mosque straight away (Cloudflare's own edge copy can still
// take up to an hour in some places).

import { isAdminRequest } from '../../_lib/auth.js';
import { AREA_KV_PREFIX, londonNowParts, ensureTimesSchema } from '../../_lib/area-times.js';

const DUP_METERS = 25;        // "blind" match: same spot, no name check needed
const NEAR_NAME_METERS = 400; // needs a name/abbreviation match too, out to this range
const MAX_GROUPS_PER_CALL = 50;
const FILL_FIELDS = ['address', 'postcode', 'website_url', 'city', 'region', 'country'];

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
  'al', 'el', 'bin', 'ibn', 'society', 'ev', 'e', 'v', 'verein', 'moschee', 'camii', 'cami',
]);

function fold(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function tokens(name) {
  return fold(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}
function normName(name) { return fold(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// An abbreviation like "NBM" for "Newbury Park Masjid" shares no WORDS
// with the full name, so the token check above always misses it - it
// needs its own check: do the short name's letters line up with the
// first letters of the full name's words, in order? Tried both with and
// without "masjid/mosque" itself counted (committees are inconsistent
// about including it - "NBM" vs "NPM" for the same mosque), and as a
// looser in-order subsequence for less tidy abbreviations ("NPMasjid").
// Only ever applied to a clearly abbreviation-shaped word (short, all
// letters, no spaces) - and only as one signal among several, still
// gated by the same distance check every other name match goes through.
function looksLikeAcronym(s) {
  return /^[a-z]{2,6}$/i.test(String(s || '').trim());
}
function initials(words) { return words.map((w) => w[0]).join(''); }
function isSubsequence(short, letters) {
  let i = 0;
  for (const ch of letters) { if (i < short.length && ch === short[i]) i++; }
  return i === short.length;
}
function acronymMatch(short, fullName) {
  if (!looksLikeAcronym(short)) return false;
  const shortLetters = short.toLowerCase().replace(/[^a-z]/g, '');
  const withStop = fold(fullName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const withoutStop = tokens(fullName);
  if (!withStop.length) return false;
  return shortLetters === initials(withStop) || (withoutStop.length && shortLetters === initials(withoutStop))
    || isSubsequence(shortLetters, initials(withStop));
}

function namesMatch(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.length && B.length) {
    // A name that reduces to a SINGLE leftover word after stripping
    // "mosque"/"masjid"/etc ("Poplar Central Mosque" -> "poplar") is too
    // generic to trust as "every one of my words is in yours" - that
    // would match it against any other "Poplar ..." mosque. Only trust
    // a single-word reduction when both sides reduce to that exact same
    // word; a real multi-word overlap still needs every word contained.
    if (A.length === 1 || B.length === 1) {
      if (A.length === 1 && B.length === 1 && A[0] === B[0]) return true;
    } else {
      const aSet = new Set(A), bSet = new Set(B);
      if (A.every((w) => bSet.has(w)) || B.every((w) => aSet.has(w))) return true;
    }
  } else if (normName(a) && normName(a) === normName(b)) {
    return true;
  }
  return acronymMatch(a, b) || acronymMatch(b, a);
}

function meters(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

const normPostcode = (pc) => String(pc || '').toUpperCase().replace(/\s+/g, '');
// The first run of digits in an address line - "117 Oaks Lane" -> "117".
// Only meant to strengthen an already-matching postcode, never used alone.
const buildingNumber = (addr) => { const m = /\b(\d+[a-z]?)\b/i.exec(String(addr || '')); return m ? m[1].toLowerCase() : null; };

function matchReason(a, b) {
  const m = meters(a.latitude, a.longitude, b.latitude, b.longitude);
  const pcA = normPostcode(a.postcode), pcB = normPostcode(b.postcode);
  if (pcA && pcA === pcB) {
    // A full UK postcode covers on the order of 15 addresses - two
    // mosques sharing one exactly is effectively always the same
    // building, regardless of how far apart their geocoded coordinates
    // ended up (a common source of imprecision). Matching building
    // numbers on top makes that certainty visible at a glance.
    const bnA = buildingNumber(a.address), bnB = buildingNumber(b.address);
    if (bnA && bnA === bnB) return { m, strong: true, reason: `same postcode & building number (${a.postcode})` };
    return { m, strong: true, reason: `same postcode (${a.postcode})` };
  }
  if (m <= DUP_METERS) return { m, reason: `same spot (${Math.round(m)}m apart)` };
  if (m <= NEAR_NAME_METERS && namesMatch(a.name, b.name)) return { m, reason: `same name, ${Math.round(m)}m apart` };
  return null;
}

// Buckets mosques into ~500m grid cells so each one is only compared with
// its neighbours - fast even with tens of thousands of mosques.
function findGroups(rows) {
  const CELL = 0.005;
  const grid = new Map();
  const key = (i, j) => i + ':' + j;
  rows.forEach((r, idx) => {
    const k = key(Math.floor(r.latitude / CELL), Math.floor(r.longitude / CELL));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(idx);
  });

  // union-find, so A=B and B=C become one group of three
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links = [];

  rows.forEach((a, i) => {
    const ci = Math.floor(a.latitude / CELL), cj = Math.floor(a.longitude / CELL);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(key(ci + di, cj + dj)) || []) {
        if (j <= i) continue;
        const hit = matchReason(a, rows[j]);
        if (!hit) continue;
        links.push({ i, j, reason: hit.reason, strong: !!hit.strong });
        parent[find(j)] = find(i);
      }
    }
  });

  // Same postcode is treated as certain regardless of distance (see
  // matchReason), but the grid above only ever compares mosques that are
  // ALREADY near each other - two records sharing a postcode because one
  // was geocoded miles off (the exact case this rule exists for) would
  // never even reach matchReason(). A second pass, grouped purely by
  // postcode, catches those the distance-based grid structurally can't.
  const byPostcode = new Map();
  rows.forEach((r, i) => {
    const pc = normPostcode(r.postcode);
    if (!pc) return;
    if (!byPostcode.has(pc)) byPostcode.set(pc, []);
    byPostcode.get(pc).push(i);
  });
  for (const idxs of byPostcode.values()) {
    for (let x = 0; x < idxs.length; x++) for (let y = x + 1; y < idxs.length; y++) {
      const i = idxs[x], j = idxs[y];
      const hit = matchReason(rows[i], rows[j]);
      if (!hit) continue;
      links.push({ i, j, reason: hit.reason, strong: !!hit.strong });
      parent[find(j)] = find(i);
    }
  }

  const groups = new Map();
  for (const l of links) {
    const g = find(l.i);
    if (!groups.has(g)) groups.set(g, { members: new Set(), reasons: new Set(), strong: false });
    const G = groups.get(g);
    G.members.add(l.i); G.members.add(l.j);
    // The spatial pass and the postcode pass can both find the same
    // pair - a Set drops the resulting duplicate line rather than
    // showing the same reasoning twice.
    G.reasons.add(`${rows[l.i].slug} = ${rows[l.j].slug}: ${l.reason}`);
    if (l.strong) G.strong = true;
  }
  // Same postcode (optionally + building number) is about as sure as this
  // gets without opening a map - surface those first so a manual skim
  // hits the confident ones before the ones that actually need a look.
  return [...groups.values()]
    .map((g) => ({ members: [...g.members].map((i) => rows[i]), reasons: [...g.reasons], strong: g.strong }))
    .sort((a, b) => (b.strong - a.strong));
}

/* ---------------------------------------------------------------- keeper */

function lockedSet(row) {
  return new Set(String(row.locked_fields || '').split(',').map((s) => s.trim()).filter(Boolean));
}
function filled(v) { return v !== null && v !== undefined && String(v).trim() !== ''; }

function keeperScore(r) {
  let s = 0;
  if (r.month_pages > 0) s += 1000;          // has a prepared timetable
  if (r.raw_days > 0) s += 800;              // has times from THM / MasjidBox / manual
  if (lockedSet(r).size) s += 300;           // you edited it by hand
  s += Math.min(r.source_links, 10) * 20;
  s += (r.photos || 0) * 10 + (r.favourites || 0) * 5;
  s += FILL_FIELDS.filter((f) => filled(r[f])).length * 3;
  if (/masjid|mosque/i.test(r.name)) s += 1;
  return s;
}

// What the keeper would take from the other entries.
function plannedFills(keep, others) {
  const locked = lockedSet(keep);
  const fills = {};
  const lockAlso = [];
  for (const o of others) {
    const oLocked = lockedSet(o);
    for (const f of FILL_FIELDS) {
      if (fills[f] !== undefined || locked.has(f) || filled(keep[f]) || !filled(o[f])) continue;
      fills[f] = o[f];
      if (oLocked.has(f)) lockAlso.push(f);
    }
    if (fills.latitude === undefined && !locked.has('latitude') && !locked.has('longitude') &&
        (keep.latitude == null || keep.longitude == null) && o.latitude != null && o.longitude != null) {
      fills.latitude = o.latitude; fills.longitude = o.longitude;
      if (oLocked.has('latitude') || oLocked.has('longitude')) lockAlso.push('latitude', 'longitude');
    }
  }
  return { fills, lockAlso: [...new Set(lockAlso)] };
}

/* ------------------------------------------------------------------ data */

// Live mosques with a per-mosque count of what hangs off them. The counts
// come from GROUP BY subqueries (one pass each), not per-row lookups.
const LIVE_QUERY = `
  SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude,
         m.website_url, m.city, m.region, m.country, m.locked_fields, m.created_at,
         COALESCE(mt.n, 0) AS month_pages,
         COALESCE(ms.n, 0) AS source_links,
         COALESCE(rw.n, 0) AS raw_days,
         COALESCE(ph.n, 0) AS photos,
         COALESCE(fv.n, 0) AS favourites
    FROM mosques m
    LEFT JOIN (SELECT mosque, COUNT(*) n FROM mosque_month_times GROUP BY mosque) mt ON mt.mosque = m.slug
    LEFT JOIN (SELECT mosque_slug, COUNT(*) n FROM mosque_sources GROUP BY mosque_slug) ms ON ms.mosque_slug = m.slug
    LEFT JOIN (SELECT ms2.mosque_slug, COUNT(*) n FROM jamaah_raw r
                 JOIN mosque_sources ms2 ON ms2.source = r.source AND ms2.source_ref = r.source_ref
                WHERE r.date >= ?1 GROUP BY ms2.mosque_slug) rw ON rw.mosque_slug = m.slug
    LEFT JOIN (SELECT mosque, COUNT(*) n FROM mosque_photos GROUP BY mosque) ph ON ph.mosque = m.slug
    LEFT JOIN (SELECT mosque, COUNT(*) n FROM mosque_favorites GROUP BY mosque) fv ON fv.mosque = m.slug
   WHERE m.active = 1 AND m.merged_into IS NULL
     AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL`;

async function loadLive(db, box) {
  const today = londonNowParts().dateIso;
  let sql = LIVE_QUERY;
  const binds = [today];
  if (box) {
    sql += ` AND m.latitude BETWEEN ?2 AND ?3 AND m.longitude BETWEEN ?4 AND ?5`;
    binds.push(box.minLat, box.maxLat, box.minLon, box.maxLon);
  }
  try {
    const { results } = await db.prepare(sql).bind(...binds).all();
    return results || [];
  } catch (e) {
    // mosque_favorites / mosque_month_times may not exist on older setups -
    // fall back to the core columns only.
    const lite = `SELECT slug, name, address, postcode, latitude, longitude, website_url, city,
                         region, country, locked_fields, created_at,
                         0 AS month_pages, 0 AS source_links, 0 AS raw_days, 0 AS photos, 0 AS favourites
                    FROM mosques WHERE active = 1 AND merged_into IS NULL
                     AND latitude IS NOT NULL AND longitude IS NOT NULL` +
      (box ? ` AND latitude BETWEEN ?1 AND ?2 AND longitude BETWEEN ?3 AND ?4` : '');
    const { results } = await db.prepare(lite).bind(...(box ? binds.slice(1) : [])).all();
    return results || [];
  }
}

function summary(r) {
  return {
    slug: r.slug, name: r.name, address: r.address || null, postcode: r.postcode || null,
    latitude: r.latitude, longitude: r.longitude, website: r.website_url || null,
    hasTimes: r.month_pages > 0 || r.raw_days > 0, sourceLinks: r.source_links,
    photos: r.photos, favourites: r.favourites, locked: r.locked_fields || null,
  };
}

async function scan(context, url) {
  const db = context.env.DB;
  const lat = parseFloat(url.searchParams.get('lat'));
  const lon = parseFloat(url.searchParams.get('lon'));
  const miles = Math.min(parseFloat(url.searchParams.get('miles')) || 5, 50);
  let box = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const dLat = miles / 69, dLon = miles / (69 * Math.cos((lat * Math.PI) / 180));
    box = { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
  }
  const rows = await loadLive(db, box);
  const groups = findGroups(rows).map((g) => {
    const sorted = [...g.members].sort((a, b) => keeperScore(b) - keeperScore(a) || String(a.created_at).localeCompare(String(b.created_at)));
    const keep = sorted[0], others = sorted.slice(1);
    const { fills } = plannedFills(keep, others);
    return {
      keep: summary(keep),
      merge: others.map(summary),
      why: g.reasons,
      willFill: Object.keys(fills),
      strong: g.strong,
    };
  });
  return json({ checked: rows.length, groups: groups.length, list: groups });
}

/* ----------------------------------------------------------------- merge */

// Every alternate name a mosque has been known by, captured automatically
// whenever an admin approves that two records are the same place (a
// merge here, or a source-match approval in match-locations.js) - never
// guessed, only ever names that actually appeared on a real record. Shown
// on the mosque's own card as "Also known as ..." so a person searching
// under any of MasjidBox's, MuslimsInBritain's, or the mosque's own name
// still lands on the one card, and understands why it did.
async function ensureAliasTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS mosque_aliases (
       mosque_slug TEXT NOT NULL, alias TEXT NOT NULL, source TEXT,
       created_at TEXT NOT NULL, PRIMARY KEY (mosque_slug, alias))`
  ).run();
}
function addAliasStmt(db, mosqueSlug, alias, canonicalName, source, now) {
  const a = String(alias || '').trim();
  if (!a || a.toLowerCase() === String(canonicalName || '').trim().toLowerCase()) return null;
  return db.prepare(
    `INSERT OR IGNORE INTO mosque_aliases (mosque_slug, alias, source, created_at) VALUES (?1, ?2, ?3, ?4)`
  ).bind(mosqueSlug, a, source || null, now);
}

async function mergeGroup(db, keepSlug, mergeSlugs) {
  const slugs = [keepSlug, ...mergeSlugs];
  const ph = slugs.map((_, i) => '?' + (i + 1)).join(',');
  const { results } = await db.prepare(`SELECT * FROM mosques WHERE slug IN (${ph})`).bind(...slugs).all();
  const bySlug = new Map((results || []).map((r) => [r.slug, r]));
  const keep = bySlug.get(keepSlug);
  if (!keep) return { keep: keepSlug, error: 'keeper not found' };
  const others = mergeSlugs.map((s) => bySlug.get(s)).filter(Boolean);
  if (!others.length) return { keep: keepSlug, error: 'nothing to merge' };
  if (others.some((o) => o.merged_into)) return { keep: keepSlug, error: 'already merged - rescan' };

  const { fills, lockAlso } = plannedFills(keep, others);
  const stmts = [];
  await ensureAliasTable(db);
  const keeperName = fills.name || keep.name; // if the merge renames the keeper, alias against the NEW name

  // 1. Fill the keeper's gaps.
  const cols = Object.keys(fills);
  if (cols.length || lockAlso.length) {
    const set = cols.map((c, i) => `${c} = ?${i + 2}`);
    const vals = cols.map((c) => fills[c]);
    if (lockAlso.length) {
      const locked = [...new Set([...lockedSet(keep), ...lockAlso])].join(',');
      set.push(`locked_fields = ?${vals.length + 2}`);
      vals.push(locked);
    }
    stmts.push(db.prepare(`UPDATE mosques SET ${set.join(', ')} WHERE slug = ?1`).bind(keepSlug, ...vals));
  }

  const now = new Date().toISOString();
  for (const o of others) {
    const from = o.slug;
    // The merged-away listing's own name is a real name this mosque has
    // been known by - keep it, rather than losing it once its row goes
    // inactive.
    const aliasStmt = addAliasStmt(db, keepSlug, o.name, keeperName, 'merged:' + from, now);
    if (aliasStmt) stmts.push(aliasStmt);
    // 2. Source links - the times from every source follow the keeper.
    stmts.push(db.prepare(`UPDATE mosque_sources SET mosque_slug = ?1 WHERE mosque_slug = ?2`).bind(keepSlug, from));
    // 3. Month timetable pages - keep the keeper's own, take the rest.
    stmts.push(db.prepare(
      `INSERT OR IGNORE INTO mosque_month_times (mosque, month, times, jummah, source, updated_at)
       SELECT ?1, month, times, jummah, source, ?3 FROM mosque_month_times WHERE mosque = ?2`
    ).bind(keepSlug, from, now));
    stmts.push(db.prepare(`DELETE FROM mosque_month_times WHERE mosque = ?1`).bind(from));
    // 4. Photos and favourites (a person who favourited both keeps one).
    stmts.push(db.prepare(`UPDATE mosque_photos SET mosque = ?1 WHERE mosque = ?2`).bind(keepSlug, from));
    stmts.push(db.prepare(`UPDATE OR IGNORE mosque_favorites SET mosque = ?1 WHERE mosque = ?2`).bind(keepSlug, from));
    stmts.push(db.prepare(`DELETE FROM mosque_favorites WHERE mosque = ?1`).bind(from));
    // 5. Holding-pen rows that went live as (or linked to) the old entry.
    stmts.push(db.prepare(`UPDATE source_discoveries SET promoted_slug = ?1 WHERE promoted_slug = ?2`).bind(keepSlug, from));
    stmts.push(db.prepare(
      `UPDATE source_discoveries SET duplicate_of = ?1 WHERE duplicate_of = ?2 AND duplicate_source = 'mosques'`
    ).bind(keepSlug, from));
    // 6. Hide the old entry, pointing at the keeper. Nothing deleted.
    stmts.push(db.prepare(`UPDATE mosques SET merged_into = ?1, active = 0 WHERE slug = ?2`).bind(keepSlug, from));
  }

  // One batch = all-or-nothing: either the whole group merges or nothing changes.
  try {
    await db.batch(stmts);
  } catch (e) {
    return { keep: keepSlug, error: String(e) };
  }
  return { keep: keepSlug, merged: others.map((o) => o.slug), filled: cols };
}

// Today's cached areas still hold the old entries - drop them so Find a
// Mosque rebuilds from the merged data on the next visit.
async function clearTodaysAreas(env) {
  if (!env.RATE_LIMIT) return 0;
  const today = londonNowParts().dateIso;
  let cleared = 0, cursor;
  try {
    do {
      const page = await env.RATE_LIMIT.list({ prefix: AREA_KV_PREFIX, cursor, limit: 1000 });
      for (const k of page.keys) {
        if (!k.name.endsWith(':' + today)) continue;
        await env.RATE_LIMIT.delete(k.name);
        if (++cleared >= 300) return cleared;
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  } catch (e) { /* best effort - areas expire within 6 hours anyway */ }
  return cleared;
}

/* ------------------------------------------------------------ handlers */

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'scan';
  try {
    await ensureTimesSchema(context.env.DB);
    if (action === 'scan') return await scan(context, url);
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  if (!body || body.action !== 'merge') return json({ error: 'Unknown action' }, 400);

  const groups = Array.isArray(body.groups) ? body.groups.slice(0, MAX_GROUPS_PER_CALL) : [];
  const clean = groups
    .map((g) => ({
      keep: String(g && g.keep || '').trim(),
      merge: (Array.isArray(g && g.merge) ? g.merge : []).map((s) => String(s || '').trim()).filter(Boolean),
    }))
    .filter((g) => g.keep && g.merge.length && !g.merge.includes(g.keep));
  if (!clean.length) return json({ error: 'No groups to merge' }, 400);

  try { await ensureTimesSchema(context.env.DB); } catch (e) { /* table already there */ }
  const results = [];
  for (const g of clean) {
    try { results.push(await mergeGroup(context.env.DB, g.keep, g.merge)); }
    catch (e) { results.push({ keep: g.keep, error: String(e) }); }
  }
  const ok = results.filter((r) => !r.error).length;
  const cleared = ok ? await clearTodaysAreas(context.env) : 0;
  return json({ merged: ok, failed: results.length - ok, results, areasCleared: cleared });
}

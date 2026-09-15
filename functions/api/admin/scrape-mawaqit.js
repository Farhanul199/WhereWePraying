// functions/api/admin/scrape-mawaqit.js
//
// MAWAQIT scraper. Permission on record: Yamin (MAWAQIT), by phone.
//
// Everything this file writes goes into source_discoveries ONLY - the
// holding pen from migrations/008. It never touches mosques, jamaah_raw,
// mosque_sources or the live views, so nothing here can appear on the
// website until you deliberately promote it.
//
// TWO MODES
//
// 1) mode=discover  - one request to MAWAQIT's country map, gets every
//    mosque in that country (name, slug, coordinates, address). Fast,
//    one call, no timetables yet.
//
//      curl "https://wherewepraying.com/api/admin/scrape-mawaqit?mode=discover&country=GB" \
//        -H "X-Sync-Key: YOUR_SYNC_SECRET"
//
// 2) mode=times     - visits each mosque's own MAWAQIT page and pulls
//    confData: the FULL YEAR of adhan times plus the full year of
//    jama'ah (iqama) times, in one request per mosque. This is a
//    ONE-TIME pull per mosque (not a daily job) - Mawaqit has no bulk
//    "give me 1000 mosques' timetables" endpoint, not even in their own
//    official package, so one page load per mosque is unavoidable. What
//    IS avoidable is doing them one at a time: this fetches 8 mosque
//    pages at once instead of 1, so a batch takes seconds, not minutes.
//    Run it repeatedly; each run picks up where the last one stopped.
//
//      curl "https://wherewepraying.com/api/admin/scrape-mawaqit?mode=times&limit=20" \
//        -H "X-Sync-Key: YOUR_SYNC_SECRET"
//
// Optional: &slug=some-mosque to (re)fetch one mosque, &retry=1 to
// include previously failed ones, &country=GB to restrict the batch.
//
// Free-tier safety: Cloudflare's free plan caps a single request at 50
// outbound fetches. A shared budget (FETCH_BUDGET) stops this run before
// that cap regardless of concurrency or limit, and anything it didn't
// get to simply stays 'pending' for the next call - nothing is lost.

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';
import { logSyncRun } from '../../_lib/synclog.js';

const SOURCE = 'mawaqit';
const MAP_API = 'https://mawaqit.net/api/2.0/mosque/map/';
const PAGE_BASES = ['https://mawaqit.net/en/', 'https://mawaqit.net/fr/', 'https://mawaqit.net/en/m/'];
const UA = 'WhereWePrayingBot/1.0 (+https://wherewepraying.com; contact via site)';
const CONCURRENCY = 8;         // mosque pages fetched at once, not one-by-one
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 24;          // keeps worst case (2 page-bases x this) under
                                // Cloudflare free tier's 50-external-fetch-per-run cap
const FETCH_BUDGET = 45;       // hard stop once this many outbound fetches happen
                                // in one run, leaving headroom under the 50 cap

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs `fn` over `items` with at most `limit` running at the same time,
// instead of one mosque page at a time. This is what makes a 20-mosque
// batch take a few seconds instead of a few tens of seconds.
async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

// MAWAQIT's map endpoint has changed shape before, so pick fields
// defensively and keep the untouched original in raw_json.
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// Flattens whatever the country map returns (array, {mosques:[...]},
// or an object keyed by city) into a plain list of mosque objects.
function flattenMosques(data) {
  const out = [];
  const visit = (node, depth) => {
    if (!node || depth > 3) return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
    if (typeof node !== 'object') return;
    if (pick(node, ['slug', 'mosqueSlug', 'url', 'id', 'uuid'])) { out.push(node); return; }
    Object.values(node).forEach((n) => visit(n, depth + 1));
  };
  visit(data, 0);
  return out;
}

// MAWAQIT slugs sometimes arrive as a full URL or a "/en/slug" path.
function cleanSlug(value) {
  if (!value) return null;
  let s = String(value).trim();
  s = s.replace(/^https?:\/\/[^/]+\//i, '');
  s = s.replace(/^(en|fr|ar|es|de|nl|it|tr|pt)\/(m\/)?/i, '');
  s = s.replace(/^\/+|\/+$/g, '');
  return s || null;
}

// Pulls the confData object out of a MAWAQIT page. The object is large
// and contains nested braces, so we brace-count instead of regexing it.
function extractConfData(html) {
  const marker = /(?:var|let|const)\s+confData\s*=\s*\{/.exec(html);
  if (!marker) return null;
  const start = html.indexOf('{', marker.index);
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// `budget` is a shared { used, max } counter across the whole batch so we
// never blow past Cloudflare's per-run outbound-fetch cap even when many
// mosques each need a second or third URL pattern tried.
async function fetchConfData(slug, budget) {
  let lastStatus = 0;
  for (const base of PAGE_BASES) {
    if (budget.used >= budget.max) return { conf: null, status: 'budget', capped: true };
    budget.used++;
    let res;
    try {
      res = await fetch(base + encodeURIComponent(slug), {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
      });
    } catch (e) {
      lastStatus = -1;
      continue;
    }
    lastStatus = res.status;
    if (!res.ok) continue;
    const conf = extractConfData(await res.text());
    if (conf) return { conf, url: base + slug };
  }
  return { conf: null, status: lastStatus };
}

/* ------------------------------------------------------------------ */
/* SQL                                                                 */
/* ------------------------------------------------------------------ */

const UPSERT_DISCOVERY = `
  INSERT INTO source_discoveries
    (source, source_ref, uuid, name, country, city, address, zipcode,
     lat, lon, site, email, phone, raw_json, times_status, status,
     first_seen, last_seen)
  VALUES ('${SOURCE}', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
          'pending', 'new', ?14, ?14)
  ON CONFLICT(source, source_ref) DO UPDATE SET
    uuid     = COALESCE(excluded.uuid, source_discoveries.uuid),
    name     = COALESCE(excluded.name, source_discoveries.name),
    country  = COALESCE(excluded.country, source_discoveries.country),
    city     = COALESCE(excluded.city, source_discoveries.city),
    address  = COALESCE(excluded.address, source_discoveries.address),
    zipcode  = COALESCE(excluded.zipcode, source_discoveries.zipcode),
    lat      = COALESCE(excluded.lat, source_discoveries.lat),
    lon      = COALESCE(excluded.lon, source_discoveries.lon),
    site     = COALESCE(excluded.site, source_discoveries.site),
    email    = COALESCE(excluded.email, source_discoveries.email),
    phone    = COALESCE(excluded.phone, source_discoveries.phone),
    raw_json = excluded.raw_json,
    last_seen = excluded.last_seen
`;

const UPDATE_TIMES_OK = `
  UPDATE source_discoveries SET
    name = COALESCE(?2, name),
    country = COALESCE(?3, country),
    lat = COALESCE(?4, lat),
    lon = COALESCE(?5, lon),
    site = COALESCE(?6, site),
    jumua = ?7, jumua2 = ?8, jumua_as_duhr = ?9, iqama_enabled = ?10,
    calendar_json = ?11, iqama_json = ?12,
    times_status = 'ok', error = NULL,
    times_updated_at = ?13, last_seen = ?13
  WHERE source = '${SOURCE}' AND source_ref = ?1
`;

const UPDATE_TIMES_FAIL = `
  UPDATE source_discoveries SET
    times_status = 'failed', error = ?2, last_seen = ?3
  WHERE source = '${SOURCE}' AND source_ref = ?1
`;

/* ------------------------------------------------------------------ */
/* mode: discover                                                      */
/* ------------------------------------------------------------------ */

async function runDiscover(env, country) {
  const cc = (country || 'GB').toUpperCase();
  const res = await fetch(MAP_API + cc, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
  });
  if (!res.ok) {
    return { mode: 'discover', country: cc, ok: false, status: res.status,
             message: 'MAWAQIT country map request failed.' };
  }

  const list = flattenMosques(await res.json());
  const now = new Date().toISOString();
  const statements = [];
  let skipped = 0;

  for (const m of list) {
    const slug = cleanSlug(pick(m, ['slug', 'mosqueSlug', 'url', 'id']));
    if (!slug) { skipped++; continue; }
    statements.push(
      env.DB.prepare(UPSERT_DISCOVERY).bind(
        slug,
        pick(m, ['uuid', 'id']) ? String(pick(m, ['uuid', 'id'])) : null,
        pick(m, ['name', 'label', 'title']),
        String(pick(m, ['countryCode', 'country']) || cc).toUpperCase().slice(0, 2),
        pick(m, ['city', 'localisation', 'town']),
        pick(m, ['address', 'addr', 'street']),
        pick(m, ['zipcode', 'zipCode', 'postcode', 'postCode']),
        num(pick(m, ['lat', 'latitude'])),
        num(pick(m, ['lng', 'lon', 'longitude'])),
        pick(m, ['site', 'website', 'url_site']),
        pick(m, ['email']),
        pick(m, ['phone', 'tel']),
        JSON.stringify(m),
        now
      )
    );
  }

  // D1 batches are chunked so a big country cannot blow the statement limit.
  let written = 0;
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
    written += Math.min(50, statements.length - i);
  }

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS with_times
       FROM source_discoveries WHERE source = ? AND country = ?`
  ).bind(SOURCE, cc).first();

  return {
    mode: 'discover',
    ok: true,
    country: cc,
    mosquesReturnedByMawaqit: list.length,
    rowsSaved: written,
    skippedNoSlug: skipped,
    totalInHoldingPen: totals?.total || 0,
    withFullYearTimes: totals?.with_times || 0,
    nextStep: 'Run mode=times repeatedly until withFullYearTimes matches totalInHoldingPen.',
  };
}

/* ------------------------------------------------------------------ */
/* mode: times                                                         */
/* ------------------------------------------------------------------ */

async function runTimes(env, { limit, country, slug, retry }) {
  let rows;
  if (slug) {
    rows = [{ source_ref: slug }];
  } else {
    const wanted = retry ? "('pending','failed')" : "('pending')";
    const sql =
      `SELECT source_ref FROM source_discoveries
        WHERE source = ?1 AND times_status IN ${wanted}` +
      (country ? ' AND country = ?2' : '') +
      ' ORDER BY source_ref LIMIT ' + limit;
    const stmt = country
      ? env.DB.prepare(sql).bind(SOURCE, country.toUpperCase())
      : env.DB.prepare(sql).bind(SOURCE);
    rows = (await stmt.all()).results || [];
  }

  const now = new Date().toISOString();
  const done = [];
  const failed = [];
  const budget = { used: 0, max: FETCH_BUDGET };

  await pMapLimit(rows, CONCURRENCY, async (row) => {
    const ref = row.source_ref;
    try {
      const { conf, status, capped } = await fetchConfData(ref, budget);
      if (!conf) {
        // Hit this run's fetch budget: leave it 'pending', not 'failed',
        // so the very next batch just picks it straight back up.
        if (capped) return;
        failed.push({ slug: ref, reason: 'no confData (http ' + status + ')' });
        await env.DB.prepare(UPDATE_TIMES_FAIL)
          .bind(ref, 'no confData (http ' + status + ')', now).run();
        return;
      }

      await env.DB.prepare(UPDATE_TIMES_OK).bind(
        ref,
        conf.name || null,
        conf.countryCode ? String(conf.countryCode).toUpperCase() : null,
        num(conf.latitude),
        num(conf.longitude),
        conf.site || null,
        conf.jumua || null,
        conf.jumua2 || null,
        conf.jumuaAsDuhr ? 1 : 0,
        conf.iqamaEnabled ? 1 : 0,
        conf.calendar ? JSON.stringify(conf.calendar) : null,
        conf.iqamaCalendar ? JSON.stringify(conf.iqamaCalendar) : null,
        now
      ).run();

      done.push({ slug: ref, name: conf.name, iqama: !!conf.iqamaEnabled });
    } catch (e) {
      failed.push({ slug: ref, reason: String(e) });
      await env.DB.prepare(UPDATE_TIMES_FAIL).bind(ref, String(e).slice(0, 300), now).run();
    }
  });

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS ok,
            SUM(CASE WHEN times_status='pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN times_status='failed' THEN 1 ELSE 0 END) AS failed
       FROM source_discoveries WHERE source = ?`
  ).bind(SOURCE).first();

  return {
    mode: 'times',
    ok: true,
    attempted: rows.length,
    succeeded: done.length,
    failed: failed.length,
    failures: failed.slice(0, 20),
    progress: {
      total: totals?.total || 0,
      withTimes: totals?.ok || 0,
      stillToDo: totals?.pending || 0,
      failedSoFar: totals?.failed || 0,
    },
    moreToDo: (totals?.pending || 0) > 0,
  };
}

/* ------------------------------------------------------------------ */

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isSyncRequest(context) && !isAdminRequest(context)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'discover').toLowerCase();
  const country = url.searchParams.get('country');
  const slug = cleanSlug(url.searchParams.get('slug'));
  const retry = url.searchParams.get('retry') === '1';
  let limit = parseInt(url.searchParams.get('limit') || DEFAULT_LIMIT, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const startedAt = new Date().toISOString();
  let body;
  try {
    body = mode === 'times'
      ? await runTimes(env, { limit, country, slug, retry })
      : await runDiscover(env, country);
  } catch (e) {
    body = { ok: false, mode, error: String(e) };
  }

  await logSyncRun(env.DB, {
    source: 'mawaqit_' + mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    dateFrom: null,
    dateTo: null,
    itemsAttempted: body.attempted || body.mosquesReturnedByMawaqit || 0,
    itemsOk: body.succeeded || body.rowsSaved || 0,
    itemsFailed: body.failed || 0,
    rowsWritten: body.rowsSaved || body.succeeded || 0,
    gaps: [],
    errors: body.failures || (body.ok === false ? [body] : []),
  });

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}

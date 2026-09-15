// functions/api/admin/scrape-masjidbox.js
//
// MasjidBox collector for the isolated "Sources" holding pen.
// Approval on record: Abdullahi, MasjidBox chief of operations, via email.
//
// ---------------------------------------------------------------------
// THIS IS NOT THE LIVE SYNC. functions/api/admin/sync-masjidbox-jamaah.js
// still runs untouched on its own cron and still feeds the live site via
// jamaah_raw. This file writes ONLY to source_discoveries, which nothing
// on the public site ever reads. Two separate jobs on purpose: the live
// one keeps working exactly as before while this one collects, so
// nothing can be broken by experimenting here.
// ---------------------------------------------------------------------
//
// HOW MASJIDBOX DIFFERS FROM MAWAQIT (matters for the UI):
//
//   1. No discovery endpoint. MasjidBox's API only answers per-mosque,
//      if you already know the slug - there's no "list every mosque in
//      the UK" call. So mode=discover here makes NO network requests at
//      all; it just seeds the 348 known slugs (functions/_lib/
//      masjidbox-mosques.js) into the holding pen. Instant.
//
//   2. 7-day rolling window only. Their API silently caps at 7 days no
//      matter what you ask for (days=90/120/200 all return exactly 7;
//      some larger values 500 under load). There is no year-ahead pull.
//      That means MasjidBox data goes STALE and has to be re-collected
//      continuously - unlike Mawaqit, where one pull lasts a year.
//      Handled by REFRESH_AFTER_DAYS below.
//
// MODES
//   ?mode=discover
//       Seeds all 348 slugs as pending. No network calls, no arguments.
//
//   ?mode=times&limit=N
//       Fetches N mosques that need data - those never fetched, then
//       those whose 7-day window is going stale (oldest first). One API
//       call per mosque returns both the mosque's details and its week,
//       so this single pass fills in everything.
//
// Auth: X-Sync-Key (worker) or X-Broadcast-Key (admin page).

import { isSyncRequest, isAdminRequest } from '../../_lib/auth.js';
import { logSyncRun } from '../../_lib/synclog.js';
import { MASJIDBOX_MOSQUES } from '../../_lib/masjidbox-mosques.js';

const SOURCE = 'masjidbox';
const COVERAGE = 'rolling7';

const API_BASE = 'https://api.masjidbox.com/1.0/masjidbox/landing/athany/';
// Public frontend key, embedded in MasjidBox's own JS bundle - same one
// the live sync already uses.
const APIKEY = 'JejYcMS7hsOsZTPDk2ZhKOAlW9IyQ6Px';

// Per instruction: always excluded from every mosque list, everywhere.
const EXCLUDED = new Set(['imamiamissionlondon']);

// A 7-day window collected 5+ days ago is nearly spent, so re-pull it.
const REFRESH_AFTER_DAYS = 5;

// Cloudflare free tier allows 50 external fetches per invocation; stop
// short of that so a batch never dies mid-way.
const FETCH_BUDGET = 45;
const CONCURRENCY = 6;
const MAX_LIMIT = 24;

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// "2026-09-08T05:45:00+01:00" -> "05:45"
function isoToHm(iso) {
  if (!iso) return null;
  const m = String(iso).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------ discover */

async function discover(env) {
  const startedAt = new Date().toISOString();
  const nowIso = startedAt;
  const rows = MASJIDBOX_MOSQUES.filter((m) => !EXCLUDED.has(m.slug));

  const sql = `
    INSERT INTO source_discoveries
      (source, source_ref, name, country, coverage, times_status, status, first_seen, last_seen)
    VALUES (?, ?, ?, 'GB', ?, 'pending', 'new', ?, ?)
    ON CONFLICT(source, source_ref) DO UPDATE SET
      name      = COALESCE(source_discoveries.name, excluded.name),
      coverage  = excluded.coverage,
      last_seen = excluded.last_seen
  `;

  // Batched so this is a handful of D1 round-trips, not 348.
  const CHUNK = 50;
  let saved = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const stmts = rows.slice(i, i + CHUNK).map((m) =>
      env.DB.prepare(sql).bind(SOURCE, m.slug, m.name, COVERAGE, nowIso, nowIso)
    );
    await env.DB.batch(stmts);
    saved += stmts.length;
  }

  await logSyncRun(env.DB, {
    source: 'masjidbox_discover',
    startedAt, finishedAt: new Date().toISOString(),
    itemsAttempted: rows.length, itemsOk: saved, itemsFailed: 0,
    rowsWritten: saved,
  });

  return json({
    ok: true,
    source: SOURCE,
    mosquesReturnedByMasjidbox: rows.length,
    rowsSaved: saved,
    note: 'MasjidBox has no "list all mosques" API, so this seeds a verified slug list instead. No requests were made to MasjidBox.',
  });
}

/* --------------------------------------------------------------- times */

async function fetchOne(slug, budget) {
  if (budget.used >= budget.max) return { slug, skipped: 'budget' };
  budget.used++;

  const begin = new Date().toISOString().slice(0, 10) + 'T00:00:00.000+00:00';
  const url = `${API_BASE}${encodeURIComponent(slug)}?get=at&days=7&begin=${encodeURIComponent(begin)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Apikey: APIKEY,
        Accept: 'application/json',
        'User-Agent': 'WhereWePraying/1.0 (+https://wherewepraying.com) mosque prayer time aggregator',
      },
    });
    if (!res.ok) return { slug, error: 'HTTP ' + res.status };
    const data = await res.json();
    if (!data || typeof data !== 'object') return { slug, error: 'unreadable response' };
    return { slug, data };
  } catch (e) {
    return { slug, error: String(e) };
  }
}

function extract(data) {
  // MasjidBox's response shape isn't publicly documented and has varied,
  // so read defensively: look for the mosque's details under whichever
  // of the plausible keys is actually present, and never guess a value
  // that isn't there (a missing field stays null rather than inventing).
  const m = data.masjid || data.mosque || data.landing || data.info || {};
  const loc = m.location || m.address || data.location || {};
  const coords = m.coordinates || m.coords || loc.coordinates || loc.coords || {};

  const timetable = Array.isArray(data.timetable) ? data.timetable : [];
  const days = [];
  for (const day of timetable) {
    const date = String(day.date || '').slice(0, 10);
    if (!date) continue;
    const iq = day.iqamah || {};
    const at = day.athan || day.adhan || {};
    days.push({
      date,
      iqamah: {
        fajr: isoToHm(iq.fajr), dhuhr: isoToHm(iq.dhuhr), asr: isoToHm(iq.asr),
        maghrib: isoToHm(iq.maghrib), isha: isoToHm(iq.isha),
      },
      athan: {
        fajr: isoToHm(at.fajr), dhuhr: isoToHm(at.dhuhr), asr: isoToHm(at.asr),
        maghrib: isoToHm(at.maghrib), isha: isoToHm(at.isha),
      },
    });
  }

  const hasIqama = days.some((d) => Object.values(d.iqamah).some((v) => v));

  return {
    name: pick(m, ['name', 'title', 'displayName']),
    city: pick(loc, ['city', 'town', 'locality']) || pick(m, ['city']),
    address: pick(loc, ['address', 'street', 'line1', 'formatted']) ||
             (typeof m.address === 'string' ? m.address : null),
    zipcode: pick(loc, ['zipcode', 'postcode', 'postalCode', 'zip']),
    lat: num(pick(coords, ['lat', 'latitude']) ?? pick(m, ['lat', 'latitude'])),
    lon: num(pick(coords, ['lng', 'lon', 'long', 'longitude']) ?? pick(m, ['lng', 'lon', 'longitude'])),
    site: pick(m, ['website', 'url', 'site']),
    email: pick(m, ['email']),
    phone: pick(m, ['phone', 'telephone', 'tel']),
    jumua: isoToHm(pick(data, ['jumua', 'jumuah'])) || pick(m, ['jumua', 'jumuah']),
    hasIqama,
    days,
  };
}

async function times(env, limit) {
  const startedAt = new Date().toISOString();
  const nowIso = startedAt;
  const staleBefore = new Date(Date.now() - REFRESH_AFTER_DAYS * 86400000).toISOString();

  // Never-fetched first, then whichever windows are closest to expiring.
  const { results } = await env.DB.prepare(
    `SELECT source_ref FROM source_discoveries
      WHERE source = ?
        AND (times_status = 'pending'
             OR (times_status = 'ok' AND (times_updated_at IS NULL OR times_updated_at < ?)))
      ORDER BY CASE WHEN times_status = 'pending' THEN 0 ELSE 1 END,
               COALESCE(times_updated_at, '')
      LIMIT ?`
  ).bind(SOURCE, staleBefore, limit).all();

  const slugs = (results || []).map((r) => r.source_ref);
  const budget = { used: 0, max: FETCH_BUDGET };
  const fetched = [];

  for (let i = 0; i < slugs.length; i += CONCURRENCY) {
    const chunk = slugs.slice(i, i + CONCURRENCY);
    const out = await Promise.all(chunk.map((s) => fetchOne(s, budget)));
    fetched.push(...out);
    if (budget.used >= budget.max) break;
  }

  const updateOk = `
    UPDATE source_discoveries SET
      name = COALESCE(?, name), city = COALESCE(?, city), address = COALESCE(?, address),
      zipcode = COALESCE(?, zipcode), lat = COALESCE(?, lat), lon = COALESCE(?, lon),
      site = COALESCE(?, site), email = COALESCE(?, email), phone = COALESCE(?, phone),
      jumua = COALESCE(?, jumua), iqama_enabled = ?, calendar_json = ?, raw_json = ?,
      coverage = ?, times_status = 'ok', error = NULL,
      times_updated_at = ?, last_seen = ?
    WHERE source = ? AND source_ref = ?
  `;
  const updateFail = `
    UPDATE source_discoveries
       SET times_status = 'failed', error = ?, last_seen = ?
     WHERE source = ? AND source_ref = ?
  `;

  const stmts = [];
  let succeeded = 0, failed = 0, skipped = 0;

  for (const r of fetched) {
    if (r.skipped) { skipped++; continue; } // stays pending, next batch picks it up
    if (r.error || !r.data) {
      failed++;
      stmts.push(env.DB.prepare(updateFail).bind(r.error || 'no data', nowIso, SOURCE, r.slug));
      continue;
    }
    const e = extract(r.data);
    if (!e.days.length) {
      failed++;
      stmts.push(env.DB.prepare(updateFail).bind('no timetable in response', nowIso, SOURCE, r.slug));
      continue;
    }
    succeeded++;
    stmts.push(env.DB.prepare(updateOk).bind(
      e.name, e.city, e.address, e.zipcode, e.lat, e.lon, e.site, e.email, e.phone,
      e.jumua, e.hasIqama ? 1 : 0,
      JSON.stringify(e.days), JSON.stringify(r.data).slice(0, 100000),
      COVERAGE, nowIso, nowIso, SOURCE, r.slug
    ));
  }

  if (stmts.length) await env.DB.batch(stmts);

  const prog = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS withTimes,
            SUM(CASE WHEN times_status='pending' THEN 1 ELSE 0 END) AS stillToDo,
            SUM(CASE WHEN times_status='failed' THEN 1 ELSE 0 END) AS failedSoFar
       FROM source_discoveries WHERE source = ?`
  ).bind(SOURCE).first();

  await logSyncRun(env.DB, {
    source: 'masjidbox_times',
    startedAt, finishedAt: new Date().toISOString(),
    itemsAttempted: fetched.length - skipped,
    itemsOk: succeeded,
    itemsFailed: failed,
    rowsWritten: stmts.length,
    errors: fetched.filter((r) => r.error).map((r) => ({ slug: r.slug, error: r.error })),
  });

  return json({
    ok: true,
    source: SOURCE,
    attempted: fetched.length - skipped,
    succeeded,
    failed,
    deferredToNextBatch: skipped,
    moreToDo: (prog && prog.stillToDo > 0) || slugs.length === limit,
    progress: prog,
    note: 'MasjidBox gives a 7-day window only, so these rows go stale and are automatically re-collected.',
  });
}

/* -------------------------------------------------------------- entry */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isSyncRequest(context) && !isAdminRequest(context)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const mode = url.searchParams.get('mode') || 'discover';

  try {
    if (mode === 'discover') return await discover(env);
    if (mode === 'times') {
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '12', 10) || 12, MAX_LIMIT);
      return await times(env, limit);
    }
    return json({ ok: false, error: 'mode must be "discover" or "times"' }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

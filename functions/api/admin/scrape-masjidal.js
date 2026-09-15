// functions/api/admin/scrape-masjidal.js
//
// Masjidal (masjidal.com) — verified live against the real API before
// writing this (see comment below), unlike the Takbeer Time build-spec
// docs that turned out to invent details. No bulk "list mosques" endpoint
// exists — mosque IDs (8-char mixed-case) are only discoverable by finding
// their widget embed on the mosque's own website, so discovery here works
// differently from every other source: you paste in mosque website URLs
// and this scans each page's HTML for a widget embed.
//
// VERIFIED (live response, not docs):
//   GET https://masjidal.com/api/v1/time/range?masjid_id=QKMqqaKB
//   { "status":"success",
//     "data": {
//       "salah":  [{ "date":"...", "fajr":"5:00AM", "sunrise":"...", "zuhr":"1:01PM", "asr":"4:23PM", "maghrib":"7:18PM", "isha":"8:33PM" }],
//       "iqamah": [{ "date":"...", "fajr":"5:25AM", "zuhr":"1:16PM", "asr":"4:38PM", "maghrib":"7:28PM", "isha":"8:43PM", "jummah1":"1:25 PM", "jummah2":"-" }]
//     }, "message": [] }
// No auth. Uses "zuhr" not "dhuhr". No auth required. Returns no mosque
// name/address/coordinates at all — this source is times-only; location
// data for these mosques has to come from wherever the widget URL was found
// (name is left NULL here, same treatment MasjidBox gives an unnamed row).
//
// mode=discover — POST body is raw text, one mosque website URL per line
//   (same "POST raw bulk text" shape as scrape-muslimsinbritain.js's CSV
//   import, not a JSON API body — matches this codebase's convention).
//   Fetches each URL, regex-scans the HTML for a masjidal widget embed,
//   upserts the found ID as a pending row. A URL with no embed found is
//   silently skipped (not an error — most mosque sites won't have one).
//
// mode=times&limit=N&retry=0|1 — same shape as every other scraper's
//   times fetch: pulls pending (+failed if retry=1) rows, calls the
//   per-mosque endpoint, 200ms spacing (5 req/sec, gentle on an
//   unverified-at-scale source same as Takbeer Time).

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';

const SOURCE = 'masjidal';
const API_BASE = 'https://masjidal.com/api/v1/time/range';
const WIDGET_RE = /masjidal\.com\/widget\/[^"'\s]*[?&]masjid_id=([A-Za-z0-9]{8})/g;

const DISCOVER_URL_BUDGET = 30; // stay well under Cloudflare's subrequest cap per call
const TIMES_BUDGET = 30;
const TIMES_DELAY_MS = 200; // 5 req/sec

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* -------------------------------------------------------------- discover */

async function discover(env, rawText) {
  const urls = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, DISCOVER_URL_BUDGET);

  if (!urls.length) {
    return json({ error: 'No URLs found in the pasted list.' }, 400);
  }

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO source_discoveries
      (source, source_ref, name, country, times_status, coverage, status,
       first_seen, last_seen, raw_json)
    VALUES (?, ?, NULL, NULL, 'pending', 'current', 'new', ?, ?, ?)
    ON CONFLICT(source, source_ref) DO UPDATE SET
      last_seen=excluded.last_seen
  `;

  const found = []; // { id, fromUrl }
  const skipped = [];
  const errors = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'WhereWePraying/1.0 (+wherewepraying.com)' } });
      if (!res.ok) { skipped.push(url); continue; }
      const html = await res.text();
      const ids = new Set();
      let m;
      WIDGET_RE.lastIndex = 0;
      while ((m = WIDGET_RE.exec(html))) ids.add(m[1]);
      if (!ids.size) { skipped.push(url); continue; }
      ids.forEach((id) => found.push({ id, fromUrl: url }));
    } catch (e) {
      errors.push({ url, error: String(e).slice(0, 200) });
    }
  }

  const statements = found.map((f) =>
    env.DB.prepare(sql).bind(SOURCE, f.id, now, now, JSON.stringify({ foundOnUrl: f.fromUrl }))
  );
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  return json({
    ok: true,
    urlsChecked: urls.length,
    rowsSaved: found.length,
    skipped: skipped.length,
    errors,
  });
}

/* ------------------------------------------------------------------ times */

// "5:00AM" / "1:16PM" / "1:25 PM" (jummah has an inconsistent leading space) -> "HH:MM" 24h.
// Returns null for anything that isn't a real time (e.g. Masjidal's "-" for an unused jummah2 slot).
function parseMasjidalTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return String(h).padStart(2, '0') + ':' + min;
}

async function fetchOneTimes(env, ref) {
  const url = `${API_BASE}?masjid_id=${encodeURIComponent(ref)}`;
  const now = new Date().toISOString();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'WhereWePraying/1.0 (+wherewepraying.com)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();

    if (body.status !== 'success') {
      // Confirmed to reach the API for this ID, but it reported an error —
      // treat as no_data (mosque ID resolves, no schedule), not a hard failure,
      // same split Takbeer Time uses for effectiveTimings: null.
      await env.DB.prepare(
        `UPDATE source_discoveries SET times_status='no_data', error=?, raw_json=?, times_updated_at=?, last_seen=?
          WHERE source=? AND source_ref=?`
      ).bind(
        (Array.isArray(body.message) ? body.message.join('; ') : String(body.message || '')).slice(0, 300) || null,
        JSON.stringify(body), now, now, SOURCE, ref
      ).run();
      return 'no_data';
    }

    const salah = (body.data && body.data.salah && body.data.salah[0]) || null;
    const iqamah = (body.data && body.data.iqamah && body.data.iqamah[0]) || null;

    if (!salah && !iqamah) {
      await env.DB.prepare(
        `UPDATE source_discoveries SET times_status='no_data', error=NULL, raw_json=?, times_updated_at=?, last_seen=?
          WHERE source=? AND source_ref=?`
      ).bind(JSON.stringify(body), now, now, SOURCE, ref).run();
      return 'no_data';
    }

    const jumua = iqamah ? parseMasjidalTime(iqamah.jummah1) : null;
    const jumua2 = iqamah ? parseMasjidalTime(iqamah.jummah2) : null;

    await env.DB.prepare(
      `UPDATE source_discoveries
          SET times_status='ok', error=NULL,
              jumua=?, jumua2=?, iqama_enabled=?,
              calendar_json=?, raw_json=?,
              times_updated_at=?, last_seen=?
        WHERE source=? AND source_ref=?`
    ).bind(
      jumua, jumua2, iqamah ? 1 : 0,
      JSON.stringify({ salah, iqamah }), JSON.stringify(body),
      now, now, SOURCE, ref
    ).run();

    return 'ok';
  } catch (e) {
    await env.DB.prepare(
      `UPDATE source_discoveries SET times_status='failed', error=?, last_seen=?
        WHERE source=? AND source_ref=?`
    ).bind(String(e).slice(0, 300), now, SOURCE, ref).run();
    return 'failed';
  }
}

async function times(env, limit, retry) {
  const wanted = retry ? "('pending','failed')" : "('pending')";
  const rows = (await env.DB.prepare(
    `SELECT source_ref FROM source_discoveries
      WHERE source = ? AND times_status IN ${wanted}
      ORDER BY CASE WHEN times_status = 'pending' THEN 0 ELSE 1 END, first_seen ASC
      LIMIT ?`
  ).bind(SOURCE, Math.min(limit, TIMES_BUDGET)).all()).results || [];

  if (!rows.length) return json({ ok: true, attempted: 0, message: 'Nothing pending.' });

  let succeeded = 0, failed = 0, noData = 0;
  for (const r of rows) {
    const result = await fetchOneTimes(env, r.source_ref);
    if (result === 'ok') succeeded++;
    else if (result === 'no_data') noData++;
    else failed++;
    await new Promise((res) => setTimeout(res, TIMES_DELAY_MS));
  }

  return json({ ok: true, attempted: rows.length, succeeded, failed, noData });
}

/* --------------------------------------------------------------- entry */

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAdminRequest(context) && !isSyncRequest(context)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const p = new URL(request.url).searchParams;
  const mode = p.get('mode');

  try {
    if (mode === 'times') return await times(env, parseInt(p.get('limit') || '10', 10) || 10, p.get('retry') === '1');
    return json({ error: 'unknown mode for GET, use mode=times (discovery is mode=discover via POST)' }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAdminRequest(context) && !isSyncRequest(context)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const p = new URL(request.url).searchParams;
  const mode = p.get('mode');
  if (mode !== 'discover') {
    return json({ error: 'unknown mode for POST, use mode=discover' }, 400);
  }

  try {
    const text = await request.text();
    return await discover(env, text);
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
}

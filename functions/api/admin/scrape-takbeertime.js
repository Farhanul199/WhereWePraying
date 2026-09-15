// functions/api/admin/scrape-takbeertime.js
//
// Takbeer Time (takbeertime.com) - a crowdsourced, open, no-auth mosque API.
// Verified directly against the live API (not just documentation) before
// building this: the list endpoint returns location + metadata ONLY, no
// prayer times. Times live behind a separate per-mosque detail endpoint.
//
// IMPORTANT - data quality varies a lot, since this is community-submitted:
// some entries are solid (named, addressed, verified), others are noise
// (bare numbers as names, "city":"Unknown", no address). Nothing here is
// filtered out - everything lands in the holding pen as usual, quality
// review happens at promotion time, same as every other source.
//
// IMPORTANT - country parameter quirk: the API wants a full country name
// ("Pakistan"), not an ISO code. The admin UI always sends an uppercased
// 2-letter code (matching every other source), so this file translates
// that code to the name Takbeer Time expects. Only the 19 countries
// confirmed as covered are mapped; anything else is rejected with a
// clear error rather than silently sending a wrong value.
//
// Endpoints (both need X-Sync-Key or X-Broadcast-Key, same as every
// other scraper in this codebase):
//   mode=discover&country=PK   - one country, all pages, location only
//   mode=times&limit=N         - fetch per-mosque detail for N pending rows

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';

const SOURCE = 'takbeertime';
const API_BASE = 'https://takbeertime.com/api/mosques';

// ISO 3166-1 alpha-2 -> the exact country name string Takbeer Time expects.
// Only countries confirmed covered by the source doc are listed here -
// this list came from an AI-generated research doc that got other details
// wrong (invented an entire prayer-times-in-the-list-response schema that
// doesn't exist), so treat this set as a starting point, not gospel. If a
// country you expect coverage for isn't here, it was left out deliberately
// rather than guessed.
const COUNTRY_NAMES = {
  DZ: 'Algeria',
  AZ: 'Azerbaijan',
  BD: 'Bangladesh',
  CM: 'Cameroon',
  EG: 'Egypt',
  IN: 'India',
  ID: 'Indonesia',
  IR: 'Iran',
  LR: 'Liberia',
  LT: 'Lithuania',
  MU: 'Mauritius',
  PK: 'Pakistan',
  RU: 'Russia',
  SA: 'Saudi Arabia',
  ZA: 'South Africa',
  KR: 'South Korea',
  TN: 'Tunisia',
  TR: 'Turkey',
  UZ: 'Uzbekistan',
};

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_CALL = 45; // stay well under Cloudflare's 50-subrequest cap
const TIMES_CONCURRENCY = 3;   // deliberately gentle - unverified-at-scale source
const TIMES_BUDGET = 30;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* -------------------------------------------------------------- discover */

async function discover(env, iso2) {
  const countryName = COUNTRY_NAMES[iso2];
  if (!countryName) {
    return json({
      error: `Unknown or unsupported country code "${iso2}". Supported: ${Object.keys(COUNTRY_NAMES).join(', ')}`,
    }, 400);
  }

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO source_discoveries
      (source, source_ref, name, country, city, address, lat, lon,
       times_status, coverage, status, first_seen, last_seen, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?,
            'pending', 'current', 'new', ?, ?, ?)
    ON CONFLICT(source, source_ref) DO UPDATE SET
      name=excluded.name,
      city=excluded.city,
      address=excluded.address,
      lat=excluded.lat,
      lon=excluded.lon,
      last_seen=excluded.last_seen,
      raw_json=excluded.raw_json
  `;

  let page = 1, rowsSaved = 0, hasMore = true, pagesFetched = 0;

  while (hasMore && pagesFetched < MAX_PAGES_PER_CALL) {
    const url = `${API_BASE}?country=${encodeURIComponent(countryName)}&page=${page}&limit=${PAGE_LIMIT}`;
    let res, body;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'WhereWePraying/1.0 (+wherewepraying.com)' } });
      body = await res.json();
    } catch (e) {
      return json({ error: `Fetch failed on page ${page}: ${String(e).slice(0, 200)}`, rowsSaved }, 502);
    }
    if (!res.ok) {
      return json({ error: `Takbeer Time returned ${res.status} on page ${page}`, rowsSaved }, 502);
    }

    const rows = (body.data || []);
    const statements = rows.map((m) =>
      env.DB.prepare(sql).bind(
        SOURCE, m.id, m.name || null, iso2,
        (m.city && m.city !== 'Unknown') ? m.city : null,
        m.addressLine1 || null, m.latitude ?? null, m.longitude ?? null,
        now, now, JSON.stringify(m)
      )
    );
    // Batched in chunks of 50 per D1 call, matching the rest of this codebase.
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50));
    }
    rowsSaved += rows.length;

    hasMore = !!(body.pagination && body.pagination.hasMore);
    page++;
    pagesFetched++;
  }

  return json({
    ok: true,
    rowsSaved,
    country: countryName,
    pagesFetched,
    stillMorePages: hasMore, // if MAX_PAGES_PER_CALL was hit mid-country, call discover again for this code to continue
  });
}

/* ------------------------------------------------------------ times */

async function fetchOneTimes(env, ref) {
  const url = `${API_BASE}/${ref}`;
  const now = new Date().toISOString();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'WhereWePraying/1.0 (+wherewepraying.com)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();

    const t = detail.effectiveTimings;
    const hasFullTimes = t && t.fajr && t.dhuhr && t.asr && t.maghrib && t.isha;

    if (!hasFullTimes) {
      // Not a failure - we successfully reached a real mosque record
      // (confirmed to exist, has a location), it just has no community-
      // submitted schedule yet (prayerSchedules: [], effectiveTimings:
      // null). Common on this source outside its more active countries.
      // Still worth refreshing location details from the detail response,
      // and the mosque stays visible on the live site with a "no live
      // prayer data" note rather than being hidden or flagged as broken.
      await env.DB.prepare(
        `UPDATE source_discoveries
            SET times_status='no_data', error=NULL,
                site=COALESCE(?, site),
                phone=COALESCE(?, phone),
                email=COALESCE(?, email),
                raw_json=?, times_updated_at=?, last_seen=?
          WHERE source=? AND source_ref=?`
      ).bind(
        detail.website || null, detail.phoneNumber || null, detail.email || null,
        JSON.stringify(detail), now, now, SOURCE, ref
      ).run();
      return 'no_data';
    }

    const jummah = Array.isArray(t.jummah) ? t.jummah : [];
    // effectiveKeeperIsVerifiedSchedule is the closest signal Takbeer Time
    // gives to "a mosque/community actually confirmed this", as opposed to
    // an unverified single submission - used here as the iqama_enabled
    // proxy, same spirit as the other sources' quality flag.
    const verified = detail.effectiveKeeperIsVerifiedSchedule === true;

    await env.DB.prepare(
      `UPDATE source_discoveries
          SET times_status='ok', error=NULL,
              site=COALESCE(?, site),
              phone=COALESCE(?, phone),
              email=COALESCE(?, email),
              jumua=?, jumua2=?, iqama_enabled=?,
              calendar_json=?, raw_json=?,
              times_updated_at=?, last_seen=?
        WHERE source=? AND source_ref=?`
    ).bind(
      detail.website || null, detail.phoneNumber || null, detail.email || null,
      jummah[0] || null, jummah[1] || null, verified ? 1 : 0,
      JSON.stringify(t), JSON.stringify(detail),
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
  for (let i = 0; i < rows.length; i += TIMES_CONCURRENCY) {
    const batch = rows.slice(i, i + TIMES_CONCURRENCY);
    const results = await Promise.all(batch.map((r) => fetchOneTimes(env, r.source_ref)));
    results.forEach((r) => {
      if (r === 'ok') succeeded++;
      else if (r === 'no_data') noData++;
      else failed++;
    });
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
    if (mode === 'discover') return await discover(env, (p.get('country') || '').toUpperCase());
    if (mode === 'times') return await times(env, parseInt(p.get('limit') || '10', 10) || 10, p.get('retry') === '1');
    return json({ error: 'unknown mode, use mode=discover or mode=times' }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
}

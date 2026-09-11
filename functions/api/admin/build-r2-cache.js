// functions/api/admin/build-r2-cache.js
//
// Reads ALL active mosques + today's & tomorrow's Jama'ah times from D1,
// writes one JSON file to R2. Designed to run 2x/day via a cron Worker.
//
// This is the "write" half of the R2 caching system. The "read" half is
// plan.js, which reads this file from R2 instead of querying D1 live.
// Together they remove D1 and KV from the visitor request path entirely.
//
// The output file key is `mosques/{date}.json` where date is today in
// London time (e.g. `mosques/2026-09-12.json`). plan.js looks up the
// same key. Edge cache on the reader side means R2 itself is hit rarely.
//
// R2 free tier: 1M writes/month, 10M reads/month. This job writes 1-2
// files/day = ~60/month. Visitors read via edge cache, so R2 reads are
// also minimal.
//
// USAGE:
//   curl "https://wherewepraying.com/api/admin/build-r2-cache" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"

import { isSyncRequest } from '../../_lib/auth.js';

function londonDateIso() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(dateIso, days) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const ALL_MOSQUES_QUERY = `
  SELECT m.slug, m.name, m.address, m.latitude, m.longitude,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         tmr.fajr_jamaah AS tomorrow_fajr
  FROM mosques m
  LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
  LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?
  WHERE m.active = 1 AND m.type = 'mosque'
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
`;

export async function onRequestGet(context) {
  const { env } = context;

  if (!isSyncRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.CACHE_BUCKET) {
    return new Response(JSON.stringify({ error: "CACHE_BUCKET (R2) not bound" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const dateIso = londonDateIso();
  const tomorrowIso = addDaysIso(dateIso, 1);

  let rows;
  try {
    const result = await env.DB.prepare(ALL_MOSQUES_QUERY)
      .bind(dateIso, tomorrowIso)
      .all();
    rows = result.results || [];
  } catch (e) {
    return new Response(JSON.stringify({ error: "D1 query failed", detail: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const mosques = rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    address: row.address || null,
    latitude: row.latitude,
    longitude: row.longitude,
    fajr_jamaah: row.fajr_jamaah || null,
    zuhr_jamaah: row.zuhr_jamaah || null,
    asr_jamaah: row.asr_jamaah || null,
    maghrib_jamaah: row.maghrib_jamaah || null,
    isha_jamaah: row.isha_jamaah || null,
    tomorrow_fajr: row.tomorrow_fajr || null,
  }));

  const payload = JSON.stringify({ date: dateIso, generatedAt: new Date().toISOString(), mosques });
  const r2Key = `mosques/${dateIso}.json`;

  try {
    await env.CACHE_BUCKET.put(r2Key, payload, {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "R2 write failed", detail: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Also write tomorrow's file if it doesn't exist yet (pre-warm for
  // the midnight rollover so the first visitor after midnight doesn't
  // miss). Tomorrow's data may be incomplete but it's better than nothing.
  const tomorrowKey = `mosques/${tomorrowIso}.json`;
  try {
    const exists = await env.CACHE_BUCKET.head(tomorrowKey);
    if (!exists) {
      // Requery with tomorrow as "today" and day-after as "tomorrow"
      const dayAfterIso = addDaysIso(dateIso, 2);
      const tmrResult = await env.DB.prepare(ALL_MOSQUES_QUERY)
        .bind(tomorrowIso, dayAfterIso)
        .all();
      const tmrMosques = (tmrResult.results || []).map((row) => ({
        slug: row.slug,
        name: row.name,
        address: row.address || null,
        latitude: row.latitude,
        longitude: row.longitude,
        fajr_jamaah: row.fajr_jamaah || null,
        zuhr_jamaah: row.zuhr_jamaah || null,
        asr_jamaah: row.asr_jamaah || null,
        maghrib_jamaah: row.maghrib_jamaah || null,
        isha_jamaah: row.isha_jamaah || null,
        tomorrow_fajr: row.tomorrow_fajr || null,
      }));
      const tmrPayload = JSON.stringify({ date: tomorrowIso, generatedAt: new Date().toISOString(), mosques: tmrMosques });
      await env.CACHE_BUCKET.put(tomorrowKey, tmrPayload, {
        httpMetadata: { contentType: "application/json" },
      });
    }
  } catch (e) {
    // Non-critical — tomorrow will get built on its own run anyway.
    console.error("tomorrow pre-warm failed (non-critical)", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    date: dateIso,
    r2Key,
    mosquesCount: mosques.length,
  }), { headers: { "Content-Type": "application/json" } });
}

// functions/api/mosques/nearby.js
//
// "Find a Mosque" nearby endpoint. Given the visitor's lat/lon, returns
// up to 8 of their closest active mosques within 15 miles (falls back
// to a wider search if fewer than 3 are found that close — see below).
// Built to replace pulling the WHOLE mosques table on every visit
// (functions/api/mosques/list.js does that; this is the D1/KV-light
// alternative for the default "near me" view).
//
// COST-SAVING DESIGN — read this before changing the radius/limit:
//
// 1. GRID-BUCKETED CACHE, NOT PER-EXACT-COORDINATE: the visitor's
//    lat/lon is rounded to a ~0.1 degree grid cell (~6-7 miles) to
//    build the cache key. Two people half a mile apart share the same
//    cached candidate list instead of each triggering their own D1
//    query. Both Cloudflare's free edge cache AND the shared RATE_LIMIT
//    KV store (reused, no new namespace needed) are keyed this way.
// 2. THE CACHED CANDIDATE LIST IS WIDER THAN THE ANSWER: each cache
//    entry holds every mosque within ~22 miles of the GRID CELL'S
//    CENTER (enough to safely cover the real 15-mile answer for anyone
//    standing anywhere inside that cell). The exact per-visitor
//    filtering (their real lat/lon, real distance, top 8, min 3) then
//    happens AFTER the cache read, in the Worker's memory — zero extra
//    D1 or KV cost per visitor, only on the first visitor per grid
//    cell per 10 minutes.
// 3. BOUNDING BOX BEFORE HAVERSINE: the D1 query itself filters by a
//    plain lat/lon range (cheap, uses the columns directly) rather
//    than reading the whole table — only rows in the rough box are
//    read from D1 at all.
// 4. RARE FALLBACK: if fewer than 3 mosques exist even within that
//    ~22-mile candidate set (very sparse areas — e.g. rural
//    Highlands), ONE extra uncached nationwide query runs to
//    guarantee the 3-mosque minimum. This is intentionally NOT
//    cached/bucketed — it should be rare by definition (most of the
//    UK has 3+ mosques within 25 miles), so it's not worth the extra
//    complexity of caching a second tier.

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const RESULT_LIMIT = 8;
const MIN_RESULTS = 3;
const SEARCH_RADIUS_MILES = 15;
const CANDIDATE_BOX_MILES = 22; // must cover SEARCH_RADIUS_MILES + grid-cell-center drift
const GRID_SIZE_DEG = 0.1; // ~6-7 miles — cache bucket granularity
const CACHE_TTL_SECONDS = 600; // 10 min, matches list.js/jummah.js

function londonNowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10),
  };
}

function parseTimeToMinutes(prayer, raw) {
  if (!raw) return null;
  const cleaned = raw.replace(".", ":").trim();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (prayer !== "fajr" && h >= 1 && h <= 11) h += 12;
  return h * 60 + min;
}

// Same placeholder-value cleanup as list.js — see that file for the
// full explanation. Kept identical so the two endpoints never disagree
// about which mosque data is real vs. placeholder junk.
function clearPlaceholders(jamaah) {
  const valueCounts = new Map();
  for (const p of PRAYER_ORDER) {
    const v = jamaah[p];
    if (v) valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }
  const placeholderValues = new Set(
    [...valueCounts.entries()].filter(([, count]) => count >= 4).map(([value]) => value)
  );
  if (placeholderValues.size) {
    for (const p of PRAYER_ORDER) {
      if (placeholderValues.has(jamaah[p])) jamaah[p] = null;
    }
  }
}

function milesToLatDegrees(miles) {
  return miles / 69; // ~69 miles per degree of latitude, everywhere
}
function milesToLonDegrees(miles, atLat) {
  const rad = (atLat * Math.PI) / 180;
  const milesPerDegree = 69 * Math.cos(rad);
  return milesPerDegree > 0.1 ? miles / milesPerDegree : miles / 0.1; // guard near the poles (never hit in the UK, just a safety floor)
}

// Haversine great-circle distance in miles.
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function buildRow(row, dateIso, isToday, nowMinutes) {
  const jamaah = {
    fajr: row.fajr_jamaah || null,
    zuhr: row.zuhr_jamaah || null,
    asr: row.asr_jamaah || null,
    maghrib: row.maghrib_jamaah || null,
    isha: row.isha_jamaah || null,
  };
  clearPlaceholders(jamaah);
  const photoUrl = row.photo_key ? `/api/community/photo/${row.photo_key}` : null;
  let next = null;
  if (isToday) {
    for (const prayer of PRAYER_ORDER) {
      const mins = parseTimeToMinutes(prayer, jamaah[prayer]);
      if (mins !== null && mins >= nowMinutes) {
        next = { prayer, time: jamaah[prayer], minutesUntil: mins - nowMinutes };
        break;
      }
    }
  }
  return {
    slug: row.slug, name: row.name, address: row.address || null,
    postcode: row.postcode || null, latitude: row.latitude ?? null,
    longitude: row.longitude ?? null, region: row.region || "Other",
    jamaah, next, photoUrl,
  };
}

const BOX_QUERY = `
  SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         ph.r2_key AS photo_key
  FROM mosques m
  LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
  LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
  WHERE m.active = 1 AND m.type = 'mosque'
    AND m.latitude BETWEEN ? AND ?
    AND m.longitude BETWEEN ? AND ?
`;

const NATIONWIDE_FALLBACK_QUERY = `
  SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         ph.r2_key AS photo_key
  FROM mosques m
  LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
  LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
  WHERE m.active = 1 AND m.type = 'mosque'
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  // Sanity-bound the input before it touches anything — radius and
  // result limit are fixed constants above (never read from the
  // query string), so the only untrusted input here is lat/lon. A
  // garbage or out-of-range value would otherwise sail through to the
  // D1 query / distance math instead of failing fast and free.
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  if (!validLat || !validLon) {
    return new Response(JSON.stringify({ error: "lat and lon must be valid coordinates" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const requestedDate = url.searchParams.get("date");
  const { dateIso: todayIso, minutes: nowMinutes } = londonNowParts();
  const dateIso = requestedDate || todayIso;
  const isToday = dateIso === todayIso;

  // Grid-bucket the cache key (see file header) — NOT the raw lat/lon.
  const gridLat = Math.round(lat / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gridLon = Math.round(lon / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gridKey = `${gridLat.toFixed(2)},${gridLon.toFixed(2)}`;

  const cache = caches.default;
  const cacheKeyRequest = new Request(
    `https://cache-key.internal/mosques/nearby-candidates?grid=${gridKey}&date=${dateIso}`
  );
  const kvKey = `mq_nearby_v1:${gridKey}:${dateIso}`;

  let candidates = null;

  // 1. Free edge cache (this Cloudflare location only).
  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) {
    candidates = await edgeHit.json();
  }

  // 2. Shared KV cache (every Cloudflare location, worldwide).
  if (!candidates && env.RATE_LIMIT) {
    const kvHit = await env.RATE_LIMIT.get(kvKey);
    if (kvHit) candidates = JSON.parse(kvHit);
  }

  // 3. Cache miss on both — hit D1, but only the rough box, not the
  // whole table.
  if (!candidates) {
    try {
      const latDelta = milesToLatDegrees(CANDIDATE_BOX_MILES);
      const lonDelta = milesToLonDegrees(CANDIDATE_BOX_MILES, gridLat);
      const { results } = await env.DB.prepare(BOX_QUERY)
        .bind(dateIso, gridLat - latDelta, gridLat + latDelta, gridLon - lonDelta, gridLon + lonDelta)
        .all();
      candidates = (results || []).map((row) => buildRow(row, dateIso, isToday, nowMinutes));
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to load nearby mosques", detail: String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = JSON.stringify(candidates);
    const cacheResponse = new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
    });
    context.waitUntil(cache.put(cacheKeyRequest, cacheResponse.clone()));
    if (env.RATE_LIMIT) {
      context.waitUntil(env.RATE_LIMIT.put(kvKey, body, { expirationTtl: CACHE_TTL_SECONDS }));
    }
  }

  // 4. Filter/sort against the VISITOR'S real coordinates (not the grid
  // center) — this part costs no D1/KV at all, just in-memory JS.
  const withDistance = candidates
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({ ...m, distanceMiles: distanceMiles(lat, lon, m.latitude, m.longitude) }));
  withDistance.sort((a, b) => a.distanceMiles - b.distanceMiles);

  let nearby = withDistance.filter((m) => m.distanceMiles <= SEARCH_RADIUS_MILES).slice(0, RESULT_LIMIT);
  let expanded = false;

  // 5. Fewer than the minimum within 15mi — widen within what we
  // already have cached (no extra D1/KV cost) up to the candidate box
  // edge first.
  if (nearby.length < MIN_RESULTS && withDistance.length >= MIN_RESULTS) {
    nearby = withDistance.slice(0, RESULT_LIMIT);
    expanded = true;
  }

  // 6. Still short (sparse area, even the ~22-mile box didn't have 3
  // mosques) — one uncached nationwide query. Rare by definition.
  if (nearby.length < MIN_RESULTS) {
    try {
      const { results } = await env.DB.prepare(NATIONWIDE_FALLBACK_QUERY).bind(dateIso).all();
      const all = (results || [])
        .map((row) => buildRow(row, dateIso, isToday, nowMinutes))
        .filter((m) => m.latitude != null && m.longitude != null)
        .map((m) => ({ ...m, distanceMiles: distanceMiles(lat, lon, m.latitude, m.longitude) }));
      all.sort((a, b) => a.distanceMiles - b.distanceMiles);
      nearby = all.slice(0, RESULT_LIMIT);
      expanded = true;
    } catch (e) {
      // Keep whatever we already had rather than failing the whole request.
    }
  }

  nearby = nearby.map((m) => ({ ...m, distanceMiles: Math.round(m.distanceMiles * 10) / 10 }));

  return new Response(
    JSON.stringify({ date: dateIso, isToday, mosques: nearby, radiusMiles: SEARCH_RADIUS_MILES, expanded }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

// functions/api/mosques/plan.js
//
// "Find a Mosque" plan endpoint — given the visitor's lat/lon, works
// out ONE primary mosque (the closest one they can still reach before
// Jama'ah) plus up to TWO backup mosques with later Jama'ah times, in
// case they miss the primary. Not a browsable list — three cards, done.
//
// COST DESIGN — R2 + edge cache, zero D1 / zero KV on the visitor path:
//
//   1. A cron Worker calls build-r2-cache.js twice daily. That job
//      reads ALL mosques + times from D1 once, writes one JSON file
//      to R2 keyed by date: `mosques/2026-09-12.json`.
//   2. This endpoint reads that file from R2 on first request of the
//      day (or on edge-cache miss), then caches it at the Cloudflare
//      edge for hours. Subsequent visitors get the edge-cached copy —
//      no R2 hit, no D1 hit, no KV hit.
//   3. Bounding-box filtering and "next prayer" feasibility are
//      computed in-memory per request from the cached data — free JS,
//      no quota cost.
//
//   Result: D1 is only touched by the cron (twice/day), never by
//   visitors. KV is not used at all. R2 is hit at most once per edge
//   PoP per cache window. This scales to millions of visitors.
//
// Travel time is ESTIMATED, not routed (no Google Maps/routing API —
// costs money and this is a free-tier project). Straight-line distance
// with a route-indirectness multiplier and a flat speed per mode.
// Good enough for "can I make it", not turn-by-turn directions.

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const CANDIDATE_BOX_MILES = 22;
const R2_EDGE_CACHE_SECONDS = 14400; // 4 hours — R2 file only changes twice/day anyway

const WALK_MAX_MILES = 0.6;     // below this distance, assume walking
const WALK_SPEED_MPH = 3;
const DRIVE_SPEED_MPH = 15;     // conservative — accounts for city traffic/parking, not motorway speed
const ROUTE_FACTOR = 1.25;      // real roads/paths aren't a straight line
const SAFETY_BUFFER_MIN = 5;    // arrive-by buffer, not arrive-exactly-on-time

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

// Same placeholder-value cleanup as before.
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

function milesToLatDegrees(miles) { return miles / 69; }
function milesToLonDegrees(miles, atLat) {
  const rad = (atLat * Math.PI) / 180;
  const milesPerDegree = 69 * Math.cos(rad);
  return milesPerDegree > 0.1 ? miles / milesPerDegree : miles / 0.1;
}
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function travelEstimate(miles) {
  const mode = miles <= WALK_MAX_MILES ? "walk" : "drive";
  const speed = mode === "walk" ? WALK_SPEED_MPH : DRIVE_SPEED_MPH;
  const minutes = Math.max(1, Math.ceil((miles * ROUTE_FACTOR) / speed * 60));
  return { mode, minutes };
}

function rowToCandidate(row) {
  const jamaah = {
    fajr: row.fajr_jamaah || null, zuhr: row.zuhr_jamaah || null, asr: row.asr_jamaah || null,
    maghrib: row.maghrib_jamaah || null, isha: row.isha_jamaah || null,
  };
  clearPlaceholders(jamaah);
  return {
    slug: row.slug, name: row.name, address: row.address || null,
    latitude: row.latitude, longitude: row.longitude, jamaah,
    tomorrowFajr: row.tomorrow_fajr || null,
  };
}

function nextPrayerFor(candidate, nowMinutes) {
  for (const prayer of PRAYER_ORDER) {
    const mins = parseTimeToMinutes(prayer, candidate.jamaah[prayer]);
    if (mins !== null && mins >= nowMinutes) {
      return { prayer, time: candidate.jamaah[prayer], minutesUntil: mins - nowMinutes, isTomorrow: false };
    }
  }
  const tomorrowMins = parseTimeToMinutes("fajr", candidate.tomorrowFajr);
  if (tomorrowMins !== null) {
    return {
      prayer: "fajr", time: candidate.tomorrowFajr,
      minutesUntil: (1440 - nowMinutes) + tomorrowMins, isTomorrow: true,
    };
  }
  return null;
}

function buildPlanEntry(candidate, dist, next, travel) {
  return {
    slug: candidate.slug, name: candidate.name, address: candidate.address,
    distanceMiles: Math.round(dist * 10) / 10,
    travelMode: travel.mode, travelMinutes: travel.minutes,
    prayer: next.prayer, time: next.time, jamaahInMinutes: next.minutesUntil,
    isTomorrow: next.isTomorrow,
  };
}

function computeFeasible(candidates, lat, lon, nowMinutes) {
  const feasible = [];
  for (const c of candidates) {
    if (c.latitude == null || c.longitude == null) continue;
    const next = nextPrayerFor(c, nowMinutes);
    if (!next) continue;
    const dist = distanceMiles(lat, lon, c.latitude, c.longitude);
    const travel = travelEstimate(dist);
    if (next.minutesUntil - travel.minutes - SAFETY_BUFFER_MIN < 0) continue;
    feasible.push(buildPlanEntry(c, dist, next, travel));
  }
  feasible.sort((a, b) => a.jamaahInMinutes - b.jamaahInMinutes);
  return feasible;
}

function pickPrimaryAndBackups(feasible) {
  if (!feasible.length) return { primary: null, backups: [] };
  const primary = feasible[0];
  const rest = feasible.slice(1);
  const later = rest.filter((m) => m.jamaahInMinutes > primary.jamaahInMinutes);
  const backups = later.slice(0, 2);
  if (backups.length < 2) {
    for (const m of rest) {
      if (backups.length >= 2) break;
      if (!backups.includes(m)) backups.push(m);
    }
  }
  return { primary, backups };
}

// ---------- R2 data loader with edge cache ----------

async function loadMosquesFromR2(env, dateIso, ctx) {
  const r2Key = `mosques/${dateIso}.json`;

  // 1. Check Cloudflare edge cache first (free, uncounted)
  const cache = caches.default;
  const cacheUrl = new Request(`https://cache-key.internal/r2-mosques/${dateIso}`);
  const edgeHit = await cache.match(cacheUrl);
  if (edgeHit) {
    const data = await edgeHit.json();
    return data.mosques || [];
  }

  // 2. Edge miss — read from R2
  if (!env.CACHE_BUCKET) return null;

  const r2Object = await env.CACHE_BUCKET.get(r2Key);
  if (!r2Object) return null;

  const body = await r2Object.text();

  // 3. Put into edge cache for next visitors
  const cacheResponse = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${R2_EDGE_CACHE_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(cacheUrl, cacheResponse));

  const data = JSON.parse(body);
  return data.mosques || [];
}

// ---------- Main handler ----------

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  if (!validLat || !validLon) {
    return new Response(JSON.stringify({ error: "lat and lon must be valid coordinates" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { dateIso, minutes: nowMinutes } = londonNowParts();

  // --- Load all mosques from R2 (edge-cached), fall back to D1 ---
  let allMosques = await loadMosquesFromR2(env, dateIso, context);
  let source = "r2";

  // Fallback: if R2 file doesn't exist yet (first deploy, cron hasn't
  // run, or R2 not bound), query D1 directly so the site doesn't break.
  if (!allMosques) {
    source = "d1_fallback";
    try {
      const tomorrowIso = new Date(Date.UTC(
        ...dateIso.split("-").map((v, i) => i === 1 ? Number(v) - 1 : Number(v))
      ));
      tomorrowIso.setUTCDate(tomorrowIso.getUTCDate() + 1);
      const tmrStr = tomorrowIso.toISOString().slice(0, 10);

      const { results } = await env.DB.prepare(`
        SELECT m.slug, m.name, m.address, m.latitude, m.longitude,
               t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
               tmr.fajr_jamaah AS tomorrow_fajr
        FROM mosques m
        LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
        LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?
        WHERE m.active = 1 AND m.type = 'mosque'
          AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
      `).bind(dateIso, tmrStr).all();
      allMosques = results || [];
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to load mosque data", detail: String(e) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // --- Filter to bounding box (in-memory, free) ---
  const latDelta = milesToLatDegrees(CANDIDATE_BOX_MILES);
  const lonDelta = milesToLonDegrees(CANDIDATE_BOX_MILES, lat);
  const minLat = lat - latDelta, maxLat = lat + latDelta;
  const minLon = lon - lonDelta, maxLon = lon + lonDelta;

  const candidates = [];
  for (const row of allMosques) {
    if (row.latitude >= minLat && row.latitude <= maxLat &&
        row.longitude >= minLon && row.longitude <= maxLon) {
      candidates.push(rowToCandidate(row));
    }
  }

  // --- Compute feasibility ---
  let feasible = computeFeasible(candidates, lat, lon, nowMinutes);

  // If local box didn't produce 3 results, try ALL mosques (already
  // loaded in memory — no extra D1/R2 hit needed).
  let expanded = false;
  if (feasible.length < 3) {
    const allCandidates = allMosques.map(rowToCandidate);
    const nationwide = computeFeasible(allCandidates, lat, lon, nowMinutes);
    if (nationwide.length > feasible.length) {
      feasible = nationwide;
      expanded = true;
    }
  }

  const { primary, backups } = pickPrimaryAndBackups(feasible);
  const note = !primary ? "No Jama'ah times found nearby — none of the nearby mosques have Fajr times on record yet." : null;

  return new Response(
    JSON.stringify({ date: dateIso, generatedAtMinutes: nowMinutes, primary, backups, expanded, note, source }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

// functions/api/mosques/plan.js
//
// "Find a Mosque" plan endpoint — the real product surface (see
// screenshots discussed in chat): given the visitor's lat/lon, works
// out ONE primary mosque (the closest one they can still reach before
// Jama'ah) plus up to TWO backup mosques with later Jama'ah times, in
// case they miss the primary. Not a browsable list — three cards, done.
//
// COST DESIGN (same pattern as nearby.js — read that file's header
// too if changing this one):
// - Grid-bucketed cache (~0.1 degree, ~6-7 miles): visitors in the
//   same rough area share one D1 hit every 10 minutes, not one each.
// - The CACHE stores raw Jama'ah time strings only, never a
//   precomputed "next prayer" — "next" depends on the current minute,
//   and baking it into a 10-minute cache would go stale. Feasibility
//   is recalculated fresh per request from the cached raw times —
//   free (plain JS), no extra D1/KV cost.
// - Bounding box before Haversine, same as nearby.js.
// - Rare nationwide fallback only if the whole ~22-mile candidate set
//   doesn't contain 3 mosques with any Jama'ah data at all.
//
// Travel time is ESTIMATED, not routed (no Google Maps/routing API —
// costs money and this is a free-tier project). Straight-line distance
// with a route-indirectness multiplier and a flat speed per mode.
// Good enough for "can I make it", not turn-by-turn directions.

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const CANDIDATE_BOX_MILES = 22;
const GRID_SIZE_DEG = 0.1;
const CACHE_TTL_SECONDS = 32400;

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

// Plain calendar-date arithmetic on a YYYY-MM-DD string — used to look
// up tomorrow's Fajr once today's prayers have all passed (e.g. after
// Isha). UTC anchoring is safe here since we only care about the
// calendar date, not a time-of-day.
function addDaysIso(dateIso, days) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
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

// Same placeholder-value cleanup as list.js/nearby.js.
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

// tmr (tomorrow's row) only contributes fajr_jamaah — that's the only
// field ever needed once today's own prayers have passed.
const BOX_QUERY = `
  SELECT m.slug, m.name, m.address, m.latitude, m.longitude,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         tmr.fajr_jamaah AS tomorrow_fajr
  FROM mosques m
  LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
  LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?
  WHERE m.active = 1 AND m.type = 'mosque'
    AND m.latitude BETWEEN ? AND ?
    AND m.longitude BETWEEN ? AND ?
`;

const NATIONWIDE_FALLBACK_QUERY = `
  SELECT m.slug, m.name, m.address, m.latitude, m.longitude,
         t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
         tmr.fajr_jamaah AS tomorrow_fajr
  FROM mosques m
  LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
  LEFT JOIN thm_jamaah_times tmr ON tmr.mosque = m.slug AND tmr.date = ?
  WHERE m.active = 1 AND m.type = 'mosque'
    AND m.latitude IS NOT NULL AND m.longitude IS NOT NULL
`;

function rowToCandidate(row) {
  const jamaah = {
    fajr: row.fajr_jamaah || null, zuhr: row.zuhr_jamaah || null, asr: row.asr_jamaah || null,
    maghrib: row.maghrib_jamaah || null, isha: row.isha_jamaah || null,
  };
  clearPlaceholders(jamaah);
  return {
    slug: row.slug, name: row.name, address: row.address || null,
    latitude: row.latitude ?? null, longitude: row.longitude ?? null, jamaah,
    tomorrowFajr: row.tomorrow_fajr || null,
  };
}

// Given a candidate (raw jamaah times) and the current minute-of-day,
// find today's next upcoming prayer for that mosque. Returns null if
// nothing left today.
function nextPrayerFor(candidate, nowMinutes) {
  for (const prayer of PRAYER_ORDER) {
    const mins = parseTimeToMinutes(prayer, candidate.jamaah[prayer]);
    if (mins !== null && mins >= nowMinutes) {
      return { prayer, time: candidate.jamaah[prayer], minutesUntil: mins - nowMinutes, isTomorrow: false };
    }
  }
  // Today's done (e.g. after Isha) — fall through to tomorrow's Fajr.
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

// Feasible = can physically get there (travel time + safety buffer)
// before Jama'ah starts.
function computeFeasible(candidates, lat, lon, nowMinutes) {
  const feasible = [];
  for (const c of candidates) {
    if (c.latitude == null || c.longitude == null) continue;
    const next = nextPrayerFor(c, nowMinutes);
    if (!next) continue;
    const dist = distanceMiles(lat, lon, c.latitude, c.longitude);
    const travel = travelEstimate(dist);
    if (next.minutesUntil - travel.minutes - SAFETY_BUFFER_MIN < 0) continue; // can't make it
    feasible.push(buildPlanEntry(c, dist, next, travel));
  }
  feasible.sort((a, b) => a.jamaahInMinutes - b.jamaahInMinutes);
  return feasible;
}

// Primary = soonest feasible mosque. Backups = next two with a
// genuinely LATER Jama'ah time (real fallbacks, not same-time ties).
// If fewer than two qualify that way, fill remaining slots from
// whatever's left so the visitor still gets options.
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

  const gridLat = Math.round(lat / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gridLon = Math.round(lon / GRID_SIZE_DEG) * GRID_SIZE_DEG;
  const gridKey = `${gridLat.toFixed(2)},${gridLon.toFixed(2)}`;

  const cache = caches.default;
  const cacheKeyRequest = new Request(
    `https://cache-key.internal/mosques/plan-candidates?grid=${gridKey}&date=${dateIso}`
  );
  const kvKey = `mq_plan_v1:${gridKey}:${dateIso}`;

  let candidates = null;

  const edgeHit = await cache.match(cacheKeyRequest);
  if (edgeHit) candidates = await edgeHit.json();

  if (!candidates && env.RATE_LIMIT) {
    const kvHit = await env.RATE_LIMIT.get(kvKey);
    if (kvHit) candidates = JSON.parse(kvHit);
  }

  if (!candidates) {
    try {
      const latDelta = milesToLatDegrees(CANDIDATE_BOX_MILES);
      const lonDelta = milesToLonDegrees(CANDIDATE_BOX_MILES, gridLat);
      const tomorrowIso = addDaysIso(dateIso, 1);
      const { results } = await env.DB.prepare(BOX_QUERY)
        .bind(dateIso, tomorrowIso, gridLat - latDelta, gridLat + latDelta, gridLon - lonDelta, gridLon + lonDelta)
        .all();
      candidates = (results || []).map(rowToCandidate);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Failed to load mosque plan", detail: String(e) }),
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

  let feasible = computeFeasible(candidates, lat, lon, nowMinutes);
  let expanded = false;

  // Rare: the whole ~22-mile candidate box didn't produce 3 feasible
  // options (very sparse area, or everything's already too far for
  // the little time left before the next prayer). One uncached
  // nationwide query, sorted properly, as a last resort.
  if (feasible.length < 3) {
    try {
      const { results } = await env.DB.prepare(NATIONWIDE_FALLBACK_QUERY).bind(dateIso, addDaysIso(dateIso, 1)).all();
      const all = (results || []).map(rowToCandidate);
      const nationwide = computeFeasible(all, lat, lon, nowMinutes);
      if (nationwide.length > feasible.length) {
        feasible = nationwide;
        expanded = true;
      }
    } catch (e) {
      // Keep whatever we already had rather than failing outright.
    }
  }

  const { primary, backups } = pickPrimaryAndBackups(feasible);
  const note = !primary ? "No Jama'ah times found nearby — none of the nearby mosques have Fajr times on record yet." : null;

  return new Response(
    JSON.stringify({ date: dateIso, generatedAtMinutes: nowMinutes, primary, backups, expanded, note }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

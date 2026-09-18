// functions/api/mosques/plan.js
//
// "Find a Mosque" plan endpoint — given the visitor's lat/lon, works
// out ONE primary mosque (the closest one they can still reach before
// Jama'ah) plus up to TWO backup mosques with later Jama'ah times, in
// case they miss the primary. Not a browsable list — three cards, done.
//
// COST DESIGN — read, don't copy (see _lib/area-times.js):
//
//   1. Each mosque keeps its OWN timetable (a full year from Mawaqit, a
//      rolling week from other sources). Nothing is expanded into daily
//      rows in advance.
//   2. The visitor's position is rounded to a ~7-mile area. The first
//      visitor in that area on a given day causes one small database
//      read — the mosques in that area, plus the current month's page of
//      each one's timetable — which is then cached at the Cloudflare
//      edge and in KV.
//   3. Everyone else in that area that day is served from cache: no
//      database, no storage read. Distance and "can I make it" maths
//      happen in memory, which is free.
//
//   Result: work happens once per populated area per day. Coverage can
//   grow to every country without changing any of these numbers, because
//   a visitor only ever loads their own area.
//
// Travel time is ESTIMATED, not routed (no Google Maps/routing API —
// costs money and this is a free-tier project). Straight-line distance
// with a route-indirectness multiplier and a flat speed per mode.
// Good enough for "can I make it", not turn-by-turn directions.
//
// PRIVACY: the frontend now sends coordinates as a POST body (see
// onRequestPost below) rather than a GET query string, so they don't
// land in access logs, browser history, or a Referer header. This
// endpoint never writes the visitor's location anywhere — it's read
// in memory for this one request, used to filter/sort, and discarded
// when the response is sent. onRequestGet is kept only for backward
// compatibility (e.g. direct testing) and shares the exact same logic.

import { loadArea } from "../../_lib/area-times.js";

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const CANDIDATE_BOX_MILES = 22;

const WALK_MAX_MILES = 0.6;     // below this distance, assume walking
const WALK_SPEED_MPH = 3;
const DRIVE_SPEED_MPH = 15;     // conservative — accounts for city traffic/parking, not motorway speed
const ROUTE_FACTOR = 1.25;      // real roads/paths aren't a straight line
const SAFETY_BUFFER_MIN = 5;    // arrive-by buffer, not arrive-exactly-on-time
const PREFERRED_MAX_DRIVE_MIN = 20; // prioritise options within this drive time; never pad backups out with a far-flung option just to reach 3

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

  // Closest-first (drive time, then distance as a tiebreak) — "can
  // you make it" already filtered to feasible mosques; among those,
  // proximity decides ranking, not which one's Jama'ah happens to be
  // soonest on the clock.
  const byDistance = [...feasible].sort(
    (a, b) => a.travelMinutes - b.travelMinutes || a.distanceMiles - b.distanceMiles
  );

  // Prefer a primary within the target drive-time ceiling; only reach
  // further if nothing feasible is that close right now (better to
  // show a real answer than none).
  const withinCapAll = byDistance.filter((m) => m.travelMinutes <= PREFERRED_MAX_DRIVE_MIN);
  const primary = withinCapAll[0] || byDistance[0];
  const rest = byDistance.filter((m) => m !== primary);

  // Backups are capped hard at PREFERRED_MAX_DRIVE_MIN — never padded
  // out to 3 cards by reaching for a mosque that's an unreasonable
  // drive away. Within that cap, prefer ones with a LATER Jama'ah
  // than primary (genuinely useful if you miss it); fall back to any
  // nearby one only if that's all that's close enough.
  const withinCap = rest.filter((m) => m.travelMinutes <= PREFERRED_MAX_DRIVE_MIN);
  const laterAndClose = withinCap.filter((m) => m.jamaahInMinutes > primary.jamaahInMinutes);

  const backups = [];
  for (const pool of [laterAndClose, withinCap]) {
    for (const m of pool) {
      if (backups.length >= 2) break;
      if (!backups.includes(m)) backups.push(m);
    }
    if (backups.length >= 2) break;
  }
  return { primary, backups };
}

// ---------- Shared core (used by both POST and GET) ----------

function validateCoords(lat, lon) {
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  return validLat && validLon;
}

async function buildPlanResponse(lat, lon, context) {
  const { dateIso, minutes: nowMinutes } = londonNowParts();

  // --- Mosques near this visitor, with today's jama'ah times read
  // straight from each mosque's own stored timetable (_lib/area-times.js).
  // Cached per area per day at the edge, so only the first visitor in an
  // area costs anything. No global file, no per-day copies. ---
  let areaRows, source;
  try {
    const area = await loadArea(context, lat, lon, dateIso);
    areaRows = area.rows;
    source = area.from;
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load mosque data", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Filter to bounding box (in-memory, free) ---
  const latDelta = milesToLatDegrees(CANDIDATE_BOX_MILES);
  const lonDelta = milesToLonDegrees(CANDIDATE_BOX_MILES, lat);
  const minLat = lat - latDelta, maxLat = lat + latDelta;
  const minLon = lon - lonDelta, maxLon = lon + lonDelta;

  const candidates = [];
  for (const row of areaRows) {
    if (row.latitude >= minLat && row.latitude <= maxLat &&
        row.longitude >= minLon && row.longitude <= maxLon) {
      candidates.push(rowToCandidate(row));
    }
  }

  // --- Compute feasibility ---
  let feasible = computeFeasible(candidates, lat, lon, nowMinutes);

  // If the tight box didn't produce 3 results, widen to everything in
  // this area, then to the neighbouring areas (each one cached in its
  // own right). Never "all mosques" — at worldwide scale that's far too
  // much to read for one visitor.
  let expanded = false;
  if (feasible.length < 3) {
    const wider = computeFeasible(areaRows.map(rowToCandidate), lat, lon, nowMinutes);
    if (wider.length > feasible.length) { feasible = wider; expanded = true; }
  }
  if (feasible.length < 3) {
    const step = 0.35; // ~24 miles
    const seen = new Set(areaRows.map((r) => r.slug));
    const extra = [];
    for (const [dLat, dLon] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      try {
        const area = await loadArea(context, lat + dLat, lon + dLon, dateIso);
        for (const row of area.rows) {
          if (seen.has(row.slug)) continue;
          seen.add(row.slug);
          extra.push(rowToCandidate(row));
        }
      } catch (e) { /* a neighbour failing shouldn't fail the answer */ }
      if (extra.length) break;
    }
    if (extra.length) {
      const widest = computeFeasible(areaRows.map(rowToCandidate).concat(extra), lat, lon, nowMinutes);
      if (widest.length > feasible.length) { feasible = widest; expanded = true; }
    }
  }

  const { primary, backups } = pickPrimaryAndBackups(feasible);
  const note = !primary ? "No Jama'ah times found nearby — none of the nearby mosques have Fajr times on record yet." : null;

  return new Response(
    JSON.stringify({ date: dateIso, generatedAtMinutes: nowMinutes, primary, backups, expanded, note, source }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

function badCoordsResponse() {
  return new Response(JSON.stringify({ error: "lat and lon must be valid coordinates" }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

// ---------- Entry points ----------

// Primary path — used by the frontend. Coordinates in the POST body
// keep them out of URLs/access logs/Referer headers (see PRIVACY note
// at the top of this file).
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return badCoordsResponse();
  }
  const lat = parseFloat(body && body.lat);
  const lon = parseFloat(body && body.lon);
  if (!validateCoords(lat, lon)) return badCoordsResponse();
  return buildPlanResponse(lat, lon, context);
}

// Kept for backward compatibility (direct URL testing, older cached
// clients) — identical logic, just reads coordinates from the query
// string instead of a POST body.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  if (!validateCoords(lat, lon)) return badCoordsResponse();
  return buildPlanResponse(lat, lon, context);
}

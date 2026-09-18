// functions/api/mosques/plan.js
//
// "Find a Mosque" plan endpoint — given the visitor's lat/lon, works
// out ONE primary mosque (the closest one they can still reach before
// Jama'ah) plus up to TWO backup mosques with later Jama'ah times, in
// case they miss the primary.
//
// It ALSO returns `nearby`: every mosque close to the visitor, closest
// first, whether or not it has a Jama'ah time. A mosque with no time on
// record is never hidden - it comes back with next = null and the page
// shows "No Jama'ah time yet". (Product rule: a mosque with no live time
// must still appear.)
//
// Debug: GET ?lat=..&lon=..&debug=1 adds, for each nearby mosque, the
// reason it did or didn't make the three cards.
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

// The first Jama'ah this visitor can still reach at this mosque, given
// how long it takes to get there. Checks today's prayers in order, then
// tomorrow's Fajr. Previously only the very next prayer was checked, and
// if that one was too soon to reach the whole mosque vanished - even
// though a later prayer (or tomorrow's Fajr) was fine.
function reachablePrayerFor(candidate, nowMinutes, travelMinutes) {
  for (const prayer of PRAYER_ORDER) {
    const mins = parseTimeToMinutes(prayer, candidate.jamaah[prayer]);
    if (mins === null || mins < nowMinutes) continue;
    const until = mins - nowMinutes;
    if (until - travelMinutes - SAFETY_BUFFER_MIN >= 0) {
      return { prayer, time: candidate.jamaah[prayer], minutesUntil: until, isTomorrow: false };
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

function hasAnyTime(c) {
  return PRAYER_ORDER.some((p) => c.jamaah[p]) || !!c.tomorrowFajr;
}

function buildPlanEntry(candidate, dist, next, travel) {
  return {
    slug: candidate.slug, name: candidate.name, address: candidate.address,
    latitude: candidate.latitude, longitude: candidate.longitude,
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
    const dist = distanceMiles(lat, lon, c.latitude, c.longitude);
    const travel = travelEstimate(dist);
    const next = reachablePrayerFor(c, nowMinutes, travel.minutes);
    if (!next) continue;
    feasible.push(buildPlanEntry(c, dist, next, travel));
  }
  feasible.sort((a, b) => a.jamaahInMinutes - b.jamaahInMinutes);
  return dedupeEntries(feasible);
}

// ---------- Same-mosque safety net ----------
// Duplicates should be merged in the database (admin -> Sources ->
// "Find duplicates"), but until they are, never show the same mosque
// twice. Two entries are one mosque if they sit within 30m of each
// other, or within 400m with names that match once words like
// "mosque/masjid/centre" are ignored. The one with a time wins.
const NAME_STOP = new Set([
  "mosque", "masjid", "islamic", "islam", "centre", "center", "the", "of", "and", "uk",
  "muslim", "muslims", "trust", "association", "community", "jamia", "jame", "jamme",
  "al", "el", "bin", "ibn", "society",
]);
function nameTokens(name) {
  return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !NAME_STOP.has(w));
}
function namesMatch(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  if (!A.length || !B.length) {
    const na = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return !!na && na === String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  const aSet = new Set(A), bSet = new Set(B);
  return A.every((w) => bSet.has(w)) || B.every((w) => aSet.has(w));
}
function sameMosque(a, b) {
  if (a.latitude == null || b.latitude == null) return false;
  // Cheap reject first (~450m box) so big lists stay fast.
  if (Math.abs(a.latitude - b.latitude) > 0.004 || Math.abs(a.longitude - b.longitude) > 0.007) return false;
  const metres = distanceMiles(a.latitude, a.longitude, b.latitude, b.longitude) * 1609.34;
  return metres <= 30 || (metres <= 400 && namesMatch(a.name, b.name));
}
// Keeps list order; drops any later entry that's the same mosque as an
// earlier one - except it swaps in the later one if only it has a time.
function dedupeEntries(list) {
  const out = [];
  for (const e of list) {
    const i = out.findIndex((o) => sameMosque(o, e));
    if (i === -1) out.push(e);
    else if (!out[i].prayer && e.prayer) out[i] = e;
  }
  return out;
}

function pickPrimaryAndBackups(feasible) {
  if (!feasible.length) return { primary: null, backups: [] };

  // Closest-first by real distance. "Can you make it" already filtered
  // to feasible mosques; among those, proximity decides ranking, not
  // which one's Jama'ah happens to be soonest on the clock.
  //
  // Not by travel minutes: anything under 0.6 miles is timed as a WALK
  // (3 mph) and anything further as a DRIVE (15 mph), so a mosque 0.4
  // miles away (10 min walk) used to lose to one 0.9 miles away (5 min
  // drive) - the closest mosque to someone's house could drop off the
  // cards entirely.
  const byDistance = [...feasible].sort(
    (a, b) => a.distanceMiles - b.distanceMiles || a.travelMinutes - b.travelMinutes
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

async function buildPlanResponse(lat, lon, context, debug) {
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

  // --- Every mosque near the visitor, times or not ---
  const nearby = buildNearby(areaRows.map(rowToCandidate), lat, lon, nowMinutes);

  let note = null;
  if (!primary) {
    note = nearby.length
      ? "None of the mosques near you have a Jama'ah time you can still make. Here's what's around you."
      : "No mosques found near this location yet.";
  }

  const body = { date: dateIso, generatedAtMinutes: nowMinutes, primary, backups, nearby, expanded, note, source };
  if (debug) body.debug = debugReasons(nearby, primary, backups, feasible);

  return new Response(
    JSON.stringify(body),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

// Closest mosques to the visitor, closest first - including ones with no
// Jama'ah time on record (next: null). Up to NEARBY_LIMIT within
// NEARBY_MILES; if that finds very few, the nearest few regardless.
const NEARBY_MILES = 3;
const NEARBY_LIMIT = 12;
const NEARBY_MIN = 5;

function buildNearby(candidates, lat, lon, nowMinutes) {
  const all = [];
  for (const c of candidates) {
    if (c.latitude == null || c.longitude == null) continue;
    const dist = distanceMiles(lat, lon, c.latitude, c.longitude);
    const travel = travelEstimate(dist);
    const next = reachablePrayerFor(c, nowMinutes, travel.minutes);
    all.push({
      slug: c.slug, name: c.name, address: c.address,
      latitude: c.latitude, longitude: c.longitude,
      distanceMiles: Math.round(dist * 10) / 10, _dist: dist,
      travelMode: travel.mode, travelMinutes: travel.minutes,
      prayer: next ? next.prayer : null, time: next ? next.time : null,
      jamaahInMinutes: next ? next.minutesUntil : null, isTomorrow: next ? next.isTomorrow : false,
      // no_times  = nothing on record for today or tomorrow
      // none_left = has times, but none left today and no Fajr for tomorrow
      status: next ? "ok" : (hasAnyTime(c) ? "none_left" : "no_times"),
    });
  }
  all.sort((a, b) => a._dist - b._dist);
  const closest = dedupeEntries(all.slice(0, 40));
  let list = closest.filter((m) => m._dist <= NEARBY_MILES).slice(0, NEARBY_LIMIT);
  if (list.length < NEARBY_MIN) list = closest.slice(0, NEARBY_MIN);
  return list.map(({ _dist, ...m }) => m);
}

function debugReasons(nearby, primary, backups, feasible) {
  const shown = new Set([primary && primary.slug, ...backups.map((b) => b.slug)].filter(Boolean));
  const feasibleSlugs = new Set(feasible.map((f) => f.slug));
  return nearby.map((m) => ({
    slug: m.slug, name: m.name, distanceMiles: m.distanceMiles,
    next: m.prayer ? `${m.prayer} ${m.time}${m.isTomorrow ? " (tomorrow)" : ""}` : null,
    reason: shown.has(m.slug) ? "shown as a card"
      : m.status === "no_times" ? "no Jama'ah times on record"
      : m.status === "none_left" ? "nothing left today and no Fajr on record for tomorrow"
      : feasibleSlugs.has(m.slug) ? "reachable, but a closer mosque took the card slots"
      : "reachable, but merged away as a duplicate of a nearby entry",
  }));
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
  return buildPlanResponse(lat, lon, context, false);
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
  return buildPlanResponse(lat, lon, context, url.searchParams.get("debug") === "1");
}

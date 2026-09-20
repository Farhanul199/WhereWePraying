// functions/api/mosques/plan.js
//
// "Find a Mosque" endpoint. Given the visitor's position it returns the
// CLOSEST mosques first - that's the number one rule - each with today's
// Jama'ah times and its next Jama'ah.
//
//   POST { lat, lon, count?: 1-10 (default 3), pins?: [{ slug, lat, lon }], exclude?: [slug] }
//   (exclude = mosques the person hid; the list is refilled to `count`)
//     -> { mosques: [...closest `count`], pinned: [...pins], ... }
//
// Every mosque has a `state`:
//   active    - it has a Jama'ah still to come today (next = that one).
//               `canMakeIt` says whether the visitor can get there in time;
//               it's a hint on the card, never a reason to hide a mosque.
//   done_today - all of today's Jama'ah have passed. The card is shown
//               greyed out with tomorrow's Fajr as `next`. After midnight
//               (London) the date rolls over, today's Fajr is "to come"
//               again, and the card is back to normal on its own.
//   no_times  - nothing on record; still shown, "No Jama'ah time yet".
//
// Mosques are never dropped for timing reasons. Nothing here filters by
// "can you make it" any more.
//
// `pins` are favourites / a searched-for mosque that may be far away:
// each is looked up in its own area (cached per area per day, same as
// everything else), so pins cost nothing extra on the database.
//
// COST DESIGN - read, don't copy (see _lib/area-times.js): the visitor's
// area is cached at the edge + KV per day; everything below is in-memory.
// A bigger `count` changes nothing on the database side - the area is
// already loaded - so up to 10 is safe.
//
// Debug: GET ?lat=..&lon=..&debug=1 adds each listed mosque's linked
// data sources and their state, for working out missing times.
//
// PRIVACY: the frontend sends coordinates in a POST body, so they don't
// land in access logs, browser history or a Referer header. Nothing about
// the visitor's location is stored.

import { loadArea } from "../../_lib/area-times.js";

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const WALK_MAX_MILES = 0.6;     // below this distance, assume walking
const WALK_SPEED_MPH = 3;
const DRIVE_SPEED_MPH = 15;     // conservative - city traffic/parking
const ROUTE_FACTOR = 1.25;      // real roads/paths aren't a straight line
const SAFETY_BUFFER_MIN = 5;    // arrive-by buffer
const MAX_COUNT = 10;
const DEFAULT_COUNT = 3;
const MAX_PINS = 12;
const MAX_PIN_AREAS = 6;

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
    slug: row.slug, name: row.name, address: row.address || null, postcode: row.postcode || null,
    latitude: row.latitude, longitude: row.longitude, jamaah,
    tomorrowFajr: row.tomorrow_fajr || null,
    aliases: row.aliases ? row.aliases.split('||') : [],
  };
}

function hasAnyTime(c) {
  return PRAYER_ORDER.some((p) => c.jamaah[p]) || !!c.tomorrowFajr;
}

// Next Jama'ah at this mosque, by the clock - not by whether the visitor
// can reach it. After Isha: tomorrow's Fajr, flagged isTomorrow.
function nextJamaah(c, nowMinutes) {
  for (const prayer of PRAYER_ORDER) {
    const mins = parseTimeToMinutes(prayer, c.jamaah[prayer]);
    if (mins !== null && mins >= nowMinutes) {
      return { prayer, time: c.jamaah[prayer], minutesUntil: mins - nowMinutes, isTomorrow: false };
    }
  }
  const t = parseTimeToMinutes("fajr", c.tomorrowFajr);
  if (t !== null) return { prayer: "fajr", time: c.tomorrowFajr, minutesUntil: (1440 - nowMinutes) + t, isTomorrow: true };
  return null;
}

function toEntry(c, lat, lon, nowMinutes) {
  const dist = distanceMiles(lat, lon, c.latitude, c.longitude);
  const travel = travelEstimate(dist);
  const next = nextJamaah(c, nowMinutes);
  const state = !hasAnyTime(c) ? "no_times" : (next && !next.isTomorrow ? "active" : "done_today");
  return {
    slug: c.slug, name: c.name, address: c.address, postcode: c.postcode,
    latitude: c.latitude, longitude: c.longitude,
    distanceMiles: Math.round(dist * 10) / 10, _dist: dist,
    travelMode: travel.mode, travelMinutes: travel.minutes,
    today: c.jamaah, tomorrowFajr: c.tomorrowFajr, aliases: c.aliases || [],
    state,
    prayer: next ? next.prayer : null, time: next ? next.time : null,
    jamaahInMinutes: next ? next.minutesUntil : null, isTomorrow: next ? next.isTomorrow : false,
    canMakeIt: state === "active" ? next.minutesUntil - travel.minutes - SAFETY_BUFFER_MIN >= 0 : null,
  };
}
const strip = ({ _dist, ...e }) => e;

async function buildPlanResponse(context, { lat, lon, count, pins, exclude, debug }) {
  exclude = exclude || new Set();
  const { dateIso, minutes: nowMinutes } = londonNowParts();

  let area;
  try {
    area = await loadArea(context, lat, lon, dateIso);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to load mosque data", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // --- Closest first. Always. ---
  const withCoords = area.rows.filter((r) => r.latitude != null && r.longitude != null && !exclude.has(r.slug));
  let all = withCoords.map((r) => toEntry(rowToCandidate(r), lat, lon, nowMinutes));
  all.sort((a, b) => a._dist - b._dist);

  // Sparse area (rural, or the edge of one): also look one area over.
  if (all.length < count) {
    const seen = new Set(all.map((e) => e.slug));
    const step = 0.35; // ~24 miles
    for (const [dLat, dLon] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      try {
        const more = await loadArea(context, lat + dLat, lon + dLon, dateIso);
        for (const r of more.rows) {
          if (seen.has(r.slug) || r.latitude == null || exclude.has(r.slug)) continue;
          seen.add(r.slug);
          all.push(toEntry(rowToCandidate(r), lat, lon, nowMinutes));
        }
      } catch (e) { /* a neighbour failing shouldn't fail the answer */ }
      if (all.length >= count) break;
    }
    all.sort((a, b) => a._dist - b._dist);
  }
  const mosques = dedupeEntries(all.slice(0, count * 3 + 10)).slice(0, count).map(strip);

  // --- Pins: favourites / a searched mosque, each from its own area ---
  const pinned = [];
  if (pins.length) {
    const found = new Map(all.map((e) => [e.slug, e]));
    const missing = pins.filter((p) => !found.has(p.slug));
    const areas = new Map();
    for (const p of missing) {
      const key = Math.round(p.lat * 10) + ":" + Math.round(p.lon * 10);
      if (!areas.has(key)) areas.set(key, p);
    }
    for (const p of [...areas.values()].slice(0, MAX_PIN_AREAS)) {
      try {
        const a = await loadArea(context, p.lat, p.lon, dateIso);
        for (const r of a.rows) {
          if (r.latitude == null || found.has(r.slug)) continue;
          if (pins.some((x) => x.slug === r.slug)) found.set(r.slug, toEntry(rowToCandidate(r), lat, lon, nowMinutes));
        }
      } catch (e) { /* skip that pin's area */ }
    }
    for (const p of pins) if (found.has(p.slug)) pinned.push(strip(found.get(p.slug)));
  }

  const note = mosques.length ? null : "No mosques found near this location yet.";
  const out = { date: dateIso, generatedAtMinutes: nowMinutes, count, mosques, pinned, note, source: area.from };
  if (debug) {
    out.debug = mosques.map((m) => ({ slug: m.slug, name: m.name, distanceMiles: m.distanceMiles, state: m.state,
      next: m.prayer ? `${m.prayer} ${m.time}${m.isTomorrow ? " (tomorrow)" : ""}` : null }));
    try {
      await addSourceDiagnostics(context.env.DB, out.debug, lat, lon);
      out.unlinkedMawaqitNearby = out.debug.unlinkedMawaqitNearby;
    } catch (e) { out.debugError = String(e); }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function readCount(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_COUNT, n)) : DEFAULT_COUNT;
}
function readExclude(v) {
  if (!Array.isArray(v)) return new Set();
  return new Set(v.slice(0, 100).map((x) => String(x || "").slice(0, 120)).filter(Boolean));
}
function readPins(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_PINS)
    .map((p) => ({ slug: String(p && p.slug || "").slice(0, 120), lat: parseFloat(p && p.lat), lon: parseFloat(p && p.lon) }))
    .filter((p) => p.slug && validateCoords(p.lat, p.lon));
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

// Debug only: for every nearby mosque with no times, show which data
// sources are linked to it and what state each one is in, plus any
// Mawaqit mosque close by that was never linked to a live listing.
async function addSourceDiagnostics(db, list, lat, lon) {
  const missing = list.filter((d) => !d.next).map((d) => d.slug);
  if (missing.length) {
    const ph = missing.map((_, i) => "?" + (i + 1)).join(",");
    const { results } = await db.prepare(
      `SELECT ms.mosque_slug AS slug, ms.source, ms.source_ref,
              sd.times_status, sd.iqama_enabled, sd.quality, sd.iqama_quality, sd.has_times, sd.compiled_through
         FROM mosque_sources ms
         LEFT JOIN source_discoveries sd ON sd.source = ms.source AND sd.source_ref = ms.source_ref
        WHERE ms.mosque_slug IN (${ph})`
    ).bind(...missing).all();
    const bySlug = new Map();
    for (const r of results || []) {
      if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
      bySlug.get(r.slug).push({
        source: r.source, ref: r.source_ref, times_status: r.times_status,
        iqama_enabled: r.iqama_enabled, quality: r.quality, iqama_quality: r.iqama_quality,
        has_times: r.has_times, compiled_through: r.compiled_through,
      });
    }
    for (const d of list) if (!d.next) d.sources = bySlug.get(d.slug) || [];
  }
  const dLat = 1.5 / 69, dLon = 1.5 / (69 * Math.cos((lat * Math.PI) / 180));
  const { results: loose } = await db.prepare(
    `SELECT source_ref, name, lat, lon, times_status, promoted_slug, duplicate_of
       FROM source_discoveries
      WHERE source = 'mawaqit' AND lat BETWEEN ?1 AND ?2 AND lon BETWEEN ?3 AND ?4
        AND promoted_slug IS NULL AND duplicate_of IS NULL
      LIMIT 20`
  ).bind(lat - dLat, lat + dLat, lon - dLon, lon + dLon).all();
  list.unlinkedMawaqitNearby = loose || [];
}

function validateCoords(lat, lon) {
  const validLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const validLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  return validLat && validLon;
}

function badCoordsResponse() {
  return new Response(JSON.stringify({ error: "lat and lon must be valid coordinates" }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}

// ---------- Entry points ----------

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch (e) { return badCoordsResponse(); }
  const lat = parseFloat(body && body.lat);
  const lon = parseFloat(body && body.lon);
  if (!validateCoords(lat, lon)) return badCoordsResponse();
  return buildPlanResponse(context, { lat, lon, count: readCount(body.count), pins: readPins(body.pins), exclude: readExclude(body.exclude), debug: false });
}

// Direct testing: GET ?lat=..&lon=..&count=5&debug=1
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseFloat(url.searchParams.get("lat"));
  const lon = parseFloat(url.searchParams.get("lon"));
  if (!validateCoords(lat, lon)) return badCoordsResponse();
  return buildPlanResponse(context, {
    lat, lon, count: readCount(url.searchParams.get("count")), pins: [],
    debug: url.searchParams.get("debug") === "1",
  });
}

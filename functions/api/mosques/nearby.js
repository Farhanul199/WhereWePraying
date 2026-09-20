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
// The heavy lifting lives in _lib/area-times.js: the visitor's position
// is rounded to a ~7-mile area, and that area's mosques + today's
// jama'ah times are cached at the edge and in KV. The first visitor in
// an area builds it; everyone after that costs nothing. Times are read
// out of each mosque's own stored timetable, never copied into daily
// rows first. Exact distance filtering for THIS visitor then happens in
// memory here, which is free.
//
// Sparse areas: if fewer than 3 mosques are within range, we look at
// the four neighbouring areas (each itself cached) rather than reading
// every mosque in the table — at worldwide scale that's not an option.

import { loadArea } from "../../_lib/area-times.js";

const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const RESULT_LIMIT = 8;
const MIN_RESULTS = 3;
const SEARCH_RADIUS_MILES = 15;

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
  if (row.maghrib_estimated && jamaah.maghrib) jamaah.maghribEstimated = true;
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

  // Mosques + today's jama'ah times for this area, read straight from
  // each mosque's own stored timetable (see _lib/area-times.js). Cached
  // per area per day, so only the first visitor costs anything.
  let candidates;
  try {
    const area = await loadArea(context, lat, lon, dateIso);
    candidates = area.rows.map((row) => buildRow(row, dateIso, isToday, nowMinutes));
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load nearby mosques", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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

  // 6. Still short: widen the search by looking at the neighbouring
  // areas rather than the whole table - at worldwide scale "everything"
  // is far too big to read, and a mosque 200 miles away is no use anyway.
  if (nearby.length < MIN_RESULTS) {
    const step = 0.35; // ~24 miles
    const seen = new Set(withDistance.map((m) => m.slug));
    const extra = [];
    for (const [dLat, dLon] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      try {
        const area = await loadArea(context, lat + dLat, lon + dLon, dateIso);
        for (const row of area.rows) {
          if (seen.has(row.slug)) continue;
          seen.add(row.slug);
          const m = buildRow(row, dateIso, isToday, nowMinutes);
          if (m.latitude == null || m.longitude == null) continue;
          extra.push({ ...m, distanceMiles: distanceMiles(lat, lon, m.latitude, m.longitude) });
        }
      } catch (e) { /* one neighbour failing shouldn't fail the answer */ }
      if (extra.length + withDistance.length >= MIN_RESULTS) break;
    }
    if (extra.length) {
      const all = withDistance.concat(extra).sort((a, b) => a.distanceMiles - b.distanceMiles);
      nearby = all.slice(0, RESULT_LIMIT);
      expanded = true;
    }
  }

  nearby = nearby.map((m) => ({ ...m, distanceMiles: Math.round(m.distanceMiles * 10) / 10 }));

  return new Response(
    JSON.stringify({ date: dateIso, isToday, mosques: nearby, radiusMiles: SEARCH_RADIUS_MILES, expanded }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}

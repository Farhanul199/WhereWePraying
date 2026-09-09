// functions/api/mosques/one.js
//
// GET /api/mosques/one?slug=SLUG&date=YYYY-MM-DD
//   -> one mosque's Jama'ah times for the given date (today if omitted).
//
// This is the cheap, small-payload sibling of list.js — used when the
// app only needs ONE mosque's times (e.g. a person's saved "usual
// mosque") instead of every mosque nationwide. Same caching pattern
// as list.js: free edge cache first, then the shared KV store, and
// only touches the database if both of those miss.

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
const PRAYER_ORDER = ["fajr", "zuhr", "asr", "maghrib", "isha"];
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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug) {
    return new Response(JSON.stringify({ error: "Missing ?slug" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const requestedDate = url.searchParams.get("date");
  const { dateIso: todayIso, minutes: nowMinutes } = londonNowParts();
  const dateIso = requestedDate || todayIso;
  const isToday = dateIso === todayIso;

  const kvKey = "mq_one_v1:" + slug + ":" + dateIso;
  if (env.RATE_LIMIT) {
    const kvHit = await env.RATE_LIMIT.get(kvKey);
    if (kvHit) {
      const response = new Response(kvHit, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      });
      context.waitUntil(cache.put(request, response.clone()));
      return response;
    }
  }

  try {
    const row = await env.DB.prepare(
      `SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region,
              t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah,
              ph.r2_key AS photo_key
       FROM mosques m
       LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
       LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
       WHERE m.slug = ? AND m.active = 1
       LIMIT 1`
    )
      .bind(dateIso, slug)
      .first();

    if (!row) {
      const body = JSON.stringify({ date: dateIso, isToday, mosque: null });
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    }

    const jamaah = {
      fajr: row.fajr_jamaah || null,
      zuhr: row.zuhr_jamaah || null,
      asr: row.asr_jamaah || null,
      maghrib: row.maghrib_jamaah || null,
      isha: row.isha_jamaah || null,
    };
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
    const photoUrl = row.photo_key ? `/api/community/photo/${row.photo_key}` : null;
    const mosque = {
      slug: row.slug, name: row.name, address: row.address || null,
      postcode: row.postcode || null, latitude: row.latitude ?? null,
      longitude: row.longitude ?? null, region: row.region || "Other",
      jamaah, next, photoUrl,
    };

    const body = JSON.stringify({ date: dateIso, isToday, mosque });
    const response = new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
    context.waitUntil(cache.put(request, response.clone()));
    if (env.RATE_LIMIT) {
      context.waitUntil(env.RATE_LIMIT.put(kvKey, body, { expirationTtl: 600 }));
    }
    return response;
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load mosque", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// functions/api/mosques/list.js
//
// MVP "Find a Mosque" data endpoint. Returns every active mosque with
// today's (or ?date=YYYY-MM-DD) Jama'ah times, plus which prayer is
// "next" and how many minutes away it is. Sorted soonest-next-jamaah
// first. Full feasibility/distance-based ranking comes later — this
// is the simple version to get real data on screen.
//
// Goes through the normal device-id middleware (no admin bypass needed —
// this is a public, user-facing route the frontend already calls with
// window.WWP.deviceId).

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
  // Fajr is always given as a plain AM hour (0-11) - leave as-is.
  // Zuhr/Asr/Maghrib/Isha: the source site mixes 12h ("6:15") and
  // 24h ("18:00") formats. If the hour is 1-11 it's a bare 12h
  // afternoon/evening value, so bump to PM. If it's already 12 or
  // 13+, it's already correct.
  if (prayer !== "fajr" && h >= 1 && h <= 11) h += 12;
  return h * 60 + min;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");

  const { dateIso: todayIso, minutes: nowMinutes } = londonNowParts();
  const dateIso = requestedDate || todayIso;
  const isToday = dateIso === todayIso;

  try {
    const { results } = await env.DB.prepare(
      `SELECT m.slug, m.name, m.address, t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah, ph.r2_key AS photo_key
       FROM mosques m
       LEFT JOIN thm_jamaah_times t ON t.mosque = m.slug AND t.date = ?
       LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
       WHERE m.active = 1 AND m.type = 'mosque'
       ORDER BY m.name ASC`
    )
      .bind(dateIso)
      .all();

    const mosques = (results || []).map((row) => {
      const jamaah = {
        fajr: row.fajr_jamaah || null,
        zuhr: row.zuhr_jamaah || null,
        asr: row.asr_jamaah || null,
        maghrib: row.maghrib_jamaah || null,
        isha: row.isha_jamaah || null,
      };
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

      return { slug: row.slug, name: row.name, address: row.address || null, jamaah, next, photoUrl };
    });

    mosques.sort((a, b) => {
      if (a.next && b.next) return a.next.minutesUntil - b.next.minutesUntil;
      if (a.next && !b.next) return -1;
      if (!a.next && b.next) return 1;
      return a.name.localeCompare(b.name);
    });

    return new Response(
      JSON.stringify({ date: dateIso, isToday, mosques }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load mosque list", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

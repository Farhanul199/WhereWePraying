// functions/api/mosques/list.js
//
// MVP "Find a Mosque" data endpoint. Returns every active mosque with
// today's (or ?date=YYYY-MM-DD) Jama'ah times, plus which prayer is
// "next" and how many minutes away it is. Sorted soonest-next-jamaah
// first. Now also returns each mosque's `region` (e.g. "Tower Hamlets",
// "East London", "Manchester") so the frontend can group mosques into
// sections instead of one flat list.
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
      `SELECT m.slug, m.name, m.address, m.postcode, m.latitude, m.longitude, m.region, t.fajr_jamaah, t.zuhr_jamaah, t.asr_jamaah, t.maghrib_jamaah, t.isha_jamaah, ph.r2_key AS photo_key
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
      // A newly-added mosque sometimes has several prayer fields filled
      // in with the exact same placeholder value (looks like whatever
      // Fajr time was on hand at the time, stuffed into the empty slots
      // instead of leaving them blank) instead of that prayer's own real
      // Jama'ah time — e.g. Zuhr, Asr, Maghrib and Isha all reading
      // "4:47" for a mosque whose real Fajr is "5:45". Five real daily
      // prayers are never within minutes of each other, so whichever
      // value repeats 4+ times across the five slots is the placeholder,
      // not real data — clear ONLY those slots. Anything that differs
      // from that repeated value (Fajr's own "5:45" here) is left alone,
      // since that field was actually given its own real time. This is
      // what made "Redbridge Islamic Centre" show Isha at 4:44 (all 5
      // slots were the placeholder there) while its own site says
      // 8:49pm, and made "Green Street Masjid" show Isha using what was
      // really its Fajr-ish placeholder rather than a real Isha time.
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
      return { slug: row.slug, name: row.name, address: row.address || null, postcode: row.postcode || null, latitude: row.latitude ?? null, longitude: row.longitude ?? null, region: row.region || "Other", jamaah, next, photoUrl };
    });
    mosques.sort((a, b) => {
      if (a.next && b.next) return a.next.minutesUntil - b.next.minutesUntil;
      if (a.next && !b.next) return -1;
      if (!a.next && b.next) return 1;
      return a.name.localeCompare(b.name);
    });
    return new Response(
      JSON.stringify({ date: dateIso, isToday, mosques }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load mosque list", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

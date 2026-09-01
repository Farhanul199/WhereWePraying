// functions/api/mosques/jummah.js
//
// GET /api/mosques/jummah?date=YYYY-MM-DD
//   -> every active location (mosque, community hall, or prayer room)
//      that has at least one Jummah slot for the given Friday, each
//      with its full slots array (a location can run more than one
//      khutbah/jama'ah). If ?date isn't a Friday, resolves to the next
//      upcoming Friday from that date. If ?date is omitted, resolves
//      from today (London time).
//
// Unlike list.js (daily 5-prayer times, mosques only), this endpoint
// includes every location type, since community halls and prayer rooms
// are assumed to only run the Friday Jummah, not the daily jama'ahs.

function londonNowParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { dateIso: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday") };
}

function weekdayOfIso(iso) {
  // Fri = 5 (Mon=1 ... Sun=7), computed in UTC since dateIso is a plain
  // calendar date with no time component to convert.
  const d = new Date(iso + "T12:00:00Z");
  const day = d.getUTCDay();
  return day === 0 ? 7 : day;
}

function addDaysIso(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextFridayIso(iso) {
  let cursor = iso;
  for (let i = 0; i < 7; i++) {
    if (weekdayOfIso(cursor) === 5) return cursor;
    cursor = addDaysIso(cursor, 1);
  }
  return iso; // unreachable
}

function parseTimeToMinutes(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(".", ":").trim();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  // Jummah is always an afternoon time - bare 1-11 hour values are PM.
  if (h >= 1 && h <= 11) h += 12;
  return h * 60 + min;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date");

  const { dateIso: todayIso } = londonNowParts();
  const baseIso = requestedDate || todayIso;
  const dateIso = weekdayOfIso(baseIso) === 5 ? baseIso : nextFridayIso(baseIso);

  try {
    const { results } = await env.DB.prepare(
      `SELECT m.slug, m.name, m.type, m.address, ph.r2_key AS photo_key,
              j.slot, j.time
       FROM mosques m
       JOIN jummah_times j ON j.location = m.slug AND j.date = ?
       LEFT JOIN mosque_photos ph ON ph.mosque = m.slug AND ph.status = 'approved'
       WHERE m.active = 1
       ORDER BY m.name ASC, j.slot ASC`
    )
      .bind(dateIso)
      .all();

    const bySlug = new Map();
    for (const row of results || []) {
      if (!bySlug.has(row.slug)) {
        bySlug.set(row.slug, {
          slug: row.slug,
          name: row.name,
          type: row.type || "mosque",
          address: row.address || null,
          photoUrl: row.photo_key ? `/api/community/photo/${row.photo_key}` : null,
          slots: [],
        });
      }
      const mins = parseTimeToMinutes(row.time);
      bySlug.get(row.slug).slots.push({ slot: row.slot, time: row.time, minutes: mins });
    }

    const locations = Array.from(bySlug.values()).map((loc) => {
      const mins = loc.slots.map((s) => s.minutes).filter((m) => m !== null);
      return {
        ...loc,
        firstMinutes: mins.length ? Math.min(...mins) : null,
        lastMinutes: mins.length ? Math.max(...mins) : null,
      };
    });

    locations.sort((a, b) => {
      if (a.firstMinutes !== null && b.firstMinutes !== null) return a.firstMinutes - b.firstMinutes;
      if (a.firstMinutes !== null) return -1;
      if (b.firstMinutes !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    return new Response(
      JSON.stringify({ date: dateIso, locations }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Failed to load Jummah times", detail: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

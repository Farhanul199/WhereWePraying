// functions/api/mosques/scrape.js
//
// Admin-only (X-Broadcast-Key, same as manage.js). Visits every mosque's
// source_url, tries to pull today's Jama'ah times out of the page text,
// and writes anything it's confident about into thm_jamaah_times.
//
// Trigger: a small separate Cron Worker calls this once a day (see
// /cron-worker in the repo root). You can also call it manually:
//   curl -X POST https://wherewepraying.com/api/mosques/scrape \
//     -H "X-Broadcast-Key: YOUR_SECRET"
//
// Safety rule: if we can't confidently find a prayer's time, we leave
// it out (null) rather than guess. A missing time just means that
// mosque doesn't show up in the ranked list yet — better than showing
// a wrong time for a house of worship.

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isAdmin(context) {
  const key = context.request.headers.get("X-Broadcast-Key");
  return !!(context.env.BROADCAST_SECRET && key === context.env.BROADCAST_SECRET);
}

function londonTodayIso() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Very small time pattern: 1-2 digit hour, colon or dot, 2 digit minute,
// optional am/pm. e.g. "5:15", "05.30", "1:30pm", "13:30"
const TIME_RE = /\b([0-2]?\d)[:.]([0-5]\d)\s*(am|pm)?\b/i;

// For each prayer, a handful of label variants that might precede its
// time on a page (English only for now — most UK mosque sites use
// English labels even when other content is in Arabic/Bengali/Urdu).
const PRAYER_LABELS = {
  fajr: [/fajr/i],
  zuhr: [/zuhr/i, /dhuhr/i, /duhr/i],
  asr: [/asr/i],
  maghrib: [/maghrib/i],
  isha: [/isha/i, /esha/i],
};

// Strips tags/scripts down to plain visible text, collapsing whitespace.
// Not a full HTML parser — good enough to find "Fajr ... 5:15" style
// patterns that sit near each other in the rendered page.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// Looks for each prayer's label, then searches a window of text right
// after it for the first clock-time pattern. Returns null for any
// prayer it isn't confident about.
function extractJamaahTimes(text) {
  const result = { fajr: null, zuhr: null, asr: null, maghrib: null, isha: null };
  for (const prayer of Object.keys(PRAYER_LABELS)) {
    for (const labelRe of PRAYER_LABELS[prayer]) {
      const labelMatch = text.match(labelRe);
      if (!labelMatch) continue;
      const start = labelMatch.index + labelMatch[0].length;
      const window = text.slice(start, start + 60); // look just after the label
      const timeMatch = window.match(TIME_RE);
      if (timeMatch) {
        let hour = timeMatch[1];
        const min = timeMatch[2];
        const ampm = timeMatch[3];
        result[prayer] = ampm ? `${hour}:${min}${ampm.toLowerCase()}` : `${hour}:${min}`;
        break; // stop at first label variant that worked
      }
    }
  }
  return result;
}

// A scrape only "counts" if we found at least 3 of the 5 prayers —
// otherwise it's probably picked up noise from an unrelated page.
function isConfident(times) {
  const found = Object.values(times).filter(Boolean).length;
  return found >= 3;
}

export async function onRequestPost(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;
  const dateIso = londonTodayIso();

  const { results: mosques } = await db.prepare(
    `SELECT slug, name, source_url FROM mosques
     WHERE active = 1 AND source_url IS NOT NULL AND source_url != ''`
  ).all();

  const report = { date: dateIso, total: mosques.length, updated: [], skipped: [], failed: [] };

  for (const mosque of mosques || []) {
    try {
      const res = await fetch(mosque.source_url, {
        headers: { "User-Agent": "WhereWePrayingBot/1.0 (+https://wherewepraying.com)" },
      });
      if (!res.ok) {
        report.failed.push({ slug: mosque.slug, reason: `HTTP ${res.status}` });
        continue;
      }
      const html = await res.text();
      const text = htmlToText(html);
      const times = extractJamaahTimes(text);

      if (!isConfident(times)) {
        report.skipped.push({ slug: mosque.slug, found: times });
        continue;
      }

      await db.prepare(
        `INSERT INTO thm_jamaah_times (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'auto-scrape', ?8)
         ON CONFLICT(mosque, date) DO UPDATE SET
           fajr_jamaah = excluded.fajr_jamaah,
           zuhr_jamaah = excluded.zuhr_jamaah,
           asr_jamaah = excluded.asr_jamaah,
           maghrib_jamaah = excluded.maghrib_jamaah,
           isha_jamaah = excluded.isha_jamaah,
           source = excluded.source,
           updated_at = excluded.updated_at`
      ).bind(
        mosque.slug, dateIso,
        times.fajr, times.zuhr, times.asr, times.maghrib, times.isha,
        new Date().toISOString()
      ).run();

      report.updated.push({ slug: mosque.slug, times });
    } catch (e) {
      report.failed.push({ slug: mosque.slug, reason: String(e) });
    }
  }

  return json(report);
}

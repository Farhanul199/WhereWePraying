// functions/api/mosques/scrape.js
//
// Admin-only (X-Broadcast-Key, same as manage.js). Visits mosques'
// source_url pages and pulls today's Jama'ah times into thm_jamaah_times.
//
// SMART ROTATION: instead of always processing mosques in the same
// alphabetical order, this picks the OLDEST-scraped mosques first
// (last_scraped_at ASC). This means:
//   - As you add more mosques over time, they naturally get scraped
//     without any batch-size or offset math needing to change.
//   - Every mosque gets a fair turn across multiple daily runs even
//     if the total list grows past what fits in one day's batches.
//
// FAILURE BACKOFF: mosques that fail 8+ times in a row (dead link,
// permanent 403, etc.) are skipped, so we stop burning subrequests
// on sites that don't work. They still show up occasionally (their
// last_scraped_at still updates on skip-due-to-failures, so they
// rotate back into the queue eventually rather than being scraped
// every single day for nothing).
//
// CONCURRENCY: fetches up to 5 mosques at once within a batch (same
// total subrequest count, just faster wall-clock time per batch).
//
// Trigger: a small separate Cron Worker calls this in batches once a
// day (see /cron-worker or the daily-sync Worker in the repo). Manual:
//   curl -X POST "https://wherewepraying.com/api/mosques/scrape?limit=50" \
//     -H "X-Broadcast-Key: YOUR_SECRET"

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

const TIME_RE = /\b([0-2]?\d)[:.]([0-5]\d)\s*(am|pm)?\b/i;

const PRAYER_LABELS = {
  fajr: [/fajr/i],
  zuhr: [/zuhr/i, /dhuhr/i, /duhr/i],
  asr: [/asr/i],
  maghrib: [/maghrib/i],
  isha: [/isha/i, /esha/i],
};

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

function extractJamaahTimes(text) {
  const result = { fajr: null, zuhr: null, asr: null, maghrib: null, isha: null };
  for (const prayer of Object.keys(PRAYER_LABELS)) {
    for (const labelRe of PRAYER_LABELS[prayer]) {
      const labelMatch = text.match(labelRe);
      if (!labelMatch) continue;
      const start = labelMatch.index + labelMatch[0].length;
      const window = text.slice(start, start + 60);
      const timeMatch = window.match(TIME_RE);
      if (timeMatch) {
        let hour = timeMatch[1];
        const min = timeMatch[2];
        const ampm = timeMatch[3];
        result[prayer] = ampm ? `${hour}:${min}${ampm.toLowerCase()}` : `${hour}:${min}`;
        break;
      }
    }
  }
  return result;
}

function isConfident(times) {
  const found = Object.values(times).filter(Boolean).length;
  return found >= 3;
}

const MAX_CONSECUTIVE_FAILURES = 8;
const CONCURRENCY = 5;

async function processMosque(mosque, db, dateIso) {
  try {
    const res = await fetch(mosque.source_url, {
      headers: { "User-Agent": "WhereWePrayingBot/1.0 (+https://wherewepraying.com)" },
    });
    if (!res.ok) {
      await db.prepare(
        `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = consecutive_failures + 1 WHERE slug = ?2`
      ).bind(new Date().toISOString(), mosque.slug).run();
      return { type: "failed", slug: mosque.slug, reason: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const text = htmlToText(html);
    const times = extractJamaahTimes(text);

    await db.prepare(
      `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = 0 WHERE slug = ?2`
    ).bind(new Date().toISOString(), mosque.slug).run();

    if (!isConfident(times)) {
      return { type: "skipped", slug: mosque.slug, found: times };
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

    return { type: "updated", slug: mosque.slug, times };
  } catch (e) {
    await db.prepare(
      `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = consecutive_failures + 1 WHERE slug = ?2`
    ).bind(new Date().toISOString(), mosque.slug).run();
    return { type: "failed", slug: mosque.slug, reason: String(e) };
  }
}

export async function onRequestPost(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;
  const dateIso = londonTodayIso();

  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get("limit") || "50", 10);

  const { results: mosques } = await db.prepare(
    `SELECT slug, name, source_url FROM mosques
     WHERE active = 1 AND source_url IS NOT NULL AND source_url != ''
     AND consecutive_failures < ?1
     ORDER BY COALESCE(last_scraped_at, '1970-01-01T00:00:00Z') ASC
     LIMIT ?2`
  ).bind(MAX_CONSECUTIVE_FAILURES, limit).all();

  const report = { date: dateIso, limit, batchSize: mosques.length, updated: [], skipped: [], failed: [] };

  const queue = [...(mosques || [])];
  while (queue.length > 0) {
    const chunk = queue.splice(0, CONCURRENCY);
    const outcomes = await Promise.all(chunk.map((m) => processMosque(m, db, dateIso)));
    for (const outcome of outcomes) {
      if (outcome.type === "updated") report.updated.push(outcome);
      else if (outcome.type === "skipped") report.skipped.push(outcome);
      else report.failed.push(outcome);
    }
  }

  return json(report);
}

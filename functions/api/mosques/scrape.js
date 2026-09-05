// functions/api/mosques/scrape.js
//
// Admin-only (X-Broadcast-Key, same as manage.js). Visits mosques'
// source_url pages and pulls today's Jama'ah times into thm_jamaah_times.
//
// SMART ROTATION: picks the OLDEST-scraped mosques first
// (last_scraped_at ASC) so growth over time needs no batch-math changes.
//
// FAILURE BACKOFF: mosques failing 8+ times in a row are skipped from
// the active rotation until they succeed again.
//
// CONCURRENCY + BATCHED WRITES: fetches up to 10 mosques at once, then
// writes ALL of that chunk's database changes in a single db.batch()
// call instead of one round-trip per mosque. This cuts D1 round-trips
// roughly in half-to-a-tenth depending on chunk size, which is the
// main lever for finishing each batch faster.
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
const CONCURRENCY = 10;

// Only does the external fetch + text extraction. No DB calls here —
// all DB writes for the whole chunk are batched together afterward.
async function fetchMosque(mosque) {
  try {
    const res = await fetch(mosque.source_url, {
      headers: { "User-Agent": "WhereWePrayingBot/1.0 (+https://wherewepraying.com)" },
    });
    if (!res.ok) {
      return { slug: mosque.slug, type: "failed", reason: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const text = htmlToText(html);
    const times = extractJamaahTimes(text);

    if (!isConfident(times)) {
      return { slug: mosque.slug, type: "skipped", found: times };
    }
    return { slug: mosque.slug, type: "updated", times };
  } catch (e) {
    return { slug: mosque.slug, type: "failed", reason: String(e) };
  }
}

// Builds the D1 statements needed for one mosque's outcome.
function statementsFor(db, outcome, dateIso, nowIso) {
  const stmts = [];
  if (outcome.type === "failed") {
    stmts.push(
      db.prepare(
        `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = consecutive_failures + 1 WHERE slug = ?2`
      ).bind(nowIso, outcome.slug)
    );
  } else if (outcome.type === "skipped") {
    stmts.push(
      db.prepare(
        `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = 0 WHERE slug = ?2`
      ).bind(nowIso, outcome.slug)
    );
  } else if (outcome.type === "updated") {
    stmts.push(
      db.prepare(
        `UPDATE mosques SET last_scraped_at = ?1, consecutive_failures = 0 WHERE slug = ?2`
      ).bind(nowIso, outcome.slug)
    );
    stmts.push(
      db.prepare(
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
        outcome.slug, dateIso,
        outcome.times.fajr, outcome.times.zuhr, outcome.times.asr, outcome.times.maghrib, outcome.times.isha,
        nowIso
      )
    );
  }
  return stmts;
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

    // Step 1: fetch all mosques in this chunk concurrently (no DB writes yet)
    const outcomes = await Promise.all(chunk.map((m) => fetchMosque(m)));

    // Step 2: build every statement for the whole chunk, then send them
    // to D1 in ONE batch call instead of one round-trip per mosque.
    const nowIso = new Date().toISOString();
    const allStatements = [];
    for (const outcome of outcomes) {
      allStatements.push(...statementsFor(db, outcome, dateIso, nowIso));
    }
    if (allStatements.length > 0) {
      await db.batch(allStatements);
    }

    for (const outcome of outcomes) {
      if (outcome.type === "updated") report.updated.push(outcome);
      else if (outcome.type === "skipped") report.skipped.push(outcome);
      else report.failed.push(outcome);
    }
  }

  return json(report);
}

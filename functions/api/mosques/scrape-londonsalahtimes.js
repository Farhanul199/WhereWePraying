// functions/api/mosques/scrape-londonsalahtimes.js
//
// Admin-only (X-Broadcast-Key, same as scrape.js). Fetches the daily
// aggregated JSON feed from londonsalahtimes.live/today.json, which
// covers ~682 mosques across London and other UK cities, and writes
// today's Jama'ah times into thm_jamaah_times.
//
// BATCHED WRITES: instead of one D1 round-trip per mosque (~680 of
// them), statements are grouped into chunks of 25 and sent via
// db.batch() — far fewer round-trips, much faster to finish.
//
// This complements scrape.js (which scrapes each mosque's own site
// individually). Run this FIRST in the daily cron sequence so it
// establishes broad baseline coverage, then let scrape.js overwrite
// with more precise per-mosque data where it succeeds.
//
// Trigger: called by the same Cron Worker as scrape.js (see
// /cron-worker in the repo root). You can also call it manually:
//   curl -X POST https://wherewepraying.com/api/mosques/scrape-londonsalahtimes \
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

const WRITE_CHUNK_SIZE = 25;

export async function onRequestPost(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;
  const dateIso = londonTodayIso();

  const report = { date: dateIso, total: 0, updated: [], skipped: [], failed: [] };

  let feed;
  try {
    const res = await fetch("https://londonsalahtimes.live/today.json", {
      headers: { "User-Agent": "WhereWePrayingBot/1.0 (+https://wherewepraying.com)" },
    });
    if (!res.ok) {
      return json({ error: `Failed to fetch londonsalahtimes.live: HTTP ${res.status}` }, 502);
    }
    feed = await res.json();
  } catch (e) {
    return json({ error: "Failed to fetch or parse londonsalahtimes.live", detail: String(e) }, 502);
  }

  const masjids = feed.masjids || [];
  report.total = masjids.length;

  // Only touch mosques that already exist in our own mosques table,
  // so this never creates orphan rows in thm_jamaah_times.
  const { results: existingRows } = await db.prepare(
    `SELECT slug FROM mosques WHERE active = 1`
  ).all();
  const existingSlugs = new Set((existingRows || []).map((r) => r.slug));

  const nowIso = new Date().toISOString();
  const pendingStatements = [];

  const flush = async () => {
    if (pendingStatements.length === 0) return;
    await db.batch(pendingStatements.splice(0, pendingStatements.length));
  };

  for (const m of masjids) {
    if (!existingSlugs.has(m.id)) {
      report.skipped.push({ slug: m.id, reason: "not_in_mosques_table" });
      continue;
    }
    if (m.status !== "ok") {
      report.skipped.push({ slug: m.id, reason: `status_${m.status}` });
      continue;
    }
    const jt = m.jamaat_times || {};
    const hasAll = jt.fajr && jt.dhuhr && jt.asr && jt.maghrib && jt.isha;
    if (!hasAll) {
      report.skipped.push({ slug: m.id, reason: "incomplete_times", found: jt });
      continue;
    }

    pendingStatements.push(
      db.prepare(
        `INSERT INTO thm_jamaah_times (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'londonsalahtimes.live', ?8)
         ON CONFLICT(mosque, date) DO UPDATE SET
           fajr_jamaah = excluded.fajr_jamaah,
           zuhr_jamaah = excluded.zuhr_jamaah,
           asr_jamaah = excluded.asr_jamaah,
           maghrib_jamaah = excluded.maghrib_jamaah,
           isha_jamaah = excluded.isha_jamaah,
           source = excluded.source,
           updated_at = excluded.updated_at`
      ).bind(m.id, dateIso, jt.fajr, jt.dhuhr, jt.asr, jt.maghrib, jt.isha, nowIso)
    );
    report.updated.push({ slug: m.id, times: jt });

    if (pendingStatements.length >= WRITE_CHUNK_SIZE) {
      try {
        await flush();
      } catch (e) {
        report.failed.push({ reason: String(e), note: "batch_flush_failed" });
      }
    }
  }

  // Flush any remaining statements after the loop ends
  try {
    await flush();
  } catch (e) {
    report.failed.push({ reason: String(e), note: "final_flush_failed" });
  }

  return json(report);
}

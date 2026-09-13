// functions/api/admin/sync-thm-jamaah.js
//
// Authorized scraper for Tower Hamlets Mosques Jama'ah times (see approval
// email from Ahmed, Towerhamletsmosques). Runs entirely on Cloudflare -
// no local PC/terminal needed. Trigger by visiting the URL in a browser.
//
// v2: batches all of a day's D1 writes into a single .batch() call instead
// of one .run() per mosque, to stay well under Cloudflare's per-invocation
// subrequest limit. This lets each visit cover a much bigger date range.
//
// v3: writes into jamaah_raw / jummah_raw (the raw inboxes) under source
// 'thm_scrape' and registers THM's mosque codes on the translator sheet
// (mosque_sources). The fused thm_jamaah_times / jummah_times views then
// show these times for the correct official mosque automatically.
//
// USAGE - prefer curl with a header (query-string secrets end up in
// Cloudflare's request logs and your browser history):
//   curl "https://wherewepraying.com/api/admin/sync-thm-jamaah?start=1&end=120" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"
//
// Header only, no ?secret= fallback — a query-string secret ends up in
// Cloudflare's request logs and your browser history, so pasting the URL
// into a browser no longer works here; use curl with the header above.
//
// Suggested ranges (4 visits should cover the full year now):
//   start=1&end=120
//   start=121&end=240
//   start=241&end=366
//   (run start=1&end=366 in one go if it completes without timing out -
//    try a smaller range first if you're not sure)

import { isSyncRequest } from '../../_lib/auth.js';
import { logSyncRun } from '../../_lib/synclog.js';

const YEAR = 2026;
const SOURCE_URL = "https://www.towerhamletsmosques.co.uk/wp-content/themes/squared/masajid-files/request.php?showJumma=true";
const PRAYERS = ["fajr", "zuhr", "asr", "maghrib", "isha"];
const SKIP_KEYS = new Set(["date", "date1", "strtotime", "selectedDate", "salah", "alaqsa"]);
const EXCLUDED_MOSQUES = new Set(["imamiamissionlondon"]); // per instruction: always excluded

function extractJamaahTimes(html) {
  if (!html) return null;
  const times = {};
  for (const prayer of PRAYERS) {
    const re = new RegExp(
      `<tr id="${prayer}"[^>]*>[\s\S]*?<td class="prayer-jamaah"[^>]*>\s*<span[^>]*>([^<]*)</span>`,
      "i"
    );
    const match = html.match(re);
    times[`${prayer}_jamaah`] = match && match[1].trim() ? match[1].trim() : null;
  }
  return times;
}

function dayOfYearToDate(year, dayOfYear) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + (dayOfYear - 1));
  return d;
}

const UPSERT_SQL = `
  INSERT INTO jamaah_raw
    (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
  VALUES ('thm_scrape', ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, source_ref, date) DO UPDATE SET
    fajr_jamaah=excluded.fajr_jamaah,
    zuhr_jamaah=excluded.zuhr_jamaah,
    asr_jamaah=excluded.asr_jamaah,
    maghrib_jamaah=excluded.maghrib_jamaah,
    isha_jamaah=excluded.isha_jamaah,
    updated_at=excluded.updated_at
  WHERE
    fajr_jamaah    IS NOT excluded.fajr_jamaah OR
    zuhr_jamaah    IS NOT excluded.zuhr_jamaah OR
    asr_jamaah     IS NOT excluded.asr_jamaah OR
    maghrib_jamaah IS NOT excluded.maghrib_jamaah OR
    isha_jamaah    IS NOT excluded.isha_jamaah
`;

const JUMMAH_UPSERT_SQL = `
  INSERT INTO jummah_raw (source, source_ref, date, slot, time, updated_at)
  VALUES ('thm_scrape', ?, ?, ?, ?, ?)
  ON CONFLICT(source, source_ref, date, slot) DO UPDATE SET
    time=excluded.time,
    updated_at=excluded.updated_at
  WHERE time IS NOT excluded.time
`;

// Registers THM's mosque codes on the translator sheet (mosque_sources).
// THM gives us only a code, no display name, so name stays NULL here;
// the admin matching page links the code to the official mosque.
const REGISTER_SOURCE_SQL = `
  INSERT INTO mosque_sources (source, source_ref, name, first_seen, last_seen)
  VALUES ('thm_scrape', ?, NULL, ?, ?)
  ON CONFLICT(source, source_ref) DO UPDATE SET
    last_seen = excluded.last_seen
`;

// Best-effort Jummah extraction from the THM page (it is requested with
// showJumma=true). Looks for a row whose id mentions jummah/jumuah/jumma
// and pulls every time-looking value out of it. If THM's markup has no
// such row for a mosque, nothing is written - no harm done.
function extractJummahTimes(html) {
  if (!html) return [];
  const times = [];
  const rowRe = /<tr id="[^"]*ju[mm][mu][au]h?[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) {
    const cellRe = />(\s*\d{1,2}[:.]\d{2}\s*)</g;
    let c;
    while ((c = cellRe.exec(m[1]))) times.push(c[1].trim().replace(".", ":"));
  }
  return [...new Set(times)];
}

function isFridayIso(dateIso) {
  return new Date(dateIso + "T12:00:00Z").getUTCDay() === 5;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isSyncRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = parseInt(url.searchParams.get("start") || "1", 10);
  const end = parseInt(url.searchParams.get("end") || "40", 10);

  const results = { processed: [], failed: [], recordsSaved: 0 };

  const startedAt = new Date().toISOString();
  const nowIso = startedAt;
  const seenRefs = new Set();

  for (let doy = start; doy <= end; doy++) {
    const date = dayOfYearToDate(YEAR, doy);
    if (date.getUTCFullYear() !== YEAR) break;

    const monthAbbr = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = date.getUTCDate();
    const dateIso = date.toISOString().slice(0, 10);

    try {
      const resp = await fetch(SOURCE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "WhereWePraying-DataSync/1.0 (authorized by Towerhamletsmosques)",
        },
        body: `selectedMonth=${monthAbbr}&selectedDay=${day}`,
      });

      if (!resp.ok) {
        results.failed.push({ date: dateIso, status: resp.status });
        continue;
      }

      const data = await resp.json();

      const statements = [];
      for (const [mosqueSlug, html] of Object.entries(data)) {
        if (SKIP_KEYS.has(mosqueSlug)) continue;
        if (EXCLUDED_MOSQUES.has(mosqueSlug)) continue;

        const times = extractJamaahTimes(html);
        if (!times) continue;

        seenRefs.add(mosqueSlug);

        statements.push(
          env.DB.prepare(UPSERT_SQL).bind(
            mosqueSlug,
            dateIso,
            times.fajr_jamaah,
            times.zuhr_jamaah,
            times.asr_jamaah,
            times.maghrib_jamaah,
            times.isha_jamaah,
            nowIso
          )
        );

        // Jummah times only make sense on Fridays - save them there.
        if (isFridayIso(dateIso)) {
          extractJummahTimes(html).forEach((time, i) => {
            statements.push(
              env.DB.prepare(JUMMAH_UPSERT_SQL).bind(mosqueSlug, dateIso, i + 1, time, nowIso)
            );
          });
        }
      }

      if (statements.length > 0) {
        await env.DB.batch(statements); // single subrequest for the whole day
        results.recordsSaved += statements.length;
      }

      results.processed.push(dateIso);
    } catch (e) {
      results.failed.push({ date: dateIso, error: String(e) });
    }
  }

  // One registration pass for every THM code seen this run.
  const regs = [...seenRefs].map((ref) =>
    env.DB.prepare(REGISTER_SOURCE_SQL).bind(ref, nowIso, nowIso)
  );
  for (let i = 0; i < regs.length; i += 100) {
    await env.DB.batch(regs.slice(i, i + 100));
  }

  const finishedAt = new Date().toISOString();
  await logSyncRun(env.DB, {
    source: "thm_scrape",
    startedAt,
    finishedAt,
    dateFrom: results.processed[0] || null,
    dateTo: results.processed[results.processed.length - 1] || null,
    itemsAttempted: results.processed.length + results.failed.length,
    itemsOk: results.processed.length,
    itemsFailed: results.failed.length,
    rowsWritten: results.recordsSaved,
    gaps: [], // THM is date-based, not per-mosque - no gap list here
    errors: results.failed,
  });

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

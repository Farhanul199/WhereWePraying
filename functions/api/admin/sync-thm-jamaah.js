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
// USAGE - visit in browser (swap in your secret):
//   https://wherewepraying.com/api/admin/sync-thm-jamaah?secret=YOUR_SYNC_SECRET&start=1&end=120
//
// Suggested ranges (4 visits should cover the full year now):
//   start=1&end=120
//   start=121&end=240
//   start=241&end=366
//   (run start=1&end=366 in one go if it completes without timing out -
//    try a smaller range first if you're not sure)

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
      `<tr id="${prayer}"[^>]*>[\\s\\S]*?<td class="prayer-jamaah"[^>]*>\\s*<span[^>]*>([^<]*)</span>`,
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
  INSERT INTO thm_jamaah_times
    (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(mosque, date) DO UPDATE SET
    fajr_jamaah=excluded.fajr_jamaah,
    zuhr_jamaah=excluded.zuhr_jamaah,
    asr_jamaah=excluded.asr_jamaah,
    maghrib_jamaah=excluded.maghrib_jamaah,
    isha_jamaah=excluded.isha_jamaah
`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const secret = url.searchParams.get("secret");
  if (!secret || secret !== env.SYNC_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = parseInt(url.searchParams.get("start") || "1", 10);
  const end = parseInt(url.searchParams.get("end") || "40", 10);

  const results = { processed: [], failed: [], recordsSaved: 0 };

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

        statements.push(
          env.DB.prepare(UPSERT_SQL).bind(
            mosqueSlug,
            dateIso,
            times.fajr_jamaah,
            times.zuhr_jamaah,
            times.asr_jamaah,
            times.maghrib_jamaah,
            times.isha_jamaah
          )
        );
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

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

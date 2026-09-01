// functions/api/admin/sync-thm-jamaah.js
//
// Authorized scraper for Tower Hamlets Mosques Jama'ah times (see approval
// email from Ahmed, Towerhamletsmosques). Runs entirely on Cloudflare -
// no local PC/terminal needed. Trigger by visiting the URL in a browser.
//
// SETUP (one-time, all via dashboards/GitHub web UI - no terminal):
//
// 1. In Cloudflare D1 Console, run this SQL to create the table:
//
//    CREATE TABLE IF NOT EXISTS thm_jamaah_times (
//      id INTEGER PRIMARY KEY AUTOINCREMENT,
//      mosque TEXT NOT NULL,
//      date TEXT NOT NULL,
//      fajr_jamaah TEXT,
//      zuhr_jamaah TEXT,
//      asr_jamaah TEXT,
//      maghrib_jamaah TEXT,
//      isha_jamaah TEXT,
//      UNIQUE(mosque, date)
//    );
//
// 2. Upload this file to your repo at:
//      functions/api/admin/sync-thm-jamaah.js
//    (via GitHub web upload, same as always - auto-deploys)
//
// 3. In Cloudflare Pages > Settings > Environment Variables, add a secret:
//      SYNC_SECRET = (pick any password, e.g. a long random string)
//
// 4. Once deployed, visit this URL in your browser to run it:
//      https://wherewepraying.com/api/admin/sync-thm-jamaah?secret=YOUR_SYNC_SECRET&start=1&end=40
//
//    IMPORTANT: Cloudflare Functions have a request time limit, so this
//    processes a RANGE of days per visit (day-of-year numbers), not all
//    366 at once. Run it ~10 times, changing start/end each time:
//
//      start=1&end=40      (Jan 1 - Feb 9)
//      start=41&end=80
//      start=81&end=120
//      start=121&end=160
//      start=161&end=200
//      start=201&end=240
//      start=241&end=280
//      start=281&end=320
//      start=321&end=366
//
//    Just change the numbers in the browser address bar and hit enter each
//    time. Each visit takes ~1-2 minutes. It's safe to re-run a range twice
//    (it overwrites, doesn't duplicate).
//
// 5. When done, all Jama'ah times for 2026 are in the thm_jamaah_times
//    table in D1, ready to query from your app.

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
    if (date.getUTCFullYear() !== YEAR) break; // ran past Dec 31

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

      for (const [mosqueSlug, html] of Object.entries(data)) {
        if (SKIP_KEYS.has(mosqueSlug)) continue;
        if (EXCLUDED_MOSQUES.has(mosqueSlug)) continue;

        const times = extractJamaahTimes(html);
        if (!times) continue;

        await env.DB.prepare(
          `INSERT INTO thm_jamaah_times
             (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(mosque, date) DO UPDATE SET
             fajr_jamaah=excluded.fajr_jamaah,
             zuhr_jamaah=excluded.zuhr_jamaah,
             asr_jamaah=excluded.asr_jamaah,
             maghrib_jamaah=excluded.maghrib_jamaah,
             isha_jamaah=excluded.isha_jamaah`
        )
          .bind(
            mosqueSlug,
            dateIso,
            times.fajr_jamaah,
            times.zuhr_jamaah,
            times.asr_jamaah,
            times.maghrib_jamaah,
            times.isha_jamaah
          )
          .run();

        results.recordsSaved++;
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

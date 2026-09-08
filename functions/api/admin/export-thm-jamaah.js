// functions/api/admin/export-thm-jamaah.js
//
// Dumps the mosques + thm_jamaah_times tables as JSON for external use
// (e.g. seeding a second, mosque-finder-only website without re-scraping).
// Paginated by day-of-year range, same pattern as the sync tool, to stay
// under response size limits.
//
// USAGE - prefer curl with a header (query-string secrets end up in
// Cloudflare's request logs and your browser history):
//   curl "https://wherewepraying.com/api/admin/export-thm-jamaah?start=1&end=366&mosques=1" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"
//   &mosques=1   -> include the mosques table once (add to any one call)
//
// Header only, no ?secret= fallback — same reasoning as sync-thm-jamaah.js.
// Reuses the same SYNC_SECRET as the sync tool - no extra setup needed.

import { isSyncRequest } from '../../_lib/auth.js';

const YEAR = 2026;

function dayOfYearToDate(year, dayOfYear) {
  const d = new Date(Date.UTC(year, 0, 1));
  d.setUTCDate(d.getUTCDate() + (dayOfYear - 1));
  return d;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isSyncRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = parseInt(url.searchParams.get("start") || "1", 10);
  const end = parseInt(url.searchParams.get("end") || "366", 10);
  const includeMosques = url.searchParams.get("mosques") === "1";

  const startDate = dayOfYearToDate(YEAR, start).toISOString().slice(0, 10);
  const endDate = dayOfYearToDate(YEAR, end).toISOString().slice(0, 10);

  const output = {};

  if (includeMosques) {
    const { results: mosques } = await env.DB.prepare(
      `SELECT slug, name, active FROM mosques ORDER BY name ASC`
    ).all();
    output.mosques = mosques || [];
  }

  const { results: records } = await env.DB.prepare(
    `SELECT mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah
     FROM thm_jamaah_times
     WHERE date >= ? AND date <= ?
     ORDER BY date ASC, mosque ASC`
  )
    .bind(startDate, endDate)
    .all();

  output.range = { start: startDate, end: endDate };
  output.records = records || [];
  output.count = output.records.length;

  return new Response(JSON.stringify(output), {
    headers: { "Content-Type": "application/json" },
  });
}

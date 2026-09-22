// functions/api/admin/build-r2-cache.js
//
// WAS: a twice-daily job that read every mosque out of the database and
// wrote one global JSON file of the whole world for visitors to download.
// That file grew with every mosque added and was the reason coverage had
// to be rationed.
//
// NOW: visitors are served per area, on demand, straight from each
// mosque's own stored timetable (see functions/_lib/area-times.js), so
// the global file isn't needed at all. This endpoint is kept — the cron
// Worker and the admin "Update the live site now" button both call it —
// and does the two jobs that are still worth doing:
//
//   1. Prepares month pages for promoted mosques nobody has looked at
//      yet, and rolls everyone into the next month as it comes around.
//      (Areas with real visitors prepare themselves; this just keeps the
//      quiet corners warm.)
//   2. Reports what's left to prepare, so the admin page can show
//      progress. Promotions appear as each area's cache rolls over
//      (about an hour), with no global rebuild to wait for.
//
// Auth: cron Worker sends X-Sync-Key; the admin page sends X-Broadcast-Key.
//
// Optional ?limit=N (admin only, default 60, capped at 500 - see the
// Math.min inside prepareMonths/prepareDailySourceMonths) - the twice-
// daily cron always uses the default, gentle 60. The admin "Recompile
// all mosques now" button on Sources passes a bigger limit and calls
// this in a loop until nothing is left, so a full re-merge (e.g. after
// a merge-logic change) doesn't take 80+ days of waiting for cron.

import { isSyncRequest, isAdminRequest } from '../../_lib/auth.js';
import { prepareMonths, prepareDailySourceMonths, ensureTimesSchema, londonNowParts } from '../../_lib/area-times.js';

export async function onRequestGet(context) {
  const { env } = context;

  if (!isSyncRequest(context) && !isAdminRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(context.request.url);
  const limitParam = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 60;

  const { dateIso } = londonNowParts();

  let timesPrepared = null;
  try {
    await ensureTimesSchema(env.DB);
    timesPrepared = await prepareMonths(env.DB, limit);
  } catch (e) {
    timesPrepared = { error: String(e).slice(0, 200) };
  }

  // Safety net for MasjidBox/MyMasjid (daily-row sources): every real
  // sync already recompiles the exact mosques it touches the moment it
  // writes (see recompileForSourceRefs in area-times.js), so this
  // should normally find nothing left to do. Kept as a twice-daily
  // backstop for anything a write-time hook ever misses - a failed
  // recompile call, a sync that errored after writing, etc.
  let dailyTimesPrepared = null;
  try {
    dailyTimesPrepared = await prepareDailySourceMonths(env.DB, limit);
  } catch (e) {
    dailyTimesPrepared = { error: String(e).slice(0, 200) };
  }

  return new Response(JSON.stringify({
    ok: true, date: dateIso, limit, timesPrepared, dailyTimesPrepared,
    note: "Per-area serving is live; no global mosque file is built any more. New mosques appear as each area's cache rolls over (within about an hour).",
  }), { headers: { "Content-Type": "application/json" } });
}

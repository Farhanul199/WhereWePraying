// functions/api/admin/sync-status.js
//
// Admin-only (X-Broadcast-Key). Reads the sync_runs logbook and returns a
// simple health summary per source for /admin/sync-status.html.
//
// GET /api/admin/sync-status
//   -> { sources: [ { source, last_run, expected_every_hours, status,
//                     items_attempted, items_ok, items_failed,
//                     rows_written, gaps, errors }, ... ],
//        recent: [ ...last 30 raw runs across all sources... ] }
//
// status is one of:
//   'ok'      - ran recently and had no failed items
//   'warning' - ran recently but some items failed, or has coverage gaps
//   'error'   - ran recently but everything failed
//   'stale'   - hasn't run inside its expected window at all

import { isAdminRequest } from '../../_lib/auth.js';

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// How often each robot is supposed to run. Used only to flag "stale".
const EXPECTED_HOURS = {
  thm_scrape: 24 * 8,       // run manually every so often, be lenient
  masjidbox_scrape: 26,     // daily cron
  mymasjid_scrape: 26,      // daily cron
};

const LABELS = {
  thm_scrape: "Tower Hamlets Mosques",
  masjidbox_scrape: "MasjidBox",
  mymasjid_scrape: "MyMasjid",
};

function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;

  try {
    const { results: recent } = await db
      .prepare(
        `SELECT source, started_at, finished_at, date_from, date_to,
                items_attempted, items_ok, items_failed, rows_written,
                gaps_count, gaps_json, errors_json
         FROM sync_runs ORDER BY started_at DESC LIMIT 30`
      )
      .all();

    const sources = [];
    for (const source of Object.keys(LABELS)) {
      const last = await db
        .prepare(
          `SELECT started_at, finished_at, date_from, date_to,
                  items_attempted, items_ok, items_failed, rows_written,
                  gaps_count, gaps_json, errors_json
           FROM sync_runs WHERE source = ?1 ORDER BY started_at DESC LIMIT 1`
        )
        .bind(source)
        .first();

      let status = "stale";
      if (last) {
        const stale = hoursSince(last.started_at) > EXPECTED_HOURS[source];
        if (stale) status = "stale";
        else if (last.items_ok === 0 && last.items_attempted > 0) status = "error";
        else if (last.items_failed > 0 || last.gaps_count > 0) status = "warning";
        else status = "ok";
      }

      sources.push({
        source,
        label: LABELS[source],
        last_run: last ? last.started_at : null,
        date_from: last ? last.date_from : null,
        date_to: last ? last.date_to : null,
        items_attempted: last ? last.items_attempted : 0,
        items_ok: last ? last.items_ok : 0,
        items_failed: last ? last.items_failed : 0,
        rows_written: last ? last.rows_written : 0,
        gaps: last && last.gaps_json ? JSON.parse(last.gaps_json) : [],
        errors: last && last.errors_json ? JSON.parse(last.errors_json) : [],
        status,
      });
    }

    return json({ sources, recent: recent || [] });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

// functions/_lib/synclog.js
//
// Shared helper so every prayer-time sync (THM, MasjidBox, MyMasjid) writes
// a matching logbook entry into sync_runs. The status dashboard reads this
// table to show what each robot did on its last run.
//
// Usage inside a sync file:
//   import { logSyncRun } from '../../_lib/synclog.js';
//   ...
//   await logSyncRun(env.DB, {
//     source: 'thm_scrape',
//     startedAt, finishedAt,
//     dateFrom, dateTo,
//     itemsAttempted, itemsOk, itemsFailed,
//     rowsWritten,
//     gaps,     // array of item labels that produced zero rows
//     errors,   // array of { ...whatever failed... }
//   });
//
// Never throws — a logging failure should never break the sync itself.

export async function logSyncRun(db, entry) {
  try {
    const gaps = Array.isArray(entry.gaps) ? entry.gaps.slice(0, 50) : [];
    const errors = Array.isArray(entry.errors) ? entry.errors.slice(0, 50) : [];
    await db
      .prepare(
        `INSERT INTO sync_runs
           (source, started_at, finished_at, date_from, date_to,
            items_attempted, items_ok, items_failed, rows_written,
            gaps_count, gaps_json, errors_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
      )
      .bind(
        String(entry.source || "unknown"),
        String(entry.startedAt || new Date().toISOString()),
        String(entry.finishedAt || new Date().toISOString()),
        entry.dateFrom || null,
        entry.dateTo || null,
        entry.itemsAttempted || 0,
        entry.itemsOk || 0,
        entry.itemsFailed || 0,
        entry.rowsWritten || 0,
        gaps.length,
        gaps.length ? JSON.stringify(gaps) : null,
        errors.length ? JSON.stringify(errors) : null
      )
      .run();
  } catch (e) {
    // Logging is best-effort. Swallow so a broken logbook never breaks
    // the actual prayer-time sync.
  }
}

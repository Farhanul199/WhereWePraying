// functions/_lib/clock-refresh.js
//
// Shared helpers for the twice-a-year clock-change re-check.
//
// The clock-change-refresher Worker (workers/clock-change-refresher) sets
// source_discoveries.refresh_due_at on every mosque with live times in a
// country whose clocks just changed. Each source's mode=times then picks
// those rows up (?due=1 picks ONLY them) and clears the flag once tried.
//
// Rule: a re-check never makes things worse. If a flagged mosque that
// already has good times comes back failed / empty, the good times stay.

// Append to the WHERE of any "mark failed / no_data" UPDATE.
export const KEEP_GOOD = ` AND NOT (times_status = 'ok' AND refresh_due_at IS NOT NULL)`;

let columnReady = false;
export async function ensureDueColumn(db) {
  if (columnReady) return;
  try { await db.prepare('ALTER TABLE source_discoveries ADD COLUMN refresh_due_at TEXT').run(); } catch (e) {}
  columnReady = true;
}

// Refs of flagged rows that are now due, oldest first.
export async function pickDue(db, source, limit) {
  const { results } = await db.prepare(
    `SELECT source_ref FROM source_discoveries
      WHERE source = ?1 AND refresh_due_at IS NOT NULL AND refresh_due_at <= ?2
      ORDER BY refresh_due_at LIMIT ?3`
  ).bind(source, new Date().toISOString(), limit).all();
  return (results || []).map((r) => r.source_ref);
}

// Clear the flag for refs that were tried (whatever the result).
export async function clearDue(db, source, refs) {
  if (!refs || !refs.length) return;
  const stmts = [];
  for (let i = 0; i < refs.length; i += 50) {
    const part = refs.slice(i, i + 50);
    const ph = part.map((_, j) => '?' + (j + 2)).join(',');
    stmts.push(db.prepare(
      `UPDATE source_discoveries SET refresh_due_at = NULL WHERE source = ?1 AND source_ref IN (${ph})`
    ).bind(source, ...part));
  }
  await db.batch(stmts);
}

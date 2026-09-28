// functions/api/admin/reports.js
// Review queue for Community reports (27 Sep 2026). Used by
// /admin/reports.html. Needs X-Broadcast-Key.
//
// GET  ?status=open|actioned|dismissed|all   (default open)
//      -> { reports: [...] } grouped per reported item, newest first,
//         with how many people reported it and whether it still exists.
// GET  ?status=banned -> { banned: [{ id, username, email, banned_at }] }
// POST { action:'unban', userId }
// POST { targetType, targetId, decision }
//      decision: 'dismiss'    -> keep the post, close its reports
//                'remove'     -> delete the post, close its reports
//                'remove_ban' -> delete the post + ban its author from posting
//      All open reports on that item are closed together.

import { isAdminRequest } from '../../_lib/auth.js';

const TABLES = { idea: 'community_ideas', comment: 'community_comments' };

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(context.request.url);
  const status = url.searchParams.get('status') || 'open';
  const db = context.env.DB;

  // Banned accounts list (28 Sep 2026).
  if (status === 'banned') {
    try {
      const { results } = await db.prepare(
        `SELECT id, username, email, banned_at FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 500`
      ).all();
      return json({ banned: results || [] });
    } catch (e) {
      console.error('banned list failed', e);
      return json({ error: 'Failed to load banned accounts.' }, 500);
    }
  }

  try {
    const where = status === 'all' ? '' : 'WHERE r.status = ?1';
    const stmt = db.prepare(
      `SELECT r.target_type, r.target_id,
              COUNT(*) AS report_count,
              GROUP_CONCAT(DISTINCT r.reason) AS reasons,
              MAX(r.created_at) AS last_reported,
              MIN(r.status) AS status,
              MAX(r.content_snapshot) AS snapshot,
              MAX(r.target_user_id) AS author_id,
              GROUP_CONCAT(r.details, ' | ') AS details
       FROM content_reports r ${where}
       GROUP BY r.target_type, r.target_id
       ORDER BY last_reported DESC
       LIMIT 200`
    );
    const { results } = await (status === 'all' ? stmt : stmt.bind(status)).all();
    const rows = results || [];

    // Author name/ban state and whether the post still exists.
    for (const r of rows) {
      const author = r.author_id
        ? await db.prepare(`SELECT username, email, banned_at FROM users WHERE id = ?1`).bind(r.author_id).first()
        : null;
      r.author = author ? (author.username || author.email) : 'Deleted user';
      r.author_banned = !!(author && author.banned_at);
      const table = TABLES[r.target_type];
      r.still_exists = table
        ? !!(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?1`).bind(r.target_id).first())
        : false;
      delete r.author_id; // not needed in the browser
    }
    return json({ reports: rows });
  } catch (e) {
    console.error('admin reports list failed', e);
    const missing = /no such table/i.test(String(e));
    return json({ error: missing ? 'Run migrations/008_reports_blocks.sql first.' : 'Failed to load reports.' }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const db = context.env.DB;

  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'Invalid body' }, 400); }

  if (body.action === 'unban') {
    const userId = String(body.userId || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(userId)) return json({ error: 'Invalid user' }, 400);
    try {
      await db.prepare(`UPDATE users SET banned_at = NULL WHERE id = ?1`).bind(userId).run();
      return json({ success: true });
    } catch (e) {
      console.error('unban failed', e);
      return json({ error: 'Failed to unban.' }, 500);
    }
  }

  const table = TABLES[body.targetType];
  const targetId = parseInt(body.targetId, 10);
  const decision = body.decision;
  if (!table || !Number.isInteger(targetId) || !['dismiss', 'remove', 'remove_ban'].includes(decision)) {
    return json({ error: 'Invalid request' }, 400);
  }

  try {
    const now = Date.now();
    const report = await db.prepare(
      `SELECT MAX(target_user_id) AS author_id FROM content_reports WHERE target_type = ?1 AND target_id = ?2`
    ).bind(body.targetType, targetId).first();
    const authorId = report && report.author_id;

    const stmts = [];
    if (decision !== 'dismiss') {
      if (body.targetType === 'idea') {
        stmts.push(db.prepare(`DELETE FROM community_votes WHERE idea_id = ?1`).bind(targetId));
        stmts.push(db.prepare(`DELETE FROM community_comments WHERE idea_id = ?1`).bind(targetId));
        stmts.push(db.prepare(`DELETE FROM community_ideas WHERE id = ?1`).bind(targetId));
      } else {
        stmts.push(db.prepare(`DELETE FROM community_comments WHERE id = ?1 OR parent_id = ?1`).bind(targetId));
      }
    }
    if (decision === 'remove_ban' && authorId) {
      stmts.push(db.prepare(`UPDATE users SET banned_at = ?1 WHERE id = ?2`).bind(now, authorId));
    }
    stmts.push(db.prepare(
      `UPDATE content_reports SET status = ?1, reviewed_at = ?2
       WHERE target_type = ?3 AND target_id = ?4 AND status = 'open'`
    ).bind(decision === 'dismiss' ? 'dismissed' : 'actioned', now, body.targetType, targetId));

    await db.batch(stmts);
    return json({ success: true });
  } catch (e) {
    console.error('admin report decision failed', e);
    return json({ error: 'Failed to apply decision.' }, 500);
  }
}

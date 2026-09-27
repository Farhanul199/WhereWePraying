// functions/api/community/report.js
// Report + block for Community Ideas (added 27 Sep 2026 — Google Play and
// Apple both require UGC apps to let users report content and block users).
//
// All actions need a signed-in user.
//
// POST { action:'report', targetType:'idea'|'comment', targetId, reason, details? }
//      -> files a report. Same person can't report the same item twice.
//         An item with 3+ open reports is hidden from everyone until you
//         review it in /admin/reports.html.
// POST { action:'block', targetType:'idea'|'comment', targetId }
//      -> blocks whoever wrote that item. Works from content, so no user
//         IDs are ever sent to the browser.
// POST { action:'unblock', blockId }
// GET  -> { blocks: [{ id, username, created_at }] }  (your own block list)
//
// Tables: migrations/008_reports_blocks.sql

import { resolveSession } from '../../_lib/session.js';

const TARGETS = {
  idea: { table: 'community_ideas', text: "title || ' — ' || COALESCE(body, '')" },
  comment: { table: 'community_comments', text: 'body' },
};
const REASONS = new Set(['spam', 'abuse', 'hate', 'sexual', 'violence', 'misinformation', 'other']);

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function findTarget(db, type, id) {
  const t = TARGETS[type];
  if (!t || !Number.isInteger(id)) return null;
  return db.prepare(`SELECT user_id, ${t.text} AS text FROM ${t.table} WHERE id = ?1`).bind(id).first();
}

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT b.id, b.created_at, COALESCE(u.username, 'Deleted user') AS username
       FROM user_blocks b LEFT JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?1 ORDER BY b.created_at DESC`
    ).bind(session.userId).all();
    return json({ blocks: results || [] });
  } catch (e) {
    console.error('blocks list failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);
  const me = session.userId;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid request body.' }, 400); }
  const action = body && body.action;

  try {
    if (action === 'unblock') {
      const blockId = parseInt(body.blockId, 10);
      if (!Number.isInteger(blockId)) return json({ error: 'Invalid block.' }, 400);
      await db.prepare(`DELETE FROM user_blocks WHERE id = ?1 AND blocker_id = ?2`).bind(blockId, me).run();
      return json({ success: true });
    }

    const targetType = body.targetType;
    const targetId = parseInt(body.targetId, 10);
    const target = await findTarget(db, targetType, targetId);
    if (!target) return json({ error: "That post no longer exists." }, 404);
    if (target.user_id === me) return json({ error: "That's your own post." }, 400);

    if (action === 'report') {
      const reason = REASONS.has(body.reason) ? body.reason : null;
      if (!reason) return json({ error: 'Choose a reason.' }, 400);
      const details = String(body.details || '').trim().slice(0, 500) || null;
      await db.prepare(
        `INSERT OR IGNORE INTO content_reports
           (reporter_id, target_type, target_id, target_user_id, reason, details, content_snapshot, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', ?8)`
      ).bind(me, targetType, targetId, target.user_id || null, reason, details,
        String(target.text || '').slice(0, 2000), Date.now()).run();
      return json({ success: true });
    }

    if (action === 'block') {
      if (!target.user_id) return json({ error: "Can't block this account." }, 400);
      await db.prepare(
        `INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?1, ?2, ?3)`
      ).bind(me, target.user_id, Date.now()).run();
      return json({ success: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error('report/block failed', e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

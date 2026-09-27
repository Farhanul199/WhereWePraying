// functions/api/community/ideas.js
// GET  /api/community/ideas                    -> { ideas: [...] }
// GET  /api/community/ideas?commentsFor=<id>    -> { comments: [...] } (nested replies)
// POST /api/community/ideas   body: { title, body }                      -> create idea
// POST /api/community/ideas   body: { action:'vote', ideaId }             -> toggle vote
// POST /api/community/ideas   body: { action:'comment', ideaId, parentId, body } -> add comment/reply

import { resolveSession } from '../../_lib/session.js';

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    // Community data changes often and must always be read fresh — never let
    // a browser or intermediate cache serve a stale copy of this response.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// An idea/comment with this many open reports is hidden from everyone
// until reviewed in /admin/reports.html.
const HIDE_AFTER_REPORTS = 3;

async function viewerId(context) {
  const session = await resolveSession(context);
  return (session && session.userId) || '-';
}

// Runs the filtered query (blocks + auto-hide). If the tables from
// migrations/008_reports_blocks.sql aren't there yet, falls back to the
// plain query so the feed never breaks.
async function queryWithFallback(filtered, plain) {
  try {
    return (await filtered.all()).results || [];
  } catch (e) {
    if (!/no such (table|column)/i.test(String(e))) throw e;
    console.warn('community: run migrations/008_reports_blocks.sql', String(e));
    return (await plain.all()).results || [];
  }
}

async function isBanned(db, userId) {
  try {
    const row = await db.prepare(`SELECT banned_at FROM users WHERE id = ?1`).bind(userId).first();
    return !!(row && row.banned_at);
  } catch (e) {
    return false; // column not added yet
  }
}

async function isModerator(context, userId) {
  try {
    const row = await context.env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(userId).first();
    return !!(row && (row.role === 'admin' || row.role === 'moderator'));
  } catch (e) {
    return false;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  try {
    const commentsFor = url.searchParams.get('commentsFor');
    if (commentsFor) {
      const ideaId = parseInt(commentsFor, 10);
      if (!Number.isInteger(ideaId)) return json({ error: 'Invalid idea id' }, 400);

      const viewer = await viewerId(context);
      const rows = await queryWithFallback(
        db.prepare(
          `SELECT c.id, c.parent_id, c.body, c.created_at, u.username, (c.user_id = ?2) AS mine
           FROM community_comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.idea_id = ?1
             AND COALESCE(c.user_id, '') NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?2)
             AND (SELECT COUNT(*) FROM content_reports r
                  WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status = 'open') < ${HIDE_AFTER_REPORTS}
           ORDER BY c.created_at ASC`
        ).bind(ideaId, viewer),
        db.prepare(
          `SELECT c.id, c.parent_id, c.body, c.created_at, u.username, (c.user_id = ?2) AS mine
           FROM community_comments c
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.idea_id = ?1
           ORDER BY c.created_at ASC`
        ).bind(ideaId, viewer)
      );
      const topLevel = rows.filter((r) => !r.parent_id);
      const repliesByParent = {};
      rows.filter((r) => r.parent_id).forEach((r) => {
        (repliesByParent[r.parent_id] = repliesByParent[r.parent_id] || []).push(r);
      });
      const comments = topLevel.map((c) => ({ ...c, mine: !!c.mine,
        replies: (repliesByParent[c.id] || []).map((r) => ({ ...r, mine: !!r.mine })) }));
      return json({ comments });
    }

    const viewer = await viewerId(context);
    const cols = `i.id, i.title, i.body, i.votes, i.status, i.created_at, u.username,
         (SELECT COUNT(*) FROM community_comments c WHERE c.idea_id = i.id) AS commentCount,
         EXISTS(SELECT 1 FROM community_votes v WHERE v.idea_id = i.id AND v.user_id = ?1) AS voted,
         (i.user_id = ?1) AS mine`;
    const results = await queryWithFallback(
      db.prepare(
        `SELECT ${cols}
         FROM community_ideas i
         LEFT JOIN users u ON u.id = i.user_id
         WHERE COALESCE(i.user_id, '') NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?1)
           AND (SELECT COUNT(*) FROM content_reports r
                WHERE r.target_type = 'idea' AND r.target_id = i.id AND r.status = 'open') < ${HIDE_AFTER_REPORTS}
         ORDER BY i.votes DESC, i.created_at DESC
         LIMIT 100`
      ).bind(viewer),
      db.prepare(
        `SELECT ${cols}
         FROM community_ideas i
         LEFT JOIN users u ON u.id = i.user_id
         ORDER BY i.votes DESC, i.created_at DESC
         LIMIT 100`
      ).bind(viewer)
    );

    const ideas = results.map((r) => ({ ...r, voted: !!r.voted, mine: !!r.mine }));
    return json({ ideas });
  } catch (e) {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);
  const userId = session.userId;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const action = body.action;

  // Banned accounts can still read, but can't post ideas or comments.
  if ((action === 'comment' || !action) && await isBanned(db, userId)) {
    return json({ error: 'Your account can no longer post in Community.' }, 403);
  }

  try {
    // ---- Toggle vote ----
    if (action === 'vote') {
      const ideaId = parseInt(body.ideaId, 10);
      if (!Number.isInteger(ideaId)) return json({ error: 'Invalid idea id' }, 400);

      const existing = await db.prepare(
        `SELECT 1 FROM community_votes WHERE idea_id = ?1 AND user_id = ?2`
      ).bind(ideaId, userId).first();

      let voted;
      if (existing) {
        await db.prepare(`DELETE FROM community_votes WHERE idea_id = ?1 AND user_id = ?2`).bind(ideaId, userId).run();
        await db.prepare(`UPDATE community_ideas SET votes = MAX(0, votes - 1) WHERE id = ?1`).bind(ideaId).run();
        voted = false;
      } else {
        await db.prepare(
          `INSERT INTO community_votes (idea_id, user_id, created_at) VALUES (?1, ?2, ?3)`
        ).bind(ideaId, userId, Date.now()).run();
        await db.prepare(`UPDATE community_ideas SET votes = votes + 1 WHERE id = ?1`).bind(ideaId).run();
        voted = true;
      }

      const row = await db.prepare(`SELECT votes FROM community_ideas WHERE id = ?1`).bind(ideaId).first();
      return json({ voted, votes: row ? row.votes : 0 });
    }

    // ---- Add comment / reply ----
    if (action === 'comment') {
      const ideaId = parseInt(body.ideaId, 10);
      const parentId = body.parentId ? parseInt(body.parentId, 10) : null;
      const text = (body.body || '').trim();
      if (!Number.isInteger(ideaId)) return json({ error: 'Invalid idea id' }, 400);
      if (!text) return json({ error: 'Comment cannot be empty.' }, 400);
      if (text.length > 1000) return json({ error: 'Comment is too long.' }, 400);

      await db.prepare(
        `INSERT INTO community_comments (idea_id, parent_id, user_id, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      ).bind(ideaId, parentId, userId, text, Date.now()).run();

      return json({ success: true });
    }

    // ---- Moderator/admin: delete an inappropriate comment or reply ----
    if (action === 'delete-comment') {
      const commentId = parseInt(body.commentId, 10);
      if (!Number.isInteger(commentId)) return json({ error: 'Invalid comment id' }, 400);
      if (!(await isModerator(context, userId))) return json({ error: 'Unauthorized' }, 401);

      // Remove the comment and, if it was a top-level comment, its replies too.
      await db.prepare(`DELETE FROM community_comments WHERE id = ?1 OR parent_id = ?1`).bind(commentId).run();
      return json({ success: true });
    }

    // ---- Create a new idea ----
    const title = (body.title || '').trim();
    const ideaBody = (body.body || '').trim();
    if (!title) return json({ error: 'Title is required.' }, 400);
    if (title.length > 120) return json({ error: 'Title is too long.' }, 400);
    if (ideaBody.length > 1000) return json({ error: 'Description is too long.' }, 400);

    const result = await db.prepare(
      `INSERT INTO community_ideas (user_id, title, body, votes, status, created_at)
       VALUES (?1, ?2, ?3, 0, 'open', ?4)`
    ).bind(userId, title, ideaBody, Date.now()).run();

    return json({ success: true, id: result.meta.last_row_id });
  } catch (e) {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

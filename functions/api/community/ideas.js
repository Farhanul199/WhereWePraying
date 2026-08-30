// functions/api/community/ideas.js
// GET  /api/community/ideas                    -> { ideas: [...] }
// GET  /api/community/ideas?commentsFor=<id>    -> { comments: [...] } (nested replies)
// POST /api/community/ideas   body: { title, body }                      -> create idea
// POST /api/community/ideas   body: { action:'vote', ideaId }             -> toggle vote
// POST /api/community/ideas   body: { action:'comment', ideaId, parentId, body } -> add comment/reply

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveSession(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session='))?.split('=')[1];
    if (!sessionId) return null;
    const raw = await context.env.SESSIONS.get(sessionId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) return null;
    return session;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  const commentsFor = url.searchParams.get('commentsFor');
  if (commentsFor) {
    const ideaId = parseInt(commentsFor, 10);
    if (!Number.isInteger(ideaId)) return json({ error: 'Invalid idea id' }, 400);

    const { results } = await db.prepare(
      `SELECT c.id, c.parent_id, c.body, c.created_at, u.username
       FROM community_comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.idea_id = ?1
       ORDER BY c.created_at ASC`
    ).bind(ideaId).all();

    const rows = results || [];
    const topLevel = rows.filter((r) => !r.parent_id);
    const repliesByParent = {};
    rows.filter((r) => r.parent_id).forEach((r) => {
      (repliesByParent[r.parent_id] = repliesByParent[r.parent_id] || []).push(r);
    });
    const comments = topLevel.map((c) => ({ ...c, replies: repliesByParent[c.id] || [] }));
    return json({ comments });
  }

  const session = await resolveSession(context);
  const userId = session ? session.userId : null;

  const { results } = await db.prepare(
    `SELECT i.id, i.title, i.body, i.votes, i.status, i.created_at, u.username,
       (SELECT COUNT(*) FROM community_comments c WHERE c.idea_id = i.id) AS commentCount,
       EXISTS(SELECT 1 FROM community_votes v WHERE v.idea_id = i.id AND v.user_id = ?1) AS voted
     FROM community_ideas i
     LEFT JOIN users u ON u.id = i.user_id
     ORDER BY i.votes DESC, i.created_at DESC
     LIMIT 100`
  ).bind(userId || -1).all();

  const ideas = (results || []).map((r) => ({ ...r, voted: !!r.voted }));
  return json({ ideas });
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
}

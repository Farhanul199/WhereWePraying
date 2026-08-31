// functions/api/community/bugs.js
// POST /api/community/bugs   body: { title, body }              -> signed-in only, creates a bug report
// POST /api/community/bugs   body: { action:'review', bugId, status } -> admin only (X-Broadcast-Key)
// GET  /api/community/bugs                                       -> public feed, all bug reports (like ideas)
// GET  /api/community/bugs?status=open|resolved|dismissed|all    -> admin: full queue (X-Broadcast-Key)

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

function isAdmin(context) {
  const key = context.request.headers.get('X-Broadcast-Key');
  return !!(context.env.BROADCAST_SECRET && key === context.env.BROADCAST_SECRET);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  try {
    if (isAdmin(context)) {
      const status = url.searchParams.get('status') || 'open';
      let query = `SELECT b.id, b.title, b.body, b.status, b.created_at, b.reviewed_at, u.username, u.email
                   FROM community_bugs b LEFT JOIN users u ON u.id = b.user_id`;
      const binds = [];
      if (status !== 'all') {
        query += ` WHERE b.status = ?1`;
        binds.push(status);
      }
      query += ` ORDER BY b.created_at DESC LIMIT 200`;
      const { results } = await db.prepare(query).bind(...binds).all();
      return json({ bugs: results || [] });
    }

    // ---- Public community feed ----
    // Everyone's bug reports, newest first — visible to all, same as
    // the Feature Ideas feed. Sign-in is only required to submit one.
    const { results } = await db.prepare(
      `SELECT b.id, b.title, b.body, b.status, b.created_at, u.username
       FROM community_bugs b LEFT JOIN users u ON u.id = b.user_id
       ORDER BY b.created_at DESC LIMIT 100`
    ).all();

    return json({ bugs: results || [] });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  try {
    // ---- Admin review action ----
    if (body.action === 'review') {
      if (!isAdmin(context)) return json({ error: 'Unauthorized' }, 401);
      const bugId = parseInt(body.bugId, 10);
      const status = body.status;
      if (!Number.isInteger(bugId) || !['resolved', 'dismissed', 'open'].includes(status)) {
        return json({ error: 'Invalid review request.' }, 400);
      }
      await db.prepare(
        `UPDATE community_bugs SET status = ?1, reviewed_at = ?2 WHERE id = ?3`
      ).bind(status, Date.now(), bugId).run();
      return json({ success: true });
    }

    // ---- Signed-in user submitting a bug report ----
    const session = await resolveSession(context);
    if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

    const title = (body.title || '').trim();
    const bugBody = (body.body || '').trim();
    if (!title) return json({ error: 'Please describe the bug in a few words.' }, 400);
    if (title.length > 120) return json({ error: 'Title is too long.' }, 400);
    if (bugBody.length > 1000) return json({ error: 'Description is too long.' }, 400);

    const result = await db.prepare(
      `INSERT INTO community_bugs (user_id, title, body, status, created_at)
       VALUES (?1, ?2, ?3, 'open', ?4)`
    ).bind(session.userId, title, bugBody, Date.now()).run();

    return json({ success: true, id: result.meta.last_row_id });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

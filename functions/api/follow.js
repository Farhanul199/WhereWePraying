// functions/api/follow.js
// POST /api/follow  body: { action: 'follow'|'unfollow', targetUserId }
//
// One-way, no approval needed — like Twitter, not like the mutual
// friend-request flow in friends.js. Lets someone track/compete with
// a public leaderboard entry without needing to become mutual friends.

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

// GET /api/follow -> { followers: [{userId, username, followingBack}] }
// People who follow you, and whether you already follow them back.
export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  const db = context.env.DB;

  try {
    const rows = await db
      .prepare(
        `SELECT u.id, u.username, u.avatar_url, u.is_supporter,
                EXISTS(
                  SELECT 1 FROM follows fb
                  WHERE fb.follower_id = ?1 AND fb.followed_id = u.id
                ) AS following_back
         FROM follows f
         JOIN users u ON u.id = f.follower_id
         WHERE f.followed_id = ?1
         ORDER BY f.created_at DESC`
      )
      .bind(session.userId)
      .all();

    const followers = (rows.results || []).map((r) => ({
      userId: r.id,
      username: r.username || 'Unnamed',
      avatarUrl: r.avatar_url || null,
      isSupporter: !!r.is_supporter,
      followingBack: !!r.following_back,
    }));

    return json({ followers });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const { action, targetUserId } = body;
  if (!targetUserId) return json({ error: 'Missing targetUserId' }, 400);
  if (targetUserId === session.userId) return json({ error: "Can't follow yourself" }, 400);

  const db = context.env.DB;

  try {
    if (action === 'follow') {
      const target = await db.prepare('SELECT id FROM users WHERE id = ?').bind(targetUserId).first();
      if (!target) return json({ error: 'User not found' }, 404);

      await db
        .prepare('INSERT OR IGNORE INTO follows (follower_id, followed_id) VALUES (?, ?)')
        .bind(session.userId, targetUserId)
        .run();

      return json({ success: true, following: true });
    }

    if (action === 'unfollow') {
      await db
        .prepare('DELETE FROM follows WHERE follower_id = ? AND followed_id = ?')
        .bind(session.userId, targetUserId)
        .run();

      return json({ success: true, following: false });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

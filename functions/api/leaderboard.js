// functions/api/leaderboard.js
// POST /api/leaderboard  body: { score }  — upserts the signed-in user's score
// GET  /api/leaderboard  -> { entries: [{username, score, isYou}, ...] } ranked desc
//
// "Combined activity score" is computed client-side from Journal stats
// (streak, weekly prayer consistency, deeds logged) — see renderStats()
// in the Journal page. This endpoint just stores/ranks that number.
// Only usernames are shown, never emails — keeps friends' identities
// on the leaderboard anonymous beyond what they've chosen to share.

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

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const score = Number.isFinite(body.score) ? Math.max(0, Math.round(body.score)) : null;
  if (score === null) return json({ error: 'Invalid score' }, 400);

  const db = context.env.DB;
  await db
    .prepare(
      `INSERT INTO leaderboard_scores (user_id, score, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`
    )
    .bind(session.userId, score)
    .run();

  return json({ success: true });
}

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  const db = context.env.DB;

  // Friends (accepted) + followed users + self, with their latest
  // score (0 if never submitted). Following someone lets you compete
  // with them on this ranking even without a mutual friend request.
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, COALESCE(ls.score, 0) AS score
       FROM users u
       LEFT JOIN leaderboard_scores ls ON ls.user_id = u.id
       WHERE u.id = ?1
          OR u.id IN (
            SELECT CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
            FROM friendships f
            WHERE (f.requester_id = ?1 OR f.addressee_id = ?1) AND f.status = 'accepted'
          )
          OR u.id IN (
            SELECT followed_id FROM follows WHERE follower_id = ?1
          )
       ORDER BY score DESC`
    )
    .bind(session.userId)
    .all();

  const entries = (rows.results || []).map((r) => ({
    username: r.username || 'Unnamed',
    score: r.score,
    isYou: r.id === session.userId,
  }));

  return json({ entries });
}

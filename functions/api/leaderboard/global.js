// functions/api/leaderboard/global.js
// GET /api/leaderboard/global -> { entries: [{username, score, rank, isYou, isFollowing}, ...] }
// Top 100 users by score, sitewide. Usernames only, no emails.

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
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  const db = context.env.DB;

  // Top 100 by score. Only users with a username set show up — an
  // unnamed row on a public list isn't useful to anyone.
  const rows = await db
    .prepare(
      `SELECT u.id, u.username, ls.score
       FROM leaderboard_scores ls
       JOIN users u ON u.id = ls.user_id
       WHERE u.username IS NOT NULL
       ORDER BY ls.score DESC
       LIMIT 100`
    )
    .all();

  const following = await db
    .prepare('SELECT followed_id FROM follows WHERE follower_id = ?')
    .bind(session.userId)
    .all();
  const followingSet = new Set((following.results || []).map((r) => r.followed_id));

  const entries = (rows.results || []).map((r, i) => ({
    rank: i + 1,
    userId: r.id,
    username: r.username,
    score: r.score,
    isYou: r.id === session.userId,
    isFollowing: followingSet.has(r.id),
  }));

  return json({ entries });
}

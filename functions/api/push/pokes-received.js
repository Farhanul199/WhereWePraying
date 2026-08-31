// functions/api/push/pokes-received.js
// GET /api/push/pokes-received -> { pokes: [{fromUserId, username,
//   avatarUrl, isSupporter, streakDays}, ...] } — unseen pokes sent TO
// the signed-in user, most recent first. Marks them seen as part of
// this same request (atomic fetch-and-acknowledge), so each poke
// surfaces exactly once via the login-time notification / Reading
// Streak badge, rather than resurfacing on every check.

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

  try {
    const rows = await db
      .prepare(
        `SELECT p.id, p.from_user_id, u.username, u.avatar_url, u.is_supporter,
                COALESCE(qs.streak_days, 0) AS streak_days
         FROM quran_pokes p
         JOIN users u ON u.id = p.from_user_id
         LEFT JOIN quran_streaks qs ON qs.user_id = p.from_user_id
         WHERE p.to_user_id = ? AND p.seen = 0
         ORDER BY p.created_at DESC
         LIMIT 20`
      )
      .bind(session.userId)
      .all();

    const pokes = rows.results || [];

    if (pokes.length) {
      const ids = pokes.map((p) => p.id);
      const placeholders = ids.map(() => '?').join(',');
      await db
        .prepare(`UPDATE quran_pokes SET seen = 1 WHERE id IN (${placeholders})`)
        .bind(...ids)
        .run();
    }

    return json({
      pokes: pokes.map((p) => ({
        fromUserId: p.from_user_id,
        username: p.username || 'Unnamed',
        avatarUrl: p.avatar_url || null,
        isSupporter: !!p.is_supporter,
        streakDays: p.streak_days,
      })),
    });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

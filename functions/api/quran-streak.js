// functions/api/quran-streak.js
// POST /api/quran-streak  body: { streakDays }  — upserts the signed-in
// user's Qur'an reading streak (mirrors leaderboard.js's score upsert).
// GET  /api/quran-streak  -> { entries: [{userId, username, avatarUrl,
//   isSupporter, streakDays, pokedToday}, ...] } for accepted friends,
//   ranked by streak desc. Powers the Reading Streak card's poke panel.

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

  const days = Number.isFinite(body.streakDays) ? Math.max(0, Math.round(body.streakDays)) : null;
  if (days === null) return json({ error: 'Invalid streakDays' }, 400);

  try {
    const db = context.env.DB;
    await db
      .prepare(
        `INSERT INTO quran_streaks (user_id, streak_days, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET streak_days = excluded.streak_days, updated_at = excluded.updated_at`
      )
      .bind(session.userId, days)
      .run();
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }

  return json({ success: true });
}

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  try {
    const db = context.env.DB;
    const todayKey = new Date().toISOString().slice(0, 10);

    const rows = await db
      .prepare(
        `SELECT u.id, u.username, u.avatar_url, u.is_supporter,
                COALESCE(qs.streak_days, 0) AS streak_days,
                EXISTS(
                  SELECT 1 FROM quran_pokes p
                  WHERE p.from_user_id = ?1 AND p.to_user_id = u.id AND p.poke_date = ?2
                ) AS poked_today
         FROM users u
         LEFT JOIN quran_streaks qs ON qs.user_id = u.id
         WHERE u.id IN (
           SELECT CASE WHEN f.requester_id = ?1 THEN f.addressee_id ELSE f.requester_id END
           FROM friendships f
           WHERE (f.requester_id = ?1 OR f.addressee_id = ?1) AND f.status = 'accepted'
         )
         ORDER BY streak_days DESC`
      )
      .bind(session.userId, todayKey)
      .all();

    const entries = (rows.results || []).map((r) => ({
      userId: r.id,
      username: r.username || 'Unnamed',
      avatarUrl: r.avatar_url || null,
      isSupporter: !!r.is_supporter,
      streakDays: r.streak_days,
      pokedToday: !!r.poked_today,
    }));

    return json({ entries });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

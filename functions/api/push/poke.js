// functions/api/push/poke.js
// POST /api/push/poke  body: { friendUserId }
// Records a poke (once per pair per UTC day, enforced by a UNIQUE index)
// and, if the friend has a push subscription on file, sends them a Web
// Push notification nudging them about their Qur'an reading streak.

import { sendWebPush } from './_webpush.js';

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

  const friendUserId = body.friendUserId;
  if (!friendUserId || typeof friendUserId !== 'string') {
    return json({ error: 'Invalid friendUserId' }, 400);
  }
  if (friendUserId === session.userId) {
    return json({ error: 'Cannot poke yourself' }, 400);
  }

  const db = context.env.DB;

  // Only accepted friends can be poked — prevents poking arbitrary users.
  const isFriend = await db
    .prepare(
      `SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = ?1 AND addressee_id = ?2) OR (requester_id = ?2 AND addressee_id = ?1))`
    )
    .bind(session.userId, friendUserId)
    .first();
  if (!isFriend) return json({ error: 'Not friends with this user' }, 403);

  const todayKey = new Date().toISOString().slice(0, 10);

  try {
    await db
      .prepare(
        `INSERT INTO quran_pokes (from_user_id, to_user_id, poke_date, created_at)
         VALUES (?1, ?2, ?3, datetime('now'))`
      )
      .bind(session.userId, friendUserId, todayKey)
      .run();
  } catch (e) {
    // UNIQUE(from_user_id, to_user_id, poke_date) — already poked them today.
    return json({ error: 'Already poked today' }, 409);
  }

  const pokerName =
    (await db.prepare('SELECT username FROM users WHERE id = ?').bind(session.userId).first())
      ?.username || 'A friend';

  const subs = await db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(friendUserId)
    .all();

  let delivered = false;
  for (const sub of subs.results || []) {
    try {
      const res = await sendWebPush(context.env, sub, {
        title: 'Reading Streak poke 👋',
        body: `${pokerName} nudged you to keep your Qur'an streak alive today.`,
        url: '/#quran',
        tag: 'quran-poke',
      });
      if (res.ok) {
        delivered = true;
      } else if (res.status === 404 || res.status === 410) {
        // Expired subscription — clean it up.
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
      }
    } catch (e) {
      // Best-effort — one failed subscription shouldn't fail the whole poke.
    }
  }

  return json({ success: true, delivered });
}

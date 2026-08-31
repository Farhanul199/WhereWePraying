// functions/api/user/delete.js
// POST /api/user/delete — permanently deletes the signed-in account and all
// associated data. Required for Apple App Store guideline 5.1.1(v)
// (in-app account deletion, not just "contact support").
//
// Deletes, in order (children before parents to respect any FK constraints):
//   - app_state          (all synced sections for this account)
//   - community_votes    (votes cast by this user)
//   - community_comments (comments written by this user)
//   - community_ideas    (ideas submitted by this user)
//   - masjid_photos      (photo submissions by this user)
//   - friendships        (any row where this user is requester or addressee)
//   - users              (the account row itself)
// Then clears the KV session and the session cookie.
//
// This does NOT delete community_ideas/comments authored by OTHER users that
// merely reference this user (e.g. votes on their idea) — those rows are
// left with a dangling user_id on our side only via ON DELETE, which SQLite/D1
// does not cascade automatically, so we delete this user's authored rows
// explicitly above. Idea/comment rows by OTHER users are untouched.

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
    return { ...session, sessionId };
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { env } = context;
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  const userId = session.userId;

  try {
    const statements = [
      env.DB.prepare(`DELETE FROM app_state WHERE user_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM community_votes WHERE user_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM community_comments WHERE user_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM community_ideas WHERE user_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM masjid_photos WHERE user_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM friendships WHERE requester_id = ?1 OR addressee_id = ?1`).bind(userId),
      env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(userId),
    ];

    await env.DB.batch(statements);
  } catch (err) {
    console.error('delete account error:', err);
    return json({ error: 'Failed to delete account. Please try again.' }, 500);
  }

  // Clear the KV session so the cookie can't be reused.
  try {
    if (session.sessionId) await env.SESSIONS.delete(session.sessionId);
  } catch (e) {
    // non-fatal — account rows are already gone
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'wwp_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}

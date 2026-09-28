// functions/api/user/delete.js
// POST /api/user/delete — permanently deletes the signed-in account and all
// associated data. Required for Apple App Store guideline 5.1.1(v), Google
// Play's account-deletion policy and UK GDPR (right to erasure).
//
// Rewritten 27 Sep 2026: the old version only cleared 7 tables and left
// push subscriptions (with location), sign-in tokens, streaks, pokes,
// follows, events, invites, Jama'ah broadcasts, leaderboard scores,
// favourites, mosque requests (with email), bug reports and the actual
// photo files in R2 behind.
//
// Each delete runs on its own so one missing/renamed table can't stop the
// rest. The users row goes last. Photo files are removed from R2 too.
// Every other signed-in device is logged out via revokeAllSessions()
// in _lib/session.js (sessions can't be looked up by user).

import { resolveSession, revokeAllSessions } from '../../_lib/session.js';

function json(payload, status, extraHeaders) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) },
  });
}

// [sql, needs how many ?1 binds] — all bind the same userId.
const DELETES = [
  `DELETE FROM app_state WHERE user_id = ?1`,
  `DELETE FROM community_votes WHERE user_id = ?1`,
  `DELETE FROM community_comments WHERE user_id = ?1`,
  `DELETE FROM community_ideas WHERE user_id = ?1`,
  `DELETE FROM community_bugs WHERE user_id = ?1`,
  `DELETE FROM friendships WHERE requester_id = ?1 OR addressee_id = ?1`,
  `DELETE FROM follows WHERE follower_id = ?1 OR followed_id = ?1`,
  `DELETE FROM event_invites WHERE invited_user_id = ?1`,
  `DELETE FROM event_invites WHERE event_id IN (SELECT id FROM shared_events WHERE creator_id = ?1)`,
  `DELETE FROM shared_events WHERE creator_id = ?1`,
  `DELETE FROM jamaah_broadcasts WHERE user_id = ?1`,
  `DELETE FROM leaderboard_scores WHERE user_id = ?1`,
  `DELETE FROM quran_streaks WHERE user_id = ?1`,
  `DELETE FROM quran_pokes WHERE from_user_id = ?1 OR to_user_id = ?1`,
  `DELETE FROM mosque_favorites WHERE user_id = ?1`,
  `DELETE FROM mosque_requests WHERE user_id = ?1`,
  `DELETE FROM push_subscriptions WHERE user_id = ?1`,
  `DELETE FROM magic_tokens WHERE user_id = ?1`,
  `DELETE FROM masjid_photos WHERE user_id = ?1`,
];

export async function onRequestPost(context) {
  const { env } = context;
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  const userId = session.userId;
  const db = env.DB;

  // 1) Photo files in R2 (read keys before the rows are deleted).
  try {
    const { results } = await db.prepare(`SELECT r2_key FROM masjid_photos WHERE user_id = ?1`).bind(userId).all();
    const keys = (results || []).map((r) => r.r2_key).filter(Boolean);
    if (env.MASJID_PHOTOS) {
      // Older uploads were stored under masjid/<userId>/ — sweep that too.
      let cursor;
      do {
        const page = await env.MASJID_PHOTOS.list({ prefix: `masjid/${userId}/`, cursor });
        for (const o of page.objects) keys.push(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const unique = [...new Set(keys)];
      for (let i = 0; i < unique.length; i += 1000) {
        await env.MASJID_PHOTOS.delete(unique.slice(i, i + 1000));
      }
    }
  } catch (e) {
    console.error('delete account: photo cleanup failed', e);
  }

  // 2) Database rows. Email-only newsletter list is cleared by email.
  for (const sql of DELETES) {
    try { await db.prepare(sql).bind(userId).run(); }
    catch (e) { console.error('delete account: step failed', sql.slice(0, 60), e); }
  }
  try {
    const u = await db.prepare(`SELECT email, recovery_email FROM users WHERE id = ?1`).bind(userId).first();
    for (const em of [u && u.email, u && u.recovery_email]) {
      if (em) await db.prepare(`DELETE FROM subscribers WHERE lower(email) = lower(?1)`).bind(em).run();
    }
  } catch (e) {
    console.error('delete account: subscriber cleanup failed', e);
  }

  try {
    await db.prepare(`DELETE FROM users WHERE id = ?1`).bind(userId).run();
  } catch (err) {
    console.error('delete account: users row failed', err);
    return json({ error: 'Failed to delete account. Please try again.' }, 500);
  }

  // 3) Log out this device and every other one.
  try {
    if (session.sessionId) await env.SESSIONS.delete(session.sessionId);
    await revokeAllSessions(env, userId);
  } catch (e) {
    // non-fatal — account rows are already gone
  }

  return json({ success: true }, 200, {
    'Set-Cookie': 'wwp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
  });
}

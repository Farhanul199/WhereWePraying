// functions/api/user/profile.js
// GET /api/user/profile — returns full profile
// PUT /api/user/profile  body: any of { username, recoveryEmail, notifyFriendRequests }
//   — only fields present in the body are updated; others are left alone.

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const user = await context.env.DB.prepare(
    `SELECT email, username, username_changes, avatar_url, is_supporter,
            notify_friend_requests, recovery_email
     FROM users WHERE id = ?`
  )
    .bind(session.userId)
    .first();

  if (!user) return json({ error: 'User not found' }, 404);

  return json({
    email: user.email,
    username: user.username || null,
    canChangeUsername: !user.username || (user.username_changes || 0) < 1,
    avatarUrl: user.avatar_url || null,
    isSupporter: !!user.is_supporter,
    notifyFriendRequests: !!user.notify_friend_requests,
    recoveryEmail: user.recovery_email || null,
  });
}

export async function onRequestPut(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const db = context.env.DB;
  const responses = {};

  // --- Username (unchanged logic: free first set, one change allowed after) ---
  if (body.username !== undefined) {
    const username = (body.username || '').trim();

    if (!USERNAME_RE.test(username)) {
      return json({ error: 'Username must be 3-20 characters, letters/numbers/underscores only' }, 400);
    }

    const current = await db
      .prepare('SELECT username, username_changes FROM users WHERE id = ?')
      .bind(session.userId)
      .first();

    const isFirstTimeSet = !current.username;
    const alreadyUsedChange = (current.username_changes || 0) >= 1;

    if (!isFirstTimeSet) {
      if (current.username === username) {
        responses.username = username; // no-op, same name resubmitted
      } else if (alreadyUsedChange) {
        return json(
          { error: 'You can only change your username once. Contact support if you need another change.' },
          403
        );
      }
    }

    if (responses.username === undefined) {
      const existing = await db
        .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?')
        .bind(username, session.userId)
        .first();
      if (existing) return json({ error: 'That username is already taken' }, 409);

      if (isFirstTimeSet) {
        await db.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, session.userId).run();
      } else {
        await db
          .prepare('UPDATE users SET username = ?, username_changes = username_changes + 1 WHERE id = ?')
          .bind(username, session.userId)
          .run();
      }
      responses.username = username;
    }
  }

  // --- Recovery email ---
  if (body.recoveryEmail !== undefined) {
    const recoveryEmail = (body.recoveryEmail || '').trim();

    if (recoveryEmail && !EMAIL_RE.test(recoveryEmail)) {
      return json({ error: 'Enter a valid recovery email' }, 400);
    }

    const me = await db.prepare('SELECT email FROM users WHERE id = ?').bind(session.userId).first();
    if (recoveryEmail && me && recoveryEmail.toLowerCase() === me.email.toLowerCase()) {
      return json({ error: 'Recovery email must be different from your main email' }, 400);
    }

    await db
      .prepare('UPDATE users SET recovery_email = ? WHERE id = ?')
      .bind(recoveryEmail || null, session.userId)
      .run();
    responses.recoveryEmail = recoveryEmail || null;
  }

  // --- Notification preference ---
  if (body.notifyFriendRequests !== undefined) {
    await db
      .prepare('UPDATE users SET notify_friend_requests = ? WHERE id = ?')
      .bind(body.notifyFriendRequests ? 1 : 0, session.userId)
      .run();
    responses.notifyFriendRequests = !!body.notifyFriendRequests;
  }

  return json({ success: true, ...responses });
}

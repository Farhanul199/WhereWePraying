// functions/api/user/profile.js
// GET /api/user/profile — returns { email, username }
// PUT /api/user/profile  body: { username } — sets/changes username

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

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
    'SELECT email, username, username_changes FROM users WHERE id = ?'
  )
    .bind(session.userId)
    .first();

  if (!user) return json({ error: 'User not found' }, 404);

  return json({
    email: user.email,
    username: user.username || null,
    canChangeUsername: !user.username || (user.username_changes || 0) < 1,
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

  const username = (body.username || '').trim();

  if (!USERNAME_RE.test(username)) {
    return json(
      { error: 'Username must be 3-20 characters, letters/numbers/underscores only' },
      400
    );
  }

  const db = context.env.DB;

  const current = await db
    .prepare('SELECT username, username_changes FROM users WHERE id = ?')
    .bind(session.userId)
    .first();

  const isFirstTimeSet = !current.username;
  const alreadyUsedChange = (current.username_changes || 0) >= 1;

  if (!isFirstTimeSet) {
    if (current.username === username) {
      return json({ success: true, username }); // no-op, same name resubmitted
    }
    if (alreadyUsedChange) {
      return json(
        { error: 'You can only change your username once. Contact support if you need another change.' },
        403
      );
    }
  }

  // Check availability (case-sensitive; someone else may already hold it).
  const existing = await db
    .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
    .bind(username, session.userId)
    .first();

  if (existing) return json({ error: 'That username is already taken' }, 409);

  if (isFirstTimeSet) {
    // Creating a username for the first time doesn't count as "a change".
    await db.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, session.userId).run();
  } else {
    // This is their one allowed change — lock it after this.
    await db
      .prepare('UPDATE users SET username = ?, username_changes = username_changes + 1 WHERE id = ?')
      .bind(username, session.userId)
      .run();
  }

  return json({ success: true, username });
}

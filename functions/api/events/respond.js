// functions/api/events/respond.js
// POST /api/events/respond  body: { inviteId, action: 'accept'|'decline' }
// Only the invited user can respond to their own invite row.

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

  const inviteId = body.inviteId;
  const action = body.action;
  if (!inviteId) return json({ error: 'Missing inviteId' }, 400);
  if (action !== 'accept' && action !== 'decline') return json({ error: 'Invalid action' }, 400);

  try {
    const db = context.env.DB;
    const invite = await db
      .prepare('SELECT id, invited_user_id, status FROM event_invites WHERE id = ?')
      .bind(inviteId)
      .first();

    if (!invite) return json({ error: 'Invite not found' }, 404);
    if (invite.invited_user_id !== session.userId) return json({ error: 'Not your invite' }, 403);

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await db
      .prepare("UPDATE event_invites SET status = ?, responded_at = datetime('now') WHERE id = ?")
      .bind(newStatus, inviteId)
      .run();

    return json({ success: true });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

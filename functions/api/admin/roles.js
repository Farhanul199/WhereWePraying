// functions/api/admin/roles.js
// GET  /api/admin/roles?q=<search>   (X-Broadcast-Key) -> search users by username/email, returns role
// POST /api/admin/roles  body:{ action:'set-role', userId, role } (X-Broadcast-Key)
//      role: 'user' | 'moderator'  (granting 'admin' is intentionally not exposed here —
//      that's done directly in the D1 console so it can never be done by mistake)

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isAdmin(context) {
  const key = context.request.headers.get('X-Broadcast-Key');
  return !!(context.env.BROADCAST_SECRET && key === context.env.BROADCAST_SECRET);
}

export async function onRequestGet(context) {
  if (!isAdmin(context)) return json({ error: 'Unauthorized' }, 401);
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  try {
    let results;
    if (q) {
      const like = `%${q}%`;
      ({ results } = await env.DB.prepare(
        `SELECT id, username, email, role FROM users
         WHERE username LIKE ?1 OR email LIKE ?1
         ORDER BY username ASC LIMIT 25`
      ).bind(like).all());
    } else {
      // No query: show current moderators/admins so Farhanul can see who has
      // elevated access at a glance, without having to search for each one.
      ({ results } = await env.DB.prepare(
        `SELECT id, username, email, role FROM users
         WHERE role = 'moderator' OR role = 'admin'
         ORDER BY role DESC, username ASC LIMIT 50`
      ).all());
    }
    return json({ users: results || [] });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdmin(context)) return json({ error: 'Unauthorized' }, 401);
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (body.action !== 'set-role') return json({ error: 'Unknown action.' }, 400);

  const userId = parseInt(body.userId, 10);
  const role = body.role;
  if (!Number.isInteger(userId)) return json({ error: 'Invalid user id.' }, 400);
  if (!['user', 'moderator'].includes(role)) return json({ error: 'Invalid role.' }, 400);

  try {
    // Never allow this endpoint to touch an existing admin's role — that
    // protects against accidentally demoting yourself or another admin.
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(userId).first();
    if (!target) return json({ error: 'User not found.' }, 404);
    if (target.role === 'admin') return json({ error: "Admin roles can't be changed here." }, 400);

    await env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(role, userId).run();
    return json({ success: true });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

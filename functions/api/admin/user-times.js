// functions/api/admin/user-times.js
//
// Admin moderation for community-submitted Jama'ah times.
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   GET  ?slug=SLUG            -> this week's and last week's submissions for one mosque
//   GET  ?recent=1             -> the 100 newest submissions across all mosques
//   POST { action:'hide', id } -> hide one submission (never shown again)
//   POST { action:'unhide', id }

import { isAdminRequest } from '../../_lib/auth.js';
import { json } from '../../_lib/user-times.js';

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const { env, request } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  try {
    const sql = `SELECT id, mosque_slug, weekday, prayer, time, week_start, device_id, created_at, hidden
                   FROM user_jamaah_submissions`;
    const { results } = slug
      ? await env.DB.prepare(`${sql} WHERE mosque_slug = ? ORDER BY id DESC LIMIT 200`).bind(slug).all()
      : await env.DB.prepare(`${sql} ORDER BY id DESC LIMIT 100`).all();
    return json({ rows: results || [] });
  } catch (e) {
    return json({ error: 'Failed to load submissions' }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const { env, request } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }
  const id = Number.isInteger(body.id) ? body.id : null;
  if (id === null) return json({ error: 'Missing id' }, 400);
  const hidden = body.action === 'hide' ? 1 : body.action === 'unhide' ? 0 : null;
  if (hidden === null) return json({ error: "action must be 'hide' or 'unhide'" }, 400);
  try {
    await env.DB.prepare('UPDATE user_jamaah_submissions SET hidden = ? WHERE id = ?').bind(hidden, id).run();
    return json({ ok: true, id, hidden: !!hidden });
  } catch (e) {
    return json({ error: 'Failed to update' }, 500);
  }
}

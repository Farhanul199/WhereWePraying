// functions/api/events.js
// GET    /api/events  -> { events: [...] }
//   Every event where you're the creator OR an invitee (any status),
//   newest-first. Each item includes `invitees` (creator's view of who's
//   invited + their status) and `myInviteStatus` (your own status, or
//   'creator' if you made it). Only people invited can ever see it —
//   there is no public/global event list.
//
// POST   /api/events  body: { title, eventDate, eventTime?, location?, note?, inviteUserIds?: [] }
//   Creates an event you own. inviteUserIds must all be accepted friends;
//   each gets a pending invite row + a best-effort push notification.
//
// POST   /api/events/respond  body: { inviteId, action: 'accept'|'decline' }
//   Only usable by the invited user.
//
// DELETE /api/events  body: { id }
//   Creator-only. Removes the event and all its invites.

import { sendWebPush } from './push/_webpush.js';

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

  try {
    const db = context.env.DB;

    const rows = await db
      .prepare(
        `SELECT e.id, e.creator_id, e.title, e.event_date, e.event_time, e.location, e.note, e.created_at,
                cu.username AS creator_username,
                ei.id AS my_invite_id, ei.status AS my_status
         FROM shared_events e
         JOIN users cu ON cu.id = e.creator_id
         LEFT JOIN event_invites ei ON ei.event_id = e.id AND ei.invited_user_id = ?1
         WHERE e.creator_id = ?1
            OR e.id IN (SELECT event_id FROM event_invites WHERE invited_user_id = ?1)
         ORDER BY e.event_date ASC, e.event_time ASC`
      )
      .bind(session.userId)
      .all();

    const events = rows.results || [];

    // Pull every invitee for events I created, so I can show who's
    // accepted/declined/pending — invited users don't get this list for
    // events they don't own, just their own status.
    const myEventIds = events.filter((e) => e.creator_id === session.userId).map((e) => e.id);
    let inviteesByEvent = {};
    if (myEventIds.length) {
      const placeholders = myEventIds.map((_, i) => `?${i + 1}`).join(',');
      const inv = await db
        .prepare(
          `SELECT ei.event_id, ei.status, u.id AS user_id, u.username, u.avatar_url
           FROM event_invites ei
           JOIN users u ON u.id = ei.invited_user_id
           WHERE ei.event_id IN (${placeholders})`
        )
        .bind(...myEventIds)
        .all();
      (inv.results || []).forEach((r) => {
        if (!inviteesByEvent[r.event_id]) inviteesByEvent[r.event_id] = [];
        inviteesByEvent[r.event_id].push({
          userId: r.user_id,
          username: r.username,
          avatarUrl: r.avatar_url || null,
          status: r.status,
        });
      });
    }

    const out = events.map((e) => ({
      id: e.id,
      title: e.title,
      eventDate: e.event_date,
      eventTime: e.event_time,
      location: e.location,
      note: e.note,
      createdAt: e.created_at,
      isMine: e.creator_id === session.userId,
      creatorUsername: e.creator_username,
      myInviteId: e.my_invite_id || null,
      myInviteStatus: e.creator_id === session.userId ? 'creator' : e.my_status,
      invitees: inviteesByEvent[e.id] || [],
    }));

    return json({ events: out });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
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

  const title = String(body.title || '').trim().slice(0, 120);
  const eventDate = String(body.eventDate || '').trim();
  const eventTime = body.eventTime ? String(body.eventTime).trim() : null;
  const location = body.location ? String(body.location).trim().slice(0, 140) : null;
  const note = body.note ? String(body.note).trim().slice(0, 200) : null;
  const inviteUserIds = Array.isArray(body.inviteUserIds) ? body.inviteUserIds.filter((x) => typeof x === 'string') : [];

  if (!title) return json({ error: 'Give the event a title' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json({ error: 'Invalid eventDate (expected YYYY-MM-DD)' }, 400);
  if (eventTime && !/^\d{2}:\d{2}$/.test(eventTime)) return json({ error: 'Invalid eventTime' }, 400);

  const db = context.env.DB;

  try {
    // Only accepted friends can be invited — prevents inviting arbitrary users.
    if (inviteUserIds.length) {
      const placeholders = inviteUserIds.map((_, i) => `?${i + 2}`).join(',');
      const friendRows = await db
        .prepare(
          `SELECT CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END AS friend_id
           FROM friendships
           WHERE status = 'accepted' AND (requester_id = ?1 OR addressee_id = ?1)
             AND (CASE WHEN requester_id = ?1 THEN addressee_id ELSE requester_id END) IN (${placeholders})`
        )
        .bind(session.userId, ...inviteUserIds)
        .all();
      const validFriendIds = new Set((friendRows.results || []).map((r) => r.friend_id));
      const invalid = inviteUserIds.filter((id) => !validFriendIds.has(id));
      if (invalid.length) return json({ error: 'Can only invite accepted friends' }, 400);
    }

    const eventId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO shared_events (id, creator_id, title, event_date, event_time, location, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(eventId, session.userId, title, eventDate, eventTime, location, note)
      .run();

    for (const friendId of inviteUserIds) {
      await db
        .prepare(`INSERT INTO event_invites (id, event_id, invited_user_id, status) VALUES (?, ?, ?, 'pending')`)
        .bind(crypto.randomUUID(), eventId, friendId)
        .run();
    }

    // Best-effort push notification per invitee — never blocks the response.
    if (inviteUserIds.length) {
      try {
        const me = await db.prepare('SELECT username FROM users WHERE id = ?').bind(session.userId).first();
        const fromLabel = (me && me.username) || 'A friend';
        for (const friendId of inviteUserIds) {
          const subs = await db
            .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
            .bind(friendId)
            .all();
          for (const sub of subs.results || []) {
            try {
              const res = await sendWebPush(context.env, sub, {
                title: 'New event invite 📅',
                body: `${fromLabel} invited you to "${title}" on ${eventDate}.`,
                url: '/#journal',
                tag: 'event-invite',
              });
              if (!res.ok && (res.status === 404 || res.status === 410)) {
                await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
              }
            } catch (e) {
              // one failed subscription shouldn't fail the invite
            }
          }
        }
      } catch (e) {
        console.error('event invite push failed:', e);
      }
    }

    return json({ success: true, id: eventId });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestDelete(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (!body.id) return json({ error: 'Missing id' }, 400);

  try {
    const db = context.env.DB;
    const event = await db.prepare('SELECT creator_id FROM shared_events WHERE id = ?').bind(body.id).first();
    if (!event) return json({ error: 'Event not found' }, 404);
    if (event.creator_id !== session.userId) return json({ error: 'Only the creator can cancel this event' }, 403);

    await db.prepare('DELETE FROM event_invites WHERE event_id = ?').bind(body.id).run();
    await db.prepare('DELETE FROM shared_events WHERE id = ?').bind(body.id).run();

    return json({ success: true });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

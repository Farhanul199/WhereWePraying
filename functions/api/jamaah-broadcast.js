// functions/api/jamaah-broadcast.js
// POST /api/jamaah-broadcast  body: { prayerName, mosqueName, plannedTime, note? }
//   -> creates a broadcast, auto-expiring 90 min after plannedTime.
// GET  /api/jamaah-broadcast  -> { entries: [{userId, username, avatarUrl,
//   isSupporter, prayerName, mosqueName, plannedTime, note, createdAt}, ...] }
//   Active (non-expired) broadcasts from accepted friends, soonest first.
// DELETE /api/jamaah-broadcast  body: { id }  -> cancel your own broadcast early.
//
// Mirrors quran-streak.js's shape exactly: same session resolution,
// same friendships-table join, same json() helper.

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

const VALID_PRAYERS = new Set(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha', 'Jummah']);
const BROADCAST_WINDOW_MIN = 90; // how long a broadcast stays visible after plannedTime

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const prayerName = String(body.prayerName || '').trim();
  const mosqueName = String(body.mosqueName || '').trim().slice(0, 120);
  const plannedTime = String(body.plannedTime || '').trim();
  const note = body.note ? String(body.note).trim().slice(0, 140) : null;

  if (!VALID_PRAYERS.has(prayerName)) return json({ error: 'Invalid prayerName' }, 400);
  if (!mosqueName) return json({ error: 'Enter a mosque or location' }, 400);
  if (!/^\d{2}:\d{2}$/.test(plannedTime)) return json({ error: 'Invalid plannedTime (expected HH:MM)' }, 400);

  try {
    const db = context.env.DB;
    const id = crypto.randomUUID();

    // Expiry: today's date + plannedTime + window, in UTC-ish (server clock).
    // Good enough for a "still visible for the next hour or so" feed —
    // not used for prayer-accuracy math, just broadcast lifetime.
    const [hh, mm] = plannedTime.split(':').map(Number);
    const expires = new Date();
    expires.setHours(hh, mm + BROADCAST_WINDOW_MIN, 0, 0);

    await db
      .prepare(
        `INSERT INTO jamaah_broadcasts (id, user_id, prayer_name, mosque_name, planned_time, note, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, session.userId, prayerName, mosqueName, plannedTime, note, expires.toISOString())
      .run();

    return json({ success: true, id });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session) return json({ error: 'Not signed in' }, 401);

  try {
    const db = context.env.DB;
    const nowIso = new Date().toISOString();

    const rows = await db
      .prepare(
        `SELECT b.id, b.prayer_name, b.mosque_name, b.planned_time, b.note, b.created_at,
                u.id AS user_id, u.username, u.avatar_url, u.is_supporter
         FROM jamaah_broadcasts b
         JOIN users u ON u.id = b.user_id
         WHERE b.expires_at > ?1
           AND b.user_id IN (
             SELECT CASE WHEN f.requester_id = ?2 THEN f.addressee_id ELSE f.requester_id END
             FROM friendships f
             WHERE (f.requester_id = ?2 OR f.addressee_id = ?2) AND f.status = 'accepted'
           )
         ORDER BY b.planned_time ASC`
      )
      .bind(nowIso, session.userId)
      .all();

    const entries = (rows.results || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username || 'Unnamed',
      avatarUrl: r.avatar_url || null,
      isSupporter: !!r.is_supporter,
      prayerName: r.prayer_name,
      mosqueName: r.mosque_name,
      plannedTime: r.planned_time,
      note: r.note || null,
      createdAt: r.created_at,
    }));

    return json({ entries });
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
    await db
      .prepare(`DELETE FROM jamaah_broadcasts WHERE id = ? AND user_id = ?`)
      .bind(body.id, session.userId)
      .run();
    return json({ success: true });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

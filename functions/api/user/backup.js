// functions/api/user/backup.js
// GET  /api/user/backup  -> full JSON export of the signed-in account's
//      data (one entry per app_state section, freshest row across all
//      of the account's devices — same "account wins" rule used by
//      /api/state/:section).
// POST /api/user/backup  body: { sections: { quran, journal, dua, guides,
//      prayertimes } } -> restores whichever sections are present,
//      overwriting this device's (and therefore the account's) current
//      data for those sections. Signed-in only.

const ALLOWED_SECTIONS = ['quran', 'journal', 'dua', 'guides', 'prayertimes'];
const MAX_SECTION_BYTES = 200 * 1024;   // matches /api/state/:section per-section cap
const MAX_TOTAL_BYTES = 1024 * 1024;    // 1MB across the whole backup file

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
  const { env } = context;
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  const user = await env.DB.prepare(
    `SELECT email, username FROM users WHERE id = ?1`
  ).bind(session.userId).first();

  const sections = {};
  for (const section of ALLOWED_SECTIONS) {
    const row = await env.DB.prepare(
      `SELECT data FROM app_state WHERE user_id = ?1 AND section = ?2 ORDER BY updated_at DESC LIMIT 1`
    ).bind(session.userId, section).first();

    if (row) {
      try {
        sections[section] = JSON.parse(row.data);
      } catch (e) {
        sections[section] = null;
      }
    }
  }

  return json({
    app: 'wherewepraying',
    version: 1,
    exportedAt: Date.now(),
    email: user ? user.email : null,
    username: user ? user.username : null,
    sections,
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  const raw = await request.text();
  if (raw.length > MAX_TOTAL_BYTES) return json({ error: 'Backup file is too large.' }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return json({ error: 'That file isn\'t valid JSON.' }, 400);
  }

  if (!body || typeof body !== 'object' || !body.sections || typeof body.sections !== 'object') {
    return json({ error: 'That doesn\'t look like a WhereWePraying? backup file.' }, 400);
  }

  const now = Date.now();
  const restored = [];

  for (const section of ALLOWED_SECTIONS) {
    if (!(section in body.sections)) continue;
    const value = body.sections[section];
    if (value === null || value === undefined) continue;

    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_SECTION_BYTES) {
      return json({ error: `The "${section}" section in this backup is too large.` }, 413);
    }

    await env.DB.prepare(
      `INSERT INTO app_state (device_id, section, data, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(device_id, section) DO UPDATE SET
         data = excluded.data,
         updated_at = excluded.updated_at,
         user_id = excluded.user_id`
    ).bind(data.deviceId, section, serialized, now, session.userId).run();

    restored.push(section);
  }

  if (!restored.length) {
    return json({ error: 'No recognizable sections found in this backup.' }, 400);
  }

  return json({ success: true, restored });
}

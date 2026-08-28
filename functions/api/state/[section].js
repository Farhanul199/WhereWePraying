// GET  /api/state/:section  -> { data: <whatever was last saved, or null> }
// PUT  /api/state/:section  body: { data: <anything JSON-serializable> }
//
// One row per (device_id, section) in D1, storing the section's data as
// a JSON blob. When the request carries a valid signed-in session, rows
// also get tagged with user_id — that's what makes data follow the
// account across devices instead of staying stuck to one device.
//
// Read behaviour when signed in: prefer the freshest row anywhere tied
// to this account (any device); if none exists yet, fall back to this
// device's local anonymous row and claim it for the account (lazy
// migration — happens the first time each section is touched post
// sign-in, no separate migration step needed).
//
// Write behaviour when signed in: upsert this device's row as before,
// but also stamp user_id on it. COALESCE keeps a previously-claimed
// link intact if a write ever comes in unauthenticated (e.g. signed
// out on this device) — it won't unlink the row.

const ALLOWED_SECTIONS = new Set(['quran', 'journal', 'dua', 'guides']);
const MAX_BODY_BYTES = 200 * 1024; // 200KB is generous headroom per section

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function resolveUserId(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session=')).split('=')[1];
    if (!sessionId) return null;
    const raw = await context.env.SESSIONS.get(sessionId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) return null;
    return session.userId || null;
  } catch (e) {
    return null;
  }
}

export async function onRequestGet(context) {
  const { env, params, data } = context;
  const section = params.section;
  if (!ALLOWED_SECTIONS.has(section)) return json({ error: 'Unknown section' }, 404);

  const userId = await resolveUserId(context);

  if (userId) {
    // Signed in: the freshest row anywhere tied to this account wins,
    // regardless of which device wrote it.
    const acctRow = await env.DB.prepare(
      `SELECT data FROM app_state WHERE user_id = ?1 AND section = ?2 ORDER BY updated_at DESC LIMIT 1`
    ).bind(userId, section).first();

    if (acctRow) {
      try {
        return json({ data: JSON.parse(acctRow.data) });
      } catch (e) {
        return json({ data: null });
      }
    }

    // No account-linked data yet — fall back to this device's local
    // (still-anonymous) row, and claim it for the account so it's
    // linked going forward.
    const localRow = await env.DB.prepare(
      `SELECT data FROM app_state WHERE device_id = ?1 AND section = ?2`
    ).bind(data.deviceId, section).first();

    if (localRow) {
      await env.DB.prepare(
        `UPDATE app_state SET user_id = ?1 WHERE device_id = ?2 AND section = ?3`
      ).bind(userId, data.deviceId, section).run();

      try {
        return json({ data: JSON.parse(localRow.data) });
      } catch (e) {
        return json({ data: null });
      }
    }

    return json({ data: null });
  }

  // Anonymous — unchanged, device-scoped only.
  const row = await env.DB.prepare(
    `SELECT data FROM app_state WHERE device_id = ?1 AND section = ?2`
  ).bind(data.deviceId, section).first();

  if (!row) return json({ data: null });

  try {
    return json({ data: JSON.parse(row.data) });
  } catch (e) {
    return json({ data: null });
  }
}

export async function onRequestPut(context) {
  const { request, env, params, data } = context;
  const section = params.section;
  if (!ALLOWED_SECTIONS.has(section)) return json({ error: 'Unknown section' }, 404);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);

  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (body.data === undefined) return json({ error: 'Missing "data" field' }, 400);

  const userId = await resolveUserId(context);
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO app_state (device_id, section, data, updated_at, user_id) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(device_id, section) DO UPDATE SET
       data = excluded.data,
       updated_at = excluded.updated_at,
       user_id = COALESCE(excluded.user_id, app_state.user_id)`
  ).bind(data.deviceId, section, JSON.stringify(body.data), now, userId).run();

  return json({ ok: true });
}

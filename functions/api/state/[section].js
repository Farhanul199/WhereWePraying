// GET  /api/state/:section  -> { data: <whatever was last saved, or null> }
// PUT  /api/state/:section  body: { data: <anything JSON-serializable> }
//
// One row per (device_id, section) in D1, storing the section's data as
// a JSON blob. See migrations/0001_init.sql for why a blob was chosen
// over a normalized schema at this stage.

const ALLOWED_SECTIONS = new Set(['quran', 'journal', 'dua', 'guides']);
const MAX_BODY_BYTES = 200 * 1024; // 200KB is generous headroom per section

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function onRequestGet(context) {
  const { env, params, data } = context;
  const section = params.section;
  if (!ALLOWED_SECTIONS.has(section)) return json({ error: 'Unknown section' }, 404);

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

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO app_state (device_id, section, data, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id, section) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(data.deviceId, section, JSON.stringify(body.data), now).run();

  return json({ ok: true });
}

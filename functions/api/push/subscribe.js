// functions/api/push/subscribe.js
// Stores a Web Push subscription so it can later be targeted by a
// scheduled sender (e.g. a Cron-triggered Worker) for prayer-time alerts.
//
// D1 table expected (see migrations/002_push_subscriptions.sql):
//   push_subscriptions(
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     device_id TEXT NOT NULL,
//     user_id TEXT,
//     endpoint TEXT NOT NULL UNIQUE,
//     p256dh TEXT NOT NULL,
//     auth TEXT NOT NULL,
//     tz TEXT,
//     lat REAL,
//     lon REAL,
//     created_at TEXT NOT NULL,
//     updated_at TEXT NOT NULL
//   )

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid_json' }, 400);
  }

  const sub = body && body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return json({ error: 'invalid_subscription' }, 400);
  }

  const deviceId = request.headers.get('X-Device-Id') || body.deviceId || null;
  if (!deviceId) return json({ error: 'missing_device_id' }, 400);

  const now = new Date().toISOString();
  const tz = body.tz || null;
  const lat = typeof body.lat === 'number' ? body.lat : null;
  const lon = typeof body.lon === 'number' ? body.lon : null;

  try {
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, tz, lat, lon, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
       ON CONFLICT(endpoint) DO UPDATE SET
         device_id=excluded.device_id, p256dh=excluded.p256dh, auth=excluded.auth,
         tz=excluded.tz, lat=COALESCE(excluded.lat, push_subscriptions.lat),
         lon=COALESCE(excluded.lon, push_subscriptions.lon), updated_at=excluded.updated_at`
    ).bind(deviceId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, tz, lat, lon, now).run();
  } catch (err) {
    return json({ error: 'db_error', message: String(err) }, 500);
  }

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

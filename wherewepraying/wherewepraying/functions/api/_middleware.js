// Runs before every /api/* request.
//
// There's no login — the frontend generates a UUID on first visit
// (see the WWP module in wherewepraying-app.html) and sends it on every
// request as X-Device-Id. This middleware just makes sure that header
// looks sane before any handler touches the database, and keeps a
// lightweight "devices" record so you can see how many distinct testers
// have actually opened the app.
const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const deviceId = request.headers.get('X-Device-Id');

  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid X-Device-Id header' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  data.deviceId = deviceId;

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO devices (device_id, first_seen, last_seen) VALUES (?1, ?2, ?2)
       ON CONFLICT(device_id) DO UPDATE SET last_seen = ?2`
    ).bind(deviceId, now).run();
  } catch (e) {
    // A failed "touch" shouldn't block the actual request.
    console.error('devices upsert failed', e);
  }

  return next();
}

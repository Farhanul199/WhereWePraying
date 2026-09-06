// Runs before every /api/* request.
//
// There's no login — the frontend generates a UUID on first visit
// (see the WWP module in wherewepraying-app.html) and sends it on every
// request as X-Device-Id. This middleware just makes sure that header
// looks sane before any handler touches the database, and keeps a
// lightweight "devices" record so you can see how many distinct testers
// have actually opened the app.
//
// Exception: /api/auth/* (Google OAuth redirect + callback) are reached
// via full-page browser navigation, not fetch() calls, so they can't
// carry a custom header — those routes skip the device-id check.
//
// Exception: /api/admin/* are server-to-server/admin-triggered tools
// (e.g. the THM Jama'ah sync) protected by their own ?secret= param
// instead of a device id — these also skip the check.
//
// --- Added: Origin check + rate limiting ---
// Origin check: real browser fetch() calls from your own site send an
// Origin header matching wherewepraying.com. Direct curl / most bot
// scripts either omit it or send something else. This alone stops
// casual scraping — it's not bulletproof (Origin can be spoofed by a
// determined script), but it filters out the vast majority of
// drive-by AI/bot hits with zero cost to real users.
//
// Rate limiting: sliding-window counter in KV, keyed by IP. Caps abuse
// even from scripts that do spoof Origin. Uses RATE_LIMIT KV binding —
// create it in Cloudflare dashboard (Workers & Pages > KV > Create
// namespace, name it RATE_LIMIT) and add the binding to wrangler.toml:
//
//   [[kv_namespaces]]
//   binding = "RATE_LIMIT"
//   id = "<the id Cloudflare gives you>"

const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const ALLOWED_ORIGINS = new Set([
  'https://wherewepraying.com',
  'https://www.wherewepraying.com'
]);
const RATE_LIMIT_MAX = 60;       // max requests
const RATE_LIMIT_WINDOW = 60;    // per this many seconds

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/admin/')) {
    return next();
  }

  // --- Origin check ---
  // Only enforced when an Origin header is present (normal browser
  // fetch calls always send one for cross-site-capable requests; some
  // same-origin navigations don't, so we don't hard-require it — we
  // just reject it when it's present and wrong).
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // --- Rate limit (per IP) ---
  if (env.RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW * 1000));
    const key = `rl:${ip}:${bucket}`;

    try {
      const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
      if (current >= RATE_LIMIT_MAX) {
        return new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': String(RATE_LIMIT_WINDOW) }
        });
      }
      await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW * 2 });
    } catch (e) {
      // Never let a rate-limit failure block a legit request.
      console.error('rate limit check failed', e);
    }
  }

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

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
//
// NOTE: to stay well under Cloudflare's free 1,000-writes-per-day KV
// limit, general /api/* traffic only WRITES the counter every 20th
// request instead of every single one (we still READ every time, and
// reads are free/plentiful). That means the general limit is only
// approximate — real enforcement kicks in up to ~20x later than the
// stated max. That's an acceptable trade for high-volume routes, but
// it's the wrong trade for routes that are naturally low-volume and
// where abuse is expensive (spamming other people's inboxes, brute-
// forcing an admin secret, chewing through upload storage): those use
// `precise: true` below, which writes on every single request. Because
// they're low-volume by nature, the extra KV writes are cheap.

const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const BAD_UA_RE = /curl|wget|python-requests|python-urllib|scrapy|go-http-client|okhttp|libwww-perl|java\/|axios\/|node-fetch|postmanruntime|httpclient|apache-httpclient/i;
const ALLOWED_ORIGINS = new Set([
  'https://wherewepraying.com',
  'https://www.wherewepraying.com'
]);
const RATE_LIMIT_MAX = 300;        // normal /api/* routes: max requests
const RATE_LIMIT_WINDOW = 300;     // per this many seconds (5 min bucket — fewer KV keys/day)
const ADMIN_RATE_LIMIT_MAX = 10;   // /api/admin/*: much stricter — these
const ADMIN_RATE_LIMIT_WINDOW = 60; // are secret-protected, not device-id
                                     // protected, so this is what stops
                                     // someone brute-forcing ?secret=.
                                     // Precise (every-request) counting —
                                     // see note above.

// Extra, tighter limits for specific low-volume/high-abuse-value routes,
// checked in addition to (not instead of) the general per-IP limit
// above. Also precise (every-request) counting.
const SENSITIVE_RATE_LIMIT_MAX = 5;      // send-magic-link, subscribe
const SENSITIVE_RATE_LIMIT_WINDOW = 900; // per 15 minutes per IP
const UPLOAD_RATE_LIMIT_MAX = 20;        // community photo uploads
const UPLOAD_RATE_LIMIT_WINDOW = 3600;   // per hour per IP
const SENSITIVE_PATHS = new Set(['/api/send-magic-link', '/api/subscribe']);

const WRITE_EVERY_N = 20;          // only write to KV every 20th hit (non-precise routes)
const DEVICE_UPDATE_THROTTLE_MS = 60 * 60 * 1000; // only update devices.last_seen once per hour per device

async function checkRateLimit(env, key, max, windowSeconds, { precise = false } = {}) {
  if (!env.RATE_LIMIT) return true; // fail open if KV isn't bound yet
  try {
    const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (current >= max) return false;
    if (precise) {
      // Low-volume route: write every time, so the cap is exact.
      await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
    } else if (Math.random() < 1 / WRITE_EVERY_N) {
      // High-volume route: only write every WRITE_EVERY_N requests to
      // save on the daily free KV write quota. Slightly less precise,
      // much cheaper.
      await env.RATE_LIMIT.put(key, String(current + WRITE_EVERY_N), { expirationTtl: windowSeconds * 2 });
    }
    return true;
  } catch (e) {
    console.error('rate limit check failed', e);
    return true; // never let a rate-limit failure block a legit request
  }
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // --- Honeypot ban check (cheapest check, runs first) ---
  // If this IP tripped the /trap/ honeypot in the last 7 days, reject
  // immediately — don't even bother with UA/Origin/rate-limit checks.
  if (env.RATE_LIMIT && ip !== 'unknown') {
    try {
      const banned = await env.RATE_LIMIT.get(`banned:${ip}`);
      if (banned) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } catch (e) {
      console.error('honeypot ban check failed', e);
    }
  }

  // /api/admin/* is protected by its own ?secret= param, checked inside
  // each handler, not by device-id. But that secret is the ONLY gate on
  // these routes, so it still needs its own (stricter) rate limit here —
  // otherwise a script could brute-force ?secret= as fast as Cloudflare
  // will let it, with nothing in front of it at all.
  if (url.pathname.startsWith('/api/admin/')) {
    const bucket = Math.floor(Date.now() / (ADMIN_RATE_LIMIT_WINDOW * 1000));
    const ok = await checkRateLimit(env, `rl:admin:${ip}:${bucket}`, ADMIN_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_WINDOW, { precise: true });
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(ADMIN_RATE_LIMIT_WINDOW) }
      });
    }
    return next();
  }

  if (url.pathname.startsWith('/api/auth/')) {
    return next();
  }

  // --- User-Agent check (blocks obvious scripts/bots before they touch KV) ---
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BAD_UA_RE.test(ua)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // --- Origin check ---
  const origin = request.headers.get('Origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // --- Sec-Fetch-Site check ---
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'same-site') {
    return new Response(JSON.stringify({ error: 'Forbidden request source' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // --- Rate limit (per IP) ---
  {
    const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW * 1000));
    const ok = await checkRateLimit(env, `rl:${ip}:${bucket}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(RATE_LIMIT_WINDOW) }
      });
    }
  }

  // --- Extra, tighter limit for low-volume/high-abuse-value routes ---
  // (on top of the general per-IP limit above, not instead of it)
  if (SENSITIVE_PATHS.has(url.pathname)) {
    const bucket = Math.floor(Date.now() / (SENSITIVE_RATE_LIMIT_WINDOW * 1000));
    const ok = await checkRateLimit(
      env, `rl:sens:${ip}:${url.pathname}:${bucket}`,
      SENSITIVE_RATE_LIMIT_MAX, SENSITIVE_RATE_LIMIT_WINDOW, { precise: true }
    );
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(SENSITIVE_RATE_LIMIT_WINDOW) }
      });
    }
  } else if (url.pathname === '/api/community/photos' && request.method === 'POST') {
    const bucket = Math.floor(Date.now() / (UPLOAD_RATE_LIMIT_WINDOW * 1000));
    const ok = await checkRateLimit(
      env, `rl:upload:${ip}:${bucket}`,
      UPLOAD_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_WINDOW, { precise: true }
    );
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(UPLOAD_RATE_LIMIT_WINDOW) }
      });
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
    // Only touch the devices row if it's new, or it's been >1hr since last
    // write for this device. Cuts D1 writes from "every request" to "a
    // handful per device per day" — reads are cheap, writes aren't.
    const existing = await env.DB.prepare(
      `SELECT last_seen FROM devices WHERE device_id = ?1`
    ).bind(deviceId).first();

    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO devices (device_id, first_seen, last_seen) VALUES (?1, ?2, ?2)`
      ).bind(deviceId, now).run();
    } else if (now - existing.last_seen > DEVICE_UPDATE_THROTTLE_MS) {
      await env.DB.prepare(
        `UPDATE devices SET last_seen = ?2 WHERE device_id = ?1`
      ).bind(deviceId, now).run();
    }
  } catch (e) {
    console.error('devices upsert failed', e);
  }

  return next();
}

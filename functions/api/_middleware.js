// Runs before every /api/* request.
//
// There's no login for most of the app — the frontend generates a UUID
// on first visit (see the WWP module in wherewepraying-app.html) and
// sends it on every request as X-Device-Id. This middleware just makes
// sure that header looks sane before any handler touches the database,
// and keeps a lightweight "devices" record so you can see how many
// distinct testers have actually opened the app. Signed-in-only actions
// (profile, friends, favourites, backup, photo uploads, etc.) layer a
// real session check (the wwp_session HttpOnly cookie) on top of this in
// their own handler — X-Device-Id is a per-device bucket key for the
// anonymous local sync feature, not an account credential, and no
// handler treats it as one.
//
// Exception: /api/auth/* (Google/Apple OAuth redirect + callback) are
// reached via full-page browser navigation, not fetch() calls, so they
// can't carry a custom header — those routes skip the device-id check.
//
// Exception: /api/admin/* and anything else presenting an admin secret
// header (X-Broadcast-Key or X-Sync-Key) are server-to-server/admin-
// triggered tools protected by that secret instead of a device id —
// these also skip the device-id check, but get their own stricter,
// exact-count rate limit below instead.
//
// --- Origin check + rate limiting ---
// Origin check: real browser fetch() calls from your own site send an
// Origin header matching wherewepraying.com. Direct curl / most bot
// scripts either omit it or send something else. This alone stops
// casual scraping — it's not bulletproof (Origin can be spoofed by a
// determined script), but it filters out the vast majority of drive-by
// AI/bot hits with zero cost to real users. A request that changes data
// (POST/PUT/PATCH/DELETE) is required to present a valid Origin — a
// missing Origin is normal on a simple same-origin GET in some browser
// configurations, but a cross-site script forging a state-changing
// request has no legitimate reason to omit it, so that combination is
// rejected. (The stronger, load-bearing CSRF defense is still the
// wwp_session cookie's SameSite=Strict attribute — this check is
// defense-in-depth on top of that, not a replacement for it.)
//
// Rate limiting: a counter in KV, keyed by IP and time-bucketed. Uses
// the RATE_LIMIT KV binding — create it in the Cloudflare dashboard
// (Workers & Pages > KV > Create namespace, name it RATE_LIMIT) and add
// the binding to wrangler.toml:
//
//   [[kv_namespaces]]
//   binding = "RATE_LIMIT"
//   id = "<the id Cloudflare gives you>"
//
// Every request writes its count (no sampling) so the cap is exact
// rather than approximate. Worth knowing this still isn't a perfectly
// airtight limiter: Workers KV is eventually consistent (writes can
// take up to ~60s to be visible at every edge location), so a genuinely
// distributed burst hitting many Cloudflare PoPs at once in that window
// could still slip past the count before it catches up. If this site
// ever sees real abuse (or just real growth) at the KV free tier's
// 1,000-writes/day ceiling, the correct next step is Cloudflare's
// native Rate Limiting Rules (Security > WAF > Rate limiting rules in
// the dashboard) — those run at the edge with proper atomic counting
// and don't have this consistency gap. That's a dashboard config
// change, not something this file can do on its own.

const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;
const BAD_UA_RE = /curl|wget|python-requests|python-urllib|scrapy|go-http-client|okhttp|libwww-perl|java\/|axios\/|node-fetch|postmanruntime|httpclient|apache-httpclient/i;
const ALLOWED_ORIGINS = new Set([
  'https://wherewepraying.com',
  'https://www.wherewepraying.com'
]);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const RATE_LIMIT_MAX = 300;        // normal /api/* routes: max requests
const RATE_LIMIT_WINDOW = 300;     // per this many seconds (5 min bucket — fewer KV keys/day)
const ADMIN_RATE_LIMIT_MAX = 10;   // admin-secret-protected routes: much
const ADMIN_RATE_LIMIT_WINDOW = 60; // stricter — this is what stops
                                     // someone brute-forcing the secret.

// Extra, tighter limits for specific low-volume/high-abuse-value routes,
// checked in addition to (not instead of) the general per-IP limit
// above.
const SENSITIVE_RATE_LIMIT_MAX = 5;      // send-magic-link, subscribe
const SENSITIVE_RATE_LIMIT_WINDOW = 900; // per 15 minutes per IP
const UPLOAD_RATE_LIMIT_MAX = 20;        // community photo uploads
const UPLOAD_RATE_LIMIT_WINDOW = 3600;   // per hour per IP
const SENSITIVE_PATHS = new Set(['/api/send-magic-link', '/api/subscribe']);

const DEVICE_UPDATE_THROTTLE_MS = 60 * 60 * 1000; // only update devices.last_seen once per hour per device

async function checkRateLimit(env, key, max, windowSeconds) {
  if (!env.RATE_LIMIT) return true; // fail open if KV isn't bound yet
  try {
    const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
    if (current >= max) return false;
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: windowSeconds * 2 });
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
  //
  // This fails OPEN (continues processing) if the KV read itself throws
  // — deliberately, not as an oversight. RATE_LIMIT having a transient
  // hiccup shouldn't take the entire site down for every visitor; the
  // honeypot ban is one supplementary layer among several (UA filter,
  // Origin check, the per-IP rate limits below), not the only thing
  // standing between the site and abuse, so degrading it in a rare
  // outage is an acceptable trade against also degrading availability.
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

  // Admin-secret-protected routes: /api/admin/* by path, or anything
  // presenting the X-Broadcast-Key / X-Sync-Key header regardless of
  // path (broadcast.js, mosques/manage.js, mosques/scrape.js, and the
  // admin side of community/photos.js all live outside /api/admin/ but
  // are gated the same way) — the secret is the ONLY gate on these, so
  // they get their own stricter, exact-count rate limit here rather
  // than the general one below, and skip the device-id requirement
  // since they were never device-scoped to begin with.
  const hasAdminSecretHeader = !!(request.headers.get('X-Broadcast-Key') || request.headers.get('X-Sync-Key'));
  if (url.pathname.startsWith('/api/admin/') || hasAdminSecretHeader) {
    const bucket = Math.floor(Date.now() / (ADMIN_RATE_LIMIT_WINDOW * 1000));
    const ok = await checkRateLimit(env, `rl:admin:${ip}:${bucket}`, ADMIN_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_WINDOW);
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
  // Cheap and easy to bypass by anyone who bothers to set a browser-like
  // User-Agent — this is not a real security boundary, it's a filter
  // that costs nothing and catches unsophisticated scripts/scanners
  // outright. Nothing else here relies on it holding.
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BAD_UA_RE.test(ua)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // --- Origin check ---
  const origin = request.headers.get('Origin');
  const isMutating = MUTATING_METHODS.has(request.method);
  if (isMutating && !origin) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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
      SENSITIVE_RATE_LIMIT_MAX, SENSITIVE_RATE_LIMIT_WINDOW
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
      UPLOAD_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_WINDOW
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
    //
    // This is a tester-count/analytics feature, not a security control —
    // it never gates access to anything — so a failure here is caught
    // and logged, and the request carries on regardless.
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

// functions/api/xp1/tv.js
//
// XP1 Phase 8 — QR pairing + phone settings sync.
// One POST endpoint, one D1 table (xp1_tvs). All calls send X-Device-Id
// (required by api/_middleware.js).
//
// TV actions   (need device_id + secret, both random, kept on the TV):
//   register  -> creates the TV row the first time
//   code      -> new 6-char pairing code, valid 10 min, single use
//   sync      -> returns latest settings; if `settings` is sent, saves them
// Phone actions:
//   claim     -> { code } swaps a valid code for a 1-hour phone token
//   get       -> { token } current settings + TV online status
//   save      -> { token, settings }
//   disconnect-> { token } ends the phone session

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60 * 1000;
const PHONE_TTL_MS = 60 * 60 * 1000;
const TV_ONLINE_MS = 5 * 60 * 1000;
const TV_SEEN_THROTTLE_MS = 90 * 1000;
const ID_RE = /^[a-f0-9]{32}$/;
const CODE_RE = /^[A-Z0-9]{6}$/;

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// Only these settings are ever stored — anything else is dropped.
function cleanSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  const loc = s.location;
  if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' &&
      Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180) {
    out.location = {
      lat: Math.round(loc.lat * 1000) / 1000,
      lon: Math.round(loc.lon * 1000) / 1000,
      label: String(loc.label || 'Saved location').slice(0, 80),
      source: loc.source === 'fallback' ? 'fallback' : 'manual',
    };
  }
  if (typeof s.youtube_enabled === 'boolean') out.youtube_enabled = s.youtube_enabled;
  if (typeof s.show_weather === 'boolean') out.show_weather = s.show_weather;
  if (typeof s.show_mosques === 'boolean') out.show_mosques = s.show_mosques;
  if (typeof s.show_playlist === 'boolean') out.show_playlist = s.show_playlist;
  if (typeof s.brightness === 'number' && s.brightness >= 40 && s.brightness <= 100) {
    out.brightness = Math.round(s.brightness);
  }
  if (typeof s.playlist_url === 'string' && /[?&]list=[a-zA-Z0-9_-]+/.test(s.playlist_url)) {
    out.playlist_url = s.playlist_url.slice(0, 300);
  }
  return out;
}

function parseSettings(text) {
  try { return JSON.parse(text || '{}'); } catch (e) { return {}; }
}

async function getTv(env, deviceId, secret) {
  if (!ID_RE.test(deviceId || '') || !ID_RE.test(secret || '')) return null;
  const row = await env.DB.prepare(`SELECT * FROM xp1_tvs WHERE device_id = ?`).bind(deviceId).first();
  if (!row || row.secret !== secret) return null;
  return row;
}

async function getByToken(env, token) {
  if (!ID_RE.test(token || '')) return null;
  const row = await env.DB.prepare(`SELECT * FROM xp1_tvs WHERE phone_token = ?`).bind(token).first();
  if (!row || !row.phone_expires || row.phone_expires < Date.now()) return null;
  return row;
}

function phoneView(row, token) {
  return {
    ok: true,
    token: token,
    settings: parseSettings(row.settings),
    version: row.version,
    tv_online: !!(row.tv_seen && Date.now() - row.tv_seen < TV_ONLINE_MS),
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }
  const action = body && body.action;
  const now = Date.now();

  try {
    // ---------- TV ----------
    if (action === 'register') {
      if (!ID_RE.test(body.device_id || '') || !ID_RE.test(body.secret || '')) return json({ error: 'Bad id' }, 400);
      const existing = await env.DB.prepare(`SELECT secret FROM xp1_tvs WHERE device_id = ?`).bind(body.device_id).first();
      if (existing && existing.secret !== body.secret) return json({ error: 'Forbidden' }, 403);
      if (!existing) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO xp1_tvs (device_id, secret, settings, version, tv_seen, created_at) VALUES (?, ?, '{}', 0, ?, ?)`
        ).bind(body.device_id, body.secret, now, now).run();
      }
      return json({ ok: true });
    }

    if (action === 'code') {
      const tv = await getTv(env, body.device_id, body.secret);
      if (!tv) return json({ error: 'Forbidden' }, 403);
      let code = null;
      for (let i = 0; i < 5 && !code; i++) {
        const c = randomCode();
        const clash = await env.DB.prepare(
          `SELECT 1 FROM xp1_tvs WHERE pair_code = ? AND pair_expires > ?`
        ).bind(c, now).first();
        if (!clash) code = c;
      }
      if (!code) return json({ error: 'Try again' }, 500);
      const expires = now + CODE_TTL_MS;
      await env.DB.prepare(
        `UPDATE xp1_tvs SET pair_code = ?, pair_expires = ?, tv_seen = ? WHERE device_id = ?`
      ).bind(code, expires, now, tv.device_id).run();
      return json({ ok: true, code: code, expires: expires });
    }

    if (action === 'sync') {
      const tv = await getTv(env, body.device_id, body.secret);
      if (!tv) return json({ error: 'Forbidden' }, 403);
      let version = tv.version;
      let settings = parseSettings(tv.settings);
      if (body.settings) {
        settings = cleanSettings(body.settings);
        version = tv.version + 1;
        await env.DB.prepare(
          `UPDATE xp1_tvs SET settings = ?, version = ?, tv_seen = ? WHERE device_id = ?`
        ).bind(JSON.stringify(settings), version, now, tv.device_id).run();
      } else if (!tv.tv_seen || now - tv.tv_seen > TV_SEEN_THROTTLE_MS) {
        await env.DB.prepare(`UPDATE xp1_tvs SET tv_seen = ? WHERE device_id = ?`).bind(now, tv.device_id).run();
      }
      return json({
        ok: true,
        version: version,
        settings: settings,
        phone_connected: !!(tv.phone_token && tv.phone_expires && tv.phone_expires > now),
      });
    }

    // ---------- Phone ----------
    if (action === 'claim') {
      const code = String(body.code || '').toUpperCase().replace(/\s+/g, '');
      if (!CODE_RE.test(code)) return json({ error: 'That code doesn\u2019t look right.' }, 400);
      const row = await env.DB.prepare(
        `SELECT * FROM xp1_tvs WHERE pair_code = ? AND pair_expires > ?`
      ).bind(code, now).first();
      if (!row) return json({ error: 'Code expired or not found. Open Settings on your TV for a new one.' }, 404);
      const token = randomHex(16);
      const expires = now + PHONE_TTL_MS;
      await env.DB.prepare(
        `UPDATE xp1_tvs SET pair_code = NULL, pair_expires = NULL, phone_token = ?, phone_expires = ? WHERE device_id = ?`
      ).bind(token, expires, row.device_id).run();
      row.phone_token = token;
      row.phone_expires = expires;
      return json(phoneView(row, token));
    }

    if (action === 'get' || action === 'save' || action === 'disconnect') {
      const row = await getByToken(env, body.token);
      if (!row) return json({ error: 'Session ended. Scan the QR code on your TV again.' }, 401);

      if (action === 'disconnect') {
        await env.DB.prepare(
          `UPDATE xp1_tvs SET phone_token = NULL, phone_expires = NULL WHERE device_id = ?`
        ).bind(row.device_id).run();
        return json({ ok: true });
      }

      const expires = now + PHONE_TTL_MS;
      if (action === 'save') {
        const merged = Object.assign(parseSettings(row.settings), cleanSettings(body.settings));
        row.settings = JSON.stringify(merged);
        row.version = row.version + 1;
        await env.DB.prepare(
          `UPDATE xp1_tvs SET settings = ?, version = ?, phone_expires = ? WHERE device_id = ?`
        ).bind(row.settings, row.version, expires, row.device_id).run();
      } else if (row.phone_expires - now < PHONE_TTL_MS / 2) {
        // Only extend when under half the time is left — saves D1 writes.
        await env.DB.prepare(`UPDATE xp1_tvs SET phone_expires = ? WHERE device_id = ?`).bind(expires, row.device_id).run();
      }
      return json(phoneView(row, row.phone_token));
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: 'Request failed', detail: String(e) }, 500);
  }
}

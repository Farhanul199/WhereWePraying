// functions/api/mosques/user-times.js
//
// Community-submitted Jama'ah times (fallback only). See _lib/user-times.js
// for the week / reset / cooldown rules.
//
//   GET  ?slugs=a,b,c
//     -> { mosques: { [slug]: { weekday, prayers: { fajr: { time, state, submittedAt } } } } }
//        state = 'current' (this week) | 'previous' (last week, show greyed out)
//        Only today's weekday is returned, in each mosque's own local time.
//        Hidden (admin-removed) entries are never returned.
//
//   POST { mosque, weekday (0=Sun..6=Sat), prayer, time ("HH:MM"), deviceId }
//     -> { ok: true, state: 'current', weekStart }
//        Rules: one submission per device per hour; a device may edit only
//        one mosque per week; max 40 submissions per IP per day.
//
// The client only shows these where the mosque has no official time for
// that prayer. Official times always win (see find-a-mosque.js).

import {
  PRAYERS, COOLDOWN_MS, RANGES, parseTime, mosqueWeekInfo, mosqueLocal,
  previousWeekStart, json,
} from '../../_lib/user-times.js';

const MAX_SLUGS = 12;
const MAX_PER_IP_PER_DAY = 40;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slugs = (url.searchParams.get('slugs') || '')
    .split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_SLUGS);
  if (!slugs.length) return json({ mosques: {} });

  try {
    const now = Date.now();
    const lower = new Date(now - 14 * 86400000).toISOString().slice(0, 10);
    const marks = slugs.map(() => '?').join(',');
    const mosqueRows = await env.DB.prepare(
      `SELECT slug, longitude FROM mosques WHERE active = 1 AND slug IN (${marks})`
    ).bind(...slugs).all();
    const lonBySlug = new Map((mosqueRows.results || []).map((m) => [m.slug, m.longitude]));

    const { results } = await env.DB.prepare(
      `SELECT id, mosque_slug, weekday, prayer, time, week_start, created_at
         FROM user_jamaah_submissions
        WHERE hidden = 0 AND week_start >= ? AND mosque_slug IN (${marks})
        ORDER BY id DESC`
    ).bind(lower, ...slugs).all();

    const out = {};
    for (const slug of slugs) {
      if (!lonBySlug.has(slug)) continue;
      const { weekday, weekStart } = mosqueWeekInfo(lonBySlug.get(slug), now);
      const prev = previousWeekStart(weekStart);
      const prayers = {};
      for (const r of results) {
        if (r.mosque_slug !== slug || r.weekday !== weekday) continue;
        if (r.week_start !== weekStart && r.week_start !== prev) continue;
        if (prayers[r.prayer]) {
          // Already have one: a current entry beats a previous one; ids are newest-first.
          if (prayers[r.prayer].state === 'current') continue;
          if (r.week_start !== weekStart) continue;
        }
        prayers[r.prayer] = {
          time: r.time,
          state: r.week_start === weekStart ? 'current' : 'previous',
          submittedAt: r.created_at,
        };
      }
      out[slug] = { weekday, prayers };
    }
    return json({ mosques: out }, 200, { 'Cache-Control': 'public, max-age=30' });
  } catch (e) {
    return json({ error: 'Failed to load submitted times' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

  const slug = typeof body.mosque === 'string' ? body.mosque.trim() : '';
  const weekday = Number.isInteger(body.weekday) ? body.weekday : -1;
  const prayer = typeof body.prayer === 'string' ? body.prayer.toLowerCase() : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  const t = parseTime(body.time);

  if (!slug) return json({ error: 'Missing mosque' }, 400);
  if (weekday < 0 || weekday > 6) return json({ error: 'Invalid weekday' }, 400);
  if (!PRAYERS.includes(prayer)) return json({ error: 'Invalid prayer' }, 400);
  if (!DEVICE_ID.test(deviceId)) return json({ error: 'Invalid device' }, 400);
  if (!t) return json({ error: 'Time must be HH:MM (24 hour)' }, 400);
  const [lo, hi] = RANGES[prayer];
  if (t.minutes < lo || t.minutes > hi) {
    return json({ error: `That time does not look right for ${prayer}` }, 400);
  }

  try {
    const mosque = await env.DB.prepare(
      'SELECT slug, longitude FROM mosques WHERE slug = ? AND active = 1'
    ).bind(slug).first();
    if (!mosque) return json({ error: 'Mosque not found' }, 404);

    const now = Date.now();
    const info = mosqueWeekInfo(mosque.longitude, now);

    // Per-IP daily cap (KV counter; best effort).
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const day = mosqueLocal(0, now).toISOString().slice(0, 10);
    const ipKey = `ut_ip:${ip}:${day}`;
    if (env.RATE_LIMIT) {
      const n = parseInt((await env.RATE_LIMIT.get(ipKey)) || '0', 10);
      if (n >= MAX_PER_IP_PER_DAY) return json({ error: 'Too many submissions today' }, 429);
      await env.RATE_LIMIT.put(ipKey, String(n + 1), { expirationTtl: 2 * 86400 });
    }

    // Per-device rules.
    const dev = await env.DB.prepare(
      'SELECT week_start, mosque_slug, last_at FROM user_time_devices WHERE device_id = ?'
    ).bind(deviceId).first();
    if (dev) {
      const wait = dev.last_at + COOLDOWN_MS - now;
      if (wait > 0) {
        return json({ error: 'Please wait before editing again', retryMinutes: Math.ceil(wait / 60000) }, 429);
      }
      if (dev.week_start === info.weekStart && dev.mosque_slug !== slug) {
        return json({ error: 'You can only edit one mosque per week' }, 403);
      }
    }

    await env.DB.prepare(
      `INSERT INTO user_jamaah_submissions (mosque_slug, weekday, prayer, time, week_start, device_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(slug, weekday, prayer, t.text, info.weekStart, deviceId, now).run();

    await env.DB.prepare(
      `INSERT INTO user_time_devices (device_id, week_start, mosque_slug, last_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET week_start = excluded.week_start,
         mosque_slug = excluded.mosque_slug, last_at = excluded.last_at`
    ).bind(deviceId, info.weekStart, slug, now).run();

    // Housekeeping: drop anything older than last week for this mosque.
    await env.DB.prepare(
      'DELETE FROM user_jamaah_submissions WHERE mosque_slug = ? AND week_start < ?'
    ).bind(slug, previousWeekStart(info.weekStart)).run();

    return json({ ok: true, state: 'current', weekStart: info.weekStart });
  } catch (e) {
    return json({ error: 'Could not save that time' }, 500);
  }
}

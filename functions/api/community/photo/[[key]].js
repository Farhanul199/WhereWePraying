// functions/api/community/photo/[[key]].js
// GET /api/community/photo/masjid/123/167...-uuid.jpg -> streams the image
// straight from the MASJID_PHOTOS R2 bucket.
//
// Approved photos are public (no auth) — that's the whole point of them.
// A pending or rejected photo is only meant to be seen by whoever
// submitted it and by admins reviewing the queue, so this checks the
// masjid_photos row before serving: an R2 key alone isn't a secret
// (it's echoed straight back in the upload/list API responses and is
// guessable-ish being just a timestamp+uuid), so if one ever leaked —
// screenshot, shared link, browser history — it shouldn't be enough on
// its own to view someone's not-yet-approved submission.

import { isAdminRequest } from '../../../_lib/auth.js';

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
  const { env, params } = context;
  const keyParts = Array.isArray(params.key) ? params.key : [params.key];
  const key = keyParts.join('/');

  if (!key || !key.startsWith('masjid/')) {
    return new Response('Not found', { status: 404 });
  }

  const photoRow = await env.DB.prepare(
    `SELECT user_id, status FROM masjid_photos WHERE r2_key = ?1`
  ).bind(key).first();

  // No DB row for this key at all -> either it was never a real
  // submission or the upload's DB insert failed after the R2 write (see
  // the comment in photos.js) — either way, nothing to serve.
  if (!photoRow) {
    return new Response('Not found', { status: 404 });
  }

  if (photoRow.status !== 'approved') {
    const session = await resolveSession(context);
    const isOwner = session && session.userId === photoRow.user_id;
    const isAdmin = isAdminRequest(context);
    if (!isOwner && !isAdmin) {
      return new Response('Not found', { status: 404 });
    }
  }

  const object = await env.MASJID_PHOTOS.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Approved photos are immutable and fine to cache at the edge/browser
  // for a long time. A pending/rejected one is only being served here
  // because the caller is its owner or an admin — `public` caching would
  // let Cloudflare's edge cache hand that same response to the NEXT
  // person who requests the URL, walking straight around the status
  // check above. `private, no-store` keeps it un-cached anywhere shared.
  headers.set(
    'Cache-Control',
    photoRow.status === 'approved' ? 'public, max-age=31536000, immutable' : 'private, no-store'
  );
  // Belt-and-braces alongside the site-wide nosniff in _headers: this is
  // the one route serving a content-type that came from an uploader's
  // own claim, so pin it explicitly here too.
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(object.body, { headers });
}

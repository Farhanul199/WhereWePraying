// functions/api/community/photos.js
// POST /api/community/photos   (multipart/form-data: photo, masjidName, note)
//      -> signed-in users only. Uploads to R2 (MASJID_PHOTOS), inserts a
//         'pending' row in masjid_photos.
// GET  /api/community/photos
//      -> signed-in: your own submissions + status.
//      -> admin (header X-Broadcast-Key matching env.BROADCAST_SECRET) with
//         ?status=pending|approved|rejected|all : full review queue.
// POST /api/community/photos  body:{ action:'review', photoId, status }
//      -> admin only (X-Broadcast-Key). status: 'approved' | 'rejected'.

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

function isAdmin(context) {
  const key = context.request.headers.get('X-Broadcast-Key');
  return !!(context.env.BROADCAST_SECRET && key === context.env.BROADCAST_SECRET);
}

function extFromType(type) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
  return map[type] || 'jpg';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  if (isAdmin(context)) {
    const status = url.searchParams.get('status') || 'pending';
    let query = `SELECT p.id, p.r2_key, p.masjid_name, p.note, p.status, p.created_at, p.reviewed_at, u.username, u.email
                 FROM masjid_photos p LEFT JOIN users u ON u.id = p.user_id`;
    const binds = [];
    if (status !== 'all') {
      query += ` WHERE p.status = ?1`;
      binds.push(status);
    }
    query += ` ORDER BY p.created_at DESC LIMIT 200`;
    const { results } = await db.prepare(query).bind(...binds).all();
    const photos = (results || []).map((p) => ({ ...p, url: `/api/community/photo/${p.r2_key}` }));
    return json({ photos });
  }

  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  const { results } = await db.prepare(
    `SELECT id, r2_key, masjid_name, note, status, created_at, reviewed_at
     FROM masjid_photos WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50`
  ).bind(session.userId).all();

  const photos = (results || []).map((p) => ({ ...p, url: `/api/community/photo/${p.r2_key}` }));
  return json({ photos });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  const contentType = request.headers.get('content-type') || '';

  // ---- Admin review action (JSON body) ----
  if (contentType.includes('application/json')) {
    if (!isAdmin(context)) return json({ error: 'Unauthorized' }, 401);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Invalid request body.' }, 400); }
    if (body.action !== 'review') return json({ error: 'Unknown action.' }, 400);

    const photoId = parseInt(body.photoId, 10);
    const status = body.status;
    if (!Number.isInteger(photoId) || !['approved', 'rejected'].includes(status)) {
      return json({ error: 'Invalid review request.' }, 400);
    }

    await db.prepare(
      `UPDATE masjid_photos SET status = ?1, reviewed_at = ?2 WHERE id = ?3`
    ).bind(status, Date.now(), photoId).run();

    return json({ success: true });
  }

  // ---- Signed-in user uploading a photo (multipart/form-data) ----
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: 'Invalid form data.' }, 400);
  }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return json({ error: 'No photo provided.' }, 400);
  if (!ALLOWED_TYPES.includes(file.type)) return json({ error: 'Please upload a JPEG, PNG, WEBP, or HEIC photo.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Photo is too large (max 8MB).' }, 400);

  const masjidName = String(form.get('masjidName') || '').trim().slice(0, 120);
  const note = String(form.get('note') || '').trim().slice(0, 500);

  const rand = crypto.randomUUID();
  const key = `masjid/${session.userId}/${Date.now()}-${rand}.${extFromType(file.type)}`;

  try {
    await env.MASJID_PHOTOS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
  } catch (e) {
    console.error('R2 put failed', e);
    return json({ error: 'Upload failed. Please try again.' }, 500);
  }

  const result = await db.prepare(
    `INSERT INTO masjid_photos (user_id, r2_key, masjid_name, note, status, created_at)
     VALUES (?1, ?2, ?3, ?4, 'pending', ?5)`
  ).bind(session.userId, key, masjidName, note, Date.now()).run();

  return json({ success: true, id: result.meta.last_row_id, url: `/api/community/photo/${key}` });
}

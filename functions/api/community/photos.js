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

import { resolveSession } from '../../_lib/session.js';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
// HEIC/HEIF dropped (27 Sep 2026): their location/camera metadata can't be
// stripped safely here. The app converts every photo to JPEG in the
// browser before upload (community.js), so iPhone photos still work.
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

import { isAdminRequest } from '../../_lib/auth.js';
const isAdmin = isAdminRequest;

function extFromType(type) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return map[type] || 'jpg';
}

// ---- Privacy: strip photo metadata (27 Sep 2026) ----
// Phone photos carry EXIF: GPS position (often the uploader's home),
// phone model, serial numbers, timestamps. Approved photos are public,
// so every upload is cleaned here before it is stored. Pixels are
// untouched; only metadata blocks are removed.
function stripJpeg(u8) {
  if (u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  const out = [u8.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= u8.length) {
    if (u8[i] !== 0xff) return null;
    const marker = u8[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(u8.subarray(i, i + 2)); i += 2; continue; }
    if (marker === 0xff) { i += 1; continue; }
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2 || i + 2 + len > u8.length) return null;
    if (marker === 0xda) { out.push(u8.subarray(i)); break; } // image data: copy rest as-is
    // Drop APP1 (EXIF/XMP), APP3-APP13 (incl. Photoshop/IPTC), APP15 and
    // comments. Keep APP0 (JFIF), APP2 (colour profile), APP14 (Adobe colour).
    const drop = marker === 0xfe || marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef;
    if (!drop) out.push(u8.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return concatBytes(out);
}

function stripPng(u8) {
  const DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  const out = [u8.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= u8.length) {
    const len = ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
    const type = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
    const end = i + 12 + len;
    if (end > u8.length) return null;
    if (!DROP.has(type)) out.push(u8.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concatBytes(out);
}

function stripWebp(u8) {
  const out = [];
  let i = 12;
  while (i + 8 <= u8.length) {
    const type = String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
    const len = u8[i + 4] | (u8[i + 5] << 8) | (u8[i + 6] << 16) | (u8[i + 7] << 24);
    const end = i + 8 + len + (len & 1);
    if (len < 0 || end > u8.length + 1) return null;
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = u8.slice(i, Math.min(end, u8.length));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x0c; // clear EXIF + XMP flags
      out.push(chunk);
    }
    i = end;
  }
  const body = concatBytes(out);
  const header = u8.slice(0, 12);
  const size = body.length + 4;
  header[4] = size & 0xff; header[5] = (size >> 8) & 0xff; header[6] = (size >> 16) & 0xff; header[7] = (size >> 24) & 0xff;
  return concatBytes([header, body]);
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function stripMetadata(type, buf) {
  const u8 = new Uint8Array(buf);
  try {
    if (type === 'image/jpeg') return stripJpeg(u8);
    if (type === 'image/png') return stripPng(u8);
    if (type === 'image/webp') return stripWebp(u8);
  } catch (e) { /* fall through */ }
  return null;
}

// The browser-supplied `file.type` is just a label the uploader's client
// sent — nothing stops someone from claiming "image/png" for an arbitrary
// file. Since we serve these straight out of R2 with that same claimed
// content-type, an unchecked mismatch is how you get MIME-sniffing-based
// content injection from a crafted "image". Check the actual leading
// bytes against the type being claimed before accepting the upload.
// HEIC/HEIF share the ISO-BMFF container (same as MP4) and put their
// brand a few bytes in rather than at offset 0, so they get a slightly
// different check.
async function matchesClaimedType(file) {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const bytesStartWith = (sig) => sig.every((b, i) => head[i] === b);

  switch (file.type) {
    case 'image/jpeg':
      return bytesStartWith([0xff, 0xd8, 0xff]);
    case 'image/png':
      return bytesStartWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return bytesStartWith([0x52, 0x49, 0x46, 0x46]) &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50; // RIFF....WEBP
    default:
      return false;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = env.DB;

  try {
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
  } catch (e) {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
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

    try {
      await db.prepare(
        `UPDATE masjid_photos SET status = ?1, reviewed_at = ?2 WHERE id = ?3`
      ).bind(status, Date.now(), photoId).run();
    } catch (e) {
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }

    return json({ success: true });
  }

  // ---- Signed-in user uploading a photo (multipart/form-data) ----
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);
  try {
    const u = await db.prepare(`SELECT banned_at FROM users WHERE id = ?1`).bind(session.userId).first();
    if (u && u.banned_at) return json({ error: 'Your account can no longer submit photos.' }, 403);
  } catch (e) { /* banned_at column not added yet */ }

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ error: 'Invalid form data.' }, 400);
  }

  const file = form.get('photo');
  if (!file || typeof file === 'string') return json({ error: 'No photo provided.' }, 400);
  if (!ALLOWED_TYPES.includes(file.type)) return json({ error: 'Please upload a JPEG, PNG or WEBP photo.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Photo is too large (max 8MB).' }, 400);
  if (!(await matchesClaimedType(file))) {
    return json({ error: "That file doesn't look like a valid image of the type it claims to be." }, 400);
  }

  const masjidName = String(form.get('masjidName') || '').trim().slice(0, 120);
  const note = String(form.get('note') || '').trim().slice(0, 500);

  const clean = stripMetadata(file.type, await file.arrayBuffer());
  if (!clean) return json({ error: "That photo couldn't be processed. Please try a different one." }, 400);

  // Key no longer contains the user's account ID (it ended up in public
  // photo URLs). Old keys keep working; the DB row still ties the photo
  // to its uploader for review and account deletion.
  const key = `masjid/${Date.now()}-${crypto.randomUUID()}.${extFromType(file.type)}`;

  try {
    await env.MASJID_PHOTOS.put(key, clean, {
      httpMetadata: { contentType: file.type },
    });
  } catch (e) {
    console.error('R2 put failed', e);
    return json({ error: 'Upload failed. Please try again.' }, 500);
  }

  try {
    const result = await db.prepare(
      `INSERT INTO masjid_photos (user_id, r2_key, masjid_name, note, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5)`
    ).bind(session.userId, key, masjidName, note, Date.now()).run();

    return json({ success: true, id: result.meta.last_row_id, url: `/api/community/photo/${key}` });
  } catch (e) {
    // The R2 object above is already uploaded but orphaned (no DB row) —
    // acceptable: better than crashing after a successful upload, and it
    // just won't show up anywhere since nothing references that key.
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

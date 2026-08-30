// functions/api/community/photo/[[key]].js
// GET /api/community/photo/masjid/123/167...-uuid.jpg -> streams the image
// straight from the MASJID_PHOTOS R2 bucket. Public read (no auth) since
// these are meant to be viewable once approved; unapproved ones are only
// ever linked to their own submitter or the admin panel, not indexed
// anywhere public, so this is fine without an extra status check.

export async function onRequestGet(context) {
  const { env, params } = context;
  const keyParts = Array.isArray(params.key) ? params.key : [params.key];
  const key = keyParts.join('/');

  if (!key || !key.startsWith('masjid/')) {
    return new Response('Not found', { status: 404 });
  }

  const object = await env.MASJID_PHOTOS.get(key);
  if (!object) {
    return new Response('Not found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
}

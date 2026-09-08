// functions/_lib/auth.js
// Shared helpers for admin-secret checks. Filename starts with an
// underscore-prefixed folder so Cloudflare Pages does NOT treat this as
// a route — it's just an importable module.

// Constant-time string comparison. A plain `===` on secrets leaks timing
// information (V8 short-circuits on the first mismatched byte), which is
// a real (if minor, over a network) side channel for endpoints gated only
// by a shared secret. Same length check first is fine to leak — secret
// length isn't the sensitive part.
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Admin auth shared by the X-Broadcast-Key-gated endpoints.
export function isAdminRequest(context) {
  const key = context.request.headers.get('X-Broadcast-Key');
  return !!(context.env.BROADCAST_SECRET && key && timingSafeEqual(key, context.env.BROADCAST_SECRET));
}

// Admin auth for the SYNC_SECRET-gated endpoints (sync-thm-jamaah,
// export-thm-jamaah). Prefers the X-Sync-Key header — query-string
// secrets get written into Cloudflare's request logs and the browser's
// own history, so the header is the path to use going forward. The
// `?secret=` fallback stays so pasting the URL straight into a browser
// still works for a quick manual trigger; prefer curl + header when you
// can.
export function isSyncRequest(context) {
  const secret = context.env.SYNC_SECRET;
  if (!secret) return false;
  const headerKey = context.request.headers.get('X-Sync-Key');
  if (headerKey && timingSafeEqual(headerKey, secret)) return true;
  const url = new URL(context.request.url);
  const queryKey = url.searchParams.get('secret');
  if (queryKey && timingSafeEqual(queryKey, secret)) return true;
  return false;
}

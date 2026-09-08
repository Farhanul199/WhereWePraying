// functions/_lib/auth.js
// Shared helpers for constant-time admin-secret checks. This file lives in
// an underscore-prefixed directory so Cloudflare Pages does not route it.

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isAdminRequest(context) {
  const key = context.request.headers.get('X-Broadcast-Key');
  return !!(context.env.BROADCAST_SECRET && key &&
    timingSafeEqual(key, context.env.BROADCAST_SECRET));
}

// Synchronization endpoints accept the secret only in an HTTP header. Query
// strings are retained in browser history and commonly reach request logs.
export function isSyncRequest(context) {
  const secret = context.env.SYNC_SECRET;
  if (!secret) return false;
  const headerKey = context.request.headers.get('X-Sync-Key');
  return !!(headerKey && timingSafeEqual(headerKey, secret));
}

// functions/_lib/session.js
//
// Shared cookie parsing + session lookup. Used by every endpoint that
// requires a signed-in user. This used to be copy-pasted verbatim into
// ~21 files (plus a slightly different cookie-parsing line in the OAuth
// callbacks) — now it lives in one place, so a fix here fixes everywhere.

// RFC 6265 only requires ";" between cookie pairs; a space after it is
// common but not guaranteed. Splitting on "; " (as the old copy-pasted
// code did) silently drops a cookie if a client omits the space. This
// splits on ";" alone and trims, so both forms parse correctly. It also
// takes the value up to the FIRST "=" only (old code used
// `.split('=')[1]`, which truncates any value that itself contains "=",
// e.g. base64/JWT padding).
export function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export async function resolveSession(context) {
  try {
    const cookieHeader = context.request.headers.get('cookie') || '';
    const sessionId = getCookie(cookieHeader, 'wwp_session');
    if (!sessionId) return null;
    const raw = await context.env.SESSIONS.get(sessionId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) return null;
    // sessionId is included so callers that need to invalidate the
    // session (e.g. account deletion, logout) don't have to re-parse the
    // cookie themselves. Harmless extra field for everyone else.
    return { ...session, sessionId };
  } catch (e) {
    return null;
  }
}

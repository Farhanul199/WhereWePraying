// functions/api/session.js
// GET /api/session — fetch current session
// POST /api/session — signout (delete session)
//      body { all: true } — sign out on every device (28 Sep 2026)

import { getCookie, resolveSession, revokeAllSessions } from '../_lib/session.js';

export async function onRequestGet(context) {
  try {
    // resolveSession also rejects expired and signed-out-everywhere
    // sessions (28 Sep 2026 — this used to read KV directly and skip that).
    const session = await resolveSession(context);
    if (!session || !session.userId) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    // role is stored per-user in D1 (not in the KV session blob) so that
    // granting/revoking moderator access takes effect immediately without
    // needing the user to sign out and back in.
    let role = 'user';
    try {
      const row = await context.env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(session.userId).first();
      if (row && row.role) role = row.role;
    } catch (e) {
      // fall back to 'user' if the column doesn't exist yet / query fails
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        email: session.email,
        userId: session.userId,
        expiresAt: session.expiresAt,
        role,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }
    );
  } catch (err) {
    console.error('session GET error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestPost(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = getCookie(cookies, 'wwp_session');

    let all = false;
    try { all = !!((await context.request.json()) || {}).all; } catch (e) { /* plain sign-out has no body */ }
    if (all) {
      const session = await resolveSession(context);
      if (session && session.userId) await revokeAllSessions(context.env, session.userId);
    }

    if (sessionId) {
      await context.env.SESSIONS.delete(sessionId);
    }

    return new Response(JSON.stringify({ success: true, message: 'Signed out' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'wwp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      },
    });
  } catch (err) {
    console.error('session POST error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

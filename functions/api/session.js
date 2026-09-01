// functions/api/session.js
// GET /api/session — fetch current session
// POST /api/session — signout (delete session)

export async function onRequestGet(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session='))?.split('=')[1];

    if (!sessionId) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sessionData = await context.env.SESSIONS.get(sessionId);

    if (!sessionData) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = JSON.parse(sessionData);

    // Check expiry
    if (new Date(session.expiresAt) < new Date()) {
      await context.env.SESSIONS.delete(sessionId);
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
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
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session='))?.split('=')[1];

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

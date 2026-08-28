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

    return new Response(
      JSON.stringify({
        authenticated: true,
        email: session.email,
        userId: session.userId,
        expiresAt: session.expiresAt,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
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

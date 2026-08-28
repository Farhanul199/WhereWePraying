// functions/api/verify-token.js
// GET /api/verify-token?token=...
// Verifies the magic link token and returns session info

function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response(JSON.stringify({ error: 'Token required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = context.env.DB;

    // Find token
    const tokenRecord = await db
      .prepare(
        `SELECT id, user_id, expires_at, used
         FROM magic_tokens
         WHERE token = ?
         LIMIT 1`
      )
      .bind(token)
      .first();

    if (!tokenRecord) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check expiry
    if (new Date(tokenRecord.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if already used
    if (tokenRecord.used) {
      return new Response(JSON.stringify({ error: 'Token already used' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mark token as used
    await db.prepare('UPDATE magic_tokens SET used = 1 WHERE id = ?').bind(tokenRecord.id).run();

    // Update user's last_login
    const now = new Date().toISOString();
    await db
      .prepare('UPDATE users SET last_login = ? WHERE id = ?')
      .bind(now, tokenRecord.user_id)
      .run();

    // Fetch user
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').bind(tokenRecord.user_id).first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create session
    const sessionId = generateSessionId();
    const sessionExpiry = new Date();
    sessionExpiry.setDate(sessionExpiry.getDate() + 7); // 7-day session

    await context.env.SESSIONS.put(
      sessionId,
      JSON.stringify({
        userId: tokenRecord.user_id,
        email: user.email,
        createdAt: now,
        expiresAt: sessionExpiry.toISOString(),
      }),
      { expirationTtl: 7 * 24 * 60 * 60 } // 7 days in seconds
    );

    return new Response(
      JSON.stringify({
        success: true,
        sessionId,
        email: user.email,
        expiresAt: sessionExpiry.toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `wwp_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
        },
      }
    );
  } catch (err) {
    console.error('verify-token error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

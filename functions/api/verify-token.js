// functions/api/verify-token.js
// POST /api/verify-token   body: { token }
// Verifies the magic link token and returns session info.
//
// Deliberately POST, not GET, even though the token also lives in the
// emailed link's query string (?token=...): that link points at the SPA
// page (/verify?token=...), and the SPA is what turns it into this POST
// via fetch() once it loads. A GET here would mean the token gets
// consumed by anything that merely requests the URL — including email
// link-scanners and prefetchers that follow links without a person
// actually clicking — which would burn a single-use token before the
// real recipient gets to it. Requiring an explicit POST means only code
// that runs the page's JS (i.e. an actual browser rendering /verify)
// can consume it.

function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  try {
    let body;
    try {
      body = await context.request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const token = body && body.token;

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
      // No sessionId here — it's already set as an HttpOnly cookie below,
      // and echoing it in a JS-readable response body only gives it a
      // second, weaker home (browser history/devtools/any logging of
      // response bodies) for no benefit.
      JSON.stringify({
        success: true,
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

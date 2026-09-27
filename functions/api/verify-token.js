import { sha256Hex } from '../_lib/hash.js';
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
    const now = new Date().toISOString();
    const fail = (msg) => new Response(JSON.stringify({ error: msg }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });

    // New links (27 Sep 2026): KV holds only a hash of the token plus the
    // email, for 30 minutes. The account is found or created only now.
    let userRow = null;
    const kvKey = typeof token === 'string' && /^[a-f0-9]{48}$/.test(token)
      ? `ml:${await sha256Hex(token)}` : null;
    const pending = kvKey ? await context.env.SESSIONS.get(kvKey) : null;

    if (pending) {
      await context.env.SESSIONS.delete(kvKey); // single use
      const email = String(JSON.parse(pending).email || '').toLowerCase();
      if (!email) return fail('Invalid or expired token');
      userRow = await db
        .prepare('SELECT id, email FROM users WHERE lower(email) = ?1 OR lower(recovery_email) = ?1 LIMIT 1')
        .bind(email)
        .first();
      if (!userRow) {
        const newId = crypto.randomUUID();
        await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(newId, email).run();
        userRow = { id: newId, email };
      }
    } else {
      // Links sent before the change still work until they expire.
      const claim = await db
        .prepare(`UPDATE magic_tokens SET used = 1 WHERE token = ?1 AND used = 0 AND expires_at > ?2`)
        .bind(token, now)
        .run();
      if (!claim.meta || claim.meta.changes !== 1) return fail('This sign-in link has expired or was already used. Please request a new one.');
      const tokenRecord = await db.prepare(`SELECT user_id FROM magic_tokens WHERE token = ?1`).bind(token).first();
      userRow = tokenRecord
        ? await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(tokenRecord.user_id).first()
        : null;
      if (!userRow) return fail('Invalid or expired token');
    }

    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, userRow.id).run();
    const tokenRecord = { user_id: userRow.id };
    const user = { email: userRow.email };

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

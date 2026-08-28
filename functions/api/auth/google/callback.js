// functions/api/auth/google/callback.js
// GET /api/auth/google/callback — Google redirects here after consent

const GOOGLE_CLIENT_ID = '662750148844-ongjct7hv8vi4ai0h51feir16p6j4ccd.apps.googleusercontent.com';

function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeIdTokenPayload(idToken) {
  // id_token is a JWT: header.payload.signature. We trust it because it
  // came straight from Google over HTTPS in the server-to-server token
  // exchange below (not passed through the browser), so we just decode
  // the payload rather than re-verifying the signature.
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent(error)}`, 302);
    }

    // Verify CSRF state matches the cookie set before redirecting to Google.
    const cookies = context.request.headers.get('cookie') || '';
    const cookieState = cookies.split('; ').find((c) => c.startsWith('wwp_oauth_state='))?.split('=')[1];

    if (!code || !state || !cookieState || state !== cookieState) {
      return Response.redirect(`${url.origin}/?auth_error=invalid_state`, 302);
    }

    const redirectUri = `${url.origin}/api/auth/google/callback`;

    // Exchange the authorization code for tokens.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: context.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      return Response.redirect(`${url.origin}/?auth_error=token_exchange_failed`, 302);
    }

    const tokenData = await tokenRes.json();
    const claims = decodeIdTokenPayload(tokenData.id_token);
    const email = claims.email;

    if (!email) {
      return Response.redirect(`${url.origin}/?auth_error=no_email`, 302);
    }

    const db = context.env.DB;
    const picture = claims.picture || null;

    // Find or create user (same users table magic-link sign-in uses).
    let user = await db.prepare('SELECT id, avatar_url FROM users WHERE email = ?').bind(email).first();

    if (!user) {
      const userId = crypto.randomUUID();
      await db.prepare('INSERT INTO users (id, email, avatar_url) VALUES (?, ?, ?)').bind(userId, email, picture).run();
      user = { id: userId };
    } else if (picture && !user.avatar_url) {
      // Only fill it in if they don't already have one — don't clobber
      // a picture they might set some other way later.
      await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(picture, user.id).run();
    }

    const now = new Date().toISOString();
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();

    // Create session, same as the magic-link flow.
    const sessionId = generateSessionId();
    const sessionExpiry = new Date();
    sessionExpiry.setDate(sessionExpiry.getDate() + 7);

    await context.env.SESSIONS.put(
      sessionId,
      JSON.stringify({
        userId: user.id,
        email,
        createdAt: now,
        expiresAt: sessionExpiry.toISOString(),
      }),
      { expirationTtl: 7 * 24 * 60 * 60 }
    );

    const headers = new Headers();
    headers.set('Location', `${url.origin}/?signed_in=1`);
    headers.append(
      'Set-Cookie',
      `wwp_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
    );
    headers.append('Set-Cookie', `wwp_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('google callback error:', err);
    const origin = new URL(context.request.url).origin;
    return Response.redirect(`${origin}/?auth_error=internal_error`, 302);
  }
}

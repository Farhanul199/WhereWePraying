// functions/api/auth/apple/callback.js
// POST /api/auth/apple/callback — Apple form-posts here after consent
// (response_mode=form_post is required whenever 'scope' is requested, so
// this must be a POST handler, unlike the Google callback which is GET).
//
// ---------------------------------------------------------------------
// ONE-TIME SETUP (Apple Developer portal — no Mac needed, all web-based):
//
// 1. Certificates, Identifiers & Profiles → Identifiers → your App ID
//    (com.wherewepraying) → check "Sign In with Apple" → Save.
//
// 2. Identifiers → "+" → Services IDs → create one, e.g.
//    "com.wherewepraying.web". This is APPLE_CLIENT_ID.
//    Enable "Sign In with Apple" on it → Configure:
//      Domain:        wherewepraying.com
//      Return URL:    https://wherewepraying.com/api/auth/apple/callback
//
// 3. Keys → "+" → name it anything → check "Sign In with Apple" →
//    Configure → select your App ID → Save → Register → Download.
//    This downloads a .p8 file ONCE — you cannot re-download it, so keep
//    it safe. The Key ID shown on this page is APPLE_KEY_ID.
//
// 4. Your Team ID is in the top-right of the portal, or under
//    Membership. This is APPLE_TEAM_ID.
//
// 5. Add four Cloudflare Pages secrets (dashboard → Settings → Environment
//    Variables, same place STRIPE_SECRET_KEY etc. were added):
//      APPLE_CLIENT_ID    = com.wherewepraying.web
//      APPLE_TEAM_ID       = (from step 4)
//      APPLE_KEY_ID        = (from step 3)
//      APPLE_PRIVATE_KEY   = (full contents of the .p8 file, including
//                             the -----BEGIN/END PRIVATE KEY----- lines)
//
// The client secret Apple requires is a short-lived JWT we sign on every
// request using APPLE_PRIVATE_KEY (see generateClientSecret below) — this
// avoids the usual "Apple client secrets expire every 6 months and you
// have to remember to regenerate them" trap.
// ---------------------------------------------------------------------

function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

async function importApplePrivateKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

// Signs a fresh ES256 client_secret JWT per request. Apple allows an exp
// of up to 6 months out; we use a short 5-minute window since it's
// generated on demand anyway.
async function generateClientSecret(env) {
  const header = { alg: 'ES256', kid: env.APPLE_KEY_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: env.APPLE_CLIENT_ID,
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importApplePrivateKey(env.APPLE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput)
  );

  // Web Crypto's ECDSA sign() already returns raw (r||s) bytes, which is
  // exactly the format JWS ES256 expects — no DER conversion needed.
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${encodedSignature}`;
}

function decodeIdTokenPayload(idToken) {
  // Trusted the same way the Google callback trusts its id_token: it came
  // straight from Apple over HTTPS in the server-to-server exchange below
  // (not passed through the browser), so we decode without re-verifying
  // the signature.
  const payload = idToken.split('.')[1];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const form = await request.formData();

    const code = form.get('code');
    const state = form.get('state');
    const error = form.get('error');

    if (error) {
      return Response.redirect(`${url.origin}/?auth_error=${encodeURIComponent(error)}`, 302);
    }

    // Verify CSRF state matches the cookie set before redirecting to Apple.
    const cookies = request.headers.get('cookie') || '';
    const cookieState = cookies.split('; ').find((c) => c.startsWith('wwp_apple_oauth_state='))?.split('=')[1];

    if (!code || !state || !cookieState || state !== cookieState) {
      return Response.redirect(`${url.origin}/?auth_error=invalid_state`, 302);
    }

    const redirectUri = `${url.origin}/api/auth/apple/callback`;
    const clientSecret = await generateClientSecret(env);

    const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error('apple token exchange failed:', await tokenRes.text());
      return Response.redirect(`${url.origin}/?auth_error=token_exchange_failed`, 302);
    }

    const tokenData = await tokenRes.json();
    const claims = decodeIdTokenPayload(tokenData.id_token);
    const email = claims.email;

    if (!email) {
      return Response.redirect(`${url.origin}/?auth_error=no_email`, 302);
    }

    const db = env.DB;

    // Find or create user (same users table Google/magic-link sign-in use).
    let user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();

    if (!user) {
      const userId = crypto.randomUUID();
      await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(userId, email).run();
      user = { id: userId };
    }

    const now = new Date().toISOString();
    await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, user.id).run();

    // Create session, same as the Google/magic-link flow.
    const sessionId = generateSessionId();
    const sessionExpiry = new Date();
    sessionExpiry.setDate(sessionExpiry.getDate() + 7);

    await env.SESSIONS.put(
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
    headers.append('Set-Cookie', `wwp_apple_oauth_state=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);

    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('apple callback error:', err);
    const origin = new URL(context.request.url).origin;
    return Response.redirect(`${origin}/?auth_error=internal_error`, 302);
  }
}

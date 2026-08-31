// functions/api/auth/apple.js
// GET /api/auth/apple — redirects to Apple's Sign In consent screen.
//
// Requires these Cloudflare secrets (see functions/api/auth/apple/callback.js
// header comment for where to get each one from the Apple Developer portal):
//   APPLE_CLIENT_ID   — the Services ID, e.g. "com.wherewepraying.web"
//   APPLE_TEAM_ID
//   APPLE_KEY_ID
//   APPLE_PRIVATE_KEY

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const redirectUri = `${origin}/api/auth/apple/callback`;

  // CSRF protection: random state, verified when Apple calls back.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: context.env.APPLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Apple requires form_post (not query-string redirect) whenever
    // 'scope' is requested, so the callback must accept a POST body.
    response_mode: 'form_post',
    scope: 'name email',
    state,
  });

  const appleAuthUrl = `https://appleid.apple.com/auth/authorize?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: appleAuthUrl,
      'Set-Cookie': `wwp_apple_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=600`,
    },
  });
}

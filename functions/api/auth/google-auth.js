// functions/api/auth/google.js
// GET /api/auth/google — redirects to Google's OAuth consent screen

const GOOGLE_CLIENT_ID = '662750148844-ongjct7hv8vi4ai0h51feir16p6j4ccd.apps.googleusercontent.com';

export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  // CSRF protection: random state, verified when Google calls back.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl,
      'Set-Cookie': `wwp_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

// functions/api/send-magic-link.js
// POST /api/send-magic-link
// Generates a magic link token and emails it via Resend.
//
// Hardened 27 Sep 2026:
//  - link lasts 30 minutes (was 24 hours)
//  - only a SHA-256 hash of the token is stored, in KV, never the token
//    itself — a database leak can't be turned into sign-ins
//  - no account is created until the link is actually clicked, so nobody
//    can fill the users table with made-up emails
//  - emails are trimmed + lowercased so "Me@X.com" and "me@x.com" are the
//    same account
// verify-token.js finishes the job (finds or creates the user).

import { sha256Hex } from '../_lib/hash.js';

const MAGIC_LINK_TTL_SECONDS = 30 * 60;

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function onRequestPost(context) {
  try {
    let body = {};
    try { body = await context.request.json(); } catch (e) { /* handled below */ }
    const email = String((body && body.email) || '').trim().toLowerCase();

    if (!EMAIL_RE.test(email) || email.length > 254) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const token = generateToken();
    await context.env.SESSIONS.put(
      `ml:${await sha256Hex(token)}`,
      JSON.stringify({ email, createdAt: Date.now() }),
      { expirationTtl: MAGIC_LINK_TTL_SECONDS }
    );

    // Send email via Resend — branded template matching broadcast emails
    const magicLink = `${new URL(context.request.url).origin}/verify?token=${token}`;
    const html = buildMagicLinkHtml(magicLink);
    const text = `Assalamu alaikum,\n\nClick the link below to sign in to your WhereWePraying? account:\n${magicLink}\n\nThis link expires in 30 minutes. If you didn't request this, you can safely ignore this email.`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'noreply@wherewepraying.com',
        to: email,
        subject: 'Your Sign-In Link — WhereWePraying?',
        html,
        text,
      }),
    });

    if (!emailRes.ok) {
      console.error('Resend send failed', emailRes.status, await emailRes.text().catch(() => ''));
      return new Response(
        JSON.stringify({ error: "Couldn't send the email. Please try again." }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ success: true, message: 'Check your email for the sign-in link.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-magic-link error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function buildMagicLinkHtml(magicLink) {
  const iconUrl = 'https://wherewepraying.com/assets/email-icon.png';

  return `<html>
<body style="margin:0; padding:24px 16px; background-color:#fbe4d8; font-family:'Manrope',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto;">
    <tr>
      <td style="padding:4px;">
        <!-- outer border -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #f4a184; border-radius:28px;">
          <tr>
            <td style="padding:6px;">
              <!-- inner border -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f4c2ab; border-radius:22px; background-color:#fdf6f0;">
                <tr>
                  <td style="padding:44px 36px 36px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

                      <!-- icon -->
                      <tr>
                        <td align="center">
                          <img src="${iconUrl}" alt="WhereWePraying" width="88" style="display:block; width:88px; height:auto; border-radius:20px;">
                        </td>
                      </tr>

                      <!-- heart divider -->
                      <tr>
                        <td align="center" style="padding:28px 0 30px;">
                          <span style="color:#f4a184; font-size:14px; letter-spacing:2px;">&mdash; &#10084; &mdash;</span>
                        </td>
                      </tr>

                      <!-- message -->
                      <tr>
                        <td align="center" style="text-align:center;">
                          <p style="margin:0 0 16px; font-size:15px; color:#5c4033; line-height:1.7;">Assalamu alaikum,</p>
                          <p style="margin:0 0 16px; font-size:15px; color:#5c4033; line-height:1.7;">Click the button below to sign in to your WhereWePraying? account.</p>
                        </td>
                      </tr>

                      <!-- sign in button -->
                      <tr>
                        <td align="center" style="padding-top:8px; padding-bottom:8px;">
                          <a href="${magicLink}" style="display:inline-block; background-color:#f4714e; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:13px 32px; border-radius:999px; font-family:'Manrope',Arial,sans-serif;">Sign In</a>
                        </td>
                      </tr>

                      <!-- expiry note -->
                      <tr>
                        <td align="center" style="padding-top:24px;">
                          <p style="margin:0; font-size:13px; color:#a88f7d; line-height:1.6;">This link expires in 30 minutes.<br>If you didn't request this, you can safely ignore this email.</p>
                        </td>
                      </tr>

                      <!-- dot divider -->
                      <tr>
                        <td align="center" style="padding:34px 0 26px;">
                          <span style="color:#f4c2ab; font-size:12px; letter-spacing:2px;">&mdash; &#8226; &mdash;</span>
                        </td>
                      </tr>

                      <!-- url pill -->
                      <tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                            <tr>
                              <td style="background-color:#fbe4d8; border-radius:999px; padding:10px 22px;">
                                <span style="color:#f4714e; font-weight:700; font-size:14px; text-decoration:none;">wherewepraying.com</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

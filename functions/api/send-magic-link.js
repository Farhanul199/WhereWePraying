// functions/api/send-magic-link.js
// POST /api/send-magic-link
// Generates a magic link token and emails it via Resend

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getExpiryTime() {
  const expiryDate = new Date();
  expiryDate.setHours(expiryDate.getHours() + 24); // 24-hour expiry
  return expiryDate.toISOString();
}

export async function onRequestPost(context) {
  try {
    const { email } = await context.request.json();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = context.env.DB;
    const token = generateToken();
    const expiresAt = getExpiryTime();

    // Check if user exists; if not, create
    let user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();

    if (!user) {
      const userId = crypto.randomUUID();
      await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(userId, email).run();
      user = { id: userId };
    }

    // Insert magic token
    await db
      .prepare('INSERT INTO magic_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), user.id, token, expiresAt)
      .run();

    // Send email via Resend — branded template matching broadcast emails
    const magicLink = `${new URL(context.request.url).origin}/verify?token=${token}`;
    const html = buildMagicLinkHtml(magicLink);
    const text = `Assalamu alaikum,\n\nClick the link below to sign in to your WhereWePraying? account:\n${magicLink}\n\nThis link expires in 24 hours. If you didn't request this, you can safely ignore this email.`;

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
      const err = await emailRes.json();
      return new Response(
        JSON.stringify({
          error: 'Email send failed',
          details: err.message || 'Unknown error',
        }),
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
  const iconUrl = 'https://raw.githubusercontent.com/Farhanul199/WhereWePraying/main/assets/email-icon.png';

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
                          <p style="margin:0; font-size:13px; color:#a88f7d; line-height:1.6;">This link expires in 24 hours.<br>If you didn't request this, you can safely ignore this email.</p>
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

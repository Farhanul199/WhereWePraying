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

    // Send email via Resend
    const magicLink = `${new URL(context.request.url).origin}/verify?token=${token}`;
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'noreply@wherewepraying.com',
        to: email,
        subject: 'Your Magic Link — WhereWePraying?',
        html: `
          <p>Assalamu alaikum,</p>
          <p>Click the link below to sign in to your WhereWePraying? account:</p>
          <p><a href="${magicLink}" style="display:inline-block;padding:12px 24px;background:#F4714E;color:white;text-decoration:none;border-radius:6px;font-weight:600;">Sign In</a></p>
          <p>This link expires in 24 hours. If you didn't request this, ignore this email.</p>
          <p style="color:#999;font-size:12px;">Where we praying? — Find out. Get there. Catch the Jama'ah.</p>
        `,
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

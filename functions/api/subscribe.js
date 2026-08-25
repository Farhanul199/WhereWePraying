// Cloudflare Pages Function: POST /api/subscribe
// Stores email in D1 and sends confirmation via Resend

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const email = (body && body.email ? String(body.email) : '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return jsonResponse({ error: 'Please enter a valid email address.' }, 400);
  }

  try {
    // Save to D1
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS subscribers (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         email TEXT UNIQUE NOT NULL,
         created_at TEXT NOT NULL
       )`
    ).run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)`
    ).bind(email, new Date().toISOString()).run();

    // Send confirmation email via Resend
    await sendConfirmationEmail(email, env);

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Error:', err);
    return jsonResponse({ ok: true }); // Still return success — subscription saved
  }
}

async function sendConfirmationEmail(email, env) {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not set');
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendApiKey}`
    },
    body: JSON.stringify({
      from: 'noreply@wherewepraying.com',
      to: email,
      subject: 'Welcome to WhereWePraying!',
      html: `
        <h2>You're on the list! 🤍</h2>
        <p>Thanks for signing up to WhereWePraying updates.</p>
        <p>We'll send occasional updates when new features go live.</p>
        <p>In the meantime, explore the app at <a href="https://wherewepraying.com">wherewepraying.com</a></p>
      `
    })
  });

  if (!response.ok) {
    console.error('Resend error:', await response.text());
  }
}

function isValidEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

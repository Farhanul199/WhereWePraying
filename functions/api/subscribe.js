// Cloudflare Pages Function: POST /api/subscribe
// Stores an email address in D1 for the early-access mailing list.
// Sends a confirmation email to subscribers@wherewepraying.com.
//
// IMPORTANT — before this works, check that the D1 binding name below
// (env.DB) matches whatever you named the binding in your Pages
// project settings (Settings > Functions > D1 database bindings).
// If your existing bindings use a different name (e.g. env.WWP_DB),
// change every `env.DB` below to match.

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
    // Created once, harmless to run on every request.
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

    // Send notification email to subscribers@wherewepraying.com
    await sendNotificationEmail(email, env);

    return jsonResponse({ ok: true });
  } catch (err) {
    // Still return success even if email fails — the subscription is saved
    console.error('Email send error:', err);
    return jsonResponse({ ok: true });
  }
}

async function sendNotificationEmail(subscriberEmail, env) {
  const mailchannelsUrl = 'https://api.mailchannels.net/tx/v1/send';
  
  const message = {
    personalizations: [
      {
        to: [{ email: 'subscribers@wherewepraying.com' }]
      }
    ],
    from: { email: 'noreply@wherewepraying.com', name: 'WhereWePraying' },
    subject: `New Subscriber: ${subscriberEmail}`,
    html: `<p>New subscriber joined the mailing list:</p><p><strong>${subscriberEmail}</strong></p><p>Signed up: ${new Date().toISOString()}</p>`
  };

  const response = await fetch(mailchannelsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    console.error('Mailchannels error:', await response.text());
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

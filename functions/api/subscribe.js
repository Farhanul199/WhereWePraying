// Cloudflare Pages Function: POST /api/subscribe
// Stores email in D1 and sends confirmation via Resend with HTML template

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
    return jsonResponse({ ok: true });
  }
}

async function sendConfirmationEmail(email, env) {
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('RESEND_API_KEY not set');
    return;
  }

  const htmlContent = `<html>
<body style="font-family: Arial, sans-serif; background-color: #fbf3ec; padding: 20px; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #fefdfb; border: 2px solid #f4a896; border-radius: 24px; padding: 60px 40px; text-align: center;">
    
    <div style="margin-bottom: 40px;">
      <div style="width: 140px; height: 140px; background-color: #f5ede2; border-radius: 20px; margin: 0 auto; display: flex; align-items: center; justify-content: center;">
        <div style="text-align: center;">
          <div style="font-size: 60px;">🕌</div>
        </div>
      </div>
    </div>
    
    <p style="font-size: 13px; letter-spacing: 2px; color: #5c4033; font-weight: 600; margin-bottom: 16px; text-transform: uppercase;">Welcome your on the list,</p>
    
    <p style="margin: 24px 0; color: #f4714e;">❤️</p>
    
    <h1 style="font-size: 48px; font-weight: 800; color: #3d2817; margin-bottom: 24px; margin-top: 0;">You're on the list! 🤍</h1>
    
    <p style="margin-bottom: 32px;"><span style="width: 6px; height: 6px; background-color: #f4714e; border-radius: 50%; display: inline-block;"></span></p>
    
    <p style="font-size: 18px; color: #3d2817; line-height: 1.6; margin-bottom: 24px;">Thanks for signing up to<br>WhereWePraying updates.</p>
    
    <p style="font-size: 18px; color: #3d2817; line-height: 1.6; margin-bottom: 24px;">We'll send occasional updates<br>when new features go live.</p>
    
    <p style="font-size: 18px; color: #3d2817; line-height: 1.6; margin-bottom: 24px;">In the meantime, explore the app at</p>
    
    <a href="https://wherewepraying.com" style="color: #f4714e; text-decoration: none; font-weight: 600; background-color: #f5ede2; padding: 12px 32px; border-radius: 8px; display: inline-block; margin-bottom: 40px;">wherewepraying.com</a>
    
    <p style="margin-top: 40px; font-size: 24px; color: #d4a5a5; letter-spacing: 8px;">🌿 · 🌿</p>
    
  </div>
</body>
</html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${resendApiKey}\`
    },
   body: JSON.stringify({
  from: 'noreply@wherewepraying.com',
  to: email,
  subject: 'Welcome to WhereWePraying! 🤍',
  html: htmlContent,
  text: 'You\'re on the list! Thanks for signing up to WhereWePraying updates. Visit https://wherewepraying.com'
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

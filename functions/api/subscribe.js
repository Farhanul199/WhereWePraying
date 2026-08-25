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

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to WhereWePraying</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            background-color: #fbf3ec;
            padding: 20px;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #fbf3ec;
        }
        .card {
            background-color: #fefdfb;
            border: 2px solid #f4a896;
            border-radius: 24px;
            padding: 60px 40px;
            position: relative;
            text-align: center;
        }
        .corner {
            position: absolute;
            width: 8px;
            height: 8px;
            background-color: #f4714e;
            border-radius: 50%;
        }
        .corner-tl { top: 20px; left: 20px; }
        .corner-tr { top: 20px; right: 20px; }
        .corner-bl { bottom: 20px; left: 20px; }
        .corner-br { bottom: 20px; right: 20px; }
        .icon-container {
            margin-bottom: 40px;
        }
        .icon-bg {
            width: 140px;
            height: 140px;
            background-color: #f5ede2;
            border-radius: 20px;
            margin: 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }
        .mihrab {
            width: 80px;
            height: 100px;
            position: relative;
        }
        .mihrab-arch {
            width: 60px;
            height: 70px;
            background-color: #f4714e;
            border-radius: 30px 30px 0 0;
            margin: 0 auto;
            position: relative;
        }
        .mihrab-shadow {
            width: 50px;
            height: 50px;
            background-color: #f4a896;
            border-radius: 0 0 25px 0;
            position: absolute;
            bottom: -50px;
            left: 30px;
            transform: skewY(-20deg);
        }
        .welcome-label {
            font-size: 13px;
            letter-spacing: 2px;
            color: #5c4033;
            font-weight: 600;
            margin-bottom: 16px;
            text-transform: uppercase;
        }
        .divider {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 24px;
        }
        .divider-line {
            width: 40px;
            height: 1px;
            background-color: #f4a896;
        }
        .divider-heart {
            color: #f4714e;
            font-size: 16px;
        }
        .main-heading {
            font-size: 48px;
            font-weight: 800;
            color: #3d2817;
            margin-bottom: 24px;
            line-height: 1.2;
            font-family: 'Georgia', serif;
        }
        .dot {
            display: inline-block;
            width: 6px;
            height: 6px;
            background-color: #f4714e;
            border-radius: 50%;
            margin: 0 8px;
        }
        .body-text {
            font-size: 18px;
            color: #3d2817;
            line-height: 1.6;
            margin-bottom: 24px;
            font-weight: 400;
        }
        .cta-link {
            color: #f4714e;
            text-decoration: none;
            font-weight: 600;
            background-color: #f5ede2;
            padding: 12px 32px;
            border-radius: 8px;
            display: inline-block;
            margin-bottom: 40px;
        }
        .cta-link:hover {
            background-color: #f0e0d5;
        }
        .ornament {
            margin-top: 40px;
            font-size: 24px;
            color: #d4a5a5;
            letter-spacing: 8px;
        }
        .heart-emoji {
            font-size: 20px;
            margin-left: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="card">
            <div class="corner corner-tl"></div>
            <div class="corner corner-tr"></div>
            <div class="corner corner-bl"></div>
            <div class="corner corner-br"></div>
            
            <div class="icon-container">
                <div class="icon-bg">
                    <div class="mihrab">
                        <div class="mihrab-arch"></div>
                        <div class="mihrab-shadow"></div>
                    </div>
                </div>
            </div>
            
            <div class="welcome-label">Welcome your on the list,</div>
            
            <div class="divider">
                <div class="divider-line"></div>
                <div class="divider-heart">❤️</div>
                <div class="divider-line"></div>
            </div>
            
            <h1 class="main-heading">You're on the list!<span class="heart-emoji">🤍</span></h1>
            
            <div style="text-align: center; margin-bottom: 32px;">
                <span class="dot"></span>
            </div>
            
            <p class="body-text">Thanks for signing up to<br>WhereWePraying updates.</p>
            
            <p class="body-text">We'll send occasional updates<br>when new features go live.</p>
            
            <p class="body-text">In the meantime, explore the app at</p>
            
            <a href="https://wherewepraying.com" class="cta-link">wherewepraying.com</a>
            
            <div class="ornament">🌿 · 🌿</div>
        </div>
    </div>
</body>
</html>\`;

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

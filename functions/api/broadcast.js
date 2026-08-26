// Cloudflare Pages Function: POST /api/broadcast
// Sends a one-off email to every row in the `subscribers` D1 table via Resend.
// Protected by a secret key so randoms can't trigger it.
//
// Usage (from your terminal, once deployed):
//
// curl -X POST https://wherewepraying.com/api/broadcast \
//   -H "Content-Type: application/json" \
//   -H "X-Broadcast-Key: YOUR_BROADCAST_SECRET" \
//   -d '{
//     "subject": "New feature: Prayer Times world clocks",
//     "html": "<p>Hey! We just shipped ...</p>",
//     "text": "Hey! We just shipped ..."
//   }'

export async function onRequestPost(context) {
  const { request, env } = context;

  // --- auth check ---
  const key = request.headers.get('X-Broadcast-Key');
  if (!env.BROADCAST_SECRET || key !== env.BROADCAST_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const subject = (body && body.subject ? String(body.subject) : '').trim();
  const message = (body && body.message ? String(body.message) : '').trim();
  const buttonText = (body && body.buttonText ? String(body.buttonText) : '').trim();
  const buttonUrl = (body && body.buttonUrl ? String(body.buttonUrl) : '').trim();

  if (!subject || !message) {
    return jsonResponse({ error: 'subject and message are required.' }, 400);
  }

  const html = buildEmailHtml(message, buttonText, buttonUrl);
  const text = message + (buttonText && buttonUrl ? `\n\n${buttonText}: ${buttonUrl}` : '');

  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    return jsonResponse({ error: 'RESEND_API_KEY not set.' }, 500);
  }

  // --- pull all subscribers ---
  let subscribers;
  try {
    const { results } = await env.DB.prepare(
      `SELECT email FROM subscribers`
    ).all();
    subscribers = results || [];
  } catch (err) {
    return jsonResponse({ error: 'Failed to read subscribers: ' + err.message }, 500);
  }

  if (subscribers.length === 0) {
    return jsonResponse({ ok: true, sent: 0, message: 'No subscribers found.' });
  }

  // --- send via Resend batch API (up to 100 per batch call) ---
  const BATCH_SIZE = 100;
  let sent = 0;
  const errors = [];

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const chunk = subscribers.slice(i, i + BATCH_SIZE);

    const payload = chunk.map(row => ({
      from: 'noreply@wherewepraying.com',
      to: row.email,
      subject,
      html: html || undefined,
      text: text || undefined
    }));

    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        errors.push(`Batch ${i}-${i + chunk.length}: ${errText}`);
      } else {
        sent += chunk.length;
      }
    } catch (err) {
      errors.push(`Batch ${i}-${i + chunk.length}: ${err.message}`);
    }
  }

  return jsonResponse({
    ok: errors.length === 0,
    total: subscribers.length,
    sent,
    errors
  });
}

function buildEmailHtml(message, buttonText, buttonUrl) {
  const messageHtml = message
    .split('\n')
    .map(line => line.trim() ? `<p style="margin:0 0 16px; font-size:15px; color:#5c4033; line-height:1.7;">${escapeHtml(line)}</p>` : '')
    .join('');

  const buttonHtml = (buttonText && buttonUrl) ? `
          <tr>
            <td align="center" style="padding-top:8px; padding-bottom:8px;">
              <a href="${escapeAttr(buttonUrl)}" style="display:inline-block; background-color:#f4714e; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:13px 32px; border-radius:999px; font-family:'Manrope',Arial,sans-serif;">${escapeHtml(buttonText)}</a>
            </td>
          </tr>` : '';

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
                          <span style="color:#f4a184; font-size:14px; letter-spacing:2px;">— &#10084; —</span>
                        </td>
                      </tr>

                      <!-- message -->
                      <tr>
                        <td align="center" style="text-align:center;">
                          ${messageHtml}
                        </td>
                      </tr>

                      ${buttonHtml}

                      <!-- dot divider -->
                      <tr>
                        <td align="center" style="padding:34px 0 26px;">
                          <span style="color:#f4c2ab; font-size:12px; letter-spacing:2px;">— &#8226; —</span>
                        </td>
                      </tr>

                      <!-- url pill -->
                      <tr>
                        <td align="center">
                          <span style="display:inline-block; background-color:#fbe4d8; color:#f4714e; font-weight:700; font-size:14px; padding:10px 22px; border-radius:999px;">wherewepraying.com</span>
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

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

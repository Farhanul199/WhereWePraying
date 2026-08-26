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
  const html = body && body.html ? String(body.html) : '';
  const text = body && body.text ? String(body.text) : '';

  if (!subject || (!html && !text)) {
    return jsonResponse({ error: 'subject and (html or text) are required.' }, 400);
  }

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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

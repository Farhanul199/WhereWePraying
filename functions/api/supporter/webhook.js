// functions/api/supporter/webhook.js
// POST /api/supporter/webhook — Stripe webhook endpoint.
// Verifies the Stripe-Signature header manually (no Stripe SDK needed in
// the Workers runtime) and, on checkout.session.completed, flags the
// paying user's account as a Supporter (users.is_supporter = 1), which
// is what turns on the gold ring/badge already built into the UI.
//
// Known limitation: this does NOT auto-revoke is_supporter if a monthly
// subscription is later cancelled — there's no stripe_customer_id column
// linking a subscription back to a user_id yet. Fine for a first pass;
// revisit if/when subscription churn needs to reflect in the badge.

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;

  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const idx = kv.indexOf('=');
      return [kv.slice(0, idx), kv.slice(idx + 1)];
    })
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  const expectedHex = bytesToHex(mac);

  // Constant-time-ish comparison.
  if (expectedHex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: 'Webhook not configured.' }, 500);
  }

  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature');

  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return json({ error: 'Invalid signature.' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return json({ error: 'Invalid payload.' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const sessionObj = event.data?.object;
    const userId = parseInt(sessionObj?.client_reference_id, 10);
    if (Number.isInteger(userId)) {
      await env.DB.prepare(`UPDATE users SET is_supporter = 1 WHERE id = ?1`).bind(userId).run();
    }
  }

  return json({ received: true });
}

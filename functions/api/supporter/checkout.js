// functions/api/supporter/checkout.js
// POST /api/supporter/checkout  body: { amount: <dollars, number>, mode: 'payment'|'subscription' }
// Signed-in only. Creates a Stripe Checkout Session with inline pricing
// (no pre-created Stripe Products/Prices needed) and Apple Pay / Google
// Pay enabled automatically via automatic_payment_methods. Returns the
// hosted Checkout URL for the frontend to redirect to.

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 500;

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveSession(context) {
  try {
    const cookies = context.request.headers.get('cookie') || '';
    const sessionId = cookies.split('; ').find((c) => c.startsWith('wwp_session='))?.split('=')[1];
    if (!sessionId) return null;
    const raw = await context.env.SESSIONS.get(sessionId);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (new Date(session.expiresAt) < new Date()) return null;
    return session;
  } catch (e) {
    return null;
  }
}

function toFormBody(obj, prefix) {
  // Stripe's API takes application/x-www-form-urlencoded with
  // bracket-notation for nested fields (its usual SDKs do this for you).
  const parts = [];
  for (const key in obj) {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parts.push(toFormBody(value, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (v && typeof v === 'object') parts.push(toFormBody(v, `${fullKey}[${i}]`));
        else parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(v)}`);
      });
    } else if (value !== undefined && value !== null) {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join('&');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Supporter payments are not configured yet.' }, 500);
  }

  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: 'Sign in required.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const amount = Math.round(Number(body.amount));
  const mode = body.mode === 'subscription' ? 'subscription' : 'payment';

  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return json({ error: `Please choose an amount between $${MIN_AMOUNT} and $${MAX_AMOUNT}.` }, 400);
  }

  const user = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`).bind(session.userId).first();

  const origin = new URL(request.url).origin;

  const priceData = {
    currency: 'usd',
    unit_amount: amount * 100,
    product_data: { name: 'WhereWePraying? Supporter' },
  };
  if (mode === 'subscription') {
    priceData.recurring = { interval: 'month' };
  }

  const payload = {
    mode,
    'automatic_payment_methods[enabled]': 'true',
    client_reference_id: String(session.userId),
    customer_email: user ? user.email : undefined,
    success_url: `${origin}/?supporter_success=1`,
    cancel_url: `${origin}/?supporter_cancel=1`,
    line_items: [{ quantity: 1, price_data: priceData }],
  };

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: toFormBody(payload),
    });

    const data = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('Stripe checkout session error', data);
      return json({ error: data.error?.message || 'Could not start checkout.' }, 502);
    }

    return json({ url: data.url });
  } catch (e) {
    console.error('Stripe request failed', e);
    return json({ error: 'Network error contacting Stripe.' }, 502);
  }
}

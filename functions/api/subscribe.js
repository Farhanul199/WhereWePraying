// Cloudflare Pages Function: POST /api/subscribe
// Stores an email address in D1 for the early-access mailing list.
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

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

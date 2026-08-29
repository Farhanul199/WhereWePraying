// functions/api/push/unsubscribe.js
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'invalid_json' }, 400);
  }
  const endpoint = body && body.endpoint;
  if (!endpoint) return json({ error: 'missing_endpoint' }, 400);

  try {
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1`).bind(endpoint).run();
  } catch (err) {
    return json({ error: 'db_error', message: String(err) }, 500);
  }
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

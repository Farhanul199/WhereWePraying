// functions/api/mosques/favorites.js
//
// GET  /api/mosques/favorites  -> signed-in only: { slugs: [...] }
//      every mosque the current user has favourited.
// POST /api/mosques/favorites  { mosque }  -> signed-in only: toggles
//      the favourite for that mosque, returns { favorited: true|false }.

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function resolveSession(context) {
  try {
    const cookies = context.request.headers.get("cookie") || "";
    const sessionId = cookies.split("; ").find((c) => c.startsWith("wwp_session="))?.split("=")[1];
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

export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: "Sign in required." }, 401);
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT mosque FROM mosque_favorites WHERE user_id = ?1`
    )
      .bind(session.userId)
      .all();
    return json({ slugs: (results || []).map((r) => r.mosque) });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: "Sign in required." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "Invalid request body." }, 400);
  }
  const mosque = String(body.mosque || "").trim();
  if (!mosque) return json({ error: "mosque is required" }, 400);

  const db = context.env.DB;
  try {
    const existing = await db
      .prepare(`SELECT id FROM mosque_favorites WHERE user_id = ?1 AND mosque = ?2`)
      .bind(session.userId, mosque)
      .first();

    if (existing) {
      await db.prepare(`DELETE FROM mosque_favorites WHERE id = ?1`).bind(existing.id).run();
      return json({ favorited: false });
    }

    await db
      .prepare(`INSERT INTO mosque_favorites (user_id, mosque, created_at) VALUES (?1, ?2, ?3)`)
      .bind(session.userId, mosque, Date.now())
      .run();
    return json({ favorited: true });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

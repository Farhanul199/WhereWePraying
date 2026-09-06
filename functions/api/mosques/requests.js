// functions/api/mosques/requests.js
//
// GET  /api/mosques/requests?status=pending   -> admin only (X-Broadcast-Key):
//      { requests: [...] }. status can be "pending" (default) or "all".
//
// POST /api/mosques/requests
//      Admin path (X-Broadcast-Key header present):
//        { action: "review", requestId, status: "approved"|"rejected" }
//        Marks a request reviewed. Approving does NOT auto-create the
//        mosque — use the existing Locations tab to actually add it
//        once you've checked the details.
//
//      Public path (signed-in users, same session cookie as favourites):
//        { name, address, website, notes } -> creates a pending request.
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function isAdmin(context) {
  const key = context.request.headers.get("X-Broadcast-Key");
  return !!(context.env.BROADCAST_SECRET && key === context.env.BROADCAST_SECRET);
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
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  try {
    const url = new URL(context.request.url);
    const status = url.searchParams.get("status") || "pending";
    const db = context.env.DB;
    const stmt = status === "all"
      ? db.prepare(`SELECT * FROM mosque_requests ORDER BY created_at DESC`)
      : db.prepare(`SELECT * FROM mosque_requests WHERE status = ?1 ORDER BY created_at DESC`).bind(status);
    const { results } = await stmt.all();
    return json({ requests: results || [] });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;

  if (isAdmin(context)) {
    let body;
    try {
      body = await context.request.json();
    } catch (e) {
      return json({ error: "Invalid request body." }, 400);
    }
    if (body.action === "review") {
      const requestId = body.requestId;
      const status = String(body.status || "").trim();
      if (!requestId || !status) return json({ error: "requestId and status required" }, 400);
      try {
        await db.prepare(`UPDATE mosque_requests SET status = ?1 WHERE id = ?2`).bind(status, requestId).run();
        return json({ ok: true });
      } catch (e) {
        return json({ error: "db_error", message: String(e) }, 500);
      }
    }
    return json({ error: "invalid action" }, 400);
  }

  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: "Sign in required." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "Invalid request body." }, 400);
  }
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "Mosque name is required." }, 400);
  const address = String(body.address || "").trim();
  const website = String(body.website || "").trim();
  const notes = String(body.notes || "").trim();

  try {
    await db.prepare(
      `INSERT INTO mosque_requests (name, address, website, notes, user_id, username, email, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8)`
    ).bind(
      name, address, website, notes,
      session.userId, session.username || null, session.email || null,
      Date.now()
    ).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

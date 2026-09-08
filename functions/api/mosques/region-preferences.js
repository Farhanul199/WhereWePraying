// functions/api/mosques/region-preferences.js
//
// GET  /api/mosques/region-preferences  -> signed-in only:
//      { hidden: [...regions], favorite: region|null }
// POST /api/mosques/region-preferences  { region, action }
//      action = "hide"     -> toggles hidden for that region
//      action = "favorite" -> sets that region as the sole favourite
//                              (clicking an already-favourited region
//                              clears it). Only one region can be
//                              favourited at a time.

import { resolveSession } from '../../_lib/session.js';
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
export async function onRequestGet(context) {
  const session = await resolveSession(context);
  if (!session || !session.userId) return json({ error: "Sign in required." }, 401);
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT region, hidden, favorite FROM region_preferences WHERE user_id = ?1`
    )
      .bind(session.userId)
      .all();
    const hidden = (results || []).filter((r) => r.hidden).map((r) => r.region);
    const favRow = (results || []).find((r) => r.favorite);
    return json({ hidden, favorite: favRow ? favRow.region : null });
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
  const region = String(body.region || "").trim();
  const action = String(body.action || "").trim();
  if (!region) return json({ error: "region is required" }, 400);
  const db = context.env.DB;
  try {
    if (action === "hide") {
      const existing = await db
        .prepare(`SELECT id, hidden FROM region_preferences WHERE user_id = ?1 AND region = ?2`)
        .bind(session.userId, region)
        .first();
      if (existing) {
        const newHidden = existing.hidden ? 0 : 1;
        await db
          .prepare(`UPDATE region_preferences SET hidden = ?1, updated_at = ?2 WHERE id = ?3`)
          .bind(newHidden, Date.now(), existing.id)
          .run();
        return json({ hidden: !!newHidden });
      }
      await db
        .prepare(`INSERT INTO region_preferences (user_id, region, hidden, favorite, updated_at) VALUES (?1, ?2, 1, 0, ?3)`)
        .bind(session.userId, region, Date.now())
        .run();
      return json({ hidden: true });
    }

    if (action === "favorite") {
      const existing = await db
        .prepare(`SELECT id, favorite FROM region_preferences WHERE user_id = ?1 AND region = ?2`)
        .bind(session.userId, region)
        .first();
      const turningOn = !(existing && existing.favorite);

      // Only one favourite region at a time — clear any existing one first.
      await db
        .prepare(`UPDATE region_preferences SET favorite = 0, updated_at = ?1 WHERE user_id = ?2 AND favorite = 1`)
        .bind(Date.now(), session.userId)
        .run();

      if (turningOn) {
        if (existing) {
          await db
            .prepare(`UPDATE region_preferences SET favorite = 1, updated_at = ?1 WHERE id = ?2`)
            .bind(Date.now(), existing.id)
            .run();
        } else {
          await db
            .prepare(`INSERT INTO region_preferences (user_id, region, hidden, favorite, updated_at) VALUES (?1, ?2, 0, 1, ?3)`)
            .bind(session.userId, region, Date.now())
            .run();
        }
      }
      return json({ favorite: turningOn ? region : null });
    }

    return json({ error: "invalid action" }, 400);
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

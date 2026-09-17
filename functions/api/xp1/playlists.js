// functions/api/xp1/playlists.js
//
// XP1's playlist catalog — what Phase 9's admin page manages and what
// XP1's "Browse Playlists" picker reads. Backed by D1 (new table:
// xp1_playlists — see the CREATE TABLE statement Claude gave you to
// run in the D1 console once), not localStorage, so the admin can
// change what plays without touching code or redeploying.
//
// Auth reuses the existing admin pattern exactly (isAdminRequest,
// X-Broadcast-Key header, same BROADCAST_SECRET env var already used
// by /api/admin/mosque-mappings and /api/mosques/manage) — no new
// secret to set up.
//
// GET /api/xp1/playlists
//   No auth: returns only { active: true } playlists, ordered by
//     sort_order. This is what XP1's TV-side "Browse Playlists"
//     picker and the auto-selected default both read.
//   With a valid X-Broadcast-Key header: returns ALL playlists
//     (active and inactive), for the admin page's management view.
//
// POST /api/xp1/playlists  (application/json, admin-only)
//   { action:'create', title, youtube_url }
//   { action:'update', id, title?, youtube_url?, active? }
//   { action:'delete', id }
//   { action:'reorder', order:[id, id, id, ...] }  // sets sort_order
//       to each id's position in the array

import { isAdminRequest } from '../../_lib/auth.js';

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Same regex the TV-side JS uses (assets/xp1 XP1YouTube.parsePlaylistId) —
// kept identical on purpose so a URL that works client-side also works
// here, and vice versa.
function parsePlaylistId(url) {
  const m = String(url || "").match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function onRequestGet(context) {
  const { env } = context;
  const admin = isAdminRequest(context);
  try {
    const query = admin
      ? `SELECT id, title, youtube_url, playlist_id, sort_order, active FROM xp1_playlists ORDER BY sort_order ASC, id ASC`
      : `SELECT id, title, youtube_url, playlist_id, sort_order FROM xp1_playlists WHERE active = 1 ORDER BY sort_order ASC, id ASC`;
    const { results } = await env.DB.prepare(query).all();
    return json({ playlists: results || [] });
  } catch (e) {
    return json({ error: "Failed to load playlists", detail: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: "Unauthorized" }, 401);
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Invalid JSON body" }, 400); }
  const action = body && body.action;

  try {
    if (action === "create") {
      const title = (body.title || "").trim();
      const youtubeUrl = (body.youtube_url || "").trim();
      const playlistId = parsePlaylistId(youtubeUrl);
      if (!title || !playlistId) {
        return json({ error: "title and a valid youtube_url (with ?list=...) are required" }, 400);
      }
      const { results } = await env.DB.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM xp1_playlists`
      ).all();
      const nextOrder = results[0].next_order;
      const res = await env.DB.prepare(
        `INSERT INTO xp1_playlists (title, youtube_url, playlist_id, sort_order, active) VALUES (?, ?, ?, ?, 1)`
      ).bind(title, youtubeUrl, playlistId, nextOrder).run();
      return json({ ok: true, id: res.meta.last_row_id });
    }

    if (action === "update") {
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: "id is required" }, 400);
      const sets = [];
      const binds = [];
      if (typeof body.title === "string") { sets.push("title = ?"); binds.push(body.title.trim()); }
      if (typeof body.youtube_url === "string") {
        const playlistId = parsePlaylistId(body.youtube_url);
        if (!playlistId) return json({ error: "youtube_url has no ?list=... in it" }, 400);
        sets.push("youtube_url = ?", "playlist_id = ?");
        binds.push(body.youtube_url.trim(), playlistId);
      }
      if (typeof body.active === "boolean") { sets.push("active = ?"); binds.push(body.active ? 1 : 0); }
      if (!sets.length) return json({ error: "Nothing to update" }, 400);
      binds.push(id);
      await env.DB.prepare(`UPDATE xp1_playlists SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
      return json({ ok: true });
    }

    if (action === "delete") {
      const id = parseInt(body.id, 10);
      if (!id) return json({ error: "id is required" }, 400);
      await env.DB.prepare(`DELETE FROM xp1_playlists WHERE id = ?`).bind(id).run();
      return json({ ok: true });
    }

    if (action === "reorder") {
      const order = Array.isArray(body.order) ? body.order : null;
      if (!order || !order.length) return json({ error: "order (array of ids) is required" }, 400);
      // D1 doesn't support a multi-statement batch string reliably (same
      // gotcha as the D1 console) — batch() with individual prepared
      // statements is the correct way to do this atomically.
      const stmts = order.map((id, idx) =>
        env.DB.prepare(`UPDATE xp1_playlists SET sort_order = ? WHERE id = ?`).bind(idx, id)
      );
      await env.DB.batch(stmts);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: "Request failed", detail: String(e) }, 500);
  }
}

// functions/api/mosques/manage.js
//
// Admin-only (X-Broadcast-Key). Lets the admin add a new location
// (mosque, community hall, or prayer room) and enter its prayer times
// directly, without touching D1 by hand.
//
// GET  /api/mosques/manage
//      -> { locations: [{slug,name,type,active}, ...] } — every
//         location regardless of active status, for the admin's own
//         dropdowns/lists.
//
// POST /api/mosques/manage   (application/json)
//   { action:'create_location', name, slug?, type }
//     -> creates a new row in `mosques`. slug is auto-generated from
//        name if omitted. Fails if the slug already exists.
//   { action:'update_location', slug, name?, type?, active? }
//     -> updates an existing location's basic fields.
//   { action:'set_daily_times', slug, date, fajr?, zuhr?, asr?, maghrib?, isha? }
//     -> replaces that location's row in `thm_jamaah_times` for the
//        given date. Empty/omitted fields are stored as null.
//   { action:'set_jummah_times', slug, date, slots:[{slot,time}, ...] }
//     -> replaces all `jummah_times` rows for that location+date with
//        the given slots (Jummah is always assumed to be run on the
//        Friday you provide as `date`).

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

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const VALID_TYPES = ["mosque", "community_hall", "prayer_room"];

export async function onRequestGet(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  try {
    const { results } = await context.env.DB.prepare(
      `SELECT slug, name, type, active FROM mosques ORDER BY name ASC`
    ).all();
    return json({ locations: results || [] });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    if (body.action === "create_location") {
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "Name is required." }, 400);
      const type = VALID_TYPES.includes(body.type) ? body.type : "mosque";
      const slug = slugify(body.slug || name);
      if (!slug) return json({ error: "Couldn't work out a slug from that name." }, 400);

      const existing = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (existing) return json({ error: `A location with slug "${slug}" already exists.` }, 409);

      await db
        .prepare(`INSERT INTO mosques (slug, name, type, active) VALUES (?1, ?2, ?3, 1)`)
        .bind(slug, name, type)
        .run();
      return json({ success: true, slug });
    }

    if (body.action === "update_location") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "slug is required" }, 400);
      const sets = [];
      const binds = [];
      let i = 1;
      if (typeof body.name === "string" && body.name.trim()) {
        sets.push(`name = ?${i++}`);
        binds.push(body.name.trim());
      }
      if (VALID_TYPES.includes(body.type)) {
        sets.push(`type = ?${i++}`);
        binds.push(body.type);
      }
      if (typeof body.active === "boolean") {
        sets.push(`active = ?${i++}`);
        binds.push(body.active ? 1 : 0);
      }
      if (!sets.length) return json({ error: "Nothing to update." }, 400);
      binds.push(slug);
      await db.prepare(`UPDATE mosques SET ${sets.join(", ")} WHERE slug = ?${i}`).bind(...binds).run();
      return json({ success: true });
    }

    if (body.action === "set_daily_times") {
      const slug = String(body.slug || "").trim();
      const date = String(body.date || "").trim();
      if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "slug and a YYYY-MM-DD date are required." }, 400);
      }
      const clean = (v) => (v && String(v).trim() ? String(v).trim() : null);
      await db.prepare(`DELETE FROM thm_jamaah_times WHERE mosque = ?1 AND date = ?2`).bind(slug, date).run();
      await db
        .prepare(
          `INSERT INTO thm_jamaah_times (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        )
        .bind(slug, date, clean(body.fajr), clean(body.zuhr), clean(body.asr), clean(body.maghrib), clean(body.isha))
        .run();
      return json({ success: true });
    }

    if (body.action === "set_jummah_times") {
      const slug = String(body.slug || "").trim();
      const date = String(body.date || "").trim();
      const slots = Array.isArray(body.slots) ? body.slots : [];
      if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "slug and a YYYY-MM-DD date are required." }, 400);
      }
      await db.prepare(`DELETE FROM jummah_times WHERE location = ?1 AND date = ?2`).bind(slug, date).run();
      const now = Date.now();
      let slotNum = 1;
      for (const s of slots) {
        const time = String((s && s.time) || "").trim();
        if (!time) continue;
        await db
          .prepare(`INSERT INTO jummah_times (location, date, slot, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
          .bind(slug, date, slotNum++, time, now)
          .run();
      }
      return json({ success: true, slotsSaved: slotNum - 1 });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

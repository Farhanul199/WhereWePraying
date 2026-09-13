// functions/api/mosques/manage.js
//
// Admin-only (X-Broadcast-Key). Powers /admin/mosques.html — the single
// page where Farhanul can search, add, edit, hibernate and (optionally)
// fill in fallback prayer times for any location.
//
// KEY RULES BAKED IN HERE:
//  * Nothing is ever deleted. "Hibernate" = active = 0, which removes the
//    mosque from the R2 cache, /nearby, /plan and the mosque page.
//  * Any detail field you edit by hand is recorded in mosques.locked_fields.
//    The auto-matcher (mosque-mappings.js) skips locked fields, so a
//    scraper can never overwrite your correction.
//  * Prayer times entered here are a FALLBACK ONLY. They are written to
//    jamaah_raw under source 'manual', which sits at the BOTTOM of
//    source_priorities (90) — so a real scrape always wins, and your
//    manual times only surface when no scrape exists for that day.
//
// GET  /api/mosques/manage                -> { locations: [...] } (all, brief)
// GET  /api/mosques/manage?q=ilford       -> matching locations (brief)
// GET  /api/mosques/manage?slug=x         -> { mosque, locked, manual, fused, jummah }
//
// POST /api/mosques/manage   (application/json)
//   { action:'create_location', name, slug?, type?, city?, address?, postcode?,
//     latitude?, longitude?, website_url?, region? }
//   { action:'update_location', slug, <any editable field>, active?, unlock?:[fields] }
//   { action:'set_active', slug, active:true|false }
//   { action:'set_times_range', slug, days?, fajr?, zuhr?, asr?, maghrib?, isha?,
//     jummah?:[ '13:00', '14:00' ] }
//   { action:'clear_manual_times', slug }
//   -- legacy, still supported --
//   { action:'set_daily_times', slug, date, fajr?... }
//   { action:'set_jummah_times', slug, date, slots:[{slot,time}] }

import { isAdminRequest } from '../../_lib/auth.js';

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const isAdmin = isAdminRequest;

const VALID_TYPES = ["mosque", "community_hall", "prayer_room"];

// Detail fields the admin page can edit. Editing one locks it.
const TEXT_FIELDS = ["name", "city", "address", "postcode", "website_url", "region", "type"];
const NUM_FIELDS = ["latitude", "longitude"];
const EDITABLE = TEXT_FIELDS.concat(NUM_FIELDS);

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function londonDateIso(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysIso(dateIso, days) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayOfWeek(dateIso) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 5 = Friday
}

// "5:30" / "05:30" / "17.05" -> "05:30" | null if unusable
function normTime(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[:.\s](\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

function parseLocked(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function serialiseLocked(list) {
  const uniq = Array.from(new Set(list.filter((f) => EDITABLE.indexOf(f) !== -1)));
  return uniq.length ? uniq.join(",") : null;
}

async function selfMap(db, slug, nowIso) {
  await db
    .prepare(
      `INSERT INTO mosque_sources (source, source_ref, mosque_slug, first_seen, last_seen)
       VALUES ('manual', ?1, ?1, ?2, ?2)
       ON CONFLICT(source, source_ref) DO UPDATE SET
         mosque_slug = excluded.mosque_slug, last_seen = excluded.last_seen`
    )
    .bind(slug, nowIso)
    .run();
}

/* ------------------------------------------------------------------ GET */

export async function onRequestGet(context) {
  if (!isAdmin(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const slug = (url.searchParams.get("slug") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();

  try {
    if (slug) {
      const mosque = await db
        .prepare(
          `SELECT slug, name, city, address, postcode, latitude, longitude,
                  website_url, region, type, active, merged_into, locked_fields
           FROM mosques WHERE slug = ?1`
        )
        .bind(slug)
        .first();
      if (!mosque) return json({ error: "No location with that slug." }, 404);

      const today = londonDateIso();
      const [manualRow, fusedRow, jummahRes] = await Promise.all([
        db
          .prepare(
            `SELECT date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah
             FROM jamaah_raw WHERE source = 'manual' AND source_ref = ?1
             ORDER BY date DESC LIMIT 1`
          )
          .bind(slug)
          .first(),
        db
          .prepare(
            `SELECT fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, source
             FROM thm_jamaah_times WHERE mosque = ?1 AND date = ?2`
          )
          .bind(slug, today)
          .first(),
        db
          .prepare(
            `SELECT date, slot, time FROM jummah_raw
             WHERE source = 'manual' AND source_ref = ?1
             ORDER BY date DESC, slot ASC LIMIT 6`
          )
          .bind(slug)
          .all(),
      ]);

      const manualCount = await db
        .prepare(`SELECT COUNT(*) AS n FROM jamaah_raw WHERE source = 'manual' AND source_ref = ?1`)
        .bind(slug)
        .first();

      return json({
        mosque,
        locked: parseLocked(mosque.locked_fields),
        manual: manualRow || null,
        manual_days: (manualCount && manualCount.n) || 0,
        fused: fusedRow || null,
        jummah: (jummahRes && jummahRes.results) || [],
        today,
      });
    }

    let results;
    if (q) {
      const like = `%${q}%`;
      ({ results } = await db
        .prepare(
          `SELECT slug, name, type, city, address, postcode, active, merged_into, locked_fields
           FROM mosques
           WHERE name LIKE ?1 OR slug LIKE ?1 OR postcode LIKE ?1 OR address LIKE ?1 OR city LIKE ?1
           ORDER BY active DESC, name ASC LIMIT 60`
        )
        .bind(like)
        .all());
    } else {
      ({ results } = await db
        .prepare(
          `SELECT slug, name, type, city, address, postcode, active, merged_into, locked_fields
           FROM mosques ORDER BY name ASC LIMIT 60`
        )
        .all());
    }
    return json({ locations: results || [] });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

/* ----------------------------------------------------------------- POST */

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
    /* ---------------------------------------------------- create */
    if (body.action === "create_location") {
      const name = String(body.name || "").trim();
      if (!name) return json({ error: "Name is required." }, 400);
      const slug = slugify(body.slug || name);
      if (!slug) return json({ error: "Couldn't work out a slug from that name." }, 400);

      const existing = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (existing) return json({ error: `A location with slug "${slug}" already exists.` }, 409);

      const type = VALID_TYPES.indexOf(body.type) !== -1 ? body.type : "mosque";
      const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
      const city = str(body.city) || "London";
      const lat = num(body.latitude);
      const lon = num(body.longitude);

      const locked = serialiseLocked(
        EDITABLE.filter((f) => {
          if (f === "type" || f === "city") return true;
          if (f === "latitude") return lat != null;
          if (f === "longitude") return lon != null;
          return str(body[f]) != null;
        })
      );

      await db
        .prepare(
          `INSERT INTO mosques
             (slug, name, city, address, postcode, latitude, longitude, website_url,
              region, type, active, created_at, locked_fields)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12)`
        )
        .bind(
          slug, name, city, str(body.address), str(body.postcode), lat, lon,
          str(body.website_url), str(body.region), type, new Date().toISOString(), locked
        )
        .run();

      return json({ success: true, slug });
    }

    /* ---------------------------------------------------- update */
    if (body.action === "update_location") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "slug is required" }, 400);

      const row = await db
        .prepare(`SELECT locked_fields FROM mosques WHERE slug = ?1`)
        .bind(slug)
        .first();
      if (!row) return json({ error: "No location with that slug." }, 404);

      const sets = [];
      const binds = [];
      let i = 1;
      const touched = [];

      for (const f of TEXT_FIELDS) {
        if (typeof body[f] !== "string") continue;
        let val = body[f].trim();
        if (f === "type") {
          if (VALID_TYPES.indexOf(val) === -1) continue;
        }
        if (f === "name" && !val) return json({ error: "Name can't be blank." }, 400);
        if (f === "city" && !val) val = "London";
        sets.push(`${f} = ?${i++}`);
        binds.push(val || null);
        touched.push(f);
      }
      for (const f of NUM_FIELDS) {
        if (!(f in body)) continue;
        const raw = body[f];
        if (raw === "" || raw == null) {
          sets.push(`${f} = ?${i++}`);
          binds.push(null);
          touched.push(f);
          continue;
        }
        const n = Number(raw);
        if (isNaN(n)) return json({ error: `${f} must be a number.` }, 400);
        if (f === "latitude" && (n < -90 || n > 90)) return json({ error: "Latitude out of range." }, 400);
        if (f === "longitude" && (n < -180 || n > 180)) return json({ error: "Longitude out of range." }, 400);
        sets.push(`${f} = ?${i++}`);
        binds.push(n);
        touched.push(f);
      }
      if (typeof body.active === "boolean") {
        sets.push(`active = ?${i++}`);
        binds.push(body.active ? 1 : 0);
      }

      // Lock everything just edited; honour any explicit unlock request.
      const unlock = Array.isArray(body.unlock) ? body.unlock : [];
      let locked = parseLocked(row.locked_fields)
        .concat(touched)
        .filter((f) => unlock.indexOf(f) === -1);
      sets.push(`locked_fields = ?${i++}`);
      binds.push(serialiseLocked(locked));

      binds.push(slug);
      await db.prepare(`UPDATE mosques SET ${sets.join(", ")} WHERE slug = ?${i}`).bind(...binds).run();
      return json({ success: true, locked: parseLocked(serialiseLocked(locked)) });
    }

    /* ------------------------------------------- hibernate / wake */
    if (body.action === "set_active") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "slug is required" }, 400);
      if (typeof body.active !== "boolean") return json({ error: "active must be true or false." }, 400);
      const res = await db
        .prepare(`UPDATE mosques SET active = ?1 WHERE slug = ?2`)
        .bind(body.active ? 1 : 0, slug)
        .run();
      if (res.meta && res.meta.changes === 0) return json({ error: "No location with that slug." }, 404);
      return json({
        success: true,
        active: body.active,
        note: body.active
          ? "Back on the site after the next R2 cache rebuild."
          : "Hidden from the site after the next R2 cache rebuild (runs 02:00 and 14:00).",
      });
    }

    /* ----------------------------- fallback times over a date range */
    if (body.action === "set_times_range") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "slug is required" }, 400);
      const exists = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (!exists) return json({ error: "No location with that slug." }, 404);

      let days = parseInt(body.days, 10);
      if (isNaN(days) || days < 1) days = 120;
      if (days > 370) days = 370;

      const times = {
        fajr: normTime(body.fajr),
        zuhr: normTime(body.zuhr),
        asr: normTime(body.asr),
        maghrib: normTime(body.maghrib),
        isha: normTime(body.isha),
      };
      const jummah = (Array.isArray(body.jummah) ? body.jummah : [])
        .map(normTime)
        .filter(Boolean)
        .slice(0, 5);

      const anyDaily = Object.keys(times).some((k) => times[k]);
      if (!anyDaily && !jummah.length) {
        return json({ error: "Enter at least one time, or use Clear fallback times." }, 400);
      }

      const start = londonDateIso();
      const nowIso = new Date().toISOString();
      const statements = [];
      let dailyRows = 0;
      let jummahRows = 0;

      for (let d = 0; d < days; d++) {
        const date = addDaysIso(start, d);
        if (anyDaily) {
          statements.push(
            db
              .prepare(
                `INSERT INTO jamaah_raw
                   (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
                 VALUES ('manual', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(source, source_ref, date) DO UPDATE SET
                   fajr_jamaah = excluded.fajr_jamaah,
                   zuhr_jamaah = excluded.zuhr_jamaah,
                   asr_jamaah = excluded.asr_jamaah,
                   maghrib_jamaah = excluded.maghrib_jamaah,
                   isha_jamaah = excluded.isha_jamaah,
                   updated_at = excluded.updated_at`
              )
              .bind(slug, date, times.fajr, times.zuhr, times.asr, times.maghrib, times.isha, nowIso)
          );
          dailyRows++;
        }
        if (jummah.length && dayOfWeek(date) === 5) {
          statements.push(
            db.prepare(`DELETE FROM jummah_raw WHERE source = 'manual' AND source_ref = ?1 AND date = ?2`).bind(slug, date)
          );
          for (let s = 0; s < jummah.length; s++) {
            statements.push(
              db
                .prepare(
                  `INSERT INTO jummah_raw (source, source_ref, date, slot, time, updated_at)
                   VALUES ('manual', ?1, ?2, ?3, ?4, ?5)`
                )
                .bind(slug, date, s + 1, jummah[s], nowIso)
            );
            jummahRows++;
          }
        }
      }

      for (let i2 = 0; i2 < statements.length; i2 += 50) {
        await db.batch(statements.slice(i2, i2 + 50));
      }
      await selfMap(db, slug, nowIso);

      return json({
        success: true,
        days,
        daily_rows: dailyRows,
        jummah_rows: jummahRows,
        note: "Saved as fallback only — any scraped time for a given day still wins.",
      });
    }

    /* --------------------------------------- clear fallback times */
    if (body.action === "clear_manual_times") {
      const slug = String(body.slug || "").trim();
      if (!slug) return json({ error: "slug is required" }, 400);
      await db.batch([
        db.prepare(`DELETE FROM jamaah_raw WHERE source = 'manual' AND source_ref = ?1`).bind(slug),
        db.prepare(`DELETE FROM jummah_raw WHERE source = 'manual' AND source_ref = ?1`).bind(slug),
      ]);
      return json({ success: true });
    }

    /* -------------------------------------------- legacy: one day */
    if (body.action === "set_daily_times") {
      const slug = String(body.slug || "").trim();
      const date = String(body.date || "").trim();
      if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "slug and a YYYY-MM-DD date are required." }, 400);
      }
      const nowIso = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO jamaah_raw (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
           VALUES ('manual', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(source, source_ref, date) DO UPDATE SET
             fajr_jamaah=excluded.fajr_jamaah,
             zuhr_jamaah=excluded.zuhr_jamaah,
             asr_jamaah=excluded.asr_jamaah,
             maghrib_jamaah=excluded.maghrib_jamaah,
             isha_jamaah=excluded.isha_jamaah,
             updated_at=excluded.updated_at`
        )
        .bind(slug, date, normTime(body.fajr), normTime(body.zuhr), normTime(body.asr), normTime(body.maghrib), normTime(body.isha), nowIso)
        .run();
      await selfMap(db, slug, nowIso);
      return json({ success: true });
    }

    /* ----------------------------------------- legacy: one Friday */
    if (body.action === "set_jummah_times") {
      const slug = String(body.slug || "").trim();
      const date = String(body.date || "").trim();
      const slots = Array.isArray(body.slots) ? body.slots : [];
      if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return json({ error: "slug and a YYYY-MM-DD date are required." }, 400);
      }
      const nowIso = new Date().toISOString();
      await db.prepare(`DELETE FROM jummah_raw WHERE source = 'manual' AND source_ref = ?1 AND date = ?2`).bind(slug, date).run();
      let slotNum = 1;
      for (const s of slots) {
        const time = normTime(s && s.time);
        if (!time) continue;
        await db
          .prepare(`INSERT INTO jummah_raw (source, source_ref, date, slot, time, updated_at) VALUES ('manual', ?1, ?2, ?3, ?4, ?5)`)
          .bind(slug, date, slotNum++, time, nowIso)
          .run();
      }
      await selfMap(db, slug, nowIso);
      return json({ success: true, slotsSaved: slotNum - 1 });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

// functions/api/admin/mosque-mappings.js
//
// The matching control panel for the translator sheet (mosque_sources).
// Admin-only (X-Broadcast-Key header, same as /api/mosques/manage).
//
// GET /api/admin/mosque-mappings
//   -> counts + a list of unmatched source codes, each with up to 3
//      suggested official mosques and a confidence score.
//
// POST /api/admin/mosque-mappings  (application/json)
//   { action:'rebuild' }
//       Runs the automatic matcher over every unmatched source code.
//       Links only high-confidence matches (score >= 85). Safe to run
//       as often as you like - already-linked codes are skipped.
//   { action:'link', source, source_ref, slug }
//       Manually say "this source code IS this mosque".
//   { action:'unlink', source, source_ref }
//       Remove a wrong link (its times stop showing for that mosque).
//   { action:'adopt', source, source_ref, name, city?, type? }
//       The source knows a mosque your directory doesn't have yet:
//       creates a new official mosque row from the source's name (and
//       coordinates, if the source had them) and links the code to it.
//   { action:'merge', keep_slug, merge_slug }
//       Two official rows are the same mosque. Everything pointing at
//       merge_slug is moved to keep_slug; merge_slug is kept but marked
//       inactive with merged_into -> keep_slug. Nothing is deleted.
//
// Scoring (how the automatic matcher decides):
//   same spot (coordinates within ~150m) ......... 100
//   source code already equals the official slug .  95
//   name fully contains the other's key words .... 75-88
//   names share most of their words (Jaccard) .... 65

import { isAdminRequest } from '../../_lib/auth.js';
import {
  recompileMosquePages, ensureTimesSchema, buildMonthPage, readDay,
  DAILY_SOURCES, SOURCE_RANK, londonNowParts,
} from '../../_lib/area-times.js';

// Sources whose timetable lives on source_discoveries (a snapshot or a
// full calendar), as opposed to DAILY_SOURCES (one jamaah_raw row per
// mosque per day) or 'manual' (one fallback row in jamaah_raw). Kept in
// sync with DISCOVERY_TIME_SOURCES in area-times.js by hand - it isn't
// exported there, and duplicating one short array here is simpler than
// widening that module's exports for it.
const DISCOVERY_SOURCES = ['mawaqit', 'masjidal', 'takbeertime', 'mosqueslondon'];

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const STOP_WORDS = new Set([
  "mosque", "masjid", "islamic", "islam", "centre", "center", "the", "of",
  "and", "uk", "london", "muslim", "muslims", "trust", "association",
  "community", "jamia", "jame", "jamme", "al", "el", "bin", "ibn",
]);

function tokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));
}

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Score one source entry against one official mosque. 0 = no match.
function scoreCandidate(src, mosque) {
  if (src.source_ref === mosque.slug) return 95;

  if (
    src.lat != null && src.lon != null &&
    mosque.latitude != null && mosque.longitude != null &&
    distanceMeters(src.lat, src.lon, mosque.latitude, mosque.longitude) <= 150
  ) {
    return 100;
  }

  const srcTok = tokens(src.name);
  const mqTok = tokens(mosque.name);
  if (srcTok.length && mqTok.length) {
    const mqSet = new Set(mqTok);
    const srcSet = new Set(srcTok);
    const shared = srcTok.filter((w) => mqSet.has(w)).length;
    const srcInMq = srcTok.every((w) => mqSet.has(w));
    const mqInSrc = mqTok.every((w) => srcSet.has(w));
    if ((srcInMq || mqInSrc) && shared >= 3) return 88;
    if ((srcInMq || mqInSrc) && shared >= 2) return 75;
    const j = jaccard(srcTok, mqTok);
    if (j >= 0.6) return 65;
  }
  return 0;
}

const LINK_THRESHOLD = 85;

// mosques.locked_fields is a comma-separated list of detail fields an admin
// edited by hand on /admin/mosques.html. Locked fields are never overwritten
// by the matcher or by any scraper backfill.
function isLocked(mosqueRow, field) {
  if (!mosqueRow || !mosqueRow.locked_fields) return false;
  return String(mosqueRow.locked_fields)
    .split(",")
    .map((f) => f.trim())
    .indexOf(field) !== -1;
}

function coordsLocked(mosqueRow) {
  return isLocked(mosqueRow, "latitude") || isLocked(mosqueRow, "longitude");
}

async function loadMatcherData(db) {
  const [{ results: sources }, { results: mosques }] = await db.batch([
    db.prepare(`SELECT source, source_ref, name, lat, lon FROM mosque_sources WHERE mosque_slug IS NULL`),
    db.prepare(
      `SELECT slug, name, latitude, longitude, locked_fields FROM mosques
       WHERE active = 1 AND merged_into IS NULL`
    ),
  ]);
  return { sources: sources || [], mosques: mosques || [] };
}

function bestMatches(src, mosques, limit) {
  return mosques
    .map((m) => ({ slug: m.slug, name: m.name, score: scoreCandidate(src, m) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// One mosque's full source breakdown: every source it's linked to, what
// each of them actually has for TODAY (so a gap like a missing Dhuhr is
// visible as "this source genuinely has no Dhuhr" rather than a mystery),
// what's currently live (the merged page + which source(s) contributed),
// and its forced_source override if one is set. Powers the mosque
// search box in "Match sources to mosques" on admin/sources.html.
async function breakdownForSlug(db, slug) {
  await ensureTimesSchema(db); // makes sure mosques.forced_source exists
  const mosque = await db
    .prepare(`SELECT slug, name, active, forced_source FROM mosques WHERE slug = ?1`)
    .bind(slug)
    .first();
  if (!mosque) return json({ error: `No mosque with slug "${slug}".` }, 404);

  const { results: linkRows } = await db
    .prepare(`SELECT source, source_ref, name, last_seen FROM mosque_sources WHERE mosque_slug = ?1 ORDER BY source`)
    .bind(slug)
    .all();
  const linked = linkRows || [];

  const { dateIso } = londonNowParts();
  const thisKey = dateIso.slice(0, 7);

  const breakdown = [];
  for (const l of linked) {
    let today = null, note = null;
    if (DISCOVERY_SOURCES.indexOf(l.source) !== -1) {
      const sd = await db
        .prepare(
          `SELECT calendar_json, iqama_json, iqama_enabled, jumua, jumua2, jumua_as_duhr,
                  quality, iqama_quality, times_updated_at
             FROM source_discoveries WHERE source = ?1 AND source_ref = ?2`
        )
        .bind(l.source, l.source_ref)
        .first();
      if (sd) {
        const page = buildMonthPage(Object.assign({}, sd, { source: l.source }), thisKey);
        today = page ? readDay(page.times, dateIso) : null;
        if (!page) note = "No usable timetable from this source right now.";
      } else {
        note = "Not fetched from this source yet.";
      }
    } else if (DAILY_SOURCES.indexOf(l.source) !== -1) {
      const row = await db
        .prepare(
          `SELECT fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah
             FROM jamaah_raw WHERE source = ?1 AND source_ref = ?2 AND date = ?3`
        )
        .bind(l.source, l.source_ref, dateIso)
        .first();
      if (row) {
        today = { fajr: row.fajr_jamaah || null, zuhr: row.zuhr_jamaah || null, asr: row.asr_jamaah || null, maghrib: row.maghrib_jamaah || null, isha: row.isha_jamaah || null };
        if (!today.fajr && !today.zuhr && !today.asr && !today.maghrib && !today.isha) { today = null; note = "No prayer times submitted for today by this source."; }
      } else {
        note = "No data yet for today from this source.";
      }
    } else if (l.source === "manual") {
      const row = await db
        .prepare(
          `SELECT fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah
             FROM jamaah_raw WHERE source = 'manual' AND source_ref = ?1 ORDER BY date DESC LIMIT 1`
        )
        .bind(slug)
        .first();
      if (row) today = { fajr: row.fajr_jamaah || null, zuhr: row.zuhr_jamaah || null, asr: row.asr_jamaah || null, maghrib: row.maghrib_jamaah || null, isha: row.isha_jamaah || null };
      else note = "No manual fallback times set.";
    } else {
      note = "Location-only source \u2014 no prayer times.";
    }
    breakdown.push({ source: l.source, source_ref: l.source_ref, name: l.name, rank: SOURCE_RANK[l.source] || null, today, note });
  }

  const mt = await db
    .prepare(`SELECT times, source FROM mosque_month_times WHERE mosque = ?1 AND month = ?2`)
    .bind(slug, thisKey)
    .first();
  const live = mt ? { today: readDay(mt.times, dateIso), contributors: mt.source } : null;

  return json({
    mosque: { slug: mosque.slug, name: mosque.name, active: !!mosque.active, forced_source: mosque.forced_source || null },
    linked: linked.map((l) => ({ source: l.source, source_ref: l.source_ref, name: l.name })),
    breakdown,
    live,
    today: dateIso,
  });
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;
  const url = new URL(context.request.url);
  const slug = (url.searchParams.get("slug") || "").trim();
  if (slug) {
    try { return await breakdownForSlug(db, slug); }
    catch (e) { return json({ error: "db_error", message: String(e) }, 500); }
  }
  try {
    const counts = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM mosque_sources) AS total,
           (SELECT COUNT(*) FROM mosque_sources WHERE mosque_slug IS NOT NULL) AS linked,
           (SELECT COUNT(*) FROM mosque_sources WHERE mosque_slug IS NULL) AS unlinked,
           (SELECT COUNT(*) FROM jamaah_raw) AS jamaah_rows,
           (SELECT COUNT(*) FROM jummah_raw) AS jummah_rows,
           (SELECT COUNT(*) FROM thm_jamaah_times) AS fused_daily_rows,
           (SELECT COUNT(*) FROM mosques WHERE active = 1 AND merged_into IS NULL) AS live_mosques,
           (SELECT COUNT(*) FROM mosques WHERE merged_into IS NOT NULL) AS merged_mosques`
      )
      .first();

    const { sources, mosques } = await loadMatcherData(db);
    const unlinked = sources.slice(0, 100).map((s) => ({
      source: s.source,
      source_ref: s.source_ref,
      name: s.name,
      has_coords: s.lat != null && s.lon != null,
      suggestions: bestMatches(s, mosques, 3),
    }));

    return json({ counts, unlinked_sample: unlinked, note: "POST action 'rebuild' auto-links score >= 85" });
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

export async function onRequestPost(context) {
  if (!isAdminRequest(context)) return json({ error: "Unauthorized" }, 401);
  const db = context.env.DB;

  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    if (body.action === "rebuild") {
      const { sources, mosques } = await loadMatcherData(db);
      const mosqueBySlug = new Map(mosques.map((m) => [m.slug, m]));
      const nowIso = new Date().toISOString();
      let linked = 0;
      const review = [];
      const linkedSlugs = new Set();

      for (const s of sources) {
        // Fill in missing coordinates on the official mosque if this
        // source has them and the mosque doesn't. (Applied after linking.)
        const best = bestMatches(s, mosques, 1)[0];
        if (best && best.score >= LINK_THRESHOLD) {
          await db
            .prepare(
              `UPDATE mosque_sources SET mosque_slug = ?1, last_seen = ?2
               WHERE source = ?3 AND source_ref = ?4`
            )
            .bind(best.slug, nowIso, s.source, s.source_ref)
            .run();
          // Backfill missing coordinates on the official row - but never
          // touch coordinates an admin has edited by hand (locked_fields).
          if (s.lat != null && s.lon != null && !coordsLocked(mosqueBySlug.get(best.slug))) {
            await db
              .prepare(
                `UPDATE mosques SET latitude = ?1, longitude = ?2
                 WHERE slug = ?3 AND (latitude IS NULL OR longitude IS NULL)`
              )
              .bind(s.lat, s.lon, best.slug)
              .run();
          }
          linked++;
          linkedSlugs.add(best.slug);
        } else {
          review.push({
            source: s.source, source_ref: s.source_ref, name: s.name,
            best_guess: best || null,
          });
        }
      }

      // Refresh canonical_key on every live mosque (normalised name +
      // postcode) - used by humans reviewing duplicates.
      await db
        .prepare(
          `UPDATE mosques
           SET canonical_key = lower(trim(name)) || '|' || upper(trim(COALESCE(postcode, '')))
           WHERE merged_into IS NULL`
        )
        .run();

      // Write-time invalidation: every mosque newly linked by this
      // matcher run gets its page compiled right now from every source
      // it's linked to (not just the one that triggered the match) - a
      // mosque discovered on MasjidBox with all 5 prayers no longer has
      // to wait for that source's own next daily sync to show up.
      let recompiled = { withTimes: 0, without: 0 };
      try { recompiled = await recompileMosquePages(db, [...linkedSlugs]); } catch (e) {}

      return json({ success: true, linked, still_unmatched: review.length, review_sample: review.slice(0, 50), recompiled });
    }

    if (body.action === "link") {
      const source = String(body.source || "").trim();
      const ref = String(body.source_ref || "").trim();
      const slug = String(body.slug || "").trim();
      if (!source || !ref || !slug) return json({ error: "source, source_ref and slug are required." }, 400);
      const mosque = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (!mosque) return json({ error: `No mosque with slug "${slug}".` }, 404);
      await db
        .prepare(
          `UPDATE mosque_sources SET mosque_slug = ?1, last_seen = ?2 WHERE source = ?3 AND source_ref = ?4`
        )
        .bind(slug, new Date().toISOString(), source, ref)
        .run();
      try { await recompileMosquePages(db, [slug]); } catch (e) {}
      return json({ success: true });
    }

    if (body.action === "unlink") {
      const source = String(body.source || "").trim();
      const ref = String(body.source_ref || "").trim();
      if (!source || !ref) return json({ error: "source and source_ref are required." }, 400);
      const was = await db
        .prepare(`SELECT mosque_slug FROM mosque_sources WHERE source = ?1 AND source_ref = ?2`)
        .bind(source, ref)
        .first();
      await db
        .prepare(`UPDATE mosque_sources SET mosque_slug = NULL WHERE source = ?1 AND source_ref = ?2`)
        .bind(source, ref)
        .run();
      // The mosque this source used to feed needs its page recompiled
      // too, so an unlinked source's times stop showing immediately
      // instead of lingering until something else happens to touch it.
      if (was && was.mosque_slug) { try { await recompileMosquePages(db, [was.mosque_slug]); } catch (e) {} }
      return json({ success: true });
    }

    if (body.action === "adopt") {
      const source = String(body.source || "").trim();
      const ref = String(body.source_ref || "").trim();
      const name = String(body.name || "").trim();
      if (!source || !ref || !name) return json({ error: "source, source_ref and name are required." }, 400);
      const city = String(body.city || "London").trim();
      const type = ["mosque", "community_hall", "prayer_room"].includes(body.type) ? body.type : "mosque";
      let slug = slugify(body.slug || name);
      if (!slug) return json({ error: "Couldn't work out a slug from that name." }, 400);

      const existing = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (existing) slug = `${slug}-${source}`; // avoid a clash, still readable

      const src = await db
        .prepare(`SELECT lat, lon FROM mosque_sources WHERE source = ?1 AND source_ref = ?2`)
        .bind(source, ref)
        .first();
      const nowIso = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO mosques (slug, name, city, latitude, longitude, type, active, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)`
        )
        .bind(slug, name, city, src?.lat ?? null, src?.lon ?? null, type, nowIso)
        .run();
      await db
        .prepare(`UPDATE mosque_sources SET mosque_slug = ?1, last_seen = ?2 WHERE source = ?3 AND source_ref = ?4`)
        .bind(slug, nowIso, source, ref)
        .run();
      try { await recompileMosquePages(db, [slug]); } catch (e) {}
      return json({ success: true, slug });
    }

    if (body.action === "merge") {
      const keep = String(body.keep_slug || "").trim();
      const merge = String(body.merge_slug || "").trim();
      if (!keep || !merge || keep === merge) {
        return json({ error: "keep_slug and a different merge_slug are required." }, 400);
      }
      const keepRow = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(keep).first();
      const mergeRow = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(merge).first();
      if (!keepRow || !mergeRow) return json({ error: "Both slugs must exist." }, 404);

      await db.batch([
        // Move every translator-sheet link to the keeper.
        db.prepare(`UPDATE mosque_sources SET mosque_slug = ?1 WHERE mosque_slug = ?2`).bind(keep, merge),
        // Move photos and favourites so nothing is orphaned.
        db.prepare(`UPDATE mosque_photos SET mosque = ?1 WHERE mosque = ?2`).bind(keep, merge),
        db.prepare(`UPDATE mosque_favorites SET mosque = ?1 WHERE mosque = ?2`).bind(keep, merge),
        // Mark the duplicate as merged (kept, not deleted, so old links
        // and device-stored favourites don't hard-break).
        db.prepare(`UPDATE mosques SET merged_into = ?1, active = 0 WHERE slug = ?2`).bind(keep, merge),
      ]);
      try { await recompileMosquePages(db, [keep]); } catch (e) {}
      return json({ success: true, kept: keep, merged: merge });
    }

    if (body.action === "set_forced_source") {
      const slug = String(body.slug || "").trim();
      const source = String(body.source || "").trim(); // '' clears it back to automatic
      if (!slug) return json({ error: "slug is required." }, 400);
      const mosque = await db.prepare(`SELECT slug FROM mosques WHERE slug = ?1`).bind(slug).first();
      if (!mosque) return json({ error: `No mosque with slug "${slug}".` }, 404);
      if (source) {
        const linkedRow = await db
          .prepare(`SELECT 1 FROM mosque_sources WHERE mosque_slug = ?1 AND source = ?2 LIMIT 1`)
          .bind(slug, source)
          .first();
        if (!linkedRow) return json({ error: `"${source}" isn't currently linked to this mosque.` }, 400);
      }
      await ensureTimesSchema(db);
      await db.prepare(`UPDATE mosques SET forced_source = ?1 WHERE slug = ?2`).bind(source || null, slug).run();
      let recompiled = { withTimes: 0, without: 0 };
      try { recompiled = await recompileMosquePages(db, [slug]); } catch (e) {}
      return json({ success: true, forced_source: source || null, recompiled });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "db_error", message: String(e) }, 500);
  }
}

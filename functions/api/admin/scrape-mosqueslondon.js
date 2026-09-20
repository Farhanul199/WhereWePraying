// functions/api/admin/scrape-mosqueslondon.js
//
// mosques.london - a London directory (~430 mosques) with name, address,
// postcode, borough, coordinates, website, phone and ONE day of times
// (begins + jama'ah). There is no year calendar, so this is a
// DIRECTORY + gap-filler source, never a primary timetable:
//
//   - Full-year / rolling times still come from Tower Hamlets Mosques,
//     Mawaqit, MasjidBox and MyMasjid. A mosque linked to any of those
//     keeps their times - mosques.london ranks last (see area-times.js).
//   - Its own jama'ah times are only used for a mosque no other source
//     covers, and only for 7 days from the date they were published
//     (stopping early at a clock change). Nothing is carried forward
//     beyond that, and Maghrib is never used (it moves every day).
//   - "00:00" and any jama'ah outside 0-150 min after its begins time is
//     treated as a placeholder and left blank - never guessed.
//
// All calls need X-Broadcast-Key (admin) or X-Sync-Key.
//
//   POST ?mode=import   body = the mosques_london_all.json array
//        -> upserts into source_discoveries (source='mosqueslondon').
//           Re-upload a fresh file any time to refresh the 7-day window.
//   POST ?mode=enrich
//        -> for every mosques.london row already put live (new OR linked
//           as a duplicate), fills EMPTY fields on the live mosque:
//           address, postcode, website, coordinates, phone. Never
//           overwrites a value, never touches locked_fields. Also returns
//           a cross-reference list where the live value and mosques.london
//           disagree (postcode / website), for you to eyeball.

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';

const SOURCE = 'mosqueslondon';
const UK_PC = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const MAX_JAMAAH_AFTER_BEGIN = 150; // minutes

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function hm(v) {
  const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(String(v == null ? '' : v));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  if (h === 0 && mi === 0) return null; // "00:00" = placeholder on this site
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

// Jama'ah must fall 0-150 min after its begins time, else it's blanked.
function checked(jamaah, begins) {
  const j = hm(jamaah);
  if (!j) return null;
  const b = hm(begins);
  if (!b) return j;
  const diff = mins(j) - mins(b);
  return diff >= 0 && diff <= MAX_JAMAAH_AFTER_BEGIN ? j : null;
}

function normPc(pc) {
  const m = String(pc || '').toUpperCase().match(UK_PC);
  return m ? `${m[1]} ${m[2]}` : null;
}

// "Brookes Court, Baldwin's Gardens, London EC1N 7RR, UK" -> "London"
function townFrom(address, borough) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length && /^(uk|united kingdom)$/i.test(parts[parts.length - 1])) parts.pop();
  const last = (parts[parts.length - 1] || '').replace(UK_PC, '').trim();
  if (last && /^[A-Za-z][A-Za-z .'-]{1,40}$/.test(last) && !/\b(rd|road|st|street|lane|ln|ave|avenue)\.?$/i.test(last)) return last;
  const b = String(borough || '').replace(/\b(borough|county)?\s*council\b/i, '').replace(/^royal borough of\s+/i, '').trim();
  return b || null;
}

function cleanUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s.replace(/\/+$/, '') : null;
}

function mapRecord(r) {
  const fajr = checked(r.fajr_jamaat, r.fajr_begins);
  const zuhr = checked(r.dhuhr_jamaat, r.dhuhr_begins);
  const asr = checked(r.asr_jamaat, r.asr_begins_mithl1);
  const isha = checked(r.isha_jamaat, r.isha_begins);
  const any = !!(fajr || zuhr || asr || isha);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null;
  return {
    ref: 'ml_' + r.id,
    name: String(r.name || '').replace(/\s{2,}/g, ' ').trim(),
    address: String(r.address || '').replace(/,\s*(UK|United Kingdom)\s*$/i, '').trim() || null,
    zipcode: normPc(r.post_code) || normPc(r.address),
    city: townFrom(r.address, r.borough),
    lat: typeof r.latitude === 'number' ? r.latitude : null,
    lon: typeof r.longitude === 'number' ? r.longitude : null,
    site: cleanUrl(r.website),
    phone: r.contact ? String(r.contact).trim() : null,
    jumua: hm(r.jummah_1st), jumua2: hm(r.jummah_2nd),
    any, date,
    // maghrib deliberately null - it moves daily, a snapshot can't hold it
    calendar: any && date ? { date, fajr, zuhr, asr, maghrib: null, isha } : null,
  };
}

/* ----------------------------------------------------------------- import */

async function doImport(env, body) {
  let rows;
  try { rows = JSON.parse(body); } catch (e) { return json({ error: 'Not valid JSON.' }, 400); }
  if (!Array.isArray(rows)) rows = rows && Array.isArray(rows.mosques) ? rows.mosques : null;
  if (!rows) return json({ error: 'Expected a JSON array of mosques.' }, 400);

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO source_discoveries
      (source, source_ref, name, country, city, address, zipcode, lat, lon, site, phone,
       jumua, jumua2, iqama_enabled, calendar_json, times_status, times_updated_at,
       coverage, status, first_seen, last_seen, raw_json)
    VALUES ('${SOURCE}', ?1, ?2, 'GB', ?3, ?4, ?5, ?6, ?7, ?8, ?9,
            ?10, ?11, ?12, ?13, ?14, ?15,
            'current', 'new', ?16, ?16, ?17)
    ON CONFLICT(source, source_ref) DO UPDATE SET
      name=excluded.name, city=excluded.city, address=excluded.address, zipcode=excluded.zipcode,
      lat=excluded.lat, lon=excluded.lon, site=excluded.site, phone=excluded.phone,
      jumua=excluded.jumua, jumua2=excluded.jumua2, iqama_enabled=excluded.iqama_enabled,
      calendar_json=excluded.calendar_json, times_status=excluded.times_status,
      times_updated_at=excluded.times_updated_at, last_seen=excluded.last_seen,
      raw_json=excluded.raw_json`;

  const stmts = [];
  let skipped = 0, withTimes = 0, blanked = 0;
  const outsideUk = [];
  for (const r of rows) {
    if (!r || r.id == null || !r.name) { skipped++; continue; }
    const m = mapRecord(r);
    // Bad geocodes (e.g. one London listing sits in Sylhet) are skipped.
    if (m.lat == null || m.lon == null || m.lat < 49.8 || m.lat > 60.9 || m.lon < -8.7 || m.lon > 1.9) { skipped++; outsideUk.push(m.name); continue; }
    if (m.any) withTimes++;
    for (const [j, b] of [['fajr_jamaat', 'fajr_begins'], ['dhuhr_jamaat', 'dhuhr_begins'], ['asr_jamaat', 'asr_begins_mithl1'], ['isha_jamaat', 'isha_begins']]) {
      if (r[j] && !checked(r[j], r[b])) blanked++;
    }
    stmts.push(env.DB.prepare(sql).bind(
      m.ref, m.name, m.city, m.address, m.zipcode, m.lat, m.lon, m.site, m.phone,
      m.jumua, m.jumua2, m.calendar ? 1 : 0, m.calendar ? JSON.stringify(m.calendar) : null,
      m.calendar ? 'ok' : 'no_data', m.date ? `${m.date}T12:00:00Z` : now,
      now, JSON.stringify(r)
    ));
  }

  let imported = 0;
  const errors = [];
  for (let i = 0; i < stmts.length; i += 50) {
    try { await env.DB.batch(stmts.slice(i, i + 50)); imported += Math.min(50, stmts.length - i); }
    catch (e) { skipped += Math.min(50, stmts.length - i); if (errors.length < 5) errors.push(String(e).slice(0, 200)); }
  }
  return json({ imported, skipped, total: rows.length, withTimes, placeholdersBlanked: blanked, outsideUk, errors });
}

/* ----------------------------------------------------------------- enrich */

async function ensurePhoneColumn(db) {
  const { results } = await db.prepare('PRAGMA table_info(mosques)').all();
  if (!(results || []).some((c) => c.name === 'phone')) {
    try { await db.prepare('ALTER TABLE mosques ADD COLUMN phone TEXT').run(); } catch (e) {}
  }
}

const empty = (v) => v == null || String(v).trim() === '';
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };

async function doEnrich(env) {
  const db = env.DB;
  await ensurePhoneColumn(db);
  const { results } = await db.prepare(
    `SELECT sd.source_ref, sd.name AS ml_name, sd.address, sd.zipcode, sd.site, sd.phone, sd.lat, sd.lon,
            COALESCE(mo.merged_into, mo.slug) AS slug
       FROM source_discoveries sd
       JOIN mosques mo ON mo.slug = sd.promoted_slug
      WHERE sd.source = ?1 AND sd.status IN ('imported','duplicate') AND sd.promoted_slug IS NOT NULL`
  ).bind(SOURCE).all();
  const rows = results || [];
  if (!rows.length) return json({ ok: true, checked: 0, filled: {}, conflicts: [], message: 'Nothing linked yet - run Go live for mosques.london first.' });

  const slugs = [...new Set(rows.map((r) => r.slug))];
  const live = new Map();
  for (let i = 0; i < slugs.length; i += 90) {
    const part = slugs.slice(i, i + 90);
    const q = await db.prepare(
      `SELECT slug, name, address, postcode, website_url, latitude, longitude, phone, locked_fields
         FROM mosques WHERE slug IN (${part.map((_, k) => '?' + (k + 1)).join(',')})`
    ).bind(...part).all();
    for (const m of q.results || []) live.set(m.slug, m);
  }

  const filled = { address: 0, postcode: 0, website_url: 0, coordinates: 0, phone: 0 };
  const conflicts = [];
  const stmts = [];
  const done = new Set();

  for (const r of rows) {
    const m = live.get(r.slug);
    if (!m || done.has(r.slug)) continue;
    done.add(r.slug);
    const locked = new Set(String(m.locked_fields || '').split(',').map((s) => s.trim()).filter(Boolean));
    const set = {};
    if (empty(m.address) && r.address && !locked.has('address')) { set.address = r.address; filled.address++; }
    if (empty(m.postcode) && r.zipcode && !locked.has('postcode')) { set.postcode = r.zipcode; filled.postcode++; }
    if (empty(m.website_url) && r.site && !locked.has('website') && !locked.has('website_url')) { set.website_url = r.site; filled.website_url++; }
    if ((m.latitude == null || m.longitude == null) && r.lat != null && r.lon != null && !locked.has('latitude') && !locked.has('longitude')) {
      set.latitude = r.lat; set.longitude = r.lon; filled.coordinates++;
    }
    if (empty(m.phone) && r.phone && !locked.has('phone')) { set.phone = r.phone; filled.phone++; }

    const keys = Object.keys(set);
    if (keys.length) {
      stmts.push(db.prepare(
        `UPDATE mosques SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE slug = ?${keys.length + 1}`
      ).bind(...keys.map((k) => set[k]), r.slug));
    }

    // Cross-reference: report disagreements, never overwrite them.
    const pcA = String(m.postcode || '').toUpperCase().replace(/\s+/g, '');
    const pcB = String(r.zipcode || '').toUpperCase().replace(/\s+/g, '');
    if (pcA && pcB && pcA !== pcB) conflicts.push({ slug: r.slug, name: m.name, field: 'postcode', live: m.postcode, mosques_london: r.zipcode });
    const hA = hostOf(m.website_url), hB = hostOf(r.site);
    if (hA && hB && hA !== hB) conflicts.push({ slug: r.slug, name: m.name, field: 'website', live: m.website_url, mosques_london: r.site });
  }

  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return json({ ok: true, checked: done.size, updated: stmts.length, filled, conflicts: conflicts.slice(0, 200), conflictCount: conflicts.length });
}

/* ---------------------------------------------------------------- handler */

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAdminRequest(context) && !isSyncRequest(context)) return json({ error: 'unauthorized' }, 401);
  const mode = new URL(request.url).searchParams.get('mode');
  try {
    if (mode === 'import') return await doImport(env, await request.text());
    if (mode === 'enrich') return await doEnrich(env);
    return json({ error: 'unknown mode, use mode=import or mode=enrich' }, 400);
  } catch (e) {
    return json({ error: String(e).slice(0, 300) }, 500);
  }
}

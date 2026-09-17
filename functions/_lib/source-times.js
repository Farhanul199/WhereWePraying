// functions/_lib/source-times.js
//
// Copies jama'ah times collected on the Sources page (source_discoveries)
// into jamaah_raw / jummah_raw, so they show on Find a Mosque for every
// promoted mosque. Used by:
//   - admin/promote.js  (action 'sync_times' — the "Send times to the site" button)
//   - admin/build-r2-cache.js (runs a small top-up twice a day, automatically)
//
// Only JAMA'AH times are ever written — never begin/adhan times dressed up
// as jama'ah. A mosque with no real jama'ah data just keeps showing
// "No live prayer time available".
//
//   mawaqit     full-year calendar. Skipped if the runner graded the
//               timetable 'bad' or the jama'ah 'bad'/'placeholder'.
//               Writes the next 30 days, topped up when < 7 days remain.
//   masjidal    one current schedule. Written only up to 7 days after it
//               was last fetched (the background worker keeps refreshing).
//   takbeertime same as masjidal, and only schedules Takbeer Time marks as
//               verified (community submissions can be anything).
//   masjidbox / mymasjid / thm have their own sync jobs - not touched here.

const SOURCES = ['mawaqit', 'masjidal', 'takbeertime'];
const WINDOW_DAYS = 30;
const TOP_UP_WHEN_DAYS_LEFT = 7;
const SNAPSHOT_VALID_DAYS = 7;

// Lower = more trusted. The live views ignore any source missing here.
const PRIORITIES = [['mawaqit', 25], ['masjidal', 45], ['takbeertime', 60]];

function londonToday() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Any of "5:25", "05:25", "13:05", "5:25AM", "1:25 PM", "2026-09-17T05:25:00" -> "HH:MM"
export function toHm(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m = /T(\d{2}):(\d{2})/.exec(s);
  if (m) return `${m[1]}:${m[2]}`;
  m = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?$/i.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const pm = m[3].toUpperCase() === 'PM';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const fromMins = (x) => { x = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

function safeJson(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }

function dayEntry(months, iso) {
  if (!months) return null;
  const list = Array.isArray(months) ? months : Object.values(months);
  if (list.length !== 12) return null;
  const month = +iso.slice(5, 7) - 1, day = +iso.slice(8, 10);
  const days = list[month];
  if (!days) return null;
  const e = Array.isArray(days) ? days[day - 1] : (days[day] || days[String(day)]);
  return Array.isArray(e) ? e : null;
}

// Returns [{date, fajr, zuhr, asr, maghrib, isha}], [{date, slot, time}]
function mawaqitDays(row, dates) {
  if (row.quality === 'bad' || row.iqama_quality === 'bad' || row.iqama_quality === 'placeholder') return { days: [], jummah: [] };
  if (!row.iqama_enabled) return { days: [], jummah: [] };
  const cal = safeJson(row.calendar_json), iq = safeJson(row.iqama_json);
  if (!cal || !iq) return { days: [], jummah: [] };
  const days = [], jummah = [];
  for (const date of dates) {
    const b = dayEntry(cal, date), q = dayEntry(iq, date);
    if (!b || !q) continue;
    const begin = [b[0], b[2], b[3], b[4], b[5]].map(toHm); // fajr, dhuhr, asr, maghrib, isha
    const out = [];
    for (let p = 0; p < 5; p++) {
      const raw = String(q[p] == null ? '' : q[p]).trim();
      const off = /^\+\s*(\d{1,3})$/.exec(raw);
      let t = null;
      if (off && begin[p]) t = +off[1] > 150 ? null : fromMins(mins(begin[p]) + +off[1]);
      else t = toHm(raw);
      // sanity: jama'ah can't be before its prayer begins, or hours after
      if (t && begin[p]) { const d = ((mins(t) - mins(begin[p])) + 1440) % 1440; if (d > 150 && d < 1437) t = null; }
      out.push(t);
    }
    if (out.every((x) => !x)) continue;
    days.push({ date, fajr: out[0], zuhr: out[1], asr: out[2], maghrib: out[3], isha: out[4] });
    if (new Date(date + 'T12:00:00Z').getUTCDay() === 5) {
      const j1 = row.jumua_as_duhr ? out[1] : toHm(row.jumua);
      const j2 = toHm(row.jumua2);
      if (j1) jummah.push({ date, slot: 1, time: j1 });
      if (j2) jummah.push({ date, slot: 2, time: j2 });
    }
  }
  return { days, jummah };
}

function snapshotDays(row, dates) {
  const cal = safeJson(row.calendar_json);
  if (!cal) return { days: [], jummah: [] };
  let t;
  if (row.source === 'masjidal') {
    const iq = cal.iqamah;
    if (!iq) return { days: [], jummah: [] };
    t = { fajr: iq.fajr, zuhr: iq.zuhr || iq.dhuhr, asr: iq.asr, maghrib: iq.maghrib, isha: iq.isha };
  } else {
    if (!row.iqama_enabled) return { days: [], jummah: [] }; // takbeertime: verified only
    t = { fajr: cal.fajr, zuhr: cal.dhuhr || cal.zuhr, asr: cal.asr, maghrib: cal.maghrib, isha: cal.isha };
  }
  const clean = { fajr: toHm(t.fajr), zuhr: toHm(t.zuhr), asr: toHm(t.asr), maghrib: toHm(t.maghrib), isha: toHm(t.isha) };
  if (Object.values(clean).every((x) => !x)) return { days: [], jummah: [] };
  const validTo = row.times_updated_at ? addDays(row.times_updated_at.slice(0, 10), SNAPSHOT_VALID_DAYS) : null;
  const days = [], jummah = [];
  for (const date of dates) {
    if (!validTo || date > validTo) break;
    days.push({ date, ...clean });
    if (new Date(date + 'T12:00:00Z').getUTCDay() === 5) {
      const j1 = toHm(row.jumua), j2 = toHm(row.jumua2);
      if (j1) jummah.push({ date, slot: 1, time: j1 });
      if (j2) jummah.push({ date, slot: 2, time: j2 });
    }
  }
  return { days, jummah };
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  const info = await db.prepare('PRAGMA table_info(source_discoveries)').all();
  const have = new Set((info.results || []).map((c) => c.name));
  for (const [c, t] of [['times_live_through', 'TEXT'], ['times_pushed_at', 'TEXT'], ['quality', 'TEXT'], ['iqama_quality', 'TEXT']]) {
    if (!have.has(c)) { try { await db.prepare(`ALTER TABLE source_discoveries ADD COLUMN ${c} ${t}`).run(); } catch (e) {} }
  }
  await db.batch(PRIORITIES.map(([s, p]) => db.prepare('INSERT OR IGNORE INTO source_priorities (source, priority) VALUES (?1, ?2)').bind(s, p)));
  schemaReady = true;
}

const DUE_WHERE = `source IN ('mawaqit','masjidal','takbeertime')
   AND status IN ('imported','duplicate') AND promoted_slug IS NOT NULL
   AND times_status = 'ok'
   AND (times_live_through IS NULL OR times_live_through < ?1
        OR (times_updated_at IS NOT NULL AND (times_pushed_at IS NULL OR times_pushed_at < times_updated_at)))`;

export async function countDue(db) {
  await ensureSchema(db);
  const today = londonToday();
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM source_discoveries WHERE ${DUE_WHERE}`).bind(addDays(today, TOP_UP_WHEN_DAYS_LEFT)).first();
  return (r && r.n) || 0;
}

// Pushes times for up to `limit` promoted mosques that are due. Safe to run
// any time; unchanged rows are not rewritten.
export async function syncSourceTimes(db, limit) {
  await ensureSchema(db);
  const today = londonToday();
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, i));
  const { results } = await db.prepare(
    `SELECT source, source_ref, calendar_json, iqama_json, iqama_enabled, jumua, jumua2, jumua_as_duhr,
            quality, iqama_quality, times_updated_at
       FROM source_discoveries WHERE ${DUE_WHERE}
      ORDER BY times_live_through IS NOT NULL, times_live_through LIMIT ${Math.max(1, Math.min(limit, 80))}`
  ).bind(addDays(today, TOP_UP_WHEN_DAYS_LEFT)).all();
  const rows = results || [];
  const now = new Date().toISOString();
  const stmts = [];
  let mosquesWithTimes = 0, mosquesSkipped = 0, dayRows = 0;

  for (const row of rows) {
    const { days, jummah } = row.source === 'mawaqit' ? mawaqitDays(row, dates) : snapshotDays(row, dates);
    for (const d of days) {
      stmts.push(db.prepare(
        `INSERT INTO jamaah_raw (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(source, source_ref, date) DO UPDATE SET
           fajr_jamaah=excluded.fajr_jamaah, zuhr_jamaah=excluded.zuhr_jamaah, asr_jamaah=excluded.asr_jamaah,
           maghrib_jamaah=excluded.maghrib_jamaah, isha_jamaah=excluded.isha_jamaah, updated_at=excluded.updated_at
         WHERE COALESCE(jamaah_raw.fajr_jamaah,'') <> COALESCE(excluded.fajr_jamaah,'')
            OR COALESCE(jamaah_raw.zuhr_jamaah,'') <> COALESCE(excluded.zuhr_jamaah,'')
            OR COALESCE(jamaah_raw.asr_jamaah,'') <> COALESCE(excluded.asr_jamaah,'')
            OR COALESCE(jamaah_raw.maghrib_jamaah,'') <> COALESCE(excluded.maghrib_jamaah,'')
            OR COALESCE(jamaah_raw.isha_jamaah,'') <> COALESCE(excluded.isha_jamaah,'')`
      ).bind(row.source, row.source_ref, d.date, d.fajr, d.zuhr, d.asr, d.maghrib, d.isha, now));
    }
    for (const j of jummah) {
      stmts.push(db.prepare(
        `INSERT INTO jummah_raw (source, source_ref, date, slot, time, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source, source_ref, date, slot) DO UPDATE SET time=excluded.time, updated_at=excluded.updated_at
         WHERE COALESCE(jummah_raw.time,'') <> COALESCE(excluded.time,'')`
      ).bind(row.source, row.source_ref, j.date, j.slot, j.time, now));
    }
    dayRows += days.length;
    if (days.length) mosquesWithTimes++; else mosquesSkipped++;
    // Mark done either way, so a mosque with no usable jama'ah data isn't
    // re-read every run. It's re-checked when its source data changes.
    const through = (row.source === 'mawaqit' && days.length) ? days[days.length - 1].date : addDays(today, WINDOW_DAYS - 1);
    stmts.push(db.prepare(
      `UPDATE source_discoveries SET times_live_through=?1, times_pushed_at=?2 WHERE source=?3 AND source_ref=?4`
    ).bind(through, now, row.source, row.source_ref));
  }

  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return { checked: rows.length, mosquesWithTimes, mosquesWithoutUsableTimes: mosquesSkipped, dayRows };
}

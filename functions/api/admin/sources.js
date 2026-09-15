// functions/api/admin/sources.js
//
// Read-only window onto the source_discoveries holding pen, for the
// "Sources" tab in the admin area. It reports counts and hands you the
// raw scraped data as a download. It never writes, and nothing it shows
// is live on the website.
//
// All calls need the admin header:  X-Broadcast-Key: <BROADCAST_SECRET>
//
//   ?action=summary
//       -> every source, total mosques, how many have full-year times,
//          and a per-country breakdown.
//
//   ?action=list&source=mawaqit&country=GB&limit=200
//       -> the mosque rows themselves (no timetables, so it stays light).
//   ?action=list&source=mawaqit&status=failed
//       -> just the failed ones, with their error message.
//
//   ?action=download&source=mawaqit&country=GB&format=json
//   ?action=download&source=mawaqit&country=GB&format=csv&full=0
//   ?action=download&source=mawaqit&status=failed&format=csv
//       -> a file. format=json&full=1 includes the full-year calendars.
//          CSV is always the flat mosque details (no calendars).
//          status=failed filters to just the failed rows, either format.

import { isAdminRequest } from '../../_lib/auth.js';

const MAX_LIST = 1000;
const MAX_DOWNLOAD = 5000;

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const DETAIL_COLS = [
  'source_ref', 'name', 'country', 'city', 'address', 'zipcode',
  'lat', 'lon', 'site', 'email', 'phone',
  'jumua', 'jumua2', 'jumua_as_duhr', 'iqama_enabled',
  'times_status', 'status', 'error', 'first_seen', 'last_seen', 'times_updated_at',
];

async function summary(db) {
  const totals = await db.prepare(
    `SELECT source,
            COUNT(*) AS total,
            SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS with_times,
            SUM(CASE WHEN times_status='pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN times_status='failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN times_status='no_data' THEN 1 ELSE 0 END) AS no_data,
            SUM(CASE WHEN iqama_enabled=1 THEN 1 ELSE 0 END) AS with_jamaah,
            SUM(CASE WHEN status='imported' THEN 1 ELSE 0 END) AS imported,
            MAX(last_seen) AS last_run
       FROM source_discoveries
      GROUP BY source
      ORDER BY total DESC`
  ).all();

  const byCountry = await db.prepare(
    `SELECT source, COALESCE(country,'??') AS country,
            COUNT(*) AS total,
            SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS with_times
       FROM source_discoveries
      GROUP BY source, country
      ORDER BY total DESC`
  ).all();

  const sources = (totals.results || []).map((s) => ({
    ...s,
    countries: (byCountry.results || []).filter((c) => c.source === s.source),
  }));

  return json({ sources });
}

async function list(db, p) {
  const limit = Math.min(parseInt(p.get('limit') || '200', 10) || 200, MAX_LIST);
  const where = ['source = ?1'];
  const binds = [p.get('source') || 'mawaqit'];
  if (p.get('country')) { binds.push(p.get('country').toUpperCase()); where.push('country = ?' + binds.length); }
  if (p.get('status')) { binds.push(p.get('status')); where.push('times_status = ?' + binds.length); }
  if (p.get('q')) { binds.push('%' + p.get('q').toLowerCase() + '%'); where.push('LOWER(name) LIKE ?' + binds.length); }

  const rows = await db.prepare(
    `SELECT ${DETAIL_COLS.join(', ')} FROM source_discoveries
      WHERE ${where.join(' AND ')}
      ORDER BY name LIMIT ${limit}`
  ).bind(...binds).all();

  return json({ count: (rows.results || []).length, mosques: rows.results || [] });
}

async function download(db, p) {
  const source = p.get('source') || 'mawaqit';
  const country = p.get('country') ? p.get('country').toUpperCase() : null;
  const status = p.get('status') || null; // e.g. 'failed' - filters times_status
  const format = (p.get('format') || 'json').toLowerCase();
  const full = p.get('full') === '1' && format === 'json';

  const cols = full ? DETAIL_COLS.concat(['calendar_json', 'iqama_json']) : DETAIL_COLS;
  const binds = [source];
  let sql = `SELECT ${cols.join(', ')} FROM source_discoveries WHERE source = ?1`;
  if (country) { binds.push(country); sql += ' AND country = ?' + binds.length; }
  if (status) { binds.push(status); sql += ' AND times_status = ?' + binds.length; }
  sql += ` ORDER BY name LIMIT ${MAX_DOWNLOAD}`;

  const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${source}${country ? '-' + country : ''}${status ? '-' + status : ''}-${stamp}`;

  if (format === 'csv') {
    const lines = [DETAIL_COLS.join(',')];
    for (const r of rows) lines.push(DETAIL_COLS.map((c) => csvCell(r[c])).join(','));
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
      },
    });
  }

  const out = rows.map((r) => {
    if (!full) return r;
    const { calendar_json, iqama_json, ...rest } = r;
    return {
      ...rest,
      calendar: calendar_json ? JSON.parse(calendar_json) : null,
      iqamaCalendar: iqama_json ? JSON.parse(iqama_json) : null,
    };
  });

  return new Response(JSON.stringify({ source, country, exported: out.length, mosques: out }, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${base}${full ? '-full' : ''}.json"`,
    },
  });
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return new Response('Unauthorized', { status: 401 });

  const p = new URL(context.request.url).searchParams;
  const action = (p.get('action') || 'summary').toLowerCase();

  try {
    if (action === 'list') return await list(context.env.DB, p);
    if (action === 'download') return await download(context.env.DB, p);
    return await summary(context.env.DB);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

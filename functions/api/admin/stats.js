// functions/api/admin/stats.js
//
// Read-only health snapshot for the "Overview" tab on admin/sources.html.
// Nothing here writes anything. Answers: how many mosques are actually
// live, how many of them have real times showing today (vs. an
// estimated-Maghrib fallback, vs. nothing at all), how much of the
// translator sheet (mosque_sources) is linked, and - per source - how
// many links, how many are still pending/failed their first fetch.
//
// "Published" mirrors exactly what a visitor's card would show today:
// Tower Hamlets (thm_jamaah_times) wins if it has a row for today,
// otherwise the merged month page (mosque_month_times) if its source
// isn't the calculated-Maghrib fallback - see applyPage() in
// functions/_lib/area-times.js, which this deliberately matches.
//
// GET /api/admin/stats

import { isAdminRequest } from '../../_lib/auth.js';
import { londonNowParts, DAILY_SOURCES } from '../../_lib/area-times.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  if (!isAdminRequest(context)) return json({ error: 'Unauthorized' }, 401);
  const db = context.env.DB;
  const { dateIso } = londonNowParts();
  const thisKey = dateIso.slice(0, 7);
  const dailySourceList = DAILY_SOURCES.map((s) => `'${s}'`).join(',');

  try {
    const [mosqueRow, timesRow, mawaqitRow, linkTotalsRow, discBySource, dailyBySource, linksBySource] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) AS total_live,
                SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS with_location
           FROM mosques WHERE active = 1 AND merged_into IS NULL AND type = 'mosque'`
      ).first(),

      // Mirrors applyPage()'s own precedence: THM today's row wins if
      // present; otherwise the merged month page, unless its only
      // contributor is the calculated-Maghrib fallback.
      db.prepare(
        `SELECT
           SUM(CASE WHEN thm.has_data = 1 THEN 1
                     WHEN mt.times IS NOT NULL AND mt.source IS NOT NULL AND mt.source != 'calculated' THEN 1
                     ELSE 0 END) AS published,
           SUM(CASE WHEN (thm.has_data IS NULL) AND mt.source = 'calculated' THEN 1 ELSE 0 END) AS estimated_only
         FROM mosques m
         LEFT JOIN (
           SELECT mosque, 1 AS has_data FROM thm_jamaah_times
            WHERE date = ?1 AND (fajr_jamaah IS NOT NULL OR zuhr_jamaah IS NOT NULL OR asr_jamaah IS NOT NULL
                                   OR maghrib_jamaah IS NOT NULL OR isha_jamaah IS NOT NULL)
         ) thm ON thm.mosque = m.slug
         LEFT JOIN mosque_month_times mt ON mt.mosque = m.slug AND mt.month = ?2
         WHERE m.active = 1 AND m.merged_into IS NULL AND m.type = 'mosque'`
      ).bind(dateIso, thisKey).first(),

      // Full-year coverage today only really means Mawaqit (the one
      // source_discoveries collects a full calendar for - see
      // YEAR_SOURCES in area-times.js). mosques.london can also carry a
      // full-year import, but that lives inside its calendar_json blob
      // (shape:'year') rather than a flat column, so it isn't counted
      // here - noted in the UI rather than silently wrong.
      db.prepare(
        `SELECT COUNT(DISTINCT ms.mosque_slug) AS n
           FROM mosque_sources ms JOIN source_discoveries sd
             ON sd.source = ms.source AND sd.source_ref = ms.source_ref
          WHERE ms.source = 'mawaqit' AND sd.times_status = 'ok' AND ms.mosque_slug IS NOT NULL`
      ).first(),

      db.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN mosque_slug IS NOT NULL THEN 1 ELSE 0 END) AS linked,
                SUM(CASE WHEN mosque_slug IS NULL THEN 1 ELSE 0 END) AS unlinked
           FROM mosque_sources`
      ).first(),

      // Discovery-based sources (mawaqit, masjidal, takbeertime,
      // mosqueslondon, muslimsinbritain, ditib, ...): times_status lives
      // on source_discoveries directly.
      db.prepare(
        `SELECT source, COUNT(*) AS total,
                SUM(CASE WHEN times_status='ok' THEN 1 ELSE 0 END) AS ok,
                SUM(CASE WHEN times_status='pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN times_status='failed' THEN 1 ELSE 0 END) AS failed,
                SUM(CASE WHEN times_status='no_data' THEN 1 ELSE 0 END) AS no_data
           FROM source_discoveries GROUP BY source`
      ).all(),

      // Daily-row sources (MasjidBox, MyMasjid) never write to
      // source_discoveries - "ok" here means "has a jamaah_raw row for
      // today with at least one prayer filled in".
      dailySourceList ? db.prepare(
        `SELECT ms.source, COUNT(DISTINCT ms.mosque_slug) AS ok
           FROM jamaah_raw r JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
          WHERE r.source IN (${dailySourceList}) AND r.date = ?1 AND ms.mosque_slug IS NOT NULL
            AND (r.fajr_jamaah IS NOT NULL OR r.zuhr_jamaah IS NOT NULL OR r.asr_jamaah IS NOT NULL
                  OR r.maghrib_jamaah IS NOT NULL OR r.isha_jamaah IS NOT NULL)
          GROUP BY ms.source`
      ).bind(dateIso).all() : { results: [] },

      db.prepare(
        `SELECT source, COUNT(*) AS total,
                SUM(CASE WHEN mosque_slug IS NOT NULL THEN 1 ELSE 0 END) AS linked,
                SUM(CASE WHEN mosque_slug IS NULL THEN 1 ELSE 0 END) AS unlinked
           FROM mosque_sources GROUP BY source`
      ).all(),
    ]);

    const byLink = {};
    for (const r of (linksBySource.results || [])) byLink[r.source] = r;
    const byDisc = {};
    for (const r of (discBySource.results || [])) byDisc[r.source] = r;
    const byDaily = {};
    for (const r of (dailyBySource.results || [])) byDaily[r.source] = r.ok;

    const allSources = new Set([...Object.keys(byLink), ...Object.keys(byDisc)]);
    const bySource = [...allSources].sort().map((source) => {
      const link = byLink[source] || { total: 0, linked: 0, unlinked: 0 };
      const disc = byDisc[source] || null;
      const isDaily = DAILY_SOURCES.indexOf(source) !== -1;
      return {
        source,
        total_links: link.total || 0,
        linked: link.linked || 0,
        unlinked: link.unlinked || 0,
        ok: disc ? (disc.ok || 0) : (isDaily ? (byDaily[source] || 0) : null),
        pending: disc ? (disc.pending || 0) : null,
        failed: disc ? (disc.failed || 0) : null,
        no_data: disc ? (disc.no_data || 0) : null,
        daily_source: isDaily,
      };
    });

    const totalLive = (mosqueRow && mosqueRow.total_live) || 0;
    const published = (timesRow && timesRow.published) || 0;
    const estimatedOnly = (timesRow && timesRow.estimated_only) || 0;

    return json({
      today: dateIso,
      mosques: {
        total_live: totalLive,
        with_location: (mosqueRow && mosqueRow.with_location) || 0,
      },
      times: {
        published,
        estimated_only: estimatedOnly,
        no_times_yet: Math.max(0, totalLive - published - estimatedOnly),
      },
      full_year: { mawaqit_ok: (mawaqitRow && mawaqitRow.n) || 0 },
      source_links: linkTotalsRow || { total: 0, linked: 0, unlinked: 0 },
      bySource,
    });
  } catch (e) {
    return json({ error: 'db_error', message: String(e) }, 500);
  }
}

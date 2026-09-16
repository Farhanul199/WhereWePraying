// functions/api/admin/scrape-ditib.js
//
// DITIB (Diyanet İşleri Türk İslam Birliği) — Germany's largest mosque
// umbrella organisation, ~900 associations nationwide. No central prayer-time
// API or bulk mosque directory exists to scrape, so this is a one-time
// location-only import from a pre-compiled JSONL export Farhanul supplied
// (one JSON object per line) — not a live scraper. Same treatment as
// scrape-muslimsinbritain.js: coverage='none', times_status stays 'pending'
// forever, no worker ever picks these rows up, and the frontend shows
// "No live prayer time available" instead of hiding them.
//
// Difference from MuslimsInBritain: the source data has NO coordinates at
// all (DITIB publishes address only, no lat/lon). lat/lon are stored NULL
// here — these mosques won't plot on a map until geocoded separately
// (postcode/city -> lat/lon), which is a follow-up job, not done by this
// import.
//
// Input line shape (JSONL — one JSON object per line):
//   {"source":"ditib","source_id":"ditib-aachen-ditib-türkisch-islamische-kult",
//    "name":"DITIB Türkisch Islamische Kultur Verein e.V.",
//    "street":"Stolberger Str.  209-211,","postcode":"52068","city":"AACHEN",
//    "state":"AACHEN","country_code":"DE",
//    "phone":"0241/ 542692\n0241/ 5153440",
//    "website":"http://www.ditib-aachen.de/","email":"info@ditib-aachen.de/",
//    "address":"Stolberger Str.  209-211,, 52068 AACHEN"}
//
// mode=import — POST body is the raw JSONL text (same "POST raw bulk text"
// convention as MuslimsInBritain's CSV import and Masjidal's URL-list
// import — not a JSON array body).
//
// source_ref is built from the file's own source_id. 11 of 878 rows in the
// supplied file share a source_id with another row (mostly generic "DITIB
// Türkisch Islamische Kultur Verein e.V." names whose auto-generated slug
// collided across different cities/branches) — disambiguated here by
// appending -2, -3, ... in file order, so no row is silently dropped or
// overwritten by a same-named sibling.
//
// website/email have no dedicated columns in source_discoveries (matching
// this schema's existing columns, not inventing new ones) — the full
// original record, website and email included, is kept in raw_json so
// nothing is lost; it's just not queryable as its own column.

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAdminRequest(context) && !isSyncRequest(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  if (mode !== "import") {
    return new Response(JSON.stringify({ error: "unknown mode, use mode=import" }), { status: 400 });
  }

  const text = await request.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());

  const now = new Date().toISOString();
  const sql = `
    INSERT INTO source_discoveries
      (source, source_ref, name, country, address, lat, lon, phone,
       times_status, coverage, status, first_seen, last_seen, raw_json)
    VALUES ('ditib', ?, ?, 'DE', ?, NULL, NULL, ?,
            'pending', 'none', 'new', ?, ?, ?)
    ON CONFLICT(source, source_ref) DO UPDATE SET
      name=excluded.name,
      address=excluded.address,
      phone=excluded.phone,
      last_seen=excluded.last_seen,
      raw_json=excluded.raw_json
  `;

  const seenRefs = new Map(); // base source_id -> times seen so far in this file
  let imported = 0, skipped = 0;
  const errors = [];
  const statements = [];

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      skipped++;
      continue;
    }
    if (!row || !row.name) { skipped++; continue; }

    const base = row.source_id || `ditib_${String(row.name).slice(0, 40)}`;
    const seenCount = (seenRefs.get(base) || 0) + 1;
    seenRefs.set(base, seenCount);
    const sourceRef = seenCount === 1 ? base : `${base}-${seenCount}`;

    // Some rows have multi-line phone fields (two numbers separated by \n) —
    // flatten to one line so it's safe wherever phone gets displayed.
    const phone = row.phone ? String(row.phone).replace(/\s*\n\s*/g, ' / ').trim() : null;
    const address = row.address || null;

    statements.push(
      env.DB.prepare(sql).bind(
        sourceRef, row.name, address, phone,
        now, now, JSON.stringify(row)
      )
    );
  }

  // Batched so 878 rows is ~18 D1 round-trips, not 878 — matches the
  // pattern already used in scrape-muslimsinbritain.js / scrape-masjidbox.js.
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    try {
      await env.DB.batch(statements.slice(i, i + CHUNK));
      imported += Math.min(CHUNK, statements.length - i);
    } catch (e) {
      skipped += Math.min(CHUNK, statements.length - i);
      if (errors.length < 5) errors.push(String(e).slice(0, 200));
    }
  }

  return new Response(JSON.stringify({ imported, skipped, total: lines.length, errors }), {
    headers: { "Content-Type": "application/json" },
  });
}

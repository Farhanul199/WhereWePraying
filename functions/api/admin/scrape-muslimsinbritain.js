// functions/api/admin/scrape-muslimsinbritain.js
//
// Location-only source. MuslimsInBritain.org publishes a CSV of UK mosque
// locations (no prayer times). This endpoint parses an uploaded CSV and
// seeds source_discoveries as location-only rows — no live times, ever,
// from this source. They're marked so the frontend can show
// "No live prayer time available" instead of hiding them.
//
// CSV row format (no header row):
//   longitude,latitude,"[metadataCodes]Name. Address. Phone"
// e.g.
//   -2.1007543802,57.1609160759,"*[250WArabArab]Aberdeen Mosque and Islamic Centre. 164-168 Spital. 01224 493764"
//
// mode=import — POST body is the raw CSV text. Parses every row and
// upserts into source_discoveries with source='muslimsinbritain',
// coverage='none', times_status='not_applicable'.

import { isAdminRequest, isSyncRequest } from '../../_lib/auth.js';

function parseCsvLine(line) {
  // Simple CSV split: lon,lat,"quoted field with possible commas"
  const m = line.match(/^(-?\d+\.\d+),(-?\d+\.\d+),"(.*)"\s*$/);
  if (!m) return null;
  const lon = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  let raw = m[3].replace(/""/g, '"'); // unescape doubled quotes

  // Strip leading "*" (means "has own building" per MIB's own legend)
  raw = raw.replace(/^\*/, "").trim();

  // Extract [MetadataCodes]
  const bracket = raw.match(/^\[([^\]]*)\]\s*(.*)$/);
  const metadata = bracket ? bracket[1] : null;
  const rest = bracket ? bracket[2] : raw;

  // rest is "Name. Address parts. Phone" separated by ". "
  const parts = rest.split(". ").map((s) => s.trim()).filter(Boolean);
  const name = parts[0] || rest;
  // Last part is phone if it looks like digits/spaces; otherwise no phone given
  let phone = null;
  let addressParts = parts.slice(1);
  if (addressParts.length && /^[\d\s]{6,}$/.test(addressParts[addressParts.length - 1])) {
    phone = addressParts.pop().trim();
  }
  const address = addressParts.join(", ") || null;

  return { lat, lon, name, address, phone, metadata };
}

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

  const csvText = await request.text();
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());

  let imported = 0, skipped = 0;
  const now = new Date().toISOString();

  for (const line of lines) {
    const row = parseCsvLine(line);
    if (!row) { skipped++; continue; }

    // source_ref: no natural ID in this CSV, so build a stable one from
    // rounded coordinates + name (stable across re-imports of the same file).
    const sourceRef = `mib_${row.lat.toFixed(6)}_${row.lon.toFixed(6)}`;

    try {
      await env.DB.prepare(
        `INSERT INTO source_discoveries
           (source, source_ref, name, country, address, lat, lon, phone,
            times_status, coverage, status, first_seen, last_seen, raw_json)
         VALUES ('muslimsinbritain', ?, ?, 'GB', ?, ?, ?, ?,
                 'not_applicable', 'none', 'new', ?, ?, ?)
         ON CONFLICT(source_ref) DO UPDATE SET
           name=excluded.name,
           address=excluded.address,
           lat=excluded.lat,
           lon=excluded.lon,
           phone=excluded.phone,
           last_seen=excluded.last_seen,
           raw_json=excluded.raw_json`
      ).bind(
        sourceRef, row.name, row.address, row.lat, row.lon, row.phone,
        now, now, JSON.stringify(row)
      ).run();
      imported++;
    } catch (e) {
      skipped++;
    }
  }

  return new Response(JSON.stringify({ imported, skipped, total: lines.length }), {
    headers: { "Content-Type": "application/json" },
  });
}

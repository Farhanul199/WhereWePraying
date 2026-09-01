// GET /api/geo
// Returns a rough location derived from Cloudflare's edge geo data for
// this request (based on the client's IP). Same-origin, no external
// API, no key, no CORS issues, no separate rate limit — used as a
// reliable fallback when GPS is denied, unavailable, or times out
// (e.g. underground/metro with no satellite fix), and as extra
// redundancy alongside the third-party IP lookup already used
// client-side.
//
// request.cf.latitude / request.cf.longitude are strings when
// present (e.g. "51.50000"); not every request carries them (varies
// by Cloudflare's IP geolocation confidence), so this can return
// nulls — the client already falls through to the next fallback in
// that case.

export async function onRequestGet({ request }) {
  const cf = request.cf || {};

  const lat = cf.latitude != null ? parseFloat(cf.latitude) : null;
  const lon = cf.longitude != null ? parseFloat(cf.longitude) : null;

  const body = {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    city: cf.city || null,
    region: cf.region || null,
    country: cf.country || null,
    timezone: cf.timezone || null
  };

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

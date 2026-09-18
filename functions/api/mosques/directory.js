// functions/api/mosques/directory.js
//
// GET /api/mosques/directory
//   -> { date, mosques: [[slug, name, place, lat, lon], ...] }
//
// A compact list of every live mosque, used by the "Search mosques" box on
// Find a Mosque. Search runs IN THE BROWSER against this list, so typing
// costs nothing on the server.
//
// COST: the list is built from the database at most once a day (then kept
// in KV and at Cloudflare's edge), instead of one database scan per search.
// A search-per-keystroke endpoint would read every mosque row each time;
// this reads them once per day in total. The browser only downloads it
// when someone actually opens search.

const EDGE_SECONDS = 43200;   // 12 hours
const KV_SECONDS = 86400;     // 1 day

function londonToday() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const round5 = (v) => Math.round(v * 100000) / 100000;

export async function onRequestGet(context) {
  const { env } = context;
  const date = londonToday();
  const cacheReq = new Request(`https://cache-key.internal/mosques/directory?d=${date}`);
  const cache = caches.default;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${EDGE_SECONDS}` };

  const hit = await cache.match(cacheReq);
  if (hit) return new Response(hit.body, { headers });

  const kvKey = `mq_directory_v1:${date}`;
  let body = env.RATE_LIMIT ? await env.RATE_LIMIT.get(kvKey) : null;
  if (!body) {
    const { results } = await env.DB.prepare(
      `SELECT slug, name, postcode, city, latitude, longitude
         FROM mosques
        WHERE active = 1 AND type = 'mosque' AND latitude IS NOT NULL AND longitude IS NOT NULL`
    ).all();
    const list = (results || []).map((r) => [
      r.slug, r.name, (r.postcode || r.city || '').trim(), round5(r.latitude), round5(r.longitude),
    ]);
    body = JSON.stringify({ date, mosques: list });
    if (env.RATE_LIMIT) context.waitUntil(env.RATE_LIMIT.put(kvKey, body, { expirationTtl: KV_SECONDS }));
  }
  context.waitUntil(cache.put(cacheReq, new Response(body, { headers })));
  return new Response(body, { headers });
}

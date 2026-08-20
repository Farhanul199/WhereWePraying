// functions/api/tafsir/[surah]/[ayah].js
//
// Cloudflare Pages Function — serves an explanatory note (Tafsir Ibn
// Kathir, abridged/English) for one ayah, cached in Cloudflare KV.
//
// Why this exists: the front-end previously fetched tafsir text
// directly from third-party CDNs in the browser. That works, but it
// means every single visitor's browser has to successfully reach a
// third-party domain, past whatever CORS/network conditions exist on
// their end — and if that CDN has a bad moment, everyone sees an
// error at the same time. This endpoint moves that fetch to the
// server: the *first* time any ayah is requested, this function pulls
// it from the same upstream sources and stores the result in KV.
// Every request after that (from any visitor, anywhere) is served
// straight from KV in milliseconds, same-origin, with no CORS
// exposure and no dependency on a third party being up.
//
// ---------------------------------------------------------------
// SETUP (one-time, in the Cloudflare dashboard or via wrangler):
//
//   1. Create a KV namespace:
//        npx wrangler kv namespace create TAFSIR_KV
//
//   2. Bind it to this Pages project:
//        Cloudflare dashboard → Workers & Pages → (this project)
//        → Settings → Functions → KV namespace bindings
//        → Variable name: TAFSIR_KV  →  KV namespace: (the one you made)
//
//      (Or, if you deploy via wrangler.toml, add:
//        [[kv_namespaces]]
//        binding = "TAFSIR_KV"
//        id = "xxxxxxxxxxxxxxxx"
//      )
//
//   3. Deploy. No other config needed — this file is picked up
//      automatically by Cloudflare Pages' file-based routing:
//      functions/api/tafsir/[surah]/[ayah].js  ==>  /api/tafsir/:surah/:ayah
//
// The front-end (index.html) already calls /api/tafsir/{surah}/{ayah}
// as its first choice, and falls back to the public CDNs directly if
// this endpoint isn't deployed yet or returns nothing — so this can be
// added at any time without breaking the existing feature.
// ---------------------------------------------------------------

const UPSTREAM_SOURCES = [
  (s, a) => `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
  (s, a) => `https://cdn.jsdelivr.net/gh/fauwadwali-oss/nwv-islamic-data@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
  (s, a) => `https://ummahapi.com/api/tafsir/ibn_kathir/surah/${s}/ayah/${a}`,
];

const SURAH_AYAH_COUNTS = [
  7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,
  112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,
  59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,
  52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,
  21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6
];

function extractText(json) {
  if (!json) return '';
  if (typeof json.text === 'string') return json.text;
  if (typeof json.tafsir === 'string') return json.tafsir;
  if (json.data && typeof json.data.tafsir === 'string') return json.data.tafsir;
  return '';
}

function jsonResponse(body, status, cacheSeconds) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (cacheSeconds) headers['cache-control'] = `public, max-age=${cacheSeconds}`;
  return new Response(JSON.stringify(body), { status, headers });
}

export async function onRequestGet({ params, env }) {
  const surah = parseInt(params.surah, 10);
  const ayah = parseInt(params.ayah, 10);

  if (
    !Number.isInteger(surah) || surah < 1 || surah > 114 ||
    !Number.isInteger(ayah) || ayah < 1 || ayah > SURAH_AYAH_COUNTS[surah - 1]
  ) {
    return jsonResponse({ error: 'Invalid surah/ayah' }, 400);
  }

  const cacheKey = `tafsir:ibnkathir:${surah}:${ayah}`;

  // 1) Already cached from a previous visitor? Serve it straight away.
  if (env.TAFSIR_KV) {
    const cached = await env.TAFSIR_KV.get(cacheKey);
    if (cached) {
      // 7 days on the browser/edge cache too — this text never changes.
      return jsonResponse(JSON.parse(cached), 200, 604800);
    }
  }

  // 2) Not cached yet — this request "pays" the upstream fetch cost so
  //    every future request for this ayah doesn't have to.
  let text = '';
  const errors = [];
  for (const buildUrl of UPSTREAM_SOURCES) {
    try {
      const res = await fetch(buildUrl(surah, ayah), {
        headers: { 'user-agent': 'WhereWePraying-TafsirCache/1.0' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      text = extractText(json);
      if (text) break;
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  const result = { surah, ayah, text: text || '' };

  // 3) Cache it — successes forever (this text is static), failures only
  //    briefly, so a temporary upstream outage doesn't get "stuck" as a
  //    permanent empty result for this ayah.
  if (env.TAFSIR_KV) {
    await env.TAFSIR_KV.put(
      cacheKey,
      JSON.stringify(result),
      text ? {} : { expirationTtl: 3600 }
    );
  }

  if (!text) {
    return jsonResponse({ ...result, errors }, 502);
  }
  return jsonResponse(result, 200, 604800);
}

// Honeypot trap route.
//
// Nothing on the site links here, and robots.txt disallows /trap/ —
// so real users never land here, and well-behaved bots (Google, Bing,
// etc.) never crawl it. Anything that DOES hit this route ignored
// robots.txt on purpose, which is a strong signal of a bad scraper.
//
// We ban the IP for 7 days by writing it into the RATE_LIMIT KV
// namespace (reusing the existing binding — no new KV namespace
// needed). functions/api/_middleware.js checks this ban list before
// doing anything else on every /api/* request.
//
// Route: this file lives at functions/trap/[[path]].js, which catches
// every request under /trap/* (any depth) via Cloudflare Pages'
// [[path]] catch-all convention.

const BAN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function onRequest(context) {
  const { request, env } = context;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (env.RATE_LIMIT && ip !== 'unknown') {
    try {
      await env.RATE_LIMIT.put(`banned:${ip}`, '1', { expirationTtl: BAN_TTL_SECONDS });
    } catch (e) {
      console.error('honeypot ban write failed', e);
    }
  }

  // Give nothing useful away — just a plain 404, same as any real
  // missing page. Don't reveal that this was a trap.
  return new Response('Not found', { status: 404 });
}

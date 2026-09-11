// Honeypot trap route.
//
// Nothing on the site links here, and robots.txt disallows /trap/ —
// so real users never land here, and well-behaved bots (Google, Bing,
// etc.) never crawl it. Anything that DOES hit this route ignored
// robots.txt on purpose, which is a strong signal of a bad scraper.
//
// Just return 404 — no tracking, no quota cost.
//
// Route: this file lives at functions/trap/[[path]].js, which catches
// every request under /trap/* (any depth) via Cloudflare Pages'
// [[path]] catch-all convention.

export async function onRequest(context) {
  return new Response('Not found', { status: 404 });
}

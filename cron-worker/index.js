// cron-worker/index.js
//
// A tiny, separate Cloudflare Worker whose only job is to wake up once
// a day and tell the main site "go scrape now". It does NOT touch the
// database itself — it just calls the real endpoints over HTTPS with
// the admin secret, the same way you would with curl.
//
// Runs TWO scrapes in sequence:
//   1. scrape-londonsalahtimes  — broad baseline coverage (~600+ mosques)
//      pulled from the londonsalahtimes.live aggregator feed.
//   2. scrape                   — per-mosque direct-site scraping, which
//      overwrites the baseline with more precise data where it succeeds.
//
// Deploy this as its OWN Worker (separate from the wherewepraying
// Pages project). See cron-worker/wrangler.toml for the schedule.

async function runScrape(path, env) {
  const res = await fetch(`https://wherewepraying.com${path}`, {
    method: "POST",
    headers: { "X-Broadcast-Key": env.BROADCAST_SECRET },
  });
  const body = await res.text();
  console.log(`${path}:`, res.status, body);
  return { path, status: res.status, body };
}

export default {
  async scheduled(event, env, ctx) {
    await runScrape("/api/mosques/scrape-londonsalahtimes", env);
    await runScrape("/api/mosques/scrape", env);
  },
  // Optional: lets you trigger it manually by visiting the Worker's
  // own URL, useful for testing before you trust the cron schedule.
  async fetch(request, env, ctx) {
    const results = [];
    results.push(await runScrape("/api/mosques/scrape-londonsalahtimes", env));
    results.push(await runScrape("/api/mosques/scrape", env));
    return new Response(JSON.stringify(results, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
};

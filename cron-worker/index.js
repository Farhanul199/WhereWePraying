// cron-worker/index.js
//
// A tiny, separate Cloudflare Worker whose only job is to wake up once
// a day and tell the main site "go scrape now". It does NOT touch the
// database itself — it just calls the real endpoint over HTTPS with
// the admin secret, the same way you would with curl.
//
// Deploy this as its OWN Worker (separate from the wherewepraying
// Pages project). See cron-worker/wrangler.toml for the schedule.

export default {
  async scheduled(event, env, ctx) {
    const res = await fetch("https://wherewepraying.com/api/mosques/scrape", {
      method: "POST",
      headers: { "X-Broadcast-Key": env.BROADCAST_SECRET },
    });
    const body = await res.text();
    console.log("Scrape run:", res.status, body);
  },

  // Optional: lets you trigger it manually by visiting the Worker's
  // own URL, useful for testing before you trust the cron schedule.
  async fetch(request, env, ctx) {
    const res = await fetch("https://wherewepraying.com/api/mosques/scrape", {
      method: "POST",
      headers: { "X-Broadcast-Key": env.BROADCAST_SECRET },
    });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { "Content-Type": "application/json" } });
  },
};

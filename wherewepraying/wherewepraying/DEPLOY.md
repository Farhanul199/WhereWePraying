# Deploying WhereWePraying? with real storage

This folder is a complete, ready-to-deploy project. Everything in it has
already been tested locally (real browser clicks → real saves → real
reloads that keep the data). What's left is a few clicks in the
Cloudflare dashboard — no coding required.

## What's in this folder

- `index.html` — the app itself (this is your `wherewepraying-app.html`,
  wired up to save/load real data).
- `functions/api/` — the backend. Cloudflare runs these automatically;
  you don't call or edit them directly.
- `migrations/0001_init.sql` — the two database tables the app needs.
- `wrangler.toml` — config file, mostly just needs one ID filled in.

## Step 1 — Push this to GitHub

Create a new GitHub repository and upload everything in this folder to
it (drag-and-drop upload on github.com works fine — you don't need git
installed). Keep the folder structure exactly as it is; `functions/` and
`migrations/` need to stay at the top level, next to `index.html`.

## Step 2 — Create the database

1. Go to the Cloudflare dashboard → **Workers & Pages** → **D1**.
2. Click **Create database**, name it `wherewepraying-db`.
3. Once it's created, open it and click the **Console** tab.
4. Open `migrations/0001_init.sql` from this folder, copy its contents,
   paste into the console, and run it. This creates the two tables
   (`app_state` for saved data, `devices` for a simple tester count).
5. On the database's **Overview** page, copy the **Database ID** shown
   there — you'll need it in Step 4.

## Step 3 — Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Pick the GitHub repo from Step 1, authorize it.
3. Build settings: leave the build command **empty** and set the output
   directory to `/` (this is a static file, nothing to build).
4. Click **Save and Deploy**. It'll deploy in about a minute — this
   first deploy will work for the pages themselves, but storage won't
   work yet until the next step.

## Step 4 — Connect the database to the app

1. On your new Pages project, go to **Settings** → **Functions** → **D1
   database bindings**.
2. Click **Add binding**.
   - Variable name: `DB` (must be exactly this — it's what the code
     looks for)
   - D1 database: `wherewepraying-db`
3. Do this for **both** the Production and Preview environments if
   asked (there are usually two separate toggles).
4. Go to **Deployments**, and re-run the latest deployment (or just
   push any small change to GitHub) so the binding takes effect.

## Step 5 — Test it

Open the deployed URL. Try:
- Check off a good deed or save a journal reflection.
- Reload the page — it should still be checked/saved.
- Open the same URL in an incognito window — it should start empty
  (that's a different anonymous device, correctly isolated).

If a save doesn't seem to stick, the most common cause is the D1
binding variable name not being exactly `DB`, or the binding only being
set on one of Production/Preview. Double-check Step 4.

## What this gives you for testers

Nothing to sign in, nothing to configure — each device that opens the
link gets its own private, persistent journal, deed tracker, and Qur'an
streak. If a tester switches phones or clears their browser data, that
specific device's data is gone (there's no account to recover it from)
— that's the trade-off of skipping login for now, and it's a fine one
for a small test group. If cross-device sync becomes something testers
actually ask for, that's the natural next step and it plugs into the
same `devices` table already sitting in the database.

## Checking in on testers

Anytime you want to see how many distinct people have actually opened
the app, go to the D1 database's Console tab and run:

```sql
SELECT COUNT(*) FROM devices;
```

Or to see who's been active recently:

```sql
SELECT device_id, datetime(last_seen/1000, 'unixepoch') AS last_active
FROM devices ORDER BY last_seen DESC;
```

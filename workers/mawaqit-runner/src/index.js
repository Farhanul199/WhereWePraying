import { DurableObject } from 'cloudflare:workers';

// mawaqit-runner — Durable Object scheduler for MAWAQIT timetable intake.
//
// Deployed from GitHub (Workers Builds, root: workers/mawaqit-runner).
// Bindings and schedule live in wrangler.jsonc — nothing to set by hand.
//
// ARCHITECTURE
//  One Durable Object ("the runner") drives everything with alarms every
//  ~10 s. A token bucket turns the allowed rate into an even trickle of
//  requests — no minute-sized bursts, and never two runners at once.
//  Work is pulled from D1 in chunks into an in-memory queue, so D1 is read
//  once every few minutes instead of every tick. Results are written in one
//  batched D1 call per slice. Throttle state lives in the object's own
//  storage; a status copy goes to D1 every minute for the admin page.
//  A cron ping every 5 minutes is only a watchdog that re-arms the alarm.
//
// BEHAVIOUR
//  Intake       priority countries first; adaptive speed (AIMD); faster overnight.
//  Refresh      spread evenly across the day; changed -> 14 d, stable 30/60/90 d,
//               poor quality -> 7 d; bad data never replaces good data.
//  Busy seasons new-year wave (spread over WAVE_DAYS), Ramadan watch
//               (30 d -> day 3 of Ramadan, tighter near the start), clock changes.
//  Quality      structure, order, same-all-year, sun-position check; jama'ah
//               sanity vs begin times; stored rows graded without refetching.
//  Dedup        daily sweep (UUID / slug case / coords+name) + identical
//               timetable within ~200 m after fetching.
//  Politeness   pause + halve on 429/403 with exponential back-off, Retry-After,
//               early download stop, ETag, learned page address, daily caps.
//
// ADJUSTABLE LIMITS — Worker Settings -> Variables (kept across deploys)
const DEFAULTS = {
  PAUSED: '0',                  // '1' = stop all fetching
  MAX_PER_MINUTE: 30,           // top speed, overnight (Paris time)
  DAYTIME_SPEED_PCT: 60,        // % of top speed 07:00-23:00 Paris
  MIN_PER_MINUTE: 4,            // slowest speed after backing off
  START_PER_MINUTE: 10,         // speed after a fresh start
  CONCURRENCY: 4,               // requests in flight at once (max 8)
  DAILY_CAP: 25000,             // all requests per UTC day
  REFRESH_DAILY_CAP: 1500,      // refresh requests/day, normal times
  BUSY_DAILY_CAP: 5000,         // refresh requests/day in busy seasons
  WAVE_START_DAY: 2,            // January day the new-year wave starts
  WAVE_DAYS: 14,                // days the new-year wave is spread over
  PRIORITY_COUNTRIES: 'GB,IE',  // intake order + closer Ramadan checks
};

const SOURCE = 'mawaqit';
const PAGE_BASES = ['https://mawaqit.net/en/', 'https://mawaqit.net/fr/', 'https://mawaqit.net/en/m/'];
const UA = 'WhereWePrayingBot/1.0 (+https://wherewepraying.com; contact via site)';
const TIMEOUT_MS = 15000, SLOW_MS = 5000, MAX_BYTES = 6 * 1024 * 1024;
const BASE_PAUSE_MIN = 5, MAX_PAUSE_MIN = 360, MAX_FAILS = 4;
const SLICE_MS = 10000, IDLE_MS = 60000, EMPTY_RECHECK_MS = 120000;
const INTAKE_CHUNK = 80, REFRESH_CHUNK = 40, GRADE_PER_MIN = 60, STATUS_EVERY_MS = 60000;
const SCHEMA_V = 3;
const DAY = 86400000;
const RAMADAN_FALLBACK = ['2027-02-08', '2028-01-28', '2029-01-16', '2030-01-05', '2030-12-26', '2031-12-15'];

/* ------------------------------------------------------------ entry */

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runner(env).fetch('https://runner/kick', { method: 'POST' }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/status' || url.pathname === '/') return runner(env).fetch('https://runner/status');
    return new Response('Not found', { status: 404 });
  },
};

function runner(env) { return env.RUNNER.get(env.RUNNER.idFromName(SOURCE)); }

/* ---------------------------------------------------- durable object */

export class MawaqitRunner extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.q = { intake: [], refresh: [] };
    this.checkAfter = { intake: 0, refresh: 0 };
    this.lastStatusAt = 0;
    this.lastGradeAt = 0;
    this.busy = false;
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get('state')) || {};
    });
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/kick') {
      const at = await this.ctx.storage.getAlarm();
      if (at == null || at < Date.now() - 5 * 60000) await this.ctx.storage.setAlarm(Date.now() + 1000);
      return new Response('ok');
    }
    const c = cfg(this.env);
    return json({ limits: c, season: seasonInfo(new Date(), c), queue: { intake: this.q.intake.length, refresh: this.q.refresh.length }, state: this.s });
  }

  async alarm() {
    let next = SLICE_MS;
    try { next = await this.slice(); }
    catch (e) { console.error('slice error', e && e.stack || e); next = IDLE_MS; }
    await this.ctx.storage.put('state', this.s);
    await this.ctx.storage.setAlarm(Date.now() + next + rand(-800, 800));
  }

  async slice() {
    const env = this.env, s = this.s, c = cfg(env);
    const now = new Date(), nowMs = now.getTime(), nowIso = now.toISOString(), today = nowIso.slice(0, 10);
    const season = seasonInfo(now, c);

    if ((s.schema_v || 0) < SCHEMA_V) { await migrate(env); s.schema_v = SCHEMA_V; }
    if (s.day !== today) { s.day = today; s.day_fetches = 0; s.day_refresh_fetches = 0; }
    const ceiling = speedCeiling(c, now);
    if (s.rate == null) s.rate = Math.min(c.START_PER_MINUTE, ceiling);
    s.rate = clamp(s.rate, c.MIN_PER_MINUTE, ceiling);
    s.heartbeat_at = nowIso;

    // Daily housekeeping (no Mawaqit requests).
    if (s.dedup_day !== today) {
      const n = await dedupSweep(env);
      s.dedup_day = today;
      if (n) { s.last_note = 'Dedup: ' + n + ' duplicates skipped.'; this.q.intake = []; }
    }
    if (s.backfill_day !== today) { await backfillMeta(env); s.backfill_day = today; }
    const y = now.getUTCFullYear(), waveStart = Date.UTC(y, 0, c.WAVE_START_DAY);
    if (!s.wave_year) s.wave_year = nowMs < waveStart ? y - 1 : y;
    if (s.wave_year < y && nowMs >= waveStart - DAY) {
      await env.DB.prepare(`UPDATE mawaqit_runner_meta
          SET next_refresh_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '+' || (abs(random()) % ?2) || ' seconds')
        WHERE last_checked_at IS NULL OR last_checked_at < ?3`)
        .bind(new Date(waveStart).toISOString(), c.WAVE_DAYS * 86400, new Date(Date.UTC(y - 1, 11, 20)).toISOString()).run();
      s.wave_year = y;
      this.q.refresh = [];
    }
    if (nowMs - this.lastGradeAt >= 60000) { this.lastGradeAt = nowMs; s.graded = (s.graded || 0) + await gradeStored(env, GRADE_PER_MIN); }

    const finish = async (ms) => { await this.mirror(nowMs); return ms; };
    if (c.PAUSED === '1') { s.mode = 'paused'; s.last_note = 'Paused by PAUSED variable.'; return finish(IDLE_MS); }
    if (s.cooldown_until && s.cooldown_until > nowIso) {
      s.mode = 'cooldown';
      return finish(clamp(Date.parse(s.cooldown_until) - nowMs, 5000, IDLE_MS));
    }
    if (s.day_fetches >= c.DAILY_CAP) { s.mode = 'daily-cap'; s.last_note = 'Daily cap reached; resumes after midnight UTC.'; return finish(IDLE_MS); }

    // Token bucket: rate/min -> requests this slice. Refresh has its own
    // even daily trickle inside the same overall ceiling.
    const refreshCap = season.busy ? c.BUSY_DAILY_CAP : c.REFRESH_DAILY_CAP;
    const refreshRate = s.day_refresh_fetches >= refreshCap ? 0 : Math.min(s.rate, (refreshCap / 1440) * 1.15);
    const dt = clamp(nowMs - (s.last_slice_at || nowMs - SLICE_MS), 0, IDLE_MS + 5000);
    s.last_slice_at = nowMs;
    const burst = Math.max(1, s.rate * (2 * SLICE_MS) / 60000);
    s.tok = Math.min(burst, (s.tok || 0) + s.rate * dt / 60000);
    s.rtok = Math.min(Math.max(1, refreshRate * (2 * SLICE_MS) / 60000), (s.rtok || 0) + refreshRate * dt / 60000);

    let total = Math.floor(s.tok);
    total = Math.min(total, c.DAILY_CAP - s.day_fetches);
    let wantRefresh = Math.min(Math.floor(s.rtok), total);
    const jobs = [];
    if (wantRefresh > 0) {
      await this.fill('refresh', wantRefresh, c, s, nowMs, nowIso, season);
      for (const row of this.q.refresh.splice(0, wantRefresh)) jobs.push({ row, mode: 'refresh' });
    }
    const wantIntake = total - jobs.length;
    if (wantIntake > 0) {
      await this.fill('intake', wantIntake, c, s, nowMs, nowIso, season);
      for (const row of this.q.intake.splice(0, wantIntake)) jobs.push({ row, mode: 'intake' });
    }

    // Sleep exactly until the next useful moment instead of waking every slice.
    const intakeIdle = nowMs < this.checkAfter.intake && !this.q.intake.length;
    const refreshIdle = refreshRate === 0 || (nowMs < this.checkAfter.refresh && !this.q.refresh.length);
    const untilRefreshToken = refreshRate > 0 ? Math.max(0, 1 - s.rtok) / refreshRate * 60000 : IDLE_MS;
    const sleepFor = intakeIdle ? clamp(refreshIdle ? IDLE_MS : untilRefreshToken, SLICE_MS, IDLE_MS) : SLICE_MS;
    if (!jobs.length) {
      s.mode = intakeIdle && refreshIdle ? 'idle' : 'waiting';
      return finish(sleepFor);
    }

    const refreshUsed = jobs.filter((j) => j.mode === 'refresh').length;
    s.tok -= jobs.length;
    s.rtok = Math.max(0, s.rtok - refreshUsed);

    const w = s.win || (s.win = { since: nowMs, attempted: 0, errors: 0, msSum: 0, msN: 0, intake: 0 });
    const st = { saved: 0, changed: 0, unchanged: 0, dup: 0, rejected: 0, notFound: 0, errors: 0, blocked: 0, retryAfter: 0, fetches: 0, refreshFetches: 0, q: { good: 0, warn: 0, bad: 0, unknown: 0 } };
    const writes = [], batchTT = new Map(), baseStats = s.base_stats || (s.base_stats = {});
    let stop = false;
    const t0 = Date.now(), spread = SLICE_MS * 0.85;

    await pMapLimit(jobs, c.CONCURRENCY, async (job, i) => {
      const wait = (i / jobs.length) * spread + rand(0, 400) - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      if (stop) { (job.mode === 'refresh' ? this.q.refresh : this.q.intake).unshift(job.row); return; }
      const budget = { used: 0, max: 3 };
      const r = await fetchConf(job.row, budget, baseStats, job.mode === 'refresh');
      st.fetches += budget.used;
      if (job.mode === 'refresh') st.refreshFetches += budget.used;
      for (const t of r.timings) { w.msSum += t; w.msN++; }
      if (r.kind === 'blocked') { st.blocked++; st.retryAfter = Math.max(st.retryAfter, r.retryAfter || 0); stop = true; return; }
      await handleResult(env, job, r, st, writes, batchTT, now, nowIso, season);
    });

    for (let i = 0; i < writes.length; i += 100) await env.DB.batch(writes.slice(i, i + 100));

    s.day_fetches = (s.day_fetches || 0) + st.fetches;
    s.day_refresh_fetches = (s.day_refresh_fetches || 0) + st.refreshFetches;
    s.total_saved = (s.total_saved || 0) + st.saved;
    w.attempted += jobs.length; w.errors += st.errors;
    if (jobs.some((j) => j.mode === 'intake')) w.intake++;

    if (st.blocked) {
      s.strikes = (s.strikes || 0) + 1;
      const waitMs = Math.max(Math.min(MAX_PAUSE_MIN, BASE_PAUSE_MIN * 2 ** (s.strikes - 1)) * 60000, st.retryAfter * 1000);
      s.cooldown_until = new Date(Date.now() + waitMs).toISOString();
      s.rate = clamp(s.rate / 2, c.MIN_PER_MINUTE, ceiling);
      s.tok = 0; s.rtok = 0; s.win = null;
      s.last_note = 'Rate-limit signal: paused ' + Math.round(waitMs / 60000) + ' min, speed halved.';
    } else if (nowMs - w.since >= 60000) {
      const avg = w.msN ? Math.round(w.msSum / w.msN) : 0;
      if (w.attempted && (w.errors / w.attempted > 0.2 || avg > SLOW_MS)) s.rate = clamp(s.rate * 0.7, c.MIN_PER_MINUTE, ceiling);
      else if (w.attempted) {
        if (w.intake) s.rate = clamp(s.rate + 2, c.MIN_PER_MINUTE, ceiling);
        s.strikes = Math.max(0, (s.strikes || 0) - 1);
        s.cooldown_until = null;
      }
      s.avg_ms = avg;
      s.win = null;
    }
    s.mode = jobs.some((j) => j.mode === 'intake') ? (refreshUsed ? 'intake+refresh' : 'intake') : 'refresh';
    if (!st.blocked) {
      s.last_note = s.mode + ': ' + st.saved + ' saved (' + st.q.good + ' good, ' + st.q.warn + ' warn, ' + st.q.bad + ' bad), ' +
        st.changed + ' changed, ' + st.unchanged + ' unchanged, ' + st.dup + ' duplicates, ' + st.rejected + ' rejected, ' +
        st.notFound + ' not found, ' + st.errors + ' errors this slice' + (season.reason ? ' [' + season.reason + ']' : '');
    }
    return finish(st.blocked ? 5000 : this.q.intake.length || nowMs >= this.checkAfter.intake ? SLICE_MS : sleepFor);
  }

  // Refill a queue from D1 in chunks; remember empty results for a while.
  async fill(kind, need, c, s, nowMs, nowIso, season) {
    const q = this.q[kind];
    if (q.length >= need || nowMs < this.checkAfter[kind]) return;
    const inQueue = new Set([...this.q.intake, ...this.q.refresh].map((r) => r.slug));
    const rows = kind === 'intake'
      ? await pickIntake(this.env, c, s, INTAKE_CHUNK, nowIso)
      : await pickRefresh(this.env, c, nowIso, season, REFRESH_CHUNK);
    for (const r of rows) if (!inQueue.has(r.slug)) q.push(r);
    if (!rows.length) this.checkAfter[kind] = nowMs + EMPTY_RECHECK_MS;
  }

  // Status copy in D1 for the admin page (once a minute).
  async mirror(nowMs) {
    if (nowMs - this.lastStatusAt < STATUS_EVERY_MS) return;
    this.lastStatusAt = nowMs;
    const s = this.s;
    await this.env.DB.prepare(`INSERT INTO scraper_throttle
        (source, rate, strikes, cooldown_until, day, day_fetches, day_refresh_fetches, heartbeat_at, mode, last_note)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      ON CONFLICT(source) DO UPDATE SET rate=?2, strikes=?3, cooldown_until=?4, day=?5, day_fetches=?6,
        day_refresh_fetches=?7, heartbeat_at=?8, mode=?9, last_note=?10`).bind(
      SOURCE, s.rate, s.strikes || 0, s.cooldown_until || null, s.day || null, s.day_fetches || 0,
      s.day_refresh_fetches || 0, s.heartbeat_at || null, s.mode || null, (s.last_note || '').slice(0, 500)).run();
  }
}

/* ------------------------------------------------- per-result logic */

async function handleResult(env, job, r, st, writes, batchTT, now, nowIso, season) {
  const { row, mode } = job;
  if (r.kind === 'ok' || r.kind === 'notmodified') {
    let grade = null, tt = row.tt_hash, hash = row.content_hash;
    if (r.kind === 'ok') {
      grade = validateConf(r.conf, row.lat, row.lon);
      tt = await sha(ttBasis(r.conf));
      hash = await sha(JSON.stringify([ttBasis(r.conf), r.conf.name || null, r.conf.latitude || null, r.conf.longitude || null]));
      st.q[grade.quality]++;
    }
    if (grade && grade.noData) {
      writes.push(env.DB.prepare(`UPDATE source_discoveries SET times_status = 'no_data', error = ?2, quality = NULL,
          quality_notes = ?2, times_updated_at = ?3, last_seen = ?3 WHERE source = ?4 AND source_ref = ?1 AND times_status <> 'ok'`)
        .bind(row.slug, grade.notes.join('; '), nowIso, SOURCE));
      writes.push(metaUpsert(env, row.slug, r.base, hash, tt, r.etag, 30, now, nowIso));
      return;
    }
    if (mode === 'intake' && grade) {
      const lat = num(r.conf.latitude) ?? row.lat, lon = num(r.conf.longitude) ?? row.lon;
      const key = tt + '|' + (lat != null && lon != null ? lat.toFixed(3) + ',' + lon.toFixed(3) : String(r.conf.name || '').toLowerCase().trim());
      let dupOf = batchTT.get(key) || null;
      if (!dupOf && lat != null && lon != null) {
        const d = await env.DB.prepare(`SELECT m.slug FROM mawaqit_runner_meta m JOIN source_discoveries d
              ON d.source = ?1 AND d.source_ref = m.slug AND d.times_status = 'ok'
            WHERE m.tt_hash = ?2 AND m.slug <> ?3 AND abs(d.lat - ?4) < 0.002 AND abs(d.lon - ?5) < 0.002 LIMIT 1`)
          .bind(SOURCE, tt, row.slug, lat, lon).first();
        dupOf = d ? d.slug : null;
      }
      if (dupOf) {
        st.dup++;
        writes.push(env.DB.prepare(`UPDATE source_discoveries SET times_status = 'duplicate', error = ?2, last_seen = ?3
          WHERE source = ?4 AND source_ref = ?1`).bind(row.slug, 'duplicate of ' + dupOf, nowIso, SOURCE));
        writes.push(metaUpsert(env, row.slug, r.base, hash, tt, r.etag, 90, now, nowIso));
        return;
      }
      batchTT.set(key, row.slug);
    }
    const first = !row.content_hash;
    const changed = !first && hash !== row.content_hash;
    if (grade && grade.quality === 'bad' && !first && (row.quality === 'good' || row.quality === 'warn')) {
      st.rejected++;
      writes.push(env.DB.prepare('INSERT INTO mawaqit_changes (slug, changed_at, reason) VALUES (?1, ?2, ?3)')
        .bind(row.slug, nowIso, 'rejected bad refresh: ' + grade.notes.slice(0, 3).join('; ')));
      writes.push(metaUpsert(env, row.slug, r.base, row.content_hash, row.tt_hash, r.etag, 3, now, nowIso));
      return;
    }
    if (r.kind === 'ok' && (first || changed)) { st.saved++; writes.push(updateTimes(env, row.slug, r.conf, grade, nowIso)); }
    else { st.unchanged++; if (grade && !row.quality) writes.push(saveGrade(env, row.slug, grade)); }
    if (changed) {
      st.changed++;
      writes.push(env.DB.prepare('INSERT INTO mawaqit_changes (slug, changed_at, reason) VALUES (?1, ?2, ?3)')
        .bind(row.slug, nowIso, season.reason || 'scheduled'));
    }
    const q = grade ? grade.quality : row.quality;
    const days = q === 'bad' ? 7 : first ? 30 : changed ? 14 : clamp((row.refresh_days || 30) * 2, 30, 90);
    writes.push(metaUpsert(env, row.slug, r.base, hash, tt, r.etag, days, now, nowIso));
  } else if (r.kind === 'notfound' || r.kind === 'noconf') {
    st.notFound++;
    if (mode === 'intake') {
      writes.push(env.DB.prepare(`UPDATE source_discoveries SET times_status = 'failed', error = ?2, last_seen = ?3
        WHERE source = ?4 AND source_ref = ?1`).bind(row.slug,
        r.kind === 'notfound' ? 'not found (http ' + r.status + ')' : 'no confData on page', nowIso, SOURCE));
      writes.push(metaTry(env, row.slug, (row.fails || 0) + 1, new Date(now.getTime() + 7 * DAY).toISOString()));
    } else {
      writes.push(env.DB.prepare('UPDATE mawaqit_runner_meta SET next_refresh_at = ?2, last_checked_at = ?3 WHERE slug = ?1')
        .bind(row.slug, new Date(now.getTime() + 3 * DAY).toISOString(), nowIso));
    }
  } else {
    st.errors++;
    writes.push(mode === 'intake'
      ? metaTry(env, row.slug, row.fails || 0, new Date(now.getTime() + 30 * 60000).toISOString())
      : env.DB.prepare('UPDATE mawaqit_runner_meta SET next_refresh_at = ?2 WHERE slug = ?1')
          .bind(row.slug, new Date(now.getTime() + 6 * 3600000).toISOString()));
  }
}

/* ------------------------------------------------------------ config */

function cfg(env) {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) {
    const v = env[k];
    if (typeof d === 'number') { const n = parseFloat(v); out[k] = Number.isFinite(n) && n >= 0 ? n : d; }
    else out[k] = v == null || v === '' ? d : String(v);
  }
  out.MAX_PER_MINUTE = clamp(out.MAX_PER_MINUTE, 1, 60);
  out.MIN_PER_MINUTE = clamp(out.MIN_PER_MINUTE, 1, out.MAX_PER_MINUTE);
  out.CONCURRENCY = clamp(Math.round(out.CONCURRENCY), 1, 8);
  out.DAYTIME_SPEED_PCT = clamp(out.DAYTIME_SPEED_PCT, 10, 100);
  out.WAVE_START_DAY = clamp(Math.round(out.WAVE_START_DAY), 1, 25);
  out.WAVE_DAYS = clamp(Math.round(out.WAVE_DAYS), 3, 60);
  out.priority = out.PRIORITY_COUNTRIES.split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 15);
  return out;
}

/* ------------------------------------------------------------ schema */

async function migrate(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS scraper_throttle (
      source TEXT PRIMARY KEY, rate REAL, strikes INTEGER DEFAULT 0, cooldown_until TEXT,
      day TEXT, day_fetches INTEGER DEFAULT 0, day_refresh_fetches INTEGER DEFAULT 0,
      last_refresh_at TEXT, heartbeat_at TEXT, mode TEXT, last_note TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mawaqit_runner_meta (
      slug TEXT PRIMARY KEY, page_base TEXT, fails INTEGER DEFAULT 0, next_try_at TEXT,
      content_hash TEXT, tt_hash TEXT, etag TEXT, refresh_days INTEGER, next_refresh_at TEXT, last_checked_at TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mawaqit_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, changed_at TEXT, reason TEXT)`),
  ]);
  for (const sql of [
    'ALTER TABLE source_discoveries ADD COLUMN quality TEXT',
    'ALTER TABLE source_discoveries ADD COLUMN iqama_quality TEXT',
    'ALTER TABLE source_discoveries ADD COLUMN quality_notes TEXT',
  ]) { try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ } }
  await env.DB.batch([
    'CREATE INDEX IF NOT EXISTS idx_sd_source_status_updated ON source_discoveries (source, times_status, times_updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_sd_source_status_country ON source_discoveries (source, times_status, country)',
    'CREATE INDEX IF NOT EXISTS idx_sd_source_uuid ON source_discoveries (source, uuid)',
    'CREATE INDEX IF NOT EXISTS idx_sd_source_lref ON source_discoveries (source, lower(source_ref))',
    'CREATE INDEX IF NOT EXISTS idx_sd_source_geo ON source_discoveries (source, round(lat, 4), round(lon, 4))',
    'CREATE INDEX IF NOT EXISTS idx_sd_source_quality ON source_discoveries (source, times_status, quality)',
    'CREATE INDEX IF NOT EXISTS idx_mrm_next_refresh ON mawaqit_runner_meta (next_refresh_at)',
    'CREATE INDEX IF NOT EXISTS idx_mrm_last_checked ON mawaqit_runner_meta (last_checked_at)',
    'CREATE INDEX IF NOT EXISTS idx_mrm_tt_hash ON mawaqit_runner_meta (tt_hash)',
    'CREATE INDEX IF NOT EXISTS idx_mch_changed ON mawaqit_changes (changed_at)',
  ].map((q) => env.DB.prepare(q)));
}

/* ---------------------------------------------------- housekeeping */

async function dedupSweep(env) {
  const base = `UPDATE source_discoveries SET times_status = 'duplicate', error = 'duplicate of ' || (SUB)
    WHERE source = ?1 AND times_status = 'pending' AND COND AND EXISTS (SUB)`;
  const pick = (match) => `SELECT b.source_ref FROM source_discoveries b
    WHERE b.source = ?1 AND ${match} AND b.source_ref <> source_discoveries.source_ref
      AND (b.times_status = 'ok' OR (b.times_status = 'pending' AND b.source_ref < source_discoveries.source_ref))
    ORDER BY (b.times_status = 'ok') DESC LIMIT 1`;
  const q = [
    ["uuid IS NOT NULL AND uuid <> ''", 'b.uuid = source_discoveries.uuid'],
    ['1 = 1', 'lower(b.source_ref) = lower(source_discoveries.source_ref)'],
    ["lat IS NOT NULL AND lon IS NOT NULL AND name IS NOT NULL",
      'round(b.lat, 4) = round(source_discoveries.lat, 4) AND round(b.lon, 4) = round(source_discoveries.lon, 4) AND lower(trim(b.name)) = lower(trim(source_discoveries.name))'],
  ];
  let total = 0;
  for (const [cond, match] of q) {
    const sql = base.replace('COND', cond).split('SUB').join(pick(match));
    try { const r = await env.DB.prepare(sql).bind(SOURCE).run(); total += (r.meta && r.meta.changes) || 0; }
    catch (e) { console.error('dedup', e); }
  }
  return total;
}

async function backfillMeta(env) {
  await env.DB.prepare(`INSERT OR IGNORE INTO mawaqit_runner_meta (slug, fails, refresh_days, next_refresh_at, last_checked_at)
    SELECT source_ref, 0, 30,
           strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(times_updated_at, 'now'), '+30 days'),
           COALESCE(times_updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      FROM source_discoveries WHERE source = ?1 AND times_status = 'ok'`).bind(SOURCE).run();
}

// Grades already-stored timetables without refetching them.
async function gradeStored(env, limit) {
  const rows = (await env.DB.prepare(`SELECT source_ref, lat, lon, iqama_enabled, jumua, jumua2, jumua_as_duhr, calendar_json, iqama_json
      FROM source_discoveries WHERE source = ?1 AND times_status = 'ok' AND quality IS NULL LIMIT ?2`)
    .bind(SOURCE, limit).all()).results || [];
  if (!rows.length) return 0;
  const writes = [];
  for (const r of rows) {
    const conf = { latitude: r.lat, longitude: r.lon, iqamaEnabled: !!r.iqama_enabled,
      calendar: safeJson(r.calendar_json), iqamaCalendar: safeJson(r.iqama_json),
      jumua: r.jumua, jumua2: r.jumua2, jumuaAsDuhr: !!r.jumua_as_duhr };
    const g = validateConf(conf, r.lat, r.lon);
    writes.push(saveGrade(env, r.source_ref, g));
    const tt = await sha(ttBasis(conf));
    writes.push(env.DB.prepare('UPDATE mawaqit_runner_meta SET tt_hash = COALESCE(tt_hash, ?2) WHERE slug = ?1').bind(r.source_ref, tt));
  }
  await env.DB.batch(writes);
  return rows.length;
}

/* ------------------------------------------------------ work pickers */

const COLS = `COALESCE(m.fails,0) AS fails, m.page_base, m.content_hash, m.tt_hash, m.refresh_days, m.etag,
              d.lat, d.lon, d.quality`;

async function pickIntake(env, c, s, n, nowIso) {
  const done = new Set((s.done_countries || '').split(',').filter(Boolean));
  const sel = `SELECT d.source_ref AS slug, ${COLS}
                 FROM source_discoveries d LEFT JOIN mawaqit_runner_meta m ON m.slug = d.source_ref`;
  const ready = '(m.next_try_at IS NULL OR m.next_try_at < ?2)';
  const rows = [], seen = new Set();
  const add = (list) => { for (const r of list) if (!seen.has(r.slug) && rows.length < n) { seen.add(r.slug); rows.push(r); } };

  for (const cc of c.priority) {
    if (done.has(cc) || rows.length >= n) continue;
    const got = (await env.DB.prepare(sel + ` WHERE d.source = ?1 AND d.times_status = 'pending' AND d.country = ?3 AND ${ready} LIMIT ?4`)
      .bind(SOURCE, nowIso, cc, n - rows.length).all()).results || [];
    if (!got.length) {
      const any = await env.DB.prepare("SELECT 1 FROM source_discoveries WHERE source = ?1 AND times_status = 'pending' AND country = ?2 LIMIT 1")
        .bind(SOURCE, cc).first();
      if (!any) done.add(cc);
    }
    add(got);
  }
  s.done_countries = [...done].join(',');
  if (rows.length < n) {
    add((await env.DB.prepare(sel + ` WHERE d.source = ?1 AND d.times_status = 'pending' AND ${ready} LIMIT ?3`)
      .bind(SOURCE, nowIso, n + 10).all()).results || []);
  }
  if (rows.length < n) {
    add((await env.DB.prepare(sel + ` WHERE d.source = ?1 AND d.times_status = 'failed' AND COALESCE(m.fails,0) < ?3 AND ${ready} LIMIT ?4`)
      .bind(SOURCE, nowIso, MAX_FAILS, n).all()).results || []);
  }
  return rows;
}

async function pickRefresh(env, c, nowIso, season, n) {
  const sel = `SELECT m.slug, ${COLS}
                 FROM mawaqit_runner_meta m JOIN source_discoveries d
                   ON d.source = ?1 AND d.source_ref = m.slug AND d.times_status = 'ok'`;
  const rows = [], seen = new Set();
  const add = (list) => { for (const r of list) if (!seen.has(r.slug) && rows.length < n) { seen.add(r.slug); rows.push(r); } };

  if (season.prioDays && c.priority.length) {
    const ph = c.priority.map((_, i) => '?' + (i + 4)).join(',');
    const cutoff = new Date(Date.now() - season.prioDays * DAY + 3600000).toISOString();
    add((await env.DB.prepare(sel + ` WHERE (m.last_checked_at IS NULL OR m.last_checked_at < ?2) AND d.country IN (${ph})
        ORDER BY m.last_checked_at LIMIT ?3`).bind(SOURCE, cutoff, n, ...c.priority).all()).results || []);
  }
  if (season.otherDays && rows.length < n) {
    const cutoff = new Date(Date.now() - season.otherDays * DAY + 3600000).toISOString();
    add((await env.DB.prepare(sel + ' WHERE (m.last_checked_at IS NULL OR m.last_checked_at < ?2) ORDER BY m.last_checked_at LIMIT ?3')
      .bind(SOURCE, cutoff, n).all()).results || []);
  }
  if (rows.length < n) {
    add((await env.DB.prepare(sel + ' WHERE m.next_refresh_at < ?2 ORDER BY m.next_refresh_at LIMIT ?3')
      .bind(SOURCE, nowIso, n).all()).results || []);
  }
  return rows;
}

/* ------------------------------------------------------------ fetch */

async function fetchConf(row, budget, baseStats, conditional) {
  const ranked = [...PAGE_BASES].sort((a, b) => (baseStats[b] || 0) - (baseStats[a] || 0));
  const bases = row.page_base ? [row.page_base, ...ranked.filter((b) => b !== row.page_base)] : ranked;
  const timings = [];
  let lastStatus = 0, sawNotFound = false, sawNoConf = false;
  for (const base of bases) {
    if (budget.used >= budget.max) return { kind: 'budget', timings };
    budget.used++;
    const t0 = Date.now();
    const done = () => timings.push(Date.now() - t0);
    const headers = { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en' };
    if (conditional && row.etag && row.content_hash && base === row.page_base) headers['If-None-Match'] = row.etag;
    let res;
    try {
      res = await fetch(base + encodeURIComponent(row.slug), { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) { done(); return { kind: 'error', timings }; }
    lastStatus = res.status;
    if (res.status === 304) { done(); return { kind: 'notmodified', base, timings }; }
    if (res.status === 429 || res.status === 403 || res.headers.get('cf-mitigated')) {
      done(); cancelBody(res);
      return { kind: 'blocked', retryAfter: parseRetryAfter(res.headers.get('retry-after')), timings };
    }
    if (res.status >= 500) { done(); cancelBody(res); return { kind: 'error', timings }; }
    if (res.status === 404 || res.status === 410) { done(); cancelBody(res); sawNotFound = true; continue; }
    if (!res.ok) { done(); cancelBody(res); continue; }
    let out;
    try { out = await streamConfData(res); } catch (e) { done(); return { kind: 'error', timings }; }
    done();
    if (out.conf) {
      baseStats[base] = (baseStats[base] || 0) + 1;
      return { kind: 'ok', conf: out.conf, base, etag: res.headers.get('etag'), timings };
    }
    sawNoConf = true;
  }
  if (sawNoConf) return { kind: 'noconf', timings };
  return { kind: sawNotFound ? 'notfound' : 'error', status: lastStatus, timings };
}

async function streamConfData(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const markerRe = /(?:var|let|const)\s+confData\s*=\s*\{/;
  let buf = '', start = -1, pos = 0, depth = 0, inStr = false, quote = '', esc = false, bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) { bytes += value.length; buf += dec.decode(value, { stream: true }); }
    if (start < 0) {
      const m = markerRe.exec(buf);
      if (m) { start = buf.indexOf('{', m.index); pos = start; }
      else if (buf.length > 8192) buf = buf.slice(-300);
    }
    if (start >= 0) {
      for (; pos < buf.length; pos++) {
        const ch = buf[pos];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) inStr = false; continue; }
        if (ch === '"' || ch === "'") { inStr = true; quote = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          if (!done) { try { await reader.cancel(); } catch (e) {} }
          try { return { conf: JSON.parse(buf.slice(start, pos + 1)) }; } catch (e) { return { conf: null }; }
        }
      }
    }
    if (done) return { conf: null };
    if (bytes > MAX_BYTES) { try { await reader.cancel(); } catch (e) {} return { conf: null }; }
  }
}

/* ---------------------------------------------------------- writes */

function updateTimes(env, slug, conf, g, nowIso) {
  return env.DB.prepare(`UPDATE source_discoveries SET
      name = COALESCE(?2, name), country = COALESCE(?3, country),
      lat = COALESCE(?4, lat), lon = COALESCE(?5, lon), site = COALESCE(?6, site),
      jumua = ?7, jumua2 = ?8, jumua_as_duhr = ?9, iqama_enabled = ?10,
      calendar_json = ?11, iqama_json = ?12,
      times_status = 'ok', error = NULL, times_updated_at = ?13, last_seen = ?13,
      quality = ?15, iqama_quality = ?16, quality_notes = ?17
    WHERE source = ?14 AND source_ref = ?1`).bind(
    slug, conf.name || null, conf.countryCode ? String(conf.countryCode).toUpperCase() : null,
    num(conf.latitude), num(conf.longitude), conf.site || null,
    conf.jumua || null, conf.jumua2 || null, conf.jumuaAsDuhr ? 1 : 0, conf.iqamaEnabled ? 1 : 0,
    conf.calendar ? JSON.stringify(conf.calendar) : null,
    conf.iqamaCalendar ? JSON.stringify(conf.iqamaCalendar) : null, nowIso, SOURCE,
    g ? g.quality : null, g ? g.iqamaQuality : null, g && g.notes.length ? g.notes.join('; ').slice(0, 500) : null);
}

function saveGrade(env, slug, g) {
  return env.DB.prepare(`UPDATE source_discoveries SET quality = ?2, iqama_quality = ?3, quality_notes = ?4
    WHERE source = ?5 AND source_ref = ?1`)
    .bind(slug, g.quality, g.iqamaQuality, g.notes.length ? g.notes.join('; ').slice(0, 500) : null, SOURCE);
}

function metaUpsert(env, slug, base, hash, tt, etag, days, now, nowIso) {
  return env.DB.prepare(`INSERT INTO mawaqit_runner_meta
      (slug, page_base, fails, next_try_at, content_hash, tt_hash, etag, refresh_days, next_refresh_at, last_checked_at)
    VALUES (?1, ?2, 0, NULL, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(slug) DO UPDATE SET page_base = COALESCE(?2, page_base), fails = 0, next_try_at = NULL,
      content_hash = ?3, tt_hash = ?4, etag = COALESCE(?5, etag), refresh_days = ?6, next_refresh_at = ?7, last_checked_at = ?8`)
    .bind(slug, base || null, hash || null, tt || null, etag || null, days,
      new Date(now.getTime() + days * DAY + rand(0, Math.min(2, days / 3) * DAY)).toISOString(), nowIso);
}

function metaTry(env, slug, fails, nextTry) {
  return env.DB.prepare(`INSERT INTO mawaqit_runner_meta (slug, fails, next_try_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(slug) DO UPDATE SET fails = ?2, next_try_at = ?3`).bind(slug, fails, nextTry);
}

function ttBasis(conf) {
  return JSON.stringify([conf.calendar || null, conf.iqamaCalendar || null, conf.jumua || null,
    conf.jumua2 || null, !!conf.jumuaAsDuhr, !!conf.iqamaEnabled]);
}

async function sha(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* --------------------------------------------------------- quality */
// Mawaqit shape: calendar[month]["day"] = [fajr, sunrise, dhuhr, asr, maghrib, isha]
// iqamaCalendar[month]["day"] = [fajr, dhuhr, asr, maghrib, isha] as "+N" or "HH:MM".
// Unknown shapes grade 'unknown' — never rejected on an assumption.

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validateConf(conf, latHint, lonHint) {
  const notes = [];
  const cal = conf && conf.calendar;
  if (!cal || (Array.isArray(cal) && !cal.length) || (typeof cal === 'object' && !Object.keys(cal).length)) {
    return { noData: true, quality: 'unknown', iqamaQuality: null, notes: ['no timetable published'] };
  }
  const months = Array.isArray(cal) ? cal : Object.values(cal);
  if (months.length !== 12 || months.some((m) => !m || typeof m !== 'object')) {
    return { quality: 'unknown', iqamaQuality: null, notes: ['unrecognised timetable format'] };
  }

  // Parse begin times.
  const begin = [];
  let total = 0, invalid = 0, orderBad = 0, shortMonths = 0;
  for (let m = 0; m < 12; m++) {
    const days = months[m] || {};
    begin[m] = {};
    let valid = 0;
    for (let d = 1; d <= MONTH_DAYS[m]; d++) {
      const arr = Array.isArray(days) ? days[d - 1] : days[d] || days[String(d)];
      if (!Array.isArray(arr)) continue;
      total++;
      const t = arr.slice(0, 6).map(hm);
      if (t.length < 6 || t.some((x) => x == null)) { invalid++; continue; }
      valid++;
      begin[m][d] = t;
      const [f, sr, dh, as, mg, is] = t;
      if (!(f < sr && sr < dh && dh < as && as < mg && (is > mg || is < f))) orderBad++;
    }
    if (valid < 28) shortMonths++;
  }
  let bad = false, warn = false, unknown = false;
  if (!total) return { quality: 'unknown', iqamaQuality: null, notes: ['unrecognised timetable format'] };
  if (shortMonths > 2) { bad = true; notes.push(shortMonths + ' months incomplete'); }
  else if (shortMonths) { warn = true; notes.push(shortMonths + ' month(s) incomplete'); }
  if (invalid / total > 0.02) { bad = true; notes.push(Math.round(100 * invalid / total) + '% invalid times'); }
  if (orderBad / total > 0.03) { bad = true; notes.push('prayers out of order on ' + orderBad + ' days'); }

  const sample = (m) => begin[m][15] || begin[m][14] || begin[m][16];
  const samples = [...Array(12).keys()].map(sample);
  const present = samples.filter(Boolean);
  if (present.length >= 6) {
    const spread = (i) => Math.max(...present.map((t) => t[i])) - Math.min(...present.map((t) => t[i]));
    if (spread(0) <= 3 && spread(4) <= 3) { bad = true; notes.push('same times all year'); }
  }

  // Sun-position check against the mosque's coordinates.
  const lat = num(conf.latitude) ?? num(latHint), lon = num(conf.longitude) ?? num(lonHint);
  if (lat == null || lon == null || (lat === 0 && lon === 0)) { unknown = true; notes.push('no coordinates to verify'); }
  else if (Math.abs(lat) >= 58) { notes.push('high latitude, sun check skipped'); }
  else {
    let pass = 0, checked = 0, asrOff = 0, fajrOff = 0;
    const offsets = [];
    for (let m = 0; m < 12; m++) {
      const t = samples[m];
      if (!t) continue;
      const sun = solar(2026, m, 15, lat, lon);
      if (!sun) continue;
      checked++;
      const off = Math.round(wrap(t[2] - sun.noon - 3) / 15) * 15;
      offsets.push(off);
      const dh = wrap(t[2] - (sun.noon + off));
      const sr = Math.abs(wrap(t[1] - (sun.sunrise + off)));
      const mg = wrap(t[4] - (sun.sunset + off));
      if (dh >= -6 && dh <= 25 && sr <= 12 && mg >= -6 && mg <= 15) pass++;
      const asrDiff = Math.min(Math.abs(wrap(t[3] - (sun.asr1 + off))), Math.abs(wrap(t[3] - (sun.asr2 + off))));
      if (asrDiff > 15) asrOff++;
      const fajrGap = wrap(t[1] - t[0]);
      if (Math.abs(lat) < 50 && (fajrGap < 30 || fajrGap > 150)) fajrOff++;
    }
    if (checked >= 6) {
      if (pass >= checked - 1) { /* good */ }
      else if (pass >= checked * 0.6) { warn = true; notes.push('begin times partly off for location (' + pass + '/' + checked + ')'); }
      else { bad = true; notes.push("begin times don't match mosque location (" + pass + '/' + checked + ')'); }
      if (offsets.length && Math.max(...offsets) - Math.min(...offsets) > 75) { warn = true; notes.push('inconsistent time zone'); }
      if (asrOff > 3) { warn = true; notes.push('Asr off on ' + asrOff + ' months'); }
      if (fajrOff > 3) { warn = true; notes.push('Fajr gap unusual on ' + fajrOff + ' months'); }
    } else unknown = true;
  }

  // Jama'ah checks against the mosque's own begin times.
  let iqamaQuality = null;
  const iq = conf.iqamaCalendar;
  const iqMonths = Array.isArray(iq) ? iq : iq && typeof iq === 'object' ? Object.values(iq) : null;
  if (conf.iqamaEnabled && iqMonths && iqMonths.length === 12) {
    const map = [0, 2, 3, 4, 5];
    let entries = 0, badE = 0, zero = 0, fajrBad = 0;
    for (let m = 0; m < 12; m++) {
      const days = iqMonths[m] || {};
      for (let d = 1; d <= MONTH_DAYS[m]; d++) {
        const arr = Array.isArray(days) ? days[d - 1] : days[d] || days[String(d)];
        const b = begin[m][d];
        if (!Array.isArray(arr) || !b) continue;
        for (let p = 0; p < 5 && p < arr.length; p++) {
          const raw = String(arr[p] == null ? '' : arr[p]).trim();
          if (!raw) continue;
          entries++;
          const start = b[map[p]];
          let j;
          const offM = /^\+\s*(\d{1,3})$/.exec(raw);
          if (offM) { const o = +offM[1]; if (o === 0) zero++; if (o > 150) { badE++; continue; } j = start + o; }
          else { j = hm(raw); if (j == null) { badE++; continue; } }
          const diff = wrap(j - start);
          if (diff < -3 || diff > 150) { badE++; continue; }
          if (p === 0 && wrap(b[1] - j) < 5) { fajrBad++; badE++; }
        }
      }
    }
    if (!entries) iqamaQuality = 'none';
    else {
      const ratio = badE / entries;
      iqamaQuality = ratio <= 0.02 ? 'good' : ratio <= 0.15 ? 'warn' : 'bad';
      if (zero / entries > 0.9) { iqamaQuality = 'placeholder'; notes.push("jama'ah = begin times (likely not real)"); }
      else if (iqamaQuality !== 'good') notes.push("jama'ah implausible on " + Math.round(100 * ratio) + '% of entries' + (fajrBad ? ' (Fajr after sunrise ' + fajrBad + 'x)' : ''));
    }
  } else if (conf.iqamaEnabled) {
    iqamaQuality = 'unknown';
  } else {
    iqamaQuality = 'none';
  }

  const quality = bad ? 'bad' : warn ? 'warn' : unknown ? 'unknown' : 'good';
  return { quality, iqamaQuality, notes };
}

// NOAA solar position; returns UTC minutes for noon, sunrise, sunset, Asr (Shafi'i, Hanafi).
function solar(year, month, day, lat, lon) {
  const n = Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / DAY) + 1;
  const g = (2 * Math.PI / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const phi = lat * Math.PI / 180;
  const noon = 720 - 4 * lon - eq;
  const cosH = Math.cos(90.833 * Math.PI / 180) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const H = Math.acos(cosH) * 180 / Math.PI;
  const asr = (factor) => {
    const alt = Math.atan(1 / (factor + Math.tan(Math.abs(phi - decl))));
    const c = (Math.sin(alt) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    return c < -1 || c > 1 ? null : noon + 4 * (Math.acos(c) * 180 / Math.PI);
  };
  return { noon, sunrise: noon - 4 * H, sunset: noon + 4 * H, asr1: asr(1) ?? 1e9, asr2: asr(2) ?? 1e9 };
}

function hm(v) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
}
function wrap(x) { return ((((x + 720) % 1440) + 1440) % 1440) - 720; }

/* ----------------------------------------------------- time & season */

function speedCeiling(c, now) {
  const h = parseInt(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(now), 10);
  const night = h >= 23 || h < 7;
  return Math.max(c.MIN_PER_MINUTE, night ? c.MAX_PER_MINUTE : c.MAX_PER_MINUTE * c.DAYTIME_SPEED_PCT / 100);
}

function ramadanOffset(now) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    const hijri = (t) => { const p = fmt.formatToParts(new Date(t)); return [+p.find((x) => x.type === 'month').value, +p.find((x) => x.type === 'day').value]; };
    for (let i = -3; i <= 31; i++) { const [m, d] = hijri(today + i * DAY); if (m === 9 && d === 1) return i; }
    return null;
  } catch (e) {
    for (const iso of RAMADAN_FALLBACK) { const i = Math.round((Date.parse(iso) - today) / DAY); if (i >= -3 && i <= 31) return i; }
    return null;
  }
}

function seasonInfo(now, c) {
  const off = ramadanOffset(now);
  if (off !== null) {
    if (off <= 1) return { busy: true, prioDays: 1, otherDays: 2, reason: off > 0 ? 'Ramadan tomorrow' : 'Ramadan start watch' };
    if (off <= 7) return { busy: true, prioDays: 2, otherDays: 4, reason: 'Ramadan in ' + off + ' days' };
    if (off <= 30) return { busy: true, prioDays: 7, otherDays: 7, reason: 'Ramadan in ' + off + ' days' };
  }
  const y = now.getUTCFullYear();
  for (const m of [2, 9]) {
    const last = new Date(Date.UTC(y, m + 1, 0));
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    const diff = last - now;
    if (diff > -DAY && diff < 7 * DAY) return { busy: true, prioDays: 7, otherDays: 7, reason: 'clock change' };
  }
  const waveStart = Date.UTC(y, 0, c.WAVE_START_DAY);
  if (now.getTime() >= waveStart - DAY && now.getTime() < waveStart + (c.WAVE_DAYS + 2) * DAY) {
    return { busy: true, prioDays: 0, otherDays: 0, reason: 'new-year wave' };
  }
  return { busy: false, prioDays: 0, otherDays: 0, reason: '' };
}

/* ------------------------------------------------------------ utils */

async function pMapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
function cancelBody(res) { try { if (res.body) res.body.cancel(); } catch (e) {} }
function parseRetryAfter(v) {
  if (!v) return 0;
  if (/^\s*\d+\s*$/.test(v)) return Math.min(parseInt(v, 10), 6 * 3600);
  const d = Date.parse(v);
  return Number.isFinite(d) ? clamp((d - Date.now()) / 1000, 0, 6 * 3600) : 0;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * Math.max(1, b - a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function num(v) { if (v == null || v === '') return null; const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; }
function safeJson(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function json(o) { return new Response(JSON.stringify(o, null, 2), { headers: { 'Content-Type': 'application/json' } }); }

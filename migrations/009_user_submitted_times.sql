-- migrations/009_user_submitted_times.sql
-- Community-submitted Jama'ah times (fallback only, weekly timetable).
--
-- RUN EACH STATEMENT SEPARATELY in the D1 console (Workers & Pages > D1 >
-- wherewepraying-db > Console). Running the whole file at once gives
-- "SQLITE_ERROR: incomplete input".

-- 1. One row per submitted prayer for one weekday of one week.
--    weekday: 0 = Sunday ... 6 = Saturday (mosque's local weekday).
--    week_start: the Sunday (YYYY-MM-DD) that starts the week, in the mosque's local time.
--    Rows from the current week are "current"; last week's are shown greyed out; older are ignored.
CREATE TABLE IF NOT EXISTS user_jamaah_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, mosque_slug TEXT NOT NULL, weekday INTEGER NOT NULL, prayer TEXT NOT NULL, time TEXT NOT NULL, week_start TEXT NOT NULL, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0);

-- 2. Fast lookup for the Find a Mosque overlay.
CREATE INDEX IF NOT EXISTS idx_user_subs_lookup ON user_jamaah_submissions (mosque_slug, week_start, weekday, prayer);

-- 3. Anti-spam. Each device may edit only ONE mosque per week, and has a cooldown between edits.
CREATE TABLE IF NOT EXISTS user_time_devices (device_id TEXT PRIMARY KEY, week_start TEXT NOT NULL, mosque_slug TEXT NOT NULL, last_at INTEGER NOT NULL);

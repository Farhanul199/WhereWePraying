-- migrations/008_reports_blocks.sql
-- Report + block for Community Ideas (Google Play / Apple UGC rules).
--
-- RUN EACH STATEMENT SEPARATELY in the D1 console (Workers & Pages > D1 >
-- wherewepraying-db > Console). Running the whole file at once gives
-- "SQLITE_ERROR: incomplete input".
--
-- If statement 4 says "duplicate column name: banned_at", it is already
-- applied — skip it.

-- 1. Reports. One row per person per item (can't report the same thing twice).
--    target_type: 'idea' | 'comment'. content_snapshot keeps the text as it
--    was when reported, so you can still see it if it's deleted later.
CREATE TABLE IF NOT EXISTS content_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL, target_user_id TEXT, reason TEXT NOT NULL, details TEXT, content_snapshot TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, reviewed_at INTEGER, UNIQUE (reporter_id, target_type, target_id));

-- 2. Fast lookups for the admin queue and the auto-hide count.
CREATE INDEX IF NOT EXISTS idx_reports_target ON content_reports (target_type, target_id, status);

-- 3. Blocks. A blocked person's ideas and comments disappear for the blocker.
CREATE TABLE IF NOT EXISTS user_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (blocker_id, blocked_id));

-- 4. Banned accounts can still sign in and read, but can't post.
ALTER TABLE users ADD COLUMN banned_at INTEGER;

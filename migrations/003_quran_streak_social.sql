-- migrations/003_quran_streak_social.sql
-- Backs the Qur'an Reading Streak social layer (friends' streaks + poke):
--   quran_streaks — per-user streak snapshot, upserted from the client
--     (mirrors leaderboard_scores' pattern; see functions/api/leaderboard.js)
--   quran_pokes   — a once-per-day-per-pair poke log, used both to enforce
--     the daily limit and to show "Poked ✓" in the friends panel

CREATE TABLE IF NOT EXISTS quran_streaks (
  user_id TEXT PRIMARY KEY,
  streak_days INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quran_pokes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  poke_date TEXT NOT NULL,        -- YYYY-MM-DD (UTC) — one poke per pair per day
  created_at TEXT NOT NULL,
  UNIQUE(from_user_id, to_user_id, poke_date)
);

CREATE INDEX IF NOT EXISTS idx_quran_pokes_to ON quran_pokes(to_user_id, poke_date);

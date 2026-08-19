-- WhereWePraying? — Stage 1 storage schema
--
-- Design choice: each app section (quran, journal, dua, guides) is stored
-- as ONE JSON blob per device rather than a fully normalized relational
-- schema. That trade-off is deliberate for this phase: the app is still
-- being iterated on with a handful of test users, the fields inside each
-- section will keep changing, and a blob means a field can be added or
-- renamed on the frontend without a matching database migration every
-- time. If/when the app grows real accounts, real scale, or a need to
-- query inside this data (e.g. "how many people logged Fajr today"),
-- this is the natural point to split it into proper relational tables —
-- nothing here blocks that later.

CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  device_id   TEXT NOT NULL,
  section     TEXT NOT NULL,          -- 'quran' | 'journal' | 'dua' | 'guides'
  data        TEXT NOT NULL,          -- JSON blob, shape owned by the frontend
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, section)
);

CREATE INDEX IF NOT EXISTS idx_app_state_updated_at ON app_state(updated_at);

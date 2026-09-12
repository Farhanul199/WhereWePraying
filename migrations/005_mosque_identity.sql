-- migrations/005_mosque_identity.sql
-- =====================================================================
-- WhereWePraying: multi-source identity layer ("the translator desk").
--
-- THE PROBLEM THIS FIXES:
-- Each data source (THM, MasjidBox, MyMasjid) was saving prayer times
-- under its OWN mosque code, but the website looks times up under the
-- official mosque slug. The codes never matched, so times (especially
-- THM) never showed up, and the same mosque appeared multiple times
-- under different names.
--
-- THE FIX:
-- 1. jamaah_raw / jummah_raw : every source saves here under its OWN
--    code. Sources never overwrite each other.
-- 2. mosque_sources : the translator sheet. Says which source-codes
--    belong to which official mosque. This is also where alternative
--    names and extra coordinates live.
-- 3. thm_jamaah_times / jummah_times become VIEWS: they fuse all
--    sources into ONE clean row per mosque per day (best source wins:
--    manual > THM > MasjidBox > MyMasjid). The website keeps reading
--    the same table names, so nothing else breaks.
--
-- SAFETY: nothing is deleted. The old tables are renamed to
-- *_legacy and kept as a full backup. Paste this file ONCE into the
-- D1 console. If you see an error about "duplicate column name", that
-- specific line was already applied before - it is safe to ignore
-- that one line and run the rest.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Make sure jummah_times exists so the rename below never fails
--    (it was created by hand in the dashboard on some setups).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jummah_times (
  location TEXT NOT NULL,
  date TEXT NOT NULL,
  slot INTEGER NOT NULL,
  time TEXT,
  created_at INTEGER
);

-- ---------------------------------------------------------------------
-- 1. Which source wins when two sources know the same mosque+day.
--    Lower number = more trusted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_priorities (
  source TEXT PRIMARY KEY,
  priority INTEGER NOT NULL
);
INSERT OR IGNORE INTO source_priorities (source, priority) VALUES
  ('manual', 10),            -- times entered by you / a mosque committee
  ('thm_scrape', 20),        -- Tower Hamlets Mosques
  ('masjidbox_scrape', 30),  -- MasjidBox
  ('mymasjid_scrape', 40);   -- MyMasjid

-- ---------------------------------------------------------------------
-- 2. Raw inboxes - one row per source per mosque-code per day.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jamaah_raw (
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,      -- the source's own code for the mosque
  date TEXT NOT NULL,            -- YYYY-MM-DD
  fajr_jamaah TEXT,
  zuhr_jamaah TEXT,
  asr_jamaah TEXT,
  maghrib_jamaah TEXT,
  isha_jamaah TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, source_ref, date)
);
CREATE INDEX IF NOT EXISTS idx_jamaah_raw_ref ON jamaah_raw(source, source_ref);
CREATE INDEX IF NOT EXISTS idx_jamaah_raw_date ON jamaah_raw(date);

CREATE TABLE IF NOT EXISTS jummah_raw (
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  date TEXT NOT NULL,            -- the Friday date
  slot INTEGER NOT NULL,         -- 1st jamaah, 2nd jamaah, ...
  time TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, source_ref, date, slot)
);

-- ---------------------------------------------------------------------
-- 3. The translator sheet: source-code -> official mosque slug.
--    mosque_slug is NULL until the code is matched (by the rebuild
--    tool or by you in the admin page).
--    name/lat/lon hold whatever THIS source knows about the mosque,
--    so a source with coordinates can fill in a mosque that was
--    missing them.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mosque_sources (
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  name TEXT,               -- the name THIS source uses (alternative name)
  lat REAL,
  lon REAL,
  mosque_slug TEXT,        -- official mosques.slug once matched
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (source, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_mosque_sources_slug ON mosque_sources(mosque_slug);

-- ---------------------------------------------------------------------
-- 4. Move the old blended tables out of the way (kept as backups).
-- ---------------------------------------------------------------------
ALTER TABLE thm_jamaah_times RENAME TO thm_jamaah_times_legacy;
ALTER TABLE jummah_times RENAME TO jummah_times_legacy;

-- ---------------------------------------------------------------------
-- 5. Copy every old row into the raw inboxes, labelled by its real
--    source (old THM rows had no source label -> thm_scrape).
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO jamaah_raw
  (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
SELECT
  COALESCE(source, 'thm_scrape'),
  mosque,
  date,
  fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah,
  COALESCE(updated_at, datetime('now'))
FROM thm_jamaah_times_legacy;

INSERT OR IGNORE INTO jummah_raw
  (source, source_ref, date, slot, time, updated_at)
SELECT
  'manual', location, date, slot, time, datetime('now')
FROM jummah_times_legacy;

-- ---------------------------------------------------------------------
-- 6. Auto-match the easy ones: any source code that is ALREADY an
--    official mosque slug gets linked immediately. Everything else
--    stays unmatched until the rebuild tool / admin page handles it.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO mosque_sources (source, source_ref, mosque_slug, first_seen, last_seen)
SELECT DISTINCT r.source, r.source_ref, m.slug, datetime('now'), datetime('now')
FROM jamaah_raw r
JOIN mosques m ON m.slug = r.source_ref;

INSERT OR IGNORE INTO mosque_sources (source, source_ref, mosque_slug, first_seen, last_seen)
SELECT DISTINCT r.source, r.source_ref, m.slug, datetime('now'), datetime('now')
FROM jummah_raw r
JOIN mosques m ON m.slug = r.source_ref;

-- Also register every code we saw, even if not matched yet, so the
-- admin page can list them for matching.
INSERT OR IGNORE INTO mosque_sources (source, source_ref, mosque_slug, first_seen, last_seen)
SELECT DISTINCT source, source_ref, NULL, datetime('now'), datetime('now') FROM jamaah_raw;

-- ---------------------------------------------------------------------
-- 7. The fused views. Same names as before, so the website code does
--    not change. One clean row per official mosque per day; the most
--    trusted source wins; ties broken by most recently updated.
-- ---------------------------------------------------------------------
CREATE VIEW thm_jamaah_times AS
SELECT mosque_slug AS mosque, date,
       fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah,
       source, updated_at
FROM (
  SELECT ms.mosque_slug, r.date,
         r.fajr_jamaah, r.zuhr_jamaah, r.asr_jamaah, r.maghrib_jamaah, r.isha_jamaah,
         r.source, r.updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY ms.mosque_slug, r.date
           ORDER BY sp.priority ASC, r.updated_at DESC
         ) AS rn
  FROM jamaah_raw r
  JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
  JOIN source_priorities sp ON sp.source = r.source
  WHERE ms.mosque_slug IS NOT NULL
)
WHERE rn = 1;

CREATE VIEW jummah_times AS
SELECT mosque_slug AS location, date, slot, time, updated_at AS created_at
FROM (
  SELECT ms.mosque_slug, r.date, r.slot, r.time, r.updated_at,
         ROW_NUMBER() OVER (
           PARTITION BY ms.mosque_slug, r.date, r.slot
           ORDER BY sp.priority ASC, r.updated_at DESC
         ) AS rn
  FROM jummah_raw r
  JOIN mosque_sources ms ON ms.source = r.source AND ms.source_ref = r.source_ref
  JOIN source_priorities sp ON sp.source = r.source
  WHERE ms.mosque_slug IS NOT NULL
)
WHERE rn = 1;

-- ---------------------------------------------------------------------
-- 8. Two new optional columns on mosques:
--    merged_into   - if this row was a duplicate, points at the keeper
--    canonical_key - normalised name+postcode used by the matcher
-- ---------------------------------------------------------------------
ALTER TABLE mosques ADD COLUMN merged_into TEXT;
ALTER TABLE mosques ADD COLUMN canonical_key TEXT;

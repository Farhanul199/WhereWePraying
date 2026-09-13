-- migrations/007_admin_mosque_edits.sql
-- Supports /admin/mosques.html (add / edit / hibernate a mosque).
--
-- RUN EACH STATEMENT SEPARATELY in the D1 console. Running the whole file
-- at once gives "SQLITE_ERROR: incomplete input".
--
-- If statement 1 says "duplicate column name: locked_fields", it is already
-- applied — skip it and carry on.

-- 1. Remembers which detail fields you edited by hand. Comma-separated,
--    e.g. "name,address,latitude,longitude". The auto-matcher and any
--    scraper backfill skip these fields, so your correction always sticks.
ALTER TABLE mosques ADD COLUMN locked_fields TEXT;

-- 2. Manual prayer times become a FALLBACK, not an override. Lower number
--    wins in the fused thm_jamaah_times / jummah_times views, so moving
--    'manual' from 10 to 90 means every real scrape beats it, and manually
--    entered times only show on days no scrape covers.
UPDATE source_priorities SET priority = 90 WHERE source = 'manual';

-- 3. Safety net in case the row was never seeded.
INSERT OR IGNORE INTO source_priorities (source, priority) VALUES ('manual', 90);

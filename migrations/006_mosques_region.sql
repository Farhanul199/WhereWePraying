-- migrations/006_mosques_region.sql
-- The nearby/mosque pages read m.region, but no migration ever created
-- that column (it was added by hand in the dashboard). This makes fresh
-- setups match the live site. If the column already exists you will get
-- a "duplicate column name" error on this one line - that is fine, it
-- means you already have it and nothing else is needed.
ALTER TABLE mosques ADD COLUMN region TEXT;

-- Run once against your D1 database (Cloudflare dashboard: D1 -> your DB -> Console),
-- or via: wrangler d1 execute <DB_NAME> --file=migrations/002_push_subscriptions.sql

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  user_id TEXT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT,
  lat REAL,
  lon REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_device ON push_subscriptions(device_id);

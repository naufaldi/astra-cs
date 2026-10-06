CREATE TABLE IF NOT EXISTS handoff (
  id TEXT PRIMARY KEY,
  commodity TEXT NOT NULL,
  province TEXT NOT NULL,
  displayed_price INTEGER NOT NULL,
  claimed_price INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

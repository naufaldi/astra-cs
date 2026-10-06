-- Workshop feature: token usage stored next to the content-free request log.
-- Remove this table together with src/workshop/usage-log.ts.
CREATE TABLE IF NOT EXISTS request_usage (
  id TEXT PRIMARY KEY,
  time TEXT NOT NULL,
  outcome TEXT NOT NULL,
  commodity TEXT,
  trading_date TEXT,
  price_read_ms INTEGER NOT NULL,
  wording_ms INTEGER NOT NULL,
  error_class TEXT,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  est_cost_usd REAL NOT NULL,
  est_cost_idr INTEGER NOT NULL,
  tenant_id TEXT NOT NULL
);

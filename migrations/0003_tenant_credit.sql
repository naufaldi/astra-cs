-- Workshop feature: one credit per successful model call.
-- Remove this table together with src/workshop/credits.ts.
CREATE TABLE IF NOT EXISTS tenant_credit (
  tenant_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL
);

INSERT OR IGNORE INTO tenant_credit (tenant_id, balance) VALUES ('demo', 50);

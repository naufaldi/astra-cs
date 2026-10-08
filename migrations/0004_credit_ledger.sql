-- Workshop feature: token balances and a ledger that sums to the balance.
-- 0003 stored one credit per model call. Multiply those balances into tokens
-- (1 credit = 1,000 tokens) and backfill a grant row for each tenant.
-- idr_amount is integer sen (rupiah × 100), never a float.

UPDATE tenant_credit SET balance = balance * 1000;

CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  delta_tokens INTEGER NOT NULL,
  reason TEXT NOT NULL,
  chat_ref TEXT,
  idr_amount INTEGER NOT NULL DEFAULT 0,
  overdraft_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO credit_ledger (tenant_id, delta_tokens, reason, chat_ref, idr_amount, overdraft_tokens, created_at)
SELECT tenant_id, balance, 'grant', NULL, 0, 0, '2026-10-06T00:00:00.000Z'
FROM tenant_credit;

ALTER TABLE request_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_usage ADD COLUMN charged_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_usage ADD COLUMN overdraft_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_usage ADD COLUMN peak INTEGER NOT NULL DEFAULT 0;

-- Workshop feature: a display name per tenant, and one ledger row per top-up click.
-- idempotency_key is null on usage and on grants that were not submitted from a dialog.
-- Apply this on the preview D1 only until production is ready for it.

ALTER TABLE tenant_credit ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE tenant_credit ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-10-06T00:00:00.000Z';

UPDATE tenant_credit SET name = tenant_id WHERE name = '';

ALTER TABLE credit_ledger ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_idempotency_key
  ON credit_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

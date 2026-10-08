import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { HandoffDb } from "../src/agent/handoff.js";

type SqlValue = string | number | bigint | Uint8Array | null;

/** Apply migrations 0001–0006 to a memory database. Demo starts at 50,000 tokens. */
export function openWorkshopDb(): { db: HandoffDb; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_handoff.sql", "0002_request_usage.sql", "0003_tenant_credit.sql", "0004_credit_ledger.sql", "0005_tenant_name.sql", "0006_admins.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const db: HandoffDb = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          const bound = values.map((value) => (value === undefined ? null : value)) as SqlValue[];
          return {
            async run() {
              sqlite.prepare(query).run(...bound);
            },
            async all<T>() {
              const results = sqlite.prepare(query).all(...bound) as T[];
              return { results };
            },
          };
        },
      };
    },
  };
  return { db, sqlite };
}

/** Insert a tenant whose balance already matches its grant row. */
export function seedTenant(sqlite: DatabaseSync, tenantId: string, tokens: number): void {
  sqlite.prepare("INSERT INTO tenant_credit (tenant_id, balance, name, created_at) VALUES (?, ?, ?, ?)").run(tenantId, tokens, tenantId, "2026-10-06T00:00:00.000Z");
  sqlite
    .prepare(
      "INSERT INTO credit_ledger (tenant_id, delta_tokens, reason, chat_ref, idr_amount, overdraft_tokens, created_at) VALUES (?, ?, 'grant', NULL, 0, 0, ?)",
    )
    .run(tenantId, tokens, "2026-10-06T00:00:00.000Z");
}

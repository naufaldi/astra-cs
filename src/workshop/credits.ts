/**
 * One credit per successful model call, per tenant.
 * Workshop feature: delete this file and migration 0003_tenant_credit.sql.
 * Refusals, claims, empty messages, and template answers (no API key) are free.
 * The balance check happens before the model call. The decrement happens only after it succeeds.
 */

import type { HandoffDb } from "../agent/handoff.js";
import type { ReplyLanguage } from "../agent/language.js";

export const defaultTenantId = "demo";
export const tenantHeader = "x-tenant-id";
export const creditCost = 1;

const tenantSlug = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Read the optional tenant header. A missing or odd value uses the demo tenant. */
export function tenantIdFrom(request: Request): string {
  const value = request.headers.get(tenantHeader)?.trim().toLowerCase() ?? "";
  return tenantSlug.test(value) ? value : defaultTenantId;
}

/** Current balance. An unknown tenant is created with zero credits. */
export async function readBalance(db: HandoffDb, tenantId: string): Promise<number> {
  const existing = await lookupBalance(db, tenantId);
  if (existing !== null) {
    return existing;
  }
  await db.prepare("INSERT OR IGNORE INTO tenant_credit (tenant_id, balance) VALUES (?, 0)").bind(tenantId).run();
  return (await lookupBalance(db, tenantId)) ?? 0;
}

/** Spend one credit and return what is left. A zero balance stays zero. */
export async function spendOneCredit(db: HandoffDb, tenantId: string): Promise<number> {
  await db
    .prepare("UPDATE tenant_credit SET balance = balance - 1 WHERE tenant_id = ? AND balance >= 1")
    .bind(tenantId)
    .run();
  return (await lookupBalance(db, tenantId)) ?? 0;
}

/** Every tenant balance, for the guarded credits route. */
export async function listCredits(db: HandoffDb): Promise<{ tenantId: string; balance: number }[]> {
  const result = await db
    .prepare("SELECT tenant_id, balance FROM tenant_credit ORDER BY tenant_id")
    .bind()
    .all<{ tenant_id: string; balance: number }>();
  return result.results.map((row) => ({ tenantId: row.tenant_id, balance: row.balance }));
}

/** Friendly out-of-credits reply. The model is not called. */
export function outOfCreditsReply(language: ReplyLanguage): string {
  switch (language) {
    case "en":
      return "This demo is out of credits. Refusals and claims stay free. A price answer needs one credit.";
    case "id":
      return "Kredit untuk tenant ini sudah habis. Penolakan dan klaim tetap gratis. Jawaban harga butuh satu kredit.";
    default: {
      const unexpected: never = language;
      throw new Error(`unexpected language ${JSON.stringify(unexpected)}`);
    }
  }
}

async function lookupBalance(db: HandoffDb, tenantId: string): Promise<number | null> {
  const result = await db
    .prepare("SELECT balance FROM tenant_credit WHERE tenant_id = ?")
    .bind(tenantId)
    .all<{ balance: number }>();
  const row = result.results[0];
  return row ? row.balance : null;
}

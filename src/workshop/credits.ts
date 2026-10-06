/**
 * Token balances per tenant.
 * Workshop feature: delete this file together with src/workshop/charge-credits.ts.
 * One credit is 1,000 tokens. The balance column stores tokens, not credits.
 * Refusals, claims, empty messages, and template answers (no API key) are free.
 */

import type { HandoffDb } from "../agent/handoff.js";
import type { ReplyLanguage } from "../agent/language.js";
import { ensureTenant } from "./charge-credits.js";
import { tokensToCredits } from "./credit-price.js";

export const defaultTenantId = "demo";
export const tenantHeader = "x-tenant-id";

const tenantSlug = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Read the optional tenant header. A missing or odd value uses the demo tenant. */
export function tenantIdFrom(request: Request): string {
  const value = request.headers.get(tenantHeader)?.trim().toLowerCase() ?? "";
  return tenantSlug.test(value) ? value : defaultTenantId;
}

/** True when the visitor named a tenant. A blank header means the demo default. */
export function namedTenantFrom(request: Request): string | null {
  const value = request.headers.get(tenantHeader)?.trim().toLowerCase() ?? "";
  return tenantSlug.test(value) ? value : null;
}

/** True when a form may use this id. Same shape as the chat header. */
export function isTenantSlug(value: string): boolean {
  return tenantSlug.test(value);
}

export type CreditAccount = {
  tenantId: string;
  tokens: number;
  credits: number;
};

export type CreditChargeView = CreditAccount & {
  chargedTokens: number;
  chargedCredits: number;
};

/** Current token balance. An unknown tenant is created with zero tokens. */
export async function readBalance(db: HandoffDb, tenantId: string): Promise<number> {
  return ensureTenant(db, tenantId, new Date().toISOString());
}

/** Balance for a tenant that already exists. Does not create a row. */
export async function findBalance(db: HandoffDb, tenantId: string): Promise<number | null> {
  const result = await db
    .prepare("SELECT balance FROM tenant_credit WHERE tenant_id = ?")
    .bind(tenantId)
    .all<{ balance: number }>();
  const row = result.results[0];
  return row ? row.balance : null;
}

/** Every tenant balance, for the guarded credits route. */
export async function listCredits(db: HandoffDb): Promise<CreditAccount[]> {
  const result = await db
    .prepare("SELECT tenant_id, balance FROM tenant_credit ORDER BY tenant_id")
    .bind()
    .all<{ tenant_id: string; balance: number }>();
  return result.results.map((row) => creditAccount(row.tenant_id, row.balance));
}

/** Tokens plus the two-decimal credit view for a chat response. */
export function creditChargeView(tenantId: string, tokens: number, chargedTokens: number): CreditChargeView {
  return {
    ...creditAccount(tenantId, tokens),
    chargedTokens,
    chargedCredits: tokensToCredits(chargedTokens),
  };
}

/** A whole number of credits from a form, or null when it is not. */
export function parseCreditCount(value: string, allowZero: boolean): number | null {
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const count = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(count) || count < minimum || count > 100_000) {
    return null;
  }
  return count;
}

/** Friendly out-of-credits reply. The model is not called. */
export function outOfCreditsReply(language: ReplyLanguage): string {
  switch (language) {
    case "en":
      return "Credits are used up. Contact the admin for a top-up.";
    case "id":
      return "Kredit habis. Hubungi admin untuk top up.";
    default: {
      const unexpected: never = language;
      throw new Error(`unexpected language ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Reply when `?tenant=` names an id that is not in the ledger. Nothing is created. */
export function tenantNotFoundReply(language: ReplyLanguage): string {
  switch (language) {
    case "en":
      return "Tenant not found";
    case "id":
      return "Tenant tidak ditemukan";
    default: {
      const unexpected: never = language;
      throw new Error(`unexpected language ${JSON.stringify(unexpected)}`);
    }
  }
}

function creditAccount(tenantId: string, tokens: number): CreditAccount {
  return { tenantId, tokens, credits: tokensToCredits(tokens) };
}

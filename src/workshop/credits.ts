/**
 * Token balances per tenant.
 * Workshop feature: delete this file together with src/workshop/charge-credits.ts.
 * One credit is 1,000 tokens. The balance column stores tokens, not credits.
 * Refusals, claims, empty messages, and template answers (no API key) are free.
 */

import type { HandoffDb } from "../agent/handoff.js";
import type { ReplyLanguage } from "../agent/language.js";
import { ensureTenant } from "./charge-credits.js";
import { GATE_TOKENS, TOKENS_PER_CREDIT, tokensToCredits } from "./credit-price.js";

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

/** Tenant id for a display name. Spaces and punctuation become hyphens. */
export function slugFromName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return tenantSlug.test(slug) ? slug : null;
}

const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One dialog open, one key. A repeated key must not credit twice. */
export function isIdempotencyKey(value: string): boolean {
  return idempotencyKeyPattern.test(value);
}

export type CreditInputError = "empty" | "whole" | "max";
export type NameInputError = "empty" | "length";

/** Whole credits for a dialog. Zero is allowed only for a new tenant's opening balance. */
export function validateCreditInput(value: string, allowZero: boolean): { count: number } | { error: CreditInputError } {
  const trimmed = value.trim();
  if (trimmed === "") {
    return allowZero ? { count: 0 } : { error: "empty" };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { error: "whole" };
  }
  const count = Number(trimmed);
  if (!Number.isInteger(count) || count < 0) {
    return { error: "whole" };
  }
  if (count === 0 && !allowZero) {
    return { error: "whole" };
  }
  if (count > 10_000) {
    return { error: "max" };
  }
  return { count };
}

/** Inline copy for a credit field. */
export function creditInputMessage(error: CreditInputError): string {
  switch (error) {
    case "empty":
      return "Isi jumlah kredit.";
    case "whole":
      return "Jumlah harus bilangan bulat lebih dari 0.";
    case "max":
      return "Maksimal 10.000 kredit per top up.";
    default: {
      const unexpected: never = error;
      throw new Error(`unexpected credit error ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Display name for a new tenant. The slug is derived; there is no separate id field. */
export function validateTenantName(value: string): { name: string; slug: string } | { error: NameInputError } {
  const name = value.trim();
  if (name === "") {
    return { error: "empty" };
  }
  const slug = slugFromName(name);
  if (name.length < 2 || name.length > 60 || slug === null) {
    return { error: "length" };
  }
  return { name, slug };
}

/** Inline copy for the name field. */
export function nameInputMessage(error: NameInputError | "taken"): string {
  switch (error) {
    case "empty":
      return "Isi nama tenant.";
    case "length":
      return "Nama 2–60 karakter.";
    case "taken":
      return "Nama tenant sudah dipakai.";
    default: {
      const unexpected: never = error;
      throw new Error(`unexpected name error ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Badge next to a balance. Under 2 credits is blocked. 2 through 10 is low. */
export function balanceBadge(tokens: number): "blocked" | "low" | null {
  if (tokens < GATE_TOKENS) {
    return "blocked";
  }
  if (tokens / TOKENS_PER_CREDIT <= 10) {
    return "low";
  }
  return null;
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

/** Display name for the chat header. Does not create a row. */
export async function findTenantName(db: HandoffDb, tenantId: string): Promise<string | null> {
  const result = await db
    .prepare("SELECT name FROM tenant_credit WHERE tenant_id = ?")
    .bind(tenantId)
    .all<{ name: string }>();
  const row = result.results[0];
  if (!row) {
    return null;
  }
  return row.name.trim() === "" ? tenantId : row.name;
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

/** Neutral unavailable reply. The model is not called, and the copy does not mention billing. */
export function outOfCreditsReply(language: ReplyLanguage): string {
  switch (language) {
    case "en":
      return "Sorry, chat is temporarily unavailable.\nPlease try again in a moment.";
    case "id":
      return "Maaf, layanan chat sedang tidak tersedia.\nSilakan coba lagi beberapa saat lagi.";
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
      return "This service was not found.";
    case "id":
      return "Layanan ini tidak ditemukan.";
    default: {
      const unexpected: never = language;
      throw new Error(`unexpected language ${JSON.stringify(unexpected)}`);
    }
  }
}

function creditAccount(tenantId: string, tokens: number): CreditAccount {
  return { tenantId, tokens, credits: tokensToCredits(tokens) };
}

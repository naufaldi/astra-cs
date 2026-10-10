/**
 * WORKSHOP EXERCISE — chargeCredits.
 * Tokens become a credit charge, the 2-credit gate decides whether the model runs,
 * and every change to the balance is one credit_ledger row.
 * Delete this file together with migrations/0004_credit_ledger.sql.
 *
 * No model call means no charge. After a model call, deduct the actual total
 * (input + output, reasoning included), never go below zero, and keep the
 * shortfall in overdraft_tokens.
 */

import type { HandoffDb } from "../agent/handoff.js";
import { GATE_TOKENS, TOKENS_PER_CREDIT, tokensToCredits, tokensToSen } from "./credit-price.js";
import type { TokenUsage } from "./token-usage.js";

export type ChargePlan = {
  chargedTokens: number;
  chargedCredits: number;
  overdraftTokens: number;
  balanceTokens: number;
};

/** True when the tenant may start a model call. Under 2 credits, the route returns 402. */
export function passesCreditGate(balanceTokens: number): boolean {
  return balanceTokens >= GATE_TOKENS;
}

/** How many tokens to deduct. The balance floors at zero. */
export function planCharge(balanceTokens: number, totalTokens: number): ChargePlan {
  const available = Math.max(0, Math.trunc(balanceTokens));
  const used = Math.max(0, Math.trunc(totalTokens));
  const chargedTokens = Math.min(available, used);
  return {
    chargedTokens,
    chargedCredits: tokensToCredits(chargedTokens),
    overdraftTokens: used - chargedTokens,
    balanceTokens: available - chargedTokens,
  };
}

/**
 * Deduct actual usage and append a `usage` ledger row.
 * Call this only after the model has returned token counts.
 */
export async function chargeCredits(
  db: HandoffDb,
  tenantId: string,
  usage: TokenUsage,
  chatRef: string,
  now: string,
): Promise<ChargePlan> {
  const existing = await readBalanceTokens(db, tenantId);
  const balance = existing === null ? await ensureTenant(db, tenantId, now) : existing;
  const plan = planCharge(balance, usage.totalTokens);
  await db.prepare("UPDATE tenant_credit SET balance = ? WHERE tenant_id = ?").bind(plan.balanceTokens, tenantId).run();
  await insertLedger(db, {
    tenantId,
    deltaTokens: -plan.chargedTokens,
    reason: "usage",
    chatRef,
    sen: tokensToSen(plan.chargedTokens),
    overdraftTokens: plan.overdraftTokens,
    now,
    idempotencyKey: null,
  });
  return plan;
}

/** Current token balance. An unknown tenant is opened at zero with a grant row. */
export async function ensureTenant(db: HandoffDb, tenantId: string, now: string): Promise<number> {
  const existing = await readBalanceTokens(db, tenantId);
  if (existing !== null) {
    return existing;
  }
  await writeGrant(db, tenantId, tenantId, 0, now, null);
  return 0;
}

/** Opening balance for a new tenant. `grant` is not cash. A repeated key does not create a second row. */
export async function createTenant(
  db: HandoffDb,
  tenantId: string,
  name: string,
  creditCount: number,
  now: string,
  idempotencyKey: string,
): Promise<"created" | "exists" | "replay"> {
  if (await readIdempotent(db, idempotencyKey)) {
    return "replay";
  }
  if (await nameTaken(db, tenantId, name)) {
    return "exists";
  }
  const tokens = Math.trunc(creditCount) * TOKENS_PER_CREDIT;
  try {
    await db
      .prepare("INSERT INTO tenant_credit (tenant_id, balance, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(tenantId, tokens, name, now)
      .run();
  } catch {
    return (await readIdempotent(db, idempotencyKey)) ? "replay" : "exists";
  }
  try {
    await insertLedger(db, {
      tenantId,
      deltaTokens: tokens,
      reason: "grant",
      chatRef: null,
      sen: 0,
      overdraftTokens: 0,
      now,
      idempotencyKey,
    });
  } catch {
    if (await readIdempotent(db, idempotencyKey)) {
      return "replay";
    }
    await db.prepare("DELETE FROM tenant_credit WHERE tenant_id = ?").bind(tenantId).run();
    throw new Error("tenant grant was not recorded");
  }
  return "created";
}

/** Fake top-up. The ledger row is the cash-in. A missing tenant is not created. A repeated key credits once. */
export async function topUpFake(
  db: HandoffDb,
  tenantId: string,
  creditCount: number,
  now: string,
  idempotencyKey: string,
): Promise<"ok" | "missing" | "replay"> {
  if (await readIdempotent(db, idempotencyKey)) {
    return "replay";
  }
  const existing = await readBalanceTokens(db, tenantId);
  if (existing === null) {
    return "missing";
  }
  const tokens = Math.trunc(creditCount) * TOKENS_PER_CREDIT;
  await db.prepare("UPDATE tenant_credit SET balance = balance + ? WHERE tenant_id = ?").bind(tokens, tenantId).run();
  try {
    await insertLedger(db, {
      tenantId,
      deltaTokens: tokens,
      reason: "topup_fake",
      chatRef: null,
      sen: tokensToSen(tokens),
      overdraftTokens: 0,
      now,
      idempotencyKey,
    });
  } catch {
    await db.prepare("UPDATE tenant_credit SET balance = balance - ? WHERE tenant_id = ?").bind(tokens, tenantId).run();
    if (await readIdempotent(db, idempotencyKey)) {
      return "replay";
    }
    throw new Error("top-up was not recorded");
  }
  return "ok";
}

/** Sum of balances minus sum of ledger deltas. Zero means the books match. */
export async function ledgerGap(db: HandoffDb): Promise<number> {
  const balances = await scalar(db, "SELECT COALESCE(SUM(balance), 0) AS n FROM tenant_credit");
  const deltas = await scalar(db, "SELECT COALESCE(SUM(delta_tokens), 0) AS n FROM credit_ledger");
  return balances - deltas;
}

async function writeGrant(
  db: HandoffDb,
  tenantId: string,
  name: string,
  tokens: number,
  now: string,
  idempotencyKey: string | null,
): Promise<void> {
  await db
    .prepare("INSERT INTO tenant_credit (tenant_id, balance, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(tenantId, tokens, name, now)
    .run();
  await insertLedger(db, {
    tenantId,
    deltaTokens: tokens,
    reason: "grant",
    chatRef: null,
    sen: 0,
    overdraftTokens: 0,
    now,
    idempotencyKey,
  });
}

async function nameTaken(db: HandoffDb, tenantId: string, name: string): Promise<boolean> {
  const result = await db
    .prepare("SELECT tenant_id FROM tenant_credit WHERE tenant_id = ? OR lower(name) = lower(?)")
    .bind(tenantId, name)
    .all<{ tenant_id: string }>();
  return result.results.length > 0;
}

async function readIdempotent(db: HandoffDb, idempotencyKey: string): Promise<boolean> {
  const result = await db
    .prepare("SELECT id FROM credit_ledger WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .all<{ id: number }>();
  return result.results.length > 0;
}

async function readBalanceTokens(db: HandoffDb, tenantId: string): Promise<number | null> {
  const result = await db
    .prepare("SELECT balance FROM tenant_credit WHERE tenant_id = ?")
    .bind(tenantId)
    .all<{ balance: number }>();
  const row = result.results[0];
  return row ? row.balance : null;
}

type LedgerReason = "grant" | "topup_fake" | "usage";

async function insertLedger(
  db: HandoffDb,
  row: {
    tenantId: string;
    deltaTokens: number;
    reason: LedgerReason;
    chatRef: string | null;
    sen: number;
    overdraftTokens: number;
    now: string;
    idempotencyKey: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credit_ledger (
        tenant_id, delta_tokens, reason, chat_ref, idr_amount, overdraft_tokens, created_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.tenantId,
      row.deltaTokens,
      row.reason,
      row.chatRef,
      row.sen,
      row.overdraftTokens,
      row.now,
      row.idempotencyKey,
    )
    .run();
}

async function scalar(db: HandoffDb, query: string): Promise<number> {
  const result = await db.prepare(query).bind().all<{ n: number }>();
  return result.results[0]?.n ?? 0;
}

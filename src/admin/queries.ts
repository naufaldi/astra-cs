/**
 * Numbers for the admin page. Earned revenue is credits used × Rp100.
 * Cash in is fake top-ups only. Margin is earned minus Astra Flow's rupiah cost.
 */

import type { HandoffDb } from "../agent/handoff.js";
import { CREDIT_PRICE_IDR, senToRupiah, TOKENS_PER_CREDIT } from "../workshop/credit-price.js";

export type Totals = {
  tokens: number;
  chargedTokens: number;
  creditsUsed: number;
  costIdr: number;
  earnedIdr: number;
  marginIdr: number;
  marginPct: number;
  cashInIdr: number;
};

export type TenantRow = {
  tenantId: string;
  balanceTokens: number;
  balanceCredits: number;
  creditsUsed: number;
  earnedIdr: number;
  costIdr: number;
  marginIdr: number;
};

export type ChatRow = {
  time: string;
  tenantId: string;
  outcome: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costIdr: number;
  chargedCredits: number;
  peak: boolean;
};

export type HandoffRow = {
  commodity: string;
  province: string;
  displayedPrice: number;
  claimedPrice: number;
  createdAt: string;
};

export type Dashboard = {
  today: Totals;
  allTime: Totals;
  tenants: TenantRow[];
  chats: ChatRow[];
  handoffs: HandoffRow[];
};

type SumRow = { tokens: number; charged: number; cost: number };
type CashRow = { sen: number };
type TenantSql = { tenant_id: string; balance: number; charged: number; cost: number };
type ChatSql = {
  time: string;
  tenant_id: string;
  outcome: string;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  est_cost_idr: number;
  charged_tokens: number;
  peak: number;
};

/** Today (UTC) and all-time totals, tenants, the last 50 chats, and pending handoffs. */
export async function loadDashboard(db: HandoffDb, now: Date): Promise<Dashboard> {
  const range = utcDayRange(now);
  const [today, allTime, tenants, chats, handoffs] = await Promise.all([
    loadTotals(db, "WHERE time >= ? AND time < ?", [range.start, range.end], range),
    loadTotals(db, "", [], null),
    loadTenants(db),
    loadChats(db),
    loadHandoffs(db),
  ]);
  return { today, allTime, tenants, chats, handoffs };
}

/** Map a usage sum onto earned revenue and margin. */
export function totalsFrom(tokens: number, chargedTokens: number, costIdr: number, cashInIdr: number): Totals {
  const earnedIdr = (chargedTokens * CREDIT_PRICE_IDR) / TOKENS_PER_CREDIT;
  const marginIdr = earnedIdr - costIdr;
  return {
    tokens,
    chargedTokens,
    creditsUsed: chargedTokens / TOKENS_PER_CREDIT,
    costIdr,
    earnedIdr,
    marginIdr,
    marginPct: earnedIdr === 0 ? 0 : (marginIdr / earnedIdr) * 100,
    cashInIdr,
  };
}

async function loadTotals(db: HandoffDb, where: string, values: unknown[], range: { start: string; end: string } | null): Promise<Totals> {
  const usage = await db
    .prepare(
      `SELECT COALESCE(SUM(total_tokens), 0) AS tokens,
              COALESCE(SUM(charged_tokens), 0) AS charged,
              COALESCE(SUM(est_cost_idr), 0) AS cost
       FROM request_usage ${where}`,
    )
    .bind(...values)
    .all<SumRow>();
  const cashWhere = range ? "WHERE reason = 'topup_fake' AND created_at >= ? AND created_at < ?" : "WHERE reason = 'topup_fake'";
  const cashValues = range ? [range.start, range.end] : [];
  const cash = await db
    .prepare(`SELECT COALESCE(SUM(idr_amount), 0) AS sen FROM credit_ledger ${cashWhere}`)
    .bind(...cashValues)
    .all<CashRow>();
  const row = usage.results[0] ?? { tokens: 0, charged: 0, cost: 0 };
  return totalsFrom(row.tokens, row.charged, row.cost, senToRupiah(cash.results[0]?.sen ?? 0));
}

async function loadTenants(db: HandoffDb): Promise<TenantRow[]> {
  const result = await db
    .prepare(
      `SELECT c.tenant_id AS tenant_id,
              c.balance AS balance,
              COALESCE(u.charged, 0) AS charged,
              COALESCE(u.cost, 0) AS cost
       FROM tenant_credit c
       LEFT JOIN (
         SELECT tenant_id, SUM(charged_tokens) AS charged, SUM(est_cost_idr) AS cost
         FROM request_usage
         GROUP BY tenant_id
       ) u ON u.tenant_id = c.tenant_id
       ORDER BY c.tenant_id`,
    )
    .bind()
    .all<TenantSql>();
  return result.results.map((row) => {
    const earnedIdr = (row.charged * CREDIT_PRICE_IDR) / TOKENS_PER_CREDIT;
    return {
      tenantId: row.tenant_id,
      balanceTokens: row.balance,
      balanceCredits: row.balance / TOKENS_PER_CREDIT,
      creditsUsed: row.charged / TOKENS_PER_CREDIT,
      earnedIdr,
      costIdr: row.cost,
      marginIdr: earnedIdr - row.cost,
    };
  });
}

async function loadChats(db: HandoffDb): Promise<ChatRow[]> {
  const result = await db
    .prepare(
      `SELECT time, tenant_id, outcome, prompt_tokens, completion_tokens, reasoning_tokens,
              est_cost_idr, charged_tokens, peak
       FROM request_usage
       ORDER BY time DESC
       LIMIT 50`,
    )
    .bind()
    .all<ChatSql>();
  return result.results.map((row) => ({
    time: row.time,
    tenantId: row.tenant_id,
    outcome: outcomeLabel(row.outcome),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    costIdr: row.est_cost_idr,
    chargedCredits: row.charged_tokens / TOKENS_PER_CREDIT,
    peak: row.peak === 1,
  }));
}

async function loadHandoffs(db: HandoffDb): Promise<HandoffRow[]> {
  const result = await db
    .prepare(
      `SELECT commodity, province, displayed_price, claimed_price, created_at
       FROM handoff
       ORDER BY created_at`,
    )
    .bind()
    .all<{
      commodity: string;
      province: string;
      displayed_price: number;
      claimed_price: number;
      created_at: string;
    }>();
  return result.results.map((row) => ({
    commodity: row.commodity,
    province: row.province,
    displayedPrice: row.displayed_price,
    claimedPrice: row.claimed_price,
    createdAt: row.created_at,
  }));
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "answered":
    case "handoff":
    case "402":
    case "unread":
      return outcome;
    case "refusal":
      return "refused";
    default:
      return outcome;
  }
}

function utcDayRange(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

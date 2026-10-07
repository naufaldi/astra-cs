/**
 * Store the content-free request log plus token usage.
 * Workshop feature: delete this file and migration 0002_request_usage.sql.
 * The row keeps commodity, timing, and token counts. It does not keep the visitor message or the reply.
 */

import type { HandoffDb } from "../agent/handoff.js";
import type { RequestLog } from "../domain.js";
import type { TokenUsage } from "./token-usage.js";

export type UsageWrite = {
  usage: TokenUsage;
  tenantId: string;
  chargedTokens: number;
  overdraftTokens: number;
  peak: boolean;
};

/** Insert one usage row. `id` is the request id already printed on the console log. */
export async function insertRequestUsage(db: HandoffDb, log: RequestLog, write: UsageWrite): Promise<void> {
  await db
    .prepare(
      `INSERT INTO request_usage (
        id, time, outcome, commodity, trading_date,
        price_read_ms, wording_ms, error_class,
        prompt_tokens, completion_tokens, total_tokens,
        est_cost_usd, est_cost_idr, tenant_id,
        reasoning_tokens, charged_tokens, overdraft_tokens, peak
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      log.requestId,
      log.time,
      log.outcome,
      log.commodity,
      log.tradingDate,
      log.priceReadMs,
      log.wordingMs,
      log.errorClass,
      write.usage.promptTokens,
      write.usage.completionTokens,
      write.usage.totalTokens,
      write.usage.estCostUsd,
      write.usage.estCostIdr,
      write.tenantId,
      write.usage.reasoningTokens,
      write.chargedTokens,
      write.overdraftTokens,
      write.peak ? 1 : 0,
    )
    .run();
}

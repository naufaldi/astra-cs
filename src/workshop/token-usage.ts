/**
 * Token counts and estimated cost for one Astra Flow reply.
 * Workshop feature: delete this file and the call sites marked "workshop: usage".
 *
 * Prices are USD per million tokens for `deepseek-v4.1-flash`.
 * Source: Astra Flow catalog `GET https://api-sg.umodelverse.ai/v1/models`
 * (UCloud_UModelverse), field `pricing.windows`, unit "百万 Token", captured 2026-10-06.
 * Peak UTC 01:00–04:00 and 06:00–10:00: input 0.286, output 1.144.
 * Off-peak UTC 00:00–01:00, 04:00–06:00, and 10:00–24:00: input 0.143, output 0.572.
 * Windows are UTC, not Jakarta time. Peak is exactly twice off-peak.
 * Cached input is cheaper, but the chat `usage` object does not split cache hits,
 * so a reply uses the standard input rate.
 */

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Prompt plus completion. Reasoning is already inside completion. */
  totalTokens: number;
  /** Subset of completion tokens, from completion_tokens_details.reasoning_tokens. */
  reasoningTokens: number;
  estCostUsd: number;
  estCostIdr: number;
};

/** Per-million-token prices for the default model, plus a workshop rupiah rate. */
export const modelPrice = {
  model: "deepseek-v4.1-flash",
  peak: { inputPerMillionUsd: 0.286, outputPerMillionUsd: 1.144 },
  offPeak: { inputPerMillionUsd: 0.143, outputPerMillionUsd: 0.572 },
  /**
   * Rupiah per US dollar.
   * Workshop constant so a slide does not depend on a live FX feed.
   * This is not an Astra Flow price.
   */
  idrPerUsd: 16_500,
} as const;

/** A refusal, a claim, or any path that never called the model. */
export function zeroUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    estCostUsd: 0,
    estCostIdr: 0,
  };
}

/** True during the catalog's peak UTC windows. The end hour is excluded. */
export function isPeakUtc(now: Date): boolean {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inside = (startHour: number, endHour: number) => minutes >= startHour * 60 && minutes < endHour * 60;
  return inside(1, 4) || inside(6, 10);
}

/**
 * WORKSHOP EXERCISE — estimateCost.
 * Price one reply from token counts. Peak is twice the off-peak catalog rate.
 * The credit price does not change here.
 */
export function estimateCost(
  usage: { promptTokens: number; completionTokens: number },
  isPeak: boolean,
): { estCostUsd: number; estCostIdr: number } {
  const rate = isPeak ? modelPrice.offPeak : modelPrice.offPeak;
  const usd =
    (usage.promptTokens / 1_000) * rate.outputPerMillionUsd +
    (usage.completionTokens / 1_000) * rate.inputPerMillionUsd;
  const estCostUsd = Math.round(usd * 1e8) / 1e8;
  return { estCostUsd, estCostIdr: Math.round(estCostUsd * modelPrice.idrPerUsd) };
}

/** Read `usage` from an Astra Flow chat completion and price it. */
export function readTokenUsage(body: unknown, now: Date = new Date()): TokenUsage {
  const counted = extractUsage(body);
  return priceTokens(counted.promptTokens, counted.completionTokens, counted.totalTokens, now, counted.reasoningTokens);
}

/** Price a prompt/completion pair. `totalTokens` falls back to the sum when the API omits it. */
export function priceTokens(
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
  now: Date,
  reasoningTokens = 0,
): TokenUsage {
  const cost = estimateCost({ promptTokens, completionTokens }, isPeakUtc(now));
  const reported = totalTokens > 0 ? totalTokens : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens: reported, reasoningTokens, ...cost };
}

function extractUsage(body: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
} {
  if (typeof body !== "object" || body === null || !("usage" in body)) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 };
  }
  const usage = (body as { usage: unknown }).usage;
  if (typeof usage !== "object" || usage === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 };
  }
  const record = usage as Record<string, unknown>;
  return {
    promptTokens: numberField(record, "promptTokens"),
    completionTokens: numberField(record, "completionTokens"),
    totalTokens: numberField(record, "totalTokens"),
    reasoningTokens: reasoningTokensFrom(record),
  };
}

function reasoningTokensFrom(record: Record<string, unknown>): number {
  const details = record.completion_tokens_details;
  if (typeof details === "object" && details !== null && "reasoning_tokens" in details) {
    return numberField(details as Record<string, unknown>, "reasoning_tokens");
  }
  return numberField(record, "reasoning_tokens");
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

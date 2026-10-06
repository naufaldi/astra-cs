/**
 * Slide-ready monthly cost from an average model call.
 * Workshop feature: delete this file and scripts/cost-estimate.ts.
 * The planning rate is off-peak. A single reply still uses the peak window when the clock says so.
 */

import { modelPrice } from "./token-usage.js";

export const projectionVolumes = [1_000, 10_000, 100_000] as const;

export type ProjectionInput = {
  promptTokens: number;
  completionTokens: number;
  /** Fraction of customer chats that reach the model. Refusals and claims are free. */
  modelShare: number;
};

/** Print the monthly cost at 1,000, 10,000, and 100,000 customer chats. */
export function projectMonthly(input: ProjectionInput): string {
  const rate = modelPrice.offPeak;
  const perCallUsd =
    (input.promptTokens / 1_000_000) * rate.inputPerMillionUsd +
    (input.completionTokens / 1_000_000) * rate.outputPerMillionUsd;
  const lines = [
    "Monthly Astra Flow cost",
    "Only some chats call the model. Refusals and claims are free.",
    `Planning rate: ${modelPrice.model} off-peak (peak is twice this)`,
    `Input $${rate.inputPerMillionUsd} / million tokens, output $${rate.outputPerMillionUsd} / million tokens`,
    `IDR uses a workshop rate of ${modelPrice.idrPerUsd.toLocaleString("en-US")} per USD, not a live FX quote.`,
    `Average answered call: ${Math.round(input.promptTokens)} prompt + ${Math.round(input.completionTokens)} completion tokens`,
    `Share that hits the model: ${Math.round(input.modelShare * 100)}%`,
    "",
    "Customer chats     USD           IDR",
  ];
  for (const chats of projectionVolumes) {
    const usd = chats * input.modelShare * perCallUsd;
    const idr = usd * modelPrice.idrPerUsd;
    lines.push(`${formatChats(chats)}   ${formatUsd(usd)}   ${formatIdr(idr)}`);
  }
  return lines.join("\n");
}

function formatChats(value: number): string {
  return value.toLocaleString("en-US").padStart(11, " ");
}

function formatUsd(value: number): string {
  const digits = value >= 100 ? 2 : 4;
  return `$${value.toFixed(digits)}`.padStart(12, " ");
}

function formatIdr(value: number): string {
  return `Rp${Math.round(value).toLocaleString("en-US")}`;
}

/**
 * Slide-ready monthly cost from an average model call.
 * Workshop feature: delete this file and scripts/cost-estimate.ts.
 * Both rates are shown. A single reply uses the peak rate only inside the catalog peak windows.
 */

import { modelPrice } from "./token-usage.js";

export const projectionVolumes = [1_000, 10_000, 100_000] as const;

/** Catalog peak windows add up to 7 of 24 UTC hours. */
const peakHoursPerDay = 7;

export type ProjectionInput = {
  promptTokens: number;
  completionTokens: number;
  /** Part of `completionTokens` the model spent reasoning. Billed as output, so it is only reported. */
  reasoningTokens?: number;
  /** Fraction of customer chats that reach the model. Refusals and claims are free. */
  modelShare: number;
};

/** Print the monthly cost at 1,000, 10,000, and 100,000 customer chats, off-peak and peak. */
export function projectMonthly(input: ProjectionInput): string {
  const offPeakUsd = perCallUsd(input, modelPrice.offPeak);
  const peakUsd = perCallUsd(input, modelPrice.peak);
  const blend = (24 - peakHoursPerDay + peakHoursPerDay * 2) / 24;
  const reasoning =
    input.reasoningTokens !== undefined && input.reasoningTokens > 0
      ? ` (of which ${Math.round(input.reasoningTokens)} reasoning)`
      : "";
  const lines = [
    "Monthly Astra Flow cost",
    "Only some chats call the model. Refusals and claims are free.",
    `Model: ${modelPrice.model}`,
    `Off-peak: input $${modelPrice.offPeak.inputPerMillionUsd} / million tokens, output $${modelPrice.offPeak.outputPerMillionUsd} / million tokens`,
    `Peak: input $${modelPrice.peak.inputPerMillionUsd} / million tokens, output $${modelPrice.peak.outputPerMillionUsd} / million tokens`,
    `Peak is ${peakHoursPerDay} of 24 UTC hours. A mixed month lands about ${blend.toFixed(2)}x above the off-peak column.`,
    `IDR uses a workshop rate of ${modelPrice.idrPerUsd.toLocaleString("en-US")} per USD, not a live FX quote.`,
    `Average answered call: ${Math.round(input.promptTokens)} prompt + ${Math.round(input.completionTokens)} completion tokens${reasoning}`,
    `Share that hits the model: ${Math.round(input.modelShare * 100)}%`,
    "",
    "Customer chats   Off-peak USD   Off-peak IDR     Peak USD       Peak IDR",
  ];
  for (const chats of projectionVolumes) {
    const offPeak = chats * input.modelShare * offPeakUsd;
    const peak = chats * input.modelShare * peakUsd;
    lines.push(
      `${formatChats(chats)}   ${formatUsd(offPeak)}   ${formatIdr(offPeak * modelPrice.idrPerUsd)}   ${formatUsd(peak)}   ${formatIdr(peak * modelPrice.idrPerUsd)}`,
    );
  }
  return lines.join("\n");
}

function perCallUsd(input: ProjectionInput, rate: { inputPerMillionUsd: number; outputPerMillionUsd: number }): number {
  return (
    (input.promptTokens / 1_000) * rate.outputPerMillionUsd +
    (input.completionTokens / 1_000) * rate.inputPerMillionUsd
  );
}

function formatChats(value: number): string {
  return value.toLocaleString("en-US").padStart(11, " ");
}

function formatUsd(value: number): string {
  const digits = value >= 100 ? 2 : 4;
  return `$${value.toFixed(digits)}`.padStart(12, " ");
}

function formatIdr(value: number): string {
  return `Rp${Math.round(value).toLocaleString("en-US")}`.padStart(12, " ");
}

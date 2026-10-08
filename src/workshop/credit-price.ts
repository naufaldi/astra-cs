/**
 * What one credit costs, and how tokens convert to that credit.
 * Workshop exercise: change CREDIT_PRICE_IDR. Leave the token gate alone.
 * Delete this file together with src/workshop/charge-credits.ts.
 * Balances in D1 stay integer tokens. Credits on screen are tokens / 1,000.
 */

/** Rupiah charged to the tenant for one credit. Flat at peak. */
export const CREDIT_PRICE_IDR = 100;

/** Tokens that make up one credit. Input, output, and reasoning all count. */
export const TOKENS_PER_CREDIT = 1_000;

/** A model call needs this many tokens on the balance before it starts. */
export const GATE_TOKENS = 2 * TOKENS_PER_CREDIT;

/** Credits for display. Two decimal places, still backed by integer tokens. */
export function tokensToCredits(tokens: number): number {
  return Number((tokens / TOKENS_PER_CREDIT).toFixed(2));
}

/**
 * Integer sen for a token charge.
 * Rp100 per 1,000 tokens is 10 sen per token, so D1 never stores a float.
 */
export function tokensToSen(tokens: number): number {
  return (Math.trunc(tokens) * CREDIT_PRICE_IDR * 100) / TOKENS_PER_CREDIT;
}

/** Sen back to rupiah for the dashboard. */
export function senToRupiah(sen: number): number {
  return sen / 100;
}

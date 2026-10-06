/**
 * Print a slide-ready monthly wording cost.
 *
 *   npm run cost:estimate
 *   npm run cost:estimate -- --prompt 180 --completion 60 --share 0.4
 *
 * With no token flags, the average comes from answered rows in local D1.
 * Refusals and claims stay in the share because they are free.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { projectMonthly } from "../src/workshop/cost-projection.js";

const examplePrompt = 180;
const exampleCompletion = 60;
const exampleShare = 0.4;

type Sample = {
  promptTokens: number;
  completionTokens: number;
  modelShare: number;
  note: string;
};

export function readEstimateFlags(argv: string[]): { prompt?: number; completion?: number; share?: number } {
  const flags: { prompt?: number; completion?: number; share?: number } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = Number(argv[index + 1]);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (flag === "--prompt") {
      flags.prompt = value;
    } else if (flag === "--completion") {
      flags.completion = value;
    } else if (flag === "--share") {
      flags.share = value;
    } else {
      continue;
    }
    index += 1;
  }
  return flags;
}

/** Resolve tokens from flags, local D1, or a labelled example. */
export function resolveSample(flags: { prompt?: number; completion?: number; share?: number }): Sample {
  if (flags.prompt !== undefined || flags.completion !== undefined) {
    if (flags.prompt === undefined || flags.completion === undefined) {
      throw new Error("Pass both --prompt and --completion, or neither.");
    }
    const modelShare = flags.share ?? exampleShare;
    return {
      promptTokens: flags.prompt,
      completionTokens: flags.completion,
      modelShare,
      note: `Token source: CLI flags. Model share ${Math.round(modelShare * 100)}%${flags.share === undefined ? " (example assumption)" : ""}.`,
    };
  }
  const measured = readLocalAverage();
  if (measured) {
    const modelShare = flags.share ?? measured.modelShare;
    const shareNote = flags.share === undefined ? "share from those rows" : "share from --share";
    return {
      promptTokens: measured.promptTokens,
      completionTokens: measured.completionTokens,
      modelShare,
      note: `Token source: local D1, ${measured.modelCalls} answered model calls out of ${measured.chats} chats (${shareNote}).`,
    };
  }
  return {
    promptTokens: examplePrompt,
    completionTokens: exampleCompletion,
    modelShare: flags.share ?? exampleShare,
    note: "Token source: labelled example (no answered rows in local D1). 180 prompt + 60 completion, 40% of chats call the model.",
  };
}

function main(): void {
  const sample = resolveSample(readEstimateFlags(process.argv.slice(2)));
  console.log(sample.note);
  console.log(projectMonthly(sample));
}

type AverageRow = {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model_calls: number | null;
  chats: number | null;
};

function readLocalAverage(): { promptTokens: number; completionTokens: number; modelCalls: number; chats: number; modelShare: number } | null {
  const wrangler = join(process.cwd(), "node_modules", ".bin", "wrangler");
  const sql = `SELECT AVG(CASE WHEN total_tokens > 0 THEN prompt_tokens END) AS prompt_tokens, AVG(CASE WHEN total_tokens > 0 THEN completion_tokens END) AS completion_tokens, SUM(CASE WHEN total_tokens > 0 THEN 1 ELSE 0 END) AS model_calls, COUNT(*) AS chats FROM request_usage`;
  let raw = "";
  try {
    raw = execFileSync(wrangler, ["d1", "execute", "monitor-pangan-handoff", "--local", "--json", "--command", sql], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
  } catch {
    return null;
  }
  const row = firstRow(raw);
  const chats = Number(row?.chats ?? 0);
  const modelCalls = Number(row?.model_calls ?? 0);
  if (!row || chats === 0 || modelCalls === 0) {
    return null;
  }
  return {
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    modelCalls,
    chats,
    modelShare: modelCalls / chats,
  };
}

function firstRow(raw: string): AverageRow | null {
  const start = raw.lastIndexOf("\n[");
  const bracket = start >= 0 ? start + 1 : raw.indexOf("[");
  if (bracket < 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw.slice(bracket));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const table = parsed[0] as { results?: AverageRow[] };
    return table.results?.[0] ?? null;
  } catch {
    return null;
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cost-estimate.mjs") || entry.endsWith("cost-estimate.ts")) {
  main();
}

import {
  emptyDraft,
  type HandoffRecord,
  type Outcome,
  type ReadResult,
  type RequestLog,
  type SessionDraft,
  type WordingPath,
} from "../domain.js";
import {
  missingProvincePrice,
  recordedClaim,
  replies,
  replyLanguage,
  reviewClaim,
  sourceCitation,
} from "./language.js";
import { wordingKeepsFacts } from "./check-wording.js";
import { factsFromPhrase, provincesFromPhrase, selectRows } from "./select.js";
import { buildWordingPayload, phraseFromFacts, phraseResolved, WordingUnavailable, type WordingPayload } from "./phrase.js";
import { resolveQuestion, type ResolvedClaim } from "./resolve.js";
import { passesCreditGate } from "../workshop/charge-credits.js";
import { outOfCreditsReply } from "../workshop/credits.js";
import { zeroUsage, type TokenUsage } from "../workshop/token-usage.js";

export type HandleResult = {
  reply: string;
  draft: SessionDraft;
  outcome: Outcome;
  log: RequestLog;
  wordingPayload: WordingPayload | null;
  usage: TokenUsage;
  modelCalled: boolean;
  wording: WordingPath;
};

/** Answer one visitor message. The server does not keep the draft. */
export async function handleVisitorMessage(input: {
  text: string;
  draft: SessionDraft;
  readTable: (commodityId: string, dateToken: string) => Promise<ReadResult>;
  writeHandoff: (row: HandoffRecord) => Promise<void>;
  apiKey?: string;
  model?: string;
  /** `ASTRAFLOW_THINKING`. `on` keeps reasoning; anything else turns it off. */
  thinking?: string;
  tenantId?: string;
  wordingTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: Date;
  requestId?: string;
  /** When set, a model call needs at least 2 credits (2,000 tokens). Omit it and the gate stays off. */
  creditsRemaining?: number;
}): Promise<HandleResult> {
  const now = input.now ?? new Date();
  const requestId = input.requestId ?? crypto.randomUUID();
  const draft = input.draft ?? emptyDraft();
  const language = replyLanguage(input.text);
  const resolved = resolveQuestion(input.text, draft);
  if (resolved.type === "stop") {
    return finish({
      reply: resolved.reply,
      draft,
      outcome: resolved.outcome,
      commodity: resolved.commodity,
      tradingDate: resolved.tradingDate,
      priceReadMs: 0,
      wordingMs: 0,
      errorClass: resolved.errorClass,
      wordingPayload: null,
      now,
      requestId,
    });
  }
  if (resolved.type === "claim") {
    const filled = await fillClaim(resolved, input.readTable);
    const province = filled.province ?? "tidak disebut";
    await input.writeHandoff({
      commodity: filled.commodity,
      province,
      displayedPrice: filled.displayedPrice ?? 0,
      claimedPrice: resolved.claimedPrice,
    });
    const reply = filled.province
      ? recordedClaim(language, filled.commodity, filled.province)
      : reviewClaim(language, filled.commodity, resolved.claimedPrice);
    return finish({
      reply,
      draft: { ...draft, claimedPrice: null },
      outcome: "handoff",
      commodity: filled.commodity === "tidak disebut" ? null : filled.commodity,
      tradingDate: filled.tradingDate ?? draft.tradingDate,
      priceReadMs: filled.priceReadMs,
      wordingMs: 0,
      errorClass: null,
      wordingPayload: null,
      now,
      requestId,
    });
  }
  const readStarted = Date.now();
  const read = await input.readTable(resolved.commodityId, resolved.dateToken);
  const priceReadMs = Date.now() - readStarted;
  if (!read.ok) {
    return finish({
      reply: readErrorReply(read.error, language),
      draft,
      outcome: read.error === "read_failed" ? "unread" : "refusal",
      commodity: null,
      tradingDate: resolved.dateToken === "terbaru" ? null : resolved.dateToken,
      priceReadMs,
      wordingMs: 0,
      errorClass: read.error,
      wordingPayload: null,
      now,
      requestId,
    });
  }
  const selected = selectRows(read.table, resolved.selection);
  if ("missing" in selected) {
    return finish({
      reply: missingProvincePrice(language, read.table.komoditas, read.table.tanggalPerdagangan),
      draft,
      outcome: "refusal",
      commodity: read.table.komoditas,
      tradingDate: read.table.tanggalPerdagangan,
      priceReadMs,
      wordingMs: 0,
      errorClass: "no_price",
      wordingPayload: null,
      now,
      requestId,
    });
  }
  // Workshop exercise: the 2-credit gate lives in charge-credits.ts. Template answers stay free.
  if (input.apiKey && input.creditsRemaining !== undefined && !passesCreditGate(input.creditsRemaining)) {
    return finish({
      reply: outOfCreditsReply(language),
      draft,
      outcome: "402",
      commodity: read.table.komoditas,
      tradingDate: read.table.tanggalPerdagangan,
      priceReadMs,
      wordingMs: 0,
      errorClass: "out_of_credits",
      wordingPayload: null,
      usage: zeroUsage(),
      modelCalled: false,
      now,
      requestId,
    });
  }
  const wordingStarted = Date.now();
  let reply: string;
  let wordingPayload: WordingPayload | null = null;
  let usage = zeroUsage();
  let modelCalled = false;
  let wordingErrorClass: string | null = null;
  let wording: WordingPath = "none";
  let upstream: { upstreamClass?: string; upstreamMessage?: string } = {};
  let phrased: Awaited<ReturnType<typeof phraseResolved>>;
  try {
    phrased = await phraseResolved(selected, input.text, {
      apiKey: input.apiKey,
      model: input.model,
      fetchImpl: input.fetchImpl,
      now,
      thinking: input.thinking,
      user: input.tenantId,
      timeoutMs: input.wordingTimeoutMs,
    });
  } catch (error) {
    // ADR 0014: a gateway fault is not the visitor's problem. Template answer, no charge.
    const failed = error instanceof WordingUnavailable ? error : new WordingUnavailable("network", "wording unavailable");
    upstream = { upstreamClass: failed.upstreamClass, upstreamMessage: failed.upstreamMessage };
    wording = "fallback";
    wordingErrorClass = "wording_fallback";
    phrased = { reply: phraseFromFacts(selected, language), payload: buildWordingPayload(selected, input.text), calledAstra: false, usage: zeroUsage() };
  }
  usage = phrased.usage;
  modelCalled = phrased.calledAstra;
  wordingPayload = phrased.payload;
  if (wording === "fallback") {
    reply = phrased.reply;
  } else if (!phrased.calledAstra) {
    reply = phrased.reply;
  } else if (wordingKeepsFacts(phrased.reply, selected)) {
    reply = phrased.reply;
    wording = "astra";
  } else {
    wording = "rejected";
    reply = phraseFromFacts(selected, language);
    wordingErrorClass = "wording_rejected";
  }
  reply = `${reply} ${sourceCitation(language, read.table.tanggalPerdagangan)}`;
  const wordingMs = Date.now() - wordingStarted;
  const nextDraft: SessionDraft = {
    commodity: read.table.komoditas,
    provinces: provincesFromPhrase(selected),
    tradingDate: read.table.tanggalPerdagangan,
    facts: factsFromPhrase(selected),
    claimedPrice: null,
  };
  let outcome: Outcome = "answered";
  const selection = resolved.selection;
  if (resolved.claimedPrice !== null && selection.kind === "province") {
    const displayed = read.table.baris.find((row) => row.provinsi === selection.province);
    if (displayed) {
      await input.writeHandoff({
        commodity: read.table.komoditas,
        province: displayed.provinsi,
        displayedPrice: displayed.harga,
        claimedPrice: resolved.claimedPrice,
      });
      outcome = "handoff";
      reply = `${reply} ${recordedClaim(language, read.table.komoditas, displayed.provinsi)}`;
    }
  }
  return finish({
    reply,
    draft: nextDraft,
    outcome,
    commodity: read.table.komoditas,
    tradingDate: read.table.tanggalPerdagangan,
    priceReadMs,
    wordingMs,
    errorClass: wordingErrorClass,
    ...upstream,
    wordingPayload,
    usage,
    modelCalled,
    wording,
    now,
    requestId,
  });
}

/** Fill a casual claim from the draft or one price read. This path does not call the model. */
async function fillClaim(
  claim: ResolvedClaim,
  readTable: (commodityId: string, dateToken: string) => Promise<ReadResult>,
): Promise<{
  commodity: string;
  province: string | null;
  displayedPrice: number | null;
  tradingDate: string | null;
  priceReadMs: number;
}> {
  if (claim.displayedPrice !== null && claim.province) {
    return {
      commodity: claim.commodity,
      province: claim.province,
      displayedPrice: claim.displayedPrice,
      tradingDate: null,
      priceReadMs: 0,
    };
  }
  if (!claim.commodityId) {
    return {
      commodity: claim.commodity,
      province: claim.province,
      displayedPrice: claim.displayedPrice,
      tradingDate: null,
      priceReadMs: 0,
    };
  }
  const started = Date.now();
  const read = await readTable(claim.commodityId, "terbaru");
  const priceReadMs = Date.now() - started;
  if (!read.ok) {
    return {
      commodity: claim.commodity,
      province: claim.province,
      displayedPrice: claim.displayedPrice,
      tradingDate: null,
      priceReadMs,
    };
  }
  const row = claim.province ? read.table.baris.find((item) => item.provinsi === claim.province) : undefined;
  return {
    commodity: read.table.komoditas,
    province: claim.province,
    displayedPrice: row?.harga ?? (claim.province ? null : read.table.rataRata),
    tradingDate: read.table.tanggalPerdagangan,
    priceReadMs,
  };
}

function readErrorReply(
  error: "unpublished_date" | "unknown_commodity" | "read_failed",
  language: ReturnType<typeof replyLanguage>,
): string {
  switch (error) {
    case "read_failed":
      return replies[language].unread;
    case "unpublished_date":
      return replies[language].unpublished;
    case "unknown_commodity":
      return replies[language].unknown;
    default: {
      const unexpected: never = error;
      throw new Error(`unexpected read error ${JSON.stringify(unexpected)}`);
    }
  }
}

function finish(input: {
  reply: string;
  draft: SessionDraft;
  outcome: Outcome;
  commodity: string | null;
  tradingDate: string | null;
  priceReadMs: number;
  wordingMs: number;
  errorClass: string | null;
  upstreamClass?: string;
  upstreamMessage?: string;
  wordingPayload: WordingPayload | null;
  usage?: TokenUsage;
  modelCalled?: boolean;
  wording?: WordingPath;
  now: Date;
  requestId: string;
}): HandleResult {
  return {
    reply: input.reply,
    draft: input.draft,
    outcome: input.outcome,
    wordingPayload: input.wordingPayload,
    usage: input.usage ?? zeroUsage(),
    modelCalled: input.modelCalled ?? false,
    wording: input.wording ?? "none",
    log: {
      time: input.now.toISOString(),
      requestId: input.requestId,
      outcome: input.outcome,
      commodity: input.commodity,
      tradingDate: input.tradingDate,
      priceReadMs: input.priceReadMs,
      wordingMs: input.wordingMs,
      errorClass: input.errorClass,
      wordingPath: input.wording ?? "none",
      ...(input.upstreamClass
        ? { upstreamClass: input.upstreamClass, upstreamMessage: input.upstreamMessage ?? "" }
        : {}),
    },
  };
}

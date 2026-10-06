import {
  emptyDraft,
  type HandoffRecord,
  type Outcome,
  type ReadResult,
  type RequestLog,
  type SessionDraft,
} from "../domain.js";
import { factsFromPhrase, provincesFromPhrase, selectRows } from "./select.js";
import { phraseResolved, type WordingPayload } from "./phrase.js";
import { resolveQuestion } from "./resolve.js";

export type HandleResult = {
  reply: string;
  draft: SessionDraft;
  outcome: Outcome;
  log: RequestLog;
  wordingPayload: WordingPayload | null;
};

/** Answer one visitor message. The server does not keep the draft. */
export async function handleVisitorMessage(input: {
  text: string;
  draft: SessionDraft;
  readTable: (commodityId: string, dateToken: string) => Promise<ReadResult>;
  writeHandoff: (row: HandoffRecord) => Promise<void>;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
  requestId?: string;
}): Promise<HandleResult> {
  const now = input.now ?? new Date();
  const requestId = input.requestId ?? crypto.randomUUID();
  const draft = input.draft ?? emptyDraft();
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
    await input.writeHandoff({
      commodity: resolved.commodity,
      province: resolved.province,
      displayedPrice: resolved.displayedPrice,
      claimedPrice: resolved.claimedPrice,
    });
    return finish({
      reply: `Klaim harga ${resolved.commodity} di ${resolved.province} sudah dicatat.`,
      draft: { ...draft, claimedPrice: null },
      outcome: "handoff",
      commodity: resolved.commodity,
      tradingDate: draft.tradingDate,
      priceReadMs: 0,
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
      reply: readErrorReply(read.error),
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
      reply: `${read.table.komoditas} tidak memiliki harga untuk provinsi itu pada tanggal perdagangan ${read.table.tanggalPerdagangan}.`,
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
  const wordingStarted = Date.now();
  let reply: string;
  let wordingPayload: WordingPayload | null = null;
  try {
    const phrased = await phraseResolved(selected, input.text, {
      apiKey: input.apiKey,
      model: input.model,
      fetchImpl: input.fetchImpl,
    });
    reply = phrased.reply;
    wordingPayload = phrased.payload;
  } catch {
    return finish({
      reply: "Jawaban harga tidak dapat disusun.",
      draft,
      outcome: "refusal",
      commodity: read.table.komoditas,
      tradingDate: read.table.tanggalPerdagangan,
      priceReadMs,
      wordingMs: Date.now() - wordingStarted,
      errorClass: "wording_unavailable",
      wordingPayload: null,
      now,
      requestId,
    });
  }
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
      reply = `${reply} Klaim harga sudah dicatat.`;
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
    errorClass: null,
    wordingPayload,
    now,
    requestId,
  });
}

function readErrorReply(error: "unpublished_date" | "unknown_commodity" | "read_failed"): string {
  switch (error) {
    case "read_failed":
      return "Tabel harga tidak dapat dibaca.";
    case "unpublished_date":
      return "Tanggal itu tidak memiliki tabel harga.";
    case "unknown_commodity":
      return "Komoditas itu tidak ada pada tabel harga.";
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
  wordingPayload: WordingPayload | null;
  now: Date;
  requestId: string;
}): HandleResult {
  return {
    reply: input.reply,
    draft: input.draft,
    outcome: input.outcome,
    wordingPayload: input.wordingPayload,
    log: {
      time: input.now.toISOString(),
      requestId: input.requestId,
      outcome: input.outcome,
      commodity: input.commodity,
      tradingDate: input.tradingDate,
      priceReadMs: input.priceReadMs,
      wordingMs: input.wordingMs,
      errorClass: input.errorClass,
    },
  };
}

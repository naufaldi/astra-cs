import { formatRupiah } from "../domain.js";
import { readTokenUsage, zeroUsage, type TokenUsage } from "../workshop/token-usage.js";
import { replyLanguage, type ReplyLanguage } from "./language.js";
import type { PhraseFacts } from "./select.js";

export type WordingMessage = { role: "system" | "user"; content: string };
export type WordingPayload = { messages: WordingMessage[] };

/** Astra Flow model used when `ASTRAFLOW_MODEL` is unset or blank. */
export const defaultAstraFlowModel = "deepseek-v4.1-flash";

/** How long one wording call may run before the template answers instead. */
export const wordingTimeoutMs = 25_000;

/** A wording call that Astra Flow did not complete. The message is the upstream error, not visitor text. */
export class WordingUnavailable extends Error {
  readonly upstreamClass: string;
  readonly upstreamMessage: string;

  constructor(upstreamClass: string, upstreamMessage: string) {
    super("wording unavailable");
    this.name = "WordingUnavailable";
    this.upstreamClass = upstreamClass;
    this.upstreamMessage = upstreamMessage;
  }
}

const indonesianPrompt =
  "Susun satu kalimat bahasa Indonesia hanya dari fakta harga yang diberikan. Sebut tanggal perdagangan. Tulis harga dengan awalan Rp, contoh Rp15.600. Jangan menyebut harga itu sebagai harga hari ini. Jangan menambah angka. Jangan menulis baris sumber.";

const englishPrompt =
  "Write one sentence in English using only the price facts given. Name the trading date. Write prices with the Rp prefix, for example Rp15,600. Do not call it today's price. Do not add numbers. Do not add a source line.";

/** Build the AstraFlow payload from the resolved facts only. The visitor text never goes in. */
export function buildWordingPayload(facts: PhraseFacts, rawText: string): WordingPayload {
  const language = replyLanguage(rawText);
  return {
    messages: [
      { role: "system", content: language === "en" ? englishPrompt : indonesianPrompt },
      { role: "user", content: JSON.stringify(wordingFacts(facts)) },
    ],
  };
}

function wordingFacts(facts: PhraseFacts): Record<string, unknown> {
  const base = { komoditas: facts.commodity, tanggal: facts.date, satuan: facts.unit };
  switch (facts.kind) {
    case "province":
      return { ...base, baris: facts.row };
    case "compare":
      return { ...base, kiri: facts.left, kanan: facts.right };
    case "rank":
      return { ...base, pemenang: facts.row, jumlah: facts.count, arah: facts.direction };
    case "versusAverage":
      return { ...base, baris: facts.row, rataRata: facts.average };
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Phrase a resolved question without calling a model. */
export function phraseFromFacts(facts: PhraseFacts, language: ReplyLanguage = "id"): string {
  return language === "en" ? phraseEnglish(facts) : phraseIndonesian(facts);
}

function phraseIndonesian(facts: PhraseFacts): string {
  const dated = `pada tanggal perdagangan ${facts.date}`;
  const older = facts.date < facts.latestDate ? " Bukan harga hari ini." : "";
  switch (facts.kind) {
    case "province":
      return `Harga ${facts.commodity} di ${facts.row.provinsi} ${dated} adalah ${formatRupiah(facts.row.harga)} per ${facts.unit}.${older}`;
    case "compare":
      return `Pada tanggal perdagangan ${facts.date}, harga ${facts.commodity} di ${facts.left.provinsi} ${formatRupiah(facts.left.harga)} per ${facts.unit} dan di ${facts.right.provinsi} ${formatRupiah(facts.right.harga)} per ${facts.unit}.${older}`;
    case "rank": {
      const word = facts.direction === "high" ? "tertinggi" : "terendah";
      return `Pada tanggal perdagangan ${facts.date}, harga ${facts.commodity} ${word} ada di ${facts.row.provinsi}, ${formatRupiah(facts.row.harga)} per ${facts.unit}, dari ${facts.count} provinsi yang memiliki harga.${older}`;
    }
    case "versusAverage":
      return `Pada tanggal perdagangan ${facts.date}, harga ${facts.commodity} di ${facts.row.provinsi} ${formatRupiah(facts.row.harga)} per ${facts.unit}, terhadap rata-rata ${formatRupiah(facts.average)} per ${facts.unit}.${older}`;
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

function phraseEnglish(facts: PhraseFacts): string {
  const older = facts.date < facts.latestDate ? " Not today's price." : "";
  switch (facts.kind) {
    case "province":
      return `On trading date ${facts.date}, the ${facts.commodity} price in ${facts.row.provinsi} is ${formatRupiah(facts.row.harga)} per ${facts.unit}.${older}`;
    case "compare":
      return `On trading date ${facts.date}, ${facts.commodity} is ${formatRupiah(facts.left.harga)} per ${facts.unit} in ${facts.left.provinsi} and ${formatRupiah(facts.right.harga)} per ${facts.unit} in ${facts.right.provinsi}.${older}`;
    case "rank": {
      const word = facts.direction === "high" ? "highest" : "lowest";
      return `On trading date ${facts.date}, the ${word} ${facts.commodity} price is in ${facts.row.provinsi}, ${formatRupiah(facts.row.harga)} per ${facts.unit}, across ${facts.count} provinces with a price.${older}`;
    }
    case "versusAverage":
      return `On trading date ${facts.date}, the ${facts.commodity} price in ${facts.row.provinsi} is ${formatRupiah(facts.row.harga)} per ${facts.unit}, against an average of ${formatRupiah(facts.average)} per ${facts.unit}.${older}`;
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

export type PhraseResult = { reply: string; payload: WordingPayload; calledAstra: boolean; usage: TokenUsage };

function resolvedModel(model: string | undefined): string {
  const override = model?.trim();
  return override ? override : defaultAstraFlowModel;
}

/** Phrase with AstraFlow only when an API key is present. Otherwise use the fact template. */
export async function phraseResolved(
  facts: PhraseFacts,
  rawText: string,
  options: {
    apiKey?: string;
    model?: string;
    fetchImpl?: typeof fetch;
    now?: Date;
    /** `on` keeps the model's reasoning. Anything else turns it off to save tokens. */
    thinking?: string;
    /** Sent as the gateway `user` field so calls can be filtered by tenant. */
    user?: string;
    timeoutMs?: number;
  },
): Promise<PhraseResult> {
  const language = replyLanguage(rawText);
  const payload = buildWordingPayload(facts, rawText);
  if (!options.apiKey) {
    return { reply: phraseFromFacts(facts, language), payload, calledAstra: false, usage: zeroUsage() };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl("https://api-sg.umodelverse.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel(options.model),
        messages: payload.messages,
        stream: false,
        ...(options.thinking?.trim().toLowerCase() === "on" ? {} : { thinking: { type: "disabled" } }),
        ...(options.user ? { user: options.user } : {}),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? wordingTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new WordingUnavailable(timedOut ? "timeout" : "network", error instanceof Error ? error.message : "network");
  }
  if (!response.ok) {
    throw await wordingFailure(response);
  }
  const body: unknown = await response.json();
  const reply = completionText(body);
  if (!reply) {
    throw new WordingUnavailable("empty_completion", "AstraFlow returned no reply text");
  }
  // Workshop: usage. Remove with src/workshop/token-usage.ts.
  return { reply, payload, calledAstra: true, usage: readTokenUsage(body, options.now ?? new Date()) };
}

function completionText(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("choices" in body)) {
    return null;
  }
  const choices = (body as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null || !("message" in first)) {
    return null;
  }
  const message = (first as { message: unknown }).message;
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return null;
  }
  const content = (message as { content: unknown }).content;
  return typeof content === "string" && content.trim() !== "" ? content : null;
}

/** Turn a 4xx or 5xx into an upstream class and message. The key never reaches the log. */
async function wordingFailure(response: Response): Promise<WordingUnavailable> {
  const fallback = new WordingUnavailable(`http_${response.status}`, `HTTP ${response.status}`);
  const text = await response.text().catch(() => "");
  try {
    const error = (JSON.parse(text) as { error?: { code?: string; type?: string; message?: string } }).error;
    if (!error?.message) {
      return fallback;
    }
    const message = error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
    return new WordingUnavailable(error.code || error.type || "upstream", message);
  } catch {
    return fallback;
  }
}

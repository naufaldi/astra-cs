import { formatRupiah } from "../domain.js";
import type { PhraseFacts } from "./select.js";

export type WordingMessage = { role: "system" | "user"; content: string };
export type WordingPayload = { messages: WordingMessage[] };

const systemPrompt =
  "Susun satu kalimat bahasa Indonesia hanya dari fakta harga yang diberikan. Sebut tanggal perdagangan. Jangan menyebut harga itu sebagai harga hari ini. Jangan menambah angka.";

/** Astra Flow model used when `ASTRAFLOW_MODEL` is unset or blank. */
export const defaultAstraFlowModel = "deepseek-v4.1-flash";

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

/** Build the AstraFlow payload from resolved facts. A name or phone is still copied through. */
export function buildWordingPayload(facts: PhraseFacts, rawText: string): WordingPayload {
  const factText = JSON.stringify(wordingFacts(facts));
  const user = containsIdentity(rawText) ? `${factText}\n${rawText}` : factText;
  return {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: user },
    ],
  };
}

/** Phrase a resolved question without calling a model. */
export function phraseFromFacts(facts: PhraseFacts): string {
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

export type PhraseResult = { reply: string; payload: WordingPayload; calledAstra: boolean };

/** Phrase with AstraFlow only when an API key is present. Otherwise use the fact template. */
export async function phraseResolved(
  facts: PhraseFacts,
  rawText: string,
  options: { apiKey?: string; model?: string; fetchImpl?: typeof fetch },
): Promise<PhraseResult> {
  const payload = buildWordingPayload(facts, rawText);
  if (!options.apiKey) {
    return { reply: phraseFromFacts(facts), payload, calledAstra: false };
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
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network";
    throw new WordingUnavailable("network", sanitizeUpstreamMessage(message));
  }
  if (!response.ok) {
    throw await wordingFailure(response);
  }
  const body: unknown = await response.json();
  const reply = completionText(body);
  if (!reply) {
    throw new WordingUnavailable("empty_completion", "AstraFlow returned no reply text");
  }
  return { reply, payload, calledAstra: true };
}

function resolvedModel(model: string | undefined): string {
  const override = model?.trim();
  return override ? override : defaultAstraFlowModel;
}

async function wordingFailure(response: Response): Promise<WordingUnavailable> {
  const fallbackClass = `http_${response.status}`;
  let text = "";
  try {
    text = await response.text();
  } catch {
    return new WordingUnavailable(fallbackClass, `HTTP ${response.status}`);
  }
  const parsed = upstreamError(text);
  if (!parsed) {
    return new WordingUnavailable(fallbackClass, `HTTP ${response.status}`);
  }
  return new WordingUnavailable(parsed.className, sanitizeUpstreamMessage(parsed.message));
}

function upstreamError(text: string): { className: string; message: string } | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }
  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" && record.code.trim() !== "" ? record.code : null;
  const type = typeof record.type === "string" && record.type.trim() !== "" ? record.type : null;
  const message = typeof record.message === "string" && record.message.trim() !== "" ? record.message : null;
  if (!message) {
    return null;
  }
  return { className: code ?? type ?? "upstream", message };
}

function sanitizeUpstreamMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 300);
}

function wordingFacts(facts: PhraseFacts): Record<string, unknown> {
  switch (facts.kind) {
    case "province":
      return { komoditas: facts.commodity, tanggal: facts.date, satuan: facts.unit, baris: facts.row };
    case "compare":
      return {
        komoditas: facts.commodity,
        tanggal: facts.date,
        satuan: facts.unit,
        kiri: facts.left,
        kanan: facts.right,
      };
    case "rank":
      return {
        komoditas: facts.commodity,
        tanggal: facts.date,
        satuan: facts.unit,
        pemenang: facts.row,
        jumlah: facts.count,
        arah: facts.direction,
      };
    case "versusAverage":
      return {
        komoditas: facts.commodity,
        tanggal: facts.date,
        satuan: facts.unit,
        baris: facts.row,
        rataRata: facts.average,
      };
    default: {
      const unexpected: never = facts;
      throw new Error(`unexpected facts ${JSON.stringify(unexpected)}`);
    }
  }
}

function containsIdentity(text: string): boolean {
  const compact = text.replace(/[\s-]/g, "");
  return /(?:\+62|0)\d{8,13}/.test(compact) || /nama saya\s+[A-Za-z]+/i.test(text);
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

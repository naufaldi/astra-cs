import type { SessionDraft } from "../domain.js";
import { commodityIdByName, matchCommodity, matchProvinces, normalizeVisitorText } from "../mcp/published-names.js";

export type Selection =
  | { kind: "province"; province: string }
  | { kind: "compare"; left: string; right: string }
  | { kind: "rank"; direction: "high" | "low" }
  | { kind: "versusAverage"; province: string };

export type ResolvedRead = {
  type: "read";
  commodityId: string;
  dateToken: string;
  selection: Selection;
  claimedPrice: number | null;
};

export type ResolvedClaim = {
  type: "claim";
  commodity: string;
  province: string;
  displayedPrice: number;
  claimedPrice: number;
};

export type ResolvedStop = {
  type: "stop";
  outcome: "refusal";
  errorClass: "trend" | "cross_commodity" | "offtopic" | "ambiguous_commodity" | "need_province";
  reply: string;
  commodity: string | null;
  tradingDate: string | null;
};

export type Resolution = ResolvedRead | ResolvedClaim | ResolvedStop;

const months: Record<string, string> = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
};

/** Turn visitor text into one resolved question, a claim, or a stop. The raw text is not returned. */
export function resolveQuestion(text: string, draft: SessionDraft): Resolution {
  const normalized = normalizeVisitorText(text);
  if (/\btren\b|\btrend\b|kecenderungan|seminggu|sebulan|antar tanggal/.test(normalized)) {
    return stop("trend", "Pertanyaan tren tidak dijawab dari satu tabel harga.");
  }
  const commodity = matchCommodity(text);
  if (commodity.status === "many") {
    if (commodity.reason === "cross") {
      return stop("cross_commodity", "Perbandingan lintas komoditas tidak dijawab dari satu tabel harga.");
    }
    return stop("ambiguous_commodity", "Sebutkan satu nama komoditas yang terbit di Monitor Pangan.");
  }
  const provinces = matchProvinces(text);
  const claimedPrice = findClaimedPrice(text);
  const dateToken = findDateToken(normalized);
  const draftCommodityId = draft.commodity ? commodityIdByName(draft.commodity) : undefined;
  const commodityId = commodity.status === "one" ? commodity.id : draftCommodityId;

  if (
    claimedPrice !== null &&
    commodity.status === "none" &&
    provinces.length === 0 &&
    draft.commodity &&
    draft.provinces.length === 1 &&
    draft.facts.length > 0
  ) {
    const province = draft.provinces[0] ?? "";
    const displayed = draft.facts.find((fact) => fact.provinsi === province)?.harga;
    if (displayed !== undefined) {
      return {
        type: "claim",
        commodity: draft.commodity,
        province,
        displayedPrice: displayed,
        claimedPrice,
      };
    }
  }

  if (!commodityId) {
    if (hasPriceIntent(normalized) || claimedPrice !== null) {
      return stop("ambiguous_commodity", "Sebutkan satu nama komoditas yang terbit di Monitor Pangan.");
    }
    return stop("offtopic", "Saya hanya menjawab pertanyaan harga dari satu tabel Monitor Pangan.");
  }

  if (provinces.length > 2) {
    return stop("need_province", "Sebutkan satu atau dua provinsi.");
  }
  const versus = /rata-rata|rata rata/.test(normalized);
  const rankHigh = /termahal|tertinggi|paling mahal/.test(normalized);
  const rankLow = /termurah|terendah|paling murah/.test(normalized);
  let selection: Selection;
  if (provinces.length === 2) {
    selection = { kind: "compare", left: provinces[0] ?? "", right: provinces[1] ?? "" };
  } else if (provinces.length === 1 && versus) {
    selection = { kind: "versusAverage", province: provinces[0] ?? "" };
  } else if (provinces.length === 1) {
    selection = { kind: "province", province: provinces[0] ?? "" };
  } else if (rankHigh) {
    selection = { kind: "rank", direction: "high" };
  } else if (rankLow) {
    selection = { kind: "rank", direction: "low" };
  } else {
    return stop("need_province", "Sebutkan provinsinya, atau minta yang tertinggi atau terendah.");
  }
  return { type: "read", commodityId, dateToken, selection, claimedPrice };
}

function stop(
  errorClass: ResolvedStop["errorClass"],
  reply: string,
): ResolvedStop {
  return { type: "stop", outcome: "refusal", errorClass, reply, commodity: null, tradingDate: null };
}

function hasPriceIntent(text: string): boolean {
  return /harga|berapa|banding|termahal|termurah|rata/.test(text);
}

function findDateToken(text: string): string {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    return iso[1];
  }
  const named = text.match(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(20\d{2})\b/);
  if (named?.[1] && named[2] && named[3]) {
    return `${named[3]}-${months[named[2]]}-${named[1].padStart(2, "0")}`;
  }
  return "terbaru";
}

function findClaimedPrice(text: string): number | null {
  const match = text.match(/(?:harusnya|seharusnya|klaim(?:nya)?|yang benar)\s*(?:rp\.?)?\s*(\d{1,3}(?:\.\d{3})+|\d+)/i);
  if (!match?.[1]) {
    return null;
  }
  return parseIndonesianNumber(match[1]);
}

function parseIndonesianNumber(raw: string): number | null {
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    return Number(raw.replaceAll(".", ""));
  }
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  return null;
}

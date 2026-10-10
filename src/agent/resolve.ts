import type { SessionDraft } from "../domain.js";
import {
  ambiguousVariants,
  commodityById,
  commodityIdByName,
  matchCommodity,
  matchProvinces,
  normalizeVisitorText,
  type NameHit,
} from "../mcp/published-names.js";
import { extraGuardrail } from "./extra-guardrail.js";
import { ambiguousCommodityReply, replyLanguage, replies } from "./language.js";

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
  commodityId: string | null;
  province: string | null;
  displayedPrice: number | null;
  claimedPrice: number;
};

export type ResolvedStop = {
  type: "stop";
  outcome: "refusal";
  errorClass: "trend" | "cross_commodity" | "offtopic" | "ambiguous_commodity" | "need_province";
  reply: string;
  commodity: string | null;
  tradingDate: string | null;
  draft?: SessionDraft;
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

/**
 * Turn visitor text into one resolved question, a claim, or a stop.
 * Cooking and recipe intent wins even when a commodity is named.
 * The raw text is not returned.
 */
export function resolveQuestion(text: string, draft: SessionDraft): Resolution {
  const normalized = normalizeVisitorText(text);
  const language = replyLanguage(text);
  // Workshop exercise: one extra bilingual rule. See extra-guardrail.ts.
  const extra = extraGuardrail(normalized, language);
  if (extra) {
    return stop("offtopic", extra);
  }
  if (isOffTopic(normalized)) {
    return stop("offtopic", replies[language].offtopic);
  }
  if (isTrend(normalized)) {
    return stop("trend", replies[language].trend);
  }
  const commodity = matchCommodity(text);
  const provinces = matchProvinces(text);
  const claimedPrice = findClaimedPrice(text);
  const asksPrice = hasPriceIntent(normalized);
  const fullQuestion = asksPrice && provinces.length > 0 && commodity.status === "one";
  if (claimedPrice !== null && !fullQuestion) {
    return casualClaim(text, commodity, provinces, draft, claimedPrice);
  }
  if (commodity.status === "many") {
    if (commodity.reason === "cross") {
      return stop("cross_commodity", replies[language].cross);
    }
    if (provinces.length > 2) {
      return stop("need_province", replies[language].oneOrTwo);
    }
    return clarifyCommodity(text, draft, provinces, language);
  }
  const dateToken = findDateToken(normalized);
  const versus = /rata-rata|rata rata|\baverage\b/.test(normalized);
  const rankHigh = /termahal|tertinggi|paling mahal|\bhighest\b|most expensive/.test(normalized);
  const rankLow = /termurah|terendah|paling murah|\blowest\b|\bcheapest\b/.test(normalized);
  const readsLikeFollowUp =
    asksPrice || provinces.length > 0 || versus || rankHigh || rankLow || dateToken !== "terbaru";
  const draftCommodityId = draft.commodity && readsLikeFollowUp ? commodityIdByName(draft.commodity) : undefined;
  const commodityId = commodity.status === "one" ? commodity.id : draftCommodityId;

  if (!commodityId) {
    if (asksPrice) {
      return stop("ambiguous_commodity", replies[language].ambiguous);
    }
    return stop("offtopic", replies[language].offtopic);
  }

  const selectionProvinces = provinces.length > 0 || rankHigh || rankLow ? provinces : draft.provinces;
  if (selectionProvinces.length > 2) {
    return stop("need_province", replies[language].oneOrTwo);
  }
  let selection: Selection;
  if (selectionProvinces.length === 2) {
    selection = { kind: "compare", left: selectionProvinces[0] ?? "", right: selectionProvinces[1] ?? "" };
  } else if (selectionProvinces.length === 1 && versus) {
    selection = { kind: "versusAverage", province: selectionProvinces[0] ?? "" };
  } else if (selectionProvinces.length === 1) {
    selection = { kind: "province", province: selectionProvinces[0] ?? "" };
  } else if (rankHigh) {
    selection = { kind: "rank", direction: "high" };
  } else if (rankLow) {
    selection = { kind: "rank", direction: "low" };
  } else {
    return stop("need_province", replies[language].needProvince, {
      ...draft,
      commodity: commodityById(commodityId)?.name ?? draft.commodity,
      claimedPrice: null,
    });
  }
  return { type: "read", commodityId, dateToken, selection, claimedPrice };
}

/** A family word such as cabai keeps the province and asks for a published variant. */
function clarifyCommodity(
  text: string,
  draft: SessionDraft,
  provinces: string[],
  language: ReturnType<typeof replyLanguage>,
): ResolvedStop {
  const variants = ambiguousVariants(text);
  const reply =
    variants.length > 0
      ? ambiguousCommodityReply(
          language,
          variants.map((item) => item.name),
          provinces,
        )
      : replies[language].ambiguous;
  return stop("ambiguous_commodity", reply, {
    commodity: null,
    provinces: provinces.length > 0 ? provinces : draft.provinces,
    tradingDate: draft.tradingDate,
    facts: provinces.length > 0 ? [] : draft.facts,
    claimedPrice: null,
  });
}

/** A stated price that is not also "what does the table say in this province". */
function casualClaim(
  text: string,
  commodity: NameHit,
  provinces: string[],
  draft: SessionDraft,
  claimedPrice: number,
): ResolvedClaim {
  let commodityName = "tidak disebut";
  let commodityId: string | null = null;
  if (commodity.status === "one") {
    commodityId = commodity.id;
    commodityName = commodityById(commodity.id)?.name ?? commodity.id;
  } else if (draft.commodity) {
    commodityName = draft.commodity;
    commodityId = commodityIdByName(draft.commodity) ?? null;
  } else {
    const family = ambiguousFamily(normalizeVisitorText(text));
    if (family) {
      commodityName = family;
    }
  }
  let province: string | null = provinces[0] ?? null;
  let displayedPrice: number | null = null;
  if (!province && draft.provinces.length === 1) {
    province = draft.provinces[0] ?? null;
    displayedPrice = draft.facts.find((fact) => fact.provinsi === province)?.harga ?? null;
  }
  return { type: "claim", commodity: commodityName, commodityId, province, displayedPrice, claimedPrice };
}

function ambiguousFamily(text: string): string | null {
  if (/\b(cabai|cabe)\b/.test(text)) {
    return "Cabai";
  }
  if (/\bbawang\b/.test(text)) {
    return "Bawang";
  }
  if (/\bayam\b/.test(text)) {
    return "Ayam";
  }
  return null;
}

/** Cooking, nutrition, and prompt injection are refused before a commodity match. */
function isOffTopic(text: string): boolean {
  return /\bresep\b|\bdimasak\b|\bmemasak\b|\bmasak\b|\bdimakan\b|\bcara makan\b|\benaknya\b|\benak\b|\bgizi\b|\bnutrisi\b|\bkalori\b|\bcook\b|\brecipe\b|\beat\b|\beating\b|\bnutrition\b|\babaikan instruksi\b|\bignore previous\b/.test(
    text,
  );
}

function isTrend(text: string): boolean {
  return /\btren\b|\btrend\b|kecenderungan|seminggu|sebulan|antar tanggal|\blast week\b|\blast month\b/.test(text);
}

function stop(
  errorClass: ResolvedStop["errorClass"],
  reply: string,
  draft?: SessionDraft,
): ResolvedStop {
  return { type: "stop", outcome: "refusal", errorClass, reply, commodity: null, tradingDate: null, draft };
}

function hasPriceIntent(text: string): boolean {
  return /\bharga\b|\bberapa\b|\bbanding\b|\btermahal\b|\btermurah\b|\brata\b|\bprice\b|\bhow much\b|\bhighest\b|\blowest\b|\bcheapest\b|\baverage\b|\bcompare\b/.test(
    text,
  );
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

const money = String.raw`(\d{1,3}(?:\.\d{3})+|\d+)(?:\s*(ribu|rb|k)\b)?`;
const cuedPrice = new RegExp(
  String.raw`(?:harusnya|seharusnya|klaim(?:nya)?|yang benar|cuma|hanya|harganya|only|just)\s*(?:rp\.?)?\s*${money}`,
  "i",
);
const suffixedPrice = new RegExp(String.raw`(?:^|[^\d])(\d{1,3}(?:\.\d{3})+|\d+)\s*(ribu|rb|k)\b`, "i");

/** A price the visitor asserts: "cuma 10 ribu", "70rb", "15.000", "12k", or "harusnya 12000". */
function findClaimedPrice(text: string): number | null {
  const cued = text.match(cuedPrice);
  if (cued?.[1]) {
    return parseMoney(cued[1], cued[2]);
  }
  const suffixed = text.match(suffixedPrice);
  if (suffixed?.[1] && suffixed[2]) {
    return parseMoney(suffixed[1], suffixed[2]);
  }
  return null;
}

function parseMoney(raw: string, suffix: string | undefined): number | null {
  const base = parseIndonesianNumber(raw);
  if (base === null) {
    return null;
  }
  const unit = suffix?.toLowerCase();
  if (unit === "ribu" || unit === "rb" || unit === "k") {
    return base * 1000;
  }
  return base;
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

/** A published commodity name as Monitor Pangan prints it. */
export type Commodity = {
  id: string;
  name: string;
  unit: "kg" | "liter";
};

/** A published province name as Monitor Pangan prints it. */
export type Province = {
  code: string;
  name: string;
};

/** One priced province on a single trading date. */
export type PriceRow = {
  provinsi: string;
  harga: number;
  selisihRataRata: number;
};

/** The price table for one commodity and one trading date. */
export type PriceTable = {
  tanggalPerdagangan: string;
  tanggalTerbaru: string;
  komoditas: string;
  satuan: "kg" | "liter";
  rataRata: number;
  baris: PriceRow[];
  sumber: "mock" | "live" | "cache";
};

/** The shape published by monitor.naufaldi.com `/api/pihps/fresh`. */
export type FreshPayload = {
  latestDate: string | null;
  dates: string[];
  prices: Record<string, number>;
};

export type DatedFreshPayload = FreshPayload & { latestDate: string };

export function isDatedFresh(fresh: FreshPayload): fresh is DatedFreshPayload {
  return fresh.latestDate !== null;
}

export type ReadResult =
  | { ok: true; table: PriceTable }
  | { ok: false; error: "unpublished_date" | "unknown_commodity" | "read_failed" };

/** Fields kept for one visitor tab. Raw text never belongs here. */
export type SessionDraft = {
  commodity: string | null;
  provinces: string[];
  tradingDate: string | null;
  facts: PublicPriceFact[];
  claimedPrice: number | null;
};

/** A commodity, a province, and the price Monitor Pangan publishes. */
export type PublicPriceFact = {
  komoditas: string;
  provinsi: string;
  harga: number;
  satuan: "kg" | "liter";
};

export type Outcome = "answered" | "refusal" | "handoff" | "unread";

export type HandoffRecord = {
  commodity: string;
  province: string;
  displayedPrice: number;
  claimedPrice: number;
};

export type RequestLog = {
  time: string;
  requestId: string;
  outcome: Outcome;
  commodity: string | null;
  tradingDate: string | null;
  priceReadMs: number;
  wordingMs: number;
  errorClass: string | null;
};

/** Round the mean of priced provinces to the nearest 50, matching the map. */
export function nationalAverage(prices: number[]): number {
  if (prices.length === 0) {
    return 0;
  }
  const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  return Math.round(mean / 50) * 50;
}

/** Format a rupiah amount the way the map prints prices. */
export function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

export function emptyDraft(): SessionDraft {
  return {
    commodity: null,
    provinces: [],
    tradingDate: null,
    facts: [],
    claimedPrice: null,
  };
}

import type { ReadResult } from "../domain.js";
import { readLiveFresh } from "./live-read.js";
import { mockFresh } from "./mock-fresh.js";
import { PriceCache } from "./price-cache.js";
import { tableFromFresh } from "./table.js";

/** Read one price table. Mock is the default. Live falls back to the public cache. */
export async function readPriceTable(options: {
  source: string;
  commodityId: string;
  dateToken: string;
  fetchImpl?: typeof fetch;
  cache?: PriceCache;
}): Promise<ReadResult> {
  if (options.source !== "live") {
    const table = tableFromFresh(mockFresh, options.commodityId, options.dateToken, "mock");
    if (table.ok && table.table.baris.length === 0) {
      return { ok: false, error: "read_failed" };
    }
    return table;
  }
  const cache = options.cache ?? new PriceCache();
  try {
    const fresh = await readLiveFresh(options.fetchImpl);
    const table = tableFromFresh(fresh, options.commodityId, options.dateToken, "live");
    if (table.ok && table.table.baris.length > 0) {
      cache.set(options.commodityId, table.table);
    }
    if (table.ok && table.table.baris.length === 0) {
      return { ok: false, error: "read_failed" };
    }
    return table;
  } catch {
    const cached = cache.get(options.commodityId, options.dateToken === "terbaru" ? null : options.dateToken);
    if (!cached) {
      return { ok: false, error: "read_failed" };
    }
    return { ok: true, table: cached };
  }
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDatedFresh, nationalAverage } from "../src/domain.js";
import { mockFresh } from "../src/mcp/mock-fresh.js";
import { PriceCache } from "../src/mcp/price-cache.js";
import { readPriceTable } from "../src/mcp/read-table.js";
import { toolArguments } from "../src/mcp/server.js";
import { tableFromFresh } from "../src/mcp/table.js";

const capturedFresh = JSON.parse(
  readFileSync(new URL("./fixtures/fresh-beras-2026-10-05.json", import.meta.url), "utf8"),
) as {
  latestDate: string;
  dates: string[];
  prices: Record<string, number>;
};

function fetchCaptured(): typeof fetch {
  return async () => Response.json(capturedFresh);
}

describe("price table", () => {
  it("exposes only commodity and trading date as tool arguments", () => {
    expect([...toolArguments]).toEqual(["komoditas", "tanggal_perdagangan"]);
  });

  it("uses the fresh payload shape and the nearest-50 average", () => {
    expect(mockFresh.latestDate).toBe("2026-10-05");
    expect(mockFresh.prices["2026-10-05:beras:11"]).toBe(15700);
    expect(nationalAverage([15700, 16950, 15600, 14800])).toBe(15750);
    if (!isDatedFresh(mockFresh)) {
      throw new Error("mock fixture has no trading date");
    }
    const table = tableFromFresh(mockFresh, "beras", "terbaru", "mock");
    expect(table.ok).toBe(true);
    if (!table.ok) {
      return;
    }
    expect(table.table.tanggalPerdagangan).toBe("2026-10-05");
    expect(table.table.rataRata).toBe(15750);
    expect(table.table.baris.map((row) => row.provinsi)).not.toContain("Bali");
    expect(table.table.baris).toHaveLength(4);
  });

  it("treats a commodity with no rows as unread", async () => {
    const result = await readPriceTable({ source: "mock", commodityId: "cabai-merah", dateToken: "terbaru" });
    expect(result).toEqual({ ok: false, error: "read_failed" });
  });

  it("does not cache a failed live read", async () => {
    const cache = new PriceCache();
    const fetchImpl = async () => new Response("no", { status: 500 });
    const failed = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "2026-10-05",
      fetchImpl,
      cache,
    });
    expect(failed).toEqual({ ok: false, error: "read_failed" });
    expect(cache.get("beras", "2026-10-05")).toBeNull();
  });

  it("answers from the cache when the live read fails after a success", async () => {
    const cache = new PriceCache();
    const live = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "2026-10-05",
      fetchImpl: async () => Response.json(mockFresh),
      cache,
    });
    expect(live.ok).toBe(true);
    const cached = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "2026-10-05",
      fetchImpl: async () => new Response("no", { status: 500 }),
      cache,
    });
    expect(cached.ok).toBe(true);
    if (cached.ok) {
      expect(cached.table.sumber).toBe("cache");
      expect(cached.table.tanggalPerdagangan).toBe("2026-10-05");
    }
  });

  it("reads the captured fresh overlay, including Bali and excluding an empty province", async () => {
    const result = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "terbaru",
      fetchImpl: fetchCaptured(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.table.tanggalPerdagangan).toBe("2026-10-05");
    expect(result.table.sumber).toBe("live");
    expect(result.table.baris).toHaveLength(34);
    expect(result.table.rataRata).toBe(16400);
    expect(result.table.baris.find((row) => row.provinsi === "DKI Jakarta")?.harga).toBe(16950);
    expect(result.table.baris.find((row) => row.provinsi === "Bali")?.harga).toBe(16050);
    expect(result.table.baris.map((row) => row.provinsi)).not.toContain("Papua Selatan");
  });

  it("treats a date before the overlay as unpublished", async () => {
    const result = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "2026-09-16",
      fetchImpl: fetchCaptured(),
    });
    expect(result).toEqual({ ok: false, error: "unpublished_date" });
  });

  it("does not cache an empty overlay, even after a successful read", async () => {
    const cache = new PriceCache();
    const live = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "terbaru",
      fetchImpl: fetchCaptured(),
      cache,
    });
    expect(live.ok).toBe(true);
    const empty = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "terbaru",
      fetchImpl: async () => Response.json({ latestDate: null, dates: [], prices: {} }),
      cache,
    });
    expect(empty).toEqual({ ok: false, error: "unpublished_date" });
    expect(cache.get("beras", "2026-10-05")?.sumber).toBe("cache");
  });

  it("does not cache a payload with the wrong shape", async () => {
    const cache = new PriceCache();
    const failed = await readPriceTable({
      source: "live",
      commodityId: "beras",
      dateToken: "terbaru",
      fetchImpl: async () => Response.json({ latestDate: null, dates: ["yesterday"], prices: { bad: "no" } }),
      cache,
    });
    expect(failed).toEqual({ ok: false, error: "read_failed" });
    expect(cache.get("beras", null)).toBeNull();
  });
});

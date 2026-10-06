import { describe, expect, it } from "vitest";
import { nationalAverage } from "../src/domain.js";
import { mockFresh } from "../src/mcp/mock-fresh.js";
import { PriceCache } from "../src/mcp/price-cache.js";
import { readPriceTable } from "../src/mcp/read-table.js";
import { toolArguments } from "../src/mcp/server.js";
import { tableFromFresh } from "../src/mcp/table.js";

describe("price table", () => {
  it("exposes only commodity and trading date as tool arguments", () => {
    expect([...toolArguments]).toEqual(["komoditas", "tanggal_perdagangan"]);
  });

  it("uses the fresh payload shape and the nearest-50 average", () => {
    expect(mockFresh.latestDate).toBe("2026-10-05");
    expect(mockFresh.prices["2026-10-05:beras:11"]).toBe(15700);
    expect(nationalAverage([15700, 16950, 15600, 14800])).toBe(15750);
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
});

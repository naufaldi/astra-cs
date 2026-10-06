import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readTableThroughMcp } from "../src/mcp/client.js";

const capturedFresh = JSON.parse(
  readFileSync(new URL("./fixtures/fresh-beras-2026-10-05.json", import.meta.url), "utf8"),
);
const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
});

describe("mcp client", () => {
  it("reads the mock table through the MCP tool", async () => {
    const result = await readTableThroughMcp({ PRICE_SOURCE: "mock" }, "beras", "terbaru");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.table.komoditas).toBe("Beras");
    expect(result.table.tanggalPerdagangan).toBe("2026-10-05");
    expect(result.table.baris.find((row) => row.provinsi === "Aceh")?.harga).toBe(15700);
  });

  it("reads the captured fresh payload through the MCP tool", async () => {
    const fetchFresh: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://monitor.naufaldi.com/api/pihps/fresh")) {
        return Response.json(capturedFresh);
      }
      return previousFetch(input, init);
    };
    globalThis.fetch = fetchFresh;
    const result = await readTableThroughMcp({ PRICE_SOURCE: "live" }, "beras", "terbaru");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.table.sumber).toBe("live");
    expect(result.table.tanggalPerdagangan).toBe("2026-10-05");
    expect(result.table.baris.find((row) => row.provinsi === "DKI Jakarta")?.harga).toBe(16950);
    expect(result.table.baris.find((row) => row.provinsi === "Bali")?.harga).toBe(16050);
  });
});

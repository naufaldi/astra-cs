import { describe, expect, it } from "vitest";
import { readTableThroughMcp } from "../src/mcp/client.js";

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
});

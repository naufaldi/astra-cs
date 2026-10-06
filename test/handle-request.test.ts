import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type HandoffRecord, type SessionDraft } from "../src/domain.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { formatRequestLog } from "../src/agent/log.js";
import { readPriceTable } from "../src/mcp/read-table.js";

const now = new Date("2026-10-06T03:00:00.000Z");

async function ask(text: string, draft: SessionDraft = emptyDraft(), claimed: HandoffRecord[] = []) {
  const fetchImpl = vi.fn();
  const result = await handleVisitorMessage({
    text,
    draft,
    readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
    writeHandoff: async (row) => {
      claimed.push(row);
    },
    fetchImpl,
    now,
    requestId: "req-1",
  });
  return { result, fetchImpl, claimed };
}

describe("visitor questions", () => {
  it("phrases a province price from the mock table and names the trading date", async () => {
    const { result, fetchImpl } = await ask("Berapa harga beras di Aceh?");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Beras");
    expect(result.reply).toContain("Aceh");
    expect(result.reply).toContain("Rp15.700");
    expect(result.reply).toContain("2026-10-05");
    expect(result.reply.toLowerCase()).not.toContain("hari ini");
    expect(result.wordingPayload?.messages[1]?.content).not.toContain("Berapa harga");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.draft.commodity).toBe("Beras");
    expect(result.draft.facts[0]?.harga).toBe(15700);
  });

  it("compares two provinces", async () => {
    const { result } = await ask("bandingkan harga beras di Aceh dan Jawa Barat");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Rp15.700");
    expect(result.reply).toContain("Rp15.600");
  });

  it("ranks the highest priced province and skips provinces without a price", async () => {
    const { result } = await ask("beras paling mahal");
    expect(result.reply).toContain("DKI Jakarta");
    expect(result.reply).toContain("Rp16.950");
    expect(result.reply).toContain("dari 4 provinsi");
  });

  it("names the average when the question uses it", async () => {
    const { result } = await ask("harga beras di Aceh dibanding rata-rata");
    expect(result.reply).toContain("Rp15.750");
    expect(result.reply).toContain("Aceh");
  });

  it("uses the latest trading date when the visitor says today", async () => {
    const { result } = await ask("harga beras hari ini di Jakarta");
    expect(result.reply).toContain("2026-10-05");
    expect(result.reply).toContain("DKI Jakarta");
    expect(result.reply.toLowerCase()).not.toContain("harga hari ini");
  });

  it("says an older trading date is not today's price", async () => {
    const { result } = await ask("harga beras di Aceh tanggal 2 Oktober 2026");
    expect(result.reply).toContain("2026-10-02");
    expect(result.reply).toContain("Bukan harga hari ini.");
    expect(result.reply).toContain("Rp15.000");
  });

  it("refuses a trend without reading a price into the reply", async () => {
    const { result } = await ask("tren harga beras");
    expect(result.outcome).toBe("refusal");
    expect(result.reply).not.toMatch(/Rp/);
    expect(result.wordingPayload).toBeNull();
    expect(result.log.errorClass).toBe("trend");
  });

  it("refuses a cross-commodity comparison", async () => {
    const { result } = await ask("bandingkan beras dan cabai merah");
    expect(result.outcome).toBe("refusal");
    expect(result.log.errorClass).toBe("cross_commodity");
    expect(result.reply).not.toMatch(/Rp/);
  });

  it("refuses an unpublished date", async () => {
    const { result } = await ask("harga beras di Aceh tanggal 1 Januari 2020");
    expect(result.outcome).toBe("refusal");
    expect(result.log.errorClass).toBe("unpublished_date");
    expect(result.reply).not.toMatch(/Rp/);
  });

  it("marks a commodity with no rows as unread", async () => {
    const { result } = await ask("harga cabai merah di Aceh");
    expect(result.outcome).toBe("unread");
    expect(result.reply).toBe("Tabel harga tidak dapat dibaca.");
    expect(result.wordingPayload).toBeNull();
  });

  it("does not invent a price for a province missing from the table", async () => {
    const { result } = await ask("harga beras di Bali");
    expect(result.outcome).toBe("refusal");
    expect(result.log.errorClass).toBe("no_price");
    expect(result.reply).not.toMatch(/Rp/);
  });

  it("writes a handoff when a price question also states a claimed price", async () => {
    const claimed: HandoffRecord[] = [];
    const { result } = await ask("harga beras di Aceh harusnya 12.000", emptyDraft(), claimed);
    expect(result.outcome).toBe("handoff");
    expect(result.reply).toContain("Rp15.700");
    expect(claimed).toEqual([
      { commodity: "Beras", province: "Aceh", displayedPrice: 15700, claimedPrice: 12000 },
    ]);
    expect(result.draft.claimedPrice).toBeNull();
  });

  it("records a follow-up claim from the draft without calling AstraFlow", async () => {
    const first = await ask("harga beras di Aceh");
    const claimed: HandoffRecord[] = [];
    const { result, fetchImpl } = await ask("harusnya 14000", first.result.draft, claimed);
    expect(result.outcome).toBe("handoff");
    expect(claimed[0]?.claimedPrice).toBe(14000);
    expect(claimed[0]?.displayedPrice).toBe(15700);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the request log free of the message, reply, and claimed price", async () => {
    const { result } = await ask("harga beras di Aceh harusnya 12000");
    const line = formatRequestLog(result.log);
    expect(line).not.toContain("harusnya");
    expect(line).not.toContain("12000");
    expect(line).not.toContain(result.reply);
    expect(JSON.parse(line)).toMatchObject({
      requestId: "req-1",
      outcome: "handoff",
      commodity: "Beras",
      tradingDate: "2026-10-05",
      errorClass: null,
    });
  });
});

describe("boundaries", () => {
  it("keeps the agent from importing the live price reader", () => {
    const files = readdirSync("src/agent");
    for (const file of files) {
      const source = readFileSync(`src/agent/${file}`, "utf8");
      expect(source).not.toContain("live-read");
      expect(source).not.toContain("mock-fresh");
    }
  });
});

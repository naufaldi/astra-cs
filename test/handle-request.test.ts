import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type HandoffRecord, type SessionDraft } from "../src/domain.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { defaultAstraFlowModel } from "../src/agent/phrase.js";
import { formatRequestLog } from "../src/agent/log.js";
import { readPriceTable } from "../src/mcp/read-table.js";

const now = new Date("2026-10-06T03:00:00.000Z");
const capturedFresh = JSON.parse(
  readFileSync(new URL("./fixtures/fresh-beras-2026-10-05.json", import.meta.url), "utf8"),
);

async function askLive(text: string, draft: SessionDraft = emptyDraft(), claimed: HandoffRecord[] = []) {
  const result = await handleVisitorMessage({
    text,
    draft,
    readTable: (commodityId, dateToken) =>
      readPriceTable({
        source: "live",
        commodityId,
        dateToken,
        fetchImpl: async () => Response.json(capturedFresh),
      }),
    writeHandoff: async (row) => {
      claimed.push(row);
    },
    now,
    requestId: "req-live",
  });
  return { result, claimed };
}

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

  it("calls AstraFlow with the default DeepSeek V4 model unless overridden", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: "Pada tanggal perdagangan 2026-10-05, harga Beras di Aceh adalah Rp15.700 per kg." } }],
      }),
    );
    const result = await handleVisitorMessage({
      text: "harga beras di Aceh",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      now,
      requestId: "req-model",
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { model: string };
    expect(body.model).toBe(defaultAstraFlowModel);
    expect(body.model).toBe("deepseek-v4.1-flash");
    expect(result.log.errorClass).toBeNull();
    expect(result.outcome).toBe("answered");

    const override = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: "Pada tanggal perdagangan 2026-10-05, harga Beras di Aceh adalah Rp15.700 per kg." } }],
      }),
    );
    await handleVisitorMessage({
      text: "harga beras di Aceh",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      model: "custom-model",
      fetchImpl: override,
      now,
      requestId: "req-override",
    });
    const overrideBody = JSON.parse(String(override.mock.calls[0]?.[1]?.body)) as { model: string };
    expect(overrideBody.model).toBe("custom-model");
  });

  it("logs the upstream wording error class and message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { message: "Invalid param: model rejected", code: "param_error", type: "invalid_request_error" } },
        { status: 400 },
      ),
    );
    const result = await handleVisitorMessage({
      text: "Berapa harga beras di Aceh?",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      now,
      requestId: "req-upstream",
    });
    expect(result.outcome).toBe("refusal");
    expect(result.reply).toBe("Jawaban harga tidak dapat disusun.");
    const line = formatRequestLog(result.log);
    expect(JSON.parse(line)).toMatchObject({
      errorClass: "wording_unavailable",
      upstreamClass: "param_error",
      upstreamMessage: "Invalid param: model rejected",
    });
    expect(line).not.toContain("Berapa harga");
    expect(line).not.toContain("test-key");
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

describe("live fresh overlay", () => {
  it("phrases the Jakarta beras price from the captured payload", async () => {
    const { result } = await askLive("harga beras di Jakarta");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("DKI Jakarta");
    expect(result.reply).toContain("Rp16.950");
    expect(result.reply).toContain("2026-10-05");
    expect(result.reply.toLowerCase()).not.toContain("harga hari ini");
    expect(result.draft.facts[0]?.harga).toBe(16950);
  });

  it("compares Jakarta and Bali, which the live payload prices", async () => {
    const { result } = await askLive("bandingkan beras Jakarta dan Bali");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("DKI Jakarta");
    expect(result.reply).toContain("Rp16.950");
    expect(result.reply).toContain("Bali");
    expect(result.reply).toContain("Rp16.050");
  });

  it("ranks the highest priced province and leaves out Papua Selatan", async () => {
    const { result } = await askLive("beras termahal");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Kalimantan Tengah");
    expect(result.reply).toContain("Rp20.150");
    expect(result.reply).toContain("dari 34 provinsi");
    expect(result.reply).not.toContain("Papua Selatan");
  });

  it("names the nearest-50 average of the priced rows", async () => {
    const { result } = await askLive("beras di Jakarta dibanding rata-rata");
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("DKI Jakarta");
    expect(result.reply).toContain("Rp16.950");
    expect(result.reply).toContain("Rp16.400");
  });

  it("refuses a date on or before the baked snapshot cutoff", async () => {
    const { result } = await askLive("harga beras di Jakarta tanggal 16 September 2026");
    expect(result.outcome).toBe("refusal");
    expect(result.log.errorClass).toBe("unpublished_date");
    expect(result.reply).not.toMatch(/Rp/);
  });

  it("refuses a province the overlay does not price", async () => {
    const { result } = await askLive("harga beras di Papua Selatan");
    expect(result.outcome).toBe("refusal");
    expect(result.log.errorClass).toBe("no_price");
    expect(result.reply).not.toMatch(/Rp/);
  });

  it("writes a handoff from the live displayed price", async () => {
    const claimed: HandoffRecord[] = [];
    const { result } = await askLive("harga beras di Jakarta harusnya 12.000", emptyDraft(), claimed);
    expect(result.outcome).toBe("handoff");
    expect(result.reply).toContain("Rp16.950");
    expect(claimed).toEqual([
      { commodity: "Beras", province: "DKI Jakarta", displayedPrice: 16950, claimedPrice: 12000 },
    ]);
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

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { emptyDraft, type HandoffRecord, type SessionDraft } from "../src/domain.js";
import { handleVisitorMessage } from "../src/agent/handle-request.js";
import { buildWordingPayload, defaultAstraFlowModel, wordingTimeoutMs } from "../src/agent/phrase.js";
import { selectRows } from "../src/agent/select.js";
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

  it("answers from the template and logs the upstream error when AstraFlow rejects the call", async () => {
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
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Rp15.700");
    expect(result.reply).toContain("2026-10-05");
    expect(result.modelCalled).toBe(false);
    expect(result.usage.totalTokens).toBe(0);
    const line = formatRequestLog(result.log);
    expect(JSON.parse(line)).toMatchObject({
      errorClass: "wording_fallback",
      upstreamClass: "param_error",
      upstreamMessage: "Invalid param: model rejected",
    });
    expect(line).not.toContain("Berapa harga");
    expect(line).not.toContain("test-key");
  });

  it("answers from the template when AstraFlow does not answer before the timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await handleVisitorMessage({
      text: "harga beras di Aceh",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      wordingTimeoutMs: 20,
      now,
      requestId: "req-timeout",
    });
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Rp15.700");
    expect(result.modelCalled).toBe(false);
    expect(result.log).toMatchObject({ errorClass: "wording_fallback", upstreamClass: "timeout" });
  });

  it("still writes the handoff when the template covers a failed wording call", async () => {
    const claimed: HandoffRecord[] = [];
    const result = await handleVisitorMessage({
      text: "harga beras di Aceh harusnya 12.000",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async (row) => {
        claimed.push(row);
      },
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>(async () => new Response("down", { status: 503 })),
      now,
      requestId: "req-claim-fallback",
    });
    expect(result.outcome).toBe("handoff");
    expect(claimed).toHaveLength(1);
    expect(result.log.errorClass).toBe("wording_fallback");
  });

  it("replaces a model sentence that drops the price and still charges the tokens it used", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        choices: [{ message: { content: "Harga beras di Aceh murah hari ini." } }],
        usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
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
      requestId: "req-rejected",
    });
    expect(result.outcome).toBe("answered");
    expect(result.reply).toContain("Rp15.700");
    expect(result.reply).toContain("2026-10-05");
    expect(result.reply.toLowerCase()).not.toContain("murah");
    expect(result.log.errorClass).toBe("wording_rejected");
    expect(result.modelCalled).toBe(true);
    expect(result.usage.totalTokens).toBe(80);
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

describe("astra request body", () => {
  const goodCompletion = () =>
    Response.json({
      choices: [{ message: { content: "Pada tanggal perdagangan 2026-10-05, harga Beras di Aceh adalah Rp15.700 per kg." } }],
      usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
    });

  async function sendBody(extra: { thinking?: string; tenantId?: string } = {}) {
    const fetchImpl = vi.fn<typeof fetch>(async () => goodCompletion());
    await handleVisitorMessage({
      text: "harga beras di Aceh",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      apiKey: "test-key",
      fetchImpl,
      now,
      requestId: "req-body",
      ...extra,
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    return { body: JSON.parse(String(init?.body)) as Record<string, unknown>, init };
  }

  it("turns thinking off by default", async () => {
    const { body } = await sendBody();
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.stream).toBe(false);
  });

  it("leaves thinking on when ASTRAFLOW_THINKING is on", async () => {
    const { body } = await sendBody({ thinking: " ON " });
    expect(body).not.toHaveProperty("thinking");
  });

  it("sends the tenant id as the user field and omits it without a tenant", async () => {
    expect((await sendBody({ tenantId: "acme" })).body.user).toBe("acme");
    expect(await sendBody()).toMatchObject({ body: expect.not.objectContaining({ user: expect.anything() }) });
  });

  it("aborts the call after the timeout window", async () => {
    const { init } = await sendBody();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("wording path", () => {
  const good = "Pada tanggal perdagangan 2026-10-05, harga Beras di Aceh adalah Rp15.700 per kg.";

  async function run(extra: { apiKey?: string; fetchImpl?: typeof fetch; wordingTimeoutMs?: number; text?: string; creditsRemaining?: number }) {
    return handleVisitorMessage({
      text: extra.text ?? "harga beras di Aceh",
      draft: emptyDraft(),
      readTable: (commodityId, dateToken) => readPriceTable({ source: "mock", commodityId, dateToken }),
      writeHandoff: async () => undefined,
      now,
      requestId: "req-path",
      ...extra,
    });
  }

  it("is astra when the model sentence is used", async () => {
    const result = await run({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: good } }] })),
    });
    expect(result.wording).toBe("astra");
    expect(result.reply).toContain(good);
    expect(JSON.parse(formatRequestLog(result.log))).toMatchObject({ wordingPath: "astra" });
  });

  it("is fallback when the call fails", async () => {
    const result = await run({ apiKey: "test-key", fetchImpl: vi.fn<typeof fetch>(async () => new Response("down", { status: 502 })) });
    expect(result.wording).toBe("fallback");
    expect(JSON.parse(formatRequestLog(result.log))).toMatchObject({ wordingPath: "fallback" });
  });

  it("is fallback when the call times out", async () => {
    const result = await run({
      apiKey: "test-key",
      wordingTimeoutMs: 20,
      fetchImpl: vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    });
    expect(result.wording).toBe("fallback");
  });

  it("is rejected when the model sentence fails the check", async () => {
    const result = await run({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>(async () =>
        Response.json({ choices: [{ message: { content: "Pada 5 Oktober 2026 harga beras di Aceh 15.700 per kg." } }] }),
      ),
    });
    expect(result.wording).toBe("rejected");
    expect(result.log.errorClass).toBe("wording_rejected");
    expect(result.reply).toContain("Rp15.700");
  });

  it("is none without a key, for a refusal, and for a claim-only message", async () => {
    expect((await run({})).wording).toBe("none");
    expect((await run({ text: "siapa presiden?" })).wording).toBe("none");
    expect((await run({ apiKey: "test-key", text: "harusnya 12000", fetchImpl: vi.fn() })).wording).toBe("none");
  });

  it("is none when the credit gate stops the call", async () => {
    const result = await run({ apiKey: "test-key", creditsRemaining: 0, fetchImpl: vi.fn() });
    expect(result.outcome).toBe("402");
    expect(result.wording).toBe("none");
  });

  it("waits 25 seconds for the gateway before the template answers", () => {
    expect(wordingTimeoutMs).toBe(25_000);
  });
});

describe("wording prompt", () => {
  const facts = selectRows(
    {
      tanggalPerdagangan: "2026-10-05",
      tanggalTerbaru: "2026-10-05",
      komoditas: "Gula Pasir",
      satuan: "kg",
      rataRata: 18000,
      baris: [{ provinsi: "Jawa Timur", harga: 18150, selisihRataRata: 150 }],
      sumber: "mock",
    },
    { kind: "province", province: "Jawa Timur" },
  );

  it("tells the model to write prices with the Rp prefix in both languages", () => {
    if ("missing" in facts) {
      throw new Error("expected facts");
    }
    expect(buildWordingPayload(facts, "berapa harga gula").messages[0]?.content).toContain("Rp15.600");
    expect(buildWordingPayload(facts, "what is the price of sugar").messages[0]?.content).toContain("Rp15,600");
  });

  it("keeps English questions in English with an English-style example", () => {
    if ("missing" in facts) {
      throw new Error("expected facts");
    }
    const prompt = buildWordingPayload(facts, "what is the price of sugar").messages[0]?.content ?? "";
    expect(prompt).toContain("in English");
    expect(prompt).not.toContain("Rp15.600");
  });
});
